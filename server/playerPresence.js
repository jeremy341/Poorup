export const IDLE_INPUT_GRACE_MS = 30_000;
export const PLAYER_INACTIVITY_REMOVAL_MS = 180_000;

const validReasons = new Set(['hidden', 'idle']);

export function markPlayerInactive(player, { reason, now, stale = false } = {}) {
  if (!player || player.isBot || stale || !validReasons.has(reason) || !Number.isFinite(now)) return player;
  const current = player.presence;
  if (current?.state === 'inactive') return player;
  return {
    ...player,
    presence: {
      state: 'inactive',
      reason,
      inactiveSince: now,
      inactiveUntil: now + PLAYER_INACTIVITY_REMOVAL_MS,
    },
  };
}

export function markPlayerActive(player) {
  if (!player || player.isBot || player.presence?.state === 'active') return player;
  return {
    ...player,
    presence: { state: 'active', inactiveSince: null, inactiveUntil: null },
  };
}

export function isPlayerPresenceExpired(player, now) {
  return Boolean(
    player &&
    !player.isBot &&
    player.presence?.state === 'inactive' &&
    Number.isFinite(player.presence.inactiveUntil) &&
    Number.isFinite(now) &&
    now >= player.presence.inactiveUntil,
  );
}
