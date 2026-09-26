import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROOM_SETTINGS } from './roomSettings.js';
import { RoomManager } from './gameLogic.js';
import { KNOWN_OVERRIDE_KEYS, HISTORICAL_OVERRIDE_KEYS, resolveRuleset } from './rulesetRegistry.js';
import { buildCreateRoomRequest, toRoomCreationOptions } from './roomSetup.js';

test('new room settings and snapshots omit per-turn timers', () => {
  assert.equal('turnTimer' in DEFAULT_ROOM_SETTINGS, false);
  const room = new RoomManager().createRoom({ socketId: 'settings-host', clientId: 'settings-client', nickname: 'Host' });
  assert.equal('turnTimer' in room.settings, false);
  assert.equal(room.setRoomSetting('turnTimer', 90).rejected, true);
  assert.equal('turnTimer' in room.getRoomSummary().settings, false);
  assert.equal('turnDeadline' in room.game.getGameSummary(), false);
});

test('historical ruleset timer metadata remains readable without enabling a live setting', () => {
  assert.equal(KNOWN_OVERRIDE_KEYS.has('turnTimer'), false);
  assert.equal(HISTORICAL_OVERRIDE_KEYS.has('turnTimer'), true);
  const historical = resolveRuleset({
    rulesetPreset: 'custom',
    rulesetBase: 'classic',
    rulesetOverrides: [{ key: 'turnTimer', value: 120 }],
    settings: {},
  });
  assert.equal(historical.effectiveSettings.turnTimer, 120);
  assert.deepEqual(historical.rulesetOverrides, [{ key: 'turnTimer', value: 120 }]);
});

test('new room creation ignores preset and arbitrary override inputs', () => {
  const request = buildCreateRoomRequest({
    nickname: 'Host',
    visibility: 'public',
    rulesetPreset: 'after-hours',
    rulesetBase: 'after-hours',
    rulesetOverrides: [{ key: 'turnTimer', value: 120 }],
    boardVariant: 'metro-52',
  });
  assert.equal('rulesetPreset' in request, false);
  assert.equal('rulesetBase' in request, false);
  assert.equal('rulesetOverrides' in request, false);
  assert.equal(request.boardVariant, 'metro-52');
  const options = toRoomCreationOptions(request, 'client', 'socket');
  assert.equal('rulesetOverrides' in options, false);
});

test('house and hotel settings accept curated values and a serializable unlimited sentinel', () => {
  const room = new RoomManager().createRoom({ socketId: 'limits-host', clientId: 'limits-client', nickname: 'Host' });
  for (const value of [10, 20, 32, 40, 50, 64, 'unlimited']) {
    assert.equal(room.setRoomSetting('houseLimit', value).rejected, false, `house limit ${value} is accepted`);
    assert.equal(room.settings.houseLimit, value);
  }
  for (const value of [6, 12, 16, 24, 32, 'unlimited']) {
    assert.equal(room.setRoomSetting('hotelLimit', value).rejected, false, `hotel limit ${value} is accepted`);
    assert.equal(room.settings.hotelLimit, value);
  }
  assert.equal(room.setRoomSetting('houseLimit', 31).rejected, true);
  assert.equal(room.setRoomSetting('hotelLimit', 25).rejected, true);
  assert.equal(JSON.parse(JSON.stringify(room.getRoomSummary().settings)).houseLimit, 'unlimited');
});
