import { BOT_ADVISOR_PROMPT_VERSION } from './botAdvisor.js';
import { createDefaultPolicySet } from './botTournamentPolicies.js';

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

function seedsForRun(env, count) {
  const explicit = String(env.POORUP_BOT_EVAL_SEEDS || '')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(Number.isSafeInteger);
  return explicit.length ? explicit.slice(0, count) : Array.from({ length: count }, (_, index) => index + 1);
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

function campaignResult({ env, live, maxCalls, tracker, policies, seeds, stepLimit, report }) {
  const stubAdvisor = policies.find(policy => policy.policyId === 'ai-stub').advisor;
  return {
    model: displayModel(env),
    promptVersion: BOT_ADVISOR_PROMPT_VERSION,
    liveAi: live,
    liveCallCap: live ? maxCalls : 0,
    actualCalls: live ? tracker.calls : stubAdvisor.aiCalls,
    seeds,
    stepLimit,
    ...report,
  };
}

export async function runTournamentCli({ runBotTournament, createCappedFetch, env = process.env, write = value => console.log(value) }) {
  const { live, maxCalls } = liveProviderSettings(env);
  const tracker = live ? createCappedFetch({ maxCalls, fetchImpl: globalThis.fetch }) : null;
  const policies = createDefaultPolicySet({ fetchImpl: tracker?.fetchImpl });
  const count = boundedInteger(env.POORUP_BOT_EVAL_COUNT, 1, 100);
  const stepLimit = boundedInteger(env.POORUP_BOT_EVAL_STEP_LIMIT, 20_000, 100_000);
  const seeds = seedsForRun(env, count);
  const policySets = policyTriples(policies);
  const report = await runBotTournament({ seeds, policySets, seatRotations: [0, 1, 2], stepLimit, callCapTracker: tracker });
  write(JSON.stringify(campaignResult({ env, live, maxCalls, tracker, policies, seeds, stepLimit, report }), null, 2));
}
