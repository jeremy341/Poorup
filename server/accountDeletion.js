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

export function createAccountDeletionCoordinator({ accountStore, sessionStore, roomManager, stores = [], socialStore, matchStore, achievementStore, retiredStore, telemetryStore, analyticsRollupStore, backupStore, mailAdapter, now = Date.now, gracePeriodMs = GRACE_PERIOD_MS, onLifecycle = () => {} } = {}) {
  const linkedStores = [...stores, socialStore, matchStore, achievementStore, retiredStore, telemetryStore, analyticsRollupStore, backupStore].filter(Boolean);
  const requests = new Map();
  const pendingAccounts = new Map();
  // Accounts whose purge has started. Cancel and new requests are refused
  // until it finishes, so a purge cannot race a cancellation.
  const purgesInProgress = new Set();

  function getAccount(accountId) {
    return accountStore?.getAccountById?.(accountId) || null;
  }

  function verify(account, password) {
    if (typeof accountStore?.verifyPassword === 'function') return accountStore.verifyPassword(account, password);
    return false;
  }

  function revokeOtherSessions(accountId, sessionId, sessionToken) {
    let succeeded = true;
    try {
      sessionStore?.revokeAccountSessionsExcept?.(accountId, sessionId || null);
    } catch {
      succeeded = false;
    }
    // Bearer-token sessions live in a separate store and must be attempted even
    // when cookie revocation fails. Keep only the requesting device's token.
    try {
      accountStore.revokeSessionsForAccount?.(accountId, true, typeof sessionToken === 'string' && sessionToken ? sessionToken : null);
    } catch {
      succeeded = false;
    }
    return succeeded;
  }

  // One snapshot/restore/durable-write pattern for the deletion fields. The account store
  // writes atomically, so a failed write leaves the previous snapshot on disk. Restore
  // resyncs memory, and re-persisting covers a failure that came after a write had landed.
  function restoreAccount(snapshot) {
    if (!snapshot) return;
    try {
      accountStore.restoreSnapshot?.(snapshot);
    } catch { /* the account keeps the state the failed write left it in */ }
    try { accountStore.persist?.(); } catch { /* the next write retries */ }
  }

  async function request({ accountId, sessionId, sessionToken = null, currentPassword, typedPhrase, requestId = '', activeRoom = false } = {}) {
    const account = getAccount(accountId);
    if (!account) return { success: false, code: 'ACCOUNT_CONFIRMATION_INVALID', error: 'Password confirmation failed.' };
    if (purgesInProgress.has(account.id)) return { success: false, code: 'DELETION_IN_PROGRESS', error: 'Account deletion is already running.' };
    // Cheap checks first: a request that cannot succeed never costs a scrypt.
    if (typedPhrase !== CONFIRMATION_PHRASE) return { success: false, code: 'DELETE_PHRASE_REQUIRED', error: `Type ${CONFIRMATION_PHRASE} to continue.` };
    if (activeRoom || seated(roomManager, accountId)) return { success: false, code: 'LEAVE_TABLE_FIRST', error: 'Leave the table before deleting your account.' };
    if (!verify(account, currentPassword)) return { success: false, code: 'ACCOUNT_CONFIRMATION_INVALID', error: 'Password confirmation failed.' };
    if (account.deletionRequestedAt && account.deletionDueAt) {
      if (account.deletionRequestId && requestId && account.deletionRequestId !== String(requestId).slice(0, 100)) return { success: false, code: 'DELETION_REQUEST_STALE', error: 'That deletion request is no longer current.' };
      if (!revokeOtherSessions(accountId, sessionId, sessionToken)) return { success: false, code: 'DELETION_NOT_COMPLETED', error: 'Account deletion was scheduled, but your other devices could not be signed out.' };
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
    } catch {
      restoreAccount(accountSnapshot);
      return { success: false, code: 'DELETION_NOT_COMPLETED', error: 'Account deletion could not be scheduled.' };
    }
    requests.set(account.id, { requestId: account.deletionRequestId, dueAt });
    pendingAccounts.set(account.id, account);
    // The other devices are signed out only once the request is durable: a
    // failed write must not leave them signed out for a deletion that was not
    // scheduled. A failure here keeps the (durable) deletion.
    const sessionsRevoked = revokeOtherSessions(accountId, sessionId, sessionToken);
    try { await mailAdapter?.send?.({ to: account.recoveryEmailVerified ? account.recoveryEmail : '', subject: 'Poorup account deletion requested', template: 'deletion-requested', variables: { dueAt: new Date(dueAt).toISOString(), username: account.username } }); } catch { /* deletion state is authoritative; mail is best effort */ }
    if (!sessionsRevoked) return { success: false, code: 'DELETION_NOT_COMPLETED', error: 'Account deletion was scheduled, but your other devices could not be signed out.' };
    return { success: true, state: 'pending', dueAt: account.deletionDueAt, requestId: account.deletionRequestId || null };
  }

  async function cancel({ accountId, currentPassword, requestId = '' } = {}) {
    const account = getAccount(accountId);
    if (!account) return { success: false, code: 'ACCOUNT_CONFIRMATION_INVALID', error: 'Password confirmation failed.' };
    if (purgesInProgress.has(account.id)) return { success: false, code: 'DELETION_IN_PROGRESS', error: 'Account deletion is already running.' };
    if (!account.deletionRequestedAt) return { success: true, state: 'active' };
    // Past the deadline a purge may have run and erased stores that cannot be
    // rolled back (social, achievements, recovery, analytics, backups), so the
    // account cannot be reactivated; the deletion stays pending and is retried.
    if (asTimestamp(account.deletionDueAt, Infinity) <= (Number(now()) || Date.now())) return { success: false, code: 'DELETION_IN_PROGRESS', error: 'Account deletion has already started and can no longer be cancelled.' };
    if (account.deletionRequestId && requestId && account.deletionRequestId !== String(requestId).slice(0, 100)) return { success: false, code: 'DELETION_REQUEST_STALE', error: 'That deletion request is no longer current.' };
    if (!verify(account, currentPassword)) return { success: false, code: 'ACCOUNT_CONFIRMATION_INVALID', error: 'Password confirmation failed.' };
    // The cancellation is a state change on disk like any other: a write that
    // fails must leave the account pending, not half-cancelled.
    const accountSnapshot = accountStore.snapshot?.();
    account.deletionRequestedAt = null;
    account.deletionDueAt = null;
    account.deletionRequestId = null;
    account.accountDeactivated = false;
    accountStore.setAccountDeactivated?.(account, false);
    try {
      accountStore.persist?.();
    } catch {
      restoreAccount(accountSnapshot);
      return { success: false, code: 'DELETION_NOT_COMPLETED', error: 'Account deletion could not be cancelled.' };
    }
    requests.delete(account.id);
    pendingAccounts.delete(account.id);
    try { await mailAdapter?.send?.({ to: account.recoveryEmailVerified ? account.recoveryEmail : '', subject: 'Poorup account deletion cancelled', template: 'deletion-cancelled', variables: { username: account.username } }); } catch { /* notification is best effort */ }
    return { success: true, state: 'active' };
  }

  async function purge(account) {
    if (purgesInProgress.has(account.id)) return { success: false, code: 'DELETION_IN_PROGRESS', reason: 'purge-running' };
    // The purge is only for a request that is still pending and due.
    if (!account.deletionRequestedAt || asTimestamp(account.deletionDueAt) > (Number(now()) || Date.now())) {
      return { success: false, code: 'DELETION_REQUEST_STALE', reason: 'not-due' };
    }
    const requestId = account.deletionRequestId;
    purgesInProgress.add(account.id);
    try {
      return await purgeAccountData(account, requestId);
    } finally {
      purgesInProgress.delete(account.id);
    }
  }

  async function purgeAccountData(account, requestId) {
    // Each store owns the atomicity of its purge. Do not restore whole-store snapshots
    // after an await: a rollback would erase concurrent writes to unrelated accounts or records.
    // Completed erasures stay, and this pending request retries the remaining stores.
    try {
      for (const store of linkedStores) {
        if (typeof store.purgeAccount === 'function') await store.purgeAccount(account.id, { displayName: account.displayName });
        else if (typeof store.anonymizeAccount === 'function') {
          const outcome = await store.anonymizeAccount(account.id);
          // A copy that could not be reached still holds the account, so the
          // purge stays pending and is retried.
          if (Number(outcome?.skipped) > 0) throw Object.assign(new Error('Backup erasure is incomplete.'), { reason: 'erasure-incomplete' });
        }
      }
      // Re-check before deleting the account. If the request changed, retain
      // completed erasures but do not delete the account under the stale request.
      if (!account.deletionRequestedAt || account.deletionRequestId !== requestId) throw new Error('deletion request changed during purge');
      // The sessions are revoked last: the revocation cannot be undone, so it
      // only happens once every store is erased and the account is about to
      // go. A store that failed above leaves the account signed in.
      sessionStore?.revokeAllForAccount?.(account.id);
      accountStore.purgeAccount?.(account.id);
      requests.delete(account.id);
      pendingAccounts.delete(account.id);
      try { onLifecycle({ accountId: account.id, state: 'deleted' }); } catch { /* lifecycle fan-out must not undo a completed purge */ }
      // The notice waits until the account is gone: a mail round trip here would
      // let a scheduled backup copy the account while it still exists, and a
      // rolled-back purge must not announce a deletion that did not happen.
      try { await mailAdapter?.send?.({ to: account.recoveryEmailVerified ? account.recoveryEmail : '', subject: 'Poorup account deleted', template: 'account-deleted', variables: { username: account.username } }); } catch { /* purge does not depend on notification delivery */ }
      return { success: true };
    } catch (error) {
      // Completed stores keep their idempotent erasures; the account stays
      // pending and retries until all stores and the final account purge work.
      return { success: false, code: 'DELETION_NOT_COMPLETED', reason: error?.reason || 'store-write-failed' };
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
