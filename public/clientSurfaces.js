// SHARED SURFACE / DIALOG CONTROLLER: keeps every blocking surface keyboard-safe without coupling
// the game state machine to a modal implementation. The entry module injects parlorNotice for the
// table-notice throttle.
import { $, esc, REDUCED_MOTION } from "./clientDom.js";
import { hydrateSprites } from "./clientSprites.js";
import { state } from "./clientState.js";
import { snoozeAuctionSurface } from "./clientStateSync.js";

const SURFACE_SELECTORS = [
  "#rooms-modal", "#account-modal", "#confirm-modal", "#achievement-modal", "#rankings-modal", "#social-modal", "#player-modal", "#setup-wrap", "#popup", "#trade-modal", "#deal-detail-modal", "#choice-modal", "#sponsorship-modal",
  "#auction-modal", "#offer-modal", "#deed-modal", "#financing-modal", "#bank-loan-modal", "#wallet-modal", "#flight-modal", "#market-modal", "#casino-modal", "#bankruptcy-modal",
  "#card-modal", "#card-gallery", "#gameover-modal",
];

/* Table popups belong only to a live game; blocked while parked at parlor home. */
const GAME_POPUP = new Set([
  "#popup", "#deed-modal", "#card-modal", "#choice-modal", "#offer-modal", "#trade-modal", "#deal-detail-modal",
  "#auction-modal", "#financing-modal", "#bank-loan-modal", "#wallet-modal", "#flight-modal", "#market-modal", "#casino-modal", "#sponsorship-modal", "#gameover-modal", "#bankruptcy-modal",
]);
let nextTableNoticeAt = 0;
let surfaceReturnFocus = null;
let surfaceStack = [];
const surfaceReturns = new Map();
const surfaceInertNodes = new Set();
let pendingConfirmation = null;
let notice = () => {};
let beforeUnloadBound = false;

function surfaceVisible(el) {
  if (!el) return false;
  return !el.classList.contains("is-hidden");
}

// EXIT MOTION (visual only): a closed .popup keeps `.is-closing` for one short fall-away (public/css/17-popups-rules-social-and-rankings.css
// parlor-modal-exit) while every logical state (is-hidden, aria-hidden, the stack, inert, focus) already
// reflects "closed". The closing node is inert and click-through, and reopening it cancels the exit.
export const MODAL_EXIT_MS = 130;
const MODAL_EXIT_SAFETY_MS = 60;
const closingSurfaces = new Map();

function cancelSurfaceExit(el) {
  const timer = closingSurfaces.get(el);
  if (timer === undefined) return;
  clearTimeout(timer);
  closingSurfaces.delete(el);
  el.classList.remove("is-closing");
  el.inert = false;
}

function beginSurfaceExit(el) {
  if (REDUCED_MOTION || !el.classList.contains("popup")) return;
  cancelSurfaceExit(el);
  el.classList.add("is-closing");
  el.inert = true;
  closingSurfaces.set(el, setTimeout(() => cancelSurfaceExit(el), MODAL_EXIT_MS + MODAL_EXIT_SAFETY_MS));
}

function setSurfaceHidden(el, hidden) {
  if (!el) return;
  if (!hidden) cancelSurfaceExit(el);
  el.classList.toggle("is-hidden", hidden);
  el.setAttribute("aria-hidden", String(hidden));
}

export function configureSurfaces(hooks) {
  notice = hooks.notice;
}

export function shouldConfirmSurfaceClose(selector) {
  if (selector === "#bankruptcy-modal") return true;
  if (selector === "#auction-modal") return Boolean(state.auction?.active);
  if (selector === "#choice-modal") return Boolean(state.settings?.auction && state.pendingBuyTile != null);
  if (selector === "#sponsorship-modal") return Boolean(state.sponsorship);
  return false;
}

export function hasUnresolvedSurfaceDecision() {
  return Boolean(state.pendingDebt
    || state.auction?.active
    || (state.settings?.auction && state.pendingBuyTile != null)
    || state.sponsorship);
}

export function bindBeforeUnloadGuard() {
  if (beforeUnloadBound) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  beforeUnloadBound = true;
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnresolvedSurfaceDecision()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function closeConfirmationCopy(selector) {
  if (selector === "#bankruptcy-modal") {
    return { title: "Leave this decision open?", message: "Your payment or bankruptcy decision is still required. Close without choosing and the table will keep waiting for you." };
  }
  if (selector === "#auction-modal") {
    return { title: "Leave the auction?", message: "The auction is still active. Keep this window open to keep bidding, or close it without changing your bid." };
  }
  if (selector === "#choice-modal") {
    return { title: "Leave the required choice?", message: "This auction purchase choice is still required. Close without choosing and the table will keep waiting." };
  }
  return { title: "Leave this decision open?", message: "This table action is still waiting for a decision. Close without changing it?" };
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
  )].filter((el) => !el.hidden
    && !el.closest("[hidden]")
    && !el.closest(".is-hidden")
    && !el.closest('[aria-hidden="true"]'));
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
    notice("TABLE NOTICE", "That notice belongs to the table. It can be opened during a game.");
  }
  return true;
}

function usableFocusTarget(el) {
  if (!el || el === document.body) return false;
  if (el.disabled) return false;
  if (!document.contains(el)) return false;
  // A remembered invoker can have been hidden meanwhile (view switch, closed
  // card); focusing it would silently drop focus to <body>.
  return typeof el.getClientRects !== "function" || el.getClientRects().length > 0;
}

function rememberReturnFocus() {
  if (visibleSurfaces().length) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) surfaceReturnFocus = active;
}

/** No invoker to return to: land on the HUD primary action so keyboard users
 *  keep their place at the table instead of dropping to <body>. */
function focusHudPrimaryAction() {
  if ($("#view-game")?.classList.contains("is-hidden")) return;
  const hud = $("#roll-btn");
  if (!hud || hud.disabled) return;
  hud.focus({ preventScroll: true });
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
  const trigger = options.trigger;
  if (trigger && typeof HTMLElement !== "undefined" && trigger instanceof HTMLElement && !surface.contains(trigger)) {
    setSurfaceReturnFocus(trigger);
  }
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
  const target = surfaceReturnFocus;
  surfaceReturnFocus = null;
  if (usableFocusTarget(target)) {
    target.focus({ preventScroll: true });
    return;
  }
  focusHudPrimaryAction();
}

export function closeSurface(selector, options = {}) {
  const surface = $(selector);
  if (!surface) return;
  if (!options.force && shouldConfirmSurfaceClose(selector) && surfaceVisible(surface)) {
    const copy = closeConfirmationCopy(selector);
    openConfirmModal({ ...copy, confirmLabel: "CLOSE WITHOUT ACTION", confirmTone: "neutral", onConfirm: () => closeSurface(selector, { force: true }) });
    return false;
  }
  const returnFocus = surfaceReturns.get(selector) || null;
  if (selector === "#bankruptcy-modal" && !options.resolved) state.debtRescueDismissed = true;
  // An actually-dismissed auction card stays closed for this auction: the next
  // snapshot must not reopen it and steal focus. The HUD button reopens it.
  if (selector === "#auction-modal") snoozeAuctionSurface();
  surfaceReturns.delete(selector);
  surfaceStack = surfaceStack.filter(entry => entry !== selector);
  const wasOpen = surfaceVisible(surface);
  setSurfaceHidden(surface, true);
  const active = syncSurfaceA11y();
  if (wasOpen) beginSurfaceExit(surface);
  if (active) {
    surfaceFocusable(active)[0]?.focus({ preventScroll: true });
    return;
  }
  if (usableFocusTarget(returnFocus)) {
    returnFocus.focus({ preventScroll: true });
    return;
  }
  restoreReturnFocus();
}

/** The server cleared the reason this surface existed (e.g. a paid-off debt):
 *  hide it through the shared controller so inert, aria and the surface stack
 *  are re-applied, without recording it as a player dismissal. */
export function hideSurfaceResolved(selector) {
  const surface = $(selector);
  if (!surface || !surfaceVisible(surface)) return;
  closeSurface(selector, { force: true, resolved: true });
}

export function closeAllSurfaces() {
  pendingConfirmation = null;
  surfaceStack = [];
  surfaceReturns.clear();
  // Instant semantics: no exit motion here, and any exit already in flight is dropped.
  closingSurfaces.forEach((_timer, el) => cancelSurfaceExit(el));
  SURFACE_SELECTORS.forEach((selector) => {
    const surface = $(selector);
    setSurfaceHidden(surface, true);
  });
  $("#log-drawer")?.classList.remove("is-open");
  $("#log-drawer")?.setAttribute("aria-hidden", "true");
  if ($("#log-drawer")) $("#log-drawer").inert = true;
  $("#log-toggle-btn")?.setAttribute("aria-expanded", "false");
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
export function openConfirmModal({ title = "Confirm action", message = "", confirmLabel = "CONFIRM", confirmTone = "red", onConfirm, mark = true } = {}) {
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
        ${mark ? '<span data-sprite="diamond" data-size="3" aria-hidden="true"></span>' : ""}
      </div>
      <p class="t-body ink-2 confirm-message" id="confirm-description">${esc(message)}</p>
      <div class="confirm-actions">
        <button class="btn-dark" type="button" id="confirm-cancel"><span class="t-label f11">CANCEL</span></button>
        ${confirmTone === "neutral"
          ? `<button class="btn-dark" type="button" id="confirm-accept"><span class="t-label f11">${esc(confirmLabel)}</span></button>`
          : `<button class="cta-red" type="button" id="confirm-accept"><span class="cta-text cta-text-sm">${esc(confirmLabel)}</span></button>`}
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
