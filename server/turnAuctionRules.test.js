// Focused behavior regressions for reconsiderable auctions and property
// management across the active turn and open obligations.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { decideBotAuction } from './botLogic.js';

function startedRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [a, b] = game.players;
  game.currentPlayerId = a.id;
  return { room, game, a, b };
}

function giveGroup(game, player, tileIndex) {
  const tile = game.getTile(tileIndex);
  for (const member of game.getGroupTiles(tile.group)) {
    member.ownerId = player.id;
    if (!player.properties.includes(member.index)) player.properties.push(member.index);
  }
  return tile;
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

await check('active player may build and sell after rolling until ending the turn', () => {
  const { game, a } = startedRoom();
  const tile = giveGroup(game, a, 1);
  a.cash = 5000;
  game.hasRolled = true;
  game.awaitingEndTurn = true;

  assert.equal(game.manageProperty(a.socketId, { tileIndex: tile.index, action: 'build-house' }).success, true);
  assert.equal(tile.houseCount, 1);
  assert.equal(game.manageProperty(a.socketId, { tileIndex: tile.index, action: 'sell-house' }).success, true);
  assert.equal(tile.houseCount, 0);

  assert.equal(game.endTurn(a.socketId).success, true);
  assert.deepEqual(game.manageProperty(a.socketId, { tileIndex: tile.index, action: 'build-house' }), {
    success: false,
    error: 'You can only build or sell during your turn.'
  });
});

await check('debt allows selling to settle but forbids building', () => {
  const { game, a, b } = startedRoom();
  const tile = giveGroup(game, a, 1);
  tile.houseCount = 1;
  game.currentPlayerId = b.id;
  game.pendingPayment = { playerId: a.id, creditorId: b.id, amountRemaining: 1 };
  a.cash = 0;

  assert.deepEqual(game.manageProperty(a.socketId, { tileIndex: tile.index, action: 'build-house' }), {
    success: false,
    error: 'You cannot build while settling a debt.'
  });
  assert.equal(game.manageProperty(a.socketId, { tileIndex: tile.index, action: 'sell-house' }).success, true);
  assert.equal(game.pendingPayment, null);
});

await check('debt rescue actions do not allow spending cash to unmortgage', () => {
  const { game, a } = startedRoom();
  const tile = game.getTile(5);
  tile.ownerId = a.id;
  tile.mortgaged = true;
  a.properties.push(tile.index);
  a.cash = 5000;
  game.pendingPayment = { playerId: a.id, creditorId: null, amountRemaining: 10 };

  assert.deepEqual(game.manageProperty(a.socketId, { tileIndex: tile.index, action: 'unmortgage' }), {
    success: false,
    error: 'You cannot unmortgage while settling a debt.'
  });
});

await check('the leading auction bid stays funded when its owner unmortgages a deed', () => {
  const { game, a } = startedRoom();
  const deed = game.getTile(3);
  deed.ownerId = a.id;
  deed.mortgaged = true;
  a.properties.push(deed.index);
  a.cash = 150;
  const auctionDeed = game.getTile(1);
  game.startAuction(auctionDeed, a.id);
  assert.equal(game.placeAuctionBid(a.socketId, 130).success, true);
  const reason = 'Keep enough cash to cover your current auction bid.';
  assert.deepEqual(game.manageProperty(a.socketId, { tileIndex: deed.index, action: 'unmortgage' }), { success: false, error: reason });
  assert.equal(a.cash, 150);
  assert.equal(deed.mortgaged, true);
  const summary = game.getGameSummary(a.id).tiles.find(tile => tile.index === deed.index);
  assert.deepEqual(summary.propertyActions.unmortgage, { enabled: false, cost: 33, reason });

  a.cash = 163;
  assert.equal(game.manageProperty(a.socketId, { tileIndex: deed.index, action: 'unmortgage' }).success, true);
  assert.equal(a.cash, 130, 'cash exactly covering the outstanding bid remains spendable above the reservation');
  game.finishAuction();
  assert.equal(auctionDeed.ownerId, a.id, 'the funded bid still settles to its winner');
  assert.equal(a.cash, 0);
});

await check('auction reservations also protect building cash and release when another player outbids', () => {
  const { game, a, b } = startedRoom();
  const deed = giveGroup(game, a, 6);
  a.cash = 150;
  game.startAuction(game.getTile(1), a.id);
  assert.equal(game.placeAuctionBid(a.socketId, 120).success, true);
  assert.deepEqual(game.manageProperty(a.socketId, { tileIndex: deed.index, action: 'build-house' }), {
    success: false, error: 'Keep enough cash to cover your current auction bid.'
  });
  assert.equal(deed.houseCount, 0);
  const summary = game.getGameSummary(a.id).tiles.find(tile => tile.index === deed.index);
  assert.equal(summary.propertyActions.buildHouse.enabled, false);

  const mortgageDeed = game.getTile(5);
  mortgageDeed.ownerId = a.id;
  a.properties.push(mortgageDeed.index);
  assert.equal(game.manageProperty(a.socketId, { tileIndex: mortgageDeed.index, action: 'mortgage' }).success, true,
    'raising cash remains legal while leading the auction');
  a.cash = 150;
  game.auction.cooldownUntil = 0;
  assert.equal(game.placeAuctionBid(b.socketId, 130).success, true);
  assert.equal(game.manageProperty(a.socketId, { tileIndex: deed.index, action: 'build-house' }).success, true,
    'the previous bidder can spend its released cash');
});

await check('mortgage is available off turn during debt and an unrelated trade', () => {
  const { game, a, b } = startedRoom();
  const tile = game.getTile(5);
  tile.ownerId = a.id;
  a.properties.push(tile.index);
  game.currentPlayerId = b.id;
  game.pendingPayment = { playerId: b.id, creditorId: a.id, amountRemaining: 1 };
  game.pendingTrade = {
    id: 'open-trade', fromPlayerId: b.id, toPlayerId: a.id,
    givePropertyIndexes: [], requestPropertyIndexes: []
  };

  assert.equal(game.manageProperty(a.socketId, { tileIndex: tile.index, action: 'mortgage' }).success, true);
  assert.equal(tile.mortgaged, true);
});

await check('property pledged by an open trade cannot be changed before settlement', () => {
  const { game, a, b } = startedRoom();
  const tile = game.getTile(5);
  tile.ownerId = a.id;
  a.properties.push(tile.index);
  game.pendingTrade = {
    id: 'open-trade', fromPlayerId: a.id, toPlayerId: b.id,
    givePropertyIndexes: [tile.index], requestPropertyIndexes: []
  };

  assert.deepEqual(game.manageProperty(a.socketId, { tileIndex: tile.index, action: 'mortgage' }), {
    success: false,
    error: 'Resolve the offer involving this property before managing it.'
  });
});

await check('property pledged as open contract collateral cannot be changed before settlement', () => {
  const { game, a, b } = startedRoom();
  const tile = game.getTile(5);
  tile.ownerId = a.id;
  a.properties.push(tile.index);
  game.pendingPlayerContract = {
    id: 'open-contract', fromPlayerId: b.id, toPlayerId: a.id,
    collateralTileIndex: tile.index
  };

  assert.deepEqual(game.manageProperty(a.socketId, { tileIndex: tile.index, action: 'mortgage' }), {
    success: false,
    error: 'Resolve the offer involving this property before managing it.'
  });
});

await check('auction bot wait is a no-op candidate and does not remove its seat', async () => {
  const { game, a, b } = startedRoom();
  a.cash = 0;
  a.isBot = true;
  const auction = {
    propertyTile: game.getTile(1), active: true, participants: [a.id, b.id],
    highestBid: 0, highestBidderId: null, endsAt: Date.now() + 5000,
    cooldownUntil: 0
  };
  game.auction = auction;
  const choice = await decideBotAuction({ auction, bot: a, startingCash: 1500, game });

  assert.equal(choice.actionId, 'auction:wait');
  assert.deepEqual(choice.candidates.map(candidate => candidate.id), ['auction:wait']);
  assert.deepEqual(auction.participants, [a.id, b.id]);
  a.cash = 100;
  assert.equal(game.placeAuctionBid(a.socketId, 10).success, true);
  assert.equal(auction.highestBidderId, a.id);
});
