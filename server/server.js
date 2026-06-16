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
    roomManager.socketRoom.delete(socketId);
    if (currentRoom.hostId === currentPlayer.id) {
      const available = currentRoom.game.players.find(p => !p.disconnected && !p.bankrupt && p.id !== currentPlayer.id);
      if (available) {
        currentRoom.hostId = available.id;
      }
    }
    if (
      currentRoom.game.pendingTrade &&
      (currentRoom.game.pendingTrade.fromPlayerId === currentPlayer.id || currentRoom.game.pendingTrade.toPlayerId === currentPlayer.id)
    ) {
      currentRoom.game.pendingTrade = null;
    }
    if (currentRoom.game.currentPlayerId === currentPlayer.id) {
      currentRoom.game.nextTurn();
    }
    emitRoomState(currentRoom);
    io.in(currentRoom.roomCode).emit('system-message', { text: `${currentPlayer.nickname} disconnected.` });
  }, DISCONNECT_GRACE_MS);
  disconnectTimers.set(player.clientId, timer);
}

function scheduleAuctionFinish(room) {
  if (!room?.game?.auction?.active) return;
  clearAuctionTimer(room);
  const endsAt = room.game.auction.endsAt || (Date.now() + AUCTION_DURATION_MS);
  const delay = Math.max(0, endsAt - Date.now());
  const timer = setTimeout(() => {
    room.game.finishAuction();
    emitRoomState(room);
    io.in(room.roomCode).emit('system-message', { text: 'Auction ended.' });
    clearAuctionTimer(room);
  }, delay);
  auctionTimers.set(room.roomCode, timer);
}

io.on('connection', (socket) => {
  console.log('A socket connected:', socket.id);

  socket.on('restore-session', ({ clientId }) => {
    clearDisconnectTimer(clientId);
    const room = roomManager.restoreConnection(clientId, socket.id);
    if (room) {
      // Leave any other game rooms this socket might be in
      for (const r of socket.rooms) {
        if (r !== socket.id && r !== room.roomCode) {
          socket.leave(r);
        }
      }
      socket.join(room.roomCode);
      emitRoomState(room);
      socket.emit('system-message', { text: 'Reconnected to your room.' });
    }
  });

  socket.on('create-room', (payload, callback) => {
    const { nickname, color, clientId } = payload || {};
    if (!nickname) {
      return callback?.({ success: false, error: 'Nickname is required.' });
    }
    clearDisconnectTimer(clientId);

    // Leave any previous game rooms so we don't receive ghost updates
    for (const r of socket.rooms) {
      if (r !== socket.id) {
        socket.leave(r);
      }
    }

    const room = roomManager.createRoom({ clientId, socketId: socket.id, nickname, color });
    socket.join(room.roomCode);
    emitRoomState(room);
    socket.emit('system-message', { text: 'Room created. Waiting for players...' });
    callback?.({ success: true, roomCode: room.roomCode });
  });

  socket.on('join-room', (payload, callback) => {
    const { roomCode, nickname, color, clientId } = payload || {};
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
    for (const r of socket.rooms) {
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
        emitRoomState(oldRoom);
      }
    }

    const result = room.addOrReconnectPlayer({ clientId, socketId: socket.id, nickname, color });
    if (!result.success) {
      return callback?.({ success: false, error: result.error });
    }
    roomManager.socketRoom.set(socket.id, room);
    socket.join(room.roomCode);
    emitRoomState(room);
    io.in(room.roomCode).emit('system-message', { text: `${nickname} joined the room.` });
    callback?.({ success: true, roomCode: room.roomCode });
  });

  socket.on('set-setting', ({ key, value }, callback) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    if (!player || room.hostId !== player.id) {
      return callback?.({ success: false, error: 'Only the host can change settings.' });
    }
    room.setRoomSetting(key, value);
    emitRoomState(room);
    callback?.({ success: true });
  });

  socket.on('set-player-appearance', ({ color, nickname }, callback) => {
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
    const room = roomManager.getRoomBySocket(socket.id);
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
    const room = roomManager.getRoomBySocket(socket.id);
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

  socket.on('purchase-property', ({ tileIndex }, callback) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) return;
    const result = room.purchaseProperty(socket.id, tileIndex);
    emitRoomState(room);
    if (result?.message) {
      io.in(room.roomCode).emit('system-message', { text: result.message });
    }
    callback?.({ success: result?.success ?? false, error: result?.error });
  });

  socket.on('decline-property', ({ tileIndex }, callback) => {
    const room = roomManager.getRoomBySocket(socket.id);
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

  socket.on('auction-bid', ({ amount }, callback) => {
    const room = roomManager.getRoomBySocket(socket.id);
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
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) return;
    const result = room.endTurn(socket.id);
    emitRoomState(room);
    callback?.({ success: result?.success ?? false, error: result?.error });
  });

  socket.on('manage-property', ({ tileIndex, action }, callback) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) return;
    const result = room.manageProperty(socket.id, { tileIndex, action });
    emitRoomState(room);
    if (result?.message) {
      io.in(room.roomCode).emit('system-message', { text: result.message });
    }
    callback?.({ success: result?.success ?? false, error: result?.error });
  });

  socket.on('propose-trade', (payload, callback) => {
    const room = roomManager.getRoomBySocket(socket.id);
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
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) return;
    const result = room.respondToTrade(socket.id, payload);
    emitRoomState(room);
    callback?.({ success: result?.success ?? false, error: result?.error, accepted: result?.accepted });
  });

  socket.on('send-chat', ({ text }, callback) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    io.in(room.roomCode).emit('chat-message', { text, nickname: player?.nickname || 'Guest' });
    callback?.({ success: true });
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
