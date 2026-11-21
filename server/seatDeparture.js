// What happens to a seat's unfinished business when it leaves or goes AFK: an unpaid debt is settled or bankrupted, and a
// pending purchase is passed or auctioned.

// AFK payment expiry follows the authoritative bankruptcy/settlement seam;
// clearing an unpaid payment would silently forgive the obligation.
function pendingCreditor(game, pending) {
  if (!pending.creditorId) return null;
  return game.getPlayerById?.(pending.creditorId);
}

function debtModeEnabled(game) {
  if (game.settings?.bankruptMode !== 'debt') return false;
  return typeof game.handleDebtBankruptcy === 'function';
}

function applyPendingBankruptcy(game, player, pending) {
  const creditor = pendingCreditor(game, pending);
  if (debtModeEnabled(game)) {
    return game.handleDebtBankruptcy(player, creditor)?.success !== false;
  }
  if (typeof game.handleBankruptcy === 'function') {
    return game.handleBankruptcy(player, creditor)?.success !== false;
  }
  return false;
}

export function settleAfkPayment(game, player) {
  const pending = game?.pendingPayment;
  if (!pending) return false;
  if (pending.playerId !== player?.id) return false;
  const covers = Number(player.cash) >= Math.max(0, Number(pending.amountRemaining) || 0);
  // A debtor that can cover pays the debt and is then removed; only a debtor
  // that cannot cover goes through bankruptcy and hands over its estate.
  if (covers) return Boolean(game.collectPendingPayment?.(player));
  return applyPendingBankruptcy(game, player, pending);
}

function preparePendingPurchasePass(game, player) {
  const offer = game?.pendingPurchaseOffer;
  if (!offer || offer.playerId !== player?.id) return { resolved: false, tile: null };
  const tile = game.getTile?.(offer.tileIndex);
  game.cancelSponsoredPurchase?.();
  game.pendingPurchaseOffer = null;
  return { resolved: true, tile };
}

function startAuctionForDepartingPlayer(game, player, tile) {
  if (!canAuctionPassedPurchase(game, tile)) return false;
  const startingPlayerId = nextAuctionStarter(game, player.id);
  if (!startingPlayerId) return false;
  game.startAuction?.(tile, startingPlayerId);
  const auction = game.auction;
  if (!auction?.active) return false;
  excludeDepartingAuctionSeat(auction, player, startingPlayerId);
  return true;
}

function excludeDepartingAuctionSeat(auction, player, startingPlayerId) {
  auction.participants = [...new Set((auction.participants || []).filter(id => id !== player.id))];
  if (auction.startingPlayerId === player.id) auction.startingPlayerId = startingPlayerId;
}

export function passPendingPurchaseForSeatRemoval(game, player) {
  const pending = preparePendingPurchasePass(game, player);
  if (!pending.resolved) return { resolved: false, auctionStarted: false };
  const auctionStarted = startAuctionForDepartingPlayer(game, player, pending.tile);
  const propertyName = auctionStarted ? pending.tile.name : null;
  reportPassedPurchase(game, player, propertyName);
  return { resolved: true, auctionStarted };
}

function canAuctionPassedPurchase(game, tile) {
  if (!tile) return false;
  if (tile.ownerId !== null) return false;
  return Boolean(game.settings?.auction);
}

function reportPassedPurchase(game, player, propertyName = null) {
  const copy = propertyName
    ? `${player.nickname} passed on ${propertyName} before leaving.`
    : `${player.nickname} passed on the property before leaving.`;
  game.feedMessage?.(copy);
}

function isEligibleAuctionStarter(candidate, departingPlayerId) {
  if (!candidate) return false;
  if (candidate.id === departingPlayerId) return false;
  if (candidate.bankrupt) return false;
  return !candidate.disconnected;
}

function nextAuctionStarter(game, departingPlayerId) {
  const playersById = new Map((game.players || []).map(player => [player.id, player]));
  const order = Array.isArray(game.turnOrder) ? game.turnOrder : (game.players || []).map(player => player.id);
  const oldIndex = order.indexOf(departingPlayerId);
  for (let offset = 1; offset <= order.length; offset += 1) {
    const index = oldIndex < 0 ? offset - 1 : (oldIndex + offset) % order.length;
    const candidate = playersById.get(order[index]);
    if (isEligibleAuctionStarter(candidate, departingPlayerId)) return candidate.id;
  }
  return null;
}
