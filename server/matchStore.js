import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeParticipant } from './participantFields.js';
import { loadJson, writeJson } from './storeIO.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'matches.json');
const MAX_MATCHES = 500;

function safeArray(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function clipString(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : null;
}

function stringOr(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function stringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

function numberValue(value) {
  return Number(value) || 0;
}

function nonNegativeNumber(value) {
  return Math.max(0, Number(value) || 0);
}

function integerOrNull(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

function plainObjectOr(value) {
  return value && typeof value === 'object' ? value : {};
}

function roomVisibility(value) {
  return value === 'private' ? 'private' : 'public';
}

function stringList(value, limit) {
  return safeArray(value, limit)
    .filter((item) => typeof item === 'string')
    .map((item) => item.slice(0, 100));
}

function sanitizeCasinoEntry(entry) {
  return {
    accountId: stringOrNull(entry?.accountId),
    bets: nonNegativeNumber(entry?.bets),
    net: numberValue(entry?.net),
  };
}

function sanitizeMarketEntry(entry) {
  return {
    accountId: stringOrNull(entry?.accountId),
    positions: plainObjectOr(entry?.positions),
  };
}

function contractStatus(value) {
  return typeof value === 'string' ? value.slice(0, 20) : 'unknown';
}

function sanitizeContractEntry(contract) {
  const source = contract || {};
  return {
    id: clipString(source.id, 100),
    kind: source.kind === 'equity' ? 'equity' : 'loan',
    fromAccountId: stringOrNull(source.fromAccountId),
    toAccountId: stringOrNull(source.toAccountId),
    fromPlayerId: stringOrNull(source.fromPlayerId),
    toPlayerId: stringOrNull(source.toPlayerId),
    amount: nonNegativeNumber(source.amount),
    status: contractStatus(source.status),
    premiumRate: nonNegativeNumber(source.premiumRate),
    equityShare: nonNegativeNumber(source.equityShare),
    collateralTileIndex: integerOrNull(source.collateralTileIndex)
  };
}

function sanitizeMatch(record = {}) {
  return {
    matchId: clipString(record.matchId, 80),
    completedAt: stringOr(record.completedAt, new Date().toISOString()),
    durationSeconds: nonNegativeNumber(record.durationSeconds),
    roundCount: nonNegativeNumber(record.roundCount),
    roomVisibility: roomVisibility(record.roomVisibility),
    participants: safeArray(record.participants, 8).map(sanitizeParticipant),
    globalEvents: stringList(record.globalEvents, 20),
    eventCombinations: stringList(record.eventCombinations, 10),
    tradesCompleted: nonNegativeNumber(record.tradesCompleted),
    auctionsCompleted: nonNegativeNumber(record.auctionsCompleted),
    casino: safeArray(record.casino, 8).map(sanitizeCasinoEntry),
    market: safeArray(record.market, 8).map(sanitizeMarketEntry),
    playerContracts: safeArray(record.playerContracts, 20).map(sanitizeContractEntry),
  };
}

export class MatchStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.matches = new Map();
    this.load();
  }

  load() {
    const { value } = loadJson(this.filePath);
    if (!value) return;
    const records = Array.isArray(value) ? value : [];
    records.forEach((record) => {
      const match = sanitizeMatch(record);
      if (match.matchId) this.matches.set(match.matchId, match);
    });
  }

  persist() {
    const records = [...this.matches.values()]
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .slice(0, MAX_MATCHES);
    writeJson(this.filePath, records);
  }

  record(record) {
    const match = sanitizeMatch(record);
    if (!match.matchId) return { created: false, match: null };
    const existing = this.matches.get(match.matchId);
    if (existing) return { created: false, match: existing };
    this.matches.set(match.matchId, match);
    this.persist();
    return { created: true, match };
  }

  get(matchId) {
    return this.matches.get(matchId) || null;
  }

  listForAccount(accountId, limit = 50) {
    if (!accountId) return [];
    return [...this.matches.values()]
      .filter((match) => match.participants.some((participant) => participant.accountId === accountId))
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
  }
}
