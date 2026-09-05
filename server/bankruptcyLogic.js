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

function loanCollateralRejection(game, player, contract) {
  if (contract.kind !== 'loan') return null;
  if (contract.collateralTileIndex == null) return null;
  const collateral = game.getTile(contract.collateralTileIndex);
  if (!deedStillHeldBy(collateral, player.id)) return rejectContract(game, 'The loan collateral is no longer available.');
  if (!game.isTradeableTile(collateral)) return rejectContract(game, 'The loan collateral is no longer available.');
  return null;
}

function equityContractRejection(game, player, contract) {
  const property = game.getTile(contract.propertyIndex);
  if (!deedStillHeldBy(property, player.id)) return rejectContract(game, 'The equity property is no longer available.');
  const existingShare = (property.equityShares || []).reduce((sum, entry) => sum + Number(entry.share || 0), 0);
  if (existingShare + contract.equityShare > 100) return rejectContract(game, 'The property has no remaining equity.');
  return null;
}

// Re-validate contract security at settlement time: pledged deeds can be
// sold, mortgaged, or lost between proposal and acceptance, and the payer
// must not fund against vanished security.
export function contractSettlementRejection(game, player, contract) {
  if (contract.kind === 'equity') return equityContractRejection(game, player, contract);
  return loanCollateralRejection(game, player, contract);
}

// Bankruptcy is the player's decision, not the server's verdict. These are
// the only three ways the table can refuse a voluntary exit.
export function bankruptcyRefusal(game, player) {
  if (!player) return { success: false, error: 'Player not found.' };
  if (!game.started) return { success: false, error: 'The game has not started.' };
  if (player.bankrupt) return { success: false, error: 'That player is already out of the game.' };
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
  if (game.pendingPurchaseOffer?.playerId === player.id) game.pendingPurchaseOffer = null;
  QUIT_OBLIGATIONS.forEach(({ key, suffix }) => {
    const obligation = game[key];
    if (!obligation) return;
    if (!involvesPlayer(obligation, player.id)) return;
    game[key] = null;
    game.feedMessage(`${player.nickname} left the table. ${suffix}`);
  });
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
export function equitySharePayable(game, share) {
  const contract = game.playerContractById(share.contractId);
  if (!contract) return null;
  if (contract.status !== 'active') return null;
  const holder = game.getPlayerById(share.holderId);
  if (!holder) return null;
  if (holder.bankrupt) return null;
  const sharePct = Number(share.share);
  if (!Number.isFinite(sharePct)) return null;
  if (sharePct <= 0) return null;
  return { contract, holder, sharePct };
}

// The bank files a claim instead of eliminating the seat outright: the
// player now chooses between raising funds and declaring bankruptcy (the
// debt settlement path handles both).
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
