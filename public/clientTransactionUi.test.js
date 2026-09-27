/* global process */
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const modals = read("clientGameModalsUi.js");
const keyboard = read("clientKeyboard.js");
const surfaces = read("clientSurfaces.js");
const auction = read("clientAuctionUi.js");
const trade = read("clientTradeUi.js");
const deal = read("clientDealUi.js");
const rail = read("clientRailRender.js");
const styles = read("styles.css");
const hud = read("clientHudRender.js");
const logDrawer = read("clientLogDrawer.js");
const main = read("main.js");
const social = read("clientSocialSurfaces.js");
const parlor = read("clientParlorBindings.js");

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

check("purchase backdrop and Escape dismissal stay neutral", () => {
  assert.match(modals, /function closeChoiceModalWithoutAction\(\)/);
  assert.match(modals, /scrim\.onclick = closeChoiceModalWithoutAction/);
  assert.match(modals, /Dismissal is intentionally neutral/i);
  assert.match(keyboard, /"choice-modal": \(\) => closeSurface\("#choice-modal"\)/);
  assert.doesNotMatch(keyboard, /"choice-modal": \(\) => host\.closeChoiceModalAsPass\(\)/);
});

check("closed dropdown options stay out of the modal focus trap", () => {
  assert.match(surfaces, /!el\.hidden/);
  assert.match(surfaces, /el\.closest\("\[hidden\]"\)/);
});

check("live auction updates keep the card shell and announce meaningful changes", () => {
  assert.match(auction, /auctionTile/);
  assert.match(auction, /auctionFocusKey\(document\.activeElement\)/);
  assert.match(auction, /aria-live="polite"/);
});

check("loan preview distinguishes secured and unsecured terms", () => {
  assert.match(trade, /function loanPreviewCopy\(tile, amount\) \{[\s\S]*UNSECURED LOAN/);
  assert.match(trade, /financingPreviewMode === "loan"[\s\S]*financingEligibleCollateralIndex/);
  assert.match(trade, /contract\.collateralTileIndex/);
});

check("collateral selector expands from one read-only field into a multi-select list", () => {
  assert.match(trade, /<input class="field financing-collateral-trigger" type="text"[^>]*data-collateral-trigger readonly/);
  assert.equal((trade.match(/return collateralPickerHTML\(/g) || []).length, 2);
  assert.doesNotMatch(trade, /data-collateral-sort|data-collateral-search|SORT BY|SEARCH DEEDS|type="search"/);
  assert.doesNotMatch(trade, /UNSECURED LOAN · NO PROPERTY REQUIRED/i);
  assert.doesNotMatch(trade, /No rent or ownership share is attached to this mode/i);
  assert.equal((trade.match(/<details class="financing-collateral/g) || []).length, 0);
  assert.equal((trade.match(/<summary><span class="t-label f11 g-muted">COLLATERAL/g) || []).length, 0);
  assert.match(trade, /function setCollateralPickerOpen\(picker, open[\s\S]*aria-expanded/);
  assert.doesNotMatch(trade, /Every selected deed/i);
  assert.match(trade, /aria-label="Choose collateral deeds/);
  assert.match(trade, /data-finance-collateral[\s\S]*checked/);
  assert.match(trade, /data-negotiation-field="negotiation-collateral"[\s\S]*checked/);
  assert.match(trade, /function negotiationOwnedPropertyOptions\(contract\)[\s\S]*contract\?\.toPlayerId[\s\S]*player\.serverId === borrowerId[\s\S]*state\.owners\[tile\.i\] === borrower\.id/);
  assert.doesNotMatch(trade, /function negotiationOwnedPropertyOptions\(\)[\s\S]*state\.owners\[tile\.i\] === "p1"/);
  assert.match(styles, /\.financing-collateral-panel\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
  assert.match(styles, /\.financing-collateral-options\s*\{[^}]*max-height:\s*112px[^}]*overflow-y:\s*auto/s);
});

check("player contract summaries call premium interest and rules explain unlimited turn time", () => {
  assert.match(deal, /TOTAL INTEREST/);
  assert.doesNotMatch(deal, /% PREMIUM/);
  assert.match(rail, /TOTAL INTEREST/);
  assert.doesNotMatch(rail, /ADVANCE · .*% PREMIUM/);
  assert.match(deal, /if \(\["loan", "hybrid"\]\.includes\(contract\.kind \|\| "loan"\)\)/);
  assert.match(rail, /const interest = \["loan", "hybrid"\]\.includes\(offer\.kind \|\| "loan"\)/);
  assert.doesNotMatch(deal, /PREMIUM/);
  assert.doesNotMatch(rail, /% PREMIUM/);
  assert.match(social, /unlimited time for each turn/i);
  assert.match(social, /inactivity removal clock/i);
  assert.doesNotMatch(social, /<strong[^>]*>Turn Timer<\/strong>/i);
  assert.doesNotMatch(social, /Off, 30 seconds, 60 seconds, or 2 minutes/i);
  assert.match(social, /total interest/i);
  assert.match(trade, /updateCollateralPickerLabel\(event\.target\.closest\("\[data-collateral-root\]"\)\)/);
});

check("partial repayment sends a bounded amount and reports settlement", () => {
  assert.match(trade, /Math\.min\(requested, remaining\)/);
  assert.match(trade, /const status = `Repaid \$\$\{settled/);
});

check("per-turn timer is absent from the HUD and only room presence is wired", () => {
  assert.doesNotMatch(hud, /turnTimer|turnDeadline|hud-timer/i);
  assert.doesNotMatch(main, /startTurnCountdown|configureTurnCountdown|turnTimer/i);
  assert.match(main, /createPresenceMonitor/);
});

check("open event log refreshes from snapshots without losing reader position", () => {
  assert.match(logDrawer, /scrollHeight/);
  assert.match(logDrawer, /data-log-new-status/);
  assert.match(main, /isLogDrawerOpen\(\)/);
  assert.match(main, /renderStep\("Event log", renderLogDrawer\)/);
});

check("social, rankings, and season requests fail visibly within a bounded window", () => {
  assert.match(social, /SOCIAL_REQUEST_TIMEOUT_MS/);
  assert.match(social, /state\.socialLoading/);
  assert.match(social, /data-social-retry/);
  assert.match(social, /seasonRequestId/);
  assert.match(parlor, /data-season-retry/);
});

check("social actions show pending feedback and ignore stale searches", () => {
  assert.match(parlor, /socialSearchRequestId/);
  assert.match(parlor, /aria-busy/);
  assert.match(parlor, /PROCESSING…/);
  assert.match(parlor, /setTimeout/);
});

console.log(`client transaction UI tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
