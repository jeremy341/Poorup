// Night Shift score settlement: submits a finished run, retries it across
// reconnects, and restores a settlement that was still pending on reload.
import { nightRun, nightShiftState } from "./clientNightShiftState.js";
import { nightShiftRunStartAck, observePatrolClock } from "./clientNightShiftServer.js";
import { endNightShift } from "./clientNightShift.js";
import { state } from "./clientState.js";
import { clearPersistedPendingSettlement, pendingSettlementCreatedAt, persistPendingSettlement, readPendingSettlementRecord } from "./clientNightShiftPending.js";

function patrolAccountId() {
  return String(state.account?.account?.id || "").trim();
}

function restorePendingSettlement() {
  const accountId = patrolAccountId();
  if (!accountId) return null;
  const saved = readPendingSettlementRecord(accountId);
  if (!saved) return null;
  const settlement = {
    generation: nightRun.nightShiftGeneration,
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
  nightRun.nightShiftSettlement = settlement;
  nightShiftState.serverRunToken = settlement.token;
  nightShiftState.serverRunSubmitted = true;
  return settlement;
}

export function hasPendingPatrolSettlement() {
  const accountId = patrolAccountId();
  if (!accountId) return false;
  if (nightRun.nightShiftSettlement?.token && nightRun.nightShiftSettlement.accountId === accountId) return true;
  return Boolean(readPendingSettlementRecord(accountId));
}

function applyRunBest(response) {
  if (response?.best == null) return;
  nightShiftState.best = Math.max(0, Number(response.best) || 0);
}

export function finishSettlement(settlement, response) {
  if (nightRun.nightShiftSettlement !== settlement) return;
  clearTimeout(settlement.timer);
  settlement.timer = null;
  nightRun.nightShiftSettlement = null;
  clearPersistedPendingSettlement(settlement);
  if (!response?.success) {
    nightShiftState.serverRunError = String(response?.error || "Could not confirm that the score was saved.").slice(0, 120);
    nightRun.host.parlorNotice("NIGHT SHIFT", nightShiftState.serverRunError);
    return;
  }
  if (settlement.account === state.account?.account) applyRunBest(response);
  if (settlement.left) nightRun.host.parlorNotice("NIGHT SHIFT", "Your patrol score was saved.");
}

export function beginSettlement() {
  if (nightRun.nightShiftSettlement) return nightRun.nightShiftSettlement;
  const settlement = { generation: nightRun.nightShiftGeneration, account: state.account?.account, accountId: patrolAccountId(), createdAt: Date.now(), timer: null, sent: false, left: false, token: null, awaitingReconnect: false, requestGeneration: 0 };
  nightRun.nightShiftSettlement = settlement;
  settlement.timer = setTimeout(() => {
    if (nightRun.nightShiftSettlement !== settlement) return;
    nightRun.nightShiftSettlement = null;
    nightShiftState.serverRunError = "Could not confirm that the patrol score was saved.";
    nightRun.host.parlorNotice("NIGHT SHIFT", nightShiftState.serverRunError);
  }, 8000);
  return settlement;
}

export function awaitSettlementReconnect(settlement, message = "Connection lost. Reconnect or press Shift+P to retry the patrol score.") {
  if (nightRun.nightShiftSettlement !== settlement) return;
  clearTimeout(settlement.timer);
  settlement.timer = null;
  settlement.requestGeneration += 1;
  settlement.awaitingReconnect = true;
  nightShiftState.serverRunError = message;
  nightRun.host.parlorNotice("NIGHT SHIFT", message);
}

function settlementRequestIsStale(settlement, requestGeneration) {
  return nightRun.nightShiftSettlement !== settlement || settlement.requestGeneration !== requestGeneration;
}

function handleFailedFinishAck(settlement, response, attempt, attempts, retrySend) {
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
  if (response?.success) {
    finishSettlement(settlement, response);
    return;
  }
  // The first attempt waits for the retry that is already scheduled.
  if (attempt === 1 && attempts > 1) return;
  handleFailedFinishAck(settlement, response, attempt, attempts, retrySend);
}

export function sendSettlement(settlement, token) {
  if (nightRun.nightShiftSettlement !== settlement || settlement.sent || !token) return;
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
    nightRun.host.emitServer("finish-patrol-run", { runToken: token }, (response) => {
      if (settlementRequestIsStale(settlement, requestGeneration)) return;
      handleFinishAck(settlement, response, attempt, attempts, send);
    });
  };
  send();
}

export function submitNightShiftRun() {
  if (!nightShiftState.serverRunToken || nightShiftState.serverRunSubmitted) return;
  sendSettlement(beginSettlement(), nightShiftState.serverRunToken);
}

export function handlePatrolReconnect() {
  let settlement = nightRun.nightShiftSettlement;
  if (settlement && settlement.accountId !== patrolAccountId()) {
    nightRun.nightShiftSettlement = null;
    settlement = null;
  }
  if (!settlement) settlement = restorePendingSettlement();
  if (!settlement?.awaitingReconnect || !settlement.token) return false;
  settlement.sent = false;
  nightShiftState.serverRunError = null;
  sendSettlement(settlement, settlement.token);
  return true;
}

function holdForPendingSettlement() {
  if (nightRun.nightShiftSettlement.awaitingReconnect && nightRun.nightShiftSettlement.token) {
    nightRun.host.parlorNotice("NIGHT SHIFT", "Retrying your previous patrol score. Please wait.");
    nightRun.host.retryPendingSettlement?.();
    return;
  }
  nightRun.host.parlorNotice("NIGHT SHIFT", "Finishing your previous patrol. Please wait.");
}

function armNightShiftStartTimeout(generation) {
  nightRun.nightShiftStartTimer = setTimeout(() => {
    if (generation !== nightRun.nightShiftGeneration || !nightShiftState.active) return;
    nightRun.nightShiftGeneration += 1;
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
  nightRun.host.emitServer("finish-patrol-run", { runToken: response.runToken }, () => {});
}

function releaseLateStartAck(generation, response) {
  const pending = nightRun.nightShiftSettlement;
  if (pending?.generation === generation && !pending.sent) {
    settleUnsentStartAck(pending, response);
    return;
  }
  releaseStaleStartToken(response);
}

export function requestServerRunStart(generation) {
  const sentAt = Date.now();
  armNightShiftStartTimeout(generation);
  nightRun.host.emitServer("start-patrol-run", {}, (response) => {
    if (generation !== nightRun.nightShiftGeneration) {
      releaseLateStartAck(generation, response);
      return;
    }
    clearTimeout(nightRun.nightShiftStartTimer);
    nightRun.nightShiftStartTimer = null;
    observePatrolClock(response, sentAt);
    nightShiftRunStartAck(response);
  });
}

// Returns true when a previous run is still settling, so the new start waits.
export function holdIfSettlementPending() {
  if (nightRun.nightShiftSettlement && nightRun.nightShiftSettlement.accountId !== patrolAccountId()) nightRun.nightShiftSettlement = null;
  if (!nightRun.nightShiftSettlement) restorePendingSettlement();
  if (!nightRun.nightShiftSettlement) return false;
  holdForPendingSettlement();
  return true;
}
