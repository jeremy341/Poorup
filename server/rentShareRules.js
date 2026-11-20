// Rules for the "rent share" contract: a temporary right to a percentage of the rent a deed collects. Ownership, building and
// mortgage rights stay with the deed holder. Used by contractLogic.js and sponsorshipApi.js (offer validation) and propertyRules.js.
// Contracts are stamped with these version numbers so offers saved under older rules are recognised and refused.
export const RENT_SHARE_VERSION = 1;
export const CONTRACT_RULES_VERSION = 2;
export const DEFAULT_RENT_SHARE_ROUNDS = 3;
const MAX_RENT_SHARE_ROUNDS = 20;
export { PLAYER_FINANCE_DISABLED_REASON as FINANCE_DISABLED_ERROR } from './financeRules.js';
export const LEGACY_PENDING_ERROR = 'This legacy offer must be rebuilt under the current rules or declined.';

export function isRentShareContract(contract) {
  return contract?.rulesVersion === CONTRACT_RULES_VERSION && contract.rentShareVersion === RENT_SHARE_VERSION && contract.kind === 'equity';
}

export function rentShareDeedType(tile) {
  return ['property', 'railroad', 'utility'].includes(tile?.type);
}

function kindTermsError(offer) {
  if (offer.kind === 'hybrid') return 'Hybrid contracts are no longer available; choose a loan or a temporary rent share.';
  if (offer.kind != null && !['loan', 'equity'].includes(String(offer.kind))) return 'Choose a loan or a temporary rent share.';
  return null;
}

function structureTermsError(offer) {
  if (offer.permanent != null && offer.permanent !== false) return `Rent shares must be temporary, for 1 to ${MAX_RENT_SHARE_ROUNDS} rounds.`;
  if (offer.equityControl != null && offer.equityControl !== 'passive') return 'Rent shares are passive only; the owner keeps control of the deed.';
  return null;
}

export function newContractTermsError(offer = {}) {
  return kindTermsError(offer) || structureTermsError(offer) || (offer.kind === 'equity' ? rentShareTermsError(offer) : null);
}

function rentShareTermsError(offer) {
  if (Object.hasOwn(offer, 'expiresRound') && offer.expiresRound == null) return `Rent shares must be temporary, for 1 to ${MAX_RENT_SHARE_ROUNDS} rounds.`;
  const duration = offer.durationRounds == null ? DEFAULT_RENT_SHARE_ROUNDS : Number(offer.durationRounds);
  if (!Number.isInteger(duration) || duration < 1 || duration > MAX_RENT_SHARE_ROUNDS) return `Rent share duration must be a whole number from 1 to ${MAX_RENT_SHARE_ROUNDS} rounds.`;
  return null;
}

function activeInterest(game, contract) {
  if (!['active', 'due', 'converted'].includes(contract?.status)) return false;
  if (!['equity', 'hybrid'].includes(contract.kind)) return false;
  if (isRentShareContract(contract) && Number(game.roundNumber) >= contract.expiresRound) return false;
  return true;
}

// A share entry blocks a new one unless it belongs to the ignored contract or is a rent share that has ended.
function liveShareEntry(game, entry, contracts, ignoredContractId) {
  if (entry.contractId === ignoredContractId) return false;
  const contract = contracts.find(candidate => candidate.id === entry.contractId);
  return !isRentShareContract(contract) || activeInterest(game, contract);
}

// Count actual entries plus agreements not yet materialized, preventing a second investor race.
export function deedHasShareInterest(game, tile, ignoredContractId = null) {
  if (!tile) return false;
  const contracts = game.playerContracts || [];
  if ((tile.equityShares || []).some(entry => liveShareEntry(game, entry, contracts, ignoredContractId))) return true;
  return contracts.some(contract => contract.id !== ignoredContractId
    && Number(contract.propertyIndex) === Number(tile.index) && activeInterest(game, contract));
}

export function rentShareConstructionAllowed(game, tile) {
  return !(tile.equityShares || []).some(entry => {
    const contract = (game.playerContracts || []).find(candidate => candidate.id === entry.contractId);
    return !isRentShareContract(contract);
  });
}
