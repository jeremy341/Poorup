// Bank account tiers: an optional table rule (bankAccountUpgrades, off by default).
// A player buys the next tier with spendable cash. A tier rebates a share of the fees paid on optional
// services (market orders and flights). There is no cap, so rates stay low. Rent, taxes, loans, wagers and upgrades never rebate.
import { normalizeRequestId } from './requestId.js';

export const BANK_ACCOUNT_TIERS = Object.freeze([
  Object.freeze({ tier: 1, name: 'STANDARD', cost: 0, rebatePct: 0, saleFeePct: 10 }),
  Object.freeze({ tier: 2, name: 'PARLOR PREMIUM', cost: 200, rebatePct: 10, saleFeePct: 5 }),
  Object.freeze({ tier: 3, name: 'PARLOR BLACK', cost: 500, rebatePct: 20, saleFeePct: 0 })
]);

const LEDGER_LIMIT = 20;
const REQUEST_MEMORY = 12;

function tierInfo(tier) {
  return BANK_ACCOUNT_TIERS.find(entry => entry.tier === tier) || BANK_ACCOUNT_TIERS[0];
}

// The bank's fee on an item sold to it, by the seat's tier. With the table rule off there is no fee:
// the seat keeps the full value. The fee is floor(value * pct / 100) and the seat receives the rest.
export function bankSaleQuote(game, player, value) {
  const gross = Math.max(0, Math.floor(Number(value) || 0));
  if (!game.bankAccountsEnabled()) return { gross, feePct: 0, fee: 0, net: gross };
  const feePct = tierInfo(game.bankAccountOf(player).tier).saleFeePct;
  const fee = Math.floor((gross * feePct) / 100);
  return { gross, feePct, fee, net: gross - fee };
}

function upgradeRefusal(game, player) {
  if (!player) return { success: false, error: 'Player not found.' };
  if (!game.started) return { success: false, error: 'Game has not started.' };
  if (!game.bankAccountsEnabled()) return { success: false, error: 'Bank accounts are off at this table.' };
  if (player.bankrupt) return { success: false, error: 'Bankrupt players cannot upgrade.' };
  return null;
}

function rememberUpgradeRequest(account, key) {
  account.requests.push(key);
  if (account.requests.length > REQUEST_MEMORY) account.requests.shift();
}

export const bankAccountApi = {
  bankAccountsEnabled() {
    return Boolean(this.settings?.bankAccountUpgrades);
  },

  bankAccountOf(player) {
    if (!player.bankAccount || typeof player.bankAccount !== 'object') {
      player.bankAccount = { tier: 1, cashbackEarned: 0, ledger: [], requests: [] };
    }
    return player.bankAccount;
  },

  bankAccountEntry(player, label, amount) {
    const account = this.bankAccountOf(player);
    account.ledger.unshift({ label, amount, round: this.roundNumber || 0 });
    account.ledger.length = Math.min(account.ledger.length, LEDGER_LIMIT);
  },

  // An unpaid debt comes first, exactly like the market and the casino: the
  // head claim or any queued one.
  bankAccountOwesDebt(player) {
    return this.pendingPayment?.playerId === player.id
      || (this.pendingPaymentQueue || []).some(entry => entry?.payment?.playerId === player.id);
  },

  // The owner's private view of their account, as the wallet renders it.
  bankAccountProjection(player) {
    const account = this.bankAccountOf(player);
    const enabled = this.bankAccountsEnabled();
    const current = tierInfo(account.tier);
    const next = BANK_ACCOUNT_TIERS.find(entry => entry.tier === current.tier + 1) || null;
    let nextTier = null;
    if (next) {
      const spendable = this.spendableCash(player);
      let reason = null;
      // The projection mirrors the action's refusals in the same order, so the
      // wallet never advertises a tier the upgrade would refuse.
      if (!this.started) reason = 'Game has not started.';
      else if (!enabled) reason = 'Bank accounts are off at this table.';
      else if (player.bankrupt) reason = 'Bankrupt players cannot upgrade.';
      else if (this.bankAccountOwesDebt(player)) reason = 'Settle your pending payment before upgrading.';
      else if (spendable < next.cost) reason = `Need $${next.cost - spendable} more.`;
      nextTier = {
        tier: next.tier, name: next.name, cost: next.cost, rebatePct: next.rebatePct,
        available: reason === null, reason
      };
    }
    return {
      enabled,
      tier: current.tier,
      name: current.name,
      rebatePct: current.rebatePct,
      cashbackEarned: account.cashbackEarned,
      nextTier,
      ledger: account.ledger.slice(0, 5).map(entry => ({ ...entry }))
    };
  },

  upgradeBankAccount(socketId, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const refusal = upgradeRefusal(this, player);
    if (refusal) return refusal;
    const account = this.bankAccountOf(player);
    const key = normalizeRequestId(requestId) || null;
    // A repeated request id replays the first answer instead of buying a second tier.
    if (key && account.requests.includes(key)) return { success: true, duplicate: true, tier: account.tier };
    const next = BANK_ACCOUNT_TIERS.find(entry => entry.tier === account.tier + 1);
    if (!next) return { success: false, error: 'You already hold the top tier.' };
    // An unpaid debt comes first, exactly like the market and the casino.
    if (this.bankAccountOwesDebt(player)) return { success: false, error: 'Settle your pending payment before upgrading.' };
    if (this.spendableCash(player) < next.cost) return { success: false, error: `You need $${next.cost} to upgrade.` };
    player.cash -= next.cost;
    account.tier = next.tier;
    if (key) rememberUpgradeRequest(account, key);
    this.bankAccountEntry(player, `UPGRADE · ${next.name}`, -next.cost);
    this.feedMessage(`${player.nickname} upgraded to ${next.name}.`);
    return { success: true, tier: next.tier };
  },

  // Rebate a share of an optional-service fee the player just paid. Returns the
  // dollars credited (0 when the table rule is off, the tier has no rebate, or
  // the share rounds down to nothing).
  creditBankCashback(player, fee, label) {
    if (!this.bankAccountsEnabled() || !player || !(fee > 0)) return 0;
    const account = this.bankAccountOf(player);
    const tier = tierInfo(account.tier);
    if (!tier.rebatePct) return 0;
    const rebate = Math.floor((fee * tier.rebatePct) / 100);
    if (rebate <= 0) return 0;
    player.cash += rebate;
    account.cashbackEarned += rebate;
    this.bankAccountEntry(player, `${label} CASHBACK`, rebate);
    return rebate;
  }
};
