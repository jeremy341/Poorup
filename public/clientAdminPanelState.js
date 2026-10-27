// One loading / empty / error / unauthorized treatment for every console section.
// A section is `[data-section]` with a `[data-section-state]` message slot and a
// `[data-section-body]` for the content. Content already on screen stays visible
// while it refreshes or after a failed refresh, so a flaky network never blanks
// a table the operator is reading. Unauthorized clears the body: nothing is kept
// on screen for a session that is no longer an admin.

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

export function setSectionState(section, kind, { message = '', onRetry = null } = {}) {
  if (!section) return;
  const state = slot(section, 'state');
  const body = slot(section, 'body');
  const hasData = section.getAttribute('data-has-data') === 'true';
  section.setAttribute('data-section-kind', kind);
  section.setAttribute('aria-busy', String(kind === 'loading'));
  if (kind === 'ready') {
    section.setAttribute('data-has-data', 'true');
    state?.classList.add('is-hidden');
    if (state) state.textContent = '';
    body?.classList.remove('is-hidden');
    return;
  }
  if (kind === 'unauthorized') {
    section.setAttribute('data-has-data', 'false');
    if (body) {
      // Drop the data but keep the structure, so the section can be filled again after a new sign-in.
      if (body.hasAttribute('data-clear')) body.textContent = '';
      body.querySelectorAll('[data-clear]').forEach(element => { element.textContent = ''; });
      body.classList.add('is-hidden');
    }
  } else if (kind === 'loading' && hasData) {
    // Refresh in place: keep the content, let the freshness chip say it is refreshing.
    return;
  } else if (hasData && kind === 'error') {
    body?.classList.remove('is-hidden');
  } else {
    body?.classList.add('is-hidden');
  }
  if (!state) return;
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
