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
import { PARLOR_PATROL_ENABLED } from "./clientParlorPatrolFlag.js";

const NIGHT_SHIFT_WAVE_MS = 60000;
const NIGHT_SHIFT_START_HEARTS = 3;
const NIGHT_SHIFT_BEST_KEY = "poorup.night-shift.best.v1";
let nightShiftWaveTimer = null;
let nightShiftTickTimer = null;
let nightShiftStartTimer = null;
let nightShiftResultTimer = null;
let nightShiftResultEndsAt = 0;
let nightShiftSpawnTimers = [];
let nightShiftWaveHeld = false;
const nightShiftTargetTimers = new Map();
const nightShiftServerGates = new Map();
const nightShiftServerOffers = new Map();
const nightShiftGuestWaves = new Map();
let nightShiftGuestCleanWave = false;
let nightShiftPausedAt = 0;
const nightShiftState = { active: false, wave: 0, score: 0, best: 0, endsAt: 0, targetSeq: 0, hearts: NIGHT_SHIFT_START_HEARTS, misses: 0, serverRunToken: null, serverRunSubmitted: false, serverRunError: null };
let nightShiftSuppressSnapshot = false;
let nightShiftGeneration = 0;
let nightShiftVisibilityGeneration = 0;
let nightShiftServerRevision = 0;
let nightShiftServerRun = false;
let nightShiftClockOffset = null;
let nightShiftClockRtt = Infinity;
let nightShiftSettlement = null;
try { nightShiftState.best = Number(localStorage.getItem(NIGHT_SHIFT_BEST_KEY)) || 0; } catch { /* storage unavailable */ }

let host = {};

export function configureNightShift(hooks) {
  host = hooks;
}

export { nightShiftState, PARLOR_PATROL_ENABLED };

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

function clearServerOffers() {
  nightShiftServerOffers.forEach((offer) => { clearTimeout(offer.timer); clearTimeout(offer.watchdog); });
  nightShiftServerOffers.clear();
}

function clearServerGates() {
  nightShiftServerGates.forEach((timers) => { clearTimeout(timers.open); clearTimeout(timers.close); });
  nightShiftServerGates.clear();
}

function clearNightShiftTimers() {
  clearServerOffers();
  clearServerGates();
  clearTimeout(nightShiftWaveTimer);
  clearTimeout(nightShiftStartTimer);
  nightShiftStartTimer = null;
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

function armTargetTimers(timers) {
  timers.startedAt = Date.now();
  if (timers.revealRemaining !== null) {
    timers.reveal = setTimeout(() => {
      timers.revealRemaining = null;
      if (timers.target.isConnected && !timers.target.dataset.hit) timers.target.style.pointerEvents = "auto";
    }, timers.revealRemaining);
  }
  if (timers.disableRemaining !== null) {
    timers.disable = setTimeout(() => {
      timers.disableRemaining = null;
      if (timers.target.isConnected && !timers.target.dataset.hit) timers.target.style.pointerEvents = "none";
    }, timers.disableRemaining);
  }
  timers.miss = setTimeout(timers.settle, timers.missRemaining);
}

function scheduleNightShiftTarget(target, duration) {
  if (!target) return;
  const id = target.dataset.targetId;
  const timers = { target, reveal: null, disable: null, miss: null,
    revealRemaining: REDUCED_MOTION ? null : Math.round(duration * 0.16),
    disableRemaining: REDUCED_MOTION ? null : Math.round(duration * 0.94),
    missRemaining: duration + 80, startedAt: 0, endedWhileHidden: false };
  timers.settle = () => settleFlightTarget(timers, target, id);
  target.style.pointerEvents = REDUCED_MOTION ? "auto" : "none";
  if (!REDUCED_MOTION) target.addEventListener("animationend", (event) => {
    if (event.target === target && event.animationName.startsWith("night-target-")) timers.settle();
  });
  nightShiftTargetTimers.set(id, timers);
  armTargetTimers(timers);
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

function spawnNightShiftTarget(serverTarget = null, serverTime = 0) {
  if (!nightShiftState.active) return;
  if (state.phase !== "home") return;
  if (document.hidden) return; // frozen queue: the resume coordinator re-arms
  const layer = $("#night-targets");
  if (!layer) return;
  // Alternate lanes so a short play session always exercises both edges.
  const direction = serverTarget?.direction || (nightShiftState.targetSeq % 2 === 0 ? "left" : "right");
  const spawnNumber = nightShiftState.targetSeq;
  const kind = serverTarget?.kind || pickTargetKind(nightShiftState.wave, spawnNumber, Math.random());
  const lane = serverTarget?.lane ?? [18, 25, 32, 39, 46, 53, 60][Math.floor(Math.random() * 7)];
  const duration = serverTarget?.duration || pickTargetDuration(kind, nightShiftState.wave);
  const target = document.createElement("button");
  target.type = "button";
  const isDrop = kind === "beacon" || kind === "airplane";
  target.className = isDrop
    ? "night-target night-target-drop night-target-beacon is-flight"
    : `night-target night-target-${direction} night-target-${kind} is-flight`;
  configureTargetPlacement(target, kind, isDrop, lane);
  target.style.setProperty("--night-flight-duration", `${duration}ms`);
  target.style.setProperty("--night-stage-width", `${layer.clientWidth}px`);
  target.style.setProperty("--night-stage-height", `${layer.clientHeight}px`);
  if (serverTarget) target.style.animationDelay = "0ms";
  target.dataset.direction = direction;
  target.dataset.kind = kind;
  target.dataset.duration = String(duration);
  if (serverTarget) { target.dataset.actionable = "0"; target.style.pointerEvents = "none"; }
  target.dataset.wave = String(serverTarget?.wave || nightShiftState.wave);
  if (!serverTarget) {
    const outcome = nightShiftGuestWaves.get(nightShiftState.wave) || { pending: 0, missed: false };
    outcome.pending += 1;
    nightShiftGuestWaves.set(nightShiftState.wave, outcome);
  }
  target.dataset.targetId = serverTarget ? String(serverTarget.id) : String(++nightShiftState.targetSeq);
  target.setAttribute("aria-label", `Tag Night Shift ${kind}, wave ${nightShiftState.wave}`);
  paintTargetArt(target, kind, direction);
  // Pointer-down gives the arcade target immediate feedback before a moving
  // button can travel between pointer press and the browser's click release.
  target.addEventListener("pointerdown", (event) => hitNightShiftTarget(target, event));
  target.addEventListener("click", (event) => hitNightShiftTarget(target, event));
  layer.appendChild(target);
  if (serverTarget) syncServerTargetAnimation(target, serverTarget, serverTime);
  if (!serverTarget) scheduleNightShiftTarget(target, duration);
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
  closeGuestWaves();
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
  nightShiftState.endsAt = Date.now() + NIGHT_SHIFT_WAVE_MS;
  const nextWave = String(nightShiftState.wave).padStart(2, "0");
  renderNightShiftHud(`WAVE ${nextWave} · CLEAR THE SKYLINE`);
  pulseWaveBanner(`WAVE ${nextWave}`);
  const targetCount = Math.min(6 + nightShiftState.wave * 2, 24);
  const interval = waveSpawnInterval(nightShiftState.wave);
  for (let i = 0; i < targetCount; i += 1) {
    if (i * interval < NIGHT_SHIFT_WAVE_MS) queueNightShiftSpawn(i * interval);
  }
  nightShiftWaveTimer = setTimeout(advanceNightShiftWave, NIGHT_SHIFT_WAVE_MS);
}

function closeGuestWaves() {
  for (const [wave, outcome] of nightShiftGuestWaves) {
    if (wave >= nightShiftState.wave || outcome.pending > 0) continue;
    if (!outcome.missed) nightShiftGuestCleanWave = true;
    nightShiftGuestWaves.delete(wave);
  }
}

function resolveGuestTarget(target, missed) {
  const outcome = nightShiftGuestWaves.get(Number(target.dataset.wave));
  if (!outcome) return;
  outcome.pending -= 1;
  if (missed) outcome.missed = true;
  closeGuestWaves();
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
  resolveGuestTarget(target, true);
  target.remove();
  if (!["helicopter", "drone", "airplane"].includes(target.dataset.kind)) return;
  nightShiftState.misses += 1;
  nightShiftState.hearts = Math.max(0, nightShiftState.hearts - 1);
  renderNightShiftHud(escapedTargetMessage(target.dataset.kind));
  if (nightShiftState.hearts <= 0) endNightShift("SHIFT LOST · NO HEARTS LEFT");
}

function applyRunBest(response) {
  if (response?.best == null) return;
  nightShiftState.best = Math.max(0, Number(response.best) || 0);
}

function finishSettlement(settlement, response) {
  if (nightShiftSettlement !== settlement) return;
  clearTimeout(settlement.timer);
  nightShiftSettlement = null;
  if (!response?.success) {
    nightShiftState.serverRunError = String(response?.error || "Could not confirm that the score was saved.").slice(0, 120);
    host.parlorNotice("NIGHT SHIFT", nightShiftState.serverRunError);
    return;
  }
  if (settlement.account === state.account?.account) applyRunBest(response);
  if (settlement.left) host.parlorNotice("NIGHT SHIFT", "Your patrol score was saved.");
}

function beginSettlement() {
  if (nightShiftSettlement) return nightShiftSettlement;
  const settlement = { generation: nightShiftGeneration, account: state.account?.account, timer: null, sent: false, left: false };
  nightShiftSettlement = settlement;
  settlement.timer = setTimeout(() => {
    if (nightShiftSettlement !== settlement) return;
    nightShiftSettlement = null;
    nightShiftState.serverRunError = "Could not confirm that the patrol score was saved.";
    host.parlorNotice("NIGHT SHIFT", nightShiftState.serverRunError);
  }, 8000);
  return settlement;
}

function sendSettlement(settlement, token) {
  if (nightShiftSettlement !== settlement || settlement.sent || !token) return;
  settlement.sent = true;
  nightShiftState.serverRunSubmitted = true;
  clearTimeout(settlement.timer);
  let attempts = 0;
  const send = () => {
    if (nightShiftSettlement !== settlement) return;
    attempts += 1;
    const attempt = attempts;
    settlement.timer = setTimeout(() => {
      if (nightShiftSettlement !== settlement) return;
      if (attempts === 1) { send(); return; }
      finishSettlement(settlement, { success: false, error: "Could not confirm that the patrol score was saved." });
    }, 4000);
    host.emitServer("finish-patrol-run", { runToken: token }, (response) => {
      if (!response?.success && attempt === 1 && attempts > 1) return;
      if (!response?.success && attempts > 1) {
        finishSettlement(settlement, { success: false, error: "Could not confirm that the patrol score was saved." });
        return;
      }
      finishSettlement(settlement, response);
    });
  };
  send();
}

function submitNightShiftRun() {
  if (!nightShiftState.serverRunToken || nightShiftState.serverRunSubmitted) return;
  sendSettlement(beginSettlement(), nightShiftState.serverRunToken);
}

function saveNightShiftBest() {
  try { localStorage.setItem(NIGHT_SHIFT_BEST_KEY, String(nightShiftState.best)); } catch { /* storage unavailable */ }
}

function endNightShiftGuestAchievements(allowClean = true) {
  if (nightShiftServerRun || state.account?.account) return;
  if (nightShiftState.score >= 10) host.unlockAchievement("patrol-rookie");
  if (nightShiftState.score >= 50) host.unlockAchievement("patrol-regular");
  if (allowClean && nightShiftGuestCleanWave) host.unlockAchievement("clean-run");
}

function endNightShift(message) {
  if (!nightShiftState.active) return;
  nightShiftState.active = false;
  clearNightShiftTimers();
  clearNightShiftTargets();
  if (!nightShiftServerRun) {
    nightShiftState.best = Math.max(nightShiftState.best, nightShiftState.score);
    saveNightShiftBest();
  }
  endNightShiftGuestAchievements();
  submitNightShiftRun();
  renderNightShiftHud(`${message} · FINAL ${String(nightShiftState.score).padStart(4, "0")} · ESC TO EXIT`);
  pulseWaveBanner(message.includes("LOST") ? "SHIFT LOST" : "SHIFT CLEAR");
  nightShiftResultEndsAt = Date.now() + 2600;
  scheduleNightShiftResult();
}

function hitGuard(target) {
  if (nightShiftServerRun && (document.hidden || target?.dataset.actionable !== "1")) return false;
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

function hitNightShiftTarget(target, event) {
  if (!hitGuard(target)) return;
  // Measure the transformed, live position before clearing the flight class.
  // This mirrors Home's hit path and prevents effects from snapping back to
  // the left/right/top spawn edge.
  if (nightShiftServerRun) {
    if (target.dataset.pending) return;
    target.dataset.pending = "1";
    const generation = nightShiftGeneration;
    const sentAt = Date.now();
    host.emitServer("hit-patrol-target", { runToken: nightShiftState.serverRunToken, targetId: target.dataset.targetId }, (response) => {
      if (generation !== nightShiftGeneration) return;
      if (!response?.success) { delete target.dataset.pending; return; }
      const offer = nightShiftServerOffers.get(target.dataset.targetId);
      if (offer) { clearTimeout(offer.timer); clearTimeout(offer.watchdog); nightShiftServerOffers.delete(target.dataset.targetId); }
      observePatrolClock(response, sentAt);
      if (target.isConnected) {
        const rect = target.getBoundingClientRect();
        const area = $("#night-shift")?.getBoundingClientRect();
        if (area) {
          const point = hitPoint(rect, event, area);
          target.dataset.hit = "1";
          if (target.dataset.kind !== "helicopter") pinCrashPosition(target, rect);
          target.classList.remove("is-flight");
          if (target.dataset.kind === "helicopter") crashHelicopter(target, point.x, point.y);
          else { crashWreck(target, target.dataset.kind); animateNonHelicopterCrash(target, point.x, point.y, target.dataset.kind); }
          host.playPatrolHitSound();
        }
      }
      applyPatrolState(response);
    });
    return;
  }
  const rect = target.getBoundingClientRect();
  const atmosphere = $("#night-shift");
  const area = atmosphere?.getBoundingClientRect();
  if (!area) return;
  const point = hitPoint(rect, event, area);
  target.dataset.hit = "1";
  resolveGuestTarget(target, false);
  if (target.dataset.kind !== "helicopter") pinCrashPosition(target, rect);
  clearNightShiftTargetTimer(target);
  target.classList.remove("is-flight");
  const kind = target.dataset.kind || "helicopter";
  if (kind === "helicopter") {
    crashHelicopter(target, point.x, point.y);
  } else {
    crashWreck(target, kind);
    animateNonHelicopterCrash(target, point.x, point.y, kind);
  }
  const points = hitPoints(kind, Number(target.dataset.wave) || nightShiftState.wave);
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
  nightShiftState.serverRunError = null;
  nightShiftGuestWaves.clear();
  nightShiftGuestCleanWave = false;
  nightShiftServerRevision = 0;
  nightShiftClockOffset = null;
  nightShiftClockRtt = Infinity;
  nightShiftServerRun = Boolean(state.account?.account);
  if (nightShiftServerRun) {
    nightShiftState.best = Math.max(0, Number(state.account.account.stats?.patrolVerifiedBest) || 0);
  } else {
    try { nightShiftState.best = Number(localStorage.getItem(NIGHT_SHIFT_BEST_KEY)) || 0; } catch { nightShiftState.best = 0; }
  }
}

function observePatrolClock(response, sentAt) {
  if (!Number.isFinite(response?.serverTime)) return;
  const receivedAt = Date.now();
  const rtt = Math.max(0, receivedAt - sentAt);
  if (rtt > nightShiftClockRtt) return;
  nightShiftClockRtt = rtt;
  nightShiftClockOffset = response.serverTime - (sentAt + receivedAt) / 2;
}

function estimatedPatrolTime(response) {
  if (response.paused || nightShiftClockOffset === null) return response.serverTime;
  return Math.max(response.serverTime, Date.now() + nightShiftClockOffset);
}

function syncServerTargetAnimation(element, target, serverNow) {
  if (REDUCED_MOTION || target.deliveryPending) return;
  const animation = element.getAnimations?.().find((entry) => entry.animationName?.startsWith("night-target-"));
  if (animation) animation.currentTime = Math.max(0, serverNow - target.spawnedAt);
}

function freezeServerOffers() {
  nightShiftServerOffers.forEach((offer) => {
    if (offer.timer !== null) {
      offer.remaining = Math.max(0, offer.remaining - (Date.now() - offer.startedAt));
      clearTimeout(offer.timer);
      offer.timer = null;
    }
    if (offer.watchdog !== null) {
      offer.watchdogBudget = Math.max(0, offer.watchdogBudget - (Date.now() - offer.watchdogStartedAt));
      clearTimeout(offer.watchdog);
      offer.watchdog = null;
    }
  });
}

function armServerOffer(element, target, paused) {
  const id = String(target.id);
  let offer = nightShiftServerOffers.get(id);
  if (!offer) {
    offer = { timer: null, watchdog: null, remaining: Math.round(target.duration * 0.16), startedAt: 0,
      watchdogBudget: Math.floor(target.duration * 0.8), watchdogStartedAt: 0, readySent: false, attempts: 0 };
    nightShiftServerOffers.set(id, offer);
  }
  if (paused || document.hidden || offer.timer !== null || offer.watchdog !== null) return;
  if (offer.readySent) {
    sendServerTargetReady(element, id, offer);
    return;
  }
  element.dataset.actionable = "0";
  element.style.pointerEvents = "none";
  offer.startedAt = Date.now();
  offer.timer = setTimeout(() => {
    offer.timer = null;
    const late = Math.max(0, Date.now() - offer.startedAt - offer.remaining);
    offer.watchdogBudget = Math.max(0, offer.watchdogBudget - late);
    offer.remaining = 0;
    if (document.hidden || !nightShiftState.active) return;
    sendServerTargetReady(element, id, offer);
  }, offer.remaining);
}

function sendServerTargetReady(element, id, offer) {
  if (!nightShiftState.active || document.hidden || !element.isConnected) return;
  offer.readySent = true;
  offer.attempts += 1;
  const generation = nightShiftGeneration;
  const visibilityGeneration = nightShiftVisibilityGeneration;
  const sentAt = Date.now();
  // Socket.IO preserves event order, so the ready message precedes any hit.
  // Spend at most 80% of the flight after readiness, excluding hidden time.
  offer.watchdogStartedAt = Date.now();
  const watchdogDelay = Math.max(1, offer.attempts < 2
    ? Math.min(Math.floor(Number(element.dataset.duration) * 0.4), offer.watchdogBudget)
    : offer.watchdogBudget);
  offer.watchdog = setTimeout(() => {
    offer.watchdogBudget = Math.max(0, offer.watchdogBudget - (Date.now() - offer.watchdogStartedAt));
    offer.watchdog = null;
    if (nightShiftServerOffers.get(id) !== offer || !nightShiftState.active || document.hidden) return;
    if (offer.attempts < 2 && offer.watchdogBudget > 0) { sendServerTargetReady(element, id, offer); return; }
    endNightShift("NETWORK INTERRUPTION · SAVING SCORE");
  }, watchdogDelay);
  host.emitServer("ready-patrol-target", { runToken: nightShiftState.serverRunToken, targetId: id }, (response) => {
    if (generation !== nightShiftGeneration || !nightShiftState.active || nightShiftServerOffers.get(id) !== offer) return;
    if (!response?.success) {
      if (document.hidden || element.dataset.hit || element.dataset.pending) return;
      endNightShift("NETWORK INTERRUPTION · SAVING SCORE");
      return;
    }
    observePatrolClock(response, sentAt);
    applyPatrolState(response);
  });
  if (generation === nightShiftGeneration && visibilityGeneration === nightShiftVisibilityGeneration && !document.hidden && nightShiftState.active && element.isConnected && nightShiftServerOffers.get(id) === offer) {
    element.dataset.actionable = "1";
    element.style.pointerEvents = "auto";
  }
}

function setServerTargetGate(element, target, serverTime, paused) {
  const id = String(target.id);
  const old = nightShiftServerGates.get(id);
  if (old) { clearTimeout(old.open); clearTimeout(old.close); }
  const timers = { open: null, close: null };
  nightShiftServerGates.set(id, timers);
  element.dataset.actionable = "0";
  element.style.pointerEvents = "none";
  if (paused || document.hidden || !Number.isFinite(target.actionableAt) || !Number.isFinite(target.expiresAt)) return;
  const untilOpen = target.actionableAt - serverTime;
  const untilClose = target.expiresAt - serverTime;
  if (untilClose <= 0) return;
  const open = () => {
    if (!element.isConnected || element.dataset.hit || document.hidden) return;
    element.dataset.actionable = "1";
    element.style.pointerEvents = "auto";
  };
  if (untilOpen <= 0) open();
  else timers.open = setTimeout(open, untilOpen);
  timers.close = setTimeout(() => {
    element.dataset.actionable = "0";
    element.style.pointerEvents = "none";
    if (!element.dataset.hit) element.remove();
    nightShiftServerGates.delete(id);
  }, untilClose);
}

export function applyPatrolState(response) {
  if (!nightShiftState.active || !nightShiftServerRun || response?.runToken !== nightShiftState.serverRunToken) return;
  if (!Number.isFinite(response.revision) || response.revision <= nightShiftServerRevision) return;
  nightShiftServerRevision = response.revision;
  const serverNow = estimatedPatrolTime(response);
  nightShiftState.wave = response.wave;
  nightShiftState.score = response.score;
  nightShiftState.hearts = response.hearts;
  nightShiftState.misses = response.misses;
  nightShiftState.endsAt = Date.now() + Math.max(0, response.endsAt - serverNow);
  const layer = $("#night-targets");
  const targets = Array.isArray(response.targets)
    ? response.targets.filter((target) => target.deliveryPending || (Number.isFinite(target.expiresAt) && target.expiresAt > serverNow))
    : [];
  const ids = new Set(targets.map((target) => String(target.id)));
  layer?.querySelectorAll(".night-target:not([data-hit])").forEach((element) => {
    if (!ids.has(element.dataset.targetId)) {
      const timers = nightShiftServerGates.get(element.dataset.targetId);
      if (timers) { clearTimeout(timers.open); clearTimeout(timers.close); nightShiftServerGates.delete(element.dataset.targetId); }
      const offer = nightShiftServerOffers.get(element.dataset.targetId);
      if (offer) { clearTimeout(offer.timer); clearTimeout(offer.watchdog); nightShiftServerOffers.delete(element.dataset.targetId); }
      element.remove();
    }
  });
  for (const target of targets) {
    if (!layer?.querySelectorAll) break;
    let element = [...layer.querySelectorAll(".night-target")].find((el) => el.dataset.targetId === String(target.id));
    if (!element) {
      spawnNightShiftTarget(target, serverNow);
      element = [...layer.querySelectorAll(".night-target")].find((el) => el.dataset.targetId === String(target.id));
    }
    if (element && !element.dataset.hit) {
      if (target.deliveryPending) {
        armServerOffer(element, target, response.paused);
      } else {
        const offer = nightShiftServerOffers.get(String(target.id));
        if (offer) { clearTimeout(offer.timer); clearTimeout(offer.watchdog); nightShiftServerOffers.delete(String(target.id)); }
        syncServerTargetAnimation(element, target, serverNow);
        setServerTargetGate(element, target, serverNow, response.paused);
      }
    }
  }
  renderNightShiftHud(response.paused ? "NIGHT SHIFT PAUSED" : "TAG THE FLY-BYS BEFORE THEY REACH THE BORDER");
  if (response.ended) endNightShift(response.endReason === "delivery-timeout" ? "NETWORK INTERRUPTION · SAVING SCORE" : "SHIFT LOST · NO HEARTS LEFT");
}

function nightShiftRunStartAck(response) {
  if (!response?.success || !response.runToken) {
    nightShiftState.serverRunError = String(response?.error || "Score sync unavailable.").slice(0, 120);
    endNightShift("SCORE SYNC UNAVAILABLE");
    return;
  }
  nightShiftState.serverRunError = null;
  nightShiftState.serverRunToken = response.runToken;
  applyPatrolState(response);
  if (!nightShiftState.active) return;
  if (document.hidden || response.paused) {
    document.body.classList.add("night-shift-paused");
    if (document.hidden && !response.paused) sendPatrolVisibility("pause-patrol-run");
    else if (!document.hidden && response.paused) sendPatrolVisibility("resume-patrol-run");
  } else {
    document.body.classList.remove("night-shift-paused");
  }
}

export function handlePatrolDisconnect() {
  if (nightShiftSettlement) {
    finishSettlement(nightShiftSettlement, { success: false, error: "Connection lost. The patrol score could not be confirmed." });
  }
  if (!nightShiftState.active || !nightShiftServerRun) return;
  nightShiftGeneration += 1;
  nightShiftState.serverRunToken = null;
  nightShiftState.serverRunError = "Connection lost. This score was not saved.";
  endNightShift("CONNECTION LOST · SCORE NOT SAVED");
}

function sendPatrolVisibility(event, visibilityGeneration = nightShiftVisibilityGeneration, retry = 0) {
  if (!nightShiftState.serverRunToken) return;
  const generation = nightShiftGeneration;
  const sentAt = Date.now();
  host.emitServer(event, { runToken: nightShiftState.serverRunToken }, (response) => {
    if (generation !== nightShiftGeneration || !nightShiftState.active || visibilityGeneration !== nightShiftVisibilityGeneration) return;
    if (!response?.success) {
      const error = String(response?.error || "Score sync unavailable.").slice(0, 120);
      nightShiftState.serverRunError = error;
      nightShiftState.serverRunToken = null;
      host.parlorNotice("NIGHT SHIFT", error);
      endNightShift(/expired/i.test(error) ? "PAUSED RUN EXPIRED · SCORE NOT SAVED" : "SCORE SYNC UNAVAILABLE · SCORE NOT SAVED");
      return;
    }
    observePatrolClock(response, sentAt);
    applyPatrolState(response);
    if (!nightShiftState.active) return;
    if (Boolean(response.paused) !== document.hidden) {
      if (retry === 0) sendPatrolVisibility(document.hidden ? "pause-patrol-run" : "resume-patrol-run", visibilityGeneration, 1);
      else {
        nightShiftState.serverRunError = "Could not synchronize patrol visibility.";
        nightShiftState.serverRunToken = null;
        host.parlorNotice("NIGHT SHIFT", nightShiftState.serverRunError);
        endNightShift("SCORE SYNC UNAVAILABLE · SCORE NOT SAVED");
      }
      return;
    }
    if (document.hidden) document.body.classList.add("night-shift-paused");
    else document.body.classList.remove("night-shift-paused");
  });
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
  if (!PARLOR_PATROL_ENABLED) return;
  if (state.phase !== "home") return;
  if (nightShiftState.active) return;
  if (nightShiftSettlement) { host.parlorNotice("NIGHT SHIFT", "Finishing your previous patrol. Please wait."); return; }
  // A stale room session may still emit snapshots while the player is Home.
  // Keep this local arcade layer isolated until the player explicitly joins again.
  clearNightShiftTimers();
  nightShiftSuppressSnapshot = state.suppressRoomUpdates;
  state.suppressRoomUpdates = true;
  host.stopHomeHelicopter();
  host.stopHomeClock();
  resetNightShiftRun();
  const generation = ++nightShiftGeneration;
  host.renderPatrolHud("NIGHT SHIFT ACTIVE · CLEAR THE SKYLINE");
  openNightShiftSurface();
  if (state.account?.account) {
    const sentAt = Date.now();
    nightShiftStartTimer = setTimeout(() => {
      if (generation !== nightShiftGeneration || !nightShiftState.active) return;
      nightShiftGeneration += 1;
      nightShiftState.serverRunError = "Could not confirm that the patrol started.";
      endNightShift("SCORE SYNC UNAVAILABLE · SCORE NOT SAVED");
    }, 8000);
    host.emitServer("start-patrol-run", {}, (response) => {
      if (generation !== nightShiftGeneration) {
        const pending = nightShiftSettlement;
        if (pending?.generation === generation && !pending.sent) {
          if (response?.success && response.runToken) sendSettlement(pending, response.runToken);
          else finishSettlement(pending, { success: false, error: response?.error || "Could not start or save the patrol." });
        } else if (response?.success && response.runToken) {
          // The start acknowledgement arrived after the exit timeout. Release
          // the old token without touching any newer run's local state.
          host.emitServer("finish-patrol-run", { runToken: response.runToken }, () => {});
        }
        return;
      }
      clearTimeout(nightShiftStartTimer);
      nightShiftStartTimer = null;
      observePatrolClock(response, sentAt);
      nightShiftRunStartAck(response);
    });
  }
  if (!nightShiftState.active) return;
  nightShiftTickTimer = setInterval(() => renderNightShiftHud(), 200);
  if (!nightShiftServerRun) beginNightShiftWave();
}

export function stopNightShift() {
  if (nightShiftState.active && !nightShiftServerRun) endNightShiftGuestAchievements(false);
  if (nightShiftState.active && nightShiftServerRun) {
    const settlement = beginSettlement();
    settlement.left = true;
    sendSettlement(settlement, nightShiftState.serverRunToken);
  }
  nightShiftGeneration += 1;
  nightShiftVisibilityGeneration += 1;
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
    const elapsed = Math.max(0, Date.now() - timers.startedAt);
    if (timers.revealRemaining !== null) timers.revealRemaining = Math.max(0, timers.revealRemaining - elapsed);
    if (timers.disableRemaining !== null) timers.disableRemaining = Math.max(0, timers.disableRemaining - elapsed);
    timers.missRemaining = Math.max(0, timers.missRemaining - elapsed);
    clearTimeout(timers.reveal);
    clearTimeout(timers.disable);
    clearTimeout(timers.miss);
    timers.reveal = timers.disable = timers.miss = null;
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
  nightShiftVisibilityGeneration += 1;
  nightShiftPausedAt = Date.now();
  if (nightShiftState.active && nightShiftServerRun) {
    document.body.classList.add("night-shift-paused");
    clearServerGates();
    freezeServerOffers();
    $("#night-targets")?.querySelectorAll(".night-target").forEach((target) => { target.dataset.actionable = "0"; target.style.pointerEvents = "none"; });
    sendPatrolVisibility("pause-patrol-run");
    return;
  }
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

function resumeTargetTimers() {
  nightShiftTargetTimers.forEach((timers) => {
    if (timers.endedWhileHidden) { timers.settle(); return; }
    if (timers.miss === null) armTargetTimers(timers);
  });
}

function handleNightShiftVisible() {
  nightShiftVisibilityGeneration += 1;
  if (nightShiftState.active && nightShiftServerRun) {
    if (!nightShiftState.serverRunToken) document.body.classList.remove("night-shift-paused");
    else sendPatrolVisibility("resume-patrol-run");
    return;
  }
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

