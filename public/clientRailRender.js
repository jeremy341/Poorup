/* ============================================================
   RIGHT RAIL: holdings/deals/activity panel plus the live player-contract
   rail. Complex computations stay in small helpers so every tab renders from
   the same server snapshot.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { avatarHTML, hydrateSprites } from "./clientSprites.js";
import { TILES } from "./clientBoardData.js";
import { state } from "./clientState.js";
import { ownsFullGroup } from "./clientDeedRules.js";
import { deedCardHTML } from "./clientDeedsRender.js";

export function tradePlayerRowHTML(p, seed) {
const deedCount = TILES.filter((t) => state.owners[t.i] === p.id).length;
  const canTrade = state.phase === "playing";
  return `<div class="trade-player-row">
    <div class="tp-av">${avatarHTML(p, 4, seed)}</div>
    <div class="tp-mid">
      <span class="t-label f13" style="color:${p.textColor}">${esc(p.name)}</span>
      <span class="t-micro ink-3 tp-sub">$${p.cash.toLocaleString()} · ${deedCount} DEED${deedCount === 1 ? "" : "S"}</span>
    </div>
    <button class="btn-dark" data-trade="${p.id}" ${canTrade ? "" : "disabled"}><span class="t-label f11">TRADE</span></button>
  </div>`;
}

function financeStatusTone(loan) {
  if (loan?.status === "defaulted") return "red";
  return "g300";
}

function financeStatusText(loan) {
  if (!loan) return "NO DEBT";
  return String(loan.status).toUpperCase();
}

function financeMetricCellHTML([label, value]) {
  return `<div><span class="t-micro ink-3">${label}</span><strong class="t-label f12 g100">${esc(String(value))}</strong></div>`;
}

function financeMetricsBlock(loanMetrics) {
  if (!loanMetrics.length) return "";
  return `<div class="finance-bank-metrics">${loanMetrics.map(financeMetricCellHTML).join("")}</div>`;
}

function financeActionsBlock(loanAction) {
  if (!loanAction) return "";
  return `<div class="finance-bank-actions">${loanAction}</div>`;
}

function repayActionHTML(loan, disabled) {
  const remaining = Math.max(1, Math.floor(Number(loan.remaining) || 1));
  const flag = disabled ? "disabled" : "";
  return `<div class="finance-repay-controls"><label class="t-micro ink-3" for="bank-repay-amount">AMOUNT TO REPAY</label><input class="field finance-repay-input" id="bank-repay-amount" data-bank-repay-amount type="number" min="1" max="${remaining}" step="1" value="${remaining}" inputmode="numeric" ${flag} aria-label="Amount to repay on bank loan"><button class="cta-red finance-bank-action" type="button" data-bank-action="repay" ${flag}><span class="cta-text cta-text-sm">REPAY</span></button></div>`;
}

function takeActionHTML(offer, disabled) {
  const amount = Number(offer.principal || 0).toLocaleString();
  const flag = disabled ? "disabled" : "";
  return `<button class="cta-red finance-bank-action" type="button" data-bank-action="take" ${flag}><span class="cta-text cta-text-sm">ACCEPT $${amount}</span></button>`;
}

function bankLoanActionHTML(loan, offer, disabled) {
  if (loan && ["active", "due"].includes(loan.status)) return repayActionHTML(loan, disabled);
  if (offer?.available) return takeActionHTML(offer, disabled);
  return "";
}

function activeLoanMetrics(loan) {
  const remaining = `$${Number(loan.remaining || 0).toLocaleString()}`;
  const dueRound = loan.dueRound || "—";
  const collateral = loan.collateralName || "NONE";
  return [["STATUS", String(loan.status).toUpperCase()], ["REMAINING", remaining], ["DUE ROUND", dueRound], ["COLLATERAL", collateral]];
}

function offerMetrics(offer) {
  const advance = `$${Number(offer.principal || 0).toLocaleString()}`;
  const totalDue = `$${Number(offer.totalDue || 0).toLocaleString()}`;
  const collateral = offer.collateralName || "NONE";
  return [["ADVANCE", advance], ["TOTAL DUE", totalDue], ["DUE IN", `${offer.dueInRounds} ROUNDS`], ["COLLATERAL", collateral]];
}

function bankLoanMetrics(loan, offer) {
  if (loan) return activeLoanMetrics(loan);
  if (offer?.available) return offerMetrics(offer);
  return [];
}

function paidLoanCopy(loan) {
  const paidRound = loan.paidRound || "—";
  return `PAID IN ROUND ${paidRound} · You may qualify for emergency credit again when cash is low.`;
}

function bankOfferCopy(offer) {
  if (offer?.available) return "Emergency liquidity is available. Read every term before accepting.";
  const reason = offer?.reason;
  if (reason) return reason;
  return "Bank credit is unavailable right now.";
}

function bankLoanCopy(loan, offer) {
  if (!loan) return bankOfferCopy(offer);
  if (loan.status === "defaulted") return "DEFAULTED · The bank has closed this credit line for the rest of the round.";
  if (loan.status === "paid") return paidLoanCopy(loan);
  return `Repay before round ${loan.dueRound}. The cure window ends after round ${loan.cureRound}.`;
}

function financeBankHeadHTML(loan) {
  return '<div><div class="t-micro g400">BANK CREDIT · LIVE</div><h3 class="t-section g100" id="bank-credit-heading">Emergency liquidity</h3></div><span class="t-micro ' + financeStatusTone(loan) + '">' + financeStatusText(loan) + '</span>';
}

function railFinanceBodyHTML() {
  const me = state.players[0];
  const loan = me?.bankLoan;
  const offer = me?.bankLoanOffer;
  if (state.settings.bankLoans === false && !loan && !offer) return "";
  const loanCopy = bankLoanCopy(loan, offer);
  const bankActionDisabled = state.phase !== "playing" || state.turnIndex !== 0;
  const loanAction = bankLoanActionHTML(loan, offer, bankActionDisabled);
  const loanMetrics = bankLoanMetrics(loan, offer);
  return '<details class="finance-bank panel noise"' + (state.financeBankOpen ? ' open' : '') + '><summary class="finance-bank-head">' + financeBankHeadHTML(loan) + '</summary>' + financeMetricsBlock(loanMetrics) + '<p class="t-body ink-2 finance-bank-copy">' + esc(loanCopy) + '</p>' + financeActionsBlock(loanAction) + '<p class="t-micro ink-3 finance-bank-note">Predatory terms are fixed at acceptance. The bank never negotiates.</p></details>';
}

function casinoResultCopy(last) {
  if (!last) return "NO SPIN YET · THE HOUSE EDGE IS VISIBLE";
  const color = String(last.resultColor || "").toUpperCase();
  const pocket = Number(last.pocket || 0);
  const net = Number(last.net || 0);
  const sign = Number(last.net) >= 0 ? "+" : "";
  return "LAST SPIN · " + color + " " + pocket + " · " + sign + "$" + net.toLocaleString();
}

const CASINO_OFF_HTML = '<section class="economy-empty panel noise"><img src="/assets/casino-wheel.svg" alt="" width="40" height="40"><span class="t-micro g400">OPTIONAL TABLE ADD-ON</span><strong class="t-label f13 g100">CASINO ACCESS IS OFF</strong><p class="t-body ink-2">The host can enable virtual-money European roulette before the round begins.</p></section>';

function railCasinoBodyHTML() {
  const casino = state.economy?.casino || {};
  if (!casino.enabled) return CASINO_OFF_HTML;
  const last = casino.lastResult;
  const resultCopy = casinoResultCopy(last);
  return `<section class="economy-surface casino-surface" aria-labelledby="casino-heading"><div class="economy-surface-head"><img src="/assets/casino-wheel.svg" alt="" width="32" height="32"><div><span class="t-micro g400">EUROPEAN WHEEL · SERVER SETTLED</span><h3 class="t-section g100" id="casino-heading">Place a bet</h3></div></div><div class="casino-odds" aria-label="Roulette odds"><span><strong>RED</strong><small>18 / 37 · 1:1</small></span><span><strong>BLACK</strong><small>18 / 37 · 1:1</small></span><span><strong class="green">GREEN 0</strong><small>1 / 37 · 35:1</small></span></div><button class="btn-dark casino-desk-open" type="button" data-casino-desk aria-haspopup="dialog" aria-controls="casino-modal"><span class="t-label f11">OPEN CASINO DESK</span></button><div class="economy-result" aria-live="polite">${resultCopy}</div><p class="t-micro ink-3 economy-note">Fictional board money only. Loan-backed cash cannot enter the casino. Bets open in the Casino Desk.</p></section>`;
}

const MARKET_LABELS = { brazil: "BRAZIL", ghana: "GHANA", thailand: "THAILAND", japan: "JAPAN", netherlands: "NETHERLANDS", canada: "CANADA", switzerland: "SWITZERLAND", singapore: "SINGAPORE", airports: "AIRPORTS", utilities: "UTILITIES", property: "PROPERTY" };

const MARKET_OFF_HTML = '<section class="economy-empty panel noise"><img src="/assets/market-chart.svg" alt="" width="40" height="40"><span class="t-micro g400">OPTIONAL TABLE ADD-ON</span><strong class="t-label f13 g100">MARKET ACCESS IS OFF</strong><p class="t-body ink-2">The host can enable fictional country and infrastructure indexes before the round begins.</p></section>';

function pnlSign(pnl) {
  if (pnl >= 0) return "+";
  return "";
}

function sellDisabledAttr(position) {
  if (position.quantity) return "";
  return "disabled";
}

function marketRowHTML(id, label, quotes, positions) {
  const quote = Number(quotes[id] || 100);
  const position = positions[id] || {};
  const pnl = Number(position.realizedPnl || 0);
        return '<div class="market-row"><div><strong class="t-label f11 g100">' + label + '</strong><span class="t-micro ink-3">' + Number(position.quantity || 0) + ' UNITS · ' + pnlSign(pnl) + "$" + pnl.toLocaleString() + ' REALIZED</span></div><strong class="t-label f13 g300">$' + quote.toLocaleString() + '</strong><span class="market-actions"><button class="btn-dark" type="button" data-market-order data-market-id="' + id + '" data-market-side="buy">BUY</button><button class="btn-dark" type="button" data-market-order data-market-id="' + id + '" data-market-side="sell" ' + sellDisabledAttr(position) + '>SELL</button></span></div>';
}

function marketRowsHTML(market) {
  const quotes = market.quotes || {};
  const positions = market.positions || state.players[0]?.marketPositions || {};
  return Object.entries(MARKET_LABELS).map(([id, label]) => marketRowHTML(id, label, quotes, positions)).join("");
}

function marketRound(market) {
  return Number(market.round || 0);
}

function marketFeePercent(market) {
  return (Number(market.feeRate || 0.02) * 100).toFixed(0);
}

function marketRiskSummaryHTML(market) {
  const margin = market.margin || {};
  const shortQuantity = Object.values(market.shorts?.positions || {})
    .reduce((sum, position) => sum + Math.max(0, Math.floor(Number(position?.quantity) || 0)), 0);
  const openOptions = (market.options || []).filter(option => option.status === "open").length;
  return `<div class="market-risk-strip" aria-label="Market obligations"><div><span class="t-micro ink-3">MARGIN</span><strong class="t-label f11 g100">$${Number(margin.balance || 0).toLocaleString()}</strong><span class="t-micro ink-3">MAINT $${Number(margin.maintenance || 0).toLocaleString()}</span></div><div><span class="t-micro ink-3">RESERVED</span><strong class="t-label f11 g300">$${Number(market.shorts?.reservedCash || 0).toLocaleString()}</strong><span class="t-micro ink-3">CASH HELD</span></div><div><span class="t-micro ink-3">SHORTS</span><strong class="t-label f11 g100">${shortQuantity}</strong><span class="t-micro ink-3">UNITS OPEN</span></div><div><span class="t-micro ink-3">OPTIONS</span><strong class="t-label f11 g100">${openOptions}</strong><span class="t-micro ink-3">POSITIONS OPEN</span></div></div>`;
}

function railMarketBodyHTML() {
  const market = state.economy?.market || {};
  if (!market.enabled) return MARKET_OFF_HTML;
  const rows = marketRowsHTML(market);
  const complexity = String(market.complexity || "basic").toUpperCase();
  const expansion = complexity === "BASIC"
    ? "No leverage, shorting, or derivatives."
    : `COMPLEXITY ${complexity} · obligations are fully disclosed and collateralized.`;
  return `<section class="economy-surface market-surface" aria-labelledby="market-heading"><div class="economy-surface-head"><img src="/assets/market-chart.svg" alt="" width="32" height="32"><div><span class="t-micro g400">FICTIONAL EXCHANGE · ROUND ${marketRound(market)}</span><h3 class="t-section g100" id="market-heading">Country indexes</h3></div><span class="t-micro g300">${complexity}</span></div>${marketRiskSummaryHTML(market)}<label class="market-quantity"><span class="t-micro ink-3">ORDER QUANTITY</span><input class="field" id="market-quantity" type="number" min="1" max="1000" value="1" inputmode="numeric"></label><button class="btn-dark market-desk-open" type="button" data-market-desk aria-haspopup="dialog" aria-controls="market-modal"><span class="t-label f11">OPEN MARKET DESK</span></button><div class="market-list thin-scroll">${rows}</div><p class="t-micro ink-3 economy-note">Prices update at round boundaries. A ${marketFeePercent(market)}% settlement fee applies. ${expansion} Advanced actions open in the Market Desk.</p></section>`;
}

function railDeedRowHTML(tile) {
  const fullSet = ownsFullGroup("p1", tile.group);
  return deedCardHTML(tile, { showBuild: true, status: fullSet ? "FULL SET" : "OWNED" });
}

function railDeedsBodyHTML(owned) {
  if (!owned.length) return `<p class="t-body rr-empty">NO DEEDS YET. LAND ON A VACANT LOT AND BUY IT.</p>`;
  return owned.map(railDeedRowHTML).join("");
}

const LEGACY_RAIL_TABS = {
  deeds: "holdings",
  trade: "deals",
  finance: "deals",
  log: "holdings",
  casino: "activity",
  market: "activity",
};

function normalizeRailTab(value) {
  const next = LEGACY_RAIL_TABS[value] || value;
  return ["holdings", "deals", "activity"].includes(next) ? next : "holdings";
}

function normalizeDealsFilter(value) {
  return ["needs-you", "active", "outgoing"].includes(value) ? value : "needs-you";
}

function normalizeActivityMode(value) {
  return ["indexes", "predictions", "casino"].includes(value) ? value : "indexes";
}

function itemEntriesForPlayer(player) {
  const source = player?.items;
  if (Array.isArray(source)) return source.filter(item => item && typeof item === "object");
  if (!source || typeof source !== "object") return [];
  return Object.entries(source).map(([itemId, item]) => ({ itemId, ...(item || {}) }));
}

function itemCountForPlayer(player) {
  return itemEntriesForPlayer(player).reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.quantity) || 0)), 0);
}

function holdingsAccountHTML(player) {
  const tier = Math.max(1, Math.floor(Number(player?.bankAccountTier) || 1));
  const tierNames = { 1: "STANDARD", 2: "SPARKASSE PREMIUM", 3: "AMERICAN EXPRESS BLACK" };
  const accountEnabled = Boolean(player?.bankAccountUpgrade || state.settings.bankAccountUpgrades);
  const status = accountEnabled ? `${tierNames[tier] || `TIER ${tier}`} · ROUND ACCOUNT` : "STANDARD · ACCOUNT TIERS OFF";
  const actionLabel = accountEnabled ? "OPEN WALLET" : "VIEW WALLET";
  return `<section class="rail-section holdings-account" aria-labelledby="holdings-account-heading"><div class="rail-section-head"><span class="t-micro g400" id="holdings-account-heading">ACCOUNT</span><span class="t-micro ink-3">${esc(status)}</span></div><div class="holdings-account-row"><div><strong class="t-label f12 g100">$${Number(player?.cash || 0).toLocaleString()} CASH</strong><span class="t-micro ink-3">${player?.bankLoan?.status ? `BANK CREDIT · ${String(player.bankLoan.status).toUpperCase()}` : "NO BANK CREDIT"}</span></div><button class="btn-dark" type="button" data-wallet-open="account" aria-haspopup="dialog" aria-controls="wallet-modal"><span class="t-label f11">${actionLabel}</span></button></div></section>`;
}

function holdingsItemsHTML(player) {
  const items = itemEntriesForPlayer(player);
  if (!items.length) return `<section class="rail-section holdings-items" aria-labelledby="holdings-items-heading"><div class="rail-section-head"><span class="t-micro g400" id="holdings-items-heading">ITEMS</span><span class="t-micro ink-3">0 HELD</span></div><div class="holdings-empty"><span class="t-micro ink-3">NO ITEMS THIS ROUND.</span><button class="btn-dark" type="button" data-wallet-open="items" aria-haspopup="dialog" aria-controls="wallet-modal"><span class="t-label f11">OPEN ITEMS</span></button></div></section>`;
  const rows = items.map(item => {
    const id = esc(item.itemId || item.id || "ITEM");
    const label = esc(item.name || String(item.itemId || item.id || "ITEM").replaceAll("-", " ").toUpperCase());
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    return `<div class="holding-item-row"><span class="holding-item-glyph" aria-hidden="true">✦</span><div><strong class="t-label f11 g100">${label}</strong><span class="t-micro ink-3">QTY ${quantity} · ${esc(String(item.rarity || "COMMON").toUpperCase())}</span></div><button class="btn-dark" type="button" data-wallet-open="items" data-wallet-item="${id}" aria-haspopup="dialog" aria-controls="wallet-modal"><span class="t-label f11">VIEW</span></button></div>`;
  }).join("");
  return `<section class="rail-section holdings-items" aria-labelledby="holdings-items-heading"><div class="rail-section-head"><span class="t-micro g400" id="holdings-items-heading">ITEMS</span><span class="t-micro ink-3">${itemCountForPlayer(player)} HELD</span></div><div class="holding-item-list">${rows}</div><button class="btn-dark holdings-items-open" type="button" data-wallet-open="items" aria-haspopup="dialog" aria-controls="wallet-modal"><span class="t-label f11">OPEN ITEMS</span></button></section>`;
}

function railHoldingsBodyHTML(owned) {
  const player = state.players[0] || {};
  return holdingsAccountHTML(player) + holdingsItemsHTML(player) + `<section class="rail-section holdings-deeds" aria-labelledby="holdings-deeds-heading"><div class="rail-section-head"><span class="t-micro g400" id="holdings-deeds-heading">DEEDS</span><span class="t-micro ink-3">${owned.length} OWNED</span></div>${railDeedsBodyHTML(owned)}</section>`;
}

function dealsFilterHTML() {
  const current = normalizeDealsFilter(state.dealsFilter);
  return `<div class="deals-filter-bar" role="tablist" aria-label="Deal views"><button class="deals-filter${current === "needs-you" ? " is-active" : ""}" id="deals-filter-needs-you" type="button" role="tab" aria-selected="${current === "needs-you"}" aria-controls="deals-panel" data-deals-filter="needs-you"><span class="t-label f11">NEEDS YOU</span></button><button class="deals-filter${current === "active" ? " is-active" : ""}" id="deals-filter-active" type="button" role="tab" aria-selected="${current === "active"}" aria-controls="deals-panel" data-deals-filter="active"><span class="t-label f11">ACTIVE</span></button><button class="deals-filter${current === "outgoing" ? " is-active" : ""}" id="deals-filter-outgoing" type="button" role="tab" aria-selected="${current === "outgoing"}" aria-controls="deals-panel" data-deals-filter="outgoing"><span class="t-label f11">OUTGOING</span></button></div>`;
}

function dealsPlayerDirectoryHTML(filter) {
  if (filter !== "needs-you") return "";
  if (!state.settings.trading) return `<section class="rail-section deals-directory"><span class="t-micro ink-3">PLAYER DEALS</span><p class="t-body ink-3 rr-empty">TRADING IS OFF FOR THIS ROUND.</p></section>`;
  const others = state.players.filter((player) => player.id !== "p1");
  if (!others.length) return `<section class="rail-section deals-directory"><span class="t-micro ink-3">PLAYER DEALS</span><p class="t-body ink-3 rr-empty">NO OTHER PLAYERS AT THE TABLE.</p></section>`;
  const rows = others.map((player) => tradePlayerRowHTML(player, state.players.indexOf(player))).join("");
  return `<section class="rail-section deals-directory" aria-labelledby="deals-directory-heading"><div class="rail-section-head"><span class="t-micro g400" id="deals-directory-heading">PLAYER DEALS</span><span class="t-micro ink-3">${others.length} AVAILABLE</span></div><div class="deals-player-list">${rows}</div></section>`;
}

function railDealsBodyHTML() {
  const filter = normalizeDealsFilter(state.dealsFilter);
  state.dealsFilter = filter;
  const contractHTML = playerContractRailHTML(filter);
  const bankHTML = filter === "outgoing" ? "" : railFinanceBodyHTML();
  return `<div class="deals-surface" id="deals-panel" role="tabpanel" aria-labelledby="deals-filter-${filter}">${dealsFilterHTML()}${dealsPlayerDirectoryHTML(filter)}${contractHTML}${bankHTML}<p class="t-micro ink-3 deals-note">Close any detail view to keep the deal pending. Only an explicit action changes the ledger.</p></div>`;
}

function activityModeTabsHTML() {
  const current = normalizeActivityMode(state.activityMode);
  const tabs = [["indexes", "INDEXES"], ["predictions", "PREDICTIONS"], ["casino", "CASINO"]];
  return `<div class="activity-mode-tabs" role="tablist" aria-label="Activity views">${tabs.map(([id, label]) => `<button class="activity-mode-tab${current === id ? " is-active" : ""}" id="activity-mode-${id}" type="button" role="tab" aria-selected="${current === id}" aria-controls="activity-mode-panel-${id}" data-activity-mode="${id}"><span class="t-label f11">${label}</span></button>`).join("")}</div>`;
}

function railPredictionsBodyHTML() {
  const predictions = Array.isArray(state.economy?.predictions) ? state.economy.predictions : [];
  if (!predictions.length) return `<section class="economy-empty panel noise"><img src="/assets/market-chart.svg" alt="" width="40" height="40"><span class="t-micro g400">OPTIONAL TABLE ADD-ON</span><strong class="t-label f13 g100">PREDICTIONS ARE QUIET</strong><p class="t-body ink-2">No fictional prediction tickets are open for this round. Locked outcomes are settled by the server.</p></section>`;
  const rows = predictions.slice(0, 20).map((prediction) => `<div class="prediction-summary-row"><div><strong class="t-label f11 g100">${esc(prediction.title || prediction.market || "PREDICTION")}</strong><span class="t-micro ink-3">${esc(String(prediction.status || "OPEN").toUpperCase())} · LOCK R${Number(prediction.lockRound || 0)}</span></div><span class="t-label f12 g300">$${Number(prediction.stake || 0).toLocaleString()}</span></div>`).join("");
  return `<section class="economy-surface prediction-surface"><div class="economy-surface-head"><img src="/assets/market-chart.svg" alt="" width="32" height="32"><div><span class="t-micro g400">FICTIONAL TICKETS · SERVER SETTLED</span><h3 class="t-section g100">Predictions</h3></div></div><div class="prediction-list thin-scroll">${rows}</div><p class="t-micro ink-3 economy-note">Virtual board cash only. Odds, fees, lock round, and maximum profit are shown before confirmation.</p></section>`;
}

function railActivityBodyHTML() {
  const mode = normalizeActivityMode(state.activityMode);
  state.activityMode = mode;
  let content = railMarketBodyHTML();
  if (mode === "predictions") content = railPredictionsBodyHTML();
  if (mode === "casino") content = railCasinoBodyHTML();
  const status = state.economySnapshotStatus === "stale"
    ? `<p class="t-micro red activity-data-status" role="status" aria-live="polite">ACTIVITY DATA STALE · RECONNECTING…</p>`
    : state.economySnapshotStatus === "fresh"
      ? `<p class="t-micro ink-3 activity-data-status" role="status" aria-live="polite">ACTIVITY DATA VERIFIED</p>`
      : "";
  return `<div class="activity-surface">${activityModeTabsHTML()}${status}<div class="activity-mode-content" id="activity-mode-panel-${mode}" role="tabpanel" aria-labelledby="activity-mode-${mode}">${content}</div></div>`;
}

function spectatorRailHTML(player) {
  const name = esc(player?.name || "PLAYER");
  return `<section class="spectator-rail panel noise" aria-labelledby="spectator-rail-heading"><div class="spectator-rail-kicker t-micro g400">ROUND OBSERVER</div><h3 class="t-section g100" id="spectator-rail-heading">SPECTATOR MODE</h3><p class="t-body ink-2">${name}, you are out of the turn order. The board, public ledger, chat, log, and event headlines remain visible.</p><p class="t-micro ink-3">No rolls, purchases, trades, loans, auctions, or market actions are available.</p><button class="btn-dark" type="button" data-spectator-leave><span class="t-label f11">LEAVE TABLE</span></button></section>`;
}

function renderRailBody(owned) {
  const body = $("#rr-body");
  const tab = normalizeRailTab(state.tab);
  state.tab = tab;
  if (tab === "deals") {
    body.innerHTML = railDealsBodyHTML();
    hydrateSprites();
    return;
  }
  if (tab === "activity") {
    body.innerHTML = railActivityBodyHTML();
    return;
  }
  body.innerHTML = railHoldingsBodyHTML(owned);
  hydrateSprites();
}

function railTitleText(tab) {
  if (tab === "deals") return "Deals";
  if (tab === "activity") return "Activity";
  return "Holdings";
}

function casinoCountText() {
  if (state.economy?.casino?.enabled) return "VIRTUAL MONEY";
  return "OFF";
}

function marketCountText() {
  if (state.economy?.market?.enabled) return "ROUND INDEX";
  return "OFF";
}

function railCountText(tab, owned) {
  if (tab === "deals") {
    const localId = state.players[0]?.serverId;
    const trade = state.pendingTrade;
    const pendingTrade = trade && trade.toPlayerId === localId;
    const activeContracts = Array.isArray(state.playerContracts?.active) ? state.playerContracts.active : [];
    const due = activeContracts.filter(contract => contract.status === "due" && contract.toPlayerId === localId).length;
    const needs = (state.playerContractOffer ? 1 : 0) + (pendingTrade ? 1 : 0) + due;
    return needs + " NEED YOU · " + activeContracts.length + " ACTIVE";
  }
  if (tab === "activity") {
    const mode = normalizeActivityMode(state.activityMode);
    if (mode === "casino") return casinoCountText();
    if (mode === "predictions") return `${Array.isArray(state.economy?.predictions) ? state.economy.predictions.length : 0} TICKETS`;
    return marketCountText();
  }
  return `${owned.length} DEEDS · ${itemCountForPlayer(state.players[0])} ITEMS`;
}

function renderRailHeader(owned) {
  const tab = state.tab;
  const title = $("#rr-title");
  if (title) title.textContent = railTitleText(tab);
  $("#rr-count").textContent = railCountText(tab, owned);
  document.querySelectorAll(".tab").forEach((tb) => {
    const selected = tb.dataset.tab === tab;
    tb.classList.toggle("is-active", selected);
    tb.setAttribute("aria-selected", String(selected));
  });
  $("#rr-body")?.setAttribute("aria-labelledby", `tab-${tab}`);
}

export function renderRightRail() {
  const owned = TILES.filter((t) => state.owners[t.i] === "p1");
  state.tab = normalizeRailTab(state.tab);
  renderRailHeader(owned);
  if (state.players[0]?.spectating || (state.players[0]?.bankrupt && !state.players[0]?.bot)) {
    const body = $("#rr-body");
    if (body) body.innerHTML = spectatorRailHTML(state.players[0]);
    return;
  }
  renderRailBody(owned);
}

function isOtherHuman(player) {
  if (player.id === "p1") return false;
  return !player.bot;
}

function outgoingContract(pending, localServerId) {
  if (!pending) return null;
  const contractDepth = Math.max(0, Math.floor(Number(pending.counterDepth) || 0));
  const lastProposerId = contractDepth % 2 === 0 ? pending.fromPlayerId : pending.toPlayerId;
  if (lastProposerId === localServerId) return pending;
  return null;
}

function contractContext() {
  const pending = state.playerContracts?.pending;
  const localServerId = state.players[0]?.serverId;
  return {
    offer: state.playerContractOffer,
    outgoing: outgoingContract(pending, localServerId),
    active: state.playerContracts?.active || [],
    others: state.players.filter(isOtherHuman),
    localServerId,
  };
}

function contractOfferHybridHTML(offer) {
  if (offer.kind !== "hybrid") return "";
  const tile = TILES[Number(offer.propertyIndex)];
  const deed = tile ? " · " + tile.name : "";
  return " · CONVERTS " + Number(offer.conversionShare || 0) + "%" + deed;
}

function contractOfferBlockHTML(offer) {
  if (!offer) return "";
  return '<button class="player-contract-offer deal-collapsed" type="button" data-deal-view="contract:' + esc(offer.id) + '"><strong class="t-label f12 g100">' + esc(String(offer.kind || "loan").toUpperCase()) + ' FROM ' + esc(offer.fromPlayerName || "PLAYER") + '</strong><span class="t-micro ink-3">$' + Number(offer.amount || 0).toLocaleString() + ' ADVANCE · ' + Number(offer.premiumRate || 0) + '% PREMIUM · ' + Number(offer.durationRounds || 0) + ' ROUNDS' + esc(contractOfferHybridHTML(offer)) + '</span><span class="t-micro g400">VIEW DEAL · ACCEPT OR NEGOTIATE</span></button>';
}

function contractOutgoingBlockHTML(outgoing) {
  if (!outgoing) return "";
  return '<button class="player-contract-offer is-outgoing deal-collapsed" type="button" data-deal-view="contract:' + esc(outgoing.id) + '"><strong class="t-label f12 g100">CONTRACT SENT TO ' + esc(outgoing.toPlayerName || "PLAYER") + '</strong><span class="t-micro ink-3">' + esc(String(outgoing.kind || "loan").toUpperCase()) + ' · AWAITING REVIEW</span><span class="t-micro g400">VIEW DEAL · ADJUST OR CANCEL</span></button>';
}

function tradeRailBlockHTML(trade, localServerId) {
  if (!trade) return "";
  const outgoing = trade.fromPlayerId === localServerId;
  const other = outgoing ? trade.toPlayerName : trade.fromPlayerName;
  const cash = Number(outgoing ? trade.giveCash : trade.requestCash) || 0;
  const deeds = (outgoing ? trade.givePropertyIndexes : trade.requestPropertyIndexes) || [];
  const headline = `$${cash.toLocaleString()} CASH · ${deeds.length} DEED${deeds.length === 1 ? "" : "S"}`;
  return '<button class="player-contract-offer deal-collapsed ' + (outgoing ? 'is-outgoing' : '') + '" type="button" data-deal-view="trade:' + esc(trade.id) + '"><strong class="t-label f12 g100">TRADE ' + (outgoing ? 'TO ' : 'FROM ') + esc(other || "PLAYER") + '</strong><span class="t-micro ink-3">' + esc(headline) + ' · ' + (outgoing ? 'AWAITING REVIEW' : 'NEEDS YOU') + '</span><span class="t-micro g400">VIEW DEAL · ' + (outgoing ? 'ADJUST OR CANCEL' : 'ACCEPT OR NEGOTIATE') + '</span></button>';
}

function contractHybridDetailHTML(contract) {
  if (contract.status === "converted") {
    return Number(contract.conversionShare || 0) + "% EQUITY · CONVERTED";
  }
  const remaining = Number(contract.remaining || 0).toLocaleString();
  const dueRound = Number(contract.dueRound || 0);
  const conversion = Number(contract.conversionShare || 0);
  return "$" + remaining + " REMAINING · DUE R" + dueRound + " · CONVERTS " + conversion + "%";
}

// Third-party rows are redacted server-side (no amounts), so they render a
// neutral status line instead of garbage zeros.
function contractDetailRedacted(contract) {
  if (contract.remaining != null) return false;
  return contract.equityShare == null;
}

function contractRowDetailHTML(contract) {
  if (contractDetailRedacted(contract)) {
    return String(contract.status || "active").toUpperCase() + " · PRIVATE TERMS";
  }
  if (contract.kind === "loan") {
    const remaining = Number(contract.remaining || 0).toLocaleString();
    const dueRound = Number(contract.dueRound || 0);
    return "$" + remaining + " REMAINING · DUE R" + dueRound;
  }
  if (contract.kind === "hybrid") return contractHybridDetailHTML(contract);
  return contractEquityDetailHTML(contract);
}

function contractEquityDetailHTML(contract) {
  const share = Number(contract.equityShare || 0) + "% EQUITY";
  if (contract.expiresRound == null) return share;
  return share + " · EXPIRES R" + Number(contract.expiresRound);
}

function contractDebtKind(kind) {
  if (kind === "loan") return true;
  return kind === "hybrid";
}

function contractRepayableStatus(contract) {
  if (contract.status === "active") return true;
  return contract.status === "due";
}

function contractRepayHTML(contract, localServerId) {
  if (!contractDebtKind(contract.kind)) return "";
  if (!contractRepayableStatus(contract)) return "";
  if (contract.toPlayerId !== localServerId) return "";
  const remaining = Math.max(1, Math.floor(Number(contract.remaining) || 1));
  return '<div class="contract-repay-controls"><label class="t-micro ink-3" for="contract-repay-' + esc(contract.id) + '">AMOUNT</label><input class="field contract-repay-input" id="contract-repay-' + esc(contract.id) + '" data-contract-repay-amount type="number" min="1" max="' + remaining + '" step="1" value="' + remaining + '" inputmode="numeric" aria-label="Amount to repay on player contract"><button class="btn-dark" type="button" data-player-contract-repay="' + esc(contract.id) + '"><span class="t-label f11">REPAY</span></button></div>';
}

function contractRowHTML(contract, localServerId) {
  const kind = esc(String(contract.kind || "loan").toUpperCase());
  const from = esc(contract.fromPlayerName || "PLAYER");
  const to = esc(contract.toPlayerName || "PLAYER");
  const detail = contractRowDetailHTML(contract);
  return '<div class="player-contract-row"><div><strong class="t-label f11 g100">' + kind + ' · ' + from + ' → ' + to + '</strong><span class="t-micro ink-3">' + detail + '</span></div>' + contractRepayHTML(contract, localServerId) + '<button class="btn-dark" type="button" data-finance-view="' + esc(contract.id) + '"><span class="t-label f11">VIEW</span></button></div>';
}

function isMyDueDebt(contract, localServerId) {
  if (contract.status !== "due") return false;
  if (contract.toPlayerId !== localServerId) return false;
  return true;
}

function financeMyDueDebts(active, localServerId) {
  return active.filter((contract) => isMyDueDebt(contract, localServerId));
}

function financeNeedsCount(offer, dueDebts, trade) {
  return (offer ? 1 : 0) + dueDebts.length + (trade ? 1 : 0);
}

function financeHeaderHTML(offer, dueDebts, active, trade) {
  const needs = financeNeedsCount(offer, dueDebts, trade);
  const live = active.length;
  return '<div class="finance-status"><span class="t-micro ink-3">DEALS</span><span class="t-label f11 g-muted">' + needs + ' NEED YOU · ' + live + ' ACTIVE</span></div>';
}

function byCureRound(a, b) {
  return Number(a.cureRound || 0) - Number(b.cureRound || 0);
}

function financeSortedDueDebts(dueDebts) {
  return [...dueDebts].sort(byCureRound);
}

function financeNeedsRowsHTML(dueDebts, localServerId) {
  return financeSortedDueDebts(dueDebts).map((contract) => contractRowHTML(contract, localServerId)).join("");
}

function financeNeedsEmpty(offerHTML, rowsHTML) {
  if (offerHTML) return false;
  if (rowsHTML) return false;
  return true;
}

function financeNeedsZoneHTML(offer, dueDebts, localServerId) {
  const offerHTML = contractOfferBlockHTML(offer);
  const rowsHTML = financeNeedsRowsHTML(dueDebts, localServerId);
  if (financeNeedsEmpty(offerHTML, rowsHTML)) return '<div class="player-contract-active"><span class="t-micro g400">NEEDS YOU</span><span class="t-micro ink-3">Nothing needs you.</span></div>';
  return '<div class="player-contract-active"><span class="t-micro g400">NEEDS YOU</span>' + offerHTML + rowsHTML + '</div>';
}

function isOwedByYou(contract, localServerId) {
  if (!contractDebtKind(contract.kind)) return false;
  if (contract.toPlayerId !== localServerId) return false;
  return true;
}

function isOwedToYou(contract, localServerId) {
  if (contract.fromPlayerId !== localServerId) return false;
  return true;
}

function financeOwedByRowsHTML(active, localServerId) {
  return active.filter((contract) => isOwedByYou(contract, localServerId)).map((contract) => contractRowHTML(contract, localServerId)).join("");
}

function financeOwedToRowsHTML(active, localServerId) {
  return active.filter((contract) => isOwedToYou(contract, localServerId)).map((contract) => contractRowHTML(contract, localServerId)).join("");
}

function isMyEquityHolder(holderId, localServerId) {
  if (holderId === localServerId) return true;
  const me = state.players[0];
  if (!me) return false;
  if (holderId === me.id) return true;
  return false;
}

function financeEquityEntries(localServerId) {
  const found = [];
  const tiles = state.serverTiles || [];
  for (const serverTile of tiles) {
    const shares = serverTile.equityShares || [];
    for (const entry of shares) {
      if (isMyEquityHolder(entry.holderId, localServerId)) found.push({ tile: serverTile, share: entry.share, contractId: entry.contractId });
    }
  }
  return found;
}

function financeEquityTileName(serverTile) {
  const tile = TILES[Number(serverTile.index)];
  if (tile) return tile.name;
  return "DEED";
}

function financeEquityViewHTML(entry) {
  if (!entry.contractId) return "";
  return '<button class="btn-dark" type="button" data-finance-view="' + esc(entry.contractId) + '"><span class="t-label f11">VIEW</span></button>';
}

function financeEquityRowHTML(entry) {
  const name = financeEquityTileName(entry.tile);
  const share = Number(entry.share || 0);
  return '<div class="player-contract-row"><div><strong class="t-label f11 g100">' + esc(name) + ' · ' + share + '%</strong><span class="t-micro ink-3">EQUITY HELD</span></div>' + financeEquityViewHTML(entry) + '</div>';
}

function financeEquityRowsHTML(equityEntries) {
  return equityEntries.map(financeEquityRowHTML).join("");
}

function financeSubheadHTML(label) {
  return '<span class="t-micro g400">' + label + '</span>';
}

function financeOwedBySectionHTML(rowsHTML) {
  if (!rowsHTML) return "";
  return financeSubheadHTML("OWED BY YOU") + rowsHTML;
}

function financeOwedToSectionHTML(rowsHTML) {
  if (!rowsHTML) return "";
  return financeSubheadHTML("OWED TO YOU") + rowsHTML;
}

function financeEquitySectionHTML(rowsHTML) {
  if (!rowsHTML) return "";
  return financeSubheadHTML("EQUITY YOU HOLD") + rowsHTML;
}

function financeAwaitingSectionHTML(outgoingHTML) {
  if (!outgoingHTML) return "";
  return financeSubheadHTML("AWAITING THEM") + outgoingHTML;
}

function financePositionsGlobalEmpty(offer, outgoing, active, equityRowsHTML) {
  if (offer) return false;
  if (outgoing) return false;
  if (active.length) return false;
  if (equityRowsHTML) return false;
  return true;
}

function financePositionsZoneHTML(ctx, equityEntries, includeOutgoing = true) {
  const owedBy = financeOwedByRowsHTML(ctx.active, ctx.localServerId);
  const owedTo = financeOwedToRowsHTML(ctx.active, ctx.localServerId);
  const equityRows = financeEquityRowsHTML(equityEntries);
  const outgoingHTML = includeOutgoing ? contractOutgoingBlockHTML(ctx.outgoing) : "";
  const empty = includeOutgoing
    ? financePositionsGlobalEmpty(ctx.offer, ctx.outgoing, ctx.active, equityRows)
    : (!owedBy && !owedTo && !equityRows);
  if (empty) return '<div class="player-contract-active"><span class="t-micro g400">YOUR POSITIONS</span><span class="t-micro ink-3">No live deals. Send one when ready.</span></div>';
  return '<div class="player-contract-active"><span class="t-micro g400">YOUR POSITIONS</span>' + financeOwedBySectionHTML(owedBy) + financeOwedToSectionHTML(owedTo) + financeEquitySectionHTML(equityRows) + financeAwaitingSectionHTML(outgoingHTML) + '</div>';
}

function financeOutgoingZoneHTML(ctx, trade) {
  const contractHTML = contractOutgoingBlockHTML(ctx.outgoing);
  const tradeHTML = trade && trade.fromPlayerId === ctx.localServerId ? tradeRailBlockHTML(trade, ctx.localServerId) : "";
  if (!contractHTML && !tradeHTML) return '<div class="player-contract-active"><span class="t-micro g400">OUTGOING</span><span class="t-micro ink-3">No offers waiting for review.</span></div>';
  return '<div class="player-contract-active"><span class="t-micro g400">OUTGOING</span>' + (tradeHTML ? financeSubheadHTML("TRADE") + tradeHTML : "") + (contractHTML ? financeSubheadHTML("CONTRACT") + contractHTML : "") + '</div>';
}

function financeSendHTML() {
  return '<div class="finance-rail-actions"><button class="btn-dark" type="button" data-finance-open="loan"><span class="t-label f11">SEND A DEAL</span></button></div>';
}

export function playerContractRailHTML(filter = state.dealsFilter) {
  const currentFilter = normalizeDealsFilter(filter);
  const ctx = contractContext();
  const dueDebts = financeMyDueDebts(ctx.active, ctx.localServerId);
  const equityEntries = financeEquityEntries(ctx.localServerId);
  const trade = state.pendingTrade && (state.pendingTrade.fromPlayerId === ctx.localServerId || state.pendingTrade.toPlayerId === ctx.localServerId) ? state.pendingTrade : null;
  let body = financeHeaderHTML(ctx.offer, dueDebts, ctx.active, trade && trade.toPlayerId === ctx.localServerId ? trade : null);
  if (currentFilter === "needs-you") {
    const tradeBlock = trade && trade.toPlayerId === ctx.localServerId ? tradeRailBlockHTML(trade, ctx.localServerId) : "";
    body += tradeBlock ? financeSubheadHTML("TRADE") + tradeBlock : "";
    body += financeNeedsZoneHTML(ctx.offer, dueDebts, ctx.localServerId);
  } else if (currentFilter === "outgoing") {
    body += financeOutgoingZoneHTML(ctx, trade);
  } else {
    body += financePositionsZoneHTML(ctx, equityEntries, false);
  }
  return '<section class="player-contracts">' + body + financeSendHTML() + '</section>';
}
