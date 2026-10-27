// Advisor-driven decision phases: per-phase choice candidates, the identity
// snapshots that reject stale AI answers after the async provider call, the
// room executors for each classified phase, and the candidate runner table
// pass-through. The room only enters this module as an injected collaborator,
// never as an import. Every gate is a verbatim move of the original
// scheduleBotTurn inline chain, so bot balance is unchanged.
import { vetoTrade } from './botTradeValuation.js';
import { lenderAcceptsCounter } from './botContractPolicy.js';
import { addGratitude } from './botTableMind.js';
import {
  sponsorshipShortfall,
  sponsorshipContributionAmount,
  sponsorshipChoiceIdentity,
  isSponsorshipActor,
  runSponsorshipChoice,
  runSponsorshipPhase
} from './sponsorshipLogic.js';
import {
  contractResponderId,
  counterContractOffer,
  counterTradeOfferOutcome,
  tradeCounterBlocked,
  debtMortgageCandidates,
  debtSellCandidates
} from './botCandidates.js';
import {
  attachBotDecision,
  splitEvaluationTrace,
  selectGlobalEventPolicy,
  globalEventPolicyUtility,
  shouldAcceptTrade,
  shouldAcceptPlayerContract,
  nearMissTrade,
  candidateAction,
  classifyBotTurnPhase,
  resolvePurchaseOffer,
  CANDIDATE_RUNNERS
} from './botLogic.js';

const OFFER_CHOICE_PHASES = new Set(['trade', 'contract']);

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

function choiceCandidate(id, choiceId, score, label) {
  return { id, kind: 'choice', choiceId, score, risk: score > 0 ? 0.1 : 0.2, label };
}

function voteChoiceCandidates(game, bot) {
  return (game.globalEvent?.choices || []).map(choice => choiceCandidate(
    `vote:${choice.id}`,
    choice.id,
    globalEventPolicyUtility(game.globalEvent, choice, game, bot),
    choice.label
  ));
}

// A rejected offer that nearly clears the bar is worth a premium counter, so
// it outranks a flat decline. Hopeless or vetoed offers still decline, and a
// table with another pending obligation cannot take a replacement offer.
function counterScore(game, bot, trade, accept) {
  if (accept) return 2;
  const getTile = index => game.getTile(index);
  const nearMiss = !vetoTrade(game, trade, bot.id).vetoed && nearMissTrade(trade, getTile);
  return nearMiss ? 9 : 7;
}

// Cash added on top of the original ask, smallest first. A counter is a proposal,
// so it must clear the same bar the bot applies to an offer made to it; a flat
// +10% on a set-completing deed used to give a counter the bot itself would refuse.
const COUNTER_EXTRA_CASH = [10, 20, 40, 80, 160, 320, 640];

function counterClearsOwnBar(game, bot, counter) {
  const mirrored = {
    id: 'counter-check',
    fromPlayerId: counter.toPlayerId,
    toPlayerId: bot.id,
    givePropertyIndexes: counter.requestPropertyIndexes,
    giveCash: counter.requestCash,
    requestPropertyIndexes: counter.givePropertyIndexes,
    requestCash: counter.giveCash,
    counterDepth: counter.counterDepth
  };
  return shouldAcceptTrade(mirrored, index => game.getTile(index), game);
}

export function clearingTradeCounter(game, bot) {
  for (const extraCash of COUNTER_EXTRA_CASH) {
    const outcome = counterTradeOfferOutcome(game, bot, extraCash);
    if (!outcome.offer) {
      // Nothing to counter: stop. Otherwise keep walking the premium ladder:
      // a set-premium refusal at +10 is cleared by the +20 or +40 counter, and
      // an unaffordable counter stays unaffordable.
      if (outcome.reason === 'no-trade') return null;
      continue;
    }
    if (counterClearsOwnBar(game, bot, outcome.offer)) return outcome.offer;
  }
  return null;
}

function tradeChoiceCandidates(game, bot) {
  if (!game.pendingTrade) return [];
  const trade = game.pendingTrade;
  // A vetoed trade would finish an opponent's buildable set. That is a safety rule,
  // not a preference, so the advisor is never offered 'accept' (or a counter) for it.
  const vetoed = vetoTrade(game, trade, bot.id).vetoed;
  const accept = !vetoed && shouldAcceptTrade(trade, index => game.getTile(index), game);
  const candidates = vetoed
    ? [choiceCandidate('trade:decline', 'decline', 8, 'DECLINE')]
    : [choiceCandidate('trade:accept', 'accept', accept ? 12 : 2, 'ACCEPT'), choiceCandidate('trade:decline', 'decline', accept ? 1 : 8, 'DECLINE')];
  const counter = vetoed || tradeCounterBlocked(game) ? null : clearingTradeCounter(game, bot);
  if (counter) candidates.splice(1, 0, { ...choiceCandidate('trade:counter', 'counter', counterScore(game, bot, trade, accept), 'COUNTER'), offer: counter });
  return candidates;
}

function contractChoiceCandidates(game, bot) {
  if (!game.pendingPlayerContract) return [];
  const offer = game.pendingPlayerContract;
  // The terms gate (botContractPolicy.js) is a safety rule: terms it refuses are
  // not offered to the advisor as an option, so a model cannot sign them.
  const accept = shouldAcceptContractResponse(game, bot, offer);
  const candidates = accept
    ? [choiceCandidate('contract:accept', 'accept', 12, 'ACCEPT'), choiceCandidate('contract:decline', 'decline', 1, 'DECLINE')]
    : [choiceCandidate('contract:decline', 'decline', 8, 'DECLINE')];
  const counter = counterContractOffer(game, bot);
  if (counter) candidates.splice(accept ? 1 : 0, 0, { ...choiceCandidate('contract:counter', 'counter', accept ? 2 : 7, 'COUNTER'), offer: counter });
  return candidates;
}

function sponsorshipChoiceCandidates(game, bot) {
  const sponsorship = game.pendingSponsoredPurchase;
  if (!sponsorship) return [];
  if (sponsorship.buyerId === bot.id) {
    const funded = sponsorship.contributions?.length && sponsorshipShortfall(game, sponsorship, bot.cash) <= 0;
    return funded ? [choiceCandidate('sponsorship:accept', 'accept', 18, 'ACCEPT SPONSORSHIP')] : [choiceCandidate('sponsorship:wait', 'wait', 1, 'WAIT FOR SPONSORS')];
  }
  const amount = sponsorshipContributionAmount(game, bot);
  return amount > 0 ? [choiceCandidate('sponsorship:contribute', 'contribute', 8, `RESERVE $${amount}`)] : [];
}

// Below the lowest sale score (1): a loan dearer than selling a house gives away is
// the last rescue before bankruptcy, whatever its size.
const LAST_RESORT_LOAN_SCORE = 0.5;

// Selling a built house returns only buildingSaleMultiplier of its cost, so a sale
// costs (1 - multiplier) per dollar raised. A loan whose premium rate reaches that
// is no cheaper than the sale it would postpone, and it adds a repayment deadline.
function loanDearerThanSale(game, offer) {
  const multiplier = typeof game.buildingSaleMultiplier === 'function' ? Number(game.buildingSaleMultiplier()) : 0.5;
  const principal = Number(offer.principal) || 0;
  const premiumRate = principal > 0 ? Number(offer.premium || 0) / principal : 0;
  return premiumRate >= 1 - (Number.isFinite(multiplier) ? multiplier : 0.5);
}

function bankLoanChoice(game, bot) {
  const offer = typeof game.getBankLoanOffer === 'function' ? game.getBankLoanOffer(bot) : null;
  if (!offer?.available) return null;
  if (bot.id !== game.currentPlayerId) return null;
  const score = 10 - Math.min(8, Number(offer.totalDue || 0) / 100);
  return choiceCandidate('debt:loan', 'loan', loanDearerThanSale(game, offer) ? Math.min(score, LAST_RESORT_LOAN_SCORE) : score, 'TAKE BANK LOAN');
}

function paymentChoiceCandidates(game, bot) {
  if (game.pendingPayment?.playerId !== bot.id) return [];
  // Mortgage ladder first: 10% interest beats 50% house-sale loss, so
  // mortgages outscore sales and the loan/bankruptcy fallbacks.
  const mortgageCandidates = debtMortgageCandidates(game, bot).slice(0, 3).map(entry => choiceCandidate(`debt:mortgage:${entry.tile.index}`, `mortgage:${entry.tile.index}`, 26, `MORTGAGE ${entry.tile.name}`));
  const sellCandidates = debtSellCandidates(game, bot).slice(0, 12).map(entry => choiceCandidate(`debt:sell:${entry.tile.index}`, `sell:${entry.tile.index}`, Math.max(1, Math.min(24, entry.score / 10)), `SELL ${entry.tile.name}`));
  const loanCandidate = bankLoanChoice(game, bot);
  return [...itemPaymentCandidates(game, bot), ...mortgageCandidates, ...sellCandidates, ...(loanCandidate ? [loanCandidate] : []), choiceCandidate('debt:bankruptcy', 'bankruptcy', -20, 'DECLARE BANKRUPTCY')];
}

function itemPaymentCandidates(game, bot) {
  return (game.summaryItems?.(bot, bot.id) || []).flatMap(item => {
    const redeem = item.catalogId === 'parlor-bond' && item.canUse;
    if (!redeem && !item.canSell) return [];
    const action = redeem ? 'use' : 'sell';
    return [{ ...choiceCandidate(`debt:item:${action}:${item.itemId}`, `item:${action}:${item.itemId}`, 40, `${redeem ? 'REDEEM' : 'SELL'} ${item.name}`), itemId: item.itemId, itemAction: action }];
  });
}

function runItemPaymentChoice(room, bot, candidate) {
  const method = candidate.itemAction === 'use' ? 'useItem' : 'sellItem';
  return room.runBotAction(bot.id, actor => room[method](actor, { itemId: candidate.itemId, requestId: `bot-${candidate.itemAction}:${candidate.itemId}` }));
}

const PHASE_CANDIDATE_BUILDERS = { vote: voteChoiceCandidates, trade: tradeChoiceCandidates, contract: contractChoiceCandidates, sponsorship: sponsorshipChoiceCandidates, payment: paymentChoiceCandidates };

export function getBotChoiceCandidates(game, bot, phase) {
  return PHASE_CANDIDATE_BUILDERS[phase]?.(game, bot) || [];
}

function shouldAcceptContractResponse(game, bot, offer) {
  if (!offer) return false;
  if (offer.toPlayerId === bot.id) {
    const lender = game.getPlayerById(offer.fromPlayerId);
    return shouldAcceptPlayerContract(offer, bot, lender, game);
  }
  // A lender reviewing a counter takes it only while it is still a loan the bot
  // would have offered (priced, short, bounded, lending reserve kept).
  if (offer.fromPlayerId === bot.id) return lenderAcceptsCounter(game, bot, offer);
  return false;
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

function runMortgageChoice(room, bot, game, candidate) {
  const tileIndex = Number(candidate.id.slice('debt:mortgage:'.length));
  const result = room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex, action: 'mortgage' }));
  if (result?.success && typeof game.trySettlePendingPayment === 'function') game.trySettlePendingPayment();
  return result;
}

function runSellChoice(room, bot, candidate) {
  const tileIndex = Number(candidate.id.slice('debt:sell:'.length));
  return room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex, action: 'sell-house' }));
}

function runLoanChoice(room, bot, game) {
  const result = room.runBotAction(bot.id, actor => room.takeBankLoan(actor));
  if (result?.success && typeof game.trySettlePendingPayment === 'function') game.trySettlePendingPayment();
  return result;
}

export function runPaymentChoice(room, bot, game, candidate) {
  if (candidate.id.startsWith('debt:item:')) return runItemPaymentChoice(room, bot, candidate);
  if (candidate.id.startsWith('debt:mortgage:')) return runMortgageChoice(room, bot, game, candidate);
  if (candidate.id.startsWith('debt:sell:')) return runSellChoice(room, bot, candidate);
  if (candidate.id === 'debt:loan') return runLoanChoice(room, bot, game);
  return room.runBotAction(bot.id, actor => room.declareBankruptcy(actor));
}

const PHASE_CHOICE_RUNNERS = {
  vote: (room, bot, _game, candidate) => room.runBotAction(bot.id, actor => room.voteGlobalEvent(actor, candidate.choiceId)),
  trade: runTradeChoice,
  contract: runContractChoice,
  sponsorship: runSponsorshipChoice,
  payment: runPaymentChoice
};

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
  const item = itemPaymentCandidates(game, bot)[0];
  if (item) return paymentTrace(runItemPaymentChoice(room, bot, item), 'item-rescue', item.id, [item.id]);
  return tryDebtMortgage(room, bot, game)
    || tryDebtSale(room, bot, game)
    || tryEmergencyLoan(room, bot, game)
    || paymentTrace(room.runBotAction(bot.id, actor => room.declareBankruptcy(actor)), 'no-legal-rescue', 'bankruptcy', ['bankruptcy']);
}

function tryNearMissCounter(room, bot, game, trade) {
  if (trade?.toPlayerId !== bot.id) return null;
  if (vetoTrade(game, trade, bot.id).vetoed) return null;
  if (tradeCounterBlocked(game)) return null;
  if (!nearMissTrade(trade, index => game.getTile(index))) return null;
  const counter = clearingTradeCounter(game, bot);
  if (!counter) return null;
  const countered = room.runBotAction(bot.id, actor => room.counterTrade(actor, counter));
  if (countered?.success === false) return null;
  return countered;
}

function executeTradePhase(room, bot, game) {
  const trade = game.pendingTrade;
  const accept = shouldAcceptTrade(trade, index => game.getTile(index), game);
  // Near-miss rejections become premium counters instead of flat
  // declines: hopeless offers still decline, vetoed ones never counter.
  // A failed counter (stale legs, new obligation) falls back to decline:
  // counterTrade restores the offer on failure, so returning the failure
  // would loop on an identical table forever.
  if (!accept) {
    const countered = tryNearMissCounter(room, bot, game, trade);
    if (countered) return countered;
  }
  const result = room.runBotAction(bot.id, actor => room.respondToTrade(actor, { tradeId: trade.id, accept }));
  if (accept && result?.success !== false) addGratitude(bot, trade.fromPlayerId);
  return result;
}

function runPostRollPhase(room, bot, game) {
  if (game.pendingPurchaseOffer?.playerId === bot.id) {
    return resolvePurchaseOffer(room, bot, { success: true, purchaseOffer: game.pendingPurchaseOffer });
  }
  if (!(Number(bot.cash) > 0) && !bot.bankrupt) return room.runBotAction(bot.id, actor => room.declareBankruptcy(actor));
  if (game.awaitingEndTurn) return room.runBotAction(bot.id, actor => room.endTurn(actor));
  return { success: true, noEmit: true, botDecision: { reasonCode: 'post-roll-no-op' } };
}

// One small executor per phase, keyed by the state machine in botLogic. Each
// returns the room action result, exactly as the original branches did.
export const PHASE_EXECUTORS = {
  vote: (room, bot, game) => {
    const policy = selectGlobalEventPolicy(game.globalEvent, game, bot);
    return policy ? room.runBotAction(bot.id, actor => room.voteGlobalEvent(actor, policy.id)) : { success: false };
  },
  trade: executeTradePhase,
  contract: (room, bot, game) => {
    const offer = game.pendingPlayerContract;
    const acceptable = shouldAcceptContractResponse(game, bot, offer);
    return room.runBotAction(bot.id, actor => room.respondPlayerContract(actor, acceptable));
  },
  sponsorship: runSponsorshipPhase,
  payment: botPaymentAction,
  auction: (room, bot) => ({ success: true, noEmit: true, botDecision: { actionId: 'auction:wait', reasonCode: 'awaiting-bids' } }),
  'end-turn': (room, bot) => room.runBotAction(bot.id, actor => room.endTurn(actor)),
  'post-roll': runPostRollPhase
};

function choiceSnapshot(game, bot, phase) {
  return {
    actingBotId: bot.id,
    // The game generation: a rematch (a new game in the same room) restarts
    // the table with the same seats, so an answer produced for the previous
    // game must never be applied to the new one.
    gameStartedAt: game.startedAt ?? null,
    offerIdentity: choiceOfferIdentity(game, phase),
    paymentIdentity: phase === 'payment' ? choicePaymentIdentity(game) : null,
    voteEvent: phase === 'vote' ? game.globalEvent : null,
    voteIdentity: phase === 'vote' ? voteEventIdentity(game) : null,
    sponsorshipRequest: phase === 'sponsorship' ? game.pendingSponsoredPurchase : null,
    sponsorshipIdentity: phase === 'sponsorship' ? sponsorshipChoiceIdentity(game, bot) : null
  };
}

function voteChoiceStale(game, bot, snapshot) {
  return game.globalEvent !== snapshot.voteEvent
    || voteEventIdentity(game) !== snapshot.voteIdentity
    || Boolean(game.globalEvent?.votes?.[snapshot.actingBotId])
    || classifyBotTurnPhase(game, bot) !== 'vote';
}

function offerChoiceStale(game, bot, phase, snapshot) {
  return choiceOfferIdentity(game, phase) !== snapshot.offerIdentity
    || choiceResponderId(game, phase) !== snapshot.actingBotId
    || classifyBotTurnPhase(game, bot) !== phase;
}

function paymentChoiceStale(game, bot, snapshot) {
  return choicePaymentIdentity(game) !== snapshot.paymentIdentity
    || game.pendingPayment?.playerId !== snapshot.actingBotId
    || classifyBotTurnPhase(game, bot) !== 'payment';
}

function sponsorshipChoiceStale(game, bot, snapshot) {
  return game.pendingSponsoredPurchase !== snapshot.sponsorshipRequest
    || sponsorshipChoiceIdentity(game, bot) !== snapshot.sponsorshipIdentity
    || classifyBotTurnPhase(game, bot) !== 'sponsorship'
    || !isSponsorshipActor(game, bot);
}

function postOfferChoiceStaleness(game, bot, phase, snapshot) {
  if (phase === 'payment' && paymentChoiceStale(game, bot, snapshot)) return 'payment-changed';
  if (phase === 'sponsorship' && sponsorshipChoiceStale(game, bot, snapshot)) return 'sponsorship-changed';
  return null;
}

// The seat change, the vote, and the offer identities are re-read after the
// async provider call; a stale answer must never be bound to newer state.
function choiceStaleness(game, bot, phase, snapshot) {
  if (!botSeatStillLive(game, bot) || bot.id !== snapshot.actingBotId) return 'seat-changed';
  if ((game.startedAt ?? null) !== snapshot.gameStartedAt) return 'game-changed';
  if (phase === 'vote' && voteChoiceStale(game, bot, snapshot)) return 'vote-event-changed';
  if (OFFER_CHOICE_PHASES.has(phase) && offerChoiceStale(game, bot, phase, snapshot)) return 'offer-changed';
  return postOfferChoiceStaleness(game, bot, phase, snapshot);
}

function noChoiceEmit(parts) {
  const { decisionContext, safeDecision, evaluationTrace, phase, reasonCode, candidateIds } = parts;
  return {
    noEmit: true,
    botDecision: { ...decisionContext, ...safeDecision, phase, reasonCode, actionId: null, candidateIds },
    ...(evaluationTrace ? { evaluationTrace } : {})
  };
}

// The choice list is not sorted: for a trade it starts with 'accept'. A missing,
// unknown or stale answer must therefore fall to the best-scored option, never to
// whatever happens to be listed first.
function topScoredCandidate(candidates) {
  return candidates.reduce((best, candidate) => (!best || Number(candidate.score) > Number(best.score) ? candidate : best), null);
}

function resolveChoiceSelection(parts) {
  const { game, bot, phase, decision, candidates } = parts;
  const requested = candidates.find(candidate => candidate.id === decision?.actionId);
  const currentCandidates = getBotChoiceCandidates(game, bot, phase);
  const currentSelection = requested && currentCandidates.find(candidate => candidate.id === requested.id && sameCandidateTerms(candidate, requested));
  return { currentCandidates, selected: currentSelection || topScoredCandidate(currentCandidates), usedFallback: !currentSelection };
}

function choicePhaseTrace(parts) {
  const { decisionContext, safeDecision, decision, phase, selection } = parts;
  return {
    ...decisionContext,
    ...safeDecision,
    phase,
    provider: decision?.provider || 'deterministic',
    fallback: decision?.fallback !== false,
    fallbackReason: decision?.fallbackReason || 'choice-phase-fallback',
    actionId: selection.selected.id,
    candidateIds: selection.currentCandidates.map(candidate => candidate.id),
    ...(selection.usedFallback ? { reasonCode: 'stale-candidate', fallbackReason: 'stale-candidate', fallback: true } : {})
  };
}

function sameCandidateTerms(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

export async function runAdvisorChoicePhase({ room, bot, advisor, decisionContext, phase }) {
  const game = room.game;
  const candidates = getBotChoiceCandidates(game, bot, phase);
  if (!candidates.length) return PHASE_EXECUTORS[phase](room, bot, game);
  // Capture the offer version before the asynchronous provider call. A human
  // may counter, cancel, or replace the deal while the AI is thinking; the
  // old choice must never be rebound to the newer offer after the await.
  const snapshot = choiceSnapshot(game, bot, phase);
  const decision = await advisor.chooseAction({
    ...decisionContext,
    candidates,
    event: game.globalEvent
  });
  const { botDecision: safeDecision, evaluationTrace } = splitEvaluationTrace(decision);
  const reasonCode = choiceStaleness(game, bot, phase, snapshot);
  if (reasonCode) {
    return noChoiceEmit({ decisionContext, safeDecision, evaluationTrace, phase, reasonCode, candidateIds: candidates.map(candidate => candidate.id) });
  }
  const selection = resolveChoiceSelection({ game, bot, phase, decision, candidates });
  const { selected } = selection;
  if (!selected) return PHASE_EXECUTORS[phase](room, bot, game);
  if (phase === 'trade') selected.tradeId = game.pendingTrade.id;
  if (phase === 'contract') selected.contractId = game.pendingPlayerContract.id;
  const trace = choicePhaseTrace({ decisionContext, safeDecision, decision, phase, selection });
  const runner = PHASE_CHOICE_RUNNERS[phase];
  const result = runner ? runner(room, bot, game, selected) : { success: false, error: 'No bot choice is available.' };
  // A rescue the server refuses must not leave the debt unresolved: the
  // deterministic ladder tries the remaining rescues and ends in bankruptcy.
  if (phase === 'payment' && result?.success === false) {
    const fallback = PHASE_EXECUTORS.payment(room, bot, game);
    return attachBotDecision(fallback, { ...trace, ...fallback?.botDecision, fallbackReason: 'candidate-rejected' }, evaluationTrace);
  }
  return attachBotDecision(result, trace, evaluationTrace);
}

function botSeatStillLive(game, bot) {
  if (!bot) return false;
  if (bot.bankrupt || bot.disconnected) return false;
  if (!Array.isArray(game?.players)) return true;
  return game.players.some(player => player?.id === bot.id && player === bot);
}

function pendingPaymentKey(game) {
  const payment = game.pendingPayment;
  return payment ? `${payment.playerId}:${payment.amountRemaining}` : null;
}

function advisorTableSnapshot(game) {
  return {
    // The game generation: a rematch restarts the table, so the pre-roll
    // candidates of the previous game must never be played in the new one.
    gameStartedAt: game.startedAt ?? null,
    pendingTradeId: game.pendingTrade?.id || null,
    pendingContractId: game.pendingPlayerContract?.id || null,
    pendingPaymentId: pendingPaymentKey(game),
    auctionActive: Boolean(game.auction?.active)
  };
}

function advisorTableChanged(game, snapshot) {
  return (game.startedAt ?? null) !== snapshot.gameStartedAt
    || (game.pendingTrade?.id || null) !== snapshot.pendingTradeId
    || (game.pendingPlayerContract?.id || null) !== snapshot.pendingContractId
    || pendingPaymentKey(game) !== snapshot.pendingPaymentId
    || Boolean(game.auction?.active) !== snapshot.auctionActive;
}

function advisorTurnTrace(parts) {
  const { decisionContext, safeDecision, decision, phase, candidates } = parts;
  return {
    ...decisionContext,
    ...safeDecision,
    phase,
    provider: decision?.provider || 'deterministic',
    fallback: decision?.fallback !== false,
    fallbackReason: decision?.fallbackReason || 'deterministic-advisor',
    candidateIds: candidates.map(candidate => candidate.id).filter(Boolean).slice(0, 24)
  };
}

function selectAdvisorCandidate(parts) {
  const { game, bot, phase, decision, candidates } = parts;
  const requested = candidates.find(entry => entry.id === decision?.actionId);
  const currentCandidates = game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: phase === 'post-roll' });
  const currentSelection = requested && currentCandidates.find(entry => entry.id === requested.id && sameCandidateTerms(entry, requested));
  return { requested, currentCandidates, currentSelection };
}

function advisorFallbackCandidate(phase, bot) {
  if (phase !== 'post-roll') return { id: 'roll', kind: 'roll' };
  if (Number(bot.cash) > 0 || bot.bankrupt) return { id: 'end-turn', kind: 'end-turn' };
  return { id: 'bankruptcy:zero-cash', kind: 'bankruptcy' };
}

// Kinds that end or pass the turn, or only talk: a refused action hands over
// to the next ranked action first and reaches these only through the terminal
// fallback, never by ending the turn on a refused build.
const NON_ADVANCING_KINDS = new Set(['chat', 'end-turn', 'end-finance-window', 'bankruptcy', 'roll']);

// A refused deal, market order or bet is never swapped for a different one: the
// next entry in static-score order was never ranked by the planner against standing
// still, and the walk used to buy index units the planner rated negative or send an
// unrelated loan offer. Only the cash-raising kinds may stand in for each other.
const NO_RETRY_KINDS = new Set(['trade', 'contract-propose', 'market', 'open-margin', 'reduce-margin', 'open-short', 'cover-short', 'settle-short-default', 'open-option', 'exercise-option', 'close-position', 'casino']);
const LIQUIDATION_KINDS = new Set(['sell', 'mortgage']);

function mayStandIn(rejected, next) {
  if (NO_RETRY_KINDS.has(next.kind)) return false;
  return !LIQUIDATION_KINDS.has(next.kind) || LIQUIDATION_KINDS.has(rejected.kind);
}

// A stale or unknown answer ends the decision on the turn rail; the next tick
// decides again from fresh state. Falling to the top static score ran proposals.
function staleAnswerFallback(candidates) {
  return candidates.find(candidate => ['roll', 'end-turn', 'end-finance-window'].includes(candidate.kind)) || candidates[0];
}

function runNextLegalCandidate({ room, bot, candidates, rejected, trace, evaluationTrace }) {
  if (NO_RETRY_KINDS.has(rejected.kind)) return null;
  const start = candidates.indexOf(rejected);
  for (const next of candidates.slice(start + 1)) {
    if (NON_ADVANCING_KINDS.has(next.kind)) break;
    if (!mayStandIn(rejected, next)) continue;
    const nextAction = candidateAction(next, bot);
    const attempt = CANDIDATE_RUNNERS[nextAction.type](room, bot, nextAction.candidate);
    if (attempt?.success !== false) {
      return attachBotDecision(attempt, { ...trace, actionId: next.id, fallbackReason: 'candidate-rejected', fallback: true }, evaluationTrace);
    }
  }
  return null;
}

function runAdvisorCandidate(parts) {
  const { room, bot, phase, decision, candidates, trace, evaluationTrace } = parts;
  const game = room.game;
  const selection = selectAdvisorCandidate({ game, bot, phase, decision, candidates });
  const { requested, currentCandidates, currentSelection } = selection;
  if (requested?.kind === 'cancel-trade' && !currentSelection) {
    return attachBotDecision({ success: true, noEmit: true }, {
      ...trace,
      actionId: null,
      reasonCode: 'trade-changed',
      fallback: true,
      fallbackReason: 'trade-changed'
    }, evaluationTrace);
  }
  const candidate = currentSelection || staleAnswerFallback(currentCandidates);
  if (!candidate) {
    return attachBotDecision({ success: true, noEmit: true }, { ...trace, reasonCode: 'no-legal-action' }, evaluationTrace);
  }
  if (!currentSelection) {
    trace.reasonCode = 'stale-candidate';
    trace.fallbackReason = 'stale-candidate';
    trace.fallback = true;
  }
  const action = candidateAction(candidate, bot);
  const result = CANDIDATE_RUNNERS[action.type](room, bot, action.candidate);
  if (result?.success !== false || action.type === 'roll') return attachBotDecision(result, trace, evaluationTrace);
  const nextLegal = runNextLegalCandidate({ room, bot, candidates: currentCandidates, rejected: candidate, trace, evaluationTrace });
  if (nextLegal) return nextLegal;
  const fallbackCandidate = advisorFallbackCandidate(phase, bot);
  const fallback = CANDIDATE_RUNNERS[fallbackCandidate.kind](room, bot, fallbackCandidate);
  return attachBotDecision(fallback, { ...trace, actionId: fallbackCandidate.id, fallbackReason: 'candidate-rejected' }, evaluationTrace);
}

// A debt that is due and can be cured in full is paid before anything else, with
// no advisor call (no planner score, no paid LLM request): letting a model or a
// net-worth-neutral score choose `roll` instead costs the whole pledged basket.
function runMandatoryObligation({ room, bot, phase, decisionContext, candidates }) {
  const mandatory = candidates.find(candidate => candidate.mandatory === true);
  if (!mandatory) return null;
  const action = candidateAction(mandatory, bot);
  const result = CANDIDATE_RUNNERS[action.type](room, bot, action.candidate);
  if (result?.success === false) return null;
  const trace = advisorTurnTrace({
    decisionContext,
    safeDecision: { actionId: mandatory.id, confidence: 1, reasonCode: 'obligation-due' },
    decision: { provider: 'deterministic', fallback: false, fallbackReason: 'obligation-due' },
    phase,
    candidates
  });
  return attachBotDecision(result, trace, null);
}

export async function runAdvisorTurn({ room, bot, advisor, decisionContext = {}, phase = 'pre-roll' }) {
  const game = room.game;
  const candidates = game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: phase === 'post-roll' });
  const obligation = runMandatoryObligation({ room, bot, phase, decisionContext, candidates });
  if (obligation) return obligation;
  // Snapshot table obligations before the async advisor call: a trade,
  // contract, payment, or auction arriving mid-thought must not be acted
  // on with a stale pre-roll candidate list (mirrors the choice phases).
  const snapshot = advisorTableSnapshot(game);
  const decision = await advisor.chooseAction({
    ...decisionContext,
    candidates,
    event: game.globalEvent
  });
  const { botDecision: safeDecision, evaluationTrace } = splitEvaluationTrace(decision);
  const trace = advisorTurnTrace({ decisionContext, safeDecision, decision, phase, candidates });
  // The advisor call is async; if the seat moved on while it thought, the
  // original code aborted the tick without emitting.
  if (game.getCurrentPlayer()?.id !== bot.id || !botSeatStillLive(game, bot)) {
    return { noEmit: true, botDecision: { ...trace, reasonCode: 'seat-changed' }, ...(evaluationTrace ? { evaluationTrace } : {}) };
  }
  if (advisorTableChanged(game, snapshot)) {
    return { noEmit: true, botDecision: { ...trace, reasonCode: 'table-changed', actionId: null }, ...(evaluationTrace ? { evaluationTrace } : {}) };
  }
  return runAdvisorCandidate({ room, bot, phase, decision, candidates, trace, evaluationTrace });
}
