/* ============================================================
   THEME UI: local appearance preference and keyboard-safe chooser.
   Theme selection is cosmetic and never crosses the server/game seam.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import {
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  getTheme,
  sanitizeThemeId,
  themeOptions,
} from "./clientThemeData.js";
import { pauseThemeMotion, renderTheme as renderThemeScene } from "./clientThemeRender.js";

let themeUiConfig = {
  applyTheme: renderThemeScene,
  announce: null,
};
let opener = null;
let storageListenerBound = false;
let documentListenerBound = false;
let visibilityListenerBound = false;

function defaultAnnounce(message) {
  const announcer = $("#system-announcer");
  if (announcer) announcer.textContent = message;
}

function popoverElement() {
  return $("#theme-popover");
}

function triggerElement() {
  return $("#theme-open-btn");
}

function choices() {
  return [...document.querySelectorAll("#theme-popover [data-theme-choice]")];
}

function themeChoiceMarkup(theme) {
  const selected = theme.id === state.themeId;
  return `<button class="theme-choice" type="button" role="radio" tabindex="${selected ? "0" : "-1"}" data-theme-choice="${esc(theme.id)}" aria-checked="${selected}" aria-label="${esc(theme.ariaLabel)}">
    <img src="${esc(theme.scene.page)}" alt="" width="88" height="36" aria-hidden="true">
    <span class="theme-choice-copy"><span class="t-label f11 theme-choice-name">${esc(theme.preview.heading)}</span><span class="theme-choice-description">${esc(theme.preview.copy)}</span></span>
  </button>`;
}

function popoverMarkup() {
  return `<div class="theme-popover panel noise is-hidden" id="theme-popover" role="dialog" aria-modal="false" aria-labelledby="theme-popover-title" aria-describedby="theme-popover-description" aria-hidden="true">
    <div class="theme-popover-head">
      <div><span class="t-micro g400">PARLOR LOOK</span><h2 class="t-section g100" id="theme-popover-title">Choose a world</h2></div>
      <button class="btn-dark" id="theme-popover-close" type="button" aria-label="Close theme chooser"><span class="t-label f11">CLOSE</span></button>
    </div>
    <p class="t-body ink-2 theme-popover-description" id="theme-popover-description">Change the atmosphere around the same Poorup table.</p>
    <div class="theme-choice-grid" role="radiogroup" aria-label="Parlor worlds">${themeOptions().map(themeChoiceMarkup).join("")}</div>
  </div>`;
}

function syncChoiceState() {
  choices().forEach((choice) => {
    const selected = choice.dataset.themeChoice === state.themeId;
    choice.setAttribute("aria-checked", String(selected));
    choice.setAttribute("tabindex", selected ? "0" : "-1");
  });
  const button = triggerElement();
  if (button) button.dataset.themeId = state.themeId;
}

function gridColumns() {
  const grid = $("#theme-popover .theme-choice-grid");
  if (!grid) return 1;
  const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean);
  return Math.max(1, columns.length);
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
  let popover = popoverElement();
  if (!popover) {
    host.insertAdjacentHTML("beforeend", popoverMarkup());
    popover = popoverElement();
  }
  bindPopoverEvents(popover);
  opener = triggerElement();
  state.themePopoverOpen = true;
  opener?.setAttribute("aria-expanded", "true");
  popover.classList.remove("is-hidden");
  popover.setAttribute("aria-hidden", "false");
  syncChoiceState();
  const selected = choices().findIndex((choice) => choice.dataset.themeChoice === state.themeId);
  requestAnimationFrame(() => focusChoice(selected >= 0 ? selected : 0));
}

export function closeThemePopover({ restoreFocus = true } = {}) {
  const popover = popoverElement();
  state.themePopoverOpen = false;
  triggerElement()?.setAttribute("aria-expanded", "false");
  if (popover) {
    popover.classList.add("is-hidden");
    popover.setAttribute("aria-hidden", "true");
  }
  if (restoreFocus && opener && document.contains(opener)) opener.focus({ preventScroll: true });
  opener = null;
}

function onThemeChoiceKeyDown(event) {
  if (!state.themePopoverOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeThemePopover();
    return;
  }
  const target = event.target.closest("[data-theme-choice]");
  if (!target) return;
  const list = choices();
  const index = list.indexOf(target);
  let next;
  const columns = gridColumns();
  if (event.key === "ArrowRight") next = index + 1;
  else if (event.key === "ArrowLeft") next = index - 1;
  else if (event.key === "ArrowDown") next = index + columns;
  else if (event.key === "ArrowUp") next = index - columns;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = list.length - 1;
  else return;
  const nextIndex = (next + list.length) % list.length;
  event.preventDefault();
  event.stopPropagation();
  applyThemePreference(list[nextIndex].dataset.themeChoice);
  focusChoice(nextIndex);
}

function onThemePopoverClick(event) {
  const close = event.target.closest("#theme-popover-close");
  if (close) {
    closeThemePopover();
    return;
  }
  const choice = event.target.closest("[data-theme-choice]");
  if (choice) applyThemePreference(choice.dataset.themeChoice);
}

function bindPopoverEvents(popover) {
  if (!popover || popover.dataset.bound === "true") return;
  popover.dataset.bound = "true";
  popover.addEventListener("click", onThemePopoverClick);
  popover.addEventListener("keydown", onThemeChoiceKeyDown);
}

function bindDocumentDismissal() {
  if (documentListenerBound) return;
  documentListenerBound = true;
  document.addEventListener("click", (event) => {
    if (!state.themePopoverOpen) return;
    const popover = popoverElement();
    const trigger = triggerElement();
    if (popover?.contains(event.target) || trigger?.contains(event.target)) return;
    const restoreFocus = !!(popover && document.activeElement && popover.contains(document.activeElement));
    closeThemePopover({ restoreFocus });
  });
}

function bindStorageSync() {
  if (storageListenerBound) return;
  storageListenerBound = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY || !event.newValue) return;
    applyThemePreference(event.newValue, { announce: false, animate: true, persist: false });
  });
}

export function bindThemePopover() {
  const trigger = triggerElement();
  if (trigger && trigger.dataset.themeBound !== "true") {
    trigger.dataset.themeBound = "true";
    trigger.addEventListener("click", () => {
      if (state.themePopoverOpen) closeThemePopover();
      else openThemePopover();
    });
  }
  bindPopoverEvents(popoverElement());
  bindDocumentDismissal();
  bindStorageSync();
}

export function bindThemeVisibility() {
  if (visibilityListenerBound) return;
  visibilityListenerBound = true;
  document.addEventListener("visibilitychange", () => pauseThemeMotion(document.hidden));
}

export function configureThemeUi({ applyTheme = renderThemeScene, announce = defaultAnnounce } = {}) {
  themeUiConfig = {
    applyTheme: typeof applyTheme === "function" ? applyTheme : renderThemeScene,
    announce: typeof announce === "function" ? announce : defaultAnnounce,
  };
  bindThemePopover();
}

export function initThemePreference() {
  let stored = DEFAULT_THEME_ID;
  try { stored = sanitizeThemeId(localStorage.getItem(THEME_STORAGE_KEY)); } catch { /* storage unavailable */ }
  state.themeId = stored;
  themeUiConfig.applyTheme(stored, { animate: false });
  bindThemePopover();
  return stored;
}

export function applyThemePreference(themeId, { announce = true, animate = true, persist = true } = {}) {
  const theme = getTheme(themeId);
  state.themeId = theme.id;
  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, theme.id); } catch { /* storage unavailable */ }
  }
  themeUiConfig.applyTheme(theme.id, { animate });
  syncChoiceState();
  if (announce) themeUiConfig.announce(`Parlor look changed to ${theme.name}.`);
  return theme;
}
