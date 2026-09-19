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
import {
  coverShort,
  expansionCandidates,
  expansionGuard,
  exerciseOption,
  closeOption,
  forceLiquidate,
  integerAmount,
  maintenanceDue,
  marketInstrument,
  openMargin,
  openOption,
  openShort,
  reduceMargin,
  settleShortDefault
} from './marketExpansion.js';

const CASINO_MAX_BET = 500;
const CASINO_BET_COLORS = ['red', 'black', 'green'];
const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// Roulette mapping: pocket 0 is green, the rest split on the classic red set.
function roulettePocketColor(pocket) {
  if (pocket === 0) return 'green';
  return ROULETTE_RED.has(pocket) ? 'red' : 'black';
}

function casinoSnapshot(game, player, limits) {
  return {
    enabled: Boolean(game.settings.casino),
    maxBet: limits.maxBet,
    entryFee: limits.entryFee,
    lastResult: game.casinoLastResult ? { ...game.casinoLastResult } : null,
    net: Number(player?.casinoNet) || 0
  };
}

function marketSnapshot(game, player) {
  return {
    enabled: Boolean(game.settings.market),
    round: game.marketRound,
    feeRate: MARKET_FEE_RATE,
    quotes: { ...game.marketQuotes },
    positions: { ...(player?.marketPositions || {}) },
    complexity: game.settings.marketComplexity || 'basic',
    margin: player ? { balance: Number(player.marginBalance) || 0, maintenance: Number(player.marginMaintenance) || 0, collateral: Number(player.marginCollateral) || 0, positions: { ...(player.marginPositions || {}) } } : null,
    shorts: player ? { positions: { ...(player.shortPositions || {}) }, borrowable: { ...(game.marketShortInventory || {}) }, reservedCash: Number(player.reservedCash) || 0, defaultDebt: Number(player.shortDefaultDebt) || 0 } : null,
    optionReserve: Number(game.marketOptionReserve) || 0,
    options: player ? (player.optionPositions || []).map(option => ({ ...option })) : []
  };
}

function shortTradingPause(game) {
  return game.globalEventActive?.('credit-freeze') || game.globalEventActive?.('bank-run')
    ? 'New short positions are paused by the active global event.'
    : null;
}

function shortInventory(game) {
  game.marketShortInventory ||= Object.fromEntries(MARKET_INSTRUMENTS.map(entry => [entry.id, 50]));
  return game.marketShortInventory;
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
      casino: casinoSnapshot(this, player, casinoLimits),
      market: marketSnapshot(this, player)
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
      this.auction,
      this.pendingPurchaseOffer,
      this.pendingSponsoredPurchase,
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
    const spinId = crypto.randomUUID();
    const durationMs = 4_200;
    const presentation = {
      reelSeed: crypto.randomUUID(),
      targetIndex: 32,
      durationMs,
      revealDeadline: Date.now() + durationMs
    };
    return this.cacheTransaction(key, {
      success: true,
      result: { ...ledgerEntry, balanceAfter: player.cash, spinId, presentation },
      economy: this.economySnapshot(player.id)
    });
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
    if (!this.settings.market) return;
    this.recordTelemetryEvent?.('market-volatility', { roundNumber: this.marketRound, complexity: this.settings.marketComplexity || 'basic' });
    this.players.forEach(player => {
      if (player.bankrupt) return;
      const forced = forceLiquidate(this, player, this.marketShortInventory || (this.marketShortInventory = {}));
      if (forced.length) {
        this.feedMessage(`${player.nickname} faced ${forced.join(' and ')}.`);
        this.recordTelemetryEvent?.('market-liquidation', { actionCount: forced.length, actions: forced });
      }
    });
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
    ctx.player.marketPositions ||= {};
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
    this.recordTelemetryEvent?.('market-volatility', { action: ctx.direction, instrumentId: ctx.id, quantity: ctx.amount });
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
  },

  marketExpansionCandidates(player) {
    return expansionCandidates(this, player);
  },

  marginMaintenanceDue(player) {
    return maintenanceDue(this, player);
  },

  openMargin(socketId, instrumentId, quantity, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const instrument = marketInstrument(MARKET_INSTRUMENTS, instrumentId);
    const amount = integerAmount(quantity, 1000);
    const key = this.transactionKey(player?.id, 'margin-open', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const rejection = expansionGuard(this, player, 'margin', 'open');
    if (rejection) return { success: false, error: rejection };
    if (!instrument || !amount) return { success: false, error: 'Choose a valid margin order.' };
    const result = openMargin(this, player, instrument, amount);
    if (result.success) {
      player.marketActionsThisTurn = (player.marketActionsThisTurn || 0) + 1;
      this.marketLedger = [{ transactionId: key || crypto.randomUUID(), ...result, playerId: player.id, createdAt: new Date().toISOString() }, ...this.marketLedger].slice(0, 300);
      result.economy = this.economySnapshot(player.id);
      this.recordTelemetryEvent?.('market-volatility', { action: 'open-margin', instrumentId, quantity: amount });
      return this.cacheTransaction(key, result);
    }
    return result;
  },

  reduceMargin(socketId, amount, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const key = this.transactionKey(player?.id, 'margin-reduce', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const rejection = expansionGuard(this, player, 'margin', 'manage');
    if (rejection) return { success: false, error: rejection };
    const result = reduceMargin(player, integerAmount(amount, 1_000_000));
    if (result.success) {
      player.marketActionsThisTurn = (player.marketActionsThisTurn || 0) + 1;
      result.economy = this.economySnapshot(player.id);
      this.recordTelemetryEvent?.('market-volatility', { action: 'reduce-margin', amount: result.amount });
      return this.cacheTransaction(key, result);
    }
    return result;
  },

  openShort(socketId, instrumentId, quantity, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const instrument = marketInstrument(MARKET_INSTRUMENTS, instrumentId);
    const amount = integerAmount(quantity, 1000);
    const key = this.transactionKey(player?.id, 'short-open', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const rejection = expansionGuard(this, player, 'shorting', 'open');
    if (rejection) return { success: false, error: rejection };
    const pause = shortTradingPause(this);
    if (pause) return { success: false, error: pause };
    if (!instrument || !amount) return { success: false, error: 'Choose a valid short order.' };
    const result = openShort(this, player, { instrument, amount, inventory: shortInventory(this) });
    if (result.success) { player.marketActionsThisTurn = (player.marketActionsThisTurn || 0) + 1; player.marketTrades = (player.marketTrades || 0) + 1; result.economy = this.economySnapshot(player.id); this.recordTelemetryEvent?.('market-volatility', { action: 'open-short', instrumentId, quantity: amount }); return this.cacheTransaction(key, result); }
    return result;
  },

  coverShort(socketId, instrumentId, quantity, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const instrument = marketInstrument(MARKET_INSTRUMENTS, instrumentId);
    const amount = integerAmount(quantity, 1000);
    const key = this.transactionKey(player?.id, 'short-cover', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const rejection = expansionGuard(this, player, 'shorting', 'manage');
    if (rejection) return { success: false, error: rejection };
    if (!instrument || !amount) return { success: false, error: 'Choose a valid cover order.' };
    this.marketShortInventory ||= Object.fromEntries(MARKET_INSTRUMENTS.map(entry => [entry.id, 50]));
    const result = coverShort(this, player, { instrument, amount, inventory: this.marketShortInventory });
    if (result.success) {
      player.marketTrades = (player.marketTrades || 0) + 1;
      player.marketActionsThisTurn = (player.marketActionsThisTurn || 0) + 1;
      result.economy = this.economySnapshot(player.id);
      this.recordTelemetryEvent?.('market-volatility', { action: 'cover-short', instrumentId, quantity: amount });
      return this.cacheTransaction(key, result);
    }
    return result;
  },

  settleShortDefault(socketId, amount = null, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const key = this.transactionKey(player?.id, 'short-default-settle', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    if (!this.started || !player || player.bankrupt || player.disconnected) return { success: false, error: 'Market access is unavailable right now.' };
    if (Number(player.shortDefaultDebt) <= 0) return { success: false, error: 'There is no short buy-in debt to settle.' };
    const result = settleShortDefault(this, player, amount);
    if (result.success) result.economy = this.economySnapshot(player.id);
    return this.cacheTransaction(key, result);
  },

  openOption(socketId, payload = {}) {
    const player = this.getPlayerBySocket(socketId);
    const instrument = marketInstrument(MARKET_INSTRUMENTS, payload.instrumentId);
    const key = this.transactionKey(player?.id, 'option-open', payload.requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const rejection = expansionGuard(this, player, 'derivatives', 'open');
    if (rejection) return { success: false, error: rejection };
    if (!instrument) return { success: false, error: 'Choose a valid option instrument.' };
    const result = openOption(this, player, instrument, payload);
    if (result.success) {
      player.marketActionsThisTurn = (player.marketActionsThisTurn || 0) + 1;
      result.economy = this.economySnapshot(player.id);
      this.recordTelemetryEvent?.('market-volatility', { action: result.action, instrumentId: instrument.id, quantity: Number(payload.quantity) || 0 });
      return this.cacheTransaction(key, result);
    }
    return result;
  },

  exerciseOption(socketId, optionId, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const key = this.transactionKey(player?.id, 'option-exercise', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const rejection = expansionGuard(this, player, 'derivatives', 'manage');
    if (rejection) return { success: false, error: rejection };
    const result = exerciseOption(this, player, String(optionId || '').slice(0, 120));
    if (result.success) {
      player.marketActionsThisTurn = (player.marketActionsThisTurn || 0) + 1;
      result.economy = this.economySnapshot(player.id);
      this.recordTelemetryEvent?.('market-volatility', { action: 'exercise-option' });
      return this.cacheTransaction(key, result);
    }
    return result;
  },

  closePosition(socketId, optionId, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const key = this.transactionKey(player?.id, 'option-close', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const rejection = expansionGuard(this, player, 'derivatives', 'manage');
    if (rejection) return { success: false, error: rejection };
    const result = closeOption(this, player, String(optionId || '').slice(0, 120));
    if (result.success) {
      player.marketActionsThisTurn = (player.marketActionsThisTurn || 0) + 1;
      result.economy = this.economySnapshot(player.id);
      this.recordTelemetryEvent?.('market-volatility', { action: 'close-position' });
      return this.cacheTransaction(key, result);
    }
    return result;
  }
};

export { economyApi };
