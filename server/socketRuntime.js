// The shared runtime every socket domain registers against: room state broadcast, the bot, auction, disconnect and inactivity timers,
// the empty-room garbage collector, seat detach and host reassignment, and the invite and cancel flows two domains share. One
// createRuntime() per process: server.js builds the stores and io, then hands them here. Pinned by server/rooms.test.js and server/server.test.js.
import { AUCTION_DURATION_MS } from './gameLogic.js';
import { ensureRoomHost } from './rooms.js';
import { botPersonaStore } from './botPersonaStore.js';
import { normalizeAvatarGrid, normalizeClientId, normalizeChatText, buildMatchRecordOptions } from './roomSetup.js';
import { createRoomPresenceRuntime } from './roomPresenceRuntime.js';
import { createRoomVoteKickRuntime } from './roomVoteKickRuntime.js';
import { normalizeRequestId } from './requestId.js';
import { isAdminAccount } from './analyticsApi.js';
import {
  selectBotTurnTarget,
  botMayStillAct,
  runBotTurn,
  resolvePurchaseOffer,
  isAuctionBotParticipant,
  decideBotAuction
} from './botLogic.js';
import { buildBotStrategicContext, BOT_RULE_VERSION } from './botStrategicContext.js';
import { contractResponderId } from './contractLogic.js';
import { SPONSORSHIP_HUMAN_WINDOW_MS } from './sponsorshipLogic.js';
import { playerFinanceEnabled } from './financeRules.js';
import { getRoomForSocket as resolveRoomOrAck } from './socketHandlerSupport.js';
import { botMovementSettleDelayMs, scheduleBotTimer } from './botTiming.js';
import { presentationRemainingMs } from '../public/gamePresentationTiming.js';

const DEFAULT_RECONNECT_GRACE_MS = 120000;
const configuredTestReconnectGrace = Number(process.env.POORUP_TEST_RECONNECT_GRACE_MS);
const DISCONNECT_GRACE_MS = process.env.NODE_ENV === 'test'
  && Number.isFinite(configuredTestReconnectGrace)
  && configuredTestReconnectGrace > 0
  ? Math.min(DEFAULT_RECONNECT_GRACE_MS, Math.floor(configuredTestReconnectGrace))
  : DEFAULT_RECONNECT_GRACE_MS;
const EMPTY_ROOM_GC_INTERVAL_MS = 60 * 1000;
const TRADE_OFFER_TTL_MS = 120 * 1000;
const TRADE_EXPIRY_SWEEP_INTERVAL_MS = 5 * 1000;
const AUCTION_WATCHDOG_INTERVAL_MS = 1000;
// How often silent turn holders are checked for idleness. The idle
// threshold itself is PLAYER_INACTIVITY_REMOVAL_MS.
const IDLE_SEAT_SWEEP_INTERVAL_MS = 5000;
const EMPTY_ROOM_GRACE_PERIOD_MS = 10 * 60 * 1000;
const ROOMS_UPDATED_DEBOUNCE_MS = 750;
// Outer bound on one bot decision. The advisor's own timeout covers its request
// and body; this watchdog only frees the turn lock if a decision never settles.
const BOT_DECISION_WATCHDOG_MS = 15 * 1000;
const BOT_DECISION_WATCHDOG_MARGIN_MS = 5 * 1000;

// Grace timers belong to one room's seat. The same clientId may hold a seat in
// another room, so the registry key must name the room too.
function disconnectTimerKey(roomCode, clientId) {
  return `${roomCode}\u0000${clientId}`;
}

// Obligations that gate the whole table must die with a departing or
// AFK seat, or the remaining players wait forever on a ghost.
const CANCELLED_OBLIGATIONS = [
  { key: 'pendingTrade', label: 'trade' },
  { key: 'pendingPlayerContract', label: 'player contract' }
];

// Table talk from a bot is player text, so it takes the same cleaning as a
// human message before it reaches the room. Text that is empty after cleaning
// is not sent.
export function botChatPayload(bot, botChat) {
  const text = normalizeChatText(botChat);
  if (!text) return null;
  return { text, nickname: bot.nickname, senderId: bot.id, bot: true };
}

// Thrown by the guarded advisor when its answer arrives after the decision lost its lock or its room; the turn ends quietly.
// Thrown to abandon a decision the table has moved past. advisorLogic.chooseActionSafely passes anything marked `stale` straight
// through instead of treating it as an advisor failure.
class StaleBotDecision extends Error { stale = true; }

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
function pendingCreditor(game, pending) {
  if (!pending.creditorId) return null;
  return game.getPlayerById?.(pending.creditorId);
}

function debtModeEnabled(game) {
  if (game.settings?.bankruptMode !== 'debt') return false;
  return typeof game.handleDebtBankruptcy === 'function';
}

function applyPendingBankruptcy(game, player, pending) {
  const creditor = pendingCreditor(game, pending);
  if (debtModeEnabled(game)) {
    return game.handleDebtBankruptcy(player, creditor)?.success !== false;
  }
  if (typeof game.handleBankruptcy === 'function') {
    return game.handleBankruptcy(player, creditor)?.success !== false;
  }
  return false;
}

export function settleAfkPayment(game, player) {
  const pending = game?.pendingPayment;
  if (!pending) return false;
  if (pending.playerId !== player?.id) return false;
  const covers = Number(player.cash) >= Math.max(0, Number(pending.amountRemaining) || 0);
  // A debtor that can cover pays the debt and is then removed; only a debtor
  // that cannot cover goes through bankruptcy and hands over its estate.
  if (covers) return Boolean(game.collectPendingPayment?.(player));
  return applyPendingBankruptcy(game, player, pending);
}

function preparePendingPurchasePass(game, player) {
  const offer = game?.pendingPurchaseOffer;
  if (!offer || offer.playerId !== player?.id) return { resolved: false, tile: null };
  const tile = game.getTile?.(offer.tileIndex);
  game.cancelSponsoredPurchase?.();
  game.pendingPurchaseOffer = null;
  return { resolved: true, tile };
}

function startAuctionForDepartingPlayer(game, player, tile) {
  if (!canAuctionPassedPurchase(game, tile)) return false;
  const startingPlayerId = nextAuctionStarter(game, player.id);
  if (!startingPlayerId) return false;
  game.startAuction?.(tile, startingPlayerId);
  const auction = game.auction;
  if (!auction?.active) return false;
  excludeDepartingAuctionSeat(auction, player, startingPlayerId);
  return true;
}

function excludeDepartingAuctionSeat(auction, player, startingPlayerId) {
  auction.participants = [...new Set((auction.participants || []).filter(id => id !== player.id))];
  if (auction.startingPlayerId === player.id) auction.startingPlayerId = startingPlayerId;
}

function passPendingPurchaseForSeatRemoval(game, player) {
  const pending = preparePendingPurchasePass(game, player);
  if (!pending.resolved) return { resolved: false, auctionStarted: false };
  const auctionStarted = startAuctionForDepartingPlayer(game, player, pending.tile);
  const propertyName = auctionStarted ? pending.tile.name : null;
  reportPassedPurchase(game, player, propertyName);
  return { resolved: true, auctionStarted };
}

function canAuctionPassedPurchase(game, tile) {
  if (!tile) return false;
  if (tile.ownerId !== null) return false;
  return Boolean(game.settings?.auction);
}

function reportPassedPurchase(game, player, propertyName = null) {
  const copy = propertyName
    ? `${player.nickname} passed on ${propertyName} before leaving.`
    : `${player.nickname} passed on the property before leaving.`;
  game.feedMessage?.(copy);
  return { resolved: true, auctionStarted: false };
}

function isEligibleAuctionStarter(candidate, departingPlayerId) {
  if (!candidate) return false;
  if (candidate.id === departingPlayerId) return false;
  if (candidate.bankrupt) return false;
  return !candidate.disconnected;
}

function nextAuctionStarter(game, departingPlayerId) {
  const playersById = new Map((game.players || []).map(player => [player.id, player]));
  const order = Array.isArray(game.turnOrder) ? game.turnOrder : (game.players || []).map(player => player.id);
  const oldIndex = order.indexOf(departingPlayerId);
  for (let offset = 1; offset <= order.length; offset += 1) {
    const index = oldIndex < 0 ? offset - 1 : (oldIndex + offset) % order.length;
    const candidate = playersById.get(order[index]);
    if (isEligibleAuctionStarter(candidate, departingPlayerId)) return candidate.id;
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
    ...(Number.isFinite(Number(matchRecord.durationSeconds)) ? { durationSeconds: Math.max(0, Math.floor(Number(matchRecord.durationSeconds))) } : {}),
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

// A deterministic answer is flagged `fallback` even when the room chose house
// policy on purpose (no-AI rooms, auction/phase rules). Those are not failures
// of the model, so they never count toward the fallback rate.
const BY_DESIGN_HOUSE_REASONS = new Set(['no-ai-mode', 'auction-policy', 'phase-resolution', 'deterministic-advisor', 'shadow-mode', 'deterministic']);

// Which engine a bot decision belongs to, from the room's brain setting:
//   aiRouted   the room asked for AI (botMode 'ai', provider 'ai') or not
//              (botMode 'no-ai', provider 'deterministic'). One match therefore
//              lands in exactly one bot group, so per-group match counts add up.
//   counted    adds to `decisions`: every house decision in a no-AI room, and
//              only the decisions the model was actually asked in an AI room.
//   failed     the model was asked and the house engine answered instead.
export function classifyBotDecision(decision = {}) {
  const brain = decision.brain === 'no-ai' || decision.brain === 'ai' ? decision.brain : null;
  const botMode = decision.botMode || brain || (decision.provider === 'ai' ? 'ai' : 'no-ai');
  const aiRouted = botMode === 'ai';
  const answeredByModel = decision.provider === 'ai';
  const askedModel = aiRouted && (answeredByModel || (decision.fallback === true && !BY_DESIGN_HOUSE_REASONS.has(String(decision.fallbackReason || ''))));
  return {
    botMode,
    provider: aiRouted ? 'ai' : 'deterministic',
    counted: aiRouted ? askedModel : true,
    failed: askedModel && !answeredByModel
  };
}

// The live counterpart of the rollup's fallback rate: one increment per decision the model was asked and the house engine answered
// instead, classified as the rollup does so deliberate house policy never counts. Called once per recorded decision trace;
// metrics must never affect a bot's turn.
export function noteBotFallback(metrics, decision) {
  if (!classifyBotDecision(decision).failed) return false;
  try { metrics?.incrementMetric?.('bot-fallbacks', { scope: 'ai' }); } catch { /* best effort */ }
  return true;
}

export function recordBotTelemetry(context) {
  const { telemetryStore, matchRecord, telemetryVersions } = context;
  const botOnly = matchRecord.botOnly === true || (Array.isArray(matchRecord.participants) && matchRecord.participants.length > 0 && matchRecord.participants.every(participant => !participant.accountId));
  const seenGroups = new Set();
  (matchRecord.botDecisions || []).slice(-200).forEach(decision => {
    const routing = classifyBotDecision(decision);
    const group = `${routing.botMode}|${routing.provider}`;
    const firstOfMatch = !seenGroups.has(group);
    seenGroups.add(group);
    telemetryStore?.record('bot-outcome', {
      provider: routing.provider,
      botMode: routing.botMode,
      botOnly,
      fallback: routing.failed,
      success: decision.success,
      phase: decision.phase,
      actionId: decision.actionId,
      decisions: routing.counted ? 1 : 0,
      ...(firstOfMatch ? { match: true } : {})
    }, telemetryVersions);
  });
}

export function recordMatchStartTelemetry({ telemetryStore, room, telemetryVersions = {} } = {}) {
  const marker = room?.game?.startedAt || true;
  if (!telemetryStore || !room?.game?.started || room.analyticsMatchStartRecorded === marker) return false;
  const result = telemetryStore.record('match-start', { roundNumber: Math.max(0, Math.floor(Number(room.game.roundNumber) || 0)) }, telemetryVersions);
  if (result?.recorded) { room.analyticsMatchStartRecorded = marker; return true; }
  return false;
}

function stalledTelemetryMarker(room) {
  if (!room?.game?.started) return null;
  return room.game.startedAt || true;
}

function recordStalledOnce({ telemetryStore, room, marker, reasonCode, telemetryVersions }) {
  const payload = {
    roundNumber: Math.max(0, Math.floor(Number(room.game.roundNumber) || 0)),
    reasonCode: String(reasonCode || 'unknown').slice(0, 80)
  };
  const result = telemetryStore.record('match-stalled', payload, telemetryVersions);
  if (result?.recorded) { room.analyticsMatchStalledRecorded = marker; return true; }
  return false;
}

export function recordMatchStalledTelemetry({ telemetryStore, room, telemetryVersions = {}, reasonCode = 'room-ended-without-settlement' } = {}) {
  if (!telemetryStore) return false;
  const marker = stalledTelemetryMarker(room);
  if (!marker) return false;
  if (room.analyticsMatchStalledRecorded === marker) return false;
  return recordStalledOnce({ telemetryStore, room, marker, reasonCode, telemetryVersions });
}

const ROOM_TELEMETRY_VERSION_READERS = [
  ['seasonId', room => room?.game?.seasonId || room?.seasonId],
  ['rulesetRevision', room => room?.ruleset?.rulesetRevision || room?.settings?.rulesetRevision],
  ['balanceRevision', room => room?.ruleset?.balanceRevision || room?.settings?.balanceRevision],
  ['boardVariant', room => room?.ruleset?.boardVariant || room?.settings?.boardVariant],
  ['marketComplexity', readRoomMarketComplexity]
];

function readRoomMarketComplexity(room) {
  return room?.ruleset?.effectiveSettings?.marketComplexity || room?.settings?.marketComplexity;
}

function roomTelemetryVersions(room) {
  return Object.fromEntries(ROOM_TELEMETRY_VERSION_READERS.map(([key, read]) => [key, read(room)]));
}

function settlementTelemetryMatchId(matchRecord, room) {
  const matchId = String(matchRecord?.matchId || '').trim();
  if (!matchId) return false;
  if (room?.analyticsTelemetryMatchId === matchId) return true;
  if (room) room.analyticsTelemetryMatchId = matchId;
  return false;
}

function settlementTelemetryVersions(matchRecord, room) {
  return {
    rulesetRevision: matchRecord.rulesetRevision,
    balanceRevision: matchRecord.balanceRevision,
    boardVariant: matchRecord.boardVariant,
    // The match-start row of the same match carries the market complexity, so
    // the settlement rows carry it too: without it a non-basic match is split
    // over two rollup rows.
    marketComplexity: matchRecord.marketComplexity || readRoomMarketComplexity(room)
  };
}

function recordSettlementTelemetryRows(telemetryContext) {
  recordMatchStartTelemetry(telemetryContext);
  recordMatchTelemetry(telemetryContext);
  recordLoggedTelemetry(telemetryContext);
  recordMarketTelemetry(telemetryContext);
  recordBankruptcyTelemetry(telemetryContext);
  recordAchievementTelemetry(telemetryContext);
  recordBotTelemetry(telemetryContext);
}

export function recordMatchTelemetryOnce(context) {
  const { telemetryStore, room, matchRecord, candidates } = context;
  if (settlementTelemetryMatchId(matchRecord, room)) return false;
  recordSettlementTelemetryRows({
    telemetryStore,
    room,
    matchRecord,
    candidates,
    telemetryVersions: settlementTelemetryVersions(matchRecord, room)
  });
  return true;
}

export function reassignHostIfNeeded(room, departedPlayerId) {
  if (!room) return;
  if (room.hostId !== departedPlayerId) return;
  ensureRoomHost(room, departedPlayerId);
}

// Keep provider credentials, billing/quota details, and raw error text out
// of the room-wide event. The private match trace retains the exact reason.
const PUBLIC_FALLBACK_REASONS = new Map([
  ['no-ai-mode', 'no-ai-mode'],
  ['auction-policy', 'house-policy'],
  ['phase-resolution', 'house-policy'],
  ['deterministic-advisor', 'house-policy'],
  ['quota', 'credits-exhausted'],
  ['quota-exhausted', 'credits-exhausted'],
  ['game-budget', 'game-budget'],
  ['process-budget', 'process-budget'],
  ['circuit-open', 'provider-cooldown'],
  ['rate-limit', 'provider-cooldown']
]);

function createRuntime(deps) {
  const { io, roomManager, accountStore, socialStore, matchStore, achievementStore, telemetryStore, botAdvisor, social, maintenance, maintenanceAccess, metrics, authoritativeStore, pubsubAdapter } = deps;
  const setTimeoutFn = deps.setTimeout || globalThis.setTimeout;
  const clearTimeoutFn = deps.clearTimeout || globalThis.clearTimeout;
  const setIntervalFn = deps.setInterval || globalThis.setInterval;
  const clearIntervalFn = deps.clearInterval || globalThis.clearInterval;
  const now = deps.now || (() => Date.now());
  const configuredDisconnectGrace = Number(deps.disconnectGraceMs);
  const disconnectGraceMs = Number.isFinite(configuredDisconnectGrace) && configuredDisconnectGrace > 0
    ? Math.max(1, Math.floor(configuredDisconnectGrace))
    : DISCONNECT_GRACE_MS;
  const auctionTimers = new Map();
  const disconnectTimers = new Map();
  const botTimers = new Map();
  // Room code: the token of the decision that owns the lock.
  const botDecisionLocks = new Map();
  // Room code: the watchdog timer of the decision that holds the lock, so a
  // room teardown can stop it.
  const botDecisionWatchdogs = new Map();
  // Room code: the one-shot re-check of a bot buyer's open sponsorship.
  const sponsorshipRechecks = new Map();
  // Auction decisions belong to a specific bot AND auction instance. A room-wide
  // lock serialized remote AI calls, letting one 4s request starve other bots
  // during the 5s bid window.
  const auctionBotTimers = new Map();
  const auctionDecisionLocks = new Set();
  const auctionEvaluations = new Map();
  const auctionIds = new WeakMap();
  let nextAuctionId = 0;

  function auctionBotKey(roomCode, auction, botId) {
    if (!auctionIds.has(auction)) auctionIds.set(auction, ++nextAuctionId);
    return `${roomCode}:${auctionIds.get(auction)}:${botId}`;
  }

  function clearBotAuctionTimersForRoom(roomCode) {
    for (const [botKey, timer] of auctionBotTimers) {
      if (!botKey.startsWith(`${roomCode}:`)) continue;
      clearTimeoutFn(timer);
      auctionBotTimers.delete(botKey);
    }
  }
  let roomsUpdatedTimer = null;

  function safeBotProviderStatus(status = {}) {
    const states = new Set(['healthy', 'unconfigured', 'quota-exhausted', 'cooldown']);
    const state = states.has(status.state) ? status.state : 'unconfigured';
    const reasons = new Set(['credits-exhausted', 'missing-credentials', 'provider-cooldown']);
    const reason = reasons.has(status.reason) ? status.reason : null;
    const revision = Number.isFinite(Number(status.revision)) ? Math.max(0, Math.floor(Number(status.revision))) : 0;
    return { state, revision, reason };
  }

  function legacyProviderHealth() {
    if (typeof botAdvisor?.getHealth !== 'function') return null;
    return botAdvisor.getHealth();
  }

  function legacyProviderReason(health) {
    if (health?.state === 'quota-exhausted') return 'credits-exhausted';
    if (health?.state === 'unconfigured') return 'missing-credentials';
    if (health?.state === 'open') return 'provider-cooldown';
    return null;
  }

  function botProviderStatus() {
    if (typeof botAdvisor?.getPublicStatus === 'function') return safeBotProviderStatus(botAdvisor.getPublicStatus());
    const health = legacyProviderHealth();
    return safeBotProviderStatus({ state: health?.state, reason: legacyProviderReason(health), revision: 0 });
  }

  const unsubscribeBotProviderStatus = typeof botAdvisor?.subscribeProviderStatus === 'function'
    ? botAdvisor.subscribeProviderStatus(status => io.emit('bot-provider-status', safeBotProviderStatus(status)))
    : null;

  function accountFromPayload(payload = {}) {
    return accountStore.sessionAccount(payload.sessionToken);
  }

  function getRoomForSocket(socket, callback) {
    const room = resolveRoomOrAck(runtime, socket, callback);
    if (room?.game) room.game.presentationClock = now;
    return room;
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

  function recordRoomActivityMetrics() {
    metrics?.setMetric('active-rooms', roomManager.rooms.size, { scope: 'all' });
    metrics?.setMetric('active-rounds', [...roomManager.rooms.values()].filter(candidate => candidate.game.started && !candidate.destroyed).length, { scope: 'all' });
  }

  function recordWinnerStatsOnce(room) {
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
  }

  function broadcastRoomStateSafely(room) {
    try {
      roomPresenceRuntime.synchronizeInactivityTimers(room);
      // Eliminations and departures reach the vote here, before the room
      // summary carries it to the table.
      roomVoteKickRuntime.reconcileRoomVoteKick(room);
      broadcastRoomState(room);
      scheduleBotTurn(room);
      scheduleBotAuction(room);
      armSponsorshipRecheck(room);
    } catch (error) {
      console.error('emitRoomState failed for room', room.roomCode, error);
    }
  }

  // The 30 s human window of a bot buyer's sponsorship request is judged against the wall clock, but nothing wakes the table when it ends.
  // The open request keeps the round from advancing, so re-emit once it has elapsed and the buyer bot can cancel or accept.
  function armSponsorshipRecheck(room) {
    const roomCode = room.roomCode;
    const sponsorship = room.game.pendingSponsoredPurchase;
    const existing = sponsorshipRechecks.get(roomCode);
    if (existing && existing.sponsorship === sponsorship) return;
    if (existing) {
      clearTimeoutFn(existing.handle);
      sponsorshipRechecks.delete(roomCode);
    }
    if (!sponsorship || !room.game.getPlayerById?.(sponsorship.buyerId)?.isBot) return;
    const createdAt = Number(sponsorship.createdAt);
    if (!Number.isFinite(createdAt)) return;
    const remaining = createdAt + SPONSORSHIP_HUMAN_WINDOW_MS - Date.now();
    // Once the window has passed, a still-open request is checked at a slow pace.
    const delay = remaining > 0 ? remaining + 250 : 5_000;
    const entry = { sponsorship, handle: null };
    entry.handle = setTimeoutFn(() => runRoomTimer('sponsorship-recheck', roomCode, () => {
      if (sponsorshipRechecks.get(roomCode) !== entry) return;
      sponsorshipRechecks.delete(roomCode);
      if (room.destroyed || room.game.pendingSponsoredPurchase !== sponsorship) return;
      emitRoomState(room);
    }), delay);
    sponsorshipRechecks.set(roomCode, entry);
  }

  function emitRoomState(room) {
    if (!room || room.destroyed) return;
    if (room.game?.started) recordMatchStartTelemetry({ telemetryStore, room, telemetryVersions: roomTelemetryVersions(room) });
    recordRoomActivityMetrics();
    recordWinnerStatsOnce(room);
    deliverBorrowerNotices(room);
    broadcastRoomStateSafely(room);
  }

  // Private notices the engine queues for a seat (a lender's exit cancelling the loan it funded). Each goes to the seat's own socket once;
  // a bot has no socket and reads the room feed instead. A seat not connected yet keeps its notice: the queue empties only for notices
  // that reached their seat, so a borrower who dropped does not lose the notice for good.
  function deliverBorrowerNotices(room) {
    const game = room.game;
    if (!game) return;
    if (!Array.isArray(game.borrowerNotices)) {
      (game.takeBorrowerNotices?.() || []).forEach(notice => { emitBorrowerNotice(game, notice); });
      return;
    }
    const pending = [];
    game.borrowerNotices.forEach(notice => {
      if (!emitBorrowerNotice(game, notice)) pending.push(notice);
    });
    game.borrowerNotices = pending;
  }

  // A notice is delivered when its seat has a live socket. A seat that is
  // still away keeps the notice in the queue; a seat that is gone (or a bot,
  // which reads the room feed) does not hold it.
  function emitBorrowerNotice(game, notice) {
    const seat = game.getPlayerById?.(notice.playerId);
    if (!seat) return true;
    if (seat.isBot) return true;
    const socket = io.sockets?.sockets?.get(seat.socketId);
    if (!socket) return false;
    try {
      socket.emit('system-message', { text: notice.text });
    } catch (error) {
      console.error('borrower notice failed for seat', notice.playerId, error);
      return false;
    }
    return true;
  }

  // Computer personas keep their own record. Accounts and rankings never see these games.
  function recordBotPersonaResults(room) {
    const winnerId = room.game.lastWinner.id;
    room.game.players.forEach(player => {
      if (player.isBot && player.personaId) botPersonaStore.recordGame(player.personaId, player.id === winnerId);
    });
  }

  // Computer personas keep their own unlocks. They are not announced and never reach account profiles or rankings.
  function recordBotPersonaAchievements(candidates) {
    candidates.forEach(candidate => {
      try {
        botPersonaStore.recordAchievement(candidate.personaId, candidate);
      } catch (error) {
        console.error('Persona achievement settlement failed:', error?.message || 'unknown error');
      }
    });
  }

  // Treasure cards and headlines are kept across games, so rules that count them can be reached by a persona too.
  function recordBotPersonaHistory(matchRecord) {
    (matchRecord?.participants || []).forEach(participant => {
      if (!participant.personaId) return;
      botPersonaStore.recordHistory(participant.personaId, {
        treasureCards: participant.treasureCardsSeenList || [],
        events: matchRecord.globalEvents || [],
      });
    });
  }

  function recordRoomStats(room) {
    recordBotPersonaResults(room);
    const matchRecord = accountStore.recordGameResults(room.game.players, room.game.lastWinner.id, buildMatchRecordOptions(room));
    const historyReader = accountId => accountStore.getMatchHistory(accountId);
    const allCandidates = achievementStore.evaluateMatch(matchRecord, historyReader, personaId => botPersonaStore.historyFor(personaId));
    recordBotPersonaAchievements(allCandidates.filter(candidate => !candidate.accountId && candidate.personaId));
    recordBotPersonaHistory(matchRecord);
    const candidates = allCandidates.filter(candidate => candidate.accountId);
    annotateMatchAchievements(matchRecord, candidates);
    // The account snapshot was written before achievement enrichment;
    // update that same match ID once so a restart sees the authoritative
    // annotated record without replaying match statistics.
    accountStore.updateMatchRecord?.(matchRecord);
    matchStore.record(matchRecord);
    // One candidate that fails must not cost the others their unlocks, the
    // match telemetry or the account sync.
    candidates.forEach(candidate => {
      try {
        social.recordVerifiedAchievement(candidate, matchRecord.matchId);
      } catch (error) {
        console.error('Achievement settlement failed:', error?.message || 'unknown error');
      }
    });
    recordMatchTelemetryOnce({ telemetryStore, room, matchRecord, candidates });
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
    // Game summaries carry owner-only loan and contract terms. Emit a
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
      canSeekSponsorship: playerFinanceEnabled(room.game)
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
    // The seat awaiting an answer, which after a counter is the lender.
    if (contractResponderId(contract) !== player.id) return;
    socket.emit('player-contract-offer', { contract });
  }

  // seat lifecycle

  // Leave any previous game rooms, so no ghost updates arrive.
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
    releaseLobbySeat(oldRoom, oldPlayer, socket.id);
  }

  function releaseLobbySeat(oldRoom, oldPlayer, socketId) {
    oldRoom.game.removePlayerBySocket(socketId);
    // Lobby hosts that leave must hand the room over, or Start stays dead.
    reassignHostIfNeeded(oldRoom, oldPlayer.id);
    // A lobby nobody is left in has no one to come back to it.
    if (typeof oldRoom.hasHumanSeats === 'function' && !oldRoom.hasHumanSeats()) {
      destroyRoom(oldRoom);
      scheduleRoomsUpdated();
      return;
    }
    emitRoomState(oldRoom);
  }

  // Every live seat this socket holds, whichever room it is mapped to: lobby
  // seats are removed, started-game seats enter their grace window. Used when
  // the socket creates a new room.
  function releaseSocketSeats(socket) {
    roomManager.liveSeatsOnSocket(socket.id).forEach(({ room, player }) => {
      if (room.game.started) detachStartedSeat(room, player);
      else releaseLobbySeat(room, player, socket.id);
    });
  }

  function detachStartedSeat(oldRoom, oldPlayer) {
    scheduleDisconnect(oldRoom, oldPlayer.socketId, oldPlayer);
    revokeAuctionLeadIfLeader(oldRoom, oldPlayer, 'disconnect');
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

  function resolveSeatObligations(room, player, reason) {
    const prepared = room.game.prepareCollateralForExit?.(player);
    if (prepared?.success === false) return prepared;
    if (room.game.pendingPayment?.playerId === player.id && !settleAfkPayment(room.game, player)) return { success: false };
    return resolveSeatExitObligations(room, player, reason);
  }

  // Shared by expiry and voluntary leave: a seat that leaves cancels the trade, contract and sponsorship it owns with the same announcement,
  // and auctions its pending purchase offer. Payment settlement stays with resolveSeatObligations, which only the expiry path runs.
  function resolveSeatExitObligations(room, player, reason) {
    const prepared = room.game.prepareCollateralForExit?.(player);
    if (prepared?.success === false) return prepared;
    clearPendingObligations(room, room.game, player, reason);
    revokeAuctionLeadIfLeader(room, player, reason);
    resolvePendingPurchaseForLeaving(room, player);
    return { success: true };
  }

  function resolvePendingPurchaseForLeaving(room, player) {
    if (room.game.pendingPurchaseOffer?.playerId !== player.id) return;
    const result = passPendingPurchaseForSeatRemoval(room.game, player);
    if (result.auctionStarted) scheduleAuctionFinish(room);
  }

  function seatRemovalMessage(player, reason) {
    if (reason === 'disconnect') return `${player.nickname} disconnected.`;
    if (reason === 'vote-kick') return `${player.nickname} was removed after the room vote-kick passed.`;
    return `${player.nickname} was removed for ${reason}.`;
  }

  function removeSeatForReason(room, player, reason, preventRejoin = false) {
    const prepared = resolveSeatObligations(room, player, reason);
    if (prepared?.success === false) return false;
    const socket = io.sockets?.sockets?.get(player.socketId);
    const message = seatRemovalMessage(player, reason);
    const removed = roomManager.removeRoomSeat({
      clientId: player.clientId,
      socketId: player.socketId,
      reason,
      preventRejoin,
      room,
    });
    if (!removed.success) return false;
    socket?.emit('system-message', { text: message });
    roomPresenceRuntime.clearPlayer(room, player.id);
    socket?.leave(room.roomCode);
    emitRoomState(room);
    if (reason !== 'vote-kick') io.in(room.roomCode).emit('system-message', { text: message });
    scheduleRoomsUpdated();
    return true;
  }

  const roomPresenceRuntime = createRoomPresenceRuntime({
    roomManager,
    runRoomTimer,
    setTimeoutFn,
    clearTimeoutFn,
    now,
    emitRoomState,
    removeSeatForReason,
  });

  const roomVoteKickRuntime = createRoomVoteKickRuntime({
    io,
    roomManager,
    runRoomTimer,
    setTimeoutFn,
    clearTimeoutFn,
    now,
    removeSeatForReason,
  });

  function dropDisconnectTimer(clientId, room) {
    if (!room) return null;
    const key = disconnectTimerKey(room.roomCode, clientId);
    const timer = disconnectTimers.get(key);
    if (!timer) return null;
    clearTimeoutFn(timer.handle);
    disconnectTimers.delete(key);
    return timer;
  }

  // The reconnect seam. A seat that lost its socket holds one disconnect timer, and every way back (restore-session, rejoin, create-room replay,
  // accepted invite) clears it once the seat is live, so a cleared timer on a live seat counts as one reconnect. Callers that clear it before attaching
  // the seat (the account-seat reclaim swaps the clientId first) say so with `reconnected`. Leaving and teardown never count.
  function clearDisconnectTimer(clientId, room, { reconnected = false } = {}) {
    const timer = dropDisconnectTimer(clientId, room);
    if (!timer) return;
    const seat = timer.player;
    if (seat && !seat.disconnected && seat.socketId) seat.disconnectedAt = 0;
    if (reconnected || (seat && !seat.disconnected && seat.socketId)) {
      try { metrics?.incrementMetric?.('room-reconnects', { scope: 'seat' }); } catch { /* best effort */ }
    }
  }

  function clearDisconnectTimersForRoom(room) {
    if (!room) return;
    room.game.players.forEach(player => {
      dropDisconnectTimer(player.clientId, room);
    });
  }

  // Shared teardown for rooms removed outside of the normal lifecycle (GC and
  // stale private-code reclaim): clears every timer keyed by this room and
  // drops it from the live map.
  function destroyRoom(room) {
    if (!room) return;
    const roomCode = room.roomCode;
    if (room.game?.started && !room.game?.lastWinner) recordMatchStalledTelemetry({ telemetryStore, room, telemetryVersions: roomTelemetryVersions(room) });
    // A match that ended but was never settled (the room was torn down before
    // its last broadcast) still owes the table a settlement.
    settleCompletedRoom(room);
    room.destroyed = true;
    clearAuctionTimer(room);
    roomPresenceRuntime.clearRoom(room);
    roomVoteKickRuntime.clearRoom(roomCode);
    clearDisconnectTimersForRoom(room);
    clearBotAuctionTimersForRoom(roomCode);
    clearTimeoutFn(botTimers.get(roomCode));
    botTimers.delete(roomCode);
    botDecisionLocks.delete(roomCode);
    clearTimeoutFn(botDecisionWatchdogs.get(roomCode));
    botDecisionWatchdogs.delete(roomCode);
    clearTimeoutFn(sponsorshipRechecks.get(roomCode)?.handle);
    sponsorshipRechecks.delete(roomCode);
    for (const botKey of auctionDecisionLocks) {
      if (botKey.startsWith(`${roomCode}:`)) auctionDecisionLocks.delete(botKey);
    }
    auctionEvaluations.delete(roomCode);
    // Drop the socket to room index for everyone still mapped to this room;
    // otherwise connected players keep acting on a zombie room that is gone
    // from the registry (getRoomBySocket would still resolve it).
    forgetSocketMappings(room);
    roomManager.rooms.delete(roomCode);
    recordRoomActivityMetrics();
  }

  function forgetSocketMappings(room) {
    for (const [socketId, mappedRoom] of roomManager.socketRoom.entries()) {
      if (mappedRoom === room) roomManager.socketRoom.delete(socketId);
    }
  }

  // A finished match that was never settled is settled once, here. A store
  // outage must not stop the room from being torn down.
  function settleCompletedRoom(room) {
    if (!room?.game?.lastWinner || room.statsRecorded) return false;
    try {
      recordRoomStats(room);
    } catch (error) {
      console.error('settlement failed for room', room.roomCode, error);
    }
    return true;
  }

  // bots

  function turnRoomReady(room) {
    if (!room?.game.started) return false;
    if (room.destroyed) return false;
    if (humanlessTable(room)) return false;
    // Auctions have their own participant timer. Keeping the ordinary turn
    // queue out of this phase prevents the current seat from issuing a
    // rejected pass/bid while a different bot is the auction participant.
    if (room.game.auction?.active) return false;
    return !botTurnPending(room);
  }

  // A started table whose last human seat is gone is dead: bots playing on, and
  // calling the paid advisor, would only burn budget until the empty-room GC
  // collects the room. (Room-shaped test doubles without the method are left alone.)
  function humanlessTable(room) {
    return typeof room.hasHumanSeats === 'function' && !room.hasHumanSeats();
  }

  function scheduleBotTurn(room, movementDelayMs = 0) {
    if (!turnRoomReady(room)) return;
    const bot = selectBotTurnTarget(room.game);
    if (!bot?.isBot) return;
    if (bot.bankrupt) return;
    if (bot.disconnected) return;
    const timer = scheduleBotTimer(
      setTimeoutFn,
      () => runRoomTimer('bot-turn', room.roomCode, () => beginBotTurn(room, bot)),
      'turn',
      Math.max(movementDelayMs, presentationRemainingMs(room.game, now()))
    );
    botTimers.set(room.roomCode, timer);
  }

  function botTurnPending(room) {
    if (botTimers.has(room.roomCode)) return true;
    return botDecisionLocks.has(room.roomCode);
  }

  function beginBotTurn(room, bot) {
    botTimers.delete(room.roomCode);
    // The timer was armed while a human was still seated: if the last one left since, the table is dead.
    if (humanlessTable(room)) return;
    const remaining = presentationRemainingMs(room.game, now());
    if (remaining > 0) return scheduleBotTurn(room, remaining);
    room.game.presentationClock = now;
    // The decision owns the lock through its token. The watchdog frees a lock
    // whose decision never settles (a stalled provider the advisor could not
    // abort); a stale completion then cannot free the lock a newer one holds.
    const token = {};
    botDecisionLocks.set(room.roomCode, token);
    const watchdog = setTimeoutFn(
      () => runRoomTimer('bot-decision-watchdog', room.roomCode, () => finishBotTurn(room, token)),
      botDecisionWatchdogMs()
    );
    botDecisionWatchdogs.set(room.roomCode, watchdog);
    const previousPositions = new Map(room.game.players.map(player => [player.id, player.position]));
    runBotDecision(room, bot, () => botDecisionLocks.get(room.roomCode) !== token)
      .catch(error => {
        if (error instanceof StaleBotDecision) return;
        // A failed bot decision must not escape the timer callback: an
        // uncaught error here would take the whole process down. The room
        // stays alive and the watchdog/next action retries naturally.
        console.error(`Bot turn failed in room ${room.roomCode}:`, error);
      })
      .finally(() => {
        clearTimeoutFn(watchdog);
        if (botDecisionWatchdogs.get(room.roomCode) === watchdog) botDecisionWatchdogs.delete(room.roomCode);
        finishBotTurn(room, token, botMovementSettleDelayMs(previousPositions, room.game, now()));
      });
  }

  function botDecisionWatchdogMs() {
    return Math.max(BOT_DECISION_WATCHDOG_MS, (Number(botAdvisor?.timeoutMs) || 0) + BOT_DECISION_WATCHDOG_MARGIN_MS);
  }

  function applyBotDecisionOutcome(room, bot, result) {
    if (result?.botDecision) {
      const trace = room.game.recordBotDecisionTrace(result.botDecision);
      noteBotFallback(metrics, trace);
      emitBotStatus(room, bot, 'chosen', trace);
    }
    if (result?.botChat) {
      const chat = botChatPayload(bot, result.botChat);
      if (chat) io.in(room.roomCode).emit('chat-message', chat);
    }
    if (result?.noEmit) return;
    // Tail purchase resolution, second half of the post-roll double-check.
    const outcome = presentationRemainingMs(room.game, now()) === 0 ? resolvePurchaseOffer(room, bot, result) : result;
    // A bot's declined or unaffordable landing opens an auction that nothing
    // else arms a finish timer for; with no bids it would never close.
    if (outcome?.auctionStarted) scheduleAuctionFinish(room);
    emitRoomState(room);
  }

  // A contract the bot just created (or countered) is pushed to its human
  // recipient, as a human's proposal is, so the offer is not silent.
  function notifyBotContractOffer(room, priorContract) {
    const contract = room.game.pendingPlayerContract;
    if (!contract || contract === priorContract) return;
    const recipient = room.game.getPlayerById(contractResponderId(contract));
    if (!recipient || recipient.isBot || !recipient.socketId) return;
    io.to(recipient.socketId).emit('player-contract-offer', { contract });
  }

  // A decision that went stale must not act on its late answer: the advisor
  // call throws as it returns, which ends the turn before any action runs.
  function abortableAdvisor(isStale) {
    if (!botAdvisor || typeof botAdvisor.chooseAction !== 'function') return botAdvisor;
    return new Proxy(botAdvisor, {
      get(target, property) {
        if (property === 'chooseAction') {
          return async (...args) => {
            const decision = await target.chooseAction(...args);
            if (isStale()) throw new StaleBotDecision();
            return decision;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  // A decision whose lock the watchdog released, whose room is gone, or whose match has ended must not act on a late answer: the
  // advisor call throws as it returns, ending the turn before any action runs. endGame leaves the room alive, so the finished match
  // is judged by the game itself.
  function botDecisionIsStale(room, lockLost) {
    return () => room.destroyed
      || lockLost()
      || !room.game?.started
      || Boolean(room.game?.lastWinner);
  }

  async function runBotDecision(room, bot, lockLost = () => false) {
    // Re-read live state: seats, pendings, and votes may have changed while
    // this timer was queued. The decision policy itself lives in
    // botLogic.js and is covered by server/botLogic.test.js.
    if (!botMayStillAct(room.game, bot)) return;
    if (room.destroyed) return;
    const decisionSequence = (room.game.botDecisionSequence || 0) + 1;
    emitBotStatus(room, bot, 'thinking', { decisionSequence });
    const priorContract = room.game.pendingPlayerContract;
    const isStale = botDecisionIsStale(room, lockLost);
    const result = await runBotTurn(room, bot, abortableAdvisor(isStale));
    if (isStale()) return;
    notifyBotContractOffer(room, priorContract);
    applyBotDecisionOutcome(room, bot, result);
  }

  function botStatusHealthState(health) {
    if (health?.state === 'healthy') return 'ready';
    return 'fallback';
  }

  function botStatusPayload(room, bot, state, details) {
    const health = typeof botAdvisor.getHealth === 'function' ? botAdvisor.getHealth() : null;
    return {
      playerId: bot.id,
      nickname: bot.nickname,
      state,
      brain: details.brain || room.settings.botBrain || 'auto',
      difficulty: details.difficulty || room.settings.botDifficulty || 'table',
      provider: details.provider === 'ai' ? 'ai' : 'deterministic',
      fallback: details.fallback === true,
      fallbackReason: publicBotFallbackReason(details.fallbackReason),
      actionId: details.actionId || null,
      decisionSequence: details.sequence || details.decisionSequence || null,
      latencyMs: details.latencyMs || 0,
      healthState: botStatusHealthState(health)
    };
  }

  function emitBotStatus(room, bot, state, details = {}) {
    io.in(room.roomCode).emit('bot-status', botStatusPayload(room, bot, state, details));
  }

  function publicBotFallbackReason(reason) {
    const key = String(reason || '').toLowerCase();
    if (!key) return null;
    return PUBLIC_FALLBACK_REASONS.get(key) || 'provider-unavailable';
  }

  function finishBotTurn(room, token, movementDelayMs = 0) {
    // Only the decision holding the lock may release it.
    if (botDecisionLocks.get(room.roomCode) !== token) return;
    botDecisionLocks.delete(room.roomCode);
    scheduleBotTurn(room, movementDelayMs);
    scheduleBotAuction(room);
  }

  function activeAuction(room) {
    if (!room) return null;
    if (room.destroyed) return null;
    const auction = room.game.auction;
    if (!auction?.active) return null;
    return auction;
  }

  function scheduleBotAuction(room) {
    const auction = activeAuction(room);
    if (!auction) return;
    if (humanlessTable(room)) return;
    const roomCode = room.roomCode;
    const evaluated = auctionEvaluations.get(roomCode) || new Map();
    auctionEvaluations.set(roomCode, evaluated);

    // Start every eligible bot's thinking timer independently. In particular,
    // a slow or waiting AI bot must not prevent a funded rival from bidding.
    for (const bot of room.game.players) {
      if (!isAuctionBotParticipant(auction, bot)) continue;
      if (evaluated.get(bot.id) === auctionIdentity(auction, bot)) continue;
      const botKey = auctionBotKey(roomCode, auction, bot.id);
      if (auctionBotTimers.has(botKey) || auctionDecisionLocks.has(botKey)) continue;
      const timer = scheduleBotTimer(
        setTimeoutFn,
        () => runRoomTimer('bot-auction', roomCode, () => {
          beginBotAuctionBid(room, bot, roomCode, botKey, auction).catch(error => {
            console.error(`Bot auction decision failed in room ${roomCode}:`, error);
          });
        }),
        'auction'
      );
      auctionBotTimers.set(botKey, timer);
    }
  }

  async function beginBotAuctionBid(room, bot, roomCode, botKey, expectedAuction) {
    auctionBotTimers.delete(botKey);
    if (auctionDecisionLocks.has(botKey)) return;
    auctionDecisionLocks.add(botKey);
    try {
      await beginBotAuctionBidUnlocked(room, bot, roomCode, expectedAuction);
    } finally {
      auctionDecisionLocks.delete(botKey);
      if (!room.destroyed) scheduleBotAuction(room);
    }
  }

  async function beginBotAuctionBidUnlocked(room, bot, key, expectedAuction) {
    if (room.game.auction !== expectedAuction || !expectedAuction.active) return;
    // Same guard as beginBotTurn: no paid advisor call for a table whose last human seat is gone.
    if (humanlessTable(room)) return;
    const auctionVersion = auctionIdentity(room.game.auction, bot);
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
      game: room.game,
      advisor: botAdvisor,
      context: { ...context, event: room.game.globalEvent }
    });
    if (room.destroyed || room.game.auction !== expectedAuction || !sameAuction(room.game.auction, auctionVersion, bot)) return;
    const { candidates, amount, decision } = choice;
    const actionId = choice.actionId;
    const shouldBid = actionId === 'auction:bid';
    const result = shouldBid ? room.runBotAction(bot.id, actor => room.placeAuctionBid(actor, amount)) : { success: true };
    // A bid that only collided with the bid cooldown was not a decision against
    // this state: leave the identity unevaluated so the re-arm in the caller
    // tries again once the cooldown has passed, and record nothing for it.
    if (shouldBid && result?.success === false && Number(room.game.auction?.cooldownUntil) > Date.now()) return;
    auctionEvaluations.get(key)?.set(bot.id, auctionVersion);
    if (shouldBid && result?.success) scheduleAuctionFinish(room);
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
    noteBotFallback(metrics, trace);
    emitBotStatus(room, bot, 'chosen', trace);
    emitRoomState(room);
  }

  function auctionIdentity(auction, bot) {
    if (!auction) return null;
    return JSON.stringify({
      startedAt: auction.startedAt || 0,
      tileIndex: auction.propertyTile?.index ?? null,
      highestBid: Number(auction.highestBid || 0),
      highestBidderId: auction.highestBidderId || null,
      participants: [...(auction.participants || [])],
      botId: bot?.id || null,
      botCash: Number(bot?.cash || 0),
      botBankrupt: bot?.bankrupt === true,
      botDisconnected: bot?.disconnected === true
    });
  }

  function sameAuction(auction, identity, bot) {
    return Boolean(auction?.active && identity && auctionIdentity(auction, bot) === identity);
  }

  // auction/disconnect timers

  function scheduleAuctionFinish(room) {
    const auction = room?.game.auction;
    if (!auction?.active || room.destroyed) return;
    const roomCode = room.roomCode;
    clearAuctionTimer(room);
    const currentTime = now();
    const presentationDeadline = currentTime + presentationRemainingMs(room.game, currentTime);
    const minimumVisibleWindowEnd = presentationDeadline + AUCTION_DURATION_MS;
    const endsAt = Math.max(Number(auction.endsAt) || 0, minimumVisibleWindowEnd);
    auction.endsAt = endsAt;
    const delay = Math.max(0, endsAt - now());
    // Capture the auction object itself, not just the room code. A stale
    // callback that survives clearTimeout must never finish a newer auction in
    // the same room.
    const timer = setTimeoutFn(() => {
      // The handle has fired, so it arms nothing. Left registered it
      // would make the watchdog skip the room even if this callback returns
      // early or throws before it clears the entry.
      if (auctionTimers.get(roomCode) === timer) auctionTimers.delete(roomCode);
      runRoomTimer('auction-finish', roomCode, () => finishAuctionIfStillActive(roomCode, auction));
    }, delay);
    auctionTimers.set(roomCode, timer);
  }

  function auctionFinishStatus(room, expectedAuction) {
    const auction = room?.game.auction;
    if (!auction?.active) return 'missing';
    if (expectedAuction && auction !== expectedAuction) return 'replaced';
    return 'active';
  }

  function finishAuctionIfStillActive(roomCode, expectedAuction) {
    const currentRoom = roomManager.getRoom(roomCode);
    const status = auctionFinishStatus(currentRoom, expectedAuction);
    // Do not clear a timer for a newer auction when an older callback fires.
    if (status === 'replaced') return;
    if (status === 'missing') {
      clearAuctionTimer({ roomCode });
      return;
    }
    const remaining = Number(expectedAuction?.endsAt) - now();
    if (Number.isFinite(remaining) && remaining > 0) {
      scheduleAuctionFinish(currentRoom);
      return;
    }
    currentRoom.game.finishAuction();
    auctionEvaluations.delete(roomCode);
    clearBotAuctionTimersForRoom(roomCode);
    emitRoomState(currentRoom);
    clearAuctionTimer(currentRoom);
  }

  // Safety net for any path that leaves an auction open with no finish armed:
  // once its window has passed, close it exactly as the timer would.
  function auctionWatchdogTick() {
    for (const [roomCode, room] of roomManager.rooms.entries()) {
      const auction = activeAuction(room);
      if (!auction || auctionTimers.has(roomCode)) continue;
      if (Number(auction.endsAt) > now()) continue;
      finishAuctionIfStillActive(roomCode, auction);
    }
  }

  function scheduleDisconnect(room, socketId, disconnectedPlayer = null) {
    if (!room) return;
    const player = disconnectedPlayer || room.getPlayerBySocket(socketId);
    if (!player) return;
    dropDisconnectTimer(player.clientId, room);
    roomPresenceRuntime.clearPlayer(room, player.id);
    const droppedAt = now();
    const deadline = droppedAt + disconnectGraceMs;
    player.disconnected = true;
    player.socketId = null;
    player.disconnectDeadline = deadline;
    // A lobby seat's grace restarts for ever, so the deadline cannot tell a
    // fresh drop from a ghost; the first drop time can.
    player.disconnectedAt = droppedAt;
    const key = disconnectTimerKey(room.roomCode, player.clientId);
    const timer = { room, player, clientId: player.clientId, key, socketId, deadline, handle: null };
    disconnectTimers.set(key, timer);
    scheduleDisconnectExpiry(timer);
  }

  function scheduleDisconnectExpiry(timer) {
    timer.handle = setTimeoutFn(() => runRoomTimer('disconnect-expiry', timer.room.roomCode, () => expireDisconnectedSeat(timer)), Math.max(0, timer.deadline - now()));
  }

  function expireDisconnectedSeat(timer) {
    if (disconnectTimers.get(timer.key) !== timer) return false;
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
      disconnectTimers.delete(timer.key);
      return false;
    }
    const remaining = timer.deadline - now();
    if (remaining > 0) {
      scheduleDisconnectExpiry(timer);
      return false;
    }

    if (!currentRoom.game.started) {
      // A lobby seat never times out on a dropped connection: the grace window
      // restarts, and the empty-room GC still reclaims a lobby nobody returns to.
      timer.deadline = now() + disconnectGraceMs;
      currentPlayer.disconnectDeadline = timer.deadline;
      scheduleDisconnectExpiry(timer);
      return false;
    }
    const removed = crownLoneSolventSeat(currentRoom, currentPlayer)
      || removeSeatForReason(currentRoom, currentPlayer, 'disconnect', false);
    if (!removed) {
      // A transactional settlement failure keeps the original seat/deadline
      // eligible for a bounded retry, rather than abandoning its expiry.
      timer.handle = setTimeoutFn(() => runRoomTimer('disconnect-expiry', timer.room.roomCode, () => expireDisconnectedSeat(timer)), 1_000);
      return false;
    }
    disconnectTimers.delete(timer.key);
    if (roomManager.getRoomBySocket(timer.socketId) === currentRoom) roomManager.socketRoom.delete(timer.socketId);
    return true;
  }

  // The last solvent seat keeps the table when its grace runs out: it is
  // crowned, not removed, so the winner stays on the seat list for the match
  // record. A seat that still owes a parked debt is removed as usual.
  function crownLoneSolventSeat(room, player) {
    const game = room.game;
    if (!game.started || player.bankrupt) return false;
    if (game.pendingPayment?.playerId === player.id) return false;
    if (game.nonBankruptPlayers().some(other => other !== player)) return false;
    game.endGame(player);
    ensureRoomHost(room);
    emitRoomState(room);
    return true;
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
    // Rivals bid against a lead that does not exist, so they get a fresh window.
    auction.endsAt = Math.max(Number(auction.endsAt) || 0, now() + AUCTION_DURATION_MS);
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

  // background intervals

  // createdAt is stamped with the wall clock in proposeTrade, so compare with it.
  function tradeExpirySweepTick() {
    const at = Date.now();
    for (const room of roomManager.rooms.values()) {
      if (!room.game?.started) continue;
      // An unanswered trade or player contract gates the whole table, so both lapse.
      const staleTrade = room.game.expireStaleTrade?.(at, TRADE_OFFER_TTL_MS);
      const staleContract = room.game.expireStaleContract?.(at, TRADE_OFFER_TTL_MS);
      if (staleTrade || staleContract) emitRoomState(room);
    }
  }

  function emptyRoomGcTick() {
    const current = now();
    for (const [roomCode, room] of roomManager.rooms.entries()) {
      garbageCollectRoom(room, roomCode, current);
    }
  }

  function garbageCollectRoom(room, roomCode, current) {
    // Bots and ghost seats must not keep a room alive.
    if (room.hasConnectedHumans()) {
      room.emptySince = null;
      return;
    }
    if (!room.emptySince) {
      room.emptySince = current;
      return;
    }
    if (current - room.emptySince <= EMPTY_ROOM_GRACE_PERIOD_MS) return;
    console.log(`Garbage collecting empty room: ${roomCode}`);
    destroyRoom(room);
    scheduleRoomsUpdated();
  }

  // invite / contract-cancel flows

  // Accept-branch of respond-room-invite: gate order, seat transfer, and ack
  // shape are pinned by server/rooms.test.js. Returns the ack payload so the
  // handler stays a validate, then delegate, then respond flow.
  function acceptRoomInvite(socket, account, invite, payload) {
    if (!invite) return { success: false, error: 'That room invite has expired.' };
    if (String(payload?.inviteId || '') !== String(invite.id || '')) return { success: false, error: 'That room invite is no longer valid.' };
    const expiresAt = Date.parse(invite.expiresAt || '');
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      // Mark the stale record before doing any seat mutation, or an
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
    if (!canJoinRoom(socket, account, { reconnecting: Boolean(room.game.getPlayerByClient(clientId)) })) return lockoutRefusal(socket);
    // The same capacity rule join-room uses: every retained lobby seat counts.
    if (!room.lobbyHasFreeSeat()) return { success: false, error: 'That room is full.' };
    return joinRoomViaInvite(socket, account, room, payload);
  }

  function joinRoomViaInvite(socket, account, room, payload) {
    const clientId = normalizeClientId(payload.clientId);
    const existing = room.game.getPlayerByClient(clientId);
    if (existing?.socketId && existing.socketId !== socket.id && !existing.disconnected) {
      return { success: false, error: 'That seat is already in use.' };
    }
    const seatConflict = roomManager.identitySeatElsewhere(room, { clientId, accountId: account.id, socketId: socket.id });
    if (seatConflict) return { success: false, error: seatConflict };
    // The lobby as it is before the seat is staged: the seat that is about to
    // be added, the host seat it may take over and the bot roster it may
    // change. A refused invite gives all of it back.
    const rosterBefore = snapshotLobbyRoster(room);
    const socketRoomBefore = roomManager.socketRoom.get(socket.id) || null;
    let joined;
    try {
      joined = room.addOrReconnectPlayer({
        clientId,
        socketId: socket.id,
        nickname: account.displayName,
        color: account.color,
        avatarGrid: normalizeAvatarGrid(account.avatarGrid),
        accountId: account.id
      });
    } catch (error) {
      console.error('Invite seating failed for room', room.roomCode, error);
      restoreLobbyRoster(room, rosterBefore);
      return { success: false, error: 'That seat could not be prepared. Please try again.' };
    }
    if (!joined.success) {
      restoreLobbyRoster(room, rosterBefore);
      return { success: false, error: joined.error };
    }
    // Validate and consume the invite while the source room is still intact. If the record was declined or expired concurrently, or the store
    // failed, the staged target seat is rolled back and the source socket is untouched: a failed invite never leaves a live seat behind.
    let result;
    try {
      result = socialStore.respondInvite(account.id, payload.inviteId, true);
      if (!result.success) {
        restoreLobbyRoster(room, rosterBefore);
        return result;
      }
      detachSocketFromOtherRoom(socket, room);
      leaveAllGameRooms(socket);
      clearDisconnectTimer(clientId, room);
      roomManager.socketRoom.set(socket.id, room);
      socket.join(room.roomCode);
    } catch (error) {
      console.error('Invite acceptance failed for room', room.roomCode, error);
      restoreLobbyRoster(room, rosterBefore);
      if (socketRoomBefore) roomManager.socketRoom.set(socket.id, socketRoomBefore);
      else roomManager.socketRoom.delete(socket.id);
      return { success: false, error: 'That room invite could not be accepted. Please try again.' };
    }
    social.emitSocialUpdate(account.id);
    emitRoomState(room);
    io.in(room.roomCode).emit('system-message', { text: account.displayName + ' joined from a room invite.' });
    emitPendingInteractions(room, socket, joined.player);
    return { ...result, roomId: room.publicId, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility };
  }

  // The lobby roster as it is right now: every seat with the fields a seat
  // carries, plus the host seat. An invite that fails gives all of it back.
  function snapshotLobbyRoster(room) {
    return {
      players: room.game.players.map(player => ({ player, props: { ...player } })),
      hostId: room.hostId
    };
  }

  function restoreLobbyRoster(room, snapshot) {
    const roster = room.game.players;
    roster.length = 0;
    snapshot.players.forEach(entry => {
      const player = entry.player;
      Object.keys(player).forEach(key => {
        if (!(key in entry.props)) delete player[key];
      });
      Object.assign(player, entry.props);
      roster.push(player);
    });
    room.hostId = snapshot.hostId;
    roster.forEach(player => { player.isHost = player.id === snapshot.hostId; });
  }

  function contractCancelKey(socket, payload) {
    const requestId = normalizeRequestId(payload?.requestId);
    if (!requestId) return null;
    return `${socket.id}:cancel:${requestId}`;
  }

  // The memo records which contract the cancel settled, as the contract
  // response memo does: a reused request id must not report a cancel for a
  // different contract that is still pending.
  function cachedContractCancel(room, socket, payload) {
    const key = contractCancelKey(socket, payload);
    if (!key) return null;
    if (!room.game.contractTransactions?.has(key)) return null;
    const memo = room.game.contractTransactions.get(key);
    // An evicted id answers with the map's terminal rejection, as before.
    if (memo && memo.result === undefined && memo.error) return memo;
    const pendingId = room.game.pendingPlayerContract?.id || null;
    const named = payload?.contractId ? String(payload.contractId) : null;
    if (named ? named !== memo?.contractId : pendingId) return null;
    return memo?.result ?? null;
  }

  function cacheContractCancel(room, socket, payload, result, contractId = null) {
    const key = contractCancelKey(socket, payload);
    if (key) room.game.contractTransactions.set(key, { contractId: contractId ? String(contractId) : null, result });
  }

  function maintenanceSnapshot() {
    return maintenance?.snapshot?.() || {
      mode: 'normal',
      lockout: false,
      message: '',
      releaseId: '',
      drainDeadline: null,
      activeRounds: 0,
    };
  }

  // maintenance lockout: who may pass it

  // A socket passes the lockout with a live operator cookie grant (read at the
  // handshake, see server.js) or as an admin account. account undefined means
  // "resolve it from the socket"; null means "known anonymous".
  function maintenanceBypass(socket, account) {
    if (maintenanceAccess?.isGrantActive?.(socket?.data?.maintenanceAccess)) return true;
    let resolved = account;
    if (resolved === undefined) {
      try { resolved = social?.accountForSocket?.(socket, {}) || null; } catch { resolved = null; }
    }
    return isAdminAccount(resolved?.id, runtime.adminIds);
  }

  // The bypass is only worked out when the plain gate says no, so normal play
  // never pays for the account lookup.
  function gate(check, socket, account, options = {}) {
    if (typeof maintenance?.[check] !== 'function') return true;
    if (maintenance[check](options)) return true;
    return maintenance[check]({ ...options, bypass: maintenanceBypass(socket, account) });
  }

  const canCreateRoom = (socket, account) => gate('canCreateRoom', socket, account);
  const canStartRound = (socket, account) => gate('canStartRound', socket, account);
  const canJoinRoom = (socket, account, { reconnecting = false } = {}) => gate('canJoinRoom', socket, account, { reconnecting });

  // Per-socket copy of the state: bypass tells this client whether to hide the
  // lockout panel. It is never broadcast as one shared value.
  function maintenanceStateFor(socket, snapshot = maintenanceSnapshot()) {
    return { ...snapshot, bypass: maintenanceBypass(socket) };
  }

  function emitMaintenanceState(socket, snapshot) {
    socket?.emit?.('maintenance-state', maintenanceStateFor(socket, snapshot));
  }

  function broadcastMaintenanceState(snapshot = maintenanceSnapshot()) {
    io?.sockets?.sockets?.forEach?.(socket => emitMaintenanceState(socket, snapshot));
  }

  // Refusal for a lockout gate, or for the older drain/maintenance pause.
  function lockoutRefusal(socket, pausedError = 'New rooms are paused for maintenance.') {
    const snapshot = maintenanceSnapshot();
    return snapshot.lockout
      ? { success: false, error: 'The site is closed for maintenance.', code: 'MAINTENANCE_LOCKOUT', maintenance: maintenanceStateFor(socket, snapshot) }
      : { success: false, error: pausedError, code: 'MAINTENANCE_DRAINING', maintenance: maintenanceStateFor(socket, snapshot) };
  }

  // socket disconnect (registered per socket by the connection wiring)

  function handleSocketDisconnect(socket) {
    social.chatLastSent.delete(socket.id);
    forgetPatrolRuns(socket.id);
    // Every live seat bound to this socket enters grace, including one left in
    // a room the socket is not mapped to; it must not stay live forever.
    const seats = roomManager.liveSeatsOnSocket(socket.id);
    roomManager.disconnectPlayer(socket.id);
    seats.forEach(({ room, player }) => {
      scheduleDisconnect(room, socket.id, player);
      // A disconnected leader cannot be paid out, and its frozen bid would keep
      // every rival from winning below it: the lead is released now, not at
      // grace expiry, which is long after the auction closes.
      if (room.game.started) revokeAuctionLeadIfLeader(room, player, 'disconnect');
      reassignHostIfNeeded(room, player.id);
      emitRoomState(room);
    });
    console.log('Socket disconnected:', socket.id);
  }

  function forgetPatrolRuns(socketId) {
    social.patrolRuns.forEach((run, token) => {
      if (run.socketId === socketId && !run.settlementPending) social.patrolRuns.delete(token);
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
    releaseSocketSeats,
    getRoomForSocket,
    handleSocketDisconnect,
    resolveSeatExitObligations,
    io,
    leaveAllGameRooms,
    matchStore,
    metrics,
    maintenance,
    pubsubAdapter,
    maintenanceSnapshot,
    maintenanceBypass,
    maintenanceStateFor,
    emitMaintenanceState,
    broadcastMaintenanceState,
    lockoutRefusal,
    canCreateRoom,
    canStartRound,
    canJoinRoom,
    botProviderStatus,
    unsubscribeBotProviderStatus,
    // Shutdown hook (server.js calls it by this name): stops every background
    // interval, not only the auction watchdog it is named for.
    stopAuctionWatchdog: stopBackgroundTimers,
    dispose: stopBackgroundTimers,
    now,
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
    setPlayerPresence: roomPresenceRuntime.setPlayerPresence,
    noteSocketEvent: roomPresenceRuntime.noteSocketEvent,
    sweepIdleSeats: roomPresenceRuntime.sweepIdleSeats,
    startRoomVoteKick: roomVoteKickRuntime.startRoomVoteKick,
    castRoomVoteKick: roomVoteKickRuntime.castRoomVoteKick
  };

  roomManager.setRoomDestroyer?.(destroyRoom);
  const emptyRoomGcTimer = setIntervalFn(() => runRoomTimer('empty-room-gc', '*', emptyRoomGcTick), EMPTY_ROOM_GC_INTERVAL_MS);
  emptyRoomGcTimer?.unref?.();
  const auctionWatchdogTimer = setIntervalFn(() => runRoomTimer('auction-watchdog', '*', auctionWatchdogTick), AUCTION_WATCHDOG_INTERVAL_MS);
  auctionWatchdogTimer?.unref?.();
  const idleSeatSweepTimer = setIntervalFn(() => runRoomTimer('idle-seat-sweep', '*', () => roomPresenceRuntime.sweepIdleSeats()), IDLE_SEAT_SWEEP_INTERVAL_MS);
  idleSeatSweepTimer?.unref?.();
  const tradeExpirySweepTimer = setIntervalFn(() => runRoomTimer('trade-expiry-sweep', '*', tradeExpirySweepTick), TRADE_EXPIRY_SWEEP_INTERVAL_MS);
  tradeExpirySweepTimer?.unref?.();

  function stopBackgroundTimers() {
    [emptyRoomGcTimer, auctionWatchdogTimer, idleSeatSweepTimer, tradeExpirySweepTimer].forEach(timer => clearIntervalFn(timer));
  }

  return runtime;
}

export { createRuntime };
