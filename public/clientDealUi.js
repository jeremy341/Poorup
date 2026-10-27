/* ============================================================
   DEAL DETAIL SURFACE: one read-only view for pending trades and player
   contracts. Editing is delegated to the existing trade/finance editors;
   this module owns only role-aware actions and focus-safe presentation.
   ============================================================ */
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

function dealActionButton(action, label, primary = false) {
  return `<button class="${primary ? "cta-red" : "btn-dark"}" type="button" data-deal-action="${action}">${primary ? `<span class="cta-text cta-text-sm">${label}</span>` : `<span class="t-label f11">${label}</span>`}</button>`;
}

function tradeDetailHTML(trade) {
  const mine = trade.toPlayerId === localServerId();
  const sender = trade.fromPlayerName || "PLAYER";
  const receiver = trade.toPlayerName || "PLAYER";
  const actions = mine
    ? `${dealActionButton("accept", "ACCEPT", true)}${dealActionButton("negotiate", "NEGOTIATE")}${dealActionButton("decline", "DECLINE")}`
    : `${dealActionButton("adjust", "ADJUST", true)}${dealActionButton("cancel", "CANCEL TRADE")}`;
  return `<div class="deal-detail-body"><div class="deal-detail-head"><div class="deal-detail-title-wrap"><img class="deal-detail-mark" src="/assets/negotiation.svg" alt="" aria-hidden="true"/><div><span class="t-micro g400">TRADE · ${mine ? "NEEDS YOU" : "AWAITING REVIEW"}</span><h2 class="t-section g100" id="deal-detail-title">${esc(sender)} ⇄ ${esc(receiver)}</h2></div></div>${closeButtonHTML({ id: "deal-detail-close", label: "Close deal details" })}</div><div class="deal-detail-grid"><div><span class="t-micro ink-3">SENDER GIVES</span><strong class="t-label f12 g100">$${Number(trade.giveCash || 0).toLocaleString()}</strong><span class="t-micro ink-3">${esc(deedNames(trade.givePropertyIndexes))}</span></div><div><span class="t-micro ink-3">RECEIVER GIVES</span><strong class="t-label f12 green">$${Number(trade.requestCash || 0).toLocaleString()}</strong><span class="t-micro ink-3">${esc(deedNames(trade.requestPropertyIndexes))}</span></div></div><p class="t-body ink-2 deal-detail-copy">Assets move only when accepted.</p><div class="deal-detail-actions">${actions}</div></div>`;
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
    ? `${dealActionButton("accept", "ACCEPT", true)}${dealActionButton("negotiate", "NEGOTIATE")}${dealActionButton("decline", "DECLINE")}`
    : `${dealActionButton("adjust", "ADJUST", true)}${dealActionButton("cancel", "CANCEL OFFER")}`;
}

function unavailableContractNotice(contract) {
  if (Number(contract.rulesVersion) !== 2 || contract.kind === "hybrid") return "This offer uses earlier rules. Decline or cancel it, then create a new offer. ";
  return "Player Finance is off. Decline or cancel this offer. ";
}

export function contractDetailHTML(contract) {
  const contractDepth = Math.max(0, Math.floor(Number(contract.counterDepth) || 0));
  const proposerId = contract.lastProposerId || (contractDepth % 2 === 0 ? contract.fromPlayerId : contract.toPlayerId);
  const needsResponse = proposerId !== localServerId();
  const kind = contractLabel(contract).toUpperCase();
  const terms = contractTerms(contract);
  const enabled = playerFinanceEnabled(state.settings) && Number(contract.rulesVersion) === 2 && contract.kind !== "hybrid";
  const legacyLoan = playerFinanceEnabled(state.settings) && Number(contract.rulesVersion) !== 2 && contract.kind === "loan" && contractDepth < 2;
  const actions = enabled ? dealActions(needsResponse) : `${dealActionButton("back", "BACK")}${legacyLoan ? dealActionButton(needsResponse ? "negotiate" : "adjust", needsResponse ? "NEGOTIATE" : "ADJUST", true) : ""}${dealActionButton(needsResponse ? "decline" : "cancel", needsResponse ? "DECLINE" : "CANCEL OFFER", !legacyLoan)}`;
  const disclosure = isRentShare(contract) ? rentShareDisclosure(contract) : collateralCreditSummary(contract);
  const rulesNotice = enabled ? "" : legacyLoan ? "This offer uses earlier rules. Update the terms before sending a new offer. " : unavailableContractNotice(contract);
  return `<div class="deal-detail-body"><div class="deal-detail-head"><div class="deal-detail-title-wrap"><img class="deal-detail-mark" src="/assets/negotiation.svg" alt="" aria-hidden="true"/><div><span class="t-micro g400">${kind} · ${needsResponse ? "NEEDS YOU" : "AWAITING REVIEW"}</span><h2 class="t-section g100" id="deal-detail-title">${esc(contract.fromPlayerName || "PLAYER")} → ${esc(contract.toPlayerName || "PLAYER")}</h2></div></div>${closeButtonHTML({ id: "deal-detail-close", label: "Close deal details" })}</div><div class="deal-detail-terms">${terms.map(term => `<span class="deal-term t-label f11 g100">${esc(term)}</span>`).join("")}</div><p class="t-body ink-2 deal-detail-copy">${esc(rulesNotice)}${esc(disclosure)} No cash moves until acceptance.</p><div class="deal-detail-actions">${actions}</div></div>`;
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
  if (action === "back") return closeDealDetails();
  const statusNode = host.captureActionStatusNode(control);
  const legacyLoanNegotiation = ["negotiate", "adjust"].includes(action) && deal.kind === "loan" && Number(deal.rulesVersion) !== 2 && Number(deal.counterDepth || 0) < 2;
  if (kind === "contract" && ["accept", "negotiate", "adjust"].includes(action) && (!playerFinanceEnabled(state.settings) || (Number(deal.rulesVersion) !== 2 && !legacyLoanNegotiation) || deal.kind === "hybrid")) {
    host.announceActionStatus(unavailableContractNotice(deal).trim(), statusNode);
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
      onConfirm: () => sendDealAction(kind, action, deal, statusNode),
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
