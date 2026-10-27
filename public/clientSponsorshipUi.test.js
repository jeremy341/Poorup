import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const {
  sponsorshipRequestPayload,
  sponsorshipFlowPayload,
  sponsorshipContributionPayload,
  sponsorshipAudienceNames,
  sponsorshipFundingSummary,
  createSponsorshipActionGate,
  createContributionAttemptTracker,
  openSponsorshipModal,
} = await import("./clientSponsorshipUi.js");

const economyStyles = await readFile(new URL("./ui-review-economy.css", import.meta.url), "utf8");
assert.match(economyStyles, /\.sponsorship-card:has\(\.sponsorship-request-form\)\s*\{[^}]*width: min\(580px/, "request width is scoped to the funding composer");
assert.match(economyStyles, /\.sponsorship-request-form \.sponsorship-mode-options\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, "gift and equity remain equal side-by-side choices");
assert.match(economyStyles, /\.sponsorship-request-form \.sponsorship-mode-options label\s*\{[^}]*flex-direction: column;[^}]*align-items: flex-start;[^}]*min-height: 96px/, "funding options retain the top radio and text layout");
assert.match(economyStyles, /\.sponsorship-request-form \.sponsorship-share-field\[hidden\]\s*\{\s*display: none/, "gift funding hides its inactive equity input despite the shared field display rule");
assert.match(economyStyles, /\.sponsorship-request-form \.sponsorship-actions > button\s*\{\s*min-height: 52px/, "request funding keeps a touch-friendly primary action");

assert.deepEqual(sponsorshipRequestPayload(21), { tileIndex: 21 }, "gift request retains its original payload");
assert.deepEqual(sponsorshipRequestPayload(21, "equity", 25, "request-equity-1"), {
  tileIndex: 21,
  mode: "equity",
  sharePct: 25,
  requestId: "request-equity-1",
  durationRounds: 3,
});
assert.deepEqual(sponsorshipRequestPayload(21, "equity", 200, "request-equity-2"), {
  tileIndex: 21,
  mode: "equity",
  sharePct: 100,
  requestId: "request-equity-2",
  durationRounds: 3,
});

const equity = { mode: "equity", requestId: "flow-1" };
assert.deepEqual(sponsorshipContributionPayload(125.8, equity), { amount: 125, requestId: "flow-1" });
assert.deepEqual(sponsorshipFlowPayload(equity), { requestId: "flow-1" });
assert.deepEqual(sponsorshipContributionPayload(125, { mode: "gift", requestId: "legacy-flow" }), { amount: 125 });
assert.deepEqual(sponsorshipFlowPayload({ mode: "gift", requestId: "legacy-flow" }), {});

assert.deepEqual(sponsorshipContributionPayload(50, equity, "attempt-1"), { amount: 50, requestId: "flow-1", contributionId: "attempt-1" });
assert.deepEqual(sponsorshipContributionPayload(50, { mode: "gift" }, "attempt-2"), { amount: 50, contributionId: "attempt-2" });

let attemptSeq = 0;
const attempts = createContributionAttemptTracker(() => `attempt-${++attemptSeq}`);
const sponsorship = { id: "sp-1", mode: "equity", requestId: "flow-1" };
const firstAttempt = attempts.idFor(sponsorship, 50);
assert.equal(attempts.idFor(sponsorship, 50), firstAttempt, "a resend of the same attempt reuses its id");
assert.notEqual(attempts.idFor(sponsorship, 25), firstAttempt, "a different amount is a new attempt");
const secondAttempt = attempts.idFor(sponsorship, 50);
attempts.settle();
assert.notEqual(attempts.idFor(sponsorship, 50), secondAttempt, "a confirmed contribution releases the id for the next top-up");
const otherSponsorshipId = attempts.idFor({ id: "sp-2", requestId: "flow-1" }, 50);
assert.equal(attempts.idFor({ id: "sp-2", requestId: "flow-1" }, 50), otherSponsorshipId, "the tracker keys on the sponsorship id, not only the request id");
assert.notEqual(attempts.idFor(sponsorship, 50), otherSponsorshipId, "a different sponsorship never reuses the id");

assert.deepEqual(sponsorshipAudienceNames([
  { id: "p1", serverId: "seat-buyer", name: "BUYER" },
  { id: "p2", serverId: "seat-beta", name: "BETA" },
  { id: "p3", serverId: "seat-gamma", name: "GAMMA" },
  { id: "p4", serverId: "seat-bankrupt", name: "BANKRUPT", bankrupt: true },
  { id: "p5", serverId: "seat-spectator", name: "SPECTATOR", spectating: true },
  { id: "p6", serverId: "seat-offline", name: "OFFLINE", online: false },
], "seat-buyer"), ["BETA", "GAMMA"], "funding requests list every other active player and exclude the buyer");
assert.equal(sponsorshipFundingSummary("gift", 10), "GIFT FUNDING · NO OWNERSHIP OR RENT SHARE");
assert.equal(sponsorshipFundingSummary("equity", 25), "RENT SHARE · 25% OF COLLECTED RENT · 3 ROUNDS");

const gate = createSponsorshipActionGate();
assert.equal(gate.begin("flow-1"), true, "first accept/cancel/contribute operation may start");
assert.equal(gate.begin("flow-1"), false, "the same in-flight request cannot be emitted twice");
gate.complete("flow-1");
assert.equal(gate.begin("flow-1"), true, "a rejected action may be retried");
gate.clear();
assert.equal(gate.begin("flow-1"), true, "a confirmed snapshot releases the gate for the next flow state");

console.log("client sponsorship UI tests: passed");

assert.equal(sponsorshipRequestPayload(5, "equity", 25, "term", 50).durationRounds, 20);
assert.equal(sponsorshipRequestPayload(12, "equity", 25, "term", -1).durationRounds, 1);

const { state } = await import("./clientState.js");
const fundingCard = { innerHTML: "", querySelector: () => null };
globalThis.HTMLElement = class {};
globalThis.document = { querySelector: selector => selector === "#sponsorship-card" ? fundingCard : null, querySelectorAll: () => [] };
state.phase = "playing";
state.settings = { ...state.settings, playerFinance: true };
for (const localId of ["buyer", "investor", "other"]) {
  state.players = [{ serverId: localId, cash: 1000 }];
  openSponsorshipModal({ mode: "equity", buyerId: "buyer", buyerName: "BUYER", tileIndex: 1, tileName: "SALVADOR", price: 60, totalContributed: 20, amountNeeded: 40, sharePct: 25, durationRounds: 3, contributions: [{ sponsorId: "investor", amount: 20 }] });
  const copy = fundingCard.innerHTML.match(/sponsorship-copy">([^<]+)</)?.[1] || "";
  assert.ok(copy.trim().split(/\s+/).length <= 15, `${localId} funding instructions stay brief`);
  assert.doesNotMatch(copy, /collected rent/, "the funding summary already states the share terms");
  assert.equal((fundingCard.innerHTML.match(/Collected rent only/g) || []).length, 1);
}
console.log("PASS funding risks stay concise for buyer, investor and other players");
