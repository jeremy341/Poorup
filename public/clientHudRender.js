// HUD RENDERING: current player, local cash, dice and turn actions. Reads come from clientState;
// end-of-countdown game actions arrive via hooks.
import { $, REDUCED_MOTION, setHtml, setText } from "./clientDom.js";
import { state } from "./clientState.js";

// Injected by main.js (existing playSound); the HUD never owns an audio engine.
let hudSound = () => {};
export function configureHudSound(playSound) {
  hudSound = typeof playSound === "function" ? playSound : () => {};
}

// CASH FEEDBACK (the viewing player's own cash only, client-side): a 300ms stepped number tween,
// a short green/red flash and a floating +$X / -$X chip. The first paint, a seat change or leaving
// the table resets silently so hydration never fires effects.
const CASH_TWEEN_MS = 300;
const CASH_TWEEN_STEPS = 6;
const CASH_FLASH_MS = 340;
const CASH_CHIP_MS = 1100;
const MAX_CASH_CHIPS = 3;
const cashFx = { owner: null, shown: null, target: null, tweenTimer: null, flashTimer: null };

function formatCash(value) {
  return `$${Number(value).toLocaleString()}`;
}

function stopCashTween() {
  clearInterval(cashFx.tweenTimer);
  cashFx.tweenTimer = null;
}

function resetCashFx(owner, value) {
  stopCashTween();
  cashFx.owner = owner;
  cashFx.shown = value;
  cashFx.target = value;
}

function startCashTween(el, from) {
  stopCashTween();
  let step = 0;
  cashFx.tweenTimer = setInterval(() => {
    step += 1;
    const done = step >= CASH_TWEEN_STEPS;
    cashFx.shown = done ? cashFx.target : Math.round(from + ((cashFx.target - from) * step) / CASH_TWEEN_STEPS);
    setText(el, formatCash(cashFx.shown));
    if (done) stopCashTween();
  }, CASH_TWEEN_MS / CASH_TWEEN_STEPS);
}

function flashCash(el, delta) {
  clearTimeout(cashFx.flashTimer);
  el.classList.remove("is-cash-up", "is-cash-down");
  void el.offsetWidth;
  el.classList.add(delta > 0 ? "is-cash-up" : "is-cash-down");
  cashFx.flashTimer = setTimeout(() => el.classList.remove("is-cash-up", "is-cash-down"), CASH_FLASH_MS);
}

function floatCashChip(delta) {
  const host = $("#hud-cash-action");
  if (!host) return;
  const chip = document.createElement("span");
  chip.className = `cash-chip${delta < 0 ? " is-loss" : ""}`;
  chip.setAttribute("aria-hidden", "true");
  chip.textContent = `${delta > 0 ? "+" : "-"}$${Math.abs(delta).toLocaleString()}`;
  host.append(chip);
  const chips = host.querySelectorAll(".cash-chip");
  for (let i = 0; i < chips.length - MAX_CASH_CHIPS; i++) chips[i].remove();
  chip.addEventListener("animationend", () => chip.remove());
  setTimeout(() => chip.remove(), CASH_CHIP_MS);
}

function renderHudCash(me, waiting) {
  const el = $("#hud-cash");
  if (!el) return;
  const value = waiting ? 0 : Number(me?.visualCash ?? me?.cash ?? 0);
  const owner = waiting || !me ? null : me.id;
  if (owner === null || owner !== cashFx.owner) {
    resetCashFx(owner, value);
    setText(el, formatCash(value));
    return;
  }
  if (value === cashFx.target) {
    if (cashFx.tweenTimer === null) setText(el, formatCash(value));
    return;
  }
  const delta = value - cashFx.target;
  cashFx.target = value;
  hudSound(delta > 0 ? "cash" : "spend");
  if (REDUCED_MOTION) {
    resetCashFx(owner, value);
    setText(el, formatCash(value));
    return;
  }
  flashCash(el, delta);
  floatCashChip(delta);
  startCashTween(el, cashFx.shown);
}

const DIE_PIPS = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

const DICE_FACE_TICK_MS = 80;
let diceFaceTimer = null;
let rollingFaces = [1, 1];

function stopDiceFaceCycle() {
  if (diceFaceTimer !== null) clearInterval(diceFaceTimer);
  diceFaceTimer = null;
}

function nextRollingFace(previous) {
  // The cosmetic roll must not affect the server-authoritative result.
  return ((previous - 1 + 1 + Math.floor(Math.random() * 5)) % 6) + 1;
}

function paintRollingFaces() {
  const dice = $("#hud-dice")?.querySelectorAll(".die");
  if (dice?.length !== 2) return;
  rollingFaces = rollingFaces.map(nextRollingFace);
  dice.forEach((die, index) => {
    const pips = DIE_PIPS[rollingFaces[index]];
    die.querySelectorAll("span").forEach((cell, i) => {
      cell.classList.toggle("on", pips.some(([x, y]) => x === i % 3 && y === Math.floor(i / 3)));
    });
  });
}

export function dieHTML(value, rolling) {
  const pips = DIE_PIPS[value] || DIE_PIPS[1];
  let cells = "";
  for (let i = 0; i < 9; i++) {
    const cx = i % 3;
    const cy = Math.floor(i / 3);
    cells += `<span class="${pips.some(([x, y]) => x === cx && y === cy) ? "on" : ""}"></span>`;
  }
  const label = rolling ? "Die: rolling" : `Die: ${DIE_PIPS[value] ? value : 1}`;
  return `<div class="die${rolling ? " dice-rolling" : ""}" role="img" aria-label="${label}">${cells}</div>`;
}

const BLANK_DICE_HTML = `<div class="die-blank" role="img" aria-label="Die: not rolled yet">-</div><div class="die-blank" role="img" aria-label="Die: not rolled yet">-</div>`;

function localPlayer() {
  return (state.clientId && state.players.find(player => player.clientId === state.clientId))
    || state.players.find(player => player.id === "p1")
    || state.players[0]
    || null;
}

function renderHudLobby() {
  setText($("#hud-turn-label"), "In Lobby");
  const nameEl = $("#hud-name");
  setText(nameEl, "Configure");
  nameEl.style.color = "#cfa75f";
  $("#hud-turn-label").removeAttribute("aria-label");
  resetCashFx(null, null);
  setText($("#hud-cash"), `$${Number(state.settings.startingCash).toLocaleString()}`);
  if ($("#hud-cash-action")) $("#hud-cash-action").disabled = true;
  setText($("#hud-pool"), "$0");
  stopDiceFaceCycle();
  setHtml($("#hud-dice"), BLANK_DICE_HTML);
  $("#roll-btn").disabled = true;
  // Matches the rules rail: the host starts from Start Round there, other seats wait for the host.
  setText($("#roll-label"), state.players[0]?.isHost ? "Press Start Round" : "Host Starts Round");
  renderHudJailButtons(null, true, true);
  renderHudFlightButton(true, true);
}

function renderHudDice(waiting) {
  const container = $("#hud-dice");
  if (waiting) {
    stopDiceFaceCycle();
    setHtml(container, BLANK_DICE_HTML);
    return;
  }
  const animateFaces = state.rolling && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!animateFaces) {
    stopDiceFaceCycle();
    setHtml(container, dieHTML(state.dice[0], false) + dieHTML(state.dice[1], false));
    return;
  }
  if (diceFaceTimer === null || container.querySelectorAll(".die.dice-rolling").length !== 2) {
    stopDiceFaceCycle();
    rollingFaces = [1, 1];
    container.innerHTML = dieHTML(1, true) + dieHTML(1, true);
    paintRollingFaces();
    diceFaceTimer = setInterval(paintRollingFaces, DICE_FACE_TICK_MS);
  }
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
  // A dismissed auction card likewise reopens from this button.
  const reopensAuction = Boolean(state.auction) && !state.players[0]?.bankrupt && !state.players[0]?.spectating;
  btn.disabled = state.presentationBusy ? true : (state.pendingBuyTile != null || reopensAuction) ? false : !(canRoll || canEnd);
  setText($("#roll-label"), hudRollLabel(waiting, canRoll, canEnd));
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

// FLY FROM HERE shows only when the server priced at least one flight for the
// local player, i.e. it is their turn, they stand on an airport and have not moved.
function renderHudFlightButton(waiting, isLobby) {
  const flyBtn = $("#open-flight-desk");
  if (!flyBtn) return;
  const available = !waiting && !isLobby && humanTurnNow() && state.turnStage === "roll"
    && !hudControlsLocked() && (state.flights?.options?.length || 0) > 0;
  flyBtn.classList.toggle("is-hidden", !available);
  flyBtn.disabled = state.busy || state.presentationBusy;
}

// FIRST-TURN COACH: one small tip for a cold player, shown on their first own turn only. It is
// dismissible, never shown for bot turns, and retires for good (localStorage) once dismissed or once
// that first turn has ended. It never takes focus: the roll button stays the first control.
const COACH_SEEN_KEY = "poorup-coach-seen-v1";
let coachSeenThisPage = false;
let coachOffered = false;

function coachAlreadySeen() {
  if (coachSeenThisPage) return true;
  try { return localStorage.getItem(COACH_SEEN_KEY) === "1"; } catch { return false; }
}

function retireTurnCoach() {
  coachSeenThisPage = true;
  try { localStorage.setItem(COACH_SEEN_KEY, "1"); } catch { /* storage may be unavailable; the page flag still holds */ }
}

function setCoachVisible(coach, visible) {
  if (coach.hidden === !visible) return;
  coach.hidden = !visible;
}

function renderTurnCoach() {
  const coach = $("#turn-coach");
  if (!coach) return;
  if (coachAlreadySeen()) {
    setCoachVisible(coach, false);
    return;
  }
  if (state.phase !== "playing") {
    setCoachVisible(coach, false);
    return;
  }
  if (humanTurnNow() && (coachOffered || state.turnStage === "roll")) {
    coachOffered = true;
    setCoachVisible(coach, true);
    return;
  }
  // The offered turn is over (or the seat is out): the tip has done its job.
  if (coachOffered) retireTurnCoach();
  setCoachVisible(coach, false);
}

export function dismissTurnCoach() {
  retireTurnCoach();
  const coach = $("#turn-coach");
  if (!coach) return;
  const hadFocus = coach.contains(document.activeElement);
  setCoachVisible(coach, false);
  const rollBtn = $("#roll-btn");
  if (hadFocus && rollBtn && !rollBtn.disabled) rollBtn.focus({ preventScroll: true });
}

export function renderHud() {
  const waiting = state.phase !== "playing";
  const isLobby = state.phase === "lobby";
  const cur = state.players[state.turnIndex] || null;
  const me = localPlayer();

  renderTurnCoach();
  if (isLobby) {
    renderHudLobby();
    return;
  }

  setText($("#hud-turn-label"), waiting ? "Waiting For Game" : "Current Turn");
  $("#hud-turn-label").setAttribute("aria-label", waiting ? "Waiting for game" : `Current turn: ${cur?.name || "Syncing"}`);
  const nameEl = $("#hud-name");
  setText(nameEl, waiting ? "Stand By" : cur?.name || "Syncing…");
  nameEl.style.color = waiting ? "#cfa75f" : cur?.textColor || "#cfa75f";
  renderHudCash(me, waiting);
  if ($("#hud-cash-action")) {
    $("#hud-cash-action").disabled = waiting || !me;
    $("#hud-cash-action").setAttribute("aria-label", me ? `Open ${me.name}'s wallet and items` : "Open wallet and items");
  }
  setText($("#hud-pool"), `$${waiting ? 0 : state.pool}`);
  renderHudDice(waiting);
  renderHudRollButton(waiting);
  renderHudJailButtons(cur, waiting || !cur, isLobby);
  renderHudFlightButton(waiting, isLobby);
}
