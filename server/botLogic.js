// Pure bot decision policy, extracted verbatim from the scheduleBotTurn/
// scheduleBotAuction timers in server.js. Every function here is deterministic
// and free of timers, sockets, and IO, so the whole policy is characterization-
// testable in isolation (server/botLogic.test.js pins the exact answers).
// The server keeps only scheduling and execution; it asks these helpers what
// a bot should do and runs the answer through room.runBotAction.
import { buildBotStrategicContext, BOT_RULE_VERSION } from './botStrategicContext.js';
import { evaluateCandidate } from './botFuturePlanner.js';
import { vetoTrade, deedValue, MONOPOLY_PREMIUM_NUM, MONOPOLY_PREMIUM_DEN } from './botTradeValuation.js';
import { tickLedger, coalitionAgainst } from './botTableMind.js';
import {
  SPONSORSHIP_RESERVE_CASH,
  sponsorshipContributionAmount,
  isSponsorshipActor
} from './sponsorshipLogic.js';
import {
  findPendingCounterpart,
  contractResponderId,
  declineForCheapAuction,
  auctionWillingness
} from './botCandidates.js';
import { runAdvisorChoicePhase, runAdvisorTurn, PHASE_EXECUTORS } from './advisorLogic.js';

export { sponsorshipContributionAmount };
export { debtMortgageCandidates } from './botCandidates.js';
export { getBotChoiceCandidates, runPaymentChoice } from './advisorLogic.js';

// Global-event voting: personality -> preferred policy id.
export const EVENT_POLICY_BY_PERSONALITY = {
  builder: 'public-works',
  speculator: 'bank-first'
};
export const DEFAULT_EVENT_POLICY = 'low-tax';

// Trade acceptance: the bot accepts when the value it receives clears its
// demand scaled by a personality risk factor.
export const TRADE_ACCEPT_FACTOR = { shark: 1.1 };
export const DEFAULT_TRADE_ACCEPT_FACTOR = 0.8;

// Player-contract acceptance: repayment offers are compared against cash
// times a personality willingness factor.
export const CONTRACT_REPAY_FACTOR = { speculator: 1.25 };
export const DEFAULT_CONTRACT_REPAY_FACTOR = 0.8;

// Auction bidding step and cash reserve per personality.
export const AUCTION_BID_POLICY = {
  shark: { step: 20, reserve: 60, always: true },
  builder: { step: 10, reserve: 120, always: true }
};
export const DEFAULT_AUCTION_BID_POLICY = { step: 10, reserve: 120, always: false };
const ADVISOR_CHOICE_PHASES = new Set(['vote', 'trade', 'contract', 'sponsorship', 'payment', 'auction']);
// A non-always personality only bids while comfortably above starting cash.
export const AUCTION_COMFORT_RATIO = 0.7;

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

function eventChoiceByIdOrFirst(globalEvent, preferred) {
  return globalEvent?.choices?.find(choice => choice.id === preferred) || globalEvent?.choices?.[0] || null;
}

export function selectGlobalEventPolicy(globalEvent, personality) {
  const preferred = EVENT_POLICY_BY_PERSONALITY[personality] || DEFAULT_EVENT_POLICY;
  return eventChoiceByIdOrFirst(globalEvent, preferred);
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

export function shouldAcceptTrade(trade, getTile, personality, game = null) {
  if (tradeVetoed(game, trade)) return false;
  const factor = teamingAcceptFactor(game, trade, TRADE_ACCEPT_FACTOR[personality] || DEFAULT_TRADE_ACCEPT_FACTOR);
  const giveValue = tradeLegValue({ cash: trade.giveCash, propertyIndexes: trade.givePropertyIndexes }, getTile);
  const askValue = tradeLegValue({ cash: trade.requestCash, propertyIndexes: trade.requestPropertyIndexes }, getTile);
  return clearsTradeBar(giveValue, askValue, factor);
}

export function shouldAcceptPlayerContract(offer, bot, lender, personality, game = null) {
  if (offer?.kind === 'equity' && game) {
    return equityTermsAcceptable(game, offer, bot, personality);
  }
  const check = CONTRACT_ACCEPTANCE[offer.kind] || CONTRACT_ACCEPTANCE.fallback;
  return check(offer, bot, { lender, personality });
}

// Equity value gate: never pledge rent equity below 2x traffic-adjusted
// deed value, pro-rated by share. Without game context (legacy unit tests)
// the pinned personality behavior is preserved.
function equityMinimumPrice(game, offer, tile) {
  const share = Math.max(5, Math.min(100, Math.floor(Number(offer.equityShare) || 5)));
  return Math.ceil(share / 100 * deedValue(game, tile) * MONOPOLY_PREMIUM_NUM / MONOPOLY_PREMIUM_DEN);
}

function equityTermsAcceptable(game, offer, bot, personality) {
  if (personality === 'survivor' && Number(offer.amount) > bot.cash * EQUITY_SURVIVOR_RATIO) return false;
  const tile = typeof game.getTile === 'function' ? game.getTile(Number(offer.propertyIndex)) : null;
  if (!tile) return personality !== 'survivor';
  return Number(offer.amount) >= equityMinimumPrice(game, offer, tile);
}

const EQUITY_SURVIVOR_RATIO = 0.35;
const CONTRACT_ACCEPTANCE = {
  equity: (offer, bot, ctx) => ctx.personality !== 'survivor'
    || Number(offer.amount) <= bot.cash * EQUITY_SURVIVOR_RATIO,
  fallback: (offer, bot, ctx) => Number(offer.totalDue || offer.amount) <= bot.cash
    * (CONTRACT_REPAY_FACTOR[ctx.personality] || DEFAULT_CONTRACT_REPAY_FACTOR)
    && Boolean(ctx.lender && !ctx.lender.bankrupt)
};

// Who should the bot timer serve right now: an unvoted bot in a vote beats
// the counterparty of a pending offer, which beats the current player.
export function selectBotTurnTarget(game) {
  const voting = findVotingBot(game);
  if (voting) return voting;
  const pending = findPendingCounterpart(game);
  if (pending?.isBot) return pending;
  // A sponsorship can remain open for human contributors. Do not repeatedly
  // wake the buyer's turn while it is waiting for the table.
  if (game.pendingSponsoredPurchase) return null;
  return game.getCurrentPlayer();
}

function eligibleUnvotedBot(game, player) {
  if (!player.isBot) return false;
  if (player.bankrupt || player.disconnected) return false;
  return !game.globalEvent.votes?.[player.id];
}

function findVotingBot(game) {
  if (game.globalEvent?.phase !== 'voting') return null;
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
  { id: 'vote', guard: (game, bot) => isVotingTurn(game) && !game.globalEvent.votes?.[bot.id] },
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
// Each mapper answers "does this personality take this candidate?"; the
// first true wins, and anything unmatched (or no candidate) is plain roll.
const CANDIDATE_MAPPERS = [
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
  { kind: 'open-option', takes: () => true, type: 'open-option' },
  { kind: 'exercise-option', takes: () => true, type: 'exercise-option' },
  { kind: 'close-position', takes: () => true, type: 'close-position' },
  { kind: 'end-finance-window', takes: () => true, type: 'end-turn' },
  { kind: 'casino', takes: () => true, type: 'casino' },
  { kind: 'repay', takes: () => true, type: 'repay' },
  { kind: 'bank-repay', takes: () => true, type: 'bank-repay' },
  { kind: 'build', takes: (candidate, bot) => bot.cash >= candidate.cost + 200, type: 'build' },
  { kind: 'sell', takes: () => true, type: 'sell' },
  { kind: 'mortgage', takes: () => true, type: 'mortgage' },
  { kind: 'unmortgage', takes: () => true, type: 'unmortgage' },
  { kind: 'loan', takes: (candidate, bot) => bot.personality === 'speculator' || Number(candidate.totalDue) <= Number(bot.cash) * 1.5, type: 'loan' }
];

export function candidateAction(candidate, bot) {
  const mapper = CANDIDATE_MAPPERS.find(entry => entry.kind === candidate?.kind && entry.takes(candidate, bot));
  return mapper ? { type: mapper.type, candidate } : { type: 'roll' };
}

export function auctionBidDecision(auction, bot, startingCash, game = null) {
  const policy = AUCTION_BID_POLICY[bot.personality] || DEFAULT_AUCTION_BID_POLICY;
  const minimum = Math.max(auction.highestBid + 1, auction.highestBid + policy.step);
  const affordably = bot.cash >= minimum + policy.reserve && isComfortableBidder(policy, bot, startingCash);
  if (!affordably) return { shouldBid: false, minimum };
  // Valuation cap with game context: sticker + completion bonus, shill-stop
  // past willingness. Legacy shapes without game keep pinned behavior.
  const ceiling = auctionWillingness(auction, bot, game);
  if (ceiling != null && minimum > ceiling) return { shouldBid: false, minimum };
  return { shouldBid: true, minimum };
}

function auctionChoiceCandidates(baseline, bot) {
  return [
    { id: 'auction:bid', kind: 'auction', amount: baseline.minimum, risk: baseline.minimum / Math.max(1, bot.cash), score: baseline.shouldBid ? 12 : 2 },
    { id: 'auction:pass', kind: 'auction', risk: 0, score: baseline.shouldBid ? 1 : 10 }
  ];
}

export async function decideBotAuction({ auction, bot, startingCash, advisor, context = {} }) {
  const baseline = auctionBidDecision(auction, bot, startingCash);
  const candidates = auctionChoiceCandidates(baseline, bot);
  const supportsAuctionChoice = advisorSupportsChoicePhase(advisor, 'auction');
  const decision = supportsAuctionChoice
    ? await advisor.chooseAction({ ...context, candidates, personality: bot.personality })
    : null;
  const { botDecision: safeDecision, evaluationTrace } = splitEvaluationTrace(decision);
  const chosen = candidates.find(candidate => candidate.id === safeDecision?.actionId);
  return {
    candidates,
    minimum: baseline.minimum,
    actionId: chosen?.id || (baseline.shouldBid ? 'auction:bid' : 'auction:pass'),
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

function isComfortableBidder(policy, bot, startingCash) {
  return policy.always || bot.cash > startingCash * AUCTION_COMFORT_RATIO;
}

function auctionSeatActive(auction, player) {
  return auction.participants.includes(player.id)
    && !auction.passedPlayerIds.includes(player.id)
    && auction.highestBidderId !== player.id;
}

export function isAuctionBotParticipant(auction, player) {
  if (!player.isBot) return false;
  if (!auctionSeatActive(auction, player)) return false;
  return !player.bankrupt && !player.disconnected;
}

export function shouldBuyProperty(bot, tile) {
  return Boolean(tile) && bot.cash >= Number(tile.price || 0) + PURCHASE_RESERVE_CASH;
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
  if (shouldBuyProperty(bot, tile)) return null;
  return purchaseShortfall(bot, tile);
}

function shouldSeekSponsorship(game, bot, tile) {
  const needed = sponsorshipGap(game, bot, tile);
  return needed != null && availableSponsorCash(game, bot) >= needed;
}

function availableSponsorCash(game, bot) {
  return game.players
    .filter(player => player.id !== bot.id && player.isBot && !player.bankrupt && !player.disconnected)
    .reduce((sum, player) => sum + Math.max(0, Number(player.cash || 0) - SPONSORSHIP_RESERVE_CASH), 0);
}

// Early laps: waive the cash reserve, deeds are leverage (aggressive
// doctrine).
function earlyLapCashBuy(game, bot, tile) {
  if (!tile) return false;
  const lap = game?.roundNumber || 99;
  if (lap > 3) return false;
  return bot.cash >= Number(tile.price || 0);
}

function plannedPurchaseDecision(game, bot, tile) {
  const snapshot = buildBotStrategicContext(game, bot, 'purchase', game.botDecisionSequence || 0);
  const difficulty = game.settings?.botDifficulty || 'table';
  const seed = `${game.startedAt || 'pending'}:purchase`;
  const options = { difficulty, seed };
  const buy = evaluateCandidate(snapshot, { id: `buy:${tile.index}`, kind: 'buy', tileIndex: tile.index, price: tile.price, risk: 0, score: 0 }, options);
  // The alternative to buying is doing nothing, so the baseline has to be a
  // real projection. A `pass` candidate has no applier in the planner, so it
  // came back 'unsupported' and scored 0 by construction, which reduced the
  // whole policy to "is buy.score >= 0" — every affordable deed was a buy no
  // matter how negative the planner's own margin was. `roll` is the planner's
  // no-op probe (its applier projects without touching the state), so it
  // returns the honest stand-still score to beat, under the same difficulty
  // and seed as the buy projection.
  const standStill = evaluateCandidate(snapshot, { id: `pass:${tile.index}`, kind: 'roll', risk: 0, score: 0 }, options);
  return buy.score >= standStill.score;
}

export function shouldBuyWithPlan(game, bot, tile) {
  if (earlyLapCashBuy(game, bot, tile)) return true;
  if (!shouldBuyProperty(bot, tile)) return false;
  // Strategic decline: affordable but everyone is broke and the deed is not
  // my completer — let it go to auction and win it cheap.
  if (declineForCheapAuction(game, bot, tile)) return false;
  if (!Array.isArray(game.tiles)) return true;
  return plannedPurchaseDecision(game, bot, tile);
}

function nearMissThresholdOk(give, ask, factor) {
  if (ask <= 0) return give > 0;
  return give * 100 >= Math.round(ask * factor * 60);
}

// Face-value ratio for rejected offers: >= 0.6 of the personality bar is a
// near-miss worth a premium counter; below that, decline outright.
export function nearMissTrade(trade, getTile, personality) {
  if (!trade) return false;
  const give = tradeLegValue({ cash: trade.giveCash, propertyIndexes: trade.givePropertyIndexes }, getTile);
  const ask = tradeLegValue({ cash: trade.requestCash, propertyIndexes: trade.requestPropertyIndexes }, getTile);
  const factor = TRADE_ACCEPT_FACTOR[personality] || DEFAULT_TRADE_ACCEPT_FACTOR;
  return nearMissThresholdOk(give, ask, factor);
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
  return Number(trade.counterDepth) < 2;
}

// Cancel my own pending trade when it can never settle: recipient gone or
// negotiation depth exhausted. Returns true when it acted.
export function pruneStaleOwnDeal(room, bot, game) {
  const trade = ownPendingTrade(game, bot);
  if (!trade) return false;
  if (tradeCanSettle(game, trade)) return false;
  const result = room.runBotAction(bot.id, actor => room.cancelTrade(actor, { tradeId: trade.id }));
  return result?.success === true;
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
  'cancel-trade': (room, bot, candidate) => room.runBotAction(bot.id, actor => {
    if (room.game?.pendingTrade?.id !== candidate.tradeId) return { success: false, error: 'That trade offer is no longer current.' };
    return room.cancelTrade(actor, { tradeId: candidate.tradeId });
  }),
  trade: (room, bot, candidate) => {
    const proposal = room.runBotAction(bot.id, actor => room.proposeTrade(actor, candidate));
    if (!proposal?.success) return proposal;
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
