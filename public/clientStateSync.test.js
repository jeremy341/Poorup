import assert from "node:assert/strict";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { isStartedTransition } = await import("./clientStateSync.js");

assert.equal(isStartedTransition({ started: true, roundNumber: 1 }, { gameStarted: false, phase: "lobby" }), true);
assert.equal(isStartedTransition({ started: true, roundNumber: 1 }, { gameStarted: true, phase: "lobby" }), true);
assert.equal(isStartedTransition({ started: true, roundNumber: 1 }, { gameStarted: true, phase: "playing" }), false);
assert.equal(isStartedTransition({ started: false, roundNumber: 1 }, { gameStarted: true, phase: "playing" }), false);

console.log("client state rematch transition tests: passed");
