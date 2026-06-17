const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { RoomManager } = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(publicPath, 'index.html'), err => {
    if (err) next(err);
  });
});

const roomManager = new RoomManager();
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
  return value.trim().toUpperCase().slice(0, 6);
}

function normalizeColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '';
}

function normalizeChatText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 250);
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
  io.in(room.roomCode).emit('update-state', {
    room: room.getRoomSummary(),
    game: room.game.getGameSummary(),
    serverTime: Date.now()
  });
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

  socket.on('restore-session', (payload = {}, callback) => {
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
      emitRoomState(room);
      emitPendingInteractions(room, socket, room.game.getPlayerByClient(clientId));
      socket.emit('system-message', { text: 'Reconnected to your room.' });
      reply(callback, { success: true, roomCode: room.roomCode });
      return;
    }
    reply(callback, { success: false, error: 'No active session found.' });
  });

  socket.on('create-room', (payload, callback) => {
    const { clientId } = payload || {};
    const nickname = normalizeNickname(payload?.nickname);
    const color = normalizeColor(payload?.color);
    if (!nickname) {
      return callback?.({ success: false, error: 'Nickname is required.' });
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

    const room = roomManager.createRoom({ clientId, socketId: socket.id, nickname, color: color || undefined });
    socket.join(room.roomCode);
    emitRoomState(room);
    socket.emit('system-message', { text: 'Room created. Waiting for players...' });
    callback?.({ success: true, roomCode: room.roomCode });
  });

  socket.on('join-room', (payload, callback) => {
    const roomCode = normalizeRoomCode(payload?.roomCode);
    const nickname = normalizeNickname(payload?.nickname);
    const color = normalizeColor(payload?.color);
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

    const result = room.addOrReconnectPlayer({ clientId, socketId: socket.id, nickname, color: color || undefined });
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
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) {
      return callback?.({ success: false, error: 'Room not found.' });
    }
    const result = room.game.setPlayerAppearance(socket.id, { color, nickname });
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
