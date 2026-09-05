// Pure bot decision policy, extracted verbatim from the scheduleBotTurn/
// scheduleBotAuction timers in server.js. Every function here is deterministic
// and free of timers, sockets, and IO, so the whole policy is characterization-
// testable in isolation (server/botLogic.test.js pins the exact answers).
// The server keeps only scheduling and execution; it asks these helpers what
// a bot should do and runs the answer through room.runBotAction.

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
  if (offer.kind === 'equity') {
    return personality !== 'survivor' || Number(offer.amount) <= bot.cash * 0.35;
  }
  const repayment = Number(offer.totalDue || offer.amount);
  const factor = CONTRACT_REPAY_FACTOR[personality] || DEFAULT_CONTRACT_REPAY_FACTOR;
  return repayment <= bot.cash * factor && Boolean(lender && !lender.bankrupt);
}

// Who should the bot timer serve right now: an unvoted bot in a vote beats
// the counterparty of a pending offer, which beats the current player.
export function selectBotTurnTarget(game) {
  const votingBot = game.globalEvent?.phase === 'voting'
    ? game.players.find(player => player.isBot && !player.bankrupt && !player.disconnected && !game.globalEvent.votes?.[player.id])
    : null;
  const pendingBot = game.pendingTrade
    ? game.getPlayerById(game.pendingTrade.toPlayerId)
    : game.pendingPlayerContract
      ? game.getPlayerById(game.pendingPlayerContract.toPlayerId)
      : null;
  return votingBot || (pendingBot?.isBot ? pendingBot : null) || game.getCurrentPlayer();
}

export function botMayStillAct(game, bot) {
  if (!bot) return false;
  const current = game.getCurrentPlayer();
  const isVote = game.globalEvent?.phase === 'voting';
  const isPendingResponse = game.pendingTrade?.toPlayerId === bot.id || game.pendingPlayerContract?.toPlayerId === bot.id;
  if (isVote || isPendingResponse) return true;
  return Boolean(current?.isBot && current.id === bot.id && !current.bankrupt && !current.disconnected);
}

// Ordered phase classification of what the bot must resolve this tick.
// Mirrors the historical if/else chain exactly: every state falls into one
// phase ('post-roll' is the catch-all).
export function classifyBotTurnPhase(game, bot) {
  if (game.globalEvent?.phase === 'voting' && !game.globalEvent.votes?.[bot.id]) return 'vote';
  if (game.pendingTrade?.toPlayerId === bot.id) return 'trade';
  if (game.pendingPlayerContract?.toPlayerId === bot.id) return 'contract';
  if (game.pendingPayment?.playerId === bot.id) return 'payment';
  if (game.auction?.active) return 'auction';
  if (game.awaitingEndTurn) return 'end-turn';
  if (!game.hasRolled) return 'pre-roll';
  return 'post-roll';
}

// Maps the advisor's chosen candidate to the concrete action it implies.
// 'default' (or an unknown kind) means plain roll, matching the historical
// if/else chain's fallthrough.
export function candidateAction(candidate, bot) {
  if (!candidate) return { type: 'roll' };
  switch (candidate.kind) {
    case 'trade': return { type: 'trade', candidate };
    case 'market': return { type: 'market', candidate };
    case 'casino': return { type: 'casino', candidate };
    case 'build': return bot.cash >= candidate.cost + 200 ? { type: 'build', candidate } : { type: 'roll' };
    case 'mortgage': return { type: 'mortgage', candidate };
    case 'loan': return bot.personality === 'speculator' ? { type: 'loan' } : { type: 'roll' };
    default: return { type: 'roll' };
  }
}

export function auctionBidDecision(auction, bot, startingCash) {
  const policy = AUCTION_BID_POLICY[bot.personality] || DEFAULT_AUCTION_BID_POLICY;
  const minimum = Math.max(auction.highestBid + 1, auction.highestBid + policy.step);
  const comfortable = policy.always || bot.cash > startingCash * AUCTION_COMFORT_RATIO;
  const shouldBid = bot.cash >= minimum + policy.reserve && comfortable;
  return { shouldBid, minimum };
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

// Executes the classified phase against the room (the room only enters this
// module as an injected collaborator, never as an import) and returns the
// action result. Purchase offers are resolved at most twice, exactly like the
// original inline chain: once inside post-roll, once again at the tail.
export async function runBotTurn(room, bot, advisor) {
  const game = room.game;
  const phase = classifyBotTurnPhase(game, bot);
  if (phase === 'vote') {
    const policy = selectGlobalEventPolicy(game.globalEvent, bot.personality);
    return policy ? room.runBotAction(bot.id, actor => room.voteGlobalEvent(actor, policy.id)) : { success: false };
  }
  if (phase === 'trade') {
    const trade = game.pendingTrade;
    const accept = shouldAcceptTrade(trade, index => game.getTile(index), bot.personality);
    return room.runBotAction(bot.id, actor => room.respondToTrade(actor, { tradeId: trade.id, accept }));
  }
  if (phase === 'contract') {
    const offer = game.pendingPlayerContract;
    const lender = game.getPlayerById(offer.fromPlayerId);
    const acceptable = shouldAcceptPlayerContract(offer, bot, lender, bot.personality);
    return room.runBotAction(bot.id, actor => room.respondPlayerContract(actor, acceptable));
  }
  if (phase === 'payment') return room.runBotAction(bot.id, actor => room.declareBankruptcy(actor));
  if (phase === 'auction') return room.runBotAction(bot.id, actor => room.passAuction(actor));
  if (phase === 'end-turn') return room.runBotAction(bot.id, actor => room.endTurn(actor));
  if (phase === 'post-roll') {
    const rolled = room.runBotAction(bot.id, actor => room.rollDice(actor));
    return resolvePurchaseOffer(room, bot, rolled);
  }
  const candidates = game.getBotCandidates(bot);
  const decision = await advisor.chooseAction({ candidates, personality: bot.personality, event: game.globalEvent });
  if (game.getCurrentPlayer()?.id !== bot.id) return { noEmit: true };
  const action = candidateAction(candidates.find(entry => entry.id === decision?.actionId) || candidates[0], bot);
  if (action.type === 'trade') {
    const proposal = room.runBotAction(bot.id, actor => room.proposeTrade(actor, action.candidate));
    if (!proposal?.success) return proposal;
    const rolled = room.runBotAction(bot.id, actor => room.rollDice(actor));
    return rolled?.success ? rolled : proposal;
  }
  if (action.type === 'market') {
    const candidate = action.candidate;
    return room.runBotAction(bot.id, actor => room.tradeMarket(actor, candidate.instrumentId, candidate.side, candidate.quantity, 'bot-market-' + room.roomCode + '-' + game.roundNumber));
  }
  if (action.type === 'casino') {
    const candidate = action.candidate;
    return room.runBotAction(bot.id, actor => room.placeCasinoBet(actor, candidate.color, candidate.stake, 'bot-casino-' + room.roomCode + '-' + game.roundNumber));
  }
  if (action.type === 'build') {
    const candidate = action.candidate;
    return room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: candidate.tileIndex, action: 'build-house' }));
  }
  if (action.type === 'mortgage') {
    const candidate = action.candidate;
    return room.runBotAction(bot.id, actor => room.manageProperty(actor, { tileIndex: candidate.tileIndex, action: 'mortgage' }));
  }
  if (action.type === 'loan') return room.runBotAction(bot.id, actor => room.takeBankLoan(actor));
  return room.runBotAction(bot.id, actor => room.rollDice(actor));
}

// Applies one pending purchase offer for the bot, if the result carries it.
export function resolvePurchaseOffer(room, bot, result) {
  if (!result?.purchaseOffer) return result;
  const tile = room.game.getTile(result.purchaseOffer.tileIndex);
  const canBuy = shouldBuyProperty(bot, tile);
  return room.runBotAction(bot.id, actor => canBuy
    ? room.purchaseProperty(actor, tile.index)
    : room.declineProperty(actor, tile.index));
}
