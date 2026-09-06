/* ============================================================
   PIXEL SPRITE ENGINE (shared by client renderers)
   ============================================================ */
function sprite(rows, palette, size = 3) {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  let cells = "";
  rows.forEach((row, y) => {
    row.split("").forEach((c, x) => {
      if (palette[c]) cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[c]}"/>`;
    });
  });
  return `<svg width="${w * size}" height="${h * size}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${cells}</svg>`;
}

const AVATAR_FACES = [
  ["..1111..", ".111111.", "11211211", "11111111", "11311311", "11133111", ".111111.", "..1111.."],
  [".111111.", "11111111", "12111121", "11111111", "13111131", "11311311", "11111111", ".111111."],
  ["..1111..", ".111111.", "11211211", "11111111", "11311311", "11311311", ".111111.", "..1111.."],
  [".111111.", "11211211", "11111111", "11111111", "13333131", "11111111", "11111111", ".1.11.1."],
];

const SPRITES = {
  logo: (s) =>
    sprite(
      [".111111.", "12222221", "12133121", "12133121", "12111121", "12133121", "12222221", ".111111."],
      { 1: "#9b783d", 2: "#0a1416", 3: "#cfa75f" },
      s,
    ),
  car: (s) => sprite([".......", "..111..", ".11111.", "1112111", "1111111", ".2...2."], { 1: "#d74438", 2: "#2a1416" }, s),
  palm: (s) => sprite(["..111..", ".11311.", "11.3.11", "...3...", "...3...", "..444.."], { 1: "#78894f", 3: "#7b5029", 4: "#3e7d7b" }, s),
  chest: (s) => sprite([".11111.", "1222221", "1233321", "1222221", "1222221", "1111111"], { 1: "#5c5033", 2: "#cfa75f", 3: "#f0d9ac" }, s),
  bulb: (s) => sprite([".111.", "12221", "12221", ".121.", ".333.", ".3.3."], { 1: "#cfa75f", 2: "#f0d9ac", 3: "#5c5033" }, s),
  faucet: (s) => sprite(["11111..", "..1....", "..11111", ".....1.", "....22.", "....2.."], { 1: "#a79d7d", 2: "#3e7d7b" }, s),
  train: (s) => sprite(["..1111.", ".111111", "1111111", "2222222", ".3...3."], { 1: "#cfa75f", 2: "#5c5033", 3: "#a79d7d" }, s),
  crown: (s) => sprite(["1.1.1", "11111", "11111"], { 1: "#c88f2e" }, s),
  note: (s) => sprite(["1111111111", "1..2222..1", "1.2.22.2.1", "1..2222..1", "1111111111"], { 1: "#35a653", 2: "#f0d9ac" }, s),
  arrow: (s) => sprite(["..1..", "..11.", "11111", "..11.", "..1.."], { 1: "#c88f2e" }, s),
  diamond: (s) => sprite([".1.", "111", ".1."], { 1: "#cfa75f" }, s),
  send: (s) => sprite(["1....", "111..", "11111", "111..", "1...."], { 1: "#cfa75f" }, s),
  help: (s) => sprite([".111.", "1...1", "...11", "..11.", ".....", "..1.."], { 1: "#cfa75f" }, s),
  dice: (s) => sprite(["1111111", "1..1..1", "1.111.1", "1..1..1", "1111111"], { 1: "#f0d9ac" }, s),
  house: (s, color) => sprite(["..1..", ".111.", "11111", "1.1.1", "11111"], { 1: color }, s),
  hotel: (s, color) => sprite(
    [
      ".1111.",
      "111111",
      "111111",
      "112221",
      "112221",
      "111111",
      "111111",
      "333333",
    ],
    { 1: color, 2: "#01070a", 3: "#5c5033" },
    s,
  ),
  pawn: (s, color) => sprite([".11.", "1111", ".11.", "1111"], { 1: color }, s),
  avatar: (s, color, seed) => sprite(AVATAR_FACES[seed % AVATAR_FACES.length], { 1: color, 2: "#01070a", 3: "#01070a" }, s),
};

/** hydrate every <span data-sprite="..."> in the document */
const COLOR_SPRITES = new Set(["pawn", "house", "hotel"]);

function spriteElementSize(el) {
  return Number(el.dataset.size || 3);
}

function spriteMarkupFor(el) {
  const name = el.dataset.sprite;
  const fn = SPRITES[name];
  if (!fn) return null;
  if (name === "avatar") {
    return fn(spriteElementSize(el), el.dataset.color || "#cfa75f", Number(el.dataset.seed || 0));
  }
  if (COLOR_SPRITES.has(name)) return fn(spriteElementSize(el), el.dataset.color || "#cfa75f");
  return fn(spriteElementSize(el));
}

function hydrateSprite(el) {
  if (el.dataset.done === "1") return;
  const markup = spriteMarkupFor(el);
  if (markup === null) return;
  el.innerHTML = markup;
  el.dataset.done = "1";
}

function hydrateSprites(root = document) {
  root.querySelectorAll("[data-sprite]").forEach(hydrateSprite);
}

function spriteHTML(name, size, color, seed) {
  const fn = SPRITES[name];
  if (!fn) return "";
  if (name === "avatar") return fn(size, color, seed || 0);
  if (COLOR_SPRITES.has(name)) return fn(size, color);
  return fn(size);
}

const FACE_SIZE = 8;

/** Render an 8x8 grid of hex colors (or null = transparent) as a crisp SVG. */
function spriteFromGrid(grid, size = 4) {
  if (!grid || !grid.length) return "";
  const h = grid.length;
  const w = grid[0].length;
  let cells = "";
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      if (c) cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  }
  return `<svg width="${w * size}" height="${h * size}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${cells}</svg>`;
}

/** Unified avatar renderer: custom drawn face if present, else the generic pixel face. */
function avatarHTML(entity, size = 4, seed = 0) {
  if (entity && entity.avatarGrid) return spriteFromGrid(entity.avatarGrid, size);
  return spriteHTML("avatar", size, entity?.color || "#cfa75f", seed);
}

function emptyFaceGrid() {
  return Array.from({ length: FACE_SIZE }, () => Array.from({ length: FACE_SIZE }, () => null));
}

/** Convert one of the built-in ASCII avatar faces into an editable hex grid. */
function faceGridFromPreset(seed, color) {
  const rows = AVATAR_FACES[seed % AVATAR_FACES.length];
  return rows.map((row) => row.split("").map((c) => (c === "1" ? color : c === "2" || c === "3" ? "#01070a" : null)));
}

function cloneFaceGrid(grid) {
  return grid.map((row) => row.slice());
}
export {
  hydrateSprites,
  spriteHTML,
  spriteFromGrid,
  avatarHTML,
  emptyFaceGrid,
  faceGridFromPreset,
  cloneFaceGrid,
  AVATAR_FACES,
  FACE_SIZE,
};
