import { groupBuildPlan } from './botDevelopmentForecast.js';
import { deedValue, progressCredit } from './botTradeValuation.js';

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

export function auctionWillingness(auction, bot, game) {
  const tile = auction?.propertyTile;
  const value = Number(tile?.price);
  if (!Number.isFinite(value) || value < 0) return null;
  const faceValue = Math.max(0, Math.floor(deedValue(game, tile) || value));
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
  const effects = typeof game.activeEventEffects === 'function' ? game.activeEventEffects() : {};
  if (effects.constructionBlocked || effects.rentMultiplier === 0) return 0;
  const board = tiles.map(tile => ({
    ...tile,
    ownerSeat: tile.ownerId === bot?.id || tile.index === auctionTile.index ? 'self' : 'bank'
  }));
  const plan = groupBuildPlan(board, auctionTile.group, tile => game.getPropertyHouseCost(tile));
  if (!plan) return 0;
  const rounds = Math.max(1, Math.min(4, 5 - Math.floor(Number(game.roundNumber || 0) / 10)));
  const rentMultiplier = Number.isFinite(Number(effects.rentMultiplier)) ? Math.max(0, Number(effects.rentMultiplier)) : 1;
  const projectedRent = Math.floor(plan.gainPerCircuit * rounds * rentMultiplier);
  const affordability = Math.min(1, Math.max(0, Number(bot?.cash || 0) / Math.max(1, plan.cost)));
  return Math.floor(Math.max(0, projectedRent - plan.cost) * affordability);
}
