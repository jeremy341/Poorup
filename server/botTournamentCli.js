import { BOT_ADVISOR_PROMPT_VERSION } from './botAdvisor.js';
import { createDefaultPolicySet } from './botTournamentPolicies.js';
import { MAX_SIMULATION_SEED } from './botTournamentSimulation.js';

function boundedInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function validateLiveCallCap(live, maxCalls) {
  if (!live) return;
  if (Number.isInteger(maxCalls) && maxCalls > 0) return;
  throw new Error('Live AI requires POORUP_BOT_LIVE_AI_MAX_CALLS to be a positive integer.');
}

function validateLiveApiKey(live, env) {
  if (!live) return;
  if (env.POORUP_AI_API_KEY || env.DEEPSEEK_API_KEY) return;
  throw new Error('Live AI requires POORUP_AI_API_KEY or DEEPSEEK_API_KEY.');
}

function liveProviderSettings(env) {
  const live = env.POORUP_BOT_LIVE_AI === '1';
  const maxCalls = Number(env.POORUP_BOT_LIVE_AI_MAX_CALLS);
  validateLiveCallCap(live, maxCalls);
  validateLiveApiKey(live, env);
  return { live, maxCalls };
}

// Number('') is 0, so blank entries are dropped before parsing; a malformed
// entry fails loudly rather than silently shrinking the seed list.
function explicitSeeds(value) {
  const entries = String(value || '').split(',').map(entry => entry.trim()).filter(Boolean);
  const seeds = entries.map(Number);
  if (!seeds.every(Number.isSafeInteger)) throw new Error('POORUP_BOT_EVAL_SEEDS must be a comma-separated list of safe integers.');
  // The simulator seeds a 32-bit PRNG: a seed outside the unsigned 32-bit
  // range would be truncated into a different seed's stream.
  if (!seeds.every(seed => seed >= 0 && seed <= MAX_SIMULATION_SEED)) {
    throw new Error(`POORUP_BOT_EVAL_SEEDS must be a comma-separated list of unsigned 32-bit seeds (0-${MAX_SIMULATION_SEED}).`);
  }
  return seeds;
}

// An explicit list is used whole. It is not cut to POORUP_BOT_EVAL_COUNT
// (default 1), so POORUP_BOT_EVAL_SEEDS=1,2,3 silently ran only seed 1.
function seedsForRun(env, count) {
  const explicit = explicitSeeds(env.POORUP_BOT_EVAL_SEEDS);
  return explicit.length ? explicit : Array.from({ length: count }, (_, index) => index + 1);
}

function combinationsStartingAt(policies, firstIndex) {
  const first = policies[firstIndex];
  return policies.slice(firstIndex + 1).flatMap((second, offset) => {
    const secondIndex = firstIndex + 1 + offset;
    return policies.slice(secondIndex + 1).map(third => [first, second, third]);
  });
}

function policyTriples(policies) {
  return policies.flatMap((_policy, firstIndex) => combinationsStartingAt(policies, firstIndex));
}

function displayModel(env) {
  return env.POORUP_AI_MODEL || env.DEEPSEEK_MODEL || 'deepseek-v4-flash (stub)';
}

// Stub providers are rebuilt for every match, so their call total is the sum of
// the per-match counts rather than a counter on one long-lived advisor.
function stubProviderCalls(report) {
  return report?.strategyMetricsByPolicy?.['ai-stub']?.providerCalls ?? 0;
}

function campaignResult({ env, live, maxCalls, tracker, seeds, stepLimit, report }) {
  return {
    model: displayModel(env),
    promptVersion: BOT_ADVISOR_PROMPT_VERSION,
    liveAi: live,
    liveCallCap: live ? maxCalls : 0,
    actualCalls: live ? tracker.calls : stubProviderCalls(report),
    seeds,
    stepLimit: stepLimit ?? report?.matches?.[0]?.stepLimit ?? null,
    ...report,
  };
}

export async function runTournamentCli({ runBotTournament, createCappedFetch, env = process.env, write = value => console.log(value) }) {
  const { live, maxCalls } = liveProviderSettings(env);
  const tracker = live ? createCappedFetch({ maxCalls, fetchImpl: globalThis.fetch }) : null;
  // The advisor must read the environment the CLI validated, not process.env.
  const policies = createDefaultPolicySet({ fetchImpl: tracker?.fetchImpl, env });
  const count = boundedInteger(env.POORUP_BOT_EVAL_COUNT, 1, 100);
  // Unset means "scale with the round limit" (defaultStepLimit in the simulation).
  const stepLimit = env.POORUP_BOT_EVAL_STEP_LIMIT ? boundedInteger(env.POORUP_BOT_EVAL_STEP_LIMIT, undefined, 1_000_000) : undefined;
  const seeds = seedsForRun(env, count);
  const policySets = policyTriples(policies);
  const report = await runBotTournament({ seeds, policySets, seatRotations: [0, 1, 2], stepLimit, callCapTracker: tracker });
  write(JSON.stringify(campaignResult({ env, live, maxCalls, tracker, seeds, stepLimit, report }), null, 2));
}
