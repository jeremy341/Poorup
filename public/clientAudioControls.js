/* ============================================================
   AUDIO CONTROLS: the global effects/music toggles that appear in
   every surface (main, game, profile, rankings, social, rules).
   The per-view buttons proxy to the canonical #sound-toggle-btn and
   #music-toggle-btn so a single handler owns the state flip; the
   game-bound playSound chime and syncHomeMusic cross-fade are
   injected. aria labels and icon paths match the old main.js text.
   ============================================================ */
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import { saveSoundPreference, saveMusicPreference } from "./clientSanitize.js";
import { renderProfileSummary } from "./clientProfileRender.js";

let host = { playSound: noop, syncHomeMusic: noop };

function noop() {}

const SOUND_BUTTONS = [
  "#sound-toggle-btn", "#game-sound-toggle-btn", "#profile-sound-toggle-btn",
  "#rankings-sound-toggle-btn", "#social-sound-toggle-btn", "#rules-sound-toggle-btn",
];
const MUSIC_BUTTONS = [
  "#music-toggle-btn", "#game-music-toggle-btn", "#profile-music-toggle-btn",
  "#rankings-music-toggle-btn", "#social-music-toggle-btn", "#rules-music-toggle-btn",
];
const SOUND_PROXY_BUTTONS = SOUND_BUTTONS.slice(1);
const MUSIC_PROXY_BUTTONS = MUSIC_BUTTONS.slice(1);

function paintAudioButton(button, pressed, meta) {
  if (!button) return;
  button.setAttribute("aria-pressed", String(pressed));
  button.setAttribute("aria-label", pressed ? meta.labelOn : meta.labelOff);
  const icon = button.querySelector("img");
  if (icon) icon.src = meta.src;
}

function syncAudioButtons() {
  const soundSrc = state.sound ? "/assets/sound-on.svg" : "/assets/sound-off.svg";
  const musicSrc = state.music ? "/assets/music-on.svg" : "/assets/music-off.svg";
  const soundMeta = { labelOn: "Turn sound effects off", labelOff: "Turn sound effects on", src: soundSrc };
  const musicMeta = { labelOn: "Turn parlor music off", labelOff: "Turn parlor music on", src: musicSrc };
  SOUND_BUTTONS.map((sel) => $(sel)).forEach((button) => paintAudioButton(button, state.sound, soundMeta));
  MUSIC_BUTTONS.map((sel) => $(sel)).forEach((button) => paintAudioButton(button, state.music, musicMeta));
}

function onSoundToggle() {
  state.sound = !state.sound;
  saveSoundPreference(state.sound);
  if (state.sound) host.playSound("trade");
  syncAudioButtons();
  host.syncHomeMusic();
  renderProfileSummary();
}

function onMusicToggle() {
  state.music = !state.music;
  saveMusicPreference(state.music);
  syncAudioButtons();
  host.syncHomeMusic();
  renderProfileSummary();
}

function proxyTo(target) {
  return () => $(target)?.click();
}

function bindProxyButtons(selectors, target) {
  selectors.forEach((sel) => $(sel)?.addEventListener("click", proxyTo(target)));
}

function bindPrimaryAudioToggles() {
  $("#sound-toggle-btn")?.addEventListener("click", onSoundToggle);
  $("#music-toggle-btn")?.addEventListener("click", onMusicToggle);
}

export function bindAudioControls(hooks) {
  host = { ...host, ...hooks };
  syncAudioButtons();
  bindPrimaryAudioToggles();
  bindProxyButtons(SOUND_PROXY_BUTTONS, "#sound-toggle-btn");
  bindProxyButtons(MUSIC_PROXY_BUTTONS, "#music-toggle-btn");
}
