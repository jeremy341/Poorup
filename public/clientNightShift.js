/* ============================================================
   NIGHT SHIFT: the Ctrl/Shift+P arcade mini-game on Home.
   Owns the wave timers, spawn queue, hit/miss resolution, the
   background-tab freeze/resume coordinator, and the run
   submission. Server calls, achievements, and Home patrol
   plumbing arrive via host callbacks from the entry module.
   ============================================================ */
import { $, REDUCED_MOTION } from "./clientDom.js";
import { state } from "./clientState.js";
import { hydrateSprites } from "./clientSprites.js";

const NIGHT_SHIFT_WAVE_MS = 60000;
const NIGHT_SHIFT_START_HEARTS = 3;
const NIGHT_SHIFT_BEST_KEY = "poorup.night-shift.best.v1";
let nightShiftWaveTimer = null;
let nightShiftTickTimer = null;
let nightShiftResultTimer = null;
let nightShiftResultEndsAt = 0;
let nightShiftSpawnTimers = [];
let nightShiftWaveHeld = false;
const nightShiftTargetTimers = new Map();
let nightShiftPausedAt = 0;
const nightShiftState = { active: false, wave: 0, score: 0, best: 0, endsAt: 0, targetSeq: 0, hearts: NIGHT_SHIFT_START_HEARTS, misses: 0, serverRunToken: null, serverRunSubmitted: false };
let nightShiftSuppressSnapshot = false;
try { nightShiftState.best = Number(localStorage.getItem(NIGHT_SHIFT_BEST_KEY)) || 0; } catch { /* storage unavailable */ }

let host = {};

export function configureNightShift(hooks) {
  host = hooks;
}

export { nightShiftState };

function formatNightCountdown(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function setIfChanged(el, value) {
  if (!el) return;
  if (el.textContent === value) return;
  el.textContent = value;
}

function heartsLabel() {
  const plural = nightShiftState.hearts === 1 ? "" : "s";
  return `${nightShiftState.hearts} heart${plural} remaining`;
}

function heartsMarkup() {
  const cell = (i) => `<img class="night-heart${i >= nightShiftState.hearts ? " is-empty" : ""}" src="/assets/parlor-patrol/heart.svg" alt="">`;
  return Array.from({ length: NIGHT_SHIFT_START_HEARTS }, (_, i) => cell(i)).join("");
}

function shouldRenderHearts(el, label) {
  if (el.getAttribute("aria-label") !== label) return true;
  if (!nightShiftState.active) return false;
  return el.innerHTML === "";
}

function renderNightHearts() {
  const hearts = $("#night-hearts");
  if (!hearts) return;
  const label = heartsLabel();
  if (!shouldRenderHearts(hearts, label)) return;
  hearts.innerHTML = heartsMarkup();
  hearts.setAttribute("aria-label", label);
}

export function renderNightShiftHud(message = "TAG THE FLY-BYS BEFORE THEY REACH THE BORDER") {
  const nextWave = String(nightShiftState.wave).padStart(2, "0");
  const nextCountdown = formatNightCountdown(Math.max(0, nightShiftState.endsAt - Date.now()));
  const nextScore = String(nightShiftState.score).padStart(3, "0");
  setIfChanged($("#night-wave"), nextWave);
  setIfChanged($("#home-local-time"), nextCountdown);
  setIfChanged($("#home-patrol-score"), nextScore);
  setIfChanged($("#night-status"), message);
  if (!nightShiftState.active) setIfChanged($("#night-shift-description"), message);
  renderNightHearts();
}

function clearTargetTimerEntries() {
  nightShiftTargetTimers.forEach(({ reveal, disable, miss }) => {
    clearTimeout(reveal);
    clearTimeout(disable);
    clearTimeout(miss);
  });
  nightShiftTargetTimers.clear();
}

function clearNightShiftTimers() {
  clearTimeout(nightShiftWaveTimer);
  clearInterval(nightShiftTickTimer);
  clearTimeout(nightShiftResultTimer);
  nightShiftWaveTimer = null;
  nightShiftTickTimer = null;
  nightShiftResultTimer = null;
  nightShiftSpawnTimers.forEach((entry) => clearTimeout(entry.timer));
  nightShiftSpawnTimers = [];
  nightShiftWaveHeld = false;
  clearTargetTimerEntries();
}

function stopNightShiftAtResultEnd() {
  nightShiftResultTimer = null;
  nightShiftResultEndsAt = 0;
  stopNightShift();
}

function scheduleNightShiftResult() {
  clearTimeout(nightShiftResultTimer);
  nightShiftResultTimer = null;
  if (!nightShiftResultEndsAt) return;
  const remaining = nightShiftResultEndsAt - Date.now();
  if (remaining <= 0) {
    nightShiftResultEndsAt = 0;
    stopNightShift();
    return;
  }
  if (document.hidden) return;
  nightShiftResultTimer = setTimeout(stopNightShiftAtResultEnd, remaining);
}

function resetNightHomeEffects(effects) {
  effects?.querySelectorAll(".night-shift-dynamic").forEach((effect) => effect.remove());
  effects?.querySelectorAll("[data-night-home-effect]").forEach((effect) => {
    effect.classList.remove("is-burst");
    effect.style.removeProperty("left");
    effect.style.removeProperty("top");
  });
}

function clearNightShiftTargets() {
  clearTargetTimerEntries();
  $("#night-targets")?.replaceChildren();
  resetNightHomeEffects($("#night-effects"));
}

function clearNightShiftTargetTimer(target) {
  const id = target?.dataset?.targetId;
  if (!id) return;
  const timers = nightShiftTargetTimers.get(id);
  if (!timers) return;
  clearTimeout(timers.reveal);
  clearTimeout(timers.disable);
  clearTimeout(timers.miss);
  nightShiftTargetTimers.delete(id);
}

function triggerNightShiftHomeEffect(x, y, kind) {
  const effects = $("#night-effects");
  if (!effects) return;
  const smoke = kind === "home-smoke";
  const selector = `[data-night-home-effect="${kind}"]`;
  let effect = effects.querySelector(selector);
  if (!effect) {
    effect = document.createElement("span");
    effect.className = `night-shift-effect night-shift-home-${smoke ? "smoke" : "impact"}`;
    effect.dataset.nightHomeEffect = kind;
    effect.innerHTML = smoke
      ? '<img src="/assets/parlor-patrol/smoke-6-frames.svg" alt="" width="80" height="64">'
      : '<img src="/assets/parlor-patrol/impact-8-frames.svg" alt="" width="64" height="64">';
    effects.appendChild(effect);
  }
  const width = smoke ? 80 : 64;
  const height = 64;
  const maxX = Math.max(width / 2, effects.clientWidth - width / 2);
  const maxY = Math.max(height / 2, effects.clientHeight - height / 2);
  const visibleX = Math.max(width / 2, Math.min(maxX, x));
  const visibleY = Math.max(height / 2, Math.min(maxY, y));
  effect.style.left = `${Math.round(visibleX - (smoke ? 40 : 32))}px`;
  effect.style.top = `${Math.round(visibleY - (smoke ? 30 : 32))}px`;
  effect.classList.remove("is-burst");
  // Match Home exactly: reset the class, force layout, then restart it.
  void effect.offsetWidth;
  effect.classList.add("is-burst");
}

function settleHiddenTarget(timers) {
  // The tab froze mid-flight: remember that this animation finished
  // while we were away and let the resume coordinator settle it
  // immediately instead of silently dropping the event.
  timers.endedWhileHidden = true;
}

function settleFlightTarget(timers, target, id) {
  if (document.hidden) {
    settleHiddenTarget(timers);
    return;
  }
  if (target.isConnected && !target.dataset.hit) missNightShiftTarget(target);
  nightShiftTargetTimers.delete(id);
}

function scheduleNightShiftTarget(target, duration) {
  if (!target) return;
  if (REDUCED_MOTION) {
    target.style.pointerEvents = "auto";
    return;
  }
  const id = target.dataset.targetId;
  const timers = { reveal: null, disable: null, miss: null, settle: null, backstop: duration + 80, missElapsed: 0, missStartedAt: 0, endedWhileHidden: false };
  const settle = () => settleFlightTarget(timers, target, id);
  timers.settle = settle;
  target.style.pointerEvents = "none";
  timers.reveal = setTimeout(() => {
    if (target.isConnected && !target.dataset.hit) target.style.pointerEvents = "auto";
  }, Math.round(duration * 0.16));
  timers.disable = setTimeout(() => {
    if (target.isConnected && !target.dataset.hit) target.style.pointerEvents = "none";
  }, Math.round(duration * 0.94));
  target.addEventListener("animationend", settle, { once: true });
  timers.missStartedAt = Date.now();
  timers.miss = setTimeout(settle, timers.backstop);
  nightShiftTargetTimers.set(id, timers);
}

function effectSrc(kind) {
  if (kind === "airplane") return "/assets/parlor-patrol/airplane-explosion-10-frames.svg";
  if (kind === "drone") return "/assets/parlor-patrol/drone-explosion-10-frames.svg";
  return "/assets/parlor-patrol/impact-8-frames.svg";
}

function effectDimensions(kind, aircraft) {
  if (kind === "airplane") return [128, 112];
  if (aircraft) return [112, 112];
  return [64, 64];
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

function pickWaveTargetKind(wave, roll) {
  if (wave >= 4 && roll < 0.12) return "airplane";
  if (wave >= 3 && roll < 0.24) return "beacon";
  if (wave >= 2 && roll < 0.44) return "drone";
  return "helicopter";
}

function pickTargetKind(wave, spawnNumber, roll) {
  if (wave !== 1) return pickWaveTargetKind(wave, roll);
  if (spawnNumber === 2) return "drone";
  return pickWaveTargetKind(wave, roll);
}

function pickTargetDuration(kind, wave) {
  if (kind === "airplane") return Math.max(2800, 5000 - wave * 180);
  if (kind === "drone") return Math.max(3400, 5900 - wave * 220);
  return Math.max(4200, 7600 - wave * 260);
}

function targetSrc(kind, direction) {
  if (kind === "beacon") return "/assets/parlor-patrol/beacon-6-frames.svg";
  if (kind === "drone") return "/assets/parlor-patrol/drone-8-frames.svg";
  if (kind === "airplane") return "/assets/parlor-patrol/airplane-10-frames.svg";
  if (direction === "left") return "/assets/parlor-patrol/helicopter-left-16-frames.svg";
  return "/assets/parlor-patrol/helicopter-16-frames.svg";
}

function targetSize(kind) {
  if (kind === "beacon") return [48, 48];
  if (kind === "drone") return [96, 64];
  if (kind === "airplane") return [112, 64];
  return [128, 64];
}

function configureTargetPlacement(target, kind, isDrop, lane) {
  if (kind === "airplane") target.classList.replace("night-target-beacon", "night-target-airplane");
  if (!isDrop) {
    target.style.top = `${lane}%`;
    return;
  }
  target.style.setProperty("--night-drop-left", `${[18, 32, 48, 64, 78][Math.floor(Math.random() * 5)]}%`);
}

function paintTargetArt(target, kind, direction) {
  const src = targetSrc(kind, direction);
  const size = targetSize(kind);
  target.style.width = `${size[0]}px`;
  target.style.height = `${size[1]}px`;
  target.innerHTML = `<img src="${src}" alt="" width="${size[0]}" height="${size[1]}">`;
  if (kind === "airplane" && direction === "left") target.querySelector("img")?.style.setProperty("transform", "scaleX(-1)");
}

function spawnNightShiftTarget() {
  if (!nightShiftState.active) return;
  if (state.phase !== "home") return;
  if (document.hidden) return; // frozen queue: the resume coordinator re-arms
  const layer = $("#night-targets");
  if (!layer) return;
  // Alternate lanes so a short play session always exercises both edges.
  const direction = nightShiftState.targetSeq % 2 === 0 ? "left" : "right";
  const spawnNumber = nightShiftState.targetSeq;
  const kind = pickTargetKind(nightShiftState.wave, spawnNumber, Math.random());
  const lane = [18, 25, 32, 39, 46, 53, 60][Math.floor(Math.random() * 7)];
  const duration = pickTargetDuration(kind, nightShiftState.wave);
  const target = document.createElement("button");
  target.type = "button";
  const isDrop = kind === "beacon" || kind === "airplane";
  target.className = isDrop
    ? "night-target night-target-drop night-target-beacon is-flight"
    : `night-target night-target-${direction} night-target-${kind} is-flight`;
  configureTargetPlacement(target, kind, isDrop, lane);
  target.style.setProperty("--night-flight-duration", `${duration}ms`);
  target.dataset.direction = direction;
  target.dataset.kind = kind;
  target.dataset.targetId = String(++nightShiftState.targetSeq);
  target.setAttribute("aria-label", `Tag Night Shift ${kind}, wave ${nightShiftState.wave}`);
  paintTargetArt(target, kind, direction);
  // Pointer-down gives the arcade target immediate feedback before a moving
  // button can travel between pointer press and the browser's click release.
  target.addEventListener("pointerdown", (event) => hitNightShiftTarget(target, event));
  target.addEventListener("click", (event) => hitNightShiftTarget(target, event));
  layer.appendChild(target);
  scheduleNightShiftTarget(target, duration);
}

// Spawn timers live as { due, timer } queue entries: hiding the tab freezes
// them in place and the visibilitychange coordinator re-arms each pending
// entry exactly once, so the staggered wave cadence survives a background tab.
function armNightShiftSpawn(entry) {
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (document.hidden) return;
    const index = nightShiftSpawnTimers.indexOf(entry);
    if (index !== -1) nightShiftSpawnTimers.splice(index, 1);
    spawnNightShiftTarget();
  }, Math.max(0, entry.due - Date.now()));
}

function queueNightShiftSpawn(delay) {
  const entry = { due: Date.now() + delay, timer: null };
  nightShiftSpawnTimers.push(entry);
  armNightShiftSpawn(entry);
}

function holdNightShiftWave() {
  // Do not advance waves while hidden; resume re-arms from endsAt.
  nightShiftWaveHeld = true;
}

function advanceNightShiftWave() {
  nightShiftWaveTimer = null;
  if (!nightShiftState.active) return;
  if (document.hidden) {
    holdNightShiftWave();
    return;
  }
  nightShiftState.wave += 1;
  beginNightShiftWave();
}

function pulseWaveBanner(text) {
  const banner = $("#night-wave-banner");
  if (!banner) return;
  banner.textContent = text;
  banner.classList.remove("is-announcing");
  void banner.offsetWidth;
  banner.classList.add("is-announcing");
}

function waveSpawnInterval(wave) {
  if (wave === 1) return 3000;
  return Math.max(850, 5000 - wave * 220);
}

function beginNightShiftWave() {
  if (!nightShiftState.active) return;
  clearNightShiftTargets();
  nightShiftState.endsAt = Date.now() + NIGHT_SHIFT_WAVE_MS;
  const nextWave = String(nightShiftState.wave).padStart(2, "0");
  renderNightShiftHud(`WAVE ${nextWave} · CLEAR THE SKYLINE`);
  pulseWaveBanner(`WAVE ${nextWave}`);
  const targetCount = Math.min(6 + nightShiftState.wave * 2, 24);
  const interval = waveSpawnInterval(nightShiftState.wave);
  for (let i = 0; i < targetCount; i += 1) {
    queueNightShiftSpawn(i * interval);
  }
  nightShiftWaveTimer = setTimeout(advanceNightShiftWave, NIGHT_SHIFT_WAVE_MS);
}

function escapedTargetMessage(kind) {
  const plural = nightShiftState.hearts === 1 ? "" : "S";
  return `${String(kind).toUpperCase()} ESCAPED · ${nightShiftState.hearts} HEART${plural} LEFT`;
}

function missNightShiftTarget(target) {
  if (!target?.isConnected) return;
  if (target.dataset.hit || target.dataset.missed) return;
  clearNightShiftTargetTimer(target);
  target.dataset.missed = "1";
  target.remove();
  if (!["helicopter", "drone", "airplane"].includes(target.dataset.kind)) return;
  nightShiftState.misses += 1;
  nightShiftState.hearts = Math.max(0, nightShiftState.hearts - 1);
  renderNightShiftHud(escapedTargetMessage(target.dataset.kind));
  if (nightShiftState.hearts <= 0) endNightShift("SHIFT LOST · NO HEARTS LEFT");
}

function patrolRunRejected(response) {
  // Surface the rejection and keep the run submittable so the next
  // start-of-run reset (or a re-issued token) can retry it.
  nightShiftState.serverRunSubmitted = false;
  host.parlorNotice("NIGHT SHIFT", String(response?.error || "The parlor could not verify that patrol run."));
}

function applyRunBest(response) {
  const best = response?.best;
  if (best == null) return;
  nightShiftState.best = Math.max(nightShiftState.best, Number(best) || 0);
}

function applyCleanRunAchievements(response, score) {
  if (score <= 0) return;
  if (Number(response.misses) !== 0) return;
  host.unlockAchievement("clean-run");
}

function applyRunScoreAchievements(response) {
  const score = Number(response.score) || 0;
  if (score >= 10) host.unlockAchievement("patrol-rookie");
  if (score >= 50) host.unlockAchievement("patrol-regular");
  applyCleanRunAchievements(response, score);
  if (Number(response.aceRuns) >= 3) host.unlockAchievement("patrol-ace");
}

function applyNightShiftRunScore(response) {
  applyRunBest(response);
  if (response?.score == null) return;
  applyRunScoreAchievements(response);
}

function nightShiftRunAck(response) {
  if (response?.success === false) {
    patrolRunRejected(response);
    return;
  }
  applyNightShiftRunScore(response);
}

function submitNightShiftRun() {
  if (!nightShiftState.serverRunToken) return;
  if (nightShiftState.serverRunSubmitted) return;
  nightShiftState.serverRunSubmitted = true;
  host.emitServer("finish-patrol-run", {
    runToken: nightShiftState.serverRunToken,
    score: nightShiftState.score,
    misses: nightShiftState.misses,
  }, nightShiftRunAck);
}

function saveNightShiftBest() {
  try { localStorage.setItem(NIGHT_SHIFT_BEST_KEY, String(nightShiftState.best)); } catch { /* storage unavailable */ }
}

function endNightShiftGuestAchievements() {
  if (state.account?.account) return;
  if (nightShiftState.score >= 10) host.unlockAchievement("patrol-rookie");
  if (nightShiftState.score >= 50) host.unlockAchievement("patrol-regular");
  if (nightShiftState.score > 0 && nightShiftState.misses === 0) host.unlockAchievement("clean-run");
}

function endNightShift(message) {
  if (!nightShiftState.active) return;
  nightShiftState.active = false;
  clearNightShiftTimers();
  clearNightShiftTargets();
  nightShiftState.best = Math.max(nightShiftState.best, nightShiftState.score);
  endNightShiftGuestAchievements();
  submitNightShiftRun();
  saveNightShiftBest();
  renderNightShiftHud(`${message} · FINAL ${String(nightShiftState.score).padStart(4, "0")} · ESC TO EXIT`);
  pulseWaveBanner(message.includes("LOST") ? "SHIFT LOST" : "SHIFT CLEAR");
  nightShiftResultEndsAt = Date.now() + 2600;
  scheduleNightShiftResult();
}

function hitGuard(target) {
  if (!nightShiftState.active) return false;
  if (state.phase !== "home") return false;
  if (!target?.isConnected) return false;
  return !target.dataset.hit;
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

function hitPoints(kind, wave) {
  if (kind === "helicopter") return 100 + wave * 25;
  if (kind === "drone") return 75 + wave * 10;
  if (kind === "airplane") return 180 + wave * 20;
  return 50 + wave * 5;
}

function crashWreck(target, kind) {
  target.classList.add("is-popping");
  const direction = target.dataset.direction === "left" ? -1 : 1;
  const crashArt = target.querySelector("img");
  if (crashArt) crashArt.style.transform = crashTransform(kind, direction);
}

function hitNightShiftTarget(target, event) {
  if (!hitGuard(target)) return;
  // Measure the transformed, live position before clearing the flight class.
  // This mirrors Home's hit path and prevents effects from snapping back to
  // the left/right/top spawn edge.
  const rect = target.getBoundingClientRect();
  const atmosphere = $("#night-shift");
  const area = atmosphere?.getBoundingClientRect();
  if (!area) return;
  const point = hitPoint(rect, event, area);
  target.dataset.hit = "1";
  clearNightShiftTargetTimer(target);
  target.classList.remove("is-flight");
  const kind = target.dataset.kind || "helicopter";
  if (kind === "helicopter") {
    crashHelicopter(target, point.x, point.y);
  } else {
    crashWreck(target, kind);
    animateNonHelicopterCrash(target, point.x, point.y, kind);
  }
  const points = hitPoints(kind, nightShiftState.wave);
  nightShiftState.score += points;
  nightShiftState.best = Math.max(nightShiftState.best, nightShiftState.score);
  saveNightShiftBest();
  host.playPatrolHitSound();
  renderNightShiftHud(`TAGGED +${points} · WAVE ${String(nightShiftState.wave).padStart(2, "0")}`);
}

function resetNightShiftRun() {
  nightShiftState.active = true;
  nightShiftState.wave = 1;
  nightShiftState.score = 0;
  nightShiftState.hearts = NIGHT_SHIFT_START_HEARTS;
  nightShiftState.targetSeq = 0;
  nightShiftState.misses = 0;
  nightShiftState.serverRunToken = null;
  nightShiftState.serverRunSubmitted = false;
}

function nightShiftRunStartAck(response) {
  if (!response?.success) return;
  nightShiftState.serverRunToken = response.runToken;
  if (!nightShiftState.active) submitNightShiftRun();
}

function openNightShiftSurface() {
  document.body.classList.add("night-shift-open");
  const surface = $("#night-shift");
  surface?.classList.remove("is-hidden");
  surface?.setAttribute("aria-hidden", "false");
  hydrateSprites(surface || document);
  $("#night-exit")?.focus({ preventScroll: true });
}

export function startNightShift() {
  if (state.phase !== "home") return;
  if (nightShiftState.active) return;
  // A stale room session may still emit snapshots while the player is Home.
  // Keep this local arcade layer isolated until the player explicitly joins again.
  clearNightShiftTimers();
  nightShiftSuppressSnapshot = state.suppressRoomUpdates;
  state.suppressRoomUpdates = true;
  host.stopHomeHelicopter();
  host.stopHomeClock();
  resetNightShiftRun();
  if (state.account?.account) host.emitServer("start-patrol-run", {}, nightShiftRunStartAck);
  host.renderPatrolHud("NIGHT SHIFT ACTIVE · CLEAR THE SKYLINE");
  openNightShiftSurface();
  nightShiftTickTimer = setInterval(() => renderNightShiftHud(), 200);
  beginNightShiftWave();
}

export function stopNightShift() {
  clearNightShiftTimers();
  nightShiftPausedAt = 0;
  nightShiftState.active = false;
  state.suppressRoomUpdates = nightShiftSuppressSnapshot;
  clearNightShiftTargets();
  nightShiftResultEndsAt = 0;
  document.body.classList.remove("night-shift-open");
  document.body.classList.remove("night-shift-paused");
  $("#night-wave-banner")?.classList.remove("is-announcing");
  $("#night-shift")?.classList.add("is-hidden");
  $("#night-shift")?.setAttribute("aria-hidden", "true");
  renderNightShiftHud("TAG THE FLY-BYS BEFORE THEY REACH THE BORDER");
  if (state.phase !== "home") return;
  host.startHomeClock();
  host.renderPatrolHud();
  host.scheduleHomeHelicopter(4000);
}

function freezeSpawnTimers() {
  nightShiftSpawnTimers.forEach((entry) => {
    if (entry.timer === null) return;
    clearTimeout(entry.timer);
    entry.timer = null;
  });
}

function freezeTargetTimers() {
  nightShiftTargetTimers.forEach((timers) => {
    if (timers.miss === null) return;
    timers.missElapsed = Date.now() - timers.missStartedAt;
    clearTimeout(timers.miss);
    timers.miss = null;
  });
}

function freezeNightShiftRun() {
  // Freeze the run: cancel every armed cadence timer but keep the queue
  // entries and the wave deadline so play resumes from the exact pause.
  if (nightShiftWaveTimer !== null) {
    clearTimeout(nightShiftWaveTimer);
    nightShiftWaveTimer = null;
    nightShiftWaveHeld = true;
  }
  freezeSpawnTimers();
  document.body.classList.add("night-shift-paused");
  freezeTargetTimers();
}

function handleNightShiftHidden() {
  nightShiftPausedAt = Date.now();
  if (nightShiftState.active) {
    freezeNightShiftRun();
    return;
  }
  clearTimeout(nightShiftResultTimer);
  nightShiftResultTimer = null;
}

function resumeSpawnTimers(paused) {
  nightShiftSpawnTimers.forEach((entry) => {
    if (entry.timer !== null) return;
    entry.due += paused;
    armNightShiftSpawn(entry);
  });
}

function rearmTargetMiss(timers) {
  if (timers.miss !== null) return;
  const remaining = Math.max(250, timers.backstop - timers.missElapsed);
  timers.missStartedAt = Date.now();
  timers.missElapsed = 0;
  timers.miss = setTimeout(timers.settle, remaining);
}

function resumeTargetTimers() {
  nightShiftTargetTimers.forEach((timers) => {
    if (!timers.settle) return;
    if (timers.endedWhileHidden) {
      // The flight truly finished while we were away: settle it now, on
      // the player's terms, instead of after a full random backstop delay.
      timers.settle();
      return;
    }
    rearmTargetMiss(timers);
  });
}

function handleNightShiftVisible() {
  if (!nightShiftState.active) {
    // Result countdown parked while hidden — re-arm for its remaining time.
    if (nightShiftResultEndsAt) scheduleNightShiftResult();
    return;
  }
  if (!nightShiftPausedAt) return;
  const paused = Date.now() - nightShiftPausedAt;
  nightShiftPausedAt = 0;
  nightShiftState.endsAt += paused;
  // Resume with at most one pending step each, then the normal cadence.
  if (nightShiftWaveHeld) {
    nightShiftWaveHeld = false;
    nightShiftWaveTimer = setTimeout(advanceNightShiftWave, Math.max(0, nightShiftState.endsAt - Date.now()));
  }
  resumeSpawnTimers(paused);
  resumeTargetTimers();
  document.body.classList.remove("night-shift-paused");
  renderNightShiftHud("NIGHT SHIFT RESUMED · CLEAR THE SKYLINE");
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    handleNightShiftHidden();
    return;
  }
  handleNightShiftVisible();
});

