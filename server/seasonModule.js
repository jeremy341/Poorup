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

function normalizeSeason(source) {
  if (!source || typeof source !== 'object') return null;
  const season = {
    id: safeSeasonId(source.id),
    startsAt: typeof source.startsAt === 'string' ? source.startsAt : new Date(0).toISOString(),
    endsAt: typeof source.endsAt === 'string' ? source.endsAt : new Date(0).toISOString(),
    status: ['active', 'complete', 'upcoming'].includes(source.status) ? source.status : 'complete',
    revision: Math.max(1, Math.floor(Number(source.revision) || 1)),
    rewardTrack: Array.isArray(source.rewardTrack) ? source.rewardTrack.slice(0, 32).map(item => ({ ...item })) : REWARD_TRACK.map(reward => ({ ...reward })),
    matches: Array.isArray(source.matches) ? source.matches.filter(id => typeof id === 'string').slice(-1000) : [],
    standings: {},
    claims: {}
  };
  Object.entries(source.standings || {}).slice(0, 5000).forEach(([accountId, row]) => {
    const id = safeAccountId(accountId);
    if (!id || !row || typeof row !== 'object') return;
    season.standings[id] = normalizeStanding(row);
  });
  Object.entries(source.claims || {}).slice(0, 5000).forEach(([accountId, rewards]) => {
    const id = safeAccountId(accountId);
    if (!id) return;
    season.claims[id] = Array.isArray(rewards) ? rewards.filter(item => typeof item === 'string').slice(0, 64) : [];
  });
  return season.id ? season : null;
}

function normalizeStanding(row = {}) {
  return {
    games: Math.max(0, Math.floor(Number(row.games) || 0)),
    wins: Math.max(0, Math.floor(Number(row.wins) || 0)),
    points: Math.max(0, Math.floor(Number(row.points) || 0)),
    participation: Math.max(0, Math.floor(Number(row.participation) || 0)),
    mastery: Math.max(0, Math.floor(Number(row.mastery) || 0)),
    fairTrades: Math.max(0, Math.floor(Number(row.fairTrades) || 0)),
    eventSurvival: Math.max(0, Math.floor(Number(row.eventSurvival) || 0)),
    debtDiscipline: Math.max(0, Math.floor(Number(row.debtDiscipline) || 0)),
    lastMatchAt: typeof row.lastMatchAt === 'string' ? row.lastMatchAt : null
  };
}

export function eligibleSeasonMatch(record) {
  if (!record || typeof record !== 'object') return false;
  if (!record.matchId || !Array.isArray(record.participants) || record.participants.length < 2) return false;
  if (record.abandoned === true || record.preview === true || record.duplicate === true || record.afkOnly === true || record.botOnly === true) return false;
  return record.participants.some(participant => safeAccountId(participant.accountId));
}

function participantPoints(participant) {
  const placement = Number(participant.finalPlacement);
  const placementPoints = placement === 1 ? 100 : placement > 0 ? Math.max(10, 80 - placement * 10) : 10;
  const eventPoints = Math.min(40, Math.max(0, Number(participant.globalEventsSurvived) || 0) * 8);
  const tradePoints = Math.min(30, Math.max(0, Number(participant.fairTrades ?? participant.tradesCompleted) || 0) * 3);
  const debtPoints = participant.bankLoanStatus === 'paid' ? 10 : participant.bankLoanStatus === 'defaulted' ? 0 : 5;
  return placementPoints + eventPoints + tradePoints + debtPoints;
}

function updateStanding(row, participant, completedAt) {
  const next = normalizeStanding(row);
  const placement = Number(participant.finalPlacement);
  next.games += 1;
  next.wins += placement === 1 ? 1 : 0;
  next.points += participantPoints(participant);
  next.participation = Math.min(PARTICIPATION_CAP, next.participation + 1);
  next.fairTrades += Math.max(0, Math.floor(Number(participant.fairTrades ?? participant.tradesCompleted) || 0));
  next.eventSurvival += Math.max(0, Math.floor(Number(participant.globalEventsSurvived) || 0));
  next.debtDiscipline += participant.bankLoanStatus === 'paid' ? 1 : 0;
  next.mastery += Math.min(100, next.eventSurvival * 4 + next.fairTrades * 3 + next.debtDiscipline * 6);
  next.lastMatchAt = completedAt;
  return next;
}

function sortStandings(season, metric = 'points') {
  const rows = Object.entries(season.standings).map(([accountId, row]) => ({ accountId, ...normalizeStanding(row) }));
  const key = metric === 'wins' ? 'wins' : metric === 'rate' ? 'rate' : metric === 'mastery' ? 'mastery' : 'points';
  rows.forEach(row => { row.rate = row.games >= WIN_RATE_MINIMUM ? row.wins / row.games : null; });
  rows.sort((a, b) => {
    const av = a[key] == null ? -1 : a[key];
    const bv = b[key] == null ? -1 : b[key];
    return bv - av || b.points - a.points || a.accountId.localeCompare(b.accountId);
  });
  return rows.map((row, index) => ({ ...row, rank: index + 1, percentile: rows.length ? (rows.length - index) / rows.length : 0 }));
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
      season.standings[accountId] = updateStanding(season.standings[accountId], participant, completedAt);
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
    const reward = REWARD_TRACK.find(item => item.id === rewardId);
    const season = this.ensureCurrent(now);
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
