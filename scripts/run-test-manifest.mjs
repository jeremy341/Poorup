import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { shardedTestSuites, testSuites } from './test-manifest.mjs';
import { parseRunnerOptions } from './test-runner-options.mjs';

function suiteEnvironment(suite) {
  const environment = { ...process.env };
  if (suite === 'server/bot-simulation.test.js' && !environment.POORUP_BOT_SIMULATION_COUNT) {
    environment.POORUP_BOT_SIMULATION_COUNT = '10';
  }
  return environment;
}

function runSuite(suite) {
  const absolutePath = path.resolve(process.cwd(), suite);
  if (!existsSync(absolutePath)) return { suite, status: 1, elapsedMs: 0, error: 'Test file does not exist.' };
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [absolutePath], { stdio: 'inherit', env: suiteEnvironment(suite) });
  const elapsedMs = Date.now() - startedAt;
  if (result.error) return { suite, status: 1, elapsedMs, error: result.error.message };
  return { suite, status: result.status ?? 1, elapsedMs, signal: result.signal || null };
}

function writeTimings(filePath, results, shard) {
  if (!filePath) return;
  const resolvedPath = path.resolve(process.cwd(), filePath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, JSON.stringify({ shard, generatedAt: new Date().toISOString(), results }, null, 2));
}

function isUnknownSuite(singleSuite, allSuites) {
  return Boolean(singleSuite) && !allSuites.includes(singleSuite);
}

function hasConflictingSelection(singleSuite, shard) {
  return Boolean(singleSuite) && Boolean(shard);
}

function selectedSuites(singleSuite, shard, allSuites, knownSuites) {
  if (isUnknownSuite(singleSuite, knownSuites)) throw new Error(`Unknown test suite: ${singleSuite}`);
  if (hasConflictingSelection(singleSuite, shard)) throw new Error('Choose either --suite or --shard, not both.');
  if (singleSuite) return [singleSuite];
  if (shard) return shardedTestSuites(allSuites, shard.index, shard.count);
  return allSuites;
}

function summarizeResults(results) {
  const failures = results.filter(result => result.status !== 0);
  const duration = results.reduce((sum, result) => sum + result.elapsedMs, 0);
  return { failures, duration };
}

function main() {
  const args = process.argv.slice(2);
  const { group, singleSuite, shard, timings } = parseRunnerOptions(args, process.env.POORUP_TEST_TIMING_FILE);
  const allSuites = testSuites(group);
  const selected = selectedSuites(singleSuite, shard, allSuites, testSuites('full'));
  console.log(`Test manifest: ${group} · ${selected.length}/${allSuites.length} suites${shard ? ` · shard ${shard.index}/${shard.count}` : ''}`);
  const results = selected.map(runSuite);
  writeTimings(timings, results, shard);
  const { failures, duration } = summarizeResults(results);
  console.log(`Test manifest result: ${results.length - failures.length}/${results.length} passed · ${Math.round(duration / 1000)}s summed suite time`);
  if (failures.length) {
    failures.forEach(result => console.error(`FAILED ${result.suite}: ${result.error || result.signal || `exit ${result.status}`}`));
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
