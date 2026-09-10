import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const manager = new RoomManager();
const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', visibility: 'public' });
const summary = room.getDirectorySummary();
assert.equal(room.visibility, 'public');
assert.equal(summary.code, null);
assert.equal(typeof summary.roomId, 'string');

console.log('rooms directory audit: 1 passed, 0 failed');
