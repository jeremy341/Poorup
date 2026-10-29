// Player-contract lifecycle rules: proposal guards, term drafting, accept and decline settlement, repayments, and the
// round-by-round due and expiry ladder. Pure: it only mutates the GameState it is handed, so the rules stay testable.
// The strings stay pinned by server/contracts-market.test.js.
import crypto from 'crypto';
import { playerFinanceEnabled } from './financeRules.js';
import { collateralQuoteFor, stampCollateralAgreement, usesCollateralCredit } from './collateralSettlement.js';
import { CONTRACT_RULES_VERSION, RENT_SHARE_VERSION, FINANCE_DISABLED_ERROR, LEGACY_PENDING_ERROR, isRentShareContract, rentShareDeedType, newContractTermsError, deedHasShareInterest } from './rentShareRules.js';
import { contractPledgesTile } from './gameLogic.js';
import {
  announceLoanDue,
  canRecordDefaultClaim,
  contractSettlementRejection,
  equitySharePayable,
  handlePlayerLoanDefault
} from './bankruptcyLogic.js';
import { normalizeRequestId } from './requestId.js';
import { AUCTION_COMMITTED_CASH_ERROR } from './auctionApi.js';

export const CONTRACT_KINDS = new Set(['loan', 'equity']);
export const EQUITY_CONTROL_MODES = new Set(['passive']);
const ACTIVE_CONTRACT_STATUSES = ['active', 'due'];
// A finished match owns no contracts: endGame closes the table, clears pending offers, and leaves contracts and equity shares behind.
// Every contract verb refuses once the game is not running, before the replay cache, so a retried request cannot
// resurrect a closed table.
const GAME_NOT_RUNNING_ERROR = 'The game is not running.';
// A funded contract that cannot be committed leaves the table exactly as it
// was: no cash moved, no contract booked, the offer still open.
const CONTRACT_ACTIVATION_FAILED = 'The contract could not be activated; no cash moved.';
const TABLE_OBLIGATION_FIELDS = [
  'auction',
  'pendingPurchaseOffer',
  'pendingSponsoredPurchase',
  'pendingTrade',
  'pendingPlayerContract'
];
const MAX_CONTRACT_REPLAYS = 1_000;

export { normalizeRequestId } from './requestId.js';

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

// A match that is not running owns no contracts. Every contract verb returns the same rejection before reading the request,
// so a closed table cannot be reopened, and a retried request cannot replay its way past the guard.
function contractVerbRejection(game) {
  if (game?.started) return null;
  return { success: false, error: GAME_NOT_RUNNING_ERROR };
}

// A cash inflow can be the missing piece of the recipient's own parked debt: the seat was gated on a claim it could not cover,
// and the incoming cash may cover it now. Every contract cash inflow (transfer price, loan repayment, equity rent share)
// retries that claim here, as the rent, trade and bankruptcy paths do.
function settleRecipientParkedDebt(game, recipient) {
  if (!recipient) return;
  if (game.pendingPayment?.playerId !== recipient.id) return;
  if (typeof game.settleCreditorParkedDebt === 'function') {
    game.settleCreditorParkedDebt(recipient);
    return;
  }
  if (typeof game.trySettlePendingPayment === 'function') game.trySettlePendingPayment();
}

// Guard order and wording are pinned by server/contracts-market.test.js.
export function contractProposalRejection(game, fromPlayer, toPlayer, amount) {
  if (!isPairOfActivePlayers(fromPlayer, toPlayer)) return { success: false, error: 'Choose two active players.' };
  if (tableObligationOpen(game)) return { success: false, error: 'Resolve the current table obligation first.' };
  if (!lenderCanFund(fromPlayer, amount)) return { success: false, error: 'The lender does not have enough cash for that offer.' };
  if (game.hasLoanBackedCash(fromPlayer)) return { success: false, error: 'Loan-backed cash cannot be used for player contracts.' };
  return null;
}

function normalizeContractOffer(offer) {
  return {
    kind: CONTRACT_KINDS.has(String(offer.kind)) ? String(offer.kind) : 'loan',
    amount: Math.floor(Number(offer.amount)),
    requestId: normalizeRequestId(offer.requestId),
    durationRounds: Math.max(1, Math.min(20, Math.floor(Number(offer.durationRounds) || 3))),
    premiumRate: Math.max(0, Math.min(100, Number(offer.premiumRate) || 0)),
    conversionShare: Math.max(5, Math.min(100, Math.floor(Number(offer.conversionShare) || 25)))
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
  while (game.contractTransactions.size > MAX_CONTRACT_REPLAYS) {
    game.contractTransactions.delete(game.contractTransactions.keys().next().value);
  }
  return result;
}

function draftContract(game, terms) {
  return {
    id: 'contract_' + crypto.randomUUID(),
    rulesVersion: CONTRACT_RULES_VERSION,
    kind: terms.kind,
    fromPlayerId: terms.fromPlayer.id,
    toPlayerId: terms.toPlayer.id,
    amount: terms.amount,
    premiumRate: terms.premiumRate,
    durationRounds: terms.durationRounds,
    createdRound: game.roundNumber,
    createdAt: Date.now(),
    status: 'pending',
    counterDepth: 0,
    collateralTileIndex: null,
    collateralTileIndices: [],
    equityShare: 0,
    equityControl: 'passive',
    conversionShare: 0
  };
}

function suppliedCollateralIndices(offer) {
  if (offer.collateralTileIndices != null && !Array.isArray(offer.collateralTileIndices)) return null;
  if (Array.isArray(offer.collateralTileIndices)) return offer.collateralTileIndices;
  if (offer.collateralTileIndex == null) return [];
  return [offer.collateralTileIndex];
}

function normalizedCollateralIndices(game, supplied) {
  const indices = [];
  for (const value of supplied) {
    const index = Number(value);
    if (!Number.isInteger(index) || !game.getTile(index)) return null;
    if (indices.includes(index)) continue;
    indices.push(index);
  }
  return indices;
}

function collateralIndicesForOffer(game, offer) {
  const supplied = suppliedCollateralIndices(offer);
  if (!supplied) return null;
  const maximum = Math.min(Array.isArray(game.tiles) ? game.tiles.length : 0, 52);
  if (supplied.length > maximum) return null;
  return normalizedCollateralIndices(game, supplied);
}

function validateTransferPlayers(context) {
  if (isPairOfActivePlayers(context.seller, context.buyer)) return null;
  return { error: 'Choose two active players.' };
}

// The deed owner already books 100% of rent on the tile; buying their own
// deed's equity would pay the seller twice for the same rent and permanently
// lock the tile against trades and mortgages via its equityShares entry.
function validateTransferBuyerNotOwner(context) {
  if (context.buyer.id === context.tile.ownerId) {
    return { error: 'The property owner cannot buy equity in their own deed.' };
  }
  return null;
}

function resolveTransferSource(context) {
  const source = context.game.playerContractById(context.sourceContractId);
  if (!source) return { error: 'That equity share is no longer available.' };
  if (!['equity', 'hybrid'].includes(source.kind)) return { error: 'That equity share is no longer available.' };
  if (!equityShareContractLive(source)) return { error: 'That equity share is no longer available.' };
  if (isRentShareContract(source)) return { error: 'Temporary rent shares cannot be resold or transferred.' };
  context.source = source;
  return null;
}

function transferSourceExpired(context) {
  const { game, source } = context;
  if (source.kind !== 'equity') return false;
  if (source.permanent || !source.expiresRound) return false;
  return game.roundNumber >= source.expiresRound;
}

function resolveTransferTile(context) {
  const tile = context.game.getTile(Number(context.source.propertyIndex));
  if (!tile) return { error: 'That property cannot transfer equity right now.' };
  if (tile.ownerId !== context.source.toPlayerId) return { error: 'That property cannot transfer equity right now.' };
  if (tile.type !== 'property') return { error: 'That property cannot transfer equity right now.' };
  if (tile.mortgaged) return { error: 'That property cannot transfer equity right now.' };
  if (Number(tile.houseCount) > 0) return { error: 'That property cannot transfer equity right now.' };
  context.tile = tile;
  return null;
}

function verifiedEquityShareEntry(source, tile, seller) {
  const sourceShare = Number(source.equityShare || source.conversionShare);
  const entry = (tile.equityShares || []).find(item => item.contractId === source.id && item.holderId === seller.id);
  if (!entry) return { error: 'That equity share is no longer available.' };
  if (!Number.isFinite(sourceShare)) return { error: 'That equity share is no longer available.' };
  if (Number(entry.share) !== sourceShare) return { error: 'That equity share is no longer available.' };
  return { sourceShare, entry };
}

function resolveTransferEntry(context) {
  const { game, seller, source, tile } = context;
  if (source.fromPlayerId !== seller.id) return { error: 'You do not own that equity share.' };
  const owner = game.getPlayerById(source.toPlayerId);
  if (!activeSeat(owner)) return { error: 'The property owner is no longer available.' };
  const verifiedEntry = verifiedEquityShareEntry(source, tile, seller);
  if (verifiedEntry.error) return verifiedEntry;
  const { sourceShare, entry } = verifiedEntry;
  context.sourceShare = sourceShare;
  context.entry = entry;
  return null;
}

function equityTransferCapacityError(context) {
  const shares = context.tile.equityShares || [];
  const buyerShare = shares.filter(item => item.holderId === context.buyer.id)
    .reduce((sum, item) => sum + Math.max(0, Number(item.share) || 0), 0);
  const totalShare = shares.reduce((sum, item) => sum + Math.max(0, Number(item.share) || 0), 0);
  if (buyerShare + context.sharePct > 100) return { error: 'That property has no remaining equity to transfer.' };
  if (totalShare > 100) return { error: 'That property has no remaining equity to transfer.' };
  return null;
}

function equityTransferContext(context) {
  const validators = [
    validateTransferPlayers,
    resolveTransferSource,
    validateTransferExpiry,
    resolveTransferTile,
    resolveTransferEntry,
    validateTransferBuyerNotOwner,
    validateTransferAmount,
    equityTransferCapacityError,
    validateTransferBuyerCash,
    validateTransferBuyerTaint,
  ];
  for (const validate of validators) {
    const result = validate(context);
    if (result) return result;
  }
  return { source: context.source, tile: context.tile, entry: context.entry };
}

function validateTransferExpiry(context) {
  if (transferSourceExpired(context)) return { error: 'That equity share has expired.' };
  return null;
}

function validateTransferAmount(context) {
  if (!Number.isInteger(context.sharePct)) return { error: 'Enter a valid share amount.' };
  if (context.sharePct < 5 || context.sharePct > context.sourceShare) return { error: 'Enter a valid share amount.' };
  if (!Number.isInteger(context.price) || context.price < 1) return { error: 'Enter a whole-dollar transfer price.' };
  return null;
}

function validateTransferBuyerCash(context) {
  if (context.buyer.cash < context.price) return { error: 'The buyer does not have enough cash for that transfer.' };
  return null;
}

// Equity transfers are player contracts in every other sense (kind 'equity-transfer', pendingPlayerContract obligation, settlement guards).
// The documented loan-taint scope "casino, contract, and market guards" covers them, so loan-backed cash must not fund the purchase.
// Checked at proposal, counters and acceptance, because settleEquityTransfer re-runs this validator list.
function validateTransferBuyerTaint(context) {
  if (context.game.hasLoanBackedCash?.(context.buyer)) {
    return { error: 'Loan-backed cash cannot fund equity transfers.' };
  }
  return null;
}

export function proposeEquityShareTransfer(game, socketId, offer = {}) {
  const startedRejection = contractVerbRejection(game);
  if (startedRejection) return startedRejection;
  if (!playerFinanceEnabled(game)) return { success: false, error: FINANCE_DISABLED_ERROR };
  const seller = game.getPlayerBySocket(socketId);
  const buyer = game.getPlayerById(offer.toPlayerId);
  if (!seller || seller.id !== offer.fromPlayerId) return { success: false, error: 'Choose a valid equity seller.' };
  const key = transactionKey('equity-transfer', seller.id, normalizeRequestId(offer.requestId));
  const cached = memoizedResult(game, key);
  if (cached) return cached.transfer?.rulesVersion === CONTRACT_RULES_VERSION ? cached : { success: false, error: LEGACY_PENDING_ERROR };
  if (tableObligationOpen(game)) return { success: false, error: 'Resolve the current table obligation first.' };
  const sharePct = Math.floor(Number(offer.sharePct));
  const price = Math.floor(Number(offer.price));
  const ctx = equityTransferContext({ game, seller, buyer, sourceContractId: offer.contractId, sharePct, price });
  if (ctx.error) return { success: false, error: ctx.error };
  const transfer = {
    id: 'contract_' + crypto.randomUUID(), rulesVersion: CONTRACT_RULES_VERSION, kind: 'equity-transfer',
    fromPlayerId: seller.id, toPlayerId: buyer.id, propertyIndex: ctx.tile.index,
    sourceContractId: ctx.source.id, transferSharePct: sharePct, transferPrice: price,
    amount: price, equityShare: sharePct, equityControl: 'passive',
    permanent: ctx.source.permanent === true, expiresRound: ctx.source.expiresRound ?? null,
    requestId: normalizeRequestId(offer.requestId),
    createdRound: game.roundNumber, createdAt: Date.now(), status: 'pending', counterDepth: 0, lastProposerId: seller.id
  };
  game.pendingPlayerContract = transfer;
  return memoizeSuccess(game, key, { success: true, transfer });
}

function equityTransferOffer(game, current, offer = {}, counteredBy) {
  const seller = game.getPlayerById(current.fromPlayerId);
  const buyer = game.getPlayerById(current.toPlayerId);
  const sharePct = Math.floor(Number(offer.sharePct ?? current.transferSharePct));
  const price = Math.floor(Number(offer.price ?? current.transferPrice));
  const ctx = equityTransferContext({ game, seller, buyer, sourceContractId: current.sourceContractId, sharePct, price });
  if (ctx.error) return { success: false, error: ctx.error };
  const next = {
    ...current, transferSharePct: sharePct, equityShare: sharePct,
    transferPrice: price, amount: price,
    counterDepth: Math.min(2, (Number(current.counterDepth) || 0) + 1),
    createdAt: Date.now(),
    lastProposerId: counteredBy
  };
  game.pendingPlayerContract = next;
  return { success: true, countered: true, contract: next };
}

// An unanswered offer gates trades, the market, the casino and bank credit for
// the whole table, so it lapses after a fixed window (the contract twin of
// tradeApi.expireStaleTrade). Returns true when it expired.
export function expireStaleContract(game, nowMs, ttlMs) {
  const contract = game.pendingPlayerContract;
  if (!contract) return false;
  const created = Number(contract.createdAt);
  if (!Number.isFinite(created)) return false;
  if (nowMs - created < ttlMs) return false;
  game.pendingPlayerContract = null;
  game.feedMessage('A pending player contract offer expired.');
  return true;
}

function staleContractOffer(offer, current) {
  if (!offer.contractId || offer.contractId === current.id) return null;
  return { success: false, error: 'That contract offer is no longer current.' };
}

function contractAtNegotiationLimit(current) {
  return Number(current.counterDepth) >= 2;
}

function negotiationLimitRejection() {
  return { success: false, error: 'This contract has reached its negotiation limit.' };
}

function adjustEquityTransfer(game, current, offer, editor) {
  if (contractAtNegotiationLimit(current)) return negotiationLimitRejection();
  const result = equityTransferOffer(game, current, offer, editor.id);
  if (!result.success) return result;
  return { ...result, countered: undefined, adjusted: true };
}

function negotiatedContractTerms({ game, current, offer, actor, negotiationType }) {
  const lender = game.getPlayerById(current.fromPlayerId);
  const borrower = game.getPlayerById(current.toPlayerId);
  const merged = { ...current, ...offer };
  const termError = newContractTermsError(merged);
  if (termError) return { success: false, error: termError };
  const normalized = normalizeContractOffer(merged);
  const rejection = contractProposalRejectionWithoutTurn(game, lender, borrower, normalized.amount);
  if (rejection) return rejection;
  const contract = draftContract(game, {
    fromPlayer: lender,
    toPlayer: borrower,
    kind: normalized.kind,
    amount: normalized.amount,
    premiumRate: normalized.premiumRate,
    durationRounds: normalized.durationRounds
  });
  const buildTerms = TERM_BUILDERS[normalized.kind] || equityDraftTerms;
  const previousPending = game.pendingPlayerContract;
  game.pendingPlayerContract = null;
  let terms;
  try {
    terms = buildTerms(game, contract, { ...current, ...offer }, borrower);
  } finally {
    game.pendingPlayerContract = previousPending;
  }
  if (terms) return terms;
  contract.counterDepth = Math.min(2, (Number(current.counterDepth) || 0) + 1);
  // Whoever authored the surviving terms is the last proposer, so the decision passes to the other seat. Without this the
  // responder falls back to counterDepth parity, which points back at the editor when one seat negotiates twice in a row,
  // and the author could accept their own terms.
  contract.lastProposerId = actor.id;
  game.pendingPlayerContract = contract;
  game.feedMessage(actor.nickname + (negotiationType === 'counter' ? ' negotiated the ' : ' adjusted the ')
    + normalized.kind + ' contract terms.');
  if (negotiationType === 'counter') return { success: true, countered: true, contract };
  return { success: true, adjusted: true, contract };
}

function equityTransferSourceShareKey(source) {
  if (source.kind !== 'hybrid') return 'equityShare';
  if (source.status === 'converted' || source.equityShare == null) return 'conversionShare';
  return 'equityShare';
}

function equityTransferSnapshot({ game, seller, buyer, owner, source, tile, entry, sourceShareKey }) {
  return {
    sellerCash: seller.cash,
    buyerCash: buyer.cash,
    sourceShare: source[sourceShareKey],
    sourceStatus: source.status,
    sourceTerminatedRound: source.terminatedRound,
    sourceEntryShare: entry.share,
    pending: game.pendingPlayerContract,
    contracts: [...game.playerContracts],
    sellerIds: [...seller.playerContractIds],
    buyerIds: [...buyer.playerContractIds],
    shares: [...tile.equityShares],
    ownerIds: [...(owner?.playerContractIds || [])],
  };
}

function terminateEmptySourceShare({ game, source, tile, entry, sourceShareKey }) {
  if (source[sourceShareKey] !== 0) return;
  source.status = 'terminated';
  source.terminatedRound = game.roundNumber;
  tile.equityShares = tile.equityShares.filter(item => item !== entry);
}

function createTransferredEquityContract({ game, transfer, buyer, source, tile }) {
  return {
    id: 'contract_' + crypto.randomUUID(), kind: 'equity',
    fromPlayerId: buyer.id, toPlayerId: source.toPlayerId, amount: transfer.transferPrice,
    propertyIndex: tile.index, equityShare: transfer.transferSharePct, equityControl: 'passive',
    permanent: source.permanent === true, expiresRound: source.expiresRound ?? null,
    durationRounds: source.durationRounds, createdRound: game.roundNumber,
    acceptedRound: game.roundNumber, status: 'active', transferredFromContractId: source.id,
  };
}

function applyEquityTransferSettlement({ game, transfer, seller, buyer, owner, source, tile, entry }) {
  const sourceShareKey = equityTransferSourceShareKey(source);
  buyer.cash -= transfer.transferPrice;
  seller.cash += transfer.transferPrice;
  source[sourceShareKey] -= transfer.transferSharePct;
  entry.share -= transfer.transferSharePct;
  terminateEmptySourceShare({ game, source, tile, entry, sourceShareKey });
  const contract = createTransferredEquityContract({ game, transfer, buyer, source, tile });
  game.playerContracts.push(contract);
  buyer.playerContractIds.push(contract.id);
  owner.playerContractIds.push(contract.id);
  tile.equityShares.push({ holderId: buyer.id, share: transfer.transferSharePct, contractId: contract.id, control: 'passive' });
  game.pendingPlayerContract = null;
  game.feedMessage(`${seller.nickname} transferred ${transfer.transferSharePct}% equity to ${buyer.nickname} for $${transfer.transferPrice}.`);
  // The seller's share of the price can be the missing piece of the seller's
  // own parked debt, so the inflow retries that claim like every other
  // contract inflow does.
  settleRecipientParkedDebt(game, seller);
  return contract;
}

function restoreSourceTermination(source, before) {
  source.status = before.sourceStatus;
  if (before.sourceTerminatedRound === undefined) delete source.terminatedRound;
  else source.terminatedRound = before.sourceTerminatedRound;
}

function restoreEquityTransferState({ game, seller, buyer, owner, source, tile, entry, sourceShareKey, before }) {
  seller.cash = before.sellerCash;
  buyer.cash = before.buyerCash;
  source[sourceShareKey] = before.sourceShare;
  restoreSourceTermination(source, before);
  entry.share = before.sourceEntryShare;
  game.pendingPlayerContract = before.pending;
  game.playerContracts = before.contracts;
  seller.playerContractIds = before.sellerIds;
  buyer.playerContractIds = before.buyerIds;
  if (owner) owner.playerContractIds = before.ownerIds;
  tile.equityShares = before.shares;
}

function settleEquityTransfer(game, transfer) {
  const seller = game.getPlayerById(transfer.fromPlayerId);
  const buyer = game.getPlayerById(transfer.toPlayerId);
  const check = equityTransferContext({
    game,
    seller,
    buyer,
    sourceContractId: transfer.sourceContractId,
    sharePct: transfer.transferSharePct,
    price: transfer.transferPrice,
  });
  if (check.error) return { success: false, error: check.error };
  const { source, tile, entry } = check;
  const owner = game.getPlayerById(source.toPlayerId);
  const sourceShareKey = equityTransferSourceShareKey(source);
  const before = equityTransferSnapshot({ game, seller, buyer, owner, source, tile, entry, sourceShareKey });
  try {
    const contract = applyEquityTransferSettlement({ game, transfer, seller, buyer, owner, source, tile, entry });
    return { success: true, accepted: true, contract };
  } catch (error) {
    restoreEquityTransferState({ game, seller, buyer, owner, source, tile, entry, sourceShareKey, before });
    return { success: false, error: 'Equity transfer failed; no assets moved.' };
  }
}

function collateralIsBorrowerDeed(game, collateral, borrower) {
  return Boolean(collateral && collateral.ownerId === borrower.id && !collateral.mortgaged && game.isTradeableTile(collateral));
}

function setContractCollateral(contract, collateralIndices) {
  contract.collateralTileIndices = collateralIndices;
  contract.collateralTileIndex = collateralIndices[0] ?? null;
}

function validateCollateralBasket(game, offer, borrower) {
  const indices = collateralIndicesForOffer(game, offer);
  if (!indices) return { error: 'Collateral must be an unencumbered deed owned by the borrower.' };
  for (const index of indices) {
    if (!collateralIsBorrowerDeed(game, game.getTile(index), borrower)) {
      return { error: 'Collateral must be an unencumbered deed owned by the borrower.' };
    }
  }
  return { indices };
}

// Term builders mutate the draft contract and return null, or return the
// rejection when the loan/equity specifics are invalid.
function loanDraftTerms(game, contract, offer, borrower) {
  const basket = validateCollateralBasket(game, offer, borrower);
  if (basket.error) return { success: false, error: basket.error };
  contract.totalDue = contract.amount + Math.ceil(contract.amount * (contract.premiumRate / 100));
  contract.remaining = contract.totalDue;
  contract.dueRound = game.roundNumber + contract.durationRounds;
  contract.cureRound = contract.dueRound + 1;
  setContractCollateral(contract, basket.indices);
  stampCollateralAgreement(game, contract, basket.indices);
  return null;
}

// A deed pledged as live bank-loan or contract collateral is encumbered, whatever its raw fields say. Both checks share
// propertyRules.tileEncumbered with the trade and mortgage surface. ignoredContractId excludes a contract's pledge of its own conversion target:
// a due hybrid encumbers the tile it converts into, while an active one stays open to equity proposals until the 100% capacity rule applies.
function pledgeBlocksEquityEligibility(contract, owner, property) {
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

function isEquityEligibleProperty(game, property, ownerId, ignoredContractId = null) {
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

function equityCapReached(property, share, game = null, ignoredContractId = null) {
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

function rentSharePropertyError(game, contract, owner, ignoredContractId = null) {
  const property = game.getTile(Number(contract.propertyIndex));
  if (!property || !rentShareDeedType(property) || property.ownerId !== owner?.id || property.mortgaged) {
    return 'Rent shares need an unmortgaged deed owned by the recipient.';
  }
  if (game.isLoanCollateral(owner, property)
    || (game.playerContracts || []).some(candidate => candidate.id !== ignoredContractId && pledgeBlocksEquityEligibility(candidate, owner, property))) {
    return 'Rent shares need an unencumbered deed owned by the recipient.';
  }
  if (deedHasShareInterest(game, property, ignoredContractId)) return 'A deed may have only one rent-share investor.';
  return null;
}

function equityDraftTerms(game, contract, offer, recipient) {
  const error = newContractTermsError({ ...offer, kind: 'equity' });
  if (error) return { success: false, error };
  contract.propertyIndex = Number(offer.propertyIndex);
  const propertyError = rentSharePropertyError(game, contract, recipient);
  if (propertyError) return { success: false, error: propertyError };
  contract.rentShareVersion = RENT_SHARE_VERSION;
  contract.equityShare = Math.max(5, Math.min(100, Math.floor(Number(offer.equityShare) || 5)));
  contract.equityControl = 'passive';
  contract.permanent = false;
  contract.expiresRound = game.roundNumber + contract.durationRounds;
  return null;
}

const TERM_BUILDERS = {
  loan: loanDraftTerms,
  equity: equityDraftTerms
};

export function proposeContract(game, socketId, offer = {}) {
  const startedRejection = contractVerbRejection(game);
  if (startedRejection) return startedRejection;
  if (!playerFinanceEnabled(game)) return { success: false, error: FINANCE_DISABLED_ERROR };
  const termError = newContractTermsError(offer);
  if (termError) return { success: false, error: termError };
  const fromPlayer = game.getPlayerBySocket(socketId);
  const toPlayer = game.getPlayerById(offer.toPlayerId);
  const normalized = normalizeContractOffer(offer);
  const key = transactionKey('contract', fromPlayer?.id, normalized.requestId);
  const cached = memoizedResult(game, key);
  if (cached) return cached.contract?.rulesVersion === CONTRACT_RULES_VERSION ? cached : { success: false, error: LEGACY_PENDING_ERROR };
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
  const buildTerms = TERM_BUILDERS[normalized.kind] || equityDraftTerms;
  const terms = buildTerms(game, contract, offer, toPlayer);
  if (terms) return terms;
  game.pendingPlayerContract = contract;
  if (fromPlayer.isBot) fromPlayer.botDealActionsThisTurn = (fromPlayer.botDealActionsThisTurn || 0) + 1;
  game.feedMessage(fromPlayer.nickname + ' sent a ' + normalized.kind + ' contract to ' + toPlayer.nickname + '.');
  return memoizeSuccess(game, key, { success: true, contract });
}

// A negotiation keeps the original lender and borrower, replaces only unaccepted terms, and transfers no cash until the lender accepts.
// It is off-turn for the borrower because it answers an already-open table obligation; the lender-funding guards still run.
export function counterContract(game, socketId, offer = {}) {
  const startedRejection = contractVerbRejection(game);
  if (startedRejection) return startedRejection;
  if (!playerFinanceEnabled(game)) return { success: false, error: FINANCE_DISABLED_ERROR };
  const responder = game.getPlayerBySocket(socketId);
  const current = game.pendingPlayerContract;
  if (current && current.rulesVersion !== CONTRACT_RULES_VERSION
    && (current.kind !== 'loan' || (offer.kind != null && offer.kind !== 'loan'))) {
    return { success: false, error: LEGACY_PENDING_ERROR };
  }
  if (!responseTargetMatches(responder, current)) {
    return { success: false, error: 'Only the receiving player can negotiate this contract.' };
  }
  const staleOffer = staleContractOffer(offer, current);
  if (staleOffer) return staleOffer;
  if (contractAtNegotiationLimit(current)) return negotiationLimitRejection();
  if (current.kind === 'equity-transfer') return equityTransferOffer(game, current, offer, responder.id);
  return negotiatedContractTerms({ game, current, offer, actor: responder, negotiationType: 'counter' });
}

export function adjustContract(game, socketId, offer = {}) {
  const startedRejection = contractVerbRejection(game);
  if (startedRejection) return startedRejection;
  if (!playerFinanceEnabled(game)) return { success: false, error: FINANCE_DISABLED_ERROR };
  const editor = game.getPlayerBySocket(socketId);
  const current = game.pendingPlayerContract;
  if (current && current.rulesVersion !== CONTRACT_RULES_VERSION
    && (current.kind !== 'loan' || (offer.kind != null && offer.kind !== 'loan'))) {
    return { success: false, error: LEGACY_PENDING_ERROR };
  }
  if (!editor) return { success: false, error: 'Only the sending player can adjust this contract.' };
  if (!current) return { success: false, error: 'Only the sending player can adjust this contract.' };
  if (contractLastProposerId(current) !== editor.id) return { success: false, error: 'Only the sending player can adjust this contract.' };
  const staleOffer = staleContractOffer(offer, current);
  if (staleOffer) return staleOffer;
  if (current.kind === 'equity-transfer') return adjustEquityTransfer(game, current, offer, editor);
  if (contractAtNegotiationLimit(current)) return negotiationLimitRejection();
  return negotiatedContractTerms({ game, current, offer, actor: editor, negotiationType: 'adjust' });
}

function contractProposalRejectionWithoutTurn(game, fromPlayer, toPlayer, amount) {
  if (!isPairOfActivePlayers(fromPlayer, toPlayer)) return { success: false, error: 'Choose two active players.' };
  const otherObligationOpen = TABLE_OBLIGATION_FIELDS
    .filter(field => field !== 'pendingPlayerContract')
    .some(field => Boolean(game[field]));
  if (otherObligationOpen) return { success: false, error: 'Resolve the current table obligation first.' };
  if (!lenderCanFund(fromPlayer, amount)) return { success: false, error: 'The lender does not have enough cash for that offer.' };
  if (game.hasLoanBackedCash(fromPlayer)) return { success: false, error: 'Loan-backed cash cannot be used for player contracts.' };
  return null;
}

function responseTargetMatches(player, contract) {
  if (!player) return false;
  if (!contract) return false;
  return contractResponderId(contract) === player.id;
}

// Authoritative negotiation identity: whoever holds lastProposerId acted
// last, so the seat awaiting a decision is contractResponderId. Exported for
// the socket relay layer, which must route offers to the awaiting seat.
export function contractLastProposerId(contract) {
  if (contract?.lastProposerId) return contract.lastProposerId;
  const depth = Math.max(0, Math.floor(Number(contract?.counterDepth) || 0));
  return depth % 2 === 0 ? contract?.fromPlayerId : contract?.toPlayerId;
}

export function contractResponderId(contract) {
  return contractLastProposerId(contract) === contract?.fromPlayerId ? contract?.toPlayerId : contract?.fromPlayerId;
}

function lenderCanStillFund(lender, contract) {
  if (!lender) return false;
  if (lender.bankrupt) return false;
  if (lender.disconnected) return false;
  return lender.cash >= contract.amount;
}

function recordEquityShare(game, contract, lender) {
  const property = game.getTile(contract.propertyIndex);
  const holders = Array.isArray(property.equityShares) ? property.equityShares : [];
  property.equityShares = [...holders, {
    holderId: lender.id,
    share: contract.equityShare,
    contractId: contract.id,
    control: contract.equityControl,
    rentShareVersion: contract.rentShareVersion
  }];
}

// Terms are drafted when the offer is made, but a pending offer can sit through
// several rounds. The term a player agrees to is its length, so the due, cure
// and expiry rounds restart from the round of acceptance.
function anchorTermsToAcceptance(game, contract) {
  const duration = Number(contract.durationRounds);
  if (!Number.isFinite(duration) || duration < 1) return;
  if (contract.kind === 'loan' || contract.kind === 'hybrid') {
    contract.dueRound = game.roundNumber + duration;
    contract.cureRound = contract.dueRound + 1;
  }
  if (contract.kind === 'equity' && contract.expiresRound != null) contract.expiresRound = game.roundNumber + duration;
}

// Funding a contract moves cash, books the contract, records the equity share and clears the pending offer. A throw in any of
// those steps must not leave the table half-committed, so the touched state is captured first and restored on failure.
function fundedContractSnapshot(game, contract, lender, player) {
  const property = contract.kind === 'equity' ? game.getTile(contract.propertyIndex) : null;
  return {
    terms: structuredClone(contract),
    lenderCash: lender.cash,
    playerCash: player.cash,
    lenderIds: Array.isArray(lender.playerContractIds) ? lender.playerContractIds.slice() : [],
    playerIds: Array.isArray(player.playerContractIds) ? player.playerContractIds.slice() : [],
    contracts: Array.isArray(game.playerContracts) ? game.playerContracts.slice() : [],
    pendingPlayerContract: game.pendingPlayerContract,
    property,
    propertyShares: property && Array.isArray(property.equityShares) ? property.equityShares.slice() : property?.equityShares
  };
}

function restoreFundedContract(game, contract, lender, player, before) {
  lender.cash = before.lenderCash;
  player.cash = before.playerCash;
  lender.playerContractIds = before.lenderIds.slice();
  player.playerContractIds = before.playerIds.slice();
  game.playerContracts = before.contracts.slice();
  game.pendingPlayerContract = before.pendingPlayerContract;
  for (const key of Object.keys(contract)) delete contract[key];
  Object.assign(contract, before.terms);
  if (before.property) {
    if (before.propertyShares === undefined) delete before.property.equityShares;
    else before.property.equityShares = before.propertyShares;
  }
}

// Returns false when the activation could not be committed; the table is then
// exactly as it was and the offer is still open.
function activateFundedContract(game, contract, lender, player) {
  const before = fundedContractSnapshot(game, contract, lender, player);
  try {
    anchorTermsToAcceptance(game, contract);
    if (contract.kind === 'equity') recordEquityShare(game, contract, lender);
    lender.cash -= contract.amount;
    player.cash += contract.amount;
    contract.status = 'active';
    contract.acceptedRound = game.roundNumber;
    game.playerContracts.push(contract);
    lender.playerContractIds.push(contract.id);
    player.playerContractIds.push(contract.id);
    game.feedMessage(lender.nickname + ' and ' + player.nickname + ' activated a ' + contract.kind + ' contract.');
    // The pending offer is cleared only after the commit succeeded, so a
    // failed activation leaves the table obligation open.
    game.pendingPlayerContract = null;
    return true;
  } catch (error) {
    restoreFundedContract(game, contract, lender, player, before);
    return false;
  }
}

function borrowerCanReceive(player) {
  if (!player) return false;
  if (player.bankrupt) return false;
  return !player.disconnected;
}

function acceptContract(game, player, contract) {
  const lender = game.getPlayerById(contract.fromPlayerId);
  if (!lenderCanStillFund(lender, contract)) {
    game.pendingPlayerContract = null;
    return { success: false, error: 'The lender can no longer fund that contract.' };
  }
  if (game.hasLoanBackedCash(lender)) {
    game.pendingPlayerContract = null;
    return { success: false, error: 'Loan-backed cash cannot be used for player contracts.' };
  }
  if (game.spendableCash(lender) < contract.amount) return { success: false, error: AUCTION_COMMITTED_CASH_ERROR };
  if (!borrowerCanReceive(player)) {
    game.pendingPlayerContract = null;
    return { success: false, error: 'The contract can no longer be accepted.' };
  }
  const termError = newContractTermsError(contract);
  if (termError) return { success: false, error: termError };
  if (isRentShareContract(contract)) {
    const error = rentSharePropertyError(game, contract, player, contract.id);
    if (error) return { success: false, error };
  }
  if (contract.kind === 'loan' && (!usesCollateralCredit(contract)
    || JSON.stringify(contract.collateralCreditQuotes) !== JSON.stringify(collateralQuoteFor(game, defaultCollateralIndices(contract))))) {
    return { success: false, error: 'The collateral quote changed; rebuild this loan offer.' };
  }
  const settlementRejection = isRentShareContract(contract) ? null : contractSettlementRejection(game, player, contract);
  if (settlementRejection) return settlementRejection;
  if (!activateFundedContract(game, contract, lender, player)) {
    return { success: false, error: CONTRACT_ACTIVATION_FAILED };
  }
  // Same rescue rule as a bank loan: the borrower's new cash settles a parked debt.
  if (game.pendingPayment?.playerId === player.id) game.trySettlePendingPayment();
  return { success: true, accepted: true, contract };
}

function declineContract(game, player) {
  game.pendingPlayerContract = null;
  game.feedMessage(player.nickname + ' declined the player contract.');
  return { success: true, accepted: false };
}

function contractResponseKey(playerId, requestId) {
  return transactionKey('contract-response', playerId, requestId ? normalizeRequestId(requestId) : null);
}

// A response memo records the contract it settled. A bare requestId is not an identity: reusing one against a different contract
// replayed the earlier result, reported success for an obligation still open, and stranded it ("Resolve the current table obligation first.").
// A memo replays only for the contract it settled (named by the request or pending now), or for a request naming no contract while none is pending.
function contractResponseMemo(game, playerId, requestId, contractId, requireCurrentRules = false) {
  const key = contractResponseKey(playerId, requestId);
  if (!key) return null;
  const entry = game.contractTransactions.get(key);
  if (!entry) return null;
  const targetContractId = contractId || game.pendingPlayerContract?.id || null;
  if (targetContractId !== null && targetContractId !== (entry.contractId || null)) return null;
  if (requireCurrentRules && entry.rulesVersion !== CONTRACT_RULES_VERSION) return { success: false, error: LEGACY_PENDING_ERROR };
  return entry.result || null;
}

function memoizeContractResponse(game, playerId, requestId, contractId, result) {
  const key = contractResponseKey(playerId, requestId);
  if (!key) return result;
  if (!result.success) return result;
  game.contractTransactions.set(key, { rulesVersion: CONTRACT_RULES_VERSION, contractId: contractId || null, result });
  while (game.contractTransactions.size > MAX_CONTRACT_REPLAYS) {
    game.contractTransactions.delete(game.contractTransactions.keys().next().value);
  }
  return result;
}

export function respondContract(game, socketId, accept, requestId = null, contractId = null) {
  const startedRejection = contractVerbRejection(game);
  if (startedRejection) return startedRejection;
  if (accept && !playerFinanceEnabled(game)) return { success: false, error: FINANCE_DISABLED_ERROR };
  if (accept && game.pendingPlayerContract && (game.pendingPlayerContract.rulesVersion !== CONTRACT_RULES_VERSION
    || (game.pendingPlayerContract.kind === 'equity' && !isRentShareContract(game.pendingPlayerContract)))) {
    return { success: false, error: LEGACY_PENDING_ERROR };
  }
  const player = game.getPlayerBySocket(socketId);
  const cached = contractResponseMemo(game, player?.id, requestId, contractId, Boolean(accept));
  if (cached) return cached;
  const contract = game.pendingPlayerContract;
  if (contractId && contract?.id !== contractId) return { success: false, error: 'No matching player contract was found.' };
  if (!responseTargetMatches(player, contract)) return { success: false, error: 'No matching player contract was found.' };
  const settledContractId = contract.id;
  const borrower = game.getPlayerById(contract.toPlayerId);
  if (accept && contract.kind === 'equity-transfer') {
    // A reserve refusal keeps the transfer open; a raw shortfall still reaches
    // the settlement validator's own message.
    if (borrower && borrower.cash >= contract.transferPrice && game.spendableCash(borrower) < contract.transferPrice) {
      return { success: false, error: AUCTION_COMMITTED_CASH_ERROR };
    }
    const result = settleEquityTransfer(game, contract);
    if (!result.success && game.pendingPlayerContract === contract) game.pendingPlayerContract = null;
    return memoizeContractResponse(game, player?.id, requestId, settledContractId, result);
  }
  const result = accept ? acceptContract(game, borrower, contract) : declineContract(game, player);
  return memoizeContractResponse(game, player?.id, requestId, settledContractId, result);
}

// A hybrid note repays like a loan until it converts; conversion ends the
// debt leg, so converted contracts are never repayable.
function repayableDebtKind(contract) {
  if (contract.kind === 'loan') return true;
  return contract.kind === 'hybrid';
}

function repayableLoan(contract, borrower) {
  if (!borrower) return false;
  if (!contract) return false;
  if (!repayableDebtKind(contract)) return false;
  if (contract.toPlayerId !== borrower.id) return false;
  return ACTIVE_CONTRACT_STATUSES.includes(contract.status);
}

function repaymentAmount(contract, amount) {
  const requested = amount == null ? contract.remaining : Math.floor(Number(amount));
  return Math.min(Math.max(0, requested), contract.remaining);
}

export function repayContract(game, socketId, payload = {}) {
  const startedRejection = contractVerbRejection(game);
  if (startedRejection) return startedRejection;
  const { contractId, amount, requestId } = payload;
  const borrower = game.getPlayerBySocket(socketId);
  const key = transactionKey('contract-repay', borrower?.id, requestId ? normalizeRequestId(requestId) : null);
  const cached = memoizedResult(game, key);
  if (cached) return cached;
  const contract = game.playerContractById(contractId);
  if (!repayableLoan(contract, borrower)) return { success: false, error: 'That loan is not available to repay.' };
  const lender = game.getPlayerById(contract.fromPlayerId);
  if (!lender) return { success: false, error: 'That loan is no longer available to repay.' };
  // Loan-backed cash cannot fund a player contract, and it cannot pay one
  // either: the proposal and the acceptance both refuse a loan-backed
  // lender, so a repayment has to refuse the same cash for the same reason.
  if (game.hasLoanBackedCash?.(borrower)) {
    return { success: false, error: 'Loan-backed cash cannot be used for player contracts.' };
  }
  const payment = repaymentAmount(contract, amount);
  if (!payment) return { success: false, error: 'You do not have enough cash for that repayment.' };
  if (borrower.cash < payment) return { success: false, error: 'You do not have enough cash for that repayment.' };
  if (game.spendableCash(borrower) < payment) return { success: false, error: AUCTION_COMMITTED_CASH_ERROR };
  const result = settleLoanRepayment(game, contract, borrower, payment, lender);
  return memoizeSuccess(game, key, result);
}

function settleLoanRepayment(game, contract, borrower, payment, lender = null) {
  borrower.cash -= payment;
  if (lender) lender.cash += payment;
  contract.remaining -= payment;
  if (contract.remaining <= 0) {
    contract.remaining = 0;
    contract.status = 'paid';
    contract.paidRound = game.roundNumber;
  }
  game.feedMessage(borrower.nickname + ' repaid $' + payment + ' on a player loan.');
  // The repayment can be the missing piece of the lender's own parked debt.
  if (lender) settleRecipientParkedDebt(game, lender);
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
    const shares = Array.isArray(property.equityShares) ? property.equityShares : [];
    property.equityShares = shares.filter(entry => entry.contractId !== contract.id);
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

function defaultCollateralIndices(contract) {
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

// A converted hybrid note is live equity, so it stays visible alongside
// active and due contracts instead of vanishing from the ledger.
function contractIsLive(contract) {
  if (ACTIVE_CONTRACT_STATUSES.includes(contract.status)) return true;
  return contract.status === 'converted';
}

// An equity share earns and survives only while its contract is live: an
// active agreement, or a converted hybrid note whose debt leg has ended.
export function equityShareContractLive(contract) {
  if (!contract) return false;
  if (contract.status === 'active') return true;
  return contract.status === 'converted';
}

export function playerContractSummary(game, viewerPlayerId = null) {
  const pending = game.pendingPlayerContract
    ? projectContract(game, game.pendingPlayerContract, viewerPlayerId)
    : null;
  const active = game.playerContracts
    .filter(contractIsLive)
    .map(contract => projectContract(game, contract, viewerPlayerId));
  return { pending, active };
}
