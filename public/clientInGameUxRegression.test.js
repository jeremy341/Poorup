import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const source = name => readFileSync(new URL(name, import.meta.url), "utf8");
const checks = [];
function check(name, assertion) {
  try {
    assertion();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error });
  }
}
function expectMatch(text, pattern, message) {
  assert.ok(pattern.test(text), message || `Expected pattern ${pattern}`);
}

const board = source("./clientBoardRender.js");
const popup = source("./clientPopupUi.js");
const deeds = source("./clientDeedsRender.js");
const detail = source("./clientDeedDetailUi.js");
const modals = source("./clientGameModalsUi.js");
const sync = source("./clientStateSync.js");
const rail = source("./clientRailRender.js");
const responsive = source("./game-responsive.css");
const styles = source("./styles.css");
const dealUi = source("./clientDealUi.js");

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const [{ tileSupportsInspection }, boardData, popupUi, deedUi, clientState, clientSocket] = await Promise.all([
  import("./clientTileInteraction.js"),
  import("./clientBoardData.js"),
  import("./clientPopupUi.js"),
  import("./clientDeedsRender.js"),
  import("./clientState.js"),
  import("./clientSocketListeners.js"),
]);
const { state } = clientState;

check("corner tiles retain accessible presence and cannot invoke inspection", () => {
  expectMatch(board, /tileSupportsInspection/);
  expectMatch(board, /aria-disabled/);
  expectMatch(board, /setAttribute\("tabindex", "0"\)/);
  expectMatch(source("./clientPopupUi.js"), /if\s*\(!tileSupportsInspection\(tile\)\)\s*return/);
  for (const tile of [...boardData.STANDARD_TILES, ...boardData.METRO_TILES]) {
    assert.equal(tileSupportsInspection(tile), !tile.kind.startsWith("corner-"), tile.name);
  }
  for (const kind of ["tax", "chance", "chest", "property", "railroad", "utility"]) {
    assert.equal(tileSupportsInspection({ kind }), true, `${kind} remains inspectable`);
  }
});

check("tile inspection and deed management share the rent ladder", () => {
  expectMatch(popup, /deedLadderHTML/);
  expectMatch(deeds, /deedLadderHTML/);
  expectMatch(popup, /class="dd-body"/);
  expectMatch(popup, /class="dd-head"/);
  assert.doesNotMatch(popup, /function rentRailroadRows/);
  assert.doesNotMatch(popup, /function rentUtilityRows/);
  expectMatch(detail, /tileRentExplanation/);
});

check("tile-aware labels and ladders name airports and utilities accurately", () => {
  const airports = boardData.STANDARD_TILES.filter(tile => tile.kind === "railroad");
  for (const tile of airports) {
    assert.equal(popupUi.kindLabel(tile), "AIRPORT DEED");
    const ladder = deedUi.deedLadderHTML(tile);
    assert.match(ladder, /1 AIRPORT/);
    assert.match(ladder, /4 AIRPORTS/);
    assert.doesNotMatch(ladder, /RAILROAD/);
  }
  for (const name of ["ELECTRIC COMPANY", "WATER COMPANY"]) {
    const tile = boardData.STANDARD_TILES.find(entry => entry.name === name);
    assert.equal(popupUi.kindLabel(tile), `${name} DEED`);
    assert.match(popupUi.effectText(tile), new RegExp(name));
    const ladder = deedUi.deedLadderHTML(tile);
    assert.match(ladder, /1 UTILITY/);
    assert.match(ladder, /2 UTILITIES/);
    assert.match(ladder, /4× DICE/);
    assert.match(ladder, /10× DICE/);
  }
  state.owners = { 12: "p1", 28: "p2" };
  assert.equal(deedUi.deedCurrentRentLabel(boardData.STANDARD_TILES[12]), "4× DICE ROLL");
  state.owners[28] = "p1";
  assert.equal(deedUi.deedCurrentRentLabel(boardData.STANDARD_TILES[12]), "10× DICE ROLL");
  boardData.setBoardVariant("metro-52");
  const waterworks = boardData.TILES.find(tile => tile.name === "WATERWORKS");
  assert.equal(popupUi.kindLabel(waterworks), "WATERWORKS DEED");
  assert.match(popupUi.effectText(waterworks), /2 or more utilities/);
  state.owners = { 15: "p1", 37: "p1", 49: "p1" };
  assert.equal(deedUi.deedCurrentRentLabel(waterworks), "10× DICE ROLL");
  const socketOffer = clientSocket.normalizeTradeOffer({
    id: "socket-only",
    from: "remote-player",
    to: "local-player",
    giveCash: 300,
    requestCash: 100,
    requestPropertyIndexes: [12],
  });
  assert.equal(socketOffer.fromPlayerId, "remote-player");
  assert.equal(socketOffer.toPlayerId, "local-player");
  assert.deepEqual(socketOffer.requestPropertyIndexes, [12]);
  boardData.setBoardVariant("standard-40");
});

check("trade offer dismissal persists by room and trade id and remains neutral", () => {
  const dismissal = source("./clientTradeOfferDismissal.js");
  expectMatch(dismissal, /sessionStorage/);
  expectMatch(modals, /id="offer-close"[^>]*>[\s\S]*?Close/);
  expectMatch(modals, /dismissTradeOffer/);
  expectMatch(sync, /reconcileTradeOfferDismissal/);
  expectMatch(rail, /state\.offers/);
  expectMatch(dealUi, /trade\.toPlayerId\s*===\s*localServerId\(\)/);
  const closeHandler = modals.match(/function closeOfferWithoutResponse\(\)\s*\{[^}]*\}/)?.[0] || "";
  assert.ok(closeHandler, "neutral offer close handler exists");
  assert.doesNotMatch(closeHandler, /emitServer|respond-trade/);
  expectMatch(modals, /offer-scrim[^\n]*closeOfferWithoutResponse/);
  assert.doesNotMatch(modals, /Keep for later/);
});

check("trade offer body reads as a sentence and its actions stay balanced", () => {
  expectMatch(styles, /\.offer-rows\s*\{[^}]*display:\s*block/);
  expectMatch(styles, /\.offer-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  expectMatch(styles, /@media\s*\(max-width:\s*480px\)[^{]*\{\s*\.offer-actions\s*\{\s*grid-template-columns:\s*1fr/s);
});

check("Emergency Liquidity collateral spans the terms grid and the modal scrolls internally", () => {
  expectMatch(styles, /bank-offer-terms\s*>\s*\.bank-offer-collateral\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/i);
  expectMatch(styles, /bank-offer-content[^}]*overflow-y:\s*auto/i);
  expectMatch(styles, /bank-offer-actions[^}]*flex:\s*0\s+0\s+auto/i);
});

check("responsive board rules preserve the previous Poorup font tokens", () => {
  assert.doesNotMatch(responsive, /IBM Plex Sans/);
  assert.doesNotMatch(responsive, /--font-ui\s*:/);
  expectMatch(source("./styles.css"), /--font-ui:\s*"Pixelify Sans"/);
  expectMatch(source("./styles.css"), /--font-pixel:\s*"Silkscreen"/);
  for (const asset of ["./assets/fonts/ibm-plex-sans-400.woff2", "./assets/fonts/ibm-plex-sans-600.woff2", "./assets/fonts/LICENSE-IBM-Plex-Sans.txt"]) {
    assert.equal(existsSync(new URL(asset, import.meta.url)), false, `${asset} was introduced with the temporary font pass`);
  }
});

const failures = checks.filter(result => !result.passed);
for (const result of checks) {
  if (result.passed) console.log(`PASS ${result.name}`);
  else console.error(`FAIL ${result.name}: ${result.error.message}`);
}
console.log(`in-game UX regression tests: ${checks.length - failures.length} passed, ${failures.length} failed`);
if (failures.length) throw failures[0].error;
