// Rebuild qa/test-timings.json from real CI timing artifacts. CI runners
// time suites differently than local machines (bot-simulation runs ~2x
// slower), so the shard-balancing baseline should be built from CI data.
//
// Usage:
//   gh run download <run-id> --repo jeremy341/Poorup --dir .ci-timings --name "test-timings-shard-*"
//   node scripts/import-ci-timings.mjs .ci-timings
//
// Values merge with max(existing, imported) per suite: conservative for
// balancing, and stable across split/unsplit bot-simulation runs.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { TIMINGS_BASELINE_PATH, parseTimings } from './shard-balance.mjs';

function collectTimingFiles(root, files = []) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry);
    if (statSync(fullPath).isDirectory()) collectTimingFiles(fullPath, files);
    else if (entry.endsWith('.json')) files.push(fullPath);
  }
  return files;
}

function mergeSuites(suites, files) {
  let imported = 0;
  for (const file of files) {
    let document;
    try {
      document = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const result of document.results || []) {
      if (result.status !== 0) continue;
      const milliseconds = Math.round(Number(result.elapsedMs) || 0);
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) continue;
      const previous = Number(suites[result.suite]) || 0;
      if (milliseconds > previous) suites[result.suite] = milliseconds;
      imported += 1;
    }
  }
  return imported;
}

function main() {
  const root = process.argv[2] || '.ci-timings';
  const files = collectTimingFiles(root);
  const baselineText = readFileSyncSafe(TIMINGS_BASELINE_PATH);
  const baseline = baselineText ? parseTimings(baselineText) : null;
  // parseTimings yields a flat suite->ms map; merge conservatively and never
  // let a bad run shrink the baseline.
  const suites = { ...(baseline || {}) };
  const baselineCount = Object.keys(suites).length;
  const imported = mergeSuites(suites, files);
  if (!imported) {
    console.error(`No usable suite timings found under ${root}`);
    process.exitCode = 1;
    return;
  }
  if (Object.keys(suites).length < baselineCount) {
    console.error(`Import would shrink the baseline (${baselineCount} -> ${Object.keys(suites).length}); refusing to write.`);
    process.exitCode = 1;
    return;
  }
  writeBaseline(suites);
  console.log(`qa/test-timings.json imported ${imported} suite timings from ${files.length} artifact file(s); baseline now covers ${Object.keys(suites).length} suites`);
}

function writeBaseline(suites) {
  writeFileSync(TIMINGS_BASELINE_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), suites: Object.fromEntries(Object.entries(suites).sort()) }, null, 2)}\n`);
}

function readFileSyncSafe(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

main();
