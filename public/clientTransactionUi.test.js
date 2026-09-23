/* global process */
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const modals = read("clientGameModalsUi.js");
const keyboard = read("clientKeyboard.js");
const surfaces = read("clientSurfaces.js");
const auction = read("clientAuctionUi.js");
const trade = read("clientTradeUi.js");
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

check("partial repayment sends a bounded amount and reports settlement", () => {
  assert.match(trade, /Math\.min\(requested, remaining\)/);
  assert.match(trade, /const status = `Repaid \$\$\{settled/);
});

check("turn timer remains visible through resolution and is announced accessibly", () => {
  assert.doesNotMatch(hud, /function timerShownNow\(\) \{[^}]*return state\.turnStage === "roll";/);
  assert.doesNotMatch(hud, /function timerActive\(waiting, isLobby\) \{[^}]*return state\.turnStage === "roll";/);
  assert.match(hud, /setAttribute\("aria-live", "polite"\)/);
});

check("open event log refreshes from snapshots without losing reader position", () => {
  assert.match(logDrawer, /scrollHeight/);
  assert.match(logDrawer, /data-log-new-status/);
  assert.match(main, /isLogDrawerOpen\(\)/);
  assert.match(main, /renderLogDrawer\(\)/);
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
