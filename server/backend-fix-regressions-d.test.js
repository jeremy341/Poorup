// Regression suite for the second backend audit pass (B-05, B-06, B-07, B-09).
// Every check pins one verified defect: a voluntary leave that froze the bank
// loan on a dead seat, a disconnected ghost seat that could take 1st place in
// the season projection, a single match that could sweep all four placement
// rewards, and a board-variant downgrade that started an over-capacity table.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoomManager } from './gameLogic.js';
import { AccountStore } from './accountStore.js';
import { SeasonStore } from './seasonModule.js';

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

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function startedThreeSeatRoom(options = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', ...options });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'c', clientId: 'c', nickname: 'C' });
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return { manager, room };
}

check('a voluntary leave settles the bank loan on the dead seat (B-05)', () => {
  // advanceBankLoan skips bankrupt players, so a leave that only ran the old
  // ladder froze the loan at active/remaining forever: the departed seat kept
  // the principal and never paid (or lost) the premium.
  const { manager, room } = startedThreeSeatRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const leaver = game.players[0];
  const tile = game.getTile(1);
  tile.ownerId = leaver.id;
  tile.houseCount = 2;
  leaver.properties = [tile.index];
  leaver.bankLoan = { status: 'active', remaining: 450, collateralTileIndex: tile.index };
  assert.equal(manager.removeRoomSeat({ clientId: 'a', reason: 'leave' }).success, true);
  assert.equal(leaver.bankLoan.status, 'defaulted', 'the loan must be settled on the way out');
  assert.equal(leaver.bankLoan.remaining, 0);
  assert.equal(tile.ownerId, null, 'secured collateral is seized by the bank, not abandoned');
  assert.equal(tile.houseCount, 0);
  assert.equal(leaver.properties.includes(tile.index), false);
});

check('an unsecured loan the leaver cannot pledge is written off, not frozen (B-05)', () => {
  const { manager, room } = startedThreeSeatRoom({ rulesetPreset: 'after-hours' });
  const leaver = room.game.players[0];
  leaver.bankLoan = { status: 'due', remaining: 500, collateralTileIndex: null };
  assert.equal(manager.removeRoomSeat({ clientId: 'a', reason: 'leave' }).success, true);
  assert.equal(leaver.bankLoan.status, 'defaulted');
  assert.equal(leaver.bankLoan.remaining, 0);
});

check('a disconnected ghost seat cannot take 1st place (B-06)', () => {
  const dir = tempDir('poorup-ghost-placement-');
  const store = new AccountStore(path.join(dir, 'accounts.json'));
  ['ghost_rival', 'ghost_seat'].forEach(username => {
    assert.equal(store.register({ username, displayName: username, password: 'hunter2hunter2' }).success, true);
  });
  const rivalId = store.accounts.get('ghost_rival').id;
  const ghostId = store.accounts.get('ghost_seat').id;
  // A leaves the table; C disconnected holding the most cash; B is the seat the
  // game actually crowned as the last human standing.
  const record = store.recordGameResults([
    { id: 'p-b', accountId: rivalId, nickname: 'Rival', cash: 100, properties: [], bankrupt: false, disconnected: false },
    { id: 'p-c', accountId: ghostId, nickname: 'Ghost', cash: 5000, properties: [], bankrupt: false, disconnected: true }
  ], 'p-b', { gameId: 'match-ghost' });
  const byAccount = new Map(record.participants.map(participant => [participant.accountId, participant]));
  assert.equal(byAccount.get(rivalId).finalPlacement, 1, 'the crowned winner must hold 1st place');
  assert.equal(byAccount.get(ghostId).finalPlacement, 2, 'the ghost ranks behind every contested seat');
  assert.equal(byAccount.get(ghostId).disconnected, true, 'the ghost is still reported as a participant');
  assert.equal(byAccount.get(rivalId).endingCash, 100);
  assert.equal(byAccount.get(ghostId).endingCash, 5000, 'cash reporting is unchanged; only the ranking moves');
  assert.equal(store.accounts.get('ghost_rival').stats.wins, 1, 'stats.wins follows the same crowned seat');
  assert.equal(store.accounts.get('ghost_seat').stats.wins, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

check('bankrupt seats still rank after solvent ones once ghosts are excluded (B-06)', () => {
  const dir = tempDir('poorup-ghost-ordering-');
  const store = new AccountStore(path.join(dir, 'accounts.json'));
  ['order_solo', 'order_broke', 'order_ghost'].forEach(username => {
    assert.equal(store.register({ username, displayName: username, password: 'hunter2hunter2' }).success, true);
  });
  const record = store.recordGameResults([
    { id: 'p-ghost', accountId: store.accounts.get('order_ghost').id, cash: 9000, properties: [], bankrupt: false, disconnected: true },
    { id: 'p-broke', accountId: store.accounts.get('order_broke').id, cash: 50, properties: [], bankrupt: true, disconnected: false },
    { id: 'p-solo', accountId: store.accounts.get('order_solo').id, cash: 300, properties: [], bankrupt: false, disconnected: false }
  ], 'p-solo', { gameId: 'match-ordering' });
  const placementOf = username => record.participants
    .find(participant => participant.accountId === store.accounts.get(username).id).finalPlacement;
  assert.deepEqual(
    { ghost: placementOf('order_ghost'), broke: placementOf('order_broke'), solo: placementOf('order_solo') },
    { ghost: 3, broke: 2, solo: 1 },
    'bankrupt-last ordering survives, and the ghost cannot outrank a bankrupt table'
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

function seasonWithSingleMatch(prefix) {
  const dir = tempDir(prefix);
  const store = new SeasonStore(path.join(dir, 'seasons.json'), Date.UTC(2026, 0, 6));
  const accounts = Array.from({ length: 10 }, (_, index) => `acct-${index}`);
  const match = (matchId) => ({
    matchId,
    completedAt: new Date().toISOString(),
    participants: accounts.map((accountId, index) => ({
      accountId, finalPlacement: index + 1, globalEventsSurvived: 0, bankLoanStatus: null, fairTrades: 0
    }))
  });
  store.recordMatch(match('match-1'));
  return { dir, store, accounts, match };
}

check('one match cannot sweep bronze through top (B-07)', () => {
  const { dir, store, accounts, match } = seasonWithSingleMatch('poorup-season-sweep-');
  ['season-bronze', 'season-silver', 'season-gold', 'season-top'].forEach((rewardId) => {
    const claim = store.claimReward(accounts[0], rewardId);
    assert.equal(claim.success, false, `${rewardId} must stay locked after a single match`);
    assert.equal(claim.error, 'Season reward requirements are not met.');
  });
  assert.deepEqual(store.claimedRewards(accounts[0]), [], 'no placement reward is credited to a one-game winner');
  // The floor is a participation floor, not a rank gate: once the same account
  // records a second season match, the widest band is claimable again.
  store.recordMatch(match('match-2'));
  assert.equal(store.claimReward(accounts[0], 'season-bronze').success, true,
    'two recorded matches re-open the bronze band');
  fs.rmSync(dir, { recursive: true, force: true });
});

check('a board downgrade that would strand a seat is refused (B-09)', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({
    socketId: 'a', clientId: 'a', nickname: 'A', boardVariant: 'metro-52', rulesetPreset: 'after-hours'
  });
  assert.equal(room.setRoomSetting('maxPlayers', 6).rejected, false);
  ['b', 'c', 'd', 'e'].forEach(id => {
    assert.equal(room.addOrReconnectPlayer({ socketId: id, clientId: id, nickname: id.toUpperCase() }).success, true);
  });
  assert.equal(room.game.players.filter(player => !player.isBot).length, 5);
  // The same end state through the maxPlayers path, which already refuses it.
  const capacityError = 'Room capacity cannot be lower than the number of active players.';
  const capacityWrite = room.setRoomSetting('maxPlayers', 4);
  assert.equal(capacityWrite.rejected, true);
  assert.equal(capacityWrite.reason, capacityError);
  const downgrade = room.setRoomSetting('boardVariant', 'standard-40');
  assert.equal(downgrade.rejected, true, 'the downgrade must not silently shrink the table under 5 seats');
  assert.equal(downgrade.reason, capacityError, 'the board path reuses the maxPlayers capacity error');
  assert.equal(room.settings.boardVariant, 'metro-52', 'the rejected board is not written');
  assert.equal(room.settings.maxPlayers, 6, 'the clamp must not have run');
  assert.equal(room.game.boardVariant, 'metro-52');
  assert.equal(room.startGame().success, true);
  assert.equal(room.game.turnOrder.length, 5);
});

check('a board downgrade that still fits the table is allowed (B-09)', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({
    socketId: 'a', clientId: 'a', nickname: 'A', boardVariant: 'metro-52', rulesetPreset: 'after-hours'
  });
  assert.equal(room.setRoomSetting('maxPlayers', 6).rejected, false);
  ['b', 'c', 'd'].forEach(id => {
    assert.equal(room.addOrReconnectPlayer({ socketId: id, clientId: id, nickname: id.toUpperCase() }).success, true);
  });
  assert.equal(room.setRoomSetting('boardVariant', 'standard-40').rejected, false);
  assert.equal(room.settings.boardVariant, 'standard-40');
  assert.equal(room.settings.maxPlayers, 4, 'the clamp still runs once the board fits');
  assert.equal(room.game.boardVariant, 'standard-40');
  // ...and a metro upgrade is still accepted (the clamp is one-directional:
  // a bigger board never raises capacity on its own).
  assert.equal(room.setRoomSetting('boardVariant', 'metro-52').rejected, false);
  assert.equal(room.game.boardVariant, 'metro-52');
  assert.equal(room.settings.maxPlayers, 4);
});

if (failures.length) {
  console.error(`\nbackend audit regressions (pass 2): ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log('backend audit regressions (pass 2): all passed');
}
