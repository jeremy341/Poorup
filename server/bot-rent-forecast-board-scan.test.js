// rentFactsFromSnapshot runs millions of times per expert match (the future
// planner projects every candidate over every dice total). It must derive the
// group and railroad/utility counts in ONE pass over the board, and must keep
// answering exactly like the original multi-filter scan, which is the oracle below.
import assert from 'node:assert/strict';
import { calculateRentFromFacts, rentFactsFromSnapshot } from './botRentForecast.js';

const GROUPS = ['Brown', 'Light Blue', 'Pink', 'Orange', 'Red', 'Yellow', 'Green', 'Dark Blue', 'Metro Silver', 'Metro Gold'];
const SEATS = ['bank', 'self', 'opponent-1', 'opponent-2', 'opponent-3'];

let seed = 20261020;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = list => list[Math.floor(random() * list.length)];

function randomBoard() {
  const size = 20 + Math.floor(random() * 33);
  return Array.from({ length: size }, (_, index) => {
    const type = pick(['property', 'property', 'property', 'railroad', 'utility', 'tax', 'chance']);
    const tile = { index, type, ownerSeat: pick(SEATS), mortgaged: random() < 0.2, houseCount: Math.floor(random() * 3), rent: 10 + index };
    if (type === 'property') tile.group = pick(GROUPS);
    if (random() < 0.05) delete tile.ownerSeat;
    return tile;
  });
}

// The pre-optimisation implementation, kept verbatim as the reference.
function oracleCounts(board, tile) {
  const ownerSeat = tile?.ownerSeat || 'bank';
  const ownerTiles = board.filter(entry => entry.ownerSeat === ownerSeat && ownerSeat !== 'bank' && !entry.mortgaged);
  const groupTiles = board.filter(entry => entry.group === tile?.group);
  return {
    hasFullSet: Boolean(tile?.group && groupTiles.length > 0 && groupTiles.every(entry => entry.ownerSeat === ownerSeat)),
    ownedRailroadCount: ownerTiles.filter(entry => entry.type === 'railroad').length,
    ownedUtilityCount: ownerTiles.filter(entry => entry.type === 'utility').length,
  };
}

let compared = 0;
for (let boardNumber = 0; boardNumber < 400; boardNumber += 1) {
  const board = randomBoard();
  const snapshot = { board, rulesDigest: { doubleRent: random() < 0.5, globalEvents: { activeEffects: {} } }, activeEvent: null };
  for (const entry of board) {
    for (const ownerSeat of [entry.ownerSeat, pick(SEATS), undefined]) {
      const tile = { ...entry, ownerSeat };
      const diceTotal = 2 + Math.floor(random() * 11);
      const facts = rentFactsFromSnapshot(snapshot, tile, diceTotal);
      const expected = oracleCounts(board, tile);
      assert.equal(facts.hasFullSet, expected.hasFullSet, `hasFullSet board ${boardNumber} tile ${entry.index} seat ${ownerSeat}`);
      assert.equal(facts.ownedRailroadCount, expected.ownedRailroadCount, `railroads board ${boardNumber} tile ${entry.index} seat ${ownerSeat}`);
      assert.equal(facts.ownedUtilityCount, expected.ownedUtilityCount, `utilities board ${boardNumber} tile ${entry.index} seat ${ownerSeat}`);
      assert.equal(calculateRentFromFacts(facts), calculateRentFromFacts({ ...facts, ...expected }));
      compared += 1;
    }
  }
}
assert.ok(compared > 20000, `compared ${compared} cases`);

// Edge cases the property run may not hit: an all-bank group is a "full set" for the
// bank seat only; mortgaged railroads do not count; a tile without a group never
// completes a set even when other group-less tiles exist.
{
  const board = [
    { index: 0, type: 'property', group: 'Brown', ownerSeat: 'bank' },
    { index: 1, type: 'property', group: 'Brown', ownerSeat: 'bank' },
    { index: 2, type: 'railroad', ownerSeat: 'self', mortgaged: true },
    { index: 3, type: 'railroad', ownerSeat: 'self' },
    { index: 4, type: 'utility', ownerSeat: 'self' },
    { index: 5, type: 'other', ownerSeat: 'self' },
  ];
  const snapshot = { board, rulesDigest: {}, activeEvent: null };
  assert.equal(rentFactsFromSnapshot(snapshot, board[0], 7).hasFullSet, true);
  assert.equal(rentFactsFromSnapshot(snapshot, { ...board[0], ownerSeat: 'self' }, 7).hasFullSet, false);
  const own = rentFactsFromSnapshot(snapshot, board[3], 7);
  assert.equal(own.ownedRailroadCount, 1, 'a mortgaged railroad is not counted');
  assert.equal(own.ownedUtilityCount, 1);
  assert.equal(rentFactsFromSnapshot(snapshot, board[5], 7).hasFullSet, false);
  assert.equal(rentFactsFromSnapshot(snapshot, { ...board[3], ownerSeat: 'bank' }, 7).ownedRailroadCount, 0, 'the bank owns no counted assets');
}

// Cost contract: one pass over the board per call, not one filter per question.
{
  const board = Array.from({ length: 40 }, (_, index) => ({ index, type: index % 5 === 0 ? 'railroad' : 'property', group: index % 5 === 0 ? undefined : GROUPS[index % 8], ownerSeat: SEATS[index % 4] }));
  let reads = 0;
  const watched = new Proxy(board, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1; return Reflect.get(target, key, receiver); } });
  rentFactsFromSnapshot({ board: watched, rulesDigest: {}, activeEvent: null }, board[7], 7);
  assert.ok(reads <= board.length, `board read ${reads} times for ${board.length} tiles`);
}

console.log(`bot rent forecast board scan: ${compared} snapshot cases match the reference, one pass per call`);
