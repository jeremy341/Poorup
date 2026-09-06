// The two wager economies as a prototype mixin: the roulette casino and the
// index market, plus the shared transaction-replay cache and the economy
// snapshot both flows return to the client. gameLogic.js assigns this object
// onto GameState.prototype; server/casino-bankruptcy.test.js and
// server/contracts-market.test.js pin every guard string, fee rounding, and
// ledger shape.
import crypto from 'crypto';
import { randomInt } from './random.js';
import {
  MARKET_FEE_RATE,
  MARKET_INSTRUMENTS,
  advanceMarket as stepMarketQuotes,
  applyMarketBuy as marketBuyLeg,
  applyMarketSell as marketSellLeg,
  marketOrderRejection as rejectMarketOrder
} from './marketLogic.js';
import { hasLoanBackedCash as cashIsLoanBacked } from './loanLogic.js';

const CASINO_MAX_BET = 500;
const CASINO_BET_COLORS = ['red', 'black', 'green'];
const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// Roulette mapping: pocket 0 is green, the rest split on the classic red set.
function roulettePocketColor(pocket) {
  if (pocket === 0) return 'green';
  return ROULETTE_RED.has(pocket) ? 'red' : 'black';
}

const economyApi = {
  casinoLimits() {
    const effects = this.activeEventEffects();
    const maxBet = Number(effects.casinoMaxBet);
    const entryFee = Number(effects.casinoEntryFee);
    return {
      maxBet: Number.isFinite(maxBet) && maxBet > 0 ? Math.min(CASINO_MAX_BET, Math.floor(maxBet)) : CASINO_MAX_BET,
      entryFee: Number.isFinite(entryFee) && entryFee > 0 ? Math.floor(entryFee) : 0
    };
  },

  transactionKey(playerId, kind, requestId) {
    const value = String(requestId || '').trim().slice(0, 100);
    return value ? `${playerId}:${kind}:${value}` : null;
  },

  cachedTransaction(key) {
    return key ? this.economyTransactions.get(key) || null : null;
  },

  cacheTransaction(key, result) {
    if (key) this.economyTransactions.set(key, result);
    return result;
  },

  economySnapshot(playerId = null) {
    const player = playerId ? this.getPlayerById(playerId) : null;
    const casinoLimits = this.casinoLimits();
    return {
      casino: {
        enabled: Boolean(this.settings.casino),
        maxBet: casinoLimits.maxBet,
        entryFee: casinoLimits.entryFee,
        lastResult: this.casinoLastResult ? { ...this.casinoLastResult } : null,
        net: Number(player?.casinoNet) || 0
      },
      market: {
        enabled: Boolean(this.settings.market),
        round: this.marketRound,
        feeRate: MARKET_FEE_RATE,
        quotes: { ...this.marketQuotes },
        positions: { ...(player?.marketPositions || {}) }
      }
    };
  },

  placeCasinoBet(socketId, color, stake, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const choice = String(color || '').toLowerCase();
    const amount = Math.floor(Number(stake));
    const key = this.transactionKey(player?.id, 'casino', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const rejection = this.casinoBetRejection(player, choice, amount);
    if (rejection) return { success: false, error: rejection };
    return this.settleCasinoBet(player, choice, amount, key);
  },

  // Guard ladder kept in the original precedence order: the session rules
  // first, then the wager itself. Returns the exact client-facing error
  // string, or null when the bet may be settled.
  casinoBetRejection(player, choice, amount) {
    return this.casinoSessionRejection(player) || this.casinoWagerRejection(player, choice, amount);
  },

  casinoSessionRejection(player) {
    if (!this.settings.casino) return 'Casino access is off for this room.';
    if (this.casinoSessionBlocked(player)) return 'Casino access is unavailable right now.';
    if (this.tableObligationPending()) return 'Resolve the table obligation before betting.';
    return null;
  },

  // Casino access needs a live, started table and a seated, solvent,
  // connected player; any of those missing reads as "unavailable".
  casinoSessionBlocked(player) {
    if (!this.started) return true;
    if (!player) return true;
    if (player.bankrupt) return true;
    return Boolean(player.disconnected);
  },

  // A single "is the table busy" question: any of the five pending flows
  // keeps players away from the casino wheel.
  tableObligationPending() {
    return [
      this.pendingPayment,
      this.auction,
      this.pendingPurchaseOffer,
      this.pendingTrade,
      this.pendingPlayerContract
    ].some(Boolean);
  },

  casinoWagerRejection(player, choice, amount) {
    if (!CASINO_BET_COLORS.includes(choice)) return 'Choose red, black, or green.';
    const limits = this.casinoLimits();
    if (this.casinoStakeRejected(amount, limits)) return `Stake must be between $1 and ${limits.maxBet}.`;
    if (this.hasLoanBackedCash(player)) return 'Loan-backed cash cannot enter the casino.';
    if (player.cash < amount + limits.entryFee) return 'You do not have enough available cash for the stake and event fee.';
    return null;
  },

  // Stakes arrive already floored by the caller; whole-dollar stakes inside
  // the event-aware limit are the only ones accepted.
  casinoStakeRejected(amount, limits) {
    if (!Number.isInteger(amount)) return true;
    if (amount < 1) return true;
    return amount > limits.maxBet;
  },

  hasLoanBackedCash(player) {
    return cashIsLoanBacked(player);
  },

  // The spin itself: one pocket draw (randomInt is the only RNG call site on
  // this path), 35:1 on green and 1:1 on the colors, fees taken on both
  // sides of the outcome.
  settleCasinoBet(player, choice, amount, key) {
    const limits = this.casinoLimits();
    const cashBefore = player.cash;
    const pocket = randomInt(0, 36);
    const resultColor = roulettePocketColor(pocket);
    const won = choice === resultColor;
    const payout = choice === 'green' ? 35 : 1;
    const net = won ? amount * payout - limits.entryFee : -amount - limits.entryFee;
    player.cash -= amount + limits.entryFee;
    if (won) player.cash += amount + (amount * payout);
    this.applyCasinoTally(player, { amount, net, entryFee: limits.entryFee, cashBefore });
    const ledgerEntry = { transactionId: key || crypto.randomUUID(), roundNumber: this.roundNumber, color: choice, pocket, resultColor, stake: amount, net, createdAt: new Date().toISOString() };
    this.recordCasinoLedger(player, ledgerEntry);
    this.casinoLastResult = { playerId: player.id, color: choice, pocket, resultColor, net, roundNumber: this.roundNumber };
    this.feedMessage(`${player.nickname} bet $${amount} on ${choice.toUpperCase()} and ${won ? 'won' : 'lost'} $${Math.abs(net)}.`);
    return this.cacheTransaction(key, { success: true, result: { ...ledgerEntry, balanceAfter: player.cash }, economy: this.economySnapshot(player.id) });
  },

  // Bankroll facts: max/total staked, the sticky all-in and one-dollar
  // markers, and the per-round bet counter.
  applyCasinoTally(player, bet) {
    player.casinoNet += bet.net;
    player.casinoMaxStake = Math.max(player.casinoMaxStake || 0, bet.amount);
    player.casinoTotalStaked = (player.casinoTotalStaked || 0) + bet.amount;
    player.casinoAllIn = player.casinoAllIn || bet.amount + bet.entryFee >= bet.cashBefore;
    player.casinoOneDollar = player.casinoOneDollar || bet.amount === 1;
    player.casinoBetsThisRound = (player.casinoBetsThisRound || 0) + 1;
  },

  // Newest-first ledgers: the room keeps a wide copy stamped with the
  // playerId, the player a bare personal history.
  recordCasinoLedger(player, ledgerEntry) {
    this.casinoLedger = [{ ...ledgerEntry, playerId: player.id }, ...this.casinoLedger].slice(0, 200);
    player.casinoLedger = [ledgerEntry, ...(player.casinoLedger || [])].slice(0, 50);
  },

  advanceMarket() {
    stepMarketQuotes(this);
  },

  tradeMarket(socketId, ...order) {
    const ctx = this.marketOrderContext(socketId, order);
    const cached = this.cachedTransaction(ctx.key);
    if (cached) return cached;
    const rejection = this.marketOrderRejectionFor(ctx);
    if (rejection) return rejection;
    return this.executeMarketOrder(ctx);
  },

  marketOrderContext(socketId, order) {
    const [instrumentId, side, quantity, requestId = null] = order;
    const player = this.getPlayerBySocket(socketId);
    return {
      player,
      id: String(instrumentId || '').toLowerCase(),
      direction: String(side || '').toLowerCase(),
      amount: Math.floor(Number(quantity)),
      key: this.transactionKey(player?.id, 'market', requestId)
    };
  },

  marketOrderRejectionFor(ctx) {
    ctx.instrument = MARKET_INSTRUMENTS.find(entry => entry.id === ctx.id);
    return this.marketOrderRejection(ctx.player, ctx.instrument, ctx.direction, ctx.amount);
  },

  marketOrderPlan(instrument, id, amount) {
    const quote = Number(this.marketQuotes[id]) || instrument.price;
    const gross = quote * amount;
    const fee = Math.max(1, Math.ceil(gross * MARKET_FEE_RATE));
    return { quote, gross, fee, amount };
  },

  executeMarketOrder(ctx) {
    const plan = this.marketOrderPlan(ctx.instrument, ctx.id, ctx.amount);
    const position = ctx.player.marketPositions[ctx.id] || { quantity: 0, averageCost: 0, realizedPnl: 0 };
    const leg = ctx.direction === 'buy' ? this.applyMarketBuy : this.applyMarketSell;
    const legRejection = leg.call(this, ctx.player, ctx.id, position, plan);
    if (legRejection) return legRejection;
    return this.commitMarketOrder(ctx, position, plan);
  },

  commitMarketOrder(ctx, position, plan) {
    const { player, id, key } = ctx;
    player.marketPositions[id] = position;
    player.marketTrades = (player.marketTrades || 0) + 1;
    player.marketActionsThisTurn = (player.marketActionsThisTurn || 0) + 1;
    this.recordMarketLedger(ctx, plan);
    this.feedMessage(this.marketFeedLine(ctx));
    const result = { success: true, order: this.marketOrderReceipt(ctx, plan), economy: this.economySnapshot(player.id) };
    return this.cacheTransaction(key, result);
  },

  recordMarketLedger(ctx, plan) {
    const entry = {
      transactionId: ctx.key || crypto.randomUUID(),
      roundNumber: this.roundNumber,
      playerId: ctx.player.id,
      instrumentId: ctx.id,
      side: ctx.direction,
      quantity: ctx.amount,
      quote: plan.quote,
      fee: plan.fee,
      createdAt: new Date().toISOString()
    };
    this.marketLedger = [entry, ...this.marketLedger].slice(0, 300);
  },

  marketFeedLine(ctx) {
    const verb = ctx.direction === 'buy' ? 'bought' : 'sold';
    const unit = ctx.amount === 1 ? '' : 's';
    return `${ctx.player.nickname} ${verb} ${ctx.amount} ${ctx.instrument.name} index unit${unit}.`;
  },

  marketOrderReceipt(ctx, plan) {
    const total = ctx.direction === 'buy' ? plan.gross + plan.fee : plan.gross - plan.fee;
    return { instrumentId: ctx.id, side: ctx.direction, quantity: ctx.amount, quote: plan.quote, fee: plan.fee, total };
  },

  marketOrderRejection(player, instrument, direction, amount) {
    return rejectMarketOrder({ game: this, player, instrument, direction, amount });
  },

  applyMarketBuy(player, id, position, order) {
    return marketBuyLeg({ game: this, player, id, position, ...order });
  },

  applyMarketSell(player, id, position, order) {
    return marketSellLeg({ game: this, player, id, position, ...order });
  }
};

export { economyApi };
