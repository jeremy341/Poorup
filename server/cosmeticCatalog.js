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
  { id: 'token-border-brass', type: 'token-border', name: 'BRASS BORDER', rarity: 'UNCOMMON', cost: 120, description: 'A brass edge around your board token.' },
  { id: 'stamp-parlor-star', type: 'victory-stamp', name: 'PARLOR STAR', rarity: 'LEGENDARY', cost: 0, description: 'A pixel star stamped after a top-percentile season.' },
  { id: 'title-night-shift', type: 'profile-title', name: 'NIGHT SHIFT', rarity: 'UNCOMMON', cost: 0, description: 'For players who kept the table moving.' },
  { id: 'emote-ledger-nod', type: 'chat-emote', name: 'LEDGER NOD', rarity: 'COMMON', cost: 90, description: 'A compact table emote for a clean deal.' },
  { id: 'achievement-frame-echo', type: 'achievement-frame', name: 'ECHO FRAME', rarity: 'EPIC', cost: 260, description: 'A frame reserved for the achievement shelf.' },
  { id: 'board-ink-grid', type: 'board-skin', name: 'INK GRID', rarity: 'RARE', cost: 300, description: 'A dark ink board treatment. Cosmetic only.' },
  { id: 'cardback-signal', type: 'card-back', name: 'SIGNAL BACK', rarity: 'UNCOMMON', cost: 180, description: 'A striped signal back for your decks.' },
  { id: 'dice-brass', type: 'dice-face', name: 'BRASS PIPS', rarity: 'RARE', cost: 240, description: 'Brass pips with the Poorup mark.' },
  { id: 'trail-reduced', type: 'token-trail', name: 'LOW CURRENT', rarity: 'EPIC', cost: 420, description: 'A restrained trail that respects reduced-motion settings.' }
]);
const COSMETIC_SLOTS = new Set(COSMETIC_CATALOG.map(item => item.type));

function safeId(value, max = 120) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : '';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAccount(source = {}) {
  const owned = Array.isArray(source.owned) ? [...new Set(source.owned.filter(id => typeof id === 'string').slice(0, 200))] : [];
  const equipped = source.equipped && typeof source.equipped === 'object'
    ? Object.fromEntries(Object.entries(source.equipped).filter(([slot, id]) => COSMETIC_SLOTS.has(slot) && typeof id === 'string' && owned.includes(id)))
    : {};
  return {
    tokens: Math.max(0, Math.floor(Number(source.tokens) || 0)),
    owned: [...new Set(owned)],
    equipped,
    claims: Array.isArray(source.claims) ? source.claims.filter(id => typeof id === 'string').slice(0, 300) : []
  };
}

function claimResponse(store, accountId, item, created) {
  return { success: true, created, item: { ...item }, snapshot: store.snapshot(accountId) };
}

function claimContext(store, accountId, cosmeticId, options) {
  const account = store.account(accountId);
  const item = COSMETIC_CATALOG.find(candidate => candidate.id === cosmeticId);
  const key = safeId(options.claimKey, 160);
  return { store, accountId, account, item, key, allowPaid: options.allowPaid, allowSeason: options.allowSeason };
}

function claimUnavailable(context) {
  return !context.account || !context.item ? 'Cosmetic is unavailable.' : null;
}

function replayClaim(context) {
  if (context.key && context.account.claims.includes(context.key)) return claimResponse(context.store, context.accountId, context.item, false);
  return null;
}

function ownedClaim(context) {
  if (!context.account.owned.includes(context.item.id)) return null;
  if (context.key) context.account.claims.push(context.key);
  context.store.persist();
  return claimResponse(context.store, context.accountId, context.item, false);
}

function seasonClaimError(context) {
  if (context.key.startsWith('season:') && !context.allowSeason) return 'Season cosmetics must be claimed from the active season ledger.';
  return null;
}

function freeCosmeticClaimError(context, cost) {
  if (cost === 0 && !context.key.startsWith('season:')) return 'This cosmetic must be earned through a verified season reward.';
  return null;
}

function paidCosmeticClaimError(context, cost) {
  if (cost <= 0) return null;
  if (!context.allowPaid) return 'Not enough Parlor Tokens for this cosmetic.';
  if (context.account.tokens < cost) return 'Not enough Parlor Tokens for this cosmetic.';
  return null;
}

function claimEligibilityError(context) {
  const cost = Math.max(0, Math.floor(Number(context.item.cost) || 0));
  return seasonClaimError(context)
    || freeCosmeticClaimError(context, cost)
    || paidCosmeticClaimError(context, cost);
}

function applyClaim(context) {
  const cost = Math.max(0, Math.floor(Number(context.item.cost) || 0));
  context.account.tokens -= cost;
  context.account.owned.push(context.item.id);
  if (context.key) context.account.claims = [...context.account.claims, context.key].slice(-300);
  context.store.persist();
  return claimResponse(context.store, context.accountId, context.item, true);
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
    this.accounts.forEach(account => {
      account.owned = [...new Set(account.owned.filter(id => typeof id === 'string'))].slice(0, 200);
      account.claims = [...new Set(account.claims.filter(id => typeof id === 'string'))].slice(-300);
      account.equipped = Object.fromEntries(Object.entries(account.equipped).filter(([slot, id]) => COSMETIC_SLOTS.has(slot) && account.owned.includes(id)));
    });
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
    if (!account.owned.includes(item.id)) {
      if (account.owned.length >= 200) return { success: false, error: 'Cosmetic collection is full.' };
      account.owned.push(item.id);
    }
    this.persist();
    return { success: true, created: true, item: { ...item }, snapshot: this.snapshot(accountId) };
  }

  claim(accountId, cosmeticId, { claimKey, allowPaid = true, allowSeason = false } = {}) {
    const context = claimContext(this, accountId, cosmeticId, { claimKey, allowPaid, allowSeason });
    const unavailable = claimUnavailable(context);
    if (unavailable) return { success: false, error: unavailable };
    const replay = replayClaim(context);
    if (replay) return replay;
    const owned = ownedClaim(context);
    if (owned) return owned;
    const eligibilityError = claimEligibilityError(context);
    if (eligibilityError) return { success: false, error: eligibilityError };
    return applyClaim(context);
  }

  equip(accountId, cosmeticId, slot = null) {
    const account = this.account(accountId);
    const item = COSMETIC_CATALOG.find(candidate => candidate.id === cosmeticId);
    if (!canEquip(account, item)) return { success: false, error: 'Earn the cosmetic before equipping it.' };
    const targetSlot = safeId(slot || item.type, 40);
    if (!COSMETIC_SLOTS.has(targetSlot) || targetSlot !== item.type) return { success: false, error: 'Cosmetic slot is invalid.' };
    account.equipped[targetSlot] = item.id;
    this.persist();
    return { success: true, item: { ...item }, snapshot: this.snapshot(accountId) };
  }
}

function canEquip(account, item) {
  if (!account) return false;
  if (!item) return false;
  return account.owned.includes(item.id);
}

export { COSMETIC_CATALOG, DEFAULT_FILE as COSMETIC_STORE_FILE };
