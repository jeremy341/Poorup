// Night Shift hit feedback: crash and smoke animations, impact bursts and the
// Home helicopter effects. DOM work only; run state stays in clientNightShift.js.
import { $, REDUCED_MOTION } from "./clientDom.js";
import { PATROL_ART, effectDimensions, effectSrc } from "./clientNightShiftArt.js";

export function resetNightHomeEffects(effects) {
  effects?.querySelectorAll(".night-shift-dynamic").forEach((effect) => effect.remove());
  effects?.querySelectorAll("[data-night-home-effect]").forEach((effect) => {
    effect.classList.remove("is-burst");
    effect.style.removeProperty("left");
    effect.style.removeProperty("top");
  });
}

function homeEffectElement(effects, kind) {
  const existing = effects.querySelector(`[data-night-home-effect="${kind}"]`);
  if (existing) return existing;
  const smoke = kind === "home-smoke";
  const effect = document.createElement("span");
  effect.className = `night-shift-effect night-shift-home-${smoke ? "smoke" : "impact"}`;
  effect.dataset.nightHomeEffect = kind;
  effect.innerHTML = smoke
    ? `<img src="${PATROL_ART}smoke-6-frames.svg" alt="" width="80" height="64">`
    : `<img src="${PATROL_ART}impact-8-frames.svg" alt="" width="64" height="64">`;
  effects.appendChild(effect);
  return effect;
}

function placeHomeEffect(effects, effect, x, y, smoke) {
  const width = smoke ? 80 : 64;
  const height = 64;
  const maxX = Math.max(width / 2, effects.clientWidth - width / 2);
  const maxY = Math.max(height / 2, effects.clientHeight - height / 2);
  const visibleX = Math.max(width / 2, Math.min(maxX, x));
  const visibleY = Math.max(height / 2, Math.min(maxY, y));
  effect.style.left = `${Math.round(visibleX - (smoke ? 40 : 32))}px`;
  effect.style.top = `${Math.round(visibleY - (smoke ? 30 : 32))}px`;
}

function triggerNightShiftHomeEffect(x, y, kind) {
  const effects = $("#night-effects");
  if (!effects) return;
  const smoke = kind === "home-smoke";
  const effect = homeEffectElement(effects, kind);
  placeHomeEffect(effects, effect, x, y, smoke);
  effect.classList.remove("is-burst");
  // Match Home exactly: reset the class, force layout, then restart it.
  void effect.offsetWidth;
  effect.classList.add("is-burst");
}

function spawnNightShiftEffect(x, y, kind = "impact") {
  const effects = $("#night-effects");
  if (!effects) return;
  if (kind === "home-impact" || kind === "home-smoke") {
    triggerNightShiftHomeEffect(x, y, kind);
    return;
  }
  const effect = document.createElement("span");
  const aircraft = kind === "drone" || kind === "airplane";
  effect.className = `night-shift-effect night-shift-dynamic ${aircraft ? "night-shift-aircraft-burst" : "is-burst"}`;
  const [width, height] = effectDimensions(kind, aircraft);
  effect.style.width = `${width}px`;
  effect.style.height = `${height}px`;
  effect.style.left = `${Math.round(x - width / 2)}px`;
  effect.style.top = `${Math.round(y - height / 2)}px`;
  effect.innerHTML = `<img src="${effectSrc(kind)}" alt="" width="${width}" height="${height}">`;
  effects.appendChild(effect);
  setTimeout(() => effect.remove(), aircraft ? 900 : 720);
}

function hitPoint(rect, event, area) {
  const pointerX = Number(event?.clientX) > 0 ? Number(event.clientX) : rect.left + rect.width / 2;
  const pointerY = Number(event?.clientY) > 0 ? Number(event.clientY) : rect.top + rect.height / 2;
  return { x: pointerX - area.left, y: pointerY - area.top };
}

function crashTransform(kind, direction) {
  if (direction !== -1) return "";
  return ["drone", "airplane"].includes(kind) ? "scaleX(-1)" : "";
}

function animateNonHelicopterCrash(target, hitX, hitY, kind) {
  if (REDUCED_MOTION) {
    target.style.opacity = "0";
    spawnNightShiftEffect(hitX, hitY, kind);
    setTimeout(() => target.remove(), 160);
    return;
  }
  target.animate([
    { transform: "translate3d(0, 0, 0) scale(0.96)", opacity: 0.9 },
    { transform: `translate3d(0, -8px, 0) scale(1.04)`, opacity: 0.95 },
    { transform: "translate3d(0, 0, 0) scale(1.02)", opacity: 0 },
  ], { duration: 360, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" });
  setTimeout(() => {
    if (!target.isConnected) return;
    spawnNightShiftEffect(hitX, hitY, kind);
    target.remove();
  }, 280);
}

function crashHelicopter(target, hitX, hitY) {
  target.remove();
  // Match the Home patrol feedback: a compact impact flash and a short
  // stepped smoke trail begin at the exact point of the shot.
  spawnNightShiftEffect(hitX, hitY, "home-impact");
  spawnNightShiftEffect(hitX, hitY + 8, "home-smoke");
}

export function hitPoints(kind, wave) {
  if (kind === "helicopter") return 100 + wave * 25;
  if (kind === "drone") return 75 + wave * 10;
  if (kind === "airplane") return 180 + wave * 20;
  return 50 + wave * 5;
}

function pinCrashPosition(target, rect) {
  const layer = target.parentElement?.getBoundingClientRect();
  if (!layer) return;
  target.style.left = `${rect.left - layer.left}px`;
  target.style.top = `${rect.top - layer.top}px`;
  target.style.right = "auto";
}

function crashWreck(target, kind) {
  target.classList.add("is-popping");
  const direction = target.dataset.direction === "left" ? -1 : 1;
  const crashArt = target.querySelector("img");
  if (crashArt) crashArt.style.transform = crashTransform(kind, direction);
}

export function measureHit(target, event) {
  const rect = target.getBoundingClientRect();
  const area = $("#night-shift")?.getBoundingClientRect();
  if (!area) return null;
  return { rect, point: hitPoint(rect, event, area) };
}

export function playTargetCrash(target, { rect, point }) {
  const kind = target.dataset.kind || "helicopter";
  if (kind !== "helicopter") pinCrashPosition(target, rect);
  target.classList.remove("is-flight");
  if (kind === "helicopter") {
    crashHelicopter(target, point.x, point.y);
    return;
  }
  crashWreck(target, kind);
  animateNonHelicopterCrash(target, point.x, point.y, kind);
}
