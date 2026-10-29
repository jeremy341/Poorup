// Property ownership, building and mortgage rules, and group bookkeeping.
import { equityShareContractLive } from './contractLogic.js';
import { canBuildOnTile, canMortgageTile, canSellFromTile, canUnmortgageTile, isTradeableTile } from './propertyRules.js';
import { tileIndexById } from './boardRegistry.js';

function hasRecordedPurchasePrice(tile) {
  return tile.purchasePricePaid != null && Number.isFinite(Number(tile.purchasePricePaid)) && Number(tile.purchasePricePaid) >= 0;
}

export const gamePropertyApi = {
  getTile(index) {
    return this.tiles.find(tile => tile.index === index);
  },

  tileIndexForId(tileId) {
    const index = tileIndexById(this.boardVariant, tileId);
    return index == null ? null : index;
  },

  getTileById(tileId) {
    const index = this.tileIndexForId(tileId);
    return index == null ? null : this.getTile(index);
  },

  getGroupTiles(group) {
    return this.tiles.filter(tile => tile.group === group && tile.type === 'property');
  },

  totalBuildings() {
    return this.tiles.reduce((sum, tile) => sum + Math.max(0, Math.min(5, Number(tile.houseCount) || 0)), 0);
  },

  totalCash() {
    return this.activePlayers().reduce((sum, player) => sum + Math.max(0, Number(player.cash) || 0), 0);
  },

  playerGroups(player) {
    if (!player) return [];
    return [...new Set(player.properties.map(index => this.getTile(index)?.group).filter(Boolean))];
  },

  refreshPlayerGroups(player) {
    if (!player) return;
    if (!(player.fullGroups instanceof Set)) player.fullGroups = new Set();
    const complete = this.playerGroups(player).filter(group => this.hasFullSet(player.id, group));
    complete.forEach(group => player.fullGroups.add(group));
  },

  isTradeableTile(tile) {
    return isTradeableTile(this, tile);
  },

  canBuildOnTile(player, tile) {
    return canBuildOnTile(this, player, tile);
  },

  canSellFromTile(player, tile) {
    return canSellFromTile(this, player, tile);
  },

  canMortgageTile(player, tile) {
    return canMortgageTile(this, player, tile);
  },

  canUnmortgageTile(player, tile) {
    return canUnmortgageTile(this, player, tile);
  },

  applyPropertyOwnershipChange(fromPlayer, toPlayer, tile, { preserveMortgage = false } = {}) {
    this.terminateTileEquityShares(tile);
    this.resetDeedTile(tile, toPlayer, { preserveMortgage });
    // A trade or claim has no reliably attributable per-deed cash price, so
    // the last bank/auction acquisition basis follows the deed unchanged.
    // Legacy deeds first transferred without a basis use their printed price.
    if (toPlayer && !hasRecordedPurchasePrice(tile)) {
      tile.purchasePricePaid = Math.max(0, Math.floor(Number(tile.price) || 0));
    }
    if (!toPlayer) tile.purchasePricePaid = null;
    this.detachDeedFromOwner(fromPlayer, tile);
    this.attachDeedToOwner(toPlayer, tile);
  },

  terminateTileEquityShares(tile) {
    const shares = Array.isArray(tile?.equityShares) ? tile.equityShares : [];
    shares.forEach(share => {
      const contract = this.playerContractById(share.contractId);
      if (!equityShareContractLive(contract)) return;
      contract.status = 'terminated';
      contract.terminatedRound = this.roundNumber;
    });
  },

  resetDeedTile(tile, toPlayer, { preserveMortgage = false } = {}) {
    tile.ownerId = toPlayer ? toPlayer.id : null;
    if (!preserveMortgage) tile.mortgaged = false;
    tile.houseCount = 0;
    tile.equityShares = [];
  },

  detachDeedFromOwner(fromPlayer, tile) {
    if (!fromPlayer) return;
    fromPlayer.properties = fromPlayer.properties.filter(propertyIndex => propertyIndex !== tile.index);
    // A bubble-survivor deed must remain in the original owner's hands
    // through recovery; transferring it invalidates that achievement fact.
    if (!fromPlayer.bubbleSurvivor) return;
    if (!fromPlayer.housingBubbleEnded) return;
    fromPlayer.bubbleSurvivor = fromPlayer.properties.some(index => (this.getTile(index)?.houseCount || 0) > 0);
  },

  attachDeedToOwner(toPlayer, tile) {
    if (!toPlayer) return;
    if (!toPlayer.properties.includes(tile.index)) toPlayer.properties.push(tile.index);
    this.refreshPlayerGroups(toPlayer);
  },

  cashFor(player) {
    return Number(player.cash) || 0;
  },

  isLastPlaceByCash(player) {
    if (!player) return false;
    const live = this.liveContestants();
    if (live.length < 2) return false;
    const cash = this.cashFor(player);
    return live.every(entry => entry.id === player.id || cash < this.cashFor(entry));
  },

  hasFullSet(ownerId, group) {
    const groupTiles = this.tiles.filter(tile => tile.group === group);
    return groupTiles.every(tile => tile.ownerId === ownerId);
  }
};
