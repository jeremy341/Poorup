// The social socket domain: chat, friends/blocks, invites, notifications,
// player cards, search, match history, leaderboards, and Parlor Patrol.
// Every ack payload, error string, and emit order is wire-identical to the
// original server.js handlers; the high-cc handlers (friend-request privacy,
// player-card visibility, search, history, invites) became guard chains in
// the propertyApi.js style.
import crypto from 'crypto';
import { reply } from './socketHandlerSupport.js';
import { normalizeChatText, matchHistoryPrivacyError, summarizeMatchHistoryRecordForViewer } from './roomSetup.js';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const LEADERBOARD_METRICS = ['wins', 'games', 'rate', 'achievements', 'mythical', 'bankruptcies', 'events', 'auctions', 'rent', 'casino', 'market', 'playerloans', 'equity', 'loans', 'patrol'];

const PLAYER_NOT_FOUND = { success: false, error: 'Player not found.' };

function registerSocialSocketHandlers(on, socket, runtime) {
  const { accountStore, socialStore, matchStore } = runtime;
  const { accountForSocket, allowSocialAction, chatBlockedInRoom, chatRateLimited, emitSocialUpdate, maxPlausiblePatrolScore, notifyAccount, patrolAchievementCandidates, patrolRunError, patrolRunPlausible, patrolRuns, publicPlayerCard, recentPlayers, recordVerifiedAchievement, socialSummary } = runtime.social;

  on('send-chat', (payload = {}, callback) => {
    const text = normalizeChatText(payload.text);
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    if (!text) {
      return reply(callback, { success: false, error: 'Message cannot be empty.' });
    }
    if (chatBlockedInRoom(room, player)) {
      return reply(callback, { success: false, error: 'You cannot message a blocked player in this room.' });
    }
    if (chatRateLimited(socket.id)) {
      return reply(callback, { success: false, error: 'Please wait before sending another message.' });
    }
    broadcastChatMessage(room, text, player);
    reply(callback, { success: true });
  });

  function broadcastChatMessage(room, text, player) {
    const nickname = player?.nickname || 'Guest';
    const senderId = player?.id || null;
    runtime.io.in(room.roomCode).emit('chat-message', { text, nickname, senderId });
  }

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
    const summary = socialSummary(account.id);
    reply(callback, { success: true, friends: summary.friends, requests: summary.requests, outgoing: summary.outgoing });
  });

  on('get-friend-requests', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view friend requests.' });
    const summary = socialSummary(account.id);
    reply(callback, { success: true, requests: summary.requests, outgoing: summary.outgoing });
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
    const target = lookupTarget(payload.targetAccountId, payload.username);
    if (!target) return reply(callback, PLAYER_NOT_FOUND);
    const rejected = friendRequestRejection(account, target);
    if (rejected) return reply(callback, { success: false, error: rejected });
    sendFriendRequest(account, target, callback);
  });

  on('respond-friend-request', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage friend requests.' });
    const result = socialStore.respondFriend(account.id, payload.friendshipId, payload.accept === true);
    if (result.success) respondFriendRequestSideEffects(account, result);
    reply(callback, result);
  });

  on('remove-friend', socialMutationHandler((id, p) => socialStore.removeFriend(id, p.otherAccountId), 'Sign in to manage friends.', true));

  on('block-player', socialMutationHandler((id, p) => socialStore.blockPlayer(id, p.otherAccountId), 'Sign in to manage blocks.', true));

  on('cancel-friend-request', socialMutationHandler((id, p) => socialStore.cancelFriendRequest(id, p.friendshipId), 'Sign in to manage friend requests.'));

  on('mark-notification-read', socialMutationHandler((id, p) => socialStore.markNotificationRead(id, p.notificationId), 'Sign in to manage notifications.'));

  // Shared skeleton of the "store mutation then refresh the social summary"
  // handlers (remove/block/cancel/mark-read): sign-in guard, verb, refresh, ack.
  function socialMutationHandler(verb, signInError, alsoOther) {
    return function socialMutation(payload = {}, callback) {
      const account = accountForSocket(socket, payload);
      if (!account) return reply(callback, { success: false, error: signInError });
      const result = verb(account.id, payload);
      if (!result.success) return reply(callback, result);
      emitSocialUpdate(account.id);
      if (alsoOther) emitSocialUpdate(payload.otherAccountId);
      reply(callback, result);
    };
  }

  on('report-player', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to report a player.' });
    const result = socialStore.reportPlayer(account.id, payload.otherAccountId, payload.reason);
    reply(callback, result);
  });

  on('get-public-player-card', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    const target = lookupTarget(payload.accountId, payload.username);
    if (!target) return reply(callback, PLAYER_NOT_FOUND);
    if (blockedCardView(viewer, target)) return reply(callback, { success: false, error: 'This player is unavailable.' });
    const relationship = viewer ? socialStore.friendshipBetween(viewer.id, target.id) : null;
    reply(callback, publicPlayerCardAck(viewer, target, relationship));
  });

  on('search-players', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    if (viewer && !allowSocialAction(viewer.id, 'player-search')) return reply(callback, { success: false, error: 'Too many searches. Try again in a minute.' });
    const query = normalizeSearchQuery(payload.query);
    if (query.length < 3) return reply(callback, { success: true, players: [] });
    reply(callback, { success: true, players: searchMatches(query, payload.exact === true, viewer) });
  });

  on('get-match-history', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    const target = lookupAccountTarget(payload.accountId, viewer);
    if (!target) return reply(callback, PLAYER_NOT_FOUND);
    const friendship = viewer ? socialStore.friendshipBetween(viewer.id, target.id) : null;
    const { canSeePrivateHistory, error: privacyError } = matchHistoryPrivacyError(viewer, target, friendship);
    if (privacyError) return reply(callback, { success: false, error: privacyError });
    const records = effectiveMatchRecords(target.id, canSeePrivateHistory);
    reply(callback, { success: true, history: projectMatchHistory(records, viewer, target) });
  });

  on('get-recent-players', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view recent players.' });
    reply(callback, { success: true, players: recentPlayers(account.id).slice(0, 20) });
  });

  on('clear-recent-players', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to clear recent players.' });
    const result = accountStore.clearRecentPlayers(payload.sessionToken);
    if (result.success) emitSocialUpdate(account.id);
    reply(callback, result);
  });

  on('get-leaderboard', (payload = {}, callback) => {
    const metric = LEADERBOARD_METRICS.includes(payload.metric) ? payload.metric : 'wins';
    leaderboardGuardedQuery(payload, callback, (scope, options) => leaderboardAck(callback, metric, scope, options));
  });

  on('get-leaderboard-snapshot', (payload = {}, callback) => {
    leaderboardGuardedQuery(payload, callback, (scope, options) => snapshotAck(callback, scope, options));
  });

  on('send-room-invite', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    const room = runtime.getRoomForSocket(socket, callback);
    if (!account || !room) return;
    if (!allowSocialAction(account.id, 'room-invite')) return reply(callback, { success: false, error: 'Too many invites. Try again in a minute.' });
    const target = accountStore.getPublicAccountById(payload.targetAccountId);
    if (!target) return reply(callback, PLAYER_NOT_FOUND);
    const rejected = roomInviteRejection(account, target);
    if (rejected) return reply(callback, rejected);
    sendRoomInvite(account, target, room, callback);
  });

  on('respond-room-invite', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage room invites.' });
    const invite = socialStore.getInvite(account.id, payload.inviteId);
    if (payload.accept === true) {
      return reply(callback, runtime.acceptRoomInvite(socket, account, invite, payload));
    }
    const result = socialStore.respondInvite(account.id, payload.inviteId, payload.accept === true);
    if (result.success) emitSocialUpdate(account.id);
    reply(callback, result);
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
    const invalid = patrolRunError(socket.id, account, runToken);
    if (invalid) return reply(callback, { success: false, error: invalid });
    const run = patrolRuns.get(runToken);
    const elapsed = Date.now() - run.startedAt;
    if (!patrolRunPlausible(elapsed)) {
      patrolRuns.delete(runToken);
      return reply(callback, { success: false, error: 'That patrol run expired before it could be verified.' });
    }
    finishPatrolRun({ account, run, runToken, elapsed }, payload, callback);
  });

  function finishPatrolRun(runContext, payload, callback) {
    const account = runContext.account;
    const submittedScore = Math.max(0, Math.min(100000, Math.floor(Number(payload.score) || 0)));
    const score = Math.min(submittedScore, maxPlausiblePatrolScore(runContext.elapsed));
    const misses = Math.max(0, Math.min(999, Math.floor(Number(payload.misses) || 0)));
    runContext.run.submitted = true;
    patrolRuns.delete(runContext.runToken);
    const result = accountStore.recordPatrolResult(account.id, { score, misses });
    if (!result.success) return reply(callback, result);
    const candidates = patrolAchievementCandidates(account, score, misses, result);
    candidates.forEach(candidate => recordVerifiedAchievement(candidate, `patrol_${runContext.runToken}`));
    const snapshot = accountStore.getAccountSnapshot(account.id);
    if (snapshot) socket.emit('account-sync', { account: snapshot });
    reply(callback, { success: true, score, misses, best: result.best, aceRuns: result.aceRuns });
  }

  function lookupTarget(accountId, username) {
    if (accountId) return accountStore.getPublicAccountById(accountId);
    return accountStore.findAccountByUsername(username);
  }

  function lookupAccountTarget(accountId, viewer) {
    if (accountId) return accountStore.getAccountById(accountId);
    return viewer;
  }

  function friendRequestRejection(account, target) {
    const targetAccount = accountStore.getAccountById(target.id);
    const mode = targetAccount?.privacy?.friendRequests;
    if (mode === 'nobody') return 'This player is not accepting friend requests.';
    if (mode !== 'friends') return null;
    if (hasMutualFriend(account.id, target.id)) return null;
    const relationship = socialStore.friendshipBetween(account.id, target.id);
    if (relationship?.status === 'accepted') return null;
    return 'This player accepts requests from friends of friends.';
  }

  function hasMutualFriend(accountId, targetId) {
    const viewerGraph = socialStore.listFor(accountId);
    const targetGraph = socialStore.listFor(targetId);
    return viewerGraph.friends.some(friendId => targetGraph.friends.includes(friendId));
  }

  function sendFriendRequest(account, target, callback) {
    const result = socialStore.requestFriend(account.id, target.id);
    if (result.success) announceFriendRequest(account, target, result);
    reply(callback, result);
  }

  function announceFriendRequest(account, target, result) {
    notifyAccount(target.id, { kind: 'friend-request', title: 'FRIEND REQUEST', body: `${account.displayName} sent you a friend request.`, metadata: { friendshipId: result.friendship.id, accountId: account.id } });
    emitSocialUpdate(account.id);
    emitSocialUpdate(target.id);
  }

  function respondFriendRequestSideEffects(account, result) {
    const otherId = result.friendship.requesterId;
    const other = accountStore.getPublicAccountById(otherId);
    notifyAccount(otherId, friendResponseNotification(account, result.friendship));
    emitSocialUpdate(account.id);
    emitSocialUpdate(otherId);
    result.other = other ? { accountId: other.id, displayName: other.displayName } : null;
  }

  function friendResponseNotification(account, friendship) {
    const accepted = friendship.status === 'accepted';
    return {
      kind: 'friend-response',
      title: accepted ? 'FRIEND REQUEST ACCEPTED' : 'FRIEND REQUEST DECLINED',
      body: `${account.displayName} ${accepted ? 'accepted' : 'declined'} your friend request.`,
      metadata: { accountId: account.id }
    };
  }

  function blockedCardView(viewer, target) {
    if (!viewer) return false;
    if (viewer.id === target.id) return false;
    return socialStore.areBlocked(viewer.id, target.id);
  }

  function publicPlayerCardAck(viewer, target, relationship) {
    const canSeePrivateMatches = canSeePrivateHistory(viewer, target, relationship);
    const context = { card: publicPlayerCard(target.id, viewer?.id || null), target, canSeePrivateMatches };
    context.canSeeRecent = context.canSeePrivateMatches || target.privacy?.history === 'public';
    return {
      success: true,
      player: projectCardAccess(context),
      relationship: relationship ? relationship.status : 'none'
    };
  }

  function canSeePrivateHistory(viewer, target, relationship) {
    if (viewer?.id === target.id) return true;
    return relationship?.status === 'accepted';
  }

  function projectCardAccess(context) {
    const card = context.card;
    if (!card) return card;
    return {
      ...card,
      historyPrivate: !context.canSeeRecent || card.historyPrivate,
      historyFriendsOnly: !context.canSeeRecent && card.historyFriendsOnly,
      recentMatches: accountStore.getPublicMatchSummaries(context.target.id, context.canSeePrivateMatches, 5)
    };
  }

  function normalizeSearchQuery(value) {
    return String(value || '').trim().toLowerCase().slice(0, 32);
  }

  function searchMatches(query, exact, viewer) {
    return [...accountStore.accounts.values()]
      .filter(candidate => searchNameMatches(candidate, query, exact))
      .filter(candidate => searchableByViewer(candidate, viewer))
      .slice(0, 20)
      .map(publicSearchProfile);
  }

  function searchNameMatches(candidate, query, exact) {
    if (exact) return candidate.username === query;
    return candidate.username.includes(query);
  }

  function searchableByViewer(candidate, viewer) {
    if (!viewer) return true;
    if (candidate.id === viewer.id) return true;
    return !socialStore.areBlocked(viewer.id, candidate.id);
  }

  function publicSearchProfile(account) {
    return { id: account.id, username: account.username, displayName: account.displayName, color: account.color, avatarGrid: account.avatarGrid };
  }

  function effectiveMatchRecords(targetId, canSeePrivateHistory) {
    const stored = matchStore.listForAccount(targetId);
    const source = stored.length ? stored : accountStore.getMatchHistory(targetId);
    return source.filter(record => visibleHistoryRecord(record, canSeePrivateHistory));
  }

  function visibleHistoryRecord(record, canSeePrivateHistory) {
    if (canSeePrivateHistory) return true;
    return record.roomVisibility !== 'private';
  }

  function projectMatchHistory(records, viewer, target) {
    if (viewer?.id === target.id) return records;
    return records.map(record => summarizeMatchHistoryRecordForViewer(record, viewer?.id, target.id));
  }

  function leaderboardScope(rawScope) {
    if (['all', 'month', 'friends'].includes(rawScope)) return rawScope;
    return 'all';
  }

  function leaderboardWindow(scope) {
    if (scope !== 'month') return { since: null };
    return { since: Date.now() - MONTH_MS };
  }

  function friendScopeAccountIds(viewer) {
    if (!viewer) return null;
    const graph = socialStore.listFor(viewer.id);
    return [viewer.id, ...graph.friends];
  }

  function leaderboardGuardedQuery(payload, callback, buildAck) {
    const viewer = accountForSocket(socket, payload);
    const scope = leaderboardScope(payload.scope);
    const options = leaderboardWindow(scope);
    if (scope !== 'friends') return buildAck(scope, options);
    const accountIds = friendScopeAccountIds(viewer);
    if (!accountIds) return reply(callback, { success: false, error: 'Sign in to view friend rankings.' });
    options.accountIds = accountIds;
    buildAck(scope, options);
  }

  function leaderboardAck(callback, metric, scope, options) {
    reply(callback, { success: true, metric, scope, rows: accountStore.getLeaderboard(metric, options) });
  }

  function snapshotAck(callback, scope, options) {
    const snapshot = accountStore.getLeaderboardSnapshot(undefined, options);
    reply(callback, { success: true, scope, ...snapshot });
  }

  function roomInviteRejection(account, target) {
    const targetAccount = accountStore.getAccountById(target.id);
    if (targetAccount?.privacy?.roomInvites === 'nobody') return { success: false, error: 'This player is not accepting room invites.' };
    const friendship = socialStore.friendshipBetween(account.id, target.id);
    if (friendship?.status !== 'accepted') return { success: false, error: 'Room invites are available to accepted friends.' };
    return null;
  }

  function sendRoomInvite(account, target, room, callback) {
    const result = socialStore.createInvite({ roomCode: room.roomCode, roomName: room.roomName, visibility: room.visibility, senderId: account.id, recipientId: target.id });
    if (!result.success) return reply(callback, result);
    notifyAccount(target.id, { kind: 'room-invite', title: 'ROOM INVITE', body: `${account.displayName} invited you to ${room.roomName}.`, metadata: { inviteId: result.invite.id, roomName: room.roomName, visibility: room.visibility } });
    emitSocialUpdate(account.id);
    emitSocialUpdate(target.id);
    reply(callback, result);
  }
}

export { registerSocialSocketHandlers };
