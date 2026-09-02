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

function sanitizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object')
    .slice(0, 50)
    .map((entry) => ({
      matchId: typeof entry.matchId === 'string' ? entry.matchId : null,
      playedAt: typeof entry.playedAt === 'string' ? entry.playedAt : null,
      result: entry.result === 'WIN' ? 'WIN' : 'ROUND',
      won: entry.won === true || entry.result === 'WIN',
      endingCash: Math.max(0, Number(entry.endingCash) || 0),
      properties: Math.max(0, Number(entry.properties) || 0),
    }));
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
    history: sanitizeHistory(account.history),
    achievements: Array.isArray(account.achievements) ? account.achievements.map(entry => ({ id: entry.id, unlockedAt: entry.unlockedAt || null })).slice(0, 100) : [],
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
        const handle = normalizeUsername(account?.username);
        // Normalize legacy records as they load and keep the Map invariant
        // case-insensitive. If a malformed file contains duplicate handles,
        // the first valid record remains the owner of that username.
        if (!account || !USERNAME_RE.test(handle) || this.accounts.has(handle)) return;
        this.accounts.set(handle, {
          ...account,
          username: handle,
          displayName: normalizeDisplayName(account.displayName, account.username),
          color: normalizeColor(account.color),
          avatarGrid: sanitizeAvatarGrid(account.avatarGrid),
          stats: {
            gamesPlayed: Number(account.stats?.gamesPlayed) || 0,
            wins: Number(account.stats?.wins) || 0,
            bankruptcies: Number(account.stats?.bankruptcies) || 0,
          },
          history: sanitizeHistory(account.history),
          achievements: Array.isArray(account.achievements) ? account.achievements.filter(entry => entry && typeof entry.id === 'string').slice(0, 100) : [],
          matchHistory: Array.isArray(account.matchHistory) ? account.matchHistory.filter(entry => entry && typeof entry === 'object').slice(0, 50) : [],
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
    const availability = this.checkUsername(handle);
    if (!availability.available) return { success: false, error: availability.message };
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
      history: [],
      achievements: [],
      matchHistory: [],
      createdAt: new Date().toISOString(),
    };
    this.accounts.set(handle, account);
    const sessionToken = this.issueSession(account);
    this.persist();
    return { success: true, account: publicAccount(account), sessionToken };
  }

  checkUsername(username, currentAccountId = null) {
    const handle = normalizeUsername(username);
    if (!USERNAME_RE.test(handle)) {
      return {
        success: true,
        available: false,
        reason: 'invalid',
        username: handle,
        message: 'Username must be 3–16 characters: letters, numbers, or underscores.',
      };
    }
    const existing = this.accounts.get(handle);
    const available = !existing || (Boolean(currentAccountId) && existing.id === currentAccountId);
    return {
      success: true,
      available,
      reason: available ? 'available' : 'taken',
      username: handle,
      message: available ? 'Username is available.' : 'That username is already taken.',
    };
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

  recordGameResults(players = [], winnerId = null, matchMeta = {}) {
    const matchId = matchMeta.gameId || `match_${crypto.randomUUID()}`;
    const participants = players.filter(player => player?.accountId).map(player => ({
      accountId: player.accountId,
      displayNameAtMatch: player.nickname,
      colorAtMatch: player.color,
      finalPlacement: player.id === winnerId ? 1 : null,
      endingCash: Math.max(0, Number(player.cash) || 0),
      propertyCount: Array.isArray(player.properties) ? player.properties.length : 0,
      bankrupt: Boolean(player.bankrupt)
    }));
    const matchRecord = {
      matchId,
      completedAt: matchMeta.completedAt || new Date().toISOString(),
      durationSeconds: Math.max(0, Number(matchMeta.durationSeconds) || 0),
      roundCount: Math.max(0, Number(matchMeta.roundCount) || 0),
      roomVisibility: matchMeta.roomVisibility === 'private' ? 'private' : 'public',
      participants,
      globalEvents: Array.isArray(matchMeta.globalEvents) ? matchMeta.globalEvents.slice(0, 20) : [],
      eventCombinations: Array.isArray(matchMeta.eventCombinations) ? matchMeta.eventCombinations.slice(0, 10) : [],
      tradesCompleted: Math.max(0, Number(matchMeta.tradesCompleted) || 0),
      auctionsCompleted: Math.max(0, Number(matchMeta.auctionsCompleted) || 0)
    };
    let changed = false;
    players.forEach((player) => {
      if (!player?.accountId) return;
      const account = [...this.accounts.values()].find((candidate) => candidate.id === player.accountId);
      if (!account) return;
      account.stats.gamesPlayed += 1;
      if (player.id === winnerId) account.stats.wins += 1;
      if (player.bankrupt) account.stats.bankruptcies += 1;
      account.history = [{
        matchId,
        playedAt: new Date().toISOString(),
        result: player.id === winnerId ? 'WIN' : 'ROUND',
        won: player.id === winnerId,
        endingCash: Math.max(0, Number(player.cash) || 0),
        properties: Array.isArray(player.properties) ? player.properties.length : 0,
      }, ...sanitizeHistory(account.history)].slice(0, 50);
      account.matchHistory = [matchRecord, ...(account.matchHistory || []).filter(entry => entry.matchId !== matchId)].slice(0, 50);
      changed = true;
    });
    if (changed) this.persist();
    return matchRecord;
  }

  getPublicAccountById(accountId) {
    const account = [...this.accounts.values()].find(candidate => candidate.id === accountId);
    return account ? publicAccount(account) : null;
  }

  findAccountByUsername(username) {
    const handle = normalizeUsername(username);
    return this.accounts.get(handle) || null;
  }

  getPublicPlayerCard(accountId) {
    const account = this.getPublicAccountById(accountId);
    if (!account) return null;
    return {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      color: account.color,
      avatarGrid: account.avatarGrid,
      stats: account.stats,
      achievements: account.achievements,
      history: account.history.map(entry => ({ matchId: entry.matchId, playedAt: entry.playedAt, result: entry.result, won: entry.won, properties: entry.properties }))
    };
  }

  getLeaderboard(metric = 'wins') {
    const accounts = [...this.accounts.values()];
    const rows = accounts.map(account => {
      const stats = account.stats || {};
      const achievements = Array.isArray(account.achievements) ? account.achievements : [];
      const value = metric === 'games' ? Number(stats.gamesPlayed) || 0
        : metric === 'rate' ? (Number(stats.gamesPlayed) ? Math.round(((Number(stats.wins) || 0) / Number(stats.gamesPlayed)) * 100) : 0)
          : metric === 'achievements' ? achievements.length
            : metric === 'bankruptcies' ? Number(stats.bankruptcies) || 0
              : Number(stats.wins) || 0;
      return { accountId: account.id, displayName: account.displayName, username: account.username, color: account.color, avatarGrid: account.avatarGrid, value, games: Number(stats.gamesPlayed) || 0, wins: Number(stats.wins) || 0, achievements: achievements.length };
    });
    rows.sort((a, b) => b.value - a.value || b.wins - a.wins || a.displayName.localeCompare(b.displayName));
    return rows.slice(0, 100);
  }
}
