import { $, esc } from './clientDom.js';
import { closeSurface, openSurface } from './clientSurfaces.js';

const ACCOUNT_STORAGE_KEYS = [
  'poorup.account.session.v1', 'poorup.profiles.v1', 'poorup.active-design.v1',
  'poorup.achievements.v1', 'poorup.guest-alias.v1', 'poorup.game-save.v1'
];
let host = { state: null, emitServer: () => {}, announce: () => {}, refresh: () => {} };

const EXPORT_DATA_BUTTON = '<button class="btn-dark" type="button" data-account-export>DOWNLOAD MY DATA</button>';

const ACCOUNT_RIGHTS_SECTIONS = {
  pending: {
    sectionClass: 'account-rights account-rights-pending',
    badgeTone: 'red',
    badgeLabel: 'ACCOUNT STATUS',
    statusClass: 't-label f11',
    statusId: '',
    statusLabel: 'DELETION PENDING',
    heading: 'Your account is restricted',
    actions: `${EXPORT_DATA_BUTTON}<button class="btn-dark" type="button" data-account-cancel-deletion>CANCEL DELETION</button>`
  },
  active: {
    sectionClass: 'account-rights',
    badgeTone: 'g400',
    badgeLabel: 'DATA RIGHTS',
    statusClass: 't-micro ink-3',
    statusId: 'account-rights-status',
    statusLabel: 'ACCOUNT CONTROLS',
    heading: 'Manage your account data',
    actions: `${EXPORT_DATA_BUTTON}<button class="btn-dark" type="button" data-account-revoke-sessions>REVOKE OTHER SESSIONS</button><button class="btn-dark" type="button" data-recovery-email>RECOVERY EMAIL</button><button class="cta-red" type="button" data-account-delete>DELETE ACCOUNT</button>`
  }
};

const RIGHTS_FORM_COPY = {
  delete: {
    title: 'Delete account',
    description: 'This starts a 30-day recovery period. Type DELETE ACCOUNT and confirm your current password. You must leave any table first.',
    badge: 'red',
    submitClass: 'cta-red',
    submitTextClass: 'cta-text cta-text-sm',
    submitLabel: 'REQUEST DELETION'
  },
  cancel: {
    title: 'Cancel deletion',
    description: 'Restore your account before the scheduled purge. Confirm your current password.',
    badge: 'g400',
    submitClass: 'btn-dark',
    submitTextClass: 't-label f11',
    submitLabel: 'CANCEL DELETION'
  },
  recovery: {
    title: 'Set recovery email',
    description: 'Add an email for password recovery. The address is inactive until its single-use verification link is confirmed.',
    badge: 'g400',
    submitClass: 'btn-dark',
    submitTextClass: 't-label f11',
    submitLabel: 'SEND VERIFICATION EMAIL'
  }
};

function safeDate(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isRightsSource(source) {
  if (!source || typeof source !== 'object') return false;
  if (typeof source.username === 'string') return true;
  if (Object.prototype.hasOwnProperty.call(source, 'accountDeactivated')) return true;
  return Boolean(source.deletionDueAt);
}

export function normalizeAccountRights(account) {
  const source = account?.account || account || null;
  if (!isRightsSource(source)) return { state: 'guest', dueAt: null, requestedAt: null };
  const pending = source.accountDeactivated === true || Boolean(safeDate(source.deletionDueAt));
  return { state: pending ? 'pending' : 'active', dueAt: safeDate(source.deletionDueAt), requestedAt: safeDate(source.deletionRequestedAt) };
}

function operatorSectionMarkup() {
  return `<section class="account-operator" aria-labelledby="account-operator-heading"><div class="account-operator-head"><span class="t-micro g400">PARLOR OPERATIONS</span><span class="t-label f11 account-operator-badge">ADMIN</span></div><h3 class="t-label f12 g100" id="account-operator-heading">Operator console</h3><p class="t-micro ink-3">Open the internal analytics and bot-provider desk. Aggregate evidence only.</p><div class="account-operator-actions"><button class="btn-dark account-operator-open" type="button" data-admin-console><span class="t-label f11">OPEN OPERATOR CONSOLE</span></button></div></section>`;
}

function rightsSectionCopy(state, accountState, normalized) {
  if (state === 'pending') {
    const due = safeDate(accountState.dueAt || normalized.dueAt);
    const dueLabel = due ? new Date(due).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'AFTER THE GRACE PERIOD';
    return `Final deletion is scheduled for ${esc(dueLabel)}. Profile recovery, export, cancellation, and sign out remain available.`;
  }
  return 'Export a copy, revoke other sessions, or set a verified recovery email. Deletion starts a 30-day recovery period.';
}

function rightsSectionMarkup(state, accountState, normalized) {
  const section = ACCOUNT_RIGHTS_SECTIONS[state];
  if (!section) return '';
  const statusId = section.statusId ? ` id="${section.statusId}"` : '';
  return `<section class="${section.sectionClass}" aria-labelledby="account-rights-heading"><div class="account-rights-head"><span class="t-micro ${section.badgeTone}">${section.badgeLabel}</span><span class="${section.statusClass}" role="status" aria-live="polite"${statusId}>${section.statusLabel}</span></div><h3 class="t-label f12 g100" id="account-rights-heading">${section.heading}</h3><p class="t-micro ink-3">${rightsSectionCopy(state, accountState, normalized)}</p><div class="account-rights-actions">${section.actions}</div></section>`;
}

function isAdminAccount(accountState) {
  return accountState.isAdmin === true || accountState.account?.isAdmin === true;
}

export function accountRightsMarkup(accountState = {}) {
  const normalized = accountState.state ? accountState : normalizeAccountRights(accountState);
  const state = normalized.state || 'guest';
  let body = rightsSectionMarkup(state, accountState, normalized);
  if (isAdminAccount(accountState) && state !== 'guest') body += operatorSectionMarkup();
  return body;
}

function assignDeletionState(account, { active, dueAt = null, requestedAt = null, requestId = null }) {
  account.accountDeactivated = active;
  account.deletionDueAt = dueAt;
  account.deletionRequestedAt = requestedAt;
  account.deletionRequestId = requestId;
}

function resetAccountSession(target) {
  clearAccountOwnedClientState();
  if (Array.isArray(target.profiles)) target.profiles = [];
}

function resetAccountRecords(target) {
  resetAccountSession(target);
  if (target.achievementRecords instanceof Map) target.achievementRecords.clear();
  if (target.unlockedAchievements instanceof Set) target.unlockedAchievements.clear();
  if (target.social && typeof target.social === 'object') target.social = { friends: [], requests: [], outgoing: [], invites: [], notifications: [], recentPlayers: [] };
  target.account = null;
}

const LIFECYCLE_HANDLERS = {
  'deletion-pending': (event, target, account) => assignDeletionState(account, {
    active: true,
    dueAt: event.dueAt || null,
    requestedAt: event.requestedAt || new Date().toISOString(),
    requestId: event.requestId || null
  }),
  'deletion-cancelled': (event, target, account) => assignDeletionState(account, { active: false }),
  'deleted': (event, target) => resetAccountRecords(target),
  'signed-out': (event, target) => {
    resetAccountSession(target);
    target.account = null;
  }
};

export function reconcileAccountLifecycleEvent(event, target = host.state) {
  if (!target || !event) return false;
  const account = target.account?.account || target.account;
  if (!account) return false;
  const handler = LIFECYCLE_HANDLERS[event.state];
  if (!handler) return false;
  handler(event, target, account);
  host.refresh?.();
  return true;
}

export function clearAccountOwnedClientState(storage = globalThis.localStorage) {
  if (!storage || typeof storage.removeItem !== 'function') return;
  ACCOUNT_STORAGE_KEYS.forEach(key => { try { storage.removeItem(key); } catch { /* storage may be unavailable */ } });
}

export function configureAccountRights(next = {}) {
  host = { ...host, ...next };
}

function sessionPayload(extra = {}) {
  const token = host.state?.account?.sessionToken || '';
  return token ? { sessionToken: token, ...extra } : extra;
}

function setStatus(message) {
  const status = $('#account-rights-status');
  if (status) status.textContent = message;
  host.announce?.(message);
}

function broadcastLifecycle(event) {
  try { globalThis.localStorage?.setItem('poorup.account.lifecycle.v1', JSON.stringify({ ...event, nonce: `${Date.now()}-${Math.random()}` })); } catch { /* storage may be unavailable */ }
}

function closeAccountDialog() {
  closeSurface('#account-modal');
}

function accountFieldMarkup(labelText, inputMarkup) {
  return `<label class="account-field"><span class="t-label f12 g-muted">${esc(labelText)}</span>${inputMarkup}</label>`;
}

function passwordFieldMarkup() {
  return accountFieldMarkup('Current password', '<input class="field" id="account-rights-password" type="password" autocomplete="current-password" required>');
}

function rightsFormFields(kind) {
  if (kind === 'delete') return `${passwordFieldMarkup()}${accountFieldMarkup('Confirmation', '<input class="field" id="account-rights-phrase" required aria-describedby="account-rights-form-error" placeholder="DELETE ACCOUNT" autocomplete="off">')}`;
  if (kind === 'cancel') return passwordFieldMarkup();
  return `${accountFieldMarkup('Recovery email', '<input class="field" id="account-rights-email" type="email" autocomplete="email" required>')}${passwordFieldMarkup()}`;
}

function rightsFormMarkup(copy, fields) {
  return `<div class="account-modal-body account-rights-dialog"><div class="account-modal-head"><div><div class="t-micro ${copy.badge}">ACCOUNT DATA DESK</div><h2 class="t-section g100" id="account-rights-dialog-title">${esc(copy.title)}</h2></div><button class="btn-dark" id="account-rights-close" type="button"><span class="t-label f11">CLOSE</span></button></div><p class="t-body ink-2" id="account-rights-dialog-description">${esc(copy.description)}</p><form id="account-rights-form">${fields}<p class="account-form-error" id="account-rights-form-error" role="alert" aria-live="assertive"></p><button class="${copy.submitClass}" type="submit"><span class="${copy.submitTextClass}">${esc(copy.submitLabel)}</span></button></form></div>`;
}

function openRightsForm(kind, trigger) {
  const card = $('#account-card');
  if (!card) return;
  const copy = RIGHTS_FORM_COPY[kind] || RIGHTS_FORM_COPY.recovery;
  card.innerHTML = rightsFormMarkup(copy, rightsFormFields(kind));
  if (trigger instanceof HTMLElement) {
    const { setSurfaceReturnFocus } = host;
    setSurfaceReturnFocus?.(trigger);
  }
  openSurface('#account-modal', '#account-rights-password', { trigger });
  $('#account-rights-close')?.addEventListener('click', closeAccountDialog);
  $('#account-rights-form')?.addEventListener('submit', (event) => submitRightsForm(event, kind));
}

function fieldValue(id) {
  return $(id)?.value || '';
}

function requestFromServer(eventName, payload) {
  return new Promise(resolve => host.emitServer?.(eventName, payload, resolve));
}

function setFormBusy(button, busy) {
  if (!button) return;
  if (busy) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    return;
  }
  button.disabled = false;
  button.removeAttribute('aria-busy');
}

function rejectRightsForm(error, response, button) {
  if (error) error.textContent = response?.error || 'The server could not process that request.';
  setFormBusy(button, false);
}

function assignPendingDeletion(account, response) {
  assignDeletionState(account, {
    active: true,
    dueAt: response.dueAt || null,
    requestedAt: new Date().toISOString(),
    requestId: response.requestId || null
  });
}

function noop() {}

const RIGHTS_FORM_ACTIONS = {
  delete: {
    request: (password) => requestFromServer('account-delete-request', sessionPayload({ currentPassword: password, typedPhrase: fieldValue('account-rights-phrase'), requestId: `delete-${Date.now()}` })),
    applyLocal: (response) => {
      const account = host.state?.account?.account;
      if (account) assignPendingDeletion(account, response);
    },
    lifecycle: (response) => ({ state: 'deletion-pending', dueAt: response.dueAt || null, requestId: response.requestId || null }),
    status: 'ACCOUNT DELETION REQUESTED'
  },
  cancel: {
    request: (password) => requestFromServer('account-delete-cancel', sessionPayload({ currentPassword: password, requestId: host.state?.account?.account?.deletionRequestId || '' })),
    applyLocal: () => {
      const account = host.state?.account?.account;
      if (account) assignDeletionState(account, { active: false });
    },
    lifecycle: () => ({ state: 'deletion-cancelled' }),
    status: 'ACCOUNT DELETION CANCELLED'
  },
  recovery: {
    request: (password) => requestFromServer('account-recovery-email-request', sessionPayload({ currentPassword: password, email: fieldValue('account-rights-email') })),
    applyLocal: noop,
    lifecycle: () => ({ state: 'recovery-email-pending' }),
    status: 'CHECK YOUR EMAIL TO VERIFY RECOVERY'
  }
};

function rightsFormAction(kind) {
  return RIGHTS_FORM_ACTIONS[kind] || RIGHTS_FORM_ACTIONS.recovery;
}

async function submitRightsForm(event, kind) {
  event.preventDefault();
  const error = $('#account-rights-form-error');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setFormBusy(button, true);
  const action = rightsFormAction(kind);
  const response = await action.request(fieldValue('account-rights-password'));
  if (!response?.success) {
    rejectRightsForm(error, response, button);
    return;
  }
  action.applyLocal(response);
  closeAccountDialog();
  renderAccountRights();
  host.refresh?.();
  broadcastLifecycle(action.lifecycle(response));
  setStatus(action.status);
}

function exportAccount() {
  host.emitServer?.('account-export', sessionPayload(), handleAccountExport);
}

function handleAccountExport(response) {
  if (!response?.success) { setStatus(response?.error || 'ACCOUNT EXPORT UNAVAILABLE'); return; }
  triggerAccountDownload(response);
  setStatus('ACCOUNT EXPORT READY');
}

function triggerAccountDownload(response) {
  const blob = new Blob([JSON.stringify(response.document)], { type: response.contentType || 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = response.filename || 'poorup-account-export.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderAccountRights(account = host.state?.account?.account) {
  const root = $('#account-rights-content');
  if (!root) return;
  const rights = normalizeAccountRights(account);
  root.innerHTML = accountRightsMarkup({ ...rights, isAdmin: account?.isAdmin === true });
}

function openAdminConsole() {
  const destination = '/admin/analytics';
  if (typeof globalThis.location?.assign === 'function') globalThis.location.assign(destination);
  else if (globalThis.location) globalThis.location.href = destination;
}

function revokeOtherSessions(trigger) {
  trigger.disabled = true;
  host.emitServer?.('account-revoke-sessions', sessionPayload(), (response) => {
    trigger.disabled = false;
    setStatus(response?.success ? 'OTHER SESSIONS REVOKED' : response?.error || 'SESSION ACTION FAILED');
  });
}

const ACCOUNT_TRIGGER_ACTIONS = [
  ['data-account-export', () => exportAccount()],
  ['data-account-revoke-sessions', revokeOtherSessions],
  ['data-account-delete', (trigger) => openRightsForm('delete', trigger)],
  ['data-account-cancel-deletion', (trigger) => openRightsForm('cancel', trigger)],
  ['data-recovery-email', (trigger) => openRightsForm('recovery', trigger)]
];
const ACCOUNT_TRIGGER_SELECTOR = ACCOUNT_TRIGGER_ACTIONS.map(([attribute]) => `[${attribute}]`).join(',');

export function bindAccountRights() {
  const root = $('#account-rights-content');
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-admin-console]')) {
      event.preventDefault();
      openAdminConsole();
      return;
    }
    const trigger = event.target.closest(ACCOUNT_TRIGGER_SELECTOR);
    if (!trigger) return;
    const action = ACCOUNT_TRIGGER_ACTIONS.find(([attribute]) => trigger.hasAttribute(attribute));
    action?.[1](trigger);
  });
}

export { ACCOUNT_STORAGE_KEYS };
