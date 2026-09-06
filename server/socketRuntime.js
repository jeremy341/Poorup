// The shared runtime every socket domain registers against: room state
// broadcast, the bot/auction/disconnect/AFK timers, the empty-room garbage
// collector, seat detach/host-reassign bookkeeping, and the invite/cancel
// flows two domains share. One createRuntime() per server process — server.js
// builds the stores and io, then hands them here. Behavior (emit ordering,
// feed text, ack shapes) is pinned by server/rooms.test.js and
// server/server.test.js.
import { AUCTION_DURATION_MS } from './gameLogic.js';
import { normalizeAvatarGrid, buildMatchRecordOptions } from './roomSetup.js';
import {
  selectBotTurnTarget,
  botMayStillAct,
  runBotTurn,
  resolvePurchaseOffer,
  isAuctionBotParticipant,
  auctionBidDecision
} from './botLogic.js';
import { getRoomForSocket as resolveRoomOrAck } from './socketHandlerSupport.js';

const DISCONNECT_GRACE_MS = 10000;
// C8: AFK turn watchdog cadence. A connected-but-idle seat stalls a started
// game forever (the disconnect-grace skip only fires on real disconnects), so
// each turn owner gets a bounded budget; the timeout is env-tunable for tests.
const TURN_AFK_CHECK_INTERVAL_MS = 15 * 1000;
const TURN_AFK_TIMEOUT_MS = Number(process.env.TURN_AFK_TIMEOUT_MS || 180000);
const EMPTY_ROOM_GC_INTERVAL_MS = 60 * 1000;
const EMPTY_ROOM_GRACE_PERIOD_MS = 10 * 60 * 1000;
const ROOMS_UPDATED_DEBOUNCE_MS = 750;

// Obligations that gate the whole table must die with a departing or
// AFK seat, or the remaining players wait forever on a ghost.
const CANCELLED_OBLIGATIONS = [
  { key: 'pendingTrade', label: 'trade' },
  { key: 'pendingPlayerContract', label: 'player contract' }
];

function createRuntime(deps) {
  const { io, roomManager, accountStore, socialStore, matchStore, achievementStore, botAdvisor, social } = deps;
  const auctionTimers = new Map();
  const disconnectTimers = new Map();
  const botTimers = new Map();
  const botDecisionLocks = new Set();
  const auctionBotTimers = new Map();
  let roomsUpdatedTimer = null;

  function accountFromPayload(payload = {}) {
    return accountStore.sessionAccount(payload.sessionToken);
  }

  function getRoomForSocket(socket, callback) {
    return resolveRoomOrAck(runtime, socket, callback);
  }

  // One debounced push keeps public-room browsers current without emitting per
  // create/join/leave/start burst.
  function scheduleRoomsUpdated() {
    clearTimeout(roomsUpdatedTimer);
    roomsUpdatedTimer = setTimeout(() => {
      roomsUpdatedTimer = null;
      io.emit('rooms-updated', { rooms: roomManager.listPublicRooms() });
    }, ROOMS_UPDATED_DEBOUNCE_MS);
  }

  function emitRoomState(room) {
    if (!room) return;
    try {
      if (room.game.lastWinner && !room.statsRecorded) {
        recordRoomStats(room);
      }
      broadcastRoomState(room);
      scheduleBotTurn(room);
      scheduleBotAuction(room);
    } catch (error) {
      console.error('emitRoomState failed for room', room.roomCode, error);
    }
  }

  function recordRoomStats(room) {
    const matchRecord = accountStore.recordGameResults(room.game.players, room.game.lastWinner.id, buildMatchRecordOptions(room));
    matchStore.record(matchRecord);
    const historyReader = accountId => accountStore.getMatchHistory(accountId);
    achievementStore.evaluateMatch(matchRecord, historyReader)
      .forEach(candidate => social.recordVerifiedAchievement(candidate, matchRecord.matchId));
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
    const roomSummary = room.getRoomSummary();
    const serverTime = Date.now();
    // Game summaries now carry owner-only loan and contract terms. Emit a
    // viewer-scoped projection so another seat can see that a loan exists
    // without receiving its collateral, premium, or repayment schedule.
    io.sockets.sockets.forEach(candidate => {
      if (!candidate.rooms.has(room.roomCode)) return;
      const viewer = room.getPlayerBySocket(candidate.id);
      candidate.emit('update-state', {
        room: roomSummary,
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
      price: tile.price
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

  function reassignHostIfNeeded(room, departedPlayerId) {
    if (!room) return;
    if (room.hostId !== departedPlayerId) return;
    const available = room.game.players.find(p => !p.disconnected && !p.bankrupt && p.id !== departedPlayerId);
    if (available) {
      room.hostId = available.id;
    }
    room.game.players.forEach(player => {
      player.isHost = player.id === room.hostId;
    });
  }

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
    oldPlayer.disconnected = true;
    oldPlayer.socketId = null;
    reassignHostIfNeeded(oldRoom, oldPlayer.id);
    emitRoomState(oldRoom);
  }

  function clearAuctionTimer(room) {
    const timer = auctionTimers.get(room.roomCode);
    if (timer) {
      clearTimeout(timer);
    }
    auctionTimers.delete(room.roomCode);
  }

  function clearDisconnectTimer(clientId) {
    const timer = disconnectTimers.get(clientId);
    if (timer) {
      clearTimeout(timer);
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
    room.destroyed = true;
    clearAuctionTimer(room);
    clearDisconnectTimersForRoom(room);
    clearTimeout(auctionBotTimers.get(roomCode));
    auctionBotTimers.delete(roomCode);
    clearTimeout(botTimers.get(roomCode));
    botTimers.delete(roomCode);
    botDecisionLocks.delete(roomCode);
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
    if (!room?.game.started) return;
    if (botTurnPending(room)) return;
    const bot = selectBotTurnTarget(room.game);
    if (!bot?.isBot) return;
    if (bot.bankrupt) return;
    if (bot.disconnected) return;
    const timer = setTimeout(() => beginBotTurn(room, bot), 650);
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
    const result = await runBotTurn(room, bot, botAdvisor);
    if (result?.noEmit) return;
    // Tail purchase resolution, second half of the post-roll double-check.
    resolvePurchaseOffer(room, bot, result);
    emitRoomState(room);
  }

  function finishBotTurn(room) {
    botDecisionLocks.delete(room.roomCode);
    scheduleBotTurn(room);
    scheduleBotAuction(room);
  }

  function scheduleBotAuction(room) {
    const auction = room?.game.auction;
    if (!auction?.active) return;
    const key = room.roomCode;
    if (auctionBotTimers.has(key)) return;
    const bot = room.game.players.find(player => isAuctionBotParticipant(auction, player));
    if (!bot) return;
    const timer = setTimeout(() => beginBotAuctionBid(room, bot, key), 450);
    auctionBotTimers.set(key, timer);
  }

  function beginBotAuctionBid(room, bot, key) {
    auctionBotTimers.delete(key);
    if (!room.game.auction?.active) return;
    const { shouldBid, minimum } = auctionBidDecision(room.game.auction, bot, room.game.settings.startingCash);
    room.runBotAction(bot.id, actor => bidOrPass(room, actor, shouldBid, minimum));
    emitRoomState(room);
  }

  function bidOrPass(room, actor, shouldBid, minimum) {
    if (!shouldBid) return room.passAuction(actor);
    return room.placeAuctionBid(actor, minimum);
  }

  // --- auction/disconnect timers -------------------------------------------

  function scheduleAuctionFinish(room) {
    if (!room?.game.auction?.active) return;
    const roomCode = room.roomCode;
    clearAuctionTimer(room);
    const endsAt = room.game.auction.endsAt || (Date.now() + AUCTION_DURATION_MS);
    const delay = Math.max(0, endsAt - Date.now());
    const timer = setTimeout(() => finishAuctionIfStillActive(roomCode), delay);
    auctionTimers.set(roomCode, timer);
  }

  function finishAuctionIfStillActive(roomCode) {
    const currentRoom = roomManager.getRoom(roomCode);
    if (!currentRoom?.game.auction?.active) {
      clearAuctionTimer({ roomCode });
      return;
    }
    currentRoom.game.finishAuction();
    emitRoomState(currentRoom);
    io.in(roomCode).emit('system-message', { text: 'Auction ended.' });
    clearAuctionTimer(currentRoom);
  }

  function scheduleDisconnect(room, socketId) {
    if (!room) return;
    const player = room.getPlayerBySocket(socketId);
    if (!player) return;
    clearDisconnectTimer(player.clientId);
    const timer = setTimeout(() => expireDisconnectedSeat(room, player, socketId), DISCONNECT_GRACE_MS);
    disconnectTimers.set(player.clientId, timer);
  }

  function expireDisconnectedSeat(room, player, socketId) {
    disconnectTimers.delete(player.clientId);
    if (player.socketId !== socketId) return;
    const currentRoom = roomManager.getRoom(room.roomCode);
    if (!currentRoom) return;
    const currentPlayer = currentRoom.game.getPlayerByClient(player.clientId);
    if (!currentPlayer) return;
    if (currentPlayer.socketId !== socketId) return;
    currentPlayer.disconnected = true;
    currentPlayer.socketId = null;
    roomManager.socketRoom.delete(socketId);
    reassignHostIfNeeded(currentRoom, currentPlayer.id);
    clearPendingObligations(currentRoom, currentRoom.game, currentPlayer, 'disconnect');
    skipDisconnectedCurrentTurn(currentRoom, currentPlayer);
    revokeAuctionLeadIfLeader(currentRoom, currentPlayer);
    emitRoomState(currentRoom);
    io.in(currentRoom.roomCode).emit('system-message', { text: `${currentPlayer.nickname} disconnected.` });
    // A room that just lost its last human may leave the directory.
    scheduleRoomsUpdated();
  }

  function skipDisconnectedCurrentTurn(room, player) {
    if (room.game.currentPlayerId !== player.id) return;
    room.game.pendingPurchaseOffer = null;
    room.game.skipDisconnectedCurrentPlayer();
  }

  function revokeAuctionLeadIfLeader(room, player) {
    const auction = room.game.auction;
    if (!auction?.active) return;
    if (auction.highestBidderId !== player.id) return;
    auction.highestBidderId = null;
    auction.highestBid = 0;
    io.in(room.roomCode).emit('system-message', { text: 'The highest bidder disconnected. The bid is reset.' });
    scheduleAuctionFinish(room);
  }

  function obligationInvolvesPlayer(obligation, playerId) {
    if (obligation?.fromPlayerId === playerId) return true;
    return obligation?.toPlayerId === playerId;
  }

  function clearPendingObligations(room, game, player, reason) {
    const context = { room, game, player, reason };
    CANCELLED_OBLIGATIONS.forEach(obligation => cancelObligation(context, obligation));
  }

  function cancelObligation(context, obligation) {
    const game = context.game;
    const pending = game[obligation.key];
    if (!obligationInvolvesPlayer(pending, context.player.id)) return;
    game[obligation.key] = null;
    const text = `A pending ${obligation.label} was cancelled due to ${context.reason}.`;
    io.in(context.room.roomCode).emit('system-message', { text });
  }

  // Expire an AFK turn the way the disconnect-grace expiry cleans up its seat
  // (see scheduleDisconnect): cancel any pending trade touching the idle player
  // with a system notice, drop the pending purchase offer, and clear an
  // outstanding payment obligation, then advance the turn. nextTurn() is the
  // reusable helper for a still-connected player — skipDisconnectedCurrentPlayer
  // is gated on player.disconnected and no-ops here.
  function expireAfkTurn(room, game, player) {
    clearPendingObligations(room, game, player, 'turn timeout');
    game.pendingPurchaseOffer = null;
    if (game.pendingPayment?.playerId === player.id) {
      game.clearPendingPayment();
    }
    game.feedMessage(`${player.nickname} ran out of time.`);
    game.nextTurn();
    io.in(room.roomCode).emit('system-message', { text: `${player.nickname} ran out of time. Turn skipped.` });
    emitRoomState(room);
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

  function afkTurnTick() {
    const now = Date.now();
    for (const room of roomManager.rooms.values()) {
      watchRoomTurn(room, now);
    }
  }

  function watchRoomTurn(room, now) {
    // Fire only for a started game with no live auction and a connected,
    // non-bankrupt turn owner — a disconnected seat is the grace path's
    // problem; anything else keeps the watch timestamp fresh.
    const current = afkWatchTarget(room.game);
    if (!current) {
      room.turnWatch = null;
      return;
    }
    const watch = room.turnWatch;
    if (!watch) {
      room.turnWatch = { player: current.id, at: now };
      return;
    }
    if (watch.player !== current.id) {
      room.turnWatch = { player: current.id, at: now };
      return;
    }
    if (now - watch.at < TURN_AFK_TIMEOUT_MS) return;
    // Clear the watch before firing so the same turn ownership can never be
    // skipped twice; the new turn owner gets a fresh window next tick.
    room.turnWatch = null;
    expireAfkTurn(room, room.game, current);
  }

  function afkWatchTarget(game) {
    if (!game?.started) return null;
    if (game.auction?.active) return null;
    const current = game.getCurrentPlayer();
    if (!current) return null;
    if (current.bankrupt) return null;
    if (current.disconnected) return null;
    return current;
  }

  // --- invite / contract-cancel flows ----------------------------------------

  // Accept-branch of respond-room-invite: gate order, seat transfer, and ack
  // shape are pinned by server/rooms.test.js. Returns the ack payload so the
  // handler stays a validate -> delegate -> respond flow.
  function acceptRoomInvite(socket, account, invite, payload) {
    if (!invite) return { success: false, error: 'That room invite has expired.' };
    const room = roomManager.getRoom(invite.roomCode);
    if (!room) return { success: false, error: 'That room no longer exists.' };
    if (room.game.started) return { success: false, error: 'That round has already started.' };
    if (!room.game.canJoin()) return { success: false, error: 'That room is full.' };
    const clientId = String(payload.clientId || '').trim();
    if (!clientId) return { success: false, error: 'A client session is required to join.' };
    return joinRoomViaInvite(socket, account, room, payload);
  }

  function joinRoomViaInvite(socket, account, room, payload) {
    detachSocketFromOtherRoom(socket, room);
    leaveAllGameRooms(socket);
    const joined = room.addOrReconnectPlayer({
      clientId: String(payload.clientId || '').trim(),
      socketId: socket.id,
      nickname: account.displayName,
      color: account.color,
      avatarGrid: normalizeAvatarGrid(account.avatarGrid),
      accountId: account.id
    });
    if (!joined.success) return { success: false, error: joined.error };
    roomManager.socketRoom.set(socket.id, room);
    socket.join(room.roomCode);
    const result = socialStore.respondInvite(account.id, payload.inviteId, true);
    if (!result.success) return result;
    social.emitSocialUpdate(account.id);
    emitRoomState(room);
    io.in(room.roomCode).emit('system-message', { text: account.displayName + ' joined from a room invite.' });
    emitPendingInteractions(room, socket, joined.player);
    return { ...result, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility };
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

  // --- socket disconnect (registered per socket by the connection wiring) ----

  function handleSocketDisconnect(socket) {
    social.chatLastSent.delete(socket.id);
    forgetPatrolRuns(socket.id);
    const room = roomManager.disconnectPlayer(socket.id);
    if (room) {
      scheduleDisconnect(room, socket.id);
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
    reassignHostIfNeeded,
    roomManager,
    scheduleAuctionFinish,
    scheduleRoomsUpdated,
    social,
    socialStore,
    emitPendingInteractions,
    emitRoomState
  };

  setInterval(emptyRoomGcTick, EMPTY_ROOM_GC_INTERVAL_MS);
  setInterval(afkTurnTick, TURN_AFK_CHECK_INTERVAL_MS);

  return runtime;
}

export { createRuntime };
