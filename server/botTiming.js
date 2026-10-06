export const BOT_TURN_DELAY_MS = 300;
export const BOT_AUCTION_DELAY_MS = 450;
// Keep bot turn pacing aligned with the current client walk: 300 ms per tile,
// with walks of at most 12 tiles animated instead of snapped.
export const BOT_MOVEMENT_STEP_MS = 300;
const BOT_MOVEMENT_MAX_STEPS = 12;

export function botMovementSettleDelayMs(previousPositions, game) {
  const players = game?.players;
  const boardSize = Array.isArray(game?.tiles) ? game.tiles.length : 0;
  if (!(previousPositions instanceof Map) || !Array.isArray(players) || boardSize < 1) return 0;
  let longestWalk = 0;
  for (const player of players) {
    if (!previousPositions.has(player?.id)) continue;
    const from = Number(previousPositions.get(player.id));
    const to = Number(player?.position);
    if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
    const steps = ((to - from) % boardSize + boardSize) % boardSize;
    if (steps > 0 && steps <= BOT_MOVEMENT_MAX_STEPS) longestWalk = Math.max(longestWalk, steps);
  }
  return longestWalk * BOT_MOVEMENT_STEP_MS;
}

export function scheduleBotTimer(setTimeoutFn, callback, kind = 'turn', minimumDelayMs = 0) {
  const delay = Math.max(
    kind === 'auction' ? BOT_AUCTION_DELAY_MS : BOT_TURN_DELAY_MS,
    Number.isFinite(Number(minimumDelayMs)) ? Math.max(0, Math.floor(Number(minimumDelayMs))) : 0
  );
  return setTimeoutFn(callback, delay);
}
