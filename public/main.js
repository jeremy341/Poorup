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
  t(0, "START", "corner-go", 1, 1, "top"),
  t(1, "SALVADOR", "property", 2, 1, "top", { price: 60, rent: 10, group: "brown" }),
  t(2, "TREASURE", "chest", 3, 1, "top"),
  t(3, "RIO", "property", 4, 1, "top", { price: 60, rent: 10, group: "brown" }),
  t(4, "EARNINGS TAX", "tax", 5, 1, "top", { price: 200 }),
  t(5, "ACC AIRPORT", "railroad", 6, 1, "top", { price: 200, rent: 25 }),
  t(6, "ACCRA", "property", 7, 1, "top", { price: 100, rent: 14, group: "cyan" }),
  t(7, "SURPRISE?", "chance", 8, 1, "top"),
  t(8, "TEMA", "property", 9, 1, "top", { price: 100, rent: 14, group: "cyan" }),
  t(9, "KUMASI", "property", 10, 1, "top", { price: 120, rent: 16, group: "cyan" }),
  t(10, "PASSING BY", "corner-jail", 11, 1, "top"),
  t(11, "PATTAYA", "property", 11, 2, "right", { price: 140, rent: 10, group: "magenta" }),
  t(12, "ELECTRIC COMPANY", "utility", 11, 3, "right", { price: 150, rent: 12 }),
  t(13, "CHIANG MAI", "property", 11, 4, "right", { price: 140, rent: 12, group: "magenta" }),
  t(14, "BANGKOK", "property", 11, 5, "right", { price: 160, rent: 14, group: "magenta" }),
  t(15, "BKK AIRPORT", "railroad", 11, 6, "right", { price: 200, rent: 25 }),
  t(16, "KYOTO", "property", 11, 7, "right", { price: 180, rent: 14, group: "orange" }),
  t(17, "TREASURE", "chest", 11, 8, "right"),
  t(18, "OSAKA", "property", 11, 9, "right", { price: 180, rent: 14, group: "orange" }),
  t(19, "TOKYO", "property", 11, 10, "right", { price: 200, rent: 16, group: "orange" }),
  t(20, "VACATION", "corner-vacation", 11, 11, "bottom"),
  t(21, "EINDHOVEN", "property", 10, 11, "bottom", { price: 220, rent: 18, group: "red" }),
  t(22, "SURPRISE?", "chance", 9, 11, "bottom"),
  t(23, "ROTTERDAM", "property", 8, 11, "bottom", { price: 220, rent: 18, group: "red" }),
  t(24, "AMSTERDAM", "property", 7, 11, "bottom", { price: 240, rent: 20, group: "red" }),
  t(25, "AMS AIRPORT", "railroad", 6, 11, "bottom", { price: 200, rent: 25 }),
  t(26, "CALGARY", "property", 5, 11, "bottom", { price: 260, rent: 22, group: "yellow" }),
  t(27, "VANCOUVER", "property", 4, 11, "bottom", { price: 260, rent: 22, group: "yellow" }),
  t(28, "WATER COMPANY", "utility", 3, 11, "bottom", { price: 150, rent: 12 }),
  t(29, "TORONTO", "property", 2, 11, "bottom", { price: 280, rent: 24, group: "yellow" }),
  t(30, "GO TO PRISON", "corner-go-jail", 1, 11, "bottom"),
  t(31, "BERN", "property", 1, 10, "left", { price: 300, rent: 26, group: "green" }),
  t(32, "GENEVA", "property", 1, 9, "left", { price: 300, rent: 26, group: "green" }),
  t(33, "TREASURE", "chest", 1, 8, "left"),
  t(34, "ZURICH", "property", 1, 7, "left", { price: 320, rent: 28, group: "green" }),
  t(35, "MB AIRPORT", "railroad", 1, 6, "left", { price: 200, rent: 25 }),
  t(36, "SURPRISE?", "chance", 1, 5, "left"),
  t(37, "DOWNTOWN", "property", 1, 4, "left", { price: 400, rent: 35, group: "blue" }),
  t(38, "PREMIUM TAX", "tax", 1, 3, "left", { price: 75 }),
  t(39, "MARINA BAY", "property", 1, 2, "left", { price: 400, rent: 50, group: "blue" }),
];
const TILE_COUNT = TILES.length;
const START_TILE_INDEX = 0;
const JAIL_TILE_INDEX = TILES.find((tile) => tile.kind === "corner-jail")?.i ?? 10;

const CHANCE_EVENTS = [
  { text: "ADVANCE TO MARINA BAY", action: "moveTo", tileIndex: 39, cash: 0 },
  { text: "ADVANCE TO START — COLLECT $200", action: "collectStart", cash: 200 },
  { text: "ADVANCE TO AMSTERDAM", action: "moveTo", tileIndex: 24, cash: 0 },
  { text: "ADVANCE TO PATTAYA", action: "moveTo", tileIndex: 11, cash: 0 },
  { text: "ADVANCE TO THE NEXT AIRPORT — PAY DOUBLE RENT IF OWNED", action: "nearestRailroad", cash: 0 },
  { text: "ADVANCE TO THE NEXT AIRPORT — PAY DOUBLE RENT IF OWNED", action: "nearestRailroad", cash: 0 },
  { text: "ADVANCE TO THE NEXT UTILITY", action: "nearestUtility", cash: 0 },
  { text: "BANK DIVIDEND — COLLECT $50", action: "collect", amount: 50, cash: 50 },
  { text: "KEEP THIS CARD UNTIL NEEDED: GET OUT OF PRISON", action: "jailFree", cash: 0 },
  { text: "MOVE BACK THREE SPACES", action: "moveBack", steps: 3, cash: 0 },
  { text: "GO DIRECTLY TO PRISON", action: "goToJail", cash: 0 },
  { text: "BUILDING REPAIRS — PAY $25 PER HOUSE, $100 PER HOTEL", action: "repairs", houseCost: 25, hotelCost: 100, cash: 0 },
  { text: "SPEEDING FINE — PAY $15", action: "pay", amount: 15, cash: -15 },
  { text: "ADVANCE TO ACC AIRPORT", action: "moveTo", tileIndex: 5, cash: 0 },
  { text: "ELECTED CHAIRPERSON — PAY EACH PLAYER $50", action: "payEach", amount: 50, cash: 0 },
  { text: "BUILDING LOAN MATURES — COLLECT $150", action: "collect", amount: 150, cash: 150 },
];
const CHEST_EVENTS = [
  { text: "ADVANCE TO START — COLLECT $200", action: "collectStart", cash: 200 },
  { text: "BANK ERROR — COLLECT $200", action: "collect", amount: 200, cash: 200 },
  { text: "DOCTOR'S FEE — PAY $50", action: "pay", amount: 50, cash: -50 },
  { text: "INVESTMENT SALE — COLLECT $50", action: "collect", amount: 50, cash: 50 },
  { text: "KEEP THIS CARD UNTIL NEEDED: GET OUT OF PRISON", action: "jailFree", cash: 0 },
  { text: "GO DIRECTLY TO PRISON", action: "goToJail", cash: 0 },
  { text: "PARLOR SHOW — COLLECT $50 FROM EACH PLAYER", action: "collectFromEach", amount: 50, cash: 0 },
  { text: "TAX REFUND — COLLECT $20", action: "collect", amount: 20, cash: 20 },
  { text: "INSURANCE MATURES — COLLECT $100", action: "collect", amount: 100, cash: 100 },
  { text: "HOSPITAL FEE — PAY $100", action: "pay", amount: 100, cash: -100 },
  { text: "SCHOOL TAX — PAY $150", action: "pay", amount: 150, cash: -150 },
  { text: "CONSULTING FEE — COLLECT $25", action: "collect", amount: 25, cash: 25 },
  { text: "STREET REPAIRS — PAY $40 PER HOUSE, $115 PER HOTEL", action: "repairs", houseCost: 40, hotelCost: 115, cash: 0 },
  { text: "HOLIDAY FUND MATURES — COLLECT $100", action: "collect", amount: 100, cash: 100 },
  { text: "BEAUTY CONTEST — COLLECT $10", action: "collect", amount: 10, cash: 10 },
  { text: "INHERITANCE — COLLECT $100", action: "collect", amount: 100, cash: 100 },
];

function drawLocalCard(kind) {
  const key = kind === "chance" ? "surpriseDeck" : "treasureDeck";
  const source = kind === "chance" ? CHANCE_EVENTS : CHEST_EVENTS;
  if (!state[key]?.length) state[key] = [...source];
  const deck = state[key];
  return deck.splice(Math.floor(Math.random() * deck.length), 1)[0];
}

const ACHIEVEMENT_STORAGE_KEY = "poorup.achievements.v1";
const ACHIEVEMENTS = [
  { id: "first-deed", category: "visible", title: "FIRST DEED", short: "Buy your first property.", detail: "Purchase any property in a completed server game.", rarity: "COMMON" },
  { id: "full-street", category: "visible", title: "FULL STREET", short: "Complete a country group.", detail: "Own every property in one color group at the same time.", rarity: "UNCOMMON" },
  { id: "even-builder", category: "visible", title: "EVEN BUILDER", short: "Build without breaking the street.", detail: "Build a complete group while following every even-build rule.", rarity: "UNCOMMON" },
  { id: "auction-ghost", category: "visible", title: "AUCTION GHOST", short: "Win below the asking price.", detail: "Win an auction with a final bid below the deed’s listed price.", rarity: "RARE" },
  { id: "clean-exit", category: "visible", title: "CLEAN EXIT", short: "Repay a bank loan early.", detail: "Repay a bank loan in full before its due round.", rarity: "UNCOMMON" },
  { id: "collateral-damage", category: "visible", title: "COLLATERAL DAMAGE", short: "Learn what default costs.", detail: "Default on a bank loan and lose the collateral deed.", rarity: "RARE" },
  { id: "bad-idea-good-timing", category: "visible", title: "BAD IDEA, GOOD TIMING", short: "Borrow from the edge.", detail: "Take emergency bank credit with less than $50 cash and survive the game.", rarity: "RARE" },
  { id: "debt-free", category: "visible", title: "DEBT FREE", short: "Finish with clean books.", detail: "Complete a game with no active bank or player debt.", rarity: "UNCOMMON" },
  { id: "prison-break", category: "visible", title: "PRISON BREAK", short: "Use the card, then win.", detail: "Use a Get Out of Prison card and win the same game.", rarity: "RARE" },
  { id: "council-member", category: "global", title: "COUNCIL MEMBER", short: "Win a table election.", detail: "Cast the deciding vote in a City Election.", rarity: "UNCOMMON" },
  { id: "public-works", category: "global", title: "PUBLIC WORKS", short: "Build through policy.", detail: "Build on the group selected by a Public Works policy.", rarity: "RARE" },
  { id: "crisis-manager", category: "global", title: "CRISIS MANAGER", short: "Keep the table alive.", detail: "End a negative global event without going bankrupt.", rarity: "RARE" },
  { id: "bubble-survivor", category: "secret", title: "BUBBLE SURVIVOR", short: "Keep your deed through the crash.", clue: "A developed street can outlive the headline.", detail: "Own developed property when Housing Bubble Pop ends and keep the deed.", rarity: "EPIC", secret: true },
  { id: "short-the-street", category: "secret", title: "SHORT THE STREET", short: "Sell low, rebuild later.", clue: "Sometimes the best house is the one you sell first.", detail: "Sell a building during Housing Bubble Pop, then rebuild after recovery.", rarity: "EPIC", secret: true },
  { id: "no-floor", category: "secret", title: "NO FLOOR", short: "Survive the double crisis.", clue: "The market can lose its floor without taking your wallet.", detail: "Survive Foreclosure Spiral without taking a second bank loan.", rarity: "LEGENDARY", secret: true },
  { id: "moral-hazard", category: "secret", title: "MORAL HAZARD", short: "Take the rescue money.", clue: "A bailout feels different when you already owe the bank.", detail: "Receive a Bank Run bailout while holding an active loan.", rarity: "EPIC", secret: true },
  { id: "grounded-tourist", category: "secret", title: "GROUNDED TOURIST", short: "Travel without a flight.", clue: "The airport can be closed while the city keeps paying.", detail: "Own an airport during Airport Strike and still collect a non-airport rent.", rarity: "RARE", secret: true },
  { id: "stagflation-trader", category: "secret", title: "STAGFLATION TRADER", short: "Trade through the squeeze.", clue: "Make a deal while cash melts and debt grows.", detail: "Complete a trade during the Stagflation combination.", rarity: "EPIC", secret: true },
  { id: "compromised-council", category: "secret", title: "COMPROMISED COUNCIL", short: "Choose the least-worst policy.", clue: "The vote is not the scandal. The response is.", detail: "Vote in Legitimacy Crisis and choose the policy that ends the audit.", rarity: "LEGENDARY", secret: true },
  { id: "double-headline", category: "secret", title: "DOUBLE HEADLINE", short: "Trigger two crises.", clue: "One headline is luck. Two is a pattern.", detail: "Trigger two eligible global events through separate Surprise rolls in one game.", rarity: "LEGENDARY", secret: true },
  { id: "last-wallet-standing", category: "visible", title: "LAST WALLET STANDING", short: "Be the final player.", detail: "Win a server-authoritative game.", rarity: "COMMON" },
  { id: "no-refunds", category: "visible", title: "NO REFUNDS", short: "Win after the warning.", detail: "Win a game after reaching the bank-loan default warning.", rarity: "RARE" },
  { id: "generous-lender", category: "social", title: "GENEROUS LENDER", short: "Help someone across the gap.", detail: "Give a player loan that is fully repaid.", rarity: "UNCOMMON" },
  { id: "coalition-builder", category: "social", title: "COALITION BUILDER", short: "Turn opposition into leverage.", detail: "Complete a trade with a player you previously voted against.", rarity: "RARE" },
  { id: "unanimous", category: "social", title: "UNANIMOUS", short: "Get the whole table aligned.", detail: "Be part of an election where every active player selects the same policy.", rarity: "RARE" },
  { id: "patrol-rookie", category: "minigame", title: "PATROL ROOKIE", short: "Find your first rhythm.", detail: "Score 10 in Parlor Patrol.", rarity: "COMMON" },
  { id: "patrol-regular", category: "minigame", title: "PATROL REGULAR", short: "Stay on the radio.", detail: "Score 50 in Parlor Patrol.", rarity: "UNCOMMON" },
  { id: "patrol-ace", category: "minigame", title: "PATROL ACE", short: "Beat the street record.", detail: "Beat your saved personal best three times.", rarity: "RARE" },
  { id: "clean-run", category: "minigame", title: "CLEAN RUN", short: "No misses, no excuses.", detail: "Finish a patrol run without missing a target.", rarity: "EPIC" },
  { id: "rent-reaper", category: "visible", title: "RENT REAPER", short: "Collect from three players.", detail: "Collect rent from three different players in one round.", rarity: "RARE" },
  { id: "liquidity-king", category: "visible", title: "LIQUIDITY KING", short: "Own the cash table.", detail: "Finish a game with more cash than every other player combined.", rarity: "EPIC" },
  { id: "fire-sale", category: "global", title: "FIRE SALE", short: "Sell before the floor drops.", detail: "Sell three buildings during one global crisis.", rarity: "RARE" },
  { id: "airport-hopper", category: "visible", title: "AIRPORT HOPPER", short: "Visit every airport.", detail: "Visit all four airports in one game.", rarity: "UNCOMMON" },
  { id: "tax-evasion", category: "visible", title: "TAX EVASION", short: "Stay off the tax tiles.", detail: "Avoid every tax tile for an entire game.", rarity: "RARE" },
  { id: "underdog", category: "visible", title: "THE UNDERDOG", short: "Come back from last.", detail: "Win after being last in cash at the halfway point.", rarity: "RARE" },
  { id: "one-more-turn", category: "visible", title: "ONE MORE TURN", short: "Pay on the final cure round.", detail: "Survive a bank-loan warning and repay on the final cure round.", rarity: "EPIC" },
  { id: "group-therapy", category: "social", title: "GROUP THERAPY", short: "Trade across three deeds.", detail: "Complete a trade involving three different properties.", rarity: "UNCOMMON" },
  { id: "hostile-bidder", category: "visible", title: "HOSTILE BIDDER", short: "Win two auctions.", detail: "Win two auctions in one game.", rarity: "RARE" },
  { id: "empty-streets", category: "visible", title: "EMPTY STREETS", short: "Win without a full group.", detail: "Win while owning no complete property group.", rarity: "EPIC" },
  { id: "event-tourist", category: "global", title: "EVENT TOURIST", short: "Collect disasters.", detail: "Experience three different global events across your account history.", rarity: "RARE" },
  { id: "crisis-investor", category: "global", title: "CRISIS INVESTOR", short: "Buy the fear discount.", detail: "Buy property during Housing Bubble Pop and profit after recovery.", rarity: "EPIC" },
  { id: "public-enemy", category: "global", title: "PUBLIC ENEMY", short: "Survive the investigation vote.", detail: "Win an Anti-Monopoly Investigation vote against yourself.", rarity: "LEGENDARY" },
  { id: "silent-partner", category: "social", title: "SILENT PARTNER", short: "Lend without collateral.", detail: "Complete a player-loan contract without owning the collateral.", rarity: "RARE" },
  { id: "treasure-map", category: "visible", title: "TREASURE MAP", short: "Find every chest card.", detail: "Draw every Treasure card at least once across your account history.", rarity: "EPIC" },
  { id: "41st-tile", category: "secret", title: "THE 41ST TILE", short: "Step outside the board.", clue: "There are forty tiles. You stepped on one more.", detail: "Trigger the hidden movement sequence, then win the game.", rarity: "MYTHICAL", secret: true },
  { id: "null-player", category: "secret", title: "THE NULL PLAYER", short: "Continue from nothing.", clue: "Your wallet was empty. The turn continued. The table refuses to remember why.", detail: "Reach exactly $0, avoid bankruptcy, complete another turn, and win.", rarity: "MYTHICAL", secret: true },
  { id: "black-ledger", category: "secret", title: "THE BLACK LEDGER", short: "Close the book yourself.", clue: "The bank closed the book. Something inside kept counting.", detail: "Survive a curated crisis combination after losing collateral, then win.", rarity: "MYTHICAL", secret: true },
];

function loadAchievementRecords() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACHIEVEMENT_STORAGE_KEY) || "{}");
    const records = new Map();
    if (Array.isArray(raw)) {
      raw.forEach((id) => { if (ACHIEVEMENTS.some((achievement) => achievement.id === id)) records.set(id, null); });
      return records;
    }
    const source = raw?.records && typeof raw.records === "object" ? raw.records : raw;
    Object.entries(source || {}).forEach(([id, unlockedAt]) => {
      if (ACHIEVEMENTS.some((achievement) => achievement.id === id)) records.set(id, typeof unlockedAt === "string" ? unlockedAt : null);
    });
    return records;
  } catch { return new Map(); }
}

const initialAchievementRecords = loadAchievementRecords();

function saveUnlockedAchievements() {
  try { localStorage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify({ version: 2, records: Object.fromEntries(state.achievementRecords) })); } catch { /* storage unavailable */ }
}

function achievementIconHTML(id) {
  return `<svg class="achievement-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><use href="/assets/achievements.svg#achievement-${esc(id)}"></use></svg>`;
}

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
const ACTIVE_DESIGN_KEY = "poorup.active-design.v1";
const SOUND_KEY = "poorup.sound.enabled.v1";
const MUSIC_KEY = "poorup.music.enabled.v1";

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
  const designName = String(p.designName || p.name || "PLAYER").toUpperCase().slice(0, 12) || "PLAYER";
  return {
    id: typeof p.id === "string" ? p.id : `pf_${Math.random().toString(36).slice(2, 9)}`,
    designName,
    color: p.color,
    avatarGrid: grid,
  };
}

function profileDesignName(profile) {
  return String(profile?.designName || profile?.name || "PLAYER").trim().toUpperCase().slice(0, 12) || "PLAYER";
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

function loadActiveDesignId(profiles = []) {
  let raw = "";
  try { raw = String(localStorage.getItem(ACTIVE_DESIGN_KEY) || ""); } catch { /* storage unavailable */ }
  if (/^\d+$/.test(raw)) {
    const preset = Number(raw);
    if (preset >= 0 && preset < APPEARANCES.length) return preset;
  }
  if (raw && profiles.some((profile) => profile.id === raw)) return raw;
  return profiles[0]?.id || 0;
}

function saveActiveDesignId(choice) {
  try { localStorage.setItem(ACTIVE_DESIGN_KEY, String(choice)); } catch { /* storage unavailable */ }
}

function loadSoundPreference() {
  try { return localStorage.getItem(SOUND_KEY) === "1"; } catch { return false; }
}

function saveSoundPreference(enabled) {
  try { localStorage.setItem(SOUND_KEY, enabled ? "1" : "0"); } catch { /* storage unavailable */ }
}

function loadMusicPreference() {
  try { return localStorage.getItem(MUSIC_KEY) === "1"; } catch { return false; }
}

function saveMusicPreference(enabled) {
  try { localStorage.setItem(MUSIC_KEY, enabled ? "1" : "0"); } catch { /* storage unavailable */ }
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
      history: Array.isArray(account.history) ? account.history.filter((entry) => entry && typeof entry === "object").slice(0, 50).map((entry) => ({
        playedAt: typeof entry.playedAt === "string" ? entry.playedAt : null,
        result: entry.result === "WIN" ? "WIN" : "ROUND",
        won: entry.won === true || entry.result === "WIN",
        endingCash: Math.max(0, Number(entry.endingCash) || 0),
        properties: Math.max(0, Number(entry.properties) || 0),
      })) : [],
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
  // If the active design was removed, fall back deterministically and persist
  // the fallback so home, account, and the next lobby share one source of truth.
  if (state.appearance === id) {
    state.appearance = state.profiles[0]?.id || 0;
    saveActiveDesignId(state.appearance);
  }
  if (state.tableAppearanceOverride === id) state.tableAppearanceOverride = null;
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
        baseName: "PLAYER",
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
  return [
    {
      id: "p1",
      name: (alias.trim() || selected.baseName).toUpperCase(),
      color: selected.color,
      textColor: selected.textColor,
      cash: 1500,
      pos: START_TILE_INDEX,
      online: true,
      jailFree: 0,
      avatarGrid: selected.avatarGrid || undefined,
    },
    ...rest.slice(0, 3).map((a, i) => ({
      id: `p${i + 2}`,
      name: a.baseName,
      color: a.color,
      textColor: a.textColor,
      cash: [1420, 1680, 980][i],
      pos: START_TILE_INDEX,
      online: i !== 2,
      bot: true,
      jailFree: 0,
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
  roomVisibility: "private",
  alias: loadGuestAlias(),
  appearance: 0,
  tableAppearanceOverride: null, // optional one-table override; null inherits active design
  homeTab: "play",          // play | rooms | profile
  profileTab: "designs",    // overview | stats | designs | history | account
  setupTab: "preset",         // "preset" | "custom" — which tab is showing in the setup grid
  profiles: loadProfiles(),   // persisted array of saved player designs
  achievementRecords: initialAchievementRecords,
  unlockedAchievements: new Set(initialAchievementRecords.keys()),
  achievementFilter: "all",
  achievementDateFilter: "all",
  achievementRarityFilter: "all",
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
  roundNumber: 0,
  globalEvent: null,
  social: { friends: [], requests: [], outgoing: [], invites: [], notifications: [] },
  socialSearchResults: [],
  socialTab: "friends",
  leaderboard: { metric: "wins", rows: [], loading: false },
  selectedPlayer: null,
  selectedPlayerRelationship: "none",
  selectedPlayerView: "profile",
  selectedPlayerHistory: null,
  surpriseDeck: [...CHANCE_EVENTS],
  treasureDeck: [...CHEST_EVENTS],
  card: null,           // { tile, ev, kind } modal reveal
  gameOver: null,       // { winnerName, winnerId, summary[] } end screen
  sound: loadSoundPreference(), // global effects toggle
  music: loadMusicPreference(), // global soundtrack toggle
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
    bots:            0,        // reserved CPU seats; bot turns are added separately
    bankLoans:       true,
    bankLoanSeverity: "predatory",
    globalEvents:    "rare",
    globalEventDuration: 5,
    globalEventMax:  1,
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
  "#rooms-modal", "#account-modal", "#confirm-modal", "#achievement-modal", "#rankings-modal", "#social-modal", "#player-modal", "#setup-wrap", "#popup", "#trade-modal", "#choice-modal",
  "#auction-modal", "#offer-modal", "#deed-modal", "#financing-modal", "#bankruptcy-modal",
  "#card-modal", "#card-gallery", "#gameover-modal",
];
let surfaceReturnFocus = null;
const surfaceInertNodes = new Set();
let pendingConfirmation = null;

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
  pendingConfirmation = null;
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
  state.appearance = loadActiveDesignId(state.profiles);
  state.alias = loadGuestAlias();
  state.players = buildPlayers(state.appearance, state.alias);
}
if (state.account) {
  state.alias = state.account.account.displayName;
  state.players = buildPlayers(state.appearance, state.alias);
}

try { localStorage.setItem("poorup-client-id", state.clientId); } catch { /* storage unavailable */ }

function activeAppearance() {
  return state.tableAppearanceOverride ?? state.appearance;
}

function syncLocalAppearance() {
  const self = state.players.find((player) => player.id === "p1" || player.clientId === state.clientId);
  if (!self) return;
  const meta = getAppearanceMeta(activeAppearance());
  self.color = meta.color;
  self.textColor = meta.textColor;
  self.avatarGrid = meta.avatarGrid || undefined;
}

function setActiveAppearance(choice) {
  state.appearance = choice;
  state.tableAppearanceOverride = null;
  saveActiveDesignId(choice);
  syncLocalAppearance();
  applyProfileToHomeUI();
  renderAccountPanel();
  renderProfileLibrary();
}

function setTableAppearanceOverride(choice) {
  state.tableAppearanceOverride = choice === state.appearance ? null : choice;
  syncLocalAppearance();
  renderPlayers();
  renderSetup();
  renderLobbyRail();
  syncServerAppearance();
}

function clearTableAppearanceOverride() {
  state.tableAppearanceOverride = null;
  syncLocalAppearance();
  renderPlayers();
  renderSetup();
  renderLobbyRail();
  syncServerAppearance();
}

syncLocalAppearance();

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
  bankLoans: "bankLoans",
  bankLoanSeverity: "bankLoanSeverity",
  globalEvents: "globalEvents",
  globalEventDuration: "globalEventDuration",
  globalEventMax: "globalEventMax",
  bots: "bots",
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
  const previousPositions = new Map(state.players.map((player) => [player.id, Number(player.pos) || 0]));
  setConnectionStatus("online");
  const { room, game } = snapshot;
  state.roomCode = room.roomCode || state.roomCode;
  state.roomVisibility = room.visibility === "public" ? "public" : "private";
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
    bot: Boolean(player.isBot),
    jailFree: Number(player.jailFreeCards) || 0,
    bankLoan: player.bankLoan || null,
    bankLoanOffer: player.bankLoanOffer || null,
    isHost: Boolean(player.isHost),
    avatarGrid: Array.isArray(player.avatarGrid) ? player.avatarGrid : null,
  })).sort((a, b) => {
    if (a.clientId === state.clientId) return -1;
    if (b.clientId === state.clientId) return 1;
    return turnOrder.indexOf(a.serverId) - turnOrder.indexOf(b.serverId);
  });
  syncLocalAppearance();
  state.turnIndex = Math.max(0, state.players.findIndex((player) => player.serverId === game.currentPlayerId));
  state.dice = Array.isArray(game.lastDice) ? game.lastDice : [0, 0];
  state.roundNumber = Number(game.roundNumber) || 0;
  state.globalEvent = game.globalEvent || null;
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
  const movementPlans = state.phase === "playing"
    ? state.players
        .map((player) => ({ player, from: previousPositions.get(player.id), to: Number(player.pos) || 0 }))
        .filter(({ from, to }) => from != null && from !== to && (to - from + TILE_COUNT) % TILE_COUNT <= 12)
    : [];
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
  if (movementPlans.length) {
    requestAnimationFrame(() => movementPlans.forEach(({ player, from, to }) => startPieceWalk(player.id, from, to)));
  }
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
  socket.on("social-update", (social) => {
    state.social = social || state.social;
    renderSocialSurface("#social-page-content");
    renderSocialSurface("#social-card");
  });
  socket.on("social-notification", (notification) => {
    const list = state.social.notifications || [];
    state.social.notifications = [notification, ...list.filter(item => item.id !== notification.id)].slice(0, 50);
    announceSocialNotification(notification);
    renderSocialSurface("#social-page-content");
    renderSocialSurface("#social-card");
  });
  socket.on("mythical-achievement", (notification) => {
    announceSocialNotification(notification);
    state.social.notifications = [notification, ...(state.social.notifications || [])].slice(0, 50);
    renderSocialSurface("#social-page-content");
  });
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
      openCardReveal(tile, { text: reveal.text || "Card resolved.", action: reveal.action, cash: Number(reveal.cash) || 0 });
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
  document.querySelectorAll("[data-global-connection-label]").forEach((label) => {
    label.textContent = copy;
  });
  const gameLabel = $("#tn-online");
  if (gameLabel && state.live) gameLabel.textContent = status === "online"
    ? `${state.players.filter((p) => p.online).length} ONLINE`
    : copy;
  document.querySelectorAll("[data-global-online] .dot, #view-home .online .dot, #home-status-note .dot").forEach((dot) => {
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

function profileDisplaySource() {
  const account = state.account?.account || null;
  const draft = state.profileDraft || null;
  const selected = typeof state.appearance === "string" ? getProfileById(state.appearance) : null;
  const profile = draft || selected || null;
  const activeMeta = getAppearanceMeta(state.appearance);
  const name = account?.displayName || state.alias || "PLAYER";
  // The active saved design drives the avatar; account data only supplies a
  // fallback when no local design exists. Account display name stays separate.
  const color = draft?.color || profile?.color || account?.color || activeMeta.color || "#d74438";
  const grid = draft?.grid || profile?.avatarGrid || account?.avatarGrid || null;
  return { account, profile, name, color, grid, designName: profile ? profileDesignName(profile) : activeMeta.label };
}

/**
 * Poorup-styled confirmation surface. Keep destructive actions inside the
 * shared dialog controller so they inherit focus trapping, Escape handling,
 * inert background behaviour, and focus restoration.
 */
function openConfirmModal({ title = "Confirm action", message = "", confirmLabel = "CONFIRM", onConfirm } = {}) {
  const card = $("#confirm-card");
  if (!card) return;
  pendingConfirmation = typeof onConfirm === "function" ? onConfirm : null;
  card.innerHTML = `
    <div class="confirm-body">
      <div class="confirm-head">
        <div>
          <div class="t-micro red">CONFIRM ACTION</div>
          <h2 class="t-section g100" id="confirm-title">${esc(title)}</h2>
        </div>
        <span data-sprite="diamond" data-size="3" aria-hidden="true"></span>
      </div>
      <p class="t-body ink-2 confirm-message" id="confirm-description">${esc(message)}</p>
      <div class="confirm-actions">
        <button class="btn-dark" type="button" id="confirm-cancel"><span class="t-label f11">CANCEL</span></button>
        <button class="cta-red" type="button" id="confirm-accept"><span class="cta-text cta-text-sm">${esc(confirmLabel)}</span></button>
      </div>
    </div>`;
  hydrateSprites(card);
  openSurface("#confirm-modal", "#confirm-cancel");
  $("#confirm-scrim")?.addEventListener("click", closeConfirmModal);
  $("#confirm-cancel")?.addEventListener("click", closeConfirmModal);
  $("#confirm-accept")?.addEventListener("click", () => {
    const action = pendingConfirmation;
    pendingConfirmation = null;
    closeSurface("#confirm-modal");
    action?.();
  });
}

function closeConfirmModal() {
  pendingConfirmation = null;
  closeSurface("#confirm-modal");
}

function renderProfileSummary() {
  const source = profileDisplaySource();
  const { account, name, color, grid } = source;
  const safeName = String(name || "PLAYER").trim() || "PLAYER";
  const displayName = safeName.toUpperCase();
  const accountStats = account?.stats || {};
  const stats = {
    games: Number(accountStats.gamesPlayed) || 0,
    wins: Number(accountStats.wins) || 0,
    rate: accountRate(accountStats),
    bankruptcies: Number(accountStats.bankruptcies) || 0,
  };
  const avatarMarkup = grid ? spriteFromGrid(grid, 6) : avatarHTML({ color }, 6, 0);

  const heroAvatar = $("#profile-hero-avatar");
  if (heroAvatar) heroAvatar.innerHTML = avatarMarkup;
  const overviewAvatar = $("#profile-overview-avatar");
  if (overviewAvatar) overviewAvatar.innerHTML = grid ? spriteFromGrid(grid, 5) : avatarHTML({ color }, 5, 0);
  $("#profile-hero-name")?.replaceChildren(document.createTextNode(displayName));
  $("#profile-overview-name")?.replaceChildren(document.createTextNode(displayName));
  const handle = $("#profile-hero-handle");
  if (handle) handle.textContent = account ? `@${account.username}` : "GUEST MODE";
  const stateLabel = $("#profile-hero-state");
  if (stateLabel) {
    stateLabel.textContent = account ? "ACCOUNT PLAYER · STATS SYNCED AFTER COMPLETED ROUNDS" : "LOCAL PLAYER · READY FOR THE NEXT TABLE";
    stateLabel.classList.toggle("is-account", Boolean(account));
  }
  const heroAction = $("#profile-hero-account-btn");
  if (heroAction) heroAction.querySelector(".t-label").textContent = account ? "EDIT ACCOUNT" : "CREATE ACCOUNT";
  $("#profile-stat-games")?.replaceChildren(document.createTextNode(String(stats.games)));
  $("#profile-stat-wins")?.replaceChildren(document.createTextNode(String(stats.wins)));
  $("#profile-stat-rate")?.replaceChildren(document.createTextNode(stats.rate));
  $("#profile-stat-bankruptcies")?.replaceChildren(document.createTextNode(String(stats.bankruptcies)));
  const joined = $("#profile-stat-joined");
  if (joined) joined.textContent = account?.createdAt ? new Date(account.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }).toUpperCase() : "GUEST";
  $("#profile-overview-mode")?.replaceChildren(document.createTextNode(account ? `@${account.username}` : "GUEST MODE"));
  const overviewStatus = $("#profile-overview-status");
  if (overviewStatus) overviewStatus.textContent = state.connectionStatus === "online" ? "READY" : (CONNECTION_COPY[state.connectionStatus] || "OFFLINE").toUpperCase();
  const overviewSync = $("#profile-overview-sync");
  if (overviewSync) overviewSync.textContent = account ? "ACCOUNT SYNC" : "LOCAL ONLY";
  const soundState = $("#profile-sound-state");
  if (soundState) soundState.textContent = state.sound ? "SOUND ON" : "SOUND OFF";
  const musicState = $("#profile-music-state");
  if (musicState) musicState.textContent = state.music ? "MUSIC ON" : "MUSIC OFF";
  renderProfileStatistics();
  renderProfileHistory();
  renderAchievements();
}

function formatStatDate(value) {
  if (!value) return "ROUND";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ROUND";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

function renderProfileStatistics() {
  const root = $("#profile-statistics-content");
  if (!root) return;
  const account = state.account?.account || null;
  const stats = account?.stats || {};
  const games = Math.max(0, Number(stats.gamesPlayed) || 0);
  const wins = Math.max(0, Math.min(games, Number(stats.wins) || 0));
  const bankruptcies = Math.max(0, Number(stats.bankruptcies) || 0);
  const history = Array.isArray(account?.history)
    ? account.history.filter((entry) => entry && typeof entry === "object").slice(0, 50)
    : [];
  const chronological = [...history].reverse().slice(-12);
  const averageCash = history.length
    ? Math.round(history.reduce((sum, entry) => sum + Math.max(0, Number(entry.endingCash) || 0), 0) / history.length)
    : null;
  const bestCash = history.length ? Math.max(...history.map((entry) => Math.max(0, Number(entry.endingCash) || 0))) : null;
  const bestProperties = history.length ? Math.max(...history.map((entry) => Math.max(0, Number(entry.properties) || 0))) : null;
  const winShare = games ? Math.round((wins / games) * 100) : 0;
  const sourceLabel = account ? "ACCOUNT SYNC" : "LOCAL ONLY";
  const record = (label, value, tone = "g100") => `<div class="stats-record"><span class="t-micro ink-3">${label}</span><strong class="t-label f16 ${tone}">${value}</strong></div>`;
  const trendBars = chronological.length
    ? chronological.map((entry, index) => {
        const won = String(entry.result || "").toUpperCase() === "WIN" || entry.won === true;
        const height = won ? 100 : 30;
        const label = won ? "WIN" : "ROUND";
        return `<div class="stats-bar-column"><span class="stats-bar-value t-micro ${won ? "green" : "ink-3"}">${label}</span><span class="stats-bar ${won ? "is-win" : "is-loss"}" style="--bar-height:${height}%" title="${formatStatDate(entry.playedAt)} · ${label}"></span><span class="stats-bar-label t-micro ink-3">${formatStatDate(entry.playedAt)}</span></div>`;
      }).join("")
    : `<div class="stats-chart-empty"><span data-sprite="diamond" data-size="4"></span><strong class="t-label f12 g100">${account ? "NO ROUND HISTORY YET" : "ACCOUNT HISTORY UNAVAILABLE"}</strong><span class="t-micro ink-3">${account ? "Complete a server round to unlock this trend." : "Create an account to sync completed-round statistics."}</span></div>`;
  const trendTable = chronological.length
    ? `<table class="stats-data-table"><caption>Recent round results</caption><thead><tr><th scope="col">ROUND</th><th scope="col">RESULT</th><th scope="col">ENDING CASH</th><th scope="col">PROPERTIES</th></tr></thead><tbody>${chronological.map((entry, index) => { const won = String(entry.result || "").toUpperCase() === "WIN" || entry.won === true; return `<tr><th scope="row">${formatStatDate(entry.playedAt)} · ${String(index + 1).padStart(2, "0")}</th><td class="${won ? "green" : "ink-2"}">${won ? "WIN" : "ROUND"}</td><td>$${Math.max(0, Number(entry.endingCash) || 0).toLocaleString()}</td><td>${Math.max(0, Number(entry.properties) || 0)}</td></tr>`; }).join("")}</tbody></table>`
    : "";

  root.innerHTML = `<div class="stats-intro panel noise"><div><div class="t-micro g400">PERFORMANCE DECK</div><h2 class="t-section g100">Player Statistics</h2><p class="t-body ink-2">A readable record of the rounds you have finished, not a live ranking or a promise of future results.</p></div><span class="t-micro stats-source ${account ? "green" : "g300"}">${sourceLabel}</span></div>
    <div class="stats-metric-grid" aria-label="Performance summary">${record("ROUNDS", account ? String(games) : "—")}${record("WINS", account ? String(wins) : "—", "green")}${record("WIN RATE", account ? `${winShare}%` : "—", "g300")}${record("BANKRUPTCIES", account ? String(bankruptcies) : "—", "g-muted")}</div>
    <div class="stats-content-grid"><section class="panel noise pad16 stats-trend-panel" aria-labelledby="stats-trend-heading"><div class="stats-panel-head"><div><div class="t-micro g400">RECENT FORM</div><h3 class="t-section g100" id="stats-trend-heading">Win history</h3></div><span class="t-micro ink-3">LAST ${chronological.length || 0} ROUNDS</span></div><div class="stats-chart" role="img" aria-label="Win history chart showing ${wins} wins across ${games} completed rounds"><div class="stats-chart-y"><span class="t-micro ink-3">WIN</span><span class="t-micro ink-3">ROUND</span></div><div class="stats-chart-plot"><div class="stats-chart-grid" aria-hidden="true"><span></span><span></span><span></span><span></span></div><div class="stats-chart-bars">${trendBars}</div></div></div>${trendTable}</section><section class="panel noise pad16 stats-records-panel" aria-labelledby="stats-records-heading"><div class="stats-panel-head"><div><div class="t-micro g400">PARLOR RECORDS</div><h3 class="t-section g100" id="stats-records-heading">Personal bests</h3></div><span class="t-micro ink-3">VERIFIED ROUNDS</span></div><div class="stats-record-list">${record("AVG ENDING CASH", averageCash == null ? "—" : `$${averageCash.toLocaleString()}`)}${record("BEST CASH STACK", bestCash == null ? "—" : `$${bestCash.toLocaleString()}`, "green")}${record("MOST PROPERTIES", bestProperties == null ? "—" : String(bestProperties), "g300")}${record("DATA WINDOW", account ? (history.length ? `${history.length} ROUNDS` : "NO ROUNDS") : "ACCOUNT ONLY", "g-muted")}</div><p class="t-micro ink-3 stats-method">Values are calculated from completed server rounds. No estimates are shown.</p></section></div>`;
  hydrateSprites(root);
}

function renderProfileHistory() {
  const root = $("#profile-history-content");
  if (!root) return;
  const account = state.account?.account || null;
  const history = Array.isArray(account?.history)
    ? account.history.filter((entry) => entry && typeof entry === "object").slice(0, 50)
    : [];
  if (!account || !history.length) {
    root.innerHTML = `<section class="panel noise pad16 profile-empty-panel"><div class="section-title"><span data-sprite="diamond" data-size="3"></span><h2 class="t-section g300">Completed rounds</h2></div><p class="t-body ink-2">${account ? "NO COMPLETED ROUNDS YET. YOUR FIRST FINISH WILL APPEAR HERE." : "SIGN IN TO KEEP A SERVER-SYNCED ROUND HISTORY."}</p><p class="t-micro ink-3">Only completed server rounds appear here. Guest play remains available without an account.</p></section>`;
    hydrateSprites(root);
    return;
  }
  root.innerHTML = `<section class="panel noise pad16"><div class="section-title"><span data-sprite="diamond" data-size="3"></span><h2 class="t-section g300">Completed rounds</h2><span class="t-micro ink-3">${history.length} SAVED</span></div><div class="profile-history-list">${history.map((entry, index) => { const won = String(entry.result || "").toUpperCase() === "WIN" || entry.won === true; return `<div class="profile-history-row${won ? " is-win" : ""}"><span class="profile-history-index t-micro ink-3">${String(history.length - index).padStart(2, "0")}</span><div class="profile-history-main"><span class="t-label f12 ${won ? "green" : "g100"}">${won ? "WIN" : "ROUND COMPLETE"}</span><span class="t-micro ink-3">${formatStatDate(entry.playedAt)}</span></div><div class="profile-history-meta"><span class="t-micro ink-3">CASH</span><span class="t-label f11 g100">$${Math.max(0, Number(entry.endingCash) || 0).toLocaleString()}</span><span class="t-micro ink-3">DEEDS ${Math.max(0, Number(entry.properties) || 0)}</span></div></div>`; }).join("")}</div><p class="t-micro ink-3 profile-history-note">History is recorded when a server round finishes. Private-room results are visible only to participating accounts.</p></section>`;
  hydrateSprites(root);
}

function renderAchievements() {
  const root = $("#achievements-grid");
  if (!root) return;
  const unlocked = state.unlockedAchievements || new Set();
  const total = ACHIEVEMENTS.length;
  const unlockedCount = ACHIEVEMENTS.filter((achievement) => unlocked.has(achievement.id)).length;
  $("#profile-achievement-count")?.replaceChildren(document.createTextNode(`${unlockedCount}/${total}`));
  $("#achievements-progress-value")?.replaceChildren(document.createTextNode(`${unlockedCount}/${total}`));
  document.querySelectorAll("#achievements-filters [data-achievement-filter]").forEach((button) => {
    const active = button.dataset.achievementFilter === state.achievementFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const dateSelect = $("#achievement-date-filter");
  const raritySelect = $("#achievement-rarity-filter");
  if (dateSelect) dateSelect.value = state.achievementDateFilter;
  if (raritySelect) raritySelect.value = state.achievementRarityFilter;
  const filter = state.achievementFilter;
  const now = Date.now();
  const dateFilter = state.achievementDateFilter;
  const rarityFilter = state.achievementRarityFilter;
  let visible = ACHIEVEMENTS.filter((achievement) => filter === "all" || achievement.category === filter || (filter === "secret" && achievement.secret));
  visible = visible.filter((achievement) => rarityFilter === "all" || achievement.rarity.toLowerCase() === rarityFilter);
  if (dateFilter === "recent" || dateFilter === "month") {
    const windowMs = dateFilter === "recent" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    visible = visible.filter((achievement) => {
      const recorded = Date.parse(state.achievementRecords?.get(achievement.id) || "");
      return Number.isFinite(recorded) && now - recorded <= windowMs;
    });
  } else if (dateFilter === "newest" || dateFilter === "oldest") {
    visible = [...visible].sort((a, b) => {
      const aDate = Date.parse(state.achievementRecords?.get(a.id) || "") || (dateFilter === "newest" ? 0 : Number.MAX_SAFE_INTEGER);
      const bDate = Date.parse(state.achievementRecords?.get(b.id) || "") || (dateFilter === "newest" ? 0 : Number.MAX_SAFE_INTEGER);
      return dateFilter === "newest" ? bDate - aDate : aDate - bDate;
    });
  }
  root.innerHTML = visible.map((achievement) => {
    const isUnlocked = unlocked.has(achievement.id);
    const isSecretLocked = Boolean(achievement.secret && !isUnlocked);
    const title = isSecretLocked ? "SECRET ACHIEVEMENT" : achievement.title;
    const short = isSecretLocked ? "A hidden parlor record" : achievement.short;
    const stateLabel = isUnlocked ? "UNLOCKED" : isSecretLocked ? "HIDDEN" : "LOCKED";
    return `<button class="achievement-card rarity-${achievement.rarity.toLowerCase()}${isUnlocked ? " is-unlocked" : ""}${isSecretLocked ? " is-secret" : ""}" type="button" data-achievement-id="${esc(achievement.id)}" aria-haspopup="dialog" aria-label="${esc(`${title}, ${stateLabel}. Open details.`)}"><span class="achievement-icon-wrap">${achievementIconHTML(achievement.id)}</span><span class="achievement-card-main"><span class="achievement-card-top"><span class="t-micro achievement-category">${achievement.category.toUpperCase()}</span><span class="t-micro achievement-rarity rarity-${achievement.rarity.toLowerCase()}">${achievement.rarity}</span></span><strong class="t-label f13 achievement-title">${esc(title)}</strong><span class="t-micro ink-3 achievement-short">${esc(short)}</span></span></button>`;
  }).join("");
  if (!visible.length) root.innerHTML = `<p class="t-body ink-3 achievements-empty">NO ACHIEVEMENTS IN THIS FILTER.</p>`;
}

function openAchievementModal(id, trigger = null) {
  const achievement = ACHIEVEMENTS.find((entry) => entry.id === id);
  if (!achievement) return;
  const unlocked = state.unlockedAchievements.has(achievement.id);
  const hidden = Boolean(achievement.secret && !unlocked);
  const title = hidden ? "SECRET ACHIEVEMENT" : achievement.title;
  const copy = hidden ? achievement.clue : achievement.detail;
  const status = unlocked ? "UNLOCKED" : hidden ? "HIDDEN" : "LOCKED";
  const recordedAt = state.achievementRecords?.get(achievement.id);
  const accent = achievement.category === "global" ? "#d74438" : achievement.category === "social" ? "#286ea1" : achievement.category === "minigame" ? "#35a653" : "#d9a62f";
  const card = $("#achievement-detail-card");
  if (!card) return;
  card.innerHTML = `<div class="achievement-modal-rail" style="--achievement-accent:${accent}"></div><div class="achievement-detail-body"><div class="achievement-detail-head"><div class="achievement-detail-icon rarity-${achievement.rarity.toLowerCase()}${hidden ? " is-locked" : ""}">${achievementIconHTML(achievement.id)}</div><div><div class="achievement-detail-kicker"><span class="t-micro g400">${esc(achievement.category.toUpperCase())}</span><span class="t-micro rarity-${achievement.rarity.toLowerCase()}">${esc(achievement.rarity)}</span></div><h2 class="t-section achievement-detail-title" id="achievement-detail-title">${esc(title)}</h2></div><span class="achievement-detail-state t-micro">${status}</span></div><div class="achievement-detail-copy"><p class="t-body ink-2" id="achievement-detail-description">${esc(copy)}</p><p class="t-micro achievement-detail-note">${unlocked ? `RECORDED ${recordedAt ? `· ${formatStatDate(recordedAt)}` : "IN YOUR PARLOR LOG"}` : hidden ? "UNLOCK CONDITION HIDDEN" : "KEEP PLAYING TO UNLOCK"}</p></div><button class="cta-red achievement-detail-close" id="achievement-detail-close" type="button"><span class="cta-text cta-text-sm">CLOSE DETAILS</span></button></div>`;
  if (trigger instanceof HTMLElement) surfaceReturnFocus = trigger;
  openSurface("#achievement-modal", "#achievement-detail-close");
  $("#achievement-detail-close")?.addEventListener("click", closeAchievementModal);
}

function closeAchievementModal() {
  closeSurface("#achievement-modal");
}

function setAchievementFilter(filter = "all") {
  const allowed = ["all", "visible", "global", "social", "secret", "minigame"];
  state.achievementFilter = allowed.includes(filter) ? filter : "all";
  renderAchievements();
}

function setAchievementDateFilter(filter = "all") {
  state.achievementDateFilter = ["all", "recent", "month", "newest", "oldest"].includes(filter) ? filter : "all";
  renderAchievements();
}

function setAchievementRarityFilter(filter = "all") {
  const allowed = ["all", "common", "uncommon", "rare", "epic", "legendary", "mythical"];
  state.achievementRarityFilter = allowed.includes(filter) ? filter : "all";
  renderAchievements();
}

function unlockAchievement(id) {
  if (!ACHIEVEMENTS.some((achievement) => achievement.id === id)) return false;
  if (state.unlockedAchievements.has(id)) return false;
  state.unlockedAchievements.add(id);
  state.achievementRecords.set(id, new Date().toISOString());
  saveUnlockedAchievements();
  renderAchievements();
  const achievement = ACHIEVEMENTS.find((entry) => entry.id === id);
  const announcer = $("#system-announcer");
  if (announcer && achievement) announcer.textContent = `ACHIEVEMENT UNLOCKED: ${achievement.title}`;
  return true;
}

function setHomeTab(tab = "play") {
  const next = ["play", "rooms", "profile"].includes(tab) ? tab : "play";
  state.homeTab = next;
  document.querySelectorAll("[data-global-nav] [data-home-tab]").forEach((button) => {
    const active = button.dataset.homeTab === next;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

/** Keep the non-game app shell on one navigation contract. The game view has
 * its own turn-aware topnav, so it intentionally does not participate here. */
function syncGlobalNavigation(surface = "home") {
  const activeHomeTab = surface === "home" ? state.homeTab : surface;
  document.querySelectorAll("[data-global-nav]").forEach((nav) => {
    nav.querySelectorAll("[data-home-tab], [data-top-surface]").forEach((button) => {
      const active = button.dataset.homeTab
        ? surface !== "rankings" && surface !== "social" && button.dataset.homeTab === activeHomeTab
        : button.dataset.topSurface === surface;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  });
}

function setProfileTab(tab = "designs", focus = false) {
  const allowed = ["overview", "stats", "designs", "history", "achievements", "account"];
  const next = allowed.includes(tab) ? tab : "designs";
  state.profileTab = next;
  const root = $("#view-profile");
  if (root) root.dataset.profileTab = next;
  document.querySelectorAll("#profile-tabs [data-profile-tab]").forEach((button) => {
    const active = button.dataset.profileTab === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("#view-profile .profile-tab-panel").forEach((panel) => {
    panel.classList.toggle("is-hidden", panel.id !== `profile-panel-${next}`);
  });
  renderProfileSummary();
  if (focus) {
    const panel = $(`#profile-panel-${next}`);
    panel?.focus({ preventScroll: true });
  }
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
  renderProfileSummary();
  if (!signedIn) return;
  const account = state.account.account;
  const visual = profileDisplaySource();
  const avatar = $("#account-avatar");
  if (avatar) avatar.innerHTML = visual.grid ? spriteFromGrid(visual.grid, 4) : avatarHTML({ color: visual.color }, 4, 0);
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

const ACCOUNT_USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function accountModalHTML(mode) {
  const register = mode === "register";
  const edit = mode === "edit";
  const account = state.account?.account || null;
  const title = edit ? "Edit Account" : register ? "Create account" : "Sign in";
  const description = edit
    ? "Update the account display name used at every table. Your saved designs keep their own names."
    : register
      ? "Choose a unique username friends can find, then save your player identity and stats across rooms."
      : "Sign in to load your saved display name, face, color, and game record.";
  return `
    <div class="account-modal-body">
      <div class="account-modal-head">
        <div>
          <div class="t-micro g400">POORUP IDENTITY</div>
          <h2 class="t-section g100" id="account-modal-title">${title}</h2>
        </div>
        <button class="btn-dark" id="account-modal-close" type="button"><span class="t-label f11">CLOSE</span></button>
      </div>
      <p class="t-body ink-2" id="account-modal-description">${description}</p>
      ${edit ? "" : `<div class="account-modal-tabs" role="tablist" aria-label="Account actions"><button class="rm-tab${register ? " is-active" : ""}" id="account-tab-register" type="button" role="tab" aria-selected="${register}"><span class="t-label f12">CREATE ACCOUNT</span></button><button class="rm-tab${register ? "" : " is-active"}" id="account-tab-login" type="button" role="tab" aria-selected="${!register}"><span class="t-label f12">SIGN IN</span></button></div>`}
      <form class="account-form" id="account-form">
        ${edit ? `<label class="account-field"><span class="t-label f12 g-muted">Username</span><input class="field" id="account-username-input" value="${esc(account?.username || "")}" readonly aria-readonly="true" /></label>` : `<label class="account-field" id="account-username-field"><span class="t-label f12 g-muted">Username</span><input class="field" id="account-username-input" name="username" maxlength="16" minlength="3" pattern="[A-Za-z0-9_]{3,16}" autocomplete="username"${register ? ` aria-describedby="account-username-status"` : ""} required placeholder="night_player" />${register ? `<span class="account-username-status t-micro ink-3" id="account-username-status" role="status" aria-live="polite">3–16 letters, numbers, or underscores</span>` : ""}</label>`}
        ${(register || edit) ? `<label class="account-field"><span class="t-label f12 g-muted">Display Name</span><input class="field" id="account-display-input" name="displayName" maxlength="18" autocomplete="nickname" required placeholder="Marlowe" value="${edit ? esc(account?.displayName || "") : ""}" /></label>` : ""}
        ${edit ? "" : `<label class="account-field"><span class="t-label f12 g-muted">Password</span><input class="field" id="account-password-input" name="password" type="password" minlength="8" maxlength="72" autocomplete="${register ? "new-password" : "current-password"}" required placeholder="8 characters minimum" /></label>`}
        <p class="account-form-error" id="account-form-error" role="alert" aria-live="assertive"></p>
        <button class="cta-red account-submit" type="submit"><span class="cta-text cta-text-sm">${edit ? "Save Account" : register ? "Create Account" : "Sign In"}</span></button>
      </form>
      <p class="t-micro ink-3 account-modal-foot">Guest play remains available without an account. Passwords are never shown in the game UI.</p>
    </div>`;
}

function openAccountModal(mode = "register") {
  accountModalMode = mode;
  const card = $("#account-card");
  if (!card) return;
  card.innerHTML = accountModalHTML(mode);
  openSurface("#account-modal", mode === "edit" ? "#account-display-input" : "#account-username-input");
  $("#account-modal-close")?.addEventListener("click", closeAccountModal);
  $("#account-tab-register")?.addEventListener("click", () => openAccountModal("register"));
  $("#account-tab-login")?.addEventListener("click", () => openAccountModal("login"));
  let usernameCheckTimer = null;
  let usernameCheckVersion = 0;
  let usernameAvailability = mode === "register" ? false : true;
  let usernameCheckPending = false;
  const usernameInput = $("#account-username-input");
  const usernameStatus = $("#account-username-status");
  const accountForm = $("#account-form");
  const submit = accountForm?.querySelector("button[type=submit]");
  const setUsernameStatus = (kind, message) => {
    if (!usernameStatus) return;
    usernameStatus.classList.remove("is-checking", "is-available", "is-taken", "is-invalid");
    if (kind) usernameStatus.classList.add(`is-${kind}`);
    usernameStatus.textContent = message;
    usernameInput?.setAttribute("aria-invalid", String(kind === "taken" || kind === "invalid"));
    usernameInput?.setAttribute("aria-busy", String(kind === "checking"));
  };
  const syncUsernameSubmit = () => {
    if (submit && mode === "register") submit.disabled = usernameCheckPending || usernameAvailability === false;
  };
  const checkUsername = () => {
    if (mode !== "register" || !usernameInput || !usernameStatus) return;
    clearTimeout(usernameCheckTimer);
    const value = usernameInput.value.trim();
    const version = ++usernameCheckVersion;
    if (!value) {
      usernameAvailability = false;
      usernameCheckPending = false;
      setUsernameStatus("invalid", "[!] Enter a username to check.");
      syncUsernameSubmit();
      return;
    }
    if (!ACCOUNT_USERNAME_RE.test(value)) {
      usernameAvailability = false;
      usernameCheckPending = false;
      setUsernameStatus("invalid", "[!] Use 3–16 letters, numbers, or underscores.");
      syncUsernameSubmit();
      return;
    }
    usernameAvailability = null;
    usernameCheckPending = true;
    setUsernameStatus("checking", "[·] Checking username availability…");
    syncUsernameSubmit();
    usernameCheckTimer = window.setTimeout(() => {
      emitServer("check-username", { username: value }, (response) => {
        if (version !== usernameCheckVersion || usernameInput.value.trim() !== value) return;
        usernameCheckPending = false;
        if (!response?.success) {
          usernameAvailability = null;
          setUsernameStatus("checking", "[·] Could not check now. The server will verify it on submit.");
          syncUsernameSubmit();
          return;
        }
        usernameAvailability = response.available === true;
        setUsernameStatus(
          response.available ? "available" : response.reason === "invalid" ? "invalid" : "taken",
          response.available ? "[OK] Username is available." : `[X] ${response.message || "That username is already taken."}`,
        );
        syncUsernameSubmit();
      });
    }, 180);
  };
  usernameInput?.addEventListener("input", checkUsername);
  checkUsername();
  $("#account-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    const error = $("#account-form-error");
    if (error) error.textContent = "";
    if (accountModalMode === "register" && usernameAvailability === false) {
      if (error) error.textContent = "Choose an available username before creating your account.";
      usernameInput?.focus({ preventScroll: true });
      return;
    }
    if (accountModalMode === "register" && usernameCheckPending) {
      if (error) error.textContent = "Wait for the username availability check to finish.";
      return;
    }
    const eventName = accountModalMode === "register" ? "account-register" : accountModalMode === "edit" ? "account-update" : "account-login";
    if (submit) submit.disabled = true;
    emitServer(eventName, payload, (response) => {
      if (!response?.success) {
        if (error) error.textContent = response?.error || "Account action failed.";
        if (accountModalMode === "register" && /already taken/i.test(String(response?.error || ""))) {
          usernameAvailability = false;
          setUsernameStatus("taken", "[X] That username is already taken.");
        }
        const announcer = $("#error-announcer");
        if (announcer) announcer.textContent = response?.error || "Account action failed.";
        if (submit) submit.disabled = accountModalMode === "register" && usernameAvailability === false;
        return;
      }
      updateAccountFromResponse(response);
      closeAccountModal();
      say(accountModalMode === "register" ? "Account created. Your identity is saved." : accountModalMode === "edit" ? "Account name updated." : "Signed in. Your identity is ready.");
    });
  });
  focusSurface("#account-modal", mode === "edit" ? "#account-display-input" : "#account-username-input");
}

function closeAccountModal() {
  closeSurface("#account-modal");
}

function logoutAccount() {
  const token = state.account?.sessionToken;
  if (token) emitServer("account-logout", { sessionToken: token }, () => {});
  saveAccountSession(null);
  state.tableAppearanceOverride = null;
  state.appearance = loadActiveDesignId(state.profiles);
  saveActiveDesignId(state.appearance);
  state.alias = loadGuestAlias();
  saveGuestAlias(state.alias);
  state.players = buildPlayers(activeAppearance(), state.alias);
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
  [0, 24, 6, 12], [9, 17, 5, 19], [15, 27, 4, 9], [20, 12, 6, 24], [27, 21, 5, 15],
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

const PATROL_BEST_KEY = "poorup.parlor-patrol.best.v1";
let homeHelicopterTimer = null;
let homeHelicopterFlightTimer = null;
let homePatrolStatusTimer = null;
let homeClockTimer = null;
let patrolHitAudio = null;
const patrolState = { score: 0, best: 0, active: false };
try { patrolState.best = Number(localStorage.getItem(PATROL_BEST_KEY)) || 0; } catch { /* storage unavailable */ }

function renderPatrolHud(status = "STANDBY · FLY-BYS OCCASIONAL") {
  const score = $("#home-patrol-score");
  const label = $("#home-patrol-status");
  if (score) score.textContent = String(patrolState.score).padStart(3, "0");
  if (label) label.textContent = status;
}

function renderHomeLocalTime() {
  const clock = $("#home-local-time");
  if (!clock) return;
  const now = new Date();
  clock.textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  clock.dateTime = now.toISOString();
}

function startHomeClock() {
  clearInterval(homeClockTimer);
  renderHomeLocalTime();
  homeClockTimer = setInterval(renderHomeLocalTime, 15000);
}

function stopHomeClock() {
  clearInterval(homeClockTimer);
  homeClockTimer = null;
}

function playPatrolHitSound() {
  if (!state.sound) return;
  try {
    patrolHitAudio = patrolHitAudio || new Audio("/assets/audio/parlor-patrol/pixel-hit-pack-cc0.wav");
    patrolHitAudio.volume = 0.32;
    patrolHitAudio.currentTime = 0;
    patrolHitAudio.play().catch(() => { /* browser gesture policy */ });
  } catch { /* audio unavailable */ }
}

function clearPatrolEffect(selector) {
  const effect = $(selector);
  if (!effect) return;
  effect.classList.remove("is-burst");
  effect.style.removeProperty("left");
  effect.style.removeProperty("top");
}

function hideHomeHelicopter() {
  const helicopter = $("#home-helicopter");
  if (!helicopter) return;
  helicopter.classList.remove("is-flying", "is-hit", "home-helicopter-left");
  const art = $("#home-helicopter-art");
  if (art) art.src = "/assets/parlor-patrol/helicopter-16-frames.svg";
  helicopter.setAttribute("aria-hidden", "true");
  helicopter.tabIndex = -1;
  helicopter.blur();
}

function stopHomeHelicopter() {
  clearTimeout(homeHelicopterTimer);
  clearTimeout(homeHelicopterFlightTimer);
  clearTimeout(homePatrolStatusTimer);
  homeHelicopterTimer = null;
  homeHelicopterFlightTimer = null;
  homePatrolStatusTimer = null;
  patrolState.active = false;
  hideHomeHelicopter();
  clearPatrolEffect("#home-patrol-impact");
  clearPatrolEffect("#home-patrol-smoke");
}

function scheduleHomeHelicopter(delay = 4000) {
  clearTimeout(homeHelicopterTimer);
  homeHelicopterTimer = null;
  if (state.phase !== "home") return;
  homeHelicopterTimer = setTimeout(() => {
    if (state.phase !== "home") return;
    const helicopter = $("#home-helicopter");
    if (!helicopter) return;
    patrolState.active = true;
    const direction = Math.random() < 0.5 ? "left" : "right";
    const art = $("#home-helicopter-art");
    if (art) art.src = direction === "left"
      ? "/assets/parlor-patrol/helicopter-left-16-frames.svg"
      : "/assets/parlor-patrol/helicopter-16-frames.svg";
    helicopter.classList.toggle("home-helicopter-left", direction === "left");
    helicopter.style.top = `${[12, 17, 22, 27, 32][Math.floor(Math.random() * 5)]}%`;
    helicopter.setAttribute("aria-hidden", "false");
    helicopter.tabIndex = 0;
    helicopter.classList.remove("is-hit", "is-flying");
    void helicopter.offsetWidth;
    helicopter.classList.add("is-flying");
    renderPatrolHud("FLY-BY ACTIVE · CLICK TO TAG");
    homeHelicopterFlightTimer = setTimeout(() => {
      if (!patrolState.active) return;
      patrolState.active = false;
      hideHomeHelicopter();
      renderPatrolHud("FLY-BY MISSED · NEXT ONE SOON");
      homePatrolStatusTimer = setTimeout(() => renderPatrolHud(), 2200);
      scheduleHomeHelicopter(12000);
    }, REDUCED_MOTION ? 6000 : 18000);
  }, delay);
}

function hitHomeHelicopter() {
  if (!patrolState.active || state.phase !== "home") return;
  const helicopter = $("#home-helicopter");
  const atmosphere = $(".home-sky-atmosphere");
  if (!helicopter || !atmosphere) return;
  patrolState.active = false;
  clearTimeout(homeHelicopterFlightTimer);
  homeHelicopterFlightTimer = null;
  const targetRect = helicopter.getBoundingClientRect();
  const atmosphereRect = atmosphere.getBoundingClientRect();
  const effectLeft = targetRect.left - atmosphereRect.left + targetRect.width / 2;
  const effectTop = targetRect.top - atmosphereRect.top + targetRect.height / 2;
  const impact = $("#home-patrol-impact");
  const smoke = $("#home-patrol-smoke");
  if (impact) {
    impact.style.left = `${Math.round(effectLeft - 32)}px`;
    impact.style.top = `${Math.round(effectTop - 32)}px`;
    impact.classList.remove("is-burst");
    void impact.offsetWidth;
    impact.classList.add("is-burst");
  }
  if (smoke) {
    smoke.style.left = `${Math.round(effectLeft - 40)}px`;
    smoke.style.top = `${Math.round(effectTop - 30)}px`;
    smoke.classList.remove("is-burst");
    void smoke.offsetWidth;
    smoke.classList.add("is-burst");
  }
  patrolState.score += 100;
  patrolState.best = Math.max(patrolState.best, patrolState.score);
  try { localStorage.setItem(PATROL_BEST_KEY, String(patrolState.best)); } catch { /* storage unavailable */ }
  playPatrolHitSound();
  hideHomeHelicopter();
  renderPatrolHud(`TAGGED +100 · BEST ${String(patrolState.best).padStart(3, "0")}`);
  homePatrolStatusTimer = setTimeout(() => renderPatrolHud(), 2400);
  setTimeout(() => {
    clearPatrolEffect("#home-patrol-impact");
    clearPatrolEffect("#home-patrol-smoke");
  }, 900);
  scheduleHomeHelicopter(9000);
}

const NIGHT_SHIFT_WAVE_MS = 60000;
const NIGHT_SHIFT_START_HEARTS = 3;
const NIGHT_SHIFT_BEST_KEY = "poorup.night-shift.best.v1";
let nightShiftWaveTimer = null;
let nightShiftTickTimer = null;
let nightShiftResultTimer = null;
let nightShiftSpawnTimers = [];
const nightShiftTargetTimers = new Map();
let nightShiftPausedAt = 0;
const nightShiftState = { active: false, wave: 0, score: 0, best: 0, endsAt: 0, targetSeq: 0, hearts: NIGHT_SHIFT_START_HEARTS };
try { nightShiftState.best = Number(localStorage.getItem(NIGHT_SHIFT_BEST_KEY)) || 0; } catch { /* storage unavailable */ }

function formatNightCountdown(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderNightShiftHud(message = "TAG THE FLY-BYS BEFORE THEY REACH THE BORDER") {
  const wave = $("#night-wave");
  const countdown = $("#home-local-time");
  const score = $("#home-patrol-score");
  const status = $("#night-status");
  const description = $("#night-shift-description");
  const nextWave = String(nightShiftState.wave).padStart(2, "0");
  const nextCountdown = formatNightCountdown(Math.max(0, nightShiftState.endsAt - Date.now()));
  const nextScore = String(nightShiftState.score).padStart(3, "0");
  if (wave && wave.textContent !== nextWave) wave.textContent = nextWave;
  if (countdown && countdown.textContent !== nextCountdown) countdown.textContent = nextCountdown;
  if (score && score.textContent !== nextScore) score.textContent = nextScore;
  if (status && status.textContent !== message) status.textContent = message;
  if (description && !nightShiftState.active) description.textContent = message;
  const hearts = $("#night-hearts");
  if (hearts) {
    const heartsLabel = `${nightShiftState.hearts} heart${nightShiftState.hearts === 1 ? "" : "s"} remaining`;
    if (hearts.getAttribute("aria-label") !== heartsLabel) {
      hearts.innerHTML = Array.from({ length: NIGHT_SHIFT_START_HEARTS }, (_, i) => `<img class="night-heart${i >= nightShiftState.hearts ? " is-empty" : ""}" src="/assets/parlor-patrol/heart.svg" alt="">`).join("");
      hearts.setAttribute("aria-label", heartsLabel);
    }
  }
}

function clearNightShiftTimers() {
  clearTimeout(nightShiftWaveTimer);
  clearInterval(nightShiftTickTimer);
  clearTimeout(nightShiftResultTimer);
  nightShiftWaveTimer = null;
  nightShiftTickTimer = null;
  nightShiftResultTimer = null;
  nightShiftSpawnTimers.forEach((timer) => clearTimeout(timer));
  nightShiftSpawnTimers = [];
  nightShiftTargetTimers.forEach(({ reveal, disable, miss }) => {
    clearTimeout(reveal);
    clearTimeout(disable);
    clearTimeout(miss);
  });
  nightShiftTargetTimers.clear();
}

function clearNightShiftTargets() {
  nightShiftTargetTimers.forEach(({ reveal, disable, miss }) => {
    clearTimeout(reveal);
    clearTimeout(disable);
    clearTimeout(miss);
  });
  nightShiftTargetTimers.clear();
  $("#night-targets")?.replaceChildren();
  const effects = $("#night-effects");
  effects?.querySelectorAll(".night-shift-dynamic").forEach((effect) => effect.remove());
  effects?.querySelectorAll("[data-night-home-effect]").forEach((effect) => {
    effect.classList.remove("is-burst");
    effect.style.removeProperty("left");
    effect.style.removeProperty("top");
  });
}

function announceSocialNotification(notification) {
  const text = notification?.body || notification?.title || "New social notification.";
  const announcer = $("#system-announcer");
  if (announcer) announcer.textContent = text;
}

function socialPlayerRowHTML(player, actionLabel = "VIEW") {
  if (!player) return "";
  const id = player.id || player.accountId;
  return `<div class="social-player-row"><div class="social-player-avatar">${avatarHTML(player, 3, 0)}</div><div class="social-player-main"><strong class="t-label f12 g100">${esc(player.displayName || player.name || "PLAYER")}</strong><span class="t-micro ink-3">@${esc(player.username || "guest")}</span></div><button class="btn-dark social-player-open" type="button" data-social-player="${esc(id)}"><span class="t-label f11">${actionLabel}</span></button></div>`;
}

function openSocialSurface(tab = "friends") {
  state.socialTab = ["friends", "requests", "invites", "notifications"].includes(tab) ? tab : "friends";
  showView("social");
  renderSocialSurface("#social-page-content");
  if (state.live) emitServer("get-social-data", {}, (response) => {
    if (response?.success && response.social) {
      state.social = response.social;
      renderSocialSurface("#social-page-content");
    }
  });
}

function renderSocialSurface(target = "#social-card") {
  const card = $(target) || $("#social-card");
  if (!card) return;
  const social = state.social || {};
  const signedIn = Boolean(state.account?.account);
  const tabs = [["friends", "FRIENDS"], ["requests", "REQUESTS"], ["invites", "INVITES"], ["notifications", "INBOX"]];
  const count = (social.requests?.length || 0) + (social.invites?.length || 0);
  let body = "";
  if (!signedIn) {
    body = `<div class="social-signin-note"><span class="t-label f13 g100">ACCOUNT REQUIRED</span><p class="t-body ink-2">Create an account to keep friends, invitations, and social history across rooms.</p><button class="cta-red" type="button" data-social-action="account"><span class="cta-text cta-text-sm">CREATE ACCOUNT</span></button></div>`;
  } else if (state.socialTab === "friends") {
    body = social.friends?.length ? social.friends.map((player) => socialPlayerRowHTML(player)).join("") : `<p class="t-body ink-3 social-empty">NO FRIENDS YET. Search by username or open someone from the table.</p>`;
  } else if (state.socialTab === "requests") {
    const incoming = social.requests?.map((request) => `<div class="social-request-row">${socialPlayerRowHTML(request.from, "VIEW")}<div class="social-request-actions"><button class="cta-red" type="button" data-social-request="accept" data-friendship-id="${esc(request.id)}"><span class="cta-text cta-text-sm">ACCEPT</span></button><button class="btn-dark" type="button" data-social-request="decline" data-friendship-id="${esc(request.id)}"><span class="t-label f11">DECLINE</span></button></div></div>`).join("") || "";
    const outgoing = social.outgoing?.map((request) => `<div class="social-request-row">${socialPlayerRowHTML(request.to, "VIEW")}<span class="t-micro ink-3">REQUEST SENT</span></div>`).join("") || "";
    body = incoming || outgoing ? `${incoming}${outgoing}` : `<p class="t-body ink-3 social-empty">NO PENDING REQUESTS.</p>`;
  } else if (state.socialTab === "invites") {
    body = social.invites?.length ? social.invites.map((invite) => `<div class="social-invite-row"><div><strong class="t-label f12 g100">${esc(invite.roomName || "AFTER HOURS")}</strong><span class="t-micro ink-3">${String(invite.visibility || "public").toUpperCase()} ROOM · EXPIRES ${esc(String(invite.expiresAt || "").slice(0, 16))}</span></div><div class="social-request-actions"><button class="cta-red" type="button" data-social-invite="accept" data-invite-id="${esc(invite.id)}"><span class="cta-text cta-text-sm">JOIN</span></button><button class="btn-dark" type="button" data-social-invite="decline" data-invite-id="${esc(invite.id)}"><span class="t-label f11">DECLINE</span></button></div></div>`).join("") : `<p class="t-body ink-3 social-empty">NO ROOM INVITES.</p>`;
  } else {
    body = social.notifications?.length ? social.notifications.map((notification) => `<div class="social-notification-row${notification.readAt ? "" : " is-unread"}"><div><strong class="t-label f12 g100">${esc(notification.title)}</strong><span class="t-body ink-2">${esc(notification.body)}</span><span class="t-micro ink-3">${esc(String(notification.createdAt || "").slice(0, 16))}</span></div>${notification.readAt ? "" : `<button class="btn-dark" type="button" data-notification-read="${esc(notification.id)}"><span class="t-label f11">READ</span></button>`}</div>`).join("") : `<p class="t-body ink-3 social-empty">NO NOTIFICATIONS.</p>`;
  }
  card.innerHTML = `<div class="social-surface-head"><div><div class="t-micro g400">PARLOR SOCIAL</div><h2 class="t-section g100" id="social-title">Social</h2><p class="t-body ink-2" id="social-description">Find people by their unique username, then manage friends and room invites without leaving the parlor.</p></div><button class="btn-dark social-close" id="social-close" type="button"><span class="t-label f11">CLOSE</span></button></div><div class="social-tabs" role="tablist" aria-label="Social views">${tabs.map(([id, label]) => `<button class="social-tab${state.socialTab === id ? " is-active" : ""}" type="button" role="tab" aria-selected="${state.socialTab === id}" data-social-tab="${id}"><span class="t-label f11">${label}${id === "requests" && count ? ` · ${social.requests?.length || 0}` : ""}</span></button>`).join("")}</div><form class="social-search" id="social-search-form"><label class="sr-only" for="social-search-input">Search by username</label><input class="field" id="social-search-input" name="username" autocomplete="off" placeholder="SEARCH USERNAME…" maxlength="16" pattern="[A-Za-z0-9_]{3,16}"><button class="btn-dark" type="submit"><span class="t-label f11">FIND</span></button></form><div class="social-search-results" id="social-search-results"></div><div class="social-surface-body thin-scroll">${body}</div>`;
}

function openRankingsSurface(metric = "wins") {
  state.leaderboard.metric = ["wins", "games", "rate", "achievements", "bankruptcies"].includes(metric) ? metric : "wins";
  showView("rankings");
  renderRankingsSurface("#rankings-page-content");
  if (state.live) {
    state.leaderboard.loading = true;
    emitServer("get-leaderboard", { metric: state.leaderboard.metric }, (response) => {
      state.leaderboard.loading = false;
      if (response?.success) state.leaderboard.rows = response.rows || [];
      renderRankingsSurface("#rankings-page-content");
    });
  }
}

function renderRankingsSurface(target = "#rankings-card") {
  const card = $(target) || $("#rankings-card");
  if (!card) return;
  const labels = { wins: "WINS", games: "GAMES", rate: "WIN RATE", achievements: "ACHIEVEMENTS", bankruptcies: "BANKRUPTCIES" };
  const metrics = Object.entries(labels).map(([id, label]) => `<button class="ranking-metric${state.leaderboard.metric === id ? " is-active" : ""}" type="button" data-ranking-metric="${id}"><span class="t-label f11">${label}</span></button>`).join("");
  const rows = state.leaderboard.loading ? `<p class="t-body ink-3 social-empty">LOADING VERIFIED RANKINGS…</p>` : state.leaderboard.rows?.length ? state.leaderboard.rows.map((row, index) => `<button class="ranking-row" type="button" data-ranking-player="${esc(row.accountId)}"><span class="ranking-place t-label f13">${String(index + 1).padStart(2, "0")}</span><span class="ranking-avatar">${avatarHTML(row, 3, index)}</span><span class="ranking-player"><strong class="t-label f12 g100">${esc(row.displayName)}</strong><span class="t-micro ink-3">${row.games} GAMES · ${row.wins} WINS</span></span><strong class="ranking-value t-label f16 green">${state.leaderboard.metric === "rate" ? `${row.value}%` : row.value}</strong></button>`).join("") : `<p class="t-body ink-3 social-empty">NO VERIFIED PLAYERS YET.</p>`;
  card.innerHTML = `<div class="social-surface-head"><div><div class="t-micro g400">PARLOR RECORDS · VERIFIED</div><h2 class="t-section g100" id="rankings-title">Global Rankings</h2><p class="t-body ink-2" id="rankings-description">Scores come from completed server games and verified achievements.</p></div><button class="btn-dark social-close" id="rankings-close" type="button"><span class="t-label f11">CLOSE</span></button></div><div class="ranking-metrics" role="tablist" aria-label="Ranking metric">${metrics}</div><div class="ranking-list thin-scroll">${rows}</div>`;
}

function openPlayerSurface(playerId) {
  const player = state.players.find((candidate) => String(candidate.serverId || candidate.id) === String(playerId));
  state.selectedPlayer = player ? { ...player } : { id: playerId, accountId: playerId, displayName: "PLAYER", color: "#cfa75f" };
  state.selectedPlayerRelationship = "none";
  state.selectedPlayerView = "profile";
  state.selectedPlayerHistory = null;
  renderPlayerSurface();
  openSurface("#player-modal", "#player-modal-close");
  if (state.selectedPlayer.accountId && state.live) emitServer("get-public-player-card", { accountId: state.selectedPlayer.accountId }, (response) => {
    if (response?.success && response.player) {
      state.selectedPlayer = { ...state.selectedPlayer, ...response.player };
      state.selectedPlayerRelationship = response.relationship;
      renderPlayerSurface();
    }
  });
}

function renderPlayerSurface() {
  const card = $("#player-card");
  const player = state.selectedPlayer;
  if (!card || !player) return;
  const accountId = player.accountId || player.id;
  if (state.selectedPlayerView === "history") {
    const history = state.selectedPlayerHistory || [];
    card.innerHTML = `<div class="social-surface-head"><div><div class="t-micro g400">PLAYER RECORD · SHARED VIEW</div><h2 class="t-section g100" id="player-modal-title">${esc(player.displayName || player.name)}</h2><p class="t-body ink-2" id="player-modal-description">Recent completed matches visible to you.</p></div><button class="btn-dark social-close" id="player-modal-close" type="button"><span class="t-label f11">CLOSE</span></button></div><div class="player-history-list thin-scroll">${history.length ? history.map((entry) => `<div class="player-history-row"><span class="t-micro ink-3">${esc(String(entry.playedAt || "").slice(0, 10))}</span><strong class="t-label f12 ${entry.won ? "green" : "g100"}">${entry.won ? "WIN" : "ROUND"}</strong><span class="t-micro ink-3">${entry.properties || 0} DEEDS</span></div>`).join("") : `<p class="t-body ink-3 social-empty">NO SHARED MATCH HISTORY AVAILABLE.</p>`}</div><button class="btn-dark social-back" id="player-modal-back" type="button"><span class="t-label f11">BACK TO PLAYER</span></button>`;
    return;
  }
  const friendStatus = state.selectedPlayerRelationship !== "none"
    ? state.selectedPlayerRelationship
    : (state.social.friends || []).some(friend => friend.id === accountId) ? "accepted" : "none";
  const isSelf = player.id === "p1";
  const canSocial = Boolean(player.accountId && !isSelf);
  const friendLabel = friendStatus === "accepted" ? "FRIENDS" : friendStatus === "requested" ? "REQUEST SENT" : "SEND FRIEND REQUEST";
  card.innerHTML = `<div class="social-surface-head"><div><div class="t-micro g400">PLAYER CARD · IN THIS ROOM</div><h2 class="t-section g100" id="player-modal-title">${esc(player.displayName || player.name)}</h2><p class="t-body ink-2" id="player-modal-description">Public details only. Private cash, loans, and hidden records stay hidden.</p></div><button class="btn-dark social-close" id="player-modal-close" type="button"><span class="t-label f11">CLOSE</span></button></div><div class="player-profile-head"><div class="player-profile-avatar">${avatarHTML(player, 6, 0)}</div><div><strong class="t-label f14 g100">${esc(player.displayName || player.name)}</strong><span class="t-micro ink-3">${player.online === false ? "OFFLINE" : "IN THIS ROOM"}</span></div></div><div class="player-profile-facts"><div><span class="t-micro ink-3">GAMES</span><strong class="t-label f13 g100">${player.stats?.gamesPlayed ?? "—"}</strong></div><div><span class="t-micro ink-3">WINS</span><strong class="t-label f13 green">${player.stats?.wins ?? "—"}</strong></div><div><span class="t-micro ink-3">ACHIEVEMENTS</span><strong class="t-label f13 g300">${player.achievements?.length ?? "—"}</strong></div></div><div class="player-profile-actions"><button class="cta-red" type="button" data-player-action="friend" ${canSocial && friendStatus !== "accepted" && friendStatus !== "requested" ? "" : "disabled"}><span class="cta-text cta-text-sm">${friendLabel}</span></button><button class="btn-dark" type="button" data-player-action="invite" ${canSocial ? "" : "disabled"}><span class="t-label f11">INVITE TO ROOM</span></button><button class="btn-dark" type="button" data-player-action="history" ${canSocial ? "" : "disabled"}><span class="t-label f11">MATCH HISTORY</span></button><button class="btn-dark" type="button" data-player-action="block" ${canSocial ? "" : "disabled"}><span class="t-label f11">BLOCK</span></button><button class="btn-dark" type="button" data-player-action="report" ${canSocial ? "" : "disabled"}><span class="t-label f11">REPORT</span></button></div>`;
}

function clearNightShiftTargetTimer(target) {
  const id = target?.dataset?.targetId;
  if (!id) return;
  const timers = nightShiftTargetTimers.get(id);
  if (!timers) return;
  clearTimeout(timers.reveal);
  clearTimeout(timers.disable);
  clearTimeout(timers.miss);
  nightShiftTargetTimers.delete(id);
}

function triggerNightShiftHomeEffect(x, y, kind) {
  const effects = $("#night-effects");
  if (!effects) return;
  const smoke = kind === "home-smoke";
  const selector = `[data-night-home-effect="${kind}"]`;
  let effect = effects.querySelector(selector);
  if (!effect) {
    effect = document.createElement("span");
    effect.className = `night-shift-effect night-shift-home-${smoke ? "smoke" : "impact"}`;
    effect.dataset.nightHomeEffect = kind;
    effect.innerHTML = smoke
      ? '<img src="/assets/parlor-patrol/smoke-6-frames.svg" alt="" width="80" height="64">'
      : '<img src="/assets/parlor-patrol/impact-8-frames.svg" alt="" width="64" height="64">';
    effects.appendChild(effect);
  }
  const width = smoke ? 80 : 64;
  const height = 64;
  const maxX = Math.max(width / 2, effects.clientWidth - width / 2);
  const maxY = Math.max(height / 2, effects.clientHeight - height / 2);
  const visibleX = Math.max(width / 2, Math.min(maxX, x));
  const visibleY = Math.max(height / 2, Math.min(maxY, y));
  effect.style.left = `${Math.round(visibleX - (smoke ? 40 : 32))}px`;
  effect.style.top = `${Math.round(visibleY - (smoke ? 30 : 32))}px`;
  effect.classList.remove("is-burst");
  // Match Home exactly: reset the class, force layout, then restart it.
  void effect.offsetWidth;
  effect.classList.add("is-burst");
}

function scheduleNightShiftTarget(target, duration) {
  if (!target || REDUCED_MOTION) {
    if (target) target.style.pointerEvents = "auto";
    return;
  }
  const id = target.dataset.targetId;
  const timers = { reveal: null, disable: null, miss: null };
  const settle = () => {
    if (document.hidden) {
      timers.miss = setTimeout(settle, 500);
      nightShiftTargetTimers.set(id, timers);
      return;
    }
    if (target.isConnected && !target.dataset.hit) missNightShiftTarget(target);
    nightShiftTargetTimers.delete(id);
  };
  target.style.pointerEvents = "none";
  timers.reveal = setTimeout(() => {
    if (target.isConnected && !target.dataset.hit) target.style.pointerEvents = "auto";
  }, Math.round(duration * 0.16));
  timers.disable = setTimeout(() => {
    if (target.isConnected && !target.dataset.hit) target.style.pointerEvents = "none";
  }, Math.round(duration * 0.94));
  target.addEventListener("animationend", settle, { once: true });
  timers.miss = setTimeout(settle, duration + 80);
  nightShiftTargetTimers.set(id, timers);
}

function spawnNightShiftEffect(x, y, kind = "impact") {
  const effects = $("#night-effects");
  if (!effects) return;
  if (kind === "home-impact" || kind === "home-smoke") {
    triggerNightShiftHomeEffect(x, y, kind);
    return;
  }
  const effect = document.createElement("span");
  const isHomeImpact = kind === "home-impact";
  const isHomeSmoke = kind === "home-smoke";
  const isAircraftBurst = kind === "drone" || kind === "airplane";
  effect.className = `night-shift-effect night-shift-dynamic ${isHomeImpact ? "night-shift-home-impact" : isHomeSmoke ? "night-shift-home-smoke" : isAircraftBurst ? "night-shift-aircraft-burst" : "is-burst"}`;
  const size = kind === "airplane" ? 128 : isAircraftBurst ? 112 : 64;
  const homeSize = isHomeSmoke ? [80, 64] : [64, 64];
  const width = isHomeImpact || isHomeSmoke ? homeSize[0] : size;
  const height = isHomeImpact || isHomeSmoke ? homeSize[1] : kind === "airplane" ? 112 : size;
  effect.style.width = `${width}px`;
  effect.style.height = `${height}px`;
  effect.style.left = `${Math.round(x - width / 2)}px`;
  effect.style.top = `${Math.round(y - height / 2)}px`;
  const src = kind === "airplane"
    ? "/assets/parlor-patrol/airplane-explosion-10-frames.svg"
    : kind === "drone"
      ? "/assets/parlor-patrol/drone-explosion-10-frames.svg"
      : isHomeSmoke
        ? "/assets/parlor-patrol/smoke-6-frames.svg"
      : "/assets/parlor-patrol/impact-8-frames.svg";
  effect.innerHTML = `<img src="${src}" alt="" width="${width}" height="${height}">`;
  effects.appendChild(effect);
  setTimeout(() => effect.remove(), isAircraftBurst ? 900 : isHomeSmoke ? 820 : isHomeImpact ? 600 : 720);
}

function spawnNightShiftTarget() {
  if (!nightShiftState.active || state.phase !== "home") return;
  if (document.hidden) {
    const timer = setTimeout(spawnNightShiftTarget, 500);
    nightShiftSpawnTimers.push(timer);
    return;
  }
  const layer = $("#night-targets");
  if (!layer) return;
  // Alternate lanes so a short play session always exercises both edges.
  const direction = nightShiftState.targetSeq % 2 === 0 ? "left" : "right";
  const spawnNumber = nightShiftState.targetSeq;
  const roll = Math.random();
  const kind = nightShiftState.wave === 1 && spawnNumber === 2
    ? "drone"
    : nightShiftState.wave >= 4 && roll < 0.12
    ? "airplane"
    : nightShiftState.wave >= 3 && roll < 0.24
      ? "beacon"
      : nightShiftState.wave >= 2 && roll < 0.44
        ? "drone"
        : "helicopter";
  const lane = [18, 25, 32, 39, 46, 53, 60][Math.floor(Math.random() * 7)];
  const duration = kind === "airplane"
    ? Math.max(2800, 5000 - nightShiftState.wave * 180)
    : kind === "drone"
      ? Math.max(3400, 5900 - nightShiftState.wave * 220)
      : Math.max(4200, 7600 - nightShiftState.wave * 260);
  const target = document.createElement("button");
  target.type = "button";
  const isDrop = kind === "beacon" || kind === "airplane";
  target.className = isDrop ? "night-target night-target-drop night-target-beacon is-flight" : `night-target night-target-${direction} night-target-${kind} is-flight`;
  if (kind === "airplane") target.classList.replace("night-target-beacon", "night-target-airplane");
  if (isDrop) target.style.setProperty("--night-drop-left", `${[18, 32, 48, 64, 78][Math.floor(Math.random() * 5)]}%`);
  else target.style.top = `${lane}%`;
  target.style.setProperty("--night-flight-duration", `${duration}ms`);
  target.dataset.direction = direction;
  target.dataset.kind = kind;
  target.dataset.targetId = String(++nightShiftState.targetSeq);
  target.setAttribute("aria-label", `Tag Night Shift ${kind}, wave ${nightShiftState.wave}`);
  const src = kind === "beacon"
    ? "/assets/parlor-patrol/beacon-6-frames.svg"
    : kind === "drone"
      ? "/assets/parlor-patrol/drone-8-frames.svg"
      : kind === "airplane"
        ? "/assets/parlor-patrol/airplane-10-frames.svg"
      : direction === "left"
        ? "/assets/parlor-patrol/helicopter-left-16-frames.svg"
        : "/assets/parlor-patrol/helicopter-16-frames.svg";
  const size = kind === "beacon" ? [48, 48] : kind === "drone" ? [96, 64] : kind === "airplane" ? [112, 64] : [128, 64];
  target.style.width = `${size[0]}px`;
  target.style.height = `${size[1]}px`;
  target.innerHTML = `<img src="${src}" alt="" width="${size[0]}" height="${size[1]}">`;
  if (kind === "airplane" && direction === "left") target.querySelector("img")?.style.setProperty("transform", "scaleX(-1)");
  // Pointer-down gives the arcade target immediate feedback before a moving
  // button can travel between pointer press and the browser's click release.
  target.addEventListener("pointerdown", (event) => hitNightShiftTarget(target, event));
  target.addEventListener("click", (event) => hitNightShiftTarget(target, event));
  layer.appendChild(target);
  scheduleNightShiftTarget(target, duration);
}

function beginNightShiftWave() {
  if (!nightShiftState.active) return;
  clearNightShiftTargets();
  nightShiftState.endsAt = Date.now() + NIGHT_SHIFT_WAVE_MS;
  renderNightShiftHud(`WAVE ${String(nightShiftState.wave).padStart(2, "0")} · CLEAR THE SKYLINE`);
  const banner = $("#night-wave-banner");
  if (banner) {
    banner.textContent = `WAVE ${String(nightShiftState.wave).padStart(2, "0")}`;
    banner.classList.remove("is-announcing");
    void banner.offsetWidth;
    banner.classList.add("is-announcing");
  }
  const targetCount = Math.min(6 + nightShiftState.wave * 2, 24);
  const interval = nightShiftState.wave === 1
    ? 3000
    : Math.max(850, 5000 - nightShiftState.wave * 220);
  for (let i = 0; i < targetCount; i += 1) {
    nightShiftSpawnTimers.push(setTimeout(spawnNightShiftTarget, i * interval));
  }
  nightShiftWaveTimer = setTimeout(() => {
    if (!nightShiftState.active) return;
    if (document.hidden) {
      nightShiftWaveTimer = setTimeout(() => {
        if (!nightShiftState.active) return;
        nightShiftState.wave += 1;
        beginNightShiftWave();
      }, 500);
      return;
    }
    nightShiftState.wave += 1;
    beginNightShiftWave();
  }, NIGHT_SHIFT_WAVE_MS);
}

function missNightShiftTarget(target) {
  if (!target?.isConnected || target.dataset.hit || target.dataset.missed) return;
  clearNightShiftTargetTimer(target);
  target.dataset.missed = "1";
  target.remove();
  if (["helicopter", "drone", "airplane"].includes(target.dataset.kind)) {
    nightShiftState.hearts = Math.max(0, nightShiftState.hearts - 1);
    renderNightShiftHud(`${String(target.dataset.kind).toUpperCase()} ESCAPED · ${nightShiftState.hearts} HEART${nightShiftState.hearts === 1 ? "" : "S"} LEFT`);
    if (nightShiftState.hearts <= 0) endNightShift("SHIFT LOST · NO HEARTS LEFT");
  }
}

function endNightShift(message) {
  if (!nightShiftState.active) return;
  nightShiftState.active = false;
  clearNightShiftTimers();
  clearNightShiftTargets();
  nightShiftState.best = Math.max(nightShiftState.best, nightShiftState.score);
  try { localStorage.setItem(NIGHT_SHIFT_BEST_KEY, String(nightShiftState.best)); } catch { /* storage unavailable */ }
  renderNightShiftHud(`${message} · FINAL ${String(nightShiftState.score).padStart(4, "0")} · ESC TO EXIT`);
  const banner = $("#night-wave-banner");
  if (banner) {
    banner.textContent = message.includes("LOST") ? "SHIFT LOST" : "SHIFT CLEAR";
    banner.classList.remove("is-announcing");
    void banner.offsetWidth;
    banner.classList.add("is-announcing");
  }
  nightShiftResultTimer = setTimeout(() => {
    nightShiftResultTimer = null;
    stopNightShift();
  }, 2600);
}

function hitNightShiftTarget(target, event) {
  if (!nightShiftState.active || state.phase !== "home" || !target?.isConnected || target.dataset.hit) return;
  // Measure the transformed, live position before clearing the flight class.
  // This mirrors Home's hit path and prevents effects from snapping back to
  // the left/right/top spawn edge.
  const rect = target.getBoundingClientRect();
  const atmosphere = $("#night-shift");
  const area = atmosphere?.getBoundingClientRect();
  if (!area) return;
  const pointerX = Number(event?.clientX) > 0 ? Number(event.clientX) : rect.left + rect.width / 2;
  const pointerY = Number(event?.clientY) > 0 ? Number(event.clientY) : rect.top + rect.height / 2;
  const hitX = pointerX - area.left;
  const hitY = pointerY - area.top;
  target.dataset.hit = "1";
  clearNightShiftTargetTimer(target);
  target.classList.remove("is-flight");
  const direction = target.dataset.direction === "left" ? -1 : 1;
  const kind = target.dataset.kind || "helicopter";
  if (kind !== "helicopter") target.classList.add("is-popping");
  const crashArt = target.querySelector("img");
  if (kind !== "helicopter") {
    if (crashArt) crashArt.style.transform = ["drone", "airplane"].includes(kind) && direction === -1 ? "scaleX(-1)" : "";
    if (REDUCED_MOTION) {
      target.style.opacity = "0";
      spawnNightShiftEffect(hitX, hitY, kind);
      setTimeout(() => target.remove(), 160);
    } else {
      target.animate([
        { transform: "translate3d(0, 0, 0) scale(0.96)", opacity: 0.9 },
        { transform: `translate3d(0, -8px, 0) scale(1.04)`, opacity: 0.95 },
        { transform: "translate3d(0, 0, 0) scale(1.02)", opacity: 0 },
      ], { duration: 360, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" });
      setTimeout(() => {
        if (!target.isConnected) return;
        spawnNightShiftEffect(hitX, hitY, kind);
        target.remove();
      }, 280);
    }
  } else {
    target.remove();
    // Match the Home patrol feedback: a compact impact flash and a short
    // stepped smoke trail begin at the exact point of the shot.
    spawnNightShiftEffect(hitX, hitY, "home-impact");
    spawnNightShiftEffect(hitX, hitY + 8, "home-smoke");
  }
  const points = kind === "helicopter"
    ? 100 + nightShiftState.wave * 25
    : kind === "drone"
      ? 75 + nightShiftState.wave * 10
      : kind === "airplane"
        ? 180 + nightShiftState.wave * 20
        : 50 + nightShiftState.wave * 5;
  nightShiftState.score += points;
  nightShiftState.best = Math.max(nightShiftState.best, nightShiftState.score);
  try { localStorage.setItem(NIGHT_SHIFT_BEST_KEY, String(nightShiftState.best)); } catch { /* storage unavailable */ }
  playPatrolHitSound();
  renderNightShiftHud(`TAGGED +${points} · WAVE ${String(nightShiftState.wave).padStart(2, "0")}`);
}

function startNightShift() {
  if (state.phase !== "home" || nightShiftState.active) return;
  // A stale room session may still emit snapshots while the player is Home.
  // Keep this local arcade layer isolated until the player explicitly joins again.
  clearNightShiftTimers();
  state.suppressRoomUpdates = true;
  stopHomeHelicopter();
  stopHomeClock();
  nightShiftState.active = true;
  nightShiftState.wave = 1;
  nightShiftState.score = 0;
  nightShiftState.hearts = NIGHT_SHIFT_START_HEARTS;
  nightShiftState.targetSeq = 0;
  renderPatrolHud("NIGHT SHIFT ACTIVE · CLEAR THE SKYLINE");
  document.body.classList.add("night-shift-open");
  const surface = $("#night-shift");
  surface?.classList.remove("is-hidden");
  surface?.setAttribute("aria-hidden", "false");
  hydrateSprites(surface || document);
  $("#night-exit")?.focus({ preventScroll: true });
  nightShiftTickTimer = setInterval(() => renderNightShiftHud(), 200);
  beginNightShiftWave();
}

function stopNightShift() {
  clearNightShiftTimers();
  nightShiftPausedAt = 0;
  nightShiftState.active = false;
  clearNightShiftTargets();
  document.body.classList.remove("night-shift-open");
  document.body.classList.remove("night-shift-paused");
  $("#night-wave-banner")?.classList.remove("is-announcing");
  $("#night-shift")?.classList.add("is-hidden");
  $("#night-shift")?.setAttribute("aria-hidden", "true");
  renderNightShiftHud("TAG THE FLY-BYS BEFORE THEY REACH THE BORDER");
  if (state.phase === "home") {
    startHomeClock();
    renderPatrolHud();
    scheduleHomeHelicopter(4000);
  }
}

document.addEventListener("visibilitychange", () => {
  if (!nightShiftState.active) return;
  if (document.hidden) {
    nightShiftPausedAt = Date.now();
    document.body.classList.add("night-shift-paused");
    return;
  }
  if (nightShiftPausedAt) {
    nightShiftState.endsAt += Date.now() - nightShiftPausedAt;
    nightShiftPausedAt = 0;
  }
  document.body.classList.remove("night-shift-paused");
  renderNightShiftHud("NIGHT SHIFT RESUMED · CLEAR THE SKYLINE");
});

function syncHomeMusic() {
  const music = $("#home-music");
  if (!music) return;
  music.volume = 0.16;
  // The sound preference is global. Keep the same soundtrack running while
  // the player moves from Home into setup, lobby, or the live table.
  if (state.music) {
    const playAttempt = music.play();
    playAttempt?.catch(() => { /* autoplay policy; the next user gesture retries */ });
  } else {
    music.pause();
  }
}

let roomsDirectory = [];
let roomsLoading = false;
let roomsFilter = "all";
let drawerFilter = "all";
let roomModalTab = "browse"; // "browse" | "create" | "join"
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
  const isPrivate = r.visibility === "private";
  const visLabel = isPrivate ? "PRIVATE" : "PUBLIC · DIRECT JOIN";
  return `<div class="room-row">
    <div class="room-main">
      <div class="room-top">
        ${isPrivate ? `<span class="t-label f12 room-code">${r.code}</span>` : `<span class="t-label f12 room-code room-code-public">OPEN TABLE</span>`}
        <span class="t-label f13 room-name">${r.name}</span>
        <span class="t-micro g400" style="margin-left:4px">${visLabel}</span>
        <span class="room-meta-item room-state-tag"><span class="st-dot" style="background:${roomStateColor(r.state)}"></span><span class="t-micro ink-3">${r.state}</span></span>
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
      ${isPrivate ? `<button class="btn-dark" data-copy="${r.code}" title="Copy code"><span class="t-label f11">COPY</span></button>` : ""}
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
    : `<div class="rooms-empty t-body">NO PUBLIC TABLES RIGHT NOW. HOST ONE OR ENTER A CODE.</div>`;

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
  const isJoin = tab === "join";

  const btnBrowse = $("#rm-tab-browse");
  const btnCreate = $("#rm-tab-create");
  const btnJoin = $("#rm-tab-join");
  if (btnBrowse) {
    btnBrowse.classList.toggle("is-active", isBrowse);
    btnBrowse.setAttribute("aria-selected", String(isBrowse));
  }
  if (btnCreate) {
    btnCreate.classList.toggle("is-active", isCreate);
    btnCreate.setAttribute("aria-selected", String(isCreate));
  }
  if (btnJoin) {
    btnJoin.classList.toggle("is-active", isJoin);
    btnJoin.setAttribute("aria-selected", String(isJoin));
  }

  const panelBrowse = $("#rm-panel-browse");
  const panelCreate = $("#rm-panel-create");
  const panelJoin = $("#rm-panel-join");
  if (panelBrowse) panelBrowse.classList.toggle("is-hidden", !isBrowse);
  if (panelCreate) panelCreate.classList.toggle("is-hidden", !isCreate);
  if (panelJoin) panelJoin.classList.toggle("is-hidden", !isJoin);

  const titleText = $("#rooms-title-text");
  if (titleText) titleText.textContent = isBrowse ? "Available Rooms" : isJoin ? "Join Room" : "Create Custom Room";
  $("#rooms-modal")?.setAttribute("aria-describedby", isJoin ? "join-room-description" : "rooms-description");

  if (isBrowse) {
    renderRoomsList();
  } else if (isCreate) {
    updateCreateRoomUI();
  } else if (isJoin) {
    const code = $("#room-join");
    const nickname = $("#join-nickname");
    const nicknameField = $("#join-nickname-field");
    const signedIn = Boolean(state.account?.account);
    const description = $("#join-room-description");
    if (code) code.value = String(code.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (nickname) {
      nickname.value = signedIn ? state.account.account.displayName : (nickname.value || state.alias || "");
      nickname.required = !signedIn;
      nickname.disabled = signedIn;
    }
    nicknameField?.classList.toggle("is-hidden", signedIn);
    if (description) description.textContent = signedIn
      ? "Enter the room code. Your account display name will be used at the table."
      : "Enter the room code and the name you want to use at the table.";
    $("#join-form-error")?.replaceChildren();
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
  openSurface("#rooms-modal", tab === "join" ? "#room-join" : "#rooms-close");
  if (tab === "browse") requestRoomsDirectory();
}

function closeRoomsModal() {
  closeSurface("#rooms-modal");
  if (state.phase === "home") setHomeTab("play");
}

function renderHome() {
  setHomeTab("play");
  renderHomeLocalTime();
  renderPatrolHud();
  paintSkyline($("#home-skyline"), SKYLINE);
  paintSkyline($("#home-skyline-copy"), SKYLINE);

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
  const saveBtn = $("#pl-save-btn");
  const atCap = state.profiles.length >= MAX_PROFILES;
  if (newBtn) {
    newBtn.disabled = atCap;
    newBtn.querySelector(".t-label").textContent = atCap ? `MAX ${MAX_PROFILES} DESIGNS` : "+ NEW DESIGN";
  }
  if (saveBtn) {
    saveBtn.disabled = !state.profileDraft || atCap;
    saveBtn.querySelector(".cta-text").textContent = atCap ? `MAX ${MAX_PROFILES} DESIGNS` : "SAVE DESIGN";
  }
  if (!list) return;
  if (!state.profiles.length) {
    if (!state.profileDraft) {
      list.innerHTML = `<p class="pl-empty">No custom designs yet — press <strong style="color:var(--gold-300)">+ NEW DESIGN</strong> to draw your first player.</p>`;
      return;
    }
  }
  const activeId = typeof state.appearance === "string" ? state.appearance : null;
  const draft = state.profileDraft;
  const draftCard = draft && !state.editingProfileId
    ? { id: "draft", designName: draft.designName || "UNTITLED DESIGN", color: draft.color, avatarGrid: draft.grid, isDraft: true }
    : null;
  const cards = state.profiles.map((profile, i) => {
    const editing = draft && state.editingProfileId === profile.id;
    return {
      ...profile,
      designName: editing ? (draft.designName || "UNTITLED DESIGN") : profileDesignName(profile),
      color: editing ? draft.color : profile.color,
      avatarGrid: editing ? draft.grid : profile.avatarGrid,
      isEditing: Boolean(editing),
      seed: i,
    };
  });
  if (draftCard) cards.unshift(draftCard);
  list.innerHTML = cards.map((p, i) => {
    const isDraft = Boolean(p.isDraft);
    const selected = !isDraft && p.id === activeId;
    const editing = Boolean(p.isEditing);
    const entity = { color: p.color, avatarGrid: p.avatarGrid };
    return `<div class="pl-tile${selected ? " is-active" : ""}${isDraft ? " is-draft" : ""}${editing ? " is-editing" : ""}">
      ${isDraft ? `<div class="pl-tile-select pl-tile-draft" aria-label="Unsaved design preview"><span class="pl-tile-av">${avatarHTML(entity, 3, i)}</span><span class="pl-tile-info"><span class="t-label pl-tile-name" style="color:${p.color}">${esc(p.designName)}</span><span class="t-micro g400">UNSAVED DRAFT · LIVE PREVIEW</span></span></div>` : `<button class="pl-tile-select" type="button" data-profile-select="${p.id}" aria-pressed="${selected}"><span class="pl-tile-av">${avatarHTML(entity, 3, i)}</span><span class="pl-tile-info"><span class="t-label pl-tile-name" style="color:${p.color}">${esc(p.designName)}</span><span class="t-micro ink-3">${editing ? "EDITING · LIVE PREVIEW" : selected ? "ACTIVE DESIGN" : "TAP TO SELECT"}</span></span></button>`}
      <div class="pl-tile-actions">${isDraft ? `<span class="t-micro g400 pl-draft-badge">DRAFT</span>` : `<button class="btn-dark" type="button" data-profile-edit="${p.id}"><span class="t-label">EDIT</span></button><button class="btn-dark pl-delete" type="button" data-profile-delete="${p.id}"><span class="t-label">DELETE</span></button>`}</div>
    </div>`;
  }).join("");
}

/** Reflect the saved profile (or the default guest identity) across the home screen. */
function applyProfileToHomeUI() {
  const p = typeof state.appearance === "string" ? getProfileById(state.appearance) : null;
  const account = state.account?.account || null;
  const name = account?.displayName || state.alias || "PLAYER";
  const preset = getAppearanceMeta(state.appearance);
  const color = p?.color || account?.color || preset.color || "#d74438";
  const avatarSource = p || account;

  document.querySelectorAll("[data-global-you-name]").forEach((nameNode) => {
    nameNode.textContent = name;
  });
  document.querySelectorAll("[data-global-you-avatar]").forEach((avatarNode) => {
    avatarNode.innerHTML = avatarSource?.avatarGrid ? spriteFromGrid(avatarSource.avatarGrid, 3) : avatarHTML({ color }, 3, 0);
  });

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
async function copyRoomCode() {
  if (state.roomVisibility === "public") return;
  const code = String(state.roomCode || "").trim().toUpperCase();
  if (!code) return;
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
      copied = true;
    }
  } catch { /* fall through to the legacy local fallback */ }
  if (!copied) {
    const helper = document.createElement("textarea");
    helper.value = code;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    try { copied = document.execCommand("copy"); } catch { copied = false; }
    helper.remove();
  }
  const badge = $("#tn-room-copy");
  const announcer = $("#system-announcer");
  if (copied) {
    if (announcer) announcer.textContent = `ROOM CODE ${code} COPIED`;
    badge?.classList.add("is-copied");
    window.setTimeout(() => badge?.classList.remove("is-copied"), 1000);
  } else if (announcer) {
    announcer.textContent = "ROOM CODE COULD NOT BE COPIED";
  }
}

function renderTopNav() {
  const code = state.roomCode || "----";
  const isPublic = state.roomVisibility === "public";
  $("#tn-room").textContent = isPublic ? "PUBLIC" : code;
  $("#tn-room-copy")?.classList.toggle("is-public", isPublic);
  if ($("#tn-room-copy")) $("#tn-room-copy").disabled = isPublic;
  $("#tn-room-copy")?.setAttribute("aria-label", isPublic ? "Public room" : code === "----" ? "Room code unavailable" : `Copy room code ${code}`);
  $("#tn-room-copy")?.setAttribute("title", isPublic ? "Public room" : code === "----" ? "Room code unavailable" : `Copy room code ${code}`);
  $("#tn-lobby").textContent = isPublic ? "AFTER HOURS · PUBLIC" : `AFTER HOURS ${state.roomCode || "----"}`;
  $("#tn-online").textContent = state.live
    ? (state.connectionStatus === "online" ? `${state.players.filter((p) => p.online).length} ONLINE` : (CONNECTION_COPY[state.connectionStatus] || "OFFLINE"))
    : state.phase === "playing" ? `${state.players.length} SEATED` : "OFFLINE";
  $("#tn-turnlabel").textContent = state.phase === "playing" ? state.players[state.turnIndex].name : state.phase === "lobby" ? "LOBBY" : "SETUP";
  renderConnectionStatus();
}

function renderPlayers() {
  const seated = state.players.slice(0, state.settings.maxPlayers);
  const existingBots = seated.filter((p) => p.bot).length;
  const previewBots = state.phase === "setup" || state.phase === "lobby"
    ? buildBotPreviewPlayers(Math.max(0, state.settings.bots - existingBots))
    : [];
  const players = [...seated, ...previewBots].slice(0, state.settings.maxPlayers);
  $("#player-list").innerHTML = players
    .map((p, i) => {
      const active = i === state.turnIndex && state.phase === "playing";
      const playerId = p.serverId || p.id;
      return `<button class="player-row player-row-action${active ? " is-active" : ""}" type="button" data-player-id="${esc(playerId)}" aria-label="Open player card for ${esc(p.name)}">
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
      </button>`;
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
    case "chest": return `<img class="board-icon-mark board-icon-chest" src="/assets/board-icons/treasure-chest.svg" alt="Treasure">`;
    case "railroad": return tile.name.includes("AIRPORT")
      ? `<img class="airport-mark" src="/assets/airport-plane.svg" alt="Airport">`
      : spriteHTML("train", 3);
    case "utility": return tile.name === "ELECTRIC COMPANY" ? spriteHTML("bulb", 3) : spriteHTML("faucet", 3);
    case "chance": return `<img class="board-icon-mark board-icon-surprise" src="/assets/board-icons/surprise.svg" alt="Surprise">`;
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
    case "left": return `background:${c};top:0;bottom:0;right:0;width:22%;border-left:1px solid #01070a`;
    case "right": return `background:${c};top:0;bottom:0;left:0;width:22%;border-right:1px solid #01070a`;
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
    el.className = `tile side-${tile.side}${tile.group ? " has-strip" : ""}${tile.name.includes("AIRPORT") ? " airport-tile" : ""}`;
    el.dataset.tile = String(tile.i);
    el.style.gridColumn = String(tile.col);
    el.style.gridRow = String(tile.row);

    const words = tile.name.split(" ").map((w) => `<span style="display:block">${w}</span>`).join("");

    if (tile.kind.startsWith("corner")) {
      el.classList.add("is-corner");
      if (tile.kind === "corner-go") {
        el.innerHTML = `<span class="go-big">GO</span>
          <span class="t-tile tile-name" style="color:#a79d7d">COLLECT</span>
          <span class="t-tile tile-price" style="color:#cfa75f">$200</span>`;
      } else if (tile.kind === "corner-jail") {
        el.innerHTML = `<span class="passing-by-corner-layout">
          <span class="t-tile tile-name passing-by-corner-label">PASSING BY</span>
          <span class="passing-by-prison-zone" aria-hidden="true">
            <img class="passing-by-bars-art" src="/assets/board-icons/passing-by-bars.svg" alt="">
          </span>
          <span class="passing-by-token-anchor passing-by-token-anchor-pass" data-tile-anchor="passing" aria-hidden="true"></span>
          <span class="passing-by-token-anchor passing-by-token-anchor-prison" data-tile-anchor="prison" aria-hidden="true"></span>
        </span>`;
      } else if (tile.kind === "corner-go-jail") {
        el.innerHTML = `<svg class="jail-bars" viewBox="0 0 16 10" shape-rendering="crispEdges" aria-hidden="true">
            ${[1, 4, 7, 10, 13].map((x) => `<rect x="${x}" y="0" width="1.4" height="10" fill="#d74438"/>`).join("")}
            <rect x="0" y="4" width="16" height="1.2" fill="#d74438"/></svg>
          <span class="t-tile tile-name" style="color:#d74438">PRISON</span>`;
      } else {
        el.innerHTML = `<span class="t-tile tile-name">${words}</span>${tileIconHTML(tile)}`;
      }
    } else {
      const verticalChest = (tile.side === "left" || tile.side === "right") && tile.kind === "chest";
      const iconOnly = tile.kind === "chance";
      const tileFace = iconOnly
        ? `<span class="tile-face tile-face-special"><span class="tile-icon tile-icon-large">${tileIconHTML(tile)}</span></span>`
        : verticalChest
          ? `<span class="tile-face tile-face-special"><span class="t-tile tile-name">${words}</span><span class="tile-icon tile-icon-large">${tileIconHTML(tile)}</span></span>`
        : tile.kind === "tax"
          ? `<span class="tile-face"><span class="t-tile tile-name">${words}</span></span>`
        : `<span class="tile-face"><span class="t-tile tile-name">${words}</span><span class="tile-icon">${tileIconHTML(tile)}</span>${tile.price != null
          ? `<span class="t-tile tile-price">${tile.kind === "tax" ? `PAY $${tile.price}` : `$${tile.price}`}</span>`
          : ""}</span>`;
      el.innerHTML =
        (tile.group ? `<span class="tile-strip" style="${stripStyle(tile)}"></span>` : "") +
        `<span class="tile-owner" style="display:none"></span>` + tileFace;
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

function tileCenter(i, zone = "passing") {
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

function playerTileCenter(player, i = player?.pos) {
  const zone = Number(i) === JAIL_TILE_INDEX && state.jail?.[player?.id] ? "prison" : "passing";
  return tileCenter(i, zone);
}

const pieceWalks = new Map();
const PIECE_WALK_STEP_MS = 130;

function cancelPieceWalk(playerId) {
  const walk = pieceWalks.get(playerId);
  if (!walk) return;
  walk.cancelled = true;
  clearTimeout(walk.timer);
  pieceWalks.delete(playerId);
  const el = $("#token-layer")?.querySelector(`.piece[data-player="${playerId}"]`);
  el?.classList.remove("is-moving", "is-hopping");
}

function pieceWalkPath(from, to) {
  const distance = (to - from + TILE_COUNT) % TILE_COUNT;
  if (!distance || distance > 12) return [];
  return Array.from({ length: distance }, (_, index) => (from + index + 1) % TILE_COUNT);
}

function startPieceWalk(playerId, from, to) {
  const path = pieceWalkPath(Number(from) || 0, Number(to) || 0);
  const layer = $("#token-layer");
  const el = layer?.querySelector(`.piece[data-player="${playerId}"]`);
  if (!el || !path.length || REDUCED_MOTION) return;
  cancelPieceWalk(playerId);
  const player = state.players.find((entry) => entry.id === playerId);
  const start = playerTileCenter(player, Number(from) || 0);
  if (!start) return;
  const walk = { cancelled: false, index: 0, timer: null };
  pieceWalks.set(playerId, walk);
  el.classList.add("is-moving");
  el.style.setProperty("--piece-x", `${Math.round(start.x)}px`);
  el.style.setProperty("--piece-y", `${Math.round(start.y)}px`);

  const advance = () => {
    if (walk.cancelled || pieceWalks.get(playerId) !== walk) return;
    const next = path[walk.index++];
    // A walk across the combined Passing By corner always uses the open lane.
    const center = tileCenter(next, "passing");
    if (!center) {
      cancelPieceWalk(playerId);
      placePieces();
      return;
    }
    el.style.setProperty("--piece-x", `${Math.round(center.x)}px`);
    el.style.setProperty("--piece-y", `${Math.round(center.y)}px`);
    el.classList.remove("is-hopping");
    void el.offsetWidth;
    el.classList.add("is-hopping");
    if (walk.index >= path.length) {
      walk.timer = setTimeout(() => {
        if (pieceWalks.get(playerId) !== walk) return;
        pieceWalks.delete(playerId);
        el.classList.remove("is-moving", "is-hopping");
        placePieces();
      }, PIECE_WALK_STEP_MS);
      return;
    }
    walk.timer = setTimeout(advance, PIECE_WALK_STEP_MS);
  };
  walk.timer = setTimeout(advance, 16);
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

  pieceWalks.forEach((_, playerId) => {
    if (!state.players.some((player) => player.id === playerId)) cancelPieceWalk(playerId);
  });

  const occupants = {};
  state.players.forEach((p) => {
    (occupants[p.pos] ||= []).push(p.id);
  });

  state.players.forEach((p) => {
    const el = layer.querySelector(`.piece[data-player="${p.id}"]`);
    if (!el) return;
    const c = playerTileCenter(p);
    if (!c) return;
    const stack = occupants[p.pos] || [p.id];
    const idx = Math.max(0, stack.indexOf(p.id));
    const off = stack.length === 1 ? { x: 0, y: 0 } : STACK_OFF[idx] || { x: 0, y: 0 };
    const active = state.phase === "playing" && state.players[state.turnIndex]?.id === p.id;
    el.classList.toggle("is-active", active);
    if (pieceWalks.has(p.id)) {
      el.classList.add("is-moving");
      return;
    }
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
    $("#hud-loan-status")?.classList.add("is-hidden");
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
  const loanStatus = $("#hud-loan-status");
  const currentLoan = cur?.bankLoan;
  if (loanStatus) {
    const showLoan = !waiting && currentLoan && ["active", "due"].includes(currentLoan.status);
    loanStatus.classList.toggle("is-hidden", !showLoan);
    if (showLoan) loanStatus.textContent = `BANK DEBT · $${Number(currentLoan.remaining || 0).toLocaleString()} · DUE R${currentLoan.dueRound || "—"}`;
  }

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
  const jailCardBtn = $("#use-jail-free");
  if (jailCardBtn) {
    const canUseJailCard = !waiting && !isLobby && humanTurn && inJail && state.turnStage === "roll" && (cur.jailFree || 0) > 0;
    jailCardBtn.classList.toggle("is-hidden", !canUseJailCard);
    jailCardBtn.disabled = state.busy;
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
function cardFaceHTML(tile, ev, { index = null, total = null, buttonId = null } = {}) {
  const amount = Number(ev.cash) || 0;
  const kind = tile.kind === "chance" ? "SURPRISE" : "TREASURE";
  const color = tile.kind === "chance" ? "#d74438" : "#cfa75f";
  const variableAction = ["repairs", "payEach", "collectFromEach", "nearestRailroad", "nearestUtility"].includes(ev.action);
  const amountLabel = amount > 0 ? `+$${amount}` : amount < 0 ? `−$${Math.abs(amount)}` : variableAction ? "VARIABLE" : "RESOLVED";
  let outcomeLabel = "RESULT";
  if (["repairs", "payEach"].includes(ev.action)) outcomeLabel = "PAID TOTAL";
  else if (ev.action === "collectFromEach") outcomeLabel = "COLLECTED TOTAL";
  else if (["nearestRailroad", "nearestUtility"].includes(ev.action)) outcomeLabel = "SUPPORT RENT";
  else if (ev.action === "pay") outcomeLabel = "PAID";
  else if (["collect", "collectStart"].includes(ev.action)) outcomeLabel = "COLLECTED";
  const sequence = Number.isInteger(index) && Number.isInteger(total)
    ? `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`
    : "JUST DRAWN";
  const titleId = buttonId ? "card-reveal-title" : "";
  return `<article class="cr-card" style="--cr-accent:${color}">
    <div class="cr-rail"></div>
    <div class="cr-body">
      <div class="cr-meta">
        <span class="cr-kind"><span class="t-micro g400">${kind}</span></span>
        <span class="cr-sequence t-micro ink-3">${sequence}</span>
      </div>
      <div class="cr-icon" aria-hidden="true">${tileIconHTML(tile)}</div>
      <span class="cr-source t-micro ink-3">${kind} DECK · ${esc(tile.name)}</span>
      <h3 class="t-section cr-name"${titleId ? ` id="${titleId}"` : ""}>${esc(ev.text)}</h3>
      <div class="cr-rule" aria-hidden="true"></div>
      <div class="cr-outcome">
        <span class="cr-outcome-label t-micro ink-3">${outcomeLabel}</span>
        <strong class="cr-amount ${amount > 0 ? "positive" : amount < 0 ? "negative" : "neutral"}">${amountLabel}</strong>
      </div>
      ${buttonId ? `<button class="cta-red cr-btn" id="${buttonId}"><span class="cta-text cta-text-sm">OK</span></button>` : ""}
    </div>
  </article>`;
}

function openCardReveal(tile, ev) {
  $("#card-reveal").innerHTML = cardFaceHTML(tile, ev, { buttonId: "cr-ok" });
  openSurface("#card-modal", "#cr-ok");
  $("#cr-ok").addEventListener("click", () => {
    state.card = null;
    closeSurface("#card-modal");
  });
}

function closeCardGallery() {
  const gallery = $("#card-gallery");
  if (!gallery) return;
  gallery.classList.add("is-hidden");
  gallery.setAttribute("aria-hidden", "true");
  syncSurfaceA11y();
}

function openCardGallery() {
  const gallery = $("#card-gallery");
  const grid = $("#card-gallery-grid");
  if (!gallery || !grid) return;
  const cards = [
    ...CHANCE_EVENTS.map((event) => ({ tile: TILES.find((entry) => entry.kind === "chance"), event, kind: "chance" })),
    ...CHEST_EVENTS.map((event) => ({ tile: TILES.find((entry) => entry.kind === "chest"), event, kind: "chest" })),
  ];
  grid.innerHTML = cards.map(({ tile, event }, index) => cardFaceHTML(tile, event, { index, total: cards.length })).join("");
  gallery.classList.remove("is-hidden");
  gallery.setAttribute("aria-hidden", "false");
  syncSurfaceA11y();
  requestAnimationFrame(() => $("#card-gallery-close")?.focus({ preventScroll: true }));
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
      ? (tile.name.includes("AIRPORT") ? `<img class="airport-mark airport-mark-card" src="/assets/airport-plane.svg" alt="Airport">` : spriteHTML("train", 2))
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

let financingPreviewMode = "loan";
let financingSurfaceMode = "offer";
const financingPreviewDraft = {
  propertyIndex: 21,
  amount: 150,
  loanRate: 20,
  loanDuration: 20,
  loanSchedule: "checkpoints",
  equityShare: 10,
  equityDuration: "permanent",
  equityControl: "passive",
  hybridRate: 10,
  hybridDuration: 20,
  hybridConversion: 25,
};

function dropdownHTML({ id, label, value, options, className = "" }) {
  const selected = options.find((option) => String(option.value) === String(value)) || options[0];
  return `<div class="parlor-dropdown ${className}" data-dropdown="${esc(id)}"><span class="t-label f11 g-muted">${esc(label)}</span><button class="parlor-dropdown-trigger field" id="${esc(id)}-trigger" type="button" aria-label="${esc(label)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(id)}-menu"><span data-dropdown-value>${esc(selected?.label || "SELECT")}</span><span class="parlor-dropdown-caret" aria-hidden="true">▾</span></button><div class="parlor-dropdown-menu" id="${esc(id)}-menu" role="listbox" tabindex="-1" hidden>${options.map((option) => `<button class="parlor-dropdown-option" type="button" role="option" aria-selected="${String(option.value) === String(selected?.value)}" data-dropdown-value-option="${esc(option.value)}">${esc(option.label)}</button>`).join("")}</div></div>`;
}

function bindDropdowns(root, onSelect) {
  if (!root) return;
  const closeMenus = (except = null) => root.querySelectorAll(".parlor-dropdown").forEach((dropdown) => {
    if (dropdown !== except) {
      const trigger = dropdown.querySelector(".parlor-dropdown-trigger");
      const menu = dropdown.querySelector(".parlor-dropdown-menu");
      trigger?.setAttribute("aria-expanded", "false");
      if (menu) menu.hidden = true;
    }
  });
  root.querySelectorAll(".parlor-dropdown").forEach((dropdown) => {
    const id = dropdown.dataset.dropdown;
    const trigger = dropdown.querySelector(".parlor-dropdown-trigger");
    const menu = dropdown.querySelector(".parlor-dropdown-menu");
    if (!trigger || !menu) return;
    const open = () => {
      closeMenus(dropdown);
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      menu.querySelector("[aria-selected=true]")?.focus({ preventScroll: true });
    };
    const close = () => {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };
    trigger.addEventListener("click", () => (menu.hidden ? open() : close()));
    trigger.addEventListener("keydown", (event) => {
      if (["Enter", " ", "ArrowDown"].includes(event.key)) { event.preventDefault(); open(); }
    });
    menu.addEventListener("click", (event) => {
      const option = event.target.closest("[data-dropdown-value-option]");
      if (!option) return;
      const value = option.dataset.dropdownValueOption;
      dropdown.querySelectorAll("[data-dropdown-value-option]").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === option)));
      const valueEl = dropdown.querySelector("[data-dropdown-value]");
      if (valueEl) valueEl.textContent = option.textContent;
      close();
      onSelect?.(id, value);
      trigger.focus({ preventScroll: true });
    });
    menu.addEventListener("keydown", (event) => {
      const options = [...menu.querySelectorAll("[data-dropdown-value-option]")];
      const current = options.indexOf(document.activeElement);
      if (event.key === "Escape") { event.preventDefault(); close(); trigger.focus({ preventScroll: true }); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); options[(current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus({ preventScroll: true }); }
      if (event.key === "Home" || event.key === "End") { event.preventDefault(); options[event.key === "Home" ? 0 : options.length - 1]?.focus({ preventScroll: true }); }
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); document.activeElement?.click(); }
    });
  });
  if (!root.dataset.dropdownOutsideBound) {
    root.addEventListener("click", (event) => { if (!event.target.closest(".parlor-dropdown")) closeMenus(); });
    root.dataset.dropdownOutsideBound = "true";
  }
}

function financingPropertyOptions() {
  return TILES.filter((tile) => tile.kind === "property").map((tile) => ({ value: tile.i, label: `${tile.name} · $${tile.price}` }));
}

function financingPreviewCopy(mode = financingPreviewMode) {
  const tile = TILES[Number(financingPreviewDraft.propertyIndex)] || TILES[21];
  const amount = Math.max(1, Math.min(Number(financingPreviewDraft.amount) || 0, Number(tile.price) || 1));
  const rent = Number(tile.rent) || Number(RENT_TABLE[tile.group]?.base) || 0;
  if (mode === "equity") {
    const share = Math.max(5, Math.min(100, Number(financingPreviewDraft.equityShare) || 10));
    const lenderRent = Math.floor((rent * share) / 100);
    const duration = financingPreviewDraft.equityDuration === "permanent" ? "FOREVER" : `${financingPreviewDraft.equityDuration} TURNS`;
    const control = String(financingPreviewDraft.equityControl || "passive").toUpperCase();
    return {
      title: `${share}% OF ${tile.name}`,
      metrics: [
        ["CONTRIBUTION", `$${amount}`],
        ["RENT SHARE", `${share}%`],
        ["BASE RENT", `$${lenderRent} OF $${rent}`],
        ["DURATION", duration],
      ],
      copy: `${share}% economic share in ${tile.name}. The investor receives ${share}% of collected rent and sale proceeds. Control: ${control}.`,
      note: share === 100 ? "100% becomes a direct transfer or buyout. No hidden loan remains." : "Passive equity does not block building. Shared control requires the group consent rules.",
    };
  }
  if (mode === "hybrid") {
    const rate = Math.max(0, Math.min(100, Number(financingPreviewDraft.hybridRate) || 0));
    const duration = Number(financingPreviewDraft.hybridDuration) || 20;
    const conversion = Math.max(5, Math.min(100, Number(financingPreviewDraft.hybridConversion) || 25));
    const maturity = amount + Math.round((amount * rate) / 100);
    return {
      title: `CONVERTIBLE NOTE · ${tile.name}`,
      metrics: [
        ["ADVANCE", `$${amount}`],
        ["PREMIUM", `${rate}%`],
        ["MATURITY", `$${maturity}`],
        ["CONVERSION", `${conversion}%`],
      ],
      copy: `$${amount} at a ${rate}% premium for ${duration} turns. If the note defaults after its cure turn, the lender may convert the outstanding balance into ${conversion}% of ${tile.name}.`,
      note: "Repayment and conversion are mutually exclusive. Interest stops when conversion happens.",
    };
  }
  const rate = Math.max(0, Math.min(100, Number(financingPreviewDraft.loanRate) || 0));
  const duration = Number(financingPreviewDraft.loanDuration) || 20;
  const premium = Math.round((amount * rate) / 100);
  const total = amount + premium;
  const schedule = financingPreviewDraft.loanSchedule === "upfront" ? "UPFRONT" : financingPreviewDraft.loanSchedule === "maturity" ? "MATURITY" : "CHECKPOINTS";
  return {
    title: `SECURED LOAN · ${tile.name}`,
    metrics: [
      ["ADVANCE", `$${amount}`],
      ["PREMIUM", `${rate}%`],
      ["TOTAL DUE", `$${total}`],
      ["TERM", `${duration} TURNS`],
    ],
    copy: `$${amount} advanced at a ${rate}% total premium for ${duration} turns. Repayment: ${schedule.toLowerCase()}. The named deed is collateral after the cure turn.`,
    note: "The lender receives a fixed return. No rent or ownership share is attached to this mode.",
  };
}

function financingPreviewHTML() {
  const preview = financingPreviewCopy();
  return `<div class="financing-preview-head"><span class="t-micro g400">CONTRACT PREVIEW</span><span class="t-label f12 g100">${esc(preview.title)}</span></div>
    <div class="financing-metrics">${preview.metrics.map(([label, value]) => `<div><span class="t-micro ink-3">${label}</span><strong class="t-label f13 g100">${esc(value)}</strong></div>`).join("")}</div>
    <p class="t-body ink-2 financing-preview-copy">${esc(preview.copy)}</p>
    <p class="t-micro ink-3 financing-preview-note">${esc(preview.note)}</p>`;
}

function financingModeFieldsHTML() {
  if (financingPreviewMode === "equity") {
    const permanent = financingPreviewDraft.equityDuration === "permanent";
    const equityTurns = permanent ? 20 : Math.max(1, Number(financingPreviewDraft.equityDuration) || 20);
    return `<div class="financing-field"><label class="t-label f11 g-muted" for="finance-equity-share">Economic share <output id="finance-equity-share-output">${financingPreviewDraft.equityShare}%</output></label><div class="financing-range"><input id="finance-equity-share" type="range" min="5" max="100" step="5" value="${financingPreviewDraft.equityShare}" /></div></div>
      <div class="financing-field-grid"><label class="financing-field"><span class="t-label f11 g-muted">Duration in turns</span><div class="financing-number"><input class="field" id="finance-equity-duration" type="number" min="1" max="100" step="1" value="${equityTurns}" ${permanent ? "disabled" : ""} /><span aria-hidden="true">TURNS</span></div></label>${dropdownHTML({ id: "finance-equity-control", label: "Control", value: financingPreviewDraft.equityControl, options: [{ value: "passive", label: "PASSIVE" }, { value: "shared", label: "SHARED" }, { value: "controlling", label: "CONTROLLING" }] })}</div><label class="financing-check"><input id="finance-equity-permanent" type="checkbox" ${permanent ? "checked" : ""} /><span class="t-label f11 g-muted">PERMANENT EQUITY</span></label>`;
  }
  if (financingPreviewMode === "hybrid") {
    return `<div class="financing-field-grid"><label class="financing-field"><span class="t-label f11 g-muted">Premium %</span><input class="field" id="finance-hybrid-rate" type="number" min="0" max="100" step="1" value="${financingPreviewDraft.hybridRate}" /></label><label class="financing-field"><span class="t-label f11 g-muted">Duration in turns</span><div class="financing-number"><input class="field" id="finance-hybrid-duration" type="number" min="1" max="100" step="1" value="${financingPreviewDraft.hybridDuration}" /><span aria-hidden="true">TURNS</span></div></label></div><div class="financing-field"><label class="t-label f11 g-muted" for="finance-hybrid-conversion">Default conversion share <output id="finance-hybrid-conversion-output">${financingPreviewDraft.hybridConversion}%</output></label><div class="financing-range"><input id="finance-hybrid-conversion" type="range" min="5" max="100" step="5" value="${financingPreviewDraft.hybridConversion}" /></div></div>`;
  }
  return `<div class="financing-field-grid"><label class="financing-field"><span class="t-label f11 g-muted">Total premium %</span><input class="field" id="finance-loan-rate" type="number" min="0" max="100" step="1" value="${financingPreviewDraft.loanRate}" /></label><label class="financing-field"><span class="t-label f11 g-muted">Duration in turns</span><div class="financing-number"><input class="field" id="finance-loan-duration" type="number" min="1" max="100" step="1" value="${financingPreviewDraft.loanDuration}" /><span aria-hidden="true">TURNS</span></div></label></div>${dropdownHTML({ id: "finance-loan-schedule", label: "Repayment schedule", value: financingPreviewDraft.loanSchedule, options: [{ value: "upfront", label: "UPFRONT" }, { value: "checkpoints", label: "CHECKPOINTS" }, { value: "maturity", label: "MATURITY" }] })}`;
}

function financingSurfaceTabsHTML() {
  const tabs = [
    ["offer", "OFFER"],
    ["contract", "CONTRACT"],
    ["ownership", "CO-OWNERSHIP"],
    ["default", "DEFAULT"],
  ];
  return `<div class="financing-surface-tabs" id="financing-surface-tabs" role="tablist" aria-label="Financing surfaces">${tabs.map(([value, label]) => `<button class="financing-surface-tab${financingSurfaceMode === value ? " is-active" : ""}" type="button" role="tab" aria-selected="${financingSurfaceMode === value}" data-financing-surface="${value}"><span class="t-label f11">${label}</span></button>`).join("")}</div>`;
}

function financingSurfaceBodyHTML() {
  if (financingSurfaceMode === "contract") {
    return `<section class="financing-surface-body" aria-labelledby="financing-contract-heading"><div class="financing-surface-kicker"><span class="t-micro g400">EXAMPLE CONTRACT · UI MODEL</span><span class="t-label f11 green">ACTIVE · 12 TURNS LEFT</span></div><h3 class="t-section g100" id="financing-contract-heading">Secured loan · Eindhoven</h3><div class="financing-contract-grid"><div><span class="t-micro ink-3">BORROWER</span><strong class="t-label f13 g100">PLAYER</strong></div><div><span class="t-micro ink-3">LENDER</span><strong class="t-label f13 g100">PARTNER</strong></div><div><span class="t-micro ink-3">ADVANCE</span><strong class="t-label f13 g100">$150</strong></div><div><span class="t-micro ink-3">MATURITY</span><strong class="t-label f13 g100">$180</strong></div></div><div class="financing-checkpoints" aria-label="Repayment checkpoints"><span class="is-paid">TURN 5 · PAID</span><span class="is-paid">TURN 10 · PAID</span><span>TURN 15 · $38</span><span>TURN 20 · $105</span></div><p class="t-body ink-2 financing-surface-copy">The borrower keeps the deed while payments are current. The lender receives the agreed premium and the named deed remains collateral after the cure turn.</p><div class="financing-surface-actions"><button class="btn-dark" type="button" data-finance-surface="offer"><span class="t-label f11">OPEN OFFER</span></button><button class="btn-dark" type="button" disabled><span class="t-label f11">BUYOUT · SERVER LATER</span></button></div></section>`;
  }
  if (financingSurfaceMode === "ownership") {
    return `<section class="financing-surface-body" aria-labelledby="financing-ownership-heading"><div class="financing-surface-kicker"><span class="t-micro g400">EXAMPLE CAP TABLE · UI MODEL</span><span class="t-label f11 g300">PASSIVE CONTROL</span></div><h3 class="t-section g100" id="financing-ownership-heading">Eindhoven · shared economics</h3><div class="financing-ownership-bar"><span class="financing-ownership-primary" style="width:70%"></span><span class="financing-ownership-secondary" style="width:30%"></span></div><div class="financing-owner-list"><div><span class="ownership-avatar ownership-avatar-primary"></span><span class="t-label f12 g100">PLAYER · 70%</span><span class="t-micro ink-3">CONTROL + RENT</span></div><div><span class="ownership-avatar ownership-avatar-secondary"></span><span class="t-label f12 g100">PARTNER · 30%</span><span class="t-micro ink-3">RENT + SALE SHARE</span></div></div><div class="financing-rights-grid"><div><span class="t-micro ink-3">BASE RENT $18</span><strong class="t-label f13 g100">$13 / $5</strong></div><div><span class="t-micro ink-3">BUILDING RIGHTS</span><strong class="t-label f13 green">OWNER CONTROL</strong></div><div><span class="t-micro ink-3">SALE PROCEEDS</span><strong class="t-label f13 g100">70% / 30%</strong></div><div><span class="t-micro ink-3">DURATION</span><strong class="t-label f13 g100">FOREVER</strong></div></div><p class="t-body ink-2 financing-surface-copy">A passive minority share does not block a complete street. Shared control is an explicit contract choice, not an accidental side effect of buying equity.</p><div class="financing-surface-actions"><button class="btn-dark" type="button" data-financing-surface="offer"><span class="t-label f11">OPEN OFFER</span></button><button class="btn-dark" type="button" disabled><span class="t-label f11">TRANSFER · SERVER LATER</span></button></div></section>`;
  }
  if (financingSurfaceMode === "default") {
    return `<section class="financing-surface-body" aria-labelledby="financing-default-heading"><div class="financing-surface-kicker"><span class="t-micro red">CURE WINDOW · UI MODEL</span><span class="t-label f11 red">1 TURN LEFT</span></div><h3 class="t-section g100" id="financing-default-heading">Payment due · Eindhoven</h3><div class="financing-default-amount"><span class="t-micro ink-3">OUTSTANDING BALANCE</span><strong class="t-money red">$105</strong></div><div class="financing-default-actions"><button class="btn-dark" type="button" disabled><span class="t-label f11">PAY OUTSTANDING BALANCE</span></button><button class="btn-dark" type="button" disabled><span class="t-label f11">TAKE COLLATERAL</span></button><button class="btn-dark" type="button" disabled><span class="t-label f11">BANK AUCTION</span></button></div><p class="t-body ink-2 financing-surface-copy">If the cure turn expires, the lender chooses collateral transfer or bank auction. Interest stops when the contract resolves.</p></section>`;
  }
  return `<section class="financing-surface-body" aria-labelledby="financing-offer-heading"><div class="financing-mode-tabs" id="financing-mode-tabs" role="tablist" aria-label="Financing mode"><button class="financing-mode-tab${financingPreviewMode === "loan" ? " is-active" : ""}" type="button" role="tab" aria-selected="${financingPreviewMode === "loan"}" data-financing-mode="loan"><span class="t-label f11">LOAN</span><span class="t-micro">FIXED RETURN</span></button><button class="financing-mode-tab${financingPreviewMode === "equity" ? " is-active" : ""}" type="button" role="tab" aria-selected="${financingPreviewMode === "equity"}" data-financing-mode="equity"><span class="t-label f11">EQUITY</span><span class="t-micro">RENT + SALE SHARE</span></button><button class="financing-mode-tab${financingPreviewMode === "hybrid" ? " is-active" : ""}" type="button" role="tab" aria-selected="${financingPreviewMode === "hybrid"}" data-financing-mode="hybrid"><span class="t-label f11">HYBRID</span><span class="t-micro">CONVERT ON DEFAULT</span></button></div><h3 class="sr-only" id="financing-offer-heading">Financing offer builder</h3><div class="financing-form">${dropdownHTML({ id: "finance-property", label: "Property", value: financingPreviewDraft.propertyIndex, options: financingPropertyOptions() })}<label class="financing-field"><span class="t-label f11 g-muted">Cash advanced / contributed</span><input class="field" id="finance-amount" type="number" min="1" step="1" value="${financingPreviewDraft.amount}" /></label><div id="financing-mode-fields">${financingModeFieldsHTML()}</div></div><section class="financing-preview" id="financing-preview" aria-live="polite">${financingPreviewHTML()}</section><div class="financing-actions"><button class="btn-dark" id="financing-cancel" type="button"><span class="t-label f11">CLOSE PREVIEW</span></button><button class="cta-red financing-disabled-action" type="button" disabled><span class="cta-text cta-text-sm">SERVER ACTIONS COMING LATER</span></button></div></section>`;
}

function syncFinancingRanges(root = $("#financing-card")) {
  root?.querySelectorAll(".financing-range input[type=range]").forEach((input) => {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const value = Number(input.value) || min;
    const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.parentElement?.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, progress))}%`);
  });
}

function renderFinancingModal() {
  const card = $("#financing-card");
  if (!card) return;
  const modeLabels = { loan: "LOAN", equity: "EQUITY", hybrid: "HYBRID" };
  const header = `<div class="financing-head"><div><div class="t-micro g400">PARLOR DEAL BUILDER · UI MODEL</div><h2 class="t-section g100" id="financing-card-title">Shape a ${modeLabels[financingPreviewMode]} deal</h2></div><span class="t-micro financing-badge">SERVER CONTRACT OFFLINE</span><button class="btn-dark financing-close" id="financing-close" type="button"><span class="t-label f11">CLOSE</span></button></div><p class="t-body ink-2 financing-description" id="financing-card-description">Preview the agreement both players would see. Nothing is sent and no game state changes in this UI model.</p>`;
  card.innerHTML = `<div class="financing-body">${header}${financingSurfaceTabsHTML()}${financingSurfaceBodyHTML()}</div>`;
  syncFinancingRanges(card);
  const updatePreview = () => {
    const preview = $("#financing-preview");
    if (preview) preview.innerHTML = financingPreviewHTML();
  };
  $("#financing-close")?.addEventListener("click", closeFinancingModal);
  $("#financing-cancel")?.addEventListener("click", closeFinancingModal);
  $("#financing-surface-tabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-financing-surface]");
    if (!button) return;
    financingSurfaceMode = button.dataset.financingSurface;
    renderFinancingModal();
  });
  if (!card.dataset.financingSurfaceBound) {
    card.addEventListener("click", (event) => {
      const button = event.target.closest("[data-financing-surface]");
      if (!button || event.target.closest("#financing-surface-tabs")) return;
      financingSurfaceMode = button.dataset.financingSurface;
      renderFinancingModal();
    });
    card.dataset.financingSurfaceBound = "true";
  }
  if (financingSurfaceMode === "offer") {
    $("#financing-mode-tabs")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-financing-mode]");
      if (!button) return;
      financingPreviewMode = button.dataset.financingMode;
      renderFinancingModal();
    });
    if (!card.dataset.financingInputBound) {
      card.addEventListener("input", (event) => {
        const { id, value } = event.target;
        if (id === "finance-amount") financingPreviewDraft.amount = Number(value) || 0;
        if (id === "finance-loan-rate") financingPreviewDraft.loanRate = Number(value) || 0;
        if (id === "finance-loan-duration") financingPreviewDraft.loanDuration = Number(value) || 20;
        if (id === "finance-equity-share") { financingPreviewDraft.equityShare = Number(value) || 10; $("#finance-equity-share-output").textContent = `${financingPreviewDraft.equityShare}%`; }
        if (id === "finance-equity-duration") financingPreviewDraft.equityDuration = value;
        if (id === "finance-hybrid-rate") financingPreviewDraft.hybridRate = Number(value) || 0;
        if (id === "finance-hybrid-duration") financingPreviewDraft.hybridDuration = Number(value) || 20;
        if (id === "finance-hybrid-conversion") { financingPreviewDraft.hybridConversion = Number(value) || 25; $("#finance-hybrid-conversion-output").textContent = `${financingPreviewDraft.hybridConversion}%`; }
        if (event.target.matches("input[type=range]")) syncFinancingRanges(card);
        updatePreview();
      });
      card.dataset.financingInputBound = "true";
    }
    bindDropdowns(card, (id, value) => {
      if (id === "finance-property") financingPreviewDraft.propertyIndex = Number(value);
      if (id === "finance-loan-schedule") financingPreviewDraft.loanSchedule = value;
      if (id === "finance-equity-control") financingPreviewDraft.equityControl = value;
      updatePreview();
    });
  }
  $("#finance-equity-permanent")?.addEventListener("change", (event) => {
    const turnsInput = $("#finance-equity-duration");
    financingPreviewDraft.equityDuration = event.target.checked ? "permanent" : Math.max(1, Number(turnsInput?.value) || 20);
    renderFinancingModal();
  });
}

function openFinancingModal(mode = "loan", propertyIndex = null, trigger = null, surface = "offer") {
  financingPreviewMode = ["loan", "equity", "hybrid"].includes(mode) ? mode : "loan";
  financingSurfaceMode = ["offer", "contract", "ownership", "default"].includes(surface) ? surface : "offer";
  if (propertyIndex != null && TILES[Number(propertyIndex)]?.kind === "property") financingPreviewDraft.propertyIndex = Number(propertyIndex);
  renderFinancingModal();
  openSurface("#financing-modal", "#financing-close");
  if (trigger instanceof HTMLElement) surfaceReturnFocus = trigger;
}

function closeFinancingModal() {
  closeSurface("#financing-modal");
}

function renderRightRail() {
  const owned = TILES.filter((t) => state.owners[t.i] === "p1");

  const title = $("#rr-title");
  if (state.tab === "finance") {
    if (title) title.textContent = "Financing";
    $("#rr-count").textContent = "UI MODEL";
  } else {
    if (title) title.textContent = "Holdings";
    $("#rr-count").textContent = `${owned.length} DEEDS`;
  }
  document.querySelectorAll(".tab").forEach((tb) => {
    const selected = tb.dataset.tab === state.tab;
    tb.classList.toggle("is-active", selected);
    tb.setAttribute("aria-selected", String(selected));
  });
  $("#rr-body")?.setAttribute("aria-labelledby", `tab-${state.tab}`);

  const body = $("#rr-body");
  if (state.tab === "finance") {
    const me = state.players[0];
    const loan = me?.bankLoan;
    const offer = me?.bankLoanOffer;
    const loanCopy = loan?.status === "defaulted"
      ? "DEFAULTED · The bank has closed this credit line for the rest of the round."
      : loan?.status === "paid"
        ? `PAID IN ROUND ${loan.paidRound || "—"} · You may qualify for emergency credit again when cash is low.`
        : loan
          ? `Repay before round ${loan.dueRound}. The cure window ends after round ${loan.cureRound}.`
          : offer?.available
            ? "Emergency liquidity is available. Read every term before accepting."
            : (offer?.reason || "Bank credit is unavailable right now.");
    const bankActionDisabled = state.phase !== "playing" || state.turnIndex !== 0;
    const loanAction = loan && ["active", "due"].includes(loan.status)
      ? `<button class="cta-red finance-bank-action" type="button" data-bank-action="repay" ${bankActionDisabled ? "disabled" : ""}><span class="cta-text cta-text-sm">REPAY $${Number(loan.remaining || 0).toLocaleString()}</span></button>`
      : offer?.available
        ? `<button class="cta-red finance-bank-action" type="button" data-bank-action="take" ${bankActionDisabled ? "disabled" : ""}><span class="cta-text cta-text-sm">ACCEPT $${Number(offer.principal || 0).toLocaleString()}</span></button>`
        : "";
    const loanMetrics = loan
      ? [["STATUS", String(loan.status).toUpperCase()], ["REMAINING", `$${Number(loan.remaining || 0).toLocaleString()}`], ["DUE ROUND", loan.dueRound || "—"], ["COLLATERAL", loan.collateralName || "NONE"]]
      : offer?.available
        ? [["ADVANCE", `$${Number(offer.principal || 0).toLocaleString()}`], ["TOTAL DUE", `$${Number(offer.totalDue || 0).toLocaleString()}`], ["DUE IN", `${offer.dueInRounds} ROUNDS`], ["COLLATERAL", offer.collateralName || "NONE"]]
        : [];
    body.innerHTML = `<section class="finance-bank panel noise" aria-labelledby="bank-credit-heading"><div class="finance-bank-head"><div><div class="t-micro g400">BANK CREDIT · LIVE</div><h3 class="t-section g100" id="bank-credit-heading">Emergency liquidity</h3></div><span class="t-micro ${loan?.status === "defaulted" ? "red" : "g300"}">${loan ? String(loan.status).toUpperCase() : "NO DEBT"}</span></div>${loanMetrics.length ? `<div class="finance-bank-metrics">${loanMetrics.map(([label, value]) => `<div><span class="t-micro ink-3">${label}</span><strong class="t-label f12 g100">${esc(String(value))}</strong></div>`).join("")}</div>` : ""}<p class="t-body ink-2 finance-bank-copy">${esc(loanCopy)}</p>${loanAction ? `<div class="finance-bank-actions">${loanAction}</div>` : ""}<p class="t-micro ink-3 finance-bank-note">Predatory terms are fixed at acceptance. The bank never negotiates.</p></section><div class="finance-rail-intro"><div class="t-micro g400">PARLOR DEALS · PLAYER FINANCE</div><p class="t-body ink-2">Player loans and equity remain negotiated social contracts. Use the bank only when the collateral risk is worth the liquidity.</p></div><div class="finance-status"><span class="t-micro ink-3">LIVE DEALS</span><span class="t-label f11 g-muted">PLAYER CONTRACTS · PREVIEW</span></div><div class="finance-empty"><span data-sprite="diamond" data-size="4"></span><strong class="t-label f12 g100">NO ACTIVE PLAYER DEALS</strong><span class="t-micro ink-3">Preview a contract, ownership split, or default resolution.</span></div><div class="finance-rail-actions"><button class="btn-dark" type="button" data-finance-open="loan" data-finance-surface="offer"><span class="t-label f11">PREVIEW TERMS</span></button><button class="btn-dark" type="button" data-finance-surface="contract"><span class="t-label f11">VIEW CONTRACT</span></button><button class="btn-dark" type="button" data-finance-surface="ownership"><span class="t-label f11">VIEW CO-OWNERSHIP</span></button><button class="btn-dark" type="button" data-finance-surface="default"><span class="t-label f11">VIEW DEFAULT</span></button></div>`;
    hydrateSprites();
  } else if (state.tab === "deeds") {
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

  const choice = activeAppearance();
  const meta = getAppearanceMeta(choice);
  const selectedProfile = typeof choice === "string" ? getProfileById(choice) : null;
  const selectedName = selectedProfile ? profileDesignName(selectedProfile) : meta.label;
  const sourceLabel = state.tableAppearanceOverride == null ? "ACTIVE DESIGN" : "THIS TABLE ONLY";
  const activeProfile = typeof state.appearance === "string" ? getProfileById(state.appearance) : null;
  const activeName = activeProfile ? profileDesignName(activeProfile) : getAppearanceMeta(state.appearance).label;
  const activeIsDifferent = state.tableAppearanceOverride != null && state.tableAppearanceOverride !== state.appearance;

  // The active design is the default. The chooser is deliberately opt-in so
  // joining a table never asks the player to make the same identity decision twice.
  const activeCard = $("#su-active-card");
  if (activeCard) {
    activeCard.innerHTML = `<div class="su-active-avatar">${avatarHTML({ color: meta.color, avatarGrid: meta.avatarGrid }, 4, 0)}</div><div class="su-active-copy"><span class="t-micro ${activeIsDifferent ? "g400" : "green"}">${sourceLabel}</span><strong class="t-label f14 su-active-name" style="color:${meta.textColor}">${esc(selectedName)}</strong><span class="t-micro ink-3">${activeIsDifferent ? `ACTIVE DESIGN · ${esc(activeName)}` : "READY TO ENTER THE PARLOR"}</span></div>`;
  }
  $("#su-active-actions")?.classList.toggle("is-hidden", !activeIsDifferent);
  $("#su-reset-btn")?.classList.toggle("is-hidden", !activeIsDifferent);
  $("#su-make-active-btn")?.classList.toggle("is-hidden", !activeIsDifferent);
  $("#su-chooser")?.classList.remove("is-hidden");

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
            const active = choice === p.id;
            const status = active ? (activeIsDifferent ? "THIS TABLE" : "ACTIVE DESIGN") : p.id === state.appearance ? "ACTIVE DESIGN" : "AVAILABLE";
            return `<button type="button" class="su-opt su-opt-profile${active ? " is-active" : ""}" data-app="${p.id}">
              <div class="su-av">${avatarHTML(p, 5, i)}</div>
              <div>
              <div class="t-label f13" style="color:${p.color}">${esc(profileDesignName(p))}</div>
                <div class="t-micro ink-3 su-state">${status}</div>
              </div>
            </button>`;
          })
          .join("")
      : `<p class="su-empty-custom">No custom designs yet. Create one from the home screen, then pick it here.</p>`;
  } else {
    $("#su-grid").innerHTML = APPEARANCES.map(
      (a, i) => {
        const active = choice === i;
        const status = active ? (activeIsDifferent ? "THIS TABLE" : "ACTIVE DESIGN") : state.appearance === i ? "ACTIVE DESIGN" : "AVAILABLE";
        return `<button type="button" class="su-opt${active ? " is-active" : ""}" data-app="${i}">
        <div class="su-av">${avatarHTML(a, 5, i)}</div>
        <div>
          <div class="t-label f13" style="color:${a.textColor}">${a.label}</div>
          <div class="t-micro ink-3 su-state">${status}</div>
        </div>
      </button>`;
      },
    ).join("");
  }

}

function renderAll() {
  renderTopNav();
  renderPlayers();
  renderChat();
  renderBoardState();
  placePieces();
  renderGlobalEvent();
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
  const label = id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  return `<button class="tog${value ? " is-on" : ""}" data-setting="${id}" aria-label="${label}" aria-pressed="${value}" title="${label}"></button>`;
}

function renderGlobalEvent() {
  const banner = $("#global-event-banner");
  if (!banner) return;
  const event = state.globalEvent;
  const visible = state.phase === "playing" && event;
  banner.classList.toggle("is-hidden", !visible);
  if (!visible) return;
  const accent = event.category === "CIVIC" ? "#d9a62f" : event.category === "INFRASTRUCTURE" ? "#286ea1" : "#d74438";
  banner.style.setProperty("--event-accent", accent);
  $("#global-event-kicker").textContent = event.phase === "voting" ? "TABLE VOTE" : `${event.category} · GLOBAL EVENT`;
  $("#global-event-title").textContent = String(event.title || "GLOBAL EVENT");
  $("#global-event-copy").textContent = String(event.summary || "The table is under a global effect.");
  const effectLabels = {
    rentMultiplier: "RENTS",
    constructionBlocked: "BUILDING FROZEN",
    buildingSaleMultiplier: "BUILDING SALES",
    propertyValueMultiplier: "PROPERTY VALUE",
    bankLoansBlocked: "BANK LOANS",
    mortgagesBlocked: "MORTGAGES",
    taxMultiplier: "TAXES",
    buildingCostMultiplier: "BUILDING COST",
    loanPremiumMultiplier: "LOAN PREMIUM",
    airportRentMultiplier: "AIRPORT RENT",
    airportCardsBlocked: "AIRPORT CARDS",
    premiumRentMultiplier: "PREMIUM RENT",
    leaderRentMultiplier: "LEADER RENT",
  };
  const effectEl = $("#global-event-effects");
  if (effectEl) {
    effectEl.innerHTML = Object.entries(event.effects || {}).map(([key, value]) => {
      const label = effectLabels[key] || key.replaceAll(/([A-Z])/g, " $1").toUpperCase();
      const shown = typeof value === "boolean"
        ? (value ? "ON" : "OFF")
        : (() => { const delta = Math.round((Number(value) - 1) * 100); return delta === 0 ? "100%" : `${delta > 0 ? "+" : ""}${delta}%`; })();
      return `<span class="global-event-effect t-micro">${esc(label)} · ${esc(shown)}</span>`;
    }).join("");
  }
  $("#global-event-rounds").textContent = event.phase === "voting"
    ? "VOTE BEFORE NEXT ROUND"
    : event.phase === "warning"
      ? "ACTIVATES NEXT ROUND"
      : `${event.roundsRemaining || 0} ROUNDS LEFT`;
  const choices = $("#global-event-choices");
  if (!choices) return;
  if (event.phase !== "voting" || !Array.isArray(event.choices)) {
    choices.innerHTML = "";
    return;
  }
  const me = state.players[0];
  const voterId = me?.serverId || me?.id;
  const voted = Boolean(voterId && event.votes?.[voterId]);
  choices.innerHTML = event.choices.map((choice) => `<button class="global-event-choice" type="button" data-global-choice="${esc(choice.id)}" ${voted ? "disabled" : ""} title="${esc(choice.description || "Cast your vote")}">${esc(choice.label)}</button>`).join("");
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
  const seated = locked ? [buildPreviewSelf()] : state.players.slice(0, s.maxPlayers);
  const existingBots = seated.filter((p) => p.bot).length;
  const botPreviews = buildBotPreviewPlayers(Math.max(0, s.bots - existingBots));
  const previewPlayers = [...seated, ...botPreviews].slice(0, s.maxPlayers);

  $("#lobby-settings-body").innerHTML = [
    locked
      ? `<div class="settings-rule lobby-lock-note">
          <strong style="color:var(--gold-300)">FINISH SETUP TO CONTINUE</strong><br>
          Your active design is ready. Press "Enter Parlor" on the left to seat the table, or change it there for this table only.
        </div>`
      : "",
    lobbySection("Players At Table", previewPlayers.map((p, i) => lobbyPlayerRowHTML(p, i))),
    lobbySection("Table Rules", [
      settingRowNum("Max Players", "Seats at the table.", stepper("maxPlayers", s.maxPlayers, 2, 4)),
      settingRowNum("Bots", "Reserve CPU seats for Solo Dev Mode.", stepper("bots", s.bots, 0, Math.max(0, s.maxPlayers - 1))),
      settingRowNum("Starting Cash", "Bank hands this to each player at start.", sel("startingCash", s.startingCash, [["500","$500"],["1000","$1,000"],["1500","$1,500"],["2000","$2,000"],["2500","$2,500"],["3000","$3,000"]])),
      settingRow("Vacation Pool", "Taxes fill free parking. First to land claims it.", tog("vacationPool", s.vacationPool)),
      settingRow("Double GO", "Landing exactly on GO pays $400 instead of $200.", tog("doubleGo", s.doubleGo)),
    ]),
    lobbySection("Economy", [
      settingRow("Trading", "Players may propose trades.", tog("trading", s.trading)),
      settingRow("Auction", "Unowned deeds go to auction if buyer passes.", tog("auction", s.auction)),
      settingRow("No Rent In Jail", "Owner in jail can't collect rent that turn.", tog("noRentInJail", s.noRentInJail)),
      settingRow("Bankruptcy", "How to handle a bust player.", sel("bankruptMode", s.bankruptMode, [["elim","ELIMINATE"],["debt","DEBT DEAL"]])),
      settingRow("Bank Loans", "Emergency credit with collateral and a hard maturity.", tog("bankLoans", s.bankLoans)),
      settingRow("Loan Severity", "Premium applied to emergency bank credit.", sel("bankLoanSeverity", s.bankLoanSeverity, [["fair","FAIR"],["predatory","PREDATORY"],["extreme","EXTREME"]])),
    ]),
    lobbySection("Global Events", [
      settingRow("Event Mode", "Rare headlines with board-wide effects.", sel("globalEvents", s.globalEvents, [["off","OFF"],["rare","RARE"],["hardcore","HARDCORE"]])),
      settingRow("Event Duration", "Rounds an event remains active.", sel("globalEventDuration", s.globalEventDuration, [["5","5 ROUNDS"],["10","10 ROUNDS"]])),
      settingRow("Event Maximum", "Maximum global headlines in one game.", sel("globalEventMax", s.globalEventMax, [["1","1 EVENT"],["2","2 EVENTS"]])),
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
      ${s.bankLoans ? `${String(s.bankLoanSeverity).toLowerCase()} bank loans` : "bank loans off"} ·
      ${s.globalEvents === "off" ? "global events off" : `${String(s.globalEvents).toLowerCase()} events · ${s.globalEventDuration} rounds`} ·
      ${s.bots ? `${s.bots} bot${s.bots === 1 ? "" : "s"} reserved` : "no bots"} ·
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
  const a = getAppearanceMeta(activeAppearance());
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
  state.homeReturnView = fromPhase === "setup" ? "setup-return" : "home";
  state.editingProfileId = profileId || null;
  const existing = profileId ? getProfileById(profileId) : null;
  const account = state.account?.account;
  const source = existing;
  state.profileDraft = source
    ? { designName: profileDesignName(source), color: source.color, grid: cloneFaceGrid(source.avatarGrid), tool: "paint", paintColor: source.color }
    : { designName: "", color: account?.color || "#d74438", grid: account?.avatarGrid ? cloneFaceGrid(account.avatarGrid) : faceGridFromPreset(0, account?.color || "#d74438"), tool: "paint", paintColor: "#f0d9ac" };
  state.profileTab = "designs";
  renderProfileEditor();
  renderAccountPanel();
  renderProfileLibrary();
  showView("profile");
  setProfileTab(state.profileTab);
}

function buildBotPreviewPlayers(count) {
  const localBots = buildPlayers(activeAppearance(), state.alias).slice(1, 4);
  return localBots.slice(0, Math.max(0, count)).map((bot, index) => ({
    ...bot,
    id: `bot-preview-${index + 1}`,
    name: `BOT ${index + 1}`,
    online: true,
    bot: true,
  }));
}

function announceProfileSave(message) {
  const status = $("#profile-save-status");
  if (status) status.textContent = message;
}

function saveProfileDesign({ asNew = false, stay = false } = {}) {
  const d = state.profileDraft;
  if (!d) return null;
  const designName = String(d.designName || "").trim().slice(0, 12).toUpperCase() || "UNTITLED DESIGN";
  const hasInk = d.grid.some((row) => row.some((c) => c));
  const draftProfile = {
    id: !asNew && state.editingProfileId ? state.editingProfileId : `pf_${Math.random().toString(36).slice(2, 9)}`,
    designName,
    color: d.color,
    avatarGrid: hasInk ? d.grid : faceGridFromPreset(0, d.color),
  };
  const saved = upsertProfile(draftProfile);
  if (saved === "limit") {
    announceProfileSave(`You can only save up to ${MAX_PROFILES} designs. Delete one to make room.`);
    return saved;
  }
  if (!saved) return null;
  setActiveAppearance(saved.id);
  if (state.account?.sessionToken) {
    emitServer("account-update", {
      sessionToken: state.account.sessionToken,
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
  if (stay) {
    state.editingProfileId = saved.id;
    state.profileDraft = { designName: profileDesignName(saved), color: saved.color, grid: cloneFaceGrid(saved.avatarGrid), tool: "paint", paintColor: saved.color };
    renderProfileEditor();
    renderProfileLibrary();
    setProfileTab("designs");
    announceProfileSave(`Saved "${designName}" as a new design.`);
  }
  return saved;
}

function closeProfileEditor(save) {
  if (save) {
    const saved = saveProfileDesign({ asNew: !state.editingProfileId });
    if (saved === "limit" || !saved) return;
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
  if (saveLabel) saveLabel.textContent = state.editingProfileId ? "Save Changes" : "Save Design";
  const modeLabel = $("#profile-editor-mode");
  if (modeLabel) modeLabel.textContent = state.editingProfileId ? "EDIT PLAYER DESIGN" : "NEW PLAYER DESIGN";

  // identity swatches
  $("#profile-swatches").innerHTML = PROFILE_SWATCHES.map(
    (c) => `<button type="button" class="profile-swatch${c.toLowerCase() === d.color.toLowerCase() ? " is-active" : ""}" style="background:${c}" data-color="${c}" title="${c}"></button>`,
  ).join("");
  $("#profile-color-picker").value = d.color;
  $("#profile-name").value = d.designName;

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
  renderProfileSummary();
}

function updateProfilePreview() {
  const d = state.profileDraft;
  if (!d) return;
  const av = $("#profile-preview-av");
  if (av) av.innerHTML = spriteFromGrid(d.grid, 6);
  const nameEl = $("#profile-preview-name");
  if (nameEl) {
    nameEl.textContent = (d.designName || "UNTITLED DESIGN").toUpperCase();
    nameEl.style.color = d.color;
  }
  renderProfileLibrary();
  renderProfileSummary();
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
    case "railroad": return tile.name.includes("AIRPORT")
      ? `<img class="airport-mark airport-mark-popup" src="/assets/airport-plane.svg" alt="Airport">`
      : spriteHTML("train", 4);
    case "utility": return tile.name === "ELECTRIC COMPANY" ? spriteHTML("bulb", 4) : spriteHTML("faucet", 4);
    case "chance": return `<img class="board-icon-mark board-icon-popup board-icon-surprise" src="/assets/board-icons/surprise.svg" alt="Surprise">`;
    case "chest": return `<img class="board-icon-mark board-icon-popup board-icon-chest" src="/assets/board-icons/treasure-chest.svg" alt="Treasure">`;
    case "tax": return "";
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
function applyLocalCardEvent(idx, ev) {
  const player = state.players[idx];
  if (!player || !ev) return 0;
  let cashDelta = 0;
  const moveTo = (tileIndex) => {
    player.pos = tileIndex;
    state.highlight = tileIndex;
    resolveLanding(idx, tileIndex);
  };
  const moveToSupport = (tile, multiplier) => {
    if (!tile) return;
    if (tile.i < player.pos) {
      addCash(player.id, 200);
      record(`${player.name} PASSED GO — COLLECT $200`);
    }
    player.pos = tile.i;
    state.highlight = tile.i;
    const ownerId = state.owners[tile.i];
    if (ownerId && ownerId !== player.id) {
      const base = rentFor(tile);
      const amount = tile.kind === "utility"
        ? (Number(state.dice[0]) + Number(state.dice[1])) * multiplier
        : base * multiplier;
      if (chargePayment(idx, amount, ownerId, `${player.name} PAID $${amount} SUPPORT RENT`)) cashDelta -= amount;
      return;
    }
    resolveLanding(idx, tile.i);
  };
  switch (ev.action) {
    case "collect":
      addCash(player.id, ev.amount || 0);
      cashDelta = ev.amount || 0;
      break;
    case "pay":
      cashDelta = -(ev.amount || 0);
      chargePayment(idx, ev.amount || 0, null, `${player.name} PAID $${ev.amount} FROM CARD`);
      break;
    case "collectStart":
      {
        const amount = Number(ev.amount ?? 200);
        player.pos = START_TILE_INDEX;
        addCash(player.id, amount);
        cashDelta = amount;
      }
      break;
    case "moveTo":
      if (Number.isInteger(ev.tileIndex) && ev.tileIndex < player.pos) {
        addCash(player.id, 200);
        cashDelta += 200;
        record(`${player.name} PASSED GO — COLLECT $200`);
      }
      moveTo(ev.tileIndex);
      break;
    case "moveBack":
      moveTo((player.pos - (ev.steps || 3) + TILE_COUNT) % TILE_COUNT);
      break;
    case "goToJail":
      player.pos = JAIL_TILE_INDEX;
      state.jail[player.id] = 2;
      break;
    case "jailFree":
      player.jailFree = (player.jailFree || 0) + 1;
      break;
    case "collectFromEach":
      state.players.forEach((other) => {
        if (other.id === player.id) return;
        const paid = Math.min(other.cash, ev.amount || 0);
        other.cash -= paid;
        player.cash += paid;
        cashDelta += paid;
      });
      break;
    case "payEach":
      state.players.forEach((other) => {
        if (other.id === player.id) return;
        const paid = Math.min(player.cash, ev.amount || 0);
        player.cash -= paid;
        other.cash += paid;
        cashDelta -= paid;
      });
      break;
    case "repairs": {
      const houses = player.properties.reduce((sum, tileIndex) => {
        const level = Number(state.houses[tileIndex]) || 0;
        return sum + (level === HOTEL_LEVEL ? 0 : level);
      }, 0);
      const hotels = player.properties.reduce((sum, tileIndex) => sum + ((Number(state.houses[tileIndex]) || 0) === HOTEL_LEVEL ? 1 : 0), 0);
      const total = houses * (ev.houseCost || 0) + hotels * (ev.hotelCost || 0);
      cashDelta = -total;
      if (total) chargePayment(idx, total, null, `${player.name} PAID $${total} IN BUILDING REPAIRS`);
      break;
    }
    case "nearestRailroad": {
      const destination = TILES.find((tile, offset) => offset > player.pos && tile.kind === "railroad")
        || TILES.find((tile) => tile.kind === "railroad");
      moveToSupport(destination, 2);
      break;
    }
    case "nearestUtility": {
      const destination = TILES.find((tile, offset) => offset > player.pos && tile.kind === "utility")
        || TILES.find((tile) => tile.kind === "utility");
      moveToSupport(destination, 10);
      break;
    }
    default:
      cashDelta = Number(ev.cash) || 0;
      addCash(player.id, cashDelta);
      break;
  }
  record(`${player.name} — ${ev.text}`);
  say(`${player.name}: ${ev.text.toLowerCase()}`);
  return cashDelta;
}

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
    const ev = drawLocalCard(tile.kind);
    const cash = applyLocalCardEvent(idx, ev);
    if (!me.bot) openCardReveal(tile, { ...ev, cash });
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
    me.pos = JAIL_TILE_INDEX;
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
    if (me.pos === START_TILE_INDEX) passedGo = true;
    state.highlight = me.pos;
    renderBoardState();
    placePieces({ movingId: me.id, hop: true });
    if (!REDUCED_MOTION) playSound("step");
    await sleep(110);
  }

  if (passedGo) {
    addCash(me.id, 200);
    record(`${me.name} PASSED GO — COLLECT $200`);
    if (me.pos === START_TILE_INDEX && state.settings.doubleGo) {
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

function useLocalJailFree() {
  const me = state.players[0];
  if (!me || !(me.jailFree > 0) || !(state.jail[me.id] > 0) || state.turnStage !== "roll") return;
  me.jailFree -= 1;
  delete state.jail[me.id];
  record(`${me.name} USED A GET OUT OF PRISON CARD`);
  say(`${me.name} used a Get Out of Prison card.`);
  renderAll();
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
  state.players.forEach((p) => {
    p.cash = startCash;
    p.pos = START_TILE_INDEX;
    p.jailFree = 0;
  });
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
  state.surpriseDeck = [...CHANCE_EVENTS];
  state.treasureDeck = [...CHEST_EVENTS];
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
      <p class="t-body ink-2 trade-copy">Select who should receive the offer, then choose deeds from each side and set a cash amount to include.</p>
      ${dropdownHTML({ id: "trade-recipient", label: "Send trade to", value: state.tradeWith, className: "trade-recipient-dropdown", options: state.players.filter((p) => p.id !== "p1").map((p) => ({ value: p.id, label: p.name })) })}

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

  bindDropdowns($("#trade-card"), (id, value) => {
    if (id !== "trade-recipient" || !state.players.some((p) => p.id === value && p.id !== "p1")) return;
    state.tradeWith = value;
    state.tradeMyDeeds = new Set();
    state.tradeTheirDeeds = new Set();
    state.tradeMyCash = 0;
    state.tradeTheirCash = 0;
    renderTradeModal();
    $("#trade-recipient-trigger")?.focus({ preventScroll: true });
  });

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
          return;
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
const SAVE_VERSION = 2;
const LEGACY_TILE_INDEX_MAP = Object.freeze({ 0: 20, 10: 30, 20: 0, 30: 10 });

function migrateSavedBoardLayout(saved) {
  if (!saved || saved.v !== 1) return saved;
  const remapIndexMap = (value) => Object.fromEntries(
    Object.entries(value || {}).map(([key, entry]) => [LEGACY_TILE_INDEX_MAP[key] ?? key, entry]),
  );
  return {
    ...saved,
    v: SAVE_VERSION,
    players: saved.players.map((player) => ({
      ...player,
      pos: LEGACY_TILE_INDEX_MAP[player.pos] ?? player.pos,
    })),
    owners: remapIndexMap(saved.owners),
    houses: remapIndexMap(saved.houses),
    mortgaged: remapIndexMap(saved.mortgaged),
  };
}

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
      v: SAVE_VERSION,
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
    if (!s || ![1, SAVE_VERSION].includes(s.v) || !Array.isArray(s.players) || !s.players.length) return null;
    return s.v === 1 ? migrateSavedBoardLayout(s) : s;
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
  if (name !== "home" && nightShiftState.active) stopNightShift();
  $("#view-home").classList.toggle("is-hidden", name !== "home");
  $("#view-game").classList.toggle("is-hidden", name !== "game");
  $("#view-profile").classList.toggle("is-hidden", name !== "profile");
  $("#view-rankings")?.classList.toggle("is-hidden", name !== "rankings");
  $("#view-social")?.classList.toggle("is-hidden", name !== "social");
  syncGlobalNavigation(name);
  window.scrollTo(0, 0);
  syncSurfaceA11y();
  if (name === "home") {
    startHomeClock();
    scheduleHomeHelicopter();
    syncHomeMusic();
  } else {
    stopHomeClock();
    stopHomeHelicopter();
    syncHomeMusic();
  }
}

function syncServerAppearance() {
  if (!state.live) return;
  const meta = getAppearanceMeta(activeAppearance());
  emitServer("set-player-appearance", {
    nickname: state.alias.trim() || meta.baseName,
    color: meta.color,
    avatarGrid: meta.avatarGrid || null,
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
  state.roomVisibility = state.pendingRoomMeta?.visibility || (requestedCode ? "private" : "public");
  state.phase = "setup";
  state.tableAppearanceOverride = null;
  state.setupTab = typeof state.appearance === "string" ? "custom" : "preset";
  // always start the setup/lobby screens from a clean board — otherwise a
  // finished game's deed ownership, houses and token positions would still
  // be visible behind the setup overlay after going home and rejoining.
  state.players = buildPlayers(activeAppearance(), state.alias);
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
  state.log = ["ACTIVE DESIGN READY — ENTER THE PARLOR."];
  showView("game");
  renderAll();
  focusSurface("#setup-wrap", "#su-start");
  requestAnimationFrame(() => placePieces());

  if (state.live) {
    const meta = getAppearanceMeta(activeAppearance());
    const event = requestedCode ? "join-room" : "create-room";
    emitServer(event, {
      roomCode: requestedCode || undefined,
      nickname: state.alias.trim() || meta.baseName,
      color: meta.color,
      avatarGrid: meta.avatarGrid || null,
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
  state.players = buildPlayers(activeAppearance(), state.alias);
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
  state.roomVisibility = "private";
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
  // Home destinations. Play stays in the stage; rooms uses the existing
  // server-backed directory surface; profile keeps the current editor flow.
  $("#home-nav")?.addEventListener("click", (e) => {
    const button = e.target.closest("[data-home-tab]");
    if (!button) return;
    const tab = button.dataset.homeTab;
    setHomeTab(tab);
    if (tab === "rooms") openRoomsModal("browse");
    if (tab === "profile") openProfileEditor("home", typeof state.appearance === "string" ? state.appearance : null);
  });
  document.querySelectorAll("[data-top-surface]").forEach((button) => {
    button.addEventListener("click", () => button.dataset.topSurface === "rankings" ? openRankingsSurface() : openSocialSurface());
  });
  document.querySelectorAll("[data-top-back]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.topBack || "home"));
  });
  document.querySelectorAll("[data-home-tab]").forEach((button) => {
    if (button.closest("#home-nav")) return;
    button.addEventListener("click", () => {
      const tab = button.dataset.homeTab;
      if (tab === "profile") {
        openProfileEditor("home", typeof state.appearance === "string" ? state.appearance : null);
      } else if (tab === "rooms") {
        showView("home");
        setHomeTab("rooms");
        openRoomsModal("browse");
      } else if (tab === "play") {
        showView("home");
        setHomeTab("play");
        renderHome();
      }
    });
  });

  $("#player-list")?.addEventListener("click", (event) => {
    const player = event.target.closest("[data-player-id]");
    if (player) openPlayerSurface(player.dataset.playerId);
  });
  const handleRankingClick = (event) => {
    const metric = event.target.closest("[data-ranking-metric]");
    if (metric) { openRankingsSurface(metric.dataset.rankingMetric); return; }
    const player = event.target.closest("[data-ranking-player]");
    if (player) openPlayerSurface(player.dataset.rankingPlayer);
    if (event.target.closest("#rankings-close")) event.target.closest("#rankings-page-content") ? showView("home") : closeSurface("#rankings-modal");
  };
  $("#rankings-card")?.addEventListener("click", handleRankingClick);
  $("#rankings-page-content")?.addEventListener("click", handleRankingClick);
  const handleSocialClick = (event) => {
    const tab = event.target.closest("[data-social-tab]");
    if (tab) { state.socialTab = tab.dataset.socialTab; renderSocialSurface(event.currentTarget?.id === "social-page-content" ? "#social-page-content" : "#social-card"); return; }
    const player = event.target.closest("[data-social-player]");
    if (player) { openPlayerSurface(player.dataset.socialPlayer); return; }
    const request = event.target.closest("[data-social-request]");
    if (request) {
      emitServer("respond-friend-request", { friendshipId: request.dataset.friendshipId, accept: request.dataset.socialRequest === "accept" }, () => {});
      return;
    }
    const invite = event.target.closest("[data-social-invite]");
    if (invite) {
      emitServer("respond-room-invite", { inviteId: invite.dataset.inviteId, accept: invite.dataset.socialInvite === "accept" }, () => {});
      return;
    }
    const notification = event.target.closest("[data-notification-read]");
    if (notification) { emitServer("mark-notification-read", { notificationId: notification.dataset.notificationRead }, () => {}); return; }
    if (event.target.closest("#social-close")) event.target.closest("#social-page-content") ? showView("home") : closeSurface("#social-modal");
  };
  $("#social-card")?.addEventListener("click", handleSocialClick);
  $("#social-page-content")?.addEventListener("click", handleSocialClick);
  const handleSocialSubmit = (event) => {
    if (event.target.id !== "social-search-form") return;
    event.preventDefault();
    const form = event.target;
    const input = form.querySelector("#social-search-input");
    emitServer("search-players", { query: input?.value || "" }, (response) => {
      state.socialSearchResults = response?.players || [];
      const results = form.querySelector("#social-search-results");
      if (results) results.innerHTML = state.socialSearchResults.length ? state.socialSearchResults.map(player => socialPlayerRowHTML(player, "VIEW")).join("") : `<p class="t-micro ink-3 social-empty">NO PLAYERS FOUND.</p>`;
    });
  };
  $("#social-card")?.addEventListener("submit", handleSocialSubmit);
  $("#social-page-content")?.addEventListener("submit", handleSocialSubmit);
  $("#player-card")?.addEventListener("click", (event) => {
    if (event.target.closest("#player-modal-close")) { closeSurface("#player-modal"); return; }
    if (event.target.closest("#player-modal-back")) { state.selectedPlayerView = "profile"; renderPlayerSurface(); return; }
    const action = event.target.closest("[data-player-action]");
    if (!action || action.disabled || !state.selectedPlayer) return;
    const targetId = state.selectedPlayer.accountId;
    if (action.dataset.playerAction === "friend") emitServer("send-friend-request", { targetAccountId: targetId }, () => {});
    if (action.dataset.playerAction === "invite") emitServer("send-room-invite", { targetAccountId: targetId }, () => {});
    if (action.dataset.playerAction === "history") emitServer("get-match-history", { accountId: targetId }, (response) => { state.selectedPlayerHistory = response?.history || []; state.selectedPlayerView = "history"; renderPlayerSurface(); });
    if (action.dataset.playerAction === "block") emitServer("block-player", { otherAccountId: targetId }, (response) => { if (response?.success !== false) closeSurface("#player-modal"); });
    if (action.dataset.playerAction === "report") emitServer("report-player", { otherAccountId: targetId, reason: "player report from in-room card" }, (response) => { if (response?.success !== false) { announceSocialNotification({ body: "Report submitted to the parlor moderators." }); closeSurface("#player-modal"); } });
  });
  $("#social-scrim")?.addEventListener("click", () => closeSurface("#social-modal"));
  $("#rankings-scrim")?.addEventListener("click", () => closeSurface("#rankings-modal"));
  $("#player-scrim")?.addEventListener("click", () => closeSurface("#player-modal"));

  // Home actions are bound to their explicit controls below. Keeping the
  // entry points named avoids accidental duplicate Create/Browse triggers.
  $("#join-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const codeInput = $("#room-join");
    const nicknameInput = $("#join-nickname");
    const error = $("#join-form-error");
    const code = String(codeInput?.value || "").trim().toUpperCase();
    const nickname = String(state.account?.account?.displayName || nicknameInput?.value || "").trim().toUpperCase().replace(/[^A-Z0-9 _-]/g, "").slice(0, 12);
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      if (error) error.textContent = "ENTER A 6-CHARACTER ROOM CODE.";
      codeInput?.focus({ preventScroll: true });
      return;
    }
    if (!nickname) {
      if (error) error.textContent = "ENTER THE PLAYER NAME FOR THIS ROOM.";
      nicknameInput?.focus({ preventScroll: true });
      return;
    }
    if (error) error.textContent = "";
    state.alias = state.account?.account ? state.account.account.displayName : saveGuestAlias(nickname);
    applyProfileToHomeUI();
    closeRoomsModal();
    enterParlor(code);
  });
  $("#room-join")?.addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)));
  $("#join-nickname")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, "").slice(0, 12);
    if ($("#join-form-error")) $("#join-form-error").textContent = "";
  });
  $("#home-alias-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#home-alias");
    state.alias = saveGuestAlias(input?.value || "");
    renderGuestAliasField(state.alias ? "" : "CREATE AN ALIAS BEFORE JOINING A TABLE.");
    if (state.alias) $("#open-join-btn")?.focus({ preventScroll: true });
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
  $("#open-join-btn")?.addEventListener("click", () => openRoomsModal("join"));
  $("#rooms-close")?.addEventListener("click", closeRoomsModal);
  $("#rooms-scrim")?.addEventListener("click", closeRoomsModal);

  // modal tab switching
  $("#rm-tabs")?.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-rm-tab]");
    if (!tabBtn) return;
    switchRoomModalTab(tabBtn.dataset.rmTab);
  });

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
  document.querySelectorAll("[data-global-profile-trigger]").forEach((button) => {
    button.addEventListener("click", openActiveProfileForEdit);
  });
  $("#profile-hero-account-btn")?.addEventListener("click", () => {
    if (state.account?.account) openAccountModal("edit");
    else openAccountModal("register");
  });
  $("#profile-overview-edit-btn")?.addEventListener("click", () => {
    setProfileTab("designs");
    $("#profile-name")?.focus({ preventScroll: true });
  });
  $("#profile-tabs")?.addEventListener("click", (e) => {
    const button = e.target.closest("[data-profile-tab]");
    if (button) setProfileTab(button.dataset.profileTab);
  });
  $("#profile-tabs")?.addEventListener("keydown", (e) => {
    const tabs = [...document.querySelectorAll("#profile-tabs [data-profile-tab]")];
    const current = tabs.indexOf(e.target.closest("[data-profile-tab]"));
    if (current < 0 || !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const nextIndex = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (current + (["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    setProfileTab(next.dataset.profileTab);
    next.focus();
  });
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
  $("#achievements-filters")?.addEventListener("click", (e) => {
    const button = e.target.closest("[data-achievement-filter]");
    if (button) setAchievementFilter(button.dataset.achievementFilter);
  });
  $("#achievement-date-filter")?.addEventListener("change", (e) => setAchievementDateFilter(e.target.value));
  $("#achievement-rarity-filter")?.addEventListener("change", (e) => setAchievementRarityFilter(e.target.value));
  $("#achievements-grid")?.addEventListener("click", (e) => {
    const card = e.target.closest("[data-achievement-id]");
    if (card) openAchievementModal(card.dataset.achievementId, card);
  });
  $("#achievement-scrim")?.addEventListener("click", closeAchievementModal);
  $("#pl-save-btn")?.addEventListener("click", () => {
    saveProfileDesign({ asNew: true, stay: true });
  });
  $("#pl-list")?.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest("[data-profile-delete]");
    if (deleteBtn) {
      e.stopPropagation();
      const id = deleteBtn.dataset.profileDelete;
      const profile = getProfileById(id);
      if (!profile) return;
      openConfirmModal({
        title: "Delete saved design?",
        message: `Delete “${profileDesignName(profile)}”? This cannot be undone.`,
        confirmLabel: "DELETE DESIGN",
        onConfirm: () => {
          if (state.editingProfileId === id) deleteCurrentProfile();
          else {
            deleteProfile(id);
            renderProfileLibrary();
            renderProfileSummary();
          }
        },
      });
      return;
    }
    const editBtn = e.target.closest("[data-profile-edit]");
    if (editBtn) { e.stopPropagation(); openProfileEditor("home", editBtn.dataset.profileEdit); return; }
    const tile = e.target.closest("[data-profile-select]");
    if (tile) {
      const p = getProfileById(tile.dataset.profileSelect);
      if (p) {
        setActiveAppearance(p.id);
      }
    }
  });
  $("#account-register-btn")?.addEventListener("click", () => openAccountModal("register"));
  $("#account-login-btn")?.addEventListener("click", () => openAccountModal("login"));
  $("#account-edit-btn")?.addEventListener("click", () => openAccountModal("edit"));
  $("#account-logout-btn")?.addEventListener("click", logoutAccount);
  $("#account-scrim")?.addEventListener("click", closeAccountModal);

  // profile editor — delete
  $("#profile-delete-btn")?.addEventListener("click", () => {
    if (!state.editingProfileId) return;
    const p = getProfileById(state.editingProfileId);
    if (!p) return;
    openConfirmModal({
      title: "Delete saved design?",
      message: `Delete “${profileDesignName(p)}”? This cannot be undone.`,
      confirmLabel: "DELETE DESIGN",
      onConfirm: () => deleteCurrentProfile(),
    });
  });

  // profile editor — identity
  $("#profile-name")?.addEventListener("input", (e) => {
    state.profileDraft.designName = e.target.value.toUpperCase().slice(0, 12);
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

  // Independent global audio controls: effects and soundtrack can be muted
  // separately while the preference remains consistent across every view.
  const syncAudioButtons = () => {
    const soundSrc = state.sound ? "/assets/sound-on.svg" : "/assets/sound-off.svg";
    const musicSrc = state.music ? "/assets/music-on.svg" : "/assets/music-off.svg";
    [$("#sound-toggle-btn"), $("#game-sound-toggle-btn"), $("#profile-sound-toggle-btn"), $("#rankings-sound-toggle-btn"), $("#social-sound-toggle-btn")].forEach((button) => {
      if (!button) return;
      button.setAttribute("aria-pressed", String(state.sound));
      button.setAttribute("aria-label", state.sound ? "Turn sound effects off" : "Turn sound effects on");
      const icon = button.querySelector("img");
      if (icon) icon.src = soundSrc;
    });
    [$("#music-toggle-btn"), $("#game-music-toggle-btn"), $("#profile-music-toggle-btn"), $("#rankings-music-toggle-btn"), $("#social-music-toggle-btn")].forEach((button) => {
      if (!button) return;
      button.setAttribute("aria-pressed", String(state.music));
      button.setAttribute("aria-label", state.music ? "Turn parlor music off" : "Turn parlor music on");
      const icon = button.querySelector("img");
      if (icon) icon.src = musicSrc;
    });
  };
  syncAudioButtons();
  $("#sound-toggle-btn")?.addEventListener("click", () => {
    state.sound = !state.sound;
    saveSoundPreference(state.sound);
    if (state.sound) playSound("trade");
    syncAudioButtons();
    syncHomeMusic();
    renderProfileSummary();
  });
  $("#music-toggle-btn")?.addEventListener("click", () => {
    state.music = !state.music;
    saveMusicPreference(state.music);
    syncAudioButtons();
    syncHomeMusic();
    renderProfileSummary();
  });
  $("#game-sound-toggle-btn")?.addEventListener("click", () => {
    $("#sound-toggle-btn")?.click();
  });
  $("#game-music-toggle-btn")?.addEventListener("click", () => {
    $("#music-toggle-btn")?.click();
  });
  $("#profile-sound-toggle-btn")?.addEventListener("click", () => $("#sound-toggle-btn")?.click());
  $("#profile-music-toggle-btn")?.addEventListener("click", () => $("#music-toggle-btn")?.click());
  $("#rankings-sound-toggle-btn")?.addEventListener("click", () => $("#sound-toggle-btn")?.click());
  $("#rankings-music-toggle-btn")?.addEventListener("click", () => $("#music-toggle-btn")?.click());
  $("#social-sound-toggle-btn")?.addEventListener("click", () => $("#sound-toggle-btn")?.click());
  $("#social-music-toggle-btn")?.addEventListener("click", () => $("#music-toggle-btn")?.click());
  $("#home-helicopter")?.addEventListener("click", hitHomeHelicopter);
  $("#night-exit")?.addEventListener("click", stopNightShift);

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
  $("#tn-room-copy").addEventListener("click", copyRoomCode);

  // setup overlay
  $("#su-tabs")?.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-su-tab]");
    if (!tabBtn) return;
    state.setupTab = tabBtn.dataset.suTab;
    renderSetup();
  });
  $("#su-reset-btn")?.addEventListener("click", () => {
    clearTableAppearanceOverride();
    focusSurface("#setup-wrap", "#su-start");
  });
  $("#su-make-active-btn")?.addEventListener("click", () => {
    const choice = activeAppearance();
    state.appearance = choice;
    saveActiveDesignId(choice);
    state.tableAppearanceOverride = null;
    applyProfileToHomeUI();
    renderAccountPanel();
    renderProfileLibrary();
    renderSetup();
    renderLobbyRail();
    syncServerAppearance();
    focusSurface("#setup-wrap", "#su-start");
  });
  $("#su-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-app]");
    if (!btn) return;
    const raw = btn.dataset.app;
    // preset appearance = "0".."3"; custom profile ids look like "pf_xxxx"
    const choice = /^\d+$/.test(raw) ? Number(raw) : raw;
    setTableAppearanceOverride(choice);
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
      const limits = {
        maxPlayers: [2, 4],
        bots: [0, Math.max(0, Number(state.settings.maxPlayers) - 1)],
      };
      const [mn, mx] = limits[key] || [0, 999];
      state.settings[key] = clamp((Number(state.settings[key]) || 0) + dir, mn, mx);
      if (key === "maxPlayers") {
        state.settings.bots = clamp(Number(state.settings.bots) || 0, 0, Math.max(0, state.settings.maxPlayers - 1));
      }
      if (state.live) updateServerSetting(key, state.settings[key]);
      renderLobbyRail();
      return;
    }
  });
  const applySettingField = (e) => {
    const sel = e.target.closest("[data-setting]");
    if (sel && (sel.tagName === "SELECT" || sel.matches("input[data-setting]"))) {
      const key = sel.dataset.setting;
      const numericKeys = ["startingCash", "houseLimit", "hotelLimit", "turnTimer", "globalEventDuration", "globalEventMax"];
      if (numericKeys.includes(key)) {
        if (sel.value.trim() === "") return;
        const parsed = Number(sel.value);
        if (!Number.isFinite(parsed) || parsed < 0) return;
        state.settings[key] = Math.floor(parsed);
      } else {
        state.settings[key] = sel.value;
      }
      if (state.live) updateServerSetting(key, state.settings[key]);
      renderLobbyRail();
    }
  };
  $("#lobby-settings-body").addEventListener("change", applySettingField);

  $("#global-event-choices")?.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-global-choice]");
    if (!choice || choice.disabled || !state.live) return;
    emitServer("vote-global-event", { choiceId: choice.dataset.globalChoice }, (response) => {
      if (response?.success === false) {
        say(response.error || "Your vote could not be recorded.");
        renderChat();
      }
    });
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
  $("#use-jail-free")?.addEventListener("click", () => {
    if (!state.live) {
      useLocalJailFree();
      return;
    }
    emitServer("use-jail-free", {}, (response) => {
      if (response?.success === false) {
        say(response.error || "The card could not be used.");
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
    const bankAction = e.target.closest("[data-bank-action]");
    if (bankAction) {
      const eventName = bankAction.dataset.bankAction === "take" ? "take-bank-loan" : "repay-bank-loan";
      emitServer(eventName, {}, (response) => {
        if (response?.success === false) {
          say(response.error || "The bank transaction could not be completed.");
          renderChat();
        }
      });
      return;
    }
    const financeButton = e.target.closest("[data-finance-open], [data-finance-surface]");
    if (financeButton) {
      openFinancingModal(financeButton.dataset.financeOpen || "loan", null, financeButton, financeButton.dataset.financeSurface || "offer");
      return;
    }
    const buyBtn = e.target.closest("[data-buy]");
    if (buyBtn && !buyBtn.disabled) { buyTile(TILES[Number(buyBtn.dataset.buy)]); return; }
    const tradeBtn = e.target.closest("[data-trade]");
    if (tradeBtn && !tradeBtn.disabled) openTradeModal(tradeBtn.dataset.trade);
  });

  // popup
  $("#popup-scrim").addEventListener("click", closePopup);
  $("#trade-scrim").addEventListener("click", closeTradeModal);
  $("#financing-scrim").addEventListener("click", closeFinancingModal);
  $("#card-scrim").addEventListener("click", () => {
    state.card = null;
    closeSurface("#card-modal");
  });
  $("#card-gallery-close")?.addEventListener("click", closeCardGallery);
  $("#card-gallery .card-gallery-scrim")?.addEventListener("click", closeCardGallery);

  // keyboard
  window.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    const homeVisible = !$("#view-home").classList.contains("is-hidden");
    if (homeVisible && state.phase === "home" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p" && tag !== "INPUT" && tag !== "TEXTAREA" && !visibleSurfaces().length) {
      e.preventDefault();
      startNightShift();
      return;
    }
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
    const nightShiftOpen = !$("#night-shift").classList.contains("is-hidden");
    if (nightShiftOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        stopNightShift();
        return;
      }
      if (e.key !== "Tab") return;
    }
    if (state.phase === "setup" && e.key === "Escape") {
      e.preventDefault();
      goHome();
      return;
    }
    const roomsOpen = !$("#rooms-modal").classList.contains("is-hidden");
    const accountOpen = !$("#account-modal").classList.contains("is-hidden");
    if (accountOpen) { if (e.key === "Escape") closeAccountModal(); return; }
    const confirmOpen = !$("#confirm-modal").classList.contains("is-hidden");
    if (confirmOpen) { if (e.key === "Escape") closeConfirmModal(); return; }
    const achievementOpen = !$("#achievement-modal").classList.contains("is-hidden");
    if (achievementOpen) { if (e.key === "Escape") closeAchievementModal(); return; }
    const rankingsOpen = !$("#rankings-modal").classList.contains("is-hidden");
    if (rankingsOpen) { if (e.key === "Escape") closeSurface("#rankings-modal"); return; }
    const socialOpen = !$("#social-modal").classList.contains("is-hidden");
    if (socialOpen) { if (e.key === "Escape") closeSurface("#social-modal"); return; }
    const playerOpen = !$("#player-modal").classList.contains("is-hidden");
    if (playerOpen) { if (e.key === "Escape") closeSurface("#player-modal"); return; }
    const financingOpen = !$("#financing-modal").classList.contains("is-hidden");
    if (financingOpen) { if (e.key === "Escape") closeFinancingModal(); return; }
    const galleryOpen = !$("#card-gallery").classList.contains("is-hidden");
    if (galleryOpen) { if (e.key === "Escape") closeCardGallery(); return; }
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
      setHomeTab("rooms");
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
      openRoomsModal("join");
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

// Visual-only card preview for design review. It never changes game state and
// is enabled only with ?preview=surprise (or ?preview=treasure).
function openCardPreviewFromUrl() {
  const preview = new URLSearchParams(window.location.search).get("preview");
  if (preview === "cards") {
    requestAnimationFrame(openCardGallery);
    return;
  }
  if (preview !== "surprise" && preview !== "treasure") return;
  const kind = preview === "surprise" ? "chance" : "chest";
  const tile = TILES.find((entry) => entry.kind === kind);
  const deck = kind === "chance" ? CHANCE_EVENTS : CHEST_EVENTS;
  const event = deck.find((entry) => entry.action === "moveTo") || deck[0];
  if (!tile || !event) return;
  requestAnimationFrame(() => openCardReveal(tile, { ...event, cash: Number(event.cash) || 0 }));
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
openCardPreviewFromUrl();
