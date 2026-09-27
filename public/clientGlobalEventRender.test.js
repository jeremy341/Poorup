import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
const renderer = await import("./clientGlobalEventRender.js");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error });
  }
}

function expectMatch(source, pattern, description) {
  assert.ok(pattern.test(source), description || `Expected pattern ${pattern}`);
}

const event = (overrides = {}) => ({
  id: "city-election",
  category: "CIVIC",
  title: "CITY ELECTION",
  phase: "voting",
  voteRound: 4,
  startedRound: null,
  roundsRemaining: 0,
  choices: [{ id: "lower-tax", label: "LOWER TAX" }],
  ...overrides,
});

function observe(state, nextEvent, roomCode = "ROOM1", gameStarted = true) {
  assert.equal(typeof renderer.observeGlobalEventAnnouncement, "function", "announcement lifecycle helper must be exported");
  return renderer.observeGlobalEventAnnouncement(state, nextEvent, { roomCode, gameStarted });
}

check("announcesFirstObservedVotingOrWarningEventOnce", () => {
  const state = { lastAnnouncedGlobalEventKey: "" };
  const result = observe(state, event());
  assert.equal(result.announce, true);
  assert.equal(state.lastAnnouncedGlobalEventKey, JSON.stringify(["ROOM1", "city-election", 4]));
});

check("repeatRenderAndReconnectDoNotReplayAnnouncement", () => {
  const state = { lastAnnouncedGlobalEventKey: "" };
  assert.equal(observe(state, event()).announce, true);
  assert.equal(observe(state, event()).announce, false);
  assert.equal(observe(state, event(), "ROOM1", true).announce, false);
});

check("newEventIdentityAnnouncesAgain", () => {
  const state = { lastAnnouncedGlobalEventKey: "" };
  assert.equal(observe(state, event()).announce, true);
  assert.equal(observe(state, event({ id: "tax-audit", startedRound: 5, voteRound: null })).announce, true);
  assert.equal(observe(state, event({ id: "tax-audit", startedRound: 5, voteRound: null }), "ROOM2", true).announce, true);
  observe(state, null, "ROOM2", false);
  assert.equal(observe(state, event({ id: "tax-audit", startedRound: 5, voteRound: null }), "ROOM2", true).announce, true);
});

check("activeAndRecoveryTransitionsDoNotReplay", () => {
  const state = { lastAnnouncedGlobalEventKey: "" };
  assert.equal(observe(state, event()).announce, true);
  assert.equal(observe(state, event({ phase: "active", startedRound: 5 })).announce, false);
  assert.equal(observe(state, event({ phase: "recovery", startedRound: 5 })).announce, false);
});

check("votingAndCollapseRemainOperable", () => {
  expectMatch(html, /id="global-event-banner"[^>]*aria-labelledby="global-event-title"/, "persistent banner landmark is missing");
  expectMatch(html, /id="global-event-toggle"[^>]*type="button"[^>]*aria-expanded="true"[^>]*aria-controls="global-event-body-wrap"/, "event detail toggle is not a named native control");
  expectMatch(html, /<button(?=[^>]*id="global-event-compact-vote")(?=[^>]*type="button")(?=[^>]*aria-expanded="false")(?=[^>]*aria-controls="global-event-body-wrap")[^>]*>/, "collapsed vote expander is not a native control");
  expectMatch(html, /id="global-event-choices"/, "vote choices were removed");
  expectMatch(html, /id="global-event-compact-rounds"/, "collapsed status omits remaining duration");
  expectMatch(styles, /\.global-event-choice:focus-visible\s*\{/, "vote choice focus treatment is missing");
  expectMatch(styles, /\.global-event-toggle:focus-visible\s*\{/, "event toggle focus treatment is missing");
});

check("reducedMotionRendersStaticEquivalent", () => {
  expectMatch(html, /id="global-event-ribbon"[^>]*aria-hidden="true"/, "decorative ribbon is not hidden from assistive technology");
  expectMatch(html, /id="global-event-announcer"[^>]*role="status"[^>]*aria-live="polite"/, "dedicated concise live status is missing");
  expectMatch(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.global-event-ribbon[^}]*animation:\s*none/i, "reduced motion does not disable ribbon movement");
  expectMatch(styles, /\.global-event-ribbon\.is-visible/, "ribbon visible state is missing");
  assert.doesNotMatch(styles, /\.global-event-compact-vote\s*\{[^}]*animation:/i, "collapsed vote status must not pulse");
  expectMatch(styles, /@media\s*\(forced-colors:\s*active\)[\s\S]*?\.global-event-ribbon,[\s\S]*?background:\s*Canvas/i, "forced-colors solid fallback is missing");
});

check("announcementDoesNotCoverHeaderBoardOrActions", () => {
  expectMatch(html, /<div class="center-field noise" id="center-field">[\s\S]*?id="global-event-ribbon"[\s\S]*?<\/div>/, "ribbon is not contained in the board center field");
  expectMatch(styles, /\.global-event-ribbon\s*\{[^}]*position:\s*absolute/i, "ribbon is not anchored to the game field");
  expectMatch(styles, /\.global-event-ribbon\s*\{[^}]*pointer-events:\s*none/i, "announcement ribbon can intercept game actions");
  expectMatch(styles, /\.global-event-banner\s*\{[^}]*position:\s*absolute/i, "persistent banner reflows the game shell");
});

const failures = checks.filter(result => !result.ok);
checks.forEach(result => {
  if (result.ok) console.log(`PASS - ${result.name}`);
  else console.error(`FAIL - ${result.name}: ${result.error.message}`);
});
console.log(`client global event tests: ${checks.length - failures.length} passed, ${failures.length} failed`);
if (failures.length) throw failures[0].error;
