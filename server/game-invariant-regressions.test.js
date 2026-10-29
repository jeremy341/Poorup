import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { processContracts } from './contractLogic.js';
import * as marketExpansion from './marketExpansion.js';
import * as socketRuntime from './socketRuntime.js';

const failures = [];
function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

function startedRoom(options = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: 'a', clientId: 'a', nickname: 'A', ...options });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

check('new hybrids are rejected even with an active legacy share on the deed', () => {
  const room = startedRoom({ rulesetOverrides: { bankLoans: true, casino: true, market: true, globalEvents: true } });
  const lender = room.game.players[0];
  const borrower = room.game.players[1];
  const property = room.game.getTile(1);
  property.ownerId = borrower.id;
  borrower.properties = [property.index];
  room.game.playerContracts.push({
    id: 'existing-hybrid', kind: 'hybrid', status: 'active', fromPlayerId: lender.id, toPlayerId: borrower.id,
    propertyIndex: property.index, conversionShare: 60
  });
  const result = room.proposePlayerContract('a', {
    toPlayerId: borrower.id, kind: 'hybrid', amount: 50, propertyIndex: property.index, conversionShare: 50
  });
  assert.deepEqual(result, { success: false, error: 'Hybrid contracts are no longer available; choose a loan or a temporary rent share.' });
});

check('failed hybrid conversion records the unpaid principal for an explicit default path', () => {
  const room = startedRoom({ rulesetOverrides: { bankLoans: true, casino: true, market: true, globalEvents: true } });
  const lender = room.game.players[0];
  const borrower = room.game.players[1];
  const contract = {
    id: 'hybrid-default', kind: 'hybrid', status: 'due', fromPlayerId: lender.id, toPlayerId: borrower.id,
    amount: 250, remaining: 275, totalDue: 275, propertyIndex: 1, conversionShare: 30,
    cureRound: room.game.roundNumber - 1, dueRound: room.game.roundNumber - 2
  };
  room.game.playerContracts.push(contract);
  const property = room.game.getTile(1);
  property.ownerId = borrower.id;
  borrower.properties = [property.index];
  property.houseCount = 1;
  processContracts(room.game);
  assert.equal(contract.status, 'defaulted');
  assert.equal(contract.defaultedPrincipal, 275);
  assert.equal(contract.defaultReason, 'conversion-unavailable');
});

check('legacy debt setting still eliminates the debtor and crowns the solvent player', () => {
  const room = startedRoom({ rulesetOverrides: { bankLoans: true, casino: true, market: true, globalEvents: true } });
  room.game.settings.bankruptMode = 'debt';
  const debtor = room.game.players[0];
  const creditor = room.game.players[1];
  room.game.currentPlayerId = debtor.id;
  room.game.pendingPayment = { playerId: debtor.id, creditorId: creditor.id, amountRemaining: 500, reason: 'rent' };
  const result = room.declareBankruptcy('a');
  assert.equal(result.success, true);
  assert.equal(room.game.started, false);
  assert.equal(room.game.lastWinner?.id, creditor.id);
  assert.equal(debtor.bankrupt, true);
  assert.equal(debtor.inDebt, false);
});

check('AFK expiry settles or concludes an active payment instead of forgiving it', () => {
  const room = startedRoom({ rulesetOverrides: { bankLoans: true, casino: true, market: true, globalEvents: true } });
  const debtor = room.game.players[0];
  const creditor = room.game.players[1];
  debtor.cash = 0;
  room.game.pendingPayment = { playerId: debtor.id, creditorId: creditor.id, amountRemaining: 500, reason: 'rent' };
  assert.equal(typeof socketRuntime.settleAfkPayment, 'function');
  socketRuntime.settleAfkPayment(room.game, debtor);
  assert.equal(room.game.pendingPayment, null);
  assert.equal(debtor.bankrupt || debtor.inDebt, true);
  assert.equal(debtor.cash < 0, false);
});

check('short default debt has a deterministic settlement path without negative cash', () => {
  const game = { marketShortInventory: {}, feedMessage() {} };
  const player = { cash: 10, shortDefaultDebt: 154 };
  assert.equal(typeof marketExpansion.settleShortDefault, 'function');
  const result = marketExpansion.settleShortDefault(game, player);
  assert.equal(result.success, true);
  assert.equal(result.paid, 10);
  assert.equal(result.remaining, 144);
  assert.equal(player.cash, 0);
  assert.equal(player.shortDefaultDebt, 144);
});

check('client-priced options fail closed without mutating the player or reserve', () => {
  const room = startedRoom({ rulesetOverrides: { bankLoans: true, casino: true, market: true, globalEvents: true }, marketComplexity: 'derivatives' });
  const player = room.game.players[0];
  const before = JSON.stringify({ cash: player.cash, options: player.optionPositions, reserve: room.game.marketOptionReserve });
  const result = room.openOption('a', { instrumentId: 'brazil', quantity: 1, side: 'call', strike: 1, premium: 1, requestId: 'tamper' });
  assert.deepEqual(result, { success: false, error: 'OPTION_TERMS_SERVER_REQUIRED' });
  assert.equal(JSON.stringify({ cash: player.cash, options: player.optionPositions, reserve: room.game.marketOptionReserve }), before);
});

check('same-round option exercise fails closed without changing the option', () => {
  const room = startedRoom({ rulesetOverrides: { bankLoans: true, casino: true, market: true, globalEvents: true }, marketComplexity: 'derivatives' });
  const player = room.game.players[0];
  const option = { id: 'option-same-round', role: 'buyer', side: 'call', quantity: 1, strike: 80, reserveHeld: 100, status: 'open', createdRound: room.game.roundNumber, expiryRound: room.game.roundNumber + 3, instrumentId: 'brazil' };
  player.optionPositions = [option];
  room.game.marketQuotes.brazil = 140;
  const before = JSON.stringify({ cash: player.cash, option });
  const result = room.exerciseOption('a', option.id, 'same-round');
  assert.deepEqual(result, { success: false, error: 'OPTION_TERMS_SERVER_REQUIRED' });
  assert.equal(JSON.stringify({ cash: player.cash, option }), before);
});

check('parked debt marks the debtor in debt until the claim clears', () => {
  const room = startedRoom();
  const game = room.game;
  const [debtor, creditor] = game.players;
  debtor.cash = 0;
  game.openDebtSettlement({ player: debtor, creditor, amount: 200, message: 'rent' });
  assert.equal(game.pendingPayment?.playerId, debtor.id);
  assert.equal(debtor.inDebt, true, 'a parked debt marks the debtor in debt');
  assert.equal(game.isSolventSeat(debtor), false);
  game.endGame();
  assert.equal(game.lastWinner?.id, creditor.id, 'the winner skips a parked debtor');
  assert.equal(debtor.inDebt, false, 'ending the table clears the claim flag');
});

check('queued debts keep inDebt in lockstep through promotion and clearing', () => {
  const room = startedRoom();
  const game = room.game;
  const [a, b] = game.players;
  a.cash = 0;
  b.cash = 0;
  game.openDebtSettlement({ player: a, creditor: null, amount: 100, message: 'bank' });
  game.openDebtSettlement({ player: b, creditor: null, amount: 50, message: 'bank' });
  assert.equal(a.inDebt, true);
  assert.equal(b.inDebt, true);
  assert.equal(game.pendingPayment.playerId, a.id);
  assert.equal(game.pendingPaymentQueue.length, 1);
  game.clearPendingPayment();
  assert.equal(game.pendingPayment.playerId, b.id);
  assert.equal(a.inDebt, false, 'clearing the head claim clears the debtor flag');
  assert.equal(b.inDebt, true, 'the promoted claim keeps its debtor flagged');
  game.clearPendingPayment();
  assert.equal(b.inDebt, false);
});

check('roll and end gates see queued debt, not just the head claim', () => {
  const room = startedRoom();
  const game = room.game;
  const [a, b] = game.players;
  game.pendingPayment = { playerId: b.id, creditorId: null, amountRemaining: 50, reason: 'rent' };
  game.pendingPaymentQueue = [{ payment: { playerId: a.id, creditorId: null, amountRemaining: 75, reason: 'rent' }, hooks: {}, turnOptions: {} }];
  assert.equal(game.rollTurnRejection(a)?.error, 'Settle your debt before rolling.');
  assert.equal(game.pendingFlowError(a), 'Settle your debt before ending the turn.');
});

check('the active roller debt is promoted ahead of another payer claim', () => {
  const room = startedRoom();
  const game = room.game;
  const [a, b] = game.players;
  b.cash = 0;
  game.openDebtSettlement({ player: b, creditor: null, amount: 50, message: 'bank' });
  assert.equal(game.pendingPayment.playerId, b.id);
  a.cash = 0;
  game.openDebtSettlement({ player: a, creditor: null, amount: 75, message: 'tax' });
  assert.equal(game.pendingPayment.playerId, a.id, 'the active roller claim takes the head');
  assert.equal(game.pendingPaymentQueue.length, 1);
  assert.equal(game.pendingPaymentQueue[0].payment.playerId, b.id, 'the displaced claim waits in the queue');
  assert.equal(a.inDebt, true);
  assert.equal(b.inDebt, true);
});

check('a parked equity rent is collected once when its share holder owes it', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: 'eq-a', clientId: 'eq-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'eq-b', clientId: 'eq-b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'eq-c', clientId: 'eq-c', nickname: 'C' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [owner, holder, other] = game.players;
  game.currentPlayerId = holder.id;
  const property = game.getTile(1);
  property.ownerId = owner.id;
  owner.properties.push(property.index);
  const contractFor = (id, holderId) => {
    const contract = {
      id, kind: 'equity', fromPlayerId: holderId, toPlayerId: owner.id, amount: 100,
      propertyIndex: property.index, equityShare: 50, equityControl: 'passive',
      permanent: false, expiresRound: game.roundNumber + 5, durationRounds: 3,
      createdRound: game.roundNumber, status: 'active'
    };
    game.playerContracts.push(contract);
    return contract;
  };
  contractFor('equity-rent-a', holder.id);
  contractFor('equity-rent-b', other.id);
  property.equityShares = [
    { holderId: holder.id, share: 50, contractId: 'equity-rent-a', control: 'passive' },
    { holderId: other.id, share: 50, contractId: 'equity-rent-b', control: 'passive' }
  ];
  owner.cash = 200;
  holder.cash = 60;
  other.cash = 100;
  // The gross rent the deed collected, counted at the one place every rent
  // credit passes through.
  let rentCreditedToOwner = 0;
  const creditRentTo = game.creditRentTo.bind(game);
  game.creditRentTo = (creditor, payer, amount) => {
    if (creditor?.id === owner.id) rentCreditedToOwner += amount;
    creditRentTo(creditor, payer, amount);
  };
  const equityPaidAmounts = [];
  const settleEquityShares = game.settleEquityShares.bind(game);
  game.settleEquityShares = (...args) => {
    equityPaidAmounts.push(args[2]);
    return settleEquityShares(...args);
  };
  // The holder lands on the deed and cannot cover the rent: the shortfall
  // parks as an equity rent claim, and the rent share is paid on the spot.
  game.chargePlayer({
    player: holder, creditor: owner, amount: 100, message: 'holder paid rent', turnOptions: {},
    hooks: {
      onPaid: paid => game.settleEquityShares(property, owner, paid, holder),
      equityTileIndex: property.index,
      equityOwnerId: owner.id
    }
  });
  assert.equal(game.pendingPayment?.playerId, holder.id, 'the equity rent claim is parked');
  assert.equal(game.pendingPayment?.amountRemaining, 40, 'the shortfall is what is still owed');
  holder.cash = 60;
  game.trySettlePendingPayment();
  assert.equal(game.pendingPayment, null, 'the parked claim is settled');
  assert.deepEqual(equityPaidAmounts, [60, 40], 'each original and remaining rent amount settles once');
  assert.equal(rentCreditedToOwner, 100, 'the rent was collected exactly once');
  assert.equal(holder.cash, 40, 'the holder paid the rent once and kept its own half');
  assert.equal(other.cash, 150, 'the other holder was paid its half of the rent once');
  assert.equal(owner.cash, 200, 'the deed paid the rent out exactly once');
});

check('final net-worth snapshot is taken after pending-debt cleanup', () => {
  const room = startedRoom();
  const game = room.game;
  const [a, b] = game.players;
  a.cash = 250;
  game.pendingPayment = { playerId: a.id, creditorId: b.id, amountRemaining: 900, reason: 'rent' };
  game.endGame(b);
  const last = game.netWorthTimeline[game.netWorthTimeline.length - 1];
  assert.equal(last.worth[a.id], 250, 'the final row reflects ending cash, not a cleared claim');
});

check('rent credited to a funded pending debtor collects the claim exactly once', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: 'rent-a', clientId: 'rent-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'rent-b', clientId: 'rent-b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'rent-c', clientId: 'rent-c', nickname: 'C' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [debtor, , visitor] = game.players;
  const deed = game.getTile(1);
  deed.ownerId = debtor.id;
  deed.houseCount = 3;
  debtor.properties = [deed.index];
  debtor.cash = 0;
  debtor.disconnected = true;
  const paidAmounts = [];
  game.openDebtSettlement({
    player: debtor,
    creditor: null,
    amount: 60,
    message: 'rent',
    hooks: { onPaid: amount => paidAmounts.push(amount) }
  });
  game.currentPlayerId = visitor.id;
  game.hasRolled = true;
  game.applyTile(visitor, deed, { allowExtraRoll: false });
  assert.equal(game.pendingPayment, null, 'rent makes the head claim payable and clears it');
  assert.deepEqual(paidAmounts, [60], 'the payment hook runs once for the original claim amount');
  assert.ok(debtor.cash > 0, 'the debtor retains rent left after collection');
  assert.equal(debtor.bankrupt, false, 'a funded disconnected debtor pays without losing reconnect grace');
});

check('partial rent credit does not bankrupt an underfunded disconnected debtor', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: 'grace-a', clientId: 'grace-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'grace-b', clientId: 'grace-b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'grace-c', clientId: 'grace-c', nickname: 'C' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [debtor, , visitor] = game.players;
  const deed = game.getTile(1);
  deed.ownerId = debtor.id;
  deed.houseCount = 0;
  debtor.properties = [deed.index];
  debtor.cash = 0;
  debtor.disconnected = true;
  game.openDebtSettlement({ player: debtor, creditor: null, amount: 100, message: 'test debt', hooks: {} });
  game.currentPlayerId = visitor.id;
  game.hasRolled = true;

  game.applyTile(visitor, deed, { allowExtraRoll: false });

  assert.equal(game.pendingPayment?.playerId, debtor.id, 'the original claim stays open during reconnect grace');
  assert.equal(game.pendingPayment?.amountRemaining, 100);
  assert.equal(debtor.cash, 10, 'the small rent credit remains available for a rescue path');
  assert.equal(debtor.bankrupt, false);
  assert.equal(debtor.inDebt, true);
  assert.equal(game.getPlayerById(debtor.id), debtor, 'the disconnected seat remains in the room');
  assert.equal(deed.ownerId, debtor.id, 'the debtor retains the deed while reconnect grace is active');
});

check('rent-funded queued debtor auto-collects when promoted without replaying hooks', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: 'queue-a', clientId: 'queue-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'queue-b', clientId: 'queue-b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'queue-c', clientId: 'queue-c', nickname: 'C' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [head, queued, visitor] = game.players;
  const headDeed = game.getTile(1);
  const queuedDeed = game.getTile(3);
  const mortgageDeed = game.getTile(5);
  for (const [player, tile, houses] of [[head, headDeed, 3], [queued, queuedDeed, 3], [head, mortgageDeed, 0]]) {
    tile.ownerId = player.id;
    tile.houseCount = houses;
    if (!player.properties.includes(tile.index)) player.properties.push(tile.index);
  }
  head.cash = 0;
  queued.cash = 0;
  const hooks = { head: [], queued: [] };
  game.openDebtSettlement({ player: head, creditor: null, amount: 60, message: 'head debt', hooks: { onPaid: amount => hooks.head.push(amount) } });
  game.openDebtSettlement({ player: queued, creditor: null, amount: 60, message: 'queued debt', hooks: { onPaid: amount => hooks.queued.push(amount) } });

  game.currentPlayerId = visitor.id;
  game.hasRolled = true;
  game.applyTile(visitor, queuedDeed, { allowExtraRoll: false });
  assert.ok(queued.cash >= 60, 'the queued debtor has enough rent to pay');
  assert.equal(game.pendingPayment.playerId, head.id, 'the original head remains first in queue order');
  assert.equal(game.pendingPaymentQueue[0].payment.playerId, queued.id);

  const mortgage = room.manageProperty(head.socketId, { tileIndex: mortgageDeed.index, action: 'mortgage' });
  assert.equal(mortgage.success, true, mortgage.error);
  assert.equal(game.pendingPayment, null, 'the funded promoted head clears immediately');
  assert.deepEqual(hooks, { head: [60], queued: [60] }, 'each claim hook runs exactly once');
  assert.equal(queued.inDebt, false);
});

check('a rematch does not answer a reused vote request id from the previous match cache', () => {
  const room = startedRoom({ rulesetOverrides: { globalEvents: true } });
  const game = room.game;
  game.globalEventVoteTransactions = new Map([['stale-key', { success: true }]]);
  game.resetForNewGame();
  assert.equal(game.globalEventVoteTransactions, null);
});

check('a seat reset clears the short opening fees', () => {
  const room = startedRoom();
  const player = room.game.players[0];
  player.shortOpeningFees = { brazil: 12 };
  player.resetTableState();
  assert.deepEqual(player.shortOpeningFees, {});
});

check('the published global event omits the internal settlement latch', () => {
  const room = startedRoom({ rulesetOverrides: { globalEvents: true } });
  const game = room.game;
  game.globalEvent = { id: 'debt-amnesty', phase: 'active', votes: {}, settlementApplied: true };
  assert.equal('settlementApplied' in game.summaryGlobalEvent(), false);
  assert.equal(game.globalEvent.settlementApplied, true, 'the internal state is untouched');
});

if (failures.length) {
  console.log(`\ngame invariant regressions: ${failures.length} failed`);
  process.exit(1);
}
console.log('\ngame invariant regressions: all passed');
