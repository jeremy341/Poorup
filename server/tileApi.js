// Landing resolution as a prototype mixin: what happens when a player's
// movement ends on a tile. gameLogic.js assigns this object onto
// GameState.prototype. The original applyTile if/switch ladder became a
// type-keyed resolver table plus per-landing methods, preserving every feed
// string, guard order, and side-effect sequence pinned by
// server/gameLogic.test.js, server/applyCard.test.js and
// server/casino-bankruptcy.test.js.

// Landing outcome per tile type, exactly the old switch cases. Types with no
// entry (and a missing tile) fall through to the shared resolve-tail branch.
// Every entry takes the uniform (player, tile, options) landing signature.
const LANDING_RESOLVERS = {
  start: 'landingStart',
  property: 'handlePropertyTile',
  tax: 'handleTaxTile',
  chance: 'landingChance',
  chest: 'landingTreasure',
  jail: 'landingJailVisiting',
  parking: 'landingVacationPool',
  goToVacation: 'landingGoToVacation',
  goToJail: 'landingGoToJail',
  vacation: 'landingVacation',
  utility: 'handleUtilityTile',
  railroad: 'handleRailroadTile'
};

const tileApi = {
  applyTile(player, tile, options = {}) {
    this.recordLandingFacts(player, tile);
    const resolver = this.landingResolverFor(tile);
    if (resolver) return resolver.call(this, player, tile, options);
    this.resolveTurnAfterAction(options);
    return { success: true };
  },

  landingResolverFor(tile) {
    if (!tile) return null;
    const name = LANDING_RESOLVERS[tile.type];
    if (!name) return null;
    return this[name];
  },

  recordLandingFacts(player, tile) {
    if (!tile) return;
    if (tile.type === 'railroad') this.recordAirportVisit(player, tile);
    if (tile.type === 'tax') this.recordTaxVisit(player, tile);
  },

  recordAirportVisit(player, tile) {
    if (!(player.airportVisits instanceof Set)) player.airportVisits = new Set();
    player.airportVisits.add(tile.index);
  },

  recordTaxVisit(player, tile) {
    if (!(player.taxTilesVisited instanceof Set)) player.taxTilesVisited = new Set();
    player.taxTilesVisited.add(tile.index);
  },

  landingChance(player, tile, options) {
    return this.handleChanceTile(player, options, 'surprise');
  },

  landingTreasure(player, tile, options) {
    return this.handleChanceTile(player, options, 'treasure');
  },

  landingVacation(player, tile, options) {
    return this.handleVacationTile(player, options);
  },

  landingStart(player, tile, options) {
    this.feedMessage(`${player.nickname} landed on Start.`);
    this.resolveTurnAfterAction(options);
    return { success: true };
  },

  landingJailVisiting(player, tile, options) {
    this.feedMessage(`${player.nickname} is visiting Jail.`);
    this.resolveTurnAfterAction(options);
    return { success: true };
  },

  landingVacationPool(player, tile, options) {
    if (this.vacationPool > 0) {
      player.cash += this.vacationPool;
      this.feedMessage(`${player.nickname} swept the Vacation pool for $${this.vacationPool}.`);
      this.vacationPool = 0;
    } else {
      this.feedMessage(`${player.nickname} took a breather at Free Parking.`);
    }
    this.resolveTurnAfterAction(options);
    return { success: true };
  },

  landingGoToVacation(player, tile, options) {
    player.position = this.tiles.find(tileItem => tileItem.type === 'jail').index;
    player.inJail = false;
    player.jailTurns = 0;
    this.vacationPool += 50;
    this.feedMessage(`${player.nickname} was sent on Vacation and added $50 to the pool.`);
    this.resolveTurnAfterAction({ ...options, allowExtraRoll: false });
    return { success: true };
  },

  landingGoToJail(player, tile, options) {
    player.position = this.tiles.find(tileItem => tileItem.type === 'jail').index;
    player.inJail = true;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} was sent to Jail.`);
    this.resolveTurnAfterAction({ ...options, allowExtraRoll: false });
    return { success: true };
  },

  handlePropertyTile(player, tile, options = {}) {
    return this.handleBuyableTile(player, tile, options, 'property');
  },

  handleTaxTile(player, tile, options = {}) {
    this.recordTaxVisit(player, tile);
    const amount = this.taxAmountDue(tile);
    this.chargeLandedTax(player, amount, options);
    return { success: true };
  },

  // Event tax scaling in the original order: the inflation-spiral hard-code
  // wins outright, otherwise the generic multiplier applies, and the low-tax
  // platform shaves the survivor down to 60% (never below $1).
  taxAmountDue(tile) {
    let amount = tile.amount || 0;
    if (this.globalEventActive('inflation-spiral')) {
      return Math.ceil(amount * 1.4);
    }
    const taxMultiplier = Number(this.activeEventEffects().taxMultiplier);
    if (this.taxMultiplierActive(taxMultiplier)) {
      amount = Math.ceil(amount * taxMultiplier);
    }
    if (this.isLowTaxElection()) amount = Math.max(1, Math.floor(amount * 0.6));
    return amount;
  },

  taxMultiplierActive(multiplier) {
    if (!Number.isFinite(multiplier)) return false;
    return multiplier > 0;
  },

  chargeLandedTax(player, amount, options) {
    if (!this.settings.vacationCash) {
      this.chargePlayer(player, null, amount, `${player.nickname} paid $${amount} in tax.`, options);
      return;
    }
    this.chargePlayer(player, null, amount, `${player.nickname} paid $${amount} in tax into Vacation cash.`, options, {
      onPaid: paid => { this.vacationPool += paid; }
    });
  },

  handleVacationTile(player, options = {}) {
    if (!options.skipVacationCollect && this.vacationPool > 0) {
      player.cash += this.vacationPool;
      this.feedMessage(`${player.nickname} collected $${this.vacationPool} from Vacation cash.`);
      this.vacationPool = 0;
    } else {
      this.feedMessage(`${player.nickname} landed on Vacation.`);
    }
    this.resolveTurnAfterAction(options);
    return { success: true };
  },

  handleRailroadTile(player, tile, options = {}) {
    return this.handleBuyableTile(player, tile, options, 'railroad');
  },

  handleUtilityTile(player, tile, options = {}) {
    return this.handleBuyableTile(player, tile, options, 'utility');
  },

  handleBuyableTile(player, tile, options = {}, label = 'property') {
    if (tile.mortgaged) {
      this.feedMessage(`${player.nickname} landed on a mortgaged ${label} and paid no rent.`);
      this.resolveTurnAfterAction(options);
      return { success: true };
    }
    if (tile.ownerId === null) return this.unownedTileOutcome(player, tile, options);
    if (tile.ownerId === player.id) {
      this.feedMessage(`${player.nickname} landed on their own ${label}.`);
      this.resolveTurnAfterAction(options);
      return { success: true };
    }
    const owner = this.getPlayerById(tile.ownerId);
    const waiver = this.rentCollectOutcome(player, owner, options, label);
    if (waiver) return waiver;
    return this.chargeLandedRent(player, tile, owner, options);
  },

  unownedTileOutcome(player, tile, options) {
    if (player.cash >= tile.price) {
      this.pendingPurchaseOffer = { playerId: player.id, tileIndex: tile.index };
      return { success: true, purchaseOffer: { tileIndex: tile.index, name: tile.name, price: tile.price } };
    }
    this.feedMessage(`${player.nickname} cannot afford ${tile.name}.`);
    if (!this.settings.auction) {
      this.resolveTurnAfterAction(options);
      return { success: true };
    }
    const auction = this.startAuction(tile, player.id);
    if (auction && auction.success === false) return auction;
    return { success: true, auctionStarted: true };
  },

  rentCollectOutcome(player, owner, options, label) {
    if (!owner) return this.landOnVacantDeed(options);
    if (owner.bankrupt) return this.landOnVacantDeed(options);
    if (!owner.inJail) return null;
    if (!this.settings.noRentWhileInPrison) return null;
    this.feedMessage(`${player.nickname} landed on ${owner.nickname}'s ${label}, but rent is not collected while the owner is in jail.`);
    this.resolveTurnAfterAction(options);
    return { success: true };
  },

  landOnVacantDeed(options) {
    this.resolveTurnAfterAction(options);
    return { success: true };
  },

  chargeLandedRent(player, tile, owner, options) {
    const rent = this.calculateRent(tile);
    this.recordAirportStrikeRentFacts(tile, owner);
    this.chargePlayer(player, owner, rent, `${player.nickname} paid $${rent} rent to ${owner.nickname}.`, options, { onPaid: paid => this.settleEquityShares(tile, owner, paid), equityTileIndex: tile.index, equityOwnerId: owner.id });
    return { success: true };
  },

  recordAirportStrikeRentFacts(tile, owner) {
    if (!this.globalEventActive('airport-strike')) return;
    if (owner.properties.some(index => this.getTile(index)?.type === 'railroad')) owner.airportOwnedDuringStrike = true;
    if (tile.type !== 'railroad') owner.nonAirportRentDuringStrike = true;
  }
};

export { tileApi };
