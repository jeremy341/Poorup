import crypto from 'node:crypto';
import { ITEM_CATALOG } from '../public/itemCatalog.js';
import { normalizeRequestId } from './requestId.js';

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

export function itemValue(game, item) {
  if (!item || !Object.hasOwn(ITEM_CATALOG, item.catalogId)) return 0;
  if (item.catalogId === 'parlor-bond' && Number(game?.roundNumber || 0) >= item.maturesRound) return dollars(item.redeemValue);
  return dollars(item.bankSellValue);
}

export function inventoryValue(game, player) {
  game.ensurePrisonItems?.(player);
  return inventory(player).reduce((total, item) => total + itemValue(game, item), 0);
}

function actionReason(game, player) {
  if (!game.started) return 'Game has not started.';
  if (!player || player.bankrupt || player.spectating || player.disconnected) return 'Player is unavailable.';
  return null;
}

function useReason(game, player, item) {
  if (item.catalogId === 'prison-key') {
    if (player.bankrupt || player.disconnected || player.spectating) return 'Player is unavailable.';
    return game.jailFreeRejection(player)?.error || null;
  }
  const blocked = actionReason(game, player);
  if (blocked) return blocked;
  if (item.catalogId !== 'parlor-bond') return 'This item can be sold to the bank.';
  return Number(game.roundNumber || 0) >= item.maturesRound ? null : `Matures in round ${item.maturesRound}.`;
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
    return {
      itemId: item.itemId, id: item.itemId, catalogId: item.catalogId,
      name: meta.name, description: item.catalogId === 'parlor-bond'
        ? `Redeem for $${dollars(item.redeemValue)} from round ${item.maturesRound}, or sell to the bank for $${dollars(item.bankSellValue)}.`
        : item.catalogId === 'silver-keepsake' ? `A collectible worth $${dollars(item.bankSellValue)} when sold to the bank.` : meta.description,
      quantity: 1,
      sellValue: dollars(item.bankSellValue), bankSellValue: dollars(item.bankSellValue),
      redeemValue: dollars(item.redeemValue), maturesRound: item.maturesRound ?? null,
      canUse: reason === null, canSell: saleReason === null, canTrade: false, canExchange: false,
      actionLabel: meta.actionLabel, useReason: reason, sellReason: saleReason
    };
  });
}

export const itemApi = {
  grantItem(player, catalogId, source = null) {
    if (!Object.hasOwn(ITEM_CATALOG, catalogId) || !player || player.bankrupt) return null;
    if (catalogId !== 'prison-key' && !this.settings?.itemRewards) return null;
    if (catalogId === 'prison-key') this.ensurePrisonItems(player);
    const item = newItem(this, catalogId, source);
    player.items ||= [];
    player.items.push(item);
    if (catalogId === 'prison-key') {
      player.jailFreeCards = dollars(player.jailFreeCards) + 1;
      if (['surprise', 'treasure'].includes(source)) {
        player.jailFreeOrigins = [...(player.jailFreeOrigins || []), source].slice(-player.jailFreeCards);
      }
    }
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
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return failure('Invalid item request.');
    const { itemId } = payload;
    const requestId = normalizeRequestId(payload.requestId);
    if (typeof itemId !== 'string' || !itemId || itemId.length > 100 || !requestId) return failure('Item and request IDs are required.');
    this.itemTransactions ||= new Map();
    const replayKey = JSON.stringify([player.id, requestId]);
    const prior = this.itemTransactions.get(replayKey);
    if (prior) return prior.action === action && prior.itemId === itemId
      ? { ...prior.result, duplicate: true } : failure('This request ID was already used for another item action.');
    this.ensurePrisonItems(player);
    const item = inventory(player).find(entry => entry.itemId === itemId);
    if (!item) return failure('You do not own this item.');
    const reason = action === 'use' ? useReason(this, player, item) : sellReason(this, player, item);
    if (reason) return failure(reason);
    let cashReceived = 0;
    if (item.catalogId === 'prison-key' && action === 'use') {
      const result = this.useJailFree(socketId, itemId);
      if (!result.success) return result;
    } else {
      cashReceived = action === 'sell' ? dollars(item.bankSellValue) : dollars(item.redeemValue);
      if (item.catalogId === 'prison-key') this.consumePrisonItem(player, itemId);
      else player.items = player.items.filter(entry => entry.itemId !== itemId);
    }
    const result = { success: true, action, itemId, cashReceived };
    // Remember and consume before crediting: collecting debt can reenter exit code.
    this.itemTransactions.set(replayKey, { action, itemId, result });
    if (cashReceived > 0) {
      player.cash += cashReceived;
      this.feedMessage(`${player.nickname} ${action === 'sell' ? 'sold' : 'redeemed'} ${ITEM_CATALOG[item.catalogId].name} for $${cashReceived}.`);
      if (this.pendingPayment?.playerId === player.id) this.trySettlePendingPayment();
    }
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
