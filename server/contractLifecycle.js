// Round-by-round contract processing: loan due dates and defaults (with collateral seizure), hybrid conversion, equity expiry,
// and the rent-share payouts equity holders receive.
import { usesCollateralCredit } from './collateralSettlement.js';
import { isRentShareContract } from './rentShareRules.js';
import { announceLoanDue, canRecordDefaultClaim, equitySharePayable, handlePlayerLoanDefault } from './bankruptcyLogic.js';
import { equityCapReached, isEquityEligibleProperty, settleRecipientParkedDebt } from './contractGuards.js';

function equityContractExpired(game, contract) {
  if (contract.kind !== 'equity') return false;
  if (contract.status !== 'active') return false;
  if (!contract.expiresRound) return false;
  return game.roundNumber >= contract.expiresRound;
}

export function expireEquityContract(game, contract) {
  if (!equityContractExpired(game, contract)) return false;
  const property = game.getTile(contract.propertyIndex);
  if (property) {
    const shares = Array.isArray(property.equityShares) ? property.equityShares : [];
    const entry = shares.find(item => item.contractId === contract.id);
    // A carried unpaidRentShare is real money the holder earned but the owner
    // could not pay. On expiry the share is stripped, so settle it explicitly
    // as a written-off line item: silently dropping it would strand the
    // balance with no record.
    const carried = Math.max(0, Math.floor(Number(contract.unpaidRentShare) || 0));
    if (carried > 0) {
      const holder = entry ? game.getPlayerById(entry.holderId) : null;
      game.feedMessage(`${holder ? holder.nickname : 'A shareholder'}'s rent share on ${property.name || 'a property'} expired with $${carried} unpaid — written off.`);
      contract.unpaidRentShare = 0;
    }
    property.equityShares = shares.filter(item => item.contractId !== contract.id);
  }
  contract.status = 'expired';
  return true;
}

function handleDueLoanContract(game, contract) {
  if (game.roundNumber <= contract.cureRound) return;
  defaultPlayerLoanWithBasket(game, contract);
}

function defaultPlayerLoanWithBasket(game, contract, options = {}) {
  if (usesCollateralCredit(contract)) {
    handlePlayerLoanDefault(game, contract, options);
    return;
  }
  // A default without a recovery claim would seize collateral and close the loan with nothing for the lender to collect. When the
  // claim ledger is full, change nothing and leave the contract due; the next round retries once a slot frees up.
  if (!canRecordDefaultClaim(game, contract)) return;
  const borrower = game.getPlayerById(contract.toPlayerId);
  const lender = game.getPlayerById(contract.fromPlayerId);
  const indices = defaultCollateralIndices(contract);
  defaultPlayerLoanBalance(game, contract, options);
  seizeDefaultCollateral(game, borrower, lender, indices);
  recordCollateralLoss(borrower, indices);
  recordDefaultClaimCollateral(game, contract, indices);
}

export function defaultCollateralIndices(contract) {
  if (Array.isArray(contract.collateralTileIndices) && contract.collateralTileIndices.length) return contract.collateralTileIndices;
  if (contract.collateralTileIndex == null) return [];
  return [contract.collateralTileIndex];
}

function defaultPlayerLoanBalance(game, contract, options) {
  const first = contract.collateralTileIndex;
  contract.collateralTileIndex = null;
  handlePlayerLoanDefault(game, contract, options);
  contract.collateralTileIndex = first;
}

function seizeDefaultCollateral(game, borrower, lender, indices) {
  if (!borrower) return;
  if (borrower.bankrupt) return;
  if (!lender) return;
  for (const index of indices) {
    const deed = game.getTile(Number(index));
    if (deed?.ownerId === borrower.id) game.applyPropertyOwnershipChange(borrower, lender, deed);
  }
}

function recordCollateralLoss(borrower, indices) {
  if (!borrower) return;
  if (!indices.length) return;
  borrower.collateralLost = true;
}

function recordDefaultClaimCollateral(game, contract, indices) {
  contract.collateralTileIndices = indices.slice();
  contract.unsecuredDefault = indices.length === 0;
  const claim = (game.defaultClaims || []).find(entry => entry.contractId === contract.id);
  if (!claim) return;
  claim.collateralTileIndex = indices[0] ?? null;
  claim.collateralTileIndices = indices.slice();
}

function handleActiveLoanContract(game, contract) {
  if (game.roundNumber < contract.dueRound) return;
  contract.status = 'due';
  const borrower = game.getPlayerById(contract.toPlayerId);
  if (borrower) announceLoanDue(game, contract, borrower);
}

function advanceLoanContract(game, contract) {
  if (contract.kind !== 'loan') return;
  if (contract.status === 'active') {
    handleActiveLoanContract(game, contract);
    return;
  }
  if (contract.status === 'due') handleDueLoanContract(game, contract);
}

function hybridConversionEligible(game, contract) {
  const borrower = game.getPlayerById(contract.toPlayerId);
  if (!borrower) return false;
  const property = game.getTile(contract.propertyIndex);
  if (!isEquityEligibleProperty(game, property, borrower.id, contract.id)) return false;
  return !equityCapReached(property, contract.conversionShare, game, contract.id);
}

function recordHybridConversion(game, contract, lender) {
  const property = game.getTile(contract.propertyIndex);
  const holders = Array.isArray(property.equityShares) ? property.equityShares : [];
  property.equityShares = [...holders, {
    holderId: lender.id,
    share: contract.conversionShare,
    contractId: contract.id,
    control: 'passive'
  }];
}

// A hybrid note converts instead of seizing: past the cure turn the lender takes the agreed equity share and interest stops.
// If the conversion target is gone (sold, mortgaged, built on, or full), the note falls back to the plain loan-default path.
function convertHybridContract(game, contract) {
  if (!hybridConversionEligible(game, contract)) {
    defaultPlayerLoanWithBasket(game, contract, { reason: 'conversion-unavailable' });
    return;
  }
  const lender = game.getPlayerById(contract.fromPlayerId);
  if (!lender) {
    defaultPlayerLoanWithBasket(game, contract, { reason: 'conversion-lender-unavailable' });
    return;
  }
  const borrower = game.getPlayerById(contract.toPlayerId);
  recordHybridConversion(game, contract, lender);
  contract.status = 'converted';
  contract.convertedRound = game.roundNumber;
  game.feedMessage((lender?.nickname || 'PLAYER') + ' converted a hybrid note into ' + contract.conversionShare + '% equity from ' + (borrower?.nickname || 'PLAYER') + '.');
}

function handleDueHybridContract(game, contract) {
  if (game.roundNumber <= contract.cureRound) return;
  convertHybridContract(game, contract);
}

function advanceHybridContract(game, contract) {
  if (contract.status === 'active') {
    handleActiveLoanContract(game, contract);
    return;
  }
  if (contract.status === 'due') handleDueHybridContract(game, contract);
}

function processContract(game, contract) {
  if (expireEquityContract(game, contract)) return;
  if (contract.kind === 'hybrid') {
    advanceHybridContract(game, contract);
    return;
  }
  advanceLoanContract(game, contract);
}

export function processContracts(game) {
  game.playerContracts.forEach(contract => processContract(game, contract));
}

export function settleEquityShares(game, tile, owner, amountPaid, payer = null) {
  // Expiry takes effect at the recorded round even before the round sweep runs.
  for (const contract of game.playerContracts || []) {
    if (isRentShareContract(contract) && Number(contract.propertyIndex) === Number(tile?.index)) expireEquityContract(game, contract);
  }
  if (!Array.isArray(tile?.equityShares) || !tile.equityShares.length) return;
  if (!owner) return;
  if (owner.bankrupt) return;
  if (amountPaid <= 0) return;
  // The shares of one deed can never add up to more than 100% of its rent: a stale or hand-edited tile would otherwise pay out
  // more than was collected. Each entry is paid from the rent still unallocated, so one deed's payouts never exceed its rent.
  let unallocated = 100;
  const paid = [];
  tile.equityShares.forEach(share => {
    const payable = equitySharePayable(game, share);
    if (!payable) return;
    const sharePct = Math.min(payable.sharePct, Math.max(0, unallocated));
    if (sharePct <= 0) return;
    unallocated -= sharePct;
    const holder = settleEquityPayout(game, owner, share, amountPaid, payer, sharePct);
    if (holder) paid.push(holder);
  });
  // The parked-debt retry waits until the loop is over: settling it from
  // inside the loop would re-enter settlePendingEquityShares and pay the
  // same shares twice for one rent.
  paid.forEach(holder => settleRecipientParkedDebt(game, holder));
}

// The owner's cash is the only source of a share payout, so the owner can be short. The unpaid part is carried on the contract
// as unpaidRentShare and paid from the next rent that tile collects, rather than voiding rent the holder already earned. The payout
// stays clamped to the owner's cash, so no cash is minted, and the carry is an integer like every other balance.
//
// Rent is scored to whoever keeps the money: the owner had already been credited the full rent, so a part-sold deed scored the
// holder zero. Both sides go through the player-level rent facts, so the holder can reach maxRentPayersInRound.
function settleEquityPayout(game, owner, share, amountPaid, payer, effectiveSharePct = null) {
  const payable = equitySharePayable(game, share);
  if (!payable) return null;
  const sharePct = effectiveSharePct == null ? payable.sharePct : effectiveSharePct;
  const carried = Math.max(0, Math.floor(Number(payable.contract.unpaidRentShare) || 0));
  const earned = Math.max(0, Math.floor(amountPaid * (sharePct / 100)));
  const owed = carried + earned;
  const payout = Math.min(Math.max(0, owner.cash), owed);
  if (payout > 0) {
    owner.cash -= payout;
    if (payer && typeof game.creditRentTo === 'function') {
      game.creditRentTo(payable.holder, payer, payout);
    } else {
      // No identified payer (a direct internal settle): still book the rent so
      // the holder is not scored at zero, just without the payer bookkeeping.
      payable.holder.cash += payout;
      payable.holder.rentCollected = (payable.holder.rentCollected || 0) + payout;
    }
    // The owner keeps only what the share did not take. Clamped so a carried
    // payout can never drive the running total negative.
    owner.rentCollected = Math.max(0, (owner.rentCollected || 0) - payout);
    payable.contract.rentCollected = (payable.contract.rentCollected || 0) + payout;
  }
  const stillOwed = owed - payout;
  if (stillOwed > 0) payable.contract.unpaidRentShare = stillOwed;
  else if (payable.contract.unpaidRentShare) payable.contract.unpaidRentShare = 0;
  // The holder is reported back so the caller can retry that holder's own
  // parked debt once the whole share loop is done.
  return payout > 0 ? payable.holder : null;
}
