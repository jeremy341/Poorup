/* ============================================================
   TILE POPUP: the inspected-deed popup and the pure render
   helpers (accent, kind label, icon, effect copy, rent schedule)
   that the deed/choice/auction cards also reuse. Templates are
   byte-for-byte the old main.js markup; game-bound calls
   (buyTile, record) arrive via configurePopup hooks.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { GROUP_COLOR, RENT_TABLE, HOTEL_LEVEL } from "./clientBoardData.js";
import { spriteHTML } from "./clientSprites.js";
import { renderBoardState } from "./clientBoardRender.js";
import { renderRightRail } from "./clientRailRender.js";
import { openSurface, closeSurface } from "./clientSurfaces.js";

let host = { buyTile: noop, record: noop };

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
  "corner-go-jail": () => `<span class="q-mark" style="font-size:22px;color:#d74438">PRISON</span>`,
  "corner-parking": () => spriteHTML("car", 5),
  "corner-vacation": () => spriteHTML("palm", 5),
};

export function kindLabel(tile) {
  return KIND_LABEL[tile.kind] || "CORNER TILE";
}

export function accentOf(tile) {
  if (tile.group) return GROUP_COLOR[tile.group];
  return ACCENT_COLOR[tile.kind] || "#5c5033";
}

export function effectText(tile) {
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

function rentPropertyRows(table) {
  const rows = [
    ["BASE", `$${table.rents[0]}`],
    ["1 HOUSE", `$${table.rents[1]}`],
    ["2 HOUSES", `$${table.rents[2]}`],
    ["3 HOUSES", `$${table.rents[3]}`],
    ["4 HOUSES", `$${table.rents[4]}`],
    ["HOTEL", `$${table.rents[5]}`],
  ];
  return `<div class="rent-grid">${rows.map(([k, v]) => `<div class="rent-grid-row"><span class="t-label f11 g-muted">${k}</span><span class="t-label f11 green">${v}</span></div>`).join("")}</div>`;
}

function rentRailroadRows(table) {
  return `<div class="rent-grid">${[1, 2, 3, 4].map((n) => `<div class="rent-grid-row"><span class="t-label f11 g-muted">${n} RAIL${n === 1 ? "" : "S"}</span><span class="t-label f11 green">$${table.rents[n - 1]}</span></div>`).join("")}</div>`;
}

function rentUtilityRows(table) {
  return `<div class="rent-grid">${[1, 2].map((n) => `<div class="rent-grid-row"><span class="t-label f11 g-muted">${n} UTIL${n === 1 ? "" : "S"}</span><span class="t-label f11 green">$${table.rents[n - 1]}</span></div>`).join("")}<p class="t-micro ink-3">* Multiplied by dice roll in classic rules</p></div>`;
}

function rentScheduleHTML(tile) {
  const table = RENT_TABLE[tile.group || tile.kind];
  if (!table) return "";
  if (tile.kind === "property") return rentPropertyRows(table);
  if (tile.kind === "railroad") return rentRailroadRows(table);
  if (tile.kind === "utility") return rentUtilityRows(table);
  return "";
}

function popPriceLabel(tile) {
  if (tile.kind === "tax") return "—";
  return tile.price != null ? `$${tile.price}` : "—";
}

function popRentLabel(tile) {
  if (tile.rent != null) return `$${tile.rent}`;
  if (tile.kind === "tax") return `PAY $${tile.price ?? 200}`;
  return "—";
}

function popOwnerLabel(owner, buyable) {
  if (owner) return owner.name;
  return buyable ? "UNOWNED" : "BANK";
}

function popBuildTag(buyable, level) {
  if (!buyable || level <= 0) return "";
  if (level === HOTEL_LEVEL) return ` <span class="t-label f11 g300">— HOTEL</span>`;
  const plural = level === 1 ? "" : "S";
  return ` <span class="t-label f11 g300">— ${level} HOUSE${plural}</span>`;
}

function popColorSetRows(tile) {
  if (!tile.group) return "";
  return `${popRow("COLOR SET", tile.group.toUpperCase())}
        ${popRow("HOUSE COST", `$${RENT_TABLE[tile.group].housePrice}`, "g300")}`;
}

function popRentSectionHTML(tile, buyable) {
  if (!buyable) return "";
  return `<div class="pop-effect-head">${spriteHTML("diamond", 3)}<span class="t-label f12 g300">RENT SCHEDULE</span></div>${rentScheduleHTML(tile)}`;
}

function popOwnerFootHTML(owner) {
  if (!owner) return "";
  return `<span class="t-label f12" style="color:${owner.color}">OWNED BY ${esc(owner.name)}</span>`;
}

function popAuctionHintHTML(unowned) {
  if (!unowned || !state.settings.auction) return "";
  return `<div class="pop-buy-row"><p class="t-micro ink-3" style="text-align:center">AUCTION RULES ON — BUY WHEN YOU LAND HERE</p></div>`;
}

function popCanBuyNow(tile) {
  const me = state.players[0];
  return me.cash >= (tile.price ?? 0) && state.phase === "playing" && state.turnIndex === 0 && !state.busy;
}

function popBuyLabel(tile) {
  const me = state.players[0];
  if (state.phase !== "playing") return "JOIN TO BUY";
  if (state.turnIndex !== 0) return "NOT YOUR TURN";
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

function popupCardHTML({ tile, owner, buyable, unowned, level }) {
  const price = popPriceLabel(tile);
  const rent = popRentLabel(tile);
  const ownerLabel = popOwnerLabel(owner, buyable);
  const buildTag = popBuildTag(buyable, level);
  return `
    <div class="pop-rail" style="background:${accentOf(tile)}"></div>
    <div class="pop-body">
      <div class="pop-head">
        <div class="pop-icon">${popIconHTML(tile)}</div>
        <div class="pop-headtext">
          <div class="t-micro g400">${kindLabel(tile)}</div>
          <h3 class="t-section pop-title" id="popup-card-title">${tile.name}${buildTag}</h3>
        </div>
        <button class="btn-dark pop-close" id="pop-close"><span class="t-label f11">CLOSE</span></button>
      </div>
      <div class="pop-rows">
        ${popRow("PURCHASE", price, "g300")}
        ${popRow("BASE RENT", rent, "green")}
        ${popRow("OWNER", ownerLabel, owner ? "ink" : "g-muted")}
        ${popColorSetRows(tile)}
      </div>
      ${popRentSectionHTML(tile, buyable)}
      <div class="pop-effect-head">${spriteHTML("diamond", 3)}<span class="t-label f12 g300">SPECIAL EFFECT</span></div>
      <div class="pop-effect"><p class="t-body ink-2">${effectText(tile)}</p></div>
      ${popBuyRowHTML(tile, unowned)}
      <div class="pop-foot">
        <span class="t-micro ink-3">PRESS ESC OR CLICK OUTSIDE TO CLOSE</span>
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
  const buyBtn = $("#pop-buy");
  if (buyBtn) buyBtn.addEventListener("click", () => { host.buyTile(tile); openPopup(tile); });
}

export function closePopup() {
  state.selectedTile = null;
  state.highlight = null;
  closeSurface("#popup");
  renderBoardState();
}

export function onTileClick(tile) {
  state.highlight = tile.i;
  const owner = state.players.find((p) => p.id === state.owners[tile.i]);
  host.record(`INSPECTED ${tile.name}${tile.price ? ` — $${tile.price}` : ""}${owner ? ` — OWNED BY ${owner.name}` : ""}`);
  openPopup(tile);
  renderBoardState();
  if (state.tab === "log") renderRightRail();
}
