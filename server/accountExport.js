const MAX_HISTORY = 50;
const MAX_DESIGNS = 12;
const MAX_ACHIEVEMENTS = 100;

function text(value, max = 160) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/gu, '').slice(0, max) : null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDate(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safePrivacy(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(['history', 'achievements', 'friendRequests', 'roomInvites'].map(key => [key, text(value[key], 24)]));
}

function safeHistoryEntry(entry = {}) {
  return {
    matchId: text(entry.matchId, 80),
    playedAt: safeDate(entry.playedAt),
    result: entry.result === 'WIN' ? 'WIN' : 'ROUND',
    won: entry.won === true,
    endingCash: Math.max(0, number(entry.endingCash)),
    properties: Math.max(0, Math.floor(number(entry.properties ?? entry.propertyCount)))
  };
}

function safeMatch(entry = {}) {
  return {
    matchId: text(entry.matchId, 80),
    completedAt: safeDate(entry.completedAt),
    roundCount: Math.max(0, Math.floor(number(entry.roundCount))),
    roomVisibility: entry.roomVisibility === 'private' ? 'private' : 'public',
    finalPlacement: Number.isInteger(Number(entry.finalPlacement)) ? Math.max(1, Number(entry.finalPlacement)) : null,
    propertyCount: Math.max(0, Math.floor(number(entry.propertyCount)))
  };
}

function safeDesign(entry = {}) {
  return {
    designName: text(entry.designName, 40),
    color: /^#[0-9a-f]{6}$/i.test(entry.color || '') ? entry.color.toLowerCase() : null,
    avatarGrid: Array.isArray(entry.avatarGrid) ? entry.avatarGrid.slice(0, 8).map(row => Array.isArray(row) ? row.slice(0, 8).map(cell => /^#[0-9a-f]{6}$/i.test(cell || '') ? cell.toLowerCase() : null) : []) : null
  };
}

export function buildAccountExport({ account, social = {}, cosmetics = [], matches = [], now = Date.now } = {}) {
  if (!account || typeof account !== 'object' || typeof account.username !== 'string') throw new TypeError('An authenticated account is required.');
  const history = Array.isArray(account.history) ? account.history.slice(0, MAX_HISTORY).map(safeHistoryEntry) : [];
  const matchHistory = (Array.isArray(account.matchHistory) ? account.matchHistory : matches).slice(0, MAX_HISTORY).map(safeMatch);
  const designs = (Array.isArray(account.designs) ? account.designs : []).slice(0, MAX_DESIGNS).map(safeDesign);
  const achievements = (Array.isArray(account.achievements) ? account.achievements : []).slice(0, MAX_ACHIEVEMENTS).map(entry => ({ id: text(entry?.id, 80), unlockedAt: safeDate(entry?.unlockedAt) }));
  const friendCount = Array.isArray(social.friends) ? social.friends.length : 0;
  const requestCount = Array.isArray(social.requests) ? social.requests.length : 0;
  const notificationCount = Array.isArray(social.notifications) ? social.notifications.length : 0;
  const ownStats = account.stats && typeof account.stats === 'object' ? account.stats : {};
  const statistics = Object.fromEntries(Object.entries(ownStats).slice(0, 40).map(([key, value]) => [text(key, 40), number(value)]));
  return {
    schemaVersion: 1,
    generatedAt: new Date(Number(now()) || Date.now()).toISOString(),
    profile: {
      username: text(account.username, 16),
      displayName: text(account.displayName, 40),
      color: /^#[0-9a-f]{6}$/i.test(account.color || '') ? account.color.toLowerCase() : null,
      avatarGrid: safeDesign({ avatarGrid: account.avatarGrid }).avatarGrid,
      createdAt: safeDate(account.createdAt),
      privacy: safePrivacy(account.privacy)
    },
    designs,
    statistics,
    history,
    matchHistory,
    achievements,
    social: { friendCount, requestCount, notificationCount },
    recoveryEmail: { address: text(account.recoveryEmail, 254), verified: account.recoveryEmailVerified === true }
  };
}

export { safeHistoryEntry, safeMatch };
