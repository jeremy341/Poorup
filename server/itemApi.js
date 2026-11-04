import crypto from 'node:crypto';
import { ITEM_CATALOG } from '../public/itemCatalog.js';
import { normalizeRequestId } from './requestId.js';
import { bankSaleQuote } from './bankAccountApi.js';

const failure = error => ({ success: false, error });
const dollars = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const inventory = player => Array.isArray(player?.items) ? player.items : [];

function newItem(game, catalogId, source) {
  const meta = ITEM_CATALOG[catalogId];
  const economic = catalogId !== 'prison-key' || Boolean(game.settings?.itemRewards);
  const reward = amount => economic ? game.cardRewardAmount({ amount }) : 0;
  return {
    itemId: crypto.randomUUID(), catalogId, source,
    bankSellValue: reward(meta.bankSellValue), redeemValue: reward(meta.redeemValue),
    maturesRound: meta.maturityRounds ? Number(game.roundNumber || 0) + meta.maturityRounds : null
  };
}

const isItemPayloadObject = payload => Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload);
const isValidItemId = itemId => typeof itemId === 'string' && itemId.length > 0 && itemId.length <= 100;

function parseItemRequest(payload) {
  if (!isItemPayloadObject(payload)) return { error: 'Invalid item request.' };
  const requestId = normalizeRequestId(payload.requestId);
  if (!isValidItemId(payload.itemId) || !requestId) return { error: 'Item and request IDs are required.' };
  return { itemId: payload.itemId, requestId };
}

function replayItemTransaction(prior, action, itemId) {
  if (prior.action === action && prior.itemId === itemId) return { ...prior.result, duplicate: true };
  return failure('This request ID was already used for another item action.');
}

function resolveItemAction(game, socketId, player, item, action) {
  if (item.catalogId === 'prison-key' && action === 'use') {
    const result = game.useJailFree(socketId, item.itemId);
    return result.success ? { success: true, cashReceived: 0 } : result;
  }
  // Only a sale to the bank pays the tier fee; redeeming a matured bond is not a sale.
  const quote = action === 'sell' ? bankSaleQuote(game, player, item.bankSellValue) : null;
  const cashReceived = quote ? quote.net : dollars(item.redeemValue);
  if (item.catalogId === 'prison-key') game.consumePrisonItem(player, item.itemId);
  else player.items = player.items.filter(entry => entry.itemId !== item.itemId);
  return { success: true, cashReceived, saleFee: quote ? quote.fee : 0 };
}

function creditItemCash(game, player, item, action, cashReceived, saleFee = 0) {
  player.cash += cashReceived;
  const fee = saleFee > 0 ? ` after a $${saleFee} bank fee` : '';
  game.feedMessage(`${player.nickname} ${action === 'sell' ? 'sold' : 'redeemed'} ${ITEM_CATALOG[item.catalogId].name} for $${cashReceived}${fee}.`);
  if (game.pendingPayment?.playerId === player.id) game.trySettlePendingPayment();
}

function canGrantItem(game, player, catalogId) {
  if (!Object.hasOwn(ITEM_CATALOG, catalogId) || !player || player.bankrupt) return false;
  return catalogId === 'prison-key' || Boolean(game.settings?.itemRewards);
}

function recordJailFreeGrant(player, source) {
  player.jailFreeCards = dollars(player.jailFreeCards) + 1;
  if (!['surprise', 'treasure'].includes(source)) return;
  player.jailFreeOrigins = [...(player.jailFreeOrigins || []), source].slice(-player.jailFreeCards);
}

export function itemValue(game, item) {
  if (!item || !Object.hasOwn(ITEM_CATALOG, item.catalogId)) return 0;
  if (item.catalogId === 'parlor-bond' && Number(game?.roundNumber || 0) >= item.maturesRound) return dollars(item.redeemValue);
  return dollars(item.bankSellValue);
}

export function inventoryValue(game, player) {
  game.ensurePrisonItems?.(player);
  return inventory(player).reduce((total, item) => total + itemValue(game, item), 0);
}

const hasPlayerLeftPlay = player => player.bankrupt || player.disconnected || player.spectating;
const isPlayerUnavailable = player => !player || hasPlayerLeftPlay(player);
const isParlorBondMatured = (game, item) => Number(game.roundNumber || 0) >= item.maturesRound;

function actionReason(game, player) {
  if (!game.started) return 'Game has not started.';
  if (isPlayerUnavailable(player)) return 'Player is unavailable.';
  return null;
}

function jailFreeUseReason(game, player) {
  if (hasPlayerLeftPlay(player)) return 'Player is unavailable.';
  return game.jailFreeRejection(player)?.error || null;
}

function useReason(game, player, item) {
  if (item.catalogId === 'prison-key') return jailFreeUseReason(game, player);
  const blocked = actionReason(game, player);
  if (blocked) return blocked;
  if (item.catalogId !== 'parlor-bond') return 'This item can be sold to the bank.';
  return isParlorBondMatured(game, item) ? null : `Matures in round ${item.maturesRound}.`;
}

function sellReason(game, player, item) {
  return actionReason(game, player) || (dollars(item.bankSellValue) > 0 ? null : 'This prison card cannot be sold under classic rules.');
}

export function itemSummaryFor(game, player, viewerId) {
  if (!player || viewerId !== player.id) return [];
  game.ensurePrisonItems?.(player);
  return inventory(player).filter(item => Object.hasOwn(ITEM_CATALOG, item.catalogId)).map(item => {
    const meta = ITEM_CATALOG[item.catalogId];
    const reason = useReason(game, player, item);
    const saleReason = sellReason(game, player, item);
    const quote = bankSaleQuote(game, player, item.bankSellValue);
    const feeNote = quote.fee > 0 ? ` after a $${quote.fee} bank fee` : '';
    return {
      itemId: item.itemId, id: item.itemId, catalogId: item.catalogId,
      name: meta.name, description: item.catalogId === 'parlor-bond'
        ? `Redeem for $${dollars(item.redeemValue)} from round ${item.maturesRound}, or sell to the bank for $${quote.net}${feeNote}.`
        : item.catalogId === 'silver-keepsake' ? `A collectible worth $${quote.net} when sold to the bank${feeNote}.` : meta.description,
      quantity: 1,
      sellValue: dollars(item.bankSellValue), bankSellValue: dollars(item.bankSellValue),
      redeemValue: dollars(item.redeemValue), maturesRound: item.maturesRound ?? null,
      saleFeePct: quote.feePct, saleFee: quote.fee, netSaleValue: quote.net,
      canUse: reason === null, canSell: saleReason === null, canTrade: false, canExchange: false,
      actionLabel: meta.actionLabel, useReason: reason, sellReason: saleReason
    };
  });
}

export const itemApi = {
  grantItem(player, catalogId, source = null) {
    if (!canGrantItem(this, player, catalogId)) return null;
    if (catalogId === 'prison-key') this.ensurePrisonItems(player);
    const item = newItem(this, catalogId, source);
    player.items ||= [];
    player.items.push(item);
    if (catalogId === 'prison-key') recordJailFreeGrant(player, source);
    return item;
  },

  // Upgrade old saves/fixtures with counters into stable instances. A legacy
  // counter decrement retires the oldest keys, never mints replacement IDs.
  ensurePrisonItems(player) {
    player.items ||= [];
    const count = dollars(player.jailFreeCards);
    const keys = inventory(player).filter(item => item.catalogId === 'prison-key');
    const excess = Math.max(0, keys.length - count);
    const retired = new Set(keys.slice(0, excess).map(item => item.itemId));
    if (excess) player.items = player.items.filter(item => !retired.has(item.itemId));
    for (let n = keys.length; n < count; n += 1) {
      player.items.push(newItem(this, 'prison-key', 'legacy'));
    }
  },

  consumePrisonItem(player, itemId = null) {
    this.ensurePrisonItems(player);
    const keys = inventory(player).filter(item => item.catalogId === 'prison-key');
    const at = itemId ? keys.findIndex(item => item.itemId === itemId) : 0;
    const item = keys[at];
    if (!item) return false;
    const count = dollars(player.jailFreeCards);
    const recorded = Array.isArray(player.jailFreeOrigins) ? player.jailFreeOrigins.slice(-count) : [];
    const origins = [...Array(Math.max(0, count - recorded.length)).fill(null), ...recorded];
    origins.splice(at, 1);
    player.jailFreeOrigins = origins;
    player.jailFreeCards = Math.max(0, count - 1);
    player.items = player.items.filter(entry => entry.itemId !== item.itemId);
    return true;
  },

  summaryItems(player, viewerId) { return itemSummaryFor(this, player, viewerId); },
  useItem(socketId, payload) { return this.performItemAction(socketId, payload, 'use'); },
  sellItem(socketId, payload) { return this.performItemAction(socketId, payload, 'sell'); },

  performItemAction(socketId, payload, action) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) return failure('Player not found.');
    const request = parseItemRequest(payload);
    if (request.error) return failure(request.error);
    const { itemId, requestId } = request;
    this.itemTransactions ||= new Map();
    const replayKey = JSON.stringify([player.id, requestId]);
    const prior = this.itemTransactions.get(replayKey);
    if (prior) return replayItemTransaction(prior, action, itemId);
    this.ensurePrisonItems(player);
    const item = inventory(player).find(entry => entry.itemId === itemId);
    if (!item) return failure('You do not own this item.');
    const reason = action === 'use' ? useReason(this, player, item) : sellReason(this, player, item);
    if (reason) return failure(reason);
    const outcome = resolveItemAction(this, socketId, player, item, action);
    if (!outcome.success) return outcome;
    const { cashReceived, saleFee = 0 } = outcome;
    const result = { success: true, action, itemId, cashReceived, saleFee };
    // Remember and consume before crediting: collecting debt can reenter exit code.
    this.itemTransactions.set(replayKey, { action, itemId, result });
    if (cashReceived > 0) creditItemCash(this, player, item, action, cashReceived, saleFee);
    return result;
  },

  liquidateItems(player) {
    this.ensurePrisonItems(player);
    const proceeds = inventoryValue(this, player);
    player.items = [];
    player.jailFreeCards = 0;
    player.jailFreeOrigins = [];
    player.cash += proceeds;
    if (proceeds) this.feedMessage(`${player.nickname}'s items were settled for $${proceeds}.`);
    return proceeds;
  }
};
