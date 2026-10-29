import assert from "node:assert/strict";
import { createDiceRollSequenceTracker } from "./clientDiceRollEffect.js";

const totals = [];
const tracker = createDiceRollSequenceTracker(total => totals.push(total));

assert.equal(tracker.receive({ roomCode: "ROOM1", sequence: 0, dice: [0, 0] }), null, "initial snapshot is only a baseline");
assert.equal(tracker.receive({ roomCode: "ROOM1", sequence: 0, dice: [0, 0] }), null, "replayed snapshot does not announce");
assert.equal(tracker.receive({ roomCode: "ROOM1", sequence: 1, dice: [4, 5] }), 9);
assert.equal(tracker.receive({ roomCode: "ROOM1", sequence: 1, dice: [4, 5] }), null, "same roll sequence is ignored");
assert.equal(tracker.receive({ roomCode: "ROOM2", sequence: 0, dice: [0, 0] }), null, "joining another room sets a new baseline even when its sequence is lower");
assert.equal(tracker.receive({ roomCode: "ROOM2", sequence: 2, dice: [2, 6] }), 8);
assert.equal(tracker.receive({ roomCode: "ROOM2", sequence: 0, dice: [0, 0] }), null, "an older same-room snapshot is ignored without resetting the baseline");
assert.equal(tracker.receive({ roomCode: "ROOM2", sequence: 2, dice: [2, 6] }), null, "the latest roll stays deduplicated after an older snapshot");
assert.equal(tracker.receive({ roomCode: "ROOM2", sequence: 3, dice: [6, 6] }), 12);
assert.equal(tracker.receive({ roomCode: "ROOM2", sequence: 4, dice: [0, 4] }), null, "invalid faces never announce");
assert.deepEqual(totals, [9, 8, 12]);

console.log("dice roll announcement: room, sequence, reset, and face validation passed");
