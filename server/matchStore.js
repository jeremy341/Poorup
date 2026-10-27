import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeParticipant } from './participantFields.js';
import { loadJson, writeJson } from './storeIO.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'matches.json');
const MAX_MATCHES = 500;
// Telemetry reads the in-memory record at settlement; only a short tail of the
// bot-decision trace needs to survive on disk (it was ~93% of a bot match record).
export const MAX_PERSISTED_BOT_DECISIONS = 40;

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
  const clean = {
    accountId: stringOrNull(entry?.accountId),
    bets: nonNegativeNumber(entry?.bets),
  };
  if (Object.prototype.hasOwnProperty.call(entry || {}, 'net')) clean.net = numberValue(entry.net);
  return clean;
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

// Worth values are non-negative whole numbers or null for a seat that had left; rows stay in round order.
function sanitizeNetWorthTimeline(rows) {
  return safeArray(rows, 40).map(row => ({
    round: Math.floor(nonNegativeNumber(row?.round)),
    worth: safeArray(row?.worth, 8).map(value => (value === null || value === undefined ? null : Math.floor(nonNegativeNumber(value)))),
  }));
}

function sanitizeMatch(record = {}) {
  const match = {
    matchId: clipString(record.matchId, 80),
    roomVisibility: roomVisibility(record.roomVisibility),
  };
  if (Object.prototype.hasOwnProperty.call(record, 'completedAt')) match.completedAt = stringOr(record.completedAt, new Date().toISOString());
  if (Object.prototype.hasOwnProperty.call(record, 'durationSeconds')) match.durationSeconds = nonNegativeNumber(record.durationSeconds);
  if (Object.prototype.hasOwnProperty.call(record, 'roundCount')) match.roundCount = nonNegativeNumber(record.roundCount);
  if (Object.prototype.hasOwnProperty.call(record, 'participants')) {
    match.participants = safeArray(record.participants, 8).map((participant) => {
      const clean = sanitizeParticipant(participant);
      for (const key of ['endingCash', 'propertyCount']) {
        if (!Object.prototype.hasOwnProperty.call(participant || {}, key)) delete clean[key];
      }
      return clean;
    });
  }
  if (Object.prototype.hasOwnProperty.call(record, 'globalEvents')) match.globalEvents = stringList(record.globalEvents, 20);
  if (Object.prototype.hasOwnProperty.call(record, 'eventCombinations')) match.eventCombinations = stringList(record.eventCombinations, 10);
  if (Object.prototype.hasOwnProperty.call(record, 'tradesCompleted')) match.tradesCompleted = nonNegativeNumber(record.tradesCompleted);
  if (Object.prototype.hasOwnProperty.call(record, 'auctionsCompleted')) match.auctionsCompleted = nonNegativeNumber(record.auctionsCompleted);
  if (Object.prototype.hasOwnProperty.call(record, 'casino')) match.casino = safeArray(record.casino, 8).map(sanitizeCasinoEntry);
  if (Object.prototype.hasOwnProperty.call(record, 'market')) match.market = safeArray(record.market, 8).map(sanitizeMarketEntry);
  if (Object.prototype.hasOwnProperty.call(record, 'playerContracts')) match.playerContracts = safeArray(record.playerContracts, 20).map(sanitizeContractEntry);
  if (Object.prototype.hasOwnProperty.call(record, 'playerCount')) {
    match.playerCount = nonNegativeNumber(record.playerCount);
  }
  if (Object.prototype.hasOwnProperty.call(record, 'netWorthTimeline')) match.netWorthTimeline = sanitizeNetWorthTimeline(record.netWorthTimeline);
  if (Object.prototype.hasOwnProperty.call(record, 'botOnly')) match.botOnly = record.botOnly === true;
  if (Object.prototype.hasOwnProperty.call(record, 'afkOnly')) match.afkOnly = record.afkOnly === true;
  // Versioned ruleset metadata lets history and rewards distinguish a
  // Standard match from a Metro match without leaking private terms. Older
  // records simply omit these optional fields.
  if (Object.prototype.hasOwnProperty.call(record, 'seasonId')) match.seasonId = stringOr(record.seasonId, '');
  if (Object.prototype.hasOwnProperty.call(record, 'boardVariant')) match.boardVariant = stringOr(record.boardVariant, 'standard-40');
  if (Object.prototype.hasOwnProperty.call(record, 'rulesetRevision')) match.rulesetRevision = nonNegativeNumber(record.rulesetRevision);
  if (Object.prototype.hasOwnProperty.call(record, 'balanceRevision')) match.balanceRevision = nonNegativeNumber(record.balanceRevision);
  if (Object.prototype.hasOwnProperty.call(record, 'rulesetDigest')) match.rulesetDigest = clipString(record.rulesetDigest, 200);
  if (Object.prototype.hasOwnProperty.call(record, 'rulesetOverrides')) match.rulesetOverrides = safeArray(record.rulesetOverrides, 32).map(entry => ({ key: clipString(entry?.key, 60), value: primitiveValue(entry?.value) }));
  if (Object.prototype.hasOwnProperty.call(record, 'botDecisions')) {
    match.botDecisions = (Array.isArray(record.botDecisions) ? record.botDecisions.slice(-MAX_PERSISTED_BOT_DECISIONS) : []).map(sanitizeBotDecision);
  }
  return match;
}

function primitiveValue(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value;
  return String(value);
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
      .sort((a, b) => String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? '')))
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
    const before = new Map(this.matches);
    this.matches.set(match.matchId, match);
    this.persistOrRollback(before);
    // The newest 500 are kept, so a match older than all of them is dropped by persist.
    const kept = this.matches.get(match.matchId) || null;
    return { created: Boolean(kept), match: kept };
  }

  // A persist that throws must not leave the change in memory: a retry would
  // see nothing to do and the disk would never catch up.
  persistOrRollback(before) {
    try {
      this.persist();
    } catch (error) {
      this.matches = before;
      throw error;
    }
  }

  get(matchId) {
    return this.matches.get(matchId) || null;
  }

  // A restorable copy of the store, so a purge that fails in a later store can
  // put the erased matches back (F4). The records themselves are replaced, not
  // mutated, by the erasure, so a shallow copy is enough. Matches recorded
  // while the purge runs are kept, so the rollback never drops a result.
  snapshot() {
    return new Map(this.matches);
  }

  restoreSnapshot(snapshot) {
    if (!snapshot) return false;
    const before = new Map(this.matches);
    const restored = new Map(this.matches);
    snapshot.forEach((record, matchId) => restored.set(matchId, record));
    this.matches = restored;
    try {
      this.persist();
    } catch (error) {
      this.matches = before;
      throw error;
    }
    return true;
  }

  listForAccount(accountId, limit = 50) {
    if (!accountId) return [];
    return [...this.matches.values()]
      .filter((match) => Array.isArray(match.participants) && match.participants.some((participant) => participant.accountId === accountId))
      .sort((a, b) => String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? '')))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
  }

  anonymizeAccount(accountId) {
    if (typeof accountId !== 'string' || !accountId) return 0;
    let changed = 0;
    const before = new Map(this.matches);
    this.matches.forEach((match) => {
      if (!Array.isArray(match.participants)) return;
      let touched = false;
      const participants = match.participants.map((participant) => {
        if (participant.accountId !== accountId) return participant;
        touched = true;
        return { ...participant, accountId: null, displayNameAtMatch: 'ACCOUNT DEACTIVATED' };
      });
      if (!touched) return;
      // The economy graph re-identifies just as fast: scrub every
      // accountId outside participants in the same pass.
      const scrubbed = { ...match, participants };
      for (const entry of ['casino', 'market']) {
        if (Array.isArray(scrubbed[entry])) {
          scrubbed[entry] = scrubbed[entry].map(row => (row?.accountId === accountId ? { ...row, accountId: null } : row));
        }
      }
      if (Array.isArray(scrubbed.playerContracts)) {
        scrubbed.playerContracts = scrubbed.playerContracts.map(contract => {
          const next = { ...contract };
          if (next.fromAccountId === accountId) next.fromAccountId = null;
          if (next.toAccountId === accountId) next.toAccountId = null;
          return next;
        });
      }
      this.matches.set(match.matchId, scrubbed);
      changed += 1;
    });
    if (changed) this.persistOrRollback(before);
    return changed;
  }

  purgeAccount(accountId) {
    return this.anonymizeAccount(accountId);
  }
}

export { sanitizeMatch };
