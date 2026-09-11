/* ============================================================
   THEME RENDERER: mounts decorative environments behind the existing
   Poorup UI. It never reads or mutates server game state.
   ============================================================ */
import { getTheme as defaultGetTheme } from "./clientThemeData.js";

const VIEW_SELECTORS = ["#view-home", "#view-game", "#view-profile", "#view-rankings", "#view-social", "#view-rules"];
const SKYLINE_DEFAULTS = { far: "#123634", near: "#123634", light: "#78894f" };
const UI_VARIABLES = Object.freeze({
  canvas: "--bg-canvas", chrome: "--bg-chrome", panel: "--surface-panel", panelRaised: "--surface-panel-raised", panelDeep: "--surface-panel-deep",
  boardTile: "--surface-board-tile", boardCenter: "--surface-board-center", input: "--surface-input", buttonDark: "--surface-button-dark",
  textPrimary: "--text-primary", textSecondary: "--text-secondary", textMuted: "--text-muted", accent: "--gold-300", accentBright: "--gold-050",
  lineDefault: "--line-default", lineStrong: "--line-strong", lineActive: "--line-active", lineBoard: "--line-board", focus: "--theme-focus",
  action: "--red-action", actionHover: "--red-action-hover", actionPressed: "--red-action-pressed", danger: "--red-bright", success: "--green-status",
  warning: "--theme-warning", player: "--blue-player", logoPrimary: "--theme-logo-primary", logoSecondary: "--theme-logo-secondary",
  iconPrimary: "--theme-icon-primary", iconSecondary: "--theme-icon-secondary", scrim: "--theme-scrim", scanline: "--theme-scanline",
  lineDark: "--line-dark", lineSubtle: "--line-subtle", goldMuted: "--gold-muted", redDark: "--red-dark", surfaceError: "--surface-error", lineError: "--line-error", textError: "--text-error",
  surfaceInset: "--surface-inset", surfaceSelected: "--surface-selected", surfaceHover: "--surface-hover", surfaceBoardHover: "--surface-board-hover", surfaceAvatar: "--surface-avatar", surfaceCard: "--surface-card", surfaceActive: "--surface-active", surfaceSpecial: "--surface-special", boardFrame: "--surface-board-frame", lineShadow: "--line-shadow",
});
let themeConfig = {
  getTheme: defaultGetTheme,
  isReducedMotion: () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false,
};
let transitionTimer = null;

function query(selector) {
  if (typeof document === "undefined") return null;
  return document.querySelector(selector);
}

function escapeAttribute(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
}

export function configureThemeRender({ getTheme = defaultGetTheme, isReducedMotion } = {}) {
  themeConfig = {
    getTheme: typeof getTheme === "function" ? getTheme : defaultGetTheme,
    isReducedMotion: typeof isReducedMotion === "function" ? isReducedMotion : themeConfig.isReducedMotion,
  };
}

export function themeSceneMarkup(themeOrId, surface = "page") {
  const theme = typeof themeOrId === "string" ? themeConfig.getTheme(themeOrId) : themeOrId || themeConfig.getTheme();
  const safeSurface = surface === "home" || surface === "board" ? surface : "page";
  const src = theme.scene[safeSurface] || theme.scene.page;
  const propMarkup = safeSurface === "page"
    ? ""
    : Object.entries(theme.props || {})
      .filter(([, path]) => path)
      .map(([slot, path]) => `<img class="theme-prop theme-prop-${escapeAttribute(slot)} theme-prop-${safeSurface}" src="${escapeAttribute(path)}" alt="" aria-hidden="true" width="32" height="16">`)
      .join("");
  return `<img class="theme-scene" src="${escapeAttribute(src)}" alt="" aria-hidden="true" width="88" height="36">${propMarkup}`;
}

function skylineMarkup(data, palette = SKYLINE_DEFAULTS) {
  if (!Array.isArray(data)) return "";
  const far = palette.far || SKYLINE_DEFAULTS.far;
  const near = palette.near || SKYLINE_DEFAULTS.near;
  const light = palette.light || SKYLINE_DEFAULTS.light;
  let output = "";
  data.forEach(([x, y, width, height], index) => {
    output += `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${far}"></rect>`;
    for (let row = 0; row < Math.floor((height - 2) / 3); row += 1) {
      for (let column = 0; column < Math.floor((width - 1) / 2); column += 1) {
        const lit = (row + column + index) % 3 === 0;
        output += `<rect x="${x + 1 + column * 2}" y="${y + 2 + row * 3}" width="1" height="1" fill="${lit ? light : near}"></rect>`;
      }
    }
  });
  return output;
}

function paintThemeSkyline(selector, data, palette) {
  const element = query(selector);
  if (!element) return;
  element.innerHTML = skylineMarkup(data, palette);
}

function setCssVariables(element, mapping, values, fallback = {}) {
  Object.entries(mapping).forEach(([role, variable]) => {
    const value = values?.[role] || fallback?.[role];
    if (value) element.style.setProperty(variable, value);
  });
}

function setSemanticVariables(element, semantic = {}, fallback = {}) {
  const groups = { ...(fallback.groups || {}), ...(semantic.groups || {}) };
  Object.entries(groups).forEach(([group, value]) => {
    if (value) element.style.setProperty(`--theme-group-${group.replaceAll(" ", "-")}`, value);
  });
}

function setThemeCompatibilityVariables(element, ui) {
  const aliases = {
    "--gold-050": ui.accentBright,
    "--gold-100": ui.textPrimary,
    "--gold-300": ui.accent,
    "--gold-400": ui.lineActive,
    "--gold-500": ui.lineStrong,
    "--gold-700": ui.lineDefault,
    "--gold-800": ui.lineDark,
    "--gold-muted": ui.goldMuted,
    "--red-dark": ui.redDark,
    "--surface-error": ui.surfaceError,
    "--line-error": ui.lineError,
    "--text-error": ui.textError,
  };
  Object.entries(aliases).forEach(([variable, value]) => {
    if (value) element.style.setProperty(variable, value);
  });
}

function setThemeVariables(theme) {
  if (typeof document === "undefined" || !document.body) return;
  const fallback = defaultGetTheme();
  const ui = { ...(fallback.ui || {}), ...(theme.ui || {}) };
  setCssVariables(document.body, UI_VARIABLES, ui, fallback.ui);
  setThemeCompatibilityVariables(document.body, ui);
  setSemanticVariables(document.body, theme.semantic, fallback.semantic);
  document.body.dataset.themeId = theme.id;
  Object.entries(theme.palette || {}).forEach(([role, value]) => {
    document.body.style.setProperty(`--theme-${role}`, value);
  });
  VIEW_SELECTORS.forEach((selector) => query(selector)?.setAttribute("data-theme-id", theme.id));
}

function renderLayer(selector, theme, surface, animate = true) {
  const layer = query(selector);
  if (!layer) return;
  layer.innerHTML = themeSceneMarkup(theme, surface);
  layer.dataset.themeId = theme.id;
  layer.classList.remove("is-entering");
  if (animate && !themeConfig.isReducedMotion()) {
    requestAnimationFrame(() => layer.querySelector(".theme-scene")?.classList.add("is-entering"));
  }
}

function canStartThemeTransition(shouldAnimate) {
  if (!shouldAnimate) return false;
  if (typeof document === "undefined") return false;
  return Boolean(document.body);
}

function startThemeTransition(shouldAnimate) {
  if (!canStartThemeTransition(shouldAnimate)) {
    clearThemeTransition();
    return;
  }
  document.body.dataset.themeTransition = "in";
  if (transitionTimer) globalThis.clearTimeout(transitionTimer);
  transitionTimer = globalThis.setTimeout(clearThemeTransition, 360);
}

export function renderThemeScene(themeId, surface = "page", { animate = true } = {}) {
  const theme = themeConfig.getTheme(themeId);
  if (surface === "home") {
    renderLayer("#theme-home-world", theme, "home", animate);
    paintThemeSkyline("#home-skyline", theme.skyline.home, theme.palette);
    paintThemeSkyline("#home-skyline-copy", theme.skyline.home, theme.palette);
    return;
  }
  if (surface === "board") {
    renderLayer("#theme-board-world", theme, "board", animate);
    paintThemeSkyline("#board-skyline", theme.skyline.board, theme.palette);
    return;
  }
  renderLayer("#theme-page-world", theme, "page", animate);
}

export function clearThemeTransition() {
  if (typeof document === "undefined") return;
  document.body?.removeAttribute("data-theme-transition");
  if (transitionTimer) globalThis.clearTimeout(transitionTimer);
  transitionTimer = null;
}

export function renderTheme(themeId, { animate = true } = {}) {
  const theme = themeConfig.getTheme(themeId);
  setThemeVariables(theme);
  const shouldAnimate = animate && !themeConfig.isReducedMotion();
  startThemeTransition(shouldAnimate);
  renderThemeScene(theme.id, "page", { animate: shouldAnimate });
  renderThemeScene(theme.id, "home", { animate: shouldAnimate });
  renderThemeScene(theme.id, "board", { animate: shouldAnimate });
  return theme;
}

export function pauseThemeMotion(paused) {
  if (typeof document === "undefined" || !document.body) return;
  document.body.classList.toggle("theme-motion-paused", !!paused);
}
