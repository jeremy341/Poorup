// Regression suite for the B-12 and B-13 economy-audit defects.
//
// B-12: the Start salary on the card paths re-derived the ladder and dropped
// the last-place catch-up bonus, so the same outcome paid $200 via a card and
// $300 via dice. Both card paths now funnel through the canonical helpers
// (startPassReward / isLastPlaceByCash) and share the dice feed wording.
//
// B-13: propertyRules.js guarded equityShares for trade and mortgage but not
// for build or sell, so the owner of a part-sold deed could still build and
// sell it: paying 100% construction cost while booking zero rent and
// transferring 100% of every rent roll to the equity holder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const SALARY = 200;
const DOUBLE_GO_SALARY = 400;
const CATCH_UP = 100;

// ---------------------------------------------------------------- B-12 setup

// A two-seat table driven entirely by the caller's cash positions, so the
// catch-up rule (strictly last among 2+ live seats, ties pay nothing) is the
// only thing that varies between cases.
function cardFixture({ playerCash, rivalCash, doubleGo = false } = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'b12-a', clientId: 'b12-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 'b12-b', clientId: 'b12-b', nickname: 'Bob' });
  if (doubleGo) room.setRoomSetting('doubleGo', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  game.started = true;
  const [player, rival] = game.players;
  player.cash = playerCash;
  rival.cash = rivalCash;
  game.currentPlayerId = player.id;
  game.hasRolled = true;
  game.awaitingEndTurn = false;
  return { game, player, rival };
}

function lowTax(game) {
  game.globalEvent = { id: 'city-election', phase: 'active', resolvedChoice: 'low-tax' };
}

const startFeed = game => game.feed.map(entry => entry.text).filter(text => text.includes('collected $'));

// The card equivalent of "advance to Start": collectStart is a direct move
// onto the Start tile, so it always takes the exact-start branch of the ladder.
function collectStart(ctx, card = { action: 'collectStart', amount: SALARY }) {
  ctx.game.applyCard(ctx.player, card, {});
  return ctx.player.cash;
}

// moveTo back across GO without landing on it: position 35 -> tile 3.
function moveAcrossStart(ctx, card = { action: 'moveTo', tileIndex: 3 }) {
  ctx.player.position = 35;
  ctx.game.applyCard(ctx.player, card, {});
  return ctx.player.cash;
}

// moveTo onto Start itself: position 35 -> tile 0.
function moveOntoStart(ctx, card = { action: 'moveTo', tileIndex: 0 }) {
  ctx.player.position = 35;
  ctx.game.applyCard(ctx.player, card, {});
  return ctx.player.cash;
}

// ------------------------------------------------------------------ B-12 tests

test('B-12 collectStart pays salary plus the catch-up bonus for the strictly-last seat', () => {
  const last = cardFixture({ playerCash: 100, rivalCash: 2000 });
  assert.equal(collectStart(last), 100 + SALARY + CATCH_UP, 'strictly last by cash collects salary + $100');
  assert.deepEqual(startFeed(last.game), ['Ada landed on Start and collected $300. Last-place catch-up bonus included.']);
});

test('B-12 moveTo across GO pays salary plus the catch-up bonus for the strictly-last seat', () => {
  const last = cardFixture({ playerCash: 100, rivalCash: 2000 });
  assert.equal(moveAcrossStart(last), 100 + SALARY + CATCH_UP, 'passing GO on a movement card carries the bonus');
  assert.deepEqual(startFeed(last.game), ['Ada passed Start and collected $300. Last-place catch-up bonus included.']);
});

test('B-12 moveTo landing on Start pays salary plus the catch-up bonus for the strictly-last seat', () => {
  const last = cardFixture({ playerCash: 100, rivalCash: 2000 });
  assert.equal(moveOntoStart(last), 100 + SALARY + CATCH_UP);
});

test('B-12 a tied table pays salary only on both card paths', () => {
  const collectTie = cardFixture({ playerCash: 1000, rivalCash: 1000 });
  assert.equal(collectStart(collectTie), 1000 + SALARY, 'ties never pay the catch-up bonus');
  assert.deepEqual(startFeed(collectTie.game), ['Ada landed on Start and collected $200.']);

  const moveTie = cardFixture({ playerCash: 1000, rivalCash: 1000 });
  assert.equal(moveAcrossStart(moveTie), 1000 + SALARY, 'ties never pay the catch-up bonus');
  assert.deepEqual(startFeed(moveTie.game), ['Ada passed Start and collected $200.']);
});

test('B-12 the leading seat pays salary only on both card paths', () => {
  const collectLeader = cardFixture({ playerCash: 2000, rivalCash: 100 });
  assert.equal(collectStart(collectLeader), 2000 + SALARY, 'not-last collects salary with no bonus');

  const moveLeader = cardFixture({ playerCash: 2000, rivalCash: 100 });
  assert.equal(moveAcrossStart(moveLeader), 2000 + SALARY, 'not-last collects salary with no bonus');
});

test('B-12 a solo table pays no catch-up bonus', () => {
  const solo = cardFixture({ playerCash: 100, rivalCash: 2000 });
  solo.rival.bankrupt = true;
  assert.equal(collectStart(solo), 100 + SALARY, 'the rule needs 2+ live contestants');
});

// The invariant: the same outcome and the same cash position must pay the same
// amount whichever way GO was crossed, and say the same thing about it.
test('B-12 dice and card paths agree for the identical outcome and cash position', () => {
  const byDice = cardFixture({ playerCash: 100, rivalCash: 2000 });
  byDice.player.position = 35;
  byDice.game.movePlayer(byDice.player, 5); // 35 + 5 wraps onto Start.

  const byCard = cardFixture({ playerCash: 100, rivalCash: 2000 });
  const cardCash = moveOntoStart(byCard);

  assert.equal(byDice.player.position, 0);
  assert.equal(byCard.player.position, 0);
  assert.equal(byDice.player.cash, cardCash, 'identical outcome pays identically');
  assert.equal(byDice.player.cash, 100 + SALARY + CATCH_UP);
  assert.deepEqual(startFeed(byCard.game), startFeed(byDice.game), 'both paths report the same Start line');
});

test('B-12 dice and card paths agree with no bonus on a tied table', () => {
  const byDice = cardFixture({ playerCash: 1000, rivalCash: 1000 });
  byDice.player.position = 35;
  byDice.game.movePlayer(byDice.player, 5);

  const byCard = cardFixture({ playerCash: 1000, rivalCash: 1000 });
  const cardCash = moveOntoStart(byCard);

  assert.equal(byDice.player.cash, cardCash);
  assert.equal(byDice.player.cash, 1000 + SALARY);
  assert.deepEqual(startFeed(byCard.game), startFeed(byDice.game));
});

// The cardReveal figure is the same defect surface: it must carry the bonus so
// the popup cannot disagree with the feed.
test('B-12 the collectStart card reveal reports salary plus bonus', () => {
  const last = cardFixture({ playerCash: 100, rivalCash: 2000 });
  const card = { action: 'collectStart', amount: SALARY, text: 'Advance to GO' };
  const before = last.player.cash;
  last.game.applyCard(last.player, card, {});
  const revealed = last.game.cardCashAfterPlay(last.player, card, before);
  assert.equal(revealed, SALARY + CATCH_UP);
  assert.equal(last.player.cash - before, revealed, 'the reveal matches the money actually paid');
});

test('B-12 Double GO still yields the $400 card salary', () => {
  // moveTo onto Start under Double GO, mirroring server/double-go.test.js.
  const ontoStart = cardFixture({ playerCash: 1000, rivalCash: 1000, doubleGo: true });
  assert.equal(moveOntoStart(ontoStart), 1000 + DOUBLE_GO_SALARY, 'landing on Start via a card uses the Double GO reward');

  // Passing (not landing on) Start still pays the flat salary under Double GO.
  const acrossStart = cardFixture({ playerCash: 1000, rivalCash: 1000, doubleGo: true });
  assert.equal(moveAcrossStart(acrossStart), 1000 + SALARY, 'only the exact-Start branch is doubled');

  // collectStart with no amount falls back to the canonical exact-start ladder.
  const noAmount = cardFixture({ playerCash: 1000, rivalCash: 1000, doubleGo: true });
  assert.equal(collectStart(noAmount, { action: 'collectStart' }), 1000 + DOUBLE_GO_SALARY);

  // A card that names its own amount stays authoritative.
  const namedAmount = cardFixture({ playerCash: 1000, rivalCash: 1000, doubleGo: true });
  assert.equal(collectStart(namedAmount, { action: 'collectStart', amount: 150 }), 1000 + 150);
});

test('B-12 Double GO plus the catch-up bonus stack on both card paths', () => {
  const collect = cardFixture({ playerCash: 100, rivalCash: 2000, doubleGo: true });
  assert.equal(collectStart(collect, { action: 'collectStart' }), 100 + DOUBLE_GO_SALARY + CATCH_UP);

  const move = cardFixture({ playerCash: 100, rivalCash: 2000, doubleGo: true });
  assert.equal(moveOntoStart(move), 100 + DOUBLE_GO_SALARY + CATCH_UP);
});

test('B-12 low-tax election still applies the x0.8 discount, bonus on top', () => {
  const tied = cardFixture({ playerCash: 1000, rivalCash: 1000 });
  lowTax(tied.game);
  assert.equal(collectStart(tied), 1000 + Math.floor(SALARY * 0.8), '200 -> 160');

  const last = cardFixture({ playerCash: 100, rivalCash: 2000 });
  lowTax(last.game);
  assert.equal(collectStart(last), 100 + Math.floor(SALARY * 0.8) + CATCH_UP, 'the bonus is not discounted');
  assert.deepEqual(startFeed(last.game), ['Ada landed on Start and collected $260. Last-place catch-up bonus included.']);

  // Double GO plus low-tax: the discount applies to the doubled salary.
  const doubleGoLowTax = cardFixture({ playerCash: 1000, rivalCash: 1000, doubleGo: true });
  lowTax(doubleGoLowTax.game);
  assert.equal(collectStart(doubleGoLowTax, { action: 'collectStart' }), 1000 + Math.floor(DOUBLE_GO_SALARY * 0.8));
});

// ------------------------------------------------------------------ B-13 setup

function equityFixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'b13-owner', clientId: 'b13-owner', nickname: 'Owner' });
  room.addOrReconnectPlayer({ socketId: 'b13-investor', clientId: 'b13-investor', nickname: 'Investor' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const owner = game.players[0];
  const investor = game.players[1];
  const tile = game.getTile(1);
  owner.cash = 5000;
  game.currentPlayerId = owner.id;
  return { game, owner, investor, tile };
}

// The owner holds the whole Brown group, so a build refusal below can only
// come from the encumbrance guard and not from a missing monopoly.
function ownBrownGroup(ctx) {
  [ctx.tile, ctx.game.getTile(3)].forEach((deed) => {
    deed.ownerId = ctx.owner.id;
    ctx.owner.properties.push(deed.index);
  });
  return ctx;
}

// Real production path: a sponsored purchase that leaves the investor holding
// an equity share, which is the state that used to leave build and sell open.
// Ownership is granted by the acceptance, so the group is completed after it.
function withEquityShare() {
  const ctx = equityFixture();
  ctx.game.pendingPurchaseOffer = { playerId: ctx.owner.id, tileIndex: ctx.tile.index };
  ctx.owner.cash = 20;
  assert.equal(ctx.game.requestPurchaseSponsorship('b13-owner', { mode: 'equity', sharePct: 100 }).success, true);
  assert.equal(ctx.game.contributeToSponsoredPurchase('b13-investor', { amount: ctx.tile.price - 20 }).success, true);
  assert.equal(ctx.game.acceptSponsoredPurchase('b13-owner').success, true);
  assert.equal(ctx.tile.ownerId, ctx.owner.id);
  assert.equal(ctx.tile.equityShares.length, 1, 'the fixture really is a part-sold deed');
  ownBrownGroup(ctx);
  ctx.owner.cash = 5000;
  return ctx;
}

// Mirrors server/collateralBasket.test.js: an accepted loan pledge leaves the
// deeds reserved as contract collateral. The investor offers the loan and the
// owner, who pledges the deeds, accepts it.
function withLoanCollateral() {
  const ctx = ownBrownGroup(equityFixture());
  const offer = ctx.game.proposePlayerContract('b13-investor', {
    toPlayerId: ctx.owner.id,
    kind: 'loan',
    amount: 100,
    durationRounds: 1,
    collateralTileIndices: [1, 3]
  });
  assert.equal(offer.success, true);
  assert.equal(ctx.game.respondPlayerContract('b13-owner', true, 'accept', offer.contract.id).success, true);
  assert.equal(ctx.game.isPlayerContractCollateral(ctx.owner, ctx.tile), true);
  ctx.game.pendingPlayerContract = null;
  return ctx;
}

// ------------------------------------------------------------------ B-13 tests

test('B-13 an outstanding equity share blocks building', () => {
  const ctx = withEquityShare();
  assert.equal(ctx.game.canBuildOnTile(ctx.owner, ctx.tile), false);
  // Trade and mortgage already refused it; all four verbs now agree.
  assert.equal(ctx.game.isTradeableTile(ctx.tile), false);
  assert.equal(ctx.game.canMortgageTile(ctx.owner, ctx.tile), false);
});

test('B-13 an outstanding equity share blocks selling', () => {
  const ctx = withEquityShare();
  ctx.tile.houseCount = 2;
  assert.equal(ctx.game.canSellFromTile(ctx.owner, ctx.tile), false);
});

test('B-13 loan and contract collateral still block building and selling', () => {
  const ctx = withLoanCollateral();
  ctx.tile.houseCount = 2;
  assert.equal(ctx.game.canBuildOnTile(ctx.owner, ctx.tile), false, 'no regression of the existing encumbrance guard');
  assert.equal(ctx.game.canSellFromTile(ctx.owner, ctx.tile), false);
});

test('B-13 a clean, wholly-owned deed can still be built on and sold from', () => {
  const ctx = ownBrownGroup(equityFixture());
  assert.deepEqual(ctx.tile.equityShares, [], 'the fixture has no equity outstanding');
  assert.equal(ctx.game.isPlayerContractCollateral(ctx.owner, ctx.tile), false);
  assert.equal(ctx.game.canBuildOnTile(ctx.owner, ctx.tile), true, 'the guard must not over-lock a free deed');
  ctx.tile.houseCount = 1;
  assert.equal(ctx.game.canSellFromTile(ctx.owner, ctx.tile), true);
});

test('B-13 manageProperty build-house refuses a part-sold deed without side effects', () => {
  const ctx = withEquityShare();
  const cashBefore = ctx.owner.cash;
  const feedBefore = ctx.game.feed.length;
  const result = ctx.game.manageProperty('b13-owner', { tileIndex: ctx.tile.index, action: 'build-house' });
  assert.deepEqual(result, { success: false, error: 'You cannot build on this property right now.' });
  assert.equal(ctx.tile.houseCount, 0, 'no house was placed');
  assert.equal(ctx.owner.cash, cashBefore, 'no construction cost was charged');
  assert.equal(ctx.game.feed.length, feedBefore, 'no build feed message');
  assert.equal(ctx.owner.buildActionsThisTurn || 0, 0);
});

test('B-13 manageProperty sell-house refuses a part-sold deed without side effects', () => {
  const ctx = withEquityShare();
  ctx.tile.houseCount = 3;
  const cashBefore = ctx.owner.cash;
  const feedBefore = ctx.game.feed.length;
  const result = ctx.game.manageProperty('b13-owner', { tileIndex: ctx.tile.index, action: 'sell-house' });
  assert.deepEqual(result, { success: false, error: 'You cannot sell a house from this property right now.' });
  assert.equal(ctx.tile.houseCount, 3, 'the buildings are still standing');
  assert.equal(ctx.owner.cash, cashBefore, 'no sale proceeds were paid');
  assert.equal(ctx.game.feed.length, feedBefore, 'no sale feed message');
});

test('B-13 the end-to-end refusals use the pre-existing error strings only', () => {
  // The client is untouched: both rejections reuse the strings propertyApi.js
  // already shipped, so no new UI copy is introduced.
  const build = withEquityShare();
  assert.equal(build.game.manageProperty('b13-owner', { tileIndex: build.tile.index, action: 'build-house' }).error,
    'You cannot build on this property right now.');
  const sell = withEquityShare();
  sell.tile.houseCount = 1;
  assert.equal(sell.game.manageProperty('b13-owner', { tileIndex: sell.tile.index, action: 'sell-house' }).error,
    'You cannot sell a house from this property right now.');
});