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

function stubChoiceOutput(context) {
  const candidates = Array.isArray(context.candidates) ? context.candidates : [];
  return JSON.stringify({
    actionId: candidates[0]?.actionId,
    confidence: 0.55,
    reasonCode: 'evaluation-stub',
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

function configuredValue(primary, secondary, fallback = undefined) {
  return process.env[primary] || process.env[secondary] || fallback;
}

function aiAdvisorOptions(fetchImpl) {
  return {
    apiKey: configuredValue('POORUP_AI_API_KEY', 'DEEPSEEK_API_KEY', 'simulation-stub'),
    endpoint: configuredValue('POORUP_AI_BASE_URL', 'DEEPSEEK_API_URL'),
    model: configuredValue('POORUP_AI_MODEL', 'DEEPSEEK_MODEL', 'deepseek-v4-flash'),
    protocol: configuredValue('POORUP_AI_PROTOCOL', 'DEEPSEEK_API_FORMAT', 'auto'),
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

export function createBotPolicy(policyId, { brain = 'no-ai', difficulty = 'table', advisor } = {}) {
  const defaultAdvisor = advisor || new DeterministicAdvisor();
  return { policyId, brain, difficulty, advisor: defaultAdvisor };
}

export function createDefaultPolicySet({ fetchImpl } = {}) {
  const aiAdvisor = new AiAdvisor(aiAdvisorOptions(fetchImpl));
  const greedy = createScoreAdvisor(scoreFor);
  const conservative = createScoreAdvisor(conservativeScoreFor);
  return [
    createBotPolicy('no-ai', { brain: 'no-ai', advisor: new DeterministicAdvisor() }),
    createBotPolicy('ai-stub', { brain: 'ai', advisor: aiAdvisor }),
    createBotPolicy('score-greedy', { advisor: greedy }),
    createBotPolicy('conservative-cash', { advisor: conservative }),
    createBotPolicy('random-legal', { advisor: createRandomLegalAdvisor() }),
  ];
}
