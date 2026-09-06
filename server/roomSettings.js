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
  startingCash: 1500,
  bankLoans: true,
  bankLoanSeverity: 'predatory',
  // Global headlines are intentionally a single on/off rule. Rarity,
  // severity, duration, and combinations are derived from the game clock.
  globalEvents: false,
  casino: false,
  market: false,
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

const ROOM_SETTING_NORMALIZERS = {
  maxPlayers: value => clampSetting(value, 2, 4),
  // Bots are clamped against the live maxPlayers so seat math stays coherent.
  bots: (value, room) => clampSetting(value, 0, room.settings.maxPlayers - 1),
  startingCash: floorSettingAtZero,
  houseLimit: floorSettingAtZero,
  hotelLimit: floorSettingAtZero,
  turnTimer: floorSettingAtZero,
  globalEventDuration: value => snapFlooredSetting(value, 10, 10, 5),
  globalEventMax: value => snapFlooredSetting(value, 2, 2, 1),
  globalEvents: value => GLOBAL_EVENT_ON_VALUES.includes(value),
  botPersonality: normalizeBotPersonality
};

export {
  DEFAULT_ROOM_SETTINGS,
  GLOBAL_EVENT_ON_VALUES,
  LEGACY_SCALED_SETTINGS,
  ROOM_BOT_PERSONALITIES,
  ROOM_FLAG_TRUE_VALUES,
  ROOM_SETTING_NORMALIZERS,
  SETTING_REJECTED
};
