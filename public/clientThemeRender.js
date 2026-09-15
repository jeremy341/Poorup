/* ============================================================
   THEME RENDERER: mounts the five decorative worlds behind the
   existing Poorup surfaces. It never reads or writes game state.
   ============================================================ */
import { DEFAULT_THEME_ID, getTheme, MUSIC_TOKEN_SETS } from "./clientThemeData.js";

const VIEW_SELECTORS = ["#view-home", "#view-game", "#view-profile", "#view-rankings", "#view-social", "#view-rules"];
const DEFAULT_SKYLINE = { far: "#123634", near: "#0d2725", light: "#78894f" };
let transitionTimer = null;
let motionQuery = null;

function query(selector) {
  return typeof document === "undefined" ? null : document.querySelector(selector);
}

function escAttr(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]));
}

function reducedMotion() {
  if (typeof globalThis.matchMedia !== "function") return false;
  motionQuery ||= globalThis.matchMedia("(prefers-reduced-motion: reduce)");
  return motionQuery.matches;
}

function themeSceneForSurface(theme, surface) {
  if (surface === "home" && theme.homeScene) return theme.homeScene;
  return theme.scene;
}

export function themePreviewScene(themeOrId) {
  const theme = typeof themeOrId === "string" ? getTheme(themeOrId) : themeOrId || getTheme();
  return themeSceneForSurface(theme, "home") || "/favicon.svg";
}

function themePropsForSurface(theme, surface) {
  if (surface === "page") return {};
  if (surface === "home" && theme.homeProps) return { ...(theme.props || {}), ...theme.homeProps };
  return theme.props || {};
}

const REPEATING_PROP_CLASSES = Object.freeze({
  clouds: ["theme-cloud-a", "theme-cloud-b"],
  petals: ["theme-petal-a", "theme-petal-b"],
  snow: ["theme-snow-a", "theme-snow-b"],
  leaves: ["theme-leaves-a", "theme-leaves-b"],
  fog: ["theme-fog-a", "theme-fog-b"],
});

function imageMarkup(theme, slot, path, extraClass = "") {
  const weatherClass = slot === "weather" ? ` theme-prop-weather-${theme.motion.weather}` : "";
  return `<img class="theme-prop theme-prop-${slot}${weatherClass}${extraClass}" src="${escAttr(path)}" alt="" aria-hidden="true" width="640" height="360">`;
}

function repeatedPropMarkup(theme, slot, path) {
  return REPEATING_PROP_CLASSES[slot]
    .map(className => imageMarkup(theme, slot, path, ` ${className}`))
    .join("");
}

function pedestrianMarkup(theme, path) {
  const poseA = imageMarkup(theme, "pedestrians", path.poseA, " theme-pedestrian-pose theme-pedestrian-pose-a");
  const poseB = imageMarkup(theme, "pedestrians", path.poseB, " theme-pedestrian-pose theme-pedestrian-pose-b");
  return `<span class="theme-prop theme-pedestrian-band theme-pedestrian-a" aria-hidden="true">${poseA}${poseB}</span><span class="theme-prop theme-pedestrian-band theme-pedestrian-b" aria-hidden="true">${poseA}${poseB}</span>`;
}

function propMarkup(theme, surface, [slot, path]) {
  if (REPEATING_PROP_CLASSES[slot]) return repeatedPropMarkup(theme, slot, path);
  if (slot === "pedestrians") return surface === "home" ? pedestrianMarkup(theme, path) : "";
  return imageMarkup(theme, slot, path);
}

export function themeSceneMarkup(themeOrId, surface = "page") {
  const theme = typeof themeOrId === "string" ? getTheme(themeOrId) : themeOrId || getTheme();
  const safeSurface = surface === "home" || surface === "board" ? surface : "page";
  const scene = themeSceneForSurface(theme, safeSurface);
  if (!scene) return "";
  const propMarkupHTML = Object.entries(themePropsForSurface(theme, safeSurface))
    .map(entry => propMarkup(theme, safeSurface, entry))
    .join("");
  return `<img class="theme-scene" src="${escAttr(scene)}" alt="" aria-hidden="true" width="640" height="360">${propMarkupHTML}`;
}

function skylineMarkup(data, palette = DEFAULT_SKYLINE) {
  if (!Array.isArray(data)) return "";
  const far = palette.far || DEFAULT_SKYLINE.far;
  const near = palette.near || DEFAULT_SKYLINE.near;
  const light = palette.light || DEFAULT_SKYLINE.light;
  return data.map(([x, y, width, height], index) => {
    let output = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${far}"/>`;
    for (let row = 0; row < Math.floor((height - 2) / 3); row += 1) {
      for (let column = 0; column < Math.floor((width - 1) / 2); column += 1) {
        const lit = (row + column + index) % 3 === 0;
        output += `<rect x="${x + 1 + column * 2}" y="${y + 2 + row * 3}" width="1" height="1" fill="${lit ? light : near}"/>`;
      }
    }
    return output;
  }).join("");
}

export function paintThemeSkyline(element, data, palette) {
  if (element) element.innerHTML = skylineMarkup(data, palette);
}

function clearThemeVariables() {
  const body = document.body;
  const known = new Set([
    "--theme-sky", "--theme-focus", "--theme-warning", "--theme-logo-primary", "--theme-logo-secondary",
    "--theme-icon-primary", "--theme-icon-secondary", "--theme-scrim", "--theme-scanline",
    "--theme-setup-scrim", "--theme-gallery-scrim", "--theme-action-edge", "--theme-action-shadow", "--theme-action-shadow-muted",
    "--wordmark-color", "--wordmark-shadow-1", "--wordmark-shadow-2", "--wordmark-shadow-3", "--surface-button-hover", "--surface-button-pressed", "--surface-disabled", "--field-placeholder", "--surface-card-highlight", "--go-shadow-1", "--go-shadow-2", "--night-shadow",
    "--surface-inset", "--surface-selected", "--surface-hover", "--surface-board-hover", "--surface-avatar",
    "--surface-card", "--surface-active", "--surface-special", "--surface-board-frame", "--line-shadow",
    "--bg-canvas", "--bg-chrome", "--surface-panel", "--surface-panel-raised", "--surface-panel-deep",
    "--surface-board-tile", "--surface-board-center", "--surface-input", "--surface-button-dark", "--text-primary",
    "--text-secondary", "--text-muted", "--gold-050", "--gold-100", "--gold-300", "--gold-400", "--gold-500",
    "--gold-muted", "--line-dark", "--line-subtle", "--line-default", "--line-strong", "--line-active", "--line-board",
    "--red-action", "--red-action-hover", "--red-action-pressed",
    "--music-surface", "--music-border", "--music-accent", "--music-text", "--music-muted", "--music-meter",
  ]);
  known.forEach((name) => body.style.removeProperty(name));
}

function setThemeVariables(theme) {
  if (!document.body) return;
  clearThemeVariables();
  const musicTokens = MUSIC_TOKEN_SETS[theme.id] || MUSIC_TOKEN_SETS[DEFAULT_THEME_ID];
  Object.entries(musicTokens).forEach(([name, value]) => document.body.style.setProperty(name, value));
  if (theme.id === DEFAULT_THEME_ID) return;
  Object.entries(theme.tokens).forEach(([name, value]) => document.body.style.setProperty(name, value));
  document.body.style.setProperty("--theme-sky", theme.tokens["--bg-canvas"] || "#01070a");
}

function renderLayer(selector, theme, surface, animate) {
  const layer = query(selector);
  if (!layer) return;
  layer.innerHTML = themeSceneMarkup(theme, surface);
  layer.dataset.themeId = theme.id;
  layer.querySelectorAll(".theme-scene").forEach((scene) => {
    scene.classList.remove("is-entering");
    if (animate && !reducedMotion()) requestAnimationFrame(() => scene.classList.add("is-entering"));
  });
}

function beginTransition(animate) {
  if (!transitionAllowed(animate)) return;
  document.body.dataset.themeTransition = "in";
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => {
    delete document.body.dataset.themeTransition;
    transitionTimer = null;
  }, 320);
}

function transitionAllowed(animate) {
  if (!animate) return false;
  if (reducedMotion()) return false;
  return Boolean(document.body);
}

export function renderThemeScene(themeId, surface = "page", options = {}) {
  const theme = getTheme(themeId);
  const animate = options.animate !== false;
  if (surface === "home") renderLayer("#theme-home-world", theme, "home", animate);
  else if (surface === "board") renderLayer("#theme-board-world", theme, "board", animate);
  else renderLayer("#theme-page-world", theme, "page", animate);
}

export function clearThemeTransition() {
  if (typeof document === "undefined") return;
  delete document.body?.dataset.themeTransition;
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = null;
}

export function renderTheme(themeId, { animate = true } = {}) {
  const theme = getTheme(themeId);
  setThemeVariables(theme);
  if (document.body) document.body.dataset.themeId = theme.id;
  VIEW_SELECTORS.forEach((selector) => query(selector)?.setAttribute("data-theme-id", theme.id));
  beginTransition(animate);
  renderThemeScene(theme.id, "page", { animate });
  renderThemeScene(theme.id, "home", { animate });
  renderThemeScene(theme.id, "board", { animate });
  return theme;
}

export function pauseThemeMotion(paused) {
  document.body?.classList.toggle("theme-motion-paused", Boolean(paused));
}
