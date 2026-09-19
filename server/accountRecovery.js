import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadJson, writeJson } from './storeIO.js';

const TOKEN_TTL_MS = 30 * 60 * 1000;
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

  function persistTokens() {
    if (!filePath) return;
    writeJson(filePath, [...tokens.values()].map(entry => ({ ...entry })));
  }

  function loadTokens() {
    if (!filePath || !fs.existsSync(filePath)) return;
    const loaded = loadJson(filePath, value => Array.isArray(value)).value || [];
    loaded.filter(entry => entry && typeof entry.tokenHash === 'string' && typeof entry.accountId === 'string' && typeof entry.kind === 'string')
      .slice(0, 5000).forEach(entry => tokens.set(entry.tokenHash, { ...entry }));
  }

  function issue(accountId, kind, metadata = {}) {
    const raw = crypto.randomBytes(32).toString('base64url');
    const issuedAt = Number(now()) || Date.now();
    const entry = { tokenHash: hashToken(raw), accountId, kind, issuedAt, expiresAt: issuedAt + TOKEN_TTL_MS, ...metadata };
    tokens.set(entry.tokenHash, entry);
    persistTokens();
    return { token: raw, expiresAt: entry.expiresAt };
  }

  function getAccount(accountId) {
    return accountStore?.getAccountById?.(accountId) || null;
  }

  function findAccount(username) {
    if (typeof accountStore?.findAccountByUsername === 'function') return accountStore.findAccountByUsername(username);
    const normalized = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (accountStore?.accounts instanceof Map) return [...accountStore.accounts.values()].find(account => account?.username === normalized) || null;
    return knownAccounts.get(normalized) || null;
  }

  async function requestEmailVerification({ accountId, currentPassword, email } = {}) {
    const account = getAccount(accountId);
    const address = validEmail(email);
    if (!account || !address || !accountStore?.verifyPassword?.(account, currentPassword)) return { success: false, code: 'RECOVERY_REQUEST_INVALID' };
    const issued = issue(account.id, 'email-verification', { email: address });
    knownAccounts.set(account.username, account);
    account.pendingRecoveryEmail = address;
    account.pendingRecoveryEmailTokenHash = hashToken(issued.token);
    account.pendingRecoveryEmailExpiresAt = issued.expiresAt;
    accountStore.persist?.();
    const actionUrl = publicOrigin ? `${String(publicOrigin).replace(/\/$/, '')}/profile/recovery?token=${encodeURIComponent(issued.token)}` : '';
    try { await mailAdapter?.send?.({ to: address, subject: 'Verify your Poorup recovery email', template: 'recovery-email-verification', variables: { actionUrl, username: account.username } }); } catch { /* mail is best effort; token remains valid for retry */ }
    return { success: true, expiresAt: issued.expiresAt, token: issued.token };
  }

  async function consumeEmailVerification(token) {
    const entry = tokens.get(hashToken(token));
    if (!entry || entry.kind !== 'email-verification' || entry.expiresAt <= (Number(now()) || Date.now())) return false;
    const account = getAccount(entry.accountId);
    tokens.delete(entry.tokenHash);
    persistTokens();
    if (!account || account.pendingRecoveryEmail !== entry.email) return false;
    account.recoveryEmail = entry.email;
    account.recoveryEmailVerified = true;
    account.pendingRecoveryEmail = null;
    account.pendingRecoveryEmailTokenHash = null;
    account.pendingRecoveryEmailExpiresAt = null;
    accountStore.persist?.();
    try { await mailAdapter?.send?.({ to: entry.email, subject: 'Poorup recovery email verified', template: 'recovery-email-verified', variables: { username: account.username } }); } catch { /* notification is best effort */ }
    return true;
  }

  async function requestPasswordReset({ username, email } = {}) {
    const account = findAccount(username);
    const address = validEmail(email);
    const matches = account && address && account.recoveryEmailVerified === true && account.recoveryEmail === address;
    if (!matches) return { success: true, sent: false };
    // Single live reset per account: concurrent tokens must not both work.
    for (const [hash, entry] of [...tokens]) {
      if (entry?.kind === 'password-reset' && entry?.accountId === account.id && hash) tokens.delete(hash);
    }
    const issued = issue(account.id, 'password-reset');
    try { await mailAdapter?.send?.({ to: address, subject: 'Reset your Poorup password', template: 'password-reset', variables: { username: account.username } }); } catch { /* enumeration-safe response remains unchanged */ }
    return { success: true, sent: true, expiresAt: issued.expiresAt, token: issued.token };
  }

  async function consumePasswordReset(token, newPassword) {
    const entry = tokens.get(hashToken(token));
    if (!entry || entry.kind !== 'password-reset' || entry.expiresAt <= (Number(now()) || Date.now()) || !validPassword(newPassword)) return false;
    const account = getAccount(entry.accountId);
    if (!account) return false;
    // Canonical path only: updatePassword hashes with the store's key
    // length. The legacy 32-byte fallback is removed — a failed update
    // must fail closed, never brick the credential.
    if (typeof accountStore.updatePassword !== 'function') return false;
    if (accountStore.updatePassword(account.id, newPassword) !== true) return false;
    tokens.delete(entry.tokenHash);
    persistTokens();
    accountStore.revokeSessionsForAccount?.(account.id);
    // Cookie sessions live in a separate store: without this, a stolen
    // cookie survives the reset it was supposed to invalidate.
    try { sessionStore?.revokeAllForAccount?.(account.id); } catch { /* revocation is best effort after the credential rotated */ }
    return true;
  }

  function prune() {
    const timestamp = Number(now()) || Date.now();
    let removed = 0;
    for (const [key, entry] of tokens) if (entry.expiresAt <= timestamp) { tokens.delete(key); removed += 1; }
    if (removed) persistTokens();
    return removed;
  }

  loadTokens();
  return { requestEmailVerification, consumeEmailVerification, requestPasswordReset, consumePasswordReset, prune, tokenCount: () => tokens.size };
}

export { TOKEN_TTL_MS, hashToken };
