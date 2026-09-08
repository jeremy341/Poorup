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
  const positions = plainObjectOr(entry?.positions);
  return {
    accountId: stringOrNull(entry?.accountId),
    positions: Object.fromEntries(Object.entries(positions).slice(0, 32).map(([instrumentId, position]) => {
      const source = position && typeof position === 'object' ? position : {};
      const clean = {};
      if (Object.prototype.hasOwnProperty.call(source, 'quantity')) clean.quantity = Math.max(0, Math.min(1_000_000, Math.floor(numberValue(source.quantity))));
      if (Object.prototype.hasOwnProperty.call(source, 'averageCost')) clean.averageCost = nonNegativeNumber(source.averageCost);
      if (Object.prototype.hasOwnProperty.call(source, 'realizedPnl')) clean.realizedPnl = numberValue(source.realizedPnl);
      return [String(instrumentId).slice(0, 40), clean];
    })),
  };
}

function sanitizeBotDecision(entry) {
  const source = entry || {};
  return {
    botId: clipString(source.botId, 80),
    gameId: clipString(source.gameId, 120),
    ruleVersion: clipString(source.ruleVersion, 32),
    sequence: nonNegativeNumber(source.sequence),
    phase: clipString(source.phase, 24),
    provider: clipString(source.provider, 24),
    fallback: source.fallback === true,
    success: source.success !== false,
    fallbackReason: clipString(source.fallbackReason, 40),
    brain: clipString(source.brain, 12),
    difficulty: clipString(source.difficulty, 12),
    planningHorizon: Math.max(0, Math.min(3, Math.floor(numberValue(source.planningHorizon)))),
    strategicScore: Number.isFinite(Number(source.strategicScore)) ? Number(source.strategicScore) : null,
    actionId: clipString(source.actionId, 100),
    confidence: Math.max(0, Math.min(1, Number(source.confidence) || 0)),
    reasonCode: clipString(source.reasonCode, 40),
    latencyMs: nonNegativeNumber(source.latencyMs),
    candidateIds: stringList(source.candidateIds, 24),
    shadowActionId: clipString(source.shadowActionId, 100),
    shadowConfidence: source.shadowConfidence == null ? null : Math.max(0, Math.min(1, Number(source.shadowConfidence) || 0)),
    shadowProvider: clipString(source.shadowProvider, 24),
    shadowAgreement: source.shadowAgreement === true,
    shadowModel: clipString(source.shadowModel, 48),
    recordedAt: stringOrNull(source.recordedAt)
  };
}

function contractStatus(value) {
  return typeof value === 'string' ? value.slice(0, 20) : 'unknown';
}

function sanitizeContractKind(value) {
  if (value === 'hybrid') return 'hybrid';
  if (value === 'equity') return 'equity';
  return 'loan';
}

function sanitizeEquityControl(value) {
  if (value === 'shared') return 'shared';
  if (value === 'controlling') return 'controlling';
  if (value === 'passive') return 'passive';
  return null;
}

function sanitizeContractEntry(contract) {
  const source = contract || {};
  return {
    id: clipString(source.id, 100),
    kind: sanitizeContractKind(source.kind),
    fromAccountId: stringOrNull(source.fromAccountId),
    toAccountId: stringOrNull(source.toAccountId),
    fromPlayerId: stringOrNull(source.fromPlayerId),
    toPlayerId: stringOrNull(source.toPlayerId),
    amount: nonNegativeNumber(source.amount),
    status: contractStatus(source.status),
    premiumRate: nonNegativeNumber(source.premiumRate),
    equityShare: nonNegativeNumber(source.equityShare),
    collateralTileIndex: integerOrNull(source.collateralTileIndex),
    propertyIndex: integerOrNull(source.propertyIndex),
    conversionShare: nonNegativeNumber(source.conversionShare),
    equityControl: sanitizeEquityControl(source.equityControl)
  };
}

function sanitizeMatch(record = {}) {
  const match = {
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
  if (Object.prototype.hasOwnProperty.call(record, 'playerCount')) {
    match.playerCount = nonNegativeNumber(record.playerCount);
  }
  if (Object.prototype.hasOwnProperty.call(record, 'botDecisions')) {
    match.botDecisions = safeArray(record.botDecisions, 200).map(sanitizeBotDecision);
  }
  return match;
}

export class MatchStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.matches = new Map();
    this.load();
  }

  load() {
    const { value } = loadJson(this.filePath, loaded => Array.isArray(loaded));
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
    // Keep the in-memory index bounded as well as the serialized file. A
    // long-lived public server otherwise grows forever even though only the
    // newest 500 matches are retained on disk.
    this.matches = new Map(records.map(record => [record.matchId, record]));
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

export { sanitizeMatch };
