import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { netWorth } from './netWorth.js';
import { decksForVariant } from './boardRegistry.js';
import { getBotChoiceCandidates, runPaymentChoice, CANDIDATE_RUNNERS } from './botLogic.js';

function fixture(enabled = true) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'Ben' });
  const game = room.game;
  game.settings.itemRewards = enabled;
  game.startGame();
  const [player, other] = game.players;
  game.currentPlayerId = player.id;
  return { game, room, player, other };
}

{
  const { game, player, other } = fixture();
  const first = game.grantItem(player, 'parlor-bond', 'treasure');
  const second = game.grantItem(player, 'parlor-bond', 'treasure');
  assert.notEqual(first.itemId, second.itemId);
  assert.equal(first.maturesRound, 3);
  assert.equal(netWorth(game, player), player.cash + 100);
  assert.deepEqual(game.summaryItems(player, other.id), []);
  assert.equal(game.summaryItems(player, player.id)[0].canUse, false);
  assert.equal(game.useItem('a', { itemId: first.itemId, requestId: 'early' }).success, false);
  game.roundNumber = 3;
  assert.equal(netWorth(game, player), player.cash + 200);
  const before = player.cash;
  const redeemed = game.useItem('a', { itemId: first.itemId, requestId: 'redeem' });
  assert.equal(redeemed.cashReceived, 100);
  assert.equal(player.cash, before + 100);
  assert.equal(game.useItem('a', { itemId: first.itemId, requestId: 'redeem' }).duplicate, true);
  assert.equal(game.sellItem('a', { itemId: second.itemId, requestId: 'redeem' }).success, false);
  assert.equal(game.useItem('a', { itemId: first.itemId, requestId: 'new' }).success, false);
  assert.equal(game.sellItem('b', { itemId: second.itemId, requestId: 'theft' }).success, false);
  assert.equal(game.sellItem('a', { itemId: second.itemId, requestId: 'sell', amount: 9999 }).cashReceived, 50);
  assert.equal(player.cash, before + 150);
  game.itemTransactions.clear();
  assert.equal(game.sellItem('a', { itemId: second.itemId, requestId: 'forgotten-replay' }).success, false);
  assert.equal(player.cash, before + 150);
}

{
  const { game, player, other } = fixture();
  const item = game.grantItem(player, 'silver-keepsake', 'surprise');
  player.cash = 0;
  game.chargePlayer({ player, amount: 60, creditor: other, message: 'Test debt' });
  const before = other.cash;
  assert.equal(game.sellItem('a', { itemId: item.itemId, requestId: 'rescue' }).success, true);
  assert.equal(game.pendingPayment, null);
  assert.equal(other.cash, before + 60);
  assert.equal(player.cash, 15);
  assert.equal(player.items.length, 0);
}

{
  const { game, player } = fixture();
  game.isLowTaxElection = () => true;
  const bond = game.grantItem(player, 'parlor-bond', 'treasure');
  assert.equal(bond.bankSellValue, 40);
  assert.equal(bond.redeemValue, 80);
  game.roundNumber = 3;
  game.isLowTaxElection = () => false;
  assert.equal(game.useItem('a', { itemId: bond.itemId, requestId: 'discount' }).cashReceived, 80);
}

for (const deckName of ['surprise', 'treasure']) {
  const { game, player } = fixture();
  game.isLowTaxElection = () => true;
  const reward = decksForVariant('standard-40', { itemRewards: true })[deckName]
    .find(card => card.catalogId === 'silver-keepsake');
  game[`${deckName}Deck`] = [reward];
  const result = game.handleChanceTile(player, {}, deckName);
  assert.equal(result.cardReveal.text, 'Receive a Silver Keepsake. Sell it to the bank.');
  assert.ok(game.feed.some(entry => entry.text.includes(result.cardReveal.text)));
  const item = game.summaryItems(player, player.id)[0];
  assert.equal(item.bankSellValue, 60);
  assert.match(item.description, /\$60/);
  game.isLowTaxElection = () => false;
  assert.equal(game.sellItem('a', { itemId: item.itemId, requestId: `low-tax-${deckName}` }).cashReceived, 60);
}

{
  const { game, player } = fixture(false);
  game.applyCard(player, { action: 'jailFree' });
  player.inJail = true;
  const key = game.summaryItems(player, player.id)[0];
  assert.equal(key.catalogId, 'prison-key');
  assert.equal(key.canSell, false);
  assert.equal(netWorth(game, player), player.cash);
  assert.equal(game.sellItem('a', { itemId: key.itemId, requestId: 'classic' }).success, false);
  assert.equal(game.useJailFree('a').success, true);
  assert.equal(game.summaryItems(player, player.id).length, 0);
  assert.equal(game.useItem('a', { itemId: key.itemId, requestId: 'spent' }).success, false);
}

{
  const { game, player } = fixture();
  game.surpriseDeck = [{ action: 'jailFree', text: 'Key' }];
  game.handleChanceTile(player);
  game.treasureDeck = [{ action: 'jailFree', text: 'Key' }];
  game.handleChanceTile(player, {}, 'treasure');
  assert.deepEqual(player.jailFreeOrigins, ['surprise', 'treasure']);
  const keys = game.summaryItems(player, player.id);
  assert.equal(game.sellItem('a', { itemId: keys[1].itemId, requestId: 'key-sale' }).cashReceived, 25);
  assert.deepEqual(player.jailFreeOrigins, ['surprise']);
  player.inJail = true;
  assert.equal(game.useJailFree('a').success, true);
  assert.deepEqual(player.jailFreeOrigins, []);
  assert.equal(player.items.length, 0);
  const id = game.grantItem(player, 'silver-keepsake', 'treasure').itemId;
  game.endGame(player);
  assert.equal(player.items.length, 0);
  game.resetForNewGame();
  assert.equal(player.items.length, 0);
  assert.equal(player.jailFreeCards, 0);
  assert.deepEqual(player.jailFreeOrigins, []);
  assert.notEqual(game.grantItem(player, 'silver-keepsake', 'treasure').itemId, id);
}

{
  const { game, room, player, other } = fixture();
  player.isBot = true;
  const bond = game.grantItem(player, 'parlor-bond', 'treasure');
  game.roundNumber = bond.maturesRound;
  const normal = game.getBotCandidates(player).find(candidate => candidate.kind === 'item-use');
  assert.equal(normal.itemId, bond.itemId);
  assert.equal(CANDIDATE_RUNNERS['item-use'](room, player, normal).cashReceived, 100);
  const keepsake = game.grantItem(player, 'silver-keepsake', 'surprise');
  player.cash = 0;
  game.chargePlayer({ player, amount: 70, creditor: other });
  const rescue = getBotChoiceCandidates(game, player, 'payment')[0];
  assert.equal(rescue.itemId, keepsake.itemId);
  assert.equal(runPaymentChoice(room, player, game, rescue).success, true);
  assert.equal(game.pendingPayment, null);
}

for (const variant of ['standard-40', 'metro-52']) {
  const classic = decksForVariant(variant);
  assert.equal(classic.surprise.some(card => card.action === 'itemReward'), false);
  const { game, player } = fixture();
  game.boardVariant = variant;
  for (const deckName of ['surprise', 'treasure']) {
    const source = decksForVariant(variant, game.settings)[deckName];
    assert.equal(source.filter(card => card.action === 'itemReward').length, 2);
    game[`${deckName}Deck`] = [];
    const drawn = Array.from({ length: source.length }, () => game.drawCard(deckName));
    assert.equal(drawn.filter(card => card.action === 'itemReward').length, 2);
    for (const card of drawn.filter(card => card.action === 'itemReward')) game.applyCard(player, card);
  }
  assert.equal(player.items.length, 4);
}

{
  const { game, player, other } = fixture();
  game.grantItem(player, 'silver-keepsake', 'treasure');
  game.grantItem(player, 'parlor-bond', 'treasure');
  game.roundNumber += 2;
  player.cash = 0;
  const cash = other.cash;
  assert.equal(game.handleBankruptcy(player, other).success, true);
  assert.equal(other.cash, cash + 175);
  assert.deepEqual(player.items, []);
  assert.equal(game.liquidateItems(player), 0);
}

{
  const { game, player, other } = fixture();
  const item = game.grantItem(player, 'silver-keepsake', 'treasure');
  player.cash = 0;
  other.cash = 0;
  game.chargePlayer({ player: other, amount: 30 });
  const debt = structuredClone(game.pendingPayment);
  for (const payload of [null, [], { itemId: item.itemId }, { itemId: {}, requestId: 'bad' }, { itemId: item.itemId, requestId: {} }]) {
    assert.equal(game.sellItem('a', payload).success, false);
  }
  assert.equal(game.sellItem('a', { itemId: item.itemId, requestId: 'other-debtor' }).cashReceived, 75);
  assert.equal(player.items.length, 0);
  assert.equal(other.cash, 0);
  assert.deepEqual(game.pendingPayment, debt);
}

for (const enabled of [true, false]) {
  const { game, player } = fixture(enabled);
  player.jailFreeCards = 1;
  player.items = [];
  assert.equal(netWorth(game, player), player.cash + (enabled ? 25 : 0), 'legacy key is valued before projection');
  assert.equal(netWorth(game, player), player.cash + (enabled ? 25 : 0), 'valuation remains stable');
}

console.log('items tests passed');
