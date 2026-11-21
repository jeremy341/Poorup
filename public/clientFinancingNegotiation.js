// FINANCING: counter-offer negotiation draft, preview and submission.
import { state } from "./clientState.js";
import { TILES } from "./clientBoardData.js";
import { boundedInteger, financingCollateralDeedEligible, financingPropertyTile, financingState, financingTileShares } from "./clientFinancingState.js";
import { $, esc } from "./clientDom.js";
import { collateralPickerHTML, financingCollateralCreditCopy, updateCollateralPickerLabel } from "./clientFinancingPreview.js";
import { contractLabel, playerFinanceEnabled, rentShareDisclosure } from "./clientFinanceRules.js";
import { financingMyServerId, host } from "./clientDealHost.js";
export function negotiationOwnedPropertyOptions(contract) {
  const borrowerId = contract?.toPlayerId;
  if (!borrowerId) return [];
  const borrower = state.players.find((player) => player.serverId === borrowerId || player.id === borrowerId);
  if (!borrower) return [];
  return TILES.filter((tile) => ["property", "railroad", "utility"].includes(tile.kind) && state.owners[tile.i] === borrower.id && !state.mortgaged[tile.i] && !financingTileShares(tile.i).length);
}

export function negotiationSelectHTML(id, label, value, options) {
  return `<label class="financing-field"><span class="t-label f11 g-muted">${esc(label)}</span><select class="field" id="${esc(id)}" data-negotiation-field="${esc(id)}">${options.map((option) => `<option value="${esc(option.value)}"${String(option.value) === String(value) ? " selected" : ""}>${esc(option.label)}</option>`).join("")}</select></label>`;
}

export function negotiationPropertySelectHTML(id, label, value, options) {
  if (!options.length) return `<div class="financing-field"><span class="t-label f11 g-muted">${esc(label)}</span><span class="t-micro red">NO ELIGIBLE DEEDS</span></div>`;
  return negotiationSelectHTML(id, label, value ?? options[0].i, options.map((tile) => ({ value: tile.i, label: `${tile.name} · $${tile.price}` })));
}

export function negotiationCollateralAccordionHTML(contract) {
  const deeds = negotiationOwnedPropertyOptions(contract).filter(financingCollateralDeedEligible);
  const selected = new Set(financingState.negotiationDraft.collateralTileIndices || []);
  return collateralPickerHTML({
    id: "negotiation-collateral",
    deeds,
    selected,
    checkboxAttribute: 'data-negotiation-field="negotiation-collateral"'
  });
}

export function negotiationFieldsHTML(contract) {
  const kind = contract.kind;
  const deeds = negotiationOwnedPropertyOptions(contract);
  const common = `<div class="financing-field-grid"><label class="financing-field"><span class="t-label f11 g-muted">Cash advanced / contributed</span><input class="field" id="negotiation-amount" data-negotiation-field="negotiation-amount" type="number" min="1" step="1" value="${financingState.negotiationDraft.amount}" /></label><label class="financing-field"><span class="t-label f11 g-muted">Duration in rounds</span><input class="field" id="negotiation-duration" data-negotiation-field="negotiation-duration" type="number" min="1" max="20" step="1" value="${financingState.negotiationDraft.durationRounds}" /></label></div>`;
  if (kind === "equity") {
    return `${common}<label class="financing-field"><span class="t-label f11 g-muted">Share of collected rent %</span><input class="field" id="negotiation-equity-share" data-negotiation-field="negotiation-equity-share" type="number" min="5" max="100" step="5" value="${financingState.negotiationDraft.equityShare}" /></label>${negotiationPropertySelectHTML("negotiation-property", "Recipient deed", financingState.negotiationDraft.propertyIndex, deeds)}<p class="t-micro ink-3">${esc(rentShareDisclosure(financingState.negotiationDraft))}</p>`;
  }

  return `${common}<label class="financing-field"><span class="t-label f11 g-muted">Total interest %</span><input class="field" id="negotiation-premium" data-negotiation-field="negotiation-premium" type="number" min="0" max="100" step="1" value="${financingState.negotiationDraft.premiumRate}" /></label>${negotiationCollateralAccordionHTML(contract)}`;
}

export function negotiationCollateralTiles(contract) {
  if (contract.kind !== "loan") return [];
  const eligible = new Set(negotiationOwnedPropertyOptions(contract).filter(financingCollateralDeedEligible).map(tile => tile.i));
  return (financingState.negotiationDraft.collateralTileIndices || []).filter(index => eligible.has(Number(index))).map(financingPropertyTile).filter(Boolean);
}

export function negotiationSlip(contract, amount, premium, total) {
  const d = financingState.negotiationDraft;
  const rounds = `${d.durationRounds} ROUNDS`;
  if (contract.kind === "equity") {
    return {
      title: "RENT SHARE COUNTER",
      focal: ["SHARE", `${d.equityShare}%`],
      rows: [["CONTRIBUTION", `$${amount}`], ["DURATION", rounds]],
    };
  }

  const collateral = negotiationCollateralTiles(contract);
  return {
    title: collateral.length ? "SECURED LOAN COUNTER" : "UNSECURED LOAN COUNTER",
    focal: ["TOTAL DUE", `$${total}`],
    rows: [["ADVANCE", `$${amount}`], ["INTEREST", `$${total - amount} · ${premium}%`], ["TERM", rounds]],
    risk: collateral.length ? `Default transfers pledged deeds. ${financingCollateralCreditCopy(collateral, total)}` : "No deed is pledged.",
  };
}

export function negotiationPreviewHTML(contract) {
  const amount = Math.max(1, Math.floor(Number(financingState.negotiationDraft.amount) || 0));
  const premium = Math.max(0, Math.min(100, Number(financingState.negotiationDraft.premiumRate) || 0));
  const total = amount + Math.ceil((amount * premium) / 100);
  const slip = negotiationSlip(contract, amount, premium, total);
  const rows = slip.rows.map(([label, value]) => `<div><span class="t-micro ink-3">${label}</span><strong class="t-label f13 g100">${esc(value)}</strong></div>`).join("");
  return `<div class="financing-preview-head"><span class="t-micro g400">COUNTER PREVIEW · TO ${esc((financingState.negotiationAction === "adjust" ? contract.toPlayerName : contract.fromPlayerName) || "PLAYER")}</span><span class="t-label f12 g100">${slip.title}</span></div><div class="financing-focal"><span class="t-micro ink-3">${slip.focal[0]}</span><strong class="slip-amount g050">${esc(slip.focal[1])}</strong></div><div class="financing-metrics">${rows}</div><p class="t-body ink-2 financing-preview-copy">${slip.risk ? `${esc(slip.risk)} ` : ""}No cash moves until they accept.</p><p class="t-micro ink-3 financing-preview-note">Negotiation is capped at two counters.</p>`;
}

export function financingNegotiationHTML(contract) {
  const adjusting = financingState.negotiationAction === "adjust";
  return `<section class="financing-surface-body financing-builder" aria-labelledby="financing-negotiate-heading"><h3 class="sr-only" id="financing-negotiate-heading">${adjusting ? "Adjust" : "Counter"} the ${esc(contractLabel(contract))} deal</h3><div class="financing-form" tabindex="0" role="region" aria-label="Financing terms">${negotiationFieldsHTML(contract)}</div><section class="financing-preview" id="negotiation-preview" tabindex="0" aria-label="Counteroffer preview" aria-live="polite">${negotiationPreviewHTML(contract)}</section><div class="financing-actions is-solo"><button class="cta-red" id="financing-negotiate-send" type="button"><span class="cta-text cta-text-sm">${adjusting ? "SEND ADJUSTMENT" : "SEND COUNTER"}</span></button></div></section>`;
}

export function currentNegotiationContract() {
  const id = financingState.negotiationContractId;
  if (!id) return null;
  if (state.playerContractOffer?.id === id) return state.playerContractOffer;
  if (state.playerContracts?.pending?.id === id) return state.playerContracts.pending;
  return null;
}
export const NEGOTIATION_NUMBER_FIELDS = {
  "negotiation-amount": { key: "amount", fallback: 1, min: 1, max: 100000 },
  "negotiation-duration": { key: "durationRounds", fallback: 3, min: 1, max: 20 },
  "negotiation-premium": { key: "premiumRate", fallback: 0, min: 0, max: 100 },
  "negotiation-equity-share": { key: "equityShare", fallback: 10, min: 5, max: 100 },
};

export const NEGOTIATION_FIELD_SETTERS = {
  "negotiation-property": (event, value) => { financingState.negotiationDraft.propertyIndex = Number(value); },
  "negotiation-collateral": (event) => negotiationCollateralChanged(event),
};

export function negotiationCollateralChanged(event) {
  const index = Number(event.target.value);
  const contract = currentNegotiationContract();
  if (!contract || !negotiationOwnedPropertyOptions(contract).filter(financingCollateralDeedEligible).some(tile => tile.i === index)) return;
  const selected = new Set(financingState.negotiationDraft.collateralTileIndices || []);
  if (event.target.checked) selected.add(index);
  else selected.delete(index);
  financingState.negotiationDraft.collateralTileIndices = [...selected].sort((a, b) => a - b);
  updateCollateralPickerLabel(event.target.closest("[data-collateral-root]"));
}

export function applyNegotiationField(field, event, value) {
  const numberField = NEGOTIATION_NUMBER_FIELDS[field];
  if (numberField) {
    financingState.negotiationDraft[numberField.key] = boundedInteger(value, numberField.fallback, numberField.min, numberField.max);
    return;
  }
  const setter = NEGOTIATION_FIELD_SETTERS[field];
  if (setter) setter(event, value);
}

export function refreshNegotiationPreview() {
  const contract = state.playerContractOffer;
  const preview = $("#negotiation-preview");
  if (preview && contract) preview.innerHTML = negotiationPreviewHTML(contract);
}

export function negotiationFieldChanged(event) {
  const field = event.target?.dataset?.negotiationField;
  if (!field) return false;
  const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  applyNegotiationField(field, event, value);
  refreshNegotiationPreview();
  return true;
}

export function applyNegotiationTerms(payload, contract) {
  if (contract.kind === "loan") {
    payload.collateralTileIndices = negotiationCollateralTiles(contract).map(tile => tile.i);
    return;
  }
  payload.propertyIndex = financingState.negotiationDraft.propertyIndex;
  if (contract.kind === "equity") {
    payload.equityShare = boundedInteger(financingState.negotiationDraft.equityShare, 10, 5, 100);
    payload.equityControl = "passive";
    payload.permanent = false;
    return;
  }
}

export function negotiationPayload(contract) {
  const payload = {
    contractId: contract.id,
    kind: contract.kind,
    amount: boundedInteger(financingState.negotiationDraft.amount, 1, 1),
    premiumRate: boundedInteger(financingState.negotiationDraft.premiumRate, 0, 0, 100),
    durationRounds: boundedInteger(financingState.negotiationDraft.durationRounds, 3, 1, 20),
    requestId: host.createRequestId("contract-counter"),
  };
  applyNegotiationTerms(payload, contract);
  return payload;
}
export function negotiationNumber(value, fallback, min, max = Number.POSITIVE_INFINITY) {
  return Math.max(min, Math.min(max, Number(value) || fallback));
}

export function negotiationCollateralIndices(contract) {
  if (Array.isArray(contract.collateralTileIndices)) return contract.collateralTileIndices.map(Number);
  if (contract.collateralTileIndex == null) return [];
  return [Number(contract.collateralTileIndex)];
}

export function loadNegotiationDraft(contract) {
  financingState.negotiationDraft.kind = contract.kind || "loan";
  financingState.negotiationDraft.amount = negotiationNumber(contract.amount, 1, 1);
  financingState.negotiationDraft.premiumRate = negotiationNumber(contract.premiumRate, 0, 0, 100);
  financingState.negotiationDraft.durationRounds = negotiationNumber(contract.durationRounds, 3, 1, 20);
  financingState.negotiationDraft.propertyIndex = contract.propertyIndex ?? null;
  financingState.negotiationDraft.collateralTileIndices = negotiationCollateralIndices(contract);
  financingState.negotiationDraft.equityShare = negotiationNumber(contract.equityShare, 10, 5, 100);
}

export function findNegotiationContract(contractId) {
  if (state.playerContractOffer?.id === contractId) return state.playerContractOffer;
  if (state.playerContracts?.pending?.id === contractId) return state.playerContracts.pending;
  return null;
}

export function negotiationActionFor(contract) {
  const depth = Math.max(0, Math.floor(Number(contract.counterDepth) || 0));
  const lastProposerId = contract.lastProposerId || (depth % 2 === 0 ? contract.fromPlayerId : contract.toPlayerId);
  if (lastProposerId === financingMyServerId()) return "adjust";
  return "counter";
}

export function canNegotiateContract(contract) {
  const self = financingMyServerId();
  return Boolean(contract && playerFinanceEnabled(state.settings)
    && (self === contract.fromPlayerId || self === contract.toPlayerId)
    && Number(contract.counterDepth || 0) < 2
    && (Number(contract.rulesVersion) === 2 ? contract.kind !== "hybrid" : contract.kind === "loan"));
}

