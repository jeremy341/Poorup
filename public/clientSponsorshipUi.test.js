import assert from "node:assert/strict";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const {
  sponsorshipRequestPayload,
  sponsorshipFlowPayload,
  sponsorshipContributionPayload,
  createSponsorshipActionGate,
} = await import("./clientSponsorshipUi.js");

assert.deepEqual(sponsorshipRequestPayload(21), { tileIndex: 21 }, "gift request retains its original payload");
assert.deepEqual(sponsorshipRequestPayload(21, "equity", 25, "request-equity-1"), {
  tileIndex: 21,
  mode: "equity",
  sharePct: 25,
  requestId: "request-equity-1",
});
assert.deepEqual(sponsorshipRequestPayload(21, "equity", 200, "request-equity-2"), {
  tileIndex: 21,
  mode: "equity",
  sharePct: 100,
  requestId: "request-equity-2",
});

const equity = { mode: "equity", requestId: "flow-1" };
assert.deepEqual(sponsorshipContributionPayload(125.8, equity), { amount: 125, requestId: "flow-1" });
assert.deepEqual(sponsorshipFlowPayload(equity), { requestId: "flow-1" });
assert.deepEqual(sponsorshipContributionPayload(125, { mode: "gift", requestId: "legacy-flow" }), { amount: 125 });
assert.deepEqual(sponsorshipFlowPayload({ mode: "gift", requestId: "legacy-flow" }), {});

const gate = createSponsorshipActionGate();
assert.equal(gate.begin("flow-1"), true, "first accept/cancel/contribute operation may start");
assert.equal(gate.begin("flow-1"), false, "the same in-flight request cannot be emitted twice");
gate.complete("flow-1");
assert.equal(gate.begin("flow-1"), true, "a rejected action may be retried");
gate.clear();
assert.equal(gate.begin("flow-1"), true, "a confirmed snapshot releases the gate for the next flow state");

console.log("client sponsorship UI tests: passed");
