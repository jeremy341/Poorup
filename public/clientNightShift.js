// NIGHT SHIFT: the Ctrl/Shift+P arcade mini-game on Home.
// Owns the wave timers, spawn queue, hit/miss resolution, the background-tab
// freeze/resume coordinator and run submission. Server calls, achievements and
// Home patrol plumbing come from host callbacks in the entry module.
import { $, REDUCED_MOTION } from "./clientDom.js";
import { state } from "./clientState.js";
import { hydrateSprites } from "./clientSprites.js";
import { PARLOR_PATROL_ENABLED } from "./clientParlorPatrolFlag.js";
import { PATROL_ART, configureTargetPlacement, effectDimensions, effectSrc, paintTargetArt, pickTargetDuration, pickTargetKind, pulseWaveBanner, targetClassName, waveSpawnInterval } from "./clientNightShiftArt.js";
import { clearPersistedPendingSettlement, persistPendingSettlement, pendingSettlementCreatedAt, readPendingSettlementRecord } from "./clientNightShiftPending.js";

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

function patrolAccountId() {
  return String(state.account?.account?.id || "").trim();
}

function restorePendingSettlement() {
  const accountId = patrolAccountId();
  if (!accountId) return null;
  const saved = readPendingSettlementRecord(accountId);
  if (!saved) return null;
  const settlement = {
    generation: nightShiftGeneration,
    account: state.account.account,
    accountId,
    createdAt: pendingSettlementCreatedAt(saved),
    timer: null,
    sent: false,
    left: true,
    token: saved.runToken,
    awaitingReconnect: true,
    requestGeneration: 0,
  };
  nightShiftSettlement = settlement;
  nightShiftState.serverRunToken = settlement.token;
  nightShiftState.serverRunSubmitted = true;
  return settlement;
}

export function hasPendingPatrolSettlement() {
  const accountId = patrolAccountId();
  if (!accountId) return false;
  if (nightShiftSettlement?.token && nightShiftSettlement.accountId === accountId) return true;
  return Boolean(readPendingSettlementRecord(accountId));
}

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

function spawnNightShiftTarget(serverTarget = null, serverTime = 0) {
  if (!nightShiftState.active) return;
  if (state.phase !== "home") return;
  if (document.hidden) return; // frozen queue: the resume coordinator re-arms
  const layer = $("#night-targets");
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
  settlement.timer = null;
  nightShiftSettlement = null;
  clearPersistedPendingSettlement(settlement);
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
  const settlement = { generation: nightShiftGeneration, account: state.account?.account, accountId: patrolAccountId(), createdAt: Date.now(), timer: null, sent: false, left: false, token: null, awaitingReconnect: false, requestGeneration: 0 };
  nightShiftSettlement = settlement;
  settlement.timer = setTimeout(() => {
    if (nightShiftSettlement !== settlement) return;
    nightShiftSettlement = null;
    nightShiftState.serverRunError = "Could not confirm that the patrol score was saved.";
    host.parlorNotice("NIGHT SHIFT", nightShiftState.serverRunError);
  }, 8000);
  return settlement;
}

function awaitSettlementReconnect(settlement, message = "Connection lost. Reconnect or press Shift+P to retry the patrol score.") {
  if (nightShiftSettlement !== settlement) return;
  clearTimeout(settlement.timer);
  settlement.timer = null;
  settlement.requestGeneration += 1;
  settlement.awaitingReconnect = true;
  nightShiftState.serverRunError = message;
  host.parlorNotice("NIGHT SHIFT", message);
}

function settlementRequestIsStale(settlement, requestGeneration) {
  return nightShiftSettlement !== settlement || settlement.requestGeneration !== requestGeneration;
}

function handleFailedFinishAck(settlement, response, attempt, attempts, retrySend) {
  if (attempt === 1 && attempts > 1) return;
  if (response?.retryable && attempt === 1 && attempts === 1) {
    clearTimeout(settlement.timer);
    retrySend();
    return;
  }
  if (response?.retryable && attempts > 1) {
    const error = String(response.error || "Could not save this patrol.").slice(0, 63);
    awaitSettlementReconnect(settlement, `${error} Press Shift+P or reconnect to retry.`);
    return;
  }
  if (attempts > 1) {
    finishSettlement(settlement, { success: false, error: "Could not confirm that the patrol score was saved." });
    return;
  }
  finishSettlement(settlement, response);
}

function handleFinishAck(settlement, response, attempt, attempts, retrySend) {
  if (response?.success) finishSettlement(settlement, response);
  else handleFailedFinishAck(settlement, response, attempt, attempts, retrySend);
}

function sendSettlement(settlement, token) {
  if (nightShiftSettlement !== settlement || settlement.sent || !token) return;
  settlement.token = token;
  settlement.awaitingReconnect = false;
  settlement.sent = true;
  nightShiftState.serverRunSubmitted = true;
  persistPendingSettlement(settlement);
  clearTimeout(settlement.timer);
  const requestGeneration = ++settlement.requestGeneration;
  let attempts = 0;
  const send = () => {
    if (settlementRequestIsStale(settlement, requestGeneration)) return;
    attempts += 1;
    const attempt = attempts;
    settlement.timer = setTimeout(() => {
      if (settlementRequestIsStale(settlement, requestGeneration)) return;
      if (attempts === 1) { send(); return; }
      awaitSettlementReconnect(settlement, "Could not confirm the patrol score. Reconnect or press Shift+P to retry.");
    }, 4000);
    host.emitServer("finish-patrol-run", { runToken: token }, (response) => {
      if (settlementRequestIsStale(settlement, requestGeneration)) return;
      handleFinishAck(settlement, response, attempt, attempts, send);
    });
  };
  send();
}

function submitNightShiftRun() {
  if (!nightShiftState.serverRunToken || nightShiftState.serverRunSubmitted) return;
  sendSettlement(beginSettlement(), nightShiftState.serverRunToken);
}

export function handlePatrolReconnect() {
  let settlement = nightShiftSettlement;
  if (settlement && settlement.accountId !== patrolAccountId()) {
    nightShiftSettlement = null;
    settlement = null;
  }
  if (!settlement) settlement = restorePendingSettlement();
  if (!settlement?.awaitingReconnect || !settlement.token) return false;
  settlement.sent = false;
  nightShiftState.serverRunError = null;
  sendSettlement(settlement, settlement.token);
  return true;
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

function measureHit(target, event) {
  const rect = target.getBoundingClientRect();
  const area = $("#night-shift")?.getBoundingClientRect();
  if (!area) return null;
  return { rect, point: hitPoint(rect, event, area) };
}

function playTargetCrash(target, { rect, point }) {
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

function confirmServerHit(target, event) {
  const hit = measureHit(target, event);
  if (!hit) return;
  target.dataset.hit = "1";
  playTargetCrash(target, hit);
  host.playPatrolHitSound();
}

function hitServerTarget(target, event) {
  if (target.dataset.pending) return;
  target.dataset.pending = "1";
  const generation = nightShiftGeneration;
  const sentAt = Date.now();
  host.emitServer("hit-patrol-target", { runToken: nightShiftState.serverRunToken, targetId: target.dataset.targetId }, (response) => {
    if (generation !== nightShiftGeneration) return;
    if (!response?.success) { delete target.dataset.pending; return; }
    releaseServerOffer(target.dataset.targetId);
    observePatrolClock(response, sentAt);
    if (target.isConnected) confirmServerHit(target, event);
    applyPatrolState(response);
  });
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
  host.playPatrolHitSound();
  renderNightShiftHud(`TAGGED +${points} · WAVE ${String(nightShiftState.wave).padStart(2, "0")}`);
}

function hitNightShiftTarget(target, event) {
  if (!hitGuard(target)) return;
  // Measure the transformed, live position before clearing the flight class.
  // This mirrors Home's hit path and prevents effects from snapping back to
  // the left/right/top spawn edge.
  if (nightShiftServerRun) hitServerTarget(target, event);
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

function serverOfferFor(target, id) {
  const existing = nightShiftServerOffers.get(id);
  if (existing) return existing;
  const offer = { timer: null, watchdog: null, remaining: Math.round(target.duration * 0.16), startedAt: 0,
    watchdogBudget: Math.floor(target.duration * 0.8), watchdogStartedAt: 0, readySent: false, attempts: 0 };
  nightShiftServerOffers.set(id, offer);
  return offer;
}

function armServerOffer(element, target, paused) {
  const id = String(target.id);
  const offer = serverOfferFor(target, id);
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

function readyWindowStillOpen(element, id, offer, generation, visibilityGeneration) {
  return generation === nightShiftGeneration
    && visibilityGeneration === nightShiftVisibilityGeneration
    && !document.hidden
    && nightShiftState.active
    && element.isConnected
    && nightShiftServerOffers.get(id) === offer;
}

function onReadyWatchdog(element, id, offer) {
  offer.watchdogBudget = Math.max(0, offer.watchdogBudget - (Date.now() - offer.watchdogStartedAt));
  offer.watchdog = null;
  if (nightShiftServerOffers.get(id) !== offer || !nightShiftState.active || document.hidden) return;
  if (offer.attempts < 2 && offer.watchdogBudget > 0) {
    sendServerTargetReady(element, id, offer);
    return;
  }
  endNightShift("NETWORK INTERRUPTION · SAVING SCORE");
}

function armReadyWatchdog(element, id, offer) {
  // Socket.IO preserves event order, so the ready message precedes any hit.
  // Spend at most 80% of the flight after readiness, excluding hidden time.
  offer.watchdogStartedAt = Date.now();
  const watchdogDelay = Math.max(1, offer.attempts < 2
    ? Math.min(Math.floor(Number(element.dataset.duration) * 0.4), offer.watchdogBudget)
    : offer.watchdogBudget);
  offer.watchdog = setTimeout(() => onReadyWatchdog(element, id, offer), watchdogDelay);
}

function handleServerTargetReadyAck(element, id, offer, generation, sentAt, response) {
  if (generation !== nightShiftGeneration || !nightShiftState.active || nightShiftServerOffers.get(id) !== offer) return;
  if (!response?.success) {
    if (document.hidden || element.dataset.hit || element.dataset.pending) return;
    endNightShift("NETWORK INTERRUPTION · SAVING SCORE");
    return;
  }
  observePatrolClock(response, sentAt);
  applyPatrolState(response);
}

function markReadyWindowOpen(element, id, offer, generation, visibilityGeneration) {
  if (!readyWindowStillOpen(element, id, offer, generation, visibilityGeneration)) return;
  element.dataset.actionable = "1";
  element.style.pointerEvents = "auto";
}

function sendServerTargetReady(element, id, offer) {
  if (!nightShiftState.active || document.hidden || !element.isConnected) return;
  offer.readySent = true;
  offer.attempts += 1;
  const generation = nightShiftGeneration;
  const visibilityGeneration = nightShiftVisibilityGeneration;
  const sentAt = Date.now();
  armReadyWatchdog(element, id, offer);
  host.emitServer("ready-patrol-target", { runToken: nightShiftState.serverRunToken, targetId: id }, (response) => {
    handleServerTargetReadyAck(element, id, offer, generation, sentAt, response);
  });
  markReadyWindowOpen(element, id, offer, generation, visibilityGeneration);
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

function releaseServerOffer(id) {
  const offer = nightShiftServerOffers.get(id);
  if (!offer) return;
  clearTimeout(offer.timer);
  clearTimeout(offer.watchdog);
  nightShiftServerOffers.delete(id);
}

function releaseServerGate(id) {
  const timers = nightShiftServerGates.get(id);
  if (!timers) return;
  clearTimeout(timers.open);
  clearTimeout(timers.close);
  nightShiftServerGates.delete(id);
}

function liveServerTargets(response, serverNow) {
  if (!Array.isArray(response.targets)) return [];
  return response.targets.filter((target) => target.deliveryPending || (Number.isFinite(target.expiresAt) && target.expiresAt > serverNow));
}

function pruneUnlistedServerTargets(layer, ids) {
  layer?.querySelectorAll(".night-target:not([data-hit])").forEach((element) => {
    const id = element.dataset.targetId;
    if (ids.has(id)) return;
    releaseServerGate(id);
    releaseServerOffer(id);
    element.remove();
  });
}

function findTargetElement(layer, targetId) {
  return [...layer.querySelectorAll(".night-target")].find((el) => el.dataset.targetId === String(targetId));
}

function syncServerTarget(element, target, serverNow, paused) {
  if (target.deliveryPending) {
    armServerOffer(element, target, paused);
    return;
  }
  releaseServerOffer(String(target.id));
  syncServerTargetAnimation(element, target, serverNow);
  setServerTargetGate(element, target, serverNow, paused);
}

function applyServerRunCounters(response, serverNow) {
  nightShiftState.wave = response.wave;
  nightShiftState.score = response.score;
  nightShiftState.hearts = response.hearts;
  nightShiftState.misses = response.misses;
  nightShiftState.endsAt = Date.now() + Math.max(0, response.endsAt - serverNow);
}

function syncOneServerTarget(layer, target, serverNow, paused) {
  if (!layer?.querySelectorAll) return;
  let element = findTargetElement(layer, target.id);
  if (!element) {
    spawnNightShiftTarget(target, serverNow);
    element = findTargetElement(layer, target.id);
  }
  if (element && !element.dataset.hit) syncServerTarget(element, target, serverNow, paused);
}

function syncServerTargetList(response, serverNow) {
  const layer = $("#night-targets");
  const targets = liveServerTargets(response, serverNow);
  pruneUnlistedServerTargets(layer, new Set(targets.map((target) => String(target.id))));
  for (const target of targets) syncOneServerTarget(layer, target, serverNow, response.paused);
}

export function applyPatrolState(response) {
  if (!nightShiftState.active || !nightShiftServerRun || response?.runToken !== nightShiftState.serverRunToken) return;
  if (!Number.isFinite(response.revision) || response.revision <= nightShiftServerRevision) return;
  nightShiftServerRevision = response.revision;
  const serverNow = estimatedPatrolTime(response);
  applyServerRunCounters(response, serverNow);
  syncServerTargetList(response, serverNow);
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
    if (nightShiftSettlement.token) awaitSettlementReconnect(nightShiftSettlement);
    else finishSettlement(nightShiftSettlement, { success: false, error: "Connection lost. The patrol score could not be confirmed." });
  }
  if (!nightShiftState.active || !nightShiftServerRun) return;
  nightShiftGeneration += 1;
  nightShiftState.serverRunToken = null;
  nightShiftState.serverRunError = "Connection lost. This score was not saved.";
  endNightShift("CONNECTION LOST · SCORE NOT SAVED");
}

function abortPatrolSync(error, endMessage) {
  nightShiftState.serverRunError = error;
  nightShiftState.serverRunToken = null;
  host.parlorNotice("NIGHT SHIFT", error);
  endNightShift(endMessage);
}

function syncPausedBodyClass() {
  if (document.hidden) document.body.classList.add("night-shift-paused");
  else document.body.classList.remove("night-shift-paused");
}

function failPatrolVisibility(response) {
  const error = String(response?.error || "Score sync unavailable.").slice(0, 120);
  abortPatrolSync(error, /expired/i.test(error) ? "PAUSED RUN EXPIRED · SCORE NOT SAVED" : "SCORE SYNC UNAVAILABLE · SCORE NOT SAVED");
}

function reconcilePatrolVisibility(visibilityGeneration, retry) {
  if (retry === 0) {
    sendPatrolVisibility(document.hidden ? "pause-patrol-run" : "resume-patrol-run", visibilityGeneration, 1);
    return;
  }
  abortPatrolSync("Could not synchronize patrol visibility.", "SCORE SYNC UNAVAILABLE · SCORE NOT SAVED");
}

function sendPatrolVisibility(event, visibilityGeneration = nightShiftVisibilityGeneration, retry = 0) {
  if (!nightShiftState.serverRunToken) return;
  const generation = nightShiftGeneration;
  const sentAt = Date.now();
  host.emitServer(event, { runToken: nightShiftState.serverRunToken }, (response) => {
    if (generation !== nightShiftGeneration || !nightShiftState.active || visibilityGeneration !== nightShiftVisibilityGeneration) return;
    if (!response?.success) {
      failPatrolVisibility(response);
      return;
    }
    observePatrolClock(response, sentAt);
    applyPatrolState(response);
    if (!nightShiftState.active) return;
    if (Boolean(response.paused) !== document.hidden) {
      reconcilePatrolVisibility(visibilityGeneration, retry);
      return;
    }
    syncPausedBodyClass();
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

function holdForPendingSettlement() {
  if (nightShiftSettlement.awaitingReconnect && nightShiftSettlement.token) {
    host.parlorNotice("NIGHT SHIFT", "Retrying your previous patrol score. Please wait.");
    host.retryPendingSettlement?.();
    return;
  }
  host.parlorNotice("NIGHT SHIFT", "Finishing your previous patrol. Please wait.");
}

function armNightShiftStartTimeout(generation) {
  nightShiftStartTimer = setTimeout(() => {
    if (generation !== nightShiftGeneration || !nightShiftState.active) return;
    nightShiftGeneration += 1;
    nightShiftState.serverRunError = "Could not confirm that the patrol started.";
    endNightShift("SCORE SYNC UNAVAILABLE · SCORE NOT SAVED");
  }, 8000);
}

function settleUnsentStartAck(pending, response) {
  if (response?.success && response.runToken) sendSettlement(pending, response.runToken);
  else finishSettlement(pending, { success: false, error: response?.error || "Could not start or save the patrol." });
}

// The start acknowledgement arrived after the exit timeout. Release
// the old token without touching any newer run's local state.
function releaseStaleStartToken(response) {
  if (!response?.success || !response.runToken) return;
  host.emitServer("finish-patrol-run", { runToken: response.runToken }, () => {});
}

function releaseLateStartAck(generation, response) {
  const pending = nightShiftSettlement;
  if (pending?.generation === generation && !pending.sent) {
    settleUnsentStartAck(pending, response);
    return;
  }
  releaseStaleStartToken(response);
}

function requestServerRunStart(generation) {
  const sentAt = Date.now();
  armNightShiftStartTimeout(generation);
  host.emitServer("start-patrol-run", {}, (response) => {
    if (generation !== nightShiftGeneration) {
      releaseLateStartAck(generation, response);
      return;
    }
    clearTimeout(nightShiftStartTimer);
    nightShiftStartTimer = null;
    observePatrolClock(response, sentAt);
    nightShiftRunStartAck(response);
  });
}

// Returns true when a previous run is still settling, so the new start waits.
function holdIfSettlementPending() {
  if (nightShiftSettlement && nightShiftSettlement.accountId !== patrolAccountId()) nightShiftSettlement = null;
  if (!nightShiftSettlement) restorePendingSettlement();
  if (!nightShiftSettlement) return false;
  holdForPendingSettlement();
  return true;
}

function beginNightShiftRun() {
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
  if (state.account?.account) requestServerRunStart(generation);
  if (!nightShiftState.active) return;
  nightShiftTickTimer = setInterval(() => renderNightShiftHud(), 200);
  if (!nightShiftServerRun) beginNightShiftWave();
}

export function startNightShift() {
  if (!PARLOR_PATROL_ENABLED) return;
  if (state.phase !== "home") return;
  if (nightShiftState.active) return;
  if (holdIfSettlementPending()) return;
  beginNightShiftRun();
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
    // Result countdown is parked while hidden; re-arm for its remaining time.
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

