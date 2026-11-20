// Bot-proposed player contracts: interest-bearing loans and passive equity stakes offered to eligible seats.
import { playerFinanceEnabled } from './financeRules.js';
// Loan-contract candidates are scored against the gate that decides them, so
// the willingness factor has to be the same number the responder applies
// rather than a second copy that drifts.
import { CONTRACT_REPAY_RATIO, tableObligationOpen } from './botContractPolicy.js';
import { isDealPartner } from './botTradeCandidates.js';

// The engine refuses a contract proposal while another table obligation is
// open (contractLogic.js), so the bot must not offer one either.
export function canProposeContracts(game, player) {
  if (!playerFinanceEnabled(game)) return false;
  if (!player) return false;
  if (player.id !== game.currentPlayerId) return false;
  if (tableObligationOpen(game)) return false;
  if (game.pendingTrade) return false;
  if (game.pendingPlayerContract) return false;
  if (player.isBot && Number(player.botDealActionsThisTurn) >= 1) return false;
  return true;
}

export function contractTargets(game, player, table, grudges) {
  return game.activePlayers()
    .filter(target => isDealPartner(player, table, grudges, target))
    .sort((a, b) => Number(b.cash || 0) - Number(a.cash || 0));
}

export function collectContractCandidates(ctx, target, out) {
  const { game, lenderCash, reserve } = ctx;
  const loan = loanContractCandidate(target, lenderCash, reserve);
  if (loan) out.push(loan);
  const property = targetTradeableProperty(game, target);
  if (!property) return;
  out.push(equityContractCandidate(target, property, lenderCash, reserve));
}

// Scoring the neediest borrower would reward the one seat that must decline: a $300 loan priced at $405 needs roughly $507 of cash to clear the accept gate.
// A needy borrower burns the lender's one deal action on a sure rejection. A loan the borrower cannot service is not offered (rent-share offers still reach that seat),
// and survivors rank by acceptance headroom, so a comfortable borrower outranks a bare-margin one.
const LOAN_PREMIUM_RATE = 35;
const LOAN_CONTRACT_BASE_SCORE = 10;
const LOAN_CONTRACT_HEADROOM_SCORE = 4;

// contractLogic prices a loan as amount + premium; the responder gate in
// botLogic.shouldAcceptPlayerContract then clears it only when
// totalDue <= cash * CONTRACT_REPAY_RATIO.
function loanTotalDue(offer) {
  const amount = Math.max(0, Math.floor(Number(offer?.amount) || 0));
  return amount + Math.ceil(amount * (Number(offer?.premiumRate) || 0) / 100);
}

function borrowerRepayCapacity(target) {
  return Number(target?.cash || 0) * CONTRACT_REPAY_RATIO;
}

function loanContractScore(totalDue, capacity) {
  return LOAN_CONTRACT_BASE_SCORE + LOAN_CONTRACT_HEADROOM_SCORE * (capacity - totalDue) / capacity;
}

function loanContractCandidate(target, lenderCash, reserve) {
  // Bots sign only interest-free loans (botContractPolicy.js), so a priced loan
  // aimed at a bot is a sure refusal that still burns the one deal action.
  if (target.isBot) return null;
  const amount = Math.min(300, Math.max(100, Math.floor(Math.max(0, lenderCash - reserve) / 3)));
  const offer = { toPlayerId: target.id, kind: 'loan', amount, premiumRate: LOAN_PREMIUM_RATE, durationRounds: 3, collateralTileIndex: null };
  const totalDue = loanTotalDue(offer);
  const capacity = borrowerRepayCapacity(target);
  if (!(capacity > 0) || totalDue > capacity) return null;
  return {
    id: 'contract:loan:' + target.id,
    kind: 'contract-propose',
    offer,
    risk: amount / lenderCash,
    score: loanContractScore(totalDue, capacity)
  };
}

function equityContractCandidate(target, property, lenderCash, reserve) {
  const amount = Math.min(200, Math.max(50, Math.floor((lenderCash - reserve) / 5)));
  return {
    id: 'contract:equity:' + target.id + ':' + property.index,
    kind: 'contract-propose',
    offer: { toPlayerId: target.id, kind: 'equity', amount, premiumRate: 0, durationRounds: 3, propertyIndex: property.index, equityShare: 15, equityControl: 'passive', permanent: false },
    risk: 0.2,
    score: 8
  };
}

function targetTradeableProperty(game, target) {
  return (target.properties || [])
    .map(index => game.getTile(index))
    .find(tile => tile && game.isTradeableTile(tile) && tile.type === 'property' && tile.houseCount === 0 && !tile.mortgaged);
}
