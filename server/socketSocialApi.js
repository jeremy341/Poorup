// The social/achievement side of the socket layer as functions bound to
// their stores: rate buckets, the social summary projection, public player
// cards, notifications, verified achievements, and the patrol run
// bookkeeping. socketRuntime.js wires an instance into the room lifecycle
// (recordRoomStats settles matches through recordVerifiedAchievement), and
// serverSocketSocial.js registers the wire handlers on top of it.
import crypto from 'crypto';
import { resolveAccount } from './socketHandlerSupport.js';

const SOCIAL_RATE_WINDOW_MS = 60 * 1000;
const SOCIAL_RATE_LIMIT = 30;
const CHAT_COOLDOWN_MS = 500;
// Night Shift can continue through several one-minute waves. Keep one signed
// run token alive long enough for a normal session without making it durable.
const PATROL_RUN_MAX_MS = 10 * 60 * 1000;
const MYTHICAL_ANNOUNCEMENT_KEYS_CAP = 500;

function recentTimestamps(buckets, key) {
  const now = Date.now();
  const stored = buckets.get(key) || [];
  return stored.filter(timestamp => now - timestamp < SOCIAL_RATE_WINDOW_MS);
}

function maxPlausiblePatrolScore(elapsed) {
  const cappedElapsed = Math.min(elapsed, PATROL_RUN_MAX_MS);
  const plausible = Math.ceil(cappedElapsed / 250) * 300;
  return Math.min(100000, Math.max(0, plausible));
}

function createSocialApi(deps) {
  const { io, accountStore, socialStore, matchStore, achievementStore } = deps;
  const chatLastSent = new Map();
  const patrolRuns = new Map();
  const socialRateBuckets = new Map();
  const mythicalAnnouncementKeys = new Set();

  function allowSocialAction(accountId, action) {
    if (!accountId) return false;
    const key = `${accountId}:${action}`;
    const recent = recentTimestamps(socialRateBuckets, key);
    if (recent.length >= SOCIAL_RATE_LIMIT) {
      socialRateBuckets.set(key, recent);
      return false;
    }
    // An emptied bucket must not linger forever keyed by accountId:action —
    // with no prune these entries accumulate for the process lifetime.
    if (!recent.length) socialRateBuckets.delete(key);
    recent.push(Date.now());
    socialRateBuckets.set(key, recent);
    return true;
  }

  function accountForSocket(socket, payload = {}) {
    return resolveAccount(accountStore, socket, payload);
  }

  function socketsForAccount(accountId) {
    if (!accountId) return [];
    return [...io.sockets.sockets.values()].filter(candidate => candidate.data?.accountId === accountId);
  }

  function notifyAccount(accountId, notification) {
    if (!accountId) return;
    socialStore.addNotification(accountId, notification);
    socketsForAccount(accountId).forEach(candidate => candidate.emit('social-notification', notification));
  }

  function emitSocialUpdate(accountId) {
    const social = socialSummary(accountId);
    socketsForAccount(accountId).forEach(candidate => candidate.emit('social-update', social));
  }

  function socialSummary(accountId) {
    const raw = socialStore.listFor(accountId);
    return {
      friends: raw.friends.map(id => publicPlayerCard(id, accountId)).filter(Boolean),
      requests: raw.requests.map(request => ({ ...request, from: publicPlayerCard(request.requesterId, accountId) })).filter(request => request.from),
      outgoing: raw.outgoing.map(request => ({ ...request, to: publicPlayerCard(request.addresseeId, accountId) })).filter(request => request.to),
      invites: raw.invites.map(invite => withInviteSender(invite, accountId)).filter(invite => invite.sender),
      notifications: raw.notifications,
      recentPlayers: recentPlayers(accountId).slice(0, 20)
    };
  }

  function withInviteSender(invite, accountId) {
    return { id: invite.id, roomName: invite.roomName, visibility: invite.visibility, expiresAt: invite.expiresAt, sender: publicPlayerCard(invite.senderId, accountId) };
  }

  // Everyone the account shared a table with inside the recency window, in
  // match order, deduped by account — shared by the social summary and the
  // get-recent-players ack.
  function recentPlayers(accountId) {
    const seen = new Set();
    const list = [];
    fallbackMatchRecords(accountId)
      .filter(record => Date.parse(record.completedAt || '') >= recentCutoff(accountId))
      .forEach(record => record.participants.forEach(participant => addRecentPlayer({ seen, list, accountId }, record, participant)));
    return list;
  }

  function addRecentPlayer(context, record, participant) {
    if (!participant.accountId) return;
    if (participant.accountId === context.accountId) return;
    if (context.seen.has(participant.accountId)) return;
    const player = accountStore.getPublicAccountById(participant.accountId);
    if (!player) return;
    context.seen.add(participant.accountId);
    context.list.push({
      id: player.id,
      username: player.username,
      displayName: player.displayName,
      color: player.color,
      avatarGrid: player.avatarGrid,
      lastPlayedAt: record.completedAt,
      matchId: record.matchId
    });
  }

  function fallbackMatchRecords(accountId) {
    const recentMatches = matchStore.listForAccount(accountId, 50);
    if (recentMatches.length) return recentMatches;
    return accountStore.getMatchHistory(accountId);
  }

  function recentCutoff(accountId) {
    const clearedAt = accountStore.getRecentClearedAt(accountId) || '';
    return Math.max(Date.now() - 30 * 24 * 60 * 60 * 1000, Date.parse(clearedAt) || 0);
  }

  function publicPlayerCard(accountId, viewerId = null) {
    const card = accountStore.getPublicPlayerCard(accountId);
    if (!card) return card;
    if (!viewerId) return card;
    if (viewerId === accountId) return card;
    return { ...card, mutualFriends: countMutualFriends(viewerId, accountId) };
  }

  function countMutualFriends(viewerId, accountId) {
    const viewerFriends = new Set(socialStore.listFor(viewerId).friends);
    const targetFriends = new Set(socialStore.listFor(accountId).friends);
    return [...viewerFriends].filter(id => targetFriends.has(id)).length;
  }

  function recordVerifiedAchievement(candidate, gameId) {
    if (!candidate?.accountId) return false;
    if (!candidate.achievementId) return false;
    const unlockKey = `${gameId}:${candidate.achievementId}:${candidate.accountId}`;
    const unlock = achievementStore.unlock({
      accountId: candidate.accountId,
      achievementId: candidate.achievementId,
      gameId,
      evidenceHash: crypto.createHash('sha256').update(unlockKey).digest('hex')
    });
    if (!unlock.created) return false;
    const stored = accountStore.recordAchievement(candidate.accountId, {
      id: unlock.record.achievementId,
      unlockedAt: unlock.record.unlockedAt
    });
    if (!stored.created) return false;
    announceAchievement(candidate, unlock.record, unlockKey);
    return true;
  }

  function announceAchievement(candidate, record, unlockKey) {
    const payload = {
      kind: 'achievement-unlocked',
      achievementId: record.achievementId,
      title: candidate.title,
      rarity: candidate.rarity,
      body: candidate.body,
      createdAt: record.unlockedAt
    };
    socketsForAccount(candidate.accountId).forEach(candidateSocket => candidateSocket.emit('achievement-unlocked', payload));
    notifyAccount(candidate.accountId, payload);
    if (candidate.rarity !== 'MYTHICAL') return;
    const displayName = accountStore.getPublicAccountById(candidate.accountId)?.displayName || 'A player';
    broadcastMythicalAchievement({ playerAccountId: candidate.accountId, playerDisplayName: displayName, unlockKey });
  }

  function broadcastMythicalAchievement({ playerAccountId, playerDisplayName, unlockKey }) {
    if (rememberMythicalAnnouncement(unlockKey)) return;
    const displayName = playerDisplayName || 'A player';
    const payload = { kind: 'mythical-achievement', title: 'MYTHICAL ACHIEVEMENT', body: `${displayName} unlocked a MYTHICAL ACHIEVEMENT.`, playerDisplayName: displayName, createdAt: new Date().toISOString() };
    io.emit('mythical-achievement', payload);
    notifyAccount(playerAccountId, { ...payload, body: 'Your Mythical achievement was verified and announced server-wide.' });
  }

  // Returns true when this announcement key was already broadcast (dedupe).
  // Bounded FIFO set — Sets preserve insertion order, so evicting the oldest
  // keeps memory flat without changing duplicate suppression.
  function rememberMythicalAnnouncement(unlockKey) {
    if (!unlockKey) return false;
    if (mythicalAnnouncementKeys.has(unlockKey)) return true;
    mythicalAnnouncementKeys.add(unlockKey);
    if (mythicalAnnouncementKeys.size > MYTHICAL_ANNOUNCEMENT_KEYS_CAP) {
      const oldest = mythicalAnnouncementKeys.values().next().value;
      mythicalAnnouncementKeys.delete(oldest);
    }
    return false;
  }

  // --- patrol runs (Parlor Patrol anti-cheat bookkeeping) ----------------

  function patrolRunError(socketId, account, runToken) {
    if (!account) return 'That patrol run is no longer available.';
    const run = patrolRuns.get(runToken);
    if (!run) return 'That patrol run is no longer available.';
    if (run.accountId !== account.id) return 'That patrol run is no longer available.';
    if (run.socketId !== socketId) return 'That patrol run is no longer available.';
    if (run.submitted) return 'That patrol run is no longer available.';
    return null;
  }

  function patrolRunPlausible(elapsed) {
    if (elapsed < 500) return false;
    return elapsed <= PATROL_RUN_MAX_MS + 30 * 1000;
  }

  function patrolAchievementCandidates(account, score, misses, result) {
    const candidates = [];
    if (score >= 10) candidates.push({ accountId: account.id, achievementId: 'patrol-rookie', title: 'PATROL ROOKIE', rarity: 'COMMON', body: 'You scored 10 in Parlor Patrol.' });
    if (score >= 50) candidates.push({ accountId: account.id, achievementId: 'patrol-regular', title: 'PATROL REGULAR', rarity: 'UNCOMMON', body: 'You scored 50 in Parlor Patrol.' });
    if (score > 0 && misses === 0) candidates.push({ accountId: account.id, achievementId: 'clean-run', title: 'CLEAN RUN', rarity: 'EPIC', body: 'You finished a patrol run without missing a hostile target.' });
    if (result.aceRuns >= 3) candidates.push({ accountId: account.id, achievementId: 'patrol-ace', title: 'PATROL ACE', rarity: 'RARE', body: 'You beat your saved personal best three times.' });
    return candidates;
  }

  function chatRateLimited(socketId) {
    const now = Date.now();
    const lastSent = chatLastSent.get(socketId) || 0;
    if (now - lastSent < CHAT_COOLDOWN_MS) return true;
    chatLastSent.set(socketId, now);
    return false;
  }

  function chatBlockedInRoom(room, player) {
    if (!player?.accountId) return false;
    return room.game.players.some(other => blockedRoomMember(player, other));
  }

  function blockedRoomMember(player, other) {
    if (!other.accountId) return false;
    if (other.id === player.id) return false;
    return socialStore.areBlocked(player.accountId, other.accountId);
  }

  return {
    accountForSocket,
    allowSocialAction,
    chatBlockedInRoom,
    chatLastSent,
    chatRateLimited,
    emitSocialUpdate,
    maxPlausiblePatrolScore,
    notifyAccount,
    patrolAchievementCandidates,
    patrolRunError,
    patrolRunPlausible,
    patrolRuns,
    publicPlayerCard,
    recentPlayers,
    recordVerifiedAchievement,
    socketsForAccount,
    socialSummary
  };
}

export { createSocialApi };
