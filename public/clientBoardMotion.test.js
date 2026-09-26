import assert from "node:assert/strict";
import { createWalkTimeline } from "./clientBoardMotion.js";

const timeline = createWalkTimeline({ path: [2, 3, 4], stepMs: 130, startedAt: 1000, now: () => 1000 });
assert.deepEqual(timeline.snapshot(), { index: 0, beforeFirst: true, done: false, elapsed: 0 });
assert.deepEqual(timeline.snapshot(1129), { index: 0, beforeFirst: true, done: false, elapsed: 129 });
assert.deepEqual(timeline.snapshot(1130), { index: 0, beforeFirst: false, done: false, elapsed: 130 });
assert.deepEqual(timeline.snapshot(1260), { index: 1, beforeFirst: false, done: false, elapsed: 260 });
assert.deepEqual(timeline.snapshot(1390), { index: 2, beforeFirst: false, done: true, elapsed: 390 });

const replaced = createWalkTimeline({ path: [8], stepMs: 100, startedAt: 500, now: () => 500 });
assert.equal(replaced.snapshot(700).done, true);
assert.deepEqual(createWalkTimeline({ path: [], startedAt: 1 }).snapshot(1), { index: -1, beforeFirst: false, done: true, elapsed: 0 });
assert.equal(createWalkTimeline({ path: Array.from({ length: 12 }, (_, index) => index + 1), startedAt: 1000 }).duration, 3600,
  'a twelve-space move uses the approved 300 ms per-tile cadence');

console.log("client board motion timeline tests: passed");

