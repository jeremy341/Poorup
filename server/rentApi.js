// Rent computation as a prototype mixin. The formula is shared with the
// player's public bot forecast so candidate projections use authoritative rules.
import { calculateRentFromFacts, rentFactsFromGame } from './botRentForecast.js';

const rentApi = {
  diceTotal() {
    return Math.max(2, (this.lastDice?.[0] || 0) + (this.lastDice?.[1] || 0));
  },

  getPropertyRent(tile) {
    if (tile.mortgaged) return 0;
    return calculateRentFromFacts(rentFactsFromGame(this, tile));
  },

  // Table rent before event factors and the rent cap: the base a card
  // multiplier stacks on before applyEventRentModifiers caps the charge once.
  baseTableRent(tile) {
    if (tile.mortgaged) return 0;
    return calculateRentFromFacts({ ...rentFactsFromGame(this, tile), eventFactors: [], rentCap: null });
  },

  applyEventRentModifiers(rent, tile) {
    const facts = rentFactsFromGame(this, tile);
    return calculateRentFromFacts({ ...facts, tile: { type: 'other', rent }, hasFullSet: false, doubleRent: false });
  },

  calculateRent(tile) {
    return this.getPropertyRent(tile);
  }
};

export { rentApi };
