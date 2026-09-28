function stableObject(value) {
  const entries = Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function queuePaymentState(entry) {
  const payment = entry.payment || {};
  return [payment.playerId, payment.creditorId, payment.amountRemaining];
}

function pendingPaymentState(game) {
  const payment = game.pendingPayment;
  if (!payment) return null;
  return {
    playerId: payment.playerId,
    creditorId: payment.creditorId,
    amount: payment.amount,
    amountRemaining: payment.amountRemaining,
    queue: (game.pendingPaymentQueue || []).map(queuePaymentState),
  };
}

function pendingPurchaseState(game) {
  const purchase = game.pendingPurchaseOffer;
  return purchase ? { playerId: purchase.playerId, tileIndex: purchase.tileIndex } : null;
}

function pendingTradeState(game) {
  const trade = game.pendingTrade;
  if (!trade) return null;
  return {
    id: trade.id,
    fromPlayerId: trade.fromPlayerId,
    toPlayerId: trade.toPlayerId,
    counterDepth: trade.counterDepth,
    status: trade.status,
  };
}

function pendingContractState(game) {
  const contract = game.pendingPlayerContract;
  return contract ? [contract.id, contract.kind, contract.status, contract.offer] : null;
}

function pendingSponsoredPurchaseState(game) {
  const purchase = game.pendingSponsoredPurchase;
  if (!purchase) return null;
  const contributions = purchase.contributions || [];
  return [purchase.buyerId, purchase.tileIndex, ...contributions.map(({ sponsorId, amount }) => [sponsorId, amount])];
}

function auctionState(game) {
  const auction = game.auction;
  if (!auction) return null;
  return {
    active: auction.active,
    propertyTileIndex: auction.propertyTile?.index,
    participants: [...(auction.participants || [])].sort(),
    currentPlayerId: auction.currentPlayerId,
    highestBid: auction.highestBid,
    highestBidderId: auction.highestBidderId,
    passedPlayerIds: [...(auction.passedPlayerIds || [])].sort(),
  };
}

function globalEventState(game) {
  const event = game.globalEvent;
  if (!event) return null;
  return [event.id, event.phase, stableObject(event.votes), event.resolvedChoice, event.roundsRemaining, event.settlementApplied];
}

function tileState(game, index) {
  const tile = typeof game.getTile === 'function'
    ? game.getTile(index)
    : game.tiles?.find(entry => entry.index === index);
  return [index, tile?.ownerId, tile?.mortgaged, tile?.houseCount, tile?.hotelCount, tile?.equityShares];
}

function playerPropertiesState(game, player) {
  return [...player.properties].sort((left, right) => left - right).map(index => tileState(game, index));
}

function bankLoanState(player) {
  const loan = player.bankLoan;
  if (!loan) return null;
  return {
    status: loan.status,
    principal: loan.principal,
    remaining: loan.remaining,
    dueRound: loan.dueRound,
    cureRound: loan.cureRound,
    collateralTileIndex: loan.collateralTileIndex,
    severity: loan.severity,
  };
}

function playerState(game, player) {
  return {
    id: player.id,
    cash: player.cash,
    position: player.position,
    properties: playerPropertiesState(game, player),
    bankrupt: player.bankrupt,
    inJail: player.inJail,
    jailTurns: player.jailTurns,
    jailFreeCards: player.jailFreeCards,
    bankLoan: bankLoanState(player),
    marketPositions: stableObject(player.marketPositions),
    marketTrades: player.marketTrades,
    disconnected: player.disconnected,
  };
}

export function stateFingerprint(game) {
  return JSON.stringify({
    current: game.currentPlayerId,
    started: game.started,
    hasRolled: game.hasRolled,
    awaitingEndTurn: game.awaitingEndTurn,
    extraRollPending: game.extraRollPending,
    lastDice: Array.isArray(game.lastDice) ? game.lastDice.slice() : null,
    pendingPurchase: pendingPurchaseState(game),
    pendingPayment: pendingPaymentState(game),
    pendingTrade: pendingTradeState(game),
    pendingContract: pendingContractState(game),
    pendingSponsoredPurchase: pendingSponsoredPurchaseState(game),
    auction: auctionState(game),
    globalEvent: globalEventState(game),
    round: game.roundNumber,
    market: {
      round: game.marketRound,
      quotes: stableObject(game.marketQuotes),
      shortInventory: stableObject(game.marketShortInventory),
    },
    players: game.players.map(player => playerState(game, player)),
  });
}
