const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
const CONFIRMATION_PHRASE = 'DELETE ACCOUNT';

function asTimestamp(value, fallback = 0) {
  const number = value instanceof Date ? value.getTime() : (typeof value === 'string' ? Date.parse(value) : Number(value));
  return Number.isFinite(number) ? number : fallback;
}

function accountList(accountStore) {
  if (typeof accountStore?.listAccounts === 'function') return accountStore.listAccounts();
  if (accountStore?.accounts instanceof Map) return [...accountStore.accounts.values()];
  return [];
}

function seated(roomManager, accountId) {
  return [...(roomManager?.rooms?.values?.() || [])].some(room => [...(room?.game?.players || [])].some(player => player?.accountId === accountId && !player.bankrupt && !player.spectating));
}

export function createAccountDeletionCoordinator({ accountStore, sessionStore, roomManager, stores = [], socialStore, matchStore, achievementStore, seasonStore, cosmeticStore, telemetryStore, backupStore, mailAdapter, now = Date.now, gracePeriodMs = GRACE_PERIOD_MS, onLifecycle = () => {} } = {}) {
  const linkedStores = [...stores, socialStore, matchStore, achievementStore, seasonStore, cosmeticStore, telemetryStore, backupStore].filter(Boolean);
  const requests = new Map();
  const pendingAccounts = new Map();

  function getAccount(accountId) {
    return accountStore?.getAccountById?.(accountId) || null;
  }

  function verify(account, password) {
    if (typeof accountStore?.verifyPassword === 'function') return accountStore.verifyPassword(account, password);
    return false;
  }

  async function request({ accountId, sessionId, currentPassword, typedPhrase, requestId = '', activeRoom = false } = {}) {
    const account = getAccount(accountId);
    if (!account || !verify(account, currentPassword)) return { success: false, code: 'ACCOUNT_CONFIRMATION_INVALID', error: 'Password confirmation failed.' };
    if (activeRoom || seated(roomManager, accountId)) return { success: false, code: 'LEAVE_TABLE_FIRST', error: 'Leave the table before deleting your account.' };
    if (typedPhrase !== CONFIRMATION_PHRASE) return { success: false, code: 'DELETE_PHRASE_REQUIRED', error: `Type ${CONFIRMATION_PHRASE} to continue.` };
    if (account.deletionRequestedAt && account.deletionDueAt) {
      if (account.deletionRequestId && requestId && account.deletionRequestId !== String(requestId).slice(0, 100)) return { success: false, code: 'DELETION_REQUEST_STALE', error: 'That deletion request is no longer current.' };
      return { success: true, state: 'pending', dueAt: account.deletionDueAt, requestId: account.deletionRequestId || null };
    }
    const timestamp = Number(now()) || Date.now();
    const dueAt = timestamp + Math.max(60_000, Number(gracePeriodMs) || GRACE_PERIOD_MS);
    const accountSnapshot = accountStore.snapshot?.();
    account.deletionRequestedAt = new Date(timestamp).toISOString();
    account.deletionDueAt = new Date(dueAt).toISOString();
    account.deletionRequestId = typeof requestId === 'string' ? requestId.slice(0, 100) : null;
    account.accountDeactivated = true;
    accountStore.setAccountDeactivated?.(account, true);
    try {
      accountStore.persist?.();
      sessionStore?.revokeOthers?.(sessionId);
    } catch {
      if (accountSnapshot) accountStore.restoreSnapshot?.(accountSnapshot);
      return { success: false, code: 'DELETION_NOT_COMPLETED', error: 'Account deletion could not be scheduled.' };
    }
    requests.set(account.id, { requestId: account.deletionRequestId, dueAt });
    pendingAccounts.set(account.id, account);
    try { await mailAdapter?.send?.({ to: account.recoveryEmailVerified ? account.recoveryEmail : '', subject: 'Poorup account deletion requested', template: 'deletion-requested', variables: { dueAt: new Date(dueAt).toISOString(), username: account.username } }); } catch { /* deletion state is authoritative; mail is best effort */ }
    return { success: true, state: 'pending', dueAt: account.deletionDueAt, requestId: account.deletionRequestId || null };
  }

  async function cancel({ accountId, currentPassword, requestId = '' } = {}) {
    const account = getAccount(accountId);
    if (!account || !verify(account, currentPassword)) return { success: false, code: 'ACCOUNT_CONFIRMATION_INVALID', error: 'Password confirmation failed.' };
    if (!account.deletionRequestedAt) return { success: true, state: 'active' };
    if (account.deletionRequestId && requestId && account.deletionRequestId !== String(requestId).slice(0, 100)) return { success: false, code: 'DELETION_REQUEST_STALE', error: 'That deletion request is no longer current.' };
    account.deletionRequestedAt = null;
    account.deletionDueAt = null;
    account.deletionRequestId = null;
    account.accountDeactivated = false;
    accountStore.setAccountDeactivated?.(account, false);
    accountStore.persist?.();
    requests.delete(account.id);
    pendingAccounts.delete(account.id);
    try { await mailAdapter?.send?.({ to: account.recoveryEmailVerified ? account.recoveryEmail : '', subject: 'Poorup account deletion cancelled', template: 'deletion-cancelled', variables: { username: account.username } }); } catch { /* notification is best effort */ }
    return { success: true, state: 'active' };
  }

  async function purge(account) {
    const allStores = [accountStore, ...linkedStores];
    const snapshots = allStores.map(store => (typeof store.snapshot === 'function' ? { store, snapshot: store.snapshot() } : null)).filter(Boolean);
    try {
      sessionStore?.revokeAllForAccount?.(account.id);
      for (const store of linkedStores) {
        if (typeof store.purgeAccount === 'function') await store.purgeAccount(account.id);
        else if (typeof store.anonymizeAccount === 'function') await store.anonymizeAccount(account.id);
      }
      try { await mailAdapter?.send?.({ to: account.recoveryEmailVerified ? account.recoveryEmail : '', subject: 'Poorup account deleted', template: 'account-deleted', variables: { username: account.username } }); } catch { /* purge does not depend on notification delivery */ }
      accountStore.purgeAccount?.(account.id);
      requests.delete(account.id);
      pendingAccounts.delete(account.id);
      try { onLifecycle({ accountId: account.id, state: 'deleted' }); } catch { /* lifecycle fan-out must not undo a completed purge */ }
      return { success: true };
    } catch (error) {
      snapshots.reverse().forEach(({ store, snapshot }) => (store.restoreSnapshot?.(snapshot) || store.restore?.(snapshot)));
      return { success: false, code: 'DELETION_NOT_COMPLETED', reason: 'store-write-failed' };
    }
  }

  async function runDue() {
    const timestamp = Number(now()) || Date.now();
    const result = { processed: 0, succeeded: 0, failed: 0 };
    const candidates = [...new Map([...accountList(accountStore), ...pendingAccounts.values()].map(account => [account.id, account])).values()];
    for (const account of candidates) {
      const dueAt = asTimestamp(account.deletionDueAt);
      if (!account.deletionRequestedAt || !dueAt || dueAt > timestamp) continue;
      result.processed += 1;
      const outcome = await purge(account);
      if (outcome.success) result.succeeded += 1;
      else result.failed += 1;
    }
    return result;
  }

  function status(accountId) {
    const account = getAccount(accountId);
    if (!account) return null;
    return { state: account.deletionRequestedAt ? 'pending' : 'active', requestedAt: account.deletionRequestedAt || null, dueAt: account.deletionDueAt || null };
  }

  return { request, cancel, runDue, purge, status, constants: { gracePeriodMs: Math.max(60_000, Number(gracePeriodMs) || GRACE_PERIOD_MS), confirmationPhrase: CONFIRMATION_PHRASE } };
}

export { GRACE_PERIOD_MS, CONFIRMATION_PHRASE };
