import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  analyticsRollup: 'analytics-rollup.json',
  aiProviders: 'ai-providers.json'
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

// Retired stores stay addressable for account export/deletion and backups.
// Resolving a path is inert: RetiredAccountStore only opens existing files
// when an explicit account-rights operation is requested.
export function resolveRetiredStorePaths(env = process.env) {
  const root = typeof env?.POORUP_DATA_DIR === 'string' ? env.POORUP_DATA_DIR.trim() : '';
  return {
    seasons: root ? path.join(root, 'seasons.json') : path.join(__dirname, 'data', 'seasons.json'),
    cosmetics: root ? path.join(root, 'cosmetics.json') : path.join(__dirname, 'data', 'cosmetics.json'),
  };
}
