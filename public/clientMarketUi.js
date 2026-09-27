/* ============================================================
   MARKET DESK: focused advanced-market workbench. The rail keeps a
   low-density quote summary; this surface owns only the fields needed for
   margin, shorting, and fully collateralized options.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { closeSurface, openSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";
import { emitWithTimeout } from "./clientRequestController.js";
import { hydrateAnalyticsChart, disposeAnalyticsChart } from "./clientAnalyticsChartAdapter.js";
import { createPoorupChartOptions, resolvePoorupChartTokens } from "./clientAnalyticsChartTheme.js";

let host = { emitServer: noop, createRequestId: noop, renderRightRail: noop, say: noop, renderChat: noop, captureActionStatusNode: () => null, announceActionStatus: noop };
function noop() {}
let deskDraft = null;
let selectedIndex = "brazil";
let chartContainer = null;
let marketModalObserver = null;

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

export function selectedMarketPoints(marketState, id = selectedIndex) {
  return (Array.isArray(marketState.quoteHistory) ? marketState.quoteHistory : [])
    .filter(point => Number.isFinite(Number(point?.round)) && Number.isFinite(Number(point?.quotes?.[id])))
    .map(point => ({ round: Number(point.round), value: Number(point.quotes[id]), eventId: point.eventId || null }));
}

export function marketPreview(marketState, id, quantity, side) {
  const quote = Math.max(0, Math.floor(Number(marketState.quotes?.[id]) || 0));
  const gross = quote * quantity;
  const fee = Math.max(1, Math.ceil(gross * 0.02));
  return { quote, gross, fee, net: side === "sell" ? gross - fee : gross + fee };
}

export function marketPositionSummary(marketState, id) {
  const position = marketState.positions?.[id] || {};
  const quantity = Math.max(0, Math.floor(Number(position.quantity) || 0));
  const averageCostPerUnit = Math.max(0, Number(position.averageCost) || 0);
  const quote = Math.max(0, Number(marketState.quotes?.[id]) || 0);
  return {
    quantity,
    averageCostPerUnit,
    unrealizedPnl: (quote - averageCostPerUnit) * quantity,
    realizedPnl: Number(position.realizedPnl) || 0,
  };
}

export function personalMarketMarkers(marketState, id) {
  const ledger = Array.isArray(marketState.personalTrades) ? marketState.personalTrades : [];
  return ledger.filter(entry => entry?.instrumentId === id && ["buy", "sell"].includes(entry.side));
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
  ]
    .filter(entry => entry.enabled)
    .map(entry => marketActionButton(entry.action, id, entry.label));
  const policy = marketState.pricingPolicy;
  if (policy?.serverOwned === true) {
    const options = (marketState.options || []).filter(entry => entry.instrumentId === id && entry.status === "open");
    options.forEach((option, index) => {
      const optionId = String(option.id || "");
      const suffix = index ? ` ${esc(optionId)}` : "";
      actions.push(marketActionButton("exercise-option", id, `EXERCISE${suffix}`, optionId));
      actions.push(marketActionButton("close-position", id, `CLOSE${suffix}`, optionId));
    });
  }
  if (rank >= 3) actions.push(policy?.serverOwned === true ? marketActionButton("open-option", id, "OPTION") : '<span class="market-derivatives-unavailable" role="status">DERIVATIVES UNAVAILABLE · SERVER PRICING POLICY NOT CONFIGURED</span>');
  if (policy?.serverOwned !== true) return actions.join("");
  return actions.join("");
}

function deskRowHTML(id, label, marketState) {
  const quote = Number(marketState.quotes?.[id] || 100);
  const position = marketState.positions?.[id] || {};
  const quantity = Math.max(0, Math.floor(Number(position.quantity) || 0));
  const rank = marketComplexityRank(marketState.complexity);
  const actions = advancedActionsHTML(id, marketState, marketState.shorts?.positions?.[id]);
  const advanced = rank >= 1 ? `<details class="market-advanced-disclosure"><summary>ADVANCED OBLIGATIONS</summary><div class="market-desk-actions">${actions || '<span class="t-micro ink-3">No advanced actions available.</span>'}</div></details>` : "";
  return `<div class="market-desk-row"><div><strong class="t-label f11 g100">${label}</strong><span class="t-micro ink-3">$${quote.toLocaleString()} · ${quantity} UNITS HELD</span></div>${advanced}</div>`;
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
  const labels = Object.entries(MARKET_LABELS).map(([id, label]) => `<option value="${id}"${id === selectedIndex ? " selected" : ""}>${label}</option>`).join("");
  const position = marketPositionSummary(marketState, selectedIndex);
  const quantity = Math.max(1, Math.floor(Number(deskDraft?.quantity) || 1));
  const preview = marketPreview(marketState, selectedIndex, quantity, deskDraft?.side || "buy");
  const points = selectedMarketPoints(marketState);
  const markers = personalMarketMarkers(marketState, selectedIndex);
  const advancedTools = hasAdvanced
    ? `<details class="market-advanced-settings"><summary>ADVANCED POSITION MANAGEMENT</summary>${marketToolsHTML(true)}${marketOptionFieldsHTML(complexity === "DERIVATIVES" && marketState.pricingPolicy?.serverOwned === true)}</details>`
    : "";
  const historyRows = points.map(point => `<tr><th scope="row">Round ${point.round}</th><td>$${point.value.toLocaleString()}</td><td>${point.eventId ? `Global event: ${esc(point.eventId)}` : "—"}</td></tr>`).join("");
  const ledgerCopy = markers.map(entry => `<li>Round ${Number(entry.roundNumber) || "?"}: ${String(entry.side).toUpperCase()} ${Number(entry.quantity) || 0} at $${Number(entry.quote) || 0}</li>`).join("");
  const signedPnl = position.unrealizedPnl > 0
    ? `+$${position.unrealizedPnl.toLocaleString()}`
    : position.unrealizedPnl < 0 ? `-$${Math.abs(position.unrealizedPnl).toLocaleString()}` : "$0";
  return `<div class="market-desk-body">
    <div class="market-desk-head"><div><span class="t-micro g400">FICTIONAL EXCHANGE · MARKET DESK</span><h2 class="t-section g100" id="market-modal-title">Market Desk</h2><p class="t-body ink-2" id="market-modal-description">Round drift and global events change the shared index price. Your orders change only your holdings and P&amp;L.</p></div><button class="btn-dark" type="button" id="market-modal-close"><span class="t-label f11">CLOSE</span></button></div>
    <div class="market-desk-summary"><span class="t-micro ink-3">COMPLEXITY</span><strong class="t-label f12 g300">${complexity}</strong><span class="t-micro ink-3">FEE 2% · MINIMUM $1</span></div>
    <label class="market-index-select"><span class="t-micro ink-3">SELECT INDEX</span><select class="field" id="market-desk-index">${labels}</select></label>
    <section class="market-history" aria-labelledby="market-history-title"><h3 id="market-history-title" class="t-label f11 g100">${MARKET_LABELS[selectedIndex]} · SHARED PRICE HISTORY</h3><div class="market-quote-chart" data-market-quote-chart role="img" aria-label="Shared quote history chart"></div>${points.length ? `<div class="market-history-table thin-scroll" tabindex="0"><table class="analytics-chart-table"><caption>Round and shared quote history for ${MARKET_LABELS[selectedIndex]}</caption><thead><tr><th scope="col">Round</th><th scope="col">Quote</th><th scope="col">Global event</th></tr></thead><tbody>${historyRows}</tbody></table></div>` : '<p class="market-history-empty" role="status">No quote history is available yet. The current shared quote is shown below.</p>'}<div class="t-micro ink-3">${ledgerCopy.length ? `<span>Your trades:</span><ul>${ledgerCopy}</ul>` : "No personal trades to mark on this chart yet."}</div></section>
    <div class="market-holding"><span>HELD ${position.quantity} UNITS</span><span>AVERAGE COST PER UNIT $${position.averageCostPerUnit.toLocaleString()}</span><span>UNREALIZED P&amp;L ${signedPnl}</span><span>REALIZED P&amp;L $${position.realizedPnl.toLocaleString()}</span></div>
    <label class="market-desk-quantity"><span class="t-micro ink-3">ORDER QUANTITY</span><input class="field" id="market-desk-quantity" type="number" min="1" max="1000" value="${quantity}" inputmode="numeric"></label>
    <div class="market-order-controls"><label><span class="t-micro ink-3">ACTION</span><select class="field" id="market-desk-side"><option value="buy">BUY</option><option value="sell"${deskDraft?.side === "sell" ? " selected" : ""}>SELL</option></select></label><p data-market-preview>QUOTE $${preview.quote.toLocaleString()} · GROSS $${preview.gross.toLocaleString()} · FEE $${preview.fee.toLocaleString()} · ${deskDraft?.side === "sell" ? "NET PROCEEDS" : "TOTAL DUE"} $${preview.net.toLocaleString()}</p><button class="btn-dark" type="button" data-market-basic-order data-market-id="${selectedIndex}" data-market-side="${deskDraft?.side || "buy"}"><span class="t-label f11">${(deskDraft?.side || "buy").toUpperCase()} INDEX</span></button></div>
    ${advancedTools}<div class="market-desk-list thin-scroll">${rows}</div><p class="t-micro ink-3 economy-note">The server settles every action. Existing obligations can block an order before any cash moves.</p>
  </div>`;
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
}

function bindMarketDesk(card) {
  card.querySelector("#market-modal-close")?.addEventListener("click", closeMarketDesk);
  card.querySelectorAll("[data-market-advanced]").forEach(button => button.addEventListener("click", () => onMarketAdvanced(button, card)));
  card.querySelector("#market-desk-index")?.addEventListener("change", event => { selectedIndex = event.currentTarget.value; renderMarketDesk(); });
  for (const selector of ["#market-desk-quantity", "#market-desk-side"]) {
    card.querySelector(selector)?.addEventListener("input", () => updateMarketPreview(card));
    card.querySelector(selector)?.addEventListener("change", () => updateMarketPreview(card));
  }
  card.querySelector("[data-market-basic-order]")?.addEventListener("click", event => onMarketBasicOrder(event.currentTarget, card));
}

function updateMarketPreview(card) {
  deskDraft = captureDeskDraft(card) || deskDraft;
  const side = deskDraft?.side || "buy";
  const preview = marketPreview(market(), selectedIndex, marketQuantity(card), side);
  const node = card.querySelector("[data-market-preview]");
  if (node) node.textContent = `QUOTE $${preview.quote.toLocaleString()} · GROSS $${preview.gross.toLocaleString()} · FEE $${preview.fee.toLocaleString()} · ${side === "sell" ? "NET PROCEEDS" : "TOTAL DUE"} $${preview.net.toLocaleString()}`;
  const button = card.querySelector("[data-market-basic-order]");
  if (button) {
    button.dataset.marketSide = side;
    const label = button.querySelector(".t-label");
    if (label) label.textContent = `${side.toUpperCase()} INDEX`;
  }
}

function renderMarketQuoteChart(card, marketState) {
  const container = card.querySelector("[data-market-quote-chart]");
  const points = selectedMarketPoints(marketState);
  if (!container || !points.length) return;
  const chartPoints = points.map(point => ({ label: `R${point.round}`, value: point.value }));
  const pointAtRound = round => points.find(point => point.round === round);
  const eventMarkers = points.filter(point => point.eventId).map(point => ({ name: `EVENT · ${point.eventId}`, coord: [`R${point.round}`, point.value], value: "EVENT" }));
  const orderMarkers = personalMarketMarkers(marketState, selectedIndex).flatMap(entry => {
    const point = pointAtRound(Number(entry.roundNumber));
    return point ? [{ name: `YOUR ${String(entry.side).toUpperCase()}`, coord: [`R${point.round}`, point.value], value: String(entry.side).toUpperCase() }] : [];
  });
  if (!chartContainer) chartContainer = container;
  const options = createPoorupChartOptions(chartPoints, { mode: "line", title: `${MARKET_LABELS[selectedIndex]} shared quote history`, unit: "dollars", tokens: resolvePoorupChartTokens() });
  options.series[0].markPoint = {
    symbol: "rect", symbolSize: 12,
    data: [...eventMarkers, ...orderMarkers],
    itemStyle: { color: "var(--analytics-warning)", borderColor: "var(--theme-focus)", borderWidth: 1 },
    label: { show: false },
  };
  void hydrateAnalyticsChart(container, chartPoints, { mode: "line", title: `${MARKET_LABELS[selectedIndex]} shared quote history`, unit: "dollars", tokens: resolvePoorupChartTokens() })
    .then(chart => {
      if (!container.isConnected || !card.isConnected || !card.closest("#market-modal") || card.closest("#market-modal").classList.contains("is-hidden")) {
        chart?.dispose?.();
        return;
      }
      chart?.instance?.setOption?.(options, { notMerge: true, lazyUpdate: false });
    }).catch(() => { container.textContent = "Chart unavailable. Shared quote values remain available in the table."; });
}

function onMarketBasicOrder(button, card) {
  if (!markPending(button)) return;
  const statusNode = host.captureActionStatusNode(button);
  const requestId = host.createRequestId("market");
  const payload = { instrumentId: selectedIndex, side: button.dataset.marketSide, quantity: marketQuantity(card), requestId };
  emitWithTimeout(host.emitServer, "market-order", payload, {
    onResponse: response => marketActionResponse(button, statusNode, response),
    onTimeout: () => {
      clearPending(button);
      host.announceActionStatus("Market response timed out. Your ledger will refresh when the connection returns.", statusNode);
      host.refreshEconomySnapshot?.();
    }
  });
}

function renderMarketDesk() {
  const card = $("#market-card");
  if (!card) return;
  if (chartContainer) disposeAnalyticsChart(chartContainer);
  chartContainer = null;
  const activeId = card.contains(document.activeElement) ? document.activeElement.id : "";
  deskDraft = captureDeskDraft(card) || deskDraft;
  const marketState = market();
  const rows = Object.entries(MARKET_LABELS).map(([id, label]) => deskRowHTML(id, label, marketState)).join("");
  card.innerHTML = marketDeskHTML(marketState, rows);
  restoreDeskDraft(card);
  bindMarketDesk(card);
  renderMarketQuoteChart(card, marketState);
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
  if ((action === "open-option" || action === "exercise-option" || action === "close-position") && market().pricingPolicy?.serverOwned !== true) return null;
  const context = marketActionContext(button, card);
  return MARKET_ACTION_REQUESTS[action]?.(context) || null;
}

function marketActionResponse(button, statusNode, response) {
  if (response?.success === false) {
    clearPending(button);
    host.announceActionStatus(response.error || "Market position could not be updated.", statusNode);
    return;
  }
  mergeEconomySnapshot(response);
  renderMarketDesk();
  host.renderRightRail();
}

function onMarketAdvanced(button, card) {
  if (!markPending(button)) return;
  const statusNode = host.captureActionStatusNode(button);
  const request = requestForMarketAction(button.dataset.marketAdvanced, button, card);
  if (!request) {
    clearPending(button);
    return;
  }
  emitWithTimeout(host.emitServer, request.eventName, request.payload, {
    onResponse: response => marketActionResponse(button, statusNode, response),
    onTimeout: () => {
      clearPending(button);
      host.announceActionStatus("Market response timed out. Your ledger will refresh when the connection returns.", statusNode);
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
  disposeMarketChart();
  closeSurface("#market-modal");
}

function disposeMarketChart() {
  if (chartContainer) disposeAnalyticsChart(chartContainer);
  chartContainer = null;
}

export function renderMarketDeskIfOpen() {
  if (!$("#market-modal") || $("#market-modal").classList.contains("is-hidden")) return;
  renderMarketDesk();
}

export function bindMarketUi() {
  $("#market-scrim")?.addEventListener("click", closeMarketDesk);
  const modal = $("#market-modal");
  if (modal && !marketModalObserver && typeof MutationObserver === "function") {
    marketModalObserver = new MutationObserver(() => {
      if (modal.classList.contains("is-hidden")) disposeMarketChart();
    });
    marketModalObserver.observe(modal, { attributes: true, attributeFilter: ["class"] });
  }
}
