// Account record shape: sanitizers, normalisers, and the public and private
// views of an account.
import { USERNAME_RE, clippedList, nonNegative, num } from './accountShared.js';
import { sanitizePendingPatrolAchievementSettlements } from './accountPatrol.js';
import { cleanPlayerName, isReservedName } from './nicknamePolicy.js';
import { sanitizeMatch } from './matchStore.js';

const COLOR_RE = /^#[0-9a-f]{6}$/i;

const FACE_SIZE = 8;

export function loadableAccount(handle, account, accounts) {
  return Boolean(account) && USERNAME_RE.test(handle) && !accounts.has(handle);
}

export function profileAccountId(accountOrId) {
  if (typeof accountOrId === 'string') return accountOrId;
  return accountOrId?.id;
}

export function applyProfilePatch(account, patch) {
  if (patch.displayName != null) account.displayName = normalizeDisplayName(patch.displayName, account.username);
  if (patch.color != null) account.color = normalizeColor(patch.color, account.color);
  if (patch.avatarGrid != null) account.avatarGrid = sanitizeAvatarGrid(patch.avatarGrid);
  if (patch.privacy && typeof patch.privacy === 'object') account.privacy = sanitizePrivacy({ ...account.privacy, ...patch.privacy });
}

export function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeDisplayName(value, fallback = 'PLAYER') {
  const name = cleanPlayerName(value, 18);
  if (name && !isReservedName(name)) return name;
  // The fallback is the username, which grandfathered accounts may have chosen
  // as a reserved label; it must not become the worn name either.
  return isReservedName(String(fallback)) ? `${fallback}_1` : fallback;
}

export function normalizeColor(value, fallback = '#d74438') {
  return COLOR_RE.test(String(value || '')) ? String(value).toLowerCase() : fallback;
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function sanitizeAvatarGrid(value) {
  if (!Array.isArray(value)) return null;
  return Array.from({ length: FACE_SIZE }, (_, y) =>
    Array.from({ length: FACE_SIZE }, (_, x) => {
      const cell = value[y]?.[x];
      return typeof cell === 'string' && COLOR_RE.test(cell) ? cell.toLowerCase() : null;
    }),
  );
}

const stringOrNull = (value) => (typeof value === 'string' ? value : null);

function historyEntryView(entry) {
  return {
    matchId: stringOrNull(entry.matchId),
    playedAt: stringOrNull(entry.playedAt),
    result: entry.result === 'WIN' ? 'WIN' : 'ROUND',
    won: entry.won === true || entry.result === 'WIN',
    endingCash: nonNegative(entry.endingCash),
    properties: nonNegative(entry.properties),
  };
}

export function sanitizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object')
    .slice(0, 50)
    .map(historyEntryView);
}

// Match history is capped for profile payloads, but settlement idempotency cannot share that
// window: an old match can be replayed after it leaves the visible list. Keep a durable,
// private ledger of recent match ids that already contributed account stats.
const RECORDED_MATCH_ID_LIMIT = 500;

export function sanitizeRecordedMatchIds(value, legacyHistory = []) {
  const source = Array.isArray(value) ? value : legacyHistory.map(entry => entry?.matchId);
  // The ledger is copied into every accounts.json rewrite, so it keeps only the
  // newest ids. A replay older than that window is not recognised.
  return [...new Set(source
    .filter(entry => typeof entry === 'string' && entry.trim())
    .map(entry => entry.trim().slice(0, 80)))].slice(-RECORDED_MATCH_ID_LIMIT);
}

const PUBLIC_HISTORY_KEYS = ['matchId', 'playedAt', 'result', 'won', 'properties'];

function publicHistory(history, includePrivateHistory) {
  const sanitized = sanitizeHistory(history);
  if (includePrivateHistory) return sanitized;
  return sanitized.map(entry => Object.fromEntries(PUBLIC_HISTORY_KEYS.map(key => [key, entry[key]])));
}

export function publicAchievements(account, includePrivateHistory) {
  if (!includePrivateHistory && ['private', 'friends'].includes(account.privacy?.achievements)) return [];
  const entries = Array.isArray(account.achievements) ? account.achievements : [];
  return entries.map(entry => ({ id: entry.id, unlockedAt: entry.unlockedAt || null })).slice(0, 100);
}

export function publicPlayerStats(stats = {}) {
  const gamesPlayed = num(stats.gamesPlayed);
  const wins = num(stats.wins);
  return {
    gamesPlayed,
    wins,
    winRate: gamesPlayed ? Math.round((wins / gamesPlayed) * 100) : 0,
    eventSurvival: num(stats.eventSurvival)
  };
}

function buildPublicAccountBase(account, includePrivateHistory) {
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    color: account.color,
    avatarGrid: account.avatarGrid,
    stats: { ...account.stats },
    history: publicHistory(account.history, includePrivateHistory),
    achievements: publicAchievements(account, includePrivateHistory),
    achievementsPrivate: account.privacy?.achievements === 'private',
    privacy: sanitizePrivacy(account.privacy),
    recentClearedAt: account.recentClearedAt || null,
    accountDeactivated: account.accountDeactivated === true,
    createdAt: account.createdAt,
  };
}

function applyPrivateAccountFields(target, account, includePrivateHistory) {
  if (includePrivateHistory) {
    target.matchHistory = clippedList(account.matchHistory, 50);
    target.deletionRequestedAt = account.deletionRequestedAt || null;
    target.deletionDueAt = account.deletionDueAt || null;
    target.deletionRequestId = account.deletionRequestId || null;
    target.recoveryEmail = account.recoveryEmail || null;
    target.recoveryEmailVerified = account.recoveryEmailVerified === true;
  } else {
    target.deletionRequestedAt = null;
    target.deletionDueAt = null;
    target.deletionRequestId = null;
    target.recoveryEmail = null;
    target.recoveryEmailVerified = false;
  }
}

export function publicAccount(account, includePrivateHistory = true) {
  if (!account) return null;
  const base = buildPublicAccountBase(account, includePrivateHistory);
  applyPrivateAccountFields(base, account, includePrivateHistory);
  return base;
}

// The one authoritative list of per-account stat counters, in the shape
// order the on-disk format has always used. Loaded records, fresh
// registrations and any future store all funnel through this table.
const STATS_KEYS = [
  'gamesPlayed', 'wins', 'bankruptcies', 'auctionWins', 'rentCollected',
  'eventSurvival', 'casinoNet', 'marketProfit', 'playerLoansGiven',
  'playerLoansRepaid', 'playerLoanDefaults', 'equityDeals', 'bankLoansTaken',
  'bankLoanRepayments', 'bankLoanDefaults', 'patrolBest', 'patrolAceRuns', 'patrolVerifiedBest', 'patrolVerifiedAceRuns'
];

export function sanitizeStats(stats) {
  const clean = {};
  STATS_KEYS.forEach((key) => {
    clean[key] = Number(stats?.[key]) || 0;
  });
  return clean;
}

function applyDeletionFields(normalized, account) {
  if (Object.prototype.hasOwnProperty.call(account, 'accountDeactivated')) {
    normalized.accountDeactivated = account.accountDeactivated === true;
  }
  if (typeof account.deletionRequestedAt === 'string') normalized.deletionRequestedAt = account.deletionRequestedAt;
  if (typeof account.deletionDueAt === 'string') normalized.deletionDueAt = account.deletionDueAt;
  if (typeof account.deletionRequestId === 'string') normalized.deletionRequestId = account.deletionRequestId.slice(0, 100);
}

function applyRecoveryFields(normalized, account) {
  if (typeof account.recoveryEmail === 'string') normalized.recoveryEmail = account.recoveryEmail.trim().toLowerCase().slice(0, 254);
  if (Object.prototype.hasOwnProperty.call(account, 'recoveryEmailVerified')) normalized.recoveryEmailVerified = account.recoveryEmailVerified === true;
  if (typeof account.pendingRecoveryEmail === 'string') normalized.pendingRecoveryEmail = account.pendingRecoveryEmail.trim().toLowerCase().slice(0, 254);
  if (typeof account.pendingRecoveryEmailTokenHash === 'string') normalized.pendingRecoveryEmailTokenHash = account.pendingRecoveryEmailTokenHash.slice(0, 128);
  if (typeof account.pendingRecoveryEmailExpiresAt === 'string') normalized.pendingRecoveryEmailExpiresAt = account.pendingRecoveryEmailExpiresAt;
  const consumedGeneration = Number(account.consumedPasswordResetGeneration);
  normalized.consumedPasswordResetGeneration = Number.isSafeInteger(consumedGeneration) && consumedGeneration >= 0 ? consumedGeneration : 0;
}

function applyOptionalAccountFields(normalized, account) {
  applyDeletionFields(normalized, account);
  applyRecoveryFields(normalized, account);
}

function buildBaseNormalizedAccount(handle, account) {
  return {
    ...account,
    username: handle,
    displayName: normalizeDisplayName(account.displayName, account.username),
    color: normalizeColor(account.color),
    avatarGrid: sanitizeAvatarGrid(account.avatarGrid),
    stats: sanitizeStats(account.stats),
    history: sanitizeHistory(account.history),
    achievements: Array.isArray(account.achievements) ? account.achievements.filter(entry => entry && typeof entry.id === 'string').slice(0, 100) : [],
    matchHistory: Array.isArray(account.matchHistory) ? account.matchHistory.filter(entry => entry && typeof entry === 'object').slice(0, 50).map(sanitizeMatch) : [],
    recordedMatchIds: sanitizeRecordedMatchIds(account.recordedMatchIds, account.matchHistory),
    ...(Object.prototype.hasOwnProperty.call(account, 'pendingPatrolAchievementSettlements')
      ? { pendingPatrolAchievementSettlements: sanitizePendingPatrolAchievementSettlements(account.pendingPatrolAchievementSettlements) }
      : {}),
    privacy: sanitizePrivacy(account.privacy),
    recentClearedAt: typeof account.recentClearedAt === 'string' ? account.recentClearedAt : null
  };
}

export function normalizeLoadedAccount(handle, account) {
  const normalized = buildBaseNormalizedAccount(handle, account);
  applyOptionalAccountFields(normalized, account);
  return normalized;
}

const PRIVACY_RULES = {
  history: { allowed: ['public', 'friends', 'private'], fallback: 'friends' },
  achievements: { allowed: ['private'], fallback: 'friends' },
  friendRequests: { allowed: ['everyone', 'friends', 'nobody'], fallback: 'everyone' },
  roomInvites: { allowed: ['friends', 'nobody'], fallback: 'friends' }
};

export function sanitizePrivacy(value) {
  return Object.fromEntries(Object.entries(PRIVACY_RULES).map(([key, rule]) => [
    key,
    rule.allowed.includes(value?.[key]) ? value[key] : rule.fallback
  ]));
}
