// LOBBY SETTINGS HELPERS: setting-value validation and stepper bounds for the lobby rail.
import { clamp } from "./clientDom.js";
import { state } from "./clientState.js";

function isStepperEnabled(stepBtn) {
  if (!stepBtn) return false;
  return !stepBtn.disabled;
}

function stepperLimits(key) {
  if (key === "maxPlayers") return [2, state.settings.boardVariant === "metro-52" ? 6 : 4];
  if (key === "bots") return [0, Math.max(0, Number(state.settings.maxPlayers) - 1)];
  return [0, 999];
}

function clampBotsToSeats() {
  state.settings.bots = clamp(Number(state.settings.bots) || 0, 0, Math.max(0, state.settings.maxPlayers - 1));
}

const NUMERIC_SETTING_KEYS = ["startingCash"];

function numericSettingValue(value) {
  if (typeof value !== "string" || value.trim() === "") return { valid: false };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return { valid: false };
  return { valid: true, value: Math.floor(parsed) };
}

export function normalizeSettingValue({ key, value, checked, inputType } = {}) {
  if (key === "houseLimit" || key === "hotelLimit") return { valid: false };
  if (NUMERIC_SETTING_KEYS.includes(key)) return numericSettingValue(value);
  return { valid: true, value: inputType === "checkbox" ? checked : value };
}

function isSettingField(el) {
  if (!el) return false;
  if (el.tagName === "SELECT") return true;
  return el.matches("input[data-setting]");
}

export { isStepperEnabled, stepperLimits, clampBotsToSeats, isSettingField };
