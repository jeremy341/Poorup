// FINANCING: active-contract and deal-view detail rendering.
import { baseRentOf, contractCollateralIndices, contractKindLabel, financingActiveContracts, financingContractDeed, financingContractRedacted, financingCureLine, financingHolderMeta, financingOwnerMeta, financingOwnershipDeed, financingPropertyTile, financingRepayProgress, financingRepayableContract, financingSelectedContract, financingSharedDeeds, financingState, financingTileShares } from "./clientFinancingState.js";
import { collateralCreditSummary, contractLabel, isRentShare, playerFinanceEnabled, rentShareDisclosure } from "./clientFinanceRules.js";
import { esc } from "./clientDom.js";
import { financingTransferComposerHTML } from "./clientFinancingTransfer.js";
import { state } from "./clientState.js";
export function financingContractPickerHTML() {
  const active = financingActiveContracts();
  if (!active.length) return `<p class="t-micro ink-3">NO LIVE CONTRACTS.</p>`;
  return `<div class="financing-surface-actions">` + active.map((contract) => {
    const label = `${contractLabel(contract).toUpperCase()} · ${contract.fromPlayerName || "PLAYER"} → ${contract.toPlayerName || "PLAYER"}`;
    return `<button class="btn-dark" type="button" data-financing-pick="${esc(contract.id)}"><span class="t-label f11">${esc(label)}</span></button>`;
  }).join("") + `</div>`;
}

export function financingContractTitle(contract) {
  const lender = contract.fromPlayerName || "PLAYER";
  const borrower = contract.toPlayerName || "PLAYER";
  if (contract.kind === "loan") {
    const names = contractCollateralIndices(contract).map(index => financingPropertyTile(index)?.name).filter(Boolean);
    const label = names.length ? `Secured loan · ${names.join(", ")}` : "Unsecured loan";
    return `${label} · ${lender} funds ${borrower}`;
  }
  return `${contractKindLabel(contract)} · ${lender} funds ${borrower}`;
}
export function financingContractCopy(contract) {
  if (isRentShare(contract)) return rentShareDisclosure(contract);
  const credit = collateralCreditSummary(contract);
  if (credit) return credit;
  const kind = contract?.kind || contract;
  if (kind === "equity") return "The investor receives the agreed share of collected rent and sale proceeds.";
  if (kind === "hybrid") return "Repay before the cure turn ends. Past cure, the lender converts the agreed share instead of seizing collateral.";
  if (!contractCollateralIndices(contract).length) return "The borrower repays the agreed total interest without pledging a deed as collateral.";
  return "Every pledged deed stays with the borrower while payments are current. All selected deeds transfer on uncured default.";
}

export function financingContractRepayHTML(contract) {
  if (!financingRepayableContract(contract)) return "";
  const remaining = Math.max(1, Math.floor(Number(contract.remaining) || 1));
  const status = financingState.repayStatus?.contractId === contract.id ? `<p class="t-micro green" role="status" aria-live="polite">${esc(financingState.repayStatus.text)}</p>` : "";
  return `<div class="contract-repay-panel"><div class="contract-repay-heading"><span class="t-micro g400">MAKE A PAYMENT</span><span class="t-micro ink-3">UP TO $${remaining.toLocaleString()}</span></div><div class="contract-repay-controls"><label class="t-label f11 g-muted" for="financing-repay-${esc(contract.id)}">Payment amount</label><input class="field contract-repay-input" id="financing-repay-${esc(contract.id)}" data-contract-repay-amount type="number" min="1" max="${remaining}" step="1" value="${remaining}" inputmode="numeric"><button class="cta-red" type="button" data-financing-repay="${esc(contract.id)}"><span class="cta-text cta-text-sm">REPAY CONTRACT</span></button>${status}</div></div>`;
}
export function financingOwnershipBarHTML(shares, ownerPct, ownerColor) {
  const segments = [`<span style="width:${ownerPct}%;background:${ownerColor}"></span>`];
  for (const entry of shares) {
    const meta = financingHolderMeta(entry.holderId);
    segments.push(`<span style="width:${Number(entry.share || 0)}%;background:${meta.color}"></span>`);
  }
  return `<div class="financing-ownership-bar">${segments.join("")}</div>`;
}

export function financingOwnerRowsHTML(shares, ownerPct, ownerName, ownerColor) {
  const ownerRow = `<div><span class="ownership-avatar" style="background:${ownerColor}"></span><span class="t-label f12 g100">${esc(ownerName)} · ${ownerPct}%</span><span class="t-micro ink-3">CONTROL + RENT</span></div>`;
  const holderRows = shares.map((entry) => {
    const meta = financingHolderMeta(entry.holderId);
    const control = String(entry.control || "passive").toUpperCase();
    return `<div><span class="ownership-avatar" style="background:${meta.color}"></span><span class="t-label f12 g100">${esc(meta.name)} · ${Number(entry.share || 0)}%</span><span class="t-micro ink-3">${control} · RENT + SALE SHARE</span></div>`;
  }).join("");
  return `<div class="financing-owner-list">${ownerRow}${holderRows}</div>`;
}

export function financingShareDuration(entry) {
  const contract = financingActiveContracts().find((c) => c.id === entry.contractId);
  if (!contract) return null;
  if (contract.expiresRound == null) return "FOREVER";
  return "R" + Number(contract.expiresRound);
}

export function financingOwnershipDurations(shares) {
  const labels = [...new Set(shares.map(financingShareDuration).filter(Boolean))];
  if (!labels.length) return "-";
  return labels.join(" · ");
}

export function financingOwnershipBuildingRights(shares) {
  const controlling = shares.find((entry) => String(entry.control) === "controlling");
  if (!controlling) return "OWNER CONTROL";
  return "SHARED · " + financingHolderMeta(controlling.holderId).name;
}

export function financingDeedPickerHTML() {
  const deeds = financingSharedDeeds();
  if (deeds.length < 2) return "";
  return `<div class="financing-surface-actions">` + deeds.map((tile) => `<button class="btn-dark" type="button" data-financing-deed="${tile.i}"><span class="t-label f11">${esc(tile.name)}</span></button>`).join("") + `</div>`;
}

export function financingMissingContractHTML() {
  return `<section class="financing-surface-body" aria-labelledby="financing-missing-heading"><div class="financing-surface-kicker"><span class="t-micro g400">NOT AVAILABLE</span></div><h3 class="t-section g100" id="financing-missing-heading">No live contract selected</h3><p class="t-body ink-2 financing-surface-copy">Pick a live deal below, or shape a new one on the offer surface.</p>${financingContractPickerHTML()}${financingDealShapeHTML()}</section>`;
}
export function financingDealStatusTone(contract) {
  if (contract.status === "due") return "red";
  return "green";
}

export function financingDealHeaderHTML(contract) {
  const status = String(contract.status || "active").toUpperCase();
  const tone = financingDealStatusTone(contract);
  return `<div class="financing-surface-kicker"><span class="t-micro g400">DEAL · LIVE</span><span class="t-label f11 ${tone}">${esc(status)} · ${esc(financingCureLine(contract))}</span></div><h3 class="t-section g100">${esc(financingContractTitle(contract))}</h3>`;
}

export function financingDealDebtKeyHTML(contract) {
  const remaining = Number(contract.remaining || 0);
  return `<div class="financing-default-amount"><span class="t-micro ink-3">BALANCE LEFT</span><strong class="t-money red">$${remaining.toLocaleString()}</strong></div>`;
}

export function financingDealEquityKeyHTML(contract) {
  const share = Number(contract.equityShare || 0);
  return `<div class="financing-default-amount"><span class="t-micro ink-3">${isRentShare(contract) ? "RENT SHARE" : "LEGACY EQUITY SHARE"}</span><strong class="t-money green">${share}%</strong></div>`;
}

export function financingDealKeyFigureHTML(contract) {
  if (contract.kind === "equity") return financingDealEquityKeyHTML(contract);
  return financingDealDebtKeyHTML(contract);
}

export function financingDealShowsProgress(contract) {
  if (contract.kind === "loan") return true;
  if (contract.kind !== "hybrid") return false;
  if (contract.status === "converted") return false;
  return true;
}

export function financingDealProgressBarHTML(progress) {
  return `<div class="financing-ownership-bar financing-repayment-track" role="progressbar" aria-label="Contract repayment progress" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.paid}"><span class="financing-ownership-primary" style="width:${progress.pct}%"></span></div>`;
}

export function financingDealProgressHTML(contract) {
  if (!financingDealShowsProgress(contract)) return "";
  const progress = financingRepayProgress(contract);
  return `<div class="financing-repayment-progress"><div class="financing-repayment-labels"><span class="t-micro ink-3">REPAID</span><strong class="t-label f12 g100">$${progress.paid.toLocaleString()} <span class="ink-3">of $${progress.total.toLocaleString()}</span></strong></div>${financingDealProgressBarHTML(progress)}<p class="t-micro ink-3">${progress.pct}% paid</p></div>`;
}

export function financingDealTermsHTML(contract) {
  const principal = Number(contract.amount || contract.principal || 0);
  const total = Number(contract.totalDue || principal);
  const interest = Math.max(0, total - principal);
  const collateral = contractCollateralIndices(contract).map(index => financingPropertyTile(index)?.name).filter(Boolean);
  const terms = contract.kind === "equity"
    ? [["Property", financingPropertyTile(contract.propertyIndex)?.name || "-"], ["Term", contract.expiresRound == null ? "Ongoing" : `Through round ${Number(contract.expiresRound)}`]]
    : [["Advanced", `$${principal.toLocaleString()}`], ["Total interest", `$${interest.toLocaleString()} (${Number(contract.premiumRate || 0)}%)`], ["Agreed total", `$${total.toLocaleString()}`], ["Due", `Round ${Number(contract.dueRound || contract.durationRounds || 0)}`], [contract.kind === "hybrid" ? "Default conversion" : "Collateral", contract.kind === "hybrid" ? `${Number(contract.conversionShare || 0)}% · ${financingPropertyTile(contract.propertyIndex)?.name || "property not set"}` : collateral.length ? collateral.join(", ") : "None"]];
  return `<dl class="financing-contract-terms">${terms.map(([label, value]) => `<div><dt class="t-micro ink-3">${esc(label)}</dt><dd class="t-label f12 g100">${esc(value)}</dd></div>`).join("")}</dl>`;
}

export function financingDealIsDue(contract) {
  return contract.status === "due";
}

export function financingDealCureHTML(contract) {
  if (!financingDealIsDue(contract)) return "";
  return `<p class="t-micro red">${esc(financingCureLine(contract))}</p>`;
}

export function financingDealCapShares(tile) {
  if (!tile) return [];
  return financingTileShares(tile.i);
}

export function financingDealHasCapTable(tile) {
  const shares = financingDealCapShares(tile);
  if (shares.length) return true;
  return false;
}

export function financingDealCapRightsHTML(tile, shares) {
  const total = shares.reduce((sum, entry) => sum + Number(entry.share || 0), 0);
  const ownerPct = Math.max(0, 100 - total);
  const owner = financingOwnerMeta(tile);
  const splits = [ownerPct + "%", ...shares.map((entry) => Number(entry.share || 0) + "%")].join(" / ");
  return `${financingOwnershipBarHTML(shares, ownerPct, owner.color)}${financingOwnerRowsHTML(shares, ownerPct, owner.name, owner.color)}<div class="financing-rights-grid"><div><span class="t-micro ink-3">BASE RENT $${baseRentOf(tile)}</span><strong class="t-label f13 g100">$${baseRentOf(tile)}</strong></div><div><span class="t-micro ink-3">BUILDING RIGHTS</span><strong class="t-label f13 green">${esc(financingOwnershipBuildingRights(shares))}</strong></div><div><span class="t-micro ink-3">SALE PROCEEDS</span><strong class="t-label f13 g100">${esc(splits)}</strong></div><div><span class="t-micro ink-3">DURATION</span><strong class="t-label f13 g100">${esc(financingOwnershipDurations(shares))}</strong></div></div>`;
}

export function financingDealCapTableHTML() {
  const tile = financingOwnershipDeed();
  if (!financingDealHasCapTable(tile)) return "";
  const shares = financingDealCapShares(tile);
  return `${financingDealCapRightsHTML(tile, shares)}${financingDeedPickerHTML()}${financingTransferComposerHTML(tile, shares)}`;
}
export function financingDealCopyHTML(contract) {
  return `<p class="t-body ink-2 financing-surface-copy" id="financing-card-description">${esc(financingContractCopy(contract))}</p>`;
}

export function financingDealReasonHTML() {
  return `<p class="t-micro ink-3">NO PAYMENT DUE ON THIS DEAL.</p>`;
}

export function financingDealActionHTML(contract) {
  const repay = financingContractRepayHTML(contract);
  if (repay) return `<div class="financing-surface-actions">${repay}</div>`;
  return financingDealReasonHTML();
}

export function financingDealShapeHTML() {
  if (!playerFinanceEnabled(state.settings)) return "";
  return `<div class="financing-surface-actions"><button class="btn-dark" type="button" data-financing-view="builder"><span class="t-label f11">SHAPE NEW DEAL</span></button></div>`;
}

export function financingContractPartyName(contract, side) {
  const id = contract[`${side}PlayerId`];
  const player = state.players.find(player => player.serverId === id || player.id === id);
  return contract[`${side}PlayerName`] || player?.name || "PLAYER";
}

export function financingLedgerRowsHTML(rows) {
  return `<dl class="financing-ledger-rows">${rows.map(([label, value]) => `<div><dt class="t-micro ink-3">${esc(label)}</dt><dd class="t-label f12 g100">${esc(value)}</dd></div>`).join("")}</dl>`;
}

export function financingActiveTermsHTML(contract) {
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

export function financingActiveRightsHTML(contract) {
  if (isRentShare(contract)) return `<h4 class="t-label f12 g100">Temporary rent share</h4><p class="t-body ink-2">${esc(rentShareDisclosure(contract))}</p>`;
  const credit = collateralCreditSummary(contract);
  if (credit) return `<h4 class="t-label f12 g100">Collateral credit at default</h4><p class="t-body ink-2">${esc(credit)}</p>`;
  if (contract.kind === "equity") return `<h4 class="t-label f12 g100">Ownership & returns</h4><p class="t-body ink-2">${Number(contract.equityShare || 0)}% of collected rent and sale proceeds goes to ${esc(financingContractPartyName(contract, "from"))}.</p>`;
  if (contract.kind === "hybrid") return `<h4 class="t-label f12 g100">Uncured default</h4><p class="t-body ink-2">The lender converts ${Number(contract.conversionShare || 0)}% of the linked property's economic share after cure. No collateral is seized.</p>`;
  return `<h4 class="t-label f12 g100">Ownership & default</h4><p class="t-body ink-2">${contractCollateralIndices(contract).length ? "The borrower keeps every pledged deed while payments are current. Uncured default transfers all pledged deeds to the lender." : "No deed is pledged. The borrower owes the agreed total interest."}</p>`;
}

export function financingActiveOwnershipHTML(contract) {
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

export function financingDealSelectedHTML(contract) {
  if (contract.status === "active") return financingActiveContractDetailHTML(contract);
  return `<section class="financing-surface-body financing-contract-detail financing-contract-${esc(contract.kind || "loan")}" aria-labelledby="financing-deal-heading"><div id="financing-deal-heading">${financingDealHeaderHTML(contract)}</div>${financingDealKeyFigureHTML(contract)}${financingDealTermsHTML(contract)}${financingDealProgressHTML(contract)}${financingDealCureHTML(contract)}${financingDealCapTableHTML()}${financingDealCopyHTML(contract)}${financingDealActionHTML(contract)}${financingDealShapeHTML()}</section>`;
}

export function financingDealViewHTML() {
  const contract = financingSelectedContract();
  if (!contract) return financingMissingContractHTML();
  if (financingContractRedacted(contract)) return financingMissingContractHTML();
  return financingDealSelectedHTML(contract);
}
