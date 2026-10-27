import assert from "node:assert/strict";

/* Behaviour tests for lane U1a: key gates, focus return, auction surface
   snoozing and bankruptcy inert handling. Executes the real modules against
   a small DOM stub. */

class FakeClassList {
  constructor(el, names) { this.el = el; this.names = new Set(names); }
  contains(name) { return this.names.has(name); }
  add(name) { this.names.add(name); }
  remove(name) { this.names.delete(name); }
  toggle(name, force) {
    const next = force === undefined ? !this.names.has(name) : force;
    if (next) this.names.add(name); else this.names.delete(name);
    return next;
  }
}

class FakeElement {
  constructor(id, { classes = [], tag = "div", hidden = false } = {}) {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.classList = new FakeClassList(this, hidden ? [...classes, "is-hidden"] : classes);
    this.attributes = {};
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
    this.disabled = false;
    this.inert = false;
    this.dataset = {};
    this.isContentEditable = false;
    this.handlers = {};
    this.textContent = "";
    this.style = {};
  }
  addEventListener(name, handler) { (this.handlers[name] ||= []).push(handler); }
  click() { (this.handlers.click || []).forEach((handler) => handler({ currentTarget: this, target: this })); this.onclick?.({ currentTarget: this, target: this }); }
  set innerHTML(html) {
    this.html = String(html);
    this.children = [];
    for (const match of this.html.matchAll(/<(button|div|h3|p|span)[^>]*?id="([^"]+)"/g)) {
      this.append(new FakeElement(match[2], { tag: match[1] }));
    }
    for (const match of this.html.matchAll(/<button[^>]*?data-bid="(\d+)"/g)) {
      const bid = this.append(new FakeElement("", { tag: "button" }));
      bid.dataset.bid = match[1];
    }
  }
  get innerHTML() { return this.html || ""; }
  replaceChildren() {}
  append(child) { child.parentElement = this; this.children.push(child); return child; }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelector(selector) {
    if (selector.startsWith("#")) return this.descendants().find((el) => el.id === selector.slice(1)) || null;
    return null;
  }
  querySelectorAll(selector) {
    if (selector === "[data-bid]") return this.descendants().filter((el) => el.dataset.bid !== undefined);
    if (selector.startsWith("button:not([disabled])")) {
      return this.descendants().filter((el) => el.tagName === "BUTTON" && !el.disabled);
    }
    return [];
  }
  closest(selector) {
    if (selector === "[data-bid]") return this.dataset.bid !== undefined ? this : null;
    if (/button/.test(selector) && this.tagName === "BUTTON") return this;
    return null;
  }
  focus() { globalThis.document.activeElement = this; }
}

const registry = new Map();
const views = [];
function surface(id, ...buttonIds) {
  const el = new FakeElement(id, { hidden: true });
  buttonIds.forEach((buttonId) => el.append(new FakeElement(buttonId, { tag: "button" })));
  registry.set(`#${id}`, el);
  return el;
}

const body = new FakeElement("body", { tag: "body" });
const viewGame = new FakeElement("view-game", { classes: ["view"] });
const viewHome = new FakeElement("view-home", { classes: ["view", "is-hidden"] });
viewHome.classList.add("is-hidden");
views.push(viewGame, viewHome);
registry.set("#view-game", viewGame);
registry.set("#view-home", viewHome);
const rollBtn = new FakeElement("roll-btn", { tag: "button" });
viewGame.append(rollBtn);
registry.set("#roll-btn", rollBtn);
registry.set("#night-shift", new FakeElement("night-shift", { hidden: true }));
const auctionModal = surface("auction-modal", "auction-close", "auction-bid-1");
const bankLoanModal = surface("bank-loan-modal", "bank-loan-cancel", "bank-loan-confirm");
const bankruptcyModal = surface("bankruptcy-modal", "bank-liquidate", "bank-declare", "bank-declare-cancel");
const confirmModal = surface("confirm-modal", "confirm-cancel", "confirm-accept");
confirmModal.append(new FakeElement("confirm-card"));
registry.set("#confirm-card", confirmModal.children.at(-1));
const auctionCard = auctionModal.append(new FakeElement("auction-card"));
registry.set("#auction-card", auctionCard);
const bankruptcyCard = bankruptcyModal.append(new FakeElement("bankruptcy-card"));
registry.set("#bankruptcy-card", bankruptcyCard);
const bankActions = bankruptcyCard.append(new FakeElement("bank-actions-box"));
registry.set("#bankruptcy-modal .bank-actions", bankActions);
const choiceModal = surface("choice-modal");
registry.set("#choice-card", choiceModal.append(new FakeElement("choice-card")));
const offerModal = surface("offer-modal");
registry.set("#offer-card", offerModal.append(new FakeElement("offer-card")));
const gameoverModal = surface("gameover-modal");
registry.set("#gameover-card", gameoverModal.append(new FakeElement("gameover-card")));
[auctionModal, bankLoanModal, bankruptcyModal, confirmModal, choiceModal, offerModal, gameoverModal].forEach((el) => body.append(el));
body.append(viewGame);
body.append(viewHome);

const dummies = new Map();
const listeners = {};
globalThis.window = {
  matchMedia: () => ({ matches: false }),
  addEventListener: (name, handler) => { listeners[name] = handler; },
};
globalThis.document = {
  activeElement: body,
  body,
  querySelector: (selector) => {
    if (registry.has(selector)) return registry.get(selector);
    const found = /^#[\w-]+$/.test(selector) ? body.descendants().find((el) => `#${el.id}` === selector) : null;
    if (found) return found;
    if (!dummies.has(selector)) dummies.set(selector, new FakeElement(selector.slice(1), { hidden: true }));
    return dummies.get(selector);
  },
  querySelectorAll: (selector) => (selector === ".view" ? views : []),
  contains: (node) => body.contains(node),
};
globalThis.HTMLElement = FakeElement;
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { state } = await import("./clientState.js");
const surfaces = await import("./clientSurfaces.js");
const { bindKeyboard } = await import("./clientKeyboard.js");

const calls = [];
const FALSE_HOOKS = new Set(["isPanelMenuOpen", "isNightShiftActive"]);
bindKeyboard(new Proxy({}, { get: (_t, name) => (...args) => { calls.push(String(name)); return FALSE_HOOKS.has(name) ? false : args; } }));
function press(key, { target = body, code = key } = {}) {
  const event = { key, code, target, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  listeners.keydown(event);
  return event;
}
function reset() {
  surfaces.closeAllSurfaces();
  calls.length = 0;
  document.activeElement = body;
  state.auction = null;
  state.pendingDebt = null;
  state.phase = "playing";
  state.pendingBuyTile = null;
  state.sponsorship = null;
}
const hidden = (el) => el.classList.contains("is-hidden");

state.phase = "playing";
state.players = [{ id: "p1", serverId: "s1", cash: 1500 }];

/* F-008: an auction whose modal is closed must not swallow Space/R. */
reset();
state.auction = { id: "t5:1", tileIndex: 5, active: true, bid: 0, deadline: Date.now() + 5000 };
press(" ", { code: "Space" });
assert.deepEqual(calls, ["primaryTurnAction"], "Space reaches the HUD primary action while the auction modal is closed");
calls.length = 0;
press("r");
assert.deepEqual(calls, ["primaryTurnAction"], "R reaches the HUD primary action while the auction modal is closed");

/* ...but with the modal actually open, nothing leaks through. */
calls.length = 0;
surfaces.openSurface("#auction-modal", "#auction-close");
press(" ", { code: "Space" });
press("r");
assert.deepEqual(calls, [], "Space/R are consumed while the auction modal is open");

/* F-007: a live auction is truthful, so Escape confirms and then snoozes. */
state.auction = { id: "t5:1", tileIndex: 5, active: true };
assert.equal(surfaces.shouldConfirmSurfaceClose("#auction-modal"), true);
assert.equal(surfaces.hasUnresolvedSurfaceDecision(), true);

/* F-009: Escape goes through the same CLOSE path as the CLOSE button, asks
   before leaving a live auction, and returns focus to the HUD action. */
reset();
state.auction = { id: "t5:1", tileIndex: 5, active: true };
rollBtn.focus();
surfaces.openSurface("#auction-modal", "#auction-close");
assert.equal(document.activeElement.id, "auction-close");
const escape = press("Escape");
assert.equal(escape.defaultPrevented, true);
assert.equal(hidden(confirmModal), false, "Escape on a live auction asks before leaving");
assert.equal(hidden(auctionModal), false);
surfaces.closeConfirmModal();
assert.equal(hidden(auctionModal), false, "cancelling the confirm keeps the auction open");
surfaces.closeSurface("#auction-modal", { force: true });
assert.equal(hidden(auctionModal), true);
assert.equal(document.activeElement, rollBtn, "closing the auction returns focus to the invoker / HUD action");

/* Focus falls back to the HUD primary action when the invoker was <body>. */
reset();
surfaces.openSurface("#bank-loan-modal", "#bank-loan-cancel");
assert.equal(document.activeElement.id, "bank-loan-cancel");
surfaces.closeSurface("#bank-loan-modal");
assert.equal(document.activeElement, rollBtn, "no invoker: focus lands on the HUD primary action, not <body>");

/* A remembered invoker that has since been hidden is not a focus target. */
reset();
const hiddenInvoker = body.append(new FakeElement("stale-invoker", { tag: "button" }));
hiddenInvoker.getClientRects = () => [];
hiddenInvoker.focus();
surfaces.openSurface("#bank-loan-modal", "#bank-loan-cancel");
surfaces.closeSurface("#bank-loan-modal");
assert.equal(document.activeElement, rollBtn, "a hidden invoker falls back to the HUD primary action");

/* F2345-02: the bank-loan card belongs to the key gates. */
reset();
surfaces.openSurface("#bank-loan-modal", "#bank-loan-cancel");
calls.length = 0;
press(" ", { code: "Space" });
press("r");
assert.deepEqual(calls, [], "Space/R never act behind the bank-loan card");
press("Escape");
assert.equal(hidden(bankLoanModal), true, "Escape closes the bank-loan card");

/* F2345-01: hiding the bankruptcy card re-applies inert. */
reset();
surfaces.openSurface("#bankruptcy-modal", "#bank-liquidate");
assert.equal(viewGame.inert, true, "game view is inert while the bankruptcy card is open");
const { hideSurfaceResolved } = surfaces;
hideSurfaceResolved("#bankruptcy-modal");
assert.equal(hidden(bankruptcyModal), true);
assert.equal(viewGame.inert, false, "game view is interactive again once the debt is cleared");
assert.equal(state.debtRescueDismissed === true, false, "a cleared debt is not a dismissal");

/* ---- Game modal behaviours (F2345-03/05/08/09) ---- */
const modals = await import("./clientGameModalsUi.js");
const { TILES } = await import("./clientBoardData.js");
const emitted = [];
const pendingAcks = [];
modals.configureGameModals({
  emitServer: (event, payload, ack) => { emitted.push({ event, payload }); pendingAcks.push(ack); },
  captureActionStatusNode: () => null,
  announceActionStatus: () => {},
  renderAll: () => {},
});
const buyable = TILES.find((tile) => tile.kind === "property");
state.players = [{ id: "p1", serverId: "s1", cash: 5000, name: "ME", color: "#fff", textColor: "#fff" }];

/* F2345-05: arming "Declare" moves focus to "Keep Playing". */
reset();
modals.openBankruptcyModal(0, 100, null, "Rent is due");
const declare = document.querySelector("#bank-declare");
declare.focus();
declare.click();
assert.equal(document.activeElement.id, "bank-declare-cancel", "arming Declare moves focus to the safe default instead of dropping it");

/* The shortfall title and copy only appear when cash really falls short of the bill. */
reset();
modals.openBankruptcyModal(0, 100, null, "Rent is due");
const coveredHtml = document.querySelector("#bankruptcy-card").innerHTML;
assert.match(coveredHtml, /PAYMENT DUE/);
assert.doesNotMatch(coveredHtml, /CAN'T COVER IT/, "a covered payment is not called a shortfall");
assert.doesNotMatch(coveredHtml, /[$]<span class="numeric">0<[/]span> short/, "never renders a zero shortfall");
reset();
modals.openBankruptcyModal(0, 7000, null, "Rent is due");
const shortHtml = document.querySelector("#bankruptcy-card").innerHTML;
assert.match(shortHtml, /CAN'T COVER IT/);
assert.ok(shortHtml.includes(`$<span class="numeric">${(2000).toLocaleString()}</span> short`), "the shortfall is the bill minus the player's cash");

/* F2345-03: PASS is one request, and a failed ack never reopens a resolved deed. */
reset();
state.settings.auction = false;
state.pendingBuyTile = buyable.i;
emitted.length = 0; pendingAcks.length = 0;
modals.openChoiceModal(buyable);
assert.equal(hidden(choiceModal), false);
const pass = document.querySelector("#choice-pass");
pass.click();
pass.click();
assert.equal(emitted.filter((entry) => entry.event === "decline-property").length, 1, "double-clicked PASS sends one decline");
state.pendingBuyTile = null; // a snapshot resolved the purchase while the request was in flight
surfaces.closeSurface("#choice-modal");
pendingAcks[0]({ success: false, error: "Not your purchase." });
assert.equal(hidden(choiceModal), true, "a failed decline for an already-resolved deed does not reopen the card");
pendingAcks.length = 0;
state.pendingBuyTile = buyable.i;
pass.click();
pendingAcks[0]({ success: true });
assert.equal(emitted.filter((entry) => entry.event === "decline-property").length, 2, "a new PASS can be sent once the previous one settled");

/* F2345-08: Rematch is host-only. */
reset();
state.players = [{ id: "p1", serverId: "s1", cash: 10, name: "ME", isHost: false, textColor: "#fff" }];
state.hostId = "someone-else";
let rematchStarts = 0;
modals.configureGameModals({ startGame: () => { rematchStarts += 1; } });
modals.showGameOver("ME", "p1");
const gameoverIds =() => document.querySelector("#gameover-card").children.map((child) => child.id);
assert.equal(gameoverIds().includes("go-rematch"), true, "all results keep the same Rematch position");
assert.match(document.querySelector("#gameover-card").innerHTML, /id="go-rematch"[^>]*disabled/, "non-host Rematch stays disabled");
assert.equal(document.activeElement.id, "go-home");
document.querySelector("#go-rematch").click();
assert.equal(rematchStarts, 0, "even a synthetic activation cannot start a non-host rematch");
reset();
state.gameOver = null;
state.players[0].isHost = true;
modals.showGameOver("ME", "p1");
assert.equal(gameoverIds().includes("go-rematch"), true, "the host is offered Rematch");
document.querySelector("#go-rematch").click();
assert.equal(rematchStarts, 1, "the host can start the rematch");
state.gameOver = null;

/* Round-limit end: the modal says why the richest seat won (F-081). */
reset();
modals.showGameOver("ME", "p1", "round-limit");
assert.match(document.querySelector("#gameover-card").innerHTML, /Round limit reached\. Ranked by net worth\./, "a round-limit end explains the actual winning metric");
assert.match(document.querySelector("#gameover-card").innerHTML, /FINAL NET WORTH/, "the results score column names its metric");
state.gameOver = null;
reset();
modals.showGameOver("ME", "p1", null);
assert.doesNotMatch(document.querySelector("#gameover-card").innerHTML, /Round limit reached/, "an ordinary end has no round-limit line");
state.gameOver = null;

/* F2345-09: the trade-offer card closes when the offer is withdrawn. */
reset();
const offer = { id: "trade-1", from: "p2", giveCash: 50, wantDeeds: [], receivedAt: Date.now() - 10_000 };
state.players = [{ id: "p1", serverId: "s1", cash: 10, name: "ME" }, { id: "p2", serverId: "s2", name: "THEM", color: "#0f0", textColor: "#0f0" }];
state.offers = [offer];
state.pendingTrade = { id: "trade-1" };
state.roomCode = "ROOM";
modals.openOfferModal(offer);
assert.equal(hidden(offerModal), false);
modals.closeOfferIfWithdrawn();
assert.equal(hidden(offerModal), false, "a still-pending offer stays open");
state.pendingTrade = null; // proposer cancelled; the 15 s inbox grace still lists it
modals.closeOfferIfWithdrawn();
assert.equal(hidden(offerModal), true, "a withdrawn offer closes the card");

/* F-027: one in-flight request per intent. */
const { emitIntent, intentInFlight } = await import("./clientRequestController.js");
const sent = [];
const acks = [];
const send = (event, payload, ack) => { sent.push(event); acks.push(ack); };
assert.equal(emitIntent(send, "k", "repay-player-contract", {}), true);
assert.equal(emitIntent(send, "k", "repay-player-contract", {}), false, "second identical intent is ignored");
assert.equal(sent.length, 1);
assert.equal(intentInFlight("k"), true);
acks[0]({ success: true });
assert.equal(intentInFlight("k"), false);
assert.equal(emitIntent(send, "k", "repay-player-contract", {}), true, "the next intent goes through after the ack");
acks[1]({ success: true });

/* F2345-06: a pending bid keeps focus on the pressed control. */
reset();
state.settings.auction = true;
state.players = [{ id: "p1", serverId: "s1", cash: 1500, name: "ME", textColor: "#fff", color: "#fff" }];
state.auction = { id: "5:1", tileIndex: 5, active: true, bid: 0, leaderId: null, deadline: Date.now() + 5000 };
const auctionUi = await import("./clientAuctionUi.js");
const bidEmits = [];
auctionUi.configureAuctionUi({ emitServer: (event, payload, ack) => { bidEmits.push(ack); }, captureActionStatusNode: () => null, announceActionStatus: () => {}, say() {}, renderChat() {} });
auctionUi.renderAuction();
const bidButtons = document.querySelector("#auction-card").querySelectorAll("[data-bid]");
assert.equal(bidButtons.length, 3);
bidButtons[0].focus();
bidButtons[0].click();
auctionUi.renderAuction();
assert.equal(bidButtons[0].disabled, false, "pending bid does not use the disabled attribute (it would drop focus)");
assert.equal(bidButtons[0].getAttribute("aria-disabled"), "true");
assert.equal(document.activeElement, bidButtons[0], "focus stays on the pressed bid button");
bidButtons[0].click();
assert.equal(bidEmits.length, 1, "aria-disabled bid ignores a second activation");
bidEmits[0]({ success: true });
auctionUi.stopAuctionTimer();

/* F-053: single-key shortcuts can be switched off (WCAG 2.1.4), persisted per viewer. */
const prefs = await import("./clientShortcutPrefs.js");
reset();
assert.equal(prefs.shortcutsEnabled(), true, "shortcuts default ON");
const store = new Map();
globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => { store.set(key, String(value)); }, removeItem: (key) => store.delete(key) };
prefs.setShortcutsEnabled(false);
calls.length = 0;
press(" ", { code: "Space" });
press("r");
press("l");
assert.deepEqual(calls, [], "no single-key shortcut fires while the preference is off");
assert.equal(store.get(prefs.SHORTCUTS_STORAGE_KEY), "off", "the preference is persisted");
const reloaded = await import("./clientShortcutPrefs.js?reload");
assert.equal(reloaded.shortcutsEnabled(), false, "a new page load restores the saved preference");
prefs.setShortcutsEnabled(true);
press(" ", { code: "Space" });
assert.deepEqual(calls, ["primaryTurnAction"], "turning shortcuts back on restores the old behaviour");
globalThis.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
assert.doesNotThrow(() => prefs.setShortcutsEnabled(false), "blocked storage never breaks the toggle");
assert.equal((await import("./clientShortcutPrefs.js?blocked")).shortcutsEnabled(), true, "blocked storage falls back to the default");
prefs.setShortcutsEnabled(true);

/* F-079: the skip link to the HUD action is the first focusable element of the game view. */
const { skipToGameAction } = await import("./clientKeyboard.js");
reset();
skipToGameAction({ preventDefault() {} });
assert.equal(document.activeElement, rollBtn, "skip link focuses the HUD primary action");
rollBtn.disabled = true;
skipToGameAction();
assert.equal(document.activeElement.id, "game-main", "disabled HUD action falls back to the table region");
rollBtn.disabled = false;
const { readFileSync } = await import("node:fs");
const indexHtml = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const gameView = indexHtml.slice(indexHtml.indexOf('id="view-game"'));
assert.match(gameView.slice(0, 400), /<a class="skip-link" id="skip-to-action" href="#roll-btn">Skip to game action<\/a>/, "skip link precedes every header control");
assert.doesNotMatch(indexHtml, /id="quick-table-btn"[^>]*>.*\[ C \]/, "Quick table advertises no shortcut (C opens Create)");

/* F-059: Parlor Patrol is switched off, so Ctrl+P is the browser's print
   shortcut again and Shift+P does nothing on Home. */
{
  const { readFileSync: readHtml } = await import("node:fs");
  const homeHtml = readHtml(new URL("./index.html", import.meta.url), "utf8");
  assert.match(homeHtml, /id="home-night-shift-start" data-parlor-patrol hidden/, "the SHIFT+P hint button ships hidden");
  surfaces.closeAllSurfaces();
  calls.length = 0;
  state.phase = "home";
  viewHome.classList.remove("is-hidden");
  for (const mods of [{ ctrlKey: true }, { metaKey: true }]) {
    const event = { key: "p", code: "KeyP", target: body, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    listeners.keydown(event);
    assert.equal(event.defaultPrevented, false, "Ctrl/Cmd+P is left to the browser (print) while Parlor Patrol is off");
  }
  assert.deepEqual(calls, [], "browser chords reach no Home shortcut");
  listeners.keydown({ key: "P", code: "KeyP", target: body, ctrlKey: false, metaKey: false, altKey: false, shiftKey: true, defaultPrevented: false, preventDefault() {} });
  assert.ok(!calls.includes("startNightShift"), "no Night Shift start while Parlor Patrol is off");
  viewHome.classList.add("is-hidden");
  state.phase = "playing";
}

console.log("clientKeyboardFocus tests passed");
