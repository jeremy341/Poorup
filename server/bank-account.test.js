// Bank account tiers: the table rule, buying a tier, uncapped rebates on market
// and flight fees, request-id replay, and private projection.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { BANK_ACCOUNT_TIERS } from './bankAccountApi.js';

const failures = [];
function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.stack || error.message}`);
  }
}

function bankRoom(overrides = { bankAccountUpgrades: true, market: true, flights: true }) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', rulesProfile: 'advanced', rulesetOverrides: overrides });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  const [a, b] = room.game.players;
  room.game.currentPlayerId = a.id;
  a.cash = 1500;
  b.cash = 1500;
  return { room, game: room.game, a, b };
}

check('bank accounts are a table rule and default to off', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A' });
  assert.equal(room.settings.bankAccountUpgrades, false);
  assert.equal(room.getDirectorySummary().addOns.includes('bank accounts'), false);
  const on = manager.createRoom({ socketId: 'c', clientId: 'c', nickname: 'C', rulesProfile: 'advanced', rulesetOverrides: { bankAccountUpgrades: true } });
  assert.equal(on.settings.bankAccountUpgrades, true);
  assert.equal(on.getDirectorySummary().addOns.includes('bank accounts'), true);
});

check('upgrading charges the tier price and moves one tier up', () => {
  const { game, a } = bankRoom();
  const first = game.upgradeBankAccount('a', 'req-1');
  assert.equal(first.success, true);
  assert.equal(first.tier, 2);
  assert.equal(a.cash, 1500 - BANK_ACCOUNT_TIERS[1].cost);
  const second = game.upgradeBankAccount('a', 'req-2');
  assert.equal(second.tier, 3);
  assert.equal(a.cash, 1500 - BANK_ACCOUNT_TIERS[1].cost - BANK_ACCOUNT_TIERS[2].cost);
  assert.match(game.upgradeBankAccount('a', 'req-3').error, /top tier/);
});

check('a repeated request id never buys a second tier', () => {
  const { game, a } = bankRoom();
  assert.equal(game.upgradeBankAccount('a', 'same').tier, 2);
  const replay = game.upgradeBankAccount('a', 'same');
  assert.equal(replay.success, true);
  assert.equal(replay.duplicate, true);
  assert.equal(game.bankAccountOf(a).tier, 2);
  assert.equal(a.cash, 1500 - BANK_ACCOUNT_TIERS[1].cost);
});

check('an upgrade is refused when the rule is off, the cash is short, or cash is committed to a bid', () => {
  const off = bankRoom({});
  assert.match(off.game.upgradeBankAccount('a', 'x').error, /off at this table/);

  const poor = bankRoom();
  poor.a.cash = 199;
  assert.match(poor.game.upgradeBankAccount('a', 'x').error, /need \$200/);
  assert.equal(poor.game.bankAccountOf(poor.a).tier, 1);

  const bidding = bankRoom();
  bidding.game.auction = { active: true, highestBidderId: bidding.a.id, highestBid: 1400 };
  assert.match(bidding.game.upgradeBankAccount('a', 'x').error, /need \$200/);
  assert.equal(bidding.a.cash, 1500, 'cash behind a leading bid is not spent');

  const broke = bankRoom();
  broke.a.bankrupt = true;
  assert.match(broke.game.upgradeBankAccount('a', 'x').error, /Bankrupt/);
});

check('a market order pays a rebate on its fee by tier, and the standard tier pays none', () => {
  const standard = bankRoom();
  const before = standard.a.cash;
  assert.equal(standard.game.tradeMarket('a', 'brazil', 'buy', 10, 'o1').success, true);
  const fee = Math.ceil(10 * standard.game.marketQuotes.brazil * 0.02);
  assert.equal(standard.a.cash, before - 10 * standard.game.marketQuotes.brazil - fee, 'no rebate on Standard');

  const premium = bankRoom();
  premium.game.upgradeBankAccount('a', 'u');
  const cash = premium.a.cash;
  assert.equal(premium.game.tradeMarket('a', 'brazil', 'buy', 10, 'o1').success, true);
  const premiumFee = Math.ceil(10 * premium.game.marketQuotes.brazil * 0.02);
  const rebate = Math.floor(premiumFee * 0.10);
  assert.ok(rebate >= 1);
  assert.equal(premium.a.cash, cash - 10 * premium.game.marketQuotes.brazil - premiumFee + rebate);
  assert.equal(premium.game.bankAccountOf(premium.a).cashbackEarned, rebate);
  assert.equal(premium.game.bankAccountOf(premium.a).ledger[0].label, 'MARKET FEE CASHBACK');
});

check('rebates have no cap: every fee earns its share, and the totals add up', () => {
  const { game, a } = bankRoom();
  game.upgradeBankAccount('a', 'u');
  assert.equal(game.creditBankCashback(a, 1000, 'TEST'), 100, 'ten percent of a large fee');
  assert.equal(game.creditBankCashback(a, 1000, 'TEST'), 100, 'still paid after earlier rebates');
  assert.equal(game.creditBankCashback(a, 5, 'TEST'), 0, 'a share that rounds to nothing pays nothing');
  assert.equal(game.bankAccountOf(a).cashbackEarned, 200);
  game.upgradeBankAccount('a', 'u2');
  assert.equal(game.creditBankCashback(a, 1000, 'TEST'), 200, 'the top tier pays twenty percent');
});

check('a flight fare earns a rebate, and the rule off earns nothing', () => {
  const { game, a } = bankRoom();
  game.upgradeBankAccount('a', 'u');
  a.position = 5;
  a.cash = 1000;
  const result = game.flyToAirport('a', 15);
  assert.equal(result.success, true);
  assert.equal(a.cash, 1000 - result.fare + Math.floor(result.fare * 0.10));

  const off = bankRoom({ flights: true });
  off.a.position = 5;
  off.a.cash = 1000;
  const offResult = off.game.flyToAirport('a', 15);
  assert.equal(off.a.cash, 1000 - offResult.fare, 'no rebate when bank accounts are off');
});

check('the account and its ledger are private, and the summary reports what can be bought', () => {
  const { game, a, b } = bankRoom();
  const mine = game.getGameSummary(a.id).players.find(entry => entry.id === a.id);
  assert.equal(mine.bankAccount.tier, 1);
  assert.equal(mine.bankAccount.nextTier.cost, 200);
  assert.equal(mine.bankAccount.nextTier.available, true);
  assert.equal(mine.bankAccount.cashbackEarned, 0);
  assert.equal('cashbackLimit' in mine.bankAccount, false, 'there is no cap to report');
  const theirs = game.getGameSummary(b.id).players.find(entry => entry.id === a.id);
  assert.equal(theirs.bankAccount, undefined, 'opponents never see the account');
  a.cash = 100;
  const poor = game.getGameSummary(a.id).players.find(entry => entry.id === a.id).bankAccount.nextTier;
  assert.equal(poor.available, false);
  assert.match(poor.reason, /Need \$100 more/);
  const off = bankRoom({});
  const offMine = off.game.getGameSummary(off.a.id).players.find(entry => entry.id === off.a.id);
  assert.equal(offMine.bankAccount, undefined, 'nothing is sent when the rule is off');
});

check('the projection mirrors the refusals of the upgrade action', () => {
  const { game, a } = bankRoom();
  game.pendingPayment = { playerId: a.id, creditorId: null, amountRemaining: 100, reason: 'rent' };
  const owed = game.getGameSummary(a.id).players.find(entry => entry.id === a.id).bankAccount.nextTier;
  assert.equal(owed.available, false, 'the wallet must not advertise a tier the upgrade refuses');
  assert.match(owed.reason, /pending payment/);
  assert.match(game.upgradeBankAccount('a', 'owed-1').error, /pending payment/);

  game.pendingPayment = null;
  game.pendingPaymentQueue = [{ payment: { playerId: a.id, creditorId: null, amountRemaining: 50, reason: 'rent' }, hooks: {}, turnOptions: {} }];
  const queued = game.getGameSummary(a.id).players.find(entry => entry.id === a.id).bankAccount.nextTier;
  assert.equal(queued.available, false, 'a queued claim blocks the upgrade too');
  assert.match(queued.reason, /pending payment/);
  assert.match(game.upgradeBankAccount('a', 'owed-2').error, /pending payment/);
});

check('the projection reports a table that has not started', () => {
  const { game, a } = bankRoom();
  game.started = false;
  const next = game.getGameSummary(a.id).players.find(entry => entry.id === a.id).bankAccount.nextTier;
  assert.equal(next.available, false);
  assert.match(next.reason, /not started/);
  assert.match(game.upgradeBankAccount('a', 'unstarted-1').error, /not started/);
});

if (failures.length) {
  console.log(`bank accounts: ${failures.length} failed`);
  process.exit(1);
}
console.log('bank accounts: all passed');
