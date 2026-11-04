// LOG DRAWER: the complete chronological event log.
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import { focusSurface, syncSurfaceA11y } from "./clientSurfaces.js";
import { applyPanelVisibility } from "./clientPanelMenu.js";
import { logLineHTML } from "./clientBoardFeed.js";

let renderedLogSignature = "";
let drawerEscapeBound = false;

function drawerLineHTML(line, index, total) {
  const num = String(total - index).padStart(2, "0");
  return `<p class="t-body log-line"><span class="log-n">${num} </span>${logLineHTML(line)}</p>`;
}

export function renderLogDrawer() {
  const filtered = state.log;
  const empty = '<p class="t-body ink-3">NO ENTRIES YET.</p>';
  const body = filtered.length
    ? filtered.map((l, i) => drawerLineHTML(l, i, filtered.length)).join("")
    : empty;
  const bodyEl = $("#drawer-body");
  const previousScrollTop = bodyEl?.scrollTop || 0;
  const wasAtBottom = !bodyEl
    || bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight <= 4;
  const nextSignature = state.log.join("\u0000");
  const logChanged = renderedLogSignature !== "" && nextSignature !== renderedLogSignature;
  if (bodyEl) {
    bodyEl.innerHTML = body;
    bodyEl.scrollTop = wasAtBottom ? bodyEl.scrollHeight : Math.min(previousScrollTop, bodyEl.scrollHeight);
  }
  const countEl = $("#drawer-count");
  if (countEl) {
    countEl.textContent = `${filtered.length} ENTRIES`;
    countEl.setAttribute("aria-live", "polite");
  }
  const foot = $("#log-drawer")?.querySelector(".log-drawer-foot");
  let statusEl = foot?.querySelector("[data-log-new-status]");
  if (!statusEl && foot) {
    statusEl = document.createElement("span");
    statusEl.className = "t-micro ink-3";
    statusEl.dataset.logNewStatus = "true";
    statusEl.setAttribute("aria-live", "polite");
    statusEl.setAttribute("aria-atomic", "true");
    foot.appendChild(statusEl);
  }
  if (statusEl) statusEl.textContent = logChanged && !wasAtBottom ? "NEW ENTRIES AVAILABLE" : "";
  renderedLogSignature = nextSignature;
}

export function isLogDrawerOpen() {
  return $("#log-drawer").classList.contains("is-open");
}

function flipLogDrawer() {
  const drawer = $("#log-drawer");
  drawer.classList.toggle("is-open");
  const open = drawer.classList.contains("is-open");
  drawer.inert = !open;
  drawer.setAttribute("aria-hidden", String(!open));
  $("#log-toggle-btn")?.setAttribute("aria-expanded", String(open));
  applyPanelVisibility();
  syncSurfaceA11y();
  return open;
}

export function closeLogDrawer() {
  const drawer = $("#log-drawer");
  const restoreFocus = drawer?.contains(document.activeElement);
  drawer.classList.remove("is-open");
  drawer.inert = true;
  drawer.setAttribute("aria-hidden", "true");
  $("#log-toggle-btn")?.setAttribute("aria-expanded", "false");
  applyPanelVisibility();
  syncSurfaceA11y();
  if (restoreFocus) $("#log-toggle-btn")?.focus({ preventScroll: true });
}

export function toggleLogDrawerFromButton() {
  if (!flipLogDrawer()) return;
  bindDrawerEscape();
  renderLogDrawer();
  revealDock();
  focusSurface("#log-drawer");
}

export function toggleLogDrawerFromKey() {
  if (flipLogDrawer()) {
    bindDrawerEscape();
    renderLogDrawer();
    revealDock();
    focusSurface("#log-drawer", "#drawer-close");
  }
}

function revealDock() {
  const drawer = $("#log-drawer");
  const bounds = drawer.getBoundingClientRect?.();
  if (!bounds) return;
  if (bounds.top < 0 || bounds.bottom > window.innerHeight) drawer.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function bindDrawerEscape() {
  if (drawerEscapeBound) return;
  drawerEscapeBound = true;
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !isLogDrawerOpen()) return;
    if (!$("#log-drawer")?.contains(document.activeElement)) return;
    closeLogDrawer();
  });
}
