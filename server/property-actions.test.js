// Characterization suite for GameState.manageProperty: pins every rejection
// message, cash delta, counter bump, feed message, and event-modified formula
// of the four property actions (build-house, sell-house, mortgage, unmortgage)
// plus the debt-settlement tail. Captured from the pre-refactor method; the
// action-table extraction must keep it green.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

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
  const other = game.players[1];
  game.currentPlayerId = owner.id;
  const give = (index) => {
    const tile = game.getTile(index);
    tile.ownerId = owner.id;
    owner.properties.push(tile.index);
    return tile;
  };
  // Pin manageProperty itself: the ownership/level gates are covered by the
  // gate test below via prototype restore or explicit false stubs.
  game.canBuildOnTile = () => true;
  game.canSellFromTile = () => true;
  game.canMortgageTile = () => true;
  game.canUnmortgageTile = () => true;
  return { room, game, owner, other, give };
}

const lastFeed = game => game.feed[0]?.text;
const reject = (game, socket, tileIndex, action, error) =>
  assert.deepEqual(game.manageProperty(socket, { tileIndex, action }), { success: false, error });

check('rejects unknown actions, unowned tiles, and missing pieces', () => {
  const { game, give } = ownedRoom();
  give(1);
  reject(game, 'socket-a', 1, 'polish', 'Unknown property action.');
  reject(game, 'socket-b', 1, 'mortgage', 'You do not own this property.');
  reject(game, 'socket-z', 1, 'mortgage', 'Property not found.');
  reject(game, 'socket-a', 99, 'mortgage', 'Property not found.');
  assert.deepEqual(game.manageProperty('socket-a', {}), { success: false, error: 'Property not found.' });
});

check('build-house on turn pre-roll pays cost and bumps counters', () => {
  const { game, owner, give } = ownedRoom();
  const tile = give(1);
  owner.cash = 1200;
  const cost = game.getPropertyHouseCost(tile);
  assert.deepEqual(game.manageProperty('socket-a', { tileIndex: 1, action: 'build-house' }), { success: true });
  assert.equal(owner.cash, 1200 - cost);
  assert.equal(tile.houseCount, 1);
  assert.equal(owner.buildActionsThisTurn, 1);
  assert.equal(lastFeed(game), 'A built a house on ' + tile.name + '.');
});

check('build/sell gated to owner turn and pre-roll window', () => {
  const { game, owner, other, give } = ownedRoom();
  give(1);
  game.currentPlayerId = other.id;
  reject(game, 'socket-a', 1, 'build-house', 'You can only build or sell during your turn.');
  game.currentPlayerId = owner.id;
  game.hasRolled = true;
  reject(game, 'socket-a', 1, 'sell-house', 'You can only build or sell before rolling the dice.');
  game.extraRollPending = true;
  delete game.canSellFromTile;
  assert.deepEqual(game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' }).error, 'You cannot sell a house from this property right now.');
});

check('build blocked when insufficient cash or construction rules fail', () => {
  const { game, owner, give } = ownedRoom();
  const tile = give(1);
  owner.cash = 10;
  reject(game, 'socket-a', 1, 'build-house', 'Insufficient cash to build a house.');
  owner.cash = 1200;
  delete game.canBuildOnTile;
  tile.mortgaged = true;
  reject(game, 'socket-a', 1, 'build-house', 'You cannot build on this property right now.');
});

check('hotel boundary: fifth build says hotel, selling a hotel says hotel', () => {
  const up = ownedRoom();
  const builtTile = up.give(1);
  builtTile.houseCount = 4;
  up.owner.cash = 5000;
  up.game.canBuildOnTile = () => true;
  assert.equal(up.game.manageProperty('socket-a', { tileIndex: 1, action: 'build-house' }).success, true);
  assert.equal(builtTile.houseCount, 5);
  assert.match(lastFeed(up.game), /built a hotel on /);
  const down = ownedRoom();
  const soldTile = down.give(1);
  soldTile.houseCount = 5;
  down.game.canSellFromTile = () => true;
  assert.equal(down.game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' }).success, true);
  assert.equal(soldTile.houseCount, 4);
  assert.match(lastFeed(down.game), /sold a hotel from /);
});

check('event building limit caps per-turn builds', () => {
  const { game, owner, give } = ownedRoom();
  give(1);
  owner.cash = 5000;
  game.globalEvent = { id: 'test-limit', phase: 'active', effects: { buildingLimitPerTurn: 1 } };
  owner.buildActionsThisTurn = 1;
  reject(game, 'socket-a', 1, 'build-house', 'The active event limits building actions this turn.');
  owner.buildActionsThisTurn = 0;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'build-house' }).success, true);
});

check('public-works election tracks builds, evenBuild counts, bubble rebuild flags', () => {
  const { game, owner, give } = ownedRoom();
  give(1);
  owner.cash = 5000;
  game.settings.evenBuild = true;
  game.globalEvent = { id: 'city-election', phase: 'active', resolvedChoice: 'public-works', effects: {} };
  owner.housingBubbleEnded = true;
  owner.soldBuildingsDuringHousingBubble = 2;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'build-house' }).success, true);
  assert.equal(owner.publicWorksBuilds, 1);
  assert.equal(owner.evenBuilds, 1);
  assert.equal(owner.rebuiltAfterHousingBubble, true);
});

check('sell-house refunds half of the house cost, honors sale multiplier', () => {
  const { game, owner, give } = ownedRoom();
  const tile = give(1);
  tile.houseCount = 2;
  owner.cash = 0;
  const cost = game.getPropertyHouseCost(tile);
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' }).success, true);
  assert.equal(owner.cash, Math.floor(cost * 0.5));
  assert.equal(tile.houseCount, 1);
  assert.equal(lastFeed(game), 'A sold a house from ' + tile.name + '.');
  game.globalEvent = { id: 'test-sale', phase: 'active', effects: { buildingSaleMultiplier: 1 } };
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' }).success, true);
  assert.equal(owner.cash, Math.floor(cost * 0.5) + Math.floor(cost * 1));
  assert.equal(tile.houseCount, 0);
});


check('mortgage pays half price times value multiplier; unmortgage costs 110 percent', () => {
  const { game, owner, give } = ownedRoom();
  const tile = give(1);
  const half = Math.floor((tile.price || 0) / 2);
  owner.cash = 0;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }).success, true);
  assert.equal(owner.cash, half);
  assert.equal(tile.mortgaged, true);
  assert.equal(lastFeed(game), 'A mortgaged ' + tile.name + ' for $' + half + '.');
  const restoreCost = Math.ceil(half * 1.1);
  owner.cash = restoreCost - 1;
  reject(game, 'socket-a', 1, 'unmortgage', 'Insufficient cash to unmortgage this property.');
  owner.cash = restoreCost;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'unmortgage' }).success, true);
  assert.equal(owner.cash, 0);
  assert.equal(tile.mortgaged, false);
  assert.equal(lastFeed(game), 'A unmortgaged ' + tile.name + '.');
});

check('event value multiplier scales mortgage proceeds', () => {
  const { game, owner, give } = ownedRoom();
  const tile = give(1);
  owner.cash = 0;
  game.globalEvent = { id: 'test-value', phase: 'active', effects: { propertyValueMultiplier: 2 } };
  const half = Math.floor((tile.price || 0) / 2);
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }).success, true);
  assert.equal(owner.cash, half * 2);
});

check('mortgage blocked while buildings stand; unmortgage requires mortgage', () => {
  const { game, give } = ownedRoom();
  const tile = give(1);
  tile.houseCount = 1;
  game.canMortgageTile = () => false;
  reject(game, 'socket-a', 1, 'mortgage', 'You cannot mortgage this property right now.');
  game.canMortgageTile = () => true;
  game.canUnmortgageTile = () => false;
  reject(game, 'socket-a', 1, 'unmortgage', 'You cannot unmortgage this property right now.');
});

check('debt settlement: build refused, sell allowed, proceeds auto-settle', () => {
  const { game, owner, other, give } = ownedRoom();
  const tile = give(1);
  tile.houseCount = 2;
  game.currentPlayerId = other.id;
  game.pendingPayment = { playerId: owner.id, creditorId: other.id, amountRemaining: 10 };
  reject(game, 'socket-a', 1, 'build-house', 'You cannot build while settling a debt.');
  const cost = game.getPropertyHouseCost(tile);
  owner.cash = 0;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' }).success, true);
  assert.equal(game.pendingPayment, null);
  assert.equal(owner.cash, Math.floor(cost * 0.5) - 10);
});

const failed = results.filter(r => !r).length;
console.log(`\nproperty action tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
