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

export function createMaintenanceSnapshot(input = {}) {
  const mode = normalizeMaintenanceMode(input.mode);
  const releaseId = safeReleaseId(input.releaseId);
  const message = cleanText(input.message, MAX_MESSAGE_LENGTH) || DEFAULT_MESSAGES[mode];
  return Object.freeze({
    mode,
    message,
    releaseId,
    drainDeadline: safeDeadline(input.drainDeadline),
    activeRounds: safeActiveRounds(input.activeRounds),
  });
}

export function canCreateRoom(snapshot) {
  return normalizeMaintenanceMode(snapshot?.mode) === 'normal';
}

export function canStartRound(snapshot) {
  return normalizeMaintenanceMode(snapshot?.mode) === 'normal';
}

export function maintenanceNotice(snapshot) {
  const state = createMaintenanceSnapshot(snapshot);
  if (state.mode === 'normal') return '';
  const suffix = 'NEW ROUNDS ARE PAUSED · CURRENT ROUNDS CONTINUE';
  return `${state.message || DEFAULT_MESSAGES[state.mode]} · ${suffix}`;
}

export { MAINTENANCE_MODES, MAX_MESSAGE_LENGTH, MAX_RELEASE_LENGTH };
