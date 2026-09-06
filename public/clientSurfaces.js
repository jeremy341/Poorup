/* ============================================================
   SHARED SURFACE / DIALOG CONTROLLER: keep every blocking
   surface keyboard-safe without coupling the game state machine
   to a particular modal implementation. parlorNotice is injected
   by the entry module for the table-notice throttle.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { hydrateSprites } from "./clientSprites.js";
import { state } from "./clientState.js";

const SURFACE_SELECTORS = [
  "#rooms-modal", "#account-modal", "#confirm-modal", "#achievement-modal", "#rankings-modal", "#social-modal", "#player-modal", "#setup-wrap", "#popup", "#trade-modal", "#choice-modal",
  "#auction-modal", "#offer-modal", "#deed-modal", "#financing-modal", "#bankruptcy-modal",
  "#card-modal", "#card-gallery", "#gameover-modal",
];

/* Table popups belong only to a live game — blocked while parked at parlor home. */
const GAME_POPUP = new Set([
  "#popup", "#deed-modal", "#card-modal", "#choice-modal", "#offer-modal", "#trade-modal",
  "#auction-modal", "#financing-modal", "#gameover-modal", "#bankruptcy-modal",
]);
let nextTableNoticeAt = 0;
let surfaceReturnFocus = null;
const surfaceInertNodes = new Set();
let pendingConfirmation = null;
let notice = () => {};

export function configureSurfaces(hooks) {
  notice = hooks.notice;
}

export function setSurfaceReturnFocus(el) {
  surfaceReturnFocus = el;
}

export function visibleSurfaces() {
  return SURFACE_SELECTORS
    .map((selector) => $(selector))
    .filter((el) => el && !el.classList.contains("is-hidden"));
}

export function surfaceFocusable(surface) {
  return [...surface.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((el) => !el.closest(".is-hidden") && el.getAttribute("aria-hidden") !== "true");
}

function resetInertNodes() {
  surfaceInertNodes.forEach((node) => { node.inert = false; });
  surfaceInertNodes.clear();
}

function inertNode(node, active) {
  if (!node) return;
  if (node === active) return;
  node.inert = true;
  surfaceInertNodes.add(node);
}

function markSurfaceAria(el) {
  const hidden = el.classList.contains("is-hidden");
  el.setAttribute("aria-hidden", String(hidden));
  if (hidden) return;
  el.setAttribute("aria-modal", "true");
}

function inertOtherViews(active) {
  if (!active) return;
  document.querySelectorAll(".view").forEach((view) => {
    if (view.contains(active)) return;
    inertNode(view, active);
  });
}

function inertSiblings(node, active) {
  [...node.parentElement.children].forEach((sibling) => {
    if (sibling === node) return;
    if (sibling.contains(active)) return;
    inertNode(sibling, active);
  });
}

function isView(node) {
  return Boolean(node.classList?.contains("view"));
}

function inertAncestorSiblings(active) {
  if (!active) return;
  let node = active;
  while (node.parentElement) {
    inertSiblings(node, active);
    node = node.parentElement;
    if (isView(node)) break;
  }
}

export function syncSurfaceA11y() {
  const visible = visibleSurfaces();
  const active = visible.at(-1) || null;
  resetInertNodes();
  SURFACE_SELECTORS.forEach((selector) => {
    const el = $(selector);
    if (el) markSurfaceAria(el);
  });
  inertOtherViews(active);
  inertAncestorSiblings(active);
  return active;
}

function tableNoticeThrottled() {
  if (Date.now() < nextTableNoticeAt) return false;
  nextTableNoticeAt = Date.now() + 8000;
  return true;
}

function blockedAsGamePopup(selector) {
  if (!GAME_POPUP.has(selector)) return false;
  if (state.phase !== "home") return false;
  if (tableNoticeThrottled()) {
    notice("TABLE NOTICE", "That notice belongs to the table — it can be opened during a game.");
  }
  return true;
}

function rememberReturnFocus() {
  if (visibleSurfaces().length) return;
  if (document.activeElement instanceof HTMLElement) surfaceReturnFocus = document.activeElement;
}

function preferredFocusable(surface, preferred) {
  if (preferred && !preferred.disabled) return preferred;
  return surfaceFocusable(surface)[0];
}

function focusPreferred(surface, focusSelector) {
  const preferred = focusSelector ? surface.querySelector(focusSelector) : null;
  const target = preferredFocusable(surface, preferred);
  target?.focus({ preventScroll: true });
}

export function openSurface(selector, focusSelector) {
  if (blockedAsGamePopup(selector)) return;
  const surface = $(selector);
  if (!surface) return;
  const wasVisible = !surface.classList.contains("is-hidden");
  rememberReturnFocus();
  surface.classList.remove("is-hidden");
  surface.setAttribute("aria-hidden", "false");
  syncSurfaceA11y();
  if (wasVisible) return;
  requestAnimationFrame(() => focusPreferred(surface, focusSelector));
}

function restoreReturnFocus() {
  if (!surfaceReturnFocus) return;
  if (!document.contains(surfaceReturnFocus)) return;
  surfaceReturnFocus.focus({ preventScroll: true });
  surfaceReturnFocus = null;
}

export function closeSurface(selector) {
  const surface = $(selector);
  if (!surface) return;
  surface.classList.add("is-hidden");
  surface.setAttribute("aria-hidden", "true");
  const active = syncSurfaceA11y();
  if (active) {
    surfaceFocusable(active)[0]?.focus({ preventScroll: true });
    return;
  }
  restoreReturnFocus();
}

export function closeAllSurfaces() {
  pendingConfirmation = null;
  SURFACE_SELECTORS.forEach((selector) => {
    const surface = $(selector);
    if (surface) {
      surface.classList.add("is-hidden");
      surface.setAttribute("aria-hidden", "true");
    }
  });
  syncSurfaceA11y();
  surfaceReturnFocus = null;
}

export function focusSurface(selector, focusSelector) {
  const surface = $(selector);
  if (!surface) return;
  if (surface.classList.contains("is-hidden")) return;
  requestAnimationFrame(() => focusPreferred(surface, focusSelector));
}

/**
 * Poorup-styled confirmation surface. Keep destructive actions inside the
 * shared dialog controller so they inherit focus trapping, Escape handling,
 * inert background behaviour, and focus restoration.
 */
export function openConfirmModal({ title = "Confirm action", message = "", confirmLabel = "CONFIRM", onConfirm } = {}) {
  const card = $("#confirm-card");
  if (!card) return;
  pendingConfirmation = typeof onConfirm === "function" ? onConfirm : null;
  card.innerHTML = `
    <div class="confirm-body">
      <div class="confirm-head">
        <div>
          <div class="t-micro red">CONFIRM ACTION</div>
          <h2 class="t-section g100" id="confirm-title">${esc(title)}</h2>
        </div>
        <span data-sprite="diamond" data-size="3" aria-hidden="true"></span>
      </div>
      <p class="t-body ink-2 confirm-message" id="confirm-description">${esc(message)}</p>
      <div class="confirm-actions">
        <button class="btn-dark" type="button" id="confirm-cancel"><span class="t-label f11">CANCEL</span></button>
        <button class="cta-red" type="button" id="confirm-accept"><span class="cta-text cta-text-sm">${esc(confirmLabel)}</span></button>
      </div>
    </div>`;
  hydrateSprites(card);
  openSurface("#confirm-modal", "#confirm-cancel");
  $("#confirm-scrim")?.addEventListener("click", closeConfirmModal);
  $("#confirm-cancel")?.addEventListener("click", closeConfirmModal);
  $("#confirm-accept")?.addEventListener("click", () => {
    const action = pendingConfirmation;
    pendingConfirmation = null;
    closeSurface("#confirm-modal");
    action?.();
  });
}

export function closeConfirmModal() {
  pendingConfirmation = null;
  closeSurface("#confirm-modal");
}
