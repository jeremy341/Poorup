/* ============================================================
   SHORTCUT PREFERENCE: WCAG 2.1.4 (Character Key Shortcuts). The
   single-key shortcuts (B C P J L R Space) stay ON by default, and
   this per-viewer switch turns them off. Persisted in localStorage;
   every storage access is guarded so a blocked or private-mode
   browser still works for the session.
   ============================================================ */
import { $ } from "./clientDom.js";

export const SHORTCUTS_STORAGE_KEY = "poorup.shortcuts.v1";
const TOGGLE_SELECTOR = "[data-shortcut-toggle]";

function readStoredPreference() {
  try {
    return globalThis.localStorage?.getItem(SHORTCUTS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

let enabled = readStoredPreference();

export function shortcutsEnabled() {
  return enabled;
}

export function setShortcutsEnabled(next) {
  enabled = Boolean(next);
  try { globalThis.localStorage?.setItem(SHORTCUTS_STORAGE_KEY, enabled ? "on" : "off"); } catch { /* storage unavailable */ }
  syncShortcutToggles();
}

export function syncShortcutToggles() {
  document.querySelectorAll(TOGGLE_SELECTOR).forEach((button) => {
    const label = button.querySelector(".t-label");
    if (label) label.textContent = enabled ? "KEYS: ON" : "KEYS: OFF";
    button.title = enabled
      ? "Single-key shortcuts are on (B, C, P, J, L, R, Space). Click to turn them off."
      : "Single-key shortcuts are off. Click to turn them on.";
  });
}

export function bindShortcutToggles() {
  syncShortcutToggles();
  document.querySelectorAll(TOGGLE_SELECTOR).forEach((button) => {
    button.addEventListener("click", () => {
      setShortcutsEnabled(!enabled);
      const announcer = $("#system-announcer");
      if (announcer) announcer.textContent = enabled ? "Single-key shortcuts on." : "Single-key shortcuts off.";
    });
  });
}
