// The /rules page is server-rendered so guests, crawlers and AI answer engines
// meet the full rules book without running JavaScript. The page ships with the
// rules view visible and the home view hidden, follows the same two-key
// indexing gate as every other page (server.js gates the env with
// gateIndexEnv), and never lets a hostile POORUP_PUBLIC_ORIGIN reach the
// canonical or og:url tags.
import assert from "node:assert/strict";
import { renderRulesPage } from "./rulesPage.js";
import { RULES_SECTIONS } from "../public/rulesSections.js";
import { gateIndexEnv } from "./metadata.js";

// 1. An indexed deploy serves the full rules book.
const live = renderRulesPage({ env: { POORUP_PUBLIC_ORIGIN: "https://poorup.example", POORUP_INDEX_POLICY: "index,follow" } });

assert.match(live, /<div class="view" id="view-rules">/, "the rules view ships visible");
assert.match(live, /<div class="view is-hidden" id="view-home">/, "the home view ships hidden");
assert.doesNotMatch(live, /<div class="view" id="view-home">/, "no unhidden home view remains");
assert.equal((live.match(/id="view-home"/g) || []).length, 1, "the home view appears once");
assert.equal((live.match(/<h1[^>]*id="rules-page-title"/g) || []).length, 1, "exactly one rules page heading");

assert.equal(RULES_SECTIONS.length, 21, "the rules book has 21 chapters");
assert.equal((live.match(/class="rules-chapter"/g) || []).length, 21, "exactly 21 chapter sections");
const chapters = [...live.matchAll(/<section class="rules-chapter" id="rules-([^"]+)"/g)].map(match => match[1]);
assert.equal(chapters.length, RULES_SECTIONS.length, "one chapter article per section");
assert.equal(new Set(chapters).size, chapters.length, "chapter ids are unique");
assert.deepEqual(chapters, RULES_SECTIONS.map(section => section.id), "chapter ids match RULES_SECTIONS");

// The contents nav links to every chapter id, in order.
const nav = live.match(/<nav class="rules-index-nav"[^>]*>([\s\S]*?)<\/nav>/);
assert.ok(nav, "the page has a contents nav");
assert.deepEqual(
  [...nav[1].matchAll(/href="#rules-([^"]+)"/g)].map(match => match[1]),
  RULES_SECTIONS.map(section => section.id),
  "the contents nav links every chapter",
);

// Metadata: the title names the page and every absolute URL carries the
// trusted origin only.
const title = live.match(/<title>([^<]*)<\/title>/i);
assert.ok(title, "the page has a title");
assert.ok(title[1].includes("Rules"), `the title names the rules page: ${title[1]}`);
assert.match(live, /<meta name="robots" content="index,follow">/);
assert.match(live, /<link rel="canonical" href="https:\/\/poorup\.example\/rules">/);
assert.match(live, /<meta property="og:url" content="https:\/\/poorup\.example\/rules">/);
assert.match(live, /<meta property="og:image" content="https:\/\/poorup\.example\/assets\/social\/poorup-og-1200x630\.png">/);

// 2. Indexing gate: without an approved POORUP_INDEX_POLICY the page stays
// noindex and ships no structured data, exactly as server.js gates the env
// before rendering (server.js: pageEnv = gateIndexEnv(process.env)).
const gated = renderRulesPage({ env: gateIndexEnv({ POORUP_PUBLIC_ORIGIN: "https://poorup.example" }) });
assert.match(gated, /<meta name="robots" content="noindex,nofollow">/);
assert.doesNotMatch(gated, /application\/ld\+json/, "no structured data while indexing is unapproved");

// A deploy with no origin configured at all stays noindex too.
const dark = renderRulesPage({ env: {} });
assert.match(dark, /<meta name="robots" content="noindex,nofollow">/);
assert.doesNotMatch(dark, /application\/ld\+json/);
assert.doesNotMatch(dark, /rel="canonical"/);
assert.doesNotMatch(dark, /og:url/);

// 3. A hostile POORUP_PUBLIC_ORIGIN never reaches canonical or og:url: an
// invalid, scheme-injected or path-carrying origin is dropped entirely, the
// way metadata.test.js checks the same boundary.
for (const hostile of ["javascript:alert(1)", "not-a-url", "javascript:alert(1)//evil.example", "https://evil.example/private"]) {
  const hostileHtml = renderRulesPage({ env: { POORUP_PUBLIC_ORIGIN: hostile } });
  assert.doesNotMatch(hostileHtml, /rel="canonical"/, `${hostile} must not produce a canonical`);
  assert.doesNotMatch(hostileHtml, /og:url/, `${hostile} must not produce og:url`);
  assert.doesNotMatch(hostileHtml, /og:image/, `${hostile} must not produce og:image`);
  assert.ok(!hostileHtml.includes(hostile), `${hostile} must not appear in the page`);
}

// 4. The noscript fallback is gone and no home markup renders visibly.
assert.doesNotMatch(live, /<noscript/i, "the noscript block is removed");
assert.doesNotMatch(live, /noscript-note/, "the noscript fallback content is gone");

console.log("rules page: passed");
