import assert from 'node:assert/strict';
import { createRuntime } from './socketRuntime.js';

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
