/*
 * Document metadata stays deliberately small and policy-safe. The server can
 * use the same shape when it renders a route, while the client owns titles and
 * live announcements as views change.
 */
const PREVIEW_PATH = "/assets/social/poorup-og-1200x630.png";
const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const PREVIEW_TYPE = "image/png";
const PRIVATE_PATH = /^(?:\/admin(?:\/|$)|\/game(?:\/|$)|\/play(?:\/|$)|\/rooms(?:\/|$)|\/profile(?:\/|$)|\/rankings(?:\/|$)|\/social(?:\/|$)|\/rules(?:\/|$))/i;

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
    status: options.status,
    roomCode: options.roomCode,
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

export function renderDocumentMeta(options = {}) {
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

const VIEW_TITLES = Object.freeze({
  home: "Poorup | Home",
  profile: "Poorup | Profile",
  game: "Poorup | Table",
  setup: "Poorup | Table setup",
  lobby: "Poorup | Lobby",
  rankings: "Poorup | Rankings",
  social: "Poorup | Parlor social",
  rules: "Poorup | Rules",
  admin: "Poorup | Operator console",
  analytics: "Poorup | Analytics",
});

export function setDocumentMeta({ view = "home", status = "", roomCode = "" } = {}) {
  const key = cleanText(view).toLowerCase();
  const baseTitle = VIEW_TITLES[key] || VIEW_TITLES.home;
  const safeRoomCode = String(roomCode || "").trim().toUpperCase().match(/^[A-Z0-9]{6}$/)?.[0] || "";
  const title = safeRoomCode && (key === "game" || key === "lobby" || key === "setup")
    ? `${baseTitle} | ${safeRoomCode}`
    : baseTitle;
  const safeStatus = cleanText(status);
  const announcement = safeStatus
    ? `${title}: ${safeStatus}`
    : title;
  if (typeof document !== "undefined") {
    document.title = title;
    const announcer = document.querySelector("[data-document-announcer]") || document.querySelector("#system-announcer");
    if (announcer) announcer.textContent = announcement;
  }
  return { title, announcement };
}

export { PREVIEW_PATH, PREVIEW_WIDTH, PREVIEW_HEIGHT, PREVIEW_TYPE, VIEW_TITLES };
