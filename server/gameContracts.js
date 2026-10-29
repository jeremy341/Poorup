
import { playerContractSummary, processContracts, proposeContract, proposeEquityShareTransfer, counterContract, adjustContract, expireStaleContract, repayContract, respondContract, settleEquityShares } from './contractLogic.js';

function activeCollateralContract(contract) {
  const supportedKind = ['loan', 'hybrid'].includes(contract.kind);
  const activeStatus = ['active', 'due'].includes(contract.status);
  return supportedKind && activeStatus;
}

function contractCollateralIndices(contract) {
  const indices = contract.collateralTileIndices;
  if (Array.isArray(indices) && indices.length) return indices;
  return [contract.collateralTileIndex];
}

export function contractPledgesTile(contract, player, tile) {
  if (!activeCollateralContract(contract)) return false;
  if (contract.toPlayerId !== player.id) return false;
  if (contract.kind === 'hybrid' && Number(contract.propertyIndex) === Number(tile.index)) return true;
  return contractCollateralIndices(contract).some(index => index != null && Number(index) === Number(tile.index));
}

export const gameContractApi = {
  playerContractById(contractId) {
    return this.playerContracts.find(contract => contract.id === contractId) || null;
  },

  playerContractSummary(viewerPlayerId = null) {
    return playerContractSummary(this, viewerPlayerId);
  },

  proposePlayerContract(socketId, offer = {}) {
    return proposeContract(this, socketId, offer);
  },

  proposeEquityShareTransfer(socketId, offer = {}) {
    return proposeEquityShareTransfer(this, socketId, offer);
  },

  counterPlayerContract(socketId, offer = {}) {
    return counterContract(this, socketId, offer);
  },

  adjustPlayerContract(socketId, offer = {}) {
    return adjustContract(this, socketId, offer);
  },

  respondPlayerContract(socketId, accept, requestId = null, contractId = null) {
    return respondContract(this, socketId, accept, requestId, contractId);
  },

  expireStaleContract(nowMs, ttlMs) {
    return expireStaleContract(this, nowMs, ttlMs);
  },

  repayPlayerContract(socketId, payload = {}) {
    return repayContract(this, socketId, payload);
  },

  processPlayerContracts() {
    processContracts(this);
  },

  settleEquityShares(tile, owner, amountPaid, payer = null) {
    settleEquityShares(this, tile, owner, amountPaid, payer);
  },

  isLoanCollateral(player, tile) {
    return Boolean(player?.bankLoan?.status === 'active' || player?.bankLoan?.status === 'due')
      && Number(player.bankLoan.collateralTileIndex) === Number(tile?.index);
  },

  isPlayerContractCollateral(player, tile) {
    if (!player || !tile) return false;
    return this.playerContracts?.some(contract => contractPledgesTile(contract, player, tile)) || false;
  },

  highestCollateralProperty(player) {
    if (!player?.properties) return null;
    const eligible = player.properties
      .map(index => this.getTile(index))
      .filter(tile => this.collateralEligibleTile(player, tile));
    return eligible.sort((a, b) => (b.price || 0) - (a.price || 0))[0] || null;
  },

  collateralEligibleTile(player, tile) {
    if (!tile) return false;
    if (tile.type !== 'property') return false;
    if (tile.mortgaged) return false;
    if (tile.houseCount > 0) return false;
    if (tile.equityShares?.length) return false;
    return !this.isPlayerContractCollateral(player, tile);
  }
};
