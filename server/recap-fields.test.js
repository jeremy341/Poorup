import assert from 'node:assert/strict';
import { participantFromPlayer, sanitizeParticipant } from './participantFields.js';
import { recordBestTrade } from './tradeApi.js';

// A live player carries the recap figures into its match participant.
const player = {
  id: 'p1', accountId: 'acc-1', nickname: 'ANA', color: '#d74438', cash: 500, properties: [],
  items: [{ itemId: 'a' }, { itemId: 'b' }], matchRebate: 40, bestTradeNet: 120,
};
const live = participantFromPlayer(player, { placementById: new Map() });
assert.equal(live.itemsHeld, 2);
assert.equal(live.matchRebate, 40);
assert.equal(live.bestTradeNet, 120);

// A stored record keeps the figures, and an older record without them gets none.
const stored = sanitizeParticipant({ accountId: 'acc-1', itemsHeld: 3, matchRebate: 15, bestTradeNet: 60 });
assert.equal(stored.itemsHeld, 3);
assert.equal(stored.matchRebate, 15);
assert.equal(stored.bestTradeNet, 60);
assert.equal(Object.hasOwn(sanitizeParticipant({ accountId: 'acc-1' }), 'itemsHeld'), false);

// Only the largest cash gain from a single trade is kept; a losing trade never lowers it.
const trader = { bestTradeNet: 0 };
recordBestTrade(trader, 80);
recordBestTrade(trader, 30);
recordBestTrade(trader, -50);
assert.equal(trader.bestTradeNet, 80);

console.log('recap fields tests passed');
