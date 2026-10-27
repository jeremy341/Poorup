// Characterization suite for botLogic.js: every decision table, threshold,
// and phase ordering extracted from the original scheduleBotTurn inline chain
// is pinned here with boundary values. Each assertion is checked against the
// pre-refactor expression it replaces (trade factor 1.1/0.8, contract 1.25/0.8,
// auction step/reserve/comfort, purchase reserve 120, build buffer 200).
import fs from 'node:fs';
import assert from 'assert';
import { RoomManager } from './gameLogic.js';
import {
  selectGlobalEventPolicy,
  globalEventPolicyUtility,
  tradeLegValue,
  shouldAcceptTrade,
  shouldAcceptPlayerContract,
  selectBotTurnTarget,
  botMayStillAct,
  classifyBotTurnPhase,
  candidateAction,
  auctionBidDecision,
  AUCTION_BID_STEP,
  AUCTION_BID_INCREMENTS,
  decideBotAuction,
  getBotChoiceCandidates,
  isAuctionBotParticipant,
  shouldBuyProperty,
  sponsorshipContributionAmount,
  resolvePurchaseOffer,
  runBotTurn,
  runPaymentChoice,
  debtMortgageCandidates,
  nearMissTrade,
  pruneStaleOwnDeal,
  shouldBuyWithPlan,
  recordDeclinedProposal,
  CANDIDATE_RUNNERS
} from './botLogic.js';
import { jailStayBeatsExit } from './botApi.js';
import { DeterministicAdvisor } from './botAdvisor.js';
import { auctionLiquidityReserve, auctionWillingness, auctionRaiseOptions, defaultAuctionRaise, isAuctionRaise, AUCTION_BID_STEP as POLICY_AUCTION_BID_STEP } from './botAuctionPolicy.js';
import { deedValue, progressCredit } from './botTradeValuation.js';
import { tradePairCoolingOff } from './botTableMind.js';

let passed = 0;
const pending = [];
function check(name, fn) {
  const out = fn();
  if (out && typeof out.then === 'function') {
    pending.push(out.then(() => {
      passed += 1;
      console.log(`ok - ${name}`);
    }));
    return;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

check('auction selector preserves NO-AI baseline bid and wait decisions', async () => {
  const bot = { id: 'auction-bot', cash: 300 };
  const bid = await decideBotAuction({ auction: { highestBid: 0 }, bot, startingCash: 500 });
  const pass = await decideBotAuction({ auction: { highestBid: 400 }, bot, startingCash: 500 });
  assert.equal(bid.actionId, 'auction:bid');
  assert.equal(pass.actionId, 'auction:wait');
  assert.equal(bid.minimum, 1, 'the smallest opening bid is the +1 button');
  assert.equal(bid.amount, 20, 'the planner opens with the standard +20 raise');
});

check('auction selector accepts only legal AI overrides and retains minimum bid', async () => {
  const bot = { id: 'auction-bot', cash: 500 };
  const advisor = { supportsChoicePhases: true, chooseAction: async () => ({ actionId: 'auction:wait' }) };
  const legal = await decideBotAuction({ auction: { highestBid: 5 }, bot, startingCash: 500, advisor, context: {} });
  assert.equal(legal.actionId, 'auction:wait');
  assert.equal(legal.minimum, 6);
  const invalid = await decideBotAuction({ auction: { highestBid: 5 }, bot, startingCash: 500, advisor: { ...advisor, chooseAction: async () => ({ actionId: 'auction:invent' }) }, context: {} });
  assert.equal(invalid.actionId, 'auction:bid');
});

check('auction AI can choose a whole-dollar bid inside the server-issued utility range', async () => {
  const bot = { id: 'parameterized-auction-bot', cash: 2000 };
  let issuedBid = null;
  const advisor = {
    supportsChoicePhases: true,
    chooseAction: async ({ candidates }) => {
      issuedBid = candidates.find(candidate => candidate.id === 'auction:bid');
      return { actionId: 'auction:bid', parameters: { amount: 950 }, provider: 'ai', fallback: false };
    }
  };
  const choice = await decideBotAuction({ auction: { highestBid: 100 }, bot, startingCash: 1000, advisor });
  assert.equal(issuedBid.kind, 'auction-bid');
  // The ceiling is cash less the $120 reserve, so a $2000 bot may bid up to $1880.
  assert.deepEqual(issuedBid.parameterRanges.amount, { type: 'integer', minimum: 101, maximum: 1880 });
  assert.deepEqual(issuedBid.amountOptions, [101, 120, 200], 'the issued options are the +1, +20 and +100 buttons');
  assert.equal(choice.minimum, 101, 'the next legal minimum remains visible to the server');
  assert.equal(choice.amount, 120, 'a bid that is not one of the three buttons falls back to the standard raise');
  const outOfRange = await decideBotAuction({
    auction: { highestBid: 100 }, bot, startingCash: 1000,
    advisor: { ...advisor, chooseAction: async () => ({ actionId: 'auction:bid', parameters: { amount: 2001 }, provider: 'ai', fallback: false }) }
  });
  assert.equal(outOfRange.amount, 120, 'unvalidated parameters fall back to the standard raise');
  const hundred = await decideBotAuction({
    auction: { highestBid: 100 }, bot, startingCash: 1000,
    advisor: { ...advisor, chooseAction: async () => ({ actionId: 'auction:bid', parameters: { amount: 200 }, provider: 'ai', fallback: false }) }
  });
  assert.equal(hundred.amount, 200, 'the +100 button is a legal bot raise');
  const one = await decideBotAuction({
    auction: { highestBid: 100 }, bot, startingCash: 1000,
    advisor: { ...advisor, chooseAction: async () => ({ actionId: 'auction:bid', parameters: { amount: 101 }, provider: 'ai', fallback: false }) }
  });
  assert.equal(one.amount, 101, 'the +1 button is a legal bot raise');
});

check('auction shadow comparison stays out of persisted decision and reaches evaluation result', async () => {
  const evaluationTrace = { actionKind: 'auction', deterministicActionKind: 'auction', phase: 'auction' };
  const choice = await decideBotAuction({
    auction: { highestBid: 0 },
    bot: { id: 'auction-bot-shadow', cash: 1000 },
    startingCash: 1000,
    advisor: { supportsChoicePhases: true, chooseAction: async () => ({ actionId: 'auction:bid', shadowEvaluation: evaluationTrace }) }
  });
  assert.equal(choice.decision.shadowEvaluation, undefined);
  assert.deepEqual(choice.evaluationTrace, evaluationTrace);
});

const CHOICES = [{ id: 'low-tax' }, { id: 'public-works' }, { id: 'bank-first' }];

check('event vote uses one policy preference independent of legacy archetypes', () => {
  assert.strictEqual(selectGlobalEventPolicy({ choices: CHOICES }).id, 'low-tax');
  assert.strictEqual(selectGlobalEventPolicy({ choices: [{ id: 'z' }, { id: 'a' }] }).id, 'z');
  assert.strictEqual(selectGlobalEventPolicy({ choices: [] }), null);
  assert.strictEqual(selectGlobalEventPolicy(undefined), null);
});

check('city-election votes compare tax, rent, building, and liquidity outcomes', () => {
  const tiles = [
    { index: 1, type: 'property', group: 'Brown', ownerId: 'bot', price: 60, rent: 10, houseCount: 0, mortgaged: false },
    { index: 3, type: 'property', group: 'Brown', ownerId: 'bot', price: 60, rent: 10, houseCount: 0, mortgaged: false },
    { index: 4, type: 'tax', amount: 200, ownerId: null }
  ];
  const game = {
    settings: { botDifficulty: 'expert', startingCash: 1500, bankLoans: true },
    tiles,
    getTile: index => tiles.find(tile => tile.index === index) || null,
    getGroupTiles: group => tiles.filter(tile => tile.group === group),
    getPropertyHouseCost: () => 50,
    calculateRent: tile => tile.rent,
    getBankLoanOffer: () => ({ available: false })
  };
  const event = { id: 'city-election', choices: CHOICES };
  assert.equal(selectGlobalEventPolicy(event, game, { id: 'bot', cash: 1000, properties: [1, 3] }).id, 'public-works');
  const taxOnlyGame = { ...game, tiles: [tiles[2]], getGroupTiles: () => [] };
  assert.equal(selectGlobalEventPolicy(event, taxOnlyGame, { id: 'bot', cash: 0, properties: [] }).id, 'low-tax');
});

check('house-level event votes weigh immediate outcomes, not a one-turn horizon floor', () => {
  const tiles = [{ index: 4, type: 'tax', amount: 200, ownerId: null }];
  const gameAt = botDifficulty => ({
    settings: { botDifficulty, startingCash: 1500, bankLoans: true },
    tiles,
    getTile: index => tiles.find(tile => tile.index === index) || null,
    getGroupTiles: () => [],
    getPropertyHouseCost: () => 50,
    calculateRent: tile => tile.rent,
    getBankLoanOffer: () => ({ available: false })
  });
  const bot = { id: 'bot', cash: 1000, properties: [] };
  const event = { id: 'city-election', choices: CHOICES };
  assert.equal(globalEventPolicyUtility(event, { id: 'low-tax' }, gameAt('house'), bot), 0, 'house sees no future tax landings');
  assert.ok(globalEventPolicyUtility(event, { id: 'low-tax' }, gameAt('table'), bot) > 0, 'table still weighs one turn of tax exposure');
});

const TILES = { 5: { index: 5, price: 200 }, 6: { index: 6, price: 100 }, 7: { index: 7, price: 400 } };
const price = index => TILES[index];

check('trade acceptance uses one context-independent financial threshold', () => {
  const trade = { giveCash: 300, givePropertyIndexes: [5], requestCash: 50, requestPropertyIndexes: [7] };
  assert.strictEqual(shouldAcceptTrade(trade, price), true);
  const even = { giveCash: 400, givePropertyIndexes: [], requestCash: 400, requestPropertyIndexes: [] };
  assert.strictEqual(shouldAcceptTrade(even, price), true);
  const edge = { giveCash: 320, givePropertyIndexes: [], requestCash: 400, requestPropertyIndexes: [] };
  assert.strictEqual(shouldAcceptTrade(edge, price), true);
  const edgeShark = { giveCash: 440, givePropertyIndexes: [], requestCash: 400, requestPropertyIndexes: [] };
  assert.strictEqual(shouldAcceptTrade(edgeShark, price), true);
  assert.strictEqual(shouldAcceptTrade({ ...edgeShark, giveCash: 319 }, price), false);
  assert.strictEqual(tradeLegValue({ cash: '10', propertyIndexes: [5, 7] }, price), 610);
  assert.strictEqual(tradeLegValue(undefined, price), 0);
});

check('player-contract acceptance applies the shared borrower gate (botContractPolicy.js)', () => {
  const bot = { cash: 1000 };
  const lender = { bankrupt: false };
  const loan = { kind: 'loan', amount: 800, premiumRate: 0, durationRounds: 3, totalDue: 800 };
  assert.strictEqual(shouldAcceptPlayerContract(loan, bot, lender), true);
  // Serviceable from cash in hand: totalDue is capped at 80% of the borrower's cash.
  assert.strictEqual(shouldAcceptPlayerContract({ ...loan, amount: 801, totalDue: 801 }, bot, lender), false);
  assert.strictEqual(shouldAcceptPlayerContract({ ...loan, amount: 1250, totalDue: 1250 }, bot, lender), false);
  // A bot signs only interest-free loans with enough rounds to schedule the repayment.
  assert.strictEqual(shouldAcceptPlayerContract({ ...loan, premiumRate: 5, totalDue: 840 }, bot, lender), false);
  assert.strictEqual(shouldAcceptPlayerContract({ ...loan, durationRounds: 2 }, bot, lender), false);
  // Bankrupt or missing lender kills acceptance.
  assert.strictEqual(shouldAcceptPlayerContract(loan, bot, { bankrupt: true }), false);
  assert.strictEqual(shouldAcceptPlayerContract(loan, bot, null), false);
  // Equity cannot be priced without a board, and unknown kinds are never signed.
  assert.strictEqual(shouldAcceptPlayerContract({ kind: 'equity', amount: 350 }, bot, lender), false);
  assert.strictEqual(shouldAcceptPlayerContract({ kind: 'repayment', amount: 800 }, bot, lender), false);
  assert.strictEqual(shouldAcceptPlayerContract({ kind: 'equity-transfer', amount: 1 }, bot, lender), false);
});

function fakeGame(over = {}) {
  return {
    settings: { rulesProfile: 'advanced', playerFinance: true },
    players: [],
    globalEvent: null,
    pendingTrade: null,
    pendingPlayerContract: null,
    getCurrentPlayer: () => over.current || null,
    getPlayerById: id => (over.players || []).find(p => p.id === id) || null,
    ...over
  };
}

check('public choice candidate helper returns the runtime trade candidates', () => {
  const bot = { id: 'b1', isBot: true, cash: 1000 };
  const game = fakeGame({
    pendingTrade: { id: 'trade-1', toPlayerId: 'b1', fromPlayerId: 'h1', giveCash: 100, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [], counterDepth: 0 },
    getTile: () => null,
    pendingPayment: null,
    auction: null,
    pendingPurchaseOffer: null,
    pendingSponsoredPurchase: null,
    pendingPlayerContract: null
  });
  assert.deepEqual(getBotChoiceCandidates(game, bot, 'trade').map(candidate => candidate.id), ['trade:accept', 'trade:counter', 'trade:decline']);
});

check('target selection: vote beats pending counterparty beats current', () => {
  const bot1 = { id: 'b1', isBot: true };
  const bot2 = { id: 'b2', isBot: true };
  const human = { id: 'h1' };
  const voting = fakeGame({
    current: human,
    players: [bot1, bot2],
    globalEvent: { phase: 'voting', votes: { b1: 'x' } }
  });
  assert.strictEqual(selectBotTurnTarget(voting).id, 'b2');
  const pending = fakeGame({ current: bot1, players: [bot2], pendingTrade: { toPlayerId: 'b2' } });
  assert.strictEqual(selectBotTurnTarget(pending).id, 'b2');
  const pendingHuman = fakeGame({ current: bot1, players: [bot2], pendingTrade: { fromPlayerId: bot1.id, toPlayerId: 'h9' } });
  assert.strictEqual(selectBotTurnTarget(pendingHuman).id, 'b1');
  const pendingContractHuman = fakeGame({ current: bot1, players: [bot2], pendingPlayerContract: { fromPlayerId: bot1.id, toPlayerId: 'h9' } });
  assert.strictEqual(selectBotTurnTarget(pendingContractHuman).id, 'b1');
  const contract = fakeGame({ current: human, players: [bot1], pendingPlayerContract: { toPlayerId: 'b1' } });
  assert.strictEqual(selectBotTurnTarget(contract).id, 'b1');
  const payment = fakeGame({ current: human, players: [bot1], pendingPayment: { playerId: 'b1' } });
  assert.strictEqual(selectBotTurnTarget(payment).id, 'b1');
  const plain = fakeGame({ current: bot2 });
  assert.strictEqual(selectBotTurnTarget(plain).id, 'b2');
});

check('botMayStillAct keeps voting/pending alive off-turn', () => {
  const bot = { id: 'b1', isBot: true, bankrupt: false, disconnected: false };
  assert.strictEqual(botMayStillAct(fakeGame({ current: bot, players: [] }), bot), true);
  assert.strictEqual(botMayStillAct(fakeGame({ current: { id: 'x', isBot: false }, players: [] }), bot), false);
  assert.strictEqual(botMayStillAct(fakeGame({ current: { ...bot, bankrupt: true }, players: [] }), bot), false);
  assert.strictEqual(botMayStillAct(fakeGame({ current: bot, players: [], globalEvent: { phase: 'voting' } }), bot), true);
  assert.strictEqual(botMayStillAct(fakeGame({ current: { id: 'x' }, players: [], pendingTrade: { toPlayerId: 'b1' } }), bot), true);
  assert.strictEqual(botMayStillAct(fakeGame({ current: { id: 'x' }, players: [], pendingPayment: { playerId: 'b1' } }), bot), true);
});

check('phase classification order matches original if/else chain', () => {
  const bot = { id: 'b1', isBot: true };
  assert.strictEqual(classifyBotTurnPhase({ globalEvent: { phase: 'voting', votes: {} } }, bot), 'vote');
  assert.strictEqual(classifyBotTurnPhase({ globalEvent: { phase: 'voting', votes: { b1: 'x' } }, hasRolled: false }, bot), 'pre-roll');
  assert.strictEqual(classifyBotTurnPhase({ pendingTrade: { toPlayerId: 'b1' }, hasRolled: false }, bot), 'trade');
  assert.strictEqual(classifyBotTurnPhase({ pendingPlayerContract: { toPlayerId: 'b1' } }, bot), 'contract');
  assert.strictEqual(classifyBotTurnPhase({ pendingPayment: { playerId: 'b1' } }, bot), 'payment');
  assert.strictEqual(classifyBotTurnPhase({ auction: { active: true } }, bot), 'auction');
  assert.strictEqual(classifyBotTurnPhase({ auction: { active: false }, awaitingEndTurn: true }, bot), 'end-turn');
  assert.strictEqual(classifyBotTurnPhase({ hasRolled: false }, bot), 'pre-roll');
  assert.strictEqual(classifyBotTurnPhase({ hasRolled: true }, bot), 'post-roll');
  // vote wins over everything; auction beats end-turn; payment beats auction.
  assert.strictEqual(classifyBotTurnPhase({ pendingPayment: { playerId: 'b1' }, auction: { active: true } }, bot), 'payment');
});

check('candidateAction maps kind to room action or roll fallback', () => {
  const bot = { cash: 1000 };
  assert.deepStrictEqual(candidateAction({ kind: 'trade', id: 't1' }, bot), { type: 'trade', candidate: { kind: 'trade', id: 't1' } });
  assert.strictEqual(candidateAction({ kind: 'cancel-trade', tradeId: 't1' }, bot).type, 'cancel-trade');
  assert.strictEqual(candidateAction({ kind: 'market' }, bot).type, 'market');
  assert.strictEqual(candidateAction({ kind: 'casino' }, bot).type, 'casino');
  assert.strictEqual(candidateAction({ kind: 'repay', contractId: 'c1', amount: 20 }, bot).type, 'repay');
  assert.strictEqual(candidateAction({ kind: 'bank-repay', amount: 20 }, bot).type, 'bank-repay');
  assert.strictEqual(candidateAction({ kind: 'jail-fine' }, bot).type, 'jail-fine');
  assert.strictEqual(candidateAction({ kind: 'jail-free' }, bot).type, 'jail-free');
  assert.strictEqual(candidateAction({ kind: 'sell' }, bot).type, 'sell');
  assert.strictEqual(candidateAction({ kind: 'unmortgage' }, bot).type, 'unmortgage');
  assert.strictEqual(candidateAction({ kind: 'contract-propose' }, bot).type, 'contract-propose');
  assert.strictEqual(candidateAction({ kind: 'chat' }, bot).type, 'chat');
  assert.strictEqual(candidateAction({ kind: 'mortgage' }, bot).type, 'mortgage');
  assert.strictEqual(candidateAction({ kind: 'close-position', optionId: 'opt-1' }, bot).type, 'close-position');
  assert.strictEqual(candidateAction({ kind: 'end-finance-window' }, bot).type, 'end-turn');
  assert.strictEqual(candidateAction({ kind: 'build', cost: 799 }, bot).type, 'build');
  assert.strictEqual(candidateAction({ kind: 'build', cost: 801 }, bot).type, 'build');
  assert.strictEqual(candidateAction({ kind: 'loan' }, bot).type, 'loan');
  assert.strictEqual(candidateAction({ kind: 'loan' }, { cash: 1000 }).type, 'loan');
  assert.strictEqual(candidateAction({ kind: 'roll' }, bot).type, 'roll');
  assert.strictEqual(candidateAction(null, bot).type, 'roll');
  assert.strictEqual(candidateAction({ kind: 'mystery' }, bot).type, 'roll');
});

check('auction bid decision starts at the +1 button and preserves legal cash access', () => {
  const auction = { highestBid: 100 };
  // Bids may use cash above the $120 purchase reserve only (no board: static floor).
  assert.deepStrictEqual(auctionBidDecision(auction, { cash: 220 }, 1500), { shouldBid: false, minimum: 101, maximum: 100 });
  assert.deepStrictEqual(auctionBidDecision(auction, { cash: 221 }, 1500), { shouldBid: true, minimum: 101, maximum: 101 });
  assert.deepStrictEqual(auctionBidDecision({ highestBid: 0 }, { cash: 1000 }, 1000).minimum, 1);
});

check('bots raise with exactly the buttons the player UI offers', () => {
  const ui = fs.readFileSync(new URL('../public/clientAuctionUi.js', import.meta.url), 'utf8');
  const start = ui.indexOf('[', ui.indexOf('const BID_STEPS'));
  const uiSteps = JSON.parse(ui.slice(start, ui.indexOf(']', start) + 1));
  assert.deepStrictEqual([...AUCTION_BID_INCREMENTS], uiSteps, 'the player buttons and the bot options are the same list');
  assert.strictEqual(AUCTION_BID_STEP, 20);
  assert.strictEqual(AUCTION_BID_STEP, POLICY_AUCTION_BID_STEP, 'botLogic re-exports the policy constant, it does not copy it');
  for (const highestBid of [0, 1, 19, 20, 135, 999]) {
    assert.strictEqual(auctionBidDecision({ highestBid }, { cash: 5000 }, 1500).minimum, highestBid + 1);
    assert.deepStrictEqual(auctionRaiseOptions(highestBid, 5000), [highestBid + 1, highestBid + 20, highestBid + 100]);
    assert.strictEqual(defaultAuctionRaise(highestBid, 5000), highestBid + 20);
    assert.strictEqual(defaultAuctionRaise(highestBid, highestBid + 5), highestBid + 1, 'only the +1 fits in a tight budget');
  }
  assert.strictEqual(isAuctionRaise(100, 110), false, 'a +10 raise is not a button');
});

check('auction participant filter keeps non-leading participants eligible to reconsider', () => {
  const auction = { participants: ['b1', 'b2', 'h1'], highestBidderId: 'h1' };
  assert.strictEqual(isAuctionBotParticipant(auction, { id: 'b1', isBot: true }), true);
  assert.strictEqual(isAuctionBotParticipant(auction, { id: 'b2', isBot: true }), true);
  assert.strictEqual(isAuctionBotParticipant(auction, { id: 'h1' }), false);
  assert.strictEqual(isAuctionBotParticipant(auction, { id: 'b9', isBot: true }), false);
  assert.strictEqual(isAuctionBotParticipant({ ...auction, participants: ['b1', 'b3'], highestBidderId: 'z' }, { id: 'b3', isBot: true, bankrupt: true }), false);
});

check('purchase requires price plus 120 reserve', () => {
  assert.strictEqual(shouldBuyProperty({ cash: 320 }, { price: 200 }), true);
  assert.strictEqual(shouldBuyProperty({ cash: 319 }, { price: 200 }), false);
  assert.strictEqual(shouldBuyProperty({ cash: 120 }, undefined), false);
  assert.strictEqual(shouldBuyProperty({ cash: 10_000 }, { price: undefined }), true);
});

function fakeRoom(log) {
  return {
    roomCode: 'TEST',
    game: {
      settings: { rulesProfile: 'advanced', playerFinance: true },
      roundNumber: 3,
      getTile: price,
    getPlayerById: id => (id === 'lender' ? { bankrupt: false, disconnected: false, cash: 1000 } : null),
      getCurrentPlayer: () => ({ id: 'b1', isBot: true }),
      getBotCandidates: () => []
    },
    runBotAction: (id, fn) => {
      const result = fn({ id });
      log.push(result && result.name);
      return result;
    },
    voteGlobalEvent: (actor, policyId) => ({ name: 'vote:' + policyId }),
    respondToTrade: (actor, payload) => ({ name: 'respondTrade:' + payload.accept }),
    respondPlayerContract: (actor, accept) => ({ name: 'respondContract:' + accept }),
    counterPlayerContract: () => ({ name: 'counterContract', success: true }),
    declareBankruptcy: () => ({ name: 'bankrupt' }),
    endTurn: () => ({ name: 'endTurn' }),
    rollDice: () => ({ name: 'roll' }),
    proposeTrade: () => ({ name: 'propose', success: true }),
    cancelTrade: () => ({ name: 'cancel', success: true }),
    counterTrade: () => ({ name: 'counter', success: true }),
    tradeMarket: (actor, instrumentId, side, quantity) => ({ name: `market:${instrumentId}:${side}:${quantity}` }),
    placeCasinoBet: (actor, color, stake) => ({ name: `casino:${color}:${stake}` }),
    manageProperty: (actor, payload) => ({ name: `manage:${payload.action}:${payload.tileIndex}` }),
    takeBankLoan: () => ({ name: 'loan' }),
    repayBankLoan: () => ({ name: 'bank-repay', success: true }),
    payJailFine: () => ({ name: 'jail-fine', success: true }),
    useJailFree: () => ({ name: 'jail-free', success: true }),
    proposePlayerContract: () => ({ name: 'contract-propose', success: true }),
    purchaseProperty: (actor, index) => ({ name: `buy:${index}` }),
    declineProperty: (actor, index) => ({ name: `decline:${index}` })
  };
}

const advisorStub = decision => ({ chooseAction: async () => decision });
const bot1 = { id: 'b1', isBot: true, cash: 1000 };

check('runBotTurn executes the classified phase against the room', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.pendingPayment = { playerId: 'b1' };
  const result = await runBotTurn(room, bot1, advisorStub(null));
  assert.strictEqual(result.name, 'bankrupt');
});

check('table-talk candidate always advances the bot phase', async () => {
  const room = fakeRoom([]);
  room.game.getBotCandidates = () => [
    { id: 'chat:table-talk', kind: 'chat', text: 'Nice move.', score: 1 },
    { id: 'roll', kind: 'roll', score: 0 }
  ];
  room.rollDice = () => ({ name: 'rolled-after-chat', success: true });
  const result = await runBotTurn(room, bot1, advisorStub({ actionId: 'chat:table-talk' }));
  assert.equal(result.name, 'rolled-after-chat');
  assert.equal(result.botChat, 'Nice move.');
});

check('post-roll table-talk closes the finance window instead of stalling', async () => {
  const room = fakeRoom([]);
  room.game.hasRolled = true;
  room.game.awaitingEndTurn = true;
  room.game.getBotCandidates = () => [
    { id: 'chat:table-talk', kind: 'chat', text: 'Nice move.', score: 1 },
    { id: 'end-turn', kind: 'end-turn', score: -50 }
  ];
  const result = await runBotTurn(room, bot1, advisorStub({ actionId: 'chat:table-talk' }));
  assert.equal(result.name, 'endTurn');
  assert.equal(result.botChat, 'Nice move.');
});

check('sponsorship target selects an eligible bot contributor, then the buyer', () => {
  const buyer = { id: 'buyer', isBot: true, cash: 20 };
  const sponsor = { id: 'sponsor', isBot: true, cash: 600, bankrupt: false, disconnected: false };
  const game = fakeGame({
    current: buyer,
    players: [buyer, sponsor],
    getTile: () => ({ index: 4, price: 200 }),
    pendingSponsoredPurchase: { buyerId: 'buyer', tileIndex: 4, price: 200, contributions: [] }
  });
  assert.strictEqual(selectBotTurnTarget(game), sponsor);
  game.pendingSponsoredPurchase.contributions.push({ sponsorId: 'sponsor', amount: 180 });
  assert.strictEqual(selectBotTurnTarget(game), buyer);
});

check('sponsorship contribution keeps a deterministic cash reserve', () => {
  const sponsor = { id: 'sponsor', isBot: true, cash: 500 };
  const game = fakeGame({
    players: [sponsor, { id: 'buyer', cash: 100 }],
    getTile: () => ({ price: 400 }),
    pendingSponsoredPurchase: { buyerId: 'buyer', tileIndex: 4, price: 400, buyerCash: 20, contributions: [] }
  });
  assert.strictEqual(sponsorshipContributionAmount(game, sponsor), 300);
  game.pendingSponsoredPurchase.contributions.push({ sponsorId: 'other', amount: 100 });
  assert.strictEqual(sponsorshipContributionAmount(game, sponsor), 200);
  game.pendingSponsoredPurchase.contributions.push({ sponsorId: 'sponsor', amount: 1 });
  assert.strictEqual(sponsorshipContributionAmount(game, sponsor), 0);
});

check('contract response ownership alternates after a counter', () => {
  const bot = { id: 'b1', isBot: true, bankrupt: false, disconnected: false };
  const game = fakeGame({
    current: { id: 'human' },
    players: [bot],
    pendingPlayerContract: { fromPlayerId: 'b1', toPlayerId: 'human', counterDepth: 1 }
  });
  assert.strictEqual(selectBotTurnTarget(game).id, 'b1');
  assert.strictEqual(classifyBotTurnPhase(game, bot), 'contract');
});

check('AI advisor ranks an event vote through legal choice candidates', async () => {
  const room = fakeRoom([]);
  room.game.globalEvent = { phase: 'voting', choices: [{ id: 'low-tax', label: 'LOW TAX' }, { id: 'bank-first', label: 'BANK FIRST' }], votes: {} };
  const advisor = { supportsChoicePhases: true, chooseAction: async () => ({ actionId: 'vote:bank-first', provider: 'ai', fallback: false }) };
  const result = await runBotTurn(room, bot1, advisor);
  assert.strictEqual(result.name, 'vote:bank-first');
  assert.strictEqual(result.botDecision.provider, 'ai');
  assert.deepEqual(result.botDecision.candidateIds, ['vote:low-tax', 'vote:bank-first']);
});

check('vote aborts when the global event is replaced while the advisor thinks', async () => {
  const room = fakeRoom([]);
  const original = { id: 'event-old', phase: 'voting', choices: [{ id: 'low-tax', label: 'LOW TAX' }, { id: 'bank-first', label: 'BANK FIRST' }], votes: {} };
  room.game.globalEvent = original;
  room.game.players = [bot1];
  const advisor = { supportsChoicePhases: true, chooseAction: async () => {
    room.game.globalEvent = { ...original, id: 'event-new', votes: {} };
    return { actionId: 'vote:bank-first', provider: 'ai', fallback: false };
  } };
  const result = await runBotTurn(room, bot1, advisor);
  assert.equal(result.noEmit, true);
  assert.equal(result.botDecision.reasonCode, 'vote-event-changed');
  assert.equal(room.game.getCurrentPlayer().id, bot1.id);
  assert.equal(room.game.globalEvent.id, 'event-new');
});

check('vote aborts when event options change in place but selected option remains', async () => {
  const room = fakeRoom([]);
  room.game.globalEvent = { id: 'event-options', phase: 'voting', choices: [{ id: 'low-tax', label: 'LOW TAX' }, { id: 'bank-first', label: 'BANK FIRST' }], votes: {} };
  room.game.players = [bot1];
  const advisor = { supportsChoicePhases: true, chooseAction: async () => {
    room.game.globalEvent.choices = [{ id: 'bank-first', label: 'BANK FIRST' }, { id: 'public-works', label: 'PUBLIC WORKS' }];
    return { actionId: 'vote:bank-first', provider: 'ai', fallback: false };
  } };
  const result = await runBotTurn(room, bot1, advisor);
  assert.equal(result.noEmit, true);
  assert.equal(result.botDecision.reasonCode, 'vote-event-changed');
});

check('unchanged vote event executes the selected current option', async () => {
  const room = fakeRoom([]);
  room.game.globalEvent = { id: 'event-stable', phase: 'voting', choices: [{ id: 'low-tax', label: 'LOW TAX' }, { id: 'bank-first', label: 'BANK FIRST' }], votes: {} };
  room.game.players = [bot1];
  const advisor = { supportsChoicePhases: true, chooseAction: async () => ({ actionId: 'vote:bank-first', provider: 'ai', fallback: false }) };
  const result = await runBotTurn(room, bot1, advisor);
  assert.equal(result.name, 'vote:bank-first');
  assert.equal(result.botDecision.actionId, 'vote:bank-first');
});

function sponsorshipFixture() {
  const room = fakeRoom([]);
  const bot = { ...bot1, cash: 1000 };
  const buyer = { id: 'buyer', cash: 100, isBot: false };
  const tile = { index: 4, price: 400 };
  let contributionsExecuted = 0;
  room.game.players = [bot, buyer];
  room.game.getCurrentPlayer = () => bot;
  room.game.getPlayerById = id => id === bot.id ? bot : id === buyer.id ? buyer : null;
  room.game.getTile = index => Number(index) === tile.index ? tile : null;
  room.game.pendingSponsoredPurchase = {
    id: 'sponsorship-original', buyerId: buyer.id, tileIndex: tile.index, price: tile.price,
    buyerCash: buyer.cash, contributions: [], createdAt: 3, createdRound: room.game.roundNumber
  };
  room.game.contributeToSponsoredPurchase = (_actor, payload) => {
    contributionsExecuted += 1;
    return { name: `contributed:${payload.amount}`, success: true };
  };
  return { room, bot, buyer, tile, contributionsExecuted: () => contributionsExecuted };
}

for (const mutation of [
  ['request replacement', state => { state.room.game.pendingSponsoredPurchase = { ...state.room.game.pendingSponsoredPurchase, id: 'sponsorship-replacement' }; }],
  ['contribution terms', state => { state.room.game.pendingSponsoredPurchase.contributions.push({ sponsorId: 'other-sponsor', amount: 100 }); }],
  ['request clearing', state => { state.room.game.pendingSponsoredPurchase = null; }]
]) {
  check(`sponsorship aborts after ${mutation[0]} while bot seat remains`, async () => {
    const state = sponsorshipFixture();
    const advisor = { supportsChoicePhases: true, chooseAction: async () => {
      mutation[1](state);
      return { actionId: 'sponsorship:contribute', provider: 'ai', fallback: false };
    } };
    const result = await runBotTurn(state.room, state.bot, advisor);
    assert.equal(result.noEmit, true);
    assert.equal(result.botDecision.reasonCode, 'sponsorship-changed');
    assert.equal(state.room.game.getCurrentPlayer().id, state.bot.id);
    assert.equal(state.contributionsExecuted(), 0);
  });
}

check('unchanged sponsorship request executes the current legal contribution', async () => {
  const state = sponsorshipFixture();
  const advisor = { supportsChoicePhases: true, chooseAction: async () => ({ actionId: 'sponsorship:contribute', provider: 'ai', fallback: false }) };
  const result = await runBotTurn(state.room, state.bot, advisor);
  assert.equal(result.name, 'contributed:300');
  assert.equal(state.contributionsExecuted(), 1);
});

check('AI advisor ranks a trade response without leaving the room seam', async () => {
  const room = fakeRoom([]);
  room.game.pendingTrade = { id: 'trade-1', toPlayerId: 'b1', fromPlayerId: 'lender', giveCash: 200, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [] };
  const advisor = { supportsChoicePhases: true, chooseAction: async () => ({ actionId: 'trade:decline', provider: 'ai', fallback: false }) };
  const result = await runBotTurn(room, bot1, advisor);
  assert.strictEqual(result.name, 'respondTrade:false');
  assert.strictEqual(result.botDecision.actionId, 'trade:decline');
});

check('legacy supportsChoicePhases adapters still route choice phases', async () => {
  const room = fakeRoom([]);
  room.game.pendingTrade = { id: 'legacy-trade', toPlayerId: 'b1', fromPlayerId: 'lender', giveCash: 200, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [] };
  let called = false;
  const legacyAdvisor = {
    supportsChoicePhases: true,
    chooseAction: async context => {
      called = context.phase === 'trade';
      return { actionId: 'trade:decline', provider: 'ai', fallback: false };
    }
  };
  const result = await runBotTurn(room, bot1, legacyAdvisor);
  assert.equal(called, true);
  assert.equal(result.name, 'respondTrade:false');
});

check('NO-AI trade capability enables local choice routing', async () => {
  const room = fakeRoom([]);
  room.game.settings = { rulesProfile: 'advanced', playerFinance: true, botBrain: 'no-ai', botDifficulty: 'table' };
  room.game.pendingTrade = { id: 'local-trade', toPlayerId: 'b1', fromPlayerId: 'lender', giveCash: 250, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [7], counterDepth: 0 };
  const result = await runBotTurn(room, { ...bot1, properties: [7] }, new DeterministicAdvisor());
  // A near-miss offer is now answered with a premium counter instead of a flat decline.
  assert.equal(result.name, 'counter');
  assert.equal(result.botDecision.phase, 'trade');
  assert.equal(result.botDecision.provider, 'deterministic');
});

check('NO-AI contract capability uses the same-phase candidate set', async () => {
  const room = fakeRoom([]);
  room.game.settings = { rulesProfile: 'advanced', playerFinance: true, botBrain: 'no-ai' };
  room.game.pendingPlayerContract = { rulesVersion: 2, id: 'local-contract', toPlayerId: 'b1', fromPlayerId: 'lender', kind: 'loan', amount: 100, premiumRate: 0, durationRounds: 3, totalDue: 100, counterDepth: 0 };
  const result = await runBotTurn(room, { ...bot1, cash: 1000 }, new DeterministicAdvisor());
  assert.deepEqual(result.botDecision.candidateIds, ['contract:accept', 'contract:counter', 'contract:decline']);
  assert.equal(result.botDecision.phase, 'contract');
  assert.equal(result.botDecision.actionId, 'contract:accept');
});

check('NO-AI payment capability routes the selected rescue candidate', async () => {
  const room = fakeRoom([]);
  room.game.settings = { rulesProfile: 'advanced', playerFinance: true, botBrain: 'no-ai' };
  room.game.pendingPayment = { playerId: 'b1', amountRemaining: 100 };
  const result = await runBotTurn(room, bot1, new DeterministicAdvisor());
  assert.equal(result.name, 'bankrupt');
  assert.deepEqual(result.botDecision.candidateIds, ['debt:bankruptcy']);
  assert.equal(result.botDecision.actionId, 'debt:bankruptcy');
});

check('NO-AI vote and sponsorship remain on fixed executors', async () => {
  const voterRoom = fakeRoom([]);
  voterRoom.game.settings = { botBrain: 'no-ai' };
  voterRoom.game.globalEvent = { phase: 'voting', choices: [{ id: 'low-tax' }, { id: 'public-works' }], votes: {} };
  const vote = await runBotTurn(voterRoom, bot1, new DeterministicAdvisor());
  assert.equal(vote.name, 'vote:low-tax');
  assert.deepEqual(vote.botDecision.candidateIds, []);

  const sponsorRoom = fakeRoom([]);
  sponsorRoom.game.settings = { rulesProfile: 'advanced', playerFinance: true, botBrain: 'no-ai' };
  sponsorRoom.game.players = [bot1];
  sponsorRoom.game.pendingSponsoredPurchase = { buyerId: 'buyer', tileIndex: 1, price: 100, buyerCash: 0, contributions: [] };
  sponsorRoom.game.contributeToSponsoredPurchase = () => ({ name: 'contributed', success: true });
  const sponsorship = await runBotTurn(sponsorRoom, bot1, new DeterministicAdvisor());
  assert.equal(sponsorship.name, 'contributed');
  assert.deepEqual(sponsorship.botDecision.candidateIds, []);
});

check('local NO-AI payment skips AI-only table brain construction', async () => {
  const room = fakeRoom([]);
  room.game.settings = { rulesProfile: 'advanced', playerFinance: true, botBrain: 'no-ai' };
  room.game.pendingPayment = { playerId: 'b1', amountRemaining: 100 };
  room.game.players = [];
  room.game.tiles = [{ index: 1, type: 'property', group: 'Brown', ownerId: 'b1', price: 60, rent: 10, houseCount: 0 }];
  room.game.getTile = index => room.game.tiles.find(tile => tile.index === index) || null;
  Object.defineProperty(room.game, 'getGroupTiles', {
    get() { throw new Error('AI-only table brain must not be constructed for local phases'); }
  });
  const result = await runBotTurn(room, bot1, new DeterministicAdvisor());
  assert.ok(result && typeof result === 'object');
  assert.equal(result.botDecision.phase, 'payment');
});

check('AI advisor abandons a trade decision when the offer changes mid-thought', async () => {
  const room = fakeRoom([]);
  room.game.pendingTrade = { id: 'trade-old', toPlayerId: 'b1', fromPlayerId: 'lender', giveCash: 200, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [] };
  const advisor = { supportsChoicePhases: true, chooseAction: async () => {
    room.game.pendingTrade = { id: 'trade-new', toPlayerId: 'b1', fromPlayerId: 'other', giveCash: 1, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [] };
    return { actionId: 'trade:accept', provider: 'ai', fallback: false };
  } };
  const result = await runBotTurn(room, bot1, advisor);
  assert.equal(result.noEmit, true);
  assert.equal(result.botDecision.reasonCode, 'offer-changed');
  assert.equal(room.game.pendingTrade.id, 'trade-new');
});

check('choice revalidation rejects same-id trade moved to another responding seat', async () => {
  const room = fakeRoom([]);
  room.game.pendingTrade = { id: 'trade-same-id', toPlayerId: 'b1', fromPlayerId: 'lender', giveCash: 200, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [] };
  const advisor = {
    supportsChoicePhases: true,
    chooseAction: async () => {
      room.game.pendingTrade.toPlayerId = 'another-seat';
      return { actionId: 'trade:accept', provider: 'ai', fallback: false };
    }
  };
  const result = await runBotTurn(room, bot1, advisor);
  assert.equal(result.noEmit, true);
  assert.equal(result.botDecision.reasonCode, 'offer-changed');
});

check('choice revalidation rejects same-id contract counter reassigned to another responder', async () => {
  const room = fakeRoom([]);
  room.game.pendingPlayerContract = { rulesVersion: 2, id: 'contract-same-id', toPlayerId: 'b1', fromPlayerId: 'lender', kind: 'loan', amount: 200, premiumRate: 30, durationRounds: 3, counterDepth: 0 };
  const advisor = {
    supportsChoicePhases: true,
    chooseAction: async () => {
      room.game.pendingPlayerContract.counterDepth = 1;
      return { actionId: 'contract:accept', provider: 'ai', fallback: false };
    }
  };
  const result = await runBotTurn(room, bot1, advisor);
  assert.equal(result.noEmit, true);
  assert.equal(result.botDecision.reasonCode, 'offer-changed');
});

check('AI advisor can counter a close trade with a bounded premium', async () => {
  const room = fakeRoom([]);
  room.game.pendingTrade = { id: 'trade-2', toPlayerId: 'b1', fromPlayerId: 'lender', giveCash: 100, requestCash: 20, givePropertyIndexes: [5], requestPropertyIndexes: [], counterDepth: 0 };
  const advisor = { supportsChoicePhases: true, chooseAction: async context => {
    assert.deepEqual(context.candidates.map(candidate => candidate.id), ['trade:accept', 'trade:counter', 'trade:decline']);
    assert.equal(context.candidates[1].offer.requestCash, 110);
    return { actionId: 'trade:counter', provider: 'ai', fallback: false };
  } };
  const result = await runBotTurn(room, bot1, advisor);
  assert.strictEqual(result.name, 'counter');
  assert.strictEqual(result.botDecision.actionId, 'trade:counter');
});

check('AI advisor can counter a player contract with safer terms', async () => {
  const room = fakeRoom([]);
  room.game.pendingPlayerContract = { rulesVersion: 2, id: 'contract-2', toPlayerId: 'b1', fromPlayerId: 'lender', kind: 'loan', amount: 200, premiumRate: 30, durationRounds: 3, collateralTileIndex: null };
  const funded = { ...bot1, cash: 1000 };
  const advisor = { supportsChoicePhases: true, chooseAction: async context => {
    // A 30% loan is outside the borrower gate, so 'accept' is not an option at all;
    // the counter asks for the interest-free, longer-term loan the bot would sign.
    assert.deepEqual(context.candidates.map(candidate => candidate.id), ['contract:counter', 'contract:decline']);
    assert.equal(context.candidates[0].offer.premiumRate, 0);
    assert.equal(context.candidates[0].offer.durationRounds, 4);
    return { actionId: 'contract:counter', provider: 'ai', fallback: false };
  } };
  const result = await runBotTurn(room, funded, advisor);
  assert.strictEqual(result.name, 'counterContract');
  assert.strictEqual(result.botDecision.actionId, 'contract:counter');
});

check('AI advisor abandons a contract decision when the offer changes mid-thought', async () => {
  const room = fakeRoom([]);
  room.game.pendingPlayerContract = { rulesVersion: 2, id: 'contract-old', toPlayerId: 'b1', fromPlayerId: 'lender', kind: 'loan', amount: 200, premiumRate: 30, durationRounds: 3, collateralTileIndex: null };
  const advisor = { supportsChoicePhases: true, chooseAction: async () => {
    room.game.pendingPlayerContract = { rulesVersion: 2, id: 'contract-new', toPlayerId: 'b1', fromPlayerId: 'other', kind: 'loan', amount: 1, premiumRate: 0, durationRounds: 1, collateralTileIndex: null };
    return { actionId: 'contract:accept', provider: 'ai', fallback: false };
  } };
  const result = await runBotTurn(room, bot1, advisor);
  assert.equal(result.noEmit, true);
  assert.equal(result.botDecision.reasonCode, 'offer-changed');
  assert.equal(room.game.pendingPlayerContract.id, 'contract-new');
});

check('AI advisor can choose a legal debt rescue path', async () => {
  const room = fakeRoom([]);
  room.game.pendingPayment = { playerId: 'b1', amountRemaining: 220 };
  room.game.tiles = [];
  room.game.currentPlayerId = 'b1';
  room.game.getBankLoanOffer = () => ({ available: true, totalDue: 450, principal: 300 });
  const advisor = { supportsChoicePhases: true, chooseAction: async context => {
    assert.deepEqual(context.candidates.map(candidate => candidate.id), ['debt:loan', 'debt:bankruptcy']);
    return { actionId: 'debt:loan', provider: 'ai', fallback: false };
  } };
  const result = await runBotTurn(room, bot1, advisor);
  assert.strictEqual(result.name, 'loan');
  assert.strictEqual(result.botDecision.actionId, 'debt:loan');
});

check('payment choice aborts after obligation clears while advisor is thinking', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.players = [bot1];
  room.game.pendingPayment = { playerId: bot1.id, creditorId: 'h1', amountRemaining: 500, reason: 'rent' };
  room.game.currentPlayerId = bot1.id;
  room.game.getBankLoanOffer = () => ({ available: false });
  let bankruptcies = 0;
  room.declareBankruptcy = () => { bankruptcies += 1; return { name: 'bankrupt' }; };
  const advisor = {
    supportsChoicePhases: true,
    chooseAction: async () => {
      room.game.pendingPayment = null;
      return { actionId: 'debt:bankruptcy', provider: 'ai', fallback: false };
    }
  };

  const result = await runBotTurn(room, bot1, advisor);
  assert.equal(result.noEmit, true);
  assert.equal(result.botDecision.reasonCode, 'payment-changed');
  assert.equal(bankruptcies, 0);
  assert.deepEqual(log, []);
});

check('payment choice aborts after obligation identity changes while seat remains', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.players = [bot1];
  room.game.pendingPayment = { playerId: bot1.id, creditorId: 'h1', amountRemaining: 500, reason: 'rent' };
  room.game.currentPlayerId = bot1.id;
  room.game.getBankLoanOffer = () => ({ available: false });
  let bankruptcies = 0;
  room.declareBankruptcy = () => { bankruptcies += 1; return { name: 'bankrupt' }; };
  const advisor = {
    supportsChoicePhases: true,
    chooseAction: async () => {
      room.game.pendingPayment = { playerId: bot1.id, creditorId: 'h2', amountRemaining: 450, reason: 'contract' };
      return { actionId: 'debt:bankruptcy', provider: 'ai', fallback: false };
    }
  };

  const result = await runBotTurn(room, bot1, advisor);
  assert.equal(result.noEmit, true);
  assert.equal(result.botDecision.reasonCode, 'payment-changed');
  assert.equal(bankruptcies, 0);
  assert.deepEqual(log, []);
});

check('unchanged payment obligation executes the selected legal rescue', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.players = [bot1];
  const obligation = { playerId: bot1.id, creditorId: 'h1', amountRemaining: 220, reason: 'rent' };
  room.game.pendingPayment = obligation;
  room.game.currentPlayerId = bot1.id;
  room.game.getBankLoanOffer = () => ({ available: true, totalDue: 450, principal: 300 });
  const advisor = {
    supportsChoicePhases: true,
    chooseAction: async () => ({ actionId: 'debt:loan', provider: 'ai', fallback: false })
  };

  const result = await runBotTurn(room, bot1, advisor);
  assert.equal(result.name, 'loan');
  assert.equal(result.botDecision.actionId, 'debt:loan');
  assert.strictEqual(room.game.pendingPayment, obligation);
  assert.deepEqual(log, ['loan']);
});

check('payment phase sells a legal building before declaring bankruptcy', async () => {
  const log = [];
  const room = fakeRoom(log);
  const bot = { ...bot1, properties: [5], cash: 0 };
  const tile = { index: 5, houseCount: 1, rent: 50 };
  room.game.pendingPayment = { playerId: bot.id, amountRemaining: 80 };
  room.game.getTile = () => tile;
  room.game.canSellFromTile = () => true;
  room.game.getPropertyHouseCost = () => 100;
  room.game.buildingSaleMultiplier = () => 0.5;
  const result = await runBotTurn(room, bot, advisorStub(null));
  assert.strictEqual(result.name, 'manage:sell-house:5');
  assert.strictEqual(result.botDecision.actionId, 'sell:5');
  assert.strictEqual(result.botDecision.fallbackReason, 'debt-liquidation');
});

check('bot deal proposals are capped before the bot rolls', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({
    socketId: 'deal-cap-host',
    clientId: 'deal-cap-host',
    nickname: 'DEAL CAP HOST',
    rulesProfile: 'advanced',
    color: '#d74438',
    isBot: true
  });
  room.setRoomSetting('startingCash', 500);
  room.setRoomSetting('bots', 2);
  assert.equal(room.startGame().success, true);
  const lender = room.game.getCurrentPlayer();
  const receiver = room.game.players.find(player => player.id !== lender.id);
  // Bots refuse priced loans, so the deal on offer is an equity leg on a deed the receiver owns.
  room.game.tiles[1].ownerId = receiver.id;
  receiver.properties.push(1);
  const [candidate] = room.game.botContractCandidates(lender);
  assert.ok(candidate, 'the setup should expose one legal contract candidate');
  const proposed = room.runBotAction(lender.id, actor => room.proposePlayerContract(actor, candidate.offer));
  assert.equal(proposed.success, true);
  const declined = room.runBotAction(receiver.id, actor => room.respondPlayerContract(actor, false, null, proposed.contract.id));
  assert.equal(declined.success, true);
  assert.deepEqual(room.game.botContractCandidates(lender), [], 'a bot must roll after its one deal window');
});

check('AI fallback can declare bankruptcy when no legal rescue remains', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.players = [bot1];
  room.game.pendingPayment = { playerId: bot1.id, amountRemaining: 500 };
  room.game.currentPlayerId = bot1.id;
  room.game.getBankLoanOffer = () => ({ available: false });
  const advisor = {
    supportsChoicePhases: true,
    chooseAction: async context => {
      assert.deepEqual(context.candidates.map(candidate => candidate.id), ['debt:bankruptcy']);
      return { actionId: 'debt:bankruptcy', provider: 'deterministic', effectiveBrain: 'no-ai', fallback: true, fallbackReason: 'quota-exhausted' };
    }
  };
  const result = await runBotTurn(room, bot1, advisor);
  assert.strictEqual(result.name, 'bankrupt');
  assert.strictEqual(result.botDecision.actionId, 'debt:bankruptcy');
  assert.strictEqual(result.botDecision.effectiveBrain, 'no-ai');
});

check('runBotTurn resolves post-roll purchase offers at most twice', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.hasRolled = true;
  room.game.pendingPurchaseOffer = { playerId: 'b1', tileIndex: 5 };
  room.game.getBotCandidates = () => [{ id: 'purchase:5', kind: 'purchase', tileIndex: 5, score: 26 }];
  const result = await runBotTurn(room, bot1, advisorStub(null));
  assert.strictEqual(result.name, 'buy:5');
});

check('post-roll bot pass exposes finance actions and an explicit end turn', () => {
  const room = fakeRoom([]);
  room.game.hasRolled = true;
  room.game.awaitingEndTurn = true;
  room.game.getBotCandidates = () => [
    { id: 'market:ACME', kind: 'market', instrumentId: 'ACME', side: 'sell', quantity: 1, score: 15 },
    { id: 'end-turn', kind: 'end-turn', score: -50 }
  ];
  assert.strictEqual(classifyBotTurnPhase(room.game, bot1), 'post-roll');
});

check('post-roll trade proposals do not attempt a second dice roll', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.hasRolled = true;
  room.game.getBotCandidates = () => [{ id: 'trade:human', kind: 'trade', toPlayerId: 'human', score: 10 }];
  let rolls = 0;
  room.proposeTrade = () => ({ name: 'propose', success: true });
  room.rollDice = () => { rolls += 1; return { name: 'rolled', success: true }; };
  const result = await runBotTurn(room, bot1, advisorStub({ actionId: 'trade:human' }));
  assert.strictEqual(result.name, 'propose');
  assert.strictEqual(rolls, 0);
});

check('bot cancellation sends the exact pending trade id', async () => {
  const room = fakeRoom([]);
  room.game.hasRolled = true;
  room.game.awaitingEndTurn = true;
  room.game.getBotCandidates = () => [{ id: 'cancel-trade:t1', kind: 'cancel-trade', tradeId: 't1', score: 4 }];
  room.game.pendingTrade = { id: 't1', fromPlayerId: bot1.id, toPlayerId: 'human' };
  let canceledWith = null;
  room.cancelTrade = (_actor, payload) => { canceledWith = payload.tradeId; return { success: true, canceled: true }; };
  const result = await runBotTurn(room, bot1, advisorStub({ actionId: 'cancel-trade:t1' }));
  assert.equal(result.success, true);
  assert.equal(canceledWith, 't1');
});

check('stale bot cancellation does not revoke a replacement trade', async () => {
  const room = fakeRoom([]);
  room.game.hasRolled = true;
  room.game.awaitingEndTurn = true;
  room.game.pendingTrade = { id: 't-old', fromPlayerId: bot1.id, toPlayerId: 'human', createdRound: 1, counterDepth: 0 };
  room.game.getPlayerById = id => id === 'human' ? { id, bankrupt: false, disconnected: false } : null;
  room.game.getBotCandidates = () => [{
    id: `cancel-trade:${room.game.pendingTrade.id}`,
    kind: 'cancel-trade',
    tradeId: room.game.pendingTrade.id,
    score: 4
  }];
  let cancelCalls = 0;
  room.cancelTrade = () => { cancelCalls += 1; return { success: true, canceled: true }; };
  const advisor = {
    chooseAction: async () => {
      room.game.pendingTrade = { id: 't-new', fromPlayerId: bot1.id, toPlayerId: 'human', createdRound: 1, counterDepth: 0 };
      return { actionId: 'cancel-trade:t-old', provider: 'ai', fallback: false };
    }
  };
  const result = await runBotTurn(room, bot1, advisor);
  assert.equal(result.noEmit, true);
  assert.equal(room.game.pendingTrade.id, 't-new');
  assert.equal(cancelCalls, 0);
});

check('runBotTurn runs advisor candidates through the action map', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.hasRolled = false;
  room.game.getBotCandidates = () => [{ id: 'c1', kind: 'market', instrumentId: 'ACME', side: 'buy', quantity: 2 }];
  const result = await runBotTurn(room, bot1, advisorStub({ actionId: 'c1' }));
  assert.strictEqual(result.name, 'market:ACME:buy:2');
});

check('runBotTurn remaps only candidates that remain live after advisor await', async () => {
  const room = fakeRoom([]);
  let candidateRead = 0;
  room.game.getBotCandidates = () => {
    candidateRead += 1;
    return candidateRead === 1
      ? [{ id: 'market:stale', kind: 'market', instrumentId: 'ACME', side: 'buy', quantity: 2 }]
      : [{ id: 'market:fresh', kind: 'market', instrumentId: 'ACME', side: 'buy', quantity: 5 }];
  };
  const result = await runBotTurn(room, bot1, advisorStub({ actionId: 'market:stale', provider: 'ai', fallback: false }));
  assert.equal(candidateRead, 2);
  assert.equal(result.name, 'market:ACME:buy:5');
  assert.equal(result.botDecision.reasonCode, 'stale-candidate');
  assert.equal(result.botDecision.fallbackReason, 'stale-candidate');
});

check('runBotTurn keeps evaluation-only shadow data outside persisted botDecision', async () => {
  const room = fakeRoom([]);
  room.game.getBotCandidates = () => [{ id: 'roll', kind: 'roll' }];
  const evaluationTrace = { actionKind: 'roll', deterministicActionKind: 'roll', agreement: true, phase: 'pre-roll' };
  const result = await runBotTurn(room, bot1, advisorStub({ actionId: 'roll', shadowEvaluation: evaluationTrace }));
  assert.equal(result.name, 'roll');
  assert.equal(result.botDecision.shadowEvaluation, undefined);
  assert.deepEqual(result.evaluationTrace, evaluationTrace);
});

check('runBotTurn forwards brain settings and returns replay metadata', async () => {
  const room = fakeRoom([]);
  let received = null;
  room.game.settings = { rulesProfile: 'advanced', playerFinance: true, botBrain: 'no-ai', botDifficulty: 'expert' };
  room.game.getBotCandidates = () => [{ id: 'c1', kind: 'market', instrumentId: 'ACME', side: 'buy', quantity: 1 }];
  const advisor = { chooseAction: async context => { received = context; return { actionId: 'c1' }; } };
  const result = await runBotTurn(room, bot1, advisor);
  assert.equal(received.botBrain, 'no-ai');
  assert.equal(received.botDifficulty, 'expert');
  assert.equal(result.botDecision.provider, 'deterministic');
  assert.equal(result.botDecision.fallback, true);
  assert.deepEqual(result.botDecision.candidateIds, ['c1']);
});

check('runBotTurn aborts when the seat changed while the advisor thought', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.getCurrentPlayer = () => ({ id: 'someone-else', isBot: true });
  const result = await runBotTurn(room, bot1, advisorStub({ actionId: 'x' }));
  assert.strictEqual(result.noEmit, true);
});

check('runBotTurn aborts when the bot is eliminated while the advisor thinks', async () => {
  const log = [];
  const room = fakeRoom(log);
  const bot = { ...bot1 };
  const advisor = { chooseAction: async () => {
    bot.bankrupt = true;
    return { actionId: 'roll' };
  } };
  const result = await runBotTurn(room, bot, advisor);
  assert.strictEqual(result.noEmit, true);
  assert.strictEqual(result.botDecision.reasonCode, 'seat-changed');
});

check('runBotTurn trade candidate rolls after a successful proposal', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.getBotCandidates = () => [{ id: 'c1', kind: 'trade' }];
  room.proposeTrade = () => ({ name: 'propose', success: true });
  room.rollDice = () => ({ name: 'rolled', success: true });
  const result = await runBotTurn(room, bot1, advisorStub({ actionId: 'c1' }));
  assert.strictEqual(result.name, 'rolled');
});

check('runBotTurn falls back to a legal roll after a rejected parity action', async () => {
  const room = fakeRoom([]);
  room.game.getBotCandidates = () => [{ id: 'bank-repay:1', kind: 'bank-repay', amount: 100, remaining: 100, loanCount: 1 }];
  room.repayBankLoan = () => ({ success: false, error: 'loan changed' });
  room.rollDice = () => ({ name: 'fallback-roll', success: true });
  const result = await runBotTurn(room, bot1, advisorStub(null));
  assert.strictEqual(result.name, 'fallback-roll');
  assert.strictEqual(result.botDecision.actionId, 'roll');
  assert.strictEqual(result.botDecision.fallbackReason, 'candidate-rejected');
});

check('resolvePurchaseOffer applies one offer or passes through', () => {
  const log = [];
  const room = fakeRoom(log);
  assert.strictEqual(resolvePurchaseOffer(room, bot1, null), null);
  assert.strictEqual(resolvePurchaseOffer(room, bot1, { name: 'plain' }).name, 'plain');
  const bought = resolvePurchaseOffer(room, bot1, { purchaseOffer: { tileIndex: 5 } });
  assert.strictEqual(bought.name, 'buy:5');
  const declined = resolvePurchaseOffer(room, { ...bot1, cash: 100 }, { purchaseOffer: { tileIndex: 5 } });
  assert.strictEqual(declined.name, 'decline:5');
});

check('monopoly veto declines an underpriced completer despite face-value win', () => {
  // Human H owns Brown-1 and offers $100 for the bot's Brown-3 (face 60): a
  // face-value win the old bar would accept, but it completes H's Brown monopoly
  // for less than the 2x monopoly premium (114). H's cash no longer matters.
  const tiles = {
    1: { index: 1, price: 60, group: 'Brown', ownerId: 'H' },
    3: { index: 3, price: 60, group: 'Brown', ownerId: 'BOT' },
    16: { index: 16, price: 180, group: 'Orange', ownerId: 'H' },
  };
  const game = cashH => ({
    getTile: index => tiles[index] || null,
    getGroupTiles: group => Object.values(tiles).filter(tile => tile.group === group),
    getPlayerById: id => ({ H: { id: 'H', cash: cashH }, BOT: { id: 'BOT', cash: 500 } })[id] || null,
    getPropertyHouseCost: tile => (tile?.group === 'Orange' ? 100 : 50),
  });
  const getTile = index => tiles[index];
  const giveaway = {
    fromPlayerId: 'H', toPlayerId: 'BOT',
    giveCash: 100, givePropertyIndexes: [],
    requestCash: 0, requestPropertyIndexes: [3],
  };
  assert.strictEqual(shouldAcceptTrade(giveaway, getTile), true);
  assert.strictEqual(shouldAcceptTrade(giveaway, getTile, game(1500)), false);
  // Audit finding 5: the veto no longer depends on the proposer's cash. H now
  // holds exactly the $100 it offers so the veto, not the cash preflight, is
  // what declines (an unfunded give leg is void in the engine; tested below).
  assert.strictEqual(shouldAcceptTrade(giveaway, getTile, game(100)), false);
  // Paying the premium (or handing back a deed worth it) lifts the veto.
  assert.strictEqual(shouldAcceptTrade({ ...giveaway, giveCash: 114 }, getTile, game(114)), true);
  // The engine voids an offer whose proposer cannot fund giveCash, so the bot
  // never signs one, however good the face value.
  assert.strictEqual(shouldAcceptTrade({ ...giveaway, giveCash: 114 }, getTile, game(113)), false);
  assert.strictEqual(shouldAcceptTrade({ ...giveaway, giveCash: 114 }, getTile, game(0)), false);
  assert.strictEqual(shouldAcceptTrade({ ...giveaway, giveCash: 0, givePropertyIndexes: [16] }, getTile, game(0)), true);
  // Fair swap with no completion on either side still accepts with context:
  // the bot hands over the deed it owns and takes H's equal-value deed.
  const fair = { ...giveaway, givePropertyIndexes: [1], requestPropertyIndexes: [3] };
  assert.strictEqual(shouldAcceptTrade(fair, getTile, game(1500)), true);
});

check('payment choice routes mortgage rescues to mortgage, not bankruptcy', () => {
  const calls = [];
  const room = {
    runBotAction: (id, fn) => {
      // Capture the requested property action without a live game.
      const actor = { id };
      void actor;
      calls.push(fn.toString());
      return { success: true };
    },
    manageProperty: () => ({ success: true }),
  };
  const game = { trySettlePendingPayment: () => { game.settled = true; } };
  const bot = { id: 'b1' };
  const result = runPaymentChoice(room, bot, game, { id: 'debt:mortgage:7' });
  assert.equal(result.success, true);
  assert.equal(game.settled, true);
  assert.ok(calls[0].includes('mortgage'));
});

check('debt mortgage ladder preserves income: lowest rent first', () => {
  const tiles = {
    1: { index: 1, price: 400, rent: 50, group: 'Dark Blue', ownerId: 'b1', houseCount: 0, mortgaged: false },
    3: { index: 3, price: 60, rent: 10, group: 'Brown', ownerId: 'b1', houseCount: 0, mortgaged: false },
  };
  const game = {
    getTile: index => tiles[index] || null,
    canMortgageTile: () => true,
    activeEventEffects: () => ({}),
    calculateRent: tile => tile.rent,
  };
  const bot = { id: 'b1', properties: [1, 3] };
  const order = debtMortgageCandidates(game, bot).map(entry => entry.tile.index);
  assert.deepEqual(order, [3, 1]);
});

check('teaming proposers pay a 1.5x acceptance bar', () => {
  const players = [
    { id: 'BOT', cash: 1000, bankrupt: false, disconnected: false },
    { id: 'H', cash: 1000, bankrupt: false, disconnected: false, lastVoteChoice: 'low-tax' },
    { id: 'C', cash: 1000, bankrupt: false, disconnected: false, lastVoteChoice: 'low-tax' },
  ];
  const game = {
    players,
    playerContracts: [{ status: 'active', fromPlayerId: 'H', toPlayerId: 'C' }],
    pendingTrade: null,
    pendingSponsoredPurchase: null,
    getTile: () => null,
    getGroupTiles: () => [],
    getPlayerById: id => players.find(player => player.id === id) || null,
  };
  const getTile = () => null;
  // Fair 400-for-400 clears the base bar but not the teaming bar.
  const teaming = { fromPlayerId: 'H', toPlayerId: 'BOT', giveCash: 400, givePropertyIndexes: [], requestCash: 400, requestPropertyIndexes: [] };
  assert.strictEqual(shouldAcceptTrade(teaming, getTile), true);
  assert.strictEqual(shouldAcceptTrade(teaming, getTile, game), false);
  // Overpaying 1.5x still clears it.
  assert.strictEqual(shouldAcceptTrade({ ...teaming, giveCash: 600 }, getTile, game), true);
});

check('near-miss rejections counter with premium instead of declining', async () => {
  // Hopeless offer declines outright.
  const hopeless = { id: 't0', fromPlayerId: 'h', toPlayerId: 'b1', giveCash: 100, givePropertyIndexes: [], requestCash: 400, requestPropertyIndexes: [], counterDepth: 0 };
  assert.strictEqual(nearMissTrade(hopeless, price), false);
  // Near-miss (250 vs 320 bar) counters through the deterministic executor.
  const near = { id: 't1', fromPlayerId: 'h', toPlayerId: 'b1', giveCash: 250, givePropertyIndexes: [], requestCash: 0, requestPropertyIndexes: [7], counterDepth: 0 };
  assert.strictEqual(nearMissTrade(near, price), true);
  const log = [];
  const room = fakeRoom(log);
  room.game.pendingTrade = near;
  const result = await runBotTurn(room, { ...bot1, properties: [7] }, advisorStub(null));
  assert.strictEqual(result.name, 'counter');
});

check('blocked-table counters fall back to decline instead of looping', async () => {
  // Exact regression: near-miss offer plus an open auction. Countering into a
  // blocked table would restore the identical offer forever, so the bot must
  // decline. (A parked debt is not a blocker any more: the engine keeps
  // debt-rescue deals legal, so it is the auction that holds the counter.)
  const log = [];
  const room = fakeRoom(log);
  room.game.pendingTrade = { id: 't-loop', fromPlayerId: 'h', toPlayerId: 'b1', giveCash: 250, givePropertyIndexes: [], requestCash: 0, requestPropertyIndexes: [7], counterDepth: 0 };
  room.game.auction = { active: true, participants: ['b1'], highestBidderId: null };
  const result = await runBotTurn(room, { ...bot1, properties: [7] }, advisorStub(null));
  assert.strictEqual(result.name, 'respondTrade:false');
});

check('stale own offers free the table before deciding', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.pendingTrade = { id: 't9', fromPlayerId: 'b1', toPlayerId: 'ghost', giveCash: 10, counterDepth: 0 };
  assert.strictEqual(pruneStaleOwnDeal(room, bot1, room.game), true);
  assert.strictEqual(log[0], 'cancel');
  const live = fakeRoom([]);
  live.game.pendingTrade = { id: 't8', fromPlayerId: 'b1', toPlayerId: 'lender', giveCash: 10, counterDepth: 0 };
  assert.strictEqual(pruneStaleOwnDeal(live, bot1, live.game), false);
});

check('equity gate prices the share at twice the traffic-adjusted deed value', () => {
  const tile = { index: 16, price: 180, group: 'Orange' };
  const game = { settings: { rulesProfile: 'advanced', playerFinance: true }, getTile: () => tile };
  const lender = { bankrupt: false };
  const trap = { rulesVersion: 2, durationRounds: 3, equityControl: 'passive', kind: 'equity', amount: 1, propertyIndex: 16, equityShare: 100 };
  assert.strictEqual(shouldAcceptPlayerContract(trap, { cash: 1000 }, lender, game), false);
  assert.strictEqual(shouldAcceptPlayerContract({ ...trap, amount: 350 }, { cash: 1000 }, lender, game), false, 'below 2 x 130% x $180 = $468');
  assert.strictEqual(shouldAcceptPlayerContract({ ...trap, amount: 468 }, { cash: 1000 }, lender, game), true, 'at the full price');
  assert.strictEqual(shouldAcceptPlayerContract({ ...trap, amount: 468, permanent: true }, { cash: 1000 }, lender, game), false, 'permanent slices are never sold');
});

check('trade acceptance prices the responders completed group before breaking it', () => {
  const tiles = {
    1: { index: 1, price: 60, group: 'A', ownerId: 'BOT' },
    2: { index: 2, price: 60, group: 'A', ownerId: 'BOT' },
    3: { index: 3, price: 60, group: 'B', ownerId: 'H' },
    4: { index: 4, price: 60, group: 'B', ownerId: null }
  };
  const bot = { id: 'BOT', cash: 1000, properties: [1, 2] };
  const game = {
    players: [bot, { id: 'H', cash: 1000 }],
    tiles: Object.values(tiles),
    getTile: index => tiles[index] || null,
    getGroupTiles: group => Object.values(tiles).filter(tile => tile.group === group),
    getPlayerById: id => id === 'BOT' ? bot : { id: 'H', cash: 1000 }
  };
  const trade = {
    fromPlayerId: 'H', toPlayerId: 'BOT',
    giveCash: 0, requestCash: 0,
    givePropertyIndexes: [3], requestPropertyIndexes: [1]
  };
  assert.equal(shouldAcceptTrade(trade, index => tiles[index]), true, 'face-value-only fallback treats the exchange as even');
  assert.equal(shouldAcceptTrade(trade, index => tiles[index], game), false, 'the portfolio evaluation rejects losing a complete group for an equal face-value deed');
});

check('sponsorship gates stop repeat farming without reciprocity', () => {
  const buyer = { id: 'buyer', cash: 100 };
  const base = {
    settings: { rulesProfile: 'advanced', playerFinance: true },
    players: [{ id: 'sponsor' }, buyer],
    getTile: () => ({ price: 400 }),
    getPlayerById: id => (id === 'buyer' ? buyer : null),
    roundNumber: 5,
    pendingSponsoredPurchase: { buyerId: 'buyer', tileIndex: 4, price: 400, buyerCash: 20, contributions: [] },
  };
  const fresh = { id: 'sponsor', isBot: true, cash: 500 };
  assert.strictEqual(sponsorshipContributionAmount(base, fresh), 300);
  assert.strictEqual(sponsorshipContributionAmount(base, { ...fresh, lastSponsorRound: 5 }), 0);
  assert.strictEqual(sponsorshipContributionAmount(base, { ...fresh, sponsorLedger: { buyer: 300 } }), 0);
  assert.strictEqual(
    sponsorshipContributionAmount(base, { ...fresh, sponsorLedger: { buyer: 300 }, sponsoredBy: { buyer: 50 } }),
    300
  );
});

check('auction cap stops bid-traps but stretches for completers', () => {
  const tiles = [
    { group: 'Brown', price: 60, ownerId: 'b1' },
    { group: 'Brown', price: 60, ownerId: null },
  ];
  const game = { getGroupTiles: group => tiles.filter(tile => tile.group === group) };
  const bot = { id: 'b1', cash: 5000 };
  // Bid-trap: pumped to 500 on a 60 deed with no completion -> pass.
  assert.deepEqual(
    auctionBidDecision({ highestBid: 500, propertyTile: { group: 'Brown', price: 60 } }, bot, 1500, game),
    { shouldBid: false, minimum: 501, maximum: 142 }
  );
  // A completer can bid above face value based on group completion.
  assert.deepEqual(
    auctionBidDecision({ highestBid: 50, propertyTile: { group: 'Brown', price: 60 } }, bot, 1500, game),
    { shouldBid: true, minimum: 51, maximum: 142 }
  );
  assert.deepEqual(auctionBidDecision({ highestBid: 100 }, { cash: 500 }, 1500).shouldBid, true);
});

check('live no-ai and AI auction choices wait above the deed valuation ceiling', async () => {
  const tile = { group: 'Brown', price: 200, ownerId: null };
  const game = { getGroupTiles: () => [tile, { group: 'Brown', price: 200, ownerId: 'human' }] };
  const bot = { id: 'auction-cap-bot', cash: 2_000 };
  const auction = { highestBid: 1_300, propertyTile: tile };
  const noAi = await decideBotAuction({ auction, bot, startingCash: 1_500, game });

  assert.equal(noAi.actionId, 'auction:wait');
  assert.deepEqual(noAi.candidates.map(candidate => candidate.id), ['auction:wait']);

  const ai = await decideBotAuction({
    auction,
    bot,
    startingCash: 1_500,
    game,
    advisor: { supportsChoicePhases: true, chooseAction: async () => ({ actionId: 'auction:bid', provider: 'ai', fallback: false }) }
  });
  assert.equal(ai.actionId, 'auction:wait');
  assert.deepEqual(ai.candidates.map(candidate => candidate.id), ['auction:wait']);
});

check('valuable group completion may justify a premium without a fixed price multiple', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'auction-host', clientId: 'auction-host', nickname: 'Host', roomCode: 'AUCTIONVALUE' });
  room.addOrReconnectPlayer({ socketId: 'auction-rival', clientId: 'auction-rival', nickname: 'Rival' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const bot = game.players.find(player => player.isBot);
  bot.cash = 3000;
  for (const index of [37, 39]) {
    const tile = game.getTile(index);
    tile.ownerId = bot.id;
    if (!bot.properties.includes(index)) bot.properties.push(index);
  }
  const completingDeed = game.getTile(37);
  completingDeed.ownerId = null;
  bot.properties = bot.properties.filter(index => index !== completingDeed.index);
  const decision = auctionBidDecision({ highestBid: 850, propertyTile: completingDeed }, bot, 1500, game);
  assert.equal(decision.shouldBid, true, 'the final high-rent group deed can be worth more than twice face value');
});

// Bot owns two Orange deeds; the third is at auction. An opponent's two Dark
// Blue deeds at two houses are a live $675 hit, so the liquidity reserve is $775.
const auctionOrange = (index, ownerId) => ({ index, type: 'property', group: 'Orange', price: 180, rent: 18, ownerId, houseCount: 0, mortgaged: false });
const auctionTiles = [
  auctionOrange(11, 'auction-bot'),
  auctionOrange(13, 'auction-bot'),
  auctionOrange(14, null),
  { index: 37, type: 'property', group: 'Dark Blue', price: 400, rent: 50, ownerId: 'rival', houseCount: 2, mortgaged: false },
  { index: 39, type: 'property', group: 'Dark Blue', price: 400, rent: 50, ownerId: 'rival', houseCount: 2, mortgaged: false }
];
const auctionGame = (roundNumber = 2) => ({
  tiles: auctionTiles,
  roundNumber,
  getGroupTiles: group => auctionTiles.filter(tile => tile.group === group),
  getPropertyHouseCost: tile => (tile.group === 'Orange' ? 100 : 200),
  activeEventEffects: () => ({})
});
check('auction ceiling leaves the live liquidity reserve and discounts unbuilt completion upside', async () => {
  const game = auctionGame();
  const auction = { highestBid: 100, propertyTile: auctionTiles[2] };
  const rich = { id: 'auction-bot', cash: 3000, properties: [11, 13] };
  const poor = { id: 'auction-bot', cash: 1000, properties: [11, 13] };
  assert.equal(auctionLiquidityReserve(game, rich), 775, 'the reserve covers the $675 hit plus one $100 house');
  assert.ok(auctionBidDecision(auction, rich, 1500, game).maximum <= 3000 - 775, 'bids never spend the reserve');
  assert.equal(auctionBidDecision(auction, poor, 1500, game).maximum, 225, 'a $1000 bot can bid only $225 above the reserve');
  const ai = await decideBotAuction({
    auction,
    bot: rich,
    startingCash: 1500,
    game,
    advisor: { supportsChoicePhases: true, chooseAction: async ({ candidates }) => ({ actionId: 'auction:bid', parameters: { amount: candidates[0].maximumAmount } }) }
  });
  assert.ok(rich.cash - ai.amount >= 775, 'the bid that uses the full ceiling still leaves the reserve');
  assert.ok(auctionWillingness(auction, poor, game) < auctionWillingness(auction, rich, game), 'a poorer completer discounts the cash still needed to build the set');
  const lateGame = auctionGame(30);
  const faceValue = deedValue(lateGame, auctionTiles[2]);
  assert.equal(auctionWillingness(auction, rich, lateGame), Math.floor(faceValue + progressCredit(lateGame, 'Orange', 2, 3)),
    'three build rounds do not fit a two-round horizon, so the completion earns no rent upside');
});

check('jail stay beats exit on developed boards only', () => {
  const hot = { tiles: [
    { group: 'Orange', ownerId: 'h', houseCount: 3 },
    { group: 'Orange', ownerId: 'h', houseCount: 3 },
    { group: 'Orange', ownerId: 'h', houseCount: 3 },
  ] };
  const cold = { tiles: [{ group: 'Brown', ownerId: null, houseCount: 0 }] };
  const inmate = { id: 'b1', jailTurns: 0, cash: 200 };
  assert.strictEqual(jailStayBeatsExit(hot, inmate), true);
  assert.strictEqual(jailStayBeatsExit(cold, inmate), false);
  assert.strictEqual(jailStayBeatsExit(null, inmate), false);
});

check('early laps waive the reserve; broke tables get declined for auction', () => {
  const tile = { index: 5, price: 60, group: 'Brown' };
  assert.strictEqual(shouldBuyWithPlan({ roundNumber: 2 }, { cash: 70 }, tile), true);
  assert.strictEqual(shouldBuyWithPlan({ roundNumber: 10 }, { cash: 70 }, tile), false);
  const brokeTable = {
    roundNumber: 10,
    players: [{ id: 'b1' }, { id: 'h', cash: 10, bankrupt: false, disconnected: false }],
    getGroupTiles: () => [{ group: 'Brown', ownerId: 'h' }, { group: 'Brown', ownerId: null }],
  };
  assert.strictEqual(shouldBuyWithPlan(brokeTable, { id: 'b1', cash: 2000 }, tile), false);
});

check('early-lap waiver keeps the largest standard rent in cash after the purchase', () => {
  const board = [
    { index: 5, type: 'property', group: 'Brown', price: 180, rent: 18 },
    { index: 39, type: 'property', group: 'Dark Blue', price: 400, rent: 50 }
  ];
  const deed = board[0];
  const game = { roundNumber: 2, tiles: board };
  // Post-buy cash of $0 would leave the bot unable to pay its first rent.
  assert.strictEqual(shouldBuyWithPlan(game, { id: 'b1', cash: 180 }, deed), false);
  assert.strictEqual(shouldBuyWithPlan(game, { id: 'b1', cash: 229 }, deed), false);
  assert.strictEqual(shouldBuyWithPlan(game, { id: 'b1', cash: 230 }, deed), true, 'the waiver still buys when the largest rent stays covered');
  assert.strictEqual(shouldBuyWithPlan({ ...game, roundNumber: 4 }, { id: 'b1', cash: 230 }, deed), false, 'the waiver ends after lap three');
});

check('a bot trade proposal is tracked, and a lapsed one becomes a grudge against its partner', () => {
  const bot = { id: 'trader', cash: 900, tradesCompleted: 2 };
  const game = { hasRolled: true, pendingTrade: null };
  const room = {
    game,
    runBotAction: (_id, action) => action(bot),
    proposeTrade: () => {
      game.pendingTrade = { id: 'offer-9', fromPlayerId: bot.id, toPlayerId: 'human' };
      return { success: true, trade: game.pendingTrade };
    },
    cancelTrade: () => { game.pendingTrade = null; return { success: true, canceled: true }; }
  };
  CANDIDATE_RUNNERS.trade(room, bot, { id: 'trade:human', toPlayerId: 'human', givePropertyIndexes: [3], requestPropertyIndexes: [1] });
  // pairKey (partner|give|ask) is the per-offer cool-off key added by the trade rework.
  assert.deepEqual(bot.lastTradeProposal, { id: 'offer-9', toPlayerId: 'human', pairKey: 'human|3|1', completedBefore: 2 });
  // Still open at the bot's next turn: nothing has been declined yet.
  assert.equal(recordDeclinedProposal(bot, game), false);
  assert.deepEqual(bot.lastTradeProposal, { id: 'offer-9', toPlayerId: 'human', pairKey: 'human|3|1', completedBefore: 2 });
  // Declined (the offer left the table unsettled): recorded as a grudge the
  // trade gate reads (grudged out at three), so the same offer is not repeated.
  game.pendingTrade = null;
  assert.equal(recordDeclinedProposal(bot, game), true);
  assert.ok(bot.grudge.human >= 3, 'a declined offer grudges its partner out of new deals');
  assert.equal(tradePairCoolingOff(bot, 'human|3|1', 0), true, 'the identical offer is also cooled off for several rounds');
  assert.equal(tradePairCoolingOff(bot, 'human|3|1', 4), false, 'the cool-off ends after four rounds');
  assert.equal(tradePairCoolingOff(bot, 'human|3|2', 0), false, 'other deals with the same partner stay open');
  assert.equal(bot.lastTradeProposal, null);
  // Settled (the completed counter moved) is not a rejection.
  const settled = { id: 'settler', lastTradeProposal: { id: 'offer-7', toPlayerId: 'human', completedBefore: 2 }, tradesCompleted: 3 };
  assert.equal(recordDeclinedProposal(settled, { pendingTrade: null }), false);
  assert.equal(settled.grudge, undefined);
  // The bot's own cancel clears the tracked proposal, so it is never a rejection.
  bot.lastTradeProposal = { id: 'offer-11', toPlayerId: 'human', completedBefore: 2 };
  game.pendingTrade = { id: 'offer-11', fromPlayerId: bot.id, toPlayerId: 'human' };
  assert.equal(CANDIDATE_RUNNERS['cancel-trade'](room, bot, { tradeId: 'offer-11' }).success, true);
  assert.equal(bot.lastTradeProposal, null, 'a self-cancelled offer is not a rejection');
  assert.equal(recordDeclinedProposal(bot, game), false);
});

check('a legal bank-loan candidate maps without an archetype gate', () => {
  assert.deepStrictEqual(
    candidateAction({ kind: 'loan', totalDue: 600 }, { cash: 1000 }).type, 'loan');
});

check('a live offer at the negotiation limit is not pruned', () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.getPlayerById = id => (id === 'lender' ? { bankrupt: false, disconnected: false } : null);
  room.game.pendingTrade = { id: 't-depth', fromPlayerId: 'b1', toPlayerId: 'lender', giveCash: 10, counterDepth: 2 };
  assert.strictEqual(pruneStaleOwnDeal(room, bot1, room.game), false, 'depth two can still be settled, so the offer stays');
  assert.deepEqual(log, [], 'the offer is left for the partner to accept, decline, or let expire');
  room.game.getPlayerById = id => (id === 'ghost' ? { bankrupt: true, disconnected: false } : null);
  room.game.pendingTrade = { id: 't-dead', fromPlayerId: 'b1', toPlayerId: 'ghost', giveCash: 10, counterDepth: 0 };
  assert.strictEqual(pruneStaleOwnDeal(room, bot1, room.game), true, 'a dead recipient still frees the table');
});

check('a dead pending counterpart is not woken and its obligation is pruned', () => {
  const deadBot = { id: 'b2', isBot: true, bankrupt: true, disconnected: false };
  const human = { id: 'h1' };
  const game = fakeGame({
    current: human,
    players: [deadBot],
    pendingTrade: { id: 't-dead', fromPlayerId: 'h1', toPlayerId: 'b2' }
  });
  assert.strictEqual(selectBotTurnTarget(game).id, 'h1', 'the dead bot is never served');
  assert.strictEqual(game.pendingTrade, null, 'the obligation it could never answer is pruned');
  const liveBot = { id: 'b3', isBot: true, bankrupt: false, disconnected: false };
  const live = fakeGame({
    current: human,
    players: [liveBot],
    pendingTrade: { id: 't-live', fromPlayerId: 'h1', toPlayerId: 'b3' }
  });
  assert.strictEqual(selectBotTurnTarget(live).id, 'b3', 'a live counterpart is still served');
});

check('trade acceptance preflights the settlement the engine will run', () => {
  const tiles = {
    1: { index: 1, price: 60, group: 'Brown', ownerId: null },
    5: { index: 5, price: 60, group: 'Brown', ownerId: null },
    16: { index: 16, price: 180, group: 'Orange', ownerId: 'H' }
  };
  const players = {
    H: { id: 'H', cash: 800, bankrupt: false, disconnected: false },
    BOT: { id: 'BOT', cash: 500, reserved: 0, bankrupt: false, disconnected: false }
  };
  const game = {
    players: Object.values(players),
    tiles: Object.values(tiles),
    getTile: index => tiles[index] || null,
    getGroupTiles: group => Object.values(tiles).filter(tile => tile.group === group),
    getPlayerById: id => players[id] || null,
    spendableCash: player => Number(player.cash || 0) - Number(player.reserved || 0),
    tradeLegTileUnavailable: (tile, ownerId) => !tile || tile.ownerId !== ownerId || tile.blocked === true
  };
  const getTile = index => tiles[index] || null;
  const offer = { fromPlayerId: 'H', toPlayerId: 'BOT', givePropertyIndexes: [16], giveCash: 0, requestCash: 100, requestPropertyIndexes: [] };
  assert.strictEqual(shouldAcceptTrade(offer, getTile, game), true, 'a deliverable offer is still accepted');
  // The bot cannot fund its own cash leg: its bid is reserved in an auction.
  players.BOT.reserved = 500;
  assert.strictEqual(shouldAcceptTrade(offer, getTile, game), false, 'the bot does not sign a cash leg it cannot spend');
  players.BOT.reserved = 0;
  // The deed the bot would hand over is not its own.
  const undeliverable = { ...offer, requestPropertyIndexes: [5] };
  assert.strictEqual(shouldAcceptTrade(undeliverable, getTile, game), false, 'a leg the bot cannot deliver is refused');
  // The deed it would receive is no longer tradable.
  tiles[16].blocked = true;
  assert.strictEqual(shouldAcceptTrade(offer, getTile, game), false, 'an encumbered deed is refused');
  tiles[16].blocked = false;
  // A dead proposer can never settle either.
  players.H.bankrupt = true;
  assert.strictEqual(shouldAcceptTrade(offer, getTile, game), false, 'a bankrupt proposer is refused');
  players.H.bankrupt = false;
  players.H.disconnected = true;
  assert.strictEqual(shouldAcceptTrade(offer, getTile, game), false, 'a disconnected proposer is refused');
});

check('event votes weigh the seat they are about, not the first option', () => {
  const settings = { startingCash: 1500, botDifficulty: 'table' };
  const monopoly = { id: 'anti-monopoly', targetPlayerId: 'leader', choices: [{ id: 'enforce' }, { id: 'dismiss' }] };
  const monopolyGame = { settings, globalEvent: monopoly };
  assert.equal(selectGlobalEventPolicy(monopoly, monopolyGame, { id: 'rival', cash: 900 }).id, 'enforce', 'a rival wants the leader capped');
  assert.equal(selectGlobalEventPolicy(monopoly, monopolyGame, { id: 'leader', cash: 900 }).id, 'dismiss', 'the target wants the audit dismissed');
  const bankRun = { id: 'bank-run', choices: [{ id: 'emergency-bailout' }, { id: 'let-the-ledger-run' }] };
  const bankGame = { settings, globalEvent: bankRun };
  assert.equal(selectGlobalEventPolicy(bankRun, bankGame, { id: 'broke', cash: 200 }).id, 'emergency-bailout', 'a distressed seat wants the rescue');
  assert.equal(selectGlobalEventPolicy(bankRun, bankGame, { id: 'rich', cash: 1500 }).id, 'let-the-ledger-run', 'a solvent seat does not pay for the rescue');
  assert.equal(selectGlobalEventPolicy(bankRun, bankGame, { id: 'borrowed', cash: 1500, bankLoan: { status: 'active' } }).id, 'let-the-ledger-run', 'a loan-backed seat avoids the moral-hazard premium');
  const crisis = { id: 'legitimacy-crisis', choices: [{ id: 'publish-audit' }, { id: 'bury-audit' }] };
  const crisisGame = { settings, globalEvent: crisis };
  assert.equal(selectGlobalEventPolicy(crisis, crisisGame, { id: 'strained', cash: 300 }).id, 'bury-audit', 'a strained seat takes the quiet exit');
  assert.equal(selectGlobalEventPolicy(crisis, crisisGame, { id: 'rich', cash: 2000 }).id, 'publish-audit', 'a solvent seat keeps the books clean');
});

await Promise.all(pending);
console.log(`\n${passed} botLogic checks passed`);
