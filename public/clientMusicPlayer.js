import { MUSIC_MANIFEST, resolveThemeTrack, sanitizeThemeId, sanitizeTrackId } from "./clientMusicData.js";

const PREFS = "poorup.music.preferences";
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export function createMusicPlayer(options = {}) {
  const { audioA, audioB, manifest = MUSIC_MANIFEST, getThemeId = () => "original", storage = {}, announce = () => {}, now = () => Date.now(), requestFrame = (fn) => setTimeout(fn, 16), cancelFrame = (id) => clearTimeout(id), reducedMotion = false, random = Math.random } = options;
  const audios = [audioA, audioB];
  let active = 0; let transition = 0; let frame = null; let theme = sanitizeThemeId(getThemeId(), manifest);
  let current = resolveThemeTrack(theme, manifest); let mode = "AUTO THEME"; let loop = true; let shuffle = false; let volume = 0.16; let status = "idle"; let startedAt = now();
  let queue = []; let queueIndex = 0; let history = [];
  try { const saved = JSON.parse(storage.getItem(PREFS) || "{}"); volume = Number.isFinite(Number(saved.volume)) ? clamp(saved.volume, 0, 1) : 0.16; shuffle = saved.shuffle === true; loop = saved.loop !== false; if (saved.theme) theme = sanitizeThemeId(saved.theme, manifest); const savedTrack = sanitizeTrackId(saved.track, manifest); if (savedTrack && (manifest.themes[theme] || []).includes(savedTrack)) current = savedTrack; } catch {}
  const track = () => manifest.tracks[current];
  const persist = () => { try { storage.setItem(PREFS, JSON.stringify({ volume, shuffle, loop, theme: sanitizeThemeId(theme, manifest), track: sanitizeTrackId(current, manifest) || resolveThemeTrack(theme, manifest) })); } catch {} };
  const setVolumes = () => audios.forEach((audio, index) => { if (audio) audio.volume = index === active ? volume : 0; });
  const announceStatus = (message) => { status = message; announce(message); };
  const rebuildQueue = () => { const fallback = resolveThemeTrack(theme, manifest); const ids = [...new Set((manifest.themes[theme] || (fallback ? [fallback] : [])).filter(id => sanitizeTrackId(id, manifest)))]; if (shuffle) { for (let i = ids.length - 1; i > 0; i -= 1) { const j = Math.floor(clamp(random(), 0, 0.999999) * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; } } queue = ids; queueIndex = Math.max(0, queue.indexOf(current)); history = []; };
  rebuildQueue(); setVolumes();
  function load(id, duration = 350, restore = { current, queueIndex }) {
    const safe = sanitizeTrackId(id, manifest); if (!safe) { announceStatus("track-unavailable"); return false; }
    const token = ++transition; const incoming = 1 - active; const element = audios[incoming]; if (!element) return false; const prior = restore.current; const priorIndex = restore.queueIndex;
    if (frame !== null) { cancelFrame(frame); frame = null; }
    element.pause?.(); element.src = manifest.tracks[safe].src; element.currentTime = 0; element.volume = 0;
    current = safe; startedAt = now();
    const finish = () => { if (token !== transition) return; active = incoming; element.volume = volume; audios[1 - active]?.pause?.(); setVolumes(); announceStatus("playing"); };
    const ramp = () => { if (token !== transition) return; const ratio = reducedMotion ? 1 : Math.min(1, Math.max(0, (now() - startedAt) / duration)); element.volume = volume * ratio; if (audios[active]) audios[active].volume = volume * (1 - ratio); if (ratio >= 1) finish(); else frame = requestFrame(ramp); };
    const play = () => { if (token !== transition) return; try { const result = element.play?.(); if (result?.then) result.then(ramp).catch(() => { if (token === transition) announceStatus("autoplay-blocked"); }); else ramp(); } catch { if (token === transition) announceStatus("autoplay-blocked"); } };
    if (typeof element.addEventListener === "function") {
      const onReady = () => { element.removeEventListener?.("canplay", onReady); play(); };
      const onError = () => { if (token === transition) { if (frame !== null) { cancelFrame(frame); frame = null; } transition += 1; current = prior; queueIndex = priorIndex; if (restore.theme !== undefined) theme = restore.theme; if (restore.mode !== undefined) mode = restore.mode; if (restore.loop !== undefined) loop = restore.loop; if (restore.queue) queue = [...restore.queue]; if (restore.history) history = [...restore.history]; element.pause?.(); setVolumes(); persist(); announceStatus("track-error"); } };
      element.addEventListener("canplay", onReady, { once: true }); element.addEventListener("error", onError, { once: true }); element.addEventListener("stalled", onError, { once: true });
    }
    else play();
    persist(); if (!safe) announceStatus("track-unavailable"); return true;
  }
  function selectTrack(id) { if (!sanitizeTrackId(id, manifest)) return false; const restore = { current, queueIndex, mode, queue: [...queue], history: [...history] }; mode = "CUSTOM"; if (!queue.includes(id)) queue.push(id); queueIndex = queue.indexOf(id); history.push(current); return load(id, 350, restore); }
  function setTheme(id, { userInitiated = false } = {}) { const restore = { current, queueIndex, theme, mode, loop, queue: [...queue] }; const nextTheme = sanitizeThemeId(id, manifest); if (!userInitiated && nextTheme === theme && mode !== "CUSTOM") return; theme = nextTheme; mode = "AUTO THEME"; loop = true; const target = resolveThemeTrack(theme, manifest); rebuildQueue(); if (!target) { current = restore.current; queueIndex = restore.queueIndex; theme = restore.theme; mode = restore.mode; loop = restore.loop; queue = restore.queue; announceStatus("track-unavailable"); persist(); return false; } current = target; return load(target, 650, restore); }
  function next() { if (!queue.length) { announceStatus("track-unavailable"); return false; } if (queueIndex >= queue.length - 1 && !loop) { announceStatus("ended"); audios[active]?.pause?.(); return false; } const restore = { current, queueIndex }; const prior = current; queueIndex = (queueIndex + 1) % queue.length; history.push(prior); return load(queue[queueIndex], 350, restore); }
  function previous() { if (!queue.length) { announceStatus("track-unavailable"); return false; } const elapsed = audios[active]?.currentTime ?? ((now() - startedAt) / 1000); if (elapsed > 3) { if (audios[active]) audios[active].currentTime = 0; return true; } const restore = { current, queueIndex }; if (history.length) { const id = history.pop(); queueIndex = Math.max(0, queue.indexOf(id)); return load(id, 350, restore); } queueIndex = (queueIndex - 1 + queue.length) % queue.length; return load(queue[queueIndex], 350, restore); }
  return { setTheme, selectTrack, toggleShuffle() { shuffle = !shuffle; mode = "CUSTOM"; rebuildQueue(); persist(); return shuffle; }, toggleLoop() { loop = !loop; mode = "CUSTOM"; persist(); return loop; }, next, previous, seek(fraction) { const value = clamp(fraction, 0, 1); const duration = Number(audios[active]?.duration) || 0; if (audios[active]) audios[active].currentTime = duration * value; return value; }, setVolume(value) { volume = clamp(value, 0, 1); setVolumes(); persist(); return volume; }, resetToThemeTrack() { const restore = { current, queueIndex, theme, mode, loop, queue: [...queue] }; mode = "AUTO THEME"; loop = true; current = resolveThemeTrack(theme, manifest); rebuildQueue(); if (!current) { current = restore.current; queueIndex = restore.queueIndex; mode = restore.mode; loop = restore.loop; queue = restore.queue; announceStatus("track-unavailable"); return false; } return load(current, 350, restore); }, snapshot() { return { theme, currentTrackId: current, title: track()?.title, mode, loop, shuffle, volume, status, currentTime: audios[active]?.currentTime || 0, queue: [...queue] }; } };
}
