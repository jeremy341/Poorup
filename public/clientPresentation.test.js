import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { createPresentationQueue } from './clientPresentation.js';

let time = 0;
let nextTimer = 0;
const timers = new Map();
const totals = [];
const walks = [];
let motionReduced = false;
const queue = createPresentationQueue({
  now: () => time,
  setTimer(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at: time + ms }); return id; },
  clearTimer: id => timers.delete(id),
  announceTotal: total => totals.push(total),
  animateSegment: segment => {
    walks.push(segment.path);
    return motionReduced ? Promise.resolve({ motionSkipped: true }) : Promise.resolve();
  },
});
async function advance(to) {
  time = to;
  for (let n = 0; n < 8; n++) {
    for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.fn(); }
    await new Promise(resolve => setImmediate(resolve));
  }
}
queue.receive('ROOM', null);
const record = {
  id: 1, actorId: 'me', dice: [2, 2], startedAt: 0, readyAt: 2640,
  segments: [{ from: 0, to: 4, path: [1, 2, 3, 4], stepMs: 300, offsetMs: 1240, durationMs: 1200 }],
  cashEvents: [{ cause: 'landing', atMs: 2640, deltas: [{ playerId: 'me', amount: -50 }] }],
};
assert.equal(queue.receive('ROOM', record), true);
assert.equal(queue.busy, true);
assert.equal(queue.positionFor('me'), 0, 'claim the origin before a destination snapshot renders');
assert.equal(950 - queue.pendingCashFor('me'), 1000, 'an unrevealed debit is staged only in the displayed balance');
assert.equal(1050 - queue.pendingCashFor('me'), 1100, 'an unrelated mortgage credit remains visible during movement');
assert.equal(queue.receive('ROOM', record), false, 'duplicate snapshots never replay a roll');
await advance(799);
assert.deepEqual(totals, []);
await advance(800);
assert.deepEqual(totals, [4]);
await advance(1239);
assert.deepEqual(walks, []);
await advance(1240);
assert.deepEqual(walks, [[1, 2, 3, 4]]);
await advance(2440);
assert.equal(queue.pendingCashFor('me'), -50, 'arrival grace runs before the landing debit is revealed');
await advance(2640);
assert.equal(queue.pendingCashFor('me'), 0);
assert.equal(queue.busy, false);
assert.equal(queue.positionFor('me'), undefined);
queue.receive('ROOM', { ...record, id: 2, startedAt: 3000, readyAt: 5640 });
queue.receive('OTHER', null);
await advance(6000);
assert.deepEqual(totals, [4], 'room changes cancel stale total and landing callbacks');
queue.receive('MATCH', null, 1);
assert.equal(queue.receive('MATCH', { ...record, id: 5, startedAt: 6000, readyAt: 8640 }, 1), true);
queue.receive('MATCH', null, 2);
assert.equal(queue.receive('MATCH', { ...record, id: 1, startedAt: 6000, readyAt: 8640 }, 2), true,
  'a same-room rematch accepts its first roll even when the previous game had a higher sequence');
queue.reset();
time = 7000;
motionReduced = true;
queue.receive('ROOM', null);
assert.equal(queue.receive('ROOM', { ...record, id: 1, startedAt: 7000, readyAt: 9640 }), true);
await advance(8240);
assert.equal(queue.positionFor('me'), 4, 'reduced motion reconciles the pawn to the segment destination immediately');
assert.equal(queue.busy, true, 'the server presentation deadline still keeps gameplay actions locked');
await advance(9640);
assert.equal(queue.busy, false, 'the queue unlocks only when the authoritative presentation deadline is reached');
queue.reset();
console.log('client presentation event ordering and cash staging: passed');
