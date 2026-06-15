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

function emitRoomState(room) {
  if (!room) return;
  io.in(room.roomCode).emit('update-state', {
    room: room.getRoomSummary(),
    game: room.game.getGameSummary()
  });
}

function clearAuctionTimer(room) {
  const timer = auctionTimers.get(room.roomCode);
  if (timer) {
    clearTimeout(timer);
  }
  auctionTimers.delete(room.roomCode);
}

function scheduleAuctionFinish(room) {
  if (!room?.game?.auction?.active) return;
  clearAuctionTimer(room);
  const timer = setTimeout(() => {
    room.game.finishAuction();
    emitRoomState(room);
    io.in(room.roomCode).emit('system-message', { text: 'Auction ended.' });
    clearAuctionTimer(room);
  }, 15000);
  auctionTimers.set(room.roomCode, timer);
}

io.on('connection', (socket) => {
  console.log('A socket connected:', socket.id);

  socket.on('restore-session', ({ clientId }) => {
    const room = roomManager.restoreConnection(clientId, socket.id);
    if (room) {
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
    const room = roomManager.getRoom(roomCode);
    if (!room) {
      return callback?.({ success: false, error: 'Room not found.' });
    }
    const result = room.addOrReconnectPlayer({ clientId, socketId: socket.id, nickname, color });
    if (!result.success) {
      return callback?.({ success: false, error: result.error });
    }
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
    if (room.game.auction?.active) {
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
      emitRoomState(room);
      io.in(room.roomCode).emit('system-message', { text: 'A player disconnected. Their turn will be skipped if needed.' });
    }
    console.log('Socket disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log('✅ Server is running!');
  console.log('👉 Visit http://localhost:' + PORT);
});
