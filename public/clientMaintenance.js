import { state } from './clientState.js';

const MODES = new Set(['normal', 'draining', 'maintenance']);
const MAX_MESSAGE_LENGTH = 240;
const MAX_RELEASE_LENGTH = 80;
const UNLOCK_URL = '/maintenance/unlock';
const LOGOUT_URL = '/maintenance/logout';
const DEFAULT_RETRY_SECONDS = 60;
const MAX_TIMER_MS = 2_147_000_000;
const UNLOCK_SETTLE_MS = 8000;

let emitServer = () => {};
let reconnectSocket = () => {};
let fetcher = null;
let bound = false;

// Everything the operator form needs to remember. The password itself is never kept here:
// it is read from the field, the field is emptied, and the value only lives in the request.
const operator = {
  availability: 'unknown', // unknown | available | unavailable
  checking: false,
  busy: false,
  signingOut: false,
  blockedUntil: 0,
  unblockTimer: null,
  settleTimer: null,
  reconnectTried: false,
  revealed: false,
  status: { text: '', tone: '' },
  focusHomeWhenOpen: false,
  panelWasVisible: false,
};

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
    // The lockout only ever exists together with maintenance mode, whatever the wire says.
    lockout: value.lockout === true && mode === 'maintenance',
    message: cleanText(value.message, MAX_MESSAGE_LENGTH),
    releaseId: cleanText(value.releaseId, MAX_RELEASE_LENGTH).replace(/[^a-zA-Z0-9._-]/g, ''),
    drainDeadline: typeof value.drainDeadline === 'string' ? value.drainDeadline : null,
    activeRounds: activeRoundsFor(value.activeRounds),
    // Per socket: true means this client passes the lockout (operator cookie or admin account).
    bypass: value.bypass === true,
  };
}

export function maintenanceActive(snapshot) {
  return modeFor(snapshot?.mode) !== 'normal';
}

// The visitor is locked out: the site is closed and this socket has no bypass.
export function lockoutBlocking(snapshot) {
  const current = normalizeMaintenanceSnapshot(snapshot);
  return current.lockout && !current.bypass;
}

// The operator passes the lockout: the normal site shows, with an "Operator mode" chip.
export function operatorModeActive(snapshot) {
  const current = normalizeMaintenanceSnapshot(snapshot);
  return current.lockout && current.bypass;
}

// The full-page panel covers the home view for every maintenance mode except an operator inside a
// lockout. Draining and plain maintenance offer no sign-in.
export function homePanelVisible(snapshot) {
  const current = normalizeMaintenanceSnapshot(snapshot);
  return maintenanceActive(current) && !(current.lockout && current.bypass);
}

export function maintenanceCopy(snapshot) {
  const current = normalizeMaintenanceSnapshot(snapshot);
  if (current.mode === 'normal') return '';
  const heading = current.message || (current.mode === 'draining' ? 'MAINTENANCE WINDOW' : 'MAINTENANCE IN PROGRESS');
  return `${heading} · NEW ROUNDS ARE PAUSED · CURRENT ROUNDS CONTINUE`;
}

// What the lockout panel says. The operator's own message leads; the rest is fixed copy.
export function lockoutMessage(snapshot) {
  const current = normalizeMaintenanceSnapshot(snapshot);
  return current.message || 'MAINTENANCE IN PROGRESS';
}

export function lockoutNote(snapshot, availability = 'unknown') {
  const base = 'The parlor is closed for now: no new rooms or rounds. Rounds already in progress carry on.';
  return availability === 'unavailable' ? `${base} Operator sign-in is not available on this server.` : base;
}

// "Retry-After" is whole seconds. Anything else falls back to a safe minute.
export function parseRetryAfter(value) {
  const seconds = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(seconds) || seconds < 1) return DEFAULT_RETRY_SECONDS;
  return Math.min(seconds, 24 * 60 * 60);
}

export function retryAfterText(seconds) {
  const wait = parseRetryAfter(seconds);
  if (wait < 60) return `${wait} ${wait === 1 ? 'second' : 'seconds'}`;
  const minutes = Math.ceil(wait / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

// ---- HTTP: operator sign-in --------------------------------------------------------
// Same origin, JSON only, cookie is HttpOnly and set by the server: nothing here ever sees a token.

function send(url, init, override) {
  const run = override || fetcher || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  if (!run) return Promise.reject(new Error('fetch unavailable'));
  return run(url, { credentials: 'same-origin', cache: 'no-store', ...init });
}

async function readJson(response) {
  try { return (await response.json()) || {}; } catch { return {}; }
}

export async function fetchOperatorAvailability({ fetcher: override } = {}) {
  try {
    const response = await send(UNLOCK_URL, { method: 'GET', headers: { accept: 'application/json' } }, override);
    if (response.status === 404) return { availability: 'unavailable', bypass: false };
    const payload = await readJson(response);
    if (response.ok && payload.success === true && payload.available === true) return { availability: 'available', bypass: payload.bypass === true };
    return { availability: 'unknown', bypass: false };
  } catch {
    return { availability: 'unknown', bypass: false };
  }
}

// Result: { kind: 'ok' | 'wrong' | 'limited' | 'unavailable' | 'error' | 'network', retryAfterSeconds? }
export async function postOperatorSignIn(password, { fetcher: override } = {}) {
  try {
    const response = await send(UNLOCK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ password: typeof password === 'string' ? password : '' }),
    }, override);
    if (response.status === 429) return { kind: 'limited', retryAfterSeconds: parseRetryAfter(response.headers?.get?.('retry-after')) };
    if (response.status === 401) return { kind: 'wrong' };
    if (response.status === 404) return { kind: 'unavailable' };
    const payload = await readJson(response);
    if (response.ok && payload.success === true) return { kind: 'ok' };
    return { kind: 'error' };
  } catch {
    return { kind: 'network' };
  }
}

export async function postOperatorSignOut({ fetcher: override } = {}) {
  try {
    const response = await send(LOGOUT_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{}' }, override);
    return { ok: response.ok === true };
  } catch {
    return { ok: false };
  }
}

// ---- Rendering -------------------------------------------------------------------------

function setText(node, text) {
  if (node) node.textContent = text;
}

function setHidden(node, hidden) {
  if (!node) return;
  node.classList.toggle('is-hidden', hidden);
  node.setAttribute('aria-hidden', String(hidden));
}

function updateGameBanner(panel, snapshot) {
  if (!panel) return;
  const active = maintenanceActive(snapshot);
  setHidden(panel, !active);
  setText(panel.querySelector('[data-maintenance-copy]'), maintenanceCopy(snapshot));
  setText(panel.querySelector('[data-maintenance-rounds]'), active ? `ACTIVE ROUNDS: ${snapshot.activeRounds}` : '');
}

// While the full-page panel is up, the site behind it must not be reachable by keyboard.
function setBackgroundInert(inert) {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  document.querySelectorAll('#view-home > :not(#maintenance-home)').forEach(node => {
    if (inert) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
  });
}

function setOperatorStatus(text, tone = '') {
  operator.status = { text, tone };
  const node = query('[data-operator-status]');
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('is-error', tone === 'error');
  node.classList.toggle('is-ok', tone === 'ok');
  node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
}

function isBlocked() {
  return Date.now() < operator.blockedUntil;
}

function renderOperatorForm(snapshot) {
  const form = query('[data-operator-form]');
  if (!form) return;
  const show = snapshot.lockout && !snapshot.bypass && operator.availability !== 'unavailable';
  const disclosure = query('[data-operator-disclosure]');
  if (disclosure) {
    disclosure.classList.toggle('is-hidden', !show);
    disclosure.setAttribute('aria-hidden', String(!show));
    if (!show) disclosure.open = false;
  }
  form.classList.toggle('is-hidden', !show);
  form.setAttribute('aria-hidden', String(!show));
  if (operator.busy) form.setAttribute('aria-busy', 'true'); else form.removeAttribute('aria-busy');
  const submit = query('[data-operator-submit]');
  if (submit) {
    submit.disabled = operator.busy || isBlocked();
    setText(submit.querySelector('.t-label'), operator.busy ? 'SIGNING IN…' : 'SIGN IN');
  }
  const input = query('[data-operator-password]');
  if (input) input.type = operator.revealed ? 'text' : 'password';
  const reveal = query('[data-operator-reveal]');
  if (reveal) {
    reveal.setAttribute('aria-pressed', String(operator.revealed));
    setText(reveal.querySelector('.t-label'), operator.revealed ? 'HIDE' : 'SHOW');
  }
}

function renderOperatorChip(snapshot) {
  const chip = query('#operator-chip');
  if (!chip) return;
  const show = snapshot.lockout && snapshot.bypass;
  setHidden(chip, !show);
  const button = chip.querySelector('[data-operator-signout]');
  if (button) button.disabled = operator.signingOut;
}

function updateHomePanel(panel, snapshot) {
  if (!panel) return;
  const visible = homePanelVisible(snapshot);
  const locked = snapshot.lockout;
  panel.setAttribute('data-maintenance-kind', locked ? 'lockout' : 'window');
  setHidden(panel, !visible);
  setText(panel.querySelector('[data-maintenance-title]'), locked ? 'Under maintenance' : 'Maintenance window');
  setText(panel.querySelector('[data-maintenance-copy]'), locked ? lockoutMessage(snapshot) : maintenanceCopy(snapshot));
  setText(panel.querySelector('[data-maintenance-note]'), locked ? lockoutNote(snapshot, operator.availability) : '');
  setText(panel.querySelector('[data-maintenance-release]'), snapshot.releaseId ? `RELEASE ${snapshot.releaseId}` : '');
  setText(panel.querySelector('[data-maintenance-rounds]'), visible ? `ACTIVE ROUNDS: ${snapshot.activeRounds}` : '');
  setBackgroundInert(visible);
  renderOperatorForm(snapshot);
  manageFocus(panel, visible);
}

// Open the panel with focus on its heading (the lobby behind it just became unreachable);
// when an operator signs in, hand focus back to the site.
function manageFocus(panel, visible) {
  const was = operator.panelWasVisible;
  operator.panelWasVisible = visible;
  if (visible && !was) {
    const home = query('#view-home');
    if (home && !home.classList.contains('is-hidden')) panel.querySelector('[data-maintenance-title]')?.focus?.({ preventScroll: true });
  } else if (!visible && was && operator.focusHomeWhenOpen) {
    operator.focusHomeWhenOpen = false;
    query('#home-main')?.focus?.({ preventScroll: true });
  }
}

export function renderMaintenanceState() {
  const snapshot = normalizeMaintenanceSnapshot(state.maintenance);
  state.maintenance = snapshot;
  updateHomePanel(query('#maintenance-home'), snapshot);
  updateGameBanner(query('#maintenance-game'), snapshot);
  renderOperatorChip(snapshot);
  if (!snapshot.lockout) {
    // A later lockout asks again whether sign-in is offered.
    operator.availability = 'unknown';
    operator.reconnectTried = false;
    clearTimeout(operator.settleTimer);
  } else if (snapshot.bypass) {
    clearTimeout(operator.settleTimer);
  } else if (operator.availability === 'unknown' && !operator.checking && homePanelVisible(snapshot)) {
    void checkAvailability();
  }
}

export function applyMaintenanceState(value) {
  state.maintenance = normalizeMaintenanceSnapshot(value);
  renderMaintenanceState();
  return state.maintenance;
}

async function checkAvailability() {
  operator.checking = true;
  const result = await fetchOperatorAvailability();
  operator.checking = false;
  // A failed look-up shows the form anyway: the sign-in request itself is the authority.
  operator.availability = result.availability === 'unavailable' ? 'unavailable' : 'available';
  // The browser already holds a valid operator cookie but this socket connected without it.
  if (result.bypass && !state.maintenance?.bypass && !operator.reconnectTried) {
    operator.reconnectTried = true;
    reconnectSocket();
  }
  renderMaintenanceState();
}

function retryMaintenanceState(event) {
  const trigger = event.target?.closest?.('[data-maintenance-retry]');
  if (!trigger) return;
  event.preventDefault();
  trigger.disabled = true;
  trigger.setAttribute('aria-busy', 'true');
  operator.availability = 'unknown';
  emitServer('get-maintenance-state', {}, response => {
    applyMaintenanceState(response?.maintenance || response);
    trigger.disabled = false;
    trigger.removeAttribute('aria-busy');
  });
}

// ---- Operator actions -------------------------------------------------------------------

function unblockLater(ms) {
  clearTimeout(operator.unblockTimer);
  operator.unblockTimer = setTimeout(() => {
    operator.blockedUntil = 0;
    if (operator.status.tone === 'error') setOperatorStatus('You can try again now.');
    renderMaintenanceState();
  }, Math.min(ms, MAX_TIMER_MS));
  operator.unblockTimer?.unref?.();
}

function focusPassword() {
  query('[data-operator-password]')?.focus?.();
}

async function submitOperatorSignIn(event) {
  const form = event.target?.closest?.('[data-operator-form]');
  if (!form) return;
  event.preventDefault();
  if (operator.busy || isBlocked()) return;
  const input = query('[data-operator-password]');
  const password = typeof input?.value === 'string' ? input.value : '';
  if (!password) {
    setOperatorStatus('Enter the operator password.', 'error');
    focusPassword();
    return;
  }
  // The value leaves the page only inside the request; the field is empty from here on.
  if (input) input.value = '';
  operator.revealed = false;
  operator.busy = true;
  setOperatorStatus('Checking the password…');
  renderMaintenanceState();
  const result = await postOperatorSignIn(password);
  operator.busy = false;
  if (result.kind === 'ok') {
    operator.focusHomeWhenOpen = true;
    setOperatorStatus('Signed in. Opening the parlor…', 'ok');
    reconnectSocket();
    clearTimeout(operator.settleTimer);
    operator.settleTimer = setTimeout(() => {
      if (homePanelVisible(state.maintenance)) {
        operator.focusHomeWhenOpen = false;
        setOperatorStatus('Signed in, but this connection has not unlocked yet. Use Retry status.', 'error');
        renderMaintenanceState();
      }
    }, UNLOCK_SETTLE_MS);
    operator.settleTimer?.unref?.();
  } else if (result.kind === 'limited') {
    const seconds = result.retryAfterSeconds;
    operator.blockedUntil = Date.now() + seconds * 1000;
    setOperatorStatus(`Too many attempts. Try again in ${retryAfterText(seconds)}.`, 'error');
    unblockLater(seconds * 1000);
    focusPassword();
  } else if (result.kind === 'unavailable') {
    operator.availability = 'unavailable';
    setOperatorStatus('');
  } else if (result.kind === 'wrong') {
    setOperatorStatus('Sign-in failed. Check the password and try again.', 'error');
    focusPassword();
  } else {
    setOperatorStatus(result.kind === 'network' ? 'The server could not be reached. Try again.' : 'Sign-in is unavailable right now. Try again shortly.', 'error');
    focusPassword();
  }
  renderMaintenanceState();
}

async function signOutOperator() {
  if (operator.signingOut) return;
  operator.signingOut = true;
  renderMaintenanceState();
  const result = await postOperatorSignOut();
  operator.signingOut = false;
  if (result.ok) {
    operator.availability = 'unknown';
    setOperatorStatus('');
    reconnectSocket();
  }
  renderMaintenanceState();
}

function onOperatorClick(event) {
  const target = event.target;
  if (target?.closest?.('[data-operator-toggle]')) {
    // <details> changes its open state after click listeners run. Move focus on
    // the next frame only if the native disclosure actually opened.
    const disclosure = query('[data-operator-disclosure]');
    if (disclosure && !disclosure.open) {
      const schedule = globalThis.requestAnimationFrame || (callback => setTimeout(callback, 0));
      schedule(() => { if (disclosure.open) focusPassword(); });
    }
    return;
  }
  if (target?.closest?.('[data-operator-reveal]')) {
    event.preventDefault();
    operator.revealed = !operator.revealed;
    renderMaintenanceState();
    return;
  }
  if (target?.closest?.('[data-operator-signout]')) {
    event.preventDefault();
    void signOutOperator();
  }
}

export function configureMaintenanceUi({ emitServer: emitter = () => {}, reconnectSocket: reconnect = () => {}, fetcher: fetchImpl = null } = {}) {
  emitServer = typeof emitter === 'function' ? emitter : () => {};
  reconnectSocket = typeof reconnect === 'function' ? reconnect : () => {};
  fetcher = typeof fetchImpl === 'function' ? fetchImpl : null;
  if (!bound && typeof document !== 'undefined') {
    bound = true;
    document.addEventListener('click', retryMaintenanceState);
    document.addEventListener('click', onOperatorClick);
    document.addEventListener('submit', submitOperatorSignIn);
  }
  renderMaintenanceState();
}

// Test seam: the module keeps its form state in one object so a test can reset it.
export function resetOperatorStateForTests() {
  clearTimeout(operator.unblockTimer);
  clearTimeout(operator.settleTimer);
  Object.assign(operator, { availability: 'unknown', checking: false, busy: false, signingOut: false, blockedUntil: 0, reconnectTried: false, revealed: false, status: { text: '', tone: '' }, focusHomeWhenOpen: false, panelWasVisible: false });
}
