// Board definitions are data, not a second rules engine.  The standard board
// delegates to the legacy tile table so Classic keeps its exact wire shape;
// Metro adds semantic ids and new spaces without changing movement semantics.
import { DEFAULT_TILES, SURPRISE_DECK, TREASURE_DECK, cloneTiles } from './gameData.js';

const STANDARD_TILE_IDS = [
  'start', 'salvador', 'treasure-1', 'rio', 'earnings-tax', 'acc-airport',
  'accra', 'surprise-1', 'tema', 'kumasi', 'passing-by', 'pattaya',
  'electric-company', 'chiang-mai', 'bangkok', 'bkk-airport', 'kyoto',
  'treasure-2', 'osaka', 'tokyo', 'vacation', 'eindhoven', 'surprise-2',
  'rotterdam', 'amsterdam', 'ams-airport', 'calgary', 'vancouver',
  'water-company', 'toronto', 'go-to-prison', 'bern', 'geneva', 'treasure-3',
  'zurich', 'mb-airport', 'surprise-3', 'downtown', 'premium-tax', 'marina-bay'
];

const GROUPS = Object.freeze({
  metroGold: { group: 'Metro Gold', color: '#c88f2e', houseCost: 200 },
  metroSilver: { group: 'Metro Silver', color: '#8aa3ae', houseCost: 200 }
});

function baseAt(index) {
  const tile = DEFAULT_TILES[index];
  return tile ? { ...tile } : null;
}

function namedTile(index, tileId, overrides = {}) {
  const source = baseAt(index) || {};
  return { ...source, ...overrides, tileId };
}

function createMetroTiles() {
  const metro = [
    namedTile(0, 'start'),
    namedTile(1, 'salvador'),
    namedTile(2, 'treasure-1'),
    namedTile(3, 'rio'),
    namedTile(4, 'earnings-tax'),
    namedTile(5, 'acc-airport'),
    namedTile(6, 'accra'),
    namedTile(7, 'surprise-1'),
    namedTile(8, 'tema'),
    namedTile(9, 'kumasi'),
    namedTile(9, 'lagos', { name: 'Lagos', type: 'property', group: GROUPS.metroGold.group, price: 320, rent: 34, color: GROUPS.metroGold.color }),
    namedTile(9, 'abuja', { name: 'Abuja', type: 'property', group: GROUPS.metroGold.group, price: 340, rent: 36, color: GROUPS.metroGold.color }),
    namedTile(7, 'surprise-4'),
    namedTile(10, 'passing-by'),
    namedTile(11, 'pattaya'),
    namedTile(12, 'electric-company'),
    namedTile(13, 'chiang-mai'),
    namedTile(14, 'bangkok'),
    namedTile(15, 'bkk-airport'),
    namedTile(16, 'kyoto'),
    namedTile(17, 'treasure-2'),
    namedTile(18, 'osaka'),
    namedTile(19, 'tokyo'),
    namedTile(19, 'seoul', { name: 'Seoul', type: 'property', group: GROUPS.metroSilver.group, price: 380, rent: 38, color: GROUPS.metroSilver.color }),
    namedTile(19, 'busan', { name: 'Busan', type: 'property', group: GROUPS.metroSilver.group, price: 420, rent: 42, color: GROUPS.metroSilver.color }),
    namedTile(15, 'icn-airport', { name: 'ICN Airport', type: 'railroad', price: 200, rent: 25 }),
    namedTile(20, 'vacation'),
    namedTile(21, 'eindhoven'),
    namedTile(22, 'surprise-2'),
    namedTile(23, 'rotterdam'),
    namedTile(24, 'amsterdam'),
    namedTile(25, 'ams-airport'),
    namedTile(26, 'calgary'),
    namedTile(27, 'vancouver'),
    namedTile(28, 'water-company'),
    namedTile(29, 'toronto'),
    namedTile(35, 'jnb-airport', { name: 'JNB Airport', type: 'railroad', price: 200, rent: 25 }),
    namedTile(12, 'power-grid', { name: 'Power Grid', type: 'utility', price: 150, rent: 12 }),
    namedTile(38, 'city-levy', { name: 'City Levy', type: 'tax', amount: 100 }),
    namedTile(30, 'go-to-prison'),
    namedTile(31, 'bern'),
    namedTile(32, 'geneva'),
    namedTile(33, 'treasure-3'),
    namedTile(34, 'zurich'),
    namedTile(35, 'mb-airport'),
    namedTile(36, 'surprise-3'),
    namedTile(37, 'downtown'),
    namedTile(38, 'premium-tax'),
    namedTile(39, 'marina-bay'),
    namedTile(28, 'waterworks', { name: 'Waterworks', type: 'utility', price: 150, rent: 12 }),
    namedTile(33, 'treasure-4'),
    namedTile(38, 'transit-tax', { name: 'Transit Tax', type: 'tax', amount: 75 })
  ];
  return applyMetroCoordinates(metro);
}

function applyMetroCoordinates(tiles) {
  const size = 14;
  tiles.forEach((tile, index) => {
    tile.index = index;
    if (index <= 13) {
      tile.col = index + 1;
      tile.row = 1;
      tile.side = 'top';
    } else if (index <= 26) {
      tile.col = size;
      tile.row = index - 12;
      tile.side = 'right';
    } else if (index <= 39) {
      tile.col = size - (index - 26);
      tile.row = size;
      tile.side = 'bottom';
    } else {
      tile.col = 1;
      tile.row = size - (index - 39);
      tile.side = 'left';
    }
  });
  return tiles;
}

function cloneRuntimeTile(tile, includeSemanticId = false) {
  const runtime = { ...tile, ownerId: null, mortgaged: false, houseCount: 0, equityShares: [] };
  if (!includeSemanticId) delete runtime.tileId;
  return runtime;
}

const METRO_TILES = Object.freeze(createMetroTiles().map(tile => Object.freeze({ ...tile })));
const TILE_SETS = Object.freeze({
  'standard-40': Object.freeze(DEFAULT_TILES.map((tile, index) => Object.freeze({ ...tile, tileId: STANDARD_TILE_IDS[index] }))),
  'metro-52': METRO_TILES
});

function tilesForVariant(variant = 'standard-40') {
  const key = variant === 'metro-52' ? 'metro-52' : 'standard-40';
  const includeSemanticId = key === 'metro-52';
  if (key === 'standard-40') return cloneTiles();
  return TILE_SETS[key].map(tile => cloneRuntimeTile(tile, includeSemanticId));
}

function tileIndexById(variant, tileId) {
  const set = TILE_SETS[variant === 'metro-52' ? 'metro-52' : 'standard-40'];
  const found = set.find(tile => tile.tileId === tileId);
  return found ? found.index : null;
}

function tileIdAt(variant, index) {
  const set = TILE_SETS[variant === 'metro-52' ? 'metro-52' : 'standard-40'];
  return set[index]?.tileId || null;
}

function boardDefinition(variant = 'standard-40') {
  const key = variant === 'metro-52' ? 'metro-52' : 'standard-40';
  return {
    id: key,
    spaces: TILE_SETS[key].length,
    spacesPerSide: key === 'metro-52' ? 13 : 10,
    corners: key === 'metro-52' ? [0, 13, 26, 39] : [0, 10, 20, 30],
    maxPlayers: key === 'metro-52' ? 6 : 4,
    tiles: TILE_SETS[key].map(tile => ({ ...tile }))
  };
}

export class BoardRegistry {
  get(variant = 'standard-40') { return boardDefinition(variant); }
  cloneTiles(variant = 'standard-40') { return tilesForVariant(variant); }
  tileIndex(variant, tileId) { return tileIndexById(variant, tileId); }
  variants() { return ['standard-40', 'metro-52']; }
}

function deckForVariant(source, variant) {
  return source.map(card => {
    if (variant !== 'metro-52' || card.tileIndex == null) return { ...card };
    const tileId = STANDARD_TILE_IDS[Number(card.tileIndex)];
    return tileId ? { ...card, tileId } : { ...card };
  });
}

function decksForVariant(variant = 'standard-40') {
  return {
    surprise: deckForVariant(SURPRISE_DECK, variant),
    treasure: deckForVariant(TREASURE_DECK, variant)
  };
}

export {
  GROUPS,
  METRO_TILES,
  STANDARD_TILE_IDS,
  TILE_SETS,
  boardDefinition,
  decksForVariant,
  tileIdAt,
  tileIndexById,
  tilesForVariant
};
