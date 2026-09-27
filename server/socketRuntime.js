// The shared runtime every socket domain registers against: room state
// broadcast, the bot/auction/disconnect/inactivity timers, the empty-room garbage
// collector, seat detach/host-reassign bookkeeping, and the invite/cancel
// flows two domains share. One createRuntime() per server process — server.js
// builds the stores and io, then hands them here. Behavior (emit ordering,
// feed text, ack shapes) is pinned by server/rooms.test.js and
// server/server.test.js.
import { AUCTION_DURATION_MS } from './gameLogic.js';
import { normalizeAvatarGrid, normalizeClientId, buildMatchRecordOptions } from './roomSetup.js';
import { markPlayerActive, markPlayerInactive, isPlayerPresenceExpired } from './playerPresence.js';
import {
  VOTE_KICK_DURATION_MS,
  VOTE_KICK_COOLDOWN_MS,
  startRoomVoteKick as createRoomVoteKick,
  castRoomVoteKick as applyRoomVoteKickBallot,
} from './roomVoteKick.js';
import {
  selectBotTurnTarget,
  botMayStillAct,
  runBotTurn,
  resolvePurchaseOffer,
  isAuctionBotParticipant,
  decideBotAuction
} from './botLogic.js';
import { buildBotStrategicContext, BOT_RULE_VERSION } from './botStrategicContext.js';
import { getRoomForSocket as resolveRoomOrAck } from './socketHandlerSupport.js';
import { scheduleBotTimer } from './botTiming.js';

const DEFAULT_RECONNECT_GRACE_MS = 120000;
const configuredTestReconnectGrace = Number(process.env.POORUP_TEST_RECONNECT_GRACE_MS);
const DISCONNECT_GRACE_MS = process.env.NODE_ENV === 'test'
  && Number.isFinite(configuredTestReconnectGrace)
  && configuredTestReconnectGrace > 0
  ? Math.min(DEFAULT_RECONNECT_GRACE_MS, Math.floor(configuredTestReconnectGrace))
  : DEFAULT_RECONNECT_GRACE_MS;
const EMPTY_ROOM_GC_INTERVAL_MS = 60 * 1000;
const EMPTY_ROOM_GRACE_PERIOD_MS = 10 * 60 * 1000;
const ROOMS_UPDATED_DEBOUNCE_MS = 750;

// Obligations that gate the whole table must die with a departing or
// AFK seat, or the remaining players wait forever on a ghost.
const CANCELLED_OBLIGATIONS = [
  { key: 'pendingTrade', label: 'trade' },
  { key: 'pendingPlayerContract', label: 'player contract' }
];

// Room-local timer failures must not escape into the process-level exception
// path. Keep the wrapper dependency-free so each timer callback remains easy
// to test and teardown.
export function runRoomTimer(label, roomCode, callback, onError = console.error) {
  try {
    callback();
    return true;
  } catch (error) {
    try { onError(error, { label, roomCode }); } catch { /* logging must not throw */ }
    return false;
  }
}

// AFK payment expiry follows the authoritative bankruptcy/settlement seam;
// clearing an unpaid payment would silently forgive the obligation.
export function settleAfkPayment(game, player) {
  const pending = game?.pendingPayment;
  if (!pending || pending.playerId !== player?.id) return false;
  if (Number(player.cash) >= Math.max(0, Number(pending.amountRemaining) || 0)) {
    return Boolean(game.trySettlePendingPayment?.());
  }
  const creditor = pending.creditorId ? game.getPlayerById?.(pending.creditorId) : null;
  if (game.settings?.bankruptMode === 'debt' && typeof game.handleDebtBankruptcy === 'function') {
    game.handleDebtBankruptcy(player, creditor);
    return true;
  }
  if (typeof game.handleBankruptcy === 'function') {
    game.handleBankruptcy(player, creditor);
    return true;
  }
  return false;
}

function passPendingPurchaseForSeatRemoval(game, player) {
  const offer = game?.pendingPurchaseOffer;
  if (!offer || offer.playerId !== player?.id) return { resolved: false, auctionStarted: false };

  const tile = game.getTile?.(offer.tileIndex);
  game.cancelSponsoredPurchase?.();
  game.pendingPurchaseOffer = null;
  if (!tile || tile.ownerId !== null || !game.settings?.auction) {
    game.feedMessage?.(`${player.nickname} passed on the property before leaving.`);
    return { resolved: true, auctionStarted: false };
  }

  const startingPlayerId = nextAuctionStarter(game, player.id);
  if (!startingPlayerId) {
    game.feedMessage?.(`${player.nickname} passed on the property before leaving.`);
    return { resolved: true, auctionStarted: false };
  }
  game.startAuction?.(tile, startingPlayerId);
  const auction = game.auction;
  if (!auction?.active) {
    game.feedMessage?.(`${player.nickname} passed on the property before leaving.`);
    return { resolved: true, auctionStarted: false };
  }

  auction.participants = [...new Set((auction.participants || []).filter(id => id !== player.id))];
  auction.passedPlayerIds = [...new Set([...(auction.passedPlayerIds || []), player.id])];
  if (auction.startingPlayerId === player.id) auction.startingPlayerId = startingPlayerId;
  game.feedMessage?.(`${player.nickname} passed on ${tile.name} before leaving.`);
  return { resolved: true, auctionStarted: true };
}

function nextAuctionStarter(game, departingPlayerId) {
  const playersById = new Map((game.players || []).map(player => [player.id, player]));
  const order = Array.isArray(game.turnOrder) ? game.turnOrder : (game.players || []).map(player => player.id);
  const oldIndex = order.indexOf(departingPlayerId);
  for (let offset = 1; offset <= order.length; offset += 1) {
    const index = oldIndex < 0 ? offset - 1 : (oldIndex + offset) % order.length;
    const candidate = playersById.get(order[index]);
    if (candidate && candidate.id !== departingPlayerId && !candidate.bankrupt && !candidate.disconnected) return candidate.id;
  }
  return null;
}

export function annotateMatchAchievements(matchRecord, candidates = []) {
  if (!matchRecord || !Array.isArray(matchRecord.participants)) return matchRecord;
  matchRecord.participants.forEach((participant) => {
    const unlocked = candidates
      .filter(candidate => candidate.accountId === participant.accountId)
      .map(candidate => candidate.achievementId)
      .filter(id => typeof id === 'string');
    participant.achievementsUnlocked = [...new Set(unlocked)].slice(0, 32);
    participant.mythicalUnlocked = candidates.some(candidate => candidate.accountId === participant.accountId && candidate.rarity === 'MYTHICAL');
  });
  return matchRecord;
}

export function recordMatchTelemetry(context) {
  const { telemetryStore, matchRecord, telemetryVersions } = context;
  telemetryStore?.record('match-complete', {
    playerCount: matchRecord.playerCount,
    roundCount: matchRecord.roundCount,
    botOnly: matchRecord.participants.every(participant => !participant.accountId)
  }, telemetryVersions);
}

export function recordLoggedTelemetry(context) {
  const { telemetryStore, room, telemetryVersions } = context;
  (room.game.telemetryLog || []).forEach(entry => {
    telemetryStore?.record(entry.kind, { ...(entry.data || {}), roundNumber: entry.roundNumber }, { ...telemetryVersions, eventId: entry.data?.eventId });
  });
}

function recordMarketTelemetry(context) {
  const { telemetryStore, matchRecord, telemetryVersions } = context;
  telemetryStore?.record('market-volatility', {
    marketRows: matchRecord.market.length,
    marketTrades: matchRecord.participants.reduce((sum, participant) => sum + (Number(participant.marketTrades) || 0), 0)
  }, telemetryVersions);
}

function recordBankruptcyTelemetry(context) {
  const { telemetryStore, matchRecord, telemetryVersions } = context;
  const bankruptcies = matchRecord.participants.filter(participant => participant.bankrupt).length;
  if (bankruptcies) telemetryStore?.record('bankruptcy', { count: bankruptcies }, telemetryVersions);
}

function recordAchievementTelemetry(context) {
  const { telemetryStore, candidates, telemetryVersions, matchRecord } = context;
  const botOnly = matchRecord?.botOnly === true;
  candidates.slice(0, 32).forEach(candidate => telemetryStore?.record('achievement-unlocked', { rarity: candidate.rarity, achievementId: candidate.achievementId, botOnly }, telemetryVersions));
}

export function recordBotTelemetry(context) {
  const { telemetryStore, matchRecord, telemetryVersions } = context;
  const botOnly = matchRecord.botOnly === true || (Array.isArray(matchRecord.participants) && matchRecord.participants.length > 0 && matchRecord.participants.every(participant => !participant.accountId));
  (matchRecord.botDecisions || []).slice(-200).forEach(decision => telemetryStore?.record('bot-outcome', {
    provider: decision.provider,
    botMode: decision.botMode || (decision.provider === 'ai' ? 'ai' : 'no-ai'),
    botOnly,
    fallback: decision.fallback,
    success: decision.success,
    phase: decision.phase,
    actionId: decision.actionId
  }, telemetryVersions));
}

export function recordMatchStartTelemetry({ telemetryStore, room, telemetryVersions = {} } = {}) {
  const marker = room?.game?.startedAt || true;
  if (!telemetryStore || !room?.game?.started || room.analyticsMatchStartRecorded === marker) return false;
  const result = telemetryStore.record('match-start', { roundNumber: Math.max(0, Math.floor(Number(room.game.roundNumber) || 0)) }, telemetryVersions);
  if (result?.recorded) { room.analyticsMatchStartRecorded = marker; return true; }
  return false;
}

export function recordMatchStalledTelemetry({ telemetryStore, room, telemetryVersions = {}, reasonCode = 'room-ended-without-settlement' } = {}) {
  const marker = room?.game?.startedAt || true;
  if (!telemetryStore || !room?.game?.started || room.analyticsMatchStalledRecorded === marker) return false;
  const result = telemetryStore.record('match-stalled', { roundNumber: Math.max(0, Math.floor(Number(room.game.roundNumber) || 0)), reasonCode: String(reasonCode || 'unknown').slice(0, 80) }, telemetryVersions);
  if (result?.recorded) { room.analyticsMatchStalledRecorded = marker; return true; }
  return false;
}

function roomTelemetryVersions(room) {
  return {
    seasonId: room?.game?.seasonId || room?.seasonId,
    rulesetRevision: room?.ruleset?.rulesetRevision || room?.settings?.rulesetRevision,
    balanceRevision: room?.ruleset?.balanceRevision || room?.settings?.balanceRevision,
    boardVariant: room?.ruleset?.boardVariant || room?.settings?.boardVariant,
    rulesetPreset: room?.ruleset?.rulesetPreset || room?.settings?.rulesetPreset,
    marketComplexity: room?.ruleset?.effectiveSettings?.marketComplexity || room?.settings?.marketComplexity
  };
}

export function recordSeasonTelemetry(context) {
  const { telemetryStore, room, matchRecord, candidates, seasonResult } = context;
  const matchId = String(matchRecord?.matchId || '').trim();
  if (matchId && room?.analyticsTelemetryMatchId === matchId) return false;
  if (matchId && room) room.analyticsTelemetryMatchId = matchId;
  const telemetryContext = {
    telemetryStore,
    room,
    matchRecord,
    candidates,
    telemetryVersions: {
      seasonId: seasonResult?.season?.id || matchRecord.seasonId || 'unseasoned',
      rulesetRevision: matchRecord.rulesetRevision,
      balanceRevision: matchRecord.balanceRevision,
      boardVariant: matchRecord.boardVariant
    }
  };
  recordMatchStartTelemetry(telemetryContext);
  recordMatchTelemetry(telemetryContext);
  recordLoggedTelemetry(telemetryContext);
  recordMarketTelemetry(telemetryContext);
  recordBankruptcyTelemetry(telemetryContext);
  recordAchievementTelemetry(telemetryContext);
  recordBotTelemetry(telemetryContext);
  return true;
}

export function reassignHostIfNeeded(room, departedPlayerId) {
  if (!room) return;
  if (room.hostId !== departedPlayerId) return;
  const available = room.game.players.find(player => !player.isBot
    && !player.disconnected
    && !player.bankrupt
    && !player.inDebt
    && player.id !== departedPlayerId);
  room.hostId = available?.id || null;
  room.game.players.forEach(player => { player.isHost = player.id === room.hostId; });
}

function createRuntime(deps) {
  const { io, roomManager, accountStore, socialStore, matchStore, achievementStore, seasonStore, cosmeticStore, telemetryStore, botAdvisor, social, maintenance, metrics, authoritativeStore, pubsubAdapter } = deps;
  const setTimeoutFn = deps.setTimeout || globalThis.setTimeout;
  const clearTimeoutFn = deps.clearTimeout || globalThis.clearTimeout;
  const setIntervalFn = deps.setInterval || globalThis.setInterval;
  const now = deps.now || (() => Date.now());
  const configuredDisconnectGrace = Number(deps.disconnectGraceMs);
  const disconnectGraceMs = Number.isFinite(configuredDisconnectGrace) && configuredDisconnectGrace > 0
    ? Math.max(1, Math.floor(configuredDisconnectGrace))
    : DISCONNECT_GRACE_MS;
  const auctionTimers = new Map();
  const disconnectTimers = new Map();
  const inactivityTimers = new Map();
  const voteKickTimers = new Map();
  const botTimers = new Map();
  const botDecisionLocks = new Set();
  const auctionBotTimers = new Map();
  const auctionDecisionLocks = new Set();
  let roomsUpdatedTimer = null;

  function safeBotProviderStatus(status = {}) {
    const states = new Set(['healthy', 'unconfigured', 'quota-exhausted', 'cooldown']);
    const state = states.has(status.state) ? status.state : 'unconfigured';
    const reasons = new Set(['credits-exhausted', 'missing-credentials', 'provider-cooldown']);
    const reason = reasons.has(status.reason) ? status.reason : null;
    const revision = Number.isFinite(Number(status.revision)) ? Math.max(0, Math.floor(Number(status.revision))) : 0;
    return { state, revision, reason };
  }

  function botProviderStatus() {
    if (typeof botAdvisor?.getPublicStatus === 'function') return safeBotProviderStatus(botAdvisor.getPublicStatus());
    const health = typeof botAdvisor?.getHealth === 'function' ? botAdvisor.getHealth() : null;
    return safeBotProviderStatus({
      state: health?.state,
      reason: health?.state === 'quota-exhausted' ? 'credits-exhausted' : health?.state === 'unconfigured' ? 'missing-credentials' : health?.state === 'open' ? 'provider-cooldown' : null,
      revision: 0
    });
  }

  const unsubscribeBotProviderStatus = typeof botAdvisor?.subscribeProviderStatus === 'function'
    ? botAdvisor.subscribeProviderStatus(status => io.emit('bot-provider-status', safeBotProviderStatus(status)))
    : null;

  function accountFromPayload(payload = {}) {
    return accountStore.sessionAccount(payload.sessionToken);
  }

  function getRoomForSocket(socket, callback) {
    return resolveRoomOrAck(runtime, socket, callback);
  }

  // One debounced push keeps public-room browsers current without emitting per
  // create/join/leave/start burst.
  function scheduleRoomsUpdated() {
    clearTimeoutFn(roomsUpdatedTimer);
    roomsUpdatedTimer = setTimeoutFn(() => runRoomTimer('rooms-updated', '*', () => {
      roomsUpdatedTimer = null;
      io.emit('rooms-updated', { rooms: roomManager.listPublicRooms() });
    }), ROOMS_UPDATED_DEBOUNCE_MS);
  }

  function emitRoomState(room) {
    if (!room || room.destroyed) return;
    if (room.game?.started) recordMatchStartTelemetry({ telemetryStore, room, telemetryVersions: roomTelemetryVersions(room) });
    metrics?.setMetric('active-rooms', roomManager.rooms.size, { scope: 'all' });
    metrics?.setMetric('active-rounds', [...roomManager.rooms.values()].filter(candidate => candidate.game.started && !candidate.destroyed).length, { scope: 'all' });
    try {
      if (room.game.lastWinner && !room.statsRecorded) {
        recordRoomStats(room);
      }
    } catch (error) {
      // A store outage must not prevent connected clients from receiving the
      // authoritative in-memory game state. The next state emission retries
      // settlement while this broadcast path remains available.
      console.error('recordRoomStats failed for room', room.roomCode, error);
    }
    try {
      synchronizeInactivityTimers(room);
      broadcastRoomState(room);
      scheduleBotTurn(room);
      scheduleBotAuction(room);
    } catch (error) {
      console.error('emitRoomState failed for room', room.roomCode, error);
    }
  }

  function recordRoomStats(room) {
    const matchRecord = accountStore.recordGameResults(room.game.players, room.game.lastWinner.id, buildMatchRecordOptions(room));
    const historyReader = accountId => accountStore.getMatchHistory(accountId);
    const candidates = achievementStore.evaluateMatch(matchRecord, historyReader);
    annotateMatchAchievements(matchRecord, candidates);
    const seasonResult = seasonStore?.recordMatch(matchRecord);
    if (seasonResult?.recorded) matchRecord.seasonId = seasonResult.season.id;
    // The account snapshot was written before achievement/season enrichment;
    // update that same match ID once so a restart sees the authoritative
    // annotated record without replaying match statistics.
    accountStore.updateMatchRecord?.(matchRecord);
    matchStore.record(matchRecord);
    candidates.forEach(candidate => social.recordVerifiedAchievement(candidate, matchRecord.matchId));
    recordSeasonTelemetry({ telemetryStore, room, matchRecord, candidates, seasonResult });
    // Refresh the owner’s private profile immediately after settlement so
    // completed-game stats, history, and achievement counts are current while
    // the player is still in the game shell.
    room.game.players.forEach(player => syncPlayerAccountSnapshot(player));
    room.statsRecorded = true;
  }

  function syncPlayerAccountSnapshot(player) {
    if (!player.accountId) return;
    const snapshot = accountStore.getAccountSnapshot(player.accountId);
    if (!snapshot) return;
    social.socketsForAccount(player.accountId).forEach(candidateSocket => candidateSocket.emit('account-sync', { account: snapshot }));
  }

  function broadcastRoomState(room) {
    const serverTime = Date.now();
    // Game summaries now carry owner-only loan and contract terms. Emit a
    // viewer-scoped projection so another seat can see that a loan exists
    // without receiving its collateral, premium, or repayment schedule.
    io.sockets.sockets.forEach(candidate => {
      if (!candidate.rooms.has(room.roomCode)) return;
      const viewer = room.getPlayerBySocket(candidate.id);
      candidate.emit('update-state', {
        room: room.getRoomSummary(viewer?.id || null),
        game: room.game.getGameSummary(viewer?.id || null),
        serverTime
      });
    });
  }

  function emitPendingInteractions(room, socket, player) {
    if (!room) return;
    if (!socket) return;
    if (!player) return;
    emitPendingPurchase(room, socket, player);
    emitPendingTrade(room, socket, player);
    emitPendingContract(room, socket, player);
    if (room.game.pendingSponsoredPurchase) {
      socket.emit('sponsorship-update', { sponsorship: room.game.summarySponsoredPurchase() });
    }
  }

  function emitPendingPurchase(room, socket, player) {
    const purchase = room.game.pendingPurchaseOffer;
    if (!purchase) return;
    if (purchase.playerId !== player.id) return;
    if (room.game.currentPlayerId !== player.id) return;
    const tile = room.game.getTile(purchase.tileIndex);
    if (!tile) return;
    socket.emit('purchase-offer', {
      tileIndex: tile.index,
      name: tile.name,
      price: tile.price,
      canAfford: player.cash >= tile.price,
      canSeekSponsorship: true
    });
  }

  function emitPendingTrade(room, socket, player) {
    const trade = room.game.pendingTrade;
    if (!trade) return;
    if (trade.toPlayerId !== player.id) return;
    socket.emit('trade-offer', { trade });
  }

  function emitPendingContract(room, socket, player) {
    const contract = room.game.pendingPlayerContract;
    if (!contract) return;
    if (contract.toPlayerId !== player.id) return;
    socket.emit('player-contract-offer', { contract });
  }

  // --- seat lifecycle ------------------------------------------------------

  // Leave any previous game rooms so we don't receive ghost updates
  function leaveAllGameRooms(socket) {
    for (const joined of [...socket.rooms]) {
      if (joined !== socket.id) {
        socket.leave(joined);
      }
    }
  }

  // Drop this socket's seat in any room other than the one being joined:
  // lobby seats are removed outright, started-game seats become disconnected.
  function detachSocketFromOtherRoom(socket, room) {
    const oldRoom = roomManager.getRoomBySocket(socket.id);
    if (!oldRoom) return;
    if (oldRoom.roomCode === room.roomCode) return;
    const oldPlayer = oldRoom.getPlayerBySocket(socket.id);
    if (!oldPlayer) return;
    if (oldRoom.game.started) {
      detachStartedSeat(oldRoom, oldPlayer);
      return;
    }
    oldRoom.game.removePlayerBySocket(socket.id);
    // Lobby hosts that leave must hand the room over, or Start stays dead.
    reassignHostIfNeeded(oldRoom, oldPlayer.id);
    emitRoomState(oldRoom);
  }

  function detachStartedSeat(oldRoom, oldPlayer) {
    scheduleDisconnect(oldRoom, oldPlayer.socketId, oldPlayer);
    reassignHostIfNeeded(oldRoom, oldPlayer.id);
    emitRoomState(oldRoom);
  }

  function clearAuctionTimer(room) {
    const timer = auctionTimers.get(room.roomCode);
    if (timer) {
      clearTimeoutFn(timer);
    }
    auctionTimers.delete(room.roomCode);
  }

  function inactivityTimerKey(room, playerId) {
    return `${room.roomCode}:${playerId}`;
  }

  function clearInactivityTimer(room, playerId = null) {
    if (!room?.roomCode) return;
    const prefix = `${room.roomCode}:`;
    for (const [key, watch] of inactivityTimers) {
      if (watch.room !== room || (playerId && watch.playerId !== playerId)) continue;
      clearTimeoutFn(watch.handle);
      if (key.startsWith(prefix)) inactivityTimers.delete(key);
    }
  }

  function scheduleInactivityTimer(room, player) {
    const key = inactivityTimerKey(room, player.id);
    const existing = inactivityTimers.get(key);
    if (existing && existing.player === player
      && existing.socketId === player.socketId
      && existing.deadline === player.presence?.inactiveUntil) return;
    if (existing) clearTimeoutFn(existing.handle);
    if (!player.presence || player.presence.state !== 'inactive') {
      inactivityTimers.delete(key);
      return;
    }
    const watch = {
      room,
      roomCode: room.roomCode,
      player,
      playerId: player.id,
      clientId: player.clientId,
      socketId: player.socketId,
      deadline: player.presence.inactiveUntil,
      handle: null,
    };
    const run = () => runRoomTimer('player-inactivity-expiry', room.roomCode, () => {
      if (inactivityTimers.get(key) !== watch) return;
      const remaining = watch.deadline - now();
      if (remaining > 0) {
        watch.handle = setTimeoutFn(run, remaining);
        return;
      }
      expireInactiveSeat(watch);
    });
    watch.handle = setTimeoutFn(run, Math.max(0, watch.deadline - now()));
    inactivityTimers.set(key, watch);
  }

  function synchronizeInactivityTimers(room) {
    if (!room) return;
    const humans = new Set(room.game.players.filter(player => !player.isBot && !player.bankrupt && !player.disconnected).map(player => player.id));
    for (const [key, watch] of inactivityTimers) {
      if (watch.room === room && (!humans.has(watch.playerId) || watch.player.presence?.state !== 'inactive')) {
        clearTimeoutFn(watch.handle);
        inactivityTimers.delete(key);
      }
    }
    room.game.players.forEach(player => {
      if (!player.isBot && !player.bankrupt && !player.disconnected) scheduleInactivityTimer(room, player);
    });
  }

  function setPlayerPresence(socket, payload = {}) {
    const room = roomManager.getRoomBySocket(socket?.id);
    const player = room?.getPlayerBySocket(socket.id);
    if (!room || !player || player.isBot || player.bankrupt || player.disconnected) {
      return { success: false, error: 'That room seat is no longer active.' };
    }
    if (payload.state === 'active') {
      player.presence = markPlayerActive(player).presence;
    } else if (payload.state === 'inactive' && (payload.reason === 'hidden' || payload.reason === 'idle')) {
      player.presence = markPlayerInactive(player, { reason: payload.reason, now: now() }).presence;
    } else {
      return { success: false, error: 'Invalid presence state.' };
    }
    synchronizeInactivityTimers(room);
    emitRoomState(room);
    return { success: true, presence: player.presence };
  }

  function publicVoteKick(vote) {
    if (!vote) return null;
    const ballots = Object.values(vote.ballots || {});
    return {
      voteId: vote.voteId,
      targetPlayerId: vote.targetPlayerId,
      openedAt: vote.openedAt,
      expiresAt: vote.expiresAt,
      eligibleCount: vote.eligibleCount,
      yesCount: ballots.filter(choice => choice === 'yes').length,
      noCount: ballots.filter(choice => choice === 'no').length,
      requiredYes: vote.requiredYes,
      status: vote.status,
    };
  }

  function emitVoteKickState(room, vote) {
    const snapshot = publicVoteKick(vote);
    room.voteKickSnapshot = snapshot;
    io.in(room.roomCode).emit('room-votekick-update', { vote: snapshot });
    return snapshot;
  }

  function voteKickReplay(room, player, requestId, payload, result = null) {
    if (!room.voteKickReplays) room.voteKickReplays = new Map();
    const key = `${player.id}:${requestId}`;
    const previous = room.voteKickReplays.get(key);
    if (previous) {
      if (previous.fingerprint !== JSON.stringify(payload)) {
        return { success: false, error: 'That request ID was already used.' };
      }
      return previous.result;
    }
    if (result) {
      room.voteKickReplays.set(key, { fingerprint: JSON.stringify(payload), result });
      while (room.voteKickReplays.size > 500) room.voteKickReplays.delete(room.voteKickReplays.keys().next().value);
    }
    return null;
  }

  function startRoomVoteKick(socket, payload = {}) {
    const room = roomManager.getRoomBySocket(socket?.id);
    const initiator = room?.getPlayerBySocket(socket.id);
    const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim().slice(0, 100) : '';
    if (!room || !initiator || !requestId) return { success: false, error: 'A current room seat and request ID are required.' };
    const replay = voteKickReplay(room, initiator, requestId, payload);
    if (replay) return replay;
    const cooldowns = room.voteKickCooldowns || (room.voteKickCooldowns = new Map());
    const vote = createRoomVoteKick({
      players: room.game.players,
      initiatorId: initiator.id,
      targetPlayerId: typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : '',
      now: now(),
      activeVote: room.voteKick?.status === 'open' ? room.voteKick : null,
      cooldownUntil: cooldowns.get(initiator.id) || 0,
    });
    if (!vote) {
      const result = { success: false, error: 'A vote cannot be started for that player right now.' };
      voteKickReplay(room, initiator, requestId, payload, result);
      return result;
    }
    room.voteKickCounter = (room.voteKickCounter || 0) + 1;
    vote.voteId = `${room.roomCode}-${now().toString(36)}-${room.voteKickCounter.toString(36)}`;
    room.voteKick = vote;
    cooldowns.set(initiator.id, now() + VOTE_KICK_COOLDOWN_MS);
    const snapshot = emitVoteKickState(room, vote);
    const oldTimer = voteKickTimers.get(room.roomCode);
    if (oldTimer) clearTimeoutFn(oldTimer);
    const timer = setTimeoutFn(() => runRoomTimer('room-votekick-expiry', room.roomCode, () => {
      if (room.voteKick !== vote || vote.status !== 'open') return;
      vote.status = 'expired';
      voteKickTimers.delete(room.roomCode);
      emitVoteKickState(room, vote);
    }), VOTE_KICK_DURATION_MS);
    voteKickTimers.set(room.roomCode, timer);
    const result = { success: true, vote: snapshot };
    voteKickReplay(room, initiator, requestId, payload, result);
    return result;
  }

  function castRoomVoteKick(socket, payload = {}) {
    const room = roomManager.getRoomBySocket(socket?.id);
    const voter = room?.getPlayerBySocket(socket.id);
    const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim().slice(0, 100) : '';
    const vote = room?.voteKick;
    if (!room || !voter || !requestId || !vote || payload.voteId !== vote.voteId) {
      return { success: false, error: 'That vote is no longer active.' };
    }
    const result = applyRoomVoteKickBallot({ vote, voterId: voter.id, choice: payload.choice, now: now(), requestId });
    if (!result.accepted) {
      if (result.vote !== vote) {
        room.voteKick = result.vote;
        emitVoteKickState(room, result.vote);
      }
      return { success: false, error: result.reason || 'That ballot was rejected.', vote: publicVoteKick(result.vote) };
    }
    room.voteKick = result.vote;
    const snapshot = emitVoteKickState(room, result.vote);
    if (result.vote.status !== 'open') {
      clearTimeoutFn(voteKickTimers.get(room.roomCode));
      voteKickTimers.delete(room.roomCode);
    }
    if (result.vote.status === 'passed') {
      const target = room.game.getPlayerById(result.vote.targetPlayerId);
      if (target) {
        io.in(room.roomCode).emit('system-message', {
          text: `${target.nickname} was removed after the room vote-kick passed.`,
        });
        removeSeatForReason(room, target, 'vote-kick', true);
      }
    }
    return { success: true, vote: snapshot };
  }

  function removeSeatForReason(room, player, reason, preventRejoin = false) {
    const playerId = player.id;
    if (room.game.pendingPayment?.playerId === playerId) settleAfkPayment(room.game, player);
    clearPendingObligations(room, room.game, player, reason);
    revokeAuctionLeadIfLeader(room, player, reason);
    if (room.game.pendingPurchaseOffer?.playerId === playerId) {
      const result = passPendingPurchaseForSeatRemoval(room.game, player);
      if (result.auctionStarted) scheduleAuctionFinish(room);
    }
    const socket = io.sockets?.sockets?.get(player.socketId);
    const message = reason === 'disconnect'
      ? `${player.nickname} disconnected.`
      : `${player.nickname} was removed for ${reason}.`;
    socket?.emit('system-message', { text: message });
    const removed = roomManager.removeRoomSeat({
      clientId: player.clientId,
      socketId: player.socketId,
      reason,
      preventRejoin,
    });
    if (!removed.success) return false;
    clearInactivityTimer(room, playerId);
    socket?.leave(room.roomCode);
    emitRoomState(room);
    io.in(room.roomCode).emit('system-message', { text: message });
    scheduleRoomsUpdated();
    return true;
  }

  function expireInactiveSeat(watch) {
    if (inactivityTimers.get(inactivityTimerKey(watch.room, watch.playerId)) !== watch) return false;
    const room = roomManager.getRoom(watch.roomCode);
    const player = room?.game.getPlayerByClient(watch.clientId);
    if (room !== watch.room || player !== watch.player || player?.socketId !== watch.socketId
      || player?.disconnected || player?.bankrupt || player?.isBot
      || !isPlayerPresenceExpired(player, now())) return false;
    inactivityTimers.delete(inactivityTimerKey(room, player.id));
    return removeSeatForReason(room, player, 'inactivity', false);
  }

  function clearDisconnectTimer(clientId) {
    const timer = disconnectTimers.get(clientId);
    if (timer) {
      clearTimeoutFn(timer.handle);
      disconnectTimers.delete(clientId);
    }
  }

  function clearDisconnectTimersForRoom(room) {
    if (!room) return;
    room.game.players.forEach(player => {
      clearDisconnectTimer(player.clientId);
    });
  }

  // Shared teardown for rooms removed outside of the normal lifecycle (GC and
  // stale private-code reclaim): clears every timer keyed by this room and
  // drops it from the live map.
  function destroyRoom(room) {
    if (!room) return;
    const roomCode = room.roomCode;
    if (room.game?.started && !room.game?.lastWinner) recordMatchStalledTelemetry({ telemetryStore, room, telemetryVersions: roomTelemetryVersions(room) });
    room.destroyed = true;
    clearAuctionTimer(room);
    clearInactivityTimer(room);
    const voteTimer = voteKickTimers.get(roomCode);
    if (voteTimer) clearTimeoutFn(voteTimer);
    voteKickTimers.delete(roomCode);
    clearDisconnectTimersForRoom(room);
    clearTimeoutFn(auctionBotTimers.get(roomCode));
    auctionBotTimers.delete(roomCode);
    clearTimeoutFn(botTimers.get(roomCode));
    botTimers.delete(roomCode);
    botDecisionLocks.delete(roomCode);
    auctionDecisionLocks.delete(roomCode);
    // Drop the socket->room index for everyone still mapped to this room;
    // otherwise connected players keep acting on a zombie room that is gone
    // from the registry (getRoomBySocket would still resolve it).
    forgetSocketMappings(room);
    roomManager.rooms.delete(roomCode);
  }

  function forgetSocketMappings(room) {
    for (const [socketId, mappedRoom] of roomManager.socketRoom.entries()) {
      if (mappedRoom === room) roomManager.socketRoom.delete(socketId);
    }
  }

  // --- bots ----------------------------------------------------------------

  function scheduleBotTurn(room) {
    if (!room?.game.started || room.destroyed) return;
    // Auctions have their own participant timer. Keeping the ordinary turn
    // queue out of this phase prevents the current seat from issuing a
    // rejected pass/bid while a different bot is the auction participant.
    if (room.game.auction?.active) return;
    if (botTurnPending(room)) return;
    const bot = selectBotTurnTarget(room.game);
    if (!bot?.isBot) return;
    if (bot.bankrupt) return;
    if (bot.disconnected) return;
    const timer = scheduleBotTimer(
      setTimeoutFn,
      () => runRoomTimer('bot-turn', room.roomCode, () => beginBotTurn(room, bot)),
      'turn'
    );
    botTimers.set(room.roomCode, timer);
  }

  function botTurnPending(room) {
    if (botTimers.has(room.roomCode)) return true;
    return botDecisionLocks.has(room.roomCode);
  }

  function beginBotTurn(room, bot) {
    botTimers.delete(room.roomCode);
    botDecisionLocks.add(room.roomCode);
    runBotDecision(room, bot)
      .catch(error => {
        // A failed bot decision must not escape the timer callback: an
        // uncaught error here used to take the whole process down. The room
        // stays alive and the watchdog/next action retries naturally.
        console.error(`Bot turn failed in room ${room.roomCode}:`, error);
      })
      .finally(() => finishBotTurn(room));
  }

  async function runBotDecision(room, bot) {
    // Re-read live state: seats, pendings, and votes may have changed while
    // this timer was queued. The decision policy itself lives in
    // botLogic.js and is covered by server/botLogic.test.js.
    if (!botMayStillAct(room.game, bot)) return;
    if (room.destroyed) return;
    const decisionSequence = (room.game.botDecisionSequence || 0) + 1;
    emitBotStatus(room, bot, 'thinking', { decisionSequence });
    const result = await runBotTurn(room, bot, botAdvisor);
    if (room.destroyed) return;
    if (result?.botDecision) {
      const trace = room.game.recordBotDecisionTrace(result.botDecision);
      emitBotStatus(room, bot, 'chosen', trace);
    }
    if (result?.botChat) {
      io.in(room.roomCode).emit('chat-message', { text: result.botChat, nickname: bot.nickname, senderId: bot.id, bot: true });
    }
    if (result?.noEmit) return;
    // Tail purchase resolution, second half of the post-roll double-check.
    resolvePurchaseOffer(room, bot, result);
    emitRoomState(room);
  }

  function emitBotStatus(room, bot, state, details = {}) {
    const health = typeof botAdvisor.getHealth === 'function' ? botAdvisor.getHealth() : null;
    const fallbackReason = publicBotFallbackReason(details.fallbackReason);
    io.in(room.roomCode).emit('bot-status', {
      playerId: bot.id,
      nickname: bot.nickname,
      state,
      brain: details.brain || room.settings.botBrain || 'auto',
      difficulty: details.difficulty || room.settings.botDifficulty || 'table',
      provider: details.provider === 'ai' ? 'ai' : 'deterministic',
      fallback: details.fallback === true,
      fallbackReason,
      actionId: details.actionId || null,
      decisionSequence: details.sequence || details.decisionSequence || null,
      latencyMs: details.latencyMs || 0,
      healthState: health?.state === 'healthy' ? 'ready' : 'fallback'
    });
  }

  // Keep provider credentials, billing/quota details, and raw error text out
  // of the room-wide event. The private match trace retains the exact reason.
  function publicBotFallbackReason(reason) {
    const key = String(reason || '').toLowerCase();
    if (!key) return null;
    if (key === 'no-ai-mode') return 'no-ai-mode';
    if (key === 'auction-policy' || key === 'phase-resolution' || key === 'deterministic-advisor') return 'house-policy';
    if (key === 'quota' || key === 'quota-exhausted') return 'credits-exhausted';
    if (key === 'game-budget') return 'game-budget';
    if (key === 'circuit-open') return 'provider-cooldown';
    return 'provider-unavailable';
  }

  function finishBotTurn(room) {
    botDecisionLocks.delete(room.roomCode);
    scheduleBotTurn(room);
    scheduleBotAuction(room);
  }

  function scheduleBotAuction(room) {
    if (room?.destroyed) return;
    const auction = room?.game.auction;
    if (!auction?.active) return;
    const key = room.roomCode;
    if (auctionBotTimers.has(key) || auctionDecisionLocks.has(key)) return;
    const bot = room.game.players.find(player => isAuctionBotParticipant(auction, player));
    if (!bot) return;
    const timer = scheduleBotTimer(
      setTimeoutFn,
      () => runRoomTimer('bot-auction', room.roomCode, () => {
        beginBotAuctionBid(room, bot, key).catch(error => {
          console.error(`Bot auction decision failed in room ${room.roomCode}:`, error);
        });
      }),
      'auction'
    );
    auctionBotTimers.set(key, timer);
  }

  async function beginBotAuctionBid(room, bot, key) {
    if (auctionDecisionLocks.has(key)) return;
    auctionDecisionLocks.add(key);
    try {
      await beginBotAuctionBidUnlocked(room, bot, key);
    } finally {
      auctionDecisionLocks.delete(key);
      if (!room.destroyed) scheduleBotAuction(room);
    }
  }

  async function beginBotAuctionBidUnlocked(room, bot, key) {
    auctionBotTimers.delete(key);
    if (!room.game.auction?.active) return;
    const auctionVersion = auctionIdentity(room.game.auction);
    const decisionSequence = (room.game.botDecisionSequence || 0) + 1;
    room.game.botDecisionSequence = decisionSequence;
    emitBotStatus(room, bot, 'thinking', { decisionSequence, phase: 'auction' });
    const context = {
      botId: bot.id,
      botBrain: room.settings.botBrain || 'auto',
      botDifficulty: room.settings.botDifficulty || 'table',
      gameId: `${room.roomCode}:${room.game.startedAt || 'pending'}`,
      decisionSequence,
      ruleVersion: BOT_RULE_VERSION,
      ...buildBotStrategicContext(room.game, bot, 'auction', decisionSequence)
    };
    const choice = await decideBotAuction({
      auction: room.game.auction,
      bot,
      startingCash: room.game.settings.startingCash,
      advisor: botAdvisor,
      context: { ...context, event: room.game.globalEvent }
    });
    if (room.destroyed || !sameAuction(room.game.auction, auctionVersion)) return;
    const { candidates, minimum, decision } = choice;
    const actionId = choice.actionId;
    const shouldBid = actionId === 'auction:bid';
    const result = room.runBotAction(bot.id, actor => bidOrPass(room, actor, shouldBid, minimum));
    const trace = room.game.recordBotDecisionTrace({
      ...context,
      phase: 'auction',
      ...decision,
      provider: decision?.provider || 'deterministic',
      fallback: choice.actionId !== decision?.actionId || decision?.fallback !== false,
      fallbackReason: choice.actionId !== decision?.actionId ? 'invalid-auction-action' : decision?.fallbackReason || 'auction-policy',
      actionId,
      confidence: Number.isFinite(Number(decision?.confidence)) ? decision.confidence : 0.55,
      success: result?.success !== false,
      reasonCode: result?.success === false ? 'auction-rejected' : decision?.reasonCode || 'auction-policy',
      candidateIds: candidates.map(candidate => candidate.id)
    });
    emitBotStatus(room, bot, 'chosen', trace);
    emitRoomState(room);
  }

  function bidOrPass(room, actor, shouldBid, minimum) {
    if (!shouldBid) return room.passAuction(actor);
    return room.placeAuctionBid(actor, minimum);
  }

  function auctionIdentity(auction) {
    if (!auction) return null;
    return `${auction.startedAt || 0}:${auction.propertyTile?.index ?? 'unknown'}`;
  }

  function sameAuction(auction, identity) {
    return Boolean(auction?.active && identity && auctionIdentity(auction) === identity);
  }

  // --- auction/disconnect timers -------------------------------------------

  function scheduleAuctionFinish(room) {
    const auction = room?.game.auction;
    if (!auction?.active || room.destroyed) return;
    const roomCode = room.roomCode;
    clearAuctionTimer(room);
    const endsAt = auction.endsAt || (now() + AUCTION_DURATION_MS);
    const delay = Math.max(0, endsAt - now());
    // Capture the auction object itself, not just the room code. A stale
    // callback that survives clearTimeout must never finish a newer auction in
    // the same room.
    const timer = setTimeoutFn(() => runRoomTimer('auction-finish', roomCode, () => finishAuctionIfStillActive(roomCode, auction)), delay);
    auctionTimers.set(roomCode, timer);
  }

  function finishAuctionIfStillActive(roomCode, expectedAuction) {
    const currentRoom = roomManager.getRoom(roomCode);
    if (!currentRoom?.game.auction?.active || (expectedAuction && currentRoom.game.auction !== expectedAuction)) {
      // Do not clear a timer for a newer auction when an older callback fires.
      if (currentRoom?.game.auction && expectedAuction && currentRoom.game.auction !== expectedAuction) return;
      clearAuctionTimer({ roomCode });
      return;
    }
    currentRoom.game.finishAuction();
    emitRoomState(currentRoom);
    io.in(roomCode).emit('system-message', { text: 'Auction ended.' });
    clearAuctionTimer(currentRoom);
  }

  function scheduleDisconnect(room, socketId, disconnectedPlayer = null) {
    if (!room) return;
    const player = disconnectedPlayer || room.getPlayerBySocket(socketId);
    if (!player) return;
    clearDisconnectTimer(player.clientId);
    clearInactivityTimer(room, player.id);
    const deadline = now() + disconnectGraceMs;
    player.disconnected = true;
    player.socketId = null;
    player.disconnectDeadline = deadline;
    const timer = { room, player, clientId: player.clientId, socketId, deadline, handle: null };
    disconnectTimers.set(player.clientId, timer);
    scheduleDisconnectExpiry(timer);
  }

  function scheduleDisconnectExpiry(timer) {
    timer.handle = setTimeoutFn(() => runRoomTimer('disconnect-expiry', timer.room.roomCode, () => expireDisconnectedSeat(timer)), Math.max(0, timer.deadline - now()));
  }

  function expireDisconnectedSeat(timer) {
    if (disconnectTimers.get(timer.clientId) !== timer) return false;
    const currentRoom = roomManager.getRoom(timer.room.roomCode);
    const currentPlayer = currentRoom === timer.room ? currentRoom.game.getPlayerByClient(timer.clientId) : null;
    if (currentRoom !== timer.room
      || currentPlayer !== timer.player
      || currentPlayer.socketId !== null
      || !currentPlayer.disconnected
      || Number(currentPlayer.disconnectDeadline) !== timer.deadline) {
      // The seat may have been pruned synchronously before this callback ran.
      // Remove only this exact timer registration; a newer reconnect/disconnect
      // cycle for the same client id owns a different timer object.
      disconnectTimers.delete(timer.clientId);
      return false;
    }
    const remaining = timer.deadline - now();
    if (remaining > 0) {
      scheduleDisconnectExpiry(timer);
      return false;
    }

    disconnectTimers.delete(timer.clientId);
    if (roomManager.getRoomBySocket(timer.socketId) === currentRoom) {
      roomManager.socketRoom.delete(timer.socketId);
    }
    return removeSeatForReason(currentRoom, currentPlayer, 'disconnect', false);
  }

  function revokeAuctionLeadIfLeader(room, player, reason = 'disconnect') {
    const auction = room.game.auction;
    if (!auction?.active) return;
    if (auction.highestBidderId !== player.id) return;
    auction.highestBidderId = null;
    auction.highestBid = 0;
    const message = reason === 'disconnect'
      ? 'The highest bidder disconnected. The bid is reset.'
      : `${player.nickname} left the room. The highest bid is reset.`;
    io.in(room.roomCode).emit('system-message', { text: message });
    scheduleAuctionFinish(room);
  }

  function obligationInvolvesPlayer(obligation, playerId) {
    if (obligation?.fromPlayerId === playerId) return true;
    return obligation?.toPlayerId === playerId;
  }

  function clearPendingObligations(room, game, player, reason) {
    const context = { room, game, player, reason };
    CANCELLED_OBLIGATIONS.forEach(obligation => cancelObligation(context, obligation));
    game.removeQueuedPaymentsForPlayer?.(player.id);
    if (game.clearSponsoredPurchaseForPlayer?.(player.id)) {
      io.in(room.roomCode).emit('sponsorship-update', { sponsorship: game.summarySponsoredPurchase() });
      io.in(room.roomCode).emit('system-message', { text: `${player.nickname}'s sponsorship reservation was released.` });
    }
  }

  function cancelObligation(context, obligation) {
    const game = context.game;
    const pending = game[obligation.key];
    if (!obligationInvolvesPlayer(pending, context.player.id)) return;
    game[obligation.key] = null;
    const text = `A pending ${obligation.label} was cancelled due to ${context.reason}.`;
    io.in(context.room.roomCode).emit('system-message', { text });
  }

  // --- background intervals --------------------------------------------------

  function emptyRoomGcTick() {
    const now = Date.now();
    for (const [roomCode, room] of roomManager.rooms.entries()) {
      garbageCollectRoom(room, roomCode, now);
    }
  }

  function garbageCollectRoom(room, roomCode, now) {
    // Bots and ghost seats must not keep a room alive (audit finding 14).
    if (room.hasConnectedHumans()) {
      room.emptySince = null;
      return;
    }
    if (!room.emptySince) {
      room.emptySince = now;
      return;
    }
    if (now - room.emptySince <= EMPTY_ROOM_GRACE_PERIOD_MS) return;
    console.log(`Garbage collecting empty room: ${roomCode}`);
    destroyRoom(room);
    scheduleRoomsUpdated();
  }

  // --- invite / contract-cancel flows ----------------------------------------

  // Accept-branch of respond-room-invite: gate order, seat transfer, and ack
  // shape are pinned by server/rooms.test.js. Returns the ack payload so the
  // handler stays a validate -> delegate -> respond flow.
  function acceptRoomInvite(socket, account, invite, payload) {
    if (!invite) return { success: false, error: 'That room invite has expired.' };
    if (String(payload?.inviteId || '') !== String(invite.id || '')) return { success: false, error: 'That room invite is no longer valid.' };
    const expiresAt = Date.parse(invite.expiresAt || '');
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      // Mark the stale record before doing any seat mutation. Previously an
      // invite that expired between lookup and acceptance could still join a
      // room even though the response returned an expiry error.
      socialStore.respondInvite(account.id, invite.id, true);
      return { success: false, error: 'That room invite has expired.' };
    }
    const room = invite.roomId
      ? roomManager.getRoomByPublicId(invite.roomId)
      : roomManager.getRoom(invite.roomCode);
    if (!room) return { success: false, error: 'That room no longer exists.' };
    if (invite.roomId && room.publicId !== invite.roomId) return { success: false, error: 'That room invite is no longer valid.' };
    if (room.game.started) return { success: false, error: 'That round has already started.' };
    const clientId = normalizeClientId(payload.clientId);
    if (!clientId) return { success: false, error: 'A client session is required to join.' };
    if (!room.game.canJoin()) return { success: false, error: 'That room is full.' };
    return joinRoomViaInvite(socket, account, room, payload);
  }

  function joinRoomViaInvite(socket, account, room, payload) {
    const clientId = normalizeClientId(payload.clientId);
    const existing = room.game.getPlayerByClient(clientId);
    if (existing?.socketId && existing.socketId !== socket.id && !existing.disconnected) {
      return { success: false, error: 'That seat is already in use.' };
    }
    const addedNewSeat = !existing;
    const previousSeat = existing ? {
      clientId: existing.clientId,
      socketId: existing.socketId,
      disconnected: existing.disconnected,
      disconnectDeadline: existing.disconnectDeadline,
      nickname: existing.nickname,
      color: existing.color,
      avatarGrid: existing.avatarGrid,
      accountId: existing.accountId
    } : null;
    const joined = room.addOrReconnectPlayer({
      clientId,
      socketId: socket.id,
      nickname: account.displayName,
      color: account.color,
      avatarGrid: normalizeAvatarGrid(account.avatarGrid),
      accountId: account.id
    });
    if (!joined.success) return { success: false, error: joined.error };
    // Validate and consume the invite while the source room is still intact.
    // If the record was concurrently declined/expired, roll back only the
    // staged target seat and leave the source socket untouched.
    const result = socialStore.respondInvite(account.id, payload.inviteId, true);
    if (!result.success) {
      if (addedNewSeat) room.game.removePlayerByClient(clientId);
      else Object.assign(existing, previousSeat);
      return result;
    }
    detachSocketFromOtherRoom(socket, room);
    leaveAllGameRooms(socket);
    clearDisconnectTimer(clientId);
    roomManager.socketRoom.set(socket.id, room);
    socket.join(room.roomCode);
    social.emitSocialUpdate(account.id);
    emitRoomState(room);
    io.in(room.roomCode).emit('system-message', { text: account.displayName + ' joined from a room invite.' });
    emitPendingInteractions(room, socket, joined.player);
    return { ...result, roomId: room.publicId, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility };
  }

  function contractCancelKey(socket, payload) {
    const requestId = String(payload?.requestId || '').trim().slice(0, 100);
    if (!requestId) return null;
    return `${socket.id}:cancel:${requestId}`;
  }

  function cachedContractCancel(room, socket, payload) {
    const key = contractCancelKey(socket, payload);
    if (!key) return null;
    if (!room.game.contractTransactions?.has(key)) return null;
    return room.game.contractTransactions.get(key);
  }

  function cacheContractCancel(room, socket, payload, result) {
    const key = contractCancelKey(socket, payload);
    if (key) room.game.contractTransactions.set(key, result);
  }

  function maintenanceSnapshot() {
    return maintenance?.snapshot?.() || {
      mode: 'normal',
      message: '',
      releaseId: '',
      drainDeadline: null,
      activeRounds: 0,
    };
  }

  // --- socket disconnect (registered per socket by the connection wiring) ----

  function handleSocketDisconnect(socket) {
    social.chatLastSent.delete(socket.id);
    forgetPatrolRuns(socket.id);
    const room = roomManager.getRoomBySocket(socket.id);
    const player = room?.getPlayerBySocket(socket.id) || null;
    roomManager.disconnectPlayer(socket.id);
    if (room && player) {
      scheduleDisconnect(room, socket.id, player);
      reassignHostIfNeeded(room, player.id);
      emitRoomState(room);
    }
    console.log('Socket disconnected:', socket.id);
  }

  function forgetPatrolRuns(socketId) {
    social.patrolRuns.forEach((run, token) => {
      if (run.socketId === socketId) social.patrolRuns.delete(token);
    });
  }

  const runtime = {
    acceptRoomInvite,
    accountFromPayload,
    accountStore,
    authoritativeStore,
    achievementStore,
    cachedContractCancel,
    cacheContractCancel,
    clearDisconnectTimer,
    destroyRoom,
    detachSocketFromOtherRoom,
    getRoomForSocket,
    handleSocketDisconnect,
    io,
    leaveAllGameRooms,
    matchStore,
    metrics,
    maintenance,
    pubsubAdapter,
    maintenanceSnapshot,
    canCreateRoom: () => maintenance?.canCreateRoom?.() ?? true,
    canStartRound: () => maintenance?.canStartRound?.() ?? true,
    botProviderStatus,
    unsubscribeBotProviderStatus,
    seasonStore,
    cosmeticStore,
    telemetryStore,
    reassignHostIfNeeded,
    roomManager,
    scheduleAuctionFinish,
    scheduleBotAuction,
    scheduleBotTurn,
    scheduleRoomsUpdated,
    social,
    socialStore,
    emitPendingInteractions,
    emitRoomState,
    setPlayerPresence,
    startRoomVoteKick,
    castRoomVoteKick
  };

  roomManager.setRoomDestroyer?.(destroyRoom);
  setIntervalFn(() => runRoomTimer('empty-room-gc', '*', emptyRoomGcTick), EMPTY_ROOM_GC_INTERVAL_MS);

  return runtime;
}

export { createRuntime };
