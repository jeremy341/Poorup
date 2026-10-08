export const BOT_TURN_DELAY_MS = 300;
export const BOT_AUCTION_DELAY_MS = 450;
// Prefer the whole shared roll timeline; the positional fallback supports
// legacy/simulation callers that do not carry presentation metadata.
export { BOT_MOVEMENT_STEP_MS } from '../public/gamePresentationTiming.js';
import { BOT_MOVEMENT_STEP_MS, presentationRemainingMs } from '../public/gamePresentationTiming.js';
const BOT_MOVEMENT_MAX_STEPS = 12;

export function botMovementSettleDelayMs(previousPositions, game, now = Date.now()) {
  if (game?.presentation) return presentationRemainingMs(game, now);
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
