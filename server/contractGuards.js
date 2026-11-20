// Guards shared by the contract proposal, lifecycle and summary modules: live statuses, parked-debt retry, and equity eligibility.
import { contractPledgesTile } from './gameLogic.js';

export const ACTIVE_CONTRACT_STATUSES = ['active', 'due'];

// A cash inflow can be the missing piece of the recipient's own parked debt: the seat was gated on a claim it could not cover,
// and the incoming cash may cover it now. Every contract cash inflow (transfer price, loan repayment, equity rent share)
// retries that claim here, as the rent, trade and bankruptcy paths do.
export function settleRecipientParkedDebt(game, recipient) {
  if (!recipient) return;
  if (game.pendingPayment?.playerId !== recipient.id) return;
  if (typeof game.settleCreditorParkedDebt === 'function') {
    game.settleCreditorParkedDebt(recipient);
    return;
  }
  if (typeof game.trySettlePendingPayment === 'function') game.trySettlePendingPayment();
}

// A deed pledged as live bank-loan or contract collateral is encumbered, whatever its raw fields say. Both checks share
// propertyRules.tileEncumbered with the trade and mortgage surface. ignoredContractId excludes a contract's pledge of its own conversion target:
// a due hybrid encumbers the tile it converts into, while an active one stays open to equity proposals until the 100% capacity rule applies.
export function pledgeBlocksEquityEligibility(contract, owner, property) {
  if (!contractPledgesTile(contract, owner, property)) return false;
  if (contract.kind === 'hybrid' && contract.status === 'active' && Number(contract.propertyIndex) === Number(property.index)) {
    // Only the conversion target is exempt. A deed the same note also pledges in
    // its collateral basket is encumbered like any other pledged deed.
    const basket = Array.isArray(contract.collateralTileIndices) && contract.collateralTileIndices.length
      ? contract.collateralTileIndices
      : [contract.collateralTileIndex];
    return basket.some(index => index != null && Number(index) === Number(property.index));
  }
  return true;
}

export function isEquityEligibleProperty(game, property, ownerId, ignoredContractId = null) {
  if (!property) return false;
  if (property.type !== 'property') return false;
  if (property.ownerId !== ownerId) return false;
  if (property.mortgaged) return false;
  const owner = game.getPlayerById(ownerId);
  if (game.isLoanCollateral(owner, property)) return false;
  const pledgedElsewhere = (game.playerContracts || []).some(contract =>
    contract.id !== ignoredContractId && pledgeBlocksEquityEligibility(contract, owner, property));
  if (pledgedElsewhere) return false;
  return !(property.houseCount > 0);
}

export function equityCapReached(property, share, game = null, ignoredContractId = null) {
  const shares = Array.isArray(property.equityShares) ? property.equityShares : [];
  const materializedIds = new Set(shares.map(entry => entry?.contractId).filter(Boolean));
  const existingShare = shares.reduce((sum, entry) => {
    const value = Number(entry?.share);
    return sum + (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0);
  }, 0);
  const pendingShare = game?.pendingPlayerContract
    && game.pendingPlayerContract.id !== ignoredContractId
    && Number(game.pendingPlayerContract.propertyIndex) === Number(property.index)
    && ['equity', 'hybrid'].includes(game.pendingPlayerContract.kind)
    ? Number(game.pendingPlayerContract.equityShare || game.pendingPlayerContract.conversionShare) || 0
    : 0;
  const contractShare = (game?.playerContracts || []).reduce((sum, contract) => {
    if (contract.id === ignoredContractId || materializedIds.has(contract.id)) return sum;
    if (Number(contract.propertyIndex) !== Number(property.index)) return sum;
    if (!['active', 'due', 'converted'].includes(contract.status)) return sum;
    if (!['equity', 'hybrid'].includes(contract.kind)) return sum;
    return sum + (Number(contract.equityShare || contract.conversionShare) || 0);
  }, 0);
  return existingShare + pendingShare + contractShare + share > 100;
}
