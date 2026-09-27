// Provider seam tests: AI is preferred when available, but every failure mode
// must return a deterministic decision without delaying the room.
import assert from 'node:assert/strict';
import { createBotAdvisor, AiAdvisor, DeepSeekAdvisor, DeterministicAdvisor, shortlistAdvisorCandidates } from './botAdvisor.js';

const candidates = [
  { id: 'roll', kind: 'roll', score: 0, risk: 0 },
  { id: 'build:1', kind: 'build', score: 30, risk: 0.2, cost: 100 }
];

function providerAction(options, kind = null) {
  const body = JSON.parse(options.body);
  const userPrompt = body.messages?.[1]?.content || body.input?.[1]?.content?.[0]?.text;
  const sent = JSON.parse(userPrompt).candidates;
  return (kind ? sent.find(candidate => candidate.kind === kind) : sent[0]).actionId;
}

const deterministic = new DeterministicAdvisor();
const localDecision = await deterministic.chooseAction({ candidates, personality: 'builder', botDifficulty: 'table' });
assert.equal(localDecision.provider, 'deterministic');
assert.equal(localDecision.fallback, true);
assert.equal(localDecision.actionId, 'build:1');

let calls = 0;
let requestBody = null;
const ai = new DeepSeekAdvisor({
  apiKey: 'test-key',
  fetchImpl: async (_url, options) => {
    calls += 1;
    requestBody = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ actionId: providerAction(options, 'roll'), confidence: 0.9, reasonCode: 'preserve-cash' }) } }] }) };
  }
});
const aiDecision = await ai.chooseAction({
  candidates,
  personality: 'survivor',
  botBrain: 'auto',
  gameId: 'g-ai',
  botId: 'private-seat-id',
  phase: 'pre-roll',
  roundNumber: 4,
  contextVersion: 'bot-context-v2',
  botState: { cash: 1000, propertyCount: 2, bankLoanStatus: null },
  opponentSummaries: [{ seat: 'player', cashBand: 'steady', propertyCount: 1 }],
  turn: { currentSeat: 'self', hasRolled: false },
  board: [{ index: 0, type: 'start', ownerSeat: 'bank' }],
  obligations: { payment: null },
  rulesDigest: { version: 'bot-policy-v2', boardSize: 40 },
  activeEvent: null,
  decisionSequence: 1,
  ruleVersion: 'bot-policy-v1'
});
assert.equal(aiDecision.provider, 'ai');
assert.equal(aiDecision.fallback, false);
assert.equal(aiDecision.actionId, 'roll');
assert.equal(aiDecision.model, 'deepseek-v4-flash');
assert.equal(calls, 1);
const promptContext = JSON.parse(requestBody.messages[1].content);
assert.equal(promptContext.phase, 'pre-roll');
assert.equal(promptContext.roundNumber, 4);
assert.equal(promptContext.botState.cash, 1000);
assert.equal(promptContext.contextVersion, 'bot-context-v3');
assert.equal(promptContext.rulesDigest.boardSize, 40);
assert.equal(promptContext.turn.currentSeat, 'self');
assert.equal(promptContext.planningHorizon, 1);
assert.match(promptContext.candidates[0].actionId, /^act-\d{2}$/);
assert.equal(promptContext.candidateCoverage.totalCount, 2);
assert.equal(promptContext.candidateCoverage.omittedCount, 0);
assert.equal(typeof promptContext.strategicSummary.rentExposure, 'number');
assert.deepEqual(promptContext.recentDecisions, []);
assert.deepEqual(promptContext.decisionMemory, { decisions: 0, successes: 0, failures: 0, actionRates: [], phaseRates: [] });
assert.equal(promptContext.candidates[0].planningHorizon, 1);
assert.equal(Number.isFinite(promptContext.candidates[0].futureScore), true);
assert.equal(Number.isFinite(promptContext.candidates[0].projectedLiquidity), true);
assert.equal(Number.isFinite(promptContext.candidates[0].expectedCashFlow), true);
assert.equal(Object.prototype.hasOwnProperty.call(promptContext, 'botId'), false);
assert.equal(Object.prototype.hasOwnProperty.call(promptContext, 'gameId'), false);

const privateActionId = 'trade:player-stable-9f4b:tile-1';
const privateOfferId = 'offer-stable-a72c';
const privatePlayerId = 'player-stable-9f4b';
const privateTableTalk = 'private-table-talk-8d3c';
let privateRequestBody = null;
const privateAdvisor = new AiAdvisor({
  apiKey: 'provider-secret-4a2f',
  fetchImpl: async (_url, options) => {
    privateRequestBody = JSON.parse(options.body);
    const sentContext = JSON.parse(privateRequestBody.messages[1].content);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        actionId: sentContext.candidates[0].actionId,
        confidence: 0.8,
        reasonCode: 'best-value'
      }) } }] })
    };
  }
});
const privateDecision = await privateAdvisor.chooseAction({
  candidates: [
    {
      id: privateActionId,
      kind: 'trade',
      toPlayerId: privatePlayerId,
      score: 20,
      risk: 0.2,
      offer: { id: privateOfferId, toPlayerId: privatePlayerId, requestCash: 100 }
    },
    { id: 'chat:private-player-stable-9f4b', kind: 'chat', text: privateTableTalk, score: 1, risk: 0 }
  ],
  botBrain: 'ai',
  gameId: 'private-game-13d7',
  botId: 'private-seat-82bd',
  phase: 'pre-roll',
  recentDecisions: [{ phase: 'trade', actionId: 'contract:player-stable-9f4b' }],
  decisionMemory: {
    decisions: 1,
    successes: 1,
    failures: 0,
    actionRates: [{ actionId: 'sell:player-stable-9f4b', attempts: 1, successes: 1 }],
    phaseRates: []
  },
  credentials: 'provider-secret-4a2f',
  hiddenDeckOrder: ['hidden-card-order-135a']
});
const serializedPrivateRequest = JSON.stringify(privateRequestBody);
for (const privateValue of [privateActionId, privateOfferId, privatePlayerId, privateTableTalk,
  'private-game-13d7', 'private-seat-82bd', 'provider-secret-4a2f', 'hidden-card-order-135a']) {
  assert.equal(serializedPrivateRequest.includes(privateValue), false, `provider payload must omit ${privateValue}`);
}
assert.equal(privateDecision.provider, 'ai');
assert.equal(privateDecision.actionId, privateActionId, 'the opaque response token maps back to the internal live candidate');
const privatePromptContext = JSON.parse(privateRequestBody.messages[1].content);
assert.equal(privatePromptContext.candidates[0].actionId === privateActionId, false);
assert.equal(Object.hasOwn(privatePromptContext.candidates[0], 'offer'), false);
assert.equal(Object.hasOwn(privatePromptContext.candidates[0], 'toPlayerId'), false);
assert.equal(Object.hasOwn(privatePromptContext.candidates[1], 'text'), false);

const manyCandidates = Array.from({ length: 64 }, (_, index) => ({
  id: `candidate-${index}`,
  kind: index === 63 ? 'sell' : index === 62 ? 'unmortgage' : index === 61 ? 'contract-propose' : 'build',
  score: index === 63 ? 10_000 : index === 62 ? 9_000 : index === 61 ? -500 : 100 - index,
  risk: 0.1
}));
const shortlisted = shortlistAdvisorCandidates(manyCandidates, new Map(), { phase: 'payment', maxCandidates: 32 });
assert.deepEqual(Object.keys(shortlisted).sort(), ['candidates', 'omittedByKind', 'omittedCount', 'totalCount']);
assert.equal(shortlisted.totalCount, 64);
assert.equal(shortlisted.candidates.length, 32);
assert.ok(shortlisted.candidates.some(candidate => candidate.id === 'candidate-63'));
assert.ok(shortlisted.candidates.some(candidate => candidate.id === 'candidate-62'));
assert.ok(shortlisted.candidates.some(candidate => candidate.id === 'candidate-61'), 'a lower-ranked contract family survives family coverage');
assert.equal(shortlisted.omittedCount, 32);
assert.deepEqual(shortlisted.omittedByKind, { build: 32 });
const rescueShortlist = shortlistAdvisorCandidates([
  ...Array.from({ length: 40 }, (_, index) => ({ id: `build-${index}`, kind: 'build', score: 100 - index })),
  { id: 'bankruptcy-terminal', kind: 'bankruptcy', score: -10_000 }
], new Map(), { phase: 'payment', maxCandidates: 32 });
assert.ok(rescueShortlist.candidates.some(candidate => candidate.id === 'bankruptcy-terminal'));
const phaseRescues = shortlistAdvisorCandidates([
  ...Array.from({ length: 40 }, (_, index) => ({ id: `debt:sell:${index}`, kind: 'choice', choiceId: `sell:${index}`, score: 100 - index })),
  { id: 'debt:loan', kind: 'choice', choiceId: 'loan', score: -100 },
  { id: 'debt:bankruptcy', kind: 'choice', choiceId: 'bankruptcy', score: -1_000 }
], new Map(), { phase: 'payment', maxCandidates: 32 });
assert.ok(phaseRescues.candidates.some(candidate => candidate.id === 'debt:loan'));
assert.ok(phaseRescues.candidates.some(candidate => candidate.id === 'debt:bankruptcy'));
assert.equal(phaseRescues.candidates.length, 32);
const evaluatedOrder = shortlistAdvisorCandidates([
  { id: 'raw-high', kind: 'build', score: 1_000 },
  { id: 'shared-eval-high', kind: 'trade', score: 1 }
], new Map([['raw-high', { score: 1 }], ['shared-eval-high', { score: 2 }]]), { phase: 'trade' });
assert.equal(evaluatedOrder.candidates[0].id, 'shared-eval-high');
assert.equal(shortlistAdvisorCandidates(manyCandidates, new Map(), { maxCandidates: 0 }).candidates.length, 0);
for (const count of [0, 32, 33, 60]) {
  const result = shortlistAdvisorCandidates(manyCandidates.slice(0, count), new Map(), { phase: 'pre-roll', maxCandidates: 32 });
  assert.equal(result.totalCount, count);
  assert.equal(result.omittedCount, Math.max(0, count - 32));
}

const omittedLegalId = 'legal-but-not-shortlisted';
const omittedCandidates = Array.from({ length: 33 }, (_, index) => ({
  id: index === 32 ? omittedLegalId : `legal-${index}`,
  kind: 'build',
  score: 100 - index
}));
let omittedPrompt = null;
const omittedProvider = new AiAdvisor({
  apiKey: 'test-key',
  fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    omittedPrompt = JSON.parse(body.messages[1].content);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ actionId: omittedLegalId, confidence: 0.8 }) } }] }) };
  }
});
const omittedDecision = await omittedProvider.chooseAction({ candidates: omittedCandidates, botBrain: 'ai', gameId: 'omitted-id-case' });
assert.equal(omittedPrompt.candidates.length, 32);
assert.equal(omittedPrompt.candidates.some(candidate => candidate.actionId === omittedLegalId), false);
assert.equal(omittedDecision.fallbackReason, 'invalid-response');

let releaseReconfiguredResponse;
const reconfigured = new AiAdvisor({
  apiKey: 'test-key',
  fetchImpl: async () => new Promise(resolve => { releaseReconfiguredResponse = resolve; })
});
const pendingReconfiguration = reconfigured.chooseAction({ candidates, botBrain: 'ai', gameId: 'provider-reconfigured' });
while (!releaseReconfiguredResponse) await Promise.resolve();
reconfigured.configureProvider({ apiKey: 'replacement-key', model: 'replacement-model' });
releaseReconfiguredResponse({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"actionId":"act-01","confidence":0.8}' } }] }) });
assert.equal((await pendingReconfiguration).fallbackReason, 'provider-reconfigured');

const timedOut = new AiAdvisor({
  apiKey: 'test-key',
  timeoutMs: 5,
  fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('stub timeout');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  })
});
assert.equal((await timedOut.chooseAction({ candidates, botBrain: 'ai', gameId: 'timeout-stub' })).fallbackReason, 'timeout');

let quotaCalls = 0;
const quota = new DeepSeekAdvisor({
  apiKey: 'test-key',
  fetchImpl: async (_url, options) => {
    quotaCalls += 1;
    return { ok: false, status: 429, json: async () => ({}) };
  }
});
const quotaDecision = await quota.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-quota', decisionSequence: 1 });
assert.equal(quotaDecision.provider, 'deterministic');
assert.equal(quotaDecision.fallbackReason, 'quota');
const quotaSecond = await quota.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-quota', decisionSequence: 2 });
assert.equal(quotaSecond.fallbackReason, 'quota-exhausted');
assert.equal(quotaCalls, 1);
assert.equal(quotaSecond.effectiveBrain, 'no-ai');
assert.equal(quota.getPublicStatus().state, 'quota-exhausted');

let recoveringCalls = 0;
const recovering = new DeepSeekAdvisor({
  apiKey: 'test-key',
  circuitCooldownMs: 1000,
  fetchImpl: async (_url, options) => {
    recoveringCalls += 1;
    if (recoveringCalls === 1) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ actionId: providerAction(options), confidence: 0.7 }) } }] }) };
  }
});
await recovering.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-recover', decisionSequence: 1 });
recovering.circuitOpenUntil = Date.now() - 1;
const stillFallback = await recovering.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-recover', decisionSequence: 2 });
assert.equal(stillFallback.provider, 'deterministic');
assert.equal(stillFallback.fallbackReason, 'quota-exhausted');
assert.equal(recoveringCalls, 1);
recovering.resetProviderHealth();
const recovered = await recovering.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-recover', decisionSequence: 3 });
assert.equal(recovered.provider, 'ai');
assert.equal(recoveringCalls, 2);

const statusEvents = [];
const statusAdvisor = new DeepSeekAdvisor({ apiKey: 'test-key', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
const unsubscribe = statusAdvisor.subscribeProviderStatus(status => statusEvents.push(status));
await statusAdvisor.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-status', decisionSequence: 1 });
assert.equal(statusEvents.at(-1).state, 'quota-exhausted');
assert.equal(statusEvents.at(-1).reason, 'credits-exhausted');
assert.equal(Object.prototype.hasOwnProperty.call(statusEvents.at(-1), 'apiKey'), false);
unsubscribe();

let noAiCalls = 0;
const noAi = new DeepSeekAdvisor({ apiKey: 'test-key', fetchImpl: async () => { noAiCalls += 1; return null; } });
const noAiDecision = await noAi.chooseAction({ candidates, botBrain: 'no-ai', gameId: 'g-no-ai' });
assert.equal(noAiDecision.fallbackReason, 'no-ai-mode');
assert.equal(noAiCalls, 0);

const malformed = new DeepSeekAdvisor({ apiKey: 'test-key', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{not-json' } }] }) }) });
const malformedDecision = await malformed.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-malformed' });
assert.equal(malformedDecision.fallbackReason, 'invalid-response');

const noProvider = new DeepSeekAdvisor({ apiKey: 'test-key', fetchImpl: null });
const noProviderDecision = await noProvider.chooseAction({ candidates, botBrain: 'auto', gameId: 'g-provider' });
assert.equal(noProviderDecision.fallbackReason, 'provider');

const shadow = new DeepSeekAdvisor({
  apiKey: 'test-key',
  shadow: true,
  fetchImpl: async (_url, options) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ actionId: providerAction(options, 'roll'), confidence: 0.8 }) } }] }) })
});
const shadowDecision = await shadow.chooseAction({ candidates, botBrain: 'auto', gameId: 'g-shadow' });
assert.equal(shadowDecision.provider, 'deterministic');
assert.equal(shadowDecision.fallbackReason, 'shadow-mode');
assert.deepEqual(shadowDecision.shadowEvaluation, {
  actionKind: 'roll',
  deterministicActionKind: 'build',
  agreement: false,
  phase: 'pre-roll',
  candidateCoverage: { totalCount: 2, sentCount: 2, omittedCount: 0, omittedByKind: {} },
  provider: 'ai',
  model: 'deepseek-v4-flash',
  promptVersion: 'poorup-advisor-2026-09-25',
  fallback: true,
  modelFallback: false,
  latencyMs: shadowDecision.shadowEvaluation.latencyMs,
  fallbackReason: 'shadow-mode'
});
assert.equal(Object.hasOwn(shadowDecision, 'shadowActionId'), false);
const privateShadow = new AiAdvisor({
  apiKey: 'test-key',
  shadow: true,
  fetchImpl: async (_url, options) => ({ ok: true, status: 200, json: async () => ({
    choices: [{ message: { content: JSON.stringify({ actionId: providerAction(options), confidence: 0.7 }) } }]
  }) })
});
const privateShadowDecision = await privateShadow.chooseAction({
  botBrain: 'ai',
  candidates: [{ id: 'trade:player-stable-shadow-381a', kind: 'trade', score: 10 }]
});
assert.equal(JSON.stringify(privateShadowDecision.shadowEvaluation).includes('player-stable-shadow-381a'), false);
assert.equal(privateShadowDecision.shadowEvaluation.actionKind, 'trade');
assert.equal(shadow.getHealth().shadow, true);

let transientCalls = 0;
const transient = new DeepSeekAdvisor({
  apiKey: 'test-key',
  circuitCooldownMs: 1000,
  fetchImpl: async () => {
    transientCalls += 1;
    throw new Error('network down');
  }
});
assert.equal((await transient.chooseAction({ candidates, botBrain: 'auto', gameId: 'g-network', decisionSequence: 1 })).fallbackReason, 'network');
assert.equal((await transient.chooseAction({ candidates, botBrain: 'auto', gameId: 'g-network', decisionSequence: 2 })).fallbackReason, 'network');
assert.equal((await transient.chooseAction({ candidates, botBrain: 'auto', gameId: 'g-network', decisionSequence: 3 })).fallbackReason, 'circuit-open');
assert.equal(transientCalls, 2);

const budget = new DeepSeekAdvisor({ apiKey: 'test-key', maxDecisionsPerGame: 1, fetchImpl: async (_url, options) => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ actionId: providerAction(options), confidence: 0.8 }) } }] }) }) });
await budget.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-budget', decisionSequence: 1 });
assert.equal((await budget.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-budget', decisionSequence: 2 })).fallbackReason, 'game-budget');

const flaky = new DeepSeekAdvisor({ apiKey: 'test-key', maxDecisionsPerGame: 1, fetchImpl: async () => { throw new Error('down'); } });
assert.equal((await flaky.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-refund', decisionSequence: 1 })).fallbackReason, 'network');
// Infra failure refunds the budget: the retry reaches the provider again
// instead of hitting game-budget.
assert.equal((await flaky.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-refund', decisionSequence: 2 })).fallbackReason, 'network');

const metroPrompt = JSON.parse(ai.advisorUserPrompt({
  contextVersion: 'bot-context-v2',
  board: Array.from({ length: 52 }, (_, index) => ({ index, type: 'property' })),
  candidates,
  botDifficulty: 'table',
  gameId: 'metro-prompt'
}));
assert.equal(metroPrompt.board.length, 52);

assert.equal(DeepSeekAdvisor, AiAdvisor);
assert.equal(createBotAdvisor({ DEEPSEEK_API_KEY: 'test-key' }) instanceof AiAdvisor, true);
assert.equal(createBotAdvisor({ POORUP_AI_API_KEY: 'test-key' }) instanceof AiAdvisor, true);
assert.equal(createBotAdvisor({ DEEPSEEK_API_KEY: 'test-key' }) instanceof DeepSeekAdvisor, true);
assert.equal(createBotAdvisor({ POORUP_BOT_ADVISOR: 'no-ai', DEEPSEEK_API_KEY: 'test-key' }) instanceof DeterministicAdvisor, true);
const genericProvider = createBotAdvisor({
  POORUP_AI_API_KEY: 'generic-key',
  POORUP_AI_BASE_URL: 'https://api.openai.com/v1',
  POORUP_AI_MODEL: 'gpt-test',
  POORUP_AI_PROTOCOL: 'responses'
});
assert.equal(genericProvider.getHealth().model, 'gpt-test');
assert.equal(genericProvider.getHealth().protocol, 'responses');
let responsesBody = null;
const responsesProvider = new DeepSeekAdvisor({
  apiKey: 'response-key',
  endpoint: 'https://provider.test/v1/responses',
  protocol: 'responses',
  model: 'response-model',
  fetchImpl: async (_url, options) => {
    responsesBody = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ output_text: JSON.stringify({ actionId: providerAction(options, 'roll'), confidence: 0.8 }) }) };
  }
});
const responsesDecision = await responsesProvider.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-responses' });
assert.equal(responsesDecision.provider, 'ai');
assert.equal(responsesDecision.actionId, 'roll');
assert.ok(Array.isArray(responsesBody.input));
assert.equal(responsesBody.text.format.type, 'json_object');
const structuredPromptFields = '{"actionId":"...","confidence":0-1,"reasonCode":"..."}';
const chatSystemPrompt = ai.advisorRequestPayload({ candidates }).messages[0].content;
const responsesSystemPrompt = responsesProvider.responsesRequestPayload({ candidates }).input[0].content[0].text;
for (const [protocol, systemPrompt] of [['chat', chatSystemPrompt], ['responses', responsesSystemPrompt]]) {
  assert.ok(systemPrompt.includes(structuredPromptFields), `${protocol} protocol requests the three structured decision fields`);
  assert.equal(/reasoning/i.test(systemPrompt), false, `${protocol} protocol does not request free-form reasoning`);
}
const noAiCapabilities = new DeterministicAdvisor();
for (const [phase, supported] of [
  ['trade', true],
  ['contract', true],
  ['payment', true],
  ['vote', false],
  ['sponsorship', false],
  ['auction', false]
]) {
  assert.equal(typeof noAiCapabilities.supportsChoicePhase, 'function', 'NO-AI exposes phase-specific choice capability');
  assert.equal(noAiCapabilities.supportsChoicePhase(phase), supported, `NO-AI ${phase} capability`);
}
assert.equal(noAiCapabilities.supportsChoicePhases, false, 'legacy aggregate flag stays false for NO-AI');

const aiCapabilities = new AiAdvisor({ apiKey: 'test-key', fetchImpl: async () => null });
for (const phase of ['vote', 'trade', 'contract', 'sponsorship', 'payment', 'auction']) {
  assert.equal(typeof aiCapabilities.supportsChoicePhase, 'function', 'AI exposes phase-specific choice capability');
  assert.equal(aiCapabilities.supportsChoicePhase(phase), true, `AI ${phase} capability`);
}
assert.equal(aiCapabilities.supportsChoicePhases, true, 'legacy aggregate flag stays true for AI');

const noiseProbe = new DeterministicAdvisor();
const closeChoices = [
  { id: 'exposed', kind: 'market', score: 10, risk: 0, projectedCashDelta: 400 },
  { id: 'quiet', kind: 'market', score: 10, risk: 0, projectedCashDelta: 0 }
];
const seedAChoice = await noiseProbe.chooseAction({ candidates: closeChoices, personality: 'survivor', botDifficulty: 'expert', botBrain: 'no-ai', gameId: 'seed-a', decisionSequence: 1 });
const seedBChoice = await noiseProbe.chooseAction({ candidates: closeChoices, personality: 'survivor', botDifficulty: 'expert', botBrain: 'no-ai', gameId: 'seed-b', decisionSequence: 1 });
assert.equal(seedAChoice.actionId, 'exposed');
assert.equal(seedBChoice.actionId, seedAChoice.actionId, 'changing only the seed cannot inject a score-noise choice flip');

const unsupportedPrompt = JSON.parse(aiCapabilities.advisorUserPrompt({
  contextVersion: 'bot-context-v2',
  candidates: [{ id: 'unknown-choice', kind: 'unknown-choice', score: 7 }],
  botDifficulty: 'table',
  board: [{ index: 0, type: 'start', ownerSeat: 'bank' }],
  botState: { cash: 1000 },
  rulesDigest: { globalEvents: { activeEffects: {} } }
}));
const unsupportedPromptCandidate = unsupportedPrompt.candidates[0];
assert.equal(unsupportedPromptCandidate.projectionStatus, 'unsupported');
assert.equal(Object.hasOwn(unsupportedPromptCandidate, 'futureScore'), false);
assert.equal(Object.hasOwn(unsupportedPromptCandidate, 'projectedLiquidity'), false);

const samePhaseFallback = new AiAdvisor({
  apiKey: 'test-key',
  fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) })
});
const tradeFallback = await samePhaseFallback.chooseAction({
  botBrain: 'ai',
  phase: 'trade',
  gameId: 'same-phase-trade-fallback',
  candidates: [
    { id: 'trade:accept', kind: 'choice', choiceId: 'accept', score: 2 },
    { id: 'trade:decline', kind: 'choice', choiceId: 'decline', score: 8 }
  ]
});
assert.equal(tradeFallback.actionId, 'trade:decline');
assert.equal(tradeFallback.provider, 'deterministic');
assert.equal(tradeFallback.fallbackReason, 'provider');

const expertContext = {
  contextVersion: 'bot-context-v2',
  botDifficulty: 'expert',
  gameId: 'bounded-scenario-context',
  candidates: [{ id: 'buy:6', kind: 'purchase', tileIndex: 6, price: 100, score: 20 }],
  board: [{ index: 6, type: 'property', group: null, ownerSeat: 'bank', price: 100, rent: 10, houseCount: 0, mortgaged: false }],
  botState: { cash: 500, position: 0, properties: [], marketPositions: {}, marketExpansion: {}, bankLoan: null, contracts: [], casino: { net: 0 } },
  rulesDigest: { purchaseReserve: 120, doubleRent: false, globalEvents: { activeEffects: {} } }
};
const expertPrompt = JSON.parse(aiCapabilities.advisorUserPrompt(expertContext));
assert.equal(expertPrompt.candidates[0].rolloutBudget, 16);
assert.equal(expertPrompt.candidates[0].projectionStatus, 'projected');
assert.equal(expertPrompt.candidates[0].policyVersion, 'no-ai-outcome-v1');
assert.equal(expertPrompt.candidates[0].estimatedNetWorthDelta, 0);
const expertDecision = await noiseProbe.chooseAction({
  candidates: [{ id: 'one', kind: 'roll', score: 1 }],
  personality: 'survivor',
  botDifficulty: 'expert',
  botBrain: 'no-ai',
  gameId: 'bounded-scenario-context',
  decisionSequence: 1
});
assert.equal(expertDecision.rolloutBudget, 16);
console.log('bot advisor modes and fallback: phase capability and projection tests passed');
