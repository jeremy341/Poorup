// Settlement rules for bankruptcy, debt claims, and the obligations a
// quitting or eliminated seat must not leave behind. Pure module: it only
// mutates the GameState it is handed, so the rules stay testable in isolation.

function involvesPlayer(obligation, playerId) {
  if (obligation.fromPlayerId === playerId) return true;
  return obligation.toPlayerId === playerId;
}

function deedStillHeldBy(deed, playerId) {
  if (!deed) return false;
  if (deed.ownerId !== playerId) return false;
  if (deed.mortgaged) return false;
  return !(deed.houseCount > 0);
}

function rejectContract(game, error) {
  game.pendingPlayerContract = null;
  return { success: false, error };
}

function loanCollateralIndices(contract) {
  if (Array.isArray(contract.collateralTileIndices) && contract.collateralTileIndices.length) {
    return contract.collateralTileIndices;
  }
  return contract.collateralTileIndex == null ? [] : [contract.collateralTileIndex];
}

// The proposal validated the whole basket; settlement must re-validate it
// the same way. The singular collateralTileIndex is only a legacy alias
// for the first index, so checking it alone lets later deeds sail through
// acceptance already sold or mortgaged. Both a plain loan and the funded leg
// of a hybrid note are secured by this basket, so both re-validate it.
function pledgedCollateralRejection(game, player, contract) {
  const indices = loanCollateralIndices(contract);
  if (!indices.length) return null;
  for (const index of indices) {
    const collateral = game.getTile(Number(index));
    if (!deedStillHeldBy(collateral, player.id) || !game.isTradeableTile(collateral)) {
      return rejectContract(game, 'The loan collateral is no longer available.');
    }
  }
  return null;
}

function loanCollateralRejection(game, player, contract) {
  if (contract.kind !== 'loan') return null;
  return pledgedCollateralRejection(game, player, contract);
}

function propertyShareRejection(game, player, contract, share) {
  const property = game.getTile(contract.propertyIndex);
  if (!deedStillHeldBy(property, player.id)) return rejectContract(game, 'The equity property is no longer available.');
  const shares = Array.isArray(property.equityShares) ? property.equityShares : [];
  const materializedIds = new Set(shares.map(entry => entry?.contractId).filter(Boolean));
  const existingShare = shares.reduce((sum, entry) => {
    const value = Number(entry?.share);
    return sum + (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0);
  }, 0);
  const pendingContracts = (game.playerContracts || []).reduce((sum, candidate) => {
    if (candidate.id === contract.id || materializedIds.has(candidate.id)) return sum;
    if (Number(candidate.propertyIndex) !== Number(property.index)) return sum;
    if (!['active', 'due', 'converted'].includes(candidate.status)) return sum;
    if (!['equity', 'hybrid'].includes(candidate.kind)) return sum;
    return sum + (Number(candidate.equityShare || candidate.conversionShare) || 0);
  }, 0);
  if (existingShare + pendingContracts + share > 100) return rejectContract(game, 'The property has no remaining equity.');
  return null;
}

function equityContractRejection(game, player, contract) {
  return propertyShareRejection(game, player, contract, contract.equityShare);
}

function hybridContractRejection(game, player, contract) {
  // A hybrid note is a funded loan until it converts: the loan leg is secured
  // by the pledged basket, the equity leg by the conversion target. Both were
  // validated at proposal, so both must still stand at acceptance.
  return pledgedCollateralRejection(game, player, contract)
    || propertyShareRejection(game, player, contract, contract.conversionShare);
}

// Re-validate contract security at settlement time: pledged deeds can be
// sold, mortgaged, or lost between proposal and acceptance, and the payer
// must not fund against vanished security.
export function contractSettlementRejection(game, player, contract) {
  if (contract.kind === 'equity') return equityContractRejection(game, player, contract);
  if (contract.kind === 'hybrid') return hybridContractRejection(game, player, contract);
  return loanCollateralRejection(game, player, contract);
}

// Bankruptcy is the player's decision, not the server's verdict. These are
// the only three ways the table can refuse a voluntary exit.
export function bankruptcyRefusal(game, player) {
  if (!player) return { success: false, error: 'Player not found.' };
  if (!game.started) return { success: false, error: 'The game has not started.' };
  if (player.bankrupt) return { success: false, error: 'That player is already out of the game.' };
  if (player.disconnected) return { success: false, error: 'That player is unavailable right now.' };
  return null;
}

// Who is owed the settlement debt (creditor null = the bank), and whether
// the seat owes anything at all (no debt = a voluntary retirement).
export function outstandingDebtFor(game, player) {
  const debt = game.pendingPayment;
  if (debt?.playerId !== player.id) return { owes: false, creditor: null };
  const creditor = debt.creditorId ? game.getPlayerById(debt.creditorId) : null;
  return { owes: true, creditor };
}

// A quitting seat must not leave obligations held by it blocking the rest
// of the table (pending offers gate trades, market, and casino).
const QUIT_OBLIGATIONS = [
  { key: 'pendingTrade', suffix: 'A pending trade was cancelled.' },
  { key: 'pendingPlayerContract', suffix: 'A pending contract was cancelled.' }
];

export function clearQuitObligations(game, player) {
  game.clearSponsoredPurchaseForPlayer?.(player.id);
  game.removeQueuedPaymentsForPlayer?.(player.id);
  if (game.pendingPurchaseOffer?.playerId === player.id) game.pendingPurchaseOffer = null;
  // A pending payment cannot keep running after either side exits. The
  // debtor's current cash is handled by the bankruptcy caller first; this
  // clear only removes the now-unresolvable table gate. Keep it silent so the
  // existing bankruptcy announcement remains the first user-facing result.
  const pendingPayment = game.pendingPayment;
  if (pendingPayment && (pendingPayment.playerId === player.id || pendingPayment.creditorId === player.id)) {
    game.clearPendingPayment();
  }
  QUIT_OBLIGATIONS.forEach(({ key, suffix }) => {
    const obligation = game[key];
    if (!obligation) return;
    if (!involvesPlayer(obligation, player.id)) return;
    game[key] = null;
    game.feedMessage(`${player.nickname} left the table. ${suffix}`);
  });
}

function canSeizeLoanCollateral(borrower, lender, collateral) {
  if (!borrower) return false;
  if (borrower.bankrupt) return false;
  if (!lender) return false;
  return collateral?.ownerId === borrower.id;
}

// A past-due player loan seizes whatever collateral still belongs to the
// borrower (never from a bankrupt seat), marks the pledge as lost, files the
// lender's claim, and closes the contract in the feed. It is the seam the
// contract processor reaches for every default, so it is also where the
// claim ledger collects what matured on an earlier round: a default is the
// table's debt beat, and the claim just filed is skipped by that same sweep
// (it is not collectable until the next round).
export function handlePlayerLoanDefault(game, contract, { reason = 'loan-default' } = {}) {
  const borrower = game.getPlayerById(contract.toPlayerId);
  const lender = game.getPlayerById(contract.fromPlayerId);
  const collateral = contract.collateralTileIndex == null ? null : game.getTile(contract.collateralTileIndex);
  if (canSeizeLoanCollateral(borrower, lender, collateral)) game.applyPropertyOwnershipChange(borrower, lender, collateral);
  if (borrower) {
    if (contract.collateralTileIndex != null) borrower.collateralLost = true;
  }
  const principal = Math.max(0, Math.floor(Number(contract.remaining ?? contract.totalDue ?? contract.amount) || 0));
  // Keep the unpaid principal as a server-side claim even when no collateral
  // remains. Marking only a terminal status previously destroyed the lender's
  // recovery path on failed hybrid conversion.
  contract.defaultedPrincipal = principal;
  contract.defaultReason = reason;
  contract.unsecuredDefault = contract.collateralTileIndex == null;
  recordDefaultClaim(game, contract, principal);
  contract.status = 'defaulted';
  contract.defaultedRound = game.roundNumber;
  game.feedMessage((borrower?.nickname || 'PLAYER') + ' defaulted on a player loan.');
  settleDefaultClaims(game);
}

// Defaults are retained as a server-owned claim ledger rather than only
// descriptive fields on a terminal contract. This gives unsecured hybrids a
// deterministic recovery path without minting cash or exposing claims in
// public room projections.
export function recordDefaultClaim(game, contract, principal = 0) {
  game.defaultClaims ||= [];
  const existing = game.defaultClaims.find(claim => claim.contractId === contract.id);
  if (existing) return existing;
  const claim = {
    id: `claim_${String(contract.id || '').slice(0, 80)}`,
    contractId: contract.id,
    lenderId: contract.fromPlayerId || null,
    borrowerId: contract.toPlayerId || null,
    principal: Math.max(0, Math.floor(Number(principal) || 0)),
    remaining: Math.max(0, Math.floor(Number(principal) || 0)),
    collateralTileIndex: contract.collateralTileIndex ?? null,
    reason: String(contract.defaultReason || 'loan-default').slice(0, 80),
    status: 'open',
    createdRound: Math.max(0, Math.floor(Number(game.roundNumber) || 0))
  };
  game.defaultClaims.push(claim);
  if (game.defaultClaims.length > 200) game.defaultClaims.splice(0, game.defaultClaims.length - 200);
  contract.defaultClaimId = claim.id;
  return claim;
}

export function settleDefaultClaim(game, contractId, amount = null) {
  const claim = (game.defaultClaims || []).find(candidate => candidate.contractId === contractId && candidate.status === 'open');
  if (!claim) return { success: false, error: 'That default claim is no longer open.' };
  const borrower = game.getPlayerById?.(claim.borrowerId);
  const lender = game.getPlayerById?.(claim.lenderId);
  if (!borrower || !lender || borrower.bankrupt || lender.bankrupt) return { success: false, error: 'That default claim cannot be settled.' };
  const hasRequestedAmount = amount !== null && amount !== undefined;
  const requested = hasRequestedAmount ? Number(amount) : claim.remaining;
  if (!Number.isFinite(requested) || requested <= 0) return { success: false, error: 'Default-claim repayment must be a positive whole amount.' };
  const payment = Math.min(claim.remaining, Math.floor(requested));
  if (!payment || Number(borrower.cash) < payment) return { success: false, error: 'You do not have enough cash to settle the default claim.' };
  borrower.cash -= payment;
  lender.cash += payment;
  claim.remaining -= payment;
  if (claim.remaining <= 0) {
    claim.remaining = 0;
    claim.status = 'settled';
    claim.settledRound = Math.max(0, Math.floor(Number(game.roundNumber) || 0));
  }
  game.feedMessage?.(`${borrower.nickname || 'Player'} paid $${payment} toward a default claim.`);
  return { success: true, contractId, paid: payment, remaining: claim.remaining, status: claim.status };
}

// The deterministic recovery path the ledger promises, and the only production
// caller of settleDefaultClaim. The two table debt beats sweep it: the
// contract processor's default path (handlePlayerLoanDefault) and the
// bankruptcy ladder (bankruptcyApi.handleBankruptcy). Claims are paid oldest
// first, and only from the round after they were filed, so the defaulting
// round records the debt instead of charging it. A claim is paid in full or
// not at all: a seat whose cash cannot cover the whole remaining balance keeps
// it, so a recorded claim can never push a survivor into bankruptcy, and the
// transfer moves cash between two seats without minting or destroying any.
// Claims whose borrower or lender has left the table stay open forever as the
// write-off record they were filed as.
export function settleDefaultClaims(game) {
  const round = Math.max(0, Math.floor(Number(game.roundNumber) || 0));
  const matured = (game.defaultClaims || []).filter(claim => claim.status === 'open' && Number(claim.createdRound) < round);
  return matured.reduce((settled, claim) => {
    const result = settleDefaultClaim(game, claim.contractId);
    return result.success ? settled + 1 : settled;
  }, 0);
}

// Both sides of a maturing player loan hear about it in the feed.
export function announceLoanDue(game, contract, borrower) {
  borrower.loanWarningSeen = true;
  game.feedMessage(borrower.nickname + ' owes $' + contract.remaining + ' on a player loan.');
  const lender = game.getPlayerById(contract.fromPlayerId);
  if (!lender) return;
  game.feedMessage(lender.nickname + ' is owed $' + contract.remaining + ' by ' + borrower.nickname + '.');
}

// Share percentages are clamped 5-100 at proposal, but stored tiles can
// predate that (or arrive from a hand-edited file): a non-finite or
// non-positive share must never reach the cash arithmetic as NaN.
// Equity stays payable while its contract is live: an active agreement,
// or a converted hybrid note whose debt leg ended but whose equity leg
// still earns. (Mirrors equityShareContractLive in contractLogic.js; kept
// local because that module imports from this one.)
function equityShareContractLive(contract) {
  if (contract.status === 'active') return true;
  return contract.status === 'converted';
}

function payableEquityContract(game, share) {
  const contract = game.playerContractById(share.contractId);
  if (!contract) return null;
  if (!equityShareContractLive(contract)) return null;
  return contract;
}

function payableEquityHolder(game, share) {
  const holder = game.getPlayerById(share.holderId);
  if (!holder) return null;
  if (holder.bankrupt) return null;
  return holder;
}

export function equitySharePayable(game, share) {
  const contract = payableEquityContract(game, share);
  if (!contract) return null;
  const holder = payableEquityHolder(game, share);
  if (!holder) return null;
  const sharePct = Number(share.share);
  if (!Number.isFinite(sharePct)) return null;
  if (sharePct <= 0) return null;
  return { contract, holder, sharePct: Math.min(100, sharePct) };
}

// The bank files a claim instead of eliminating the seat outright: the
// player now chooses between raising funds and declaring bankruptcy (the
// debt settlement path handles both).
export function handleDebtSettlement(game, player, creditor) {
  // Compatibility entry point for older callers. A debt is a temporary
  // payment state; choosing bankruptcy always uses the authoritative
  // elimination/spectator settlement path.
  return game.handleBankruptcy(player, creditor);
}

export function resolveUnsecuredBankDefault(game, player, loan) {
  game.feedMessage(`${player.nickname} defaulted on an unsecured bank loan.`);
  const owed = Math.max(0, Math.floor(Number(loan.remaining) || 0));
  if (owed <= 0) return;
  if (player.cash >= owed) {
    player.cash -= owed;
    game.feedMessage(`${player.nickname} paid the bank $${owed} on default.`);
    return;
  }
  game.openDebtSettlement({
    player,
    creditor: null,
    amount: owed,
    message: 'The bank calls in a defaulted loan.',
    turnOptions: {},
    hooks: {}
  });
}
