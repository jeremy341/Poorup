// FINANCING: modal lifecycle, action submission and event wiring for the deal screens.
import { clampCollateralToRecipient, clampPropertyToRecipient, defaultRecipientId, financingActiveContracts, financingRecipientValid, financingSelectedContract, financingSendBlocked, financingSendPayload, financingState, otherPlayers, recipientPlayer } from "./clientFinancingState.js";
import { $ } from "./clientDom.js";
import { financingMyServerId, host } from "./clientDealHost.js";
import { contractLabel, playerFinanceEnabled } from "./clientFinanceRules.js";
import { state } from "./clientState.js";
import { equityTransferFormValid, equityTransferPayload, equityTransferRequestId, setNodeDisabled } from "./clientFinancingTransfer.js";
import { canNegotiateContract, currentNegotiationContract, findNegotiationContract, financingNegotiationHTML, loadNegotiationDraft, negotiationActionFor, negotiationFieldChanged, negotiationPayload } from "./clientFinancingNegotiation.js";
import { financingDealViewHTML, financingMissingContractHTML } from "./clientFinancingDeal.js";
import { bindCollateralPicker, financingBuilderHTML, onFinancingChange, onFinancingInput, refreshFinancingPreview, syncFinancingRanges } from "./clientFinancingPreview.js";
import { emitIntent } from "./clientRequestController.js";
import { bindDropdowns } from "./clientParlorDropdown.js";
import { spriteHTML } from "./clientSprites.js";
import { closeButtonHTML } from "./clientCloseButton.js";
import { TILES } from "./clientBoardData.js";
import { closeSurface, openSurface } from "./clientSurfaces.js";
export function onFinancingRecipientSet(value) {
  if (!financingRecipientValid(value)) return;
  financingState.previewDraft.recipientId = value;
  clampPropertyToRecipient();
  clampCollateralToRecipient();
  renderFinancingModal();
  $("#finance-recipient-trigger")?.focus({ preventScroll: true });
}
export function sendFinancingContract(control = document.activeElement) {
  const statusNode = host.captureActionStatusNode(control);
  const error = financingSendBlocked();
  if (error) {
    host.announceActionStatus(error, statusNode);
    return;
  }
  const recipient = recipientPlayer();
  host.emitServer("propose-player-contract", financingSendPayload(recipient), (response) => {
    if (response?.success === false) {
      host.announceActionStatus(response.error || "The player contract could not be sent.", statusNode);
      return;
    }
    host.renderRightRail();
    closeFinancingModal();
  });
}
export function onEquityTransferSubmit(event) {
  if (!playerFinanceEnabled(state.settings)) return;
  const form = event.target.closest("[data-equity-transfer-form]");
  if (!form) return;
  event.preventDefault();
  const sharePct = Number(form.elements.sharePct.value);
  const maxShare = Number(form.elements.sharePct.max);
  const price = Number(form.elements.price.value);
  if (!equityTransferFormValid(form, sharePct, maxShare, price)) return;
  const payload = equityTransferPayload({
    fromPlayerId: financingMyServerId(),
    toPlayerId: form.elements.toPlayerId.value,
    contractId: form.dataset.contractId,
    sharePct,
    price,
    requestId: equityTransferRequestId(),
  });
  const submit = form.querySelector('[type="submit"]');
  setNodeDisabled(submit, true);
  const statusNode = host.captureActionStatusNode(submit || form);
  host.emitServer("propose-equity-share-transfer", payload, response => {
    if (response?.success === false) {
      setNodeDisabled(submit, false);
      host.announceActionStatus(response.error || "The equity transfer offer could not be sent.", statusNode);
      return;
    }
    host.recordActivity("Equity transfer offer sent. Cash and shares move only if it is accepted.");
    host.renderRightRail();
    renderFinancingModal();
  });
}
export function financingViewBodyHTML() {
  if (financingState.view === "negotiate") {
    const contract = currentNegotiationContract();
    return contract ? financingNegotiationHTML(contract) : financingMissingContractHTML();
  }
  if (financingState.view === "deal") return financingDealViewHTML();
  return financingBuilderHTML();
}
export function sendFinancingNegotiation(control = document.activeElement) {
  const statusNode = host.captureActionStatusNode(control);
  const contract = currentNegotiationContract();
  if (!canNegotiateContract(contract) || contract.id !== financingState.negotiationContractId || negotiationActionFor(contract) !== financingState.negotiationAction) return;
  host.emitServer(financingState.negotiationAction === "adjust" ? "adjust-player-contract" : "counter-player-contract", negotiationPayload(contract), (response) => {
    if (response?.success === false) {
      host.announceActionStatus(response.error || "The contract counteroffer could not be sent.", statusNode);
      return;
    }
    state.playerContractOffer = null;
    state.negotiationContractId = null;
    host.renderRightRail();
    closeFinancingModal();
  });
}
export function repaymentAmountForContract(contract, rawAmount) {
  const remaining = Math.max(0, Math.floor(Number(contract?.remaining) || 0));
  const requested = Math.floor(Number(rawAmount));
  if (remaining <= 0) return 0;
  if (!Number.isFinite(requested)) return 0;
  if (requested <= 0) return 0;
  return Math.min(requested, remaining);
}

export function repayInputValue(contractId) {
  return $("#financing-repay-" + contractId)?.value;
}

export function contractRemainingAmount(contract) {
  return Math.max(0, Math.floor(Number(contract.remaining) || 0));
}

export function settledRepayment(response, amount, remainingBefore) {
  const remainingAfter = Number(response?.contract?.remaining);
  if (!Number.isFinite(remainingAfter)) return amount;
  return Math.max(0, Math.min(amount, remainingBefore - remainingAfter));
}

export function sendFinancingRepay(contractId, control = document.activeElement) {
  const statusNode = host.captureActionStatusNode(control);
  const contract = financingActiveContracts().find((c) => c.id === contractId);
  if (!contract) return;
  const amount = repaymentAmountForContract(contract, repayInputValue(contractId));
  if (!amount) {
    host.announceActionStatus("Enter a positive repayment amount.", statusNode);
    return;
  }
  const remainingBefore = contractRemainingAmount(contract);
  // One request (one requestId) per repay intent: a double click before the
  // acknowledgement must not repay the same amount twice.
  const payload = { contractId, amount, requestId: host.createRequestId("contract-repay") };
  emitIntent(host.emitServer, `repay-player-contract:${contractId}`, "repay-player-contract", payload, {
    onResponse: (response) => {
      if (response?.success === false) {
        host.announceActionStatus(response.error || "The player loan could not be repaid.", statusNode);
        return;
      }
      const settled = settledRepayment(response, amount, remainingBefore);
      const status = `Repaid $${settled.toLocaleString()} on the player loan.`;
      financingState.repayStatus = { contractId, text: status };
      host.renderRightRail();
      renderFinancingModal();
    },
    onTimeout: () => host.announceActionStatus("The repayment could not be confirmed. Check the loan before retrying.", statusNode),
  });
}

export function onFinancingRepayNode(event) {
  const repay = event.target.closest("[data-financing-repay]");
  if (!repay) return false;
  sendFinancingRepay(repay.dataset.financingRepay, repay);
  return true;
}

export function onFinancingPickNode(event) {
  const pick = event.target.closest("[data-financing-pick]");
  if (!pick) return false;
  financingState.surfaceContractId = pick.dataset.financingPick;
  financingState.surfaceTileIndex = null;
  renderFinancingModal();
  return true;
}

export function onFinancingDeedNode(event) {
  const deed = event.target.closest("[data-financing-deed]");
  if (!deed) return false;
  financingState.surfaceTileIndex = Number(deed.dataset.financingDeed);
  renderFinancingModal();
  return true;
}

export function financingViewRequested(value) {
  if (value === "deal") return "deal";
  return "builder";
}

export function onFinancingViewNode(event) {
  const button = event.target.closest("button[data-financing-view]");
  if (!button) return false;
  financingState.view = financingViewRequested(button.dataset.financingState.view);
  renderFinancingModal();
  return true;
}

export function onFinancingSurfaceClick(event) {
  if (onFinancingRepayNode(event)) return;
  if (onFinancingPickNode(event)) return;
  if (onFinancingDeedNode(event)) return;
  if (onFinancingViewNode(event)) return;
}

export function onFinancingModeTab(event) {
  const button = event.target.closest("[data-financing-mode]");
  if (!button || !["loan", "equity"].includes(button.dataset.financingMode)) return;
  financingState.previewMode = button.dataset.financingMode;
  clampPropertyToRecipient();
  clampCollateralToRecipient();
  renderFinancingModal();
  $(`#financing-tab-${financingState.previewMode}`)?.focus({ preventScroll: true });
}

export function onFinancingModeKeydown(event) {
  const button = event.target.closest("[data-financing-mode]");
  if (!button || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const mode = event.key === "Home" ? "loan" : event.key === "End" ? "equity" : button.dataset.financingMode === "loan" ? "equity" : "loan";
  onFinancingModeTab({ target: { closest: () => ({ dataset: { financingMode: mode } }) } });
}

export function onFinancingDropdownSelect(id, value) {
  if (id === "finance-recipient") {
    onFinancingRecipientSet(value);
    return;
  }
  if (id === "finance-property") financingState.previewDraft.propertyIndex = Number(value);
  refreshFinancingPreview();
}

export function bindFinancingOfferSurface(card) {
  bindCollateralPicker(card);
  $("#financing-mode-tabs")?.addEventListener("click", onFinancingModeTab);
  $("#financing-mode-tabs")?.addEventListener("keydown", onFinancingModeKeydown);
  if (!card.dataset.financingInputBound) {
    card.addEventListener("input", (event) => onFinancingInput(card, event));
    card.addEventListener("change", (event) => onFinancingChange(card, event));
    card.dataset.financingInputBound = "true";
  }
  bindDropdowns(card, onFinancingDropdownSelect);
}

export function wireFinancingChrome() {
  $("#financing-close")?.addEventListener("click", closeFinancingModal);
  $("#financing-send")?.addEventListener("click", event => sendFinancingContract(event.currentTarget));
  $("#financing-negotiate-send")?.addEventListener("click", event => sendFinancingNegotiation(event.currentTarget));
  const card = $("#financing-card");
  if (card) bindCollateralPicker(card);
  if (card && !card.dataset.negotiationInputBound) {
    card.addEventListener("input", negotiationFieldChanged);
    card.addEventListener("change", negotiationFieldChanged);
    card.dataset.negotiationInputBound = "true";
  }
}

export function financingIsBuilderView() {
  return financingState.view !== "deal";
}

export function renderFinancingModal() {
  const card = $("#financing-card");
  if (!card) return;
  const modeLabels = { loan: "LOAN", equity: "RENT SHARE", hybrid: "LEGACY CONVERTIBLE NOTE" };
  const negotiating = financingState.view === "negotiate";
  const viewingContract = financingState.view === "deal";
  const activeContract = viewingContract ? financingSelectedContract() : null;
  card.dataset.financingView = financingState.view;
  card.dataset.financingMode = financingState.previewMode;
  const activeMode = activeContract ? contractLabel(activeContract).toUpperCase() : "CONTRACT";
  const headerKicker = negotiating ? "DEAL NEGOTIATION · COUNTER TERMS" : "PARLOR DEAL BUILDER · LIVE TERMS";
  const headerTitle = negotiating
    ? `Negotiate a ${modeLabels[financingState.previewMode] || "CONTRACT"} deal`
    : viewingContract ? `${activeMode} contract` : `Shape a ${modeLabels[financingState.previewMode] || "LOAN"} deal`;
  const headerDescription = negotiating
    ? "No cash moves until the original proposer accepts your revised terms."
    : "";
  const header = `<div class="financing-head${viewingContract ? " financing-head-contract" : ""}">${viewingContract ? `<h2 class="t-section g100" id="financing-card-title">${activeMode} contract</h2>` : `<div class="slip-head"><span class="slip-icon" aria-hidden="true">${spriteHTML("note", 5)}</span><div><div class="t-micro g400">${headerKicker}</div><h2 class="t-section g100" id="financing-card-title">${headerTitle}</h2></div></div>`}${negotiating ? '<span class="t-micro financing-badge">COUNTEROFFER</span>' : ""}${closeButtonHTML({ id: "financing-close", label: "Close financing dialog", className: "financing-close" })}</div>${headerDescription ? `<p class="t-body ink-2 financing-description" id="financing-card-description">${headerDescription}</p>` : ""}`;
  card.innerHTML = `<div class="slip-rail slip-rail-gold"></div><div class="financing-body${viewingContract ? " financing-body-contract" : ""}"${viewingContract ? ' tabindex="0" role="region" aria-label="Active contract terms and repayment"' : ""}>${header}${financingViewBodyHTML()}</div>`;
  syncFinancingRanges(card);
  wireFinancingChrome();
  if (!card.dataset.financingSurfaceBound) {
    card.addEventListener("click", onFinancingSurfaceClick);
    card.addEventListener("submit", onEquityTransferSubmit);
    card.dataset.financingSurfaceBound = "true";
  }
  if (financingIsBuilderView()) bindFinancingOfferSurface(card);
}

export function ensureFinancingRecipient() {
  if (financingRecipientValid(financingState.previewDraft.recipientId)) return;
  financingState.previewDraft.recipientId = defaultRecipientId();
}

export function ensureFinancingDraft(propertyIndex) {
  ensureFinancingRecipient();
  if (propertyIndex != null && TILES[Number(propertyIndex)]?.kind === "property") financingState.previewDraft.propertyIndex = Number(propertyIndex);
  clampPropertyToRecipient();
  clampCollateralToRecipient();
}

export function openFinancingContract(contractId, trigger = null) {
  const contract = financingActiveContracts().find((c) => c.id === contractId);
  if (!contract) {
    host.announceActionStatus("That contract is no longer live.", host.captureActionStatusNode(trigger || document.activeElement));
    return;
  }
  financingState.surfaceContractId = contractId;
  financingState.surfaceTileIndex = null;
  financingState.view = "deal";
  renderFinancingModal();
  openSurface("#financing-modal", "#financing-close", { trigger });
}

export function financingPreviewModeFor(mode) {
  if (mode === "equity") return "equity";
  // Convertible notes are not offered; existing ones still display.
  return "loan";
}

export function openFinancingModal(mode = "loan", propertyIndex = null, trigger = null) {
  if (!playerFinanceEnabled(state.settings)) {
    host.announceActionStatus("Player Finance is disabled for this table.", host.captureActionStatusNode(trigger || document.activeElement));
    return;
  }
  if (!otherPlayers().length) {
    host.announceActionStatus("No other players at the table.", host.captureActionStatusNode(trigger || document.activeElement));
    return;
  }
  financingState.previewMode = financingPreviewModeFor(mode);
  financingState.view = "builder";
  ensureFinancingDraft(propertyIndex);
  renderFinancingModal();
  openSurface("#financing-modal", "#financing-close", { trigger });
  if (financingIsBuilderView()) $("#finance-recipient-trigger")?.focus({ preventScroll: true });
}
export function closeFinancingModal() {
  financingState.negotiationContractId = null;
  financingState.negotiationAction = "counter";
  state.negotiationContractId = null;
  closeSurface("#financing-modal");
}
export function openFinancingNegotiation(contractId, trigger = null) {
  const contract = findNegotiationContract(contractId);
  if (!canNegotiateContract(contract)) {
    host.announceActionStatus("Enable Player Finance and rebuild this offer with the current contract terms.", host.captureActionStatusNode(trigger || document.activeElement));
    return;
  }
  if (!contract || contract.id !== contractId) {
    host.announceActionStatus("That contract offer is no longer live.", host.captureActionStatusNode(trigger || document.activeElement));
    return;
  }
  financingState.negotiationContractId = contractId;
  state.negotiationContractId = contractId;
  financingState.negotiationAction = negotiationActionFor(contract);
  loadNegotiationDraft(contract);
  financingState.previewMode = contract.kind || "loan";
  financingState.view = "negotiate";
  renderFinancingModal();
  openSurface("#financing-modal", "#financing-close", { trigger });
}
