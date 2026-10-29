// Night Shift server sync: applies authoritative patrol snapshots, ready
// acknowledgements, target gates and offers, and the visibility handshake.
// The server decides scoring; local timing stays in clientNightShift.js.
import { nightRun, nightShiftServerGates, nightShiftServerOffers, nightShiftState } from "./clientNightShiftState.js";
import { awaitSettlementReconnect, finishSettlement } from "./clientNightShiftSettlement.js";
import { confirmServerHit, endNightShift, renderNightShiftHud, spawnNightShiftTarget } from "./clientNightShift.js";
import { $, REDUCED_MOTION } from "./clientDom.js";

export function hitServerTarget(target, event) {
  if (target.dataset.pending) return;
  target.dataset.pending = "1";
  const generation = nightRun.nightShiftGeneration;
  const sentAt = Date.now();
  nightRun.host.emitServer("hit-patrol-target", { runToken: nightShiftState.serverRunToken, targetId: target.dataset.targetId }, (response) => {
    if (generation !== nightRun.nightShiftGeneration) return;
    if (!response?.success) { delete target.dataset.pending; return; }
    releaseServerOffer(target.dataset.targetId);
    observePatrolClock(response, sentAt);
    if (target.isConnected) confirmServerHit(target, event);
    applyPatrolState(response);
  });
}

export function observePatrolClock(response, sentAt) {
  if (!Number.isFinite(response?.serverTime)) return;
  const receivedAt = Date.now();
  const rtt = Math.max(0, receivedAt - sentAt);
  if (rtt > nightRun.nightShiftClockRtt) return;
  nightRun.nightShiftClockRtt = rtt;
  nightRun.nightShiftClockOffset = response.serverTime - (sentAt + receivedAt) / 2;
}

function estimatedPatrolTime(response) {
  if (response.paused || nightRun.nightShiftClockOffset === null) return response.serverTime;
  return Math.max(response.serverTime, Date.now() + nightRun.nightShiftClockOffset);
}

export function syncServerTargetAnimation(element, target, serverNow) {
  if (REDUCED_MOTION || target.deliveryPending) return;
  const animation = element.getAnimations?.().find((entry) => entry.animationName?.startsWith("night-target-"));
  if (animation) animation.currentTime = Math.max(0, serverNow - target.spawnedAt);
}

export function freezeServerOffers() {
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
  return generation === nightRun.nightShiftGeneration
    && visibilityGeneration === nightRun.nightShiftVisibilityGeneration
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

function handleServerTargetReadyAck(ready, response) {
  const { element, id, offer, generation, sentAt } = ready;
  if (generation !== nightRun.nightShiftGeneration || !nightShiftState.active || nightShiftServerOffers.get(id) !== offer) return;
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
  const generation = nightRun.nightShiftGeneration;
  const visibilityGeneration = nightRun.nightShiftVisibilityGeneration;
  const sentAt = Date.now();
  const ready = { element, id, offer, generation, sentAt };
  armReadyWatchdog(element, id, offer);
  nightRun.host.emitServer("ready-patrol-target", { runToken: nightShiftState.serverRunToken, targetId: id }, (response) => {
    handleServerTargetReadyAck(ready, response);
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
  if (!nightShiftState.active || !nightRun.nightShiftServerRun || response?.runToken !== nightShiftState.serverRunToken) return;
  if (!Number.isFinite(response.revision) || response.revision <= nightRun.nightShiftServerRevision) return;
  nightRun.nightShiftServerRevision = response.revision;
  const serverNow = estimatedPatrolTime(response);
  applyServerRunCounters(response, serverNow);
  syncServerTargetList(response, serverNow);
  renderNightShiftHud(response.paused ? "NIGHT SHIFT PAUSED" : "TAG THE FLY-BYS BEFORE THEY REACH THE BORDER");
  if (response.ended) endNightShift(response.endReason === "delivery-timeout" ? "NETWORK INTERRUPTION · SAVING SCORE" : "SHIFT LOST · NO HEARTS LEFT");
}

// The server's pause flag and the tab's visibility must agree once the run starts.
function reconcilePausedRunWithVisibility(response) {
  if (document.hidden && !response.paused) sendPatrolVisibility("pause-patrol-run");
  else if (!document.hidden && response.paused) sendPatrolVisibility("resume-patrol-run");
}

export function nightShiftRunStartAck(response) {
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
    reconcilePausedRunWithVisibility(response);
  } else {
    document.body.classList.remove("night-shift-paused");
  }
}

export function handlePatrolDisconnect() {
  if (nightRun.nightShiftSettlement) {
    if (nightRun.nightShiftSettlement.token) awaitSettlementReconnect(nightRun.nightShiftSettlement);
    else finishSettlement(nightRun.nightShiftSettlement, { success: false, error: "Connection lost. The patrol score could not be confirmed." });
  }
  if (!nightShiftState.active || !nightRun.nightShiftServerRun) return;
  nightRun.nightShiftGeneration += 1;
  nightShiftState.serverRunToken = null;
  nightShiftState.serverRunError = "Connection lost. This score was not saved.";
  endNightShift("CONNECTION LOST · SCORE NOT SAVED");
}

function abortPatrolSync(error, endMessage) {
  nightShiftState.serverRunError = error;
  nightShiftState.serverRunToken = null;
  nightRun.host.parlorNotice("NIGHT SHIFT", error);
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

export function sendPatrolVisibility(event, visibilityGeneration = nightRun.nightShiftVisibilityGeneration, retry = 0) {
  if (!nightShiftState.serverRunToken) return;
  const generation = nightRun.nightShiftGeneration;
  const sentAt = Date.now();
  nightRun.host.emitServer(event, { runToken: nightShiftState.serverRunToken }, (response) => {
    if (generation !== nightRun.nightShiftGeneration || !nightShiftState.active || visibilityGeneration !== nightRun.nightShiftVisibilityGeneration) return;
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
