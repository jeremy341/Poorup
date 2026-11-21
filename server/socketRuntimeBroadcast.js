// Room-state emission, match/persona settlement and per-seat pending-payload delivery for the socket runtime.

import { botPersonaStore } from './botPersonaStore.js';
import { annotateMatchAchievements, recordMatchStartTelemetry, recordMatchTelemetryOnce, roomTelemetryVersions } from './matchTelemetry.js';
import { readBotProviderStatus } from './botStatus.js';
import { buildMatchRecordOptions } from './roomSetup.js';
import { contractResponderId } from './contractLogic.js';
import { SPONSORSHIP_HUMAN_WINDOW_MS } from './sponsorshipLogic.js';
import { playerFinanceEnabled } from './financeRules.js';
import { getRoomForSocket as resolveRoomOrAck } from './socketHandlerSupport.js';
import { ROOMS_UPDATED_DEBOUNCE_MS } from './socketRuntimeConstants.js';
import { runRoomTimer } from './socketRuntimeHelpers.js';

export function createBroadcastDomain(ctx) {
  const { io, roomManager, accountStore, achievementStore, matchStore, telemetryStore, botAdvisor, social, metrics, now, setTimeoutFn, clearTimeoutFn } = ctx;

  function botProviderStatus() {
    return readBotProviderStatus(botAdvisor);
  }

  function getRoomForSocket(socket, callback) {
    const room = resolveRoomOrAck(ctx.runtime, socket, callback);
    if (room?.game) room.game.presentationClock = now;
    return room;
  }

  // One debounced push keeps public-room browsers current without emitting per
  // create/join/leave/start burst.
  function scheduleRoomsUpdated() {
    clearTimeoutFn(ctx.roomsUpdatedTimer);
    ctx.roomsUpdatedTimer = setTimeoutFn(() => runRoomTimer('rooms-updated', '*', () => {
      ctx.roomsUpdatedTimer = null;
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
      ctx.roomPresenceRuntime.synchronizeInactivityTimers(room);
      // Eliminations and departures reach the vote here, before the room
      // summary carries it to the table.
      ctx.roomVoteKickRuntime.reconcileRoomVoteKick(room);
      broadcastRoomState(room);
      ctx.scheduleBotTurn(room);
      ctx.scheduleBotAuction(room);
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
    const existing = ctx.sponsorshipRechecks.get(roomCode);
    if (existing && existing.sponsorship === sponsorship) return;
    if (existing) {
      clearTimeoutFn(existing.handle);
      ctx.sponsorshipRechecks.delete(roomCode);
    }
    if (!sponsorship || !room.game.getPlayerById?.(sponsorship.buyerId)?.isBot) return;
    const createdAt = Number(sponsorship.createdAt);
    if (!Number.isFinite(createdAt)) return;
    const remaining = createdAt + SPONSORSHIP_HUMAN_WINDOW_MS - Date.now();
    // Once the window has passed, a still-open request is checked at a slow pace.
    const delay = remaining > 0 ? remaining + 250 : 5_000;
    const entry = { sponsorship, handle: null };
    entry.handle = setTimeoutFn(() => runRoomTimer('sponsorship-recheck', roomCode, () => {
      if (ctx.sponsorshipRechecks.get(roomCode) !== entry) return;
      ctx.sponsorshipRechecks.delete(roomCode);
      if (room.destroyed || room.game.pendingSponsoredPurchase !== sponsorship) return;
      emitRoomState(room);
    }), delay);
    ctx.sponsorshipRechecks.set(roomCode, entry);
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

  Object.assign(ctx, {
    botProviderStatus,
    getRoomForSocket,
    scheduleRoomsUpdated,
    recordRoomActivityMetrics,
    emitRoomState,
    recordRoomStats,
    broadcastRoomState,
    emitPendingInteractions
  });
}
