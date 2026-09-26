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
  if (state.pendingBuyTile != null) return true;
  if (state.sponsorship) return true;
  return Boolean(state.auction);
}

function humanTurnNow() {
  if (state.turnIndex !== 0) return false;
  if (state.players[0]?.bankrupt || state.players[0]?.spectating) return false;
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
  if (state.pendingBuyTile != null) return "Resolve Purchase";
  if (state.sponsorship) return "Resolve Sponsorship";
  if (state.auction) return "Resolve Auction";
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
  // A dismissed purchase card reopens from this button: keep it enabled
  // while "Resolve Purchase" is showing, otherwise the turn strands.
  btn.disabled = state.pendingBuyTile != null ? false : !(canRoll || canEnd);
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
  const cur = state.players[state.turnIndex] || null;

  if (isLobby) {
    renderHudLobby();
    return;
  }

  const awaitingEnd = state.turnStage === "end";
  $("#hud-turn-label").textContent = hudStatusLabel(waiting, awaitingEnd);
  const nameEl = $("#hud-name");
  nameEl.textContent = waiting ? "Stand By" : cur?.name || "Syncing…";
  nameEl.style.color = waiting ? "#cfa75f" : cur?.textColor || "#cfa75f";
  const noteVisibleNow = noteVisible(waiting, awaitingEnd);
  $("#hud-note").style.display = noteVisibleNow ? "block" : "none";
  $("#hud-note").textContent = awaitingEnd
    ? "Buy, build or trade now, then end your turn."
    : humanTurnNow() && inJailThisTurn(cur) && (cur.cash || 0) < 50 && !(cur.jailFree > 0)
      ? "In jail: roll doubles to walk free, or end the turn to wait it out."
      : !waiting && state.turnIndex !== 0 && cur?.name
        ? `${cur.name} is deciding…`
        : "Join a room to get started.";
  renderHudLoan(cur, waiting);
  $("#hud-cash").textContent = `$${waiting ? "0" : Number(cur?.cash || 0).toLocaleString()}`;
  if ($("#hud-cash-action")) $("#hud-cash-action").disabled = waiting;
  $("#hud-pool").textContent = `$${waiting ? 0 : state.pool}`;
  renderHudDice(waiting);
  renderHudRollButton(waiting);
  renderHudStage(cur, waiting, isLobby);
  renderHudJailButtons(cur, waiting || !cur, isLobby);
}
