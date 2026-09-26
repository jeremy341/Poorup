import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { isStartedTransition, serverPlayerView, syncActionLockFromSnapshot, syncRoom } = await import("./clientStateSync.js");
const { state } = await import("./clientState.js");

assert.equal(isStartedTransition({ started: true, roundNumber: 1 }, { gameStarted: false, phase: "lobby" }), true);
assert.equal(isStartedTransition({ started: true, roundNumber: 1 }, { gameStarted: true, phase: "lobby" }), true);
assert.equal(isStartedTransition({ started: true, roundNumber: 1 }, { gameStarted: true, phase: "playing" }), false);
assert.equal(isStartedTransition({ started: false, roundNumber: 1 }, { gameStarted: true, phase: "playing" }), false);

const inactiveView = serverPlayerView({
  id: "remote-1",
  nickname: "JUNO",
  presence: { state: "inactive", inactiveSince: 10_000, inactiveUntil: 190_000, reason: "hidden", accountId: "private-account" },
});
assert.deepEqual(inactiveView.presence, { state: "inactive", inactiveSince: 10_000, inactiveUntil: 190_000 });
const defaultPresenceView = serverPlayerView({ id: "remote-2", nickname: "PIP" });
assert.deepEqual(defaultPresenceView.presence, { state: "active", inactiveSince: null, inactiveUntil: null });
const botPresenceView = serverPlayerView({ id: "bot-1", isBot: true, presence: { state: "inactive", inactiveSince: 1, inactiveUntil: 2 } });
assert.equal(botPresenceView.presence, null);

syncRoom({ voteKick: {
  voteId: "vote-1",
  targetPlayerId: "seat-target",
  openedAt: 10_000,
  expiresAt: 40_000,
  eligibleCount: 2,
  yesCount: 1,
  noCount: 0,
  requiredYes: 2,
  status: "open",
  electorate: ["seat-one", "seat-two"],
  ballots: { "seat-one": "yes" },
  accountId: "private-account",
}});
assert.deepEqual(state.voteKick, {
  voteId: "vote-1",
  targetPlayerId: "seat-target",
  openedAt: 10_000,
  expiresAt: 40_000,
  eligibleCount: 2,
  yesCount: 1,
  noCount: 0,
  requiredYes: 2,
  status: "open",
});
syncRoom({ voteKick: null });
assert.equal(state.voteKick, null);

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

const syncSource = readFileSync(new URL("./clientStateSync.js", import.meta.url), "utf8");
assert.doesNotMatch(syncSource, /state\.turnDeadline\s*=/);
assert.doesNotMatch(syncSource, /maybeStartCountdown|startTurnCountdown/);

console.log("client state rematch transition tests: passed");
