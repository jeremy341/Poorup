/* ============================================================
   MARKET DESK: focused advanced-market workbench. The rail keeps a
   low-density quote summary; this surface owns only the fields needed for
   margin, shorting, and fully collateralized options.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { closeSurface, openSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";
import { emitWithTimeout } from "./clientRequestController.js";

let host = { emitServer: noop, createRequestId: noop, renderRightRail: noop, say: noop, renderChat: noop };
function noop() {}
let deskDraft = null;

const MARKET_LABELS = {
  brazil: "BRAZIL",
  ghana: "GHANA",
  thailand: "THAILAND",
  japan: "JAPAN",
  netherlands: "NETHERLANDS",
  canada: "CANADA",
  switzerland: "SWITZERLAND",
  singapore: "SINGAPORE",
  airports: "AIRPORTS",
  utilities: "UTILITIES",
  property: "PROPERTY",
};

function market() {
  return state.economy?.market || {};
}

function marketQuantity(card) {
  const raw = Number(card.querySelector("#market-desk-quantity")?.value) || 1;
  return Math.max(1, Math.min(1000, Math.floor(raw)));
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

function advancedActionsHTML(id, marketState, position) {
  const complexity = String(marketState.complexity || "basic").toLowerCase();
  const actions = [];
  if (["margin", "shorting", "derivatives"].includes(complexity)) actions.push(`<button class="btn-dark" type="button" data-market-advanced="open-margin" data-market-id="${id}"><span class="t-label f11">MARGIN</span></button>`);
  if (["shorting", "derivatives"].includes(complexity)) actions.push(`<button class="btn-dark" type="button" data-market-advanced="open-short" data-market-id="${id}"><span class="t-label f11">SHORT</span></button>`);
  if (Number(position?.quantity) > 0) actions.push(`<button class="btn-dark" type="button" data-market-advanced="cover-short" data-market-id="${id}"><span class="t-label f11">COVER</span></button>`);
  if (complexity === "derivatives") actions.push(`<button class="btn-dark" type="button" data-market-advanced="open-option" data-market-id="${id}"><span class="t-label f11">OPTION</span></button>`);
  const option = (marketState.options || []).find(entry => entry.instrumentId === id && entry.status === "open");
  if (option) {
    actions.push(`<button class="btn-dark" type="button" data-market-advanced="exercise-option" data-market-id="${id}" data-market-option-id="${esc(option.id)}"><span class="t-label f11">EXERCISE</span></button>`);
    actions.push(`<button class="btn-dark" type="button" data-market-advanced="close-position" data-market-id="${id}" data-market-option-id="${esc(option.id)}"><span class="t-label f11">CLOSE</span></button>`);
  }
  (marketState.options || [])
    .filter(entry => entry.instrumentId === id && entry.status === "open")
    .slice(1)
    .forEach(entry => {
      const optionId = esc(entry.id);
      actions.push('<button class="btn-dark" type="button" data-market-advanced="exercise-option" data-market-id="' + id + '" data-market-option-id="' + optionId + '"><span class="t-label f11">EXERCISE ' + optionId + '</span></button>');
      actions.push('<button class="btn-dark" type="button" data-market-advanced="close-position" data-market-id="' + id + '" data-market-option-id="' + optionId + '"><span class="t-label f11">CLOSE ' + optionId + '</span></button>');
    });
  return actions.join("");
}

function deskRowHTML(id, label, marketState) {
  const quote = Number(marketState.quotes?.[id] || 100);
  const position = marketState.positions?.[id] || {};
  const quantity = Math.max(0, Math.floor(Number(position.quantity) || 0));
  return `<div class="market-desk-row"><div><strong class="t-label f11 g100">${label}</strong><span class="t-micro ink-3">$${quote.toLocaleString()} · ${quantity} UNITS HELD</span></div><div class="market-desk-actions">${advancedActionsHTML(id, marketState, marketState.shorts?.positions?.[id])}</div></div>`;
}

function renderMarketDesk() {
  const card = $("#market-card");
  if (!card) return;
  const activeId = card.contains(document.activeElement) ? document.activeElement.id : "";
  const existingQuantity = card.querySelector("#market-desk-quantity");
  if (existingQuantity) {
    deskDraft = {
      quantity: existingQuantity.value,
      margin: card.querySelector("#market-desk-margin")?.value,
      strike: card.querySelector("#market-desk-strike")?.value,
      premium: card.querySelector("#market-desk-premium")?.value,
      expiry: card.querySelector("#market-desk-expiry")?.value,
      side: card.querySelector("#market-desk-side")?.value,
      role: card.querySelector("#market-desk-role")?.value,
    };
  }
  const marketState = market();
  const complexity = String(marketState.complexity || "basic").toUpperCase();
  const hasAdvanced = ["MARGIN", "SHORTING", "DERIVATIVES"].includes(complexity);
  const rows = Object.entries(MARKET_LABELS).map(([id, label]) => deskRowHTML(id, label, marketState)).join("");
  card.innerHTML = `<div class="market-desk-body"><div class="market-desk-head"><div><span class="t-micro g400">FICTIONAL EXCHANGE · ADVANCED DESK</span><h2 class="t-section g100" id="market-modal-title">Market Desk</h2><p class="t-body ink-2" id="market-modal-description">Review obligations before opening a leveraged or derivative position.</p></div><button class="btn-dark" type="button" id="market-modal-close"><span class="t-label f11">CLOSE</span></button></div><div class="market-desk-summary"><span class="t-micro ink-3">COMPLEXITY</span><strong class="t-label f12 g300">${complexity}</strong><span class="t-micro ink-3">FEE ${(Number(marketState.feeRate || 0.02) * 100).toFixed(0)}%</span></div><label class="market-desk-quantity"><span class="t-micro ink-3">ORDER QUANTITY</span><input class="field" id="market-desk-quantity" type="number" min="1" max="1000" value="1" inputmode="numeric"></label>${hasAdvanced ? '<div class="market-desk-tools"><label><span class="t-micro ink-3">REDUCE MARGIN</span><input class="field" id="market-desk-margin" type="number" min="1" value="50" inputmode="numeric"></label><button class="btn-dark" type="button" data-market-advanced="reduce-margin"><span class="t-label f11">REDUCE</span></button></div>' : ''}${complexity === "DERIVATIVES" ? '<div class="market-desk-option-fields"><label><span class="t-micro ink-3">STRIKE</span><input class="field" id="market-desk-strike" type="number" min="10" value="100" inputmode="numeric"></label><label><span class="t-micro ink-3">PREMIUM</span><input class="field" id="market-desk-premium" type="number" min="1" value="10" inputmode="numeric"></label><label><span class="t-micro ink-3">EXPIRY ROUNDS</span><input class="field" id="market-desk-expiry" type="number" min="1" max="20" value="3" inputmode="numeric"></label><label><span class="t-micro ink-3">SIDE</span><select class="field" id="market-desk-side"><option value="call">CALL</option><option value="put">PUT</option></select></label><label><span class="t-micro ink-3">POSITION</span><select class="field" id="market-desk-role"><option value="writer">WRITE · COLLATERALIZED</option><option value="buyer">BUY · PREMIUM</option></select></label></div>' : ''}<div class="market-desk-list thin-scroll">${rows}</div><p class="t-micro ink-3 economy-note">The server settles every action. Existing obligations can block an order before any cash moves.</p></div>`;
  const roleField = card.querySelector("#market-desk-role");
  if (roleField) roleField.innerHTML = '<option value="buyer">BUY · HOUSE UNDERWRITTEN</option>';
  if (deskDraft) {
    const values = { "#market-desk-quantity": deskDraft.quantity, "#market-desk-margin": deskDraft.margin, "#market-desk-strike": deskDraft.strike, "#market-desk-premium": deskDraft.premium, "#market-desk-expiry": deskDraft.expiry, "#market-desk-side": deskDraft.side, "#market-desk-role": deskDraft.role };
    Object.entries(values).forEach(([selector, value]) => { if (value != null && card.querySelector(selector)) card.querySelector(selector).value = value; });
    if (roleField && !roleField.value) roleField.value = "buyer";
  }
  card.querySelector("#market-modal-close")?.addEventListener("click", closeMarketDesk);
  card.querySelectorAll("[data-market-advanced]").forEach(button => button.addEventListener("click", () => onMarketAdvanced(button, card)));
  if (activeId) requestAnimationFrame(() => card.querySelector(`#${activeId}`)?.focus({ preventScroll: true }));
}

function onMarketAdvanced(button, card) {
  if (!markPending(button)) return;
  const action = button.dataset.marketAdvanced;
  const id = button.dataset.marketId;
  const quantity = marketQuantity(card);
  let eventName = "";
  let payload = { instrumentId: id, quantity, requestId: host.createRequestId(`market-${action}`) };
  if (action === "open-margin") eventName = "open-margin";
  else if (action === "reduce-margin") {
    eventName = "reduce-margin";
    payload = { amount: Math.max(1, Math.floor(Number(card.querySelector("#market-desk-margin")?.value) || 1)), requestId: host.createRequestId("market-reduce-margin") };
  } else if (action === "open-short") eventName = "open-short";
  else if (action === "cover-short") eventName = "cover-short";
  else if (action === "open-option") {
    eventName = "open-option";
    payload = {
      instrumentId: id,
      quantity,
      side: card.querySelector("#market-desk-side")?.value || "call",
      role: card.querySelector("#market-desk-role")?.value || "buyer",
      strike: Math.max(1, Math.floor(Number(card.querySelector("#market-desk-strike")?.value) || 100)),
      premium: Math.max(1, Math.floor(Number(card.querySelector("#market-desk-premium")?.value) || 10)),
      expiryRounds: Math.max(1, Math.min(20, Math.floor(Number(card.querySelector("#market-desk-expiry")?.value) || 3))),
      requestId: host.createRequestId("market-open-option"),
    };
  } else if (action === "exercise-option") {
    eventName = "exercise-option";
    payload = { optionId: button.dataset.marketOptionId, requestId: host.createRequestId("market-exercise") };
  } else if (action === "close-position") {
    eventName = "close-position";
    payload = { optionId: button.dataset.marketOptionId, requestId: host.createRequestId("market-close") };
  }
  if (!eventName) {
    clearPending(button);
    return;
  }
  emitWithTimeout(host.emitServer, eventName, payload, response => {
    if (response?.success === false) {
      clearPending(button);
      host.say(response.error || "Market position could not be updated.");
      host.renderChat();
      return;
    }
    mergeEconomySnapshot(response);
    renderMarketDesk();
    host.renderRightRail();
  }, {
    onTimeout: () => {
      clearPending(button);
      host.say("Market response timed out. Your ledger will refresh when the connection returns.");
      host.renderChat();
      host.refreshEconomySnapshot?.();
    }
  });
}

export function configureMarketUi(hooks) {
  host = { ...host, ...hooks };
}

export function openMarketDesk(trigger = null) {
  deskDraft = null;
  renderMarketDesk();
  if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
  openSurface("#market-modal", "#market-modal-close");
}

export function closeMarketDesk() {
  closeSurface("#market-modal");
}

export function renderMarketDeskIfOpen() {
  if (!$("#market-modal") || $("#market-modal").classList.contains("is-hidden")) return;
  renderMarketDesk();
}

export function bindMarketUi() {
  $("#market-scrim")?.addEventListener("click", closeMarketDesk);
}
