// Characterization suite for GameState.manageProperty: pins rejection
// precedence, cash changes, messages, basis and debt settlement across
// building, mortgage, and bank deed-sale actions.
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

check('bank deed buyback is unavailable even through manageProperty and direct handler paths', () => {
  const { room, game, owner, other, give } = ownedRoom();
  const tile = give(1);
  tile.purchasePricePaid = 275;
  owner.cash = 0;
  const sale = { tileIndex: 1, action: 'sell-deed', requestId: 'stale-sale-request' };
  assert.deepEqual(game.manageProperty('socket-a', sale), { success: false, error: 'Bank deed buyback is unavailable. Trade the deed to another player.' });
  assert.deepEqual(game.manageProperty('socket-a', sale), { success: false, error: 'Bank deed buyback is unavailable. Trade the deed to another player.' });
  assert.deepEqual(game.sellDeedPropertyAction(owner, tile), { success: false, error: 'Bank deed buyback is unavailable. Trade the deed to another player.' });
  assert.equal(owner.cash, 0);
  assert.equal(tile.ownerId, owner.id);
  assert.equal(game.deedSaleTransactions, undefined);

  const traded = give(3);
  traded.purchasePricePaid = 157;
  game.applyPropertyOwnershipChange(owner, other, traded);
  assert.equal(traded.purchasePricePaid, 157, 'ownership transfer keeps last real bank or auction purchase cost');
  const reconnect = room.addOrReconnectPlayer({ socketId: 'socket-b-reconnected', clientId: 'client-b', nickname: other.nickname });
  assert.equal(reconnect.success, true);
  assert.equal(JSON.parse(JSON.stringify(game.getGameSummary(other.id))).tiles.find(entry => entry.index === traded.index).propertyActions.sellDeed, undefined);
});

check('trade deed projection is free of a price and respects tradability, room setting, and active seat', () => {
  const { game, owner, other, give } = ownedRoom();
  const deed = give(1);
  const projection = () => game.getGameSummary(owner.id).tiles.find(entry => entry.index === deed.index).propertyActions.tradeDeed;
  assert.deepEqual(projection(), { enabled: true, reason: null });
  assert.equal(game.getGameSummary(other.id).tiles.find(entry => entry.index === deed.index).propertyActions, undefined);
  game.getTile(3).ownerId = owner.id;
  owner.properties.push(3);
  game.getTile(3).houseCount = 1;
  assert.equal(projection().enabled, false, 'buildings anywhere in the owned color set block trade');
  game.getTile(3).houseCount = 0;
  deed.mortgaged = true;
  assert.deepEqual(projection(), { enabled: true, reason: null }, 'a mortgage does not block trade');
  game.pendingPayment = { playerId: owner.id, creditorId: other.id, amountRemaining: 100 };
  assert.deepEqual(projection(), { enabled: true, reason: null }, 'player-to-player trade remains an allowed debt rescue');
  game.pendingPayment = null;
  game.pendingTrade = {};
  assert.equal(projection().reason, 'Another trade is already pending.');
  game.pendingTrade = null;
  game.pendingPlayerContract = {};
  assert.equal(projection().reason, 'Resolve the pending player contract before proposing a trade.');
  game.pendingPlayerContract = null;
  game.settings.trading = false;
  assert.match(projection().reason, /Trading is disabled/);
  game.settings.trading = true;
  owner.disconnected = true;
  assert.equal(projection().enabled, false);
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

check('build is turn-gated while selling a building stays legal off turn and post-roll', () => {
  const { game, other, give } = ownedRoom();
  const tile = give(1);
  tile.houseCount = 1;
  game.currentPlayerId = other.id;
  reject(game, 'socket-a', 1, 'build-house', 'You can only build during your turn.');
  game.hasRolled = true;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' }).success, true);
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

check('build-house ignores zero legacy caps after the board exceeds 32 houses', () => {
  const { game, owner, give } = ownedRoom();
  const target = give(1);
  const groupMate = give(3);
  for (const tile of game.tiles.filter(entry => entry.type === 'property')) {
    if (tile.index === target.index || tile.index === groupMate.index) continue;
    give(tile.index);
    tile.houseCount = 4;
  }
  game.settings.evenBuild = false;
  game.settings.houseLimit = 0;
  game.settings.hotelLimit = 0;
  assert.ok(game.tiles.reduce((total, tile) => total + (tile.type === 'property' ? tile.houseCount || 0 : 0), 0) > 32);
  owner.cash = 50000;
  delete game.canBuildOnTile;
  assert.equal(game.manageProperty('socket-a', { tileIndex: target.index, action: 'build-house' }).success, true);
  assert.equal(target.houseCount, 1);
});

check('build-house ignores zero legacy caps after the board exceeds 12 hotels', () => {
  const { game, owner, give } = ownedRoom();
  const target = give(1);
  const groupMate = give(3);
  target.houseCount = 4;
  groupMate.houseCount = 4;
  for (const tile of game.tiles.filter(entry => entry.type === 'property')) {
    if (tile.index === target.index || tile.index === groupMate.index) continue;
    give(tile.index);
    tile.houseCount = 5;
  }
  game.settings.evenBuild = false;
  game.settings.houseLimit = 0;
  game.settings.hotelLimit = 0;
  assert.ok(game.tiles.filter(tile => tile.type === 'property' && tile.houseCount === 5).length > 12);
  owner.cash = 50000;
  delete game.canBuildOnTile;
  assert.equal(game.manageProperty('socket-a', { tileIndex: target.index, action: 'build-house' }).success, true);
  assert.equal(target.houseCount, 5);
  const cashAfterHotel = owner.cash;
  assert.equal(game.manageProperty('socket-a', { tileIndex: target.index, action: 'build-house' }).success, false, 'unlimited shared supply does not remove the one-hotel-per-deed cap');
  assert.equal(target.houseCount, 5);
  assert.equal(owner.cash, cashAfterHotel);
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

check('event value multiplier keeps unmortgage pricing symmetric', () => {
  const { game, owner, give } = ownedRoom();
  const tile = give(1);
  tile.mortgaged = true;
  game.globalEvent = { id: 'test-value', phase: 'active', effects: { propertyValueMultiplier: 0.8 } };
  const cost = Math.ceil(Math.floor((tile.price || 0) / 2) * 1.1 * 0.8);
  owner.cash = cost;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'unmortgage' }).success, true);
  assert.equal(owner.cash, 0);
  assert.equal(tile.mortgaged, false);
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

check('mortgage requires every building in the color set to be sold first', () => {
  const { game, owner, give } = ownedRoom();
  const target = give(1);
  const sibling = give(3);
  sibling.houseCount = 1;
  delete game.canMortgageTile;
  assert.equal(game.canMortgageTile(owner, target), false);
  sibling.houseCount = 0;
  assert.equal(game.canMortgageTile(owner, target), true);
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

check('transferMoney rejects non-finite amounts without touching seats', () => {  const { game } = ownedRoom();
  const from = { cash: 100 };
  const to = { cash: 50 };
  game.transferMoney(from, to, NaN, 'nan');
  game.transferMoney(from, to, Infinity, 'inf');
  game.transferMoney(from, to, 0, 'zero');
  game.transferMoney(from, to, -10, 'neg');
  assert.deepEqual([from.cash, to.cash], [100, 50]);
  game.transferMoney(from, to, 30, 'ok');
  assert.deepEqual([from.cash, to.cash], [70, 80]);
});

check('dead seats cannot build or sell', () => {  const { game } = ownedRoom();
  const owner = game.players[0];
  owner.disconnected = true;
  assert.deepEqual(
    game.manageProperty('socket-a', { tileIndex: 1, action: 'build-house' }),
    { success: false, error: 'Property access is unavailable right now.' }
  );
  assert.deepEqual(
    game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' }),
    { success: false, error: 'Property access is unavailable right now.' }
  );
});

check('mortgage never blocked by debt — only endTurn is', () => {
  const { game, owner, give } = ownedRoom();
  give(1);
  game.pendingPayment = { playerId: owner.id, creditorId: game.players[1].id, amountRemaining: 40 };
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }).success, true);
  // Someone else's debt also does not block your mortgage.
  give(3);
  game.pendingPayment = { playerId: game.players[1].id, creditorId: owner.id, amountRemaining: 40 };
  assert.equal(game.manageProperty('socket-a', { tileIndex: 3, action: 'mortgage' }).success, true);
});

// The stubbed ownedRoom() above replaces canBuildOnTile and canSellFromTile, so
// the real even-build rule (propertyRules.js evenBuildAllows and its sell mirror)
// never ran in this file (F-048). The checks below use a room whose build and
// sell predicates are the real ones; only tile levels and evenBuild vary.
function pairRoom(evenBuild) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.setRoomSetting('evenBuild', evenBuild);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const owner = game.players[0];
  game.currentPlayerId = owner.id;
  owner.cash = 5000;
  const claim = index => {
    const tile = game.getTile(index);
    tile.ownerId = owner.id;
    owner.properties.push(tile.index);
    return tile;
  };
  const first = claim(1);
  const second = claim(3);
  assert.equal(first.group, second.group, 'tiles 1 and 3 form one colour group');
  assert.equal(game.settings.evenBuild, evenBuild);
  return { game, owner, first, second };
}

check('even build rejects an uneven street with the real rule (F-048)', () => {
  const { game, owner, first, second } = pairRoom(true);
  first.houseCount = 1;
  second.houseCount = 0;
  reject(game, 'socket-a', first.index, 'build-house', 'You cannot build on this property right now.');
  assert.equal(first.houseCount, 1);
  assert.equal(owner.cash, 5000);
});

check('even build accepts a build on the lowest tile of a street (real rule)', () => {
  const { game, owner, first, second } = pairRoom(true);
  first.houseCount = 1;
  second.houseCount = 2;
  const cost = game.getPropertyHouseCost(first);
  assert.deepEqual(game.manageProperty('socket-a', { tileIndex: first.index, action: 'build-house' }), { success: true });
  assert.equal(first.houseCount, 2);
  assert.equal(owner.cash, 5000 - cost);
});

check('even sell rejects selling from a tile below the street maximum (real rule)', () => {
  const { game, owner, first, second } = pairRoom(true);
  first.houseCount = 1;
  second.houseCount = 2;
  reject(game, 'socket-a', first.index, 'sell-house', 'You cannot sell a house from this property right now.');
  assert.equal(first.houseCount, 1);
  assert.equal(owner.cash, 5000);
});

check('even sell accepts selling from the street maximum (real rule)', () => {
  const { game, owner, first, second } = pairRoom(true);
  first.houseCount = 2;
  second.houseCount = 1;
  const refund = Math.floor(game.getPropertyHouseCost(first) * 0.5);
  assert.deepEqual(game.manageProperty('socket-a', { tileIndex: first.index, action: 'sell-house' }), { success: true });
  assert.equal(first.houseCount, 1);
  assert.equal(owner.cash, 5000 + refund);
});

check('evenBuild off accepts an uneven build (real rule)', () => {
  const { game, owner, first, second } = pairRoom(false);
  first.houseCount = 1;
  second.houseCount = 0;
  const cost = game.getPropertyHouseCost(first);
  assert.deepEqual(game.manageProperty('socket-a', { tileIndex: first.index, action: 'build-house' }), { success: true });
  assert.equal(first.houseCount, 2);
  assert.equal(owner.cash, 5000 - cost);
});

check('evenBuild off accepts an uneven sell (real rule)', () => {
  const { game, first, second } = pairRoom(false);
  first.houseCount = 1;
  second.houseCount = 2;
  assert.deepEqual(game.manageProperty('socket-a', { tileIndex: first.index, action: 'sell-house' }), { success: true });
  assert.equal(first.houseCount, 0);
});

check('unmortgage is exactly 110 percent of the mortgage value, with no float drift', () => {
  // 50 * 1.1 is 55.00000000000001 in floating point, which a bare ceil turns into 56.
  const { game, owner, give } = ownedRoom();
  const tile = give(6);
  assert.equal(Math.floor(tile.price / 2), 50);
  tile.mortgaged = true;
  assert.equal(game.getGameSummary(owner.id).tiles.find(entry => entry.index === 6).propertyActions.unmortgage.cost, 55);
  owner.cash = 54;
  reject(game, 'socket-a', 6, 'unmortgage', 'Insufficient cash to unmortgage this property.');
  owner.cash = 55;
  assert.equal(game.manageProperty('socket-a', { tileIndex: 6, action: 'unmortgage' }).success, true);
  assert.equal(owner.cash, 0);
});

check('manageProperty with an inherited object key is an unknown action, not a throw', () => {
  const { game, give } = ownedRoom();
  give(1);
  for (const action of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 7, null, {}]) {
    reject(game, 'socket-a', 1, action, 'Unknown property action.');
  }
});

check('declining or failing to afford a deed during a Bank Run acks success once the turn has resolved', () => {
  const { game, owner } = ownedRoom();
  const tile = game.getTile(1);
  tile.ownerId = null;
  game.globalEvent = { id: 'bank-run', phase: 'active', effects: { auctionBlocked: true } };
  owner.position = 1;
  game.hasRolled = true;
  game.pendingPurchaseOffer = { playerId: owner.id, tileIndex: 1 };
  const declined = game.declineProperty('socket-a', 1);
  assert.equal(declined.success, true, 'the decline happened, so the ack is a success');
  assert.match(declined.message, /paused/);
  assert.equal(game.pendingPurchaseOffer, null);
  assert.equal(game.awaitingEndTurn, true);
  assert.equal(game.auction, null);

  const second = ownedRoom();
  second.game.getTile(1).ownerId = null;
  second.game.globalEvent = { id: 'bank-run', phase: 'active', effects: { auctionBlocked: true } };
  second.owner.cash = 0;
  const landed = second.game.applyTile(second.owner, second.game.getTile(1), {});
  assert.equal(landed.success, true, 'the landing happened, so the roll is a success');
  assert.equal(second.game.awaitingEndTurn, true);
  assert.equal(second.game.startAuction(second.game.getTile(1), second.owner.id).success, false, 'startAuction itself still reports the block');
});

check('a queued debt reserves the cash it is owed, so a deed cannot be bought with it', () => {
  const { game, owner, other } = ownedRoom();
  const tile = game.getTile(1);
  tile.ownerId = null;
  owner.cash = tile.price + 100;
  // The head claim belongs to the other seat, so only the queue carries ours.
  game.pendingPayment = { playerId: other.id, creditorId: owner.id, amountRemaining: 100 };
  game.pendingPaymentQueue = [{ payment: { playerId: owner.id, creditorId: other.id, amountRemaining: 200 }, hooks: {}, turnOptions: {} }];
  game.pendingPurchaseOffer = { playerId: owner.id, tileIndex: 1 };
  assert.deepEqual(game.purchaseProperty('socket-a', 1), { success: false, error: 'Insufficient cash to purchase this property.' });
  assert.equal(tile.ownerId, null, 'the deed stays unowned while the queued debt is unpaid');
  // The head claim reserves the same cash.
  game.pendingPayment = { playerId: owner.id, creditorId: other.id, amountRemaining: 200 };
  game.pendingPaymentQueue = [];
  assert.deepEqual(game.purchaseProperty('socket-a', 1), { success: false, error: 'Insufficient cash to purchase this property.' });
  // With the debt settled the same cash buys the deed.
  game.pendingPayment = null;
  assert.deepEqual(game.purchaseProperty('socket-a', 1), { success: true });
  assert.equal(tile.ownerId, owner.id);
  assert.equal(tile.purchasePricePaid, tile.price, 'direct bank purchase records the cash paid');
});

check('a queued debt blocks building and unmortgaging, but selling to raise cash stays legal', () => {
  const { game, owner, other, give } = ownedRoom();
  const tile = give(1);
  tile.houseCount = 1;
  const deed = give(6);
  deed.mortgaged = true;
  owner.cash = 5000;
  // The head claim is the other seat's; ours waits in the queue behind it.
  game.pendingPayment = { playerId: other.id, creditorId: owner.id, amountRemaining: 100 };
  game.pendingPaymentQueue = [{ payment: { playerId: owner.id, creditorId: other.id, amountRemaining: 200 }, hooks: {}, turnOptions: {} }];
  reject(game, 'socket-a', 1, 'build-house', 'You cannot build while settling a debt.');
  assert.equal(tile.houseCount, 1, 'no house is built while the queued debt is unpaid');
  reject(game, 'socket-a', 6, 'unmortgage', 'You cannot unmortgage while settling a debt.');
  assert.equal(deed.mortgaged, true, 'the deed stays mortgaged while the queued debt is unpaid');
  // Selling to raise cash stays legal for a debtor.
  assert.equal(game.manageProperty('socket-a', { tileIndex: 1, action: 'sell-house' }).success, true);
});

check('property management is refused once the match is over', () => {
  const { game, owner, give } = ownedRoom();
  const tile = give(1);
  const deed = give(6);
  deed.mortgaged = true;
  owner.cash = 5000;
  game.endGame(null, { reason: 'test' });
  assert.equal(game.started, false);
  reject(game, 'socket-a', 1, 'build-house', 'The game is not running.');
  reject(game, 'socket-a', 1, 'sell-house', 'The game is not running.');
  reject(game, 'socket-a', 1, 'mortgage', 'The game is not running.');
  reject(game, 'socket-a', 6, 'unmortgage', 'The game is not running.');
  assert.equal(tile.mortgaged, false, 'a finished match cannot be mortgaged');
  assert.equal(deed.mortgaged, true, 'a finished match cannot be unmortgaged');
});

check('a buyer whose cash lands exactly on zero records the empty-wallet fact', () => {
  const { game, owner } = ownedRoom();
  const tile = game.getTile(1);
  tile.ownerId = null;
  owner.cash = tile.price;
  game.pendingPurchaseOffer = { playerId: owner.id, tileIndex: 1 };
  assert.deepEqual(game.purchaseProperty('socket-a', 1), { success: true });
  assert.equal(owner.cash, 0);
  assert.equal(tile.purchasePricePaid, tile.price);
  assert.equal(owner.zeroCashReached, true, 'the null-player fact follows a purchase that empties the wallet');
});

const failed = results.filter(r => !r).length;
console.log(`\nproperty action tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
