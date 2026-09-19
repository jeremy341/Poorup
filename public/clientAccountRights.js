import { $, esc } from './clientDom.js';
import { closeSurface, openSurface } from './clientSurfaces.js';

const ACCOUNT_STORAGE_KEYS = [
  'poorup.account.session.v1', 'poorup.profiles.v1', 'poorup.active-design.v1',
  'poorup.achievements.v1', 'poorup.guest-alias.v1', 'poorup.game-save.v1'
];
let host = { state: null, emitServer: () => {}, announce: () => {}, refresh: () => {} };

function safeDate(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function normalizeAccountRights(account) {
  const source = account?.account || account || null;
  if (!source || typeof source !== 'object' || (typeof source.username !== 'string' && !Object.prototype.hasOwnProperty.call(source, 'accountDeactivated') && !source.deletionDueAt)) return { state: 'guest', dueAt: null, requestedAt: null };
  const pending = source.accountDeactivated === true || Boolean(safeDate(source.deletionDueAt));
  return { state: pending ? 'pending' : 'active', dueAt: safeDate(source.deletionDueAt), requestedAt: safeDate(source.deletionRequestedAt) };
}

export function accountRightsMarkup(accountState = {}) {
  const normalized = accountState.state ? accountState : normalizeAccountRights(accountState);
  const state = normalized.state || 'guest';
  const isAdmin = accountState.isAdmin === true || accountState.account?.isAdmin === true;
  let body = '';
  if (state === 'pending') {
    const due = safeDate(accountState.dueAt || normalized.dueAt);
    const dueLabel = due ? new Date(due).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'AFTER THE GRACE PERIOD';
    body = `<section class="account-rights account-rights-pending" aria-labelledby="account-rights-heading"><div class="account-rights-head"><span class="t-micro red">ACCOUNT STATUS</span><span class="t-label f11" role="status" aria-live="polite">DELETION PENDING</span></div><h3 class="t-label f12 g100" id="account-rights-heading">Your account is restricted</h3><p class="t-micro ink-3">Final deletion is scheduled for ${esc(dueLabel)}. Profile recovery, export, cancellation, and sign out remain available.</p><div class="account-rights-actions"><button class="btn-dark" type="button" data-account-export>DOWNLOAD MY DATA</button><button class="btn-dark" type="button" data-account-cancel-deletion>CANCEL DELETION</button></div></section>`;
  } else if (state === 'active') {
    body = `<section class="account-rights" aria-labelledby="account-rights-heading"><div class="account-rights-head"><span class="t-micro g400">DATA RIGHTS</span><span class="t-micro ink-3" role="status" aria-live="polite" id="account-rights-status">ACCOUNT CONTROLS</span></div><h3 class="t-label f12 g100" id="account-rights-heading">Manage your account data</h3><p class="t-micro ink-3">Export a copy, revoke other sessions, or set a verified recovery email. Deletion starts a 30-day recovery period.</p><div class="account-rights-actions"><button class="btn-dark" type="button" data-account-export>DOWNLOAD MY DATA</button><button class="btn-dark" type="button" data-account-revoke-sessions>REVOKE OTHER SESSIONS</button><button class="btn-dark" type="button" data-recovery-email>RECOVERY EMAIL</button><button class="cta-red" type="button" data-account-delete>DELETE ACCOUNT</button></div></section>`;
  }
  if (isAdmin && state !== 'guest') {
    body += `<section class="account-operator" aria-labelledby="account-operator-heading"><div class="account-operator-head"><span class="t-micro g400">PARLOR OPERATIONS</span><span class="t-label f11 account-operator-badge">ADMIN</span></div><h3 class="t-label f12 g100" id="account-operator-heading">Operator console</h3><p class="t-micro ink-3">Open the internal analytics and bot-provider desk. Aggregate evidence only.</p><div class="account-operator-actions"><button class="btn-dark account-operator-open" type="button" data-admin-console><span class="t-label f11">OPEN OPERATOR CONSOLE</span></button></div></section>`;
  }
  return body;
}

export function reconcileAccountLifecycleEvent(event, target = host.state) {
  if (!target || !event) return false;
  const account = target.account?.account || target.account;
  if (!account) return false;
  if (event.state === 'deletion-pending') {
    account.accountDeactivated = true;
    account.deletionRequestedAt = event.requestedAt || new Date().toISOString();
    account.deletionDueAt = event.dueAt || null;
    account.deletionRequestId = event.requestId || null;
  } else if (event.state === 'deletion-cancelled') {
    account.accountDeactivated = false;
    account.deletionRequestedAt = null;
    account.deletionDueAt = null;
    account.deletionRequestId = null;
  } else if (event.state === 'deleted') {
    clearAccountOwnedClientState();
    if (Array.isArray(target.profiles)) target.profiles = [];
    if (target.achievementRecords instanceof Map) target.achievementRecords.clear();
    if (target.unlockedAchievements instanceof Set) target.unlockedAchievements.clear();
    if (target.social && typeof target.social === 'object') target.social = { friends: [], requests: [], outgoing: [], invites: [], notifications: [], recentPlayers: [] };
    if (target.account?.account) target.account = null;
    else target.account = null;
  } else if (event.state === 'signed-out') {
    clearAccountOwnedClientState();
    if (Array.isArray(target.profiles)) target.profiles = [];
    target.account = null;
  } else return false;
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

function render() {
  const root = $('#account-rights-content');
  if (!root) return;
  const account = host.state?.account?.account;
  root.innerHTML = accountRightsMarkup({ ...normalizeAccountRights(account), isAdmin: account?.isAdmin === true });
}

function closeAccountDialog() {
  closeSurface('#account-modal');
}

function openRightsForm(kind, trigger) {
  const card = $('#account-card');
  if (!card) return;
  const isDelete = kind === 'delete';
  const isCancel = kind === 'cancel';
  const title = isDelete ? 'Delete account' : isCancel ? 'Cancel deletion' : 'Set recovery email';
  const description = isDelete
    ? 'This starts a 30-day recovery period. Type DELETE ACCOUNT and confirm your current password. You must leave any table first.'
    : isCancel ? 'Restore your account before the scheduled purge. Confirm your current password.'
      : 'Add an email for password recovery. The address is inactive until its single-use verification link is confirmed.';
  const fields = isDelete
    ? `<label class="account-field"><span class="t-label f12 g-muted">Current password</span><input class="field" id="account-rights-password" type="password" autocomplete="current-password" required></label><label class="account-field"><span class="t-label f12 g-muted">Confirmation</span><input class="field" id="account-rights-phrase" required aria-describedby="account-rights-form-error" placeholder="DELETE ACCOUNT" autocomplete="off"></label>`
    : isCancel
      ? `<label class="account-field"><span class="t-label f12 g-muted">Current password</span><input class="field" id="account-rights-password" type="password" autocomplete="current-password" required></label>`
      : `<label class="account-field"><span class="t-label f12 g-muted">Recovery email</span><input class="field" id="account-rights-email" type="email" autocomplete="email" required></label><label class="account-field"><span class="t-label f12 g-muted">Current password</span><input class="field" id="account-rights-password" type="password" autocomplete="current-password" required></label>`;
  card.innerHTML = `<div class="account-modal-body account-rights-dialog"><div class="account-modal-head"><div><div class="t-micro ${isDelete ? 'red' : 'g400'}">ACCOUNT DATA DESK</div><h2 class="t-section g100" id="account-rights-dialog-title">${esc(title)}</h2></div><button class="btn-dark" id="account-rights-close" type="button"><span class="t-label f11">CLOSE</span></button></div><p class="t-body ink-2" id="account-rights-dialog-description">${esc(description)}</p><form id="account-rights-form">${fields}<p class="account-form-error" id="account-rights-form-error" role="alert" aria-live="assertive"></p><button class="${isDelete ? 'cta-red' : 'btn-dark'}" type="submit"><span class="${isDelete ? 'cta-text cta-text-sm' : 't-label f11'}">${esc(isDelete ? 'REQUEST DELETION' : isCancel ? 'CANCEL DELETION' : 'SEND VERIFICATION EMAIL')}</span></button></form></div>`;
  if (trigger instanceof HTMLElement) {
    const { setSurfaceReturnFocus } = host;
    setSurfaceReturnFocus?.(trigger);
  }
  openSurface('#account-modal', '#account-rights-password', { trigger });
  $('#account-rights-close')?.addEventListener('click', closeAccountDialog);
  $('#account-rights-form')?.addEventListener('submit', (event) => submitRightsForm(event, kind));
}

async function submitRightsForm(event, kind) {
  event.preventDefault();
  const error = $('#account-rights-form-error');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  const password = $('#account-rights-password')?.value || '';
  let response;
  if (kind === 'delete') {
    response = await new Promise(resolve => host.emitServer?.('account-delete-request', sessionPayload({ currentPassword: password, typedPhrase: $('#account-rights-phrase')?.value || '', requestId: `delete-${Date.now()}` }), resolve));
  } else if (kind === 'cancel') {
    response = await new Promise(resolve => host.emitServer?.('account-delete-cancel', sessionPayload({ currentPassword: password, requestId: host.state?.account?.account?.deletionRequestId || '' }), resolve));
  } else {
    response = await new Promise(resolve => host.emitServer?.('account-recovery-email-request', sessionPayload({ currentPassword: password, email: $('#account-rights-email')?.value || '' }), resolve));
  }
  if (!response?.success) {
    if (error) error.textContent = response?.error || 'The server could not process that request.';
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
    return;
  }
  if (kind === 'delete' && host.state?.account?.account) {
    Object.assign(host.state.account.account, { accountDeactivated: true, deletionDueAt: response.dueAt || null, deletionRequestedAt: new Date().toISOString(), deletionRequestId: response.requestId || null });
  }
  if (kind === 'cancel' && host.state?.account?.account) {
    Object.assign(host.state.account.account, { accountDeactivated: false, deletionDueAt: null, deletionRequestedAt: null, deletionRequestId: null });
  }
  closeAccountDialog();
  render();
  host.refresh?.();
  broadcastLifecycle(kind === 'delete'
    ? { state: 'deletion-pending', dueAt: response.dueAt || null, requestId: response.requestId || null }
    : kind === 'cancel' ? { state: 'deletion-cancelled' } : { state: 'recovery-email-pending' });
  setStatus(kind === 'delete' ? 'ACCOUNT DELETION REQUESTED' : kind === 'cancel' ? 'ACCOUNT DELETION CANCELLED' : 'CHECK YOUR EMAIL TO VERIFY RECOVERY');
}

function exportAccount() {
  const payload = sessionPayload();
  host.emitServer?.('account-export', payload, (response) => {
    if (!response?.success) { setStatus(response?.error || 'ACCOUNT EXPORT UNAVAILABLE'); return; }
    const blob = new Blob([JSON.stringify(response.document)], { type: response.contentType || 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = response.filename || 'poorup-account-export.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('ACCOUNT EXPORT READY');
  });
}

export function renderAccountRights(account = host.state?.account?.account) {
  const root = $('#account-rights-content');
  if (!root) return;
  const rights = normalizeAccountRights(account);
  root.innerHTML = accountRightsMarkup({ ...rights, isAdmin: account?.isAdmin === true });
}

export function bindAccountRights() {
  const root = $('#account-rights-content');
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';
  root.addEventListener('click', (event) => {
    const adminTrigger = event.target.closest('[data-admin-console]');
    if (adminTrigger) {
      event.preventDefault();
      const destination = '/admin/analytics';
      if (typeof globalThis.location?.assign === 'function') globalThis.location.assign(destination);
      else if (globalThis.location) globalThis.location.href = destination;
      return;
    }
    const trigger = event.target.closest('[data-account-export],[data-account-revoke-sessions],[data-account-delete],[data-account-cancel-deletion],[data-recovery-email]');
    if (!trigger) return;
    if (trigger.hasAttribute('data-account-export')) { exportAccount(); return; }
    if (trigger.hasAttribute('data-account-revoke-sessions')) {
      trigger.disabled = true;
      host.emitServer?.('account-revoke-sessions', sessionPayload(), (response) => { trigger.disabled = false; setStatus(response?.success ? 'OTHER SESSIONS REVOKED' : response?.error || 'SESSION ACTION FAILED'); });
      return;
    }
    if (trigger.hasAttribute('data-account-delete')) openRightsForm('delete', trigger);
    else if (trigger.hasAttribute('data-account-cancel-deletion')) openRightsForm('cancel', trigger);
    else if (trigger.hasAttribute('data-recovery-email')) openRightsForm('recovery', trigger);
  });
}

export { ACCOUNT_STORAGE_KEYS };
