// Regression suite for three bot-correctness defects found in the audit
// campaign. Every check pins one repaired defect so it cannot silently
// regress; the classification notes live in the campaign report.
//
//   B-23  botLogic.plannedPurchaseDecision compared the buy projection against
//         a `pass` candidate. `pass` has no applier in the planner, so it came
//         back 'unsupported' and scored 0: the verdict became "is
//         buy.score >= 0" instead of "is this deed better than doing nothing".
//   B-24  botApi.loanContractCandidate scored the *neediest* borrower highest
//         while the responder gate (totalDue <= cash * shared repayment ratio)
//         makes exactly those proposals a guaranteed decline.
//   B-26  botApi.sortCandidates broke equal-score ties on ascending cost. All
//         build candidates share one score, so every build was ordered
//         cheapest-first and a monopoly bot developed its weakest rent stream.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import { evaluateCandidate } from './botFuturePlanner.js';
import { shouldBuyWithPlan, shouldBuyProperty, auctionBidDecision, runBotTurn } from './botLogic.js';
import { jailStayBeatsExit } from './botApi.js';
import { getBotChoiceCandidates } from './advisorLogic.js';
import { DeterministicAdvisor } from './botAdvisor.js';
import { CONTRACT_REPAY_RATIO } from './botContractPolicy.js';

const failures = [];
async function checkAsync(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.stack || error.message}`);
  }
}
function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.stack || error.message}`);
  }
}

// --- fixtures ---------------------------------------------------------------

let roomSerial = 0;
function botRoom({ cash = 1500, humanSeats = 2, settings = {} } = {}) {
  roomSerial += 1;
  const manager = new RoomManager();
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: 'host', clientId: 'host', nickname: 'Host', roomCode: `BOTFIX${roomSerial}`, rulesetOverrides: { bankLoans: true } });
  for (let seat = 0; seat < humanSeats; seat += 1) {
    room.addOrReconnectPlayer({ socketId: `seat-${seat}`, clientId: `seat-${seat}`, nickname: `Seat ${seat}` });
  }
  room.setRoomSetting('bots', 1);
  room.setRoomSetting('botDifficulty', 'table');
  Object.entries(settings).forEach(([key, value]) => room.setRoomSetting(key, value));
  assert.equal(room.startGame().success, true, 'the fixture room starts');
  const game = room.game;
  const bot = game.players.find(player => player.isBot);
  bot.cash = cash;
  game.currentPlayerId = bot.id;
  return { room, game, bot, humans: game.players.filter(player => !player.isBot) };
}

function ownGroup(game, player, group) {
  const tiles = game.tiles.filter(tile => tile.group === group);
  tiles.forEach(tile => {
    tile.ownerId = player.id;
    tile.houseCount = 0;
    if (!player.properties.includes(tile.index)) player.properties.push(tile.index);
  });
  return tiles;
}

function ownTile(game, player, index) {
  const tile = game.getTile(index);
  tile.ownerId = player.id;
  if (!player.properties.includes(index)) player.properties.push(index);
  return tile;
}

// Mirrors contractLogic's loanDraftTerms so the suite prices the same
// `totalDue` the responder gate reads.
function loanTotalDue(offer) {
  const amount = Number(offer.amount) || 0;
  return amount + Math.ceil(amount * (Number(offer.premiumRate) || 0) / 100);
}

function loanProposals(game, bot, options = {}) {
  return game.getBotCandidates(bot, { expanded: true, parity: true, ...options })
    .filter(candidate => candidate.kind === 'contract-propose');
}

function buildIds(candidates) {
  return candidates.filter(candidate => candidate.kind === 'build').map(candidate => candidate.id);
}

// A no-op projection: the planner's roll applier mutates nothing, so it scores
// the honest stand-still alternative the purchase policy must beat.
function purchaseProjections(game, bot, tile) {
  const snapshot = buildBotStrategicContext(game, bot, 'purchase', game.botDecisionSequence || 0);
  const options = { difficulty: game.settings?.botDifficulty || 'table', seed: `${game.startedAt || 'pending'}:purchase` };
  return {
    buy: evaluateCandidate(snapshot, { id: `buy:${tile.index}`, kind: 'buy', tileIndex: tile.index, price: tile.price, risk: 0, score: 0 }, options),
    standStill: evaluateCandidate(snapshot, { id: `pass:${tile.index}`, kind: 'roll', risk: 0, score: 0 }, options)
  };
}

// --- B-23 -------------------------------------------------------------------

check('B-23: purchase verdicts track the planner against a real no-op baseline', () => {
  const { game, bot } = botRoom({ cash: 600 });
  game.roundNumber = 14;
  bot.properties = [];
  // Mid-game, solvent table: the reserve gate and the cheap-auction decline do
  // not fire, so the planner alone decides every tile.
  const verdicts = game.tiles.filter(tile => tile.type === 'property').map(tile => {
    const { buy, standStill } = purchaseProjections(game, bot, tile);
    return {
      tile,
      status: standStill.projectionStatus,
      buyScore: buy.score,
      standStillScore: standStill.score,
      // A planner "no" is overruled only when the bot would pay the face price at auction (F2).
      expected: buy.score >= standStill.score || auctionCeiling(game, bot, tile) >= tile.price,
      actual: shouldBuyWithPlan(game, bot, tile)
    };
  });
  assert.ok(verdicts.length > 10, 'the fixture board offers a spread of deeds');
  assert.equal(verdicts[0].status, 'projected', 'the stand-still baseline is a real projection');
  // Scores are marginal to standing still (F-074): the baseline itself is the zero.
  assert.equal(verdicts[0].standStillScore, 0, 'the stand-still baseline is the zero marginal value');
  assert.ok(verdicts.some(verdict => verdict.buyScore < verdict.standStillScore),
    'the fixture contains deeds the planner values below doing nothing');
  verdicts.forEach(verdict => {
    assert.equal(verdict.actual, verdict.expected,
      `tile ${verdict.tile.index} (${verdict.tile.group}): buy ${verdict.buyScore.toFixed(2)} vs stand-still ${verdict.standStillScore.toFixed(2)}`);
  });
});

check('B-23: the planner stops buying deeds it values below doing nothing and the auction would not pay for', () => {
  // A rival Dark Blue set with houses lifts the liquidity reserve to 1000, so a
  // $1300 bot's auction ceiling is $300: the $320 deed is below the planner's
  // stand-still projection and above what the bot would bid, so it is declined.
  const { game, bot, humans } = botRoom({ cash: 1300 });
  game.roundNumber = 14;
  bot.properties = [];
  game.tiles.filter(tile => tile.group === 'Dark Blue').forEach(tile => {
    tile.ownerId = humans[0].id;
    tile.houseCount = 3;
    humans[0].properties.push(tile.index);
  });
  const verdicts = game.tiles.filter(tile => tile.type === 'property' && tile.group !== 'Dark Blue')
    .map(tile => ({ tile, buy: shouldBuyWithPlan(game, bot, tile) }));
  const bought = verdicts.filter(verdict => verdict.buy).map(verdict => verdict.tile);
  const premium = verdicts.find(verdict => verdict.tile.index === 34);
  assert.ok(premium, 'the fixture board still carries the $320 deed');
  assert.ok(premium.tile.price > auctionCeiling(game, bot, premium.tile), 'the auction ceiling is below the price');
  assert.equal(premium.buy, false, 'a deed the planner scores below the stand-still projection is declined');
  assert.ok(bought.length > 0, 'the fix is not a blanket refusal: deeds above the baseline are still bought');
});

// --- F2: purchase policy agrees with auction judgement ------------------------

// What the bot would pay for the deed at auction right now: the same
// auctionBidDecision the auction rail runs, from an opening (no bid yet) auction.
function auctionCeiling(game, bot, tile) {
  return auctionBidDecision({ propertyTile: tile, highestBid: 0, highestBidderId: null, participants: [bot.id] }, bot, 1500, game).maximum;
}

check('F2: a deed the bot would pay for at auction is not declined at face value on landing', () => {
  const { game, bot } = botRoom({ cash: 600 });
  game.roundNumber = 14;
  bot.properties = [];
  const deeds = game.tiles.filter(tile => tile.type === 'property');
  const rows = deeds.map(tile => {
    const { buy, standStill } = purchaseProjections(game, bot, tile);
    const ceiling = auctionCeiling(game, bot, tile);
    return {
      tile,
      ceiling,
      plannerBuys: buy.score >= standStill.score,
      actual: shouldBuyWithPlan(game, bot, tile)
    };
  });
  // The audit's measurement: the planner alone bought 8 of 22 deeds at $600.
  assert.equal(rows.filter(row => row.plannerBuys).length, 8, 'the planner on its own still scores only 8 of 22 deeds above standing still');
  assert.ok(rows.some(row => !row.plannerBuys && row.ceiling >= row.tile.price), 'the fixture has deeds the planner declines but the auction would pay for');
  rows.forEach(row => {
    // Independent sources only: the planner verdict OR the auction ceiling covers the price.
    assert.equal(row.actual, row.plannerBuys || row.ceiling >= row.tile.price,
      `tile ${row.tile.index} ($${row.tile.price}): ceiling ${row.ceiling}, planner ${row.plannerBuys}`);
  });
  assert.equal(rows.filter(row => row.actual).length, 22, 'every deed priced at or below the auction ceiling is bought at $600');
});

check('F2: the planner veto still binds where the auction would not pay the price', () => {
  const { game, bot, humans } = botRoom({ cash: 900 });
  game.roundNumber = 14;
  bot.properties = [];
  // A rival Dark Blue set with houses lifts the liquidity reserve to its cap, so
  // the bot's auction ceiling falls below the price although cash > price + 120.
  game.tiles.filter(tile => tile.group === 'Dark Blue').forEach(tile => {
    tile.ownerId = humans[0].id;
    tile.houseCount = 3;
    humans[0].properties.push(tile.index);
  });
  [16, 21, 31].forEach(index => {
    const tile = game.getTile(index);
    const { buy, standStill } = purchaseProjections(game, bot, tile);
    assert.ok(auctionCeiling(game, bot, tile) < tile.price, `tile ${index}: the auction ceiling is below the price`);
    assert.ok(buy.score < standStill.score, `tile ${index}: the planner scores the buy below standing still`);
    assert.equal(shouldBuyWithPlan(game, bot, tile), false, `tile ${index} stays declined`);
  });
});

check('F2: a deed that completes a colour set is exempt from the +120 cash floor', () => {
  const { game, bot } = botRoom({ cash: 100 });
  game.roundNumber = 14;
  bot.properties = [];
  ownTile(game, bot, 1);
  const completer = game.getTile(3);
  const { buy, standStill } = purchaseProjections(game, bot, completer);
  assert.ok(buy.score > standStill.score, 'the planner values the completing Brown deed above standing still');
  assert.ok(bot.cash >= completer.price && bot.cash < completer.price + 120, 'cash covers the price but not the +120 floor');
  assert.equal(shouldBuyProperty(bot, completer, game), true, 'the completer is exempt from the floor');
  assert.equal(shouldBuyProperty(bot, completer), false, 'without the board the flat floor applies');
  assert.equal(shouldBuyWithPlan(game, bot, completer), true, 'the bot buys the completing deed');
  const stray = game.getTile(6);
  bot.cash = stray.price + 20;
  assert.equal(shouldBuyProperty(bot, stray, game), false, 'a deed that completes nothing keeps the floor');
  assert.equal(shouldBuyWithPlan(game, bot, stray), false);
});

// --- F3: smaller bot-policy defects ------------------------------------------------

check('F3: jail stay-or-leave tells opponents apart when it reads the board', () => {
  const { game, bot, humans } = botRoom({ cash: 300 });
  bot.inJail = true;
  game.roundNumber = 14;
  // Brown split between two different opponents is nobody's monopoly.
  ownTile(game, humans[0], 1);
  ownTile(game, humans[1], 3);
  assert.equal(jailStayBeatsExit(game, bot), false, 'a split Brown pair is not a developed table: leaving jail stays attractive');
  // The same two deeds held by one opponent are a monopoly: the table is mid-game.
  ownTile(game, humans[0], 3);
  humans[1].properties = humans[1].properties.filter(index => index !== 3);
  assert.equal(jailStayBeatsExit(game, bot), true, 'one opponent holding the whole set is a mid-game table; with thin cash the bot stays');
});

// A bot owing $300 with two built Brown deeds, $40 in cash and a bank loan on offer.
function builtDebtor(severity) {
  const fixture = botRoom({ cash: 40 });
  const { game, bot, humans } = fixture;
  game.settings.bankLoanSeverity = severity;
  [1, 3].forEach(index => {
    ownTile(game, bot, index).houseCount = 2;
  });
  humans[0].cash = 500;
  game.pendingPayment = { playerId: bot.id, creditorId: humans[0].id, amountRemaining: 300, reason: 'f3 debt', equityTileIndex: null, equityOwnerId: null };
  game.pendingPaymentHooks = {};
  game.pendingPaymentTurnOptions = {};
  game.currentPlayerId = bot.id;
  game.hasRolled = true;
  return fixture;
}

async function houseRescueChoice(game, bot) {
  const candidates = getBotChoiceCandidates(game, bot, 'payment');
  const decision = await new DeterministicAdvisor().chooseAction({
    ...buildBotStrategicContext(game, bot, 'payment', 1),
    botBrain: 'no-ai', botDifficulty: 'table', gameId: 'f3-debt', decisionSequence: 1, candidates
  });
  return { candidates, decision };
}

await checkAsync('F3: a predatory bank loan is not taken before selling a house', async () => {
  const { game, bot } = builtDebtor('predatory');
  assert.equal(game.getBankLoanOffer(bot).severity, 'predatory', 'the offer is the default predatory loan');
  const { candidates, decision } = await houseRescueChoice(game, bot);
  const sells = candidates.filter(candidate => candidate.id.startsWith('debt:sell:'));
  assert.ok(sells.length > 0, 'houses can be sold');
  assert.match(decision.actionId, /^debt:sell:/, 'the rescue sells a house first');
  const loan = candidates.find(candidate => candidate.id === 'debt:loan');
  assert.ok(loan.score > candidates.find(candidate => candidate.id === 'debt:bankruptcy').score, 'the loan still beats bankruptcy');
  assert.ok(sells.every(sale => sale.score > loan.score), 'every sale outranks the 50% premium loan');
});

await checkAsync('F3: a fair-priced bank loan still comes before selling a house', async () => {
  const { game, bot } = builtDebtor('fair');
  assert.equal(game.getBankLoanOffer(bot).severity, 'fair');
  const { decision } = await houseRescueChoice(game, bot);
  assert.equal(decision.actionId, 'debt:loan', 'a 20% premium is cheaper than the 50% a house sale gives away');
});

await checkAsync('F3: a zero-cash bot after its roll takes an available loan before declaring bankruptcy', async () => {
  const { room, game, bot } = botRoom({ cash: 0 });
  game.hasRolled = true;
  assert.equal(game.getBankLoanOffer(bot).available, true, 'the bank offers a loan');
  const ids = game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: true }).map(candidate => candidate.id);
  assert.deepEqual(ids, ['loan:emergency', 'bankruptcy:zero-cash'], 'the loan is offered ahead of bankruptcy');
  const result = await runBotTurn(room, bot, new DeterministicAdvisor());
  assert.equal(result.success, true);
  assert.equal(result.botDecision.actionId, 'loan:emergency');
  assert.equal(bot.bankrupt, false, 'the bot is still in the game');
  assert.equal(bot.cash, 300, 'the loan principal reached the bot');
});

for (const [catalogId, expectedCash] of [['silver-keepsake', 75], ['parlor-bond', 50], ['prison-key', 25]]) {
  await checkAsync(`zero-cash bot sells ${catalogId} before bankruptcy`, async () => {
    const { room, game, bot } = botRoom({ cash: 0, settings: { itemRewards: true } });
    game.hasRolled = true;
    game.getBankLoanOffer = () => ({ available: false });
    const item = game.grantItem(bot, catalogId, 'treasure');
    const candidates = game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: true });
    assert.ok(candidates.find(candidate => candidate.id === `item-sell:${item.itemId}`));
    const result = await runBotTurn(room, bot, new DeterministicAdvisor());
    assert.equal(result.success, true);
    assert.equal(bot.bankrupt, false);
    assert.equal(bot.cash, expectedCash);
    assert.equal(bot.items.length, 0);
  });
}

await checkAsync('F3: a zero-cash bot with no loan on offer still declares bankruptcy', async () => {
  const { game, bot } = botRoom({ cash: 0 });
  game.hasRolled = true;
  game.getBankLoanOffer = () => ({ available: false });
  const ids = game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: true }).map(candidate => candidate.id);
  assert.deepEqual(ids, ['bankruptcy:zero-cash']);
});

// --- F3: market and casino candidates mirror the engine's table-obligation guard ---------

function marketRoom() {
  const fixture = botRoom({ cash: 6000, settings: { casino: true, market: true } });
  fixture.game.roundNumber = 6;
  fixture.game.hasRolled = false;
  const [instrumentId] = Object.keys(fixture.game.marketQuotes);
  fixture.bot.marketPositions = { [instrumentId]: { quantity: 1, averageCost: 1 } };
  return fixture;
}

const tableKinds = candidates => [...new Set(candidates.filter(candidate => ['casino', 'market'].includes(candidate.kind))
  .map(candidate => `${candidate.kind}:${candidate.side || ''}`))].sort();

check('F3: casino and market candidates appear when the table is free', () => {
  const { game, bot } = marketRoom();
  assert.deepEqual(tableKinds(game.getBotCandidates(bot, { expanded: true, parity: true })), ['casino:', 'market:buy', 'market:sell'],
    'the control fixture offers a bet, market buys and a market sell');
});

[
  ['an open trade of its own', ({ room, bot, humans }) => room.runBotAction(bot.id, actor => room.proposeTrade(actor, {
    toPlayerId: humans[0].id, giveCash: 10, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: []
  }))],
  ['an open loan contract of its own', ({ room, bot, humans }) => room.runBotAction(bot.id, actor => room.proposePlayerContract(actor, {
    kind: 'loan', toPlayerId: humans[0].id, amount: 100, premiumRate: 10, durationRounds: 3
  }))]
].forEach(([label, open]) => {
  check(`F3: no casino or market candidate is offered while the bot has ${label}`, () => {
    const fixture = marketRoom();
    assert.equal(open(fixture).success, true, 'the obligation opens');
    assert.equal(fixture.game.tableObligationPending(), true, 'the engine reports a table obligation');
    assert.deepEqual(tableKinds(fixture.game.getBotCandidates(fixture.bot, { expanded: true, parity: true })), [],
      'the engine would refuse every one of these, so none is offered');
    assert.deepEqual(tableKinds(fixture.game.botPostRollCandidates(fixture.bot, { expanded: true, parity: true, postRoll: true })), []);
  });
});

// --- B-24 -------------------------------------------------------------------

check('B-24: loan-contract candidates target a borrower who can service them', () => {
  const { game, bot, humans } = botRoom({ cash: 1500 });
  const [poor, solvent] = humans;
  poor.cash = 80;
  solvent.cash = 900;
  ownTile(game, poor, 1);
  game.currentPlayerId = bot.id;
  const proposals = loanProposals(game, bot);
  const loans = proposals.filter(candidate => candidate.offer.kind === 'loan');
  // Serviceable means the borrower's cash covers the total due within the shared
  // repayment ratio; whether a human signs is the human's own decision.
  const accepts = candidate => {
    const borrower = game.getPlayerById(candidate.offer.toPlayerId);
    return loanTotalDue(candidate.offer) <= Number(borrower.cash) * CONTRACT_REPAY_RATIO;
  };
  const forPoor = candidate => candidate.offer.toPlayerId === poor.id;
  // $80 of cash cannot service a $405 obligation, so no cash loan is aimed at
  // that seat any more — and the top of the list is always closable.
  assert.equal(loans.some(forPoor), false, 'no doomed cash loan is proposed to a broke borrower');
  assert.ok(loans.length >= 2, 'all viable borrowers are considered instead of truncating to two seats');
  const solventLoan = loans.find(candidate => candidate.offer.toPlayerId === solvent.id);
  assert.ok(solventLoan, 'the solvent seat still gets its loan proposal');
  assert.ok(loans.every(accepts), 'every proposed loan is serviceable by its target');
  assert.equal(solventLoan.offer.amount, 300, 'the lender still sizes the loan off its own balance sheet');
  // The broke borrower keeps the legs that do not need their cash.
  const poorLegs = proposals.filter(forPoor).map(candidate => candidate.offer.kind);
  assert.deepEqual(poorLegs.sort(), ['equity'], 'a cash-poor target still gets its deed-backed options');
});

check('B-24: loan ranking follows acceptance headroom, not borrower need', () => {
  const { game, bot, humans } = botRoom({ cash: 1500 });
  const [mid, roomy] = humans;
  mid.cash = 700;
  roomy.cash = 5000;
  game.currentPlayerId = bot.id;
  const loans = loanProposals(game, bot).filter(candidate => candidate.offer.kind === 'loan');
  assert.equal(loans.length, humans.filter(player => player.cash >= 600).length, 'all borrowers who can service the terms are represented');
  const borrowerOf = candidate => game.getPlayerById(candidate.offer.toPlayerId);
  // All clear the accept gate; headroom ranks roomier borrowers first.
  assert.ok(loans[0].score > loans[1].score, 'the borrower with more headroom ranks first');
  assert.equal(borrowerOf(loans[0]).id, roomy.id, 'the roomiest borrower leads the list');
  assert.ok(loans.every(candidate => loanTotalDue(candidate.offer) <= borrowerOf(candidate).cash * 0.8),
    'every proposed loan is serviceable under the responder gate');
});

// --- B-26 -------------------------------------------------------------------

check('B-26: equal-score builds rank by development value, not by ascending cost', () => {
  const { game, bot } = botRoom({ cash: 2000 });
  ownGroup(game, bot, 'Brown');          // $50 house, ~$40 rent gain per circuit
  ownGroup(game, bot, 'Dark Blue');      // $200 house, ~$140-200 rent gain per circuit
  const builds = buildIds(game.getBotCandidates(bot));
  assert.equal(builds.length, 4, 'both monopolies offer build candidates');
  const groups = builds.map(id => game.getTile(Number(id.split(':')[1])).group);
  assert.equal(groups.filter(group => group === 'Dark Blue').length, 2);
  assert.equal(groups.filter(group => group === 'Brown').length, 2);
  assert.ok(groups.indexOf('Dark Blue') < groups.lastIndexOf('Brown'),
    `the $200 Dark Blue monopoly must outrank the $50 Brown one, got ${builds.join(' -> ')}`);
  assert.deepEqual(buildIds(game.getBotCandidates(bot)), builds, 'build ordering is deterministic');
  assert.deepEqual(buildIds(game.getBotCandidates(bot, { expanded: true, parity: true })), builds,
    'the parity-mode rail orders builds identically');
});

check('B-26: builds inside one monopoly keep their stable board order', () => {
  const { game, bot } = botRoom({ cash: 2000 });
  const tiles = ownGroup(game, bot, 'Light Blue');
  assert.deepEqual(buildIds(game.getBotCandidates(bot)), tiles.map(tile => `build:${tile.index}`),
    'equal-value builds in one group keep declaration order instead of shuffling');
});

console.log(`\n${failures.length ? `${failures.length} bot-correctness checks failed` : 'all bot-correctness checks passed'}`);
if (failures.length) process.exitCode = 1;
