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

export const CONTRACT_KINDS = new Set(['loan', 'equity', 'hybrid']);
export const EQUITY_CONTROL_MODES = new Set(['passive', 'shared', 'controlling']);
const ACTIVE_CONTRACT_STATUSES = ['active', 'due'];
const TABLE_OBLIGATION_FIELDS = [
  'auction',
  'pendingPurchaseOffer',
  'pendingSponsoredPurchase',
  'pendingTrade',
  'pendingPlayerContract'
];
const MAX_CONTRACT_REPLAYS = 1_000;

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
    kind: terms.kind,
    fromPlayerId: terms.fromPlayer.id,
    toPlayerId: terms.toPlayer.id,
    amount: terms.amount,
    premiumRate: terms.premiumRate,
    durationRounds: terms.durationRounds,
    createdRound: game.roundNumber,
    status: 'pending',
    counterDepth: 0,
    collateralTileIndex: null,
    collateralTileIndices: [],
    equityShare: 0,
    equityControl: 'passive',
    conversionShare: 0
  };
}

function collateralIndicesForOffer(game, offer) {
  if (offer.collateralTileIndices != null && !Array.isArray(offer.collateralTileIndices)) return null;
  const supplied = Array.isArray(offer.collateralTileIndices)
    ? offer.collateralTileIndices
    : offer.collateralTileIndex == null ? [] : [offer.collateralTileIndex];
  const maximum = Math.min(Array.isArray(game.tiles) ? game.tiles.length : 0, 52);
  if (supplied.length > maximum) return null;
  const indices = [];
  for (const value of supplied) {
    const index = Number(value);
    if (!Number.isInteger(index) || !game.getTile(index)) return null;
    if (!indices.includes(index)) indices.push(index);
  }
  return indices;
}

function equityTransferContext(game, seller, buyer, sourceContractId, sharePct, price) {
  if (!isPairOfActivePlayers(seller, buyer)) return { error: 'Choose two active players.' };
  const source = game.playerContractById(sourceContractId);
  if (!source || !['equity', 'hybrid'].includes(source.kind) || !equityShareContractLive(source)) return { error: 'That equity share is no longer available.' };
  if (source.kind === 'equity' && !source.permanent && source.expiresRound && game.roundNumber >= source.expiresRound) {
    return { error: 'That equity share has expired.' };
  }
  const tile = game.getTile(Number(source.propertyIndex));
  if (!tile || tile.ownerId !== source.toPlayerId || tile.type !== 'property' || tile.mortgaged || Number(tile.houseCount) > 0) {
    return { error: 'That property cannot transfer equity right now.' };
  }
  if (source.fromPlayerId !== seller.id) return { error: 'You do not own that equity share.' };
  const owner = game.getPlayerById(source.toPlayerId);
  if (!activeSeat(owner)) return { error: 'The property owner is no longer available.' };
  const sourceShare = Number(source.equityShare || source.conversionShare);
  const entry = (tile.equityShares || []).find(item => item.contractId === source.id && item.holderId === seller.id);
  if (!entry || !Number.isFinite(sourceShare) || Number(entry.share) !== sourceShare) return { error: 'That equity share is no longer available.' };
  if (!Number.isInteger(sharePct) || sharePct < 5 || sharePct > sourceShare) return { error: 'Enter a valid share amount.' };
  if (!Number.isInteger(price) || price < 1) return { error: 'Enter a whole-dollar transfer price.' };
  const buyerShare = (tile.equityShares || []).filter(item => item.holderId === buyer.id)
    .reduce((sum, item) => sum + Math.max(0, Number(item.share) || 0), 0);
  if (buyerShare + sharePct > 100 || (tile.equityShares || []).reduce((sum, item) => sum + Math.max(0, Number(item.share) || 0), 0) > 100) {
    return { error: 'That property has no remaining equity to transfer.' };
  }
  if (buyer.cash < price) return { error: 'The buyer does not have enough cash for that transfer.' };
  return { source, tile, entry };
}

export function proposeEquityShareTransfer(game, socketId, offer = {}) {
  const seller = game.getPlayerBySocket(socketId);
  const buyer = game.getPlayerById(offer.toPlayerId);
  if (!seller || seller.id !== offer.fromPlayerId || seller.id !== game.currentPlayerId) return { success: false, error: 'Choose a valid equity seller.' };
  const key = transactionKey('equity-transfer', seller.id, String(offer.requestId || '').trim().slice(0, 100));
  const cached = memoizedResult(game, key);
  if (cached) return cached;
  if (tableObligationOpen(game)) return { success: false, error: 'Resolve the current table obligation first.' };
  const sharePct = Math.floor(Number(offer.sharePct));
  const price = Math.floor(Number(offer.price));
  const ctx = equityTransferContext(game, seller, buyer, offer.contractId, sharePct, price);
  if (ctx.error) return { success: false, error: ctx.error };
  const transfer = {
    id: 'contract_' + crypto.randomUUID(), kind: 'equity-transfer',
    fromPlayerId: seller.id, toPlayerId: buyer.id, propertyIndex: ctx.tile.index,
    sourceContractId: ctx.source.id, transferSharePct: sharePct, transferPrice: price,
    amount: price, equityShare: sharePct, equityControl: 'passive',
    permanent: ctx.source.permanent === true, expiresRound: ctx.source.expiresRound ?? null,
    requestId: String(offer.requestId || '').trim().slice(0, 100),
    createdRound: game.roundNumber, status: 'pending', counterDepth: 0, lastProposerId: seller.id
  };
  game.pendingPlayerContract = transfer;
  return memoizeSuccess(game, key, { success: true, transfer });
}

function equityTransferOffer(game, current, offer = {}, counteredBy) {
  const seller = game.getPlayerById(current.fromPlayerId);
  const buyer = game.getPlayerById(current.toPlayerId);
  const sharePct = Math.floor(Number(offer.sharePct ?? current.transferSharePct));
  const price = Math.floor(Number(offer.price ?? current.transferPrice));
  const ctx = equityTransferContext(game, seller, buyer, current.sourceContractId, sharePct, price);
  if (ctx.error) return { success: false, error: ctx.error };
  const next = {
    ...current, transferSharePct: sharePct, equityShare: sharePct,
    transferPrice: price, amount: price,
    counterDepth: Math.min(2, (Number(current.counterDepth) || 0) + 1),
    lastProposerId: counteredBy
  };
  game.pendingPlayerContract = next;
  return { success: true, countered: true, contract: next };
}

function settleEquityTransfer(game, transfer) {
  const seller = game.getPlayerById(transfer.fromPlayerId);
  const buyer = game.getPlayerById(transfer.toPlayerId);
  const check = equityTransferContext(game, seller, buyer, transfer.sourceContractId, transfer.transferSharePct, transfer.transferPrice);
  if (check.error) return { success: false, error: check.error };
  const { source, tile, entry } = check;
  const propertyOwner = game.getPlayerById(source.toPlayerId);
  const sourceShareKey = source.kind === 'hybrid'
    && (source.status === 'converted' || source.equityShare == null)
    ? 'conversionShare'
    : 'equityShare';
  const before = {
    sellerCash: seller.cash, buyerCash: buyer.cash, sourceShare: source[sourceShareKey],
    sourceStatus: source.status, sourceTerminatedRound: source.terminatedRound,
    sourceEntryShare: entry.share, pending: game.pendingPlayerContract,
    contracts: [...game.playerContracts], sellerIds: [...seller.playerContractIds],
    buyerIds: [...buyer.playerContractIds], shares: [...tile.equityShares],
    ownerIds: [...(propertyOwner?.playerContractIds || [])]
  };
  try {
    buyer.cash -= transfer.transferPrice;
    seller.cash += transfer.transferPrice;
    source[sourceShareKey] -= transfer.transferSharePct;
    entry.share -= transfer.transferSharePct;
    if (source[sourceShareKey] === 0) {
      source.status = 'terminated';
      source.terminatedRound = game.roundNumber;
      tile.equityShares = tile.equityShares.filter(item => item !== entry);
    }
    const contract = {
      id: 'contract_' + crypto.randomUUID(), kind: 'equity',
      fromPlayerId: buyer.id, toPlayerId: source.toPlayerId, amount: transfer.transferPrice,
      propertyIndex: tile.index, equityShare: transfer.transferSharePct, equityControl: 'passive',
      permanent: source.permanent === true, expiresRound: source.expiresRound ?? null,
      durationRounds: source.durationRounds, createdRound: game.roundNumber,
      acceptedRound: game.roundNumber, status: 'active', transferredFromContractId: source.id
    };
    game.playerContracts.push(contract);
    buyer.playerContractIds.push(contract.id);
    propertyOwner.playerContractIds.push(contract.id);
    tile.equityShares.push({ holderId: buyer.id, share: transfer.transferSharePct, contractId: contract.id, control: 'passive' });
    game.pendingPlayerContract = null;
    game.feedMessage(`${seller.nickname} transferred ${transfer.transferSharePct}% equity to ${buyer.nickname} for $${transfer.transferPrice}.`);
    return { success: true, accepted: true, contract };
  } catch (error) {
    seller.cash = before.sellerCash;
    buyer.cash = before.buyerCash;
    source[sourceShareKey] = before.sourceShare;
    source.status = before.sourceStatus;
    if (before.sourceTerminatedRound === undefined) delete source.terminatedRound;
    else source.terminatedRound = before.sourceTerminatedRound;
    entry.share = before.sourceEntryShare;
    game.pendingPlayerContract = before.pending;
    game.playerContracts = before.contracts;
    seller.playerContractIds = before.sellerIds;
    buyer.playerContractIds = before.buyerIds;
    if (propertyOwner) propertyOwner.playerContractIds = before.ownerIds;
    tile.equityShares = before.shares;
    return { success: false, error: 'Equity transfer failed; no assets moved.' };
  }
}

function collateralIsBorrowerDeed(game, collateral, borrower) {
  return Boolean(collateral && collateral.ownerId === borrower.id && game.isTradeableTile(collateral));
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
  return null;
}

function isEquityEligibleProperty(property, ownerId) {
  if (!property) return false;
  if (property.type !== 'property') return false;
  if (property.ownerId !== ownerId) return false;
  if (property.mortgaged) return false;
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

function equityDraftTerms(game, contract, offer, recipient) {
  const property = game.getTile(Number(offer.propertyIndex));
  const share = Math.max(5, Math.min(100, Math.floor(Number(offer.equityShare) || 5)));
  if (!isEquityEligibleProperty(property, recipient.id)) {
    return { success: false, error: 'Equity needs an unencumbered property owned by the recipient.' };
  }
  if (equityCapReached(property, share, game)) {
    return { success: false, error: 'That property has no remaining equity to sell.' };
  }
  contract.propertyIndex = property.index;
  contract.equityShare = share;
  contract.equityControl = EQUITY_CONTROL_MODES.has(offer.equityControl) ? offer.equityControl : 'passive';
  // Preserve a permanent equity term across counters/adjustments. Existing
  // contracts carry an explicit expiresRound, so a merged null value means
  // "permanent"; an initial offer without either field remains temporary.
  const hasExistingExpiry = Object.prototype.hasOwnProperty.call(offer, 'expiresRound');
  const permanent = offer.permanent === true || (hasExistingExpiry && offer.expiresRound == null);
  contract.permanent = permanent;
  contract.expiresRound = permanent ? null : game.roundNumber + contract.durationRounds;
  return null;
}

// A hybrid note is a loan at accept time and converts into an equity share
// only when it defaults past its cure turn. Proposal validates both legs:
// the loan math plus the conversion target an equity draft would require.
function hybridDraftTerms(game, contract, offer, recipient) {
  const property = game.getTile(Number(offer.propertyIndex));
  const conversion = Math.max(5, Math.min(100, Math.floor(Number(offer.conversionShare) || 25)));
  if (!isEquityEligibleProperty(property, recipient.id)) {
    return { success: false, error: 'Equity needs an unencumbered property owned by the recipient.' };
  }
  if (equityCapReached(property, conversion, game)) {
    return { success: false, error: 'That property has no remaining equity to sell.' };
  }
  contract.totalDue = contract.amount + Math.ceil(contract.amount * (contract.premiumRate / 100));
  contract.remaining = contract.totalDue;
  contract.dueRound = game.roundNumber + contract.durationRounds;
  contract.cureRound = contract.dueRound + 1;
  contract.propertyIndex = property.index;
  contract.conversionShare = conversion;
  const basket = validateCollateralBasket(game, offer, recipient);
  if (basket.error) return { success: false, error: basket.error };
  setContractCollateral(contract, basket.indices);
  return null;
}

const TERM_BUILDERS = {
  loan: loanDraftTerms,
  equity: equityDraftTerms,
  hybrid: hybridDraftTerms
};

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
  const buildTerms = TERM_BUILDERS[normalized.kind] || equityDraftTerms;
  const terms = buildTerms(game, contract, offer, toPlayer);
  if (terms) return terms;
  game.pendingPlayerContract = contract;
  if (fromPlayer.isBot) fromPlayer.botDealActionsThisTurn = (fromPlayer.botDealActionsThisTurn || 0) + 1;
  game.feedMessage(fromPlayer.nickname + ' sent a ' + normalized.kind + ' contract to ' + toPlayer.nickname + '.');
  return memoizeSuccess(game, key, { success: true, contract });
}

// A negotiation keeps the original lender and borrower, replaces only the
// unaccepted terms, and never transfers cash until the lender accepts. It is
// intentionally off-turn for the borrower because it is a response to an
// already-open table obligation; the normal lender-funding guards still run.
export function counterContract(game, socketId, offer = {}) {
  const responder = game.getPlayerBySocket(socketId);
  const current = game.pendingPlayerContract;
  if (!responder || !current || contractResponderId(current) !== responder.id) {
    return { success: false, error: 'Only the receiving player can negotiate this contract.' };
  }
  if (offer.contractId && offer.contractId !== current.id) {
    return { success: false, error: 'That contract offer is no longer current.' };
  }
  if (current.kind === 'equity-transfer') return equityTransferOffer(game, current, offer, responder.id);
  if (Number(current.counterDepth) >= 2) {
    return { success: false, error: 'This contract has reached its negotiation limit.' };
  }
  const lender = game.getPlayerById(current.fromPlayerId);
  const borrower = game.getPlayerById(current.toPlayerId);
  const normalized = normalizeContractOffer({ ...current, ...offer });
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
  // The cap check reads game.pendingPlayerContract as "other" encumbrance:
  // clear the offer under negotiation (restored on failure) so a counter
  // is not double-counted against itself.
  const previousPending = game.pendingPlayerContract;
  game.pendingPlayerContract = null;
  const terms = buildTerms(game, contract, { ...current, ...offer }, borrower);
  if (terms) {
    game.pendingPlayerContract = previousPending;
    return terms;
  }
  contract.counterDepth = Math.min(2, (Number(current.counterDepth) || 0) + 1);
  game.pendingPlayerContract = contract;
  game.feedMessage(responder.nickname + ' negotiated the ' + normalized.kind + ' contract terms.');
  return { success: true, countered: true, contract };
}

export function adjustContract(game, socketId, offer = {}) {
  const editor = game.getPlayerBySocket(socketId);
  const current = game.pendingPlayerContract;
  if (!editor || !current || contractLastProposerId(current) !== editor.id) {
    return { success: false, error: 'Only the sending player can adjust this contract.' };
  }
  if (offer.contractId && offer.contractId !== current.id) {
    return { success: false, error: 'That contract offer is no longer current.' };
  }
  if (current.kind === 'equity-transfer') {
    if (Number(current.counterDepth) >= 2) return { success: false, error: 'This contract has reached its negotiation limit.' };
    const result = equityTransferOffer(game, current, offer, editor.id);
    if (result.success) return { ...result, countered: undefined, adjusted: true };
    return result;
  }
  if (Number(current.counterDepth) >= 2) {
    return { success: false, error: 'This contract has reached its negotiation limit.' };
  }
  const lender = game.getPlayerById(current.fromPlayerId);
  const borrower = game.getPlayerById(current.toPlayerId);
  const normalized = normalizeContractOffer({ ...current, ...offer });
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
  const terms = buildTerms(game, contract, { ...current, ...offer }, borrower);
  if (terms) {
    game.pendingPlayerContract = previousPending;
    return terms;
  }
  contract.counterDepth = Math.min(2, (Number(current.counterDepth) || 0) + 1);
  game.pendingPlayerContract = contract;
  game.feedMessage(editor.nickname + ' adjusted the ' + normalized.kind + ' contract terms.');
  return { success: true, adjusted: true, contract };
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

function contractLastProposerId(contract) {
  if (contract?.lastProposerId) return contract.lastProposerId;
  const depth = Math.max(0, Math.floor(Number(contract?.counterDepth) || 0));
  return depth % 2 === 0 ? contract?.fromPlayerId : contract?.toPlayerId;
}

function contractResponderId(contract) {
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
  if (!borrowerCanReceive(player)) {
    game.pendingPlayerContract = null;
    return { success: false, error: 'The contract can no longer be accepted.' };
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

export function respondContract(game, socketId, accept, requestId = null, contractId = null) {
  const player = game.getPlayerBySocket(socketId);
  const key = transactionKey('contract-response', player?.id, requestId ? String(requestId).slice(0, 100) : null);
  const cached = memoizedResult(game, key);
  if (cached) return cached;
  const contract = game.pendingPlayerContract;
  if (contractId && contract?.id !== contractId) return { success: false, error: 'No matching player contract was found.' };
  if (!responseTargetMatches(player, contract)) return { success: false, error: 'No matching player contract was found.' };
  const borrower = game.getPlayerById(contract.toPlayerId);
  if (accept && contract.kind === 'equity-transfer') {
    const result = settleEquityTransfer(game, contract);
    if (!result.success && game.pendingPlayerContract === contract) game.pendingPlayerContract = null;
    return memoizeSuccess(game, key, result);
  }
  const result = accept ? acceptContract(game, borrower, contract) : declineContract(game, player);
  return memoizeSuccess(game, key, result);
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
  const { contractId, amount, requestId } = payload;
  const borrower = game.getPlayerBySocket(socketId);
  const key = transactionKey('contract-repay', borrower?.id, requestId ? String(requestId).slice(0, 100) : null);
  const cached = memoizedResult(game, key);
  if (cached) return cached;
  const contract = game.playerContractById(contractId);
  if (!repayableLoan(contract, borrower)) return { success: false, error: 'That loan is not available to repay.' };
  const lender = game.getPlayerById(contract.fromPlayerId);
  if (!lender) return { success: false, error: 'That loan is no longer available to repay.' };
  const payment = repaymentAmount(contract, amount);
  if (!payment) return { success: false, error: 'You do not have enough cash for that repayment.' };
  if (borrower.cash < payment) return { success: false, error: 'You do not have enough cash for that repayment.' };
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
  const borrower = game.getPlayerById(contract.toPlayerId);
  const lender = game.getPlayerById(contract.fromPlayerId);
  const indices = Array.isArray(contract.collateralTileIndices) && contract.collateralTileIndices.length
    ? contract.collateralTileIndices
    : contract.collateralTileIndex == null ? [] : [contract.collateralTileIndex];
  const first = contract.collateralTileIndex;
  contract.collateralTileIndex = null;
  handlePlayerLoanDefault(game, contract, options);
  contract.collateralTileIndex = first;
  if (borrower && !borrower.bankrupt && lender) {
    for (const index of indices) {
      const deed = game.getTile(Number(index));
      if (deed?.ownerId === borrower.id) game.applyPropertyOwnershipChange(borrower, lender, deed);
    }
  }
  contract.collateralTileIndices = indices.slice();
  contract.unsecuredDefault = indices.length === 0;
  if (borrower && indices.length) borrower.collateralLost = true;
  const claim = (game.defaultClaims || []).find(entry => entry.contractId === contract.id);
  if (claim) {
    claim.collateralTileIndex = indices[0] ?? null;
    claim.collateralTileIndices = indices.slice();
  }
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
  if (!isEquityEligibleProperty(property, borrower.id)) return false;
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

// A hybrid note converts instead of seizing: past the cure turn the lender
// takes the agreed equity share and interest stops. When the conversion
// target is gone (sold, mortgaged, built on, or full), the note falls back
// to the plain loan-default path.
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

export function settleEquityShares(game, tile, owner, amountPaid) {
  if (!Array.isArray(tile?.equityShares) || !tile.equityShares.length) return;
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
