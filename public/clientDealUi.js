// DEAL DETAIL SURFACE: one read-only view for pending trades and player
// contracts. Editing is delegated to the existing trade/finance editors;
// it owns only role-aware actions and focus-safe presentation.
import { $, esc } from "./clientDom.js";
import { closeButtonHTML } from "./clientCloseButton.js";
import { state } from "./clientState.js";
import { playerFinanceEnabled, isRentShare, contractLabel, rentShareDisclosure, collateralCreditSummary } from "./clientFinanceRules.js";
import { emitIntent } from "./clientRequestController.js";
import { TILES } from "./clientBoardData.js";
import { closeSurface, openSurface } from "./clientSurfaces.js";

let host = { emitServer: noop, say: noop, renderChat: noop, renderRightRail: noop, openTradeNegotiation: noop, openFinancingNegotiation: noop, openConfirmModal: noop, captureActionStatusNode: () => null, announceActionStatus: noop };
let activeDealKey = null;
let activeDealTrigger = null;
function noop() {}

export function configureDealUi(hooks) {
  host = { ...host, ...hooks };
}

function localServerId() {
  const self = state.players.find((candidate) => candidate.clientId === state.clientId);
  return self?.serverId || null;
}

function deedNames(indexes = []) {
  return indexes.map(index => TILES[Number(index)]?.name || `DEED ${index}`).join(", ") || "NONE";
}

function dealActionButton(action, label, primary = false, disabledReason = "") {
  const disabled = disabledReason ? ` disabled aria-describedby="deal-unavailable-reason" title="${esc(disabledReason)}"` : "";
  return `<button class="${primary ? "cta-red" : "btn-dark"}" type="button" data-deal-action="${action}"${disabled}>${primary ? `<span class="cta-text cta-text-sm">${label}</span>` : `<span class="t-label f11">${label}</span>`}</button>`;
}

function tradeDetailHTML(trade) {
  const self = localServerId();
  const participant = Boolean(self && (self === trade.fromPlayerId || self === trade.toPlayerId));
  const mine = trade.toPlayerId === self;
  const sender = trade.fromPlayerName || "PLAYER";
  const receiver = trade.toPlayerName || "PLAYER";
  const limitReason = Number(trade.counterDepth || 0) >= 2 ? "This offer has reached the negotiation limit." : "";
  const actions = !participant ? "" : mine
    ? `${dealActionButton("decline", "DECLINE")}${dealActionButton("negotiate", "NEGOTIATE", false, limitReason)}${dealActionButton("accept", "ACCEPT", true)}`
    : limitReason ? `${dealActionButton("adjust", "ADJUST", false, limitReason)}${dealActionButton("cancel", "CANCEL TRADE", true)}`
      : `${dealActionButton("cancel", "CANCEL TRADE")}${dealActionButton("adjust", "ADJUST", true)}`;
  return `<div class="deal-detail-body"><div class="deal-detail-head"><div class="deal-detail-title-wrap"><img class="deal-detail-mark" src="/assets/negotiation.svg" alt="" aria-hidden="true"/><div><span class="t-micro g400">TRADE · ${participant ? (mine ? "NEEDS YOU" : "AWAITING REVIEW") : "OFFER DETAILS"}</span><h2 class="t-section g100" id="deal-detail-title">${esc(sender)} ⇄ ${esc(receiver)}</h2></div></div>${closeButtonHTML({ id: "deal-detail-close", label: "Close deal details" })}</div><div class="deal-detail-grid"><div><span class="t-micro ink-3">SENDER GIVES</span><strong class="t-label f12 g100">$${Number(trade.giveCash || 0).toLocaleString()}</strong><span class="t-micro ink-3">${esc(deedNames(trade.givePropertyIndexes))}</span></div><div><span class="t-micro ink-3">RECEIVER GIVES</span><strong class="t-label f12 green">$${Number(trade.requestCash || 0).toLocaleString()}</strong><span class="t-micro ink-3">${esc(deedNames(trade.requestPropertyIndexes))}</span></div></div><p class="t-body ink-2 deal-detail-copy"><span id="deal-unavailable-reason">${esc(limitReason)}</span> Assets move only when accepted.</p><div class="deal-detail-actions">${actions}</div></div>`;
}

function contractTerms(contract) {
  const terms = [`$${Number(contract.amount || 0).toLocaleString()} ADVANCE`];
  if (!isRentShare(contract)) terms.push(`${Number(contract.durationRounds || 0)} ROUNDS`);
  if (["loan", "hybrid"].includes(contract.kind || "loan")) terms.splice(1, 0, `${Number(contract.premiumRate || 0)}% TOTAL INTEREST`);
  const collateralIndices = Array.isArray(contract.collateralTileIndices) ? contract.collateralTileIndices : contract.collateralTileIndex == null ? [] : [contract.collateralTileIndex];
  const collateral = contract.kind === "loan" && collateralIndices.length ? `COLLATERAL · ${deedNames(collateralIndices)}` : null;
  const equity = contract.kind === "equity" ? `${Number(contract.equityShare || 0)}% ${isRentShare(contract) ? "RENT SHARE" : "LEGACY EQUITY"}` : null;
  const duration = isRentShare(contract) ? (contract.status === "pending" ? `${Number(contract.durationRounds || 3)} ROUNDS FROM ACCEPTANCE` : contract.expiresRound == null ? "FIXED TERM" : `EXPIRES AT START OF ROUND ${Number(contract.expiresRound)}`) : contract.kind === "equity" ? (contract.expiresRound == null ? "LEGACY PERMANENT" : "LEGACY TERM-LIMITED") : null;
  const hybrid = contract.kind === "hybrid" ? `${Number(contract.conversionShare || 0)}% CONVERSION` : null;
  const property = contract.kind === "hybrid" ? TILES[Number(contract.propertyIndex)]?.name || "PROPERTY" : null;
  return terms.concat([collateral, equity, duration, hybrid, property].filter(Boolean));
}

function dealActions(needsResponse) {
  return needsResponse
    ? `${dealActionButton("decline", "DECLINE")}${dealActionButton("negotiate", "NEGOTIATE")}${dealActionButton("accept", "ACCEPT", true)}`
    : `${dealActionButton("cancel", "CANCEL OFFER")}${dealActionButton("adjust", "ADJUST", true)}`;
}

function unavailableContractNotice(contract) {
  if (!playerFinanceEnabled(state.settings)) return "Player Finance is off. Decline or cancel this offer.";
  if (contract.kind === "loan" && Number(contract.rulesVersion) !== 2 && Number(contract.counterDepth || 0) >= 2) return "This earlier-rules offer has reached the negotiation limit. Decline or cancel it.";
  return "This offer uses earlier rules or an unsupported type. Decline or cancel it, then create a new offer.";
}

export function contractDetailHTML(contract) {
  const contractDepth = Math.max(0, Math.floor(Number(contract.counterDepth) || 0));
  const proposerId = contract.lastProposerId || (contractDepth % 2 === 0 ? contract.fromPlayerId : contract.toPlayerId);
  const self = localServerId();
  const participant = Boolean(self && (self === contract.fromPlayerId || self === contract.toPlayerId));
  const needsResponse = proposerId !== self;
  const kind = contractLabel(contract).toUpperCase();
  const terms = contractTerms(contract);
  const supported = Number(contract.rulesVersion) === 2 && contract.kind !== "hybrid" && (contract.kind !== "equity" || isRentShare(contract));
  const enabled = playerFinanceEnabled(state.settings) && supported;
  const legacyLoan = playerFinanceEnabled(state.settings) && Number(contract.rulesVersion) !== 2 && contract.kind === "loan" && contractDepth < 2;
  const atLimit = contractDepth >= 2;
  const rulesNotice = !participant ? (!playerFinanceEnabled(state.settings) ? "Player Finance is off." : !supported ? "This offer uses earlier rules or an unsupported type." : atLimit ? "This offer has reached the negotiation limit." : "") : enabled && atLimit ? "This offer has reached the negotiation limit." : enabled ? "" : legacyLoan ? "This offer uses earlier rules. Update the terms before sending a new offer." : unavailableContractNotice(contract);
  const disabledCurrent = !playerFinanceEnabled(state.settings) && supported;
  const unavailableActions = disabledCurrent
    ? needsResponse
      ? `${dealActionButton("accept", "ACCEPT", false, rulesNotice)}${dealActionButton("negotiate", "NEGOTIATE", false, rulesNotice)}`
      : dealActionButton("adjust", "ADJUST", false, rulesNotice)
    : legacyLoan ? dealActionButton(needsResponse ? "negotiate" : "adjust", needsResponse ? "NEGOTIATE" : "ADJUST", true) : "";
  const limitActions = needsResponse
    ? `${dealActionButton("decline", "DECLINE")}${dealActionButton("negotiate", "NEGOTIATE", false, rulesNotice)}${dealActionButton("accept", "ACCEPT", true)}`
    : `${dealActionButton("adjust", "ADJUST", false, rulesNotice)}${dealActionButton("cancel", "CANCEL OFFER", true)}`;
  const dismissal = dealActionButton(needsResponse ? "decline" : "cancel", needsResponse ? "DECLINE" : "CANCEL OFFER", !legacyLoan);
  const actions = !participant ? "" : enabled ? (atLimit ? limitActions : dealActions(needsResponse)) : legacyLoan ? `${dismissal}${unavailableActions}` : `${unavailableActions}${dismissal}`;
  const disclosure = isRentShare(contract) ? rentShareDisclosure(contract) : collateralCreditSummary(contract);
  return `<div class="deal-detail-body"><div class="deal-detail-head"><div class="deal-detail-title-wrap"><img class="deal-detail-mark" src="/assets/negotiation.svg" alt="" aria-hidden="true"/><div><span class="t-micro g400">${kind} · ${participant ? (needsResponse ? "NEEDS YOU" : "AWAITING REVIEW") : "OFFER DETAILS"}</span><h2 class="t-section g100" id="deal-detail-title">${esc(contract.fromPlayerName || "PLAYER")} → ${esc(contract.toPlayerName || "PLAYER")}</h2></div></div>${closeButtonHTML({ id: "deal-detail-close", label: "Close deal details" })}</div><div class="deal-detail-terms">${terms.map(term => `<span class="deal-term t-label f11 g100">${esc(term)}</span>`).join("")}</div><p class="t-body ink-2 deal-detail-copy"><span id="deal-unavailable-reason">${esc(rulesNotice)}</span> ${esc(disclosure)} No cash moves until acceptance.</p><div class="deal-detail-actions">${actions}</div></div>`;
}

function findDeal() {
  if (!activeDealKey) return null;
  const [kind, id] = activeDealKey.split(":");
  const deal = kind === "trade"
    ? state.pendingTrade?.id === id ? state.pendingTrade : state.offers.find(offer => offer.id === id)
    : state.playerContractOffer?.id === id ? state.playerContractOffer : state.playerContracts?.pending?.id === id ? state.playerContracts.pending : null;
  return { kind, deal };
}

function renderDealDetails() {
  const card = $("#deal-detail-card");
  const found = findDeal();
  if (!card || !found?.deal) return false;
  card.innerHTML = found.kind === "trade" ? tradeDetailHTML(found.deal) : contractDetailHTML(found.deal);
  $("#deal-detail-close")?.addEventListener("click", closeDealDetails);
  card.querySelectorAll("[data-deal-action]").forEach(button => button.addEventListener("click", () => handleDealAction(button.dataset.dealAction, found.kind, found.deal, button)));
  return true;
}

function openDealEditor(kind, deal) {
    const trigger = activeDealTrigger;
    closeDealDetails();
    if (kind === "trade") host.openTradeNegotiation(deal, trigger);
    else host.openFinancingNegotiation(deal.id, trigger);
}

function dealEvent(kind, action) {
  const events = kind === "trade"
    ? { accept: "respond-trade", decline: "respond-trade", cancel: "cancel-trade" }
    : { accept: "respond-player-contract", decline: "respond-player-contract", cancel: "cancel-player-contract" };
  return events[action] || null;
}

function dealPayload(kind, action, deal) {
  if (kind === "trade") return action === "cancel"
    ? { tradeId: deal.id }
    : { tradeId: deal.id, accept: action === "accept" };
  return action === "cancel"
    ? { contractId: deal.id }
    : { contractId: deal.id, accept: action === "accept", requestId: `${action}-${deal.id}` };
}

function sendDealAction(kind, action, deal, statusNode) {
  const event = dealEvent(kind, action);
  if (!event) return;
  const payload = dealPayload(kind, action, deal);
  emitIntent(host.emitServer, `deal:${event}:${deal?.id ?? ""}`, event, payload, {
    onResponse: response => {
      if (response?.success === false) {
        host.announceActionStatus(response.error || "The deal could not be updated.", statusNode);
        return;
      }
      closeDealDetails();
      host.renderRightRail();
    },
    onTimeout: () => host.announceActionStatus("The deal update could not be confirmed. Try again.", statusNode),
  });
}

function handleDealAction(action, kind, deal, control) {
  const current = findDeal();
  if (!current?.deal || current.kind !== kind || current.deal.id !== deal.id) return;
  deal = current.deal;
  const self = localServerId();
  const proposer = kind === "trade" ? deal.fromPlayerId : deal.lastProposerId || (Math.max(0, Math.floor(Number(deal.counterDepth) || 0)) % 2 === 0 ? deal.fromPlayerId : deal.toPlayerId);
  const participant = self && (self === deal.fromPlayerId || self === deal.toPlayerId);
  const allowed = participant && (proposer === self ? ["adjust", "cancel"] : ["accept", "negotiate", "decline"]).includes(action);
  if (!allowed) return;
  const statusNode = host.captureActionStatusNode(control);
  const legacyLoanNegotiation = ["negotiate", "adjust"].includes(action) && deal.kind === "loan" && Number(deal.rulesVersion) !== 2 && Number(deal.counterDepth || 0) < 2;
  const negotiationLimited = ["negotiate", "adjust"].includes(action) && Number(deal.counterDepth || 0) >= 2;
  if (kind === "trade" && negotiationLimited) {
    host.announceActionStatus("This offer has reached the negotiation limit.", statusNode);
    return;
  }
  if (kind === "contract" && ["accept", "negotiate", "adjust"].includes(action) && (!playerFinanceEnabled(state.settings) || (Number(deal.rulesVersion) !== 2 && !legacyLoanNegotiation) || deal.kind === "hybrid" || (deal.kind === "equity" && !isRentShare(deal)) || negotiationLimited)) {
    host.announceActionStatus(negotiationLimited && playerFinanceEnabled(state.settings) ? "This offer has reached the negotiation limit." : unavailableContractNotice(deal), statusNode);
    return;
  }
  if (["negotiate", "adjust"].includes(action)) return openDealEditor(kind, deal);
  if (!dealEvent(kind, action)) return;
  if (["decline", "cancel"].includes(action)) {
    host.openConfirmModal({
      title: action === "cancel" ? "Cancel this deal?" : "Decline this deal?",
      message: action === "cancel"
        ? "The other player will see that this offer was canceled."
        : "Declining closes the current offer and cannot be undone.",
      confirmLabel: action === "cancel" ? "CANCEL DEAL" : "DECLINE DEAL",
      onConfirm: () => {
        const currentDeal = findDeal();
        const currentSelf = localServerId();
        if (!currentDeal?.deal || currentDeal.kind !== kind || currentDeal.deal.id !== deal.id || !currentSelf) return;
        const latest = currentDeal.deal;
        const latestProposer = kind === "trade" ? latest.fromPlayerId : latest.lastProposerId || (Math.max(0, Math.floor(Number(latest.counterDepth) || 0)) % 2 === 0 ? latest.fromPlayerId : latest.toPlayerId);
        if (![latest.fromPlayerId, latest.toPlayerId].includes(currentSelf) || (action === "cancel") !== (latestProposer === currentSelf)) return;
        sendDealAction(kind, action, latest, statusNode);
      },
    });
    return;
  }
  sendDealAction(kind, action, deal, statusNode);
}

export function openDealDetails(kind, id, trigger = null) {
  activeDealKey = `${kind}:${id}`;
  activeDealTrigger = trigger;
  if (!renderDealDetails()) {
    activeDealTrigger = null;
    return;
  }
  openSurface("#deal-detail-modal", "#deal-detail-close", { trigger });
}

export function closeDealDetails() {
  activeDealKey = null;
  activeDealTrigger = null;
  closeSurface("#deal-detail-modal");
}

export function renderDealDetailsIfOpen() {
  if (!$("#deal-detail-modal") || $("#deal-detail-modal").classList.contains("is-hidden")) return;
  if (!renderDealDetails()) closeDealDetails();
}

export function bindDealUi() {
  $("#deal-detail-scrim")?.addEventListener("click", closeDealDetails);
}
