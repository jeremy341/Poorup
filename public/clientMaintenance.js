import { state } from './clientState.js';

const MODES = new Set(['normal', 'draining', 'maintenance']);
const MAX_MESSAGE_LENGTH = 240;
const MAX_RELEASE_LENGTH = 80;
let emitServer = () => {};
let bound = false;

function query(selector) {
  return typeof document === 'undefined' ? null : document.querySelector(selector);
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const readable = [...value].filter(character => {
    const code = character.charCodeAt(0);
    return code >= 32 || code === 9;
  }).join('');
  return readable
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function modeFor(value) {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return MODES.has(mode) ? mode : 'normal';
}

function activeRoundsFor(value) {
  const rounds = Number(value);
  if (!Number.isFinite(rounds)) return 0;
  return Math.max(0, Math.min(100_000, Math.floor(rounds)));
}

export function normalizeMaintenanceSnapshot(value = {}) {
  const mode = modeFor(value.mode);
  return {
    mode,
    message: cleanText(value.message, MAX_MESSAGE_LENGTH),
    releaseId: cleanText(value.releaseId, MAX_RELEASE_LENGTH).replace(/[^a-zA-Z0-9._-]/g, ''),
    drainDeadline: typeof value.drainDeadline === 'string' ? value.drainDeadline : null,
    activeRounds: activeRoundsFor(value.activeRounds),
  };
}

export function maintenanceActive(snapshot) {
  return modeFor(snapshot?.mode) !== 'normal';
}

export function maintenanceCopy(snapshot) {
  const current = normalizeMaintenanceSnapshot(snapshot);
  if (current.mode === 'normal') return '';
  const heading = current.message || (current.mode === 'draining' ? 'MAINTENANCE WINDOW' : 'MAINTENANCE IN PROGRESS');
  return `${heading} · NEW ROUNDS ARE PAUSED · CURRENT ROUNDS CONTINUE`;
}

function updatePanel(panel, snapshot) {
  if (!panel) return;
  const active = maintenanceActive(snapshot);
  panel.classList.toggle('is-hidden', !active);
  panel.setAttribute('aria-hidden', String(!active));
  const copy = panel.querySelector('[data-maintenance-copy]');
  const rounds = panel.querySelector('[data-maintenance-rounds]');
  if (copy) copy.textContent = maintenanceCopy(snapshot);
  if (rounds) rounds.textContent = active ? `ACTIVE ROUNDS: ${snapshot.activeRounds}` : '';
}

export function renderMaintenanceState() {
  const snapshot = normalizeMaintenanceSnapshot(state.maintenance);
  state.maintenance = snapshot;
  updatePanel(query('#maintenance-home'), snapshot);
  updatePanel(query('#maintenance-game'), snapshot);
}

export function applyMaintenanceState(value) {
  state.maintenance = normalizeMaintenanceSnapshot(value);
  renderMaintenanceState();
  return state.maintenance;
}

function retryMaintenanceState(event) {
  const trigger = event.target?.closest?.('[data-maintenance-retry]');
  if (!trigger) return;
  event.preventDefault();
  trigger.disabled = true;
  trigger.setAttribute('aria-busy', 'true');
  emitServer('get-maintenance-state', {}, response => {
    applyMaintenanceState(response?.maintenance || response);
    trigger.disabled = false;
    trigger.removeAttribute('aria-busy');
  });
}

export function configureMaintenanceUi({ emitServer: emitter = () => {} } = {}) {
  emitServer = typeof emitter === 'function' ? emitter : () => {};
  if (!bound && typeof document !== 'undefined') {
    bound = true;
    document.addEventListener('click', retryMaintenanceState);
  }
  renderMaintenanceState();
}
