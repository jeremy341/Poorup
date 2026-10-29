import assert from "node:assert/strict";

globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.requestAnimationFrame = () => {};
const timers = new Map();
let nextTimer = 0;
globalThis.setTimeout = callback => { timers.set(++nextTimer, callback); return nextTimer; };
globalThis.clearTimeout = id => timers.delete(id);
const nodes = new Map();
function surface(id) {
  const node = { id, innerHTML: "", listeners: {}, querySelector: () => null, addEventListener(event, callback) { this.listeners[event] = callback; } };
  nodes.set(`#${id}`, node);
  return node;
}
const page = surface("social-page-content");
const modal = surface("social-card");
globalThis.document = { querySelector: selector => nodes.get(selector) || null };
const { state } = await import("./clientState.js");
const surfaces = await import("./clientSocialSurfaces.js");
const { bindParlorSurfaces } = await import("./clientParlorBindings.js");
const { beginAccountAuthTransition } = await import("./clientAccountIdentity.js");
const calls = [];
const emitServer = (event, payload, ack) => calls.push({ event, payload, ack });
surfaces.configureSocialSurfaces({ emitServer });
bindParlorSurfaces({ emitServer });
state.account = { account: { id: "me" } };
state.socialTab = "requests";
state.phase = "home";
const player = { id: "friend", username: "friend", displayName: "A Friend" };
function resetRows() { state.social = { requests: [{ id: "in", from: player }], outgoing: [{ id: "out", to: player }] }; }
function click(target, id, action) {
  const cancel = action === "cancel";
  const selector = cancel ? "[data-social-request-cancel]" : "[data-social-request]";
  const label = { textContent: action };
  const button = { disabled: false, dataset: { friendshipId: id, ...(cancel ? {} : { socialRequest: action }) }, querySelector: () => label, setAttribute() {}, removeAttribute() {}, closest: query => query === "#social-page-content" && target === page ? page : null };
  target.listeners.click({ currentTarget: target, target: { closest: query => query === selector ? button : null } });
}
resetRows();
click(page, "in", "accept");
click(page, "in", "accept");
click(modal, "in", "decline");
assert.equal(calls.length, 1, "one friendship locks both actions across both surfaces, including replacement DOM");
assert.deepEqual(calls[0].payload, { friendshipId: "in", accept: true });
assert.match(page.innerHTML, /data-friendship-id="in" disabled aria-busy="true"/);
assert.match(modal.innerHTML, /data-friendship-id="in" disabled aria-busy="true"/);
state.account = { account: { id: "me", displayName: "Refreshed appearance" } };
calls[0].ack({ success: false, error: "Try later" });
click(modal, "in", "decline");
assert.equal(calls.length, 2, "failure permits a retry from either surface");
assert.deepEqual(calls[1].payload, { friendshipId: "in", accept: false });
calls[1].ack({ success: true });
assert.equal(state.social.requests.length, 0);
assert.doesNotMatch(page.innerHTML, /data-friendship-id="in"/);
assert.doesNotMatch(modal.innerHTML, /data-friendship-id="in"/);
assert.equal(calls[2].event, "get-social-data");
state.account = { account: { id: "me", displayName: "Another refresh" } };
calls[2].ack({ success: true, social: state.social });
assert.equal(state.socialLoading, false, "same-account wrapper refresh accepts the fetch acknowledgement");
click(page, "out", "cancel");
assert.equal(calls[3].event, "cancel-friend-request");
assert.deepEqual(calls[3].payload, { friendshipId: "out" });
calls[3].ack({ success: true });
assert.equal(state.social.outgoing.length, 0);
calls[4].ack({ success: true, social: state.social });

resetRows();
click(page, "in", "accept");
const late = calls.at(-1);
const timeout = [...timers.values()].at(-1);
timeout();
click(modal, "in", "decline");
assert.equal(calls.at(-1).payload.accept, false, "timeout permits retry");
late.ack({ success: true });
assert.equal(state.social.requests.length, 1, "late acknowledgement cannot finish the newer action");
calls.at(-1).ack({ success: false });

click(page, "in", "accept");
const previousSession = calls.at(-1);
beginAccountAuthTransition();
state.account = { account: { id: "me" } };
previousSession.ack({ success: true });
assert.equal(state.social.requests.length, 1, "auth transition invalidates pending action effects even for the same account");
state.account = { account: { id: "other" } };
click(page, "in", "accept");
calls.at(-1).ack({ success: true });
const previousFetch = calls.at(-1);
state.account = null;
state.social = {};
previousFetch.ack({ success: true, social: { requests: [{ id: "private" }] } });
assert.deepEqual(state.social, {}, "refresh cannot restore another session's private relationship data");

// A small DOM model exercises synchronous replacement and keyboard focus.
document.body = {};
document.activeElement = document.body;
page.actions = [];
page.contains = node => page.actions.includes(node) || node === page.feed;
page.querySelector = selector => selector === ".social-feed" ? page.feed : null;
page.querySelectorAll = () => page.actions;
Object.defineProperty(page, "innerHTML", {
  get() { return this.html; },
  set(html) {
    if (this.contains(document.activeElement)) document.activeElement = document.body;
    this.html = html;
    this.feed = { matches: selector => selector === ".social-feed", focus() { document.activeElement = this; } };
    this.actions = [...html.matchAll(/<button[^>]*data-(?:social-request="(accept|decline)"|social-request-cancel)[^>]*data-friendship-id="([^"]+)"[^>]*>/g)].map(match => {
      const node = { dataset: { friendshipId: match[2], socialRequest: match[1] }, disabled: / disabled/.test(match[0]), hasAttribute: name => name === "data-social-request-cancel" && !match[1], focus() { document.activeElement = this; } };
      node.closest = selector => selector === ".social-request-row" ? { contains: active => active === node } : selector === "#social-page-content" ? page : null;
      return node;
    });
  },
});
state.account = { account: { id: "keyboard" } };
resetRows();
surfaces.renderSocialSurface("#social-page-content");
function keyboardAccept() {
  const button = page.actions.find(node => node.dataset.socialRequest === "accept");
  button.focus();
  page.listeners.click({ currentTarget: page, target: { closest: selector => selector === "[data-social-request]" ? button : null } });
}
keyboardAccept();
assert.equal(document.activeElement, page.feed, "pending replacement focuses the stable feed");
calls.at(-1).ack({ success: false });
assert.equal(document.activeElement.dataset.socialRequest, "accept", "failure restores the original action");
keyboardAccept();
[...timers.values()].at(-1)();
assert.equal(document.activeElement.dataset.socialRequest, "accept", "timeout restores the original action");
keyboardAccept();
const outside = { id: "outside" };
document.activeElement = outside;
calls.at(-1).ack({ success: false });
assert.equal(document.activeElement, outside, "failure never steals focus moved elsewhere");
keyboardAccept();
calls.at(-1).ack({ success: true });
assert.equal(document.activeElement.dataset.friendshipId, "out", "success focuses the next request before refreshing");
calls.at(-1).ack({ success: true, social: state.social });
assert.equal(document.activeElement.dataset.friendshipId, "out", "refresh preserves request focus");
console.log("friend request actions: conflicts, payloads, retry, timeout, cancellation and session guards passed");
