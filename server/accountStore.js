import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { participantFromPlayer } from './participantFields.js';
import { loadJson, writeJson } from './storeIO.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'accounts.json');
const USERNAME_RE = /^[a-z0-9_]{3,16}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const FACE_SIZE = 8;
const MYTHICAL_ACHIEVEMENT_IDS = new Set(['41st-tile', 'null-player', 'black-ledger']);
const ACHIEVEMENT_POINTS = { common: 10, uncommon: 25, rare: 50, epic: 100, legendary: 250, mythical: 1000 };
const ACHIEVEMENT_RARITY_BY_ID = new Map([
  ...['first-deed', 'last-wallet-standing', 'one-dollar-hedge', 'first-index', 'patrol-rookie'].map(id => [id, 'common']),
  ...['full-street', 'even-builder', 'clean-exit', 'debt-free', 'council-member', 'generous-lender', 'patrol-regular'].map(id => [id, 'uncommon']),
  ...['auction-ghost', 'collateral-damage', 'bad-idea-good-timing', 'prison-break', 'no-refunds', 'rent-reaper', 'fire-sale', 'airport-hopper', 'tax-evasion', 'underdog', 'group-therapy', 'hostile-bidder', 'event-tourist', 'silent-partner', 'roulette-regular', 'market-maker', 'grounded-tourist', 'coalition-builder', 'patrol-ace', 'crisis-manager', 'unanimous'].map(id => [id, 'rare']),
  ...['empty-streets', 'liquidity-king', 'public-works', 'short-the-street', 'moral-hazard', 'treasure-map', 'all-in', 'crisis-investor', 'clean-run', 'bubble-survivor', 'stagflation-trader'].map(id => [id, 'epic']),
  ...['double-headline', 'no-floor', 'compromised-council', 'public-enemy'].map(id => [id, 'legendary']),
  ...['41st-tile', 'null-player', 'black-ledger'].map(id => [id, 'mythical'])
]);

function achievementPoints(entry, since = null) {
  if (isBeforeWindow(entry?.unlockedAt, since)) return 0;
  const rarity = ACHIEVEMENT_RARITY_BY_ID.get(entry?.id) || 'common';
  return ACHIEVEMENT_POINTS[rarity] || ACHIEVEMENT_POINTS.common;
}

// An unlock timestamp is "before the window" only when a window was given
// and the parseable timestamp falls outside it (unparseable = outside too).
function isBeforeWindow(unlockedAt, since) {
  return Boolean(since) && Date.parse(unlockedAt || '') < since;
}

function loadableAccount(handle, account, accounts) {
  return Boolean(account) && USERNAME_RE.test(handle) && !accounts.has(handle);
}

function validPasswordShape(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 72;
}

function hasCredentialShape(account, password) {
  return Boolean(account)
    && typeof password === 'string'
    && typeof account.passwordHash === 'string'
    && typeof account.passwordSalt === 'string';
}

const num = (value) => Number(value) || 0;

// One resolver per leaderboard metric: reads the (windowed) stats object and
// the two achievement-derived figures. Replaces a 15-deep nested ternary chain
// so adding a rank type is one row here, not another ternary arm. The default
// (unknown metric) is wins, matching the previous final `: Number(wins) || 0`.
const METRIC_RESOLVERS = {
  wins: (stats) => num(stats.wins),
  games: (stats) => num(stats.gamesPlayed),
  rate: (stats) => (num(stats.gamesPlayed) ? Math.round((num(stats.wins) / num(stats.gamesPlayed)) * 100) : 0),
  achievements: (stats, derived) => derived.achievementScore,
  mythical: (stats, derived) => derived.mythicalCount,
  bankruptcies: (stats) => num(stats.bankruptcies),
  events: (stats) => num(stats.eventSurvival),
  auctions: (stats) => num(stats.auctionWins),
  rent: (stats) => num(stats.rentCollected),
  casino: (stats) => num(stats.casinoNet),
  market: (stats) => num(stats.marketProfit),
  playerloans: (stats) => num(stats.playerLoansGiven),
  equity: (stats) => num(stats.equityDeals),
  loans: (stats) => Math.max(0, num(stats.bankLoanRepayments) * 2 - num(stats.bankLoanDefaults) * 3),
  patrol: (stats) => num(stats.patrolBest)
};

function resolveMetricValue(metric, stats, derived) {
  const resolve = METRIC_RESOLVERS[metric] || METRIC_RESOLVERS.wins;
  return resolve(stats, derived);
}

// A player-contract ledger count for one account, parameterized by a predicate
// so the repayment/default/given/equity tallies stay single-line.
function countContracts(record, accountId, include) {
  return (record.playerContracts || []).filter((contract) => include(contract, accountId)).length;
}

function realizedMarketPnl(record, accountId) {
  const market = (record.market || []).find((entry) => entry.accountId === accountId);
  return Object.values(market?.positions || {}).reduce((sum, position) => sum + (num(position.realizedPnl)), 0);
}

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeDisplayName(value, fallback = 'PLAYER') {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 18) : '';
  return name || fallback;
}

function normalizeColor(value, fallback = '#d74438') {
  return COLOR_RE.test(String(value || '')) ? String(value).toLowerCase() : fallback;
}

function sanitizeAvatarGrid(value) {
  if (!Array.isArray(value)) return null;
  return Array.from({ length: FACE_SIZE }, (_, y) =>
    Array.from({ length: FACE_SIZE }, (_, x) => {
      const cell = value[y]?.[x];
      return typeof cell === 'string' && COLOR_RE.test(cell) ? cell.toLowerCase() : null;
    }),
  );
}

const stringOrNull = (value) => (typeof value === 'string' ? value : null);
const clampInt = (value, max) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));

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

function sanitizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object')
    .slice(0, 50)
    .map(historyEntryView);
}

const nonNegative = (value) => Math.max(0, Number(value) || 0);

const clippedList = (value, cap) => (Array.isArray(value) ? value.slice(0, cap) : []);

function computePlacementById(players) {
  const sortCash = player => Number(player.cash) || 0;
  return new Map([...players]
    .sort((a, b) => Number(Boolean(a.bankrupt)) - Number(Boolean(b.bankrupt)) || sortCash(b) - sortCash(a))
    .map((player, index) => [player.id, index + 1]));
}

function buildMatchRecord(matchId, matchMeta, participants) {
  return {
    matchId,
    completedAt: matchMeta.completedAt || new Date().toISOString(),
    durationSeconds: nonNegative(matchMeta.durationSeconds),
    roundCount: nonNegative(matchMeta.roundCount),
    roomVisibility: matchMeta.roomVisibility === 'private' ? 'private' : 'public',
    participants,
    globalEvents: clippedList(matchMeta.globalEvents, 20),
    eventCombinations: clippedList(matchMeta.eventCombinations, 10),
    tradesCompleted: nonNegative(matchMeta.tradesCompleted),
    auctionsCompleted: nonNegative(matchMeta.auctionsCompleted),
    casino: clippedList(matchMeta.casino, 8),
    market: clippedList(matchMeta.market, 8),
    playerContracts: clippedList(matchMeta.playerContracts, 20)
  };
}

// One delta function per stat key, applied to the live player object of a
// just-finished match. server/game-results.test.js pins every output.
const RESULT_STAT_UPDATES = {
  gamesPlayed: () => 1,
  wins: (player, ctx) => (player.id === ctx.winnerId ? 1 : 0),
  bankruptcies: player => (player.bankrupt ? 1 : 0),
  auctionWins: player => nonNegative(player.auctionWins),
  rentCollected: player => nonNegative(player.rentCollected),
  eventSurvival: player => nonNegative(player.globalEventsSurvived),
  bankLoansTaken: player => nonNegative(player.bankLoanCount),
  bankLoanRepayments: player => (player.bankLoan?.status === 'paid' ? 1 : 0),
  bankLoanDefaults: player => (player.bankLoan?.status === 'defaulted' ? 1 : 0),
  casinoNet: (player, ctx) => num(ctx.casino.find(entry => entry.accountId === player.accountId)?.net) || 0,
  marketProfit: (player, ctx) => Object.values(ctx.market.find(entry => entry.accountId === player.accountId)?.positions || {})
    .reduce((sum, position) => sum + (Number(position.realizedPnl) || 0), 0),
  playerLoansGiven: (player, ctx) => ctx.contracts.filter(c => c.fromAccountId === player.accountId && c.kind === 'loan').length,
  playerLoansRepaid: (player, ctx) => ctx.contracts.filter(c => c.toAccountId === player.accountId && c.kind === 'loan' && c.status === 'paid').length,
  playerLoanDefaults: (player, ctx) => ctx.contracts.filter(c => c.toAccountId === player.accountId && c.kind === 'loan' && c.status === 'defaulted').length,
  equityDeals: (player, ctx) => ctx.contracts.filter(c => c.kind === 'equity' && (c.fromAccountId === player.accountId || c.toAccountId === player.accountId)).length
};

function matchHistoryEntry(player, matchId, winnerId) {
  const won = player.id === winnerId;
  return {
    matchId,
    playedAt: new Date().toISOString(),
    result: won ? 'WIN' : 'ROUND',
    won,
    endingCash: nonNegative(player.cash),
    properties: Array.isArray(player.properties) ? player.properties.length : 0
  };
}

// account: the stored profile, player: the live participant, result: match
// record + raw meta + winner, bundled so this seam takes three arguments.
function applyMatchResult(account, player, result) {
  const ctx = {
    winnerId: result.winnerId,
    casino: result.matchMeta.casino || [],
    market: result.matchMeta.market || [],
    contracts: Array.isArray(result.matchMeta.playerContracts) ? result.matchMeta.playerContracts : []
  };
  Object.entries(RESULT_STAT_UPDATES).forEach(([key, delta]) => {
    account.stats[key] += delta(player, ctx);
  });
  account.history = [matchHistoryEntry(player, result.matchRecord.matchId, result.winnerId), ...sanitizeHistory(account.history)].slice(0, 50);
  account.matchHistory = [result.matchRecord, ...(account.matchHistory || []).filter(entry => entry.matchId !== result.matchRecord.matchId)].slice(0, 50);
}

// The same fifteen deltas recomputed from stored match records, for
// time-windowed views. Wins intentionally differ from the live ladder:
// history replays use the recorded final placement, not winnerId.
const WINDOW_STAT_UPDATES = {
  gamesPlayed: () => 1,
  wins: participant => (participant.finalPlacement === 1 ? 1 : 0),
  bankruptcies: participant => (participant.bankrupt ? 1 : 0),
  auctionWins: participant => num(participant.auctionWins),
  rentCollected: participant => num(participant.rentCollected),
  eventSurvival: participant => num(participant.globalEventsSurvived),
  bankLoansTaken: participant => num(participant.bankLoanCount),
  bankLoanRepayments: participant => (participant.bankLoanStatus === 'paid' ? 1 : 0),
  bankLoanDefaults: participant => (participant.bankLoanStatus === 'defaulted' ? 1 : 0),
  casinoNet: participant => num(participant.casinoNet),
  marketProfit: (participant, record, account) => realizedMarketPnl(record, account.id),
  playerLoansGiven: (participant, record, account) => countContracts(record, account.id, (contract, id) => contract.fromAccountId === id && contract.kind === 'loan'),
  playerLoansRepaid: (participant, record, account) => countContracts(record, account.id, (contract, id) => contract.toAccountId === id && contract.kind === 'loan' && contract.status === 'paid'),
  playerLoanDefaults: (participant, record, account) => countContracts(record, account.id, (contract, id) => contract.toAccountId === id && contract.kind === 'loan' && contract.status === 'defaulted'),
  equityDeals: (participant, record, account) => countContracts(record, account.id, (contract, id) => contract.kind === 'equity' && (contract.fromAccountId === id || contract.toAccountId === id))
};

function windowRecords(account, since) {
  return (account.matchHistory || []).filter(record => Date.parse(record.completedAt || '') >= since);
}

function findParticipant(record, accountId) {
  return (record.participants || []).find(entry => entry.accountId === accountId) || null;
}

function achievementTallies(account, since) {
  const achievements = Array.isArray(account.achievements) ? account.achievements : [];
  const withinWindow = (entry) => !since || Date.parse(entry.unlockedAt || '') >= since;
  return {
    count: (since ? achievements.filter(withinWindow) : achievements).length,
    score: achievements.reduce((sum, entry) => sum + achievementPoints(entry, since || null), 0),
    mythical: achievements.filter(entry => MYTHICAL_ACHIEVEMENT_IDS.has(entry.id) && withinWindow(entry)).length
  };
}

function leaderboardRow(store, account, metric, options) {
  const stats = store.getWindowStats(account, options.since || null);
  const tallies = achievementTallies(account, options.since);
  if (metric === 'rate' && num(stats.gamesPlayed) < 5) return null;
  return {
    accountId: account.id, displayName: account.displayName, username: account.username,
    color: account.color, avatarGrid: account.avatarGrid,
    value: resolveMetricValue(metric, stats, { achievementScore: tallies.score, mythicalCount: tallies.mythical }),
    games: num(stats.gamesPlayed), wins: num(stats.wins), achievements: tallies.count,
    achievementScore: tallies.score, mythical: tallies.mythical,
    bankLoanRepayments: num(stats.bankLoanRepayments), bankLoanDefaults: num(stats.bankLoanDefaults)
  };
}

const PUBLIC_HISTORY_KEYS = ['matchId', 'playedAt', 'result', 'won', 'properties'];

function publicHistory(history, includePrivateHistory) {
  const sanitized = sanitizeHistory(history);
  if (includePrivateHistory) return sanitized;
  return sanitized.map(entry => Object.fromEntries(PUBLIC_HISTORY_KEYS.map(key => [key, entry[key]])));
}

function publicAchievements(account, includePrivateHistory) {
  if (account.privacy?.achievements === 'private' && !includePrivateHistory) return [];
  const entries = Array.isArray(account.achievements) ? account.achievements : [];
  return entries.map(entry => ({ id: entry.id, unlockedAt: entry.unlockedAt || null })).slice(0, 100);
}

function publicAccount(account, includePrivateHistory = true) {
  if (!account) return null;
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    color: account.color,
    avatarGrid: account.avatarGrid,
    stats: { ...account.stats },
    history: publicHistory(account.history, includePrivateHistory),
    // Full match records contain exact cash, contracts, and other private
    // economy facts. They are returned only to the signed-in owner; the
    // account-id lookup used by social/search projections must never leak
    // this field.
    ...(includePrivateHistory ? { matchHistory: clippedList(account.matchHistory, 50) } : {}),
    achievements: publicAchievements(account, includePrivateHistory),
    achievementsPrivate: account.privacy?.achievements === 'private',
    privacy: sanitizePrivacy(account.privacy),
    recentClearedAt: account.recentClearedAt || null,
    createdAt: account.createdAt,
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// The one authoritative list of per-account stat counters, in the shape
// order the on-disk format has always used. Loaded records, fresh
// registrations and any future store all funnel through this table.
const STATS_KEYS = [
  'gamesPlayed', 'wins', 'bankruptcies', 'auctionWins', 'rentCollected',
  'eventSurvival', 'casinoNet', 'marketProfit', 'playerLoansGiven',
  'playerLoansRepaid', 'playerLoanDefaults', 'equityDeals', 'bankLoansTaken',
  'bankLoanRepayments', 'bankLoanDefaults', 'patrolBest', 'patrolAceRuns'
];

function sanitizeStats(stats) {
  const clean = {};
  STATS_KEYS.forEach((key) => {
    clean[key] = Number(stats?.[key]) || 0;
  });
  return clean;
}

function normalizeLoadedAccount(handle, account) {
  return {
    ...account,
    username: handle,
    displayName: normalizeDisplayName(account.displayName, account.username),
    color: normalizeColor(account.color),
    avatarGrid: sanitizeAvatarGrid(account.avatarGrid),
    stats: sanitizeStats(account.stats),
    history: sanitizeHistory(account.history),
    achievements: Array.isArray(account.achievements) ? account.achievements.filter(entry => entry && typeof entry.id === 'string').slice(0, 100) : [],
    matchHistory: Array.isArray(account.matchHistory) ? account.matchHistory.filter(entry => entry && typeof entry === 'object').slice(0, 50) : [],
    privacy: sanitizePrivacy(account.privacy),
    recentClearedAt: typeof account.recentClearedAt === 'string' ? account.recentClearedAt : null
  };
}

export class AccountStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.accounts = new Map();
    this.sessions = new Map();
    this.sessionHashes = new Map();
    this.load();
  }

  load() {
    const { value } = loadJson(this.filePath);
    if (!value) return;
    const entries = value;
    if (!Array.isArray(entries)) return;
    entries.forEach((account) => {
      const handle = normalizeUsername(account?.username);
      // Normalize legacy records as they load and keep the Map invariant
      // case-insensitive. If a malformed file contains duplicate handles,
      // the first valid record remains the owner of that username.
      if (!loadableAccount(handle, account, this.accounts)) return;
      this.accounts.set(handle, normalizeLoadedAccount(handle, account));
      if (account.sessionTokenHash) this.sessionHashes.set(account.sessionTokenHash, handle);
    });
  }

  persist() {
    writeJson(this.filePath, [...this.accounts.values()]);
  }

  sessionAccount(sessionToken) {
    if (typeof sessionToken !== 'string' || !sessionToken) return null;
    let username = this.sessions.get(sessionToken);
    if (!username) {
      const tokenHash = hashSessionToken(sessionToken);
      username = this.sessionHashes.get(tokenHash);
      if (username) this.sessions.set(sessionToken, username);
    }
    return username ? this.accounts.get(username) || null : null;
  }

  issueSession(account) {
    for (const [token, username] of this.sessions) {
      if (username === account.username) {
        this.sessions.delete(token);
        if (account.sessionTokenHash) this.sessionHashes.delete(account.sessionTokenHash);
      }
    }
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    this.sessions.set(token, account.username);
    this.sessionHashes.set(tokenHash, account.username);
    account.sessionTokenHash = tokenHash;
    return token;
  }

  register({ username, displayName, password, color, avatarGrid } = {}) {
    const handle = normalizeUsername(username);
    const availability = this.checkUsername(handle);
    if (!availability.available) return { success: false, error: availability.message };
    if (!validPasswordShape(password)) {
      return { success: false, error: 'Password must be 8–72 characters.' };
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const account = {
      id: `acct_${crypto.randomUUID()}`,
      username: handle,
      displayName: normalizeDisplayName(displayName, handle),
      color: normalizeColor(color),
      avatarGrid: sanitizeAvatarGrid(avatarGrid),
      passwordSalt: salt,
      passwordHash: hashPassword(password, salt),
      stats: sanitizeStats({}),
      history: [],
      achievements: [],
      matchHistory: [],
      privacy: sanitizePrivacy(null),
      recentClearedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.accounts.set(handle, account);
    const sessionToken = this.issueSession(account);
    this.persist();
    return { success: true, account: publicAccount(account), sessionToken };
  }

  checkUsername(username, currentAccountId = null) {
    const handle = normalizeUsername(username);
    if (!USERNAME_RE.test(handle)) {
      return {
        success: true,
        available: false,
        reason: 'invalid',
        username: handle,
        message: 'Username must be 3–16 characters: letters, numbers, or underscores.',
      };
    }
    const existing = this.accounts.get(handle);
    const available = !existing || (Boolean(currentAccountId) && existing.id === currentAccountId);
    return {
      success: true,
      available,
      reason: available ? 'available' : 'taken',
      username: handle,
      message: available ? 'Username is available.' : 'That username is already taken.',
    };
  }

  login({ username, password } = {}) {
    const handle = normalizeUsername(username);
    const account = this.accounts.get(handle);
    if (!hasCredentialShape(account, password)) {
      return { success: false, error: 'Username or password is incorrect.' };
    }
    const expected = Buffer.from(account.passwordHash, 'hex');
    const actual = Buffer.from(hashPassword(password, account.passwordSalt), 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return { success: false, error: 'Username or password is incorrect.' };
    }
    const sessionToken = this.issueSession(account);
    this.persist();
    return { success: true, account: publicAccount(account), sessionToken };
  }

  restore(sessionToken) {
    const account = this.sessionAccount(sessionToken);
    return account ? { success: true, account: publicAccount(account) } : { success: false, error: 'Account session expired. Sign in again.' };
  }

  logout(sessionToken) {
    const account = this.sessionAccount(sessionToken);
    if (typeof sessionToken === 'string') this.sessions.delete(sessionToken);
    if (account) {
      account.sessionTokenHash = null;
      this.persist();
    }
    return { success: true };
  }

  updateProfile(sessionToken, patch = {}) {
    const account = this.sessionAccount(sessionToken);
    if (!account) return { success: false, error: 'Account session expired. Sign in again.' };
    if (patch.displayName != null) account.displayName = normalizeDisplayName(patch.displayName, account.username);
    if (patch.color != null) account.color = normalizeColor(patch.color, account.color);
    if (patch.avatarGrid != null) account.avatarGrid = sanitizeAvatarGrid(patch.avatarGrid);
    if (patch.privacy && typeof patch.privacy === 'object') account.privacy = sanitizePrivacy(patch.privacy);
    this.persist();
    return { success: true, account: publicAccount(account) };
  }

  recordGameResults(players = [], winnerId = null, matchMeta = {}) {
    const matchId = matchMeta.gameId || `match_${crypto.randomUUID()}`;
    const activePlayers = players.filter(player => player);
    const placementById = computePlacementById(activePlayers);
    const participants = activePlayers.map(player => participantFromPlayer(player, { placementById, winnerId }));
    const matchRecord = buildMatchRecord(matchId, matchMeta, participants);
    let changed = false;
    activePlayers.forEach((player) => {
      if (!player.accountId) return;
      const account = this.getAccountById(player.accountId);
      if (!account) return;
      applyMatchResult(account, player, { matchRecord, matchMeta, winnerId });
      changed = true;
    });
    if (changed) this.persist();
    return matchRecord;
  }

  recordAchievement(accountId, achievement = {}) {
    const account = [...this.accounts.values()].find((candidate) => candidate.id === accountId);
    const achievementId = typeof achievement.id === 'string' ? achievement.id.trim().slice(0, 80) : '';
    if (!account || !achievementId) return { success: false, created: false, error: 'Account or achievement not found.' };
    const entries = Array.isArray(account.achievements) ? account.achievements : [];
    if (entries.some((entry) => entry?.id === achievementId)) {
      return { success: true, created: false, achievement: entries.find((entry) => entry.id === achievementId) };
    }
    const entry = { id: achievementId, unlockedAt: typeof achievement.unlockedAt === 'string' ? achievement.unlockedAt : new Date().toISOString() };
    account.achievements = [entry, ...entries].slice(0, 100);
    this.persist();
    return { success: true, created: true, achievement: entry };
  }

  recordPatrolResult(accountId, { score = 0, misses = 0 } = {}) {
    const account = this.getAccountById(accountId);
    if (!account) return { success: false, error: 'Account not found.' };
    const safeScore = clampInt(score, 100000);
    const safeMisses = clampInt(misses, 999);
    const stats = account.stats || (account.stats = {});
    const previousBest = Math.max(0, Number(stats.patrolBest) || 0);
    const beatBest = safeScore > previousBest;
    stats.patrolBest = Math.max(previousBest, safeScore);
    stats.patrolAceRuns = Math.max(0, Number(stats.patrolAceRuns) || 0) + (beatBest && previousBest > 0 ? 1 : 0);
    this.persist();
    return { success: true, score: safeScore, misses: safeMisses, best: stats.patrolBest, aceRuns: stats.patrolAceRuns };
  }

  getPublicAccountById(accountId) {
    const account = [...this.accounts.values()].find(candidate => candidate.id === accountId);
    return account ? publicAccount(account, false) : null;
  }

  getAccountSnapshot(accountId) {
    const account = [...this.accounts.values()].find(candidate => candidate.id === accountId);
    return account ? publicAccount(account, true) : null;
  }

  findAccountByUsername(username) {
    const handle = normalizeUsername(username);
    return this.accounts.get(handle) || null;
  }

  getPublicPlayerCard(accountId) {
    const account = this.getPublicAccountById(accountId);
    if (!account) return null;
    return {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      color: account.color,
      avatarGrid: account.avatarGrid,
      stats: account.stats,
      achievements: account.privacy?.achievements === 'private' ? [] : account.achievements,
      achievementsPrivate: account.privacy?.achievements === 'private',
      historyPrivate: account.privacy?.history === 'private',
      historyFriendsOnly: account.privacy?.history === 'friends',
      // Match history is served through the authorized history endpoint so
      // private-room records can be filtered there. Keep this card itself a
      // compact identity projection.
      history: []
    };
  }

  getAccountById(accountId) {
    return [...this.accounts.values()].find(candidate => candidate.id === accountId) || null;
  }

  getMatchHistory(accountId) {
    return this.getAccountById(accountId)?.matchHistory || [];
  }

  getRecentClearedAt(accountId) {
    return this.getAccountById(accountId)?.recentClearedAt || null;
  }

  clearRecentPlayers(sessionToken) {
    const account = this.sessionAccount(sessionToken);
    if (!account) return { success: false, error: 'Sign in to clear recent players.' };
    account.recentClearedAt = new Date().toISOString();
    this.persist();
    return { success: true };
  }

  getPublicMatchSummaries(accountId, includePrivate = false, limit = 10) {
    return this.getMatchHistory(accountId)
      .filter(record => includePrivate || record.roomVisibility !== 'private')
      .slice(0, Math.max(1, Math.min(20, Number(limit) || 10)))
      .map(record => ({
        matchId: record.matchId,
        completedAt: record.completedAt,
        roundCount: record.roundCount,
        roomVisibility: record.roomVisibility,
        participants: (record.participants || []).map(participant => ({
          displayNameAtMatch: participant.displayNameAtMatch,
          finalPlacement: participant.finalPlacement,
          propertyCount: participant.propertyCount,
          bankrupt: participant.bankrupt
        })),
        globalEvents: Array.isArray(record.globalEvents) ? record.globalEvents : [],
        eventCombinations: Array.isArray(record.eventCombinations) ? record.eventCombinations : [],
        tradesCompleted: Math.max(0, Number(record.tradesCompleted) || 0),
        auctionsCompleted: Math.max(0, Number(record.auctionsCompleted) || 0)
      }));
  }

  getWindowStats(account, since = null) {
    if (!since) return { ...(account.stats || {}) };
    const stats = {
      ...sanitizeStats({}),
      patrolBest: num(account.stats?.patrolBest),
      patrolAceRuns: num(account.stats?.patrolAceRuns)
    };
    windowRecords(account, since).forEach((record) => {
      const participant = findParticipant(record, account.id);
      if (!participant) return;
      Object.entries(WINDOW_STAT_UPDATES).forEach(([key, delta]) => {
        stats[key] += delta(participant, record, account);
      });
    });
    return stats;
  }

  getLeaderboard(metric = 'wins', options = {}) {
    const accounts = [...this.accounts.values()].filter(account => !Array.isArray(options.accountIds) || options.accountIds.includes(account.id));
    const rows = accounts.map(account => leaderboardRow(this, account, metric, options)).filter(Boolean);
    rows.sort((a, b) => b.value - a.value || b.wins - a.wins || a.displayName.localeCompare(b.displayName));
    return rows.slice(0, 100);
  }

  getLeaderboardSnapshot(metrics = ['wins', 'rate', 'games', 'achievements', 'mythical', 'bankruptcies', 'events', 'auctions', 'rent', 'casino', 'market', 'playerloans', 'equity', 'loans', 'patrol'], options = {}) {
    const allowed = metrics.filter(metric => ['wins', 'rate', 'games', 'achievements', 'mythical', 'bankruptcies', 'events', 'auctions', 'rent', 'casino', 'market', 'playerloans', 'equity', 'loans', 'patrol'].includes(metric));
    const selected = allowed.length ? [...new Set(allowed)] : ['wins', 'rate', 'games', 'achievements', 'mythical', 'bankruptcies', 'events', 'auctions', 'rent', 'casino', 'market', 'playerloans', 'equity', 'loans', 'patrol'];
    return {
      generatedAt: new Date().toISOString(),
      metrics: Object.fromEntries(selected.map(metric => [metric, this.getLeaderboard(metric, options)])),
    };
  }
}

const PRIVACY_RULES = {
  history: { allowed: ['public', 'friends', 'private'], fallback: 'friends' },
  achievements: { allowed: ['private'], fallback: 'friends' },
  friendRequests: { allowed: ['everyone', 'friends', 'nobody'], fallback: 'everyone' },
  roomInvites: { allowed: ['friends', 'nobody'], fallback: 'friends' }
};

function sanitizePrivacy(value) {
  return Object.fromEntries(Object.entries(PRIVACY_RULES).map(([key, rule]) => [
    key,
    rule.allowed.includes(value?.[key]) ? value[key] : rule.fallback
  ]));
}
