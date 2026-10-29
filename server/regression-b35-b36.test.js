// B-35: room creation and the room-setting setter were two independent
// validators for the same decision, so a payload could be legal through one
// door and illegal through the other. These tests assert the cross-door
// equivalence itself, which nothing pinned before.
//
// B-36b: marketComplexity is both a preset default and a ruleset meta key, so
// the first write on a legacy room was reverted by the preset re-normalize.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import {
  DEFAULT_ROOM_SETTINGS,
  GLOBAL_EVENT_ON_VALUES,
  ROOM_HOTEL_LIMITS,
  ROOM_HOUSE_LIMITS
} from './roomSettings.js';
import {
  HISTORICAL_OVERRIDE_KEYS,
  KNOWN_OVERRIDE_KEYS,
  OPTIONAL_SYSTEM_KEYS,
  PRESET_DEFAULTS,
  normalizeOverrides,
  resolveRuleset
} from './rulesetRegistry.js';

let roomSeq = 0;

// A room created with no ruleset input stays on the legacy path, so
// setRoomSetting is exercised as the pure setter door.
function newRoom(options = {}) {
  roomSeq += 1;
  const socketId = `b35-socket-${roomSeq}`;
  return new RoomManager().createRoom({ socketId, clientId: socketId, nickname: `Host ${roomSeq}`, ...options });
}

function legacyRoomWithOptionalSystems() {
  const room = newRoom();
  room.addOrReconnectPlayer({ socketId: `${roomSeq}-guest`, clientId: `${roomSeq}-guest`, nickname: 'Guest' });
  room.settings.bankLoans = true;
  room.settings.casino = true;
  room.settings.market = true;
  room.settings.globalEvents = true;
  return room;
}

// The creation door: a Custom ruleset whose override list carries one value.
function creationDoor(key, value, overrides = [{ key, value }]) {
  const resolved = resolveRuleset({
    rulesetPreset: 'custom',
    rulesetBase: 'classic',
    boardVariant: 'standard-40',
    rulesetOverrides: overrides,
    settings: DEFAULT_ROOM_SETTINGS
  });
  return {
    accepted: resolved.rulesetOverrides.some(entry => entry.key === key),
    value: resolved.effectiveSettings[key]
  };
}

// The setter door: one write through Room.setRoomSetting.
function setterDoor(key, value, roomOptions) {
  const room = newRoom(roomOptions);
  const before = room.settings[key];
  const result = room.setRoomSetting(key, value);
  return {
    accepted: result.rejected !== true,
    rejected: result.rejected,
    reason: result.reason,
    before,
    value: room.settings[key],
    result
  };
}

function describeValue(value) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

// The invariant: both doors accept and reject the same values, and land on the
// same stored value when they accept.
function assertDoorsAgree(key, value) {
  const label = `${key}=${describeValue(value)}`;
  const creation = creationDoor(key, value);
  const setter = setterDoor(key, value);
  assert.equal(creation.accepted, setter.accepted, `${label}: accept/reject verdict must match across both doors`);
  if (creation.accepted) {
    assert.equal(creation.value, setter.value, `${label}: accepted value must match across both doors`);
  } else {
    assert.equal(setter.value, setter.before, `${label}: a rejected write must leave the room untouched`);
    assert.equal(setter.rejected, true, `${label}: the setter reports rejection`);
  }
  return { creation, setter };
}

const BUILDING_LIMIT_VALUES = key => [
  ...(key === 'houseLimit' ? ROOM_HOUSE_LIMITS : ROOM_HOTEL_LIMITS),
  'unlimited',
  'UNLIMITED',
  0,
  1,
  7,
  31,
  33,
  64.9,
  -5,
  101,
  'abc',
  null
];

test('B-35 house/hotel limits agree across creation and the setter', () => {
  for (const key of ['houseLimit', 'hotelLimit']) {
    for (const value of BUILDING_LIMIT_VALUES(key)) assertDoorsAgree(key, value);
  }
});

test('B-35 off-ladder building limits are rejected by both doors', () => {
  // houseLimit 0 and hotelLimit 1 used to be registry-legal (a 0..100 range
  // test) while the setter refused them; 0 houses strips essentially all rent.
  for (const [key, value] of [['houseLimit', 0], ['houseLimit', 7], ['hotelLimit', 0], ['hotelLimit', 1]]) {
    const { creation, setter } = assertDoorsAgree(key, value);
    assert.equal(creation.accepted, false, `${key}=${value} must not be a creation override`);
    assert.equal(creation.value, DEFAULT_ROOM_SETTINGS[key], `${key}=${value} must not reach the effective map`);
    assert.equal(setter.rejected, true, `${key}=${value} must be rejected by the setter`);
    assert.deepEqual(normalizeOverrides([{ key, value }]), {}, `${key}=${value} must be dropped by normalizeOverrides`);
  }
});

test('B-35 the curated ladders are shared, not re-derived', () => {
  for (const [key, ladder] of [['houseLimit', ROOM_HOUSE_LIMITS], ['hotelLimit', ROOM_HOTEL_LIMITS]]) {
    for (const value of ladder) {
      assert.deepEqual(normalizeOverrides([{ key, value }]), { [key]: value }, `${key}=${value} stays legal`);
    }
  }
  assert.deepEqual(normalizeOverrides([{ key: 'houseLimit', value: 'unlimited' }]), { houseLimit: 'unlimited' });
  assert.deepEqual(normalizeOverrides([{ key: 'hotelLimit', value: 'unlimited' }]), { hotelLimit: 'unlimited' });
});

test('B-35 globalEvents resolves identically through both doors', () => {
  const spread = [...GLOBAL_EVENT_ON_VALUES, 'off', 'false', 0, 'maybe', undefined, 'unlimited'];
  for (const value of spread) assertDoorsAgree('globalEvents', value);
});

test("B-35 globalEvents 'rare' and 'hardcore' no longer invert", () => {
  for (const value of ['rare', 'hardcore']) {
    const { creation, setter } = assertDoorsAgree('globalEvents', value);
    assert.equal(creation.value, true, `${value} turns global events ON through creation`);
    assert.equal(setter.value, true, `${value} turns global events ON through the setter`);
    assert.equal(creation.result, undefined);
  }
});

test('B-35 every other shared key agrees across creation and the setter', () => {
  const spread = {
    startingCash: [0, 1, 1500, 1_000_000, '2000.5', 1_000_001, -5, 'abc', 'unlimited'],
    bots: [0, 1, 2, 3, 4, 7, 8, -1, '2', 3.7, 'abc']
  };
  for (const [key, values] of Object.entries(spread)) {
    for (const value of values) assertDoorsAgree(key, value);
  }
});

test('B-35 accepted values still work through both doors (no over-tightening)', () => {
  const accepted = {
    houseLimit: [...ROOM_HOUSE_LIMITS, 'unlimited'],
    hotelLimit: [...ROOM_HOTEL_LIMITS, 'unlimited'],
    globalEvents: [...GLOBAL_EVENT_ON_VALUES],
    startingCash: [0, 1500, 1_000_000],
    bots: [0, 1, 2, 3]
  };
  for (const [key, values] of Object.entries(accepted)) {
    for (const value of values) {
      const creation = creationDoor(key, value);
      const setter = setterDoor(key, value);
      assert.equal(setter.rejected, false, `${key}=${describeValue(value)} is still accepted by the setter`);
      assert.equal(creation.accepted, true, `${key}=${describeValue(value)} is still accepted by creation`);
      assert.equal(creation.value, setter.value, `${key}=${describeValue(value)} lands on the same value`);
    }
  }
});

test('B-35 maxPlayers is not a creation override and its dead range config is gone', () => {
  assert.equal(KNOWN_OVERRIDE_KEYS.has('maxPlayers'), false);
  assert.equal(HISTORICAL_OVERRIDE_KEYS.has('maxPlayers'), false);
  for (const value of [0, 2, 4, 6, 8, -1, '4', 'unlimited', 'abc']) {
    assert.deepEqual(normalizeOverrides([{ key: 'maxPlayers', value }]), {}, `maxPlayers=${describeValue(value)} is dropped`);
    const creation = creationDoor('maxPlayers', value);
    assert.equal(creation.accepted, false, `maxPlayers=${describeValue(value)} is never an override`);
    assert.equal(creation.value, 4, 'an explicit maxPlayers override cannot raise the board seat count');
  }
  // The documented divergence: the setter is the only seat-capacity door, and
  // it clamps per board (4 on standard-40, 6 on metro-52). That is exactly why
  // maxPlayers must not be added back to KNOWN_OVERRIDE_KEYS.
  const standard = setterDoor('maxPlayers', 6);
  assert.equal(standard.value, 4);
  const metro = setterDoor('maxPlayers', 6, { boardVariant: 'metro-52' });
  assert.equal(metro.value, 6);
  assert.equal(creationDoor('maxPlayers', 6).value, 4);
});

test('B-36b every preset-owned key is carry-forwardable', () => {
  // OPTIONAL_SYSTEM_KEYS drives the legacy -> ruleset carry-forward. It is
  // derived from PRESET_DEFAULTS so a new preset key cannot silently be
  // reverted by the first meta write.
  for (const [preset, defaults] of Object.entries(PRESET_DEFAULTS)) {
    for (const key of Object.keys(defaults)) {
      assert.equal(OPTIONAL_SYSTEM_KEYS.includes(key), true, `${preset} preset key ${key} must be carry-forwardable`);
    }
  }
});

test("B-36b a legacy room's first marketComplexity write sticks", () => {
  const room = legacyRoomWithOptionalSystems();
  assert.equal(room.rulesetExplicit, false, 'fixture starts on the legacy path');
  assert.equal(room.settings.marketComplexity, 'basic');

  const result = room.setRoomSetting('marketComplexity', 'margin');
  assert.equal(result.rejected, false);
  assert.equal(result.reason, null);
  assert.equal(result.changed, true, 'the write must not be a silent no-op');
  assert.equal(result.value, 'margin', 'the reported value is the stored value');
  assert.equal(room.settings.marketComplexity, 'margin', 'the room must not revert to the preset default');
  assert.equal(room.game.settings.marketComplexity, 'margin', 'the game must not revert to the preset default');
  assert.equal(result.effectiveSettings.marketComplexity, 'margin');
  assert.equal(room.ruleset.effectiveSettings.marketComplexity, 'margin');
  assert.equal(
    room.settings.rulesetOverrides.some(entry => entry.key === 'marketComplexity' && entry.value === 'margin'),
    true,
    'the override is recorded on the transition write'
  );
  // The same transition must still carry the legacy toggles forward.
  assert.equal(room.game.settings.bankLoans, true);
  assert.equal(room.game.settings.casino, true);
  assert.equal(room.game.settings.market, true);
  assert.equal(room.ruleset.effectiveSettings.globalEvents, true);
});

test('B-36b marketComplexity survives refreshRuleset and later writes', () => {
  const room = legacyRoomWithOptionalSystems();
  room.setRoomSetting('marketComplexity', 'shorting');

  room.refreshRuleset();
  assert.equal(room.settings.marketComplexity, 'shorting', 'refreshRuleset must not re-apply PRESET_DEFAULTS');
  assert.equal(room.ruleset.effectiveSettings.marketComplexity, 'shorting');

  room.setRoomSetting('boardVariant', 'metro-52');
  assert.equal(room.settings.marketComplexity, 'shorting');
  assert.equal(room.game.settings.marketComplexity, 'shorting');

  const resolved = resolveRuleset({
    rulesetPreset: 'classic',
    rulesetBase: 'classic',
    boardVariant: 'metro-52',
    rulesetOverrides: room.settings.rulesetOverrides,
    settings: room.settings
  });
  assert.equal(resolved.effectiveSettings.marketComplexity, 'shorting');

  room.startGame();
  assert.equal(room.game.settings.marketComplexity, 'shorting');
});

test("B-36b a legacy room's optional systems survive the first ruleset meta write (T9)", () => {
  const room = legacyRoomWithOptionalSystems();
  const result = room.setRoomSetting('boardVariant', 'standard-40');
  assert.equal(result.rejected, false);
  assert.equal(room.game.settings.bankLoans, true, 'legacy bankLoans toggle must be carried into overrides');
  assert.equal(room.game.settings.casino, true);
  assert.equal(room.game.settings.market, true);
  assert.equal(room.ruleset.effectiveSettings.globalEvents, true,
    'the ruleset flow must honor captured legacy overrides, not silently strip them');
});

test('B-36a is unchanged: a named preset still owns its base and clears overrides', () => {
  // Pinned by rulesetRegistry.test.js too; asserted here so a future fix to
  // B-36a has to be deliberate.
  const custom = newRoom({ rulesetPreset: 'custom', rulesetBase: 'after-hours' });
  custom.setRoomSetting('casino', false);
  assert.deepEqual(custom.settings.rulesetOverrides, [{ key: 'casino', value: false }]);

  const toClassic = custom.setRoomSetting('rulesetPreset', 'classic');
  assert.equal(toClassic.changed, true);
  assert.equal(toClassic.rejected, false);
  assert.equal(toClassic.preset, 'classic');
  assert.equal(toClassic.base, 'classic');
  assert.deepEqual(custom.settings.rulesetOverrides, [], 'a named preset clears Custom-era overrides');
  assert.equal(toClassic.effectiveSettings.casino, false);
  assert.equal(toClassic.effectiveSettings.bankLoans, false);

  const afterHours = custom.setRoomSetting('rulesetPreset', 'after-hours');
  assert.equal(afterHours.preset, 'after-hours');
  assert.deepEqual(custom.settings.rulesetOverrides, []);
  assert.equal(afterHours.effectiveSettings.bankLoans, true);
  assert.equal(afterHours.effectiveSettings.globalEvents, true);
});