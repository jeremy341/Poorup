// The bankruptcy pipeline as a prototype mixin: the declaration entry point
// and the ordered asset-settlement ladder for both elimination and debt
// modes. gameLogic.js assigns this object onto GameState.prototype;
// server/casino-bankruptcy.test.js pins the exact statement order, including
// the market liquidation line landing before any deed moves.
import { MARKET_FEE_RATE } from './marketLogic.js';
import { LOAN_OUTSTANDING_STATUSES } from './loanLogic.js';
import {
  bankruptcyRefusal,
  clearQuitObligations,
  outstandingDebtFor
} from './bankruptcyLogic.js';

const bankruptcyApi = {
  // Bankruptcy is the player's decision, not the server's verdict. With a
  // debt it hands assets to the creditor; without one it is a voluntary
  // retirement whose deeds return to the market unencumbered.
  declareBankruptcy(socketId) {
    const player = this.getPlayerBySocket(socketId);
    const refusal = bankruptcyRefusal(this, player);
    if (refusal) return refusal;
    const { owes, creditor } = outstandingDebtFor(this, player);
    clearQuitObligations(this, player);
    this.handleBankruptcy(player, creditor);
    if (player.id === this.currentPlayerId) {
      this.nextTurn();
    }
    return { success: true, voluntary: !owes };
  },

  handleBankruptcy(player, creditor = null) {
    if (this.settings.bankruptMode === 'debt') {
      return this.handleDebtBankruptcy(player, creditor);
    }
    this.markPlayerBankrupt(player);
    this.liquidateMarketPositions(player);
    this.sweepCashToCreditor(player, creditor);
    this.settleContractsOnBankruptcy(player);
    this.forfeitOrReleaseProperties(player, creditor);
    this.announceBankruptcy(player, creditor);
    this.concludeBankruptRound(player);
  },

  handleDebtBankruptcy(player, creditor) {
    this.sweepCashToCreditor(player, creditor);
    if (!creditor) player.cash = 0;
    this.forfeitOrReleaseProperties(player, creditor);
    this.settleContractsOnBankruptcy(player);
    player.inDebt = true;
    this.feedMessage(creditor
      ? `${player.nickname}'s assets were transferred to ${creditor.nickname}. They stay in the game with debt.`
      : `${player.nickname} lost everything. They stay in the game with debt.`);
    if (player.id === this.currentPlayerId) {
      this.nextTurn();
    }
  },

  markPlayerBankrupt(player) {
    player.bankrupt = true;
    player.bubbleSurvivor = false;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.consecutiveDoubles = 0;
    if (this.pendingPayment?.playerId === player.id) {
      this.pendingPayment = null;
      this.pendingPaymentTurnOptions = null;
    }
  },

  // Positions are force-sold at the current quote minus the market fee and
  // floored into cash; zero-proceeding holdings are dropped silently. The
  // per-position realized P&L (net proceeds over average cost) is recorded
  // so post-game stats see the forced exit, not just voluntary sells.
  liquidateMarketPositions(player) {
    const entries = Object.entries(player.marketPositions || {});
    const proceedsOf = (id, quantity) => {
      const quote = Math.max(0, Number(this.marketQuotes[id]) || 0);
      const gross = quote * quantity;
      return Math.max(0, gross - Math.ceil(gross * MARKET_FEE_RATE));
    };
    const marketLiquidation = entries.reduce((sum, [id, position]) => {
      const quantity = Math.max(0, Number(position.quantity) || 0);
      return sum + proceedsOf(id, quantity);
    }, 0);
    if (marketLiquidation <= 0) return;
    entries.forEach(([id, position]) => {
      const quantity = Math.max(0, Number(position.quantity) || 0);
      position.realizedPnl = (Number(position.realizedPnl) || 0)
        + proceedsOf(id, quantity) - (Number(position.averageCost) || 0) * quantity;
      position.quantity = 0;
      position.averageCost = 0;
    });
    player.cash += Math.floor(marketLiquidation);
    this.feedMessage(`${player.nickname}'s market positions were liquidated for $${Math.floor(marketLiquidation)}.`);
  },

  // Whatever cash survives liquidation flows to the creditor before any
  // deed is handed over.
  sweepCashToCreditor(player, creditor) {
    if (!creditor) return;
    if (player.cash <= 0) return;
    creditor.cash += player.cash;
    player.cash = 0;
  },

  settleContractsOnBankruptcy(player) {
    this.playerContracts
      .filter(contract => this.bankruptContractNeedsSettlement(contract, player))
      .forEach(contract => this.settleBankruptContract(player, contract));
  },

  bankruptContractNeedsSettlement(contract, player) {
    if (!LOAN_OUTSTANDING_STATUSES.includes(contract.status)) return this.convertedHybridInvolves(contract, player);
    return this.contractTouchesPlayer(contract, player);
  },

  convertedHybridInvolves(contract, player) {
    if (contract.kind !== 'hybrid') return false;
    if (contract.status !== 'converted') return false;
    return this.contractTouchesPlayer(contract, player);
  },

  contractTouchesPlayer(contract, player) {
    if (contract.toPlayerId === player.id) return true;
    return contract.fromPlayerId === player.id;
  },

  // A borrower's loan defaults (with the collateral seized while they still
  // hold it); a lender's loan just terminates; an equity agreement
  // terminates after its shares are stripped off the deed. A hybrid ends the
  // same way as equity: its conversion shares are stripped if they exist,
  // otherwise it simply terminates with no collateral to seize. Anything
  // else is left untouched, exactly as the original if-ladder.
  settleBankruptContract(player, contract) {
    if (contract.kind === 'hybrid') {
      this.terminateEquityContract(contract);
      return;
    }
    if (contract.kind !== 'loan') {
      if (contract.kind === 'equity') this.terminateEquityContract(contract);
      return;
    }
    // The pending-payment filter already guarantees one side is the
    // bankrupt player, so a loan not owed by them is one they issued.
    if (contract.toPlayerId === player.id) {
      this.seizeCollateralForLender(player, contract);
    } else {
      this.terminateContract(contract);
    }
  },

  seizeCollateralForLender(player, contract) {
    const lender = this.getPlayerById(contract.fromPlayerId);
    const collateral = contract.collateralTileIndex == null ? null : this.getTile(contract.collateralTileIndex);
    if (lender && collateral?.ownerId === player.id) this.applyPropertyOwnershipChange(player, lender, collateral);
    if (contract.collateralTileIndex != null) player.collateralLost = true;
    contract.status = 'defaulted';
    contract.defaultedRound = this.roundNumber;
  },

  terminateContract(contract) {
    contract.status = 'terminated';
    contract.terminatedRound = this.roundNumber;
  },

  terminateEquityContract(contract) {
    const property = this.getTile(contract.propertyIndex);
    if (property) property.equityShares = (property.equityShares || []).filter(entry => entry.contractId !== contract.id);
    this.terminateContract(contract);
  },

  // With a solvent creditor every deed is transferred in holding order; the
  // collateral already seized during contract settling is no longer in the
  // snapshot taken here.
  forfeitOrReleaseProperties(player, creditor) {
    const properties = [...player.properties];
    properties.forEach(propertyIndex => {
      const tile = this.getTile(propertyIndex);
      if (!tile) return;
      if (creditor && !creditor.bankrupt) {
        this.applyPropertyOwnershipChange(player, creditor, tile);
      } else {
        this.releasePropertyTile(player, tile);
      }
    });
    player.properties = [];
  },

  releasePropertyTile(player, tile) {
    tile.ownerId = null;
    tile.houseCount = 0;
    tile.mortgaged = false;
    player.properties = player.properties.filter(index => index !== tile.index);
  },

  // A bankrupt player facing a creditor hands over assets; one owing the
  // bank simply leaves the table.
  announceBankruptcy(player, creditor) {
    if (creditor) {
      this.feedMessage(`${player.nickname} is bankrupt. Assets transferred to ${creditor.nickname}.`);
    } else {
      this.feedMessage(`${player.nickname} is bankrupt and removed from the game.`);
    }
  },

  // The last seat standing wins immediately; otherwise the bankrupt current
  // player forfeits the turn.
  concludeBankruptRound(player) {
    const active = this.nonBankruptPlayers().filter(p => !p.inDebt);
    if (active.length <= 1) {
      this.endGame();
    } else if (player.id === this.currentPlayerId) {
      this.nextTurn();
    }
  }
};

export { bankruptcyApi };
