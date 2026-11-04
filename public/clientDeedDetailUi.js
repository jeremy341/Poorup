// DEED DETAIL / HOUSE MANAGER: the deed modal (renderDeedDetail, open and close), the even-build
// and even-sell rule mirrors, and the build, sell and mortgage emitters. The MY DEEDS card click
// that opens it is here too. emitServer is injected; markup and payloads must match main.js.
import { $, esc } from "./clientDom.js";
import { closeButtonHTML } from "./clientCloseButton.js";
import { state } from "./clientState.js";
import { RENT_TABLE, HOTEL_LEVEL, TILES, mortgageValue, unmortgageCost } from "./clientBoardData.js";
import { ownsFullGroup } from "./clientDeedRules.js";
import { deedCurrentRentLabel, deedLadderHTML } from "./clientDeedsRender.js";
import { closeSurface, openSurface } from "./clientSurfaces.js";
import { accentOf, kindLabel, popIconHTML, popRow } from "./clientPopupUi.js";
import { airportFeesHTML, bindAirportFees } from "./clientFlightUi.js";
import { openTradeModalForDeed } from "./clientTradeUi.js";

let host = { emitServer: noop, say: noop, renderAll: noop, captureActionStatusNode: () => null, announceActionStatus: noop };

function noop() {}

function manageProperty(tileIndex, action) {
  const trigger = document.activeElement;
  const triggerId = trigger?.id;
  const statusNode = host.captureActionStatusNode(trigger);
  const payload = { tileIndex, action };
  host.emitServer("manage-property", payload, (response) => {
    if (response?.success === false) {
      host.announceActionStatus(response.error || "Property action could not be completed.", statusNode);
    }
    const restoreFocus = document.activeElement === trigger || document.activeElement === document.body;
    host.renderAll();
    if (restoreFocus && state.deedDetail === tileIndex && !$("#deed-modal")?.classList.contains("is-hidden")) {
      const target = triggerId && document.getElementById(triggerId);
      const nextSell = action === "sell-house" ? $("#dd-trade-deed") : null;
      const focusTarget = target && !target.disabled ? target : nextSell && !nextSell.disabled ? nextSell : $("#dd-close");
      focusTarget?.focus();
    }
  });
}

export function configureDeedDetail(hooks) {
  host = { ...host, ...hooks };
}

function buildNextHouse(tile) {
  manageProperty(tile.i, "build-house");
}

function sellHouse(tile) {
  manageProperty(tile.i, "sell-house");
}

export function tradeDeedActionHTML({ mine, action, label = "SELL DEED" }) {
  if (!mine) return "";
  const reason = action?.reason || "Property trade is unavailable right now.";
  return `<button class="btn-dark dd-context-sell" id="dd-trade-deed" ${!action?.enabled ? "disabled" : ""} aria-describedby="dd-trade-deed-note">
      <span class="t-label">${label}</span>
    </button>
    <p class="dd-context-note" id="dd-trade-deed-note">${action?.enabled ? "Offer this deed in a trade and agree on the price." : esc(reason)}</p>`;
}

export function deedManagementActionsHTML(mortgageBtn, sellBtn) {
  return `<div class="dd-deed-actions">${mortgageBtn}${sellBtn}</div>`;
}

export function authoritativeBuildingLevel(serverTile, fallbackLevel = 0) {
  const level = Number(serverTile?.houseCount);
  return Number.isInteger(level) && level >= 0 ? level : (Number(fallbackLevel) || 0);
}

export function contextualSellMode(level) {
  return Number(level) > 0 ? "sell-house" : "sell-deed";
}

/** Mirror of canBuildEvenly for selling: no deed may fall 2+ below another. */
function canSellEvenly(tile, targetLevel) {
  return groupEvenOk(tile, targetLevel, true);
}

function violatesEvenRule(lvl, targetLevel, selling) {
  if (!selling) return lvl + 1 < targetLevel;
  return lvl > targetLevel + 1;
}

function groupEvenOk(tile, targetLevel, selling) {
  if (!tile.group) return true;
  for (const t of TILES) {
    if (t.group !== tile.group) continue;
    if (t.i === tile.i) continue;
    if (violatesEvenRule(state.houses[t.i] || 0, targetLevel, selling)) return false;
  }
  return true;
}

function openDeedDetail(tileIdx, trigger = null) {
  state.deedDetail = tileIdx;
  renderDeedDetail();
  openSurface("#deed-modal", "#dd-close", { trigger });
}

function closeDeedDetail() {
  state.deedDetail = null;
  closeSurface("#deed-modal");
}

function renderDeedDetail() {
  if (state.deedDetail == null) return;
  const tile = TILES[state.deedDetail];
  const serverTile = state.serverTiles.find(entry => Number(entry.index) === Number(tile.i)) || null;
  const projectedActions = serverTile?.propertyActions || null;
  const me = state.players[0];
  const mine = state.owners[tile.i] === "p1";
  const isProperty = tile.kind === "property";
  const level = authoritativeBuildingLevel(serverTile, state.houses[tile.i] || 0);
  const isMortgaged = !!state.mortgaged[tile.i];
  const tradeDeedAction = projectedActions?.tradeDeed || null;
  const table = isProperty ? RENT_TABLE[tile.group] : null;
  const houseCost = isProperty ? Number(serverTile?.houseCost) || table.housePrice : 0;
  const hasSet = isProperty && ownsFullGroup("p1", tile.group);
  const nextLevel = level + 1;

  // ---- build gating -------------------------------------------------
  let buildReason = "";
  let canBuildPrimary = false;
  let primaryBuyLabel = "BUY HOUSE";
  let sellControlHTML = "";
  if (isProperty && mine) {
    const canAfford = me.cash >= houseCost;
    const evenOk = canBuildEvenly(tile, nextLevel);
    const maxed = level >= HOTEL_LEVEL;

    let reason = "";
    if (projectedActions?.buildHouse && !projectedActions.buildHouse.enabled) reason = projectedActions.buildHouse.reason;
    else if (isMortgaged) reason = "Unmortgage this deed before building on it.";
    else if (!hasSet) reason = `You need every ${tile.group.toUpperCase()} deed to build here.`;
    else if (maxed) reason = "Fully developed: hotel already built.";
    else if (!evenOk) reason = "Build evenly: raise the lower deeds in this set first.";
    else if (!canAfford) reason = `You need $${houseCost} to build here.`;

    canBuildPrimary = projectedActions?.buildHouse ? projectedActions.buildHouse.enabled : !reason;
    buildReason = reason;
    const sellMode = contextualSellMode(level);
    const sellAction = sellMode === "sell-house" ? projectedActions?.sellHouse : tradeDeedAction;
    const canSellHouse = level > 0 && (projectedActions?.sellHouse
      ? projectedActions.sellHouse.enabled
      : canSellEvenly(tile, level - 1));
    const canSellDeed = level === 0 && !!tradeDeedAction?.enabled;
    const canSell = sellMode === "sell-house" ? canSellHouse : canSellDeed;
    const sellReason = !canSell ? (sellAction?.reason || (sellMode === "sell-house"
      ? (!canSellEvenly(tile, level - 1) ? "Sell evenly: sell from the tallest deeds in this set first." : "You cannot sell here right now.")
      : "Property trade is unavailable right now.")) : "";
  primaryBuyLabel = maxed ? "HOTEL BUILT" : nextLevel === HOTEL_LEVEL ? "BUY HOTEL" : "BUY HOUSE";
    const sellLabel = sellMode === "sell-house" ? (level === HOTEL_LEVEL ? "SELL HOTEL" : "SELL HOUSE") : "SELL DEED";
    sellControlHTML = sellMode === "sell-deed"
      ? tradeDeedActionHTML({ mine, action: tradeDeedAction, label: "SELL DEED" })
      : `<button class="btn-dark dd-context-sell" id="dd-sell" ${canSell ? "" : "disabled"} ${sellReason ? 'aria-describedby="dd-sell-note"' : ''}>
          <span class="t-label">${sellLabel}</span><span class="t-micro">+$${projectedActions?.sellHouse?.cost ?? Math.floor(houseCost / 2)}</span>
        </button>${sellReason ? `<span class="dd-context-note" id="dd-sell-note">${esc(sellReason)}</span>` : ''}`;
  }

  const mortgageAction = isMortgaged ? projectedActions?.unmortgage : projectedActions?.mortgage;
  const colorSetHasBuildings = isProperty && TILES.some(candidate => candidate.group === tile.group
    && authoritativeBuildingLevel(state.serverTiles.find(entry => Number(entry.index) === Number(candidate.i)), state.houses[candidate.i] || 0) > 0);
  const mortgageReason = mine
    ? mortgageAction?.reason
      ? (!isMortgaged && colorSetHasBuildings && mortgageAction.reason === "You cannot mortgage this property right now."
        ? "Sell all buildings in this color set before mortgaging." : mortgageAction.reason)
      : (!isMortgaged && !mortgageAction && colorSetHasBuildings ? "Sell all buildings in this color set before mortgaging." : "")
    : "";
  const mortgageDisabled = mortgageAction ? !mortgageAction.enabled : (!isMortgaged && colorSetHasBuildings);
  const mortgageBtn = mine
    ? `<button class="btn-dark dd-close${isMortgaged ? " dd-redeem" : ""}" id="dd-mortgage" ${mortgageDisabled ? "disabled" : ""} ${mortgageReason ? 'aria-describedby="dd-mortgage-reason"' : ""}>
        <span class="t-label f11">${isMortgaged ? `UNMORTGAGE $${mortgageAction?.cost ?? unmortgageCost(tile)}` : `MORTGAGE +$${mortgageAction?.cost ?? mortgageValue(tile)}`}</span>
      </button>`
    : "";
  const sellButton = isProperty && mine ? "" : tradeDeedActionHTML({ mine, action: tradeDeedAction });

  $("#deed-card-detail").innerHTML = `
    <div class="dd-rail" style="background:${accentOf(tile)}"></div>
    <div class="dd-body${isMortgaged ? " dd-is-mortgaged" : ""}">
      <div class="dd-head">
        <div class="dd-icon">${popIconHTML(tile)}</div>
        <div class="pop-headtext">
          <div class="t-micro g400">${isProperty ? `${tile.group.toUpperCase()} SET` : tile.kind === 'utility' ? 'UTILITY DEED' : kindLabel(tile)} · $${Number(tile.price).toLocaleString()}${isMortgaged ? " · MORTGAGED" : ""}</div>
          <h3 class="t-section dd-title" id="deed-card-title">${tile.name}</h3>
        </div>
        ${closeButtonHTML({ id: "dd-close", label: "Close deed details", className: "dd-close" })}
      </div>

      ${isMortgaged ? `<div class="dd-mortgage-status"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 8V5a4 4 0 0 1 8 0v3M3 8h12v9H3z"/><path d="M9 11v3"/></svg><span class="t-label f11">MORTGAGED · RENT PAUSED</span></div>` : ""}
      <div class="dd-stats">
        ${popRow(isProperty ? "CURRENT RENT" : (tile.kind === "utility" ? "RENT MULTIPLIER" : "CURRENT RENT"), deedCurrentRentLabel(tile, level), "green")}
      </div>

      <div class="dd-ladder" role="group" aria-label="Rent schedule">${deedLadderHTML(tile, level)}</div>

      <div class="dd-primary-build">${isProperty && mine ? `<button class="${canBuildPrimary ? "cta-red" : "btn-dark dd-buy-blocked"} dd-build-btn" id="dd-buy" ${canBuildPrimary ? "" : "disabled"}>
        <span class="t-label">${primaryBuyLabel}</span><span class="t-micro">$${houseCost}</span>
      </button>${!canBuildPrimary && buildReason ? `<p class="dd-build-msg">${esc(buildReason)}</p>` : ""}` : ""}</div>

      ${tile.kind === "railroad" && /AIRPORT/i.test(tile.name) ? `<details class="dd-airport-details"><summary>Airport fees</summary>${airportFeesHTML(tile, mine)}</details>` : airportFeesHTML(tile, mine)}

      ${deedManagementActionsHTML(mortgageBtn, isProperty && mine ? sellControlHTML : sellButton)}
      ${mortgageReason ? `<p class="t-body ink-2" id="dd-mortgage-reason">${esc(mortgageReason)}</p>` : ""}
    </div>`;

  // these all funnel through renderAll(), which re-renders this modal in place
  $("#dd-close").addEventListener("click", closeDeedDetail);
  if (mine) bindAirportFees($("#deed-card-detail"), tile);
  $("#dd-buy")?.addEventListener("click", event => { host.captureActionStatusNode(event.currentTarget); buildNextHouse(tile); });
  $("#dd-sell")?.addEventListener("click", event => {
    host.captureActionStatusNode(event.currentTarget);
    sellHouse(tile);
  });
  $("#dd-trade-deed")?.addEventListener("click", event => {
    host.captureActionStatusNode(event.currentTarget);
    closeDeedDetail();
    const returnTrigger = document.activeElement === document.body ? null : document.activeElement;
    openTradeModalForDeed(tile.i, returnTrigger);
  });
  $("#dd-mortgage")?.addEventListener("click", event => {
    host.captureActionStatusNode(event.currentTarget);
    if (state.mortgaged[tile.i]) unmortgageTile(tile.i);
    else mortgageTile(tile.i);
  });
}

/** Monopoly rule: you can only add a house to a property if doing so keeps
 *  the +1 step in step with every other deed in the group. */
function canBuildEvenly(tile, targetLevel) {
  return groupEvenOk(tile, targetLevel, false);
}

function mortgageTile(tileIdx) {
  manageProperty(tileIdx, "mortgage");
}

function unmortgageTile(tileIdx) {
  manageProperty(tileIdx, "unmortgage");
}

function onRailDeedClick(e) {
  if (e.target.closest("[data-buy]")) return;
  if (e.target.closest("[data-trade]")) return;
  const card = e.target.closest("[data-deed-open]");
  if (card) openDeedDetail(Number(card.dataset.deedOpen), card);
}

export function bindDeedDetail() {
  // open the deed / house manager from a MY DEEDS card
  $("#rr-body")?.addEventListener("click", onRailDeedClick);
  $("#deed-scrim")?.addEventListener("click", closeDeedDetail);
}

export { openDeedDetail, closeDeedDetail, renderDeedDetail };
