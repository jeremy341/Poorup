/* ============================================================
   THEME UI: keyboard-safe, local-only parlor look selector.
   It changes atmosphere and CSS tokens only; no server payload is touched.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { MUSIC_MANIFEST, MUSIC_PREFERENCES_STORAGE_KEY, sanitizeTrackId } from "./clientMusicData.js";
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY, getTheme, sanitizeThemeId, themeOptions } from "./clientThemeData.js";
import { pauseThemeMotion, renderTheme, themePreviewScene } from "./clientThemeRender.js";

let themeUi = { applyTheme: renderTheme, announce, onThemeChange: () => {}, onTrackChange: defaultTrackChange, getMusicSnapshot: defaultMusicSnapshot };
let preferencesBound = false;
let storageBound = false;
let visibilityBound = false;

function announce(message) {
  const live = $("#system-announcer");
  if (live) live.textContent = message;
}

function preferences() { return $("[data-theme-preferences]"); }
function grid() { return $("#theme-choice-grid"); }
function choices() { return [...document.querySelectorAll("#theme-choice-grid [data-theme-choice]")]; }
function trackChoices() { return [...document.querySelectorAll("#theme-music-panel [data-theme-track-choice]")]; }

function defaultMusicSnapshot() { return globalThis.__poorupThemeMusicController?.snapshot?.() || null; }

function defaultTrackChange(trackId) {
  const controller = globalThis.__poorupThemeMusicController;
  if (!controller?.selectTrack) return false;
  return controller.selectTrack(trackId, { play: state.music }) !== false;
}

function themeTrackIds(themeId) {
  return [...new Set(MUSIC_MANIFEST.themes?.[themeId] || [])].filter(id => Boolean(sanitizeTrackId(id, MUSIC_MANIFEST)));
}

function defaultTrackId(themeId) {
  const id = MUSIC_MANIFEST.defaults?.[themeId];
  return sanitizeTrackId(id, MUSIC_MANIFEST) || themeTrackIds(themeId)[0] || null;
}

function musicSnapshot() {
  try {
    const snapshot = themeUi.getMusicSnapshot?.();
    return snapshot && typeof snapshot === "object" ? snapshot : null;
  } catch {
    return null;
  }
}

function selectedTrackId(themeId) {
  const ids = themeTrackIds(themeId);
  const snapshot = musicSnapshot();
  if (snapshot?.theme === themeId && ids.includes(snapshot.selectedTrackId)) return snapshot.selectedTrackId;
  try {
    const saved = JSON.parse(localStorage.getItem(MUSIC_PREFERENCES_STORAGE_KEY) || "{}");
    const selected = saved?.selections?.[themeId];
    if (ids.includes(selected)) return selected;
  } catch {
    // A corrupt or unavailable preference store falls back to the theme main.
  }
  return defaultTrackId(themeId);
}

function choiceMarkup(theme) {
  const selected = theme.id === (state.themeId || DEFAULT_THEME_ID);
  const descriptionId = `theme-choice-description-${theme.id}`;
  const mainTrack = MUSIC_MANIFEST.tracks[defaultTrackId(theme.id)];
  return `<label class="theme-choice" data-theme-choice-label="${esc(theme.id)}">
    <input type="radio" name="poorup-theme" value="${esc(theme.id)}" data-theme-choice="${esc(theme.id)}" aria-checked="${selected}" aria-describedby="${descriptionId}" tabindex="${selected ? "0" : "-1"}" ${selected ? "checked" : ""} aria-label="${esc(theme.ariaLabel)}">
    <span class="theme-choice-art"><img src="${esc(themePreviewScene(theme))}" alt="" width="88" height="42" aria-hidden="true"></span>
    <span class="theme-choice-copy"><span class="t-label f11 theme-choice-name">${esc(theme.preview.heading)}</span><span class="theme-choice-description" id="${descriptionId}">${esc(theme.preview.copy)}</span><span class="t-micro theme-choice-track">${esc(mainTrack ? `AUTO THEME · ${mainTrack.title}` : "NO APPROVED TRACK")}</span></span>
  </label>`;
}

function trackMarkup(id, selected, defaultId) {
  const track = MUSIC_MANIFEST.tracks[id];
  if (!track) return "";
  const descriptionId = `theme-track-description-${id}`;
  const kind = id === defaultId ? "AUTO THEME" : "SECONDARY";
  return `<label class="theme-track-choice" data-theme-track-choice data-theme-track-id="${esc(id)}"><input type="radio" name="poorup-theme-track" value="${esc(id)}" aria-checked="${selected}" aria-describedby="${descriptionId}" ${selected ? "checked" : ""}><span class="theme-track-mark" aria-hidden="true">${selected ? "●" : "○"}</span><span class="theme-track-copy"><span class="t-label f12 g100">${esc(track.title)}</span><span class="t-micro ink-3" id="${descriptionId}">${esc(track.artist)} · ${kind}</span></span><span class="t-micro theme-track-state">${selected ? "ACTIVE" : "READY"}</span></label>`;
}

function musicPanelMarkup(themeId) {
  const theme = getTheme(themeId);
  const ids = themeTrackIds(themeId);
  const defaultId = defaultTrackId(themeId);
  const selectedId = selectedTrackId(themeId);
  const custom = selectedId !== defaultId;
  const rows = ids.map(id => trackMarkup(id, id === selectedId, defaultId)).join("");
  const choicesMarkup = rows || `<p class="t-body ink-2 theme-track-empty">No approved soundtrack is available for ${esc(theme.shortName)} yet.</p>`;
  return `<div class="theme-music-head"><div><span class="t-micro g400">PARLOR MUSIC</span><h3 class="t-section g100" id="theme-music-title">${esc(theme.shortName)} soundtrack</h3></div><span class="t-micro theme-music-mode" data-music-mode>${custom ? "CUSTOM" : "AUTO THEME"}</span></div><p class="t-micro ink-3 theme-music-copy">Choose the approved track that follows this world. The global music control remains canonical.</p><div class="theme-track-list" role="radiogroup" aria-label="${esc(theme.name)} soundtrack choices">${choicesMarkup}</div>`;
}

function renderMusicPanel() {
  const panel = $("#theme-music-panel");
  if (panel) panel.innerHTML = musicPanelMarkup(stateThemeId());
}

function renderPreferences() {
  const target = grid();
  if (!target) return;
  target.innerHTML = themeOptions().map(choiceMarkup).join("");
  renderMusicPanel();
  syncChoiceState();
}

function syncChoiceState() {
  choices().forEach((choice) => {
    const selected = choice.value === stateThemeId();
    choice.checked = selected;
    choice.setAttribute("aria-checked", String(selected));
    choice.tabIndex = selected ? 0 : -1;
    const label = choice.closest("[data-theme-choice-label]");
    label?.classList.toggle("is-active", selected);
  });
  trackChoices().forEach(choice => {
    const selected = choice.querySelector("input")?.checked === true;
    choice.setAttribute("data-selected", String(selected));
    const mark = choice.querySelector(".theme-track-mark");
    const status = choice.querySelector(".theme-track-state");
    if (mark) mark.textContent = selected ? "●" : "○";
    if (status) status.textContent = selected ? "ACTIVE" : "READY";
  });
}

function stateThemeId() {
  return state.themeId || DEFAULT_THEME_ID;
}

function columns() {
  const target = grid();
  if (!target) return 1;
  return Math.max(1, getComputedStyle(target).gridTemplateColumns.split(" ").filter(Boolean).length);
}

function nextIndex(key, index, count) {
  const direct = { Home: 0, End: count - 1 }[key];
  const deltas = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: columns(),
    ArrowUp: -columns(),
  };
  const delta = deltas[key];
  return direct ?? (delta == null ? null : (index + delta + count) % count);
}

function focusChoice(index) {
  const list = choices();
  if (!list.length) return;
  const next = list[(index + list.length) % list.length];
  next.focus({ preventScroll: true });
}

function applyThemePreference(value, { announceChange = true, animate = true, persist = true } = {}) {
  const theme = getTheme(sanitizeThemeId(value));
  state.themeId = theme.id;
  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, theme.id); } catch { /* storage unavailable */ }
  }
  themeUi.applyTheme(theme.id, { animate });
  // Audio follows the sanitized visual theme only after the visual tokens
  // have been applied, preventing invalid ids from selecting a track.
  themeUi.onThemeChange(theme.id);
  renderMusicPanel();
  syncChoiceState();
  if (announceChange) themeUi.announce(`Parlor look changed to ${theme.name}.`);
  return theme;
}

function onChoiceKeyDown(event) {
  const choice = event.target.closest("[data-theme-choice]");
  if (!choice) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault(); event.stopPropagation(); applyThemePreference(choice.value); return;
  }
  const index = choices().indexOf(choice);
  const targetIndex = nextIndex(event.key, index, choices().length);
  if (targetIndex == null) return;
  event.preventDefault(); event.stopPropagation();
  applyThemePreference(choices()[targetIndex].value);
  focusChoice(targetIndex);
}

function applyTrackPreference(value) {
  const id = sanitizeTrackId(value, MUSIC_MANIFEST);
  if (!id || !themeTrackIds(stateThemeId()).includes(id)) return false;
  if (themeUi.onTrackChange(id, stateThemeId()) === false) {
    const status = $("#theme-preference-status");
    if (status) status.textContent = "TRACK UNAVAILABLE · KEEPING THE CURRENT CHOICE";
    renderMusicPanel();
    return false;
  }
  renderMusicPanel();
  themeUi.announce(`Track changed to ${MUSIC_MANIFEST.tracks[id].title}.`);
  return true;
}

function onPreferenceChange(event) {
  const choice = event.target.closest("[data-theme-choice]");
  if (choice) { applyThemePreference(choice.value); return; }
  const track = event.target.closest("[data-theme-track-choice]");
  if (track) applyTrackPreference(track.dataset.themeTrackId);
}

export function bindThemePopover() {
  const host = preferences();
  if (host && !preferencesBound) {
    preferencesBound = true;
    host.addEventListener("keydown", onChoiceKeyDown);
    host.addEventListener("change", onPreferenceChange);
    host.dataset.bound = "true";
  }
  renderPreferences();
  if (!storageBound) {
    storageBound = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== THEME_STORAGE_KEY || typeof event.newValue !== "string") return;
      applyThemePreference(event.newValue, { announceChange: false, animate: true, persist: false });
    });
  }
}

export function bindThemeVisibility() {
  if (visibilityBound) return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => pauseThemeMotion(document.hidden));
}

export function configureThemeUi({ applyTheme = renderTheme, announce: announceHook = announce, onThemeChange = () => {}, onTrackChange = defaultTrackChange, getMusicSnapshot = defaultMusicSnapshot } = {}) {
  themeUi = { applyTheme: typeof applyTheme === "function" ? applyTheme : renderTheme, announce: typeof announceHook === "function" ? announceHook : announce, onThemeChange: typeof onThemeChange === "function" ? onThemeChange : () => {}, onTrackChange: typeof onTrackChange === "function" ? onTrackChange : defaultTrackChange, getMusicSnapshot: typeof getMusicSnapshot === "function" ? getMusicSnapshot : defaultMusicSnapshot };
  bindThemePopover();
}

export function initThemePreference() {
  let saved = DEFAULT_THEME_ID;
  try { saved = sanitizeThemeId(localStorage.getItem(THEME_STORAGE_KEY)); } catch { /* storage unavailable */ }
  state.themeId = saved;
  themeUi.applyTheme(saved, { animate: false });
  bindThemePopover();
  return saved;
}
