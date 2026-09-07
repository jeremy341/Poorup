// Pure bot decision policy, extracted verbatim from the scheduleBotTurn/
// scheduleBotAuction timers in server.js. Every function here is deterministic
// and free of timers, sockets, and IO, so the whole policy is characterization-
// testable in isolation (server/botLogic.test.js pins the exact answers).
// The server keeps only scheduling and execution; it asks these helpers what
// a bot should do and runs the answer through room.runBotAction.
import { buildBotStrategicContext } from './botStrategicContext.js';
import { evaluateCandidate } from './botFuturePlanner.js';

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
// A non-always personality only bids while comfortably above starting cash.
export const AUCTION_COMFORT_RATIO = 0.7;

// Property purchase keeps this much cash in reserve before buying.
export const PURCHASE_RESERVE_CASH = 120;

function attachBotDecision(result, decision) {
  if (!result || typeof result !== 'object') return result;
  return { ...result, botDecision: decision };
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

export function shouldAcceptTrade(trade, getTile, personality) {
  const giveValue = tradeLegValue({ cash: trade.giveCash, propertyIndexes: trade.givePropertyIndexes }, getTile);
  const askValue = tradeLegValue({ cash: trade.requestCash, propertyIndexes: trade.requestPropertyIndexes }, getTile);
  return giveValue >= askValue * (TRADE_ACCEPT_FACTOR[personality] || DEFAULT_TRADE_ACCEPT_FACTOR);
}

export function shouldAcceptPlayerContract(offer, bot, lender, personality) {
  const check = CONTRACT_ACCEPTANCE[offer.kind] || CONTRACT_ACCEPTANCE.fallback;
  return check(offer, bot, { lender, personality });
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
  return game.getCurrentPlayer();
}

function findVotingBot(game) {
  if (game.globalEvent?.phase !== 'voting') return null;
  return game.players.find(player => player.isBot && !player.bankrupt && !player.disconnected && !game.globalEvent.votes?.[player.id]) || null;
}

function findPendingCounterpart(game) {
  const pending = game.pendingTrade || game.pendingPlayerContract;
  if (pending) return game.getPlayerById(pending.toPlayerId) || null;
  if (game.pendingPayment?.playerId) return game.getPlayerById(game.pendingPayment.playerId) || null;
  return null;
}

export function botMayStillAct(game, bot) {
  if (!bot) return false;
  if (isVotingTurn(game) || isPendingFor(game, bot) || game.pendingPayment?.playerId === bot.id) return true;
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
  return game.pendingTrade?.toPlayerId === bot.id || game.pendingPlayerContract?.toPlayerId === bot.id;
}

// Ordered phase state machine - the array order IS the historical if/else
// priority, and each guard keeps its exact original condition.
const PHASES = [
  { id: 'vote', guard: (game, bot) => isVotingTurn(game) && !game.globalEvent.votes?.[bot.id] },
  { id: 'trade', guard: (game, bot) => game.pendingTrade?.toPlayerId === bot.id },
  { id: 'contract', guard: (game, bot) => game.pendingPlayerContract?.toPlayerId === bot.id },
  { id: 'payment', guard: (game, bot) => game.pendingPayment?.playerId === bot.id },
  { id: 'auction', guard: game => Boolean(game.auction?.active) },
  { id: 'end-turn', guard: game => Boolean(game.awaitingEndTurn) },
  { id: 'pre-roll', guard: game => !game.hasRolled },
  { id: 'post-roll', guard: () => true }
];

export function classifyBotTurnPhase(game, bot) {
  return (PHASES.find(phase => phase.guard(game, bot)) || PHASES[PHASES.length - 1]).id;
}

// Maps the advisor's chosen candidate to the concrete action it implies.
// Each mapper answers "does this personality take this candidate?"; the
// first true wins, and anything unmatched (or no candidate) is plain roll.
const CANDIDATE_MAPPERS = [
  { kind: 'trade', takes: () => true, type: 'trade' },
  { kind: 'market', takes: () => true, type: 'market' },
  { kind: 'casino', takes: () => true, type: 'casino' },
  { kind: 'build', takes: (candidate, bot) => bot.cash >= candidate.cost + 200, type: 'build' },
  { kind: 'mortgage', takes: () => true, type: 'mortgage' },
  { kind: 'loan', takes: (candidate, bot) => bot.personality === 'speculator', type: 'loan' }
];

export function candidateAction(candidate, bot) {
  const mapper = CANDIDATE_MAPPERS.find(entry => entry.kind === candidate?.kind && entry.takes(candidate, bot));
  return mapper ? { type: mapper.type, candidate } : { type: 'roll' };
}

export function auctionBidDecision(auction, bot, startingCash) {
  const policy = AUCTION_BID_POLICY[bot.personality] || DEFAULT_AUCTION_BID_POLICY;
  const minimum = Math.max(auction.highestBid + 1, auction.highestBid + policy.step);
  const affordably = bot.cash >= minimum + policy.reserve && isComfortableBidder(policy, bot, startingCash);
  return { shouldBid: affordably, minimum };
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

function shouldBuyWithPlan(game, bot, tile) {
  if (!shouldBuyProperty(bot, tile)) return false;
  if (!Array.isArray(game.tiles)) return true;
  const snapshot = buildBotStrategicContext(game, bot, 'purchase', game.botDecisionSequence || 0);
  const difficulty = game.settings?.botDifficulty || 'table';
  const buy = evaluateCandidate(snapshot, { id: `buy:${tile.index}`, kind: 'buy', tileIndex: tile.index, price: tile.price, risk: 0, score: 0 }, { difficulty, seed: `${game.startedAt || 'pending'}:purchase` });
  const pass = evaluateCandidate(snapshot, { id: `pass:${tile.index}`, kind: 'pass', tileIndex: tile.index, risk: 0, score: 0 }, { difficulty, seed: `${game.startedAt || 'pending'}:purchase` });
  return buy.score >= pass.score;
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
  if (!contract || contract.toPlayerId !== bot.id) return null;
  if (Number(contract.counterDepth) >= 2) return null;
  const counter = {
    contractId: contract.id,
    kind: contract.kind,
    amount: Math.max(1, Math.floor(Number(contract.amount) || 1)),
    premiumRate: Math.max(0, Math.floor(Number(contract.premiumRate || 0) - 10)),
    durationRounds: Math.min(20, Math.max(1, Math.floor(Number(contract.durationRounds) || 3) + 1)),
    propertyIndex: contract.propertyIndex ?? null,
    collateralTileIndex: contract.collateralTileIndex ?? null,
    equityShare: contract.equityShare || 0,
    equityControl: contract.equityControl || 'passive',
    conversionShare: contract.conversionShare || 25,
    permanent: contract.expiresRound == null
  };
  return counter;
}

function botPaymentAction(room, bot, game) {
  const sell = debtSellCandidates(game, bot)[0];
  if (sell) {
    const result = room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: sell.tile.index, action: 'sell-house' }));
    if (result?.success !== false) {
      return attachBotDecision(result, {
        phase: 'payment',
        provider: 'deterministic',
        fallback: true,
        fallbackReason: 'debt-liquidation',
        actionId: `sell:${sell.tile.index}`,
        candidateIds: debtSellCandidates(game, bot).map(entry => `sell:${entry.tile.index}`).slice(0, 24)
      });
    }
  }
  const offer = typeof game.getBankLoanOffer === 'function' ? game.getBankLoanOffer(bot) : null;
  if (offer?.available && bot.id === game.currentPlayerId) {
    const result = room.runBotAction(bot.id, actor => room.takeBankLoan(actor));
    if (result?.success) {
      if (typeof game.trySettlePendingPayment === 'function') game.trySettlePendingPayment();
      return attachBotDecision(result, {
        phase: 'payment',
        provider: 'deterministic',
        fallback: true,
        fallbackReason: 'debt-loan-rescue',
        actionId: 'loan:emergency',
        candidateIds: ['loan:emergency', 'bankruptcy']
      });
    }
  }
  const result = room.runBotAction(bot.id, actor => room.declareBankruptcy(actor));
  return attachBotDecision(result, {
    phase: 'payment',
    provider: 'deterministic',
    fallback: true,
    fallbackReason: 'no-legal-rescue',
    actionId: 'bankruptcy',
    candidateIds: ['bankruptcy']
  });
}

function choiceCandidate(id, choiceId, score, label) {
  return { id, kind: 'choice', choiceId, score, risk: score > 0 ? 0.1 : 0.2, label };
}

function phaseChoiceCandidates(game, bot, phase) {
  if (phase === 'vote') {
    const preferred = selectGlobalEventPolicy(game.globalEvent, bot.personality)?.id;
    return (game.globalEvent?.choices || []).map(choice => choiceCandidate(
      `vote:${choice.id}`,
      choice.id,
      choice.id === preferred ? 12 : 6,
      choice.label
    ));
  }
  if (phase === 'trade' && game.pendingTrade) {
    const accept = shouldAcceptTrade(game.pendingTrade, index => game.getTile(index), bot.personality);
    const candidates = [
      choiceCandidate('trade:accept', 'accept', accept ? 12 : 2, 'ACCEPT'),
      choiceCandidate('trade:decline', 'decline', accept ? 1 : 8, 'DECLINE')
    ];
    const counter = counterTradeOffer(game, bot);
    if (counter) candidates.splice(1, 0, { ...choiceCandidate('trade:counter', 'counter', accept ? 2 : 7, 'COUNTER'), offer: counter });
    return candidates;
  }
  if (phase === 'contract' && game.pendingPlayerContract) {
    const offer = game.pendingPlayerContract;
    const lender = game.getPlayerById(offer.fromPlayerId);
    const accept = shouldAcceptPlayerContract(offer, bot, lender, bot.personality);
    const candidates = [
      choiceCandidate('contract:accept', 'accept', accept ? 12 : 2, 'ACCEPT'),
      choiceCandidate('contract:decline', 'decline', accept ? 1 : 8, 'DECLINE')
    ];
    const counter = counterContractOffer(game, bot);
    if (counter) candidates.splice(1, 0, { ...choiceCandidate('contract:counter', 'counter', accept ? 2 : 7, 'COUNTER'), offer: counter });
    return candidates;
  }
  if (phase === 'payment' && game.pendingPayment?.playerId === bot.id) {
    const sellCandidates = debtSellCandidates(game, bot).slice(0, 12).map(entry => choiceCandidate(
      `debt:sell:${entry.tile.index}`,
      `sell:${entry.tile.index}`,
      Math.max(1, Math.min(24, entry.score / 10)),
      `SELL ${entry.tile.name}`
    ));
    const offer = typeof game.getBankLoanOffer === 'function' ? game.getBankLoanOffer(bot) : null;
    const loanCandidate = offer?.available && bot.id === game.currentPlayerId
      ? choiceCandidate('debt:loan', 'loan', 10 - Math.min(8, Number(offer.totalDue || 0) / 100), 'TAKE BANK LOAN')
      : null;
    return [
      ...sellCandidates,
      ...(loanCandidate ? [loanCandidate] : []),
      choiceCandidate('debt:bankruptcy', 'bankruptcy', -20, 'DECLARE BANKRUPTCY')
    ];
  }
  return [];
}

function runPhaseChoice(room, bot, game, phase, candidate) {
  if (phase === 'vote') return room.runBotAction(bot.id, actor => room.voteGlobalEvent(actor, candidate.choiceId));
  if (phase === 'trade') {
    if (!game.pendingTrade) return { success: false, error: 'No matching trade offer was found.' };
    if (candidate.choiceId === 'counter') return room.runBotAction(bot.id, actor => room.counterTrade(actor, candidate.offer));
    return room.runBotAction(bot.id, actor => room.respondToTrade(actor, { tradeId: game.pendingTrade.id, accept: candidate.choiceId === 'accept' }));
  }
  if (phase === 'contract') {
    if (candidate.choiceId === 'counter') return room.runBotAction(bot.id, actor => room.counterPlayerContract(actor, candidate.offer));
    return room.runBotAction(bot.id, actor => room.respondPlayerContract(actor, candidate.choiceId === 'accept'));
  }
  if (phase === 'payment') {
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
  return { success: false, error: 'No bot choice is available.' };
}

async function runAdvisorChoicePhase(room, bot, advisor, decisionContext, phase) {
  const game = room.game;
  const candidates = phaseChoiceCandidates(game, bot, phase);
  if (!candidates.length) return PHASE_EXECUTORS[phase](room, bot, game);
  const decision = await advisor.chooseAction({
    ...decisionContext,
    candidates,
    personality: bot.personality,
    event: game.globalEvent
  });
  const selected = candidates.find(candidate => candidate.id === decision?.actionId) || candidates[0];
  const trace = {
    ...decisionContext,
    ...decision,
    phase,
    provider: decision?.provider || 'deterministic',
    fallback: decision?.fallback !== false,
    fallbackReason: decision?.fallbackReason || 'choice-phase-fallback',
    actionId: selected.id,
    candidateIds: candidates.map(candidate => candidate.id)
  };
  const result = runPhaseChoice(room, bot, game, phase, selected);
  return attachBotDecision(result, trace);
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
    const accept = shouldAcceptTrade(trade, index => game.getTile(index), bot.personality);
    return room.runBotAction(bot.id, actor => room.respondToTrade(actor, { tradeId: trade.id, accept }));
  },
  contract: (room, bot, game) => {
    const offer = game.pendingPlayerContract;
    const lender = game.getPlayerById(offer.fromPlayerId);
    const acceptable = shouldAcceptPlayerContract(offer, bot, lender, bot.personality);
    return room.runBotAction(bot.id, actor => room.respondPlayerContract(actor, acceptable));
  },
  payment: botPaymentAction,
  auction: (room, bot) => room.runBotAction(bot.id, actor => room.passAuction(actor)),
  'end-turn': (room, bot) => room.runBotAction(bot.id, actor => room.endTurn(actor)),
  'post-roll': (room, bot) => resolvePurchaseOffer(room, bot, room.runBotAction(bot.id, actor => room.rollDice(actor)))
};

// Executes the classified phase against the room (the room only enters this
// module as an injected collaborator, never as an import) and returns the
// action result. Purchase offers carry over to the caller's tail resolution
// for the second pass, matching the original inline double-check.
export async function runBotTurn(room, bot, advisor) {
  const game = room.game;
  const phase = classifyBotTurnPhase(game, bot);
  const decisionSequence = (game.botDecisionSequence || 0) + 1;
  game.botDecisionSequence = decisionSequence;
  const decisionContext = {
    botId: bot.id,
    botBrain: game.settings?.botBrain || 'auto',
    botDifficulty: game.settings?.botDifficulty || 'table',
    gameId: `${room.roomCode}:${game.startedAt || 'pending'}`,
    decisionSequence,
    ruleVersion: 'bot-policy-v1',
    ...buildBotStrategicContext(game, bot, phase, decisionSequence)
  };
  if (phase === 'pre-roll') return runAdvisorTurn(room, bot, advisor, decisionContext, phase);
  if (advisor?.supportsChoicePhases && ['vote', 'trade', 'contract', 'payment'].includes(phase)) {
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

// Candidate kind -> the room call it implies; the table order preserves the
// original if/else chain, including roll as the unmatched fallback.
const CANDIDATE_RUNNERS = {
  trade: (room, bot, candidate) => {
    const proposal = room.runBotAction(bot.id, actor => room.proposeTrade(actor, candidate));
    if (!proposal?.success) return proposal;
    const rolled = room.runBotAction(bot.id, actor => room.rollDice(actor));
    return rolled?.success ? rolled : proposal;
  },
  market: (room, bot, candidate) => room.runBotAction(bot.id, actor => room.tradeMarket(actor, candidate.instrumentId, candidate.side, candidate.quantity, 'bot-market-' + room.roomCode + '-' + room.game.roundNumber)),
  casino: (room, bot, candidate) => room.runBotAction(bot.id, actor => room.placeCasinoBet(actor, candidate.color, candidate.stake, 'bot-casino-' + room.roomCode + '-' + room.game.roundNumber)),
  build: (room, bot, candidate) => room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: candidate.tileIndex, action: 'build-house' })),
  mortgage: (room, bot, candidate) => room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: candidate.tileIndex, action: 'mortgage' })),
  loan: (room, bot) => room.runBotAction(bot.id, actor => room.takeBankLoan(actor)),
  roll: (room, bot) => room.runBotAction(bot.id, actor => room.rollDice(actor))
};

async function runAdvisorTurn(room, bot, advisor, decisionContext = {}, phase = 'pre-roll') {
  const game = room.game;
  const candidates = game.getBotCandidates(bot, { expanded: true });
  const decision = await advisor.chooseAction({
    ...decisionContext,
    candidates,
    personality: bot.personality,
    event: game.globalEvent
  });
  const trace = {
    ...decisionContext,
    ...decision,
    phase,
    provider: decision?.provider || 'deterministic',
    fallback: decision?.fallback !== false,
    fallbackReason: decision?.fallbackReason || 'deterministic-advisor',
    candidateIds: candidates.map(candidate => candidate.id).filter(Boolean).slice(0, 24)
  };
  // The advisor call is async; if the seat moved on while it thought, the
  // original code aborted the tick without emitting.
  if (game.getCurrentPlayer()?.id !== bot.id) return { noEmit: true, botDecision: { ...trace, reasonCode: 'seat-changed' } };
  const candidate = candidates.find(entry => entry.id === decision?.actionId) || candidates[0];
  const action = candidateAction(candidate, bot);
  const result = CANDIDATE_RUNNERS[action.type](room, bot, action.candidate);
  return attachBotDecision(result, trace);
}

// Applies one pending purchase offer for the bot, if the result carries it.
export function resolvePurchaseOffer(room, bot, result) {
  if (!result?.purchaseOffer) return result;
  const tile = room.game.getTile(result.purchaseOffer.tileIndex);
  const canBuy = shouldBuyWithPlan(room.game, bot, tile);
  return room.runBotAction(bot.id, actor => canBuy
    ? room.purchaseProperty(actor, tile.index)
    : room.declineProperty(actor, tile.index));
}
