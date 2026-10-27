// The social socket domain: chat, friends/blocks, invites, notifications,
// player cards, search, match history, leaderboards, and Parlor Patrol.
// Every ack payload, error string, and emit order is wire-identical to the
// original server.js handlers; the high-cc handlers (friend-request privacy,
// player-card visibility, search, history, invites) became guard chains in
// the propertyApi.js style.
import crypto from 'crypto';
import { listMatchRecordsForAccount } from './matchHistoryAdapter.js';
import { PARLOR_PATROL_ENABLED, PARLOR_PATROL_OFF_MESSAGE } from './accountStore.js';
import { reply } from './socketHandlerSupport.js';
import { authAttemptKey } from './serverSocketAccount.js';
import { normalizeChatText, matchHistoryPrivacyError, summarizeMatchHistoryRecordForViewer } from './roomSetup.js';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const LEADERBOARD_METRICS = Object.freeze([
  'wins', 'games', 'rate', 'achievements', 'mythical', 'bankruptcies',
  'events', 'auctions', 'rent', 'casino', 'market', 'playerloans',
  'equity', 'loans',
  ...(PARLOR_PATROL_ENABLED ? ['patrol'] : []),
]);

// Rankings walk every account's match history, so a computed board is reused for
// a short while and only a bounded number of recomputes is allowed per client.
const LEADERBOARD_CACHE_TTL_MS = 30_000;
const LEADERBOARD_CACHE_MAX = 128;
const TOO_MANY_REQUESTS = { success: false, error: 'Too many requests. Try again in a minute.' };
const LEADERBOARD_BUSY ={ success: false, error: 'Rankings are busy. Try again shortly.' };
const leaderboardCaches = new WeakMap();

const PLAYER_NOT_FOUND ={ success: false, error: 'Player not found.' };
const ACCOUNT_DELETION_PENDING = { success: false, code: 'ACCOUNT_DELETION_PENDING', error: 'Account deletion is pending.' };

// Public social references use the already-public username rather than the
// internal account UUID. Keep the existing wire field names while ensuring
// accountStore IDs stay server-side.
export function publicSearchProfile(account) {
  return { id: account.username, username: account.username, displayName: account.displayName, color: account.color, avatarGrid: account.avatarGrid };
}

export function publicLeaderboardRow(row) {
  if (!row || typeof row !== 'object') return row;
  const fields = ['displayName', 'username', 'color', 'avatarGrid', 'value', 'games', 'wins', 'achievements', 'achievementScore', 'mythical', 'bankLoanRepayments', 'bankLoanDefaults', 'trend'];
  return { ...Object.fromEntries(fields.filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]])), accountId: row.username };
}

export function projectPlayerCardAccess({ card, canSeePrivateMatches, canSeeRecent, getRecentMatches = () => [] } = {}) {
  if (!card) return card;
  return {
    ...card,
    id: card.username || card.id,
    historyPrivate: !canSeeRecent || card.historyPrivate,
    historyFriendsOnly: !canSeeRecent && card.historyFriendsOnly,
    recentMatches: canSeeRecent ? getRecentMatches() : []
  };
}

function registerSocialSocketHandlers(on, socket, runtime) {
  const { accountStore, socialStore, matchStore } = runtime;
  const { accountForSocket, allowAnonymousAction, allowSocialAction, chatBlockedInRoom, chatRateLimited, completedPatrolResult, emitSocialUpdate, notifyAccount, patrolAchievementCandidates, patrolRunError, prunePatrolRuns, patrolRuns, publicPlayerCard, recentPlayers, recordVerifiedAchievement, rememberCompletedPatrolResult, socialSummary } = runtime.social;

  function restricted(account) {
    return account?.accountDeactivated === true;
  }

  // The public account view does not say whether the account asked for deletion.
  function accountDeactivated(accountId) {
    return accountStore.getAccountById(accountId)?.accountDeactivated === true;
  }

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
    if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
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
    if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
    const summary = socialSummary(account.id);
    reply(callback, { success: true, friends: summary.friends, requests: summary.requests, outgoing: summary.outgoing });
  });

  on('get-friend-requests', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view friend requests.' });
    if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
    const summary = socialSummary(account.id);
    reply(callback, { success: true, requests: summary.requests, outgoing: summary.outgoing });
  });

  on('get-notifications', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view notifications.' });
    if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
    reply(callback, { success: true, notifications: socialStore.listFor(account.id).notifications });
  });

  on('send-friend-request', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Create an account before sending friend requests.' });
    if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
    if (!allowSocialAction(account.id, 'friend-request')) return reply(callback, { success: false, error: 'Too many requests. Try again in a minute.' });
    const target = lookupTarget(payload.targetAccountId, payload.username);
    if (!target || accountDeactivated(target.id)) return reply(callback, PLAYER_NOT_FOUND);
    const rejected = friendRequestRejection(account, target);
    if (rejected) return reply(callback, { success: false, error: rejected });
    sendFriendRequest(account, target, callback);
  });

  on('respond-friend-request', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage friend requests.' });
    if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
    const result = socialStore.respondFriend(account.id, payload.friendshipId, payload.accept === true);
    if (result.success) respondFriendRequestSideEffects(account, result);
    reply(callback, result);
  });

  on('remove-friend', socialMutationHandler((id, p) => socialStore.removeFriend(id, p.otherAccountId), 'Sign in to manage friends.', true, 'remove-friend'));

  on('block-player', socialMutationHandler((id, p) => socialStore.blockPlayer(id, p.otherAccountId), 'Sign in to manage blocks.', true, 'block-player'));

  on('cancel-friend-request', socialMutationHandler((id, p) => socialStore.cancelFriendRequest(id, p.friendshipId), 'Sign in to manage friend requests.', false, 'cancel-friend-request'));

  on('mark-notification-read', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage notifications.' });
    if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
    const notificationId = String(payload.notificationId || '').trim();
    const notification = notificationId
      ? (socialStore.listFor?.(account.id)?.notifications || []).find(entry => entry?.id === notificationId)
      : null;
    // An already-read notification is not rewritten: the store write is skipped.
    if (notification?.readAt) return reply(callback, { success: true });
    if (!allowSocialAction(account.id, 'notification-read')) return reply(callback, TOO_MANY_REQUESTS);
    const result = socialStore.markNotificationRead(account.id, notificationId);
    if (!result.success) return reply(callback, result);
    emitSocialUpdate(account.id);
    reply(callback, result);
  });

  // Shared skeleton of the "store mutation then refresh the social summary"
  // handlers (remove/block/cancel/mark-read): sign-in guard, verb, refresh, ack.
  function socialMutationHandler(verb, signInError, alsoOther, budgetAction = null) {
    return function socialMutation(payload = {}, callback) {
      const account = accountForSocket(socket, payload);
      if (!account) return reply(callback, { success: false, error: signInError });
      if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
      if (budgetAction && !allowSocialAction(account.id, budgetAction)) return reply(callback, TOO_MANY_REQUESTS);
      const otherId = payload.otherAccountId ? resolveAccountId(payload.otherAccountId) : null;
      if (payload.otherAccountId && !otherId) return reply(callback, PLAYER_NOT_FOUND);
      const normalizedPayload = otherId ? { ...payload, otherAccountId: otherId } : payload;
      const result = verb(account.id, normalizedPayload);
      if (!result.success) return reply(callback, result);
      emitSocialUpdate(account.id);
      if (alsoOther && otherId) emitSocialUpdate(otherId);
      reply(callback, result);
    };
  }

  on('report-player', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to report a player.' });
    if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
    if (!allowSocialAction(account.id, 'report-player')) return reply(callback, TOO_MANY_REQUESTS);
    const otherId = resolveAccountId(payload.otherAccountId);
    if (!otherId) return reply(callback, PLAYER_NOT_FOUND);
    const result = socialStore.reportPlayer(account.id, otherId, payload.reason);
    reply(callback, result);
  });

  on('get-public-player-card', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    if (restricted(viewer)) return reply(callback, ACCOUNT_DELETION_PENDING);
    const rateError = playerCardRateError(viewer);
    if (rateError) {
      return reply(callback, { success: false, error: rateError });
    }
    const target = roomPlayerTarget(payload);
    if (!target) return reply(callback, PLAYER_NOT_FOUND);
    if (blockedCardView(viewer, target)) return reply(callback, { success: false, error: 'This player is unavailable.' });
    const relationship = viewer ? socialStore.friendshipBetween(viewer.id, target.id) : null;
    reply(callback, publicPlayerCardAck(viewer, target, relationship));
  });

  on('search-players', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    if (!searchRateAllowed(viewer)) return reply(callback, { success: false, error: 'Too many searches. Try again in a minute.' });
    const query = normalizeSearchQuery(payload.query);
    if (query.length < 3) return reply(callback, { success: true, players: [] });
    reply(callback, { success: true, players: searchMatches(query, payload.exact === true, viewer) });
  });

  on('get-match-history', (payload = {}, callback) => {
    const viewer = accountForSocket(socket, payload);
    if (restricted(viewer)) return reply(callback, ACCOUNT_DELETION_PENDING);
    const target = lookupAccountTarget(payload.accountId, viewer);
    if (!target || (target.accountDeactivated === true && target.id !== viewer?.id)) return reply(callback, PLAYER_NOT_FOUND);
    const friendship = viewer ? socialStore.friendshipBetween(viewer.id, target.id) : null;
    const { canSeePrivateHistory, error: privacyError } = matchHistoryPrivacyError(viewer, target, friendship);
    if (privacyError) return reply(callback, { success: false, error: privacyError });
    const records = effectiveMatchRecords(target.id, canSeePrivateHistory);
    reply(callback, { success: true, history: projectMatchHistory(records, viewer, target) });
  });

  on('get-recent-players', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to view recent players.' });
    if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
    reply(callback, { success: true, players: recentPlayers(account.id).slice(0, 20) });
  });

  on('clear-recent-players', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to clear recent players.' });
    if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
    const result = accountStore.clearRecentPlayersForAccount(account.id);
    if (result.success) emitSocialUpdate(account.id);
    reply(callback, result);
  });

  on('get-leaderboard', (payload = {}, callback) => {
    const metric = LEADERBOARD_METRICS.includes(payload.metric) ? payload.metric : 'wins';
    leaderboardGuardedQuery(payload, callback, (scope, options, viewer) => leaderboardAck(callback, metric, scope, options, viewer));
  });

  on('get-leaderboard-snapshot', (payload = {}, callback) => {
    leaderboardGuardedQuery(payload, callback, (scope, options, viewer) => snapshotAck(callback, scope, options, viewer));
  });

  on('send-room-invite', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to send room invites.' });
    if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const seated = room.getPlayerBySocket(socket.id);
    if (!seated || seated.accountId !== account.id) {
      return reply(callback, { success: false, error: 'Only the signed-in seat can send room invites.' });
    }
    if (!allowSocialAction(account.id, 'room-invite')) return reply(callback, { success: false, error: 'Too many invites. Try again in a minute.' });
    const targetId = resolveAccountId(payload.targetAccountId);
    const target = targetId ? accountStore.getPublicAccountById(targetId) : null;
    if (!target || accountDeactivated(target.id)) return reply(callback, PLAYER_NOT_FOUND);
    const rejected = roomInviteRejection(account, target);
    if (rejected) return reply(callback, rejected);
    sendRoomInvite(account, target, room, callback);
  });

  on('respond-room-invite', (payload = {}, callback) => {
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to manage room invites.' });
    const invite = socialStore.getInvite(account.id, payload.inviteId);
    if (payload.accept === true) {
      // A pending deletion never takes a seat (declining stays allowed).
      if (restricted(account)) return reply(callback, ACCOUNT_DELETION_PENDING);
      return reply(callback, runtime.acceptRoomInvite(socket, account, invite, payload));
    }
    const result = socialStore.respondInvite(account.id, payload.inviteId, payload.accept === true);
    if (result.success) emitSocialUpdate(account.id);
    reply(callback, result);
  });

  // The server owns the schedule and each target's one-time outcome. Client
  // messages identify an observed target; they never supply score or misses.
  const PATROL_GRACE_MS = 250;
  const PATROL_EARLY_GRACE_MS = 150;
  const patrolActionTimes = [];

  function patrolRateAllowed(callback) {
    const now = Date.now();
    while (patrolActionTimes.length && now - patrolActionTimes[0] >= 10_000) patrolActionTimes.shift();
    if (patrolActionTimes.length >= 80) { reply(callback, { success: false, error: 'Too many patrol actions. Try again shortly.' }); return false; }
    patrolActionTimes.push(now);
    return true;
  }
  const PATROL_PAUSE_LIMIT_MS = 5 * 60_000;
  const PATROL_END_RETENTION_MS = 5 * 60_000;

  socket.on?.('disconnect', () => {
    for (const [token, run] of patrolRuns) {
      if (run.socketId !== socket.id) continue;
      clearTimeout(run.timer);
      patrolRuns.delete(token);
    }
  });

  function patrolSnapshot(run) {
    return { runToken: run.token, revision: ++run.revision, serverTime: Date.now(),
      wave: run.wave, endsAt: run.waveEndsAt, score: run.score, hearts: run.hearts,
      misses: run.misses, targets: [...run.targets.values()], ended: run.ended, endReason: run.endReason || null, paused: run.pausedAt !== null };
  }

  function patrolPush(run) {
    if (patrolRuns.get(run.token) === run) socket.emit('patrol-state', patrolSnapshot(run));
  }

  function patrolTarget(run, at) {
    const roll = Math.random();
    let kind = 'helicopter';
    if (run.wave >= 4 && roll < 0.12) kind = 'airplane';
    else if (run.wave >= 3 && roll < 0.24) kind = 'beacon';
    else if ((run.wave >= 2 && roll < 0.44) || (run.wave === 1 && run.spawnIndex === 2)) kind = 'drone';
    const duration = kind === 'airplane' ? Math.max(2800, 5000 - run.wave * 180)
      : kind === 'drone' ? Math.max(3400, 5900 - run.wave * 220)
        : Math.max(4200, 7600 - run.wave * 260);
    const id = crypto.randomBytes(12).toString('base64url');
    const target = { id, kind, direction: run.sequence++ % 2 === 0 ? 'left' : 'right',
      lane: [18, 25, 32, 39, 46, 53, 60][Math.floor(Math.random() * 7)],
      duration, wave: run.wave, deliveryPending: true, offeredAt: at, readyBy: at + 10_000, spawnedAt: null, actionableAt: null, expiresAt: null };
    run.targets.set(id, target);
    const outcome = run.waveOutcomes.get(run.wave) || { pending: 0, missed: false };
    outcome.pending += 1;
    run.waveOutcomes.set(run.wave, outcome);
  }

  function patrolCloseWaves(run) {
    for (const [wave, outcome] of run.waveOutcomes) {
      if (wave >= run.wave || outcome.pending > 0) continue;
      if (!outcome.missed) run.clearedCleanWave = true;
      run.waveOutcomes.delete(wave);
    }
  }

  function patrolResolveTarget(run, target, missed) {
    const outcome = run.waveOutcomes.get(target.wave);
    if (!outcome) return;
    outcome.pending -= 1;
    if (missed) outcome.missed = true;
    patrolCloseWaves(run);
  }

  function patrolNextSpawn(run) {
    const count = Math.min(6 + run.wave * 2, 24);
    if (run.spawnIndex >= count) return Infinity;
    const interval = run.wave === 1 ? 3000 : Math.max(850, 5000 - run.wave * 220);
    return run.waveStartedAt + run.spawnIndex * interval;
  }

  function patrolAdvance(run, now = Date.now()) {
    if (run.ended || run.pausedAt !== null) return false;
    let changed = false;
    while (!run.ended) {
      const nextSpawn = patrolNextSpawn(run);
      let nextExpiry = Infinity;
      for (const target of run.targets.values()) nextExpiry = Math.min(nextExpiry, target.deliveryPending ? target.readyBy : target.expiresAt + PATROL_GRACE_MS);
      const next = Math.min(nextSpawn, nextExpiry, run.waveEndsAt);
      if (next > now) break;
      changed = true;
      if (next === nextExpiry) {
        for (const [id, target] of run.targets) {
          if (target.deliveryPending) {
            if (target.readyBy > next) continue;
            run.ended = true;
            run.endedAt = next;
            run.endReason = 'delivery-timeout';
            break;
          }
          if (target.expiresAt + PATROL_GRACE_MS > next) continue;
          run.targets.delete(id);
          patrolResolveTarget(run, target, true);
          if (target.kind !== 'beacon') { run.misses += 1; run.hearts -= 1; }
          if (run.hearts <= 0) { run.hearts = 0; run.ended = true; run.endedAt = next; run.endReason = 'no-hearts'; break; }
        }
      } else if (next === run.waveEndsAt) {
        run.wave += 1;
        patrolCloseWaves(run);
        run.waveStartedAt = run.waveEndsAt;
        run.waveEndsAt += 60_000;
        run.spawnIndex = 0;
      } else {
        patrolTarget(run, nextSpawn);
        run.spawnIndex += 1;
      }
    }
    return changed;
  }

  function patrolArm(run) {
    clearTimeout(run.timer);
    if (patrolRuns.get(run.token) !== run) return;
    let due;
    if (run.ended) due = run.endedAt + PATROL_END_RETENTION_MS;
    else if (run.pausedAt !== null) due = run.pausedAt + PATROL_PAUSE_LIMIT_MS - (run.initialWaiting ? 0 : run.pausedTotal);
    else {
      due = Math.min(run.waveEndsAt, patrolNextSpawn(run));
      for (const target of run.targets.values()) due = Math.min(due, target.deliveryPending ? target.readyBy : target.expiresAt + PATROL_GRACE_MS);
    }
    run.timer = setTimeout(() => {
      if (patrolRuns.get(run.token) !== run) return;
      if (run.ended || run.pausedAt !== null) { patrolRuns.delete(run.token); return; }
      if (patrolAdvance(run)) patrolPush(run);
      patrolArm(run);
    }, Math.max(1, due - Date.now()));
    run.timer.unref?.();
  }

  function patrolGet(payload, callback) {
    const account = accountForSocket(socket, payload);
    const token = String(payload.runToken || '').trim();
    const invalid = patrolRunError(socket.id, account, token);
    if (invalid) { reply(callback, { success: false, error: invalid }); return null; }
    const run = patrolRuns.get(token);
    const now = Date.now();
    const expiredPause = run.pausedAt !== null && (run.initialWaiting ? 0 : run.pausedTotal) + now - run.pausedAt >= PATROL_PAUSE_LIMIT_MS;
    const expiredEnd = run.ended && now - run.endedAt >= PATROL_END_RETENTION_MS;
    if (expiredPause || expiredEnd) {
      clearTimeout(run.timer);
      patrolRuns.delete(token);
      reply(callback, { success: false, error: 'That patrol run expired.' });
      return null;
    }
    return { account, run };
  }

  on('start-patrol-run', (payload = {}, callback) => {
    if (!PARLOR_PATROL_ENABLED) return reply(callback, { success: false, error: PARLOR_PATROL_OFF_MESSAGE });
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to sync Parlor Patrol achievements.' });
    if (!allowSocialAction(account.id, 'patrol-run')) return reply(callback, { success: false, error: 'Too many patrol runs. Try again in a minute.' });
    prunePatrolRuns();
    for (const [token, previous] of patrolRuns) {
      if (previous.socketId === socket.id) { clearTimeout(previous.timer); patrolRuns.delete(token); }
    }
    if ([...patrolRuns.values()].some(run => run.accountId === account.id)) return reply(callback, { success: false, error: 'A patrol is already active on another connection.' });
    if (patrolRuns.size >= 2000) return reply(callback, { success: false, error: 'Patrol is busy. Try again shortly.' });
    const token = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    const run = { token, accountId: account.id, socketId: socket.id, startedAt: now, revision: 0,
      wave: 1, waveStartedAt: now, waveEndsAt: now + 60_000, spawnIndex: 0, sequence: 0,
      targets: new Map(), waveOutcomes: new Map(), clearedCleanWave: false, score: 0, hearts: 3, misses: 0, pausedAt: now, pausedTotal: 0, initialWaiting: true, ended: false };
    patrolRuns.set(token, run);
    patrolArm(run);
    return reply(callback, { success: true, ...patrolSnapshot(run) });
  });

  on('ready-patrol-target', (payload = {}, callback) => {
    if (!PARLOR_PATROL_ENABLED) return reply(callback, { success: false, error: PARLOR_PATROL_OFF_MESSAGE });
    if (!patrolRateAllowed(callback)) return;
    const context = patrolGet(payload, callback);
    if (!context) return;
    const { run } = context;
    if (patrolAdvance(run)) patrolPush(run);
    const target = run.targets.get(String(payload.targetId || ''));
    const now = Date.now();
    if (run.ended || run.pausedAt !== null || !target) {
      patrolArm(run);
      return reply(callback, { success: false, error: 'That target is no longer available.' });
    }
    if (target.deliveryPending) {
      const visibleAt = target.offeredAt + Math.round(target.duration * 0.16);
      if (now < visibleAt - PATROL_EARLY_GRACE_MS) return reply(callback, { success: false, error: 'That target is not ready yet.' });
      target.deliveryPending = false;
      target.spawnedAt = now - Math.round(target.duration * 0.16);
      target.actionableAt = now;
      target.expiresAt = target.spawnedAt + target.duration;
      target.readyBy = null;
    }
    patrolArm(run);
    return reply(callback, { success: true, ...patrolSnapshot(run) });
  });

  on('hit-patrol-target', (payload = {}, callback) => {
    if (!PARLOR_PATROL_ENABLED) return reply(callback, { success: false, error: PARLOR_PATROL_OFF_MESSAGE });
    if (!patrolRateAllowed(callback)) return;
    const context = patrolGet(payload, callback);
    if (!context) return;
    const { run } = context;
    if (patrolAdvance(run)) patrolPush(run);
    const target = run.targets.get(String(payload.targetId || ''));
    if (run.ended || run.pausedAt !== null || !target || target.deliveryPending || Date.now() < target.actionableAt - PATROL_EARLY_GRACE_MS || Date.now() > target.expiresAt + PATROL_GRACE_MS) {
      patrolArm(run);
      return reply(callback, { success: false, error: 'That target is no longer available.' });
    }
    run.targets.delete(target.id);
    patrolResolveTarget(run, target, false);
    const points = target.kind === 'helicopter' ? 100 + target.wave * 25
      : target.kind === 'drone' ? 75 + target.wave * 10
        : target.kind === 'airplane' ? 180 + target.wave * 20 : 50 + target.wave * 5;
    run.score = Math.min(Number.MAX_SAFE_INTEGER, run.score + points);
    const snapshot = patrolSnapshot(run);
    patrolArm(run);
    return reply(callback, { success: true, ...snapshot, targetId: target.id, outcome: 'hit', remainingHP: 0, points });
  });

  on('pause-patrol-run', (payload = {}, callback) => {
    if (!PARLOR_PATROL_ENABLED) return reply(callback, { success: false, error: PARLOR_PATROL_OFF_MESSAGE });
    if (!patrolRateAllowed(callback)) return;
    const context = patrolGet(payload, callback);
    if (!context) return;
    const { run } = context;
    patrolAdvance(run);
    if (!run.ended && run.pausedAt === null) {
      if (run.pausedTotal >= PATROL_PAUSE_LIMIT_MS) return reply(callback, { success: false, error: 'This patrol has used its pause time.' });
      run.pausedAt = Date.now();
    }
    patrolArm(run);
    return reply(callback, { success: true, ...patrolSnapshot(run) });
  });

  on('resume-patrol-run', (payload = {}, callback) => {
    if (!PARLOR_PATROL_ENABLED) return reply(callback, { success: false, error: PARLOR_PATROL_OFF_MESSAGE });
    if (!patrolRateAllowed(callback)) return;
    const context = patrolGet(payload, callback);
    if (!context) return;
    const { run } = context;
    if (run.pausedAt !== null) {
      const delta = Date.now() - run.pausedAt;
      if ((run.initialWaiting ? 0 : run.pausedTotal) + delta >= PATROL_PAUSE_LIMIT_MS) { clearTimeout(run.timer); patrolRuns.delete(run.token); return reply(callback, { success: false, error: 'That paused patrol run expired.' }); }
      if (!run.initialWaiting) run.pausedTotal += delta;
      run.initialWaiting = false;
      run.waveStartedAt += delta;
      run.waveEndsAt += delta;
      for (const target of run.targets.values()) {
        target.offeredAt += delta;
        if (target.deliveryPending) target.readyBy += delta;
        else { target.spawnedAt += delta; target.actionableAt += delta; target.expiresAt += delta; }
      }
      run.pausedAt = null;
      patrolAdvance(run);
    }
    patrolArm(run);
    return reply(callback, { success: true, ...patrolSnapshot(run) });
  });

  on('finish-patrol-run', (payload = {}, callback) => {
    if (!PARLOR_PATROL_ENABLED) return reply(callback, { success: false, error: PARLOR_PATROL_OFF_MESSAGE });
    const retryAccount = accountForSocket(socket, payload);
    const retryToken = String(payload.runToken || '').trim();
    const completed = retryAccount && completedPatrolResult(retryAccount.id, retryToken);
    if (completed) return reply(callback, completed);
    const context = patrolGet(payload, callback);
    if (!context) return;
    const { account, run } = context;
    patrolAdvance(run);
    clearTimeout(run.timer);
    patrolRuns.delete(run.token);
    const result = accountStore.recordPatrolResult(account.id, { score: run.score, misses: run.misses });
    if (!result.success) return reply(callback, result);
    const cleanRun = run.hearts === 0 && run.clearedCleanWave;
    const candidates = patrolAchievementCandidates(account, run.score, { ...result, cleanRun });
    candidates.forEach(candidate => {
      try { recordVerifiedAchievement(candidate, `patrol_${run.token}`); }
      catch (error) { console.error('Patrol achievement settlement failed:', error?.message || 'unknown error'); }
    });
    const response = { success: true, score: run.score, misses: run.misses, best: result.best, aceRuns: result.aceRuns };
    rememberCompletedPatrolResult(account.id, run.token, response);
    const snapshot = accountStore.getAccountSnapshot(account.id);
    if (snapshot) socket.emit('account-sync', { account: snapshot });
    return reply(callback, response);
  });

  function lookupTarget(accountId, username) {
    if (accountId) {
      const account = accountStore.getAccountById(accountId) || accountStore.findAccountByUsername(accountId);
      return account ? accountStore.getPublicAccountById(account.id) : null;
    }
    return accountStore.findAccountByUsername(username);
  }

  function lookupAccountTarget(accountId, viewer) {
    if (accountId) return accountStore.getAccountById(accountId) || accountStore.findAccountByUsername(accountId);
    return viewer;
  }

  function resolveAccountId(reference) {
    const account = accountStore.getAccountById(reference) || accountStore.findAccountByUsername(reference);
    return account?.id || null;
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

  function playerCardRateError(viewer) {
    // A signed-in card read costs the account bucket as well: the card walks
    // the target's account and match history.
    const allowed = viewer
      ? allowSocialAction(viewer.id, 'player-card')
      : allowAnonymousAction(authAttemptKey(socket), 'player-card');
    return allowed ? null : 'Too many player card requests. Try again in a minute.';
  }

  function roomPlayerTarget(payload) {
    const roomPlayer = payload.roomPlayerId
      ? runtime.roomManager.getRoomBySocket(socket.id)?.game.getPlayerById(String(payload.roomPlayerId))
      : null;
    if (roomPlayer?.accountId) return accountStore.getPublicAccountById(roomPlayer.accountId);
    return lookupTarget(payload.accountId, payload.username);
  }

  function searchRateAllowed(viewer) {
    return viewer ? allowSocialAction(viewer.id, 'player-search') : allowAnonymousAction(authAttemptKey(socket), 'player-search');
  }

  function publicPlayerCardAck(viewer, target, relationship) {
    const canSeePrivateMatches = canSeePrivateHistory(viewer, target, relationship);
    const context = { card: publicPlayerCard(target.id, viewer?.id || null), target, canSeePrivateMatches };
    // The card follows the same gates as get-match-history: a private history is
    // the owner's alone, and a deactivated account (masked) shows no matches.
    const masked = context.card?.accountDeactivated === true && viewer?.id !== target.id;
    context.canSeeRecent = !masked && !matchHistoryPrivacyError(viewer, target, relationship).error;
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
    return projectPlayerCardAccess({
      card: context.card,
      canSeePrivateMatches: context.canSeePrivateMatches,
      canSeeRecent: context.canSeeRecent,
      getRecentMatches: () => accountStore.getPublicMatchSummaries(context.target.id, context.canSeePrivateMatches, 5)
    });
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
    if (candidate.accountDeactivated === true && candidate.id !== viewer?.id) return false;
    if (!viewer) return true;
    if (candidate.id === viewer.id) return true;
    return !socialStore.areBlocked(viewer.id, candidate.id);
  }

  function effectiveMatchRecords(targetId, canSeePrivateHistory) {
    return listMatchRecordsForAccount({ accountId: targetId, accountStore, matchStore })
      .filter(record => visibleHistoryRecord(record, canSeePrivateHistory));
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
    if (restricted(viewer)) return reply(callback, ACCOUNT_DELETION_PENDING);
    const scope = leaderboardScope(payload.scope);
    const options = { ...leaderboardWindow(scope), primaryMetric: payload.metric };
    if (scope !== 'friends') return buildAck(scope, options, viewer);
    const accountIds = friendScopeAccountIds(viewer);
    if (!accountIds) return reply(callback, { success: false, error: 'Sign in to view friend rankings.' });
    options.accountIds = accountIds;
    buildAck(scope, options, viewer);
  }

  function leaderboardCache() {
    if (!leaderboardCaches.has(accountStore)) leaderboardCaches.set(accountStore, new Map());
    return leaderboardCaches.get(accountStore);
  }

  // Global and month boards are the same for every viewer, so one computed board
  // serves everyone for a while. A recompute spends the caller's budget; when it
  // is spent the last board is served, or the request is refused if there is none.
  function cachedLeaderboard(key, viewer, compute) {
    const cache = leaderboardCache();
    const at = typeof runtime.now === 'function' ? runtime.now() : Date.now();
    const hit = cache.get(key);
    if (hit && at - hit.at < LEADERBOARD_CACHE_TTL_MS) return compute.serve(hit.ack);
    const allowed = viewer ? allowSocialAction(viewer.id, 'leaderboard') : allowAnonymousAction(authAttemptKey(socket), 'leaderboard');
    if (!allowed) return hit ? compute.serve(hit.ack) : LEADERBOARD_BUSY;
    const ack = compute();
    cache.delete(key);
    cache.set(key, { at, ack });
    while (cache.size > LEADERBOARD_CACHE_MAX) cache.delete(cache.keys().next().value);
    return compute.serve(ack);
  }

  // An account that keeps its achievements private is not ranked by them, and
  // its achievement figures are not published on any other board.
  function withAchievementPrivacy(metric, rows) {
    const ranksAchievements = metric === 'achievements' || metric === 'mythical';
    return rows.flatMap(row => {
      const owner = accountStore.getAccountById(row?.accountId);
      if (!owner || accountDeactivated(row.accountId)) return [];
      if (owner?.privacy?.achievements !== 'private') return [row];
      if (ranksAchievements) return [];
      const rest = { ...row };
      ['achievements', 'achievementScore', 'mythical'].forEach(field => delete rest[field]);
      return [rest];
    });
  }

  function leaderboardAck(callback, metric, scope, options, viewer) {
    const compute = () => ({ success: true, metric, scope, rows: accountStore.getLeaderboard(metric, options) });
    compute.serve = ack => ({ ...ack, rows: withAchievementPrivacy(metric, ack.rows || []).map(publicLeaderboardRow) });
    if (scope === 'friends') {
      // A friends board is per viewer and never cached, so every recompute
      // costs the caller's budget.
      if (!viewer || !allowSocialAction(viewer.id, 'leaderboard')) return reply(callback, LEADERBOARD_BUSY);
      return reply(callback, compute.serve(compute()));
    }
    reply(callback, cachedLeaderboard(`board|${scope}|${metric}`, viewer, compute));
  }

  function snapshotAck(callback, scope, options, viewer) {
    const primaryMetric = LEADERBOARD_METRICS.includes(options.primaryMetric) ? options.primaryMetric : null;
    const compute = () => {
      const snapshot = accountStore.getLeaderboardSnapshot(undefined, { ...options, primaryMetric });
      return {
        success: true,
        scope,
        ...snapshot,
        metrics: snapshot.metrics || {}
      };
    };
    compute.serve = ack => ({ ...ack, metrics: Object.fromEntries(Object.entries(ack.metrics || {}).map(([name, rows]) => [name, withAchievementPrivacy(name, rows).map(publicLeaderboardRow)])) });
    if (scope === 'friends') {
      if (!viewer || !allowSocialAction(viewer.id, 'leaderboard')) return reply(callback, LEADERBOARD_BUSY);
      return reply(callback, compute.serve(compute()));
    }
    reply(callback, cachedLeaderboard(`snapshot|${scope}|${primaryMetric || ''}`, viewer, compute));
  }

  function roomInviteRejection(account, target) {
    const targetAccount = accountStore.getAccountById(target.id);
    if (targetAccount?.privacy?.roomInvites === 'nobody') return { success: false, error: 'This player is not accepting room invites.' };
    const friendship = socialStore.friendshipBetween(account.id, target.id);
    if (friendship?.status !== 'accepted') return { success: false, error: 'Room invites are available to accepted friends.' };
    return null;
  }

  function sendRoomInvite(account, target, room, callback) {
    const result = socialStore.createInvite({ roomId: room.publicId, roomCode: room.roomCode, roomName: room.roomName, visibility: room.visibility, senderId: account.id, recipientId: target.id });
    if (!result.success) return reply(callback, result);
    notifyAccount(target.id, { kind: 'room-invite', title: 'ROOM INVITE', body: `${account.displayName} invited you to ${room.roomName}.`, metadata: { inviteId: result.invite.id, roomName: room.roomName, visibility: room.visibility } });
    emitSocialUpdate(account.id);
    emitSocialUpdate(target.id);
    reply(callback, result);
  }
}

export { registerSocialSocketHandlers };
