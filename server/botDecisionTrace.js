// Normalises a bot decision trace entry into the bounded record kept on the game (identity, policy, action and shadow fields).
import { finiteNumber } from './numberUtils.js';

// Serialisers are split by section so each stays branch-light; together they build the record in its fixed field order.
function traceIdentityFields(entry) {
  return {
    botId: entry.botId ? String(entry.botId).slice(0, 80) : null,
    gameId: entry.gameId ? String(entry.gameId).slice(0, 120) : null,
    ruleVersion: String(entry.ruleVersion || 'bot-policy-v1').slice(0, 32),
    sequence: Math.max(0, Math.floor(finiteNumber(entry.decisionSequence))),
    phase: String(entry.phase || 'unknown').slice(0, 24),
    provider: String(entry.provider || 'deterministic').slice(0, 24),
    fallback: entry.fallback === true,
    success: entry.success !== false,
    fallbackReason: entry.fallbackReason ? String(entry.fallbackReason).slice(0, 40) : null
  };
}

function tracePolicyFields(entry, settings) {
  return {
    brain: String(entry.brain || settings.botBrain || 'ai').slice(0, 12),
    difficulty: String(entry.difficulty || settings.botDifficulty || 'table').slice(0, 12),
    planningHorizon: Math.max(0, Math.min(3, Math.floor(finiteNumber(entry.planningHorizon)))),
    strategicScore: Number.isFinite(Number(entry.strategicScore)) ? Number(entry.strategicScore) : null
  };
}

function traceActionFields(entry) {
  return {
    actionId: entry.actionId ? String(entry.actionId).slice(0, 100) : null,
    confidence: Math.max(0, Math.min(1, finiteNumber(entry.confidence))),
    reasonCode: entry.reasonCode ? String(entry.reasonCode).slice(0, 40) : 'unknown',
    latencyMs: Math.max(0, Math.floor(finiteNumber(entry.latencyMs)))
  };
}

function traceShadowFields(entry) {
  return {
    candidateIds: Array.isArray(entry.candidateIds) ? entry.candidateIds.filter(id => typeof id === 'string').slice(0, 24).map(id => id.slice(0, 100)) : [],
    shadowActionId: entry.shadowActionId ? String(entry.shadowActionId).slice(0, 100) : null,
    shadowConfidence: entry.shadowConfidence == null ? null : Math.max(0, Math.min(1, finiteNumber(entry.shadowConfidence))),
    shadowProvider: entry.shadowProvider ? String(entry.shadowProvider).slice(0, 24) : null,
    shadowAgreement: entry.shadowAgreement === true,
    shadowModel: entry.shadowModel ? String(entry.shadowModel).slice(0, 48) : null
  };
}

export function buildDecisionTraceRecord(entry, settings) {
  return {
    ...traceIdentityFields(entry),
    ...tracePolicyFields(entry, settings),
    ...traceActionFields(entry),
    ...traceShadowFields(entry),
    recordedAt: new Date().toISOString()
  };
}
