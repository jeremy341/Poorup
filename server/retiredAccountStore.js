import fs from 'node:fs';
import { writeJson } from './storeIO.js';

const STANDING_FIELDS = [
  'games', 'wins', 'points', 'participation', 'mastery', 'fairTrades',
  'eventSurvival', 'debtDiscipline', 'mythical', 'bankruptcies',
  'auctionWins', 'rentCollected', 'casinoNet', 'marketProfit',
  'playerLoansGiven', 'equityDeals', 'patrolBest', 'lastMatchAt',
];

function safeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 ? value : '';
}

function readExistingJson(filePath, expected) {
  if (!filePath) return { exists: false, value: null, bytes: null };
  let bytes;
  try {
    bytes = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, value: null, bytes: null };
    throw error;
  }
  const value = JSON.parse(bytes);
  if (!expected(value)) throw new Error(`Legacy account data is invalid in ${filePath}.`);
  return { exists: true, value, bytes };
}

function ownRecord(value, id) {
  return value && Object.prototype.hasOwnProperty.call(value, id) ? value[id] : undefined;
}

function exportSeasonRecord(season, accountId) {
  if (!season || typeof season !== 'object' || Array.isArray(season)) return null;
  const standing = safeStanding(ownRecord(season.standings, accountId));
  const claims = ownRecord(season.claims, accountId);
  if (!standing && !Array.isArray(claims)) return null;
  return {
    id: typeof season.id === 'string' ? season.id.slice(0, 32) : '',
    ...(standing ? { standing } : {}),
    claimedRewardIds: Array.isArray(claims) ? claims.filter(item => typeof item === 'string').slice(0, 64) : [],
  };
}

function exportSeasonRecords(seasons, accountId) {
  return (seasons || []).map(season => exportSeasonRecord(season, accountId)).filter(Boolean);
}

function purgeCosmeticRecord(filePath, accountId) {
  const file = readExistingJson(filePath, value => value && typeof value === 'object' && !Array.isArray(value));
  if (!file.exists || !Object.prototype.hasOwnProperty.call(file.value, accountId)) return false;
  delete file.value[accountId];
  writeJson(filePath, file.value);
  return true;
}

function purgeAccountSection(section, accountId) {
  if (!section || !Object.prototype.hasOwnProperty.call(section, accountId)) return false;
  delete section[accountId];
  return true;
}

function purgeSeasonRecord(season, accountId) {
  if (!season || typeof season !== 'object' || Array.isArray(season)) return false;
  const standingChanged = purgeAccountSection(season.standings, accountId);
  const claimsChanged = purgeAccountSection(season.claims, accountId);
  return standingChanged || claimsChanged;
}

function purgeSeasonRecords(filePath, accountId) {
  const file = readExistingJson(filePath, Array.isArray);
  if (!file.exists) return false;
  let changed = false;
  for (const season of file.value) {
    changed = purgeSeasonRecord(season, accountId) || changed;
  }
  if (!changed) return false;
  writeJson(filePath, file.value);
  return true;
}

function safeCosmeticData(account) {
  if (!account || typeof account !== 'object' || Array.isArray(account)) return null;
  const owned = Array.isArray(account.owned) ? account.owned.filter(item => typeof item === 'string').slice(0, 200) : [];
  const equipped = account.equipped && typeof account.equipped === 'object' && !Array.isArray(account.equipped)
    ? Object.fromEntries(Object.entries(account.equipped).filter(([slot, item]) => typeof slot === 'string' && typeof item === 'string').slice(0, 20))
    : {};
  const tokens = Number(account.tokens);
  return { tokens: Number.isFinite(tokens) ? Math.max(0, Math.min(100000, Math.floor(tokens))) : 0, owned, equipped };
}

function safeStanding(standing) {
  if (!standing || typeof standing !== 'object' || Array.isArray(standing)) return null;
  const output = {};
  for (const key of STANDING_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(standing, key)) continue;
    const value = standing[key];
    if (key === 'lastMatchAt') {
      output[key] = typeof value === 'string' ? value.slice(0, 40) : null;
    } else if (Number.isFinite(Number(value))) {
      output[key] = Number(value);
    }
  }
  return output;
}

function snapshotFile(filePath) {
  if (!filePath) return { exists: false, bytes: null };
  try { return { exists: true, bytes: fs.readFileSync(filePath, 'utf8') }; }
  catch (error) { if (error?.code === 'ENOENT') return { exists: false, bytes: null }; throw error; }
}

function restoreFile(filePath, saved) {
  if (filePath && saved?.exists && typeof saved.bytes === 'string') fs.writeFileSync(filePath, saved.bytes, 'utf8');
}

export class RetiredAccountStore {
  constructor({ seasonsPath, cosmeticsPath } = {}) {
    this.paths = { seasons: seasonsPath || '', cosmetics: cosmeticsPath || '' };
  }

  snapshot() {
    return Object.fromEntries(Object.entries(this.paths).map(([name, filePath]) => [
      name,
      snapshotFile(filePath),
    ]));
  }

  restoreSnapshot(snapshot) {
    for (const [name, saved] of Object.entries(snapshot || {})) {
      restoreFile(this.paths[name], saved);
    }
  }

  exportForAccount(accountId) {
    const id = safeId(accountId);
    if (!id) return {};
    const cosmeticsFile = readExistingJson(this.paths.cosmetics, value => value && typeof value === 'object' && !Array.isArray(value));
    const seasonsFile = readExistingJson(this.paths.seasons, Array.isArray);
    const output = {};
    const cosmetics = safeCosmeticData(ownRecord(cosmeticsFile.value, id));
    if (cosmetics) output.cosmetics = cosmetics;
    const seasons = exportSeasonRecords(seasonsFile.value, id);
    if (seasons.length) output.seasons = seasons;
    return output;
  }

  purgeAccount(accountId) {
    const id = safeId(accountId);
    if (!id) return false;
    const cosmeticsChanged = purgeCosmeticRecord(this.paths.cosmetics, id);
    const seasonsChanged = purgeSeasonRecords(this.paths.seasons, id);
    return cosmeticsChanged || seasonsChanged;
  }
}
