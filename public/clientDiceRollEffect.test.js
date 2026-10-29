import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDiceRollSequenceTracker, showDiceRollTotal } from "./clientDiceRollEffect.js";

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

const classes = new Set();
const attributes = new Map();
const announcement = {
  classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
  textContent: "",
  setAttribute: (name, value) => attributes.set(name, value),
  get offsetWidth() { return 1; },
};
const boardArea = { querySelector: () => announcement, append() {} };
let timeoutMs = null;
let timeoutCallback = null;
let cleared = false;
globalThis.document = { querySelector: selector => selector === "#view-game .board-area" ? boardArea : null };
globalThis.window = {
  clearTimeout() { cleared = true; },
  setTimeout(callback, delay) { timeoutCallback = callback; timeoutMs = delay; return 1; },
};
showDiceRollTotal(9);
assert.equal(announcement.textContent, "9");
assert.equal(attributes.get("aria-label"), "Dice total: 9");
assert.equal(classes.has("is-visible"), true);
showDiceRollTotal(12);
assert.equal(cleared, true, "a newer roll replaces the old hide timer");
assert.equal(announcement.textContent, "12");
assert.equal(timeoutMs, 3000, "the announcement remains visible for three seconds");
timeoutCallback();
assert.equal(classes.has("is-visible"), false, "the announcement clears at the end of its lifetime");

const presentationStyles = readFileSync(new URL("./ui-review-presentation.css", import.meta.url), "utf8");
assert.match(presentationStyles, /dice-roll-total\.is-visible\s*\{\s*animation:\s*dice-total-review 3000ms/);
assert.match(presentationStyles, /prefers-reduced-motion:\s*reduce[\s\S]*?dice-roll-total\.is-visible\s*\{[^}]*animation:\s*none/);

console.log("dice roll announcement: sequence dedupe, three-second lifetime, timer replacement, and reduced-motion styling passed");
