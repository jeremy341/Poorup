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

export class RetiredAccountStore {
  constructor({ seasonsPath, cosmeticsPath } = {}) {
    this.paths = { seasons: seasonsPath || '', cosmetics: cosmeticsPath || '' };
  }

  snapshot() {
    return Object.fromEntries(Object.entries(this.paths).map(([name, filePath]) => [
      name,
      filePath ? (() => {
        try { return { exists: true, bytes: fs.readFileSync(filePath, 'utf8') }; }
        catch (error) { if (error?.code === 'ENOENT') return { exists: false, bytes: null }; throw error; }
      })() : { exists: false, bytes: null },
    ]));
  }

  restoreSnapshot(snapshot) {
    for (const [name, saved] of Object.entries(snapshot || {})) {
      const filePath = this.paths[name];
      if (filePath && saved?.exists && typeof saved.bytes === 'string') fs.writeFileSync(filePath, saved.bytes, 'utf8');
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
    const seasons = (seasonsFile.value || []).flatMap(season => {
      if (!season || typeof season !== 'object' || Array.isArray(season)) return [];
      const standing = safeStanding(ownRecord(season.standings, id));
      const claims = ownRecord(season.claims, id);
      if (!standing && !Array.isArray(claims)) return [];
      return [{
        id: typeof season.id === 'string' ? season.id.slice(0, 32) : '',
        ...(standing ? { standing } : {}),
        claimedRewardIds: Array.isArray(claims) ? claims.filter(item => typeof item === 'string').slice(0, 64) : [],
      }];
    });
    if (seasons.length) output.seasons = seasons;
    return output;
  }

  purgeAccount(accountId) {
    const id = safeId(accountId);
    if (!id) return false;
    let changed = false;
    const cosmeticsFile = readExistingJson(this.paths.cosmetics, value => value && typeof value === 'object' && !Array.isArray(value));
    if (cosmeticsFile.exists && Object.prototype.hasOwnProperty.call(cosmeticsFile.value, id)) {
      delete cosmeticsFile.value[id];
      writeJson(this.paths.cosmetics, cosmeticsFile.value);
      changed = true;
    }
    const seasonsFile = readExistingJson(this.paths.seasons, Array.isArray);
    if (seasonsFile.exists) {
      let seasonsChanged = false;
      for (const season of seasonsFile.value) {
        if (!season || typeof season !== 'object' || Array.isArray(season)) continue;
        for (const section of ['standings', 'claims']) {
          if (season[section] && Object.prototype.hasOwnProperty.call(season[section], id)) {
            delete season[section][id];
            seasonsChanged = true;
          }
        }
      }
      if (seasonsChanged) {
        writeJson(this.paths.seasons, seasonsFile.value);
        changed = true;
      }
    }
    return changed;
  }
}
