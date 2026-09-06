/* ============================================================
   RAIL EVENTS: the click/submit dispatch tables for #rr-body
   (player contracts, market, bank loans, financing, deeds,
   trades, casino). Handlers run in the exact order of the old
   if-chain; disabled controls fall through like they did before.
   Game-bound functions are injected by the entry module.
   ============================================================ */
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import { TILES } from "./clientBoardData.js";

let host = {
  emitServer: noop,
  say: noop,
  renderChat: noop,
  renderRightRail: noop,
  createRequestId: noop,
  buyTile: noop,
  openTradeModal: noop,
  openFinancingModal: noop,
  openFinancingContract: noop,
};

function noop() {}

export function configureRailEvents(hooks) {
  host = { ...host, ...hooks };
}

function ackFailure(response, message) {
  host.say(response.error || message);
  host.renderChat();
}

function contractEmit(event, payload, message) {
  host.emitServer(event, payload, (response) => {
    if (response?.success === false) {
      ackFailure(response, message);
      return;
    }
    host.renderRightRail();
  });
}

function onContractCancel(node) {
  if (!node) return false;
  contractEmit("cancel-player-contract", { requestId: host.createRequestId("contract-cancel") }, "The pending contract could not be canceled.");
  return true;
}

function onContractResponse(node) {
  if (!node) return false;
  const accept = node.dataset.playerContractAction === "accept";
  host.emitServer("respond-player-contract", { accept, requestId: host.createRequestId("contract-response") }, (response) => {
    if (response?.success === false) {
      ackFailure(response, "The player contract could not be updated.");
      return;
    }
    state.playerContractOffer = null;
    host.renderRightRail();
  });
  return true;
}

function onContractRepay(node) {
  if (!node) return false;
  contractEmit("repay-player-contract", { contractId: node.dataset.playerContractRepay, requestId: host.createRequestId("contract-repay") }, "The player loan could not be repaid.");
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
  if (!node || node.disabled) return false;
  const quantity = marketQuantity();
  host.emitServer("market-order", { instrumentId: node.dataset.marketId, side: node.dataset.marketSide, quantity, requestId: host.createRequestId("market") }, (response) => {
    if (response?.success === false) {
      ackFailure(response, "Market order could not be completed.");
      return;
    }
    mergeEconomySnapshot(response);
    host.renderRightRail();
  });
  return true;
}

function onBankAction(node) {
  if (!node || node.disabled) return false;
  const eventName = node.dataset.bankAction === "take" ? "take-bank-loan" : "repay-bank-loan";
  host.emitServer(eventName, { requestId: host.createRequestId(eventName) }, (response) => {
    if (response?.success === false) {
      ackFailure(response, "The bank transaction could not be completed.");
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

function onBuyTile(node) {
  if (!node || node.disabled) return false;
  host.buyTile(TILES[Number(node.dataset.buy)]);
  return true;
}

function onTradeOpen(node) {
  if (!node || node.disabled) return false;
  host.openTradeModal(node.dataset.trade);
  return true;
}

function onFinanceView(node) {
  if (!node) return false;
  host.openFinancingContract(node.dataset.financeView, node);
  return true;
}

const RAIL_CLICKS = [
  ["[data-player-contract-cancel]", onContractCancel],
  ["[data-player-contract-action]", onContractResponse],
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

function casinoBet(form) {
  const color = form.querySelector("input[name=casino-color]:checked")?.value || "red";
  const stake = Math.max(1, Math.floor(Number(form.querySelector("[name=stake]")?.value) || 0));
  return { color, stake };
}

function onCasinoForm(event, form) {
  event.preventDefault();
  const bet = casinoBet(form);
  host.emitServer("place-casino-bet", { ...bet, requestId: host.createRequestId("casino") }, (response) => {
    if (response?.success === false) {
      ackFailure(response, "Casino bet could not be completed.");
      return;
    }
    mergeEconomySnapshot(response);
    host.renderRightRail();
  });
  return true;
}

const RAIL_SUBMITS = [
  ["[data-casino-form]", onCasinoForm],
];

export function onRailSubmit(event) {
  for (const [selector, handler] of RAIL_SUBMITS) {
    const form = event.target.closest(selector);
    if (!form) continue;
    handler(event, form);
    return;
  }
}
