// Regression pins for the trade rework (docs/BOT-ENGINE-AUDIT-2026-10.md findings 4, 5, 6, 9):
// group trades that finish sets, the corrected cash sign, a monopoly veto that nets what
// comes back and no longer reads the buyer's wallet, rich trades behind the same veto,
// set-safe counters, and a per-offer cool-off with no value-neutral swaps.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { shouldAcceptTrade, recordDeclinedProposal } from './botLogic.js';
import { counterTradeOffer } from './botCandidates.js';
import { clearingTradeCounter } from './advisorLogic.js';
import { vetoTrade, monopolyGiveaway, monopolyRequirement } from './botTradeValuation.js';
import { tickLedger, tradePairKey, tradePairCoolingOff } from './botTableMind.js';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS - ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

// One human (A) and one bot, an empty board, both seats rich, the bot to move.
function fixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'sA', clientId: 'cA', nickname: 'A', roomCode: 'TRDRWK' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const bot = game.players.find(player => player.isBot);
  const human = game.players.find(player => !player.isBot);
  game.players.forEach(player => { player.properties = []; player.cash = 1500; });
  game.tiles.forEach(tile => { if (tile.group) { tile.ownerId = null; tile.houseCount = 0; } });
  game.currentPlayerId = bot.id;
  const own = (player, indexes) => indexes.forEach(index => {
    game.getTile(index).ownerId = player.id;
    player.properties.push(index);
  });
  const tradesOf = () => game.getBotCandidates(bot, { expanded: true, parity: true }).filter(candidate => candidate.kind === 'trade');
  return { game, bot, human, own, tradesOf };
}

const asProposal = (bot, human, offer) => ({
  fromPlayerId: bot.id,
  toPlayerId: human.id,
  givePropertyIndexes: offer.givePropertyIndexes,
  requestPropertyIndexes: offer.requestPropertyIndexes,
  giveCash: offer.giveCash,
  requestCash: offer.requestCash,
});

// --- (a) group trades -----------------------------------------------------------

check('a bot one deed short of a set offers for the missing deed, in cash or with another group\'s deed', () => {
  const { bot, human, own, tradesOf } = fixture();
  own(bot, [16, 18, 6]);
  own(human, [19]);
  const offers = tradesOf();
  const cash = offers.find(offer => offer.givePropertyIndexes.length === 0);
  const swap = offers.find(offer => offer.givePropertyIndexes.join() === '6');
  assert.ok(cash && swap, 'both a cash-only and a tile offer for Orange 19 are generated');
  for (const offer of [cash, swap]) {
    assert.deepEqual(offer.requestPropertyIndexes, [19]);
    assert.equal(offer.score, 36, 'completing the set carries the +28 bonus on the base 8 (completesGroup used to be dead code)');
  }
  assert.equal(cash.giveCash, 520, 'the bot pays the 2x monopoly premium on the 260 deed value');
  assert.equal(cash.requestCash, 0);
  assert.ok(swap.giveCash > 0 && swap.giveCash < cash.giveCash, 'the deed it hands over reduces the cash it owes');
  assert.equal(swap.requestCash, 0);
  assert.equal(offers[0].id, cash.id, 'the cheapest completer for the bot is listed first (stable best-first order)');
});

check('same-group one-for-one swaps are never generated', () => {
  const { bot, human, own, tradesOf } = fixture();
  own(bot, [16]);
  own(human, [18]);
  assert.deepEqual(tradesOf(), [], 'swapping one Orange for another changes nothing for either seat');
});

check('the cash sign follows the value: the bot pays for the pricier deed, is paid for handing over one', () => {
  const { bot, human, own, tradesOf } = fixture();
  own(bot, [3, 26]);
  own(human, [1]);
  const offers = tradesOf();
  const cashOnly = offers.find(offer => offer.givePropertyIndexes.length === 0);
  assert.equal(cashOnly.giveCash, 114);
  assert.equal(cashOnly.requestCash, 0);
  const yellow = offers.find(offer => offer.givePropertyIndexes.join() === '26');
  assert.ok(yellow, 'the Yellow deed buys the Brown completer');
  assert.equal(yellow.giveCash, 0, 'the bot hands over the pricier deed, so it does not also pay');
  assert.ok(yellow.requestCash > 0, 'it asks the partner for the difference (the old sign asked for cash when TAKING the pricier tile)');
});

check('an unaffordable completer is not offered: the bot keeps its reserve', () => {
  const { bot, human, own, tradesOf } = fixture();
  own(bot, [16, 18]);
  own(human, [19]);
  bot.cash = 820;
  assert.equal(tradesOf()[0].giveCash, 520, 'cash 820 covers 520 and keeps the 300 reserve');
  bot.cash = 819;
  assert.equal(tradesOf().length, 0, 'one dollar less would dip under the reserve');
});

// --- (b) rich trades ------------------------------------------------------------

check('rich and group offers never finish a set for either seat below the monopoly premium', () => {
  let seen = 0;
  let richSeen = 0;
  for (const setup of [
    { bot: [3, 6, 8], human: [1, 9, 11] },
    { bot: [1, 6, 11], human: [3, 8, 9] },
    { bot: [16, 18, 26], human: [19, 27, 29] },
    { bot: [3, 11, 13], human: [1, 14, 16] },
  ]) {
    const { game, bot, human, own, tradesOf } = fixture();
    own(bot, setup.bot);
    own(human, setup.human);
    const offers = tradesOf();
    seen += offers.length;
    richSeen += offers.filter(offer => offer.rich).length;
    for (const offer of offers) {
      const proposal = asProposal(bot, human, offer);
      assert.equal(vetoTrade(game, proposal, human.id).vetoed, false, `${offer.id}: the human is paid for any set it hands over`);
      assert.equal(vetoTrade(game, proposal, bot.id).vetoed, false, `${offer.id}: the bot is paid for any set it hands over`);
    }
  }
  console.log(`  (${seen} offers, ${richSeen} rich)`);
  assert.ok(seen > 0 && richSeen > 0, 'the fixtures exercise both collectors');
});

// --- (c) the veto -----------------------------------------------------------------

check('the veto nets the deeds the receiver hands back and ignores the receiver\'s cash', () => {
  const { game, bot, human, own } = fixture();
  own(bot, [3]);
  own(human, [1]);
  human.cash = 99;
  assert.equal(monopolyGiveaway(game, [3], human.id).givesMonopoly, true);
  assert.equal(monopolyGiveaway(game, [3], human.id, [1]).givesMonopoly, false, 'Brown 3 for Brown 1 completes nothing');
  const bare = { fromPlayerId: human.id, toPlayerId: bot.id, givePropertyIndexes: [], giveCash: 100, requestPropertyIndexes: [3], requestCash: 0 };
  assert.equal(vetoTrade(game, bare, bot.id).vetoed, true, 'a $99 buyer can no longer take a set: 100 is under the 114 premium');
  assert.equal(shouldAcceptTrade(bare, index => game.getTile(index), game), false);
  assert.equal(vetoTrade(game, { ...bare, giveCash: 114 }, bot.id).vetoed, false, 'the premium lifts the veto');
  // The bot now checks the proposer can pay what it offers, so the $114 buyer must hold $114.
  human.cash = 114;
  assert.equal(shouldAcceptTrade({ ...bare, giveCash: 114 }, index => game.getTile(index), game), true);
  const swap = { ...bare, giveCash: 0, givePropertyIndexes: [1], requestPropertyIndexes: [3] };
  assert.equal(vetoTrade(game, swap, bot.id).vetoed, false, 'handing back the same group nets the completion out');
  assert.equal(monopolyRequirement(game, [3], [], human.id).needCash, 114);
});

// --- (d) counters -----------------------------------------------------------------

function pendingToBot(game, bot, human, terms) {
  game.pendingTrade = {
    id: 'rework-trade',
    fromPlayerId: human.id,
    toPlayerId: bot.id,
    counterDepth: 0,
    giveCash: 0,
    requestCash: 0,
    givePropertyIndexes: [],
    requestPropertyIndexes: [],
    ...terms,
  };
}

check('a counter never gives up the bot\'s own complete set', () => {
  const { game, bot, human, own } = fixture();
  own(bot, [37, 39, 6]);
  pendingToBot(game, bot, human, { giveCash: 330, requestPropertyIndexes: [37] });
  assert.equal(counterTradeOffer(game, bot, 10), null, 'Dark Blue 37 would break the bot\'s set');
  assert.equal(shouldAcceptTrade(game.pendingTrade, index => game.getTile(index), game), false, 'and it is not accepted either');
  pendingToBot(game, bot, human, { giveCash: 90, requestPropertyIndexes: [6] });
  const counter = counterTradeOffer(game, bot, 10);
  assert.ok(counter, 'a loose deed can still be countered');
  assert.deepEqual(counter.givePropertyIndexes, [6]);
});

check('a counter cannot finish the proposer\'s set under the premium', () => {
  const { game, bot, human, own } = fixture();
  own(bot, [3]);
  own(human, [1]);
  pendingToBot(game, bot, human, { giveCash: 100, requestPropertyIndexes: [3] });
  assert.equal(counterTradeOffer(game, bot, 10), null, 'asking for 110 still hands over Brown below 114');
  const counter = counterTradeOffer(game, bot, 20);
  assert.ok(counter, 'asking for 120 clears the premium');
  assert.equal(counter.requestCash, 120);
});

check('the advisor retries a counter at a higher premium after a set-premium refusal', () => {
  const { game, bot, human, own } = fixture();
  own(bot, [3]);
  own(human, [1]);
  pendingToBot(game, bot, human, { giveCash: 100, requestPropertyIndexes: [3] });
  assert.equal(counterTradeOffer(game, bot, 10), null, 'the +10 premium does not cover the 114 monopoly premium');
  const counter = clearingTradeCounter(game, bot);
  assert.ok(counter, 'the refusal at +10 is retried at a higher premium');
  assert.equal(counter.requestCash, 120, 'the +20 premium clears the monopoly premium');
});

check('the bot proposes no trade while another table obligation is open', () => {
  const { game, bot, human, own, tradesOf } = fixture();
  own(bot, [16, 18, 6]);
  own(human, [19]);
  assert.ok(tradesOf().length > 0, 'a trade is offered on a quiet table');
  const open = [
    ['auction', { auction: { active: true } }],
    ['purchase offer', { pendingPurchaseOffer: { playerId: human.id, tileIndex: 19 } }],
    ['sponsored purchase', { pendingSponsoredPurchase: { buyerId: human.id } }]
  ];
  for (const [label, state] of open) {
    Object.assign(game, state);
    assert.deepEqual(tradesOf(), [], `an open ${label} blocks the proposal`);
    Object.assign(game, { auction: null, pendingPurchaseOffer: null, pendingSponsoredPurchase: null });
  }
});

check('a proposed trade clears the partner\'s own acceptance bar', () => {
  const { game, bot, human, own, tradesOf } = fixture();
  own(bot, [16, 18, 6]);
  own(human, [19]);
  const offers = tradesOf();
  assert.ok(offers.length > 0, 'the fixture exercises the collector');
  for (const offer of offers) {
    const proposal = asProposal(bot, human, offer);
    assert.equal(
      shouldAcceptTrade(proposal, index => game.getTile(index), game),
      true,
      `${offer.id} is refused by the partner's own bar (proposal and acceptance disagree)`
    );
  }
});

// --- (e) churn ----------------------------------------------------------------------

check('a declined offer is cooled off for several rounds without blocking other deals', () => {
  const { game, bot, human, own, tradesOf } = fixture();
  own(bot, [16, 18, 6]);
  own(human, [19]);
  game.roundNumber = 10;
  const offers = tradesOf();
  const cash = offers.find(offer => offer.givePropertyIndexes.length === 0);
  const swap = offers.find(offer => offer.givePropertyIndexes.join() === '6');
  bot.lastTradeProposal = {
    id: 'declined-1',
    toPlayerId: human.id,
    pairKey: tradePairKey(human.id, cash.givePropertyIndexes, cash.requestPropertyIndexes),
    completedBefore: 0,
  };
  game.pendingTrade = null;
  assert.equal(recordDeclinedProposal(bot, game), true);
  bot.grudge = {};
  const present = () => tradesOf().map(offer => offer.id);
  assert.equal(present().includes(cash.id), false, 'the identical offer does not come straight back');
  assert.equal(present().includes(swap.id), true, 'a different offer to the same partner is still open');
  game.roundNumber = 13;
  assert.equal(present().includes(cash.id), false, 'still cooling three rounds later');
  game.roundNumber = 14;
  assert.equal(present().includes(cash.id), true, 'the cool-off ends after four rounds');
});

check('expired cool-offs are pruned by the ledger tick', () => {
  const bot = { id: 'b', tradeCooldowns: { 'p|1|2': 5, 'p|3|4': 9 } };
  tickLedger(bot, 7);
  assert.deepEqual(Object.keys(bot.tradeCooldowns), ['p|3|4']);
  assert.equal(tradePairCoolingOff(bot, 'p|3|4', 8), true);
  assert.equal(tradePairCoolingOff(bot, 'p|3|4', 9), false);
  assert.equal(tradePairKey('p', [4, 3, 3], [1]), 'p|3,4|1', 'the key ignores order and duplicates');
});

check('a value-neutral deed swap is refused, a real gain is taken', () => {
  const { game, bot, human, own } = fixture();
  own(bot, [6]);
  own(human, [8]);
  const getTile = index => game.getTile(index);
  const swap = { fromPlayerId: human.id, toPlayerId: bot.id, givePropertyIndexes: [8], giveCash: 0, requestPropertyIndexes: [6], requestCash: 0, counterDepth: 0 };
  assert.equal(shouldAcceptTrade(swap, getTile, game), false, 'two equal Light Blue deeds: nothing gained, nothing done');
  assert.equal(shouldAcceptTrade({ ...swap, giveCash: 10 }, getTile, game), false, '$10 is below the minimum gain');
  assert.equal(shouldAcceptTrade({ ...swap, giveCash: 30 }, getTile, game), true, '$30 is a real gain');
});

const failed = results.filter(ok => !ok).length;
console.log(`bot trade rework: ${results.length - failed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
