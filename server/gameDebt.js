// Bank loans, debt settlement and pending payments on a game state.
import { bankLoanOffer, bankLoanTerms, defaultBankLoan, processBankLoans, repayBankLoan, takeBankLoan } from './loanLogic.js';

export const gameDebtApi = {
  bankLoanTerms(player) {
    return bankLoanTerms(this, player);
  },

  getBankLoanOffer(player) {
    return bankLoanOffer(this, player);
  },

  takeBankLoan(socketId, requestId = null) {
    return takeBankLoan(this, socketId, requestId);
  },

  repayBankLoan(socketId, payload = {}) {
    return repayBankLoan(this, socketId, payload);
  },

  processBankLoans() {
    processBankLoans(this);
  },

  defaultBankLoan(player) {
    defaultBankLoan(this, player);
  },

  // Every claim a seat still owes: the head plus anything queued behind it.
  // Named apart from propertyApi.pendingDebtFor(player): that helper is mixed
  // onto GameState.prototype and would shadow a same-named method here.
  pendingDebtAmountFor(playerId) {
    if (!playerId) return 0;
    let owed = this.pendingPayment?.playerId === playerId
      ? Math.max(0, Number(this.pendingPayment.amountRemaining) || 0)
      : 0;
    (Array.isArray(this.pendingPaymentQueue) ? this.pendingPaymentQueue : []).forEach(entry => {
      if (entry?.payment?.playerId === playerId) owed += Math.max(0, Number(entry.payment.amountRemaining) || 0);
    });
    return owed;
  },

  hasPendingDebt(playerId) {
    return this.pendingDebtAmountFor(playerId) > 0;
  },

  // inDebt mirrors the head and queued claims so subsystems that read the
  // player flag stay in lockstep with the claim ledger.
  syncDebtFlags() {
    this.players.forEach(player => {
      player.inDebt = !player.bankrupt && this.pendingDebtAmountFor(player.id) > 0;
    });
  },

  chargePlayer(debt) {
    // Nothing to collect from a missing payer or a non-debt: the turn just
    // resolves normally.
    if (!debt.player) {
      this.resolveTurnAfterAction(debt.turnOptions);
      return;
    }
    if (debt.amount <= 0) {
      this.resolveTurnAfterAction(debt.turnOptions);
      return;
    }
    if (debt.player.cash >= debt.amount) {
      this.payDebtInFull(debt);
      return;
    }
    this.openDebtSettlement(debt);
  },

  payDebtInFull(debt) {
    const { player, creditor, amount, message, turnOptions = {}, hooks = {} } = debt;
    player.cash -= amount;
    if (player.cash === 0) player.zeroCashReached = true;
    this.creditRentTo(creditor, player, amount);
    this.feedMessage(message);
    if (hooks.onPaid) hooks.onPaid(amount);
    this.resolveTurnAfterAction(turnOptions);
  },

  // Shortfall path: whatever cash remains is tendered first, then the rest
  // of the debt parks in pendingPayment for the mortgage/sell/bankruptcy
  // mini-game to resolve.
  openDebtSettlement(debt) {
    const { player, creditor, amount, message, turnOptions = {}, hooks = {} } = debt;
    const partial = player.cash;
    if (partial > 0) {
      this.tenderPartialDebt(player, creditor, partial, hooks);
    }
    const remaining = amount - partial;
    const pending = {
      playerId: player.id,
      creditorId: creditor ? creditor.id : null,
      amountRemaining: remaining,
      reason: message,
      equityTileIndex: hooks.equityTileIndex ?? null,
      equityOwnerId: hooks.equityOwnerId ?? null
    };
    if (this.pendingPayment) {
      // Round processing can mature several independent debts at once. Keep
      // the existing table gate and queue later claims instead of silently
      // overwriting the first debtor.
      this.pendingPaymentQueue ||= [];
      // The active roller must never wait behind another seat's claim: the
      // settle flow reads the head, so promote the roller's claim and requeue
      // the one it displaces.
      if (pending.playerId === this.currentPlayerId && this.pendingPayment.playerId !== pending.playerId) {
        this.pendingPaymentQueue.unshift({
          payment: this.pendingPayment,
          hooks: this.pendingPaymentHooks,
          turnOptions: this.pendingPaymentTurnOptions
        });
        this.pendingPayment = pending;
        this.pendingPaymentHooks = hooks;
        this.pendingPaymentTurnOptions = turnOptions;
        this.syncDebtFlags();
        this.feedMessage(`${player.nickname} owes $${remaining}; the payment takes priority over the queued debt.`);
        return;
      }
      this.pendingPaymentQueue.push({ payment: pending, hooks, turnOptions });
      this.syncDebtFlags();
      this.feedMessage(`${player.nickname} owes $${remaining}; the payment is queued behind the current debt.`);
      return;
    }
    this.pendingPayment = pending;
    this.pendingPaymentHooks = hooks;
    this.pendingPaymentTurnOptions = turnOptions;
    this.syncDebtFlags();
    this.feedMessage(`${player.nickname} owes $${remaining}. Mortgage or sell buildings to raise funds, or declare bankruptcy.`);
  },

  tenderPartialDebt(player, creditor, partial, hooks) {
    player.cash = 0;
    player.zeroCashReached = true;
    this.creditRentTo(creditor, player, partial);
    this.feedMessage(`${player.nickname} paid $${partial} toward the debt.`);
    if (hooks.onPaid) hooks.onPaid(partial);
  },

  // A rent credit touches cash, the collection total, the payer sets and their running per-round max. Bank debts (null creditor)
  // skip it, as do bankrupt creditors: tile rent treats a bankrupt owner as vacant, so an in-flight debt never enriches one.
  // The payer still settles; the money simply has nowhere to go.
  creditRentTo(creditor, payer, amount) {
    if (!creditor || creditor.bankrupt) return;
    creditor.cash += amount;
    this.recordRentReceipt(creditor, payer, amount);
    if (this.pendingPaymentReadyFor(creditor)) {
      this.trySettlePendingPayment();
    }
  },

  recordRentReceipt(creditor, payer, amount) {
    creditor.rentCollected = (creditor.rentCollected || 0) + amount;
    creditor.rentPayerIds ||= new Set();
    creditor.rentPayerIds.add(payer.id);
    creditor.rentPayersThisRound ||= new Set();
    creditor.rentPayersThisRound.add(payer.id);
    creditor.maxRentPayersInRound = Math.max(creditor.maxRentPayersInRound || 0, creditor.rentPayersThisRound.size);
  },

  pendingPaymentReadyFor(creditor) {
    return this.pendingPayment?.playerId === creditor.id
      && creditor.cash >= this.pendingPayment.amountRemaining
      && !this.collectingPendingPayment
      && !this.collectingOwnedDebts;
  },

  trySettlePendingPayment() {
    if (this.collectingPendingPayment || this.collectingOwnedDebts) return false;
    if (!this.pendingPayment) return false;
    const player = this.getPlayerById(this.pendingPayment.playerId);
    // A debtor inside its reconnect grace that can cover the debt pays only the
    // debt; another seat's action must not hand over its whole estate.
    if (this.graceDebtorCanCoverPending(player)) {
      return this.collectOwnedDebts(player);
    }
    if (!this.pendingPayerCanSettle(player)) {
      this.resolveUnsettleablePendingPayment(player);
      return false;
    }
    return this.collectOwnedDebts(player);
  },

  graceDebtorCanCoverPending(player) {
    return Boolean(player?.disconnected) && !player.bankrupt && player.cash >= this.pendingPayment.amountRemaining;
  },

  // Debts never evaporate: a present-but-unsettleable debtor goes
  // through bankruptcy (assets to creditor); a removed seat simply
  // clears like before, its deeds already forfeited on the way out.
  resolveUnsettleablePendingPayment(debtor) {
    const creditor = this.pendingPayment.creditorId ? this.getPlayerById(this.pendingPayment.creditorId) : null;
    if (debtor && !debtor.bankrupt) {
      const result = this.handleBankruptcy(debtor, creditor);
      if (result?.success === false) return;
    } else this.clearPendingPayment();
  },

  // Pays the head debt, then drains any promoted head already covered by its
  // payer's cash. Each pass removes one claim, so queue order is preserved and
  // the pass terminates. The outer guard keeps credit hooks from re-entering.
  collectOwnedDebts(player) {
    if (this.collectingOwnedDebts) return false;
    this.collectingOwnedDebts = true;
    try {
      if (!this.collectPendingPayment(player)) return false;
      while (this.pendingPayment) {
        const nextPayer = this.getPlayerById(this.pendingPayment.playerId);
        if (!nextPayer || nextPayer.bankrupt || nextPayer.cash < this.pendingPayment.amountRemaining) break;
        if (!this.collectPendingPayment(nextPayer)) break;
      }
      return true;
    } finally {
      this.collectingOwnedDebts = false;
    }
  },

  // Pays the parked debt in full from the debtor's cash. The live settle path reaches it through trySettlePendingPayment;
  // the AFK and expiry path calls it directly, since a seat still in reconnect grace can cover its debt, and that payment
  // must not turn into a whole-estate bankruptcy.
  collectPendingPayment(player) {
    if (!this.pendingPayment || !player || player.bankrupt) return false;
    // Re-entrancy guard: collecting the head claim can credit a recipient (an equity rent share paid to the seat that owes the rent),
    // and that inflow retries the claim being collected right now. The retry must not collect the same rent twice, and it must not
    // clear the claim under the collection still running.
    if (this.collectingPendingPayment) return false;
    if (player.cash < this.pendingPayment.amountRemaining) {
      return false;
    }
    const amount = this.pendingPayment.amountRemaining;
    this.collectingPendingPayment = true;
    try {
      player.cash -= amount;
      this.creditSettledDebt(amount, player);
      this.settlePendingEquityShares(amount);
      this.settlePendingHooks(amount);
    } finally {
      this.collectingPendingPayment = false;
    }
    this.feedMessage(`${player.nickname} paid the remaining $${amount}.`);
    const turnOptions = this.pendingPaymentTurnOptions || {};
    // Only the seat that landed on the debt resolves its roll. An off-turn
    // debtor (a bank-loan default during round processing) or a seat that has
    // not rolled yet settles without marking the current roll as landed.
    const resolvesRoll = this.hasRolled && player.id === this.currentPlayerId;
    this.clearPendingPayment();
    if (resolvesRoll) this.resolveTurnAfterAction(turnOptions);
    return true;
  },

  pendingPayerCanSettle(player) {
    if (!player) return false;
    if (player.bankrupt) return false;
    return !player.disconnected;
  },

  clearPendingPayment(activateNext = true) {
    const shouldActivateNext = activateNext && this.started;
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.pendingPaymentHooks = null;
    const next = shouldActivateNext ? this.pendingPaymentQueue?.shift() : null;
    if (next) {
      this.pendingPayment = next.payment;
      this.pendingPaymentHooks = next.hooks;
      this.pendingPaymentTurnOptions = next.turnOptions;
    }
    this.syncDebtFlags();
    if (next && !this.collectingOwnedDebts && this.pendingPayment) {
      const nextPayer = this.getPlayerById(this.pendingPayment.playerId);
      if (nextPayer && !nextPayer.bankrupt && nextPayer.cash >= this.pendingPayment.amountRemaining) {
        this.trySettlePendingPayment();
      }
    }
    return Boolean(next);
  },

  // Forgiveness only: a claim owed TO a departing seat ends with it. The
  // claims the seat owes settle against its estate (settleQueuedDebtsOf), so
  // they are never dropped here.
  removeQueuedPaymentsForPlayer(playerId) {
    if (!playerId || !Array.isArray(this.pendingPaymentQueue)) return;
    this.pendingPaymentQueue = this.pendingPaymentQueue.filter(entry => entry?.payment?.creditorId !== playerId);
    this.syncDebtFlags();
  },

  // The remainder path replays the debt hooks exactly once. Equity debts replay through their stored indexes in
  // settlePendingEquityShares, so the generic hook runs only for non-equity debts (today: vacation-pool tax). Partial payments
  // already ran the hook for their share via tenderPartialDebt.
  settlePendingHooks(amount) {
    if (this.pendingPayment.equityTileIndex != null) return;
    const onPaid = this.pendingPaymentHooks?.onPaid;
    if (typeof onPaid !== 'function') return;
    onPaid(amount);
  },

  // Settling the parked debt credits the creditor through the same rent-fact
  // path as a direct collection.
  creditSettledDebt(amount, player) {
    const creditorId = this.pendingPayment.creditorId;
    if (!creditorId) return;
    const creditor = this.getPlayerById(creditorId);
    this.creditRentTo(creditor, player, amount);
  },

  settlePendingEquityShares(amount) {
    const pending = this.pendingPayment;
    if (pending.equityTileIndex == null) return;
    const equityTile = this.getTile(pending.equityTileIndex);
    const equityOwner = this.getPlayerById(pending.equityOwnerId);
    // pendingPayment.playerId is the seat that owes the rent, so the parked
    // (partial-payment) path books the same rent facts as a direct collection.
    this.settleEquityShares(equityTile, equityOwner, amount, this.getPlayerById(pending.playerId));
  },

  transferMoney(from, to, amount, message) {
    if (!from) return;
    if (!to) return;
    // NaN slips past `<= 0` and poisons both seats; Infinity mints money.
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return;
    from.cash -= amount;
    to.cash += amount;
    this.feedMessage(message);
  },

  deductMoney(player, amount, message) {
    this.chargePlayer({ player, amount, message, turnOptions: {} });
  }
};
