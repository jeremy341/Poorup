// Regression suite for the backend audit fixes: every check pins one defect
// that was found, classified (bug vs intended feature), and repaired. The
// classification notes live in the audit campaign report; this file only
// encodes the corrected behavior so none of it can silently regress.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { contractSettlementRejection } from './bankruptcyLogic.js';
import { contractLastProposerId, contractResponderId } from './contractLogic.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import { expansionCandidates } from './marketExpansion.js';
import { rentFactsFromGame, calculateRentFromFacts } from './botRentForecast.js';
import { threatPerCircuit } from './botTableBrain.js';

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

function startedRoom(options = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', ...options });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

function threeSeatRoom(options = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', ...options });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'c', clientId: 'c', nickname: 'C' });
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

check('loan-backed cash cannot fund margin or short positions (F2)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours', marketComplexity: 'shorting' });
  const game = room.game;
  const player = game.players[0];
  player.bankLoan = { status: 'active', remaining: 500, collateralTileIndex: null };
  assert.deepEqual(room.openMargin('a', 'brazil', 2, 'f2-margin'), {
    success: false,
    error: 'Loan-backed cash cannot fund margin, short, or option positions.'
  });
  assert.deepEqual(room.openShort('a', 'brazil', 1, 'f2-short'), {
    success: false,
    error: 'Loan-backed cash cannot fund margin, short, or option positions.'
  });
  player.bankLoan = null;
  assert.equal(room.openShort('a', 'brazil', 1, 'f2-clear').success, true);
});

check('equity-transfer counters respect the negotiation limit (F3)', () => {
  const room = threeSeatRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [seller, owner, buyer] = game.players;
  const tile = game.getTile(1);
  tile.ownerId = owner.id;
  owner.properties.push(tile.index);
  tile.equityShares = [{ holderId: seller.id, share: 40, contractId: 'src-f3', control: 'passive' }];
  game.playerContracts.push({
    id: 'src-f3', kind: 'equity', fromPlayerId: seller.id, toPlayerId: owner.id,
    propertyIndex: tile.index, equityShare: 40, equityControl: 'passive', permanent: false,
    expiresRound: game.roundNumber + 4, amount: 100, status: 'active', createdRound: game.roundNumber
  });
  const proposal = game.proposeEquityShareTransfer('a', {
    fromPlayerId: seller.id, toPlayerId: buyer.id, contractId: 'src-f3',
    sharePct: 15, price: 60, requestId: 'f3-1'
  });
  assert.equal(proposal.success, true);
  const first = room.counterPlayerContract('c', { contractId: proposal.transfer.id, sharePct: 15, price: 70 });
  assert.equal(first.success, true);
  const second = room.counterPlayerContract('a', { contractId: proposal.transfer.id, sharePct: 15, price: 65 });
  assert.equal(second.success, true);
  const third = room.counterPlayerContract('c', { contractId: proposal.transfer.id, sharePct: 15, price: 75 });
  assert.deepEqual(third, { success: false, error: 'This contract has reached its negotiation limit.' });
});

check('settlement revalidates every deed of a collateral basket (F4)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const borrower = game.players[0];
  const tileA = game.getTile(1);
  const tileB = game.getTile(3);
  tileA.ownerId = borrower.id;
  tileB.ownerId = borrower.id;
  borrower.properties = [tileA.index, tileB.index];
  const contract = {
    id: 'basket-f4', kind: 'loan', status: 'active', fromPlayerId: game.players[1].id, toPlayerId: borrower.id,
    amount: 200, remaining: 230, totalDue: 230,
    collateralTileIndices: [tileA.index, tileB.index], collateralTileIndex: tileA.index
  };
  tileB.mortgaged = true;
  assert.deepEqual(contractSettlementRejection(game, borrower, contract), {
    success: false, error: 'The loan collateral is no longer available.'
  }, 'a mortgaged basket deed voids acceptance, not just the first index');
  // A deed that left the borrower (sold) between proposal and acceptance
  // must void the whole basket, not just skip the lost deed.
  tileB.mortgaged = false;
  tileB.ownerId = null;
  assert.deepEqual(contractSettlementRejection(game, borrower, contract), {
    success: false, error: 'The loan collateral is no longer available.'
  });
});

check('bankruptcy announces the bank when the creditor cannot receive (F5)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [a, b] = game.players;
  b.bankrupt = true;
  a.cash = 100;
  game.handleBankruptcy(a, b);
  const texts = game.feed.map(entry => entry.text);
  assert.equal(texts.includes('A is bankrupt. Assets transferred to the bank.'), true);
  assert.equal(texts.includes('A is bankrupt. Assets transferred to B.'), false);
});

check('a retried adjust with a used requestId replays instead of clearing the offer (T1)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const first = room.proposeTrade('a', { toPlayerId: game.players[1].id, giveCash: 50, requestId: 't1-r1' });
  assert.equal(first.success, true);
  const adjusted = room.adjustTrade('a', { toPlayerId: game.players[1].id, giveCash: 80, requestId: 't1-r2' });
  assert.equal(adjusted.success, true);
  const replayed = room.adjustTrade('a', { toPlayerId: game.players[1].id, giveCash: 80, requestId: 't1-r2' });
  assert.equal(replayed.success, true);
  assert.notEqual(game.pendingTrade, null, 'a requestId replay must not destroy the live offer');
  assert.equal(game.pendingTrade.giveCash, 80);
});

check('equity cannot be issued on a deed pledged as live loan collateral (T4)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [lender, borrower] = game.players;
  void lender;
  const tile = game.getTile(1);
  tile.ownerId = borrower.id;
  borrower.properties = [tile.index];
  borrower.bankLoan = { status: 'active', remaining: 400, collateralTileIndex: tile.index };
  const result = room.proposePlayerContract('a', {
    toPlayerId: borrower.id, kind: 'equity', propertyIndex: tile.index, equityShare: 30, amount: 100
  });
  assert.deepEqual(result, { success: false, error: 'Equity needs an unencumbered property owned by the recipient.' });
  borrower.bankLoan = null;
  assert.equal(room.proposePlayerContract('a', {
    toPlayerId: borrower.id, kind: 'equity', propertyIndex: tile.index, equityShare: 30, amount: 100
  }).success, true);
});

check('the deed owner cannot buy their own deed\'s equity (T6)', () => {
  const room = threeSeatRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [seller, owner, buyer] = game.players;
  const tile = game.getTile(1);
  tile.ownerId = owner.id;
  owner.properties.push(tile.index);
  tile.equityShares = [{ holderId: seller.id, share: 40, contractId: 'src-t6', control: 'passive' }];
  game.playerContracts.push({
    id: 'src-t6', kind: 'equity', fromPlayerId: seller.id, toPlayerId: owner.id,
    propertyIndex: tile.index, equityShare: 40, equityControl: 'passive', permanent: false,
    expiresRound: game.roundNumber + 4, amount: 100, status: 'active', createdRound: game.roundNumber
  });
  assert.deepEqual(game.proposeEquityShareTransfer('a', {
    fromPlayerId: seller.id, toPlayerId: owner.id, contractId: 'src-t6',
    sharePct: 15, price: 60, requestId: 't6-owner'
  }), { success: false, error: 'The property owner cannot buy equity in their own deed.' });
  assert.equal(game.proposeEquityShareTransfer('a', {
    fromPlayerId: seller.id, toPlayerId: buyer.id, contractId: 'src-t6',
    sharePct: 15, price: 60, requestId: 't6-ok'
  }).success, true);
});

check('negotiation relay authority follows lastProposerId, not depth parity (T8)', () => {
  // Equity transfers pin counterDepth at 2 while the proposer keeps
  // alternating; the relay must route by the recorded proposer.
  const contract = {
    id: 'relay-t8', kind: 'equity-transfer', fromPlayerId: 'seller', toPlayerId: 'buyer',
    counterDepth: 2, lastProposerId: 'buyer'
  };
  assert.equal(contractLastProposerId(contract), 'buyer');
  assert.equal(contractResponderId(contract), 'seller');
  contract.lastProposerId = 'seller';
  assert.equal(contractResponderId(contract), 'buyer');
  // Legacy contracts without lastProposerId still fall back to parity.
  const legacy = { id: 'relay-legacy', kind: 'loan', fromPlayerId: 'lender', toPlayerId: 'borrower', counterDepth: 1 };
  assert.equal(contractResponderId(legacy), 'lender');
  assert.equal(contractLastProposerId(legacy), 'borrower');
});

check('a departed seat\'s ballot is not tallied (T11)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const event = {
    id: 'anti-monopoly', phase: 'voting',
    choices: [{ id: 'enforce' }, { id: 'dismiss' }],
    votes: {}
  };
  game.players.forEach((player, index) => { event.votes[player.id] = index === 0 ? 'enforce' : 'dismiss'; });
  game.globalEvent = event;
  assert.deepEqual(game.globalEventVoteWinners(event), ['enforce', 'dismiss']);
  game.players[0].disconnected = true;
  assert.deepEqual(game.globalEventVoteWinners(event), ['dismiss']);
  game.players[0].disconnected = false;
  game.players[0].bankrupt = true;
  assert.deepEqual(game.globalEventVoteWinners(event), ['dismiss']);
});

check('combo events freeze unmortgage through the merged effect set (F1 residual)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const tile = game.getTile(1);
  tile.ownerId = game.players[0].id;
  tile.mortgaged = true;
  // Either firing order must leave the merged effects on the active event;
  // the unmortgage gate must read them, not only the parent IDs.
  game.globalEvent = {
    id: 'foreclosure-spiral', phase: 'active',
    effects: { constructionBlocked: true, bankLoansBlocked: true, mortgagesBlocked: true, rentMultiplier: 0.55 }
  };
  assert.equal(game.canUnmortgageTile(game.players[0], tile), false);
  // Without the effect key (pure ID gate) the legacy behavior still holds.
  game.globalEvent = { id: 'unrelated', phase: 'active', effects: {} };
  assert.equal(game.canUnmortgageTile(game.players[0], tile), true);
});

check('the strategic snapshot carries live market quotes (B3)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  game.marketQuotes = { ...game.marketQuotes, brazil: 123 };
  const context = buildBotStrategicContext(game, game.players[0], 'pre-roll', 0);
  assert.equal(context.marketQuotes.brazil, 123);
});

check('no open-option candidate is advertised without a server pricing policy (B5)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours', marketComplexity: 'derivatives' });
  const game = room.game;
  const player = game.players[0];
  game.optionPricingPolicy = null;
  const withoutPolicy = expansionCandidates(game, player, true);
  assert.equal(withoutPolicy.some(candidate => candidate.id === 'market:open-option'), false);
  game.optionPricingPolicy = { mode: 'approved-test-policy' };
  const withPolicy = expansionCandidates(game, player, true);
  assert.equal(withPolicy.some(candidate => candidate.id === 'market:open-option'), true);
});

check('bot equity candidates never target railroads (B6)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const bot = game.players[1];
  bot.isBot = true;
  const railroad = game.tiles.find(tile => tile.type === 'railroad');
  railroad.ownerId = game.players[0].id;
  game.players[0].properties = [railroad.index];
  game.currentPlayerId = bot.id;
  const candidates = game.botContractCandidates(bot);
  assert.equal(candidates.some(candidate => candidate.offer?.kind === 'equity'), false);
  assert.equal(candidates.some(candidate => candidate.offer?.kind === 'hybrid'), false);
  assert.equal(candidates.some(candidate => candidate.offer?.kind === 'loan'), true,
    'loan candidates stay available; only the equity legs require a property');
});

check('a loaned bot produces no contract candidates (B9)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const bot = game.players[1];
  bot.isBot = true;
  bot.cash = 1000;
  game.currentPlayerId = bot.id;
  assert.equal(game.botContractCandidates(bot).length > 0, true);
  bot.bankLoan = { status: 'active', remaining: 500, collateralTileIndex: null };
  assert.deepEqual(game.botContractCandidates(bot), []);
});

check('threat per circuit normalizes by the live board size (B1)', () => {
  const standard = startedRoom({ rulesetPreset: 'after-hours' });
  const metro = startedRoom({ rulesetPreset: 'after-hours', boardVariant: 'metro-52' });
  const setup = (game) => {
    const tile = game.tiles.find(candidate => candidate.type === 'property' && candidate.group);
    tile.ownerId = game.players[1].id;
    tile.rent = 100;
    tile.houseCount = 5;
    tile.mortgaged = false;
    return tile;
  };
  setup(standard.game);
  const metroTile = setup(metro.game);
  const standardThreat = threatPerCircuit(standard.game, standard.game.players[0].id, standard.game.players[1].id);
  const metroThreat = threatPerCircuit(metro.game, metro.game.players[0].id, metro.game.players[1].id);
  assert.equal(metroThreat > 0, true);
  assert.equal(metroThreat < standardThreat, true,
    `metro-52 (${metroThreat} on tile ${metroTile.index}) must dilute per-circuit threat vs standard-40 (${standardThreat})`);
});

check('bankruptcy settles an outstanding bank loan before deeds move (E2)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [a] = game.players;
  const tile = game.getTile(1);
  tile.ownerId = a.id;
  a.properties = [tile.index];
  tile.houseCount = 2;
  a.bankLoan = { status: 'active', remaining: 500, collateralTileIndex: tile.index };
  game.handleBankruptcy(a, null);
  assert.equal(a.bankLoan.status, 'defaulted');
  assert.equal(a.bankLoan.remaining, 0);
  assert.equal(tile.ownerId, null, 'secured collateral is seized to the bank');
  assert.equal(tile.houseCount, 0);
  assert.equal(a.properties.includes(tile.index), false);
});

check('a bankrupt auction leader no longer holds the bid floor (E5)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [a, b] = game.players;
  game.auction = {
    active: true, participants: [a.id, b.id], passedPlayerIds: [],
    highestBidderId: a.id, highestBid: 240, tileIndex: 1, endsAt: Date.now() + 5000
  };
  game.markPlayerBankrupt(a);
  assert.equal(game.auction.highestBidderId, null);
  assert.equal(game.auction.highestBid, 0);
  assert.equal(game.auction.participants.includes(a.id), false);
});

check('anti-monopoly rent follows the declared leaderRentMultiplier effect (E9)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const tile = game.tiles.find(candidate => candidate.type === 'property');
  tile.ownerId = game.players[0].id;
  game.globalEvent = {
    id: 'anti-monopoly', phase: 'active', resolvedChoice: 'enforce',
    targetPlayerId: game.players[0].id,
    effects: { leaderRentMultiplier: 0.4, marketPriceMultiplier: 0.9 }
  };
  const facts = rentFactsFromGame(game, tile);
  assert.equal(facts.eventFactors.includes(0.4), true,
    `expected the declared 0.4 multiplier, got [${facts.eventFactors.join(', ')}]`);
  assert.equal(calculateRentFromFacts(facts), Math.floor(Math.floor(tile.rent) * 0.4));
});

check('an in-flight auction keeps its clock under bank-run (T13, intended)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [a, b] = game.players;
  game.globalEvent = { id: 'bank-run', phase: 'active', effects: { bankActionsBlocked: true, auctionBlocked: true, marketPriceMultiplier: 0.75, tradingEnabled: false, casinoMaxBet: 250 } };
  game.auction = {
    active: true, participants: [a.id, b.id], passedPlayerIds: [],
    highestBidderId: null, highestBid: 0, tileIndex: 1, endsAt: Date.now() + 5000
  };
  assert.equal(room.placeAuctionBid('b', 60).success, true,
    'a running auction is not frozen by the event; only new auctions are blocked');
  assert.equal(game.auction.highestBid, 60);
  game.auction = null;
  const newAuction = game.startAuction(game.getTile(3), a.id);
  assert.equal(newAuction.success, false,
    'starting a new auction during bank-run is blocked');
  assert.equal(newAuction.error, 'Auctions are paused by the active Bank Run.');
});

check('totalCash normalizes by active seats, excluding departed wealth (E4, intended)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [a, b] = game.players;
  a.cash = 1000;
  b.cash = 500;
  assert.equal(game.totalCash(), 1500);
  b.bankrupt = true;
  b.cash = 5000;
  assert.equal(game.totalCash(), 1000,
    'a bankrupt whale\'s stranded cash must not inflate the economy used by event thresholds');
});

check('loan-backed cash cannot fund equity transfers, at proposal or acceptance (T2a)', () => {
  const room = threeSeatRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [seller, owner, buyer] = game.players;
  const tile = game.getTile(1);
  tile.ownerId = owner.id;
  owner.properties.push(tile.index);
  tile.equityShares = [{ holderId: seller.id, share: 40, contractId: 'src-t2a', control: 'passive' }];
  game.playerContracts.push({
    id: 'src-t2a', kind: 'equity', fromPlayerId: seller.id, toPlayerId: owner.id,
    propertyIndex: tile.index, equityShare: 40, equityControl: 'passive', permanent: false,
    expiresRound: game.roundNumber + 4, amount: 100, status: 'active', createdRound: game.roundNumber
  });
  buyer.bankLoan = { status: 'active', remaining: 500, collateralTileIndex: null };
  assert.deepEqual(game.proposeEquityShareTransfer('a', {
    fromPlayerId: seller.id, toPlayerId: buyer.id, contractId: 'src-t2a',
    sharePct: 15, price: 60, requestId: 't2a-1'
  }), { success: false, error: 'Loan-backed cash cannot fund equity transfers.' });
  buyer.bankLoan = null;
  const proposal = game.proposeEquityShareTransfer('a', {
    fromPlayerId: seller.id, toPlayerId: buyer.id, contractId: 'src-t2a',
    sharePct: 15, price: 60, requestId: 't2a-2'
  });
  assert.equal(proposal.success, true);
  buyer.bankLoan = { status: 'active', remaining: 500, collateralTileIndex: null };
  assert.deepEqual(game.respondPlayerContract('c', true, 't2a-accept', proposal.transfer.id), {
    success: false, error: 'Loan-backed cash cannot fund equity transfers.'
  }, 'acceptance revalidates the buyer\'s taint exactly as contract acceptance does');
  assert.equal(game.pendingPlayerContract, null);
});

check('a legacy room\'s optional systems survive the first ruleset meta write (T9)', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.settings.bankLoans = true;
  room.settings.casino = true;
  room.settings.market = true;
  room.settings.globalEvents = true;
  const boardVariantResult = room.setRoomSetting('boardVariant', 'standard-40');
  assert.equal(boardVariantResult.rejected, false);
  assert.equal(room.game.settings.bankLoans, true, 'legacy bankLoans toggle must be carried into overrides');
  assert.equal(room.game.settings.casino, true);
  assert.equal(room.game.settings.market, true);
  assert.equal(room.ruleset.effectiveSettings.globalEvents, true,
    'the ruleset flow must honor captured legacy overrides, not silently strip them');
});

if (failures.length) {
  console.error(`\nbackend audit regressions: ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log('backend audit regressions: all passed');
}
