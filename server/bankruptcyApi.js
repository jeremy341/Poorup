// The bankruptcy pipeline as a prototype mixin: the declaration entry point and the ordered
// asset-settlement ladder for elimination and debt modes. gameLogic.js assigns this object onto
// GameState.prototype. server/casino-bankruptcy.test.js pins the statement order, including the market liquidation before any deed moves.
import { usesCollateralCredit, settleCollateralAtomically } from './collateralSettlement.js';
import { AUCTION_DURATION_MS } from './auctionApi.js';
import { MARKET_FEE_RATE } from './marketLogic.js';
import { LOAN_OUTSTANDING_STATUSES, seizeLoanCollateral, defaultBankLoan } from './loanLogic.js';
import { liquidateAllMarketPositions as liquidateExpandedMarketPositions } from './marketExpansion.js';
import {
  bankruptcyRefusal,
  clearQuitObligations,
  handlePlayerLoanDefault,
  outstandingDebtFor,
  settleDefaultClaims
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
    const result = this.handleBankruptcy(player, creditor);
    if (result?.success === false) return result;
    return { success: true, voluntary: !owes };
  },

  handleBankruptcy(player, creditor = null) {
    const prepared = this.prepareCollateralForExit(player);
    if (!prepared.success) return prepared;
    // Every route into bankruptcy (declared, AFK-expired, or an unsettled pending payment) lands here,
    // so the departing seat's obligations die here too. A pending trade, contract or offer it holds would
    // gate every survivor, since nobody can resolve a gate owned by a dead seat. Preparation must succeed first.
    clearQuitObligations(this, player, creditor);
    this.markPlayerBankrupt(player);
    // The ladder also pays what the claim ledger has matured. It runs after the seat is marked bankrupt,
    // so a claim whose borrower or lender is the departing seat is a write-off (swept below), never a payment
    // out of a dead seat ahead of the estate's creditor.
    settleDefaultClaims(this);
    this.liquidateMarketPositions(player);
    this.liquidateItems(player);
    this.settleBankLoanOnBankruptcy(player);
    this.sweepCashToCreditor(player, creditor);
    this.settleContractsOnBankruptcy(player);
    this.forfeitOrReleaseProperties(player, creditor);
    this.announceBankruptcy(player, creditor);
    this.concludeBankruptRound(player);
    return { success: true };
  },

  // Commit every new secured agreement as one unit before marking the seat out, clearing its debt gates
  // or distributing the general estate. A failed second agreement must restore the first one's transfers and claims.
  // Room-owned seat exits call this same seam before their irreversible steps.
  prepareCollateralForExit(player) {
    const bankLoan = usesCollateralCredit(player.bankLoan) && LOAN_OUTSTANDING_STATUSES.includes(player.bankLoan.status)
      ? player.bankLoan : null;
    const contracts = (this.playerContracts || []).filter(contract => contract.kind === 'loan'
      && contract.toPlayerId === player.id && usesCollateralCredit(contract)
      && LOAN_OUTSTANDING_STATUSES.includes(contract.status));
    const agreement = bankLoan || contracts[0];
    if (!agreement) return { success: true };
    const settled = settleCollateralAtomically(this, agreement, () => {
      if (bankLoan && defaultBankLoan(this, player, { allowBankruptCollateral: true }) === false) {
        throw new Error('Bank collateral settlement failed.');
      }
      for (const contract of contracts) {
        if (handlePlayerLoanDefault(this, contract, { allowBankruptCollateral: true }) === false) {
          throw new Error('Player collateral settlement failed.');
        }
      }
    });
    if (!settled) return {
      success: false, retryable: true,
      error: 'Secured loan settlement could not be completed. No assets moved; retry this exit.'
    };
    return { success: true };
  },

  handleDebtBankruptcy(player, creditor) {
    // Kept as a compatibility seam for older callers. A declared bankruptcy
    // always eliminates the seat; debt is a temporary payment state, not a
    // second in-game lifecycle.
    return this.handleBankruptcy(player, creditor);
  },

  markPlayerBankrupt(player) {
    player.bankrupt = true;
    player.spectating = !player.isBot;
    player.inDebt = false;
    this.clearSponsoredPurchaseForPlayer?.(player.id);
    player.bubbleSurvivor = false;
    // The doubles streak and extra roll belong to the seated roller. Clear
    // them only when the departing seat is that roller, so a third party's
    // bankruptcy or AFK expiry cannot erase the current player's extra roll.
    if (this.currentPlayerId === player.id) {
      this.extraRollPending = false;
      this.turnAllowsExtraRoll = false;
      this.consecutiveDoubles = 0;
    }
    if (this.pendingPayment?.playerId === player.id) {
      this.clearPendingPayment();
    }
    this.cancelAuctionStartedBy(player);
    // Stale auction seats count toward pass quorums and can never pass once
    // bankrupt: prune the seat so closes resolve on the timer, not never.
    if (this.auction) {
      this.auction.participants = (this.auction.participants || []).filter(id => id !== player.id);
      // A bankrupt high bidder can never raise its bid again, and leaving the lead in place freezes the bid
      // floor and voids the sale at close ("Auction ended without a valid winner"). Reset it exactly as the
      // disconnect path (revokeAuctionLeadIfLeader) already does.
      if (this.auction.highestBidderId === player.id) {
        this.auction.highestBidderId = null;
        this.auction.highestBid = 0;
        // A real bid restarts the five second window; revoking the lead must too,
        // or a leader leaving in the last moments strands the others with none.
        this.auction.endsAt = Math.max(Number(this.auction.endsAt) || 0, Date.now() + AUCTION_DURATION_MS);
      }
    }
    // The room owns the host seat, so it re-elects as soon as a seat is
    // eliminated; a bankrupt host must not keep start/settings rights.
    this.onSeatEliminated?.();
  },

  liquidateAllMarketPositions(player) {
    const result = liquidateExpandedMarketPositions(this, player, this.marketShortInventory || (this.marketShortInventory = {}));
    if (result.actions?.length) {
      this.feedMessage(player.nickname + "'s advanced market positions were settled (" + result.actions.join(', ') + ").");
    }
    return result;
  },

  // Positions are force-sold at the current quote minus the market fee, floored into cash.
  // Zero-proceeding holdings are dropped silently. Realized P&L (net proceeds over average cost)
  // is recorded so post-game stats see the forced exit, not just voluntary sells.
  liquidateMarketPositions(player) {
    this.liquidateAllMarketPositions(player);
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
    entries.forEach(([id, position]) => {
      const quantity = Math.max(0, Number(position.quantity) || 0);
      position.realizedPnl = (Number(position.realizedPnl) || 0)
        + proceedsOf(id, quantity) - (Number(position.averageCost) || 0) * quantity;
      position.quantity = 0;
      position.averageCost = 0;
    });
    if (marketLiquidation <= 0) return;
    player.cash += Math.floor(marketLiquidation);
    this.feedMessage(`${player.nickname}'s market positions were liquidated for $${Math.floor(marketLiquidation)}.`);
  },

  // Whatever cash survives liquidation flows to the creditor before any deed is handed over.
  // Every exit path that settles a seat reaches this helper, so the no-solvent-creditor branch decides stranded cash:
  // it forfeits to the bank, zeroed and announced, rather than sitting on a departed seat.
  sweepCashToCreditor(player, creditor) {
    if (creditor && !creditor.bankrupt) {
      if (player.cash <= 0) return;
      creditor.cash += player.cash;
      player.cash = 0;
      this.settleCreditorParkedDebt(creditor);
      return;
    }
    const forfeited = Math.max(0, Math.floor(Number(player.cash) || 0));
    player.cash = 0;
    if (forfeited > 0) this.feedMessage(`${player.nickname} forfeits $${forfeited} to the bank.`);
  },

  // The estate cash may cover the creditor's own parked debt, so a cash inflow retries it here,
  // exactly as the rent and trade paths do. The same invariant pins the other cash-inflow sites.
  settleCreditorParkedDebt(creditor) {
    if (!creditor) return;
    const pending = this.pendingPayment;
    if (!pending || pending.playerId !== creditor.id) return;
    const amount = Math.max(0, Number(pending.amountRemaining) || 0);
    if (amount <= 0 || creditor.cash < amount) return;
    if (typeof this.trySettlePendingPayment !== 'function') return;
    // Re-entrancy guard: settling the head can reach another bankruptcy
    // (a creditor that still cannot cover its debt), which would come back
    // through this same credit.
    if (this.settlingCreditorParkedDebt) return;
    this.settlingCreditorParkedDebt = true;
    try {
      this.trySettlePendingPayment();
    } finally {
      this.settlingCreditorParkedDebt = false;
    }
  },

  settleContractsOnBankruptcy(player) {
    const contracts = this.playerContracts.filter(contract => this.bankruptContractNeedsSettlement(contract, player));
    for (const contract of contracts) {
      if (this.settleBankruptContract(player, contract) === false) return false;
    }
    return true;
  },

  bankruptContractNeedsSettlement(contract, player) {
    if (usesCollateralCredit(contract) && contract.status === 'defaulted') return this.contractTouchesPlayer(contract, player);
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

  // A borrower's loan defaults (collateral seized while they still hold it). A lender's loan just terminates,
  // and an equity agreement terminates after its shares are stripped off the deed. A hybrid ends like equity:
  // its conversion shares are stripped if they exist, else it terminates with no collateral. Anything else is left untouched.
  settleBankruptContract(player, contract) {
    if (contract.kind === 'hybrid') return this.settleBankruptHybrid(player, contract);
    if (contract.kind === 'loan') return this.settleBankruptLoan(player, contract);
    if (contract.kind === 'equity') this.terminateEquityContract(contract);
  },

  settleBankruptHybrid(player, contract) {
    if (contract.status === 'converted') {
      this.terminateEquityContract(contract);
      return;
    }
    if (contract.toPlayerId === player.id) {
      // The borrower still owes the funded principal; bankruptcy defaults the
      // loan leg. The default helper records the claim; the bankruptcy path
      // then seizes its basket while the general asset sweep handles the rest.
      handlePlayerLoanDefault(this, contract);
      this.seizeCollateralForLender(player, contract);
      return;
    }
    this.terminateEquityContract(contract);
  },

  settleBankruptLoan(player, contract) {
    if (usesCollateralCredit(contract) && contract.status === 'defaulted') {
      this.writeOffCreditLoanResidual(player, contract);
      return;
    }
    // The pending-payment filter always leaves the bankrupt player on one side,
    // so a loan not owed by them is one they issued.
    if (contract.toPlayerId === player.id) {
      if (usesCollateralCredit(contract)) {
        return handlePlayerLoanDefault(this, contract, { allowBankruptCollateral: true });
      }
      // Same rule as the hybrid leg: the default helper keeps the unpaid
      // principal as a lender claim. It refuses to seize from a bankrupt
      // borrower, so the basket walk below stays the single seizure pass.
      handlePlayerLoanDefault(this, contract);
      this.seizeCollateralForLender(player, contract);
      return;
    }
    // A lender who leaves cancels the loan without seizing anything.
    // the settlement is kept, and the borrower is told about it.
    this.terminateContract(contract);
    this.announceLenderExit(player, contract);
  },

  writeOffCreditLoanResidual(player, contract) {
    const residual = Math.max(0, Math.floor(Number(contract.remaining) || 0));
    const claim = (this.defaultClaims || []).find(entry => entry.contractId === contract.id && entry.status === 'open');
    if (claim) {
      claim.status = 'written-off';
      claim.writtenOffRound = this.roundNumber;
    }
    if (residual > 0 && contract.residualWrittenOff == null) {
      contract.residualWrittenOff = residual;
      this.feedMessage(`The $${residual} residual player-loan debt was written off on exit.`);
    }
    if (contract.fromPlayerId === player.id) {
      this.terminateContract(contract);
      this.announceLenderExit(player, contract);
    }
  },

  // The loan is cancelled: the borrower keeps the funds already received, the balance still owed is forgiven,
  // and the collateral is released. The room feed says so, and the borrower gets a private system message,
  // queued here and delivered by the runtime's next room broadcast.
  announceLenderExit(lender, contract) {
    const borrower = this.getPlayerById(contract.toPlayerId);
    if (!borrower) return;
    const forgiven = Math.max(0, Math.floor(Number(contract.remaining) || 0));
    this.feedMessage(`${borrower.nickname}'s $${Math.floor(Number(contract.amount) || 0)} loan from ${lender.nickname} was cancelled: the $${forgiven} still owed is forgiven, ${borrower.nickname} keeps the funds received, and the collateral is released.`);
    this.borrowerNotices ||= [];
    this.borrowerNotices.push({
      playerId: borrower.id,
      text: `${lender.nickname} left the table, so your loan is cancelled. The $${forgiven} still owed is forgiven, you keep the funds already received, and your collateral is released.`
    });
  },

  takeBorrowerNotices() {
    const notices = this.borrowerNotices || [];
    this.borrowerNotices = [];
    return notices;
  },

  seizeCollateralForLender(player, contract) {
    const lender = this.getPlayerById(contract.fromPlayerId);
    const indices = Array.isArray(contract.collateralTileIndices) && contract.collateralTileIndices.length
      ? contract.collateralTileIndices
      : contract.collateralTileIndex == null ? [] : [contract.collateralTileIndex];
    if (lender) {
      for (const index of indices) {
        const collateral = this.getTile(Number(index));
        if (collateral?.ownerId === player.id) this.applyPropertyOwnershipChange(player, lender, collateral);
      }
    }
    if (indices.length) player.collateralLost = true;
    contract.unsecuredDefault = indices.length === 0;
    const claim = (this.defaultClaims || []).find(entry => entry.contractId === contract.id);
    if (claim) {
      claim.collateralTileIndex = indices[0] ?? null;
      claim.collateralTileIndices = indices.slice();
    } else {
      // The ledger was full of open claims, so no recovery record exists and a
      // departing borrower leaves no later round to retry. The default still
      // stands; the loss is flagged and announced rather than silent.
      contract.unrecordedDefault = true;
      const principal = Math.max(0, Math.floor(Number(contract.defaultedPrincipal) || 0));
      this.feedMessage(`${lender?.nickname || 'The lender'} could not record a recovery claim against ${player.nickname}: $${principal} written off.`);
    }
    contract.status = 'defaulted';
    contract.defaultedRound = this.roundNumber;
  },

  collateralForContract(contract) {
    if (contract.collateralTileIndex == null) return null;
    return this.getTile(contract.collateralTileIndex);
  },

  terminateContract(contract) {
    contract.status = 'terminated';
    contract.terminatedRound = this.roundNumber;
  },

  terminateEquityContract(contract) {
    const property = this.getTile(contract.propertyIndex);
    if (property) {
      const shares = Array.isArray(property.equityShares) ? property.equityShares : [];
      property.equityShares = shares.filter(entry => entry.contractId !== contract.id);
    }
    this.terminateContract(contract);
  },

  // With a solvent creditor every deed is transferred in holding order; the
  // collateral already seized during contract settling is not in the
  // snapshot taken here.
  forfeitOrReleaseProperties(player, creditor) {
    const properties = [...player.properties];
    properties.forEach(propertyIndex => {
      this.forfeitSingleProperty(player, creditor, propertyIndex);
    });
    player.properties = [];
  },

  forfeitSingleProperty(player, creditor, propertyIndex) {
    const tile = this.getTile(propertyIndex);
    if (!tile) return;
    if (this.creditorCanReceive(creditor)) {
      this.applyPropertyOwnershipChange(player, creditor, tile);
      return;
    }
    this.releasePropertyTile(player, tile);
  },

  creditorCanReceive(creditor) {
    if (!creditor) return false;
    if (creditor.bankrupt) return false;
    return true;
  },

  // Owner decision: keep. A deed released with no solvent creditor returns to the market unbuilt and
  // unmortgaged, with houses sent to the supply for no cash; a solvent creditor takes it the same way.
  // A bank seizure differs: it liquidates houses at the half rate (loanLogic.js seizeLoanCollateral).
  releasePropertyTile(player, tile) {
    this.terminateTileEquityShares?.(tile);
    tile.ownerId = null;
    tile.purchasePricePaid = null;
    tile.houseCount = 0;
    tile.mortgaged = false;
    tile.equityShares = [];
    player.properties = player.properties.filter(index => index !== tile.index);
  },

  // A bankruptcy must not leave a bank loan frozen on the dead seat: advanceBankLoan skips bankrupt players,
  // so the receivable would vanish and season scoring would count a loan that was never serviced.
  // Mirror the live default path: seize secured collateral at the half rate, or log a write-off for unsecured loans.
  settleBankLoanOnBankruptcy(player) {
    const loan = player.bankLoan;
    if (!loan) return;
    // A loan already defaulted keeps its balance while the bank claim is queued behind the seat's other debt.
    // The departing seat's queued claims were written off (or the head cleared) before this step, so nothing
    // is left to collect: the loan stays terminal ('defaulted') with no balance.
    if (loan.status === 'defaulted') {
      const written = Math.max(0, Math.floor(Number(loan.remaining) || 0));
      if (usesCollateralCredit(loan)) {
        if (written > 0 && loan.residualWrittenOff == null) {
          loan.residualWrittenOff = written;
          this.feedMessage(`${player.nickname}'s $${written} residual bank loan debt was written off on exit.`);
        }
        return;
      }
      if (written <= 0) return;
      loan.remaining = 0;
      this.feedMessage(`${player.nickname}'s $${written} bank loan balance was written off.`);
      return;
    }
    if (!LOAN_OUTSTANDING_STATUSES.includes(loan.status)) return;
    if (usesCollateralCredit(loan)) {
      return defaultBankLoan(this, player, { allowBankruptCollateral: true });
    }
    const collateral = loan.collateralTileIndex == null ? null : this.getTile(loan.collateralTileIndex);
    if (collateral && collateral.ownerId === player.id) {
      seizeLoanCollateral(this, player, collateral);
    } else {
      this.feedMessage(`${player.nickname} defaulted on an unsecured bank loan.`);
    }
    loan.remaining = 0;
    loan.status = 'defaulted';
    loan.defaultedRound = this.roundNumber;
  },

  // A bankrupt player facing a solvent creditor hands over assets; with an
  // insolvent creditor the deeds already went to the bank, so the feed must
  // not claim a transfer that never happened.
  announceBankruptcy(player, creditor) {
    if (this.creditorCanReceive(creditor)) {
      this.feedMessage(`${player.nickname} is bankrupt. Assets transferred to ${creditor.nickname}.`);
    } else if (creditor) {
      this.feedMessage(`${player.nickname} is bankrupt. Assets transferred to the bank.`);
    } else {
      this.feedMessage(`${player.nickname} is bankrupt and removed from the game.`);
    }
  },

  // The last connected seat standing wins immediately. Otherwise a bankrupt current player forfeits the turn,
  // and a seat inside its reconnect grace holds the table, as finishIfNoConnectedPlayers does.
  // endGame owns the final teardown and clears every pending obligation. This only decides eliminated or in debt.
  concludeBankruptRound(player) {
    // Liveness counts every seat still in the game: a seat parked on a debt can still mortgage, sell or go bankrupt,
    // so it keeps the table alive. The debt flag decides who may be crowned and who may host (see endGame's
    // winner selection and ensureRoomHost), not who is still seated.
    const connected = this.connectedNonBankruptPlayers();
    if (connected.length <= 1) {
      if (player.id === this.currentPlayerId) {
        this.resetTurnState();
        this.hasRolled = false;
        this.currentPlayerId = connected.find(candidate => !candidate.inDebt)?.id || connected[0]?.id || this.waitingSeat()?.id || null;
      }
      this.finishIfNoConnectedPlayers(connected);
      return;
    }
    if (player.id === this.currentPlayerId) {
      this.nextTurn();
    }
  }
};

export { bankruptcyApi };
