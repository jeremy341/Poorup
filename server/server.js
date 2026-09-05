import express from 'express';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { RoomManager } from './gameLogic.js';
import { AccountStore } from './accountStore.js';
import { SocialStore } from './socialStore.js';
import { MatchStore } from './matchStore.js';
import { AchievementStore } from './achievementStore.js';
import { createBotAdvisor } from './botAdvisor.js';

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
const matchStore = new MatchStore();
const achievementStore = new AchievementStore();
const botAdvisor = createBotAdvisor();
const auctionTimers = new Map();
const disconnectTimers = new Map();
const AUCTION_DURATION_MS = 5000;
const DISCONNECT_GRACE_MS = 10000;
// C8: AFK turn watchdog cadence. A connected-but-idle seat stalls a started
// game forever (the disconnect-grace skip only fires on real disconnects), so
// each turn owner gets a bounded budget; the timeout is env-tunable for tests.
const TURN_AFK_CHECK_INTERVAL_MS = 15 * 1000;
const TURN_AFK_TIMEOUT_MS = Number(process.env.TURN_AFK_TIMEOUT_MS || 180000);
const EMPTY_ROOM_GC_INTERVAL_MS = 60 * 1000;
const EMPTY_ROOM_GRACE_PERIOD_MS = 10 * 60 * 1000;
const CHAT_COOLDOWN_MS = 500;
const ROOMS_UPDATED_DEBOUNCE_MS = 750;

const chatLastSent = new Map();
const botTimers = new Map();
const botDecisionLocks = new Set();
const auctionBotTimers = new Map();
const mythicalAnnouncementKeys = new Set();
const MYTHICAL_ANNOUNCEMENT_KEYS_CAP = 500;
const socialRateBuckets = new Map();
const patrolRuns = new Map();
const SOCIAL_RATE_WINDOW_MS = 60 * 1000;
const SOCIAL_RATE_LIMIT = 30;
// Night Shift can continue through several one-minute waves. Keep one signed
// run token alive long enough for a normal session without making it durable.
const PATROL_RUN_MAX_MS = 10 * 60 * 1000;
let roomsUpdatedTimer = null;

function allowSocialAction(accountId, action) {
  if (!accountId) return false;
  const key = `${accountId}:${action}`;
  const now = Date.now();
  const recent = (socialRateBuckets.get(key) || []).filter(timestamp => now - timestamp < SOCIAL_RATE_WINDOW_MS);
  if (recent.length >= SOCIAL_RATE_LIMIT) {
    socialRateBuckets.set(key, recent);
    return false;
  }
  // An emptied bucket must not linger forever keyed by accountId:action —
  // with no prune these entries accumulate for the process lifetime.
  if (!recent.length) socialRateBuckets.delete(key);
  recent.push(now);
  socialRateBuckets.set(key, recent);
  return true;
}

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
// Shared teardown for rooms removed outside of the normal lifecycle (GC and
// stale private-code reclaim): clears every timer keyed by this room and
// drops it from the live map.
function destroyRoom(room) {
  if (!room) return;
  const roomCode = room.roomCode;
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
  for (const [socketId, mappedRoom] of roomManager.socketRoom.entries()) {
    if (mappedRoom === room) roomManager.socketRoom.delete(socketId);
  }
  roomManager.rooms.delete(roomCode);
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

setInterval(() => {
  const now = Date.now();
  for (const [roomCode, room] of roomManager.rooms.entries()) {
    // Bots and ghost seats must not keep a room alive (audit finding 14).
    if (!room.hasConnectedHumans()) {
      if (!room.emptySince) {
        room.emptySince = now;
      } else if (now - room.emptySince > EMPTY_ROOM_GRACE_PERIOD_MS) {
        console.log(`Garbage collecting empty room: ${roomCode}`);
        destroyRoom(room);
        scheduleRoomsUpdated();
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
  if (room.game.pendingPlayerContract && room.game.pendingPlayerContract.toPlayerId === player.id) {
    socket.emit('player-contract-offer', { contract: room.game.pendingPlayerContract });
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
    const matchRecord = accountStore.recordGameResults(room.game.players, room.game.lastWinner.id, {
      gameId: `match_${room.roomCode}_${room.game.startedAt || Date.now()}`,
      durationSeconds: room.game.startedAt ? (Date.now() - room.game.startedAt) / 1000 : 0,
      roundCount: room.game.roundNumber,
      roomVisibility: room.visibility,
      globalEvents: [
        ...(room.game.globalEventHistory || []).map(event => event.title),
        ...(room.game.globalEvent && !(room.game.globalEventHistory || []).some(event => event.id === room.game.globalEvent.id) ? [room.game.globalEvent.title] : [])
      ].slice(0, 20),
      eventCombinations: [
        ...(room.game.globalEventHistory || []).filter(event => event.comboId).map(event => event.comboId),
        ...(room.game.globalEvent?.comboId && !(room.game.globalEventHistory || []).some(event => event.comboId === room.game.globalEvent.comboId) ? [room.game.globalEvent.comboId] : [])
      ].slice(0, 10),
      tradesCompleted: room.game.tradesCompleted || 0,
      auctionsCompleted: room.game.auctionsCompleted || 0,
      casino: room.game.players.map(player => ({ accountId: player.accountId, bets: (player.casinoLedger || []).length, net: Number(player.casinoNet) || 0 })),
      market: room.game.players.map(player => ({ accountId: player.accountId, positions: Object.fromEntries(Object.entries(player.marketPositions || {}).map(([id, position]) => [id, { quantity: Number(position.quantity) || 0, realizedPnl: Number(position.realizedPnl) || 0 }])) })),
      playerContracts: room.game.playerContracts.map(contract => ({
        id: contract.id,
        kind: contract.kind,
        fromPlayerId: contract.fromPlayerId,
        toPlayerId: contract.toPlayerId,
        fromAccountId: room.game.getPlayerById(contract.fromPlayerId)?.accountId || null,
        toAccountId: room.game.getPlayerById(contract.toPlayerId)?.accountId || null,
        amount: contract.amount,
        premiumRate: contract.premiumRate,
        equityShare: contract.equityShare,
        collateralTileIndex: contract.collateralTileIndex ?? null,
        status: contract.status
      }))
    });
    matchStore.record(matchRecord);
    achievementStore.evaluateMatch(matchRecord, accountId => accountStore.getMatchHistory(accountId))
      .forEach(candidate => recordVerifiedAchievement(candidate, matchRecord.matchId));
    // Refresh the owner’s private profile immediately after settlement so
    // completed-game stats, history, and achievement counts are current while
    // the player is still in the game shell.
    room.game.players.forEach(player => {
      if (!player.accountId) return;
      const snapshot = accountStore.getAccountSnapshot(player.accountId);
      if (snapshot) socketsForAccount(player.accountId).forEach(candidateSocket => candidateSocket.emit('account-sync', { account: snapshot }));
    });
    room.statsRecorded = true;
  }
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
  scheduleBotTurn(room);
  scheduleBotAuction(room);
}

function scheduleBotTurn(room) {
  if (!room?.game.started) return;
  const currentPlayer = room.game.getCurrentPlayer();
  const votingBot = room.game.globalEvent?.phase === 'voting'
    ? room.game.players.find(player => player.isBot && !player.bankrupt && !player.disconnected && !room.game.globalEvent.votes?.[player.id])
    : null;
  const pendingBot = room.game.pendingTrade
    ? room.game.getPlayerById(room.game.pendingTrade.toPlayerId)
    : room.game.pendingPlayerContract
      ? room.game.getPlayerById(room.game.pendingPlayerContract.toPlayerId)
      : null;
  const bot = votingBot || (pendingBot?.isBot ? pendingBot : null) || currentPlayer;
  if (!bot?.isBot || bot.bankrupt || bot.disconnected || botTimers.has(room.roomCode) || botDecisionLocks.has(room.roomCode)) return;
  const timer = setTimeout(async () => {
    botTimers.delete(room.roomCode);
    botDecisionLocks.add(room.roomCode);
    try {
    const current = room.game.getCurrentPlayer();
    const isVote = room.game.globalEvent?.phase === 'voting';
    const isPendingResponse = room.game.pendingTrade?.toPlayerId === bot.id || room.game.pendingPlayerContract?.toPlayerId === bot.id;
    if (!isVote && !isPendingResponse && (!current?.isBot || current.id !== bot.id || current.bankrupt || current.disconnected)) return;
    let result;
    if (room.game.globalEvent?.phase === 'voting' && !room.game.globalEvent.votes?.[bot.id]) {
      const preferred = bot.personality === 'builder' ? 'public-works' : bot.personality === 'speculator' ? 'bank-first' : 'low-tax';
      const policy = room.game.globalEvent.choices?.find(choice => choice.id === preferred) || room.game.globalEvent.choices?.[0];
      result = policy ? room.runBotAction(bot.id, actor => room.voteGlobalEvent(actor, policy.id)) : { success: false };
    } else if (room.game.pendingTrade?.toPlayerId === bot.id) {
      const trade = room.game.pendingTrade;
      const giveValue = Number(trade.giveCash || 0) + (trade.givePropertyIndexes || []).reduce((sum, index) => sum + Number(room.game.getTile(index)?.price || 0), 0);
      const askValue = Number(trade.requestCash || 0) + (trade.requestPropertyIndexes || []).reduce((sum, index) => sum + Number(room.game.getTile(index)?.price || 0), 0);
      const accepted = giveValue >= askValue * (bot.personality === 'shark' ? 1.1 : 0.8);
      result = room.runBotAction(bot.id, actor => room.respondToTrade(actor, { tradeId: trade.id, accept: accepted }));
    } else if (room.game.pendingPlayerContract?.toPlayerId === bot.id) {
      const offer = room.game.pendingPlayerContract;
      const lender = room.game.getPlayerById(offer.fromPlayerId);
      const acceptable = offer.kind === 'equity'
        ? bot.personality !== 'survivor' || Number(offer.amount) <= bot.cash * 0.35
        : Number(offer.totalDue || offer.amount) <= bot.cash * (bot.personality === 'speculator' ? 1.25 : 0.8)
          && Boolean(lender && !lender.bankrupt);
      result = room.runBotAction(bot.id, actor => room.respondPlayerContract(actor, acceptable));
    } else if (room.game.pendingPayment?.playerId === bot.id) {
      result = room.runBotAction(bot.id, actor => room.declareBankruptcy(actor));
    } else if (room.game.auction?.active) {
      result = room.runBotAction(bot.id, actor => room.passAuction(actor));
    } else if (room.game.awaitingEndTurn) {
      // The landing resolved but the turn now holds for an explicit end.
      // Bots end immediately; humans use the END TURN button (or the AFK
      // watchdog after 180s).
      result = room.runBotAction(bot.id, actor => room.endTurn(actor));
    } else if (!room.game.hasRolled) {
      const candidates = room.game.getBotCandidates(bot);
      const decision = await botAdvisor.chooseAction({
        candidates,
        personality: bot.personality,
        event: room.game.globalEvent
      });
      if (room.game.getCurrentPlayer()?.id !== bot.id) return;
      const candidate = candidates.find(entry => entry.id === decision?.actionId) || candidates[0];
      if (candidate?.kind === 'trade') {
        const proposal = room.runBotAction(bot.id, actor => room.proposeTrade(actor, candidate));
        result = proposal;
        if (proposal?.success) {
          const rolled = room.runBotAction(bot.id, actor => room.rollDice(actor));
          if (rolled?.success) result = rolled;
        }
      } else if (candidate?.kind === 'market') {
        result = room.runBotAction(bot.id, actor => room.tradeMarket(actor, candidate.instrumentId, candidate.side, candidate.quantity, 'bot-market-' + room.roomCode + '-' + room.game.roundNumber));
      } else if (candidate?.kind === 'casino') {
        result = room.runBotAction(bot.id, actor => room.placeCasinoBet(actor, candidate.color, candidate.stake, 'bot-casino-' + room.roomCode + '-' + room.game.roundNumber));
      } else if (candidate?.kind === 'build' && bot.cash >= candidate.cost + 200) {
        result = room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: candidate.tileIndex, action: 'build-house' }));
      } else if (candidate?.kind === 'mortgage') {
        result = room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: candidate.tileIndex, action: 'mortgage' }));
      } else if (candidate?.kind === 'loan' && bot.personality === 'speculator') {
        result = room.runBotAction(bot.id, actor => room.takeBankLoan(actor));
      } else {
        result = room.runBotAction(bot.id, actor => room.rollDice(actor));
      }
    } else {
      result = room.runBotAction(bot.id, actor => room.rollDice(actor));
      if (result?.purchaseOffer) {
        const tile = room.game.getTile(result.purchaseOffer.tileIndex);
        const canBuy = tile && bot.cash >= Number(tile.price || 0) + 120;
        result = room.runBotAction(bot.id, actor => canBuy
          ? room.purchaseProperty(actor, tile.index)
          : room.declineProperty(actor, tile.index));
      }
    }
    if (result?.purchaseOffer) {
      const tile = room.game.getTile(result.purchaseOffer.tileIndex);
      const canBuy = tile && bot.cash >= Number(tile.price || 0) + 120;
      result = room.runBotAction(bot.id, actor => canBuy
        ? room.purchaseProperty(actor, tile.index)
        : room.declineProperty(actor, tile.index));
    }
    emitRoomState(room);
    } catch (error) {
      // A failed bot decision must not escape the timer callback: an
      // uncaught error here used to take the whole process down. The room
      // stays alive and the watchdog/next action retries naturally.
      console.error(`Bot turn failed in room ${room.roomCode}:`, error);
    } finally {
      botDecisionLocks.delete(room.roomCode);
      scheduleBotTurn(room);
      scheduleBotAuction(room);
    }
  }, 650);
  botTimers.set(room.roomCode, timer);
}

function scheduleBotAuction(room) {
  if (!room?.game.auction?.active) return;
  const key = room.roomCode;
  if (auctionBotTimers.has(key)) return;
  const bot = room.game.players.find(player => player.isBot
    && room.game.auction.participants.includes(player.id)
    && !room.game.auction.passedPlayerIds.includes(player.id)
    && room.game.auction.highestBidderId !== player.id
    && !player.bankrupt
    && !player.disconnected);
  if (!bot) return;
  const timer = setTimeout(() => {
    auctionBotTimers.delete(key);
    if (!room.game.auction?.active) return;
    const auction = room.game.auction;
    const minimum = Math.max(auction.highestBid + 1, auction.highestBid + (bot.personality === 'shark' ? 20 : 10));
    const reserve = bot.personality === 'shark' ? 60 : 120;
    const shouldBid = bot.cash >= minimum + reserve && (bot.personality === 'builder' || bot.personality === 'shark' || bot.cash > room.game.settings.startingCash * 0.7);
    room.runBotAction(bot.id, actor => shouldBid
      ? room.placeAuctionBid(actor, minimum)
      : room.passAuction(actor));
    emitRoomState(room);
  }, 450);
  auctionBotTimers.set(key, timer);
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
  const seen = new Set();
  const recentPlayers = [];
  const recentMatches = matchStore.listForAccount(accountId, 50);
  const fallbackMatches = recentMatches.length ? recentMatches : accountStore.getMatchHistory(accountId);
  const recentCutoff = Math.max(Date.now() - 30 * 24 * 60 * 60 * 1000, Date.parse(accountStore.getRecentClearedAt(accountId) || '') || 0);
  fallbackMatches.filter(record => Date.parse(record.completedAt || '') >= recentCutoff).forEach(record => {
    record.participants.forEach(participant => {
      if (!participant.accountId || participant.accountId === accountId || seen.has(participant.accountId)) return;
      const player = accountStore.getPublicAccountById(participant.accountId);
      if (!player) return;
      seen.add(participant.accountId);
      recentPlayers.push({
        id: player.id,
        username: player.username,
        displayName: player.displayName,
        color: player.color,
        avatarGrid: player.avatarGrid,
        lastPlayedAt: record.completedAt,
        matchId: record.matchId
      });
    });
  });
  return {
    friends: raw.friends.map(id => publicPlayerCard(id, accountId)).filter(Boolean),
    requests: raw.requests.map(request => ({ ...request, from: publicPlayerCard(request.requesterId, accountId) })).filter(request => request.from),
    outgoing: raw.outgoing.map(request => ({ ...request, to: publicPlayerCard(request.addresseeId, accountId) })).filter(request => request.to),
    invites: raw.invites.map(invite => ({ id: invite.id, roomName: invite.roomName, visibility: invite.visibility, expiresAt: invite.expiresAt, sender: publicPlayerCard(invite.senderId, accountId) })).filter(invite => invite.sender),
    notifications: raw.notifications,
    recentPlayers: recentPlayers.slice(0, 20)
  };
}

function notifyAccount(accountId, notification) {
  if (!accountId) return;
  socialStore.addNotification(accountId, notification);
  socketsForAccount(accountId).forEach(candidate => candidate.emit('social-notification', notification));
}

function recordVerifiedAchievement(candidate, gameId) {
  if (!candidate?.accountId || !candidate.achievementId) return false;
  const unlock = achievementStore.unlock({
    accountId: candidate.accountId,
    achievementId: candidate.achievementId,
    gameId,
    evidenceHash: crypto.createHash('sha256').update(`${gameId}:${candidate.achievementId}:${candidate.accountId}`).digest('hex')
  });
  if (!unlock.created) return false;
  const stored = accountStore.recordAchievement(candidate.accountId, {
    id: unlock.record.achievementId,
    unlockedAt: unlock.record.unlockedAt
  });
  if (!stored.created) return false;
  const payload = {
    kind: 'achievement-unlocked',
    achievementId: unlock.record.achievementId,
    title: candidate.title,
    rarity: candidate.rarity,
    body: candidate.body,
    createdAt: unlock.record.unlockedAt
  };
  socketsForAccount(candidate.accountId).forEach(candidateSocket => candidateSocket.emit('achievement-unlocked', payload));
  notifyAccount(candidate.accountId, payload);
  if (candidate.rarity === 'MYTHICAL') {
    broadcastMythicalAchievement({ playerAccountId: candidate.accountId, playerDisplayName: accountStore.getPublicAccountById(candidate.accountId)?.displayName || 'A player', unlockKey: `${gameId}:${candidate.achievementId}:${candidate.accountId}` });
  }
  return true;
}

function broadcastMythicalAchievement({ playerAccountId, playerDisplayName, unlockKey }) {
  if (unlockKey && mythicalAnnouncementKeys.has(unlockKey)) return;
  if (unlockKey) {
    mythicalAnnouncementKeys.add(unlockKey);
    // Bounded FIFO dedupe set — Sets preserve insertion order, so evicting
    // the oldest keeps memory flat without changing duplicate suppression.
    if (mythicalAnnouncementKeys.size > MYTHICAL_ANNOUNCEMENT_KEYS_CAP) {
      const oldest = mythicalAnnouncementKeys.values().next().value;
      mythicalAnnouncementKeys.delete(oldest);
    }
  }
  const payload = { kind: 'mythical-achievement', title: 'MYTHICAL ACHIEVEMENT', body: `${playerDisplayName || 'A player'} unlocked a MYTHICAL ACHIEVEMENT.`, playerDisplayName: playerDisplayName || 'A player', createdAt: new Date().toISOString() };
  io.emit('mythical-achievement', payload);
  notifyAccount(playerAccountId, { ...payload, body: 'Your Mythical achievement was verified and announced server-wide.' });
}

function publicPlayerCard(accountId, viewerId = null) {
  const card = accountStore.getPublicPlayerCard(accountId);
  if (!card || !viewerId || viewerId === accountId) return card;
  const viewerFriends = new Set(socialStore.listFor(viewerId).friends);
  const targetFriends = new Set(socialStore.listFor(accountId).friends);
  return { ...card, mutualFriends: [...viewerFriends].filter(id => targetFriends.has(id)).length };
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
    // A room that just lost its last human may leave the directory.
    scheduleRoomsUpdated();
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

// Expire an AFK turn the way the disconnect-grace expiry cleans up its seat
// (see scheduleDisconnect): cancel any pending trade touching the idle player
// with a system notice, drop the pending purchase offer, and clear an
// outstanding payment obligation, then advance the turn. nextTurn() is the
// reusable helper for a still-connected player — skipDisconnectedCurrentPlayer
// is gated on player.disconnected and no-ops here.
function expireAfkTurn(room, game, player) {
  if (
    game.pendingTrade &&
    (game.pendingTrade.fromPlayerId === player.id || game.pendingTrade.toPlayerId === player.id)
  ) {
    game.pendingTrade = null;
    io.in(room.roomCode).emit('system-message', { text: 'A pending trade was cancelled due to turn timeout.' });
  }
  game.pendingPurchaseOffer = null;
  if (game.pendingPayment?.playerId === player.id) {
    game.pendingPayment = null;
    game.pendingPaymentTurnOptions = null;
  }
  game.feedMessage(`${player.nickname} ran out of time.`);
  game.nextTurn();
  io.in(room.roomCode).emit('system-message', { text: `${player.nickname} ran out of time. Turn skipped.` });
  emitRoomState(room);
}

setInterval(() => {
  const now = Date.now();
  for (const room of roomManager.rooms.values()) {
    const game = room.game;
    // Fire only for a started game with no live auction and a connected,
    // non-bankrupt turn owner — a disconnected seat is the grace path's
    // problem; anything else keeps the watch timestamp fresh.
    const current = game?.started && !game.auction?.active ? game.getCurrentPlayer() : null;
    if (!current || current.bankrupt || current.disconnected) {
      room.turnWatch = null;
      continue;
    }
    const watch = room.turnWatch;
    if (!watch || watch.player !== current.id) {
      room.turnWatch = { player: current.id, at: now };
      continue;
    }
    if (now - watch.at < TURN_AFK_TIMEOUT_MS) continue;
    // Clear the watch before firing so the same turn ownership can never be
    // skipped twice; the new turn owner gets a fresh window next tick.
    room.turnWatch = null;
    expireAfkTurn(room, game, current);
  }
}, TURN_AFK_CHECK_INTERVAL_MS);

io.on('connection', (socket) => {
  console.log('A socket connected:', socket.id);

  // Single scaffold for every socket event. Malformed wire payloads
  // (null, strings, numbers) used to reach handler bodies written against
  // `payload = {}` defaults — which only guard undefined — and a throw
  // inside a socket.io listener escapes to the event emitter and kills
  // the whole server. This wrapper normalizes the payload, guarantees a
  // callable callback, and converts any synchronous or asynchronous
  // handler failure into a logged, ack'd error instead of a crash.
  const on = (event, handler) => socket.on(event, (rawPayload, rawCallback) => {
    const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const callback = typeof rawCallback === 'function' ? rawCallback : () => {};
    const fail = () => {
      try {
        callback({ success: false, error: 'The server could not process that request.' });
      } catch {
        // The socket is gone; nothing further to do.
      }
    };
    try {
      const result = handler(payload, callback);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => {
          console.error(`Unhandled error in ${event} handler:`, error);
          fail();
        });
      }
    } catch (error) {
      console.error(`Unhandled error in ${event} handler:`, error);
      fail();
    }
  });

  on('account-register', (payload = {}, callback) => {
    const result = accountStore.register(payload);
    if (result?.account?.id) socket.data.accountId = result.account.id;
    reply(callback, result);
  });

  on('check-username', (payload = {}, callback) => {
    // Availability is a read-only hint for the form. Registration still
    // performs the authoritative uniqueness check inside AccountStore.
    reply(callback, accountStore.checkUsername(payload.username));
  });

  on('account-login', (payload = {}, callback) => {
    const result = accountStore.login(payload);
    if (result?.account?.id) socket.data.accountId = result.account.id;
    reply(callback, result);
  });

  on('account-restore', (payload = {}, callback) => {
    const result = accountStore.restore(payload.sessionToken);
    if (result?.account?.id) socket.data.accountId = result.account.id;
    reply(callback, result);
  });

  on('account-logout', (payload = {}, callback) => {
    socket.data.accountId = null;
    reply(callback, accountStore.logout(payload.sessionToken));
  });

  on('account-update', (payload = {}, callback) => {
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

  on('restore-session', (payload = {}, callback) => {
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
      reply(callback, { success: true, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility });
      return;
    }
    reply(callback, { success: false, error: 'No active session found.' });
  });

  on('list-rooms', (_, callback) => {
    reply(callback, { success: true, rooms: roomManager.listPublicRooms() });
  });

  on('create-room', (payload, callback) => {
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
    const existingRoom = requestedRoomCode ? roomManager.getRoom(requestedRoomCode) : null;
    if (existingRoom) {
      // A room with no connected humans must not lock its private code for
      // the full GC grace period — reclaim it and let the creator take over.
      if (!existingRoom.hasConnectedHumans()) {
        destroyRoom(existingRoom);
      } else {
        return callback?.({ success: false, error: 'That private room code is already in use. Choose another.' });
      }
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
    callback?.({ success: true, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility });
    scheduleRoomsUpdated();
  });

  on('leave-room', (payload = {}, callback) => {
    const { clientId } = payload || {};
    if (!clientId) {
      return callback?.({ success: false, error: 'A client session is required to leave.' });
    }
    clearDisconnectTimer(clientId);
    const currentRoom = roomManager.getRoomByClient(clientId);
    const departing = currentRoom?.game.getPlayerByClient(clientId) || null;
    const departedId = departing?.id;
    const nickname = departing?.nickname || 'A player';
    const wasPublic = currentRoom?.visibility === 'public';
    const oldRoom = roomManager.leaveRoomByClient(clientId, socket.id);
    if (oldRoom) {
      // Reassign the host on lobby AND started rooms — the older cleanup
      // copies only did it in one branch and left orphan lobbies.
      if (departedId) {
        reassignHostIfNeeded(oldRoom, departedId);
      }
      socket.leave(oldRoom.roomCode);
      emitRoomState(oldRoom);
      io.in(oldRoom.roomCode).emit('system-message', { text: `${nickname} left the room.` });
      if (wasPublic) {
        scheduleRoomsUpdated();
      }
    }
    callback?.({ success: true });
  });

  on('join-room', (payload, callback) => {
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
        // Lobby hosts that leave must hand the room over, or Start stays dead.
        reassignHostIfNeeded(oldRoom, oldPlayer.id);
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
    callback?.({ success: true, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility });
    scheduleRoomsUpdated();
  });

  on('set-setting', (payload = {}, callback) => {
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
    if (room.visibility === 'public') {
      // Seat counts / settings show in the public directory.
      scheduleRoomsUpdated();
    }
  });

  on('set-player-appearance', (payload = {}, callback) => {
    const { color, nickname } = payload;
    const avatarGrid = normalizeAvatarGrid(payload.avatarGrid);
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) {
      return callback?.({ success: false, error: 'Room not found.' });
    }
    const result = room.game.setPlayerAppearance(socket.id, { color, nickname, avatarGrid });
    // gameLogic owns appearance-uniqueness rejection; forward its exact
    // { success, error? } shape so the client can surface the reason.
    if (result?.success) {
      emitRoomState(room);
    }
    callback?.(result);
  });

  on('start-game', (_, callback) => {
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
    scheduleRoomsUpdated();
  });

  on('roll-dice', (_, callback) => {
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

  on('purchase-property', (payload = {}, callback) => {
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

  on('decline-property', (payload = {}, callback) => {
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

  on('auction-bid', (payload = {}, callback) => {
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

  on('auction-pass', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.passAuction(socket.id);
    if (result?.success && room.game.auction?.active) {
      scheduleAuctionFinish(room);
    }
    emitRoomState(room);
    callback?.({ success: result?.success ?? false, error: result?.error });
  });

  on('end-turn', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.endTurn(socket.id);
    emitRoomState(room);
    callback?.({ success: result?.success ?? false, error: result?.error });
  });

  on('manage-property', (payload = {}, callback) => {
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

  on('propose-trade', (payload, callback) => {
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

  on('respond-trade', (payload, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.respondToTrade(socket.id, payload);
    emitRoomState(room);
    callback?.({ success: result?.success ?? false, error: result?.error, accepted: result?.accepted });
  });

  on('propose-player-contract', (payload = {}, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.proposePlayerContract(socket.id, payload);
    emitRoomState(room);
    if (result?.success && result.contract) {
      const target = room.game.getPlayerById(result.contract.toPlayerId);
      if (target?.socketId) io.to(target.socketId).emit('player-contract-offer', { contract: result.contract });
    }
    reply(callback, { success: result?.success ?? false, error: result?.error, contract: result?.contract });
  });

  on('start-patrol-run', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to sync Parlor Patrol achievements.' });
    if (!allowSocialAction(account.id, 'patrol-run')) return reply(callback, { success: false, error: 'Too many patrol runs. Try again in a minute.' });
    const runToken = crypto.randomBytes(24).toString('base64url');
    patrolRuns.set(runToken, { accountId: account.id, socketId: socket.id, startedAt: Date.now(), submitted: false });
    reply(callback, { success: true, runToken });
  });

  on('finish-patrol-run', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    const runToken = String(payload.runToken || '').trim();
    const run = patrolRuns.get(runToken);
    if (!account || !run || run.accountId !== account.id || run.socketId !== socket.id || run.submitted) {
      return reply(callback, { success: false, error: 'That patrol run is no longer available.' });
    }
    const elapsed = Date.now() - run.startedAt;
    if (elapsed < 500 || elapsed > PATROL_RUN_MAX_MS + 30 * 1000) {
      patrolRuns.delete(runToken);
      return reply(callback, { success: false, error: 'That patrol run expired before it could be verified.' });
    }
    const submittedScore = Math.max(0, Math.min(100000, Math.floor(Number(payload.score) || 0)));
    // Night Shift cannot score faster than one resolved target every quarter
    // second. Clamp impossible client claims instead of letting a forged
    // leaderboard result become an account achievement.
    const maxPlausibleScore = Math.min(100000, Math.max(0, Math.ceil(Math.min(elapsed, PATROL_RUN_MAX_MS) / 250) * 300));
    const score = Math.min(submittedScore, maxPlausibleScore);
    const misses = Math.max(0, Math.min(999, Math.floor(Number(payload.misses) || 0)));
    run.submitted = true;
    patrolRuns.delete(runToken);
    const result = accountStore.recordPatrolResult(account.id, { score, misses });
    if (!result.success) return reply(callback, result);
    const candidates = [];
    if (score >= 10) candidates.push({ accountId: account.id, achievementId: 'patrol-rookie', title: 'PATROL ROOKIE', rarity: 'COMMON', body: 'You scored 10 in Parlor Patrol.' });
    if (score >= 50) candidates.push({ accountId: account.id, achievementId: 'patrol-regular', title: 'PATROL REGULAR', rarity: 'UNCOMMON', body: 'You scored 50 in Parlor Patrol.' });
    if (score > 0 && misses === 0) candidates.push({ accountId: account.id, achievementId: 'clean-run', title: 'CLEAN RUN', rarity: 'EPIC', body: 'You finished a patrol run without missing a hostile target.' });
    if (result.aceRuns >= 3) candidates.push({ accountId: account.id, achievementId: 'patrol-ace', title: 'PATROL ACE', rarity: 'RARE', body: 'You beat your saved personal best three times.' });
    candidates.forEach(candidate => recordVerifiedAchievement(candidate, `patrol_${runToken}`));
    const snapshot = accountStore.getAccountSnapshot(account.id);
    if (snapshot) socket.emit('account-sync', { account: snapshot });
    reply(callback, { success: true, score, misses, best: result.best, aceRuns: result.aceRuns });
  });

  on('respond-player-contract', (payload = {}, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.respondPlayerContract(socket.id, payload.accept === true, payload.requestId);
    emitRoomState(room);
    if (result?.success && result.contract) {
      const other = room.game.getPlayerById(result.contract.fromPlayerId);
      if (other?.socketId) io.to(other.socketId).emit('player-contract-update', { contract: result.contract });
    }
    reply(callback, { success: result?.success ?? false, error: result?.error, contract: result?.contract, accepted: result?.accepted });
  });

  on('repay-player-contract', (payload = {}, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.repayPlayerContract(socket.id, payload);
    emitRoomState(room);
    reply(callback, { success: result?.success ?? false, error: result?.error, contract: result?.contract });
  });

  on('cancel-player-contract', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const contract = room.game.pendingPlayerContract;
    const player = room.getPlayerBySocket(socket.id);
    if (!contract || !player || contract.fromPlayerId !== player.id) return reply(callback, { success: false, error: 'No pending contract to cancel.' });
    room.game.pendingPlayerContract = null;
    room.game.feedMessage(player.nickname + ' canceled the player contract.');
    emitRoomState(room);
    reply(callback, { success: true });
  });

  on('pay-jail-fine', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.payJailFine(socket.id);
    emitRoomState(room);
    if (result?.message) {
      io.in(room.roomCode).emit('system-message', { text: result.message });
    }
    reply(callback, { success: result?.success ?? false, error: result?.error });
  });

  on('use-jail-free', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.useJailFree(socket.id);
    emitRoomState(room);
    if (result?.message) io.in(room.roomCode).emit('system-message', { text: result.message });
    reply(callback, { success: result?.success ?? false, error: result?.error });
  });

  on('get-bank-loan-offer', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const offer = room.getBankLoanOffer(socket.id);
    reply(callback, { success: offer?.available ?? false, error: offer?.reason, offer });
  });

  on('take-bank-loan', (payload = {}, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.takeBankLoan(socket.id, payload.requestId);
    emitRoomState(room);
    if (result?.message) io.in(room.roomCode).emit('system-message', { text: result.message });
    reply(callback, { success: result?.success ?? false, error: result?.error, loan: result?.loan });
  });

  on('repay-bank-loan', (payload = {}, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.repayBankLoan(socket.id, payload);
    emitRoomState(room);
    reply(callback, { success: result?.success ?? false, error: result?.error, loan: result?.loan });
  });

  on('get-economy-snapshot', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    reply(callback, { success: Boolean(player), error: player ? undefined : 'Player not found.', economy: player ? room.game.economySnapshot(player.id) : null });
  });

  on('place-casino-bet', (payload = {}, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.placeCasinoBet(socket.id, payload.color, payload.stake, payload.requestId);
    emitRoomState(room);
    if (result?.success) io.in(room.roomCode).emit('system-message', { text: `${room.game.getPlayerBySocket(socket.id)?.nickname || 'Player'} settled a casino spin.` });
    reply(callback, { success: result?.success ?? false, error: result?.error, result: result?.result, economy: result?.economy });
  });

  on('market-order', (payload = {}, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.tradeMarket(socket.id, payload.instrumentId, payload.side, payload.quantity, payload.requestId);
    emitRoomState(room);
    reply(callback, { success: result?.success ?? false, error: result?.error, order: result?.order, economy: result?.economy });
  });

  on('vote-global-event', (payload = {}, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.voteGlobalEvent(socket.id, payload.choiceId);
    emitRoomState(room);
    reply(callback, { success: result?.success ?? false, error: result?.error });
  });

  on('declare-bankruptcy', (_, callback) => {
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.declareBankruptcy(socket.id);
    emitRoomState(room);
    reply(callback, { success: result?.success ?? false, error: result?.error });
  });

  on('send-chat', (payload = {}, callback) => {
    const text = normalizeChatText(payload.text);
    const room = getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    if (!text) {
      return reply(callback, { success: false, error: 'Message cannot be empty.' });
    }
    if (player?.accountId && room.game.players.some(other => other.accountId && other.id !== player.id && socialStore.areBlocked(player.accountId, other.accountId))) {
      return reply(callback, { success: false, error: 'You cannot message a blocked player in this room.' });
    }
    const now = Date.now();
    const lastSent = chatLastSent.get(socket.id) || 0;
    if (now - lastSent < CHAT_COOLDOWN_MS) {
      return reply(callback, { success: false, error: 'Please wait before sending another message.' });
    }
    chatLastSent.set(socket.id, now);
    io.in(room.roomCode).emit('chat-message', { text, nickname: player?.nickname || 'Guest', senderId: player?.id || null });
    reply(callback, { success: true });
  });

  on('get-social-data', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to use social features.' });
    reply(callback, { success: true, social: socialSummary(account.id) });
  });

  on('get-self-profile', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view your profile.' });
    reply(callback, { success: true, account: accountStore.getAccountSnapshot(account.id) });
  });

  on('get-friends', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view friends.' });
    const social = socialSummary(account.id);
    reply(callback, { success: true, friends: social.friends, requests: social.requests, outgoing: social.outgoing });
  });

  on('get-friend-requests', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view friend requests.' });
    const social = socialSummary(account.id);
    reply(callback, { success: true, requests: social.requests, outgoing: social.outgoing });
  });

  on('get-notifications', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view notifications.' });
    reply(callback, { success: true, notifications: socialStore.listFor(account.id).notifications });
  });

  on('send-friend-request', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Create an account before sending friend requests.' });
    if (!allowSocialAction(account.id, 'friend-request')) return reply(callback, { success: false, error: 'Too many requests. Try again in a minute.' });
    const target = payload.targetAccountId
      ? accountStore.getPublicAccountById(payload.targetAccountId)
      : accountStore.findAccountByUsername(payload.username);
    if (!target) return reply(callback, { success: false, error: 'Player not found.' });
    const targetAccount = accountStore.getAccountById(target.id);
    const relationship = socialStore.friendshipBetween(account.id, target.id);
    if (targetAccount?.privacy?.friendRequests === 'nobody') return reply(callback, { success: false, error: 'This player is not accepting friend requests.' });
    if (targetAccount?.privacy?.friendRequests === 'friends') {
      const viewerGraph = socialStore.listFor(account.id);
      const targetGraph = socialStore.listFor(target.id);
      const mutual = viewerGraph.friends.some(friendId => targetGraph.friends.includes(friendId));
      if (!mutual && relationship?.status !== 'accepted') return reply(callback, { success: false, error: 'This player accepts requests from friends of friends.' });
    }
    const result = socialStore.requestFriend(account.id, target.id);
    if (result.success) {
      notifyAccount(target.id, { kind: 'friend-request', title: 'FRIEND REQUEST', body: `${account.displayName} sent you a friend request.`, metadata: { friendshipId: result.friendship.id, accountId: account.id } });
      emitSocialUpdate(account.id);
      emitSocialUpdate(target.id);
    }
    reply(callback, result);
  });

  on('respond-friend-request', (payload = {}, callback) => {
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

  on('remove-friend', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage friends.' });
    const result = socialStore.removeFriend(account.id, payload.otherAccountId);
    if (result.success) emitSocialUpdate(account.id), emitSocialUpdate(payload.otherAccountId);
    reply(callback, result);
  });

  on('block-player', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage blocks.' });
    const result = socialStore.blockPlayer(account.id, payload.otherAccountId);
    if (result.success) emitSocialUpdate(account.id), emitSocialUpdate(payload.otherAccountId);
    reply(callback, result);
  });

  on('report-player', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to report a player.' });
    const result = socialStore.reportPlayer(account.id, payload.otherAccountId, payload.reason);
    reply(callback, result);
  });

  on('get-public-player-card', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    const target = payload.accountId ? accountStore.getPublicAccountById(payload.accountId) : accountStore.findAccountByUsername(payload.username);
    if (!target) return reply(callback, { success: false, error: 'Player not found.' });
    if (viewer && viewer.id !== target.id && socialStore.areBlocked(viewer.id, target.id)) return reply(callback, { success: false, error: 'This player is unavailable.' });
    const card = publicPlayerCard(target.id, viewer?.id || null);
    const relationship = viewer ? socialStore.friendshipBetween(viewer.id, target.id) : null;
    const canSeePrivateMatches = viewer?.id === target.id || relationship?.status === 'accepted';
    const canSeeRecentMatches = canSeePrivateMatches || target.privacy?.history === 'public';
    reply(callback, {
      success: true,
      player: card ? { ...card, historyPrivate: !canSeeRecentMatches || card.historyPrivate, historyFriendsOnly: !canSeeRecentMatches && card.historyFriendsOnly, recentMatches: accountStore.getPublicMatchSummaries(target.id, canSeePrivateMatches, 5) } : card,
      relationship: relationship ? relationship.status : 'none'
    });
  });

  on('search-players', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    if (viewer && !allowSocialAction(viewer.id, 'player-search')) return reply(callback, { success: false, error: 'Too many searches. Try again in a minute.' });
    const query = String(payload.query || '').trim().toLowerCase().slice(0, 32);
    if (query.length < 3) return reply(callback, { success: true, players: [] });
    const exact = payload.exact === true;
    const players = [...accountStore.accounts.values()]
      .filter(account => (exact ? account.username === query : account.username.includes(query)) && (!viewer || account.id === viewer.id || !socialStore.areBlocked(viewer.id, account.id)))
      .slice(0, 20)
      .map(account => ({ id: account.id, username: account.username, displayName: account.displayName, color: account.color, avatarGrid: account.avatarGrid }));
    reply(callback, { success: true, players });
  });

  on('get-match-history', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    const target = payload.accountId ? accountStore.getAccountById(payload.accountId) : viewer;
    if (!target) return reply(callback, { success: false, error: 'Player not found.' });
    const friendship = viewer ? socialStore.friendshipBetween(viewer.id, target.id) : null;
    const canSeePrivateHistory = viewer?.id === target.id || friendship?.status === 'accepted';
    const allowed = canSeePrivateHistory || target.privacy?.history === 'public';
    if (!allowed) return reply(callback, { success: false, error: 'Match history is visible to the owner and accepted friends.' });
    if (viewer?.id !== target.id && target.privacy?.history === 'private') return reply(callback, { success: false, error: 'This player keeps match history private.' });
    const records = matchStore.listForAccount(target.id);
    const effectiveRecords = (records.length ? records : accountStore.getMatchHistory(target.id))
      .filter(record => canSeePrivateHistory || record.roomVisibility !== 'private');
    const history = viewer?.id === target.id
      ? effectiveRecords
      : effectiveRecords.map(record => ({
        matchId: record.matchId,
        completedAt: record.completedAt,
        roundCount: record.roundCount,
        roomVisibility: record.roomVisibility,
        participants: record.participants.map(participant => ({
          displayNameAtMatch: participant.displayNameAtMatch,
          finalPlacement: participant.finalPlacement,
          propertyCount: participant.propertyCount,
          bankrupt: participant.bankrupt,
          isViewedPlayer: participant.accountId === target.id,
          sharedWithViewer: Boolean(viewer?.id && record.participants.some(entry => entry.accountId === viewer.id))
        })),
        globalEvents: record.globalEvents,
        eventCombinations: record.eventCombinations,
        tradesCompleted: record.tradesCompleted,
        auctionsCompleted: record.auctionsCompleted
      }));
    reply(callback, { success: true, history });
  });

  on('get-recent-players', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view recent players.' });
    const seen = new Set();
    const recent = [];
    const recentCutoff = Math.max(Date.now() - 30 * 24 * 60 * 60 * 1000, Date.parse(accountStore.getRecentClearedAt(account.id) || '') || 0);
    const recentMatches = matchStore.listForAccount(account.id, 50);
    const fallbackMatches = recentMatches.length ? recentMatches : accountStore.getMatchHistory(account.id);
    fallbackMatches.filter(record => Date.parse(record.completedAt || '') >= recentCutoff).forEach(record => {
      record.participants.forEach(participant => {
        if (!participant.accountId || participant.accountId === account.id || seen.has(participant.accountId)) return;
        const player = accountStore.getPublicAccountById(participant.accountId);
        if (!player) return;
        seen.add(participant.accountId);
        recent.push({
          id: player.id,
          username: player.username,
          displayName: player.displayName,
          color: player.color,
          avatarGrid: player.avatarGrid,
          lastPlayedAt: record.completedAt,
          matchId: record.matchId
        });
      });
    });
    reply(callback, { success: true, players: recent.slice(0, 20) });
  });

  on('clear-recent-players', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to clear recent players.' });
    const result = accountStore.clearRecentPlayers(payload.sessionToken);
    if (result.success) emitSocialUpdate(account.id);
    reply(callback, result);
  });

  on('cancel-friend-request', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage friend requests.' });
    const result = socialStore.cancelFriendRequest(account.id, payload.friendshipId);
    if (result.success) emitSocialUpdate(account.id);
    reply(callback, result);
  });

  on('get-leaderboard', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    const metric = ['wins', 'games', 'rate', 'achievements', 'mythical', 'bankruptcies', 'events', 'auctions', 'rent', 'casino', 'market', 'playerloans', 'equity', 'loans', 'patrol'].includes(payload.metric) ? payload.metric : 'wins';
    const scope = ['all', 'month', 'friends'].includes(payload.scope) ? payload.scope : 'all';
    const options = { since: scope === 'month' ? Date.now() - (30 * 24 * 60 * 60 * 1000) : null };
    if (scope === 'friends') {
      if (!viewer) return reply(callback, { success: false, error: 'Sign in to view friend rankings.' });
      const graph = socialStore.listFor(viewer.id);
      options.accountIds = [viewer.id, ...graph.friends];
    }
    reply(callback, { success: true, metric, scope, rows: accountStore.getLeaderboard(metric, options) });
  });

  on('get-leaderboard-snapshot', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    const scope = ['all', 'month', 'friends'].includes(payload.scope) ? payload.scope : 'all';
    const options = { since: scope === 'month' ? Date.now() - (30 * 24 * 60 * 60 * 1000) : null };
    if (scope === 'friends') {
      if (!viewer) return reply(callback, { success: false, error: 'Sign in to view friend rankings.' });
      const graph = socialStore.listFor(viewer.id);
      options.accountIds = [viewer.id, ...graph.friends];
    }
    const snapshot = accountStore.getLeaderboardSnapshot(undefined, options);
    reply(callback, { success: true, scope, ...snapshot });
  });

  on('send-room-invite', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    const room = getRoomForSocket(socket, callback);
    if (!account || !room) return;
    if (!allowSocialAction(account.id, 'room-invite')) return reply(callback, { success: false, error: 'Too many invites. Try again in a minute.' });
    const target = accountStore.getPublicAccountById(payload.targetAccountId);
    if (!target) return reply(callback, { success: false, error: 'Player not found.' });
    const targetAccount = accountStore.getAccountById(target.id);
    if (targetAccount?.privacy?.roomInvites === 'nobody') return reply(callback, { success: false, error: 'This player is not accepting room invites.' });
    if (socialStore.friendshipBetween(account.id, target.id)?.status !== 'accepted') return reply(callback, { success: false, error: 'Room invites are available to accepted friends.' });
    const result = socialStore.createInvite({ roomCode: room.roomCode, roomName: room.roomName, visibility: room.visibility, senderId: account.id, recipientId: target.id });
    if (result.success) {
      notifyAccount(target.id, { kind: 'room-invite', title: 'ROOM INVITE', body: `${account.displayName} invited you to ${room.roomName}.`, metadata: { inviteId: result.invite.id, roomName: room.roomName, visibility: room.visibility } });
      emitSocialUpdate(account.id);
      emitSocialUpdate(target.id);
    }
    reply(callback, result);
  });

  on('respond-room-invite', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage room invites.' });
    const invite = socialStore.getInvite(account.id, payload.inviteId);
    if (payload.accept === true) {
      if (!invite) return reply(callback, { success: false, error: 'That room invite has expired.' });
      const room = roomManager.getRoom(invite.roomCode);
      if (!room) return reply(callback, { success: false, error: 'That room no longer exists.' });
      if (room.game.started) return reply(callback, { success: false, error: 'That round has already started.' });
      if (!room.game.canJoin()) return reply(callback, { success: false, error: 'That room is full.' });
      const clientId = String(payload.clientId || '').trim();
      if (!clientId) return reply(callback, { success: false, error: 'A client session is required to join.' });
      const oldRoom = roomManager.getRoomBySocket(socket.id);
      if (oldRoom && oldRoom.roomCode !== room.roomCode) {
        const oldPlayer = oldRoom.getPlayerBySocket(socket.id);
        if (oldPlayer && !oldRoom.game.started) {
          oldRoom.game.removePlayerBySocket(socket.id);
          reassignHostIfNeeded(oldRoom, oldPlayer.id);
          emitRoomState(oldRoom);
        } else if (oldPlayer) {
          oldPlayer.disconnected = true;
          oldPlayer.socketId = null;
          reassignHostIfNeeded(oldRoom, oldPlayer.id);
          emitRoomState(oldRoom);
        }
      }
      for (const existingRoom of [...socket.rooms]) {
        if (existingRoom !== socket.id) socket.leave(existingRoom);
      }
      const joined = room.addOrReconnectPlayer({
        clientId,
        socketId: socket.id,
        nickname: account.displayName,
        color: account.color,
        avatarGrid: normalizeAvatarGrid(account.avatarGrid),
        accountId: account.id
      });
      if (!joined.success) return reply(callback, { success: false, error: joined.error });
      roomManager.socketRoom.set(socket.id, room);
      socket.join(room.roomCode);
      const result = socialStore.respondInvite(account.id, payload.inviteId, true);
      if (result.success) {
        emitSocialUpdate(account.id);
        emitRoomState(room);
        io.in(room.roomCode).emit('system-message', { text: account.displayName + ' joined from a room invite.' });
        emitPendingInteractions(room, socket, joined.player);
        return reply(callback, { ...result, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility });
      }
      return reply(callback, result);
    }
    const result = socialStore.respondInvite(account.id, payload.inviteId, payload.accept === true);
    if (result.success) emitSocialUpdate(account.id);
    reply(callback, result);
  });

  on('mark-notification-read', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage notifications.' });
    const result = socialStore.markNotificationRead(account.id, payload.notificationId);
    if (result.success) emitSocialUpdate(account.id);
    reply(callback, result);
  });

  on('disconnect', () => {
    chatLastSent.delete(socket.id);
    patrolRuns.forEach((run, token) => { if (run.socketId === socket.id) patrolRuns.delete(token); });
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

// Last-resort crash guards. Every known throw site is caught at its seam
// (handler scaffold, bot timer try/catch); if anything still escapes, log
// it loudly and stay alive for the players already connected instead of
// taking every room down with one bad stack.
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
