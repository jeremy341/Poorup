import { playerFinanceEnabled } from './financeRules.js';
// Pure bot decision policy, extracted verbatim from the scheduleBotTurn/
// scheduleBotAuction timers in server.js. Every function here is deterministic
// and free of timers, sockets, and IO, so the whole policy is characterization-
// testable in isolation (server/botLogic.test.js pins the exact answers).
// The server keeps only scheduling and execution; it asks these helpers what
// a bot should do and runs the answer through room.runBotAction.
import { buildBotStrategicContext, BOT_RULE_VERSION } from './botStrategicContext.js';
import { evaluateCandidate, planningHorizon } from './botFuturePlanner.js';
import { groupBuildPlan } from './botDevelopmentForecast.js';
import {
  vetoTrade, portfolioDeedValue, tradeSetChanges, TRADE_MIN_NET_GAIN, TRADE_DECLINE_COOLDOWN_ROUNDS
} from './botTradeValuation.js';
import { CONTRACT_REPAY_RATIO, borrowerAcceptsContract } from './botContractPolicy.js';
import { tickLedger, coalitionAgainst, addGrudge, coolOffTradePair, tradePairKey } from './botTableMind.js';
import {
  SPONSORSHIP_RESERVE_CASH,
  sponsorshipContributionAmount,
  sponsorCanFundBuyer,
  isSponsorshipActor
} from './sponsorshipLogic.js';
import {
  findPendingCounterpart,
  contractResponderId,
  declineForCheapAuction,
  auctionWillingness
} from './botCandidates.js';
import { auctionLiquidityReserve, completesColourSet, auctionRaiseOptions, defaultAuctionRaise, isAuctionRaise, AUCTION_BID_STEP, AUCTION_BID_INCREMENTS } from './botAuctionPolicy.js';
import { runAdvisorChoicePhase, runAdvisorTurn, PHASE_EXECUTORS } from './advisorLogic.js';

export { sponsorshipContributionAmount };
export { debtMortgageCandidates } from './botCandidates.js';
export { getBotChoiceCandidates, runPaymentChoice } from './advisorLogic.js';

export const EVENT_POLICY = 'low-tax';
export const TRADE_ACCEPT_RATIO = 0.8;
export { CONTRACT_REPAY_RATIO };
export { AUCTION_BID_STEP, AUCTION_BID_INCREMENTS };
const ADVISOR_CHOICE_PHASES = new Set(['vote', 'trade', 'contract', 'sponsorship', 'payment', 'auction']);
// Property purchase keeps this much cash in reserve before buying.
export const PURCHASE_RESERVE_CASH = 120;

export function attachBotDecision(result, decision, evaluationTrace = null) {
  if (!result || typeof result !== 'object') return result;
  return {
    ...result,
    botDecision: { ...decision, success: result.success !== false },
    ...(evaluationTrace ? { evaluationTrace } : {})
  };
}

export function splitEvaluationTrace(decision = {}) {
  const { shadowEvaluation, ...botDecision } = decision || {};
  return { botDecision, evaluationTrace: shadowEvaluation || null };
}

// House difficulty is an immediate-outcome policy: its horizon stays at 0, so
// it must not be floored to one turn (that made House vote like Table).
function eventChoiceHorizon(game) {
  return planningHorizon(game?.settings?.botDifficulty || 'table');
}

function cityElectionChoiceUtility(game, bot, choice) {
  const horizon = eventChoiceHorizon(game);
  const tiles = Array.isArray(game?.tiles) ? game.tiles : [];
  const landingRate = 0.08 * horizon;
  if (choice.id === 'low-tax') {
    const taxExposure = tiles.filter(tile => tile.type === 'tax')
      .reduce((sum, tile) => sum + Math.max(0, Number(tile.amount || tile.price) || 0), 0);
    const cashNeed = Number(bot?.cash || 0) < Number(game.settings?.startingCash || 1500) * 0.5 ? 1.5 : 1;
    return taxExposure * 0.4 * landingRate * cashNeed;
  }
  if (choice.id === 'public-works') {
    const ownedGroups = [...new Set((bot?.properties || []).map(index => game.getTile?.(index)?.group).filter(Boolean))];
    const buildSavings = ownedGroups.reduce((sum, group) => {
      const board = (game.getGroupTiles?.(group) || []).map(tile => ({
        ...tile,
        ownerSeat: tile.ownerId === bot.id ? 'self' : 'bank'
      }));
      const plan = groupBuildPlan(board, group, tile => game.getPropertyHouseCost?.(tile));
      return sum + (plan ? plan.cost * 0.35 : 0);
    }, 0);
    const ownedRent = (bot?.properties || []).reduce((sum, index) => {
      const tile = game.getTile?.(index);
      return sum + Math.max(0, Number(game.calculateRent?.(tile) ?? tile?.rent) || 0);
    }, 0);
    return buildSavings - ownedRent * 0.25 * landingRate;
  }
  if (choice.id === 'bank-first') {
    if (game.settings?.bankLoans === false) return -1;
    const offer = game.getBankLoanOffer?.(bot);
    const premiumSavings = offer?.available ? Number(offer.premium || 0) * 0.2 : 0;
    const liquidityNeed = Number(bot?.cash || 0) < Number(game.settings?.startingCash || 1500) * 0.35 ? 25 : 0;
    return premiumSavings + liquidityNeed;
  }
  return 0;
}

// The cash share below which a seat counts as distressed, and the rescue a
// bailout pays. Both mirror the engine rules (globalEventData.js).
const EVENT_DISTRESS_RATIO = 0.35;

function eventStartingCash(game) {
  return Math.max(1, Number(game?.settings?.startingCash) || 1500);
}

function eventDistressed(game, bot) {
  return Number(bot?.cash || 0) < eventStartingCash(game) * EVENT_DISTRESS_RATIO;
}

// The anti-monopoly target is the portfolio under review: the target wants the
// audit dismissed, every other seat wants the leader's rent capped.
function antiMonopolyChoiceUtility(globalEvent, choice, game, bot) {
  const isTarget = Boolean(globalEvent?.targetPlayerId) && globalEvent.targetPlayerId === bot?.id;
  if (choice?.id === 'enforce') return isTarget ? -12 : 4;
  if (choice?.id === 'dismiss') return isTarget ? 6 : -1;
  return 0;
}

// The bailout pays the seats below the distress line: a distressed seat wants
// the rescue, a solvent seat does not pay for it, and a loan-backed seat would
// carry the moral-hazard premium that comes with the money.
function bailoutChoiceUtility(globalEvent, choice, game, bot) {
  const rescue = Math.max(50, Math.floor(eventStartingCash(game) * 0.1));
  const distressed = eventDistressed(game, bot);
  if (choice?.id === 'emergency-bailout') {
    if (distressed) return rescue;
    return ['active', 'due'].includes(bot?.bankLoan?.status) ? -15 : 0;
  }
  if (choice?.id === 'let-the-ledger-run') return distressed ? -rescue : 1;
  return 0;
}

// The audit keeps the tax multiplier alive: a strained seat takes the quiet
// exit, a solvent seat keeps the books clean instead of buying the stigma.
function legitimacyCrisisChoiceUtility(globalEvent, choice, game, bot) {
  const strained = Number(bot?.cash || 0) < eventStartingCash(game) * 0.5;
  if (choice?.id === 'publish-audit') return strained ? -2 : 2;
  if (choice?.id === 'bury-audit') return strained ? 3 : -2;
  return 0;
}

// Every vote with a choice the bot can weigh on its own table. An event that
// is not listed here keeps the legacy first-choice fallback.
const EVENT_CHOICE_UTILITIES = {
  'anti-monopoly': antiMonopolyChoiceUtility,
  'bank-run': bailoutChoiceUtility,
  'moral-hazard': bailoutChoiceUtility,
  'legitimacy-crisis': legitimacyCrisisChoiceUtility
};

export function globalEventPolicyUtility(globalEvent, choice, game, bot) {
  if (globalEvent?.id === 'city-election') return cityElectionChoiceUtility(game, bot, choice);
  const eventUtility = EVENT_CHOICE_UTILITIES[globalEvent?.id];
  if (eventUtility) return eventUtility(globalEvent, choice, game, bot);
  return choice?.id === EVENT_POLICY ? 1 : 0;
}

export function selectGlobalEventPolicy(globalEvent, game = null, bot = null) {
  const choices = Array.isArray(globalEvent?.choices) ? globalEvent.choices : [];
  if (!choices.length) return null;
  if (!game || !bot) return choices.find(choice => choice.id === EVENT_POLICY) || choices[0];
  return choices.reduce((best, choice) => !best
    || globalEventPolicyUtility(globalEvent, choice, game, bot) > globalEventPolicyUtility(globalEvent, best, game, bot)
    ? choice : best, null);
}

export function tradeLegValue(leg, getTile) {
  const cash = Number(leg?.cash || 0);
  const properties = (leg?.propertyIndexes || []).reduce((sum, index) => sum + Number(getTile(index)?.price || 0), 0);
  return cash + properties;
}

function clearsTradeBar(giveValue, askValue, factor) {
  // Game currency is whole dollars. Compare cents after scaling so a fair
  // $440 offer is not rejected as 440.00000000000006 by binary floating point.
  return Math.round(giveValue * 100) >= Math.round(askValue * factor * 100);
}

// Monopoly veto first: never hand over a build-ready monopoly completer,
// no matter how flattering the face value looks. Shapes without player
// ids or grouped tiles (incl. legacy unit tests) skip the veto and keep
// the pinned face-value behavior.
function tradeVetoed(game, trade) {
  if (!game) return false;
  if (!trade?.toPlayerId) return false;
  return vetoTrade(game, trade, trade.toPlayerId).vetoed;
}

// Teaming premium: a proposer colluding with a third seat pays 1.5x.
// Thin stubs without player lists simply skip the premium.
function colludingProposer(game, trade) {
  if (!game) return false;
  if (!trade?.fromPlayerId) return false;
  if (!trade?.toPlayerId) return false;
  try {
    const table = coalitionAgainst(game, trade.toPlayerId);
    return Boolean(table.teaming && table.pair.includes(trade.fromPlayerId));
  } catch {
    return false;
  }
}

function teamingAcceptFactor(game, trade, factor) {
  return colludingProposer(game, trade) ? factor * 1.5 : factor;
}

// A deed leg the engine cannot deliver at settlement time: the deed is gone,
// no longer owned by the seat that must hand it over, or encumbered.
function tradeLegDeliverable(game, tile, ownerId) {
  if (!tile) return false;
  if (typeof game.tradeLegTileUnavailable === 'function') {
    return !game.tradeLegTileUnavailable(tile, ownerId);
  }
  // A board stub without the engine's own leg check: only a deed that names a
  // different owner is known to be undeliverable.
  if (tile.ownerId == null) return true;
  return tile.ownerId === ownerId;
}

function spendableCashOf(game, player) {
  if (typeof game.spendableCash === 'function') return Number(game.spendableCash(player));
  return Number(player?.cash || 0);
}

// The accept-side guards the engine runs when the offer is answered (see the
// settlement guards in tradeApi.js): both seats must still be alive, both deed
// legs must still be deliverable, and the answering seat must be able to fund
// its own cash leg. An offer that cannot pass them is void the moment the bot
// says yes, so the bot never accepts one.
function tradeSettlementReady(game, trade) {
  if (!game || !trade) return true;
  if (typeof game.getPlayerById !== 'function') return true;
  const from = game.getPlayerById(trade.fromPlayerId);
  const to = game.getPlayerById(trade.toPlayerId);
  // A seat the board cannot resolve (a bare stub) is left to the engine.
  if (from && !isLiveSeat(from)) return false;
  if (to && !isLiveSeat(to)) return false;
  const giveTiles = (trade.givePropertyIndexes || []).map(index => game.getTile?.(index));
  const requestTiles = (trade.requestPropertyIndexes || []).map(index => game.getTile?.(index));
  if (giveTiles.some(tile => !tradeLegDeliverable(game, tile, trade.fromPlayerId))) return false;
  if (requestTiles.some(tile => !tradeLegDeliverable(game, tile, trade.toPlayerId))) return false;
  if (to && spendableCashOf(game, to) < Number(trade.requestCash || 0)) return false;
  // The engine checks the proposer's raw cash against giveCash at settlement.
  if (from && Number(from.cash || 0) < Number(trade.giveCash || 0)) return false;
  return true;
}

export function shouldAcceptTrade(trade, getTile, game = null) {
  if (!tradeSettlementReady(game, trade)) return false;
  if (tradeVetoed(game, trade)) return false;
  const factor = teamingAcceptFactor(game, trade, TRADE_ACCEPT_RATIO);
  const responder = typeof game?.getPlayerById === 'function' ? game.getPlayerById(trade?.toPlayerId) : null;
  if (responder && Array.isArray(responder.properties)) {
    const outgoing = (trade.requestPropertyIndexes || []).map(Number);
    const incoming = (trade.givePropertyIndexes || []).map(Number);
    const nextProperties = [...new Set([
      ...responder.properties.filter(index => !outgoing.includes(Number(index))),
      ...incoming
    ])];
    const propertyDelta = portfolioDeedValue(game, responder.id, nextProperties)
      - portfolioDeedValue(game, responder.id, responder.properties);
    // Set protection: a trade that costs the responder a complete colour set is
    // only taken when it hands another one back.
    const sets = tradeSetChanges(game, responder.id, outgoing, incoming);
    if (sets.breaks.length > sets.completes.length) return false;
    const cashDelta = Number(trade.giveCash || 0) - Number(trade.requestCash || 0);
    const net = cashDelta + propertyDelta;
    // Value-neutral deed swaps are refused: they only churn the board.
    if (outgoing.length && incoming.length && net < TRADE_MIN_NET_GAIN) return false;
    const askValue = tradeLegValue({ cash: trade.requestCash, propertyIndexes: outgoing }, getTile);
    return clearsTradeBar(net, askValue, factor - 1);
  }
  const giveValue = tradeLegValue({ cash: trade.giveCash, propertyIndexes: trade.givePropertyIndexes }, getTile);
  const askValue = tradeLegValue({ cash: trade.requestCash, propertyIndexes: trade.requestPropertyIndexes }, getTile);
  return clearsTradeBar(giveValue, askValue, factor);
}

// The bot is the recipient of the offer. The terms it will sign live in
// botContractPolicy.js (premium, collateral, set protection, equity price).
export function shouldAcceptPlayerContract(offer, bot, lender, game = null) {
  return borrowerAcceptsContract(offer, bot, { lender, game });
}

// Who should the bot timer serve right now: an unvoted bot in a vote beats
// the counterparty of a pending offer, which beats the current player.
export function selectBotTurnTarget(game) {
  const voting = findVotingBot(game);
  if (voting) return voting;
  const pending = findPendingCounterpart(game);
  if (pending?.isBot) {
    // A seat that is bankrupt or disconnected can never answer the offer it
    // holds, and the scheduler would stall on it. Wake nobody instead, and
    // drop the obligation so the table keeps moving.
    if (isLiveSeat(pending)) return pending;
    pruneDeadObligation(game, pending);
  }
  // A sponsorship can remain open for human contributors. Do not repeatedly
  // wake the buyer's turn while it is waiting for the table.
  if (game.pendingSponsoredPurchase) return null;
  return game.getCurrentPlayer();
}

// A seat that is out of the game cannot answer anything it is holding.
function isLiveSeat(player) {
  if (!player) return false;
  return !player.bankrupt && !player.disconnected;
}

// The obligation a dead seat can never discharge is dropped, so the table is
// not held hostage by an offer nobody can accept, decline, or counter.
function pruneDeadObligation(game, dead) {
  const trade = game.pendingTrade;
  if (trade && trade.toPlayerId === dead.id) game.pendingTrade = null;
  const contract = game.pendingPlayerContract;
  if (contract && contractResponderId(contract) === dead.id) game.pendingPlayerContract = null;
  if (game.pendingSponsoredPurchase?.buyerId === dead.id) {
    game.clearSponsoredPurchaseForPlayer?.(dead.id);
  }
}

function eligibleUnvotedBot(game, player) {
  if (!player.isBot) return false;
  if (!isLiveSeat(player)) return false;
  return !game.globalEvent.votes?.[player.id];
}

// The engine refuses every vote while a payment or auction is open, so serving an
// unvoted bot first would starve the debtor that has to clear it.
function votingBlocked(game) {
  return Boolean(game.pendingPayment || game.auction?.active);
}

function findVotingBot(game) {
  if (game.globalEvent?.phase !== 'voting') return null;
  if (votingBlocked(game)) return null;
  return game.players.find(player => eligibleUnvotedBot(game, player)) || null;
}

export function botMayStillAct(game, bot) {
  if (!bot) return false;
  return liveTableObligation(game, bot) || isSeatedActor(game, bot);
}

function pendingSeatObligation(game, bot) {
  return isPendingFor(game, bot)
    || isSponsorshipActor(game, bot) || game.pendingPayment?.playerId === bot.id;
}

function liveTableObligation(game, bot) {
  return isVotingTurn(game) || pendingSeatObligation(game, bot);
}

function isSeatedActor(game, bot) {
  const current = game.getCurrentPlayer();
  return Boolean(current?.isBot && current.id === bot.id && !current.bankrupt && !current.disconnected);
}

export function isVotingTurn(game) {
  return game.globalEvent?.phase === 'voting';
}

export function isPendingFor(game, bot) {
  return game.pendingTrade?.toPlayerId === bot.id || contractResponderId(game.pendingPlayerContract) === bot.id;
}

// Ordered phase state machine - the array order IS the historical if/else
// priority, and each guard keeps its exact original condition.
const PHASES = [
  { id: 'vote', guard: (game, bot) => isVotingTurn(game) && !votingBlocked(game) && !game.globalEvent.votes?.[bot.id] },
  { id: 'trade', guard: (game, bot) => game.pendingTrade?.toPlayerId === bot.id },
  { id: 'contract', guard: (game, bot) => contractResponderId(game.pendingPlayerContract) === bot.id },
  { id: 'sponsorship', guard: (game, bot) => isSponsorshipActor(game, bot) },
  { id: 'payment', guard: (game, bot) => game.pendingPayment?.playerId === bot.id },
  { id: 'auction', guard: (game, bot) => Boolean(game.auction?.active)
    && (!Array.isArray(game.auction.participants) || !game.auction.participants.length
      || isAuctionBotParticipant(game.auction, bot)) },
  // Preserve the original end-turn priority for jail/other resolved flows;
  // the post-roll action guard below runs first only when finance actions are
  // actually available.
  { id: 'end-turn', guard: game => Boolean(game.awaitingEndTurn) && !game.hasRolled },
  { id: 'pre-roll', guard: game => !game.hasRolled },
  // A resolved landing still leaves the finance rail open. Give bots the
  // same post-roll action window as humans, but only when a legal action is
  // available; otherwise the normal end-turn gate wins.
  { id: 'post-roll', guard: (game, bot) => game.hasRolled && hasPostRollBotAction(game, bot) },
  { id: 'end-turn', guard: game => Boolean(game.awaitingEndTurn) },
  { id: 'post-roll', guard: () => true }
];

function advancesTheTurn(candidate) {
  if (candidate?.kind === 'end-turn') return false;
  if (candidate?.kind === 'roll') return false;
  return true;
}

function hasPostRollBotAction(game, bot) {
  if (typeof game?.getBotCandidates !== 'function') return false;
  const candidates = game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: true });
  return candidates.some(candidate => advancesTheTurn(candidate));
}

export function classifyBotTurnPhase(game, bot) {
  return (PHASES.find(phase => phase.guard(game, bot)) || PHASES[PHASES.length - 1]).id;
}

// Maps the advisor's chosen candidate to the concrete action it implies.
// The strategy layer chooses; this seam only maps legal action kinds.
const CANDIDATE_MAPPERS = [
  { kind: 'item-use', takes: () => true, type: 'item-use' },
  { kind: 'item-sell', takes: () => true, type: 'item-sell' },
  { kind: 'jail-fine', takes: () => true, type: 'jail-fine' },
  { kind: 'jail-free', takes: () => true, type: 'jail-free' },
  { kind: 'chat', takes: () => true, type: 'chat' },
  { kind: 'purchase', takes: () => true, type: 'purchase' },
  { kind: 'bankruptcy', takes: () => true, type: 'bankruptcy' },
  { kind: 'end-turn', takes: () => true, type: 'end-turn' },
  { kind: 'trade', takes: () => true, type: 'trade' },
  { kind: 'cancel-trade', takes: () => true, type: 'cancel-trade' },
  { kind: 'contract-propose', takes: () => true, type: 'contract-propose' },
  { kind: 'market', takes: () => true, type: 'market' },
  { kind: 'open-margin', takes: () => true, type: 'open-margin' },
  { kind: 'reduce-margin', takes: () => true, type: 'reduce-margin' },
  { kind: 'open-short', takes: () => true, type: 'open-short' },
  { kind: 'cover-short', takes: () => true, type: 'cover-short' },
  { kind: 'settle-short-default', takes: () => true, type: 'settle-short-default' },
  { kind: 'open-option', takes: () => true, type: 'open-option' },
  { kind: 'exercise-option', takes: () => true, type: 'exercise-option' },
  { kind: 'close-position', takes: () => true, type: 'close-position' },
  { kind: 'end-finance-window', takes: () => true, type: 'end-turn' },
  { kind: 'casino', takes: () => true, type: 'casino' },
  { kind: 'repay', takes: () => true, type: 'repay' },
  { kind: 'bank-repay', takes: () => true, type: 'bank-repay' },
  { kind: 'build', takes: () => true, type: 'build' },
  { kind: 'sell', takes: () => true, type: 'sell' },
  { kind: 'mortgage', takes: () => true, type: 'mortgage' },
  { kind: 'unmortgage', takes: () => true, type: 'unmortgage' },
  { kind: 'loan', takes: () => true, type: 'loan' }
];

export function candidateAction(candidate, bot) {
  const mapper = CANDIDATE_MAPPERS.find(entry => entry.kind === candidate?.kind && entry.takes(candidate, bot));
  return mapper ? { type: mapper.type, candidate } : { type: 'roll' };
}

export function auctionBidDecision(auction, bot, startingCash, game = null) {
  const minimum = Number(auction.highestBid || 0) + AUCTION_BID_INCREMENTS[0];
  void startingCash;
  // Cash above the liquidity reserve only: a bid never spends the bot's next rent.
  const cashCeiling = Math.max(0, Math.floor(Number(bot.cash || 0)) - auctionLiquidityReserve(game, bot));
  // A real auction always carries its deed; if the deed cannot be priced,
  // the strategy may use its cash ceiling but never a fabricated property value.
  const ceiling = auctionWillingness(auction, bot, game);
  const maximum = Math.min(cashCeiling, Number.isFinite(ceiling) ? Math.floor(ceiling) : cashCeiling);
  return { shouldBid: minimum <= maximum, minimum, maximum };
}

function auctionChoiceCandidates(baseline, bot, highestBid) {
  const candidates = [];
  if (baseline.shouldBid) candidates.push({
    id: 'auction:bid',
    kind: 'auction-bid',
    amount: defaultAuctionRaise(highestBid, baseline.maximum),
    amountOptions: auctionRaiseOptions(highestBid, baseline.maximum),
    minimumAmount: baseline.minimum,
    maximumAmount: baseline.maximum,
    parameterRanges: { amount: { type: 'integer', minimum: baseline.minimum, maximum: baseline.maximum } },
    risk: baseline.minimum / Math.max(1, bot.cash),
    score: 12
  });
  candidates.push({ id: 'auction:wait', kind: 'auction-wait', risk: 0, score: baseline.shouldBid ? 1 : 10 });
  return candidates;
}

export async function decideBotAuction({ auction, bot, startingCash, game = null, advisor, context = {} }) {
  const baseline = auctionBidDecision(auction, bot, startingCash, game);
  const highestBid = Number(auction.highestBid || 0);
  const candidates = auctionChoiceCandidates(baseline, bot, highestBid);
  const supportsAuctionChoice = advisorSupportsChoicePhase(advisor, 'auction');
  const decision = supportsAuctionChoice
    ? await advisor.chooseAction({ ...context, candidates })
    : null;
  const { botDecision: safeDecision, evaluationTrace } = splitEvaluationTrace(decision);
  const chosen = candidates.find(candidate => candidate.id === safeDecision?.actionId);
  const bidCandidate = candidates.find(candidate => candidate.id === 'auction:bid');
  const requestedAmount = Number(safeDecision?.parameters?.amount);
  const amount = bidCandidate && Number.isInteger(requestedAmount)
    && requestedAmount <= bidCandidate.maximumAmount && isAuctionRaise(highestBid, requestedAmount)
    ? requestedAmount
    : bidCandidate?.amount ?? baseline.minimum;
  return {
    candidates,
    minimum: baseline.minimum,
    maximum: baseline.maximum,
    amount,
    actionId: chosen?.id || (baseline.shouldBid ? 'auction:bid' : 'auction:wait'),
    decision: safeDecision,
    ...(evaluationTrace ? { evaluationTrace } : {})
  };
}

function legacyChoicePhasesSupported(advisor, phase) {
  return advisor?.supportsChoicePhases === true && ADVISOR_CHOICE_PHASES.has(phase);
}

function advisorSupportsChoicePhase(advisor, phase) {
  if (typeof advisor?.supportsChoicePhase === 'function') return advisor.supportsChoicePhase(phase) === true;
  return legacyChoicePhasesSupported(advisor, phase);
}

function auctionSeatActive(auction, player) {
  return auction.participants.includes(player.id) && auction.highestBidderId !== player.id;
}

export function isAuctionBotParticipant(auction, player) {
  if (!player.isBot) return false;
  if (!auctionSeatActive(auction, player)) return false;
  return !player.bankrupt && !player.disconnected;
}

// The deed that completes a colour set is worth more than its face price (the
// auction prices it that way), so it is exempt from the cash floor: the planner
// still weighs the thin cash it leaves. `game` is optional; without a board only
// the flat floor can be applied.
export function shouldBuyProperty(bot, tile, game = null) {
  if (!tile) return false;
  const floor = completesColourSet(game, bot, tile) ? 0 : PURCHASE_RESERVE_CASH;
  return bot.cash >= Number(tile.price || 0) + floor;
}

function activePurchaseOffer(game, bot) {
  const offer = game?.pendingPurchaseOffer;
  if (!offer) return null;
  if (offer.playerId !== bot.id) return null;
  return offer;
}

function purchaseShortfall(bot, tile) {
  const needed = Math.max(0, Number(tile.price || 0) - Number(bot.cash || 0));
  if (needed <= 0) return null;
  return needed;
}

function sponsorshipGap(game, bot, tile) {
  if (!activePurchaseOffer(game, bot)) return null;
  if (!tile) return null;
  if (shouldBuyProperty(bot, tile, game)) return null;
  return purchaseShortfall(bot, tile);
}

function shouldSeekSponsorship(game, bot, tile) {
  if (!playerFinanceEnabled(game)) return false;
  const needed = sponsorshipGap(game, bot, tile);
  return needed != null && availableSponsorCash(game, bot) >= needed;
}

// Only sponsors who could really give to this buyer count (F-033): a bot that
// is round-gated, gifted-out, or loan-backed would never contribute, and a
// request opened on its cash would park the table.
function availableSponsorCash(game, bot) {
  return game.players
    .filter(player => player.id !== bot.id && player.isBot && !player.bankrupt && !player.disconnected)
    .filter(player => sponsorCanFundBuyer(game, player, bot))
    .reduce((sum, player) => sum + Math.max(0, Number(player.cash || 0) - SPONSORSHIP_RESERVE_CASH), 0);
}

// The largest standard (unimproved) rent on the board: the minimum cash a bot
// keeps after an early purchase so one ordinary rent can still be paid.
function earlyLapRentCover(game) {
  const tiles = Array.isArray(game?.tiles) ? game.tiles : [];
  return tiles.reduce((largest, entry) => (entry?.type === 'property'
    ? Math.max(largest, Number(entry.rent) || 0)
    : largest), 0);
}

// Early laps: waive the cash reserve, deeds are leverage (aggressive
// doctrine). The waiver still leaves one standard rent covered.
function earlyLapCashBuy(game, bot, tile) {
  if (!tile) return false;
  const lap = game?.roundNumber || 99;
  if (lap > 3) return false;
  return bot.cash - Number(tile.price || 0) >= earlyLapRentCover(game);
}

function plannedPurchaseDecision(game, bot, tile) {
  const snapshot = buildBotStrategicContext(game, bot, 'purchase', game.botDecisionSequence || 0);
  const difficulty = game.settings?.botDifficulty || 'table';
  const seed = `${game.startedAt || 'pending'}:purchase`;
  const options = { difficulty, seed };
  const buy = evaluateCandidate(snapshot, { id: `buy:${tile.index}`, kind: 'buy', tileIndex: tile.index, price: tile.price, risk: 0, score: 0 }, options);
  // evaluateCandidate scores against standing still (the planner's own roll
  // baseline, always 0), so a deed is bought only when its marginal value is
  // not negative. A `pass` candidate has no planner applier and would score 0
  // by construction, which is why the baseline is the marginal zero itself.
  return buy.score >= 0;
}

// The price the bot would pay at auction right now covers the face price: declining
// on landing would only hand rivals the deed or let the bot win it back later at
// no better a price than the one on the card.
function auctionWouldPayFacePrice(game, bot, tile) {
  const opening = { propertyTile: tile, highestBid: 0 };
  return auctionBidDecision(opening, bot, 0, game).maximum >= Number(tile.price || 0);
}

export function shouldBuyWithPlan(game, bot, tile) {
  if (earlyLapCashBuy(game, bot, tile)) return true;
  if (!shouldBuyProperty(bot, tile, game)) return false;
  // Strategic decline: affordable but everyone is broke and the deed is not
  // my completer — let it go to auction and win it cheap.
  if (declineForCheapAuction(game, bot, tile)) return false;
  if (!Array.isArray(game.tiles)) return true;
  return plannedPurchaseDecision(game, bot, tile) || auctionWouldPayFacePrice(game, bot, tile);
}

function nearMissThresholdOk(give, ask, factor) {
  if (ask <= 0) return give > 0;
  return give * 100 >= Math.round(ask * factor * 60);
}

// Face-value ratio for rejected offers: >= 0.6 of the common acceptance bar is a
// near-miss worth a premium counter; below that, decline outright.
export function nearMissTrade(trade, getTile) {
  if (!trade) return false;
  const give = tradeLegValue({ cash: trade.giveCash, propertyIndexes: trade.givePropertyIndexes }, getTile);
  const ask = tradeLegValue({ cash: trade.requestCash, propertyIndexes: trade.requestPropertyIndexes }, getTile);
  return nearMissThresholdOk(give, ask, TRADE_ACCEPT_RATIO);
}

function ownPendingTrade(game, bot) {
  const trade = game?.pendingTrade;
  if (!trade) return null;
  if (trade.fromPlayerId !== bot?.id) return null;
  return trade;
}

function tradeCanSettle(game, trade) {
  const recipient = typeof game.getPlayerById === 'function' ? game.getPlayerById(trade.toPlayerId) : null;
  if (!recipient) return false;
  if (recipient.bankrupt || recipient.disconnected) return false;
  // Negotiation depth only forbids another counter: the engine still settles an
  // offer at depth two, so the offer stays until it is answered or expires.
  return true;
}

// Cancel my own pending trade when it can never settle: recipient gone or
// negotiation depth exhausted. Returns true when it acted.
export function pruneStaleOwnDeal(room, bot, game) {
  const trade = ownPendingTrade(game, bot);
  if (!trade) return false;
  if (tradeCanSettle(game, trade)) return false;
  const result = room.runBotAction(bot.id, actor => room.cancelTrade(actor, { tradeId: trade.id }));
  if (result?.success === true) bot.lastTradeProposal = null;
  return result?.success === true;
}

// Grudge weight for a declined offer: three is the threshold at which the trade
// and contract gates stop proposing to that partner, so one rejected offer
// cools the same offer off for a few rounds of ledger decay.
const DECLINED_OFFER_GRUDGE = 3;

// C25-11: a proposal the partner let lapse (declined, or replaced by a counter)
// used to leave no trace, so the identical offer was sent again every turn and
// the grudge gate read a ledger nothing wrote. Settled proposals (the completed
// count moved) and withdrawn ones (cleared by the bot's own cancel) are not
// rejections. Returns true when it recorded a declined offer.
export function recordDeclinedProposal(bot, game) {
  const proposal = bot?.lastTradeProposal;
  if (!proposal) return false;
  if (game?.pendingTrade?.id === proposal.id) return false;
  bot.lastTradeProposal = null;
  if ((Number(bot.tradesCompleted) || 0) > proposal.completedBefore) return false;
  addGrudge(bot, proposal.toPlayerId, DECLINED_OFFER_GRUDGE);
  // The grudge only blocks the partner for a turn; the identical offer (same
  // deeds, either price) also stays off the table for several rounds.
  if (proposal.pairKey) {
    coolOffTradePair(bot, proposal.pairKey, (Number(game?.roundNumber) || 0) + TRADE_DECLINE_COOLDOWN_ROUNDS);
  }
  return true;
}

function turnDecisionContext(parts) {
  const { room, bot, game, phase, decisionSequence } = parts;
  return {
    botId: bot.id,
    botBrain: game.settings?.botBrain || 'ai',
    botDifficulty: game.settings?.botDifficulty || 'table',
    gameId: `${room.roomCode}:${game.startedAt || 'pending'}`,
    decisionSequence,
    ruleVersion: BOT_RULE_VERSION,
    ...buildBotStrategicContext(game, bot, phase, decisionSequence)
  };
}

function beginBotTurn(room, bot, game) {
  // Per-tick relationship maintenance (decay) plus stale-offer pruning.
  tickLedger(bot, game?.roundNumber);
  // Remember an offer the partner let lapse before this turn can resend it.
  recordDeclinedProposal(bot, game);
  // Free a stale own offer first (dead recipient or exhausted depth) so the
  // table obligation never strands the bot's own turn. Classification below
  // re-reads the mutated game.
  pruneStaleOwnDeal(room, bot, game);
  const phase = classifyBotTurnPhase(game, bot);
  const decisionSequence = (game.botDecisionSequence || 0) + 1;
  game.botDecisionSequence = decisionSequence;
  const decisionContext = turnDecisionContext({ room, bot, game, phase, decisionSequence });
  return { phase, decisionContext };
}

function traceDefaults(phaseDecision) {
  return {
    provider: phaseDecision.provider || 'deterministic',
    fallback: phaseDecision.fallback !== false,
    fallbackReason: phaseDecision.fallbackReason || 'phase-resolution',
    candidateIds: phaseDecision.candidateIds || []
  };
}

function attachPhaseTrace(result, decisionContext, phase) {
  const phaseDecision = result?.botDecision || {};
  return { ...decisionContext, ...phaseDecision, phase, ...traceDefaults(phaseDecision) };
}

function deterministicPhaseDecision({ room, bot, game, phase, decisionContext }) {
  const result = PHASE_EXECUTORS[phase](room, bot, game);
  return attachBotDecision(result, attachPhaseTrace(result, decisionContext, phase));
}

// Executes the classified phase against the room (the room only enters this
// module as an injected collaborator, never as an import) and returns the
// action result. Purchase offers carry over to the caller's tail resolution
// for the second pass, matching the original inline double-check.
export async function runBotTurn(room, bot, advisor) {
  const game = room.game;
  const { phase, decisionContext } = beginBotTurn(room, bot, game);
  if (phase === 'pre-roll' || phase === 'post-roll') {
    const item = game.botItemCandidates?.(bot)?.[0];
    if (item) return attachBotDecision(CANDIDATE_RUNNERS['item-use'](room, bot, item), {
      ...decisionContext, phase, provider: 'deterministic', fallback: true,
      fallbackReason: 'mature-item', actionId: item.id, candidateIds: [item.id]
    });
  }
  if (phase === 'pre-roll' || phase === 'post-roll') {
    return runAdvisorTurn({ room, bot, advisor, decisionContext, phase });
  }
  if (advisorSupportsChoicePhase(advisor, phase)) {
    return runAdvisorChoicePhase({ room, bot, advisor, decisionContext, phase });
  }
  return deterministicPhaseDecision({ room, bot, game, phase, decisionContext });
}

// Candidate kind -> the room call it implies; the table order preserves the
// original if/else chain, including roll as the unmatched fallback.
export const CANDIDATE_RUNNERS = {
  'item-use': (room, bot, candidate) => room.runBotAction(bot.id, actor => room.useItem(actor, { itemId: candidate.itemId, requestId: `bot-use:${candidate.itemId}` })),
  'item-sell': (room, bot, candidate) => room.runBotAction(bot.id, actor => room.sellItem(actor, { itemId: candidate.itemId, requestId: `bot-sell:${candidate.itemId}` })),
  'jail-fine': (room, bot) => room.runBotAction(bot.id, actor => room.payJailFine(actor)),
  'jail-free': (room, bot) => room.runBotAction(bot.id, actor => room.useJailFree(actor)),
  chat: (room, bot, candidate) => {
    const botChat = String(candidate.text || '').slice(0, 180);
    // Table-talk is feedback, not a turn-consuming game action. Follow it
    // immediately with the phase's legal progress action so a bot cannot
    // repeatedly select chat while leaving the authoritative state unchanged.
    const actionResult = room.game?.hasRolled
      ? room.runBotAction(bot.id, actor => room.endTurn(actor))
      : room.runBotAction(bot.id, actor => room.rollDice(actor));
    return { ...(actionResult || { success: false, error: 'Bot could not advance after table-talk.' }), botChat };
  },
  purchase: (room, bot, candidate) => resolvePurchaseOffer(room, bot, {
    success: true,
    purchaseOffer: { playerId: bot.id, tileIndex: candidate.tileIndex }
  }),
  bankruptcy: (room, bot) => room.runBotAction(bot.id, actor => room.declareBankruptcy(actor)),
  'end-turn': (room, bot) => room.runBotAction(bot.id, actor => room.endTurn(actor)),
  'cancel-trade': (room, bot, candidate) => {
    const result = room.runBotAction(bot.id, actor => {
      if (room.game?.pendingTrade?.id !== candidate.tradeId) return { success: false, error: 'That trade offer is no longer current.' };
      return room.cancelTrade(actor, { tradeId: candidate.tradeId });
    });
    if (result?.success === true) bot.lastTradeProposal = null;
    return result;
  },
  trade: (room, bot, candidate) => {
    const proposal = room.runBotAction(bot.id, actor => room.proposeTrade(actor, candidate));
    if (!proposal?.success) return proposal;
    // Remember what was offered, so a partner's decline can be recorded later.
    bot.lastTradeProposal = {
      id: proposal.trade?.id,
      toPlayerId: proposal.trade?.toPlayerId,
      pairKey: tradePairKey(proposal.trade?.toPlayerId, candidate.givePropertyIndexes, candidate.requestPropertyIndexes),
      completedBefore: Number(bot.tradesCompleted) || 0
    };
    // Player-to-player trades may be proposed after movement. Only the
    // pre-roll path should immediately roll; rolling again would reject a
    // valid post-roll trade and strand the bot.
    if (room.game?.hasRolled) return proposal;
    const rolled = room.runBotAction(bot.id, actor => room.rollDice(actor));
    return rolled?.success ? rolled : proposal;
  },
  market: (room, bot, candidate) => room.runBotAction(bot.id, actor => room.tradeMarket(actor, candidate.instrumentId, candidate.side, candidate.quantity, 'bot-market-' + room.roomCode + '-' + room.game.roundNumber)),
  'open-margin': (room, bot, candidate) => room.runBotAction(bot.id, actor => room.openMargin(actor, candidate.instrumentId, candidate.quantity, 'bot-margin-' + room.roomCode + '-' + room.game.roundNumber)),
  'reduce-margin': (room, bot, candidate) => room.runBotAction(bot.id, actor => room.reduceMargin(actor, candidate.amount, 'bot-margin-reduce-' + room.roomCode + '-' + room.game.roundNumber)),
  'open-short': (room, bot, candidate) => room.runBotAction(bot.id, actor => room.openShort(actor, candidate.instrumentId, candidate.quantity, 'bot-short-' + room.roomCode + '-' + room.game.roundNumber)),
  'cover-short': (room, bot, candidate) => room.runBotAction(bot.id, actor => room.coverShort(actor, candidate.instrumentId, candidate.quantity, 'bot-cover-' + room.roomCode + '-' + room.game.roundNumber)),
  'settle-short-default': (room, bot, candidate) => room.runBotAction(bot.id, actor => room.settleShortDefault(actor, candidate.amount, 'bot-short-settle-' + room.roomCode + '-' + room.game.roundNumber + '-' + candidate.amount + '-' + (Number(bot.shortDefaultDebt) || 0))),
  'open-option': (room, bot, candidate) => room.runBotAction(bot.id, actor => room.openOption(actor, candidate)),
  'exercise-option': (room, bot, candidate) => room.runBotAction(bot.id, actor => room.exerciseOption(actor, candidate.optionId)),
  'close-position': (room, bot, candidate) => room.runBotAction(bot.id, actor => room.closePosition(actor, candidate.optionId)),
  casino: (room, bot, candidate) => room.runBotAction(bot.id, actor => room.placeCasinoBet(actor, candidate.color, candidate.stake, 'bot-casino-' + room.roomCode + '-' + room.game.roundNumber)),
  'contract-propose': (room, bot, candidate) => room.runBotAction(bot.id, actor => room.proposePlayerContract(actor, candidate.offer)),
  build: (room, bot, candidate) => room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: candidate.tileIndex, action: 'build-house' })),
  sell: (room, bot, candidate) => room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: candidate.tileIndex, action: 'sell-house' })),
  mortgage: (room, bot, candidate) => room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: candidate.tileIndex, action: 'mortgage' })),
  unmortgage: (room, bot, candidate) => room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: candidate.tileIndex, action: 'unmortgage' })),
  'bank-repay': (room, bot, candidate) => room.runBotAction(bot.id, actor => room.repayBankLoan(actor, { amount: candidate.amount, requestId: `bot-bank-repay-${room.roomCode}-${candidate.loanCount || candidate.issuedRound || 0}-${candidate.dueRound || 0}-${candidate.remaining || 0}` })),
  loan: (room, bot) => room.runBotAction(bot.id, actor => room.takeBankLoan(actor)),
  repay: (room, bot, candidate) => room.runBotAction(bot.id, actor => room.repayPlayerContract(actor, {
    contractId: candidate.contractId,
    amount: candidate.amount,
    requestId: `bot-repay-${room.roomCode}-${room.game.roundNumber}-${candidate.contractId}-${candidate.remaining || 0}`
  })),
  roll: (room, bot) => room.runBotAction(bot.id, actor => room.rollDice(actor))
};

function applyPurchasePlan(room, bot, tile, canBuy) {
  if (!canBuy && shouldSeekSponsorship(room.game, bot, tile)) {
    return room.runBotAction(bot.id, actor => room.game.requestPurchaseSponsorship(actor));
  }
  return room.runBotAction(bot.id, actor => canBuy
    ? room.purchaseProperty(actor, tile.index)
    : room.declineProperty(actor, tile.index));
}

// Applies one pending purchase offer for the bot, if the result carries it.
export function resolvePurchaseOffer(room, bot, result) {
  if (!result?.purchaseOffer) return result;
  const tile = room.game.getTile(result.purchaseOffer.tileIndex);
  const canBuy = shouldBuyWithPlan(room.game, bot, tile);
  return applyPurchasePlan(room, bot, tile, canBuy);
}
