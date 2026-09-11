/* ============================================================
   THEME DATA: five original Poorup worlds plus the untouched baseline.
   This registry is client-only: a theme can never enter room/game state.
   ============================================================ */

export const DEFAULT_THEME_ID = "original";
export const THEME_STORAGE_KEY = "poorup.theme.id.v2";

const scenePath = (id) => `/assets/themes/${id}/scene.svg`;
const propPath = (id, name) => `/assets/themes/${id}/${name}.svg`;

const BASE_SKYLINE = [
  [0, 24, 6, 12], [9, 17, 5, 19], [15, 27, 4, 9], [20, 12, 6, 24], [27, 21, 5, 15],
  [33, 6, 7, 30], [41, 15, 5, 21], [47, 2, 8, 34], [56, 18, 5, 18], [62, 10, 6, 26],
  [69, 22, 5, 14], [75, 15, 6, 21], [82, 25, 5, 11],
];

const THEMES = [
  {
    id: "original",
    name: "Original / Dark Baseline",
    shortName: "ORIGINAL",
    description: "The original dark Poorup parlor, exactly as shipped.",
    ariaLabel: "Original dark baseline. The unchanged Poorup night parlor.",
    preview: { heading: "ORIGINAL", copy: "Dark baseline" },
    scene: null,
    props: {},
    tokens: {},
    palette: {},
    skyline: { home: BASE_SKYLINE, board: BASE_SKYLINE },
    motion: { weather: "none", durationMs: 0 },
  },
  {
    id: "spring",
    name: "Spring / Bloom Ledger",
    shortName: "SPRING",
    description: "A bright neighborhood with blossom trees and a park edge.",
    ariaLabel: "Spring Bloom Ledger. Blue sky, low homes, green trees, and pink blossoms.",
    preview: { heading: "SPRING", copy: "Blooming neighborhood" },
    scene: scenePath("spring"),
    props: {
      clouds: propPath("spring", "clouds"),
      light: propPath("spring", "light"),
      signature: propPath("spring", "signature"),
      petals: propPath("spring", "petals"),
      accent: propPath("spring", "accent"),
    },
    palette: { far: "#7b9fac", near: "#4e7863", light: "#ffd0db" },
    skyline: { home: BASE_SKYLINE, board: BASE_SKYLINE },
    motion: { weather: "petal", durationMs: 11000 },
    tokens: {
      "--bg-canvas": "#071b24", "--bg-chrome": "#09232a",
      "--surface-panel": "#0b2a2d", "--surface-panel-raised": "#123b38", "--surface-panel-deep": "#06191f",
      "--surface-board-tile": "#0a2229", "--surface-board-center": "#0d3435", "--surface-input": "#0b282b", "--surface-button-dark": "#0e3030",
      "--text-primary": "#ecf1d7", "--text-secondary": "#b9d1a3", "--text-muted": "#94b49b",
      "--gold-050": "#f4e9b4", "--gold-100": "#e7d89a", "--gold-300": "#d6c46f", "--gold-400": "#b5a24e", "--gold-500": "#7c8147", "--gold-muted": "#a8bd93",
      "--line-dark": "#163436", "--line-subtle": "#35594d", "--line-default": "#66845e", "--line-strong": "#7fa06c", "--line-active": "#d6c46f", "--line-board": "#9bb479", "--line-shadow": "#061419",
      "--red-action": "#2f8754", "--red-action-hover": "#3b9f63", "--red-action-pressed": "#23663f",
      "--surface-inset": "#071d22", "--surface-selected": "#173f36", "--surface-hover": "#154038", "--surface-board-hover": "#12332f", "--surface-avatar": "#0b2427", "--surface-card": "#0b2629", "--surface-active": "#194b3d", "--surface-special": "#174438", "--surface-board-frame": "#071d22",
      "--theme-focus": "#fff3bd", "--theme-warning": "#d6c46f", "--theme-logo-primary": "#7fa06c", "--theme-logo-secondary": "#d6c46f", "--theme-icon-primary": "#d6c46f", "--theme-icon-secondary": "#fff3bd", "--theme-scrim": "#061419d9", "--theme-scanline": "#eaf1d60b", "--theme-action-edge": "#3b9f63", "--theme-action-shadow": "#23663f", "--theme-action-shadow-muted": "#1a4b30", "--wordmark-color": "#e0b972", "--wordmark-shadow-1": "#b8863a", "--wordmark-shadow-2": "#8a6321", "--wordmark-shadow-3": "#4a3512", "--surface-button-hover": "#154038", "--surface-button-pressed": "#0e3028", "--surface-disabled": "#12372f", "--field-placeholder": "#94b49b", "--theme-setup-scrim": "#061419d9", "--theme-gallery-scrim": "#061419e8", "--surface-card-highlight": "#164038", "--go-shadow-1": "#b8863a", "--go-shadow-2": "#8a6321", "--night-shadow": "#8a6321",
    },
  },
  {
    id: "summer",
    name: "Summer / Solar Exchange",
    shortName: "SUMMER",
    description: "A golden waterfront with a crane, ferry, and long afternoon light.",
    ariaLabel: "Summer Solar Exchange. Golden sky, waterfront, crane, and ferry.",
    preview: { heading: "SUMMER", copy: "Waterfront exchange" },
    scene: scenePath("summer"),
    props: {
      clouds: propPath("summer", "clouds"),
      light: propPath("summer", "light"),
      signature: propPath("summer", "signature"),
      weather: propPath("summer", "weather"),
      accent: propPath("summer", "accent"),
    },
    palette: { far: "#9b8562", near: "#586b65", light: "#ffe3a0" },
    skyline: { home: BASE_SKYLINE, board: BASE_SKYLINE },
    motion: { weather: "water", durationMs: 14000 },
    tokens: {
      "--bg-canvas": "#111c22", "--bg-chrome": "#12282d",
      "--surface-panel": "#183333", "--surface-panel-raised": "#23443f", "--surface-panel-deep": "#0c2025",
      "--surface-board-tile": "#122c30", "--surface-board-center": "#1a4240", "--surface-input": "#173737", "--surface-button-dark": "#1d3f3c",
      "--text-primary": "#f7eac3", "--text-secondary": "#d8c794", "--text-muted": "#b2a26f",
      "--gold-050": "#fff2bf", "--gold-100": "#f5df9c", "--gold-300": "#e5bd57", "--gold-400": "#c89329", "--gold-500": "#9b7330", "--gold-muted": "#c6b478",
      "--line-dark": "#24423f", "--line-subtle": "#5c6247", "--line-default": "#8b7946", "--line-strong": "#a68d4c", "--line-active": "#e7bd53", "--line-board": "#c89f4b", "--line-shadow": "#0b171c",
      "--red-action": "#b27619", "--red-action-hover": "#c88b26", "--red-action-pressed": "#7d5112",
      "--surface-inset": "#10272b", "--surface-selected": "#25493f", "--surface-hover": "#244a45", "--surface-board-hover": "#1d3e3b", "--surface-avatar": "#163335", "--surface-card": "#173637", "--surface-active": "#2c5548", "--surface-special": "#285149", "--surface-board-frame": "#10272b",
      "--theme-focus": "#fff3bd", "--theme-warning": "#e7bd53", "--theme-logo-primary": "#c89f4b", "--theme-logo-secondary": "#e7bd53", "--theme-icon-primary": "#e7bd53", "--theme-icon-secondary": "#fff3bd", "--theme-scrim": "#0b171cd9", "--theme-scanline": "#fff0b20b", "--theme-action-edge": "#e0a336", "--theme-action-shadow": "#7d5112", "--theme-action-shadow-muted": "#60400e", "--wordmark-color": "#62471a", "--wordmark-shadow-1": "#d19d39", "--wordmark-shadow-2": "#9a6b23", "--wordmark-shadow-3": "#4a3512", "--surface-button-hover": "#244a45", "--surface-button-pressed": "#183a37", "--surface-disabled": "#1d403b", "--field-placeholder": "#b2a26f", "--theme-setup-scrim": "#0b171cd9", "--theme-gallery-scrim": "#0b171ce8", "--surface-card-highlight": "#244a45", "--go-shadow-1": "#d19d39", "--go-shadow-2": "#9a6b23", "--night-shadow": "#9a6b23",
    },
  },
  {
    id: "autumn",
    name: "Autumn / Copper Rain",
    shortName: "AUTUMN",
    description: "A slate town in the rain with copper trees and warm windows.",
    ariaLabel: "Autumn Copper Rain. Gray sky, rust leaves, old town, and wet streets.",
    preview: { heading: "AUTUMN", copy: "Copper rain town" },
    scene: scenePath("autumn"),
    props: {
      clouds: propPath("autumn", "clouds"),
      light: propPath("autumn", "light"),
      signature: propPath("autumn", "signature"),
      weather: propPath("autumn", "weather"),
      accent: propPath("autumn", "accent"),
    },
    palette: { far: "#626e7b", near: "#493e40", light: "#f2bd72" },
    skyline: { home: BASE_SKYLINE, board: BASE_SKYLINE },
    motion: { weather: "leaves", durationMs: 9000 },
    tokens: {
      "--bg-canvas": "#11181c", "--bg-chrome": "#1c2728",
      "--surface-panel": "#252f2d", "--surface-panel-raised": "#303b34", "--surface-panel-deep": "#141e21",
      "--surface-board-tile": "#1d2b2c", "--surface-board-center": "#2b403a", "--surface-input": "#263633", "--surface-button-dark": "#2a3a35",
      "--text-primary": "#f4e2c5", "--text-secondary": "#c6ab88", "--text-muted": "#a99073",
      "--gold-050": "#f6d9a4", "--gold-100": "#e9bf82", "--gold-300": "#d28c47", "--gold-400": "#b86d35", "--gold-500": "#8e5b38", "--gold-muted": "#b89b78",
      "--line-dark": "#2d3c3a", "--line-subtle": "#5b5d4a", "--line-default": "#80633f", "--line-strong": "#9a7850", "--line-active": "#d3984a", "--line-board": "#b77b4b", "--line-shadow": "#0e1619",
      "--red-action": "#b13a2b", "--red-action-hover": "#cb4b35", "--red-action-pressed": "#8c2821",
      "--surface-inset": "#172326", "--surface-selected": "#3a4032", "--surface-hover": "#38453b", "--surface-board-hover": "#2b3935", "--surface-avatar": "#202e2d", "--surface-card": "#263532", "--surface-active": "#45513e", "--surface-special": "#3f4b3a", "--surface-board-frame": "#172326",
      "--theme-focus": "#f5c27a", "--theme-warning": "#d3984a", "--theme-logo-primary": "#ad7c4d", "--theme-logo-secondary": "#d28c47", "--theme-icon-primary": "#d28c47", "--theme-icon-secondary": "#f5c27a", "--theme-scrim": "#0e1619dc", "--theme-scanline": "#f3dfc00b", "--theme-action-edge": "#e06e57", "--theme-action-shadow": "#8c2821", "--theme-action-shadow-muted": "#5a1d18", "--wordmark-color": "#f1c978", "--wordmark-shadow-1": "#b77b4b", "--wordmark-shadow-2": "#815036", "--wordmark-shadow-3": "#3c2a26", "--surface-button-hover": "#38453b", "--surface-button-pressed": "#2b3935", "--surface-disabled": "#303b34", "--field-placeholder": "#a99073", "--theme-setup-scrim": "#0e1619dc", "--theme-gallery-scrim": "#0e1619e8", "--surface-card-highlight": "#38453b", "--go-shadow-1": "#b77b4b", "--go-shadow-2": "#815036", "--night-shadow": "#815036",
    },
  },
  {
    id: "winter",
    name: "Winter / Frostline Ledger",
    shortName: "WINTER",
    description: "A blue-hour city with snow-capped roofs, pines, and warm windows.",
    ariaLabel: "Winter Frostline Ledger. Snowy roofs, pines, and a quiet blue-hour city.",
    preview: { heading: "WINTER", copy: "Snow city glow" },
    scene: scenePath("winter"),
    props: {
      clouds: propPath("winter", "clouds"),
      light: propPath("winter", "light"),
      signature: propPath("winter", "signature"),
      weather: propPath("winter", "weather"),
      accent: propPath("winter", "accent"),
    },
    palette: { far: "#416080", near: "#203e55", light: "#f0c878" },
    skyline: { home: BASE_SKYLINE, board: BASE_SKYLINE },
    motion: { weather: "snow", durationMs: 12000 },
    tokens: {
      "--bg-canvas": "#07121d", "--bg-chrome": "#0a1c2a",
      "--surface-panel": "#102936", "--surface-panel-raised": "#173847", "--surface-panel-deep": "#061923",
      "--surface-board-tile": "#0d2532", "--surface-board-center": "#123b48", "--surface-input": "#102c38", "--surface-button-dark": "#153440",
      "--text-primary": "#e7f1ed", "--text-secondary": "#b8ccd3", "--text-muted": "#91adb7",
      "--gold-050": "#f4f1d6", "--gold-100": "#d9e1d9", "--gold-300": "#b9c8c5", "--gold-400": "#9ab5bd", "--gold-500": "#718f9b", "--gold-muted": "#a8c0c5",
      "--line-dark": "#1a3543", "--line-subtle": "#405e6a", "--line-default": "#5f7480", "--line-strong": "#7693a0", "--line-active": "#b9d2d3", "--line-board": "#8aa3ae", "--line-shadow": "#040d15",
      "--red-action": "#1f6073", "--red-action-hover": "#2e7d91", "--red-action-pressed": "#164555",
      "--surface-inset": "#0a202b", "--surface-selected": "#183f4a", "--surface-hover": "#1a4651", "--surface-board-hover": "#153844", "--surface-avatar": "#102a35", "--surface-card": "#112f3a", "--surface-active": "#1d4d5a", "--surface-special": "#1b4652", "--surface-board-frame": "#0a202b",
      "--theme-focus": "#f4f1d6", "--theme-warning": "#d6b76e", "--theme-logo-primary": "#8aa3ae", "--theme-logo-secondary": "#c7d3d0", "--theme-icon-primary": "#c7d3d0", "--theme-icon-secondary": "#f4f1d6", "--theme-scrim": "#040d15df", "--theme-scanline": "#e7f0e80b", "--theme-action-edge": "#2e7d91", "--theme-action-shadow": "#164555", "--theme-action-shadow-muted": "#0f3140", "--wordmark-color": "#f4e7b8", "--wordmark-shadow-1": "#8aa3ae", "--wordmark-shadow-2": "#516f82", "--wordmark-shadow-3": "#203848", "--surface-button-hover": "#1a4651", "--surface-button-pressed": "#153844", "--surface-disabled": "#173847", "--field-placeholder": "#91adb7", "--theme-setup-scrim": "#040d15df", "--theme-gallery-scrim": "#040d15e8", "--surface-card-highlight": "#1a4651", "--go-shadow-1": "#8aa3ae", "--go-shadow-2": "#516f82", "--night-shadow": "#516f82",
    },
  },
  {
    id: "light",
    name: "Light / Clear Day",
    shortName: "LIGHT",
    description: "A clear blue-green day over the same dark Poorup instruments.",
    ariaLabel: "Light Clear Day. Pale sky, clouds, civic blocks, and dark Poorup panels.",
    preview: { heading: "LIGHT", copy: "Clear day" },
    scene: scenePath("light"),
    props: {
      clouds: propPath("light", "clouds"),
      light: propPath("light", "light"),
      signature: propPath("light", "signature"),
      weather: propPath("light", "weather"),
      pedestrians: {
        poseA: propPath("light", "pedestrians-pose-a"),
        poseB: propPath("light", "pedestrians-pose-b"),
      },
    },
    palette: { far: "#a5b8ba", near: "#6b8d9a", light: "#f7f3dd" },
    skyline: { home: BASE_SKYLINE, board: BASE_SKYLINE },
    motion: { weather: "cloud", durationMs: 15000 },
    tokens: {
      "--bg-canvas": "#08323c", "--bg-chrome": "#0b252c",
      "--surface-panel": "#09282e", "--surface-panel-raised": "#10383d", "--surface-panel-deep": "#061c23",
      "--surface-board-tile": "#0a252d", "--surface-board-center": "#0f3d43", "--surface-input": "#0a2930", "--surface-button-dark": "#0d3336",
      "--text-primary": "#e8f0d9", "--text-secondary": "#b5cdbb", "--text-muted": "#8eb2ae",
      "--gold-050": "#eef3d7", "--gold-100": "#e2e9c7", "--gold-300": "#d7c96d", "--gold-400": "#b6a64d", "--gold-500": "#7c8f63", "--gold-muted": "#a4c0ae",
      "--line-dark": "#18424a", "--line-subtle": "#4f7472", "--line-default": "#69918a", "--line-strong": "#82aba0", "--line-active": "#d7c96d", "--line-board": "#9dbbad", "--line-shadow": "#06161b",
      "--red-action": "#2d8755", "--red-action-hover": "#3ba267", "--red-action-pressed": "#22663f",
      "--surface-inset": "#09242b", "--surface-selected": "#154139", "--surface-hover": "#154b45", "--surface-board-hover": "#123b3d", "--surface-avatar": "#0b2930", "--surface-card": "#0b2b30", "--surface-active": "#1a5144", "--surface-special": "#17473f", "--surface-board-frame": "#08242b",
      "--theme-focus": "#122e3a", "--theme-warning": "#d7c96d", "--theme-logo-primary": "#5c8290", "--theme-logo-secondary": "#d7c96d", "--theme-icon-primary": "#d7c96d", "--theme-icon-secondary": "#f5f6d6", "--theme-scrim": "#06161bd9", "--theme-scanline": "#eff6de0b", "--theme-action-edge": "#3ba267", "--theme-action-shadow": "#22663f", "--theme-action-shadow-muted": "#17472f", "--wordmark-color": "#1f4154", "--wordmark-shadow-1": "#5e919d", "--wordmark-shadow-2": "#3c6f7b", "--wordmark-shadow-3": "#183a43", "--surface-button-hover": "#154b45", "--surface-button-pressed": "#123b3d", "--surface-disabled": "#10383d", "--field-placeholder": "#8eb2ae", "--theme-setup-scrim": "#06161bd9", "--theme-gallery-scrim": "#06161be8", "--surface-card-highlight": "#154b45", "--go-shadow-1": "#5e919d", "--go-shadow-2": "#3c6f7b", "--night-shadow": "#3c6f7b",
    },
  },
];

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const frozenThemes = deepFreeze(THEMES);
export const THEME_IDS = Object.freeze(frozenThemes.map((theme) => theme.id));
export const THEME_OPTIONS = Object.freeze(frozenThemes.slice());

export function sanitizeThemeId(value) {
  if (typeof value !== "string") return DEFAULT_THEME_ID;
  const normalized = value.trim().toLowerCase();
  return THEME_IDS.includes(normalized) ? normalized : DEFAULT_THEME_ID;
}

export function getTheme(value = DEFAULT_THEME_ID) {
  const id = sanitizeThemeId(value);
  return frozenThemes.find((theme) => theme.id === id) || frozenThemes[0];
}

export function themeOptions() {
  return THEME_OPTIONS;
}
