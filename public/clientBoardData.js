/* ============================================================
   BOARD DATA (client-side static tables)
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


const TILES = [
  { i: 0, name: "START", kind: "corner-go", col: 1, row: 1, side: "top" },
  { i: 1, name: "SALVADOR", kind: "property", col: 2, row: 1, side: "top", ...{ price: 60, rent: 10, group: "brown" } },
  { i: 2, name: "TREASURE", kind: "chest", col: 3, row: 1, side: "top" },
  { i: 3, name: "RIO", kind: "property", col: 4, row: 1, side: "top", ...{ price: 60, rent: 10, group: "brown" } },
  { i: 4, name: "EARNINGS TAX", kind: "tax", col: 5, row: 1, side: "top", ...{ price: 200 } },
  { i: 5, name: "ACC AIRPORT", kind: "railroad", col: 6, row: 1, side: "top", ...{ price: 200, rent: 25 } },
  { i: 6, name: "ACCRA", kind: "property", col: 7, row: 1, side: "top", ...{ price: 100, rent: 14, group: "cyan" } },
  { i: 7, name: "SURPRISE?", kind: "chance", col: 8, row: 1, side: "top" },
  { i: 8, name: "TEMA", kind: "property", col: 9, row: 1, side: "top", ...{ price: 100, rent: 14, group: "cyan" } },
  { i: 9, name: "KUMASI", kind: "property", col: 10, row: 1, side: "top", ...{ price: 120, rent: 16, group: "cyan" } },
  { i: 10, name: "PASSING BY", kind: "corner-jail", col: 11, row: 1, side: "top" },
  { i: 11, name: "PATTAYA", kind: "property", col: 11, row: 2, side: "right", ...{ price: 140, rent: 10, group: "magenta" } },
  { i: 12, name: "ELECTRIC COMPANY", kind: "utility", col: 11, row: 3, side: "right", ...{ price: 150, rent: 12 } },
  { i: 13, name: "CHIANG MAI", kind: "property", col: 11, row: 4, side: "right", ...{ price: 140, rent: 12, group: "magenta" } },
  { i: 14, name: "BANGKOK", kind: "property", col: 11, row: 5, side: "right", ...{ price: 160, rent: 14, group: "magenta" } },
  { i: 15, name: "BKK AIRPORT", kind: "railroad", col: 11, row: 6, side: "right", ...{ price: 200, rent: 25 } },
  { i: 16, name: "KYOTO", kind: "property", col: 11, row: 7, side: "right", ...{ price: 180, rent: 14, group: "orange" } },
  { i: 17, name: "TREASURE", kind: "chest", col: 11, row: 8, side: "right" },
  { i: 18, name: "OSAKA", kind: "property", col: 11, row: 9, side: "right", ...{ price: 180, rent: 14, group: "orange" } },
  { i: 19, name: "TOKYO", kind: "property", col: 11, row: 10, side: "right", ...{ price: 200, rent: 16, group: "orange" } },
  { i: 20, name: "VACATION", kind: "corner-vacation", col: 11, row: 11, side: "bottom" },
  { i: 21, name: "EINDHOVEN", kind: "property", col: 10, row: 11, side: "bottom", ...{ price: 220, rent: 18, group: "red" } },
  { i: 22, name: "SURPRISE?", kind: "chance", col: 9, row: 11, side: "bottom" },
  { i: 23, name: "ROTTERDAM", kind: "property", col: 8, row: 11, side: "bottom", ...{ price: 220, rent: 18, group: "red" } },
  { i: 24, name: "AMSTERDAM", kind: "property", col: 7, row: 11, side: "bottom", ...{ price: 240, rent: 20, group: "red" } },
  { i: 25, name: "AMS AIRPORT", kind: "railroad", col: 6, row: 11, side: "bottom", ...{ price: 200, rent: 25 } },
  { i: 26, name: "CALGARY", kind: "property", col: 5, row: 11, side: "bottom", ...{ price: 260, rent: 22, group: "yellow" } },
  { i: 27, name: "VANCOUVER", kind: "property", col: 4, row: 11, side: "bottom", ...{ price: 260, rent: 22, group: "yellow" } },
  { i: 28, name: "WATER COMPANY", kind: "utility", col: 3, row: 11, side: "bottom", ...{ price: 150, rent: 12 } },
  { i: 29, name: "TORONTO", kind: "property", col: 2, row: 11, side: "bottom", ...{ price: 280, rent: 24, group: "yellow" } },
  { i: 30, name: "GO TO PRISON", kind: "corner-go-jail", col: 1, row: 11, side: "bottom" },
  { i: 31, name: "BERN", kind: "property", col: 1, row: 10, side: "left", ...{ price: 300, rent: 26, group: "green" } },
  { i: 32, name: "GENEVA", kind: "property", col: 1, row: 9, side: "left", ...{ price: 300, rent: 26, group: "green" } },
  { i: 33, name: "TREASURE", kind: "chest", col: 1, row: 8, side: "left" },
  { i: 34, name: "ZURICH", kind: "property", col: 1, row: 7, side: "left", ...{ price: 320, rent: 28, group: "green" } },
  { i: 35, name: "MB AIRPORT", kind: "railroad", col: 1, row: 6, side: "left", ...{ price: 200, rent: 25 } },
  { i: 36, name: "SURPRISE?", kind: "chance", col: 1, row: 5, side: "left" },
  { i: 37, name: "DOWNTOWN", kind: "property", col: 1, row: 4, side: "left", ...{ price: 400, rent: 35, group: "blue" } },
  { i: 38, name: "PREMIUM TAX", kind: "tax", col: 1, row: 3, side: "left", ...{ price: 75 } },
  { i: 39, name: "MARINA BAY", kind: "property", col: 1, row: 2, side: "left", ...{ price: 400, rent: 50, group: "blue" } },
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
export function mortgageValue(tile) {
  return Math.floor((tile.price || 0) * 0.5);
}

export function unmortgageCost(tile) {
  return Math.ceil((tile.price || 0) * 0.55);
}

export {
  GROUP_COLOR,
  RENT_TABLE,
  MAX_HOUSES,
  HOTEL_LEVEL,
  GROUP_TARGETS,
  TILES,
  TILE_COUNT,
  START_TILE_INDEX,
  JAIL_TILE_INDEX,
  CHANCE_EVENTS,
  CHEST_EVENTS,
};
