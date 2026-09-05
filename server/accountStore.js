import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { participantFromPlayer } from './participantFields.js';
import { loadJson, writeJson } from './storeIO.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'accounts.json');
const USERNAME_RE = /^[a-z0-9_]{3,16}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const FACE_SIZE = 8;
const MYTHICAL_ACHIEVEMENT_IDS = new Set(['41st-tile', 'null-player', 'black-ledger']);
const ACHIEVEMENT_POINTS = { common: 10, uncommon: 25, rare: 50, epic: 100, legendary: 250, mythical: 1000 };
const ACHIEVEMENT_RARITY_BY_ID = new Map([
  ...['first-deed', 'last-wallet-standing', 'one-dollar-hedge', 'first-index', 'patrol-rookie'].map(id => [id, 'common']),
  ...['full-street', 'even-builder', 'clean-exit', 'debt-free', 'council-member', 'generous-lender', 'patrol-regular'].map(id => [id, 'uncommon']),
  ...['auction-ghost', 'collateral-damage', 'bad-idea-good-timing', 'prison-break', 'no-refunds', 'rent-reaper', 'fire-sale', 'airport-hopper', 'tax-evasion', 'underdog', 'group-therapy', 'hostile-bidder', 'event-tourist', 'silent-partner', 'roulette-regular', 'market-maker', 'grounded-tourist', 'coalition-builder', 'patrol-ace', 'crisis-manager', 'unanimous'].map(id => [id, 'rare']),
  ...['empty-streets', 'liquidity-king', 'public-works', 'short-the-street', 'moral-hazard', 'treasure-map', 'all-in', 'crisis-investor', 'clean-run', 'bubble-survivor', 'stagflation-trader'].map(id => [id, 'epic']),
  ...['double-headline', 'no-floor', 'compromised-council', 'public-enemy'].map(id => [id, 'legendary']),
  ...['41st-tile', 'null-player', 'black-ledger'].map(id => [id, 'mythical'])
]);

function achievementPoints(entry, since = null) {
  if (since && Date.parse(entry?.unlockedAt || '') < since) return 0;
  const rarity = ACHIEVEMENT_RARITY_BY_ID.get(entry?.id) || 'common';
  return ACHIEVEMENT_POINTS[rarity] || ACHIEVEMENT_POINTS.common;
}

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

function publicAccount(account, includePrivateHistory = true) {
  if (!account) return null;
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    color: account.color,
    avatarGrid: account.avatarGrid,
    stats: { ...account.stats },
    history: includePrivateHistory
      ? sanitizeHistory(account.history)
      : sanitizeHistory(account.history).map(entry => ({ matchId: entry.matchId, playedAt: entry.playedAt, result: entry.result, won: entry.won, properties: entry.properties })),
    // Full match records contain exact cash, contracts, and other private
    // economy facts. They are returned only to the signed-in owner; the
    // account-id lookup used by social/search projections must never leak
    // this field.
    ...(includePrivateHistory
      ? { matchHistory: Array.isArray(account.matchHistory) ? account.matchHistory.slice(0, 50) : [] }
      : {}),
    achievements: account.privacy?.achievements === 'private' && !includePrivateHistory
      ? []
      : Array.isArray(account.achievements) ? account.achievements.map(entry => ({ id: entry.id, unlockedAt: entry.unlockedAt || null })).slice(0, 100) : [],
    achievementsPrivate: account.privacy?.achievements === 'private',
    privacy: sanitizePrivacy(account.privacy),
    recentClearedAt: account.recentClearedAt || null,
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
    const { value } = loadJson(this.filePath);
    if (!value) return;
    const entries = value;
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
          auctionWins: Number(account.stats?.auctionWins) || 0,
          rentCollected: Number(account.stats?.rentCollected) || 0,
          eventSurvival: Number(account.stats?.eventSurvival) || 0,
          casinoNet: Number(account.stats?.casinoNet) || 0,
          marketProfit: Number(account.stats?.marketProfit) || 0,
          playerLoansGiven: Number(account.stats?.playerLoansGiven) || 0,
          playerLoansRepaid: Number(account.stats?.playerLoansRepaid) || 0,
          playerLoanDefaults: Number(account.stats?.playerLoanDefaults) || 0,
          equityDeals: Number(account.stats?.equityDeals) || 0,
          bankLoansTaken: Number(account.stats?.bankLoansTaken) || 0,
          bankLoanRepayments: Number(account.stats?.bankLoanRepayments) || 0,
          bankLoanDefaults: Number(account.stats?.bankLoanDefaults) || 0,
          patrolBest: Number(account.stats?.patrolBest) || 0,
          patrolAceRuns: Number(account.stats?.patrolAceRuns) || 0,
        },
        history: sanitizeHistory(account.history),
        achievements: Array.isArray(account.achievements) ? account.achievements.filter(entry => entry && typeof entry.id === 'string').slice(0, 100) : [],
        matchHistory: Array.isArray(account.matchHistory) ? account.matchHistory.filter(entry => entry && typeof entry === 'object').slice(0, 50) : [],
        privacy: sanitizePrivacy(account.privacy),
        recentClearedAt: typeof account.recentClearedAt === 'string' ? account.recentClearedAt : null,
      });
    });
  }

  persist() {
    writeJson(this.filePath, [...this.accounts.values()]);
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
      stats: { gamesPlayed: 0, wins: 0, bankruptcies: 0, auctionWins: 0, rentCollected: 0, eventSurvival: 0, casinoNet: 0, marketProfit: 0, playerLoansGiven: 0, playerLoansRepaid: 0, playerLoanDefaults: 0, equityDeals: 0, bankLoansTaken: 0, bankLoanRepayments: 0, bankLoanDefaults: 0, patrolBest: 0, patrolAceRuns: 0 },
      history: [],
      achievements: [],
      matchHistory: [],
      privacy: sanitizePrivacy(null),
      recentClearedAt: null,
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
    if (patch.privacy && typeof patch.privacy === 'object') account.privacy = sanitizePrivacy(patch.privacy);
    this.persist();
    return { success: true, account: publicAccount(account) };
  }

  recordGameResults(players = [], winnerId = null, matchMeta = {}) {
    const matchId = matchMeta.gameId || `match_${crypto.randomUUID()}`;
    const placementById = new Map([...players]
      .sort((a, b) => Number(Boolean(a.bankrupt)) - Number(Boolean(b.bankrupt)) || (Number(b.cash) || 0) - (Number(a.cash) || 0))
      .map((player, index) => [player.id, index + 1]));
    const participants = players.filter(player => player).map(player => participantFromPlayer(player, { placementById, winnerId }));
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
      auctionsCompleted: Math.max(0, Number(matchMeta.auctionsCompleted) || 0),
      casino: Array.isArray(matchMeta.casino) ? matchMeta.casino.slice(0, 8) : [],
      market: Array.isArray(matchMeta.market) ? matchMeta.market.slice(0, 8) : [],
      playerContracts: Array.isArray(matchMeta.playerContracts) ? matchMeta.playerContracts.slice(0, 20) : []
    };
    let changed = false;
    players.forEach((player) => {
      if (!player?.accountId) return;
      const account = [...this.accounts.values()].find((candidate) => candidate.id === player.accountId);
      if (!account) return;
      account.stats.gamesPlayed += 1;
      if (player.id === winnerId) account.stats.wins += 1;
      if (player.bankrupt) account.stats.bankruptcies += 1;
      account.stats.auctionWins += Math.max(0, Number(player.auctionWins) || 0);
      account.stats.rentCollected += Math.max(0, Number(player.rentCollected) || 0);
      account.stats.eventSurvival += Math.max(0, Number(player.globalEventsSurvived) || 0);
      account.stats.bankLoansTaken += Math.max(0, Number(player.bankLoanCount) || 0);
      if (player.bankLoan?.status === 'paid') account.stats.bankLoanRepayments += 1;
      if (player.bankLoan?.status === 'defaulted') account.stats.bankLoanDefaults += 1;
      const casinoSummary = (matchMeta.casino || []).find(entry => entry.accountId === player.accountId);
      const marketSummary = (matchMeta.market || []).find(entry => entry.accountId === player.accountId);
      account.stats.casinoNet += Number(casinoSummary?.net) || 0;
      account.stats.marketProfit += Object.values(marketSummary?.positions || {}).reduce((sum, position) => sum + (Number(position.realizedPnl) || 0), 0);
      const contracts = Array.isArray(matchMeta.playerContracts) ? matchMeta.playerContracts : [];
      account.stats.playerLoansGiven += contracts.filter(contract => contract.fromAccountId === player.accountId && contract.kind === 'loan').length;
      account.stats.playerLoansRepaid += contracts.filter(contract => contract.toAccountId === player.accountId && contract.kind === 'loan' && contract.status === 'paid').length;
      account.stats.playerLoanDefaults += contracts.filter(contract => contract.toAccountId === player.accountId && contract.kind === 'loan' && contract.status === 'defaulted').length;
      account.stats.equityDeals += contracts.filter(contract => contract.kind === 'equity' && (contract.fromAccountId === player.accountId || contract.toAccountId === player.accountId)).length;
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

  recordAchievement(accountId, achievement = {}) {
    const account = [...this.accounts.values()].find((candidate) => candidate.id === accountId);
    const achievementId = typeof achievement.id === 'string' ? achievement.id.trim().slice(0, 80) : '';
    if (!account || !achievementId) return { success: false, created: false, error: 'Account or achievement not found.' };
    const entries = Array.isArray(account.achievements) ? account.achievements : [];
    if (entries.some((entry) => entry?.id === achievementId)) {
      return { success: true, created: false, achievement: entries.find((entry) => entry.id === achievementId) };
    }
    const entry = { id: achievementId, unlockedAt: typeof achievement.unlockedAt === 'string' ? achievement.unlockedAt : new Date().toISOString() };
    account.achievements = [entry, ...entries].slice(0, 100);
    this.persist();
    return { success: true, created: true, achievement: entry };
  }

  recordPatrolResult(accountId, { score = 0, misses = 0 } = {}) {
    const account = [...this.accounts.values()].find((candidate) => candidate.id === accountId);
    if (!account) return { success: false, error: 'Account not found.' };
    const safeScore = Math.max(0, Math.min(100000, Math.floor(Number(score) || 0)));
    const safeMisses = Math.max(0, Math.min(999, Math.floor(Number(misses) || 0)));
    const stats = account.stats || (account.stats = {});
    const previousBest = Math.max(0, Number(stats.patrolBest) || 0);
    const beatBest = safeScore > previousBest;
    stats.patrolBest = Math.max(previousBest, safeScore);
    stats.patrolAceRuns = Math.max(0, Number(stats.patrolAceRuns) || 0) + (beatBest && previousBest > 0 ? 1 : 0);
    this.persist();
    return { success: true, score: safeScore, misses: safeMisses, best: stats.patrolBest, aceRuns: stats.patrolAceRuns };
  }

  getPublicAccountById(accountId) {
    const account = [...this.accounts.values()].find(candidate => candidate.id === accountId);
    return account ? publicAccount(account, false) : null;
  }

  getAccountSnapshot(accountId) {
    const account = [...this.accounts.values()].find(candidate => candidate.id === accountId);
    return account ? publicAccount(account, true) : null;
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
      achievements: account.privacy?.achievements === 'private' ? [] : account.achievements,
      achievementsPrivate: account.privacy?.achievements === 'private',
      historyPrivate: account.privacy?.history === 'private',
      historyFriendsOnly: account.privacy?.history === 'friends',
      // Match history is served through the authorized history endpoint so
      // private-room records can be filtered there. Keep this card itself a
      // compact identity projection.
      history: []
    };
  }

  getAccountById(accountId) {
    return [...this.accounts.values()].find(candidate => candidate.id === accountId) || null;
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
        roundCount: record.roundCount,
        roomVisibility: record.roomVisibility,
        participants: (record.participants || []).map(participant => ({
          displayNameAtMatch: participant.displayNameAtMatch,
          finalPlacement: participant.finalPlacement,
          propertyCount: participant.propertyCount,
          bankrupt: participant.bankrupt
        })),
        globalEvents: Array.isArray(record.globalEvents) ? record.globalEvents : [],
        eventCombinations: Array.isArray(record.eventCombinations) ? record.eventCombinations : [],
        tradesCompleted: Math.max(0, Number(record.tradesCompleted) || 0),
        auctionsCompleted: Math.max(0, Number(record.auctionsCompleted) || 0)
      }));
  }

  getWindowStats(account, since = null) {
    if (!since) return { ...(account.stats || {}) };
    const stats = { gamesPlayed: 0, wins: 0, bankruptcies: 0, auctionWins: 0, rentCollected: 0, eventSurvival: 0, casinoNet: 0, marketProfit: 0, playerLoansGiven: 0, playerLoansRepaid: 0, playerLoanDefaults: 0, equityDeals: 0, bankLoansTaken: 0, bankLoanRepayments: 0, bankLoanDefaults: 0, patrolBest: Number(account.stats?.patrolBest) || 0, patrolAceRuns: Number(account.stats?.patrolAceRuns) || 0 };
    const records = (account.matchHistory || []).filter(record => Date.parse(record.completedAt || '') >= since);
    records.forEach(record => {
      const participant = (record.participants || []).find(entry => entry.accountId === account.id);
      if (!participant) return;
      stats.gamesPlayed += 1;
      if (participant.finalPlacement === 1) stats.wins += 1;
      if (participant.bankrupt) stats.bankruptcies += 1;
      stats.auctionWins += Number(participant.auctionWins) || 0;
      stats.rentCollected += Number(participant.rentCollected) || 0;
      stats.eventSurvival += Number(participant.globalEventsSurvived) || 0;
      stats.bankLoansTaken += Number(participant.bankLoanCount) || 0;
      if (participant.bankLoanStatus === 'paid') stats.bankLoanRepayments += 1;
      if (participant.bankLoanStatus === 'defaulted') stats.bankLoanDefaults += 1;
      stats.casinoNet += Number(participant.casinoNet) || 0;
      const market = (record.market || []).find(entry => entry.accountId === account.id);
      stats.marketProfit += Object.values(market?.positions || {}).reduce((sum, position) => sum + (Number(position.realizedPnl) || 0), 0);
      const contracts = record.playerContracts || [];
      stats.playerLoansGiven += contracts.filter(contract => contract.fromAccountId === account.id && contract.kind === 'loan').length;
      stats.playerLoansRepaid += contracts.filter(contract => contract.toAccountId === account.id && contract.kind === 'loan' && contract.status === 'paid').length;
      stats.playerLoanDefaults += contracts.filter(contract => contract.toAccountId === account.id && contract.kind === 'loan' && contract.status === 'defaulted').length;
      stats.equityDeals += contracts.filter(contract => contract.kind === 'equity' && (contract.fromAccountId === account.id || contract.toAccountId === account.id)).length;
    });
    return stats;
  }

  getLeaderboard(metric = 'wins', options = {}) {
    const accounts = [...this.accounts.values()].filter(account => !Array.isArray(options.accountIds) || options.accountIds.includes(account.id));
    const rows = accounts.map(account => {
      const stats = this.getWindowStats(account, options.since || null);
      const achievements = Array.isArray(account.achievements) ? account.achievements : [];
      const achievementCount = options.since ? achievements.filter(entry => Date.parse(entry.unlockedAt || '') >= options.since).length : achievements.length;
      const achievementScore = achievements.reduce((sum, entry) => sum + achievementPoints(entry, options.since || null), 0);
      const mythicalCount = achievements.filter(entry => MYTHICAL_ACHIEVEMENT_IDS.has(entry.id) && (!options.since || Date.parse(entry.unlockedAt || '') >= options.since)).length;
      if (metric === 'rate' && Number(stats.gamesPlayed) < 5) return null;
      const value = metric === 'games' ? Number(stats.gamesPlayed) || 0
        : metric === 'rate' ? (Number(stats.gamesPlayed) ? Math.round(((Number(stats.wins) || 0) / Number(stats.gamesPlayed)) * 100) : 0)
          : metric === 'achievements' ? achievementScore
            : metric === 'mythical' ? mythicalCount
            : metric === 'bankruptcies' ? Number(stats.bankruptcies) || 0
              : metric === 'events' ? Number(stats.eventSurvival) || 0
                : metric === 'auctions' ? Number(stats.auctionWins) || 0
                  : metric === 'rent' ? Number(stats.rentCollected) || 0
              : metric === 'casino' ? Number(stats.casinoNet) || 0
                      : metric === 'market' ? Number(stats.marketProfit) || 0
                        : metric === 'playerloans' ? Number(stats.playerLoansGiven) || 0
              : metric === 'equity' ? Number(stats.equityDeals) || 0
                : metric === 'patrol' ? Number(stats.patrolBest) || 0
                : metric === 'loans' ? Math.max(0, (Number(stats.bankLoanRepayments) || 0) * 2 - (Number(stats.bankLoanDefaults) || 0) * 3)
                : Number(stats.wins) || 0;
      return { accountId: account.id, displayName: account.displayName, username: account.username, color: account.color, avatarGrid: account.avatarGrid, value, games: Number(stats.gamesPlayed) || 0, wins: Number(stats.wins) || 0, achievements: achievementCount, achievementScore, mythical: mythicalCount, bankLoanRepayments: Number(stats.bankLoanRepayments) || 0, bankLoanDefaults: Number(stats.bankLoanDefaults) || 0 };
    }).filter(Boolean);
    rows.sort((a, b) => b.value - a.value || b.wins - a.wins || a.displayName.localeCompare(b.displayName));
    return rows.slice(0, 100);
  }

  getLeaderboardSnapshot(metrics = ['wins', 'rate', 'games', 'achievements', 'mythical', 'bankruptcies', 'events', 'auctions', 'rent', 'casino', 'market', 'playerloans', 'equity', 'loans', 'patrol'], options = {}) {
    const allowed = metrics.filter(metric => ['wins', 'rate', 'games', 'achievements', 'mythical', 'bankruptcies', 'events', 'auctions', 'rent', 'casino', 'market', 'playerloans', 'equity', 'loans', 'patrol'].includes(metric));
    const selected = allowed.length ? [...new Set(allowed)] : ['wins', 'rate', 'games', 'achievements', 'mythical', 'bankruptcies', 'events', 'auctions', 'rent', 'casino', 'market', 'playerloans', 'equity', 'loans', 'patrol'];
    return {
      generatedAt: new Date().toISOString(),
      metrics: Object.fromEntries(selected.map(metric => [metric, this.getLeaderboard(metric, options)])),
    };
  }
}

function sanitizePrivacy(value) {
  return {
    history: ['public', 'friends', 'private'].includes(value?.history) ? value.history : 'friends',
    achievements: value?.achievements === 'private' ? 'private' : 'friends',
    friendRequests: ['everyone', 'friends', 'nobody'].includes(value?.friendRequests) ? value.friendRequests : 'everyone',
    roomInvites: ['friends', 'nobody'].includes(value?.roomInvites) ? value.roomInvites : 'friends'
  };
}
