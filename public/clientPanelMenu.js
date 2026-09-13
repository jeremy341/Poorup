/* ============================================================
   PANEL MENU: explicit, reversible visibility controls for the two rails.
   Critical turn state stays visible; this surface only changes presentation.
   ============================================================ */
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";

let returnFocus = null;
const PANEL_PREF_KEY = "poorup-panel-visibility-v1";

function defaults() {
  return { players: true, chat: true, rightRail: true, hud: "full" };
}

function loadSavedVisibility() {
  if (state.panelVisibilityLoaded) return;
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_PREF_KEY) || "null");
    if (saved && typeof saved === "object") state.panelVisibility = { ...state.panelVisibility, ...saved };
  } catch { /* storage unavailable or malformed; use safe defaults */ }
  state.panelVisibilityLoaded = true;
}

function normalizeVisibility() {
  state.panelVisibility = { ...defaults(), ...(state.panelVisibility || {}) };
  if (!["full", "compact"].includes(state.panelVisibility.hud)) state.panelVisibility.hud = "full";
  if (!state.panelVisibility.players && !state.panelVisibility.chat) state.panelVisibility.chat = true;
  return state.panelVisibility;
}

function visibility() {
  loadSavedVisibility();
  return normalizeVisibility();
}

function applyLeftRailClasses(next) {
  $(".rail-left")?.classList.toggle("is-panel-hidden", !next.players && !next.chat);
  $(".rail-left")?.classList.toggle("is-players-hidden", !next.players);
  $(".rail-left")?.classList.toggle("is-chat-hidden", !next.chat);
  $("#view-game")?.classList.toggle("is-left-rail-hidden", !next.players && !next.chat);
}

function applyRightRailClasses(next) {
  $("#right-rail-game")?.classList.toggle("is-panel-hidden", !next.rightRail);
  $("#view-game")?.classList.toggle("is-right-rail-hidden", !next.rightRail);
}

function applyRailClasses(next) {
  applyLeftRailClasses(next);
  applyRightRailClasses(next);
}

function applyHudDensity(next) {
  $("#hud")?.classList.toggle("is-compact", next.hud === "compact");
}

function syncPanelControls(next) {
  const players = $("[data-panel-toggle=players]");
  const chat = $("[data-panel-toggle=chat]");
  const rightRail = $("[data-panel-toggle=rightRail]");
  if (players) players.checked = next.players;
  if (chat) chat.checked = next.chat;
  if (rightRail) rightRail.checked = next.rightRail;
  const density = $("#panel-hud-density");
  if (density) density.value = next.hud;
}

export function applyPanelVisibility() {
  const next = visibility();
  applyRailClasses(next);
  applyHudDensity(next);
  syncPanelControls(next);
}

function persistVisibility() {
  try { localStorage.setItem(PANEL_PREF_KEY, JSON.stringify(visibility())); } catch { /* storage unavailable */ }
}

export function renderPanelMenu() {
  applyPanelVisibility();
  persistVisibility();
  const menu = $("#panel-menu");
  const trigger = $("#panels-btn");
  if (!menu || !trigger) return;
  const open = menu.classList.contains("is-open");
  menu.classList.toggle("is-hidden", !open);
  menu.setAttribute("aria-hidden", String(!open));
  trigger.setAttribute("aria-expanded", String(open));
}

export function isPanelMenuOpen() {
  return Boolean($("#panel-menu")?.classList.contains("is-open"));
}

export function closePanelMenu({ restore = true } = {}) {
  const menu = $("#panel-menu");
  if (!menu) return;
  menu.classList.remove("is-open");
  menu.classList.add("is-hidden");
  menu.setAttribute("aria-hidden", "true");
  $("#panels-btn")?.setAttribute("aria-expanded", "false");
  if (restore && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  returnFocus = null;
}

export function openPanelMenu(trigger = null) {
  const menu = $("#panel-menu");
  if (!menu) return;
  if (trigger instanceof HTMLElement) returnFocus = trigger;
  // Opening the panel menu only reveals visibility controls; it never changes
  // game state or moves the board.
  menu.classList.remove("is-hidden");
  menu.classList.add("is-open");
  menu.setAttribute("aria-hidden", "false");
  $("#panels-btn")?.setAttribute("aria-expanded", "true");
  applyPanelVisibility();
  requestAnimationFrame(() => menu.querySelector("[data-panel-toggle]")?.focus({ preventScroll: true }));
}

function onPanelToggle(event) {
  const input = event.target.closest("[data-panel-toggle]");
  if (!input) return;
  const key = input.dataset.panelToggle;
  if (!(key in visibility()) || key === "hud") return;
  state.panelVisibility[key] = input.checked;
  // Never leave both player/chat surfaces unavailable on narrow screens: the
  // menu can hide either one, but a minimal table context remains visible.
  if (!state.panelVisibility.players && !state.panelVisibility.chat) {
    state.panelVisibility.chat = true;
    const chat = $("[data-panel-toggle=chat]");
    if (chat) chat.checked = true;
  }
  applyPanelVisibility();
  persistVisibility();
}

function onDensityChange(event) {
  if (event.target.id !== "panel-hud-density") return;
  state.panelVisibility.hud = event.target.value === "compact" ? "compact" : "full";
  applyPanelVisibility();
  persistVisibility();
}

export function bindPanelMenu() {
  const trigger = $("#panels-btn");
  const menu = $("#panel-menu");
  if (!trigger || !menu) return;
  trigger.addEventListener("click", () => isPanelMenuOpen() ? closePanelMenu() : openPanelMenu(trigger));
  $("#panel-menu-close")?.addEventListener("click", () => closePanelMenu());
  document.addEventListener("click", event => {
    if (!isPanelMenuOpen()) return;
    if (menu.contains(event.target) || trigger.contains(event.target)) return;
    closePanelMenu({ restore: false });
  });
  menu.addEventListener("change", onPanelToggle);
  menu.addEventListener("change", onDensityChange);
  renderPanelMenu();
}
