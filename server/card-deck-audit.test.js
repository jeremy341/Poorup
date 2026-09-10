import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { tileIndexById } from './boardRegistry.js';

function metroRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', boardVariant: 'metro-52', rulesetPreset: 'after-hours' });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  return room;
}

const room = metroRoom();
const game = room.game;
game.surpriseDeck = [];
game.treasureDeck = [];
const surpriseCards = Array.from({ length: 12 }, () => game.drawCard('surprise'));
const treasureCards = Array.from({ length: 12 }, () => game.drawCard('treasure'));
[...surpriseCards, ...treasureCards]
  .filter(card => card.tileIndex != null)
  .forEach(card => {
    assert.equal(typeof card.tileId, 'string');
    assert.equal(game.getTile(tileIndexById('metro-52', card.tileId))?.tileId, card.tileId);
  });

console.log('card deck audit: 1 passed, 0 failed');
