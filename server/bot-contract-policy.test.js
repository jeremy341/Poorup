// Contract safety for bots. A human once offered a bot a $10 loan secured on every deed it owned: the gate
// looked only at cash, the planner treated repaying as net-worth neutral (so a due loan lost to "roll"), and a
// default seizes the whole pledged basket. These checks pin the terms a bot signs, its counters, and on-time repayment of a curable debt.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { DeterministicAdvisor } from './botAdvisor.js';
import { runBotTurn, getBotChoiceCandidates, shouldAcceptPlayerContract } from './botLogic.js';
import {
  borrowerAcceptsContract,
  lenderAcceptsCounter,
  equityMinimumPrice,
  BORROW_MIN_ROUNDS,
  COLLATERAL_MAX_COVER
} from './botContractPolicy.js';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`PASS - ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

function table() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'sock-human', clientId: 'client-human', nickname: 'Human', rulesProfile: 'advanced' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const human = game.players.find(player => !player.isBot);
  const bot = game.players.find(player => player.isBot);
  return { room, game, human, bot };
}

function own(game, player, indexes) {
  for (const index of indexes) {
    game.tiles[index].ownerId = player.id;
    if (!player.properties.includes(index)) player.properties.push(index);
  }
}

function turnOf(game, player) {
  game.currentPlayerId = player.id;
  game.hasRolled = false;
  game.awaitingEndTurn = false;
  game.extraRollPending = false;
  game.turnAllowsExtraRoll = false;
  game.pendingPurchaseOffer = null;
}

async function botAnswers(room, bot) {
  return runBotTurn(room, bot, new DeterministicAdvisor());
}

const PORTFOLIO = [1, 3, 6, 8, 9, 11, 13, 14, 16, 18, 19];

await check('a bot refuses a token loan that pledges its whole portfolio', async () => {
  const { room, game, human, bot } = table();
  own(game, bot, PORTFOLIO);
  turnOf(game, human);
  const proposed = room.proposePlayerContract('sock-human', {
    toPlayerId: bot.id, kind: 'loan', amount: 10, premiumRate: 0, durationRounds: 1, collateralTileIndices: PORTFOLIO
  });
  assert.equal(proposed.success, true, 'the engine allows the offer, so only the bot can protect itself');
  await botAnswers(room, bot);
  assert.equal(game.pendingPlayerContract, null, 'the offer was answered');
  assert.equal(game.playerContracts.filter(contract => contract.status === 'active').length, 0, 'no loan was signed');
  assert.deepEqual([...bot.properties].sort((a, b) => a - b), PORTFOLIO, 'the bot kept every deed');
});

await check('a bot refuses interest, short terms and thinly covered collateral, but signs a plain interest-free loan', async () => {
  const { game, human, bot } = table();
  const ctx = { lender: human, game };
  own(game, bot, [37, 39]);
  const base = { rulesVersion: 2, kind: 'loan', amount: 100, premiumRate: 0, durationRounds: BORROW_MIN_ROUNDS, totalDue: 100 };
  assert.equal(borrowerAcceptsContract(base, bot, ctx), true, 'free money for three rounds is fine');
  assert.equal(borrowerAcceptsContract({ ...base, premiumRate: 5, totalDue: 105 }, bot, ctx), false, 'a bot does not pay interest to be farmed');
  assert.equal(borrowerAcceptsContract({ ...base, durationRounds: BORROW_MIN_ROUNDS - 1 }, bot, ctx), false, 'too short to schedule the repayment');
  assert.equal(borrowerAcceptsContract({ ...base, amount: 1600, totalDue: 1600 }, bot, ctx), false, 'more than 80% of its cash');
  assert.equal(borrowerAcceptsContract(base, bot, { lender: { bankrupt: true }, game }), false, 'a bankrupt lender');
  assert.equal(borrowerAcceptsContract(base, bot, { lender: null, game }), false, 'no lender');
  const airport = game.tiles[5];
  own(game, bot, [5]);
  const covered = { ...base, amount: 150, totalDue: 150, collateralTileIndices: [5] };
  assert.equal(airport.group, undefined, 'airports are not part of a color set');
  assert.ok(airport.price <= 150 * COLLATERAL_MAX_COVER, 'a $200 airport against a $150 loan is within the cover limit');
  assert.equal(borrowerAcceptsContract(covered, bot, ctx), true);
  assert.equal(borrowerAcceptsContract({ ...covered, amount: 10, totalDue: 10 }, bot, ctx), false, 'the same deed against $10 is a trap');
});

await check('a bot never pledges a deed that completes or nearly completes its own set', async () => {
  const { game, human, bot } = table();
  own(game, bot, [37, 39]);
  const offer = { rulesVersion: 2, kind: 'loan', amount: 1000, premiumRate: 0, durationRounds: 5, totalDue: 1000, collateralTileIndices: [37] };
  assert.equal(borrowerAcceptsContract(offer, bot, { lender: human, game }), false, 'Dark Blue is complete: pledging one deed would break it');
  const solo = table();
  own(solo.game, solo.bot, [37]);
  assert.equal(borrowerAcceptsContract({ ...offer, amount: 400, totalDue: 400 }, solo.bot, { lender: solo.human, game: solo.game }), false, 'one short of a pair is still protected');
});

await check('deprecated hybrid notes and equity-transfer offers are declined', async () => {
  const { game, human, bot } = table();
  own(game, bot, [5]);
  const ctx = { lender: human, game };
  const note = { rulesVersion: 2, kind: 'hybrid', amount: 50, premiumRate: 0, durationRounds: 4, totalDue: 50, propertyIndex: 5, conversionShare: 100 };
  assert.equal(borrowerAcceptsContract(note, bot, ctx), false, 'a $50 note that converts into 100% of an airport is a giveaway');
  const price = equityMinimumPrice(game, { equityShare: 100 }, game.tiles[5]);
  assert.equal(borrowerAcceptsContract({ ...note, amount: price, totalDue: price }, bot, ctx), false, 'new hybrid notes stay disabled even at a fair price');
  assert.equal(borrowerAcceptsContract({ kind: 'equity-transfer', amount: 1200 }, bot, ctx), false, 'bots never buy a slice');
  assert.equal(borrowerAcceptsContract({ kind: 'mystery', amount: 1 }, bot, ctx), false, 'unknown kinds are declined');
  assert.equal(shouldAcceptPlayerContract({ kind: 'equity-transfer', amount: 1 }, bot, human, game), false);
});

await check('rent shares are finite passive rights and keep a set buildable', async () => {
  const { game, human, bot } = table();
  own(game, bot, [5, 15]);
  const ctx = { lender: human, game };
  const price = equityMinimumPrice(game, { equityShare: 10 }, game.tiles[5]);
  const offer = { rulesVersion: 2, rentShareVersion: 1, durationRounds: 3, equityControl: 'passive', kind: 'equity', amount: price, propertyIndex: 5, equityShare: 10, permanent: false };
  assert.equal(borrowerAcceptsContract(offer, bot, ctx), true);
  assert.equal(borrowerAcceptsContract({ ...offer, amount: price - 1 }, bot, ctx), false, 'below 2x value');
  assert.equal(borrowerAcceptsContract({ ...offer, permanent: true }, bot, ctx), false, 'permanent slices can never be bought back');
  own(game, bot, [37, 39]);
  const setDeed = { rulesVersion: 2, rentShareVersion: 1, durationRounds: 3, equityControl: 'passive', kind: 'equity', amount: 5000, propertyIndex: 37, equityShare: 5, permanent: false };
  assert.equal(borrowerAcceptsContract(setDeed, bot, ctx), true, 'a rent share preserves owner construction rights on a set');
});

await check('a bot as lender takes a counter only while it is still a bounded, priced, short loan', async () => {
  const { game, bot } = table();
  bot.cash = 1500;
  const priced = { rulesVersion: 2, kind: 'loan', amount: 300, premiumRate: 35, durationRounds: 3 };
  assert.equal(lenderAcceptsCounter(game, bot, priced), true, 'its own template');
  assert.equal(lenderAcceptsCounter(game, bot, { ...priced, amount: 1400, premiumRate: 0, durationRounds: 20 }), false, 'the whole bankroll for free over 20 rounds');
  assert.equal(lenderAcceptsCounter(game, bot, { ...priced, premiumRate: 0 }), false, 'a zero-return loan');
  assert.equal(lenderAcceptsCounter(game, bot, { ...priced, durationRounds: 10 }), false, 'too long');
  assert.equal(lenderAcceptsCounter(game, bot, { ...priced, kind: 'equity' }), false, 'a counter that changes the kind');
  bot.cash = 400;
  assert.equal(lenderAcceptsCounter(game, bot, priced), false, 'the lending reserve would be spent');
});

await check('a debt that is due and can be cured is paid in full before any advisor is asked', async () => {
  const { room, game, human, bot } = table();
  turnOf(game, human);
  const offer = { toPlayerId: bot.id, kind: 'loan', amount: 100, premiumRate: 0, durationRounds: 3 };
  assert.equal(room.proposePlayerContract('sock-human', offer).success, true);
  await botAnswers(room, bot);
  const contract = game.playerContracts.find(entry => entry.toPlayerId === bot.id);
  assert.equal(contract?.status, 'active', 'an interest-free loan with a fair term is signed');
  for (let round = 0; round < 3; round += 1) game.advanceRound();
  assert.equal(contract.status, 'due');
  turnOf(game, bot);
  const humanCashBefore = human.cash;
  const advisor = { supportsChoicePhases: false, chooseAction: async () => { throw new Error('the advisor must not be consulted for a mandatory obligation'); } };
  const result = await runBotTurn(room, bot, advisor);
  assert.equal(result.success !== false, true);
  assert.equal(result.botDecision?.reasonCode, 'obligation-due');
  assert.equal(contract.status, 'paid');
  assert.equal(human.cash, humanCashBefore + 100, 'the lender got the money back');
});

await check('a due debt that cannot be cured gets no part-payment candidate', async () => {
  const { room, game, human, bot } = table();
  turnOf(game, human);
  assert.equal(room.proposePlayerContract('sock-human', { toPlayerId: bot.id, kind: 'loan', amount: 100, premiumRate: 0, durationRounds: 3 }).success, true);
  await botAnswers(room, bot);
  for (let round = 0; round < 3; round += 1) game.advanceRound();
  const contract = game.playerContracts.find(entry => entry.toPlayerId === bot.id);
  assert.equal(contract.status, 'due');
  turnOf(game, bot);
  bot.cash = 60;
  const candidates = game.getBotCandidates(bot, { expanded: true, parity: true });
  assert.equal(candidates.some(candidate => candidate.kind === 'repay'), false, 'a part payment still defaults and only strands the cash');
  bot.cash = 100;
  const curable = game.getBotCandidates(bot, { expanded: true, parity: true }).find(candidate => candidate.kind === 'repay');
  assert.equal(curable?.mandatory, true);
  assert.equal(curable?.amount, 100);
});

await check('the advisor is never offered a trade that finishes an opponent set, and a stale answer cannot accept it', async () => {
  const { room, game, human, bot } = table();
  own(game, human, [16, 18]);
  own(game, bot, [19]);
  human.cash = 1500;
  turnOf(game, human);
  const proposed = room.proposeTrade('sock-human', { toPlayerId: bot.id, givePropertyIndexes: [], giveCash: 50, requestPropertyIndexes: [19], requestCash: 0 });
  assert.equal(proposed.success, true);
  const ids = getBotChoiceCandidates(game, bot, 'trade').map(candidate => candidate.id);
  assert.deepEqual(ids, ['trade:decline'], 'only decline is on the table');
  const advisor = {
    supportsChoicePhases: true,
    chooseAction: async () => ({ actionId: 'trade:accept', provider: 'ai', fallback: false })
  };
  await runBotTurn(room, bot, advisor);
  assert.equal(game.tiles[19].ownerId, bot.id, 'the deed stayed with the bot');
  assert.equal(game.pendingTrade, null, 'the offer was declined');
});

await check('an unknown or stale AI answer on a poor trade declines instead of accepting the first listed option', async () => {
  const { room, game, human, bot } = table();
  own(game, bot, [1]);
  turnOf(game, human);
  assert.equal(room.proposeTrade('sock-human', { toPlayerId: bot.id, givePropertyIndexes: [], giveCash: 5, requestPropertyIndexes: [1], requestCash: 0 }).success, true);
  const ids = getBotChoiceCandidates(game, bot, 'trade').map(candidate => candidate.id);
  assert.equal(ids[0], 'trade:accept', 'accept is listed first, which is why the old fallback accepted');
  const advisor = { supportsChoicePhases: true, chooseAction: async () => ({ actionId: 'trade:invented', provider: 'ai', fallback: false }) };
  await runBotTurn(room, bot, advisor);
  assert.equal(game.tiles[1].ownerId, bot.id, 'a $5 offer for a $60 deed was not accepted by default');
});

await check('a counter the bot would not accept itself is never made', async () => {
  const { room, game, human, bot } = table();
  own(game, bot, [37, 39]);
  turnOf(game, human);
  assert.equal(room.proposeTrade('sock-human', { toPlayerId: bot.id, givePropertyIndexes: [], giveCash: 200, requestPropertyIndexes: [39], requestCash: 0 }).success, true);
  const candidates = getBotChoiceCandidates(game, bot, 'trade');
  const counter = candidates.find(candidate => candidate.id === 'trade:counter');
  if (counter) {
    const mirrored = {
      id: 'check', fromPlayerId: counter.offer.toPlayerId, toPlayerId: bot.id,
      givePropertyIndexes: counter.offer.requestPropertyIndexes, giveCash: counter.offer.requestCash,
      requestPropertyIndexes: counter.offer.givePropertyIndexes, requestCash: counter.offer.giveCash
    };
    const { shouldAcceptTrade } = await import('./botLogic.js');
    assert.equal(shouldAcceptTrade(mirrored, index => game.getTile(index), game), true, 'the counter clears the bot\'s own acceptance bar');
    assert.ok(counter.offer.requestCash > 220, 'a +10% bump on a broken Dark Blue set does not clear the bar');
  }
});

await check('a contract counter is not offered while another table obligation is open', async () => {
  const { room, game, human, bot } = table();
  turnOf(game, human);
  assert.equal(room.proposePlayerContract('sock-human', { toPlayerId: bot.id, kind: 'loan', amount: 100, premiumRate: 0, durationRounds: 3 }).success, true);
  const counterOffered = () => getBotChoiceCandidates(game, bot, 'contract').some(candidate => candidate.id === 'contract:counter');
  assert.equal(counterOffered(), true, 'a counter is offered on a quiet table');
  const open = [
    ['auction', { auction: { active: true } }],
    ['purchase offer', { pendingPurchaseOffer: { playerId: human.id, tileIndex: 19 } }],
    ['sponsored purchase', { pendingSponsoredPurchase: { buyerId: human.id } }],
    ['pending trade', { pendingTrade: { id: 'open-trade', fromPlayerId: human.id, toPlayerId: bot.id, givePropertyIndexes: [], requestPropertyIndexes: [], giveCash: 0, requestCash: 0 } }]
  ];
  for (const [label, state] of open) {
    Object.assign(game, state);
    assert.equal(counterOffered(), false, `an open ${label} blocks the contract counter`);
    Object.assign(game, { auction: null, pendingPurchaseOffer: null, pendingSponsoredPurchase: null, pendingTrade: null });
  }
  game.pendingPayment = { playerId: bot.id, amountRemaining: 50 };
  assert.equal(counterOffered(), true, 'a pending payment does not block the contract counter');
});

await check('the bot refuses terms the engine would refuse to activate', async () => {
  const { game, human, bot } = table();
  const ctx = { lender: human, game };
  const base = { rulesVersion: 2, kind: 'loan', amount: 100, premiumRate: 0, durationRounds: BORROW_MIN_ROUNDS, totalDue: 100 };
  assert.equal(borrowerAcceptsContract(base, bot, ctx), true, 'a plain interest-free loan is fine');
  human.disconnected = true;
  assert.equal(borrowerAcceptsContract(base, bot, ctx), false, 'a disconnected lender cannot fund the contract');
  human.disconnected = false;
  human.cash = 50;
  assert.equal(borrowerAcceptsContract(base, bot, ctx), false, 'a lender that cannot fund the contract');
  human.cash = 1500;
  human.bankLoan = { status: 'active', remaining: 100 };
  assert.equal(borrowerAcceptsContract(base, bot, ctx), false, 'loan-backed cash cannot fund a contract');
  human.bankLoan = null;
  human.cash = 1000;
  game.auction = { active: true, highestBidderId: human.id, highestBid: 1000 };
  assert.equal(borrowerAcceptsContract(base, bot, ctx), false, 'the lender\'s reserved bid cash cannot fund a contract');
  game.auction = null;
  human.cash = 1500;
  bot.cash = 1000;
  game.auction = { active: true, highestBidderId: bot.id, highestBid: 1000 };
  assert.equal(borrowerAcceptsContract(base, bot, ctx), false, 'the bot cannot promise its reserved bid cash');
  game.auction = null;
  bot.cash = 1500;
  bot.disconnected = true;
  assert.equal(borrowerAcceptsContract(base, bot, ctx), false, 'a disconnected bot cannot receive a contract');
});

await check('a bot as lender counts only the cash it can actually spend', async () => {
  const { game, bot } = table();
  bot.cash = 1500;
  const priced = { rulesVersion: 2, kind: 'loan', amount: 300, premiumRate: 35, durationRounds: 3 };
  assert.equal(lenderAcceptsCounter(game, bot, priced), true, 'its own template');
  game.auction = { active: true, highestBidderId: bot.id, highestBid: 1300 };
  assert.equal(lenderAcceptsCounter(game, bot, priced), false, 'reserved bid cash is not lendable');
  game.auction = null;
  bot.bankLoan = { status: 'active', remaining: 100 };
  assert.equal(lenderAcceptsCounter(game, bot, priced), false, 'loan-backed cash cannot fund a contract');
});

await check('the bot proposes no contract while another table obligation is open', async () => {
  const { game, human, bot } = table();
  bot.cash = 1500;
  turnOf(game, bot);
  assert.ok(game.botContractCandidates(bot).length > 0, 'a contract is offered on a quiet table');
  const open = [
    ['auction', { auction: { active: true } }],
    ['purchase offer', { pendingPurchaseOffer: { playerId: human.id, tileIndex: 19 } }],
    ['sponsored purchase', { pendingSponsoredPurchase: { buyerId: human.id } }],
    ['pending trade', { pendingTrade: { id: 'open-trade', fromPlayerId: human.id, toPlayerId: bot.id, givePropertyIndexes: [], requestPropertyIndexes: [], giveCash: 0, requestCash: 0 } }]
  ];
  for (const [label, state] of open) {
    Object.assign(game, state);
    assert.deepEqual(game.botContractCandidates(bot), [], `an open ${label} blocks the contract proposal`);
    Object.assign(game, { auction: null, pendingPurchaseOffer: null, pendingSponsoredPurchase: null, pendingTrade: null });
  }
});

await check('an advisor answer from a previous game is discarded after a rematch', async () => {
  const { room, game, human, bot } = table();
  turnOf(game, human);
  assert.equal(room.proposeTrade('sock-human', { toPlayerId: bot.id, givePropertyIndexes: [], giveCash: 50, requestPropertyIndexes: [], requestCash: 0 }).success, true);
  const advisor = {
    supportsChoicePhases: true,
    chooseAction: async () => {
      // The table was reset for a new game while the advisor was thinking.
      game.startedAt = (Number(game.startedAt) || 0) + 1000;
      return { actionId: 'trade:accept', provider: 'ai', fallback: false };
    }
  };
  const result = await runBotTurn(room, bot, advisor);
  assert.equal(result.botDecision?.reasonCode, 'game-changed', 'the stale answer is dropped');
  assert.ok(game.pendingTrade, 'the offer is still pending: the stale answer never acted on it');
});

const failed = results.filter(ok => !ok).length;
console.log(`bot contract policy: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
