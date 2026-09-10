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
    skyline: { home: NIGHT_HOME_SKYLINE, board: NIGHT_BOARD_SKYLINE },
    props: {
      signature: propPath("midnight-ledger", "rooftop"),
      incident: propPath("midnight-ledger", "helicopter"),
      light: propPath("midnight-ledger", "moon"),
      weather: propPath("midnight-ledger", "windows"),
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
    skyline: { home: DAY_HOME_SKYLINE, board: DAY_BOARD_SKYLINE },
    props: {
      signature: propPath("clearline-day", "sun"),
      incident: propPath("clearline-day", "rescue"),
      light: propPath("clearline-day", "cloud"),
      weather: propPath("clearline-day", "bird"),
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
    skyline: { home: SPRING_HOME_SKYLINE, board: SPRING_BOARD_SKYLINE },
    props: {
      signature: propPath("bloom-district", "house"),
      incident: propPath("bloom-district", "blossom"),
      light: propPath("bloom-district", "fence"),
      weather: propPath("bloom-district", "bird"),
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
    skyline: { home: SUMMER_HOME_SKYLINE, board: SUMMER_BOARD_SKYLINE },
    props: {
      signature: propPath("golden-hour-exchange", "crane"),
      incident: propPath("golden-hour-exchange", "aircraft"),
      light: propPath("golden-hour-exchange", "ferry"),
      weather: propPath("golden-hour-exchange", "gull"),
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
    skyline: { home: AUTUMN_HOME_SKYLINE, board: AUTUMN_BOARD_SKYLINE },
    props: {
      signature: propPath("rainy-copper-town", "station"),
      incident: propPath("rainy-copper-town", "leaf"),
      light: propPath("rainy-copper-town", "town"),
      weather: propPath("rainy-copper-town", "rain"),
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
    skyline: { home: WINTER_HOME_SKYLINE, board: WINTER_BOARD_SKYLINE },
    props: {
      signature: propPath("warm-window-snow-city", "roof"),
      incident: propPath("warm-window-snow-city", "snow"),
      light: propPath("warm-window-snow-city", "pine"),
      weather: propPath("warm-window-snow-city", "smoke"),
    },
    motion: { homeLoop: "snowfall", incident: "rare", durationMs: 30000, maxConcurrent: 1 },
    preview: { heading: "WINTER", copy: "Snow city glow" },
  },
];

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
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
