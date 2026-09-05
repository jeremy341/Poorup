const DEFAULT_TIMEOUT_MS = 600;
const PERSONALITIES = new Set(['builder', 'shark', 'survivor', 'speculator', 'diplomat', 'chaos']);

// One score boost per personality favorite action kind.
const PERSONALITY_BONUSES = new Map([
  ['builder:build', 20],
  ['survivor:mortgage', 18],
  ['speculator:loan', 16],
  ['chaos:roll', 4]
]);

function personalityBonus(personality, candidate) {
  return PERSONALITY_BONUSES.get(personality + ':' + candidate.kind) || 0;
}

function scoredRisk(entry) {
  return entry.candidate.risk || 0;
}

function compareScoredChoices(a, b) {
  return b.score - a.score || scoredRisk(a) - scoredRisk(b);
}

function deterministicChoice(candidates = [], personality = 'survivor') {
  const safePersonality = PERSONALITIES.has(personality) ? personality : 'survivor';
  const scored = candidates.map(candidate => ({
    candidate,
    score: (Number(candidate.score) || 0) + personalityBonus(safePersonality, candidate)
  }));
  scored.sort(compareScoredChoices);
  const selected = scored[0]?.candidate || null;
  if (!selected) return null;
  return { actionId: selected.id, confidence: 0.55, reasonCode: 'deterministic-score', fallback: true };
}

function advisorActionId(payload, candidates) {
  const actionId = typeof payload?.actionId === 'string' ? payload.actionId : '';
  if (!actionId) return '';
  return candidates.some(candidate => candidate.id === actionId) ? actionId : '';
}

function advisorConfidence(payload) {
  const confidence = Number(payload?.confidence);
  if (!Number.isFinite(confidence)) return null;
  if (confidence < 0) return null;
  if (confidence > 1) return null;
  return confidence;
}

function advisorReasonCode(payload) {
  if (typeof payload.reasonCode !== 'string') return 'advisor';
  return payload.reasonCode.slice(0, 40);
}

function parseAdvisorResponse(payload, candidates) {
  const actionId = advisorActionId(payload, candidates);
  if (!actionId) return null;
  const confidence = advisorConfidence(payload);
  if (confidence === null) return null;
  return { actionId, confidence, reasonCode: advisorReasonCode(payload), fallback: false };
}

export class DeterministicAdvisor {
  async chooseAction({ candidates = [], personality = 'survivor' } = {}) {
    return deterministicChoice(candidates, personality);
  }
}

export class DeepSeekAdvisor {
  constructor({ apiKey, endpoint = 'https://api.deepseek.com/chat/completions', model = 'deepseek-chat', timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey || '';
    this.endpoint = endpoint;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.fallback = new DeterministicAdvisor();
  }

  async chooseAction({ candidates = [], personality = 'survivor', event = null } = {}) {
    if (!this.apiKey || typeof this.fetchImpl !== 'function' || !candidates.length) {
      return this.fallback.chooseAction({ candidates, personality });
    }
    const action = await this.requestAdvisorAction({ candidates, personality, event });
    if (action) return action;
    return this.fallback.chooseAction({ candidates, personality });
  }

  advisorUserPrompt({ candidates, personality, event }) {
    const brief = event ? { id: event.id, phase: event.phase, roundsRemaining: event.roundsRemaining, effects: event.effects } : null;
    return JSON.stringify({ personality, event: brief, candidates });
  }

  advisorRequestPayload(context) {
    return {
      model: this.model,
      temperature: 0,
      max_tokens: 80,
      messages: [
        { role: 'system', content: 'You are a Poorup strategy advisor. Choose exactly one candidate action id. Return JSON only: {"actionId":"...","confidence":0-1,"reasonCode":"..."}. Never invent actions, money, dice, ownership, or rules.' },
        { role: 'user', content: this.advisorUserPrompt(context) }
      ]
    };
  }

  // A single LLM negotiation attempt; null means "fall back to heuristics".
  async requestAdvisorAction(context) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.apiKey },
        signal: controller.signal,
        body: JSON.stringify(this.advisorRequestPayload(context))
      });
      if (!response?.ok) {
        console.error('DeepSeekAdvisor API response not OK:', response?.status);
        return null;
      }
      return this.parseAdvisorPayload(await response.json(), context.candidates);
    } catch (error) {
      console.error('DeepSeekAdvisor API call failed:', error);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  parseAdvisorPayload(json, candidates) {
    const content = json?.choices?.[0]?.message?.content;
    const parsed = typeof content === 'string' ? JSON.parse(content.trim()) : content;
    return parseAdvisorResponse(parsed, candidates);
  }
}

export function createBotAdvisor(env = process.env) {
  if (env?.POORUP_BOT_ADVISOR === 'deepseek' && env.DEEPSEEK_API_KEY) {
    return new DeepSeekAdvisor({
      apiKey: env.DEEPSEEK_API_KEY,
      endpoint: env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions',
      model: env.DEEPSEEK_MODEL || 'deepseek-chat'
    });
  }
  return new DeterministicAdvisor();
}
