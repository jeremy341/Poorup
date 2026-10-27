// Bank-credit rules: the emergency-loan offer ladder, term pricing under
// events, disbursement, repayments (amnesty and event discounts included),
// the due/cure/default clock, and collateral foreclosure. Pure module: it
// only mutates the GameState it is handed.
import { stampCollateralAgreement, collateralCreditPlan, usesCollateralCredit, settleCollateralAtomically, recordCollateralCredit } from './collateralSettlement.js';
import { resolveUnsecuredBankDefault } from './bankruptcyLogic.js';
import { AUCTION_COMMITTED_CASH_ERROR } from './auctionApi.js';

export const LOAN_OUTSTANDING_STATUSES = ['active', 'due'];
const BANK_LOAN_PRINCIPAL = 300;
const BANK_LOAN_TERM_ROUNDS = 3;
const LOAN_OFFER_CASH_CEILING = 250;
const BAD_IDEA_LOAN_CASH = 50;
const CREDIT_FREEZE_EVENTS = ['credit-freeze', 'bank-run'];

// A loan in flight makes every dollar of the borrower's cash "loan-backed"
// for casino, contract, and market guards.
export function hasLoanBackedCash(player) {
  if (!player.bankLoan) return false;
  return LOAN_OUTSTANDING_STATUSES.includes(player.bankLoan.status);
}

function loanSeverity(settings) {
  if (settings.bankLoanSeverity === 'extreme') return 'extreme';
  if (settings.bankLoanSeverity === 'fair') return 'fair';
  return 'predatory';
}

function basePremiumRate(severity) {
  if (severity === 'extreme') return 0.8;
  if (severity === 'fair') return 0.2;
  return 0.5;
}

function electionBankFirst(game) {
  if (game.globalEvent?.phase !== 'active') return false;
  if (game.globalEvent.id !== 'city-election') return false;
  return game.globalEvent.resolvedChoice === 'bank-first';
}

function premiumRateAfterEvents(game, rate) {
  let premiumRate = rate;
  const loanPremiumMultiplier = Number(game.activeEventEffects().loanPremiumMultiplier);
  if (Number.isFinite(loanPremiumMultiplier)) {
    if (loanPremiumMultiplier > 0) premiumRate *= loanPremiumMultiplier;
  }
  if (electionBankFirst(game)) premiumRate *= 0.8;
  return premiumRate;
}

export function bankLoanTerms(game, player) {
  const severity = loanSeverity(game.settings);
  const premiumRate = premiumRateAfterEvents(game, basePremiumRate(severity));
  const principal = BANK_LOAN_PRINCIPAL;
  // Round the product to 6 decimals first: chained multipliers (x0.8, x1.5) leave
  // float residue that a bare ceil turns into an extra dollar.
  const totalDue = principal + Math.ceil(Math.round(principal * premiumRate * 1e6) / 1e6);
  const collateral = game.highestCollateralProperty(player);
  const terms = {
    rulesVersion: 2,
    principal,
    totalDue,
    premium: totalDue - principal,
    dueInRounds: BANK_LOAN_TERM_ROUNDS,
    dueRound: game.roundNumber + BANK_LOAN_TERM_ROUNDS,
    cureRound: game.roundNumber + BANK_LOAN_TERM_ROUNDS + 1,
    collateralTileIndex: collateral?.index ?? null,
    collateralTileIndices: collateral ? [collateral.index] : [],
    collateralName: collateral?.name || 'NONE',
    severity
  };
  stampCollateralAgreement(game, terms, terms.collateralTileIndices);
  return terms;
}

function creditFrozen(game) {
  const frozenByEvent = CREDIT_FREEZE_EVENTS.some(id => game.globalEventActive(id));
  if (frozenByEvent) return true;
  const effects = game.activeEventEffects();
  if (effects.bankLoansBlocked) return true;
  return Boolean(effects.bankActionsBlocked);
}

function outstandingLoan(loan) {
  if (!loan) return false;
  return LOAN_OUTSTANDING_STATUSES.includes(loan.status);
}

export function bankLoanOffer(game, player) {
  const reason = bankLoanOfferRejection(game, player);
  if (reason) return { available: false, reason };
  return { available: true, ...bankLoanTerms(game, player) };
}

// Guard order and wording are pinned by server/gameLogic.test.js. The
// facility-side checks run first, then the borrower-side checks. A dead seat
// or a debt-mode seat never reaches the turn gate, mirroring the casino and
// market liveness wording.
function borrowerSeatRejection(player) {
  if (player.bankrupt) return 'Bank credit is unavailable right now.';
  if (player.disconnected) return 'Bank credit is unavailable right now.';
  return null;
}

function creditFacilityRejection(game, player) {
  if (!player) return 'Bank credit is unavailable right now.';
  if (!game.settings.bankLoans) return 'Bank lending is disabled.';
  const seat = borrowerSeatRejection(player);
  if (seat) return seat;
  if (!game.started) return 'The game has not started.';
  if (creditFrozen(game)) return 'Credit is frozen by the active global event.';
  if (game.auction || game.pendingPurchaseOffer || game.pendingSponsoredPurchase || game.pendingTrade || game.pendingPlayerContract) return 'Resolve the table obligation before borrowing.';
  if (player.id !== game.currentPlayerId) return 'Bank credit is available during your turn.';
  return null;
}

function borrowerCreditRejection(player) {
  if (outstandingLoan(player.bankLoan)) return 'You already have an active bank loan.';
  if (player.bankLoan?.status === 'defaulted') return 'Bank credit is suspended after your previous default.';
  if (player.cash > LOAN_OFFER_CASH_CEILING) return `Emergency credit unlocks below $${LOAN_OFFER_CASH_CEILING} cash.`;
  return null;
}

function bankLoanOfferRejection(game, player) {
  const facilityRejection = creditFacilityRejection(game, player);
  if (facilityRejection) return facilityRejection;
  return borrowerCreditRejection(player);
}

// The identity of one loan instance. The replay cache is scoped to it, so the
// same request id against a later loan is a new repayment instead of a replay
// of the earlier answer. Legacy or hand-repaired loans carry no id: the
// fields that pin the instance stand in for it.
function loanIdentity(loan) {
  if (!loan) return 'no-loan';
  if (loan.loanId) return String(loan.loanId);
  return `legacy-${loan.issuedRound ?? 'x'}-${loan.dueRound ?? 'x'}-${loan.totalDue ?? 'x'}`;
}

// The cached answer must not alias the live loan: a repayment mutates that
// object in place, so a replay would otherwise hand back the later state.
function loanSnapshot(loan) {
  return loan ? structuredClone(loan) : null;
}

function issueLoan(game, player, offer) {
  if (player.cash < BAD_IDEA_LOAN_CASH) player.badIdeaLoan = true;
  player.bankLoanCount = (player.bankLoanCount || 0) + 1;
  player.cash += offer.principal;
  player.bankLoan = {
    loanId: `loan_${player.id}_${player.bankLoanCount}`,
    rulesVersion: 2,
    status: 'active',
    principal: offer.principal,
    totalDue: offer.totalDue,
    remaining: offer.totalDue,
    issuedRound: game.roundNumber,
    dueRound: offer.dueRound,
    cureRound: offer.cureRound,
    collateralTileIndex: offer.collateralTileIndex,
    collateralTileIndices: offer.collateralTileIndices.slice(),
    collateralCreditVersion: offer.collateralCreditVersion,
    collateralValuation: offer.collateralValuation,
    collateralCreditQuotes: structuredClone(offer.collateralCreditQuotes),
    collateralName: offer.collateralName || 'NONE',
    severity: offer.severity
  };
  game.feedMessage(`${player.nickname} accepted a $${offer.principal} bank loan. $${offer.totalDue} is due by round ${offer.dueRound}.`);
}

export function takeBankLoan(game, socketId, requestId = null) {
  if (!game.started) return { success: false, error: 'The game has not started.' };
  if (!game.settings.bankLoans) return { success: false, error: 'Bank lending is disabled.' };
  const player = game.getPlayerBySocket(socketId);
  const key = game.transactionKey(player?.id, 'bank-loan', requestId);
  const cached = game.cachedTransaction(key);
  if (cached) return cached;
  const offer = bankLoanOffer(game, player);
  if (!offer.available) return { success: false, error: offer.reason };
  issueLoan(game, player, offer);
  // The loan is an allowed rescue while a payment is parked: the fresh cash
  // must clear the debt it was borrowed for, not wait for an unrelated action.
  if (game.pendingPayment?.playerId === player.id) game.trySettlePendingPayment();
  return game.cacheTransaction(key, { success: true, loan: loanSnapshot(player.bankLoan) });
}

function repaymentTurnRejection(game, player) {
  if (!player) return { success: false, error: 'It is not your turn.' };
  if (player.id !== game.currentPlayerId) return { success: false, error: 'It is not your turn.' };
  if (!outstandingLoan(player.bankLoan)) return { success: false, error: 'You have no bank loan to repay.' };
  return null;
}

function debtAmnestyApplies(game, requested, loan) {
  if (!game.globalEventIncludes('debt-amnesty')) return false;
  return requested >= loan.remaining;
}

function settlementDiscount(game, loan) {
  const multiplier = Number(game.activeEventEffects().loanSettlementMultiplier);
  if (!Number.isFinite(multiplier)) return loan.remaining;
  if (multiplier <= 0) return loan.remaining;
  return Math.ceil(loan.remaining * multiplier);
}

function repaymentAmountError(requested) {
  if (!Number.isFinite(requested)) return 'Enter a valid repayment amount.';
  if (requested <= 0) return 'Enter a valid repayment amount.';
  return null;
}

// Computes the effective payment: debt-amnesty forgives the discounted
// balance, an event settlement multiplier lowers the amount owed.
function repaymentPlan(game, player, loan, amount) {
  const requested = amount == null ? loan.remaining : Math.floor(Number(amount));
  const amountError = repaymentAmountError(requested);
  if (amountError) return { error: amountError };
  const amnesty = debtAmnestyApplies(game, requested, loan);
  const discountedDue = settlementDiscount(game, loan);
  const payment = Math.min(amnesty ? discountedDue : requested, loan.remaining);
  if (player.cash < payment) return { error: `You need $${payment} to make this repayment.` };
  if (game.spendableCash(player) < payment) return { error: AUCTION_COMMITTED_CASH_ERROR };
  return { payment, amnesty };
}

function settleLoanRepayment(game, player, loan, plan) {
  const paidOnFinalCureRound = loan.status === 'due' && game.roundNumber === loan.cureRound;
  player.cash -= plan.payment;
  loan.remaining -= plan.payment;
  if (plan.amnesty) loan.remaining = 0;
  if (loan.remaining > 0) {
    game.feedMessage(`${player.nickname} repaid $${plan.payment} on the bank loan. $${loan.remaining} remains.`);
    return;
  }
  loan.remaining = 0;
  loan.status = 'paid';
  loan.paidRound = game.roundNumber;
  if (paidOnFinalCureRound) player.oneMoreTurn = true;
  game.feedMessage(`${player.nickname} repaid the bank loan in full.`);
}

export function repayBankLoan(game, socketId, payload = {}) {
  const { amount, requestId } = payload;
  const player = game.getPlayerBySocket(socketId);
  // The replay is scoped to the loan instance: the same request id against a
  // later loan is a new repayment, not a replay of the earlier answer.
  const key = game.transactionKey(player?.id, `bank-repay:${loanIdentity(player?.bankLoan)}`, requestId);
  const cached = game.cachedTransaction(key);
  if (cached) return cached;
  const turnRejection = repaymentTurnRejection(game, player);
  if (turnRejection) return turnRejection;
  const plan = repaymentPlan(game, player, player.bankLoan, amount);
  if (plan.error) return { success: false, error: plan.error };
  settleLoanRepayment(game, player, player.bankLoan, plan);
  return game.cacheTransaction(key, { success: true, loan: loanSnapshot(player.bankLoan) });
}

function seizableCollateral(collateral, player) {
  if (!collateral) return false;
  return collateral.ownerId === player.id;
}

// What the seat already owes through the shared claim queue: the head claim
// plus every queued one.
function pendingDebtOwedBy(game, player) {
  if (typeof game.pendingDebtAmountFor === 'function') return game.pendingDebtAmountFor(player.id);
  let owed = game.pendingPayment?.playerId === player.id
    ? Math.max(0, Number(game.pendingPayment.amountRemaining) || 0)
    : 0;
  (Array.isArray(game.pendingPaymentQueue) ? game.pendingPaymentQueue : []).forEach(entry => {
    if (entry?.payment?.playerId === player.id) owed += Math.max(0, Number(entry.payment.amountRemaining) || 0);
  });
  return owed;
}

const BANK_CLAIM_REASON = 'The bank calls in a defaulted loan.';

// The bank claim is a claim like any other: it is settled through the shared
// queue, and the loan balance is only cleared once the bank has been paid.
function bankClaimHooks(loan) {
  return {
    onPaid: (amount) => {
      const paid = Math.max(0, Math.floor(Number(amount) || 0));
      loan.remaining = Math.max(0, (Number(loan.remaining) || 0) - paid);
      if (usesCollateralCredit(loan)) loan.residualDebt = loan.remaining;
    }
  };
}

// The claim joins the queue behind the debt the seat already owes. Its cash
// stays reserved for that earlier claim, so nothing is tendered here.
function queueBankClaim(game, player, loan, owed) {
  const payment = {
    playerId: player.id,
    creditorId: null,
    amountRemaining: owed,
    reason: BANK_CLAIM_REASON
  };
  const hooks = bankClaimHooks(loan);
  if (game.pendingPayment) {
    game.pendingPaymentQueue ||= [];
    game.pendingPaymentQueue.push({ payment, hooks, turnOptions: {} });
    game.syncDebtFlags?.();
    game.feedMessage(`${player.nickname} owes $${owed} to the bank; the payment is queued behind the current debt.`);
    return;
  }
  game.openDebtSettlement({
    player,
    creditor: null,
    amount: owed,
    message: BANK_CLAIM_REASON,
    turnOptions: {},
    hooks
  });
}

// An unsecured default files a bank claim instead of eliminating the seat
// outright: the player now chooses between raising funds and declaring
// bankruptcy. The claim is settled through the shared queue, so a debt the
// seat already owes is paid first, and the loan balance survives until the
// bank has actually been paid.
function defaultUnsecuredBankLoan(game, player, loan) {
  const owed = Math.max(0, Math.floor(Number(loan.remaining) || 0));
  loan.status = 'defaulted';
  loan.defaultedRound = game.roundNumber;
  if (owed <= 0) {
    loan.remaining = 0;
    return;
  }
  if (pendingDebtOwedBy(game, player) > 0) {
    game.feedMessage(`${player.nickname} defaulted on an unsecured bank loan.`);
    queueBankClaim(game, player, loan, owed);
    return;
  }
  if (player.cash >= owed) {
    // Nobody is ahead of the bank in the queue: the claim is settled outright.
    resolveUnsecuredBankDefault(game, player, loan);
    loan.remaining = 0;
    return;
  }
  game.feedMessage(`${player.nickname} defaulted on an unsecured bank loan.`);
  game.openDebtSettlement({
    player,
    creditor: null,
    amount: owed,
    message: BANK_CLAIM_REASON,
    turnOptions: {},
    hooks: bankClaimHooks(loan)
  });
}

export function defaultBankLoan(game, player, options = {}) {
  const loan = player.bankLoan;
  if (usesCollateralCredit(loan)) return defaultBankLoanWithCredit(game, player, loan, options);
  if (!loan) return;
  const collateral = loan.collateralTileIndex == null ? null : game.getTile(loan.collateralTileIndex);
  if (seizableCollateral(collateral, player)) {
    seizeLoanCollateral(game, player, collateral);
    loan.remaining = 0;
    loan.status = 'defaulted';
    loan.defaultedRound = game.roundNumber;
    return;
  }
  defaultUnsecuredBankLoan(game, player, loan);
}

function defaultBankLoanWithCredit(game, player, loan, { allowBankruptCollateral = false } = {}) {
  if (!outstandingLoan(loan) || (player.bankrupt && !allowBankruptCollateral)) return false;
  const outstanding = Math.max(0, Math.floor(Number(loan.remaining) || 0));
  const plan = collateralCreditPlan(game, player, loan, outstanding, { allowBankruptCollateral });
  return settleCollateralAtomically(game, loan, () => {
    for (const index of plan.seizedTileIndices) seizeLoanCollateral(game, player, game.getTile(index));
    if (plan.seizedTileIndices.length) game.refreshPlayerGroups?.(player);
    recordCollateralCredit(loan, plan, game.roundNumber);
    game.feedMessage(`${player.nickname}'s bank collateral credited $${plan.credit}; residual debt: $${plan.remaining}.`);
    if (allowBankruptCollateral) {
      if (plan.remaining > 0) {
        loan.residualWrittenOff = plan.remaining;
        game.feedMessage(`${player.nickname}'s $${plan.remaining} residual bank loan debt was written off on exit.`);
      }
      return;
    }
    if (plan.remaining > 0) defaultUnsecuredBankLoan(game, player, loan);
    loan.residualDebt = loan.remaining;
  });
}

// Buildings liquidate at the same rate a sale would pay, so an active global
// event that moves the sale value moves the seizure with it.
function buildingSaleRate(game) {
  if (typeof game.buildingSaleMultiplier !== 'function') return 0.5;
  const rate = Number(game.buildingSaleMultiplier());
  if (!Number.isFinite(rate) || rate < 0) return 0.5;
  return rate;
}

export function seizeLoanCollateral(game, player, collateral) {
  // Legacy or hand-repaired state may still carry equity entries. Terminate
  // them before the bank takes the deed so no holder can keep collecting from
  // a property that no longer has an owner.
  game.terminateTileEquityShares?.(collateral);
  // Houses are the borrower's paid value: liquidate them at the standard
  // half-rate into cash before the deed moves, instead of wiping them.
  const houses = Math.max(0, Math.min(5, Number(collateral.houseCount) || 0));
  if (houses > 0 && typeof game.getPropertyHouseCost === 'function') {
    try {
      player.cash = Math.max(0, Number(player.cash) || 0)
        + Math.floor(houses * Number(game.getPropertyHouseCost(collateral)) * buildingSaleRate(game));
    } catch { /* cost lookup failure must not block seizure */ }
  }
  collateral.ownerId = null;
  collateral.purchasePricePaid = null;
  collateral.mortgaged = false;
  collateral.houseCount = 0;
  collateral.equityShares = [];
  player.properties = player.properties.filter(index => index !== collateral.index);
  player.collateralLost = true;
  game.feedMessage(`${player.nickname} defaulted. The bank seized ${collateral.name}.`);
}

function noteLoanDue(game, player, loan) {
  if (game.roundNumber < loan.dueRound) return;
  loan.status = 'due';
  player.loanWarningSeen = true;
  game.feedMessage(`${player.nickname}'s bank loan is due: $${loan.remaining}. One cure round remains.`);
}

function foreclosePastCure(game, player, loan) {
  if (game.roundNumber <= loan.cureRound) return;
  defaultBankLoan(game, player);
}

function advanceBankLoan(game, player) {
  const loan = player.bankLoan;
  if (!outstandingLoan(loan)) return;
  if (player.bankrupt) return;
  if (loan.status === 'active') {
    noteLoanDue(game, player, loan);
    return;
  }
  if (loan.status === 'due') foreclosePastCure(game, player, loan);
}

export function processBankLoans(game) {
  game.players.forEach(player => advanceBankLoan(game, player));
}
