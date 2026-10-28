// Temporary rent rights share collected rent only; ownership stays with the deed holder.
export const RENT_SHARE_VERSION = 1;
export const CONTRACT_RULES_VERSION = 2;
export const DEFAULT_RENT_SHARE_ROUNDS = 3;
export { PLAYER_FINANCE_DISABLED_REASON as FINANCE_DISABLED_ERROR } from './financeRules.js';
export const LEGACY_PENDING_ERROR = 'This legacy offer must be rebuilt under the current rules or declined.';

export function isRentShareContract(contract) {
  return contract?.rulesVersion === CONTRACT_RULES_VERSION && contract.rentShareVersion === RENT_SHARE_VERSION && contract.kind === 'equity';
}

export function rentShareDeedType(tile) {
  return ['property', 'railroad', 'utility'].includes(tile?.type);
}

export function newContractTermsError(offer = {}) {
  if (offer.kind === 'hybrid') return 'Hybrid contracts are no longer available; choose a loan or a temporary rent share.';
  if (offer.kind != null && !['loan', 'equity'].includes(String(offer.kind))) return 'Choose a loan or a temporary rent share.';
  if (offer.permanent != null && offer.permanent !== false) return 'Rent shares must be temporary, for 1 to 20 rounds.';
  if (offer.equityControl != null && offer.equityControl !== 'passive') return 'Rent shares are passive only; the owner keeps control of the deed.';
  if (offer.kind === 'equity') return rentShareTermsError(offer);
  return null;
}

function rentShareTermsError(offer) {
  if (Object.hasOwn(offer, 'expiresRound') && offer.expiresRound == null) return 'Rent shares must be temporary, for 1 to 20 rounds.';
  const duration = offer.durationRounds == null ? DEFAULT_RENT_SHARE_ROUNDS : Number(offer.durationRounds);
  if (!Number.isInteger(duration) || duration < 1 || duration > 20) return 'Rent share duration must be a whole number from 1 to 20 rounds.';
  return null;
}

function activeInterest(game, contract) {
  if (!['active', 'due', 'converted'].includes(contract?.status)) return false;
  if (!['equity', 'hybrid'].includes(contract.kind)) return false;
  if (isRentShareContract(contract) && Number(game.roundNumber) >= contract.expiresRound) return false;
  return true;
}

// Count actual entries plus agreements not yet materialized, preventing a second investor race.
export function deedHasShareInterest(game, tile, ignoredContractId = null) {
  if (!tile) return false;
  const contracts = game.playerContracts || [];
  if ((tile.equityShares || []).some(entry => {
    if (entry.contractId === ignoredContractId) return false;
    const contract = contracts.find(candidate => candidate.id === entry.contractId);
    return !isRentShareContract(contract) || activeInterest(game, contract);
  })) return true;
  return contracts.some(contract => contract.id !== ignoredContractId
    && Number(contract.propertyIndex) === Number(tile.index) && activeInterest(game, contract));
}

export function rentShareConstructionAllowed(game, tile) {
  return !(tile.equityShares || []).some(entry => {
    const contract = (game.playerContracts || []).find(candidate => candidate.id === entry.contractId);
    return !isRentShareContract(contract);
  });
}
