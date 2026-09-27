import assert from 'node:assert/strict';

const publicActionHistory = await import('./publicActionHistory.js').catch(() => ({}));
assert.equal(typeof publicActionHistory.appendPublicAction, 'function', 'public action history provides an allowlisted recorder');

const history = [];
assert.equal(publicActionHistory.appendPublicAction(history, 'chat', 2, 1), false, 'unclassified actions are omitted');
assert.equal(publicActionHistory.appendPublicAction(history, 'auction-bid', -1, 1), false, 'invalid seats are omitted');
for (let roundNumber = 1; roundNumber <= 201; roundNumber += 1) {
  const kind = roundNumber % 2 ? 'auction-bid' : 'trade-counter';
  assert.equal(publicActionHistory.appendPublicAction(history, kind, 2, roundNumber), true);
}

assert.equal(history.length, 200, 'history is bounded to the most recent 200 observations');
assert.deepEqual(Object.keys(history[0]).sort(), ['actionKind', 'roundNumber', 'seatIndex']);
assert.deepEqual(history.at(-1), { actionKind: 'auction-bid', seatIndex: 2, roundNumber: 201 });
assert.equal(JSON.stringify(history).includes('player-id'), false);
assert.equal(JSON.stringify(history).includes('account-id'), false);
console.log('public action history: bounded allowlisted records passed');
