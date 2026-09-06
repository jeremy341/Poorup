/* ============================================================
   TRADE & FINANCING: the deal builder (loan/equity/hybrid financing
   modal), the trade proposer modal, and the shared parlor dropdown
   widget they both use. Templates are the exact old main.js markup;
   game-bound calls (emitServer, say, renderChat, record) arrive via
   configureTradeUi hooks.
   ============================================================ */
import { $, esc, clamp } from "./clientDom.js";
import { state } from "./clientState.js";
import { TILES, GROUP_COLOR, RENT_TABLE } from "./clientBoardData.js";
import { spriteHTML, avatarHTML } from "./clientSprites.js";
import { renderRightRail } from "./clientRailRender.js";
import { openSurface, closeSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";

let host = { emitServer: noop, say: noop, renderChat: noop, record: noop, createRequestId: noop, renderRightRail: noop };

function noop() {}

export function configureTradeUi(hooks) {
  host = { ...host, ...hooks };
}

let financingPreviewMode = "loan";
let financingSurfaceMode = "offer";
const financingPreviewDraft = {
  recipientId: null,
  collateralTileIndex: null,
  propertyIndex: 21,
  amount: 150,
  loanRate: 20,
  loanDuration: 20,
  loanSchedule: "checkpoints",
  equityShare: 10,
  equityDuration: "permanent",
  equityControl: "passive",
  hybridRate: 10,
  hybridDuration: 20,
  hybridConversion: 25,
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
    options[index]?.focus({ preventScroll: true });
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    document.activeElement?.click();
  }
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
      trigger.setAttribute("aria-expanded", "true");
      menu.querySelector("[aria-selected=true]")?.focus({ preventScroll: true });
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
  return TILES.filter((tile) => tile.kind === "property" && state.owners[tile.i] === recipientId);
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
  const index = financingPreviewDraft.collateralTileIndex;
  if (index == null) return;
  const stillHeld = financingRecipientDeeds().some((tile) => tile.i === Number(index));
  if (!stillHeld) financingPreviewDraft.collateralTileIndex = null;
}

function onFinancingRecipientSet(value) {
  if (!financingRecipientValid(value)) return;
  financingPreviewDraft.recipientId = value;
  clampPropertyToRecipient();
  clampCollateralToRecipient();
  renderFinancingModal();
  $("#finance-recipient-trigger")?.focus({ preventScroll: true });
}

function onFinancingCollateralSet(value) {
  if (value === "" || value == null) {
    financingPreviewDraft.collateralTileIndex = null;
    return;
  }
  const index = Number(value);
  const held = financingRecipientDeeds().some((tile) => tile.i === index);
  if (!held) return;
  financingPreviewDraft.collateralTileIndex = index;
}

function financingCollateralOptions() {
  const none = [{ value: "", label: "NO COLLATERAL" }];
  const deeds = financingRecipientDeeds().map((tile) => ({ value: tile.i, label: financingEquityContextLabel(tile) }));
  return [...none, ...deeds];
}

function financingEligiblePropertyIndex() {
  const index = Number(financingPreviewDraft.propertyIndex);
  const held = financingRecipientDeeds().some((tile) => tile.i === index);
  return held ? index : null;
}

function financingEligibleCollateralIndex() {
  const index = financingPreviewDraft.collateralTileIndex;
  if (index == null) return null;
  const held = financingRecipientDeeds().some((tile) => tile.i === Number(index));
  return held ? Number(index) : null;
}

function financingAmountValid() {
  const amount = Math.floor(Number(financingPreviewDraft.amount) || 0);
  if (amount < 1) return false;
  const me = state.players[0];
  return (me?.cash || 0) >= amount;
}

function financingPropertyRequired() {
  return financingPreviewMode !== "loan";
}

function financingPropertyMissing() {
  if (!financingPropertyRequired()) return false;
  return !financingHasEligibleProperty();
}

function financingSendBlocked() {
  if (!recipientPlayer()) return "Choose a player to deal with.";
  if (!financingAmountValid()) return "Enter an amount you can fund.";
  if (financingPropertyMissing()) return "The counterparty owns no eligible deeds.";
  return null;
}

function financingLoanTerms() {
  return {
    premiumRate: Math.max(0, Math.min(100, Number(financingPreviewDraft.loanRate) || 0)),
    durationRounds: Math.max(1, Math.min(20, Number(financingPreviewDraft.loanDuration) || 20)),
    propertyIndex: financingEligiblePropertyIndex(),
    collateralTileIndex: financingEligibleCollateralIndex(),
  };
}

function financingEquityDurationRounds() {
  if (financingPreviewDraft.equityDuration === "permanent") return 20;
  return Math.max(1, Math.min(20, Number(financingPreviewDraft.equityDuration) || 20));
}

function financingEquityTerms() {
  return {
    premiumRate: 0,
    durationRounds: financingEquityDurationRounds(),
    propertyIndex: financingEligiblePropertyIndex(),
    collateralTileIndex: null,
    equityShare: Math.max(5, Math.min(100, Number(financingPreviewDraft.equityShare) || 10)),
    equityControl: financingPreviewDraft.equityControl,
    permanent: financingPreviewDraft.equityDuration === "permanent",
  };
}

function financingHybridTerms() {
  return {
    premiumRate: Math.max(0, Math.min(100, Number(financingPreviewDraft.hybridRate) || 0)),
    durationRounds: Math.max(1, Math.min(20, Number(financingPreviewDraft.hybridDuration) || 20)),
    propertyIndex: financingEligiblePropertyIndex(),
    collateralTileIndex: null,
    conversionShare: Math.max(5, Math.min(100, Number(financingPreviewDraft.hybridConversion) || 25)),
  };
}

const FINANCING_SEND_TERMS = {
  loan: financingLoanTerms,
  equity: financingEquityTerms,
  hybrid: financingHybridTerms,
};

function financingSendPayload(recipient) {
  const base = {
    toPlayerId: recipient.serverId || recipient.id,
    kind: financingPreviewMode,
    amount: Math.floor(Number(financingPreviewDraft.amount) || 0),
    requestId: host.createRequestId("contract-proposal"),
  };
  const terms = (FINANCING_SEND_TERMS[financingPreviewMode] || financingLoanTerms)();
  return { ...base, ...terms };
}

function sendFinancingContract() {
  const error = financingSendBlocked();
  if (error) {
    host.say(error);
    host.renderChat();
    return;
  }
  const recipient = recipientPlayer();
  host.emitServer("propose-player-contract", financingSendPayload(recipient), (response) => {
    if (response?.success === false) {
      host.say(response.error || "The player contract could not be sent.");
      host.renderChat();
      return;
    }
    host.record(`CONTRACT SENT TO ${recipient.name}`);
    host.say(`Contract sent to ${recipient.name} for review.`);
    host.renderChat();
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
  const tile = TILES[Number(financingPreviewDraft.propertyIndex)];
  if (tile && tile.kind === "property") return tile;
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

function financingPreviewBase() {
  const tile = financingPreviewTile();
  const requested = Number(financingPreviewDraft.amount) || 0;
  const cap = Number(tile.price) || 1;
  const amount = Math.max(1, Math.min(requested, cap));
  const rent = baseRentOf(tile);
  return { tile, amount, rent };
}

function previewEquityDuration() {
  if (financingPreviewDraft.equityDuration === "permanent") return "FOREVER";
  return `${financingPreviewDraft.equityDuration} TURNS`;
}

function equityPreviewCopy(tile, amount, rent) {
  const share = Math.max(5, Math.min(100, Number(financingPreviewDraft.equityShare) || 10));
  const lenderRent = Math.floor((rent * share) / 100);
  const duration = previewEquityDuration();
  const control = String(financingPreviewDraft.equityControl || "passive").toUpperCase();
  return {
    title: `${share}% OF ${tile.name}`,
    metrics: [
      ["CONTRIBUTION", `$${amount}`],
      ["RENT SHARE", `${share}%`],
      ["BASE RENT", `$${lenderRent} OF $${rent}`],
      ["DURATION", duration],
    ],
    copy: `${share}% economic share in ${tile.name}. The investor receives ${share}% of collected rent and sale proceeds. Control: ${control}.`,
    note: share === 100 ? "100% becomes a direct transfer or buyout. No hidden loan remains." : "Passive equity does not block building. Shared control requires the group consent rules.",
  };
}

function hybridPreviewCopy(tile, amount) {
  const rate = Math.max(0, Math.min(100, Number(financingPreviewDraft.hybridRate) || 0));
  const duration = Number(financingPreviewDraft.hybridDuration) || 20;
  const conversion = Math.max(5, Math.min(100, Number(financingPreviewDraft.hybridConversion) || 25));
  const maturity = amount + Math.round((amount * rate) / 100);
  return {
    title: `CONVERTIBLE NOTE · ${tile.name}`,
    metrics: [
      ["ADVANCE", `$${amount}`],
      ["PREMIUM", `${rate}%`],
      ["MATURITY", `$${maturity}`],
      ["CONVERSION", `${conversion}%`],
    ],
    copy: `$${amount} at a ${rate}% premium for ${duration} turns. If the note defaults after its cure turn, the lender may convert the outstanding balance into ${conversion}% of ${tile.name}.`,
    note: "Repayment and conversion are mutually exclusive. Interest stops when conversion happens.",
  };
}

function loanPreviewCopy(tile, amount) {
  const rate = Math.max(0, Math.min(100, Number(financingPreviewDraft.loanRate) || 0));
  const duration = Number(financingPreviewDraft.loanDuration) || 20;
  const premium = Math.round((amount * rate) / 100);
  const total = amount + premium;
  const schedule = financingPreviewDraft.loanSchedule === "upfront" ? "UPFRONT" : financingPreviewDraft.loanSchedule === "maturity" ? "MATURITY" : "CHECKPOINTS";
  return {
    title: `SECURED LOAN · ${tile.name}`,
    metrics: [
      ["ADVANCE", `$${amount}`],
      ["PREMIUM", `${rate}%`],
      ["TOTAL DUE", `$${total}`],
      ["TERM", `${duration} TURNS`],
    ],
    copy: `$${amount} advanced at a ${rate}% total premium for ${duration} turns. Repayment: ${schedule.toLowerCase()}. The named deed is collateral after the cure turn.`,
    note: "The lender receives a fixed return. No rent or ownership share is attached to this mode.",
  };
}

const FINANCE_PREVIEW_BUILDERS = {
  equity: equityPreviewCopy,
  hybrid: hybridPreviewCopy,
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
  const preview = financingPreviewCopy();
  return `<div class="financing-preview-head"><span class="t-micro g400">${esc(financingPreviewKicker())}</span><span class="t-label f12 g100">${esc(preview.title)}</span></div>
    <div class="financing-metrics">${preview.metrics.map(([label, value]) => `<div><span class="t-micro ink-3">${label}</span><strong class="t-label f13 g100">${esc(value)}</strong></div>`).join("")}</div>
    <p class="t-body ink-2 financing-preview-copy">${esc(preview.copy)}</p>
    <p class="t-micro ink-3 financing-preview-note">${esc(preview.note)}</p>`;
}

function financingModeFieldsHTML() {
  if (financingPreviewMode === "equity") {
    const permanent = financingPreviewDraft.equityDuration === "permanent";
    const equityTurns = permanent ? 20 : Math.max(1, Number(financingPreviewDraft.equityDuration) || 20);
    return `<div class="financing-field"><label class="t-label f11 g-muted" for="finance-equity-share">Economic share <output id="finance-equity-share-output">${financingPreviewDraft.equityShare}%</output></label><div class="financing-range"><input id="finance-equity-share" type="range" min="5" max="100" step="5" value="${financingPreviewDraft.equityShare}" /></div></div>
      <div class="financing-field-grid"><label class="financing-field"><span class="t-label f11 g-muted">Duration in turns</span><div class="financing-number"><input class="field" id="finance-equity-duration" type="number" min="1" max="100" step="1" value="${equityTurns}" ${permanent ? "disabled" : ""} /><span aria-hidden="true">TURNS</span></div></label>${dropdownHTML({ id: "finance-equity-control", label: "Control", value: financingPreviewDraft.equityControl, options: [{ value: "passive", label: "PASSIVE" }, { value: "shared", label: "SHARED" }, { value: "controlling", label: "CONTROLLING" }] })}</div><label class="financing-check"><input id="finance-equity-permanent" type="checkbox" ${permanent ? "checked" : ""} /><span class="t-label f11 g-muted">PERMANENT EQUITY</span></label>`;
  }
  if (financingPreviewMode === "hybrid") {
    return `<div class="financing-field-grid"><label class="financing-field"><span class="t-label f11 g-muted">Premium %</span><input class="field" id="finance-hybrid-rate" type="number" min="0" max="100" step="1" value="${financingPreviewDraft.hybridRate}" /></label><label class="financing-field"><span class="t-label f11 g-muted">Duration in turns</span><div class="financing-number"><input class="field" id="finance-hybrid-duration" type="number" min="1" max="100" step="1" value="${financingPreviewDraft.hybridDuration}" /><span aria-hidden="true">TURNS</span></div></label></div><div class="financing-field"><label class="t-label f11 g-muted" for="finance-hybrid-conversion">Default conversion share <output id="finance-hybrid-conversion-output">${financingPreviewDraft.hybridConversion}%</output></label><div class="financing-range"><input id="finance-hybrid-conversion" type="range" min="5" max="100" step="5" value="${financingPreviewDraft.hybridConversion}" /></div></div>`;
  }
  return `<div class="financing-field-grid"><label class="financing-field"><span class="t-label f11 g-muted">Total premium %</span><input class="field" id="finance-loan-rate" type="number" min="0" max="100" step="1" value="${financingPreviewDraft.loanRate}" /></label><label class="financing-field"><span class="t-label f11 g-muted">Duration in turns</span><div class="financing-number"><input class="field" id="finance-loan-duration" type="number" min="1" max="100" step="1" value="${financingPreviewDraft.loanDuration}" /><span aria-hidden="true">TURNS</span></div></label></div>${dropdownHTML({ id: "finance-loan-schedule", label: "Repayment schedule", value: financingPreviewDraft.loanSchedule, options: [{ value: "upfront", label: "UPFRONT" }, { value: "checkpoints", label: "CHECKPOINTS" }, { value: "maturity", label: "MATURITY" }] })}${dropdownHTML({ id: "finance-collateral", label: "Collateral (borrower deed, optional)", value: financingPreviewDraft.collateralTileIndex ?? "", options: financingCollateralOptions() })}`;
}

function financingSurfaceTabsHTML() {
  const tabs = [
    ["offer", "OFFER"],
    ["contract", "CONTRACT"],
    ["ownership", "CO-OWNERSHIP"],
    ["default", "DEFAULT"],
  ];
  return `<div class="financing-surface-tabs" id="financing-surface-tabs" role="tablist" aria-label="Financing surfaces">${tabs.map(([value, label]) => `<button class="financing-surface-tab${financingSurfaceMode === value ? " is-active" : ""}" type="button" role="tab" aria-selected="${financingSurfaceMode === value}" data-financing-surface="${value}"><span class="t-label f11">${label}</span></button>`).join("")}</div>`;
}

function financingSurfaceBodyHTML() {
  if (financingSurfaceMode === "contract") {
    return `<section class="financing-surface-body" aria-labelledby="financing-contract-heading"><div class="financing-surface-kicker"><span class="t-micro g400">CONTRACT REFERENCE · LIVE TERMS</span><span class="t-label f11 green">ACTIVE · 12 TURNS LEFT</span></div><h3 class="t-section g100" id="financing-contract-heading">Secured loan · Eindhoven</h3><div class="financing-contract-grid"><div><span class="t-micro ink-3">BORROWER</span><strong class="t-label f13 g100">PLAYER</strong></div><div><span class="t-micro ink-3">LENDER</span><strong class="t-label f13 g100">PARTNER</strong></div><div><span class="t-micro ink-3">ADVANCE</span><strong class="t-label f13 g100">$150</strong></div><div><span class="t-micro ink-3">MATURITY</span><strong class="t-label f13 g100">$180</strong></div></div><div class="financing-checkpoints" aria-label="Repayment checkpoints"><span class="is-paid">TURN 5 · PAID</span><span class="is-paid">TURN 10 · PAID</span><span>TURN 15 · $38</span><span>TURN 20 · $105</span></div><p class="t-body ink-2 financing-surface-copy">The borrower keeps the deed while payments are current. The lender receives the agreed premium and the named deed remains collateral after the cure turn.</p><div class="financing-surface-actions"><button class="btn-dark" type="button" data-finance-surface="offer"><span class="t-label f11">OPEN OFFER</span></button><button class="btn-dark" type="button" disabled><span class="t-label f11">BUYOUT · FINANCE RAIL</span></button></div></section>`;
  }
  if (financingSurfaceMode === "ownership") {
    return `<section class="financing-surface-body" aria-labelledby="financing-ownership-heading"><div class="financing-surface-kicker"><span class="t-micro g400">CAP TABLE REFERENCE · LIVE TERMS</span><span class="t-label f11 g300">PASSIVE CONTROL</span></div><h3 class="t-section g100" id="financing-ownership-heading">Eindhoven · shared economics</h3><div class="financing-ownership-bar"><span class="financing-ownership-primary" style="width:70%"></span><span class="financing-ownership-secondary" style="width:30%"></span></div><div class="financing-owner-list"><div><span class="ownership-avatar ownership-avatar-primary"></span><span class="t-label f12 g100">PLAYER · 70%</span><span class="t-micro ink-3">CONTROL + RENT</span></div><div><span class="ownership-avatar ownership-avatar-secondary"></span><span class="t-label f12 g100">PARTNER · 30%</span><span class="t-micro ink-3">RENT + SALE SHARE</span></div></div><div class="financing-rights-grid"><div><span class="t-micro ink-3">BASE RENT $18</span><strong class="t-label f13 g100">$13 / $5</strong></div><div><span class="t-micro ink-3">BUILDING RIGHTS</span><strong class="t-label f13 green">OWNER CONTROL</strong></div><div><span class="t-micro ink-3">SALE PROCEEDS</span><strong class="t-label f13 g100">70% / 30%</strong></div><div><span class="t-micro ink-3">DURATION</span><strong class="t-label f13 g100">FOREVER</strong></div></div><p class="t-body ink-2 financing-surface-copy">A passive minority share does not block a complete street. Shared control is an explicit contract choice, not an accidental side effect of buying equity.</p><div class="financing-surface-actions"><button class="btn-dark" type="button" data-financing-surface="offer"><span class="t-label f11">OPEN OFFER</span></button><button class="btn-dark" type="button" disabled><span class="t-label f11">TRANSFER · FINANCE RAIL</span></button></div></section>`;
  }
  if (financingSurfaceMode === "default") {
    return `<section class="financing-surface-body" aria-labelledby="financing-default-heading"><div class="financing-surface-kicker"><span class="t-micro red">CURE WINDOW · LIVE REFERENCE</span><span class="t-label f11 red">1 TURN LEFT</span></div><h3 class="t-section g100" id="financing-default-heading">Payment due · Eindhoven</h3><div class="financing-default-amount"><span class="t-micro ink-3">OUTSTANDING BALANCE</span><strong class="t-money red">$105</strong></div><div class="financing-default-actions"><button class="btn-dark" type="button" disabled><span class="t-label f11">PAY OUTSTANDING BALANCE</span></button><button class="btn-dark" type="button" disabled><span class="t-label f11">TAKE COLLATERAL</span></button><button class="btn-dark" type="button" disabled><span class="t-label f11">BANK AUCTION</span></button></div><p class="t-body ink-2 financing-surface-copy">If the cure turn expires, the lender chooses collateral transfer or bank auction. Interest stops when the contract resolves.</p></section>`;
  }
  return `<section class="financing-surface-body" aria-labelledby="financing-offer-heading"><div class="financing-mode-tabs" id="financing-mode-tabs" role="tablist" aria-label="Financing mode"><button class="financing-mode-tab${financingPreviewMode === "loan" ? " is-active" : ""}" type="button" role="tab" aria-selected="${financingPreviewMode === "loan"}" data-financing-mode="loan"><span class="t-label f11">LOAN</span><span class="t-micro">FIXED RETURN</span></button><button class="financing-mode-tab${financingPreviewMode === "equity" ? " is-active" : ""}" type="button" role="tab" aria-selected="${financingPreviewMode === "equity"}" data-financing-mode="equity"><span class="t-label f11">EQUITY</span><span class="t-micro">RENT + SALE SHARE</span></button><button class="financing-mode-tab${financingPreviewMode === "hybrid" ? " is-active" : ""}" type="button" role="tab" aria-selected="${financingPreviewMode === "hybrid"}" data-financing-mode="hybrid"><span class="t-label f11">HYBRID</span><span class="t-micro">CONVERT ON DEFAULT</span></button></div><h3 class="sr-only" id="financing-offer-heading">Financing offer builder</h3><div class="financing-form">${dropdownHTML({ id: "finance-recipient", label: "Counterparty", value: financingRecipientId(), options: financingRecipients() })}${financingNoDeedsHintHTML()}${dropdownHTML({ id: "finance-property", label: "Property (their deed)", value: financingPreviewDraft.propertyIndex, options: financingPropertyOptions() })}<label class="financing-field"><span class="t-label f11 g-muted">Cash advanced / contributed</span><input class="field" id="finance-amount" type="number" min="1" step="1" value="${financingPreviewDraft.amount}" /></label><div id="financing-mode-fields">${financingModeFieldsHTML()}</div></div><section class="financing-preview" id="financing-preview" aria-live="polite">${financingPreviewHTML()}</section><div class="financing-actions"><button class="cta-red${financingHasEligibleProperty() ? "" : " financing-disabled-action"}" id="financing-send" type="button" ${financingHasEligibleProperty() ? "" : "disabled"}><span class="cta-text cta-text-sm">SEND CONTRACT</span></button><button class="btn-dark" id="financing-live-rail" type="button"><span class="t-label f11">OPEN LIVE FINANCE</span></button></div></section>`;
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
}

const FINANCE_INPUT_FIELDS = {
  "finance-amount": (value) => { financingPreviewDraft.amount = Number(value) || 0; },
  "finance-loan-rate": (value) => { financingPreviewDraft.loanRate = Number(value) || 0; },
  "finance-loan-duration": (value) => { financingPreviewDraft.loanDuration = Number(value) || 20; },
  "finance-equity-duration": (value) => { financingPreviewDraft.equityDuration = value; },
  "finance-hybrid-rate": (value) => { financingPreviewDraft.hybridRate = Number(value) || 0; },
  "finance-hybrid-duration": (value) => { financingPreviewDraft.hybridDuration = Number(value) || 20; },
};

const FINANCE_RANGE_OUTPUTS = {
  "finance-equity-share": { key: "equityShare", fallback: 10, outputId: "#finance-equity-share-output" },
  "finance-hybrid-conversion": { key: "hybridConversion", fallback: 25, outputId: "#finance-hybrid-conversion-output" },
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
  applyFinanceRangeField(id, value);
  if (event.target.matches("input[type=range]")) syncFinancingRanges(card);
  refreshFinancingPreview();
}

function openFinancingLiveRail() {
  closeFinancingModal();
  state.tab = "finance";
  renderRightRail();
}

function onFinancingSurfaceTab(event) {
  const button = event.target.closest("[data-financing-surface]");
  if (!button) return;
  financingSurfaceMode = button.dataset.financingSurface;
  renderFinancingModal();
}

function onFinancingSurfaceClick(event) {
  const button = event.target.closest("[data-financing-surface]");
  if (!button) return;
  if (event.target.closest("#financing-surface-tabs")) return;
  financingSurfaceMode = button.dataset.financingSurface;
  renderFinancingModal();
}

function onFinancingModeTab(event) {
  const button = event.target.closest("[data-financing-mode]");
  if (!button) return;
  financingPreviewMode = button.dataset.financingMode;
  renderFinancingModal();
}

function onFinancingDropdownSelect(id, value) {
  if (id === "finance-recipient") {
    onFinancingRecipientSet(value);
    return;
  }
  if (id === "finance-property") financingPreviewDraft.propertyIndex = Number(value);
  if (id === "finance-loan-schedule") financingPreviewDraft.loanSchedule = value;
  if (id === "finance-equity-control") financingPreviewDraft.equityControl = value;
  if (id === "finance-collateral") onFinancingCollateralSet(value);
  refreshFinancingPreview();
}

function onFinancingPermanentChange(event) {
  const turnsInput = $("#finance-equity-duration");
  financingPreviewDraft.equityDuration = event.target.checked ? "permanent" : Math.max(1, Number(turnsInput?.value) || 20);
  renderFinancingModal();
}

function bindFinancingOfferSurface(card) {
  $("#financing-mode-tabs")?.addEventListener("click", onFinancingModeTab);
  if (!card.dataset.financingInputBound) {
    card.addEventListener("input", (event) => onFinancingInput(card, event));
    card.dataset.financingInputBound = "true";
  }
  bindDropdowns(card, onFinancingDropdownSelect);
}

function wireFinancingChrome() {
  $("#financing-close")?.addEventListener("click", closeFinancingModal);
  $("#financing-send")?.addEventListener("click", sendFinancingContract);
  $("#financing-live-rail")?.addEventListener("click", openFinancingLiveRail);
  $("#financing-surface-tabs")?.addEventListener("click", onFinancingSurfaceTab);
  $("#finance-equity-permanent")?.addEventListener("change", onFinancingPermanentChange);
}

function renderFinancingModal() {
  const card = $("#financing-card");
  if (!card) return;
  const modeLabels = { loan: "LOAN", equity: "EQUITY", hybrid: "HYBRID" };
  const header = `<div class="financing-head"><div><div class="t-micro g400">PARLOR DEAL BUILDER · LIVE TERMS</div><h2 class="t-section g100" id="financing-card-title">Shape a ${modeLabels[financingPreviewMode]} deal</h2></div><span class="t-micro financing-badge">LIVE FINANCE RAIL</span><button class="btn-dark financing-close" id="financing-close" type="button"><span class="t-label f11">CLOSE</span></button></div><p class="t-body ink-2 financing-description" id="financing-card-description">Pick a counterparty, shape the terms, and send. Every accepted term settles through the server ledger.</p>`;
  card.innerHTML = `<div class="financing-body">${header}${financingSurfaceTabsHTML()}${financingSurfaceBodyHTML()}</div>`;
  syncFinancingRanges(card);
  wireFinancingChrome();
  if (!card.dataset.financingSurfaceBound) {
    card.addEventListener("click", onFinancingSurfaceClick);
    card.dataset.financingSurfaceBound = "true";
  }
  if (financingSurfaceMode === "offer") bindFinancingOfferSurface(card);
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

export function openFinancingModal(mode = "loan", propertyIndex = null, trigger = null, surface = "offer") {
  financingPreviewMode = ["loan", "equity", "hybrid"].includes(mode) ? mode : "loan";
  financingSurfaceMode = ["offer", "contract", "ownership", "default"].includes(surface) ? surface : "offer";
  ensureFinancingDraft(propertyIndex);
  renderFinancingModal();
  openSurface("#financing-modal", "#financing-close");
  if (financingSurfaceMode === "offer") $("#finance-recipient-trigger")?.focus({ preventScroll: true });
  if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
}

export function closeFinancingModal() {
  closeSurface("#financing-modal");
}

function tradeDeedRowHTML(tile, side, selected) {
  const rail = tile.group ? GROUP_COLOR[tile.group] : tile.kind === "railroad" ? "#5c5033" : "#3e7d7b";
  const mortgaged = !!state.mortgaged[tile.i];
  return `<button type="button" class="trade-deed${selected ? " is-selected" : ""}${mortgaged ? " is-mortgaged" : ""}" data-side="${side}" data-deed="${tile.i}" ${mortgaged ? "disabled" : ""}>
    <span class="trade-deed-rail" style="background:${rail}"></span>
    <span class="trade-deed-name">${tile.name}</span>
    <span class="trade-deed-price">$${tile.price}</span>
    <span class="trade-deed-check"></span>
  </button>`;
}

function tradeSummaryText(deedSet, cash) {
  return `${deedSet.size} deed${deedSet.size === 1 ? "" : "s"} + $${cash}`;
}

function updateTradeSummary() {
  const sendEl = $("#trade-send-summary");
  const receiveEl = $("#trade-receive-summary");
  if (sendEl) sendEl.textContent = tradeSummaryText(state.tradeMyDeeds, state.tradeMyCash);
  if (receiveEl) receiveEl.textContent = tradeSummaryText(state.tradeTheirDeeds, state.tradeTheirCash);
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
              <span class="t-micro ink-3 trade-cash-label">CASH ON HAND $${player.cash.toLocaleString()}</span>
            </div>
          </div>
          <div class="trade-deed-list thin-scroll">
            ${rows}
          </div>
          <label class="trade-cash-field">
            <span class="t-label f11 g-muted">${cashLabel}</span>
            <input type="number" min="0" max="${cashMax}" step="10" class="field" id="${inputId}" value="${cashValue}" />
          </label>
        </div>`;
}

function tradeModalHTML({ me, other, otherSeed, myDeeds, theirDeeds }) {
  const recipientOptions = state.players.filter((p) => p.id !== "p1").map((p) => ({ value: p.id, label: p.name }));
  const mySide = tradeSideHTML({ player: me, seed: 0, side: "me", deeds: myDeeds, selectedSet: state.tradeMyDeeds, cashValue: state.tradeMyCash, cashMax: me.cash, inputId: "trade-my-cash", cashLabel: "CASH TO OFFER", emptyText: "NO DEEDS TO OFFER" });
  const theirSide = tradeSideHTML({ player: other, seed: otherSeed, side: "them", deeds: theirDeeds, selectedSet: state.tradeTheirDeeds, cashValue: state.tradeTheirCash, cashMax: other.cash, inputId: "trade-their-cash", cashLabel: "CASH TO REQUEST", emptyText: "NO DEEDS TO REQUEST" });
  return `
    <div class="trade-body">
      <div class="trade-head">
        <div class="section-title" style="margin-bottom:0">
          ${spriteHTML("diamond", 3)}
          <h2 class="t-section g300" id="trade-card-title">Propose Trade</h2>
        </div>
        <button class="btn-dark" id="trade-close"><span class="t-label f11">CLOSE</span></button>
      </div>
      <p class="t-body ink-2 trade-copy">Select who should receive the offer, then choose deeds from each side and set a cash amount to include.</p>
      ${dropdownHTML({ id: "trade-recipient", label: "Send trade to", value: state.tradeWith, className: "trade-recipient-dropdown", options: recipientOptions })}

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
        <button class="cta-red trade-send" id="trade-send"><span class="cta-text cta-text-sm">Send Trade</span></button>
        <button class="btn-dark trade-cancel" id="trade-cancel"><span class="t-label f12">Cancel</span></button>
      </div>
    </div>`;
}

function resetTradeSelection(playerId) {
  state.tradeWith = playerId;
  state.tradeMyDeeds = new Set();
  state.tradeTheirDeeds = new Set();
  state.tradeMyCash = 0;
  state.tradeTheirCash = 0;
}

function tradeRecipientValid(value) {
  return state.players.some((p) => p.id === value && p.id !== "p1");
}

function onTradeRecipientSelect(id, value) {
  if (id !== "trade-recipient") return;
  if (!tradeRecipientValid(value)) return;
  resetTradeSelection(value);
  renderTradeModal();
  $("#trade-recipient-trigger")?.focus({ preventScroll: true });
}

function tradeCashInput(player, key) {
  return (e) => {
    let v = Math.round(Number(e.target.value) || 0);
    v = clamp(v, 0, player.cash);
    if (String(v) !== e.target.value) e.target.value = String(v);
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

function wireTradeModal(me, other) {
  $("#trade-close").addEventListener("click", closeTradeModal);
  $("#trade-cancel").addEventListener("click", closeTradeModal);
  $("#trade-send").addEventListener("click", sendTrade);
  bindDropdowns($("#trade-card"), onTradeRecipientSelect);
  $("#trade-my-cash").addEventListener("input", tradeCashInput(me, "tradeMyCash"));
  $("#trade-their-cash").addEventListener("input", tradeCashInput(other, "tradeTheirCash"));
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

export function openTradeModal(playerId) {
  if (state.phase !== "playing") return;
  if (!state.settings.trading) {
    host.say("Trading is disabled for this round.");
    host.renderChat();
    return;
  }
  const other = state.players.find((p) => p.id === playerId);
  if (!other) return;
  resetTradeSelection(playerId);
  renderTradeModal();
  openSurface("#trade-modal", "#trade-close");
}

export function closeTradeModal() {
  state.tradeWith = null;
  closeSurface("#trade-modal");
}

function blockTrade(message) {
  host.say(message);
  host.renderChat();
}

function tradeIsBlank(myCash, theirCash) {
  if (state.tradeMyDeeds.size > 0) return false;
  if (state.tradeTheirDeeds.size > 0) return false;
  if (myCash > 0) return false;
  return theirCash === 0;
}

function tradeMyDeedBlocked(i) {
  if ((state.houses[i] || 0) > 0) {
    blockTrade("You must sell all houses on a property before trading it.");
    return true;
  }
  if (state.mortgaged[i]) {
    blockTrade("You must unmortgage a property before trading it.");
    return true;
  }
  return false;
}

function tradeTheirDeedBlocked(i) {
  if (state.mortgaged[i]) {
    blockTrade("That property is mortgaged and can't be traded yet.");
    return true;
  }
  return false;
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

function emitTradeOffer(me, other, myCash, theirCash) {
  const giveDeeds = [...state.tradeMyDeeds];
  const wantDeeds = [...state.tradeTheirDeeds];
  host.emitServer("propose-trade", {
    toPlayerId: other.serverId || other.id,
    givePropertyIndexes: giveDeeds,
    requestPropertyIndexes: wantDeeds,
    giveCash: myCash,
    requestCash: theirCash,
  }, (response) => {
    if (tradeRejected(response)) {
      host.say(response.error || "Trade could not be sent.");
      host.renderChat();
      return;
    }
    host.record(`OFFER SENT TO ${other.name}`);
    host.say(`Offer sent to ${other.name}.`, me);
    host.renderChat();
  });
  closeTradeModal();
}

function sendTrade() {
  if (!state.tradeWith) return;
  const me = state.players[0];
  const other = state.players.find((p) => p.id === state.tradeWith);
  if (!other) return;
  const myCash = clamp(state.tradeMyCash, 0, me.cash);
  const theirCash = clamp(state.tradeTheirCash, 0, other.cash);
  if (tradeIsBlank(myCash, theirCash)) {
    blockTrade("Add at least one deed or cash amount before sending a trade.");
    return;
  }
  if (tradeValidationBlocked()) return;
  emitTradeOffer(me, other, myCash, theirCash);
}
