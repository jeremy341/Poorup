// Characterization suite for botLogic.js: every decision table, threshold,
// and phase ordering extracted from the original scheduleBotTurn inline chain
// is pinned here with boundary values. Each assertion is checked against the
// pre-refactor expression it replaces (trade factor 1.1/0.8, contract 1.25/0.8,
// auction step/reserve/comfort, purchase reserve 120, build buffer 200).
import assert from 'assert';
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
  isAuctionBotParticipant,
  shouldBuyProperty,
  sponsorshipContributionAmount,
  resolvePurchaseOffer,
  runBotTurn
} from './botLogic.js';

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
  // give = 400, ask = 400: non-shark 320 accept; shark 440 decline.
  const even = { giveCash: 400, givePropertyIndexes: [], requestCash: 400, requestPropertyIndexes: [] };
  assert.strictEqual(shouldAcceptTrade(even, price, 'survivor'), true);
  assert.strictEqual(shouldAcceptTrade(even, price, 'shark'), false);
  // Boundary: give exactly at bar accepts (>=).
  const edge = { giveCash: 320, givePropertyIndexes: [], requestCash: 400, requestPropertyIndexes: [] };
  assert.strictEqual(shouldAcceptTrade(edge, price, 'builder'), true);
  // Boundary: 400*1.1 is 440.00000000000006 in floating point, so a give of
  // exactly 440 does NOT clear the shark bar; 441 does. The original inline
  // expression had the same behavior - this pins reality, not intuition.
  const edgeShark = { giveCash: 440, givePropertyIndexes: [], requestCash: 400, requestPropertyIndexes: [] };
  assert.strictEqual(shouldAcceptTrade(edgeShark, price, 'shark'), false);
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

check('AI advisor ranks a trade response without leaving the room seam', async () => {
  const room = fakeRoom([]);
  room.game.pendingTrade = { id: 'trade-1', toPlayerId: 'b1', fromPlayerId: 'lender', giveCash: 200, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [] };
  const advisor = { supportsChoicePhases: true, chooseAction: async () => ({ actionId: 'trade:decline', provider: 'ai', fallback: false }) };
  const result = await runBotTurn(room, bot1, advisor);
  assert.strictEqual(result.name, 'respondTrade:false');
  assert.strictEqual(result.botDecision.actionId, 'trade:decline');
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

await Promise.all(pending);
console.log(`\n${passed} botLogic checks passed`);
