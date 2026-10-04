// Regression suite for three bot-correctness defects found in the audit
// campaign. Every check pins one repaired defect so it cannot silently
// regress; the classification notes live in the campaign report.
//
//   B-23  botLogic.plannedPurchaseDecision compared the buy projection against
//         a `pass` candidate. `pass` has no applier in the planner, so it came
//         back 'unsupported' and scored 0: the verdict became "is
//         buy.score >= 0" instead of "is this deed better than doing nothing".
//   B-24  botApi.loanContractCandidate scored the *neediest* borrower highest
//         while the responder gate (totalDue <= cash * CONTRACT_REPAY_FACTOR)
//         makes exactly those proposals a guaranteed decline.
//   B-26  botApi.sortCandidates broke equal-score ties on ascending cost. All
//         build candidates share one score, so every build was ordered
//         cheapest-first and a monopoly bot developed its weakest rent stream.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import { evaluateCandidate } from './botFuturePlanner.js';
import { shouldBuyWithPlan, shouldAcceptPlayerContract } from './botLogic.js';

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

// --- fixtures ---------------------------------------------------------------

let roomSerial = 0;
function botRoom({ personality = 'builder', cash = 1500, humanSeats = 2 } = {}) {
  roomSerial += 1;
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'host', clientId: 'host', nickname: 'Host', roomCode: `BOTFIX${roomSerial}` });
  for (let seat = 0; seat < humanSeats; seat += 1) {
    room.addOrReconnectPlayer({ socketId: `seat-${seat}`, clientId: `seat-${seat}`, nickname: `Seat ${seat}` });
  }
  room.setRoomSetting('bots', 1);
  room.setRoomSetting('botPersonality', personality);
  room.setRoomSetting('botDifficulty', 'table');
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
  const { game, bot } = botRoom({ cash: 1500 });
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
      expected: buy.score >= standStill.score,
      actual: shouldBuyWithPlan(game, bot, tile)
    };
  });
  assert.ok(verdicts.length > 10, 'the fixture board offers a spread of deeds');
  assert.equal(verdicts[0].status, 'projected', 'the stand-still baseline is a real projection');
  assert.ok(verdicts[0].standStillScore > 0, 'the stand-still baseline carries the liquidity/rent value');
  assert.ok(verdicts.some(verdict => verdict.buyScore < verdict.standStillScore),
    'the fixture contains deeds the planner values below doing nothing');
  verdicts.forEach(verdict => {
    assert.equal(verdict.actual, verdict.expected,
      `tile ${verdict.tile.index} (${verdict.tile.group}): buy ${verdict.buyScore.toFixed(2)} vs stand-still ${verdict.standStillScore.toFixed(2)}`);
  });
});

check('B-23: the planner stops buying deeds it values below doing nothing', () => {
  const { game, bot } = botRoom({ cash: 1500 });
  game.roundNumber = 14;
  bot.properties = [];
  const verdicts = game.tiles.filter(tile => tile.type === 'property')
    .map(tile => ({ tile, buy: shouldBuyWithPlan(game, bot, tile) }));
  const bought = verdicts.filter(verdict => verdict.buy).map(verdict => verdict.tile);
  const premium = verdicts.find(verdict => verdict.tile.index === 21);
  assert.ok(premium, 'the fixture board still carries the $220 deed');
  assert.equal(premium.buy, false, 'a deed the planner scores below the stand-still projection is declined');
  assert.ok(bought.length > 0, 'the fix is not a blanket refusal: deeds above the baseline are still bought');
});

// --- B-24 -------------------------------------------------------------------

check('B-24: loan-contract candidates target a borrower who can service them', () => {
  const { game, bot, humans } = botRoom({ personality: 'diplomat', cash: 1500 });
  const [poor, solvent] = humans;
  poor.cash = 80;
  solvent.cash = 900;
  ownTile(game, poor, 1);
  game.currentPlayerId = bot.id;
  const proposals = loanProposals(game, bot);
  const loans = proposals.filter(candidate => candidate.offer.kind === 'loan');
  const accepts = candidate => {
    const borrower = game.getPlayerById(candidate.offer.toPlayerId);
    return shouldAcceptPlayerContract(
      { ...candidate.offer, totalDue: loanTotalDue(candidate.offer) },
      borrower,
      bot,
      borrower.personality || 'survivor',
      game
    );
  };
  const forPoor = candidate => candidate.offer.toPlayerId === poor.id;
  // $80 of cash cannot service a $405 obligation, so no cash loan is aimed at
  // that seat any more — and the top of the list is always closable.
  assert.equal(loans.some(forPoor), false, 'no doomed cash loan is proposed to a broke borrower');
  assert.equal(loans.length, 1, 'the solvent seat still gets its loan proposal');
  assert.equal(loans[0].offer.toPlayerId, solvent.id);
  assert.equal(accepts(loans[0]), true, 'the top-ranked loan proposal is one the borrower will accept');
  assert.equal(loans[0].offer.amount, 300, 'the lender still sizes the loan off its own balance sheet');
  // The broke borrower keeps the legs that do not need their cash.
  const poorLegs = proposals.filter(forPoor).map(candidate => candidate.offer.kind);
  assert.deepEqual(poorLegs.sort(), ['equity', 'hybrid'], 'a cash-poor target still gets its deed-backed options');
});

check('B-24: loan ranking follows acceptance headroom, not borrower need', () => {
  const { game, bot, humans } = botRoom({ personality: 'diplomat', cash: 1500 });
  const [mid, roomy] = humans;
  mid.cash = 700;
  roomy.cash = 5000;
  game.currentPlayerId = bot.id;
  const loans = loanProposals(game, bot).filter(candidate => candidate.offer.kind === 'loan');
  assert.equal(loans.length, 2, 'both borrowers can service these terms');
  const borrowerOf = candidate => candidate.offer.toPlayerId === mid.id ? mid : roomy;
  // Both clear the accept gate here, so only headroom separates them: the old
  // score gave both 10 and the collector's ascending-cash order put the
  // bare-margin borrower first.
  assert.ok(loans[0].score > loans[1].score, 'the borrower with more headroom ranks first');
  assert.equal(borrowerOf(loans[0]).id, roomy.id, 'the roomier borrower leads the list');
  assert.ok(loans.every(candidate => loanTotalDue(candidate.offer) <= borrowerOf(candidate).cash * 0.8),
    'every proposed loan is serviceable under the responder gate');
});

// --- B-26 -------------------------------------------------------------------

check('B-26: equal-score builds rank by development value, not by ascending cost', () => {
  const { game, bot } = botRoom({ personality: 'builder', cash: 2000 });
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
  const { game, bot } = botRoom({ personality: 'builder', cash: 2000 });
  const tiles = ownGroup(game, bot, 'Light Blue');
  assert.deepEqual(buildIds(game.getBotCandidates(bot)), tiles.map(tile => `build:${tile.index}`),
    'equal-value builds in one group keep declaration order instead of shuffling');
});

console.log(`\n${failures.length ? `${failures.length} bot-correctness checks failed` : 'all bot-correctness checks passed'}`);
if (failures.length) process.exitCode = 1;
