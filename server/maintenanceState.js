const MAINTENANCE_MODES = Object.freeze(['normal', 'draining', 'maintenance']);
const MAX_MESSAGE_LENGTH = 240;
const MAX_RELEASE_LENGTH = 80;
const DEFAULT_MESSAGES = Object.freeze({
  normal: '',
  draining: 'MAINTENANCE WINDOW',
  maintenance: 'MAINTENANCE IN PROGRESS',
});

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeReleaseId(value) {
  const cleaned = cleanText(value, MAX_RELEASE_LENGTH);
  return cleaned.replace(/[^a-zA-Z0-9._-]/g, '');
}

function safeDeadline(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function safeActiveRounds(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(100_000, Math.floor(count)));
}

export function normalizeMaintenanceMode(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return MAINTENANCE_MODES.includes(normalized) ? normalized : 'normal';
}

// The lockout is a flag on maintenance mode, never on its own: it closes the
// public site (new arrivals, new rooms, new seats) on top of what maintenance
// already pauses. Older snapshots without the field read as lockout:false.
function safeLockout(mode, value) {
  return mode === 'maintenance' && value === true;
}

export function createMaintenanceSnapshot(input = {}) {
  const mode = normalizeMaintenanceMode(input.mode);
  const releaseId = safeReleaseId(input.releaseId);
  const message = cleanText(input.message, MAX_MESSAGE_LENGTH) || DEFAULT_MESSAGES[mode];
  return Object.freeze({
    mode,
    lockout: safeLockout(mode, input.lockout),
    message,
    releaseId,
    drainDeadline: safeDeadline(input.drainDeadline),
    activeRounds: safeActiveRounds(input.activeRounds),
  });
}

function isLockout(snapshot) {
  return normalizeMaintenanceMode(snapshot?.mode) === 'maintenance' && snapshot?.lockout === true;
}

// An operator bypass (password cookie or admin account) lifts only the
// lockout. Draining and plain maintenance pause new rounds for everyone, as
// they always have, so a deploy drain still reaches zero rounds.
export function canCreateRoom(snapshot, { bypass = false } = {}) {
  if (normalizeMaintenanceMode(snapshot?.mode) === 'normal') return true;
  return isLockout(snapshot) && bypass === true;
}

export function canStartRound(snapshot, { bypass = false } = {}) {
  return canCreateRoom(snapshot, { bypass });
}

// Taking a new seat is refused by the lockout. A running drain is not a lockout: it pauses new rooms and rounds (canCreateRoom),
// and shutdown waits for seats still in a lobby (server.js waitForDrain), so a seat taken during a drain is not dropped.
// A reconnect to a seat the client already holds is always allowed, so seated players keep playing.
export function canJoinRoom(snapshot, { bypass = false, reconnecting = false } = {}) {
  if (!isLockout(snapshot)) return true;
  return bypass === true || reconnecting === true;
}

export function maintenanceNotice(snapshot) {
  const state = createMaintenanceSnapshot(snapshot);
  if (state.mode === 'normal') return '';
  const suffix = state.lockout
    ? 'THE SITE IS CLOSED · CURRENT ROUNDS CONTINUE'
    : 'NEW ROUNDS ARE PAUSED · CURRENT ROUNDS CONTINUE';
  return `${state.message || DEFAULT_MESSAGES[state.mode]} · ${suffix}`;
}

export { cleanText, MAINTENANCE_MODES, MAX_MESSAGE_LENGTH, MAX_RELEASE_LENGTH };
