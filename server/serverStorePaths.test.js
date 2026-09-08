import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveStorePaths } from './serverStorePaths.js';

const root = path.resolve('tmp', 'poorup-wire-data');
const paths = resolveStorePaths({ POORUP_DATA_DIR: `  ${root}  ` });

assert.deepEqual(paths, {
  accounts: path.join(root, 'accounts.json'),
  social: path.join(root, 'social.json'),
  matches: path.join(root, 'matches.json'),
  achievements: path.join(root, 'achievements.json')
});
assert.deepEqual(resolveStorePaths({}), { accounts: undefined, social: undefined, matches: undefined, achievements: undefined });
assert.deepEqual(resolveStorePaths({ POORUP_DATA_DIR: '   ' }), { accounts: undefined, social: undefined, matches: undefined, achievements: undefined });

console.log('server store paths: 3 passed, 0 failed');
