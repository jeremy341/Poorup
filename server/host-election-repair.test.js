// Host election is repaired whenever a seat returns, joins, is pruned or is eliminated. Before the repair, a dropped host left
// hostId null for good, and a bankrupt host kept the role, so set-setting and start-game were refused for every remaining human.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { createRuntime } from './socketRuntime.js';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';

const GRACE_MS = 1000;
const HOST_ONLY_START = 'Only the host can start the game.';

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

class FakeClock {
  constructor() {
    this.time = Date.now();
    this.nextId = 1;
    this.pending = new Map();
  }

  now = () => this.time;

  setTimeout = (callback, delay) => {
    const timer = { id: this.nextId++, callback, dueAt: this.time + Math.max(0, Number(delay) || 0), cancelled: false };
    this.pending.set(timer.id, timer);
    return timer;
  };

  clearTimeout = timer => {
    if (!timer) return;
    timer.cancelled = true;
    this.pending.delete(timer.id);
  };

  advanceBy(milliseconds) {
    const target = this.time + milliseconds;
    for (;;) {
      const next = [...this.pending.values()]
        .filter(timer => !timer.cancelled)
        .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0];
      if (!next || next.dueAt > target) break;
      this.pending.delete(next.id);
      this.time = next.dueAt;
      next.callback();
    }
    this.time = target;
  }
}

// A real RoomManager and real runtime, with the same socket handler
// registrations the live server uses, so host gates are the production ones.
function createTable({ humans = ['A'], bots = 0, started = false } = {}) {
  const clock = new FakeClock();
  const manager = new RoomManager();
  const sockets = new Map();
  const runtime = createRuntime({
    io: { emit() {}, in() { return { emit() {} }; }, sockets: { sockets } },
    roomManager: manager,
    accountStore: {
      recordGameResults() { return { matchId: 'match-test', playerCount: 0, roundCount: 0, market: [], participants: [], botDecisions: [] }; },
      getMatchHistory() { return []; },
      updateMatchRecord() {},
    },
    socialStore: {},
    matchStore: { record() {} },
    achievementStore: { evaluateMatch() { return []; } },
    telemetryStore: { record() {} },
    botAdvisor: {},
    social: {
      chatLastSent: new Map(),
      patrolRuns: new Map(),
      socketsForAccount() { return []; },
      accountForSocket() { return null; },
      recordVerifiedAchievement() {},
    },
    maintenance: {},
    metrics: { setMetric() {} },
    authoritativeStore: {},
    pubsubAdapter: {},
    disconnectGraceMs: GRACE_MS,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: () => ({ unref() {} }),
    clearInterval() {},
  });
  const ctx = { clock, manager, runtime, sockets, room: null, game: null };
  const [first, ...rest] = humans;
  const room = manager.createRoom({ socketId: `socket-${first}`, clientId: `client-${first}`, nickname: first });
  ctx.room = room;
  ctx.game = room.game;
  connect(ctx, `socket-${first}`);
  rest.forEach(nickname => seat(ctx, nickname));
  room.setRoomSetting('bots', bots);
  room.ensureBots();
  if (started) assert.equal(room.startGame().success, true);
  return ctx;
}

function connect(ctx, socketId) {
  const socket = {
    id: socketId,
    rooms: new Set([socketId]),
    data: {},
    handlers: new Map(),
    on(event, handler) { this.handlers.set(event, handler); },
    use() {},
    emit() {},
    join() {},
    leave() {},
  };
  registerGameSocketHandlers((event, handler) => socket.on(event, handler), socket, ctx.runtime);
  registerAccountSocketHandlers((event, handler) => socket.on(event, handler), socket, ctx.runtime);
  ctx.sockets.set(socketId, socket);
  return socket;
}

function seat(ctx, nickname) {
  const result = ctx.room.addOrReconnectPlayer({ socketId: `socket-${nickname}`, clientId: `client-${nickname}`, nickname });
  assert.equal(result.success, true);
  ctx.manager.socketRoom.set(`socket-${nickname}`, ctx.room);
  connect(ctx, `socket-${nickname}`);
  return result.player;
}

function drop(ctx, nickname) {
  ctx.runtime.handleSocketDisconnect(ctx.sockets.get(`socket-${nickname}`));
}

// Restore through the server's join-room path (a reload that keeps its clientId).
function rejoin(ctx, nickname, { socketId = `socket-${nickname}-back` } = {}) {
  connect(ctx, socketId);
  const response = ask(ctx, socketId, 'join-room', { roomCode: ctx.room.roomCode, nickname, clientId: `client-${nickname}` });
  assert.equal(response.success, true, `join-room for ${nickname} should succeed`);
  return socketId;
}

// Restore through the tab-restart path the server uses for a known seat.
function restore(ctx, nickname, { socketId = `socket-${nickname}-back` } = {}) {
  connect(ctx, socketId);
  const room = ctx.manager.restoreConnection(`client-${nickname}`, socketId, null);
  assert.equal(room, ctx.room, `restoreConnection for ${nickname} should reattach the seat`);
  ctx.runtime.clearDisconnectTimer(`client-${nickname}`, ctx.room);
  return socketId;
}

function ask(ctx, socketId, event, payload = {}) {
  let response = null;
  ctx.sockets.get(socketId).handlers.get(event)(payload, result => { response = result; });
  return response;
}

function hostNickname(ctx) {
  return ctx.game.players.find(player => player.id === ctx.room.hostId)?.nickname ?? null;
}

function hostFlags(ctx) {
  return ctx.game.players.filter(player => player.isHost).map(player => player.nickname);
}

check('solo host that drops and restores within the grace period is host again and can configure and start', () => {
  const ctx = createTable({ humans: ['A'], bots: 1 });
  drop(ctx, 'A');
  assert.equal(ctx.room.hostId, null, 'with no other human connected the seat waits without a host');
  restore(ctx, 'A');
  assert.equal(hostNickname(ctx), 'A');
  assert.deepEqual(hostFlags(ctx), ['A']);
  assert.equal(ask(ctx, 'socket-A-back', 'set-setting', { key: 'bots', value: 1 }).success, true);
  assert.equal(ask(ctx, 'socket-A-back', 'start-game').success, true);
});

check('solo host that drops and restores during a started game is host again and can start the rematch', () => {
  const ctx = createTable({ humans: ['A'], bots: 1, started: true });
  drop(ctx, 'A');
  restore(ctx, 'A');
  assert.equal(hostNickname(ctx), 'A');
  ctx.game.endGame();
  assert.equal(ctx.game.started, false);
  assert.equal(ask(ctx, 'socket-A-back', 'start-game').success, true);
});

check('solo host who drops in the lobby keeps the seat past the grace window and is host again on return', () => {
  const ctx = createTable({ humans: ['A'], bots: 1 });
  drop(ctx, 'A');
  ctx.clock.advanceBy(GRACE_MS + 1);
  assert.equal(ctx.game.players.some(player => player.nickname === 'A'), true, 'a lobby seat never times out on a dropped connection');
  assert.equal(ctx.game.players.some(player => player.isBot && player.isHost), false, 'no bot is flagged as host');
  ctx.clock.advanceBy(GRACE_MS * 3);
  assert.equal(ctx.game.players.some(player => player.nickname === 'A'), true, 'the grace window keeps restarting while the lobby is open');
  restore(ctx, 'A');
  assert.equal(hostNickname(ctx), 'A', 'the returning creator is still the host');
  assert.deepEqual(hostFlags(ctx), ['A']);
  assert.equal(ask(ctx, 'socket-A-back', 'start-game').success, true);
});

check('two humans where the host drops last can both return in either order with exactly one valid host', () => {
  const back = createTable({ humans: ['A', 'B'] });
  drop(back, 'B');
  drop(back, 'A');
  assert.equal(back.room.hostId, null);
  restore(back, 'B');
  assert.equal(hostNickname(back), 'B', 'the first returning human takes the empty host seat');
  restore(back, 'A');
  assert.equal(hostNickname(back), 'B', 'a returning former host does not displace a valid host');
  assert.deepEqual(hostFlags(back), ['B']);
  assert.equal(ask(back, 'socket-B-back', 'start-game').success, true);

  const forward = createTable({ humans: ['A', 'B'] });
  drop(forward, 'B');
  drop(forward, 'A');
  restore(forward, 'A');
  assert.equal(hostNickname(forward), 'A');
  restore(forward, 'B');
  assert.deepEqual(hostFlags(forward), ['A']);
  assert.equal(ask(forward, 'socket-A-back', 'start-game').success, true);
});

check('a host seat rejoining through join-room re-elects a hostless lobby', () => {
  const ctx = createTable({ humans: ['A', 'B'] });
  drop(ctx, 'B');
  drop(ctx, 'A');
  assert.equal(ctx.room.hostId, null);
  const socketId = rejoin(ctx, 'B');
  assert.equal(hostNickname(ctx), 'B');
  // The host gate passes; the start itself is refused only because A is still away.
  assert.notEqual(ask(ctx, socketId, 'start-game').error, HOST_ONLY_START);
});

check('a still-valid host is never replaced by a restore or a new join', () => {
  const ctx = createTable({ humans: ['A', 'B'] });
  drop(ctx, 'B');
  assert.equal(hostNickname(ctx), 'A');
  restore(ctx, 'B');
  assert.equal(hostNickname(ctx), 'A');
  seat(ctx, 'C');
  assert.equal(hostNickname(ctx), 'A');
  assert.deepEqual(hostFlags(ctx), ['A']);
});

check('a bankrupt host is replaced by the solvent connected human, who can start the rematch', () => {
  const ctx = createTable({ humans: ['A', 'B', 'C'], started: true });
  const bankrupt = ask(ctx, 'socket-A', 'declare-bankruptcy');
  assert.equal(bankrupt.success, true, bankrupt.error);
  assert.equal(hostNickname(ctx), 'B', 'the solvent human takes over from the bankrupt host');
  const last = ask(ctx, 'socket-C', 'declare-bankruptcy');
  assert.equal(last.success, true, last.error);
  assert.equal(ctx.game.started, false, 'the match ends with B as the last solvent seat');
  assert.equal(ask(ctx, 'socket-B', 'start-game').success, true);
  assert.equal(ask(ctx, 'socket-A', 'start-game').error, HOST_ONLY_START);
});

check('a bankrupt host stays host while no solvent human is connected and passes the role on when one returns', () => {
  const ctx = createTable({ humans: ['A', 'B'], started: true });
  drop(ctx, 'B');
  const bankrupt = ask(ctx, 'socket-A', 'declare-bankruptcy');
  assert.equal(bankrupt.success, true, bankrupt.error);
  assert.equal(hostNickname(ctx), 'A', 'the connected spectator keeps the room hostless-free');
  restore(ctx, 'B');
  assert.equal(hostNickname(ctx), 'B');
  assert.deepEqual(hostFlags(ctx), ['B']);
});

console.log(failures.length ? `\nhost election repair: ${failures.length} failed` : '\nhost election repair: all passed');
process.exit(failures.length ? 1 : 0);
