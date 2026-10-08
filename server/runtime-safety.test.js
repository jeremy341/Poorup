import assert from 'node:assert/strict';
import * as socketRuntime from './socketRuntime.js';
import * as roomSettings from './roomSettings.js';
import { RulesetRegistry } from './rulesetRegistry.js';
import { RoomManager } from './gameLogic.js';

let logged = false;
assert.equal(typeof socketRuntime.runRoomTimer, 'function');
const result = socketRuntime.runRoomTimer('test-timer', 'ROOM1', () => { throw new Error('timer boom'); }, error => { logged = error.message === 'timer boom'; });
assert.equal(result, false);
assert.equal(logged, true);
assert.equal(typeof roomSettings.boundedInteger, 'function');
assert.equal(roomSettings.boundedInteger(1e308, { min: 0, max: 1_000_000 }), null);
assert.equal(roomSettings.boundedInteger(1500, { min: 0, max: 1_000_000 }), 1500);
const registry = new RulesetRegistry();
assert.deepEqual(registry.resolve({ rulesetPreset: 'custom', rulesetOverrides: [{ key: 'startingCash', value: 1e308 }] }).effectiveSettings.startingCash, undefined);
const room = new RoomManager().createRoom({ socketId: 'settings-socket', clientId: 'settings-client', nickname: 'Settings' });
const beforeCash = room.settings.startingCash;
assert.equal(room.setRoomSetting('startingCash', 1e308).rejected, true);
assert.equal(room.settings.startingCash, beforeCash);

console.log('runtime safety: 4 passed, 0 failed');
