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
  red: "#87231e",
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
  brown:   { base: 2,   rents: [2,  10,  30,  90, 160, 250], housePrice: 50 },
  cyan:    { base: 4,   rents: [4,  20,  60, 180, 320, 450], housePrice: 50 },
  magenta: { base: 6,   rents: [6,  30,  90, 270, 400, 550], housePrice: 50 },
  red:     { base: 8,   rents: [8,  40, 100, 300, 450, 600], housePrice: 100 },
  green:   { base: 10,  rents: [10, 50, 150, 450, 625, 750], housePrice: 100 },
  blue:    { base: 12,  rents: [12, 60, 180, 500, 700, 900], housePrice: 150 },
  railroad:{ base: 25,  rents: [25, 50, 100, 200],             housePrice: 0 },
  utility: { base: 12,  rents: [12, 24,  48,  72],              housePrice: 0 },
};

const MAX_HOUSES = 4;        // 1..4 houses allowed
const HOTEL_LEVEL = 5;       // 5 = hotel (replaces 4 houses)
const GROUP_TARGETS = { brown: 2, cyan: 3, magenta: 3, red: 3, green: 3, blue: 2 };

const t = (i, name, kind, col, row, side, extra = {}) => ({ i, name, kind, col, row, side, ...extra });

const TILES = [
  t(0, "GO", "corner-go", 10, 8, "bottom"),
  t(1, "CHEST", "chest", 9, 8, "bottom"),
  t(2, "STATES AVENUE", "property", 8, 8, "bottom", { price: 140, rent: 10, group: "cyan" }),
  t(3, "ST. CHARLES PLACE", "property", 7, 8, "bottom", { price: 140, rent: 10, group: "cyan" }),
  t(4, "READING RAILROAD", "railroad", 6, 8, "bottom", { price: 200, rent: 25 }),
  t(5, "ORIENTAL AVENUE", "property", 5, 8, "bottom", { price: 100, rent: 6, group: "cyan" }),
  t(6, "CHANCE", "chance", 4, 8, "bottom"),
  t(7, "VERMONT AVENUE", "property", 3, 8, "bottom", { price: 100, rent: 6, group: "cyan" }),
  t(8, "CONNECTICUT AVENUE", "property", 2, 8, "bottom", { price: 120, rent: 8, group: "cyan" }),
  t(9, "JUST VISITING", "corner-jail", 1, 8, "bottom"),
  t(10, "BALTIC STREET", "property", 1, 7, "left", { price: 180, rent: 14, group: "green" }),
  t(11, "WATER WORKS", "utility", 1, 6, "left", { price: 150, rent: 12 }),
  t(12, "UNION SQUARE", "property", 1, 5, "left", { price: 180, rent: 14, group: "cyan" }),
  t(13, "CEDAR AVENUE", "property", 1, 4, "left", { price: 200, rent: 16, group: "cyan" }),
  t(14, "CHEST", "chest", 1, 3, "left"),
  t(15, "ELM STREET", "property", 1, 2, "left", { price: 200, rent: 16, group: "magenta" }),
  t(16, "FREE PARKING", "corner-parking", 1, 1, "top"),
  t(17, "VINE STREET", "property", 2, 1, "top", { price: 220, rent: 18, group: "brown" }),
  t(18, "MILLER AVENUE", "property", 3, 1, "top", { price: 220, rent: 18, group: "brown" }),
  t(19, "BREWERY WAY", "property", 4, 1, "top", { price: 240, rent: 20, group: "brown" }),
  t(20, "INCOME TAX", "tax", 5, 1, "top", { price: 200 }),
  t(21, "OAK BOULEVARD", "property", 6, 1, "top", { price: 260, rent: 22, group: "magenta" }),
  t(22, "MAPLE DRIVE", "property", 7, 1, "top", { price: 260, rent: 22, group: "magenta" }),
  t(23, "CHANCE", "chance", 8, 1, "top"),
  t(24, "PINE ROAD", "property", 9, 1, "top", { price: 280, rent: 24, group: "magenta" }),
  t(25, "GO TO VACATION", "corner-vacation", 10, 1, "top"),
  t(26, "SUNSET BOULEVARD", "property", 10, 2, "right", { price: 300, rent: 26, group: "red" }),
  t(27, "CHEST", "chest", 10, 3, "right"),
  t(28, "WILLOW LANE", "property", 10, 4, "right", { price: 300, rent: 26, group: "red" }),
  t(29, "ELECTRIC COMPANY", "utility", 10, 5, "right", { price: 150, rent: 12 }),
  t(30, "CHANCE", "chance", 10, 6, "right"),
  t(31, "RIVER ROAD", "property", 10, 7, "right", { price: 320, rent: 28, group: "blue" }),
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
   PLAYER PROFILE (persisted to this browser)
   ============================================================ */
const PROFILE_KEY = "poorup.profile.v1";

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !/^#[0-9a-f]{6}$/i.test(String(p.color || "")) || !Array.isArray(p.avatarGrid)) return null;
    if (!p.avatarGrid.every((row) => Array.isArray(row))) return null;
    p.name = String(p.name || "PLAYER").toUpperCase().slice(0, 12);
    p.avatarGrid = Array.from({ length: FACE_SIZE }, (_, y) =>
      Array.from({ length: FACE_SIZE }, (_, x) => {
        const v = p.avatarGrid[y]?.[x];
        return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
      }),
    );
    return p;
  } catch {
    return null;
  }
}

function saveProfileToStorage(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable — profile just won't persist across reloads */
  }
}

/** Returns display metadata for a setup-overlay appearance choice.
 *  `choice` is either a numeric index into APPEARANCES or the string "profile". */
function getAppearanceMeta(choice) {
  if (choice === "profile" && state.profile) {
    return {
      label: "CUSTOM",
      baseName: state.profile.name || "PLAYER",
      color: state.profile.color,
      textColor: state.profile.color,
      avatarGrid: state.profile.avatarGrid,
    };
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
  hostId: null,
  serverTiles: [],
  phase: "home", // home | setup | lobby | playing
  roomCode: "7K4-QZ9",
  alias: "MARLOWE",
  appearance: 0,
  profile: loadProfile(), // persisted { name, color, avatarGrid } or null
  profileDraft: null,     // working copy while the profile editor is open
  homeReturnView: "home", // where the profile editor's back button should return to
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

if (state.profile) {
  state.appearance = "profile";
  state.alias = state.profile.name || "PLAYER";
  state.players = buildPlayers("profile", state.alias);
}

localStorage.setItem("poorup-client-id", state.clientId);

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
    callback?.({ success: false, error: "Live connection unavailable." });
    return;
  }
  socket.emit(event, { ...payload, clientId: state.clientId }, callback);
}

function serverTileFor(index) {
  return state.serverTiles.find((tile) => Number(tile.index) === Number(index))
    || state.serverTiles.find((tile) => Number(tile.index) === (Number(index) % TILE_COUNT));
}

function applyServerState(snapshot) {
  if (!snapshot?.room || !snapshot?.game) return;
  const { room, game } = snapshot;
  state.roomCode = room.roomCode || state.roomCode;
  state.hostId = room.hostId || null;
  state.serverTiles = Array.isArray(game.tiles) ? game.tiles : [];
  state.phase = game.started ? "playing" : state.phase === "setup" ? "setup" : "lobby";
  const remotePlayers = Array.isArray(game.players) ? game.players : room.players || [];
  const turnOrder = Array.isArray(game.turnOrder) && game.turnOrder.length ? game.turnOrder : remotePlayers.map((player) => player.id);
  state.players = remotePlayers.map((player) => ({
    id: player.clientId === state.clientId ? "p1" : player.id,
    serverId: player.id,
    clientId: player.clientId,
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
  state.turnStage = game.hasRolled ? "end" : "roll";
  state.busy = false;
  state.rolling = false;
  state.log = (game.feed || []).map((entry) => entry.text).slice(0, 40);
  state.settings = {
    ...state.settings,
    ...(room.settings || {}),
    vacationPool: room.settings?.vacationCash ?? state.settings.vacationPool,
    noRentInJail: room.settings?.noRentWhileInPrison ?? state.settings.noRentInJail,
  };
  state.auction = game.auction ? {
    tileIndex: Number(game.auction.tileIndex),
    bid: Number(game.auction.highestBid) || 0,
    leaderId: state.players.find((player) => player.serverId === game.auction.highestBidderId)?.id || null,
    deadline: Number(game.auction.endsAt) || Date.now() + 5000,
    caps: {},
    passed: {},
  } : null;
  state.pendingBuyTile = game.pendingPurchaseOffer?.tileIndex ?? null;
  showView("game");
  renderAll();
  if (state.auction) {
    renderAuction();
    $("#auction-modal")?.classList.remove("is-hidden");
  } else {
    $("#auction-modal")?.classList.add("is-hidden");
  }
  const meServerId = state.players[0]?.serverId;
  const debt = game.pendingPayment;
  if (debt && debt.playerId === meServerId && $("#bankruptcy-modal")?.classList.contains("is-hidden")) {
    const meIndex = state.players.findIndex((player) => player.serverId === meServerId);
    if (meIndex >= 0) openBankruptcyModal(meIndex, Number(debt.amountRemaining) || 0, debt.creditorId, debt.reason || "This payment is due.");
  } else if (!debt) {
    $("#bankruptcy-modal")?.classList.add("is-hidden");
  }
  requestAnimationFrame(() => placePieces());
}

function updateServerSetting(key, value) {
  state.settings[key] = value;
  const serverKey = SERVER_SETTING_KEYS[key];
  if (serverKey) emitServer("set-setting", { key: serverKey, value }, () => {});
}

if (socket) {
  socket.on("connect", () => emitServer("restore-session", {}, () => {}));
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
  socket.on("disconnect", () => { say("Connection lost. Reconnecting…"); renderChat(); });
  socket.on("connect_error", () => { say("Unable to reach the server. Retrying…"); renderChat(); });
}

const say = (text, who) =>
  state.messages.push(who ? { who: who.name, color: who.textColor, text } : { who: "", color: "", text, system: true });
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

const ROOMS = [
  { code: "7K4-QZ9", name: "AFTER HOURS", seats: 3, cap: 4, bank: "$1,500", state: "live", note: "round 14 · pool on" },
  { code: "M2P-8RB", name: "NIGHT SHIFT", seats: 4, cap: 4, bank: "$2,000", state: "full", note: "rent x2 · full" },
  { code: "V9X-31L", name: "BACK ROOM", seats: 1, cap: 4, bank: "$1,500", state: "open", note: "waiting · no clock" },
  { code: "XQ4-77A", name: "HOUSE RULES", seats: 2, cap: 4, bank: "$3,000", state: "live", note: "round 3 · auction on" },
  { code: "P0L-A12", name: "LOW STAKES", seats: 0, cap: 4, bank: "$1,000", state: "open", note: "fresh table" },
  { code: "K9M-44B", name: "MIDNIGHT RUN", seats: 3, cap: 4, bank: "$2,000", state: "live", note: "timer 60s" },
];

let roomsFilter = "all";

function roomStateColor(stateName) {
  if (stateName === "live") return "#35a653";
  if (stateName === "full") return "#d9a62f";
  return "#3a382a";
}

function filteredRooms() {
  if (roomsFilter === "open") return ROOMS.filter((r) => r.seats < r.cap);
  if (roomsFilter === "live") return ROOMS.filter((r) => r.state === "live");
  return ROOMS;
}

function roomRowHTML(r) {
  const full = r.seats >= r.cap;
  const open = r.cap - r.seats;
  return `<div class="room-row">
    <div class="room-main">
      <div class="room-top">
        <span class="t-label f12 room-code">${r.code}</span>
        <span class="t-label f13 room-name">${r.name}</span>
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
      <div class="room-actions">
        <button class="btn-dark" data-join="${r.code}" ${full ? "disabled" : ""}>
          <span class="t-label f11">${full ? "FULL" : "JOIN"}</span>
        </button>
        <button class="btn-dark" data-copy="${r.code}" title="Copy code">
          <span class="t-label f11">COPY</span>
        </button>
      </div>
    </div>
  </div>`;
}

function renderRoomsList() {
  const list = $("#rooms-list");
  if (!list) return;
  const rooms = filteredRooms();
  list.innerHTML = rooms.length
    ? rooms.map(roomRowHTML).join("")
    : `<div class="rooms-empty t-body">NO ROOMS MATCH THIS FILTER.</div>`;

  document.querySelectorAll(".rooms-filter").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.filter === roomsFilter);
  });

  const live = ROOMS.filter((r) => r.state === "live").length;
  const openSeats = ROOMS.reduce((sum, r) => sum + Math.max(0, r.cap - r.seats), 0);
  const liveCount = $("#home-live-count");
  const openCount = $("#home-open-seats");
  if (liveCount) liveCount.textContent = String(live);
  if (openCount) openCount.textContent = String(openSeats);
}

function openRoomsModal() {
  roomsFilter = "all";
  renderRoomsList();
  $("#rooms-modal").classList.remove("is-hidden");
}

function closeRoomsModal() {
  $("#rooms-modal").classList.add("is-hidden");
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
  applyProfileToHomeUI();
  hydrateSprites();
}

/** Reflect the saved profile (or the default guest identity) across the home screen. */
function applyProfileToHomeUI() {
  const p = state.profile;
  const name = p?.name || "guest_4412";
  const color = p?.color || "#d74438";

  const homeName = $("#home-you-name");
  if (homeName) homeName.textContent = name;
  const homeAv = $("#home-you-avatar");
  if (homeAv) homeAv.innerHTML = p ? avatarHTML(p, 3, 0) : avatarHTML({ color }, 3, 0);

  const chairName = $("#chair-name");
  if (chairName) chairName.textContent = p ? `that's you, ${name}` : "that's you, guest_4412";
  const chairAv = $("#chair-avatar");
  if (chairAv) chairAv.innerHTML = p ? avatarHTML(p, 4, 0) : avatarHTML({ color }, 4, 0);

  const resumeBtn = $("#resume-btn");
  if (resumeBtn) resumeBtn.classList.toggle("is-hidden", !loadSavedGame());
}

/* ============================================================
   6. GAME RENDERERS
   ============================================================ */
function renderTopNav() {
  $("#tn-room").textContent = state.roomCode || "----";
  $("#tn-lobby").textContent = `AFTER HOURS ${state.roomCode || "----"}`;
  $("#tn-online").textContent = `${state.players.filter((p) => p.online).length} ONLINE`;
  $("#tn-turnlabel").textContent = state.phase === "playing" ? state.players[state.turnIndex].name : state.phase === "lobby" ? "LOBBY" : "SETUP";
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
          <span class="t-micro ink-3">${p.online ? (p.id === "p1" ? "YOU" : "ONLINE") : "AFK"}</span>
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

  const joined = state.live && state.phase !== "home" && state.players.length > 0;
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
  const table = RENT_TABLE[tile.group];
  const refund = Math.floor(table.housePrice / 2);
  state.houses[tile.i] = level - 1;
  addCash("p1", refund);
  record(`YOU SOLD A HOUSE ON ${tile.name} — REFUND $${refund}`);
  renderAll();
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
  const isBuildable = isProperty || tile.kind === "railroad";
  const level = state.houses[tile.i] || 0;
  const rent = rentFor(tile);
  const isMortgaged = !!state.mortgaged[tile.i];
  const rentLabel = isMortgaged ? "MORTGAGED" : `$${rent} / TURN`;
  const mortgageRow = opts.showBuild && state.owners[tile.i] === "p1"
    ? `<div class="deed-build deed-mtg">
        <div class="build-row">
          <span class="t-label f11 ${isMortgaged ? "green" : "g-muted"}">${isMortgaged ? `MORTGAGED +$${mortgageValue(tile)}` : "MORTGAGE"}</span>
          <button class="btn-dark" data-mortgage="${tile.i}"><span class="t-label f11">${isMortgaged ? "UNMORTGAGE" : "MORTGAGE"}</span></button>
        </div>
      </div>`
    : "";
  const buildRow =
    isBuildable && opts.showBuild
      ? `<div class="deed-build">
            <span class="t-micro ink-3">RENT</span>
            <span class="t-label f11 g-muted">${rentLabel}</span>
            ${isProperty ? buildControlsHTML(tile) : buildRailroadHTML(tile)}
         </div>`
      : isBuildable
        ? `<div class="deed-build"><span class="t-micro ink-3">RENT</span><span class="t-label f11 g-muted">${rentLabel}</span></div>`
        : `<div class="deed-build"><span class="t-micro ink-3">RENT</span><span class="t-label f11 g-muted">${tile.rent ?? 0} / TURN</span></div>`;
  return `<div class="deed-card" data-deed="${tile.i}">
    <span class="deed-rail" style="background:${rail}"></span>
    <div class="deed-main">
      <div class="deed-top">
        <span class="t-label deed-name">${tile.name}</span>
        <span class="t-label deed-price">$${tile.price}</span>
      </div>
      <div class="deed-rent">
        <span class="t-micro ink-3">RENT</span>
        <span class="t-label f11 g-muted">${rentLabel}</span>
      </div>
      <div class="deed-rent-scale">
        <span class="t-micro ink-3">WITH</span>
        <span class="houses">${isProperty ? houseDisplay(level) : kindIcon}</span>
      </div>
      ${mortgageRow}
      ${buildRow}
      <div class="deed-foot">
        ${isProperty ? houseDisplay(level) : `<span class="houses">${kindIcon}</span>`}
        ${opts.status ? `<span class="t-micro green">${opts.status}</span>` : ""}
        ${opts.action ? `<button class="btn-dark" data-buy="${tile.i}" ${opts.disabled ? "disabled" : ""}><span class="t-label f11">${opts.action}</span></button>` : ""}
      </div>
    </div>
  </div>`;
}

function buildControlsHTML(tile) {
  const me = state.players[0];
  const owned = state.owners[tile.i] === "p1";
  if (!owned) return "";
  const level = state.houses[tile.i] || 0;
  const hasMonopoly = ownsFullGroup("p1", tile.group);
  const table = RENT_TABLE[tile.group];
  const price = table.housePrice;
  const nextLevel = level + 1;
  const bankHasPiece =
    nextLevel === HOTEL_LEVEL
      ? hotelCount() < state.settings.hotelLimit
      : houseCount() < state.settings.houseLimit;
  const canBuild =
    hasMonopoly &&
    me.cash >= price &&
    level < HOTEL_LEVEL &&
    bankHasPiece &&
    canBuildEvenly(tile, nextLevel);
  if (!hasMonopoly) {
    return `<div class="build-msg"><span class="t-micro ink-3">NEED FULL ${tile.group.toUpperCase()} SET</span></div>`;
  }
  if (level === HOTEL_LEVEL) {
    return `<div class="build-msg"><span class="t-micro g300">FULL HOTEL</span></div>`;
  }
  if (!bankHasPiece) {
    return `<div class="build-msg"><span class="t-micro ink-3">BANK OUT OF ${nextLevel === HOTEL_LEVEL ? "HOTELS" : "HOUSES"}</span></div>`;
  }
  const next = level === 0 ? "BUILD HOUSE" : level === MAX_HOUSES ? "BUILD HOTEL" : "BUILD HOUSE";
  return `<div class="build-row">
    <span class="t-label f11 g-muted">$${price}</span>
    <button class="btn-dark" data-build="${tile.i}" ${canBuild ? "" : "disabled"}>
      <span class="t-label f11">${next}</span>
    </button>
  </div>`;
}

function buildRailroadHTML(tile) {
  const owned = state.owners[tile.i] === "p1";
  if (!owned) return "";
  const ownedRR = TILES.filter((u) => u.kind === "railroad" && state.owners[u.i] === "p1").length;
  return `<div class="build-row">
    <span class="t-label f11 g-muted">${ownedRR} of 4 OWNED</span>
  </div>`;
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
  document.querySelectorAll(".tab").forEach((tb) => tb.classList.toggle("is-active", tb.dataset.tab === state.tab));

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

  const presetTiles = APPEARANCES.map(
    (a, i) => `<button type="button" class="su-opt${i === state.appearance ? " is-active" : ""}" data-app="${i}">
      <div class="su-av">${avatarHTML(a, 5, i)}</div>
      <div>
        <div class="t-label f13" style="color:${a.textColor}">${a.label}</div>
        <div class="t-micro ink-3 su-state">${i === state.appearance ? "SELECTED" : "AVAILABLE"}</div>
      </div>
    </button>`,
  );

  const profileTile = state.profile
    ? `<button type="button" class="su-opt su-opt-profile${state.appearance === "profile" ? " is-active" : ""}" data-app="profile">
        <div class="su-av">${avatarHTML(state.profile, 5, 0)}</div>
        <div>
          <div class="t-label f13" style="color:${state.profile.color}">${esc(state.profile.name || "YOUR PROFILE")}</div>
          <div class="t-micro ink-3 su-state">${state.appearance === "profile" ? "SELECTED" : "YOUR PROFILE"}</div>
        </div>
      </button>`
    : `<button type="button" class="su-opt su-opt-create" id="su-create-profile">
        <div class="su-av su-av-plus">+</div>
        <div>
          <div class="t-label f13 g300">CREATE PROFILE</div>
          <div class="t-micro ink-3">DRAW A CUSTOM FACE</div>
        </div>
      </button>`;

  $("#su-grid").innerHTML = presetTiles.join("") + profileTile;

  const meta = getAppearanceMeta(state.appearance);
  $("#su-alias").value = state.alias;
  $("#su-alias").placeholder = meta.baseName;
  $("#su-room").value = state.roomCode;
  $("#su-bank-room").textContent = `ROOM ${state.roomCode || "----"}`;
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
  if (state.phase === "playing") saveGame();
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

function openProfileEditor(fromPhase) {
  closeRoomsModal();
  state.homeReturnView = fromPhase === "setup" ? "setup-return" : "home";
  const existing = state.profile;
  state.profileDraft = existing
    ? { name: existing.name, color: existing.color, grid: cloneFaceGrid(existing.avatarGrid), tool: "paint", paintColor: existing.color }
    : { name: state.alias || "", color: "#d74438", grid: faceGridFromPreset(0, "#d74438"), tool: "paint", paintColor: "#f0d9ac" };
  renderProfileEditor();
  showView("profile");
}

function closeProfileEditor(save) {
  if (save) {
    const d = state.profileDraft;
    const name = (d.name || "").trim().slice(0, 12).toUpperCase() || "PLAYER";
    const hasInk = d.grid.some((row) => row.some((c) => c));
    const profile = {
      name,
      color: d.color,
      avatarGrid: hasInk ? d.grid : faceGridFromPreset(0, d.color),
    };
    state.profile = profile;
    saveProfileToStorage(profile);
    // if the human had a preset selected, auto-switch to the new profile
    state.appearance = "profile";
    state.alias = name;
  }
  state.profileDraft = null;
  showView(state.homeReturnView === "setup-return" ? "game" : "home");
  if (state.homeReturnView === "setup-return") {
    renderSetup();
    renderLobbyRail();
  } else {
    applyProfileToHomeUI();
  }
}

function renderProfileEditor() {
  const d = state.profileDraft;
  if (!d) return;

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
    railroad: "#9b783d", "corner-vacation": "#78894f", "corner-go": "#d74438",
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
    case "corner-parking": return "Collect the full vacation pool jackpot if any cash has built up there.";
    case "corner-vacation": return "Go on vacation: move to JUST VISITING and add $50 to the vacation pool.";
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
          <h3 class="t-section pop-title">${tile.name}${buildTag}</h3>
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

  $("#popup").classList.remove("is-hidden");
  $("#pop-close").addEventListener("click", closePopup);
  const buyBtn = $("#pop-buy");
  if (buyBtn) buyBtn.addEventListener("click", () => { buyTile(tile); openPopup(tile); });
}

function closePopup() {
  state.selectedTile = null;
  state.highlight = null;
  $("#popup").classList.add("is-hidden");
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
  } else if (tile.kind === "tax") {
    const due = tile.price ?? 200;
    const paid = chargePayment(idx, due, null, `${me.name} PAID $${due} INCOME TAX${state.settings.vacationPool ? " TO THE POOL" : ""}`);
    if (paid && state.settings.vacationPool) state.pool += due;
  } else if (tile.kind === "corner-vacation") {
    me.pos = 9;
    if (state.settings.vacationPool) state.pool += 50;
    record(`${me.name} SENT ON VACATION`);
    say(`${me.name} is off to vacation.${state.settings.vacationPool ? " $50 to the pool." : ""}`);
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
    emitServer("roll-dice", {}, () => {
      state.busy = false;
      state.rolling = false;
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

  const me = state.players[idx];
  const total = a + b;
  say(`${me.name} rolled ${a} + ${b} = ${total}`);
  record(`${me.name} ROLLED ${total}`);
  renderChat();

  let passedGo = false;
  for (let s = 0; s < total; s++) {
    me.pos = (me.pos + 1) % TILE_COUNT;
    if (me.pos === 0) passedGo = true;
    state.highlight = me.pos;
    renderBoardState();
    placePieces({ movingId: me.id, hop: true });
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

  if (state.players[idx].bot) {
    clearTimeout(botTimer);
    botTimer = setTimeout(() => endTurn(idx), 700);
  }
}

let botTimer = null;

function endTurn(idx) {
  if (state.live) {
    if (state.phase !== "playing" || state.turnIndex !== idx || state.busy || state.turnStage !== "end") return;
    emitServer("end-turn", {}, () => {});
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
  state.pendingBuyTile = null;
  state.auction = null;
  clearInterval(auctionTimer);
  clearSave();
  state.phase = "playing";
  $("#trade-modal").classList.add("is-hidden");
  $("#choice-modal").classList.add("is-hidden");
  $("#auction-modal").classList.add("is-hidden");

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
    emitServer("purchase-property", { tileIndex: tile.i }, () => {});
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
          <h3 class="t-section choice-title">${tile.name}</h3>
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

  $("#choice-modal").classList.remove("is-hidden");
  const scrim = $("#choice-scrim");
  if (scrim) {
    scrim.classList.toggle("popup-scrim-locked", auctionMode);
    scrim.onclick = auctionMode ? null : closeChoiceModalAsPass;
  }
  const buyBtn = $("#choice-buy");
  if (buyBtn) buyBtn.addEventListener("click", () => {
    buyTile(tile);
    state.pendingBuyTile = null;
    $("#choice-modal").classList.add("is-hidden");
    afterLandingResolved();
  });

  if (auctionMode) {
    $("#choice-auction").addEventListener("click", () => {
      state.pendingBuyTile = null;
      $("#choice-modal").classList.add("is-hidden");
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
    emitServer("decline-property", { tileIndex: tile.i }, () => {});
    state.pendingBuyTile = null;
    $("#choice-modal").classList.add("is-hidden");
    return;
  }
  if (tile) record(`${me.name} PASSED ON ${tile.name}`);
  state.pendingBuyTile = null;
  $("#choice-modal").classList.add("is-hidden");
  afterLandingResolved();
}

function startAuction(tile) {
  if (state.live) {
    emitServer("decline-property", { tileIndex: tile.i }, () => {});
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
  $("#auction-modal").classList.remove("is-hidden");
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
  updateAuctionLive();
}

function humanBid(inc) {
  const a = state.auction;
  if (!a) return;
  const me = state.players[0];
  if (me.cash < a.bid + inc) return; // can't cover the raise
  if (state.live) {
    emitServer("auction-bid", { amount: a.bid + inc }, () => {});
    return;
  }
  placeBid("p1", inc);
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
  return false;
}

function tickAuction() {
  const a = state.auction;
  if (!a) return;
  const remaining = a.deadline - Date.now();

  // let a bot consider bidding roughly twice a second
  auctionBotClock += 60;
  if (auctionBotClock >= 480) {
    auctionBotClock = 0;
    maybeBotBid();
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
  $("#auction-modal").classList.add("is-hidden");
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
          <h3 class="t-section auction-title">${tile.name}</h3>
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

      <div class="auction-players" id="auction-players"></div>

      <p class="t-micro ink-3 auction-foot">EACH BID RESETS THE 5s CLOCK · LAST BIDDER WINS</p>
    </div>`;

  $("#auction-card").querySelectorAll("[data-bid]").forEach((btn) => {
    btn.addEventListener("click", () => humanBid(Number(btn.dataset.bid)));
  });
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
    bar.style.width = `${pct}%`;
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
          <h2 class="t-section g300">Propose Trade</h2>
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
  $("#trade-modal").classList.remove("is-hidden");
}

function closeTradeModal() {
  state.tradeWith = null;
  $("#trade-modal").classList.add("is-hidden");
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
          <h3 class="t-section offer-title" style="color:${from.textColor}">${esc(from.name)}</h3>
        </div>
      </div>
      <p class="t-body ink-2 offer-rows" style="margin-top:14px">
        ${from.name} will give you <span class="green">$${offer.giveCash.toLocaleString()}</span>
        and wants <span class="g300">${esc(wantNames)}</span>.
      </p>
      <div class="offer-actions">
        <button class="cta-red offer-btn" id="offer-accept"><span class="cta-text cta-text-sm">Accept</span></button>
        <button class="btn-dark offer-btn" id="offer-reject"><span class="t-label f12">Reject</span></button>
      </div>
      <p class="t-micro ink-3 offer-note">Trades only transfer cash or deeds offered here.</p>
    </div>`;
  $("#offer-modal").classList.remove("is-hidden");
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
      $("#offer-modal").classList.add("is-hidden");
      return;
    }
    executeTrade(offer, "accepted");
    $("#offer-modal").classList.add("is-hidden");
  });
  $("#offer-reject").addEventListener("click", rejectOpenOffer);
}

function rejectOpenOffer() {
  const offer = state.offers.shift();
  if (state.live && offer) {
    emitServer("respond-trade", { tradeId: offer.id, accept: false }, () => {});
    $("#offer-modal").classList.add("is-hidden");
    return;
  }
  if (offer) {
    const from = state.players.find((p) => p.id === offer.from || p.serverId === offer.from);
    say(`rejected ${from ? from.name : "the"} offer.`);
  }
  $("#offer-modal").classList.add("is-hidden");
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
    emitServer("declare-bankruptcy", {}, () => {});
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
  $("#bankruptcy-modal").classList.add("is-hidden");
  if (wasHuman) { clearSave(); showGameOver(); return; }
  renderAll();
}

function showGameOver() {
  $("#bankruptcy-card").innerHTML = `
    <div class="bank-body">
      <div class="bank-head">
        <span class="bank-icon">✕</span>
        <div>
          <div class="t-micro g400">BUSTED</div>
          <h3 class="t-section bank-title">You went bankrupt</h3>
        </div>
      </div>
      <p class="t-body ink-2 bank-copy">The table sends its regards. Your deeds passed to the creditor and the round is over.</p>
      <div class="bank-actions">
        <button class="cta-red bank-btn" id="bank-home"><span class="cta-text cta-text-sm">Back to Lobby</span></button>
      </div>
    </div>`;
  $("#bankruptcy-modal").classList.remove("is-hidden");
  $("#bank-home").addEventListener("click", () => { $("#bankruptcy-modal").classList.add("is-hidden"); goHome(); });
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
          <h3 class="t-section bank-title">$${amount} due</h3>
        </div>
      </div>
      <p class="t-body ink-2 bank-copy">${esc(label)}. You're $${amount - p.cash} short. Sell houses and mortgage deeds — or hand everything to ${creditor ? esc(creditor.name) : "the bank"} and bow out.</p>
      <div class="bank-actions">
        <button class="cta-red bank-btn" id="bank-liquidate"><span class="cta-text cta-text-sm">Liquidate & Pay</span></button>
        <button class="btn-dark bank-btn" id="bank-declare"><span class="t-label f12">Declare Bankruptcy</span></button>
      </div>
    </div>`;
  $("#bankruptcy-modal").classList.remove("is-hidden");
  $("#bank-liquidate").addEventListener("click", () => {
    if (state.live) {
      $("#bankruptcy-modal").classList.add("is-hidden");
      say("Use Holdings to sell houses or mortgage deeds, then the debt will settle automatically.");
      renderChat();
      return;
    }
    liquidatePlayer(p.id);
    if (p.cash >= amount) {
      p.cash -= amount;
      if (creditor) creditor.cash += amount;
      record(`YOU PAID $${amount} AFTER LIQUIDATION`);
      $("#bankruptcy-modal").classList.add("is-hidden");
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
  const requestedCode = String(code || "").trim().toUpperCase();
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
  clearInterval(auctionTimer);
  clearSave();
  state.log = ["WAITING FOR GAME — CHOOSE YOUR APPEARANCE."];
  showView("game");
  renderAll();
  requestAnimationFrame(() => placePieces());

  if (state.live) {
    const meta = getAppearanceMeta(state.appearance);
    const event = requestedCode ? "join-room" : "create-room";
    emitServer(event, {
      roomCode: requestedCode || undefined,
      nickname: state.alias.trim() || meta.baseName,
      color: meta.color,
    }, (response) => {
      if (response?.success === false) {
        say(response.error || "Room could not be entered.");
        state.phase = "home";
        showView("home");
        renderAll();
        return;
      }
      state.roomCode = response?.roomCode || state.roomCode;
      // A room creation/join is followed by the appearance setup step. Keep
      // that overlay authoritative until the user explicitly enters the
      // lobby; late update-state packets from a previous room must not skip it.
      state.phase = "setup";
      renderAll();
      renderTopNav();
      syncServerAppearance();
    });
  }
}

function enterLobby() {
  // called from the setup overlay "Enter Parlor" button
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
  state.phase = "home";
  $("#popup").classList.add("is-hidden");
  $("#trade-modal").classList.add("is-hidden");
  $("#choice-modal").classList.add("is-hidden");
  $("#auction-modal").classList.add("is-hidden");
  $("#offer-modal").classList.add("is-hidden");
  $("#bankruptcy-modal").classList.add("is-hidden");
  $("#log-drawer").classList.remove("is-open");
  $("#view-game").classList.remove("is-focus");
  closeRoomsModal();
  // reset right rail visibility to game mode
  $("#right-rail-game").classList.remove("is-hidden");
  $("#right-rail-lobby").classList.add("is-hidden");
  showView("home");
}

function bindEvents() {
  // home → game
  document.querySelectorAll("[data-enter]").forEach((b) => b.addEventListener("click", () => {
    closeRoomsModal();
    enterParlor();
  }));
  $("#join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    closeRoomsModal();
    enterParlor($("#room-join").value.trim() || undefined);
  });
  $("#room-join").addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase().slice(0, 8)));

  // rooms browser
  const openRooms = () => { renderCreateRoom(); openRoomsModal(); };
  $("#browse-rooms-btn")?.addEventListener("click", openRooms);
  $("#open-rooms-btn")?.addEventListener("click", openRooms);
  $("#rooms-close")?.addEventListener("click", closeRoomsModal);
  $("#rooms-scrim")?.addEventListener("click", closeRoomsModal);
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

  // create room panel
  const createRoomSettings = { private: false, spectators: false };
  function syncToggles() {
    [["private", $("#rc-private")], ["spectators", $("#rc-spectators")]].forEach(([key, btn]) => {
      if (!btn) return;
      btn.classList.toggle("is-on", createRoomSettings[key]);
      const lab = btn.querySelector(".tog-label");
      if (lab) lab.textContent = createRoomSettings[key] ? "ON" : "OFF";
    });
  }
  $("#rc-private")?.addEventListener("click", (e) => {
    createRoomSettings.private = !createRoomSettings.private;
    e.currentTarget.classList.toggle("is-on", createRoomSettings.private);
    e.currentTarget.querySelector(".tog-label").textContent = createRoomSettings.private ? "ON" : "OFF";
  });
  $("#rc-spectators")?.addEventListener("click", (e) => {
    createRoomSettings.spectators = !createRoomSettings.spectators;
    e.currentTarget.classList.toggle("is-on", createRoomSettings.spectators);
    e.currentTarget.querySelector(".tog-label").textContent = createRoomSettings.spectators ? "ON" : "OFF";
  });
  function renderCreateRoom() {
    const panel = $("#rooms-create");
    if (!panel) return;
    panel.classList.add("is-hidden");
    const hostBtn = $("#rooms-host");
    if (hostBtn) hostBtn.classList.remove("is-hidden");
    syncToggles();
  }
  function showCreatePanel() {
    $("#rooms-host")?.classList.add("is-hidden");
    $("#rooms-create")?.classList.remove("is-hidden");
    syncToggles();
  }
  $("#rooms-host")?.addEventListener("click", showCreatePanel);
  $("#rc-back")?.addEventListener("click", renderCreateRoom);
  $("#rc-create-btn")?.addEventListener("click", () => {
    const name = ($("#rc-name")?.value || "").toUpperCase().slice(0, 14) || "AFTER HOURS";
    if (state.live) {
      // The live protocol has no room-title field; keep the player's saved
      // identity instead of silently turning the table label into a nickname.
      state.alias = (state.profile?.name || state.alias || "PLAYER").slice(0, 12);
      closeRoomsModal();
      enterParlor();
      return;
    }
    const code = (createRoomSettings.private ? "P" : "R") + Math.random().toString(36).slice(2, 7).toUpperCase();
    closeRoomsModal();
    enterParlor(code);
    record(`ROOM ${code} HOSTED — ${name}`);
  });

  // resume round
  $("#resume-btn")?.addEventListener("click", () => resumeGame());

  // log drawer
  const toggleDrawer = () => {
    const d = $("#log-drawer");
    d.classList.toggle("is-open");
    if (d.classList.contains("is-open")) {
      $("#drawer-body").innerHTML = state.log
        .map((l, i) => `<p class="t-body log-line"><span class="log-n">${String(state.log.length - i).padStart(2, "0")} </span>${esc(l)}</p>`)
        .join("");
      $("#drawer-count").textContent = `${state.log.length} ENTRIES`;
    }
  };
  $("#log-toggle-btn")?.addEventListener("click", toggleDrawer);
  $("#drawer-close")?.addEventListener("click", () => $("#log-drawer").classList.remove("is-open"));

  // focus / mobile board mode
  $("#focus-btn")?.addEventListener("click", () => $("#view-game").classList.toggle("is-focus"));
  $("#panels-btn")?.addEventListener("click", () => $(".rail-left")?.classList.toggle("is-open"));

  // mortgage from deeds
  $("#rr-body")?.addEventListener("click", (e) => {
    const mtg = e.target.closest("[data-mortgage]");
    if (!mtg) return;
    const i = Number(mtg.dataset.mortgage);
    if (state.mortgaged[i]) unmortgageTile(i);
    else mortgageTile(i);
  });

  // trade offer inbox
  $("#offer-scrim")?.addEventListener("click", rejectOpenOffer);

  // profile editor — entry points
  $("#open-profile-btn")?.addEventListener("click", () => openProfileEditor("home"));
  $("#chair-edit-btn")?.addEventListener("click", () => openProfileEditor("home"));

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

  // game → home
  $("#brand-home").addEventListener("click", goHome);

  // setup overlay
  $("#su-grid").addEventListener("click", (e) => {
    const createBtn = e.target.closest("#su-create-profile");
    if (createBtn) {
      openProfileEditor("setup");
      return;
    }
    const btn = e.target.closest("[data-app]");
    if (!btn) return;
    state.appearance = btn.dataset.app === "profile" ? "profile" : Number(btn.dataset.app);
    renderSetup();
    renderLobbyRail();
  });
  $("#su-alias").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().slice(0, 12);
    state.alias = e.target.value;
    renderLobbyRail();
  });
  $("#su-room").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().slice(0, 8);
    state.roomCode = e.target.value;
    $("#su-bank-room").textContent = `ROOM ${state.roomCode || "----"}`;
    renderTopNav();
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
    const buildBtn = e.target.closest("[data-build]");
    if (buildBtn && !buildBtn.disabled) buildNextHouse(TILES[Number(buildBtn.dataset.build)]);
  });

  // popup
  $("#popup-scrim").addEventListener("click", closePopup);
  $("#trade-scrim").addEventListener("click", closeTradeModal);

  // keyboard
  window.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    const roomsOpen = !$("#rooms-modal").classList.contains("is-hidden");
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
    if (state.tradeWith) { if (e.key === "Escape") closeTradeModal(); return; }
    if (state.selectedTile) { if (e.key === "Escape") closePopup(); return; }
    if (e.key === "Escape" && $("#log-drawer").classList.contains("is-open")) {
      $("#log-drawer").classList.remove("is-open");
      return;
    }
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (state.phase === "home" && e.key.toLowerCase() === "b") {
      e.preventDefault();
      openRoomsModal();
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
      $("#log-drawer").classList.toggle("is-open");
      if ($("#log-drawer").classList.contains("is-open")) {
        $("#drawer-body").innerHTML = state.log
          .map((l, i) => `<p class="t-body log-line"><span class="log-n">${String(state.log.length - i).padStart(2, "0")} </span>${esc(l)}</p>`)
          .join("");
        $("#drawer-count").textContent = `${state.log.length} ENTRIES`;
      }
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
