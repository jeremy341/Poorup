import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { tileIndexById } from './boardRegistry.js';

function metroRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', boardVariant: 'metro-52', rulesetOverrides: { bankLoans: true, casino: true, market: true, globalEvents: true } });
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

// A held Get-Out-of-Prison card stays out of the refill: no duplicates.
game.surpriseDeck = [];
game.players[0].jailFreeCards = 1;
game.drawCard('surprise');
assert.equal(game.surpriseDeck.some(card => card.action === 'jailFree'), false);

// Each deck owns one Get-Out-of-Prison card. A card held from the surprise deck
// must not strip the treasure deck's own copy when treasure refills.
{
  const holderRoom = metroRoom();
  const holderGame = holderRoom.game;
  const holder = holderGame.players[0];
  holderGame.currentPlayerId = holder.id;
  holderGame.surpriseDeck = holderGame.surpriseDeck.filter(card => card.action === 'jailFree').slice(0, 1);
  assert.equal(holderGame.surpriseDeck.length, 1, 'the surprise deck owns a jail-free card');
  holderGame.handleChanceTile(holder, {}, 'surprise');
  assert.equal(holder.jailFreeCards, 1);
  holderGame.treasureDeck = [];
  const drawn = holderGame.drawCard('treasure');
  assert.equal([...holderGame.treasureDeck, drawn].some(card => card.action === 'jailFree'), true,
    'the treasure deck keeps its own jail-free card');
  holderGame.surpriseDeck = [];
  const drawnSurprise = holderGame.drawCard('surprise');
  assert.equal([...holderGame.surpriseDeck, drawnSurprise].some(card => card.action === 'jailFree'), false,
    'the held surprise card is still excluded from the surprise refill');
}

// A bankrupt seat can never use its card, so it must not hold it off the decks.
{
  const bankruptRoom = metroRoom();
  const bankruptGame = bankruptRoom.game;
  bankruptGame.players[0].jailFreeCards = 1;
  bankruptGame.players[0].bankrupt = true;
  bankruptGame.surpriseDeck = [];
  const drawn = bankruptGame.drawCard('surprise');
  assert.equal([...bankruptGame.surpriseDeck, drawn].some(card => card.action === 'jailFree'), true);
}

console.log('card deck audit: 4 passed, 0 failed');
