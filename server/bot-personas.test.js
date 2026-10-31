import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { AchievementStore } from './achievementStore.js';
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
assert.deepEqual(store.statsFor('dice-goblin'), { gamesPlayed: 0, wins: 0, achievements: 0 });
store.recordGame('dice-goblin', true);
store.recordGame('dice-goblin', false);
assert.deepEqual(store.statsFor('dice-goblin'), { gamesPlayed: 2, wins: 1, achievements: 0 });
store.recordGame('not-a-persona', true);
assert.deepEqual(store.statsFor('not-a-persona'), { gamesPlayed: 0, wins: 0, achievements: 0 });
console.log('persona stats checks passed');

// Cross-game history is kept once per entry, so the same card seen twice counts once.
store.recordHistory('dice-goblin', { treasureCards: ['card-a', 'card-a', 'card-b'], events: ['HOUSING BUBBLE'] });
store.recordHistory('dice-goblin', { treasureCards: ['card-b'], events: ['HOUSING BUBBLE', 'BANK RUN'] });
assert.deepEqual(store.historyFor('dice-goblin'), { treasureCards: ['card-a', 'card-b'], events: ['HOUSING BUBBLE', 'BANK RUN'] });
console.log('persona history checks passed');

// An achievement is kept once per persona.
const unlock = { achievementId: '41st-tile', title: 'THE 41ST TILE', rarity: 'MYTHICAL', body: 'There are forty tiles. You stepped on one more.' };
assert.equal(store.recordAchievement('dice-goblin', unlock), true);
assert.equal(store.recordAchievement('dice-goblin', unlock), false, 'a repeat unlock is not counted twice');
assert.equal(store.statsFor('dice-goblin').achievements, 1);
assert.equal(store.achievementsFor('dice-goblin')[0].title, 'THE 41ST TILE');
// The table card reads counts and unlocks together; an unknown persona has no profile.
assert.equal(store.profileFor('not-a-persona'), null);
assert.deepEqual(store.profileFor('dice-goblin'), { gamesPlayed: 2, wins: 1, achievements: 1, unlocked: store.achievementsFor('dice-goblin') });
console.log('persona achievement checks passed');

// A computer seat can earn a match-only rule, and its unlock carries no account key.
const achievements = new AchievementStore(path.join(os.tmpdir(), 'poorup-missing-achievements.json'));
const matchRecord = {
  participants: [
    { accountId: null, personaId: 'dice-goblin', finalPlacement: 1, hiddenMovementSequence: true, endingCash: 900 },
    { accountId: 'acct-1', personaId: null, finalPlacement: 2, hiddenMovementSequence: false, endingCash: 100 },
  ],
  globalEvents: [],
  eventCombinations: [],
  playerContracts: [],
};
const candidates = achievements.evaluateMatch(matchRecord, () => []);
const personaUnlocks = candidates.filter(candidate => candidate.personaId);
assert.ok(personaUnlocks.some(candidate => candidate.personaId === 'dice-goblin' && candidate.achievementId === '41st-tile'));
assert.ok(personaUnlocks.every(candidate => !Object.hasOwn(candidate, 'accountId')), 'persona unlocks never carry an account key');
console.log('persona evaluation checks passed');

// Loans are matched by persona id, and cash is compared against the other seats.
const lendingMatch = {
  participants: [
    { accountId: null, personaId: 'dice-goblin', finalPlacement: 1, endingCash: 900 },
    { accountId: null, personaId: 'mossy-roll', finalPlacement: 2, endingCash: 100 },
  ],
  globalEvents: [],
  eventCombinations: [],
  playerContracts: [
    { kind: 'loan', status: 'paid', fromAccountId: null, toAccountId: null, fromPersonaId: 'dice-goblin', toPersonaId: 'mossy-roll', collateralTileIndex: null },
  ],
};
const lendingUnlocks = achievements.evaluateMatch(lendingMatch, () => []).filter(candidate => candidate.personaId);
const unlocksFor = personaId => lendingUnlocks.filter(candidate => candidate.personaId === personaId).map(candidate => candidate.achievementId);
assert.ok(unlocksFor('dice-goblin').includes('generous-lender'), 'the persona that funded a repaid loan earns it');
assert.ok(unlocksFor('dice-goblin').includes('liquidity-king'), 'a persona with more cash than the table combined earns it');
assert.ok(!unlocksFor('mossy-roll').includes('generous-lender'), 'the borrower does not earn the lender rule');
console.log('persona loan and cash checks passed');

// Counts across games use the persona's own history, not an account's.
const historyMatch = {
  participants: [{ accountId: null, personaId: 'dice-goblin', finalPlacement: 2, endingCash: 0, treasureCardsSeenList: ['card-x', 'card-y'] }],
  globalEvents: ['EVENT ONE'],
  eventCombinations: [],
  playerContracts: [],
};
const storedHistory = { treasureCards: Array.from({ length: 14 }, (_, index) => `card-${index}`), events: ['EVENT TWO', 'EVENT THREE'] };
const historyUnlocks = achievements.evaluateMatch(historyMatch, null, () => storedHistory).map(candidate => candidate.achievementId);
assert.ok(historyUnlocks.includes('treasure-map'), 'sixteen treasure cards across games earn Treasure Map');
assert.ok(historyUnlocks.includes('event-tourist'), 'three headlines across games earn Event Tourist');
console.log('persona history rule checks passed');
