import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const audio = readFileSync(join(root, "clientAudioControls.js"), "utf8");
const theme = readFileSync(join(root, "clientTheme.js"), "utf8");
const main = readFileSync(join(root, "main.js"), "utf8");
const musicBoxUi = readFileSync(join(root, "clientMusicBoxUi.js"), "utf8");
const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error }); }
}

check("all existing music buttons proxy through one state owner", () => {
  assert.match(audio, /const MUSIC_BUTTONS = \[/);
  assert.match(audio, /bindProxyButtons\(MUSIC_PROXY_BUTTONS, "#music-toggle-btn"\)/);
  assert.match(audio, /state\.music = !state\.music/);
  assert.match(audio, /saveMusicPreference\(state\.music\)/);
});

check("music controller is injected instead of replacing state.music", () => {
  assert.match(audio, /musicController/);
  assert.match(audio, /state\.music/);
  assert.match(main, /musicController/);
  assert.match(main, /__poorupMusicBoxController/);
  assert.match(musicBoxUi, /globalThis\.__poorupMusicBoxController/);
});

check("dock auto-mount reuses the registered controller", () => {
  assert.match(musicBoxUi, /controller \|\| globalThis\.__poorupMusicBoxController \|\| createMusicPlayer/);
});

check("global toggle starts once and stops through the controller", () => {
  assert.doesNotMatch(audio, /setMusicEnabled\?\.\(state\.music/);
  assert.match(audio, /host\.syncHomeMusic\(\{ force: true \}\)/);
  assert.match(main, /controller\.(stop|pause)\?\./);
  assert.doesNotMatch(main, /music\.addEventListener/);
  assert.doesNotMatch(main, /function bindHomeMusicEvents/);
  assert.doesNotMatch(main, /#home-music|function bindHomeMusicEvents/);
  assert.doesNotMatch(main, /data-music-audio.*pause/);
  assert.doesNotMatch(main, /AUDIO_LABELS|audioRuntime|mediaFailureState|setAudioState/);
  assert.match(main, /const snapshot = ensureMusicController\(\)\?\.snapshot/);
});

check("theme changes apply visuals before resetting music", () => {
  assert.match(theme, /onThemeChange/);
  assert.match(theme, /themeUi\.applyTheme\(theme\.id, \{ animate \}\);[\s\S]*themeUi\.onThemeChange\(theme\.id\)/);
});

check("blocked playback announces once", () => {
  assert.match(musicBoxUi, /autoplay-blocked/);
  assert.match(main, /music-status|announceSoundMessage/);
});

check("dock play intent is handled by the canonical global state", () => {
  assert.match(main, /music-box-play/);
  assert.match(main, /state\.music = true/);
  assert.match(main, /saveMusicPreference\(true\)/);
  assert.match(main, /resetToThemeTrack/);
  assert.match(main, /controller\.stop\?\./);
  assert.doesNotMatch(musicBoxUi, /player\.togglePlay\(\).*state\.music/);
  assert.match(musicBoxUi, /CustomEvent\("music-box-play", \{ bubbles: true, cancelable: true \}\)/);
  assert.match(musicBoxUi, /if \(!handled\.defaultPrevented\) player\?\.togglePlay/);
  assert.match(main, /event\.preventDefault\(\)/);
});

const failures = checks.filter((result) => !result.ok);
checks.forEach((result) => {
  if (result.ok) console.log(`PASS - ${result.name}`);
  else console.error(`FAIL - ${result.name}: ${result.error.message}`);
});
console.log(`client audio integration tests: ${checks.length - failures.length} passed, ${failures.length} failed`);
if (failures.length) throw failures[0].error;
