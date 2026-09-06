/* ============================================================
   BOARD RENDERING: builds the 40 tiles, owner/building marks,
   and the walking game pieces. Pure view layer over clientState.
   ============================================================ */
import { $, REDUCED_MOTION } from "./clientDom.js";
import { spriteHTML, avatarHTML } from "./clientSprites.js";
import {
  GROUP_COLOR,
  TILES,
  TILE_COUNT,
  JAIL_TILE_INDEX,
  MAX_HOUSES,
  HOTEL_LEVEL,
} from "./clientBoardData.js";
import { state } from "./clientState.js";

export const SKYLINE = [
  [0, 24, 6, 12], [9, 17, 5, 19], [15, 27, 4, 9], [20, 12, 6, 24], [27, 21, 5, 15],
  [33, 6, 7, 30], [41, 15, 5, 21], [47, 2, 8, 34], [56, 18, 5, 18], [62, 10, 6, 26],
  [69, 22, 5, 14], [75, 15, 6, 21], [82, 25, 5, 11],
];
export const BOARD_SKYLINE = [
  [4, 22, 6, 12], [11, 16, 5, 18], [17, 25, 4, 9], [22, 12, 6, 22], [29, 20, 5, 14],
  [35, 6, 7, 28], [43, 14, 5, 20], [49, 2, 8, 32], [58, 17, 5, 17], [64, 10, 6, 24],
  [71, 21, 5, 13], [77, 15, 6, 19],
];

export function paintSkyline(el, data) {
  let out = "";
  data.forEach(([x, y, w, h], i) => {
    out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#123634"/>`;
    for (let r = 0; r < Math.floor((h - 2) / 3); r++) {
      for (let c = 0; c < Math.floor((w - 1) / 2); c++) {
        const lit = (r + c + i) % 3 === 0;
        out += `<rect x="${x + 1 + c * 2}" y="${y + 2 + r * 3}" width="1" height="1" fill="${lit ? "#78894f" : "#0d2725"}"/>`;
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
  return `<span class="q-mark g400" style="font-size:13px;color:#c88f2e">$</span>`;
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
  bottom: "top:0;left:0;right:0;height:22%;border-bottom:1px solid #01070a",
  top: "bottom:0;left:0;right:0;height:22%;border-top:1px solid #01070a",
  left: "top:0;bottom:0;right:0;width:22%;border-left:1px solid #01070a",
  right: "top:0;bottom:0;left:0;width:22%;border-right:1px solid #01070a",
};

export function stripStyle(tile) {
  const c = GROUP_COLOR[tile.group];
  if (!c) return "";
  const edge = STRIP_EDGES[tile.side];
  if (!edge) return "";
  return `background:${c};${edge}`;
}

function tileClassName(tile) {
  let cls = `tile side-${tile.side}`;
  if (tile.group) cls += " has-strip";
  if (tile.name.includes("AIRPORT")) cls += " airport-tile";
  return cls;
}

function wordsFor(name) {
  return name.split(" ").map((w) => `<span style="display:block">${w}</span>`).join("");
}

const GO_CORNER_HTML = `<span class="go-big">GO</span>
          <span class="t-tile tile-name" style="color:#a79d7d">COLLECT</span>
          <span class="t-tile tile-price" style="color:#cfa75f">$200</span>`;

const PASSING_CORNER_HTML = `<span class="passing-by-corner-layout">
          <span class="t-tile tile-name passing-by-corner-label">PASSING BY</span>
          <span class="passing-by-prison-zone" aria-hidden="true">
            <img class="passing-by-bars-art" src="/assets/board-icons/passing-by-bars.svg" alt="">
          </span>
          <span class="passing-by-token-anchor passing-by-token-anchor-pass" data-tile-anchor="passing" aria-hidden="true"></span>
          <span class="passing-by-token-anchor passing-by-token-anchor-prison" data-tile-anchor="prison" aria-hidden="true"></span>
        </span>`;

const PRISON_BARS_HTML = `<svg class="jail-bars" viewBox="0 0 16 10" shape-rendering="crispEdges" aria-hidden="true">
            ${[1, 4, 7, 10, 13].map((x) => `<rect x="${x}" y="0" width="1.4" height="10" fill="#d74438"/>`).join("")}
            <rect x="0" y="4" width="16" height="1.2" fill="#d74438"/></svg>
          <span class="t-tile tile-name" style="color:#d74438">PRISON</span>`;

function cornerFaceHTML(tile) {
  if (tile.kind === "corner-go") return GO_CORNER_HTML;
  if (tile.kind === "corner-jail") return PASSING_CORNER_HTML;
  if (tile.kind === "corner-go-jail") return PRISON_BARS_HTML;
  return `<span class="t-tile tile-name">${wordsFor(tile.name)}</span>${tileIconHTML(tile)}`;
}

function priceLineHTML(tile) {
  if (tile.price == null) return "";
  const paidLabel = tile.kind === "tax" ? `PAY $${tile.price}` : `$${tile.price}`;
  return `<span class="t-tile tile-price">${paidLabel}</span>`;
}

function tileFaceHTML(tile) {
  const words = wordsFor(tile.name);
  const verticalSide = tile.side === "left" || tile.side === "right";
  const verticalChest = verticalSide && tile.kind === "chest";
  const iconOnly = tile.kind === "chance";
  if (iconOnly) {
    return `<span class="tile-face tile-face-special"><span class="tile-icon tile-icon-large">${tileIconHTML(tile)}</span></span>`;
  }
  if (verticalChest) {
    return `<span class="tile-face tile-face-special"><span class="t-tile tile-name">${words}</span><span class="tile-icon tile-icon-large">${tileIconHTML(tile)}</span></span>`;
  }
  if (tile.kind === "tax") {
    return `<span class="tile-face"><span class="t-tile tile-name">${words}</span></span>`;
  }
  const price = priceLineHTML(tile);
  return `<span class="tile-face"><span class="t-tile tile-name">${words}</span><span class="tile-icon">${tileIconHTML(tile)}</span>${price}</span>`;
}

function applyTileFace(el, tile) {
  if (tile.kind.startsWith("corner")) {
    el.classList.add("is-corner");
    el.innerHTML = cornerFaceHTML(tile);
    return;
  }
  const strip = tile.group ? `<span class="tile-strip" style="${stripStyle(tile)}"></span>` : "";
  el.innerHTML = strip + `<span class="tile-owner" style="display:none"></span>` + tileFaceHTML(tile);
}

function buildTile(tile, onTileClick) {
  const el = document.createElement("button");
  el.className = tileClassName(tile);
  el.dataset.tile = String(tile.i);
  el.style.gridColumn = String(tile.col);
  el.style.gridRow = String(tile.row);
  applyTileFace(el, tile);
  el.insertAdjacentHTML("beforeend", `<span class="tile-build side-${tile.side}"></span>`);
  el.addEventListener("click", () => onTileClick(tile));
  $("#board-grid").insertBefore(el, $("#center-field"));
}

export function buildBoard(onTileClick) {
  const grid = $("#board-grid");
  grid.querySelectorAll(".tile").forEach((n) => n.remove());
  paintSkyline($("#board-skyline"), BOARD_SKYLINE);
  TILES.forEach((tile) => buildTile(tile, onTileClick));
}

function renderTileState(el, tile) {
  el.classList.toggle("is-highlight", state.highlight === tile.i);
  el.classList.toggle("is-mortgaged", !!state.mortgaged[tile.i]);
}

// Ownership pips show the owner's face, not just their color: two seats
// may share a color once icons (color plus face) are the identity. Markup
// is memoized by signature exactly like board tokens, so repaints are a
// cache lookup and any face or color change re-renders by itself.
function ownerPipMarkup(owner, index) {
  const grid = owner.avatarGrid ? JSON.stringify(owner.avatarGrid) : "";
  return { sig: `${owner.id}:${owner.color}:${index}:${grid}`, markup: avatarHTML(owner, 1, index) };
}

function renderTileOwner(el, tile) {
  const pip = el.querySelector(".tile-owner");
  if (!pip) return;
  const owner = state.players.find((p) => p.id === state.owners[tile.i]);
  pip.style.display = owner ? "block" : "none";
  if (!owner) return;
  const face = ownerPipMarkup(owner, state.players.indexOf(owner));
  if (pip.dataset.sig !== face.sig) {
    pip.innerHTML = face.markup;
    pip.dataset.sig = face.sig;
  }
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

function renderTileBuild(el, tile) {
  const buildEl = el.querySelector(".tile-build");
  if (!buildEl) return;
  buildEl.innerHTML = tileBuildHTML(tile);
}

function renderBoardTile(tile) {
  const el = document.querySelector(`.tile[data-tile="${tile.i}"]`);
  if (!el) return;
  renderTileState(el, tile);
  renderTileOwner(el, tile);
  renderTileBuild(el, tile);
}

export function renderBoardState() {
  TILES.forEach(renderBoardTile);
}

const STACK_OFF = [
  { x: 0, y: 0 },
  { x: 11, y: -8 },
  { x: -11, y: 8 },
  { x: 11, y: 8 },
];

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

export function playerTileCenter(player, i = player?.pos) {
  return tileCenter(i, walkZoneFor(player, i));
}

const pieceWalks = new Map();
const PIECE_WALK_STEP_MS = 130;

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

function advancePieceWalk(playerId, walk, path, el) {
  if (walk.cancelled) return;
  if (pieceWalks.get(playerId) !== walk) return;
  const next = path[walk.index++];
  // A walk across the combined Passing By corner always uses the open lane.
  const center = tileCenter(next, "passing");
  if (!center) {
    cancelPieceWalk(playerId);
    placePieces();
    return;
  }
  setPiecePosition(el, center.x, center.y);
  hopPiece(el);
  if (walk.index < path.length) {
    walk.timer = setTimeout(() => advancePieceWalk(playerId, walk, path, el), PIECE_WALK_STEP_MS);
    return;
  }
  walk.timer = setTimeout(() => finishPieceWalk(playerId, walk, el), PIECE_WALK_STEP_MS);
}

function finishPieceWalk(playerId, walk, el) {
  if (pieceWalks.get(playerId) !== walk) return;
  pieceWalks.delete(playerId);
  el.classList.remove("is-moving", "is-hopping");
  placePieces();
}

function canAnimateWalk(el, path) {
  if (!el) return false;
  if (!path.length) return false;
  return !REDUCED_MOTION;
}

export function startPieceWalk(playerId, from, to) {
  const path = pieceWalkPath(Number(from) || 0, Number(to) || 0);
  const el = pieceElement(playerId);
  if (!canAnimateWalk(el, path)) return;
  cancelPieceWalk(playerId);
  const player = state.players.find((entry) => entry.id === playerId);
  const start = playerTileCenter(player, Number(from) || 0);
  if (!start) return;
  const walk = { cancelled: false, index: 0, timer: null };
  pieceWalks.set(playerId, walk);
  el.classList.add("is-moving");
  setPiecePosition(el, start.x, start.y);
  walk.timer = setTimeout(() => advancePieceWalk(playerId, walk, path, el), 16);
}

function pieceMarkupFor(player, index) {
  const grid = player.avatarGrid ? JSON.stringify(player.avatarGrid) : "";
  return { sig: `${player.id}:${player.color}:${index}:${grid}`, markup: avatarHTML(player, 3, index) };
}

function ensurePiece(layer, p, i) {
  let el = layer.querySelector(`.piece[data-player="${p.id}"]`);
  if (!el) {
    el = document.createElement("div");
    el.className = "piece";
    el.dataset.player = p.id;
    layer.appendChild(el);
  }
  el.style.borderColor = p.color;
  el.title = p.name;
  const face = pieceMarkupFor(p, i);
  if (el.dataset.sig !== face.sig) {
    el.innerHTML = face.markup;
    el.dataset.sig = face.sig;
  }
}

function pruneStrayPieces(layer) {
  layer.querySelectorAll(".piece").forEach((el) => {
    if (state.players.some((p) => p.id === el.dataset.player)) return;
    el.remove();
  });
}

function ensurePieces() {
  const layer = $("#token-layer");
  if (!layer) return;
  state.players.forEach((p, i) => ensurePiece(layer, p, i));
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
  state.players.forEach((p) => {
    const list = occupants[p.pos];
    if (list) {
      list.push(p.id);
      return;
    }
    occupants[p.pos] = [p.id];
  });
  return occupants;
}

function stackOffset(stack, idx) {
  if (stack.length === 1) return { x: 0, y: 0 };
  const off = STACK_OFF[idx];
  if (off) return off;
  return { x: 0, y: 0 };
}

function isTurnPlayer(player) {
  if (state.phase !== "playing") return false;
  const current = state.players[state.turnIndex];
  return current?.id === player.id;
}

function placeOnePiece(player, ctx) {
  const el = ctx.layer.querySelector(`.piece[data-player="${player.id}"]`);
  if (!el) return;
  const c = playerTileCenter(player);
  if (!c) return;
  const stack = ctx.occupants[player.pos] || [player.id];
  const idx = Math.max(0, stack.indexOf(player.id));
  const off = stackOffset(stack, idx);
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
