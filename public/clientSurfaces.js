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
  "#log-drawer", "#rooms-modal", "#account-modal", "#confirm-modal", "#achievement-modal", "#rankings-modal", "#social-modal", "#player-modal", "#setup-wrap", "#popup", "#trade-modal", "#deal-detail-modal", "#choice-modal", "#sponsorship-modal",
  "#auction-modal", "#offer-modal", "#deed-modal", "#financing-modal", "#wallet-modal", "#market-modal", "#casino-modal", "#bankruptcy-modal",
  "#card-modal", "#card-gallery", "#gameover-modal",
];

/* Table popups belong only to a live game — blocked while parked at parlor home. */
const GAME_POPUP = new Set([
  "#popup", "#deed-modal", "#card-modal", "#choice-modal", "#offer-modal", "#trade-modal", "#deal-detail-modal",
  "#auction-modal", "#financing-modal", "#wallet-modal", "#market-modal", "#casino-modal", "#sponsorship-modal", "#gameover-modal", "#bankruptcy-modal",
]);
let nextTableNoticeAt = 0;
let surfaceReturnFocus = null;
let surfaceStack = [];
const surfaceReturns = new Map();
const surfaceInertNodes = new Set();
let pendingConfirmation = null;
let notice = () => {};

function surfaceVisible(el) {
  if (!el) return false;
  if (el.id === "log-drawer") return el.classList.contains("is-open");
  return !el.classList.contains("is-hidden");
}

function setSurfaceHidden(el, hidden) {
  if (!el) return;
  if (el.id === "log-drawer") {
    el.classList.toggle("is-open", !hidden);
  } else {
    el.classList.toggle("is-hidden", hidden);
  }
  el.setAttribute("aria-hidden", String(hidden));
}

export function configureSurfaces(hooks) {
  notice = hooks.notice;
}

export function setSurfaceReturnFocus(el) {
  surfaceReturnFocus = el;
}

export function visibleSurfaces() {
  const visible = SURFACE_SELECTORS
    .map((selector) => $(selector))
    .filter(surfaceVisible);
  return visible.sort((a, b) => {
    const aIndex = surfaceStack.indexOf("#" + a.id);
    const bIndex = surfaceStack.indexOf("#" + b.id);
    return (aIndex < 0 ? -1 : aIndex) - (bIndex < 0 ? -1 : bIndex);
  });
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
  const hidden = !surfaceVisible(el);
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

export function openSurface(selector, focusSelector, options = {}) {
  if (!options.allowHome && blockedAsGamePopup(selector)) return;
  const surface = $(selector);
  if (!surface) return;
  const wasVisible = surfaceVisible(surface);
  rememberReturnFocus();
  if (!wasVisible) {
    surfaceStack = surfaceStack.filter(entry => entry !== selector);
    surfaceStack.push(selector);
    if (surfaceReturnFocus) surfaceReturns.set(selector, surfaceReturnFocus);
    surfaceReturnFocus = null;
  }
  setSurfaceHidden(surface, false);
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
  const returnFocus = surfaceReturns.get(selector) || null;
  surfaceReturns.delete(selector);
  surfaceStack = surfaceStack.filter(entry => entry !== selector);
  setSurfaceHidden(surface, true);
  const active = syncSurfaceA11y();
  if (active) {
    surfaceFocusable(active)[0]?.focus({ preventScroll: true });
    return;
  }
  if (returnFocus && document.contains(returnFocus)) {
    returnFocus.focus({ preventScroll: true });
    return;
  }
  restoreReturnFocus();
}

export function closeAllSurfaces() {
  pendingConfirmation = null;
  surfaceStack = [];
  surfaceReturns.clear();
  SURFACE_SELECTORS.forEach((selector) => {
    const surface = $(selector);
    setSurfaceHidden(surface, true);
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
  const scrim = $("#confirm-scrim");
  const cancel = $("#confirm-cancel");
  const accept = $("#confirm-accept");
  if (scrim) scrim.onclick = closeConfirmModal;
  if (cancel) cancel.onclick = closeConfirmModal;
  if (accept) accept.onclick = () => {
    const action = pendingConfirmation;
    pendingConfirmation = null;
    closeSurface("#confirm-modal");
    action?.();
  };
}

export function closeConfirmModal() {
  pendingConfirmation = null;
  closeSurface("#confirm-modal");
}
