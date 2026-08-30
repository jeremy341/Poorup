import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'accounts.json');
const USERNAME_RE = /^[a-z0-9_]{3,16}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const FACE_SIZE = 8;

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeDisplayName(value, fallback = 'PLAYER') {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 18) : '';
  return name || fallback;
}

function normalizeColor(value, fallback = '#d74438') {
  return COLOR_RE.test(String(value || '')) ? String(value).toLowerCase() : fallback;
}

function sanitizeAvatarGrid(value) {
  if (!Array.isArray(value)) return null;
  return Array.from({ length: FACE_SIZE }, (_, y) =>
    Array.from({ length: FACE_SIZE }, (_, x) => {
      const cell = value[y]?.[x];
      return typeof cell === 'string' && COLOR_RE.test(cell) ? cell.toLowerCase() : null;
    }),
  );
}

function publicAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    color: account.color,
    avatarGrid: account.avatarGrid,
    stats: { ...account.stats },
    createdAt: account.createdAt,
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class AccountStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.accounts = new Map();
    this.sessions = new Map();
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const entries = JSON.parse(raw);
      if (!Array.isArray(entries)) return;
      entries.forEach((account) => {
        if (!account || !USERNAME_RE.test(account.username)) return;
        this.accounts.set(account.username, {
          ...account,
          displayName: normalizeDisplayName(account.displayName, account.username),
          color: normalizeColor(account.color),
          avatarGrid: sanitizeAvatarGrid(account.avatarGrid),
          stats: {
            gamesPlayed: Number(account.stats?.gamesPlayed) || 0,
            wins: Number(account.stats?.wins) || 0,
            bankruptcies: Number(account.stats?.bankruptcies) || 0,
          },
        });
      });
    } catch {
      // A missing or malformed local account file starts a clean account store.
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify([...this.accounts.values()], null, 2)}\n`, 'utf8');
  }

  sessionAccount(sessionToken) {
    if (typeof sessionToken !== 'string' || !sessionToken) return null;
    let username = this.sessions.get(sessionToken);
    if (!username) {
      const tokenHash = hashSessionToken(sessionToken);
      const account = [...this.accounts.values()].find((candidate) => candidate.sessionTokenHash === tokenHash);
      if (account) {
        username = account.username;
        this.sessions.set(sessionToken, username);
      }
    }
    return username ? this.accounts.get(username) || null : null;
  }

  issueSession(account) {
    for (const [token, username] of this.sessions) {
      if (username === account.username) this.sessions.delete(token);
    }
    const token = createSessionToken();
    this.sessions.set(token, account.username);
    account.sessionTokenHash = hashSessionToken(token);
    return token;
  }

  register({ username, displayName, password, color, avatarGrid } = {}) {
    const handle = normalizeUsername(username);
    if (!USERNAME_RE.test(handle)) {
      return { success: false, error: 'Username must be 3–16 characters: letters, numbers, or underscores.' };
    }
    if (this.accounts.has(handle)) {
      return { success: false, error: 'That username is already taken.' };
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
      return { success: false, error: 'Password must be 8–72 characters.' };
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const account = {
      id: `acct_${crypto.randomUUID()}`,
      username: handle,
      displayName: normalizeDisplayName(displayName, handle),
      color: normalizeColor(color),
      avatarGrid: sanitizeAvatarGrid(avatarGrid),
      passwordSalt: salt,
      passwordHash: hashPassword(password, salt),
      stats: { gamesPlayed: 0, wins: 0, bankruptcies: 0 },
      createdAt: new Date().toISOString(),
    };
    this.accounts.set(handle, account);
    const sessionToken = this.issueSession(account);
    this.persist();
    return { success: true, account: publicAccount(account), sessionToken };
  }

  login({ username, password } = {}) {
    const handle = normalizeUsername(username);
    const account = this.accounts.get(handle);
    if (!account || typeof password !== 'string' || typeof account.passwordHash !== 'string' || typeof account.passwordSalt !== 'string') {
      return { success: false, error: 'Username or password is incorrect.' };
    }
    const expected = Buffer.from(account.passwordHash, 'hex');
    const actual = Buffer.from(hashPassword(password, account.passwordSalt), 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return { success: false, error: 'Username or password is incorrect.' };
    }
    const sessionToken = this.issueSession(account);
    this.persist();
    return { success: true, account: publicAccount(account), sessionToken };
  }

  restore(sessionToken) {
    const account = this.sessionAccount(sessionToken);
    return account ? { success: true, account: publicAccount(account) } : { success: false, error: 'Account session expired. Sign in again.' };
  }

  logout(sessionToken) {
    const account = this.sessionAccount(sessionToken);
    if (typeof sessionToken === 'string') this.sessions.delete(sessionToken);
    if (account) {
      account.sessionTokenHash = null;
      this.persist();
    }
    return { success: true };
  }

  updateProfile(sessionToken, patch = {}) {
    const account = this.sessionAccount(sessionToken);
    if (!account) return { success: false, error: 'Account session expired. Sign in again.' };
    if (patch.displayName != null) account.displayName = normalizeDisplayName(patch.displayName, account.username);
    if (patch.color != null) account.color = normalizeColor(patch.color, account.color);
    if (patch.avatarGrid != null) account.avatarGrid = sanitizeAvatarGrid(patch.avatarGrid);
    this.persist();
    return { success: true, account: publicAccount(account) };
  }

  recordGameResults(players = [], winnerId = null) {
    let changed = false;
    players.forEach((player) => {
      if (!player?.accountId) return;
      const account = [...this.accounts.values()].find((candidate) => candidate.id === player.accountId);
      if (!account) return;
      account.stats.gamesPlayed += 1;
      if (player.id === winnerId) account.stats.wins += 1;
      if (player.bankrupt) account.stats.bankruptcies += 1;
      changed = true;
    });
    if (changed) this.persist();
  }
}
