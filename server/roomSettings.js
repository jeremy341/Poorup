// Room settings vocabulary: defaults, the per-key normalizer table, and the numeric clamp helpers. A raw client value passes through its
// key's normalizer before it is stored on the room and its game. A normalizer returns SETTING_REJECTED to leave the stored value untouched.
// Keys with no entry use the generic rule: booleans parse the four truthy spellings, strings are trimmed, anything else is stored as received.
const DEFAULT_ROOM_SETTINGS = {
  rulesProfile: 'standard',
  playerFinance: false,
  itemRewards: false,
  maxPlayers: 4,
  doubleRent: false,
  vacationCash: false,
  auction: true,
  trading: true,
  doubleGo: false,
  noRentWhileInPrison: false,
  mortgage: true,
  evenBuild: true,
  randomizePlayerOrder: false,
  bankruptMode: 'elim',
  bots: 0,
  // AI uses the configured advisor and falls back to the deterministic house
  // brain when credits, network, or provider health are unavailable.
  botBrain: 'ai',
  botDifficulty: 'table',
  startingCash: 1500,
  bankLoans: false,
  bankLoanSeverity: 'predatory',
  // Global headlines are a single on/off rule. Rarity,
  // severity, duration, and combinations are derived from the game clock.
  globalEvents: false,
  casino: false,
  market: false,
  // Airport flights: pay to fly airport to airport; owners set the fees.
  flights: false,
  // Bank account tiers: buy a tier, earn a rebate on market and flight fees.
  bankAccountUpgrades: false,
  // Ruleset metadata is stored alongside the legacy setting vocabulary so a
  // reconnect can restore the exact table contract without a second engine.
  rulesetOverrides: [],
  boardVariant: 'standard-40',
  rulesetRevision: 2,
  marketComplexity: 'basic',
  // Kept for backwards-compatible snapshots only; client values are ignored.
  globalEventDuration: 5,
  globalEventMax: 1
};

const SETTING_REJECTED = Symbol('setting-rejected');
const ROOM_FLAG_TRUE_VALUES = [true, 'true', 1, '1'];
const RETIRED_ROOM_SETTING_KEYS = ['houseLimit', 'hotelLimit'];
const RETIRED_ROOM_SETTING_KEY_SET = new Set(RETIRED_ROOM_SETTING_KEYS);

function isRetiredRoomSettingKey(key) {
  return RETIRED_ROOM_SETTING_KEY_SET.has(key);
}

// Trusted snapshots and raw settings can outlive the options that created
// them. Remove only the retired supply controls before restoring or exposing
// those settings; other rule keys retain their existing validation path.
function stripRetiredRoomSettings(settings = {}) {
  const stripped = { ...settings };
  RETIRED_ROOM_SETTING_KEYS.forEach(key => { delete stripped[key]; });
  const overrides = stripped.rulesetOverrides;
  if (Array.isArray(overrides)) {
    stripped.rulesetOverrides = overrides.filter(entry => !(
      typeof entry?.key === 'string' && RETIRED_ROOM_SETTING_KEY_SET.has(entry.key.trim())
    ));
  } else if (overrides && typeof overrides === 'object') {
    stripped.rulesetOverrides = { ...overrides };
    RETIRED_ROOM_SETTING_KEYS.forEach(key => { delete stripped.rulesetOverrides[key]; });
  }
  return stripped;
}
// Rarity spellings are accepted for globalEvents only; every other boolean
// key uses ROOM_FLAG_TRUE_VALUES.
const GLOBAL_EVENT_ON_VALUES = [true, 'true', 'on', 'rare', 'hardcore', 1, '1'];
const ROOM_BOT_BRAINS = ['ai', 'no-ai'];
const ROOM_BOT_DIFFICULTIES = ['house', 'table', 'expert'];
const ROOM_BOARD_VARIANTS = ['standard-40', 'metro-52'];
const ROOM_MARKET_COMPLEXITIES = ['basic', 'margin', 'shorting', 'derivatives'];
const ROOM_BANK_LOAN_SEVERITIES = ['fair', 'predatory', 'extreme'];
// Legacy clients may still send these fields; the server owns scaling.
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

// Shared numeric boundary: finite whole values only, with an explicit
// fallback so callers can reject without mutating the previous setting.
function boundedInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const floored = Math.floor(parsed);
  if (floored < min || floored > max) return fallback;
  return floored;
}

// The legacy duration/max knobs snap to the two-step ladder the old client
// UI expected. Unreachable while the legacy guard above stands, kept so the
// clamps live with the rest of the table.
function snapFlooredSetting(value, threshold, atOrAbove, below) {
  const floored = floorSettingAtZero(value);
  if (floored === SETTING_REJECTED) return SETTING_REJECTED;
  return floored >= threshold ? atOrAbove : below;
}

function normalizeBotBrain(value) {
  const lowered = String(value).trim().toLowerCase().replace('_', '-');
  if (lowered === 'auto' || lowered === 'all') return 'ai';
  return ROOM_BOT_BRAINS.includes(lowered) ? lowered : 'ai';
}

function normalizeBotDifficulty(value) {
  const lowered = String(value).trim().toLowerCase();
  return ROOM_BOT_DIFFICULTIES.includes(lowered) ? lowered : 'table';
}

// Player-facing presets: fixed brain and difficulty bundles. Easy is pure deterministic code, Medium adds the AI advisor, and Hard enables
// the full stack (table brain, search, mind, advisor). Difficulty never weakens safety floors: it changes only search depth, noise and book access.
const BOT_PRESETS = {
  easy: { botBrain: 'no-ai', botDifficulty: 'house' },
  medium: { botBrain: 'ai', botDifficulty: 'table' },
  hard: { botBrain: 'ai', botDifficulty: 'expert' }
};

function resolveBotPreset(value) {
  const preset = BOT_PRESETS[String(value || '').trim().toLowerCase()];
  return preset ? { ...preset } : null;
}

function normalizeBoardVariant(value) {
  const lowered = String(value).trim().toLowerCase();
  return ROOM_BOARD_VARIANTS.includes(lowered) ? lowered : 'standard-40';
}

function normalizeMarketComplexity(value) {
  const lowered = String(value).trim().toLowerCase();
  return ROOM_MARKET_COMPLEXITIES.includes(lowered) ? lowered : 'basic';
}

function normalizeBankLoanSeverity(value) {
  const lowered = String(value).trim().toLowerCase();
  return ROOM_BANK_LOAN_SEVERITIES.includes(lowered) ? lowered : 'predatory';
}

// Keys a room may store as ruleset overrides. This mirrors
// HISTORICAL_OVERRIDE_KEYS in rulesetRegistry.js, which imports from here and
// so cannot be imported back; roomSettings.test.js pins the two lists together.
const ROOM_OVERRIDE_KEYS = new Set([
  'playerFinance',
  'itemRewards',
  'bankLoans',
  'casino',
  'market',
  'marketComplexity',
  'globalEvents',
  'flights',
  'bankAccountUpgrades',
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
  'botDifficulty',
  'turnTimer'
]);

// Overrides are flags, names, and counts. Objects, arrays, and null have no
// meaning as a rule value, so they are dropped rather than stored and echoed.
function isPlainOverrideValue(value) {
  if (typeof value === 'boolean' || typeof value === 'string') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeRulesetOverrides(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(entry => entry && typeof entry.key === 'string')
    .map(entry => ({ key: entry.key.trim(), value: entry.value }))
    .filter(entry => ROOM_OVERRIDE_KEYS.has(entry.key) && isPlainOverrideValue(entry.value))
    .slice(0, 32)
    .map(entry => ({ key: entry.key, value: typeof entry.value === 'string' ? entry.value.trim().slice(0, 80) : entry.value }));
}

// Number(null) and Number('') are both 0, so only real numbers and non-blank
// strings may reach the numeric clamp. A null is how NaN arrives on the wire.
function isNumericSettingInput(value) {
  return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
}

// A ruleset revision is a positive whole number; anything else is refused.
function positiveIntegerSetting(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return SETTING_REJECTED;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : SETTING_REJECTED;
}

const ROOM_SETTING_NORMALIZERS = {
  rulesProfile: value => ['standard', 'advanced'].includes(value) ? value : SETTING_REJECTED,
  itemRewards: normalizeItemRewards,
  maxPlayers: (value, room) => clampSetting(value, 2, room?.settings?.boardVariant === 'metro-52' ? 6 : 4),
  // Bots are clamped against the live maxPlayers so seat math stays coherent.
  bots: (value, room) => clampSetting(value, 0, room.settings.maxPlayers - 1),
  startingCash: value => (isNumericSettingInput(value)
    ? boundedInteger(value, { min: 0, max: 1_000_000, fallback: SETTING_REJECTED })
    : SETTING_REJECTED),
  rulesetRevision: positiveIntegerSetting,
  // Bankrupt mode is retained only for snapshot compatibility; the game has
  // one authoritative elimination/spectator path.
  bankruptMode: () => 'elim',
  bankLoanSeverity: normalizeBankLoanSeverity,
  globalEventDuration: value => snapFlooredSetting(value, 10, 10, 5),
  globalEventMax: value => snapFlooredSetting(value, 2, 2, 1),
  globalEvents: value => GLOBAL_EVENT_ON_VALUES.includes(value),
  botBrain: normalizeBotBrain,
  botDifficulty: normalizeBotDifficulty,
  rulesetOverrides: normalizeRulesetOverrides,
  boardVariant: normalizeBoardVariant,
  marketComplexity: normalizeMarketComplexity
};

// Unlike legacy flags, a malformed new item choice must not silently disable
// a host's existing selection. Both the setter and override registry use this.
function normalizeItemRewards(value) {
  if (ROOM_FLAG_TRUE_VALUES.includes(value)) return true;
  if ([false, 'false', 0, '0'].includes(value)) return false;
  return SETTING_REJECTED;
}

export {
  DEFAULT_ROOM_SETTINGS,
  GLOBAL_EVENT_ON_VALUES,
  LEGACY_SCALED_SETTINGS,
  ROOM_BOT_BRAINS,
  ROOM_BOT_DIFFICULTIES,
  BOT_PRESETS,
  resolveBotPreset,
  ROOM_BOARD_VARIANTS,
  ROOM_MARKET_COMPLEXITIES,
  ROOM_BANK_LOAN_SEVERITIES,
  ROOM_FLAG_TRUE_VALUES,
  ROOM_SETTING_NORMALIZERS,
  SETTING_REJECTED,
  boundedInteger,
  floorSettingAtZero,
  isPlainOverrideValue,
  isRetiredRoomSettingKey,
  normalizeItemRewards,
  stripRetiredRoomSettings
};
