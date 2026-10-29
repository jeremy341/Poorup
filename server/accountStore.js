import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { participantFromPlayer } from './participantFields.js';
import { cleanPlayerName, isReservedName } from './nicknamePolicy.js';
import { sanitizeMatch } from './matchStore.js';
import { loadJson, writeJson } from './storeIO.js';
import { computePlacementById } from './gamePlacement.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'accounts.json');
// Absolute lifetime for legacy (non-cookie) session tokens, mirroring the
// cookie store's absolute window. There is no sliding refresh and no rehydrate.
const LEGACY_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Per-account password failure budget. It follows the account rather than the
// address, so rotating peers cannot keep guessing one username. A successful
// password check (login or confirmation) clears only that account's count.
const PASSWORD_FAILURE_LIMIT = 10;
const PASSWORD_FAILURE_WINDOW_MS = 15 * 60_000;
const ACCOUNT_LOCKED_ERROR = 'Too many failed sign-in attempts. Try again later.';
const USERNAME_RE = /^[a-z0-9_]{3,16}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const FACE_SIZE = 8;
const MYTHICAL_ACHIEVEMENT_IDS = new Set(['41st-tile', 'null-player', 'black-ledger']);
const ACHIEVEMENT_POINTS = { common: 10, uncommon: 25, rare: 50, epic: 100, legendary: 250, mythical: 1000 };
const ACHIEVEMENT_RARITY_BY_ID = new Map([
  ...['first-deed', 'last-wallet-standing', 'one-dollar-hedge', 'first-index', 'patrol-rookie'].map(id => [id, 'common']),
  ...['full-street', 'even-builder', 'clean-exit', 'debt-free', 'council-member', 'generous-lender', 'patrol-regular', 'airport-hopper', 'group-therapy'].map(id => [id, 'uncommon']),
  ...['auction-ghost', 'collateral-damage', 'bad-idea-good-timing', 'prison-break', 'no-refunds', 'rent-reaper', 'fire-sale', 'tax-evasion', 'underdog', 'hostile-bidder', 'event-tourist', 'silent-partner', 'roulette-regular', 'market-maker', 'grounded-tourist', 'coalition-builder', 'patrol-ace', 'crisis-manager', 'unanimous', 'public-works'].map(id => [id, 'rare']),
  ...['empty-streets', 'liquidity-king', 'short-the-street', 'moral-hazard', 'treasure-map', 'all-in', 'crisis-investor', 'clean-run', 'bubble-survivor', 'stagflation-trader', 'one-more-turn'].map(id => [id, 'epic']),
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

function profileAccountId(accountOrId) {
  if (typeof accountOrId === 'string') return accountOrId;
  return accountOrId?.id;
}

function applyProfilePatch(account, patch) {
  if (patch.displayName != null) account.displayName = normalizeDisplayName(patch.displayName, account.username);
  if (patch.color != null) account.color = normalizeColor(patch.color, account.color);
  if (patch.avatarGrid != null) account.avatarGrid = sanitizeAvatarGrid(patch.avatarGrid);
  if (patch.privacy && typeof patch.privacy === 'object') account.privacy = sanitizePrivacy({ ...account.privacy, ...patch.privacy });
}

function hasCredentialShape(account, password) {
  return Boolean(account)
    && typeof password === 'string'
    && typeof account.passwordHash === 'string'
    && typeof account.passwordSalt === 'string';
}

const num = (value) => Number(value) || 0;

// One resolver per leaderboard metric. Adding a rank type is one row here. Unknown metrics fall back to wins.
// Keep the server feature flag aligned with the client. New Patrol scores use verified fields; prior records remain available separately.
export const PARLOR_PATROL_ENABLED = true;
export const PARLOR_PATROL_OFF_MESSAGE = 'Parlor Patrol is resting for now. Your saved scores are safe.';

const RANKED_LEADERBOARD_METRICS = Object.freeze([
  'wins', 'rate', 'games', 'achievements', 'mythical', 'bankruptcies', 'events',
  'auctions', 'rent', 'casino', 'market', 'playerloans', 'equity', 'loans',
  ...(PARLOR_PATROL_ENABLED ? ['patrol'] : [])
]);

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
  patrol: (stats) => num(stats.patrolVerifiedBest)
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

// A hybrid is a loan only while its debt leg is active/due/settled; once it
// converts, the remaining live instrument is equity and must not inflate the
// player-loan leaderboard counters.
const loanLikeContract = contract => contract?.kind === 'loan'
  || (contract?.kind === 'hybrid' && contract.status !== 'converted');
const equityLikeContract = contract => contract?.kind === 'equity' || (contract?.kind === 'hybrid' && contract?.status === 'converted');

function realizedMarketPnl(record, accountId) {
  const market = (record.market || []).find((entry) => entry.accountId === accountId);
  return Object.values(market?.positions || {}).reduce((sum, position) => sum + (num(position.realizedPnl)), 0);
}

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeDisplayName(value, fallback = 'PLAYER') {
  const name = cleanPlayerName(value, 18);
  if (name && !isReservedName(name)) return name;
  // The fallback is the username, which grandfathered accounts may have chosen
  // as a reserved label; it must not become the worn name either.
  return isReservedName(String(fallback)) ? `${fallback}_1` : fallback;
}

function normalizeColor(value, fallback = '#d74438') {
  return COLOR_RE.test(String(value || '')) ? String(value).toLowerCase() : fallback;
}

// Issuance stamps share the lifetime of the session entry they describe, so a
// revoked bearer token does not linger as a map key.
function revokeLiveSessions(store, username) {
  for (const [token, owner] of store.sessions) {
    if (owner !== username) continue;
    store.sessions.delete(token);
    store.sessionIssuedAt.delete(token);
  }
}

function revokePersistedSessionHashes(store, username) {
  for (const [tokenHash, owner] of store.sessionHashes) {
    if (owner !== username) continue;
    store.sessionHashes.delete(tokenHash);
    store.sessionIssuedAt.delete(tokenHash);
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function quarantineStamp() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
}

function snapshotStore(store) {
  return {
    accounts: new Map([...store.accounts].map(([key, account]) => [key, { account, state: cloneJson(account) }])),
    sessions: new Map(store.sessions),
    sessionHashes: new Map(store.sessionHashes),
    sessionIssuedAt: new Map(store.sessionIssuedAt),
  };
}

function restoreObject(target, state) {
  Object.keys(target).forEach(key => delete target[key]);
  Object.assign(target, cloneJson(state));
}

function restoreStore(store, snapshot) {
  store.accounts.clear();
  snapshot.accounts.forEach(({ account, state }, key) => {
    restoreObject(account, state);
    store.accounts.set(key, account);
  });
  store.sessions.clear();
  snapshot.sessions.forEach((owner, token) => store.sessions.set(token, owner));
  store.sessionHashes.clear();
  snapshot.sessionHashes.forEach((owner, tokenHash) => store.sessionHashes.set(tokenHash, owner));
  store.sessionIssuedAt.clear();
  (snapshot.sessionIssuedAt || new Map()).forEach((ts, key) => store.sessionIssuedAt.set(key, ts));
}

function commitMutation(store, mutate, persistOptions = {}) {
  const snapshot = snapshotStore(store);
  try {
    const result = mutate();
    store.persist(persistOptions);
    return result;
  } catch (error) {
    restoreStore(store, snapshot);
    throw error;
  }
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

// Match history is capped for profile payloads, but settlement idempotency cannot share that
// window: an old match can be replayed after it leaves the visible list. Keep a durable,
// private ledger of recent match ids that already contributed account stats.
const RECORDED_MATCH_ID_LIMIT = 500;
function sanitizeRecordedMatchIds(value, legacyHistory = []) {
  const source = Array.isArray(value) ? value : legacyHistory.map(entry => entry?.matchId);
  // The ledger is copied into every accounts.json rewrite, so it keeps only the
  // newest ids. A replay older than that window is not recognised.
  return [...new Set(source
    .filter(entry => typeof entry === 'string' && entry.trim())
    .map(entry => entry.trim().slice(0, 80)))].slice(-RECORDED_MATCH_ID_LIMIT);
}

const PENDING_PATROL_ACHIEVEMENT_LIMIT = 100;
function sanitizePendingPatrolAchievementSettlements(value) {
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

const nonNegative = (value) => Math.max(0, Number(value) || 0);

const clippedList = (value, cap) => (Array.isArray(value) ? value.slice(0, cap) : []);

// Placement follows the seat the game crowned. Ranking by cash let a disconnected ghost seat
// take 1st while stats.wins credited the real winner, so ghosts take no placement and sort last.
// A crowned seat outranks the cash ladder even when another seat holds more cash.
function matchDetailFields(matchMeta, participants) {
  if (!matchMeta.includeMatchDetails) return {};
  const fields = {
    playerCount: Math.max(0, Math.floor(Number(matchMeta.playerCount) || participants.length)),
    botDecisions: clippedList(matchMeta.botDecisions, 200),
    netWorthTimeline: clippedList(matchMeta.netWorthTimeline, 40),
    botOnly: matchMeta.botOnly === true
  };
  if (matchMeta.afkOnly === true) fields.afkOnly = true;
  return fields;
}

function rulesetFieldValue(value) {
  return typeof value === 'string' ? value.slice(0, 200) : Math.max(0, Number(value) || 0);
}

function rulesetFields(matchMeta) {
  const fields = {};
  ['boardVariant', 'rulesetRevision', 'balanceRevision', 'rulesetDigest'].forEach(key => {
    if (Object.prototype.hasOwnProperty.call(matchMeta, key)) fields[key] = rulesetFieldValue(matchMeta[key]);
  });
  if (Object.prototype.hasOwnProperty.call(matchMeta, 'rulesetOverrides')) {
    fields.rulesetOverrides = clippedList(matchMeta.rulesetOverrides, 32)
      .filter(entry => entry && typeof entry.key === 'string')
      .map(entry => ({ key: entry.key.slice(0, 60), value: entry.value }));
  }
  return fields;
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
    playerContracts: clippedList(matchMeta.playerContracts, 20),
    ...matchDetailFields(matchMeta, participants),
    ...rulesetFields(matchMeta)
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
  playerLoansGiven: (player, ctx) => ctx.contracts.filter(c => c.fromAccountId === player.accountId && loanLikeContract(c)).length,
  playerLoansRepaid: (player, ctx) => ctx.contracts.filter(c => c.toAccountId === player.accountId && loanLikeContract(c) && c.status === 'paid').length,
  playerLoanDefaults: (player, ctx) => ctx.contracts.filter(c => c.toAccountId === player.accountId && loanLikeContract(c) && c.status === 'defaulted').length,
  equityDeals: (player, ctx) => ctx.contracts.filter(c => equityLikeContract(c) && (c.fromAccountId === player.accountId || c.toAccountId === player.accountId)).length
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
  account.matchHistory = [ownerMatchRecord(result.matchRecord), ...(account.matchHistory || []).filter(entry => entry.matchId !== result.matchRecord.matchId)].slice(0, 50);
  account.recordedMatchIds = sanitizeRecordedMatchIds([...sanitizeRecordedMatchIds(account.recordedMatchIds), result.matchRecord.matchId]);
}

function ownerMatchRecord(matchRecord) {
  if (!matchRecord || !Object.prototype.hasOwnProperty.call(matchRecord, 'botDecisions')) return matchRecord;
  const ownerProjection = { ...matchRecord };
  delete ownerProjection.botDecisions;
  return ownerProjection;
}

// Maps a list, replacing each entry that isOwned() picks out with scrub(entry).
// Returns the mapped list and whether any entry was replaced.
function scrubOwnedEntries(list, isOwned, scrub) {
  let changed = false;
  const mapped = list.map((entry) => {
    if (!isOwned(entry)) return entry;
    changed = true;
    return scrub(entry);
  });
  return { list: mapped, changed };
}

// Writes the scrubbed copy of record[key] onto next and reports whether it changed.
function scrubMatchRecordList(next, record, key, isOwned, scrub) {
  if (!Array.isArray(record[key])) return false;
  const scrubbed = scrubOwnedEntries(record[key], isOwned, scrub);
  next[key] = scrubbed.list;
  return scrubbed.changed;
}

function anonymizeAccountInMatchRecord(record, accountId) {
  if (!record || typeof record !== 'object') return { record, changed: false };
  const next = { ...record };
  const ownsAccountRow = row => row?.accountId === accountId;
  const changes = [
    scrubMatchRecordList(next, record, 'participants', ownsAccountRow, participant => ({ ...participant, accountId: null, displayNameAtMatch: 'ACCOUNT DEACTIVATED' })),
    scrubMatchRecordList(next, record, 'casino', ownsAccountRow, row => ({ ...row, accountId: null })),
    scrubMatchRecordList(next, record, 'market', ownsAccountRow, row => ({ ...row, accountId: null })),
    scrubMatchRecordList(next, record, 'playerContracts',
      contract => contract?.fromAccountId === accountId || contract?.toAccountId === accountId,
      contract => ({
        ...contract,
        ...(contract.fromAccountId === accountId ? { fromAccountId: null } : {}),
        ...(contract.toAccountId === accountId ? { toAccountId: null } : {})
      }))
  ];
  const changed = changes.includes(true);
  return { record: changed ? next : record, changed };
}

function accountAlreadyRecordedMatch(account, matchId) {
  if (sanitizeRecordedMatchIds(account.recordedMatchIds).includes(matchId)) return true;
  return (account.matchHistory || []).some(entry => entry?.matchId === matchId);
}

// The same fifteen deltas recomputed from stored match records, for
// time-windowed views. Wins differ from the live ladder:
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
  playerLoansGiven: (participant, record, account) => countContracts(record, account.id, (contract, id) => contract.fromAccountId === id && loanLikeContract(contract)),
  playerLoansRepaid: (participant, record, account) => countContracts(record, account.id, (contract, id) => contract.toAccountId === id && loanLikeContract(contract) && contract.status === 'paid'),
  playerLoanDefaults: (participant, record, account) => countContracts(record, account.id, (contract, id) => contract.toAccountId === id && loanLikeContract(contract) && contract.status === 'defaulted'),
  equityDeals: (participant, record, account) => countContracts(record, account.id, (contract, id) => equityLikeContract(contract) && (contract.fromAccountId === id || contract.toAccountId === id))
};

function windowRecords(account, since) {
  if (!since) return Array.isArray(account.matchHistory) ? account.matchHistory : [];
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

function leaderboardTrend(account, since) {
  const records = windowRecords(account, since);
  const winsIn = (entries) => entries.reduce((sum, record) => {
    const participant = findParticipant(record, account.id);
    return sum + (participant?.finalPlacement === 1 ? 1 : 0);
  }, 0);
  const recent = records.slice(0, 5);
  const previous = records.slice(5, 10);
  const delta = winsIn(recent) - winsIn(previous);
  return { direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat', delta };
}

function leaderboardRow(store, account, metric, options) {
  const stats = store.getWindowStats(account, options.since || null);
  const tallies = achievementTallies(account, options.since);
  if (metric !== 'patrol' && num(stats.gamesPlayed) < 1) return null;
  if (metric === 'rate' && num(stats.gamesPlayed) < 5) return null;
  if (metric === 'patrol' && num(stats.patrolVerifiedBest) <= 0) return null;
  return {
    accountId: account.id, displayName: account.displayName, username: account.username,
    color: account.color, avatarGrid: account.avatarGrid,
    value: resolveMetricValue(metric, stats, { achievementScore: tallies.score, mythicalCount: tallies.mythical }),
    games: num(stats.gamesPlayed), wins: num(stats.wins), achievements: tallies.count,
    achievementScore: tallies.score, mythical: tallies.mythical,
    bankLoanRepayments: num(stats.bankLoanRepayments), bankLoanDefaults: num(stats.bankLoanDefaults),
    trend: leaderboardTrend(account, options.since)
  };
}

const PUBLIC_HISTORY_KEYS = ['matchId', 'playedAt', 'result', 'won', 'properties'];

function publicHistory(history, includePrivateHistory) {
  const sanitized = sanitizeHistory(history);
  if (includePrivateHistory) return sanitized;
  return sanitized.map(entry => Object.fromEntries(PUBLIC_HISTORY_KEYS.map(key => [key, entry[key]])));
}

function publicAchievements(account, includePrivateHistory) {
  if (!includePrivateHistory && ['private', 'friends'].includes(account.privacy?.achievements)) return [];
  const entries = Array.isArray(account.achievements) ? account.achievements : [];
  return entries.map(entry => ({ id: entry.id, unlockedAt: entry.unlockedAt || null })).slice(0, 100);
}

function publicPlayerStats(stats = {}) {
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

function publicAccount(account, includePrivateHistory = true) {
  if (!account) return null;
  const base = buildPublicAccountBase(account, includePrivateHistory);
  applyPrivateAccountFields(base, account, includePrivateHistory);
  return base;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Salt for the scrypt that stands in for an unknown username's verifier. It
// is never stored or matched against anything.
const DUMMY_PASSWORD_SALT = crypto.randomBytes(16).toString('hex');

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
  'bankLoanRepayments', 'bankLoanDefaults', 'patrolBest', 'patrolAceRuns', 'patrolVerifiedBest', 'patrolVerifiedAceRuns'
];

function sanitizeStats(stats) {
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

function normalizeLoadedAccount(handle, account) {
  const normalized = buildBaseNormalizedAccount(handle, account);
  applyOptionalAccountFields(normalized, account);
  return normalized;
}

function accountHoldsMatch(account, matchId) {
  return (account.matchHistory || []).some(entry => entry?.matchId === matchId);
}

// Replaces this account's copy of a match record in place (copy-on-write for
// the list). Returns true only when the stored record actually changed.
function replaceOwnMatchRecord(account, sanitized) {
  const entries = Array.isArray(account.matchHistory) ? account.matchHistory : [];
  const index = entries.findIndex(entry => entry?.matchId === sanitized.matchId);
  if (index < 0) return false;
  const projected = ownerMatchRecord(sanitized);
  if (JSON.stringify(entries[index]) === JSON.stringify(projected)) return false;
  account.matchHistory = [...entries];
  account.matchHistory[index] = projected;
  return true;
}

function patrolReplayResult(account, prior, misses, settlementId) {
  const stats = account.stats || {};
  return { success: true, score: prior.score, misses, best: Math.max(0, Number(stats.patrolVerifiedBest) || 0), aceRuns: prior.aceRuns, settlementId, replayed: true };
}

// Only a finish that may unlock a Patrol achievement needs a durable journal entry.
function patrolEarnsJournal(score, cleanRun, projectedAceRuns) {
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

const isValidResetGeneration = generation => Number.isSafeInteger(generation) && generation >= 1;
const canRecoverPassword = (password, generation) => validPasswordShape(password) && isValidResetGeneration(generation);

function writeNewPassword(account, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  account.passwordSalt = salt;
  account.passwordHash = hashPassword(password, salt);
}

function normalizedSettlementId(settlementId) {
  return typeof settlementId === 'string' ? settlementId.trim().slice(0, 120) : '';
}

function projectedPatrolAceRuns(account, safeScore) {
  const priorBest = Math.max(0, Number(account.stats?.patrolVerifiedBest) || 0);
  return Math.max(0, Number(account.stats?.patrolVerifiedAceRuns) || 0) + (safeScore > priorBest && priorBest > 0 ? 1 : 0);
}

function applyPatrolSettlement(account, { safeScore, safeMisses, safeSettlementId, cleanRun }) {
  const result = applyPatrolScore(account, safeScore, safeMisses);
  if (safeSettlementId && patrolAchievementIds(safeScore, cleanRun, result.aceRuns).length) {
    journalPatrolSettlement(account, safeSettlementId, safeScore, result.aceRuns, cleanRun);
  }
  if (safeSettlementId) result.settlementId = safeSettlementId;
  return result;
}

export class AccountStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.accounts = new Map();
    this.idIndex = new Map();
    this.sessions = new Map();
    this.sessionHashes = new Map();
    // Legacy token issuance timestamps (token and hash to ms). Memory-only
    // like sessions itself; absolute TTL enforced in sessionAccount.
    this.sessionIssuedAt = new Map();
    // Account id: { startedAt, count }. Bounded by the account count.
    this.passwordFailures = new Map();
    // Record accounting for persist(): records on disk at load, records that
    // failed validation and are not yet moved aside, and the count of records
    // still represented on disk only by those rejects.
    this.onDiskCount = 0;
    this.rejectedCount = 0;
    this.rejectedAtLoad = [];
    this.load();
  }

  load() {
    const { value } = loadJson(this.filePath, loaded => Array.isArray(loaded));
    if (!value) return;
    const entries = value;
    if (!Array.isArray(entries)) return;
    const rejected = [];
    entries.forEach((account) => {
      const handle = normalizeUsername(account?.username);
      // Normalize legacy records as they load and keep the Map invariant
      // case-insensitive. If a malformed file contains duplicate handles,
      // the first valid record remains the owner of that username.
      if (!loadableAccount(handle, account, this.accounts)) {
        rejected.push(account);
        return;
      }
      this.accounts.set(handle, normalizeLoadedAccount(handle, account));
      // Persisted session hashes are not rehydrated. Cookie
      // sessions (sessionStore records) survive restarts with their own
      // expiry; legacy tokens require a fresh login after a restart.
    });
    this.onDiskCount = entries.length;
    this.rejectedCount = rejected.length;
    this.rejectedAtLoad = rejected;
    if (rejected.length) console.error(`Account store: ${rejected.length} record(s) failed validation and will be moved to a sidecar before the next write.`);
  }

  // The rejected records are moved aside before the store is rewritten, so the
  // rewrite cannot erase them. A rewrite that would drop records other
  // than the rejected ones and the purged accounts is refused.
  persist({ removed = 0 } = {}) {
    if (this.rejectedAtLoad.length) {
      writeJson(`${this.filePath}.rejected-${quarantineStamp()}.json`, this.rejectedAtLoad);
      this.rejectedAtLoad = [];
    }
    const records = [...this.accounts.values()];
    if (this.onDiskCount - records.length > this.rejectedCount + removed) {
      throw new Error('Account record count dropped unexpectedly; the store was not written.');
    }
    writeJson(this.filePath, records);
    this.onDiskCount = records.length;
    this.rejectedCount = 0;
  }

  resolveSessionUsername(sessionToken) {
    let username = this.sessions.get(sessionToken);
    if (username) return { username, key: sessionToken };
    const tokenHash = hashSessionToken(sessionToken);
    username = this.sessionHashes.get(tokenHash);
    if (username) {
      this.sessions.set(sessionToken, username);
      return { username, key: tokenHash };
    }
    return { username: null, key: null };
  }

  ensureLegacyIssuedAt(key) {
    const now = Date.now();
    let issuedAt = this.sessionIssuedAt.get(key);
    if (!Number.isFinite(issuedAt)) {
      issuedAt = now;
      this.sessionIssuedAt.set(key, issuedAt);
    }
    return { now, issuedAt };
  }

  expireLegacySessionIfNeeded(sessionToken, key, now, issuedAt) {
    if (now - issuedAt < LEGACY_SESSION_TTL_MS) return false;
    this.sessions.delete(sessionToken);
    this.sessionIssuedAt.delete(sessionToken);
    try {
      const tokenHash = hashSessionToken(sessionToken);
      this.sessionHashes.delete(tokenHash);
      this.sessionIssuedAt.delete(tokenHash);
    } catch { /* unhashable */ }
    this.sessionIssuedAt.delete(key);
    return true;
  }

  sessionAccount(sessionToken) {
    if (typeof sessionToken !== 'string' || !sessionToken) return null;
    const { username, key } = this.resolveSessionUsername(sessionToken);
    if (!username) return null;
    const { now, issuedAt } = this.ensureLegacyIssuedAt(key);
    if (this.expireLegacySessionIfNeeded(sessionToken, key, now, issuedAt)) return null;
    return this.accounts.get(username) || null;
  }

  sessionTokenHashFor(sessionToken) {
    if (typeof sessionToken !== 'string' || !sessionToken) return null;
    const hash = hashSessionToken(sessionToken);
    return this.sessionHashes.has(hash) ? hash : null;
  }

  accountForSessionHash(tokenHash, expectedAccountId = null) {
    if (typeof tokenHash !== 'string' || !tokenHash) return null;
    const username = this.sessionHashes.get(tokenHash);
    const account = username ? this.accounts.get(username) || null : null;
    if (!account) return null;
    if (expectedAccountId && account.id !== expectedAccountId) return null;
    // Cookie sessions are bearer tokens too, so they are bounded by the same
    // absolute TTL the legacy token path enforces. A hash that is past its
    // lifetime authenticates nobody and is dropped from both indexes.
    const { now, issuedAt } = this.ensureLegacyIssuedAt(tokenHash);
    if (now - issuedAt >= LEGACY_SESSION_TTL_MS) {
      this.sessionHashes.delete(tokenHash);
      this.sessionIssuedAt.delete(tokenHash);
      return null;
    }
    return account;
  }

  issueSession(account) {
    revokeLiveSessions(this, account.username);
    // Remove every persisted hash for the account, not just the latest field on the record.
    // This also clears hashes from older builds, so a rotated or logged-out token cannot
    // come back through the fallback index.
    revokePersistedSessionHashes(this, account.username);
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    this.sessions.set(token, account.username);
    this.sessionHashes.set(tokenHash, account.username);
    const issuedAt = Date.now();
    this.sessionIssuedAt.set(token, issuedAt);
    this.sessionIssuedAt.set(tokenHash, issuedAt);
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
    return commitMutation(this, () => {
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
        recordedMatchIds: [],
        consumedPasswordResetGeneration: 0,
        privacy: sanitizePrivacy(null),
        recentClearedAt: null,
        createdAt: new Date().toISOString(),
      };
      this.accounts.set(handle, account);
      const sessionToken = this.issueSession(account);
      return { success: true, account: publicAccount(account), sessionToken };
    });
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
    if (isReservedName(handle)) {
      return {
        success: true,
        available: false,
        reason: 'reserved',
        username: handle,
        message: 'That username is reserved.',
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

  passwordLocked(account) {
    const entry = account?.id ? this.passwordFailures.get(account.id) : null;
    if (!entry) return false;
    if (Date.now() - entry.startedAt >= PASSWORD_FAILURE_WINDOW_MS) {
      this.passwordFailures.delete(account.id);
      return false;
    }
    return entry.count >= PASSWORD_FAILURE_LIMIT;
  }

  recordPasswordResult(account, matched) {
    if (!account?.id) return;
    if (matched) {
      this.passwordFailures.delete(account.id);
      return;
    }
    const now = Date.now();
    const current = this.passwordFailures.get(account.id);
    const entry = current && now - current.startedAt < PASSWORD_FAILURE_WINDOW_MS ? current : { startedAt: now, count: 0 };
    entry.count += 1;
    this.passwordFailures.set(account.id, entry);
  }

  login({ username, password } = {}) {
    const handle = normalizeUsername(username);
    const account = this.accounts.get(handle);
    if (!hasCredentialShape(account, password) || !validPasswordShape(password)) {
      // An unknown username pays the same scrypt as a known one, so the
      // response time cannot tell registered names from unregistered ones.
      if (!account && validPasswordShape(password)) hashPassword(password, DUMMY_PASSWORD_SALT);
      return { success: false, error: 'Username or password is incorrect.' };
    }
    // Cheap state first: a locked account never pays for a scrypt derivation.
    if (this.passwordLocked(account)) return { success: false, code: 'ACCOUNT_LOCKED', error: ACCOUNT_LOCKED_ERROR };
    const expected = Buffer.from(account.passwordHash, 'hex');
    const actual = Buffer.from(hashPassword(password, account.passwordSalt), 'hex');
    const matched = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    this.recordPasswordResult(account, matched);
    if (!matched) {
      return { success: false, error: 'Username or password is incorrect.' };
    }
    return commitMutation(this, () => {
      const sessionToken = this.issueSession(account);
      return { success: true, account: publicAccount(account), sessionToken };
    });
  }

  restore(sessionToken) {
    const account = this.sessionAccount(sessionToken);
    return account ? { success: true, account: publicAccount(account) } : { success: false, error: 'Account session expired. Sign in again.' };
  }

  // Revoke exactly one legacy token (both indexes + stamps). Used for
  // single-use upgrades like cookie exchange; unlike logout it leaves
  // sibling sessions and the account record untouched.
  revokeSessionToken(sessionToken) {
    if (typeof sessionToken !== 'string' || !sessionToken) return false;
    let revoked = false;
    if (this.sessions.delete(sessionToken)) revoked = true;
    try {
      const tokenHash = hashSessionToken(sessionToken);
      if (this.sessionHashes.delete(tokenHash)) revoked = true;
      this.sessionIssuedAt.delete(sessionToken);
      this.sessionIssuedAt.delete(tokenHash);
    } catch { /* unhashable token: map deletion above suffices */ }
    return revoked;
  }

  logout(sessionToken) {
    const account = this.sessionAccount(sessionToken);
    if (!account) {
      if (typeof sessionToken === 'string') {
        this.sessions.delete(sessionToken);
        this.sessionIssuedAt.delete(sessionToken);
      }
      return { success: true };
    }
    return commitMutation(this, () => {
      if (typeof sessionToken === 'string') {
        this.sessions.delete(sessionToken);
        this.sessionIssuedAt.delete(sessionToken);
      }
      revokePersistedSessionHashes(this, account.username);
      account.sessionTokenHash = null;
      return { success: true };
    });
  }

  verifyPassword(account, password) {
    if (!hasCredentialShape(account, password) || !validPasswordShape(password)) return false;
    if (this.passwordLocked(account)) return false;
    const expected = Buffer.from(account.passwordHash, 'hex');
    const actual = Buffer.from(hashPassword(password, account.passwordSalt), 'hex');
    const matched = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    this.recordPasswordResult(account, matched);
    return matched;
  }

  listAccounts() {
    return [...this.accounts.values()];
  }

  setAccountDeactivated(account, value) {
    if (!account || typeof account !== 'object') return false;
    account.accountDeactivated = value === true;
    return account.accountDeactivated;
  }

  updatePassword(accountId, password) {
    const account = this.getAccountById(accountId);
    if (!account || !validPasswordShape(password)) return false;
    const updated = commitMutation(this, () => {
      writeNewPassword(account, password);
      this.revokeSessionsForAccount(account.id, false);
      return true;
    });
    // Resetting the password is the remedy for a locked account, so the failure
    // window must not outlive it (the mutation above throws if it did not land).
    this.passwordFailures.delete(account.id);
    return updated;
  }

  // Store the reset watermark with the credential in the same atomic write.
  // Recovery uses it to reject stale reset tokens if token-file cleanup fails.
  updatePasswordForRecovery(accountId, password, consumedGeneration) {
    const account = this.getAccountById(accountId);
    const generation = Number(consumedGeneration);
    if (!account || !canRecoverPassword(password, generation)) return false;
    const updated = commitMutation(this, () => {
      writeNewPassword(account, password);
      account.consumedPasswordResetGeneration = Math.max(Number(account.consumedPasswordResetGeneration) || 0, generation);
      this.revokeSessionsForAccount(account.id, false);
      return true;
    });
    this.passwordFailures.delete(account.id);
    return updated;
  }

  shouldRevokeLiveSession(owner, accountUsername, keepToken, token) {
    if (owner !== accountUsername) return false;
    if (keepToken && token === keepToken) return false;
    return true;
  }

  shouldRevokeHash(owner, accountUsername, keepToken, hash) {
    if (owner !== accountUsername) return false;
    if (!keepToken) return true;
    try {
      return hash !== hashSessionToken(keepToken);
    } catch {
      return true;
    }
  }

  revokeLiveSessionsForAccount(accountUsername, keepToken) {
    let revoked = 0;
    for (const [token, owner] of [...this.sessions]) {
      if (!this.shouldRevokeLiveSession(owner, accountUsername, keepToken, token)) continue;
      this.sessions.delete(token);
      this.sessionIssuedAt.delete(token);
      revoked += 1;
    }
    return revoked;
  }

  revokeHashSessionsForAccount(accountUsername, keepToken) {
    for (const [hash, owner] of [...this.sessionHashes]) {
      if (!this.shouldRevokeHash(owner, accountUsername, keepToken, hash)) continue;
      this.sessionHashes.delete(hash);
      this.sessionIssuedAt.delete(hash);
    }
  }

  revokeSessionsForAccount(accountId, persist = true, keepToken = null) {
    const account = this.getAccountById(accountId);
    if (!account) return 0;
    const revoked = this.revokeLiveSessionsForAccount(account.username, keepToken);
    this.revokeHashSessionsForAccount(account.username, keepToken);
    if (!keepToken) account.sessionTokenHash = null;
    if (persist) this.persist();
    return revoked;
  }

  purgeAccount(accountId) {
    const account = this.getAccountById(accountId);
    if (!account) return false;
    const purged = commitMutation(this, () => {
      this.revokeSessionsForAccount(account.id, false);
      this.accounts.forEach((remaining) => {
        if (remaining.id === account.id || !Array.isArray(remaining.matchHistory)) return;
        let changed = false;
        const next = remaining.matchHistory.map((record) => {
          const scrubbed = anonymizeAccountInMatchRecord(record, account.id);
          changed ||= scrubbed.changed;
          return scrubbed.record;
        });
        if (changed) remaining.matchHistory = next;
      });
      this.accounts.delete(account.username);
      return true;
    }, { removed: 1 });
    this.passwordFailures.delete(account.id);
    return purged;
  }

  snapshot() {
    return snapshotStore(this);
  }

  restoreSnapshot(snapshot) {
    if (!snapshot) return false;
    restoreStore(this, snapshot);
    return true;
  }

  updateProfile(sessionToken, patch = {}) {
    return this.updateProfileForAccount(this.sessionAccount(sessionToken), patch);
  }

  updateProfileForAccount(accountOrId, patch = {}) {
    const accountId = profileAccountId(accountOrId);
    const account = accountId ? this.getAccountById(accountId) : null;
    if (!account) return { success: false, error: 'Account session expired. Sign in again.' };
    return commitMutation(this, () => {
      applyProfilePatch(account, patch);
      return { success: true, account: publicAccount(account) };
    });
  }

  recordGameResults(players = [], winnerId = null, matchMeta = {}) {
    const matchId = matchMeta.gameId || `match_${crypto.randomUUID()}`;
    const activePlayers = players.filter(player => player);
    const placementById = computePlacementById(activePlayers, winnerId);
    const participants = activePlayers.map(player => participantFromPlayer(player, {
      placementById,
      winnerId,
      includeMatchDetails: matchMeta.includeMatchDetails === true
    }));
    const matchRecord = buildMatchRecord(matchId, matchMeta, participants);
    // Memory is written before disk here. A failed write must not leave memory believing the match
    // was settled, or the ledger would refuse the retry. Snapshot first and restore on failure,
    // the same invariant commitMutation enforces for the other mutating entry points.
    const pending = activePlayers.some((player) => {
      if (!player.accountId) return false;
      const account = this.getAccountById(player.accountId);
      return Boolean(account) && !accountAlreadyRecordedMatch(account, matchId);
    });
    if (!pending) return matchRecord;
    const snapshot = snapshotStore(this);
    try {
      let changed = false;
      activePlayers.forEach((player) => {
        if (!player.accountId) return;
        const account = this.getAccountById(player.accountId);
        if (!account) return;
        if (accountAlreadyRecordedMatch(account, matchId)) return;
        applyMatchResult(account, player, { matchRecord, matchMeta, winnerId });
        changed = true;
      });
      if (changed) this.persist();
      return matchRecord;
    } catch (error) {
      restoreStore(this, snapshot);
      throw error;
    }
  }

  // Achievement evaluation and seasonal assignment enrich a completed match
  // after the base stats/history write. Replace that one immutable record in
  // each participating account without replaying any stat deltas.
  updateMatchRecord(matchRecord = {}) {
    const sanitized = sanitizeMatch(matchRecord);
    if (!sanitized.matchId) return { updated: false, match: null };
    const participantAccountIds = new Set(
      sanitized.participants.map(participant => participant.accountId).filter(Boolean)
    );
    // Same invariant as recordGameResults: the replaced record only counts as
    // applied once it reached the disk.
    const owners = [...this.accounts.values()].filter(account => (
      participantAccountIds.has(account.id) && accountHoldsMatch(account, sanitized.matchId)
    ));
    if (!owners.length) return { updated: false, match: sanitized };
    const snapshot = snapshotStore(this);
    try {
      let updated = false;
      this.accounts.forEach(account => {
        if (participantAccountIds.has(account.id) && replaceOwnMatchRecord(account, sanitized)) updated = true;
      });
      if (updated) this.persist();
      return { updated, match: sanitized };
    } catch (error) {
      restoreStore(this, snapshot);
      throw error;
    }
  }

  recordAchievement(accountId, achievement = {}) {
    const account = this.getAccountById(accountId);
    const achievementId = typeof achievement.id === 'string' ? achievement.id.trim().slice(0, 80) : '';
    if (!account || !achievementId) return { success: false, created: false, error: 'Account or achievement not found.' };
    const entries = Array.isArray(account.achievements) ? account.achievements : [];
    if (entries.some((entry) => entry?.id === achievementId)) {
      return { success: true, created: false, achievement: entries.find((entry) => entry.id === achievementId) };
    }
    const entry = { id: achievementId, unlockedAt: typeof achievement.unlockedAt === 'string' ? achievement.unlockedAt : new Date().toISOString() };
    return commitMutation(this, () => {
      account.achievements = [entry, ...entries].slice(0, 100);
      return { success: true, created: true, achievement: entry };
    });
  }

  removeAchievement(accountId, achievementId) {
    const account = this.getAccountById(accountId);
    if (!account || typeof achievementId !== 'string') return false;
    const entries = Array.isArray(account.achievements) ? account.achievements : [];
    const next = entries.filter(entry => entry?.id !== achievementId);
    if (next.length === entries.length) return false;
    return commitMutation(this, () => {
      account.achievements = next;
      return true;
    });
  }

  recordPatrolResult(accountId, { score = 0, misses = 0, settlementId = null, cleanRun = false } = {}) {
    if (!PARLOR_PATROL_ENABLED) return { success: false, error: PARLOR_PATROL_OFF_MESSAGE };
    const account = this.getAccountById(accountId);
    if (!account) return { success: false, error: 'Account not found.' };
    const safeScore = clampInt(score, Number.MAX_SAFE_INTEGER);
    const safeMisses = clampInt(misses, 999);
    const safeSettlementId = normalizedSettlementId(settlementId);
    const pendingSettlements = sanitizePendingPatrolAchievementSettlements(account.pendingPatrolAchievementSettlements);
    const prior = safeSettlementId && pendingSettlements.find(entry => entry.id === safeSettlementId);
    if (prior) return patrolReplayResult(account, prior, safeMisses, safeSettlementId);
    const needsJournal = Boolean(safeSettlementId) && patrolEarnsJournal(safeScore, cleanRun, projectedPatrolAceRuns(account, safeScore));
    if (needsJournal && pendingSettlements.length >= PENDING_PATROL_ACHIEVEMENT_LIMIT) {
      return { success: false, retryable: true, error: 'Patrol achievement recovery is busy. Please retry this finish.' };
    }
    return commitMutation(this, () => applyPatrolSettlement(account, { safeScore, safeMisses, safeSettlementId, cleanRun }));
  }

  getPendingPatrolAchievementSettlements(accountId) {
    return sanitizePendingPatrolAchievementSettlements(this.getAccountById(accountId)?.pendingPatrolAchievementSettlements);
  }

  completePatrolAchievementSettlement(accountId, settlementId) {
    const account = this.getAccountById(accountId);
    const id = normalizedSettlementId(settlementId);
    if (!account || !id) return { success: false, completed: false };
    const pending = sanitizePendingPatrolAchievementSettlements(account.pendingPatrolAchievementSettlements);
    if (!pending.some(entry => entry.id === id)) return { success: true, completed: false };
    return commitMutation(this, () => {
      account.pendingPatrolAchievementSettlements = pending.filter(entry => entry.id !== id);
      return { success: true, completed: true };
    });
  }

  getPublicAccountById(accountId) {
    const account = this.getAccountById(accountId);
    return account ? publicAccount(account, false) : null;
  }

  getAccountSnapshot(accountId) {
    const account = this.getAccountById(accountId);
    return account ? publicAccount(account, true) : null;
  }

  findAccountByUsername(username) {
    const handle = normalizeUsername(username);
    return this.accounts.get(handle) || null;
  }

  // includeAchievements is the friend-level reveal (friends-only accounts); a
  // private account reveals its achievements to its owner alone (owner: true).
  getPublicPlayerCard(accountId, { includeAchievements = false, owner = false } = {}) {
    const account = this.getAccountById(accountId);
    if (!account) return null;
    const achievementsPrivate = account.privacy?.achievements === 'private';
    const revealAchievements = Boolean(includeAchievements) && (owner || !achievementsPrivate);
    const publicView = publicAccount(account, false);
    return {
      id: publicView.id,
      username: publicView.username,
      displayName: publicView.displayName,
      color: publicView.color,
      avatarGrid: publicView.avatarGrid,
      stats: publicPlayerStats(account.stats),
      achievements: revealAchievements ? publicAchievements(account, true) : publicView.achievements,
      achievementsPrivate,
      achievementsFriendsOnly: account.privacy?.achievements === 'friends' && !revealAchievements,
      historyPrivate: account.privacy?.history === 'private',
      historyFriendsOnly: account.privacy?.history === 'friends',
      // Match history is served through the authorized history endpoint so
      // private-room records can be filtered there. Keep this card itself a
      // compact identity projection.
      history: []
    };
  }

  // id maps to a live account. Every hit is re-checked against the map, so a purge,
  // rollback or replaced record can never be served from a stale entry; a miss
  // rebuilds the index in one pass, so a lookup does not scan every account.
  getAccountById(accountId) {
    const hit = this.idIndex.get(accountId);
    if (hit && hit.id === accountId && this.accounts.get(hit.username) === hit) return hit;
    this.idIndex.clear();
    for (const candidate of this.accounts.values()) {
      if (!this.idIndex.has(candidate.id)) this.idIndex.set(candidate.id, candidate);
    }
    return this.idIndex.get(accountId) || null;
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
    return this.clearRecentPlayersForAccount(account.id);
  }

  clearRecentPlayersForAccount(accountId) {
    const account = this.getAccountById(accountId);
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
        roundCount: nonNegative(record.roundCount),
        roomVisibility: record.roomVisibility,
        participants: (record.participants || []).map(participant => ({
          displayNameAtMatch: participant.displayNameAtMatch,
          finalPlacement: participant.finalPlacement,
          propertyCount: participant.propertyCount,
          bankrupt: participant.bankrupt,
          isViewedPlayer: participant.accountId === accountId
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
      patrolAceRuns: num(account.stats?.patrolAceRuns),
      patrolVerifiedBest: num(account.stats?.patrolVerifiedBest),
      patrolVerifiedAceRuns: num(account.stats?.patrolVerifiedAceRuns)
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
    if (metric === 'patrol' && !PARLOR_PATROL_ENABLED) return [];
    const accounts = [...this.accounts.values()].filter(account => account.accountDeactivated !== true)
      .filter(account => !Array.isArray(options.accountIds) || options.accountIds.includes(account.id));
    const rows = accounts.map(account => leaderboardRow(this, account, metric, options)).filter(Boolean);
    rows.sort((a, b) => b.value - a.value || b.wins - a.wins || a.displayName.localeCompare(b.displayName));
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 100)));
    return rows.slice(0, limit);
  }

  getLeaderboardSnapshot(metrics = RANKED_LEADERBOARD_METRICS, options = {}) {
    const allowed = metrics.filter(metric => RANKED_LEADERBOARD_METRICS.includes(metric));
    const selected = allowed.length ? [...new Set(allowed)] : RANKED_LEADERBOARD_METRICS;
    return {
      generatedAt: new Date().toISOString(),
      metrics: Object.fromEntries(selected.map(metric => [metric, this.getLeaderboard(metric, { ...options, limit: options.primaryMetric === metric ? 100 : 3 })])),
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
