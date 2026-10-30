// Player-to-player trades as a prototype mixin: the proposal and accept-side guard tables plus the settlement transfer.
// The guard arrays keep the original if-clauses in evaluation order, so a single error string wins exactly as before.
// gameLogic.js assigns this object onto GameState.prototype. trades.test.js pins the full precedence.
import crypto from 'crypto';
import { normalizeRequestId } from './requestId.js';
import { AUCTION_COMMITTED_CASH_ERROR } from './auctionApi.js';

const MAX_TRADE_PROPERTIES = 40;

// Keeps the largest cash gain from one completed trade, for the end-of-game recap. Deeds are not valued here.
export function recordBestTrade(player, cashNet) {
  if (cashNet > (Number(player.bestTradeNet) || 0)) player.bestTradeNet = cashNet;
}

function tradeTransactionKey(prefix, playerId, requestId) {
  if (!requestId) return null;
  return `${playerId}:${prefix}:${normalizeRequestId(requestId)}`;
}

function memoizedTradeResult(game, key) {
  if (!key || !game.tradeTransactions) return undefined;
  return game.tradeTransactions.get(key);
}

function memoizeTradeSuccess(game, key, result) {
  if (!key || !game.tradeTransactions) return result;
  if (!result || result.success !== true) return result;
  game.tradeTransactions.set(key, result);
  return result;
}

// A leading auction bid is reserved cash (see auctionApi spendableCash).
function committedCashShort(game, player, amount) {
  return amount > 0 && game.spendableCash(player) < amount;
}

function normalizePropertyIndexes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, MAX_TRADE_PROPERTIES).map(Number))];
}

// A trade moves cash, deeds, achievement flags, counters and feed entries in one step. A throw in any of those steps must not leave
// the table holding half a trade (one seat's cash moved, the deed did not), so everything the settlement touches is captured first
// and restored when it fails.
function tradeSettlementSnapshot(game, ctx) {
  const { fromPlayer, toPlayer, giveTiles, requestTiles } = ctx;
  const tiles = [...giveTiles, ...requestTiles].filter(Boolean).map(tile => ({
    tile,
    ownerId: tile.ownerId,
    purchasePricePaid: tile.purchasePricePaid,
    mortgaged: tile.mortgaged,
    houseCount: tile.houseCount,
    equityShares: Array.isArray(tile.equityShares) ? tile.equityShares.slice() : tile.equityShares
  }));
  const contracts = (Array.isArray(game.playerContracts) ? game.playerContracts : []).map(contract => ({
    contract,
    status: contract.status,
    terminatedRound: contract.terminatedRound
  }));
  return {
    fromCash: fromPlayer.cash,
    toCash: toPlayer.cash,
    fromProperties: Array.isArray(fromPlayer.properties) ? fromPlayer.properties.slice() : [],
    toProperties: Array.isArray(toPlayer.properties) ? toPlayer.properties.slice() : [],
    fromGroups: new Set(fromPlayer.fullGroups || []),
    toGroups: new Set(toPlayer.fullGroups || []),
    fromBubbleSurvivor: fromPlayer.bubbleSurvivor,
    toBubbleSurvivor: toPlayer.bubbleSurvivor,
    fromTradesCompleted: fromPlayer.tradesCompleted,
    toTradesCompleted: toPlayer.tradesCompleted,
    fromGroupTherapy: fromPlayer.groupTherapyTrade,
    toGroupTherapy: toPlayer.groupTherapyTrade,
    fromCoalition: fromPlayer.coalitionTrade,
    toCoalition: toPlayer.coalitionTrade,
    fromCombo: fromPlayer.tradesDuringCombo,
    toCombo: toPlayer.tradesDuringCombo,
    fromContractIds: Array.isArray(fromPlayer.playerContractIds) ? fromPlayer.playerContractIds.slice() : [],
    toContractIds: Array.isArray(toPlayer.playerContractIds) ? toPlayer.playerContractIds.slice() : [],
    contracts: Array.isArray(game.playerContracts) ? game.playerContracts.slice() : [],
    tradesCompleted: game.tradesCompleted,
    pendingTrade: game.pendingTrade,
    tiles,
    contractStates: contracts
  };
}

function restoreTradeSettlement(game, ctx, before) {
  const { fromPlayer, toPlayer } = ctx;
  fromPlayer.cash = before.fromCash;
  toPlayer.cash = before.toCash;
  fromPlayer.properties = before.fromProperties.slice();
  toPlayer.properties = before.toProperties.slice();
  fromPlayer.fullGroups = new Set(before.fromGroups);
  toPlayer.fullGroups = new Set(before.toGroups);
  fromPlayer.bubbleSurvivor = before.fromBubbleSurvivor;
  toPlayer.bubbleSurvivor = before.toBubbleSurvivor;
  fromPlayer.tradesCompleted = before.fromTradesCompleted;
  toPlayer.tradesCompleted = before.toTradesCompleted;
  fromPlayer.groupTherapyTrade = before.fromGroupTherapy;
  toPlayer.groupTherapyTrade = before.toGroupTherapy;
  fromPlayer.coalitionTrade = before.fromCoalition;
  toPlayer.coalitionTrade = before.toCoalition;
  fromPlayer.tradesDuringCombo = before.fromCombo;
  toPlayer.tradesDuringCombo = before.toCombo;
  fromPlayer.playerContractIds = before.fromContractIds.slice();
  toPlayer.playerContractIds = before.toContractIds.slice();
  game.playerContracts = before.contracts.slice();
  game.tradesCompleted = before.tradesCompleted;
  game.pendingTrade = before.pendingTrade;
  before.tiles.forEach(entry => {
    entry.tile.ownerId = entry.ownerId;
    if (entry.purchasePricePaid === undefined) delete entry.tile.purchasePricePaid;
    else entry.tile.purchasePricePaid = entry.purchasePricePaid;
    entry.tile.mortgaged = entry.mortgaged;
    entry.tile.houseCount = entry.houseCount;
    entry.tile.equityShares = Array.isArray(entry.equityShares) ? entry.equityShares.slice() : entry.equityShares;
  });
  before.contractStates.forEach(entry => {
    entry.contract.status = entry.status;
    if (entry.terminatedRound === undefined) delete entry.contract.terminatedRound;
    else entry.contract.terminatedRound = entry.terminatedRound;
  });
}

// Trade proposal rejection rules as data: one entry per original if-clause of GameState.proposeTrade, in the original evaluation order,
// so a single error string wins exactly as before. The context is normalized up front (pure lookups only), and every predicate reads it.
// Trades have no turn guard: they can be proposed and settled on anyone's turn. A pending payment does not block debt-rescue deals; auctions, purchase offers, trades and contracts do.
const TRADE_PROPOSAL_GUARDS = [
  {
    error: 'The game is not running.',
    rejects: game => !game.started
  },
  {
    error: 'Choose a valid trade partner.',
    rejects: (game, ctx) => !ctx.fromPlayer || !ctx.toPlayer || ctx.fromPlayer.id === ctx.toPlayer.id
  },
  {
    error: 'Both players must be active to trade.',
    rejects: (game, ctx) => ctx.fromPlayer.bankrupt || ctx.fromPlayer.disconnected || ctx.toPlayer.bankrupt || ctx.toPlayer.disconnected
  },
  {
    error: 'Trading is disabled for this room.',
    rejects: game => game.settings.trading === false
  },
  // One guard per blocker, in the original order, so the message names the
  // open obligation instead of always reporting a second trade.
  {
    error: 'Resolve the open auction before proposing a trade.',
    rejects: game => Boolean(game.auction)
  },
  {
    error: 'Resolve the pending purchase offer before proposing a trade.',
    rejects: game => Boolean(game.pendingPurchaseOffer)
  },
  {
    error: 'Resolve the pending sponsored purchase before proposing a trade.',
    rejects: game => Boolean(game.pendingSponsoredPurchase)
  },
  {
    error: 'Another trade is already pending.',
    rejects: game => Boolean(game.pendingTrade)
  },
  {
    error: 'Resolve the pending player contract before proposing a trade.',
    rejects: game => Boolean(game.pendingPlayerContract)
  },
  {
    error: 'Cash values must be valid numbers.',
    rejects: (game, ctx) => !Number.isFinite(ctx.giveCash) || !Number.isFinite(ctx.requestCash)
  },
  {
    error: 'Choose at least one cash or property item to include in the trade.',
    rejects: (game, ctx) => !ctx.giveCash && !ctx.requestCash && !ctx.givePropertyIndexes.length && !ctx.requestPropertyIndexes.length
  },
  {
    error: 'You can only offer properties that you own and that have no buildings, collateral, or equity shares.',
    rejects: (game, ctx) => ctx.giveTiles.some(tile => game.tradeLegTileUnavailable(tile, ctx.fromPlayer.id))
  },
  {
    error: 'The requested properties are not available for trade.',
    rejects: (game, ctx) => ctx.requestTiles.some(tile => game.tradeLegTileUnavailable(tile, ctx.toPlayer.id))
  },
  {
    error: 'You do not have enough cash for this offer.',
    rejects: (game, ctx) => ctx.fromPlayer.cash < ctx.giveCash
  },
  {
    error: 'One of the players no longer has enough cash.',
    rejects: (game, ctx) => ctx.toPlayer.cash < ctx.requestCash
  }
];

// Accept-side revalidation for respondToTrade: same order and strings as the original accept branch. A fired guard also clears the
// pending trade, as the responder always does. The first entry covers the original combined "players still exist, active" condition verbatim.
const TRADE_SETTLEMENT_GUARDS = [
  {
    error: 'The trade is no longer valid.',
    rejects: (game, ctx) => !ctx.fromPlayer || !ctx.toPlayer || ctx.fromPlayer.bankrupt || ctx.toPlayer.bankrupt || ctx.fromPlayer.disconnected || ctx.toPlayer.disconnected
  },
  {
    error: 'One of the players no longer has enough cash.',
    rejects: (game, ctx) => ctx.fromPlayer.cash < ctx.trade.giveCash || ctx.toPlayer.cash < ctx.trade.requestCash
  },
  {
    error: 'One of the offered properties is no longer tradable.',
    rejects: (game, ctx) => ctx.giveTiles.some(tile => game.tradeLegTileUnavailable(tile, ctx.trade.fromPlayerId))
  },
  {
    error: 'One of the requested properties is no longer tradable.',
    rejects: (game, ctx) => ctx.requestTiles.some(tile => game.tradeLegTileUnavailable(tile, ctx.trade.toPlayerId))
  }
];

const tradeApi = {
  proposeTrade(socketId, offer = {}) {
    const ctx = this.tradeProposalContext(socketId, offer);
    // Idempotent retry: a double-click with the same requestId replays the original offer instead of stacking a duplicate on the table.
    // Looked up before the guards (the live offer would trip "already pending"), and only while that offer is still pending: a declined,
    // cancelled or settled offer must never be handed back as live.
    const replayKey = ctx.fromPlayer ? tradeTransactionKey('trade-propose', ctx.fromPlayer.id, offer.requestId) : null;
    const replayed = memoizedTradeResult(this, replayKey);
    if (replayed?.trade && this.started && replayed.trade.id === this.pendingTrade?.id) return replayed;
    const guard = TRADE_PROPOSAL_GUARDS.find(entry => entry.rejects(this, ctx));
    if (guard) return { success: false, error: guard.error };
    const trade = {
      id: crypto.randomUUID(),
      fromPlayerId: ctx.fromPlayer.id,
      fromPlayerName: ctx.fromPlayer.nickname,
      toPlayerId: ctx.toPlayer.id,
      toPlayerName: ctx.toPlayer.nickname,
      giveCash: ctx.giveCash,
      requestCash: ctx.requestCash,
      givePropertyIndexes: ctx.givePropertyIndexes,
      requestPropertyIndexes: ctx.requestPropertyIndexes,
      counterDepth: Math.max(0, Math.min(2, Math.floor(Number(offer.counterDepth) || 0))),
      createdAt: Date.now(),
      createdRound: Math.max(1, Math.floor(Number(this.roundNumber) || 1))
    };
    this.pendingTrade = trade;
    if (ctx.fromPlayer.isBot) ctx.fromPlayer.botDealActionsThisTurn = (ctx.fromPlayer.botDealActionsThisTurn || 0) + 1;
    this.feedMessage(`${ctx.fromPlayer.nickname} sent a trade offer to ${ctx.toPlayer.nickname}.`);
    return memoizeTradeSuccess(this, replayKey, { success: true, trade });
  },

  // One normalization pass for the raw offer: cash clamping, index coercion,
  // and tile resolution all happen exactly as in the original single-body
  // implementation, before any guard reads the context.
  tradeProposalContext(socketId, offer) {
    const fromPlayer = this.getPlayerBySocket(socketId);
    const toPlayer = this.getPlayerById(offer.toPlayerId);
    // Cash is integer game currency. Keep non-finite values intact so the
    // guard can return its validation error, while flooring valid decimals
    // prevents fractional balances from entering settlement arithmetic.
    const giveCash = Math.max(0, Math.floor(Number(offer.giveCash || 0)));
    const requestCash = Math.max(0, Math.floor(Number(offer.requestCash || 0)));
    const givePropertyIndexes = normalizePropertyIndexes(offer.givePropertyIndexes);
    const requestPropertyIndexes = normalizePropertyIndexes(offer.requestPropertyIndexes);
    const giveTiles = givePropertyIndexes.map(index => this.getTile(index));
    const requestTiles = requestPropertyIndexes.map(index => this.getTile(index));
    return { fromPlayer, toPlayer, giveCash, requestCash, givePropertyIndexes, requestPropertyIndexes, giveTiles, requestTiles };
  },

  // The original inline per-tile leg check, named: a missing deed, a deed
  // owned by someone else, or an untradeable deed voids the leg.
  tradeLegTileUnavailable(tile, ownerId) {
    if (!tile) return true;
    if (tile.ownerId !== ownerId) return true;
    return !this.isTradeableTile(tile);
  },

  tradeDeedActionRejection(player, tile) {
    if (!this.started) return 'The game is not running.';
    if (!player || player.bankrupt || player.disconnected) return 'Both players must be active to trade.';
    if (this.settings.trading === false) return 'Trading is disabled for this room.';
    if (this.auction) return 'Resolve the open auction before proposing a trade.';
    if (this.pendingPurchaseOffer) return 'Resolve the pending purchase offer before proposing a trade.';
    if (this.pendingSponsoredPurchase) return 'Resolve the pending sponsored purchase before proposing a trade.';
    if (this.pendingTrade) return 'Another trade is already pending.';
    if (this.pendingPlayerContract) return 'Resolve the pending player contract before proposing a trade.';
    if (!tile || tile.ownerId !== player.id) return 'You do not own this property.';
    if (tile.type === 'property' && tile.group && this.getGroupTiles(tile.group).some(entry => (entry.houseCount || 0) > 0)) {
      return 'Sell every house and hotel in this color set before trading its deeds.';
    }
    if (!this.isTradeableTile(tile)) return 'This deed cannot be traded while it has collateral or equity shares.';
    return null;
  },

  respondToTrade(socketId, { tradeId, accept } = {}) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'No matching trade offer was found.' };
    }
    if (!this.started) return { success: false, error: 'The game is not running.' };
    const trade = this.pendingTrade;
    if (!trade || trade.id !== tradeId) {
      return { success: false, error: 'No matching trade offer was found.' };
    }
    if (trade.toPlayerId !== player.id) {
      return { success: false, error: 'Only the receiving player can respond to this trade.' };
    }
    // Only a literal true accepts; 'false' or 1 from a sloppy client declines.
    if (accept !== true) {
      return this.declineTradeOffer(player);
    }
    const ctx = this.tradeSettlementContext(trade);
    const guard = TRADE_SETTLEMENT_GUARDS.find(entry => entry.rejects(this, ctx));
    if (guard) {
      this.pendingTrade = null;
      return { success: false, error: guard.error };
    }
    // Unlike the guards above, a reserve refusal keeps the offer open so it can
    // be answered once the auction closes.
    if (committedCashShort(this, ctx.fromPlayer, trade.giveCash) || committedCashShort(this, ctx.toPlayer, trade.requestCash)) {
      return { success: false, error: AUCTION_COMMITTED_CASH_ERROR };
    }
    return this.settleTradeOffer(ctx);
  },

  renegotiationTrade(socketId, roleField, roleName, verb) {
    const player = this.getPlayerBySocket(socketId);
    const trade = this.pendingTrade;
    if (!player || !trade || trade[roleField] !== player.id) {
      return { error: `Only the ${roleName} player can ${verb} this trade.` };
    }
    return { player, trade };
  },

  // Shared body of counter and adjust: both clear the live offer, re-propose with the negotiation depth bumped, and restore the offer
  // if the re-proposal fails. A retried renegotiation reusing the original requestId replays the memoized result, not a cleared table.
  renegotiateTrade(socketId, offer, { roleField, roleName, verb, verbPast, targetField, marker }) {
    const found = this.renegotiationTrade(socketId, roleField, roleName, verb);
    if (found.error) return { success: false, error: found.error };
    if (offer.tradeId && offer.tradeId !== found.trade.id) {
      return { success: false, error: 'That trade offer is no longer current.' };
    }
    if (Number(found.trade.counterDepth) >= 2) {
      return { success: false, error: 'This trade has reached its negotiation limit.' };
    }
    const replayKey = tradeTransactionKey('trade-propose', found.player.id, offer.requestId);
    const replayed = memoizedTradeResult(this, replayKey);
    if (replayed) return replayed;
    const previous = found.trade;
    this.pendingTrade = null;
    const result = this.proposeTrade(socketId, {
      ...offer,
      toPlayerId: previous[targetField],
      counterDepth: Math.min(2, (previous.counterDepth || 0) + 1)
    });
    if (result?.success === false && !this.pendingTrade) this.pendingTrade = previous;
    if (result?.success) {
      this.feedMessage(`${found.player.nickname} ${verbPast} the trade offer.`);
      return { ...result, [marker]: true };
    }
    return result;
  },

  counterTrade(socketId, offer = {}) {
    return this.renegotiateTrade(socketId, offer, {
      roleField: 'toPlayerId', roleName: 'receiving', verb: 'counter', verbPast: 'countered',
      targetField: 'fromPlayerId', marker: 'countered'
    });
  },

  adjustTrade(socketId, offer = {}) {
    return this.renegotiateTrade(socketId, offer, {
      roleField: 'fromPlayerId', roleName: 'sending', verb: 'adjust', verbPast: 'adjusted',
      targetField: 'toPlayerId', marker: 'adjusted'
    });
  },

  // An unanswered offer blocks every other trade at the table, so it lapses
  // after a fixed window. Returns true when it expired.
  expireStaleTrade(nowMs, ttlMs) {
    const trade = this.pendingTrade;
    if (!trade) return false;
    const created = Number(trade.createdAt);
    if (!Number.isFinite(created)) return false;
    if (nowMs - created < ttlMs) return false;
    this.pendingTrade = null;
    this.feedMessage(`The trade offer from ${trade.fromPlayerName} to ${trade.toPlayerName} expired.`);
    return true;
  },

  cancelTrade(socketId, payload = {}) {
    const player = this.getPlayerBySocket(socketId);
    const trade = this.pendingTrade;
    if (!player || !trade || trade.fromPlayerId !== player.id) {
      return { success: false, error: 'Only the sending player can cancel this trade.' };
    }
    if (payload.tradeId && payload.tradeId !== trade.id) {
      return { success: false, error: 'That trade offer is no longer current.' };
    }
    this.pendingTrade = null;
    this.feedMessage(`${player.nickname} canceled the trade offer.`);
    return { success: true, canceled: true };
  },

  // Deed re-resolution at accept time; pure tile lookups for the guards and
  // the settlement transfer below.
  tradeSettlementContext(trade) {
    return {
      trade,
      fromPlayer: this.getPlayerById(trade.fromPlayerId),
      toPlayer: this.getPlayerById(trade.toPlayerId),
      giveTiles: trade.givePropertyIndexes.map(index => this.getTile(index)),
      requestTiles: trade.requestPropertyIndexes.map(index => this.getTile(index))
    };
  },

  declineTradeOffer(player) {
    this.feedMessage(`${player.nickname} declined the trade offer.`);
    this.pendingTrade = null;
    return { success: true, accepted: false };
  },

  settleTradeOffer(ctx) {
    const { trade, fromPlayer, toPlayer, giveTiles, requestTiles } = ctx;
    const before = tradeSettlementSnapshot(this, ctx);
    try {
      fromPlayer.cash -= trade.giveCash;
      toPlayer.cash += trade.giveCash;
      toPlayer.cash -= trade.requestCash;
      fromPlayer.cash += trade.requestCash;
      giveTiles.forEach(tile => this.applyPropertyOwnershipChange(fromPlayer, toPlayer, tile, { preserveMortgage: true }));
      requestTiles.forEach(tile => this.applyPropertyOwnershipChange(toPlayer, fromPlayer, tile, { preserveMortgage: true }));
      this.tradesCompleted += 1;
      // Keep a participant-level count for season/analytics projections. The
      // table counter remains the canonical total; each participant receives
      // exactly one increment for a completed trade.
      fromPlayer.tradesCompleted = (fromPlayer.tradesCompleted || 0) + 1;
      toPlayer.tradesCompleted = (toPlayer.tradesCompleted || 0) + 1;
      this.markCompletedTradeFlags(fromPlayer, toPlayer, giveTiles.length + requestTiles.length);
      recordBestTrade(fromPlayer, trade.requestCash - trade.giveCash);
      recordBestTrade(toPlayer, trade.giveCash - trade.requestCash);
      this.feedMessage(`${fromPlayer.nickname} and ${toPlayer.nickname} completed a trade.`);
      this.settleTradeLinkedPayments(fromPlayer, toPlayer);
      // The offer is cleared only after the whole settlement committed, so a
      // failed trade leaves the offer on the table instead of half-applied.
      this.pendingTrade = null;
      return { success: true, accepted: true };
    } catch (error) {
      restoreTradeSettlement(this, ctx, before);
      return { success: false, error: 'The trade could not be completed; no assets moved.' };
    }
  },

  markCompletedTradeFlags(fromPlayer, toPlayer, tradedPropertyCount) {
    if (tradedPropertyCount >= 3) {
      fromPlayer.groupTherapyTrade = true;
      toPlayer.groupTherapyTrade = true;
    }
    if (this.globalEventActive('stagflation')) {
      fromPlayer.tradesDuringCombo = (fromPlayer.tradesDuringCombo || 0) + 1;
      toPlayer.tradesDuringCombo = (toPlayer.tradesDuringCombo || 0) + 1;
    }
    if (!fromPlayer.lastVoteChoice) return;
    if (!toPlayer.lastVoteChoice) return;
    if (fromPlayer.lastVoteChoice === toPlayer.lastVoteChoice) return;
    fromPlayer.coalitionTrade = true;
    toPlayer.coalitionTrade = true;
  },

  settleTradeLinkedPayments(fromPlayer, toPlayer) {
    const pending = this.pendingPayment;
    if (!pending) return;
    if (pending.playerId !== fromPlayer.id && pending.playerId !== toPlayer.id) return;
    this.trySettlePendingPayment();
  }
};

export { tradeApi };
