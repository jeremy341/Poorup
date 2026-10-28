// Card draw and action handlers as a prototype mixin. A handler returns a real result (movement cards that re-enter applyTile,
// or strike and rent early-outs) or RESOLVE_TAIL, meaning "run the shared resolveTurnAfterAction tail and return undefined".
// gameLogic.js assigns this object onto GameState.prototype; server/applyCard.test.js pins every card's effect and feed text.
import { randomInt } from './random.js';
import { START_TILE_INDEX } from './gameData.js';
import { decksForVariant } from './boardRegistry.js';
import { recordPresentationCash } from './gamePresentation.js';

const RESOLVE_TAIL = Symbol('resolveTurnAfterAction');

// Refills exclude Get-Out-of-Prison cards that players hold: a held card stays out of circulation until used, so a deck
// cannot mint a duplicate. Each deck owns one such card, so only cards drawn from THIS deck count (player.jailFreeOrigins);
// a held card with no recorded origin counts against whichever deck refills. Bankrupt seats hold nothing back.
function heldFromDeck(player, deckName) {
  if (player?.bankrupt) return 0;
  const count = Math.max(0, Math.floor(Number(player?.jailFreeCards) || 0));
  // Uses only decrement the counter, so the newest origins are the ones still held.
  const origins = count && Array.isArray(player.jailFreeOrigins) ? player.jailFreeOrigins.slice(-count) : [];
  return origins.filter(origin => origin === deckName || !['surprise', 'treasure'].includes(origin)).length + (count - origins.length);
}

function refillExcludingHeld(source, players, deckName) {
  const refilled = [...source];
  const held = (Array.isArray(players) ? players : []).reduce((sum, player) => sum + heldFromDeck(player, deckName), 0);
  for (let n = 0; n < held; n += 1) {
    const at = refilled.findIndex(card => card?.action === 'jailFree');
    if (at < 0) break;
    refilled.splice(at, 1);
  }
  // Never deal from an empty deck: every held card implies a used one.
  return refilled.length ? refilled : [...source];
}

// Card action dispatch: the action verbs mapped to their handler method
// names on GameState, replacing the original switch statement.
const CARD_ACTION_HANDLERS = {
  collectStart: 'collectStartCard',
  pay: 'payCard',
  collect: 'collectCard',
  jailFree: 'jailFreeCard',
  itemReward: 'itemRewardCard',
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
    const sourceTileIndex = player.position;
    const card = this.drawCard(deckName);
    player.cardDraws ||= { surprise: 0, treasure: 0 };
    player.cardDraws[deckName] = (player.cardDraws[deckName] || 0) + 1;
    if (deckName === 'treasure') this.recordTreasureSighting(player, card);
    this.feedMessage(`${player.nickname} drew a card: ${card.text}`);
    const cashBefore = player.cash;
    const result = this.applyCard(player, card, options);
    if (card.action === 'jailFree') player.jailFreeOrigins = [...(player.jailFreeOrigins || []), deckName].slice(-Math.max(1, player.jailFreeCards || 0));
    if (deckName === 'surprise') this.maybeTriggerGlobalEvent('surprise');
    const cash = this.cardCashAfterPlay(player, card, cashBefore);
    return {
      ...(result || { success: true }),
      cardReveal: { tileIndex: sourceTileIndex, text: card.text, action: card.action, cash }
    };
  },

  recordTreasureSighting(player, card) {
    if (!(player.treasureCardsSeen instanceof Set)) player.treasureCardsSeen = new Set();
    player.treasureCardsSeen.add(String(card.text || '').trim());
  },

  drawCard(deckName = 'surprise') {
    const key = deckName === 'treasure' ? 'treasureDeck' : 'surpriseDeck';
    const variantDecks = decksForVariant(this.boardVariant || 'standard-40', this.settings);
    const source = deckName === 'treasure' ? variantDecks.treasure : variantDecks.surprise;
    if (this[key].length === 0) this[key] = refillExcludingHeld(source, this.players, deckName === 'treasure' ? 'treasure' : 'surprise');
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

  // The cardReveal cash figure: dynamic-delta actions read the real balance change (minus the pass-Start salary on movement cards);
  // pay and collect actions report their nominal amount under the low-tax discount. collectStart reads the real delta too, since it
  // pays a Start crossing and its figure must carry the same salary and catch-up bonus as the feed message.
  cardCashAfterPlay(player, card, cashBefore) {
    const dynamicActions = ['repairs', 'payEach', 'collectFromEach', 'nearestRailroad', 'nearestUtility'];
    if (dynamicActions.includes(card.action)) {
      return this.dynamicCardCash(player, cashBefore);
    }
    if (['move', 'moveTo', 'moveBack', 'collectStart'].includes(card.action)) return player.cash - cashBefore;
    if (card.action === 'pay') return player.cash - cashBefore;
    if (card.action === 'collect') return this.collectCardCash(card);
    return 0;
  },

  dynamicCardCash(player, cashBefore) {
    return player.cash - cashBefore;
  },

  // The low-tax election cuts every card reward ("taxes fall, but card rewards are reduced"). One shared helper keeps the discount
  // identical across the collect handlers, so a card never pays the raw amount in one branch and the discounted one in another.
  cardRewardAmount(card, fallback = 0) {
    const amount = Number(card?.amount) || fallback;
    return this.isLowTaxElection() ? Math.floor(amount * 0.8) : amount;
  },

  collectCardCash(card) {
    return this.cardRewardAmount(card, 200);
  },

  // Shared movement-card pieces: the pass-Start salary, the airport-strike
  // grounding test, the payable-rent-owner guard and the card rent formula.
  awardStartSalaryIfPassed(player, destination) {
    if (destination.index < player.position) {
      const landedOnStart = destination.index === START_TILE_INDEX;
      const { reward, bonus } = this.payStartPass(player, landedOnStart);
      recordPresentationCash(this, 'go', this.tiles.length - player.position - 1);
      this.feedMessage(this.startPassFeed(player, landedOnStart, reward + bonus, bonus));
    }
  },

  // Salary and last-place catch-up bonus for a Start crossing, shared by both card paths so the ladder cannot drift from the
  // dice path (gameLogic.js awardStartPass): GO pays the same however it was crossed.
  payStartPass(player, exactStart) {
    const reward = this.startPassReward(exactStart);
    const bonus = this.startPassCatchUpBonus(player);
    player.cash += reward + bonus;
    return { reward, bonus };
  },

  startPassCatchUpBonus(player) {
    return this.isLastPlaceByCash(player) ? 100 : 0;
  },

  startPassFeed(player, exactStart, total, bonus) {
    return `${player.nickname} ${exactStart ? 'landed on' : 'passed'} Start and collected $${total}.`
      + (bonus ? ' Last-place catch-up bonus included.' : '');
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

  // A collectStart card is a direct "advance to Start", so the exact-start branch applies: Double GO yields $400.
  // The card's own amount and the low-tax discount stay authoritative; only the catch-up bonus is added on top.
  collectStartCard(player, card) {
    this.recordPresentationMove(player, START_TILE_INDEX, { cause: 'collectStart' });
    player.position = START_TILE_INDEX;
    const paid = this.cardRewardAmount(card, this.startPassReward(true));
    const bonus = this.startPassCatchUpBonus(player);
    player.cash += paid + bonus;
    recordPresentationCash(this, 'go', this._activePresentation?.segments.at(-1)?.path.length - 1);
    this.feedMessage(this.startPassFeed(player, true, paid + bonus, bonus));
    return RESOLVE_TAIL;
  },

  collectCard(player, card) {
    const paid = this.cardRewardAmount(card, 200);
    player.cash += paid;
    this.feedMessage(`${player.nickname} collected $${paid}.`);
    return RESOLVE_TAIL;
  },

  payCard(player, card, options) {
    this.chargePlayer({ player, amount: card.amount, message: `${player.nickname} paid $${card.amount}.`, turnOptions: options });
    return undefined;
  },

  jailFreeCard(player) {
    this.ensurePrisonItems(player);
    this.grantItem(player, 'prison-key', 'card');
    this.feedMessage(`${player.nickname} received a Get Out of Prison card.`);
    return RESOLVE_TAIL;
  },

  itemRewardCard(player, card) {
    const item = this.grantItem(player, card.catalogId, 'card');
    if (item) this.feedMessage(`${player.nickname} received ${card.itemName || 'an item'}.`);
    return RESOLVE_TAIL;
  },

  moveBackCard(player, card, options) {
    this.recordPresentationMove(player, (player.position - (card.steps || 3) + this.tiles.length) % this.tiles.length, { cause: 'moveBack', direction: -1, steps: card.steps || 3 });
    player.position = (player.position - (card.steps || 3) + this.tiles.length) % this.tiles.length;
    this.feedMessage(`${player.nickname} moved back ${card.steps || 3} spaces.`);
    return this.applyTile(player, this.getTile(player.position), options);
  },

  moveToCard(player, card, options) {
    const destinationIndex = card.tileId && typeof this.tileIndexForId === 'function'
      ? this.tileIndexForId(card.tileId)
      : card.tileIndex;
    const destination = this.getTile(Number(destinationIndex));
    if (!destination) return RESOLVE_TAIL;
    this.recordPresentationMove(player, destination.index, { cause: 'moveTo' });
    this.awardStartSalaryIfPassed(player, destination);
    player.position = destination.index;
    this.feedMessage(`${player.nickname} advanced to ${destination.name}.`);
    return this.applyTile(player, destination, options);
  },

  moveCard(player, card, options) {
    const destinationIndex = card.tileId && typeof this.tileIndexForId === 'function'
      ? this.tileIndexForId(card.tileId)
      : card.tileIndex;
    const destTile = this.getTile(Number(destinationIndex));
    if (!destTile) return RESOLVE_TAIL;
    this.recordPresentationMove(player, destTile.index, { cause: 'move', teleport: true });
    player.position = destTile.index;
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
    this.recordPresentationMove(player, destination.index, { cause: card.action });
    this.awardStartSalaryIfPassed(player, destination);
    player.position = destination.index;
    const owner = destination.ownerId ? this.getPlayerById(destination.ownerId) : null;
    if (this.cardRentPayable(player, owner, destination)) {
      // Card rent is a landing too: record what applyTile would have recorded.
      this.recordLandingFacts(player, destination);
      this.recordAirportStrikeRentFacts(destination, owner);
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

  // Both card types stack their multiplier before the one event-and-cap step,
  // so the rent cap limits the amount charged, never the table rent it doubles.
  cardRentAmount(destination, card, wantedType) {
    if (wantedType === 'utility') {
      const base = this.diceTotal() * (card.multiplier || 10);
      return this.applyEventRentModifiers(base, destination);
    }
    return this.applyEventRentModifiers(this.baseTableRent(destination) * (card.multiplier || 2), destination);
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
    const parked = this.pendingPayment?.playerId === player.id ? Number(this.pendingPayment.amountRemaining) || 0 : 0;
    const queued = (this.pendingPaymentQueue || [])
      .filter(entry => entry?.payment?.playerId === player.id)
      .reduce((sum, entry) => sum + (Number(entry.payment.amountRemaining) || 0), 0);
    const outstanding = parked + queued;
    this.feedMessage(outstanding > 0
      ? `${player.nickname} paid $${total} to other players from the card and owes $${outstanding} more.`
      : `${player.nickname} paid $${total} to other players from the card.`);
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
    if (amount <= 0) return 0;
    if (player.cash < amount) {
      const cashBefore = player.cash;
      // Route short legs through the shared debt ladder. The ladder tenders
      // available cash now and parks the unpaid remainder (including later
      // recipients in its queue) instead of forgiving those legs.
      this.chargePlayer({
        player,
        creditor: other,
        amount,
        message: `${player.nickname} paid $${amount} to other players from the card.`,
        turnOptions: {}
      });
      this.settleCardRecipientDebt(other);
      return Math.max(0, cashBefore - player.cash);
    }
    const paid = Math.min(player.cash, amount);
    player.cash -= paid;
    other.cash += paid;
    // A card transfer that empties the payer is the same achievement as a
    // debt payment that empties it: the flag is set in both paths.
    if (player.cash === 0) player.zeroCashReached = true;
    this.settleCardRecipientDebt(other);
    return paid;
  },

  // Cash arriving from a card rescues a parked debt the way property, loan and trade credits do: only the seat owning the pending head
  // settles it. The guard stops a settling debt from re-entering the card path that triggered it.
  settleCardRecipientDebt(player) {
    if (!player) return;
    if (typeof this.trySettlePendingPayment !== 'function') return;
    const pending = this.pendingPayment;
    if (!pending || pending.playerId !== player.id) return;
    if (this._settlingCardDebt) return;
    this._settlingCardDebt = true;
    try {
      this.trySettlePendingPayment();
    } finally {
      this._settlingCardDebt = false;
    }
  },

  // Owner decision: keep the forgiveness (pinned by the collect-from-each check in card-rent-and-resolve.test.js). Each payer hands over
  // min(cash, amount), and the shortfall is forgiven: no debt is parked and no shortfall is announced. This is not the pay-each rule,
  // which parks an unpaid share as a debt (payEachShare calls chargePlayer).
  collectFromEachCard(player, card) {
    const amount = this.cardRewardAmount(card);
    const alive = this.activePlayers();
    alive.forEach(other => {
      if (other.id !== player.id) {
        const paid = Math.min(other.cash, amount);
        other.cash -= paid;
        // A payer emptied by the card reached zero cash: same flag as the
        // debt paths.
        if (other.cash === 0) other.zeroCashReached = true;
        player.cash += paid;
      }
    });
    // The collected cash can rescue the collector's own parked debt, exactly
    // as a pay-each share does for its recipient. Settle once, after every
    // payer has paid, so the whole collection is available.
    this.settleCardRecipientDebt(player);
    this.feedMessage(`${player.nickname} collected from each player.`);
    return RESOLVE_TAIL;
  },

  goToJailCard(player, options) {
    this.recordPresentationMove(player, this.tiles.find(tile => tile.type === 'jail').index, { cause: 'card-jail', teleport: true });
    player.position = this.tiles.find(tile => tile.type === 'jail').index;
    player.inJail = true;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} was sent to Jail by a card.`);
    this.resolveTurnAfterAction({ ...options, allowExtraRoll: false });
    return undefined;
  }
};

export { cardApi };
