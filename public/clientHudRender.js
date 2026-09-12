/* ============================================================
   HUD RENDERING: turn panel, dice, roll button, stage pill,
   jail actions, and the per-turn countdown. All reads come from
   clientState; end-of-countdown game actions arrive via hooks.
   ============================================================ */
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";

const DIE_PIPS = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

export function dieHTML(value, rolling) {
  const pips = DIE_PIPS[value] || DIE_PIPS[1];
  let cells = "";
  for (let i = 0; i < 9; i++) {
    const cx = i % 3;
    const cy = Math.floor(i / 3);
    cells += `<span class="${pips.some(([x, y]) => x === cx && y === cy) ? "on" : ""}"></span>`;
  }
  return `<div class="die${rolling ? " dice-rolling" : ""}">${cells}</div>`;
}

function hudStatusLabel(waiting, awaitingEnd) {
  if (waiting) return "Waiting For Game";
  if (awaitingEnd) return "Resolve & End";
  return "Current Turn";
}

function noteVisible(waiting, awaitingEnd) {
  if (waiting) return true;
  if (awaitingEnd) return state.turnIndex === 0;
  return false;
}

function renderHudLobby() {
  $("#hud-turn-label").textContent = "In Lobby";
  const nameEl = $("#hud-name");
  nameEl.textContent = "Configure";
  nameEl.style.color = "#cfa75f";
  $("#hud-note").style.display = "block";
  $("#hud-note").textContent = "Set rules on the right, then press Start Round.";
  $("#hud-bot-status")?.classList.add("is-hidden");
  $("#hud-loan-status")?.classList.add("is-hidden");
  $("#hud-cash").textContent = `$${Number(state.settings.startingCash).toLocaleString()}`;
  if ($("#hud-cash-action")) $("#hud-cash-action").disabled = true;
  $("#hud-pool").textContent = "$0";
  $("#hud-dice").innerHTML = `<div class="die-blank">—</div><div class="die-blank">—</div>`;
  $("#roll-btn").disabled = true;
  $("#roll-label").textContent = "Set Rules First";
}

function showLoanStatus(cur, waiting) {
  if (waiting) return false;
  const loan = cur?.bankLoan;
  if (!loan) return false;
  return ["active", "due"].includes(loan.status);
}

function loanStatusText(loan) {
  const remaining = (Number(loan.remaining) || 0).toLocaleString();
  const dueRound = loan.dueRound || "—";
  return `BANK DEBT · $${remaining} · DUE R${dueRound}`;
}

function renderHudLoan(cur, waiting) {
  const loanStatus = $("#hud-loan-status");
  if (!loanStatus) return;
  const showLoan = showLoanStatus(cur, waiting);
  loanStatus.classList.toggle("is-hidden", !showLoan);
  if (showLoan) loanStatus.textContent = loanStatusText(cur.bankLoan);
}

function renderHudDice(waiting) {
  if (waiting) {
    $("#hud-dice").innerHTML = `<div class="die-blank">—</div><div class="die-blank">—</div>`;
    return;
  }
  $("#hud-dice").innerHTML = dieHTML(state.dice[0], state.rolling) + dieHTML(state.dice[1], state.rolling);
}

function hudControlsLocked() {
  if (state.pendingBuyTile != null && state.settings.auction) return true;
  return Boolean(state.auction);
}

function humanTurnNow() {
  if (state.turnIndex !== 0) return false;
  return state.phase === "playing";
}

function canRollNow(locked, humanTurn) {
  if (state.busy) return false;
  if (locked) return false;
  if (!humanTurn) return false;
  return state.turnStage === "roll";
}

function canEndNow(locked, humanTurn) {
  if (state.busy) return false;
  if (locked) return false;
  if (!humanTurn) return false;
  return state.turnStage === "end";
}

function hudRollLabel(waiting, canRoll, canEnd) {
  if (waiting) return "Join First";
  if (state.rolling) return "Rolling…";
  if (canEnd) return "End Turn";
  if (canRoll) return "Roll Dice";
  return "Waiting…";
}

function renderHudRollButton(waiting) {
  const locked = hudControlsLocked();
  const humanTurn = humanTurnNow();
  const canRoll = canRollNow(locked, humanTurn);
  const canEnd = canEndNow(locked, humanTurn);
  const btn = $("#roll-btn");
  btn.disabled = !(canRoll || canEnd);
  $("#roll-label").textContent = hudRollLabel(waiting, canRoll, canEnd);
}

function inJailThisTurn(cur) {
  const turns = state.jail[cur?.id] || 0;
  return turns > 0;
}

function hudStageKind(cur) {
  if (state.rolling) return { label: "ROLLING", className: "st-resolve" };
  if (state.turnStage === "end") return { label: "END TURN", className: "st-end" };
  if (inJailThisTurn(cur) && humanTurnNow()) return { label: "IN JAIL", className: "st-resolve" };
  return { label: "ROLL", className: "" };
}

// ---- per-turn countdown -------------------------------------------
let turnDeadline = 0;
let turnTimerInterval = null;
let turnTimerLeft = 0;
let lastAnnouncedTurnSecond = null;
export function configureTurnCountdown(_hooks) {
  // Kept as a compatibility seam; expiry is now resolved by the server.
}

function autoEndExpiredTurn() {
  if (state.phase !== "playing") return;
  if (state.turnIndex !== 0) return;
  // Expiry is server-authoritative. The local clock only renders feedback;
  // the runtime clears obligations and advances the turn atomically.
}

function countdownTick() {
  turnTimerLeft = Math.max(0, turnDeadline - serverNow());
  updateTurnTimerState();
  if (turnTimerLeft > 0) return;
  clearInterval(turnTimerInterval);
  turnTimerInterval = null;
  // auto-end the human's turn when time runs out
  autoEndExpiredTurn();
}

export function stopTurnCountdown() {
  clearInterval(turnTimerInterval);
  turnTimerInterval = null;
}

export function startTurnCountdown() {
  stopTurnCountdown();
  if (state.settings.turnTimer <= 0 || state.turnIndex !== 0) return;
  turnDeadline = Number(state.turnDeadline) || (Date.now() + (state.serverTimeOffset || 0) + state.settings.turnTimer * 1000);
  lastAnnouncedTurnSecond = null;
  turnTimerInterval = setInterval(countdownTick, 120);
}

function turnTimerAnnouncer(timerEl) {
  const parent = timerEl?.parentElement;
  if (!parent) return null;
  let announcer = parent.querySelector("#hud-timer-announcer");
  if (announcer) return announcer;
  announcer = document.createElement("span");
  announcer.id = "hud-timer-announcer";
  announcer.className = "sr-only";
  announcer.setAttribute("aria-live", "polite");
  announcer.setAttribute("aria-atomic", "true");
  parent.appendChild(announcer);
  return announcer;
}

export function updateTurnTimerState() {
  const timerEl = $("#hud-timer");
  if (!timerEl) return;
  const left = Math.max(0, (turnDeadline - serverNow()) / 1000);
  const shown = timerShownNow();
  timerEl.classList.toggle("is-hidden", !shown);
  if (!shown) {
    timerEl.removeAttribute("aria-label");
    const announcer = timerEl.parentElement?.querySelector("#hud-timer-announcer");
    if (announcer) announcer.textContent = "";
    lastAnnouncedTurnSecond = null;
    return;
  }
  timerEl.setAttribute("role", "timer");
  timerEl.textContent = `${left.toFixed(1)}s`;
  const seconds = Math.max(0, Math.ceil(left));
  timerEl.setAttribute("aria-label", `Turn timer: ${seconds} seconds remaining`);
  const announcer = turnTimerAnnouncer(timerEl);
  if (announcer && lastAnnouncedTurnSecond !== seconds) {
    lastAnnouncedTurnSecond = seconds;
    announcer.textContent = `${seconds} seconds remaining in your turn.`;
  }
  timerEl.classList.toggle("is-low", left <= 5);
}

function serverNow() {
  return Date.now() + (state.serverTimeOffset || 0);
}

function timerShownNow() {
  return state.settings.turnTimer > 0 && humanTurnNow();
}

function timerActive(waiting, isLobby) {
  if (waiting) return false;
  if (isLobby) return false;
  return timerShownNow();
}

function renderHudTimer(waiting, isLobby) {
  const timerEl = $("#hud-timer");
  if (!timerEl) return;
  const useTimer = timerActive(waiting, isLobby);
  timerEl.classList.toggle("is-hidden", !useTimer);
  if (useTimer) updateTurnTimerState();
}

function renderHudStage(cur, waiting, isLobby) {
  const stageEl = $("#hud-stage");
  if (stageEl) {
    const stage = hudStageKind(cur);
    const hidden = waiting || isLobby;
    stageEl.classList.toggle("is-hidden", hidden);
    stageEl.textContent = stage.label;
    stageEl.classList.remove("st-end", "st-resolve");
    if (stage.className) stageEl.classList.add(stage.className);
  }
  renderHudTimer(waiting, isLobby);
}

function jailPhaseReady(waiting, isLobby) {
  if (waiting) return false;
  if (isLobby) return false;
  if (!humanTurnNow()) return false;
  return state.turnStage === "roll";
}

function payJailFineAvailable(cur, waiting, isLobby) {
  if (!jailPhaseReady(waiting, isLobby)) return false;
  if (!inJailThisTurn(cur)) return false;
  return cur.cash >= 50;
}

function useJailFreeAvailable(cur, waiting, isLobby) {
  if (!jailPhaseReady(waiting, isLobby)) return false;
  if (!inJailThisTurn(cur)) return false;
  return (cur.jailFree || 0) > 0;
}

function renderHudJailButtons(cur, waiting, isLobby) {
  const jailBtn = $("#pay-jail-fine");
  if (jailBtn) {
    jailBtn.classList.toggle("is-hidden", !payJailFineAvailable(cur, waiting, isLobby));
    jailBtn.disabled = state.busy;
  }
  const jailCardBtn = $("#use-jail-free");
  if (jailCardBtn) {
    jailCardBtn.classList.toggle("is-hidden", !useJailFreeAvailable(cur, waiting, isLobby));
    jailCardBtn.disabled = state.busy;
  }
}

export function renderHud() {
  const waiting = state.phase !== "playing";
  const isLobby = state.phase === "lobby";
  const cur = state.players[state.turnIndex];

  if (isLobby) {
    renderHudLobby();
    return;
  }

  const awaitingEnd = state.turnStage === "end";
  $("#hud-turn-label").textContent = hudStatusLabel(waiting, awaitingEnd);
  const nameEl = $("#hud-name");
  nameEl.textContent = waiting ? "Stand By" : cur.name;
  nameEl.style.color = waiting ? "#cfa75f" : cur.textColor;
  const noteVisibleNow = noteVisible(waiting, awaitingEnd);
  $("#hud-note").style.display = noteVisibleNow ? "block" : "none";
  $("#hud-note").textContent = awaitingEnd
    ? "Buy, build or trade now, then end your turn."
    : "Join a room to get started.";
  renderHudLoan(cur, waiting);
  $("#hud-cash").textContent = `$${waiting ? "0" : cur.cash.toLocaleString()}`;
  if ($("#hud-cash-action")) $("#hud-cash-action").disabled = waiting;
  $("#hud-pool").textContent = `$${waiting ? 0 : state.pool}`;
  renderHudDice(waiting);
  renderHudRollButton(waiting);
  renderHudStage(cur, waiting, isLobby);
  renderHudJailButtons(cur, waiting, isLobby);
}
