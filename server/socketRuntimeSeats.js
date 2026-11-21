// Seat lifecycle, reconnect grace, room teardown and the background sweeps that collect empty rooms and stale trades.

import { AUCTION_DURATION_MS } from './gameLogic.js';
import { ensureRoomHost } from './roomSeat.js';
import { passPendingPurchaseForSeatRemoval, settleAfkPayment } from './seatDeparture.js';
import { recordMatchStalledTelemetry, roomTelemetryVersions } from './matchTelemetry.js';
import { reassignHostIfNeeded, runRoomTimer } from './socketRuntimeHelpers.js';
import {
  CANCELLED_OBLIGATIONS,
  EMPTY_ROOM_GRACE_PERIOD_MS,
  TRADE_OFFER_TTL_MS,
  disconnectTimerKey
} from './socketRuntimeConstants.js';

export function createSeatsDomain(ctx) {
  const { io, roomManager, telemetryStore, social, metrics, now, setTimeoutFn, clearTimeoutFn } = ctx;

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
      ctx.scheduleRoomsUpdated();
      return;
    }
    ctx.emitRoomState(oldRoom);
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
    ctx.emitRoomState(oldRoom);
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
    if (result.auctionStarted) ctx.scheduleAuctionFinish(room);
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
    ctx.roomPresenceRuntime.clearPlayer(room, player.id);
    socket?.leave(room.roomCode);
    ctx.emitRoomState(room);
    if (reason !== 'vote-kick') io.in(room.roomCode).emit('system-message', { text: message });
    ctx.scheduleRoomsUpdated();
    return true;
  }

  function dropDisconnectTimer(clientId, room) {
    if (!room) return null;
    const key = disconnectTimerKey(room.roomCode, clientId);
    const timer = ctx.disconnectTimers.get(key);
    if (!timer) return null;
    clearTimeoutFn(timer.handle);
    ctx.disconnectTimers.delete(key);
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
    ctx.clearAuctionTimer(room);
    ctx.roomPresenceRuntime.clearRoom(room);
    ctx.roomVoteKickRuntime.clearRoom(roomCode);
    clearDisconnectTimersForRoom(room);
    ctx.clearBotAuctionTimersForRoom(roomCode);
    clearTimeoutFn(ctx.botTimers.get(roomCode));
    ctx.botTimers.delete(roomCode);
    ctx.botDecisionLocks.delete(roomCode);
    clearTimeoutFn(ctx.botDecisionWatchdogs.get(roomCode));
    ctx.botDecisionWatchdogs.delete(roomCode);
    clearTimeoutFn(ctx.sponsorshipRechecks.get(roomCode)?.handle);
    ctx.sponsorshipRechecks.delete(roomCode);
    for (const botKey of ctx.auctionDecisionLocks) {
      if (botKey.startsWith(`${roomCode}:`)) ctx.auctionDecisionLocks.delete(botKey);
    }
    ctx.auctionEvaluations.delete(roomCode);
    // Drop the socket to room index for everyone still mapped to this room;
    // otherwise connected players keep acting on a zombie room that is gone
    // from the registry (getRoomBySocket would still resolve it).
    forgetSocketMappings(room);
    roomManager.rooms.delete(roomCode);
    ctx.recordRoomActivityMetrics();
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
      ctx.recordRoomStats(room);
    } catch (error) {
      console.error('settlement failed for room', room.roomCode, error);
    }
    return true;
  }

  function scheduleDisconnect(room, socketId, disconnectedPlayer = null) {
    if (!room) return;
    const player = disconnectedPlayer || room.getPlayerBySocket(socketId);
    if (!player) return;
    dropDisconnectTimer(player.clientId, room);
    ctx.roomPresenceRuntime.clearPlayer(room, player.id);
    const droppedAt = now();
    const deadline = droppedAt + ctx.disconnectGraceMs;
    player.disconnected = true;
    player.socketId = null;
    player.disconnectDeadline = deadline;
    // A lobby seat's grace restarts for ever, so the deadline cannot tell a
    // fresh drop from a ghost; the first drop time can.
    player.disconnectedAt = droppedAt;
    const key = disconnectTimerKey(room.roomCode, player.clientId);
    const timer = { room, player, clientId: player.clientId, key, socketId, deadline, handle: null };
    ctx.disconnectTimers.set(key, timer);
    scheduleDisconnectExpiry(timer);
  }

  function scheduleDisconnectExpiry(timer) {
    timer.handle = setTimeoutFn(() => runRoomTimer('disconnect-expiry', timer.room.roomCode, () => expireDisconnectedSeat(timer)), Math.max(0, timer.deadline - now()));
  }

  function expireDisconnectedSeat(timer) {
    if (ctx.disconnectTimers.get(timer.key) !== timer) return false;
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
      ctx.disconnectTimers.delete(timer.key);
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
      timer.deadline = now() + ctx.disconnectGraceMs;
      currentPlayer.disconnectDeadline = timer.deadline;
      scheduleDisconnectExpiry(timer);
      return false;
    }
    const removed = crownLoneSolventSeat(currentRoom, currentPlayer)
      || removeSeatForReason(currentRoom, currentPlayer, 'disconnect', false);
    if (!removed) {
      // A transactional settlement failure keeps the original seat/deadline
      // eligible for a bounded retry, rather than abandoning its expiry.
      // Retries back off from 1s to a 30s ceiling and announce once, so a
      // seat that cannot settle (a parked payment no bankruptcy path
      // resolves) cannot burn a 1s timer loop indefinitely while the table
      // waits on the ghost.
      timer.settleRetries = (timer.settleRetries || 0) + 1;
      if (timer.settleRetries === 5) {
        io.in(currentRoom.roomCode).emit('system-message', { text: `${currentPlayer.nickname}'s seat could not be settled after leaving. The table is waiting on a stalled settlement.` });
      }
      const retryDelay = Math.min(30_000, 1_000 * 2 ** Math.min(timer.settleRetries - 1, 5));
      timer.handle = setTimeoutFn(() => runRoomTimer('disconnect-expiry', timer.room.roomCode, () => expireDisconnectedSeat(timer)), retryDelay);
      return false;
    }
    ctx.disconnectTimers.delete(timer.key);
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
    ctx.emitRoomState(room);
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
    ctx.scheduleAuctionFinish(room);
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

  // createdAt is stamped with the wall clock in proposeTrade, so compare with it.
  function tradeExpirySweepTick() {
    const at = Date.now();
    for (const room of roomManager.rooms.values()) {
      if (!room.game?.started) continue;
      // An unanswered trade or player contract gates the whole table, so both lapse.
      const staleTrade = room.game.expireStaleTrade?.(at, TRADE_OFFER_TTL_MS);
      const staleContract = room.game.expireStaleContract?.(at, TRADE_OFFER_TTL_MS);
      if (staleTrade || staleContract) ctx.emitRoomState(room);
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
    ctx.scheduleRoomsUpdated();
  }

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
      ctx.emitRoomState(room);
    });
    console.log('Socket disconnected:', socket.id);
  }

  function forgetPatrolRuns(socketId) {
    social.patrolRuns.forEach((run, token) => {
      if (run.socketId === socketId && !run.settlementPending) social.patrolRuns.delete(token);
    });
  }

  Object.assign(ctx, {
    leaveAllGameRooms,
    detachSocketFromOtherRoom,
    releaseSocketSeats,
    resolveSeatExitObligations,
    removeSeatForReason,
    clearDisconnectTimer,
    destroyRoom,
    tradeExpirySweepTick,
    emptyRoomGcTick,
    handleSocketDisconnect
  });
}
