// Index market: the quote drift ladder (advanceMarket), the order-validation
// gate chain, and the buy/sell legs that move cash and update positions. Pure
// module: the order legs receive a context object and mutate only the GameState
// and player they are handed.
import { randomFloat } from './random.js';

export const MARKET_FEE_RATE = 0.02;
export const MARKET_SIDES = ['buy', 'sell'];
export const MARKET_INSTRUMENTS = [
  ['brazil', 'BRAZIL', 100], ['ghana', 'GHANA', 100], ['thailand', 'THAILAND', 100],
  ['japan', 'JAPAN', 100], ['netherlands', 'NETHERLANDS', 100], ['canada', 'CANADA', 100],
  ['switzerland', 'SWITZERLAND', 100], ['singapore', 'SINGAPORE', 100],
  ['airports', 'AIRPORTS', 100], ['utilities', 'UTILITIES', 100], ['property', 'PROPERTY', 100]
].map(([id, name, price]) => ({ id, name, price }));

// Order gates run in the exact historical check order;
// server/contracts-market.test.js pins every string.
export const MARKET_ORDER_GUARDS = [
  { test: game => !game.settings.market, error: 'Market access is off for this room.' },
  { test: (game, player) => !game.started || !player || player.bankrupt || player.disconnected, error: 'Market access is unavailable right now.' },
  { test: (game, player) => player.id !== game.currentPlayerId, error: 'Market orders are available during your turn.' },
  { test: (game, player) => (player.marketActionsThisTurn || 0) >= 1, error: 'You have already placed a market order this turn.' },
  { test: game => game.pendingPayment || game.auction || game.pendingTrade || game.pendingPlayerContract, error: 'Resolve the table obligation before trading.' },
  { test: game => game.activeEventEffects().tradingEnabled === false, error: 'Market trading is paused by the active global event.' }
];

export function freshMarketQuotes() {
  return Object.fromEntries(MARKET_INSTRUMENTS.map(instrument => [instrument.id, instrument.price]));
}

function marketSpread(game) {
  const volatility = Number(game.activeEventEffects().marketVolatility);
  if (Number.isFinite(volatility)) {
    if (volatility > 0) return 0.06 * volatility;
  }
  return 0.06;
}

function marketPriceModifier(game) {
  const eventMultiplier = Number(game.activeEventEffects().marketPriceMultiplier);
  if (Number.isFinite(eventMultiplier)) {
    if (eventMultiplier > 0) return eventMultiplier;
  }
  return 1;
}

export function advanceMarket(game) {
  if (!game.settings.market) return;
  game.marketRound += 1;
  const spread = marketSpread(game);
  const modifier = marketPriceModifier(game);
  Object.keys(game.marketQuotes).forEach((id) => {
    const drift = (randomFloat() * (spread * 2)) - spread;
    game.marketQuotes[id] = Math.max(10, Math.round(game.marketQuotes[id] * (1 + drift) * modifier));
  });
}

function unknownMarketOrder(ctx) {
  if (!ctx.instrument) return true;
  return !MARKET_SIDES.includes(ctx.direction);
}

function invalidMarketQuantity(amount) {
  if (!Number.isInteger(amount)) return true;
  if (amount < 1) return true;
  return amount > 1000;
}

export function marketOrderRejection(ctx) {
  const guard = MARKET_ORDER_GUARDS.find(entry => entry.test(ctx.game, ctx.player));
  if (guard) return { success: false, error: guard.error };
  if (unknownMarketOrder(ctx)) return { success: false, error: 'Choose a valid market order.' };
  if (invalidMarketQuantity(ctx.amount)) return { success: false, error: 'Quantity must be between 1 and 1,000.' };
  return null;
}

function recordCrisisBuy(ctx) {
  const eventMultiplier = Number(ctx.game.activeEventEffects().marketPriceMultiplier);
  if (ctx.game.globalEvent?.phase !== 'active') return;
  if (!Number.isFinite(eventMultiplier)) return;
  if (eventMultiplier >= 1) return;
  ctx.player.crisisMarketBuys[ctx.id] ||= { quote: ctx.quote, roundNumber: ctx.game.roundNumber };
}

export function applyMarketBuy(ctx) {
  const total = ctx.gross + ctx.fee;
  if (ctx.player.cash < total) return { success: false, error: 'Not enough cash for this order.' };
  if (ctx.game.hasLoanBackedCash(ctx.player)) return { success: false, error: 'Loan-backed cash cannot be used for market orders.' };
  const { position } = ctx;
  ctx.player.cash -= total;
  position.averageCost = ((position.averageCost * position.quantity) + ctx.gross + ctx.fee) / (position.quantity + ctx.amount);
  position.quantity += ctx.amount;
  recordCrisisBuy(ctx);
  return null;
}

function recordCrisisProfit(ctx) {
  const crisisBuy = ctx.player.crisisMarketBuys?.[ctx.id];
  if (!crisisBuy) return;
  if (ctx.quote <= Number(crisisBuy.quote || 0)) return;
  if (ctx.game.globalEvent?.phase === 'active') return;
  ctx.player.crisisMarketProfit = true;
  delete ctx.player.crisisMarketBuys[ctx.id];
}

export function applyMarketSell(ctx) {
  const { position } = ctx;
  if (position.quantity < ctx.amount) return { success: false, error: 'You do not hold enough of this index.' };
  ctx.player.cash += ctx.gross - ctx.fee;
  position.realizedPnl += (ctx.quote - position.averageCost) * ctx.amount - ctx.fee;
  position.quantity -= ctx.amount;
  recordCrisisProfit(ctx);
  if (!position.quantity) position.averageCost = 0;
  return null;
}
