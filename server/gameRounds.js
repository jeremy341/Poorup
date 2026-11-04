
import { createMarketQuotePoint } from './marketLogic.js';
import { ROUND_LIMIT, shuffleArray } from './gameData.js';
import { netWorth, netWorthBreakdown } from './netWorth.js';

// Net-worth rows kept per game; the stored match record keeps a downsampled copy of at most 40.
const NET_WORTH_TIMELINE_LIMIT = 400;

function endGameMessage(winner, reason) {
  if (reason === 'round-limit') {
    return winner ? 'Round limit reached - the richest player wins.' : 'Round limit reached - the game has ended.';
  }
  if (winner) return `${winner.nickname} is the last player remaining and wins the game!`;
  return 'The game has ended.';
}

export const gameRoundApi = {
  canJoin() {
    if (this.started) {
      return false;
    }
    // Every retained seat consumes capacity, bots included. A room that counts only active humans can exceed its advertised
    // seat limit after a round ends or when bots are kept for a rematch. Eliminated seats are revived by resetForNewGame,
    // so they hold capacity before a match too.
    return this.players.length < this.settings.maxPlayers;
  },

  activePlayers() {
    return this.players.filter(player => !player.bankrupt && !player.disconnected);
  },

  nonBankruptPlayers() {
    return this.players.filter(player => !player.bankrupt);
  },

  connectedNonBankruptPlayers() {
    return this.players.filter(player => !player.bankrupt && !player.disconnected);
  },

  configureStartOrder() {
    // Seats still in reconnect grace keep their turn-order slot: their turns
    // are skipped while they are away, exactly as mid-game, and resume if they
    // reconnect. The first turn goes to a connected seat.
    const active = [...this.players].filter(p => !p.bankrupt);
    if (this.settings.randomizePlayerOrder) {
      shuffleArray(active);
    }
    this.turnOrder = active.map(p => p.id);
    this.currentPlayerId = active.find(p => !p.disconnected)?.id || null;
    this.hasRolled = false;
    this.awaitingEndTurn = false;
  },

  startGame() {
    if (this.started) {
      return { success: false, error: 'Game has already started.' };
    }
    if (this.players.filter(player => !player.disconnected).length < 2) {
      return { success: false, error: 'At least two players are required.' };
    }
    this.resetForNewGame();
    this.started = true;
    this.startedAt = Date.now();
    this.configureStartOrder();
    this.feedMessage('The game begins. Players take turns clockwise.');
    return { success: true };
  },

  // Catch-up rule: strictly last by cash among 2+ live seats. Ties and
  // solo tables pay no bonus.
  liveContestants() {
    return (this.players || []).filter(entry => entry && !entry.bankrupt && !entry.disconnected);
  },

  // One row per finished round, keyed by player id because seats can leave mid-game. The final row
  // is taken after market positions are liquidated; a repeated round number replaces its row.
  recordNetWorthSnapshot() {
    const worth = {};
    this.players.forEach(player => { worth[player.id] = netWorth(this, player); });
    const timeline = Array.isArray(this.netWorthTimeline) ? this.netWorthTimeline : (this.netWorthTimeline = []);
    if (timeline.length && timeline[timeline.length - 1].round === this.roundNumber) timeline.pop();
    timeline.push({ round: this.roundNumber, worth });
    if (timeline.length > NET_WORTH_TIMELINE_LIMIT) timeline.splice(0, timeline.length - NET_WORTH_TIMELINE_LIMIT);
  },

  advanceRound() {
    if (this._advancingRound) return;
    this._advancingRound = true;
    try {
      // The round that just finished is the one the snapshot is labelled with.
      this.recordNetWorthSnapshot();
      this.roundNumber += 1;
      if (this.globalEventCooldown > 0) this.globalEventCooldown -= 1;
      this.markMidpointFacts();
      this.advanceGlobalEventPhase();
      this.processBankLoans();
      this.processPlayerContracts();
      this.maybeTriggerGlobalEvent();
      this.advanceMarket();
      if (this.settings.market) {
        const activeEventId = this.globalEvent?.phase === 'active' ? this.globalEvent.id : null;
        this.marketQuoteHistory = [...(Array.isArray(this.marketQuoteHistory) ? this.marketQuoteHistory : []), createMarketQuotePoint(this, this.marketRound, activeEventId)].slice(-128);
      }
      this.players.forEach(player => {
        player.rentPayersThisRound = new Set();
        player.casinoBetsThisRound = 0;
      });
      this.warnRoundLimit();
      // Ending here is safe for the turn callers: nextTurn and the seat-exit
      // path both check `started` before they seat the next player.
      this.endForRoundLimit();
    } finally {
      this._advancingRound = false;
    }
  },

  // The round limit is announced twice before it lands.
  warnRoundLimit() {
    if (this.roundNumber !== ROUND_LIMIT - 50 && this.roundNumber !== ROUND_LIMIT - 10) return;
    this.feedMessage(`The game ends after round ${ROUND_LIMIT}; richest player wins.`);
  },

  // Passing ROUND_LIMIT ends a running table through endGame when at least
  // two solvent seats remain. A lone solvent seat is left to the normal
  // bankruptcy path.
  endForRoundLimit() {
    if (!this.started || this.roundNumber <= ROUND_LIMIT) return false;
    const solvent = this.players.filter(player => this.isSolventSeat(player));
    if (solvent.length < 2) return false;
    // Rank on settled worth: endGame liquidates margin and shorts at a haircut,
    // so crowning on the pre-settlement quote could pick a seat that ends behind.
    // The liquidation is idempotent, so the pass inside endGame stays harmless.
    this.players.forEach(player => this.liquidateAllMarketPositions(player));
    this.endGame(this.richestSolventSeat(), { reason: 'round-limit' });
    return true;
  },

  isSolventSeat(player) {
    return Boolean(player) && !player.bankrupt && !player.inDebt && !this.hasPendingDebt(player.id);
  },

  // Richest connected solvent seat by netWorth (netWorth.js), marked to the current quote, less open debt.
  // A tie goes to the seat earlier in turn order.
  richestSolventSeat() {
    const orderedIds = [...new Set([...(this.turnOrder || []), ...this.players.map(player => player.id)])];
    let richest = null;
    let richestWorth = -Infinity;
    orderedIds.map(id => this.getPlayerById(id)).forEach(player => {
      if (!this.isSolventSeat(player) || player.disconnected) return;
      // Rank on the unclamped total: two negative seats both clamp to 0 on the
      // display value, which would hand the tie to turn order.
      const worth = netWorthBreakdown(this, player)?.total ?? 0;
      if (worth > richestWorth) {
        richest = player;
        richestWorth = worth;
      }
    });
    return richest;
  },

  finishIfNoConnectedPlayers(connected) {
    if (connected.length > 1) return false;
    const waiting = this.waitingSeat();
    if (waiting) {
      this.announceWaitingForSeat(waiting);
      return true;
    }
    this.endGame();
    return true;
  },

  endGame(crowned = null, { reason = null } = {}) {
    // A disconnected seat is not an eligible winner. If every solvent seat is offline, finish without crowning a ghost;
    // a supervisor can still retain the match record for diagnostics. The exception is the last solvent seat whose reconnect
    // grace ran out, which the runtime crowns explicitly (socketRuntime crownLoneSolventSeat).
    const winner = crowned || this.connectedNonBankruptPlayers().find(player => this.isSolventSeat(player)) || null;
    // Keep the score basis from the moment the winner is selected. In
    // particular, round-limit winners are chosen on net worth before the
    // end-of-game liquidation settles market positions.
    this.captureFinalNetWorth();
    this.recordEndedGlobalEvent();
    // Close the table's open obligations before the final snapshot: a cancelled
    // sponsorship refunds cash and a cleared claim does not subtract a debt
    // the ending table will never collect.
    this.cancelSponsoredPurchase();
    this.pendingPaymentQueue = [];
    this.clearPendingPayment(false);
    this.liquidateEndedGameAssets();
    this.recordNetWorthSnapshot();
    this.lastWinner = winner ? { id: winner.id, nickname: winner.nickname } : null;
    this.lastEndReason = reason;
    this.feedMessage(endGameMessage(winner, reason));
    this.resetTableAfterGameEnd();
    // The room owns the vote-kick, so it learns that the match is over here.
    this.onGameEnded?.();
  },

  captureFinalNetWorth() {
    this.finalNetWorthById = Object.fromEntries(this.players.map(player => [
      player.id,
      netWorthBreakdown(this, player)?.total ?? 0
    ]));
  },

  recordEndedGlobalEvent() {
    if (!this.globalEvent) return;
    const event = this.globalEvent;
    if (this.globalEventHistory.some(entry => entry.id === event.id && entry.startedRound === event.startedRound)) return;
    this.globalEventHistory.unshift({ id: event.id, title: event.title, comboId: event.comboId || null, startedRound: event.startedRound, endedRound: this.roundNumber });
  },

  // Margin, short and option equity is settled here, so no debt or
  // collateral is left open on a table that does not run.
  liquidateEndedGameAssets() {
    this.players.forEach(player => {
      this.liquidateAllMarketPositions(player);
      this.liquidateItems(player);
    });
  },

  resetTableAfterGameEnd() {
    this.started = false;
    this.currentPlayerId = null;
    this.hasRolled = false;
    this.pendingPurchaseOffer = null;
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPlayerContract = null;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.consecutiveDoubles = 0;
  }
};
