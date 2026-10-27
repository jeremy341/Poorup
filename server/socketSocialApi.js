// The social/achievement side of the socket layer as functions bound to
// their stores: rate buckets, the social summary projection, public player
// cards, notifications, verified achievements, and the patrol run
// bookkeeping. socketRuntime.js wires an instance into the room lifecycle
// (recordRoomStats settles matches through recordVerifiedAchievement), and
// serverSocketSocial.js registers the wire handlers on top of it.
import crypto from 'crypto';
import { PARLOR_PATROL_ENABLED } from './accountStore.js';
import { listMatchRecordsForAccount } from './matchHistoryAdapter.js';
import { resolveAccount } from './socketHandlerSupport.js';
import { parseCookieHeader, SESSION_COOKIE_NAME } from './sessionStore.js';

const SOCIAL_RATE_WINDOW_MS = 60 * 1000;
const SOCIAL_RATE_LIMIT = 30;
const CHAT_COOLDOWN_MS = 500;
// Night Shift can continue through several one-minute waves. Keep one signed
// run token alive long enough for a normal session without making it durable.
const PATROL_RUN_MAX_MS = 10 * 60 * 1000;
const PATROL_RUN_RETENTION_MS = PATROL_RUN_MAX_MS + 30 * 1000;
const PATROL_RUN_CAP = 2_000;
const MYTHICAL_ANNOUNCEMENT_KEYS_CAP = 500;
const UNDELIVERED_ANNOUNCEMENT_CAP = 500;
const SECRET_ACHIEVEMENT_IDS = new Set([
  'bubble-survivor', 'short-the-street', 'no-floor', 'moral-hazard',
  'grounded-tourist', 'stagflation-trader', 'compromised-council',
  'double-headline', '41st-tile', 'null-player', 'black-ledger'
]);

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
  const { io, accountStore, socialStore, matchStore, achievementStore, sessionStore } = deps;
  const chatLastSent = new Map();
  const patrolRuns = new Map();
  const socialRateBuckets = new Map();
  let lastRateSweepAt = 0;
  const mythicalAnnouncementKeys = new Set();
  const undeliveredAnnouncements = new Set();

  // Keys are one per account (or client address) and action, and a key that is
  // never used again would otherwise stay for the process lifetime. A bucket is
  // kept in timestamp order, so its last entry says whether the window is over.
  function sweepRateBuckets(at) {
    if (at - lastRateSweepAt < SOCIAL_RATE_WINDOW_MS) return;
    lastRateSweepAt = at;
    for (const [key, stamps] of socialRateBuckets) {
      if (!stamps.length || at - stamps[stamps.length - 1] >= SOCIAL_RATE_WINDOW_MS) socialRateBuckets.delete(key);
    }
  }

  function allowSocialAction(accountId, action) {
    if (!accountId) return false;
    const at = Date.now();
    sweepRateBuckets(at);
    const key = `${accountId}:${action}`;
    const recent = recentTimestamps(socialRateBuckets, key);
    if (recent.length >= SOCIAL_RATE_LIMIT) {
      socialRateBuckets.set(key, recent);
      return false;
    }
    recent.push(at);
    socialRateBuckets.set(key, recent);
    return true;
  }

  function allowAnonymousAction(identity, action) {
    const key = String(identity || '').trim().slice(0, 120);
    if (!key) return false;
    return allowSocialAction('anon:' + key, action);
  }

  function accountForSocket(socket, payload = {}) {
    const resolved = resolveAccount(accountStore, socket, payload);
    if (resolved || Object.prototype.hasOwnProperty.call(payload, 'sessionToken')) return resolved;
    const sessionId = socket.data?.sessionId;
    const cookieValue = parseCookieHeader(socket.handshake?.headers?.cookie || socket.request?.headers?.cookie || '')[SESSION_COOKIE_NAME];
    const session = sessionStore?.resolve?.(cookieValue) || (sessionId ? sessionStore?.snapshot?.().find(entry => entry.sessionId === sessionId) : null);
    if (!session?.accountId) return null;
    const account = accountStore.getAccountById(session.accountId);
    if (account) socket.data.accountId = account.id;
    return account;
  }

  // A socket keeps its account binding until it makes a call that fails to
  // authenticate, so a revoked or rotated session would keep receiving private
  // pushes. Each push re-checks the credentials the socket authenticated with: a
  // live bearer or a live cookie session is enough. A socket that holds neither
  // (nothing to re-check) is left as it was.
  function socketSessionStillValid(candidate, accountId) {
    const data = candidate.data || {};
    if (!data.sessionTokenHash && !data.sessionId) return true;
    if (data.sessionTokenHash && accountStore.accountForSessionHash?.(data.sessionTokenHash, accountId)) return true;
    return Boolean(data.sessionId && sessionStore?.hasSession?.(data.sessionId, accountId));
  }

  function socketsForAccount(accountId) {
    if (!accountId) return [];
    return [...io.sockets.sockets.values()].filter(candidate => {
      if (candidate.data?.accountId !== accountId) return false;
      if (socketSessionStillValid(candidate, accountId)) return true;
      candidate.data.accountId = null;
      candidate.data.sessionTokenHash = null;
      return false;
    });
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
    // Built once per summary so each card is O(its own friends) instead of a
    // fresh scan of every friendship row (undefined falls back to per-card scans).
    const graph = socialStore.friendshipIndex?.();
    return {
      friends: raw.friends.map(id => publicPlayerCard(id, accountId, graph)).filter(Boolean),
      requests: raw.requests.map(request => ({ ...request, from: publicPlayerCard(request.requesterId, accountId, graph) })).filter(request => request.from),
      outgoing: raw.outgoing.map(request => ({ ...request, to: publicPlayerCard(request.addresseeId, accountId, graph) })).filter(request => request.to),
      invites: raw.invites.map(invite => withInviteSender(invite, accountId, graph)).filter(invite => invite.sender),
      notifications: raw.notifications,
      recentPlayers: recentPlayers(accountId).slice(0, 20)
    };
  }

  function withInviteSender(invite, accountId, graph = null) {
    return { id: invite.id, roomName: invite.roomName, visibility: invite.visibility, expiresAt: invite.expiresAt, sender: publicPlayerCard(invite.senderId, accountId, graph) };
  }

  // Everyone the account shared a table with inside the recency window, in
  // match order, deduped by account — shared by the social summary and the
  // get-recent-players ack.
  function recentPlayers(accountId) {
    const seen = new Set();
    const list = [];
    fallbackMatchRecords(accountId)
      .filter(record => Date.parse(record.completedAt || '') >= recentCutoff(accountId))
      .forEach(record => {
        // A legacy record can reach the store without a participants array.
        const participants = Array.isArray(record?.participants) ? record.participants : [];
        participants.forEach(participant => addRecentPlayer({ seen, list, accountId }, record, participant));
      });
    return list;
  }

  function addRecentPlayer(context, record, participant) {
    if (!participant?.accountId) return;
    if (participant.accountId === context.accountId) return;
    if (context.seen.has(participant.accountId)) return;
    const player = accountStore.getPublicAccountById(participant.accountId);
    if (!player) return;
    // A deactivated account and a blocked player are not recent opponents.
    if (player.accountDeactivated === true) return;
    if (socialStore.areBlocked?.(context.accountId, participant.accountId)) return;
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
    return listMatchRecordsForAccount({ accountId, accountStore, matchStore });
  }

  function recentCutoff(accountId) {
    const clearedAt = accountStore.getRecentClearedAt(accountId) || '';
    return Math.max(Date.now() - 30 * 24 * 60 * 60 * 1000, Date.parse(clearedAt) || 0);
  }

  function publicPlayerCard(accountId, viewerId = null, graph = null) {
    const target = accountStore.getAccountById(accountId);
    if (target?.accountDeactivated === true && viewerId !== accountId) {
      return {
        id: target.username,
        username: target.username,
        displayName: 'ACCOUNT DEACTIVATED',
        color: '#5c5033',
        avatarGrid: null,
        accountDeactivated: true,
        stats: { gamesPlayed: 0, wins: 0 },
        achievements: [],
        history: []
      };
    }
    const canSeeFriendAchievements = Boolean(viewerId && viewerId !== accountId
      && target?.privacy?.achievements !== 'private'
      && (graph || socialStore).friendshipBetween(viewerId, accountId)?.status === 'accepted');
    const card = accountStore.getPublicPlayerCard(accountId, {
      includeAchievements: viewerId === accountId || canSeeFriendAchievements
    });
    if (!card) return card;
    if (!viewerId) return card;
    if (viewerId === accountId) return card;
    return { ...card, mutualFriends: countMutualFriends(viewerId, accountId, graph) };
  }

  function countMutualFriends(viewerId, accountId, graph = null) {
    if (graph) {
      const viewerSet = graph.friendIdsOf(viewerId);
      const targetSet = graph.friendIdsOf(accountId);
      const [small, large] = viewerSet.size <= targetSet.size ? [viewerSet, targetSet] : [targetSet, viewerSet];
      let shared = 0;
      for (const id of small) if (large.has(id)) shared += 1;
      return shared;
    }
    const viewerFriends = new Set(socialStore.listFor(viewerId).friends);
    const targetFriends = new Set(socialStore.listFor(accountId).friends);
    return [...viewerFriends].filter(id => targetFriends.has(id)).length;
  }

  function recordVerifiedAchievement(candidate, gameId) {
    if (!candidate?.accountId) return false;
    if (!candidate.achievementId) return false;
    const unlockKey = `${gameId}:${candidate.achievementId}:${candidate.accountId}`;
    const announcementKey = `${candidate.accountId}:${candidate.achievementId}`;
    let unlock;
    try {
      unlock = achievementStore.unlock({
        accountId: candidate.accountId,
        achievementId: candidate.achievementId,
        gameId,
        eventSequence: unlockKey,
        evidenceHash: crypto.createHash('sha256').update(unlockKey).digest('hex')
      });
    } catch (error) {
      // A failed persist rolls the unlock back; it must not abort the settlement.
      console.error('Achievement unlock failed:', error?.message || 'unknown error');
      return false;
    }
    if (!unlock.created) {
      // The unlock is already on record. A settlement that lost its
      // announcement retries it here instead of dropping it for good.
      if (unlock.record && undeliveredAnnouncements.has(announcementKey)) {
        announceAchievementBestEffort(candidate, unlock.record, unlockKey);
      }
      return false;
    }
    let stored;
    try {
      stored = accountStore.recordAchievement(candidate.accountId, {
        id: unlock.record.achievementId,
        unlockedAt: unlock.record.unlockedAt
      });
    } catch {
      rollbackAchievementUnlock(candidate, unlock);
      return false;
    }
    if (!stored?.created) {
      if (!stored?.success) rollbackAchievementUnlock(candidate, unlock);
      return false;
    }
    announceAchievementBestEffort(candidate, unlock.record, unlockKey);
    return true;
  }

  // Rolling an unlock back is best-effort: the account store refused the
  // achievement, so the unlock must not stay on record. A failing removal is
  // reported rather than thrown, because it must not escape into the
  // settlement loop and cost the remaining candidates their unlocks.
  function rollbackAchievementUnlock(candidate, unlock) {
    const achievementId = unlock?.record?.achievementId;
    if (!achievementId) return false;
    try {
      return achievementStore.remove?.(candidate.accountId, achievementId) ?? false;
    } catch (error) {
      console.error('Achievement rollback failed:', error?.message || 'unknown error');
      return false;
    }
  }

  // The unlock is already recorded, so the announcement and the notification it
  // stores are best-effort: a failing write must not escape into the
  // settlement loop and cost the remaining candidates their unlocks.
  function announceAchievementBestEffort(candidate, record, unlockKey) {
    let delivered = false;
    try {
      delivered = announceAchievement(candidate, record, unlockKey);
    } catch (error) {
      console.error('Achievement announcement failed:', error?.message || 'unknown error');
    }
    rememberAnnouncementOutcome(`${candidate.accountId}:${candidate.achievementId}`, delivered);
    return delivered;
  }

  // An announcement that was not delivered is remembered, so the next
  // settlement of the same achievement retries it. A delivered one is
  // forgotten, so nothing is announced twice. Bounded FIFO set, like the
  // mythical announcement keys.
  function rememberAnnouncementOutcome(key, delivered) {
    if (!key) return;
    if (delivered) {
      undeliveredAnnouncements.delete(key);
      return;
    }
    undeliveredAnnouncements.add(key);
    if (undeliveredAnnouncements.size > UNDELIVERED_ANNOUNCEMENT_CAP) {
      const oldest = undeliveredAnnouncements.values().next().value;
      undeliveredAnnouncements.delete(oldest);
    }
  }

  function announceAchievement(candidate, record, unlockKey) {
    const player = accountStore.getPublicAccountById(record.accountId);
    const payload = {
      kind: 'achievement-unlocked',
      playerId: record.accountId,
      playerDisplayName: player?.displayName || 'A player',
      achievementId: record.achievementId,
      title: candidate.title,
      rarity: candidate.rarity,
      body: candidate.body,
      secret: SECRET_ACHIEVEMENT_IDS.has(record.achievementId),
      titleVisible: true,
      unlockedAt: record.unlockedAt,
      createdAt: record.unlockedAt,
      gameId: record.gameId,
      eventSequence: record.eventSequence || unlockKey,
      evidenceHash: record.evidenceHash
    };
    socketsForAccount(candidate.accountId).forEach(candidateSocket => candidateSocket.emit('achievement-unlocked', payload));
    let delivered = true;
    try {
      notifyAccount(candidate.accountId, payload);
    } catch (error) {
      // A failing notification persist costs the notification only: the
      // server-wide announcement still has to go out.
      delivered = false;
      console.error('Achievement notification failed:', error?.message || 'unknown error');
    }
    if (candidate.rarity !== 'MYTHICAL') return delivered;
    const displayName = accountStore.getPublicAccountById(candidate.accountId)?.displayName || 'A player';
    broadcastMythicalAchievement({ playerAccountId: candidate.accountId, playerDisplayName: displayName, unlockKey });
    return delivered;
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

  function patrolAchievementCandidates(account, score, result) {
    const candidates = [];
    if (!PARLOR_PATROL_ENABLED) return candidates;
    if (score >= 10) candidates.push({ accountId: account.id, achievementId: 'patrol-rookie', title: 'PATROL ROOKIE', rarity: 'COMMON', body: 'You scored 10 in Parlor Patrol.' });
    if (score >= 50) candidates.push({ accountId: account.id, achievementId: 'patrol-regular', title: 'PATROL REGULAR', rarity: 'UNCOMMON', body: 'You scored 50 in Parlor Patrol.' });
    // Patrol misses are client-reported; without server-side target outcomes,
    // they cannot verify a clean-run achievement.
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

  function prunePatrolRuns() {
    const cutoff = Date.now() - PATROL_RUN_RETENTION_MS;
    patrolRuns.forEach((run, token) => {
      if (!run || Number(run.startedAt) < cutoff) patrolRuns.delete(token);
    });
    while (patrolRuns.size >= PATROL_RUN_CAP) {
      const oldest = patrolRuns.keys().next().value;
      if (!oldest) break;
      patrolRuns.delete(oldest);
    }
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
    allowAnonymousAction,
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
    prunePatrolRuns,
    patrolRuns,
    publicPlayerCard,
    recentPlayers,
    recordVerifiedAchievement,
    socialRateBucketCount: () => socialRateBuckets.size,
    socketsForAccount,
    socialSummary
  };
}

export { createSocialApi };
