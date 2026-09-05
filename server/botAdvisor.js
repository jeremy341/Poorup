const DEFAULT_TIMEOUT_MS = 600;
const PERSONALITIES = new Set(['builder', 'shark', 'survivor', 'speculator', 'diplomat', 'chaos']);

function deterministicChoice(candidates = [], personality = 'survivor') {
  const safePersonality = PERSONALITIES.has(personality) ? personality : 'survivor';
  const scored = candidates.map(candidate => {
    let score = Number(candidate.score) || 0;
    if (safePersonality === 'builder' && candidate.kind === 'build') score += 20;
    if (safePersonality === 'survivor' && candidate.kind === 'mortgage') score += 18;
    if (safePersonality === 'speculator' && candidate.kind === 'loan') score += 16;
    if (safePersonality === 'chaos' && candidate.kind === 'roll') score += 4;
    return { candidate, score };
  }).sort((a, b) => b.score - a.score || (a.candidate.risk || 0) - (b.candidate.risk || 0));
  const selected = scored[0]?.candidate || null;
  return selected ? { actionId: selected.id, confidence: 0.55, reasonCode: 'deterministic-score', fallback: true } : null;
}

function parseAdvisorResponse(payload, candidates) {
  const actionId = typeof payload?.actionId === 'string' ? payload.actionId : '';
  const confidence = Number(payload?.confidence);
  if (!actionId || !candidates.some(candidate => candidate.id === actionId)) return null;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return {
    actionId,
    confidence,
    reasonCode: typeof payload.reasonCode === 'string' ? payload.reasonCode.slice(0, 40) : 'advisor',
    fallback: false
  };
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
