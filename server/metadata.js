import express from "express";
import fs from "node:fs";
import { renderPageHeaders } from "../public/clientPageHeader.js";

const PREVIEW_PATH = "/assets/social/poorup-og-1200x630.png";
const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const PREVIEW_TYPE = "image/png";
const PRIVATE_PATH = /^(?:\/admin(?:\/|$)|\/game(?:\/|$)|\/play(?:\/|$)|\/rooms(?:\/|$)|\/profile(?:\/|$)|\/rankings(?:\/|$)|\/social(?:\/|$))/i;
const METADATA_PATHS = new Set(["/", "/play", "/rooms", "/profile", "/rankings", "/social", "/admin/analytics"]);

// Search copy for the pages that may be indexed. The game never claims to be
// Monopoly or any other product; it describes itself as the same kind of game.
const PAGE_COPY = {
  "/": {
    title: "Poorup \u2013 Free Online Monopoly-Style Game, No Signup",
    description: "Play Poorup free in your browser: a Monopoly-style property trading board game for 2\u20134 players. Buy, trade, auction and outlast your friends. No download, no signup."
  },
  "/about": {
    title: "About Poorup \u2013 Free Online Property Trading Board Game",
    description: "What Poorup is, how it plays, how it compares to Monopoly and Richup-style online board games, and answers to common questions about playing free with friends or bots."
  },
  "/rules": {
    title: "Poorup Rules \u2013 How to Play the Online Property Board Game",
    description: "Learn the rules: turns, buying property, rent, houses and hotels, auctions, trades, jail, loans and bankruptcy in Poorup, the free online property trading board game."
  }
};

// The only pages that may be indexed. The sitemap, robots.txt and structured
// data all read this list, so they cannot disagree about which pages are public.
export const INDEXABLE_PATHS = Object.freeze(["/", "/about", "/rules"]);

// Breadcrumb label for each indexable page that is not the home page. Kept next
// to the path list so a new indexable page cannot get a breadcrumb with no name.
const BREADCRUMB_LABELS = Object.freeze({
  "/about": "About",
  "/rules": "Rules",
});
// Markdown copies of the indexable pages, advertised with rel="alternate". Served
// by server.js only while indexing is approved.
export const MARKDOWN_ALTERNATES = Object.freeze({
  "/about": "/about.md",
  "/rules": "/rules.md",
});
const REPOSITORY_URL = "https://github.com/jeremy341/Poorup";
// Only URLs that really exist in this repository are listed as sameAs. There are
// no verified social profiles checked in here, so the source repository is the
// sole entry; do not add invented Twitter/X, Discord or community links.
const SAME_AS_URLS = Object.freeze([REPOSITORY_URL]);
// Poorup's production home. Baked in so a normal deployment is indexable without an
// environment file; the POORUP_* variables below remain as overrides for staging.
export const DEFAULT_PUBLIC_ORIGIN = "https://powerup.tech";
export const DEFAULT_INDEX_POLICY = "index,follow";

const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{10,120}$/;

function productionRuntime(env) {
  return String(env?.NODE_ENV || "").trim().toLowerCase() === "production";
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback).replace(/[<>]/g, "").trim();
}

function cleanPath(value, fallback = "/") {
  const path = cleanText(value, fallback);
  if (!path || !path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}

function normalizeOrigin(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function normalizePolicy(value, fallback) {
  const policy = cleanText(value).toLowerCase().replace(/\s+/g, "");
  if (policy === "index,follow" || policy === "noindex,nofollow") return policy;
  return fallback;
}

function sourceOptions(options = {}) {
  const env = options.env && typeof options.env === "object" ? options.env : options;
  return {
    origin: options.origin ?? env.POORUP_PUBLIC_ORIGIN ?? (productionRuntime(env) ? DEFAULT_PUBLIC_ORIGIN : ""),
    indexPolicy: options.indexPolicy ?? env.POORUP_INDEX_POLICY ?? (productionRuntime(env) ? DEFAULT_INDEX_POLICY : undefined),
    previewPath: options.previewPath ?? env.POORUP_PREVIEW_PATH,
    // POORUP_META_DESCRIPTION is documented as the home-page description only.
    description: options.description ?? (cleanPath(options.path ?? "/") === "/" ? env.POORUP_META_DESCRIPTION : undefined),
    path: options.path ?? "/",
    title: options.title,
    googleVerification: options.googleVerification ?? env.POORUP_GOOGLE_SITE_VERIFICATION,
    bingVerification: options.bingVerification ?? env.POORUP_BING_SITE_VERIFICATION,
  };
}

export function metadataConfig(options = {}) {
  const source = sourceOptions(options);
  const origin = normalizeOrigin(source.origin);
  const path = cleanPath(source.path);
  const defaultPolicy = origin && !PRIVATE_PATH.test(path) ? "index,follow" : "noindex,nofollow";
  const indexPolicy = !origin || PRIVATE_PATH.test(path)
    ? "noindex,nofollow"
    : normalizePolicy(source.indexPolicy, defaultPolicy);
  const previewPath = cleanPath(source.previewPath, PREVIEW_PATH);
  const copy = PAGE_COPY[path] || {};
  const description = cleanText(source.description || copy.description || "");
  const title = cleanText(source.title || copy.title || "Poorup", "Poorup");
  const token = value => (VERIFICATION_TOKEN.test(cleanText(value)) ? cleanText(value) : "");
  return {
    origin,
    path,
    indexPolicy,
    previewPath,
    previewWidth: PREVIEW_WIDTH,
    previewHeight: PREVIEW_HEIGHT,
    previewType: PREVIEW_TYPE,
    description,
    title,
    canonicalUrl: origin ? `${origin}${path}` : "",
    googleVerification: token(source.googleVerification),
    bingVerification: token(source.bingVerification),
    previewUrl: origin && previewPath ? `${origin}${previewPath}` : "",
  };
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// JSON-LD only goes out for indexable pages with a configured public origin, so a
// private or unconfigured deploy never advertises itself to crawlers.
// Every indexable page carries the same three entities with stable @ids, so they
// merge into one site-wide description: the Organization that publishes the game,
// the WebSite, and the game itself (a VideoGame that is also a WebApplication).
// Every non-home page adds its breadcrumb, and /rules adds its TechArticle. There is
// no FAQPage on /rules: that page holds the rules book, not questions and answers.
function structuredData(meta) {
  if (!meta.origin || meta.indexPolicy !== "index,follow") return "";
  if (!INDEXABLE_PATHS.includes(meta.path)) return "";
  const organizationId = `${meta.origin}/#organization`;
  const organization = {
    "@type": "Organization",
    "@id": organizationId,
    name: "Poorup",
    url: `${meta.origin}/`,
    // The brand mark in public/favicon.svg, served at /favicon.svg. It is a real
    // repository asset, so the logo URL can never point at a missing file.
    logo: `${meta.origin}/favicon.svg`,
    sameAs: SAME_AS_URLS,
  };
  const website = {
    "@type": "WebSite",
    "@id": `${meta.origin}/#website`,
    name: "Poorup",
    url: `${meta.origin}/`,
    inLanguage: "en",
    publisher: { "@id": organizationId },
  };
  const game = {
    "@type": ["VideoGame", "WebApplication"],
    "@id": `${meta.origin}/#game`,
    name: "Poorup",
    url: `${meta.origin}/`,
    applicationCategory: "GameApplication",
    genre: "Board game",
    gamePlatform: "Web browser",
    operatingSystem: "Any (web browser)",
    browserRequirements: "Requires JavaScript",
    inLanguage: "en",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    audience: { "@type": "PeopleAudience", suggestedMinAge: 10 },
    // 2-4 on the Standard-40 board, up to 6 on Metro-52 (see server/boardRegistry.js).
    numberOfPlayers: { "@type": "QuantitativeValue", minValue: 2, maxValue: 6 },
    publisher: { "@id": organizationId },
  };
  if (meta.path === "/") game.description = meta.description;
  if (meta.previewUrl) game.image = meta.previewUrl;
  const graph = [organization, website, game];
  if (BREADCRUMB_LABELS[meta.path]) {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${meta.origin}/` },
        { "@type": "ListItem", position: 2, name: BREADCRUMB_LABELS[meta.path], item: meta.canonicalUrl },
      ],
    });
  }
  if (meta.path === "/rules") {
    graph.push({
      "@type": "TechArticle",
      headline: meta.title,
      description: meta.description,
      url: meta.canonicalUrl,
      inLanguage: "en",
      publisher: { "@id": organizationId },
      isPartOf: { "@id": `${meta.origin}/#website` },
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}

export function renderMetadata(options = {}) {
  // Re-normalize at the renderer boundary. Callers may pass a precomputed
  // object, but its origin and absolute URLs are still untrusted input.
  const meta = metadataConfig(options);
  // Wider image previews and snippets apply while a page is indexable, so a page
  // that may be indexed keeps a richer robots directive than a noindex one.
  const robots = meta.indexPolicy === "index,follow"
    ? `${meta.indexPolicy}, max-image-preview:large, max-snippet:-1`
    : meta.indexPolicy;
  const ogType = meta.path === "/rules" ? "article" : "website";
  const tags = [
    `<meta name="robots" content="${escapeAttribute(robots)}">`,
    `<meta name="description" content="${escapeAttribute(meta.description || "")}">`,
    `<meta property="og:title" content="${escapeAttribute(meta.title || "Poorup")}">`,
    `<meta property="og:description" content="${escapeAttribute(meta.description || "")}">`,
    `<meta property="og:type" content="${ogType}">`,
    `<meta property="og:site_name" content="Poorup">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta name="twitter:card" content="${meta.previewUrl ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escapeAttribute(meta.title || "Poorup")}">`,
    `<meta name="twitter:description" content="${escapeAttribute(meta.description || "")}">`,
  ];
  if (meta.googleVerification) tags.push(`<meta name="google-site-verification" content="${escapeAttribute(meta.googleVerification)}">`);
  if (meta.bingVerification) tags.push(`<meta name="msvalidate.01" content="${escapeAttribute(meta.bingVerification)}">`);
  if (meta.canonicalUrl && meta.origin) {
    tags.push(`<link rel="canonical" href="${escapeAttribute(meta.canonicalUrl)}">`);
    tags.push(`<meta property="og:url" content="${escapeAttribute(meta.canonicalUrl)}">`);
    const markdown = MARKDOWN_ALTERNATES[meta.path];
    if (markdown && meta.indexPolicy === "index,follow") {
      tags.push(`<link rel="alternate" type="text/markdown" href="${escapeAttribute(`${meta.origin}${markdown}`)}">`);
    }
  }
  if (meta.previewUrl && meta.origin) {
    tags.push(`<meta property="og:image" content="${escapeAttribute(meta.previewUrl)}">`);
    tags.push(`<meta property="og:image:width" content="${PREVIEW_WIDTH}">`);
    tags.push(`<meta property="og:image:height" content="${PREVIEW_HEIGHT}">`);
    tags.push(`<meta property="og:image:type" content="${PREVIEW_TYPE}">`);
    tags.push(`<meta property="og:image:alt" content="${escapeAttribute(meta.title || "Poorup")}">`);
    tags.push(`<meta name="twitter:image" content="${escapeAttribute(meta.previewUrl)}">`);
    tags.push(`<meta name="twitter:image:alt" content="${escapeAttribute(meta.title || "Poorup")}">`);
  }
  const structured = structuredData(meta);
  if (structured) tags.push(`<script type="application/ld+json">${structured}</script>`);
  return tags.join("\n");
}

export function renderDocumentMeta(options = {}) {
  return renderMetadata(options);
}

export function injectMetadata(html, options = {}) {
  const tags = renderMetadata(options);
  const meta = metadataConfig(options);
  let source = renderPageHeaders(html || "").replace(/\s*<meta\s+name=["']robots["'][^>]*data-metadata-robots[^>]*>/i, "");
  // Crawlers read the served <title>, so it carries the page copy too.
  if (meta.title && meta.title !== "Poorup") source = source.replace(/<title>[^<]*<\/title>/i, () => `<title>${escapeAttribute(meta.title)}</title>`);
  if (!/<\/head>/i.test(source)) return source;
  return source.replace(/<\/head>/i, () => `${tags}\n</head>`);
}

// Production is indexable out of the box at powerup.tech. Other environments stay
// closed unless they opt in; an explicit POORUP_INDEX_POLICY always wins.
export function indexingApproved(env = process.env) {
  const explicit = normalizePolicy(env?.POORUP_INDEX_POLICY, "");
  const origin = metadataConfig({ env, path: "/" }).origin;
  if (explicit) return Boolean(origin) && explicit === "index,follow";
  // Only production gets the baked-in opt-in; other environments need an explicit policy.
  return productionRuntime(env) && Boolean(origin);
}

// Logged once at boot (server/server.js). In production the default policy means
// there is nothing to warn about; a public origin in another environment with no
// policy would silently stay noindex, so that case is still reported.
export function indexingWarning(env = process.env) {
  const config = metadataConfig({ env, path: "/" });
  if (!config.origin) return "";
  const raw = cleanText(env?.POORUP_INDEX_POLICY);
  if (!raw) {
    if (productionRuntime(env)) return "";
    return "POORUP_PUBLIC_ORIGIN is set but POORUP_INDEX_POLICY is unset; robots.txt stays Disallow: / and every page stays noindex. Set POORUP_INDEX_POLICY=index,follow to allow indexing (docs/seo.md).";
  }
  const policy = normalizePolicy(raw, "");
  if (!policy) {
    return `POORUP_INDEX_POLICY is "${raw}", which is not understood; robots.txt stays Disallow: / and every page stays noindex. Use index,follow or noindex,nofollow.`;
  }
  return "";
}

// The env the page renderers should see: until indexing is approved every page
// says noindex, so the pages cannot advertise what robots.txt forbids.
export function gateIndexEnv(env = process.env) {
  return indexingApproved(env) ? env : { ...env, POORUP_INDEX_POLICY: "noindex,nofollow" };
}

export function createMetadataRouter({ env = process.env, indexFile = "", getOptions } = {}) {
  const router = express.Router();
  router.get("*", (req, res, next) => {
    if (!METADATA_PATHS.has(req.path) || !indexFile) return next();
    let html;
    try {
      html = fs.readFileSync(indexFile, "utf8");
    } catch {
      return next();
    }
    const supplied = typeof getOptions === "function" ? getOptions(req) : { env };
    const options = { ...(supplied || {}), path: supplied?.path || req.path };
    res.setHeader("Cache-Control", "no-cache");
    return res.type("html").send(injectMetadata(html, options));
  });
  return router;
}

export { PREVIEW_PATH, PREVIEW_WIDTH, PREVIEW_HEIGHT, PREVIEW_TYPE, PRIVATE_PATH };
