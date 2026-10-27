import assert from "node:assert/strict";

globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
globalThis.document = { querySelector: () => null };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.requestAnimationFrame = () => 0;
const { state } = await import("./clientState.js");
const { renderSocialSurface } = await import("./clientSocialSurfaces.js");

function render(id) {
  const guest = {};
  const card = { id, innerHTML: "", querySelector: selector => selector === "[data-social-guest-content]" ? guest : null };
  document.querySelector = () => card;
  renderSocialSurface(`#${id}`);
  return { html: card.innerHTML, inert: guest.inert };
}

state.phase = "playing";
state.roomCode = "TABLE1";
state.players = [{ id: "p1" }, { id: "p2", serverId: "nearby-2", name: "Nearby", username: "nearby" }];
state.account = { account: { id: "account-1" } };
state.social = { friends: [], requests: [{ id: "request-1", from: { id: "sender-1", username: "sender", displayName: "Sender" } }] };
state.socialTab = "requests";
const modal = render("social-card");
const page = render("social-page-content");

assert.match(modal.html, /social-hero[\s\S]*People who keep the table moving/);
assert.match(modal.html, /social-hero-stats/);
assert.match(modal.html, /id="social-close"/);
assert.match(modal.html, /social-network-rail/);
assert.match(modal.html, /social-context panel/);
assert.match(modal.html, /People nearby/);
assert.match(page.html, /social-hero[\s\S]*People who keep the table moving/);
assert.match(page.html, /social-network-rail/);
assert.doesNotMatch(page.html, /social-table-header|social-table-roster|BACK TO TABLE/);
assert.doesNotMatch(modal.html, /social-table-header|social-table-roster/);
assert.match(modal.html, /data-social-player="nearby-2"/);
assert.match(modal.html, /Cash, loans, and hidden match details stay private/);
for (const tab of ["friends", "requests", "invites", "recent", "notifications"]) {
  assert.match(modal.html, new RegExp(`data-social-tab="${tab}"`));
}
assert.match(modal.html, /social-feed panel noise" tabindex="0"/);
assert.match(modal.html, /data-social-search-form[\s\S]*data-social-search-input/);
assert.match(modal.html, /data-social-request="accept" data-friendship-id="request-1"/);
assert.match(modal.html, /data-social-request="decline" data-friendship-id="request-1"/);
assert.equal(modal.inert, false);
state.account = null;
const guest = render("social-card");
assert.match(guest.html, /data-social-guest-gate/);
assert.match(guest.html, /data-social-action="account"/);
assert.equal(guest.inert, true);
console.log("PASS full table Social restores hero, vertical network, feed and table context with account gate");

// Live replacement keeps public player focus local without stealing outside focus.
document.body = {};
document.activeElement = document.body;
const card = {
  id: "social-card", html: "", players: [],
  contains(node) { return this.players.includes(node) || node === this.feed; },
  querySelector(selector) { return selector === ".social-feed" ? this.feed : null; },
  querySelectorAll(selector) { return selector === "[data-social-player]" ? this.players : []; },
  get innerHTML() { return this.html; },
  set innerHTML(html) {
    if (this.contains(document.activeElement)) document.activeElement = document.body;
    this.html = html;
    this.feed = { focus() { document.activeElement = this; } };
    this.players = [...html.matchAll(/data-social-player="([^"]+)"/g)].map(match => {
      const element = { dataset: { socialPlayer: match[1] }, focus() { document.activeElement = this; }, closest: selector => selector === "[data-social-player]" ? element : null };
      return element;
    });
  },
};
document.querySelector = () => card;
state.socialTab = "friends";
state.social = { friends: [] };
state.account = { account: { id: "account-1" } };
renderSocialSurface();
card.players[0].focus();
renderSocialSurface();
assert.equal(document.activeElement, card.players[0], "public player focus follows the same player ID");
const outside = { id: "outside" };
document.activeElement = outside;
renderSocialSurface();
assert.equal(document.activeElement, outside, "refresh does not steal outside focus");
card.players[0].focus();
state.players = [{ id: "p1" }];
renderSocialSurface();
assert.equal(document.activeElement, card.feed, "a departed player's focus returns to the feed");
console.log("PASS full Social preserves local public-player focus through live replacement");
