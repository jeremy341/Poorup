// Rent ladders for every owned count on both boards (F-014). Metro-52 has six
// airports and four utilities, so the airport table must reach six and the
// utility dice multiplier must reach four. Standard-40 keeps its four airports
// and two utilities. Each count is checked on three paths that must agree: the
// live engine (GameState.getPropertyRent), the game-side forecast and the bot
// snapshot forecast the bots plan with.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { calculateRentFromFacts, rentFactsFromGame, rentFactsFromSnapshot } from './botRentForecast.js';
import { buildBotStrategicContext } from './botStrategicContext.js';

const DICE = [3, 4];
const DICE_TOTAL = 7;

// Index = owned count minus one. Airports are flat amounts; utilities are a
// multiple of the dice total (4x with one owned, 10x with two, and so on).
const EXPECTED_RENT = {
  'standard-40': {
    railroad: [25, 50, 100, 200],
    utility: [4 * DICE_TOTAL, 10 * DICE_TOTAL],
  },
  'metro-52': {
    railroad: [25, 50, 100, 200, 300, 400],
    utility: [4 * DICE_TOTAL, 10 * DICE_TOTAL, 14 * DICE_TOTAL, 18 * DICE_TOTAL],
  },
};

function newGame(boardVariant) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-a', clientId: 'c-a', nickname: 'Ada', boardVariant });
  room.addOrReconnectPlayer({ socketId: 's-b', clientId: 'c-b', nickname: 'Bob' });
  assert.equal(room.game.boardVariant, boardVariant, `the fixture must build the ${boardVariant} board`);
  return room.game;
}

function rentPaths(game, tile) {
  const diceTotal = Math.max(2, (game.lastDice?.[0] || 0) + (game.lastDice?.[1] || 0));
  const snapshot = buildBotStrategicContext(game, game.players[0]);
  return {
    engine: game.getPropertyRent(tile),
    game: calculateRentFromFacts(rentFactsFromGame(game, tile, diceTotal)),
    snapshot: calculateRentFromFacts(rentFactsFromSnapshot(snapshot, snapshot.board[tile.index], diceTotal)),
  };
}

let passed = 0;
const failures = [];

for (const [boardVariant, byType] of Object.entries(EXPECTED_RENT)) {
  for (const [type, rents] of Object.entries(byType)) {
    const game = newGame(boardVariant);
    const boardTiles = game.tiles.filter(tile => tile.type === type);
    assert.equal(boardTiles.length, rents.length, `${boardVariant} has ${boardTiles.length} ${type} spaces, so the table must cover each owned count`);
    for (let owned = 1; owned <= boardTiles.length; owned += 1) {
      const fresh = newGame(boardVariant);
      fresh.lastDice = DICE;
      const freshTiles = fresh.tiles.filter(tile => tile.type === type);
      freshTiles.slice(0, owned).forEach(tile => { tile.ownerId = fresh.players[0].id; });
      const probe = freshTiles[0];
      const want = rents[owned - 1];
      const got = rentPaths(fresh, probe);
      const label = `${boardVariant} ${type} with ${owned} owned`;
      if (got.engine === want && got.game === want && got.snapshot === want) {
        passed += 1;
        console.log(`PASS - rent ${label} = ${want} (engine/game/snapshot)`);
      } else {
        failures.push(label);
        console.log(`FAIL - rent ${label}: expected ${want}, got engine=${got.engine}, game=${got.game}, snapshot=${got.snapshot}`);
      }
    }
  }
}

// Standard-40 is pinned: its airport and utility rents must not move with the
// Metro extension. The table lengths above already fix the counts; these
// checks pin the actual values for the standard board's owned counts.
const standard = newGame('standard-40');
assert.deepEqual(standard.tiles.filter(tile => tile.type === 'railroad').map(tile => tile.index), [5, 15, 25, 35]);
assert.deepEqual(standard.tiles.filter(tile => tile.type === 'utility').map(tile => tile.index), [12, 28]);

console.log(`metro rent tier tests: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error(`failed: ${failures.join('; ')}`);
  process.exitCode = 1;
}
