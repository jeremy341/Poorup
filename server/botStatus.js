// The bot-provider and bot-status payloads the server broadcasts. Public fields only: credentials, quota details and raw errors stay out.

// Keep provider credentials, billing/quota details, and raw error text out
// of the room-wide event. The private match trace retains the exact reason.
const PUBLIC_FALLBACK_REASONS = new Map([
  ['no-ai-mode', 'no-ai-mode'],
  ['auction-policy', 'house-policy'],
  ['phase-resolution', 'house-policy'],
  ['deterministic-advisor', 'house-policy'],
  ['quota', 'credits-exhausted'],
  ['quota-exhausted', 'credits-exhausted'],
  ['game-budget', 'game-budget'],
  ['process-budget', 'process-budget'],
  ['circuit-open', 'provider-cooldown'],
  ['rate-limit', 'provider-cooldown']
]);

const PROVIDER_STATES = new Set(['healthy', 'unconfigured', 'quota-exhausted', 'cooldown']);
const PROVIDER_REASONS = new Set(['credits-exhausted', 'missing-credentials', 'provider-cooldown']);

export function safeBotProviderStatus(status = {}) {
  const state = PROVIDER_STATES.has(status.state) ? status.state : 'unconfigured';
  const reason = PROVIDER_REASONS.has(status.reason) ? status.reason : null;
  const revision = Number.isFinite(Number(status.revision)) ? Math.max(0, Math.floor(Number(status.revision))) : 0;
  return { state, revision, reason };
}

function legacyProviderReason(health) {
  if (health?.state === 'quota-exhausted') return 'credits-exhausted';
  if (health?.state === 'unconfigured') return 'missing-credentials';
  if (health?.state === 'open') return 'provider-cooldown';
  return null;
}

export function readBotProviderStatus(botAdvisor) {
  if (typeof botAdvisor?.getPublicStatus === 'function') return safeBotProviderStatus(botAdvisor.getPublicStatus());
  const health = typeof botAdvisor?.getHealth === 'function' ? botAdvisor.getHealth() : null;
  return safeBotProviderStatus({ state: health?.state, reason: legacyProviderReason(health), revision: 0 });
}

function publicBotFallbackReason(reason) {
  const key = String(reason || '').toLowerCase();
  if (!key) return null;
  return PUBLIC_FALLBACK_REASONS.get(key) || 'provider-unavailable';
}

export function botStatusPayload(botAdvisor, room, bot, state, details) {
  const health = typeof botAdvisor.getHealth === 'function' ? botAdvisor.getHealth() : null;
  return {
    playerId: bot.id,
    nickname: bot.nickname,
    state,
    brain: details.brain || room.settings.botBrain || 'auto',
    difficulty: details.difficulty || room.settings.botDifficulty || 'table',
    provider: details.provider === 'ai' ? 'ai' : 'deterministic',
    fallback: details.fallback === true,
    fallbackReason: publicBotFallbackReason(details.fallbackReason),
    actionId: details.actionId || null,
    decisionSequence: details.sequence || details.decisionSequence || null,
    latencyMs: details.latencyMs || 0,
    healthState: health?.state === 'healthy' ? 'ready' : 'fallback'
  };
}
