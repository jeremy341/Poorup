// Player-contract lifecycle rules: proposal guards, term drafting, the
// accept/decline settlement, repayments, and the round-by-round due/expiry
// ladder. Pure module: it only mutates the GameState it is handed, so the
// rules stay testable in isolation and the strings stay pinned by
// server/contracts-market.test.js.
import crypto from 'crypto';
import {
  announceLoanDue,
  contractSettlementRejection,
  equitySharePayable,
  handlePlayerLoanDefault
} from './bankruptcyLogic.js';

export const CONTRACT_KINDS = new Set(['loan', 'equity']);
export const EQUITY_CONTROL_MODES = new Set(['passive', 'shared', 'controlling']);
const ACTIVE_CONTRACT_STATUSES = ['active', 'due'];
const TABLE_OBLIGATION_FIELDS = [
  'pendingPayment',
  'auction',
  'pendingPurchaseOffer',
  'pendingTrade',
  'pendingPlayerContract'
];

function activeSeat(player) {
  if (player.bankrupt) return false;
  if (player.disconnected) return false;
  return true;
}

function isPairOfActivePlayers(fromPlayer, toPlayer) {
  if (!fromPlayer) return false;
  if (!toPlayer) return false;
  if (fromPlayer.id === toPlayer.id) return false;
  if (!activeSeat(fromPlayer)) return false;
  return activeSeat(toPlayer);
}

function tableObligationOpen(game) {
  return TABLE_OBLIGATION_FIELDS.some(field => Boolean(game[field]));
}

function lenderCanFund(lender, amount) {
  if (!Number.isInteger(amount)) return false;
  if (amount < 1) return false;
  return lender.cash >= amount;
}

// Guard order and wording are pinned by server/contracts-market.test.js.
export function contractProposalRejection(game, fromPlayer, toPlayer, amount) {
  if (!isPairOfActivePlayers(fromPlayer, toPlayer)) return { success: false, error: 'Choose two active players.' };
  if (fromPlayer.id !== game.currentPlayerId) return { success: false, error: 'Player contracts are proposed during your turn.' };
  if (tableObligationOpen(game)) return { success: false, error: 'Resolve the current table obligation first.' };
  if (!lenderCanFund(fromPlayer, amount)) return { success: false, error: 'The lender does not have enough cash for that offer.' };
  if (game.hasLoanBackedCash(fromPlayer)) return { success: false, error: 'Loan-backed cash cannot be used for player contracts.' };
  return null;
}

function normalizeContractOffer(offer) {
  return {
    kind: CONTRACT_KINDS.has(String(offer.kind)) ? String(offer.kind) : 'loan',
    amount: Math.floor(Number(offer.amount)),
    requestId: String(offer.requestId || '').trim().slice(0, 100),
    durationRounds: Math.max(1, Math.min(20, Math.floor(Number(offer.durationRounds) || 3))),
    premiumRate: Math.max(0, Math.min(100, Number(offer.premiumRate) || 0))
  };
}

function transactionKey(prefix, playerId, requestId) {
  if (!requestId) return null;
  return `${playerId}:${prefix}:${requestId}`;
}

function memoizedResult(game, key) {
  if (!key) return undefined;
  return game.contractTransactions.get(key);
}

function memoizeSuccess(game, key, result) {
  if (!key) return result;
  if (!result.success) return result;
  game.contractTransactions.set(key, result);
  return result;
}

function draftContract(game, terms) {
  return {
    id: 'contract_' + crypto.randomUUID(),
    kind: terms.kind,
    fromPlayerId: terms.fromPlayer.id,
    toPlayerId: terms.toPlayer.id,
    amount: terms.amount,
    premiumRate: terms.premiumRate,
    durationRounds: terms.durationRounds,
    createdRound: game.roundNumber,
    status: 'pending',
    collateralTileIndex: null,
    equityShare: 0,
    equityControl: 'passive'
  };
}

function collateralIsBorrowerDeed(game, collateral, borrower) {
  if (!collateral) return true;
  if (collateral.ownerId !== borrower.id) return false;
  return game.isTradeableTile(collateral);
}

// Term builders mutate the draft contract and return null, or return the
// rejection when the loan/equity specifics are invalid.
function loanDraftTerms(game, contract, offer, borrower) {
  const collateralIndex = offer.collateralTileIndex == null ? null : Number(offer.collateralTileIndex);
  const collateral = collateralIndex == null ? null : game.getTile(collateralIndex);
  if (!collateralIsBorrowerDeed(game, collateral, borrower)) {
    return { success: false, error: 'Collateral must be an unencumbered deed owned by the borrower.' };
  }
  contract.totalDue = contract.amount + Math.ceil(contract.amount * (contract.premiumRate / 100));
  contract.remaining = contract.totalDue;
  contract.dueRound = game.roundNumber + contract.durationRounds;
  contract.cureRound = contract.dueRound + 1;
  contract.collateralTileIndex = collateral?.index ?? null;
  return null;
}

function isEquityEligibleProperty(property, ownerId) {
  if (!property) return false;
  if (property.type !== 'property') return false;
  if (property.ownerId !== ownerId) return false;
  if (property.mortgaged) return false;
  return !(property.houseCount > 0);
}

function equityCapReached(property, share) {
  const existingShare = (property.equityShares || []).reduce((sum, entry) => sum + Number(entry.share || 0), 0);
  return existingShare + share > 100;
}

function equityDraftTerms(game, contract, offer, recipient) {
  const property = game.getTile(Number(offer.propertyIndex));
  const share = Math.max(5, Math.min(100, Math.floor(Number(offer.equityShare) || 5)));
  if (!isEquityEligibleProperty(property, recipient.id)) {
    return { success: false, error: 'Equity needs an unencumbered property owned by the recipient.' };
  }
  if (equityCapReached(property, share)) {
    return { success: false, error: 'That property has no remaining equity to sell.' };
  }
  contract.propertyIndex = property.index;
  contract.equityShare = share;
  contract.equityControl = EQUITY_CONTROL_MODES.has(offer.equityControl) ? offer.equityControl : 'passive';
  contract.expiresRound = offer.permanent ? null : game.roundNumber + contract.durationRounds;
  return null;
}

export function proposeContract(game, socketId, offer = {}) {
  const fromPlayer = game.getPlayerBySocket(socketId);
  const toPlayer = game.getPlayerById(offer.toPlayerId);
  const normalized = normalizeContractOffer(offer);
  const key = transactionKey('contract', fromPlayer?.id, normalized.requestId);
  const cached = memoizedResult(game, key);
  if (cached) return cached;
  const rejection = contractProposalRejection(game, fromPlayer, toPlayer, normalized.amount);
  if (rejection) return rejection;
  const contract = draftContract(game, {
    fromPlayer,
    toPlayer,
    kind: normalized.kind,
    amount: normalized.amount,
    premiumRate: normalized.premiumRate,
    durationRounds: normalized.durationRounds
  });
  const terms = normalized.kind === 'loan'
    ? loanDraftTerms(game, contract, offer, toPlayer)
    : equityDraftTerms(game, contract, offer, toPlayer);
  if (terms) return terms;
  game.pendingPlayerContract = contract;
  game.feedMessage(fromPlayer.nickname + ' sent a ' + normalized.kind + ' contract to ' + toPlayer.nickname + '.');
  return memoizeSuccess(game, key, { success: true, contract });
}

function responseTargetMatches(player, contract) {
  if (!player) return false;
  if (!contract) return false;
  return contract.toPlayerId === player.id;
}

function lenderCanStillFund(lender, contract) {
  if (!lender) return false;
  if (lender.bankrupt) return false;
  if (lender.disconnected) return false;
  return lender.cash >= contract.amount;
}

function recordEquityShare(game, contract, lender) {
  const property = game.getTile(contract.propertyIndex);
  const holders = property.equityShares || [];
  property.equityShares = [...holders, {
    holderId: lender.id,
    share: contract.equityShare,
    contractId: contract.id,
    control: contract.equityControl
  }];
}

function activateFundedContract(game, contract, lender, player) {
  if (contract.kind === 'equity') recordEquityShare(game, contract, lender);
  lender.cash -= contract.amount;
  player.cash += contract.amount;
  contract.status = 'active';
  contract.acceptedRound = game.roundNumber;
  game.playerContracts.push(contract);
  lender.playerContractIds.push(contract.id);
  player.playerContractIds.push(contract.id);
  game.pendingPlayerContract = null;
  game.feedMessage(lender.nickname + ' and ' + player.nickname + ' activated a ' + contract.kind + ' contract.');
}

function acceptContract(game, player, contract) {
  const lender = game.getPlayerById(contract.fromPlayerId);
  if (!lenderCanStillFund(lender, contract)) {
    game.pendingPlayerContract = null;
    return { success: false, error: 'The lender can no longer fund that contract.' };
  }
  const settlementRejection = contractSettlementRejection(game, player, contract);
  if (settlementRejection) return settlementRejection;
  activateFundedContract(game, contract, lender, player);
  return { success: true, accepted: true, contract };
}

function declineContract(game, player) {
  game.pendingPlayerContract = null;
  game.feedMessage(player.nickname + ' declined the player contract.');
  return { success: true, accepted: false };
}

export function respondContract(game, socketId, accept, requestId = null) {
  const player = game.getPlayerBySocket(socketId);
  const key = transactionKey('contract-response', player?.id, requestId ? String(requestId).slice(0, 100) : null);
  const cached = memoizedResult(game, key);
  if (cached) return cached;
  const contract = game.pendingPlayerContract;
  if (!responseTargetMatches(player, contract)) return { success: false, error: 'No matching player contract was found.' };
  const result = accept ? acceptContract(game, player, contract) : declineContract(game, player);
  return memoizeSuccess(game, key, result);
}

function repayableLoan(contract, borrower) {
  if (!borrower) return false;
  if (!contract) return false;
  if (contract.kind !== 'loan') return false;
  if (contract.toPlayerId !== borrower.id) return false;
  return ACTIVE_CONTRACT_STATUSES.includes(contract.status);
}

function repaymentAmount(contract, amount) {
  const requested = amount == null ? contract.remaining : Math.floor(Number(amount));
  return Math.min(Math.max(0, requested), contract.remaining);
}

export function repayContract(game, socketId, payload = {}) {
  const { contractId, amount, requestId } = payload;
  const borrower = game.getPlayerBySocket(socketId);
  const key = transactionKey('contract-repay', borrower?.id, requestId ? String(requestId).slice(0, 100) : null);
  const cached = memoizedResult(game, key);
  if (cached) return cached;
  const contract = game.playerContractById(contractId);
  if (!repayableLoan(contract, borrower)) return { success: false, error: 'That loan is not available to repay.' };
  const payment = repaymentAmount(contract, amount);
  if (!payment) return { success: false, error: 'You do not have enough cash for that repayment.' };
  if (borrower.cash < payment) return { success: false, error: 'You do not have enough cash for that repayment.' };
  const result = settleLoanRepayment(game, contract, borrower, payment);
  return memoizeSuccess(game, key, result);
}

function settleLoanRepayment(game, contract, borrower, payment) {
  const lender = game.getPlayerById(contract.fromPlayerId);
  borrower.cash -= payment;
  if (lender) lender.cash += payment;
  contract.remaining -= payment;
  if (contract.remaining <= 0) {
    contract.remaining = 0;
    contract.status = 'paid';
    contract.paidRound = game.roundNumber;
  }
  game.feedMessage(borrower.nickname + ' repaid $' + payment + ' on a player loan.');
  return { success: true, contract };
}

function equityContractExpired(game, contract) {
  if (contract.kind !== 'equity') return false;
  if (contract.status !== 'active') return false;
  if (!contract.expiresRound) return false;
  return game.roundNumber >= contract.expiresRound;
}

function expireEquityContract(game, contract) {
  if (!equityContractExpired(game, contract)) return false;
  const property = game.getTile(contract.propertyIndex);
  if (property) {
    property.equityShares = (property.equityShares || []).filter(entry => entry.contractId !== contract.id);
  }
  contract.status = 'expired';
  return true;
}

function handleDueLoanContract(game, contract) {
  if (game.roundNumber <= contract.cureRound) return;
  handlePlayerLoanDefault(game, contract);
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

function processContract(game, contract) {
  if (expireEquityContract(game, contract)) return;
  advanceLoanContract(game, contract);
}

export function processContracts(game) {
  game.playerContracts.forEach(contract => processContract(game, contract));
}

export function settleEquityShares(game, tile, owner, amountPaid) {
  if (!tile?.equityShares?.length) return;
  if (!owner) return;
  if (owner.bankrupt) return;
  if (amountPaid <= 0) return;
  tile.equityShares.forEach(share => settleEquityPayout(game, owner, share, amountPaid));
}

function settleEquityPayout(game, owner, share, amountPaid) {
  const payable = equitySharePayable(game, share);
  if (!payable) return;
  const payout = Math.min(owner.cash, Math.floor(amountPaid * (payable.sharePct / 100)));
  if (payout <= 0) return;
  owner.cash -= payout;
  payable.holder.cash += payout;
  payable.contract.rentCollected = (payable.contract.rentCollected || 0) + payout;
}

function contractNames(game, contract) {
  const nameFor = id => game.getPlayerById(id)?.nickname || 'PLAYER';
  return { fromPlayerName: nameFor(contract.fromPlayerId), toPlayerName: nameFor(contract.toPlayerId) };
}

function contractBelongsToViewer(contract, viewerPlayerId) {
  if (!viewerPlayerId) return false;
  if (contract.fromPlayerId === viewerPlayerId) return true;
  return contract.toPlayerId === viewerPlayerId;
}

function projectContract(game, contract, viewerPlayerId) {
  const names = contractNames(game, contract);
  if (contractBelongsToViewer(contract, viewerPlayerId)) return { ...contract, ...names };
  return { id: contract.id, kind: contract.kind, status: contract.status, createdRound: contract.createdRound, ...names };
}

export function playerContractSummary(game, viewerPlayerId = null) {
  const pending = game.pendingPlayerContract
    ? projectContract(game, game.pendingPlayerContract, viewerPlayerId)
    : null;
  const active = game.playerContracts
    .filter(contract => ACTIVE_CONTRACT_STATUSES.includes(contract.status))
    .map(contract => projectContract(game, contract, viewerPlayerId));
  return { pending, active };
}
