import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { BOT_SIMULATION_SUITE, BOT_SIMULATION_TOTAL_GAMES, TIMINGS_BASELINE_PATH, loadTimings } from './shard-balance.mjs';
import { testSuites, timeShardedTestSuites } from './test-manifest.mjs';
import { parseRunnerOptions } from './test-runner-options.mjs';

// One hung suite must fail in minutes, not eat the whole shard budget.
const SUITE_TIMEOUT_MS = Number(process.env.POORUP_SUITE_TIMEOUT_MS) > 0
  ? Number(process.env.POORUP_SUITE_TIMEOUT_MS)
  : 300_000;

// Suites are independent processes (they isolate their stores and bind
// distinct ports), so they can run concurrently. Parallelism is opt-in via
// POORUP_TEST_PARALLELISM; the default of 1 keeps the sequential, live-
// output behavior. PORT is assigned per slot in parallel mode so the real
// server never collides.
const PARALLELISM = Math.max(1, Math.floor(Number(process.env.POORUP_TEST_PARALLELISM) || 1));

// The smoke suite is split across shards so no single shard pays for all 10
// games. Seeds derive from a linear index (index * 1009 + 7), so contiguous
// per-shard windows partition the exact same coverage deterministically.
function simulationWindow(shard) {
  const requested = Number(process.env.POORUP_BOT_SIMULATION_COUNT);
  const total = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : BOT_SIMULATION_TOTAL_GAMES;
  if (!shard || shard.count <= 1) return { count: total, start: 1 };
  const perShard = Math.ceil(total / shard.count);
  return { count: perShard, start: (shard.index - 1) * perShard + 1 };
}

function suiteEnvironment(suite, shard) {
  const environment = { ...process.env };
  if (suite === BOT_SIMULATION_SUITE) {
    const window = simulationWindow(shard);
    environment.POORUP_BOT_SIMULATION_COUNT = String(window.count);
    environment.POORUP_BOT_SIMULATION_START_INDEX = String(window.start);
  }
  return environment;
}

function runSuite(suite, shard) {
  const absolutePath = path.resolve(process.cwd(), suite);
  if (!existsSync(absolutePath)) return { suite, status: 1, elapsedMs: 0, error: 'Test file does not exist.' };
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [absolutePath], {
    stdio: 'inherit',
    env: suiteEnvironment(suite, shard),
    timeout: SUITE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const elapsedMs = Date.now() - startedAt;
  if (result.error?.code === 'ETIMEDOUT') {
    return { suite, status: 1, elapsedMs, error: `Test exceeded the ${Math.round(SUITE_TIMEOUT_MS / 1000)}s suite timeout.` };
  }
  if (result.error) return { suite, status: 1, elapsedMs, error: result.error.message };
  return { suite, status: result.status ?? 1, elapsedMs, signal: result.signal || null };
}

function runSuiteParallel(suite, shard, slot) {
  return new Promise((resolve) => {
    const absolutePath = path.resolve(process.cwd(), suite);
    if (!existsSync(absolutePath)) {
      resolve({ suite, status: 1, elapsedMs: 0, error: 'Test file does not exist.' });
      return;
    }
    const startedAt = Date.now();
    const env = suiteEnvironment(suite, shard);
    env.PORT = String(8100 + slot);
    const child = spawn(process.execPath, [absolutePath], { env });
    let output = '';
    const capture = (chunk) => {
      output += chunk;
      if (output.length > 8192) output = output.slice(-8192);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const timer = setTimeout(() => child.kill('SIGKILL'), SUITE_TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - startedAt;
      console.log(`  finished ${suite} · ${Math.round(elapsedMs / 100) / 10}s`);
      if (code === 0) {
        resolve({ suite, status: 0, elapsedMs });
        return;
      }
      const error = signal === 'SIGKILL'
        ? `Test exceeded the ${Math.round(SUITE_TIMEOUT_MS / 1000)}s suite timeout.`
        : (code === null ? `exited via signal ${signal}` : `exit ${code}`);
      console.error(`FAILED ${suite}: ${error}\n${output}`);
      resolve({ suite, status: code === null ? 1 : code, elapsedMs, error, signal: signal || null });
    });
  });
}

async function runSelected(selected, shard, parallelism) {
  if (parallelism <= 1 || selected.length < 2) return selected.map(suite => runSuite(suite, shard));
  const results = new Array(selected.length);
  let cursor = 0;
  let done = 0;
  await new Promise((allDone) => {
    function launch() {
      while (cursor < selected.length && cursor - done < parallelism) {
        const index = cursor;
        cursor += 1;
        runSuiteParallel(selected[index], shard, index % parallelism).then((result) => {
          results[index] = result;
          done += 1;
          launch();
          if (done === selected.length) allDone();
        });
      }
    }
    launch();
  });
  return results;
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

function selectedSuites(singleSuite, shard, allSuites, knownSuites, timings) {
  if (isUnknownSuite(singleSuite, knownSuites)) throw new Error(`Unknown test suite: ${singleSuite}`);
  if (hasConflictingSelection(singleSuite, shard)) throw new Error('Choose either --suite or --shard, not both.');
  if (singleSuite) return [singleSuite];
  if (shard) return timeShardedTestSuites(allSuites, shard.index, shard.count, timings);
  return allSuites;
}

function summarizeResults(results) {
  const failures = results.filter(result => result.status !== 0);
  const duration = results.reduce((sum, result) => sum + result.elapsedMs, 0);
  return { failures, duration };
}

async function main() {
  const args = process.argv.slice(2);
  const { group, singleSuite, shard, timings } = parseRunnerOptions(args, process.env.POORUP_TEST_TIMING_FILE);
  const allSuites = testSuites(group);
  const timingsBaseline = shard && !singleSuite ? loadTimings(TIMINGS_BASELINE_PATH) : null;
  const selected = selectedSuites(singleSuite, shard, allSuites, testSuites('full'), timingsBaseline);
  console.log(`Test manifest: ${group} · ${selected.length}/${allSuites.length} suites${shard ? ` · shard ${shard.index}/${shard.count}${timingsBaseline ? ' (time-balanced)' : ' (count-balanced)'}` : ''}${PARALLELISM > 1 ? ` · parallelism ${PARALLELISM}` : ''}`);
  const results = await runSelected(selected, shard, PARALLELISM);
  writeTimings(timings, results, shard);
  const { failures, duration } = summarizeResults(results);
  console.log(`Test manifest result: ${results.length - failures.length}/${results.length} passed · ${Math.round(duration / 1000)}s summed suite time`);
  if (failures.length) {
    failures.forEach(result => console.error(`FAILED ${result.suite}: ${result.error || result.signal || `exit ${result.status}`}`));
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
