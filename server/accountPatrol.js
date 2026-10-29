// Parlor Patrol score settlement for accounts: achievement ids, the journal of
// settlements that have not been acknowledged yet, and the replay rules.
import { PENDING_PATROL_ACHIEVEMENT_LIMIT, clampInt } from './accountShared.js';

export function sanitizePendingPatrolAchievementSettlements(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(entry => entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim())
    .map(entry => ({
      id: entry.id.trim().slice(0, 120),
      score: clampInt(entry.score, Number.MAX_SAFE_INTEGER),
      aceRuns: clampInt(entry.aceRuns, Number.MAX_SAFE_INTEGER),
      cleanRun: entry.cleanRun === true
    }))
    .slice(-PENDING_PATROL_ACHIEVEMENT_LIMIT);
}

export function patrolReplayResult(account, prior, misses, settlementId) {
  const stats = account.stats || {};
  return { success: true, score: prior.score, misses, best: Math.max(0, Number(stats.patrolVerifiedBest) || 0), aceRuns: prior.aceRuns, settlementId, replayed: true };
}

// Only a finish that may unlock a Patrol achievement needs a durable journal entry.
export function patrolEarnsJournal(score, cleanRun, projectedAceRuns) {
  return score >= 10 || (score > 0 && cleanRun === true) || projectedAceRuns >= 3;
}

function patrolAchievementIds(score, cleanRun, aceRuns) {
  return [
    ...(score >= 10 ? ['patrol-rookie'] : []),
    ...(score >= 50 ? ['patrol-regular'] : []),
    ...(score > 0 && cleanRun === true ? ['clean-run'] : []),
    ...(aceRuns >= 3 ? ['patrol-ace'] : [])
  ];
}

function applyPatrolScore(account, score, misses) {
  const stats = account.stats || (account.stats = {});
  const previousBest = Math.max(0, Number(stats.patrolVerifiedBest) || 0);
  const beatBest = score > previousBest;
  stats.patrolVerifiedBest = Math.max(previousBest, score);
  stats.patrolVerifiedAceRuns = Math.max(0, Number(stats.patrolVerifiedAceRuns) || 0) + (beatBest && previousBest > 0 ? 1 : 0);
  return { success: true, score, misses, best: stats.patrolVerifiedBest, aceRuns: stats.patrolVerifiedAceRuns };
}

function journalPatrolSettlement(account, settlementId, score, aceRuns, cleanRun) {
  const pending = sanitizePendingPatrolAchievementSettlements(account.pendingPatrolAchievementSettlements);
  account.pendingPatrolAchievementSettlements = [
    ...pending.filter(entry => entry.id !== settlementId),
    { id: settlementId, score, aceRuns, cleanRun: cleanRun === true }
  ];
}

export function normalizedSettlementId(settlementId) {
  return typeof settlementId === 'string' ? settlementId.trim().slice(0, 120) : '';
}

export function projectedPatrolAceRuns(account, safeScore) {
  const priorBest = Math.max(0, Number(account.stats?.patrolVerifiedBest) || 0);
  return Math.max(0, Number(account.stats?.patrolVerifiedAceRuns) || 0) + (safeScore > priorBest && priorBest > 0 ? 1 : 0);
}

export function applyPatrolSettlement(account, { safeScore, safeMisses, safeSettlementId, cleanRun }) {
  const result = applyPatrolScore(account, safeScore, safeMisses);
  if (safeSettlementId && patrolAchievementIds(safeScore, cleanRun, result.aceRuns).length) {
    journalPatrolSettlement(account, safeSettlementId, safeScore, result.aceRuns, cleanRun);
  }
  if (safeSettlementId) result.settlementId = safeSettlementId;
  return result;
}
