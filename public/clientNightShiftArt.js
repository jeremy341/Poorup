import { $ } from "./clientDom.js";

// Night Shift sprite, layout and wave-banner helpers. Most of these are pure
// functions of their arguments, so the arcade loop in clientNightShift.js can
// stay focused on timing and state. The art root keeps every sprite path grouped.
export const PATROL_ART = "/assets/parlor-patrol/";

export function effectSrc(kind) {
  if (kind === "airplane") return `${PATROL_ART}airplane-explosion-10-frames.svg`;
  if (kind === "drone") return `${PATROL_ART}drone-explosion-10-frames.svg`;
  return `${PATROL_ART}impact-8-frames.svg`;
}

export function effectDimensions(kind, aircraft) {
  if (kind === "airplane") return [128, 112];
  if (aircraft) return [112, 112];
  return [64, 64];
}

export function targetSrc(kind, direction) {
  if (kind === "beacon") return `${PATROL_ART}beacon-6-frames.svg`;
  if (kind === "drone") return `${PATROL_ART}drone-8-frames.svg`;
  if (kind === "airplane") return `${PATROL_ART}airplane-10-frames.svg`;
  if (direction === "left") return `${PATROL_ART}helicopter-left-16-frames.svg`;
  return `${PATROL_ART}helicopter-16-frames.svg`;
}

export function targetSize(kind) {
  if (kind === "beacon") return [48, 48];
  if (kind === "drone") return [96, 64];
  if (kind === "airplane") return [112, 64];
  return [128, 64];
}

export function configureTargetPlacement(target, kind, isDrop, lane) {
  if (kind === "airplane") target.classList.replace("night-target-beacon", "night-target-airplane");
  if (!isDrop) {
    target.style.top = `${lane}%`;
    return;
  }
  target.style.setProperty("--night-drop-left", `${[18, 32, 48, 64, 78][Math.floor(Math.random() * 5)]}%`);
}

export function paintTargetArt(target, kind, direction) {
  const src = targetSrc(kind, direction);
  const size = targetSize(kind);
  target.style.width = `${size[0]}px`;
  target.style.height = `${size[1]}px`;
  target.innerHTML = `<img src="${src}" alt="" width="${size[0]}" height="${size[1]}">`;
  if (kind === "airplane" && direction === "left") target.querySelector("img")?.style.setProperty("transform", "scaleX(-1)");
}

export function targetClassName(kind, direction, isDrop) {
  if (isDrop) return "night-target night-target-drop night-target-beacon is-flight";
  return `night-target night-target-${direction} night-target-${kind} is-flight`;
}

export function pickWaveTargetKind(wave, roll) {
  if (wave >= 4 && roll < 0.12) return "airplane";
  if (wave >= 3 && roll < 0.24) return "beacon";
  if (wave >= 2 && roll < 0.44) return "drone";
  return "helicopter";
}

export function pickTargetKind(wave, spawnNumber, roll) {
  if (wave !== 1) return pickWaveTargetKind(wave, roll);
  if (spawnNumber === 2) return "drone";
  return pickWaveTargetKind(wave, roll);
}

export function pickTargetDuration(kind, wave) {
  if (kind === "airplane") return Math.max(2800, 5000 - wave * 180);
  if (kind === "drone") return Math.max(3400, 5900 - wave * 220);
  return Math.max(4200, 7600 - wave * 260);
}

export function waveSpawnInterval(wave) {
  if (wave === 1) return 3000;
  return Math.max(850, 5000 - wave * 220);
}

export function pulseWaveBanner(text) {
  const banner = $("#night-wave-banner");
  if (!banner) return;
  banner.textContent = text;
  banner.classList.remove("is-announcing");
  void banner.offsetWidth;
  banner.classList.add("is-announcing");
}
