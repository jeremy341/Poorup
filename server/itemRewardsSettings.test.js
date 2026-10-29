import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { normalizeOverrides, resolveRuleset } from './rulesetRegistry.js';

function roomFor(profile = 'standard', rulesetOverrides = []) {
  return new RoomManager().createRoom({ socketId: 'item-host', clientId: 'item-host', nickname: 'Host', rulesProfile: profile, rulesetOverrides });
}

test('item rewards are off by default in either profile and independent of finance', () => {
  for (const profile of ['standard', 'advanced']) {
    const room = roomFor(profile);
    for (const settings of [room.settings, room.game.settings, room.ruleset.effectiveSettings, room.getRoomSummary().settings]) {
      assert.equal(settings.itemRewards, false);
    }
    assert.equal(room.setRoomSetting('itemRewards', true).rejected, false);
    assert.equal(room.setRoomSetting('playerFinance', false).rejected, false);
    assert.equal(room.settings.itemRewards, true);
    for (const nextProfile of ['standard', 'advanced']) {
      assert.equal(room.setRoomSetting('rulesProfile', nextProfile).rejected, false);
      assert.equal(room.settings.itemRewards, true);
      assert.equal(room.game.settings.itemRewards, true);
      assert.equal(room.settings.playerFinance, false);
    }
    assert.equal(room.setRoomSetting('itemRewards', false).rejected, false);
    assert.equal(room.game.getGameSummary().ruleset.effectiveSettings.itemRewards, false);
  }
});

test('item rewards normalize identically through overrides and live setting writes', () => {
  for (const [value, expected] of [[true, true], ['true', true], [1, true], ['1', true], [false, false], ['false', false], [0, false], ['0', false]]) {
    const room = roomFor('standard', [{ key: 'itemRewards', value }]);
    assert.equal(room.settings.itemRewards, expected);
    assert.equal(room.setRoomSetting('itemRewards', value).rejected, false);
    assert.equal(room.settings.itemRewards, expected);
    assert.equal(resolveRuleset({ rulesetOverrides: { itemRewards: value } }).effectiveSettings.itemRewards, expected);
  }
});

test('invalid item reward choices cannot overwrite an enabled room', () => {
  const room = roomFor('standard', [{ key: 'itemRewards', value: true }]);
  for (const value of [undefined, null, [], {}, Number.NaN, Infinity, '', 'yes', 'rare', 2]) {
    assert.equal(Object.hasOwn(normalizeOverrides({ itemRewards: value }), 'itemRewards'), false);
    assert.equal(room.setRoomSetting('itemRewards', value).rejected, true);
    assert.equal(room.settings.itemRewards, true);
  }
  room.addOrReconnectPlayer({ socketId: 'item-guest', clientId: 'item-guest', nickname: 'Guest' });
  room.reconnectPlayer(room.game.players[0], { socketId: 'item-reconnected', clientId: 'item-host', nickname: 'Host' });
  assert.equal(room.settings.itemRewards, true);
  assert.equal(room.startGame().success, true);
  assert.equal(room.setRoomSetting('itemRewards', false).rejected, true);
  assert.equal(room.game.settings.itemRewards, true);
});
