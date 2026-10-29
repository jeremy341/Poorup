import { esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { collateralCreditSummary } from "./clientFinanceRules.js";
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
  const credit = collateralCreditSummary(offer);
  if (credit) return `Final deadline: round ${esc(String(offer.cureRound ?? "-"))}. Default transfers pledged deeds. ${esc(credit)}`;
  const deadline = `Final deadline: round ${esc(String(offer.cureRound ?? "-"))}.`;
  return offer.collateralName && offer.collateralName !== "NONE"
    ? `${deadline} If the loan is still unpaid, the bank seizes ${esc(offer.collateralName)}.`
    : `${deadline} Remaining debt enters settlement.`;
}

export function bankLoanConfirmationHTML(offer) {
  if (!offer?.available) return "";
  const collateral = offer.collateralName && offer.collateralName !== "NONE" ? offer.collateralName : "None";
  const interestRate = Number(offer.principal) > 0
    ? `${(Number(offer.premium || 0) / Number(offer.principal) * 100).toFixed(0)}%`
    : "-";
  return `<div class="bank-offer-content">
    <header class="bank-offer-head">
      <h2 class="t-section g100" id="bank-loan-title">Emergency bank loan</h2>
      <button class="btn-dark bank-offer-close" type="button" data-bank-loan-close aria-label="Close emergency bank loan">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
      </button>
    </header>
    <p class="t-body ink-2" id="bank-loan-description">You receive <strong class="g100">${money(offer.principal)}</strong> now.</p>
    <dl class="bank-offer-terms">
      <div><dt class="t-body ink-2">Repay</dt><dd class="t-label g100"><strong>${money(offer.totalDue)}</strong><span class="bank-offer-interest t-body ink-2">${money(offer.premium)} interest · ${interestRate}</span></dd></div>
      <div><dt class="t-body ink-2">Due</dt><dd class="t-label g100">Round ${esc(String(offer.dueRound ?? "-"))}</dd></div>
      <div class="bank-offer-collateral"><dt class="t-body ink-2">Collateral</dt><dd class="t-label g100">${esc(collateral)}</dd></div>
    </dl>
    <p class="t-body ink-2 bank-offer-consequence">${defaultConsequence(offer)}</p>
    <p class="t-body bank-offer-status" data-bank-offer-status role="status" aria-live="off" aria-atomic="true"></p>
  </div>
  <div class="bank-offer-actions">
    <button class="btn-dark" type="button" data-bank-offer-cancel><span class="t-label f13">Cancel</span></button>
    <button class="cta-red" type="button" data-bank-offer-confirm><span class="cta-text cta-text-sm">Borrow ${money(offer.principal)}</span></button>
  </div>`;
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
  if (!button || button.disabled || state.settings.bankLoans !== true) return;
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
  if (!offer?.available || state.settings.bankLoans !== true) return false;
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
