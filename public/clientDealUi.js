/* ============================================================
   DEAL DETAIL SURFACE: one read-only view for pending trades and player
   contracts. Editing is delegated to the existing trade/finance editors;
   this module owns only role-aware actions and focus-safe presentation.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { TILES } from "./clientBoardData.js";
import { closeSurface, openSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";

let host = { emitServer: noop, say: noop, renderChat: noop, renderRightRail: noop, openTradeNegotiation: noop, openFinancingNegotiation: noop, openConfirmModal: noop };
let activeDealKey = null;
function noop() {}

export function configureDealUi(hooks) {
  host = { ...host, ...hooks };
}

function localServerId() {
  return state.players[0]?.serverId || null;
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
  return `<div class="deal-detail-body"><div class="deal-detail-head"><div class="deal-detail-title-wrap"><img class="deal-detail-mark" src="/assets/negotiation.svg" alt="" aria-hidden="true"/><div><span class="t-micro g400">TRADE · ${mine ? "NEEDS YOU" : "AWAITING REVIEW"}</span><h2 class="t-section g100" id="deal-detail-title">${esc(sender)} ⇄ ${esc(receiver)}</h2></div></div><button class="btn-dark" type="button" id="deal-detail-close"><span class="t-label f11">CLOSE</span></button></div><div class="deal-detail-grid"><div><span class="t-micro ink-3">SENDER GIVES</span><strong class="t-label f12 g100">$${Number(trade.giveCash || 0).toLocaleString()}</strong><span class="t-micro ink-3">${esc(deedNames(trade.givePropertyIndexes))}</span></div><div><span class="t-micro ink-3">RECEIVER GIVES</span><strong class="t-label f12 green">$${Number(trade.requestCash || 0).toLocaleString()}</strong><span class="t-micro ink-3">${esc(deedNames(trade.requestPropertyIndexes))}</span></div></div><p class="t-body ink-2 deal-detail-copy">No assets move while this deal is being viewed or edited. The server rechecks cash and deed ownership at acceptance.</p><div class="deal-detail-actions">${actions}</div></div>`;
}

function contractTerms(contract) {
  const terms = [`$${Number(contract.amount || 0).toLocaleString()} ADVANCE`, `${Number(contract.premiumRate || 0)}% PREMIUM`, `${Number(contract.durationRounds || 0)} ROUNDS`];
  const collateral = contract.kind === "loan" && contract.collateralTileIndex != null ? `COLLATERAL · ${TILES[Number(contract.collateralTileIndex)]?.name || "DEED"}` : null;
  const equity = contract.kind === "equity" ? `${Number(contract.equityShare || 0)}% EQUITY` : null;
  const duration = contract.kind === "equity" ? (contract.expiresRound == null ? "FOREVER" : "TERM-LIMITED") : null;
  const hybrid = contract.kind === "hybrid" ? `${Number(contract.conversionShare || 0)}% CONVERSION` : null;
  const property = contract.kind === "hybrid" ? TILES[Number(contract.propertyIndex)]?.name || "PROPERTY" : null;
  return terms.concat([collateral, equity, duration, hybrid, property].filter(Boolean));
}

function dealActions(needsResponse) {
  return needsResponse
    ? `${dealActionButton("accept", "ACCEPT", true)}${dealActionButton("negotiate", "NEGOTIATE")}${dealActionButton("decline", "DECLINE")}`
    : `${dealActionButton("adjust", "ADJUST", true)}${dealActionButton("cancel", "CANCEL OFFER")}`;
}

function contractDetailHTML(contract) {
  const contractDepth = Math.max(0, Math.floor(Number(contract.counterDepth) || 0));
  const needsResponse = contractDepth % 2 === 0
    ? contract.toPlayerId === localServerId()
    : contract.fromPlayerId === localServerId();
  const kind = String(contract.kind || "loan").toUpperCase();
  const terms = contractTerms(contract);
  const actions = dealActions(needsResponse);
  return `<div class="deal-detail-body"><div class="deal-detail-head"><div class="deal-detail-title-wrap"><img class="deal-detail-mark" src="/assets/negotiation.svg" alt="" aria-hidden="true"/><div><span class="t-micro g400">${kind} · ${needsResponse ? "NEEDS YOU" : "AWAITING REVIEW"}</span><h2 class="t-section g100" id="deal-detail-title">${esc(contract.fromPlayerName || "PLAYER")} → ${esc(contract.toPlayerName || "PLAYER")}</h2></div></div><button class="btn-dark" type="button" id="deal-detail-close"><span class="t-label f11">CLOSE</span></button></div><div class="deal-detail-terms">${terms.map(term => `<span class="deal-term t-label f11 g100">${esc(term)}</span>`).join("")}</div><p class="t-body ink-2 deal-detail-copy">Review every parameter before accepting. Editing sends a new proposal; no cash moves until the funding player accepts.</p><div class="deal-detail-actions">${actions}</div></div>`;
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
  card.querySelectorAll("[data-deal-action]").forEach(button => button.addEventListener("click", () => handleDealAction(button.dataset.dealAction, found.kind, found.deal)));
  return true;
}

function openDealEditor(kind, deal) {
    closeDealDetails();
    if (kind === "trade") host.openTradeNegotiation(deal, null);
    else host.openFinancingNegotiation(deal.id, null);
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

function sendDealAction(kind, action, deal) {
  const event = dealEvent(kind, action);
  if (!event) return;
  const payload = dealPayload(kind, action, deal);
  host.emitServer(event, payload, response => {
    if (response?.success === false) {
      host.say(response.error || "The deal could not be updated.");
      host.renderChat();
      return;
    }
    closeDealDetails();
    host.renderRightRail();
  });
}

function handleDealAction(action, kind, deal) {
  if (["negotiate", "adjust"].includes(action)) return openDealEditor(kind, deal);
  if (!dealEvent(kind, action)) return;
  if (["decline", "cancel"].includes(action)) {
    host.openConfirmModal({
      title: action === "cancel" ? "Cancel this deal?" : "Decline this deal?",
      message: action === "cancel"
        ? "The other player will see that this offer was canceled."
        : "Declining closes the current offer and cannot be undone.",
      confirmLabel: action === "cancel" ? "CANCEL DEAL" : "DECLINE DEAL",
      onConfirm: () => sendDealAction(kind, action, deal),
    });
    return;
  }
  sendDealAction(kind, action, deal);
}

export function openDealDetails(kind, id, trigger = null) {
  activeDealKey = `${kind}:${id}`;
  if (!renderDealDetails()) return;
  openSurface("#deal-detail-modal", "#deal-detail-close");
  if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
}

export function closeDealDetails() {
  activeDealKey = null;
  closeSurface("#deal-detail-modal");
}

export function renderDealDetailsIfOpen() {
  if (!$("#deal-detail-modal") || $("#deal-detail-modal").classList.contains("is-hidden")) return;
  if (!renderDealDetails()) closeDealDetails();
}

export function bindDealUi() {
  $("#deal-detail-scrim")?.addEventListener("click", closeDealDetails);
}
