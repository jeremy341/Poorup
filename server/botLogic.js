// Pure bot decision policy, extracted verbatim from the scheduleBotTurn/
// scheduleBotAuction timers in server.js. Every function here is deterministic
// and free of timers, sockets, and IO, so the whole policy is characterization-
// testable in isolation (server/botLogic.test.js pins the exact answers).
// The server keeps only scheduling and execution; it asks these helpers what
// a bot should do and runs the answer through room.runBotAction.
import { buildBotStrategicContext, BOT_RULE_VERSION } from './botStrategicContext.js';
import { evaluateCandidate } from './botFuturePlanner.js';
import { vetoTrade, deedValue, MONOPOLY_PREMIUM_NUM, MONOPOLY_PREMIUM_DEN } from './botTradeValuation.js';
import { tickLedger, addGratitude, coalitionAgainst } from './botTableMind.js';

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
export const SPONSORSHIP_RESERVE_CASH = 180;

function attachBotDecision(result, decision, evaluationTrace = null) {
  if (!result || typeof result !== 'object') return result;
  return {
    ...result,
    botDecision: { ...decision, success: result.success !== false },
    ...(evaluationTrace ? { evaluationTrace } : {})
  };
}

function splitEvaluationTrace(decision = {}) {
  const { shadowEvaluation, ...botDecision } = decision || {};
  return { botDecision, evaluationTrace: shadowEvaluation || null };
}

export function selectGlobalEventPolicy(globalEvent, personality) {
  const preferred = EVENT_POLICY_BY_PERSONALITY[personality] || DEFAULT_EVENT_POLICY;
  return globalEvent?.choices?.find(choice => choice.id === preferred) || globalEvent?.choices?.[0] || null;
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

export function shouldAcceptTrade(trade, getTile, personality, game = null) {
  // Monopoly veto first: never hand over a build-ready monopoly completer,
  // no matter how flattering the face value looks. Shapes without player
  // ids or grouped tiles (incl. legacy unit tests) skip the veto and keep
  // the pinned face-value behavior.
  if (game && trade?.toPlayerId) {
    const responderId = trade.toPlayerId;
    if (vetoTrade(game, trade, responderId).vetoed) return false;
  }
  let factor = TRADE_ACCEPT_FACTOR[personality] || DEFAULT_TRADE_ACCEPT_FACTOR;
  // Teaming premium: a proposer colluding with a third seat pays 1.5x.
  if (game && trade?.fromPlayerId && trade?.toPlayerId) {
    try {
      const table = coalitionAgainst(game, trade.toPlayerId);
      if (table.teaming && table.pair.includes(trade.fromPlayerId)) factor *= 1.5;
    } catch {
      // Thin stubs without player lists simply skip the premium.
    }
  }
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
function equityTermsAcceptable(game, offer, bot, personality) {
  if (personality === 'survivor' && Number(offer.amount) > bot.cash * EQUITY_SURVIVOR_RATIO) return false;
  const tile = typeof game.getTile === 'function' ? game.getTile(Number(offer.propertyIndex)) : null;
  if (!tile) return personality !== 'survivor';
  const share = Math.max(5, Math.min(100, Math.floor(Number(offer.equityShare) || 5)));
  const minPrice = Math.ceil(share / 100 * deedValue(game, tile) * MONOPOLY_PREMIUM_NUM / MONOPOLY_PREMIUM_DEN);
  return Number(offer.amount) >= minPrice;
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
  // The sender must wait for the human recipient after opening a deal. Without
  // this guard the post-roll finance pass would keep proposing the same offer
  // while the pending obligation correctly blocks ending the turn.
  const current = game.getCurrentPlayer?.();
  if (current?.isBot && game.pendingTrade?.fromPlayerId === current.id) return null;
  if (current?.isBot && game.pendingPlayerContract
    && contractLastProposerId(game.pendingPlayerContract) === current.id) return null;
  return game.getCurrentPlayer();
}

function findVotingBot(game) {
  if (game.globalEvent?.phase !== 'voting') return null;
  return game.players.find(player => player.isBot && !player.bankrupt && !player.disconnected && !game.globalEvent.votes?.[player.id]) || null;
}

function findPendingCounterpart(game) {
  if (game.pendingSponsoredPurchase) {
    const sponsorship = game.pendingSponsoredPurchase;
    const buyer = game.getPlayerById(sponsorship.buyerId);
    const tile = game.getTile(Number(sponsorship.tileIndex));
    const contributed = (sponsorship.contributions || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const needed = Math.max(0, Number(tile?.price || sponsorship.price || 0) - Number(buyer?.cash || 0) - contributed);
    // Let the buyer finish first once at least one sponsor has reserved cash.
    if (buyer?.isBot && sponsorship.contributions?.length && needed <= 0) return buyer;
    // A short buyer with nothing coming must kill its own dead request
    // instead of stranding the table (humans get a full round first).
    if (buyer?.isBot && sponsorshipBuyerShouldCancel(game, buyer, sponsorship, needed)) return buyer;
    const sponsor = game.players.find(player => player.isBot
      && player.id !== sponsorship.buyerId
      && !player.bankrupt
      && !player.disconnected
      && !(sponsorship.contributions || []).some(entry => entry.sponsorId === player.id)
      && sponsorshipContributionAmount(game, player) > 0);
    if (sponsor) return sponsor;
  }
  if (game.pendingTrade) return game.getPlayerById(game.pendingTrade.toPlayerId) || null;
  if (game.pendingPlayerContract) return game.getPlayerById(contractResponderId(game.pendingPlayerContract)) || null;
  if (game.pendingPayment?.playerId) return game.getPlayerById(game.pendingPayment.playerId) || null;
  return null;
}

function contractLastProposerId(contract) {
  const depth = Math.max(0, Math.floor(Number(contract?.counterDepth) || 0));
  return depth % 2 === 0 ? contract?.fromPlayerId : contract?.toPlayerId;
}

function contractResponderId(contract) {
  return contractLastProposerId(contract) === contract?.fromPlayerId ? contract?.toPlayerId : contract?.fromPlayerId;
}

export function botMayStillAct(game, bot) {
  if (!bot) return false;
  if (isVotingTurn(game) || isPendingFor(game, bot) || isSponsorshipActor(game, bot) || game.pendingPayment?.playerId === bot.id) return true;
  return isSeatedActor(game, bot);
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

function isSponsorshipActor(game, bot) {
  const sponsorship = game.pendingSponsoredPurchase;
  if (!sponsorship || !bot || bot.bankrupt || bot.disconnected) return false;
  if (sponsorship.buyerId === bot.id) {
    const tile = typeof game.getTile === 'function' ? game.getTile(Number(sponsorship.tileIndex)) : null;
    const contributed = (sponsorship.contributions || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const needed = Math.max(0, Number(tile?.price || sponsorship.price || 0) - Number(bot.cash || 0) - contributed);
    if (sponsorship.contributions?.length && needed <= 0) return true;
    return sponsorshipBuyerShouldCancel(game, bot, sponsorship, needed);
  }
  // Gated sponsors (round-capped, unreciprocated) must not claim the seat:
  // a zero-amount contributor would no-op forever without changing state.
  return !(sponsorship.contributions || []).some(entry => entry.sponsorId === bot.id)
    && sponsorshipContributionAmount(game, bot) > 0;
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

function hasPostRollBotAction(game, bot) {
  if (typeof game?.getBotCandidates !== 'function') return false;
  const candidates = game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: true });
  return candidates.some(candidate => candidate?.kind !== 'end-turn' && candidate?.kind !== 'roll');
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

export async function decideBotAuction({ auction, bot, startingCash, advisor, context = {} }) {
  const baseline = auctionBidDecision(auction, bot, startingCash);
  const candidates = [
    { id: 'auction:bid', kind: 'auction', amount: baseline.minimum, risk: baseline.minimum / Math.max(1, bot.cash), score: baseline.shouldBid ? 12 : 2 },
    { id: 'auction:pass', kind: 'auction', risk: 0, score: baseline.shouldBid ? 1 : 10 }
  ];
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

function advisorSupportsChoicePhase(advisor, phase) {
  if (typeof advisor?.supportsChoicePhase === 'function') return advisor.supportsChoicePhase(phase) === true;
  return advisor?.supportsChoicePhases === true && ADVISOR_CHOICE_PHASES.has(phase);
}

// Max the bot pays: sticker price, doubled when the deed completes its set
// (stretch $1 over), halved eagerness past face otherwise. Null without context.
function auctionWillingness(auction, bot, game) {
  const tile = auction?.propertyTile;
  if (!game || !tile?.group || !tile?.price) return null;
  const tiles = typeof game.getGroupTiles === 'function' ? game.getGroupTiles(tile.group) : [];
  if (!tiles?.length) return null;
  const owned = tiles.filter(entry => entry?.ownerId === bot?.id).length;
  const completes = owned + 1 >= tiles.length && owned < tiles.length;
  const sticker = Math.max(0, Math.floor(Number(tile.price)));
  return completes ? sticker * 2 : sticker;
}

function isComfortableBidder(policy, bot, startingCash) {
  return policy.always || bot.cash > startingCash * AUCTION_COMFORT_RATIO;
}

export function isAuctionBotParticipant(auction, player) {
  return Boolean(player.isBot
    && auction.participants.includes(player.id)
    && !auction.passedPlayerIds.includes(player.id)
    && auction.highestBidderId !== player.id
    && !player.bankrupt
    && !player.disconnected);
}

export function shouldBuyProperty(bot, tile) {
  return Boolean(tile) && bot.cash >= Number(tile.price || 0) + PURCHASE_RESERVE_CASH;
}

export function sponsorshipContributionAmount(game, bot) {
  const sponsorship = game?.pendingSponsoredPurchase;
  if (!sponsorship || !bot || bot.id === sponsorship.buyerId) return 0;
  if ((sponsorship.contributions || []).some(entry => entry.sponsorId === bot.id)) return 0;
  const tile = typeof game.getTile === 'function' ? game.getTile(Number(sponsorship.tileIndex)) : null;
  const buyer = typeof game.getPlayerById === 'function' ? game.getPlayerById(sponsorship.buyerId) : null;
  // Anti-farm gates (amount formula unchanged): one gift per round, and a
  // human buyer gets exactly one unreciprocated gift ever — after that only
  // reciprocated partners and fellow bots are funded.
  if (Number.isFinite(Number(game?.roundNumber)) && bot.lastSponsorRound === game.roundNumber) return 0;
  if (buyer && !buyer.isBot) {
    const giftedBefore = (bot.sponsorLedger || {})[buyer.id] > 0;
    const reciprocated = (bot.sponsoredBy || {})[buyer.id] > 0;
    if (giftedBefore && !reciprocated) return 0;
  }
  const buyerCash = buyer ? Number(buyer.cash || 0) : Number(sponsorship.buyerCash || 0);
  const contributed = (sponsorship.contributions || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const needed = Math.max(0, Number(tile?.price || sponsorship.price || 0) - buyerCash - contributed);
  const available = Math.max(0, Math.floor(Number(bot.cash || 0) - SPONSORSHIP_RESERVE_CASH));
  return Math.min(needed, available);
}

function shouldSeekSponsorship(game, bot, tile) {
  if (!game?.pendingPurchaseOffer || game.pendingPurchaseOffer.playerId !== bot.id || !tile) return false;
  if (shouldBuyProperty(bot, tile)) return false;
  const needed = Math.max(0, Number(tile.price || 0) - Number(bot.cash || 0));
  if (needed <= 0) return false;
  const potential = game.players
    .filter(player => player.id !== bot.id && player.isBot && !player.bankrupt && !player.disconnected)
    .reduce((sum, player) => sum + Math.max(0, Number(player.cash || 0) - SPONSORSHIP_RESERVE_CASH), 0);
  return potential >= needed;
}

export function shouldBuyWithPlan(game, bot, tile) {
  // Early laps: waive the cash reserve, deeds are leverage (aggressive
  // doctrine). A completer is always bought when affordable at any stage.
  if (tile && (game?.roundNumber || 99) <= 3 && bot.cash >= Number(tile.price || 0)) return true;
  if (!shouldBuyProperty(bot, tile)) return false;
  // Strategic decline: affordable but everyone is broke and the deed is not
  // my completer — let it go to auction and win it cheap.
  if (declineForCheapAuction(game, bot, tile)) return false;
  if (!Array.isArray(game.tiles)) return true;
  const snapshot = buildBotStrategicContext(game, bot, 'purchase', game.botDecisionSequence || 0);
  const difficulty = game.settings?.botDifficulty || 'table';
  const buy = evaluateCandidate(snapshot, { id: `buy:${tile.index}`, kind: 'buy', tileIndex: tile.index, price: tile.price, risk: 0, score: 0 }, { difficulty, seed: `${game.startedAt || 'pending'}:purchase` });
  const pass = evaluateCandidate(snapshot, { id: `pass:${tile.index}`, kind: 'pass', tileIndex: tile.index, risk: 0, score: 0 }, { difficulty, seed: `${game.startedAt || 'pending'}:purchase` });
  return buy.score >= pass.score;
}

// Mortgage ladder for debt: bare deeds at 10% interest before houses at
// 50% loss. Sorted by income preserved (lowest rent first), then proceeds.
// Exported for unit tests; pure besides the game rules lookups.
export function debtMortgageCandidates(game, bot) {
  if (typeof game?.getTile !== 'function' || typeof game?.canMortgageTile !== 'function') return [];
  const multiplier = Number(game.activeEventEffects?.().propertyValueMultiplier);
  const valueMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return (bot?.properties || [])
    .map(index => game.getTile(index))
    .filter(tile => tile && game.canMortgageTile(bot, tile))
    .map(tile => {
      const proceeds = Math.floor((Number(tile.price) || 0) / 2 * valueMultiplier);
      const rentLoss = typeof game.calculateRent === 'function'
        ? Math.max(0, Number(game.calculateRent(tile)) || 0)
        : Math.max(0, Number(tile.rent) || 0);
      return { tile, proceeds, rentLoss };
    })
    .sort((a, b) => a.rentLoss - b.rentLoss || b.proceeds - a.proceeds || a.tile.index - b.tile.index);
}

// Decline an affordable deed to force a cheap auction win: only when the
// deed is not my completer and every live opponent is too broke to contest.
function declineForCheapAuction(game, bot, tile) {
  if (!tile?.group || !Array.isArray(game?.players)) return false;
  const tiles = typeof game.getGroupTiles === 'function' ? game.getGroupTiles(tile.group) : [];
  if (!tiles?.length) return false;
  const owned = tiles.filter(entry => entry?.ownerId === bot?.id).length;
  if (owned + 1 >= tiles.length) return false;
  const rivals = game.players.filter(player => player.id !== bot?.id && !player.bankrupt && !player.disconnected);
  if (!rivals.length) return false;
  const price = Number(tile.price) || 0;
  return rivals.every(player => Number(player.cash || 0) < price);
}

function debtSellCandidates(game, bot) {
  if (typeof game.getTile !== 'function' || typeof game.canSellFromTile !== 'function') return [];
  return (bot.properties || [])
    .map(index => game.getTile(index))
    .filter(tile => tile && tile.houseCount > 0 && game.canSellFromTile(bot, tile))
    .map(tile => {
      const cost = typeof game.getPropertyHouseCost === 'function' ? game.getPropertyHouseCost(tile) : 0;
      const proceeds = Math.max(0, Math.floor(cost * (typeof game.buildingSaleMultiplier === 'function' ? game.buildingSaleMultiplier() : 0.5)));
      const rentLoss = Math.max(0, (typeof game.calculateRent === 'function' ? game.calculateRent(tile) : Number(tile.rent) || 0) - (Number(tile.rent) || 0));
      return { tile, proceeds, score: proceeds - rentLoss * 0.2 };
    })
    .sort((a, b) => b.score - a.score || b.proceeds - a.proceeds || a.tile.index - b.tile.index);
}

// Face-value ratio for rejected offers: >= 0.6 of the personality bar is a
// near-miss worth a premium counter; below that, decline outright.
export function nearMissTrade(trade, getTile, personality) {
  if (!trade) return false;
  const give = tradeLegValue({ cash: trade.giveCash, propertyIndexes: trade.givePropertyIndexes }, getTile);
  const ask = tradeLegValue({ cash: trade.requestCash, propertyIndexes: trade.requestPropertyIndexes }, getTile);
  const factor = TRADE_ACCEPT_FACTOR[personality] || DEFAULT_TRADE_ACCEPT_FACTOR;
  if (ask <= 0) return give > 0;
  return give * 100 >= Math.round(ask * factor * 60);
}

// Countering opens a replacement offer, which the table-obligation gate
// forbids while a payment, auction, purchase, sponsorship, or contract is
// pending. Countering into a blocked table restores the same offer.
function tradeCounterBlocked(game) {
  return Boolean(game?.pendingPayment || game?.auction || game?.pendingPurchaseOffer
    || game?.pendingSponsoredPurchase || game?.pendingPlayerContract);
}

function counterTradeOffer(game, bot) {
  const trade = game.pendingTrade;
  if (!trade || trade.toPlayerId !== bot.id) return null;
  if (Number(trade.counterDepth) >= 2) return null;
  const givePropertyIndexes = (trade.requestPropertyIndexes || [])
    .map(Number)
    .filter(index => (bot.properties || []).includes(index));
  const requestPropertyIndexes = (trade.givePropertyIndexes || []).map(Number);
  const requestedCash = Math.max(0, Math.floor(Number(trade.giveCash) || 0));
  const premium = Math.max(10, Math.ceil(requestedCash * 0.1));
  return {
    toPlayerId: trade.fromPlayerId,
    givePropertyIndexes,
    requestPropertyIndexes,
    giveCash: Math.max(0, Math.floor(Number(trade.requestCash) || 0)),
    requestCash: requestedCash + premium,
    counterDepth: Math.min(2, (trade.counterDepth || 0) + 1)
  };
}

function counterContractOffer(game, bot) {
  const contract = game.pendingPlayerContract;
  if (!contract || contractResponderId(contract) !== bot.id) return null;
  if (Number(contract.counterDepth) >= 2) return null;
  const lenderResponding = contract.fromPlayerId === bot.id;
  const counter = {
    contractId: contract.id,
    kind: contract.kind,
    amount: Math.max(1, Math.floor(Number(contract.amount) || 1)),
    premiumRate: Math.max(0, Math.min(100, Math.floor(Number(contract.premiumRate || 0) + (lenderResponding ? 10 : -10)))),
    durationRounds: lenderResponding
      ? Math.max(1, Math.floor(Number(contract.durationRounds) || 3) - 1)
      : Math.min(20, Math.max(1, Math.floor(Number(contract.durationRounds) || 3) + 1)),
    propertyIndex: contract.propertyIndex ?? null,
    collateralTileIndex: contract.collateralTileIndex ?? null,
    equityShare: contract.equityShare || 0,
    equityControl: contract.equityControl || 'passive',
    conversionShare: contract.conversionShare || 25,
    permanent: contract.expiresRound == null
  };
  return counter;
}

function paymentTrace(result, fallbackReason, actionId, candidateIds) {
  return attachBotDecision(result, { phase: 'payment', provider: 'deterministic', fallback: true, fallbackReason, actionId, candidateIds });
}

function tryDebtMortgage(room, bot, game) {
  const target = debtMortgageCandidates(game, bot)[0];
  if (!target) return null;
  const result = room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: target.tile.index, action: 'mortgage' }));
  if (result?.success === false) return null;
  if (typeof game.trySettlePendingPayment === 'function') game.trySettlePendingPayment();
  return paymentTrace(result, 'debt-mortgage', `mortgage:${target.tile.index}`, debtMortgageCandidates(game, bot).map(entry => `mortgage:${entry.tile.index}`).slice(0, 24));
}

function tryDebtSale(room, bot, game) {
  const sell = debtSellCandidates(game, bot)[0];
  if (!sell) return null;
  const result = room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: sell.tile.index, action: 'sell-house' }));
  if (result?.success === false) return null;
  return paymentTrace(result, 'debt-liquidation', `sell:${sell.tile.index}`, debtSellCandidates(game, bot).map(entry => `sell:${entry.tile.index}`).slice(0, 24));
}

function tryEmergencyLoan(room, bot, game) {
  const offer = typeof game.getBankLoanOffer === 'function' ? game.getBankLoanOffer(bot) : null;
  if (!offer?.available || bot.id !== game.currentPlayerId) return null;
  const result = room.runBotAction(bot.id, actor => room.takeBankLoan(actor));
  if (!result?.success) return null;
  if (typeof game.trySettlePendingPayment === 'function') game.trySettlePendingPayment();
  return paymentTrace(result, 'debt-loan-rescue', 'loan:emergency', ['loan:emergency', 'bankruptcy']);
}

function botPaymentAction(room, bot, game) {
  return tryDebtMortgage(room, bot, game)
    || tryDebtSale(room, bot, game)
    || tryEmergencyLoan(room, bot, game)
    || paymentTrace(room.runBotAction(bot.id, actor => room.declareBankruptcy(actor)), 'no-legal-rescue', 'bankruptcy', ['bankruptcy']);
}

function shouldAcceptContractResponse(game, bot, offer) {
  if (!offer) return false;
  if (offer.toPlayerId === bot.id) {
    const lender = game.getPlayerById(offer.fromPlayerId);
    return shouldAcceptPlayerContract(offer, bot, lender, bot.personality, game);
  }
  // A lender reviewing a counter keeps the same funding guard, and prefers
  // not to accept a zero-return or excessively long revision.
  if (offer.fromPlayerId === bot.id) {
    const premium = Number(offer.premiumRate) || 0;
    const duration = Number(offer.durationRounds) || 0;
    return premium >= 0 && duration >= 1 && duration <= 20 && bot.cash >= Number(offer.amount || 0);
  }
  return false;
}

function choiceCandidate(id, choiceId, score, label) {
  return { id, kind: 'choice', choiceId, score, risk: score > 0 ? 0.1 : 0.2, label };
}

function voteChoiceCandidates(game, bot) {
  const preferred = selectGlobalEventPolicy(game.globalEvent, bot.personality)?.id;
  return (game.globalEvent?.choices || []).map(choice => choiceCandidate(`vote:${choice.id}`, choice.id, choice.id === preferred ? 12 : 6, choice.label));
}

function tradeChoiceCandidates(game, bot) {
  if (!game.pendingTrade) return [];
  const accept = shouldAcceptTrade(game.pendingTrade, index => game.getTile(index), bot.personality, game);
  const candidates = [choiceCandidate('trade:accept', 'accept', accept ? 12 : 2, 'ACCEPT'), choiceCandidate('trade:decline', 'decline', accept ? 1 : 8, 'DECLINE')];
  const counter = counterTradeOffer(game, bot);
  if (counter) candidates.splice(1, 0, { ...choiceCandidate('trade:counter', 'counter', accept ? 2 : 7, 'COUNTER'), offer: counter });
  return candidates;
}

function contractChoiceCandidates(game, bot) {
  if (!game.pendingPlayerContract) return [];
  const offer = game.pendingPlayerContract;
  const accept = shouldAcceptContractResponse(game, bot, offer);
  const candidates = [choiceCandidate('contract:accept', 'accept', accept ? 12 : 2, 'ACCEPT'), choiceCandidate('contract:decline', 'decline', accept ? 1 : 8, 'DECLINE')];
  const counter = counterContractOffer(game, bot);
  if (counter) candidates.splice(1, 0, { ...choiceCandidate('contract:counter', 'counter', accept ? 2 : 7, 'COUNTER'), offer: counter });
  return candidates;
}

function sponsorshipChoiceCandidates(game, bot) {
  const sponsorship = game.pendingSponsoredPurchase;
  if (!sponsorship) return [];
  if (sponsorship.buyerId === bot.id) {
    const tile = game.getTile(Number(sponsorship.tileIndex));
    const contributed = (sponsorship.contributions || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const needed = Math.max(0, Number(tile?.price || sponsorship.price || 0) - Number(bot.cash || 0) - contributed);
    return sponsorship.contributions?.length && needed <= 0 ? [choiceCandidate('sponsorship:accept', 'accept', 18, 'ACCEPT SPONSORSHIP')] : [choiceCandidate('sponsorship:wait', 'wait', 1, 'WAIT FOR SPONSORS')];
  }
  const amount = sponsorshipContributionAmount(game, bot);
  return amount > 0 ? [choiceCandidate('sponsorship:contribute', 'contribute', 8, `RESERVE $${amount}`)] : [];
}

function paymentChoiceCandidates(game, bot) {
  if (game.pendingPayment?.playerId !== bot.id) return [];
  // Mortgage ladder first: 10% interest beats 50% house-sale loss, so
  // mortgages outscore sales and the loan/bankruptcy fallbacks.
  const mortgageCandidates = debtMortgageCandidates(game, bot).slice(0, 3).map(entry => choiceCandidate(`debt:mortgage:${entry.tile.index}`, `mortgage:${entry.tile.index}`, 26, `MORTGAGE ${entry.tile.name}`));
  const sellCandidates = debtSellCandidates(game, bot).slice(0, 12).map(entry => choiceCandidate(`debt:sell:${entry.tile.index}`, `sell:${entry.tile.index}`, Math.max(1, Math.min(24, entry.score / 10)), `SELL ${entry.tile.name}`));
  const offer = typeof game.getBankLoanOffer === 'function' ? game.getBankLoanOffer(bot) : null;
  const loanCandidate = offer?.available && bot.id === game.currentPlayerId ? choiceCandidate('debt:loan', 'loan', 10 - Math.min(8, Number(offer.totalDue || 0) / 100), 'TAKE BANK LOAN') : null;
  return [...mortgageCandidates, ...sellCandidates, ...(loanCandidate ? [loanCandidate] : []), choiceCandidate('debt:bankruptcy', 'bankruptcy', -20, 'DECLARE BANKRUPTCY')];
}

const PHASE_CANDIDATE_BUILDERS = { vote: voteChoiceCandidates, trade: tradeChoiceCandidates, contract: contractChoiceCandidates, sponsorship: sponsorshipChoiceCandidates, payment: paymentChoiceCandidates };

export function getBotChoiceCandidates(game, bot, phase) {
  return PHASE_CANDIDATE_BUILDERS[phase]?.(game, bot) || [];
}

function runTradeChoice(room, bot, game, candidate) {
  if (!game.pendingTrade) return { success: false, error: 'No matching trade offer was found.' };
  const tradeId = game.pendingTrade.id;
  if (candidate.tradeId && candidate.tradeId !== tradeId) return { success: false, error: 'The offer changed while the bot was thinking.' };
  if (candidate.choiceId === 'counter') {
    // A failed counter restores the identical offer: decline instead of
    // looping on it.
    const countered = room.runBotAction(bot.id, actor => room.counterTrade(actor, candidate.offer));
    if (countered?.success !== false) return countered;
  }
  return room.runBotAction(bot.id, actor => room.respondToTrade(actor, { tradeId, accept: candidate.choiceId === 'accept' }));
}

function runContractChoice(room, bot, game, candidate) {
  if (!game.pendingPlayerContract) return { success: false, error: 'No matching player contract was found.' };
  const contractId = game.pendingPlayerContract.id;
  if (candidate.contractId && candidate.contractId !== contractId) return { success: false, error: 'The contract changed while the bot was thinking.' };
  if (candidate.choiceId === 'counter') {
    // A failed counter leaves the identical offer pending: decline instead.
    const countered = room.runBotAction(bot.id, actor => room.counterPlayerContract(actor, candidate.offer));
    if (countered?.success !== false) return countered;
  }
  return room.runBotAction(bot.id, actor => room.respondPlayerContract(actor, candidate.choiceId === 'accept', null, contractId));
}

function runSponsorshipChoice(room, bot, game, candidate) {
  const sponsorship = game.pendingSponsoredPurchase;
  if (sponsorship?.buyerId === bot.id && sponsorshipBuyerShouldCancel(game, bot, sponsorship)) {
    return room.runBotAction(bot.id, actor => room.game.declineSponsoredPurchase(actor));
  }  if (candidate.choiceId === 'accept') {
    const incoming = (game.pendingSponsoredPurchase?.contributions || []).slice();
    const result = room.runBotAction(bot.id, actor => room.game.acceptSponsoredPurchase(actor));
    if (result?.success !== false) {
      bot.sponsoredBy = bot.sponsoredBy || {};
      for (const entry of incoming) {
        bot.sponsoredBy[entry.sponsorId] = (bot.sponsoredBy[entry.sponsorId] || 0) + Math.max(0, Number(entry.amount) || 0);
      }
    }
    return result;
  }
  if (candidate.choiceId === 'contribute') {
    const sponsorship = game.pendingSponsoredPurchase;
    const amount = sponsorshipContributionAmount(game, bot);
    const result = room.runBotAction(bot.id, actor => room.game.contributeToSponsoredPurchase(actor, { amount }));
    if (result?.success !== false && sponsorship) {
      bot.sponsorLedger = bot.sponsorLedger || {};
      bot.sponsorLedger[sponsorship.buyerId] = (bot.sponsorLedger[sponsorship.buyerId] || 0) + amount;
      if (Number.isFinite(Number(game?.roundNumber))) bot.lastSponsorRound = game.roundNumber;
    }
    return result;
  }
  return { success: true, noEmit: true, botDecision: { reasonCode: 'sponsorship-wait' } };
}

export function runPaymentChoice(room, bot, game, candidate) {
  if (candidate.id.startsWith('debt:mortgage:')) {
    const tileIndex = Number(candidate.id.slice('debt:mortgage:'.length));
    const result = room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex, action: 'mortgage' }));
    if (result?.success && typeof game.trySettlePendingPayment === 'function') game.trySettlePendingPayment();
    return result;
  }
  if (candidate.id.startsWith('debt:sell:')) {
    const tileIndex = Number(candidate.id.slice('debt:sell:'.length));
    return room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex, action: 'sell-house' }));
  }
  if (candidate.id === 'debt:loan') {
    const result = room.runBotAction(bot.id, actor => room.takeBankLoan(actor));
    if (result?.success && typeof game.trySettlePendingPayment === 'function') game.trySettlePendingPayment();
    return result;
  }
  return room.runBotAction(bot.id, actor => room.declareBankruptcy(actor));
}

const PHASE_CHOICE_RUNNERS = {
  vote: (room, bot, _game, candidate) => room.runBotAction(bot.id, actor => room.voteGlobalEvent(actor, candidate.choiceId)),
  trade: runTradeChoice,
  contract: runContractChoice,
  sponsorship: runSponsorshipChoice,
  payment: runPaymentChoice
};

function runPhaseChoice(room, bot, game, phase, candidate) {
  const runner = PHASE_CHOICE_RUNNERS[phase];
  return runner ? runner(room, bot, game, candidate) : { success: false, error: 'No bot choice is available.' };
}

function sameCandidateTerms(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

async function runAdvisorChoicePhase(room, bot, advisor, decisionContext, phase) {
  const game = room.game;
  const candidates = getBotChoiceCandidates(game, bot, phase);
  if (!candidates.length) return PHASE_EXECUTORS[phase](room, bot, game);
  // Capture the offer version before the asynchronous provider call. A human
  // may counter, cancel, or replace the deal while the AI is thinking; the
  // old choice must never be rebound to the newer offer after the await.
  const actingBotId = bot.id;
  const offerIdentity = choiceOfferIdentity(game, phase);
  const paymentIdentity = phase === 'payment' ? choicePaymentIdentity(game) : null;
  const voteEvent = phase === 'vote' ? game.globalEvent : null;
  const voteIdentity = phase === 'vote' ? voteEventIdentity(game) : null;
  const sponsorshipRequest = phase === 'sponsorship' ? game.pendingSponsoredPurchase : null;
  const sponsorshipIdentity = phase === 'sponsorship' ? sponsorshipChoiceIdentity(game, bot) : null;
  const decision = await advisor.chooseAction({
    ...decisionContext,
    candidates,
    personality: bot.personality,
    event: game.globalEvent
  });
  const { botDecision: safeDecision, evaluationTrace } = splitEvaluationTrace(decision);
  if (!botSeatStillLive(game, bot) || bot.id !== actingBotId) {
    return { noEmit: true, botDecision: { ...decisionContext, ...safeDecision, phase, reasonCode: 'seat-changed', actionId: null, candidateIds: candidates.map(candidate => candidate.id) }, ...(evaluationTrace ? { evaluationTrace } : {}) };
  }
  if (phase === 'vote'
    && (game.globalEvent !== voteEvent
      || voteEventIdentity(game) !== voteIdentity
      || game.globalEvent?.votes?.[actingBotId]
      || classifyBotTurnPhase(game, bot) !== phase)) {
    return { noEmit: true, botDecision: { ...decisionContext, ...safeDecision, phase, reasonCode: 'vote-event-changed', actionId: null, candidateIds: candidates.map(candidate => candidate.id) }, ...(evaluationTrace ? { evaluationTrace } : {}) };
  }
  if (['trade', 'contract'].includes(phase)
    && (choiceOfferIdentity(game, phase) !== offerIdentity
      || choiceResponderId(game, phase) !== actingBotId
      || classifyBotTurnPhase(game, bot) !== phase)) {
    return { noEmit: true, botDecision: { ...decisionContext, ...safeDecision, phase, reasonCode: 'offer-changed', actionId: null, candidateIds: candidates.map(candidate => candidate.id) }, ...(evaluationTrace ? { evaluationTrace } : {}) };
  }
  if (phase === 'payment'
    && (choicePaymentIdentity(game) !== paymentIdentity
      || game.pendingPayment?.playerId !== actingBotId
      || classifyBotTurnPhase(game, bot) !== phase)) {
    return { noEmit: true, botDecision: { ...decisionContext, ...safeDecision, phase, reasonCode: 'payment-changed', actionId: null, candidateIds: candidates.map(candidate => candidate.id) }, ...(evaluationTrace ? { evaluationTrace } : {}) };
  }
  if (phase === 'sponsorship'
    && (game.pendingSponsoredPurchase !== sponsorshipRequest
      || sponsorshipChoiceIdentity(game, bot) !== sponsorshipIdentity
      || classifyBotTurnPhase(game, bot) !== phase
      || !isSponsorshipActor(game, bot))) {
    return { noEmit: true, botDecision: { ...decisionContext, ...safeDecision, phase, reasonCode: 'sponsorship-changed', actionId: null, candidateIds: candidates.map(candidate => candidate.id) }, ...(evaluationTrace ? { evaluationTrace } : {}) };
  }
  const requested = candidates.find(candidate => candidate.id === decision?.actionId);
  const currentCandidates = getBotChoiceCandidates(game, bot, phase);
  const currentSelection = requested && currentCandidates.find(candidate => candidate.id === requested.id && sameCandidateTerms(candidate, requested));
  const usedFallback = !currentSelection;
  const selected = currentSelection || currentCandidates[0];
  if (!selected) return PHASE_EXECUTORS[phase](room, bot, game);
  if (phase === 'trade') selected.tradeId = game.pendingTrade.id;
  if (phase === 'contract') selected.contractId = game.pendingPlayerContract.id;
  const trace = {
    ...decisionContext,
    ...safeDecision,
    phase,
    provider: decision?.provider || 'deterministic',
    fallback: decision?.fallback !== false,
    fallbackReason: decision?.fallbackReason || 'choice-phase-fallback',
    actionId: selected.id,
    candidateIds: currentCandidates.map(candidate => candidate.id),
    ...(usedFallback ? { reasonCode: 'stale-candidate', fallbackReason: 'stale-candidate', fallback: true } : {})
  };
  const result = runPhaseChoice(room, bot, game, phase, selected);
  return attachBotDecision(result, trace, evaluationTrace);
}

function choiceResponderId(game, phase) {
  if (phase === 'trade') return game.pendingTrade?.toPlayerId || null;
  if (phase === 'contract') return contractResponderId(game.pendingPlayerContract);
  return null;
}

function choicePaymentIdentity(game) {
  const payment = game.pendingPayment;
  if (!payment) return null;
  return JSON.stringify({
    payment,
    requestId: game.pendingPaymentRequestId ?? payment.requestId ?? null,
    queueId: game.pendingPaymentQueueId ?? payment.queueId ?? null
  });
}

function voteEventIdentity(game) {
  const event = game?.globalEvent;
  return event ? JSON.stringify({ id: event.id ?? null, phase: event.phase ?? null, choices: event.choices || [] }) : null;
}

function sponsorshipChoiceIdentity(game, bot) {
  const request = game?.pendingSponsoredPurchase;
  if (!request) return null;
  const buyer = typeof game.getPlayerById === 'function' ? game.getPlayerById(request.buyerId) : null;
  const tile = typeof game.getTile === 'function' ? game.getTile(Number(request.tileIndex)) : null;
  const contributions = (request.contributions || []).map(entry => ({
    sponsorId: entry.sponsorId || null,
    amount: Math.max(0, Number(entry.amount) || 0)
  })).sort((left, right) => String(left.sponsorId).localeCompare(String(right.sponsorId)) || left.amount - right.amount);
  const purchaseOffer = game.pendingPurchaseOffer;
  return JSON.stringify({
    id: request.id ?? null,
    createdAt: request.createdAt ?? null,
    createdRound: request.createdRound ?? null,
    buyerId: request.buyerId,
    buyerCash: buyer ? Number(buyer.cash) || 0 : Number(request.buyerCash) || 0,
    buyerLive: buyer ? !buyer.bankrupt && !buyer.disconnected : false,
    tileIndex: request.tileIndex,
    price: Number(request.price) || 0,
    tilePrice: Number(tile?.price) || 0,
    contributions,
    roundNumber: Number(game.roundNumber) || 0,
    actorId: bot.id,
    actorCash: Number(bot.cash) || 0,
    actorLastSponsorRound: bot.lastSponsorRound ?? null,
    actorSponsorLedger: Number(bot.sponsorLedger?.[request.buyerId]) || 0,
    actorSponsoredBy: Number(bot.sponsoredBy?.[request.buyerId]) || 0,
    actorLive: !bot.bankrupt && !bot.disconnected,
    purchaseOffer: purchaseOffer ? {
      playerId: purchaseOffer.playerId ?? null,
      tileIndex: purchaseOffer.tileIndex ?? null,
      price: Number(purchaseOffer.price) || 0
    } : null
  });
}

function choiceOfferIdentity(game, phase) {
  if (phase === 'trade') {
    const offer = game.pendingTrade;
    return offer ? JSON.stringify({
      id: offer.id,
      fromPlayerId: offer.fromPlayerId,
      toPlayerId: offer.toPlayerId,
      giveCash: offer.giveCash,
      requestCash: offer.requestCash,
      givePropertyIndexes: offer.givePropertyIndexes || [],
      requestPropertyIndexes: offer.requestPropertyIndexes || [],
      counterDepth: offer.counterDepth
    }) : null;
  }
  if (phase === 'contract') {
    const offer = game.pendingPlayerContract;
    return offer ? JSON.stringify({
      id: offer.id,
      fromPlayerId: offer.fromPlayerId,
      toPlayerId: offer.toPlayerId,
      kind: offer.kind,
      amount: offer.amount,
      premiumRate: offer.premiumRate,
      durationRounds: offer.durationRounds,
      propertyIndex: offer.propertyIndex,
      collateralTileIndex: offer.collateralTileIndex,
      equityShare: offer.equityShare,
      equityControl: offer.equityControl,
      conversionShare: offer.conversionShare,
      counterDepth: offer.counterDepth
    }) : null;
  }
  return null;
}

// One small executor per phase, keyed by the state machine above. Each
// returns the room action result, exactly as the original branches did.
const PHASE_EXECUTORS = {
  vote: (room, bot, game) => {
    const policy = selectGlobalEventPolicy(game.globalEvent, bot.personality);
    return policy ? room.runBotAction(bot.id, actor => room.voteGlobalEvent(actor, policy.id)) : { success: false };
  },
  trade: (room, bot, game) => {
    const trade = game.pendingTrade;
    const accept = shouldAcceptTrade(trade, index => game.getTile(index), bot.personality, game);
    // Near-miss rejections become premium counters instead of flat
    // declines: hopeless offers still decline, vetoed ones never counter.
    // A failed counter (stale legs, new obligation) falls back to decline:
    // counterTrade restores the offer on failure, so returning the failure
    // would loop on an identical table forever.
    if (!accept && trade?.toPlayerId === bot.id && !vetoTrade(game, trade, bot.id).vetoed
      && !tradeCounterBlocked(game) && nearMissTrade(trade, index => game.getTile(index), bot.personality)) {
      const counter = counterTradeOffer(game, bot);
      if (counter) {
        const countered = room.runBotAction(bot.id, actor => room.counterTrade(actor, counter));
        if (countered?.success !== false) return countered;
      }
    }
    const result = room.runBotAction(bot.id, actor => room.respondToTrade(actor, { tradeId: trade.id, accept }));
    if (accept && result?.success !== false) addGratitude(bot, trade.fromPlayerId);
    return result;
  },
  contract: (room, bot, game) => {
    const offer = game.pendingPlayerContract;
    const acceptable = shouldAcceptContractResponse(game, bot, offer);
    return room.runBotAction(bot.id, actor => room.respondPlayerContract(actor, acceptable));
  },
  sponsorship: (room, bot, game) => {
    const sponsorship = game.pendingSponsoredPurchase;
    if (sponsorship?.buyerId === bot.id) {
      if (sponsorshipBuyerShouldCancel(game, bot, sponsorship)) {
        return room.runBotAction(bot.id, actor => room.game.declineSponsoredPurchase(actor));
      }
      const tile = typeof game.getTile === 'function' ? game.getTile(Number(sponsorship.tileIndex)) : null;
      const contributed = (sponsorship.contributions || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const needed = Math.max(0, Number(tile?.price || sponsorship.price || 0) - Number(bot.cash || 0) - contributed);
      if (sponsorship.contributions?.length && needed <= 0) {
        // Record who funded me before the accept clears the request: future
        // gifts to them are reciprocated, not farmed.
        const incoming = (sponsorship.contributions || []).slice();
        const result = room.runBotAction(bot.id, actor => room.game.acceptSponsoredPurchase(actor));
        if (result?.success !== false) {
          bot.sponsoredBy = bot.sponsoredBy || {};
          for (const entry of incoming) {
            bot.sponsoredBy[entry.sponsorId] = (bot.sponsoredBy[entry.sponsorId] || 0) + Math.max(0, Number(entry.amount) || 0);
          }
        }
        return result;
      }
      return { success: true, noEmit: true };
    }
    const amount = sponsorshipContributionAmount(game, bot);
    if (!(amount > 0)) return { success: true, noEmit: true };
    const result = room.runBotAction(bot.id, actor => room.game.contributeToSponsoredPurchase(actor, { amount }));
    if (result?.success !== false && sponsorship) {
      bot.sponsorLedger = bot.sponsorLedger || {};
      bot.sponsorLedger[sponsorship.buyerId] = (bot.sponsorLedger[sponsorship.buyerId] || 0) + amount;
      if (Number.isFinite(Number(game?.roundNumber))) bot.lastSponsorRound = game.roundNumber;
    }
    return result;
  },
  payment: botPaymentAction,
  auction: (room, bot) => room.runBotAction(bot.id, actor => room.passAuction(actor)),
  'end-turn': (room, bot) => room.runBotAction(bot.id, actor => room.endTurn(actor)),
  'post-roll': (room, bot, game) => {
    if (game.pendingPurchaseOffer?.playerId === bot.id) {
      return resolvePurchaseOffer(room, bot, { success: true, purchaseOffer: game.pendingPurchaseOffer });
    }
    if (!(Number(bot.cash) > 0) && !bot.bankrupt) return room.runBotAction(bot.id, actor => room.declareBankruptcy(actor));
    if (game.awaitingEndTurn) return room.runBotAction(bot.id, actor => room.endTurn(actor));
    return { success: true, noEmit: true, botDecision: { reasonCode: 'post-roll-no-op' } };
  }
};

// Executes the classified phase against the room (the room only enters this
// module as an injected collaborator, never as an import) and returns the
// action result. Purchase offers carry over to the caller's tail resolution
// for the second pass, matching the original inline double-check.
export async function runBotTurn(room, bot, advisor) {
  const game = room.game;
  // Per-tick relationship maintenance (decay) plus stale-offer pruning.
  tickLedger(bot, game?.roundNumber);
  // Free a stale own offer first (dead recipient or exhausted depth) so the
  // table obligation never strands the bot's own turn. Classification below
  // re-reads the mutated game.
  pruneStaleOwnDeal(room, bot, game);
  const phase = classifyBotTurnPhase(game, bot);
  const decisionSequence = (game.botDecisionSequence || 0) + 1;
  game.botDecisionSequence = decisionSequence;
  const decisionContext = {
    botId: bot.id,
    botBrain: game.settings?.botBrain || 'ai',
    botDifficulty: game.settings?.botDifficulty || 'table',
    gameId: `${room.roomCode}:${game.startedAt || 'pending'}`,
    decisionSequence,
    ruleVersion: BOT_RULE_VERSION,
    ...buildBotStrategicContext(game, bot, phase, decisionSequence)
  };
  if (phase === 'pre-roll' || phase === 'post-roll') return runAdvisorTurn(room, bot, advisor, decisionContext, phase);
  if (advisorSupportsChoicePhase(advisor, phase)) {
    return runAdvisorChoicePhase(room, bot, advisor, decisionContext, phase);
  }
  const result = PHASE_EXECUTORS[phase](room, bot, game);
  return attachBotDecision(result, {
    ...decisionContext,
    ...(result?.botDecision || {}),
    phase,
    provider: result?.botDecision?.provider || 'deterministic',
    fallback: result?.botDecision?.fallback !== false,
    fallbackReason: result?.botDecision?.fallbackReason || 'phase-resolution',
    candidateIds: result?.botDecision?.candidateIds || []
  });
}

// Cancel my own pending trade when it can never settle: recipient gone or
// negotiation depth exhausted. Returns true when it acted.
export function pruneStaleOwnDeal(room, bot, game) {
  const trade = game?.pendingTrade;
  if (!trade || trade.fromPlayerId !== bot?.id) return false;
  const recipient = typeof game.getPlayerById === 'function' ? game.getPlayerById(trade.toPlayerId) : null;
  if (recipient && !recipient.bankrupt && !recipient.disconnected && Number(trade.counterDepth) < 2) return false;
  const result = room.runBotAction(bot.id, actor => room.cancelTrade(actor, { tradeId: trade.id }));
  return result?.success === true;
}

// A sponsorship request is dead when the shortfall persists, a full round
// has passed (humans had their chance), and no live bot can fund it.
// Canceling refunds contributors and unblocks the purchase resolution.
export function sponsorshipDead(game, bot, sponsorship) {
  if (!sponsorship || sponsorship.buyerId !== bot?.id) return false;
  const tile = typeof game?.getTile === 'function' ? game.getTile(Number(sponsorship.tileIndex)) : null;
  const contributed = (sponsorship.contributions || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const needed = Math.max(0, Number(tile?.price || sponsorship.price || 0) - Number(bot.cash || 0) - contributed);
  if (needed <= 0) return false;
  const createdRound = Number(sponsorship.createdRound);
  if (!Number.isFinite(createdRound) || Number(game?.roundNumber) <= createdRound + 1) return false;
  const funders = (game.players || []).filter(player => player?.isBot && !player.bankrupt && !player.disconnected
    && !(sponsorship.contributions || []).some(entry => entry.sponsorId === player.id)
    && sponsorshipContributionAmount(game, player) > 0);
  return funders.length === 0;
}

// Buyer-side cancel policy shared by dispatch, actor gating, and both
// executors: covered requests accept; dead or funderless ones are declined
// so the purchase resolves. Humans always get a full round to fund first;
// bots-only tables cancel immediately since waiting is pointless.
export function sponsorshipBuyerShouldCancel(game, bot, sponsorship, needed = null) {
  if (!sponsorship || sponsorship.buyerId !== bot?.id) return false;
  const tile = typeof game?.getTile === 'function' ? game.getTile(Number(sponsorship.tileIndex)) : null;
  const contributed = (sponsorship.contributions || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const shortfall = needed ?? Math.max(0, Number(tile?.price || sponsorship.price || 0) - Number(bot.cash || 0) - contributed);
  if (shortfall <= 0) return false;
  if (sponsorshipDead(game, bot, sponsorship)) return true;
  const live = Array.isArray(game?.players) ? game.players.filter(player => player && !player.bankrupt && !player.disconnected) : [];
  const humansWaiting = live.some(player => !player.isBot);
  if (humansWaiting) return false;
  return !live.some(player => player?.isBot && player.id !== bot.id
    && !(sponsorship.contributions || []).some(entry => entry.sponsorId === player.id)
    && sponsorshipContributionAmount(game, player) > 0);
}

function botSeatStillLive(game, bot) {
  if (!bot || bot.bankrupt || bot.disconnected) return false;
  if (!Array.isArray(game?.players)) return true;
  return game.players.some(player => player?.id === bot.id && player === bot);
}

// Candidate kind -> the room call it implies; the table order preserves the
// original if/else chain, including roll as the unmatched fallback.
const CANDIDATE_RUNNERS = {
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

async function runAdvisorTurn(room, bot, advisor, decisionContext = {}, phase = 'pre-roll') {
  const game = room.game;
  const candidates = game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: phase === 'post-roll' });
  // Snapshot table obligations before the async advisor call: a trade,
  // contract, payment, or auction arriving mid-thought must not be acted
  // on with a stale pre-roll candidate list (mirrors the choice phases).
  const pendingTradeId = game.pendingTrade?.id || null;
  const pendingContractId = game.pendingPlayerContract?.id || null;
  const pendingPaymentId = game.pendingPayment ? `${game.pendingPayment.playerId}:${game.pendingPayment.amountRemaining}` : null;
  const auctionActive = Boolean(game.auction?.active);
  const decision = await advisor.chooseAction({
    ...decisionContext,
    candidates,
    personality: bot.personality,
    event: game.globalEvent
  });
  const { botDecision: safeDecision, evaluationTrace } = splitEvaluationTrace(decision);
  const trace = {
    ...decisionContext,
    ...safeDecision,
    phase,
    provider: decision?.provider || 'deterministic',
    fallback: decision?.fallback !== false,
    fallbackReason: decision?.fallbackReason || 'deterministic-advisor',
    candidateIds: candidates.map(candidate => candidate.id).filter(Boolean).slice(0, 24)
  };
  // The advisor call is async; if the seat moved on while it thought, the
  // original code aborted the tick without emitting.
  if (game.getCurrentPlayer()?.id !== bot.id || !botSeatStillLive(game, bot)) return { noEmit: true, botDecision: { ...trace, reasonCode: 'seat-changed' }, ...(evaluationTrace ? { evaluationTrace } : {}) };
  const tableChanged = (game.pendingTrade?.id || null) !== pendingTradeId
    || (game.pendingPlayerContract?.id || null) !== pendingContractId
    || (game.pendingPayment ? `${game.pendingPayment.playerId}:${game.pendingPayment.amountRemaining}` : null) !== pendingPaymentId
    || Boolean(game.auction?.active) !== auctionActive;
  if (tableChanged) return { noEmit: true, botDecision: { ...trace, reasonCode: 'table-changed', actionId: null }, ...(evaluationTrace ? { evaluationTrace } : {}) };
  const requested = candidates.find(entry => entry.id === decision?.actionId);
  const currentCandidates = game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: phase === 'post-roll' });
  const currentSelection = requested && currentCandidates.find(entry => entry.id === requested.id && sameCandidateTerms(entry, requested));
  const staleCandidate = !currentSelection;
  const candidate = currentSelection || currentCandidates[0];
  if (!candidate) {
    return attachBotDecision({ success: true, noEmit: true }, { ...trace, reasonCode: 'no-legal-action' }, evaluationTrace);
  }
  if (staleCandidate) {
    trace.reasonCode = 'stale-candidate';
    trace.fallbackReason = 'stale-candidate';
    trace.fallback = true;
  }
  const action = candidateAction(candidate, bot);
  const result = CANDIDATE_RUNNERS[action.type](room, bot, action.candidate);
  if (result?.success === false && action.type !== 'roll') {
    const fallbackCandidate = phase === 'post-roll'
      ? (Number(bot.cash) > 0 || bot.bankrupt
        ? { id: 'end-turn', kind: 'end-turn' }
        : { id: 'bankruptcy:zero-cash', kind: 'bankruptcy' })
      : { id: 'roll', kind: 'roll' };
    const fallback = CANDIDATE_RUNNERS[fallbackCandidate.kind](room, bot, fallbackCandidate);
    return attachBotDecision(fallback, { ...trace, actionId: fallbackCandidate.id, fallbackReason: 'candidate-rejected' }, evaluationTrace);
  }
  return attachBotDecision(result, trace, evaluationTrace);
}

// Applies one pending purchase offer for the bot, if the result carries it.
export function resolvePurchaseOffer(room, bot, result) {
  if (!result?.purchaseOffer) return result;
  const tile = room.game.getTile(result.purchaseOffer.tileIndex);
  const canBuy = shouldBuyWithPlan(room.game, bot, tile);
  if (!canBuy && shouldSeekSponsorship(room.game, bot, tile)) {
    return room.runBotAction(bot.id, actor => room.game.requestPurchaseSponsorship(actor));
  }
  return room.runBotAction(bot.id, actor => canBuy
    ? room.purchaseProperty(actor, tile.index)
    : room.declineProperty(actor, tile.index));
}
