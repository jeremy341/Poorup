// Match history and leaderboard helpers for account records.
import { clippedList, equityLikeContract, loanLikeContract, nonNegative, num } from './accountShared.js';
import { sanitizeHistory, sanitizeRecordedMatchIds } from './accountRecords.js';

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
export function countContracts(record, accountId, include) {
  return (record.playerContracts || []).filter((contract) => include(contract, accountId)).length;
}

export function realizedMarketPnl(record, accountId) {
  const market = (record.market || []).find((entry) => entry.accountId === accountId);
  return Object.values(market?.positions || {}).reduce((sum, position) => sum + (num(position.realizedPnl)), 0);
}

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

export function buildMatchRecord(matchId, matchMeta, participants) {
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
export function applyMatchResult(account, player, result) {
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

export function anonymizeAccountInMatchRecord(record, accountId) {
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

export function accountAlreadyRecordedMatch(account, matchId) {
  if (sanitizeRecordedMatchIds(account.recordedMatchIds).includes(matchId)) return true;
  return (account.matchHistory || []).some(entry => entry?.matchId === matchId);
}

export function windowRecords(account, since) {
  if (!since) return Array.isArray(account.matchHistory) ? account.matchHistory : [];
  return (account.matchHistory || []).filter(record => Date.parse(record.completedAt || '') >= since);
}

export function findParticipant(record, accountId) {
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

export function leaderboardRow(store, account, metric, options) {
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

export function accountHoldsMatch(account, matchId) {
  return (account.matchHistory || []).some(entry => entry?.matchId === matchId);
}

// Replaces this account's copy of a match record in place (copy-on-write for
// the list). Returns true only when the stored record actually changed.
export function replaceOwnMatchRecord(account, sanitized) {
  const entries = Array.isArray(account.matchHistory) ? account.matchHistory : [];
  const index = entries.findIndex(entry => entry?.matchId === sanitized.matchId);
  if (index < 0) return false;
  const projected = ownerMatchRecord(sanitized);
  if (JSON.stringify(entries[index]) === JSON.stringify(projected)) return false;
  account.matchHistory = [...entries];
  account.matchHistory[index] = projected;
  return true;
}
