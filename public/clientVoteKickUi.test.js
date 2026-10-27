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
assert.match(container.innerHTML, /If passed, this player leaves this room/);
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
assert.match(container.innerHTML, /If passed, removes this player/);
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

// 'closed' wire status: show the server's sentence politely, then clear.
{
  const closedHost = { hidden: true, innerHTML: "", addEventListener() {}, removeEventListener() {} };
  const timers = [];
  const closedUi = createVoteKickUi({ container: closedHost, schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, cancel() {}, now: () => 1000 });
  closedUi.update({ voteId: "vc", targetPlayerId: "room-target", expiresAt: 31_000, status: "closed", summary: "Juno left; vote closed." }, players, 1000);
  assert.match(closedHost.innerHTML, /Juno left; vote closed\./);
  assert.match(closedHost.innerHTML, /aria-live="polite"/);
  assert.doesNotMatch(closedHost.innerHTML, /data-votekick-choice/);
  timers.filter(timer => timer.ms === 8000).pop().fn();
  assert.equal(closedHost.hidden, true);
}

// ---- behaviour: keyed pending choice, rejection text, ineligible seats,
// text-node patching and closed-vote clearing (F-061 / F-062) ----
function richHost() {
  const listeners = new Map();
  const host = {
    hidden: true,
    sets: 0,
    nodes: {},
    buttons: [],
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    querySelector(selector) { return this.nodes[selector] || null; },
    querySelectorAll() { return this.buttons; },
    click(selector, attrs = {}) {
      const target = { closest: wanted => (wanted === selector ? { disabled: false, dataset: attrs } : null) };
      listeners.get("click")({ target });
    },
    get innerHTML() { return this._html || ""; },
    set innerHTML(html) {
      this._html = html;
      this.sets += 1;
      this.nodes = {};
      for (const name of ["expiry", "yes", "no", "needed", "consequence", "note", "status"]) {
        const match = html.match(new RegExp(`<\\w+[^>]*data-votekick-${name}[^>]*>([^<]*)`));
        if (match) this.nodes[`[data-votekick-${name}]`] = { textContent: match[1], setAttribute() {}, focus() {} };
      }
      if (/data-votekick-progress/.test(html)) this.nodes["[data-votekick-progress]"] = { setAttribute() {}, querySelector: () => ({ style: {} }) };
      this.buttons = [...html.matchAll(/<button[^>]*data-votekick-choice="(yes|no)"([^>]*)>/g)]
        .map(match => ({ choice: match[1], disabled: /disabled/.test(match[0]) }));
    },
  };
  return host;
}
function richUi(host, { ack, localId = "seat-me" } = {}) {
  const timers = [];
  const emits = [];
  const ui = createVoteKickUi({
    container: host,
    emit: (event, payload, cb) => { emits.push({ event, payload }); if (ack) cb(ack(event, payload)); },
    createRequestId: () => "rq",
    now: () => 1000,
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    cancel: () => {},
  });
  const seats = [
    { id: "p1", serverId: localId, name: "Marlow" },
    { id: "p2", serverId: "seat-target", name: "Juno" },
    { id: "p3", serverId: "seat-pip", name: "Pip" },
  ];
  return { ui, emits, timers, seats };
}
const noteText = host => host.nodes["[data-votekick-note]"]?.textContent ?? "";
const openVote = (voteId, extra = {}) => ({
  voteId, targetPlayerId: "seat-target", openedAt: 1000, expiresAt: 31_000, eligibleCount: 2, yesCount: 1, noCount: 0, requiredYes: 2, status: "open", ...extra,
});

{
  // A rejected ballot shows the server's reason in the panel, in plain words.
  const host = richHost();
  const { ui, seats } = richUi(host, { ack: () => ({ success: false, error: "ineligible-voter" }) });
  ui.update(openVote("v1"), seats, 1000);
  host.click("[data-votekick-choice]", { votekickChoice: "yes" });
  assert.match(noteText(host), /You can.t vote on this one\./);
  assert.doesNotMatch(noteText(host), /ineligible-voter/);
  assert.ok(host.buttons.every(button => button.disabled), "ineligible seats get disabled ballot buttons");
  // The rejection survives the one-second tick.
  ui.update(openVote("v1"), seats, 1000);
  assert.match(noteText(host), /You can.t vote on this one\./);
}
{
  // An already-voted rejection shows text and locks the buttons for that vote only.
  const host = richHost();
  const { ui, seats } = richUi(host, { ack: () => ({ success: false, error: "already-voted" }) });
  ui.update(openVote("v1"), seats, 1000);
  host.click("[data-votekick-choice]", { votekickChoice: "no" });
  assert.match(noteText(host), /You already voted on this one\./);
  assert.ok(host.buttons.every(button => button.disabled));
  ui.update(openVote("v2"), seats, 1000);
  assert.ok(host.buttons.every(button => !button.disabled), "a new vote resets the buttons and the rejection");
  assert.doesNotMatch(noteText(host), /already voted/);
}
{
  // A pending ballot belongs to its vote: a new vote is never blocked by it.
  const host = richHost();
  const { ui, emits, seats } = richUi(host);
  ui.update(openVote("v1"), seats, 1000);
  host.click("[data-votekick-choice]", { votekickChoice: "yes" });
  assert.equal(emits.length, 1);
  host.click("[data-votekick-choice]", { votekickChoice: "yes" });
  assert.equal(emits.length, 1, "no double submit while pending");
  ui.update(openVote("v2"), seats, 1000);
  host.click("[data-votekick-choice]", { votekickChoice: "no" });
  assert.equal(emits.length, 2, "a new voteId resets the pending choice");
  assert.equal(emits[1].payload.voteId, "v2");
}
{
  // The target seat cannot vote; the starter already counts as YES.
  const host = richHost();
  const { ui, seats } = richUi(host, { localId: "seat-target" });
  ui.update(openVote("v1"), seats, 1000);
  assert.doesNotMatch(host.innerHTML, /data-votekick-choice/);
  assert.match(host.innerHTML, /about you/);
  const starter = richHost();
  const second = richUi(starter, { ack: event => (event === "room-votekick-start" ? { success: true, vote: { voteId: "v9" } } : { success: true }) });
  second.ui.requestStart("seat-target", second.seats);
  starter.click("[data-votekick-action]", { votekickAction: "start" });
  second.ui.update(openVote("v9"), second.seats, 1000);
  assert.match(noteText(starter), /You voted YES\./);
  assert.ok(starter.buttons.every(button => button.disabled), "the starter's auto-YES disables the buttons");
}
{
  // Ticks patch text nodes instead of rebuilding the panel.
  const host = richHost();
  const { ui, seats } = richUi(host);
  ui.update(openVote("v1"), seats, 1000);
  const before = host.sets;
  const expiry = host.nodes["[data-votekick-expiry]"];
  ui.update(openVote("v1", { yesCount: 2 }), seats, 3000);
  ui.update(openVote("v1", { yesCount: 2 }), seats, 4000);
  assert.equal(host.sets, before, "same open vote must not re-render innerHTML");
  assert.equal(host.nodes["[data-votekick-expiry]"], expiry, "text nodes are reused");
  assert.equal(host.nodes["[data-votekick-yes]"].textContent, "2");
  assert.equal(expiry.textContent, "27s");
}
{
  // A closed vote is announced, then cleared; it stays cleared on later syncs.
  const host = richHost();
  const { ui, timers, seats } = richUi(host);
  ui.update(openVote("v1"), seats, 1000);
  ui.update(openVote("v1", { status: "failed" }), seats, 1000);
  assert.match(host.innerHTML, /Vote closed without removing the player/);
  const closer = timers.filter(timer => timer.ms === 8000).pop();
  assert.ok(closer, "closed votes schedule their own removal");
  closer.fn();
  assert.equal(host.hidden, true);
  assert.equal(host.innerHTML, "");
  ui.update(openVote("v1", { status: "failed" }), seats, 2000);
  assert.equal(host.innerHTML, "", "the same closed vote does not come back");
  ui.update(openVote("v2"), seats, 2000);
  assert.match(host.innerHTML, /data-votekick-choice="yes"/, "a new vote shows again");
}
{
  // The dismiss button clears a closed vote at once.
  const host = richHost();
  const { ui, seats } = richUi(host);
  ui.update(openVote("v1", { status: "passed" }), seats, 1000);
  assert.match(host.innerHTML, /data-votekick-action="dismiss"/);
  host.click("[data-votekick-action]", { votekickAction: "dismiss" });
  assert.equal(host.innerHTML, "");
}

console.log("client vote-kick UI tests: passed");
