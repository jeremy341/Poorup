// CI shard-timing report. Reads the per-shard timing JSON artifacts uploaded
// by the server-tests job, prints the slowest suites and the shard skew to
// the run summary, and warns when real CI skew grows past the balancing
// threshold enforced by scripts/test-manifest.test.mjs.

import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SKEW_WARNING = 1.5;

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

function readShardResults(file) {
  try {
    const document = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(document.results)) return [];
    return document.results;
  } catch {
    return [];
  }
}

function main() {
  const root = process.argv[2] || '.test-timings';
  const files = collectTimingFiles(root);
  if (!files.length) {
    console.log('::warning::No shard timing artifacts found; nothing to report.');
    return;
  }
  const perShard = files.map(file => ({ file, results: readShardResults(file) })).filter(shard => shard.results.length);
  const all = new Map();
  for (const shard of perShard) {
    for (const result of shard.results) all.set(result.suite, result.elapsedMs);
  }
  const loads = perShard.map(shard => shard.results.reduce((sum, result) => sum + (result.elapsedMs || 0), 0));
  const skew = Math.min(...loads) > 0 ? Math.max(...loads) / Math.min(...loads) : 0;
  const slowest = [...all.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const lines = [];
  lines.push('### Shard timing report');
  lines.push('');
  for (let index = 0; index < perShard.length; index += 1) {
    lines.push(`- shard ${index + 1}: ${(loads[index] / 1000).toFixed(1)}s across ${perShard[index].results.length} suites`);
  }
  lines.push(`- shard skew (max/min shard duration): **${skew.toFixed(2)}×**`);
  lines.push('');
  lines.push('| Suite | Duration |');
  lines.push('|---|---|');
  for (const [suite, milliseconds] of slowest) {
    lines.push(`| ${suite} | ${(milliseconds / 1000).toFixed(1)}s |`);
  }
  if (skew > SKEW_WARNING) {
    console.log(`::warning::Real CI shard skew is ${skew.toFixed(2)}x (threshold ${SKEW_WARNING}). Refresh qa/test-timings.json with \`npm run timings:refresh\` and rebalance.`);
  }
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) appendFileSync(summaryPath, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

main();
