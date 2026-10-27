import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { shardedTestSuites, testSuites, TEST_GROUPS, timeShardedTestSuites } from './test-manifest.mjs';
import { parseRunnerOptions, shardParts } from './test-runner-options.mjs';
import { parseTimings, shardLoads } from './shard-balance.mjs';

const SUITE_DIRS = ['server', 'public', 'scripts', path.join('qa', 'visual-capture')];
const SUITE_PATTERN = /\.test\.(?:js|mjs)$/;
const SELF = 'scripts/test-manifest.test.mjs';
// Discovered test files that no manifest group runs, each with its reason. A
// new entry needs a reason and must not also be listed in a group.
const UNREGISTERED_ALLOW_LIST = new Map([
  [SELF, 'this contract test is run directly by the CI lint job (.github/workflows/ci.yml), not by a group'],
]);

function discoverSuites() {
  const found = [];
  for (const dir of SUITE_DIRS) {
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      // `.superpowers/` holds gitignored snapshots of older suites. Copying a
      // neighbour from there is a live hazard, so they never count as suites.
      if (!entry.isFile() || !SUITE_PATTERN.test(entry.name)) continue;
      const relative = path.join(entry.parentPath ?? path.dirname(entry.path), entry.name).replaceAll('\\', '/');
      if (relative.split('/').includes('.superpowers')) continue;
      found.push(relative);
    }
  }
  return found.sort();
}

// Counts are derived, never pinned: the invariants are that the full list is
// unique, no group repeats a suite, and every listed path exists. Suites may
// appear in more than one group (cross-group repeats are expected).
const allSuites = testSuites('full');
assert.equal(new Set(allSuites).size, allSuites.length, 'the full manifest runs each suite only once');
const totalGroupRuns = Object.values(TEST_GROUPS).reduce((total, suites) => total + suites.length, 0);
for (const [name, suites] of Object.entries(TEST_GROUPS)) {
  assert.equal(new Set(suites).size, suites.length, `${name} does not repeat an individual suite`);
}
assert.ok(allSuites.includes('server/bot-simulation.test.js'));
assert.ok(allSuites.includes('server/auctionBotConcurrency.test.js'), 'the manifest includes the concurrent auction bot regression suite');
assert.ok(allSuites.every(suite => existsSync(suite)), 'every manifest suite resolves to a checked-in test file');

// The reverse direction. Without it, a new suite that is never registered in
// the manifest passes every CI tier on every branch and silently never runs.
const onDisk = discoverSuites().filter(suite => !UNREGISTERED_ALLOW_LIST.has(suite));
assert.deepEqual(
  onDisk,
  [...allSuites].sort(),
  'every checked-in test file under server, public, scripts and qa/visual-capture is registered in the manifest or allow-listed with a reason (add it to scripts/test-manifest.mjs)'
);
for (const [suite, reason] of UNREGISTERED_ALLOW_LIST) {
  assert.ok(existsSync(suite), `allow-listed ${suite} exists`);
  assert.ok(reason.length > 0, `allow-listed ${suite} states a reason`);
  assert.equal(allSuites.includes(suite), false, `${suite} is allow-listed and must not also be a manifest entry`);
}

const shards = [1, 2, 3, 4].map(index => shardedTestSuites(allSuites, index, 4));
const shardedSuites = shards.flat();
assert.equal(shardedSuites.length, allSuites.length, 'shards include every suite');
assert.equal(new Set(shardedSuites).size, allSuites.length, 'shards do not repeat suites');
assert.ok(Math.max(...shards.map(shard => shard.length)) - Math.min(...shards.map(shard => shard.length)) <= 1, 'round-robin sharding balances suite count');

// Time-balanced sharding must cover every suite once and finish within a
// tight ratio of each other; the checked-in baseline makes this deterministic
// and the runner's bot-simulation split is part of the estimate.
assert.ok(existsSync('qa/test-timings.json'), 'the shard-duration baseline is checked in');
const baseline = parseTimings(readFileSync('qa/test-timings.json', 'utf8'));
assert.ok(baseline, 'the shard-duration baseline parses');
assert.ok(allSuites.every(suite => Number.isFinite(baseline[suite])), 'the baseline covers every manifest suite');
for (const shardCount of [2, 4]) {
  const timeShards = Array.from({ length: shardCount }, (_v, index) => timeShardedTestSuites(allSuites, index + 1, shardCount, baseline));
  const flat = timeShards.flat();
  assert.equal(flat.length, allSuites.length, `time-balanced shards (${shardCount}) include every suite`);
  assert.equal(new Set(flat).size, allSuites.length, `time-balanced shards (${shardCount}) do not repeat suites`);
  const loads = shardLoads(timeShards, baseline, shardCount);
  assert.ok(Math.max(...loads) / Math.min(...loads) <= 1.6, `time-balanced shards (${shardCount}) finish within 60% of each other`);
}
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
  allowEmpty: false,
});
assert.equal(parseRunnerOptions(['--group=core', '--allow-empty']).allowEmpty, true);

// G12-07: a selection that runs nothing is a configuration error, not a pass.
// Shard 200/200 selects no suites from the 173-suite manifest.
const emptySelection = spawnSync(process.execPath, ['scripts/run-test-manifest.mjs', '--group=core', '--shard=200/200'], { encoding: 'utf8' });
assert.notEqual(emptySelection.status, 0, 'an empty shard selection fails instead of reporting success');
assert.match(emptySelection.stderr, /No suites selected/, 'the empty selection failure names the cause');
const allowedEmpty = spawnSync(process.execPath, ['scripts/run-test-manifest.mjs', '--group=core', '--shard=200/200', '--allow-empty'], { encoding: 'utf8' });
assert.equal(allowedEmpty.status, 0, 'an intentionally empty selection passes with --allow-empty');

console.log(`test manifest: ${totalGroupRuns} prior invocations → ${allSuites.length} unique suites, time-balanced shards (fallback round-robin)`);
