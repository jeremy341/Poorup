// Earned, non-competitive cosmetics. The catalog is deliberately data-only;
// equip state never reaches GameState legality or cash calculations.
import path from 'path';
import { fileURLToPath } from 'url';
import { loadJson, writeJson } from './storeIO.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'cosmetics.json');

const COSMETIC_CATALOG = Object.freeze([
  { id: 'frame-copper', type: 'avatar-frame', name: 'COPPER CIRCUIT', rarity: 'COMMON', cost: 0, description: 'A warm copper edge for your parlor portrait.' },
  { id: 'frame-silver', type: 'avatar-frame', name: 'SILVER SIGNAL', rarity: 'UNCOMMON', cost: 0, description: 'A cool signal frame earned through a strong season.' },
  { id: 'frame-gold', type: 'avatar-frame', name: 'GOLD LEDGER', rarity: 'RARE', cost: 0, description: 'A stamped gold frame for verified placement.' },
  { id: 'frame-ledger', type: 'avatar-frame', name: 'LEDGER BLACK', rarity: 'EPIC', cost: 0, description: 'A quiet black frame with a gold register mark.' },
  { id: 'stamp-parlor-star', type: 'victory-stamp', name: 'PARLOR STAR', rarity: 'LEGENDARY', cost: 0, description: 'A pixel star stamped after a top-percentile season.' },
  { id: 'title-night-shift', type: 'profile-title', name: 'NIGHT SHIFT', rarity: 'UNCOMMON', cost: 0, description: 'For players who kept the table moving.' },
  { id: 'board-ink-grid', type: 'board-skin', name: 'INK GRID', rarity: 'RARE', cost: 300, description: 'A dark ink board treatment. Cosmetic only.' },
  { id: 'cardback-signal', type: 'card-back', name: 'SIGNAL BACK', rarity: 'UNCOMMON', cost: 180, description: 'A striped signal back for your decks.' },
  { id: 'dice-brass', type: 'dice-face', name: 'BRASS PIPS', rarity: 'RARE', cost: 240, description: 'Brass pips with the Poorup mark.' },
  { id: 'trail-reduced', type: 'token-trail', name: 'LOW CURRENT', rarity: 'EPIC', cost: 420, description: 'A restrained trail that respects reduced-motion settings.' }
]);

function safeId(value, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAccount(source = {}) {
  const owned = Array.isArray(source.owned) ? source.owned.filter(id => typeof id === 'string').slice(0, 200) : [];
  const equipped = source.equipped && typeof source.equipped === 'object' ? { ...source.equipped } : {};
  return {
    tokens: Math.max(0, Math.floor(Number(source.tokens) || 0)),
    owned: [...new Set(owned)],
    equipped,
    claims: Array.isArray(source.claims) ? source.claims.filter(id => typeof id === 'string').slice(0, 300) : []
  };
}

export class CosmeticStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.accounts = new Map();
    this.load();
  }

  load() {
    const { value } = loadJson(this.filePath, loaded => loaded && typeof loaded === 'object' && !Array.isArray(loaded));
    if (!value) return;
    Object.entries(value).slice(0, 10000).forEach(([accountId, data]) => {
      const id = safeId(accountId);
      if (id) this.accounts.set(id, normalizeAccount(data));
    });
  }

  persist() {
    writeJson(this.filePath, Object.fromEntries(this.accounts.entries()));
  }

  account(accountId) {
    const id = safeId(accountId);
    if (!id) return null;
    if (!this.accounts.has(id)) this.accounts.set(id, normalizeAccount());
    return this.accounts.get(id);
  }

  catalog() {
    return COSMETIC_CATALOG.map(item => ({ ...item }));
  }

  snapshot(accountId) {
    const account = this.account(accountId);
    if (!account) return { tokens: 0, owned: [], equipped: {}, claims: [], catalog: this.catalog() };
    return { ...clone(account), catalog: this.catalog() };
  }

  grantTokens(accountId, amount) {
    const account = this.account(accountId);
    const value = Math.max(0, Math.min(100000, Math.floor(Number(amount) || 0)));
    if (!account || !value) return { success: false, granted: 0 };
    account.tokens += value;
    this.persist();
    return { success: true, granted: value, tokens: account.tokens };
  }

  grant(accountId, cosmeticId) {
    const account = this.account(accountId);
    const item = COSMETIC_CATALOG.find(candidate => candidate.id === cosmeticId);
    if (!account || !item) return { success: false, error: 'Cosmetic is unavailable.' };
    if (!account.owned.includes(item.id)) account.owned.push(item.id);
    this.persist();
    return { success: true, created: true, item: { ...item }, snapshot: this.snapshot(accountId) };
  }

  claim(accountId, cosmeticId, { claimKey, allowPaid = true } = {}) {
    const account = this.account(accountId);
    const item = COSMETIC_CATALOG.find(candidate => candidate.id === cosmeticId);
    const key = safeId(claimKey, 160);
    if (!account || !item) return { success: false, error: 'Cosmetic is unavailable.' };
    if (key && account.claims.includes(key)) return { success: true, created: false, item: { ...item }, snapshot: this.snapshot(accountId) };
    if (account.owned.includes(item.id)) {
      if (key) account.claims.push(key);
      this.persist();
      return { success: true, created: false, item: { ...item }, snapshot: this.snapshot(accountId) };
    }
    const cost = Math.max(0, Math.floor(Number(item.cost) || 0));
    if (cost === 0 && !key.startsWith('season:')) return { success: false, error: 'This cosmetic must be earned through a verified season reward.' };
    if (cost > 0 && (!allowPaid || account.tokens < cost)) return { success: false, error: 'Not enough Parlor Tokens for this cosmetic.' };
    account.tokens -= cost;
    account.owned.push(item.id);
    if (key) account.claims = [...account.claims, key].slice(-300);
    this.persist();
    return { success: true, created: true, item: { ...item }, snapshot: this.snapshot(accountId) };
  }

  equip(accountId, cosmeticId, slot = null) {
    const account = this.account(accountId);
    const item = COSMETIC_CATALOG.find(candidate => candidate.id === cosmeticId);
    if (!account || !item || !account.owned.includes(item.id)) return { success: false, error: 'Earn the cosmetic before equipping it.' };
    const targetSlot = safeId(slot || item.type, 40);
    account.equipped[targetSlot] = item.id;
    this.persist();
    return { success: true, item: { ...item }, snapshot: this.snapshot(accountId) };
  }
}

export { COSMETIC_CATALOG, DEFAULT_FILE as COSMETIC_STORE_FILE };
