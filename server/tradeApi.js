// Player-to-player trades as a prototype mixin: the proposal and accept-side
// guard tables plus the settlement transfer. The guard arrays carry the
// original if-clauses in evaluation order so a single error string wins
// exactly as before — server/trades.test.js pins the full precedence.
// gameLogic.js assigns this object onto GameState.prototype.
import crypto from 'crypto';

// Trade proposal rejection rules as data: one entry per original if-clause of
// GameState.proposeTrade, kept in the original evaluation order so a single
// error string wins exactly as before. The context is fully normalized up
// front (pure lookups only), and every predicate reads just that context.
const TRADE_PROPOSAL_GUARDS = [
  {
    error: 'Choose a valid trade partner.',
    rejects: (game, ctx) => !ctx.fromPlayer || !ctx.toPlayer || ctx.fromPlayer.id === ctx.toPlayer.id
  },
  {
    error: 'Both players must be active to trade.',
    rejects: (game, ctx) => ctx.fromPlayer.bankrupt || ctx.fromPlayer.disconnected || ctx.toPlayer.bankrupt || ctx.toPlayer.disconnected
  },
  {
    error: 'Another trade is already pending.',
    rejects: game => Boolean(game.pendingPayment || game.auction || game.pendingPurchaseOffer || game.pendingTrade || game.pendingPlayerContract)
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
    error: 'You can only offer properties that you own and that have no houses, hotels, or mortgage.',
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

// Accept-side revalidation for respondToTrade: same order and strings as the
// original accept branch. A fired guard also clears the pending trade, which
// the responder does uniformly. The first entry covers the original combined
// "players still exist, active" condition verbatim.
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
      createdAt: Date.now()
    };
    this.pendingTrade = trade;
    this.feedMessage(`${ctx.fromPlayer.nickname} sent a trade offer to ${ctx.toPlayer.nickname}.`);
    return { success: true, trade };
  },

  // One normalization pass for the raw offer: cash clamping, index coercion,
  // and tile resolution all happen exactly as in the original single-body
  // implementation, before any guard reads the context.
  tradeProposalContext(socketId, offer) {
    const fromPlayer = this.getPlayerBySocket(socketId);
    const toPlayer = this.getPlayerById(offer.toPlayerId);
    const giveCash = Math.max(0, Number(offer.giveCash || 0));
    const requestCash = Math.max(0, Number(offer.requestCash || 0));
    const givePropertyIndexes = Array.isArray(offer.givePropertyIndexes) ? offer.givePropertyIndexes.map(Number) : [];
    const requestPropertyIndexes = Array.isArray(offer.requestPropertyIndexes) ? offer.requestPropertyIndexes.map(Number) : [];
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

  respondToTrade(socketId, { tradeId, accept } = {}) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'No matching trade offer was found.' };
    }
    const trade = this.pendingTrade;
    if (!trade || trade.id !== tradeId) {
      return { success: false, error: 'No matching trade offer was found.' };
    }
    if (trade.toPlayerId !== player.id) {
      return { success: false, error: 'Only the receiving player can respond to this trade.' };
    }
    if (!accept) {
      return this.declineTradeOffer(player);
    }
    const ctx = this.tradeSettlementContext(trade);
    const guard = TRADE_SETTLEMENT_GUARDS.find(entry => entry.rejects(this, ctx));
    if (guard) {
      this.pendingTrade = null;
      return { success: false, error: guard.error };
    }
    return this.settleTradeOffer(ctx);
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
    fromPlayer.cash -= trade.giveCash;
    toPlayer.cash += trade.giveCash;
    toPlayer.cash -= trade.requestCash;
    fromPlayer.cash += trade.requestCash;
    giveTiles.forEach(tile => this.applyPropertyOwnershipChange(fromPlayer, toPlayer, tile));
    requestTiles.forEach(tile => this.applyPropertyOwnershipChange(toPlayer, fromPlayer, tile));
    this.pendingTrade = null;
    this.tradesCompleted += 1;
    this.markCompletedTradeFlags(fromPlayer, toPlayer, giveTiles.length + requestTiles.length);
    this.feedMessage(`${fromPlayer.nickname} and ${toPlayer.nickname} completed a trade.`);
    this.settleTradeLinkedPayments(fromPlayer, toPlayer);
    return { success: true, accepted: true };
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
