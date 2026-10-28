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

// A retained bankrupt human seat still holds capacity. The rematch
// revives the eliminated seat, so the capacity and the bot math must count
// it: a table that counts only the solvent humans grows past maxPlayers.
{
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'cap-host', clientId: 'cap-host', nickname: 'Host' });
  ['two', 'three', 'four'].forEach(name => room.addOrReconnectPlayer({ socketId: `cap-${name}`, clientId: `cap-${name}`, nickname: name }));
  const capacity = room.settings.maxPlayers;
  assert.equal(room.game.players.length, capacity, 'the table is full');
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const victim = room.game.getPlayerByClient('cap-four');
  room.game.currentPlayerId = room.game.getPlayerByClient('cap-host').id;
  room.game.declareBankruptcy(victim.socketId);
  assert.equal(victim.bankrupt, true, 'the seat is eliminated');
  room.game.endGame();
  // The capacity setting is refused while the retained seat still needs a slot.
  const rejected = room.setRoomSetting('maxPlayers', capacity - 1);
  assert.equal(rejected.rejected, true, 'the capacity cannot drop below the retained seats');
  room.ensureBots();
  assert.equal(room.game.players.filter(player => player.isBot).length, 0, 'a retained bankrupt seat leaves no room for a bot');
  assert.equal(room.game.players.length, capacity, 'the table never grows past maxPlayers');
  assert.equal(room.startGame().success, true, 'the rematch starts');
  assert.equal(room.game.turnOrder.length, capacity, 'the rematch never exceeds maxPlayers');
}

console.log('capacity follow-up: 4 assertions passed, 0 failed');
