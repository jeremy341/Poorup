// Records differential-test fixtures from the real, seeded Node simulation.
//
// Usage: node bench/fixtures/capture.mjs [seeds=5] [perSeedCap=3] [startIndex=1]
// Output: bench/fixtures/<sourceModule>/<function>.jsonl.gz (gzip of JSONL)
//   one JSON object per line: { fn, module, args, argsAfter?, result } or { fn, module, args, error }
//   `args` is the call arguments BEFORE the call, `argsAfter` (only when different) AFTER it, so
//   mutating functions can be verified too. Maps/Sets become {"__map":[[k,v]...]} / {"__set":[...]},
//   NaN/Infinity become {"__num":"NaN"|"Infinity"|"-Infinity"}, cycles become "[Circular]",
//   functions are dropped, and values deeper than 14 levels become "[Depth]".
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../../server');
const seeds = Math.max(1, Math.floor(Number(process.argv[2]) || 5));
const perSeedCap = Math.max(1, Math.floor(Number(process.argv[3]) || 3));
const startIndex = Math.max(1, Math.floor(Number(process.argv[4]) || 1));
const MAX_RECORD_BYTES = 300_000;

export const TAP_MODULES = [
  // rulescore: data and rules
  'gameData', 'boardRegistry', 'financeRules', 'rentShareRules', 'propertyRules', 'roomSettings',
  'rulesetRegistry', 'globalEventData', 'gamePlacement', 'marketLogic', 'marketExpansion',
  'contractLogic', 'gameContracts', 'loanLogic', 'bankruptcyLogic', 'collateralSettlement',
  'sponsorshipLogic', 'netWorth',
  // botpolicy
  'botRentForecast', 'botDevelopmentForecast', 'botTradeValuation', 'botTableBrain', 'botTableMind',
  'publicActionHistory', 'botAuctionPolicy', 'botContractPolicy', 'botMarketForecast', 'botMarketPositions',
  'botCandidates', 'botMarketCandidates', 'botStrategicContext', 'botAdvisor', 'botFuturePlanner',
  'botPersonas', 'botTiming',
  // simharness
  'botTournamentState', 'botTournamentResults', 'botTournamentSummary', 'balanceMetrics'
];

function serialize(value, seen = new WeakSet(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { __num: 'NaN' };
    if (value === Infinity) return { __num: 'Infinity' };
    if (value === -Infinity) return { __num: '-Infinity' };
    return value;
  }
  if (typeof value === 'bigint') return { __bigint: value.toString() };
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (depth > 14) return '[Depth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    out = value.map(item => {
      const s = serialize(item, seen, depth + 1);
      return s === undefined ? null : s;
    });
  } else if (value instanceof Map) {
    out = { __map: [...value.entries()].map(([k, v]) => [serialize(k, seen, depth + 1), serialize(v, seen, depth + 1) ?? null]) };
  } else if (value instanceof Set) {
    out = { __set: [...value].map(v => serialize(v, seen, depth + 1) ?? null) };
  } else if (value instanceof Date) {
    out = { __date: value.toISOString() };
  } else {
    out = {};
    for (const key of Object.keys(value)) {
      let item;
      try { item = value[key]; } catch { continue; }
      const s = serialize(item, seen, depth + 1);
      if (s !== undefined) out[key] = s;
    }
  }
  seen.delete(value);
  return out;
}

const records = new Map(); // "module/fn" -> string[] lines
let seedCounts = new Map();
let busy = false;

globalThis.__poorupTap = (fn, mod, name) => {
  if (typeof fn !== 'function' || fn.constructor?.name === 'AsyncFunction' || fn.constructor?.name === 'AsyncGeneratorFunction') return fn;
  const key = `${mod}/${name}`;
  return function tapped(...args) {
    if (busy) return fn.apply(this, args);
    const count = (seedCounts.get(key) || 0) + 1;
    seedCounts.set(key, count);
    const recorded = (records.get(key) || []).length;
    const sampled = count <= 2 || count % 97 === 0;
    if (!sampled || recorded >= perSeedCap * seeds) return fn.apply(this, args);
    busy = true;
    let pre;
    try { pre = JSON.stringify(serialize(args)); } catch { pre = null; } finally { busy = false; }
    if (pre === null || pre.length > MAX_RECORD_BYTES) return fn.apply(this, args);
    let result;
    let thrown = null;
    try { result = fn.apply(this, args); } catch (error) { thrown = error; }
    if (!thrown && result && typeof result.then === 'function') return result; // async result: skip recording
    busy = true;
    try {
      const entry = { fn: name, module: mod, args: JSON.parse(pre) };
      if (thrown) entry.error = String(thrown?.message ?? thrown);
      else {
        entry.result = serialize(result);
        const post = JSON.stringify(serialize(args));
        if (post !== pre) entry.argsAfter = JSON.parse(post);
      }
      const line = JSON.stringify(entry);
      if (line.length <= MAX_RECORD_BYTES * 2) {
        if (!records.has(key)) records.set(key, []);
        records.get(key).push(line);
      }
    } catch { /* unserializable: skip */ } finally { busy = false; }
    if (thrown) throw thrown;
    return result;
  };
};

process.env.POORUP_TAP_MODULES = JSON.stringify(TAP_MODULES);
register(pathToFileURL(path.join(here, 'tap-hooks.mjs')));

const { DeterministicAdvisor } = await import(pathToFileURL(path.join(serverDir, 'botAdvisor.js')));
const { createBotPolicy, simulateBotMatch } = await import(pathToFileURL(path.join(serverDir, 'bot-policy-tournament.js')));

for (let index = startIndex; index < startIndex + seeds; index += 1) {
  seedCounts = new Map();
  const policyBySeat = Array.from({ length: 3 }, (_, seat) => createBotPolicy(`safety-no-ai-${seat}`, {
    brain: 'no-ai',
    advisor: new DeterministicAdvisor()
  }));
  await simulateBotMatch({ seed: index * 1009 + 7, policyBySeat, settings: { startingCash: 1_500 }, stepLimit: 2_000, captureTrace: false });
}

let files = 0;
let bytes = 0;
const summary = [];
for (const [key, lines] of records) {
  const [mod, name] = key.split('/');
  const dir = path.join(here, mod);
  fs.mkdirSync(dir, { recursive: true });
  const body = `${lines.join('\n')}\n`;
  const gz = zlib.gzipSync(body, { level: 9 });
  fs.writeFileSync(path.join(dir, `${name}.jsonl.gz`), gz);
  files += 1;
  bytes += gz.length;
  summary.push(`${key}: ${lines.length}`);
}
fs.writeFileSync(path.join(here, 'INDEX.txt'), `${summary.sort().join('\n')}\n`);
console.log(`captured ${files} functions, ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
