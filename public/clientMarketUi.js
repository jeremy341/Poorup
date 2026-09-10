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

function marketComplexityRank(value) {
  const complexity = String(value || "basic").toLowerCase();
  return { basic: 0, margin: 1, shorting: 2, derivatives: 3 }[complexity] || 0;
}

function marketActionButton(action, id, label, optionId = null) {
  const optionAttribute = optionId ? ` data-market-option-id="${esc(optionId)}"` : "";
  return `<button class="btn-dark" type="button" data-market-advanced="${action}" data-market-id="${id}"${optionAttribute}><span class="t-label f11">${label}</span></button>`;
}

function advancedActionsHTML(id, marketState, position) {
  const rank = marketComplexityRank(marketState.complexity);
  const actions = [
    { enabled: rank >= 1, action: "open-margin", label: "MARGIN" },
    { enabled: rank >= 2, action: "open-short", label: "SHORT" },
    { enabled: Number(position?.quantity) > 0, action: "cover-short", label: "COVER" },
    { enabled: rank >= 3, action: "open-option", label: "OPTION" },
  ]
    .filter(entry => entry.enabled)
    .map(entry => marketActionButton(entry.action, id, entry.label));
  const options = (marketState.options || []).filter(entry => entry.instrumentId === id && entry.status === "open");
  options.forEach((option, index) => {
    const optionId = String(option.id || "");
    const suffix = index ? ` ${esc(optionId)}` : "";
    actions.push(marketActionButton("exercise-option", id, `EXERCISE${suffix}`, optionId));
    actions.push(marketActionButton("close-position", id, `CLOSE${suffix}`, optionId));
  });
  return actions.join("");
}

function deskRowHTML(id, label, marketState) {
  const quote = Number(marketState.quotes?.[id] || 100);
  const position = marketState.positions?.[id] || {};
  const quantity = Math.max(0, Math.floor(Number(position.quantity) || 0));
  return `<div class="market-desk-row"><div><strong class="t-label f11 g100">${label}</strong><span class="t-micro ink-3">$${quote.toLocaleString()} · ${quantity} UNITS HELD</span></div><div class="market-desk-actions">${advancedActionsHTML(id, marketState, marketState.shorts?.positions?.[id])}</div></div>`;
}

function captureDeskDraft(card) {
  const quantity = card.querySelector("#market-desk-quantity");
  if (!quantity) return null;
  return {
    quantity: quantity.value,
    margin: card.querySelector("#market-desk-margin")?.value,
    strike: card.querySelector("#market-desk-strike")?.value,
    premium: card.querySelector("#market-desk-premium")?.value,
    expiry: card.querySelector("#market-desk-expiry")?.value,
    side: card.querySelector("#market-desk-side")?.value,
    role: card.querySelector("#market-desk-role")?.value,
  };
}

function marketToolsHTML(hasAdvanced) {
  if (!hasAdvanced) return "";
  return '<div class="market-desk-tools"><label><span class="t-micro ink-3">REDUCE MARGIN</span><input class="field" id="market-desk-margin" type="number" min="1" value="50" inputmode="numeric"></label><button class="btn-dark" type="button" data-market-advanced="reduce-margin"><span class="t-label f11">REDUCE</span></button></div>';
}

function marketOptionFieldsHTML(isDerivatives) {
  if (!isDerivatives) return "";
  return '<div class="market-desk-option-fields"><label><span class="t-micro ink-3">STRIKE</span><input class="field" id="market-desk-strike" type="number" min="10" value="100" inputmode="numeric"></label><label><span class="t-micro ink-3">PREMIUM</span><input class="field" id="market-desk-premium" type="number" min="1" value="10" inputmode="numeric"></label><label><span class="t-micro ink-3">EXPIRY ROUNDS</span><input class="field" id="market-desk-expiry" type="number" min="1" max="20" value="3" inputmode="numeric"></label><label><span class="t-micro ink-3">SIDE</span><select class="field" id="market-desk-side"><option value="call">CALL</option><option value="put">PUT</option></select></label><label><span class="t-micro ink-3">POSITION</span><select class="field" id="market-desk-role"><option value="writer">WRITE · COLLATERALIZED</option><option value="buyer">BUY · PREMIUM</option></select></label></div>';
}

function marketDeskHTML(marketState, rows) {
  const complexity = String(marketState.complexity || "basic").toUpperCase();
  const hasAdvanced = marketComplexityRank(complexity) >= 1;
  return `<div class="market-desk-body"><div class="market-desk-head"><div><span class="t-micro g400">FICTIONAL EXCHANGE · ADVANCED DESK</span><h2 class="t-section g100" id="market-modal-title">Market Desk</h2><p class="t-body ink-2" id="market-modal-description">Review obligations before opening a leveraged or derivative position.</p></div><button class="btn-dark" type="button" id="market-modal-close"><span class="t-label f11">CLOSE</span></button></div><div class="market-desk-summary"><span class="t-micro ink-3">COMPLEXITY</span><strong class="t-label f12 g300">${complexity}</strong><span class="t-micro ink-3">FEE ${(Number(marketState.feeRate || 0.02) * 100).toFixed(0)}%</span></div><label class="market-desk-quantity"><span class="t-micro ink-3">ORDER QUANTITY</span><input class="field" id="market-desk-quantity" type="number" min="1" max="1000" value="1" inputmode="numeric"></label>${marketToolsHTML(hasAdvanced)}${marketOptionFieldsHTML(complexity === "DERIVATIVES")}<div class="market-desk-list thin-scroll">${rows}</div><p class="t-micro ink-3 economy-note">The server settles every action. Existing obligations can block an order before any cash moves.</p></div>`;
}

function restoreDeskDraft(card) {
  if (!deskDraft) return;
  const values = {
    "#market-desk-quantity": deskDraft.quantity,
    "#market-desk-margin": deskDraft.margin,
    "#market-desk-strike": deskDraft.strike,
    "#market-desk-premium": deskDraft.premium,
    "#market-desk-expiry": deskDraft.expiry,
    "#market-desk-side": deskDraft.side,
    "#market-desk-role": deskDraft.role,
  };
  Object.entries(values).forEach(([selector, value]) => {
    const field = card.querySelector(selector);
    if (value != null && field) field.value = value;
  });
  const roleField = card.querySelector("#market-desk-role");
  if (roleField) {
    roleField.innerHTML = '<option value="buyer">BUY · HOUSE UNDERWRITTEN</option>';
    if (!roleField.value) roleField.value = "buyer";
  }
}

function bindMarketDesk(card) {
  card.querySelector("#market-modal-close")?.addEventListener("click", closeMarketDesk);
  card.querySelectorAll("[data-market-advanced]").forEach(button => button.addEventListener("click", () => onMarketAdvanced(button, card)));
}

function renderMarketDesk() {
  const card = $("#market-card");
  if (!card) return;
  const activeId = card.contains(document.activeElement) ? document.activeElement.id : "";
  deskDraft = captureDeskDraft(card) || deskDraft;
  const marketState = market();
  const rows = Object.entries(MARKET_LABELS).map(([id, label]) => deskRowHTML(id, label, marketState)).join("");
  card.innerHTML = marketDeskHTML(marketState, rows);
  restoreDeskDraft(card);
  bindMarketDesk(card);
  if (activeId) requestAnimationFrame(() => card.querySelector(`#${activeId}`)?.focus({ preventScroll: true }));
}

function numericField(card, selector, { fallback, minimum, maximum = Number.POSITIVE_INFINITY }) {
  const value = Math.floor(Number(card.querySelector(selector)?.value) || fallback);
  return Math.max(minimum, Math.min(maximum, value));
}

function selectField(card, selector, fallback) {
  return card.querySelector(selector)?.value || fallback;
}

function marketActionContext(button, card) {
  return {
    id: button.dataset.marketId,
    optionId: button.dataset.marketOptionId,
    quantity: marketQuantity(card),
    margin: numericField(card, "#market-desk-margin", { fallback: 1, minimum: 1 }),
    side: selectField(card, "#market-desk-side", "call"),
    role: selectField(card, "#market-desk-role", "buyer"),
    strike: numericField(card, "#market-desk-strike", { fallback: 100, minimum: 1 }),
    premium: numericField(card, "#market-desk-premium", { fallback: 10, minimum: 1 }),
    expiryRounds: numericField(card, "#market-desk-expiry", { fallback: 3, minimum: 1, maximum: 20 }),
  };
}

function simpleMarketRequest(eventName, prefix, context) {
  return { eventName, payload: { instrumentId: context.id, quantity: context.quantity, requestId: host.createRequestId(prefix) } };
}

const MARKET_ACTION_REQUESTS = {
  "open-margin": context => simpleMarketRequest("open-margin", "market-open-margin", context),
  "open-short": context => simpleMarketRequest("open-short", "market-open-short", context),
  "cover-short": context => simpleMarketRequest("cover-short", "market-cover-short", context),
  "reduce-margin": context => ({ eventName: "reduce-margin", payload: { amount: context.margin, requestId: host.createRequestId("market-reduce-margin") } }),
  "open-option": context => ({ eventName: "open-option", payload: { instrumentId: context.id, quantity: context.quantity, side: context.side, role: context.role, strike: context.strike, premium: context.premium, expiryRounds: context.expiryRounds, requestId: host.createRequestId("market-open-option") } }),
  "exercise-option": context => ({ eventName: "exercise-option", payload: { optionId: context.optionId, requestId: host.createRequestId("market-exercise") } }),
  "close-position": context => ({ eventName: "close-position", payload: { optionId: context.optionId, requestId: host.createRequestId("market-close") } }),
};

function requestForMarketAction(action, button, card) {
  const context = marketActionContext(button, card);
  return MARKET_ACTION_REQUESTS[action]?.(context) || null;
}

function marketActionResponse(button, response) {
  if (response?.success === false) {
    clearPending(button);
    host.say(response.error || "Market position could not be updated.");
    host.renderChat();
    return;
  }
  mergeEconomySnapshot(response);
  renderMarketDesk();
  host.renderRightRail();
}

function onMarketAdvanced(button, card) {
  if (!markPending(button)) return;
  const request = requestForMarketAction(button.dataset.marketAdvanced, button, card);
  if (!request) {
    clearPending(button);
    return;
  }
  emitWithTimeout(host.emitServer, request.eventName, request.payload, {
    onResponse: response => marketActionResponse(button, response),
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
