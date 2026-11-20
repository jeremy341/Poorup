// Bot brain and difficulty names: normalisation of the room settings and the per-difficulty advisor tuning.
const BOT_BRAINS = new Set(['ai', 'no-ai']);
const BOT_DIFFICULTIES = new Set(['house', 'table', 'expert']);

// Every level enumerates the dice exactly (rolloutBudget 0): a 16 or 64 sample was
// noisier than the exact tree at the same cost (measured both). Difficulty
// is the search depth (planningHorizon) and the strategic auction valuation.
export const DIFFICULTY_CONFIG = {
  house: { confidence: 0.45, rolloutBudget: 0 },
  table: { confidence: 0.55, rolloutBudget: 0 },
  expert: { confidence: 0.7, rolloutBudget: 0 }
};

export function normalizeBrain(value) {
  const brain = String(value || 'auto').trim().toLowerCase().replace('_', '-');
  if (brain === 'auto' || brain === 'all') return 'ai';
  return BOT_BRAINS.has(brain) ? brain : 'ai';
}

export function normalizeDifficulty(value) {
  const difficulty = String(value || 'table').trim().toLowerCase();
  return BOT_DIFFICULTIES.has(difficulty) ? difficulty : 'table';
}
