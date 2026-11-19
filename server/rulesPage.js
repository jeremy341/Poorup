import fs from "node:fs";
import { injectMetadata } from "./metadata.js";
import { RULES_SECTIONS } from "../public/rulesSections.js";

// Server-rendered rules book. Mirrors the /about pattern (aboutPage.js): the
// plain client shell is filled with real, crawlable HTML before it is served,
// so guests, crawlers and AI answer engines meet the full rule text without
// running JavaScript. The interactive chapter reader in the client owns the
// UI when script runs; this static body is what the shell ships with.

function rulesBody() {
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const intro = `<div class="rules-intro panel noise"><div class="rules-intro-icon"><img src="/assets/rules-book.svg" alt="" width="36" height="36"></div><div class="rules-intro-copy"><h1 class="t-section g100" id="rules-page-title">How to play Poorup</h1><p class="t-body ink-2">Plain rules, one short chapter at a time.</p></div><div class="rules-toolbar"><span class="t-micro ink-3">${RULES_SECTIONS.length} CHAPTERS</span></div></div>`;
  const contents = `<aside class="rules-index panel noise" aria-label="Rules sections"><div class="rules-index-head"><span class="t-micro g400">CONTENTS</span></div><p class="t-micro ink-3"><a href="/">Back to the table</a> · <a href="/about">About Poorup</a></p><nav class="rules-index-nav" aria-label="Rules chapters">${RULES_SECTIONS.map((section, index) => `<a class="rules-index-link" href="#rules-${section.id}"><span class="rules-index-number">${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(section.label)}</span></a>`).join("")}</nav></aside>`;
  const chapters = RULES_SECTIONS.map(section => `<section class="rules-chapter" id="rules-${section.id}" aria-labelledby="rules-${section.id}-heading"><div class="rules-article-head"><div><h2 class="t-section g100" id="rules-${section.id}-heading">${escapeHtml(section.title)}</h2><p class="t-body ink-2 rules-article-summary">${escapeHtml(section.summary)}</p></div></div><div class="rules-article-body">${section.content}</div></section>`).join("");
  // .rules-book-spread is a 2-column grid: the TOC aside in one column, all
  // chapters inside a single scrollable book page in the other. Flattening the
  // chapters as .rules-book-page items would give each its own panel border
  // and overflow clipping, so they share one plain scrolling page.
  return `<div class="rules-shell">${intro}<div class="rules-book-spread">${contents}<article class="rules-book-page"><div class="rules-book-page-scroll thin-scroll"><div class="rules-book-page-head"><p class="t-micro g400">FULL RULES · ALL ${RULES_SECTIONS.length} CHAPTERS</p></div>${chapters}</div></article></div></div>`;
}

export function renderRulesPage(options = {}) {
  let html = options.indexHtml ?? fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/i, "");
  html = html.replace(/<div class="view" id="view-home">/, '<div class="view is-hidden" id="view-home">');
  html = html.replace(/<div class="view is-hidden" id="view-rules">/, '<div class="view" id="view-rules">');
  html = html.replace(
    '<main class="rules-page-main" id="rules-page-content" tabindex="-1"></main>',
    () => `<main class="rules-page-main" id="rules-page-content" tabindex="-1">${rulesBody()}</main>`
  );
  const meta = injectMetadata(html, { ...options, path: "/rules" });
  return meta;
}
