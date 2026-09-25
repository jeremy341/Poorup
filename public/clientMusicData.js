export const MUSIC_PREFERENCES_STORAGE_KEY = "poorup.music.preferences";

const rawTracks = {
  "pondering-the-cosmos": { id: "pondering-the-cosmos", title: "Pondering the Cosmos", artist: "Ruskerdax", src: "/assets/audio/pondering-the-cosmos.mp3", status: "approved", license: "CC0/public domain", source: "https://opengameart.org/content/pondering-the-cosmos" },
  "hot-springs-town": { id: "hot-springs-town", title: "Hot Springs Town", artist: "Kistol", src: "/assets/audio/themes/spring/hot-springs-town.mp3", status: "approved", license: "CC0", source: "https://opengameart.org/content/hot-springs-town" },
  "apple-cider": { id: "apple-cider", title: "Apple Cider", artist: "Zane Little Music", src: "/assets/audio/themes/spring/apple-cider.ogg", status: "approved", license: "CC0", source: "https://opengameart.org/content/apple-cider" },
  summers: { id: "summers", title: "Summers", artist: "symphony", src: "/assets/audio/themes/summer/summers.mp3", status: "approved", license: "CC0 with requested credit", source: "https://opengameart.org/content/summers" },
  "funked-up": { id: "funked-up", title: "Funked Up", artist: "Joth", src: "/assets/audio/themes/summer/funked-up.mp3", status: "approved", license: "CC0", source: "https://opengameart.org/content/funked-up" },
  autumn: { id: "autumn", title: "Autumn", artist: "Duasun", src: "/assets/audio/themes/autumn/autumn.mp3", status: "approved", license: "CC0", source: "https://opengameart.org/content/autumn-mp3-free-music" },
  "autumn-colors": { id: "autumn-colors", title: "Autumn Colors", artist: "shiru8bit", src: "/assets/audio/themes/autumn/autumn-colors.mp3", status: "approved", license: "CC-BY 3.0", attribution: "shiru8bit", source: "https://opengameart.org/content/8-bit-chiptune-autumn-colors" },
  "snowy-village": { id: "snowy-village", title: "Snowy Village", artist: "Louswan", src: "/assets/audio/themes/winter/snowy-village.ogg", status: "approved", license: "CC-BY 3.0", attribution: "Louswan", source: "https://opengameart.org/content/snowy-village" },
  "through-the-snow": { id: "through-the-snow", title: "Through the Snow", artist: "Cleyton Kauffman", src: "/assets/audio/themes/winter/through-the-snow.ogg", status: "approved", license: "CC0", source: "https://opengameart.org/content/snow-theme" },
  town: { id: "town", title: "Town", artist: "Pro Sensory", src: "/assets/audio/themes/light/town.mp3", status: "approved", license: "Public domain", source: "https://opengameart.org/content/town" },
  frogtown: { id: "frogtown", title: "FrogTown", artist: "LushoGames", src: "/assets/audio/themes/light/frogtown.mp3", status: "approved", license: "CC0", source: "https://opengameart.org/content/frogtown" },
  "urban-theme": { id: "urban-theme", title: "Urban Theme", artist: "MintoDog", src: "/assets/audio/themes/light/urban-theme.ogg", status: "approved", license: "CC0", source: "https://opengameart.org/content/urban-theme" },
};
const defaults = { original: "pondering-the-cosmos", spring: "hot-springs-town", summer: "summers", autumn: "autumn", winter: "snowy-village", light: "town" };
const hasOwn = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const themeQueues = {
  original: ["pondering-the-cosmos"],
  spring: ["hot-springs-town", "apple-cider"],
  summer: ["summers", "funked-up"],
  autumn: ["autumn", "autumn-colors"],
  winter: ["snowy-village", "through-the-snow"],
  light: ["town", "frogtown", "urban-theme"],
};
export const MUSIC_MANIFEST = Object.freeze({ tracks: Object.freeze(Object.fromEntries(Object.entries(rawTracks).map(([id, track]) => [id, Object.freeze(track)]))), defaults: Object.freeze(defaults), themes: Object.freeze(Object.fromEntries(Object.entries(themeQueues).map(([theme, queue]) => [theme, Object.freeze(queue)]))) });

export function sanitizeTrackId(value, manifest = MUSIC_MANIFEST) { return typeof value === "string" && hasOwn(manifest?.tracks, value) && manifest.tracks[value]?.status === "approved" ? value : null; }
export function sanitizeThemeId(value, manifest = MUSIC_MANIFEST) { return typeof value === "string" && hasOwn(manifest?.defaults, value) ? value : "original"; }
export function resolveThemeTrack(themeId, manifest = MUSIC_MANIFEST) {
  const safeTheme = sanitizeThemeId(themeId, manifest);
  const id = hasOwn(manifest?.defaults, safeTheme) ? manifest.defaults[safeTheme] : null;
  return sanitizeTrackId(id, manifest);
}
