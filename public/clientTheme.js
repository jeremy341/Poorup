/* ============================================================
   THEME UI: keyboard-safe, local-only parlor look selector.
   It changes atmosphere and CSS tokens only; no server payload is touched.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY, getTheme, sanitizeThemeId, themeOptions } from "./clientThemeData.js";
import { pauseThemeMotion, renderTheme } from "./clientThemeRender.js";

let themeUi = { applyTheme: renderTheme, announce: null };
let opener = null;
let bound = false;
let storageBound = false;
let visibilityBound = false;

function announce(message) {
  const live = $("#system-announcer");
  if (live) live.textContent = message;
}

function trigger() { return $("#theme-open-btn"); }
function popover() { return $("#theme-popover"); }
function choices() { return [...document.querySelectorAll("#theme-popover [data-theme-choice]")]; }

function choiceMarkup(theme) {
  const selected = theme.id === (state.themeId || DEFAULT_THEME_ID);
  return `<label class="theme-choice" data-theme-choice-label="${esc(theme.id)}">
    <input type="radio" name="poorup-theme" value="${esc(theme.id)}" data-theme-choice="${esc(theme.id)}" aria-checked="${selected}" tabindex="${selected ? "0" : "-1"}${selected ? "" : ""}" ${selected ? "checked" : ""} aria-label="${esc(theme.ariaLabel)}">
    <span class="theme-choice-art"><img src="${esc(theme.scene || "/favicon.svg")}" alt="" width="88" height="36" aria-hidden="true"></span>
    <span class="theme-choice-copy"><span class="t-label f11 theme-choice-name">${esc(theme.preview.heading)}</span><span class="theme-choice-description">${esc(theme.preview.copy)}</span></span>
  </label>`;
}

function popoverMarkup() {
  return `<div class="theme-popover panel noise is-hidden" id="theme-popover" role="dialog" aria-modal="false" aria-labelledby="theme-popover-title" aria-describedby="theme-popover-description" aria-hidden="true">
    <div class="theme-popover-head"><div><span class="t-micro g400">PARLOR LOOK</span><h2 class="t-section g100" id="theme-popover-title">Choose a world</h2></div><button class="btn-dark" id="theme-popover-close" type="button" aria-label="Close theme chooser"><span class="t-label f11">CLOSE</span></button></div>
    <p class="t-body ink-2 theme-popover-description" id="theme-popover-description">Same table. New light, weather, and neighborhood.</p>
    <div class="theme-choice-grid" role="radiogroup" aria-label="Parlor worlds">${themeOptions().map(choiceMarkup).join("")}</div>
  </div>`;
}

function syncChoiceState() {
  choices().forEach((choice) => {
    const selected = choice.value === stateThemeId();
    choice.checked = selected;
    choice.setAttribute("aria-checked", String(selected));
    choice.tabIndex = selected ? 0 : -1;
  });
  trigger()?.setAttribute("data-theme-id", stateThemeId());
}

function stateThemeId() {
  return state.themeId || DEFAULT_THEME_ID;
}

function columns() {
  const grid = $("#theme-popover .theme-choice-grid");
  if (!grid) return 1;
  return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length);
}

function nextIndex(key, index, count) {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const horizontal = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  const vertical = key === "ArrowDown" ? columns() : key === "ArrowUp" ? -columns() : 0;
  if (!horizontal && !vertical) return null;
  return (index + horizontal + vertical + count) % count;
}

function focusChoice(index) {
  const list = choices();
  if (!list.length) return;
  const next = list[(index + list.length) % list.length];
  next.focus({ preventScroll: true });
}

function openThemePopover() {
  const host = $(".profile-preferences");
  if (!host) return;
  let panel = popover();
  if (!panel) {
    host.insertAdjacentHTML("beforeend", popoverMarkup());
    panel = popover();
  }
  bindPopover(panel);
  opener = trigger();
  state.themePopoverOpen = true;
  opener?.setAttribute("aria-expanded", "true");
  panel?.classList.remove("is-hidden");
  panel?.setAttribute("aria-hidden", "false");
  syncChoiceState();
  const index = choices().findIndex((choice) => choice.value === stateThemeId());
  requestAnimationFrame(() => focusChoice(index >= 0 ? index : 0));
}

export function closeThemePopover({ restoreFocus = true } = {}) {
  const panel = popover();
  const target = opener;
  state.themePopoverOpen = false;
  trigger()?.setAttribute("aria-expanded", "false");
  panel?.classList.add("is-hidden");
  panel?.setAttribute("aria-hidden", "true");
  if (restoreFocus && target && document.contains(target)) target.focus({ preventScroll: true });
  opener = null;
}

function applyThemePreference(value, { announceChange = true, animate = true, persist = true } = {}) {
  const theme = getTheme(sanitizeThemeId(value));
  state.themeId = theme.id;
  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, theme.id); } catch { /* storage unavailable */ }
  }
  themeUi.applyTheme(theme.id, { animate });
  syncChoiceState();
  if (announceChange) themeUi.announce(`Parlor look changed to ${theme.name}.`);
  return theme;
}

function onChoiceKeyDown(event) {
  if (event.key === "Escape" && state.themePopoverOpen) {
    event.preventDefault(); event.stopPropagation(); closeThemePopover(); return;
  }
  const choice = event.target.closest("[data-theme-choice]");
  if (!choice) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault(); event.stopPropagation(); applyThemePreference(choice.value); return;
  }
  const index = choices().indexOf(choice);
  const targetIndex = nextIndex(event.key, index, choices().length);
  if (targetIndex == null) return;
  event.preventDefault(); event.stopPropagation();
  applyThemePreference(choices()[targetIndex].value);
  focusChoice(targetIndex);
}

function onPopoverChange(event) {
  const choice = event.target.closest("[data-theme-choice]");
  if (choice) applyThemePreference(choice.value);
}

function onPopoverClick(event) {
  if (event.target.closest("#theme-popover-close")) closeThemePopover();
}

function dismissFromDocument(event) {
  if (!state.themePopoverOpen) return;
  const panel = popover();
  const button = trigger();
  if (panel?.contains(event.target) || button?.contains(event.target)) return;
  const restoreFocus = Boolean(panel && document.activeElement && panel.contains(document.activeElement));
  closeThemePopover({ restoreFocus });
}

function bindPopover(panel) {
  if (!panel || panel.dataset.bound === "true") return;
  panel.dataset.bound = "true";
  panel.addEventListener("keydown", onChoiceKeyDown);
  panel.addEventListener("change", onPopoverChange);
  panel.addEventListener("click", onPopoverClick);
}

export function bindThemePopover() {
  const button = trigger();
  if (button && !bound) {
    bound = true;
    button.addEventListener("click", () => (state.themePopoverOpen ? closeThemePopover() : openThemePopover()));
  }
  bindPopover(popover());
  if (!storageBound) {
    storageBound = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== THEME_STORAGE_KEY || typeof event.newValue !== "string") return;
      applyThemePreference(event.newValue, { announceChange: false, animate: true, persist: false });
    });
  }
  if (!document.__poorupThemeDismissBound) {
    document.__poorupThemeDismissBound = true;
    document.addEventListener("click", dismissFromDocument);
  }
}

export function bindThemeVisibility() {
  if (visibilityBound) return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => pauseThemeMotion(document.hidden));
}

export function configureThemeUi({ applyTheme = renderTheme, announce: announceHook = announce } = {}) {
  themeUi = { applyTheme: typeof applyTheme === "function" ? applyTheme : renderTheme, announce: typeof announceHook === "function" ? announceHook : announce };
  bindThemePopover();
}

export function initThemePreference() {
  let saved = DEFAULT_THEME_ID;
  try { saved = sanitizeThemeId(localStorage.getItem(THEME_STORAGE_KEY)); } catch { /* storage unavailable */ }
  state.themeId = saved;
  themeUi.applyTheme(saved, { animate: false });
  bindThemePopover();
  return saved;
}
