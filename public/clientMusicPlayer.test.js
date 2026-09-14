import assert from "node:assert/strict";
import { createMusicPlayer } from "./clientMusicPlayer.js";
import { MUSIC_MANIFEST } from "./clientMusicData.js";

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
});
test("theme reset clears custom state and enables loop", () => {
  const { player } = setup(); player.selectTrack("pondering-the-cosmos"); player.toggleLoop();
  assert.equal(player.snapshot().mode, "CUSTOM");
  player.setTheme("spring");
  assert.equal(player.snapshot().mode, "AUTO THEME"); assert.equal(player.snapshot().loop, true);
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
  const { player, audioA } = setup({ audioB }); player.setVolume(0.7); player.selectTrack("pondering-the-cosmos"); player.selectTrack("hot-springs-town"); listeners.error();
  assert.equal(player.snapshot().currentTrackId, "pondering-the-cosmos"); assert.equal(audioA.volume, 0.7);
});
test("stale autoplay rejection cannot overwrite a newer transition", async () => {
  const rejects = []; const audioB = { ...media(), play: () => new Promise((resolve, reject) => rejects.push(reject)) };
  const { player } = setup({ audioB }); player.selectTrack("pondering-the-cosmos"); player.selectTrack("hot-springs-town"); rejects[0](new Error("blocked")); await Promise.resolve(); await Promise.resolve();
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
  const { player } = setup({ audioB }); const before = player.snapshot(); player.selectTrack("hot-springs-town"); listeners.error(); const after = player.snapshot();
  assert.equal(after.currentTrackId, before.currentTrackId); assert.equal(after.mode, before.mode); assert.deepEqual(after.queue, before.queue); assert.equal(player.previous(), true);
});
test("failed theme and reset preserve prior history", () => {
  const listeners = {}; const audioB = { ...media(), addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const { player } = setup({ audioB }); player.selectTrack("hot-springs-town"); const before = player.snapshot(); player.setTheme("spring"); listeners.error();
  assert.equal(player.previous(), true); assert.equal(player.snapshot().currentTrackId, "pondering-the-cosmos");
});
test("theme change and reset clear shuffle and restore ordered queue", () => {
  const { player } = setup(); player.toggleShuffle(); assert.equal(player.snapshot().shuffle, true); player.setTheme("spring");
  assert.equal(player.snapshot().shuffle, false); assert.deepEqual(player.snapshot().queue, ["hot-springs-town"]); player.toggleShuffle(); player.resetToThemeTrack();
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
