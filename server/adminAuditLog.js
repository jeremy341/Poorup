// Bounded change log for operator actions (AI provider profiles, release mode).
// Entries never hold keys, endpoint URLs, maintenance messages or account ids: free text goes
// through safeTarget(), the actor is a keyed hash, and the newest AUDIT_LIMIT entries are kept on disk.
import crypto from 'node:crypto';
import { clearQuarantineMarker, loadJson, readQuarantineMarker, writeJson } from './storeIO.js';

// Provider tests and edits are allowed 12 a minute per operator, so a window of 50 could be filled in minutes
// and push every release-mode and lockout entry out of the trail; 500 keeps the security transitions visible.
export const AUDIT_LIMIT = 500;
export const AUDIT_STORE_VERSION = 1;
export const AUDIT_AREAS = Object.freeze(['provider', 'release']);
export const AUDIT_ACTIONS = Object.freeze(['create', 'update', 'activate', 'delete', 'test', 'mode', 'lockout']);
export const AUDIT_OUTCOMES = Object.freeze(['ok', 'failed']);

const MAX_TARGET_LENGTH = 60;
const FALLBACK_KEY = 'poorup-admin-audit-v1';
const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|[^@\s]+@[^@\s]+\.[^@\s]+/i;
// sk-... style keys, "Bearer <token>", or any unbroken 28+ character token.
const KEY_LIKE = /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}|\bbearer\s+\S{10,}|[A-Za-z0-9_-]{28,}/i;

/** Stable, non-reversible actor label: admin-<8 hex>. Same account, same label. */
export function pseudonymizeActor(accountId, key = '') {
  const id = typeof accountId === 'string' ? accountId.trim() : '';
  if (!id) return 'admin-00000000';
  const secret = String(key || '').trim() || FALLBACK_KEY;
  return `admin-${crypto.createHmac('sha256', secret).update(`audit:${id}`, 'utf8').digest('hex').slice(0, 8)}`;
}

/** Short display label. Anything that looks like a URL, address or credential is replaced. */
export function safeTarget(value) {
  if (typeof value !== 'string') return 'unknown';
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'unknown';
  if (URL_LIKE.test(cleaned) || KEY_LIKE.test(cleaned)) return '[redacted]';
  return cleaned.slice(0, MAX_TARGET_LENGTH);
}

function isoOrNull(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanEntry(input) {
  if (!input || typeof input !== 'object') return null;
  const at = isoOrNull(input.at);
  if (!at) return null;
  if (!AUDIT_AREAS.includes(input.area)) return null;
  if (!AUDIT_ACTIONS.includes(input.action)) return null;
  if (!AUDIT_OUTCOMES.includes(input.outcome)) return null;
  const actor = typeof input.actor === 'string' && /^admin-[0-9a-f]{8}$/.test(input.actor) ? input.actor : 'admin-00000000';
  return { at, area: input.area, action: input.action, target: safeTarget(input.target), actor, outcome: input.outcome };
}

export function createAdminAuditLog({
  filePath = '',
  key = '',
  now = () => Date.now(),
  limit = AUDIT_LIMIT,
  load = loadJson,
  write = writeJson,
} = {}) {
  const capacity = Math.max(1, Math.min(AUDIT_LIMIT, Math.floor(Number(limit) || AUDIT_LIMIT)));
  let entries = [];
  // An audit file that could not be read holds the only copy of the log. The
  // log then refuses to write at all: the next record would otherwise replace
  // the bytes that were never read.
  let readable = true;
  // A corrupt audit file is quarantined by the loader (bytes kept in a .corrupt-* copy, a marker left beside
  // the file). The log restarts empty, but never silently: health() reports it until an operator acknowledges it.
  let corruption = null;

  if (filePath) {
    try {
      const result = load(filePath, value => Boolean(value) && typeof value === 'object' && Array.isArray(value.entries));
      const loaded = result?.value;
      if (loaded) entries = loaded.entries.map(cleanEntry).filter(Boolean).slice(-capacity);
      if (result?.corrupt) console.error('Admin audit log file was corrupt: earlier entries are NOT in the active log. The corrupt bytes were preserved beside it.');
      corruption = readQuarantineMarker(filePath);
    } catch (error) {
      // An unreadable audit file must not stop the server, and it must not be
      // overwritten either: the log starts empty and stays unwritable.
      readable = false;
      console.error('Admin audit log could not be read:', error?.code || 'unknown error');
    }
  }

  /** Writes the candidate list. Returns false when the entry did not become durable. */
  function persist(candidate) {
    // Without a store the in-memory log is the store: there is no write that
    // can fail, so the entry counts as recorded.
    if (!filePath) return true;
    if (!readable) {
      console.error('Admin audit log was not saved: its file could not be read, so the existing bytes are preserved.');
      return false;
    }
    try {
      write(filePath, { version: AUDIT_STORE_VERSION, entries: candidate });
      return true;
    } catch (error) {
      console.error('Admin audit log could not be saved:', error?.code || 'unknown error');
      return false;
    }
  }

  /**
   * Records one operator action. Returns the stored entry (with a `persisted` flag), or null
   * for an unknown area, action or outcome. Memory is committed only after the write succeeds,
   * so a failed write can neither lose durable entries nor claim an action it never stored.
   */
  function record({ area, action, target, accountId, outcome }) {
    const at = isoOrNull(now());
    const entry = cleanEntry({ at, area, action, target, actor: pseudonymizeActor(accountId, key), outcome });
    if (!entry) return null;
    const candidate = [...entries, entry];
    const trimmed = candidate.length > capacity ? candidate.slice(-capacity) : candidate;
    const persisted = persist(trimmed);
    if (persisted) entries = trimmed;
    return { ...entry, persisted };
  }

  /** Newest first. */
  function list() {
    return entries.map(entry => ({ ...entry })).reverse();
  }

  /**
   * What an operator needs to know about the trail itself: 'ok', 'corrupt' (the file was unparseable, the log
   * restarted empty and the old bytes are preserved) or 'unreadable' (a read error, the file is left untouched
   * and nothing is written to it).
   */
  function health() {
    if (!readable) return { state: 'unreadable', since: null, preservedAs: null, message: 'The audit log file could not be read. It was left untouched and new entries are not being saved.' };
    if (corruption) {
      const preserved = corruption.preservedAs ? ` The old bytes are preserved as ${corruption.preservedAs}.` : '';
      return { state: 'corrupt', since: corruption.at || null, preservedAs: corruption.preservedAs || null, message: `The audit log file was corrupt and the log restarted empty; earlier entries are missing from this view.${preserved}` };
    }
    return { state: 'ok', since: null, preservedAs: null, message: null };
  }

  /** The operator has reviewed the preserved copy; stop reporting the corruption. */
  function acknowledgeCorruption() {
    if (!filePath || !corruption) return false;
    clearQuarantineMarker(filePath);
    corruption = null;
    return true;
  }

  return Object.freeze({ acknowledgeCorruption, health, list, record });
}
