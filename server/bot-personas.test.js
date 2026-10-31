import assert from 'node:assert/strict';
import { BOT_PERSONAS, personaForSeat, personasForDifficulty } from './botPersonas.js';
import { createBotPersonaStore } from './botPersonaStore.js';
import { LOBBY_BOT_NAMES } from './nicknamePolicy.js';

// Five personas per difficulty, fifteen in total, with no repeated id or name.
for (const difficulty of ['house', 'table', 'expert']) {
  assert.equal(personasForDifficulty(difficulty).length, 5, `${difficulty} has five personas`);
}
assert.equal(BOT_PERSONAS.length, 15);
assert.equal(new Set(BOT_PERSONAS.map(persona => persona.id)).size, 15, 'ids are unique');
assert.equal(new Set(BOT_PERSONAS.map(persona => persona.name)).size, 15, 'names are unique');
assert.deepEqual(LOBBY_BOT_NAMES, BOT_PERSONAS.map(persona => persona.name), 'reserved bot names come from the roster');
console.log('persona roster checks passed');

// A full table of one difficulty gets five different names, and an unknown difficulty falls back to table.
const houseSeats = [0, 1, 2, 3].map(index => personaForSeat('house', index).name);
assert.deepEqual(houseSeats, ['Dice Goblin', 'Mossy Roll', 'Penny Arcade', 'Coin Flip']);
assert.equal(personaForSeat('nonsense', 0).difficulty, 'table');
console.log('persona seat checks passed');

// Records start at zero, count only known personas, and never touch a file when no path is given.
const store = createBotPersonaStore(null);
assert.deepEqual(store.statsFor('dice-goblin'), { gamesPlayed: 0, wins: 0 });
store.recordGame('dice-goblin', true);
store.recordGame('dice-goblin', false);
assert.deepEqual(store.statsFor('dice-goblin'), { gamesPlayed: 2, wins: 1 });
store.recordGame('not-a-persona', true);
assert.deepEqual(store.statsFor('not-a-persona'), { gamesPlayed: 0, wins: 0 });
console.log('persona stats checks passed');
