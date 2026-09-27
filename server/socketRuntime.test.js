import assert from 'node:assert/strict';
import { createRuntime } from './socketRuntime.js';
import { RoomManager } from './gameLogic.js';

const delays = [];
const bot = { id: 'bot-seat', isBot: true, bankrupt: false, disconnected: false };
const room = {
  roomCode: 'TIMING',
  destroyed: false,
  settings: { turnTimer: 0 },
  game: {
    started: true,
    startedAt: 'timing-test',
    roundNumber: 1,
    currentPlayerId: bot.id,
    players: [bot],
    auction: null,
    getCurrentPlayer: () => bot
  }
};
const roomManager = {
  rooms: new Map([[room.roomCode, room]]),
  setRoomDestroyer() {}
};
const io = {
  emit() {},
  on() {},
  in() { return { emit() {} }; },
  sockets: { sockets: new Map() }
};

const runtime = createRuntime({
  io,
  roomManager,
  accountStore: {},
  socialStore: {},
  matchStore: {},
  achievementStore: {},
  seasonStore: {},
  cosmeticStore: {},
  telemetryStore: null,
  botAdvisor: {},
  social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; } },
  maintenance: {},
  metrics: { setMetric() {} },
  authoritativeStore: {},
  pubsubAdapter: {},
  setTimeout(callback, delay) {
    delays.push(delay);
    return { callback, delay };
  },
  clearTimeout() {},
  setInterval() { return { unref() {} }; },
  clearInterval() {}
});

runtime.scheduleBotTurn(room);
room.game.auction = {
  active: true,
  participants: [bot.id],
  passedPlayerIds: [],
  highestBidderId: null
};
runtime.scheduleBotAuction(room);

assert.deepEqual(delays, [300, 450]);
console.log('socket runtime bot scheduling: ordinary turn 300 ms, auction 450 ms');

{
  let currentTime = 50_000;
  const timers = [];
  let finishes = 0;
  const auction = { active: true, endsAt: currentTime + 5_000 };
  const timedRoom = {
    roomCode: 'AUCTION-TIMER',
    destroyed: false,
    game: {
      auction,
      players: [],
      finishAuction() { finishes += 1; auction.active = false; }
    }
  };
  const timedManager = {
    rooms: new Map([[timedRoom.roomCode, timedRoom]]),
    getRoom: code => code === timedRoom.roomCode ? timedRoom : null,
    setRoomDestroyer() {}
  };
  const timedRuntime = createRuntime({
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, sockets: { sockets: new Map() } },
    roomManager: timedManager,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, seasonStore: {}, cosmeticStore: {}, telemetryStore: null,
    botAdvisor: {},
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
    now: () => currentTime,
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return { unref() {} }; },
    clearInterval() {}
  });
  timedRuntime.scheduleAuctionFinish(timedRoom);
  const originalTimer = timers.at(-1);
  currentTime = auction.endsAt;
  auction.endsAt = currentTime + 5_000;
  originalTimer.callback();
  assert.equal(finishes, 0, 'a stale timer callback must not close an auction after a later bid extended its deadline');
  const refreshedTimer = timers.at(-1);
  assert.equal(refreshedTimer.delay, 5_000);
  currentTime = auction.endsAt;
  refreshedTimer.callback();
  assert.equal(finishes, 1, 'the auction closes at the latest authoritative deadline');
}

{
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'bid-host', clientId: 'bid-host-client', nickname: 'Host', roomCode: 'BOT-BID-TIMER' });
  room.addOrReconnectPlayer({ socketId: 'bid-guest', clientId: 'bid-guest-client', nickname: 'Guest' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  bot.cash = 1_500;
  const timers = [];
  const runtime = createRuntime({
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets: new Map() } },
    roomManager: manager,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, seasonStore: {}, cosmeticStore: {}, telemetryStore: null,
    botAdvisor: { supportsChoicePhases: false },
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return { unref() {} }; },
    clearInterval() {}
  });
  room.game.auction = {
    active: true,
    propertyTile: room.game.getTile(1),
    highestBid: 0,
    highestBidderId: null,
    participants: [bot.id],
    passedPlayerIds: [],
    startedAt: Date.now(),
    endsAt: Date.now() + 5_000,
    cooldownUntil: 0,
    lastBidAt: 0
  };
  runtime.scheduleAuctionFinish(room);
  const initialFinish = timers.at(-1);
  runtime.scheduleBotAuction(room);
  const botTimer = timers.find(timer => timer.delay === 450);
  assert.ok(botTimer);
  botTimer.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(room.game.auction.highestBidderId, bot.id, 'the bot successfully places its bid');
  assert.equal(initialFinish.cleared, true, 'a successful bot bid cancels and replaces the prior finish timer');
  assert.ok(timers.some(timer => timer !== initialFinish && timer.delay > 4_900 && !timer.cleared), 'the bot bid schedules a fresh full auction window');
}

console.log('socket runtime auction deadline checks: 2 passed, 0 failed');
