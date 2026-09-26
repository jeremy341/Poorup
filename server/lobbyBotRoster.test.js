import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const manager = new RoomManager();
const room = manager.createRoom({ socketId: 'roster-host', clientId: 'roster-host-client', nickname: 'Host' });
room.setRoomSetting('boardVariant', 'metro-52');
room.setRoomSetting('maxPlayers', 6);
room.setRoomSetting('bots', 3);
let bots = room.game.players.filter(player => player.isBot);
assert.equal(bots.length, 3, 'bot count immediately creates reserved lobby seats');
const originalRoster = bots.map(({ id, nickname, clientId }) => ({ id, nickname, clientId }));
assert.equal(new Set(bots.map(player => player.nickname)).size, 3, 'bot names are unique within the room');
assert.equal(new Set(bots.map(player => player.nickname)).size, new Set(originalRoster.map(player => player.nickname)).size);

room.setRoomSetting('bots', 5);
bots = room.game.players.filter(player => player.isBot);
assert.equal(bots.length, 5, 'increasing bot count immediately adds seats');
assert.deepEqual(bots.slice(0, 3).map(({ id, nickname, clientId }) => ({ id, nickname, clientId })), originalRoster);

room.setRoomSetting('bots', 2);
bots = room.game.players.filter(player => player.isBot);
assert.equal(bots.length, 2, 'decreasing bot count removes excess seats');
assert.deepEqual(bots.map(({ id, nickname, clientId }) => ({ id, nickname, clientId })), originalRoster.slice(0, 2));

room.setRoomSetting('bots', 3);
bots = room.game.players.filter(player => player.isBot);
const namesBeforeStart = bots.map(player => player.nickname);
assert.equal(room.startGame().success, true);
assert.deepEqual(room.game.players.filter(player => player.isBot).map(player => player.nickname), namesBeforeStart);

const crowded = manager.createRoom({ socketId: 'capacity-host', clientId: 'capacity-client', nickname: 'Host' });
crowded.addOrReconnectPlayer({ socketId: 'capacity-guest', clientId: 'capacity-guest-client', nickname: 'Guest' });
crowded.setRoomSetting('bots', 2);
assert.equal(crowded.setRoomSetting('maxPlayers', 2).rejected, false, 'capacity can be lowered to retained human seats');
assert.equal(crowded.game.players.filter(player => player.isBot).length, 0, 'bot seats clamp to the reduced room capacity');

const humanPriority = manager.createRoom({ socketId: 'human-priority-host', clientId: 'human-priority-host-client', nickname: 'Host' });
humanPriority.setRoomSetting('bots', 1);
for (let index = 0; index < 3; index += 1) {
  const result = humanPriority.addOrReconnectPlayer({
    socketId: `human-priority-${index}`,
    clientId: `human-priority-client-${index}`,
    nickname: `Human ${index}`,
  });
  assert.equal(result.success, true, 'a reserved bot yields a full-capacity seat to a joining human');
}
assert.equal(humanPriority.game.players.filter(player => player.isBot).length, 0);

console.log('lobby bot roster: stable unique names, immediate resizing, and capacity clamp passed');
