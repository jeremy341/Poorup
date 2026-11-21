// Rail bindings: right-rail tabs, delegated actions and URL surface deep links.
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import { renderRightRail } from "./clientRailRender.js";
import { onRailClick, onRailSubmit } from "./clientRailEvents.js";
import { closePopup } from "./clientPopupUi.js";
import { closeFinancingModal, closeTradeModal } from "./clientTradeUi.js";
import {
  openRankingsSurface,
  openRulesSurface,
  openSocialSurface,
} from "./clientSocialSurfaces.js";

let host = null;

// Economy snapshot refresh stays in the entry module with the socket emit.
export function configureRailBindings(deps) {
  host = deps;
}

function tabNeedsEconomySnapshot() {
  return state.tab === "activity";
}

export function openSurfaceFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const route = params.get("rules") || params.get("surface");
  if (route === "book" || route === "rules") openRulesSurface();
  else if (route === "rankings") openRankingsSurface();
  else if (route === "social") openSocialSurface();
}

function onRailTabClick(e) {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  state.tab = tab.dataset.tab;
  renderRightRail();
  if (tabNeedsEconomySnapshot()) host.refreshEconomySnapshot();
}

function railTabIndex(key, index, length) {
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % length;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + length) % length;
  return -1;
}

function onRailTabKeyDown(event) {
  const tab = event.target.closest('[role="tab"]');
  if (!tab) return;
  const list = tab.parentElement;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  if (!tabs.length) return;
  const index = railTabIndex(event.key, tabs.indexOf(tab), tabs.length);
  if (index < 0) return;
  event.preventDefault();
  tabs[index].focus({ preventScroll: true });
  tabs[index].click();
}

export function bindRail() {
  $("#tabs").addEventListener("click", onRailTabClick);
  $("#tabs").addEventListener("keydown", onRailTabKeyDown);

  // Holdings, Deals, and Activity actions are delegated from the rail body.
  $("#right-rail-body").addEventListener("click", onRailClick);
  $("#right-rail-body").addEventListener("keydown", onRailTabKeyDown);
  $("#right-rail-body").addEventListener("submit", onRailSubmit);
  $("#right-rail-body").addEventListener("toggle", (event) => {
    if (event.target.matches("details.finance-bank")) state.financeBankOpen = event.target.open;
  }, true);

  $("#popup-scrim").addEventListener("click", closePopup);
  $("#trade-scrim").addEventListener("click", closeTradeModal);
  $("#financing-scrim").addEventListener("click", closeFinancingModal);
}
