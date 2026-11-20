// Node baseline for the Rust experiment. Mirrors the campaign loop in
// server/bot-simulation.test.js exactly (seed = index*1009+7, 3 no-ai seats,
// $1500 start, 2000-step cap) and records per-game results + wall time.
//
// Usage: node bench/baseline/campaign-baseline.mjs [count=60] [startIndex=1] [outDir=bench/baseline]
// Writes: <outDir>/node-baseline.json (timings + env) and <outDir>/node-results.json (per-seed parity data).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { DeterministicAdvisor } from '../../server/botAdvisor.js';
import { createBotPolicy, simulateBotMatch } from '../../server/bot-policy-tournament.js';

const count = Math.max(1, Math.floor(Number(process.argv[2]) || 60));
const startIndex = Math.max(1, Math.floor(Number(process.argv[3]) || 1));
const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[4] || root);
const STEP_LIMIT = 2_000;
const STARTING_CASH = 1_500;

const results = [];
const perGameMs = [];
const t0 = performance.now();
for (let index = startIndex; index < startIndex + count; index += 1) {
  const policyBySeat = Array.from({ length: 3 }, (_, seat) => createBotPolicy(`safety-no-ai-${seat}`, {
    brain: 'no-ai',
    advisor: new DeterministicAdvisor()
  }));
  const g0 = performance.now();
  const result = await simulateBotMatch({
    seed: index * 1009 + 7,
    policyBySeat,
    settings: { startingCash: STARTING_CASH },
    stepLimit: STEP_LIMIT,
    captureTrace: false
  });
  perGameMs.push(performance.now() - g0);
  results.push({
    index,
    seed: index * 1009 + 7,
    steps: result.steps,
    ended: Boolean(result.ended),
    stalls: result.stalls,
    netWorthByPolicy: result.netWorthByPolicy
  });
}
const totalMs = performance.now() - t0;

const sorted = [...perGameMs].sort((a, b) => a - b);
const pct = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const totalSteps = results.reduce((sum, r) => sum + r.steps, 0);
const summary = {
  runtime: `node ${process.version}`,
  cpu: os.cpus()[0]?.model,
  platform: `${os.platform()} ${os.arch()}`,
  games: count,
  startIndex,
  stepLimit: STEP_LIMIT,
  startingCash: STARTING_CASH,
  totalMs: Math.round(totalMs),
  gamesPerSec: Number((count / (totalMs / 1000)).toFixed(3)),
  stepsPerSec: Math.round(totalSteps / (totalMs / 1000)),
  totalSteps,
  perGameMs: { p50: Math.round(pct(0.5)), p95: Math.round(pct(0.95)), max: Math.round(sorted.at(-1)) },
  ended: results.filter(r => r.ended).length,
  stalls: results.reduce((sum, r) => sum + r.stalls, 0)
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'node-baseline.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'node-results.json'), `${JSON.stringify(results)}\n`);
console.log(JSON.stringify(summary, null, 2));
