/* ============================================================
   LOG DRAWER: the slide-out game log with its text filters.
   Owns the drawer filter selection and rendering; the entry
   module keeps the click bindings that feed it.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { focusSurface } from "./clientSurfaces.js";

let drawerFilter = "all";

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
  $("#drawer-body").innerHTML = body;
  $("#drawer-count").textContent = `${filtered.length} ENTRIES`;
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
  return open;
}

export function closeLogDrawer() {
  const drawer = $("#log-drawer");
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
}

export function toggleLogDrawerFromButton() {
  if (!flipLogDrawer()) return;
  renderLogDrawer();
  focusSurface("#log-drawer");
}

export function toggleLogDrawerFromKey() {
  if (flipLogDrawer()) renderLogDrawer();
}

export function applyLogDrawerFilter(button) {
  drawerFilter = button.dataset.logfilter || "all";
  if (!isLogDrawerOpen()) return;
  renderLogDrawer();
}
