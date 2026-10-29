import express from "express";
import fs from "node:fs";
import { renderPageHeaders } from "../public/clientPageHeader.js";

const PREVIEW_PATH = "/assets/social/poorup-og-1200x630.png";
const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const PREVIEW_TYPE = "image/png";
const PRIVATE_PATH = /^(?:\/admin(?:\/|$)|\/game(?:\/|$)|\/play(?:\/|$)|\/rooms(?:\/|$)|\/profile(?:\/|$)|\/rankings(?:\/|$)|\/social(?:\/|$))/i;
const METADATA_PATHS = new Set(["/", "/play", "/rooms", "/profile", "/rankings", "/social", "/rules", "/admin/analytics"]);

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

const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{10,120}$/;

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
    origin: options.origin ?? env.POORUP_PUBLIC_ORIGIN ?? "",
    indexPolicy: options.indexPolicy ?? env.POORUP_INDEX_POLICY,
    previewPath: options.previewPath ?? env.POORUP_PREVIEW_PATH,
    description: options.description ?? env.POORUP_META_DESCRIPTION,
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
function structuredData(meta) {
  if (!meta.origin || meta.indexPolicy !== "index,follow") return "";
  if (meta.path !== "/" && meta.path !== "/about") return "";
  const data = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Poorup",
    url: `${meta.origin}/`,
    description: meta.description,
    applicationCategory: "GameApplication",
    genre: "Board game",
    operatingSystem: "Any (web browser)",
    browserRequirements: "Requires JavaScript",
    inLanguage: "en",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    audience: { "@type": "PeopleAudience", suggestedMinAge: 10 },
    numberOfPlayers: { "@type": "QuantitativeValue", minValue: 1, maxValue: 4 },
  };
  if (meta.previewUrl) data.image = meta.previewUrl;
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function renderMetadata(options = {}) {
  // Re-normalize at the renderer boundary. Callers may pass a precomputed
  // object, but its origin and absolute URLs are still untrusted input.
  const meta = metadataConfig(options);
  const tags = [
    `<meta name="robots" content="${escapeAttribute(meta.indexPolicy)}">`,
    `<meta name="description" content="${escapeAttribute(meta.description || "")}">`,
    `<meta property="og:title" content="${escapeAttribute(meta.title || "Poorup")}">`,
    `<meta property="og:description" content="${escapeAttribute(meta.description || "")}">`,
    `<meta property="og:type" content="website">`,
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
  }
  if (meta.previewUrl && meta.origin) {
    tags.push(`<meta property="og:image" content="${escapeAttribute(meta.previewUrl)}">`);
    tags.push(`<meta property="og:image:width" content="${PREVIEW_WIDTH}">`);
    tags.push(`<meta property="og:image:height" content="${PREVIEW_HEIGHT}">`);
    tags.push(`<meta property="og:image:type" content="${PREVIEW_TYPE}">`);
    tags.push(`<meta name="twitter:image" content="${escapeAttribute(meta.previewUrl)}">`);
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

// Indexing is on only with a public origin AND an explicit POORUP_INDEX_POLICY
// of index,follow (docs/seo.md). robots.txt and the sitemap follow this gate.
export function indexingApproved(env = process.env) {
  const origin = metadataConfig({ env, path: "/" }).origin;
  return Boolean(origin && normalizePolicy(env?.POORUP_INDEX_POLICY, "") === "index,follow");
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

export { PREVIEW_PATH, PREVIEW_WIDTH, PREVIEW_HEIGHT, PREVIEW_TYPE, PRIVATE_PATH, METADATA_PATHS };
