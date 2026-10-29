// One loading, empty, error and unauthorized treatment for every console section. A section is
// `[data-section]` with a `[data-section-state]` message slot and a `[data-section-body]`. Content
// stays on screen through refreshes and failures. Unauthorized clears it, since the session does not carry admin rights.

export const FAILURE_TEXT = Object.freeze({
  401: 'ADMIN ACCOUNT REQUIRED',
  403: 'ADMIN ACCESS REQUIRED',
  429: 'RATE LIMITED · RETRY',
  503: 'UNAVAILABLE · RETRY',
});

export function isUnauthorizedStatus(status) { return status === 401 || status === 403; }

export function failureText(status) {
  return Object.hasOwn(FAILURE_TEXT, status) ? FAILURE_TEXT[status] : 'UNAVAILABLE · RETRY';
}

const DEFAULT_TEXT = Object.freeze({
  loading: 'LOADING…',
  empty: 'NO VERIFIED OBSERVATIONS YET',
  error: 'UNAVAILABLE · RETRY',
  unauthorized: 'ADMIN ACCESS REQUIRED',
});

function slot(section, name) { return section?.querySelector?.(`[data-section-${name}]`) || null; }

function stateMarkup(kind) {
  const hint = kind === 'unauthorized' ? '<span class="t-micro ink-3">Sign in with an admin account, then check again.</span>' : '';
  const retry = kind === 'error' || kind === 'unauthorized'
    ? `<button class="btn-dark admin-state-retry" type="button" data-section-retry><span class="t-label f11">${kind === 'error' ? 'RETRY' : 'CHECK AGAIN'}</span></button>`
    : '';
  const glyph = kind === 'loading' ? '<span class="admin-state-glyph" aria-hidden="true"></span>' : '';
  return `${glyph}<span class="t-label f12 admin-state-text"></span>${hint}${retry}`;
}

// Drop the data but keep the structure, so the section can be filled again after a new sign-in.
function clearSectionBody(body) {
  if (!body) return;
  if (body.hasAttribute('data-clear')) body.textContent = '';
  body.querySelectorAll('[data-clear]').forEach(element => { element.textContent = ''; });
  body.classList.add('is-hidden');
}

function markSectionReady(section, state, body) {
  section.setAttribute('data-has-data', 'true');
  state?.classList.add('is-hidden');
  if (state) state.textContent = '';
  body?.classList.remove('is-hidden');
}

// Returns false when the body should keep its content and the state line is left alone.
function setBodyForKind(section, body, kind, hasData) {
  if (kind === 'unauthorized') {
    section.setAttribute('data-has-data', 'false');
    clearSectionBody(body);
    return true;
  }
  // Refresh in place: keep the content, let the freshness chip say it is refreshing.
  if (kind === 'loading' && hasData) return false;
  if (hasData && kind === 'error') body?.classList.remove('is-hidden');
  else body?.classList.add('is-hidden');
  return true;
}

function renderSectionStateLine(state, kind, { message = '', onRetry = null } = {}) {
  state.classList.remove('is-hidden');
  state.setAttribute('data-state-kind', kind);
  state.setAttribute('tabindex', '-1');
  state.setAttribute('role', kind === 'loading' ? 'status' : 'alert');
  state.innerHTML = stateMarkup(kind);
  const text = String(message || DEFAULT_TEXT[kind] || '');
  const label = state.querySelector('.admin-state-text');
  if (label) label.textContent = text; else state.textContent = text;
  const retry = state.querySelector('[data-section-retry]');
  if (retry) {
    retry.addEventListener('click', () => {
      state.focus?.();
      if (typeof onRetry === 'function') onRetry();
    });
  }
}

export function setSectionState(section, kind, options = {}) {
  if (!section) return;
  const state = slot(section, 'state');
  const body = slot(section, 'body');
  const hasData = section.getAttribute('data-has-data') === 'true';
  section.setAttribute('data-section-kind', kind);
  section.setAttribute('aria-busy', String(kind === 'loading'));
  if (kind === 'ready') {
    markSectionReady(section, state, body);
    return;
  }
  if (!setBodyForKind(section, body, kind, hasData)) return;
  if (!state) return;
  renderSectionStateLine(state, kind, options);
}

// Shows a failure from an HTTP status in the right state.
export function setSectionFailure(section, status, onRetry, message = '') {
  setSectionState(section, isUnauthorizedStatus(status) ? 'unauthorized' : 'error', { message: message || failureText(status), onRetry });
}

// True when a scrolling surface needs its overflow cue; call after content changes.
export function syncScrollCue(surface) {
  if (!surface) return;
  const overflowing = surface.scrollHeight > surface.clientHeight + 1 || surface.scrollWidth > surface.clientWidth + 1;
  surface.setAttribute('data-overflow', String(overflowing));
  // A surface that is also a skip-link target is only a tab stop while it actually scrolls.
  if (surface.hasAttribute('data-scroll-focus')) surface.setAttribute('tabindex', overflowing ? '0' : '-1');
}
