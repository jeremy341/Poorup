/* ============================================================
   HUD RENDERING: current player, local cash, dice and turn actions.
   All reads come from
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

function localPlayer() {
  return (state.clientId && state.players.find(player => player.clientId === state.clientId))
    || state.players.find(player => player.id === "p1")
    || state.players[0]
    || null;
}

function renderHudLobby() {
  $("#hud-turn-label").textContent = "In Lobby";
  const nameEl = $("#hud-name");
  nameEl.textContent = "Configure";
  nameEl.style.color = "#cfa75f";
  $("#hud-turn-label").removeAttribute("aria-label");
  $("#hud-cash").textContent = `$${Number(state.settings.startingCash).toLocaleString()}`;
  if ($("#hud-cash-action")) $("#hud-cash-action").disabled = true;
  $("#hud-pool").textContent = "$0";
  $("#hud-dice").innerHTML = `<div class="die-blank">—</div><div class="die-blank">—</div>`;
  $("#roll-btn").disabled = true;
  $("#roll-label").textContent = "Set Rules First";
  renderHudJailButtons(null, true, true);
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
  if (state.busy || state.presentationBusy) return false;
  if (locked) return false;
  if (!humanTurn) return false;
  return state.turnStage === "roll";
}

function canEndNow(locked, humanTurn) {
  if (state.busy || state.presentationBusy) return false;
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
  btn.disabled = state.presentationBusy ? true : state.pendingBuyTile != null ? false : !(canRoll || canEnd);
  $("#roll-label").textContent = hudRollLabel(waiting, canRoll, canEnd);
}

function inJailThisTurn(cur) {
  const turns = state.jail[cur?.id] || 0;
  return turns > 0;
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
    jailBtn.disabled = state.busy || state.presentationBusy;
  }
  const jailCardBtn = $("#use-jail-free");
  if (jailCardBtn) {
    jailCardBtn.classList.toggle("is-hidden", !useJailFreeAvailable(cur, waiting, isLobby));
    jailCardBtn.disabled = state.busy || state.presentationBusy;
  }
}

export function renderHud() {
  const waiting = state.phase !== "playing";
  const isLobby = state.phase === "lobby";
  const cur = state.players[state.turnIndex] || null;
  const me = localPlayer();

  if (isLobby) {
    renderHudLobby();
    return;
  }

  $("#hud-turn-label").textContent = waiting ? "Waiting For Game" : "Current Turn";
  $("#hud-turn-label").setAttribute("aria-label", waiting ? "Waiting for game" : `Current turn: ${cur?.name || "Syncing"}`);
  const nameEl = $("#hud-name");
  nameEl.textContent = waiting ? "Stand By" : cur?.name || "Syncing…";
  nameEl.style.color = waiting ? "#cfa75f" : cur?.textColor || "#cfa75f";
  $("#hud-cash").textContent = `$${waiting ? "0" : Number(me?.visualCash ?? me?.cash ?? 0).toLocaleString()}`;
  if ($("#hud-cash-action")) {
    $("#hud-cash-action").disabled = waiting || !me;
    $("#hud-cash-action").setAttribute("aria-label", me ? `Open ${me.name}'s wallet and items` : "Open wallet and items");
  }
  $("#hud-pool").textContent = `$${waiting ? 0 : state.pool}`;
  renderHudDice(waiting);
  renderHudRollButton(waiting);
  renderHudJailButtons(cur, waiting || !cur, isLobby);
}
