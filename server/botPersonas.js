// Named computer players. Each persona belongs to one difficulty, so the name tells the host how hard that seat plays.
// Personas are not accounts: they have no profile, friends or rankings, only the record kept by botPersonaStore.
export const BOT_PERSONAS = Object.freeze([
  Object.freeze({ id: 'dice-goblin', name: 'Dice Goblin', difficulty: 'house' }),
  Object.freeze({ id: 'mossy-roll', name: 'Mossy Roll', difficulty: 'house' }),
  Object.freeze({ id: 'penny-arcade', name: 'Penny Arcade', difficulty: 'house' }),
  Object.freeze({ id: 'coin-flip', name: 'Coin Flip', difficulty: 'house' }),
  Object.freeze({ id: 'chance-sprite', name: 'Chance Sprite', difficulty: 'house' }),
  Object.freeze({ id: 'lady-luck', name: 'Lady Luck', difficulty: 'table' }),
  Object.freeze({ id: 'bailiff-bob', name: 'Bailiff Bob', difficulty: 'table' }),
  Object.freeze({ id: 'tax-goblin', name: 'Tax Goblin', difficulty: 'table' }),
  Object.freeze({ id: 'brass-ledger', name: 'Brass Ledger', difficulty: 'table' }),
  Object.freeze({ id: 'market-moth', name: 'Market Moth', difficulty: 'table' }),
  Object.freeze({ id: 'rent-reaper', name: 'Rent Reaper', difficulty: 'expert' }),
  Object.freeze({ id: 'vault-dweller', name: 'Vault Dweller', difficulty: 'expert' }),
  Object.freeze({ id: 'silk-baron', name: 'Silk Baron', difficulty: 'expert' }),
  Object.freeze({ id: 'iron-auditor', name: 'Iron Auditor', difficulty: 'expert' }),
  Object.freeze({ id: 'night-banker', name: 'Night Banker', difficulty: 'expert' }),
]);

const DIFFICULTIES = ['house', 'table', 'expert'];

export function personasForDifficulty(difficulty) {
  const key = DIFFICULTIES.includes(difficulty) ? difficulty : 'table';
  return BOT_PERSONAS.filter(persona => persona.difficulty === key);
}

// The seat's persona comes from the room's difficulty. Five per difficulty keeps names unique for a full table.
export function personaForSeat(difficulty, seatIndex) {
  const pool = personasForDifficulty(difficulty);
  return pool[seatIndex % pool.length];
}
