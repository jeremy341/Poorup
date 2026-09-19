import { MUSIC_MANIFEST, resolveThemeTrack, sanitizeThemeId, sanitizeTrackId } from "./clientMusicData.js";

const PREFS = "poorup.music.preferences";
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export function createMusicPlayer(options = {}) {
  const {
    audioA,
    audioB,
    manifest = MUSIC_MANIFEST,
    getThemeId = () => "original",
    storage = {},
    announce = () => {},
    now = () => Date.now(),
    requestFrame = (fn) => setTimeout(fn, 16),
    cancelFrame = (id) => clearTimeout(id),
    reducedMotion = false,
    random = Math.random,
  } = options;
  const audios = [audioA, audioB];
  let active = 0;
  let transition = 0;
  let frame = null;
  let transitionDuration = 0;
  let reconcileTransition = () => {};
  let theme = sanitizeThemeId(getThemeId(), manifest);
  let current = resolveThemeTrack(theme, manifest);
  let mode = "AUTO THEME";
  let loop = true;
  let shuffle = false;
  let volume = 0.16;
  let status = "idle";
  let playing = false;
  let playAttempt = 0;
  let pending = null;
  let pendingIndex = -1;
  let blockedPending = null;
  let pendingRestore = null;
  let startedAt = now();
  let queue = [];
  let queueIndex = 0;
  let history = [];

  try {
    const saved = JSON.parse(storage.getItem(PREFS) || "{}");
    volume = Number.isFinite(Number(saved.volume)) ? clamp(saved.volume, 0, 1) : 0.16;
    // Theme music is deliberately deterministic. Older player preferences
    // may contain custom tracks, shuffle, or loop-off state; none of those
    // settings are restored now that the visible player has been retired.
    mode = "AUTO THEME";
    loop = true;
    shuffle = false;
    theme = sanitizeThemeId(getThemeId(), manifest);
    current = resolveThemeTrack(theme, manifest);
  } catch {}

  const track = () => manifest.tracks[current];
  const persist = () => {
    audios.forEach((audio) => {
      if (audio) audio.loop = loop;
    });
    try {
      storage.setItem(PREFS, JSON.stringify({
        volume,
        shuffle,
        loop,
        mode: mode === "CUSTOM" ? "CUSTOM" : "AUTO THEME",
        theme: sanitizeThemeId(theme, manifest),
        track: sanitizeTrackId(current, manifest) || resolveThemeTrack(theme, manifest),
      }));
    } catch {}
  };

  const setVolumes = () => audios.forEach((audio, index) => {
    if (!audio) return;
    if (index === active && !audio.src && manifest.tracks[current]) audio.src = manifest.tracks[current].src;
    audio.volume = index === active ? volume : 0;
    audio.loop = loop;
  });

  const announceStatus = (message) => {
    status = message;
    announce(message);
  };

  const rebuildQueue = () => {
    const fallback = resolveThemeTrack(theme, manifest);
    const ids = [...new Set((manifest.themes[theme] || (fallback ? [fallback] : []))
      .filter((id) => sanitizeTrackId(id, manifest)))];
    if (shuffle) {
      for (let i = ids.length - 1; i > 0; i -= 1) {
        const j = Math.floor(clamp(random(), 0, 0.999999) * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
    }
    queue = ids;
    queueIndex = Math.max(0, queue.indexOf(current));
    history = [];
  };

  rebuildQueue();
  setVolumes();
  persist();
  audios.forEach((audio) => audio?.addEventListener?.("ended", () => {
    if (audio !== audios[active] || !playing) return;
    if (loop) {
      audio.currentTime = 0;
      audio.play?.();
    } else {
      playing = false;
      pending = null;
      blockedPending = null;
      announceStatus("ended");
    }
  }));

  function load(id, duration = 350, restore = { current, queueIndex }) {
    const safe = sanitizeTrackId(id, manifest);
    if (!safe) {
      announceStatus("track-unavailable");
      return false;
    }
    const token = ++transition;
    const incoming = 1 - active;
    const element = audios[incoming];
    if (!element) return false;
    const prior = restore.current;
    const priorIndex = restore.queueIndex;
    if (frame !== null) {
      cancelFrame(frame);
      frame = null;
    }
    pending = element;
    pendingIndex = incoming;
    blockedPending = null;
    pendingRestore = {
      ...restore,
      queue: restore.queue ? [...restore.queue] : undefined,
      history: restore.history ? [...restore.history] : undefined,
    };
    transitionDuration = duration;
    element.pause?.();
    element.src = manifest.tracks[safe].src;
    element.currentTime = 0;
    element.volume = 0;
    current = safe;
    startedAt = now();

    const finish = () => {
      if (token !== transition) return;
      frame = null;
      transitionDuration = 0;
      reconcileTransition = () => {};
      active = incoming;
      pending = null;
      pendingIndex = -1;
      blockedPending = null;
      element.volume = volume;
      audios[1 - active]?.pause?.();
      playing = true;
      setVolumes();
      announceStatus("playing");
    };

    const ramp = () => {
      if (token !== transition) return;
      playing = true;
      const ratio = reducedMotion ? 1 : Math.min(1, Math.max(0, (now() - startedAt) / duration));
      element.volume = volume * ratio;
      if (audios[active]) audios[active].volume = volume * (1 - ratio);
      if (ratio >= 1) finish();
      else frame = requestFrame(ramp);
    };

    reconcileTransition = () => {
      if (token === transition && transitionDuration) ramp();
    };
    const playToken = ++playAttempt;
    const play = () => {
      if (token !== transition) return;
      try {
        const result = element.play?.();
        if (result?.then) {
          result.then(ramp).catch(() => {
            if (token === transition && playToken === playAttempt) {
              blockedPending = element;
              audios.forEach((audio, index) => {
                if (index !== incoming) audio?.pause?.();
              });
              announceStatus("autoplay-blocked");
            }
          });
        } else ramp();
      } catch {
        if (token === transition && playToken === playAttempt) {
          blockedPending = element;
          audios.forEach((audio, index) => {
            if (index !== incoming) audio?.pause?.();
          });
          announceStatus("autoplay-blocked");
        }
      }
    };

    if (typeof element.addEventListener === "function") {
      const onReady = () => {
        element.removeEventListener?.("canplay", onReady);
        play();
      };
      const onError = () => {
        if (token !== transition) return;
        if (frame !== null) {
          cancelFrame(frame);
          frame = null;
        }
        transition += 1;
        transitionDuration = 0;
        reconcileTransition = () => {};
        pending = null;
        pendingIndex = -1;
        blockedPending = null;
        pendingRestore = null;
        current = prior;
        queueIndex = priorIndex;
        if (restore.theme !== undefined) theme = restore.theme;
        if (restore.mode !== undefined) mode = restore.mode;
        if (restore.loop !== undefined) loop = restore.loop;
        if (restore.shuffle !== undefined) shuffle = restore.shuffle;
        if (restore.queue) queue = [...restore.queue];
        if (restore.history) history = [...restore.history];
        element.pause?.();
        setVolumes();
        persist();
        announceStatus("track-error");
      };
      element.addEventListener("canplay", onReady, { once: true });
      element.addEventListener("error", onError, { once: true });
      element.addEventListener("stalled", onError, { once: true });
    } else play();
    // Setting src is not sufficient for every browser/media implementation,
    // especially for hidden audio elements. Explicitly start the new source
    // load so theme switches cannot leave the previous track active.
    element.load?.();
    persist();
    return true;
  }

  function selectTrack(id) {
    if (!sanitizeTrackId(id, manifest)) return false;
    const restore = { current, queueIndex, mode, queue: [...queue], history: [...history] };
    mode = "CUSTOM";
    if (!queue.includes(id)) queue.push(id);
    queueIndex = queue.indexOf(id);
    history.push(current);
    return load(id, 350, restore);
  }

  function setTheme(id, { userInitiated = false } = {}) {
    const restore = { current, queueIndex, theme, mode, loop, shuffle, queue: [...queue], history: [...history] };
    const nextTheme = sanitizeThemeId(id, manifest);
    if (!userInitiated && nextTheme === theme && mode !== "CUSTOM") return;
    theme = nextTheme;
    mode = "AUTO THEME";
    loop = true;
    shuffle = false;
    const target = resolveThemeTrack(theme, manifest);
    rebuildQueue();
    if (!target) {
      current = restore.current;
      queueIndex = restore.queueIndex;
      theme = restore.theme;
      mode = restore.mode;
      loop = restore.loop;
      shuffle = restore.shuffle;
      queue = restore.queue;
      history = restore.history;
      announceStatus("track-unavailable");
      persist();
      return false;
    }
    current = target;
    return load(target, 650, restore);
  }

  function next() {
    if (!queue.length) {
      announceStatus("track-unavailable");
      return false;
    }
    if (queueIndex >= queue.length - 1 && !loop) {
      announceStatus("ended");
      audios[active]?.pause?.();
      return false;
    }
    const restore = { current, queueIndex, history: [...history] };
    const prior = current;
    queueIndex = (queueIndex + 1) % queue.length;
    history.push(prior);
    return load(queue[queueIndex], 350, restore);
  }

  function previous() {
    if (!queue.length) {
      announceStatus("track-unavailable");
      return false;
    }
    const elapsed = audios[active]?.currentTime ?? ((now() - startedAt) / 1000);
    if (elapsed > 3) {
      if (audios[active]) audios[active].currentTime = 0;
      return true;
    }
    const restore = { current, queueIndex, history: [...history] };
    if (history.length) {
      const id = history.pop();
      queueIndex = Math.max(0, queue.indexOf(id));
      return load(id, 350, restore);
    }
    queueIndex = (queueIndex - 1 + queue.length) % queue.length;
    return load(queue[queueIndex], 350, restore);
  }

  const stop = () => {
    if (frame !== null) {
      cancelFrame(frame);
      frame = null;
    }
    transition += 1;
    transitionDuration = 0;
    reconcileTransition = () => {};
    playAttempt += 1;
    audios.forEach((audio) => audio?.pause?.());
    pending = null;
    blockedPending = null;
    pendingRestore = null;
    pendingIndex = -1;
    playing = false;
    setVolumes();
    announceStatus("paused");
    return false;
  };

  return {
    syncPreferences(raw) {
      try {
        const value = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!value || typeof value !== "object") return false;
        if (Number.isFinite(Number(value.volume))) volume = clamp(value.volume, 0, 1);
        // Cross-tab preference payloads from the retired dock are normalized
        // to the single soundtrack contract as well.
        shuffle = false;
        loop = true;
        mode = "AUTO THEME";
        current = resolveThemeTrack(theme, manifest);
        rebuildQueue();
        setVolumes();
        persist();
        return true;
      } catch {
        return false;
      }
    },
    stop,
    pause: stop,
    setTheme,
    selectTrack,
    togglePlay() {
      const token = ++playAttempt;
      if (blockedPending) {
        const element = blockedPending;
        blockedPending = null;
        try {
          const result = element.play?.();
          const success = () => {
            if (token !== playAttempt) return;
            active = pendingIndex;
            pending = null;
            pendingIndex = -1;
            transitionDuration = 0;
            reconcileTransition = () => {};
            playing = true;
            setVolumes();
            announceStatus("playing");
          };
          if (result?.then) result.then(success).catch(() => { if (token === playAttempt) announceStatus("autoplay-blocked"); });
          else success();
        } catch {
          if (token === playAttempt) announceStatus("autoplay-blocked");
        }
        return true;
      }
      if (playing || audios[active]?.paused === false || (pending && frame !== null)) {
        const restore = pendingRestore;
        if (frame !== null) {
          cancelFrame(frame);
          frame = null;
        }
        transition += 1;
        transitionDuration = 0;
        reconcileTransition = () => {};
        audios.forEach((audio) => audio?.pause?.());
        pending = null;
        pendingIndex = -1;
        if (restore) {
          current = restore.current;
          queueIndex = restore.queueIndex;
          theme = restore.theme ?? theme;
          mode = restore.mode ?? mode;
          loop = restore.loop ?? loop;
          shuffle = restore.shuffle ?? shuffle;
          queue = restore.queue ? [...restore.queue] : queue;
          history = restore.history ? [...restore.history] : history;
          pendingRestore = null;
        }
        playing = false;
        setVolumes();
        announceStatus("paused");
        return false;
      }
      const index = pending ? pendingIndex : active;
      const element = audios[index];
      if (!element) {
        announceStatus("track-unavailable");
        return false;
      }
      audios.forEach((audio, i) => {
        if (i !== index) audio?.pause?.();
      });
      try {
        const result = element.play?.();
        const success = () => {
          if (token !== playAttempt) return;
          active = index;
          pending = null;
          pendingIndex = -1;
          transitionDuration = 0;
          reconcileTransition = () => {};
          playing = true;
          setVolumes();
          announceStatus("playing");
        };
        if (result?.then) result.then(success).catch(() => { if (token === playAttempt) { playing = false; announceStatus("autoplay-blocked"); } });
        else success();
      } catch {
        if (token === playAttempt) {
          playing = false;
          announceStatus("autoplay-blocked");
        }
      }
      return true;
    },
    toggleShuffle() {
      shuffle = !shuffle;
      mode = "CUSTOM";
      rebuildQueue();
      persist();
      return shuffle;
    },
    toggleLoop() {
      loop = !loop;
      mode = "CUSTOM";
      persist();
      return loop;
    },
    next,
    previous,
    seek(fraction) {
      const value = clamp(fraction, 0, 1);
      const duration = Number(audios[active]?.duration) || 0;
      if (audios[active]) audios[active].currentTime = duration * value;
      return value;
    },
    setVolume(value) {
      volume = clamp(value, 0, 1);
      setVolumes();
      persist();
      return volume;
    },
    resetToThemeTrack() {
      const restore = { current, queueIndex, theme, mode, loop, shuffle, queue: [...queue], history: [...history] };
      mode = "AUTO THEME";
      loop = true;
      shuffle = false;
      current = resolveThemeTrack(theme, manifest);
      rebuildQueue();
      if (!current) {
        current = restore.current;
        queueIndex = restore.queueIndex;
        mode = restore.mode;
        loop = restore.loop;
        shuffle = restore.shuffle;
        queue = restore.queue;
        history = restore.history;
        announceStatus("track-unavailable");
        return false;
      }
      return load(current, 350, restore);
    },
    reconcile() {
      reconcileTransition();
      return this.snapshot();
    },
    snapshot() {
      return {
        theme,
        currentTrackId: current,
        title: track()?.title,
        mode,
        loop,
        shuffle,
        volume,
        status,
        playing,
        currentTime: audios[active]?.currentTime || 0,
        queue: [...queue],
        history: [...history],
      };
    },
  };
}
