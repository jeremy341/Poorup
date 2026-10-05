import { esc } from "./clientDom.js";

const seasonCueRoots = new WeakSet();

function updateSeasonScrollCue(root) {
  const panel = root.querySelector(".rankings-context .season-panel");
  const grid = panel?.querySelector(".season-panel-grid");
  if (!panel || !grid) return;

  const scrollable = grid.scrollHeight > grid.clientHeight + 1;
  let cue = panel.querySelector("[data-season-scroll-cue]");
  if (!cue) {
    cue = document.createElement("span");
    cue.className = "t-micro ink-3 season-scroll-cue";
    cue.dataset.seasonScrollCue = "true";
    cue.setAttribute("aria-hidden", "true");
    cue.textContent = "SCROLL INSIDE TO VIEW MORE REWARDS";
    panel.append(cue);
  }

  panel.classList.toggle("is-scrollable", scrollable);
  grid.setAttribute("aria-label", "Season placements and rewards. Scroll within this panel to see all entries.");
  cue.hidden = !scrollable;
  if (scrollable) grid.setAttribute("tabindex", "0");
  else grid.removeAttribute("tabindex");
}

function observeSeasonScrollCue(root) {
  const scheduleUpdate = () => requestAnimationFrame(() => updateSeasonScrollCue(root));
  scheduleUpdate();
  if (seasonCueRoots.has(root)) return;

  seasonCueRoots.add(root);
  window.addEventListener("resize", scheduleUpdate, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleUpdate, { passive: true });
}

function rankingSearchBand({ surfaceKey, pageSurface, expanded, query, results }) {
  const searchExpanded = pageSurface && expanded === true;
  const band = document.createElement("section");
  band.className = `rankings-search-band panel noise${pageSurface ? " is-search-collapsible" : ""}${searchExpanded ? " is-search-open" : ""}`;
  band.innerHTML = `${pageSurface ? `<button class="btn-dark rankings-search-toggle" type="button" data-ranking-search-toggle aria-controls="rankings-${surfaceKey}-search-form" aria-expanded="${searchExpanded}"><span class="t-label f11">FIND A PLAYER</span><span class="t-micro ink-3">${searchExpanded ? "CLOSE" : "OPEN"}</span></button>` : ""}<form class="rankings-search" id="rankings-${surfaceKey}-search-form" data-ranking-search-form><div class="rankings-search-field"><label class="rankings-search-label" for="rankings-${surfaceKey}-search"><span class="t-micro g400">FIND A PLAYER</span></label><div class="rankings-search-controls"><input class="field" id="rankings-${surfaceKey}-search" name="ranking-username" data-ranking-search-input autocomplete="off" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" placeholder="EXACT USERNAME…" value="${esc(query || "")}" aria-describedby="rankings-${surfaceKey}-search-help"><button class="btn-dark rankings-search-submit" type="submit"><span class="t-label f11">FIND</span></button></div><span class="t-micro ink-3" id="rankings-${surfaceKey}-search-help">Exact username lookup · public identity only</span></div><div class="rankings-search-results">${results}</div></form>`;
  return band;
}

export function mountResponsiveRankingControls(root, options) {
  const { pageSurface, surfaceKey, expanded, query, results } = options;
  root.querySelector(".rankings-search-slot")?.replaceWith(rankingSearchBand({ surfaceKey, pageSurface, expanded, query, results }));
  if (pageSurface) observeSeasonScrollCue(root);
}
