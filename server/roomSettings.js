// Room settings vocabulary: the defaults, the per-key normalizer table, and
// the numeric clamp helpers. A raw client value passes through its key's
// normalizer before being stored on both the room and its game. A normalizer
// returns SETTING_REJECTED to leave the stored value untouched — the old early
// `return`s. Keys with no entry keep the generic rule: a setting that is
// currently boolean parses the four truthy spellings, a string is trimmed,
// and anything else is stored as received.
const DEFAULT_ROOM_SETTINGS = {
  maxPlayers: 4,
  doubleRent: false,
  vacationCash: true,
  auction: true,
  trading: true,
  doubleGo: false,
  noRentWhileInPrison: false,
  mortgage: true,
  evenBuild: true,
  randomizePlayerOrder: false,
  houseLimit: 32,
  hotelLimit: 12,
  turnTimer: 0,
  bankruptMode: 'elim',
  bots: 0,
  botPersonality: 'survivor',
  // AUTO prefers the configured AI advisor and falls back to the deterministic
  // house brain when credits, network, or provider health are unavailable.
  botBrain: 'auto',
  botDifficulty: 'table',
  startingCash: 1500,
  bankLoans: true,
  bankLoanSeverity: 'predatory',
  // Global headlines are intentionally a single on/off rule. Rarity,
  // severity, duration, and combinations are derived from the game clock.
  globalEvents: false,
  casino: false,
  market: false,
  // Ruleset metadata is stored alongside the legacy setting vocabulary so a
  // reconnect can restore the exact table contract without a second engine.
  rulesetPreset: 'classic',
  rulesetBase: 'classic',
  rulesetOverrides: [],
  boardVariant: 'standard-40',
  rulesetRevision: 1,
  marketComplexity: 'basic',
  // Kept for backwards-compatible snapshots only; client values are ignored.
  globalEventDuration: 5,
  globalEventMax: 1
};

const SETTING_REJECTED = Symbol('setting-rejected');
const ROOM_FLAG_TRUE_VALUES = [true, 'true', 1, '1'];
// Rarity spellings are accepted for globalEvents only; every other boolean
// key uses ROOM_FLAG_TRUE_VALUES.
const GLOBAL_EVENT_ON_VALUES = [true, 'true', 'on', 'rare', 'hardcore', 1, '1'];
const ROOM_BOT_PERSONALITIES = ['builder', 'shark', 'survivor', 'speculator', 'diplomat', 'chaos'];
const ROOM_BOT_BRAINS = ['auto', 'ai', 'no-ai'];
const ROOM_BOT_DIFFICULTIES = ['house', 'table', 'expert'];
const ROOM_RULESET_PRESETS = ['classic', 'after-hours', 'custom'];
const ROOM_RULESET_BASES = ['classic', 'after-hours'];
const ROOM_BOARD_VARIANTS = ['standard-40', 'metro-52'];
const ROOM_MARKET_COMPLEXITIES = ['basic', 'margin', 'shorting', 'derivatives'];
// Legacy clients may still send these fields; the server owns scaling now.
const LEGACY_SCALED_SETTINGS = ['globalEventDuration', 'globalEventMax'];

function toFiniteSettingNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : SETTING_REJECTED;
}

function clampSetting(value, min, max) {
  const parsed = toFiniteSettingNumber(value);
  if (parsed === SETTING_REJECTED) return SETTING_REJECTED;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function floorSettingAtZero(value) {
  const parsed = toFiniteSettingNumber(value);
  if (parsed === SETTING_REJECTED) return SETTING_REJECTED;
  return Math.max(0, Math.floor(parsed));
}

// The legacy duration/max knobs snap to the two-step ladder the old client
// UI expected. Unreachable while the legacy guard above stands, kept so the
// clamps live with the rest of the table.
function snapFlooredSetting(value, threshold, atOrAbove, below) {
  const floored = floorSettingAtZero(value);
  if (floored === SETTING_REJECTED) return SETTING_REJECTED;
  return floored >= threshold ? atOrAbove : below;
}

function normalizeBotPersonality(value) {
  const lowered = String(value).toLowerCase();
  return ROOM_BOT_PERSONALITIES.includes(lowered) ? lowered : 'survivor';
}

function normalizeBotBrain(value) {
  const lowered = String(value).trim().toLowerCase().replace('_', '-');
  return ROOM_BOT_BRAINS.includes(lowered) ? lowered : 'auto';
}

function normalizeBotDifficulty(value) {
  const lowered = String(value).trim().toLowerCase();
  return ROOM_BOT_DIFFICULTIES.includes(lowered) ? lowered : 'table';
}

function normalizeRulesetPreset(value) {
  const lowered = String(value).trim().toLowerCase();
  return ROOM_RULESET_PRESETS.includes(lowered) ? lowered : 'classic';
}

function normalizeRulesetBase(value) {
  const lowered = String(value).trim().toLowerCase();
  return ROOM_RULESET_BASES.includes(lowered) ? lowered : 'classic';
}

function normalizeBoardVariant(value) {
  const lowered = String(value).trim().toLowerCase();
  return ROOM_BOARD_VARIANTS.includes(lowered) ? lowered : 'standard-40';
}

function normalizeMarketComplexity(value) {
  const lowered = String(value).trim().toLowerCase();
  return ROOM_MARKET_COMPLEXITIES.includes(lowered) ? lowered : 'basic';
}

function normalizeRulesetOverrides(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(entry => entry && typeof entry.key === 'string')
    .slice(0, 32)
    .map(entry => ({ key: entry.key.trim().slice(0, 60), value: entry.value }))
    .filter(entry => entry.key);
}

const ROOM_SETTING_NORMALIZERS = {
  maxPlayers: (value, room) => clampSetting(value, 2, room?.settings?.boardVariant === 'metro-52' ? 6 : 4),
  // Bots are clamped against the live maxPlayers so seat math stays coherent.
  bots: (value, room) => clampSetting(value, 0, room.settings.maxPlayers - 1),
  startingCash: floorSettingAtZero,
  houseLimit: floorSettingAtZero,
  hotelLimit: floorSettingAtZero,
  turnTimer: floorSettingAtZero,
  globalEventDuration: value => snapFlooredSetting(value, 10, 10, 5),
  globalEventMax: value => snapFlooredSetting(value, 2, 2, 1),
  globalEvents: value => GLOBAL_EVENT_ON_VALUES.includes(value),
  botPersonality: normalizeBotPersonality,
  botBrain: normalizeBotBrain,
  botDifficulty: normalizeBotDifficulty,
  rulesetPreset: normalizeRulesetPreset,
  rulesetBase: normalizeRulesetBase,
  rulesetOverrides: normalizeRulesetOverrides,
  boardVariant: normalizeBoardVariant,
  marketComplexity: normalizeMarketComplexity
};

export {
  DEFAULT_ROOM_SETTINGS,
  GLOBAL_EVENT_ON_VALUES,
  LEGACY_SCALED_SETTINGS,
  ROOM_BOT_PERSONALITIES,
  ROOM_BOT_BRAINS,
  ROOM_BOT_DIFFICULTIES,
  ROOM_RULESET_PRESETS,
  ROOM_RULESET_BASES,
  ROOM_BOARD_VARIANTS,
  ROOM_MARKET_COMPLEXITIES,
  ROOM_FLAG_TRUE_VALUES,
  ROOM_SETTING_NORMALIZERS,
  SETTING_REJECTED
};
