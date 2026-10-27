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
const deedStyles = source("./ui-review-deeds.css");
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
  expectMatch(detail, /class="dd-ladder" role="group" aria-label="Rent schedule"/);
});

check("deed trade action closes its inspector before opening the trade dialog", () => {
  const listener = detail.match(/\$\("#dd-trade-deed"\)\?\.addEventListener\("click",\s*event\s*=>\s*\{([\s\S]*?)\n\s{2}\}\);/)?.[1] || "";
  assert.ok(listener, "deed trade click handler exists");
  assert.ok(listener.indexOf("closeDeedDetail()") >= 0, "deed inspector closes");
  assert.ok(listener.indexOf("closeDeedDetail()") < listener.indexOf("openTradeModalForDeed("), "close happens before trade opens");
  assert.match(listener, /const\s+returnTrigger\s*=\s*document\.activeElement/);
  assert.match(listener, /openTradeModalForDeed\(tile\.i,\s*returnTrigger\)/);
});

check("SELL DEED action fits beside mortgage without a redundant buyer sublabel", () => {
  const action = detail.match(/export function tradeDeedActionHTML\([\s\S]*?\n\}/)?.[0] || "";
  assert.match(action, /id="dd-trade-deed"/);
  assert.doesNotMatch(action, /AGREED WITH BUYER/);
});

check("trade card columns shrink around long deed names without clipping the body", () => {
  expectMatch(deedStyles, /#trade-modal\s+\.trade-body\s*\{[^}]*min-width:\s*0/i);
  expectMatch(deedStyles, /#trade-modal\s+\.trade-cols\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/i);
  expectMatch(deedStyles, /#trade-modal\s+\.trade-side\s*\{[^}]*min-width:\s*0/i);
  expectMatch(deedStyles, /#trade-modal\s+\.trade-deed\s*\{[^}]*min-width:\s*0/i);
});

check("mortgaged trade rows do not render the legacy duplicate badge", () => {
  expectMatch(deedStyles, /#trade-modal\s+\.trade-deed\.is-mortgaged\s+\.trade-deed-name::after\s*\{[^}]*content:\s*none/i);
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
  state.owners = { 15: "p1", 49: "p1" };
  assert.equal(deedUi.deedCurrentRentLabel(waterworks), "10× DICE ROLL");
  state.owners = { 15: "p1", 37: "p1", 49: "p1" };
  assert.equal(deedUi.deedCurrentRentLabel(waterworks), "14× DICE ROLL", "Metro-52 third utility steps to 14x (F-014)");
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
  expectMatch(modals, /closeButtonHTML\(\{\s*id:\s*"offer-close",\s*label:\s*"Close offer and keep it pending"/);
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

{
  const deedDetailUi = await import("./clientDeedDetailUi.js");
  const { state } = clientState;
  const brown = boardData.STANDARD_TILES.filter(tile => tile.kind === "property" && tile.group === "brown");
  const realQuery = globalThis.document.querySelector;
  const render = owners => {
    let markup = "";
    const stubEl = { addEventListener() {}, querySelectorAll: () => [], set innerHTML(value) { markup = value; } };
    globalThis.document.querySelector = () => stubEl;
    Object.assign(state, { owners, houses: {}, mortgaged: {}, serverTiles: [], deedDetail: brown[0].i });
    state.players = [{ id: "p1", serverId: "s1", cash: 1500 }];
    deedDetailUi.renderDeedDetail();
    globalThis.document.querySelector = realQuery;
    state.deedDetail = null;
    return markup;
  };
  const buyTag = markup => markup.match(/<button[^>]*id="dd-buy"[^>]*>/)?.[0] || "";
  check("a blocked Buy house is disabled and not the red primary button", () => {
    const tag = buyTag(render({ [brown[0].i]: "p1" }));
    assert.ok(tag, "Buy house renders");
    assert.match(tag, / disabled(?: |>)/);
    assert.doesNotMatch(tag, /cta-red/);
  });
  check("Buy house stays the red primary button when building is allowed", () => {
    const tag = buyTag(render(Object.fromEntries(brown.map(tile => [tile.i, "p1"]))));
    assert.match(tag, /cta-red/);
    assert.doesNotMatch(tag, / disabled(?: |>)/);
  });
  check("mortgage is blocked until every building in the color set is sold", () => {
    const realQuery = globalThis.document.querySelector;
    let markup = "";
    const stubEl = { addEventListener() {}, querySelectorAll: () => [], set innerHTML(value) { markup = value; } };
    globalThis.document.querySelector = () => stubEl;
    Object.assign(state, {
      owners: Object.fromEntries(brown.map(tile => [tile.i, "p1"])),
      houses: { [brown[1].i]: 1 }, mortgaged: {},
      serverTiles: brown.map(tile => ({ index: tile.i, houseCount: tile.i === brown[1].i ? 1 : 0 })),
      deedDetail: brown[0].i,
    });
    state.players = [{ id: "p1", serverId: "s1", cash: 1500 }];
    deedDetailUi.renderDeedDetail();
    globalThis.document.querySelector = realQuery;
    state.deedDetail = null;
    assert.match(markup.match(/<button[^>]*id="dd-mortgage"[^>]*>/)?.[0] || "", / disabled(?: |>)/);
    assert.match(markup, /Sell all buildings in this color set before mortgaging/);
  });
}
const failures = checks.filter(result => !result.passed);
for (const result of checks) {
  if (result.passed) console.log(`PASS ${result.name}`);
  else console.error(`FAIL ${result.name}: ${result.error.message}`);
}
console.log(`in-game UX regression tests: ${checks.length - failures.length} passed, ${failures.length} failed`);
if (failures.length) throw failures[0].error;
