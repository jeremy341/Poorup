/* ============================================================
   LOG DRAWER: the slide-out game log with its text filters.
   Owns the drawer filter selection and rendering; the entry
   module keeps the click bindings that feed it.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { focusSurface, syncSurfaceA11y } from "./clientSurfaces.js";

let drawerFilter = "all";
let renderedLogSignature = "";

function matchesLogFilter(line, filter) {
  if (filter === "all") return true;
  if (filter === "cash") return /\$|BOUGHT|RENT|PAID|COLLECT|TAX|CASH/i.test(line);
  if (filter === "trade") return /TRADE|OFFER|TRADED|DECLIN|ACCEPT/i.test(line);
  if (filter === "auction") return /AUCTION|BID|WON|UNSOLD/i.test(line);
  if (filter === "property") return /BOUGHT|MORTGAG|BUILT|HOUSE|HOTEL|DEED|WENT BANKRUPT/i.test(line);
  return true;
}

function drawerLines() {
  return state.log.filter((l) => matchesLogFilter(l, drawerFilter));
}

function drawerLineHTML(line, index, total) {
  const num = String(total - index).padStart(2, "0");
  return `<p class="t-body log-line"><span class="log-n">${num} </span>${esc(line)}</p>`;
}

function markActiveFilterButtons() {
  document.querySelectorAll(".drawer-filter").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.logfilter === drawerFilter);
  });
}

export function renderLogDrawer() {
  const filtered = drawerLines();
  const empty = `<p class="t-body ink-3">NO ${drawerFilter.toUpperCase()} ENTRIES.</p>`;
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
  markActiveFilterButtons();
}

export function isLogDrawerOpen() {
  return $("#log-drawer").classList.contains("is-open");
}

function flipLogDrawer() {
  const drawer = $("#log-drawer");
  drawer.classList.toggle("is-open");
  const open = drawer.classList.contains("is-open");
  drawer.setAttribute("aria-hidden", String(!open));
  $("#log-toggle-btn")?.setAttribute("aria-expanded", String(open));
  syncSurfaceA11y();
  return open;
}

export function closeLogDrawer() {
  const drawer = $("#log-drawer");
  const restoreFocus = drawer?.contains(document.activeElement);
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  $("#log-toggle-btn")?.setAttribute("aria-expanded", "false");
  syncSurfaceA11y();
  if (restoreFocus) $("#log-toggle-btn")?.focus({ preventScroll: true });
}

export function toggleLogDrawerFromButton() {
  if (!flipLogDrawer()) return;
  renderLogDrawer();
  focusSurface("#log-drawer");
}

export function toggleLogDrawerFromKey() {
  if (flipLogDrawer()) {
    renderLogDrawer();
    focusSurface("#log-drawer", "#drawer-close");
  }
}

export function applyLogDrawerFilter(button) {
  drawerFilter = button.dataset.logfilter || "all";
  if (!isLogDrawerOpen()) return;
  renderLogDrawer();
}
