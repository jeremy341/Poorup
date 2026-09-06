// Rent computation as a prototype mixin: the base-rent formulas per tile
// type and the global-event modifier fold. gameLogic.js assigns this object
// onto GameState.prototype; server/rent.test.js pins every multiplier.
import { PROPERTY_RENT_MULTIPLIERS, RAILROAD_RENT } from './gameData.js';

// Global-event rent modifiers as data: every rule is a multiplicative factor
// (airport-strike is a factor of 0) keyed off the event/effect state, folded
// in order over the base rent. None of them read the accumulated total, so
// multiplication commutes and the sequence is behavior-irrelevant; the only
// non-multiplicative step, rentCap, stays after the fold along with the
// Math.floor clamp. An effect factor parses to NaN when absent, and the fold
// skips non-finite factors — the exact "applies only when set" guard the
// original if-ladder repeated eleven times.
const RENT_EVENT_MODIFIERS = [
  { appliesTo: (game, tile) => game.globalEventActive('housing-bubble') && tile.type === 'property', factor: () => 0.65 },
  { appliesTo: (game, tile) => game.globalEventActive('airport-strike') && tile.type === 'railroad', factor: () => 0 },
  { appliesTo: (game, tile) => game.globalEventActive('tourism-boom') && tile.type === 'railroad', factor: () => 1.75 },
  { appliesTo: (game, tile) => game.globalEventActive('tourism-boom') && tile.group === 'Dark Blue', factor: () => 1.3 },
  {
    appliesTo: (game, tile) => game.globalEventActive('anti-monopoly')
      && tile.ownerId === game.globalEvent.targetPlayerId
      && game.globalEvent.resolvedChoice !== 'dismiss',
    factor: () => 0.6
  },
  { appliesTo: (game, tile) => game.globalEventActive('energy-crisis') && tile.type === 'utility', factor: () => 1.5 },
  { appliesTo: (game, tile) => game.isPublicWorksElection() && tile.type === 'property', factor: () => 0.75 },
  { appliesTo: (game, tile) => tile.type === 'railroad' && !game.globalEventActive('airport-strike'), factor: (game) => Number(game.activeEventEffects().airportRentMultiplier) },
  { appliesTo: (game, tile) => tile.type === 'utility' && !game.globalEventActive('energy-crisis'), factor: (game) => Number(game.activeEventEffects().utilityRentMultiplier) },
  { appliesTo: (game, tile) => tile.group === 'Dark Blue' && !game.globalEventActive('tourism-boom'), factor: (game) => Number(game.activeEventEffects().premiumRentMultiplier) },
  { appliesTo: (game) => !game.globalEventActive('housing-bubble'), factor: (game) => { const multiplier = Number(game.activeEventEffects().rentMultiplier); return multiplier > 0 ? multiplier : NaN; } }
];

const rentApi = {
  getPropertyRent(tile) {
    if (tile.mortgaged) {
      return 0;
    }
    return this.applyEventRentModifiers(this.baseRentByType(tile), tile);
  },

  baseRentByType(tile) {
    if (tile.type === 'property') return this.propertyBaseRent(tile);
    if (tile.type === 'utility') return this.utilityBaseRent(tile);
    if (tile.type === 'railroad') return this.railroadBaseRent(tile);
    return tile.rent || 0;
  },

  propertyBaseRent(tile) {
    const baseRent = tile.rent || 0;
    const level = Math.max(0, Math.min(5, tile.houseCount || 0));
    if (level > 0) {
      return Math.floor(baseRent * PROPERTY_RENT_MULTIPLIERS[level]);
    }
    if (!tile.group || !this.settings.doubleRent) return baseRent;
    if (this.hasFullSet(tile.ownerId, tile.group)) {
      return baseRent * 2;
    }
    return baseRent;
  },

  utilityBaseRent(tile) {
    const owner = this.getPlayerById(tile.ownerId);
    if (!owner) return tile.rent || 20;
    return this.diceTotal() * (this.ownedUtilityCount(owner) >= 2 ? 10 : 4);
  },

  ownedUtilityCount(owner) {
    return this.tiles.filter(entry => entry.type === 'utility' && entry.ownerId === owner.id).length;
  },

  diceTotal() {
    return Math.max(2, (this.lastDice?.[0] || 0) + (this.lastDice?.[1] || 0));
  },

  railroadBaseRent(tile) {
    const owner = this.getPlayerById(tile.ownerId);
    if (!owner) return RAILROAD_RENT[0];
    const ownedRailroads = this.tiles.filter(entry => entry.type === 'railroad' && entry.ownerId === owner.id).length;
    return RAILROAD_RENT[Math.min(Math.max(ownedRailroads, 1), RAILROAD_RENT.length) - 1];
  },

  applyEventRentModifiers(rent, tile) {
    let total = rent;
    for (const modifier of RENT_EVENT_MODIFIERS) {
      if (!modifier.appliesTo(this, tile)) continue;
      const factor = modifier.factor(this, tile);
      if (Number.isFinite(factor)) total *= factor;
    }
    const cap = Number(this.activeEventEffects().rentCap);
    if (Number.isFinite(cap) && cap > 0) total = Math.min(total, cap);
    return Math.max(0, Math.floor(total));
  },

  calculateRent(tile) {
    return this.getPropertyRent(tile);
  }
};

export { rentApi };
