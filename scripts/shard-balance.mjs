// Time-balanced test sharding. Suites are packed by recorded wall-clock
// duration (longest first into the currently least-loaded shard) so parallel
// CI shards finish together instead of waiting on one overloaded round-robin
// bucket. The baseline lives at qa/test-timings.json; refresh it with
// `npm run timings:refresh`. Unknown suites fall back to DEFAULT_SUITE_MS and
// every assignment stays deterministic.

import { readFileSync } from 'node:fs';

export const TIMINGS_BASELINE_PATH = 'qa/test-timings.json';
export const DEFAULT_SUITE_MS = 5000;

// The bot-policy smoke suite is the one oversized suite in the manifest. The
// runner splits its fixed game window across shards (see
// scripts/run-test-manifest.mjs), so its balancing estimate scales with the
// per-shard share instead of pretending one shard pays the whole cost.
export const BOT_SIMULATION_SUITE = 'server/bot-simulation.test.js';
export const BOT_SIMULATION_TOTAL_GAMES = 10;

export function estimatedDuration(suite, timings, shardCount = 1) {
  const full = suiteDuration(suite, timings);
  if (suite === BOT_SIMULATION_SUITE && shardCount > 1) {
    const perShard = Math.ceil(BOT_SIMULATION_TOTAL_GAMES / shardCount);
    return full * perShard / BOT_SIMULATION_TOTAL_GAMES;
  }
  return full;
}

function parseBaselineDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
  const suites = document.suites;
  if (!suites || typeof suites !== 'object' || Array.isArray(suites)) return null;
  const timings = {};
  for (const [suite, milliseconds] of Object.entries(suites)) {
    const duration = Number(milliseconds);
    if (Number.isFinite(duration) && duration >= 0) timings[suite] = duration;
  }
  return timings;
}

export function parseTimings(text) {
  try {
    return parseBaselineDocument(JSON.parse(text));
  } catch {
    return null;
  }
}

export function loadTimings(filePath) {
  if (!filePath || !readFileSyncSafe(filePath)) return null;
  const text = readFileSyncSafe(filePath);
  return parseTimings(text);
}

function readFileSyncSafe(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function suiteDuration(suite, timings) {
  const recorded = timings?.[suite];
  if (Number.isFinite(recorded)) return recorded;
  return DEFAULT_SUITE_MS;
}

export function shardLoads(shards, timings, shardCount = 1) {
  return shards.map(shard => shard.reduce((sum, suite) => sum + estimatedDuration(suite, timings, shardCount), 0));
}

// Longest-processing-time packing. Ties break by manifest order and the
// lowest shard index, so the split is a pure function of (suites, timings).
export function balanceShards(suites, timings, shardCount) {
  if (!Number.isInteger(shardCount)) throw new Error('Shard count must be a positive integer.');
  if (shardCount < 1) throw new Error('Shard count must be a positive integer.');
  const ordered = suites
    .map((suite, index) => ({ suite, index, duration: estimatedDuration(suite, timings, shardCount) }))
    .sort((a, b) => b.duration - a.duration || a.index - b.index);
  const shards = Array.from({ length: shardCount }, () => []);
  const loads = Array.from({ length: shardCount }, () => 0);
  for (const entry of ordered) {
    let target = 0;
    for (let index = 1; index < shardCount; index += 1) {
      if (loads[index] < loads[target]) target = index;
    }
    shards[target].push(entry);
    loads[target] += entry.duration;
  }
  return shards.map(shard => shard
    .sort((a, b) => a.index - b.index)
    .map(entry => entry.suite));
}
