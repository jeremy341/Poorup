const rawTracks = {
  "pondering-the-cosmos": { id: "pondering-the-cosmos", title: "Pondering the Cosmos", artist: "Poorup", src: "/assets/audio/pondering-the-cosmos.mp3", status: "approved", license: "Original" },
  "hot-springs-town": { id: "hot-springs-town", title: "Hot Springs Town", artist: "Kistol", src: "/assets/audio/hot-springs-town.mp3", status: "not-shipped", license: "CC0", source: "https://opengameart.org/content/hot-springs-town" },
  summers: { id: "summers", title: "Summers", artist: "symphony", src: "/assets/audio/summers.mp3", status: "not-shipped", license: "CC0 with requested credit", source: "https://opengameart.org/content/summers" },
  autumn: { id: "autumn", title: "Autumn", artist: "Duasun", src: "/assets/audio/autumn.mp3", status: "not-shipped", license: "CC0", source: "https://opengameart.org/content/autumn-mp3-free-music" },
  "snowy-village": { id: "snowy-village", title: "Snowy Village", artist: "Louswan", src: "/assets/audio/snowy-village.ogg", status: "not-shipped", license: "CC-BY 3.0", attribution: "Louswan", source: "https://opengameart.org/content/snowy-village" },
  town: { id: "town", title: "Town", artist: "Pro Sensory", src: "/assets/audio/town.mp3", status: "not-shipped", license: "Public domain", source: "https://opengameart.org/content/town" },
};
const defaults = { original: "pondering-the-cosmos", spring: "hot-springs-town", summer: "summers", autumn: "autumn", winter: "snowy-village", light: "town" };
export const MUSIC_MANIFEST = Object.freeze({ tracks: Object.freeze(Object.fromEntries(Object.entries(rawTracks).map(([id, track]) => [id, Object.freeze(track)]))), defaults: Object.freeze(defaults), themes: Object.freeze(Object.fromEntries(Object.keys(defaults).map(theme => [theme, Object.freeze([defaults[theme]])]))) });

export function sanitizeTrackId(value, manifest = MUSIC_MANIFEST) { return typeof value === "string" && manifest.tracks[value]?.status === "approved" ? value : null; }
export function sanitizeThemeId(value, manifest = MUSIC_MANIFEST) { return typeof value === "string" && manifest.defaults[value] ? value : "original"; }
export function resolveThemeTrack(themeId, manifest = MUSIC_MANIFEST) { const id = manifest.defaults[sanitizeThemeId(themeId, manifest)]; return sanitizeTrackId(id, manifest) || "pondering-the-cosmos"; }
