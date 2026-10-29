import assert from "node:assert/strict";
import { playerFinanceEnabled, isRentShare, contractLabel, rentShareDisclosure, collateralCreditSummary } from "./clientFinanceRules.js";
assert.equal(playerFinanceEnabled({ rulesProfile: "standard", playerFinance: true }), true);
assert.equal(playerFinanceEnabled({ rulesProfile: "advanced", playerFinance: true }), true);
assert.equal(playerFinanceEnabled({ rulesProfile: "advanced", playerFinance: false }), false);
assert.equal(playerFinanceEnabled({ playerFinance: true }), true);
assert.equal(playerFinanceEnabled({ rulesProfile: "standard", playerFinance: false }), false);
assert.equal(isRentShare({ kind: "equity", rentShareVersion: 1 }), true);
assert.equal(contractLabel({ kind: "equity", rentShareVersion: 1 }), "Rent share");
assert.equal(contractLabel({ kind: "equity" }), "Legacy equity");
const words = text => text.trim().split(/\s+/).length;
assert.ok(words(rentShareDisclosure({ durationRounds: 3, expiresRound: 9 })) <= 12, "modal risk copy stays brief; term fields carry dates");
assert.equal(rentShareDisclosure({ durationRounds: 3 }), "Collected rent only. Deed sale/mortgage locked. No capital refund.");
assert.match(rentShareDisclosure({}), /no capital refund/i);
assert.doesNotMatch(rentShareDisclosure({}), /sale proceeds|voting|expiry round|building costs/i);
const quotedCredit = collateralCreditSummary({ collateralCreditVersion: 1, collateralCreditQuotes: [{ name: "A", value: 200 }, { name: "B", value: 300 }], remaining: 420 });
assert.equal(quotedCredit, "Printed-price credit: A $200; B $300. Capped at unpaid debt; no surplus cash. Residual debt: $0.");
assert.ok(words(quotedCredit) <= 25, "named quote and numeric residual stay scannable");
assert.equal(collateralCreditSummary({ collateralCreditQuotes: [{ value: 200 }], remaining: 420 }), "");
assert.equal(rentShareDisclosure({ status: "pending", durationRounds: 3, expiresRound: 9 }), rentShareDisclosure({ status: "active", expiresRound: 9 }));
assert.doesNotMatch(rentShareDisclosure({ status: "pending", durationRounds: 3, expiresRound: 9 }), /start of round 9/);
console.log("PASS Standard/Advanced finance, rent-share and collateral disclosure contracts");

assert.match(collateralCreditSummary({ collateralCreditVersion: 1, collateralCreditQuotes: [{ name: "A", value: 200 }], collateralCreditApplied: 120, residualDebt: 80, remaining: 80 }), /Applied: \$120. Residual debt: \$80/);
const controls = [];
const settingsBody = {
  html: "",
  get innerHTML() { return this.html; },
  set innerHTML(html) {
    this.html = html;
    controls.length = 0;
    for (const match of html.matchAll(/<(?:button|select|input)\b[^>]*\bdata-setting="([^"]+)"[^>]*>/g)) controls.push({ dataset: { setting: match[1] }, disabled: false, setAttribute() {} });
  },
  querySelectorAll() { return controls; },
};
const rail = { classList: { toggle() {} } };
const start = { querySelector: () => ({ textContent: "" }) };
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.localStorage = globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { querySelector: selector => ({ "#right-rail-game": rail, "#right-rail-lobby": rail, "#lobby-start-btn": start, "#lobby-settings-body": settingsBody })[selector] || null };
const { state } = await import("./clientState.js");
const { renderLobbyRail } = await import("./clientLobbyUi.js");
const { playerContractRailHTML } = await import("./clientRailRender.js");
state.phase = "lobby";
state.players = [{ id: "p1", serverId: "borrower", isHost: true }];
state.settings = { ...state.settings, rulesProfile: "standard", playerFinance: false };
renderLobbyRail();
assert.match(settingsBody.innerHTML, /data-setting="rulesProfile"[^>]*aria-label="Starting Preset"/);
assert.doesNotMatch(settingsBody.innerHTML, /require Advanced|unlocks optional systems/);
assert.match(settingsBody.innerHTML, /data-setting="playerFinance"/);
for (const key of ["playerFinance", "bankLoans", "casino", "flights", "market", "globalEvents"]) assert.equal(controls.find(control => control.dataset.setting === key)?.disabled, false, `Standard allows the host to customize ${key}`);
state.settings = { ...state.settings, rulesProfile: "advanced", playerFinance: true };
renderLobbyRail();
assert.match(settingsBody.innerHTML, /data-setting="playerFinance"/);
assert.equal(controls.find(control => control.dataset.setting === "casino").disabled, false);
state.settings = { ...state.settings, rulesProfile: "standard", playerFinance: false };
state.phase = "playing";
state.playerContracts = { active: [{ id: "legacy-debt", kind: "loan", status: "active", fromPlayerId: "lender", toPlayerId: "borrower", remaining: 80, dueRound: 7 }] };
state.playerContractOffer = null;
state.offers = [];
state.pendingTrade = null;
state.serverTiles = [];
const positions = playerContractRailHTML("active");
assert.match(positions, /data-player-contract-repay="legacy-debt"/);
assert.match(positions, /data-finance-view="legacy-debt"/);
assert.doesNotMatch(positions, /data-finance-open=/);
assert.match(positions, /Enable Player Finance/);
state.phase = "lobby";
state.players[0].isHost = false;
renderLobbyRail();
assert.ok(controls.every(control => control.disabled), "preset freedom preserves host-only settings");
console.log("PASS all starting presets allow customization and preserve host-only settings and legacy repayment");
