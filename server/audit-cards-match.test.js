// Audit fixes for card rent, card resolve, payEach total, hybrid sanitize.
// Style follows server/contracts-market.test.js check() pinning.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoomManager } from './gameLogic.js';
import { MatchStore } from './matchStore.js';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS - ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

function startedRoom(settings = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  for (const [key, value] of Object.entries(settings)) room.setRoomSetting(key, value);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  game.currentPlayerId = game.players[0].id;
  return { room, game, a: game.players[0], b: game.players[1] };
}

function flatTile() {
  return { mortgaged: false };
}

check('fix1 blocks bankrupt owner like tile rent', () => {
  const { game, a, b } = startedRoom();
  b.bankrupt = false;
  b.inJail = false;
  assert.equal(game.cardRentPayable(a, b, flatTile()), true);
  b.bankrupt = true;
  assert.equal(game.cardRentPayable(a, b, flatTile()), false);
});

check('fix1 blocks jailed owner only under noRentWhileInPrison', () => {
  const { game, a, b } = startedRoom();
  b.bankrupt = false;
  b.inJail = true;
  game.settings.noRentWhileInPrison = false;
  assert.equal(game.cardRentPayable(a, b, flatTile()), true);
  game.settings.noRentWhileInPrison = true;
  assert.equal(game.cardRentPayable(a, b, flatTile()), false);
});

check('fix1 keeps existence self mortgaged guards', () => {
  const { game, a, b } = startedRoom();
  b.bankrupt = false;
  b.inJail = false;
  assert.equal(game.cardRentPayable(a, null, flatTile()), false);
  assert.equal(game.cardRentPayable(a, a, flatTile()), false);
  assert.equal(game.cardRentPayable(a, b, { mortgaged: true }), false);
  assert.equal(game.cardRentPayable(a, b, flatTile()), true);
});

function countResolves(game) {
  const original = game.resolveTurnAfterAction.bind(game);
  let calls = 0;
  game.resolveTurnAfterAction = (options) => {
    calls += 1;
    return original(options);
  };
  return () => calls;
}

function repairsFixture() {
  const ctx = startedRoom();
  const { game, a } = ctx;
  game.hasRolled = true;
  game.awaitingEndTurn = false;
  a.cash = 1000;
  a.properties = [1, 3];
  game.getTile(1).houseCount = 2;
  game.getTile(3).houseCount = 0;
  return ctx;
}

check('fix2 repairs with cost resolves once', () => {
  const { game, a } = repairsFixture();
  const calls = countResolves(game);
  const returned = game.applyCard(a, { action: 'repairs', houseCost: 50, hotelCost: 100 }, {});
  assert.equal(returned, undefined);
  assert.equal(calls(), 1);
  assert.equal(a.cash, 900);
});

check('fix2 repairs zero cost resolves once', () => {
  const { game, a } = startedRoom();
  game.hasRolled = true;
  game.awaitingEndTurn = false;
  a.cash = 1000;
  a.properties = [];
  const calls = countResolves(game);
  const returned = game.applyCard(a, { action: 'repairs', houseCost: 50, hotelCost: 100 }, {});
  assert.equal(returned, undefined);
  assert.equal(calls(), 1);
  assert.equal(a.cash, 1000);
});

check('fix2 payEach feeds actual total when capped', () => {
  const { game, a, b } = startedRoom();
  a.cash = 10;
  b.cash = 1000;
  game.applyCard(a, { action: 'payEach', amount: 20 }, {});
  assert.equal(a.cash, 0);
  assert.equal(b.cash, 1010);
  assert.match(game.feed[0].text, /\$10/);
});

check('fix2 payEach sufficient cash feeds total', () => {
  const { game, a, b } = startedRoom();
  a.cash = 1000;
  b.cash = 1000;
  game.applyCard(a, { action: 'payEach', amount: 20 }, {});
  assert.equal(a.cash, 980);
  assert.equal(b.cash, 1020);
  assert.match(game.feed[0].text, /\$20/);
});

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-audit-'));
  const file = path.join(dir, 'matches.json');
  return new MatchStore(file);
}

function baseRecord(contracts) {
  return {
    matchId: 'audit-m1',
    completedAt: '2026-01-01T00:00:00.000Z',
    durationSeconds: 10,
    roundCount: 5,
    roomVisibility: 'public',
    participants: [],
    globalEvents: [],
    eventCombinations: [],
    tradesCompleted: 0,
    auctionsCompleted: 0,
    casino: [],
    market: [],
    playerContracts: contracts
  };
}

check('fix3 preserves hybrid kind plus hybrid fields', () => {
  const store = tempStore();
  const hybrid = {
    id: 'h1',
    kind: 'hybrid',
    fromAccountId: 'a1',
    toAccountId: 'b1',
    fromPlayerId: 'p1',
    toPlayerId: 'p2',
    amount: 100,
    status: 'active',
    premiumRate: 10,
    equityShare: 0,
    collateralTileIndex: null,
    propertyIndex: 1,
    conversionShare: 30,
    equityControl: 'passive'
  };
  const outcome = store.record(baseRecord([hybrid]));
  assert.equal(outcome.created, true);
  const saved = store.get('audit-m1').playerContracts[0];
  assert.equal(saved.kind, 'hybrid');
  assert.equal(saved.propertyIndex, 1);
  assert.equal(saved.conversionShare, 30);
  assert.equal(saved.equityControl, 'passive');
});

check('fix3 loan equity unknown kinds sanitize', () => {
  const store = tempStore();
  const contracts = [
    { id: 'l1', kind: 'loan', status: 'paid', amount: 50 },
    { id: 'e1', kind: 'equity', status: 'active', amount: 50, propertyIndex: 3, equityControl: 'shared' },
    { id: 'x1', kind: 'bogus', status: 'active', amount: 10 }
  ];
  store.record(baseRecord(contracts));
  const saved = store.get('audit-m1').playerContracts;
  assert.equal(saved[0].kind, 'loan');
  assert.equal(saved[1].kind, 'equity');
  assert.equal(saved[1].propertyIndex, 3);
  assert.equal(saved[1].equityControl, 'shared');
  assert.equal(saved[2].kind, 'loan');
});

const failed = results.filter((r) => !r).length;
console.log(`\naudit-cards-match tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
