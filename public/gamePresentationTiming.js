// Shared, data-only timing policy used by the server and the browser.
export const DICE_ROLL_MS = 800;
export const DICE_TOTAL_ENTER_MS = 240;
export const DICE_TOTAL_PAUSE_MS = 200;
export const DICE_SHAKE_CYCLE_MS = 240;
export const HUMAN_MOVEMENT_STEP_MS = 300;
export const BOT_MOVEMENT_STEP_MS = 400;
export const LANDING_DELAY_MS = 200;
export const ROLL_LEAD_MS = DICE_ROLL_MS + DICE_TOTAL_ENTER_MS + DICE_TOTAL_PAUSE_MS;

// Accelerated walk pacing (opt-in via segment.pacing === 'accelerated'): full pace for the first
// WALK_FAST_AFTER_STEPS tiles, ~63% of it beyond that, and a longer settle on the landing tile.
// Additive and pure: the server only imports names, so existing exports are untouched. The server's
// segment durationMs/offsetMs/readyAt must adopt walkDurationMs() before the shorter walk shortens the turn.
export const WALK_FAST_AFTER_STEPS = 6;
export const WALK_FAST_RATIO = 0.63;
export const WALK_SETTLE_EXTRA_MS = 80;

export function walkStepDurationsMs(count, baseStepMs) {
  const base = Math.max(1, Number(baseStepMs) || 1);
  const fast = Math.max(1, Math.round((base * WALK_FAST_RATIO) / 10) * 10);
  const steps = Array.from({ length: Math.max(0, Math.floor(Number(count) || 0)) }, (_, index) => (index < WALK_FAST_AFTER_STEPS ? base : fast));
  if (steps.length) steps[steps.length - 1] += WALK_SETTLE_EXTRA_MS;
  return steps;
}

export function walkDurationMs(count, baseStepMs) {
  return walkStepDurationsMs(count, baseStepMs).reduce((sum, ms) => sum + ms, 0);
}

export function presentationRemainingMs(game, now = Date.now()) {
  return Math.max(0, Number(game?.presentation?.readyAt || 0) - now);
}
