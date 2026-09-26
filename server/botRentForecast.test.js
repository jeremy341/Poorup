import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import { calculateRentFromFacts, rentFactsFromGame, rentFactsFromSnapshot } from './botRentForecast.js';

function makeRentFixture({ propertyIndex = 1, owners = null, houseCount = 0, mortgaged = [], doubleRent = false, diceTotal = 7, event = null } = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-a', clientId: 'c-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-b', clientId: 'c-b', nickname: 'Bob' });
  const game = room.game;
  const liveTile = game.tiles[propertyIndex];
  liveTile.houseCount = houseCount;
  game.settings.doubleRent = doubleRent;
  (owners || [[propertyIndex, 0]]).forEach(([index, owner]) => { game.tiles[index].ownerId = game.players[owner].id; });
  mortgaged.forEach(index => { game.tiles[index].mortgaged = true; });
  game.lastDice = [Math.floor(diceTotal / 2), Math.ceil(diceTotal / 2)];
  if (event) game.globalEvent = { phase: 'active', ...event, ...(event.targetPlayerId === 'self' ? { targetPlayerId: game.players[0].id } : {}) };
  const snapshot = buildBotStrategicContext(game, game.players[0]);
  return { game, liveTile, snapshot };
}

for (const [houseCount, expected] of [[0, 10], [1, 50], [2, 150], [3, 450], [4, 800], [5, 1250]]) {
  const fixture = makeRentFixture({ houseCount });
  const gameFacts = rentFactsFromGame(fixture.game, fixture.liveTile, 7);
  const snapshotFacts = rentFactsFromSnapshot(fixture.snapshot, fixture.snapshot.board[1], 7);
  assert.deepEqual(Object.keys(gameFacts).sort(), Object.keys(snapshotFacts).sort());
  assert.deepEqual(gameFacts.eventFactors, snapshotFacts.eventFactors);
  assert.equal(fixture.game.calculateRent(fixture.liveTile), expected);
  assert.equal(calculateRentFromFacts(gameFacts), expected);
  assert.equal(calculateRentFromFacts(snapshotFacts), expected);
}

const rentCases = [
  ['complete-set-double-rent', { owners: [[1, 0], [3, 0]], doubleRent: true }, 20],
  ['mortgage', { owners: [[1, 0]], mortgaged: [1] }, 0],
  ['housing-bubble', { owners: [[1, 0]], houseCount: 1, event: { id: 'housing-bubble', effects: { rentMultiplier: 2 } } }, 32],
  ['airport-strike', { propertyIndex: 5, owners: [[5, 0]], event: { id: 'airport-strike', effects: { airportRentMultiplier: 3 } } }, 0],
  ['airport-multiplier', { propertyIndex: 5, owners: [[5, 0]], event: { id: 'custom', effects: { airportRentMultiplier: 3 } } }, 75],
  ['tourism-railroad', { propertyIndex: 5, owners: [[5, 0]], event: { id: 'tourism-boom', effects: { airportRentMultiplier: 1.5 } } }, 37],
  ['tourism-dark-blue', { propertyIndex: 37, owners: [[37, 0]], event: { id: 'tourism-boom', effects: { premiumRentMultiplier: 2 } } }, 45],
  ['anti-monopoly-target', { owners: [[1, 0]], event: { id: 'anti-monopoly', targetPlayerId: 'self' } }, 6],
  ['anti-monopoly-dismissed', { owners: [[1, 0]], event: { id: 'anti-monopoly', targetPlayerId: 'self', resolvedChoice: 'dismiss' } }, 10],
  ['anti-monopoly-nontarget', { owners: [[1, 0]], event: { id: 'anti-monopoly', targetPlayerId: 'other' } }, 10],
  ['energy-crisis', { propertyIndex: 12, owners: [[12, 0]], event: { id: 'energy-crisis', effects: { utilityRentMultiplier: 2 } }, diceTotal: 7 }, 42],
  ['utility-multiplier', { propertyIndex: 12, owners: [[12, 0]], event: { id: 'custom', effects: { utilityRentMultiplier: 2 } }, diceTotal: 7 }, 56],
  ['public-works', { owners: [[1, 0]], event: { id: 'city-election', resolvedChoice: 'public-works' } }, 7],
  ['global-multiplier', { owners: [[1, 0]], event: { id: 'custom', effects: { rentMultiplier: 2 } } }, 20],
  ['global-zero-skip', { owners: [[1, 0]], event: { id: 'custom', effects: { rentMultiplier: 0 } } }, 10],
  ['global-invalid-skip', { owners: [[1, 0]], event: { id: 'custom', effects: { rentMultiplier: 'x' } } }, 10],
  ['rent-cap', { propertyIndex: 5, owners: [[5, 0], [15, 0]], event: { id: 'custom', effects: { rentCap: 30 } } }, 30]
];

const publicMovementCounts = fixture => fixture.snapshot.rulesDigest.cards.surpriseMovement
  .reduce((counts, entry) => ({ ...counts, [entry.action]: (counts[entry.action] || 0) + entry.count }), {});
assert.deepEqual(publicMovementCounts(makeRentFixture()), {
  collectStart: 1,
  goToJail: 1,
  moveBack: 1,
  moveTo: 4,
  nearestRailroad: 2,
  nearestUtility: 1
});

for (const [name, options, expected] of rentCases) {
  const fixture = makeRentFixture(options);
  assert.equal(fixture.game.calculateRent(fixture.liveTile), expected, `${name} live rent`);
  assert.equal(calculateRentFromFacts(rentFactsFromGame(fixture.game, fixture.liveTile, options.diceTotal || 7)), expected, `${name} game forecast`);
  assert.equal(calculateRentFromFacts(rentFactsFromSnapshot(fixture.snapshot, fixture.snapshot.board[options.propertyIndex || 1], options.diceTotal || 7)), expected, `${name} snapshot forecast`);
}

for (let count = 1; count <= 4; count += 1) {
  const indexes = [5, 15, 25, 35].slice(0, count).map(index => [index, 0]);
  const fixture = makeRentFixture({ propertyIndex: 5, owners: indexes });
  const expected = [25, 50, 100, 200][count - 1];
  assert.equal(calculateRentFromFacts(rentFactsFromGame(fixture.game, fixture.liveTile, 7)), expected, `railroad count ${count}`);
  assert.equal(calculateRentFromFacts(rentFactsFromSnapshot(fixture.snapshot, fixture.snapshot.board[5], 7)), expected, `snapshot railroad count ${count}`);
}

for (let count = 1; count <= 2; count += 1) {
  const owners = count === 1 ? [[12, 0]] : [[12, 0], [28, 0]];
  for (let diceTotal = 2; diceTotal <= 12; diceTotal += 1) {
    const fixture = makeRentFixture({ propertyIndex: 12, owners, diceTotal });
    const expected = diceTotal * (count === 2 ? 10 : 4);
    assert.equal(calculateRentFromFacts(rentFactsFromGame(fixture.game, fixture.liveTile, diceTotal)), expected, `utility count ${count}, dice ${diceTotal}`);
    assert.equal(calculateRentFromFacts(rentFactsFromSnapshot(fixture.snapshot, fixture.snapshot.board[12], diceTotal)), expected, `snapshot utility count ${count}, dice ${diceTotal}`);
  }
}

console.log('bot rent forecast parity tests passed');
