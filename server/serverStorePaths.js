import path from 'node:path';

const STORE_FILES = {
  accounts: 'accounts.json',
  social: 'social.json',
  matches: 'matches.json',
  achievements: 'achievements.json'
};

const AUXILIARY_STORE_FILES = {
  seasons: 'seasons.json',
  cosmetics: 'cosmetics.json',
  telemetry: 'telemetry.json',
  analyticsRollup: 'analytics-rollup.json'
};

export function resolveStorePaths(env = process.env) {
  const root = typeof env?.POORUP_DATA_DIR === 'string' ? env.POORUP_DATA_DIR.trim() : '';
  return Object.fromEntries(Object.entries(STORE_FILES).map(([key, file]) => [key, root ? path.join(root, file) : undefined]));
}

// Expansion stores are intentionally a separate opt-in projection so the
// legacy path contract remains stable for existing deployments and tests.
export function resolveAuxiliaryStorePaths(env = process.env) {
  const root = typeof env?.POORUP_DATA_DIR === 'string' ? env.POORUP_DATA_DIR.trim() : '';
  return Object.fromEntries(Object.entries(AUXILIARY_STORE_FILES).map(([key, file]) => [key, root ? path.join(root, file) : undefined]));
}
