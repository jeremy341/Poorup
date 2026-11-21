/* global process */
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;

const read = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const ui = await import("./clientFinancingUi.js");
const trade = await import("./clientTradeUi.js");
const { state } = await import("./clientState.js");

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}: ${error.message}`);
  }
}

const PUBLIC_API = [
  "closeFinancingModal",
  "equityTransferControlsHTML",
  "equityTransferPayload",
  "financingActiveContractDetailHTML",
  "openFinancingContract",
  "openFinancingModal",
  "openFinancingNegotiation",
];

check("barrel re-exports exactly the original financing public API", () => {
  assert.deepEqual(Object.keys(ui).sort(), PUBLIC_API);
  for (const name of PUBLIC_API) assert.equal(typeof ui[name], "function", `${name} is a function`);
});

check("clientTradeUi forwards the financing API unchanged", () => {
  for (const name of PUBLIC_API) assert.equal(trade[name], ui[name], `${name} is the same binding`);
});

check("barrel stays thin and delegates to focused modules", () => {
  const source = read("clientFinancingUi.js");
  assert.doesNotMatch(source, /\bfunction\s+\w+\s*\(/);
  assert.equal((source.match(/^export\s*\{/gm) || []).length, 3, "one re-export per source module");
  for (const module of ["clientFinancingTransfer.js", "clientFinancingDeal.js", "clientFinancingModal.js"]) {
    assert.match(source, new RegExp(`./${module}`), `${module} is re-exported`);
  }
  for (const module of [
    "clientFinancingState.js",
    "clientFinancingPreview.js",
    "clientFinancingTransfer.js",
    "clientFinancingDeal.js",
    "clientFinancingNegotiation.js",
    "clientFinancingModal.js",
  ]) {
    assert.match(read(module), /^\/\/ FINANCING:/, `${module} has a one-line header`);
  }
});

check("focused modules have no import cycles", () => {
  const modules = [
    "clientFinancingUi.js",
    "clientFinancingState.js",
    "clientFinancingPreview.js",
    "clientFinancingTransfer.js",
    "clientFinancingDeal.js",
    "clientFinancingNegotiation.js",
    "clientFinancingModal.js",
  ];
  const graph = new Map(modules.map((name) => [name, []]));
  for (const name of modules) {
    for (const match of read(name).matchAll(/from\s+"\.\/([\w.]+\.js)"/g)) {
      const dep = match[1];
      if (graph.has(dep)) graph.get(name).push(dep);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const walk = (name) => {
    if (visiting.has(name)) throw new Error(`import cycle at ${name}`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dep of graph.get(name)) walk(dep);
    visiting.delete(name);
    visited.add(name);
  };
  modules.forEach(walk);
});

check("equity transfer payload and controls keep their wire shape", () => {
  assert.deepEqual(ui.equityTransferPayload({
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
  const controls = ui.equityTransferControlsHTML(20);
  assert.match(controls, /name="sharePct" min="5" max="20"/);
  assert.match(controls, /name="price" min="1" step="1" value="1"/);
  assert.equal(ui.equityTransferControlsHTML(4), "");
});

check("active contract detail keeps its rendered output", () => {
  state.players = [{ id: "p1", serverId: "buyer", name: "BUYER" }, { id: "p2", serverId: "investor", name: "INVESTOR" }];
  state.serverTiles = [];
  const html = ui.financingActiveContractDetailHTML({ id: "eq1", kind: "equity", status: "active", fromPlayerId: "investor", toPlayerId: "buyer", amount: 175, equityShare: 35, equityControl: "shared", propertyIndex: 1, expiresRound: 17 });
  assert.match(html, /INVESTOR/);
  assert.match(html, /BUYER/);
  assert.match(html, /35%/);
  assert.match(html, /\$175/);
  assert.match(html, /Through round 17/);
  assert.match(html, /SHARED/);
  assert.doesNotMatch(html, /data-financing-repay|DUE ROUND|MAKE A PAYMENT/);
});

check("active debt keeps exact balance, maturity, collateral and repayment controls", () => {
  state.players = [{ id: "p1", serverId: "borrower", name: "BORROWER" }, { id: "p2", serverId: "lender", name: "LENDER" }];
  state.serverTiles = [];
  const base = { id: "debt1", kind: "loan", status: "active", fromPlayerId: "lender", toPlayerId: "borrower", amount: 300, totalDue: 345, premiumRate: 15, remaining: 225, dueRound: 14, collateralTileIndices: [1] };
  const html = ui.financingActiveContractDetailHTML(base);
  assert.match(html, /\$225/);
  assert.match(html, /Round 14/);
  assert.match(html, /\$45 \(15%\)/);
  assert.match(html, /data-financing-repay="debt1"/);
  assert.match(html, /max="225"/);
  assert.match(html, /Uncured default/);
  const hybrid = ui.financingActiveContractDetailHTML({ ...base, kind: "hybrid", propertyIndex: 3, conversionShare: 30 });
  assert.match(hybrid, /30%/);
  assert.match(hybrid, /Conversion property/);
});

check("legacy equity and rent shares keep their distinct rights copy", () => {
  state.settings = { ...state.settings, rulesProfile: "advanced", playerFinance: true };
  state.players = [{ id: "p1", serverId: "investor", name: "INVESTOR" }, { id: "p2", serverId: "owner", name: "OWNER" }];
  state.owners = { 1: "p2" };
  state.serverTiles = [{ index: 1, equityShares: [{ holderId: "investor", contractId: "eq1", share: 35, control: "shared" }] }];
  const equity = ui.financingActiveContractDetailHTML({ id: "eq1", kind: "equity", status: "active", fromPlayerId: "investor", toPlayerId: "owner", amount: 175, equityShare: 35, equityControl: "shared", propertyIndex: 1, expiresRound: null });
  assert.match(equity, /Permanent/);
  assert.match(equity, /OWNER · 65%/);
  assert.match(equity, /data-equity-transfer-form data-contract-id="eq1" data-tile-index="1"/);
  assert.match(equity, /name="sharePct" min="5" max="35"/);

  state.settings = { ...state.settings, rulesProfile: "standard", playerFinance: false };
  const rentShare = ui.financingActiveContractDetailHTML({ id: "rent1", kind: "equity", rentShareVersion: 1, rulesVersion: 2, status: "active", amount: 100, equityShare: 25, propertyIndex: 5, expiresRound: 8, durationRounds: 3, fromPlayerId: "investor", toPlayerId: "owner" });
  assert.match(rentShare, /Rent share/);
  assert.match(rentShare, /start of round 8/i);
  assert.doesNotMatch(rentShare, /data-equity-transfer-form|Current ownership|SHAPE NEW DEAL/);
});

check("collateral credit summary survives the deal-view split", () => {
  const html = ui.financingActiveContractDetailHTML({ id: "loan-credit", kind: "loan", status: "active", amount: 150, totalDue: 180, remaining: 180, dueRound: 5, collateralTileIndices: [1], collateralCreditVersion: 1, collateralCreditQuotes: [{ tileIndex: 1, name: "SALVADOR", value: 60 }], fromPlayerId: "investor", toPlayerId: "owner" });
  assert.match(html, /Printed-price credit: SALVADOR \$60/);
  assert.match(html, /Residual debt: \$120/);
  assert.match(html, /no surplus cash/);
});

console.log(`client financing UI split tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
