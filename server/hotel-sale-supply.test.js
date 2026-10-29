// Hotel sales return the deed to four houses without depending on any shared
// bank inventory or legacy houseLimit/hotelLimit settings.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function hotelRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const owner = game.players[0];
  game.currentPlayerId = owner.id;
  for (const index of [1, 3]) {
    const tile = game.getTile(index);
    tile.ownerId = owner.id;
    owner.properties.push(tile.index);
    tile.houseCount = 5;
  }
  return { game, owner };
}

{
  const { game } = hotelRoom();
  game.settings.houseLimit = 0;
  game.settings.hotelLimit = 0;
  for (const tile of game.tiles.filter(entry => entry.type === 'property' && ![1, 3].includes(entry.index))) {
    tile.houseCount = 4;
  }
  assert.ok(game.tiles.reduce((total, tile) => total + (tile.type === 'property' ? tile.houseCount || 0 : 0), 0) > 32);

  const result = game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' });
  assert.deepEqual(result, { success: true });
  assert.equal(game.getTile(1).houseCount, 4, 'the hotel downgrades to four houses');
  const cashAfterSale = game.players[0].cash;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' }).success, false, 'the remaining hotel in the set still enforces even selling');
  assert.equal(game.getTile(1).houseCount, 4);
  assert.equal(game.players[0].cash, cashAfterSale);
}

console.log('hotel sale supply: 1 passed');
