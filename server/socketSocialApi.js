// The social and achievement side of the socket layer, as functions bound to their stores: rate buckets, the social summary projection,
// public player cards, notifications, verified achievements and patrol run bookkeeping. socketRuntime.js wires an instance into the room lifecycle
// (recordRoomStats settles matches through recordVerifiedAchievement), and serverSocketSocial.js registers the wire handlers on top.
import crypto from 'crypto';
import { PARLOR_PATROL_ENABLED } from './accountStore.js';
import { listMatchRecordsForAccount } from './matchHistoryAdapter.js';
import { resolveAccount } from './socketHandlerSupport.js';
import { parseCookieHeader, SESSION_COOKIE_NAME } from './sessionStore.js';

const SOCIAL_RATE_WINDOW_MS = 60 * 1000;
const SOCIAL_RATE_LIMIT = 30;
const CHAT_COOLDOWN_MS = 500;
const MYTHICAL_ANNOUNCEMENT_KEYS_CAP = 500;
const UNDELIVERED_ANNOUNCEMENT_CAP = 500;
const VERIFIED_ACHIEVEMENT_RETRY_DELAYS_MS = [1000, 5000, 15000, 30000, 60000];
const VERIFIED_ACHIEVEMENT_RETRY_CAP = 500;
const ACHIEVEMENT_RECONCILIATION_INTERVAL_MS = 60_000;
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

function createSocialApi(deps) {
  const { io, accountStore, socialStore, matchStore, achievementStore, sessionStore } = deps;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;
  const setIntervalFn = deps.setIntervalFn || setInterval;
  const clearIntervalFn = deps.clearIntervalFn || clearInterval;
  const chatLastSent = new Map();
  const patrolRuns = new Map();
  const completedPatrolRuns = new Map();
  const socialRateBuckets = new Map();
  let lastRateSweepAt = 0;
  const mythicalAnnouncementKeys = new Set();
  const undeliveredAnnouncements = new Set();
  const verifiedAchievementRetries = new Map();
  let achievementReconciliationInterval = null;

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

  // A socket keeps its account binding until a call fails to authenticate, so a revoked or rotated session would keep receiving private
  // pushes. Each push re-checks the credentials the socket authenticated with (a live bearer or cookie session is enough). A socket
  // holding neither has nothing to re-check and is left as it was.
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
  // match order, deduped by account. Shared by the social summary and the
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
      includeAchievements: viewerId === accountId || canSeeFriendAchievements,
      owner: viewerId === accountId
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

  function recordVerifiedAchievementAttempt(candidate, gameId, { retry = false } = {}) {
    if (!candidate?.accountId || !candidate.achievementId) return { retryable: false, created: false };
    if (retry && typeof accountStore.getAccountById === 'function') {
      let account;
      try {
        account = accountStore.getAccountById(candidate.accountId);
      } catch (error) {
        console.error('Achievement retry account lookup failed:', error?.message || 'unknown error');
        return { retryable: true, created: false };
      }
      if (!account || account.accountDeactivated === true || account.deletionRequestedAt) return { retryable: false, created: false };
    }
    const unlockKey = `${gameId}:${candidate.achievementId}:${candidate.accountId}`;
    const announcementKey = `${candidate.accountId}:${candidate.achievementId}`;
    let unlock;
    try {
      unlock = achievementStore.unlock({
        accountId: candidate.accountId,
        achievementId: candidate.achievementId,
        gameId,
        eventSequence: unlockKey,
        evidenceHash: crypto.createHash('sha256').update(unlockKey).digest('hex'),
        ...(typeof candidate.unlockedAt === 'string' ? { unlockedAt: candidate.unlockedAt } : {})
      });
    } catch (error) {
      // A failed persist rolls the unlock back; it must not abort the settlement.
      console.error('Achievement unlock failed:', error?.message || 'unknown error');
      return { retryable: true, created: false };
    }
    if (!unlock.created) {
      // The unlock is already on record. A settlement that lost its
      // account mirror retries that write here; if it repairs the mirror, it
      // also completes the announcement that could not happen before.
      let stored = null;
      if (unlock.record && typeof accountStore.recordAchievement === 'function') {
        try {
          stored = accountStore.recordAchievement(candidate.accountId, {
            id: unlock.record.achievementId,
            unlockedAt: unlock.record.unlockedAt
          });
        } catch (error) {
          console.error('Achievement account mirror recovery failed:', error?.message || 'unknown error');
          return { retryable: true, created: false };
        }
      }
      if (stored?.success && stored.created) {
        announceAchievementBestEffort(candidate, unlock.record, unlockKey);
        return { retryable: false, created: false };
      }
      if (stored?.success === false) return { retryable: true, created: false };
      // A settlement that lost its announcement retries it here instead of
      // dropping it for good.
      if (unlock.record && undeliveredAnnouncements.has(announcementKey)) {
        announceAchievementBestEffort(candidate, unlock.record, unlockKey);
      }
      return { retryable: false, created: false };
    }
    let stored;
    try {
      stored = accountStore.recordAchievement(candidate.accountId, {
        id: unlock.record.achievementId,
        unlockedAt: unlock.record.unlockedAt
      });
    } catch (error) {
      console.error('Achievement account mirror write failed:', error?.message || 'unknown error');
      rollbackAchievementUnlock(candidate, unlock);
      return { retryable: true, created: false };
    }
    if (!stored?.created) {
      if (!stored?.success) {
        rollbackAchievementUnlock(candidate, unlock);
        return { retryable: true, created: false };
      }
      return { retryable: false, created: false };
    }
    announceAchievementBestEffort(candidate, unlock.record, unlockKey);
    return { retryable: false, created: true };
  }

  function scheduleVerifiedAchievementRetry(candidate, gameId, attempt = 1) {
    if (attempt > VERIFIED_ACHIEVEMENT_RETRY_DELAYS_MS.length) {
      console.error('Achievement settlement retry limit reached:', candidate?.achievementId || 'unknown achievement');
      return false;
    }
    const unlockKey = `${gameId}:${candidate.achievementId}:${candidate.accountId}`;
    if (verifiedAchievementRetries.has(unlockKey)) return true;
    if (verifiedAchievementRetries.size >= VERIFIED_ACHIEVEMENT_RETRY_CAP) {
      console.error('Achievement settlement retry queue is full:', candidate.achievementId);
      return false;
    }
    const entry = { timer: null, candidate, gameId, attempt };
    const delay = VERIFIED_ACHIEVEMENT_RETRY_DELAYS_MS[attempt - 1];
    entry.timer = setTimeoutFn(() => {
      if (verifiedAchievementRetries.get(unlockKey) !== entry) return;
      verifiedAchievementRetries.delete(unlockKey);
      const outcome = recordVerifiedAchievementAttempt(candidate, gameId, { retry: true });
      if (outcome.retryable) scheduleVerifiedAchievementRetry(candidate, gameId, attempt + 1);
      else reconcilePendingPatrolAchievementSettlements(candidate.accountId);
    }, delay);
    entry.timer?.unref?.();
    verifiedAchievementRetries.set(unlockKey, entry);
    return true;
  }

  function scheduleAchievementMirrorRetry(accountId, record, attempt = 1) {
    if (attempt > VERIFIED_ACHIEVEMENT_RETRY_DELAYS_MS.length) {
      console.error('Achievement mirror retry limit reached:', record?.achievementId || 'unknown achievement');
      return false;
    }
    const key = `mirror:${accountId}:${record?.achievementId || ''}`;
    if (!accountId || !record?.achievementId || verifiedAchievementRetries.has(key)) return Boolean(accountId && record?.achievementId);
    if (verifiedAchievementRetries.size >= VERIFIED_ACHIEVEMENT_RETRY_CAP) {
      console.error('Achievement settlement retry queue is full:', record.achievementId);
      return false;
    }
    const entry = { timer: null, accountId, record, attempt };
    entry.timer = setTimeoutFn(() => {
      if (verifiedAchievementRetries.get(key) !== entry) return;
      verifiedAchievementRetries.delete(key);
      const account = accountStore.getAccountById?.(accountId);
      if (!account || account.accountDeactivated === true || account.deletionRequestedAt) return;
      try {
        const stored = accountStore.recordAchievement(accountId, { id: record.achievementId, unlockedAt: record.unlockedAt });
        if (!stored?.success) scheduleAchievementMirrorRetry(accountId, record, attempt + 1);
        else reconcilePendingPatrolAchievementSettlements(accountId);
      } catch (error) {
        console.error('Achievement account mirror retry failed:', error?.message || 'unknown error');
        scheduleAchievementMirrorRetry(accountId, record, attempt + 1);
      }
    }, VERIFIED_ACHIEVEMENT_RETRY_DELAYS_MS[attempt - 1]);
    entry.timer?.unref?.();
    verifiedAchievementRetries.set(key, entry);
    return true;
  }

  function disposeVerifiedAchievementRetries() {
    for (const entry of verifiedAchievementRetries.values()) clearTimeoutFn(entry.timer);
    verifiedAchievementRetries.clear();
    if (achievementReconciliationInterval) clearIntervalFn(achievementReconciliationInterval);
    achievementReconciliationInterval = null;
  }

  function startAchievementReconciliation(intervalMs = ACHIEVEMENT_RECONCILIATION_INTERVAL_MS) {
    if (achievementReconciliationInterval) return false;
    const delay = Math.max(10_000, Math.min(300_000, Math.floor(Number(intervalMs) || ACHIEVEMENT_RECONCILIATION_INTERVAL_MS)));
    achievementReconciliationInterval = setIntervalFn(() => {
      try {
        reconcileAchievementMirrors();
      } catch (error) {
        console.error('Achievement reconciliation pass failed:', error?.message || 'unknown error');
      }
    }, delay);
    achievementReconciliationInterval?.unref?.();
    return true;
  }

  function reconcileAnnotatedMatchAwards() {
    if (typeof achievementStore.recoveryCandidatesFromAnnotatedMatch !== 'function'
      || typeof accountStore.getAccountById !== 'function' || typeof accountStore.recordAchievement !== 'function') {
      return { scanned: 0, repaired: 0, failed: 0 };
    }
    const records = [];
    let failed = 0;
    try {
      const matches = matchStore?.listAll?.();
      if (Array.isArray(matches)) matches.forEach(match => {
        if (match?.matchId) records.push(match);
      });
    } catch (error) {
      console.error('Annotated match recovery lookup failed:', error?.message || 'unknown error');
      failed += 1;
    }
    if (typeof accountStore.listAccounts === 'function' && typeof accountStore.getMatchHistory === 'function') {
      let accounts = [];
      try { accounts = accountStore.listAccounts(); }
      catch (error) {
        console.error('Account match recovery lookup failed:', error?.message || 'unknown error');
        failed += 1;
      }
      (Array.isArray(accounts) ? accounts : []).forEach(account => {
        if (!account?.id || account.accountDeactivated === true || account.deletionRequestedAt) return;
        try {
          accountStore.getMatchHistory(account.id).forEach(match => {
            if (!match?.matchId) return;
            records.push(match);
          });
        } catch (error) {
          console.error('Account match recovery lookup failed:', error?.message || 'unknown error');
          failed += 1;
        }
      });
    }
    const matches = records.sort((a, b) => String(a.completedAt ?? '').localeCompare(String(b.completedAt ?? '')));
    const seen = new Set();
    let scanned = 0;
    let repaired = 0;
    // Older matches are applied first so AccountStore's bounded achievement
    // mirror ends with the newest recovered unlocks at the front.
    matches.forEach(matchRecord => {
      const candidates = achievementStore.recoveryCandidatesFromAnnotatedMatch(matchRecord);
      candidates.forEach(candidate => {
        const key = JSON.stringify([matchRecord.matchId, candidate.accountId, candidate.achievementId]);
        if (seen.has(key)) return;
        seen.add(key);
        const account = accountStore.getAccountById(candidate.accountId);
        if (!account || account.accountDeactivated === true || account.deletionRequestedAt) return;
        const mirrored = account.achievements?.some(entry => entry?.id === candidate.achievementId) === true;
        let unlocked;
        try {
          unlocked = achievementStore.listForAccount(candidate.accountId)
            .some(entry => entry?.achievementId === candidate.achievementId);
        } catch (error) {
          console.error('Match achievement lookup failed:', error?.message || 'unknown error');
          failed += 1;
          return;
        }
        if (mirrored && unlocked) return;
        scanned += 1;
        try {
          recordVerifiedAchievement(candidate, matchRecord.matchId);
          const current = accountStore.getAccountById(candidate.accountId);
          const mirrorCreated = current?.achievements?.some(entry => entry?.id === candidate.achievementId) === true;
          const sourceCreated = achievementStore.listForAccount(candidate.accountId)
            .some(entry => entry?.achievementId === candidate.achievementId);
          if (mirrorCreated && sourceCreated) repaired += 1;
          else failed += 1;
        } catch (error) {
          console.error('Match achievement recovery failed:', error?.message || 'unknown error');
          failed += 1;
        }
      });
    });
    return { scanned, repaired, failed };
  }

  function reconcileAchievementMirrors() {
    if (typeof accountStore.listAccounts !== 'function' || typeof achievementStore.listForAccount !== 'function'
      || typeof accountStore.recordAchievement !== 'function') {
      return { scanned: 0, repaired: 0, failed: 0 };
    }
    const accounts = accountStore.listAccounts();
    if (!Array.isArray(accounts)) return { scanned: 0, repaired: 0, failed: 0 };
    let scanned = 0;
    let repaired = 0;
    let failed = 0;
    accounts.forEach(account => {
      if (!account?.id || account.accountDeactivated === true || account.deletionRequestedAt) return;
      let records;
      try {
        records = achievementStore.listForAccount(account.id);
      } catch (error) {
        console.error('Achievement mirror reconciliation lookup failed:', error?.message || 'unknown error');
        failed += 1;
        return;
      }
      (Array.isArray(records) ? records.slice(-100) : []).forEach(record => {
        if (!record?.achievementId) return;
        scanned += 1;
        try {
          const result = accountStore.recordAchievement(account.id, {
            id: record.achievementId,
            unlockedAt: record.unlockedAt
          });
          if (result?.success && result.created) repaired += 1;
          else if (!result?.success) {
            failed += 1;
            scheduleAchievementMirrorRetry(account.id, record);
          }
        } catch (error) {
          console.error('Achievement mirror reconciliation failed:', error?.message || 'unknown error');
          failed += 1;
          scheduleAchievementMirrorRetry(account.id, record);
        }
      });
    });
    const pendingPatrol = reconcilePendingPatrolAchievementSettlements();
    scanned += pendingPatrol.scanned;
    repaired += pendingPatrol.repaired;
    failed += pendingPatrol.failed;
    const matches = reconcileAnnotatedMatchAwards();
    scanned += matches.scanned;
    repaired += matches.repaired;
    failed += matches.failed;
    return { scanned, repaired, failed };
  }

  function reconcilePendingPatrolAchievementSettlements(accountId = null) {
    if (typeof accountStore.getPendingPatrolAchievementSettlements !== 'function'
      || typeof accountStore.completePatrolAchievementSettlement !== 'function'
      || typeof accountStore.getAccountById !== 'function'
      || typeof achievementStore.listForAccount !== 'function') {
      return { scanned: 0, repaired: 0, failed: 0 };
    }
    const accounts = accountId
      ? [accountStore.getAccountById(accountId)].filter(Boolean)
      : (typeof accountStore.listAccounts === 'function' ? accountStore.listAccounts() : []);
    if (!Array.isArray(accounts)) return { scanned: 0, repaired: 0, failed: 0 };
    let scanned = 0;
    let repaired = 0;
    let failed = 0;
    accounts.forEach(account => {
      if (!account?.id || account.accountDeactivated === true || account.deletionRequestedAt) return;
      const settlements = accountStore.getPendingPatrolAchievementSettlements(account.id);
      (Array.isArray(settlements) ? settlements : []).forEach(settlement => {
        const candidates = patrolAchievementCandidates(account, settlement.score, {
          aceRuns: settlement.aceRuns,
          cleanRun: settlement.cleanRun
        });
        let synced = true;
        candidates.forEach(candidate => {
          scanned += 1;
          try {
            recordVerifiedAchievement(candidate, `patrol_${settlement.id}`);
            const current = accountStore.getAccountById(account.id);
            const mirrored = current?.achievements?.some(entry => entry?.id === candidate.achievementId) === true;
            const unlocked = achievementStore.listForAccount(account.id).some(entry => entry?.achievementId === candidate.achievementId);
            if (!mirrored || !unlocked) synced = false;
          } catch (error) {
            console.error('Patrol achievement reconciliation failed:', error?.message || 'unknown error');
            synced = false;
          }
        });
        if (!synced) return;
        try {
          const result = accountStore.completePatrolAchievementSettlement(account.id, settlement.id);
          if (result?.success) repaired += 1;
          else {
            failed += 1;
            if (candidates[0]) scheduleVerifiedAchievementRetry(candidates[0], `patrol_${settlement.id}`);
          }
        } catch (error) {
          console.error('Patrol achievement journal cleanup failed:', error?.message || 'unknown error');
          failed += 1;
          if (candidates[0]) scheduleVerifiedAchievementRetry(candidates[0], `patrol_${settlement.id}`);
        }
      });
    });
    return { scanned, repaired, failed };
  }

  function recordVerifiedAchievement(candidate, gameId) {
    if (!candidate?.accountId || !candidate.achievementId) return false;
    const unlockKey = `${gameId}:${candidate.achievementId}:${candidate.accountId}`;
    const outcome = recordVerifiedAchievementAttempt(candidate, gameId);
    if (outcome.retryable) scheduleVerifiedAchievementRetry(candidate, gameId);
    else {
      const pending = verifiedAchievementRetries.get(unlockKey);
      if (pending) clearTimeoutFn(pending.timer);
      verifiedAchievementRetries.delete(unlockKey);
    }
    return outcome.created;
  }

  // Rolling an unlock back is best-effort: the account store refused the achievement, so the unlock must not stay on record.
  // A failing removal is reported rather than thrown, so it cannot escape the settlement loop and cost the remaining candidates their unlocks.
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

  // An undelivered announcement is remembered, so the next settlement of the same achievement retries it. A delivered one is forgotten,
  // so nothing is announced twice. A bounded FIFO set, like the mythical announcement keys.
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
    if (candidate.rarity !== 'MYTHICAL' || candidate.suppressPublicAnnouncement === true) return delivered;
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
  // Bounded FIFO set: Sets preserve insertion order, so evicting the oldest
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

  // patrol runs (Parlor Patrol anti-cheat bookkeeping)

  function patrolRunError(socketId, account, runToken) {
    if (!account) return 'That patrol run is no longer available.';
    const run = patrolRuns.get(runToken);
    if (!run) return 'That patrol run is no longer available.';
    if (run.accountId !== account.id) return 'That patrol run is no longer available.';
    if (run.socketId !== socketId && !run.settlementPending) return 'That patrol run is no longer available.';
    if (run.submitted) return 'That patrol run is no longer available.';
    return null;
  }

  function patrolAchievementCandidates(account, score, result) {
    const candidates = [];
    if (!PARLOR_PATROL_ENABLED) return candidates;
    if (score >= 10) candidates.push({ accountId: account.id, achievementId: 'patrol-rookie', title: 'PATROL ROOKIE', rarity: 'COMMON', body: 'You scored 10 in Parlor Patrol.' });
    if (score >= 50) candidates.push({ accountId: account.id, achievementId: 'patrol-regular', title: 'PATROL REGULAR', rarity: 'UNCOMMON', body: 'You scored 50 in Parlor Patrol.' });
    if (score > 0 && result.cleanRun === true) candidates.push({ accountId: account.id, achievementId: 'clean-run', title: 'CLEAN RUN', rarity: 'EPIC', body: 'You cleared a wave without missing a target.' });
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

  // Successful results are replayable for a bounded time without re-settling.
  function pruneCompletedPatrolRuns() {
    const cutoff = Date.now() - 5 * 60_000;
    for (const [token, result] of completedPatrolRuns) {
      if (result.completedAt <= cutoff) { clearTimeout(result.timer); completedPatrolRuns.delete(token); }
    }
  }

  function completedPatrolResult(accountId, token) {
    pruneCompletedPatrolRuns();
    const entry = completedPatrolRuns.get(token);
    return entry?.accountId === accountId ? entry.result : null;
  }

  function rememberCompletedPatrolResult(accountId, token, result) {
    pruneCompletedPatrolRuns();
    while (completedPatrolRuns.size >= 2000) {
      const oldest = completedPatrolRuns.keys().next().value;
      clearTimeout(completedPatrolRuns.get(oldest).timer);
      completedPatrolRuns.delete(oldest);
    }
    const entry = { accountId, result, completedAt: Date.now(), timer: null };
    entry.timer = setTimeout(() => {
      if (completedPatrolRuns.get(token) === entry) completedPatrolRuns.delete(token);
    }, 5 * 60_000);
    entry.timer.unref?.();
    completedPatrolRuns.set(token, entry);
  }

  function prunePatrolRuns() {
    const now = Date.now();
    for (const [token, run] of patrolRuns) {
      if (!run || (run.ended && now - run.endedAt >= 5 * 60_000)
        || (run.pausedAt != null && (run.initialWaiting ? 0 : (run.pausedTotal || 0)) + now - run.pausedAt >= 5 * 60_000)) {
        if (run?.timer) clearTimeout(run.timer);
        patrolRuns.delete(token);
      }
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
    completedPatrolResult,
    completedPatrolRuns,
    dispose: disposeVerifiedAchievementRetries,
    emitSocialUpdate,
    notifyAccount,
    patrolAchievementCandidates,
    patrolRunError,
    prunePatrolRuns,
    patrolRuns,
    publicPlayerCard,
    recentPlayers,
    recordVerifiedAchievement,
    reconcileAchievementMirrors,
    reconcilePendingPatrolAchievementSettlements,
    startAchievementReconciliation,
    rememberCompletedPatrolResult,
    socialRateBucketCount: () => socialRateBuckets.size,
    socketsForAccount,
    socialSummary
  };
}

export { createSocialApi };
