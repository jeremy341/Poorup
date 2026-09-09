// Ruleset and board contracts live in one small registry so rooms, summaries,
// bots, history, and the client all resolve the same immutable configuration.
// This is deliberately pure: it has no socket, store, or GameState imports.

const RULESET_REVISION = 1;
const BALANCE_REVISION = 1;
const RULESET_PRESETS = ['classic', 'after-hours', 'custom'];
const RULESET_BASES = ['classic', 'after-hours'];
const BOARD_VARIANTS = ['standard-40', 'metro-52', 'grand-64'];
const EXPOSED_BOARD_VARIANTS = ['standard-40', 'metro-52'];
const MARKET_COMPLEXITIES = ['basic', 'margin', 'shorting', 'derivatives'];

// These are the optional Poorup systems. Legacy room settings are retained in
// the underlying room object, while the effective map is the authority for a
// room created through the ruleset flow.
const OPTIONAL_SYSTEM_KEYS = ['bankLoans', 'casino', 'market', 'globalEvents'];

const PRESET_DEFAULTS = Object.freeze({
  classic: Object.freeze({
    bankLoans: false,
    casino: false,
    market: false,
    marketComplexity: 'basic',
    globalEvents: false
  }),
  'after-hours': Object.freeze({
    bankLoans: true,
    casino: true,
    market: true,
    marketComplexity: 'basic',
    globalEvents: true
  })
});

const BOARD_VARIANT_META = Object.freeze({
  'standard-40': Object.freeze({
    id: 'standard-40',
    label: 'STANDARD 40',
    spaces: 40,
    spacesPerSide: 10,
    corners: [0, 10, 20, 30],
    minPlayers: 2,
    maxPlayers: 4,
    exposed: true,
    status: 'stable'
  }),
  'metro-52': Object.freeze({
    id: 'metro-52',
    label: 'METRO 52',
    spaces: 52,
    spacesPerSide: 13,
    corners: [0, 13, 26, 39],
    minPlayers: 2,
    maxPlayers: 6,
    exposed: true,
    status: 'preview'
  }),
  'grand-64': Object.freeze({
    id: 'grand-64',
    label: 'GRAND 64',
    spaces: 64,
    spacesPerSide: 16,
    corners: [0, 16, 32, 48],
    minPlayers: 2,
    maxPlayers: 8,
    exposed: false,
    status: 'reserved'
  })
});

const KNOWN_OVERRIDE_KEYS = new Set([
  ...OPTIONAL_SYSTEM_KEYS,
  'marketComplexity',
  'doubleRent',
  'vacationCash',
  'auction',
  'trading',
  'doubleGo',
  'noRentWhileInPrison',
  'mortgage',
  'evenBuild',
  'randomizePlayerOrder',
  'houseLimit',
  'hotelLimit',
  'turnTimer',
  'bankruptMode',
  'startingCash',
  'bots',
  'botPersonality',
  'botBrain',
  'botDifficulty'
]);

function safePreset(value, fallback = 'classic') {
  const normalized = String(value || '').trim().toLowerCase();
  return RULESET_PRESETS.includes(normalized) ? normalized : fallback;
}

function safeBase(value, fallback = 'classic') {
  const normalized = String(value || '').trim().toLowerCase();
  return RULESET_BASES.includes(normalized) ? normalized : fallback;
}

function safeBoardVariant(value, fallback = 'standard-40') {
  const normalized = String(value || '').trim().toLowerCase();
  return EXPOSED_BOARD_VARIANTS.includes(normalized) ? normalized : fallback;
}

function safeMarketComplexity(value, fallback = 'basic') {
  const normalized = String(value || '').trim().toLowerCase();
  return MARKET_COMPLEXITIES.includes(normalized) ? normalized : fallback;
}

function primitive(value) {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' || value === null) return value;
  return String(value);
}

function normalizedOverrideValue(key, value) {
  if (OPTIONAL_SYSTEM_KEYS.includes(key) || ['doubleRent', 'vacationCash', 'auction', 'trading', 'doubleGo', 'noRentWhileInPrison', 'mortgage', 'evenBuild', 'randomizePlayerOrder'].includes(key)) {
    return value === true || value === 1 || ['true', '1', 'on'].includes(String(value).trim().toLowerCase());
  }
  if (key === 'marketComplexity') return safeMarketComplexity(value);
  if (['maxPlayers', 'houseLimit', 'hotelLimit', 'turnTimer', 'startingCash', 'bots'].includes(key)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
  }
  if (typeof value === 'string') return value.trim().slice(0, 80);
  return primitive(value);
}

function normalizeOverrides(overrides) {
  const source = Array.isArray(overrides)
    ? Object.fromEntries(overrides.map(entry => [entry?.key, entry?.value]))
    : (overrides && typeof overrides === 'object' ? overrides : {});
  const normalized = {};
  Object.keys(source).sort().forEach(key => {
    if (!KNOWN_OVERRIDE_KEYS.has(key)) return;
    const value = normalizedOverrideValue(key, source[key]);
    if (value !== null && value !== undefined) normalized[key] = value;
  });
  return normalized;
}

function overrideList(overrides) {
  return Object.keys(overrides).sort().map(key => ({ key, value: overrides[key] }));
}

function effectiveSettingsFor({ rulesetPreset = 'classic', rulesetBase, rulesetOverrides, settings = {}, boardVariant = 'standard-40' } = {}) {
  const requestedPreset = safePreset(rulesetPreset);
  const base = safeBase(rulesetBase || (requestedPreset === 'after-hours' ? 'after-hours' : 'classic'));
  const overrides = normalizeOverrides(rulesetOverrides);
  const effective = { ...settings };
  ['rulesetPreset', 'rulesetBase', 'rulesetOverrides', 'boardVariant', 'rulesetRevision', 'balanceRevision', 'effectiveSettings', 'digest', 'globalEventDuration', 'globalEventMax'].forEach(key => delete effective[key]);
  const presetDefaults = PRESET_DEFAULTS[base] || PRESET_DEFAULTS.classic;
  Object.entries(presetDefaults).forEach(([key, value]) => {
    // A Custom room inherits its selected base before applying explicit
    // overrides; it must not accidentally fall back to legacy Classic flags.
    effective[key] = value;
  });
  if (requestedPreset === 'custom') Object.assign(effective, overrides);
  else Object.assign(effective, overrides);
  effective.marketComplexity = safeMarketComplexity(effective.marketComplexity);
  const board = safeBoardVariant(boardVariant);
  const meta = BOARD_VARIANT_META[board];
  const maxPlayers = Math.max(meta.minPlayers, Math.min(meta.maxPlayers, Number(effective.maxPlayers) || meta.maxPlayers));
  effective.maxPlayers = maxPlayers;
  effective.bots = Math.min(Math.max(0, Number(effective.bots) || 0), maxPlayers - 1);
  return effective;
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createRulesetDigest(input = {}) {
  const preset = safePreset(input.rulesetPreset);
  const base = safeBase(input.rulesetBase || (preset === 'after-hours' ? 'after-hours' : 'classic'));
  const boardVariant = safeBoardVariant(input.boardVariant);
  const overrides = normalizeOverrides(input.rulesetOverrides);
  const effectiveSettings = input.effectiveSettings
    ? { ...input.effectiveSettings }
    : effectiveSettingsFor({ ...input, rulesetPreset: preset, rulesetBase: base, boardVariant, rulesetOverrides: overrides });
  return stableSerialize({
    revision: Number(input.rulesetRevision) || RULESET_REVISION,
    balanceRevision: BALANCE_REVISION,
    rulesetPreset: preset,
    rulesetBase: base,
    rulesetOverrides: overrideList(overrides),
    boardVariant,
    effectiveSettings
  });
}

function resolveRuleset(input = {}) {
  const rulesetPreset = safePreset(input.rulesetPreset);
  const rulesetBase = safeBase(input.rulesetBase || (rulesetPreset === 'after-hours' ? 'after-hours' : 'classic'));
  const boardVariant = safeBoardVariant(input.boardVariant);
  const rulesetOverrides = normalizeOverrides(input.rulesetOverrides);
  const effectiveSettings = effectiveSettingsFor({ ...input, rulesetPreset, rulesetBase, boardVariant, rulesetOverrides });
  const resolved = {
    rulesetPreset,
    rulesetBase,
    rulesetOverrides: overrideList(rulesetOverrides),
    boardVariant,
    rulesetRevision: RULESET_REVISION,
    balanceRevision: BALANCE_REVISION,
    effectiveSettings,
    digest: createRulesetDigest({ rulesetPreset, rulesetBase, rulesetOverrides, boardVariant, rulesetRevision: RULESET_REVISION, effectiveSettings })
  };
  return Object.freeze({ ...resolved, effectiveSettings: Object.freeze({ ...effectiveSettings }), rulesetOverrides: Object.freeze([...resolved.rulesetOverrides]) });
}

function boardVariantMeta(value) {
  return BOARD_VARIANT_META[safeBoardVariant(value)];
}

export class RulesetRegistry {
  resolve(input = {}) { return resolveRuleset(input); }
  digest(input = {}) { return createRulesetDigest(input); }
  presets() { return RULESET_PRESETS.slice(); }
  boards() { return EXPOSED_BOARD_VARIANTS.map(id => ({ ...BOARD_VARIANT_META[id] })); }
}

export {
  BALANCE_REVISION,
  BOARD_VARIANTS,
  BOARD_VARIANT_META,
  EXPOSED_BOARD_VARIANTS,
  KNOWN_OVERRIDE_KEYS,
  MARKET_COMPLEXITIES,
  OPTIONAL_SYSTEM_KEYS,
  PRESET_DEFAULTS,
  RULESET_BASES,
  RULESET_PRESETS,
  RULESET_REVISION,
  boardVariantMeta,
  createRulesetDigest,
  effectiveSettingsFor,
  normalizeOverrides,
  resolveRuleset,
  safeBoardVariant,
  safeMarketComplexity,
  safePreset,
  stableSerialize
};
