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
const ai = new DeepSeekAdvisor({
  apiKey: 'test-key',
  fetchImpl: async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"actionId":"roll","confidence":0.9,"reasonCode":"preserve-cash"}' } }] }) };
  }
});
const aiDecision = await ai.chooseAction({ candidates, personality: 'survivor', botBrain: 'auto', gameId: 'g-ai', decisionSequence: 1 });
assert.equal(aiDecision.provider, 'ai');
assert.equal(aiDecision.fallback, false);
assert.equal(aiDecision.actionId, 'roll');
assert.equal(aiDecision.model, 'deepseek-v4-flash');
assert.equal(calls, 1);

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
console.log('bot advisor modes and fallback: 13 passed, 0 failed');
