import assert from "node:assert/strict";

// Exercise the rendered composer controls and its emitted public contract,
// without a browser or exposing private draft helpers to tests.
const nodes = new Map();
function node(id) {
  return { id, dataset: {}, listeners: {}, attributes: {}, innerHTML: "", value: "", disabled: false,
    classList: { toggle() {} }, focus() {}, matches: () => false, closest: () => null,
    querySelectorAll: () => [], querySelector: () => null,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    dispatch(type, target = this) { for (const fn of this.listeners[type] || []) fn({ target, currentTarget: this }); },
  };
}
const card = node("financing-card");
Object.defineProperty(card, "innerHTML", {
  get() { return this.html || ""; },
  set(html) {
    this.html = html;
    nodes.clear();
    nodes.set("#financing-card", card);
    for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
      const el = node(match[1]);
      el.value = /\bvalue="([^"]*)"/.exec(match[0])?.[1] || "";
      el.disabled = /\sdisabled(?:\s|\/?>)/.test(match[0]);
      nodes.set(`#${el.id}`, el);
    }
  },
});
nodes.set("#financing-card", card);
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: id => nodes.get(id) || null, querySelectorAll: () => [] };
globalThis.localStorage = globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { state } = await import("./clientState.js");
const { configureTradeUi, openFinancingModal, openFinancingContract } = await import("./clientTradeUi.js");
const offers = [];
configureTradeUi({ emitServer: (event, payload) => offers.push({ event, payload }), createRequestId: () => "finance-test" });
state.settings = { ...state.settings, rulesProfile: "advanced", playerFinance: true };
state.players = [{ id: "p1", cash: 1000 }, { id: "p2", serverId: "borrower", name: "Borrower", cash: 50 }];
state.owners = { 1: "p2" };
state.serverTiles = [];

function enterAmount(value) {
  const input = nodes.get("#finance-amount");
  input.value = String(value);
  card.dispatch("input", input);
  return input;
}
function send() { nodes.get("#financing-send").dispatch("click"); }

openFinancingModal("equity", 1);
enterAmount(150);
const compactPreview = nodes.get("#financing-preview").innerHTML;
assert.doesNotMatch(compactPreview, />CONTROL<|The investor receives the agreed|Lasts 3 rounds/, "composer keeps policy in Rules instead of repeating the fields");
assert.equal((compactPreview.match(/Collected rent only/g) || []).length, 1, "one concise risk note per rent-share preview");
assert.ok(compactPreview.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length <= 45, "rent-share preview remains scannable");
assert.match(nodes.get("#financing-preview").innerHTML, /CONTRIBUTION<\/span><strong[^>]*>\$150</,
  "a $150 contribution on a $60 deed previews the amount being offered");
send();
assert.equal(offers.at(-1).event, "propose-player-contract");
assert.equal(offers.at(-1).payload.amount, 150);
assert.equal(offers.at(-1).payload.propertyIndex, 1);
console.log("PASS financing amount field, preview and emitted contract agree above deed price");

for (const mode of ["loan", "equity"]) {
  openFinancingModal(mode === "hybrid" ? "loan" : mode, 1);
  if (mode === "loan") {
    const collateral = { value: "1", checked: true, dataset: {}, closest(selector) { return selector === "[data-finance-collateral]" ? this : null; } };
    card.dispatch("change", collateral);
  }
  const input = enterAmount("217.9");
  assert.equal(Number(input.value), 217, `${mode}: visible field uses integer currency`);
  assert.match(nodes.get("#financing-preview").innerHTML, /\$217</);
  if (mode === "loan") assert.match(nodes.get("#financing-preview").innerHTML, /\$261</, "217 plus authoritative rounded-up 20% interest");
  if (mode === "loan") {
    assert.match(nodes.get("#financing-preview").innerHTML, /Printed-price credit: SALVADOR \$60/);
    assert.match(nodes.get("#financing-preview").innerHTML, /Residual debt: \$201/);
    assert.doesNotMatch(nodes.get("#financing-preview").innerHTML, /Printed deed prices lock at agreement/);
  }
  assert.equal(nodes.get("#financing-send").disabled, false);
  send();
  assert.equal(offers.at(-1).payload.kind, mode);
  assert.equal(offers.at(-1).payload.amount, 217);
  if (mode === "loan") assert.deepEqual(offers.at(-1).payload.collateralTileIndices, [1]);
  for (const value of [0, -5, "", "not-a-number", Infinity, -Infinity, 1001]) {
    const before = offers.length;
    enterAmount(value);
    assert.equal(nodes.get("#financing-send").disabled, true, `${mode}: ${value} disables Send`);
    assert.equal(nodes.get("#finance-amount").getAttribute("aria-invalid"), "true");
    assert.equal(nodes.get("#finance-amount").getAttribute("aria-describedby"), "finance-amount-error");
    assert.equal(nodes.get("#finance-amount-error")?.textContent, "Enter an amount you can fund.");
    send(); // A direct/programmatic click must still hit the validation guard.
    assert.equal(offers.length, before, `${mode}: ${value} emits no offer`);
  }
  enterAmount(1000);
  assert.equal(nodes.get("#financing-send").disabled, false, `${mode}: correcting the amount re-enables Send`);
  assert.equal(nodes.get("#finance-amount").getAttribute("aria-invalid"), "false");
  assert.equal(nodes.get("#finance-amount").getAttribute("aria-describedby"), null);
  assert.equal(nodes.get("#finance-amount-error").textContent, "");
  send();
  assert.equal(offers.at(-1).payload.amount, 1000);
}
console.log("PASS loan/rent-share normalize field and preview with the emitted amount, interest and funding guards");

state.settings = { ...state.settings, rulesProfile: "standard", playerFinance: false };
const before = offers.length;
openFinancingModal("equity", 1);
send();
assert.equal(offers.length, before, "Finance off blocks retained composer controls regardless of preset");
state.settings = { ...state.settings, rulesProfile: "standard", playerFinance: true };
openFinancingModal("equity", 1);
assert.match(card.innerHTML, /id="finance-equity-duration"[^>]*max="20"[^>]*value="3"/);
assert.doesNotMatch(card.innerHTML, /finance-equity-permanent|finance-equity-control|data-financing-mode="hybrid"/);
nodes.get("#financing-mode-tabs").dispatch("click", { closest: () => ({ dataset: { financingMode: "hybrid" } }) });
enterAmount(100);
send();
assert.equal(offers.length, before + 1, "Standard permits new rent shares when the host enables Player Finance");
assert.equal(offers.at(-1).payload.kind, "equity", "a forged retired mode does not activate the hybrid composer");
assert.equal(offers.at(-1).payload.durationRounds, 3);
assert.equal(offers.at(-1).payload.permanent, false);
assert.equal(offers.at(-1).payload.equityControl, "passive");
console.log("PASS fixed passive rent shares depend on the finance flag, not the starting preset");

state.owners = { 1: "p2", 5: "p2", 12: "p2" };
state.mortgaged = { 1: true };
state.serverTiles = [{ index: 12, equityShares: [{ holderId: "existing-investor", share: 25, rentShareVersion: 1 }] }];
openFinancingModal("equity", 5);
assert.match(card.innerHTML, /data-dropdown-value-option="5"/);
assert.doesNotMatch(card.innerHTML, /data-dropdown-value-option="(?:1|12)"/);
openFinancingModal("loan");
assert.match(card.innerHTML, /data-finance-collateral value="5"/);
assert.doesNotMatch(card.innerHTML, /data-finance-collateral value="(?:1|12)"/);
console.log("PASS new offers include airports and exclude mortgaged or already shared deeds");

state.owners = { 1: "p2", 3: "p2" };
state.mortgaged = {};
state.houses = {};
state.serverTiles = [{ index: 3, houseCount: 1 }];
openFinancingModal("loan");
assert.doesNotMatch(card.innerHTML, /data-finance-collateral value="(?:1|3)"/, "buildings on any sibling block the entire set from collateral");
enterAmount(100);
assert.equal(nodes.get("#financing-send").disabled, false, "an unsecured loan stays available without eligible collateral");
send();
assert.deepEqual(offers.at(-1).payload.collateralTileIndices, []);
const forgedBuiltCollateral = { value: "1", checked: true, dataset: {}, closest(selector) { return selector === "[data-finance-collateral]" ? this : null; } };
card.dispatch("change", forgedBuiltCollateral);
send();
assert.deepEqual(offers.at(-1).payload.collateralTileIndices, [], "a retained/forged checkbox cannot add the built sibling");
openFinancingModal("equity", 3);
assert.match(card.innerHTML, /data-dropdown-value-option="3"/, "rent shares still permit owner-built deeds");
enterAmount(100);
send();
assert.equal(offers.at(-1).payload.propertyIndex, 3);
console.log("PASS built color sets block collateral while unsecured loans and rent shares remain available");
state.owners = { 5: "p2" };
state.serverTiles = [{ index: 5, propertyActions: { tradeDeed: { enabled: false, reason: "Locked for settlement." } } }];
openFinancingModal("loan");
assert.doesNotMatch(card.innerHTML, /data-finance-collateral value="5"/, "unknown projected asset locks stay unavailable for pledge");
state.serverTiles[0].propertyActions.tradeDeed.reason = "Resolve the pending player contract before proposing a trade.";
openFinancingModal("loan");
assert.match(card.innerHTML, /data-finance-collateral value="5"/, "a pending contract's trade-only gate does not block collateral negotiation");
state.players[1].bankLoan = { status: "active", collateralTileIndex: 5 };
openFinancingModal("loan");
assert.doesNotMatch(card.innerHTML, /data-finance-collateral value="5"/, "known bank collateral remains locked");
state.players[1].bankLoan = null;
state.playerContracts = { active: [
  { id: "hidden", kind: "loan", status: "active" },
  { id: "current-rent", kind: "equity", rentShareVersion: 1, rulesVersion: 2, equityShare: 25, status: "active" },
  { id: "legacy-equity", kind: "equity", equityShare: 10, status: "active" },
] };
openFinancingContract("hidden");
assert.match(card.innerHTML, /data-financing-pick="current-rent"><span[^>]*>RENT SHARE/);
assert.match(card.innerHTML, /data-financing-pick="legacy-equity"><span[^>]*>LEGACY EQUITY/);
console.log("PASS projected locks and current versus legacy picker labels agree with contract rules");
