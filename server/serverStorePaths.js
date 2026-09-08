import path from 'node:path';

const STORE_FILES = {
  accounts: 'accounts.json',
  social: 'social.json',
  matches: 'matches.json',
  achievements: 'achievements.json'
};

export function resolveStorePaths(env = process.env) {
  const root = typeof env?.POORUP_DATA_DIR === 'string' ? env.POORUP_DATA_DIR.trim() : '';
  return Object.fromEntries(Object.entries(STORE_FILES).map(([key, file]) => [key, root ? path.join(root, file) : undefined]));
}
