/* ============================================================
   CASINO DESK: a focused, server-settled wager surface. The Activity rail
   keeps only odds and the last result; this modal owns the bet form.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { closeSurface, openSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";
import { emitWithTimeout } from "./clientRequestController.js";
import { casinoReelHTML, startCasinoReel, stopCasinoReel } from "./clientCasinoReel.js";

let host = { emitServer: noop, createRequestId: noop, renderRightRail: noop, say: noop, renderChat: noop };
function noop() {}
let casinoDraft = null;
let casinoResult = null;

function casino() {
  return state.economy?.casino || {};
}

function markPending(button) {
  if (!button || button.disabled) return false;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const label = button.querySelector(".cta-text, .t-label");
  if (label) {
    label.dataset.previousLabel = label.textContent;
    label.textContent = "PROCESSING…";
  }
  return true;
}

function clearPending(button) {
  if (!button) return;
  button.disabled = false;
  button.removeAttribute("aria-busy");
  const label = button.querySelector(".cta-text, .t-label");
  if (label?.dataset.previousLabel) {
    label.textContent = label.dataset.previousLabel;
    delete label.dataset.previousLabel;
  }
}

function mergeEconomySnapshot(response) {
  if (!response?.economy) return;
  const incoming = response.economy;
  state.economy = {
    ...state.economy,
    ...incoming,
    market: { ...state.economy.market, ...(incoming.market || {}) },
    casino: { ...state.economy.casino, ...(incoming.casino || {}) },
  };
}

function resultCopy(last) {
  if (!last) return "NO SPIN YET · THE HOUSE EDGE IS VISIBLE";
  const color = String(last.resultColor || "").toUpperCase();
  const pocket = Number(last.pocket || 0);
  const net = Number(last.net || 0);
  return `LAST SPIN · ${color} ${pocket} · ${net >= 0 ? "+" : ""}$${net.toLocaleString()}`;
}

function captureCasinoDraft(card) {
  const stake = card.querySelector("[name=casino-desk-stake]");
  if (!stake) return null;
  return {
    stake: stake.value,
    color: card.querySelector("input[name=casino-desk-color]:checked")?.value || "red",
  };
}

function casinoDeskHTML(limits) {
  const maxBet = Number(limits.maxBet || 500);
  const entryFee = Number(limits.entryFee || 0);
  return `<div class="casino-modal-body"><div class="casino-modal-head"><div><span class="t-micro g400">EUROPEAN WHEEL · SERVER SETTLED</span><h2 class="t-section g100" id="casino-modal-title">Casino Desk</h2><p class="t-body ink-2" id="casino-modal-description">Choose a disclosed pocket and stake fictional board cash. The server settles the result before any animation.</p></div><button class="btn-dark" type="button" id="casino-modal-close"><span class="t-label f11">CLOSE</span></button></div><div class="casino-odds" aria-label="Roulette odds"><span><strong>RED</strong><small>18 / 37 · 1:1</small></span><span><strong>BLACK</strong><small>18 / 37 · 1:1</small></span><span><strong class="green">GREEN 0</strong><small>1 / 37 · 35:1</small></span></div><form class="casino-form" data-casino-desk-form><fieldset><legend class="t-micro ink-3">SELECT POCKET</legend><div class="casino-choice-row"><label class="casino-choice casino-choice-red"><input type="radio" name="casino-desk-color" value="red" checked><span class="t-label f11">RED</span></label><label class="casino-choice casino-choice-black"><input type="radio" name="casino-desk-color" value="black"><span class="t-label f11">BLACK</span></label><label class="casino-choice casino-choice-green"><input type="radio" name="casino-desk-color" value="green"><span class="t-label f11">GREEN 0</span></label></div></fieldset><label class="casino-stake"><span class="t-micro ink-3">STAKE · MAX $${maxBet.toLocaleString()}${entryFee ? ` · EVENT FEE $${entryFee.toLocaleString()}` : ""}</span><input class="field" name="casino-desk-stake" type="number" min="1" max="${maxBet}" step="1" value="10" inputmode="numeric"></label><button class="cta-red" type="submit"><span class="cta-text cta-text-sm">SPIN THE WHEEL</span></button></form><div class="economy-result" aria-live="polite">${esc(resultCopy(limits.lastResult))}</div><p class="t-micro ink-3 economy-note">Fictional board money only. Loan-backed cash cannot enter the casino.</p></div>`;
}

function restoreCasinoDraft(card, maxBet) {
  if (!casinoDraft) return;
  const stake = card.querySelector("[name=casino-desk-stake]");
  if (stake && casinoDraft.stake != null) stake.value = Math.min(maxBet, Math.max(1, Math.floor(Number(casinoDraft.stake) || 1)));
  const color = card.querySelector(`input[name="casino-desk-color"][value="${casinoDraft.color}"]`);
  if (color) color.checked = true;
}

function applyCasinoResult(card, spinId) {
  if (!casinoResult) {
    delete card.dataset.casinoSpinId;
    return;
  }
  card.querySelector("[data-casino-desk-form]")?.insertAdjacentHTML("afterend", casinoReelHTML(casinoResult));
  card.dataset.casinoSpinId = spinId;
  card.querySelector(".economy-result")?.replaceChildren(document.createTextNode(resultCopy(casinoResult)));
  card.querySelector(".economy-result")?.setAttribute("aria-live", "off");
  startCasinoReel(card.querySelector("[data-casino-reel]"), casinoResult, {
    playTick: () => host.playSound?.("step"),
  });
}

function casinoReelIsCurrent(card, spinId) {
  return Boolean(spinId && card.dataset.casinoSpinId === spinId && card.querySelector("[data-casino-reel]"));
}

function populateCasinoModal(card, spinId) {
  casinoDraft = captureCasinoDraft(card) || casinoDraft;
  const limits = casino();
  const maxBet = Number(limits.maxBet || 500);
  card.innerHTML = casinoDeskHTML(limits);
  applyCasinoResult(card, spinId);
  restoreCasinoDraft(card, maxBet);
  card.querySelector("#casino-modal-close")?.addEventListener("click", closeCasinoDesk);
  card.querySelector("[data-casino-desk-form]")?.addEventListener("submit", onCasinoSubmit);
}

function renderCasinoModal() {
  const card = $("#casino-card");
  if (!card) return;
  const spinId = casinoResult?.spinId || casinoResult?.transactionId || "";
  if (casinoReelIsCurrent(card, spinId)) return;
  populateCasinoModal(card, spinId);
}

function casinoBetPayload(form) {
  return {
    color: form.querySelector("input[name=casino-desk-color]:checked")?.value || "red",
    stake: Math.max(1, Math.floor(Number(form.querySelector("[name=casino-desk-stake]")?.value) || 0)),
    requestId: host.createRequestId("casino")
  };
}

function casinoResponse(submit, response) {
  if (response?.success === false) {
    clearPending(submit);
    host.say(response.error || "Casino bet could not be completed.");
    host.renderChat();
    return;
  }
  mergeEconomySnapshot(response);
  casinoResult = response?.result || null;
  renderCasinoModal();
  host.renderRightRail();
}

function onCasinoSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type=submit]");
  if (!markPending(submit)) return;
  emitWithTimeout(host.emitServer, "place-casino-bet", casinoBetPayload(form), {
    onResponse: response => casinoResponse(submit, response),
    onTimeout: () => {
      clearPending(submit);
      host.say("Casino response timed out. Your result will refresh when the connection returns.");
      host.renderChat();
      host.refreshEconomySnapshot?.();
    }
  });
}

export function configureCasinoUi(hooks) {
  host = { ...host, ...hooks };
}

export function openCasinoDesk(trigger = null) {
  casinoDraft = null;
  casinoResult = null;
  renderCasinoModal();
  if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
  openSurface("#casino-modal", "#casino-modal-close");
}

export function closeCasinoDesk() {
  stopCasinoReel($("#casino-card")?.querySelector("[data-casino-reel]"));
  closeSurface("#casino-modal");
}

export function renderCasinoDeskIfOpen() {
  if (!$("#casino-modal") || $("#casino-modal").classList.contains("is-hidden")) return;
  renderCasinoModal();
}

export function bindCasinoUi() {
  $("#casino-scrim")?.addEventListener("click", closeCasinoDesk);
}
