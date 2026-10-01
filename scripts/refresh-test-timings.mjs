// Refresh qa/test-timings.json, the duration baseline that drives
// time-balanced test sharding. Runs the full manifest once, merges only the
// successful suite timings, and rewrites the baseline sorted by suite path.
// Run locally or from a scheduled workflow after dependency or test changes.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const RAW = path.resolve('qa', '.test-timings-raw.json');
const BASELINE = path.resolve('qa', 'test-timings.json');

function main() {
  const run = spawnSync(process.execPath, ['scripts/run-test-manifest.mjs', '--group=full', `--timings=${RAW}`], { stdio: 'inherit' });
  if (run.status !== 0) {
    process.exitCode = run.status ?? 1;
    return;
  }
  const raw = JSON.parse(readFileSync(RAW, 'utf8'));
  const previous = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { suites: {} };
  const merged = { ...(previous.suites || {}) };
  for (const result of raw.results || []) {
    if (result.status === 0) merged[result.suite] = Math.round(result.elapsedMs);
  }
  writeFileSync(BASELINE, `${JSON.stringify({ generatedAt: new Date().toISOString(), suites: Object.fromEntries(Object.entries(merged).sort()) }, null, 2)}\n`);
  unlinkSync(RAW);
  console.log(`qa/test-timings.json refreshed with ${raw.results.length} suite timings`);
}

main();
