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

const propertyApi = {
  purchaseProperty(socketId, tileIndex) {
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(tileIndex);
    const rejection = this.purchaseOfferRejection(player, tile, tileIndex);
    if (rejection) return rejection;
    this.acceptPurchaseOffer(player, tile);
    return { success: true };
  },

  purchaseOfferRejection(player, tile, tileIndex) {
    if (!player) return { success: false, error: 'Property is no longer available.' };
    if (!tile) return { success: false, error: 'Property is no longer available.' };
    if (tile.ownerId !== null) return { success: false, error: 'Property is no longer available.' };
    const unavailable = { success: false, error: 'There is no active purchase offer for this property.' };
    if (!this.pendingPurchaseOffer) return unavailable;
    if (this.pendingPurchaseOffer.playerId !== player.id) return unavailable;
    if (this.pendingPurchaseOffer.tileIndex !== tileIndex) return unavailable;
    if (player.cash < tile.price) return { success: false, error: 'Insufficient cash to purchase this property.' };
    return null;
  },

  acceptPurchaseOffer(player, tile) {
    player.cash -= tile.price;
    tile.ownerId = player.id;
    tile.mortgaged = false;
    tile.houseCount = 0;
    player.properties.push(tile.index);
    if (this.globalEventActive('housing-bubble')) player.boughtDuringHousingBubble = true;
    this.refreshPlayerGroups(player);
    this.feedMessage(`${player.nickname} purchased ${tile.name} for $${tile.price}.`);
    this.pendingPurchaseOffer = null;
    this.resolveTurnAfterAction();
  },

  declineProperty(socketId, tileIndex) {
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(tileIndex);
    const rejection = this.declineOfferRejection(player, tile, tileIndex);
    if (rejection) return rejection;
    this.pendingPurchaseOffer = null;
    if (!this.settings.auction) {
      this.feedMessage(`${player.nickname} declined to buy ${tile.name}.`);
      this.resolveTurnAfterAction();
      return { success: true };
    }
    const auction = this.startAuction(tile, player.id);
    if (auction && auction.success === false) return auction;
    return { success: true, auctionStarted: true, message: 'Auction started for the declined property.' };
  },

  declineOfferRejection(player, tile, tileIndex) {
    if (!player) return { success: false, error: 'Property is no longer available.' };
    if (!tile) return { success: false, error: 'Property is no longer available.' };
    if (tile.ownerId !== null) return { success: false, error: 'Property is no longer available.' };
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
    const tile = this.getTile(tileIndex);
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
  propertyActionRejection(player, tile, action) {
    if (!player) return { success: false, error: 'Property not found.' };
    if (!tile) return { success: false, error: 'Property not found.' };
    if (tile.ownerId !== player.id) return { success: false, error: 'You do not own this property.' };
    if (!this.isBuildOrSellAction(action)) return null;
    if (!this.pendingDebtFor(player)) return this.buildWindowRejection(player);
    if (action === 'build-house') {
      return { success: false, error: 'You cannot build while settling a debt.' };
    }
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
    if (this.hasRolled && !this.extraRollPending) {
      return { success: false, error: 'You can only build or sell before rolling the dice.' };
    }
    return null;
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
    const cost = Math.ceil(Math.floor((tile.price || 0) / 2) * 1.1);
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
