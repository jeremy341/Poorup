import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoomManager } from './gameLogic.js';
import { processContracts } from './contractLogic.js';
import { SeasonStore } from './seasonModule.js';
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
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', ...options });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

check('hybrid share capacity counts active contracts not yet materialized on the deed', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
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
  assert.deepEqual(result, { success: false, error: 'That property has no remaining equity to sell.' });
});

check('failed hybrid conversion records the unpaid principal for an explicit default path', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
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

check('legacy debt-mode bankruptcy concludes a two-player round and crowns the solvent player', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
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
  assert.equal(debtor.spectating, true);
});

check('AFK expiry settles or concludes an active payment instead of forgiving it', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
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
  const room = startedRoom({ rulesetPreset: 'after-hours', marketComplexity: 'derivatives' });
  const player = room.game.players[0];
  const before = JSON.stringify({ cash: player.cash, options: player.optionPositions, reserve: room.game.marketOptionReserve });
  const result = room.openOption('a', { instrumentId: 'brazil', quantity: 1, side: 'call', strike: 1, premium: 1, requestId: 'tamper' });
  assert.deepEqual(result, { success: false, error: 'OPTION_TERMS_SERVER_REQUIRED' });
  assert.equal(JSON.stringify({ cash: player.cash, options: player.optionPositions, reserve: room.game.marketOptionReserve }), before);
});

check('same-round option exercise fails closed without changing the option', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours', marketComplexity: 'derivatives' });
  const player = room.game.players[0];
  const option = { id: 'option-same-round', role: 'buyer', side: 'call', quantity: 1, strike: 80, reserveHeld: 100, status: 'open', createdRound: room.game.roundNumber, expiryRound: room.game.roundNumber + 3, instrumentId: 'brazil' };
  player.optionPositions = [option];
  room.game.marketQuotes.brazil = 140;
  const before = JSON.stringify({ cash: player.cash, option });
  const result = room.exerciseOption('a', option.id, 'same-round');
  assert.deepEqual(result, { success: false, error: 'OPTION_TERMS_SERVER_REQUIRED' });
  assert.equal(JSON.stringify({ cash: player.cash, option }), before);
});

check('season placement exposes top-fraction direction so the last player cannot claim top reward', () => {
  const store = new SeasonStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-season-rank-')), 'seasons.json'));
  const season = store.seasons.get(store.getCurrent().id);
  season.standings = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`acct-${index}`, { games: 1, points: 100 - index }]));
  const rows = store.standings({ seasonId: season.id, metric: 'points' }).rows;
  const last = rows.at(-1);
  assert.equal(last.rank, 100);
  assert.equal(last.placementRank, 100);
  assert.equal(last.topFraction, 0.99);
  assert.equal(store.rewardEligible(last, { track: 'placement', threshold: 0.01 }, rows.length), false);
});

if (failures.length) {
  console.log(`\ngame invariant regressions: ${failures.length} failed`);
  process.exit(1);
}
console.log('\ngame invariant regressions: all passed');
