// Bank tier perks: the item sale fee by tier (table rule on), no fee with the rule off,
// no fee on redeeming a bond, and the auction tie going to the higher bank tier.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const failures = [];
function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.stack || error.message}`);
  }
}

// Mirrors the fixture in items.test.js: item rewards on, bank accounts set by the caller.
function fixture(bankAccountUpgrades) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'Ben' });
  const game = room.game;
  game.settings.itemRewards = true;
  game.settings.bankAccountUpgrades = bankAccountUpgrades;
  game.startGame();
  const [player, other] = game.players;
  game.currentPlayerId = player.id;
  return { game, room, player, other };
}

function keepsakeFor(game, player, value = 100) {
  const item = game.grantItem(player, 'silver-keepsake', 'surprise');
  item.bankSellValue = value;
  return item;
}

check('a sale to the bank costs the tier fee when bank accounts are on', () => {
  const expected = [[1, 10], [2, 5], [3, 0]];
  for (const [tier, pct] of expected) {
    const { game, player } = fixture(true);
    game.bankAccountOf(player).tier = tier;
    player.cash = 0;
    const item = keepsakeFor(game, player, 100);
    const result = game.sellItem('a', { itemId: item.itemId, requestId: `fee-tier-${tier}` });
    assert.equal(result.success, true, `tier ${tier} sale succeeds`);
    assert.equal(result.saleFee, pct, `tier ${tier} fee is ${pct}`);
    assert.equal(result.cashReceived, 100 - pct, `tier ${tier} seat receives value minus fee`);
    assert.equal(player.cash, 100 - pct, `tier ${tier} cash is credited net of fee`);
  }
});

check('the item summary shows the fee and keeps the gross sell fields', () => {
  const { game, player } = fixture(true);
  game.bankAccountOf(player).tier = 2;
  keepsakeFor(game, player, 100);
  const [summary] = game.summaryItems(player, player.id);
  assert.equal(summary.bankSellValue, 100, 'gross value is unchanged');
  assert.equal(summary.sellValue, 100, 'sellValue stays the gross value');
  assert.equal(summary.saleFeePct, 5);
  assert.equal(summary.saleFee, 5);
  assert.equal(summary.netSaleValue, 95);
  assert.match(summary.description, /worth \$95 when sold to the bank after a \$5 bank fee/);
});

check('the fee floors on odd values', () => {
  const { game, player } = fixture(true);
  game.bankAccountOf(player).tier = 2;
  player.cash = 0;
  const item = keepsakeFor(game, player, 33);
  const result = game.sellItem('a', { itemId: item.itemId, requestId: 'fee-odd' });
  assert.equal(result.saleFee, 1, 'floor(33 * 5 / 100) is 1');
  assert.equal(result.cashReceived, 32);
});

check('no sale fee and full value when the bank account rule is off', () => {
  const { game, player } = fixture(false);
  game.bankAccountOf(player).tier = 3;
  player.cash = 0;
  const item = keepsakeFor(game, player, 100);
  const [before] = game.summaryItems(player, player.id);
  assert.equal(before.saleFee, 0);
  assert.equal(before.netSaleValue, 100);
  assert.equal(before.description, 'A collectible worth $100 when sold to the bank.');
  const result = game.sellItem('a', { itemId: item.itemId, requestId: 'fee-off' });
  assert.equal(result.saleFee, 0);
  assert.equal(result.cashReceived, 100);
  assert.equal(player.cash, 100);
});

check('redeeming a matured bond pays the full redeem value with no fee', () => {
  const { game, player } = fixture(true);
  game.bankAccountOf(player).tier = 1;
  const bond = game.grantItem(player, 'parlor-bond', 'treasure');
  bond.redeemValue = 100;
  bond.bankSellValue = 50;
  game.roundNumber = bond.maturesRound;
  player.cash = 0;
  const redeemed = game.useItem('a', { itemId: bond.itemId, requestId: 'bond-redeem' });
  assert.equal(redeemed.success, true);
  assert.equal(redeemed.saleFee, 0, 'redeeming is not a sale');
  assert.equal(redeemed.cashReceived, 100);
  assert.equal(player.cash, 100);
});

check('selling a bond to the bank still pays the fee, unlike redeeming it', () => {
  const { game, player } = fixture(true);
  game.bankAccountOf(player).tier = 1;
  const bond = game.grantItem(player, 'parlor-bond', 'treasure');
  bond.redeemValue = 100;
  bond.bankSellValue = 50;
  game.roundNumber = bond.maturesRound;
  player.cash = 0;
  const sold = game.sellItem('a', { itemId: bond.itemId, requestId: 'bond-sell' });
  assert.equal(sold.saleFee, 5);
  assert.equal(sold.cashReceived, 45);
});

check('an exact auction tie goes to the higher bank tier', () => {
  const { game, player, other } = fixture(true);
  game.bankAccountOf(player).tier = 1;
  game.bankAccountOf(other).tier = 2;
  player.cash = 1000;
  other.cash = 1000;
  const tile = game.getTile(5);
  game.currentPlayerId = player.id;
  game.startAuction(tile, player.id);
  assert.equal(game.placeAuctionBid('a', 300).success, true);
  // Bids must strictly rise, so an exact tie is seeded straight into the bid list.
  game.auction.bids.push({ playerId: other.id, amount: 300 });
  game.finishAuction();
  assert.equal(tile.ownerId, other.id, 'Parlor Premium beats Standard on an exact tie');
  assert.equal(other.cash, 700);
  assert.equal(player.cash, 1000);
});

check('an exact auction tie among equal tiers keeps the earliest bid', () => {
  const { game, player, other } = fixture(true);
  game.bankAccountOf(player).tier = 2;
  game.bankAccountOf(other).tier = 2;
  player.cash = 1000;
  other.cash = 1000;
  const tile = game.getTile(5);
  game.currentPlayerId = player.id;
  game.startAuction(tile, player.id);
  assert.equal(game.placeAuctionBid('a', 300).success, true);
  game.auction.bids.push({ playerId: other.id, amount: 300 });
  game.finishAuction();
  assert.equal(tile.ownerId, player.id);
});

check('an exact auction tie ignores bank tier when the rule is off', () => {
  const { game, player, other } = fixture(false);
  game.bankAccountOf(other).tier = 3;
  player.cash = 1000;
  other.cash = 1000;
  const tile = game.getTile(5);
  game.currentPlayerId = player.id;
  game.startAuction(tile, player.id);
  assert.equal(game.placeAuctionBid('a', 300).success, true);
  game.auction.bids.push({ playerId: other.id, amount: 300 });
  game.finishAuction();
  assert.equal(tile.ownerId, player.id, 'the earliest bid keeps the win');
});

if (failures.length) {
  console.log(`bank tier perks: ${failures.length} failed`);
  process.exit(1);
}
console.log('bank tier perks: all passed');
