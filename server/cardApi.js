// Card draw and action handlers as a prototype mixin. A handler returns
// either a real result (the movement cards that re-enter applyTile, or the
// strike/rent early-outs) or the RESOLVE_TAIL sentinel meaning "run the
// shared resolveTurnAfterAction tail and return undefined" — exactly the
// break-vs-return split the original switch encoded. gameLogic.js assigns
// this object onto GameState.prototype; server/applyCard.test.js pins every
// card's effect and feed text.
import { randomInt } from './random.js';
import { START_TILE_INDEX, SURPRISE_DECK, TREASURE_DECK } from './gameData.js';

const RESOLVE_TAIL = Symbol('resolveTurnAfterAction');

// Card action dispatch: the action verbs mapped to their handler method
// names on GameState, replacing the original switch statement.
const CARD_ACTION_HANDLERS = {
  collectStart: 'collectStartCard',
  pay: 'payCard',
  collect: 'collectCard',
  jailFree: 'jailFreeCard',
  moveBack: 'moveBackCard',
  moveTo: 'moveToCard',
  nearestRailroad: 'nearestTileCard',
  nearestUtility: 'nearestTileCard',
  repairs: 'repairsCard',
  payEach: 'payEachCard',
  move: 'moveCard',
  goToJail: 'goToJailCard',
  collectFromEach: 'collectFromEachCard'
};

const cardApi = {
  handleChanceTile(player, options = {}, deckName = 'surprise') {
    const card = this.drawCard(deckName);
    player.cardDraws ||= { surprise: 0, treasure: 0 };
    player.cardDraws[deckName] = (player.cardDraws[deckName] || 0) + 1;
    if (deckName === 'treasure') this.recordTreasureSighting(player, card);
    this.feedMessage(`${player.nickname} drew a card: ${card.text}`);
    const cashBefore = player.cash;
    const positionBefore = player.position;
    const result = this.applyCard(player, card, options);
    if (deckName === 'surprise') this.maybeTriggerGlobalEvent('surprise');
    const cash = this.cardCashAfterPlay(player, card, cashBefore, positionBefore);
    return {
      ...(result || { success: true }),
      cardReveal: { tileIndex: player.position, text: card.text, action: card.action, cash }
    };
  },

  recordTreasureSighting(player, card) {
    if (!(player.treasureCardsSeen instanceof Set)) player.treasureCardsSeen = new Set();
    player.treasureCardsSeen.add(String(card.text || '').trim());
  },

  drawCard(deckName = 'surprise') {
    const key = deckName === 'treasure' ? 'treasureDeck' : 'surpriseDeck';
    const source = deckName === 'treasure' ? TREASURE_DECK : SURPRISE_DECK;
    if (this[key].length === 0) this[key] = [...source];
    const index = randomInt(0, this[key].length - 1);
    return this[key].splice(index, 1)[0];
  },

  applyCard(player, card, options = {}) {
    const handlerName = CARD_ACTION_HANDLERS[card.action];
    const handler = handlerName && this[handlerName];
    const outcome = handler ? handler.call(this, player, card, options) : RESOLVE_TAIL;
    if (outcome === RESOLVE_TAIL) {
      this.resolveTurnAfterAction(options);
      return undefined;
    }
    return outcome;
  },

  // The cardReveal cash figure: the dynamic-delta actions read the real
  // balance change (minus the pass-Start salary on movement cards); pay and
  // collect actions report their nominal amount under the low-tax discount.
  cardCashAfterPlay(player, card, cashBefore, positionBefore) {
    const dynamicActions = ['repairs', 'payEach', 'collectFromEach', 'nearestRailroad', 'nearestUtility'];
    if (dynamicActions.includes(card.action)) {
      return this.dynamicCardCash(player, card, cashBefore, positionBefore);
    }
    if (card.action === 'pay') return -(Number(card.amount) || 0);
    if (card.action === 'collect') return this.collectCardCash(card);
    if (card.action === 'collectStart') return this.collectCardCash(card);
    return 0;
  },

  dynamicCardCash(player, card, cashBefore, positionBefore) {
    let cash = player.cash - cashBefore;
    if (!['nearestRailroad', 'nearestUtility'].includes(card.action)) return cash;
    if (player.position < positionBefore) cash -= 200;
    return cash;
  },

  collectCardCash(card) {
    const amount = Number(card.amount) || 200;
    return this.isLowTaxElection() ? Math.floor(amount * 0.8) : amount;
  },

  // Shared movement-card pieces: the pass-Start salary, the airport-strike
  // grounding test, the payable-rent-owner guard and the card rent formula.
  awardStartSalaryIfPassed(player, destination) {
    if (destination.index < player.position) {
      player.cash += 200;
      this.feedMessage(`${player.nickname} passed Start and collected $200.`);
    }
  },

  airportStrikeGroundsCard() {
    return this.globalEventActive('airport-strike') || this.activeEventEffects().airportCardsBlocked;
  },

  cardRentPayable(player, owner, destination) {
    if (!owner) return false;
    if (owner.id === player.id) return false;
    if (owner.bankrupt) return false;
    if (destination.mortgaged) return false;
    return this.cardRentJailPayable(owner);
  },

  cardRentJailPayable(owner) {
    if (!owner.inJail) return true;
    if (!this.settings.noRentWhileInPrison) return true;
    return false;
  },

  collectStartCard(player, card) {
    player.position = START_TILE_INDEX;
    const amount = Number(card.amount) || 200;
    const paid = this.isLowTaxElection() ? Math.floor(amount * 0.8) : amount;
    player.cash += paid;
    this.feedMessage(`${player.nickname} collected $${paid} from Start.`);
    return RESOLVE_TAIL;
  },

  collectCard(player, card) {
    const amount = Number(card.amount) || 0;
    const paid = this.isLowTaxElection() ? Math.floor(amount * 0.8) : amount;
    player.cash += paid;
    this.feedMessage(`${player.nickname} collected $${paid}.`);
    return RESOLVE_TAIL;
  },

  payCard(player, card, options) {
    this.chargePlayer({ player, amount: card.amount, message: `${player.nickname} paid $${card.amount}.`, turnOptions: options });
    return undefined;
  },

  jailFreeCard(player) {
    player.jailFreeCards = (player.jailFreeCards || 0) + 1;
    this.feedMessage(`${player.nickname} received a Get Out of Prison card.`);
    return RESOLVE_TAIL;
  },

  moveBackCard(player, card, options) {
    player.position = (player.position - (card.steps || 3) + this.tiles.length) % this.tiles.length;
    this.feedMessage(`${player.nickname} moved back ${card.steps || 3} spaces.`);
    return this.applyTile(player, this.getTile(player.position), options);
  },

  moveToCard(player, card, options) {
    const destination = this.getTile(card.tileIndex);
    if (!destination) return RESOLVE_TAIL;
    this.awardStartSalaryIfPassed(player, destination);
    player.position = destination.index;
    this.feedMessage(`${player.nickname} advanced to ${destination.name}.`);
    return this.applyTile(player, destination, options);
  },

  moveCard(player, card, options) {
    const destTile = this.getTile(card.tileIndex);
    if (!destTile) return RESOLVE_TAIL;
    player.position = card.tileIndex;
    this.feedMessage(`${player.nickname} moved to ${destTile.name}.`);
    const moveOptions = destTile.type === 'vacation' ? { ...options, skipVacationCollect: true } : options;
    return this.applyTile(player, destTile, moveOptions);
  },

  nearestTileCard(player, card, options) {
    const wantedType = card.action === 'nearestRailroad' ? 'railroad' : 'utility';
    if (wantedType === 'railroad') {
      if (this.airportStrikeGroundsCard()) {
        this.feedMessage(`${player.nickname} drew an airport movement card, but the strike grounded every flight.`);
        this.resolveTurnAfterAction(options);
        return { success: true };
      }
    }
    const destination = this.findNextTileOfType(player, wantedType);
    if (!destination) return RESOLVE_TAIL;
    this.awardStartSalaryIfPassed(player, destination);
    player.position = destination.index;
    const owner = destination.ownerId ? this.getPlayerById(destination.ownerId) : null;
    if (this.cardRentPayable(player, owner, destination)) {
      const amount = this.cardRentAmount(destination, card, wantedType);
      this.chargePlayer({ player, creditor: owner, amount, message: `${player.nickname} paid $${amount} card rent to ${owner.nickname}.`, turnOptions: options });
      return { success: true };
    }
    return this.applyTile(player, destination, options);
  },

  findNextTileOfType(player, wantedType) {
    return Array.from({ length: this.tiles.length - 1 }, (_, offset) => (player.position + offset + 1) % this.tiles.length)
      .map(index => this.getTile(index))
      .find(tile => tile?.type === wantedType);
  },

  cardRentAmount(destination, card, wantedType) {
    if (wantedType === 'utility') {
      return (Number(this.lastDice[0]) + Number(this.lastDice[1])) * (card.multiplier || 10);
    }
    return this.calculateRent(destination) * (card.multiplier || 2);
  },

  repairsCard(player, card, options) {
    const amount = this.buildingRepairCost(player, card);
    if (!amount) return RESOLVE_TAIL;
    this.chargePlayer({ player, amount, message: `${player.nickname} paid $${amount} in building repairs.`, turnOptions: options });
    return undefined;
  },

  buildingRepairCost(player, card) {
    let houses = 0;
    let hotels = 0;
    player.properties.forEach((index) => {
      const level = this.getTile(index)?.houseCount || 0;
      if (level === 5) hotels += 1;
      else houses += level;
    });
    return houses * (card.houseCost || 0) + hotels * (card.hotelCost || 0);
  },

  payEachCard(player, card) {
    const amount = this.payEachAmount(card);
    const total = this.payEachPayout(player, amount);
    this.feedMessage(`${player.nickname} paid $${total} to other players from the card.`);
    return RESOLVE_TAIL;
  },

  payEachAmount(card) {
    return card.amount || 0;
  },

  payEachPayout(player, amount) {
    let total = 0;
    this.activePlayers().filter(other => this.payEachIsRecipient(player, other)).forEach(other => {
      total += this.payEachShare(player, other, amount);
    });
    return total;
  },

  payEachIsRecipient(player, other) {
    if (other.id === player.id) return false;
    return true;
  },

  payEachShare(player, other, amount) {
    const paid = Math.min(player.cash, amount);
    player.cash -= paid;
    other.cash += paid;
    return paid;
  },

  collectFromEachCard(player, card) {
    const alive = this.activePlayers();
    alive.forEach(other => {
      if (other.id !== player.id) {
        const paid = Math.min(other.cash, card.amount || 0);
        other.cash -= paid;
        player.cash += paid;
      }
    });
    this.feedMessage(`${player.nickname} collected from each player.`);
    return RESOLVE_TAIL;
  },

  goToJailCard(player, options) {
    player.position = this.tiles.find(tile => tile.type === 'jail').index;
    player.inJail = true;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} was sent to Jail by a card.`);
    this.resolveTurnAfterAction({ ...options, allowExtraRoll: false });
    return undefined;
  }
};

export { cardApi };
