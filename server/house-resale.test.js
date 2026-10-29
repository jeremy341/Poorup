// A house sold back to the bank pays half its cost (rules page: "sell houses or hotels to the bank ... for half their cost").
// The cost basis is the printed group house cost, never more than the current build cost, so a house built cheaply during a
// cost-cutting event cannot sell for more than it cost once a cost-raising event inflates the build price.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { PROPERTY_HOUSE_COST_BY_GROUP } from './gameData.js';
import { seizeLoanCollateral } from './loanLogic.js';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS - ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

function ownedRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const owner = game.players[0];
  game.currentPlayerId = owner.id;
  const tile = game.getTile(1);
  tile.ownerId = owner.id;
  owner.properties.push(tile.index);
  game.canBuildOnTile = () => true;
  game.canSellFromTile = () => true;
  return { game, owner, tile };
}

const setEvent = (game, effects) => {
  game.globalEvent = { id: 'test-event', phase: 'active', effects };
};

check('a house built cheap and sold under a cost-raising event does not create cash', () => {
  const { game, owner, tile } = ownedRoom();
  const base = PROPERTY_HOUSE_COST_BY_GROUP[tile.group];
  setEvent(game, { buildingCostMultiplier: 0.65 });
  owner.cash = 1000;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'build-house' }).success, true);
  const paid = 1000 - owner.cash;
  assert.equal(paid, Math.ceil(base * 0.65));
  setEvent(game, { buildingCostMultiplier: 1.5 });
  const before = owner.cash;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' }).success, true);
  const payout = owner.cash - before;
  assert.equal(payout, Math.floor(base * 0.5), 'resale is half the printed house cost');
  assert.ok(payout <= paid, `resale ${payout} must not exceed the ${paid} paid`);
  assert.equal(tile.houseCount, 0);
});

check('the sale projection shows the same resale value the sale pays', () => {
  const { game, owner, tile } = ownedRoom();
  const base = PROPERTY_HOUSE_COST_BY_GROUP[tile.group];
  tile.houseCount = 1;
  setEvent(game, { buildingCostMultiplier: 1.5 });
  const projected = game.propertyActionProjection(owner, tile);
  assert.equal(projected.sellHouse.cost, Math.floor(base * 0.5));
});

check('a cost-cutting event still caps the resale at half the current cost', () => {
  const { game, owner, tile } = ownedRoom();
  const base = PROPERTY_HOUSE_COST_BY_GROUP[tile.group];
  tile.houseCount = 1;
  setEvent(game, { buildingCostMultiplier: 0.65 });
  owner.cash = 0;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' }).success, true);
  assert.equal(owner.cash, Math.floor(Math.ceil(base * 0.65) * 0.5));
});

check('with no event the resale stays half the house cost', () => {
  const { game, owner, tile } = ownedRoom();
  const base = PROPERTY_HOUSE_COST_BY_GROUP[tile.group];
  tile.houseCount = 1;
  owner.cash = 0;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' }).success, true);
  assert.equal(owner.cash, Math.floor(base * 0.5));
});

check('a bank seizure liquidates houses on the same resale basis as a sale', () => {
  const { game, owner, tile } = ownedRoom();
  const base = PROPERTY_HOUSE_COST_BY_GROUP[tile.group];
  tile.houseCount = 3;
  setEvent(game, { buildingCostMultiplier: 1.5 });
  owner.cash = 0;
  seizeLoanCollateral(game, owner, tile);
  assert.equal(owner.cash, Math.floor(3 * base * 0.5));
  assert.equal(tile.houseCount, 0);
  assert.equal(tile.ownerId, null);
});

const failed = results.filter(r => !r).length;
console.log(`\nhouse resale tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
