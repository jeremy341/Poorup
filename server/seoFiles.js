// The crawler-facing text files: robots.txt, sitemap.xml, the Markdown copies of
// the About and Rules pages, and llms-full.txt. Every body is built from the same
// modules the HTML pages render from (clientAboutContent.js, rulesSections.js),
// so these files cannot drift from the pages. Indexing is gated by the caller:
// robots.txt and the sitemap take `approved`, and the Markdown alternates are
// only mounted while indexing is approved (see server/server.js).
import { renderAboutContent } from "../public/clientAboutContent.js";
import { RULES_SECTIONS } from "../public/rulesSections.js";
import { INDEXABLE_PATHS } from "./metadata.js";
import { htmlToMarkdown } from "./htmlToMarkdown.js";

// Paths a crawler should not fetch: the game, rooms, accounts, operator tools and
// machine endpoints. Each is a plain prefix, so `/play` also covers `/play/`.
export const PRIVATE_DISALLOW = Object.freeze([
  "/account/",
  "/admin/",
  "/game",
  "/healthz",
  "/internal/",
  "/play",
  "/profile",
  "/rankings",
  "/readyz",
  "/rooms",
  "/social",
  "/socket.io/",
]);

// Named crawlers that get the same allow-and-disallow rules as `*`. A crawler that
// matches a named group ignores `*`, so each group repeats the full rule set.
// Search engines and AI assistants that read pages for answers are listed first.
// Google-Extended and Applebot-Extended are opt-out tokens for AI training, not
// separate crawlers; they are listed because the site opts in to them.
export const NAMED_CRAWLERS = Object.freeze([
  "Googlebot",
  "Bingbot",
  "DuckDuckBot",
  "Applebot",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  // Other search engines and AI answer/training crawlers. Each named group
  // repeats the full rule set, so naming them opts them in explicitly.
  "YandexBot",
  "Baiduspider",
  "SeznamBot",
  "MojeekBot",
  "Perplexity-User",
  "meta-externalagent",
  "Amazonbot",
  "MistralAI-User",
  "MistralAI-UserFast",
  "Coherebot",
  "cohere-ai",
  "YouBot",
  "AI2Bot",
  "Diffbot",
  "Bytespider",
]);

export function robotsTxt({ approved, origin } = {}) {
  // Until indexing is approved the whole site is closed, and no named group
  // exists to override that for a crawler.
  if (!approved || !origin) return "User-agent: *\nDisallow: /\n";
  const rules = ["Allow: /", ...PRIVATE_DISALLOW.map(path => `Disallow: ${path}`)];
  const groups = ["*", ...NAMED_CRAWLERS].map(agent => [`User-agent: ${agent}`, ...rules].join("\n"));
  return [
    "# Public pages are open to search and AI crawlers. Game, room, account and operator paths are not.",
    ...groups,
    `Sitemap: ${origin}/sitemap.xml`,
  ].join("\n\n") + "\n";
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[character]));
}

// lastmod is a checked-in date, bumped by hand when a page's public copy
// changes. File mtimes were the checkout time, so every deploy rewrote all three
// dates to "today" and crawlers learned to distrust them. Keeping the date in the
// repository makes it stable across deploys and honest about the content.
export const PAGE_LASTMOD = Object.freeze({
  "/": "2026-11-20",
  "/about": "2026-11-22",
  "/rules": "2026-11-20",
});

export function pageLastmod() {
  return PAGE_LASTMOD;
}

export function sitemapXml({ origin, lastmod = PAGE_LASTMOD } = {}) {
  const urls = INDEXABLE_PATHS.map(route => {
    const date = lastmod[route];
    return `  <url><loc>${escapeXml(`${origin}${route}`)}</loc>${date ? `<lastmod>${date}</lastmod>` : ""}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

let aboutCache = null;
let rulesCache = null;
let llmsFullCache = null;

// The About page as Markdown: the same HTML the page renders, minus its
// presentational chrome (the contents list, the section numbers, the footer).
export function aboutMarkdown() {
  if (aboutCache === null) {
    aboutCache = htmlToMarkdown(renderAboutContent(), {
      drop: [
        /<div class="t-micro ink-2">THE AFTER-HOURS PARLOR<\/div>/gi,
        /<div class="about-section-label[\s\S]*?<\/div>/gi,
        /<footer class="about-document-footer"[\s\S]*?<\/footer>/gi,
      ],
    });
  }
  return aboutCache;
}

// The Rules page as Markdown: one section per chapter, in the order the book shows them.
export function rulesMarkdown() {
  if (rulesCache === null) {
    const chapters = RULES_SECTIONS.map(section => `## ${section.title}\n\n${section.summary}\n\n${htmlToMarkdown(section.content)}`);
    rulesCache = `# How to play Poorup\n\n${chapters.join("\n")}`;
  }
  return rulesCache;
}

// Demotes every Markdown heading by `by` levels (capped at h6), so an embedded
// page can sit under its own section heading.
function shiftHeadings(markdown, by) {
  return markdown.replace(/^(#{1,6}) /gm, (_match, hashes) => `${"#".repeat(Math.min(6, hashes.length + by))} `);
}

// Full text for AI readers: the About and Rules pages in one file, under a short
// preface. Every section is generated from the same module the matching HTML
// page renders from, so the text cannot drift. The one-paragraph summary lives
// in /llms.txt, so it is not repeated here.
export function llmsFullText() {
  if (llmsFullCache === null) {
    const about = shiftHeadings(aboutMarkdown().replace(/^# .*\n+/, ""), 1);
    const rules = shiftHeadings(rulesMarkdown().replace(/^# .*\n+/, ""), 1);
    const sections = ["# Poorup: full text", "This file holds the full text of Poorup's public About and Rules pages, generated from the same source as those pages. For a short summary of the game and its facts, read /llms.txt.", "## About Poorup", about.trim(), "## How to play Poorup", rules.trim()];
    llmsFullCache = sections.join("\n\n") + "\n";
  }
  return llmsFullCache;
}
