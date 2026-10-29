import assert from 'node:assert/strict';
import {
  boardVariantMeta,
  createRulesetDigest,
  effectiveSettingsFor,
  KNOWN_OVERRIDE_KEYS,
  normalizeOverrides,
  resolveRuleset,
  safeBoardVariant
} from './rulesetRegistry.js';
import { RoomManager } from './gameLogic.js';

assert.equal(KNOWN_OVERRIDE_KEYS.has('botPersonality'), false, 'personality is not a ruleset override');
const personalityFreeRules = resolveRuleset({
  rulesetOverrides: [{ key: 'botPersonality', value: 'chaos' }, { key: 'market', value: false }],
  settings: { botPersonality: 'chaos' }
});
assert.equal('botPersonality' in personalityFreeRules.effectiveSettings, false);
assert.deepEqual(personalityFreeRules.rulesetOverrides, [{ key: 'market', value: false }]);

// Every optional system starts off. Legacy flags on the raw settings do not
// switch them on by themselves; only explicit overrides do.
const legacy = { maxPlayers: 4, bots: 0, bankLoans: true, casino: true, market: true, globalEvents: true };
const defaults = resolveRuleset({ boardVariant: 'standard-40', settings: legacy });
assert.equal(defaults.boardVariant, 'standard-40');
assert.equal(defaults.effectiveSettings.bankLoans, false);
assert.equal(defaults.effectiveSettings.casino, false);
assert.equal(defaults.effectiveSettings.market, false);
assert.equal(defaults.effectiveSettings.globalEvents, false);
assert.equal('rulesetPreset' in defaults, false, 'the ruleset carries no preset');
assert.equal('rulesetBase' in defaults, false, 'the ruleset carries no base');

const allOn = resolveRuleset({
  boardVariant: 'standard-40',
  rulesetOverrides: [{ key: 'bankLoans', value: true }, { key: 'casino', value: true }, { key: 'market', value: true }, { key: 'globalEvents', value: true }],
  settings: { rulesProfile: 'advanced', maxPlayers: 4 }
});
assert.equal(allOn.effectiveSettings.bankLoans, true);
assert.equal(allOn.effectiveSettings.casino, true);
assert.equal(allOn.effectiveSettings.market, true);
assert.equal(allOn.effectiveSettings.globalEvents, true);

const custom = resolveRuleset({
  boardVariant: 'metro-52',
  rulesetOverrides: [{ key: 'casino', value: false }, { key: 'bankLoans', value: true }, { key: 'marketComplexity', value: 'shorting' }, { key: 'unknown', value: true }],
  settings: { rulesProfile: 'advanced', maxPlayers: 8, bots: 8 }
});
assert.equal(custom.effectiveSettings.casino, false);
assert.equal(custom.effectiveSettings.bankLoans, true);
assert.equal(custom.effectiveSettings.globalEvents, false);
assert.equal(custom.effectiveSettings.marketComplexity, 'shorting');
assert.equal(custom.effectiveSettings.maxPlayers, 6);
assert.equal(custom.effectiveSettings.bots, 5);
assert.deepEqual(custom.rulesetOverrides, [{ key: 'bankLoans', value: true }, { key: 'casino', value: false }, { key: 'marketComplexity', value: 'shorting' }]);
assert.equal(createRulesetDigest(custom), custom.digest);
assert.equal(createRulesetDigest({ ...custom, rulesetOverrides: [...custom.rulesetOverrides].reverse() }), custom.digest);
assert.notEqual(defaults.digest, allOn.digest);
assert.equal(safeBoardVariant('grand-64'), 'standard-40');
assert.equal(boardVariantMeta('metro-52').maxPlayers, 6);
assert.deepEqual(normalizeOverrides({ marketComplexity: 'margin', nope: 1 }), { marketComplexity: 'margin' });
assert.deepEqual(normalizeOverrides({ bankruptMode: 'debt', bankLoanSeverity: 'unsafe' }), { bankruptMode: 'elim', bankLoanSeverity: 'predatory' });
assert.equal(effectiveSettingsFor({ settings: { bankruptMode: 'debt' } }).bankruptMode, 'elim');
const manager = new RoomManager();
const room = manager.createRoom({ socketId: 's1', clientId: 'c1', nickname: 'A', rulesProfile: 'advanced', boardVariant: 'metro-52' });
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

// Presets are gone: the setting is unknown, so the mutation is rejected and
// nothing about the table's add-ons changes.
const addOnRoom = new RoomManager().createRoom({
  socketId: 's-addons',
  clientId: 'c-addons',
  nickname: 'Add-ons',
  rulesProfile: 'advanced',
  rulesetOverrides: [{ key: 'casino', value: true }]
});
const rejectedPreset = addOnRoom.setRoomSetting('rulesetPreset', 'after-hours');
assert.equal(rejectedPreset.changed, false);
assert.equal(rejectedPreset.rejected, true);
assert.equal(rejectedPreset.reason, 'Unknown room setting.');
assert.equal(addOnRoom.getRoomSummary().ruleset.effectiveSettings.casino, true);
assert.equal(addOnRoom.getRoomSummary().ruleset.effectiveSettings.bankLoans, false);

const rejectedUnknown = addOnRoom.setRoomSetting('not-a-setting', true);
assert.equal(rejectedUnknown.changed, false);
assert.equal(rejectedUnknown.rejected, true);
assert.equal(rejectedUnknown.reason, 'Unknown room setting.');
console.log('ruleset registry: 18 passed, 0 failed');
