import express from 'express';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { RoomManager } from './gameLogic.js';
import { AccountStore } from './accountStore.js';
import { SocialStore } from './socialStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// The supplied plain-client project is the production static UI. Keep the
// protected SVG references in public/assets and serve the HTML/CSS/JS directly.
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(publicPath, 'index.html'), err => {
    if (err) next(err);
  });
});

const roomManager = new RoomManager();
const accountStore = new AccountStore();
const socialStore = new SocialStore();
const auctionTimers = new Map();
const disconnectTimers = new Map();
const AUCTION_DURATION_MS = 5000;
const DISCONNECT_GRACE_MS = 10000;
const EMPTY_ROOM_GC_INTERVAL_MS = 60 * 1000;
const EMPTY_ROOM_GRACE_PERIOD_MS = 10 * 60 * 1000;
const CHAT_COOLDOWN_MS = 500;

const chatLastSent = new Map();

function reply(callback, payload) {
  if (typeof callback === 'function') {
    callback(payload);
  }
}

function getRoomForSocket(socket, callback) {
  const room = roomManager.getRoomBySocket(socket.id);
  if (!room) {
    reply(callback, { success: false, error: 'Room not found.' });
    return null;
  }
  return room;
}

function clearDisconnectTimersForRoom(room) {
  if (!room) return;
  room.game.players.forEach(player => {
    clearDisconnectTimer(player.clientId);
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [roomCode, room] of roomManager.rooms.entries()) {
    const hasConnected = room.game.players.some(p => !p.disconnected);
    if (!hasConnected) {
      if (!room.emptySince) {
        room.emptySince = now;
      } else if (now - room.emptySince > EMPTY_ROOM_GRACE_PERIOD_MS) {
        console.log(`Garbage collecting empty room: ${roomCode}`);
        clearAuctionTimer(room);
        clearDisconnectTimersForRoom(room);
        roomManager.rooms.delete(roomCode);
      }
    } else {
      room.emptySince = null;
    }
  }
}, EMPTY_ROOM_GC_INTERVAL_MS);

function normalizeNickname(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 24);
}

function normalizeRoomCode(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
}

function normalizeRoomName(value) {
  if (typeof value !== 'string') return 'AFTER HOURS';
  return value.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 24) || 'AFTER HOURS';
}

function normalizeVisibility(value) {
  return value === 'private' ? 'private' : 'public';
}

function normalizeColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '';
}

function normalizeAvatarGrid(value) {
  if (!Array.isArray(value) || value.length !== 8) return null;
  const rows = value.map(row => {
    if (!Array.isArray(row) || row.length !== 8) return null;
    return row.map(cell => {
      if (cell == null || cell === '') return null;
      return typeof cell === 'string' && /^#[0-9a-fA-F]{6}$/.test(cell) ? cell.toLowerCase() : null;
    });
  });
  return rows.some(row => row === null) ? null : rows;
}

function normalizeChatText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 250);
}

function accountFromPayload(payload = {}) {
  return accountStore.sessionAccount(payload.sessionToken);
}

function emitPendingInteractions(room, socket, player) {
  if (!room || !socket || !player) return;

  const purchase = room.game.pendingPurchaseOffer;
  if (purchase && purchase.playerId === player.id && room.game.currentPlayerId === player.id) {
    const tile = room.game.getTile(purchase.tileIndex);
    if (tile) {
      socket.emit('purchase-offer', {
        tileIndex: tile.index,
        name: tile.name,
        price: tile.price
      });
    }
  }

  if (room.game.pendingTrade && room.game.pendingTrade.toPlayerId === player.id) {
    socket.emit('trade-offer', { trade: room.game.pendingTrade });
  }
}

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

function emitRoomState(room) {
  if (!room) return;
  if (room.game.lastWinner && !room.statsRecorded) {
    accountStore.recordGameResults(room.game.players, room.game.lastWinner.id, {
      gameId: `match_${room.roomCode}_${room.game.startedAt || Date.now()}`,
      durationSeconds: room.game.startedAt ? (Date.now() - room.game.startedAt) / 1000 : 0,
      roundCount: room.game.roundNumber,
      roomVisibility: room.visibility,
      globalEvents: room.game.globalEventHistory?.map(event => event.title) || []
    });
    room.statsRecorded = true;
  }
  io.in(room.roomCode).emit('update-state', {
    room: room.getRoomSummary(),
    game: room.game.getGameSummary(),
    serverTime: Date.now()
  });
}

function accountForSocket(socket, payload = {}) {
  const account = accountStore.sessionAccount(payload.sessionToken) || accountStore.getPublicAccountById(socket.data?.accountId);
  if (account) socket.data.accountId = account.id;
  return account;
}

function socketsForAccount(accountId) {
  if (!accountId) return [];
  return [...io.sockets.sockets.values()].filter(candidate => candidate.data?.accountId === accountId);
}

function emitSocialUpdate(accountId) {
  const social = socialSummary(accountId);
  socketsForAccount(accountId).forEach(candidate => candidate.emit('social-update', social));
}

function socialSummary(accountId) {
  const raw = socialStore.listFor(accountId);
  return {
    friends: raw.friends.map(id => publicPlayerCard(id)).filter(Boolean),
    requests: raw.requests.map(request => ({ ...request, from: publicPlayerCard(request.requesterId) })).filter(request => request.from),
    outgoing: raw.outgoing.map(request => ({ ...request, to: publicPlayerCard(request.addresseeId) })).filter(request => request.to),
    invites: raw.invites.map(invite => ({ id: invite.id, roomName: invite.roomName, visibility: invite.visibility, expiresAt: invite.expiresAt, sender: publicPlayerCard(invite.senderId) })).filter(invite => invite.sender),
    notifications: raw.notifications
  };
}

function notifyAccount(accountId, notification) {
  if (!accountId) return;
  socialStore.addNotification(accountId, notification);
  socketsForAccount(accountId).forEach(candidate => candidate.emit('social-notification', notification));
}

function broadcastMythicalAchievement({ playerAccountId, playerDisplayName }) {
  const payload = { kind: 'mythical-achievement', title: 'MYTHICAL ACHIEVEMENT', body: `${playerDisplayName || 'A player'} unlocked a MYTHICAL ACHIEVEMENT.`, playerDisplayName: playerDisplayName || 'A player', createdAt: new Date().toISOString() };
  io.emit('mythical-achievement', payload);
  notifyAccount(playerAccountId, { ...payload, body: 'Your Mythical achievement was verified and announced server-wide.' });
}

function publicPlayerCard(accountId) {
  return accountStore.getPublicPlayerCard(accountId);
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

function scheduleDisconnect(room, socketId) {
  if (!room) return;
  const player = room.getPlayerBySocket(socketId);
  if (!player) return;
  clearDisconnectTimer(player.clientId);
  const timer = setTimeout(() => {
    disconnectTimers.delete(player.clientId);
    if (player.socketId !== socketId) {
      return;
    }
    const currentRoom = roomManager.getRoom(room.roomCode);
    if (!currentRoom) {
      return;
    }
    const currentPlayer = currentRoom.game.getPlayerByClient(player.clientId);
    if (!currentPlayer || currentPlayer.socketId !== socketId) {
      return;
    }
    currentPlayer.disconnected = true;
    currentPlayer.socketId = null;
    roomManager.socketRoom.delete(socketId);
    reassignHostIfNeeded(currentRoom, currentPlayer.id);
    if (
      currentRoom.game.pendingTrade &&
      (currentRoom.game.pendingTrade.fromPlayerId === currentPlayer.id || currentRoom.game.pendingTrade.toPlayerId === currentPlayer.id)
    ) {
      currentRoom.game.pendingTrade = null;
      io.in(currentRoom.roomCode).emit('system-message', { text: 'A pending trade was cancelled due to disconnect.' });
    }
    if (currentRoom.game.currentPlayerId === currentPlayer.id) {
      currentRoom.game.pendingPurchaseOffer = null;
      currentRoom.game.skipDisconnectedCurrentPlayer();
    }
    if (currentRoom.game.auction && currentRoom.game.auction.active && currentRoom.game.auction.highestBidderId === currentPlayer.id) {
      currentRoom.game.auction.highestBidderId = null;
      currentRoom.game.auction.highestBid = 0;
      io.in(currentRoom.roomCode).emit('system-message', { text: `The highest bidder disconnected. The bid is reset.` });
      scheduleAuctionFinish(currentRoom);
    }
    emitRoomState(currentRoom);
    io.in(currentRoom.roomCode).emit('system-message', { text: `${currentPlayer.nickname} disconnected.` });
  }, DISCONNECT_GRACE_MS);
  disconnectTimers.set(player.clientId, timer);
}

function scheduleAuctionFinish(room) {
  if (!room?.game?.auction?.active) return;
  const roomCode = room.roomCode;
  clearAuctionTimer(room);
  const endsAt = room.game.auction.endsAt || (Date.now() + AUCTION_DURATION_MS);
  const delay = Math.max(0, endsAt - Date.now());
  const timer = setTimeout(() => {
    const currentRoom = roomManager.getRoom(roomCode);
    if (!currentRoom?.game?.auction?.active) {
      clearAuctionTimer({ roomCode });
      return;
    }
    currentRoom.game.finishAuction();
    emitRoomState(currentRoom);
    io.in(roomCode).emit('system-message', { text: 'Auction ended.' });
    clearAuctionTimer(currentRoom);
  }, delay);
  auctionTimers.set(roomCode, timer);
}

io.on('connection', (socket) => {
  console.log('A socket connected:', socket.id);

  socket.on('account-register', (payload = {}, callback) => {
    const result = accountStore.register(payload);
    if (result?.account?.id) socket.data.accountId = result.account.id;
    reply(callback, result);
  });

  socket.on('check-username', (payload = {}, callback) => {
    // Availability is a read-only hint for the form. Registration still
    // performs the authoritative uniqueness check inside AccountStore.
    reply(callback, accountStore.checkUsername(payload.username));
  });

  socket.on('account-login', (payload = {}, callback) => {
    const result = accountStore.login(payload);
    if (result?.account?.id) socket.data.accountId = result.account.id;
    reply(callback, result);
  });

  socket.on('account-restore', (payload = {}, callback) => {
    const result = accountStore.restore(payload.sessionToken);
    if (result?.account?.id) socket.data.accountId = result.account.id;
    reply(callback, result);
  });

  socket.on('account-logout', (payload = {}, callback) => {
    socket.data.accountId = null;
    reply(callback, accountStore.logout(payload.sessionToken));
  });

  socket.on('account-update', (payload = {}, callback) => {
    const result = accountStore.updateProfile(payload.sessionToken, payload);
    if (!result.success) return reply(callback, result);
    socket.data.accountId = result.account.id;
    const room = roomManager.getRoomBySocket(socket.id);
    const player = room?.getPlayerBySocket(socket.id);
    if (player && !room.game.started && player.accountId === result.account.id) {
      room.game.setPlayerAppearance(socket.id, {
        nickname: result.account.displayName,
        color: result.account.color,
        avatarGrid: normalizeAvatarGrid(result.account.avatarGrid),
      });
      emitRoomState(room);
    }
    reply(callback, result);
  });

  socket.on('restore-session', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    const { clientId } = payload;
    clearDisconnectTimer(clientId);
    const room = roomManager.restoreConnection(clientId, socket.id);
    if (room) {
      for (const r of [...socket.rooms]) {
        if (r !== socket.id && r !== room.roomCode) {
          socket.leave(r);
        }
      }
      socket.join(room.roomCode);
      if (account?.id) socket.data.accountId = account.id;
      emitRoomState(room);
      emitPendingInteractions(room, socket, room.game.getPlayerByClient(clientId));
      socket.emit('system-message', { text: 'Reconnected to your room.' });
      reply(callback, { success: true, roomCode: room.roomCode });
      return;
    }
    reply(callback, { success: false, error: 'No active session found.' });
  });

  socket.on('list-rooms', (_, callback) => {
    reply(callback, { success: true, rooms: roomManager.listPublicRooms() });
  });

  socket.on('create-room', (payload, callback) => {
    const { clientId } = payload || {};
    const account = accountFromPayload(payload);
    const nickname = normalizeNickname(account?.displayName || payload?.nickname);
    const color = normalizeColor(account?.color || payload?.color);
    const avatarGrid = normalizeAvatarGrid(account?.avatarGrid || payload?.avatarGrid);
    const accountId = account?.id || null;
    if (accountId) socket.data.accountId = accountId;
    const roomName = normalizeRoomName(payload?.roomName);
    const visibility = normalizeVisibility(payload?.visibility);
    const requestedRoomCode = visibility === 'private' ? normalizeRoomCode(payload?.roomCode) : '';
    if (!nickname) {
      return callback?.({ success: false, error: 'Nickname is required.' });
    }
    if (visibility === 'private' && requestedRoomCode.length !== 6) {
      return callback?.({ success: false, error: 'Private rooms need a unique 6-character invite code.' });
    }
    if (requestedRoomCode && roomManager.getRoom(requestedRoomCode)) {
      return callback?.({ success: false, error: 'That private room code is already in use. Choose another.' });
    }
    clearDisconnectTimer(clientId);

    const previousRoom = roomManager.getRoomByClient(clientId);
    const departedPlayerId = previousRoom?.game.getPlayerByClient(clientId)?.id;
    const oldRoom = roomManager.leaveRoomByClient(clientId, socket.id);
    if (oldRoom) {
      if (departedPlayerId) {
        reassignHostIfNeeded(oldRoom, departedPlayerId);
      }
      emitRoomState(oldRoom);
    }

    // Leave any previous game rooms so we don't receive ghost updates
    for (const r of [...socket.rooms]) {
      if (r !== socket.id) {
        socket.leave(r);
      }
    }

    const room = roomManager.createRoom({ clientId, socketId: socket.id, nickname, color: color || undefined, avatarGrid, accountId, roomName, visibility, roomCode: requestedRoomCode || undefined });
    socket.join(room.roomCode);
    emitRoomState(room);
    socket.emit('system-message', { text: 'Room created. Waiting for players...' });
    callback?.({ success: true, roomCode: room.roomCode });
  });

  socket.on('join-room', (payload, callback) => {
    const roomCode = normalizeRoomCode(payload?.roomCode);
    const account = accountFromPayload(payload);
    const nickname = normalizeNickname(account?.displayName || payload?.nickname);
    const color = normalizeColor(account?.color || payload?.color);
    const avatarGrid = normalizeAvatarGrid(account?.avatarGrid || payload?.avatarGrid);
    const accountId = account?.id || null;
    if (accountId) socket.data.accountId = accountId;
    const { clientId } = payload || {};
    if (!roomCode) {
      return callback?.({ success: false, error: 'Room code is required.' });
    }
    if (!nickname) {
      return callback?.({ success: false, error: 'Nickname is required.' });
    }
    clearDisconnectTimer(clientId);
    const room = roomManager.getRoom(roomCode);
    if (!room) {
      return callback?.({ success: false, error: 'Room not found.' });
    }

    // Leave any previous game rooms so we don't receive ghost updates
    for (const r of [...socket.rooms]) {
      if (r !== socket.id) {
        socket.leave(r);
      }
    }

    // Remove player from any old room they were in via restore-session
    const oldRoom = roomManager.getRoomBySocket(socket.id);
    if (oldRoom && oldRoom.roomCode !== room.roomCode) {
      const oldPlayer = oldRoom.getPlayerBySocket(socket.id);
      if (oldPlayer && !oldRoom.game.started) {
        oldRoom.game.removePlayerBySocket(socket.id);
        emitRoomState(oldRoom);
      } else if (oldPlayer) {
        oldPlayer.disconnected = true;
        oldPlayer.socketId = null;
        reassignHostIfNeeded(oldRoom, oldPlayer.id);
        emitRoomState(oldRoom);
      }
    }

    const result = room.addOrReconnectPlayer({ clientId, socketId: socket.id, nickname, color: color || undefined, avatarGrid, accountId });
    if (!result.success) {
      return callback?.({ success: false, error: result.error });
    }
    roomManager.socketRoom.set(socket.id, room);
    socket.join(room.roomCode);
    emitRoomState(room);
    emitPendingInteractions(room, socket, result.player);
    io.in(room.roomCode).emit('system-message', { text: `${nickname} joined the room.` });
    callback?.({ success: true, roomCode: room.roomCode });
  });

  socket.on('set-setting', (payload = {}, callback) => {
    const { key, value } = payload;
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    if (!player || room.hostId !== player.id) {
      return callback?.({ success: false, error: 'Only the host can change settings.' });
    }
    if (room.game.started) {
      return callback?.({ success: false, error: 'Game settings can only be changed before the game starts.' });
    }
    room.setRoomSetting(key, value);
    emitRoomState(room);
    callback?.({ success: true });
  });

  socket.on('set-player-appearance', (payload = {}, callback) => {
    const { color, nickname } = payload;
    const avatarGrid = normalizeAvatarGrid(payload.avatarGrid);
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) {
      return callback?.({ success: false, error: 'Room not found.' });
    }
    const result = room.game.setPlayerAppearance(socket.id, { color, nickname, avatarGrid });
    if (!result.success) {
      return callback?.(result);
    }
    emitRoomState(room);
    callback?.({ success: true });
  });

  socket.on('start-game', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    if (!player || room.hostId !== player.id) {
      return callback?.({ success: false, error: 'Only the host can start the game.' });
    }
    const result = room.startGame();
    if (!result.success) {
      return callback?.({ success: false, error: result.error });
    }
    emitRoomState(room);
    io.in(room.roomCode).emit('system-message', { text: 'The game has started.' });
    callback?.({ success: true });
  });

  socket.on('roll-dice', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.rollDice(socket.id);
    emitRoomState(room);
    if (result?.purchaseOffer) {
      socket.emit('purchase-offer', result.purchaseOffer);
    }
    if (result?.auctionStarted) {
      scheduleAuctionFinish(room);
      io.in(room.roomCode).emit('system-message', { text: 'Auction started.' });
    }
    if (result?.message) {
      io.in(room.roomCode).emit('system-message', { text: result.message });
    }
    if (result?.cardReveal) {
      socket.emit('card-reveal', result.cardReveal);
    }
    callback?.({ success: result?.success ?? false, error: result?.error });
  });

  socket.on('purchase-property', (payload = {}, callback) => {
    const { tileIndex } = payload;
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.purchaseProperty(socket.id, tileIndex);
    emitRoomState(room);
    if (result?.message) {
      io.in(room.roomCode).emit('system-message', { text: result.message });
    }
    callback?.({ success: result?.success ?? false, error: result?.error });
  });

  socket.on('decline-property', (payload = {}, callback) => {
    const { tileIndex } = payload;
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.declineProperty(socket.id, tileIndex);
    if (result?.auctionStarted) {
      scheduleAuctionFinish(room);
    }
    emitRoomState(room);
    if (result?.message) {
      io.in(room.roomCode).emit('system-message', { text: result.message });
    }
    callback?.({ success: result?.success ?? false, error: result?.error });
  });

  socket.on('auction-bid', (payload = {}, callback) => {
    const { amount } = payload;
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.placeAuctionBid(socket.id, amount);
    if (result?.success && room.game.auction?.active) {
      scheduleAuctionFinish(room);
    }
    emitRoomState(room);
    if (result?.message) {
      io.in(room.roomCode).emit('system-message', { text: result.message });
    }
    callback?.({ success: result?.success ?? false, error: result?.error });
  });

  socket.on('auction-pass', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.passAuction(socket.id);
    if (result?.success && room.game.auction?.active) {
      scheduleAuctionFinish(room);
    }
    emitRoomState(room);
    callback?.({ success: result?.success ?? false, error: result?.error });
  });

  socket.on('end-turn', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.endTurn(socket.id);
    emitRoomState(room);
    callback?.({ success: result?.success ?? false, error: result?.error });
  });

  socket.on('manage-property', (payload = {}, callback) => {
    const { tileIndex, action } = payload;
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.manageProperty(socket.id, { tileIndex, action });
    emitRoomState(room);
    if (result?.message) {
      io.in(room.roomCode).emit('system-message', { text: result.message });
    }
    callback?.({ success: result?.success ?? false, error: result?.error });
  });

  socket.on('propose-trade', (payload, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.proposeTrade(socket.id, payload);
    emitRoomState(room);
    if (result?.success && result.trade) {
      const target = room.game.getPlayerById(result.trade.toPlayerId);
      if (target?.socketId) {
        io.to(target.socketId).emit('trade-offer', { trade: result.trade });
      }
    }
    callback?.({ success: result?.success ?? false, error: result?.error, trade: result?.trade });
  });

  socket.on('respond-trade', (payload, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.respondToTrade(socket.id, payload);
    emitRoomState(room);
    callback?.({ success: result?.success ?? false, error: result?.error, accepted: result?.accepted });
  });

  socket.on('pay-jail-fine', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.payJailFine(socket.id);
    emitRoomState(room);
    if (result?.message) {
      io.in(room.roomCode).emit('system-message', { text: result.message });
    }
    reply(callback, { success: result?.success ?? false, error: result?.error });
  });

  socket.on('use-jail-free', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.useJailFree(socket.id);
    emitRoomState(room);
    if (result?.message) io.in(room.roomCode).emit('system-message', { text: result.message });
    reply(callback, { success: result?.success ?? false, error: result?.error });
  });

  socket.on('get-bank-loan-offer', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const offer = room.getBankLoanOffer(socket.id);
    reply(callback, { success: offer?.available ?? false, error: offer?.reason, offer });
  });

  socket.on('take-bank-loan', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.takeBankLoan(socket.id);
    emitRoomState(room);
    if (result?.message) io.in(room.roomCode).emit('system-message', { text: result.message });
    reply(callback, { success: result?.success ?? false, error: result?.error, loan: result?.loan });
  });

  socket.on('repay-bank-loan', (payload = {}, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.repayBankLoan(socket.id, payload);
    emitRoomState(room);
    reply(callback, { success: result?.success ?? false, error: result?.error, loan: result?.loan });
  });

  socket.on('vote-global-event', (payload = {}, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.voteGlobalEvent(socket.id, payload.choiceId);
    emitRoomState(room);
    reply(callback, { success: result?.success ?? false, error: result?.error });
  });

  socket.on('declare-bankruptcy', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.declareBankruptcy(socket.id);
    emitRoomState(room);
    reply(callback, { success: result?.success ?? false, error: result?.error });
  });

  socket.on('send-chat', (payload = {}, callback) => {
    const text = normalizeChatText(payload.text);
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    if (!text) {
      return reply(callback, { success: false, error: 'Message cannot be empty.' });
    }
    const now = Date.now();
    const lastSent = chatLastSent.get(socket.id) || 0;
    if (now - lastSent < CHAT_COOLDOWN_MS) {
      return reply(callback, { success: false, error: 'Please wait before sending another message.' });
    }
    chatLastSent.set(socket.id, now);
    io.in(room.roomCode).emit('chat-message', { text, nickname: player?.nickname || 'Guest' });
    reply(callback, { success: true });
  });

  socket.on('get-social-data', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to use social features.' });
    reply(callback, { success: true, social: socialSummary(account.id) });
  });

  socket.on('send-friend-request', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Create an account before sending friend requests.' });
    const target = payload.targetAccountId
      ? accountStore.getPublicAccountById(payload.targetAccountId)
      : accountStore.findAccountByUsername(payload.username);
    if (!target) return reply(callback, { success: false, error: 'Player not found.' });
    const result = socialStore.requestFriend(account.id, target.id);
    if (result.success) {
      notifyAccount(target.id, { kind: 'friend-request', title: 'FRIEND REQUEST', body: `${account.displayName} sent you a friend request.`, metadata: { friendshipId: result.friendship.id, accountId: account.id } });
      emitSocialUpdate(account.id);
      emitSocialUpdate(target.id);
    }
    reply(callback, result);
  });

  socket.on('respond-friend-request', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage friend requests.' });
    const result = socialStore.respondFriend(account.id, payload.friendshipId, payload.accept === true);
    if (result.success) {
      const otherId = result.friendship.requesterId;
      const other = accountStore.getPublicAccountById(otherId);
      notifyAccount(otherId, { kind: 'friend-response', title: result.friendship.status === 'accepted' ? 'FRIEND REQUEST ACCEPTED' : 'FRIEND REQUEST DECLINED', body: `${account.displayName} ${result.friendship.status === 'accepted' ? 'accepted' : 'declined'} your friend request.`, metadata: { accountId: account.id } });
      emitSocialUpdate(account.id);
      emitSocialUpdate(otherId);
      result.other = other ? { accountId: other.id, displayName: other.displayName } : null;
    }
    reply(callback, result);
  });

  socket.on('remove-friend', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage friends.' });
    const result = socialStore.removeFriend(account.id, payload.otherAccountId);
    if (result.success) emitSocialUpdate(account.id), emitSocialUpdate(payload.otherAccountId);
    reply(callback, result);
  });

  socket.on('block-player', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage blocks.' });
    const result = socialStore.blockPlayer(account.id, payload.otherAccountId);
    if (result.success) emitSocialUpdate(account.id), emitSocialUpdate(payload.otherAccountId);
    reply(callback, result);
  });

  socket.on('report-player', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to report a player.' });
    const result = socialStore.reportPlayer(account.id, payload.otherAccountId, payload.reason);
    reply(callback, result);
  });

  socket.on('get-public-player-card', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    const target = payload.accountId ? accountStore.getPublicAccountById(payload.accountId) : accountStore.findAccountByUsername(payload.username);
    if (!target) return reply(callback, { success: false, error: 'Player not found.' });
    const card = publicPlayerCard(target.id);
    const relationship = viewer ? socialStore.friendshipBetween(viewer.id, target.id) : null;
    reply(callback, { success: true, player: card, relationship: relationship ? relationship.status : 'none' });
  });

  socket.on('search-players', (payload = {}, callback) => {
    const query = String(payload.query || '').trim().toLowerCase().slice(0, 32);
    if (query.length < 3) return reply(callback, { success: true, players: [] });
    const players = [...accountStore.accounts.values()]
      .filter(account => account.username.includes(query))
      .slice(0, 20)
      .map(account => ({ id: account.id, username: account.username, displayName: account.displayName, color: account.color, avatarGrid: account.avatarGrid }));
    reply(callback, { success: true, players });
  });

  socket.on('get-match-history', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    const target = payload.accountId ? accountStore.getPublicAccountById(payload.accountId) : viewer;
    if (!target) return reply(callback, { success: false, error: 'Player not found.' });
    const allowed = viewer?.id === target.id || (viewer && socialStore.friendshipBetween(viewer.id, target.id)?.status === 'accepted');
    if (!allowed) return reply(callback, { success: false, error: 'Match history is visible to the owner and accepted friends.' });
    const history = viewer?.id === target.id
      ? target.history || []
      : (target.history || []).map(entry => ({ matchId: entry.matchId, playedAt: entry.playedAt, result: entry.result, won: entry.won, properties: entry.properties }));
    reply(callback, { success: true, history });
  });

  socket.on('get-leaderboard', (payload = {}, callback) => {
    const metric = ['wins', 'games', 'rate', 'achievements', 'bankruptcies'].includes(payload.metric) ? payload.metric : 'wins';
    reply(callback, { success: true, metric, rows: accountStore.getLeaderboard(metric) });
  });

  socket.on('send-room-invite', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    const room = getRoomForSocket(socket, callback);
    if (!account || !room) return;
    const target = accountStore.getPublicAccountById(payload.targetAccountId);
    if (!target) return reply(callback, { success: false, error: 'Player not found.' });
    const result = socialStore.createInvite({ roomCode: room.roomCode, roomName: room.roomName, visibility: room.visibility, senderId: account.id, recipientId: target.id });
    if (result.success) {
      notifyAccount(target.id, { kind: 'room-invite', title: 'ROOM INVITE', body: `${account.displayName} invited you to ${room.roomName}.`, metadata: { inviteId: result.invite.id, roomName: room.roomName, visibility: room.visibility } });
      emitSocialUpdate(account.id);
      emitSocialUpdate(target.id);
    }
    reply(callback, result);
  });

  socket.on('respond-room-invite', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage room invites.' });
    const result = socialStore.respondInvite(account.id, payload.inviteId, payload.accept === true);
    if (result.success) emitSocialUpdate(account.id);
    reply(callback, result);
  });

  socket.on('mark-notification-read', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage notifications.' });
    const result = socialStore.markNotificationRead(account.id, payload.notificationId);
    reply(callback, result);
  });

  socket.on('disconnect', () => {
    const room = roomManager.disconnectPlayer(socket.id);
    if (room) {
      scheduleDisconnect(room, socket.id);
    }
    console.log('Socket disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log('✅ Server is running!');
  console.log('👉 Visit http://localhost:' + PORT);
});
