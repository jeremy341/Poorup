import express from "express";
import fs from "node:fs";

const PREVIEW_PATH = "/assets/social/poorup-og-1200x630.png";
const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const PREVIEW_TYPE = "image/png";
const PRIVATE_PATH = /^(?:\/admin(?:\/|$)|\/game(?:\/|$)|\/play(?:\/|$)|\/rooms(?:\/|$)|\/profile(?:\/|$)|\/rankings(?:\/|$)|\/social(?:\/|$)|\/rules(?:\/|$))/i;
const METADATA_PATHS = new Set(["/", "/play", "/rooms", "/profile", "/rankings", "/social", "/rules", "/admin/analytics"]);

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
    title: options.title ?? "Poorup",
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
  const description = cleanText(source.description);
  const title = cleanText(source.title, "Poorup");
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
    previewUrl: origin ? `${origin}${previewPath}` : "",
  };
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    `<meta name="twitter:card" content="summary_large_image">`,
  ];
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
  return tags.join("\n");
}

export function renderDocumentMeta(options = {}) {
  return renderMetadata(options);
}

export function injectMetadata(html, options = {}) {
  const tags = renderMetadata(options);
  const source = String(html || "").replace(/\s*<meta\s+name=["']robots["'][^>]*data-metadata-robots[^>]*>/i, "");
  if (!/<\/head>/i.test(source)) return source;
  return source.replace(/<\/head>/i, `${tags}\n</head>`);
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
