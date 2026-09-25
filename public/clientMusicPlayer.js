import { MUSIC_MANIFEST, MUSIC_PREFERENCES_STORAGE_KEY, resolveThemeTrack, sanitizeThemeId, sanitizeTrackId } from "./clientMusicData.js";

const PREFS = MUSIC_PREFERENCES_STORAGE_KEY;
const DEFAULT_VOLUME = 0.16;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
function localStorageOrEmpty() {
  try { return globalThis.localStorage || {}; } catch { return {}; }
}

function createPlayerState(options) {
  const {
    audioA,
    audioB,
    manifest = MUSIC_MANIFEST,
    getThemeId = () => "original",
    storage = localStorageOrEmpty(),
    announce = () => {},
    now = () => Date.now(),
    requestFrame = fn => setTimeout(fn, 16),
    cancelFrame = id => clearTimeout(id),
    reducedMotion = false,
    random = Math.random
  } = options;
  const theme = sanitizeThemeId(getThemeId(), manifest);
  return {
    audioA,
    audioB,
    audios: [audioA, audioB],
    manifest,
    getThemeId,
    storage,
    announce,
    now,
    requestFrame,
    cancelFrame,
    reducedMotion,
    random,
    active: 0,
    transition: 0,
    frame: null,
    theme,
    current: resolveThemeTrack(theme, manifest),
    mode: "AUTO THEME",
    selections: {},
    loop: true,
    shuffle: false,
    volume: DEFAULT_VOLUME,
    status: "idle",
    playing: false,
    playAttempt: 0,
    pending: null,
    pendingIndex: -1,
    blockedPending: null,
    pendingRestore: null,
    startedAt: now(),
    queue: [],
    queueIndex: 0,
    history: []
  };
}

function isRecord(value) {
  if (value === null) return false;
  if (typeof value !== "object") return false;
  return !Array.isArray(value);
}

function restoreThemeSelections(state, saved) {
  if (isRecord(saved.selections)) {
    for (const [theme, track] of Object.entries(saved.selections)) {
      if (themeTracks(state, theme).includes(track)) state.selections[theme] = track;
    }
    return;
  }
  if (saved.selections) return;
  if (saved.mode !== "CUSTOM") return;
  const savedTrack = sanitizeTrackId(saved.track, state.manifest);
  if (!savedTrack) return;
  if (!themeTracks(state, state.theme).includes(savedTrack)) return;
  state.selections[state.theme] = savedTrack;
}

function applyRestoredThemeTrack(state) {
  const selectedTrack = state.selections[state.theme];
  state.current = selectedTrack || resolveThemeTrack(state.theme, state.manifest);
  state.mode = selectedTrack ? "CUSTOM" : "AUTO THEME";
}

function restorePreferences(state) {
  try {
    const saved = JSON.parse(state.storage.getItem(PREFS) || "{}");
    state.volume = Number.isFinite(Number(saved.volume)) ? clamp(saved.volume, 0, 1) : DEFAULT_VOLUME;
    state.shuffle = saved.shuffle === true;
    state.loop = saved.loop !== false;
    if (saved.theme) state.theme = sanitizeThemeId(saved.theme, state.manifest);
    restoreThemeSelections(state, saved);
    applyRestoredThemeTrack(state);
  } catch {
    // Storage is optional; a broken preference store must not block playback.
  }
}

function themeTracks(state, theme) {
  if (typeof theme !== "string" || !Object.prototype.hasOwnProperty.call(state.manifest.defaults, theme)) return [];
  const assigned = state.manifest.themes?.[theme];
  return Array.isArray(assigned) ? assigned.filter(id => Boolean(sanitizeTrackId(id, state.manifest))) : [];
}

function trackFor(state) {
  return state.manifest.tracks[state.current];
}

function announceStatus(state, message) {
  state.status = message;
  state.announce(message);
}

function persistPreferences(state) {
  state.audios.forEach(audio => {
    if (audio) audio.loop = state.loop;
  });
  try {
    state.storage.setItem(PREFS, JSON.stringify({
      volume: state.volume,
      shuffle: state.shuffle,
      loop: state.loop,
      mode: state.mode === "CUSTOM" ? "CUSTOM" : "AUTO THEME",
      theme: sanitizeThemeId(state.theme, state.manifest),
      track: sanitizeTrackId(state.current, state.manifest) || resolveThemeTrack(state.theme, state.manifest),
      selections: Object.fromEntries(Object.entries(state.selections).filter(([theme, track]) => themeTracks(state, theme).includes(track)))
    }));
  } catch {
    // Playback remains available if persistence is unavailable.
  }
}

function syncAudioVolume(state, audio, index) {
  if (!audio) return;
  const active = index === state.active;
  if (!active) {
    audio.volume = 0;
    audio.loop = state.loop;
    return;
  }
  ensureAudioSource(state, audio);
  audio.volume = state.volume;
  audio.loop = state.loop;
}

function ensureAudioSource(state, audio) {
  if (audio.src) return;
  const currentTrack = state.manifest.tracks[state.current];
  if (!currentTrack) return;
  audio.src = currentTrack.src;
}

function setAudioVolumes(state) {
  state.audios.forEach((audio, index) => syncAudioVolume(state, audio, index));
}

function rebuildQueue(state) {
  const fallback = resolveThemeTrack(state.theme, state.manifest);
  const candidates = state.manifest.themes[state.theme] || (fallback ? [fallback] : []);
  const ids = [...new Set(candidates.filter(id => sanitizeTrackId(id, state.manifest)))];
  if (state.shuffle) {
    for (let index = ids.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(clamp(state.random(), 0, 0.999999) * (index + 1));
      [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
    }
  }
  state.queue = ids;
  state.queueIndex = Math.max(0, state.queue.indexOf(state.current));
  state.history = [];
}

function handleNaturalEnd(state, audio) {
  if (audio !== state.audios[state.active]) return;
  if (!state.playing) return;
  if (state.loop) {
    audio.currentTime = 0;
    audio.play?.();
    return;
  }
  state.playing = false;
  state.pending = null;
  state.blockedPending = null;
  announceStatus(state, "ended");
}

function connectEndedHandlers(state) {
  state.audios.forEach(audio => {
    audio?.addEventListener?.("ended", () => handleNaturalEnd(state, audio));
  });
}

function cancelFade(state) {
  if (state.frame === null) return;
  state.cancelFrame(state.frame);
  state.frame = null;
}

function rememberRestore(state, restore) {
  state.pendingRestore = {
    ...restore,
    queue: restore.queue ? [...restore.queue] : undefined,
    history: restore.history ? [...restore.history] : undefined
  };
}

function prepareTrackLoad(state, safe, restore) {
  const token = ++state.transition;
  const incoming = 1 - state.active;
  const element = state.audios[incoming];
  if (!element) return null;
  state.pending = element;
  state.pendingIndex = incoming;
  state.blockedPending = null;
  rememberRestore(state, restore);
  cancelFade(state);
  element.pause?.();
  element.src = state.manifest.tracks[safe].src;
  element.currentTime = 0;
  element.volume = 0;
  state.current = safe;
  state.startedAt = state.now();
  return { token, incoming, element, restore };
}

function transitionIsCurrent(state, context) {
  return context.token === state.transition;
}

function finishTransition(state, context) {
  if (!transitionIsCurrent(state, context)) return;
  state.active = context.incoming;
  state.pending = null;
  state.pendingIndex = -1;
  state.blockedPending = null;
  context.element.volume = state.volume;
  state.audios[1 - state.active]?.pause?.();
  state.playing = true;
  setAudioVolumes(state);
  announceStatus(state, "playing");
}

function createFade(state, context, duration) {
  const finish = () => finishTransition(state, context);
  return function rampIncomingVolume() {
    if (!transitionIsCurrent(state, context)) return;
    state.playing = true;
    const elapsed = (state.now() - state.startedAt) / duration;
    let ratio = Math.min(1, Math.max(0, elapsed));
    if (state.reducedMotion) ratio = 1;
    context.element.volume = state.volume * ratio;
    if (state.audios[state.active]) state.audios[state.active].volume = state.volume * (1 - ratio);
    if (ratio >= 1) finish();
    else state.frame = state.requestFrame(rampIncomingVolume);
  };
}

function restoreLoadedState(state, restore) {
  state.current = restore.current;
  state.queueIndex = restore.queueIndex;
  for (const key of ["theme", "mode", "loop", "shuffle", "selections"]) {
    if (restore[key] !== undefined) state[key] = restore[key];
  }
  if (restore.selections) state.selections = { ...restore.selections };
  if (restore.queue) state.queue = [...restore.queue];
  if (restore.history) state.history = [...restore.history];
}

function rollbackTrackLoad(state, context) {
  if (!transitionIsCurrent(state, context)) return;
  cancelFade(state);
  state.transition += 1;
  state.pending = null;
  state.pendingIndex = -1;
  state.blockedPending = null;
  state.pendingRestore = null;
  restoreLoadedState(state, context.restore);
  context.element.pause?.();
  setAudioVolumes(state);
  persistPreferences(state);
  announceStatus(state, "track-error");
}

function handleAutoplayBlocked(state, context, playToken) {
  if (!transitionIsCurrent(state, context)) return;
  if (playToken !== state.playAttempt) return;
  state.blockedPending = context.element;
  state.audios.forEach((audio, index) => {
    if (index !== context.incoming) audio?.pause?.();
  });
  announceStatus(state, "autoplay-blocked");
}

function settleLoadPlay(state, context, playToken, ramp, result) {
  if (result?.then) {
    result.then(ramp).catch(() => handleAutoplayBlocked(state, context, playToken));
    return;
  }
  ramp();
}

function startIncomingAudio(state, context, ramp) {
  if (!transitionIsCurrent(state, context)) return;
  const playToken = ++state.playAttempt;
  try {
    const result = context.element.play?.();
    settleLoadPlay(state, context, playToken, ramp, result);
  } catch {
    handleAutoplayBlocked(state, context, playToken);
  }
}

function connectLoadHandlers(state, context, ramp) {
  const element = context.element;
  if (typeof element.addEventListener !== "function") {
    startIncomingAudio(state, context, ramp);
    return;
  }
  const onReady = () => {
    element.removeEventListener?.("canplay", onReady);
    startIncomingAudio(state, context, ramp);
  };
  const onError = () => rollbackTrackLoad(state, context);
  element.addEventListener("canplay", onReady, { once: true });
  element.addEventListener("error", onError, { once: true });
  element.addEventListener("stalled", onError, { once: true });
}

function loadTrack(state, id, duration = 350, restore = { current: state.current, queueIndex: state.queueIndex }) {
  const safe = sanitizeTrackId(id, state.manifest);
  if (!safe) {
    announceStatus(state, "track-unavailable");
    return false;
  }
  const context = prepareTrackLoad(state, safe, restore);
  if (!context) return false;
  const ramp = createFade(state, context, duration);
  connectLoadHandlers(state, context, ramp);
  persistPreferences(state);
  return true;
}

function selectTrack(state, id, { play = true } = {}) {
  if (!themeTracks(state, state.theme).includes(id)) return false;
  const restore = { current: state.current, queueIndex: state.queueIndex, mode: state.mode, queue: [...state.queue], history: [...state.history], selections: { ...state.selections } };
  state.selections[state.theme] = id;
  state.mode = "CUSTOM";
  if (!state.queue.includes(id)) state.queue.push(id);
  state.queueIndex = state.queue.indexOf(id);
  state.history.push(state.current);
  if (!play) {
    stopPlayer(state);
    state.current = id;
    const activeAudio = state.audios[state.active];
    if (activeAudio) {
      activeAudio.src = state.manifest.tracks[id].src;
      activeAudio.currentTime = 0;
    }
    setAudioVolumes(state);
    persistPreferences(state);
    return true;
  }
  return loadTrack(state, id, 350, restore);
}

function setTheme(state, id, { userInitiated = false, play = true } = {}) {
  const restore = {
    current: state.current,
    queueIndex: state.queueIndex,
    theme: state.theme,
    mode: state.mode,
    loop: state.loop,
    shuffle: state.shuffle,
    queue: [...state.queue],
    history: [...state.history]
  };
  const nextTheme = sanitizeThemeId(id, state.manifest);
  if (shouldIgnoreThemeChange(state, nextTheme, userInitiated)) return;
  state.theme = nextTheme;
  const target = state.selections[state.theme] || resolveThemeTrack(state.theme, state.manifest);
  state.mode = state.selections[state.theme] ? "CUSTOM" : "AUTO THEME";
  rebuildQueue(state);
  if (!target) {
    restoreLoadedState(state, restore);
    announceStatus(state, "track-unavailable");
    persistPreferences(state);
    return false;
  }
  if (!play) {
    stopPlayer(state);
    state.current = target;
    rebuildQueue(state);
    const activeAudio = state.audios[state.active];
    if (activeAudio) {
      activeAudio.src = state.manifest.tracks[target].src;
      activeAudio.currentTime = 0;
    }
    setAudioVolumes(state);
    persistPreferences(state);
    return true;
  }
  state.current = target;
  return loadTrack(state, target, 650, restore);
}

function shouldIgnoreThemeChange(state, nextTheme, userInitiated) {
  if (userInitiated) return false;
  if (nextTheme !== state.theme) return false;
  return state.mode !== "CUSTOM";
}

function nextTrack(state) {
  if (!state.queue.length) {
    announceStatus(state, "track-unavailable");
    return false;
  }
  if (state.queueIndex < state.queue.length - 1) return advanceQueue(state);
  if (!state.loop) {
    announceStatus(state, "ended");
    state.audios[state.active]?.pause?.();
    return false;
  }
  return advanceQueue(state);
}

function advanceQueue(state) {
  const restore = { current: state.current, queueIndex: state.queueIndex, history: [...state.history] };
  const prior = state.current;
  state.queueIndex = (state.queueIndex + 1) % state.queue.length;
  state.history.push(prior);
  return loadTrack(state, state.queue[state.queueIndex], 350, restore);
}

function previousTrack(state) {
  if (!state.queue.length) {
    announceStatus(state, "track-unavailable");
    return false;
  }
  const elapsed = state.audios[state.active]?.currentTime ?? ((state.now() - state.startedAt) / 1000);
  if (elapsed > 3) {
    if (state.audios[state.active]) state.audios[state.active].currentTime = 0;
    return true;
  }
  const restore = { current: state.current, queueIndex: state.queueIndex, history: [...state.history] };
  if (state.history.length) {
    const id = state.history.pop();
    state.queueIndex = Math.max(0, state.queue.indexOf(id));
    return loadTrack(state, id, 350, restore);
  }
  state.queueIndex = (state.queueIndex - 1 + state.queue.length) % state.queue.length;
  return loadTrack(state, state.queue[state.queueIndex], 350, restore);
}

function stopPlayer(state) {
  cancelFade(state);
  state.transition += 1;
  state.playAttempt += 1;
  state.audios.forEach(audio => audio?.pause?.());
  state.pending = null;
  state.blockedPending = null;
  state.pendingRestore = null;
  state.pendingIndex = -1;
  state.playing = false;
  setAudioVolumes(state);
  announceStatus(state, "paused");
  return false;
}

function retryBlockedPlayback(state, token) {
  const element = state.blockedPending;
  if (!element) return false;
  state.blockedPending = null;
  const pendingIndex = state.pendingIndex;
  const complete = () => {
    if (token !== state.playAttempt) return;
    state.active = pendingIndex;
    state.pending = null;
    state.pendingIndex = -1;
    state.playing = true;
    setAudioVolumes(state);
    announceStatus(state, "playing");
  };
  const failed = () => {
    if (token === state.playAttempt) announceStatus(state, "autoplay-blocked");
  };
  try {
    const result = element.play?.();
    settleDirectPlay(result, complete, failed);
  } catch {
    failed();
  }
  return true;
}

function isPlayingOrFading(state) {
  if (state.playing) return true;
  if (state.audios[state.active]?.paused === false) return true;
  if (!state.pending) return false;
  return state.frame !== null;
}

function restorePendingSnapshot(state) {
  if (!state.pendingRestore) return;
  restoreLoadedState(state, state.pendingRestore);
  state.pendingRestore = null;
}

function pauseTransition(state) {
  cancelFade(state);
  state.transition += 1;
  state.audios.forEach(audio => audio?.pause?.());
  state.pending = null;
  state.pendingIndex = -1;
  restorePendingSnapshot(state);
  state.playing = false;
  setAudioVolumes(state);
  announceStatus(state, "paused");
  return false;
}

function settleDirectPlay(result, complete, failed) {
  if (result?.then) {
    result.then(complete).catch(failed);
    return;
  }
  complete();
}

function startDirectPlayback(state, token) {
  const index = state.pending ? state.pendingIndex : state.active;
  const element = state.audios[index];
  if (!element) {
    announceStatus(state, "track-unavailable");
    return false;
  }
  state.audios.forEach((audio, audioIndex) => {
    if (audioIndex !== index) audio?.pause?.();
  });
  const complete = () => {
    if (token !== state.playAttempt) return;
    state.active = index;
    state.pending = null;
    state.pendingIndex = -1;
    state.playing = true;
    setAudioVolumes(state);
    announceStatus(state, "playing");
  };
  const failed = () => {
    if (token !== state.playAttempt) return;
    state.playing = false;
    announceStatus(state, "autoplay-blocked");
  };
  try {
    const result = element.play?.();
    settleDirectPlay(result, complete, failed);
  } catch {
    failed();
  }
  return true;
}

function togglePlay(state) {
  const token = ++state.playAttempt;
  if (state.blockedPending) return retryBlockedPlayback(state, token);
  if (isPlayingOrFading(state)) return pauseTransition(state);
  return startDirectPlayback(state, token);
}

function snapshotPreferences(state) {
  return {
    current: state.current,
    queueIndex: state.queueIndex,
    theme: state.theme,
    mode: state.mode,
    loop: state.loop,
    shuffle: state.shuffle,
    queue: [...state.queue],
    history: [...state.history],
    selections: { ...state.selections },
  };
}

function playbackIsActive(state) {
  if (state.playing) return true;
  if (state.pending) return true;
  if (state.blockedPending) return true;
  return state.audios[state.active]?.paused === false;
}

function applyScalarPreferences(state, value) {
  if (Number.isFinite(Number(value.volume))) state.volume = clamp(value.volume, 0, 1);
  const previousShuffle = state.shuffle;
  state.shuffle = value.shuffle === true;
  state.loop = value.loop !== false;
  return previousShuffle;
}

function applySavedSelectionMap(state, selections) {
  state.selections = Object.fromEntries(Object.entries(selections).filter(([theme, track]) => themeTracks(state, theme).includes(track)));
  applyRestoredThemeTrack(state);
}

function applyLegacyTrackSelection(state, value) {
  if (value.mode !== "CUSTOM") {
    state.mode = "AUTO THEME";
    return;
  }
  if (!themeTracks(state, state.theme).includes(value.track)) {
    state.mode = "AUTO THEME";
    return;
  }
  state.current = value.track;
  state.selections[state.theme] = value.track;
  state.mode = "CUSTOM";
}

function applySyncedTrackPreferences(state, value) {
  if (isRecord(value.selections)) {
    applySavedSelectionMap(state, value.selections);
    return;
  }
  applyLegacyTrackSelection(state, value);
}

function syncPlayingTrack(state, restore) {
  restore.loop = state.loop;
  restore.shuffle = state.shuffle;
  rebuildQueue(state);
  if (loadTrack(state, state.current, 350, restore)) return true;
  restoreLoadedState(state, restore);
  setAudioVolumes(state);
  return false;
}

function syncStoppedTrack(state) {
  stopPlayer(state);
  const activeAudio = state.audios[state.active];
  const track = trackFor(state);
  if (activeAudio && track) {
    activeAudio.src = track.src;
    activeAudio.currentTime = 0;
  }
  rebuildQueue(state);
  setAudioVolumes(state);
  return true;
}

function syncTrackPlayback(state, restore, wasPlaying) {
  if (wasPlaying) return syncPlayingTrack(state, restore);
  return syncStoppedTrack(state);
}

function syncPreferences(state, raw) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!isRecord(value)) return false;
    const restore = snapshotPreferences(state);
    const wasPlaying = playbackIsActive(state);
    const previousShuffle = applyScalarPreferences(state, value);
    applySyncedTrackPreferences(state, value);
    if (state.current !== restore.current) return syncTrackPlayback(state, restore, wasPlaying);
    if (state.shuffle !== previousShuffle) rebuildQueue(state);
    setAudioVolumes(state);
    return true;
  } catch {
    return false;
  }
}

function toggleShuffle(state) {
  state.shuffle = !state.shuffle;
  state.mode = "CUSTOM";
  rebuildQueue(state);
  persistPreferences(state);
  return state.shuffle;
}

function toggleLoop(state) {
  state.loop = !state.loop;
  state.mode = "CUSTOM";
  persistPreferences(state);
  return state.loop;
}

function seek(state, fraction) {
  const value = clamp(fraction, 0, 1);
  const duration = Number(state.audios[state.active]?.duration) || 0;
  if (state.audios[state.active]) state.audios[state.active].currentTime = duration * value;
  return value;
}

function setVolume(state, value) {
  state.volume = clamp(value, 0, 1);
  setAudioVolumes(state);
  persistPreferences(state);
  return state.volume;
}

function resetToThemeTrack(state) {
  const restore = {
    current: state.current,
    queueIndex: state.queueIndex,
    theme: state.theme,
    mode: state.mode,
    loop: state.loop,
    shuffle: state.shuffle,
    queue: [...state.queue],
    history: [...state.history],
    selections: { ...state.selections }
  };
  state.mode = "AUTO THEME";
  state.loop = true;
  state.shuffle = false;
  delete state.selections[state.theme];
  state.current = resolveThemeTrack(state.theme, state.manifest);
  rebuildQueue(state);
  if (!state.current) {
    restoreLoadedState(state, restore);
    announceStatus(state, "track-unavailable");
    return false;
  }
  return loadTrack(state, state.current, 350, restore);
}

function snapshot(state) {
  return {
    theme: state.theme,
    currentTrackId: state.current,
    selectedTrackId: state.selections[state.theme] || resolveThemeTrack(state.theme, state.manifest),
    title: trackFor(state)?.title,
    mode: state.mode,
    loop: state.loop,
    shuffle: state.shuffle,
    volume: state.volume,
    status: state.status,
    playing: state.playing,
    currentTime: state.audios[state.active]?.currentTime || 0,
    queue: [...state.queue],
    history: [...state.history]
  };
}

export function createMusicPlayer(options = {}) {
  const state = createPlayerState(options);
  restorePreferences(state);
  rebuildQueue(state);
  setAudioVolumes(state);
  connectEndedHandlers(state);
  return {
    syncPreferences: raw => syncPreferences(state, raw),
    stop: () => stopPlayer(state),
    pause: () => stopPlayer(state),
    setTheme: (id, settings) => setTheme(state, id, settings),
    selectTrack: (id, settings) => selectTrack(state, id, settings),
    togglePlay: () => togglePlay(state),
    toggleShuffle: () => toggleShuffle(state),
    toggleLoop: () => toggleLoop(state),
    next: () => nextTrack(state),
    previous: () => previousTrack(state),
    seek: fraction => seek(state, fraction),
    setVolume: value => setVolume(state, value),
    resetToThemeTrack: () => resetToThemeTrack(state),
    snapshot: () => snapshot(state)
  };
}
