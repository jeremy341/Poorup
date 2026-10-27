// Regression pins for audit findings 2 and 3 (docs/BOT-ENGINE-AUDIT-2026-10.md):
//   2. the planner booked an open-short as +48 (sale proceeds as profit, liability and
//      fees ignored), so bots farmed shorts, never covered, drained the borrow pool and
//      ended with unpaid shortDefaultDebt;
//   3. the round-limit winner and the net-worth chart ignored shorts, spot units, margin
//      and contracts, so a seat could be crowned by opening a short.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { ROUND_LIMIT } from './gameData.js';
import { netWorth as sharedNetWorth, netWorthBreakdown } from './netWorth.js';
import { netWorth as brainNetWorth } from './botTableBrain.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import { evaluateCandidate } from './botFuturePlanner.js';
import { forecastLeveragedOpen } from './botMarketForecast.js';
import { candidateAction } from './botLogic.js';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS - ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL - ${name}: ${error.stack || error.message}`);
  }
}

function marketRoom(complexity = 'shorting') {
  const manager = new RoomManager();
  const room = manager.createRoom({
    socketId: 'a', clientId: 'a', nickname: 'A', rulesProfile: 'advanced',
    rulesetOverrides: { bankLoans: true, casino: true, market: true, globalEvents: true }, marketComplexity: complexity
  });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.setRoomSetting('market', true);
  room.setRoomSetting('marketComplexity', complexity);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  game.currentPlayerId = game.players[0].id;
  return { room, game, a: game.players[0], b: game.players[1] };
}

function setQuote(game, id, quote) {
  game.marketQuotes[id] = quote;
}

function planner(game, bot, candidate) {
  const snapshot = buildBotStrategicContext(game, bot, 'pre-roll', 1);
  return evaluateCandidate(snapshot, candidate, { difficulty: 'table', seed: 'market-accounting' });
}

check('net worth has one definition shared by the bot brain and the engine', () => {
  assert.equal(brainNetWorth, sharedNetWorth);
});

check('opening a short changes net worth only by its fees, never by its sale proceeds', () => {
  const { room, game, a } = marketRoom();
  setQuote(game, 'brazil', 100);
  const before = sharedNetWorth(game, a);
  assert.equal(room.openShort('a', 'brazil', 1, 'acct-short').success, true);
  const after = sharedNetWorth(game, a);
  // 2% open fee + 1% borrow fee held against the position.
  assert.equal(before - after, 3, 'the short costs its fees and nothing else');
  assert.ok(a.cash > 1500 - 3 - 100, 'cash rose by the sale proceeds net of collateral, which is why cash alone misleads');
  const parts = netWorthBreakdown(game, a);
  assert.equal(parts.shorts, 50 - 100 - 1, 'collateral held, minus units owed at the quote, minus the borrow fee');
});

check('a short that moves against its owner lowers net worth, and a drop raises it', () => {
  const { room, game, a } = marketRoom();
  setQuote(game, 'brazil', 100);
  assert.equal(room.openShort('a', 'brazil', 1, 'acct-short-move').success, true);
  const flat = sharedNetWorth(game, a);
  setQuote(game, 'brazil', 120);
  assert.equal(flat - sharedNetWorth(game, a), 20);
  setQuote(game, 'brazil', 80);
  assert.equal(sharedNetWorth(game, a) - flat, 20);
});

check('spot units and margin positions are marked to the quote', () => {
  const { room, game, a } = marketRoom('margin');
  setQuote(game, 'brazil', 100);
  const start = sharedNetWorth(game, a);
  assert.equal(room.openMargin('a', 'brazil', 1, 'acct-margin').success, true);
  assert.equal(start - sharedNetWorth(game, a), 2, 'margin costs only its 2% fee');
  a.marketPositions.airports = { quantity: 2, averageCost: 50, realizedPnl: 0 };
  setQuote(game, 'airports', 70);
  const withSpot = sharedNetWorth(game, a);
  setQuote(game, 'airports', 90);
  assert.equal(sharedNetWorth(game, a) - withSpot, 40, 'two units move by their quote change');
  setQuote(game, 'brazil', 130);
  assert.equal(netWorthBreakdown(game, a).margin, 130 + 25 - 100, 'units + collateral - margin loan');
});

check('loan and hybrid contracts count: debt negative, receivable only from a solvent borrower', () => {
  const { game, a, b } = marketRoom('basic');
  const base = { kind: 'loan', status: 'active', remaining: 200, fromPlayerId: a.id, toPlayerId: b.id };
  game.playerContracts = [{ id: 'c1', ...base }];
  assert.equal(netWorthBreakdown(game, a).contracts, 200);
  assert.equal(netWorthBreakdown(game, b).contracts, -200);
  b.bankrupt = true;
  assert.equal(netWorthBreakdown(game, a).contracts, 0, 'a bankrupt borrower cannot pay');
  b.bankrupt = false;
  b.inDebt = true;
  assert.equal(netWorthBreakdown(game, a).contracts, 0, 'a borrower in debt cannot pay');
  assert.equal(netWorthBreakdown(game, b).contracts, -200, 'the debt is owed either way');
  game.playerContracts = [{ id: 'c2', ...base, status: 'paid' }, { id: 'c3', ...base, kind: 'equity' }];
  assert.equal(netWorthBreakdown(game, a).contracts, 0, 'paid loans and equity stakes carry no principal');
});

check('the round limit does not crown a seat that opened a short', () => {
  const { room, game, a, b } = marketRoom();
  setQuote(game, 'brazil', 100);
  assert.equal(room.openShort('a', 'brazil', 1, 'acct-round-limit').success, true);
  assert.ok(a.cash > b.cash, 'cash alone would crown the shorting seat');
  // Call the ranking directly: advanceRound also ticks the market, and a random quote move
  // would make this comparison a coin flip.
  game.roundNumber = ROUND_LIMIT + 1;
  assert.equal(game.endForRoundLimit(), true);
  assert.equal(game.started, false);
  assert.equal(game.lastEndReason, 'round-limit');
  assert.equal(game.lastWinner.id, b.id, 'net worth after the short is lower, so the other seat wins');
});

check('the per-round chart series uses the same net worth', () => {
  const { room, game, a } = marketRoom();
  setQuote(game, 'brazil', 100);
  assert.equal(room.openShort('a', 'brazil', 1, 'acct-chart').success, true);
  game.recordNetWorthSnapshot();
  const row = game.netWorthTimeline.at(-1);
  assert.equal(row.worth[a.id], sharedNetWorth(game, a));
  assert.ok(row.worth[a.id] < 1500, 'the short is not charted as a gain');
});

check('the planner no longer books an open-short as a profit (was +48)', () => {
  const { game, a } = marketRoom();
  a.isBot = true;
  setQuote(game, 'brazil', 100);
  const open = planner(game, a, { id: 'short:brazil', kind: 'open-short', instrumentId: 'brazil', quantity: 1 });
  assert.equal(open.projectionStatus, 'projected');
  assert.equal(open.estimatedNetWorthDelta, -5, 'open fee 2 + borrow fee 1 + cover fee 2');
  assert.ok(open.score < 0, `open-short must score below standing still, got ${open.score}`);
});

check('the planner prices open-margin at its fees and refuses it without cash for the collateral', () => {
  const { game, a } = marketRoom('margin');
  a.isBot = true;
  setQuote(game, 'brazil', 100);
  const open = planner(game, a, { id: 'margin:brazil', kind: 'open-margin', instrumentId: 'brazil', quantity: 1 });
  assert.equal(open.estimatedNetWorthDelta, -2);
  assert.ok(open.score < 0);
  a.cash = 20;
  assert.equal(planner(game, a, { id: 'margin:brazil', kind: 'open-margin', instrumentId: 'brazil', quantity: 1 }).projectionStatus, 'unsupported');
});

check('a held short scores a cover above standing still, and an underwater one scores more', () => {
  const { room, game, a } = marketRoom();
  a.isBot = true;
  setQuote(game, 'brazil', 100);
  assert.equal(room.openShort('a', 'brazil', 1, 'acct-cover').success, true);
  a.marketActionsThisTurn = 0;
  const cover = { id: 'cover:brazil', kind: 'cover-short', instrumentId: 'brazil', quantity: 1 };
  const flat = planner(game, a, cover);
  assert.equal(flat.projectionStatus, 'projected');
  assert.ok(flat.score > 0, `covering a flat short beats holding it, got ${flat.score}`);
  setQuote(game, 'brazil', 135);
  const underwater = planner(game, a, cover);
  assert.ok(underwater.score > flat.score + 20, `an underwater short is covered more urgently (${underwater.score} vs ${flat.score})`);
});

check('a bot is only offered a short or margin long when the edge after costs is clearly positive', () => {
  const { game, a } = marketRoom('shorting');
  a.isBot = true;
  setQuote(game, 'brazil', 100);
  const offered = () => game.botMarketExpansionCandidates(a).map(candidate => candidate.kind);
  assert.equal(offered().includes('open-short'), false, 'a flat market has no edge over the 5% round trip');
  assert.equal(offered().includes('open-margin'), false);
  const flatShort = forecastLeveragedOpen({ kind: 'open-short', instrumentId: 'brazil', quote: 100, quantity: 1 });
  assert.equal(flatShort.clear, false);
  // An announced crash that has not hit the quote yet is a real edge for a short.
  game.globalEvent = { id: 'crash', phase: 'active', startedRound: game.roundNumber };
  game.activeEventEffects = () => ({ marketPriceMultiplier: 0.6 });
  const crash = game.botMarketExpansionCandidates(a).find(candidate => candidate.kind === 'open-short');
  assert.ok(crash, 'a clearly positive expected value is offered');
  assert.ok(crash.score > 0);
  assert.equal(game.botMarketExpansionCandidates(a).some(candidate => candidate.kind === 'open-margin'), false, 'the same crash is no reason to go long');
});

check('a drained borrow pool offers no short', () => {
  const { game, a } = marketRoom('shorting');
  a.isBot = true;
  game.marketShortInventory = { brazil: 0, airports: 0, shipping: 0, energy: 0 };
  Object.keys(game.marketQuotes).forEach(id => { game.marketShortInventory[id] = 0; });
  game.globalEvent = { id: 'crash', phase: 'active', startedRound: game.roundNumber };
  game.activeEventEffects = () => ({ marketPriceMultiplier: 0.6 });
  assert.equal(game.botMarketExpansionCandidates(a).some(candidate => candidate.kind === 'open-short'), false);
  const snapshot = buildBotStrategicContext(game, a, 'pre-roll', 1);
  const outcome = evaluateCandidate(snapshot, { id: 'short:x', kind: 'open-short', instrumentId: 'brazil', quantity: 1 }, { difficulty: 'table' });
  assert.equal(outcome.projectionStatus, 'unsupported', 'the planner refuses a short the table cannot fill');
});

check('a held short is offered for cover with the quantity the seat can fund', () => {
  const { room, game, a } = marketRoom('shorting');
  a.isBot = true;
  setQuote(game, 'brazil', 100);
  assert.equal(room.openShort('a', 'brazil', 3, 'acct-fund').success, true);
  a.marketActionsThisTurn = 0;
  setQuote(game, 'brazil', 140);
  a.cash = 100;
  const cover = game.botMarketExpansionCandidates(a).find(candidate => candidate.kind === 'cover-short');
  assert.ok(cover && cover.quantity >= 1 && cover.quantity < 3, `a partial cover is offered, got ${cover?.quantity}`);
  assert.equal(room.coverShort('a', cover.instrumentId, cover.quantity, 'acct-fund-cover').success, true, 'the server accepts the offered quantity');
});

check('an unaffordable worst short does not hide an affordable alternative cover', () => {
  const { room, game, a } = marketRoom('derivatives');
  a.isBot = true;
  setQuote(game, 'brazil', 100);
  setQuote(game, 'airports', 100);
  assert.equal(room.openShort('a', 'brazil', 1, 'acct-alt-short-brazil').success, true);
  a.marketActionsThisTurn = 0;
  assert.equal(room.openShort('a', 'airports', 1, 'acct-alt-short-airports').success, true);
  a.marketActionsThisTurn = 0;
  setQuote(game, 'brazil', 140);
  setQuote(game, 'airports', 10);
  a.cash = 0;

  const cover = game.botMarketExpansionCandidates(a).find(candidate => candidate.kind === 'cover-short');
  assert.equal(cover?.instrumentId, 'airports', 'the best available cover is selected after filtering by affordability');
  assert.equal(cover?.quantity, 1);
  assert.equal(room.coverShort('a', cover.instrumentId, cover.quantity, 'acct-alt-short-cover').success, true, 'the server accepts the offered cover');
});

check('a bot can settle short buy-in debt, and the planner values it', () => {
  const { room, game, a } = marketRoom('shorting');
  a.isBot = true;
  a.shortDefaultDebt = 150;
  a.cash = 1000;
  const settle = game.botMarketExpansionCandidates(a).find(candidate => candidate.kind === 'settle-short-default');
  assert.ok(settle, 'a settle candidate exists');
  assert.equal(settle.amount, 150);
  assert.equal(candidateAction(settle, a).type, 'settle-short-default');
  const outcome = planner(game, a, settle);
  assert.equal(outcome.projectionStatus, 'projected');
  assert.ok(outcome.score > 0, `settling debt beats standing still, got ${outcome.score}`);
  a.cash = 200;
  assert.equal(game.botMarketExpansionCandidates(a).find(candidate => candidate.kind === 'settle-short-default').amount, 80, 'keeps the reserve');
  a.cash = 1000;
  const paid = room.settleShortDefault('a', settle.amount, 'acct-settle');
  assert.equal(paid.success, true);
  assert.equal(a.shortDefaultDebt, 0);
  assert.equal(game.botMarketExpansionCandidates(a).some(candidate => candidate.kind === 'settle-short-default'), false);
});

check('open positions are not offered while buy-in debt is unpaid', () => {
  const { game, a } = marketRoom('shorting');
  a.isBot = true;
  a.shortDefaultDebt = 40;
  game.globalEvent = { id: 'crash', phase: 'active', startedRound: game.roundNumber };
  game.activeEventEffects = () => ({ marketPriceMultiplier: 0.6 });
  const kinds = game.botMarketExpansionCandidates(a).map(candidate => candidate.kind);
  assert.equal(kinds.includes('open-short'), false);
  assert.equal(kinds.includes('open-margin'), false);
});

const failed = results.filter(ok => !ok).length;
console.log(`bot market accounting: ${results.length - failed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
