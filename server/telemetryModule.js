// Bounded, privacy-safe balancing telemetry. It records event ids and coarse
// outcomes only; chat, hidden cards, private loan terms, and secrets are
// explicitly rejected at the boundary.
import path from 'path';
import { fileURLToPath } from 'url';
import { loadJson, writeJson } from './storeIO.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'telemetry.json');
const MAX_EVENTS = 5000;
const PRIVATE_KEYS = new Set(['chat', 'message', 'text', 'hiddenCards', 'privateLoanTerms', 'opponentSecrets', 'password', 'sessionToken']);
const ALLOWED_KINDS = new Set(['match-complete', 'event-eligible', 'event-triggered', 'event-choice', 'event-recovered', 'market-volatility', 'market-liquidation', 'achievement-unlocked', 'reward-claimed', 'bot-outcome', 'bankruptcy', 'comeback']);

function safePrimitive(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value;
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
    if (PRIVATE_KEYS.has(key)) return;
    const clean = sanitize(item, depth + 1);
    if (clean !== undefined) result[String(key).slice(0, 60)] = clean;
  });
  return result;
}

export class TelemetryStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.events = [];
    this.load();
  }

  load() {
    const { value } = loadJson(this.filePath, loaded => Array.isArray(loaded));
    if (Array.isArray(value)) this.events = value.slice(-MAX_EVENTS).map(entry => sanitize(entry)).filter(Boolean);
  }

  persist() {
    writeJson(this.filePath, this.events.slice(-MAX_EVENTS));
  }

  record(kind, payload = {}, versions = {}) {
    const eventKind = String(kind || '').trim().slice(0, 40);
    if (!ALLOWED_KINDS.has(eventKind)) return { success: false, recorded: false, error: 'Telemetry kind is not allowed.' };
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
    this.events.push(entry);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    // Flush each write: low-volume balancing data should survive a process
    // restart, and the bounded array keeps the operation predictable.
    this.persist();
    return { success: true, recorded: true, event: { ...entry } };
  }

  summary({ kind, eventId } = {}) {
    const rows = this.events.filter(entry => (!kind || entry.kind === kind) && (!eventId || entry.eventId === eventId));
    return {
      total: rows.length,
      byKind: rows.reduce((counts, entry) => { counts[entry.kind] = (counts[entry.kind] || 0) + 1; return counts; }, {}),
      latestAt: rows.at(-1)?.createdAt || null
    };
  }
}

export { ALLOWED_KINDS, DEFAULT_FILE as TELEMETRY_STORE_FILE, MAX_EVENTS, PRIVATE_KEYS, sanitizeTelemetryValue as sanitize };

function sanitizeTelemetryValue(value) {
  return sanitize(value);
}
