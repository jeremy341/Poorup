// robots.txt, sitemap.xml, the Markdown alternates and llms-full.txt. All of them
// are generated from the page modules, so these checks compare against those
// sources instead of copies of their text.
import assert from "node:assert/strict";
import { ABOUT_FAQ } from "../public/clientAboutContent.js";
import { RULES_SECTIONS } from "../public/rulesSections.js";
import { INDEXABLE_PATHS, MARKDOWN_ALTERNATES, PRIVATE_PATH, metadataConfig } from "./metadata.js";
import {
  NAMED_CRAWLERS,
  PRIVATE_DISALLOW,
  aboutMarkdown,
  llmsFullText,
  pageLastmod,
  rulesMarkdown,
  robotsTxt,
  sitemapXml,
} from "./seoFiles.js";

const ORIGIN = "https://play.example";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Splits robots.txt into { agent, rules } groups, the way a crawler reads them.
function robotsGroups(text) {
  const groups = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) {
      current = null;
      continue;
    }
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(field)) {
      if (!current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value);
    } else if (current) {
      current.rules.push(`${field.trim()}: ${value}`);
    }
  }
  return groups;
}

// A path is blocked when some Disallow prefix matches it and no longer Allow matches.
function blocked(rules, path) {
  let best = { length: -1, allow: true };
  for (const rule of rules) {
    const [kind, value] = [rule.slice(0, rule.indexOf(":")), rule.slice(rule.indexOf(":") + 1).trim()];
    const directive = kind.trim().toLowerCase();
    if (!["allow", "disallow"].includes(directive) || value === "") continue;
    if (!path.startsWith(value)) continue;
    const allow = directive === "allow";
    if (value.length > best.length || (value.length === best.length && allow)) {
      best = { length: value.length, allow };
    }
  }
  return !best.allow;
}

// --- robots.txt ---
assert.equal(robotsTxt({ approved: false, origin: ORIGIN }), "User-agent: *\nDisallow: /\n", "without the indexing gate the whole site is closed");
assert.equal(robotsTxt({ approved: true, origin: "" }), "User-agent: *\nDisallow: /\n", "approval without an origin is still closed");
assert.doesNotMatch(robotsTxt({ approved: false, origin: ORIGIN }), /Allow|Sitemap/);

{
  const text = robotsTxt({ approved: true, origin: ORIGIN });
  const groups = robotsGroups(text);
  const agents = groups.flatMap(group => group.agents);
  assert.equal(agents[0], "*", "the wildcard group comes first");
  for (const crawler of ["Googlebot", "Bingbot", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "anthropic-ai", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot"]) {
    assert.ok(agents.includes(crawler), `${crawler} has its own group`);
  }
  assert.deepEqual(agents, ["*", ...NAMED_CRAWLERS], "every named crawler is listed exactly once");
  assert.equal(new Set(agents).size, agents.length, "no duplicate groups");

  // Named groups repeat the full rule set: a crawler that matches one ignores `*`.
  const reference = JSON.stringify(groups[0].rules);
  for (const group of groups) assert.equal(JSON.stringify(group.rules), reference, `${group.agents[0]} has the same rules as *`);

  for (const path of ["/", "/about", "/rules", "/about.md", "/rules.md", "/llms.txt", "/llms-full.txt", "/sitemap.xml", "/favicon.svg", "/assets/social/poorup-og-1200x630.png"]) {
    for (const group of groups) assert.equal(blocked(group.rules, path), false, `${group.agents[0]} may fetch ${path}`);
  }
  const privateExamples = ["/game", "/game/abc", "/play", "/rooms", "/profile", "/rankings", "/social", "/admin/analytics", "/account/session", "/internal/retention/run", "/socket.io/?EIO=4", "/healthz", "/readyz"];
  for (const path of privateExamples) {
    for (const group of groups) assert.equal(blocked(group.rules, path), true, `${group.agents[0]} may not fetch ${path}`);
  }
  for (const prefix of PRIVATE_DISALLOW) assert.ok(prefix.startsWith("/"), `${prefix} is an absolute path`);

  // Every private route the server marks noindex is also closed to crawling.
  for (const path of ["/play", "/rooms", "/profile", "/rankings", "/social", "/admin/analytics"]) {
    assert.ok(PRIVATE_PATH.test(path), `${path} is private in metadata.js`);
    assert.equal(blocked(groups[0].rules, path), true, `${path} is disallowed too`);
  }
  assert.match(text, new RegExp(`^Sitemap: ${ORIGIN.replace(/[.]/g, "\\.")}/sitemap\\.xml$`, "m"));
  assert.match(text, /^Allow: \/$/m);
}

// --- sitemap.xml ---
{
  const xml = sitemapXml({ origin: ORIGIN, lastmod: { "/": "2026-11-20", "/about": "2026-11-19" } });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const urls = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)].map(match => [match[1], match[2] ?? null]);
  assert.deepEqual(urls.map(([loc]) => loc), INDEXABLE_PATHS.map(route => `${ORIGIN}${route}`), "every indexable page, as an absolute canonical URL");
  assert.deepEqual(urls.map(([, date]) => date), ["2026-11-20", "2026-11-19", null], "a page without a known date has no lastmod");
  for (const route of INDEXABLE_PATHS) assert.equal(metadataConfig({ origin: ORIGIN, path: route }).canonicalUrl, `${ORIGIN}${route}`, `${route} canonical matches the sitemap`);
  for (const [loc] of urls) assert.equal(PRIVATE_PATH.test(new URL(loc).pathname), false, `${loc} is not a private page`);
  assert.equal(sitemapXml({ origin: `${ORIGIN}`, lastmod: {} }).includes("<lastmod>"), false);
  assert.match(sitemapXml({ origin: ORIGIN }), /<loc>https:\/\/play\.example\/<\/loc>/, "the home page keeps its trailing slash");
}

{
  const dates = pageLastmod();
  for (const route of Object.keys(dates)) {
    assert.ok(INDEXABLE_PATHS.includes(route), `${route} is an indexable page`);
    assert.match(dates[route], DATE, `${route} lastmod is a W3C date`);
    assert.ok(!Number.isNaN(Date.parse(dates[route])), `${route} lastmod parses`);
  }
  assert.ok(Object.keys(dates).length > 0, "at least one page has a source date");
}

// --- Markdown copies and llms-full.txt ---
function headingLevels(markdown) {
  return markdown.split("\n").filter(line => /^#{1,6} /.test(line)).map(line => line.match(/^#+/)[0].length);
}
// A heading may go at most one level deeper than the one before it.
function assertHierarchy(markdown, label) {
  const levels = headingLevels(markdown);
  assert.ok(levels.length > 0, `${label} has headings`);
  let previous = 0;
  for (const level of levels) {
    assert.ok(level <= previous + 1, `${label}: an h${level} may not follow h${previous}`);
    previous = level;
  }
}
function assertClean(markdown, label) {
  assert.doesNotMatch(markdown, /<[a-z!/][^>]*>/i, `${label} has no markup`);
  assert.doesNotMatch(markdown, /&[a-z]+;|&#\d+;/i, `${label} has no entities`);
  assert.doesNotMatch(markdown, /undefined|\[object|\n{3,}/, `${label} has no stray text or blank runs`);
  assert.doesNotMatch(markdown, / \./, `${label} has no space before a full stop`);
}

{
  const about = aboutMarkdown();
  assert.match(about, /^# About Poorup\n/, "the About Markdown starts with the page heading");
  assertClean(about, "about.md");
  assertHierarchy(about, "about.md");
  for (const item of ABOUT_FAQ) {
    assert.ok(about.includes(`### ${item.question}`) || about.includes(`#### ${item.question}`), `about.md has the question "${item.question}"`);
    assert.ok(about.includes(item.answer), `about.md keeps the answer to "${item.question}"`);
  }
  assert.match(about, /not affiliated with Hasbro/i, "the independence statement is kept");
  assert.doesNotMatch(about, /After-Hours Parlor|THE AFTER-HOURS PARLOR|Back to the parlor/i, "page chrome is dropped");
}

{
  const rules = rulesMarkdown();
  assert.match(rules, /^# How to play Poorup\n/, "the rules Markdown starts with the page heading");
  assertClean(rules, "rules.md");
  assertHierarchy(rules, "rules.md");
  for (const section of RULES_SECTIONS) assert.ok(rules.includes(`\n## ${section.title}\n`), `rules.md has the chapter "${section.title}"`);
  assert.equal(headingLevels(rules).filter(level => level === 2).length, RULES_SECTIONS.length, "one top-level heading per chapter");
}

{
  const full = llmsFullText();
  assert.match(full, /^# Poorup: full text\n/);
  assert.ok(full.includes("## About Poorup") && full.includes("## How to play Poorup"), "both pages are present");
  assert.ok(full.indexOf("## About Poorup") < full.indexOf("## How to play Poorup"), "About comes before the rules");
  assertClean(full, "llms-full.txt");
  assertHierarchy(full, "llms-full.txt");
  for (const item of ABOUT_FAQ) assert.ok(full.includes(item.question), `llms-full.txt has "${item.question}"`);
  for (const section of RULES_SECTIONS) assert.ok(full.includes(section.title), `llms-full.txt has "${section.title}"`);
  assert.equal(llmsFullText(), full, "the full text is stable between requests");
  assert.ok(full.length < 60_000, "the full text stays small enough for an AI reader to load");
  assert.ok(full.length > 10_000, "the full text carries the whole rules book");
}

// The alternates are advertised only for pages that are indexable.
for (const [page, markdownPath] of Object.entries(MARKDOWN_ALTERNATES)) {
  assert.ok(INDEXABLE_PATHS.includes(page), `${page} is indexable`);
  assert.match(markdownPath, /^\/[a-z]+\.md$/);
}

console.log("seo files tests: passed");
