import { esc } from "./clientDom.js";
import { emitWithTimeout } from "./clientRequestController.js";

let host = {
  getOffer: () => null,
  openSurface: () => {},
  closeSurface: () => {},
  emitServer: () => {},
  createRequestId: () => "",
  announceActionStatus: () => {},
  captureActionStatusNode: () => null,
  refreshEconomySnapshot: () => {},
};

function money(value) {
  return `$${Number(value || 0).toLocaleString()}`;
}

function defaultConsequence(offer) {
  return offer.collateralName && offer.collateralName !== "NONE"
    ? `If you cannot repay by the end of the cure round, the bank seizes ${esc(offer.collateralName)}.`
    : "If you cannot repay by the end of the cure round, the bank collects what it can; any remaining balance enters bank debt settlement.";
}

export function bankLoanConfirmationHTML(offer) {
  if (!offer?.available) return "";
  const collateral = offer.collateralName || "NONE";
  const interestRate = Number(offer.principal) > 0
    ? `${(Number(offer.premium || 0) / Number(offer.principal) * 100).toFixed(0)}%`
    : "—";
  const terms = [
    ["ADVANCE", money(offer.principal)],
    ["INTEREST", `${money(offer.premium)} · ${interestRate}`],
    ["TOTAL DUE", money(offer.totalDue)],
    ["DUE ROUND", offer.dueRound ?? "—"],
    ["CURE ROUND", offer.cureRound ?? "—"],
    ["SEVERITY", String(offer.severity || "—").toUpperCase()],
    ["COLLATERAL", collateral],
  ];
  return `<div class="bank-offer-content"><div class="bank-offer-head"><span class="t-micro g400">BANK CREDIT · CONFIRM TERMS</span><h2 class="t-section g100" id="bank-loan-title">Emergency liquidity</h2><p class="t-body ink-2" id="bank-loan-description">Review the server-provided offer before accepting.</p></div><dl class="bank-offer-terms">${terms.map(([label, value]) => `<div class="${label === "COLLATERAL" ? "bank-offer-collateral" : ""}"><dt class="t-micro ink-3">${label}</dt><dd class="t-label f12 g100">${esc(String(value))}</dd></div>`).join("")}</dl><p class="t-body ink-2 bank-offer-consequence">${defaultConsequence(offer)}</p><p class="t-micro ink-3 bank-offer-status" data-bank-offer-status role="status" aria-live="off" aria-atomic="true"></p></div><div class="bank-offer-actions"><button class="btn-dark" type="button" data-bank-offer-cancel>CANCEL</button><button class="cta-red" type="button" data-bank-offer-confirm><span class="cta-text cta-text-sm">ACCEPT ${money(offer.principal)}</span></button></div>`;
}

export function configureBankLoanUi(hooks) {
  host = { ...host, ...hooks };
}

function closeBankOffer() {
  host.closeSurface("#bank-loan-modal");
}

function restoreConfirmButton(button) {
  button.disabled = false;
  button.removeAttribute("aria-busy");
}

function showBankOfferFailure(button, statusNode, message) {
  restoreConfirmButton(button);
  if (statusNode) statusNode.textContent = message;
  host.announceActionStatus(message, statusNode);
}

function handleBankOfferResponse(button, statusNode, response) {
  if (response?.success === false) {
    const message = response.error || "The bank transaction could not be completed.";
    showBankOfferFailure(button, statusNode, message);
    return;
  }
  host.refreshEconomySnapshot();
  closeBankOffer();
}

function confirmBankOffer(button) {
  if (!button || button.disabled) return;
  const card = button.closest("#bank-loan-card");
  const statusNode = card?.querySelector("[data-bank-offer-status]") || host.captureActionStatusNode(button);
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  emitWithTimeout(host.emitServer, "take-bank-loan", { requestId: host.createRequestId("take-bank-loan") }, {
    onResponse: response => handleBankOfferResponse(button, statusNode, response),
    onTimeout: () => {
      showBankOfferFailure(button, statusNode, "Bank response timed out. Your wallet will refresh when the connection returns.");
      host.refreshEconomySnapshot();
    },
  });
}

export function openBankLoanOffer(trigger) {
  const offer = host.getOffer();
  if (!offer?.available) return false;
  const card = document.querySelector("#bank-loan-card");
  if (!card) return false;
  card.innerHTML = bankLoanConfirmationHTML(offer);
  host.openSurface("#bank-loan-modal", "[data-bank-offer-cancel]", { trigger });
  return true;
}

export function bindBankLoanUi() {
  const card = document.querySelector("#bank-loan-card");
  if (!card) return;
  const surface = document.querySelector("#bank-loan-modal");
  if (!surface) return;
  if (card.dataset.bankLoanUiBound) return;
  card.dataset.bankLoanUiBound = "true";
  const onClick = event => {
    const cancel = event.target.closest("[data-bank-offer-cancel]");
    if (cancel) {
      closeBankOffer();
      return;
    }
    const confirm = event.target.closest("[data-bank-offer-confirm]");
    if (confirm) confirmBankOffer(confirm);
  };
  card.addEventListener("click", onClick);
  surface.addEventListener("click", event => {
    if (event.target.closest("[data-bank-loan-close]")) closeBankOffer();
  });
  surface.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeBankOffer();
  });
}
