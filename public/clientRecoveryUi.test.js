import assert from "node:assert/strict";

// Exercise the real recovery controller and acknowledgement seam with a small DOM.
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

const body = new FakeElement("body");
const modal = body.append(new FakeElement("bankruptcy-modal", { hidden: true }));
const card = modal.append(new FakeElement("bankruptcy-card"));
const actions = card.append(new FakeElement("bank-actions"));
const view = body.append(new FakeElement("view-game", { classes: ["view"] }));
view.append(new FakeElement("roll-btn", { tag: "button" }));
globalThis.HTMLElement = FakeElement;
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.requestAnimationFrame = callback => callback();
globalThis.localStorage = { getItem: () => null };
globalThis.document = {
  body, activeElement: body,
  contains: node => body.contains(node),
  querySelectorAll: selector => selector === ".view" ? [view] : [],
  querySelector: selector => {
    if (selector === "#bankruptcy-modal .bank-actions") return actions;
    return body.descendants().find(node => `#${node.id}` === selector) || null;
  },
};
const { state } = await import("./clientState.js");
const { configureGameModals, openBankruptcyModal, openVoluntaryExitModal } = await import("./clientGameModalsUi.js");
const emitted = [], acknowledgements = [], navigation = [], statuses = [];
configureGameModals({
  emitServer: (event, payload, ack) => { emitted.push({ event, payload }); acknowledgements.push(ack); },
  openHoldings: () => navigation.push("holdings"),
  openTradeForDebt: () => navigation.push("trade"),
  openFinancingForDebt: () => navigation.push("financing"),
  captureActionStatusNode: () => null,
  announceActionStatus: message => statuses.push(message),
});
state.phase = "playing";
state.players = [{ id: "p1", serverId: "s1", cash: 40, name: "ME" }];
const debt = { playerId: "s1", amountRemaining: 700, reason: "Rent" };
state.pendingDebt = debt;
const click = id => document.querySelector(`#${id}`).click();
function openRecovery() {
  actions.dataset = {};
  openBankruptcyModal(0, 700, null, "Rent");
  // The stub parses ID nodes; keep the selector-backed action region in the card.
  actions.parentElement = card;
  card.children.push(actions);
}
for (const [button, destination] of [["bank-liquidate", "holdings"], ["bank-trade", "trade"], ["bank-financing", "financing"]]) {
  openRecovery();
  assert.equal(document.activeElement.id, "bank-liquidate", "recovery initially focuses the safe Holdings option");
  click(button);
  assert.equal(navigation.at(-1), destination);
  assert.equal(state.pendingDebt, debt, "navigation retains the authoritative unpaid debt");
  assert.equal(modal.classList.contains("is-hidden"), true);
  assert.equal(state.debtRescueDismissed, true);
  assert.equal(emitted.length, 0, "recovery navigation never declares bankruptcy");
}
openRecovery();
click("bank-dismiss");
assert.equal(state.pendingDebt, debt, "dismissing recovery does not clear payment");
openRecovery();
click("bank-declare");
assert.equal(emitted.length, 0, "first bankruptcy click only arms confirmation");
assert.equal(document.activeElement.id, "bank-declare-cancel", "confirmation focuses Keep Playing");
click("bank-declare-cancel");
assert.equal(emitted.length, 0);
assert.equal(state.pendingDebt, debt);
openRecovery();
click("bank-declare");
click("bank-declare-confirm");
click("bank-declare-confirm");
assert.equal(emitted.length, 1, "double confirmation emits exactly once while awaiting server acknowledgement");
assert.equal(emitted[0].event, "declare-bankruptcy");
acknowledgements.shift()({ success: false, error: "Payment changed." });
assert.equal(modal.classList.contains("is-hidden"), false, "server rejection keeps recovery available");
assert.equal(statuses.at(-1), "Payment changed.");
click("bank-declare-confirm");
acknowledgements.shift()({ success: true });
assert.equal(modal.classList.contains("is-hidden"), true, "accepted bankruptcy closes the card");
assert.equal(state.pendingDebt, debt, "only a server snapshot clears payment state");
openVoluntaryExitModal();
assert.equal(document.activeElement.id, "bank-retire-cancel", "voluntary retirement keeps its safe default");
const beforeRetire = emitted.length;
click("bank-retire-cancel");
assert.equal(emitted.length, beforeRetire);
openVoluntaryExitModal();
click("bank-retire-confirm");
assert.equal(emitted.length, beforeRetire + 1, "voluntary retirement still uses its explicit confirmation");
acknowledgements.shift()({ success: true });
console.log("recovery navigation, debt preservation, confirmation and callback checks passed");
