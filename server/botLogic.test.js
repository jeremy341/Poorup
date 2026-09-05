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
    declareBankruptcy: () => ({ name: 'bankrupt' }),
    passAuction: () => ({ name: 'pass' }),
    endTurn: () => ({ name: 'endTurn' }),
    rollDice: () => ({ name: 'roll' }),
    proposeTrade: () => ({ name: 'propose', success: true }),
    tradeMarket: (actor, instrumentId, side, quantity) => ({ name: `market:${instrumentId}:${side}:${quantity}` }),
    placeCasinoBet: (actor, color, stake) => ({ name: `casino:${color}:${stake}` }),
    manageProperty: (actor, payload) => ({ name: `manage:${payload.action}:${payload.tileIndex}` }),
    takeBankLoan: () => ({ name: 'loan' }),
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

check('runBotTurn resolves post-roll purchase offers at most twice', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.hasRolled = true;
  room.rollDice = () => ({ name: 'roll', purchaseOffer: { tileIndex: 5 } });
  const result = await runBotTurn(room, bot1, advisorStub(null));
  assert.strictEqual(result.name, 'buy:5');
});

check('runBotTurn runs advisor candidates through the action map', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.hasRolled = false;
  room.game.getBotCandidates = () => [{ id: 'c1', kind: 'market', instrumentId: 'ACME', side: 'buy', quantity: 2 }];
  const result = await runBotTurn(room, bot1, advisorStub({ actionId: 'c1' }));
  assert.strictEqual(result.name, 'market:ACME:buy:2');
});

check('runBotTurn aborts when the seat changed while the advisor thought', async () => {
  const log = [];
  const room = fakeRoom(log);
  room.game.getCurrentPlayer = () => ({ id: 'someone-else', isBot: true });
  const result = await runBotTurn(room, bot1, advisorStub({ actionId: 'x' }));
  assert.strictEqual(result.noEmit, true);
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
