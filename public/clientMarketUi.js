/* ============================================================
   MARKET DESK: shared-sector quotes, per-player positions, and orders.
   The rail stays a compact glance surface; this owns selection, history,
   preview, and advanced positions.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { formatMoney } from "./clientMoney.js";
import { state } from "./clientState.js";
import { closeSurface, openSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";
import { emitWithTimeout } from "./clientRequestController.js";
import { mountChart, disposeChart } from "./clientChartMount.js";
import { MARKET_LABELS } from "./clientMarketCatalog.js";
import { closeButtonHTML } from "./clientCloseButton.js";

export { MARKET_LABELS };

let host = { emitServer: noop, createRequestId: noop, renderRightRail: noop, say: noop, renderChat: noop, captureActionStatusNode: () => null, announceActionStatus: noop };
function noop() {}
let deskDraft = null;
let selectedIndex = "brazil";
let selectedHistoryRange = "all";
let selectedMarketView = "overview";
let chartContainer = null;
let marketModalObserver = null;

function market() {
  return state.economy?.market || {};
}

function marketQuantity(card) {
  const raw = Number(card.querySelector("#market-desk-quantity")?.value) || 1;
  return Math.max(1, Math.min(1000, Math.floor(raw)));
}

export function selectedMarketPoints(marketState, id = selectedIndex, limit = null) {
  const points = (Array.isArray(marketState.quoteHistory) ? marketState.quoteHistory : [])
    .filter(point => point?.round != null && point?.quotes?.[id] != null && point.quotes[id] !== "" && Number.isFinite(Number(point.round)) && Number.isFinite(Number(point.quotes[id])))
    .map(point => ({ round: Number(point.round), value: Number(point.quotes[id]), eventId: point.eventId || null }));
  const count = Number(limit);
  return Number.isInteger(count) && count > 0 ? points.slice(-count) : points;
}

function selectedHistoryLimit() {
  const count = Number(selectedHistoryRange);
  return Number.isInteger(count) && count > 0 ? count : null;
}

export function marketQuoteSummary(marketState, id) {
  const points = selectedMarketPoints(marketState, id);
  const rawQuote = marketState.quotes?.[id];
  const quoteValue = rawQuote == null ? Number.NaN : Number(rawQuote);
  const quote = Number.isFinite(quoteValue) ? Math.max(0, Math.floor(quoteValue)) : null;
  const latestPoint = points.at(-1) || null;
  const roundValue = Number(marketState.round);
  const round = Number.isFinite(roundValue) ? Math.max(0, Math.floor(roundValue)) : (latestPoint?.round || 0);
  const previousPoint = points.filter(point => point.round < round).at(-1) || null;
  const change = quote != null && previousPoint ? quote - previousPoint.value : null;
  const percentChange = change != null && previousPoint.value > 0
    ? Math.round((change / previousPoint.value) * 1000) / 10
    : null;
  return {
    quote,
    round,
    change,
    percentChange,
    previousQuote: previousPoint?.value ?? null,
    previousRound: previousPoint?.round ?? null,
    eventId: latestPoint?.round === round ? latestPoint.eventId : null,
  };
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
  if (rank >= 3) actions.push(policy?.serverOwned === true ? marketActionButton("open-option", id, "OPTION") : `<span class="market-derivatives-unavailable" role="status">Options aren't available on this table yet.</span>`);
  if (policy?.serverOwned !== true) return actions.join("");
  return actions.join("");
}

function marketMovementLabel(summary, { showRound = true } = {}) {
  if (summary.change == null || summary.percentChange == null || summary.previousQuote == null || summary.previousRound == null) return "NO PRIOR ROUND";
  const direction = summary.change > 0 ? "UP" : summary.change < 0 ? "DOWN" : "UNCHANGED";
  const amount = summary.change > 0 ? `+${formatMoney(summary.change)}` : formatMoney(summary.change);
  const percent = summary.percentChange > 0 ? `+${summary.percentChange.toFixed(1)}%` : `${summary.percentChange.toFixed(1)}%`;
  const movement = `${direction} ${amount} (${percent})`;
  return showRound ? `${movement} VS ROUND ${summary.previousRound}` : movement;
}

function marketChartSummary(points, label) {
  if (!points.length) return `No recorded shared quote history is available yet for ${label}.`;
  const first = points[0];
  const last = points[points.length - 1];
  const low = points.reduce((best, point) => point.value < best.value ? point : best, first);
  const high = points.reduce((best, point) => point.value > best.value ? point : best, first);
  return `${label} shared quote history: ${points.length} data points from round ${first.round} at $${first.value} to round ${last.round} at $${last.value}. Low $${low.value} in round ${low.round}; high $${high.value} in round ${high.round}.`;
}

function marketViewButtonHTML(view, label) {
  const selected = selectedMarketView === view;
  return `<button class="market-view-button${selected ? " is-active" : ""}" type="button" id="market-view-${view}" data-market-view-select="${view}" aria-pressed="${selected}"><span class="t-label f11">${label}</span></button>`;
}

function setMarketView(card, view) {
  selectedMarketView = view === "trade" ? "trade" : "overview";
  card.dataset.marketView = selectedMarketView;
  card.querySelectorAll("[data-market-view-select]").forEach(button => {
    const selected = button.dataset.marketViewSelect === selectedMarketView;
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("is-active", selected);
  });
  // Both work areas remain visible; the compact controls move keyboard focus.
  card.querySelector(selectedMarketView === "trade" ? "#market-desk-quantity" : "[data-market-quote-chart]")?.focus({ preventScroll: true });
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
    side: card.querySelector('[data-market-order-side][aria-pressed="true"]')?.dataset.marketOrderSide,
    optionSide: card.querySelector("#market-desk-option-side")?.value,
    role: card.querySelector("#market-desk-role")?.value,
  };
}

function marketToolsHTML(hasAdvanced) {
  if (!hasAdvanced) return "";
  return '<div class="market-desk-tools"><label><span class="t-micro ink-3">REDUCE MARGIN</span><input class="field" id="market-desk-margin" type="number" min="1" value="50" inputmode="numeric"></label><button class="btn-dark" type="button" data-market-advanced="reduce-margin"><span class="t-label f11">REDUCE</span></button></div>';
}

function marketOptionFieldsHTML(isDerivatives) {
  if (!isDerivatives) return "";
  return '<div class="market-desk-option-fields"><label><span class="t-micro ink-3">STRIKE</span><input class="field" id="market-desk-strike" type="number" min="10" value="100" inputmode="numeric"></label><label><span class="t-micro ink-3">PREMIUM</span><input class="field" id="market-desk-premium" type="number" min="1" value="10" inputmode="numeric"></label><label><span class="t-micro ink-3">EXPIRY ROUNDS</span><input class="field" id="market-desk-expiry" type="number" min="1" max="20" value="3" inputmode="numeric"></label><label><span class="t-micro ink-3">OPTION SIDE</span><select class="field" id="market-desk-option-side"><option value="call">CALL</option><option value="put">PUT</option></select></label><label><span class="t-micro ink-3">POSITION</span><select class="field" id="market-desk-role"><option value="writer">WRITE · COLLATERALIZED</option><option value="buyer">BUY · PREMIUM</option></select></label></div>';
}

function marketSectorListHTML(marketState) {
  return `<nav class="market-sector-list" aria-label="Market sectors">${Object.entries(MARKET_LABELS).map(([id, label]) => {
    const quote = marketQuoteSummary(marketState, id).quote;
    return `<button class="market-sector-button${id === selectedIndex ? " is-selected" : ""}" type="button" data-market-sector="${esc(id)}" aria-pressed="${id === selectedIndex}"><span>${esc(label)}</span><span class="market-sector-price">${quote == null ? "—" : `$${quote.toLocaleString()}`}</span></button>`;
  }).join("")}</nav>`;
}

function marketDeskHTML(marketState) {
  const complexity = String(marketState.complexity || "basic").toUpperCase();
  const hasAdvanced = marketComplexityRank(complexity) >= 1;
  const position = marketPositionSummary(marketState, selectedIndex);
  const quantity = Math.max(1, Math.floor(Number(deskDraft?.quantity) || 1));
  const preview = marketPreview(marketState, selectedIndex, quantity, deskDraft?.side || "buy");
  const quoteSummary = marketQuoteSummary(marketState, selectedIndex);
  const currentQuote = quoteSummary.quote == null ? "PRICE UNAVAILABLE" : formatMoney(quoteSummary.quote);
  const movement = marketMovementLabel(quoteSummary);
  const historyLimit = selectedHistoryLimit();
  const points = selectedMarketPoints(marketState, selectedIndex, historyLimit);
  const chartRounds = new Set(points.map(point => point.round));
  const markers = personalMarketMarkers(marketState, selectedIndex).filter(entry => chartRounds.has(Number(entry.roundNumber)));
  const historyRangeCaption = historyLimit ? `LAST ${historyLimit} ROUNDS` : "ALL AVAILABLE ROUNDS";
  const advancedActions = advancedActionsHTML(selectedIndex, marketState, marketState.shorts?.positions?.[selectedIndex]);
  const advancedTools = hasAdvanced ? `<details class="market-advanced-settings"><summary>ADVANCED · MARGIN / SHORT / DERIVATIVES</summary>${marketToolsHTML(true)}${marketOptionFieldsHTML(complexity === "DERIVATIVES" && marketState.pricingPolicy?.serverOwned === true)}<div class="market-desk-actions">${advancedActions || '<span class="t-micro ink-3">No advanced actions available for this index.</span>'}</div></details>` : "";
  const accessibleChartSummary = esc(marketChartSummary(points, MARKET_LABELS[selectedIndex]));
  const ledgerCopy = markers.map(entry => `<li>Round ${Number(entry.roundNumber) || "?"}: ${String(entry.side).toUpperCase()} ${Number(entry.quantity) || 0} at $${Number(entry.quote) || 0}</li>`).join("");
  const signedPnl = position.unrealizedPnl > 0
    ? `+${formatMoney(position.unrealizedPnl)}`
    : position.unrealizedPnl < 0 ? formatMoney(position.unrealizedPnl) : "$0";
  const cashValue = Number(state.players[0]?.cash);
  const cashCopy = Number.isFinite(cashValue) ? `${formatMoney(Math.max(0, Math.floor(cashValue)))} CASH ON HAND` : "CASH STATUS UNAVAILABLE";
  const selectedEvent = quoteSummary.eventId ? `GLOBAL EVENT · ${esc(quoteSummary.eventId)}` : "NO ACTIVE EVENT MARKER";
  return `<div class="market-desk-body">
    <div class="market-desk-head"><div><h2 class="t-section g100" id="market-modal-title">Market Desk</h2><p class="t-body ink-2" id="market-modal-description">Shared sector prices and server-settled orders.</p></div>${closeButtonHTML({ id: "market-modal-close", label: "Close market desk" })}</div>
    <div class="market-desk-summary"><div class="market-desk-meta"><span class="t-micro ink-3">MODE</span><strong class="t-label f12 g300">${complexity}</strong><span class="market-round-chip t-micro ink-3">ROUND ${Math.max(0, Number(marketState.round) || 0)}</span><span class="market-fee-chip t-micro ink-3">FEE 2% · MINIMUM $1</span></div></div>
    <div class="market-workspace-toolbar"><label class="market-workspace-index"><span class="t-micro ink-3">SELECT INDEX</span><select class="field" id="market-workspace-index">${Object.entries(MARKET_LABELS).map(([id, label]) => `<option value="${id}"${id === selectedIndex ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></label><div class="market-view-tabs" role="group" aria-label="Market Desk view">${marketViewButtonHTML("overview", "OVERVIEW")}${marketViewButtonHTML("trade", "TRADE")}</div></div>
    <div class="market-desk-layout">
      <section class="market-desk-center" aria-label="Selected index and price history">
        ${marketSectorListHTML(marketState)}
        <section class="market-selected-quote" aria-live="polite" aria-atomic="true"><div><h3 class="t-section g100" id="market-selected-index-name">${MARKET_LABELS[selectedIndex]}</h3><span class="t-micro ink-3">SHARED GAME QUOTE · ROUND ${quoteSummary.round} · ${selectedEvent}</span></div><div class="market-current-price"><span class="t-micro ink-3">CURRENT PRICE</span><strong class="market-current-price-value">${currentQuote}</strong><span class="t-label f11 g300" data-market-movement>${movement}</span></div></section>
        <div class="market-position-strip" aria-label="Your position in ${MARKET_LABELS[selectedIndex]}"><div><span class="t-micro ink-3">HELD</span><strong>${position.quantity} UNITS</strong></div><div><span class="t-micro ink-3">AVERAGE COST PER UNIT</span><strong>$${position.averageCostPerUnit.toLocaleString()}</strong></div><div><span class="t-micro ink-3">UNREALIZED P&amp;L</span><strong>${signedPnl}</strong></div><div><span class="t-micro ink-3">REALIZED P&amp;L</span><strong>$${position.realizedPnl.toLocaleString()}</strong></div></div>
        <section class="market-history" aria-labelledby="market-history-title"><div class="market-history-head"><h3 id="market-history-title" class="t-label f11 g100">${MARKET_LABELS[selectedIndex]} · SHARED PRICE HISTORY</h3><label class="market-history-range"><span class="t-micro ink-3">CHART RANGE</span><select class="field" id="market-desk-history-range"><option value="all"${selectedHistoryRange === "all" ? " selected" : ""}>ALL AVAILABLE</option><option value="8"${selectedHistoryRange === "8" ? " selected" : ""}>LAST 8 ROUNDS</option><option value="16"${selectedHistoryRange === "16" ? " selected" : ""}>LAST 16 ROUNDS</option><option value="32"${selectedHistoryRange === "32" ? " selected" : ""}>LAST 32 ROUNDS</option></select></label></div><div class="market-history-range-note t-micro ink-3">${historyRangeCaption} · ${points.length} DATA POINTS</div><p class="market-chart-summary sr-only" id="market-chart-summary">${accessibleChartSummary}</p><div class="market-quote-chart" data-market-quote-chart role="img" aria-label="${MARKET_LABELS[selectedIndex]} shared quote history" aria-describedby="market-chart-summary"></div>${points.length ? "" : '<p class="market-history-empty" role="status">No quote history is available yet. The current shared quote is shown above.</p>'}</section>
      </section>
      <aside class="market-trade-ticket" aria-labelledby="market-trade-ticket-title">
        <div class="market-ticket-head"><h3 class="t-label f11 g100" id="market-trade-ticket-title">TRADE TICKET</h3><span class="t-micro g300">SERVER SETTLED</span></div>
        <p class="market-ticket-instrument t-micro ink-2">${MARKET_LABELS[selectedIndex]} · ${currentQuote} PER UNIT</p>
        <div class="market-order-fields"><fieldset class="market-order-side"><legend class="t-micro ink-3">ACTION</legend><div role="group" aria-label="Order action"><button class="market-order-side-button${(deskDraft?.side || "buy") === "buy" ? " is-active" : ""}" type="button" data-market-order-side="buy" aria-pressed="${(deskDraft?.side || "buy") === "buy"}">BUY</button><button class="market-order-side-button${deskDraft?.side === "sell" ? " is-active" : ""}" type="button" data-market-order-side="sell" aria-pressed="${deskDraft?.side === "sell"}">SELL</button></div></fieldset><label><span class="t-micro ink-3">UNITS</span><input class="field" id="market-desk-quantity" type="number" min="1" max="1000" value="${quantity}" inputmode="numeric"></label></div>
        <div class="market-order-breakdown" data-market-preview aria-live="polite"><span data-market-quote>QUOTE $${preview.quote.toLocaleString()} / UNIT</span><span data-market-gross>GROSS $${preview.gross.toLocaleString()}</span><span data-market-fee>FEE $${preview.fee.toLocaleString()}</span><span class="market-breakdown-cash" data-market-cash>${cashCopy}</span><strong data-market-total>${deskDraft?.side === "sell" ? "NET PROCEEDS" : "TOTAL DUE"} $${preview.net.toLocaleString()}</strong></div>
        ${advancedTools}<p class="t-micro ink-3 economy-note">Existing obligations can block an order before any cash moves.</p>
        <button class="cta-red market-order-submit" type="button" id="market-order-submit" data-market-basic-order data-market-id="${selectedIndex}" data-market-side="${deskDraft?.side || "buy"}"${quoteSummary.quote == null ? " disabled" : ""}><span class="t-label f11">${(deskDraft?.side || "buy").toUpperCase()} ${MARKET_LABELS[selectedIndex]}</span></button>
      </aside>
    </div>
    <details class="market-personal-ledger-disclosure"><summary class="t-micro g300">YOUR TRADES IN THIS RANGE</summary><div class="t-micro ink-3 market-personal-ledger">${ledgerCopy.length ? `<ul>${ledgerCopy}</ul>` : "No personal trades to mark on this chart yet."}</div></details>
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
    "#market-desk-option-side": deskDraft.optionSide,
    "#market-desk-role": deskDraft.role,
  };
  Object.entries(values).forEach(([selector, value]) => {
    const field = card.querySelector(selector);
    if (value != null && field) field.value = value;
  });
}

function bindMarketDesk(card) {
  card.querySelector("#market-modal-close")?.addEventListener("click", closeMarketDesk);
  card.querySelector("#market-workspace-index")?.addEventListener("change", event => {
    if (!Object.hasOwn(MARKET_LABELS, event.currentTarget.value)) return;
    selectedIndex = event.currentTarget.value;
    renderMarketDesk({ focusId: "market-workspace-index" });
  });
  card.querySelectorAll("[data-market-sector]").forEach((button, index, buttons) => {
    button.addEventListener("click", () => {
      selectedIndex = button.dataset.marketSector;
      renderMarketDesk({ focusId: `market-sector-${selectedIndex}` });
    });
    button.id = `market-sector-${button.dataset.marketSector}`;
    button.addEventListener("keydown", event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].click();
    });
  });
  card.querySelectorAll("[data-market-view-select]").forEach(button => button.addEventListener("click", () => setMarketView(card, button.dataset.marketViewSelect)));
  card.querySelectorAll("[data-market-order-side]").forEach(button => button.addEventListener("click", () => {
    deskDraft = { ...(captureDeskDraft(card) || {}), side: button.dataset.marketOrderSide };
    updateMarketPreview(card);
  }));
  card.querySelectorAll("[data-market-advanced]").forEach(button => button.addEventListener("click", () => onMarketAdvanced(button, card)));
  card.querySelector("#market-desk-history-range")?.addEventListener("change", event => {
    selectedHistoryRange = event.currentTarget.value;
    renderMarketDesk({ focusId: "market-desk-history-range" });
  });
  card.querySelector("#market-desk-quantity")?.addEventListener("input", () => updateMarketPreview(card));
  card.querySelector("#market-desk-quantity")?.addEventListener("change", () => updateMarketPreview(card));
  card.querySelector("[data-market-basic-order]")?.addEventListener("click", event => onMarketBasicOrder(event.currentTarget, card));
}

function updateMarketPreview(card) {
  const capturedDraft = captureDeskDraft(card) || {};
  const side = deskDraft?.side || capturedDraft.side || "buy";
  deskDraft = { ...capturedDraft, side };
  const preview = marketPreview(market(), selectedIndex, marketQuantity(card), side);
  const quote = card.querySelector("[data-market-quote]");
  const gross = card.querySelector("[data-market-gross]");
  const fee = card.querySelector("[data-market-fee]");
  const total = card.querySelector("[data-market-total]");
  if (quote) quote.textContent = `QUOTE ${formatMoney(preview.quote)} / UNIT`;
  if (gross) gross.textContent = `GROSS ${formatMoney(preview.gross)}`;
  if (fee) fee.textContent = `FEE ${formatMoney(preview.fee)}`;
  if (total) total.textContent = `${side === "sell" ? "NET PROCEEDS" : "TOTAL DUE"} ${formatMoney(preview.net)}`;
  card.querySelectorAll("[data-market-order-side]").forEach(button => {
    const selected = button.dataset.marketOrderSide === side;
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("is-active", selected);
  });
  const button = card.querySelector("[data-market-basic-order]");
  if (button) {
    button.dataset.marketSide = side;
    const label = button.querySelector(".t-label");
    if (label) label.textContent = `${side.toUpperCase()} ${MARKET_LABELS[selectedIndex]}`;
  }
}

export function marketChartMarkers(points, marketState, id = selectedIndex) {
  const indexByRound = new Map(points.map((point, index) => [point.round, index]));
  const events = points.flatMap((point, index) => (point.eventId ? [{ index, kind: "event", label: `EVENT · ${point.eventId}` }] : []));
  const orders = personalMarketMarkers(marketState, id).flatMap(entry => {
    const index = indexByRound.get(Number(entry.roundNumber));
    if (index === undefined) return [];
    const side = String(entry.side).toLowerCase() === "sell" ? "sell" : "buy";
    return [{ index, kind: side, label: `YOUR ${side.toUpperCase()}` }];
  });
  return [...events, ...orders];
}

function renderMarketQuoteChart(card, marketState) {
  const container = card.querySelector("[data-market-quote-chart]");
  const points = selectedMarketPoints(marketState, selectedIndex, selectedHistoryLimit());
  if (!container || !points.length) return;
  const title = `${MARKET_LABELS[selectedIndex]} shared quote history`;
  if (!chartContainer) chartContainer = container;
  try {
    mountChart(container, {
      kind: "area", unit: "dollars", title, baseline: "auto",
      labels: points.map(point => `R${point.round}`),
      series: [{ id: "quote", name: "Quote", values: points.map(point => point.value) }],
      markers: marketChartMarkers(points, marketState),
    }, { label: title });
  } catch {
    container.textContent = `Chart unavailable. ${marketChartSummary(points, MARKET_LABELS[selectedIndex])}`;
  }
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

function renderMarketDesk({ focusId = null } = {}) {
  const card = $("#market-card");
  if (!card) return;
  if (chartContainer) disposeChart(chartContainer);
  chartContainer = null;
  const activeElement = card.contains(document.activeElement) ? document.activeElement : null;
  const activeId = focusId || activeElement?.id || "";
  const bodyScrollTop = card.querySelector(".market-desk-body")?.scrollTop || 0;
  deskDraft = captureDeskDraft(card) || deskDraft;
  const marketState = market();
  card.innerHTML = marketDeskHTML(marketState);
  card.dataset.marketView = selectedMarketView;
  restoreDeskDraft(card);
  bindMarketDesk(card);
  renderMarketQuoteChart(card, marketState);
  requestAnimationFrame(() => {
    const body = card.querySelector(".market-desk-body");
    if (body) body.scrollTop = bodyScrollTop;
    if (activeId) card.querySelector(`#${activeId}`)?.focus({ preventScroll: true });
  });
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
    side: selectField(card, "#market-desk-option-side", "call"),
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
  selectedMarketView = "overview";
  renderMarketDesk();
  if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
  openSurface("#market-modal", "#market-modal-close");
}

export function closeMarketDesk() {
  disposeMarketChart();
  closeSurface("#market-modal");
}

function disposeMarketChart() {
  if (chartContainer) disposeChart(chartContainer);
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
