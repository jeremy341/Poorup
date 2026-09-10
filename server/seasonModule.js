// Seasonal standings are a bounded, server-verified projection of completed
// matches. They never participate in GameState legality and therefore cannot
// change the outcome of a live table.
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { loadJson, writeJson } from './storeIO.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'seasons.json');
const SEASON_LENGTH_MS = 8 * 7 * 24 * 60 * 60 * 1000;
const PARTICIPATION_CAP = 10;
const WIN_RATE_MINIMUM = 5;
export const SEASON_METRICS = Object.freeze([
  'wins', 'games', 'rate', 'achievements', 'mythical', 'bankruptcies',
  'events', 'auctions', 'rent', 'casino', 'market', 'playerloans',
  'equity', 'loans', 'patrol'
]);

const REWARD_TRACK = Object.freeze([
  { id: 'season-bronze', track: 'placement', threshold: 0.50, cosmeticId: 'frame-copper', tokens: 40 },
  { id: 'season-silver', track: 'placement', threshold: 0.25, cosmeticId: 'frame-silver', tokens: 80 },
  { id: 'season-gold', track: 'placement', threshold: 0.10, cosmeticId: 'frame-gold', tokens: 140 },
  { id: 'season-top', track: 'placement', threshold: 0.01, cosmeticId: 'stamp-parlor-star', tokens: 220 },
  { id: 'season-grinder', track: 'participation', threshold: 8, cosmeticId: 'title-night-shift', tokens: 60 },
  { id: 'season-master', track: 'mastery', threshold: 500, cosmeticId: 'frame-ledger', tokens: 120 }
]);

function safeAccountId(value) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function safeSeasonId(value) {
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

function seasonStartFor(date) {
  const now = new Date(date);
  const epoch = Date.UTC(2026, 0, 5); // stable Monday anchor for reproducible ids
  const elapsed = Math.max(0, now.getTime() - epoch);
  const period = Math.floor(elapsed / SEASON_LENGTH_MS);
  return new Date(epoch + period * SEASON_LENGTH_MS);
}

export function seasonIdFor(date = Date.now()) {
  return `S${seasonStartFor(date).toISOString().slice(0, 10).replaceAll('-', '')}`;
}

function makeSeason(date = Date.now()) {
  const startsAt = seasonStartFor(date);
  return {
    id: seasonIdFor(date),
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + SEASON_LENGTH_MS).toISOString(),
    status: 'active',
    revision: 1,
    rewardTrack: REWARD_TRACK.map(reward => ({ ...reward })),
    matches: [],
    standings: {},
    claims: {}
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function publicSeasonSummary(season) {
  if (!season) return null;
  return {
    id: season.id,
    startsAt: season.startsAt,
    endsAt: season.endsAt,
    status: season.status,
    revision: season.revision,
    rewardTrack: (season.rewardTrack || []).map(reward => ({ ...reward })),
    matchCount: Array.isArray(season.matches) ? season.matches.length : 0
  };
}

function normalizedStatus(value) {
  return ['active', 'complete', 'upcoming'].includes(value) ? value : 'complete';
}

function normalizedRewardTrack(value) {
  return Array.isArray(value)
    ? value.slice(0, 32).map(item => ({ ...item }))
    : REWARD_TRACK.map(reward => ({ ...reward }));
}

function normalizedMatches(value) {
  return Array.isArray(value) ? value.filter(id => typeof id === 'string').slice(-1000) : [];
}

function validStandingEntry(id, row) {
  if (!id) return false;
  if (!row || typeof row !== 'object') return false;
  return true;
}

function normalizedStandings(value) {
  const standings = {};
  Object.entries(value || {}).slice(0, 5000).forEach(([accountId, row]) => {
    const id = safeAccountId(accountId);
    if (!validStandingEntry(id, row)) return;
    standings[id] = normalizeStanding(row);
  });
  return standings;
}

function normalizedClaims(value) {
  const claims = {};
  Object.entries(value || {}).slice(0, 5000).forEach(([accountId, rewards]) => {
    const id = safeAccountId(accountId);
    if (!id) return;
    claims[id] = Array.isArray(rewards) ? rewards.filter(item => typeof item === 'string').slice(0, 64) : [];
  });
  return claims;
}

function normalizeSeason(source) {
  if (!source || typeof source !== 'object') return null;
  const season = {
    id: safeSeasonId(source.id),
    startsAt: typeof source.startsAt === 'string' ? source.startsAt : new Date(0).toISOString(),
    endsAt: typeof source.endsAt === 'string' ? source.endsAt : new Date(0).toISOString(),
    status: normalizedStatus(source.status),
    revision: Math.max(1, Math.floor(Number(source.revision) || 1)),
    rewardTrack: normalizedRewardTrack(source.rewardTrack),
    matches: normalizedMatches(source.matches),
    standings: normalizedStandings(source.standings),
    claims: normalizedClaims(source.claims)
  };
  return season.id ? season : null;
}

function nonNegativeInt(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function numericValue(value) {
  return Number(value) || 0;
}

function normalizeStanding(row = {}) {
  return {
    games: nonNegativeInt(row.games),
    wins: nonNegativeInt(row.wins),
    points: nonNegativeInt(row.points),
    participation: nonNegativeInt(row.participation),
    mastery: nonNegativeInt(row.mastery),
    fairTrades: nonNegativeInt(row.fairTrades),
    eventSurvival: nonNegativeInt(row.eventSurvival),
    debtDiscipline: nonNegativeInt(row.debtDiscipline),
    mythical: nonNegativeInt(row.mythical),
    bankruptcies: nonNegativeInt(row.bankruptcies),
    auctionWins: nonNegativeInt(row.auctionWins),
    rentCollected: nonNegativeInt(row.rentCollected),
    casinoNet: numericValue(row.casinoNet),
    marketProfit: numericValue(row.marketProfit),
    playerLoansGiven: nonNegativeInt(row.playerLoansGiven),
    equityDeals: nonNegativeInt(row.equityDeals),
    patrolBest: nonNegativeInt(row.patrolBest),
    lastMatchAt: typeof row.lastMatchAt === 'string' ? row.lastMatchAt : null
  };
}

export function eligibleSeasonMatch(record) {
  if (!validSeasonRecord(record)) return false;
  if (invalidSeasonFlags(record)) return false;
  return record.participants.some(participant => Boolean(safeAccountId(participant.accountId)));
}

function validSeasonRecord(record) {
  if (!record || typeof record !== 'object') return false;
  if (!record.matchId) return false;
  if (!Array.isArray(record.participants)) return false;
  return record.participants.length >= 2;
}

function invalidSeasonFlags(record) {
  return ['abandoned', 'preview', 'duplicate', 'afkOnly', 'botOnly'].some(flag => record[flag] === true);
}

function participantPoints(participant) {
  const placement = Number(participant.finalPlacement);
  const placementPoints = placement === 1 ? 100 : placement > 0 ? Math.max(10, 80 - placement * 10) : 10;
  const eventPoints = Math.min(40, Math.max(0, Number(participant.globalEventsSurvived) || 0) * 8);
  const tradePoints = Math.min(30, Math.max(0, Number(participant.fairTrades ?? participant.tradesCompleted) || 0) * 3);
  const debtPoints = participant.bankLoanStatus === 'paid' ? 10 : participant.bankLoanStatus === 'defaulted' ? 0 : 5;
  return placementPoints + eventPoints + tradePoints + debtPoints;
}

function contractMetric(record, accountId, predicate) {
  return (record?.playerContracts || []).filter(contract => predicate(contract, accountId)).length;
}

function marketProfitMetric(record, accountId) {
  const entry = (record?.market || []).find(item => item.accountId === accountId);
  return Object.values(entry?.positions || {}).reduce((sum, position) => sum + (Number(position?.realizedPnl) || 0), 0);
}

export function seasonMetricValue(metric, row = {}) {
  const values = {
    wins: row.wins,
    games: row.games,
    rate: row.rate == null ? null : Math.round(row.rate * 100),
    achievements: row.mastery,
    mythical: row.mythical,
    bankruptcies: row.bankruptcies,
    events: row.eventSurvival,
    auctions: row.auctionWins,
    rent: row.rentCollected,
    casino: row.casinoNet,
    market: row.marketProfit,
    playerloans: row.playerLoansGiven,
    equity: row.equityDeals,
    loans: row.debtDiscipline,
    patrol: row.patrolBest
  };
  return Object.prototype.hasOwnProperty.call(values, metric) ? values[metric] : row.points;
}

function updateStandingCore(next, participant) {
  const placement = Number(participant.finalPlacement);
  next.games += 1;
  next.wins += placement === 1 ? 1 : 0;
  next.points += participantPoints(participant);
  next.participation = Math.min(PARTICIPATION_CAP, next.participation + 1);
  next.fairTrades += nonNegativeInt(participant.fairTrades ?? participant.tradesCompleted);
  next.eventSurvival += nonNegativeInt(participant.globalEventsSurvived);
  next.debtDiscipline += participant.bankLoanStatus === 'paid' ? 1 : 0;
  next.mastery += Math.min(100, next.eventSurvival * 4 + next.fairTrades * 3 + next.debtDiscipline * 6);
  next.mythical += participant.mythicalUnlocked === true ? 1 : 0;
  next.bankruptcies += participant.bankrupt === true ? 1 : 0;
  next.auctionWins += nonNegativeInt(participant.auctionWins);
  next.rentCollected += nonNegativeInt(participant.rentCollected);
}

function isLoanContractFor(contract, accountId) {
  return contract.fromAccountId === accountId
    && (contract.kind === 'loan' || (contract.kind === 'hybrid' && contract.status !== 'converted'));
}

function isEquityContractFor(contract, accountId) {
  const kindMatches = contract.kind === 'equity' || (contract.kind === 'hybrid' && contract.status === 'converted');
  return kindMatches && (contract.fromAccountId === accountId || contract.toAccountId === accountId);
}

function updateStandingRecords(next, participant, accountId, record) {
  const casino = (record?.casino || []).find(item => item.accountId === accountId);
  next.casinoNet += Number(casino?.net) || Number(participant.casinoNet) || 0;
  next.marketProfit += marketProfitMetric(record, accountId);
  next.playerLoansGiven += contractMetric(record, accountId, isLoanContractFor);
  next.equityDeals += contractMetric(record, accountId, isEquityContractFor);
}

function updateStanding(row, participant, completedAt, record) {
  const next = normalizeStanding(row);
  const accountId = safeAccountId(participant.accountId);
  updateStandingCore(next, participant);
  updateStandingRecords(next, participant, accountId, record);
  next.lastMatchAt = completedAt;
  return next;
}

function sortStandings(season, metric = 'points') {
  const rows = Object.entries(season.standings).map(([accountId, row]) => ({ accountId, ...normalizeStanding(row) }));
  rows.forEach(row => { row.rate = row.games >= WIN_RATE_MINIMUM ? row.wins / row.games : null; });
  rows.sort((a, b) => {
    const avRaw = seasonMetricValue(metric, a);
    const bvRaw = seasonMetricValue(metric, b);
    const av = avRaw == null ? -1 : avRaw;
    const bv = bvRaw == null ? -1 : bvRaw;
    return bv - av || b.points - a.points || a.accountId.localeCompare(b.accountId);
  });
  return rows.map((row, index) => ({ ...row, value: seasonMetricValue(metric, row), rank: index + 1, percentile: rows.length ? (rows.length - index) / rows.length : 0 }));
}

export class SeasonStore {
  constructor(filePath = DEFAULT_FILE, now = Date.now()) {
    this.filePath = filePath;
    this.seasons = new Map();
    this.load();
    this.ensureCurrent(now);
  }

  load() {
    const { value } = loadJson(this.filePath, loaded => Array.isArray(loaded));
    if (!Array.isArray(value)) return;
    value.map(normalizeSeason).filter(Boolean).forEach(season => this.seasons.set(season.id, season));
  }

  persist() {
    const rows = [...this.seasons.values()].sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))).slice(-12);
    writeJson(this.filePath, rows);
  }

  ensureCurrent(now = Date.now()) {
    const id = seasonIdFor(now);
    const existing = this.seasons.get(id);
    if (existing) {
      if (existing.status !== 'active') existing.status = 'active';
      return existing;
    }
    [...this.seasons.values()].filter(season => season.status === 'active').forEach(season => { season.status = 'complete'; });
    const season = makeSeason(now);
    this.seasons.set(season.id, season);
    this.persist();
    return season;
  }

  getCurrent(now = Date.now()) {
    return clone(this.ensureCurrent(now));
  }

  getSeason(id, now = Date.now()) {
    const season = id ? this.seasons.get(id) : this.ensureCurrent(now);
    return season ? clone(season) : null;
  }

  recordMatch(record, now = Date.now()) {
    if (!eligibleSeasonMatch(record)) return { success: false, recorded: false, error: 'Match is not eligible for seasonal standings.' };
    const season = this.ensureCurrent(now);
    if (season.matches.includes(record.matchId)) return { success: true, recorded: false, season: clone(season) };
    season.matches.push(String(record.matchId).slice(0, 120));
    season.matches = season.matches.slice(-1000);
    const completedAt = typeof record.completedAt === 'string' ? record.completedAt : new Date(now).toISOString();
    record.participants.forEach(participant => {
      const accountId = safeAccountId(participant.accountId);
      if (!accountId) return;
      season.standings[accountId] = updateStanding(season.standings[accountId], participant, completedAt, record);
    });
    this.persist();
    return { success: true, recorded: true, season: clone(season) };
  }

  standings({ seasonId, metric = 'points', accountId, now = Date.now() } = {}) {
    const source = seasonId ? this.seasons.get(seasonId) : this.ensureCurrent(now);
    if (!source) return { season: null, rows: [] };
    const rows = sortStandings(source, metric);
    return { season: clone(source), rows: accountId ? rows.filter(row => row.accountId === accountId) : rows };
  }

  claimedRewards(accountId, seasonId, now = Date.now()) {
    const id = safeAccountId(accountId);
    const source = seasonId ? this.seasons.get(seasonId) : this.ensureCurrent(now);
    if (!id || !source) return [];
    return [...(source.claims[id] || [])].slice(0, 64);
  }

  claimReward(accountId, rewardId, now = Date.now()) {
    const id = safeAccountId(accountId);
    const season = this.ensureCurrent(now);
    const reward = season.rewardTrack.find(item => item.id === rewardId);
    if (!id || !reward) return { success: false, error: 'Season reward is unavailable.' };
    const claims = season.claims[id] || [];
    if (claims.includes(reward.id)) return { success: true, created: false, reward: { ...reward }, season: clone(season) };
    const rows = sortStandings(season, reward.track === 'placement' ? 'points' : reward.track);
    const row = rows.find(entry => entry.accountId === id);
    if (!row || !this.rewardEligible(row, reward, rows.length)) return { success: false, error: 'Season reward requirements are not met.' };
    season.claims[id] = [...claims, reward.id].slice(-64);
    this.persist();
    return { success: true, created: true, reward: { ...reward }, season: clone(season), claimId: crypto.randomUUID() };
  }

  rewardEligible(row, reward, population) {
    if (reward.track === 'participation') return row.participation >= reward.threshold;
    if (reward.track === 'mastery') return row.mastery >= reward.threshold;
    return row.percentile >= reward.threshold;
  }
}

export { DEFAULT_FILE as SEASON_STORE_FILE, PARTICIPATION_CAP, REWARD_TRACK, SEASON_LENGTH_MS, WIN_RATE_MINIMUM };
