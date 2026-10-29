// TILE POPUP: the inspected-deed popup and the pure render helpers (accent, kind label, icon,
// effect copy, rent schedule) that the deed, choice and auction cards also reuse. Templates match
// the main.js markup byte for byte. Game-bound calls (buyTile, record) arrive via configurePopup hooks.
import { $, esc } from "./clientDom.js";
import { closeButtonHTML } from "./clientCloseButton.js";
import { state } from "./clientState.js";
import { GROUP_COLOR, RENT_TABLE, HOTEL_LEVEL } from "./clientBoardData.js";
import { spriteHTML } from "./clientSprites.js";
import { renderBoardState } from "./clientBoardRender.js";
import { openSurface, closeSurface } from "./clientSurfaces.js";
import { deedCurrentRentLabel, deedLadderHTML, tileRentExplanation } from "./clientDeedsRender.js";
import { tileSupportsInspection } from "./clientTileInteraction.js";
import { airportFeesHTML } from "./clientFlightUi.js";

let host = { buyTile: noop, record: noop, openDeedDetail: noop };

function noop() {}

export function configurePopup(hooks) {
  host = { ...host, ...hooks };
}

const KIND_LABEL = {
  property: "PROPERTY DEED",
  railroad: "RAILROAD DEED",
  utility: "UTILITY DEED",
  chance: "CHANCE TILE",
  chest: "CHEST TILE",
  tax: "TAX TILE",
};

const ACCENT_COLOR = {
  chance: "#d74438",
  chest: "#cfa75f",
  utility: "#3e7d7b",
  railroad: "#9b783d",
  "corner-vacation": "#78894f",
  "corner-go": "#d74438",
  "corner-go-jail": "#d74438",
};

const EFFECT_COPY = {
  property: "If this deed is unowned, you may buy it from the bank. If another player owns it, you pay the listed rent.",
  railroad: "Transit deed. In this parlor ruleset, landing here charges the listed rent when owned by another player.",
  utility: "Utility deed. If unowned, it can be purchased. If owned by another player, landing here charges the listed rent.",
  chance: "Draw a Chance card and resolve it immediately.",
  chest: "Draw a Chest card and resolve it immediately.",
  tax: (tile) => `Pay $${tile.price ?? 200} into the vacation pool.`,
  "corner-go": "Collect $200 when you pass or land on GO.",
  "corner-jail": "Just visiting. No penalty is applied on this square.",
  "corner-go-jail": "Move directly to Prison. Do not pass Start or collect $200.",
  "corner-parking": "Collect the full vacation pool jackpot if any cash has built up there.",
  "corner-vacation": "Vacation is a resting space. Collect the vacation pool when enabled.",
};

function popIconRailroad(tile) {
  if (tile.name.includes("AIRPORT")) {
    return `<img class="airport-mark airport-mark-popup" src="/assets/airport-plane.svg" alt="Airport">`;
  }
  return spriteHTML("train", 4);
}

function popIconUtility(tile) {
  if (tile.name === "ELECTRIC COMPANY") return spriteHTML("bulb", 4);
  return spriteHTML("faucet", 4);
}

const POP_ICONS = {
  railroad: popIconRailroad,
  utility: popIconUtility,
  chance: () => `<img class="board-icon-mark board-icon-popup board-icon-surprise" src="/assets/board-icons/surprise.svg" alt="Surprise">`,
  chest: () => `<img class="board-icon-mark board-icon-popup board-icon-chest" src="/assets/board-icons/treasure-chest.svg" alt="Treasure">`,
  tax: () => "",
  "corner-go": () => `<span class="go-big" style="font-size:28px">GO</span>`,
  "corner-go-jail": () => `<svg class="pop-prison-mark" viewBox="0 0 16 10" shape-rendering="crispEdges" aria-hidden="true">${[1, 4, 7, 10, 13].map(x => `<rect x="${x}" y="0" width="1.4" height="10" fill="currentColor"/>`).join("")}<rect x="0" y="4" width="16" height="1.2" fill="currentColor"/></svg>`,
  "corner-parking": () => spriteHTML("car", 5),
  "corner-vacation": () => spriteHTML("palm", 5),
};

export function kindLabel(tile) {
  if (tile?.kind === "railroad" && tile.name?.includes("AIRPORT")) return "AIRPORT DEED";
  if (tile?.kind === "utility" && tile.name) return `${tile.name} DEED`;
  return KIND_LABEL[tile.kind] || "CORNER TILE";
}

export function accentOf(tile) {
  if (tile.group) return GROUP_COLOR[tile.group];
  return ACCENT_COLOR[tile.kind] || "#5c5033";
}

export function effectText(tile) {
  if (tile?.kind === "railroad" && tile.name?.includes("AIRPORT")) {
    return "Airport rent increases with the number of airports you own.";
  }
  if (tile?.kind === "utility") return tileRentExplanation(tile);
  const entry = EFFECT_COPY[tile.kind] || "Board effect unavailable.";
  return typeof entry === "function" ? entry(tile) : entry;
}

export function popIconHTML(tile) {
  const builder = POP_ICONS[tile.kind];
  return builder ? builder(tile) : spriteHTML("diamond", 5);
}

export function popRow(label, value, cls = "ink") {
  return `<div class="pop-row"><span class="t-label f12 g-muted">${label}</span><span class="t-label f12 v ${cls}">${value}</span></div>`;
}

function popRentLabel(tile) {
  if (tile.kind === "utility") return deedCurrentRentLabel(tile);
  if (tile.rent != null) return `$${tile.rent}`;
  if (tile.kind === "tax") return `PAY $${tile.price ?? 200}`;
  return "-";
}

function popOwnerLabel(owner, buyable) {
  if (owner) return owner.name;
  return buyable ? "UNOWNED" : "BANK";
}

function popBuildTag(buyable, level) {
  if (!buyable || level <= 0) return "";
  if (level === HOTEL_LEVEL) return ` <span class="t-label f11 g300">- HOTEL</span>`;
  const plural = level === 1 ? "" : "S";
  return ` <span class="t-label f11 g300">- ${level} HOUSE${plural}</span>`;
}

function popColorSetRows(tile) {
  if (!tile.group) return "";
  return popRow("HOUSE COST", `$${RENT_TABLE[tile.group].housePrice}`, "g300");
}

function popRentSectionHTML(tile, buyable) {
  if (!buyable) return "";
  return `<div class="pop-effect-head">${spriteHTML("diamond", 3)}<span class="t-label f12 g300">RENT SCHEDULE</span></div><div class="dd-ladder">${deedLadderHTML(tile)}</div>`;
}

function popEffectHeading(tile) {
  return ["railroad", "utility"].includes(tile.kind) ? "RENT RULE" : "SPECIAL EFFECT";
}

function popOwnerFootHTML(owner) {
  if (!owner) return "";
  return `<span class="t-label f12" style="color:${owner.color}">OWNED BY ${esc(owner.name)}</span>`;
}

function popAuctionHintHTML(unowned) {
  if (!unowned || !state.settings.auction) return "";
  return `<div class="pop-buy-row"><p class="t-micro ink-3" style="text-align:center">AUCTION RULES ON - BUY WHEN YOU LAND HERE</p></div>`;
}

function popCanBuyNow(tile) {
  const me = state.players[0];
  if (me?.bankrupt || me?.spectating) return false;
  return state.pendingBuyTile === tile.i
    && me.cash >= (tile.price ?? 0)
    && state.phase === "playing"
    && state.turnIndex === 0
    && !state.busy;
}

function popBuyLabel(tile) {
  const me = state.players[0];
  if (me?.bankrupt || me?.spectating) return "SPECTATING";
  if (state.phase !== "playing") return "JOIN TO BUY";
  if (state.turnIndex !== 0) return "NOT YOUR TURN";
  if (state.pendingBuyTile !== tile.i) return "WAIT FOR LANDING";
  if (me.cash < (tile.price ?? 0)) return "INSUFFICIENT FUNDS";
  return "BUY DEED";
}

function popBuyRowHTML(tile, unowned) {
  const showBuy = unowned && !state.settings.auction;
  if (!showBuy) return popAuctionHintHTML(unowned);
  const canBuy = popCanBuyNow(tile);
  const label = popBuyLabel(tile);
  return `<div class="pop-buy-row">
              <button class="cta-red pop-buy" id="pop-buy" ${canBuy ? "" : "disabled"}>
                <span class="cta-text cta-text-sm">${label}</span>
              </button>
            </div>`;
}

// Your own deeds get a one-click way into the manager (build / sell / mortgage).
function popManageRowHTML(tile, owner) {
  if (!owner || owner.id !== "p1") return "";
  if (!["property", "railroad", "utility"].includes(tile.kind)) return "";
  const label = tile.kind === "property" ? "MANAGE · BUILD / SELL / MORTGAGE" : "MANAGE · MORTGAGE";
  return `<div class="pop-buy-row"><button class="btn-dark pop-manage" id="pop-manage" type="button" data-deed-open="${tile.i}"><span class="t-label f12">${label}</span></button></div>`;
}

export function popupCardHTML({ tile, owner, buyable, unowned, level }) {
  const rent = popRentLabel(tile);
  const ownerLabel = popOwnerLabel(owner, buyable);
  const buildTag = popBuildTag(buyable, level);
  return `
    <div class="pop-rail dd-rail" style="background:${accentOf(tile)}"></div>
    <div class="dd-body">
      <div class="dd-head">
        <div class="dd-icon">${popIconHTML(tile)}</div>
        <div class="pop-headtext">
          <div class="t-micro g400">${kindLabel(tile)}</div>
          <h3 class="t-section dd-title" id="popup-card-title">${tile.name}${buildTag}</h3>
        </div>
        ${closeButtonHTML({ id: "pop-close", label: "Close property details", className: "dd-close" })}
      </div>
      <div class="dd-stats">
        ${tile.kind === "tax" ? popRow("TAX", rent, "green") : ""}
        ${["property", "railroad", "utility"].includes(tile.kind) ? popRow("OWNER", ownerLabel, owner ? "ink" : "g-muted") : ""}
        ${popColorSetRows(tile)}
      </div>
      ${popRentSectionHTML(tile, buyable)}
      ${airportFeesHTML(tile, false)}
      ${tile.kind === "railroad" ? "" : `<div class="pop-effect-head">${spriteHTML("diamond", 3)}<span class="t-label f12 g300">${popEffectHeading(tile)}</span></div>
      <div class="pop-effect"><p class="t-body ink-2">${effectText(tile)}</p></div>`}
      ${popBuyRowHTML(tile, unowned)}
      ${popManageRowHTML(tile, owner)}
      <div class="pop-foot dd-foot">
        ${popOwnerFootHTML(owner)}
      </div>
    </div>`;
}

export function openPopup(tile) {
  state.selectedTile = tile;
  const ownerId = state.owners[tile.i];
  const owner = state.players.find((p) => p.id === ownerId);
  const buyable = ["property", "railroad", "utility"].includes(tile.kind);
  const unowned = buyable && !owner;
  const level = state.houses[tile.i] || 0;
  $("#popup-card").innerHTML = popupCardHTML({ tile, owner, buyable, unowned, level });
  openSurface("#popup", "#pop-close");
  $("#pop-close").addEventListener("click", closePopup);
  $("#pop-manage")?.addEventListener("click", () => {
    closePopup();
    import("./clientDeedDetailUi.js").then(module => module.openDeedDetail(tile.i));
  });
  const buyBtn = $("#pop-buy");
  if (buyBtn) buyBtn.addEventListener("click", () => { host.buyTile(tile); openPopup(tile); });
}

export function closePopup() {
  state.selectedTile = null;
  state.highlight = null;
  closeSurface("#popup");
  renderBoardState();
}

export function onTileClick(tile, trigger = null) {
  if (!tileSupportsInspection(tile)) return;
  const owner = state.players.find((p) => p.id === state.owners[tile.i]);
  host.record(`INSPECTED ${tile.name}${tile.price ? `, $${tile.price}` : ""}${owner ? `, OWNED BY ${owner.name}` : ""}`);
  if (owner?.id === "p1" && ["property", "railroad", "utility"].includes(tile.kind)) {
    host.openDeedDetail(tile.i, trigger);
  } else {
    state.highlight = tile.i;
    openPopup(tile);
  }
  renderBoardState();
}
