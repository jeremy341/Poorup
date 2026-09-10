import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const manager = new RoomManager();
const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A' });
room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
room.game.players[0].accountId = 'acct-a';
room.game.players[1].accountId = 'acct-b';
const publicSummary = room.game.getGameSummary();
assert.equal(publicSummary.players.every(player => player.accountId === null), true);
assert.equal(publicSummary.players.every(player => typeof player.roomPlayerId === 'string'), true);
const owner = room.game.getGameSummary(room.game.players[0].id);
assert.equal(owner.players.find(player => player.id === room.game.players[0].id).accountId, 'acct-a');
const roomSummary = room.getRoomSummary();
assert.equal(roomSummary.players.every(player => player.accountId === null), true);

console.log('summary privacy audit: 1 passed, 0 failed');
