import { deedHasShareInterest, rentShareConstructionAllowed } from './rentShareRules.js';
// Board-tile eligibility rules: what a player may trade, build on, sell from, mortgage, or unmortgage. Pure: every predicate reads the
// GameState it is handed (via its accessor methods) and never mutates. property-actions.test.js and rent.test.js pin every branch.

function tradeableTileType(tile) {
  if (tile.type === 'property') return true;
  if (tile.type === 'utility') return true;
  if (tile.type === 'railroad') return true;
  return false;
}

function tileEncumbered(game, owner, tile) {
  if (!owner) return false;
  if (game.isLoanCollateral(owner, tile)) return true;
  return game.isPlayerContractCollateral(owner, tile);
}

function tradeableTileUnencumbered(game, tile) {
  if (deedHasShareInterest(game, tile)) return false;
  if (tileEncumbered(game, game.getPlayerById(tile.ownerId), tile)) return false;
  return true;
}

function groupHasBuildingsForTrade(game, tile) {
  if (tile.type !== 'property' || !tile.group) return false;
  return game.getGroupTiles(tile.group).some(entry => (entry.houseCount || 0) > 0);
}

export function isTradeableTile(game, tile) {
  if (!tile) return false;
  if (!tile.ownerId) return false;
  if (!tradeableTileUnencumbered(game, tile)) return false;
  if (!tradeableTileType(tile)) return false;
  if ((tile.houseCount || 0) > 0) return false;
  return !groupHasBuildingsForTrade(game, tile);
}

function ownedUnmortgagedProperty(game, player, tile) {
  if (tile.type !== 'property') return false;
  if (tile.ownerId !== player.id) return false;
  if (tileEncumbered(game, player, tile)) return false;
  // A temporary rent share leaves construction and its costs with the owner.
  // Legacy equity keeps its original construction restriction.
  if (!rentShareConstructionAllowed(game, tile)) return false;
  return !tile.mortgaged;
}

function buildPreconditionsAllow(game, player, tile) {
  if (!player) return false;
  if (!tile) return false;
  if (game.isConstructionBlocked()) return false;
  return true;
}

function buildOwnershipAllows(game, player, tile) {
  if (!buildPreconditionsAllow(game, player, tile)) return false;
  return ownedUnmortgagedProperty(game, player, tile);
}

function buildGroupAllows(game, player, tile, groupTiles) {
  if (!groupTiles.length) return false;
  if (groupTiles.some(entry => entry.mortgaged)) return false;
  return evenBuildAllows(game, player, tile, groupTiles);
}

function evenBuildAllows(game, player, tile, groupTiles) {
  if (!game.settings.evenBuild) return (tile.houseCount || 0) < 5;
  const houseLevels = groupTiles.map(entry => entry.houseCount || 0);
  const minLevel = Math.min(...houseLevels);
  if ((tile.houseCount || 0) !== minLevel) return false;
  return (tile.houseCount || 0) < 5;
}

export function canBuildOnTile(game, player, tile) {
  if (!buildOwnershipAllows(game, player, tile)) return false;
  if (!game.hasFullSet(player.id, tile.group)) return false;
  const groupTiles = game.getGroupTiles(tile.group).filter(entry => entry.ownerId === player.id);
  return buildGroupAllows(game, player, tile, groupTiles);
}

function evenBuildAllowsSell(game, player, tile, groupTiles) {
  if (!game.settings.evenBuild) return (tile.houseCount || 0) > 0;
  const houseLevels = groupTiles.map(entry => entry.houseCount || 0);
  const maxLevel = Math.max(...houseLevels);
  if ((tile.houseCount || 0) !== maxLevel) return false;
  return (tile.houseCount || 0) > 0;
}

function ownedPropertyTile(game, player, tile) {
  if (!player) return false;
  if (!tile) return false;
  if (tile.type !== 'property') return false;
  if (tile.ownerId !== player.id) return false;
  // Building-sale proceeds belong to the temporary rent-share deed owner.
  // Legacy equity and pledged collateral retain their original restrictions.
  if (tileEncumbered(game, player, tile)) return false;
  return rentShareConstructionAllowed(game, tile);
}

function sellGroupTiles(game, player, tile) {
  return game.getGroupTiles(tile.group).filter(entry => entry.ownerId === player.id);
}

export function canSellFromTile(game, player, tile) {
  if (!ownedPropertyTile(game, player, tile)) return false;
  const groupTiles = sellGroupTiles(game, player, tile);
  if (!groupTiles.length) return false;
  return evenBuildAllowsSell(game, player, tile, groupTiles);
}

function mortgageBlockedByEvent(game) {
  if (game.globalEventActive('credit-freeze')) return true;
  if (game.globalEventActive('bank-run')) return true;
  return Boolean(game.activeEventEffects().mortgagesBlocked);
}

function mortgageableTileType(tile) {
  if (tile.type === 'property') return true;
  if (tile.type === 'utility') return true;
  if (tile.type === 'railroad') return true;
  return false;
}

function tileEncumberedForOwner(game, player, tile) {
  if (game.isLoanCollateral(player, tile)) return true;
  return game.isPlayerContractCollateral(player, tile);
}

function groupHasBuildings(game, player, tile) {
  if (tile.type !== 'property') return false;
  return game.getGroupTiles(tile.group).some(entry => (entry.houseCount || 0) > 0);
}

function mortgageOwnershipAllows(game, player, tile) {
  if (!player) return false;
  if (!tile) return false;
  if (tile.ownerId !== player.id) return false;
  return Boolean(game.settings.mortgage);
}

function mortgageSecurityAllows(game, player, tile) {
  if (mortgageBlockedByEvent(game)) return false;
  if (tileEncumberedForOwner(game, player, tile)) return false;
  return !deedHasShareInterest(game, tile);
}

function mortgageTileShapeAllows(game, player, tile) {
  if (!mortgageableTileType(tile)) return false;
  if ((tile.houseCount || 0) > 0) return false;
  if (tile.mortgaged) return false;
  return !groupHasBuildings(game, player, tile);
}

export function canMortgageTile(game, player, tile) {
  if (!mortgageOwnershipAllows(game, player, tile)) return false;
  if (!mortgageSecurityAllows(game, player, tile)) return false;
  if (!mortgageTileShapeAllows(game, player, tile)) return false;
  return true;
}

function unmortgageFrozen(game) {
  if (game.globalEventActive('housing-bubble')) return true;
  if (game.globalEventActive('credit-freeze')) return true;
  if (game.globalEventActive('bank-run')) return true;
  // Effects fallback: during a combination event the merged effect set carries mortgagesBlocked from whichever parent fired,
  // while the sibling ID gates above may have gone dark. Mirror the mortgageBlockedByEvent fallback so both directions stay frozen.
  return Boolean(game.activeEventEffects().mortgagesBlocked);
}

function unmortgageOwnershipAllows(player, tile) {
  if (!player) return false;
  if (!tile) return false;
  if (tile.ownerId !== player.id) return false;
  return tile.mortgaged;
}

export function canUnmortgageTile(game, player, tile) {
  if (!unmortgageOwnershipAllows(player, tile)) return false;
  if (unmortgageFrozen(game)) return false;
  return !game.isPlayerContractCollateral(player, tile);
}

// The price to lift a mortgage: the mortgage value plus 10 percent, scaled by the event value multiplier, rounded up to whole dollars.
// The product is trimmed to micro-dollars first: 50 * 1.1 is 55.00000000000001 in floating point, and a bare ceil would charge $56, not $55.
export function unmortgageCostFor(price, valueMultiplier = 1) {
  const half = Math.floor((price || 0) / 2);
  return Math.ceil(Number((half * 1.1 * valueMultiplier).toFixed(6)));
}
