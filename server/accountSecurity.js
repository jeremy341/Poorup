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

// Records written before the cost was stored carry no parameters and used
// Node's defaults. New and upgraded records store theirs in `passwordKdf`, so
// the cost can be raised again later without breaking existing hashes.
export const LEGACY_SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1 });
// OWASP's N=2^15, r=8, p=3 setting: 32 MiB per derivation, about 190 ms here.
export const CURRENT_SCRYPT = Object.freeze({ N: 32768, r: 8, p: 3 });
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

export function scryptParamsFor(account) {
  const kdf = account?.passwordKdf;
  if (!kdf) return LEGACY_SCRYPT;
  const valid = [kdf.N, kdf.r, kdf.p].every(Number.isSafeInteger) && kdf.N >= 1024 && kdf.N <= 2 ** 20 && (kdf.N & (kdf.N - 1)) === 0 && kdf.r >= 1 && kdf.r <= 32 && kdf.p >= 1 && kdf.p <= 16;
  return valid ? { N: kdf.N, r: kdf.r, p: kdf.p } : LEGACY_SCRYPT;
}

export function hashPassword(password, salt, params = LEGACY_SCRYPT) {
  return crypto.scryptSync(password, salt, 64, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM }).toString('hex');
}

export function hashPasswordForAccount(account, password) {
  return hashPassword(password, account.passwordSalt, scryptParamsFor(account));
}

export function needsPasswordUpgrade(account) {
  const params = scryptParamsFor(account);
  return !account?.passwordKdf || params.N !== CURRENT_SCRYPT.N || params.r !== CURRENT_SCRYPT.r || params.p !== CURRENT_SCRYPT.p;
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
  account.passwordHash = hashPassword(password, salt, CURRENT_SCRYPT);
  account.passwordKdf = { ...CURRENT_SCRYPT };
}
