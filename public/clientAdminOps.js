import { adminRequest } from './clientAdminAiProvider.js';

// Client side of the /admin/ops/* endpoints. Every payload is rebuilt field by field from an
// explicit allowlist, so nothing the server did not promise reaches the page. Room ids that are
// not one-way hashes, actors that are not pseudonyms and stray fields are dropped here.

export const OPS_ENDPOINTS = Object.freeze({
  status: '/admin/ops/status',
  rooms: '/admin/ops/rooms',
  bots: '/admin/ops/bots',
  audit: '/admin/ops/audit',
  maintenance: '/admin/ops/maintenance',
  lockout: '/admin/ops/lockout',
});

const HEALTH_STATES = ['healthy', 'degraded', 'down'];
const CHECK_STATES = ['ok', 'warn', 'bad', 'unknown'];
const CHECK_IDS = ['backup', 'errors', 'restore', 'latency', 'storage'];
const MODES = ['normal', 'draining', 'maintenance'];
const PHASES = ['lobby', 'playing', 'finished'];
const VISIBILITIES = ['public', 'private'];
const AUDIT_AREAS = ['provider', 'release'];
const AUDIT_ACTIONS = ['create', 'update', 'activate', 'delete', 'test', 'mode', 'lockout'];
const ROOM_ID = /^r-[0-9a-f]{6}$/;
const ACTOR = /^admin-[0-9a-f]{8}$/;

function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function oneOf(value, allowed, fallback) { const key = String(value ?? '').toLowerCase(); return allowed.includes(key) ? key : fallback; }
export function count(value) { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
export function plainText(value, max = 120) { return [...String(value ?? '')].filter(character => { const code = character.charCodeAt(0); return code >= 32 && code !== 127; }).join('').slice(0, max); }
function isoText(value) { const text = plainText(value, 40); return Number.isNaN(Date.parse(text)) ? '' : text; }

export function normalizeMaintenance(value) {
  const source = record(value);
  const mode = oneOf(source.mode, MODES, 'normal');
  return {
    mode,
    message: plainText(source.message, 200),
    releaseId: plainText(source.releaseId, 64),
    drainDeadline: isoText(source.drainDeadline) || null,
    activeRounds: count(source.activeRounds),
    // The public "under maintenance" panel. Only ever true together with mode maintenance.
    lockout: source.lockout === true && mode === 'maintenance',
    // Whether the server has an operator password (admin-only; false when absent).
    operatorPassword: source.operatorPassword === true,
  };
}

export function normalizeOpsStatus(payload) {
  const source = record(payload);
  const health = record(source.health);
  const backup = record(health.backup);
  const checks = (Array.isArray(health.checks) ? health.checks : []).slice(0, 12).map(entry => {
    const check = record(entry);
    return { id: oneOf(check.id, CHECK_IDS, ''), label: plainText(check.label, 40), state: oneOf(check.state, CHECK_STATES, 'unknown'), detail: plainText(check.detail, 160) };
  }).filter(check => check.id);
  return {
    generatedAt: isoText(source.generatedAt),
    health: {
      state: oneOf(health.state, HEALTH_STATES, 'unknown'),
      checks,
      uptimeSeconds: count(health.uptimeSeconds),
      sockets: count(health.sockets),
      rooms: count(health.rooms),
      activeRounds: count(health.activeRounds),
      backup: { configured: backup.configured === true, fresh: backup.fresh === true, lastRunAt: isoText(backup.lastRunAt) || null, failures: count(backup.failures) },
      errorCount: count(health.errorCount),
      restoreFailures: count(health.restoreFailures),
      roomReconnects: count(health.roomReconnects),
      botFallbacks: count(health.botFallbacks),
      latencyP95Ms: count(health.latencyP95Ms),
    },
    maintenance: normalizeMaintenance(source.maintenance),
  };
}

export function normalizeOpsRooms(payload) {
  const source = record(payload);
  const totals = record(source.totals);
  const rooms = (Array.isArray(source.rooms) ? source.rooms : []).slice(0, 200).map(entry => {
    const room = record(entry);
    return {
      id: ROOM_ID.test(String(room.id)) ? String(room.id) : '',
      phase: oneOf(room.phase, PHASES, 'lobby'),
      visibility: oneOf(room.visibility, VISIBILITIES, 'private'),
      humans: count(room.humans), bots: count(room.bots), round: count(room.round),
      ageSeconds: count(room.ageSeconds), idleSeconds: count(room.idleSeconds),
      stalled: room.stalled === true,
    };
  }).filter(room => room.id);
  return {
    generatedAt: isoText(source.generatedAt),
    totals: { rooms: count(totals.rooms), lobby: count(totals.lobby), playing: count(totals.playing), humans: count(totals.humans), bots: count(totals.bots) },
    sinceStart: { reconnects: count(record(source.sinceStart).reconnects) },
    rooms,
  };
}

function normalizeUsage(value) {
  const source = record(value);
  return { decisions: count(source.decisions), fallbacks: count(source.fallbacks), fallbackRate: count(source.fallbackRate), sampleSize: count(source.sampleSize) };
}

export function normalizeOpsBots(payload) {
  const source = record(payload);
  const totals = record(source.totals);
  const provider = record(source.provider);
  return {
    range: oneOf(source.range, ['hour', 'day', 'week', 'month'], 'hour'),
    generatedAt: isoText(source.generatedAt),
    totals: { botMatches: count(totals.botMatches), ...normalizeUsage(totals) },
    sinceStart: { fallbacks: count(record(source.sinceStart).fallbacks) },
    providers: (Array.isArray(source.providers) ? source.providers : []).slice(0, 24).map(entry => {
      const row = record(entry);
      return { provider: plainText(row.provider, 40) || 'unknown', botMode: plainText(row.botMode, 24) || 'unknown', matches: count(row.matches), ...normalizeUsage(row) };
    }),
    provider: { state: plainText(provider.state, 40).toLowerCase(), activeLabel: provider.activeLabel === null || provider.activeLabel === undefined ? null : plainText(provider.activeLabel, 80), capPerBot: count(provider.capPerBot) },
  };
}

export function normalizeOpsAudit(payload) {
  const source = record(payload);
  return {
    entries: (Array.isArray(source.entries) ? source.entries : []).slice(0, 50).map(entry => {
      const row = record(entry);
      return {
        at: isoText(row.at),
        area: oneOf(row.area, AUDIT_AREAS, ''),
        action: oneOf(row.action, AUDIT_ACTIONS, ''),
        target: plainText(row.target, 80),
        actor: ACTOR.test(String(row.actor)) ? String(row.actor) : 'admin',
        outcome: row.outcome === 'failed' ? 'failed' : 'ok',
      };
    }).filter(row => row.area && row.action),
    health: normalizeAuditHealth(source.health),
  };
}

const AUDIT_HEALTH_STATES = ['ok', 'corrupt', 'unreadable'];

// The server reports when the audit file was corrupt (log restarted empty) or unreadable.
function normalizeAuditHealth(value) {
  const row = record(value);
  return { state: oneOf(row.state, AUDIT_HEALTH_STATES, 'ok'), message: plainText(row.message, 240) };
}

const NORMALIZERS = Object.freeze({ status: normalizeOpsStatus, rooms: normalizeOpsRooms, bots: normalizeOpsBots, audit: normalizeOpsAudit });

// Read one ops resource. `model` is null unless the request succeeded.
export async function fetchOps(kind, { range = 'day', signal, fetcher } = {}) {
  if (!Object.hasOwn(NORMALIZERS, kind)) return { ok: false, status: 400, model: null };
  const query = kind === 'bots' ? `?range=${encodeURIComponent(range)}` : '';
  try {
    const { ok, status, payload } = await adminRequest(`${OPS_ENDPOINTS[kind]}${query}`, { signal, fetcher });
    return { ok, status, model: ok ? NORMALIZERS[kind](payload) : null };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, status: 499, model: null, aborted: true };
    return { ok: false, status: 503, model: null };
  }
}

// What the server accepts (see parseReleaseId / parseDeadline in adminOpsRoutes.js): the same
// rules here only save the operator a round trip; the server stays the authority.
export const RELEASE_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
export const MAX_DEADLINE_MINUTES = 14 * 24 * 60;
const RELEASE_ID_ERROR = 'The release ID may use letters, digits, dots, dashes and underscores, up to 80 characters.';
const MINUTE_MS = 60_000;

function refuse(field, error) { return { ok: false, field, error }; }

function minutesDeadline(text, nowMs) {
  if (!/^[0-9]+$/.test(text)) return refuse('deadlineMinutes', 'Drain minutes must be a whole number, 1 or more.');
  const minutes = Number(text);
  if (minutes < 1 || minutes > MAX_DEADLINE_MINUTES) return refuse('deadlineMinutes', 'Drain minutes must be between 1 and 20160 (14 days).');
  return { ok: true, deadline: new Date(nowMs + minutes * MINUTE_MS).toISOString() };
}

function dateDeadline(text, nowMs) {
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return refuse('deadlineAt', 'The drain deadline is not a valid date and time.');
  if (at <= nowMs) return refuse('deadlineAt', 'The drain deadline must be in the future.');
  if (at - nowMs > MAX_DEADLINE_MINUTES * MINUTE_MS) return refuse('deadlineAt', 'The drain deadline must be within the next 14 days.');
  return { ok: true, deadline: new Date(at).toISOString() };
}

// The form's fields become a request body, or one reason and the field to blame.
// A datetime-local value has no zone, so Date.parse reads it as the operator's local time.
// An id or deadline the chosen mode does not use never blocks the change.
export function buildMaintenanceRequest({ mode, message = '', releaseId = '', deadlineAt = '', deadlineMinutes = '' } = {}, nowMs = Date.now()) {
  const chosen = oneOf(mode, MODES, '');
  if (!chosen) return refuse('mode', 'Choose normal, draining, or maintenance.');
  const body = { mode: chosen };
  const note = plainText(message, 200).trim();
  if (note && chosen !== 'normal') body.message = note;
  const id = String(releaseId ?? '').trim();
  if (id && chosen !== 'normal') {
    if (!RELEASE_ID_PATTERN.test(id)) return refuse('releaseId', RELEASE_ID_ERROR);
    body.releaseId = id;
  }
  const minutes = String(deadlineMinutes ?? '').trim();
  const at = String(deadlineAt ?? '').trim();
  if (chosen === 'draining' && (minutes || at)) {
    if (minutes && at) return refuse('deadlineMinutes', 'Set the drain deadline as minutes from now or as a date and time, not both.');
    const parsed = minutes ? minutesDeadline(minutes, nowMs) : dateDeadline(at, nowMs);
    if (!parsed.ok) return parsed;
    body.deadline = parsed.deadline;
  }
  return { ok: true, body };
}

// Change the release mode. The caller re-reads status afterwards; nothing here is optimistic.
export async function postMaintenance({ mode, message = '', releaseId = '', deadline = '' }, { fetcher } = {}) {
  const body = { mode: oneOf(mode, MODES, '') };
  if (!body.mode) return { ok: false, status: 400, error: 'Choose normal, draining, or maintenance.' };
  const note = plainText(message, 200).trim();
  if (note) body.message = note;
  const id = String(releaseId ?? '').trim();
  if (id) {
    if (!RELEASE_ID_PATTERN.test(id)) return { ok: false, status: 400, error: RELEASE_ID_ERROR };
    body.releaseId = id;
  }
  const until = isoText(deadline);
  if (until) body.deadline = until;
  try {
    const { ok, status, payload } = await adminRequest(OPS_ENDPOINTS.maintenance, { method: 'POST', body, fetcher });
    return { ok, status, error: ok ? '' : plainText(payload.error, 160) || 'The change was not applied.', maintenance: ok ? normalizeMaintenance(payload.maintenance) : null, audited: payload.audited !== false };
  } catch {
    return { ok: false, status: 503, error: 'The server could not be reached. Nothing was changed.' };
  }
}

// The public "under maintenance" panel. `enabled: true` closes the site (message and release id are
// optional); `enabled: false` lifts the panel. `reopen` goes with enabled:false only and also returns
// the table to normal. The same refusal rules as the server, so a bad id never costs a round trip.
export function buildLockoutRequest({ enabled, reopen = false, message = '', releaseId = '' } = {}) {
  if (typeof enabled !== 'boolean') return refuse('enabled', 'Choose whether the maintenance panel is on or off.');
  if (!enabled) return { ok: true, body: reopen === true ? { enabled: false, reopen: true } : { enabled: false } };
  const body = { enabled: true };
  const note = plainText(message, 200).trim();
  if (note) body.message = note;
  const id = String(releaseId ?? '').trim();
  if (id) {
    if (!RELEASE_ID_PATTERN.test(id)) return refuse('releaseId', RELEASE_ID_ERROR);
    body.releaseId = id;
  }
  return { ok: true, body };
}

export async function postLockout(request, { fetcher } = {}) {
  const built = buildLockoutRequest(request);
  if (!built.ok) return { ok: false, status: 400, error: built.error, field: built.field, maintenance: null };
  try {
    const { ok, status, payload } = await adminRequest(OPS_ENDPOINTS.lockout, { method: 'POST', body: built.body, fetcher });
    return { ok, status, error: ok ? '' : plainText(payload.error, 160) || 'The change was not applied.', maintenance: ok ? normalizeMaintenance(payload.maintenance) : null, audited: payload.audited !== false };
  } catch {
    return { ok: false, status: 503, error: 'The server could not be reached. Nothing was changed.', maintenance: null };
  }
}
