/* ============================================================
   1. PIXEL SPRITE ENGINE
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
function hydrateSprites(root = document) {
  root.querySelectorAll("[data-sprite]").forEach((el) => {
    if (el.dataset.done === "1") return;
    const name = el.dataset.sprite;
    const size = Number(el.dataset.size || 3);
    const fn = SPRITES[name];
    if (!fn) return;
    if (name === "avatar") el.innerHTML = fn(size, el.dataset.color || "#cfa75f", Number(el.dataset.seed || 0));
    else if (name === "pawn" || name === "house") el.innerHTML = fn(size, el.dataset.color || "#cfa75f");
    else el.innerHTML = fn(size);
    el.dataset.done = "1";
  });
}

function spriteHTML(name, size, color, seed) {
  const fn = SPRITES[name];
  if (!fn) return "";
  if (name === "avatar") return fn(size, color, seed || 0);
  if (name === "pawn" || name === "house" || name === "hotel") return fn(size, color);
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

/* ============================================================
   2. BOARD DATA
   ============================================================ */
const GROUP_COLOR = {
  brown: "#7b5029",
  cyan: "#3e7d7b",
  magenta: "#a04e6f",
  orange: "#b96d2a",
  red: "#87231e",
  yellow: "#b18a2e",
  green: "#4b853d",
  blue: "#286ea1",
};

/**
 * Rent per [base, 1, 2, 3, 4, hotel] for a property.
 *   base          — rent on this single deed (no monopoly)
 *   1..4          — rent with N houses
 *   hotel         — rent with a hotel
 * housePrice      — flat cost to build the next house
 *                  (Monopoly uses a unique per-property price, but a single
 *                   group-level price keeps the table readable here)
 */
const RENT_TABLE = {
  brown:   { base: 10,  rents: [10, 50, 150, 450, 800, 1250], housePrice: 50 },
  cyan:    { base: 14,  rents: [14, 70, 210, 630, 1100, 1600], housePrice: 50 },
  magenta: { base: 10,  rents: [10, 50, 150, 450, 800, 1250], housePrice: 100 },
  orange:  { base: 14,  rents: [14, 70, 210, 630, 1100, 1600], housePrice: 100 },
  red:     { base: 18,  rents: [18, 90, 270, 810, 1500, 2200], housePrice: 150 },
  yellow:  { base: 22,  rents: [22, 110, 330, 990, 1800, 2600], housePrice: 150 },
  green:   { base: 26,  rents: [26, 130, 390, 1170, 2100, 3000], housePrice: 200 },
  blue:    { base: 35,  rents: [35, 175, 525, 1575, 2800, 4000], housePrice: 200 },
  railroad:{ base: 25,  rents: [25, 50, 100, 200],             housePrice: 0 },
  utility: { base: 12,  rents: [12, 24,  48,  72],              housePrice: 0 },
};

const MAX_HOUSES = 4;        // 1..4 houses allowed
const HOTEL_LEVEL = 5;       // 5 = hotel (replaces 4 houses)
const GROUP_TARGETS = { brown: 2, cyan: 3, magenta: 3, orange: 3, red: 3, yellow: 3, green: 3, blue: 2 };

const t = (i, name, kind, col, row, side, extra = {}) => ({ i, name, kind, col, row, side, ...extra });

const TILES = [
  t(0, "START", "corner-go", 11, 11, "bottom"),
  t(1, "SALVADOR", "property", 10, 11, "bottom", { price: 60, rent: 10, group: "brown" }),
  t(2, "TREASURE", "chest", 9, 11, "bottom"),
  t(3, "RIO", "property", 8, 11, "bottom", { price: 60, rent: 10, group: "brown" }),
  t(4, "EARNINGS TAX", "tax", 7, 11, "bottom", { price: 200 }),
  t(5, "ACC AIRPORT", "railroad", 6, 11, "bottom", { price: 200, rent: 25 }),
  t(6, "ACCRA", "property", 5, 11, "bottom", { price: 100, rent: 14, group: "cyan" }),
  t(7, "SURPRISE?", "chance", 4, 11, "bottom"),
  t(8, "TEMA", "property", 3, 11, "bottom", { price: 100, rent: 14, group: "cyan" }),
  t(9, "KUMASI", "property", 2, 11, "bottom", { price: 120, rent: 16, group: "cyan" }),
  t(10, "PASSING BY", "corner-jail", 1, 11, "bottom"),
  t(11, "PATTAYA", "property", 1, 10, "left", { price: 140, rent: 10, group: "magenta" }),
  t(12, "ELECTRIC COMPANY", "utility", 1, 9, "left", { price: 150, rent: 12 }),
  t(13, "CHIANG MAI", "property", 1, 8, "left", { price: 140, rent: 12, group: "magenta" }),
  t(14, "BANGKOK", "property", 1, 7, "left", { price: 160, rent: 14, group: "magenta" }),
  t(15, "BKK AIRPORT", "railroad", 1, 6, "left", { price: 200, rent: 25 }),
  t(16, "KYOTO", "property", 1, 5, "left", { price: 180, rent: 14, group: "orange" }),
  t(17, "TREASURE", "chest", 1, 4, "left"),
  t(18, "OSAKA", "property", 1, 3, "left", { price: 180, rent: 14, group: "orange" }),
  t(19, "TOKYO", "property", 1, 2, "left", { price: 200, rent: 16, group: "orange" }),
  t(20, "VACATION", "corner-vacation", 1, 1, "top"),
  t(21, "EINDHOVEN", "property", 2, 1, "top", { price: 220, rent: 18, group: "red" }),
  t(22, "SURPRISE?", "chance", 3, 1, "top"),
  t(23, "ROTTERDAM", "property", 4, 1, "top", { price: 220, rent: 18, group: "red" }),
  t(24, "AMSTERDAM", "property", 5, 1, "top", { price: 240, rent: 20, group: "red" }),
  t(25, "AMS AIRPORT", "railroad", 6, 1, "top", { price: 200, rent: 25 }),
  t(26, "CALGARY", "property", 7, 1, "top", { price: 260, rent: 22, group: "yellow" }),
  t(27, "VANCOUVER", "property", 8, 1, "top", { price: 260, rent: 22, group: "yellow" }),
  t(28, "WATER COMPANY", "utility", 9, 1, "top", { price: 150, rent: 12 }),
  t(29, "TORONTO", "property", 10, 1, "top", { price: 280, rent: 24, group: "yellow" }),
  t(30, "GO TO PRISON", "corner-go-jail", 11, 1, "top"),
  t(31, "BERN", "property", 11, 2, "right", { price: 300, rent: 26, group: "green" }),
  t(32, "GENEVA", "property", 11, 3, "right", { price: 300, rent: 26, group: "green" }),
  t(33, "TREASURE", "chest", 11, 4, "right"),
  t(34, "ZURICH", "property", 11, 5, "right", { price: 320, rent: 28, group: "green" }),
  t(35, "MB AIRPORT", "railroad", 11, 6, "right", { price: 200, rent: 25 }),
  t(36, "SURPRISE?", "chance", 11, 7, "right"),
  t(37, "DOWNTOWN", "property", 11, 8, "right", { price: 350, rent: 35, group: "blue" }),
  t(38, "PREMIUM TAX", "tax", 11, 9, "right", { price: 100 }),
  t(39, "MARINA BAY", "property", 11, 10, "right", { price: 400, rent: 50, group: "blue" }),
];
const TILE_COUNT = TILES.length;

const CHANCE_EVENTS = [
  { text: "BANK DIVIDEND — COLLECT $50", cash: 50 },
  { text: "SPEEDING FINE — PAY $15", cash: -15 },
  { text: "STREET REPAIRS — PAY $40", cash: -40 },
  { text: "WON THE PARLOR RAFFLE — COLLECT $100", cash: 100 },
  { text: "LATE NIGHT CAB — PAY $25", cash: -25 },
];
const CHEST_EVENTS = [
  { text: "OLD DEBT REPAID — COLLECT $75", cash: 75 },
  { text: "DOCTOR'S FEE — PAY $50", cash: -50 },
  { text: "SOLD A JUKEBOX — COLLECT $120", cash: 120 },
  { text: "PARLOR TAB DUE — PAY $30", cash: -30 },
];

const APPEARANCES = [
  { label: "CRIMSON", baseName: "MARLOWE", color: "#d74438", textColor: "#d74438" },
  { label: "COBALT", baseName: "VESPER", color: "#286ea1", textColor: "#3c8bc3" },
  { label: "AMBER", baseName: "SOLOMON", color: "#d9a62f", textColor: "#d9a62f" },
  { label: "VERDANT", baseName: "JUNIPER", color: "#35a653", textColor: "#35a653" },
];

const BOT_LINES = [
  "that lot is mine next lap",
  "the bank always wins, kid",
  "rent me once, shame on you",
  "dice are cold tonight",
  "cash flow looking thin",
  "keep your hands off pine road",
];

/* ============================================================
   PLAYER PROFILES (persisted library of custom designs)
   ============================================================ */
const PROFILE_KEY = "poorup.profile.v1";   // legacy single profile
const LIBRARY_KEY = "poorup.profiles.v1";  // array of saved profiles
const ACCOUNT_SESSION_KEY = "poorup.account.session.v1";
const GUEST_ALIAS_KEY = "poorup.guest.alias.v1";

function sanitizeProfile(p) {
  if (!p || typeof p !== "object") return null;
  if (!/^#[0-9a-f]{6}$/i.test(String(p.color || ""))) return null;
  if (!Array.isArray(p.avatarGrid) || !p.avatarGrid.every((row) => Array.isArray(row))) return null;
  const grid = Array.from({ length: FACE_SIZE }, (_, y) =>
    Array.from({ length: FACE_SIZE }, (_, x) => {
      const v = p.avatarGrid[y]?.[x];
      return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
    }),
  );
  return {
    id: typeof p.id === "string" ? p.id : `pf_${Math.random().toString(36).slice(2, 9)}`,
    name: String(p.name || "PLAYER").toUpperCase().slice(0, 12),
    color: p.color,
    avatarGrid: grid,
  };
}

function loadProfiles() {
  let library = [];
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) library = arr.map(sanitizeProfile).filter(Boolean);
    }
  } catch { /* ignore */ }
  // migrate a v1 single profile into the library on first load
  if (!library.length) {
    try {
      const legacy = sanitizeProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"));
      if (legacy) {
        library = [legacy];
        saveProfilesToStorage(library);
        localStorage.removeItem(PROFILE_KEY);
      }
    } catch { /* ignore */ }
  }
  return library;
}

function loadGuestAlias() {
  try {
    return String(localStorage.getItem(GUEST_ALIAS_KEY) || "").trim().toUpperCase().slice(0, 12);
  } catch {
    return "";
  }
}

function saveGuestAlias(alias) {
  const value = String(alias || "").trim().toUpperCase().slice(0, 12);
  try {
    if (value) localStorage.setItem(GUEST_ALIAS_KEY, value);
    else localStorage.removeItem(GUEST_ALIAS_KEY);
  } catch { /* storage unavailable */ }
  return value;
}

function sanitizeAccountSession(value) {
  if (!value || typeof value !== "object" || typeof value.sessionToken !== "string") return null;
  const account = value.account;
  if (!account || typeof account.id !== "string" || typeof account.username !== "string") return null;
  return {
    sessionToken: value.sessionToken,
    account: {
      id: account.id,
      username: account.username,
      displayName: String(account.displayName || account.username).slice(0, 18),
      color: /^#[0-9a-f]{6}$/i.test(String(account.color || "")) ? account.color : "#d74438",
      avatarGrid: Array.isArray(account.avatarGrid) ? account.avatarGrid : null,
      stats: {
        gamesPlayed: Number(account.stats?.gamesPlayed) || 0,
        wins: Number(account.stats?.wins) || 0,
        bankruptcies: Number(account.stats?.bankruptcies) || 0,
      },
    },
  };
}

function loadAccountSession() {
  try {
    return sanitizeAccountSession(JSON.parse(localStorage.getItem(ACCOUNT_SESSION_KEY) || "null"));
  } catch {
    return null;
  }
}

function saveAccountSession(session) {
  state.account = session;
  try {
    if (session) localStorage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(ACCOUNT_SESSION_KEY);
  } catch { /* storage unavailable */ }
}

function saveProfilesToStorage(library) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch { /* ignore */ }
}

const MAX_PROFILES = 4;

function upsertProfile(profile) {
  const clean = sanitizeProfile(profile);
  if (!clean) return null;
  const lib = state.profiles.slice();
  const idx = lib.findIndex((p) => p.id === clean.id);
  if (idx >= 0) {
    lib[idx] = clean;
  } else {
    if (lib.length >= MAX_PROFILES) return "limit";
    lib.push(clean);
  }
  state.profiles = lib;
  saveProfilesToStorage(lib);
  return clean;
}

function deleteProfile(id) {
  state.profiles = state.profiles.filter((p) => p.id !== id);
  saveProfilesToStorage(state.profiles);
  // if the active appearance pointed at this profile, reset to CRIMSON
  if (typeof state.appearance === "string" && state.appearance === id) state.appearance = 0;
}

function getProfileById(id) {
  return state.profiles.find((p) => p.id === id) || null;
}

/** Returns display metadata for a setup-overlay appearance choice.
 *  `choice` is either a numeric APPEARANCES index or a profile id string. */
function getAppearanceMeta(choice) {
  if (typeof choice === "string") {
    const p = getProfileById(choice);
    if (p) {
      return {
        label: "CUSTOM",
        baseName: p.name || "PLAYER",
        color: p.color,
        textColor: p.color,
        avatarGrid: p.avatarGrid,
      };
    }
  }
  const a = APPEARANCES[choice] || APPEARANCES[0];
  return { label: a.label, baseName: a.baseName, color: a.color, textColor: a.textColor, avatarGrid: null };
}

/* ============================================================
   3. UTILITIES
   ============================================================ */
const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const d6 = () => 1 + Math.floor(Math.random() * 6);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const REDUCED_MOTION = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;

/* ---- restrained arcade sfx (Web Audio, no assets) ------------------ */
let audioCtx = null;
function tone(freq, dur, type = "square", vol = 0.035, when = 0) {
  if (!state.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime + when;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  } catch { /* audio blocked */ }
}
function playSound(name) {
  if (!state.sound) return;
  switch (name) {
    case "die": tone(220, 0.05, "square", 0.03); break;
    case "cash": tone(660, 0.06, "square", 0.03); tone(880, 0.07, "square", 0.03, 0.06); break;
    case "house": tone(140, 0.08, "square", 0.04); break;
    case "auction": tone(520, 0.12, "square", 0.03); tone(390, 0.14, "square", 0.03, 0.12); break;
    case "trade": tone(520, 0.08, "square", 0.03); tone(780, 0.1, "square", 0.03, 0.09); break;
    case "step": tone(180, 0.03, "square", 0.02); break;
  }
}

function buildPlayers(choiceIndex, alias) {
  const selected = getAppearanceMeta(choiceIndex);
  // bots always come from the four preset appearances, minus whichever
  // preset color collides with the human's pick (custom profiles never collide)
  const rest = typeof choiceIndex === "number"
    ? APPEARANCES.filter((_, i) => i !== choiceIndex)
    : APPEARANCES.filter((a) => a.color.toLowerCase() !== selected.color.toLowerCase()).slice(0, 3);
  const seed = [1420, 1680, 980];
  const pos = [5, 12, 22];
  return [
    {
      id: "p1",
      name: (alias.trim() || selected.baseName).toUpperCase(),
      color: selected.color,
      textColor: selected.textColor,
      cash: 1500,
      pos: 0,
      online: true,
      avatarGrid: selected.avatarGrid || undefined,
    },
    ...rest.slice(0, 3).map((a, i) => ({
      id: `p${i + 2}`,
      name: a.baseName,
      color: a.color,
      textColor: a.textColor,
      cash: seed[i],
      pos: pos[i],
      online: i !== 2,
      bot: true,
    })),
  ];
}

/* ============================================================
   4. STATE
   ============================================================ */
const state = {
  live: true,
  clientId: localStorage.getItem("poorup-client-id") || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  account: loadAccountSession(),
  hostId: null,
  serverTiles: [],
  pendingRoomSettings: null,
  pendingRoomMeta: null,
  suppressRoomUpdates: false,
  connectionStatus: "connecting", // connecting | online | reconnecting | offline
  lastConnectionAnnouncement: "",
  previousTurnKey: "",
  phase: "home", // home | setup | lobby | playing
  roomCode: "",
  alias: loadGuestAlias(),
  appearance: 0,
  setupTab: "preset",         // "preset" | "custom" — which tab is showing in the setup grid
  profiles: loadProfiles(),   // persisted array of saved player designs
  profileDraft: null,         // working copy while the profile editor is open
  editingProfileId: null,     // id of profile being edited (null = brand new)
  homeReturnView: "home",     // where the profile editor's back button should return to
  players: buildPlayers(0, "MARLOWE"),
  turnIndex: 0,
  dice: [3, 5],
  rolling: false,
  busy: false,
  turnStage: "roll", // roll | end — landing actions happen before explicit end
  pool: 0,
  owners: {},
  highlight: null,
  selectedTile: null,
  tab: "deeds",
  tradeWith: null,
  tradeMyDeeds: new Set(),
  tradeTheirDeeds: new Set(),
  tradeMyCash: 0,
  tradeTheirCash: 0,
  houses: {},      // { [tileId]: 0..4 | 5(hotel) }
  mortgaged: {},   // { [tileId]: true }
  offers: [],      // pending bot→human trade offers
  pendingBuyTile: null, // tile the human must resolve (buy/auction) before ending
  auction: null,        // live auction state object
  deedDetail: null,     // tile index currently open in the deed/house manager
  jail: {},             // { playerId: turnsRemaining }
  card: null,           // { tile, ev, kind } modal reveal
  gameOver: null,       // { winnerName, winnerId, summary[] } end screen
  sound: false,         // audio toggle
  quickJoin: false,     // "quick table" uses all-default rules
  settings: {
    maxPlayers:      4,       // 2 – 4
    startingCash:    1500,    // 1000 / 1500 / 2000 / 3000
    vacationPool:    true,    // free-parking jackpot on/off
    trading:         true,    // trading on/off
    auction:         false,   // auction unowned deeds on/off
    doubleGo:        false,   // $400 for landing exactly on GO
    noRentInJail:    true,    // owner can't collect while visiting
    houseLimit:      32,      // house bank 10 / 20 / 32 (unlimited)
    hotelLimit:      12,      // hotel bank 6 / 12 (unlimited)
    turnTimer:       0,       // seconds per turn: 0=off, 30, 60, 120
    bankruptMode:    "elim",  // "elim" | "debt" (debt = give assets, stay in)
  },
  log: ["WAITING FOR GAME — CHOOSE YOUR APPEARANCE."],
  messages: [
    { who: "", color: "", text: "TABLE OPENED. CHOOSE YOUR APPEARANCE.", system: true },
    { who: "", color: "", text: "JOIN A ROOM TO GET STARTED.", system: true },
  ],
};

/* ============================================================
   SHARED SURFACE / DIALOG CONTROLLER
   Keep every blocking surface keyboard-safe without coupling the
   game state machine to a particular modal implementation.
   ============================================================ */
const SURFACE_SELECTORS = [
  "#rooms-modal", "#account-modal", "#setup-wrap", "#popup", "#trade-modal", "#choice-modal",
  "#auction-modal", "#offer-modal", "#deed-modal", "#bankruptcy-modal",
  "#card-modal", "#gameover-modal",
];
let surfaceReturnFocus = null;
const surfaceInertNodes = new Set();

function visibleSurfaces() {
  return SURFACE_SELECTORS
    .map((selector) => $(selector))
    .filter((el) => el && !el.classList.contains("is-hidden"));
}

function surfaceFocusable(surface) {
  return [...surface.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((el) => !el.closest(".is-hidden") && el.getAttribute("aria-hidden") !== "true");
}

function syncSurfaceA11y() {
  const visible = visibleSurfaces();
  const active = visible.at(-1) || null;
  surfaceInertNodes.forEach((node) => { node.inert = false; });
  surfaceInertNodes.clear();
  const setInert = (node) => {
    if (!node || node === active) return;
    node.inert = true;
    surfaceInertNodes.add(node);
  };
  SURFACE_SELECTORS.forEach((selector) => {
    const el = $(selector);
    if (!el) return;
    const hidden = el.classList.contains("is-hidden");
    el.setAttribute("aria-hidden", String(hidden));
    if (!hidden) el.setAttribute("aria-modal", "true");
  });
  document.querySelectorAll(".view").forEach((view) => {
    if (active && !view.contains(active)) setInert(view);
  });
  if (active) {
    let node = active;
    while (node && node.parentElement) {
      [...node.parentElement.children].forEach((sibling) => {
        if (sibling !== node && !sibling.contains(active)) setInert(sibling);
      });
      node = node.parentElement;
      if (node.classList?.contains("view")) break;
    }
  }
  return active;
}

function openSurface(selector, focusSelector) {
  const surface = $(selector);
  if (!surface) return;
  const wasVisible = !surface.classList.contains("is-hidden");
  if (!visibleSurfaces().length && document.activeElement instanceof HTMLElement) surfaceReturnFocus = document.activeElement;
  surface.classList.remove("is-hidden");
  surface.setAttribute("aria-hidden", "false");
  syncSurfaceA11y();
  if (wasVisible) return;
  requestAnimationFrame(() => {
    const preferred = focusSelector ? surface.querySelector(focusSelector) : null;
    const target = preferred && !preferred.disabled ? preferred : surfaceFocusable(surface)[0];
    target?.focus({ preventScroll: true });
  });
}

function closeSurface(selector) {
  const surface = $(selector);
  if (!surface) return;
  surface.classList.add("is-hidden");
  surface.setAttribute("aria-hidden", "true");
  const active = syncSurfaceA11y();
  if (active) {
    surfaceFocusable(active)[0]?.focus({ preventScroll: true });
  } else if (surfaceReturnFocus && document.contains(surfaceReturnFocus)) {
    surfaceReturnFocus.focus({ preventScroll: true });
    surfaceReturnFocus = null;
  }
}

function closeAllSurfaces() {
  SURFACE_SELECTORS.forEach((selector) => {
    const surface = $(selector);
    if (surface) {
      surface.classList.add("is-hidden");
      surface.setAttribute("aria-hidden", "true");
    }
  });
  syncSurfaceA11y();
  surfaceReturnFocus = null;
}

function focusSurface(selector, focusSelector) {
  const surface = $(selector);
  if (!surface || surface.classList.contains("is-hidden")) return;
  requestAnimationFrame(() => {
    const preferred = focusSelector ? surface.querySelector(focusSelector) : null;
    const target = preferred && !preferred.disabled ? preferred : surfaceFocusable(surface)[0];
    target?.focus({ preventScroll: true });
  });
}

if (state.profiles.length) {
  const first = state.profiles[0];
  state.appearance = first.id;
  state.alias = first.name || "PLAYER";
  state.players = buildPlayers(first.id, state.alias);
}
if (state.account) {
  state.alias = state.account.account.displayName;
  state.players = buildPlayers(state.appearance, state.alias);
}

try { localStorage.setItem("poorup-client-id", state.clientId); } catch { /* storage unavailable */ }

/* ============================================================
   LIVE SOCKET.IO ADAPTER
   The ZIP remains the complete UI source; this small boundary maps its
   renderer state to the existing server-authoritative game protocol.
   ============================================================ */
const socket = typeof window.io === "function" ? window.io() : null;
const SERVER_SETTING_KEYS = {
  maxPlayers: "maxPlayers",
  startingCash: "startingCash",
  vacationPool: "vacationCash",
  auction: "auction",
  noRentInJail: "noRentWhileInPrison",
  trading: "trading",
  doubleGo: "doubleGo",
  houseLimit: "houseLimit",
  hotelLimit: "hotelLimit",
  turnTimer: "turnTimer",
  bankruptMode: "bankruptMode",
};

function emitServer(event, payload = {}, callback) {
  if (!socket) {
    setConnectionStatus("offline", true);
    callback?.({ success: false, error: "Live connection unavailable." });
    return;
  }
  socket.emit(event, {
    ...payload,
    clientId: state.clientId,
    sessionToken: state.account?.sessionToken,
  }, callback);
}

function serverTileFor(index) {
  return state.serverTiles.find((tile) => Number(tile.index) === Number(index))
    || state.serverTiles.find((tile) => Number(tile.index) === (Number(index) % TILE_COUNT));
}

function applyServerState(snapshot) {
  if (!snapshot?.room || !snapshot?.game) return;
  if (state.suppressRoomUpdates) return;
  setConnectionStatus("online");
  const { room, game } = snapshot;
  state.roomCode = room.roomCode || state.roomCode;
  state.hostId = room.hostId || null;
  state.serverTiles = Array.isArray(game.tiles) ? game.tiles : [];
  const remotePlayers = Array.isArray(game.players) ? game.players : room.players || [];
  const turnOrder = Array.isArray(game.turnOrder) && game.turnOrder.length
    ? game.turnOrder
    : remotePlayers.map((player) => player.id);
  state.players = remotePlayers.map((player) => ({
    id: player.clientId === state.clientId ? "p1" : player.id,
    serverId: player.id,
    clientId: player.clientId,
    accountId: player.accountId || null,
    name: String(player.nickname || "PLAYER").toUpperCase(),
    color: player.color || "#cfa75f",
    textColor: player.color || "#e8d3ab",
    cash: Number(player.cash) || 0,
    pos: Number(player.position) || 0,
    online: !player.disconnected,
    bot: false,
    isHost: Boolean(player.isHost),
  })).sort((a, b) => {
    if (a.clientId === state.clientId) return -1;
    if (b.clientId === state.clientId) return 1;
    return turnOrder.indexOf(a.serverId) - turnOrder.indexOf(b.serverId);
  });
  state.turnIndex = Math.max(0, state.players.findIndex((player) => player.serverId === game.currentPlayerId));
  state.dice = Array.isArray(game.lastDice) ? game.lastDice : [0, 0];
  state.pool = Number(game.vacationPool) || 0;
  state.houses = Object.fromEntries(state.serverTiles.map((tile) => [tile.index, Number(tile.houseCount) || 0]));
  state.mortgaged = Object.fromEntries(state.serverTiles.filter((tile) => tile.mortgaged).map((tile) => [tile.index, true]));
  state.owners = {};
  state.serverTiles.forEach((tile) => {
    if (!tile.ownerId) return;
    const owner = state.players.find((player) => player.serverId === tile.ownerId);
    if (owner) state.owners[tile.index] = owner.id;
  });
  state.jail = Object.fromEntries(remotePlayers.filter((player) => player.inJail).map((player) => [
    player.clientId === state.clientId ? "p1" : player.id,
    Number(player.jailTurns) || 1,
  ]));
  state.phase = game.started ? "playing" : state.phase === "setup" ? "setup" : "lobby";
  const turnKey = `${game.currentPlayerId || "none"}:${game.hasRolled ? "rolled" : "roll"}:${game.extraRollPending ? "extra" : "normal"}`;
  const turnChanged = state.previousTurnKey !== turnKey;
  state.previousTurnKey = turnKey;
  state.turnStage = game.hasRolled && !game.extraRollPending ? "end" : "roll";
  state.busy = false;
  state.rolling = false;
  state.log = (game.feed || []).map((entry) => typeof entry === "string" ? entry : entry.text).filter(Boolean).slice(0, 40);
  state.settings = {
    ...state.settings,
    ...(room.settings || {}),
    vacationPool: room.settings?.vacationCash ?? state.settings.vacationPool,
    noRentInJail: room.settings?.noRentWhileInPrison ?? state.settings.noRentInJail,
  };
  state.pendingBuyTile = game.pendingPurchaseOffer?.tileIndex ?? null;
  state.auction = game.auction ? {
    tileIndex: Number(game.auction.tileIndex),
    bid: Number(game.auction.highestBid) || 0,
    leaderId: state.players.find((player) => player.serverId === game.auction.highestBidderId)?.id || null,
    deadline: Number(game.auction.endsAt) || Date.now() + AUCTION_MS,
    caps: {},
    passed: Object.fromEntries((game.auction.passedPlayerIds || []).map((id) => [state.players.find((p) => p.serverId === id)?.id, true]).filter(([id]) => id)),
  } : null;
  showView("game");
  renderAll();
  if (state.auction) {
    renderAuction();
    openSurface("#auction-modal", "#auction-pass");
    clearInterval(auctionTimer);
    auctionTimer = setInterval(tickAuction, 60);
  } else {
    clearInterval(auctionTimer);
    auctionTimer = null;
    closeSurface("#auction-modal");
  }
  const debt = game.pendingPayment;
  const meServerId = state.players[0]?.serverId;
  if (debt && debt.playerId === meServerId && $("#bankruptcy-modal")?.classList.contains("is-hidden")) {
    const meIndex = state.players.findIndex((player) => player.serverId === meServerId);
    if (meIndex >= 0) openBankruptcyModal(meIndex, Number(debt.amountRemaining) || 0, debt.creditorId, debt.reason || "This payment is due.");
  } else if (!debt) {
    $("#bankruptcy-modal")?.classList.add("is-hidden");
  }
  if (game.lastWinner && !state.gameOver) {
    showGameOver(game.lastWinner.nickname || "The winner", game.lastWinner.id);
  }
  if (turnChanged && state.phase === "playing" && state.turnIndex === 0) startTurnCountdown();
  requestAnimationFrame(() => placePieces());
}

function updateServerSetting(key, value) {
  state.settings[key] = value;
  const serverKey = SERVER_SETTING_KEYS[key];
  if (serverKey) emitServer("set-setting", { key: serverKey, value }, () => {});
}

if (socket) {
  socket.on("connect", () => {
    setConnectionStatus("online", true);
    if (state.account?.sessionToken) {
      socket.emit("account-restore", { sessionToken: state.account.sessionToken }, (response) => {
        if (response?.success) updateAccountFromResponse({ account: response.account, sessionToken: state.account.sessionToken });
        else {
          saveAccountSession(null);
          state.alias = state.profiles[0]?.name || "MARLOWE";
          renderAccountPanel();
          applyProfileToHomeUI();
        }
      });
    }
    emitServer("restore-session", {}, () => {});
  });
  socket.on("connect_error", () => setConnectionStatus("offline", true));
  socket.on("update-state", applyServerState);
  socket.on("system-message", ({ text }) => { say(text); renderChat(); });
  socket.on("chat-message", ({ nickname, text }) => {
    const sender = state.players.find((player) => player.name === String(nickname).toUpperCase());
    say(text, sender || { name: nickname, textColor: "#a79d7d" });
    renderChat();
  });
  socket.on("purchase-offer", (offer) => {
    const serverTile = serverTileFor(offer?.tileIndex);
    const tile = { ...(TILES[Number(offer?.tileIndex) % TILE_COUNT] || TILES[0]), i: Number(offer?.tileIndex) };
    state.pendingBuyTile = tile.i;
    openChoiceModal({ ...tile, name: serverTile?.name || offer?.name || tile.name, price: serverTile?.price ?? offer?.price ?? tile.price });
  });
  socket.on("card-reveal", (reveal) => {
    const tile = TILES[Number(reveal?.tileIndex) % TILE_COUNT];
    if (tile && (tile.kind === "chance" || tile.kind === "chest")) {
      openCardReveal(tile, { text: reveal.text || "Card resolved.", cash: Number(reveal.cash) || 0 });
    }
  });
  socket.on("trade-offer", ({ trade }) => {
    if (!trade) return;
    const normalized = {
      ...trade,
      from: trade.from || trade.fromPlayerId,
      to: trade.to || trade.toPlayerId,
      giveDeeds: trade.giveDeeds || trade.givePropertyIndexes || [],
      wantDeeds: trade.wantDeeds || trade.requestPropertyIndexes || [],
      giveCash: Number(trade.giveCash) || 0,
      wantCash: Number(trade.wantCash ?? trade.requestCash) || 0,
    };
    state.offers.push(normalized);
    renderAll();
    openOfferModal(normalized);
  });
  socket.on("disconnect", () => setConnectionStatus("reconnecting", true));
}

function say(text, who) {
  const message = who
    ? { who: who.name, color: who.textColor, text }
    : { who: "", color: "", text, system: true };
  const previous = state.messages[state.messages.length - 1];
  if (message.system && previous?.system && previous.text === message.text) return;
  state.messages.push(message);
  if (state.messages.length > 80) state.messages.splice(0, state.messages.length - 80);
  if (message.system) {
    const announcer = $("#system-announcer");
    if (announcer) announcer.textContent = String(text);
    if (/(?:error|could not|cannot|can't|unable|failed|insufficient|not found|not your turn|must |need \$)/i.test(String(text))) {
      const errorAnnouncer = $("#error-announcer");
      if (errorAnnouncer) errorAnnouncer.textContent = String(text);
    }
  }
}

const CONNECTION_COPY = {
  connecting: "CONNECTING…",
  online: "ONLINE",
  reconnecting: "RECONNECTING…",
  offline: "OFFLINE",
};

function renderConnectionStatus() {
  const status = state.connectionStatus || "offline";
  const copy = CONNECTION_COPY[status] || CONNECTION_COPY.offline;
  const homeLabel = $("#home-connection-label");
  if (homeLabel) homeLabel.textContent = copy;
  const gameLabel = $("#tn-online");
  if (gameLabel && state.live) gameLabel.textContent = status === "online"
    ? `${state.players.filter((p) => p.online).length} ONLINE`
    : copy;
  document.querySelectorAll("#view-home .online .dot, #home-status-note .dot").forEach((dot) => {
    dot.classList.toggle("dot-green", status === "online");
    dot.classList.toggle("dot-red", status !== "online");
    dot.classList.toggle("blink", status === "online");
  });
  const note = $("#tn-connection-note");
  if (note) {
    note.dataset.connection = status;
    const text = note.querySelector(".t-micro");
    if (text) text.textContent = copy;
    const dot = note.querySelector(".dot");
    if (dot) {
      dot.classList.toggle("dot-green", status === "online");
      dot.classList.toggle("dot-red", status !== "online");
      dot.classList.toggle("blink", status === "online");
    }
  }
  const homeNote = $("#home-status-note");
  if (homeNote) {
    homeNote.dataset.connection = status;
    const text = homeNote.querySelector(".t-micro");
    if (text) text.textContent = status === "online"
      ? "LIVE SERVER · CREATE OR JOIN A ROOM · NO ACCOUNT REQUIRED"
      : `${copy} · ROOM ACTIONS WILL RETRY AUTOMATICALLY`;
  }
}

function setConnectionStatus(status, announce = false) {
  if (state.connectionStatus === status) {
    renderConnectionStatus();
    return;
  }
  state.connectionStatus = status;
  renderConnectionStatus();
  if (announce) {
    const copy = CONNECTION_COPY[status] || CONNECTION_COPY.offline;
    const message = status === "online" ? "Live table connection restored." : `Table connection ${copy.toLowerCase()}.`;
    if (state.lastConnectionAnnouncement !== message) {
      state.lastConnectionAnnouncement = message;
      say(message);
      renderChat();
    }
  }
}

/* ============================================================
   OPTIONAL ACCOUNT / PROFILE IDENTITY
   Guest play stays local; an account only adds durable identity and stats.
   ============================================================ */
let accountModalMode = "register";

function accountRate(stats = {}) {
  const games = Number(stats.gamesPlayed) || 0;
  return games ? `${Math.round(((Number(stats.wins) || 0) / games) * 100)}%` : "0%";
}

function renderAccountPanel() {
  const signedIn = Boolean(state.account?.account);
  const guest = $("#account-guest-state");
  const signed = $("#account-signed-state");
  guest?.classList.toggle("is-hidden", signedIn);
  signed?.classList.toggle("is-hidden", !signedIn);
  const title = $("#account-panel-title");
  const badge = $("#account-panel-badge");
  if (title) title.textContent = signedIn ? `@${state.account.account.username}` : "Guest mode";
  if (badge) badge.textContent = signedIn ? "ACCOUNT ACTIVE" : "LOCAL ONLY";
  if (!signedIn) return;
  const account = state.account.account;
  const avatar = $("#account-avatar");
  if (avatar) avatar.innerHTML = account.avatarGrid ? spriteFromGrid(account.avatarGrid, 4) : avatarHTML(account, 4, 0);
  $("#account-display-name")?.replaceChildren(document.createTextNode(account.displayName));
  $("#account-username")?.replaceChildren(document.createTextNode(`@${account.username}`));
  $("#account-games")?.replaceChildren(document.createTextNode(String(account.stats?.gamesPlayed || 0)));
  $("#account-wins")?.replaceChildren(document.createTextNode(String(account.stats?.wins || 0)));
  $("#account-rate")?.replaceChildren(document.createTextNode(accountRate(account.stats)));
}

function updateAccountFromResponse(response) {
  if (!response?.account) return;
  const token = response.sessionToken || state.account?.sessionToken;
  if (!token) return;
  saveAccountSession({ sessionToken: token, account: response.account });
  state.alias = response.account.displayName;
  renderAccountPanel();
  applyProfileToHomeUI();
}

function accountModalHTML(mode) {
  const register = mode === "register";
  return `
    <div class="account-modal-body">
      <div class="account-modal-head">
        <div>
          <div class="t-micro g400">POORUP IDENTITY</div>
          <h2 class="t-section g100" id="account-modal-title">${register ? "Create account" : "Sign in"}</h2>
        </div>
        <button class="btn-dark" id="account-modal-close" type="button"><span class="t-label f11">CLOSE</span></button>
      </div>
      <p class="t-body ink-2" id="account-modal-description">${register ? "Keep guest play free, or save your player identity and stats across rooms." : "Sign in to load your saved display name, face, color, and game record."}</p>
      <div class="account-modal-tabs" role="tablist" aria-label="Account actions">
        <button class="rm-tab${register ? " is-active" : ""}" id="account-tab-register" type="button" role="tab" aria-selected="${register}"><span class="t-label f12">CREATE ACCOUNT</span></button>
        <button class="rm-tab${register ? "" : " is-active"}" id="account-tab-login" type="button" role="tab" aria-selected="${!register}"><span class="t-label f12">SIGN IN</span></button>
      </div>
      <form class="account-form" id="account-form">
        <label class="account-field"><span class="t-label f12 g-muted">Username</span><input class="field" id="account-username-input" name="username" maxlength="16" minlength="3" pattern="[A-Za-z0-9_]{3,16}" autocomplete="username" required placeholder="night_player" /></label>
        ${register ? `<label class="account-field"><span class="t-label f12 g-muted">Display Name</span><input class="field" id="account-display-input" name="displayName" maxlength="18" autocomplete="nickname" required placeholder="Marlowe" /></label>` : ""}
        <label class="account-field"><span class="t-label f12 g-muted">Password</span><input class="field" id="account-password-input" name="password" type="password" minlength="8" maxlength="72" autocomplete="${register ? "new-password" : "current-password"}" required placeholder="8 characters minimum" /></label>
        <p class="account-form-error" id="account-form-error" role="alert" aria-live="assertive"></p>
        <button class="cta-red account-submit" type="submit"><span class="cta-text cta-text-sm">${register ? "Create Account" : "Sign In"}</span></button>
      </form>
      <p class="t-micro ink-3 account-modal-foot">Guest play remains available without an account. Passwords are never shown in the game UI.</p>
    </div>`;
}

function openAccountModal(mode = "register") {
  accountModalMode = mode;
  const card = $("#account-card");
  if (!card) return;
  card.innerHTML = accountModalHTML(mode);
  openSurface("#account-modal", "#account-username-input");
  $("#account-modal-close")?.addEventListener("click", closeAccountModal);
  $("#account-tab-register")?.addEventListener("click", () => openAccountModal("register"));
  $("#account-tab-login")?.addEventListener("click", () => openAccountModal("login"));
  $("#account-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    const error = $("#account-form-error");
    if (error) error.textContent = "";
    const eventName = accountModalMode === "register" ? "account-register" : "account-login";
    const submit = form.querySelector("button[type=submit]");
    if (submit) submit.disabled = true;
    emitServer(eventName, payload, (response) => {
      if (!response?.success) {
        if (error) error.textContent = response?.error || "Account action failed.";
        const announcer = $("#error-announcer");
        if (announcer) announcer.textContent = response?.error || "Account action failed.";
        if (submit) submit.disabled = false;
        return;
      }
      updateAccountFromResponse(response);
      closeAccountModal();
      say(accountModalMode === "register" ? "Account created. Your identity is saved." : "Signed in. Your identity is ready.");
    });
  });
  focusSurface("#account-modal", "#account-username-input");
}

function closeAccountModal() {
  closeSurface("#account-modal");
}

function logoutAccount() {
  const token = state.account?.sessionToken;
  if (token) emitServer("account-logout", { sessionToken: token }, () => {});
  saveAccountSession(null);
  const fallback = state.profiles[0] || null;
  state.appearance = fallback?.id || 0;
  state.alias = fallback?.name || loadGuestAlias();
  saveGuestAlias(state.alias);
  state.players = buildPlayers(state.appearance, state.alias);
  renderAccountPanel();
  applyProfileToHomeUI();
  renderProfileEditor();
  say("Signed out. Guest mode is active.");
}

function record(text) {
  state.log.unshift(text);
  if (state.log.length > 40) state.log.length = 40;
}
const addCash = (id, delta) => {
  const p = state.players.find((x) => x.id === id);
  if (p) p.cash = Math.max(0, p.cash + delta);
};

/* ============================================================
   5. HOME SCREEN
   ============================================================ */
const SKYLINE = [
  [2, 24, 6, 12], [9, 17, 5, 19], [15, 27, 4, 9], [20, 12, 6, 24], [27, 21, 5, 15],
  [33, 6, 7, 30], [41, 15, 5, 21], [47, 2, 8, 34], [56, 18, 5, 18], [62, 10, 6, 26],
  [69, 22, 5, 14], [75, 15, 6, 21], [82, 25, 5, 11],
];
const BOARD_SKYLINE = [
  [4, 22, 6, 12], [11, 16, 5, 18], [17, 25, 4, 9], [22, 12, 6, 22], [29, 20, 5, 14],
  [35, 6, 7, 28], [43, 14, 5, 20], [49, 2, 8, 32], [58, 17, 5, 17], [64, 10, 6, 24],
  [71, 21, 5, 13], [77, 15, 6, 19],
];

function paintSkyline(el, data) {
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

let roomsDirectory = [];
let roomsLoading = false;
let roomsFilter = "all";
let drawerFilter = "all";
let roomModalTab = "browse"; // "browse" | "create"
let createRoomSettings = {
  name: "",
  visibility: "public", // "public" | "private"
  code: "",
};

function roomStateColor(stateName) {
  if (stateName === "live") return "#35a653";
  if (stateName === "full") return "#d9a62f";
  return "#3a382a";
}

function filteredRooms() {
  if (roomsFilter === "open") return roomsDirectory.filter((r) => r.seats < r.cap);
  if (roomsFilter === "live") return roomsDirectory.filter((r) => r.state === "live");
  return roomsDirectory;
}

function roomRowHTML(r) {
  const full = r.seats >= r.cap;
  const open = r.cap - r.seats;
  const visLabel = r.visibility === "private" ? "PRIVATE" : "PUBLIC";
  return `<div class="room-row">
    <div class="room-main">
      <div class="room-top">
        <span class="t-label f12 room-code">${r.code}</span>
        <span class="t-label f13 room-name">${r.name}</span>
        <span class="t-micro g400" style="margin-left:4px">${visLabel}</span>
        <span class="room-meta-item"><span class="st-dot" style="background:${roomStateColor(r.state)}"></span><span class="t-micro ink-3">${r.state}</span></span>
      </div>
      <div class="room-meta">
        <span class="t-micro ink-3 room-meta-item">SEATS ${r.seats}/${r.cap}</span>
        <span class="t-micro ink-3 room-meta-item">OPEN ${open}</span>
        <span class="t-micro ink-3 room-meta-item">BANK ${r.bank}</span>
        <span class="t-micro g-muted room-meta-item">${r.note}</span>
      </div>
    </div>
    <div class="room-actions">
      <button class="btn-dark" data-join="${r.code}" ${full ? "disabled" : ""}>
        <span class="t-label f11">${full ? "FULL" : "JOIN"}</span>
      </button>
      <button class="btn-dark" data-copy="${r.code}" title="Copy code">
        <span class="t-label f11">COPY</span>
      </button>
    </div>
  </div>`;
}

function renderRoomsList() {
  const list = $("#rooms-list");
  if (!list) return;
  const rooms = filteredRooms();
  list.innerHTML = roomsLoading
    ? `<div class="rooms-empty t-body">CHECKING PUBLIC TABLES…</div>`
    : rooms.length
    ? rooms.map(roomRowHTML).join("")
    : `<div class="rooms-empty t-body">NO PUBLIC ROOMS RIGHT NOW. ENTER A CODE OR HOST A TABLE.</div>`;

  document.querySelectorAll(".rooms-filter").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.filter === roomsFilter);
  });

}

function updateCreateRoomUI() {
  const isPrivate = createRoomSettings.visibility === "private";
  const codeField = $("#rc-private-code-field");
  const codeInput = $("#rc-room-code");
  const codeStatus = $("#rc-code-status");
  const createButton = $("#rc-create-btn");
  if (codeField) codeField.classList.toggle("is-hidden", !isPrivate);
  if (codeInput && codeInput.value !== createRoomSettings.code) codeInput.value = createRoomSettings.code;
  const codeValid = /^[A-Z0-9]{6}$/.test(createRoomSettings.code);
  if (codeStatus) {
    codeStatus.textContent = !isPrivate ? "NOT NEEDED FOR PUBLIC TABLES" : codeValid ? "READY" : `${createRoomSettings.code.length}/6 CHARACTERS`;
    codeStatus.classList.toggle("is-valid", isPrivate && codeValid);
    codeStatus.classList.toggle("is-invalid", isPrivate && !codeValid);
  }
  if (codeInput) codeInput.setAttribute("aria-invalid", String(isPrivate && !codeValid));
  if (createButton) createButton.disabled = isPrivate && !codeValid;

  document.querySelectorAll("#rc-vis-selector .rc-vis-opt").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.vis === createRoomSettings.visibility);
  });
}

function switchRoomModalTab(tab) {
  roomModalTab = tab;
  const isBrowse = tab === "browse";
  const isCreate = tab === "create";

  const btnBrowse = $("#rm-tab-browse");
  const btnCreate = $("#rm-tab-create");
  if (btnBrowse) {
    btnBrowse.classList.toggle("is-active", isBrowse);
    btnBrowse.setAttribute("aria-selected", String(isBrowse));
  }
  if (btnCreate) {
    btnCreate.classList.toggle("is-active", isCreate);
    btnCreate.setAttribute("aria-selected", String(isCreate));
  }

  const panelBrowse = $("#rm-panel-browse");
  const panelCreate = $("#rm-panel-create");
  if (panelBrowse) panelBrowse.classList.toggle("is-hidden", !isBrowse);
  if (panelCreate) panelCreate.classList.toggle("is-hidden", !isCreate);

  const titleText = $("#rooms-title-text");
  if (titleText) titleText.textContent = isBrowse ? "Available Rooms" : "Create Custom Room";

  if (isBrowse) {
    renderRoomsList();
  } else if (isCreate) {
    updateCreateRoomUI();
  }
}

function requestRoomsDirectory() {
  if (!state.live) return;
  roomsLoading = true;
  renderRoomsList();
  emitServer("list-rooms", {}, (response) => {
    roomsLoading = false;
    if (response?.success === false) {
      roomsDirectory = [];
      say(response.error || "Public tables could not be loaded.");
      renderChat();
    } else {
      roomsDirectory = Array.isArray(response?.rooms) ? response.rooms : [];
    }
    renderRoomsList();
  });
}

function openRoomsModal(tab = "browse") {
  roomsFilter = "all";
  switchRoomModalTab(tab);
  openSurface("#rooms-modal", "#rooms-close");
  if (tab === "browse") requestRoomsDirectory();
}

function closeRoomsModal() {
  closeSurface("#rooms-modal");
}

function renderHome() {
  paintSkyline($("#home-skyline"), SKYLINE);

  // mini board
  const grid = $("#mini-grid");
  if (grid && !grid.dataset.built) {
    const groups = ["#7b5029", "#3e7d7b", "#a04e6f", "#87231e", "#4b853d", "#286ea1"];
    let cells = "";
    for (let i = 0; i < 64; i++) {
      const x = i % 8;
      const y = Math.floor(i / 8);
      const edge = x === 0 || y === 0 || x === 7 || y === 7;
      if (!edge) { cells += "<span></span>"; continue; }
      const corner = (x === 0 || x === 7) && (y === 0 || y === 7);
      cells += `<span class="mini-cell${corner ? " is-corner" : ""}">${
        corner ? spriteHTML("diamond", 2) : `<span class="strip" style="background:${groups[(x + y) % groups.length]}"></span>`
      }</span>`;
    }
    grid.insertAdjacentHTML("afterbegin", cells);
    grid.dataset.built = "1";
  }

  renderRoomsList();
  renderAccountPanel();
  applyProfileToHomeUI();
  renderConnectionStatus();
  hydrateSprites();
}

function renderProfileLibrary() {
  const list = $("#pl-list");
  const newBtn = $("#pl-new-btn");
  const atCap = state.profiles.length >= MAX_PROFILES;
  if (newBtn) {
    newBtn.disabled = atCap;
    newBtn.querySelector(".t-label").textContent = atCap ? `MAX ${MAX_PROFILES} DESIGNS` : "+ NEW DESIGN";
  }
  if (!list) return;
  if (!state.profiles.length) {
    list.innerHTML = `<p class="pl-empty">No custom designs yet — press <strong style="color:var(--gold-300)">+ NEW DESIGN</strong> to draw your first player.</p>`;
    return;
  }
  const activeId = typeof state.appearance === "string" ? state.appearance : null;
  list.innerHTML = state.profiles.map((p, i) => `
    <div class="pl-tile${p.id === activeId ? " is-active" : ""}">
      <button class="pl-tile-select" type="button" data-profile-select="${p.id}" aria-pressed="${p.id === activeId}">
        <span class="pl-tile-av">${avatarHTML(p, 3, i)}</span>
        <span class="pl-tile-info">
          <span class="t-label pl-tile-name" style="color:${p.color}">${esc(p.name)}</span>
          <span class="t-micro ink-3">${p.id === activeId ? "SELECTED" : "TAP TO SELECT"}</span>
        </span>
      </button>
      <div class="pl-tile-actions">
        <button class="btn-dark" type="button" data-profile-edit="${p.id}"><span class="t-label">EDIT</span></button>
      </div>
    </div>
  `).join("");
}

/** Reflect the saved profile (or the default guest identity) across the home screen. */
function applyProfileToHomeUI() {
  const p = typeof state.appearance === "string" ? getProfileById(state.appearance) : state.profiles[0] || null;
  const account = state.account?.account || null;
  const name = account?.displayName || state.alias || p?.name || "guest_4412";
  const color = account?.color || p?.color || "#d74438";
  const avatarSource = account?.avatarGrid ? account : p;

  const homeName = $("#home-you-name");
  if (homeName) homeName.textContent = name;
  const homeAv = $("#home-you-avatar");
  if (homeAv) homeAv.innerHTML = avatarSource?.avatarGrid ? spriteFromGrid(avatarSource.avatarGrid, 3) : avatarHTML({ color }, 3, 0);

  const chairName = $("#chair-name");
  if (chairName) chairName.textContent = `that's you, ${name}`;
  const chairAv = $("#chair-avatar");
  if (chairAv) chairAv.innerHTML = avatarSource?.avatarGrid ? spriteFromGrid(avatarSource.avatarGrid, 4) : avatarHTML({ color }, 4, 0);

  const resumeBtn = $("#resume-btn");
  if (resumeBtn) resumeBtn.classList.toggle("is-hidden", !loadSavedGame());
  renderGuestAliasField();
}

function renderGuestAliasField(errorText = "") {
  const field = $("#home-alias-form");
  const input = $("#home-alias");
  const error = $("#home-alias-error");
  const signedIn = Boolean(state.account?.account);
  field?.classList.toggle("is-hidden", signedIn);
  if (input && !signedIn && input.value !== state.alias) input.value = state.alias;
  if (error) error.textContent = errorText;
}

function requireGuestAlias() {
  if (state.account?.account) return true;
  const alias = String(state.alias || "").trim();
  if (alias) return true;
  renderGuestAliasField("CREATE AN ALIAS BEFORE JOINING A TABLE.");
  $("#home-alias")?.focus({ preventScroll: true });
  return false;
}

/* ============================================================
   6. GAME RENDERERS
   ============================================================ */
function renderTopNav() {
  $("#tn-room").textContent = state.roomCode || "----";
  $("#tn-lobby").textContent = `AFTER HOURS ${state.roomCode || "----"}`;
  $("#tn-online").textContent = state.live
    ? (state.connectionStatus === "online" ? `${state.players.filter((p) => p.online).length} ONLINE` : (CONNECTION_COPY[state.connectionStatus] || "OFFLINE"))
    : state.phase === "playing" ? `${state.players.length} SEATED` : "OFFLINE";
  $("#tn-turnlabel").textContent = state.phase === "playing" ? state.players[state.turnIndex].name : state.phase === "lobby" ? "LOBBY" : "SETUP";
  renderConnectionStatus();
}

function renderPlayers() {
  $("#player-list").innerHTML = state.players
    .map((p, i) => {
      const active = i === state.turnIndex && state.phase === "playing";
      return `<div class="player-row${active ? " is-active" : ""}">
        ${active ? `<span class="pr-arrow">${spriteHTML("arrow", 3)}</span>` : ""}
        <div class="pr-av">${avatarHTML(p, 4, i)}</div>
        <div class="pr-mid">
          <div class="pr-nameline">
            ${active ? spriteHTML("crown", 2) : ""}
            <span class="t-label pr-name" style="color:${p.textColor}">${esc(p.name)}</span>
          </div>
          <div class="t-label pr-cash">$${p.cash.toLocaleString()}</div>
        </div>
        <div class="pr-right">
          <span class="pr-dot" style="background:${p.online ? "#35a653" : "#3a382a"};box-shadow:${p.online ? "0 0 5px rgb(53 166 83 / 60%)" : "none"}"></span>
          <span class="t-micro ink-3">${p.online ? (p.id === "p1" ? "YOU" : p.bot ? "CPU" : "ONLINE") : "AFK"}</span>
        </div>
      </div>`;
    })
    .join("");
}

function renderChat() {
  const body = $("#chat-body");
  body.innerHTML = state.messages
    .slice(-60)
    .map((m) =>
      m.system
        ? `<p class="t-body chat-line"><span class="ink-3">» </span><span class="g-muted">${esc(m.text)}</span></p>`
        : `<p class="t-body chat-line"><span style="color:${m.color}">${esc(m.who)}:</span> <span class="ink-2">${esc(m.text)}</span></p>`,
    )
    .join("");
  body.scrollTop = body.scrollHeight;

  const joined = state.live ? state.phase !== "home" && state.players.length > 0 : state.phase === "playing";
  $("#chat-input").disabled = !joined;
  $("#chat-send").disabled = !joined;
  $("#chat-input").placeholder = joined ? "Say something…" : "Join the room to chat…";
}

function tileIconHTML(tile) {
  switch (tile.kind) {
    case "corner-parking": return spriteHTML("car", 4);
    case "corner-vacation": return spriteHTML("palm", 4);
    case "chest": return spriteHTML("chest", 3);
    case "railroad": return spriteHTML("train", 3);
    case "utility": return tile.name === "ELECTRIC COMPANY" ? spriteHTML("bulb", 3) : spriteHTML("faucet", 3);
    case "chance": return `<span class="q-mark" style="font-size:18px">?</span>`;
    case "tax": return `<span class="q-mark g400" style="font-size:13px;color:#c88f2e">$</span>`;
    default: return "";
  }
}

function stripStyle(tile) {
  if (!tile.group) return "";
  const c = GROUP_COLOR[tile.group];
  switch (tile.side) {
    case "bottom": return `background:${c};top:0;left:0;right:0;height:22%;border-bottom:1px solid #01070a`;
    case "top": return `background:${c};bottom:0;left:0;right:0;height:22%;border-top:1px solid #01070a`;
    case "left": return `background:${c};top:0;bottom:0;right:0;width:20%;border-left:1px solid #01070a`;
    case "right": return `background:${c};top:0;bottom:0;left:0;width:20%;border-right:1px solid #01070a`;
  }
  return "";
}

function buildBoard() {
  const grid = $("#board-grid");
  const center = $("#center-field");
  grid.querySelectorAll(".tile").forEach((n) => n.remove());
  paintSkyline($("#board-skyline"), BOARD_SKYLINE);

  TILES.forEach((tile) => {
    const el = document.createElement("button");
    el.className = `tile side-${tile.side}`;
    el.dataset.tile = String(tile.i);
    el.style.gridColumn = String(tile.col);
    el.style.gridRow = String(tile.row);

    const words = tile.name.split(" ").map((w) => `<span style="display:block">${w}</span>`).join("");

    if (tile.kind.startsWith("corner")) {
      el.classList.add("is-corner");
      if (tile.kind === "corner-go") {
        el.innerHTML = `<span class="go-big">GO</span>
          <span class="t-tile" style="font-size:9px;color:#a79d7d">COLLECT</span>
          <span class="t-tile" style="font-size:10px;color:#cfa75f">$200</span>`;
      } else if (tile.kind === "corner-jail") {
        el.innerHTML = `<svg class="jail-bars" viewBox="0 0 16 10" shape-rendering="crispEdges" aria-hidden="true">
            ${[1, 4, 7, 10, 13].map((x) => `<rect x="${x}" y="0" width="1.4" height="10" fill="#cfa75f"/>`).join("")}
            <rect x="0" y="4" width="16" height="1.2" fill="#cfa75f"/></svg>
          <span class="t-tile tile-name" style="font-size:9px">${words}</span>`;
      } else if (tile.kind === "corner-go-jail") {
        el.innerHTML = `<svg class="jail-bars" viewBox="0 0 16 10" shape-rendering="crispEdges" aria-hidden="true">
            ${[1, 4, 7, 10, 13].map((x) => `<rect x="${x}" y="0" width="1.4" height="10" fill="#d74438"/>`).join("")}
            <rect x="0" y="4" width="16" height="1.2" fill="#d74438"/></svg>
          <span class="t-tile tile-name" style="font-size:9px;color:#d74438">${words}</span>`;
      } else {
        el.innerHTML = `<span class="t-tile tile-name" style="font-size:9px">${words}</span>${tileIconHTML(tile)}`;
      }
    } else {
      el.style.paddingTop = tile.side === "bottom" ? "24%" : "4px";
      el.style.paddingBottom = tile.side === "top" ? "24%" : "4px";
      el.style.paddingLeft = tile.side === "right" ? "22%" : "3px";
      el.style.paddingRight = tile.side === "left" ? "22%" : "3px";
      el.innerHTML =
        (tile.group ? `<span class="tile-strip" style="${stripStyle(tile)}"></span>` : "") +
        `<span class="tile-owner" style="display:none"></span>` +
        `<span class="t-tile tile-name">${words}</span>` +
        `<span class="tile-icon">${tileIconHTML(tile)}</span>` +
        (tile.price != null
          ? `<span class="t-tile tile-price">${tile.kind === "tax" ? `PAY $${tile.price}` : `$${tile.price}`}</span>`
          : "");
    }

    el.insertAdjacentHTML("beforeend", `<span class="tile-build side-${tile.side}"></span>`);
    el.addEventListener("click", () => onTileClick(tile));
    grid.insertBefore(el, center);
  });
}

function renderBoardState() {
  TILES.forEach((tile) => {
    const el = document.querySelector(`.tile[data-tile="${tile.i}"]`);
    if (!el) return;
    el.classList.toggle("is-highlight", state.highlight === tile.i);
    el.classList.toggle("is-mortgaged", !!state.mortgaged[tile.i]);

    const ownerId = state.owners[tile.i];
    const pip = el.querySelector(".tile-owner");
    if (pip) {
      const owner = state.players.find((p) => p.id === ownerId);
      pip.style.display = owner ? "block" : "none";
      if (owner) pip.style.background = owner.color;
    }

    const buildEl = el.querySelector(".tile-build");
    if (buildEl) {
      const lvl = state.houses[tile.i] || 0;
      if (tile.kind === "property" && lvl > 0) {
        buildEl.innerHTML = lvl === HOTEL_LEVEL
          ? spriteHTML("hotel", 1, "#cfa75f")
          : Array.from({ length: Math.min(lvl, MAX_HOUSES) }).map(() => spriteHTML("house", 1, "#4b853d")).join("");
      } else {
        buildEl.innerHTML = "";
      }
    }
  });
}

const STACK_OFF = [
  { x: 0, y: 0 },
  { x: 11, y: -8 },
  { x: -11, y: 8 },
  { x: 11, y: 8 },
];

function tileCenter(i) {
  const tile = document.querySelector(`.tile[data-tile="${i}"]`);
  const layer = $("#token-layer");
  if (!tile || !layer) return null;
  const tr = tile.getBoundingClientRect();
  const lr = layer.getBoundingClientRect();
  if (!tr.width || !lr.width) return null;
  return {
    x: tr.left - lr.left + tr.width / 2,
    y: tr.top - lr.top + tr.height / 2,
  };
}

function ensurePieces() {
  const layer = $("#token-layer");
  if (!layer) return;
  state.players.forEach((p, i) => {
    let el = layer.querySelector(`.piece[data-player="${p.id}"]`);
    if (!el) {
      el = document.createElement("div");
      el.className = "piece";
      el.dataset.player = p.id;
      layer.appendChild(el);
    }
    el.style.borderColor = p.color;
    el.title = p.name;
    const sig = `${p.id}:${p.color}:${i}:${p.avatarGrid ? JSON.stringify(p.avatarGrid) : ""}`;
    if (el.dataset.sig !== sig) {
      el.innerHTML = avatarHTML(p, 3, i);
      el.dataset.sig = sig;
    }
  });
  layer.querySelectorAll(".piece").forEach((el) => {
    if (!state.players.some((p) => p.id === el.dataset.player)) el.remove();
  });
}

function placePieces(opts = {}) {
  const movingId = opts.movingId || null;
  const hop = !!opts.hop;
  ensurePieces();
  const layer = $("#token-layer");
  if (!layer) return;

  const occupants = {};
  state.players.forEach((p) => {
    (occupants[p.pos] ||= []).push(p.id);
  });

  state.players.forEach((p) => {
    const el = layer.querySelector(`.piece[data-player="${p.id}"]`);
    if (!el) return;
    const c = tileCenter(p.pos);
    if (!c) return;
    const stack = occupants[p.pos] || [p.id];
    const idx = Math.max(0, stack.indexOf(p.id));
    const off = stack.length === 1 ? { x: 0, y: 0 } : STACK_OFF[idx] || { x: 0, y: 0 };
    const active = state.phase === "playing" && state.players[state.turnIndex]?.id === p.id;
    el.classList.toggle("is-active", active);
    el.classList.toggle("is-moving", movingId === p.id);
    if (hop && movingId === p.id) {
      el.classList.remove("is-hopping");
      void el.offsetWidth;
      el.classList.add("is-hopping");
    }
    el.style.setProperty("--piece-x", `${Math.round(c.x + off.x)}px`);
    el.style.setProperty("--piece-y", `${Math.round(c.y + off.y)}px`);
  });
}

const DIE_PIPS = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function dieHTML(value, rolling) {
  const pips = DIE_PIPS[value] || DIE_PIPS[1];
  let cells = "";
  for (let i = 0; i < 9; i++) {
    const cx = i % 3;
    const cy = Math.floor(i / 3);
    cells += `<span class="${pips.some(([x, y]) => x === cx && y === cy) ? "on" : ""}"></span>`;
  }
  return `<div class="die${rolling ? " dice-rolling" : ""}">${cells}</div>`;
}

/** update only the pip faces of existing dice so the shake animation is not restarted */
function updateDieFaces() {
  const dice = document.querySelectorAll("#hud-dice .die");
  if (dice.length !== 2) return false;
  dice.forEach((die, di) => {
    const pips = DIE_PIPS[state.dice[di]] || DIE_PIPS[1];
    die.querySelectorAll("span").forEach((cell, i) => {
      const cx = i % 3;
      const cy = Math.floor(i / 3);
      cell.classList.toggle("on", pips.some(([x, y]) => x === cx && y === cy));
    });
  });
  return true;
}

function renderHud() {
  const waiting = state.phase !== "playing";
  const isLobby = state.phase === "lobby";
  const cur = state.players[state.turnIndex];

  if (isLobby) {
    $("#hud-turn-label").textContent = "In Lobby";
    const nameEl = $("#hud-name");
    nameEl.textContent = "Configure";
    nameEl.style.color = "#cfa75f";
    $("#hud-note").style.display = "block";
    $("#hud-note").textContent = "Set rules on the right, then press Start Round.";
    $("#hud-cash").textContent = `$${Number(state.settings.startingCash).toLocaleString()}`;
    $("#hud-pool").textContent = "$0";
    $("#hud-dice").innerHTML = `<div class="die-blank">—</div><div class="die-blank">—</div>`;
    $("#roll-btn").disabled = true;
    $("#roll-label").textContent = "Set Rules First";
    return;
  }

  const awaitingEnd = state.turnStage === "end";
  $("#hud-turn-label").textContent = waiting ? "Waiting For Game" : awaitingEnd ? "Resolve & End" : "Current Turn";
  const nameEl = $("#hud-name");
  nameEl.textContent = waiting ? "Stand By" : cur.name;
  nameEl.style.color = waiting ? "#cfa75f" : cur.textColor;
  $("#hud-note").style.display = waiting || (awaitingEnd && state.turnIndex === 0) ? "block" : "none";
  $("#hud-note").textContent = awaitingEnd
    ? "Buy, build or trade now, then end your turn."
    : "Join a room to get started.";

  $("#hud-cash").textContent = `$${waiting ? "0" : cur.cash.toLocaleString()}`;
  $("#hud-pool").textContent = `$${waiting ? 0 : state.pool}`;

  $("#hud-dice").innerHTML = waiting
    ? `<div class="die-blank">—</div><div class="die-blank">—</div>`
    : dieHTML(state.dice[0], state.rolling) + dieHTML(state.dice[1], state.rolling);

  const locked = (state.pendingBuyTile != null && state.settings.auction) || !!state.auction;
  const humanTurn = state.turnIndex === 0 && state.phase === "playing";
  const canRoll = !state.busy && !locked && humanTurn && state.turnStage === "roll";
  const canEnd = !state.busy && !locked && humanTurn && state.turnStage === "end";
  const btn = $("#roll-btn");
  btn.disabled = !(canRoll || canEnd);
  $("#roll-label").textContent = waiting
    ? "Join First"
    : state.rolling
      ? "Rolling…"
      : canEnd
        ? "End Turn"
        : canRoll
          ? "Roll Dice"
          : "Waiting…";

  // turn-stage pill + countdown
  const stageEl = $("#hud-stage");
  const timerEl = $("#hud-timer");
  const inJail = (state.jail[cur?.id] || 0) > 0;
  let stageLabel = "ROLL";
  let stageCls = "";
  if (state.rolling) { stageLabel = "ROLLING"; stageCls = "st-resolve"; }
  else if (state.turnStage === "end") { stageLabel = "END TURN"; stageCls = "st-end"; }
  else if (inJail && humanTurn) { stageLabel = "IN JAIL"; stageCls = "st-resolve"; }
  if (stageEl) {
    const hidden = waiting || isLobby;
    stageEl.classList.toggle("is-hidden", hidden);
    stageEl.textContent = stageLabel;
    stageEl.classList.remove("st-end", "st-resolve");
    if (stageCls) stageEl.classList.add(stageCls);
  }
  if (timerEl) {
    const useTimer = !waiting && !isLobby && humanTurn && state.settings.turnTimer > 0 && state.turnStage === "roll";
    timerEl.classList.toggle("is-hidden", !useTimer);
    if (useTimer) updateTurnTimerState();
  }
  const jailBtn = $("#pay-jail-fine");
  if (jailBtn) {
    const canPayJail = !waiting && !isLobby && humanTurn && inJail && state.turnStage === "roll" && cur.cash >= 50;
    jailBtn.classList.toggle("is-hidden", !canPayJail);
    jailBtn.disabled = state.busy;
  }
}

// ---- per-turn countdown -------------------------------------------
let turnDeadline = 0;
let turnTimerInterval = null;
let turnTimerLeft = 0;

function startTurnCountdown() {
  clearInterval(turnTimerInterval);
  turnTimerInterval = null;
  if (state.settings.turnTimer <= 0 || state.turnIndex !== 0) return;
  turnDeadline = Date.now() + state.settings.turnTimer * 1000;
  turnTimerInterval = setInterval(() => {
    turnTimerLeft = Math.max(0, turnDeadline - Date.now());
    updateTurnTimerState();
    if (turnTimerLeft <= 0) {
      clearInterval(turnTimerInterval);
      turnTimerInterval = null;
      // auto-end the human's turn when time runs out
      if (state.phase === "playing" && state.turnIndex === 0 && state.turnStage === "end") {
        if (state.pendingBuyTile == null && !state.auction) endTurn(0);
      }
    }
  }, 120);
}

function updateTurnTimerState() {
  const timerEl = $("#hud-timer");
  if (!timerEl) return;
  const left = Math.max(0, (turnDeadline - Date.now()) / 1000);
  const shown = state.settings.turnTimer > 0 && state.turnIndex === 0 && state.turnStage === "roll";
  timerEl.classList.toggle("is-hidden", !shown);
  if (shown) {
    timerEl.textContent = `${left.toFixed(1)}s`;
    timerEl.classList.toggle("is-low", left <= 5);
  }
}

/** Owns every deed in the same color group as `tile` (including this one). */
function ownsFullGroup(playerId, group) {
  if (!group) return false;
  const target = GROUP_TARGETS[group];
  if (!target) return false;
  let count = 0;
  for (const t of TILES) {
    if (t.group === group) {
      if (state.owners[t.i] !== playerId) return false;
      count++;
    }
  }
  return count === target;
}

function rentFor(tile) {
  const t = RENT_TABLE[tile.group || tile.kind];
  if (!t) return 0;
  const level = state.houses[tile.i] || 0;
  if (tile.kind === "railroad") {
    const owner = state.owners[tile.i];
    const owned = TILES.filter((u) => u.kind === "railroad" && state.owners[u.i] === owner).length;
    return t.rents[Math.min(Math.max(owned - 1, 0), t.rents.length - 1)] ?? t.base;
  }
  if (tile.kind === "utility") {
    const owner = state.owners[tile.i];
    const owned = TILES.filter((u) => u.kind === "utility" && state.owners[u.i] === owner).length;
    return t.rents[Math.min(Math.max(owned - 1, 0), t.rents.length - 1)] ?? t.base;
  }
  return t.rents[Math.min(level, t.rents.length - 1)];
}

function buildNextHouse(tile) {
  if (state.live) {
    emitServer("manage-property", { tileIndex: tile.i, action: "build-house" }, () => {});
    return;
  }
  if (state.phase !== "playing") return;
  if (state.owners[tile.i] !== "p1") return;
  if (tile.kind !== "property") return;
  if (!ownsFullGroup("p1", tile.group)) {
    say(`You need the full ${tile.group.toUpperCase()} set to build.`);
    renderChat();
    return;
  }
  const me = state.players[0];
  const table = RENT_TABLE[tile.group];
  if (me.cash < table.housePrice) {
    say(`Not enough cash — house costs $${table.housePrice}.`);
    renderChat();
    return;
  }
  const level = state.houses[tile.i] || 0;
  if (level >= HOTEL_LEVEL) return;
  const nextLevel = level + 1;
  if (nextLevel === HOTEL_LEVEL && hotelCount() >= state.settings.hotelLimit) {
    say("No hotels left in the bank.");
    renderChat();
    return;
  }
  if (nextLevel < HOTEL_LEVEL && houseCount() >= state.settings.houseLimit) {
    say("No houses left in the bank.");
    renderChat();
    return;
  }
  if (!canBuildEvenly(tile, level + 1)) {
    say("Build houses evenly across the set.");
    renderChat();
    return;
  }
  state.houses[tile.i] = level + 1;
  addCash("p1", -table.housePrice);
  const label = level + 1 === HOTEL_LEVEL ? "HOTEL" : "HOUSE";
  record(`YOU BUILT A ${label} ON ${tile.name} — $${table.housePrice}`);
  say(`built a ${label.toLowerCase()} on ${tile.name.toLowerCase()} for $${table.housePrice}.`, me);
  playSound("house");
  renderAll();
}

function houseCount() {
  return Object.values(state.houses).reduce((sum, level) => {
    const n = Number(level) || 0;
    return sum + (n === HOTEL_LEVEL ? 0 : Math.min(n, MAX_HOUSES));
  }, 0);
}

function hotelCount() {
  return Object.values(state.houses).filter((level) => Number(level) === HOTEL_LEVEL).length;
}

function sellHouse(tile) {
  if (state.live) {
    emitServer("manage-property", { tileIndex: tile.i, action: "sell-house" }, () => {});
    return;
  }
  if (state.phase !== "playing") return;
  if (state.owners[tile.i] !== "p1") return;
  if (tile.kind !== "property") return;
  const level = state.houses[tile.i] || 0;
  if (level <= 0) return;
  // Monopoly sells evenly too: you can't drop below one step under the rest of the set
  if (!canSellEvenly(tile, level - 1)) {
    say("Sell houses evenly across the set.");
    renderChat();
    return;
  }
  const table = RENT_TABLE[tile.group];
  const refund = Math.floor(table.housePrice / 2);
  state.houses[tile.i] = level - 1;
  addCash("p1", refund);
  const what = level === HOTEL_LEVEL ? "HOTEL" : "HOUSE";
  record(`YOU SOLD A ${what} ON ${tile.name} — REFUND $${refund}`);
  renderAll();
}

/** Mirror of canBuildEvenly for selling: no deed may fall 2+ below another. */
function canSellEvenly(tile, targetLevel) {
  if (!tile.group) return true;
  for (const t of TILES) {
    if (t.group !== tile.group || t.i === tile.i) continue;
    const lvl = state.houses[t.i] || 0;
    if (lvl > targetLevel + 1) return false;
  }
  return true;
}

/* ============================================================
   8c. DEED DETAIL / HOUSE MANAGER
   ============================================================ */
function openDeedDetail(tileIdx) {
  state.deedDetail = tileIdx;
  renderDeedDetail();
  openSurface("#deed-modal", "#dd-close");
}

function closeDeedDetail() {
  state.deedDetail = null;
  closeSurface("#deed-modal");
}

/* ============================================================
   CHANCE / CHEST CARD REVEAL
   ============================================================ */
function openCardReveal(tile, ev) {
  const positive = ev.cash >= 0;
  const kind = tile.kind === "chance" ? "CHANCE" : "CHEST";
  const color = tile.kind === "chance" ? "#d74438" : "#cfa75f";
  $("#card-reveal").innerHTML = `
    <div class="cr-rail" style="background:${color}"></div>
    <div class="cr-body">
      <span class="cr-kind"><span class="t-micro g400">${kind}</span></span>
      <h3 class="t-section cr-name" id="card-reveal-title">${esc(tile.name)}</h3>
      <p class="t-body ink-2 cr-effect">${esc(ev.text)}</p>
      <div class="cr-amount ${positive ? "positive" : "negative"}">${positive ? "+" : "−"}$${Math.abs(ev.cash)}</div>
      <button class="cta-red cr-btn" id="cr-ok"><span class="cta-text cta-text-sm">OK</span></button>
    </div>`;
  openSurface("#card-modal", "#cr-ok");
  $("#cr-ok").addEventListener("click", () => {
    state.card = null;
    closeSurface("#card-modal");
  });
}

/** Rows for the rent ladder, current level highlighted. */
function deedLadderHTML(tile) {
  const table = RENT_TABLE[tile.group || tile.kind];
  if (!table) return "";
  const level = state.houses[tile.i] || 0;

  if (tile.kind === "property") {
    const labels = ["BASE RENT", "1 HOUSE", "2 HOUSES", "3 HOUSES", "4 HOUSES", "HOTEL"];
    return labels
      .map((label, lvl) => {
        const pips =
          lvl === HOTEL_LEVEL
            ? spriteHTML("hotel", 2, "#cfa75f")
            : lvl === 0
              ? `<span class="t-micro ink-3">—</span>`
              : Array.from({ length: lvl }).map(() => spriteHTML("house", 2, "#4b853d")).join("");
        return `<div class="dd-row${lvl === level ? " is-current" : ""}">
          <span class="dd-row-label">
            <span class="dd-row-pips">${pips}</span>
            <span class="t-label f11 ${lvl === level ? "g100" : "g-muted"}">${label}</span>
          </span>
          ${lvl === level ? `<span class="t-micro dd-now">NOW</span>` : ""}
          <span class="dd-row-rent">$${table.rents[lvl]}</span>
        </div>`;
      })
      .join("");
  }

  if (tile.kind === "railroad") {
    const owned = TILES.filter((u) => u.kind === "railroad" && state.owners[u.i] === state.owners[tile.i]).length;
    return [1, 2, 3, 4]
      .map((n) => `<div class="dd-row${n === owned ? " is-current" : ""}">
        <span class="dd-row-label">
          <span class="dd-row-pips">${spriteHTML("train", 2)}</span>
          <span class="t-label f11 ${n === owned ? "g100" : "g-muted"}">${n} RAILROAD${n === 1 ? "" : "S"}</span>
        </span>
        ${n === owned ? `<span class="t-micro dd-now">NOW</span>` : ""}
        <span class="dd-row-rent">$${table.rents[n - 1]}</span>
      </div>`)
      .join("");
  }

  const ownedU = TILES.filter((u) => u.kind === "utility" && state.owners[u.i] === state.owners[tile.i]).length;
  return [1, 2]
    .map((n) => `<div class="dd-row${n === ownedU ? " is-current" : ""}">
      <span class="dd-row-label">
        <span class="dd-row-pips">${spriteHTML("bulb", 2)}</span>
        <span class="t-label f11 ${n === ownedU ? "g100" : "g-muted"}">${n} UTILIT${n === 1 ? "Y" : "IES"}</span>
      </span>
      ${n === ownedU ? `<span class="t-micro dd-now">NOW</span>` : ""}
      <span class="dd-row-rent">$${table.rents[n - 1]}</span>
    </div>`)
    .join("");
}

function renderDeedDetail() {
  if (state.deedDetail == null) return;
  const tile = TILES[state.deedDetail];
  const me = state.players[0];
  const mine = state.owners[tile.i] === "p1";
  const isProperty = tile.kind === "property";
  const level = state.houses[tile.i] || 0;
  const isMortgaged = !!state.mortgaged[tile.i];
  const table = isProperty ? RENT_TABLE[tile.group] : null;
  const hasSet = isProperty && ownsFullGroup("p1", tile.group);
  const nextLevel = level + 1;

  // ---- build gating -------------------------------------------------
  let buildBlock = "";
  if (isProperty && mine) {
    const atCapHouses = nextLevel < HOTEL_LEVEL && houseCount() >= state.settings.houseLimit;
    const atCapHotels = nextLevel === HOTEL_LEVEL && hotelCount() >= state.settings.hotelLimit;
    const canAfford = me.cash >= table.housePrice;
    const evenOk = canBuildEvenly(tile, nextLevel);
    const maxed = level >= HOTEL_LEVEL;

    let reason = "";
    if (isMortgaged) reason = "Unmortgage this deed before building on it.";
    else if (!hasSet) reason = `You need every ${tile.group.toUpperCase()} deed to build here.`;
    else if (maxed) reason = "Fully developed — hotel already built.";
    else if (!evenOk) reason = "Build evenly: raise the lower deeds in this set first.";
    else if (atCapHouses) reason = "The bank is out of houses.";
    else if (atCapHotels) reason = "The bank is out of hotels.";
    else if (!canAfford) reason = `You need $${table.housePrice} to build here.`;

    const canBuild = !reason;
    const canSell = level > 0 && canSellEvenly(tile, level - 1);
    const buyLabel = nextLevel === HOTEL_LEVEL ? "BUY HOTEL" : "BUY HOUSE";
    const sellLabel = level === HOTEL_LEVEL ? "SELL HOTEL" : "SELL HOUSE";

    buildBlock = `
      <div class="dd-build">
        <div class="dd-build-actions">
          <button class="cta-red dd-build-btn" id="dd-buy" ${canBuild ? "" : "disabled"}>
            <span class="t-label">${buyLabel}</span>
            <span class="t-micro">$${table.housePrice}</span>
          </button>
          <button class="btn-dark dd-build-btn dd-sell-btn" id="dd-sell" ${canSell ? "" : "disabled"}>
            <span class="t-label">${sellLabel}</span>
            <span class="t-micro">+$${Math.floor(table.housePrice / 2)}</span>
          </button>
        </div>
        ${reason ? `<p class="dd-build-msg" style="margin-top:10px">${esc(reason)}</p>` : ""}
      </div>`;
  } else if (mine) {
    buildBlock = `<div class="dd-build"><p class="dd-build-msg">${tile.kind === "railroad" ? "Railroad rent scales with how many railroads you hold." : "Utility rent scales with how many utilities you hold."}</p></div>`;
  }

  const mortgageBtn = mine
    ? `<button class="btn-dark dd-close" id="dd-mortgage">
        <span class="t-label f11">${isMortgaged ? `UNMORTGAGE $${unmortgageCost(tile)}` : `MORTGAGE +$${mortgageValue(tile)}`}</span>
      </button>`
    : "";

  $("#deed-card-detail").innerHTML = `
    <div class="dd-rail" style="background:${accentOf(tile)}"></div>
    <div class="dd-body">
      <div class="dd-head">
        <div class="dd-icon">${popIconHTML(tile)}</div>
        <div class="pop-headtext">
          <div class="t-micro g400">${kindLabel(tile)}${isMortgaged ? " · MORTGAGED" : ""}</div>
          <h3 class="t-section dd-title" id="deed-card-title">${tile.name}</h3>
        </div>
        <button class="btn-dark dd-close" id="dd-close"><span class="t-label f11">CLOSE</span></button>
      </div>

      <div class="dd-stats">
        ${popRow("PRICE", `$${tile.price}`, "g300")}
        ${popRow("YOUR CASH", `$${me.cash.toLocaleString()}`, "green")}
        ${isProperty ? popRow("COLOR SET", tile.group.toUpperCase(), hasSet ? "green" : "g-muted") : ""}
        ${isProperty ? popRow("HOUSE COST", `$${table.housePrice}`, "g300") : ""}
      </div>

      <div class="dd-ladder">${deedLadderHTML(tile)}</div>

      ${isProperty ? `<div class="supply-strip">
        <div class="supply-cell"><span class="t-micro ink-3">HOUSES</span><span class="t-label f12 g100">${Math.max(0, state.settings.houseLimit - houseCount())}/${state.settings.houseLimit}</span></div>
        <div class="supply-cell"><span class="t-micro ink-3">HOTELS</span><span class="t-label f12 g100">${Math.max(0, state.settings.hotelLimit - hotelCount())}/${state.settings.hotelLimit}</span></div>
      </div>` : ""}

      ${buildBlock}

      <div class="dd-foot">
        <span class="t-micro ink-3">ESC OR CLICK OUTSIDE TO CLOSE</span>
        ${mortgageBtn}
      </div>
    </div>`;

  // these all funnel through renderAll(), which re-renders this modal in place
  $("#dd-close").addEventListener("click", closeDeedDetail);
  $("#dd-buy")?.addEventListener("click", () => buildNextHouse(tile));
  $("#dd-sell")?.addEventListener("click", () => sellHouse(tile));
  $("#dd-mortgage")?.addEventListener("click", () => {
    if (state.mortgaged[tile.i]) unmortgageTile(tile.i);
    else mortgageTile(tile.i);
  });
}

function houseDisplay(level) {
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

function deedCardHTML(tile, opts = {}) {
  const rail = tile.group ? GROUP_COLOR[tile.group] : tile.kind === "railroad" ? "#5c5033" : "#3e7d7b";
  const kindIcon =
    tile.kind === "railroad"
      ? spriteHTML("train", 2)
      : tile.kind === "utility"
        ? (tile.name === "ELECTRIC COMPANY" ? spriteHTML("bulb", 2) : spriteHTML("faucet", 2))
        : "";
  const isProperty = tile.kind === "property";
  const level = state.houses[tile.i] || 0;
  const rent = rentFor(tile);
  const isMortgaged = !!state.mortgaged[tile.i];
  const rentLabel = isMortgaged ? "MORTGAGED" : `$${rent} / TURN`;
  const mine = state.owners[tile.i] === "p1";
  const clickable = opts.showBuild && mine;
  const hasSet = isProperty && ownsFullGroup("p1", tile.group);

  // status pill: full set / mortgaged / owned
  let statusPill = "";
  if (opts.status) {
    if (isMortgaged) statusPill = `<span class="t-micro red">MORTGAGED</span>`;
    else if (hasSet) statusPill = `<span class="t-micro green">FULL SET</span>`;
    else statusPill = `<span class="t-micro green">${opts.status}</span>`;
  }

  const interactive = clickable && !opts.action;
  const wrapper = interactive ? "button" : "div";
  const wrapperAttrs = interactive
    ? ` type="button" aria-label="Manage ${esc(tile.name)}" data-deed-open="${tile.i}"`
    : `${clickable ? ` data-deed-open="${tile.i}"` : ""}`;
  return `<${wrapper} class="deed-card${clickable ? " is-clickable" : ""}" data-deed="${tile.i}"${wrapperAttrs}>
    <span class="deed-rail" style="background:${rail}"></span>
    <div class="deed-main">
      <div class="deed-top">
        <span class="t-label deed-name">${tile.name}</span>
        <span class="t-label deed-price">$${tile.price}</span>
      </div>
      <div class="deed-rent">
        <span class="t-micro ink-3">RENT NOW</span>
        <span class="t-label f11 ${isMortgaged ? "red" : "green"}">${rentLabel}</span>
      </div>
      <div class="deed-foot">
        ${isProperty ? `<span class="houses">${houseDisplay(level) || `<span class="t-micro ink-3">NO HOUSES</span>`}</span>` : `<span class="houses">${kindIcon}</span>`}
        ${statusPill}
        ${clickable ? `<span class="t-micro g300">MANAGE ›</span>` : ""}
        ${opts.action ? `<button class="btn-dark" data-buy="${tile.i}" ${opts.disabled ? "disabled" : ""}><span class="t-label f11">${opts.action}</span></button>` : ""}
      </div>
    </div>
  </${wrapper}>`;
}

/** Monopoly rule: you can only add a house to a property if doing so keeps
 *  the +1 step in step with every other deed in the group. */
function canBuildEvenly(tile, targetLevel) {
  if (!tile.group) return true;
  for (const t of TILES) {
    if (t.group !== tile.group) continue;
    if (t.i === tile.i) continue;
    const lvl = state.houses[t.i] || 0;
    if (lvl + 1 < targetLevel) return false;
  }
  return true;
}

function tradePlayerRowHTML(p, seed) {
  const deedCount = TILES.filter((t) => state.owners[t.i] === p.id).length;
  const canTrade = state.phase === "playing";
  return `<div class="trade-player-row">
    <div class="tp-av">${avatarHTML(p, 4, seed)}</div>
    <div class="tp-mid">
      <span class="t-label f13" style="color:${p.textColor}">${esc(p.name)}</span>
      <span class="t-micro ink-3 tp-sub">$${p.cash.toLocaleString()} · ${deedCount} DEED${deedCount === 1 ? "" : "S"}</span>
    </div>
    <button class="btn-dark" data-trade="${p.id}" ${canTrade ? "" : "disabled"}><span class="t-label f11">TRADE</span></button>
  </div>`;
}

function renderRightRail() {
  const owned = TILES.filter((t) => state.owners[t.i] === "p1");

  $("#rr-count").textContent = `${owned.length} DEEDS`;
  document.querySelectorAll(".tab").forEach((tb) => {
    const selected = tb.dataset.tab === state.tab;
    tb.classList.toggle("is-active", selected);
    tb.setAttribute("aria-selected", String(selected));
  });
  $("#rr-body")?.setAttribute("aria-labelledby", `tab-${state.tab}`);

  const body = $("#rr-body");
  if (state.tab === "deeds") {
    body.innerHTML = owned.length
      ? owned
          .map((tile) =>
            deedCardHTML(tile, {
              showBuild: true,
              status: ownsFullGroup("p1", tile.group) ? "FULL SET" : "OWNED",
            }),
          )
          .join("")
      : `<p class="t-body rr-empty">NO DEEDS YET. LAND ON A VACANT LOT AND BUY IT.</p>`;
  } else if (state.tab === "trade") {
    if (!state.settings.trading) {
      body.innerHTML = `<p class="t-body rr-empty">TRADING IS OFF FOR THIS ROUND.</p>`;
      return;
    }
    const others = state.players.filter((p) => p.id !== "p1");
    body.innerHTML = others.length
      ? others.map((p) => tradePlayerRowHTML(p, state.players.indexOf(p))).join("")
      : `<p class="t-body rr-empty">NO OTHER PLAYERS AT THE TABLE.</p>`;
  } else {
    body.innerHTML = state.log.length
      ? state.log.map((l, i) => `<p class="t-body log-line"><span class="log-n">${String(state.log.length - i).padStart(2, "0")} </span>${esc(l)}</p>`).join("")
      : `<p class="t-body ink-3">NOTHING HAS HAPPENED YET.</p>`;
  }
}

function renderSetup() {
  const wrap = $("#setup-wrap");
  wrap.classList.toggle("is-hidden", state.phase !== "setup");
  if (state.phase !== "setup") return;

  // lobby is read-only for profiles: pick an existing design only, never edit/create here.
  document.querySelectorAll(".su-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.suTab === state.setupTab);
    btn.setAttribute("aria-selected", String(btn.dataset.suTab === state.setupTab));
  });
  $("#su-custom-count").textContent = `${state.profiles.length}/${MAX_PROFILES}`;
  $("#su-grid")?.setAttribute("aria-labelledby", `su-tab-${state.setupTab}`);

  if (state.setupTab === "custom") {
    $("#su-grid").innerHTML = state.profiles.length
      ? state.profiles
          .map((p, i) => {
            const active = state.appearance === p.id;
            return `<button type="button" class="su-opt su-opt-profile${active ? " is-active" : ""}" data-app="${p.id}">
              <div class="su-av">${avatarHTML(p, 5, i)}</div>
              <div>
                <div class="t-label f13" style="color:${p.color}">${esc(p.name || "PROFILE")}</div>
                <div class="t-micro ink-3 su-state">${active ? "SELECTED" : "TAP TO USE"}</div>
              </div>
            </button>`;
          })
          .join("")
      : `<p class="su-empty-custom">No custom designs yet. Create one from the home screen, then pick it here.</p>`;
  } else {
    $("#su-grid").innerHTML = APPEARANCES.map(
      (a, i) => `<button type="button" class="su-opt${i === state.appearance ? " is-active" : ""}" data-app="${i}">
        <div class="su-av">${avatarHTML(a, 5, i)}</div>
        <div>
          <div class="t-label f13" style="color:${a.textColor}">${a.label}</div>
          <div class="t-micro ink-3 su-state">${i === state.appearance ? "SELECTED" : "AVAILABLE"}</div>
        </div>
      </button>`,
    ).join("");
  }

}

function renderAll() {
  renderTopNav();
  renderPlayers();
  renderChat();
  renderBoardState();
  placePieces();
  renderHud();
  renderRightRail();
  renderSetup();
  renderLobbyRail();
  if (state.deedDetail != null) renderDeedDetail();
  if (state.phase === "playing") saveGame();
  syncSurfaceA11y();
}

/* ============================================================
   6b. LOBBY SETTINGS RENDERER
   ============================================================ */

function tog(id, value) {
  return `<button class="tog${value ? " is-on" : ""}" data-setting="${id}" aria-pressed="${value}" title="${id}">
    <span class="tog-label">${value ? "ON" : "OFF"}</span>
  </button>`;
}

function stepper(id, value, min, max) {
  return `<div class="stepper">
    <button class="stepper-btn" data-step="${id}" data-dir="-1" ${value <= min ? "disabled" : ""}>−</button>
    <div class="stepper-val">${value}</div>
    <button class="stepper-btn" data-step="${id}" data-dir="1" ${value >= max ? "disabled" : ""}>+</button>
  </div>`;
}

function sel(id, value, options) {
  return `<select class="setting-select" data-setting="${id}">
    ${options.map(([v, l]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""}>${l}</option>`).join("")}
  </select>`;
}

function settingRow(label, desc, control) {
  return `<div class="setting-row">
    <div class="setting-label">
      <span class="t-label f12 g100">${label}</span>
      <span class="setting-desc">${desc}</span>
    </div>
    ${control}
  </div>`;
}

function settingRowNum(label, desc, control) {
  return `<div class="setting-row-num">
    <div class="setting-label">
      <span class="t-label f12 g100">${label}</span>
      <span class="setting-desc">${desc}</span>
    </div>
    ${control}
  </div>`;
}

function lobbySection(title, rows) {
  return `<div class="lobby-section">
    <div class="lobby-section-head">
      <span class="t-label">${title}</span>
    </div>
    ${rows.join("")}
  </div>`;
}

function lobbyPlayerRowHTML(p, seed) {
  const isYou = p.id === "p1" || p.id === "preview";
  // deterministic per-player "ready" flag instead of Math.random(), so the
  // dot doesn't flicker on every unrelated re-render (typing, toggling, etc.)
  const ready = isYou || !!p.online;
  return `<div class="lobby-player-row${isYou ? " lobby-player-you" : ""}">
    <div class="lobby-av">${avatarHTML(p, 3, seed)}</div>
    <div class="lobby-player-info">
      <div class="t-label lobby-player-name" style="color:${p.textColor}">${esc(p.name)}</div>
      <div class="lobby-player-sub">${isYou ? "you" : p.bot ? "cpu" : "player"} · $${p.cash.toLocaleString()}</div>
    </div>
    <span class="lobby-ready-dot" style="background:${ready ? "#35a653" : "#3a382a"};box-shadow:${ready ? "0 0 5px rgb(53 166 83/60%)" : "none"}"></span>
  </div>`;
}

function renderLobbyRail() {
  // the settings rail owns the right column for both "setup" (choosing
  // appearance) and "lobby" (configuring rules) — the in-game Holdings
  // rail should only ever appear once a round is actually live.
  const preGame = state.phase === "setup" || state.phase === "lobby";
  const locked = state.phase === "setup";
  $("#right-rail-game").classList.toggle("is-hidden", preGame);
  $("#right-rail-lobby").classList.toggle("is-hidden", !preGame);
  if (!preGame) return;

  const s = state.settings;
  const previewPlayers = locked ? [buildPreviewSelf()] : state.players.slice(0, s.maxPlayers);

  $("#lobby-settings-body").innerHTML = [
    locked
      ? `<div class="settings-rule lobby-lock-note">
          <strong style="color:var(--gold-300)">FINISH SETUP TO CONTINUE</strong><br>
          Choose your appearance and press "Enter Parlor" on the left to seat the table.
        </div>`
      : "",
    lobbySection("Players At Table", previewPlayers.map((p, i) => lobbyPlayerRowHTML(p, i))),
    lobbySection("Table Rules", [
      settingRowNum("Max Players", "Seats at the table.", stepper("maxPlayers", s.maxPlayers, 2, 4)),
      settingRowNum("Starting Cash", "Bank hands this to each player at start.", sel("startingCash", s.startingCash, [["1000","$1,000"],["1500","$1,500"],["2000","$2,000"],["3000","$3,000"]])),
      settingRow("Vacation Pool", "Taxes fill free parking. First to land claims it.", tog("vacationPool", s.vacationPool)),
      settingRow("Double GO", "Landing exactly on GO pays $400 instead of $200.", tog("doubleGo", s.doubleGo)),
    ]),
    lobbySection("Economy", [
      settingRow("Trading", "Players may propose trades.", tog("trading", s.trading)),
      settingRow("Auction", "Unowned deeds go to auction if buyer passes.", tog("auction", s.auction)),
      settingRow("No Rent In Jail", "Owner in jail can't collect rent that turn.", tog("noRentInJail", s.noRentInJail)),
      settingRow("Bankruptcy", "How to handle a bust player.", sel("bankruptMode", s.bankruptMode, [["elim","ELIMINATE"],["debt","DEBT DEAL"]])),
    ]),
    lobbySection("Building", [
      settingRowNum("House Limit", "Total houses in the bank.", sel("houseLimit", s.houseLimit, [["10","10 HOUSES"],["20","20 HOUSES"],["32","32 HOUSES"]])),
      settingRowNum("Hotel Limit", "Total hotels in the bank.", sel("hotelLimit", s.hotelLimit, [["6","6 HOTELS"],["12","12 HOTELS"]])),
    ]),
    lobbySection("Turn Timer", [
      settingRow("Timer Per Turn", "Seconds allowed per move (0 = off).", sel("turnTimer", s.turnTimer, [["0","OFF"],["30","30 SEC"],["60","60 SEC"],["120","2 MIN"]])),
    ]),
    `<div class="settings-rule">
      <strong style="color:var(--gold-300)">Active rules snapshot</strong><br>
      ${s.maxPlayers} players · $${Number(s.startingCash).toLocaleString()} start ·
      ${s.vacationPool ? "pool on" : "no pool"} ·
      ${s.trading ? "trading on" : "no trades"} ·
      ${s.auction ? "auction on" : "no auction"} ·
      ${s.turnTimer ? s.turnTimer + "s timer" : "no timer"} ·
      ${s.bankruptMode === "elim" ? "eliminate busted" : "debt deals"}
    </div>`,
  ].join("");

  const startBtn = $("#lobby-start-btn");
  startBtn.disabled = locked;
  startBtn.querySelector(".cta-text").textContent = locked ? "Finish Setup First" : "Start Round";
}

/** A lightweight, live preview of "you" while the setup overlay is still open,
 *  so the sidebar reflects the color/alias currently being chosen. */
function buildPreviewSelf() {
  const a = getAppearanceMeta(state.appearance);
  return {
    id: "preview",
    name: (state.alias.trim() || a.baseName).toUpperCase(),
    color: a.color,
    textColor: a.textColor,
    cash: Number(state.settings.startingCash),
    bot: false,
    avatarGrid: a.avatarGrid || undefined,
  };
}

/* ============================================================
   6b. PROFILE EDITOR
   ============================================================ */
const PROFILE_SWATCHES = ["#d74438", "#286ea1", "#d9a62f", "#35a653", "#a04e6f", "#3e7d7b", "#7b5029", "#cfa75f"];
const FACE_PALETTE = ["#f0d9ac", "#e8d3ab", "#cfa75f", "#c88f2e", "#9b783d", "#5c5033", "#01070a", "#ffffff", "#d74438", "#35a653", "#286ea1", "#d9a62f"];

/** Open editor. Pass a profile id to edit, or nothing to create a new one. */
function openProfileEditor(fromPhase, profileId) {
  closeRoomsModal();
  renderProfileLibrary();
  state.homeReturnView = fromPhase === "setup" ? "setup-return" : "home";
  state.editingProfileId = profileId || null;
  const existing = profileId ? getProfileById(profileId) : null;
  const account = state.account?.account;
  const source = existing || (account?.avatarGrid ? account : null);
  state.profileDraft = source
    ? { name: source.name || source.displayName, color: source.color, grid: cloneFaceGrid(source.avatarGrid), tool: "paint", paintColor: source.color }
    : { name: "", color: "#d74438", grid: faceGridFromPreset(0, "#d74438"), tool: "paint", paintColor: "#f0d9ac" };
  renderProfileEditor();
  renderAccountPanel();
  showView("profile");
}

function closeProfileEditor(save) {
  if (save) {
    const d = state.profileDraft;
    const name = (d.name || "").trim().slice(0, 12).toUpperCase() || "PLAYER";
    const hasInk = d.grid.some((row) => row.some((c) => c));
    const draftProfile = {
      id: state.editingProfileId || `pf_${Math.random().toString(36).slice(2, 9)}`,
      name,
      color: d.color,
      avatarGrid: hasInk ? d.grid : faceGridFromPreset(0, d.color),
    };
    const saved = upsertProfile(draftProfile);
    if (saved === "limit") {
      alert(`You can only save up to ${MAX_PROFILES} custom designs. Delete one to make room.`);
      return;
    }
    if (saved) {
      state.appearance = saved.id;
      state.alias = saved.name;
      if (state.account?.sessionToken) {
        emitServer("account-update", {
          sessionToken: state.account.sessionToken,
          displayName: saved.name,
          color: saved.color,
          avatarGrid: saved.avatarGrid,
        }, (response) => {
          if (response?.success) updateAccountFromResponse(response);
          else if (response?.error) {
            const announcer = $("#error-announcer");
            if (announcer) announcer.textContent = response.error;
          }
        });
      }
    }
  }
  state.profileDraft = null;
  state.editingProfileId = null;
  showView(state.homeReturnView === "setup-return" ? "game" : "home");
  if (state.homeReturnView === "setup-return") {
    renderSetup();
    renderLobbyRail();
  } else {
    renderHome();
  }
}

function deleteCurrentProfile() {
  if (!state.editingProfileId) { closeProfileEditor(false); return; }
  deleteProfile(state.editingProfileId);
  state.profileDraft = null;
  state.editingProfileId = null;
  showView(state.homeReturnView === "setup-return" ? "game" : "home");
  if (state.homeReturnView === "setup-return") {
    renderSetup();
    renderLobbyRail();
  } else {
    renderHome();
  }
}

function renderProfileEditor() {
  const d = state.profileDraft;
  if (!d) return;
  const deleteBtn = $("#profile-delete-btn");
  if (deleteBtn) deleteBtn.classList.toggle("is-hidden", !state.editingProfileId);
  const saveLabel = $("#profile-save-btn")?.querySelector(".cta-text");
  if (saveLabel) saveLabel.textContent = state.editingProfileId ? "Save Changes" : "Save Profile";

  // identity swatches
  $("#profile-swatches").innerHTML = PROFILE_SWATCHES.map(
    (c) => `<button type="button" class="profile-swatch${c.toLowerCase() === d.color.toLowerCase() ? " is-active" : ""}" style="background:${c}" data-color="${c}" title="${c}"></button>`,
  ).join("");
  $("#profile-color-picker").value = d.color;
  $("#profile-name").value = d.name;

  // face palette
  $("#face-palette").innerHTML = FACE_PALETTE.map(
    (c) => `<button type="button" class="face-swatch${d.tool === "paint" && c.toLowerCase() === d.paintColor.toLowerCase() ? " is-active" : ""}" style="background:${c}" data-ink="${c}" title="${c}"></button>`,
  ).join("");
  $("#face-color-picker").value = d.paintColor;
  $("#face-tool-paint").classList.toggle("is-active", d.tool === "paint");
  $("#face-tool-erase").classList.toggle("is-active", d.tool === "erase");

  // pixel canvas
  const canvas = $("#face-canvas");
  canvas.innerHTML = d.grid
    .map((row, y) =>
      row
        .map((c, x) => `<span class="face-cell" data-x="${x}" data-y="${y}" style="${c ? `background-color:${c};background-image:none` : ""}"></span>`)
        .join(""),
    )
    .join("");

  updateProfilePreview();
}

function updateProfilePreview() {
  const d = state.profileDraft;
  if (!d) return;
  const av = $("#profile-preview-av");
  if (av) av.innerHTML = spriteFromGrid(d.grid, 6);
  const nameEl = $("#profile-preview-name");
  if (nameEl) {
    nameEl.textContent = (d.name || "PLAYER").toUpperCase();
    nameEl.style.color = d.color;
  }
}

function paintFaceCell(x, y) {
  const d = state.profileDraft;
  if (!d) return;
  const color = d.tool === "erase" ? null : d.paintColor;
  if (d.grid[y][x] === color) return;
  d.grid[y][x] = color;
  const cell = $(`#face-canvas .face-cell[data-x="${x}"][data-y="${y}"]`);
  if (cell) {
    cell.style.backgroundColor = color || "";
    cell.style.backgroundImage = color ? "none" : "";
  }
  updateProfilePreview();
}

/* ============================================================
   7. TILE POPUP
   ============================================================ */
function kindLabel(tile) {
  const map = {
    property: "PROPERTY DEED", railroad: "RAILROAD DEED", utility: "UTILITY DEED",
    chance: "CHANCE TILE", chest: "CHEST TILE", tax: "TAX TILE",
  };
  return map[tile.kind] || "CORNER TILE";
}

function accentOf(tile) {
  if (tile.group) return GROUP_COLOR[tile.group];
  const map = {
    chance: "#d74438", chest: "#cfa75f", utility: "#3e7d7b",
    railroad: "#9b783d", "corner-vacation": "#78894f", "corner-go": "#d74438", "corner-go-jail": "#d74438",
  };
  return map[tile.kind] || "#5c5033";
}

function effectText(tile) {
  switch (tile.kind) {
    case "property": return "If this deed is unowned, you may buy it from the bank. If another player owns it, you pay the listed rent.";
    case "railroad": return "Transit deed. In this parlor ruleset, landing here charges the listed rent when owned by another player.";
    case "utility": return "Utility deed. If unowned, it can be purchased. If owned by another player, landing here charges the listed rent.";
    case "chance": return "Draw a Chance card and resolve it immediately.";
    case "chest": return "Draw a Chest card and resolve it immediately.";
    case "tax": return `Pay $${tile.price ?? 200} into the vacation pool.`;
    case "corner-go": return "Collect $200 when you pass or land on GO.";
    case "corner-jail": return "Just visiting. No penalty is applied on this square.";
    case "corner-go-jail": return "Move directly to Prison. Do not pass Start or collect $200.";
    case "corner-parking": return "Collect the full vacation pool jackpot if any cash has built up there.";
    case "corner-vacation": return "Vacation is a resting space. Collect the vacation pool when enabled.";
    default: return "Board effect unavailable.";
  }
}

function popIconHTML(tile) {
  switch (tile.kind) {
    case "railroad": return spriteHTML("train", 4);
    case "utility": return tile.name === "ELECTRIC COMPANY" ? spriteHTML("bulb", 4) : spriteHTML("faucet", 4);
    case "chance": return `<span class="q-mark" style="font-size:28px">?</span>`;
    case "chest": return spriteHTML("chest", 4);
    case "corner-go": return `<span class="go-big" style="font-size:28px">GO</span>`;
    case "corner-go-jail": return `<span class="q-mark" style="font-size:22px;color:#d74438">PRISON</span>`;
    case "corner-parking": return spriteHTML("car", 5);
    case "corner-vacation": return spriteHTML("palm", 5);
    default: return spriteHTML("diamond", 5);
  }
}

const popRow = (label, value, cls = "ink") =>
  `<div class="pop-row"><span class="t-label f12 g-muted">${label}</span><span class="t-label f12 v ${cls}">${value}</span></div>`;

function rentScheduleHTML(tile) {
  const table = RENT_TABLE[tile.group || tile.kind];
  if (!table) return "";
  if (tile.kind === "property") {
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
  if (tile.kind === "railroad") {
    return `<div class="rent-grid">${[1, 2, 3, 4].map((n) => `<div class="rent-grid-row"><span class="t-label f11 g-muted">${n} RAIL${n === 1 ? "" : "S"}</span><span class="t-label f11 green">$${table.rents[n - 1]}</span></div>`).join("")}</div>`;
  }
  if (tile.kind === "utility") {
    return `<div class="rent-grid">${[1, 2].map((n) => `<div class="rent-grid-row"><span class="t-label f11 g-muted">${n} UTIL${n === 1 ? "" : "S"}</span><span class="t-label f11 green">$${table.rents[n - 1]}</span></div>`).join("")}<p class="t-micro ink-3">* Multiplied by dice roll in classic rules</p></div>`;
  }
  return "";
}

function openPopup(tile) {
  state.selectedTile = tile;
  const ownerId = state.owners[tile.i];
  const owner = state.players.find((p) => p.id === ownerId);
  const buyable = ["property", "railroad", "utility"].includes(tile.kind);
  const unowned = buyable && !owner;
  const rent = tile.rent != null ? `$${tile.rent}` : tile.kind === "tax" ? `PAY $${tile.price ?? 200}` : "—";
  const price = tile.price != null && tile.kind !== "tax" ? `$${tile.price}` : "—";
  const ownerLabel = owner ? owner.name : buyable ? "UNOWNED" : "BANK";
  const level = state.houses[tile.i] || 0;
  const buildTag = buyable && level > 0 ? ` <span class="t-label f11 g300">${level === HOTEL_LEVEL ? "— HOTEL" : `— ${level} HOUSE${level === 1 ? "" : "S"}`}</span>` : "";

  const me = state.players[0];
  // when auction rules are on, buying only happens through the forced
  // buy/auction prompt shown when you land — not from the info popup.
  const showBuy = unowned && !state.settings.auction;
  const canBuyNow = showBuy && state.phase === "playing" && state.turnIndex === 0 && !state.busy && me.cash >= (tile.price ?? 0);
  const buyLabel =
    state.phase !== "playing" ? "JOIN TO BUY" : state.turnIndex !== 0 ? "NOT YOUR TURN" : me.cash < (tile.price ?? 0) ? "INSUFFICIENT FUNDS" : "BUY DEED";

  $("#popup-card").innerHTML = `
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
        ${tile.group ? popRow("COLOR SET", tile.group.toUpperCase()) : ""}
        ${tile.group ? popRow("HOUSE COST", `$${RENT_TABLE[tile.group].housePrice}`, "g300") : ""}
      </div>
      ${
        buyable
          ? `<div class="pop-effect-head">${spriteHTML("diamond", 3)}<span class="t-label f12 g300">RENT SCHEDULE</span></div>${rentScheduleHTML(tile)}`
          : ""
      }
      <div class="pop-effect-head">${spriteHTML("diamond", 3)}<span class="t-label f12 g300">SPECIAL EFFECT</span></div>
      <div class="pop-effect"><p class="t-body ink-2">${effectText(tile)}</p></div>
      ${
        showBuy
          ? `<div class="pop-buy-row">
              <button class="cta-red pop-buy" id="pop-buy" ${canBuyNow ? "" : "disabled"}>
                <span class="cta-text cta-text-sm">${buyLabel}</span>
              </button>
            </div>`
          : unowned && state.settings.auction
            ? `<div class="pop-buy-row"><p class="t-micro ink-3" style="text-align:center">AUCTION RULES ON — BUY WHEN YOU LAND HERE</p></div>`
            : ""
      }
      <div class="pop-foot">
        <span class="t-micro ink-3">PRESS ESC OR CLICK OUTSIDE TO CLOSE</span>
        ${owner ? `<span class="t-label f12" style="color:${owner.color}">OWNED BY ${esc(owner.name)}</span>` : ""}
      </div>
    </div>`;

  openSurface("#popup", "#pop-close");
  $("#pop-close").addEventListener("click", closePopup);
  const buyBtn = $("#pop-buy");
  if (buyBtn) buyBtn.addEventListener("click", () => { buyTile(tile); openPopup(tile); });
}

function closePopup() {
  state.selectedTile = null;
  state.highlight = null;
  closeSurface("#popup");
  renderBoardState();
}

function onTileClick(tile) {
  state.highlight = tile.i;
  const owner = state.players.find((p) => p.id === state.owners[tile.i]);
  record(`INSPECTED ${tile.name}${tile.price ? ` — $${tile.price}` : ""}${owner ? ` — OWNED BY ${owner.name}` : ""}`);
  openPopup(tile);
  renderBoardState();
  if (state.tab === "log") renderRightRail();
}

/* ============================================================
   8. GAME LOGIC
   ============================================================ */
function resolveLanding(idx, pos) {
  const me = state.players[idx];
  const tile = TILES[pos];
  const ownerId = state.owners[pos];
  const buyable = ["property", "railroad", "utility"].includes(tile.kind);

  if (buyable && !ownerId) {
    if (me.bot && me.cash > (tile.price ?? 0) + 120 && Math.random() < 0.72) {
      state.owners[pos] = me.id;
      addCash(me.id, -(tile.price ?? 0));
      record(`${me.name} BOUGHT ${tile.name} — $${tile.price}`);
      say(`${me.name} bought ${tile.name} for $${tile.price}.`);
    } else if (!me.bot) {
      // human always sees a choice modal after landing on a vacant lot
      state.pendingBuyTile = pos;
      if (state.settings.auction) {
        record(`${me.name} LANDED ON VACANT ${tile.name} — BUY OR AUCTION`);
      } else {
        record(`${me.name} LANDED ON VACANT ${tile.name} — BUY OR PASS`);
      }
    } else {
      record(`${me.name} LANDED ON VACANT ${tile.name}`);
      say(me.bot ? `${me.name} passed on ${tile.name}.` : `${tile.name} is vacant — click the tile to buy it.`);
    }
  } else if (buyable && ownerId && ownerId !== me.id) {
    const owner = state.players.find((p) => p.id === ownerId);
    if (state.mortgaged[pos]) {
      record(`${me.name} LANDED ON MORTGAGED ${tile.name} — NO RENT DUE`);
    } else {
      const rent = rentFor(tile);
      const houses = state.houses[pos] || 0;
      const tag = houses === HOTEL_LEVEL ? " (HOTEL)" : houses > 0 ? ` (${houses} HOUSE${houses === 1 ? "" : "S"})` : "";
      const paid = chargePayment(idx, rent, ownerId, `${me.name} PAID $${rent} RENT TO ${owner.name}${tag}`);
      if (!paid) return;
      say(`${me.name} paid $${rent} rent to ${owner.name}.`);
    }
  } else if (buyable && ownerId === me.id) {
    record(`${me.name} RESTED ON OWN LOT — ${tile.name}`);
  } else if (tile.kind === "chance" || tile.kind === "chest") {
    const ev = pick(tile.kind === "chance" ? CHANCE_EVENTS : CHEST_EVENTS);
    addCash(me.id, ev.cash);
    record(`${tile.kind === "chance" ? "CHANCE" : "CHEST"} — ${ev.text}`);
    say(`${me.name}: ${ev.text.toLowerCase()}`);
    if (!me.bot) openCardReveal(tile, ev);
  } else if (tile.kind === "tax") {
    const due = tile.price ?? 200;
    const paid = chargePayment(idx, due, null, `${me.name} PAID $${due} INCOME TAX${state.settings.vacationPool ? " TO THE POOL" : ""}`);
    if (paid && state.settings.vacationPool) state.pool += due;
  } else if (tile.kind === "corner-vacation") {
    const winnings = state.settings.vacationPool ? state.pool : 0;
    if (winnings > 0) {
      state.pool = 0;
      addCash(me.id, winnings);
      record(`${me.name} COLLECTED VACATION CASH — $${winnings}`);
    } else {
      record(`${me.name} LANDED ON VACATION`);
    }
  } else if (tile.kind === "corner-go-jail") {
    me.pos = 10;
    state.jail[me.id] = 2;
    record(`${me.name} SENT TO PRISON`);
    say(`${me.name} was sent to prison.`);
  } else if (tile.kind === "corner-parking") {
    const winnings = state.pool;
    if (winnings > 0) {
      state.pool = 0;
      addCash(me.id, winnings);
      record(`${me.name} SWEPT THE VACATION POOL — $${winnings}`);
      say(`${me.name} cleared the vacation pool for $${winnings}.`);
    } else {
      record(`${me.name} TOOK A BREATHER AT FREE PARKING`);
    }
  } else if (tile.kind === "corner-jail") {
    record(`${me.name} IS JUST VISITING`);
  } else if (tile.kind === "corner-go") {
    record(`${me.name} LANDED SQUARE ON GO`);
  }
}

async function runTurn(idx) {
  if (state.live) {
    if (state.phase !== "playing" || state.turnIndex !== idx || state.busy || state.turnStage !== "roll") return;
    state.busy = true;
    state.rolling = true;
    renderHud();
    emitServer("roll-dice", {}, (response) => {
      state.busy = false;
      state.rolling = false;
      if (response?.success === false) {
        say(response.error || "The roll could not be completed.");
        renderChat();
      }
      renderAll();
    });
    return;
  }
  if (state.busy || state.phase !== "playing" || state.turnStage !== "roll") return;
  state.busy = true;
  state.rolling = true;
  renderHud();

  const start = Date.now();
  while (Date.now() - start < 520) {
    state.dice = [d6(), d6()];
    // only swap pip faces so the shake animation keeps running smoothly
    if (!updateDieFaces()) renderHud();
    await sleep(70);
  }
  const a = d6();
  const b = d6();
  state.dice = [a, b];
  state.rolling = false;
  renderHud();
  playSound("die");

  const me = state.players[idx];
  const total = a + b;
  say(`${me.name} rolled ${a} + ${b} = ${total}`);
  record(`${me.name} ROLLED ${total}`);
  renderChat();

  // ---- JAIL / VACATION resolution --------------------------------------
  const inJail = (state.jail[me.id] || 0) > 0;
  if (inJail) {
    const left = state.jail[me.id];
    const rolledDoubles = a === b;
    if (rolledDoubles) {
      delete state.jail[me.id];
      record(`${me.name} ROLLED DOUBLES — FREED FROM JAIL`);
      say(`${me.name} rolled doubles and is out of jail.`);
    } else if (me.cash >= 50) {
      me.cash -= 50;
      delete state.jail[me.id];
      record(`${me.name} PAID $50 TO LEAVE JAIL (${left} LEFT)`);
      say(`${me.name} paid $50 to leave jail.`);
    } else if (left <= 1) {
      delete state.jail[me.id];
      record(`${me.name} RELEASED FROM JAIL`);
    } else {
      state.jail[me.id] = left - 1;
      record(`${me.name} STAYS IN JAIL (${left - 1} LEFT)`);
      state.highlight = me.pos;
      renderAll();
      if (me.bot) {
        clearTimeout(botTimer);
        botTimer = setTimeout(() => endTurn(idx), 700);
      }
      state.busy = false;
      return;
    }
  }

  let passedGo = false;
  for (let s = 0; s < total; s++) {
    me.pos = (me.pos + 1) % TILE_COUNT;
    if (me.pos === 0) passedGo = true;
    state.highlight = me.pos;
    renderBoardState();
    placePieces({ movingId: me.id, hop: true });
    if (!REDUCED_MOTION) playSound("step");
    await sleep(110);
  }

  if (passedGo) {
    addCash(me.id, 200);
    record(`${me.name} PASSED GO — COLLECT $200`);
    if (me.pos === 0 && state.settings.doubleGo) {
      addCash(me.id, 200);
      record(`${me.name} LANDED ON GO — DOUBLE PAY +$200`);
    }
  }

  await sleep(160);
  resolveLanding(idx, me.pos);
  state.highlight = me.pos;
  renderAll();
  await sleep(520);

  if (state.players[idx].bot) {
    if (Math.random() < 0.4) say(pick(BOT_LINES), state.players[idx]);
    maybeBotBuild(idx);
    botProposeTrade(idx);
  }

  // Keep the player on the landing square and leave all actions available.
  // Humans explicitly end from the red button; CPUs do so after a short read.
  state.turnStage = "end";
  state.busy = false;
  renderAll();
  if (state.tradeWith) renderTradeModal();

  // human landed on a vacant lot with auction rules on → forced choice
  if (idx === 0 && state.pendingBuyTile != null) {
    openChoiceModal(TILES[state.pendingBuyTile]);
    return;
  }

  if (idx === 0) startTurnCountdown();

  if (state.players[idx].bot) {
    clearTimeout(botTimer);
    botTimer = setTimeout(() => endTurn(idx), 700);
  }
}

let botTimer = null;

function endTurn(idx) {
  if (state.live) {
    if (state.phase !== "playing" || state.turnIndex !== idx || state.busy || state.turnStage !== "end") return;
    emitServer("end-turn", {}, (response) => {
      if (response?.success === false) {
        say(response.error || "The turn could not be ended.");
        renderChat();
      }
    });
    return;
  }
  if (
    state.phase !== "playing" ||
    state.busy ||
    state.turnStage !== "end" ||
    state.turnIndex !== idx ||
    (state.pendingBuyTile != null && state.settings.auction) ||
    state.auction
  ) return;

  const player = state.players[idx];
  record(`${player.name} ENDED THEIR TURN`);
  state.highlight = null;
  state.turnStage = "roll";
  state.turnIndex = (state.turnIndex + 1) % state.players.length;
  clearInterval(turnTimerInterval);
  turnTimerInterval = null;
  renderAll();
  scheduleBot();
}

function primaryTurnAction() {
  if (state.phase !== "playing" || state.busy || state.turnIndex !== 0) return;
  if ((state.pendingBuyTile != null && state.settings.auction) || state.auction) return; // must resolve first
  if (state.turnStage === "end") endTurn(0);
  else runTurn(0);
}

function scheduleBot() {
  clearTimeout(botTimer);
  if (state.phase !== "playing") return;
  if (!state.players[state.turnIndex]?.bot || state.busy) return;
  botTimer = setTimeout(() => runTurn(state.turnIndex), 900);
}

function startGame() {
  if (state.live) {
    emitServer("start-game", {}, (response) => {
      if (response?.success === false) {
        say(response.error || "Only the host can start the game.");
        renderChat();
      }
    });
    return;
  }
  // players were built when entering the lobby; apply count trim from settings
  const maxP = state.settings.maxPlayers;
  state.players = state.players.slice(0, maxP);
  // apply starting cash from settings
  const startCash = Number(state.settings.startingCash);
  state.players.forEach((p) => (p.cash = startCash));
  // reset all volatile state
  state.turnIndex = 0;
  state.dice = [3, 5];
  state.rolling = false;
  state.busy = false;
  state.turnStage = "roll";
  state.pool = state.settings.vacationPool ? Math.round(startCash * 0.167) : 0;
  state.owners = {};
  state.highlight = null;
  state.selectedTile = null;
  state.tradeWith = null;
  state.tradeMyDeeds = new Set();
  state.tradeTheirDeeds = new Set();
  state.tradeMyCash = 0;
  state.tradeTheirCash = 0;
  state.houses = {};
  state.mortgaged = {};
  state.offers = [];
  state.deedDetail = null;
  state.pendingBuyTile = null;
  state.auction = null;
  state.jail = {};
  state.card = null;
  state.gameOver = null;
  clearInterval(auctionTimer);
  clearInterval(turnTimerInterval);
  turnTimerInterval = null;
  clearSave();
  state.phase = "playing";
  closeAllSurfaces();

  const s = state.settings;
  const ruleSummary =
    `$${startCash.toLocaleString()} START · ` +
    (s.vacationPool ? "POOL ON" : "NO POOL") + " · " +
    (s.trading ? "TRADING ON" : "NO TRADES") + " · " +
    (s.auction ? "AUCTION ON" : "NO AUCTION");

  const p = state.players;
  state.messages = [
    { who: "", color: "", text: `ROOM ${state.roomCode || "----"} OPEN. ${ruleSummary}`, system: true },
    { who: p[1]?.name, color: p[1]?.textColor, text: "late night, deep pockets." },
    ...(p[2] ? [{ who: p[2].name, color: p[2].textColor, text: "i'm buying everything brown." }] : []),
    ...(p[3] ? [{ who: p[3].name, color: p[3].textColor, text: "brb, refilling coffee" }] : []),
  ].filter((m) => m.who !== undefined);
  state.log = [`GAME STARTED — ${p[0].name} TO PLAY.`];

  renderAll();
  requestAnimationFrame(() => placePieces());
  scheduleBot();
}

function buyTile(tile) {
  if (state.live) {
    if (tile?.i == null) return;
    emitServer("purchase-property", { tileIndex: tile.i }, (response) => {
      if (response?.success === false) {
        say(response.error || "That deed is no longer available.");
        renderChat();
      }
    });
    state.pendingBuyTile = null;
    $("#choice-modal")?.classList.add("is-hidden");
    closePopup();
    return;
  }
  if (state.phase !== "playing") { say("Join the room before buying deeds."); renderChat(); return; }
  if (state.busy || state.turnIndex !== 0) { say("You can only buy on your own turn."); renderChat(); return; }
  const me = state.players[0];
  if (me.cash < (tile.price ?? 0)) return;
  state.owners[tile.i] = "p1";
  addCash("p1", -(tile.price ?? 0));
  record(`YOU BOUGHT ${tile.name} — $${tile.price}`);
  say(`bought ${tile.name.toLowerCase()} for $${tile.price}`, me);
  playSound("cash");
  renderAll();
}

/* ============================================================
   8a. FORCED CHOICE + AUCTION
   ============================================================ */
const BID_STEPS = [1, 20, 100];
const AUCTION_MS = 5000;
let auctionTimer = null;
let auctionBotClock = 0;

/** Human landed on a vacant lot: auto-show choice modal.
 *  - Auction mode: locked, BUY or AUCTION only.
 *  - Normal mode: dismissible, BUY or PASS.
 */
function openChoiceModal(tile) {
  const me = state.players[0];
  const price = tile.price ?? 0;
  const canAfford = me.cash >= price;
  const auctionMode = state.settings.auction;

  $("#choice-card").innerHTML = `
    <div class="pop-rail" style="background:${accentOf(tile)}"></div>
    <div class="choice-body">
      <div class="choice-head">
        <div class="choice-icon">${popIconHTML(tile)}</div>
        <div class="pop-headtext">
          <div class="t-micro g400">${kindLabel(tile)}</div>
          <h3 class="t-section choice-title" id="choice-card-title">${tile.name}</h3>
        </div>
      </div>
      <p class="t-body ink-2 choice-copy">${auctionMode ? "You landed on an unowned lot. Buy it at the listed price, or send it to auction." : "You landed on an unowned lot. Buy it or pass."}</p>
      <div class="choice-rows">
        ${popRow("PRICE", `$${price}`, "g300")}
        ${popRow("YOUR CASH", `$${me.cash.toLocaleString()}`, canAfford ? "green" : "red")}
      </div>
      <div class="choice-actions">
        <button class="cta-red choice-btn choice-buy" id="choice-buy" ${canAfford ? "" : "disabled"}>
          <span class="t-label">BUY</span>
          <span class="t-micro">${auctionMode ? "BUY DEED" : `$${price}`}</span>
        </button>
        ${auctionMode
          ? `<button class="btn-dark choice-btn" id="choice-auction">
              <span class="t-label">AUCTION</span>
              <span class="t-micro">OPEN BIDDING</span>
            </button>`
          : `<button class="btn-dark choice-btn" id="choice-pass">
              <span class="t-label">PASS</span>
              <span class="t-micro">DECLINE</span>
            </button>`
        }
      </div>
      <p class="t-micro ink-3 choice-note">${auctionMode ? (canAfford ? "YOU MUST CHOOSE ONE TO CONTINUE" : "TOO POOR TO BUY — MUST AUCTION") : "Click outside or press ESC to revisit this choice."}</p>
    </div>`;

  openSurface("#choice-modal", "#choice-buy");
  const scrim = $("#choice-scrim");
  if (scrim) {
    scrim.classList.toggle("popup-scrim-locked", auctionMode);
    scrim.onclick = auctionMode ? null : closeChoiceModalAsPass;
  }
  const buyBtn = $("#choice-buy");
  if (buyBtn) buyBtn.addEventListener("click", () => {
    buyTile(tile);
    state.pendingBuyTile = null;
    closeSurface("#choice-modal");
    afterLandingResolved();
  });

  if (auctionMode) {
    $("#choice-auction").addEventListener("click", () => {
      state.pendingBuyTile = null;
      closeSurface("#choice-modal");
      startAuction(tile);
    });
  } else {
    $("#choice-pass").addEventListener("click", closeChoiceModalAsPass);
  }
}

/** After a buy/auction decision the human's turn continues normally. */
function afterLandingResolved() {
  renderAll();
}

function closeChoiceModalAsPass() {
  if (state.settings.auction) return;
  const tile = state.pendingBuyTile != null ? TILES[state.pendingBuyTile] : null;
  const me = state.players[0];
  if (state.live && tile) {
    emitServer("decline-property", { tileIndex: tile.i }, (response) => {
      if (response?.success === false) {
        say(response.error || "The deed could not be declined.");
        renderChat();
      }
    });
    state.pendingBuyTile = null;
    closeSurface("#choice-modal");
    return;
  }
  if (tile) record(`${me.name} PASSED ON ${tile.name}`);
  state.pendingBuyTile = null;
  closeSurface("#choice-modal");
  afterLandingResolved();
}

function startAuction(tile) {
  if (state.live) {
    emitServer("decline-property", { tileIndex: tile.i }, (response) => {
      if (response?.success === false) {
        say(response.error || "The auction could not be opened.");
        renderChat();
      }
    });
    return;
  }
  const caps = {};
  state.players.forEach((p) => {
    if (!p.bot) return;
    // bots value the lot higher when it completes a color set they own
    let mult = 0.6 + Math.random() * 0.75;
    if (tile.group && TILES.some((t) => t.group === tile.group && state.owners[t.i] === p.id)) mult *= 1.4;
    caps[p.id] = Math.min(Math.round((tile.price || 100) * mult), Math.floor(p.cash * 0.9));
  });
  state.auction = {
    tileIndex: tile.i,
    bid: 0,
    leaderId: null,
    deadline: Date.now() + AUCTION_MS,
    caps,
    passed: {},
  };
  auctionBotClock = 0;
  renderAuction();
  openSurface("#auction-modal", "#auction-pass");
  clearInterval(auctionTimer);
  auctionTimer = setInterval(tickAuction, 60);
}

function placeBid(playerId, amount) {
  const a = state.auction;
  if (!a) return;
  a.bid += amount;
  a.leaderId = playerId;
  a.deadline = Date.now() + AUCTION_MS;
  const p = state.players.find((x) => x.id === playerId);
  record(`${p.name} BID $${a.bid} ON ${TILES[a.tileIndex].name}`);
  playSound("auction");
  updateAuctionLive();
}

function humanBid(inc) {
  const a = state.auction;
  if (!a) return;
  const me = state.players[0];
  if (a.passed.p1) return;
  if (me.cash < a.bid + inc) return; // can't cover the raise
  if (state.live) {
    emitServer("auction-bid", { amount: a.bid + inc }, (response) => {
      if (response?.success === false) {
        say(response.error || "Bid rejected.");
        renderChat();
      }
    });
    return;
  }
  placeBid("p1", inc);
}

function humanPassAuction() {
  const a = state.auction;
  if (!a) return;
  if (state.live) {
    emitServer("auction-pass", {}, (response) => {
      if (response?.success === false) {
        say(response.error || "You cannot pass this auction.");
        renderChat();
      }
    });
    return;
  }
  a.passed.p1 = true;
  record(`${state.players[0].name} PASSED AT AUCTION`);
  // if everyone else has passed, the current leader wins immediately
  const active = state.players.filter((p) => !a.passed[p.id]);
  if (a.leaderId && active.length <= 1) { finalizeAuction(); return; }
  updateAuctionLive();
  if (a.leaderId && active.length <= 1) finalizeAuction();
}

function maybeBotBid() {
  const a = state.auction;
  if (!a) return;
  const tile = TILES[a.tileIndex];
  const bots = state.players.filter((p) => p.bot && p.id !== a.leaderId);
  // shuffle so it isn't always the same bot first
  for (let i = bots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bots[i], bots[j]] = [bots[j], bots[i]];
  }
  for (const p of bots) {
    if (a.passed[p.id]) continue;
    const cap = a.caps[p.id] ?? (tile.price || 100);
    const options = BID_STEPS.filter((inc) => a.bid + inc <= cap && p.cash >= a.bid + inc);
    if (options.length && Math.random() < 0.55) {
      const inc = options[Math.floor(Math.random() * options.length)];
      placeBid(p.id, inc);
      return true;
    }
    // can't afford another raise or reached their valuation → out
    a.passed[p.id] = true;
  }
  // if every opponent has passed, the current leader wins immediately
  if (a.leaderId && state.players.filter((p) => !a.passed[p.id]).length <= 1) {
    finalizeAuction();
    return true;
  }
  return false;
}

function tickAuction() {
  const a = state.auction;
  if (!a) return;
  const remaining = a.deadline - Date.now();

  // Live auctions are finalized by the server. The client only keeps the
  // countdown visually current until the authoritative update arrives.
  if (state.live) {
    updateAuctionLive();
    if (remaining <= 0) {
      clearInterval(auctionTimer);
      auctionTimer = null;
    }
    return;
  }

  // let a bot consider bidding roughly twice a second
  auctionBotClock += 60;
  if (auctionBotClock >= 480) {
    auctionBotClock = 0;
    if (maybeBotBid()) return; // may finalize if all others passed
  }

  if (remaining <= 0) { finalizeAuction(); return; }
  updateAuctionLive();
}

function finalizeAuction() {
  clearInterval(auctionTimer);
  auctionTimer = null;
  const a = state.auction;
  if (!a) return;
  const tile = TILES[a.tileIndex];
  const winner = a.leaderId ? state.players.find((p) => p.id === a.leaderId) : null;

  if (winner && a.bid > 0 && winner.cash >= a.bid) {
    state.owners[a.tileIndex] = winner.id;
    addCash(winner.id, -a.bid);
    record(`${winner.name} WON ${tile.name} AT AUCTION — $${a.bid}`);
    say(`${winner.name} won ${tile.name} at auction for $${a.bid}.`);
  } else {
    record(`${tile.name} WENT UNSOLD AT AUCTION`);
    say(`${tile.name} drew no bids and stays with the bank.`);
  }

  state.auction = null;
  state.pendingBuyTile = null;
  closeSurface("#auction-modal");
  renderAll();
}

function renderAuction() {
  const a = state.auction;
  if (!a) return;
  const tile = TILES[a.tileIndex];
  $("#auction-card").innerHTML = `
    <div class="auction-rail" style="background:${accentOf(tile)}"></div>
    <div class="auction-body">
      <div class="auction-head">
        <div class="auction-icon">${popIconHTML(tile)}</div>
        <div class="pop-headtext">
          <div class="t-micro g400">AUCTION · ${kindLabel(tile)}</div>
          <h3 class="t-section auction-title" id="auction-card-title">${tile.name}</h3>
        </div>
      </div>

      <div class="auction-bid-box">
        <div>
          <div class="t-micro ink-3">HIGH BID</div>
          <div class="auction-bid-val" id="auction-bid">$0</div>
        </div>
        <div class="auction-leader">
          <div class="t-micro ink-3">LEADER</div>
          <div class="t-label auction-leader-name" id="auction-leader">NO BIDS YET</div>
        </div>
      </div>

      <div class="auction-timer-wrap">
        <div class="auction-timer-top">
          <span class="t-micro g400">TIME LEFT</span>
          <span class="t-label f12 g-muted" id="auction-timer">5.0s</span>
        </div>
        <div class="auction-bar-track"><div class="auction-bar-fill" id="auction-bar"></div></div>
      </div>

      <div class="auction-bids">
        ${BID_STEPS.map((inc) => `
          <button class="cta-red auction-bid-btn" data-bid="${inc}">
            <span class="t-label">+${inc}</span>
            <span class="t-micro">RAISE</span>
          </button>`).join("")}
      </div>

      <div class="auction-pass">
        <button class="btn-dark auction-pass-btn" id="auction-pass"><span class="t-label f12">PASS — STAND DOWN</span></button>
      </div>

      <div class="auction-players" id="auction-players"></div>

      <p class="t-micro ink-3 auction-foot">EACH BID RESETS THE 5s CLOCK · LAST BIDDER WINS</p>
    </div>`;

  $("#auction-card").querySelectorAll("[data-bid]").forEach((btn) => {
    btn.addEventListener("click", () => humanBid(Number(btn.dataset.bid)));
  });
  $("#auction-pass").addEventListener("click", humanPassAuction);
  updateAuctionLive();
}

function updateAuctionLive() {
  const a = state.auction;
  if (!a) return;
  const me = state.players[0];
  const remaining = Math.max(0, a.deadline - Date.now());
  const pct = Math.max(0, Math.min(100, (remaining / AUCTION_MS) * 100));

  const bar = $("#auction-bar");
  if (bar) {
    bar.style.transform = `scaleX(${pct / 100})`;
    bar.classList.toggle("is-low", remaining <= 2000);
  }
  const timerEl = $("#auction-timer");
  if (timerEl) timerEl.textContent = `${(remaining / 1000).toFixed(1)}s`;

  const bidEl = $("#auction-bid");
  if (bidEl) bidEl.textContent = `$${a.bid}`;

  const leaderEl = $("#auction-leader");
  if (leaderEl) {
    const leader = a.leaderId ? state.players.find((p) => p.id === a.leaderId) : null;
    leaderEl.textContent = leader ? leader.name : "NO BIDS YET";
    leaderEl.style.color = leader ? leader.textColor : "var(--text-muted)";
  }

  $("#auction-card")?.querySelectorAll("[data-bid]").forEach((btn) => {
    const inc = Number(btn.dataset.bid);
    btn.disabled = me.cash < a.bid + inc;
  });
  const passBtn = $("#auction-pass");
  if (passBtn) passBtn.disabled = !!a.passed?.p1;

  const listEl = $("#auction-players");
  if (listEl) {
    listEl.innerHTML = state.players.map((p) => {
      let status = "BIDDING";
      let cls = "green";
      if (p.id === a.leaderId) { status = "LEADING"; cls = "g300"; }
      else if (a.passed[p.id]) { status = "PASSED"; cls = "ink-3"; }
      else if (p.cash < BID_STEPS[0] || p.id !== "p1" && p.cash < a.bid + BID_STEPS[0]) { status = "BROKE"; cls = "red"; }
      return `<div class="auction-player${p.id === a.leaderId ? " is-leading" : ""}">
        <span class="ap-av">${avatarHTML(p, 2, state.players.indexOf(p))}</span>
        <span class="t-label ap-name" style="color:${p.textColor}">${esc(p.name)}</span>
        <span class="t-micro ap-st ${cls}">${status}</span>
      </div>`;
    }).join("");
  }
}

/* ============================================================
   8b. TRADING
   ============================================================ */
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function tradeDeedRowHTML(tile, side, selected) {
  const rail = tile.group ? GROUP_COLOR[tile.group] : tile.kind === "railroad" ? "#5c5033" : "#3e7d7b";
  const mortgaged = !!state.mortgaged[tile.i];
  return `<button type="button" class="trade-deed${selected ? " is-selected" : ""}${mortgaged ? " is-mortgaged" : ""}" data-side="${side}" data-deed="${tile.i}" ${mortgaged ? "disabled" : ""}>
    <span class="trade-deed-rail" style="background:${rail}"></span>
    <span class="trade-deed-name">${tile.name}</span>
    <span class="trade-deed-price">$${tile.price}</span>
    <span class="trade-deed-check"></span>
  </button>`;
}

function tradeSummaryText(deedSet, cash) {
  return `${deedSet.size} deed${deedSet.size === 1 ? "" : "s"} + $${cash}`;
}

function updateTradeSummary() {
  const sendEl = $("#trade-send-summary");
  const receiveEl = $("#trade-receive-summary");
  if (sendEl) sendEl.textContent = tradeSummaryText(state.tradeMyDeeds, state.tradeMyCash);
  if (receiveEl) receiveEl.textContent = tradeSummaryText(state.tradeTheirDeeds, state.tradeTheirCash);
}

function renderTradeModal() {
  if (!state.tradeWith) return;
  const me = state.players[0];
  const other = state.players.find((p) => p.id === state.tradeWith);
  if (!other) { closeTradeModal(); return; }

  const myDeeds = TILES.filter((t) => state.owners[t.i] === "p1");
  const theirDeeds = TILES.filter((t) => state.owners[t.i] === other.id);
  const otherSeed = state.players.indexOf(other);

  $("#trade-card").innerHTML = `
    <div class="trade-body">
      <div class="trade-head">
        <div class="section-title" style="margin-bottom:0">
          ${spriteHTML("diamond", 3)}
          <h2 class="t-section g300" id="trade-card-title">Propose Trade</h2>
        </div>
        <button class="btn-dark" id="trade-close"><span class="t-label f11">CLOSE</span></button>
      </div>
      <p class="t-body ink-2 trade-copy">Select deeds from each side and set a cash amount to include, then send the offer.</p>

      <div class="trade-cols">
        <div class="trade-side">
          <div class="trade-side-head">
            <div class="tp-av">${avatarHTML(me, 4, 0)}</div>
            <div>
              <span class="t-label f13" style="color:${me.textColor}">${esc(me.name)}</span>
              <span class="t-micro ink-3 trade-cash-label">CASH ON HAND $${me.cash.toLocaleString()}</span>
            </div>
          </div>
          <div class="trade-deed-list thin-scroll">
            ${
              myDeeds.length
                ? myDeeds.map((t) => tradeDeedRowHTML(t, "me", state.tradeMyDeeds.has(t.i))).join("")
                : `<p class="t-body trade-empty">NO DEEDS TO OFFER</p>`
            }
          </div>
          <label class="trade-cash-field">
            <span class="t-label f11 g-muted">CASH TO OFFER</span>
            <input type="number" min="0" max="${me.cash}" step="10" class="field" id="trade-my-cash" value="${state.tradeMyCash}" />
          </label>
        </div>

        <div class="trade-side">
          <div class="trade-side-head">
            <div class="tp-av">${avatarHTML(other, 4, otherSeed)}</div>
            <div>
              <span class="t-label f13" style="color:${other.textColor}">${esc(other.name)}</span>
              <span class="t-micro ink-3 trade-cash-label">CASH ON HAND $${other.cash.toLocaleString()}</span>
            </div>
          </div>
          <div class="trade-deed-list thin-scroll">
            ${
              theirDeeds.length
                ? theirDeeds.map((t) => tradeDeedRowHTML(t, "them", state.tradeTheirDeeds.has(t.i))).join("")
                : `<p class="t-body trade-empty">NO DEEDS TO REQUEST</p>`
            }
          </div>
          <label class="trade-cash-field">
            <span class="t-label f11 g-muted">CASH TO REQUEST</span>
            <input type="number" min="0" max="${other.cash}" step="10" class="field" id="trade-their-cash" value="${state.tradeTheirCash}" />
          </label>
        </div>
      </div>

      <div class="trade-summary">
        <span class="t-micro ink-3">YOU SEND</span>
        <span class="t-label f12 g300" id="trade-send-summary">${tradeSummaryText(state.tradeMyDeeds, state.tradeMyCash)}</span>
        <span class="trade-arrow">⇄</span>
        <span class="t-micro ink-3">YOU RECEIVE</span>
        <span class="t-label f12 green" id="trade-receive-summary">${tradeSummaryText(state.tradeTheirDeeds, state.tradeTheirCash)}</span>
      </div>

      <div class="trade-actions">
        <button class="cta-red trade-send" id="trade-send"><span class="cta-text cta-text-sm">Send Trade</span></button>
        <button class="btn-dark trade-cancel" id="trade-cancel"><span class="t-label f12">Cancel</span></button>
      </div>
    </div>`;

  $("#trade-close").addEventListener("click", closeTradeModal);
  $("#trade-cancel").addEventListener("click", closeTradeModal);
  $("#trade-send").addEventListener("click", sendTrade);

  $("#trade-my-cash").addEventListener("input", (e) => {
    let v = Math.round(Number(e.target.value) || 0);
    v = clamp(v, 0, me.cash);
    if (String(v) !== e.target.value) e.target.value = String(v);
    state.tradeMyCash = v;
    updateTradeSummary();
  });
  $("#trade-their-cash").addEventListener("input", (e) => {
    let v = Math.round(Number(e.target.value) || 0);
    v = clamp(v, 0, other.cash);
    if (String(v) !== e.target.value) e.target.value = String(v);
    state.tradeTheirCash = v;
    updateTradeSummary();
  });

  $("#trade-card").querySelectorAll(".trade-deed").forEach((btn) => {
    btn.addEventListener("click", () => {
      const side = btn.dataset.side;
      const idx = Number(btn.dataset.deed);
      const set = side === "me" ? state.tradeMyDeeds : state.tradeTheirDeeds;
      if (set.has(idx)) set.delete(idx);
      else set.add(idx);
      btn.classList.toggle("is-selected");
      updateTradeSummary();
    });
  });
}

function openTradeModal(playerId) {
  if (state.phase !== "playing") return;
  if (!state.settings.trading) {
    say("Trading is disabled for this round.");
    renderChat();
    return;
  }
  const other = state.players.find((p) => p.id === playerId);
  if (!other) return;
  state.tradeWith = playerId;
  state.tradeMyDeeds = new Set();
  state.tradeTheirDeeds = new Set();
  state.tradeMyCash = 0;
  state.tradeTheirCash = 0;
  renderTradeModal();
  openSurface("#trade-modal", "#trade-close");
}

function closeTradeModal() {
  state.tradeWith = null;
  closeSurface("#trade-modal");
}

function sendTrade() {
  if (!state.tradeWith) return;
  const me = state.players[0];
  const other = state.players.find((p) => p.id === state.tradeWith);
  if (!other) return;

  const myCash = clamp(state.tradeMyCash, 0, me.cash);
  const theirCash = clamp(state.tradeTheirCash, 0, other.cash);

  if (state.tradeMyDeeds.size === 0 && state.tradeTheirDeeds.size === 0 && myCash === 0 && theirCash === 0) {
    say("Add at least one deed or cash amount before sending a trade.");
    renderChat();
    return;
  }

  for (const i of state.tradeMyDeeds) {
    if ((state.houses[i] || 0) > 0) {
      say("You must sell all houses on a property before trading it.");
      renderChat();
      return;
    }
    if (state.mortgaged[i]) {
      say("You must unmortgage a property before trading it.");
      renderChat();
      return;
    }
  }
  for (const i of state.tradeTheirDeeds) {
    if (state.mortgaged[i]) {
      say("That property is mortgaged and can't be traded yet.");
      renderChat();
      return;
    }
  }

  const offer = {
    from: "p1",
    to: other.id,
    giveDeeds: [...state.tradeMyDeeds],
    wantDeeds: [...state.tradeTheirDeeds],
    giveCash: myCash,
    wantCash: theirCash,
  };
  if (state.live) {
    emitServer("propose-trade", {
      toPlayerId: other.serverId || other.id,
      givePropertyIndexes: offer.giveDeeds,
      requestPropertyIndexes: offer.wantDeeds,
      giveCash: offer.giveCash,
      requestCash: offer.wantCash,
    }, (response) => {
      if (response?.success === false) {
        say(response.error || "Trade could not be sent.");
        renderChat();
        return;
      }
      record(`OFFER SENT TO ${other.name}`);
      say(`Offer sent to ${other.name}.`, me);
      renderChat();
    });
    closeTradeModal();
    return;
  }
  closeTradeModal();
  say(`Offer sent to ${other.name}.`, me);
  record(`OFFER SENT TO ${other.name}`);
  renderChat();
  setTimeout(() => resolveBotOffer(offer), 1400);
}

function resolveBotOffer(offer) {
  const bot = state.players.find((p) => p.id === offer.to);
  if (!bot) return;
  const gain = offer.wantDeeds.reduce((s, i) => s + (TILES[i].price || 0), 0) + offer.wantCash;
  const cost = offer.giveDeeds.reduce((s, i) => s + (TILES[i].price || 0), 0) + offer.giveCash;
  if (gain >= cost * 0.92) {
    record(`${bot.name} ACCEPTED YOUR OFFER`);
    say(`accepted your offer.`, bot);
    executeTrade(offer, "accepted");
  } else {
    record(`${bot.name} DECLINED YOUR OFFER`);
    say(`declined your offer.`, bot);
    renderChat();
  }
}

function executeTrade(offer, how) {
  const me = state.players.find((p) => p.id === offer.from);
  const other = state.players.find((p) => p.id === offer.to);
  if (!me || !other) return;
  offer.giveDeeds.forEach((i) => { state.owners[i] = offer.to; state.houses[i] = 0; state.mortgaged[i] = false; });
  offer.wantDeeds.forEach((i) => { state.owners[i] = offer.from; state.houses[i] = 0; state.mortgaged[i] = false; });
  addCash(offer.from, offer.wantCash - offer.giveCash);
  addCash(offer.to, offer.giveCash - offer.wantCash);
  record(`TRADE ${how.toUpperCase()} — ${me.name} ⇄ ${other.name}`);
  renderAll();
}

/** Bots occasionally propose a cash-for-deed trade when they need one last lot. */
function botProposeTrade(idx) {
  const bot = state.players[idx];
  if (!bot?.bot || !state.settings.trading || state.offers.length) return;
  if (Math.random() > 0.16) return;
  for (const group of Object.keys(GROUP_TARGETS)) {
    const tiles = TILES.filter((t) => t.group === group);
    const target = GROUP_TARGETS[group];
    const botIdx = tiles.filter((t) => state.owners[t.i] === bot.id).length;
    const humanIdx = tiles.filter((t) => state.owners[t.i] === "p1").length;
    if (botIdx + humanIdx !== target) continue;
    if (humanIdx === 0) continue;
    const want = tiles.find((t) => state.owners[t.i] === "p1");
    if (!want || state.mortgaged[want.i]) continue;
    const cash = Math.round((want.price || 100) * 1.35);
    if (bot.cash < cash) continue;
    const offer = { from: bot.id, to: "p1", giveDeeds: [], wantDeeds: [want.i], giveCash: cash, wantCash: 0 };
    state.offers.push(offer);
    say(`${bot.name} proposes a trade…`, bot);
    renderChat();
    setTimeout(() => openOfferModal(offer), 1000);
    return;
  }
}

function openOfferModal(offer) {
  const from = state.players.find((p) => p.id === offer.from || p.serverId === offer.from);
  if (!from) return;
  const wantNames = offer.wantDeeds.map((i) => TILES[i].name).join(", ") || "nothing";
  $("#offer-card").innerHTML = `
    <div class="offer-rail" style="background:${from.color}"></div>
    <div class="offer-body">
      <div class="offer-head">
        <div class="offer-av">${avatarHTML(from, 4, state.players.indexOf(from))}</div>
        <div>
          <div class="t-micro g400">TRADE OFFER</div>
          <h3 class="t-section offer-title" id="offer-card-title" style="color:${from.textColor}">${esc(from.name)}</h3>
        </div>
      </div>
      <p class="t-body ink-2 offer-rows" style="margin-top:14px">
        ${from.name} will give you <span class="green">$${offer.giveCash.toLocaleString()}</span>
        and wants <span class="g300">${esc(wantNames)}</span>.
      </p>
      <div class="offer-actions">
        <button class="cta-red offer-btn" id="offer-accept"><span class="cta-text cta-text-sm">Accept</span></button>
        <button class="btn-dark offer-btn" id="offer-counter"><span class="t-label f12">Counter</span></button>
        <button class="btn-dark offer-btn" id="offer-reject"><span class="t-label f12">Reject</span></button>
      </div>
      <p class="t-micro ink-3 offer-note">Trades only transfer cash or deeds offered here.</p>
    </div>`;
  openSurface("#offer-modal", "#offer-accept");
  $("#offer-accept").addEventListener("click", () => {
    const o = state.offers.find((x) => x === offer);
    if (o) state.offers.splice(state.offers.indexOf(o), 1);
    if (state.live) {
      emitServer("respond-trade", { tradeId: offer.id, accept: true }, (response) => {
        if (response?.success === false) {
          say(response.error || "Trade could not be accepted.");
          renderChat();
        }
      });
      closeSurface("#offer-modal");
      return;
    }
    executeTrade(offer, "accepted");
    closeSurface("#offer-modal");
  });
  $("#offer-counter").addEventListener("click", () => {
    // swap into the trade editor pre-loaded with the bot's proposal
    state.tradeWith = offer.from;
    state.tradeMyDeeds = new Set(offer.wantDeeds);
    state.tradeTheirDeeds = new Set(offer.giveDeeds);
    state.tradeMyCash = offer.wantCash;
    state.tradeTheirCash = offer.giveCash;
    const o = state.offers.find((x) => x === offer);
    if (o) state.offers.splice(state.offers.indexOf(o), 1);
    closeSurface("#offer-modal");
    renderTradeModal();
    openSurface("#trade-modal", "#trade-close");
  });
  $("#offer-reject").addEventListener("click", rejectOpenOffer);
}

function rejectOpenOffer() {
  const offer = state.offers.shift();
  if (state.live && offer) {
    emitServer("respond-trade", { tradeId: offer.id, accept: false }, () => {});
    closeSurface("#offer-modal");
    return;
  }
  if (offer) {
    const from = state.players.find((p) => p.id === offer.from || p.serverId === offer.from);
    say(`rejected ${from ? from.name : "the"} offer.`);
  }
  closeSurface("#offer-modal");
  renderChat();
}

/* ============================================================
   8d. MORTGAGE · BANKRUPTCY · SAVE · CPU
   ============================================================ */
const SAVE_KEY = "poorup.save.v1";

function mortgageValue(tile) { return Math.floor((tile.price || 0) * 0.5); }
function unmortgageCost(tile) { return Math.ceil((tile.price || 0) * 0.55); }

function mortgageTile(tileIdx) {
  if (state.live) {
    emitServer("manage-property", { tileIndex: tileIdx, action: "mortgage" }, () => {});
    return;
  }
  if (state.phase !== "playing") return;
  const me = state.players[0];
  if (state.owners[tileIdx] !== "p1" || state.mortgaged[tileIdx]) return;
  const t = TILES[tileIdx];
  // can't mortgage a deed if any deed in its color group still has houses/hotels
  if (t.group) {
    const hasBuildings = TILES.some((tg) => tg.group === t.group && (state.houses[tg.i] || 0) > 0);
    if (hasBuildings) {
      say(`Sell the houses on your ${t.group.toUpperCase()} set before mortgaging here.`);
      renderChat();
      return;
    }
  }
  state.mortgaged[tileIdx] = true;
  me.cash += mortgageValue(t);
  record(`YOU MORTGAGED ${t.name} — +$${mortgageValue(t)}`);
  say(`mortgaged ${t.name.toLowerCase()} for $${mortgageValue(t)}.`, me);
  renderAll();
}

function unmortgageTile(tileIdx) {
  if (state.live) {
    emitServer("manage-property", { tileIndex: tileIdx, action: "unmortgage" }, () => {});
    return;
  }
  const me = state.players[0];
  if (state.owners[tileIdx] !== "p1" || !state.mortgaged[tileIdx]) return;
  const t = TILES[tileIdx];
  const cost = unmortgageCost(t);
  if (me.cash < cost) { say(`Not enough cash to unmortgage ${t.name} ($${cost}).`); renderChat(); return; }
  me.cash -= cost;
  state.mortgaged[tileIdx] = false;
  record(`YOU UNMORTGAGED ${t.name} — $${cost}`);
  renderAll();
}

function liquidatePlayer(playerId) {
  if (state.live) {
    say("Sell houses or mortgage deeds from Holdings; the bank will settle the debt automatically.");
    renderChat();
    return;
  }
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return;
  TILES.forEach((t) => {
    if (state.owners[t.i] !== playerId) return;
    const lvl = state.houses[t.i] || 0;
    if (lvl > 0) { p.cash += Math.floor((RENT_TABLE[t.group]?.housePrice || 50) / 2) * (lvl === HOTEL_LEVEL ? 4 : lvl); state.houses[t.i] = 0; }
    if (!state.mortgaged[t.i]) { p.cash += mortgageValue(t); state.mortgaged[t.i] = true; }
  });
  record(`${p.name} LIQUIDATED — SOLD HOUSES & MORTGAGED DEEDS`);
}

function bankruptPlayer(idx, creditorId) {
  if (state.live) {
    emitServer("declare-bankruptcy", {}, (response) => {
      if (response?.success === false) {
        say(response.error || "Bankruptcy could not be declared.");
        renderChat();
      }
    });
    return;
  }
  const p = state.players[idx];
  const creditor = creditorId ? state.players.find((x) => x.id === creditorId) : null;
  TILES.forEach((t) => {
    if (state.owners[t.i] !== p.id) return;
    state.owners[t.i] = creditorId;
    state.houses[t.i] = 0;
    state.mortgaged[t.i] = false;
  });
  if (creditor) creditor.cash += p.cash;
  p.cash = 0;
  record(`${p.name} WENT BANKRUPT${creditor ? ` — ASSETS TO ${creditor.name}` : ""}`);
  say(`${p.name} went bankrupt${creditor ? ` — assets to ${creditor.name}` : " (bank)"}.`);
  const wasHuman = p.id === "p1";
  state.players.splice(idx, 1);
  if (state.turnIndex >= state.players.length) state.turnIndex = 0;
  closeSurface("#bankruptcy-modal");
  renderAll();
  if (state.players.length <= 1) {
    clearSave();
    const winner = state.players[0];
    showGameOver(winner ? winner.name : "Nobody", winner ? winner.id : null);
    return;
  }
  if (wasHuman) {
    clearSave();
    showGameOver("Bank", null);
    return;
  }
  scheduleBot();
}

/** Build a ranked summary and show the round-over modal. */
function showGameOver(winnerName, winnerId) {
  state.gameOver = { winnerName, winnerId };
  const ranking = state.players
    .slice()
    .sort((x, y) => (y.cash + totalAssets(y)) - (x.cash + totalAssets(x)));
  const summary = ranking
    .map((p, i) => {
      const deeds = TILES.filter((t) => state.owners[t.i] === p.id).length;
      const crown = p.id === winnerId || i === 0 ? ' <span class="t-micro g300">★ WINNER</span>' : "";
      return `<div class="go-summary-row${p.id === winnerId ? " is-winner" : ""}">
        <span class="go-kicker">${String(i + 1).padStart(2, "0")}</span>
        <span class="t-label f13" style="color:${p.textColor};flex:1">${esc(p.name)}${crown}</span>
        <span class="t-label f12 g-muted">${deeds} DEED${deeds === 1 ? "" : "S"}</span>
        <span class="t-label f13 green">$${p.cash.toLocaleString()}</span>
      </div>`;
    })
    .join("");

  $("#gameover-card").innerHTML = `
    <div class="bank-body">
      <div class="bank-head" style="justify-content:center;text-align:center">
        <div>
          <div class="go-kicker g400">ROUND OVER</div>
          <h3 class="go-name" id="gameover-card-title">${esc(winnerName)} WINS</h3>
        </div>
      </div>
      <div class="go-summary">${summary}</div>
      <div class="go-actions">
        <button class="cta-red bank-btn" id="go-rematch"><span class="cta-text cta-text-sm">Rematch</span></button>
        <button class="btn-dark bank-btn" id="go-home"><span class="t-label f13">Back to Lobby</span></button>
      </div>
    </div>`;
  openSurface("#gameover-modal", "#go-rematch");
  $("#go-rematch").addEventListener("click", () => {
    closeSurface("#gameover-modal");
    state.gameOver = null;
    startGame();
  });
  $("#go-home").addEventListener("click", () => {
    closeSurface("#gameover-modal");
    state.gameOver = null;
    goHome();
  });
}

function totalAssets(p) {
  return TILES.filter((t) => state.owners[t.i] === p.id)
    .reduce((sum, t) => sum + (state.mortgaged[t.i] ? 0 : t.price || 0), 0);
}

function openBankruptcyModal(idx, amount, creditorId, label) {
  const p = state.players[idx];
  const creditor = creditorId ? state.players.find((x) => x.id === creditorId) : null;
  $("#bankruptcy-card").innerHTML = `
    <div class="bank-body">
      <div class="bank-head">
        <span class="bank-icon">!</span>
        <div>
          <div class="t-micro red">CAN'T COVER IT</div>
          <h3 class="t-section bank-title" id="bankruptcy-card-title">$${amount} due</h3>
        </div>
      </div>
      <p class="t-body ink-2 bank-copy">${esc(label)}. You're $${amount - p.cash} short. Sell houses and mortgage deeds — or hand everything to ${creditor ? esc(creditor.name) : "the bank"} and bow out.</p>
      <div class="bank-actions">
        <button class="cta-red bank-btn" id="bank-liquidate"><span class="cta-text cta-text-sm">Liquidate & Pay</span></button>
        <button class="btn-dark bank-btn" id="bank-declare"><span class="t-label f12">Declare Bankruptcy</span></button>
      </div>
    </div>`;
  openSurface("#bankruptcy-modal", "#bank-liquidate");
  $("#bank-liquidate").addEventListener("click", () => {
    if (state.live) {
      closeSurface("#bankruptcy-modal");
      say("Use Holdings to sell houses or mortgage deeds, then the debt will settle automatically.");
      renderChat();
      return;
    }
    liquidatePlayer(p.id);
    if (p.cash >= amount) {
      p.cash -= amount;
      if (creditor) creditor.cash += amount;
      record(`YOU PAID $${amount} AFTER LIQUIDATION`);
      closeSurface("#bankruptcy-modal");
      renderAll();
    } else {
      bankruptPlayer(idx, creditorId);
    }
  });
  $("#bank-declare").addEventListener("click", () => bankruptPlayer(idx, creditorId));
}

/** Central payment helper: returns true when paid, false when unpayable. */
function chargePayment(playerIdx, amount, creditorId, label) {
  const p = state.players[playerIdx];
  if (p.cash >= amount) {
    p.cash -= amount;
    const creditor = creditorId ? state.players.find((x) => x.id === creditorId) : null;
    if (creditor) creditor.cash += amount;
    record(label);
    return true;
  }
  if (p.bot) {
    liquidatePlayer(p.id);
    if (p.cash >= amount) {
      p.cash -= amount;
      const creditor = creditorId ? state.players.find((x) => x.id === creditorId) : null;
      if (creditor) creditor.cash += amount;
      record(`${label} — (LIQUIDATED)`);
      return true;
    }
    bankruptPlayer(playerIdx, creditorId);
    return false;
  }
  openBankruptcyModal(playerIdx, amount, creditorId, label);
  return false;
}

/* ---- CPU round management ---- */
function maybeBotBuild(idx) {
  const p = state.players[idx];
  if (!p?.bot) return;
  for (const t of TILES) {
    if (t.kind !== "property" || state.owners[t.i] !== p.id) continue;
    if (!ownsFullGroup(p.id, t.group)) continue;
    const lvl = state.houses[t.i] || 0;
    if (lvl >= HOTEL_LEVEL) continue;
    const table = RENT_TABLE[t.group];
    if (p.cash <= table.housePrice * 3) continue;
    if (!canBuildEvenly(t, lvl + 1)) continue;
    const next = lvl + 1;
    if (next === HOTEL_LEVEL && hotelCount() >= state.settings.hotelLimit) continue;
    if (next < HOTEL_LEVEL && houseCount() >= state.settings.houseLimit) continue;
    p.cash -= table.housePrice;
    state.houses[t.i] = next;
    record(`${p.name} BUILT A ${next === HOTEL_LEVEL ? "HOTEL" : "HOUSE"} ON ${t.name}`);
    return;
  }
}

/* ---- persist / resume ---- */
function saveGame() {
  if (state.phase !== "playing") return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1,
      roomCode: state.roomCode,
      players: state.players,
      owners: state.owners,
      houses: state.houses,
      mortgaged: state.mortgaged,
      pool: state.pool,
      turnIndex: state.turnIndex,
      dice: state.dice,
      settings: state.settings,
      log: state.log,
      messages: state.messages,
    }));
  } catch { /* ignore */ }
}

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.v === 1 && Array.isArray(s.players) && s.players.length ? s : null;
  } catch { return null; }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

function resumeGame() {
  if (state.live) {
    emitServer("restore-session", {}, () => {});
    return;
  }
  const s = loadSavedGame();
  if (!s) return;
  state.roomCode = s.roomCode || state.roomCode;
  state.players = s.players;
  state.owners = s.owners || {};
  state.houses = s.houses || {};
  state.mortgaged = s.mortgaged || {};
  state.pool = s.pool || 0;
  state.turnIndex = s.turnIndex || 0;
  state.dice = s.dice || [3, 5];
  state.settings = Object.assign({}, state.settings, s.settings);
  state.log = s.log || [];
  state.messages = s.messages || [];
  state.phase = "playing";
  state.busy = false;
  state.turnStage = "roll";
  state.highlight = null;
  state.selectedTile = null;
  state.offers = [];
  showView("game");
  renderAll();
  scheduleBot();
}

/* ============================================================
   9. ROUTING + EVENTS
   ============================================================ */
function showView(name) {
  $("#view-home").classList.toggle("is-hidden", name !== "home");
  $("#view-game").classList.toggle("is-hidden", name !== "game");
  $("#view-profile").classList.toggle("is-hidden", name !== "profile");
  window.scrollTo(0, 0);
  syncSurfaceA11y();
}

function syncServerAppearance() {
  if (!state.live) return;
  const meta = getAppearanceMeta(state.appearance);
  emitServer("set-player-appearance", {
    nickname: state.alias.trim() || meta.baseName,
    color: meta.color,
  }, (response) => {
    if (response?.success === false) {
      say(response.error || "Appearance could not be updated.");
      renderChat();
    }
  });
}

function enterParlor(code) {
  if (!requireGuestAlias()) return;
  const requestedCode = String(code || "").trim().toUpperCase();
  state.suppressRoomUpdates = false;
  state.roomCode = requestedCode;
  state.phase = "setup";
  // always start the setup/lobby screens from a clean board — otherwise a
  // finished game's deed ownership, houses and token positions would still
  // be visible behind the setup overlay after going home and rejoining.
  state.players = buildPlayers(state.appearance, state.alias);
  state.owners = {};
  state.houses = {};
  state.pool = 0;
  state.turnIndex = 0;
  state.dice = [3, 5];
  state.rolling = false;
  state.busy = false;
  state.turnStage = "roll";
  state.highlight = null;
  state.selectedTile = null;
  state.tradeWith = null;
  state.profileDraft = null;
  state.pendingBuyTile = null;
  state.auction = null;
  state.mortgaged = {};
  state.offers = [];
  state.deedDetail = null;
  clearInterval(auctionTimer);
  clearSave();
  closeAllSurfaces();
  state.log = ["WAITING FOR GAME — CHOOSE YOUR APPEARANCE."];
  showView("game");
  renderAll();
  focusSurface("#setup-wrap", "#su-start");
  requestAnimationFrame(() => placePieces());

  if (state.live) {
    const meta = getAppearanceMeta(state.appearance);
    const event = requestedCode ? "join-room" : "create-room";
    emitServer(event, {
      roomCode: requestedCode || undefined,
      nickname: state.alias.trim() || meta.baseName,
      color: meta.color,
      ...(event === "create-room" && state.pendingRoomMeta ? state.pendingRoomMeta : {}),
    }, (response) => {
      if (response?.success === false) {
        say(response.error || "Room could not be entered.");
        state.phase = "home";
        showView("home");
        renderAll();
        return;
      }
      state.roomCode = response?.roomCode || state.roomCode;
      state.phase = "setup";
      renderAll();
      renderTopNav();
      syncServerAppearance();
      if (state.pendingRoomSettings) {
        Object.entries(state.pendingRoomSettings).forEach(([key, value]) => updateServerSetting(key, value));
        state.pendingRoomSettings = null;
      }
      state.pendingRoomMeta = null;
    });
  }
}

function enterLobby() {
  // called from the setup overlay "Enter Parlor" button
  if (!requireGuestAlias()) return;
  if (state.live) {
    syncServerAppearance();
    state.phase = "lobby";
    renderAll();
    requestAnimationFrame(() => placePieces());
    return;
  }
  state.players = buildPlayers(state.appearance, state.alias);
  state.phase = "lobby";
  renderAll();
  requestAnimationFrame(() => placePieces());
}

function goHome() {
  clearTimeout(botTimer);
  clearInterval(auctionTimer);
  state.busy = false;
  state.rolling = false;
  state.turnStage = "roll";
  state.selectedTile = null;
  state.highlight = null;
  state.tradeWith = null;
  state.profileDraft = null;
  state.pendingBuyTile = null;
  state.auction = null;
  state.offers = [];
  state.deedDetail = null;
  state.jail = {};
  state.card = null;
  state.gameOver = null;
  clearInterval(turnTimerInterval);
  turnTimerInterval = null;
  state.phase = "home";
  state.suppressRoomUpdates = true;
  closeAllSurfaces();
  $("#log-drawer").classList.remove("is-open");
  $("#view-game").classList.remove("is-focus");
  closeRoomsModal();
  // reset right rail visibility to game mode
  $("#right-rail-game").classList.remove("is-hidden");
  $("#right-rail-lobby").classList.add("is-hidden");
  showView("home");
}

function bindEvents() {
  // Home actions are bound to their explicit controls below. Keeping the
  // entry points named avoids accidental duplicate Create/Browse triggers.
  $("#join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!requireGuestAlias()) return;
    closeRoomsModal();
    enterParlor($("#room-join").value.trim() || undefined);
  });
  $("#room-join").addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)));
  $("#home-alias-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#home-alias");
    state.alias = saveGuestAlias(input?.value || "");
    renderGuestAliasField(state.alias ? "" : "CREATE AN ALIAS BEFORE JOINING A TABLE.");
    if (state.alias) $("#room-join")?.focus({ preventScroll: true });
  });
  $("#home-alias")?.addEventListener("input", (e) => {
    state.alias = String(e.target.value || "").toUpperCase().replace(/[^A-Z0-9 _-]/g, "").slice(0, 12);
    e.target.value = state.alias;
    saveGuestAlias(state.alias);
    renderGuestAliasField("");
    applyProfileToHomeUI();
  });

  // rooms browser & creator
  $("#browse-rooms-btn")?.addEventListener("click", () => openRoomsModal("browse"));
  $("#open-rooms-btn")?.addEventListener("click", () => openRoomsModal("browse"));
  $("#create-room-btn")?.addEventListener("click", () => openRoomsModal("create"));
  $("#open-create-btn")?.addEventListener("click", () => openRoomsModal("create"));
  $("#rooms-close")?.addEventListener("click", closeRoomsModal);
  $("#rooms-scrim")?.addEventListener("click", closeRoomsModal);

  // modal tab switching
  $("#rm-tabs")?.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-rm-tab]");
    if (!tabBtn) return;
    switchRoomModalTab(tabBtn.dataset.rmTab);
  });
  $("#rooms-host-btn")?.addEventListener("click", () => switchRoomModalTab("create"));

  // rooms directory list interactions
  $("#rooms-list")?.addEventListener("click", (e) => {
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      try { navigator.clipboard?.writeText(copyBtn.dataset.copy); } catch { /* no clipboard */ }
      copyBtn.querySelector("span").textContent = "COPIED";
      setTimeout(() => { copyBtn.querySelector("span").textContent = "COPY"; }, 900);
      return;
    }
    const btn = e.target.closest("[data-join]");
    if (btn && !btn.disabled) {
      closeRoomsModal();
      enterParlor(btn.dataset.join);
    }
  });

  document.querySelectorAll(".rooms-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      roomsFilter = btn.dataset.filter || "all";
      renderRoomsList();
    });
  });

  // room creation form interactions
  $("#rc-vis-selector")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-vis]");
    if (!btn) return;
    const vis = btn.dataset.vis;
    if (createRoomSettings.visibility !== vis) {
      createRoomSettings.visibility = vis;
      createRoomSettings.code = "";
      updateCreateRoomUI();
    }
  });

  $("#rc-room-code")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    createRoomSettings.code = e.target.value;
    updateCreateRoomUI();
  });

  $("#rc-create-btn")?.addEventListener("click", () => {
    const nameInput = $("#rc-name");
    const name = (nameInput?.value || "").trim().toUpperCase().slice(0, 18) || "AFTER HOURS #12";
    const vis = createRoomSettings.visibility;
    const code = createRoomSettings.code || "";
    if (!state.account?.account && !String(state.alias || "").trim()) {
      closeRoomsModal();
      requireGuestAlias();
      return;
    }
    if (vis === "private" && !/^[A-Z0-9]{6}$/.test(code)) {
      updateCreateRoomUI();
      $("#rc-room-code")?.focus();
      return;
    }

    if (state.live) {
      state.alias = (state.account?.account?.displayName || state.alias || state.profiles[0]?.name || "").slice(0, 12);
      state.pendingRoomMeta = {
        roomName: name,
        visibility: vis,
        ...(vis === "private" ? { roomCode: code } : {}),
      };
      closeRoomsModal();
      // The backend generates the authoritative room code; the ZIP's local
      // preview code remains a visual hint until the room is created.
      enterParlor();
      return;
    }

    // if public, register into public directory list
    if (vis === "public") {
      roomsDirectory.unshift({
        code,
        name,
        seats: 1,
        cap: 4,
        bank: "$1,500",
        state: "open",
        note: "fresh table · public",
        visibility: "public",
      });
    }

    closeRoomsModal();
    enterParlor(code);
    record(`ROOM ${code} (${vis.toUpperCase()}) HOSTED — ${name}`);
  });

  // resume round
  $("#resume-btn")?.addEventListener("click", () => resumeGame());

  // log drawer
  const renderDrawer = () => {
    const filtered = state.log.filter((l) => matchesLogFilter(l, drawerFilter));
    $("#drawer-body").innerHTML = filtered.length
      ? filtered.map((l, i) => `<p class="t-body log-line"><span class="log-n">${String(filtered.length - i).padStart(2, "0")} </span>${esc(l)}</p>`).join("")
      : `<p class="t-body ink-3">NO ${drawerFilter.toUpperCase()} ENTRIES.</p>`;
    $("#drawer-count").textContent = `${filtered.length} ENTRIES`;
    document.querySelectorAll(".drawer-filter").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.logfilter === drawerFilter));
  };
  function matchesLogFilter(line, filter) {
    if (filter === "all") return true;
    if (filter === "cash") return /\$|BOUGHT|RENT|PAID|COLLECT|TAX|CASH/i.test(line);
    if (filter === "trade") return /TRADE|OFFER|TRADED|DECLIN|ACCEPT/i.test(line);
    if (filter === "auction") return /AUCTION|BID|WON|UNSOLD/i.test(line);
    if (filter === "property") return /BOUGHT|MORTGAG|BUILT|HOUSE|HOTEL|DEED|WENT BANKRUPT/i.test(line);
    return true;
  }
  const toggleDrawer = () => {
    const d = $("#log-drawer");
    d.classList.toggle("is-open");
    const open = d.classList.contains("is-open");
    d.setAttribute("aria-hidden", String(!open));
    if (open) { renderDrawer(); focusSurface("#log-drawer"); }
  };
  $("#log-toggle-btn")?.addEventListener("click", toggleDrawer);
  $("#drawer-close")?.addEventListener("click", () => {
    const d = $("#log-drawer");
    d.classList.remove("is-open");
    d.setAttribute("aria-hidden", "true");
  });
  document.querySelectorAll(".drawer-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      drawerFilter = btn.dataset.logfilter || "all";
      if ($("#log-drawer").classList.contains("is-open")) renderDrawer();
    });
  });

  // focus / mobile board mode
  $("#focus-btn")?.addEventListener("click", () => $("#view-game").classList.toggle("is-focus"));
  $("#panels-btn")?.addEventListener("click", () => $(".rail-left")?.classList.toggle("is-open"));

  // open the deed / house manager from a MY DEEDS card
  $("#rr-body")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-buy]") || e.target.closest("[data-trade]")) return;
    const card = e.target.closest("[data-deed-open]");
    if (card) openDeedDetail(Number(card.dataset.deedOpen));
  });
  $("#deed-scrim")?.addEventListener("click", closeDeedDetail);

  // trade offer inbox
  $("#offer-scrim")?.addEventListener("click", rejectOpenOffer);

  // profile editor — entry points
  const openActiveProfileForEdit = () => {
    const activeId = typeof state.appearance === "string" ? state.appearance : null;
    openProfileEditor("home", activeId);
  };
  $("#open-profile-btn")?.addEventListener("click", openActiveProfileForEdit);
  $("#chair-edit-btn")?.addEventListener("click", () => {
    const activeId = typeof state.appearance === "string" ? state.appearance : null;
    openProfileEditor("home", activeId);
  });
  $("#pl-new-btn")?.addEventListener("click", () => {
    if (state.profiles.length >= MAX_PROFILES) {
      alert(`You can only save up to ${MAX_PROFILES} custom designs. Delete one to make room.`);
      return;
    }
    openProfileEditor("home");
  });
  $("#pl-list")?.addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-profile-edit]");
    if (editBtn) { e.stopPropagation(); openProfileEditor("home", editBtn.dataset.profileEdit); return; }
    const tile = e.target.closest("[data-profile-select]");
    if (tile) {
      const p = getProfileById(tile.dataset.profileSelect);
      if (p) {
        state.appearance = p.id;
        state.alias = p.name;
        applyProfileToHomeUI();
        renderProfileLibrary();
      }
    }
  });
  $("#account-register-btn")?.addEventListener("click", () => openAccountModal("register"));
  $("#account-login-btn")?.addEventListener("click", () => openAccountModal("login"));
  $("#account-logout-btn")?.addEventListener("click", logoutAccount);
  $("#account-scrim")?.addEventListener("click", closeAccountModal);

  // profile editor — delete
  $("#profile-delete-btn")?.addEventListener("click", () => {
    if (!state.editingProfileId) return;
    const p = getProfileById(state.editingProfileId);
    if (!p) return;
    if (confirm(`Delete profile "${p.name}"? This can't be undone.`)) deleteCurrentProfile();
  });

  // profile editor — identity
  $("#profile-name")?.addEventListener("input", (e) => {
    state.profileDraft.name = e.target.value.toUpperCase().slice(0, 12);
    updateProfilePreview();
  });
  $("#profile-swatches")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-color]");
    if (!btn) return;
    state.profileDraft.color = btn.dataset.color;
    renderProfileEditor();
  });
  $("#profile-color-picker")?.addEventListener("input", (e) => {
    state.profileDraft.color = e.target.value;
    renderProfileEditor();
  });

  // profile editor — face canvas painting (click + drag)
  let isPainting = false;
  const faceCanvasEl = $("#face-canvas");
  faceCanvasEl?.addEventListener("mousedown", (e) => {
    const cell = e.target.closest(".face-cell");
    if (!cell) return;
    isPainting = true;
    paintFaceCell(Number(cell.dataset.x), Number(cell.dataset.y));
  });
  faceCanvasEl?.addEventListener("mouseover", (e) => {
    if (!isPainting) return;
    const cell = e.target.closest(".face-cell");
    if (!cell) return;
    paintFaceCell(Number(cell.dataset.x), Number(cell.dataset.y));
  });
  window.addEventListener("mouseup", () => { isPainting = false; });
  faceCanvasEl?.addEventListener("dragstart", (e) => e.preventDefault());

  // profile editor — ink palette + tools
  $("#face-palette")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ink]");
    if (!btn) return;
    state.profileDraft.tool = "paint";
    state.profileDraft.paintColor = btn.dataset.ink;
    renderProfileEditor();
  });
  $("#face-color-picker")?.addEventListener("input", (e) => {
    state.profileDraft.tool = "paint";
    state.profileDraft.paintColor = e.target.value;
    renderProfileEditor();
  });
  $("#face-tool-paint")?.addEventListener("click", () => {
    state.profileDraft.tool = "paint";
    renderProfileEditor();
  });
  $("#face-tool-erase")?.addEventListener("click", () => {
    state.profileDraft.tool = "erase";
    renderProfileEditor();
  });
  $("#face-clear-btn")?.addEventListener("click", () => {
    state.profileDraft.grid = emptyFaceGrid();
    renderProfileEditor();
  });
  $("#face-default-btn")?.addEventListener("click", () => {
    state.profileDraft.grid = faceGridFromPreset(0, state.profileDraft.color);
    renderProfileEditor();
  });

  // profile editor — save / cancel / back
  $("#profile-save-btn")?.addEventListener("click", () => closeProfileEditor(true));
  $("#profile-cancel-btn")?.addEventListener("click", () => closeProfileEditor(false));
  $("#profile-back-btn")?.addEventListener("click", () => closeProfileEditor(false));

  // sound toggle
  const syncSoundBtn = () => {
    const label = $("#sound-toggle-label");
    if (label) label.textContent = state.sound ? "SOUND ON" : "SOUND OFF";
  };
  syncSoundBtn();
  $("#sound-toggle-btn")?.addEventListener("click", () => {
    state.sound = !state.sound;
    if (state.sound) playSound("trade");
    syncSoundBtn();
  });

  // quick table: starts a default-rules round immediately
  $("#quick-table-btn")?.addEventListener("click", () => {
    if (!requireGuestAlias()) return;
    state.quickJoin = true;
    state.settings.vacationPool = true;
    state.settings.trading = true;
    state.settings.auction = false;
    if (state.live) {
      state.pendingRoomSettings = { vacationPool: true, trading: true, auction: false };
      enterParlor();
      return;
    }
    state.roomCode = "Q-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    enterParlor(state.roomCode);
  });

  // game → home
  $("#brand-home").addEventListener("click", goHome);

  // setup overlay
  $("#su-tabs")?.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-su-tab]");
    if (!tabBtn) return;
    state.setupTab = tabBtn.dataset.suTab;
    renderSetup();
  });
  $("#su-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-app]");
    if (!btn) return;
    const raw = btn.dataset.app;
    // preset appearance = "0".."3"; custom profile ids look like "pf_xxxx"
    state.appearance = /^\d+$/.test(raw) ? Number(raw) : raw;
    const meta = getAppearanceMeta(state.appearance);
    if (!state.account?.account && typeof state.appearance === "string") {
      state.alias = meta.baseName;
      saveGuestAlias(state.alias);
    }
    renderSetup();
    renderLobbyRail();
  });
  $("#su-start").addEventListener("click", enterLobby);

  // lobby settings interactions
  $("#lobby-settings-body").addEventListener("click", (e) => {
    // toggle buttons
    const togBtn = e.target.closest("[data-setting]");
    if (togBtn && togBtn.classList.contains("tog")) {
      const key = togBtn.dataset.setting;
      state.settings[key] = !state.settings[key];
      if (state.live) updateServerSetting(key, state.settings[key]);
      renderLobbyRail();
      return;
    }
    // stepper buttons
    const stepBtn = e.target.closest("[data-step]");
    if (stepBtn && !stepBtn.disabled) {
      const key = stepBtn.dataset.step;
      const dir = Number(stepBtn.dataset.dir);
      const limits = { maxPlayers: [2, 4] };
      const [mn, mx] = limits[key] || [0, 999];
      state.settings[key] = clamp((Number(state.settings[key]) || 0) + dir, mn, mx);
      if (state.live) updateServerSetting(key, state.settings[key]);
      renderLobbyRail();
      return;
    }
  });
  $("#lobby-settings-body").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-setting]");
    if (sel && sel.tagName === "SELECT") {
      const key = sel.dataset.setting;
      const numericKeys = ["startingCash", "houseLimit", "hotelLimit", "turnTimer"];
      state.settings[key] = numericKeys.includes(key) ? Number(sel.value) : sel.value;
      if (state.live) updateServerSetting(key, state.settings[key]);
      renderLobbyRail();
    }
  });

  // lobby start round
  $("#lobby-start-btn").addEventListener("click", startGame);
  $("#pay-jail-fine")?.addEventListener("click", () => {
    if (!state.live) return;
    emitServer("pay-jail-fine", {}, (response) => {
      if (response?.success === false) {
        say(response.error || "The jail fine could not be paid.");
        renderChat();
      }
    });
  });

  // chat
  $("#chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    if (state.live) {
      emitServer("send-chat", { text }, (response) => {
        if (response?.success === false) {
          say(response.error || "Message could not be sent.");
          renderChat();
        }
      });
      return;
    }
    say(text, state.players[0]);
    renderChat();
  });

  // keep tokens glued to tiles when the board resizes
  if (window.ResizeObserver) {
    const frame = $("#board-frame");
    if (frame) new ResizeObserver(() => placePieces()).observe(frame);
  }
  window.addEventListener("resize", () => placePieces());

  // the main arcade button rolls first, then ends the resolved turn
  $("#roll-btn").addEventListener("click", primaryTurnAction);

  // tabs
  $("#tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    state.tab = tab.dataset.tab;
    renderRightRail();
  });

  // deeds tab: buy a vacant tile directly (kept for any future action buttons)
  // trade tab: open a trade with another player
  $("#rr-body").addEventListener("click", (e) => {
    const buyBtn = e.target.closest("[data-buy]");
    if (buyBtn && !buyBtn.disabled) { buyTile(TILES[Number(buyBtn.dataset.buy)]); return; }
    const tradeBtn = e.target.closest("[data-trade]");
    if (tradeBtn && !tradeBtn.disabled) openTradeModal(tradeBtn.dataset.trade);
  });

  // popup
  $("#popup-scrim").addEventListener("click", closePopup);
  $("#trade-scrim").addEventListener("click", closeTradeModal);
  $("#card-scrim").addEventListener("click", () => {
    state.card = null;
    closeSurface("#card-modal");
  });

  // keyboard
  window.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    const activeSurface = syncSurfaceA11y();
    if (e.key === "Tab" && activeSurface) {
      const focusables = surfaceFocusable(activeSurface);
      if (!focusables.length) {
        e.preventDefault();
      } else {
        const current = document.activeElement;
        const index = focusables.indexOf(current);
        const next = e.shiftKey
          ? focusables[index <= 0 ? focusables.length - 1 : index - 1]
          : focusables[index === focusables.length - 1 ? 0 : index + 1];
        e.preventDefault();
        next.focus({ preventScroll: true });
      }
      return;
    }
    if (state.phase === "setup" && e.key === "Escape") {
      e.preventDefault();
      goHome();
      return;
    }
    const roomsOpen = !$("#rooms-modal").classList.contains("is-hidden");
    const accountOpen = !$("#account-modal").classList.contains("is-hidden");
    if (accountOpen) { if (e.key === "Escape") closeAccountModal(); return; }
    const choiceOpen = !$("#choice-modal").classList.contains("is-hidden");
    // auction modal is always locked
    if (state.auction) {
      if (e.key === "Escape") e.preventDefault();
      return;
    }
    // choice modal: locked in auction mode, dismissible in normal mode
    if (state.pendingBuyTile != null && state.settings.auction) {
      if (e.key === "Escape") e.preventDefault();
      return;
    }
    if (state.pendingBuyTile != null && !state.settings.auction && e.key === "Escape") {
      closeChoiceModalAsPass();
      return;
    }
    if (state.pendingBuyTile != null && !state.settings.auction && choiceOpen) return;
    if (roomsOpen) { if (e.key === "Escape") closeRoomsModal(); return; }
    if (state.profileDraft) { if (e.key === "Escape") closeProfileEditor(false); return; }
    const offerOpen = !$("#offer-modal").classList.contains("is-hidden");
    if (offerOpen) { if (e.key === "Escape") rejectOpenOffer(); return; }
    if (!state.card && !$("#card-modal").classList.contains("is-hidden")) {
      if (e.key === "Escape") { state.card = null; closeSurface("#card-modal"); }
      return;
    }
    if (state.gameOver || !$("#gameover-modal").classList.contains("is-hidden")) {
      if (e.key === "Escape") e.preventDefault();
      return;
    }
    if (state.deedDetail != null) { if (e.key === "Escape") closeDeedDetail(); return; }
    if (state.tradeWith) { if (e.key === "Escape") closeTradeModal(); return; }
    if (state.selectedTile) { if (e.key === "Escape") closePopup(); return; }
    if (e.key === "Escape" && $("#log-drawer").classList.contains("is-open")) {
      $("#log-drawer").classList.remove("is-open");
      $("#log-drawer").setAttribute("aria-hidden", "true");
      return;
    }
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (state.phase === "home" && e.key.toLowerCase() === "b") {
      e.preventDefault();
      openRoomsModal("browse");
      return;
    }
    if (state.phase === "home" && e.key.toLowerCase() === "c") {
      e.preventDefault();
      openRoomsModal("create");
      return;
    }
    if (state.phase === "home" && e.key.toLowerCase() === "p") {
      e.preventDefault();
      openProfileEditor("home");
      return;
    }
    if (state.phase === "home" && e.key.toLowerCase() === "j") {
      e.preventDefault();
      $("#room-join")?.focus();
      return;
    }
    if (e.key.toLowerCase() === "l") {
      e.preventDefault();
      const d = $("#log-drawer");
      d.classList.toggle("is-open");
      d.setAttribute("aria-hidden", String(!d.classList.contains("is-open")));
      if (d.classList.contains("is-open")) renderDrawer();
      return;
    }
    if (e.code === "Space" || e.key.toLowerCase() === "r") {
      if (state.phase !== "playing") return;
      e.preventDefault();
      primaryTurnAction();
    }
  });
}

/* ============================================================
   10. INIT
   ============================================================ */
renderHome();
buildBoard();
hydrateSprites();
bindEvents();
renderAll();
showView("home");
