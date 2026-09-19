// Property acquisition and the four build/sell/mortgage verbs as a
// prototype mixin. gameLogic.js assigns this object onto GameState.prototype;
// server/property-actions.test.js pins every error string and its precedence.
import { PROPERTY_HOUSE_COST_BY_GROUP } from './gameData.js';

// Property action dispatch: the four manageProperty verbs mapped to their
// handler method names on GameState, replacing the original if/else ladder.
const PROPERTY_ACTION_HANDLERS = {
  'build-house': 'buildHousePropertyAction',
  'sell-house': 'sellHousePropertyAction',
  mortgage: 'mortgagePropertyAction',
  unmortgage: 'unmortgagePropertyAction'
};

const buildingLabel = (houseCount) => (houseCount >= 5 ? 'hotel' : 'house');

function buildActionReason(game, player, tile, houseCost) {
  if (!game.canBuildOnTile(player, tile)) return 'You cannot build on this property right now.';
  const limit = game.buildingLimitRejection(player, Number(game.activeEventEffects().buildingLimitPerTurn));
  if (limit) return limit.error;
  if (player.cash < houseCost) return 'Insufficient cash to build a house.';
  return null;
}

function unmortgageActionReason(game, player, tile, unmortgageCost) {
  if (!game.canUnmortgageTile(player, tile)) return 'You cannot unmortgage this property right now.';
  if (player.cash < unmortgageCost) return 'Insufficient cash to unmortgage this property.';
  return null;
}

function propertyActionSpecificReason({ game, player, tile, action, costs }) {
  if (action === 'build-house') return buildActionReason(game, player, tile, costs.houseCost);
  if (action === 'sell-house' && !game.canSellFromTile(player, tile)) return 'You cannot sell a house from this property right now.';
  if (action === 'mortgage' && !game.canMortgageTile(player, tile)) return 'You cannot mortgage this property right now.';
  if (action === 'unmortgage') return unmortgageActionReason(game, player, tile, costs.unmortgageCost);
  return null;
}

function propertyActionReason(context) {
  const { game, player, tile, action } = context;
  const gate = game.propertyActionRejection(player, tile, action);
  if (gate) return gate.error;
  return propertyActionSpecificReason(context);
}

function projectedAction(context) {
  const reason = propertyActionReason(context);
  const { cost } = context;
  return { enabled: !reason, cost, reason };
}

function ownsProperty(player, tile) {
  if (!player) return false;
  if (!tile) return false;
  return tile.ownerId === player.id;
}

const propertyApi = {
  purchaseProperty(socketId, tileIndex) {
    const player = this.getPlayerBySocket(socketId);
    const coercedIndex = Number(tileIndex);
    const tile = this.getTile(coercedIndex);
    const rejection = this.purchaseOfferRejection(player, tile, coercedIndex);
    if (rejection) return rejection;
    this.acceptPurchaseOffer(player, tile);
    return { success: true };
  },

  purchaseOfferRejection(player, tile, tileIndex) {
    const entry = this.purchaseEntryRejection(player, tile);
    if (entry) return entry;
    return this.purchaseTermsRejection(player, tile, tileIndex);
  },

  purchaseEntryRejection(player, tile) {
    if (!player) return { success: false, error: 'Property is no longer available.' };
    const seat = this.propertySeatRejection(player);
    if (seat) return seat;
    if (!tile) return { success: false, error: 'Property is no longer available.' };
    if (tile.ownerId !== null) return { success: false, error: 'Property is no longer available.' };
    return null;
  },

  purchaseTermsRejection(player, tile, tileIndex) {
    const unavailable = { success: false, error: 'There is no active purchase offer for this property.' };
    if (!this.pendingPurchaseOffer) return unavailable;
    if (this.pendingPurchaseOffer.playerId !== player.id) return unavailable;
    if (this.pendingPurchaseOffer.tileIndex !== tileIndex) return unavailable;
    if (this.pendingSponsoredPurchase?.buyerId === player.id) return { success: false, error: 'Resolve the open sponsorship before buying this property.' };
    if (player.cash < tile.price) return { success: false, error: 'Insufficient cash to purchase this property.' };
    return null;
  },

  propertySeatUnavailable(player) {
    if (player.bankrupt) return true;
    if (player.disconnected) return true;
    return false;
  },

  propertySeatRejection(player) {
    if (this.propertySeatUnavailable(player)) return { success: false, error: 'Property access is unavailable right now.' };
    return null;
  },

  acceptPurchaseOffer(player, tile) {
    player.cash -= tile.price;
    tile.ownerId = player.id;
    tile.mortgaged = false;
    tile.houseCount = 0;
    if (!player.properties.includes(tile.index)) player.properties.push(tile.index);
    if (this.globalEventActive('housing-bubble')) player.boughtDuringHousingBubble = true;
    this.refreshPlayerGroups(player);
    this.feedMessage(`${player.nickname} purchased ${tile.name} for $${tile.price}.`);
    this.pendingSponsoredPurchase = null;
    this.pendingPurchaseOffer = null;
    this.resolveTurnAfterAction();
  },

  declineProperty(socketId, tileIndex) {
    const player = this.getPlayerBySocket(socketId);
    const coercedIndex = Number(tileIndex);
    const tile = this.getTile(coercedIndex);
    const rejection = this.declineOfferRejection(player, tile, coercedIndex);
    if (rejection) return rejection;
    this.cancelSponsoredPurchase?.();
    this.pendingPurchaseOffer = null;
    if (!this.settings.auction) {
      this.feedMessage(`${player.nickname} declined to buy ${tile.name}.`);
      this.resolveTurnAfterAction();
      return { success: true };
    }
    const auction = this.startAuction(tile, player.id);
    if (auction) return this.auctionStartResult(auction);
    return { success: true, auctionStarted: true, message: 'Auction started for the declined property.' };
  },

  auctionStartResult(auction) {
    if (auction.success === false) return auction;
    return { success: true, auctionStarted: true, message: 'Auction started for the declined property.' };
  },

  declineOfferRejection(player, tile, tileIndex) {
    const entry = this.purchaseEntryRejection(player, tile);
    if (entry) return entry;
    return this.declineTermsRejection(player, tileIndex);
  },

  declineTermsRejection(player, tileIndex) {
    const unavailable = { success: false, error: 'There is no active purchase offer for this property.' };
    if (!this.pendingPurchaseOffer) return unavailable;
    if (this.pendingPurchaseOffer.playerId !== player.id) return unavailable;
    if (this.pendingPurchaseOffer.tileIndex !== tileIndex) return unavailable;
    return null;
  },

  getPropertyHouseCost(tile) {
    const base = PROPERTY_HOUSE_COST_BY_GROUP[tile?.group] || 0;
    if (this.isPublicWorksElection()) {
      return Math.max(1, Math.floor(base * 0.65));
    }
    const multiplier = Number(this.activeEventEffects().buildingCostMultiplier);
    if (!Number.isFinite(multiplier)) return base;
    if (multiplier <= 0) return base;
    return Math.max(1, Math.ceil(base * multiplier));
  },

  manageProperty(socketId, payload = {}) {
    const { tileIndex, action } = payload || {};
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(Number(tileIndex));
    const rejection = this.propertyActionRejection(player, tile, action);
    if (rejection) return rejection;
    const handlerName = PROPERTY_ACTION_HANDLERS[action];
    if (!handlerName) return { success: false, error: 'Unknown property action.' };
    const result = this[handlerName](player, tile);
    this.settleDebtAfterPropertyAction(player, result);
    return result;
  },

  settleDebtAfterPropertyAction(player, result) {
    if (!result) return;
    if (!result.success) return;
    const pending = this.pendingPayment;
    if (!pending) return;
    if (pending.playerId !== player.id) return;
    this.trySettlePendingPayment();
  },

  // The shared gates of all four actions, in the historical order: existence,
  // ownership, then the build/sell turn window (relaxed while settling debt).
  // Mortgage legs skip the turn window but still need a live seat and a free
  // table, mirroring the casino and market obligation guards.
  propertyActionRejection(player, tile, action) {
    if (!player) return { success: false, error: 'Property not found.' };
    if (!tile) return { success: false, error: 'Property not found.' };
    // Dead seats act on nothing: the live-seat gate leads every leg
    // (mortgage already had it; build/sell relied on the turn window).
    const seat = this.propertySeatRejection(player);
    if (seat) return seat;
    if (tile.ownerId !== player.id) return { success: false, error: 'You do not own this property.' };
    if (this.isBuildOrSellAction(action)) return this.buildSellRejection(player, action);
    return this.mortgageActionRejection(player);
  },

  buildSellRejection(player, action) {
    if (!this.pendingDebtFor(player)) return this.buildWindowRejection(player);
    if (action === 'build-house') return { success: false, error: 'You cannot build while settling a debt.' };
    return null;
  },

  mortgageActionRejection(player) {
    const seat = this.propertySeatRejection(player);
    if (seat) return seat;
    return this.mortgageTableRejection(player);
  },

  mortgageTableRejection(player = null) {
    const blocked = { success: false, error: 'Resolve the table obligation before managing property.' };
    // Debt never blocks property management: debt is cured via mortgage/sell,
    // and only endTurn is gated by debt (server/gameLogic.js:1174).
    if (this.auction) return blocked;
    if (this.pendingTrade) return blocked;
    if (this.pendingPlayerContract) return blocked;
    if (this.pendingPurchaseOffer) return blocked;
    if (this.pendingSponsoredPurchase) return blocked;
    return null;
  },

  isBuildOrSellAction(action) {
    if (action === 'build-house') return true;
    return action === 'sell-house';
  },

  pendingDebtFor(player) {
    const pending = this.pendingPayment;
    if (!pending) return false;
    return pending.playerId === player.id;
  },

  buildWindowRejection(player) {
    if (player.id !== this.currentPlayerId) {
      return { success: false, error: 'You can only build or sell during your turn.' };
    }
    if (this.hasRolled) return this.rolledWindowRejection();
    return null;
  },

  rolledWindowRejection() {
    if (this.extraRollPending) return null;
    return { success: false, error: 'You can only build or sell before rolling the dice.' };
  },

  buildingLimitRejection(player) {
    const buildLimit = Number(this.activeEventEffects().buildingLimitPerTurn);
    if (!this.overTurnBuildLimit(player, buildLimit)) return null;
    return { success: false, error: 'The active event limits building actions this turn.' };
  },

  overTurnBuildLimit(player, buildLimit) {
    if (!Number.isFinite(buildLimit)) return false;
    if (buildLimit <= 0) return false;
    return (player.buildActionsThisTurn || 0) >= buildLimit;
  },

  // Side effects a completed build awards, beyond the house itself.
  applyBuildBonuses(player) {
    this.markBubbleRebuild(player);
    if (this.settings.evenBuild) player.evenBuilds = (player.evenBuilds || 0) + 1;
    this.markPublicWorksBuild(player);
  },

  markBubbleRebuild(player) {
    if (!player.housingBubbleEnded) return;
    if (!(player.soldBuildingsDuringHousingBubble > 0)) return;
    player.rebuiltAfterHousingBubble = true;
  },

  markPublicWorksBuild(player) {
    if (!this.isPublicWorksElection()) return;
    player.publicWorksBuilds = (player.publicWorksBuilds || 0) + 1;
  },

  buildHousePropertyAction(player, tile) {
    if (!this.canBuildOnTile(player, tile)) {
      return { success: false, error: 'You cannot build on this property right now.' };
    }
    const limit = this.buildingLimitRejection(player);
    if (limit) return limit;
    const cost = this.getPropertyHouseCost(tile);
    if (player.cash < cost) {
      return { success: false, error: 'Insufficient cash to build a house.' };
    }
    player.cash -= cost;
    tile.houseCount = (tile.houseCount || 0) + 1;
    player.buildActionsThisTurn = (player.buildActionsThisTurn || 0) + 1;
    this.applyBuildBonuses(player);
    this.feedMessage(`${player.nickname} built a ${buildingLabel(tile.houseCount)} on ${tile.name}.`);
    return { success: true };
  },

  sellHousePropertyAction(player, tile) {
    if (!this.canSellFromTile(player, tile)) {
      return { success: false, error: 'You cannot sell a house from this property right now.' };
    }
    const cost = this.getPropertyHouseCost(tile);
    const wasHotel = (tile.houseCount || 0) >= 5;
    tile.houseCount = Math.max(0, (tile.houseCount || 0) - 1);
    player.cash += Math.floor(cost * this.buildingSaleMultiplier());
    if (this.globalEventActive('housing-bubble')) player.soldBuildingsDuringHousingBubble = (player.soldBuildingsDuringHousingBubble || 0) + 1;
    this.feedMessage(`${player.nickname} sold a ${buildingLabel(wasHotel ? 5 : 0)} from ${tile.name}.`);
    return { success: true };
  },

  buildingSaleMultiplier() {
    const eventSaleMultiplier = Number(this.activeEventEffects().buildingSaleMultiplier);
    if (!Number.isFinite(eventSaleMultiplier)) return 0.5;
    if (eventSaleMultiplier < 0) return 0.5;
    return eventSaleMultiplier;
  },

  propertyActionProjection(player, tile) {
    if (!ownsProperty(player, tile)) return null;
    const houseCost = this.getPropertyHouseCost(tile);
    const saleValue = Math.floor(houseCost * this.buildingSaleMultiplier());
    const mortgageValue = Math.floor((tile.price || 0) / 2 * this.propertyValueMultiplier());
    const unmortgageCost = Math.ceil(Math.floor((tile.price || 0) / 2) * 1.1 * this.propertyValueMultiplier());
    const costs = { houseCost, unmortgageCost };
    return {
      buildHouse: projectedAction({ game: this, player, tile, action: 'build-house', cost: houseCost, costs }),
      sellHouse: projectedAction({ game: this, player, tile, action: 'sell-house', cost: saleValue, costs }),
      mortgage: projectedAction({ game: this, player, tile, action: 'mortgage', cost: mortgageValue, costs }),
      unmortgage: projectedAction({ game: this, player, tile, action: 'unmortgage', cost: unmortgageCost, costs })
    };
  },

  mortgagePropertyAction(player, tile) {
    if (!this.canMortgageTile(player, tile)) {
      return { success: false, error: 'You cannot mortgage this property right now.' };
    }
    tile.mortgaged = true;
    const amount = Math.floor((tile.price || 0) / 2 * this.propertyValueMultiplier());
    player.cash += amount;
    this.feedMessage(`${player.nickname} mortgaged ${tile.name} for $${amount}.`);
    return { success: true };
  },

  propertyValueMultiplier() {
    const valueMultiplier = Number(this.activeEventEffects().propertyValueMultiplier);
    if (!Number.isFinite(valueMultiplier)) return 1;
    if (valueMultiplier <= 0) return 1;
    return valueMultiplier;
  },

  unmortgagePropertyAction(player, tile) {
    if (!this.canUnmortgageTile(player, tile)) {
      return { success: false, error: 'You cannot unmortgage this property right now.' };
    }
    const cost = Math.ceil(Math.floor((tile.price || 0) / 2) * 1.1 * this.propertyValueMultiplier());
    if (player.cash < cost) {
      return { success: false, error: 'Insufficient cash to unmortgage this property.' };
    }
    player.cash -= cost;
    tile.mortgaged = false;
    this.feedMessage(`${player.nickname} unmortgaged ${tile.name}.`);
    return { success: true };
  }
};

export { propertyApi };
