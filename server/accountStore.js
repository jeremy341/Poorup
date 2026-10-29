// Account store: the persisted account registry, sessions, and the public
// entry points used by the server. Helpers live in the account* modules beside it.
import { PENDING_PATROL_ACHIEVEMENT_LIMIT, USERNAME_RE, clampInt, equityLikeContract, loanLikeContract, nonNegative, num } from './accountShared.js';
import { applyProfilePatch, cloneJson, loadableAccount, normalizeColor, normalizeDisplayName, normalizeLoadedAccount, normalizeUsername, profileAccountId, publicAccount, publicAchievements, publicPlayerStats, sanitizeAvatarGrid, sanitizePrivacy, sanitizeStats } from './accountRecords.js';
import { createSessionToken, hasCredentialShape, hashPassword, hashSessionToken, revokeLiveSessions, revokePersistedSessionHashes, validPasswordShape, writeNewPassword } from './accountSecurity.js';
import { accountAlreadyRecordedMatch, accountHoldsMatch, anonymizeAccountInMatchRecord, applyMatchResult, buildMatchRecord, countContracts, findParticipant, leaderboardRow, realizedMarketPnl, replaceOwnMatchRecord, windowRecords } from './accountMatches.js';
import { applyPatrolSettlement, normalizedSettlementId, patrolEarnsJournal, patrolReplayResult, projectedPatrolAceRuns, sanitizePendingPatrolAchievementSettlements } from './accountPatrol.js';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { participantFromPlayer } from './participantFields.js';
import { isReservedName } from './nicknamePolicy.js';
import { sanitizeMatch } from './matchStore.js';
import { loadJson, writeJson } from './storeIO.js';
import { computePlacementById } from './gamePlacement.js';

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const DEFAULT_FILE = path.join(__dirname, 'data', 'accounts.json');

// Absolute lifetime for legacy (non-cookie) session tokens, mirroring the
// cookie store's absolute window. There is no sliding refresh and no rehydrate.
const LEGACY_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Per-account password failure budget. It follows the account rather than the
// address, so rotating peers cannot keep guessing one username. A successful
// password check (login or confirmation) clears only that account's count.
const PASSWORD_FAILURE_LIMIT = 10;

const PASSWORD_FAILURE_WINDOW_MS = 15 * 60_000;

const ACCOUNT_LOCKED_ERROR = 'Too many failed sign-in attempts. Try again later.';

// One resolver per leaderboard metric. Adding a rank type is one row here. Unknown metrics fall back to wins.
// Keep the server feature flag aligned with the client. New Patrol scores use verified fields; prior records remain available separately.
export const PARLOR_PATROL_ENABLED = true;

export const PARLOR_PATROL_OFF_MESSAGE = 'Parlor Patrol is resting for now. Your saved scores are safe.';

const RANKED_LEADERBOARD_METRICS = Object.freeze([
  'wins', 'rate', 'games', 'achievements', 'mythical', 'bankruptcies', 'events',
  'auctions', 'rent', 'casino', 'market', 'playerloans', 'equity', 'loans',
  ...(PARLOR_PATROL_ENABLED ? ['patrol'] : [])
]);

function quarantineStamp() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
}

function snapshotStore(store) {
  return {
    accounts: new Map([...store.accounts].map(([key, account]) => [key, { account, state: cloneJson(account) }])),
    sessions: new Map(store.sessions),
    sessionHashes: new Map(store.sessionHashes),
    sessionIssuedAt: new Map(store.sessionIssuedAt),
  };
}

function restoreObject(target, state) {
  Object.keys(target).forEach(key => delete target[key]);
  Object.assign(target, cloneJson(state));
}

function restoreStore(store, snapshot) {
  store.accounts.clear();
  snapshot.accounts.forEach(({ account, state }, key) => {
    restoreObject(account, state);
    store.accounts.set(key, account);
  });
  store.sessions.clear();
  snapshot.sessions.forEach((owner, token) => store.sessions.set(token, owner));
  store.sessionHashes.clear();
  snapshot.sessionHashes.forEach((owner, tokenHash) => store.sessionHashes.set(tokenHash, owner));
  store.sessionIssuedAt.clear();
  (snapshot.sessionIssuedAt || new Map()).forEach((ts, key) => store.sessionIssuedAt.set(key, ts));
}

function commitMutation(store, mutate, persistOptions = {}) {
  const snapshot = snapshotStore(store);
  try {
    const result = mutate();
    store.persist(persistOptions);
    return result;
  } catch (error) {
    restoreStore(store, snapshot);
    throw error;
  }
}

// The same fifteen deltas recomputed from stored match records, for
// time-windowed views. Wins differ from the live ladder:
// history replays use the recorded final placement, not winnerId.
const WINDOW_STAT_UPDATES = {
  gamesPlayed: () => 1,
  wins: participant => (participant.finalPlacement === 1 ? 1 : 0),
  bankruptcies: participant => (participant.bankrupt ? 1 : 0),
  auctionWins: participant => num(participant.auctionWins),
  rentCollected: participant => num(participant.rentCollected),
  eventSurvival: participant => num(participant.globalEventsSurvived),
  bankLoansTaken: participant => num(participant.bankLoanCount),
  bankLoanRepayments: participant => (participant.bankLoanStatus === 'paid' ? 1 : 0),
  bankLoanDefaults: participant => (participant.bankLoanStatus === 'defaulted' ? 1 : 0),
  casinoNet: participant => num(participant.casinoNet),
  marketProfit: (participant, record, account) => realizedMarketPnl(record, account.id),
  playerLoansGiven: (participant, record, account) => countContracts(record, account.id, (contract, id) => contract.fromAccountId === id && loanLikeContract(contract)),
  playerLoansRepaid: (participant, record, account) => countContracts(record, account.id, (contract, id) => contract.toAccountId === id && loanLikeContract(contract) && contract.status === 'paid'),
  playerLoanDefaults: (participant, record, account) => countContracts(record, account.id, (contract, id) => contract.toAccountId === id && loanLikeContract(contract) && contract.status === 'defaulted'),
  equityDeals: (participant, record, account) => countContracts(record, account.id, (contract, id) => equityLikeContract(contract) && (contract.fromAccountId === id || contract.toAccountId === id))
};

// Salt for the scrypt that stands in for an unknown username's verifier. It
// is never stored or matched against anything.
const DUMMY_PASSWORD_SALT = crypto.randomBytes(16).toString('hex');

const isValidResetGeneration = generation => Number.isSafeInteger(generation) && generation >= 1;

const canRecoverPassword = (password, generation) => validPasswordShape(password) && isValidResetGeneration(generation);

export class AccountStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.accounts = new Map();
    this.idIndex = new Map();
    this.sessions = new Map();
    this.sessionHashes = new Map();
    // Legacy token issuance timestamps (token and hash to ms). Memory-only
    // like sessions itself; absolute TTL enforced in sessionAccount.
    this.sessionIssuedAt = new Map();
    // Account id: { startedAt, count }. Bounded by the account count.
    this.passwordFailures = new Map();
    // Record accounting for persist(): records on disk at load, records that
    // failed validation and are not yet moved aside, and the count of records
    // still represented on disk only by those rejects.
    this.onDiskCount = 0;
    this.rejectedCount = 0;
    this.rejectedAtLoad = [];
    this.load();
  }

  load() {
    const { value } = loadJson(this.filePath, loaded => Array.isArray(loaded));
    if (!value) return;
    const entries = value;
    if (!Array.isArray(entries)) return;
    const rejected = [];
    entries.forEach((account) => {
      const handle = normalizeUsername(account?.username);
      // Normalize legacy records as they load and keep the Map invariant
      // case-insensitive. If a malformed file contains duplicate handles,
      // the first valid record remains the owner of that username.
      if (!loadableAccount(handle, account, this.accounts)) {
        rejected.push(account);
        return;
      }
      this.accounts.set(handle, normalizeLoadedAccount(handle, account));
      // Persisted session hashes are not rehydrated. Cookie
      // sessions (sessionStore records) survive restarts with their own
      // expiry; legacy tokens require a fresh login after a restart.
    });
    this.onDiskCount = entries.length;
    this.rejectedCount = rejected.length;
    this.rejectedAtLoad = rejected;
    if (rejected.length) console.error(`Account store: ${rejected.length} record(s) failed validation and will be moved to a sidecar before the next write.`);
  }

  // The rejected records are moved aside before the store is rewritten, so the
  // rewrite cannot erase them. A rewrite that would drop records other
  // than the rejected ones and the purged accounts is refused.
  persist({ removed = 0 } = {}) {
    if (this.rejectedAtLoad.length) {
      writeJson(`${this.filePath}.rejected-${quarantineStamp()}.json`, this.rejectedAtLoad);
      this.rejectedAtLoad = [];
    }
    const records = [...this.accounts.values()];
    if (this.onDiskCount - records.length > this.rejectedCount + removed) {
      throw new Error('Account record count dropped unexpectedly; the store was not written.');
    }
    writeJson(this.filePath, records);
    this.onDiskCount = records.length;
    this.rejectedCount = 0;
  }

  resolveSessionUsername(sessionToken) {
    let username = this.sessions.get(sessionToken);
    if (username) return { username, key: sessionToken };
    const tokenHash = hashSessionToken(sessionToken);
    username = this.sessionHashes.get(tokenHash);
    if (username) {
      this.sessions.set(sessionToken, username);
      return { username, key: tokenHash };
    }
    return { username: null, key: null };
  }

  ensureLegacyIssuedAt(key) {
    const now = Date.now();
    let issuedAt = this.sessionIssuedAt.get(key);
    if (!Number.isFinite(issuedAt)) {
      issuedAt = now;
      this.sessionIssuedAt.set(key, issuedAt);
    }
    return { now, issuedAt };
  }

  expireLegacySessionIfNeeded(sessionToken, key, now, issuedAt) {
    if (now - issuedAt < LEGACY_SESSION_TTL_MS) return false;
    this.sessions.delete(sessionToken);
    this.sessionIssuedAt.delete(sessionToken);
    try {
      const tokenHash = hashSessionToken(sessionToken);
      this.sessionHashes.delete(tokenHash);
      this.sessionIssuedAt.delete(tokenHash);
    } catch { /* unhashable */ }
    this.sessionIssuedAt.delete(key);
    return true;
  }

  sessionAccount(sessionToken) {
    if (typeof sessionToken !== 'string' || !sessionToken) return null;
    const { username, key } = this.resolveSessionUsername(sessionToken);
    if (!username) return null;
    const { now, issuedAt } = this.ensureLegacyIssuedAt(key);
    if (this.expireLegacySessionIfNeeded(sessionToken, key, now, issuedAt)) return null;
    return this.accounts.get(username) || null;
  }

  sessionTokenHashFor(sessionToken) {
    if (typeof sessionToken !== 'string' || !sessionToken) return null;
    const hash = hashSessionToken(sessionToken);
    return this.sessionHashes.has(hash) ? hash : null;
  }

  accountForSessionHash(tokenHash, expectedAccountId = null) {
    if (typeof tokenHash !== 'string' || !tokenHash) return null;
    const username = this.sessionHashes.get(tokenHash);
    const account = username ? this.accounts.get(username) || null : null;
    if (!account) return null;
    if (expectedAccountId && account.id !== expectedAccountId) return null;
    // Cookie sessions are bearer tokens too, so they are bounded by the same
    // absolute TTL the legacy token path enforces. A hash that is past its
    // lifetime authenticates nobody and is dropped from both indexes.
    const { now, issuedAt } = this.ensureLegacyIssuedAt(tokenHash);
    if (now - issuedAt >= LEGACY_SESSION_TTL_MS) {
      this.sessionHashes.delete(tokenHash);
      this.sessionIssuedAt.delete(tokenHash);
      return null;
    }
    return account;
  }

  issueSession(account) {
    revokeLiveSessions(this, account.username);
    // Remove every persisted hash for the account, not just the latest field on the record.
    // This also clears hashes from older builds, so a rotated or logged-out token cannot
    // come back through the fallback index.
    revokePersistedSessionHashes(this, account.username);
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    this.sessions.set(token, account.username);
    this.sessionHashes.set(tokenHash, account.username);
    const issuedAt = Date.now();
    this.sessionIssuedAt.set(token, issuedAt);
    this.sessionIssuedAt.set(tokenHash, issuedAt);
    account.sessionTokenHash = tokenHash;
    return token;
  }

  register({ username, displayName, password, color, avatarGrid } = {}) {
    const handle = normalizeUsername(username);
    const availability = this.checkUsername(handle);
    if (!availability.available) return { success: false, error: availability.message };
    if (!validPasswordShape(password)) {
      return { success: false, error: 'Password must be 8–72 characters.' };
    }
    return commitMutation(this, () => {
      const salt = crypto.randomBytes(16).toString('hex');
      const account = {
        id: `acct_${crypto.randomUUID()}`,
        username: handle,
        displayName: normalizeDisplayName(displayName, handle),
        color: normalizeColor(color),
        avatarGrid: sanitizeAvatarGrid(avatarGrid),
        passwordSalt: salt,
        passwordHash: hashPassword(password, salt),
        stats: sanitizeStats({}),
        history: [],
        achievements: [],
        matchHistory: [],
        recordedMatchIds: [],
        consumedPasswordResetGeneration: 0,
        privacy: sanitizePrivacy(null),
        recentClearedAt: null,
        createdAt: new Date().toISOString(),
      };
      this.accounts.set(handle, account);
      const sessionToken = this.issueSession(account);
      return { success: true, account: publicAccount(account), sessionToken };
    });
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
    if (isReservedName(handle)) {
      return {
        success: true,
        available: false,
        reason: 'reserved',
        username: handle,
        message: 'That username is reserved.',
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

  passwordLocked(account) {
    const entry = account?.id ? this.passwordFailures.get(account.id) : null;
    if (!entry) return false;
    if (Date.now() - entry.startedAt >= PASSWORD_FAILURE_WINDOW_MS) {
      this.passwordFailures.delete(account.id);
      return false;
    }
    return entry.count >= PASSWORD_FAILURE_LIMIT;
  }

  recordPasswordResult(account, matched) {
    if (!account?.id) return;
    if (matched) {
      this.passwordFailures.delete(account.id);
      return;
    }
    const now = Date.now();
    const current = this.passwordFailures.get(account.id);
    const entry = current && now - current.startedAt < PASSWORD_FAILURE_WINDOW_MS ? current : { startedAt: now, count: 0 };
    entry.count += 1;
    this.passwordFailures.set(account.id, entry);
  }

  login({ username, password } = {}) {
    const handle = normalizeUsername(username);
    const account = this.accounts.get(handle);
    if (!hasCredentialShape(account, password) || !validPasswordShape(password)) {
      // An unknown username pays the same scrypt as a known one, so the
      // response time cannot tell registered names from unregistered ones.
      if (!account && validPasswordShape(password)) hashPassword(password, DUMMY_PASSWORD_SALT);
      return { success: false, error: 'Username or password is incorrect.' };
    }
    // Cheap state first: a locked account never pays for a scrypt derivation.
    if (this.passwordLocked(account)) return { success: false, code: 'ACCOUNT_LOCKED', error: ACCOUNT_LOCKED_ERROR };
    const expected = Buffer.from(account.passwordHash, 'hex');
    const actual = Buffer.from(hashPassword(password, account.passwordSalt), 'hex');
    const matched = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    this.recordPasswordResult(account, matched);
    if (!matched) {
      return { success: false, error: 'Username or password is incorrect.' };
    }
    return commitMutation(this, () => {
      const sessionToken = this.issueSession(account);
      return { success: true, account: publicAccount(account), sessionToken };
    });
  }

  restore(sessionToken) {
    const account = this.sessionAccount(sessionToken);
    return account ? { success: true, account: publicAccount(account) } : { success: false, error: 'Account session expired. Sign in again.' };
  }

  // Revoke exactly one legacy token (both indexes + stamps). Used for
  // single-use upgrades like cookie exchange; unlike logout it leaves
  // sibling sessions and the account record untouched.
  revokeSessionToken(sessionToken) {
    if (typeof sessionToken !== 'string' || !sessionToken) return false;
    let revoked = false;
    if (this.sessions.delete(sessionToken)) revoked = true;
    try {
      const tokenHash = hashSessionToken(sessionToken);
      if (this.sessionHashes.delete(tokenHash)) revoked = true;
      this.sessionIssuedAt.delete(sessionToken);
      this.sessionIssuedAt.delete(tokenHash);
    } catch { /* unhashable token: map deletion above suffices */ }
    return revoked;
  }

  logout(sessionToken) {
    const account = this.sessionAccount(sessionToken);
    if (!account) {
      if (typeof sessionToken === 'string') {
        this.sessions.delete(sessionToken);
        this.sessionIssuedAt.delete(sessionToken);
      }
      return { success: true };
    }
    return commitMutation(this, () => {
      if (typeof sessionToken === 'string') {
        this.sessions.delete(sessionToken);
        this.sessionIssuedAt.delete(sessionToken);
      }
      revokePersistedSessionHashes(this, account.username);
      account.sessionTokenHash = null;
      return { success: true };
    });
  }

  verifyPassword(account, password) {
    if (!hasCredentialShape(account, password) || !validPasswordShape(password)) return false;
    if (this.passwordLocked(account)) return false;
    const expected = Buffer.from(account.passwordHash, 'hex');
    const actual = Buffer.from(hashPassword(password, account.passwordSalt), 'hex');
    const matched = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    this.recordPasswordResult(account, matched);
    return matched;
  }

  listAccounts() {
    return [...this.accounts.values()];
  }

  setAccountDeactivated(account, value) {
    if (!account || typeof account !== 'object') return false;
    account.accountDeactivated = value === true;
    return account.accountDeactivated;
  }

  updatePassword(accountId, password) {
    const account = this.getAccountById(accountId);
    if (!account || !validPasswordShape(password)) return false;
    const updated = commitMutation(this, () => {
      writeNewPassword(account, password);
      this.revokeSessionsForAccount(account.id, false);
      return true;
    });
    // Resetting the password is the remedy for a locked account, so the failure
    // window must not outlive it (the mutation above throws if it did not land).
    this.passwordFailures.delete(account.id);
    return updated;
  }

  // Store the reset watermark with the credential in the same atomic write.
  // Recovery uses it to reject stale reset tokens if token-file cleanup fails.
  updatePasswordForRecovery(accountId, password, consumedGeneration) {
    const account = this.getAccountById(accountId);
    const generation = Number(consumedGeneration);
    if (!account || !canRecoverPassword(password, generation)) return false;
    const updated = commitMutation(this, () => {
      writeNewPassword(account, password);
      account.consumedPasswordResetGeneration = Math.max(Number(account.consumedPasswordResetGeneration) || 0, generation);
      this.revokeSessionsForAccount(account.id, false);
      return true;
    });
    this.passwordFailures.delete(account.id);
    return updated;
  }

  shouldRevokeLiveSession(owner, accountUsername, keepToken, token) {
    if (owner !== accountUsername) return false;
    if (keepToken && token === keepToken) return false;
    return true;
  }

  shouldRevokeHash(owner, accountUsername, keepToken, hash) {
    if (owner !== accountUsername) return false;
    if (!keepToken) return true;
    try {
      return hash !== hashSessionToken(keepToken);
    } catch {
      return true;
    }
  }

  revokeLiveSessionsForAccount(accountUsername, keepToken) {
    let revoked = 0;
    for (const [token, owner] of [...this.sessions]) {
      if (!this.shouldRevokeLiveSession(owner, accountUsername, keepToken, token)) continue;
      this.sessions.delete(token);
      this.sessionIssuedAt.delete(token);
      revoked += 1;
    }
    return revoked;
  }

  revokeHashSessionsForAccount(accountUsername, keepToken) {
    for (const [hash, owner] of [...this.sessionHashes]) {
      if (!this.shouldRevokeHash(owner, accountUsername, keepToken, hash)) continue;
      this.sessionHashes.delete(hash);
      this.sessionIssuedAt.delete(hash);
    }
  }

  revokeSessionsForAccount(accountId, persist = true, keepToken = null) {
    const account = this.getAccountById(accountId);
    if (!account) return 0;
    const revoked = this.revokeLiveSessionsForAccount(account.username, keepToken);
    this.revokeHashSessionsForAccount(account.username, keepToken);
    if (!keepToken) account.sessionTokenHash = null;
    if (persist) this.persist();
    return revoked;
  }

  purgeAccount(accountId) {
    const account = this.getAccountById(accountId);
    if (!account) return false;
    const purged = commitMutation(this, () => {
      this.revokeSessionsForAccount(account.id, false);
      this.accounts.forEach((remaining) => {
        if (remaining.id === account.id || !Array.isArray(remaining.matchHistory)) return;
        let changed = false;
        const next = remaining.matchHistory.map((record) => {
          const scrubbed = anonymizeAccountInMatchRecord(record, account.id);
          changed ||= scrubbed.changed;
          return scrubbed.record;
        });
        if (changed) remaining.matchHistory = next;
      });
      this.accounts.delete(account.username);
      return true;
    }, { removed: 1 });
    this.passwordFailures.delete(account.id);
    return purged;
  }

  snapshot() {
    return snapshotStore(this);
  }

  restoreSnapshot(snapshot) {
    if (!snapshot) return false;
    restoreStore(this, snapshot);
    return true;
  }

  updateProfile(sessionToken, patch = {}) {
    return this.updateProfileForAccount(this.sessionAccount(sessionToken), patch);
  }

  updateProfileForAccount(accountOrId, patch = {}) {
    const accountId = profileAccountId(accountOrId);
    const account = accountId ? this.getAccountById(accountId) : null;
    if (!account) return { success: false, error: 'Account session expired. Sign in again.' };
    return commitMutation(this, () => {
      applyProfilePatch(account, patch);
      return { success: true, account: publicAccount(account) };
    });
  }

  recordGameResults(players = [], winnerId = null, matchMeta = {}) {
    const matchId = matchMeta.gameId || `match_${crypto.randomUUID()}`;
    const activePlayers = players.filter(player => player);
    const placementById = computePlacementById(activePlayers, winnerId);
    const participants = activePlayers.map(player => participantFromPlayer(player, {
      placementById,
      winnerId,
      includeMatchDetails: matchMeta.includeMatchDetails === true
    }));
    const matchRecord = buildMatchRecord(matchId, matchMeta, participants);
    // Memory is written before disk here. A failed write must not leave memory believing the match
    // was settled, or the ledger would refuse the retry. Snapshot first and restore on failure,
    // the same invariant commitMutation enforces for the other mutating entry points.
    const pending = activePlayers.some((player) => {
      if (!player.accountId) return false;
      const account = this.getAccountById(player.accountId);
      return Boolean(account) && !accountAlreadyRecordedMatch(account, matchId);
    });
    if (!pending) return matchRecord;
    const snapshot = snapshotStore(this);
    try {
      let changed = false;
      activePlayers.forEach((player) => {
        if (!player.accountId) return;
        const account = this.getAccountById(player.accountId);
        if (!account) return;
        if (accountAlreadyRecordedMatch(account, matchId)) return;
        applyMatchResult(account, player, { matchRecord, matchMeta, winnerId });
        changed = true;
      });
      if (changed) this.persist();
      return matchRecord;
    } catch (error) {
      restoreStore(this, snapshot);
      throw error;
    }
  }

  // Achievement evaluation and seasonal assignment enrich a completed match
  // after the base stats/history write. Replace that one immutable record in
  // each participating account without replaying any stat deltas.
  updateMatchRecord(matchRecord = {}) {
    const sanitized = sanitizeMatch(matchRecord);
    if (!sanitized.matchId) return { updated: false, match: null };
    const participantAccountIds = new Set(
      sanitized.participants.map(participant => participant.accountId).filter(Boolean)
    );
    // Same invariant as recordGameResults: the replaced record only counts as
    // applied once it reached the disk.
    const owners = [...this.accounts.values()].filter(account => (
      participantAccountIds.has(account.id) && accountHoldsMatch(account, sanitized.matchId)
    ));
    if (!owners.length) return { updated: false, match: sanitized };
    const snapshot = snapshotStore(this);
    try {
      let updated = false;
      this.accounts.forEach(account => {
        if (participantAccountIds.has(account.id) && replaceOwnMatchRecord(account, sanitized)) updated = true;
      });
      if (updated) this.persist();
      return { updated, match: sanitized };
    } catch (error) {
      restoreStore(this, snapshot);
      throw error;
    }
  }

  recordAchievement(accountId, achievement = {}) {
    const account = this.getAccountById(accountId);
    const achievementId = typeof achievement.id === 'string' ? achievement.id.trim().slice(0, 80) : '';
    if (!account || !achievementId) return { success: false, created: false, error: 'Account or achievement not found.' };
    const entries = Array.isArray(account.achievements) ? account.achievements : [];
    if (entries.some((entry) => entry?.id === achievementId)) {
      return { success: true, created: false, achievement: entries.find((entry) => entry.id === achievementId) };
    }
    const entry = { id: achievementId, unlockedAt: typeof achievement.unlockedAt === 'string' ? achievement.unlockedAt : new Date().toISOString() };
    return commitMutation(this, () => {
      account.achievements = [entry, ...entries].slice(0, 100);
      return { success: true, created: true, achievement: entry };
    });
  }

  removeAchievement(accountId, achievementId) {
    const account = this.getAccountById(accountId);
    if (!account || typeof achievementId !== 'string') return false;
    const entries = Array.isArray(account.achievements) ? account.achievements : [];
    const next = entries.filter(entry => entry?.id !== achievementId);
    if (next.length === entries.length) return false;
    return commitMutation(this, () => {
      account.achievements = next;
      return true;
    });
  }

  recordPatrolResult(accountId, { score = 0, misses = 0, settlementId = null, cleanRun = false } = {}) {
    if (!PARLOR_PATROL_ENABLED) return { success: false, error: PARLOR_PATROL_OFF_MESSAGE };
    const account = this.getAccountById(accountId);
    if (!account) return { success: false, error: 'Account not found.' };
    const safeScore = clampInt(score, Number.MAX_SAFE_INTEGER);
    const safeMisses = clampInt(misses, 999);
    const safeSettlementId = normalizedSettlementId(settlementId);
    const pendingSettlements = sanitizePendingPatrolAchievementSettlements(account.pendingPatrolAchievementSettlements);
    const prior = safeSettlementId && pendingSettlements.find(entry => entry.id === safeSettlementId);
    if (prior) return patrolReplayResult(account, prior, safeMisses, safeSettlementId);
    const needsJournal = Boolean(safeSettlementId) && patrolEarnsJournal(safeScore, cleanRun, projectedPatrolAceRuns(account, safeScore));
    if (needsJournal && pendingSettlements.length >= PENDING_PATROL_ACHIEVEMENT_LIMIT) {
      return { success: false, retryable: true, error: 'Patrol achievement recovery is busy. Please retry this finish.' };
    }
    return commitMutation(this, () => applyPatrolSettlement(account, { safeScore, safeMisses, safeSettlementId, cleanRun }));
  }

  getPendingPatrolAchievementSettlements(accountId) {
    return sanitizePendingPatrolAchievementSettlements(this.getAccountById(accountId)?.pendingPatrolAchievementSettlements);
  }

  completePatrolAchievementSettlement(accountId, settlementId) {
    const account = this.getAccountById(accountId);
    const id = normalizedSettlementId(settlementId);
    if (!account || !id) return { success: false, completed: false };
    const pending = sanitizePendingPatrolAchievementSettlements(account.pendingPatrolAchievementSettlements);
    if (!pending.some(entry => entry.id === id)) return { success: true, completed: false };
    return commitMutation(this, () => {
      account.pendingPatrolAchievementSettlements = pending.filter(entry => entry.id !== id);
      return { success: true, completed: true };
    });
  }

  getPublicAccountById(accountId) {
    const account = this.getAccountById(accountId);
    return account ? publicAccount(account, false) : null;
  }

  getAccountSnapshot(accountId) {
    const account = this.getAccountById(accountId);
    return account ? publicAccount(account, true) : null;
  }

  findAccountByUsername(username) {
    const handle = normalizeUsername(username);
    return this.accounts.get(handle) || null;
  }

  // includeAchievements is the friend-level reveal (friends-only accounts); a
  // private account reveals its achievements to its owner alone (owner: true).
  getPublicPlayerCard(accountId, { includeAchievements = false, owner = false } = {}) {
    const account = this.getAccountById(accountId);
    if (!account) return null;
    const achievementsPrivate = account.privacy?.achievements === 'private';
    const revealAchievements = Boolean(includeAchievements) && (owner || !achievementsPrivate);
    const publicView = publicAccount(account, false);
    return {
      id: publicView.id,
      username: publicView.username,
      displayName: publicView.displayName,
      color: publicView.color,
      avatarGrid: publicView.avatarGrid,
      stats: publicPlayerStats(account.stats),
      achievements: revealAchievements ? publicAchievements(account, true) : publicView.achievements,
      achievementsPrivate,
      achievementsFriendsOnly: account.privacy?.achievements === 'friends' && !revealAchievements,
      historyPrivate: account.privacy?.history === 'private',
      historyFriendsOnly: account.privacy?.history === 'friends',
      // Match history is served through the authorized history endpoint so
      // private-room records can be filtered there. Keep this card itself a
      // compact identity projection.
      history: []
    };
  }

  // id maps to a live account. Every hit is re-checked against the map, so a purge,
  // rollback or replaced record can never be served from a stale entry; a miss
  // rebuilds the index in one pass, so a lookup does not scan every account.
  getAccountById(accountId) {
    const hit = this.idIndex.get(accountId);
    if (hit && hit.id === accountId && this.accounts.get(hit.username) === hit) return hit;
    this.idIndex.clear();
    for (const candidate of this.accounts.values()) {
      if (!this.idIndex.has(candidate.id)) this.idIndex.set(candidate.id, candidate);
    }
    return this.idIndex.get(accountId) || null;
  }

  getMatchHistory(accountId) {
    return this.getAccountById(accountId)?.matchHistory || [];
  }

  getRecentClearedAt(accountId) {
    return this.getAccountById(accountId)?.recentClearedAt || null;
  }

  clearRecentPlayers(sessionToken) {
    const account = this.sessionAccount(sessionToken);
    if (!account) return { success: false, error: 'Sign in to clear recent players.' };
    return this.clearRecentPlayersForAccount(account.id);
  }

  clearRecentPlayersForAccount(accountId) {
    const account = this.getAccountById(accountId);
    if (!account) return { success: false, error: 'Sign in to clear recent players.' };
    account.recentClearedAt = new Date().toISOString();
    this.persist();
    return { success: true };
  }

  getPublicMatchSummaries(accountId, includePrivate = false, limit = 10) {
    return this.getMatchHistory(accountId)
      .filter(record => includePrivate || record.roomVisibility !== 'private')
      .slice(0, Math.max(1, Math.min(20, Number(limit) || 10)))
      .map(record => ({
        matchId: record.matchId,
        completedAt: record.completedAt,
        roundCount: nonNegative(record.roundCount),
        roomVisibility: record.roomVisibility,
        participants: (record.participants || []).map(participant => ({
          displayNameAtMatch: participant.displayNameAtMatch,
          finalPlacement: participant.finalPlacement,
          propertyCount: participant.propertyCount,
          bankrupt: participant.bankrupt,
          isViewedPlayer: participant.accountId === accountId
        })),
        globalEvents: Array.isArray(record.globalEvents) ? record.globalEvents : [],
        eventCombinations: Array.isArray(record.eventCombinations) ? record.eventCombinations : [],
        tradesCompleted: Math.max(0, Number(record.tradesCompleted) || 0),
        auctionsCompleted: Math.max(0, Number(record.auctionsCompleted) || 0)
      }));
  }

  getWindowStats(account, since = null) {
    if (!since) return { ...(account.stats || {}) };
    const stats = {
      ...sanitizeStats({}),
      patrolBest: num(account.stats?.patrolBest),
      patrolAceRuns: num(account.stats?.patrolAceRuns),
      patrolVerifiedBest: num(account.stats?.patrolVerifiedBest),
      patrolVerifiedAceRuns: num(account.stats?.patrolVerifiedAceRuns)
    };
    windowRecords(account, since).forEach((record) => {
      const participant = findParticipant(record, account.id);
      if (!participant) return;
      Object.entries(WINDOW_STAT_UPDATES).forEach(([key, delta]) => {
        stats[key] += delta(participant, record, account);
      });
    });
    return stats;
  }

  getLeaderboard(metric = 'wins', options = {}) {
    if (metric === 'patrol' && !PARLOR_PATROL_ENABLED) return [];
    const accounts = [...this.accounts.values()].filter(account => account.accountDeactivated !== true)
      .filter(account => !Array.isArray(options.accountIds) || options.accountIds.includes(account.id));
    const rows = accounts.map(account => leaderboardRow(this, account, metric, options)).filter(Boolean);
    rows.sort((a, b) => b.value - a.value || b.wins - a.wins || a.displayName.localeCompare(b.displayName));
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 100)));
    return rows.slice(0, limit);
  }

  getLeaderboardSnapshot(metrics = RANKED_LEADERBOARD_METRICS, options = {}) {
    const allowed = metrics.filter(metric => RANKED_LEADERBOARD_METRICS.includes(metric));
    const selected = allowed.length ? [...new Set(allowed)] : RANKED_LEADERBOARD_METRICS;
    return {
      generatedAt: new Date().toISOString(),
      metrics: Object.fromEntries(selected.map(metric => [metric, this.getLeaderboard(metric, { ...options, limit: options.primaryMetric === metric ? 100 : 3 })])),
    };
  }
}
