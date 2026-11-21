// RULES VIEW: the crawlable rules book renderer, chapter navigation and the
// core/folded chapter index. Rule copy itself lives in rulesSections.js.
import { $, esc } from "./clientDom.js";
import { hydrateSprites } from "./clientSprites.js";
import { state } from "./clientState.js";
import { RULES_SECTIONS } from "./rulesSections.js";

export function rulesSectionById(id) {
  return RULES_SECTIONS.find((section) => section.id === id) || RULES_SECTIONS[0];
}

function previousSection(activeIndex) {
  if (activeIndex <= 0) return null;
  return RULES_SECTIONS[activeIndex - 1];
}

function nextSection(activeIndex) {
  const last = RULES_SECTIONS.length - 1;
  if (activeIndex < 0) return null;
  if (activeIndex >= last) return null;
  return RULES_SECTIONS[activeIndex + 1];
}

function rulesPrevNav(previous) {
  const id = previous?.id || "";
  const disabled = previous ? "" : "disabled";
  const label = previous ? `PREVIOUS · ${previous.label}` : "FIRST CHAPTER";
  return { id, disabled, label };
}

function rulesNextNav(next) {
  const id = next?.id || "";
  const disabled = next ? "" : "disabled";
  const label = next ? `NEXT · ${next.label}` : "LAST CHAPTER";
  return { id, disabled, label };
}

// Every chapter stays in the DOM while only the active one is shown, so the
// client renderer keeps the whole crawlable rules book and its #rules-* anchors.
// The inactive chapters wait in one hidden block with their own heading and
// summary; the active chapter keeps the visible page heading and its content is
// not wrapped, so the reading layout is unchanged.
function rulesBookExtraHTML(active) {
  const sections = RULES_SECTIONS
    .filter((section) => section.id !== active?.id)
    .map((section) => `<section class="rules-book-section" id="rules-${section.id}" aria-labelledby="rules-${section.id}-heading"><h2 class="t-section g100" id="rules-${section.id}-heading">${section.title}</h2><p class="t-body ink-2 rules-article-summary">${section.summary}</p>${section.content}</section>`)
    .join("");
  return sections ? `<div class="rules-book-extra is-hidden">${sections}</div>` : "";
}

function rulesArticleHTML(active, activeIndex, prevNav, nextNav) {
  const activeVariant = state.ruleset?.boardVariant || state.boardVariant || "standard-40";
  const isMetro = activeVariant === "metro-52";
  const activeContract = active.id === "board-tiles" ? `<div class="rules-inline-note"><span class="t-micro g400">ACTIVE BOARD</span><span class="t-body ink-2">${esc(String(activeVariant).toUpperCase())} · ${isMetro ? "52 SPACES · 13 PER SIDE · CORNERS 0/13/26/39 · UP TO 6 PLAYERS" : "40 SPACES · 10 PER SIDE · CORNERS 0/10/20/30 · 2–4 PLAYERS"}</span></div>` : "";
  return `<article class="rules-book-page noise" aria-labelledby="rules-book-page-heading"><div class="rules-book-page-scroll thin-scroll" id="rules-book-page-scroll"><span id="rules-${active.id}"></span><div class="rules-article-head"><div><h2 class="t-section g100" id="rules-book-page-heading" tabindex="-1">${active.title}</h2><p class="t-body ink-2 rules-article-summary">${active.summary}</p></div></div>${activeContract}<div class="rules-article-body">${active.content}${rulesBookExtraHTML(active)}</div></div><footer class="rules-book-page-footer"><button class="btn-dark rules-page-turn" type="button" data-rules-section="${prevNav.id}" ${prevNav.disabled}><span aria-hidden="true">‹</span><span class="t-label f11">${prevNav.label}</span></button><span class="t-micro ink-3">${String(activeIndex + 1).padStart(2, "0")} / ${String(RULES_SECTIONS.length).padStart(2, "0")}</span><button class="btn-dark rules-page-turn" type="button" data-rules-section="${nextNav.id}" ${nextNav.disabled}><span aria-hidden="true">›</span><span class="t-label f11">${nextNav.label}</span></button></footer></article>`;
}

function rulesEmptyArticleHTML() {
  return `<article class="rules-book-page"><div class="rules-book-page-scroll"><div class="rules-empty"><span class="t-micro g400">NO MATCH IN THIS MANUAL</span><strong class="t-label f13 g100">Try another phrase.</strong></div></div></article>`;
}

// Chapters most players need are always listed; the optional systems sit behind one fold.
const MORE_SECTION_IDS = new Set(["support-spaces", "cards", "prison-vacation", "wallet-items", "loans", "global-events", "casino-market", "bots", "social-profile", "achievements", "lobby-settings", "reconnect-accessibility", "rulesets-market"]);

function rulesIndexLinkHTML(section, index, active) {
  const current = section.id === active?.id ? ` aria-current="page"` : "";
  return `<button class="rules-index-link${indexLinkClasses(section, active)}" type="button" data-rules-section="${section.id}"${current}><span class="rules-index-number">${String(index + 1).padStart(2, "0")}</span><span>${section.label}</span></button>`;
}

function rulesIndexLinksHTML(active) {
  const core = [];
  const more = [];
  RULES_SECTIONS.forEach((section, index) => {
    (MORE_SECTION_IDS.has(section.id) ? more : core).push(rulesIndexLinkHTML(section, index, active));
  });
  const open = active && MORE_SECTION_IDS.has(active.id);
  return `${core.join("")}<details class="rules-more"${open ? " open" : ""}><summary class="t-label f11">MORE SYSTEMS · ${more.length}</summary>${more.join("")}</details>`;
}

function indexLinkClasses(section, active) {
  const selected = section.id === active?.id ? " is-active" : "";
  return selected;
}

export function renderRulesSurface(target = "#rules-page-content") {
  const root = $(target);
  if (!root) return;
  const requested = rulesSectionById(state.rulesSection);
  const active = requested || RULES_SECTIONS[0];
  if (active) state.rulesSection = active.id;
  const activeIndex = active ? RULES_SECTIONS.findIndex((section) => section.id === active.id) : -1;
  const previous = previousSection(activeIndex);
  const next = nextSection(activeIndex);
  const prevNav = rulesPrevNav(previous);
  const nextNav = rulesNextNav(next);
  const article = active ? rulesArticleHTML(active, activeIndex, prevNav, nextNav) : rulesEmptyArticleHTML();
  const indexExpanded = state.rulesIndexExpanded === true;
  root.innerHTML = `<div class="rules-shell">
    <div class="rules-intro panel noise">
      <div class="rules-intro-icon"><img src="/assets/rules-book.svg" alt="" width="36" height="36"></div>
      <div class="rules-intro-copy"><h1 class="t-section g100" id="rules-page-title">How to play Poorup</h1><p class="t-body ink-2">Plain rules, one short chapter at a time.</p></div>
      <div class="rules-toolbar"><span class="t-micro ink-3">${RULES_SECTIONS.length} CHAPTERS</span></div>
    </div>
    <div class="rules-book-spread">
      <aside class="rules-index panel noise${indexExpanded ? " is-index-open" : ""}" aria-label="Rules sections"><div class="rules-index-head"><span class="t-micro g400">CONTENTS</span><button class="btn-dark rules-chapters-toggle" type="button" data-rules-chapters-toggle aria-controls="rules-index-nav" aria-expanded="${indexExpanded}"><span class="t-label f11">${indexExpanded ? "CLOSE CHAPTERS" : "CHAPTERS"}</span><span class="t-micro ink-3">${RULES_SECTIONS.length}</span></button></div><nav class="rules-index-nav" id="rules-index-nav" aria-label="Rules chapters">${rulesIndexLinksHTML(active)}</nav></aside>
      ${article}
    </div>
  </div>`;
  hydrateSprites(root);
}
