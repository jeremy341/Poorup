import { dynamicReserve, groupBuildPlan } from './botDevelopmentForecast.js';
import { deedValue, progressCredit } from './botTradeValuation.js';
import { applyRentCap } from './botRentForecast.js';

// Raises over the standing bid (or opening bid) a bot may make: exactly the buttons the player UI offers
// (public/clientAuctionUi.js BID_STEPS). The bot's decision (botLogic.js) picks from them, and auctionApi.js enforces
// them for bots, so a bot never makes a raise the table's players cannot.
export const AUCTION_BID_INCREMENTS = Object.freeze([1, 20, 100]);
// The standard raise: what the deterministic planner bids when it can afford it.
export const AUCTION_BID_STEP = 20;

// Absolute bid amounts a bot may place right now, cheapest first.
export function auctionRaiseOptions(highestBid, maximum) {
  const base = Math.max(0, Math.floor(Number(highestBid) || 0));
  return AUCTION_BID_INCREMENTS.map(step => base + step).filter(amount => amount <= maximum);
}

export function isAuctionRaise(highestBid, amount) {
  const base = Math.max(0, Math.floor(Number(highestBid) || 0));
  return AUCTION_BID_INCREMENTS.some(step => base + step === amount);
}

// Deterministic choice: the standard raise, or the smallest one when only that fits.
export function defaultAuctionRaise(highestBid, maximum) {
  const options = auctionRaiseOptions(highestBid, maximum);
  const base = Math.max(0, Math.floor(Number(highestBid) || 0));
  return options.includes(base + AUCTION_BID_STEP) ? base + AUCTION_BID_STEP : options[0];
}

// Cash a bot keeps out of every auction when it has no board to price the live
// liquidity target from (the purchase floor, PURCHASE_RESERVE_CASH in botLogic).
const AUCTION_RESERVE_FLOOR = 120;

// Bids never spend the liquidity target: the live opponent hit plus one house
// (dynamicReserve), so a bot keeps the cash for its next rent.
export function auctionLiquidityReserve(game, bot) {
  if (!Array.isArray(game?.tiles)) return AUCTION_RESERVE_FLOOR;
  return dynamicReserve(game.tiles.map(tile => ({
    ...tile,
    ownerSeat: !tile?.ownerId ? 'bank' : tile.ownerId === bot?.id ? 'self' : 'opponent'
  })));
}

export function groupTiles(game, tile) {
  if (!tile?.group) return null;
  const tiles = typeof game?.getGroupTiles === 'function' ? game.getGroupTiles(tile.group) : [];
  return tiles?.length ? tiles : null;
}

export function ownedCount(tiles, bot) {
  return tiles.filter(tile => tile?.ownerId === bot?.id).length;
}

function completesSet(tiles, owned) {
  return owned + 1 >= tiles.length && owned < tiles.length;
}

// True when `tile` is the last unowned deed of its colour group for `bot`.
export function completesColourSet(game, bot, tile) {
  const tiles = groupTiles(game, tile);
  return Boolean(tiles) && completesSet(tiles, ownedCount(tiles, bot));
}

function buildEffects(game) {
  if (typeof game?.activeEventEffects !== 'function') return {};
  return game.activeEventEffects();
}

// Building is frozen by the table's own rule (globalEventsApi isConstructionBlocked), which covers the effect
// payload and the headlines that block construction on their own: housing bubble, bank run and supply chain.
// A bot that values a set it cannot build overpays for it.
function constructionUnavailable(game, effects) {
  if (effects.constructionBlocked) return true;
  if (effects.rentMultiplier === 0) return true;
  if (typeof game?.isConstructionBlocked === 'function') return game.isConstructionBlocked();
  return false;
}

function completionBuildPlan(game, tiles, auctionTile, bot) {
  const board = tiles.map(tile => ({
    ...tile,
    ownerSeat: tile.ownerId === bot?.id || tile.index === auctionTile.index ? 'self' : 'bank'
  }));
  return groupBuildPlan(board, auctionTile.group, tile => game.getPropertyHouseCost(tile));
}

function projectedCompletionRent(game, plan, effects, deedCount) {
  const rounds = Math.max(1, Math.min(4, 5 - Math.floor(Number(game.roundNumber || 0) / 10)));
  // Rent accrues only once the houses are up, so a set that cannot finish
  // building inside the horizon earns no rent upside.
  const rentRounds = Math.max(0, rounds - plan.buildRounds);
  const effectMultiplier = Number(effects.rentMultiplier);
  const rentMultiplier = Number.isFinite(effectMultiplier) ? Math.max(0, effectMultiplier) : 1;
  const perCircuit = plan.gainPerCircuit * rentMultiplier;
  // The rent cap is charged per payment, so a completed set cannot collect
  // more than the cap for each deed it charges in a circuit.
  const cap = Number(effects.rentCap);
  const ceiling = cap > 0 ? cap * Math.max(1, deedCount) : 0;
  const cappedPerCircuit = ceiling > 0 ? applyRentCap(perCircuit, ceiling) : perCircuit;
  return Math.floor(cappedPerCircuit * rentRounds);
}

// Share of the finishing cost still in hand after paying the deed's face price:
// a completer that cannot pay for the houses discounts the upside it cannot fund.
function developmentAffordability(bot, auctionTile, plan) {
  const cashAfterDeed = Number(bot?.cash || 0) - Number(auctionTile?.price || 0);
  return Math.min(1, Math.max(0, cashAfterDeed / Math.max(1, plan.cost)));
}

export function auctionWillingness(auction, bot, game) {
  const tile = auction?.propertyTile;
  const value = Number(tile?.price);
  if (!Number.isFinite(value) || value < 0) return null;
  const faceValue = Math.max(0, Math.floor(deedValue(game, tile) || value));
  // House is the easy level: it bids what a deed is worth and never pays for the set it
  // would complete. Table and Expert price the strategic value (progress, completion).
  if (game?.settings?.botDifficulty === 'house') return faceValue;
  const tiles = groupTiles(game, tile);
  if (!tiles) return faceValue;
  const owned = ownedCount(tiles, bot);
  let strategicValue = faceValue;
  strategicValue += Math.max(0, progressCredit(game, tile.group, owned, Math.min(tiles.length, owned + 1)));
  if (completesSet(tiles, owned)) strategicValue += completionUpside(game, tiles, tile, bot);
  return Math.max(faceValue, Math.floor(strategicValue));
}

function completionUpside(game, tiles, auctionTile, bot) {
  if (typeof game?.getPropertyHouseCost !== 'function') return 0;
  const effects = buildEffects(game);
  if (constructionUnavailable(game, effects)) return 0;
  const plan = completionBuildPlan(game, tiles, auctionTile, bot);
  if (!plan) return 0;
  const projectedRent = projectedCompletionRent(game, plan, effects, tiles.length);
  const affordability = developmentAffordability(bot, auctionTile, plan);
  return Math.floor(Math.max(0, projectedRent - plan.cost) * affordability);
}
