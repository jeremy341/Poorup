// Room creation and the room-setting setter were two independent validators for the same decision, so a payload could pass one door
// and fail the other. These tests assert the cross-door equivalence, which nothing pinned before. marketComplexity is both a preset
// default and a ruleset meta key, so the first write on a legacy room was reverted by the preset re-normalize.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import {
  DEFAULT_ROOM_SETTINGS,
  GLOBAL_EVENT_ON_VALUES,
} from './roomSettings.js';
import {
  HISTORICAL_OVERRIDE_KEYS,
  KNOWN_OVERRIDE_KEYS,
  ADD_ON_DEFAULTS,
  OPTIONAL_SYSTEM_KEYS,
  createRulesetDigest,
  normalizeOverrides,
  resolveRuleset
} from './rulesetRegistry.js';

let roomSeq = 0;

// Optional-rule validation uses an explicitly Advanced table.
function newRoom(options = {}) {
  roomSeq += 1;
  const socketId = `b35-socket-${roomSeq}`;
  return new RoomManager().createRoom({ rulesProfile: 'advanced', socketId, clientId: socketId, nickname: `Host ${roomSeq}`, ...options });
}

function advancedRoomWithOptionalSystems() {
  const room = newRoom();
  room.addOrReconnectPlayer({ socketId: `${roomSeq}-guest`, clientId: `${roomSeq}-guest`, nickname: 'Guest' });
  room.setRoomSetting('bankLoans', true);
  room.setRoomSetting('casino', true);
  room.setRoomSetting('market', true);
  room.setRoomSetting('globalEvents', true);
  return room;
}

// The creation door: a Custom ruleset whose override list carries one value.
function creationDoor(key, value, overrides = [{ key, value }]) {
  const resolved = resolveRuleset({
    boardVariant: 'standard-40',
    rulesetOverrides: overrides,
    settings: { ...DEFAULT_ROOM_SETTINGS, rulesProfile: 'advanced', playerFinance: true }
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

test('house/hotel supply limits cannot be set or enabled through ruleset creation', () => {
  for (const key of ['houseLimit', 'hotelLimit']) {
    assert.equal(Object.hasOwn(DEFAULT_ROOM_SETTINGS, key), false);
    assert.equal(KNOWN_OVERRIDE_KEYS.has(key), false);
    assert.equal(HISTORICAL_OVERRIDE_KEYS.has(key), false);
    for (const value of [0, 32, 64, 'unlimited', null]) {
      const setter = setterDoor(key, value);
      const creation = creationDoor(key, value);
      assert.equal(setter.rejected, true, `${key} setter must reject ${describeValue(value)}`);
      assert.equal(creation.accepted, false, `${key} creation must discard ${describeValue(value)}`);
      assert.deepEqual(normalizeOverrides([{ key, value }]), {}, `${key} override list is discarded`);
      assert.deepEqual(normalizeOverrides({ [key]: value }), {}, `${key} override map is discarded`);
    }
  }
});

test('legacy raw supply-limit settings are stripped from ruleset projections and canonical digests', () => {
  const legacy = resolveRuleset({
    boardVariant: 'standard-40',
    rulesetOverrides: [{ key: 'houseLimit', value: 64 }, { key: 'hotelLimit', value: 'unlimited' }],
    settings: { ...DEFAULT_ROOM_SETTINGS, houseLimit: 64, hotelLimit: 'unlimited', casino: true }
  });
  assert.equal(Object.hasOwn(legacy.effectiveSettings, 'houseLimit'), false);
  assert.equal(Object.hasOwn(legacy.effectiveSettings, 'hotelLimit'), false);
  assert.equal(Object.hasOwn(legacy.effectiveSettings, 'casino'), true);
  assert.deepEqual(legacy.rulesetOverrides, []);

  const clean = resolveRuleset({ settings: { ...DEFAULT_ROOM_SETTINGS, casino: true } });
  assert.equal(createRulesetDigest({ ...legacy, rulesetOverrides: [], effectiveSettings: legacy.effectiveSettings }), clean.digest);
  assert.equal(createRulesetDigest({
    rulesetOverrides: [{ key: 'houseLimit', value: 64 }, { key: 'hotelLimit', value: 'unlimited' }],
    settings: { ...DEFAULT_ROOM_SETTINGS, casino: true, houseLimit: 64, hotelLimit: 'unlimited' }
  }), clean.digest);
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

test('B-36b every add-on key is carry-forwardable', () => {
  // OPTIONAL_SYSTEM_KEYS drives the legacy to ruleset carry-forward. It is
  // derived from ADD_ON_DEFAULTS so a new add-on key cannot silently be
  // reverted by the first meta write.
  for (const key of Object.keys(ADD_ON_DEFAULTS)) {
    assert.equal(OPTIONAL_SYSTEM_KEYS.includes(key), true, `add-on key ${key} must be carry-forwardable`);
  }
});

test("B-36b an Advanced room's first marketComplexity write sticks", () => {
  const room = advancedRoomWithOptionalSystems();
  assert.equal(room.rulesetExplicit, true, 'fixture uses explicit Advanced rules');
  assert.equal(room.settings.marketComplexity, 'basic');

  const result = room.setRoomSetting('marketComplexity', 'margin');
  assert.equal(result.rejected, false);
  assert.equal(result.reason, null);
  assert.equal(result.changed, true, 'the write must not be a silent no-op');
  assert.equal(result.value, 'margin', 'the reported value is the stored value');
  assert.equal(room.settings.marketComplexity, 'margin', 'the room must not revert to the add-on default');
  assert.equal(room.game.settings.marketComplexity, 'margin', 'the game must not revert to the add-on default');
  assert.equal(result.effectiveSettings.marketComplexity, 'margin');
  assert.equal(room.ruleset.effectiveSettings.marketComplexity, 'margin');
  assert.equal(
    room.settings.rulesetOverrides.some(entry => entry.key === 'marketComplexity' && entry.value === 'margin'),
    true,
    'the override is recorded on the transition write'
  );
  // The same write must preserve every explicit optional toggle.
  assert.equal(room.game.settings.bankLoans, true);
  assert.equal(room.game.settings.casino, true);
  assert.equal(room.game.settings.market, true);
  assert.equal(room.ruleset.effectiveSettings.globalEvents, true);
});

test('B-36b marketComplexity survives refreshRuleset and later writes', () => {
  const room = advancedRoomWithOptionalSystems();
  room.setRoomSetting('marketComplexity', 'shorting');

  room.refreshRuleset();
  assert.equal(room.settings.marketComplexity, 'shorting', 'refreshRuleset must not re-apply ADD_ON_DEFAULTS');
  assert.equal(room.ruleset.effectiveSettings.marketComplexity, 'shorting');

  room.setRoomSetting('boardVariant', 'metro-52');
  assert.equal(room.settings.marketComplexity, 'shorting');
  assert.equal(room.game.settings.marketComplexity, 'shorting');

  const resolved = resolveRuleset({
    boardVariant: 'metro-52',
    rulesetOverrides: room.settings.rulesetOverrides,
    settings: room.settings
  });
  assert.equal(resolved.effectiveSettings.marketComplexity, 'shorting');

  room.startGame();
  assert.equal(room.game.settings.marketComplexity, 'shorting');
});

test("B-36b an Advanced room's optional systems survive the first ruleset meta write (T9)", () => {
  const room = advancedRoomWithOptionalSystems();
  const result = room.setRoomSetting('boardVariant', 'standard-40');
  assert.equal(result.rejected, false);
  assert.equal(room.game.settings.bankLoans, true, 'explicit bankLoans override must survive metadata writes');
  assert.equal(room.game.settings.casino, true);
  assert.equal(room.game.settings.market, true);
  assert.equal(room.ruleset.effectiveSettings.globalEvents, true,
    'the ruleset flow must preserve the explicit optional overrides');
});

test('B-36a: add-on overrides accumulate and a later toggle keeps the earlier ones', () => {
  // Presets do not clear overrides on a switch. With no presets, every
  // add-on choice stays on the table until the host changes it.
  const room = newRoom({ rulesetOverrides: [{ key: 'bankLoans', value: true }] });
  room.setRoomSetting('casino', false);
  assert.deepEqual(room.settings.rulesetOverrides, [{ key: 'bankLoans', value: true }, { key: 'casino', value: false }]);
  assert.equal(room.ruleset.effectiveSettings.bankLoans, true);
  assert.equal(room.ruleset.effectiveSettings.casino, false);
  assert.equal(room.ruleset.effectiveSettings.market, false);
});
