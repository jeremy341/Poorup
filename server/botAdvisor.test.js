// Provider seam tests: AI is preferred when available, but every failure mode
// must return a deterministic decision without delaying the room.
import assert from 'node:assert/strict';
import { createBotAdvisor, DeepSeekAdvisor, DeterministicAdvisor } from './botAdvisor.js';

const candidates = [
  { id: 'roll', kind: 'roll', score: 0, risk: 0 },
  { id: 'build:1', kind: 'build', score: 30, risk: 0.2, cost: 100 }
];

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
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"actionId":"roll","confidence":0.9,"reasonCode":"preserve-cash"}' } }] }) };
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
assert.equal(promptContext.contextVersion, 'bot-context-v2');
assert.equal(promptContext.rulesDigest.boardSize, 40);
assert.equal(promptContext.turn.currentSeat, 'self');
assert.equal(promptContext.planningHorizon, 1);
assert.deepEqual(promptContext.recentDecisions, []);
assert.equal(promptContext.candidates[0].planningHorizon, 1);
assert.equal(Number.isFinite(promptContext.candidates[0].futureScore), true);
assert.equal(Number.isFinite(promptContext.candidates[0].projectedLiquidity), true);
assert.equal(Object.prototype.hasOwnProperty.call(promptContext, 'botId'), false);
assert.equal(Object.prototype.hasOwnProperty.call(promptContext, 'gameId'), false);

let quotaCalls = 0;
const quota = new DeepSeekAdvisor({
  apiKey: 'test-key',
  fetchImpl: async () => {
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

let recoveringCalls = 0;
const recovering = new DeepSeekAdvisor({
  apiKey: 'test-key',
  circuitCooldownMs: 1000,
  fetchImpl: async () => {
    recoveringCalls += 1;
    if (recoveringCalls === 1) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"actionId":"roll","confidence":0.7}' } }] }) };
  }
});
await recovering.chooseAction({ candidates, botBrain: 'auto', gameId: 'g-recover', decisionSequence: 1 });
recovering.circuitOpenUntil = Date.now() - 1;
const recovered = await recovering.chooseAction({ candidates, botBrain: 'auto', gameId: 'g-recover', decisionSequence: 2 });
assert.equal(recovered.provider, 'ai');
assert.equal(recoveringCalls, 2);

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
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"actionId":"roll","confidence":0.8}' } }] }) })
});
const shadowDecision = await shadow.chooseAction({ candidates, botBrain: 'auto', gameId: 'g-shadow' });
assert.equal(shadowDecision.provider, 'deterministic');
assert.equal(shadowDecision.fallbackReason, 'shadow-mode');
assert.equal(shadowDecision.shadowActionId, 'roll');
assert.equal(shadowDecision.shadowAgreement, false);
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

const budget = new DeepSeekAdvisor({ apiKey: 'test-key', maxDecisionsPerGame: 1, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"actionId":"roll","confidence":0.8}' } }] }) }) });
await budget.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-budget', decisionSequence: 1 });
assert.equal((await budget.chooseAction({ candidates, botBrain: 'ai', gameId: 'g-budget', decisionSequence: 2 })).fallbackReason, 'game-budget');

assert.equal(createBotAdvisor({ DEEPSEEK_API_KEY: 'test-key' }) instanceof DeepSeekAdvisor, true);
assert.equal(createBotAdvisor({ POORUP_BOT_ADVISOR: 'no-ai', DEEPSEEK_API_KEY: 'test-key' }) instanceof DeterministicAdvisor, true);
console.log('bot advisor modes and fallback: 18 passed, 0 failed');
