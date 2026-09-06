// Bank-credit rules: the emergency-loan offer ladder, term pricing under
// events, disbursement, repayments (amnesty and event discounts included),
// the due/cure/default clock, and collateral foreclosure. Pure module: it
// only mutates the GameState it is handed.
import { resolveUnsecuredBankDefault } from './bankruptcyLogic.js';

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
  if (game.globalEventActive('inflation-spiral')) premiumRate *= 1.25;
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
  const totalDue = principal + Math.ceil(principal * premiumRate);
  const collateral = game.highestCollateralProperty(player);
  return {
    principal,
    totalDue,
    premium: totalDue - principal,
    dueInRounds: BANK_LOAN_TERM_ROUNDS,
    dueRound: game.roundNumber + BANK_LOAN_TERM_ROUNDS,
    cureRound: game.roundNumber + BANK_LOAN_TERM_ROUNDS + 1,
    collateralTileIndex: collateral?.index ?? null,
    collateralName: collateral?.name || 'NONE',
    severity
  };
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
  if (player.inDebt) return 'Bank credit is unavailable right now.';
  return null;
}

function creditFacilityRejection(game, player) {
  if (!player) return 'Bank lending is disabled.';
  if (!game.settings.bankLoans) return 'Bank lending is disabled.';
  const seat = borrowerSeatRejection(player);
  if (seat) return seat;
  if (!game.started) return 'The game has not started.';
  if (creditFrozen(game)) return 'Credit is frozen by the active global event.';
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

function issueLoan(game, player, offer) {
  if (player.cash < BAD_IDEA_LOAN_CASH) player.badIdeaLoan = true;
  player.bankLoanCount = (player.bankLoanCount || 0) + 1;
  player.cash += offer.principal;
  player.bankLoan = {
    status: 'active',
    principal: offer.principal,
    totalDue: offer.totalDue,
    remaining: offer.totalDue,
    issuedRound: game.roundNumber,
    dueRound: offer.dueRound,
    cureRound: offer.cureRound,
    collateralTileIndex: offer.collateralTileIndex,
    collateralName: offer.collateralName || 'NONE',
    severity: offer.severity
  };
  game.feedMessage(`${player.nickname} accepted a $${offer.principal} bank loan. $${offer.totalDue} is due by round ${offer.dueRound}.`);
}

export function takeBankLoan(game, socketId, requestId = null) {
  const player = game.getPlayerBySocket(socketId);
  const key = game.transactionKey(player?.id, 'bank-loan', requestId);
  const cached = game.cachedTransaction(key);
  if (cached) return cached;
  const offer = bankLoanOffer(game, player);
  if (!offer.available) return { success: false, error: offer.reason };
  issueLoan(game, player, offer);
  return game.cacheTransaction(key, { success: true, loan: player.bankLoan });
}

function repaymentTurnRejection(game, player) {
  if (!player) return { success: false, error: 'It is not your turn.' };
  if (player.id !== game.currentPlayerId) return { success: false, error: 'It is not your turn.' };
  if (!outstandingLoan(player.bankLoan)) return { success: false, error: 'You have no bank loan to repay.' };
  return null;
}

function debtAmnestyApplies(game, requested, loan) {
  if (!game.globalEventActive('debt-amnesty')) return false;
  return requested >= loan.remaining;
}

function settlementDiscount(game, loan) {
  const multiplier = Number(game.activeEventEffects().loanSettlementMultiplier);
  if (!Number.isFinite(multiplier)) return loan.remaining;
  if (multiplier <= 0) return loan.remaining;
  return Math.ceil(loan.remaining * multiplier);
}

function markCureRoundRepayment(game, player, loan) {
  if (loan.status !== 'due') return;
  if (game.roundNumber !== loan.cureRound) return;
  player.oneMoreTurn = true;
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
  markCureRoundRepayment(game, player, loan);
  const discountedDue = settlementDiscount(game, loan);
  const payment = Math.min(amnesty ? discountedDue : requested, loan.remaining);
  if (player.cash < payment) return { error: `You need $${payment} to make this repayment.` };
  return { payment, amnesty };
}

function settleLoanRepayment(game, player, loan, plan) {
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
  game.feedMessage(`${player.nickname} repaid the bank loan in full.`);
}

export function repayBankLoan(game, socketId, payload = {}) {
  const { amount, requestId } = payload;
  const player = game.getPlayerBySocket(socketId);
  const key = game.transactionKey(player?.id, 'bank-repay', requestId);
  const cached = game.cachedTransaction(key);
  if (cached) return cached;
  const turnRejection = repaymentTurnRejection(game, player);
  if (turnRejection) return turnRejection;
  const plan = repaymentPlan(game, player, player.bankLoan, amount);
  if (plan.error) return { success: false, error: plan.error };
  settleLoanRepayment(game, player, player.bankLoan, plan);
  return game.cacheTransaction(key, { success: true, loan: player.bankLoan });
}

function seizableCollateral(collateral, player) {
  if (!collateral) return false;
  return collateral.ownerId === player.id;
}

export function defaultBankLoan(game, player) {
  const loan = player.bankLoan;
  if (!loan) return;
  const collateral = loan.collateralTileIndex == null ? null : game.getTile(loan.collateralTileIndex);
  if (seizableCollateral(collateral, player)) {
    seizeLoanCollateral(game, player, collateral);
  } else {
    // The bank files a claim instead of eliminating the seat outright: the
    // player now chooses between raising funds and declaring bankruptcy.
    resolveUnsecuredBankDefault(game, player, loan);
    loan.remaining = 0;
  }
  loan.status = 'defaulted';
  loan.defaultedRound = game.roundNumber;
}

function seizeLoanCollateral(game, player, collateral) {
  collateral.ownerId = null;
  collateral.mortgaged = false;
  collateral.houseCount = 0;
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
