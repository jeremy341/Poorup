
import { JAIL_FINE, JAIL_MAX_TURNS, START_TILE_INDEX, rollDice } from './gameData.js';
import { recordPresentationCash } from './gamePresentation.js';

function isCurrentTurnPlayer(player, currentPlayerId) {
  if (!player) return false;
  return player.id === currentPlayerId;
}

function endTurnRequiresExtraRoll(game) {
  if (game.extraRollPending) return true;
  return Boolean(game.turnAllowsExtraRoll);
}

function isInReconnectGrace(player) {
  return Boolean(player) && Boolean(player.disconnected) && !player.bankrupt && Number(player.disconnectDeadline) > Date.now();
}

export const gameTurnApi = {
  rollTurnRejection(player) {
    const playerId = player?.id;
    const blocker = [
      [!playerId, 'Player not found.'],
      [!this.started, 'Game has not started.'],
      [playerId !== this.currentPlayerId, 'It is not your turn.'],
      [this.hasPendingDebt(playerId), 'Settle your debt before rolling.'],
      [this.pendingPurchaseOffer?.playerId === playerId, 'Resolve the property offer before rolling.'],
      [this.pendingSponsoredPurchase?.buyerId === playerId, 'Resolve the sponsorship before rolling.'],
      [Boolean(this.auction?.active), 'Finish the active auction before rolling.'],
    ].find(([blocked]) => blocked);
    return blocker ? { success: false, error: blocker[1] } : null;
  },

  setTurnDice(dice) {
    this.lastDice = dice;
    this.diceRollSequence += 1;
    this.hasRolled = true;
    this.turnAllowsExtraRoll = dice[0] === dice[1];
    this.extraRollPending = this.turnAllowsExtraRoll;
    if (this.turnAllowsExtraRoll) {
      this.consecutiveDoubles += 1;
    } else {
      this.consecutiveDoubles = 0;
    }
  },

  sendRollerToJail(player) {
    this.recordPresentationMove(player, this.tiles.find(tile => tile.type === 'jail').index, { cause: 'three-doubles', teleport: true });
    player.position = this.tiles.find(tile => tile.type === 'jail').index;
    player.inJail = true;
    player.jailTurns = 0;
    this.consecutiveDoubles = 0;
    this.turnAllowsExtraRoll = false;
    this.extraRollPending = false;
    this.hasRolled = false;
    this.feedMessage(`${player.nickname} rolled three doubles and was sent to Jail.`);
    this.nextTurn();
    return { success: true };
  },

  handleJailRoll(player) {
    if (this.hasRolled && !this.extraRollPending) {
      return { success: false, error: 'You have already rolled this turn.' };
    }
    const dice = rollDice();
    this.lastDice = dice;
    this.diceRollSequence += 1;
    this.hasRolled = true;
    this.turnAllowsExtraRoll = false;
    this.extraRollPending = false;
    this.consecutiveDoubles = 0;
    if (dice[0] === dice[1]) {
      player.inJail = false;
      player.jailTurns = 0;
      this.feedMessage(`${player.nickname} rolled doubles and escaped jail!`);
      return this.movePlayer(player, dice[0] + dice[1], { allowExtraRoll: false });
    }
    player.jailTurns = (player.jailTurns || 0) + 1;
    if (player.jailTurns >= JAIL_MAX_TURNS) {
      if (player.cash >= JAIL_FINE) {
        player.cash -= JAIL_FINE;
        player.inJail = false;
        player.jailTurns = 0;
        this.feedMessage(`${player.nickname} paid $${JAIL_FINE} to leave jail after ${JAIL_MAX_TURNS} turns.`);
        return this.movePlayer(player, dice[0] + dice[1], { allowExtraRoll: false });
      }
      this.feedMessage(`${player.nickname} could not pay the jail fine and remains in jail. Mortgage, sell buildings, or declare bankruptcy to raise the fine.`);
    } else {
      this.feedMessage(`${player.nickname} failed to roll doubles in jail (turn ${player.jailTurns}/${JAIL_MAX_TURNS}).`);
    }
    this.awaitingEndTurn = true;
    return { success: true, message: 'You remain in jail. End your turn when ready.' };
  },

  payJailFine(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    if (!this.started) {
      return { success: false, error: 'Game has not started.' };
    }
    if (player.id !== this.currentPlayerId) {
      return { success: false, error: 'It is not your turn.' };
    }
    if (!player.inJail) {
      return { success: false, error: 'You are not in jail.' };
    }
    if (this.hasRolled) {
      return { success: false, error: 'You have already rolled this turn.' };
    }
    if (this.hasPendingDebt(player.id)) {
      return { success: false, error: 'Settle your debt before paying the jail fine.' };
    }
    if (player.cash < JAIL_FINE) {
      return { success: false, error: `You need $${JAIL_FINE} to pay the jail fine.` };
    }
    player.cash -= JAIL_FINE;
    player.inJail = false;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} paid $${JAIL_FINE} to leave jail.`);
    return { success: true, message: 'You left jail. Roll the dice to move.' };
  },

  useJailFree(socketId, itemId = null) {
    const player = this.getPlayerBySocket(socketId);
    const rejection = this.jailFreeRejection(player);
    if (rejection) return rejection;
    if (!this.consumePrisonItem(player, itemId)) return { success: false, error: 'You do not own this prison card.' };
    player.prisonBreak = true;
    player.inJail = false;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} used a Get Out of Prison card.`);
    return { success: true, message: 'You left prison with a Get Out of Prison card.' };
  },

  jailFreeRejection(player) {
    const notTurn = { success: false, error: 'It is not your turn.' };
    if (!player) return notTurn;
    if (!this.started) return notTurn;
    if (player.id !== this.currentPlayerId) return notTurn;
    if (!player.inJail) return { success: false, error: 'You do not have a Get Out of Prison card.' };
    if (!(player.jailFreeCards > 0)) return { success: false, error: 'You do not have a Get Out of Prison card.' };
    if (this.hasRolled) return { success: false, error: 'You have already rolled this turn.' };
    return null;
  },

  handleFortyFirstMove(player) {
    player.moveCount = (player.moveCount || 0) + 1;
    if (player.moveCount !== 41) return;
    player.hiddenMovementSequence = true;
    this.feedMessage(`${player.nickname} stepped on the 41st movement. The ledger skipped a line.`);
  },

  startPassReward(exactStart) {
    if (exactStart && this.settings.doubleGo) return 400;
    return 200;
  },

  awardStartPass(player, oldPosition, steps) {
    const distanceToStart = (START_TILE_INDEX - oldPosition + this.tiles.length) % this.tiles.length || this.tiles.length;
    if (distanceToStart > steps) return;
    const exactStart = distanceToStart === steps;
    const reward = this.startPassReward(exactStart);
    const bonus = this.isLastPlaceByCash(player) ? 100 : 0;
    player.cash += reward + bonus;
    recordPresentationCash(this, 'go', distanceToStart - 1);
    this.feedMessage(`${player.nickname} ${exactStart ? 'landed on' : 'passed'} Start and collected $${reward + bonus}.` + (bonus ? ' Last-place catch-up bonus included.' : ''));
  },

  trackRailroadVisit(player, tile) {
    if (tile?.type !== 'railroad') return;
    if (!(player.airportVisits instanceof Set)) player.airportVisits = new Set();
    player.airportVisits.add(tile.index);
  },

  movePlayer(player, steps, options = {}) {
    this.handleFortyFirstMove(player);
    const oldPosition = player.position;
    this.recordPresentationMove(player, (player.position + steps) % this.tiles.length, { cause: 'dice', steps });
    player.position = (player.position + steps) % this.tiles.length;
    this.awardStartPass(player, oldPosition, steps);
    const tile = this.getTile(player.position);
    this.trackRailroadVisit(player, tile);
    return this.applyTile(player, tile, options);
  },

  resolveTurnAfterAction({ allowExtraRoll = true } = {}) {
    if (allowExtraRoll && this.turnAllowsExtraRoll) {
      this.extraRollPending = true;
      this.hasRolled = false;
      return { retainedTurn: true };
    }

    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    // Explicit end-of-turn: the landing resolved, but the dice only pass when
    // the active player ends the turn (endTurn below). Bots and the AFK
    // watchdog reach the same door via room.endTurn()/nextTurn().
    this.awaitingEndTurn = true;
    return { retainedTurn: false };
  },

  resetTurnState() {
    if (this.pendingSponsoredPurchase) this.cancelSponsoredPurchase();
    this.pendingPurchaseOffer = null;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.lastFlight = null;
  },

  // A non-bankrupt seat still inside its reconnect grace: the table waits on it.
  waitingSeat() {
    return this.players.find(player => player.disconnected
      && Number(player.disconnectDeadline) > Date.now()
      && !player.bankrupt) || null;
  },

  advanceWrappedTurn(next) {
    if (this.turnOrderWrapped(next)) this.advanceRound();
  },

  // The first seat after the current one that is inside its reconnect grace; the
  // table waits on it, so it is the seat the clock must rest on.
  nextWaitingSeat() {
    const order = this.turnOrder;
    const start = order.indexOf(this.currentPlayerId);
    for (let step = 1; step <= order.length; step += 1) {
      const player = this.getPlayerById(order[(start + step + order.length) % order.length]);
      if (isInReconnectGrace(player)) return player;
    }
    return this.waitingSeat();
  },

  // With nobody else able to play, a turn ending while a seat is in its reconnect grace hands that seat the clock with a fresh turn.
  // Leaving it on the finished seat wedged the table: that seat had already rolled, the returning seat was "not on turn", and nothing
  // re-advanced the clock on return. Moving the clock around the end of the order still completes the round.
  parkTurnOnWaitingSeat(waiting) {
    const currentIndex = this.turnOrder.indexOf(this.currentPlayerId);
    const waitingIndex = this.turnOrder.indexOf(waiting.id);
    const wrapped = waiting.id !== this.currentPlayerId && currentIndex >= 0 && waitingIndex >= 0 && waitingIndex <= currentIndex;
    if (wrapped) this.advanceRound();
    if (!this.started) return;
    this.beginSeatTurn(waiting);
    this.announceWaitingForSeat(waiting);
  },

  nextTurn() {
    this.resetTurnState();
    const connected = this.connectedNonBankruptPlayers();
    const waiting = connected.length <= 1 ? this.nextWaitingSeat() : null;
    if (waiting) {
      this.parkTurnOnWaitingSeat(waiting);
      return;
    }
    if (this.finishIfNoConnectedPlayers(connected)) return;
    const next = this.findNextTurnSeat();
    if (!this.nextSeatIsPlayable(next)) {
      this.announceWaitingForSeat(next.player);
      return;
    }
    this.advanceWrappedTurn(next);
    if (!this.started) return;
    this.beginSeatTurn(next.player);
  },

  findNextTurnSeat() {
    const currentIndex = this.turnOrder.indexOf(this.currentPlayerId);
    let nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % this.turnOrder.length;
    let nextPlayer = this.getPlayerById(this.turnOrder[nextIndex]);
    let attempts = 0;
    while (this.seatIsIdle(nextPlayer) && attempts < this.turnOrder.length) {
      nextIndex = (nextIndex + 1) % this.turnOrder.length;
      nextPlayer = this.getPlayerById(this.turnOrder[nextIndex]);
      attempts += 1;
    }
    return { currentIndex, nextIndex, player: nextPlayer };
  },

  seatIsIdle(player) {
    if (!player) return false;
    return Boolean(player.bankrupt || player.disconnected);
  },

  nextSeatIsPlayable(next) {
    if (!next.player) return false;
    if (next.player.bankrupt) return false;
    return !next.player.disconnected;
  },

  announceWaitingForSeat(waiting = null) {
    waiting ||= this.getPlayerById(this.currentPlayerId);
    if (!waiting) return;
    if (waiting.bankrupt) return;
    this.feedMessage(`Waiting for ${waiting.nickname} to reconnect…`);
  },

  turnOrderWrapped(next) {
    if (next.currentIndex < 0) return false;
    return next.nextIndex <= next.currentIndex;
  },

  beginSeatTurn(player) {
    this.currentPlayerId = player.id;
    this.hasRolled = false;
    // The doubles streak belongs to the seated roller. A turn that ended on
    // doubles without an extra roll (Go to Prison, a jail card, a disconnect
    // skip) must not hand its count to the successor.
    this.consecutiveDoubles = 0;
    player.botDealActionsThisTurn = 0;
    player.buildActionsThisTurn = 0;
    player.marketActionsThisTurn = 0;
    this.feedMessage(`${player.nickname}'s turn.`);
  },

  endTurn(socketId) {
    const player = this.getPlayerBySocket(socketId);
    const rejection = this.endTurnRejection(player);
    if (rejection) return rejection;
    this.nextTurn();
    return { success: true };
  },

  endTurnRejection(player) {
    const notActive = { success: false, error: 'Only the active player can end the turn.' };
    if (!isCurrentTurnPlayer(player, this.currentPlayerId)) return notActive;
    if (endTurnRequiresExtraRoll(this)) return { success: false, error: 'You must roll again after doubles before ending your turn.' };
    if (!this.awaitingEndTurn) return { success: false, error: 'Resolve your roll before ending the turn.' };
    const flowRejection = this.pendingFlowRejection(player);
    if (flowRejection) return flowRejection;
    if (!player.bankrupt && !(Number(player.cash) > 0)) {
      return { success: false, error: 'Raise cash or declare bankruptcy before ending the turn.' };
    }
    return null;
  },

  pendingFlowRejection(player) {
    const error = this.pendingFlowError(player);
    return error ? { success: false, error } : null;
  },

  pendingFlowError(player) {
    const blockers = [
      [Boolean(this.auction?.active), 'Finish the active auction before ending the turn.'],
      [this.pendingPurchaseOffer?.playerId === player?.id, 'Resolve the property offer before ending the turn.'],
      [this.hasPendingDebt(player?.id), 'Settle your debt before ending the turn.'],
      [Boolean(this.pendingSponsoredPurchase), 'Resolve the open sponsorship before ending the turn.']
    ];
    const blocker = blockers.find(([active]) => active);
    return blocker?.[1] || null;
  },

  skipDisconnectedCurrentPlayer() {
    const current = this.getCurrentPlayer();
    if (!current) return;
    if (!current.disconnected) return;
    if (current.bankrupt) return;
    // A parked debt travels with the seat: route it through bankruptcy
    // instead of orphaning the creditor's claim until reconnect.
    if (this.pendingPayment?.playerId === current.id && !current.bankrupt) {
      const creditor = this.pendingPayment.creditorId ? this.getPlayerById(this.pendingPayment.creditorId) : null;
      return this.handleBankruptcy(current, creditor);
    }
    this.pendingPurchaseOffer = null;
    this.feedMessage(`${current.nickname} was skipped due to disconnect.`);
    this.nextTurn();
  }
};
