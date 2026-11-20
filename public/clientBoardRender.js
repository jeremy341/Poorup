// BOARD RENDERING: builds the 40 tiles, owner/building marks,
// and the walking game pieces. Pure view layer over clientState.
import { $, REDUCED_MOTION, setHtml } from "./clientDom.js";
import { spriteHTML, avatarHTML, hydrateSprites } from "./clientSprites.js";
import {
  GROUP_COLOR,
  TILES,
  TILE_COUNT,
  JAIL_TILE_INDEX,
  MAX_HOUSES,
  HOTEL_LEVEL,
} from "./clientBoardData.js";
import { getTheme } from "./clientThemeData.js";
import { state } from "./clientState.js";
import { createWalkTimeline, PIECE_WALK_STEP_MS } from "./clientBoardMotion.js";
import { tileSupportsInspection } from "./clientTileInteraction.js";
import { defaultStackOffset, startTileStackOffset } from "./clientBoardStack.js";
import { tileAriaLabel } from "./clientTileLabel.js";

export const SKYLINE = [
  [0, 24, 6, 12], [9, 17, 5, 19], [15, 27, 4, 9], [20, 12, 6, 24], [27, 21, 5, 15],
  [33, 6, 7, 30], [41, 15, 5, 21], [47, 2, 8, 34], [56, 18, 5, 18], [62, 10, 6, 26],
  [69, 22, 5, 14], [75, 15, 6, 21], [82, 25, 5, 11],
];
const BOARD_SKYLINE = [
  [4, 22, 6, 12], [11, 16, 5, 18], [17, 25, 4, 9], [22, 12, 6, 22], [29, 20, 5, 14],
  [35, 6, 7, 28], [43, 14, 5, 20], [49, 2, 8, 32], [58, 17, 5, 17], [64, 10, 6, 24],
  [71, 21, 5, 13], [77, 15, 6, 19],
];

const DEFAULT_SKYLINE_PALETTE = { far: "#123634", near: "#0d2725", light: "#78894f" };

export function paintSkyline(el, data, palette = DEFAULT_SKYLINE_PALETTE) {
  const far = palette.far || DEFAULT_SKYLINE_PALETTE.far;
  const near = palette.near || DEFAULT_SKYLINE_PALETTE.near;
  const light = palette.light || DEFAULT_SKYLINE_PALETTE.light;
  let out = "";
  data.forEach(([x, y, w, h], i) => {
    out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${far}"/>`;
    for (let r = 0; r < Math.floor((h - 2) / 3); r++) {
      for (let c = 0; c < Math.floor((w - 1) / 2); c++) {
        const lit = (r + c + i) % 3 === 0;
        out += `<rect x="${x + 1 + c * 2}" y="${y + 2 + r * 3}" width="1" height="1" fill="${lit ? light : near}"/>`;
      }
    }
  });
  el.innerHTML = out;
}

function carIconHTML() {
  return spriteHTML("car", 4);
}

function palmIconHTML() {
  return spriteHTML("palm", 4);
}

function chestIconHTML() {
  return `<img class="board-icon-mark board-icon-chest" src="/assets/board-icons/treasure-chest.svg" alt="Treasure">`;
}

function surpriseIconHTML() {
  return `<img class="board-icon-mark board-icon-surprise" src="/assets/board-icons/surprise.svg" alt="Surprise">`;
}

function taxIconHTML() {
  return `<span class="deck-glyph g400" style="font-size:13px;color:#c88f2e">$</span>`;
}

function railroadIconHTML(tile) {
  if (tile.name.includes("AIRPORT")) {
    return `<img class="airport-mark" src="/assets/airport-plane.svg" alt="Airport">`;
  }
  return spriteHTML("train", 3);
}

function utilityIconHTML(tile) {
  if (tile.name === "ELECTRIC COMPANY") return spriteHTML("bulb", 3);
  return spriteHTML("faucet", 3);
}

const TILE_ICONS = {
  "corner-parking": carIconHTML,
  "corner-vacation": palmIconHTML,
  chest: chestIconHTML,
  railroad: railroadIconHTML,
  utility: utilityIconHTML,
  chance: surpriseIconHTML,
  tax: taxIconHTML,
};

export function tileIconHTML(tile) {
  const render = TILE_ICONS[tile.kind];
  if (render) return render(tile);
  return "";
}

const STRIP_EDGES = {
  bottom: "top:0;left:0;right:0;height:var(--tile-strip-size);border-bottom:1px solid var(--edge-0)",
  top: "bottom:0;left:0;right:0;height:var(--tile-strip-size);border-top:1px solid var(--edge-0)",
  left: "top:0;bottom:0;right:0;width:var(--tile-strip-size);border-left:1px solid var(--edge-0)",
  right: "top:0;bottom:0;left:0;width:var(--tile-strip-size);border-right:1px solid var(--edge-0)",
};

function stripStyle(tile) {
  const c = GROUP_COLOR[tile.group];
  if (!c) return "";
  const edge = STRIP_EDGES[tile.side];
  if (!edge) return "";
  return `background:color-mix(in srgb, ${c} 78%, var(--surface-2));${edge}`;
}

function tileClassName(tile) {
  let cls = `tile side-${tile.side}`;
  if (tile.group) cls += " has-strip";
  if (tile.name.includes("AIRPORT")) cls += " airport-tile";
  return cls;
}

function boardPlateHTML(spriteName, classes) {
  return `<span class="tile-plate ${classes}" data-sprite="${spriteName}" data-size="2" aria-hidden="true"></span>`;
}

function specialPlateName(tile) {
  if (tile.kind === "utility") return /ELECTRIC|POWER/.test(tile.name) ? "board-power" : "board-water";
  return { railroad: "board-airport", chest: "board-chest", chance: "board-surprise", tax: "board-tax" }[tile.kind];
}

const GO_CORNER_HTML = `<span class="go-big">${boardPlateHTML("board-start", "tile-plate-start")}GO</span>
          <span class="t-tile tile-name" style="color:#a79d7d">COLLECT</span>
          <span class="t-tile tile-price" style="color:#cfa75f">$200</span>`;

const PASSING_CORNER_HTML = `<span class="passing-by-corner-layout">
          <span class="t-tile tile-name passing-by-corner-label">PASSING BY</span>
          <span class="passing-by-prison-zone" aria-hidden="true">
            ${boardPlateHTML("board-passing", "passing-by-bars-art tile-plate-corner")}
          </span>
          <span class="passing-by-token-anchor passing-by-token-anchor-pass" data-tile-anchor="passing" aria-hidden="true"></span>
          <span class="passing-by-token-anchor passing-by-token-anchor-prison" data-tile-anchor="prison" aria-hidden="true"></span>
        </span>`;

const PRISON_BARS_HTML = `${boardPlateHTML("board-prison", "jail-bars tile-plate-corner")}
          <span class="t-tile tile-name" style="color:var(--red-bright)">PRISON</span>`;

function cornerFaceHTML(tile) {
  if (tile.kind === "corner-go") return GO_CORNER_HTML;
  if (tile.kind === "corner-jail") return PASSING_CORNER_HTML;
  if (tile.kind === "corner-go-jail") return PRISON_BARS_HTML;
  return `${boardPlateHTML("board-vacation", "tile-plate-corner")}<span class="t-tile tile-name">${tile.name}</span>`;
}

function priceLineHTML(tile) {
  if (tile.price == null) return "";
  const paidLabel = tile.kind === "tax" ? `PAY $${tile.price}` : `$${tile.price}`;
  return `<span class="t-tile tile-price">${paidLabel}</span>`;
}

function tileFaceHTML(tile) {
  const name = `<span class="t-tile tile-name">${tile.name}</span>`;
  const price = priceLineHTML(tile);
  if (tile.kind === "property") return `<span class="tile-face">${name}${price}</span>`;
  const plateName = specialPlateName(tile);
  if (tile.kind === "chance") {
    return `<span class="tile-face tile-face-special">${boardPlateHTML(plateName, "tile-icon tile-icon-large")}</span>`;
  }
  if (tile.kind === "chest") return `<span class="tile-face tile-face-special">${boardPlateHTML(plateName, "tile-icon tile-icon-large")}${name}</span>`;
  const icon = boardPlateHTML(plateName, tile.kind === "railroad" ? "tile-icon airport-mark" : "tile-icon");
  const faceClass = tile.kind === "tax" ? "tile-face-special tile-face-tax" : "tile-face-special";
  return `<span class="tile-face ${faceClass}">${name}<span class="tile-meta">${icon}${price}</span></span>`;
}

function applyTileFace(el, tile) {
  if (tile.kind.startsWith("corner")) {
    el.classList.add("is-corner");
    el.innerHTML = cornerFaceHTML(tile);
    return;
  }
  const strip = tile.group
    ? `<span class="tile-strip" style="${stripStyle(tile)}">${boardPlateHTML(`district-${tile.group.replaceAll(" ", "-")}`, "tile-district-plate")}</span>`
    : "";
  el.innerHTML = strip + `<span class="tile-owner" style="display:none"></span>` + tileFaceHTML(tile);
}

function buildTile(tile, onTileClick) {
  const el = document.createElement("button");
  el.className = tileClassName(tile);
  el.dataset.tile = String(tile.i);
  el.setAttribute("aria-label", tileAriaLabel(tile));
  el.setAttribute("tabindex", "-1");
  if (!tileSupportsInspection(tile)) el.setAttribute("aria-disabled", "true");
  el.style.gridColumn = String(tile.col);
  el.style.gridRow = String(tile.row);
  applyTileFace(el, tile);
  el.insertAdjacentHTML("beforeend", `<span class="tile-build side-${tile.side}"></span>`);
  el.addEventListener("click", () => {
    if (!tileSupportsInspection(tile)) return;
    onTileClick(tile, el);
  });
  $("#board-grid").insertBefore(el, $("#center-field"));
}

// ROVING TILE FOCUS: the board is one tab stop, not forty. Exactly one tile carries tabindex 0 (the
// last focused, else the first); Arrow keys move along the grid, Home/End jump to the first/last tile.
let rovingTileIndex = 0;
const boundBoardGrids = new WeakSet();
const TILE_ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function setRovingTile(grid, active) {
  grid.querySelectorAll(".tile").forEach((el) => el.setAttribute("tabindex", "-1"));
  if (!active) return;
  active.setAttribute("tabindex", "0");
  rovingTileIndex = Number(active.dataset.tile);
}

// Next tile index for a navigation key, or null. Arrows step through the grid cells in that
// direction and skip empty cells, so Right on the left edge crosses the board to the far edge.
function nextTileIndex(fromIndex, key) {
  if (key === "Home") return TILES[0].i;
  if (key === "End") return TILES[TILES.length - 1].i;
  const step = TILE_ARROWS[key];
  const from = TILES.find((tile) => tile.i === fromIndex);
  if (!step || !from) return null;
  const maxCol = Math.max(...TILES.map((tile) => tile.col));
  const maxRow = Math.max(...TILES.map((tile) => tile.row));
  let col = from.col + step[0];
  let row = from.row + step[1];
  while (col >= 1 && col <= maxCol && row >= 1 && row <= maxRow) {
    const hit = TILES.find((tile) => tile.col === col && tile.row === row);
    if (hit) return hit.i;
    col += step[0];
    row += step[1];
  }
  return null;
}

function onBoardKeydown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  const el = event.target?.closest?.(".tile");
  if (!el) return;
  const next = nextTileIndex(Number(el.dataset.tile), event.key);
  if (next === null || next === Number(el.dataset.tile)) return;
  const grid = el.closest("#board-grid") || $("#board-grid");
  const target = grid?.querySelector(`.tile[data-tile="${next}"]`);
  if (!target) return;
  event.preventDefault();
  setRovingTile(grid, target);
  target.focus();
}

function bindBoardRoving(grid) {
  if (boundBoardGrids.has(grid)) return;
  boundBoardGrids.add(grid);
  grid.addEventListener("keydown", onBoardKeydown);
  grid.addEventListener("focusin", (event) => {
    const el = event.target?.closest?.(".tile");
    if (el && el.getAttribute("tabindex") !== "0") setRovingTile(grid, el);
  });
}

export function buildBoard(onTileClick) {
  const grid = $("#board-grid");
  grid.querySelectorAll(".tile").forEach((n) => n.remove());
  const theme = getTheme(state.themeId);
  paintSkyline($("#board-skyline"), theme.skyline.board || BOARD_SKYLINE, theme.palette);
  TILES.forEach((tile) => buildTile(tile, onTileClick));
  hydrateSprites(grid);
  setRovingTile(grid, grid.querySelector(`.tile[data-tile="${rovingTileIndex}"]`) || grid.querySelector(".tile"));
  bindBoardRoving(grid);
}

function renderTileState(el, tile) {
  el.classList.toggle("is-highlight", state.highlight === tile.i);
  el.classList.toggle("is-mortgaged", !!state.mortgaged[tile.i]);
}

// Ownership pips show the owner's face, not just their color: two seats may share a color once
// the icon (color plus face) is the identity. Markup is memoized by signature like board tokens,
// so repaints are a cache lookup and any face or color change re-renders by itself.
function ownerPipMarkup(owner, index) {
  const grid = owner.avatarGrid ? JSON.stringify(owner.avatarGrid) : "";
  return { sig: `${owner.id}:${owner.color}:${index}:${grid}`, markup: avatarHTML(owner, 1, index) };
}

// Injected by main.js so the board can tick and thunk without owning an audio engine.
let boardSound = () => {};
export function configureBoardSound(playSound) {
  boardSound = typeof playSound === "function" ? playSound : () => {};
}

// One-shot motion (owner stamp, building pop): restart the class, then drop it after `ms`.
const oneShotTimers = new WeakMap();
function playOneShot(el, className, ms) {
  if (REDUCED_MOTION || !el) return;
  clearTimeout(oneShotTimers.get(el));
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  oneShotTimers.set(el, setTimeout(() => el.classList.remove(className), ms));
}

// Reduced motion skips the animated walk, so the piece would appear on its destination with no cue.
// This substitute is a 200ms colour/opacity ring on the destination tile only (no travel). It is a
// distinct one-shot class so it never fights `is-highlight`, and it clears itself on animationend
// with a safety timeout for browsers/tabs that never fire the event.
const ARRIVAL_CUE_MS = 200;
const arrivalCueTimers = new Map();
function playArrivalCue(tileIndex) {
  const el = document.querySelector(`.tile[data-tile="${tileIndex}"]`);
  if (!el) return;
  clearTimeout(arrivalCueTimers.get(el));
  const clear = () => {
    clearTimeout(arrivalCueTimers.get(el));
    arrivalCueTimers.delete(el);
    el.classList.remove("is-arrival-cue");
    el.removeEventListener("animationend", onEnd);
  };
  const onEnd = (event) => { if (event.animationName === "tile-arrival-cue") clear(); };
  el.classList.remove("is-arrival-cue");
  void el.offsetWidth;
  el.classList.add("is-arrival-cue");
  el.addEventListener("animationend", onEnd);
  arrivalCueTimers.set(el, setTimeout(clear, ARRIVAL_CUE_MS + 100));
}

// `dataset.*Seen` is undefined until a tile's first paint, so initial hydration and rebuilt boards
// never count as a change; only a later transition does.
function changedSince(el, key, value, isForward) {
  const previous = el.dataset[key];
  el.dataset[key] = String(value);
  if (previous === undefined) return false;
  return isForward(previous, String(value));
}

function renderTileOwner(el, tile) {
  const pip = el.querySelector(".tile-owner");
  if (!pip) return false;
  const owner = state.players.find((p) => p.id === state.owners[tile.i]);
  pip.style.display = owner ? "block" : "none";
  el.classList.toggle("is-owned", Boolean(owner));
  const stamped = changedSince(el, "ownerSeen", owner?.id ?? "", (before, after) => after !== "" && before !== after);
  if (!owner) {
    el.style.removeProperty("--tile-owner");
    return false;
  }
  el.style.setProperty("--tile-owner", owner.color);
  const face = ownerPipMarkup(owner, state.players.indexOf(owner));
  if (pip.dataset.sig !== face.sig) {
    pip.innerHTML = face.markup;
    pip.dataset.sig = face.sig;
  }
  return stamped;
}

function housesRowHTML(count) {
  return Array.from({ length: Math.min(count, MAX_HOUSES) }).map(() => spriteHTML("house", 1, "#4b853d")).join("");
}

function tileBuildHTML(tile) {
  const level = state.houses[tile.i] || 0;
  if (tile.kind !== "property") return "";
  if (level <= 0) return "";
  if (level === HOTEL_LEVEL) return spriteHTML("hotel", 1, "#cfa75f");
  return housesRowHTML(level);
}

// Returns the build element when its level rose since the last paint (a new house or hotel appeared).
function renderTileBuild(el, tile) {
  const buildEl = el.querySelector(".tile-build");
  if (!buildEl) return null;
  setHtml(buildEl, tileBuildHTML(tile));
  const level = tile.kind === "property" ? (state.houses[tile.i] || 0) : 0;
  const grew = changedSince(el, "buildSeen", level, (before, after) => Number(after) > Number(before));
  return grew ? buildEl : null;
}

function renderTileLabel(el, tile) {
  const owner = state.players.find((p) => p.id === state.owners[tile.i]);
  const level = tile.kind === "property" ? (state.houses[tile.i] || 0) : 0;
  const label = tileAriaLabel(tile, {
    ownerName: owner?.name,
    houses: level > 0 && level < HOTEL_LEVEL ? Math.min(level, MAX_HOUSES) : 0,
    hotel: level === HOTEL_LEVEL,
    mortgaged: !!state.mortgaged[tile.i],
  });
  if (el.getAttribute("aria-label") !== label) el.setAttribute("aria-label", label);
}

function renderBoardTile(tile, moments) {
  const el = document.querySelector(`.tile[data-tile="${tile.i}"]`);
  if (!el) return;
  renderTileState(el, tile);
  if (renderTileOwner(el, tile)) moments.stamps.push(el);
  const grown = renderTileBuild(el, tile);
  if (grown) moments.builds.push(grown);
  renderTileLabel(el, tile);
}

// A handful of changes in one pass is a play (buy, rent, build, trade); a flood is a snapshot
// catch-up (rejoin, restore) and stays quiet instead of stamping the whole board.
const MAX_STAMPS_PER_PASS = 2;
const MAX_BUILDS_PER_PASS = 4;
const STAMP_MS = 320;
const BUILD_POP_MS = 240;

function playBoardMoments(moments) {
  if (state.phase !== "playing") return;
  if (moments.stamps.length && moments.stamps.length <= MAX_STAMPS_PER_PASS) {
    moments.stamps.forEach((el) => playOneShot(el, "is-stamping", STAMP_MS));
  }
  if (moments.builds.length && moments.builds.length <= MAX_BUILDS_PER_PASS) {
    moments.builds.forEach((buildEl) => playOneShot(buildEl, "is-popping", BUILD_POP_MS));
    boardSound("house");
  }
}

export function renderBoardState() {
  const moments = { stamps: [], builds: [] };
  TILES.forEach((tile) => renderBoardTile(tile, moments));
  playBoardMoments(moments);
}

export function tileCenter(i, zone = "passing") {
  const tile = document.querySelector(`.tile[data-tile="${i}"]`);
  const layer = $("#token-layer");
  if (!tile || !layer) return null;
  const anchor = tile.querySelector(`[data-tile-anchor="${zone}"]`);
  const tr = (anchor || tile).getBoundingClientRect();
  const lr = layer.getBoundingClientRect();
  if (!tr.width || !lr.width) return null;
  return {
    x: tr.left - lr.left + tr.width / 2,
    y: tr.top - lr.top + tr.height / 2,
  };
}

function walkZoneFor(player, i) {
  if (Number(i) !== JAIL_TILE_INDEX) return "passing";
  if (state.jail?.[player?.id]) return "prison";
  return "passing";
}

function playerTileCenter(player, i = player?.pos) {
  return tileCenter(i, walkZoneFor(player, i));
}

const pieceWalks = new Map();

function motionNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

function pieceElement(playerId) {
  const layer = $("#token-layer");
  if (!layer) return null;
  return layer.querySelector(`.piece[data-player="${playerId}"]`);
}

export function cancelPieceWalk(playerId) {
  const walk = pieceWalks.get(playerId);
  if (!walk) return;
  walk.cancelled = true;
  clearTimeout(walk.timer);
  pieceWalks.delete(playerId);
  walk.complete();
  const el = pieceElement(playerId);
  if (!el) return;
  el.classList.remove("is-moving", "is-hopping");
}

function pieceWalkPath(from, to) {
  const distance = (to - from + TILE_COUNT) % TILE_COUNT;
  if (!distance || distance > 12) return [];
  return Array.from({ length: distance }, (_, index) => (from + index + 1) % TILE_COUNT);
}

function setPiecePosition(el, x, y) {
  el.style.setProperty("--piece-x", `${Math.round(x)}px`);
  el.style.setProperty("--piece-y", `${Math.round(y)}px`);
}

function hopPiece(el) {
  el.classList.remove("is-hopping");
  void el.offsetWidth;
  el.classList.add("is-hopping");
}

const LANDING_SETTLE_MS = 160;
function landPiece(el) {
  el.classList.add("is-landing");
  setTimeout(() => el.classList.remove("is-landing"), LANDING_SETTLE_MS + 40);
}

function reconcilePieceWalk(playerId, walk, el, timestamp = motionNow()) {
  if (walk.cancelled) return;
  if (pieceWalks.get(playerId) !== walk) return;
  const progress = walk.timeline.snapshot(timestamp);
  if (progress.beforeFirst) {
    setPiecePosition(el, walk.start.x, walk.start.y);
  } else {
    // A walk across the combined Passing By corner always uses the open lane.
    const center = tileCenter(walk.path[progress.index], "passing");
    if (!center) {
      cancelPieceWalk(playerId);
      placePieces();
      return;
    }
    // Fit each slide/hop inside the step that follows it; the final tile settles with an eased-out landing
    // (is-moving is stripped the moment the walk finishes, so without this the last slide would just snap).
    el.style.setProperty("--piece-step-ms", `${Math.min(240, walk.timeline.stepDurationMs(progress.index + 1))}ms`);
    if (progress.done) landPiece(el);
    setPiecePosition(el, center.x, center.y);
    hopPiece(el);
    if (walk.lastTick !== progress.index) {
      walk.lastTick = progress.index;
      boardSound("step");
    }
  }
  if (progress.done) {
    finishPieceWalk(playerId, walk, el);
    return;
  }
  const nextBoundary = walk.startedAt + walk.timeline.nextBoundaryMs(progress.elapsed);
  clearTimeout(walk.timer);
  walk.timer = setTimeout(() => reconcilePieceWalk(playerId, walk, el), Math.max(16, nextBoundary - timestamp));
}

function finishPieceWalk(playerId, walk, el) {
  if (pieceWalks.get(playerId) !== walk) return;
  const player = state.players.find(entry => entry.id === playerId);
  if (player && player.visualPos != null) player.visualPos = walk.path.at(-1);
  pieceWalks.delete(playerId);
  el.classList.remove("is-moving", "is-hopping");
  walk.complete();
  placePieces();
}

function canAnimateWalk(el, path) {
  if (!el) return false;
  if (!path.length) return false;
  return !REDUCED_MOTION;
}

export function startPieceWalk(playerId, from, to, options = {}) {
  const path = Array.isArray(options.path) ? options.path : pieceWalkPath(Number(from) || 0, Number(to) || 0);
  const el = pieceElement(playerId);
  if (!canAnimateWalk(el, path)) {
    if (REDUCED_MOTION && el && path.length) playArrivalCue(path.at(-1));
    return Promise.resolve({ motionSkipped: true });
  }
  cancelPieceWalk(playerId);
  const player = state.players.find((entry) => entry.id === playerId);
  const start = playerTileCenter(player, Number(from) || 0);
  if (!start) return Promise.resolve({ motionSkipped: true });
  const requestedStart = Number(options.startedAt);
  const startedAt = Number.isFinite(requestedStart) ? requestedStart : motionNow();
  let complete;
  const movementComplete = new Promise(resolve => { complete = resolve; });
  const walk = {
    cancelled: false,
    lastTick: -1,
    timer: null,
    complete,
    path,
    start,
    startedAt,
    timeline: createWalkTimeline({ path, stepMs: options.stepMs || PIECE_WALK_STEP_MS, startedAt, now: motionNow, pacing: options.pacing }),
  };
  pieceWalks.set(playerId, walk);
  el.classList.add("is-moving");
  setPiecePosition(el, start.x, start.y);
  reconcilePieceWalk(playerId, walk, el);
  return movementComplete;
}

function reconcilePieceWalks(timestamp = motionNow()) {
  pieceWalks.forEach((walk, playerId) => {
    const el = pieceElement(playerId);
    if (!el) {
      cancelPieceWalk(playerId);
      return;
    }
    reconcilePieceWalk(playerId, walk, el, timestamp);
  });
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    reconcilePieceWalks();
    placePieces();
  });
}

const PAWN_HTML = spriteHTML("board-pawn", 2);

function ensurePiece(layer, player) {
  let el = layer.querySelector(`.piece[data-player="${player.id}"]`);
  if (!el) {
    el = document.createElement("div");
    el.className = "piece";
    el.dataset.player = player.id;
    el.innerHTML = PAWN_HTML;
    layer.appendChild(el);
  }
  el.style.setProperty("--piece-color", player.color);
  el.title = player.name;
}

function pruneStrayPieces(layer) {
  layer.querySelectorAll(".piece").forEach((el) => {
    if (state.players.some((p) => p.id === el.dataset.player && !p.bankrupt && !p.spectating)) return;
    el.remove();
  });
}

function ensurePieces() {
  const layer = $("#token-layer");
  if (!layer) return;
  state.players.filter(p => !p.bankrupt && !p.spectating).forEach(player => ensurePiece(layer, player));
  pruneStrayPieces(layer);
}

function pruneFinishedWalks() {
  pieceWalks.forEach((_, playerId) => {
    if (state.players.some((player) => player.id === playerId)) return;
    cancelPieceWalk(playerId);
  });
}

function occupantsByPosition() {
  const occupants = {};
  state.players.filter(p => !p.bankrupt && !p.spectating).forEach((p) => {
    const list = occupants[p.pos];
    if (list) {
      list.push(p.id);
      return;
    }
    occupants[p.pos] = [p.id];
  });
  return occupants;
}

function stackOffset(stack, idx, pos, pieceEl) {
  if (Number(pos) === 0 && pieceEl) {
    // Keep Start tokens clear of the COLLECT / $200 caption.
    const tile = document.querySelector(`.tile[data-tile="0"]`);
    const caption = tile?.querySelector(".tile-name");
    if (tile && caption) {
      const tr = tile.getBoundingClientRect();
      const cr = caption.getBoundingClientRect();
      if (tr.height > 0) {
        return startTileStackOffset({
          count: stack.length, idx, tileWidth: tr.width, tileHeight: tr.height,
          captionTop: cr.top - tr.top - tr.height / 2, pieceSize: pieceEl.offsetWidth || 26,
        });
      }
    }
  }
  return defaultStackOffset(stack.length, idx);
}

function isTurnPlayer(player) {
  if (state.phase !== "playing") return false;
  const current = state.players[state.turnIndex];
  return current?.id === player.id;
}

function placeOnePiece(player, ctx) {
  const el = ctx.layer.querySelector(`.piece[data-player="${player.id}"]`);
  if (!el) return;
  const c = playerTileCenter(player, player.visualPos ?? player.pos);
  if (!c) return;
  const stack = ctx.occupants[player.pos] || [player.id];
  const idx = Math.max(0, stack.indexOf(player.id));
  const off = stackOffset(stack, idx, player.pos, el);
  el.classList.toggle("is-active", isTurnPlayer(player));
  if (pieceWalks.has(player.id)) {
    el.classList.add("is-moving");
    return;
  }
  el.classList.toggle("is-moving", ctx.movingId === player.id);
  if (ctx.hop && ctx.movingId === player.id) hopPiece(el);
  setPiecePosition(el, c.x + off.x, c.y + off.y);
}

export function placePieces(opts = {}) {
  const movingId = opts.movingId || null;
  const hop = !!opts.hop;
  ensurePieces();
  const layer = $("#token-layer");
  if (!layer) return;
  pruneFinishedWalks();
  const ctx = { layer, occupants: occupantsByPosition(), movingId, hop };
  state.players.forEach((p) => placeOnePiece(p, ctx));
}
