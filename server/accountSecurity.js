// Account credential and session helpers: password hashing, session tokens,
// and revoking sessions when an account changes.
import crypto from 'crypto';

export function validPasswordShape(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 72;
}

export function hasCredentialShape(account, password) {
  return Boolean(account)
    && typeof password === 'string'
    && typeof account.passwordHash === 'string'
    && typeof account.passwordSalt === 'string';
}

// Issuance stamps share the lifetime of the session entry they describe, so a
// revoked bearer token does not linger as a map key.
export function revokeLiveSessions(store, username) {
  for (const [token, owner] of store.sessions) {
    if (owner !== username) continue;
    store.sessions.delete(token);
    store.sessionIssuedAt.delete(token);
  }
}

export function revokePersistedSessionHashes(store, username) {
  for (const [tokenHash, owner] of store.sessionHashes) {
    if (owner !== username) continue;
    store.sessionHashes.delete(tokenHash);
    store.sessionIssuedAt.delete(tokenHash);
  }
}

export function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function writeNewPassword(account, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  account.passwordSalt = salt;
  account.passwordHash = hashPassword(password, salt);
}
