// Home navigation: top-surface, home-tab, signal and rules-section click routing.
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import { leaveRoomForHome } from "./clientLobbyUi.js";
import {
  openInGameSocialSurface,
  openRankingsSurface,
  openRulesSurface,
  openSocialSurface,
  renderRulesSurface,
} from "./clientSocialSurfaces.js";
import { openProfileEditor } from "./clientProfileBindings.js";
import {
  openRoomsModal,
  renderHome,
  requestRoomsDirectory,
  setHomeTab,
} from "./clientRoomsUi.js";

let host = null;

// The view switcher stays in the entry module; navigation calls into it.
export function configureHomeNavigation(deps) {
  host = deps;
}

function onHomeNavClick(e) {
  const button = e.target.closest("[data-home-tab]");
  if (!button) return;
  const tab = button.dataset.homeTab;
  setHomeTab(tab);
  if (tab === "rooms") openRoomsModal("browse");
  if (tab === "profile") openProfileEditor("home", host.homeProfileEditTarget());
}

export function onTopSurfaceClick(button) {
  const surface = button.dataset.topSurface;
  if (openInGameSocialSurface(surface)) return;
  if (surface === "rankings") openRankingsSurface();
  else if (surface === "social") openSocialSurface();
  else if (surface === "rules") openRulesSurface();
}

export function onTopBackClick(button) {
  const target = button.dataset.topBack || "home";
  if (target === "home" && window.location.pathname === "/admin/analytics") {
    window.history.replaceState(null, "", "/");
    leaveRoomForHome();
  }
  else if (target === "home") leaveRoomForHome();
  else host.showView(target);
}

export function onHomeTabClick(button) {
  const tab = button.dataset.homeTab;
  if (tab === "profile") {
    openProfileEditor("home", host.homeProfileEditTarget());
  } else if (tab === "rooms") {
    leaveRoomForHome();
    setHomeTab("rooms");
    openRoomsModal("browse");
  } else if (tab === "play") {
    leaveRoomForHome();
    setHomeTab("play");
    renderHome();
  }
}

function onHomeSignalClick(event) {
  const signal = event.target.closest("[data-home-signal]");
  if (!signal) return;
  const kind = signal.dataset.homeSignal;
  if (kind === "entry") {
    openProfileEditor("home", host.homeProfileEditTarget());
    return;
  }
  if (kind === "sync") {
    requestRoomsDirectory();
    return;
  }
  if (kind === "lobbies") openRoomsModal("browse");
}

function onRulesSectionClick(event) {
  const chaptersToggle = event.target.closest("[data-rules-chapters-toggle]");
  if (chaptersToggle) {
    state.rulesIndexExpanded = !state.rulesIndexExpanded;
    renderRulesSurface("#rules-page-content");
    requestAnimationFrame(() => $("[data-rules-chapters-toggle]")?.focus({ preventScroll: true }));
    return;
  }
  const chapter = event.target.closest("[data-rules-section]");
  if (chapter) {
    state.rulesIndexExpanded = false;
    openRulesSurface(chapter.dataset.rulesSection);
  }
}

export function bindHomeNavigation() {
  // Home destinations. Play stays in the stage; rooms uses the existing
  // server-backed directory surface; profile keeps the current editor flow.
  $("#home-nav")?.addEventListener("click", onHomeNavClick);
  $("#home-signal-line")?.addEventListener("click", onHomeSignalClick);
  document.querySelectorAll("[data-top-surface]").forEach((button) => {
    if (button.closest("#about-page-content")) return;
    button.addEventListener("click", () => onTopSurfaceClick(button));
  });
  document.querySelectorAll("[data-top-back]").forEach((button) => {
    button.addEventListener("click", () => onTopBackClick(button));
  });
  document.querySelectorAll("[data-home-tab]").forEach((button) => {
    if (button.closest("#home-nav")) return;
    if (button.closest("#about-page-content")) return;
    button.addEventListener("click", () => onHomeTabClick(button));
  });
}

export function bindRulesPage() {
  $("#rules-page-content")?.addEventListener("click", onRulesSectionClick);
}
