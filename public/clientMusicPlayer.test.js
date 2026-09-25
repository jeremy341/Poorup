/* global process */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createMusicPlayer } from "./clientMusicPlayer.js";
import { MUSIC_MANIFEST, sanitizeThemeId, sanitizeTrackId } from "./clientMusicData.js";

function media() {
  return { src: "", volume: 0, currentTime: 0, paused: true, play() { return Promise.resolve(); }, pause() {} };
}
function setup(overrides = {}) {
  const audioA = media(); const audioB = media(); const values = new Map();
  const player = createMusicPlayer({ audioA, audioB, manifest: MUSIC_MANIFEST,
    getThemeId: () => "original", storage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) },
    announce: message => { player.lastAnnouncement = message; }, now: () => 0,
    requestFrame: fn => { fn(); return 1; }, cancelFrame: () => {}, reducedMotion: true, ...overrides });
  return { player, audioA, audioB, values };
}
function test(name, fn) { try { fn(); console.log(`ok - ${name}`); } catch (error) { console.error(`not ok - ${name}\n${error.stack}`); process.exitCode = 1; } }

test("manifest is frozen and rejects arbitrary tracks", () => {
  assert.equal(Object.isFrozen(MUSIC_MANIFEST), true);
  assert.equal(MUSIC_MANIFEST.defaults.original, "pondering-the-cosmos");
  assert.equal(MUSIC_MANIFEST.tracks["evil"], undefined);
  assert.equal(MUSIC_MANIFEST.tracks["pondering-the-cosmos"].artist, "Ruskerdax");
  assert.equal(MUSIC_MANIFEST.tracks["pondering-the-cosmos"].license, "CC0/public domain");
  assert.equal(sanitizeTrackId("toString"), null);
  assert.equal(sanitizeThemeId("__proto__"), "original");
});
test("approved secondary tracks stay theme-scoped and locally credited", () => {
  const expected = [
    ["apple-cider", "spring", "Zane Little Music", "CC0"],
    ["funked-up", "summer", "Joth", "CC0"],
    ["autumn-colors", "autumn", "shiru8bit", "CC-BY 3.0"],
    ["through-the-snow", "winter", "Cleyton Kauffman", "CC0"],
    ["frogtown", "light", "LushoGames", "CC0"],
    ["urban-theme", "light", "MintoDog", "CC0"],
  ];
  const root = new URL("./", import.meta.url);
  const audioReadme = fs.readFileSync(new URL("./assets/audio/README.md", root), "utf8");
  for (const [id, theme, creator, license] of expected) {
    const track = MUSIC_MANIFEST.tracks[id];
    assert.equal(MUSIC_MANIFEST.themes[theme].includes(id), true, `${id} belongs to ${theme}`);
    assert.equal(track.artist, creator);
    assert.equal(track.license, license);
    assert.equal(fs.existsSync(new URL(`.${track.src}`, root)), true, `${id} audio file exists`);
    assert.match(audioReadme, new RegExp(id.replaceAll("-", "[- ]?"), "i"));
    assert.ok(audioReadme.includes(creator));
    assert.ok(audioReadme.includes(license));
    assert.ok(audioReadme.includes(track.source));
  }
  assert.equal(MUSIC_MANIFEST.defaults.light, "town");
  assert.equal(MUSIC_MANIFEST.themes.light[0], "town");
  assert.equal(MUSIC_MANIFEST.tracks["remember-winter"], undefined);
  assert.equal(MUSIC_MANIFEST.tracks["good-morning"], undefined);
});
test("main binds the controller to the hidden music runtime", () => {
  const source = fs.readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.match(source, /querySelector\("\[data-music-runtime\]"\)/);
});
test("theme runtime selects the approved theme track and stays stopped when disabled", () => {
  const { player, audioA, audioB } = setup();
  player.setTheme("spring", { play: false });
  const snapshot = player.snapshot();
  assert.equal(snapshot.currentTrackId, "hot-springs-town");
  assert.equal(snapshot.loop, true);
  assert.equal(snapshot.playing, false);
  assert.equal(audioA.paused, true);
  assert.equal(audioB.paused, true);
  assert.equal(audioA.loop, true);
  assert.equal(audioB.loop, true);
});
test("theme change clears custom mode while preserving loop preference", () => {
  const { player } = setup(); player.selectTrack("pondering-the-cosmos"); player.toggleLoop();
  assert.equal(player.snapshot().mode, "CUSTOM");
  player.setTheme("spring");
  assert.equal(player.snapshot().mode, "AUTO THEME"); assert.equal(player.snapshot().loop, false);
});
test("volume is clamped and preferences are sanitized", () => {
  const { player, values } = setup(); player.setVolume(4); assert.equal(player.snapshot().volume, 1);
  player.setVolume(-1); assert.equal(player.snapshot().volume, 0); assert.match(values.get("poorup.music.preferences"), /volume/);
});
test("previous restarts after three seconds and otherwise uses history", () => {
  let clock = 0; const { player } = setup({ now: () => clock }); player.selectTrack("pondering-the-cosmos");
  clock = 2; player.previous(); assert.equal(player.snapshot().currentTime, 0);
});
test("autoplay rejection is retained as a blocked status", async () => {
  const { player } = setup({ audioB: { ...media(), play: () => Promise.reject(new Error("blocked")) } });
  player.selectTrack("pondering-the-cosmos"); await Promise.resolve(); await Promise.resolve();
  assert.equal(player.snapshot().status, "autoplay-blocked");
});
test("failed incoming track retains the prior playable track", () => {
  let listeners = {};
  const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const { player } = setup({ audioB }); player.selectTrack("pondering-the-cosmos"); listeners.error();
  assert.equal(player.snapshot().currentTrackId, "pondering-the-cosmos"); assert.equal(player.snapshot().status, "track-error");
});
test("seek and next honor bounds and loop-off stop", () => {
  const { player, audioA } = setup(); audioA.duration = 100; assert.equal(player.seek(2), 1); assert.equal(audioA.currentTime, 100);
  player.toggleLoop(); assert.equal(player.next(), false); assert.equal(player.snapshot().status, "ended");
});
test("crossfade ramps both elements and cancels stale transitions", async () => {
  const manifest = { tracks: { a: { id: "a", title: "A", src: "/a", status: "approved" }, b: { id: "b", title: "B", src: "/b", status: "approved" } }, defaults: { one: "a", two: "b" }, themes: { one: ["a"], two: ["b"] } };
  const frames = []; let clock = 0; const a = media(); const b = media();
  const player = createMusicPlayer({ audioA: a, audioB: b, manifest, getThemeId: () => "one", now: () => clock, requestFrame: fn => { frames.push(fn); return frames.length; }, cancelFrame: id => { frames[id - 1] = null; } });
  player.setTheme("two"); await Promise.resolve(); await Promise.resolve();
  assert.equal(frames.length > 0, true); clock = 325; frames.at(-1)?.(); assert.equal(b.volume > 0 && b.volume < 0.16, true); assert.equal(a.volume < 0.16, true);
  player.setTheme("one"); const stale = frames.at(-1); player.setTheme("two"); stale?.(); assert.equal(player.snapshot().currentTrackId, "b");
});
test("persisted track is restored only for its approved theme", () => {
  const storage = new Map([["poorup.music.preferences", JSON.stringify({ theme: "spring", track: "pondering-the-cosmos", volume: 0.4 })]]);
  const { player } = setup({ storage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) }, getThemeId: () => "spring" });
  assert.equal(player.snapshot().currentTrackId, "hot-springs-town"); assert.equal(player.snapshot().volume, 0.4);
});
test("safe injected manifest never hardcodes unavailable fallback", () => {
  const manifest = { tracks: { x: { id: "x", title: "X", src: "/x", status: "approved" } }, defaults: { custom: "x" }, themes: { custom: ["x"] } };
  const { player } = setup({ manifest, getThemeId: () => "custom" }); player.setTheme("custom"); assert.equal(player.snapshot().currentTrackId, "x");
});
test("theme error restores prior track and queue index", () => {
  const listeners = {}; const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const { player } = setup({ audioB }); player.selectTrack("pondering-the-cosmos"); player.setTheme("spring"); listeners.error();
  assert.equal(player.snapshot().currentTrackId, "pondering-the-cosmos"); assert.equal(player.snapshot().status, "track-error");
});
test("manual failure restores prior active volume and queue state", () => {
  const listeners = {}; const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const { player, audioA } = setup({ audioB }); player.setVolume(0.7); player.setTheme("spring", { play: false }); player.selectTrack("apple-cider"); listeners.error();
  assert.equal(player.snapshot().currentTrackId, "hot-springs-town"); assert.equal(audioA.volume, 0.7);
});
test("stale autoplay rejection cannot overwrite a newer transition", async () => {
  const rejects = []; const audioB = { ...media(), play: () => new Promise((resolve, reject) => rejects.push(reject)) };
  const { player } = setup({ audioB }); player.selectTrack("pondering-the-cosmos"); player.setTheme("spring"); rejects[0](new Error("blocked")); await Promise.resolve(); await Promise.resolve();
  assert.notEqual(player.snapshot().status, "autoplay-blocked");
});
test("empty safe manifest reports unavailable without throwing", () => {
  const manifest = { tracks: {}, defaults: { empty: "missing" }, themes: { empty: ["missing"] } };
  const { player } = setup({ manifest, getThemeId: () => "empty" }); assert.equal(player.next(), false); assert.equal(player.previous(), false); assert.equal(player.snapshot().status, "track-unavailable");
});
test("failed theme switch rolls back the complete prior state", () => {
  const listeners = {}; const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const { player } = setup({ audioB }); player.toggleLoop(); player.selectTrack("pondering-the-cosmos");
  const before = player.snapshot(); player.setTheme("spring"); listeners.error(); const after = player.snapshot();
  assert.deepEqual({ theme: after.theme, mode: after.mode, loop: after.loop, queue: after.queue, currentTrackId: after.currentTrackId }, { theme: before.theme, mode: before.mode, loop: before.loop, queue: before.queue, currentTrackId: before.currentTrackId });
});
test("failed reset rolls back custom state and queue", () => {
  const listeners = {}; const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const { player } = setup({ audioB }); player.selectTrack("pondering-the-cosmos"); const before = player.snapshot(); player.resetToThemeTrack(); listeners.error(); const after = player.snapshot();
  assert.equal(after.mode, before.mode); assert.equal(after.currentTrackId, before.currentTrackId); assert.deepEqual(after.queue, before.queue);
});
test("rollback cancels queued fade so failed incoming audio cannot reactivate", () => {
  const listeners = {}; let queued; let cancelled = false;
  const audioB = { ...media(), play() {}, addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const { player, audioA } = setup({ audioB, reducedMotion: false, requestFrame: fn => { queued = fn; return 42; }, cancelFrame: id => { if (id === 42) cancelled = true; } });
  player.selectTrack("pondering-the-cosmos"); listeners.canplay(); listeners.error(); queued?.();
  assert.equal(cancelled, true); assert.equal(player.snapshot().currentTrackId, "pondering-the-cosmos"); assert.equal(player.snapshot().status, "track-error"); assert.equal(audioA.volume, 0.16); assert.equal(audioB.volume, 0);
});
test("shuffle uses injected randomness for a bounded non-repeating permutation", () => {
  const manifest = { tracks: { a: { id: "a", title: "A", src: "/a", status: "approved" }, b: { id: "b", title: "B", src: "/b", status: "approved" }, c: { id: "c", title: "C", src: "/c", status: "approved" } }, defaults: { one: "a" }, themes: { one: ["a", "b", "c"] } };
  const { player } = setup({ manifest, random: () => 0, getThemeId: () => "one" }); player.toggleShuffle();
  const queue = player.snapshot().queue; assert.equal(new Set(queue).size, 3); assert.deepEqual(queue, ["b", "c", "a"]); player.next(); assert.equal(player.snapshot().currentTrackId, "b");
});
test("failed custom selection restores queue and history state", () => {
  const listeners = {}; const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const { player } = setup({ audioB }); player.setTheme("spring", { play: false }); const before = player.snapshot(); player.selectTrack("apple-cider"); listeners.error(); const after = player.snapshot();
  assert.equal(after.currentTrackId, before.currentTrackId); assert.equal(after.mode, before.mode); assert.deepEqual(after.queue, before.queue); assert.equal(player.previous(), true);
});
test("failed theme track load does not persist the rejected selection", () => {
  const listeners = {}; const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const { player } = setup({ audioB }); player.setTheme("spring", { play: false }); player.selectTrack("apple-cider"); listeners.error();
  assert.equal(player.snapshot().currentTrackId, "hot-springs-town");
  player.setTheme("summer", { play: false }); player.setTheme("spring", { play: false });
  assert.equal(player.snapshot().currentTrackId, "hot-springs-town");
});
test("theme change preserves shuffle and reset restores the ordered queue", () => {
  const { player } = setup(); player.toggleShuffle(); assert.equal(player.snapshot().shuffle, true); player.setTheme("spring");
  assert.equal(player.snapshot().shuffle, true); assert.deepEqual([...player.snapshot().queue].sort(), ["apple-cider", "hot-springs-town"]); player.toggleShuffle(); player.resetToThemeTrack();
  assert.equal(player.snapshot().shuffle, false);
});
test("failed next restores current index and history", () => {
  const listeners = {}; const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const manifest = { tracks: { a: { id: "a", title: "A", src: "/a", status: "approved" }, b: { id: "b", title: "B", src: "/b", status: "approved" } }, defaults: { one: "a" }, themes: { one: ["a", "b"] } };
  const { player } = setup({ manifest, audioB, getThemeId: () => "one" }); const before = player.snapshot(); player.next(); listeners.error();
  assert.equal(player.snapshot().currentTrackId, before.currentTrackId); assert.deepEqual(player.snapshot().history, before.history);
});
test("failed previous restores the popped history entry", () => {
  const listeners = {}; const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const manifest = { tracks: { a: { id: "a", title: "A", src: "/a", status: "approved" }, b: { id: "b", title: "B", src: "/b", status: "approved" } }, defaults: { one: "a" }, themes: { one: ["a", "b"] } };
  const { player } = setup({ manifest, audioB, getThemeId: () => "one" }); player.next(); player.previous(); listeners.error();
  assert.equal(player.snapshot().currentTrackId, "b"); assert.deepEqual(player.snapshot().history, ["a"]);
});
test("togglePlay starts and pauses only the active audio", () => {
  const { player, audioA, audioB } = setup(); let plays = 0;
  audioA.play = () => { plays += 1; }; audioA.pause = () => { audioA.paused = true; }; audioA.paused = true; audioB.pause = () => { audioB.paused = true; }; audioB.paused = false;
  player.togglePlay(); assert.equal(plays, 1); assert.equal(player.snapshot().playing, true); assert.equal(player.snapshot().status, "playing"); assert.equal(audioB.paused, true);
  player.togglePlay(); assert.equal(audioA.paused, true); assert.equal(player.snapshot().playing, false); assert.equal(player.snapshot().status, "paused");
});
test("togglePlay retries after autoplay blocked", async () => {
  let blocked = true; const { player, audioA } = setup(); audioA.play = () => blocked ? Promise.reject(new Error("blocked")) : undefined;
  player.togglePlay(); await Promise.resolve(); await Promise.resolve(); assert.equal(player.snapshot().status, "autoplay-blocked"); blocked = false; player.togglePlay(); assert.equal(player.snapshot().playing, true);
});
test("autoplay retry targets the pending incoming element", async () => {
  let attempts = 0; const audioB = { ...media(), play: () => { attempts += 1; return attempts === 1 ? Promise.reject(new Error("blocked")) : undefined; } };
  const { player } = setup({ audioB }); player.selectTrack("pondering-the-cosmos"); await Promise.resolve(); await Promise.resolve(); player.togglePlay();
  assert.equal(attempts, 2); assert.equal(player.snapshot().playing, true);
});
test("pause cancels an in-flight crossfade and queued finish", async () => {
  let queued; const listeners = {}; const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} }; const { player, audioA } = setup({ audioB, reducedMotion: false, requestFrame: fn => { queued = fn; return 7; }, cancelFrame: () => {} });
  player.setTheme("spring"); listeners.canplay(); await Promise.resolve(); await Promise.resolve(); player.togglePlay(); queued?.();
  assert.equal(player.snapshot().status, "paused"); assert.equal(audioA.volume, 0.16); assert.equal(audioB.volume, 0);
});
test("stale play promise cannot change status after navigation", async () => {
  const resolves = []; const audioB = { ...media(), play: () => new Promise(resolve => resolves.push(resolve)) };
  const { player } = setup({ audioB }); player.selectTrack("pondering-the-cosmos"); player.setTheme("spring"); resolves[0](); await Promise.resolve(); await Promise.resolve();
  assert.notEqual(player.snapshot().status, "playing");
});
test("blocked pending target is retried before pausing prior playback", async () => {
  let attempts = 0; const listeners = {}; const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {}, play: () => { attempts += 1; return attempts === 1 ? Promise.reject(new Error("blocked")) : undefined; } };
  const { player, audioA } = setup({ audioB }); audioA.play = () => {}; player.togglePlay(); player.setTheme("spring"); listeners.canplay(); await Promise.resolve(); await Promise.resolve(); player.togglePlay();
  assert.equal(attempts, 2); assert.equal(player.snapshot().playing, true);
});
test("pausing an in-flight transition immediately restores its full snapshot", async () => {
  const listeners = {}; let queued; const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const { player } = setup({ audioB, requestFrame: fn => { queued = fn; return 9; }, cancelFrame: () => {} }); player.togglePlay(); player.setTheme("spring"); listeners.canplay(); player.togglePlay(); queued?.();
  const after = player.snapshot(); assert.equal(after.playing, false);
});
test("retrying blocked incoming audio pauses the old active channel", async () => {
  let attempts = 0; let paused = 0; const audioA = { ...media(), play: () => {}, pause: () => { paused += 1; } };
  const audioB = { ...media(), play: () => { attempts += 1; return attempts === 1 ? Promise.reject(new Error("blocked")) : undefined; } };
  const { player } = setup({ audioA, audioB }); player.togglePlay(); player.setTheme("spring"); await Promise.resolve(); await Promise.resolve(); player.togglePlay();
  assert.equal(attempts, 2); assert.equal(paused > 0, true);
});
test("first play loads the current track before play and applies loop", () => {
  const { player, audioA, audioB } = setup(); audioA.play = () => {}; player.togglePlay();
  assert.equal(audioA.src, "/assets/audio/pondering-the-cosmos.mp3"); assert.equal(audioA.loop, true); assert.equal(audioB.loop, true);
});
test("natural ended repeats with loop or advances when disabled", () => {
  const listeners = {}; const audioA = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, play() {}, pause() {} };
  const { player } = setup({ audioA }); player.togglePlay(); player.toggleLoop(); listeners.ended(); assert.equal(player.snapshot().status, "ended");
});
test("inactive ended event cannot restart outgoing audio", () => {
  let plays = 0; const audioB = { ...media(), addEventListener(type, fn) { if (type === "ended") this.ended = fn; }, play() { plays += 1; } };
  const { player } = setup({ audioB }); audioB.ended(); assert.equal(plays, 0); assert.equal(player.snapshot().status, "idle");
});
test("loop toggle immediately synchronizes both native audio elements", () => {
  const { player, audioA, audioB } = setup(); player.toggleLoop(); assert.equal(audioA.loop, false); assert.equal(audioB.loop, false);
});
test("stop and pause are idempotent and cancel playback intent", () => {
  const { player, audioA, audioB } = setup(); let a = 0; let b = 0; audioA.pause = () => { a += 1; }; audioB.pause = () => { b += 1; }; player.togglePlay(); player.stop(); player.pause();
  assert.equal(player.snapshot().playing, false); assert.equal(player.snapshot().status, "paused"); assert.equal(a > 0, true); assert.equal(b > 0, true);
});
test("ended after stop does not restart the active audio", () => {
  let plays = 0; let ended; const audioA = { ...media(), play() { plays += 1; }, addEventListener(type, fn) { if (type === "ended") ended = fn; } };
  const { player } = setup({ audioA }); player.togglePlay(); player.stop(); ended(); assert.equal(plays, 1);
});
test("mode persists and restores only sanitized values", () => {
  const values = new Map(); const first = setup({ getThemeId: () => "spring", storage: { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) } }); first.player.selectTrack("apple-cider");
  const second = setup({ getThemeId: () => "spring", storage: { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) } }); assert.equal(second.player.snapshot().mode, "CUSTOM");
});
test("storage sync applies approved preference fields", () => {
  const { player } = setup(); player.syncPreferences(JSON.stringify({ volume: 0.4, shuffle: true, loop: false, mode: "CUSTOM", track: "pondering-the-cosmos" })); const snap = player.snapshot(); assert.equal(snap.volume, 0.4); assert.equal(snap.shuffle, true); assert.equal(snap.loop, false); assert.equal(snap.mode, "CUSTOM");
});
test("storage sync rejects array payloads without mutating player preferences", () => {
  const { player } = setup();
  player.toggleLoop();
  player.toggleShuffle();
  const before = player.snapshot();
  assert.equal(player.syncPreferences([]), false);
  assert.deepEqual(player.snapshot(), before);
});
test("non-loop ended clears playing intent and reports ended", () => {
  let ended; const audioA = { ...media(), play() {}, addEventListener(type, fn) { if (type === "ended") ended = fn; } }; const { player } = setup({ audioA }); player.togglePlay(); player.toggleLoop(); ended(); assert.equal(player.snapshot().playing, false); assert.equal(player.snapshot().status, "ended");
});
test("invalid persisted custom track resets mode to AUTO THEME", () => {
  const values = new Map([["poorup.music.preferences", JSON.stringify({ theme: "spring", mode: "CUSTOM", track: "pondering-the-cosmos" })]]);
  const { player } = setup({ getThemeId: () => "spring", storage: { getItem: k => values.get(k), setItem: () => {} } }); assert.equal(player.snapshot().mode, "AUTO THEME"); assert.equal(player.snapshot().currentTrackId, "hot-springs-town");
});
test("storage shuffle sync rebuilds queue and restores order", () => {
  const manifest = { tracks: { a: { id: "a", title: "A", src: "/a", status: "approved" }, b: { id: "b", title: "B", src: "/b", status: "approved" }, c: { id: "c", title: "C", src: "/c", status: "approved" } }, defaults: { one: "a" }, themes: { one: ["a", "b", "c"] } };
  const { player } = setup({ manifest, getThemeId: () => "one", random: () => 0 }); player.syncPreferences({ shuffle: true }); assert.deepEqual(player.snapshot().queue, ["b", "c", "a"]); player.syncPreferences({ shuffle: false }); assert.deepEqual(player.snapshot().queue, ["a", "b", "c"]);
});

test("syncing a selected track while playing starts the matching source", () => {
  const manifest = { tracks: { a: { id: "a", title: "A", src: "/a", status: "approved" }, b: { id: "b", title: "B", src: "/b", status: "approved" } }, defaults: { one: "a" }, themes: { one: ["a", "b"] } };
  let playsB = 0;
  const audioA = { ...media(), play() { this.paused = false; }, pause() { this.paused = true; } };
  const audioB = { ...media(), play() { playsB += 1; this.paused = false; }, pause() { this.paused = true; } };
  const { player } = setup({ manifest, getThemeId: () => "one", audioA, audioB });
  player.togglePlay();
  assert.equal(player.snapshot().playing, true);
  player.syncPreferences({ selections: { one: "b" }, loop: false, shuffle: true });
  assert.equal(player.snapshot().currentTrackId, "b");
  assert.equal(audioB.src, "/b");
  assert.equal(playsB, 1);
  assert.equal(audioB.paused, false);
  assert.equal(player.snapshot().playing, true);
  assert.equal(player.snapshot().loop, false);
  assert.equal(player.snapshot().shuffle, true);
  assert.equal(player.snapshot().queue.includes("b"), true);
});

test("syncing a selected track while stopped updates its source without starting playback", () => {
  const manifest = { tracks: { a: { id: "a", title: "A", src: "/a", status: "approved" }, b: { id: "b", title: "B", src: "/b", status: "approved" } }, defaults: { one: "a" }, themes: { one: ["a", "b"] } };
  let plays = 0;
  const audioA = { ...media(), play() { plays += 1; return Promise.resolve(); } };
  const audioB = { ...media(), play() { plays += 1; return Promise.resolve(); } };
  const { player } = setup({ manifest, getThemeId: () => "one", audioA, audioB });
  assert.equal(audioA.src, "/a");
  player.syncPreferences({ selections: { one: "b" }, loop: false, shuffle: true });
  assert.equal(player.snapshot().currentTrackId, "b");
  assert.equal(audioA.src, "/b");
  assert.equal(plays, 0);
  assert.equal(player.snapshot().playing, false);
  assert.equal(player.snapshot().loop, false);
  assert.equal(player.snapshot().shuffle, true);
  assert.equal(player.snapshot().queue.includes("b"), true);
});

test("theme music choices persist per theme without resetting playback preferences", () => {
  const manifest = {
    tracks: {
      oneMain: { id: "oneMain", title: "One Main", src: "/one-main", status: "approved" },
      oneAlt: { id: "oneAlt", title: "One Alternate", src: "/one-alt", status: "approved" },
      twoMain: { id: "twoMain", title: "Two Main", src: "/two-main", status: "approved" },
      twoAlt: { id: "twoAlt", title: "Two Alternate", src: "/two-alt", status: "approved" },
    },
    defaults: { one: "oneMain", two: "twoMain" },
    themes: { one: ["oneMain", "oneAlt"], two: ["twoMain", "twoAlt"] },
  };
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const { player } = setup({ manifest, getThemeId: () => "one", storage });
  player.setVolume(0.42);
  player.toggleLoop();
  player.toggleShuffle();
  assert.equal(player.selectTrack("oneAlt"), true);
  player.setTheme("two", { play: false });
  assert.equal(player.snapshot().currentTrackId, "twoMain");
  player.setTheme("one", { play: false });
  assert.equal(player.snapshot().currentTrackId, "oneAlt");
  assert.equal(player.snapshot().mode, "CUSTOM");
  assert.equal(player.snapshot().volume, 0.42);
  assert.equal(player.snapshot().loop, false);
  assert.equal(player.snapshot().shuffle, true);
  const restored = setup({ manifest, getThemeId: () => "one", storage }).player.snapshot();
  assert.equal(restored.currentTrackId, "oneAlt");
});

test("legacy custom track preference migrates into its theme selection", () => {
  const manifest = {
    tracks: {
      oneMain: { id: "oneMain", title: "One Main", src: "/one-main", status: "approved" },
      oneAlt: { id: "oneAlt", title: "One Alternate", src: "/one-alt", status: "approved" },
      twoMain: { id: "twoMain", title: "Two Main", src: "/two-main", status: "approved" },
    },
    defaults: { one: "oneMain", two: "twoMain" },
    themes: { one: ["oneMain", "oneAlt"], two: ["twoMain"] },
  };
  const values = new Map([["poorup.music.preferences", JSON.stringify({ theme: "one", track: "oneAlt", mode: "CUSTOM", volume: 0.35, loop: false, shuffle: true })]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const { player } = setup({ manifest, getThemeId: () => "one", storage });
  player.setTheme("two", { play: false });
  player.setTheme("one", { play: false });
  assert.equal(player.snapshot().currentTrackId, "oneAlt");
  assert.equal(player.snapshot().mode, "CUSTOM");
  assert.equal(player.snapshot().volume, 0.35);
  assert.equal(player.snapshot().loop, false);
  assert.equal(player.snapshot().shuffle, true);
});

test("selectTrack rejects approved tracks assigned to a different theme", () => {
  const { player } = setup({ getThemeId: () => "original" });
  assert.equal(player.selectTrack("hot-springs-town"), false);
  assert.equal(player.snapshot().currentTrackId, "pondering-the-cosmos");
});

test("selectTrack updates the choice without starting disabled playback", async () => {
  const { player, audioA, audioB } = setup();
  player.setTheme("spring", { play: false });
  assert.equal(player.selectTrack("apple-cider", { play: false }), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(player.snapshot().currentTrackId, "apple-cider");
  assert.equal(player.snapshot().playing, false);
  assert.equal(audioA.src, "/assets/audio/themes/spring/apple-cider.ogg");
  assert.equal(audioA.paused, true);
  assert.equal(audioB.paused, true);
});
