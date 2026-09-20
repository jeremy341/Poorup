/* ============================================================
   KEYBOARD: the single window "keydown" controller. Night-shift
   chords, the surface focus trap, the ordered modal Escape gate
   chain, and the KEY_ACTIONS shortcuts. Game-bound handlers are
   injected by the entry module; surface and drawer helpers are
   imported directly.
   ============================================================ */
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import {
  syncSurfaceA11y,
  surfaceFocusable,
  visibleSurfaces,
  closeSurface,
  closeConfirmModal,
} from "./clientSurfaces.js";
import {
  isLogDrawerOpen,
  closeLogDrawer,
  toggleLogDrawerFromKey,
} from "./clientLogDrawer.js";

let host = {};

function modalOpen(selector) {
  return !$(selector).classList.contains("is-hidden");
}

function typingTag(target) {
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return true;
  if (target?.isContentEditable) return true;
  return Boolean(target?.closest?.("button, [role=button], [role=tab], [role=menuitem], [contenteditable=true]"));
}

function editableTarget(target) {
  if (typingTag(target)) return true;
  return Boolean(target?.isContentEditable);
}

function pressedKey(event) {
  return String(event.key || "").toLowerCase();
}

function modifierMask(event) {
  const ctrl = event.ctrlKey ? "c" : "";
  const meta = event.metaKey ? "m" : "";
  const alt = event.altKey ? "a" : "";
  const shift = event.shiftKey ? "s" : "";
  return `${ctrl}${meta}${alt}${shift}`;
}

function keyChord(event, key, mods) {
  if (pressedKey(event) !== key) return false;
  return modifierMask(event) === mods;
}

function preventEscape(event) {
  event.preventDefault();
}

function handleCtrlNightShift(event, homeVisible) {
  if (!homeVisible) return false;
  if (state.phase !== "home") return false;
  if (!keyChord(event, "p", "c")) return false;
  if (typingTag(event.target)) return false;
  if (visibleSurfaces().length) return false;
  event.preventDefault();
  host.startNightShift();
  return true;
}

function handleShiftNightShift(event, homeVisible) {
  if (state.phase !== "home") return false;
  if (host.isNightShiftActive()) return false;
  if (!keyChord(event, "p", "s")) return false;
  if (editableTarget(event.target)) return false;
  event.preventDefault();
  if (!homeVisible || visibleSurfaces().length) host.goHome();
  host.startNightShift();
  return true;
}

function cyclicIndex(index, length, shift) {
  if (!shift) return index === length - 1 ? 0 : index + 1;
  return index <= 0 ? length - 1 : index - 1;
}

function handleSurfaceTab(event, activeSurface) {
  const focusables = surfaceFocusable(activeSurface);
  if (!focusables.length) {
    event.preventDefault();
    return;
  }
  const index = focusables.indexOf(document.activeElement);
  const next = focusables[cyclicIndex(index, focusables.length, event.shiftKey)];
  event.preventDefault();
  next.focus({ preventScroll: true });
}

function handleTabNavigation(event) {
  if (event.defaultPrevented) return false;
  const tab = event.target?.closest?.('[role="tab"]');
  const list = tab?.closest?.('[role="tablist"]');
  if (!tab || !list) return false;
  const tabs = [...list.querySelectorAll('[role="tab"]:not([disabled])')];
  const current = tabs.indexOf(tab);
  if (current < 0) return false;
  let nextIndex;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (current + 1) % tabs.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (current - 1 + tabs.length) % tabs.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  else return false;
  event.preventDefault();
  tabs[nextIndex].focus({ preventScroll: true });
  tabs[nextIndex].click();
  return true;
}

function handleNightShiftOpen(event) {
  const nightShiftOpen = !$("#night-shift").classList.contains("is-hidden");
  if (!nightShiftOpen) return false;
  if (event.key === "Escape") {
    event.preventDefault();
    host.stopNightShift();
    return true;
  }
  return event.key !== "Tab";
}

/* Ordered blocking-surface gates: while one is open it consumes
   every key; Escape runs its closer. Identical order to the old
   if-chain so precedence is preserved. */
const ESCAPE_GATES = [
  { visible: () => modalOpen("#account-modal"), escape: () => host.closeAccountModal() },
  { visible: () => modalOpen("#confirm-modal"), escape: () => closeConfirmModal() },
  { visible: () => modalOpen("#achievement-modal"), escape: () => host.closeAchievementModal() },
  { visible: () => modalOpen("#rankings-modal"), escape: () => closeSurface("#rankings-modal") },
  { visible: () => modalOpen("#social-modal"), escape: () => closeSurface("#social-modal") },
  { visible: () => modalOpen("#player-modal"), escape: () => closeSurface("#player-modal") },
  { visible: () => modalOpen("#financing-modal"), escape: () => host.closeFinancingModal() },
  { visible: () => modalOpen("#wallet-modal"), escape: () => host.closeWalletModal() },
  { visible: () => modalOpen("#market-modal"), escape: () => host.closeMarketDesk() },
  { visible: () => modalOpen("#casino-modal"), escape: () => host.closeCasinoDesk() },
  { visible: () => modalOpen("#sponsorship-modal"), escape: () => host.closeSponsorshipModal() },
  { visible: () => modalOpen("#deal-detail-modal"), escape: () => host.closeDealDetails() },
  { visible: () => modalOpen("#card-gallery"), escape: () => host.closeCardGallery() },
  { visible: () => Boolean(state.auction), escape: preventEscape },
];

const LATER_GATES = [
  { visible: () => modalOpen("#rooms-modal"), escape: () => host.closeRoomsModal() },
  { visible: () => Boolean(state.profileDraft), escape: () => host.closeProfileEditor(false) },
  { visible: () => modalOpen("#offer-modal"), escape: () => host.closeOfferWithoutResponse() },
  { visible: () => cardModalOpen(), escape: () => closeCardModal() },
  { visible: () => gameOverOpen(), escape: preventEscape },
  { visible: () => state.deedDetail != null, escape: () => host.closeDeedDetail() },
  { visible: () => Boolean(state.tradeWith), escape: () => host.closeTradeModal() },
  { visible: () => Boolean(state.selectedTile), escape: () => host.closePopup() },
];

const TOP_SURFACE_ESCAPE = {
  "account-modal": () => host.closeAccountModal(),
  "confirm-modal": () => closeConfirmModal(),
  "achievement-modal": () => host.closeAchievementModal(),
  "rankings-modal": () => closeSurface("#rankings-modal"),
  "social-modal": () => closeSurface("#social-modal"),
  "player-modal": () => closeSurface("#player-modal"),
  "financing-modal": () => host.closeFinancingModal(),
  "wallet-modal": () => host.closeWalletModal(),
  "market-modal": () => host.closeMarketDesk(),
  "casino-modal": () => host.closeCasinoDesk(),
  "sponsorship-modal": () => host.closeSponsorshipModal(),
  "deal-detail-modal": () => host.closeDealDetails(),
  "card-gallery": () => host.closeCardGallery(),
  "card-modal": () => closeCardModal(),
  "rooms-modal": () => host.closeRoomsModal(),
  "setup-wrap": () => host.goHome(),
  "deed-modal": () => host.closeDeedDetail(),
  "trade-modal": () => host.closeTradeModal(),
  "popup": () => host.closePopup(),
  "choice-modal": () => closeSurface("#choice-modal"),
  "auction-modal": () => closeSurface("#auction-modal"),
  "gameover-modal": preventEscape,
  "bankruptcy-modal": () => closeSurface("#bankruptcy-modal"),
  "log-drawer": () => closeLogDrawer(),
};

function cardModalOpen() {
  return modalOpen("#card-modal");
}

function closeCardModal() {
  state.card = null;
  closeSurface("#card-modal");
}

function gameOverOpen() {
  if (state.gameOver) return true;
  return modalOpen("#gameover-modal");
}

function consumeGate(event, gate) {
  if (!gate.visible()) return false;
  if (event.key === "Escape") gate.escape(event);
  return true;
}

function handlePendingBuy(event) {
  if (state.pendingBuyTile == null) return false;
  if (state.settings.auction) {
    if (event.key === "Escape") event.preventDefault();
    return true;
  }
  if (event.key === "Escape") {
    closeSurface("#choice-modal");
    return true;
  }
  return modalOpen("#choice-modal");
}

function handleDrawerEscape(event) {
  if (event.key !== "Escape") return false;
  if (!isLogDrawerOpen()) return false;
  closeLogDrawer();
  return true;
}

function handleSetupEscape(event) {
  if (event.key !== "Escape") return false;
  if (state.phase !== "setup") return false;
  event.preventDefault();
  host.goHome();
  return true;
}

function consumeGates(event, gates) {
  for (const gate of gates) {
    if (consumeGate(event, gate)) return true;
  }
  return false;
}

function handleModalEscape(event) {
  if (event.key === "Escape" && host.isPanelMenuOpen?.()) {
    event.preventDefault();
    host.closePanelMenu();
    return true;
  }
  if (handleSetupEscape(event)) return true;
  const top = visibleSurfaces().at(-1);
  const closeTop = top ? TOP_SURFACE_ESCAPE[top.id] : null;
  if (closeTop) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeTop();
    }
    return true;
  }
  if (consumeGates(event, ESCAPE_GATES)) return true;
  if (handlePendingBuy(event)) return true;
  if (consumeGates(event, LATER_GATES)) return true;
  return handleDrawerEscape(event);
}

/* KEY_ACTIONS: shortcuts available once no surface owns the key. */
const HOME_KEYS = {
  b: () => {
    host.setHomeTab("rooms");
    host.openRoomsModal("browse");
  },
  c: () => host.openRoomsModal("create"),
  p: () => host.openProfileEditor("home"),
  j: () => host.openRoomsModal("join"),
};

function handleHomeKeys(event) {
  const action = HOME_KEYS[pressedKey(event)];
  if (!action) return false;
  if (state.phase !== "home") return false;
  event.preventDefault();
  action();
  return true;
}

function handleTurnKey(event) {
  if (event.code === "Space" || pressedKey(event) === "r") {
    if (state.phase !== "playing") return;
    event.preventDefault();
    host.primaryTurnAction();
  }
}

function handleGameShortcuts(event, target) {
  if (typingTag(target)) return;
  if (handleHomeKeys(event)) return;
  if (pressedKey(event) === "l") {
    event.preventDefault();
    toggleLogDrawerFromKey();
    return;
  }
  handleTurnKey(event);
}

function onKeyDown(event) {
  const target = event.target;
  const homeVisible = !$("#view-home").classList.contains("is-hidden");
  if (handleCtrlNightShift(event, homeVisible)) return;
  if (handleShiftNightShift(event, homeVisible)) return;
  const activeSurface = syncSurfaceA11y();
  if (event.key === "Tab" && activeSurface) {
    handleSurfaceTab(event, activeSurface);
    return;
  }
  if (handleTabNavigation(event)) return;
  if (handleNightShiftOpen(event)) return;
  if (handleModalEscape(event)) return;
  handleGameShortcuts(event, target);
}

export function bindKeyboard(hooks) {
  host = hooks;
  window.addEventListener("keydown", onKeyDown);
}
