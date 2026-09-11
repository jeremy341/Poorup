/* ============================================================
   THEME DATA: client-only environmental worlds.
   The registry is immutable so scenery cannot alter game state or
   accidentally become a second rules/configuration system.
   ============================================================ */

export const DEFAULT_THEME_ID = "midnight-ledger";
export const THEME_STORAGE_KEY = "poorup.theme.id.v1";

const NIGHT_HOME_SKYLINE = [
  [0, 24, 6, 12], [9, 17, 5, 19], [15, 27, 4, 9], [20, 12, 6, 24], [27, 21, 5, 15],
  [33, 6, 7, 30], [41, 15, 5, 21], [47, 2, 8, 34], [56, 18, 5, 18], [62, 10, 6, 26],
  [69, 22, 5, 14], [75, 15, 6, 21], [82, 25, 5, 11],
];

const NIGHT_BOARD_SKYLINE = [
  [4, 22, 6, 12], [11, 16, 5, 18], [17, 25, 4, 9], [22, 12, 6, 22], [29, 20, 5, 14],
  [35, 6, 7, 28], [43, 14, 5, 20], [49, 2, 8, 32], [58, 17, 5, 17], [64, 10, 6, 24],
  [71, 21, 5, 13], [77, 15, 6, 19],
];

const DAY_HOME_SKYLINE = [
  [0, 26, 7, 10], [10, 19, 6, 17], [18, 28, 5, 8], [25, 14, 7, 22], [34, 22, 5, 14],
  [41, 9, 6, 27], [49, 17, 5, 19], [56, 5, 7, 31], [65, 20, 5, 16], [72, 12, 6, 24],
  [80, 25, 5, 11],
];

const DAY_BOARD_SKYLINE = [
  [4, 24, 6, 10], [12, 18, 5, 18], [19, 27, 5, 9], [26, 15, 7, 21], [35, 22, 5, 14],
  [42, 8, 6, 28], [50, 16, 5, 20], [57, 6, 7, 30], [66, 20, 5, 16], [73, 12, 6, 24],
];

const SPRING_HOME_SKYLINE = [
  [0, 28, 8, 8], [11, 23, 7, 13], [21, 26, 6, 10], [30, 18, 8, 18], [41, 25, 6, 11],
  [50, 14, 7, 22], [60, 22, 6, 14], [70, 17, 8, 19], [81, 27, 6, 9],
];

const SPRING_BOARD_SKYLINE = [
  [5, 27, 7, 9], [14, 22, 6, 14], [22, 26, 5, 10], [30, 17, 7, 19], [40, 24, 6, 12],
  [49, 13, 7, 23], [59, 21, 6, 15], [69, 16, 7, 20], [79, 26, 5, 10],
];

const SUMMER_HOME_SKYLINE = [
  [0, 26, 10, 10], [13, 22, 6, 14], [22, 24, 8, 12], [33, 18, 7, 18], [43, 26, 5, 10],
  [51, 13, 8, 23], [62, 20, 7, 16], [72, 23, 5, 13], [80, 18, 8, 18],
];

const SUMMER_BOARD_SKYLINE = [
  [4, 25, 8, 11], [14, 21, 6, 15], [23, 23, 7, 13], [33, 17, 7, 19], [43, 25, 5, 11],
  [51, 12, 8, 24], [62, 19, 6, 17], [71, 22, 5, 14], [79, 17, 7, 19],
];

const AUTUMN_HOME_SKYLINE = [
  [0, 25, 8, 11], [11, 21, 7, 15], [21, 26, 6, 10], [30, 19, 7, 17], [40, 23, 8, 13],
  [51, 15, 7, 21], [61, 22, 6, 14], [70, 18, 8, 18], [81, 26, 6, 10],
];

const AUTUMN_BOARD_SKYLINE = [
  [5, 24, 7, 12], [14, 20, 6, 16], [22, 25, 5, 11], [30, 18, 7, 18], [40, 22, 7, 14],
  [50, 14, 7, 22], [60, 21, 6, 15], [69, 17, 8, 19], [79, 25, 5, 11],
];

const WINTER_HOME_SKYLINE = [
  [0, 24, 7, 12], [10, 18, 6, 18], [19, 26, 5, 10], [27, 14, 7, 22], [37, 21, 6, 15],
  [46, 8, 8, 28], [57, 17, 6, 19], [66, 23, 5, 13], [74, 12, 7, 24], [83, 25, 5, 11],
];

const WINTER_BOARD_SKYLINE = [
  [4, 23, 6, 13], [12, 17, 5, 19], [20, 25, 5, 11], [28, 13, 7, 23], [38, 20, 5, 16],
  [47, 7, 8, 29], [58, 16, 5, 20], [67, 22, 5, 14], [75, 11, 7, 25],
];

const DEFAULT_UI = {
  canvas: "#01070a", chrome: "#020a0d", panel: "#071314", panelRaised: "#09191a", panelDeep: "#030c10",
  boardTile: "#061011", boardCenter: "#031d1e", input: "#061216", buttonDark: "#081516",
  textPrimary: "#e8d3ab", textSecondary: "#a79d7d", textMuted: "#a79d7d", accent: "#cfa75f", accentBright: "#f0d9ac",
  lineDefault: "#5c5033", lineStrong: "#6b5a36", lineActive: "#c88f2e", lineBoard: "#9b783d", focus: "#f0d9ac",
  action: "#af2a21", actionHover: "#be3126", actionPressed: "#98231c", danger: "#d74438", success: "#35a653", warning: "#c88f2e", player: "#286ea1",
  logoPrimary: "#9b783d", logoSecondary: "#cfa75f", iconPrimary: "#cfa75f", iconSecondary: "#f0d9ac", scrim: "#01070acc", scanline: "#f0d9ac08",
  lineDark: "#1d2927", lineSubtle: "#3a382a", goldMuted: "#a79d7d", redDark: "#87231e", surfaceError: "#170807", lineError: "#af2a21", textError: "#f0b1a6",
  surfaceInset: "#04100f", surfaceSelected: "#0c1f1c", surfaceHover: "#0b1c1d", surfaceBoardHover: "#0a1a1a", surfaceAvatar: "#0a1416", surfaceCard: "#071516", surfaceActive: "#0d211f", surfaceSpecial: "#0c2524", boardFrame: "#020c0d", lineShadow: "#101916",
};

const DEFAULT_GROUP_COLORS = {
  brown: "#7b5029", cyan: "#3e7d7b", magenta: "#a04e6f", orange: "#b96d2a",
  red: "#87231e", yellow: "#b18a2e", green: "#4b853d", blue: "#286ea1",
};

function uiTheme(overrides = {}, deriveCompatibility = true) {
  const ui = { ...DEFAULT_UI, ...overrides };
  if (!deriveCompatibility) return ui;
  const derived = {
    lineDark: ui.lineDefault,
    lineSubtle: ui.lineDefault,
    goldMuted: ui.textMuted,
    redDark: ui.actionPressed,
    surfaceError: ui.panelDeep,
    lineError: ui.danger,
    textError: ui.textPrimary,
    surfaceInset: ui.panelDeep,
    surfaceSelected: ui.boardCenter,
    surfaceHover: ui.panelRaised,
    surfaceBoardHover: ui.boardCenter,
    surfaceAvatar: ui.panelDeep,
    surfaceCard: ui.panel,
    surfaceActive: ui.boardCenter,
    surfaceSpecial: ui.panelRaised,
    boardFrame: ui.chrome,
    lineShadow: ui.panelDeep,
  };
  Object.entries(derived).forEach(([role, value]) => {
    if (!Object.prototype.hasOwnProperty.call(overrides, role)) ui[role] = value;
  });
  return ui;
}

function semanticTheme(ui, groups = {}) {
  return {
    groups: { ...DEFAULT_GROUP_COLORS, ...groups },
    success: ui.success,
    danger: ui.danger,
    warning: ui.warning,
    player: ui.player,
    ownership: ui.accent,
    focus: ui.focus,
  };
}

function scenePath(id) {
  return `/assets/themes/${id}/scene.svg`;
}

function propPath(id, name) {
  return `/assets/themes/${id}/${name}.svg`;
}

const definitions = [
  {
    id: "midnight-ledger",
    name: "Midnight Ledger City",
    shortName: "NIGHT",
    description: "Tall blocks, warm windows, and a quiet patrol horizon.",
    ariaLabel: "Midnight Ledger City. After-hours skyline with warm windows.",
    scene: { page: scenePath("midnight-ledger"), home: scenePath("midnight-ledger"), board: scenePath("midnight-ledger") },
    palette: { sky: "#071b22", haze: "#123634", far: "#0d2725", near: "#19413d", light: "#78894f", highlight: "#6f9ca2" },
    ui: uiTheme({}, false),
    semantic: semanticTheme(uiTheme({}, false)),
    assetSlots: ["signature", "incident", "light", "weather", "detail"],
    skyline: { home: NIGHT_HOME_SKYLINE, board: NIGHT_BOARD_SKYLINE },
    props: {
      signature: propPath("midnight-ledger", "rooftop"),
      incident: propPath("midnight-ledger", "helicopter"),
      light: propPath("midnight-ledger", "moon"),
      weather: propPath("midnight-ledger", "windows"),
      detail: propPath("midnight-ledger", "beacon"),
    },
    motion: { homeLoop: "house-drift", incident: "rare", durationMs: 28000, maxConcurrent: 1 },
    preview: { heading: "NIGHT", copy: "After-hours city" },
  },
  {
    id: "clearline-day",
    name: "Clearline Day",
    shortName: "DAY",
    description: "Open civic blocks, soft clouds, and a clear rescue flight.",
    ariaLabel: "Clearline Day. Open daytime skyline with soft clouds.",
    scene: { page: scenePath("clearline-day"), home: scenePath("clearline-day"), board: scenePath("clearline-day") },
    palette: { sky: "#6f9ca2", haze: "#aac0b0", far: "#214047", near: "#2d5962", light: "#d5c38a", highlight: "#94bac2" },
    ui: uiTheme({
      canvas: "#06141a", chrome: "#092027", panel: "#0c242c", panelRaised: "#12323a", panelDeep: "#05171d",
      boardTile: "#0a2027", boardCenter: "#0a333b", input: "#0a242b", buttonDark: "#0c252d",
      textPrimary: "#eaf2e4", textSecondary: "#b7d0cc", textMuted: "#97b5b4", accent: "#e4c276", accentBright: "#fff0be",
      lineDefault: "#59808a", lineStrong: "#6e98a2", lineActive: "#d6b66a", lineBoard: "#7ca8ae", focus: "#fff0be",
      action: "#b63a2f", actionHover: "#cd4a39", actionPressed: "#932921", danger: "#e36b5f", success: "#45a66d", warning: "#d6b66a", player: "#4b91b6",
      logoPrimary: "#7ca8ae", logoSecondary: "#e4c276", iconPrimary: "#e4c276", iconSecondary: "#fff0be", scrim: "#06141acc", scanline: "#eaf2e408",
    }),
    semantic: semanticTheme(uiTheme({
      success: "#45a66d", danger: "#e36b5f", warning: "#d6b66a", player: "#4b91b6", accent: "#e4c276", focus: "#fff0be",
    })),
    assetSlots: ["signature", "incident", "light", "weather", "detail"],
    skyline: { home: DAY_HOME_SKYLINE, board: DAY_BOARD_SKYLINE },
    props: {
      signature: propPath("clearline-day", "civic-tower"),
      incident: propPath("clearline-day", "bird"),
      light: propPath("clearline-day", "sun"),
      weather: propPath("clearline-day", "cloud-bank"),
      detail: propPath("clearline-day", "cloud-small"),
    },
    motion: { homeLoop: "cloud-drift", incident: "rare", durationMs: 30000, maxConcurrent: 1 },
    preview: { heading: "DAY", copy: "Clear civic air" },
  },
  {
    id: "bloom-district",
    name: "Bloom District",
    shortName: "SPRING",
    description: "Low houses, a park ring, and one restrained blossom pass.",
    ariaLabel: "Bloom District. Spring neighborhood with blossom trees.",
    scene: { page: scenePath("bloom-district"), home: scenePath("bloom-district"), board: scenePath("bloom-district") },
    palette: { sky: "#6ea6a4", haze: "#8fb4a0", far: "#2b544d", near: "#557c63", light: "#c69092", highlight: "#b7c88f" },
    ui: uiTheme({
      canvas: "#041312", chrome: "#08201f", panel: "#0b2923", panelRaised: "#12382d", panelDeep: "#051815",
      boardTile: "#09231f", boardCenter: "#0d302b", input: "#0b2623", buttonDark: "#0d2b26",
      textPrimary: "#eaf0d2", textSecondary: "#b6c7a0", textMuted: "#94ae91", accent: "#d6c178", accentBright: "#f1e6ae",
      lineDefault: "#5a775c", lineStrong: "#6f916f", lineActive: "#d0b46a", lineBoard: "#73986f", focus: "#f1e6ae",
      action: "#a8322a", actionHover: "#c24735", actionPressed: "#84241f", danger: "#e26c5e", success: "#59a86a", warning: "#d0b46a", player: "#4e91a6",
      logoPrimary: "#6f916f", logoSecondary: "#d6c178", iconPrimary: "#d6c178", iconSecondary: "#f1e6ae", scrim: "#041312cc", scanline: "#eaf0d208",
    }),
    semantic: semanticTheme(uiTheme({
      success: "#59a86a", danger: "#e26c5e", warning: "#d0b46a", player: "#4e91a6", accent: "#d6c178", focus: "#f1e6ae",
    })),
    assetSlots: ["signature", "incident", "light", "weather", "detail"],
    skyline: { home: SPRING_HOME_SKYLINE, board: SPRING_BOARD_SKYLINE },
    props: {
      signature: propPath("bloom-district", "house"),
      incident: propPath("bloom-district", "blossom"),
      light: propPath("bloom-district", "sun"),
      weather: propPath("bloom-district", "bird"),
      detail: propPath("bloom-district", "fence"),
    },
    motion: { homeLoop: "petal-pass", incident: "rare", durationMs: 26000, maxConcurrent: 1 },
    preview: { heading: "SPRING", copy: "Blooming neighborhood" },
  },
  {
    id: "golden-hour-exchange",
    name: "Golden-Hour Exchange",
    shortName: "SUMMER",
    description: "A working waterfront, long shadows, and a distant aircraft trail.",
    ariaLabel: "Golden-Hour Exchange. Summer waterfront with long shadows.",
    scene: { page: scenePath("golden-hour-exchange"), home: scenePath("golden-hour-exchange"), board: scenePath("golden-hour-exchange") },
    palette: { sky: "#6f8f92", haze: "#8f6261", far: "#214047", near: "#31555a", light: "#d5ac57", highlight: "#b96d2a" },
    ui: uiTheme({
      canvas: "#061315", chrome: "#0b2425", panel: "#102e2b", panelRaised: "#173734", panelDeep: "#071b1b",
      boardTile: "#0c2725", boardCenter: "#123735", input: "#102b29", buttonDark: "#122f2c",
      textPrimary: "#f4e3b7", textSecondary: "#d0b886", textMuted: "#aa9a6c", accent: "#e7b94e", accentBright: "#fff0b2",
      lineDefault: "#7a6942", lineStrong: "#967f4b", lineActive: "#e0b557", lineBoard: "#b18a4d", focus: "#fff0b2",
      action: "#b83b2e", actionHover: "#d24b36", actionPressed: "#92271f", danger: "#e77758", success: "#5aa060", warning: "#e0b557", player: "#4a92b1",
      logoPrimary: "#b18a4d", logoSecondary: "#e7b94e", iconPrimary: "#e7b94e", iconSecondary: "#fff0b2", scrim: "#061315cc", scanline: "#f4e3b708",
    }),
    semantic: semanticTheme(uiTheme({
      success: "#5aa060", danger: "#e77758", warning: "#e0b557", player: "#4a92b1", accent: "#e7b94e", focus: "#fff0b2",
    })),
    assetSlots: ["signature", "incident", "light", "weather", "detail"],
    skyline: { home: SUMMER_HOME_SKYLINE, board: SUMMER_BOARD_SKYLINE },
    props: {
      signature: propPath("golden-hour-exchange", "crane"),
      incident: propPath("golden-hour-exchange", "gull"),
      light: propPath("golden-hour-exchange", "sun"),
      weather: propPath("golden-hour-exchange", "ferry"),
      detail: propPath("golden-hour-exchange", "palm"),
    },
    motion: { homeLoop: "waterline", incident: "rare", durationMs: 30000, maxConcurrent: 1 },
    preview: { heading: "SUMMER", copy: "Waterfront exchange" },
  },
  {
    id: "rainy-copper-town",
    name: "Rainy Copper Town",
    shortName: "AUTUMN",
    description: "Wet streets, warm windows, and a low cloud over the station.",
    ariaLabel: "Rainy Copper Town. Autumn town in a steady soft rain.",
    scene: { page: scenePath("rainy-copper-town"), home: scenePath("rainy-copper-town"), board: scenePath("rainy-copper-town") },
    palette: { sky: "#32474b", haze: "#6e4a36", far: "#20383a", near: "#4f5545", light: "#a8613e", highlight: "#b39b70" },
    ui: uiTheme({
      canvas: "#101417", chrome: "#1b2222", panel: "#222c2a", panelRaised: "#2b3730", panelDeep: "#111b1c",
      boardTile: "#1a2928", boardCenter: "#243b35", input: "#22302e", buttonDark: "#263530",
      textPrimary: "#f3dfc0", textSecondary: "#c3aa87", textMuted: "#a88e6f", accent: "#d28c47", accentBright: "#f5c27a",
      lineDefault: "#80633f", lineStrong: "#9a7850", lineActive: "#d3984a", lineBoard: "#ad7c4d", focus: "#f5c27a",
      action: "#b13a2b", actionHover: "#cb4b35", actionPressed: "#8c2821", danger: "#e06e57", success: "#6e9b5c", warning: "#d3984a", player: "#4e8a9b",
      logoPrimary: "#ad7c4d", logoSecondary: "#d28c47", iconPrimary: "#d28c47", iconSecondary: "#f5c27a", scrim: "#101417d9", scanline: "#f3dfc008",
    }),
    semantic: semanticTheme(uiTheme({
      success: "#6e9b5c", danger: "#e06e57", warning: "#d3984a", player: "#4e8a9b", accent: "#d28c47", focus: "#f5c27a",
    })),
    assetSlots: ["signature", "incident", "light", "weather", "detail"],
    skyline: { home: AUTUMN_HOME_SKYLINE, board: AUTUMN_BOARD_SKYLINE },
    props: {
      signature: propPath("rainy-copper-town", "station"),
      incident: propPath("rainy-copper-town", "leaf"),
      light: propPath("rainy-copper-town", "town"),
      weather: propPath("rainy-copper-town", "rain"),
      detail: propPath("rainy-copper-town", "street-lamp"),
    },
    motion: { homeLoop: "rain-strip", incident: "rare", durationMs: 28000, maxConcurrent: 1 },
    preview: { heading: "AUTUMN", copy: "Rainy copper town" },
  },
  {
    id: "warm-window-snow-city",
    name: "Warm Window Snow City",
    shortName: "WINTER",
    description: "Snow-capped blocks, pine edges, and warm apartment windows.",
    ariaLabel: "Warm Window Snow City. Snowy city with warm apartment windows.",
    scene: { page: scenePath("warm-window-snow-city"), home: scenePath("warm-window-snow-city"), board: scenePath("warm-window-snow-city") },
    palette: { sky: "#638b9a", haze: "#b8c4bb", far: "#12343c", near: "#2e5148", light: "#d5c38a", highlight: "#8aa3ae" },
    ui: uiTheme({
      canvas: "#051016", chrome: "#081a22", panel: "#0d232b", panelRaised: "#12303a", panelDeep: "#04131a",
      boardTile: "#0a2029", boardCenter: "#0f323d", input: "#0b222a", buttonDark: "#0e2a34",
      textPrimary: "#e7f0e8", textSecondary: "#b6cad0", textMuted: "#91adb5", accent: "#c7d3d0", accentBright: "#f4f1d6",
      lineDefault: "#5f7480", lineStrong: "#7693a0", lineActive: "#d6b76e", lineBoard: "#8aa3ae", focus: "#f4f1d6",
      action: "#a83238", actionHover: "#c44143", actionPressed: "#82272e", danger: "#e2756d", success: "#5ba17b", warning: "#d6b76e", player: "#4b8fb4",
      logoPrimary: "#8aa3ae", logoSecondary: "#c7d3d0", iconPrimary: "#c7d3d0", iconSecondary: "#f4f1d6", scrim: "#051016d9", scanline: "#e7f0e808",
    }),
    semantic: semanticTheme(uiTheme({
      success: "#5ba17b", danger: "#e2756d", warning: "#d6b76e", player: "#4b8fb4", accent: "#c7d3d0", focus: "#f4f1d6",
    })),
    assetSlots: ["signature", "incident", "light", "weather", "detail"],
    skyline: { home: WINTER_HOME_SKYLINE, board: WINTER_BOARD_SKYLINE },
    props: {
      signature: propPath("warm-window-snow-city", "ice-roof"),
      incident: propPath("warm-window-snow-city", "snow"),
      light: propPath("warm-window-snow-city", "moon"),
      weather: propPath("warm-window-snow-city", "smoke"),
      detail: propPath("warm-window-snow-city", "pine"),
    },
    motion: { homeLoop: "snowfall", incident: "rare", durationMs: 30000, maxConcurrent: 1 },
    preview: { heading: "WINTER", copy: "Snow city glow" },
  },
];

function isFreezable(value) {
  return value !== null && typeof value === "object";
}

function deepFreeze(value) {
  if (!isFreezable(value)) return value;
  if (Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const frozenDefinitions = definitions.map((definition) => deepFreeze(definition));

export const THEME_IDS = Object.freeze(frozenDefinitions.map((theme) => theme.id));
export const THEMES = deepFreeze(Object.fromEntries(frozenDefinitions.map((theme) => [theme.id, theme])));
const THEME_OPTIONS = Object.freeze(THEME_IDS.map((id) => THEMES[id]));

export function sanitizeThemeId(value) {
  if (typeof value !== "string") return DEFAULT_THEME_ID;
  const normalized = value.trim().toLowerCase();
  return THEMES[normalized] ? normalized : DEFAULT_THEME_ID;
}

export function getTheme(value) {
  return THEMES[sanitizeThemeId(value)];
}

export function themeOptions() {
  return THEME_OPTIONS;
}
