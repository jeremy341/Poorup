import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const manager = new RoomManager();
const room = manager.createRoom({ socketId: 'capacity-host', clientId: 'capacity-host', nickname: 'Host' });
room.addOrReconnectPlayer({ socketId: 'capacity-two', clientId: 'capacity-two', nickname: 'Two' });
room.addOrReconnectPlayer({ socketId: 'capacity-three', clientId: 'capacity-three', nickname: 'Three' });
assert.equal(room.setRoomSetting('bots', 1).rejected, false);
room.ensureBots();
assert.equal(room.game.players.filter(player => player.isBot).length, 1);

// Re-running reconciliation sees three retained humans plus one existing bot
// in a four-seat room. Existing bots up to settings.bots must survive the
// desired-count reconciliation.
room.ensureBots();
assert.equal(room.game.players.filter(player => !player.isBot && !player.bankrupt).length, 3);
assert.equal(room.game.players.filter(player => player.isBot).length, 1);

console.log('capacity follow-up: 4 assertions passed, 0 failed');
