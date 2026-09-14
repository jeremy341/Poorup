// Bounded, privacy-safe balancing telemetry. It records event ids and coarse
// outcomes only; chat, hidden cards, private loan terms, and secrets are
// explicitly rejected at the boundary.
import path from 'path';
import { fileURLToPath } from 'url';
import { loadJson, writeJson } from './storeIO.js';
import { ALLOWED_ANALYTICS_DIMENSIONS, ALLOWED_ROLLUP_KINDS } from './analyticsRollupStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'telemetry.json');
const MAX_EVENTS = 5000;
const PRIVATE_KEYS = new Set(['chat', 'message', 'text', 'hiddencards', 'privateloanterms', 'opponentsecrets', 'password', 'sessiontoken', 'displayname', 'username', 'accountid', 'clientid', 'roomcode']);
const ALLOWED_KINDS = new Set([...ALLOWED_ROLLUP_KINDS]);
const COMMON_PAYLOAD_KEYS = new Set(['count', 'botOnly', 'botMode', 'feature', 'featureId', 'eligible', 'eligibleCount', 'used', 'usedCount', 'adopted', 'legalAction', 'observations', 'reconnects', 'reconnectCount', 'afk', 'afkCount', 'durationSeconds', 'duration', 'started', 'startedMatches', 'stalledMatches', 'outcome', 'outcomeBucket', 'eventId', 'actionId', 'provider', 'seasonId', 'rulesetRevision', 'balanceRevision', 'boardVariant', 'rulesetPreset', 'marketComplexity']);
const PAYLOAD_ALLOWLISTS = Object.freeze({
  'match-start': new Set([...COMMON_PAYLOAD_KEYS]),
  'match-stalled': new Set([...COMMON_PAYLOAD_KEYS, 'reasonCode']),
  'match-complete': new Set([...COMMON_PAYLOAD_KEYS, 'playerCount', 'players', 'roundCount']),
  'event-eligible': new Set([...COMMON_PAYLOAD_KEYS, 'source', 'chance', 'candidates', 'combination']),
  'event-triggered': new Set([...COMMON_PAYLOAD_KEYS, 'source', 'combination', 'durationRounds']),
  'event-choice': new Set([...COMMON_PAYLOAD_KEYS, 'turnout', 'voters', 'resolvedChoice']),
  'event-recovered': new Set([...COMMON_PAYLOAD_KEYS, 'title', 'recoveredCount', 'combination']),
  'market-volatility': new Set([...COMMON_PAYLOAD_KEYS, 'marketRows', 'marketTrades', 'complexity', 'action', 'instrumentId', 'quantity', 'value', 'return', 'volatility', 'negativeCashPreventions', 'roundNumber']),
  'market-liquidation': new Set([...COMMON_PAYLOAD_KEYS, 'actionCount', 'actions', 'marginPositions', 'marginOpenPositions', 'negativeCashPreventions']),
  'achievement-unlocked': new Set([...COMMON_PAYLOAD_KEYS, 'rarity', 'achievementId']),
  'reward-claimed': new Set([...COMMON_PAYLOAD_KEYS, 'rewardId', 'created', 'cosmeticId', 'source']),
  'bot-outcome': new Set([...COMMON_PAYLOAD_KEYS, 'fallback', 'success', 'phase', 'decisions', 'actionCount', 'placement', 'win', 'match', 'matchCount', 'completed']),
  bankruptcy: new Set([...COMMON_PAYLOAD_KEYS]),
  comeback: new Set([...COMMON_PAYLOAD_KEYS])
});

function safePrimitive(value) {
  if (value === null) return value;
  switch (typeof value) {
    case 'boolean':
    case 'number':
    case 'string':
      return value;
    default:
      break;
  }
  return undefined;
}

function sanitize(value, depth = 0) {
  if (depth > 3) return undefined;
  const primitive = safePrimitive(value);
  if (primitive !== undefined) return primitive;
  if (Array.isArray(value)) return value.slice(0, 32).map(item => sanitize(item, depth + 1)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  const result = {};
  Object.entries(value).slice(0, 40).forEach(([key, item]) => {
    if (PRIVATE_KEYS.has(key) || PRIVATE_KEYS.has(String(key).toLowerCase())) return;
    const clean = sanitize(item, depth + 1);
    if (clean !== undefined) result[String(key).slice(0, 60)] = clean;
  });
  return result;
}

function telemetryEntry(eventKind, payload, versions) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    kind: eventKind,
    createdAt: new Date().toISOString(),
    seasonId: String(versions.seasonId || 'unseasoned').slice(0, 80),
    rulesetRevision: Math.max(0, Math.floor(Number(versions.rulesetRevision) || 0)),
    balanceRevision: Math.max(0, Math.floor(Number(versions.balanceRevision) || 0)),
    boardVariant: String(versions.boardVariant || 'standard-40').slice(0, 40),
    eventId: versions.eventId ? String(versions.eventId).slice(0, 80) : null,
    data: sanitize(payload) || {}
  };
  ALLOWED_ANALYTICS_DIMENSIONS.filter(name => !['seasonId', 'rulesetRevision', 'balanceRevision', 'boardVariant', 'eventId'].includes(name)).forEach(name => {
    const value = versions[name] ?? payload?.[name];
    if (value === undefined || value === null || value === '') return;
    entry[name] = typeof value === 'number' ? Math.max(0, Math.floor(Number(value) || 0)) : String(value).trim().slice(0, 80);
  });
  return entry;
}

function sanitizePayloadForKind(eventKind, payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { valid: false, data: {} };
  const allowed = PAYLOAD_ALLOWLISTS[eventKind] || COMMON_PAYLOAD_KEYS;
  const clean = {};
  for (const [key, value] of Object.entries(payload)) {
    const lower = String(key).toLowerCase();
    if (PRIVATE_KEYS.has(lower)) continue;
    if (!allowed.has(key)) return { valid: false, data: {} };
    const safe = sanitize(value);
    if (safe !== undefined) clean[key] = safe;
  }
  return { valid: true, data: clean };
}

function sanitizeLoadedEntry(entry) {
  if (!entry || typeof entry !== 'object' || !ALLOWED_KINDS.has(entry.kind)) return null;
  const payload = sanitizePayloadForKind(entry.kind, entry.data || {});
  if (!payload.valid) return null;
  const clean = {
    kind: entry.kind,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt.slice(0, 40) : new Date(0).toISOString(),
    seasonId: String(entry.seasonId || 'unseasoned').slice(0, 80),
    rulesetRevision: Math.max(0, Math.floor(Number(entry.rulesetRevision) || 0)),
    balanceRevision: Math.max(0, Math.floor(Number(entry.balanceRevision) || 0)),
    boardVariant: String(entry.boardVariant || 'standard-40').slice(0, 40),
    eventId: entry.eventId ? String(entry.eventId).slice(0, 80) : null,
    data: payload.data
  };
  ALLOWED_ANALYTICS_DIMENSIONS.filter(name => !['seasonId', 'rulesetRevision', 'balanceRevision', 'boardVariant', 'eventId'].includes(name)).forEach(name => {
    if (entry[name] !== undefined && entry[name] !== null && entry[name] !== '') clean[name] = String(entry[name]).slice(0, 80);
  });
  return clean;
}

function trimTelemetry(events) {
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export class TelemetryStore {
  constructor(filePath = DEFAULT_FILE, { rollupStore = null, onRollup = null, persist = null, maxPending = 64, flushIntervalMs = 1000 } = {}) {
    this.filePath = filePath;
    this.rollupStore = rollupStore;
    this.onRollup = onRollup;
    this.persistWriter = typeof persist === 'function' ? persist : null;
    this.maxPending = Math.max(1, Math.min(MAX_EVENTS, Math.floor(Number(maxPending) || 64)));
    this.flushIntervalMs = Math.max(0, Math.min(60000, Math.floor(Number(flushIntervalMs) || 1000)));
    this.pendingEvents = [];
    this.flushTimer = null;
    this.events = [];
    this.load();
  }

  load() {
    const { value } = loadJson(this.filePath, loaded => Array.isArray(loaded));
    if (Array.isArray(value)) this.events = value.slice(-MAX_EVENTS).map(sanitizeLoadedEntry).filter(Boolean);
  }

  persist() {
    const snapshot = this.events.slice(-MAX_EVENTS);
    if (this.persistWriter) this.persistWriter(snapshot);
    else writeJson(this.filePath, snapshot);
    this.pendingEvents = [];
  }

  record(kind, payload = {}, versions = {}) {
    const eventKind = String(kind || '').trim().slice(0, 40);
    if (!ALLOWED_KINDS.has(eventKind)) return { success: false, recorded: false, error: 'Telemetry kind is not allowed.' };
    const payloadResult = sanitizePayloadForKind(eventKind, payload);
    if (!payloadResult.valid) return { success: false, recorded: false, error: 'Telemetry payload key is not allowed.' };
    const entry = telemetryEntry(eventKind, payloadResult.data, versions || {});
    this.events.push(entry);
    trimTelemetry(this.events);
    try {
      const rollup = this.rollupStore?.record(entry) || null;
      this.onRollup?.(entry, rollup);
    } catch {
      // Analytics persistence is a shadow path. A rollup outage must not
      // reject an otherwise valid telemetry event or affect game state.
    }
    this.pendingEvents.push(entry);
    if (this.pendingEvents.length >= this.maxPending) {
      try { this.persist(); } catch { this.scheduleFlush(); }
    }
    else this.scheduleFlush();
    return { success: true, recorded: true, event: { ...entry } };
  }

  scheduleFlush() {
    if (this.flushTimer || !this.flushIntervalMs) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; try { this.persist(); } catch { this.scheduleFlush(); } }, this.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  flush() { this.persist(); return { flushed: true, pending: this.pendingEvents.length }; }

  close() { if (this.flushTimer) clearTimeout(this.flushTimer); this.flushTimer = null; this.persist(); }

  summary({ kind, eventId } = {}) {
    const rows = this.events.filter(entry => (!kind || entry.kind === kind) && (!eventId || entry.eventId === eventId));
    return {
      total: rows.length,
      byKind: rows.reduce((counts, entry) => { counts[entry.kind] = (counts[entry.kind] || 0) + 1; return counts; }, {}),
      latestAt: rows.at(-1)?.createdAt || null
    };
  }
}

export { ALLOWED_KINDS, ALLOWED_ANALYTICS_DIMENSIONS, DEFAULT_FILE as TELEMETRY_STORE_FILE, MAX_EVENTS, PRIVATE_KEYS, PAYLOAD_ALLOWLISTS, sanitizeTelemetryValue as sanitize };

function sanitizeTelemetryValue(value) {
  return sanitize(value);
}
