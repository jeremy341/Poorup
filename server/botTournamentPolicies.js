import { AiAdvisor, DeterministicAdvisor } from './botAdvisor.js';

function stableDecisionHash(seed, policyId, decisionIndex) {
  let hash = Number(seed) >>> 0;
  const text = `${String(policyId || 'random-legal')}:${Math.max(0, Number(decisionIndex) || 0)}`;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16_777_619) >>> 0;
  }
  return hash >>> 0;
}

export function createRandomLegalAdvisor() {
  return {
    supportsChoicePhases: true,
    async chooseAction({ candidates = [], simulationSeed = 0, policyId = 'random-legal', policyDecisionIndex = 0 }) {
      if (!candidates.length) return { actionId: null };
      const index = stableDecisionHash(simulationSeed, policyId, policyDecisionIndex) % candidates.length;
      const candidate = candidates[index];
      return { actionId: candidate ? candidate.id || null : null };
    },
  };
}

function messagePrompt(messages) {
  if (!Array.isArray(messages)) return undefined;
  const lastMessage = messages[messages.length - 1];
  return lastMessage ? lastMessage.content : undefined;
}

function inputPrompt(input) {
  if (!Array.isArray(input)) return undefined;
  const userMessage = input.find(item => item.role === 'user');
  if (!userMessage || !Array.isArray(userMessage.content)) return undefined;
  const firstContent = userMessage.content[0];
  return firstContent ? firstContent.text : undefined;
}

function requestPrompt(request) {
  return messagePrompt(request.messages) || inputPrompt(request.input) || '{}';
}

// An auction-bid candidate declares parameterRanges, so a reply without parameters.amount fails the advisor's response
// validation, which trips its circuit breaker and sends every later decision to the deterministic planner.
// Bots may only raise by the offered steps; the stub picks the standard +20 when offered, else the smallest legal raise.
export function stubBidAmount(candidate) {
  const options = Array.isArray(candidate?.amountOptions) ? candidate.amountOptions.filter(Number.isInteger) : [];
  if (!options.length) return null;
  return options[Math.min(1, options.length - 1)];
}

// The stub plays the planner's best option. The advisor
// shuffles the order (option-ID bias), so "first" is random. Pick on the planner score in the prompt (futureScore when
// projected, else the static score), breaking ties on lower risk.
export function stubPickCandidate(candidates) {
  const projected = candidates.filter(candidate => Number.isFinite(candidate?.futureScore));
  const pool = projected.length ? projected : candidates;
  const value = candidate => (projected.length ? candidate.futureScore : Number(candidate?.score) || 0);
  const risk = candidate => Number(candidate?.risk) || 0;
  return pool.reduce((best, candidate) => {
    if (value(candidate) !== value(best)) return value(candidate) > value(best) ? candidate : best;
    return risk(candidate) < risk(best) ? candidate : best;
  }, pool[0]);
}

function stubChoiceOutput(context) {
  const candidates = Array.isArray(context.candidates) ? context.candidates : [];
  const picked = stubPickCandidate(candidates);
  const amount = stubBidAmount(picked);
  return JSON.stringify({
    actionId: picked?.actionId,
    confidence: 0.55,
    reasonCode: 'evaluation-stub',
    ...(amount == null ? {} : { parameters: { amount } }),
  });
}

function formatStubAdvisorReply(request, output) {
  if (Array.isArray(request.input)) return { output_text: output };
  return { choices: [{ message: { content: output } }] };
}

function createStubAdvisorReply(request) {
  const context = JSON.parse(requestPrompt(request));
  return formatStubAdvisorReply(request, stubChoiceOutput(context));
}

function stubFetch() {
  return async (_url, options) => ({
    ok: true,
    status: 200,
    json: async () => createStubAdvisorReply(JSON.parse(options.body)),
  });
}

// The advisor reads the environment it is handed, not the ambient
// process.env: the CLI validates an injected environment, so the advisor that
// runs the campaign has to see the same one.
function configuredValue(env, primary, secondary, fallback = undefined) {
  return env?.[primary] || env?.[secondary] || fallback;
}

function aiAdvisorOptions(fetchImpl, env = process.env) {
  return {
    apiKey: configuredValue(env, 'POORUP_AI_API_KEY', 'DEEPSEEK_API_KEY', 'simulation-stub'),
    endpoint: configuredValue(env, 'POORUP_AI_BASE_URL', 'DEEPSEEK_API_URL'),
    model: configuredValue(env, 'POORUP_AI_MODEL', 'DEEPSEEK_MODEL', 'deepseek-v4-flash'),
    protocol: configuredValue(env, 'POORUP_AI_PROTOCOL', 'DEEPSEEK_API_FORMAT', 'auto'),
    fetchImpl: fetchImpl || stubFetch(),
  };
}

function scoreFor(candidate) {
  return Number(candidate.score || 0);
}

function conservativeScoreFor(candidate) {
  const cost = Number(candidate.cost || candidate.projectedCashDelta || 0);
  return scoreFor(candidate) - Math.abs(cost) * 0.01;
}

function createScoreAdvisor(scoreCandidate) {
  return {
    supportsChoicePhases: true,
    async chooseAction({ candidates = [] }) {
      const ranked = [...candidates].sort((left, right) => scoreCandidate(right) - scoreCandidate(left));
      return { actionId: ranked[0]?.id };
    },
  };
}

// `createAdvisor` builds a fresh advisor for each simulated match, so stateful
// advisors (call timestamps, circuit breaker, per-game budgets) do not leak
// between matches. `advisor` stays available for direct use and as the fallback.
export function createBotPolicy(policyId, { brain = 'no-ai', difficulty = 'table', advisor, createAdvisor } = {}) {
  const defaultAdvisor = advisor || (typeof createAdvisor === 'function' ? createAdvisor() : new DeterministicAdvisor());
  return { policyId, brain, difficulty, advisor: defaultAdvisor, ...(typeof createAdvisor === 'function' ? { createAdvisor } : {}) };
}

export function createDefaultPolicySet({ fetchImpl, env = process.env } = {}) {
  const greedy = createScoreAdvisor(scoreFor);
  const conservative = createScoreAdvisor(conservativeScoreFor);
  return [
    createBotPolicy('no-ai', { brain: 'no-ai', advisor: new DeterministicAdvisor() }),
    createBotPolicy('ai-stub', { brain: 'ai', createAdvisor: () => new AiAdvisor(aiAdvisorOptions(fetchImpl, env)) }),
    createBotPolicy('score-greedy', { advisor: greedy }),
    createBotPolicy('conservative-cash', { advisor: conservative }),
    createBotPolicy('random-legal', { advisor: createRandomLegalAdvisor() }),
  ];
}
