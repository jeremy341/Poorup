import assert from "node:assert/strict";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { isStartedTransition, syncActionLockFromSnapshot } = await import("./clientStateSync.js");
const { state } = await import("./clientState.js");

assert.equal(isStartedTransition({ started: true, roundNumber: 1 }, { gameStarted: false, phase: "lobby" }), true);
assert.equal(isStartedTransition({ started: true, roundNumber: 1 }, { gameStarted: true, phase: "lobby" }), true);
assert.equal(isStartedTransition({ started: true, roundNumber: 1 }, { gameStarted: true, phase: "playing" }), false);
assert.equal(isStartedTransition({ started: false, roundNumber: 1 }, { gameStarted: true, phase: "playing" }), false);

state.busy = true;
state.rolling = true;
state.pendingAction = { kind: "roll", requestId: "test-roll" };
syncActionLockFromSnapshot();
assert.equal(state.busy, true);
assert.equal(state.rolling, true);
state.pendingAction = null;
syncActionLockFromSnapshot();
assert.equal(state.busy, false);
assert.equal(state.rolling, false);

console.log("client state rematch transition tests: passed");
