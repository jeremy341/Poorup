// DEED CARD + RENT LADDER RENDERING: the deed modal, rail
// cards, and ladder rows used by popups, the right rail, and trade
// tables. Reads state via clientDeedRules; emits byte-identical HTML.
import { esc } from "./clientDom.js";
import { spriteHTML } from "./clientSprites.js";
import {
  GROUP_COLOR,
  RENT_TABLE,
  TILES,
  HOTEL_LEVEL,
} from "./clientBoardData.js";
import { state } from "./clientState.js";
import { rentFor, ownsFullGroup, serverTileFor } from "./clientDeedRules.js";

const LADDER_PADS = {
  property: { label: " ".repeat(10), pips: " ".repeat(12), close: " ".repeat(8) },
  railroad: { label: " ".repeat(8), pips: " ".repeat(10), close: " ".repeat(6) },
  utility: { label: " ".repeat(6), pips: " ".repeat(8), close: " ".repeat(4) },
};

function ladderLabelHTML(pips, label, isCurrent, pad) {
  const tone = isCurrent ? "g100" : "g-muted";
  return `<span class="deed-detail-row-pips">${pips}</span>
${pad.pips}<span class="t-label f11 ${tone}">${label}</span>`;
}

function ladderRowHTML(labelInner, rent, isCurrent, pad) {
  const rowClass = isCurrent ? "deed-detail-row is-current" : "deed-detail-row";
  const now = isCurrent ? `<span class="t-micro deed-detail-now">NOW</span>` : "";
  const rentLabel = typeof rent === "number" ? `$${rent}` : rent;
  return `<div class="${rowClass}">
${pad.label}<span class="deed-detail-row-label">
${pad.pips}${labelInner}
${pad.label}</span>
${pad.label}${now}
${pad.label}<span class="deed-detail-row-rent">${rentLabel}</span>
${pad.close}</div>`;
}

function propertyLadderPips(lvl) {
  if (lvl === HOTEL_LEVEL) return spriteHTML("hotel", 2, "#cfa75f");
  if (lvl === 0) return `<span class="t-micro ink-3">-</span>`;
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
  const ownerId = state.owners[tile.i];
  if (!ownerId) return 0;
  return TILES.filter((u) => u.kind === kind && state.owners[u.i] === ownerId).length;
}

function railroadLabel(n, tile) {
  const type = tile.name.includes("AIRPORT") ? "AIRPORT" : "RAILROAD";
  if (n === 1) return `1 ${type}`;
  return `${n} ${type}S`;
}

function utilityLabel(n) {
  if (n === 1) return "1 UTILITY";
  return `${n} UTILITIES`;
}

function groupLadderHTML(cfg, current, rents, tile) {
  const pad = LADDER_PADS[cfg.kind];
  return cfg.counts
    .map((n) => {
      const isCurrent = n === current;
      const icon = tile.kind === "utility" ? bulbOrFaucetHTML(tile) : airportOrTrainHTML(tile);
      const rent = cfg.rentFor ? cfg.rentFor(n, rents[n - 1]) : rents[n - 1];
      return ladderRowHTML(ladderLabelHTML(icon, cfg.labelFor(n, tile), isCurrent, pad), rent, isCurrent, pad);
    })
    .join("");
}

const LADDER_CONFIGS = {
  railroad: { counts: [1, 2, 3, 4], labelFor: railroadLabel, kind: "railroad" },
  utility: { counts: [1, 2], labelFor: utilityLabel, kind: "utility", rentFor: n => `${n === 1 ? 4 : 10}× DICE` },
};

/** Rows for the rent ladder, current level highlighted. */
export function deedLadderHTML(tile, currentLevel = houseLevel(tile)) {
  const table = RENT_TABLE[tile.group || tile.kind];
  if (!table) return "";
  if (tile.kind === "property") return propertyLadderHTML(table, currentLevel);
  const config = LADDER_CONFIGS[tile.kind];
  if (config) return groupLadderHTML(config, countOwnedGroup(tile, tile.kind), table.rents, tile);
  return "";
}

export function tileRentExplanation(tile) {
  if (tile?.kind === "utility") {
    const utilitiesOnBoard = TILES.filter(entry => entry.kind === "utility").length;
    const secondTier = utilitiesOnBoard === 2 ? "both utilities" : "2 or more utilities";
    const higherTiers = utilitiesOnBoard > 2 ? ", rising to 14× with 3 and 18× with 4" : "";
    return `${tile.name} rent uses 4× the dice roll with 1 utility owned, or 10× when you own ${secondTier}${higherTiers}.`;
  }
  if (tile?.kind === "railroad" && tile.name?.includes("AIRPORT")) {
    return "Airport rent increases with the number of airports you own.";
  }
  if (tile?.kind === "railroad") return "Railroad rent increases with the number of railroads you own.";
  return "";
}

export function deedCurrentRentLabel(tile, currentLevel = houseLevel(tile)) {
  const currentRent = serverTileFor(tile.i)?.currentRent;
  if (typeof currentRent === "number" && Number.isFinite(currentRent)) return `$${currentRent.toLocaleString()}`;
  if (tile?.kind === "utility") {
    const UTILITY_DICE_MULTIPLIERS = [4, 10, 14, 18];
    const owned = Math.min(Math.max(countOwnedGroup(tile, "utility"), 1), UTILITY_DICE_MULTIPLIERS.length);
    return `${UTILITY_DICE_MULTIPLIERS[owned - 1]}× DICE ROLL`;
  }
  if (tile?.kind === "property") {
    return `$${RENT_TABLE[tile.group].rents[Math.min(currentLevel, RENT_TABLE[tile.group].rents.length - 1)]}`;
  }
  return `$${rentFor(tile)}`;
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

/* One flat line per owned property: colour dot, name, buildings, rent. The
   whole row opens the deed manager (build / sell / mortgage). */
export function propertyRowHTML(tile, { showRent = true } = {}) {
  const isMortgaged = !!state.mortgaged[tile.i];
  const level = houseLevel(tile);
  const isProperty = tile.kind === "property";
  const fullSet = isProperty && ownsFullGroup("p1", tile.group);
  let meta = "";
  if (isMortgaged) meta = `<span class="prop-meta prop-meta-bad">MORTGAGED</span>`;
  else if (isProperty && level >= 5) meta = `<span class="prop-meta prop-meta-good">HOTEL</span>`;
  else if (isProperty && level > 0) meta = `<span class="prop-meta prop-meta-good">${level} HOUSE${level === 1 ? "" : "S"}</span>`;
  else if (fullSet) meta = `<span class="prop-meta prop-meta-good">FULL SET</span>`;
  return `<button class="prop-row${isMortgaged ? " is-mortgaged" : ""}" type="button" data-deed="${tile.i}" data-deed-open="${tile.i}" aria-label="Manage ${esc(tile.name)}">
    <span class="prop-dot" style="background:${deedRailColor(tile)}"></span>
    <span class="prop-name t-label">${esc(tile.name)}</span>
    ${meta}
    ${showRent ? `<span class="prop-rent numeric">${isMortgaged ? "" : deedCurrentRentLabel(tile)}</span>` : ""}
  </button>`;
}
