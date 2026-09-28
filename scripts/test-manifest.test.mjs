import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { shardedTestSuites, testSuites, TEST_GROUPS } from './test-manifest.mjs';
import { parseRunnerOptions, shardParts } from './test-runner-options.mjs';

const allSuites = testSuites('full');
assert.equal(new Set(allSuites).size, allSuites.length, 'the full manifest runs each suite only once');
assert.equal(allSuites.length, 150, 'the full manifest preserves all unique suites from the current script groups');
const totalGroupRuns = Object.values(TEST_GROUPS).reduce((total, suites) => total + suites.length, 0);
assert.equal(totalGroupRuns, 162, 'all pre-refactor script entries remain represented in named groups');
for (const [name, suites] of Object.entries(TEST_GROUPS)) {
  assert.equal(new Set(suites).size, suites.length, `${name} does not repeat an individual suite`);
}
assert.equal(totalGroupRuns - allSuites.length, 12, 'only the 12 previously duplicated invocations are deduplicated');
assert.ok(allSuites.includes('server/bot-simulation.test.js'));
assert.ok(allSuites.every(suite => existsSync(suite)), 'every manifest suite resolves to a checked-in test file');

const shards = [1, 2, 3, 4].map(index => shardedTestSuites(allSuites, index, 4));
const shardedSuites = shards.flat();
assert.equal(shardedSuites.length, allSuites.length, 'shards include every suite');
assert.equal(new Set(shardedSuites).size, allSuites.length, 'shards do not repeat suites');
assert.ok(Math.max(...shards.map(shard => shard.length)) - Math.min(...shards.map(shard => shard.length)) <= 1, 'round-robin sharding balances suite count');
assert.deepEqual(testSuites('core'), TEST_GROUPS.core, 'focused group commands retain their ordered test scope');
assert.throws(() => shardedTestSuites([], 1, 0), /Shard count must be a positive integer/);
assert.throws(() => shardedTestSuites([], 0, 4), /Shard index must be between/);
assert.throws(() => shardedTestSuites([], 5, 4), /Shard index must be between/);
assert.deepEqual(shardParts('2/4'), { index: 2, count: 4 });
assert.equal(shardParts(undefined), null);
assert.throws(() => shardParts('2/0'), /Invalid shard/);
assert.deepEqual(parseRunnerOptions(['--group', 'account', '--suite=server/accountExport.test.js']), {
  group: 'account',
  singleSuite: 'server/accountExport.test.js',
  shard: null,
  timings: null,
});

console.log(`test manifest: ${totalGroupRuns} prior invocations → ${allSuites.length} unique suites, four disjoint balanced shards`);
