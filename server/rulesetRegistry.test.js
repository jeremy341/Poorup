import assert from 'node:assert/strict';
import {
  boardVariantMeta,
  createRulesetDigest,
  normalizeOverrides,
  resolveRuleset,
  safeBoardVariant
} from './rulesetRegistry.js';
import { RoomManager } from './gameLogic.js';

const legacy = { maxPlayers: 4, bots: 0, bankLoans: true, casino: true, market: true, globalEvents: true };
const classic = resolveRuleset({ rulesetPreset: 'classic', boardVariant: 'standard-40', settings: legacy });
assert.equal(classic.rulesetPreset, 'classic');
assert.equal(classic.boardVariant, 'standard-40');
assert.equal(classic.effectiveSettings.bankLoans, false);
assert.equal(classic.effectiveSettings.casino, false);
assert.equal(classic.effectiveSettings.market, false);
assert.equal(classic.effectiveSettings.globalEvents, false);

const afterHours = resolveRuleset({ rulesetPreset: 'after-hours', boardVariant: 'standard-40', settings: { maxPlayers: 4 } });
assert.equal(afterHours.effectiveSettings.bankLoans, true);
assert.equal(afterHours.effectiveSettings.casino, true);
assert.equal(afterHours.effectiveSettings.market, true);
assert.equal(afterHours.effectiveSettings.globalEvents, true);

const custom = resolveRuleset({
  rulesetPreset: 'custom',
  rulesetBase: 'after-hours',
  boardVariant: 'metro-52',
  rulesetOverrides: [{ key: 'casino', value: false }, { key: 'marketComplexity', value: 'shorting' }, { key: 'unknown', value: true }],
  settings: { maxPlayers: 8, bots: 8 }
});
assert.equal(custom.effectiveSettings.casino, false);
assert.equal(custom.effectiveSettings.bankLoans, true);
assert.equal(custom.effectiveSettings.globalEvents, true);
assert.equal(custom.effectiveSettings.marketComplexity, 'shorting');
assert.equal(custom.effectiveSettings.maxPlayers, 6);
assert.equal(custom.effectiveSettings.bots, 5);
assert.deepEqual(custom.rulesetOverrides, [{ key: 'casino', value: false }, { key: 'marketComplexity', value: 'shorting' }]);
assert.equal(createRulesetDigest(custom), custom.digest);
assert.equal(createRulesetDigest({ ...custom, rulesetOverrides: [...custom.rulesetOverrides].reverse() }), custom.digest);
assert.notEqual(classic.digest, afterHours.digest);
assert.equal(safeBoardVariant('grand-64'), 'standard-40');
assert.equal(boardVariantMeta('metro-52').maxPlayers, 6);
assert.deepEqual(normalizeOverrides({ marketComplexity: 'margin', nope: 1 }), { marketComplexity: 'margin' });
const manager = new RoomManager();
const room = manager.createRoom({ socketId: 's1', clientId: 'c1', nickname: 'A', rulesetPreset: 'classic', boardVariant: 'metro-52' });
room.addOrReconnectPlayer({ socketId: 's2', clientId: 'c2', nickname: 'B' });
assert.equal(room.game.tiles.length, 52);
room.setRoomSetting('boardVariant', 'standard-40');
assert.equal(room.game.tiles.length, 40);
room.setRoomSetting('boardVariant', 'metro-52');
assert.equal(room.game.tiles.length, 52);
assert.equal(room.getRoomSummary().ruleset.boardVariant, 'metro-52');
room.setRoomSetting('casino', true);
assert.equal(room.getRoomSummary().ruleset.effectiveSettings.casino, true);
assert.equal(room.getRoomSummary().ruleset.overrides.some(entry => entry.key === 'casino'), true);
room.setRoomSetting('maxPlayers', 6);
assert.equal(room.settings.maxPlayers, 6);
assert.equal(room.startGame().success, true);
const frozenDigest = room.game.rulesetDigest;
room.setRoomSetting('casino', false);
assert.equal(room.game.rulesetDigest, frozenDigest);
assert.equal(room.getRoomSummary().ruleset.boardVariant, 'metro-52');
const reconnect = room.reconnectPlayer(room.game.players[0], { socketId: 's3', clientId: 'c1', nickname: 'A' });
assert.equal(reconnect.success, true);
assert.equal(room.getRoomSummary().ruleset.digest, frozenDigest);
console.log('ruleset registry: 18 passed, 0 failed');
