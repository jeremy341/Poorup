// TRADE & FINANCING: the deal builder (loan and temporary rent-share financing modal), the trade
// proposer modal and the shared parlor dropdown. Templates are the exact main.js markup.
// Game-bound calls (emitServer, say, renderChat, record) arrive via configureTradeUi hooks.
import { $, esc, clamp } from "./clientDom.js";
import { closeButtonHTML } from "./clientCloseButton.js";
import { state } from "./clientState.js";
import { playerFinanceEnabled, isRentShare, contractLabel, rentShareDisclosure, collateralCreditSummary } from "./clientFinanceRules.js";
import { emitIntent } from "./clientRequestController.js";
import { TILES, GROUP_COLOR, RENT_TABLE } from "./clientBoardData.js";
import { spriteHTML, avatarHTML } from "./clientSprites.js";
import { openSurface, closeSurface } from "./clientSurfaces.js";

let host = { emitServer: noop, say: noop, record: noop, recordActivity: noop, captureActionStatusNode: () => null, announceActionStatus: noop, renderChat: noop, createRequestId: noop, renderRightRail: noop };

function noop() {}

export function configureTradeUi(hooks) {
  host = { ...host, ...hooks };
}

let financingPreviewMode = "loan";
let financingView = "builder";
let financingSurfaceContractId = null;
let financingSurfaceTileIndex = null;
let financingNegotiationContractId = null;
let financingNegotiationAction = "counter";
let financingRepayStatus = null;
let tradeInitialDeedIndex = null;
const financingNegotiationDraft = {
  kind: "loan",
  amount: 100,
  premiumRate: 10,
  durationRounds: 3,
  propertyIndex: null,
  collateralTileIndices: [],
  equityShare: 10,
};
const financingPreviewDraft = {
  recipientId: null,
  collateralTileIndices: [],
  propertyIndex: 21,
  amount: 150,
  loanRate: 20,
  loanDuration: 20,
  equityShare: 10,
  equityDuration: 3,
};

function dropdownHTML({ id, label, value, options, className = "" }) {
  const selected = options.find((option) => String(option.value) === String(value)) || options[0];
  return `<div class="parlor-dropdown ${className}" data-dropdown="${esc(id)}"><span class="t-label f11 g-muted">${esc(label)}</span><button class="parlor-dropdown-trigger field" id="${esc(id)}-trigger" type="button" aria-label="${esc(label)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(id)}-menu"><span data-dropdown-value>${esc(selected?.label || "SELECT")}</span><span class="parlor-dropdown-caret" aria-hidden="true">▾</span></button><div class="parlor-dropdown-menu" id="${esc(id)}-menu" role="listbox" tabindex="-1" hidden>${options.map((option) => `<button class="parlor-dropdown-option" type="button" role="option" aria-selected="${String(option.value) === String(selected?.value)}" data-dropdown-value-option="${esc(option.value)}">${esc(option.label)}</button>`).join("")}</div></div>`;
}

const DROPDOWN_ARROWS = ["ArrowDown", "ArrowUp", "Home", "End"];

function dropdownFocusIndex(options, key, current) {
  if (key === "Home") return 0;
  if (key === "End") return options.length - 1;
  const step = key === "ArrowDown" ? 1 : -1;
  return (current + step + options.length) % options.length;
}

function focusDropdownOption(menu, option) {
  if (!option) return;
  option.focus({ preventScroll: true });
  const bounds = menu.getBoundingClientRect();
  const focused = option.getBoundingClientRect();
  const top = bounds.top + menu.clientTop;
  const bottom = top + menu.clientHeight;
  if (focused.top < top) menu.scrollTop -= top - focused.top;
  else if (focused.bottom > bottom) menu.scrollTop += focused.bottom - bottom;
}

function onDropdownMenuKey(event, menu, trigger, close) {
  const options = [...menu.querySelectorAll("[data-dropdown-value-option]")];
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    trigger.focus({ preventScroll: true });
    return;
  }
  if (DROPDOWN_ARROWS.includes(event.key)) {
    event.preventDefault();
    const index = dropdownFocusIndex(options, event.key, options.indexOf(document.activeElement));
    focusDropdownOption(menu, options[index]);
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    document.activeElement?.click();
  }
}

function fitFinancingDropdownMenu(dropdown, trigger, menu) {
  const form = dropdown.closest(".financing-form");
  if (!form) return;
  const bounds = form.getBoundingClientRect();
  const anchor = trigger.getBoundingClientRect();
  const below = Math.max(0, bounds.bottom - anchor.bottom - 8);
  const above = Math.max(0, anchor.top - bounds.top - 8);
  const upward = below < Math.min(menu.scrollHeight, 240) && above > below;
  menu.style.top = upward ? "auto" : "calc(100% + 4px)";
  menu.style.bottom = upward ? `${dropdown.getBoundingClientRect().bottom - anchor.top + 4}px` : "auto";
  menu.style.maxHeight = `${Math.floor(upward ? above : below)}px`;
}

function bindDropdowns(root, onSelect) {
  if (!root) return;
  const closeMenus = (except = null) => root.querySelectorAll(".parlor-dropdown").forEach((dropdown) => {
    if (dropdown !== except) {
      const trigger = dropdown.querySelector(".parlor-dropdown-trigger");
      const menu = dropdown.querySelector(".parlor-dropdown-menu");
      trigger?.setAttribute("aria-expanded", "false");
      if (menu) menu.hidden = true;
    }
  });
  root.querySelectorAll(".parlor-dropdown").forEach((dropdown) => {
    const id = dropdown.dataset.dropdown;
    const trigger = dropdown.querySelector(".parlor-dropdown-trigger");
    const menu = dropdown.querySelector(".parlor-dropdown-menu");
    if (!trigger || !menu) return;
    const open = () => {
      closeMenus(dropdown);
      menu.hidden = false;
      fitFinancingDropdownMenu(dropdown, trigger, menu);
      trigger.setAttribute("aria-expanded", "true");
      focusDropdownOption(menu, menu.querySelector("[aria-selected=true]"));
    };
    const close = () => {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };
    trigger.addEventListener("click", () => (menu.hidden ? open() : close()));
    trigger.addEventListener("keydown", (event) => {
      if (["Enter", " ", "ArrowDown"].includes(event.key)) { event.preventDefault(); open(); }
    });
    menu.addEventListener("click", (event) => {
      const option = event.target.closest("[data-dropdown-value-option]");
      if (!option) return;
      const value = option.dataset.dropdownValueOption;
      dropdown.querySelectorAll("[data-dropdown-value-option]").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === option)));
      const valueEl = dropdown.querySelector("[data-dropdown-value]");
      if (valueEl) valueEl.textContent = option.textContent;
      close();
      onSelect?.(id, value);
      trigger.focus({ preventScroll: true });
    });
    menu.addEventListener("keydown", (event) => onDropdownMenuKey(event, menu, trigger, close));
  });
  if (!root.dataset.dropdownOutsideBound) {
    root.addEventListener("click", (event) => { if (!event.target.closest(".parlor-dropdown")) closeMenus(); });
    root.dataset.dropdownOutsideBound = "true";
  }
}

// Every other seat is a valid counterparty, bots included: the server
// guards accept any active pair and botLogic answers pending contracts.
// (Same filter the trade modal uses; the rail form narrows to humans.)
function otherPlayers() {
  return state.players.filter((p) => p.id !== "p1");
}

function defaultRecipientId() {
  return otherPlayers()[0]?.id || null;
}

function financingRecipientId() {
  const id = financingPreviewDraft.recipientId;
  if (id && otherPlayers().some((p) => p.id === id)) return id;
  return defaultRecipientId();
}

function recipientPlayer() {
  return state.players.find((p) => p.id === financingRecipientId());
}

function financingRecipients() {
  return otherPlayers().map((p) => ({ value: p.id, label: `${p.name} · $${Number(p.cash || 0).toLocaleString()}` }));
}

function financingRecipientDeeds() {
  const recipientId = financingRecipientId();
  if (!recipientId) return [];
  return TILES.filter((tile) => ["property", "railroad", "utility"].includes(tile.kind) && state.owners[tile.i] === recipientId && !state.mortgaged[tile.i] && !financingTileShares(tile.i).length);
}

// Trade-only room locks are broader than the asset eligibility used for a pledge.
const COLLATERAL_TRADE_ONLY_REASONS = new Set([
  "Trading is disabled for this room.",
  "Resolve the open auction before proposing a trade.",
  "Resolve the pending purchase offer before proposing a trade.",
  "Resolve the pending sponsored purchase before proposing a trade.",
  "Another trade is already pending.",
  "Resolve the pending player contract before proposing a trade.",
]);

function financingCollateralDeedEligible(tile) {
  if (tradeBuildingLevel(tile.i) > 0 || tradeBuildingBlockReason(tile)) return false;
  const serverTile = state.serverTiles.find(entry => Number(entry.index) === Number(tile.i));
  const authority = serverTile?.propertyActions?.tradeDeed;
  if (authority?.enabled === false && !COLLATERAL_TRADE_ONLY_REASONS.has(authority.reason)) return false;
  const owner = state.players.find(player => player.id === state.owners[tile.i]);
  const bankLoan = owner?.bankLoan;
  if (["active", "due"].includes(bankLoan?.status) && contractCollateralIndices(bankLoan).map(Number).includes(tile.i)) return false;
  return !financingActiveContracts().some(contract => ["active", "due"].includes(contract.status)
    && [owner?.id, owner?.serverId].includes(contract.toPlayerId)
    && (contractCollateralIndices(contract).map(Number).includes(tile.i) || (contract.kind === "equity" && Number(contract.propertyIndex) === tile.i)));
}

function financingRecipientCollateralDeeds() {
  return financingRecipientDeeds().filter(financingCollateralDeedEligible);
}

function financingPropertyOptions() {
  const deeds = financingRecipientDeeds();
  if (!deeds.length) return [{ value: "", label: "NO ELIGIBLE DEEDS" }];
  return deeds.map((tile) => ({ value: tile.i, label: financingEquityContextLabel(tile) }));
}

function financingHasEligibleProperty() {
  return financingRecipientDeeds().length > 0;
}

function financingRecipientValid(value) {
  return otherPlayers().some((p) => p.id === value);
}

function clampPropertyToRecipient() {
  const deeds = financingRecipientDeeds();
  if (!deeds.length) {
    financingPreviewDraft.propertyIndex = "";
    return;
  }
  const current = Number(financingPreviewDraft.propertyIndex);
  const stillHeld = deeds.some((tile) => tile.i === current);
  if (!stillHeld) financingPreviewDraft.propertyIndex = deeds[0].i;
}

function clampCollateralToRecipient() {
  const eligible = new Set(financingRecipientCollateralDeeds().map(tile => tile.i));
  const selected = Array.isArray(financingPreviewDraft.collateralTileIndices)
    ? financingPreviewDraft.collateralTileIndices
    : financingPreviewDraft.collateralTileIndex == null ? [] : [financingPreviewDraft.collateralTileIndex];
  financingPreviewDraft.collateralTileIndices = [...new Set(selected.map(Number).filter(index => eligible.has(index)))];
  delete financingPreviewDraft.collateralTileIndex;
}

function onFinancingRecipientSet(value) {
  if (!financingRecipientValid(value)) return;
  financingPreviewDraft.recipientId = value;
  clampPropertyToRecipient();
  clampCollateralToRecipient();
  renderFinancingModal();
  $("#finance-recipient-trigger")?.focus({ preventScroll: true });
}

function onFinancingCollateralChange(input) {
  const index = Number(input.value);
  const eligible = financingRecipientCollateralDeeds().some(tile => tile.i === index);
  if (!Number.isInteger(index) || !eligible) return;
  const selected = new Set(financingPreviewDraft.collateralTileIndices);
  if (input.checked) selected.add(index);
  else selected.delete(index);
  financingPreviewDraft.collateralTileIndices = [...selected].sort((a, b) => a - b);
}

function financingEligiblePropertyIndex() {
  const index = Number(financingPreviewDraft.propertyIndex);
  const held = financingRecipientDeeds().some((tile) => tile.i === index);
  return held ? index : null;
}

function financingEligibleCollateralIndices() {
  const eligible = new Set(financingRecipientCollateralDeeds().map(tile => tile.i));
  return [...new Set(financingPreviewDraft.collateralTileIndices.map(Number))].filter(index => eligible.has(index));
}

function financingEligibleCollateralIndex() {
  return financingEligibleCollateralIndices()[0] ?? null;
}

function financingAmount(value = financingPreviewDraft.amount) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
}

function financingAmountValid() {
  const amount = financingAmount();
  if (amount < 1) return false;
  const me = state.players[0];
  return (me?.cash || 0) >= amount;
}

function financingAmountError() {
  return financingAmountValid() ? "" : "Enter an amount you can fund.";
}

function financingPropertyRequired() {
  return financingPreviewMode !== "loan";
}

function financingPropertyMissing() {
  if (!financingPropertyRequired()) return false;
  return !financingHasEligibleProperty();
}

function financingLoanTermError(value, min, max) {
  const text = String(value).trim();
  const number = Number(text);
  return text && Number.isInteger(number) && number >= min && number <= max
    ? "" : `Enter a whole number from ${min} to ${max}.`;
}

function financingLoanErrors() {
  return {
    "finance-loan-rate": financingLoanTermError(financingPreviewDraft.loanRate, 0, 100),
    "finance-loan-duration": financingLoanTermError(financingPreviewDraft.loanDuration, 1, 20),
  };
}

function financingSendBlocked() {
  if (!playerFinanceEnabled(state.settings)) return "Player Finance is disabled for this table.";
  if (!["loan", "equity"].includes(financingPreviewMode)) return "Choose a loan or rent share.";
  if (!recipientPlayer()) return "Choose a player to deal with.";
  if (!financingAmountValid()) return financingAmountError();
  if (financingPreviewMode === "loan" && Object.values(financingLoanErrors()).some(Boolean)) return "Enter valid loan terms.";
  if (financingPropertyMissing()) return "The counterparty owns no eligible deeds.";
  return null;
}

function financingLoanTerms() {
  return {
    premiumRate: Number(financingPreviewDraft.loanRate),
    durationRounds: Number(financingPreviewDraft.loanDuration),
    propertyIndex: financingEligiblePropertyIndex(),
    collateralTileIndices: financingEligibleCollateralIndices(),
  };
}

function financingEquityDurationRounds() {
  return Math.max(1, Math.min(20, Math.floor(Number(financingPreviewDraft.equityDuration) || 3)));
}

function financingEquityTerms() {
  return {
    premiumRate: 0,
    durationRounds: financingEquityDurationRounds(),
    propertyIndex: financingEligiblePropertyIndex(),
    collateralTileIndex: null,
    equityShare: Math.max(5, Math.min(100, Number(financingPreviewDraft.equityShare) || 10)),
    equityControl: "passive",
    permanent: false,
  };
}

function financingSendPayload(recipient) {
  const base = {
    toPlayerId: recipient.serverId || recipient.id,
    kind: financingPreviewMode,
    amount: financingAmount(),
    requestId: host.createRequestId("contract-proposal"),
  };
  const terms = financingPreviewMode === "equity" ? financingEquityTerms() : financingLoanTerms();
  return { ...base, ...terms };
}

function sendFinancingContract(control = document.activeElement) {
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

function financingEquityContextLabel(tile) {
  const serverTile = state.serverTiles.find((t) => Number(t.index) === Number(tile.i));
  const shares = serverTile?.equityShares || [];
  const total = shares.reduce((sum, entry) => sum + Number(entry.share || 0), 0);
  return total ? `${tile.name} · $${tile.price} · EQUITY ${total}%` : `${tile.name} · $${tile.price}`;
}

function baseRentOf(tile) {
  const listed = Number(tile.rent) || 0;
  if (listed) return listed;
  return Number(RENT_TABLE[tile.group]?.base) || 0;
}

function financingPreviewTile() {
  if (financingPreviewMode === "loan") {
    const collateralIndex = financingEligibleCollateralIndex();
    return collateralIndex == null ? null : financingPropertyTile(collateralIndex);
  }
  const tile = TILES[Number(financingPreviewDraft.propertyIndex)];
  if (tile && ["property", "railroad", "utility"].includes(tile.kind)) return tile;
  return financingRecipientDeeds()[0] || TILES[21];
}

function financingPreviewKicker() {
  const recipient = recipientPlayer();
  if (!recipient) return "CONTRACT PREVIEW";
  return `CONTRACT PREVIEW · TO ${recipient.name}`;
}

function financingNoDeedsHintHTML() {
  if (financingHasEligibleProperty()) return "";
  return `<p class="t-micro ink-3">NO ELIGIBLE DEEDS · PICK ANOTHER PLAYER</p>`;
}

function financingPropertyPickerHTML() {
  if (!financingPropertyRequired()) return "";
  return `${financingNoDeedsHintHTML()}${dropdownHTML({ id: "finance-property", label: "Property (their deed)", value: financingPreviewDraft.propertyIndex, options: financingPropertyOptions() })}`;
}

function financingSendDisabled() {
  return Boolean(financingSendBlocked());
}

function financingPreviewBase() {
  const tile = financingPreviewTile();
  const amount = financingAmount();
  const rent = tile ? baseRentOf(tile) : 0;
  return { tile, amount, rent };
}

function previewEquityDuration() {
  return `${financingEquityDurationRounds()} ROUNDS`;
}

function equityPreviewCopy(tile, amount, rent) {
  const share = Math.max(5, Math.min(100, Number(financingPreviewDraft.equityShare) || 10));
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

function loanPreviewCopy(tile, amount) {
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

function financingCollateralCreditCopy(deeds, totalDue) {
  return collateralCreditSummary({
    collateralCreditVersion: 1,
    collateralCreditQuotes: deeds.map(deed => ({ name: deed.name, value: state.serverTiles.find(entry => Number(entry.index) === deed.i)?.price ?? deed.price })),
    totalDue,
  });
}

function financingCollateralAccordionHTML() {
  const selected = new Set(financingEligibleCollateralIndices());
  const deeds = financingRecipientCollateralDeeds();
  return collateralPickerHTML({ id: "finance-collateral", deeds, selected, checkboxAttribute: "data-finance-collateral" });
}

const FINANCE_PREVIEW_BUILDERS = {
  equity: equityPreviewCopy,
  loan: loanPreviewCopy,
};

function financingPreviewCopy(mode = financingPreviewMode) {
  const { tile, amount, rent } = financingPreviewBase();
  const builder = FINANCE_PREVIEW_BUILDERS[mode] || loanPreviewCopy;
  return builder(tile, amount, rent);
}

function financingPreviewEmptyHTML() {
  return `<div class="financing-preview-head"><span class="t-micro g400">${esc(financingPreviewKicker())}</span><span class="t-label f12 g100">NO TERMS TO PREVIEW</span></div><p class="t-body ink-2 financing-preview-copy">The counterparty owns no eligible deeds. Pick another player to shape a deal.</p>`;
}

function financingPreviewHTML() {
  if (financingPropertyMissing()) return financingPreviewEmptyHTML();
  if (financingPreviewMode === "loan" && Object.values(financingLoanErrors()).some(Boolean)) return `<p class="t-body ink-2 financing-preview-copy">Enter valid loan terms to preview the contract.</p>`;
  const preview = financingPreviewCopy();
  return `<div class="financing-preview-head"><span class="t-micro g400">${esc(financingPreviewKicker())}</span><span class="t-label f12 g100">${esc(preview.title)}</span></div>
    ${preview.focal ? `<div class="financing-focal"><span class="t-micro ink-3">${preview.focal[0]}</span><strong class="slip-amount g050">${esc(preview.focal[1])}</strong></div>` : ""}
    <div class="financing-metrics">${preview.metrics.map(([label, value]) => `<div><span class="t-micro ink-3">${label}</span><strong class="t-label f13 g100">${esc(value)}</strong></div>`).join("")}</div>
    ${preview.copy ? `<p class="t-body ink-2 financing-preview-copy">${esc(preview.copy)}</p>` : ""}
    ${preview.note ? `<p class="t-micro ink-3 financing-preview-note">${esc(preview.note)}</p>` : ""}`;
}

function financingModeFieldsHTML() {
  if (financingPreviewMode === "equity") {
    return `<div class="financing-field"><label class="t-label f11 g-muted" for="finance-equity-share">Share of collected rent <output id="finance-equity-share-output">${financingPreviewDraft.equityShare}%</output></label><div class="financing-range"><input id="finance-equity-share" type="range" min="5" max="100" step="5" value="${financingPreviewDraft.equityShare}" /></div></div><label class="financing-field"><span class="t-label f11 g-muted">Duration in rounds</span><div class="financing-number"><input class="field" id="finance-equity-duration" type="number" min="1" max="20" step="1" value="${financingEquityDurationRounds()}" /><span aria-hidden="true">ROUNDS</span></div></label>`;
  }

  return `<div class="financing-field-grid"><div class="financing-field"><label class="t-label f11 g-muted" for="finance-loan-rate">Total interest %</label><input class="field" id="finance-loan-rate" type="number" min="0" max="100" step="1" value="${esc(financingPreviewDraft.loanRate)}" aria-invalid="${Boolean(financingLoanErrors()["finance-loan-rate"])}" aria-describedby="finance-loan-rate-error" /><p class="t-micro red" id="finance-loan-rate-error">${financingLoanErrors()["finance-loan-rate"]}</p></div><div class="financing-field"><label class="t-label f11 g-muted" for="finance-loan-duration">Duration in rounds</label><div class="financing-number"><input class="field" id="finance-loan-duration" type="number" min="1" max="20" step="1" value="${esc(financingPreviewDraft.loanDuration)}" aria-invalid="${Boolean(financingLoanErrors()["finance-loan-duration"])}" aria-describedby="finance-loan-duration-error" /><span aria-hidden="true">ROUNDS</span></div><p class="t-micro red" id="finance-loan-duration-error">${financingLoanErrors()["finance-loan-duration"]}</p></div></div>${financingCollateralAccordionHTML()}`;
}

function financingActiveContracts() {
  return state.playerContracts?.active || [];
}

function financingSelectedContract() {
  if (!financingSurfaceContractId) return null;
  return financingActiveContracts().find((contract) => contract.id === financingSurfaceContractId) || null;
}

function financingMyServerId() {
  return state.players[0]?.serverId || null;
}

function financingContractMine(contract) {
  const mine = financingMyServerId();
  if (!mine) return false;
  if (contract.fromPlayerId === mine) return true;
  return contract.toPlayerId === mine;
}

function financingContractRedacted(contract) {
  if (contract.remaining != null) return false;
  return contract.equityShare == null;
}

function financingRepayableContract(contract) {
  if (!financingContractMine(contract)) return false;
  if (contract.toPlayerId !== financingMyServerId()) return false;
  if (contract.status === "active") return true;
  return contract.status === "due";
}

function financingContractPickerHTML() {
  const active = financingActiveContracts();
  if (!active.length) return `<p class="t-micro ink-3">NO LIVE CONTRACTS.</p>`;
  return `<div class="financing-surface-actions">` + active.map((contract) => {
    const label = `${contractLabel(contract).toUpperCase()} · ${contract.fromPlayerName || "PLAYER"} → ${contract.toPlayerName || "PLAYER"}`;
    return `<button class="btn-dark" type="button" data-financing-pick="${esc(contract.id)}"><span class="t-label f11">${esc(label)}</span></button>`;
  }).join("") + `</div>`;
}

function contractCollateralIndices(contract) {
  if (Array.isArray(contract?.collateralTileIndices)) return contract.collateralTileIndices;
  return contract?.collateralTileIndex == null ? [] : [contract.collateralTileIndex];
}

function contractKindLabel(contract) {
  return contractLabel(contract);
}

function financingContractTitle(contract) {
  const lender = contract.fromPlayerName || "PLAYER";
  const borrower = contract.toPlayerName || "PLAYER";
  if (contract.kind === "loan") {
    const names = contractCollateralIndices(contract).map(index => financingPropertyTile(index)?.name).filter(Boolean);
    const label = names.length ? `Secured loan · ${names.join(", ")}` : "Unsecured loan";
    return `${label} · ${lender} funds ${borrower}`;
  }
  return `${contractKindLabel(contract)} · ${lender} funds ${borrower}`;
}

function financingRepayProgress(contract) {
  const total = Number(contract.totalDue || contract.amount || 0);
  const remaining = Number(contract.remaining || 0);
  const paid = Math.max(0, total - remaining);
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  return { paid, total, pct };
}

function financingCureLine(contract) {
  if (contract.status !== "due") return `DUE ROUND R${Number(contract.dueRound || 0)}`;
  const left = Number(contract.cureRound || 0) - Number(state.roundNumber || 0);
  if (left < 0) return "CURE EXPIRED";
  return `CURE IN ${left} ROUNDS`;
}

function financingContractCopy(contract) {
  if (isRentShare(contract)) return rentShareDisclosure(contract);
  const credit = collateralCreditSummary(contract);
  if (credit) return credit;
  const kind = contract?.kind || contract;
  if (kind === "equity") return "The investor receives the agreed share of collected rent and sale proceeds.";
  if (kind === "hybrid") return "Repay before the cure turn ends. Past cure, the lender converts the agreed share instead of seizing collateral.";
  if (!contractCollateralIndices(contract).length) return "The borrower repays the agreed total interest without pledging a deed as collateral.";
  return "Every pledged deed stays with the borrower while payments are current. All selected deeds transfer on uncured default.";
}

function financingContractRepayHTML(contract) {
  if (!financingRepayableContract(contract)) return "";
  const remaining = Math.max(1, Math.floor(Number(contract.remaining) || 1));
  const status = financingRepayStatus?.contractId === contract.id ? `<p class="t-micro green" role="status" aria-live="polite">${esc(financingRepayStatus.text)}</p>` : "";
  return `<div class="contract-repay-panel"><div class="contract-repay-heading"><span class="t-micro g400">MAKE A PAYMENT</span><span class="t-micro ink-3">UP TO $${remaining.toLocaleString()}</span></div><div class="contract-repay-controls"><label class="t-label f11 g-muted" for="financing-repay-${esc(contract.id)}">Payment amount</label><input class="field contract-repay-input" id="financing-repay-${esc(contract.id)}" data-contract-repay-amount type="number" min="1" max="${remaining}" step="1" value="${remaining}" inputmode="numeric"><button class="cta-red" type="button" data-financing-repay="${esc(contract.id)}"><span class="cta-text cta-text-sm">REPAY CONTRACT</span></button>${status}</div></div>`;
}

function financingTileShares(index) {
  const serverTile = state.serverTiles.find((tile) => Number(tile.index) === Number(index));
  if (!serverTile) return [];
  return serverTile.equityShares || [];
}

function financingSharedDeeds() {
  return TILES.filter((tile) => tile.kind === "property" && financingTileShares(tile.i).length > 0);
}

function financingPropertyTile(index) {
  const tile = TILES[Number(index)];
  if (!tile) return null;
  if (!["property", "railroad", "utility"].includes(tile.kind)) return null;
  return tile;
}

function financingContractDeed(contract) {
  if (!contract) return null;
  return financingPropertyTile(contract.propertyIndex);
}

function financingOwnershipDeed() {
  const picked = financingPropertyTile(financingSurfaceTileIndex);
  if (picked) return picked;
  const linked = financingContractDeed(financingSelectedContract());
  if (linked) return linked;
  return financingSharedDeeds()[0] || null;
}

function financingHolderMeta(holderId) {
  const player = state.players.find((p) => p.serverId === holderId || p.id === holderId);
  if (!player) return { name: "PLAYER", color: "var(--gold-400)" };
  return { name: player.name, color: player.color || "var(--gold-400)" };
}

function financingOwnerMeta(tile) {
  const owner = state.players.find((p) => p.id === state.owners[tile.i]);
  if (!owner) return { name: "BANK", color: "var(--gold-400)" };
  return { name: owner.name, color: owner.color || "var(--gold-400)" };
}

function financingOwnershipBarHTML(shares, ownerPct, ownerColor) {
  const segments = [`<span style="width:${ownerPct}%;background:${ownerColor}"></span>`];
  for (const entry of shares) {
    const meta = financingHolderMeta(entry.holderId);
    segments.push(`<span style="width:${Number(entry.share || 0)}%;background:${meta.color}"></span>`);
  }
  return `<div class="financing-ownership-bar">${segments.join("")}</div>`;
}

function financingOwnerRowsHTML(shares, ownerPct, ownerName, ownerColor) {
  const ownerRow = `<div><span class="ownership-avatar" style="background:${ownerColor}"></span><span class="t-label f12 g100">${esc(ownerName)} · ${ownerPct}%</span><span class="t-micro ink-3">CONTROL + RENT</span></div>`;
  const holderRows = shares.map((entry) => {
    const meta = financingHolderMeta(entry.holderId);
    const control = String(entry.control || "passive").toUpperCase();
    return `<div><span class="ownership-avatar" style="background:${meta.color}"></span><span class="t-label f12 g100">${esc(meta.name)} · ${Number(entry.share || 0)}%</span><span class="t-micro ink-3">${control} · RENT + SALE SHARE</span></div>`;
  }).join("");
  return `<div class="financing-owner-list">${ownerRow}${holderRows}</div>`;
}

function financingShareDuration(entry) {
  const contract = financingActiveContracts().find((c) => c.id === entry.contractId);
  if (!contract) return null;
  if (contract.expiresRound == null) return "FOREVER";
  return "R" + Number(contract.expiresRound);
}

function financingOwnershipDurations(shares) {
  const labels = [...new Set(shares.map(financingShareDuration).filter(Boolean))];
  if (!labels.length) return "-";
  return labels.join(" · ");
}

function financingOwnershipBuildingRights(shares) {
  const controlling = shares.find((entry) => String(entry.control) === "controlling");
  if (!controlling) return "OWNER CONTROL";
  return "SHARED · " + financingHolderMeta(controlling.holderId).name;
}

function financingDeedPickerHTML() {
  const deeds = financingSharedDeeds();
  if (deeds.length < 2) return "";
  return `<div class="financing-surface-actions">` + deeds.map((tile) => `<button class="btn-dark" type="button" data-financing-deed="${tile.i}"><span class="t-label f11">${esc(tile.name)}</span></button>`).join("") + `</div>`;
}

function financingMissingContractHTML() {
  return `<section class="financing-surface-body" aria-labelledby="financing-missing-heading"><div class="financing-surface-kicker"><span class="t-micro g400">NOT AVAILABLE</span></div><h3 class="t-section g100" id="financing-missing-heading">No live contract selected</h3><p class="t-body ink-2 financing-surface-copy">Pick a live deal below, or shape a new one on the offer surface.</p>${financingContractPickerHTML()}${financingDealShapeHTML()}</section>`;
}

function financingDealStatusTone(contract) {
  if (contract.status === "due") return "red";
  return "green";
}

function financingDealHeaderHTML(contract) {
  const status = String(contract.status || "active").toUpperCase();
  const tone = financingDealStatusTone(contract);
  return `<div class="financing-surface-kicker"><span class="t-micro g400">DEAL · LIVE</span><span class="t-label f11 ${tone}">${esc(status)} · ${esc(financingCureLine(contract))}</span></div><h3 class="t-section g100">${esc(financingContractTitle(contract))}</h3>`;
}

function financingDealDebtKeyHTML(contract) {
  const remaining = Number(contract.remaining || 0);
  return `<div class="financing-default-amount"><span class="t-micro ink-3">BALANCE LEFT</span><strong class="t-money red">$${remaining.toLocaleString()}</strong></div>`;
}

function financingDealEquityKeyHTML(contract) {
  const share = Number(contract.equityShare || 0);
  return `<div class="financing-default-amount"><span class="t-micro ink-3">${isRentShare(contract) ? "RENT SHARE" : "LEGACY EQUITY SHARE"}</span><strong class="t-money green">${share}%</strong></div>`;
}

function financingDealKeyFigureHTML(contract) {
  if (contract.kind === "equity") return financingDealEquityKeyHTML(contract);
  return financingDealDebtKeyHTML(contract);
}

function financingDealShowsProgress(contract) {
  if (contract.kind === "loan") return true;
  if (contract.kind !== "hybrid") return false;
  if (contract.status === "converted") return false;
  return true;
}

function financingDealProgressBarHTML(progress) {
  return `<div class="financing-ownership-bar financing-repayment-track" role="progressbar" aria-label="Contract repayment progress" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.paid}"><span class="financing-ownership-primary" style="width:${progress.pct}%"></span></div>`;
}

function financingDealProgressHTML(contract) {
  if (!financingDealShowsProgress(contract)) return "";
  const progress = financingRepayProgress(contract);
  return `<div class="financing-repayment-progress"><div class="financing-repayment-labels"><span class="t-micro ink-3">REPAID</span><strong class="t-label f12 g100">$${progress.paid.toLocaleString()} <span class="ink-3">of $${progress.total.toLocaleString()}</span></strong></div>${financingDealProgressBarHTML(progress)}<p class="t-micro ink-3">${progress.pct}% paid</p></div>`;
}

function financingDealTermsHTML(contract) {
  const principal = Number(contract.amount || contract.principal || 0);
  const total = Number(contract.totalDue || principal);
  const interest = Math.max(0, total - principal);
  const collateral = contractCollateralIndices(contract).map(index => financingPropertyTile(index)?.name).filter(Boolean);
  const terms = contract.kind === "equity"
    ? [["Property", financingPropertyTile(contract.propertyIndex)?.name || "-"], ["Term", contract.expiresRound == null ? "Ongoing" : `Through round ${Number(contract.expiresRound)}`]]
    : [["Advanced", `$${principal.toLocaleString()}`], ["Total interest", `$${interest.toLocaleString()} (${Number(contract.premiumRate || 0)}%)`], ["Agreed total", `$${total.toLocaleString()}`], ["Due", `Round ${Number(contract.dueRound || contract.durationRounds || 0)}`], [contract.kind === "hybrid" ? "Default conversion" : "Collateral", contract.kind === "hybrid" ? `${Number(contract.conversionShare || 0)}% · ${financingPropertyTile(contract.propertyIndex)?.name || "property not set"}` : collateral.length ? collateral.join(", ") : "None"]];
  return `<dl class="financing-contract-terms">${terms.map(([label, value]) => `<div><dt class="t-micro ink-3">${esc(label)}</dt><dd class="t-label f12 g100">${esc(value)}</dd></div>`).join("")}</dl>`;
}

function financingDealIsDue(contract) {
  return contract.status === "due";
}

function financingDealCureHTML(contract) {
  if (!financingDealIsDue(contract)) return "";
  return `<p class="t-micro red">${esc(financingCureLine(contract))}</p>`;
}

function financingDealCapShares(tile) {
  if (!tile) return [];
  return financingTileShares(tile.i);
}

function financingDealHasCapTable(tile) {
  const shares = financingDealCapShares(tile);
  if (shares.length) return true;
  return false;
}

function financingDealCapRightsHTML(tile, shares) {
  const total = shares.reduce((sum, entry) => sum + Number(entry.share || 0), 0);
  const ownerPct = Math.max(0, 100 - total);
  const owner = financingOwnerMeta(tile);
  const splits = [ownerPct + "%", ...shares.map((entry) => Number(entry.share || 0) + "%")].join(" / ");
  return `${financingOwnershipBarHTML(shares, ownerPct, owner.color)}${financingOwnerRowsHTML(shares, ownerPct, owner.name, owner.color)}<div class="financing-rights-grid"><div><span class="t-micro ink-3">BASE RENT $${baseRentOf(tile)}</span><strong class="t-label f13 g100">$${baseRentOf(tile)}</strong></div><div><span class="t-micro ink-3">BUILDING RIGHTS</span><strong class="t-label f13 green">${esc(financingOwnershipBuildingRights(shares))}</strong></div><div><span class="t-micro ink-3">SALE PROCEEDS</span><strong class="t-label f13 g100">${esc(splits)}</strong></div><div><span class="t-micro ink-3">DURATION</span><strong class="t-label f13 g100">${esc(financingOwnershipDurations(shares))}</strong></div></div>`;
}

function financingDealCapTableHTML() {
  const tile = financingOwnershipDeed();
  if (!financingDealHasCapTable(tile)) return "";
  const shares = financingDealCapShares(tile);
  return `${financingDealCapRightsHTML(tile, shares)}${financingDeedPickerHTML()}${financingTransferComposerHTML(tile, shares)}`;
}

function financingTransferComposerHTML(tile, shares) {
  if (!playerFinanceEnabled(state.settings)) return "";
  shares = shares.filter(entry => !isRentShare(financingActiveContracts().find(contract => contract.id === entry.contractId)) && Number(entry.rentShareVersion) !== 1);
  const localId = financingMyServerId();
  const buyers = otherPlayers();
  if (!localId || !buyers.length) return "";
  return shares.filter(entry => String(entry.holderId) === String(localId) && entry.contractId)
    .map(entry => {
      const available = Math.max(0, Math.floor(Number(entry.share) || 0));
      const controls = equityTransferControlsHTML(available);
      if (!controls) return "";
      return `<details class="equity-transfer-composer"><summary><span class="t-label f11 g-muted">TRANSFER YOUR ${esc(tile.name)} SHARE · ${available}% AVAILABLE</span></summary><p class="t-micro ink-3">The buyer receives passive rights for the share's remaining duration. Nothing moves until the offer is accepted.</p><form data-equity-transfer-form data-contract-id="${esc(entry.contractId)}" data-tile-index="${tile.i}"><label class="financing-field"><span class="t-label f11 g-muted">BUYER</span><select class="field" name="toPlayerId" required><option value="">SELECT A PLAYER</option>${buyers.map(player => `<option value="${esc(player.serverId || player.id)}">${esc(player.name)}</option>`).join("")}</select></label>${controls}<button class="btn-dark" type="submit"><span class="t-label f11">SEND TRANSFER OFFER</span></button></form></details>`;
    }).join("");
}

export function equityTransferControlsHTML(availableShare) {
  const available = Math.floor(Number(availableShare) || 0);
  if (available < 5) return "";
  return `<label class="financing-field"><span class="t-label f11 g-muted">SHARE TO TRANSFER (%)</span><input class="field" type="number" name="sharePct" min="5" max="${available}" step="1" value="${Math.min(10, available)}" required></label><label class="financing-field"><span class="t-label f11 g-muted">PRICE ($)</span><input class="field" type="number" name="price" min="1" step="1" value="1" required></label>`;
}

export function equityTransferPayload({ fromPlayerId, toPlayerId, contractId, sharePct, price, requestId }) {
  return {
    fromPlayerId,
    toPlayerId,
    contractId,
    sharePct: Math.max(1, Math.floor(Number(sharePct) || 0)),
    price: Math.max(0, Math.floor(Number(price) || 0)),
    requestId,
  };
}

function equityTransferFormValid(form, sharePct, maxShare, price) {
  if (!form.reportValidity()) return false;
  if (sharePct < 5) return false;
  if (sharePct > maxShare) return false;
  return price >= 1;
}

function equityTransferRequestId() {
  if (typeof host.createRequestId === "function") return host.createRequestId("equity-transfer");
  return `equity-transfer-${Date.now().toString(36)}`;
}

function setNodeDisabled(node, disabled) {
  if (node) node.disabled = disabled;
}

function onEquityTransferSubmit(event) {
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

function financingDealCopyHTML(contract) {
  return `<p class="t-body ink-2 financing-surface-copy" id="financing-card-description">${esc(financingContractCopy(contract))}</p>`;
}

function financingDealReasonHTML() {
  return `<p class="t-micro ink-3">NO PAYMENT DUE ON THIS DEAL.</p>`;
}

function financingDealActionHTML(contract) {
  const repay = financingContractRepayHTML(contract);
  if (repay) return `<div class="financing-surface-actions">${repay}</div>`;
  return financingDealReasonHTML();
}

function financingDealShapeHTML() {
  if (!playerFinanceEnabled(state.settings)) return "";
  return `<div class="financing-surface-actions"><button class="btn-dark" type="button" data-financing-view="builder"><span class="t-label f11">SHAPE NEW DEAL</span></button></div>`;
}

function financingContractPartyName(contract, side) {
  const id = contract[`${side}PlayerId`];
  const player = state.players.find(player => player.serverId === id || player.id === id);
  return contract[`${side}PlayerName`] || player?.name || "PLAYER";
}

function financingLedgerRowsHTML(rows) {
  return `<dl class="financing-ledger-rows">${rows.map(([label, value]) => `<div><dt class="t-micro ink-3">${esc(label)}</dt><dd class="t-label f12 g100">${esc(value)}</dd></div>`).join("")}</dl>`;
}

function financingActiveTermsHTML(contract) {
  const principal = Number(contract.amount || contract.principal || 0);
  const property = financingPropertyTile(contract.propertyIndex)?.name || "Not recorded";
  if (isRentShare(contract)) return financingLedgerRowsHTML([["Investment", `$${principal.toLocaleString()}`], ["Property", property], ["Collected rent", `${Number(contract.equityShare || 0)}%`], ["Expiry", `Start of round ${Number(contract.expiresRound)}`]]);
  if (contract.kind === "equity") {
    return financingLedgerRowsHTML([["Investment", `$${principal.toLocaleString()}`], ["Property", property], ["Control", String(contract.equityControl || "passive").toUpperCase()], ["Term", contract.expiresRound == null ? "Permanent" : `Through round ${Number(contract.expiresRound)}`]]);
  }
  const total = Number(contract.totalDue || principal);
  const collateral = contractCollateralIndices(contract).map(index => financingPropertyTile(index)?.name).filter(Boolean);
  const rows = [["Cash advanced", `$${principal.toLocaleString()}`], ["Total interest", `$${Math.max(0, total - principal).toLocaleString()} (${Number(contract.premiumRate || 0)}%)`], ["Agreed total", `$${total.toLocaleString()}`], ["Due round", `Round ${Number(contract.dueRound || 0)}`]];
  rows.push(contract.kind === "hybrid" ? ["Conversion property", property] : ["Collateral", collateral.length ? collateral.join(", ") : "None · unsecured"]);
  return financingLedgerRowsHTML(rows);
}

function financingActiveRightsHTML(contract) {
  if (isRentShare(contract)) return `<h4 class="t-label f12 g100">Temporary rent share</h4><p class="t-body ink-2">${esc(rentShareDisclosure(contract))}</p>`;
  const credit = collateralCreditSummary(contract);
  if (credit) return `<h4 class="t-label f12 g100">Collateral credit at default</h4><p class="t-body ink-2">${esc(credit)}</p>`;
  if (contract.kind === "equity") return `<h4 class="t-label f12 g100">Ownership & returns</h4><p class="t-body ink-2">${Number(contract.equityShare || 0)}% of collected rent and sale proceeds goes to ${esc(financingContractPartyName(contract, "from"))}.</p>`;
  if (contract.kind === "hybrid") return `<h4 class="t-label f12 g100">Uncured default</h4><p class="t-body ink-2">The lender converts ${Number(contract.conversionShare || 0)}% of the linked property's economic share after cure. No collateral is seized.</p>`;
  return `<h4 class="t-label f12 g100">Ownership & default</h4><p class="t-body ink-2">${contractCollateralIndices(contract).length ? "The borrower keeps every pledged deed while payments are current. Uncured default transfers all pledged deeds to the lender." : "No deed is pledged. The borrower owes the agreed total interest."}</p>`;
}

function financingActiveOwnershipHTML(contract) {
  if (contract.kind !== "equity" || isRentShare(contract)) return "";
  const tile = financingContractDeed(contract);
  const shares = financingDealCapShares(tile);
  if (!tile || !shares.length) return "";
  const owner = financingOwnerMeta(tile);
  const ownerPct = Math.max(0, 100 - shares.reduce((sum, entry) => sum + Number(entry.share || 0), 0));
  return `<div class="financing-ledger-ownership"><h4 class="t-label f12 g100">Current ownership</h4>${financingOwnershipBarHTML(shares, ownerPct, owner.color)}${financingOwnerRowsHTML(shares, ownerPct, owner.name, owner.color)}${financingTransferComposerHTML(tile, shares)}</div>`;
}

export function financingActiveContractDetailHTML(contract) {
  const equity = contract.kind === "equity";
  const figure = equity ? `${Number(contract.equityShare || 0)}%` : `$${Number(contract.remaining || 0).toLocaleString()}`;
  const repayment = equity ? "" : financingContractRepayHTML(contract);
  return `<section class="financing-surface-body financing-contract-detail financing-active-ledger financing-contract-${esc(contract.kind || "loan")}" aria-labelledby="financing-deal-heading"><div class="financing-ledger-parties" id="financing-deal-heading"><div><span class="t-micro ink-3">${equity ? "INVESTOR" : "LENDER"}</span><strong class="t-label f13 g100">${esc(financingContractPartyName(contract, "from"))}</strong></div><div><span class="t-micro ink-3">${equity ? "PROPERTY OWNER" : "BORROWER"}</span><strong class="t-label f13 g100">${esc(financingContractPartyName(contract, "to"))}</strong></div><span class="t-micro green">ACTIVE</span></div><div class="financing-ledger-main"><div class="financing-ledger-account"><div class="financing-ledger-balance"><span class="t-label f11 g-muted">${equity ? (isRentShare(contract) ? "Rent share" : "Legacy economic share") : "Balance remaining"}</span><strong class="t-money g100">${figure}</strong></div>${financingActiveTermsHTML(contract)}${equity ? "" : financingDealProgressHTML(contract)}</div><aside class="financing-ledger-action">${financingActiveRightsHTML(contract)}${repayment || (equity ? "" : `<p class="t-micro ink-3">${esc(financingContractPartyName(contract, "to"))} makes payments on this contract.</p>`)}</aside></div>${financingActiveOwnershipHTML(contract)}${financingDealShapeHTML()}</section>`;
}

function financingDealSelectedHTML(contract) {
  if (contract.status === "active") return financingActiveContractDetailHTML(contract);
  return `<section class="financing-surface-body financing-contract-detail financing-contract-${esc(contract.kind || "loan")}" aria-labelledby="financing-deal-heading"><div id="financing-deal-heading">${financingDealHeaderHTML(contract)}</div>${financingDealKeyFigureHTML(contract)}${financingDealTermsHTML(contract)}${financingDealProgressHTML(contract)}${financingDealCureHTML(contract)}${financingDealCapTableHTML()}${financingDealCopyHTML(contract)}${financingDealActionHTML(contract)}${financingDealShapeHTML()}</section>`;
}

function financingDealViewHTML() {
  const contract = financingSelectedContract();
  if (!contract) return financingMissingContractHTML();
  if (financingContractRedacted(contract)) return financingMissingContractHTML();
  return financingDealSelectedHTML(contract);
}

function financingBuilderHTML() {
  const sendDisabled = financingSendDisabled();
  return `<section class="financing-surface-body financing-builder" aria-labelledby="financing-offer-heading"><div class="financing-mode-tabs" id="financing-mode-tabs" role="tablist" aria-label="Financing mode"><button class="financing-mode-tab${financingPreviewMode === "loan" ? " is-active" : ""}" type="button" role="tab" id="financing-tab-loan" aria-controls="financing-mode-panel" tabindex="${financingPreviewMode === "loan" ? "0" : "-1"}" aria-selected="${financingPreviewMode === "loan"}" data-financing-mode="loan"><span class="t-label f11">LOAN</span><span class="t-micro">FIXED RETURN</span></button><button class="financing-mode-tab${financingPreviewMode === "equity" ? " is-active" : ""}" type="button" role="tab" id="financing-tab-equity" aria-controls="financing-mode-panel" tabindex="${financingPreviewMode === "equity" ? "0" : "-1"}" aria-selected="${financingPreviewMode === "equity"}" data-financing-mode="equity"><span class="t-label f11">RENT SHARE</span><span class="t-micro">TEMPORARY · PASSIVE</span></button></div><h3 class="sr-only" id="financing-offer-heading">Financing offer builder</h3><div class="financing-form" id="financing-mode-panel" tabindex="0" role="tabpanel" aria-labelledby="financing-tab-${financingPreviewMode}">${dropdownHTML({ id: "finance-recipient", label: "Counterparty", value: financingRecipientId(), options: financingRecipients() })}${financingPropertyPickerHTML()}<div class="financing-field"><label class="t-label f11 g-muted" for="finance-amount">Cash advanced / contributed</label><input class="field" id="finance-amount" type="number" min="1" step="1" value="${financingPreviewDraft.amount}" aria-invalid="${Boolean(financingAmountError())}"${financingAmountError() ? ' aria-describedby="finance-amount-error"' : ""} /><p class="t-micro red financing-amount-error" id="finance-amount-error" role="status">${financingAmountError()}</p></div><div id="financing-mode-fields">${financingModeFieldsHTML()}</div></div><section class="financing-preview" id="financing-preview" tabindex="0" aria-label="Contract preview" aria-live="polite">${financingPreviewHTML()}</section><div class="financing-actions is-solo"><button class="cta-red${sendDisabled ? " financing-disabled-action" : ""}" id="financing-send" type="button" ${sendDisabled ? "disabled" : ""}><span class="cta-text cta-text-sm">SEND CONTRACT</span></button></div></section>`;
}

function negotiationOwnedPropertyOptions(contract) {
  const borrowerId = contract?.toPlayerId;
  if (!borrowerId) return [];
  const borrower = state.players.find((player) => player.serverId === borrowerId || player.id === borrowerId);
  if (!borrower) return [];
  return TILES.filter((tile) => ["property", "railroad", "utility"].includes(tile.kind) && state.owners[tile.i] === borrower.id && !state.mortgaged[tile.i] && !financingTileShares(tile.i).length);
}

function negotiationSelectHTML(id, label, value, options) {
  return `<label class="financing-field"><span class="t-label f11 g-muted">${esc(label)}</span><select class="field" id="${esc(id)}" data-negotiation-field="${esc(id)}">${options.map((option) => `<option value="${esc(option.value)}"${String(option.value) === String(value) ? " selected" : ""}>${esc(option.label)}</option>`).join("")}</select></label>`;
}

function negotiationPropertySelectHTML(id, label, value, options) {
  if (!options.length) return `<div class="financing-field"><span class="t-label f11 g-muted">${esc(label)}</span><span class="t-micro red">NO ELIGIBLE DEEDS</span></div>`;
  return negotiationSelectHTML(id, label, value ?? options[0].i, options.map((tile) => ({ value: tile.i, label: `${tile.name} · $${tile.price}` })));
}

function negotiationCollateralAccordionHTML(contract) {
  const deeds = negotiationOwnedPropertyOptions(contract).filter(financingCollateralDeedEligible);
  const selected = new Set(financingNegotiationDraft.collateralTileIndices || []);
  return collateralPickerHTML({
    id: "negotiation-collateral",
    deeds,
    selected,
    checkboxAttribute: 'data-negotiation-field="negotiation-collateral"'
  });
}

function collateralPickerHTML({ id, deeds, selected, checkboxAttribute }) {
  const selectedDeeds = deeds.filter((tile) => selected.has(tile.i));
  const selectedLabel = selectedDeeds.length
    ? `${selectedDeeds.length} SELECTED · ${selectedDeeds.map((tile) => tile.name).join(", ")}`
    : "SELECT DEEDS…";
  const options = deeds.length
    ? deeds.map((tile) => `<label class="financing-collateral-option" data-collateral-option><input type="checkbox" ${checkboxAttribute} value="${tile.i}" ${selected.has(tile.i) ? "checked" : ""}><span class="t-label f11 g100" data-collateral-name>${esc(tile.name)}</span><span class="t-micro ink-3">$${Number(tile.price || 0).toLocaleString()}</span></label>`).join("")
    : '<span class="t-micro ink-3">NO ELIGIBLE DEEDS</span>';
  return `<div class="financing-collateral-picker" data-collateral-root><label class="t-label f11 g-muted" for="${id}-trigger">COLLATERAL · OPTIONAL</label><input class="field financing-collateral-trigger" type="text" id="${id}-trigger" data-collateral-trigger readonly aria-readonly="true" aria-label="Choose collateral deeds. ${esc(selectedLabel)}" aria-expanded="false" aria-controls="${id}-panel" placeholder="${esc(selectedLabel)}"><div class="financing-collateral-panel" id="${id}-panel" data-collateral-panel hidden><fieldset class="financing-collateral-options" id="${id}-options"><legend class="t-micro g400">ELIGIBLE DEEDS · SELECT ANY</legend>${options}</fieldset></div></div>`;
}

function setCollateralPickerOpen(picker, open, { restoreFocus = false } = {}) {
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

function updateCollateralPickerLabel(picker) {
  if (!picker) return;
  const selected = [...picker.querySelectorAll("[data-collateral-option] input:checked")];
  const names = selected.map((input) => input.closest("[data-collateral-option]")?.querySelector("[data-collateral-name]")?.textContent).filter(Boolean);
  const trigger = picker.querySelector("[data-collateral-trigger]");
  const selectedLabel = names.length ? `${names.length} SELECTED · ${names.join(", ")}` : "SELECT DEEDS…";
  trigger.placeholder = selectedLabel;
  trigger.setAttribute("aria-label", `Choose collateral deeds. ${selectedLabel}`);
}

function collateralTriggerOpenKey(event, trigger) {
  if (event.target !== trigger) return false;
  if (trigger.getAttribute("aria-expanded") === "true") return false;
  return event.key === "Enter" || event.key === "ArrowDown";
}

function collateralTriggerCloseKey(event, trigger) {
  if (event.key !== "Escape") return false;
  return trigger.getAttribute("aria-expanded") === "true";
}

function bindCollateralPicker(card) {
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

function negotiationFieldsHTML(contract) {
  const kind = contract.kind;
  const deeds = negotiationOwnedPropertyOptions(contract);
  const common = `<div class="financing-field-grid"><label class="financing-field"><span class="t-label f11 g-muted">Cash advanced / contributed</span><input class="field" id="negotiation-amount" data-negotiation-field="negotiation-amount" type="number" min="1" step="1" value="${financingNegotiationDraft.amount}" /></label><label class="financing-field"><span class="t-label f11 g-muted">Duration in rounds</span><input class="field" id="negotiation-duration" data-negotiation-field="negotiation-duration" type="number" min="1" max="20" step="1" value="${financingNegotiationDraft.durationRounds}" /></label></div>`;
  if (kind === "equity") {
    return `${common}<label class="financing-field"><span class="t-label f11 g-muted">Share of collected rent %</span><input class="field" id="negotiation-equity-share" data-negotiation-field="negotiation-equity-share" type="number" min="5" max="100" step="5" value="${financingNegotiationDraft.equityShare}" /></label>${negotiationPropertySelectHTML("negotiation-property", "Recipient deed", financingNegotiationDraft.propertyIndex, deeds)}<p class="t-micro ink-3">${esc(rentShareDisclosure(financingNegotiationDraft))}</p>`;
  }

  return `${common}<label class="financing-field"><span class="t-label f11 g-muted">Total interest %</span><input class="field" id="negotiation-premium" data-negotiation-field="negotiation-premium" type="number" min="0" max="100" step="1" value="${financingNegotiationDraft.premiumRate}" /></label>${negotiationCollateralAccordionHTML(contract)}`;
}

function negotiationCollateralTiles(contract) {
  if (contract.kind !== "loan") return [];
  const eligible = new Set(negotiationOwnedPropertyOptions(contract).filter(financingCollateralDeedEligible).map(tile => tile.i));
  return (financingNegotiationDraft.collateralTileIndices || []).filter(index => eligible.has(Number(index))).map(financingPropertyTile).filter(Boolean);
}

function negotiationSlip(contract, amount, premium, total) {
  const d = financingNegotiationDraft;
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

function negotiationPreviewHTML(contract) {
  const amount = Math.max(1, Math.floor(Number(financingNegotiationDraft.amount) || 0));
  const premium = Math.max(0, Math.min(100, Number(financingNegotiationDraft.premiumRate) || 0));
  const total = amount + Math.ceil((amount * premium) / 100);
  const slip = negotiationSlip(contract, amount, premium, total);
  const rows = slip.rows.map(([label, value]) => `<div><span class="t-micro ink-3">${label}</span><strong class="t-label f13 g100">${esc(value)}</strong></div>`).join("");
  return `<div class="financing-preview-head"><span class="t-micro g400">COUNTER PREVIEW · TO ${esc((financingNegotiationAction === "adjust" ? contract.toPlayerName : contract.fromPlayerName) || "PLAYER")}</span><span class="t-label f12 g100">${slip.title}</span></div><div class="financing-focal"><span class="t-micro ink-3">${slip.focal[0]}</span><strong class="slip-amount g050">${esc(slip.focal[1])}</strong></div><div class="financing-metrics">${rows}</div><p class="t-body ink-2 financing-preview-copy">${slip.risk ? `${esc(slip.risk)} ` : ""}No cash moves until they accept.</p><p class="t-micro ink-3 financing-preview-note">Negotiation is capped at two counters.</p>`;
}

function financingNegotiationHTML(contract) {
  const adjusting = financingNegotiationAction === "adjust";
  return `<section class="financing-surface-body financing-builder" aria-labelledby="financing-negotiate-heading"><h3 class="sr-only" id="financing-negotiate-heading">${adjusting ? "Adjust" : "Counter"} the ${esc(contractLabel(contract))} deal</h3><div class="financing-form" tabindex="0" role="region" aria-label="Financing terms">${negotiationFieldsHTML(contract)}</div><section class="financing-preview" id="negotiation-preview" tabindex="0" aria-label="Counteroffer preview" aria-live="polite">${negotiationPreviewHTML(contract)}</section><div class="financing-actions is-solo"><button class="cta-red" id="financing-negotiate-send" type="button"><span class="cta-text cta-text-sm">${adjusting ? "SEND ADJUSTMENT" : "SEND COUNTER"}</span></button></div></section>`;
}

function currentNegotiationContract() {
  const id = financingNegotiationContractId;
  if (!id) return null;
  if (state.playerContractOffer?.id === id) return state.playerContractOffer;
  if (state.playerContracts?.pending?.id === id) return state.playerContracts.pending;
  return null;
}

function financingViewBodyHTML() {
  if (financingView === "negotiate") {
    const contract = currentNegotiationContract();
    return contract ? financingNegotiationHTML(contract) : financingMissingContractHTML();
  }
  if (financingView === "deal") return financingDealViewHTML();
  return financingBuilderHTML();
}

function syncFinancingRanges(root = $("#financing-card")) {
  root?.querySelectorAll(".financing-range input[type=range]").forEach((input) => {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const value = Number(input.value) || min;
    const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.parentElement?.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, progress))}%`);
  });
}

function refreshFinancingPreview() {
  const preview = $("#financing-preview");
  if (preview) preview.innerHTML = financingPreviewHTML();
  const amountError = financingAmountError();
  const amount = $("#finance-amount");
  if (amount) {
    amount.setAttribute("aria-invalid", String(Boolean(amountError)));
    if (amountError) amount.setAttribute("aria-describedby", "finance-amount-error");
    else amount.removeAttribute("aria-describedby");
  }
  const error = $("#finance-amount-error");
  if (error) error.textContent = amountError;
  for (const [id, message] of Object.entries(financingLoanErrors())) {
    const input = $(`#${id}`);
    if (!input) continue;
    input.setAttribute("aria-invalid", String(Boolean(message)));
    const errorNode = $(`#${id}-error`);
    if (errorNode) errorNode.textContent = message;
  }
  const send = $("#financing-send");
  if (send) {
    send.disabled = financingSendDisabled();
    send.classList.toggle("financing-disabled-action", send.disabled);
  }
}

const FINANCE_INPUT_FIELDS = {
  "finance-amount": (value) => { financingPreviewDraft.amount = financingAmount(value); },
  "finance-loan-rate": (value) => { financingPreviewDraft.loanRate = value; },
  "finance-loan-duration": (value) => { financingPreviewDraft.loanDuration = value; },
  "finance-equity-duration": (value) => { financingPreviewDraft.equityDuration = boundedInteger(value, 3, 1, 20); },
};

const FINANCE_RANGE_OUTPUTS = {
  "finance-equity-share": { key: "equityShare", fallback: 10, outputId: "#finance-equity-share-output" },
};

function applyFinanceRangeField(id, value) {
  const cfg = FINANCE_RANGE_OUTPUTS[id];
  if (!cfg) return;
  financingPreviewDraft[cfg.key] = Number(value) || cfg.fallback;
  $(cfg.outputId).textContent = `${financingPreviewDraft[cfg.key]}%`;
}

function onFinancingInput(card, event) {
  const { id, value } = event.target;
  const setter = FINANCE_INPUT_FIELDS[id];
  if (setter) setter(value);
  if (id === "finance-amount") event.target.value = financingPreviewDraft.amount;
  if (id === "finance-equity-duration") event.target.value = financingPreviewDraft.equityDuration;
  applyFinanceRangeField(id, value);
  if (event.target.matches("input[type=range]")) syncFinancingRanges(card);
  refreshFinancingPreview();
}

function onFinancingChange(card, event) {
  const input = event.target.closest?.("[data-finance-collateral]");
  if (!input) return;
  onFinancingCollateralChange(input);
  updateCollateralPickerLabel(input.closest("[data-collateral-root]"));
  refreshFinancingPreview();
}

const NEGOTIATION_NUMBER_FIELDS = {
  "negotiation-amount": { key: "amount", fallback: 1, min: 1, max: 100000 },
  "negotiation-duration": { key: "durationRounds", fallback: 3, min: 1, max: 20 },
  "negotiation-premium": { key: "premiumRate", fallback: 0, min: 0, max: 100 },
  "negotiation-equity-share": { key: "equityShare", fallback: 10, min: 5, max: 100 },
};

const NEGOTIATION_FIELD_SETTERS = {
  "negotiation-property": (event, value) => { financingNegotiationDraft.propertyIndex = Number(value); },
  "negotiation-collateral": (event) => negotiationCollateralChanged(event),
};

function boundedInteger(value, fallback, min, max = Number.POSITIVE_INFINITY) {
  return Math.max(min, Math.min(max, Math.floor(Number(value) || fallback)));
}

function negotiationCollateralChanged(event) {
  const index = Number(event.target.value);
  const contract = currentNegotiationContract();
  if (!contract || !negotiationOwnedPropertyOptions(contract).filter(financingCollateralDeedEligible).some(tile => tile.i === index)) return;
  const selected = new Set(financingNegotiationDraft.collateralTileIndices || []);
  if (event.target.checked) selected.add(index);
  else selected.delete(index);
  financingNegotiationDraft.collateralTileIndices = [...selected].sort((a, b) => a - b);
  updateCollateralPickerLabel(event.target.closest("[data-collateral-root]"));
}

function applyNegotiationField(field, event, value) {
  const numberField = NEGOTIATION_NUMBER_FIELDS[field];
  if (numberField) {
    financingNegotiationDraft[numberField.key] = boundedInteger(value, numberField.fallback, numberField.min, numberField.max);
    return;
  }
  const setter = NEGOTIATION_FIELD_SETTERS[field];
  if (setter) setter(event, value);
}

function refreshNegotiationPreview() {
  const contract = state.playerContractOffer;
  const preview = $("#negotiation-preview");
  if (preview && contract) preview.innerHTML = negotiationPreviewHTML(contract);
}

function negotiationFieldChanged(event) {
  const field = event.target?.dataset?.negotiationField;
  if (!field) return false;
  const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  applyNegotiationField(field, event, value);
  refreshNegotiationPreview();
  return true;
}

function applyNegotiationTerms(payload, contract) {
  if (contract.kind === "loan") {
    payload.collateralTileIndices = negotiationCollateralTiles(contract).map(tile => tile.i);
    return;
  }
  payload.propertyIndex = financingNegotiationDraft.propertyIndex;
  if (contract.kind === "equity") {
    payload.equityShare = boundedInteger(financingNegotiationDraft.equityShare, 10, 5, 100);
    payload.equityControl = "passive";
    payload.permanent = false;
    return;
  }
}

function negotiationPayload(contract) {
  const payload = {
    contractId: contract.id,
    kind: contract.kind,
    amount: boundedInteger(financingNegotiationDraft.amount, 1, 1),
    premiumRate: boundedInteger(financingNegotiationDraft.premiumRate, 0, 0, 100),
    durationRounds: boundedInteger(financingNegotiationDraft.durationRounds, 3, 1, 20),
    requestId: host.createRequestId("contract-counter"),
  };
  applyNegotiationTerms(payload, contract);
  return payload;
}

function sendFinancingNegotiation(control = document.activeElement) {
  const statusNode = host.captureActionStatusNode(control);
  const contract = currentNegotiationContract();
  if (!canNegotiateContract(contract) || contract.id !== financingNegotiationContractId || negotiationActionFor(contract) !== financingNegotiationAction) return;
  host.emitServer(financingNegotiationAction === "adjust" ? "adjust-player-contract" : "counter-player-contract", negotiationPayload(contract), (response) => {
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

function repayInputValue(contractId) {
  return $("#financing-repay-" + contractId)?.value;
}

function contractRemainingAmount(contract) {
  return Math.max(0, Math.floor(Number(contract.remaining) || 0));
}

function settledRepayment(response, amount, remainingBefore) {
  const remainingAfter = Number(response?.contract?.remaining);
  if (!Number.isFinite(remainingAfter)) return amount;
  return Math.max(0, Math.min(amount, remainingBefore - remainingAfter));
}

function sendFinancingRepay(contractId, control = document.activeElement) {
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
      financingRepayStatus = { contractId, text: status };
      host.renderRightRail();
      renderFinancingModal();
    },
    onTimeout: () => host.announceActionStatus("The repayment could not be confirmed. Check the loan before retrying.", statusNode),
  });
}

function onFinancingRepayNode(event) {
  const repay = event.target.closest("[data-financing-repay]");
  if (!repay) return false;
  sendFinancingRepay(repay.dataset.financingRepay, repay);
  return true;
}

function onFinancingPickNode(event) {
  const pick = event.target.closest("[data-financing-pick]");
  if (!pick) return false;
  financingSurfaceContractId = pick.dataset.financingPick;
  financingSurfaceTileIndex = null;
  renderFinancingModal();
  return true;
}

function onFinancingDeedNode(event) {
  const deed = event.target.closest("[data-financing-deed]");
  if (!deed) return false;
  financingSurfaceTileIndex = Number(deed.dataset.financingDeed);
  renderFinancingModal();
  return true;
}

function financingViewRequested(value) {
  if (value === "deal") return "deal";
  return "builder";
}

function onFinancingViewNode(event) {
  const button = event.target.closest("button[data-financing-view]");
  if (!button) return false;
  financingView = financingViewRequested(button.dataset.financingView);
  renderFinancingModal();
  return true;
}

function onFinancingSurfaceClick(event) {
  if (onFinancingRepayNode(event)) return;
  if (onFinancingPickNode(event)) return;
  if (onFinancingDeedNode(event)) return;
  if (onFinancingViewNode(event)) return;
}

function onFinancingModeTab(event) {
  const button = event.target.closest("[data-financing-mode]");
  if (!button || !["loan", "equity"].includes(button.dataset.financingMode)) return;
  financingPreviewMode = button.dataset.financingMode;
  clampPropertyToRecipient();
  clampCollateralToRecipient();
  renderFinancingModal();
  $(`#financing-tab-${financingPreviewMode}`)?.focus({ preventScroll: true });
}

function onFinancingModeKeydown(event) {
  const button = event.target.closest("[data-financing-mode]");
  if (!button || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const mode = event.key === "Home" ? "loan" : event.key === "End" ? "equity" : button.dataset.financingMode === "loan" ? "equity" : "loan";
  onFinancingModeTab({ target: { closest: () => ({ dataset: { financingMode: mode } }) } });
}

function onFinancingDropdownSelect(id, value) {
  if (id === "finance-recipient") {
    onFinancingRecipientSet(value);
    return;
  }
  if (id === "finance-property") financingPreviewDraft.propertyIndex = Number(value);
  refreshFinancingPreview();
}

function bindFinancingOfferSurface(card) {
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

function wireFinancingChrome() {
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

function financingIsBuilderView() {
  return financingView !== "deal";
}

function renderFinancingModal() {
  const card = $("#financing-card");
  if (!card) return;
  const modeLabels = { loan: "LOAN", equity: "RENT SHARE", hybrid: "LEGACY CONVERTIBLE NOTE" };
  const negotiating = financingView === "negotiate";
  const viewingContract = financingView === "deal";
  const activeContract = viewingContract ? financingSelectedContract() : null;
  card.dataset.financingView = financingView;
  card.dataset.financingMode = financingPreviewMode;
  const activeMode = activeContract ? contractLabel(activeContract).toUpperCase() : "CONTRACT";
  const headerKicker = negotiating ? "DEAL NEGOTIATION · COUNTER TERMS" : "PARLOR DEAL BUILDER · LIVE TERMS";
  const headerTitle = negotiating
    ? `Negotiate a ${modeLabels[financingPreviewMode] || "CONTRACT"} deal`
    : viewingContract ? `${activeMode} contract` : `Shape a ${modeLabels[financingPreviewMode] || "LOAN"} deal`;
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

function ensureFinancingRecipient() {
  if (financingRecipientValid(financingPreviewDraft.recipientId)) return;
  financingPreviewDraft.recipientId = defaultRecipientId();
}

function ensureFinancingDraft(propertyIndex) {
  ensureFinancingRecipient();
  if (propertyIndex != null && TILES[Number(propertyIndex)]?.kind === "property") financingPreviewDraft.propertyIndex = Number(propertyIndex);
  clampPropertyToRecipient();
  clampCollateralToRecipient();
}

export function openFinancingContract(contractId, trigger = null) {
  const contract = financingActiveContracts().find((c) => c.id === contractId);
  if (!contract) {
    host.announceActionStatus("That contract is no longer live.", host.captureActionStatusNode(trigger || document.activeElement));
    return;
  }
  financingSurfaceContractId = contractId;
  financingSurfaceTileIndex = null;
  financingView = "deal";
  renderFinancingModal();
  openSurface("#financing-modal", "#financing-close", { trigger });
}

function financingPreviewModeFor(mode) {
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
  financingPreviewMode = financingPreviewModeFor(mode);
  financingView = "builder";
  ensureFinancingDraft(propertyIndex);
  renderFinancingModal();
  openSurface("#financing-modal", "#financing-close", { trigger });
  if (financingIsBuilderView()) $("#finance-recipient-trigger")?.focus({ preventScroll: true });
}

function negotiationNumber(value, fallback, min, max = Number.POSITIVE_INFINITY) {
  return Math.max(min, Math.min(max, Number(value) || fallback));
}

function negotiationCollateralIndices(contract) {
  if (Array.isArray(contract.collateralTileIndices)) return contract.collateralTileIndices.map(Number);
  if (contract.collateralTileIndex == null) return [];
  return [Number(contract.collateralTileIndex)];
}

function loadNegotiationDraft(contract) {
  financingNegotiationDraft.kind = contract.kind || "loan";
  financingNegotiationDraft.amount = negotiationNumber(contract.amount, 1, 1);
  financingNegotiationDraft.premiumRate = negotiationNumber(contract.premiumRate, 0, 0, 100);
  financingNegotiationDraft.durationRounds = negotiationNumber(contract.durationRounds, 3, 1, 20);
  financingNegotiationDraft.propertyIndex = contract.propertyIndex ?? null;
  financingNegotiationDraft.collateralTileIndices = negotiationCollateralIndices(contract);
  financingNegotiationDraft.equityShare = negotiationNumber(contract.equityShare, 10, 5, 100);
}

function findNegotiationContract(contractId) {
  if (state.playerContractOffer?.id === contractId) return state.playerContractOffer;
  if (state.playerContracts?.pending?.id === contractId) return state.playerContracts.pending;
  return null;
}

function negotiationActionFor(contract) {
  const depth = Math.max(0, Math.floor(Number(contract.counterDepth) || 0));
  const lastProposerId = contract.lastProposerId || (depth % 2 === 0 ? contract.fromPlayerId : contract.toPlayerId);
  if (lastProposerId === financingMyServerId()) return "adjust";
  return "counter";
}

function canNegotiateContract(contract) {
  const self = financingMyServerId();
  return Boolean(contract && playerFinanceEnabled(state.settings)
    && (self === contract.fromPlayerId || self === contract.toPlayerId)
    && Number(contract.counterDepth || 0) < 2
    && (Number(contract.rulesVersion) === 2 ? contract.kind !== "hybrid" : contract.kind === "loan"));
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
  financingNegotiationContractId = contractId;
  state.negotiationContractId = contractId;
  financingNegotiationAction = negotiationActionFor(contract);
  loadNegotiationDraft(contract);
  financingPreviewMode = contract.kind || "loan";
  financingView = "negotiate";
  renderFinancingModal();
  openSurface("#financing-modal", "#financing-close", { trigger });
}

export function closeFinancingModal() {
  financingNegotiationContractId = null;
  financingNegotiationAction = "counter";
  state.negotiationContractId = null;
  closeSurface("#financing-modal");
}

function tradeBuildingLevel(tileIndex) {
  const serverTile = state.serverTiles.find(entry => Number(entry.index) === Number(tileIndex));
  const serverLevel = Number(serverTile?.houseCount);
  return Number.isInteger(serverLevel) && serverLevel >= 0 ? serverLevel : (Number(state.houses[tileIndex]) || 0);
}

function tradeBuildingBlockReason(tile) {
  if (!tile.group) return "";
  const hasBuildings = TILES.some(candidate => candidate.group === tile.group && tradeBuildingLevel(candidate.i) > 0);
  return hasBuildings ? "Sell all buildings in this color set before trading a deed." : "";
}

export function tradeDeedRowHTML(tile, side, selected, readOnly = false) {
  const rail = tile.group ? GROUP_COLOR[tile.group] : tile.kind === "railroad" ? "#5c5033" : "#3e7d7b";
  const mortgaged = !!state.mortgaged[tile.i];
  if (readOnly) {
    const value = Number.isFinite(tile.price) ? `$${tile.price.toLocaleString()}` : "-";
    return `<li class="trade-deed offer-deed"><span class="trade-deed-rail" style="background:${rail}"></span><span class="trade-deed-name">${esc(tile.name)}${mortgaged ? '<span class="t-micro red"> · MORTGAGED</span>' : ""}</span><span class="trade-deed-price">${value}</span></li>`;
  }
  const buildingReason = tradeBuildingBlockReason(tile);
  const authority = side === "me" ? state.serverTiles.find(entry => Number(entry.index) === Number(tile.i))?.propertyActions?.tradeDeed : null;
  const authorityReason = authority?.enabled === false ? (authority.reason || "This deed cannot be traded right now.") : "";
  const blockedReason = buildingReason || authorityReason;
  return `<button type="button" class="trade-deed${selected ? " is-selected" : ""}${mortgaged ? " is-mortgaged" : ""}" data-side="${side}" data-deed="${tile.i}" ${blockedReason ? `disabled aria-label="${esc(tile.name)}. ${esc(blockedReason)}" title="${esc(blockedReason)}"` : ""}>
    <span class="trade-deed-rail" style="background:${rail}"></span>
    <span class="trade-deed-name">${esc(tile.name)}${blockedReason ? `<span class="trade-deed-block-reason">${esc(blockedReason)}</span>` : ""}</span>
    ${mortgaged ? '<span class="t-micro red trade-deed-mortgage-badge">MORTGAGED</span>' : ""}
    <span class="trade-deed-price">$${tile.price}</span>
    <span class="trade-deed-check"></span>
  </button>`;
}

export function tradeReviewSideHTML({ player, seed, heading, cash, deedIndexes }) {
  const indexes = [...new Set(Array.isArray(deedIndexes) ? deedIndexes : [])];
  const deeds = indexes.map(index => TILES[Number(index)] || { i: index, name: `Deed ${index}` });
  const rows = deeds.length
    ? `<ul class="trade-deed-list thin-scroll" tabindex="0" aria-label="${esc(heading)} deeds">${deeds.map(tile => tradeDeedRowHTML(tile, "", false, true)).join("")}</ul>`
    : '<p class="t-body trade-empty">No deeds</p>';
  return `<section class="trade-side offer-side" aria-label="${esc(heading)}"><div class="trade-side-head"><div class="tp-av">${avatarHTML(player, 4, seed)}</div><div><h3 class="t-label f13 g100">${esc(heading)}</h3><span class="t-micro ink-2">${esc(player.name)}</span></div></div><div class="offer-cash"><span class="t-label f11 ink-2">CASH</span><strong class="t-label f20 g100">$${Math.max(0, Number(cash) || 0).toLocaleString()}</strong></div><div class="offer-deeds"><span class="t-label f11 ink-2">DEEDS · ${deeds.length}</span>${rows}</div></section>`;
}

function tradeSummaryText(deedSet, cash) {
  return `<span class="num">${deedSet.size}</span> deed${deedSet.size === 1 ? "" : "s"} + <span class="num">$${cash.toLocaleString()}</span>`;
}

function updateTradeSummary() {
  const sendEl = $("#trade-send-summary");
  const receiveEl = $("#trade-receive-summary");
  if (sendEl) sendEl.innerHTML = tradeSummaryText(state.tradeMyDeeds, state.tradeMyCash);
  if (receiveEl) receiveEl.innerHTML = tradeSummaryText(state.tradeTheirDeeds, state.tradeTheirCash);
}

function tradeSideHTML({ player, seed, side, deeds, selectedSet, cashValue, cashMax, inputId, cashLabel, emptyText }) {
  const rows = deeds.length
    ? deeds.map((t) => tradeDeedRowHTML(t, side, selectedSet.has(t.i))).join("")
    : `<p class="t-body trade-empty">${emptyText}</p>`;
  return `
        <div class="trade-side">
          <div class="trade-side-head">
            <div class="tp-av">${avatarHTML(player, 4, seed)}</div>
            <div>
              <span class="t-label f13" style="color:${player.textColor}">${esc(player.name)}</span>
              <span class="t-micro ink-3 trade-cash-label">CASH ON HAND <span class="num">$${player.cash.toLocaleString()}</span>
            </div>
          </div>
          <div class="trade-deed-list thin-scroll" role="group" tabindex="0" aria-label="${side === "me" ? "Deeds to offer" : "Deeds to request"}">
            ${rows}
          </div>
          <label class="trade-cash-field">
            <span class="t-label f11 g-muted" id="${inputId}-label">${cashLabel} (max <span class="num">$${Number(cashMax) || 0}</span>)</span>
            <input type="number" min="0" max="${cashMax}" step="10" class="field" id="${inputId}" value="${cashValue}" aria-labelledby="${inputId}-label" />
          </label>
          <input type="range" class="trade-range" id="${inputId}-range" min="0" max="${Number(cashMax) || 0}" step="10" value="${cashValue}" aria-label="${cashLabel} slider" />
        </div>`;
}

function tradeModalHTML({ me, other, otherSeed, myDeeds, theirDeeds }) {
  const negotiating = Boolean(state.tradeCounterId || state.tradeAdjustId);
  const adjustment = Boolean(state.tradeAdjustId);
  const recipientOptions = state.players.filter((p) => p.id !== "p1").map((p) => ({ value: p.id, label: p.name }));
  const mySide = tradeSideHTML({ player: me, seed: 0, side: "me", deeds: myDeeds, selectedSet: state.tradeMyDeeds, cashValue: state.tradeMyCash, cashMax: me.cash, inputId: "trade-my-cash", cashLabel: "CASH TO OFFER", emptyText: "NO DEEDS TO OFFER" });
  const theirSide = tradeSideHTML({ player: other, seed: otherSeed, side: "them", deeds: theirDeeds, selectedSet: state.tradeTheirDeeds, cashValue: state.tradeTheirCash, cashMax: other.cash, inputId: "trade-their-cash", cashLabel: "CASH TO REQUEST", emptyText: "NO DEEDS TO REQUEST" });
  return `
    <div class="trade-body">
      <div class="trade-head">
        <div class="section-title" style="margin-bottom:0">
          ${spriteHTML("diamond", 3)}
          <h2 class="t-section g300" id="trade-card-title">${adjustment ? "Adjust Trade" : negotiating ? "Negotiate Trade" : "Propose Trade"}</h2>
        </div>
        ${closeButtonHTML({ id: "trade-close", label: "Close trade dialog" })}
      </div>
      ${negotiating ? `<div class="trade-fixed-recipient"><span class="t-micro g400">${adjustment ? "ADJUSTING FOR" : "NEGOTIATING WITH"}</span><span class="t-label f12 g100">${esc(other.name)}</span></div>` : recipientOptions.length > 1 ? dropdownHTML({ id: "trade-recipient", label: "Send trade to", value: state.tradeWith, className: "trade-recipient-dropdown", options: recipientOptions }) : ""}

      <div class="trade-cols">
        ${mySide}

        ${theirSide}
      </div>

      <div class="trade-summary">
        <span class="t-micro ink-3">YOU SEND</span>
        <span class="t-label f12 g300" id="trade-send-summary">${tradeSummaryText(state.tradeMyDeeds, state.tradeMyCash)}</span>
        <span class="trade-arrow">⇄</span>
        <span class="t-micro ink-3">YOU RECEIVE</span>
        <span class="t-label f12 green" id="trade-receive-summary">${tradeSummaryText(state.tradeTheirDeeds, state.tradeTheirCash)}</span>
      </div>

      <div class="trade-actions">
        <button class="btn-dark trade-cancel" id="trade-cancel"><span class="t-label f12">Cancel</span></button>
        <button class="cta-red trade-send" id="trade-send"><span class="cta-text cta-text-sm">${adjustment ? "Send Adjustment" : negotiating ? "Send Counter" : "Send Trade"}</span></button>
      </div>
    </div>`;
}

function resetTradeSelection(playerId, initialDeedIndex = null) {
  state.tradeWith = playerId;
  state.tradeCounterId = null;
  state.tradeAdjustId = null;
  state.tradeMyDeeds = new Set();
  state.tradeTheirDeeds = new Set();
  state.tradeMyCash = 0;
  state.tradeTheirCash = 0;
  if (initialDeedIndex != null && Number.isInteger(Number(initialDeedIndex)) && state.owners[initialDeedIndex] === "p1") {
    state.tradeMyDeeds.add(Number(initialDeedIndex));
  }
}

function tradeRecipientValid(value) {
  return state.players.some((p) => p.id === value && p.id !== "p1");
}

function onTradeRecipientSelect(id, value) {
  if (id !== "trade-recipient") return;
  if (!tradeRecipientValid(value)) return;
  resetTradeSelection(value, tradeInitialDeedIndex);
  renderTradeModal();
  $("#trade-recipient-trigger")?.focus({ preventScroll: true });
}

function tradeCashInput(player, key) {
  return (e) => {
    let v = Math.round(Number(e.target.value) || 0);
    v = clamp(v, 0, player.cash);
    if (String(v) !== e.target.value) e.target.value = String(v);
    const slider = document.getElementById(`${e.target.id}-range`);
    if (slider) {
      slider.value = String(v);
      paintSlider(slider);
    }
    state[key] = v;
    updateTradeSummary();
  };
}

function toggleTradeDeed(event) {
  const btn = event.currentTarget;
  const set = btn.dataset.side === "me" ? state.tradeMyDeeds : state.tradeTheirDeeds;
  const idx = Number(btn.dataset.deed);
  if (set.has(idx)) set.delete(idx);
  else set.add(idx);
  btn.classList.toggle("is-selected");
  updateTradeSummary();
}

/* The slider drives the number field, which owns clamping and the summary. */
function paintSlider(slider) {
  const max = Number(slider.max) || 0;
  const share = max > 0 ? Math.min(100, Math.max(0, (Number(slider.value) / max) * 100)) : 0;
  slider.style.setProperty("--fill", `${share}%`);
}

function bindCashSlider(inputId) {
  const number = document.getElementById(inputId);
  const slider = document.getElementById(`${inputId}-range`);
  if (!number || !slider) return;
  paintSlider(slider);
  slider.addEventListener("input", () => {
    number.value = slider.value;
    paintSlider(slider);
    number.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function wireTradeModal(me, other) {
  $("#trade-close").addEventListener("click", closeTradeModal);
  $("#trade-cancel").addEventListener("click", closeTradeModal);
  $("#trade-send").addEventListener("click", sendTrade);
  bindDropdowns($("#trade-card"), onTradeRecipientSelect);
  $("#trade-my-cash").addEventListener("input", tradeCashInput(me, "tradeMyCash"));
  $("#trade-their-cash").addEventListener("input", tradeCashInput(other, "tradeTheirCash"));
  for (const id of ["trade-my-cash", "trade-their-cash"]) bindCashSlider(id);
  $("#trade-card").querySelectorAll(".trade-deed").forEach((btn) => btn.addEventListener("click", toggleTradeDeed));
}

export function renderTradeModal() {
  if (!state.tradeWith) return;
  const me = state.players[0];
  const other = state.players.find((p) => p.id === state.tradeWith);
  if (!other) { closeTradeModal(); return; }
  const myDeeds = TILES.filter((t) => state.owners[t.i] === "p1");
  const theirDeeds = TILES.filter((t) => state.owners[t.i] === other.id);
  const otherSeed = state.players.indexOf(other);
  $("#trade-card").innerHTML = tradeModalHTML({ me, other, otherSeed, myDeeds, theirDeeds });
  wireTradeModal(me, other);
}

export function openTradeModal(playerId, trigger = null) {
  if (state.phase !== "playing") return;
  if (!state.settings.trading) {
    host.announceActionStatus("Trading is disabled for this round.", host.captureActionStatusNode(trigger || document.activeElement));
    return;
  }
  const other = state.players.find((p) => p.id === playerId);
  if (!other) return;
  tradeInitialDeedIndex = null;
  resetTradeSelection(playerId);
  renderTradeModal();
  openSurface("#trade-modal", "#trade-close", { trigger });
}

export function beginTradeFromDeed(tileIndex) {
  const recipient = state.players.find(player => player.id !== "p1");
  const index = Number(tileIndex);
  if (!recipient || !Number.isInteger(index) || state.owners[index] !== "p1") return false;
  const tile = TILES[index];
  const authority = state.serverTiles.find(entry => Number(entry.index) === index)?.propertyActions?.tradeDeed;
  if (!tile || tradeBuildingBlockReason(tile) || authority?.enabled === false) return false;
  tradeInitialDeedIndex = index;
  resetTradeSelection(recipient.id, index);
  return recipient;
}

export function openTradeModalForDeed(tileIndex, trigger = null) {
  if (state.phase !== "playing") return;
  if (!state.settings.trading) {
    host.announceActionStatus("Trading is disabled for this round.", host.captureActionStatusNode(trigger || document.activeElement));
    return;
  }
  const recipient = beginTradeFromDeed(tileIndex);
  if (!recipient) return;
  renderTradeModal();
  openSurface("#trade-modal", "#trade-close", { trigger });
}

export function closeTradeModal() {
  state.tradeWith = null;
  state.tradeCounterId = null;
  state.tradeAdjustId = null;
  tradeInitialDeedIndex = null;
  closeSurface("#trade-modal");
}

function blockTrade(message, control = document.activeElement) {
  host.announceActionStatus(message, host.captureActionStatusNode(control));
}

function tradeIsBlank(myCash, theirCash) {
  if (state.tradeMyDeeds.size > 0) return false;
  if (state.tradeTheirDeeds.size > 0) return false;
  if (myCash > 0) return false;
  return theirCash === 0;
}

function tradeMyDeedBlocked(i) {
  const tile = TILES[i];
  const buildingReason = tile && tradeBuildingBlockReason(tile);
  if (buildingReason) {
    blockTrade(buildingReason);
    return true;
  }
  const authority = state.serverTiles.find(entry => Number(entry.index) === Number(i))?.propertyActions?.tradeDeed;
  if (authority?.enabled === false) {
    blockTrade(authority.reason || "This deed cannot be traded right now.");
    return true;
  }
  return false;
}

function tradeTheirDeedBlocked(i) {
  const tile = TILES[i];
  const reason = tile && tradeBuildingBlockReason(tile);
  if (!reason) return false;
  blockTrade(reason);
  return true;
}

function myDeedsValidationBlocked() {
  for (const i of state.tradeMyDeeds) {
    if (tradeMyDeedBlocked(i)) return true;
  }
  return false;
}

function theirDeedsValidationBlocked() {
  for (const i of state.tradeTheirDeeds) {
    if (tradeTheirDeedBlocked(i)) return true;
  }
  return false;
}

function tradeValidationBlocked() {
  if (myDeedsValidationBlocked()) return true;
  return theirDeedsValidationBlocked();
}

function tradeRejected(response) {
  return response?.success === false;
}

function tradeIndexes(trade, key) {
  return trade[key] || [];
}

function tradeCashOf(trade, key) {
  return Number(trade[key] || 0);
}

function tradeCounterpart(trade, sender) {
  const serverId = sender ? trade.toPlayerId : trade.fromPlayerId;
  return state.players.find(player => player.serverId === serverId);
}

function applyNegotiatedTrade(trade, sender, other) {
  state.tradeWith = other.id;
  state.tradeCounterId = sender ? null : trade.id;
  state.tradeAdjustId = sender ? trade.id : null;
  state.tradeMyDeeds = new Set(sender ? tradeIndexes(trade, "givePropertyIndexes") : tradeIndexes(trade, "requestPropertyIndexes"));
  state.tradeTheirDeeds = new Set(sender ? tradeIndexes(trade, "requestPropertyIndexes") : tradeIndexes(trade, "givePropertyIndexes"));
  state.tradeMyCash = sender ? tradeCashOf(trade, "giveCash") : tradeCashOf(trade, "requestCash");
  state.tradeTheirCash = sender ? tradeCashOf(trade, "requestCash") : tradeCashOf(trade, "giveCash");
}

function tradeEventName() {
  if (state.tradeCounterId) return "counter-trade";
  if (state.tradeAdjustId) return "adjust-trade";
  return "propose-trade";
}

function emitTradeOffer(other, myCash, theirCash, statusNode) {
  const tradeId = state.tradeCounterId || state.tradeAdjustId;
  const giveDeeds = [...state.tradeMyDeeds];
  const wantDeeds = [...state.tradeTheirDeeds];
  host.emitServer(tradeEventName(), {
    ...(tradeId ? { tradeId } : {}),
    requestId: host.createRequestId("trade"),
    toPlayerId: other.serverId || other.id,
    givePropertyIndexes: giveDeeds,
    requestPropertyIndexes: wantDeeds,
    giveCash: myCash,
    requestCash: theirCash,
  }, (response) => {
    if (tradeRejected(response)) {
      host.announceActionStatus(response.error || "Trade could not be sent.", statusNode);
      return;
    }
    state.tradeCounterId = null;
    closeTradeModal();
  });
}

export function openTradeNegotiation(trade, trigger = null) {
  if (!trade) return;
  state.offers = (state.offers || []).filter(offer => offer.id !== trade.id);
  const sender = trade.fromPlayerId === financingMyServerId();
  const other = tradeCounterpart(trade, sender);
  if (!other) return;
  applyNegotiatedTrade(trade, sender, other);
  renderTradeModal();
  openSurface("#trade-modal", "#trade-close", { trigger });
}

function sendTrade(event) {
  if (!state.tradeWith) return;
  const me = state.players[0];
  const other = state.players.find((p) => p.id === state.tradeWith);
  if (!other) return;
  const statusNode = host.captureActionStatusNode(event?.currentTarget || document.activeElement);
  const myCash = clamp(state.tradeMyCash, 0, me.cash);
  const theirCash = clamp(state.tradeTheirCash, 0, other.cash);
  if (tradeIsBlank(myCash, theirCash)) {
    host.announceActionStatus("Add at least one deed or cash amount before sending a trade.", statusNode);
    return;
  }
  if (tradeValidationBlocked()) return;
  emitTradeOffer(other, myCash, theirCash, statusNode);
}
