/* ============================================================
   RIGHT RAIL: holdings/finance/casino/market/trade/log panel plus
   the live player-contract rail. Byte-identical markup; complex
   computations split into small helpers.
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
  const amount = Number(loan.remaining || 0).toLocaleString();
  const flag = disabled ? "disabled" : "";
  return `<button class="cta-red finance-bank-action" type="button" data-bank-action="repay" ${flag}><span class="cta-text cta-text-sm">REPAY $${amount}</span></button>`;
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
  const loanCopy = bankLoanCopy(loan, offer);
  const bankActionDisabled = state.phase !== "playing" || state.turnIndex !== 0;
  const loanAction = bankLoanActionHTML(loan, offer, bankActionDisabled);
  const loanMetrics = bankLoanMetrics(loan, offer);
  return '<details class="finance-bank panel noise"><summary class="finance-bank-head">' + financeBankHeadHTML(loan) + '</summary>' + financeMetricsBlock(loanMetrics) + '<p class="t-body ink-2 finance-bank-copy">' + esc(loanCopy) + '</p>' + financeActionsBlock(loanAction) + '<p class="t-micro ink-3 finance-bank-note">Predatory terms are fixed at acceptance. The bank never negotiates.</p></details>';
}

function casinoFeeSuffix(entryFee) {
  if (!entryFee) return "";
  return ' · EVENT FEE $' + entryFee.toLocaleString();
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
  const maxBet = Number(casino.maxBet || 500);
  const entryFee = Number(casino.entryFee || 0);
  const last = casino.lastResult;
  const resultCopy = casinoResultCopy(last);
  return '<section class="economy-surface casino-surface" aria-labelledby="casino-heading"><div class="economy-surface-head"><img src="/assets/casino-wheel.svg" alt="" width="32" height="32"><div><span class="t-micro g400">EUROPEAN WHEEL · SERVER SETTLED</span><h3 class="t-section g100" id="casino-heading">Place a bet</h3></div></div><div class="casino-odds" aria-label="Roulette odds"><span><strong>RED</strong><small>18 / 37 · 1:1</small></span><span><strong>BLACK</strong><small>18 / 37 · 1:1</small></span><span><strong class="green">GREEN 0</strong><small>1 / 37 · 35:1</small></span></div><form class="casino-form" data-casino-form><fieldset><legend class="t-micro ink-3">SELECT POCKET</legend><div class="casino-choice-row"><label class="casino-choice casino-choice-red"><input type="radio" name="casino-color" value="red" checked><span class="t-label f11">RED</span></label><label class="casino-choice casino-choice-black"><input type="radio" name="casino-color" value="black"><span class="t-label f11">BLACK</span></label><label class="casino-choice casino-choice-green"><input type="radio" name="casino-color" value="green"><span class="t-label f11">GREEN 0</span></label></div></fieldset><label class="casino-stake"><span class="t-micro ink-3">STAKE · MAX $' + maxBet.toLocaleString() + casinoFeeSuffix(entryFee) + '</span><input class="field" name="stake" type="number" min="1" max="' + maxBet + '" step="1" value="10" inputmode="numeric"></label><button class="cta-red" type="submit"><span class="cta-text cta-text-sm">SPIN THE WHEEL</span></button></form><div class="economy-result" aria-live="polite">' + resultCopy + '</div><p class="t-micro ink-3 economy-note">Fictional board money only. Loan-backed cash cannot enter the casino.</p></section>';
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

function railMarketBodyHTML() {
  const market = state.economy?.market || {};
  if (!market.enabled) return MARKET_OFF_HTML;
  const rows = marketRowsHTML(market);
  return '<section class="economy-surface market-surface" aria-labelledby="market-heading"><div class="economy-surface-head"><img src="/assets/market-chart.svg" alt="" width="32" height="32"><div><span class="t-micro g400">FICTIONAL EXCHANGE · ROUND ' + marketRound(market) + '</span><h3 class="t-section g100" id="market-heading">Country indexes</h3></div></div><label class="market-quantity"><span class="t-micro ink-3">ORDER QUANTITY</span><input class="field" id="market-quantity" type="number" min="1" max="1000" value="1" inputmode="numeric"></label><div class="market-list thin-scroll">' + rows + '</div><p class="t-micro ink-3 economy-note">Prices update at round boundaries. A ' + marketFeePercent(market) + '% settlement fee applies. No leverage or shorting.</p></section>';
}

function railDeedRowHTML(tile) {
  const fullSet = ownsFullGroup("p1", tile.group);
  return deedCardHTML(tile, { showBuild: true, status: fullSet ? "FULL SET" : "OWNED" });
}

function railDeedsBodyHTML(owned) {
  if (!owned.length) return `<p class="t-body rr-empty">NO DEEDS YET. LAND ON A VACANT LOT AND BUY IT.</p>`;
  return owned.map(railDeedRowHTML).join("");
}

function renderRailTradeBody(body) {
  if (!state.settings.trading) {
    body.innerHTML = `<p class="t-body rr-empty">TRADING IS OFF FOR THIS ROUND.</p>`;
    return;
  }
  const others = state.players.filter((p) => p.id !== "p1");
  if (!others.length) {
    body.innerHTML = `<p class="t-body rr-empty">NO OTHER PLAYERS AT THE TABLE.</p>`;
    return;
  }
  body.innerHTML = others.map((p) => tradePlayerRowHTML(p, state.players.indexOf(p))).join("");
}

function renderRailLogBody(body) {
  if (!state.log.length) {
    body.innerHTML = `<p class="t-body ink-3">NOTHING HAS HAPPENED YET.</p>`;
    return;
  }
  body.innerHTML = state.log.map((l, i) => `<p class="t-body log-line"><span class="log-n">${String(state.log.length - i).padStart(2, "0")} </span>${esc(l)}</p>`).join("");
}

function renderRailBody(owned) {
  const body = $("#rr-body");
  const tab = state.tab;
  if (tab === "finance") {
    body.innerHTML = playerContractRailHTML();
    body.innerHTML += railFinanceBodyHTML();
    hydrateSprites();
    return;
  }
  if (tab === "casino") {
    body.innerHTML = railCasinoBodyHTML();
    return;
  }
  if (tab === "market") {
    body.innerHTML = railMarketBodyHTML();
    return;
  }
  if (tab === "deeds") {
    body.innerHTML = railDeedsBodyHTML(owned);
    return;
  }
  if (tab === "trade") {
    renderRailTradeBody(body);
    return;
  }
  renderRailLogBody(body);
}

function railTitleText(tab) {
  if (tab === "finance") return "Financing";
  if (tab === "casino") return "Casino";
  if (tab === "market") return "Market";
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
  if (tab === "finance") return "BANK + PLAYERS";
  if (tab === "casino") return casinoCountText();
  if (tab === "market") return marketCountText();
  return `${owned.length} DEEDS`;
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
  renderRailHeader(owned);
  renderRailBody(owned);
}

function isOtherHuman(player) {
  if (player.id === "p1") return false;
  return !player.bot;
}

function outgoingContract(pending, localServerId) {
  if (!pending) return null;
  if (pending.fromPlayerId === localServerId) return pending;
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
  return '<div class="player-contract-offer"><strong class="t-label f12 g100">' + esc(String(offer.kind || "loan").toUpperCase()) + ' FROM ' + esc(offer.fromPlayerName || "PLAYER") + '</strong><span class="t-micro ink-3">$' + Number(offer.amount || 0).toLocaleString() + ' ADVANCE · ' + Number(offer.premiumRate || 0) + '% PREMIUM · ' + Number(offer.durationRounds || 0) + ' ROUNDS' + esc(contractOfferHybridHTML(offer)) + '</span><div class="contract-offer-actions"><button class="cta-red" type="button" data-player-contract-action="accept"><span class="cta-text cta-text-sm">ACCEPT</span></button><button class="btn-dark" type="button" data-player-contract-action="decline"><span class="t-label f11">DECLINE</span></button></div></div>';
}

function contractOutgoingBlockHTML(outgoing) {
  if (!outgoing) return "";
  return '<div class="player-contract-offer is-outgoing"><strong class="t-label f12 g100">CONTRACT SENT TO ' + esc(outgoing.toPlayerName || "PLAYER") + '</strong><span class="t-micro ink-3">' + esc(String(outgoing.kind || "loan").toUpperCase()) + ' · AWAITING REVIEW</span><button class="btn-dark" type="button" data-player-contract-cancel><span class="t-label f11">CANCEL</span></button></div>';
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
  return '<button class="btn-dark" type="button" data-player-contract-repay="' + esc(contract.id) + '"><span class="t-label f11">REPAY</span></button>';
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

function financeNeedsCount(offer, dueDebts) {
  if (offer) return 1 + dueDebts.length;
  return dueDebts.length;
}

function financeHeaderHTML(offer, dueDebts, active) {
  const needs = financeNeedsCount(offer, dueDebts);
  const live = active.length;
  return '<div class="finance-status"><span class="t-micro ink-3">FINANCE</span><span class="t-label f11 g-muted">' + needs + ' NEED YOU · ' + live + ' LIVE</span></div>';
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

function financePositionsZoneHTML(ctx, equityEntries) {
  const owedBy = financeOwedByRowsHTML(ctx.active, ctx.localServerId);
  const owedTo = financeOwedToRowsHTML(ctx.active, ctx.localServerId);
  const equityRows = financeEquityRowsHTML(equityEntries);
  const outgoingHTML = contractOutgoingBlockHTML(ctx.outgoing);
  if (financePositionsGlobalEmpty(ctx.offer, ctx.outgoing, ctx.active, equityRows)) return '<div class="player-contract-active"><span class="t-micro g400">YOUR POSITIONS</span><span class="t-micro ink-3">No live deals. Send one when ready.</span></div>';
  return '<div class="player-contract-active"><span class="t-micro g400">YOUR POSITIONS</span>' + financeOwedBySectionHTML(owedBy) + financeOwedToSectionHTML(owedTo) + financeEquitySectionHTML(equityRows) + financeAwaitingSectionHTML(outgoingHTML) + '</div>';
}

function financeSendHTML() {
  return '<div class="finance-rail-actions"><button class="btn-dark" type="button" data-finance-open="loan"><span class="t-label f11">SEND A DEAL</span></button></div>';
}

export function playerContractRailHTML() {
  const ctx = contractContext();
  const dueDebts = financeMyDueDebts(ctx.active, ctx.localServerId);
  const equityEntries = financeEquityEntries(ctx.localServerId);
  return '<section class="player-contracts panel noise">' + financeHeaderHTML(ctx.offer, dueDebts, ctx.active) + financeNeedsZoneHTML(ctx.offer, dueDebts, ctx.localServerId) + financePositionsZoneHTML(ctx, equityEntries) + financeSendHTML() + '</section>';
}
