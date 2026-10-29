import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;

const { equityTransferControlsHTML, equityTransferPayload, tradeDeedRowHTML, beginTradeFromDeed, financingActiveContractDetailHTML } = await import("./clientTradeUi.js");
const { state } = await import("./clientState.js");
const tradeUiSource = await readFile(new URL("./clientTradeUi.js", import.meta.url), "utf8");
const economyStyles = await readFile(new URL("./ui-review-economy.css", import.meta.url), "utf8");

test("mortgaged deeds remain selectable and retain their mortgage label", () => {
  const tile = { i: 1, name: "MEDITERRANEAN AVENUE", price: 60, group: "brown", kind: "property" };
  state.mortgaged = { 1: true };
  state.houses = {};
  state.serverTiles = [];
  const row = tradeDeedRowHTML(tile, "me", false);
  assert.match(row, /is-mortgaged/);
  assert.match(row, /MORTGAGED/);
  assert.match(row, /<span class="trade-deed-name">[^<]*<\/span>\s*<span class="t-micro red trade-deed-mortgage-badge"[^>]*>MORTGAGED<\/span>/,
    "mortgage badge stays outside the ellipsized deed name");
  assert.doesNotMatch(row, /disabled/);
});

test("every deed in a built color set is blocked from trade until buildings clear", () => {
  const tile = { i: 1, name: "MEDITERRANEAN AVENUE", price: 60, group: "brown", kind: "property" };
  state.mortgaged = {};
  state.houses = {};
  state.serverTiles = [{ index: 3, houseCount: 1 }];
  const row = tradeDeedRowHTML(tile, "me", false);
  assert.match(row, /disabled/);
  assert.match(row, /Sell all buildings in this color set before trading a deed/);
});

test("starting a deed sale opens trade with the deed offered and an available recipient", () => {
  state.players = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
  state.owners = { 1: "p1" };
  state.houses = {};
  state.mortgaged = {};
  state.serverTiles = [];
  beginTradeFromDeed(1);
  assert.equal(state.tradeWith, "p2");
  assert.deepEqual([...state.tradeMyDeeds], [1]);
  assert.deepEqual([...state.tradeTheirDeeds], []);
  assert.equal(state.tradeMyCash, 0);
  assert.equal(state.tradeTheirCash, 0);
});

function functionSource(name) {
  const declaration = tradeUiSource.indexOf(`function ${name}(`);
  assert.notEqual(declaration, -1, `${name} exists`);
  const nextFunction = /\n(?:export )?(?:async )?function \w+\(/g;
  nextFunction.lastIndex = declaration + 1;
  const nextDeclaration = nextFunction.exec(tradeUiSource)?.index ?? tradeUiSource.length;
  return tradeUiSource.slice(declaration, nextDeclaration);
}

function test(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("feedBackedTradeAndContractSuccessesDoNotWriteDuplicateLocalNotices", () => {
  for (const name of ["sendFinancingContract", "sendFinancingNegotiation", "sendFinancingRepay", "emitTradeOffer"]) {
    const source = functionSource(name);
    assert.doesNotMatch(source, /host\.record(?:Activity)?\s*\(/, `${name} relies on the server feed instead of adding a duplicate local log/activity row`);
    assert.match(source, /host\.announceActionStatus\(/, `${name} keeps failures beside the submitting action`);
  }
});

test("equityTransferProposalKeepsItsUniqueLocalActivityNotice", () => {
  const source = functionSource("onEquityTransferSubmit");
  assert.match(source, /host\.recordActivity\("Equity transfer offer sent\./);
});

test("activeContractUsesContractHeaderAndNarrowOuterCard", () => {
  const source = functionSource("renderFinancingModal");
  assert.match(source, /const viewingContract = financingView === "deal"/);
  assert.match(source, /const activeContract = viewingContract \? financingSelectedContract\(\) : null/);
  assert.match(source, /viewingContract \? `\$\{activeMode\} contract`/);
  assert.match(source, /financing-head-contract/);
  assert.match(source, /Active contract terms and repayment/);
  assert.doesNotMatch(source, /ACTIVE PLAYER CONTRACT/);
  assert.match(economyStyles, /\.financing-card:has\(\.financing-surface-body:not\(\.financing-builder\)\)\s*\{\s*width:\s*min\(590px, calc\(100vw - 32px\)\);\s*max-width:\s*590px/);
  assert.match(economyStyles, /\.financing-body-contract\s*\{[^}]*overflow-y:\s*auto;[^}]*scrollbar-width:\s*auto/);
  assert.match(economyStyles, /@media \(max-height: 720px\)[\s\S]*?\.financing-head-contract\s*\{\s*padding-bottom:\s*6px/);
  assert.match(economyStyles, /\.financing-card:has\(\.financing-builder\)\s*\{\s*width:\s*min\(820px/);
  assert.match(economyStyles, /\.financing-surface-body\.financing-builder\s*\{[^}]*grid-template-areas:\s*"tabs tabs" "form preview" "actions preview";\s*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
});

test("financing composer reserves a footer while terms and preview scroll internally", () => {
  assert.match(economyStyles, /\.financing-card:has\(\.financing-builder\) > \.financing-body\s*\{[^}]*max-height:[^}]*display:\s*flex;[^}]*flex-direction:\s*column/);
  assert.match(economyStyles, /\.financing-form\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto/);
  assert.match(economyStyles, /\.financing-preview\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto/);
  const builder = functionSource("financingBuilderHTML");
  assert.match(builder, /id="financing-tab-loan" aria-controls="financing-mode-panel"/);
  assert.match(builder, /id="financing-tab-equity" aria-controls="financing-mode-panel"/);
  assert.match(builder, /class="financing-form" id="financing-mode-panel" tabindex="0" role="tabpanel" aria-labelledby="financing-tab-\$\{financingPreviewMode\}"/);
});

test("active loan details expose actual terms and an honestly empty payment track", () => {
  assert.match(functionSource("financingDealTermsHTML"), /Total interest/);
  assert.match(functionSource("financingDealTermsHTML"), /Collateral/);
  assert.match(functionSource("financingDealProgressBarHTML"), /role="progressbar"/);
  assert.match(functionSource("financingDealProgressBarHTML"), /width:\$\{progress\.pct\}%/);
  assert.match(functionSource("financingContractRepayHTML"), /REPAY CONTRACT/);
  assert.match(economyStyles, /contract-repay-controls > button \{[^}]*min-height: 46px/);
});

assert.deepEqual(equityTransferPayload({
  fromPlayerId: "seller-seat",
  toPlayerId: "buyer-seat",
  contractId: "equity-contract",
  sharePct: 15,
  price: 225,
  requestId: "equity-transfer-1",
}), {
  fromPlayerId: "seller-seat",
  toPlayerId: "buyer-seat",
  contractId: "equity-contract",
  sharePct: 15,
  price: 225,
  requestId: "equity-transfer-1",
});
const transferControls = equityTransferControlsHTML(20);
assert.match(transferControls, /name="sharePct" min="5" max="20"/);
assert.match(transferControls, /name="price" min="1" step="1" value="1"/);
assert.equal(equityTransferControlsHTML(4), "", "a share below the server minimum has no transfer form");

console.log("client equity transfer UI tests: passed");

test("active equity shows its real share rights and term without debt repayment", () => {
  state.players = [{ id: "p1", serverId: "buyer", name: "BUYER" }, { id: "p2", serverId: "investor", name: "INVESTOR" }];
  state.serverTiles = [];
  const html = financingActiveContractDetailHTML({ id: "eq1", kind: "equity", status: "active", fromPlayerId: "investor", toPlayerId: "buyer", amount: 175, equityShare: 35, equityControl: "shared", propertyIndex: 1, expiresRound: 17 });
  assert.match(html, /INVESTOR/);
  assert.match(html, /BUYER/);
  assert.match(html, /35%/);
  assert.match(html, /\$175/);
  assert.match(html, /Through round 17/);
  assert.match(html, /SHARED/);
  assert.doesNotMatch(html, /data-financing-repay|DUE ROUND|MAKE A PAYMENT/);
});

test("active debt keeps exact balance, maturity, collateral and usable repayment controls", () => {
  state.players = [{ id: "p1", serverId: "borrower", name: "BORROWER" }, { id: "p2", serverId: "lender", name: "LENDER" }];
  state.serverTiles = [];
  const base = { id: "debt1", kind: "loan", status: "active", fromPlayerId: "lender", toPlayerId: "borrower", amount: 300, totalDue: 345, premiumRate: 15, remaining: 225, dueRound: 14, collateralTileIndices: [1] };
  const html = financingActiveContractDetailHTML(base);
  assert.match(html, /\$225/);
  assert.match(html, /Round 14/);
  assert.match(html, /\$45 \(15%\)/);
  assert.match(html, /data-financing-repay="debt1"/);
  assert.match(html, /max="225"/);
  assert.match(html, /Uncured default/);
  const hybrid = financingActiveContractDetailHTML({ ...base, kind: "hybrid", propertyIndex: 3, conversionShare: 30 });
  assert.match(hybrid, /30%/);
  assert.match(hybrid, /Conversion property/);
});

test("narrow finance layouts exclude the kept equity builder and due warning path", () => {
  assert.match(functionSource("financingDealSelectedHTML"), /contract.status === "active"/);
  assert.match(functionSource("renderFinancingModal"), /card.dataset.financingView/);
  assert.match(economyStyles, /data-financing-mode="loan"/);
  assert.match(economyStyles, /data-financing-mode="hybrid"/);
  assert.match(economyStyles, /data-financing-view="negotiate"/);
});

test("legacy active equity links transfer controls only to this deed's actual local holding when Advanced Finance is enabled", () => {
  state.settings = { ...state.settings, rulesProfile: "advanced", playerFinance: true };
  state.players = [{ id: "p1", serverId: "investor", name: "INVESTOR" }, { id: "p2", serverId: "owner", name: "OWNER" }];
  state.owners = { 1: "p2" };
  state.serverTiles = [{ index: 1, equityShares: [{ holderId: "investor", contractId: "eq1", share: 35, control: "shared" }] }];
  const contract = { id: "eq1", kind: "equity", status: "active", fromPlayerId: "investor", toPlayerId: "owner", amount: 175, equityShare: 35, equityControl: "shared", propertyIndex: 1, expiresRound: null };
  const html = financingActiveContractDetailHTML(contract);
  assert.match(html, /Permanent/);
  assert.match(html, /OWNER · 65%/);
  assert.match(html, /data-equity-transfer-form data-contract-id="eq1" data-tile-index="1"/);
  assert.match(html, /name="sharePct" min="5" max="35"/);
  const unrelated = financingActiveContractDetailHTML({ ...contract, propertyIndex: 3 });
  assert.doesNotMatch(unrelated, /data-equity-transfer-form/);
});


test("temporary rent shares disclose passive expiry and never offer title or resale", () => {
  state.settings = { ...state.settings, rulesProfile: "standard", playerFinance: false };
  const html = financingActiveContractDetailHTML({ id: "rent1", kind: "equity", rentShareVersion: 1, rulesVersion: 2, status: "active", amount: 100, equityShare: 25, propertyIndex: 5, expiresRound: 8, durationRounds: 3, fromPlayerId: "investor", toPlayerId: "owner" });
  assert.match(html, /Rent share/);
  assert.match(html, /ACC AIRPORT/);
  assert.match(html, /start of round 8/i);
  assert.match(html, /No capital refund/);
  assert.match(html, /Deed sale\/mortgage locked/);
  assert.equal((html.match(/start of round 8/gi) || []).length, 1, "expiry appears once in the ledger");
  assert.doesNotMatch(html, /No loan repayment|recorded agreement controls|sale proceeds, title, voting/);
  assert.doesNotMatch(html, /data-equity-transfer-form|Current ownership|SHAPE NEW DEAL/);
});

test("new collateral contracts use their stored quote and explain capped default credit", () => {
  const html = financingActiveContractDetailHTML({ id: "loan-credit", kind: "loan", status: "active", amount: 150, totalDue: 180, remaining: 180, dueRound: 5, collateralTileIndices: [1], collateralCreditVersion: 1, collateralCreditQuotes: [{ tileIndex: 1, name: "SALVADOR", value: 60 }], fromPlayerId: "investor", toPlayerId: "owner" });
  assert.match(html, /Printed-price credit: SALVADOR \$60/);
  assert.match(html, /Residual debt: \$120/);
  assert.match(html, /no surplus cash/);
});
