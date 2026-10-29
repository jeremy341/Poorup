import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadJson, writeJson } from './storeIO.js';
import { windowBucket } from './rateBuckets.js';

const TOKEN_TTL_MS = 30 * 60 * 1000;
// Password-reset mail limits. They apply to a request that would send mail
// (a verified account and address pair), once per account and once per
// address: one send per cooldown, and at most a handful per window.
const RESET_MAIL_COOLDOWN_MS = 60 * 1000;
const RESET_MAIL_WINDOW_MS = 60 * 60 * 1000;
const RESET_MAIL_MAX_PER_WINDOW = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function validEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return EMAIL_RE.test(email) ? email : '';
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 72;
}

export function createAccountRecovery({ accountStore, mailAdapter, sessionStore = null, now = Date.now, publicOrigin = '', filePath = '' } = {}) {
  const tokens = new Map();
  const knownAccounts = new Map();
  const latestEmailVerificationGeneration = new Map();
  // Every token carries a generation. It orders the requests of one account, so
  // a slow older delivery can tell that a newer request already took over.
  let generation = 0;
  const resetCooldowns = new Map();
  const resetWindows = new Map();

  // True when a reset mail to this account or address is not allowed right
  // now. Otherwise the send is recorded against both keys.
  function resetMailThrottled(keys) {
    const at = Number(now()) || Date.now();
    const cooling = keys.map(key => windowBucket(resetCooldowns, key, at, RESET_MAIL_COOLDOWN_MS));
    const windows = keys.map(key => windowBucket(resetWindows, key, at, RESET_MAIL_WINDOW_MS));
    if (cooling.some(bucket => bucket.count >= 1) || windows.some(bucket => bucket.count >= RESET_MAIL_MAX_PER_WINDOW)) return true;
    [...cooling, ...windows].forEach(bucket => { bucket.count += 1; });
    return false;
  }

  function persistTokens() {
    if (!filePath) return;
    writeJson(filePath, [...tokens.values()].map(entry => ({ ...entry })));
  }

  function loadTokens() {
    if (!filePath || !fs.existsSync(filePath)) return;
    const loaded = loadJson(filePath, value => Array.isArray(value)).value || [];
    generation = Math.max(generation, accountGenerationFloor());
    let removedConsumedReset = false;
    loaded.filter(entry => entry && typeof entry.tokenHash === 'string' && typeof entry.accountId === 'string' && typeof entry.kind === 'string')
      .slice(0, 5000).forEach((entry) => {
        const candidate = Number(entry.generation);
        // Entries written before generation tracking remain usable until the
        // account has a durable watermark. Thereafter they fail closed because
        // their position relative to a successful reset cannot be established.
        const entryGeneration = Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : 0;
        const account = getAccount(entry.accountId);
        const watermark = Number(account?.consumedPasswordResetGeneration) || 0;
        if (entry.kind === 'password-reset' && watermark > 0 && entryGeneration <= watermark) {
          removedConsumedReset = true;
          return;
        }
        tokens.set(entry.tokenHash, { ...entry, generation: entryGeneration });
        generation = Math.max(generation, entryGeneration);
      });
    if (removedConsumedReset) {
      try { persistTokens(); } catch { /* the account watermark still rejects these entries on every restart */ }
    }
  }

  function issue(accountId, kind, metadata = {}) {
    const raw = crypto.randomBytes(32).toString('base64url');
    const issuedAt = Number(now()) || Date.now();
    const accountWatermark = Number(getAccount(accountId)?.consumedPasswordResetGeneration);
    generation = Math.max(generation, accountGenerationFloor(), Number.isSafeInteger(accountWatermark) && accountWatermark >= 0 ? accountWatermark : 0);
    const entry = { tokenHash: hashToken(raw), accountId, kind, issuedAt, expiresAt: issuedAt + TOKEN_TTL_MS, ...metadata, generation: ++generation };
    tokens.set(entry.tokenHash, entry);
    // A token that was not saved is not kept: nobody has received it yet, and
    // after a restart it would not exist anyway.
    try {
      persistTokens();
    } catch (error) {
      tokens.delete(entry.tokenHash);
      throw error;
    }
    return { token: raw, tokenHash: entry.tokenHash, expiresAt: entry.expiresAt, generation: entry.generation };
  }

  // The generation that owns the pending recovery state of an account: the
  // request whose token the pending address was issued with.
  function pendingGeneration(account) {
    const hash = account?.pendingRecoveryEmailTokenHash;
    const entry = hash ? tokens.get(hash) : null;
    return Number.isFinite(entry?.generation) ? entry.generation : -1;
  }

  // Drops the older tokens of one kind for an account. The removed entries are
  // returned, so a failed write can put them back.
  function supersede(accountId, kind, keepGeneration) {
    const removed = [];
    for (const [hash, entry] of [...tokens]) {
      if (entry?.kind !== kind || entry?.accountId !== accountId) continue;
      if (!(Number(entry.generation) < keepGeneration)) continue;
      tokens.delete(hash);
      removed.push([hash, entry]);
    }
    return removed;
  }

  function getAccount(accountId) {
    return accountStore?.getAccountById?.(accountId) || null;
  }

  function accountGenerationFloor() {
    const accounts = typeof accountStore?.listAccounts === 'function'
      ? accountStore.listAccounts()
      : accountStore?.accounts instanceof Map
        ? [...accountStore.accounts.values()]
        : [...knownAccounts.values()];
    return accounts.reduce((floor, account) => {
      const value = Number(account?.consumedPasswordResetGeneration);
      return Number.isSafeInteger(value) && value >= 0 ? Math.max(floor, value) : floor;
    }, 0);
  }

  function findAccount(username) {
    if (typeof accountStore?.findAccountByUsername === 'function') return accountStore.findAccountByUsername(username);
    const normalized = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (accountStore?.accounts instanceof Map) return [...accountStore.accounts.values()].find(account => account?.username === normalized) || null;
    return knownAccounts.get(normalized) || null;
  }

  // Links are built only from the configured public origin. A link with no
  // origin is never sent, so no token is issued without one.
  function actionLink(route, token) {
    return `${String(publicOrigin).replace(/\/$/, '')}${route}?token=${encodeURIComponent(token)}`;
  }

  async function deliver(message) {
    try {
      const result = await mailAdapter?.send?.(message);
      return result?.success === true;
    } catch {
      return false;
    }
  }

  async function requestEmailVerification({ accountId, currentPassword, email } = {}) {
    const account = getAccount(accountId);
    // A pending deletion is final for the account's contact details.
    if (account?.accountDeactivated === true) return { success: false, code: 'ACCOUNT_DELETION_PENDING', error: 'Account deletion is pending.' };
    const address = validEmail(email);
    if (!account || !address || !accountStore?.verifyPassword?.(account, currentPassword)) return { success: false, code: 'RECOVERY_REQUEST_INVALID' };
    if (!publicOrigin) return { success: false, code: 'RECOVERY_LINK_UNAVAILABLE', error: 'Recovery email is not available on this server.' };
    let issued;
    try {
      issued = issue(account.id, 'email-verification', { email: address });
    } catch {
      return { success: false, code: 'RECOVERY_MAIL_UNAVAILABLE', error: 'The verification email could not be sent. Try again shortly.' };
    }
    const delivered = await deliver({ to: address, subject: 'Verify your Poorup recovery email', template: 'recovery-email-verification', variables: { actionUrl: actionLink('/account/recovery/verify', issued.token), username: account.username } });
    if (!delivered) {
      // A failed send must not leave a live token nobody received.
      tokens.delete(issued.tokenHash);
      try { persistTokens(); } catch { /* no pending account state refers to this token */ }
      return { success: false, code: 'RECOVERY_MAIL_UNAVAILABLE', error: 'The verification email could not be sent. Try again shortly.' };
    }
    // The pending state belongs to the newest request: a slow older delivery
    // must not take it back, even if the newer link was already consumed.
    if ((latestEmailVerificationGeneration.get(account.id) || 0) > issued.generation || pendingGeneration(account) >= issued.generation) {
      tokens.delete(issued.tokenHash);
      try { persistTokens(); } catch { /* the newer pending state still stands */ }
      return { success: true, expiresAt: issued.expiresAt };
    }
    const previous = {
      pendingRecoveryEmail: account.pendingRecoveryEmail,
      pendingRecoveryEmailTokenHash: account.pendingRecoveryEmailTokenHash,
      pendingRecoveryEmailExpiresAt: account.pendingRecoveryEmailExpiresAt,
    };
    account.pendingRecoveryEmail = address;
    account.pendingRecoveryEmailTokenHash = hashToken(issued.token);
    account.pendingRecoveryEmailExpiresAt = issued.expiresAt;
    try {
      accountStore.persist?.();
    } catch {
      Object.assign(account, previous);
      tokens.delete(issued.tokenHash);
      try { persistTokens(); } catch { /* the restored pending hash rejects the orphan after restart */ }
      return { success: false, code: 'RECOVERY_MAIL_UNAVAILABLE', error: 'The verification request could not be saved. Try again shortly.' };
    }
    latestEmailVerificationGeneration.set(account.id, issued.generation);
    knownAccounts.set(account.username, account);
    // Only remove older tokens after the new pending state is durable. If the
    // cleanup fails, the account's pending hash rejects them after restart.
    if (supersede(account.id, 'email-verification', issued.generation).length) {
      try { persistTokens(); } catch { /* the pending state is already stored */ }
    }
    return { success: true, expiresAt: issued.expiresAt };
  }

  // An owner-bound caller (the signed-in socket) must match the requesting
  // account. The mail link has no session, so the token itself proves the
  // mailbox and is checked without an account binding.
  async function consumeEmailVerification(token, { accountId = null } = {}) {
    const entry = tokens.get(hashToken(token));
    if (!entry || entry.kind !== 'email-verification' || entry.expiresAt <= (Number(now()) || Date.now())) return false;
    if (accountId && entry.accountId !== accountId) return false;
    const account = getAccount(entry.accountId);
    if (account?.accountDeactivated === true) return false;
    if (!account || account.pendingRecoveryEmail !== entry.email) return false;
    // Only the request that owns the pending state may confirm it: an older
    // link of the same address must not.
    if ((entry.generation > 0 || account.pendingRecoveryEmailTokenHash) && account.pendingRecoveryEmailTokenHash !== entry.tokenHash) return false;
    const previous = {
      recoveryEmail: account.recoveryEmail,
      recoveryEmailVerified: account.recoveryEmailVerified,
      pendingRecoveryEmail: account.pendingRecoveryEmail,
      pendingRecoveryEmailTokenHash: account.pendingRecoveryEmailTokenHash,
      pendingRecoveryEmailExpiresAt: account.pendingRecoveryEmailExpiresAt,
    };
    account.recoveryEmail = entry.email;
    account.recoveryEmailVerified = true;
    account.pendingRecoveryEmail = null;
    account.pendingRecoveryEmailTokenHash = null;
    account.pendingRecoveryEmailExpiresAt = null;
    try {
      accountStore.persist?.();
    } catch {
      Object.assign(account, previous);
      return false;
    }
    tokens.delete(entry.tokenHash);
    try { persistTokens(); } catch { /* the durable account state rejects this stale token after restart */ }
    try { await mailAdapter?.send?.({ to: entry.email, subject: 'Poorup recovery email verified', template: 'recovery-email-verified', variables: { username: account.username } }); } catch { /* notification is best effort */ }
    return true;
  }

  async function requestPasswordReset({ username, email } = {}) {
    const account = findAccount(username);
    const address = validEmail(email);
    const matches = account && address && account.recoveryEmailVerified === true && account.recoveryEmail === address;
    // A throttled request is answered and costs like an unmatched pair: no
    // token, no mail, and the same write, so the caller learns nothing.
    if (!matches || !publicOrigin || resetMailThrottled([`account:${account.id}`, `address:${address}`])) {
      // A match pays for a synchronous token-file write; an unmatched pair does
      // the same write (of the unchanged set), so latency does not tell them apart.
      try { persistTokens(); } catch { /* the response must not depend on the disk */ }
      return { success: true, sent: false };
    }
    // The link delivered earlier stays usable until its replacement arrives:
    // a failed mail must not leave the owner without a way in.
    let issued;
    try {
      issued = issue(account.id, 'password-reset');
    } catch {
      // Nothing was saved or mailed, so the previous reset token stays valid.
      return { success: true, sent: false };
    }
    // Delivery is not awaited: a matched address would otherwise answer slower
    // than an unmatched one by the mail round trip.
    void deliver({ to: address, subject: 'Reset your Poorup password', template: 'password-reset', variables: { actionUrl: actionLink('/account/recovery/reset', issued.token), username: account.username } }).then((delivered) => {
      if (!delivered) {
        // The replacement never arrived: drop its token, keep the old link.
        tokens.delete(issued.tokenHash);
        try { persistTokens(); } catch { /* the in-memory revocation still stands */ }
        return;
      }
      // The replacement is delivered, so the older links are dead from now on.
      const removed = supersede(account.id, 'password-reset', issued.generation);
      if (!removed.length) return;
      try {
        persistTokens();
      } catch {
        // The file still lists the older links: keep them alive in memory too.
        for (const [hash, entry] of removed) tokens.set(hash, entry);
      }
    });
    return { success: true, sent: true, expiresAt: issued.expiresAt };
  }

  async function consumePasswordReset(token, newPassword) {
    const entry = tokens.get(hashToken(token));
    if (!entry || entry.kind !== 'password-reset' || entry.expiresAt <= (Number(now()) || Date.now()) || !validPassword(newPassword)) return false;
    const account = getAccount(entry.accountId);
    if (!account) return false;
    if (typeof accountStore.updatePasswordForRecovery !== 'function') return false;
    const marker = Number(account.consumedPasswordResetGeneration) || 0;
    const entryGeneration = Number(entry.generation) || 0;
    if (entryGeneration > 0 && entryGeneration <= marker) return false;
    // A legacy token without a generation consumes the next durable value;
    // this also invalidates every reset token issued before the completion.
    const consumedGeneration = Math.max(generation, accountGenerationFloor(), marker, entryGeneration) + (entryGeneration === 0 ? 1 : 0);
    try {
      if (sessionStore) {
        if (typeof sessionStore.revokeAllForAccount !== 'function') return false;
        // Revocation is persisted before the credential changes. If it fails,
        // the password and token remain untouched so the user can retry.
        sessionStore.revokeAllForAccount(account.id);
      }
      if (accountStore.updatePasswordForRecovery(account.id, newPassword, consumedGeneration) !== true) return false;
    } catch {
      return false;
    }
    generation = Math.max(generation, consumedGeneration);
    tokens.delete(entry.tokenHash);
    // The account write is the durable consumed-token marker. This cleanup
    // removes the token hash when available, but cannot make it replayable.
    try { persistTokens(); } catch { /* the account watermark remains authoritative */ }
    return true;
  }

  function prune() {
    const timestamp = Number(now()) || Date.now();
    let removed = 0;
    for (const [key, entry] of tokens) if (entry.expiresAt <= timestamp) { tokens.delete(key); removed += 1; }
    if (removed) persistTokens();
    return removed;
  }

  // Erasure: a verification token holds the account's address, so it goes with
  // the account instead of waiting for expiry.
  function purgeAccount(accountId) {
    let removed = 0;
    for (const [key, entry] of tokens) if (entry.accountId === accountId) { tokens.delete(key); removed += 1; }
    if (removed) persistTokens();
    return removed;
  }

  loadTokens();
  return { requestEmailVerification, consumeEmailVerification, requestPasswordReset, consumePasswordReset, prune, purgeAccount, tokenCount: () => tokens.size };
}

export { TOKEN_TTL_MS, hashToken };
