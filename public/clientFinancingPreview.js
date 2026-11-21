// FINANCING: the deal-builder form, live contract preview and the collateral deed picker.
import { baseRentOf, boundedInteger, financingAmount, financingAmountError, financingEligibleCollateralIndex, financingEligibleCollateralIndices, financingEquityDurationRounds, financingHasEligibleProperty, financingLoanErrors, financingLoanTerms, financingPropertyMissing, financingPropertyOptions, financingPropertyRequired, financingPropertyTile, financingRecipientCollateralDeeds, financingRecipientDeeds, financingRecipientId, financingRecipients, financingSendBlocked, financingState, recipientPlayer } from "./clientFinancingState.js";
import { TILES } from "./clientBoardData.js";
import { dropdownHTML } from "./clientParlorDropdown.js";
import { collateralCreditSummary, rentShareDisclosure } from "./clientFinanceRules.js";
import { state } from "./clientState.js";
import { $, esc } from "./clientDom.js";
export function financingPreviewTile() {
  if (financingState.previewMode === "loan") {
    const collateralIndex = financingEligibleCollateralIndex();
    return collateralIndex == null ? null : financingPropertyTile(collateralIndex);
  }
  const tile = TILES[Number(financingState.previewDraft.propertyIndex)];
  if (tile && ["property", "railroad", "utility"].includes(tile.kind)) return tile;
  return financingRecipientDeeds()[0] || TILES[21];
}

export function financingPreviewKicker() {
  const recipient = recipientPlayer();
  if (!recipient) return "CONTRACT PREVIEW";
  return `CONTRACT PREVIEW · TO ${recipient.name}`;
}

export function financingNoDeedsHintHTML() {
  if (financingHasEligibleProperty()) return "";
  return `<p class="t-micro ink-3">NO ELIGIBLE DEEDS · PICK ANOTHER PLAYER</p>`;
}

export function financingPropertyPickerHTML() {
  if (!financingPropertyRequired()) return "";
  return `${financingNoDeedsHintHTML()}${dropdownHTML({ id: "finance-property", label: "Property (their deed)", value: financingState.previewDraft.propertyIndex, options: financingPropertyOptions() })}`;
}

export function financingSendDisabled() {
  return Boolean(financingSendBlocked());
}

export function financingPreviewBase() {
  const tile = financingPreviewTile();
  const amount = financingAmount();
  const rent = tile ? baseRentOf(tile) : 0;
  return { tile, amount, rent };
}

export function previewEquityDuration() {
  return `${financingEquityDurationRounds()} ROUNDS`;
}

export function equityPreviewCopy(tile, amount, rent) {
  const share = Math.max(5, Math.min(100, Number(financingState.previewDraft.equityShare) || 10));
  const lenderRent = Math.floor((rent * share) / 100);
  const duration = previewEquityDuration();
  return {
    title: `${share}% RENT SHARE · ${tile.name}`,
    focal: ["BASE RENT SHARE", `$${lenderRent} OF $${rent}`],
    metrics: [
      ["CONTRIBUTION", `$${amount}`],
      ["SHARE", `${share}%`],
      ["DURATION", duration],
    ],
    copy: "",
    note: rentShareDisclosure({ durationRounds: financingEquityDurationRounds() }),
  };
}

export function loanPreviewCopy(tile, amount) {
  const { premiumRate: rate, durationRounds: duration } = financingLoanTerms();
  const premium = Math.ceil((amount * rate) / 100);
  const total = amount + premium;
  const collateral = financingEligibleCollateralIndices().map(index => financingPropertyTile(index)).filter(Boolean);
  const secured = collateral.length > 0;
  return {
    title: secured ? `SECURED LOAN · ${tile.name}` : "UNSECURED LOAN",
    focal: ["TOTAL DUE", `$${total}`],
    metrics: [
      ["ADVANCE", `$${amount}`],
      ["INTEREST", `$${premium} · ${rate}%`],
      ["TERM", `${duration} ROUNDS`],
    ],
    copy: secured
      ? "Default transfers pledged deeds."
      : "No deed is pledged.",
    note: secured ? financingCollateralCreditCopy(collateral, total) : "",
  };
}

export function financingCollateralCreditCopy(deeds, totalDue) {
  return collateralCreditSummary({
    collateralCreditVersion: 1,
    collateralCreditQuotes: deeds.map(deed => ({ name: deed.name, value: state.serverTiles.find(entry => Number(entry.index) === deed.i)?.price ?? deed.price })),
    totalDue,
  });
}

export function financingCollateralAccordionHTML() {
  const selected = new Set(financingEligibleCollateralIndices());
  const deeds = financingRecipientCollateralDeeds();
  return collateralPickerHTML({ id: "finance-collateral", deeds, selected, checkboxAttribute: "data-finance-collateral" });
}

export const FINANCE_PREVIEW_BUILDERS = {
  equity: equityPreviewCopy,
  loan: loanPreviewCopy,
};

export function financingPreviewCopy(mode = financingState.previewMode) {
  const { tile, amount, rent } = financingPreviewBase();
  const builder = FINANCE_PREVIEW_BUILDERS[mode] || loanPreviewCopy;
  return builder(tile, amount, rent);
}

export function financingPreviewEmptyHTML() {
  return `<div class="financing-preview-head"><span class="t-micro g400">${esc(financingPreviewKicker())}</span><span class="t-label f12 g100">NO TERMS TO PREVIEW</span></div><p class="t-body ink-2 financing-preview-copy">The counterparty owns no eligible deeds. Pick another player to shape a deal.</p>`;
}

export function financingPreviewHTML() {
  if (financingPropertyMissing()) return financingPreviewEmptyHTML();
  if (financingState.previewMode === "loan" && Object.values(financingLoanErrors()).some(Boolean)) return `<p class="t-body ink-2 financing-preview-copy">Enter valid loan terms to preview the contract.</p>`;
  const preview = financingPreviewCopy();
  return `<div class="financing-preview-head"><span class="t-micro g400">${esc(financingPreviewKicker())}</span><span class="t-label f12 g100">${esc(preview.title)}</span></div>
    ${preview.focal ? `<div class="financing-focal"><span class="t-micro ink-3">${preview.focal[0]}</span><strong class="slip-amount g050">${esc(preview.focal[1])}</strong></div>` : ""}
    <div class="financing-metrics">${preview.metrics.map(([label, value]) => `<div><span class="t-micro ink-3">${label}</span><strong class="t-label f13 g100">${esc(value)}</strong></div>`).join("")}</div>
    ${preview.copy ? `<p class="t-body ink-2 financing-preview-copy">${esc(preview.copy)}</p>` : ""}
    ${preview.note ? `<p class="t-micro ink-3 financing-preview-note">${esc(preview.note)}</p>` : ""}`;
}

export function financingModeFieldsHTML() {
  if (financingState.previewMode === "equity") {
    return `<div class="financing-field"><label class="t-label f11 g-muted" for="finance-equity-share">Share of collected rent <output id="finance-equity-share-output">${financingState.previewDraft.equityShare}%</output></label><div class="financing-range"><input id="finance-equity-share" type="range" min="5" max="100" step="5" value="${financingState.previewDraft.equityShare}" /></div></div><label class="financing-field"><span class="t-label f11 g-muted">Duration in rounds</span><div class="financing-number"><input class="field" id="finance-equity-duration" type="number" min="1" max="20" step="1" value="${financingEquityDurationRounds()}" /><span aria-hidden="true">ROUNDS</span></div></label>`;
  }

  return `<div class="financing-field-grid"><div class="financing-field"><label class="t-label f11 g-muted" for="finance-loan-rate">Total interest %</label><input class="field" id="finance-loan-rate" type="number" min="0" max="100" step="1" value="${esc(financingState.previewDraft.loanRate)}" aria-invalid="${Boolean(financingLoanErrors()["finance-loan-rate"])}" aria-describedby="finance-loan-rate-error" /><p class="t-micro red" id="finance-loan-rate-error">${financingLoanErrors()["finance-loan-rate"]}</p></div><div class="financing-field"><label class="t-label f11 g-muted" for="finance-loan-duration">Duration in rounds</label><div class="financing-number"><input class="field" id="finance-loan-duration" type="number" min="1" max="20" step="1" value="${esc(financingState.previewDraft.loanDuration)}" aria-invalid="${Boolean(financingLoanErrors()["finance-loan-duration"])}" aria-describedby="finance-loan-duration-error" /><span aria-hidden="true">ROUNDS</span></div><p class="t-micro red" id="finance-loan-duration-error">${financingLoanErrors()["finance-loan-duration"]}</p></div></div>${financingCollateralAccordionHTML()}`;
}
export function financingBuilderHTML() {
  const sendDisabled = financingSendDisabled();
  return `<section class="financing-surface-body financing-builder" aria-labelledby="financing-offer-heading"><div class="financing-mode-tabs" id="financing-mode-tabs" role="tablist" aria-label="Financing mode"><button class="financing-mode-tab${financingState.previewMode === "loan" ? " is-active" : ""}" type="button" role="tab" id="financing-tab-loan" aria-controls="financing-mode-panel" tabindex="${financingState.previewMode === "loan" ? "0" : "-1"}" aria-selected="${financingState.previewMode === "loan"}" data-financing-mode="loan"><span class="t-label f11">LOAN</span><span class="t-micro">FIXED RETURN</span></button><button class="financing-mode-tab${financingState.previewMode === "equity" ? " is-active" : ""}" type="button" role="tab" id="financing-tab-equity" aria-controls="financing-mode-panel" tabindex="${financingState.previewMode === "equity" ? "0" : "-1"}" aria-selected="${financingState.previewMode === "equity"}" data-financing-mode="equity"><span class="t-label f11">RENT SHARE</span><span class="t-micro">TEMPORARY · PASSIVE</span></button></div><h3 class="sr-only" id="financing-offer-heading">Financing offer builder</h3><div class="financing-form" id="financing-mode-panel" tabindex="0" role="tabpanel" aria-labelledby="financing-tab-${financingState.previewMode}">${dropdownHTML({ id: "finance-recipient", label: "Counterparty", value: financingRecipientId(), options: financingRecipients() })}${financingPropertyPickerHTML()}<div class="financing-field"><label class="t-label f11 g-muted" for="finance-amount">Cash advanced / contributed</label><input class="field" id="finance-amount" type="number" min="1" step="1" value="${financingState.previewDraft.amount}" aria-invalid="${Boolean(financingAmountError())}"${financingAmountError() ? ' aria-describedby="finance-amount-error"' : ""} /><p class="t-micro red financing-amount-error" id="finance-amount-error" role="status">${financingAmountError()}</p></div><div id="financing-mode-fields">${financingModeFieldsHTML()}</div></div><section class="financing-preview" id="financing-preview" tabindex="0" aria-label="Contract preview" aria-live="polite">${financingPreviewHTML()}</section><div class="financing-actions is-solo"><button class="cta-red${sendDisabled ? " financing-disabled-action" : ""}" id="financing-send" type="button" ${sendDisabled ? "disabled" : ""}><span class="cta-text cta-text-sm">SEND CONTRACT</span></button></div></section>`;
}

export function collateralPickerHTML({ id, deeds, selected, checkboxAttribute }) {
  const selectedDeeds = deeds.filter((tile) => selected.has(tile.i));
  const selectedLabel = selectedDeeds.length
    ? `${selectedDeeds.length} SELECTED · ${selectedDeeds.map((tile) => tile.name).join(", ")}`
    : "SELECT DEEDS…";
  const options = deeds.length
    ? deeds.map((tile) => `<label class="financing-collateral-option" data-collateral-option><input type="checkbox" ${checkboxAttribute} value="${tile.i}" ${selected.has(tile.i) ? "checked" : ""}><span class="t-label f11 g100" data-collateral-name>${esc(tile.name)}</span><span class="t-micro ink-3">$${Number(tile.price || 0).toLocaleString()}</span></label>`).join("")
    : '<span class="t-micro ink-3">NO ELIGIBLE DEEDS</span>';
  return `<div class="financing-collateral-picker" data-collateral-root><label class="t-label f11 g-muted" for="${id}-trigger">COLLATERAL · OPTIONAL</label><input class="field financing-collateral-trigger" type="text" id="${id}-trigger" data-collateral-trigger readonly aria-readonly="true" aria-label="Choose collateral deeds. ${esc(selectedLabel)}" aria-expanded="false" aria-controls="${id}-panel" placeholder="${esc(selectedLabel)}"><div class="financing-collateral-panel" id="${id}-panel" data-collateral-panel hidden><fieldset class="financing-collateral-options" id="${id}-options"><legend class="t-micro g400">ELIGIBLE DEEDS · SELECT ANY</legend>${options}</fieldset></div></div>`;
}

export function setCollateralPickerOpen(picker, open, { restoreFocus = false } = {}) {
  const trigger = picker?.querySelector("[data-collateral-trigger]");
  const panel = picker?.querySelector("[data-collateral-panel]");
  if (!trigger || !panel) return;
  trigger.setAttribute("aria-expanded", String(open));
  panel.hidden = !open;
  if (!open) {
    trigger.value = "";
  }
  if (restoreFocus && !open) trigger.focus({ preventScroll: true });
}

export function updateCollateralPickerLabel(picker) {
  if (!picker) return;
  const selected = [...picker.querySelectorAll("[data-collateral-option] input:checked")];
  const names = selected.map((input) => input.closest("[data-collateral-option]")?.querySelector("[data-collateral-name]")?.textContent).filter(Boolean);
  const trigger = picker.querySelector("[data-collateral-trigger]");
  const selectedLabel = names.length ? `${names.length} SELECTED · ${names.join(", ")}` : "SELECT DEEDS…";
  trigger.placeholder = selectedLabel;
  trigger.setAttribute("aria-label", `Choose collateral deeds. ${selectedLabel}`);
}

export function collateralTriggerOpenKey(event, trigger) {
  if (event.target !== trigger) return false;
  if (trigger.getAttribute("aria-expanded") === "true") return false;
  return event.key === "Enter" || event.key === "ArrowDown";
}

export function collateralTriggerCloseKey(event, trigger) {
  if (event.key !== "Escape") return false;
  return trigger.getAttribute("aria-expanded") === "true";
}

export function bindCollateralPicker(card) {
  if (card.dataset.collateralPickerBound) return;
  card.addEventListener("click", (event) => {
    const picker = event.target.closest?.("[data-collateral-root]");
    const trigger = event.target.closest?.("[data-collateral-trigger]");
    if (trigger && picker) {
      if (trigger.getAttribute("aria-expanded") !== "true") setCollateralPickerOpen(picker, true);
      return;
    }
    card.querySelectorAll("[data-collateral-root]").forEach((root) => {
      if (!root.contains(event.target)) setCollateralPickerOpen(root, false);
    });
  });
  card.addEventListener("keydown", (event) => {
    const picker = event.target.closest?.("[data-collateral-root]");
    const trigger = picker?.querySelector("[data-collateral-trigger]");
    if (!trigger) return;
    if (collateralTriggerOpenKey(event, trigger)) {
      event.preventDefault();
      setCollateralPickerOpen(picker, true);
      return;
    }
    if (collateralTriggerCloseKey(event, trigger)) {
      event.preventDefault();
      event.stopPropagation();
      setCollateralPickerOpen(picker, false, { restoreFocus: true });
    }
  });
  card.dataset.collateralPickerBound = "true";
}
export function syncFinancingRanges(root = $("#financing-card")) {
  root?.querySelectorAll(".financing-range input[type=range]").forEach((input) => {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const value = Number(input.value) || min;
    const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.parentElement?.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, progress))}%`);
  });
}

export function syncFinancingAmountField(amountError) {
  const amount = $("#finance-amount");
  if (amount) {
    amount.setAttribute("aria-invalid", String(Boolean(amountError)));
    if (amountError) amount.setAttribute("aria-describedby", "finance-amount-error");
    else amount.removeAttribute("aria-describedby");
  }
  const error = $("#finance-amount-error");
  if (error) error.textContent = amountError;
}

export function syncFinancingLoanFields() {
  for (const [id, message] of Object.entries(financingLoanErrors())) {
    const input = $(`#${id}`);
    if (!input) continue;
    input.setAttribute("aria-invalid", String(Boolean(message)));
    const errorNode = $(`#${id}-error`);
    if (errorNode) errorNode.textContent = message;
  }
}

export function syncFinancingSendButton() {
  const send = $("#financing-send");
  if (!send) return;
  send.disabled = financingSendDisabled();
  send.classList.toggle("financing-disabled-action", send.disabled);
}

export function refreshFinancingPreview() {
  const preview = $("#financing-preview");
  if (preview) preview.innerHTML = financingPreviewHTML();
  syncFinancingAmountField(financingAmountError());
  syncFinancingLoanFields();
  syncFinancingSendButton();
}

export const FINANCE_INPUT_FIELDS = {
  "finance-amount": (value) => { financingState.previewDraft.amount = financingAmount(value); },
  "finance-loan-rate": (value) => { financingState.previewDraft.loanRate = value; },
  "finance-loan-duration": (value) => { financingState.previewDraft.loanDuration = value; },
  "finance-equity-duration": (value) => { financingState.previewDraft.equityDuration = boundedInteger(value, 3, 1, 20); },
};

export const FINANCE_RANGE_OUTPUTS = {
  "finance-equity-share": { key: "equityShare", fallback: 10, outputId: "#finance-equity-share-output" },
};

export function applyFinanceRangeField(id, value) {
  const cfg = FINANCE_RANGE_OUTPUTS[id];
  if (!cfg) return;
  financingState.previewDraft[cfg.key] = Number(value) || cfg.fallback;
  $(cfg.outputId).textContent = `${financingState.previewDraft[cfg.key]}%`;
}

export function onFinancingInput(card, event) {
  const { id, value } = event.target;
  const setter = FINANCE_INPUT_FIELDS[id];
  if (setter) setter(value);
  if (id === "finance-amount") event.target.value = financingState.previewDraft.amount;
  if (id === "finance-equity-duration") event.target.value = financingState.previewDraft.equityDuration;
  applyFinanceRangeField(id, value);
  if (event.target.matches("input[type=range]")) syncFinancingRanges(card);
  refreshFinancingPreview();
}

export function onFinancingChange(card, event) {
  const input = event.target.closest?.("[data-finance-collateral]");
  if (!input) return;
  onFinancingCollateralChange(input);
  updateCollateralPickerLabel(input.closest("[data-collateral-root]"));
  refreshFinancingPreview();
}
export function onFinancingCollateralChange(input) {
  const index = Number(input.value);
  const eligible = financingRecipientCollateralDeeds().some(tile => tile.i === index);
  if (!Number.isInteger(index) || !eligible) return;
  const selected = new Set(financingState.previewDraft.collateralTileIndices);
  if (input.checked) selected.add(index);
  else selected.delete(index);
  financingState.previewDraft.collateralTileIndices = [...selected].sort((a, b) => a - b);
}
