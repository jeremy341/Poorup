/* ============================================================
   RAIL EVENTS: the click/submit dispatch tables for #rr-body
   (holdings, deals, activity, market, bank loans, financing,
   trades, casino). Handlers run in the exact order of the old
   if-chain; disabled controls fall through like they did before.
   Game-bound functions are injected by the entry module. Repayment controls
   pass an optional amount while preserving the server's full-pay default.
   ============================================================ */
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import { TILES } from "./clientBoardData.js";
import { emitWithTimeout } from "./clientRequestController.js";

let host = {
  emitServer: noop,
  say: noop,
  renderChat: noop,
  renderRightRail: noop,
  createRequestId: noop,
  buyTile: noop,
  openTradeModal: noop,
  openFinancingModal: noop,
  openFinancingNegotiation: noop,
  openFinancingContract: noop,
  openDealDetails: noop,
  openWalletModal: noop,
  openMarketDesk: noop,
  openCasinoDesk: noop,
  refreshEconomySnapshot: noop,
  leaveRoomForHome: noop,
};

function noop() {}

export function configureRailEvents(hooks) {
  host = { ...host, ...hooks };
}

function ackFailure(response, message) {
  host.say(response.error || message);
  host.renderChat();
}

function markPending(node) {
  if (!node || node.disabled) return false;
  node.disabled = true;
  node.setAttribute("aria-busy", "true");
  node.dataset.pending = "true";
  const label = node.querySelector(".cta-text, .t-label");
  if (label) {
    label.dataset.previousLabel = label.textContent;
    label.textContent = "PROCESSING…";
  }
  return true;
}

function clearPending(node) {
  if (!node) return;
  node.disabled = false;
  node.removeAttribute("aria-busy");
  delete node.dataset.pending;
  const label = node.querySelector(".cta-text, .t-label");
  if (label?.dataset.previousLabel) {
    label.textContent = label.dataset.previousLabel;
    delete label.dataset.previousLabel;
  }
}

function contractEmit(event, payload, message, pendingNode = null) {
  emitWithTimeout(host.emitServer, event, payload, {
    onResponse: response => {
      if (response?.success === false) {
        clearPending(pendingNode);
        ackFailure(response, message);
        return;
      }
      host.renderRightRail();
    },
    onTimeout: () => {
      clearPending(pendingNode);
      host.say("The deal response timed out. Your Finance rail will refresh when the connection returns.");
      host.renderChat();
      host.refreshEconomySnapshot();
    }
  });
}

function onDealView(node) {
  if (!node) return false;
  const [kind, id] = String(node.dataset.dealView || "").split(":");
  if (!kind || !id) return false;
  host.openDealDetails(kind, id, node);
  return true;
}

function onContractRepay(node) {
  if (!node) return false;
  if (!markPending(node)) return false;
  const input = node.closest(".contract-repay-controls")?.querySelector("[data-contract-repay-amount]");
  const amount = Math.floor(Number(input?.value) || 0);
  const payload = { contractId: node.dataset.playerContractRepay, requestId: host.createRequestId("contract-repay") };
  if (amount > 0) payload.amount = amount;
  contractEmit("repay-player-contract", payload, "The player loan could not be repaid.", node);
  return true;
}

function marketQuantity() {
  const raw = Number($("#market-quantity")?.value) || 1;
  return Math.max(1, Math.min(1000, Math.floor(raw)));
}

function mergeEconomySnapshot(response) {
  if (!response?.economy) return;
  const economy = response.economy;
  state.economy = {
    ...state.economy,
    ...economy,
    market: { ...state.economy.market, ...(economy.market || {}) },
    casino: { ...state.economy.casino, ...(economy.casino || {}) },
  };
}

function onMarketOrder(node) {
  if (!node || !markPending(node)) return false;
  const quantity = marketQuantity();
  const requestId = host.createRequestId("market");
  emitWithTimeout(host.emitServer, "market-order", { instrumentId: node.dataset.marketId, side: node.dataset.marketSide, quantity, requestId }, {
    onResponse: response => {
      if (response?.success === false) {
        clearPending(node);
        ackFailure(response, "Market order could not be completed.");
        return;
      }
      mergeEconomySnapshot(response);
      host.renderRightRail();
    },
    onTimeout: () => {
      clearPending(node);
      host.say("Market response timed out. Your positions will refresh when the connection returns.");
      host.renderChat();
      host.refreshEconomySnapshot();
    }
  });
  return true;
}

function onBankAction(node) {
  if (!node || !markPending(node)) return false;
  const eventName = node.dataset.bankAction === "take" ? "take-bank-loan" : "repay-bank-loan";
  const payload = { requestId: host.createRequestId(eventName) };
  if (eventName === "repay-bank-loan") {
    const input = node.closest(".finance-repay-controls")?.querySelector("[data-bank-repay-amount]");
    const amount = Math.floor(Number(input?.value) || 0);
    if (amount > 0) payload.amount = amount;
  }
  emitWithTimeout(host.emitServer, eventName, payload, {
    onResponse: response => {
      if (response?.success === false) {
        clearPending(node);
        ackFailure(response, "The bank transaction could not be completed.");
        return;
      }
      host.refreshEconomySnapshot();
    },
    onTimeout: () => {
      clearPending(node);
      host.say("Bank response timed out. Your wallet will refresh when the connection returns.");
      host.renderChat();
      host.refreshEconomySnapshot();
    }
  });
  return true;
}

function financeOpenMode(node) {
  if (node.dataset.financeOpen) return node.dataset.financeOpen;
  return "loan";
}

function onFinanceOpen(node) {
  if (!node) return false;
  host.openFinancingModal(financeOpenMode(node), null, node);
  return true;
}

function onWalletOpen(node) {
  if (!node) return false;
  host.openWalletModal(node.dataset.walletOpen || "account", node);
  return true;
}

function onMarketDeskOpen(node) {
  if (!node) return false;
  host.openMarketDesk(node);
  return true;
}

function onCasinoDeskOpen(node) {
  if (!node) return false;
  host.openCasinoDesk(node);
  return true;
}

function onDealsFilter(node) {
  if (!node) return false;
  state.dealsFilter = node.dataset.dealsFilter || "needs-you";
  state.tab = "deals";
  host.renderRightRail();
  requestAnimationFrame(() => document.querySelector(`#deals-filter-${state.dealsFilter}`)?.focus({ preventScroll: true }));
  return true;
}

function onActivityMode(node) {
  if (!node) return false;
  state.activityMode = node.dataset.activityMode || "indexes";
  state.tab = "activity";
  host.renderRightRail();
  requestAnimationFrame(() => document.querySelector(`#activity-mode-${state.activityMode}`)?.focus({ preventScroll: true }));
  host.refreshEconomySnapshot();
  return true;
}

function onBuyTile(node) {
  if (!node || node.disabled) return false;
  host.buyTile(TILES[Number(node.dataset.buy)]);
  return true;
}

function onTradeOpen(node) {
  if (!node || node.disabled) return false;
  host.openTradeModal(node.dataset.trade, node);
  return true;
}

function onFinanceView(node) {
  if (!node) return false;
  host.openFinancingContract(node.dataset.financeView, node);
  return true;
}

function onSpectatorLeave(node) {
  if (!node) return false;
  host.leaveRoomForHome();
  return true;
}

const RAIL_CLICKS = [
  ["[data-spectator-leave]", onSpectatorLeave],
  ["[data-wallet-open]", onWalletOpen],
  ["[data-market-desk]", onMarketDeskOpen],
  ["[data-casino-desk]", onCasinoDeskOpen],
  ["[data-deals-filter]", onDealsFilter],
  ["[data-activity-mode]", onActivityMode],
  ["[data-deal-view]", onDealView],
  ["[data-player-contract-repay]", onContractRepay],
  ["[data-market-order]", onMarketOrder],
  ["[data-bank-action]", onBankAction],
  ["[data-finance-open]", onFinanceOpen],
  ["[data-buy]", onBuyTile],
  ["[data-trade]", onTradeOpen],
  ["[data-finance-view]", onFinanceView],
];

export function onRailClick(event) {
  for (const [selector, handler] of RAIL_CLICKS) {
    const node = event.target.closest(selector);
    if (handler(node)) return;
  }
}

export function onRailSubmit() {
  // Activity forms live in their focused modals. Keep this seam for the
  // existing rail binding so future Holdings forms can opt in explicitly.
}
