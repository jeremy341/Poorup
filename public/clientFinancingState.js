// FINANCING: shared session state, counterparty/deed lookups and eligibility rules for deal building.
import { state } from "./clientState.js";
import { RENT_TABLE, TILES } from "./clientBoardData.js";
import { financingMyServerId, host, tradeBuildingBlockReason, tradeBuildingLevel } from "./clientDealHost.js";
import { contractLabel, playerFinanceEnabled } from "./clientFinanceRules.js";
// Mutable financing UI session state shared by the focused financing modules.
export const financingState = {
  previewMode: "loan",
  view: "builder",
  surfaceContractId: null,
  surfaceTileIndex: null,
  negotiationContractId: null,
  negotiationAction: "counter",
  repayStatus: null,
  negotiationDraft: {
    kind: "loan",
    amount: 100,
    premiumRate: 10,
    durationRounds: 3,
    propertyIndex: null,
    collateralTileIndices: [],
    equityShare: 10,
  },
  previewDraft: {
    recipientId: null,
    collateralTileIndices: [],
    propertyIndex: 21,
    amount: 150,
    loanRate: 20,
    loanDuration: 20,
    equityShare: 10,
    equityDuration: 3,
  },
};
// Every other seat is a valid counterparty, bots included: the server
// guards accept any active pair and botLogic answers pending contracts.
// (Same filter the trade modal uses; the rail form narrows to humans.)
export function otherPlayers() {
  return state.players.filter((p) => p.id !== "p1");
}
export function defaultRecipientId() {
  return otherPlayers()[0]?.id || null;
}

export function financingRecipientId() {
  const id = financingState.previewDraft.recipientId;
  if (id && otherPlayers().some((p) => p.id === id)) return id;
  return defaultRecipientId();
}

export function recipientPlayer() {
  return state.players.find((p) => p.id === financingRecipientId());
}

export function financingRecipients() {
  return otherPlayers().map((p) => ({ value: p.id, label: `${p.name} · $${Number(p.cash || 0).toLocaleString()}` }));
}

export function financingRecipientDeeds() {
  const recipientId = financingRecipientId();
  if (!recipientId) return [];
  return TILES.filter((tile) => ["property", "railroad", "utility"].includes(tile.kind) && state.owners[tile.i] === recipientId && !state.mortgaged[tile.i] && !financingTileShares(tile.i).length);
}

// Trade-only room locks are broader than the asset eligibility used for a pledge.
export const COLLATERAL_TRADE_ONLY_REASONS = new Set([
  "Trading is disabled for this room.",
  "Resolve the open auction before proposing a trade.",
  "Resolve the pending purchase offer before proposing a trade.",
  "Resolve the pending sponsored purchase before proposing a trade.",
  "Another trade is already pending.",
  "Resolve the pending player contract before proposing a trade.",
]);

export function financingCollateralDeedEligible(tile) {
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

export function financingRecipientCollateralDeeds() {
  return financingRecipientDeeds().filter(financingCollateralDeedEligible);
}

export function financingPropertyOptions() {
  const deeds = financingRecipientDeeds();
  if (!deeds.length) return [{ value: "", label: "NO ELIGIBLE DEEDS" }];
  return deeds.map((tile) => ({ value: tile.i, label: financingEquityContextLabel(tile) }));
}

export function financingHasEligibleProperty() {
  return financingRecipientDeeds().length > 0;
}

export function financingRecipientValid(value) {
  return otherPlayers().some((p) => p.id === value);
}

export function clampPropertyToRecipient() {
  const deeds = financingRecipientDeeds();
  if (!deeds.length) {
    financingState.previewDraft.propertyIndex = "";
    return;
  }
  const current = Number(financingState.previewDraft.propertyIndex);
  const stillHeld = deeds.some((tile) => tile.i === current);
  if (!stillHeld) financingState.previewDraft.propertyIndex = deeds[0].i;
}

export function clampCollateralToRecipient() {
  const eligible = new Set(financingRecipientCollateralDeeds().map(tile => tile.i));
  const selected = Array.isArray(financingState.previewDraft.collateralTileIndices)
    ? financingState.previewDraft.collateralTileIndices
    : financingState.previewDraft.collateralTileIndex == null ? [] : [financingState.previewDraft.collateralTileIndex];
  financingState.previewDraft.collateralTileIndices = [...new Set(selected.map(Number).filter(index => eligible.has(index)))];
  delete financingState.previewDraft.collateralTileIndex;
}
export function financingEligiblePropertyIndex() {
  const index = Number(financingState.previewDraft.propertyIndex);
  const held = financingRecipientDeeds().some((tile) => tile.i === index);
  return held ? index : null;
}

export function financingEligibleCollateralIndices() {
  const eligible = new Set(financingRecipientCollateralDeeds().map(tile => tile.i));
  return [...new Set(financingState.previewDraft.collateralTileIndices.map(Number))].filter(index => eligible.has(index));
}

export function financingEligibleCollateralIndex() {
  return financingEligibleCollateralIndices()[0] ?? null;
}

export function financingAmount(value = financingState.previewDraft.amount) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
}

export function financingAmountValid() {
  const amount = financingAmount();
  if (amount < 1) return false;
  const me = state.players[0];
  return (me?.cash || 0) >= amount;
}

export function financingAmountError() {
  return financingAmountValid() ? "" : "Enter an amount you can fund.";
}

export function financingPropertyRequired() {
  return financingState.previewMode !== "loan";
}

export function financingPropertyMissing() {
  if (!financingPropertyRequired()) return false;
  return !financingHasEligibleProperty();
}

export function financingLoanTermError(value, min, max) {
  const text = String(value).trim();
  const number = Number(text);
  return text && Number.isInteger(number) && number >= min && number <= max
    ? "" : `Enter a whole number from ${min} to ${max}.`;
}

export function financingLoanErrors() {
  return {
    "finance-loan-rate": financingLoanTermError(financingState.previewDraft.loanRate, 0, 100),
    "finance-loan-duration": financingLoanTermError(financingState.previewDraft.loanDuration, 1, 20),
  };
}

export function financingSendBlocked() {
  if (!playerFinanceEnabled(state.settings)) return "Player Finance is disabled for this table.";
  if (!["loan", "equity"].includes(financingState.previewMode)) return "Choose a loan or rent share.";
  if (!recipientPlayer()) return "Choose a player to deal with.";
  if (!financingAmountValid()) return financingAmountError();
  if (financingState.previewMode === "loan" && Object.values(financingLoanErrors()).some(Boolean)) return "Enter valid loan terms.";
  if (financingPropertyMissing()) return "The counterparty owns no eligible deeds.";
  return null;
}

export function financingLoanTerms() {
  return {
    premiumRate: Number(financingState.previewDraft.loanRate),
    durationRounds: Number(financingState.previewDraft.loanDuration),
    propertyIndex: financingEligiblePropertyIndex(),
    collateralTileIndices: financingEligibleCollateralIndices(),
  };
}

export function financingEquityDurationRounds() {
  return Math.max(1, Math.min(20, Math.floor(Number(financingState.previewDraft.equityDuration) || 3)));
}

export function financingEquityTerms() {
  return {
    premiumRate: 0,
    durationRounds: financingEquityDurationRounds(),
    propertyIndex: financingEligiblePropertyIndex(),
    collateralTileIndex: null,
    equityShare: Math.max(5, Math.min(100, Number(financingState.previewDraft.equityShare) || 10)),
    equityControl: "passive",
    permanent: false,
  };
}

export function financingSendPayload(recipient) {
  const base = {
    toPlayerId: recipient.serverId || recipient.id,
    kind: financingState.previewMode,
    amount: financingAmount(),
    requestId: host.createRequestId("contract-proposal"),
  };
  const terms = financingState.previewMode === "equity" ? financingEquityTerms() : financingLoanTerms();
  return { ...base, ...terms };
}
export function financingEquityContextLabel(tile) {
  const serverTile = state.serverTiles.find((t) => Number(t.index) === Number(tile.i));
  const shares = serverTile?.equityShares || [];
  const total = shares.reduce((sum, entry) => sum + Number(entry.share || 0), 0);
  return total ? `${tile.name} · $${tile.price} · EQUITY ${total}%` : `${tile.name} · $${tile.price}`;
}

export function baseRentOf(tile) {
  const listed = Number(tile.rent) || 0;
  if (listed) return listed;
  return Number(RENT_TABLE[tile.group]?.base) || 0;
}
export function financingActiveContracts() {
  return state.playerContracts?.active || [];
}

export function financingSelectedContract() {
  if (!financingState.surfaceContractId) return null;
  return financingActiveContracts().find((contract) => contract.id === financingState.surfaceContractId) || null;
}

export function financingContractMine(contract) {
  const mine = financingMyServerId();
  if (!mine) return false;
  if (contract.fromPlayerId === mine) return true;
  return contract.toPlayerId === mine;
}

export function financingContractRedacted(contract) {
  if (contract.remaining != null) return false;
  return contract.equityShare == null;
}

export function financingRepayableContract(contract) {
  if (!financingContractMine(contract)) return false;
  if (contract.toPlayerId !== financingMyServerId()) return false;
  if (contract.status === "active") return true;
  return contract.status === "due";
}
export function contractCollateralIndices(contract) {
  if (Array.isArray(contract?.collateralTileIndices)) return contract.collateralTileIndices;
  return contract?.collateralTileIndex == null ? [] : [contract.collateralTileIndex];
}

export function contractKindLabel(contract) {
  return contractLabel(contract);
}

export function financingRepayProgress(contract) {
  const total = Number(contract.totalDue || contract.amount || 0);
  const remaining = Number(contract.remaining || 0);
  const paid = Math.max(0, total - remaining);
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  return { paid, total, pct };
}

export function financingCureLine(contract) {
  if (contract.status !== "due") return `DUE ROUND R${Number(contract.dueRound || 0)}`;
  const left = Number(contract.cureRound || 0) - Number(state.roundNumber || 0);
  if (left < 0) return "CURE EXPIRED";
  return `CURE IN ${left} ROUNDS`;
}

export function financingTileShares(index) {
  const serverTile = state.serverTiles.find((tile) => Number(tile.index) === Number(index));
  if (!serverTile) return [];
  return serverTile.equityShares || [];
}

export function financingSharedDeeds() {
  return TILES.filter((tile) => tile.kind === "property" && financingTileShares(tile.i).length > 0);
}

export function financingPropertyTile(index) {
  const tile = TILES[Number(index)];
  if (!tile) return null;
  if (!["property", "railroad", "utility"].includes(tile.kind)) return null;
  return tile;
}

export function financingContractDeed(contract) {
  if (!contract) return null;
  return financingPropertyTile(contract.propertyIndex);
}

export function financingOwnershipDeed() {
  const picked = financingPropertyTile(financingState.surfaceTileIndex);
  if (picked) return picked;
  const linked = financingContractDeed(financingSelectedContract());
  if (linked) return linked;
  return financingSharedDeeds()[0] || null;
}

export function financingHolderMeta(holderId) {
  const player = state.players.find((p) => p.serverId === holderId || p.id === holderId);
  if (!player) return { name: "PLAYER", color: "var(--gold-400)" };
  return { name: player.name, color: player.color || "var(--gold-400)" };
}

export function financingOwnerMeta(tile) {
  const owner = state.players.find((p) => p.id === state.owners[tile.i]);
  if (!owner) return { name: "BANK", color: "var(--gold-400)" };
  return { name: owner.name, color: owner.color || "var(--gold-400)" };
}
export function boundedInteger(value, fallback, min, max = Number.POSITIVE_INFINITY) {
  return Math.max(min, Math.min(max, Math.floor(Number(value) || fallback)));
}

