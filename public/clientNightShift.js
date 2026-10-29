// NIGHT SHIFT: the Ctrl/Shift+P arcade mini-game on Home.
// Owns the wave timers, spawn queue, hit and miss resolution, the background-tab
// freeze and resume coordinator, and the run lifecycle. Shared state lives in
// clientNightShiftState.js; score sync, effects and settlement live in their own modules.
import { NIGHT_SHIFT_BEST_KEY, NIGHT_SHIFT_START_HEARTS, NIGHT_SHIFT_WAVE_MS, nightRun, nightShiftGuestWaves, nightShiftServerGates, nightShiftServerOffers, nightShiftState, nightShiftTargetTimers } from "./clientNightShiftState.js";
import { hitPoints, measureHit, playTargetCrash, resetNightHomeEffects } from "./clientNightShiftEffects.js";
import { beginSettlement, holdIfSettlementPending, requestServerRunStart, sendSettlement, submitNightShiftRun } from "./clientNightShiftSettlement.js";
import { freezeServerOffers, hitServerTarget, sendPatrolVisibility, syncServerTargetAnimation } from "./clientNightShiftServer.js";
import { $, REDUCED_MOTION } from "./clientDom.js";
import { state } from "./clientState.js";
import { hydrateSprites } from "./clientSprites.js";
import { PARLOR_PATROL_ENABLED } from "./clientParlorPatrolFlag.js";
import { PATROL_ART, configureTargetPlacement, paintTargetArt, pickTargetDuration, pickTargetKind, pulseWaveBanner, targetClassName, waveSpawnInterval } from "./clientNightShiftArt.js";
export { hasPendingPatrolSettlement } from "./clientNightShiftSettlement.js";
export { handlePatrolReconnect } from "./clientNightShiftSettlement.js";
export { applyPatrolState } from "./clientNightShiftServer.js";
export { handlePatrolDisconnect } from "./clientNightShiftServer.js";

export function configureNightShift(hooks) {
  nightRun.host = hooks;
}

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
  const cell = (i) => `<img class="night-heart${i >= nightShiftState.hearts ? " is-empty" : ""}" src="${PATROL_ART}heart.svg" alt="">`;
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
  clearTimeout(nightRun.nightShiftWaveTimer);
  clearTimeout(nightRun.nightShiftStartTimer);
  nightRun.nightShiftStartTimer = null;
  clearInterval(nightRun.nightShiftTickTimer);
  clearTimeout(nightRun.nightShiftResultTimer);
  nightRun.nightShiftWaveTimer = null;
  nightRun.nightShiftTickTimer = null;
  nightRun.nightShiftResultTimer = null;
  nightRun.nightShiftSpawnTimers.forEach((entry) => clearTimeout(entry.timer));
  nightRun.nightShiftSpawnTimers = [];
  nightRun.nightShiftWaveHeld = false;
  clearTargetTimerEntries();
}

function stopNightShiftAtResultEnd() {
  nightRun.nightShiftResultTimer = null;
  nightRun.nightShiftResultEndsAt = 0;
  stopNightShift();
}

function scheduleNightShiftResult() {
  clearTimeout(nightRun.nightShiftResultTimer);
  nightRun.nightShiftResultTimer = null;
  if (!nightRun.nightShiftResultEndsAt) return;
  const remaining = nightRun.nightShiftResultEndsAt - Date.now();
  if (remaining <= 0) {
    nightRun.nightShiftResultEndsAt = 0;
    stopNightShift();
    return;
  }
  if (document.hidden) return;
  nightRun.nightShiftResultTimer = setTimeout(stopNightShiftAtResultEnd, remaining);
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

function settleHiddenTarget(timers) {
  // The tab froze mid-flight: remember that this animation finished
  // while the tab was away and let the resume coordinator settle it
  // immediately, never silently dropping the event.
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

function setLiveTargetPointer(target, pointerEvents) {
  if (target.isConnected && !target.dataset.hit) target.style.pointerEvents = pointerEvents;
}

function armTargetTimers(timers) {
  timers.startedAt = Date.now();
  if (timers.revealRemaining !== null) {
    timers.reveal = setTimeout(() => {
      timers.revealRemaining = null;
      setLiveTargetPointer(timers.target, "auto");
    }, timers.revealRemaining);
  }
  if (timers.disableRemaining !== null) {
    timers.disable = setTimeout(() => {
      timers.disableRemaining = null;
      setLiveTargetPointer(timers.target, "none");
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

function targetDirection(serverTarget) {
  // Alternate lanes so a short play session always exercises both edges.
  return serverTarget?.direction || (nightShiftState.targetSeq % 2 === 0 ? "left" : "right");
}

function markGuestTargetPending(wave) {
  const outcome = nightShiftGuestWaves.get(wave) || { pending: 0, missed: false };
  outcome.pending += 1;
  nightShiftGuestWaves.set(wave, outcome);
}

function sizeTargetForLayer(target, layer, duration) {
  target.style.setProperty("--night-flight-duration", `${duration}ms`);
  target.style.setProperty("--night-stage-width", `${layer.clientWidth}px`);
  target.style.setProperty("--night-stage-height", `${layer.clientHeight}px`);
}

// Server-authored targets stay inert until the server offer makes them actionable.
function applyServerTargetState(target, serverTarget) {
  if (!serverTarget) return;
  target.style.animationDelay = "0ms";
  target.dataset.actionable = "0";
  target.style.pointerEvents = "none";
}

function describeSpawnedTarget(target, serverTarget, kind, direction, duration) {
  target.dataset.direction = direction;
  target.dataset.kind = kind;
  target.dataset.duration = String(duration);
  target.dataset.wave = String(serverTarget?.wave || nightShiftState.wave);
  target.dataset.targetId = serverTarget ? String(serverTarget.id) : String(++nightShiftState.targetSeq);
  target.setAttribute("aria-label", `Tag Night Shift ${kind}, wave ${nightShiftState.wave}`);
}

function wireNightShiftTarget(target) {
  // Pointer-down gives the arcade target immediate feedback before a moving
  // button can travel between pointer press and the browser's click release.
  target.addEventListener("pointerdown", (event) => hitNightShiftTarget(target, event));
  target.addEventListener("click", (event) => hitNightShiftTarget(target, event));
}

// Null while the run is not spawning: inactive, not on Home, or the tab is hidden
// (the frozen queue is re-armed by the resume coordinator).
function spawnableTargetLayer() {
  if (!nightShiftState.active || state.phase !== "home" || document.hidden) return null;
  return $("#night-targets");
}

export function spawnNightShiftTarget(serverTarget = null, serverTime = 0) {
  const layer = spawnableTargetLayer();
  if (!layer) return;
  const direction = targetDirection(serverTarget);
  const spawnNumber = nightShiftState.targetSeq;
  const kind = serverTarget?.kind || pickTargetKind(nightShiftState.wave, spawnNumber, Math.random());
  const lane = serverTarget?.lane ?? [18, 25, 32, 39, 46, 53, 60][Math.floor(Math.random() * 7)];
  const duration = serverTarget?.duration || pickTargetDuration(kind, nightShiftState.wave);
  const target = document.createElement("button");
  target.type = "button";
  const isDrop = kind === "beacon" || kind === "airplane";
  target.className = targetClassName(kind, direction, isDrop);
  configureTargetPlacement(target, kind, isDrop, lane);
  sizeTargetForLayer(target, layer, duration);
  applyServerTargetState(target, serverTarget);
  describeSpawnedTarget(target, serverTarget, kind, direction, duration);
  if (!serverTarget) markGuestTargetPending(nightShiftState.wave);
  paintTargetArt(target, kind, direction);
  wireNightShiftTarget(target);
  layer.appendChild(target);
  if (serverTarget) syncServerTargetAnimation(target, serverTarget, serverTime);
  else scheduleNightShiftTarget(target, duration);
}

// Spawn timers live as { due, timer } queue entries: hiding the tab freezes
// them in place and the visibilitychange coordinator re-arms each pending
// entry exactly once, so the staggered wave cadence survives a background tab.
function armNightShiftSpawn(entry) {
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (document.hidden) return;
    const index = nightRun.nightShiftSpawnTimers.indexOf(entry);
    if (index !== -1) nightRun.nightShiftSpawnTimers.splice(index, 1);
    spawnNightShiftTarget();
  }, Math.max(0, entry.due - Date.now()));
}

function queueNightShiftSpawn(delay) {
  const entry = { due: Date.now() + delay, timer: null };
  nightRun.nightShiftSpawnTimers.push(entry);
  armNightShiftSpawn(entry);
}

function holdNightShiftWave() {
  // Do not advance waves while hidden; resume re-arms from endsAt.
  nightRun.nightShiftWaveHeld = true;
}

function advanceNightShiftWave() {
  nightRun.nightShiftWaveTimer = null;
  if (!nightShiftState.active) return;
  if (document.hidden) {
    holdNightShiftWave();
    return;
  }
  nightShiftState.wave += 1;
  closeGuestWaves();
  beginNightShiftWave();
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
  nightRun.nightShiftWaveTimer = setTimeout(advanceNightShiftWave, NIGHT_SHIFT_WAVE_MS);
}

function closeGuestWaves() {
  for (const [wave, outcome] of nightShiftGuestWaves) {
    if (wave >= nightShiftState.wave || outcome.pending > 0) continue;
    if (!outcome.missed) nightRun.nightShiftGuestCleanWave = true;
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

function saveNightShiftBest() {
  try { localStorage.setItem(NIGHT_SHIFT_BEST_KEY, String(nightShiftState.best)); } catch { /* storage unavailable */ }
}

function endNightShiftGuestAchievements(allowClean = true) {
  if (nightRun.nightShiftServerRun || state.account?.account) return;
  if (nightShiftState.score >= 10) nightRun.host.unlockAchievement("patrol-rookie");
  if (nightShiftState.score >= 50) nightRun.host.unlockAchievement("patrol-regular");
  if (allowClean && nightRun.nightShiftGuestCleanWave) nightRun.host.unlockAchievement("clean-run");
}

export function endNightShift(message) {
  if (!nightShiftState.active) return;
  nightShiftState.active = false;
  clearNightShiftTimers();
  clearNightShiftTargets();
  if (!nightRun.nightShiftServerRun) {
    nightShiftState.best = Math.max(nightShiftState.best, nightShiftState.score);
    saveNightShiftBest();
  }
  endNightShiftGuestAchievements();
  submitNightShiftRun();
  renderNightShiftHud(`${message} · FINAL ${String(nightShiftState.score).padStart(4, "0")} · ESC TO EXIT`);
  pulseWaveBanner(message.includes("LOST") ? "SHIFT LOST" : "SHIFT CLEAR");
  nightRun.nightShiftResultEndsAt = Date.now() + 2600;
  scheduleNightShiftResult();
}

function hitGuard(target) {
  if (nightRun.nightShiftServerRun && (document.hidden || target?.dataset.actionable !== "1")) return false;
  if (!nightShiftState.active) return false;
  if (state.phase !== "home") return false;
  if (!target?.isConnected) return false;
  return !target.dataset.hit;
}

export function confirmServerHit(target, event) {
  const hit = measureHit(target, event);
  if (!hit) return;
  target.dataset.hit = "1";
  playTargetCrash(target, hit);
  nightRun.host.playPatrolHitSound();
}

function hitGuestTarget(target, event) {
  const hit = measureHit(target, event);
  if (!hit) return;
  target.dataset.hit = "1";
  resolveGuestTarget(target, false);
  clearNightShiftTargetTimer(target);
  playTargetCrash(target, hit);
  const kind = target.dataset.kind || "helicopter";
  const points = hitPoints(kind, Number(target.dataset.wave) || nightShiftState.wave);
  nightShiftState.score += points;
  nightShiftState.best = Math.max(nightShiftState.best, nightShiftState.score);
  saveNightShiftBest();
  nightRun.host.playPatrolHitSound();
  renderNightShiftHud(`TAGGED +${points} · WAVE ${String(nightShiftState.wave).padStart(2, "0")}`);
}

function hitNightShiftTarget(target, event) {
  if (!hitGuard(target)) return;
  // Measure the transformed, live position before clearing the flight class.
  // This mirrors Home's hit path and prevents effects from snapping back to
  // the left/right/top spawn edge.
  if (nightRun.nightShiftServerRun) hitServerTarget(target, event);
  else hitGuestTarget(target, event);
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
  nightRun.nightShiftGuestCleanWave = false;
  nightRun.nightShiftServerRevision = 0;
  nightRun.nightShiftClockOffset = null;
  nightRun.nightShiftClockRtt = Infinity;
  nightRun.nightShiftServerRun = Boolean(state.account?.account);
  if (nightRun.nightShiftServerRun) {
    nightShiftState.best = Math.max(0, Number(state.account.account.stats?.patrolVerifiedBest) || 0);
  } else {
    try { nightShiftState.best = Number(localStorage.getItem(NIGHT_SHIFT_BEST_KEY)) || 0; } catch { nightShiftState.best = 0; }
  }
}

function openNightShiftSurface() {
  document.body.classList.add("night-shift-open");
  const surface = $("#night-shift");
  surface?.classList.remove("is-hidden");
  surface?.setAttribute("aria-hidden", "false");
  hydrateSprites(surface || document);
  $("#night-exit")?.focus({ preventScroll: true });
}

function beginNightShiftRun() {
  // A stale room session may still emit snapshots while the player is Home.
  // Keep this local arcade layer isolated until the player explicitly joins again.
  clearNightShiftTimers();
  nightRun.nightShiftSuppressSnapshot = state.suppressRoomUpdates;
  state.suppressRoomUpdates = true;
  nightRun.host.stopHomeHelicopter();
  nightRun.host.stopHomeClock();
  resetNightShiftRun();
  const generation = ++nightRun.nightShiftGeneration;
  nightRun.host.renderPatrolHud("NIGHT SHIFT ACTIVE · CLEAR THE SKYLINE");
  openNightShiftSurface();
  if (state.account?.account) requestServerRunStart(generation);
  if (!nightShiftState.active) return;
  nightRun.nightShiftTickTimer = setInterval(() => renderNightShiftHud(), 200);
  if (!nightRun.nightShiftServerRun) beginNightShiftWave();
}

export function startNightShift() {
  if (!PARLOR_PATROL_ENABLED) return;
  if (state.phase !== "home") return;
  if (nightShiftState.active) return;
  if (holdIfSettlementPending()) return;
  beginNightShiftRun();
}

export function stopNightShift() {
  if (nightShiftState.active && !nightRun.nightShiftServerRun) endNightShiftGuestAchievements(false);
  if (nightShiftState.active && nightRun.nightShiftServerRun) {
    const settlement = beginSettlement();
    settlement.left = true;
    sendSettlement(settlement, nightShiftState.serverRunToken);
  }
  nightRun.nightShiftGeneration += 1;
  nightRun.nightShiftVisibilityGeneration += 1;
  clearNightShiftTimers();
  nightRun.nightShiftPausedAt = 0;
  nightShiftState.active = false;
  state.suppressRoomUpdates = nightRun.nightShiftSuppressSnapshot;
  clearNightShiftTargets();
  nightRun.nightShiftResultEndsAt = 0;
  document.body.classList.remove("night-shift-open");
  document.body.classList.remove("night-shift-paused");
  $("#night-wave-banner")?.classList.remove("is-announcing");
  $("#night-shift")?.classList.add("is-hidden");
  $("#night-shift")?.setAttribute("aria-hidden", "true");
  renderNightShiftHud("TAG THE FLY-BYS BEFORE THEY REACH THE BORDER");
  if (state.phase !== "home") return;
  nightRun.host.startHomeClock();
  nightRun.host.renderPatrolHud();
  nightRun.host.scheduleHomeHelicopter(4000);
}

function freezeSpawnTimers() {
  nightRun.nightShiftSpawnTimers.forEach((entry) => {
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
  if (nightRun.nightShiftWaveTimer !== null) {
    clearTimeout(nightRun.nightShiftWaveTimer);
    nightRun.nightShiftWaveTimer = null;
    nightRun.nightShiftWaveHeld = true;
  }
  freezeSpawnTimers();
  document.body.classList.add("night-shift-paused");
  freezeTargetTimers();
}

function handleNightShiftHidden() {
  nightRun.nightShiftVisibilityGeneration += 1;
  nightRun.nightShiftPausedAt = Date.now();
  if (nightShiftState.active && nightRun.nightShiftServerRun) {
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
  clearTimeout(nightRun.nightShiftResultTimer);
  nightRun.nightShiftResultTimer = null;
}

function resumeSpawnTimers(paused) {
  nightRun.nightShiftSpawnTimers.forEach((entry) => {
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
  nightRun.nightShiftVisibilityGeneration += 1;
  if (nightShiftState.active && nightRun.nightShiftServerRun) {
    if (!nightShiftState.serverRunToken) document.body.classList.remove("night-shift-paused");
    else sendPatrolVisibility("resume-patrol-run");
    return;
  }
  if (!nightShiftState.active) {
    // Result countdown is parked while hidden; re-arm for its remaining time.
    if (nightRun.nightShiftResultEndsAt) scheduleNightShiftResult();
    return;
  }
  if (!nightRun.nightShiftPausedAt) return;
  const paused = Date.now() - nightRun.nightShiftPausedAt;
  nightRun.nightShiftPausedAt = 0;
  nightShiftState.endsAt += paused;
  // Resume with at most one pending step each, then the normal cadence.
  if (nightRun.nightShiftWaveHeld) {
    nightRun.nightShiftWaveHeld = false;
    nightRun.nightShiftWaveTimer = setTimeout(advanceNightShiftWave, Math.max(0, nightShiftState.endsAt - Date.now()));
  }
  resumeSpawnTimers(paused);
  resumeTargetTimers();
  document.body.classList.remove("night-shift-paused");
  renderNightShiftHud("NIGHT SHIFT RESUMED · CLEAR THE SKYLINE");
}

export { nightShiftState, PARLOR_PATROL_ENABLED };

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    handleNightShiftHidden();
    return;
  }
  handleNightShiftVisible();
});
