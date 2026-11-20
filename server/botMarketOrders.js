// Bot market orders: spot buys, sells of held positions, and the shared "may the bot trade right now" gates.
import { forecastMarketOrder, marketForecastContext } from './botMarketForecast.js';

// Opening-book helper: a complete set means ahead enough to speculate.
function holdsCompleteSet(game, player) {
  const groups = [...new Set((player?.properties || []).map(index => game.getTile(index)?.group).filter(Boolean))];
  return groups.some(group => {
    try {
      return game.hasFullSet(player.id, group) === true;
    } catch {
      return false;
    }
  });
}

// The engine refuses market orders and casino bets while a payment, auction, purchase, sponsorship, trade or
// contract is open (marketLogic.js, economyApi.js), including the bot's own offer, so offering them only burns the tick.
// The deal collectors use the narrower tableObligationOpen (botContractPolicy.js): a pending payment never blocks a deal.
export function engineTableObligationPending(game) {
  return typeof game.tableObligationPending === 'function' && game.tableObligationPending();
}

export function marketTradingOpen(game) {
  if (!game.settings.market) return false;
  if (game.activeEventEffects?.().tradingEnabled === false) return false;
  return true;
}

function marketActionAvailable(game, player) {
  if ((player.marketActionsThisTurn || 0) >= 1) return false;
  if (Number(game.consecutiveDoubles || 0) >= 2) return false;
  return true;
}

// Opening book laps 1-3: deeds only, unless already holding a complete
// set (ahead: speculation allowed).
function marketBuyOpeningBook(game, player) {
  if (Number(game.roundNumber || 99) > 3) return true;
  return holdsCompleteSet(game, player);
}

function marketBuyEligible(game, player) {
  if (!marketTradingOpen(game)) return false;
  if (!marketActionAvailable(game, player)) return false;
  return marketBuyOpeningBook(game, player);
}

function marketPositionQuantity(position) {
  return Math.max(0, Math.floor(Number(position?.quantity) || 0));
}

function marketSellWanted(game, player, profitable) {
  if (profitable) return true;
  const startingCash = Number(game.settings.startingCash || 1500);
  return Number(player.cash || 0) <= startingCash * 0.35;
}

function marketSellCandidate(game, player, id, position) {
  const quantity = marketPositionQuantity(position);
  if (!quantity) return null;
  const quote = Number(game.marketQuotes?.[id]);
  if (!Number.isInteger(quote) || quote <= 0) return null;
  const average = Number(position.averageCost) || quote;
  const profitable = quote > average;
  if (!marketSellWanted(game, player, profitable)) return null;
  const quoteForecast = forecastMarketOrder({
    instrumentId: id,
    quote,
    quantity,
    side: 'sell',
    ...marketForecastContext(game)
  });
  return {
    id: 'market:sell:' + id,
    kind: 'market', instrumentId: id, side: 'sell', quantity,
    risk: quoteForecast.volatilityPercent,
    score: quoteForecast.expectedPnl,
    expectedMarketPnl: quoteForecast.expectedPnl,
    expectedMovePercent: quoteForecast.expectedMovePercent,
    fee: quoteForecast.fee
  };
}

export function marketBuyCandidates(game, player) {
  if (!marketBuyEligible(game, player) || game.hasLoanBackedCash?.(player)) return [];
  if (engineTableObligationPending(game) || game.marginMaintenanceDue?.(player) || Number(player.shortDefaultDebt) > 0) return [];
  return Object.entries(game.marketQuotes || {}).flatMap(([instrumentId, rawQuote]) => {
    const quote = Number(rawQuote);
    if (!Number.isInteger(quote) || quote <= 0) return [];
    const forecast = forecastMarketOrder({
      instrumentId,
      quote,
      quantity: 1,
      side: 'buy',
      ...marketForecastContext(game)
    });
    if (!forecast.supported || Number(player.cash || 0) < quote + forecast.fee) return [];
    return [{
      id: 'market:' + instrumentId,
      kind: 'market',
      instrumentId,
      side: 'buy',
      quantity: 1,
      risk: forecast.volatilityPercent,
      score: forecast.expectedPnl,
      expectedMarketPnl: forecast.expectedPnl,
      expectedMovePercent: forecast.expectedMovePercent,
      fee: forecast.fee
    }];
  });
}

export function marketSellCandidates(game, player) {
  return Object.entries(player.marketPositions || {})
    .map(([id, position]) => marketSellCandidate(game, player, id, position))
    .filter(Boolean);
}
