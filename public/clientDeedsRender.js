/* ============================================================
   DEED CARD + RENT LADDER RENDERING: the deed modal, rail-rail
   cards, and ladder rows used by popups, the right rail, and trade
   tables. Reads state via clientDeedRules; emits byte-identical HTML.
   ============================================================ */
import { esc } from "./clientDom.js";
import { spriteHTML } from "./clientSprites.js";
import {
  GROUP_COLOR,
  RENT_TABLE,
  TILES,
  MAX_HOUSES,
  HOTEL_LEVEL,
} from "./clientBoardData.js";
import { state } from "./clientState.js";
import { rentFor, ownsFullGroup, serverTileFor } from "./clientDeedRules.js";

export function houseDisplay(level) {
  if (!level) return "";
  if (level === HOTEL_LEVEL) {
    return `<span class="hotel-pixel" title="HOTEL">${spriteHTML("hotel", 2, "#cfa75f")}</span>`;
  }
  return Array.from({ length: MAX_HOUSES })
    .map((_, i) =>
      spriteHTML("house", 2, i < level ? "#4b853d" : "#252d24"),
    )
    .join("");
}

const LADDER_PADS = {
  property: { label: " ".repeat(10), pips: " ".repeat(12), close: " ".repeat(8) },
  railroad: { label: " ".repeat(8), pips: " ".repeat(10), close: " ".repeat(6) },
  utility: { label: " ".repeat(6), pips: " ".repeat(8), close: " ".repeat(4) },
};

function ladderLabelHTML(pips, label, isCurrent, pad) {
  const tone = isCurrent ? "g100" : "g-muted";
  return `<span class="dd-row-pips">${pips}</span>
${pad.pips}<span class="t-label f11 ${tone}">${label}</span>`;
}

function ladderRowHTML(labelInner, rent, isCurrent, pad) {
  const rowClass = isCurrent ? "dd-row is-current" : "dd-row";
  const now = isCurrent ? `<span class="t-micro dd-now">NOW</span>` : "";
  return `<div class="${rowClass}">
${pad.label}<span class="dd-row-label">
${pad.pips}${labelInner}
${pad.label}</span>
${pad.label}${now}
${pad.label}<span class="dd-row-rent">$${rent}</span>
${pad.close}</div>`;
}

function propertyLadderPips(lvl) {
  if (lvl === HOTEL_LEVEL) return spriteHTML("hotel", 2, "#cfa75f");
  if (lvl === 0) return `<span class="t-micro ink-3">—</span>`;
  return Array.from({ length: lvl }).map(() => spriteHTML("house", 2, "#4b853d")).join("");
}

function houseLevel(tile) {
  return state.houses[tile.i] || 0;
}

function propertyLadderHTML(table, level) {
  const labels = ["BASE RENT", "1 HOUSE", "2 HOUSES", "3 HOUSES", "4 HOUSES", "HOTEL"];
  const pad = LADDER_PADS.property;
  return labels
    .map((label, lvl) => {
      const isCurrent = lvl === level;
      return ladderRowHTML(ladderLabelHTML(propertyLadderPips(lvl), label, isCurrent, pad), table.rents[lvl], isCurrent, pad);
    })
    .join("");
}

function countOwnedGroup(tile, kind) {
  return TILES.filter((u) => u.kind === kind && state.owners[u.i] === state.owners[tile.i]).length;
}

function railroadLabel(n) {
  if (n === 1) return "1 RAILROAD";
  return `${n} RAILROADS`;
}

function utilityLabel(n) {
  if (n === 1) return "1 UTILITY";
  return `${n} UTILITIES`;
}

function groupLadderHTML(cfg, current, rents) {
  const pad = LADDER_PADS[cfg.kind];
  return cfg.counts
    .map((n) => {
      const isCurrent = n === current;
      return ladderRowHTML(ladderLabelHTML(spriteHTML(cfg.icon, 2), cfg.labelFor(n), isCurrent, pad), rents[n - 1], isCurrent, pad);
    })
    .join("");
}

const LADDER_CONFIGS = {
  railroad: { counts: [1, 2, 3, 4], icon: "train", labelFor: railroadLabel, kind: "railroad" },
  utility: { counts: [1, 2], icon: "bulb", labelFor: utilityLabel, kind: "utility" },
};

/** Rows for the rent ladder, current level highlighted. */
export function deedLadderHTML(tile) {
  const table = RENT_TABLE[tile.group || tile.kind];
  if (!table) return "";
  if (tile.kind === "property") return propertyLadderHTML(table, houseLevel(tile));
  const config = LADDER_CONFIGS[tile.kind];
  if (config) return groupLadderHTML(config, countOwnedGroup(tile, tile.kind), table.rents);
  return "";
}

function deedRailColor(tile) {
  if (tile.group) return GROUP_COLOR[tile.group];
  if (tile.kind === "railroad") return "#5c5033";
  return "#3e7d7b";
}

function airportOrTrainHTML(tile) {
  if (tile.name.includes("AIRPORT")) {
    return `<img class="airport-mark airport-mark-card" src="/assets/airport-plane.svg" alt="Airport">`;
  }
  return spriteHTML("train", 2);
}

function bulbOrFaucetHTML(tile) {
  if (tile.name === "ELECTRIC COMPANY") return spriteHTML("bulb", 2);
  return spriteHTML("faucet", 2);
}

function kindIconHTML(tile) {
  if (tile.kind === "railroad") return airportOrTrainHTML(tile);
  if (tile.kind === "utility") return bulbOrFaucetHTML(tile);
  return "";
}

function deedStatusPillHTML(opts, isMortgaged, hasSet) {
  if (!opts.status) return "";
  if (isMortgaged) return `<span class="t-micro red">MORTGAGED</span>`;
  if (hasSet) return `<span class="t-micro green">FULL SET</span>`;
  return `<span class="t-micro green">${opts.status}</span>`;
}

function equityLineHTML(equityShares) {
  if (!equityShares.length) return "";
  const total = equityShares.reduce((sum, share) => sum + Number(share.share || 0), 0);
  return `<span class="t-micro g300">EQUITY ${total}%</span>`;
}

function equitySharesOf(tile) {
  const serverTile = serverTileFor(tile.i);
  if (!serverTile) return [];
  return serverTile.equityShares || [];
}

function deedClickable(opts, mine) {
  if (!opts.showBuild) return false;
  return mine;
}

function deedWrapperAttrsHTML(interactive, clickable, tile) {
  if (interactive) return ` type="button" aria-label="Manage ${esc(tile.name)}" data-deed-open="${tile.i}"`;
  if (clickable) return ` data-deed-open="${tile.i}"`;
  return "";
}

function deedHousesHTML(view) {
  if (!view.isProperty) return `<span class="houses">${view.kindIcon}</span>`;
  const display = houseDisplay(view.level);
  if (display) return `<span class="houses">${display}</span>`;
  return `<span class="houses"><span class="t-micro ink-3">NO HOUSES</span></span>`;
}

function deedActionHTML(opts, tile) {
  if (!opts.action) return "";
  const disabled = opts.disabled ? "disabled" : "";
  return `<button class="btn-dark" data-buy="${tile.i}" ${disabled}><span class="t-label f11">${opts.action}</span></button>`;
}

function deedCardView(tile, opts) {
  const isProperty = tile.kind === "property";
  const isMortgaged = !!state.mortgaged[tile.i];
  const mine = state.owners[tile.i] === "p1";
  const clickable = deedClickable(opts, mine);
  const hasSet = isProperty && ownsFullGroup("p1", tile.group);
  return {
    isProperty,
    isMortgaged,
    clickable,
    interactive: clickable && !opts.action,
    level: houseLevel(tile),
    rentLabel: isMortgaged ? "MORTGAGED" : `$${rentFor(tile)} / TURN`,
    rail: deedRailColor(tile),
    kindIcon: kindIconHTML(tile),
    statusPill: deedStatusPillHTML(opts, isMortgaged, hasSet),
    equity: equityLineHTML(equitySharesOf(tile)),
  };
}

function deedCardShellHTML(tile, view, opts) {
  const wrapper = view.interactive ? "button" : "div";
  const cardClass = view.clickable ? "deed-card is-clickable" : "deed-card";
  const tone = view.isMortgaged ? "red" : "green";
  const manage = view.clickable ? `<span class="t-micro g300">MANAGE ›</span>` : "";
  const wrapperAttrs = deedWrapperAttrsHTML(view.interactive, view.clickable, tile);
  return `<${wrapper} class="${cardClass}" data-deed="${tile.i}"${wrapperAttrs}>
    <span class="deed-rail" style="background:${view.rail}"></span>
    <div class="deed-main">
      <div class="deed-top">
        <span class="t-label deed-name">${tile.name}</span>
        <span class="t-label deed-price">$${tile.price}</span>
      </div>
      <div class="deed-rent">
        <span class="t-micro ink-3">RENT NOW</span>
       <span class="t-label f11 ${tone}">${view.rentLabel}</span>
     </div>
        ${view.equity}
      <div class="deed-foot">
        ${deedHousesHTML(view)}
        ${view.statusPill}
        ${manage}
        ${deedActionHTML(opts, tile)}
      </div>
    </div>
  </${wrapper}>`;
}

export function deedCardHTML(tile, opts = {}) {
  return deedCardShellHTML(tile, deedCardView(tile, opts), opts);
}
