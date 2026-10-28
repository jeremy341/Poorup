// Ruleset and board contracts live in one small registry, so rooms, summaries, bots, history and the client all resolve the same immutable configuration.
// Pure: no socket, store or GameState imports. Room creation and the room-setting setter both decide what a legal value is, and
// the vocabularies live in roomSettings.js, so the two doors cannot drift into disagreeing about the same payload.
import {
  GLOBAL_EVENT_ON_VALUES,
  ROOM_FLAG_TRUE_VALUES,
  SETTING_REJECTED,
  boundedInteger,
  floorSettingAtZero,
  isPlainOverrideValue,
  normalizeItemRewards,
  stripRetiredRoomSettings
} from './roomSettings.js';

const RULESET_REVISION = 2;
const BALANCE_REVISION = 1;
const BOARD_VARIANTS = ['standard-40', 'metro-52', 'grand-64'];
const EXPOSED_BOARD_VARIANTS = ['standard-40', 'metro-52'];
const MARKET_COMPLEXITIES = ['basic', 'margin', 'shorting', 'derivatives'];
const BANK_LOAN_SEVERITIES = ['fair', 'predatory', 'extreme'];

// The optional Poorup systems. Every table starts with all of them off; a host
// turns each one on through a room override. Legacy room settings are kept in
// the underlying room object, while the effective map is the authority.
const ADD_ON_DEFAULTS = Object.freeze({
  itemRewards: false,
  bankLoans: false,
  casino: false,
  market: false,
  marketComplexity: 'basic',
  globalEvents: false,
  flights: false,
  bankAccountUpgrades: false
});

const OPTIONAL_SYSTEM_KEYS = Object.keys(ADD_ON_DEFAULTS);
// marketComplexity is an add-on key too but is not a flag, so the boolean
// overrides table takes its members from this filtered view.
const OPTIONAL_BOOLEAN_SYSTEM_KEYS = OPTIONAL_SYSTEM_KEYS.filter(key => typeof ADD_ON_DEFAULTS[key] === 'boolean');

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
  'playerFinance',
  'doubleRent',
  'vacationCash',
  'auction',
  'trading',
  'doubleGo',
  'noRentWhileInPrison',
  'mortgage',
  'evenBuild',
  'randomizePlayerOrder',
  'bankruptMode',
  'bankLoanSeverity',
  'startingCash',
  'bots',
  'botBrain',
  'botDifficulty'
]);
const HISTORICAL_OVERRIDE_KEYS = new Set([...KNOWN_OVERRIDE_KEYS, 'turnTimer']);

const BOOLEAN_OVERRIDE_KEYS = new Set([
  ...OPTIONAL_BOOLEAN_SYSTEM_KEYS,
  'playerFinance',
  'doubleRent',
  'vacationCash',
  'auction',
  'trading',
  'doubleGo',
  'noRentWhileInPrison',
  'mortgage',
  'evenBuild',
  'randomizePlayerOrder'
]);
const NUMERIC_OVERRIDE_KEYS = new Set(['startingCash']);
const NUMERIC_OVERRIDE_LIMITS = Object.freeze({
  startingCash: [0, 1_000_000]
});

function safeBoardVariant(value, fallback = 'standard-40') {
  const normalized = String(value || '').trim().toLowerCase();
  return EXPOSED_BOARD_VARIANTS.includes(normalized) ? normalized : fallback;
}

function safeMarketComplexity(value, fallback = 'basic') {
  const normalized = String(value || '').trim().toLowerCase();
  return MARKET_COMPLEXITIES.includes(normalized) ? normalized : fallback;
}

function primitive(value) {
  if (value === null) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  return String(value);
}

function normalizedOverrideValue(key, value) {
  if (key === 'itemRewards') {
    const normalized = normalizeItemRewards(value);
    return normalized === SETTING_REJECTED ? null : normalized;
  }
  if (key === 'bankruptMode') return 'elim';
  if (key === 'bankLoanSeverity') {
    const normalized = String(value || '').trim().toLowerCase();
    return BANK_LOAN_SEVERITIES.includes(normalized) ? normalized : 'predatory';
  }
  if (BOOLEAN_OVERRIDE_KEYS.has(key)) {
    // Truthiness is the setter's vocabulary, not a second spelling list: the
    // extended globalEvents spellings are the one place the two doors can
    // invert, turning 'rare' ON through the setter and OFF through creation.
    const truthyValues = key === 'globalEvents' ? GLOBAL_EVENT_ON_VALUES : ROOM_FLAG_TRUE_VALUES;
    return truthyValues.includes(value);
  }
  if (key === 'turnTimer') return boundedInteger(value, { min: 0, max: 3_600, fallback: null });
  if (key === 'bots') {
    // The setter clamps bots against the room's live seat count, which a pure registry cannot see. Creation therefore applies the same zero floor
    // and lets effectiveSettingsFor clamp against the board's seat ceiling. A range check here would reject what the setter silently clamps.
    const floored = floorSettingAtZero(value);
    return floored === SETTING_REJECTED ? null : floored;
  }
  if (key === 'marketComplexity') return safeMarketComplexity(value);
  if (NUMERIC_OVERRIDE_KEYS.has(key)) {
    const [min, max] = NUMERIC_OVERRIDE_LIMITS[key];
    return boundedInteger(value, { min, max, fallback: null });
  }
  if (typeof value === 'string') return value.trim().slice(0, 80);
  return primitive(value);
}

function overrideSource(overrides) {
  if (Array.isArray(overrides)) return Object.fromEntries(overrides.map(entry => [entry?.key, entry?.value]));
  if (overrides && typeof overrides === 'object') return overrides;
  return {};
}

function normalizeOverrides(overrides) {
  const source = overrideSource(overrides);
  const normalized = {};
  Object.keys(source).sort().forEach(key => {
    if (!HISTORICAL_OVERRIDE_KEYS.has(key)) return;
    const raw = source[key];
    if (!isPlainOverrideValue(raw)) return;
    const value = normalizedOverrideValue(key, source[key]);
    if (value !== null && value !== undefined) normalized[key] = value;
  });
  return normalized;
}

function overrideList(overrides) {
  return Object.keys(overrides).sort().map(key => ({ key, value: overrides[key] }));
}

function effectiveSettingsFor({ rulesetOverrides, settings = {}, boardVariant = 'standard-40' } = {}) {
  const overrides = normalizeOverrides(rulesetOverrides);
  const effective = stripRetiredRoomSettings(settings);
  ['rulesetOverrides', 'boardVariant', 'rulesetRevision', 'balanceRevision', 'effectiveSettings', 'digest', 'globalEventDuration', 'globalEventMax', 'botPersonality'].forEach(key => delete effective[key]);
  if (Object.hasOwn(effective, 'botBrain')) {
    const brain = String(effective.botBrain || '').trim().toLowerCase().replace('_', '-');
    effective.botBrain = brain === 'no-ai' ? 'no-ai' : 'ai';
  }
  Object.entries(ADD_ON_DEFAULTS).forEach(([key, value]) => {
    effective[key] = value;
  });
  Object.assign(effective, overrides);
  // Profiles choose starting defaults; explicit settings and normalized
  // overrides remain authoritative for each independently configurable rule.
  // The profile itself is metadata, so it cannot be smuggled as an override.
  effective.rulesProfile = settings.rulesProfile === 'advanced' ? 'advanced' : 'standard';
  effective.playerFinance = Object.hasOwn(overrides, 'playerFinance') ? overrides.playerFinance
    : Object.hasOwn(settings, 'playerFinance') ? ROOM_FLAG_TRUE_VALUES.includes(settings.playerFinance)
      : effective.rulesProfile === 'advanced';
  // Bankruptcy is a single authoritative elimination/spectator lifecycle;
  // legacy snapshots cannot re-enable the removed debt-deal mode.
  effective.bankruptMode = 'elim';
  const normalizedSeverity = String(effective.bankLoanSeverity || '').trim().toLowerCase();
  effective.bankLoanSeverity = BANK_LOAN_SEVERITIES.includes(normalizedSeverity) ? normalizedSeverity : 'predatory';
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
  const boardVariant = safeBoardVariant(input.boardVariant);
  const overrides = normalizeOverrides(input.rulesetOverrides);
  const effectiveSettings = effectiveSettingsFor({
    ...input,
    settings: input.effectiveSettings || input.settings || {},
    boardVariant,
    rulesetOverrides: overrides
  });
  return stableSerialize({
    revision: Number(input.rulesetRevision) || RULESET_REVISION,
    balanceRevision: BALANCE_REVISION,
    rulesetOverrides: overrideList(overrides),
    boardVariant,
    effectiveSettings
  });
}

function resolveRuleset(input = {}) {
  const boardVariant = safeBoardVariant(input.boardVariant);
  const rulesetOverrides = normalizeOverrides(input.rulesetOverrides);
  const effectiveSettings = effectiveSettingsFor({ ...input, boardVariant, rulesetOverrides });
  const resolved = {
    rulesetOverrides: overrideList(rulesetOverrides),
    boardVariant,
    rulesetRevision: RULESET_REVISION,
    balanceRevision: BALANCE_REVISION,
    effectiveSettings,
    digest: createRulesetDigest({ rulesetOverrides, boardVariant, rulesetRevision: RULESET_REVISION, effectiveSettings })
  };
  return Object.freeze({ ...resolved, effectiveSettings: Object.freeze({ ...effectiveSettings }), rulesetOverrides: Object.freeze([...resolved.rulesetOverrides]) });
}

function boardVariantMeta(value) {
  return BOARD_VARIANT_META[safeBoardVariant(value)];
}

export class RulesetRegistry {
  resolve(input = {}) { return resolveRuleset(input); }
  digest(input = {}) { return createRulesetDigest(input); }
  boards() { return EXPOSED_BOARD_VARIANTS.map(id => ({ ...BOARD_VARIANT_META[id] })); }
}

export {
  BALANCE_REVISION,
  BOARD_VARIANTS,
  BOARD_VARIANT_META,
  EXPOSED_BOARD_VARIANTS,
  KNOWN_OVERRIDE_KEYS,
  HISTORICAL_OVERRIDE_KEYS,
  MARKET_COMPLEXITIES,
  ADD_ON_DEFAULTS,
  OPTIONAL_SYSTEM_KEYS,
  RULESET_REVISION,
  boardVariantMeta,
  createRulesetDigest,
  effectiveSettingsFor,
  normalizeOverrides,
  resolveRuleset,
  safeBoardVariant,
  safeMarketComplexity,
  stableSerialize
};
