// Characterization suite for botLogic.js: every decision table, threshold,
// and phase ordering extracted from the original scheduleBotTurn inline chain
// is pinned here with boundary values. Each assertion is checked against the
// pre-refactor expression it replaces (trade factor 1.1/0.8, contract 1.25/0.8,
// auction step/reserve/comfort, purchase reserve 120, build buffer 200).
import assert from 'assert';
import { RoomManager } from './gameLogic.js';
import {
  EVENT_POLICY_BY_PERSONALITY,
  selectGlobalEventPolicy,
  tradeLegValue,
  shouldAcceptTrade,
  shouldAcceptPlayerContract,
  selectBotTurnTarget,
  botMayStillAct,
  classifyBotTurnPhase,
  candidateAction,
  auctionBidDecision,
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
  shouldBuyWithPlan
} from './botLogic.js';
import { jailStayBeatsExit } from './botApi.js';
import { DeterministicAdvisor } from './botAdvisor.js';

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

check('auction selector preserves NO-AI baseline bid and pass decisions', async () => {
  const bot = { id: 'auction-bot', cash: 500, personality: 'builder' };
  const bid = await decideBotAuction({ auction: { highestBid: 0, propertyTile: {} }, bot, startingCash: 500 });
  const pass = await decideBotAuction({ auction: { highestBid: 400, propertyTile: {} }, bot, startingCash: 500 });
  assert.equal(bid.actionId, 'auction:bid');
  assert.equal(pass.actionId, 'auction:pass');
  assert.equal(bid.minimum, 10);
});

check('auction selector accepts only legal AI overrides and retains minimum bid', async () => {
  const bot = { id: 'auction-bot', cash: 500, personality: 'builder' };
  const advisor = { supportsChoicePhases: true, chooseAction: async () => ({ actionId: 'auction:pass' }) };
  const legal = await decideBotAuction({ auction: { highestBid: 5, propertyTile: {} }, bot, startingCash: 500, advisor, context: {} });
  assert.equal(legal.actionId, 'auction:pass');
  assert.equal(legal.minimum, 15);
  const invalid = await decideBotAuction({ auction: { highestBid: 5, propertyTile: {} }, bot, startingCash: 500, advisor: { ...advisor, chooseAction: async () => ({ actionId: 'auction:invent' }) }, context: {} });
  assert.equal(invalid.actionId, 'auction:bid');
});

check('auction shadow comparison stays out of persisted decision and reaches evaluation result', async () => {
  const evaluationTrace = { actionKind: 'auction', deterministicActionKind: 'auction', phase: 'auction' };
  const choice = await decideBotAuction({
    auction: { highestBid: 0, propertyTile: {} },
    bot: { id: 'auction-bot-shadow', cash: 1000, personality: 'builder' },
    startingCash: 1000,
    advisor: { supportsChoicePhases: true, chooseAction: async () => ({ actionId: 'auction:bid', shadowEvaluation: evaluationTrace }) }
  });
  assert.equal(choice.decision.shadowEvaluation, undefined);
  assert.deepEqual(choice.evaluationTrace, evaluationTrace);
});

const CHOICES = [{ id: 'low-tax' }, { id: 'public-works' }, { id: 'bank-first' }];

check('event policy table matches personality mapping', () => {
  assert.strictEqual(EVENT_POLICY_BY_PERSONALITY.builder, 'public-works');
  assert.strictEqual(EVENT_POLICY_BY_PERSONALITY.speculator, 'bank-first');
  assert.strictEqual(selectGlobalEventPolicy({ choices: CHOICES }, 'builder').id, 'public-works');
  assert.strictEqual(selectGlobalEventPolicy({ choices: CHOICES }, 'speculator').id, 'bank-first');
  assert.strictEqual(selectGlobalEventPolicy({ choices: CHOICES }, 'shark').id, 'low-tax');
  assert.strictEqual(selectGlobalEventPolicy({ choices: CHOICES }, 'chaos').id, 'low-tax');
  // Preference missing from choices falls back to first choice.
  assert.strictEqual(selectGlobalEventPolicy({ choices: [{ id: 'z' }, { id: 'a' }] }, 'builder').id, 'z');
  assert.strictEqual(selectGlobalEventPolicy({ choices: [] }, 'builder'), null);
  assert.strictEqual(selectGlobalEventPolicy(undefined, 'builder'), null);
});

const TILES = { 5: { index: 5, price: 200 }, 6: { index: 6, price: 100 }, 7: { index: 7, price: 400 } };
const price = index => TILES[index];

check('trade acceptance uses personality factor on leg values', () => {
  const trade = { giveCash: 300, givePropertyIndexes: [5], requestCash: 50, requestPropertyIndexes: [7] };
  // give = 500, ask = 450. Non-shark bar: 450*0.8=360 -> accept. Shark bar: 450*1.1=495 -> accept.
  assert.strictEqual(shouldAcceptTrade(trade, price, 'builder'), true);
  assert.strictEqual(shouldAcceptTrade(trade, price, 'shark'), true);
  // give = 400, ask = 400: non-shark 320 accept; shark 440 is exactly fair.
  const even = { giveCash: 400, givePropertyIndexes: [], requestCash: 400, requestPropertyIndexes: [] };
  assert.strictEqual(shouldAcceptTrade(even, price, 'survivor'), true);
  assert.strictEqual(shouldAcceptTrade(even, price, 'shark'), false);
  // Boundary: give exactly at bar accepts (>=).
  const edge = { giveCash: 320, givePropertyIndexes: [], requestCash: 400, requestPropertyIndexes: [] };
  assert.strictEqual(shouldAcceptTrade(edge, price, 'builder'), true);
  // Boundary: whole-dollar comparison must accept the exact 1.1x bar rather
  // than rejecting it because of binary floating-point noise.
  const edgeShark = { giveCash: 440, givePropertyIndexes: [], requestCash: 400, requestPropertyIndexes: [] };
  assert.strictEqual(shouldAcceptTrade(edgeShark, price, 'shark'), true);
  assert.strictEqual(shouldAcceptTrade({ ...edgeShark, giveCash: 441 }, price, 'shark'), true);
  assert.strictEqual(tradeLegValue({ cash: '10', propertyIndexes: [5, 7] }, price), 610);
  assert.strictEqual(tradeLegValue(undefined, price), 0);
});

check('player-contract acceptance honors kind, personality, lender', () => {
  const bot = { cash: 1000, personality: 'shark' };
  const lender = { bankrupt: false };
  const equity = { kind: 'equity', amount: 350 };
  assert.strictEqual(shouldAcceptPlayerContract(equity, bot, lender, 'shark'), true);
  assert.strictEqual(shouldAcceptPlayerContract({ kind: 'equity', amount: 351 }, { cash: 1000 }, lender, 'survivor'), false);
  assert.strictEqual(shouldAcceptPlayerContract({ kind: 'equity', amount: 350 }, { cash: 1000 }, lender, 'survivor'), true);
  const repayment = { kind: 'repayment', amount: 800 };
  assert.strictEqual(shouldAcceptPlayerContract(repayment, bot, lender, 'builder'), true);
  assert.strictEqual(shouldAcceptPlayerContract({ kind: 'repayment', amount: 801 }, bot, lender, 'builder'), false);
  assert.strictEqual(shouldAcceptPlayerContract({ kind: 'repayment', amount: 1250 }, bot, lender, 'speculator'), true);
  assert.strictEqual(shouldAcceptPlayerContract({ kind: 'repayment', totalDue: 1251 }, bot, lender, 'speculator'), false);
  // Bankrupt or missing lender kills repayment acceptance only.
  assert.strictEqual(shouldAcceptPlayerContract(repayment, bot, { bankrupt: true }, 'builder'), false);
  assert.strictEqual(shouldAcceptPlayerContract(repayment, bot, null, 'builder'), false);
  assert.strictEqual(shouldAcceptPlayerContract(equity, bot, null, 'builder'), true);
});

function fakeGame(over = {}) {
  return {
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
  const bot = { id: 'b1', isBot: true, cash: 1000, personality: 'builder' };
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
  const pendingHuman = fakeGame({ current: bot1, players: [bot2], pendingTrade: { toPlayerId: 'h9' } });
  assert.strictEqual(selectBotTurnTarget(pendingHuman).id, 'b1');
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
  const bot = { cash: 1000, personality: 'speculator' };
  assert.deepStrictEqual(candidateAction({ kind: 'trade', id: 't1' }, bot), { type: 'trade', candidate: { kind: 'trade', id: 't1' } });
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
  assert.strictEqual(candidateAction({ kind: 'build', cost: 801 }, bot).type, 'roll');
  assert.strictEqual(candidateAction({ kind: 'loan' }, bot).type, 'loan');
  assert.strictEqual(candidateAction({ kind: 'loan' }, { cash: 1000, personality: 'builder' }).type, 'roll');
  assert.strictEqual(candidateAction({ kind: 'roll' }, bot).type, 'roll');
  assert.strictEqual(candidateAction(null, bot).type, 'roll');
  assert.strictEqual(candidateAction({ kind: 'mystery' }, bot).type, 'roll');
});

check('auction bid decision honors step, reserve, comfort ratio', () => {
  const auction = { highestBid: 100 };
  const shark = { personality: 'shark', cash: 300 };
  const builder = { personality: 'builder', cash: 231 };
  const survivor = { personality: 'survivor', cash: 231 };
  // shark: minimum = max(101, 120) = 120, reserve 60 -> needs 180.
  assert.deepStrictEqual(auctionBidDecision(auction, shark, 1500), { shouldBid: true, minimum: 120 });
  // builder: step 10 -> minimum 110, reserve 120 -> needs 230 <= 231.
  assert.deepStrictEqual(auctionBidDecision(auction, builder, 1500), { shouldBid: true, minimum: 110 });
  // survivor at 231 >= 110+120 but comfort: cash must EXCEED 1500*0.7=1050.
  assert.strictEqual(auctionBidDecision(auction, survivor, 1500).shouldBid, false);
  assert.strictEqual(auctionBidDecision(auction, { personality: 'survivor', cash: 1050 }, 1500).shouldBid, false); // exactly at bar: not >
  assert.strictEqual(auctionBidDecision(auction, { personality: 'survivor', cash: 1051 }, 1500).shouldBid, true); // clears bar and reserve
  assert.strictEqual(auctionBidDecision({ highestBid: 100 }, { personality: 'survivor', cash: 1500 }, 1500).shouldBid, true);
  assert.strictEqual(auctionBidDecision({ highestBid: 0 }, { personality: 'shark', cash: 1000 }, 1000).minimum, 20);
});

check('auction participant filter excludes passers, leaders, humans', () => {
  const auction = { participants: ['b1', 'b2', 'h1'], passedPlayerIds: ['b2'], highestBidderId: 'h1' };
  assert.strictEqual(isAuctionBotParticipant(auction, { id: 'b1', isBot: true }), true);
  assert.strictEqual(isAuctionBotParticipant(auction, { id: 'b2', isBot: true }), false);
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
      roundNumber: 3,
      getTile: price,
    getPlayerById: id => (id === 'lender' ? { bankrupt: false } : null),
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
    passAuction: () => ({ name: 'pass' }),
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
const bot1 = { id: 'b1', isBot: true, cash: 1000, personality: 'builder' };

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
  room.game.settings = { botBrain: 'no-ai', botDifficulty: 'table' };
  room.game.pendingTrade = { id: 'local-trade', toPlayerId: 'b1', fromPlayerId: 'lender', giveCash: 250, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [7], counterDepth: 0 };
  const result = await runBotTurn(room, { ...bot1, properties: [7] }, new DeterministicAdvisor());
  assert.equal(result.name, 'respondTrade:false');
  assert.equal(result.botDecision.phase, 'trade');
  assert.equal(result.botDecision.provider, 'deterministic');
});

check('NO-AI contract capability uses the same-phase candidate set', async () => {
  const room = fakeRoom([]);
  room.game.settings = { botBrain: 'no-ai' };
  room.game.pendingPlayerContract = { id: 'local-contract', toPlayerId: 'b1', fromPlayerId: 'lender', kind: 'repayment', amount: 100, counterDepth: 0 };
  const result = await runBotTurn(room, bot1, new DeterministicAdvisor());
  assert.deepEqual(result.botDecision.candidateIds, ['contract:accept', 'contract:counter', 'contract:decline']);
  assert.equal(result.botDecision.phase, 'contract');
  assert.equal(result.botDecision.actionId, 'contract:accept');
});

check('NO-AI payment capability routes the selected rescue candidate', async () => {
  const room = fakeRoom([]);
  room.game.settings = { botBrain: 'no-ai' };
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
  assert.equal(vote.name, 'vote:public-works');
  assert.deepEqual(vote.botDecision.candidateIds, []);

  const sponsorRoom = fakeRoom([]);
  sponsorRoom.game.settings = { botBrain: 'no-ai' };
  sponsorRoom.game.players = [bot1];
  sponsorRoom.game.pendingSponsoredPurchase = { buyerId: 'buyer', tileIndex: 1, price: 100, buyerCash: 0, contributions: [] };
  sponsorRoom.game.contributeToSponsoredPurchase = () => ({ name: 'contributed', success: true });
  const sponsorship = await runBotTurn(sponsorRoom, bot1, new DeterministicAdvisor());
  assert.equal(sponsorship.name, 'contributed');
  assert.deepEqual(sponsorship.botDecision.candidateIds, []);
});

check('local NO-AI payment skips AI-only table brain construction', async () => {
  const room = fakeRoom([]);
  room.game.settings = { botBrain: 'no-ai' };
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
  room.game.pendingPlayerContract = { id: 'contract-same-id', toPlayerId: 'b1', fromPlayerId: 'lender', kind: 'loan', amount: 200, premiumRate: 30, durationRounds: 3, counterDepth: 0 };
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
  room.game.pendingPlayerContract = { id: 'contract-2', toPlayerId: 'b1', fromPlayerId: 'lender', kind: 'loan', amount: 200, premiumRate: 30, durationRounds: 3, collateralTileIndex: null };
  const advisor = { supportsChoicePhases: true, chooseAction: async context => {
    assert.deepEqual(context.candidates.map(candidate => candidate.id), ['contract:accept', 'contract:counter', 'contract:decline']);
    assert.equal(context.candidates[1].offer.premiumRate, 20);
    assert.equal(context.candidates[1].offer.durationRounds, 4);
    return { actionId: 'contract:counter', provider: 'ai', fallback: false };
  } };
  const result = await runBotTurn(room, bot1, advisor);
  assert.strictEqual(result.name, 'counterContract');
  assert.strictEqual(result.botDecision.actionId, 'contract:counter');
});

check('AI advisor abandons a contract decision when the offer changes mid-thought', async () => {
  const room = fakeRoom([]);
  room.game.pendingPlayerContract = { id: 'contract-old', toPlayerId: 'b1', fromPlayerId: 'lender', kind: 'loan', amount: 200, premiumRate: 30, durationRounds: 3, collateralTileIndex: null };
  const advisor = { supportsChoicePhases: true, chooseAction: async () => {
    room.game.pendingPlayerContract = { id: 'contract-new', toPlayerId: 'b1', fromPlayerId: 'other', kind: 'loan', amount: 1, premiumRate: 0, durationRounds: 1, collateralTileIndex: null };
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
    color: '#d74438',
    isBot: true
  });
  room.setRoomSetting('startingCash', 500);
  room.setRoomSetting('bots', 2);
  assert.equal(room.startGame().success, true);
  const lender = room.game.getCurrentPlayer();
  const receiver = room.game.players.find(player => player.id !== lender.id);
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
  room.game.settings = { botBrain: 'no-ai', botDifficulty: 'expert' };
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

check('monopoly veto declines junk-for-completer despite face-value win', () => {
  // Human H owns Brown-1 and offers Orange-16 (face 180) for the bot's
  // Brown-3 (face 60): a face-value win the old bar would accept, but it
  // completes H's build-ready Brown monopoly.
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
    giveCash: 0, givePropertyIndexes: [16],
    requestCash: 0, requestPropertyIndexes: [3],
  };
  // Legacy path without game context keeps pinned face-value behavior.
  assert.strictEqual(shouldAcceptTrade(giveaway, getTile, 'builder'), true);
  // With context: build-ready monopoly giveaway vetoes for every personality.
  for (const personality of ['builder', 'shark', 'survivor', 'speculator', 'diplomat', 'chaos']) {
    assert.strictEqual(shouldAcceptTrade(giveaway, getTile, personality, game(1500)), false, personality);
  }
  // Cash-strapped proposer cannot build yet: no veto, face value decides.
  assert.strictEqual(shouldAcceptTrade(giveaway, getTile, 'builder', game(0)), true);
  // Fair swap with no completion on either side still accepts with context.
  const fair = { ...giveaway, requestPropertyIndexes: [16], givePropertyIndexes: [16] };
  assert.strictEqual(shouldAcceptTrade(fair, getTile, 'builder', game(1500)), true);
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
  assert.strictEqual(shouldAcceptTrade(teaming, getTile, 'builder'), true);
  assert.strictEqual(shouldAcceptTrade(teaming, getTile, 'builder', game), false);
  // Overpaying 1.5x still clears it.
  assert.strictEqual(shouldAcceptTrade({ ...teaming, giveCash: 600 }, getTile, 'builder', game), true);
});

check('near-miss rejections counter with premium instead of declining', async () => {
  // Hopeless offer declines outright.
  const hopeless = { id: 't0', fromPlayerId: 'h', toPlayerId: 'b1', giveCash: 100, givePropertyIndexes: [], requestCash: 400, requestPropertyIndexes: [], counterDepth: 0 };
  assert.strictEqual(nearMissTrade(hopeless, price, 'builder'), false);
  // Near-miss (250 vs 320 bar) counters through the deterministic executor.
  const near = { id: 't1', fromPlayerId: 'h', toPlayerId: 'b1', giveCash: 250, givePropertyIndexes: [], requestCash: 0, requestPropertyIndexes: [7], counterDepth: 0 };
  assert.strictEqual(nearMissTrade(near, price, 'builder'), true);
  const log = [];
  const room = fakeRoom(log);
  room.game.pendingTrade = near;
  const result = await runBotTurn(room, { ...bot1, properties: [7] }, advisorStub(null));
  assert.strictEqual(result.name, 'counter');
});

check('blocked-table counters fall back to decline instead of looping', async () => {
  // Exact regression: near-miss offer plus a payment obligation. Countering
  // would restore the identical offer forever; the bot must decline.
  const log = [];
  const room = fakeRoom(log);
  room.game.pendingTrade = { id: 't-loop', fromPlayerId: 'h', toPlayerId: 'b1', giveCash: 250, givePropertyIndexes: [], requestCash: 0, requestPropertyIndexes: [7], counterDepth: 0 };
  room.game.pendingPayment = { playerId: 'h', amountRemaining: 100 };
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

check('equity gate refuses rent pledges below 2x deed value', () => {
  const tile = { index: 16, price: 180, group: 'Orange' };
  const game = { getTile: () => tile };
  const lender = { bankrupt: false };
  const trap = { kind: 'equity', amount: 1, propertyIndex: 16, equityShare: 100 };
  for (const personality of ['shark', 'builder', 'speculator', 'diplomat', 'chaos']) {
    assert.strictEqual(shouldAcceptPlayerContract(trap, { cash: 1000 }, lender, personality, game), false, personality);
  }
  // Fair funding at twice traffic-adjusted value clears the gate.
  assert.strictEqual(shouldAcceptPlayerContract({ ...trap, amount: 500 }, { cash: 1000 }, lender, 'shark', game), true);
  // Legacy path without game context keeps pinned behavior.
  assert.strictEqual(shouldAcceptPlayerContract({ kind: 'equity', amount: 350 }, { cash: 1000 }, lender, 'shark'), true);
});

check('sponsorship gates stop repeat farming without reciprocity', () => {
  const buyer = { id: 'buyer', cash: 100 };
  const base = {
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
    { group: 'Brown', ownerId: 'b1' },
    { group: 'Brown', ownerId: null },
  ];
  const game = { getGroupTiles: group => tiles.filter(tile => tile.group === group) };
  const bot = { id: 'b1', personality: 'builder', cash: 5000 };
  // Bid-trap: pumped to 500 on a 60 deed with no completion -> pass.
  assert.deepEqual(
    auctionBidDecision({ highestBid: 500, propertyTile: { group: 'Brown', price: 60 } }, bot, 1500, game),
    { shouldBid: false, minimum: 510 }
  );
  // Own completer at 50 -> bid (willingness 120).
  assert.deepEqual(
    auctionBidDecision({ highestBid: 50, propertyTile: { group: 'Brown', price: 60 } }, bot, 1500, game),
    { shouldBid: true, minimum: 60 }
  );
  // Legacy path without game keeps pinned behavior.
  assert.deepEqual(auctionBidDecision({ highestBid: 100 }, { personality: 'shark', cash: 300 }, 1500).shouldBid, true);
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

check('repayable snipe loans clear for any personality', () => {
  assert.deepStrictEqual(
    candidateAction({ kind: 'loan', totalDue: 600 }, { cash: 1000, personality: 'builder' }).type, 'loan');
});

await Promise.all(pending);
console.log(`\n${passed} botLogic checks passed`);
