import assert from "node:assert/strict";
import { createVoteKickUi } from "./clientVoteKickUi.js";

const emitted = [];
const listeners = new Map();
const container = {
  hidden: true,
  innerHTML: "",
  addEventListener(type, fn) { listeners.set(type, fn); },
  removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
};
const ui = createVoteKickUi({
  container,
  emit: (event, payload, ack) => { emitted.push({ event, payload }); ack?.({ success: true }); },
  createRequestId: () => "request-1",
  now: () => 1000,
  schedule: () => 1,
  cancel: () => {},
});
const players = [
  { id: "p1", serverId: "room-me", name: "Marlow" },
  { id: "p2", serverId: "room-target", name: "Juno" },
];

ui.requestStart("room-target", players);
assert.match(container.innerHTML, /If this vote passes during a game/);
listeners.get("click")({ target: { closest: selector => selector === '[data-votekick-action]' ? { dataset: { votekickAction: "start" } } : null } });
assert.deepEqual(emitted[0], {
  event: "room-votekick-start",
  payload: { targetPlayerId: "room-target", requestId: "request-1" },
});

const voteSnapshot = {
  voteId: "vote-1",
  targetPlayerId: "room-target",
  openedAt: 1000,
  expiresAt: 31_000,
  eligibleCount: 2,
  yesCount: 1,
  noCount: 0,
  requiredYes: 2,
  status: "open",
};
ui.update(voteSnapshot, players, 1000);
assert.match(container.innerHTML, /Juno/);
assert.match(container.innerHTML, /YES/);
assert.match(container.innerHTML, /NO/);
assert.match(container.innerHTML, /NEEDED/);
assert.match(container.innerHTML, /role="progressbar"/);
assert.match(container.innerHTML, /If passed during a game/);
assert.match(container.innerHTML, /data-votekick-choice="yes"/, "an open vote exposes the yes action");
assert.match(container.innerHTML, /data-votekick-choice="no"/, "an open vote exposes the no action");
assert.match(container.innerHTML, /30 seconds remaining/, "an open vote shows its deadline countdown");
assert.doesNotMatch(container.innerHTML, /voterId|voterName|accountId/);

listeners.get("click")({ target: { closest: selector => selector === '[data-votekick-choice]' ? { disabled: false, dataset: { votekickChoice: "no" } } : null } });
assert.deepEqual(emitted[1], {
  event: "room-votekick-cast",
  payload: { voteId: "vote-1", choice: "no", requestId: "request-1" },
});

ui.update({ ...voteSnapshot, status: "passed" }, players, 1000);
assert.match(container.innerHTML, /Vote passed/);
ui.destroy();
assert.equal(container.hidden, true);
assert.equal(listeners.size, 0);

console.log("client vote-kick UI tests: passed");
