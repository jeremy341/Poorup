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
import {
  normalizeRoomCode,
  normalizeAvatarGrid,
  normalizeChatText,
  buildRoomParticipant,
  buildCreateRoomRequest,
  validateCreateRoomRequest,
  validateJoinRoomRequest,
  toRoomCreationOptions,
  toJoinPlayerInfo,
  matchHistoryPrivacyError,
  summarizeMatchHistoryRecordForViewer
} from './roomSetup.js';
import { createSafeEmitter, reply } from './socketHandlerSupport.js';
import { createSocialApi } from './socketSocialApi.js';
import { createRuntime } from './socketRuntime.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';

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

const social = createSocialApi({ io, accountStore, socialStore, matchStore, achievementStore });
const runtime = createRuntime({ io, roomManager, accountStore, socialStore, matchStore, achievementStore, botAdvisor, social });

io.on('connection', (socket) => {
  console.log('A socket connected:', socket.id);

  const on = createSafeEmitter(socket);

  registerGameSocketHandlers(on, socket, runtime);

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
      runtime.emitRoomState(room);
    }
    reply(callback, result);
  });

  on('restore-session', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    const { clientId } = payload;
    runtime.clearDisconnectTimer(clientId);
    const room = roomManager.restoreConnection(clientId, socket.id);
    if (room) {
      for (const r of [...socket.rooms]) {
        if (r !== socket.id && r !== room.roomCode) {
          socket.leave(r);
        }
      }
      socket.join(room.roomCode);
      if (account?.id) socket.data.accountId = account.id;
      runtime.emitRoomState(room);
      runtime.emitPendingInteractions(room, socket, room.game.getPlayerByClient(clientId));
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
    const account = runtime.accountFromPayload(payload);
    const request = buildCreateRoomRequest(payload, account);
    if (request.accountId) socket.data.accountId = request.accountId;
    const validationError = validateCreateRoomRequest(request);
    if (validationError) {
      return reply(callback, { success: false, error: validationError });
    }
    const existingRoom = request.requestedRoomCode ? roomManager.getRoom(request.requestedRoomCode) : null;
    if (existingRoom) {
      // A room with no connected humans must not lock its private code for
      // the full GC grace period — reclaim it and let the creator take over.
      if (!existingRoom.hasConnectedHumans()) {
        runtime.destroyRoom(existingRoom);
      } else {
        return reply(callback, { success: false, error: 'That private room code is already in use. Choose another.' });
      }
    }
    runtime.clearDisconnectTimer(clientId);

    const previousRoom = roomManager.getRoomByClient(clientId);
    const departedPlayerId = previousRoom?.game.getPlayerByClient(clientId)?.id;
    const oldRoom = roomManager.leaveRoomByClient(clientId, socket.id);
    if (oldRoom) {
      if (departedPlayerId) {
        runtime.reassignHostIfNeeded(oldRoom, departedPlayerId);
      }
      runtime.emitRoomState(oldRoom);
    }

    runtime.leaveAllGameRooms(socket);

    const room = roomManager.createRoom(toRoomCreationOptions(request, clientId, socket.id));
    socket.join(room.roomCode);
    runtime.emitRoomState(room);
    socket.emit('system-message', { text: 'Room created. Waiting for players...' });
    reply(callback, { success: true, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility });
    runtime.scheduleRoomsUpdated();
  });

  on('leave-room', (payload = {}, callback) => {
    const { clientId } = payload || {};
    if (!clientId) {
      return reply(callback, { success: false, error: 'A client session is required to leave.' });
    }
    runtime.clearDisconnectTimer(clientId);
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
        runtime.reassignHostIfNeeded(oldRoom, departedId);
      }
      socket.leave(oldRoom.roomCode);
      runtime.emitRoomState(oldRoom);
      io.in(oldRoom.roomCode).emit('system-message', { text: `${nickname} left the room.` });
      if (wasPublic) {
        runtime.scheduleRoomsUpdated();
      }
    }
    reply(callback, { success: true });
  });

  on('join-room', (payload, callback) => {
    const roomCode = normalizeRoomCode(payload?.roomCode);
    const account = runtime.accountFromPayload(payload);
    const participant = buildRoomParticipant(payload, account);
    if (participant.accountId) socket.data.accountId = participant.accountId;
    const { clientId } = payload || {};
    const validationError = validateJoinRoomRequest({ roomCode, nickname: participant.nickname });
    if (validationError) {
      return reply(callback, { success: false, error: validationError });
    }
    runtime.clearDisconnectTimer(clientId);
    const room = roomManager.getRoom(roomCode);
    if (!room) {
      return reply(callback, { success: false, error: 'Room not found.' });
    }

    runtime.leaveAllGameRooms(socket);

    runtime.detachSocketFromOtherRoom(socket, room);

    const result = room.addOrReconnectPlayer(toJoinPlayerInfo(participant, clientId, socket.id));
    if (!result.success) {
      return reply(callback, { success: false, error: result.error });
    }
    roomManager.socketRoom.set(socket.id, room);
    socket.join(room.roomCode);
    runtime.emitRoomState(room);
    runtime.emitPendingInteractions(room, socket, result.player);
    io.in(room.roomCode).emit('system-message', { text: `${participant.nickname} joined the room.` });
    reply(callback, { success: true, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility });
    runtime.scheduleRoomsUpdated();
  });

  on('set-setting', (payload = {}, callback) => {
    const { key, value } = payload;
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    if (!player || room.hostId !== player.id) {
      return reply(callback, { success: false, error: 'Only the host can change settings.' });
    }
    if (room.game.started) {
      return reply(callback, { success: false, error: 'Game settings can only be changed before the game starts.' });
    }
    room.setRoomSetting(key, value);
    runtime.emitRoomState(room);
    reply(callback, { success: true });
    if (room.visibility === 'public') {
      // Seat counts / settings show in the public directory.
      runtime.scheduleRoomsUpdated();
    }
  });

  on('set-player-appearance', (payload = {}, callback) => {
    const { color, nickname } = payload;
    const avatarGrid = normalizeAvatarGrid(payload.avatarGrid);
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) {
      return reply(callback, { success: false, error: 'Room not found.' });
    }
    const result = room.game.setPlayerAppearance(socket.id, { color, nickname, avatarGrid });
    // gameLogic owns appearance-uniqueness rejection; forward its exact
    // { success, error? } shape so the client can surface the reason.
    if (result?.success) {
      runtime.emitRoomState(room);
    }
    reply(callback, result);
  });

  on('start-game', (_, callback) => {
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    if (!player || room.hostId !== player.id) {
      return reply(callback, { success: false, error: 'Only the host can start the game.' });
    }
    const result = room.startGame();
    if (!result.success) {
      return reply(callback, { success: false, error: result.error });
    }
    runtime.emitRoomState(room);
    io.in(room.roomCode).emit('system-message', { text: 'The game has started.' });
    reply(callback, { success: true });
    runtime.scheduleRoomsUpdated();
  });

  on('start-patrol-run', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to sync Parlor Patrol achievements.' });
    if (!social.allowSocialAction(account.id, 'patrol-run')) return reply(callback, { success: false, error: 'Too many patrol runs. Try again in a minute.' });
    const runToken = crypto.randomBytes(24).toString('base64url');
    social.patrolRuns.set(runToken, { accountId: account.id, socketId: socket.id, startedAt: Date.now(), submitted: false });
    reply(callback, { success: true, runToken });
  });

  on('finish-patrol-run', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    const runToken = String(payload.runToken || '').trim();
    const invalid = social.patrolRunError(socket.id, account, runToken);
    if (invalid) return reply(callback, { success: false, error: invalid });
    const run = social.patrolRuns.get(runToken);
    const elapsed = Date.now() - run.startedAt;
    if (!social.patrolRunPlausible(elapsed)) {
      social.patrolRuns.delete(runToken);
      return reply(callback, { success: false, error: 'That patrol run expired before it could be verified.' });
    }
    const submittedScore = Math.max(0, Math.min(100000, Math.floor(Number(payload.score) || 0)));
    const score = Math.min(submittedScore, social.maxPlausiblePatrolScore(elapsed));
    const misses = Math.max(0, Math.min(999, Math.floor(Number(payload.misses) || 0)));
    run.submitted = true;
    social.patrolRuns.delete(runToken);
    const result = accountStore.recordPatrolResult(account.id, { score, misses });
    if (!result.success) return reply(callback, result);
    const candidates = social.patrolAchievementCandidates(account, score, misses, result);
    candidates.forEach(candidate => social.recordVerifiedAchievement(candidate, `patrol_${runToken}`));
    const snapshot = accountStore.getAccountSnapshot(account.id);
    if (snapshot) socket.emit('account-sync', { account: snapshot });
    reply(callback, { success: true, score, misses, best: result.best, aceRuns: result.aceRuns });
  });

  on('send-chat', (payload = {}, callback) => {
    const text = normalizeChatText(payload.text);
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    if (!text) {
      return reply(callback, { success: false, error: 'Message cannot be empty.' });
    }
    if (social.chatBlockedInRoom(room, player)) {
      return reply(callback, { success: false, error: 'You cannot message a blocked player in this room.' });
    }
    if (social.chatRateLimited(socket.id)) {
      return reply(callback, { success: false, error: 'Please wait before sending another message.' });
    }
    io.in(room.roomCode).emit('chat-message', { text, nickname: player?.nickname || 'Guest', senderId: player?.id || null });
    reply(callback, { success: true });
  });

  on('get-social-data', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to use social features.' });
    reply(callback, { success: true, social: social.socialSummary(account.id) });
  });

  on('get-self-profile', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view your profile.' });
    reply(callback, { success: true, account: accountStore.getAccountSnapshot(account.id) });
  });

  on('get-friends', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view friends.' });
    const summary = social.socialSummary(account.id);
    reply(callback, { success: true, friends: summary.friends, requests: summary.requests, outgoing: summary.outgoing });
  });

  on('get-friend-requests', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view friend requests.' });
    const summary = social.socialSummary(account.id);
    reply(callback, { success: true, requests: summary.requests, outgoing: summary.outgoing });
  });

  on('get-notifications', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view notifications.' });
    reply(callback, { success: true, notifications: socialStore.listFor(account.id).notifications });
  });

  on('send-friend-request', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Create an account before sending friend requests.' });
    if (!social.allowSocialAction(account.id, 'friend-request')) return reply(callback, { success: false, error: 'Too many requests. Try again in a minute.' });
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
      social.notifyAccount(target.id, { kind: 'friend-request', title: 'FRIEND REQUEST', body: `${account.displayName} sent you a friend request.`, metadata: { friendshipId: result.friendship.id, accountId: account.id } });
      social.emitSocialUpdate(account.id);
      social.emitSocialUpdate(target.id);
    }
    reply(callback, result);
  });

  on('respond-friend-request', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage friend requests.' });
    const result = socialStore.respondFriend(account.id, payload.friendshipId, payload.accept === true);
    if (result.success) {
      const otherId = result.friendship.requesterId;
      const other = accountStore.getPublicAccountById(otherId);
      social.notifyAccount(otherId, { kind: 'friend-response', title: result.friendship.status === 'accepted' ? 'FRIEND REQUEST ACCEPTED' : 'FRIEND REQUEST DECLINED', body: `${account.displayName} ${result.friendship.status === 'accepted' ? 'accepted' : 'declined'} your friend request.`, metadata: { accountId: account.id } });
      social.emitSocialUpdate(account.id);
      social.emitSocialUpdate(otherId);
      result.other = other ? { accountId: other.id, displayName: other.displayName } : null;
    }
    reply(callback, result);
  });

  on('remove-friend', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage friends.' });
    const result = socialStore.removeFriend(account.id, payload.otherAccountId);
    if (result.success) {
      social.emitSocialUpdate(account.id);
      social.emitSocialUpdate(payload.otherAccountId);
    }
    reply(callback, result);
  });

  on('block-player', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage blocks.' });
    const result = socialStore.blockPlayer(account.id, payload.otherAccountId);
    if (result.success) {
      social.emitSocialUpdate(account.id);
      social.emitSocialUpdate(payload.otherAccountId);
    }
    reply(callback, result);
  });

  on('report-player', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to report a player.' });
    const result = socialStore.reportPlayer(account.id, payload.otherAccountId, payload.reason);
    reply(callback, result);
  });

  on('get-public-player-card', (payload = {}, callback) => {
    const viewer = social.accountForSocket(socket, payload);
    const target = payload.accountId ? accountStore.getPublicAccountById(payload.accountId) : accountStore.findAccountByUsername(payload.username);
    if (!target) return reply(callback, { success: false, error: 'Player not found.' });
    if (viewer && viewer.id !== target.id && socialStore.areBlocked(viewer.id, target.id)) return reply(callback, { success: false, error: 'This player is unavailable.' });
    const card = social.publicPlayerCard(target.id, viewer?.id || null);
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
    const viewer = social.accountForSocket(socket, payload);
    if (viewer && !social.allowSocialAction(viewer.id, 'player-search')) return reply(callback, { success: false, error: 'Too many searches. Try again in a minute.' });
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
    const viewer = social.accountForSocket(socket, payload);
    const target = payload.accountId ? accountStore.getAccountById(payload.accountId) : viewer;
    if (!target) return reply(callback, { success: false, error: 'Player not found.' });
    const friendship = viewer ? socialStore.friendshipBetween(viewer.id, target.id) : null;
    const { canSeePrivateHistory, error: privacyError } = matchHistoryPrivacyError(viewer, target, friendship);
    if (privacyError) return reply(callback, { success: false, error: privacyError });
    const records = matchStore.listForAccount(target.id);
    const effectiveRecords = (records.length ? records : accountStore.getMatchHistory(target.id))
      .filter(record => canSeePrivateHistory || record.roomVisibility !== 'private');
    const history = viewer?.id === target.id
      ? effectiveRecords
      : effectiveRecords.map(record => summarizeMatchHistoryRecordForViewer(record, viewer?.id, target.id));
    reply(callback, { success: true, history });
  });

  on('get-recent-players', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view recent players.' });
    reply(callback, { success: true, players: social.recentPlayers(account.id).slice(0, 20) });
  });

  on('clear-recent-players', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to clear recent players.' });
    const result = accountStore.clearRecentPlayers(payload.sessionToken);
    if (result.success) social.emitSocialUpdate(account.id);
    reply(callback, result);
  });

  on('cancel-friend-request', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage friend requests.' });
    const result = socialStore.cancelFriendRequest(account.id, payload.friendshipId);
    if (result.success) social.emitSocialUpdate(account.id);
    reply(callback, result);
  });

  on('get-leaderboard', (payload = {}, callback) => {
    const viewer = social.accountForSocket(socket, payload);
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
    const viewer = social.accountForSocket(socket, payload);
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
    const account = social.accountForSocket(socket, payload);
    const room = runtime.getRoomForSocket(socket, callback);
    if (!account || !room) return;
    if (!social.allowSocialAction(account.id, 'room-invite')) return reply(callback, { success: false, error: 'Too many invites. Try again in a minute.' });
    const target = accountStore.getPublicAccountById(payload.targetAccountId);
    if (!target) return reply(callback, { success: false, error: 'Player not found.' });
    const targetAccount = accountStore.getAccountById(target.id);
    if (targetAccount?.privacy?.roomInvites === 'nobody') return reply(callback, { success: false, error: 'This player is not accepting room invites.' });
    if (socialStore.friendshipBetween(account.id, target.id)?.status !== 'accepted') return reply(callback, { success: false, error: 'Room invites are available to accepted friends.' });
    const result = socialStore.createInvite({ roomCode: room.roomCode, roomName: room.roomName, visibility: room.visibility, senderId: account.id, recipientId: target.id });
    if (result.success) {
      social.notifyAccount(target.id, { kind: 'room-invite', title: 'ROOM INVITE', body: `${account.displayName} invited you to ${room.roomName}.`, metadata: { inviteId: result.invite.id, roomName: room.roomName, visibility: room.visibility } });
      social.emitSocialUpdate(account.id);
      social.emitSocialUpdate(target.id);
    }
    reply(callback, result);
  });

  on('respond-room-invite', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage room invites.' });
    const invite = socialStore.getInvite(account.id, payload.inviteId);
    if (payload.accept === true) {
      return reply(callback, runtime.acceptRoomInvite(socket, account, invite, payload));
    }
    const result = socialStore.respondInvite(account.id, payload.inviteId, payload.accept === true);
    if (result.success) social.emitSocialUpdate(account.id);
    reply(callback, result);
  });

  on('mark-notification-read', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage notifications.' });
    const result = socialStore.markNotificationRead(account.id, payload.notificationId);
    if (result.success) social.emitSocialUpdate(account.id);
    reply(callback, result);
  });

  socket.on('disconnect', () => {
    runtime.handleSocketDisconnect(socket);
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
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
