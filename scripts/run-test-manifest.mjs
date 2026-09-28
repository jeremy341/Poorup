import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { shardedTestSuites, testSuites } from './test-manifest.mjs';

function optionValue(args, name, fallback = null) {
  const prefix = `--${name}=`;
  const exactIndex = args.findIndex(value => value === `--${name}`);
  if (exactIndex >= 0) return args[exactIndex + 1] || fallback;
  const option = args.find(value => value.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

function shardParts(value) {
  if (!value) return null;
  const [index, count] = value.split('/').map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || count < 1 || index > count) {
    throw new Error(`Invalid shard "${value}"; expected INDEX/COUNT such as 2/4.`);
  }
  return { index, count };
}

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

function main() {
  const args = process.argv.slice(2);
  const group = optionValue(args, 'group', 'full');
  const singleSuite = optionValue(args, 'suite');
  const shard = shardParts(optionValue(args, 'shard'));
  const allSuites = testSuites(group);
  if (singleSuite && !testSuites('full').includes(singleSuite)) throw new Error(`Unknown test suite: ${singleSuite}`);
  if (singleSuite && shard) throw new Error('Choose either --suite or --shard, not both.');
  const selectedSuites = singleSuite
    ? [singleSuite]
    : shard ? shardedTestSuites(allSuites, shard.index, shard.count) : allSuites;
  console.log(`Test manifest: ${group} · ${selectedSuites.length}/${allSuites.length} suites${shard ? ` · shard ${shard.index}/${shard.count}` : ''}`);
  const results = selectedSuites.map(runSuite);
  writeTimings(optionValue(args, 'timings', process.env.POORUP_TEST_TIMING_FILE), results, shard);
  const failures = results.filter(result => result.status !== 0);
  const duration = results.reduce((sum, result) => sum + result.elapsedMs, 0);
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
