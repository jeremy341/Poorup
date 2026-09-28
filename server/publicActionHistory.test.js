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

const knownProfile = publicActionHistory.summarizePublicActionProfile([
  ...Array.from({ length: 5 }, () => ({ actionKind: 'auction-bid', seatIndex: 2, roundNumber: 10 })),
  ...Array.from({ length: 5 }, () => ({ actionKind: 'trade-counter', seatIndex: 2, roundNumber: 10 })),
  { actionKind: 'purchase', seatIndex: 1, roundNumber: 10 },
  { actionKind: 'chat', seatIndex: 2, roundNumber: 10 },
], 2, 10);
assert.equal(knownProfile.status, 'known');
assert.equal(knownProfile.effectiveSampleWeight, 10);
assert.equal(knownProfile.confidence, 1);
assert.equal(knownProfile.actionFrequencies['auction-bid'], 0.5);
assert.equal(knownProfile.actionFrequencies['trade-counter'], 0.5);
assert.equal(knownProfile.actionFrequencies.purchase, 0);

const unknownProfile = publicActionHistory.summarizePublicActionProfile([], 2, 10);
assert.equal(unknownProfile.status, 'unknown');
assert.equal(unknownProfile.actionFrequencies, null);
assert.equal(unknownProfile.confidence, 0);
console.log('public action history: bounded allowlisted records passed');
