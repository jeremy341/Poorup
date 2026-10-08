// Shared, data-only timing policy used by the server and the browser.
export const DICE_ROLL_MS = 800;
export const DICE_TOTAL_ENTER_MS = 240;
export const DICE_TOTAL_PAUSE_MS = 200;
export const DICE_SHAKE_CYCLE_MS = 240;
export const HUMAN_MOVEMENT_STEP_MS = 300;
export const BOT_MOVEMENT_STEP_MS = 400;
export const LANDING_DELAY_MS = 200;
export const MODAL_ENTER_MS = 160;
export const ROLL_LEAD_MS = DICE_ROLL_MS + DICE_TOTAL_ENTER_MS + DICE_TOTAL_PAUSE_MS;

export function presentationRemainingMs(game, now = Date.now()) {
  return Math.max(0, Number(game?.presentation?.readyAt || 0) - now);
}
