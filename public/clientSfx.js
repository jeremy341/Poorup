// SFX: restrained arcade blips synthesized with Web Audio (no asset files).
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";

let audioCtx = null;

function announceSoundMessage(message) {
  const status = $("#music-status");
  if (status && status.textContent !== message) status.textContent = message;
}

function tone(freq, dur, vol = 0.035, when = 0) {
  if (!state.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume()?.catch(() => announceSoundMessage("Sound is blocked. Activate a control to retry."));
    const t0 = audioCtx.currentTime + when;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  } catch { /* audio blocked */ }
}

const SOUND_TRACKS = {
  die: [{ freq: 220, dur: 0.05, vol: 0.03 }],
  // dice rattle (roll start) and landing thud (total revealed)
  rattle: [{ freq: 300, dur: 0.03, vol: 0.02 }, { freq: 240, dur: 0.03, vol: 0.02, when: 0.05 }, { freq: 330, dur: 0.03, vol: 0.02, when: 0.1 }, { freq: 260, dur: 0.03, vol: 0.02, when: 0.15 }],
  thud: [{ freq: 110, dur: 0.09, vol: 0.045 }],
  cash: [{ freq: 660, dur: 0.06, vol: 0.03 }, { freq: 880, dur: 0.07, vol: 0.03, when: 0.06 }],
  // coin pitch falls when cash leaves the player
  spend: [{ freq: 880, dur: 0.06, vol: 0.03 }, { freq: 520, dur: 0.08, vol: 0.03, when: 0.06 }],
  house: [{ freq: 140, dur: 0.08, vol: 0.04 }],
  auction: [{ freq: 520, dur: 0.12, vol: 0.03 }, { freq: 390, dur: 0.14, vol: 0.03, when: 0.12 }],
  bid: [{ freq: 720, dur: 0.05, vol: 0.025 }],
  trade: [{ freq: 520, dur: 0.08, vol: 0.03 }, { freq: 780, dur: 0.1, vol: 0.03, when: 0.09 }],
  step: [{ freq: 180, dur: 0.03, vol: 0.02 }],
};

export function playSound(name) {
  if (!state.sound) return;
  const track = SOUND_TRACKS[name];
  if (!track) return;
  track.forEach((note) => tone(note.freq, note.dur, note.vol, note.when || 0));
}

export function resumeSuspendedAudioContext() {
  if (audioCtx?.state !== "suspended") return;
  audioCtx.resume()?.catch(() => announceSoundMessage("Sound is blocked. Activate a control to retry."));
}
