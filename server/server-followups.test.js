import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoomManager } from './gameLogic.js';
import { createRuntime } from './socketRuntime.js';
import * as persistence from './persistenceMode.js';
import * as bankruptcy from './bankruptcyLogic.js';
import { AccountStore } from './accountStore.js';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';
import * as accountSocket from './serverSocketAccount.js';
import { SeasonStore } from './seasonModule.js';
import { processContracts } from './contractLogic.js';
import * as socialSocket from './serverSocketSocial.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';

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

function runtimeDeps(roomManager, overrides = {}) {
  return {
    io: { emit() {}, in() { return { emit() {} }; }, sockets: { sockets: new Map() } },
    roomManager,
    accountStore: { sessionAccount() { return null; } },
    socialStore: { respondInvite() { return { success: true, invite: {} }; } },
    matchStore: {}, achievementStore: {}, seasonStore: {}, cosmeticStore: {}, telemetryStore: null,
    botAdvisor: { supportsChoicePhases: false },
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
    ...overrides
  };
}

function startedRoom(options = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', ...options });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return { manager, room };
}

check('persistence stays single-process when environment strings falsely claim a ready adapter', () => {
  const env = {
    POORUP_HORIZONTAL_SCALE: 'true',
    POORUP_POSTGRES_URL: 'postgres://claimed',
    POORUP_PERSISTENCE_ADAPTER: 'postgres',
    POORUP_TRANSACTIONAL_ADAPTER_READY: 'true'
  };
  const mode = persistence.persistenceMode(env);
  assert.equal(mode.mode, 'json-single-process');
  assert.equal(mode.ready, false);
});

check('persistence accepts only an adapter instance with a healthy transactional interface', () => {
  const env = { POORUP_HORIZONTAL_SCALE: 'true', POORUP_POSTGRES_URL: 'postgres://claimed', POORUP_PERSISTENCE_ADAPTER: 'postgres' };
  const adapter = { healthCheck() { return true; }, transaction() {} };
  assert.equal(persistence.persistenceMode(env, adapter).mode, 'postgres-ready');
  assert.equal(persistence.persistenceMode(env, { healthCheck() { return false; }, transaction() {} }).ready, false);
});

check('readiness projection exposes only store, backup, and maintenance health', () => {
  assert.equal(typeof persistence.buildReadinessProjection, 'function');
  assert.deepEqual(persistence.buildReadinessProjection({ storeLoaded: true, backupFresh: false, maintenance: 'normal' }), {
    ready: false,
    storeLoaded: true,
    backupFresh: false,
    maintenance: 'normal'
  });
  assert.equal(JSON.stringify(persistence.buildReadinessProjection({ storeLoaded: true, backupFresh: true, maintenance: 'normal' })).includes('password'), false);
});

check('runtime exposes current AI provider status and its subscription cleanup', () => {
  const manager = new RoomManager();
  manager.createRoom({ socketId: 'provider-socket', clientId: 'provider-client', nickname: 'Provider' });
  let unsubscribeCalled = false;
  const runtime = createRuntime(runtimeDeps(manager, {
    botAdvisor: {
      getPublicStatus() { return { state: 'quota-exhausted', reason: 'credits-exhausted', revision: 4 }; },
      subscribeProviderStatus() { return () => { unsubscribeCalled = true; }; }
    }
  }));

  assert.deepEqual(runtime.botProviderStatus(), { state: 'quota-exhausted', revision: 4, reason: 'credits-exhausted' });
  runtime.unsubscribeBotProviderStatus();
  assert.equal(unsubscribeCalled, true);
});

check('transport disconnect marks a seat disconnected so a grace-window restore succeeds', () => {
  const { manager, room } = startedRoom();
  const runtime = createRuntime(runtimeDeps(manager));
  runtime.handleSocketDisconnect({ id: 'socket-a', rooms: new Set(['socket-a', room.roomCode]) });
  const seat = room.game.getPlayerByClient('client-a');
  assert.equal(seat.disconnected, true);
  assert.equal(seat.socketId, null);
  assert.ok(seat.disconnectDeadline > Date.now());
  assert.equal(manager.restoreConnection('client-a', 'socket-a-replacement'), room);
  assert.equal(room.game.getPlayerByClient('client-a').socketId, 'socket-a-replacement');
});

check('terminal expired seats are removed before rematch even when deadline is already zero', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'c', clientId: 'c', nickname: 'C' });
  const ghost = room.game.getPlayerByClient('b');
  ghost.disconnected = true;
  ghost.socketId = null;
  ghost.disconnectDeadline = 0;
  assert.equal(room.startGame().success, true);
  assert.equal(room.game.players.some(player => player.clientId === 'b'), false);
});

check('failed invite consumption restores a pre-existing disconnected target seat byte-for-byte', () => {
  const manager = new RoomManager();
  const source = manager.createRoom({ socketId: 'source-socket', clientId: 'source-client', nickname: 'Source' });
  const target = manager.createRoom({ socketId: 'target-host', clientId: 'target-host', nickname: 'Target Host' });
  const targetSeat = target.addOrReconnectPlayer({ socketId: 'target-old', clientId: 'target-client', nickname: 'Target', accountId: 'acct-target', color: '#123456' }).player;
  targetSeat.disconnected = true;
  targetSeat.socketId = null;
  targetSeat.disconnectDeadline = Date.now() + 5_000;
  const before = { ...targetSeat };
  const runtime = createRuntime(runtimeDeps(manager, { socialStore: { respondInvite() { return { success: false, error: 'Invite was already consumed.' }; } } }));
  const result = runtime.acceptRoomInvite(
    { id: 'accept-socket', rooms: new Set(['accept-socket']), join() {}, leave() {} },
    { id: 'acct-target', displayName: 'Target', color: '#abcdef', avatarGrid: null },
    { id: 'invite-1', roomId: target.publicId, roomCode: target.roomCode, expiresAt: new Date(Date.now() + 5_000).toISOString() },
    { inviteId: 'invite-1', clientId: 'target-client' }
  );
  assert.deepEqual(result, { success: false, error: 'Invite was already consumed.' });
  assert.deepEqual({ ...targetSeat }, before);
  assert.equal(manager.getRoomBySocket('source-socket'), source);
});

check('account upgrade does not bind a second lobby seat while any prior account seat remains', () => {
  const manager = new RoomManager();
  const oldRoom = manager.createRoom({ socketId: 'old-socket', clientId: 'old-client', nickname: 'Old', accountId: 'acct-1' });
  const oldSeat = oldRoom.game.getPlayerByClient('old-client');
  oldSeat.disconnected = true;
  oldSeat.socketId = null;
  oldSeat.disconnectDeadline = Date.now() + 5_000;
  const socket = { id: 'new-socket', data: {}, rooms: new Set(), join() {}, leave() {}, emit() {} };
  const newRoom = manager.createRoom({ socketId: socket.id, clientId: 'new-client', nickname: 'Guest' });
  const handlers = new Map();
  const account = { id: 'acct-1', displayName: 'Account', color: '#35a653', avatarGrid: null };
  registerAccountSocketHandlers((event, handler) => handlers.set(event, handler), socket, {
    accountStore: { register() { return { success: true, account, sessionToken: 'token' }; }, sessionTokenHashFor() { return 'hash'; } },
    roomManager: manager,
    social: { accountForSocket() { return null; } },
    emitRoomState() {}, scheduleRoomsUpdated() {}, leaveAllGameRooms() {}, detachSocketFromOtherRoom() {},
    clearDisconnectTimer() {}, reassignHostIfNeeded() {}, emitPendingInteractions() {}, io: { in() { return { emit() {} }; } }
  });
  let response;
  handlers.get('account-register')({}, result => { response = result; });
  assert.equal(response.success, true);
  assert.equal(oldRoom.game.getPlayerByClient('old-client').accountId, 'acct-1');
  assert.equal(newRoom.game.getPlayerByClient('new-client').accountId, null);
});

check('hybrid default exposes a collectible server-owned lender claim', () => {
  assert.equal(typeof bankruptcy.settleDefaultClaim, 'function');
  const { room } = startedRoom({ rulesetPreset: 'after-hours' });
  const lender = room.game.players[0];
  const borrower = room.game.players[1];
  const contract = { id: 'default-claim', kind: 'hybrid', status: 'due', fromPlayerId: lender.id, toPlayerId: borrower.id, amount: 100, remaining: 120, propertyIndex: 1, conversionShare: 30, cureRound: 0 };
  room.game.playerContracts.push(contract);
  room.game.getTile(1).ownerId = borrower.id;
  room.game.getTile(1).houseCount = 1;
  processContracts(room.game);
  assert.equal(contract.status, 'defaulted');
  assert.equal(room.game.defaultClaims.length, 1);
  assert.equal(bankruptcy.settleDefaultClaim(room.game, contract.id, 0).success, false);
  borrower.cash = 50;
  const settled = bankruptcy.settleDefaultClaim(room.game, contract.id, 50);
  assert.equal(settled.success, true);
  assert.equal(lender.cash, 1_550);
  assert.equal(room.game.defaultClaims[0].remaining, 70);
});

check('season reward grant retries after a split-write failure without double-granting', () => {
  assert.equal(typeof socialSocket.applySeasonRewardGrant, 'function');
  let cosmeticAttempts = 0;
  let tokenAttempts = 0;
  const cosmeticStore = {
    claim() {
      cosmeticAttempts += 1;
      if (cosmeticAttempts === 1) throw new Error('cosmetic write failed');
      return { success: true, created: true };
    },
    grantTokens() {
      tokenAttempts += 1;
      return { success: true, granted: 80 };
    }
  };
  const claimed = { reward: { id: 'season-gold', cosmeticId: 'frame-gold', tokens: 80 }, season: { id: 'S20260914' } };
  assert.equal(socialSocket.applySeasonRewardGrant(cosmeticStore, 'acct-1', claimed).success, false);
  assert.equal(socialSocket.applySeasonRewardGrant(cosmeticStore, 'acct-1', claimed).success, true);
  assert.equal(cosmeticAttempts, 2);
  assert.equal(tokenAttempts, 1);
});

check('short-default repayment is exposed through the authoritative room action with request-id replay', () => {
  const { room } = startedRoom({ rulesetPreset: 'after-hours', marketComplexity: 'shorting' });
  const player = room.game.players[0];
  player.shortDefaultDebt = 100;
  player.cash = 40;
  assert.equal(typeof room.settleShortDefault, 'function');
  const handlers = new Map();
  registerGameSocketHandlers((event, handler) => handlers.set(event, handler), { id: 'socket-a', on() {} }, {
    getRoomForSocket() { return room; }, emitRoomState() {}, scheduleAuctionFinish() {}, io: { in() { return { emit() {} }; } }
  });
  assert.equal(handlers.has('settle-short-default'), true);
  const first = room.settleShortDefault('socket-a', 100, 'short-repay-1');
  assert.equal(first.success, true);
  assert.equal(first.remaining, 60);
  player.cash = 999;
  const replay = room.settleShortDefault('socket-a', 100, 'short-repay-1');
  assert.deepEqual(replay, first);
  assert.equal(player.shortDefaultDebt, 60);
  const fractional = room.settleShortDefault('socket-a', 0.5, 'short-repay-fraction');
  assert.deepEqual(fractional, { success: false, error: 'Short-default repayment must be a positive whole amount.' });
  assert.equal(player.shortDefaultDebt, 60);
});

check('auction bids at or after the deadline reject without changing the auction', () => {
  const { room } = startedRoom();
  const player = room.game.players[0];
  room.game.auction = { active: true, highestBid: 10, highestBidderId: null, participants: [player.id], passedPlayerIds: [], cooldownUntil: 0, endsAt: Date.now() - 1 };
  const before = { highestBid: room.game.auction.highestBid, highestBidderId: room.game.auction.highestBidderId, endsAt: room.game.auction.endsAt };
  const result = room.placeAuctionBid('socket-a', 20);
  assert.deepEqual(result, { success: false, error: 'The auction has ended.' });
  assert.deepEqual({ highestBid: room.game.auction.highestBid, highestBidderId: room.game.auction.highestBidderId, endsAt: room.game.auction.endsAt }, before);
});

check('owner match history strips bot decisions while full match result remains available to the caller', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-owner-history-')), 'accounts.json');
  const store = new AccountStore(filePath);
  const registered = store.register({ username: 'owner_followup', displayName: 'Owner', password: 'hunter2hunter2' });
  const result = store.recordGameResults([{ id: 'p1', accountId: registered.account.id, nickname: 'Owner', cash: 100, properties: [], bankrupt: false }], 'p1', { gameId: 'match-bot-trace', includeMatchDetails: true, botDecisions: [{ actionId: 'secret-decision' }] });
  assert.equal(result.botDecisions.length, 1);
  assert.equal(store.getAccountById(registered.account.id).matchHistory[0].botDecisions, undefined);
});

check('connected inDebt humans are not eligible for host reassignment', () => {
  const { manager, room } = startedRoom();
  const human = room.game.players[1];
  human.inDebt = true;
  const runtime = createRuntime(runtimeDeps(manager));
  runtime.reassignHostIfNeeded(room, room.hostId);
  assert.equal(room.hostId, null);
});

check('auth attempt address resolution uses the documented trusted-proxy setting', () => {
  const oldTrusted = process.env.POORUP_TRUSTED_PROXY_HOPS;
  const oldTrust = process.env.POORUP_TRUST_PROXY_HOPS;
  delete process.env.POORUP_TRUSTED_PROXY_HOPS;
  process.env.POORUP_TRUST_PROXY_HOPS = '1';
  const socket = { id: 'auth-socket', handshake: { address: '127.0.0.1', headers: { 'x-forwarded-for': '10.0.0.2, 10.0.0.1' } } };
  // serverSocketAccount exports the key resolver for this boundary test.
  // The documented spelling must select the client address behind one proxy.
  assert.equal(typeof accountSocket.authAttemptKey, 'function');
  assert.equal(accountSocket.authAttemptKey(socket), '10.0.0.2');
  if (oldTrusted === undefined) delete process.env.POORUP_TRUSTED_PROXY_HOPS; else process.env.POORUP_TRUSTED_PROXY_HOPS = oldTrusted;
  if (oldTrust === undefined) delete process.env.POORUP_TRUST_PROXY_HOPS; else process.env.POORUP_TRUST_PROXY_HOPS = oldTrust;
});

check('replay pressure returns a terminal rejection instead of re-executing an evicted request id', () => {
  const { room } = startedRoom();
  room.game.economyTransactions.set('old-request', { success: true, amount: 1 });
  for (let index = 0; index < 1_000; index += 1) room.game.economyTransactions.set(`request-${index}`, { success: true });
  assert.equal(room.game.economyTransactions.get('old-request')?.error, 'REQUEST_ID_EXPIRED');
});

check('replay entries expire by TTL and become terminal rejections', () => {
  const { room } = startedRoom();
  room.game.economyTransactions.ttlMs = 10;
  room.game.economyTransactions.set('ttl-request', { success: true });
  room.game.economyTransactions.timestamps.set('ttl-request', Date.now() - 11);
  assert.deepEqual(room.game.economyTransactions.get('ttl-request'), { success: false, error: 'REQUEST_ID_EXPIRED' });
});

check('top-1-percent reward boundaries are rank-based with a population floor', () => {
  const store = new SeasonStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-season-boundary-')), 'seasons.json'));
  const reward = { track: 'placement', threshold: 0.01 };
  assert.equal(store.rewardEligible({ placementRank: 1 }, reward, 1), false);
  assert.equal(store.rewardEligible({ placementRank: 1 }, reward, 2), false);
  assert.equal(store.rewardEligible({ placementRank: 1 }, reward, 3), false);
  assert.equal(store.rewardEligible({ placementRank: 1 }, reward, 9), false);
  assert.equal(store.rewardEligible({ placementRank: 1 }, reward, 10), true);
  assert.equal(store.rewardEligible({ placementRank: 2 }, reward, 100), false);
});

check('rematch clears runtime match-start telemetry markers', () => {
  const { room } = startedRoom();
  room.analyticsMatchStartRecorded = 'old-round';
  room.analyticsMatchStalledRecorded = 'old-round';
  room.game.endGame();
  assert.equal(room.startGame().success, true);
  assert.equal(room.analyticsMatchStartRecorded, null);
  assert.equal(room.analyticsMatchStalledRecorded, null);
});

async function runAsyncChecks() {
  const crossRoom = startedRoom();
  const targetRoom = crossRoom.manager.createRoom({ socketId: 'socket-target', clientId: 'client-target', nickname: 'Target' });
  const crossRuntime = createRuntime(runtimeDeps(crossRoom.manager, { disconnectGraceMs: 5 }));
  crossRuntime.detachSocketFromOtherRoom({ id: 'socket-a', rooms: new Set(['socket-a', crossRoom.room.roomCode]) }, targetRoom);
  const detached = crossRoom.room.game.getPlayerByClient('client-a');
  assert.equal(detached.disconnected, true);
  crossRoom.room.statsRecorded = true;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(crossRoom.room.game.getPlayerByClient('client-a'), undefined);
  console.log('PASS - cross-room started seat expires through disconnect pipeline');

  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'lock-host', clientId: 'lock-host', nickname: 'Host', rulesetPreset: 'after-hours' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  const human = room.game.players.find(player => !player.isBot);
  room.game.auction = { active: true, startedAt: Date.now(), propertyTile: { index: 1 }, endsAt: Date.now() + 10_000, participants: [bot.id, human.id], highestBid: 0, highestBidderId: null, passedPlayerIds: [], cooldownUntil: 0 };
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const runtime = createRuntime(runtimeDeps(manager, { botAdvisor: { supportsChoicePhases: true, async chooseAction() { calls += 1; await gate; return { actionId: 'auction:pass' }; } } }));
  runtime.emitRoomState(room);
  await new Promise(resolve => setTimeout(resolve, 500));
  runtime.emitRoomState(room);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(calls, 1);
  room.game.auction.active = false;
  release();
}

try {
  await runAsyncChecks();
  console.log('PASS - auction bot decision lock remains held across await');
} catch (error) {
  failures.push({ name: 'auction bot decision lock remains held across await', error });
  console.log(`FAIL - auction bot decision lock remains held across await: ${error.message}`);
}

if (failures.length) {
  console.log(`\nserver follow-ups: ${failures.length} failed`);
  process.exit(1);
}
console.log('\nserver follow-ups: all passed');
process.exit(0);
