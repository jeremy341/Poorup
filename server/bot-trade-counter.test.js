// A bot that rejects a near-miss human offer counters it instead of flatly
// declining; hopeless offers and tables with another obligation still decline.
import assert from 'node:assert/strict';
import { getBotChoiceCandidates } from './botLogic.js';

const bot = { id: 'b1', isBot: true, cash: 1000, properties: [7] };
const tiles = { 7: { index: 7, price: 100, group: 'brown' } };

function gameWith(trade, over = {}) {
  return {
    players: [],
    globalEvent: null,
    pendingTrade: trade,
    pendingPlayerContract: null,
    pendingPayment: null,
    auction: null,
    pendingPurchaseOffer: null,
    pendingSponsoredPurchase: null,
    getTile: index => tiles[index] || null,
    getPlayerById: () => null,
    getCurrentPlayer: () => null,
    ...over
  };
}

const offer = (giveCash) => ({
  id: 'trade-1', toPlayerId: 'b1', fromPlayerId: 'h1',
  giveCash, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [7], counterDepth: 0
});
const best = candidates => [...candidates].sort((a, b) => b.score - a.score)[0].choiceId;

// $75 for a $100 deed: below the bar but close, so the bot counters.
assert.equal(best(getBotChoiceCandidates(gameWith(offer(75)), bot, 'trade')), 'counter');
// A fair offer is accepted.
assert.equal(best(getBotChoiceCandidates(gameWith(offer(100)), bot, 'trade')), 'accept');
// A lowball is declined outright.
assert.equal(best(getBotChoiceCandidates(gameWith(offer(10)), bot, 'trade')), 'decline');
// A pending auction blocks the replacement offer, so the counter is not offered.
const blocked = getBotChoiceCandidates(gameWith(offer(75), { auction: { active: true } }), bot, 'trade').map(c => c.choiceId);
assert.equal(blocked.includes('counter'), false, 'no counter while another obligation is pending');
// A pending payment does NOT block it: the engine settles a parked debt with
// the money, so a debt-rescue counter stays legal (tradeApi.js guards).
const paying = getBotChoiceCandidates(
  gameWith(offer(75), { pendingPayment: { playerId: 'b1', amountRemaining: 100 } }),
  bot,
  'trade'
).map(c => c.choiceId);
assert.equal(paying.includes('counter'), true, 'a pending payment does not block the counter');

console.log('bot trade counter: 5 passed');
