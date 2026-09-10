import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function derivativesRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', rulesetPreset: 'after-hours', market: true, marketComplexity: 'derivatives' });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.setRoomSetting('market', true);
  room.setRoomSetting('marketComplexity', 'derivatives');
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

const room = derivativesRoom();
const game = room.game;
const player = game.players[0];
player.cash = 0;
player.marginPositions = { brazil: { quantity: 1, averageCost: 100 } };
player.marginBalance = 100;
player.marginMaintenance = 25;
player.shortPositions = { ghana: { quantity: 1, entryQuote: 100, collateral: 50, borrowFee: 1 } };
player.reservedCash = 50;
player.optionPositions = [{
  id: 'option-a',
  instrumentId: 'thailand',
  side: 'call',
  role: 'buyer',
  quantity: 1,
  strike: 100,
  premium: 10,
  expiryRound: 20,
  collateral: 0,
  reserveHeld: 100,
  maxPayout: 100,
  status: 'open',
  exercised: false
}];
game.marketOptionReserve = 99_900;
game.marketQuotes = { ...game.marketQuotes, brazil: 80, ghana: 100, thailand: 120 };
game.marketShortInventory = { ...game.marketShortInventory, ghana: 49 };

const result = game.liquidateAllMarketPositions(player);
assert.equal(result.success, true);
assert.deepEqual(player.marginPositions, {});
assert.equal(player.marginBalance, 22);
assert.deepEqual(player.shortPositions, {});
assert.equal(player.reservedCash, 0);
assert.equal(player.shortDefaultDebt, 52);
assert.equal(player.optionPositions[0].status, 'closed');
assert.equal(player.optionPositions[0].reserveHeld, 0);
assert.equal(game.marketOptionReserve, 100_000);
assert.ok(player.cash >= 0);

console.log('market settlement audit: 1 passed, 0 failed');
