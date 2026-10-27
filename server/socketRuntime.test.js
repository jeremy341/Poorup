import assert from 'node:assert/strict';
import { botChatPayload, createRuntime, noteBotFallback, recordLoggedTelemetry, recordMatchTelemetry, recordMatchTelemetryOnce } from './socketRuntime.js';
import { createSocialApi } from './socketSocialApi.js';
import { createMetricsRegistry, summarizeRuntimeMetrics } from './metricsRegistry.js';
import { RoomManager } from './gameLogic.js';
import { TelemetryStore } from './telemetryModule.js';

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
  highestBidderId: null
};
runtime.scheduleBotAuction(room);

assert.deepEqual(delays, [300, 450]);
console.log('socket runtime bot scheduling: ordinary turn 300 ms, auction 450 ms');

// E6-11: bot table talk takes the same cleaning as a human message, and text
// that is empty after cleaning is not sent at all.
{
  const bidi = String.fromCharCode(0x202e);
  const zeroWidth = String.fromCharCode(0x200b);
  const botSeat = { id: 'bot-chat-seat', nickname: 'Dice Goblin' };
  assert.deepEqual(botChatPayload(botSeat, `Nice${bidi}${zeroWidth} roll\n`), {
    text: 'Nice roll',
    nickname: 'Dice Goblin',
    senderId: 'bot-chat-seat',
    bot: true
  });
  assert.equal(botChatPayload(botSeat, `${zeroWidth} \n`), null);
  console.log('socket runtime bot chat: table talk is cleaned like a player message');
}

async function verifyBotMovementGate(botBrain) {
  let currentTime = Date.now();
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: `motion-host-${botBrain}`, clientId: `motion-host-${botBrain}`, nickname: 'Host' });
  room.addOrReconnectPlayer({ socketId: `motion-guest-${botBrain}`, clientId: `motion-guest-${botBrain}`, nickname: 'Guest' });
  room.setRoomSetting('bots', 2);
  room.setRoomSetting('botBrain', botBrain);
  assert.equal(room.startGame().success, true);
  const bots = room.game.players.filter(player => player.isBot);
  const humans = room.game.players.filter(player => !player.isBot);
  room.game.turnOrder = [bots[0].id, bots[1].id, ...humans.map(player => player.id)];
  room.game.currentPlayerId = bots[0].id;
  room.game.getBotCandidates = (_bot, options = {}) => options.postRoll
    ? [{ id: 'end-turn', kind: 'end-turn', score: 1 }]
    : [{ id: 'roll', kind: 'roll', score: 1 }];
  room.game.rollDice = function rollBotForMotionTest(socketId) {
    const actor = this.getPlayerBySocket(socketId);
    actor.position = (actor.position + 5) % this.tiles.length;
    this.lastDice = [2, 3];
    this.diceRollSequence += 1;
    this.hasRolled = true;
    this.awaitingEndTurn = true;
    this.turnAllowsExtraRoll = false;
    this.extraRollPending = false;
    return { success: true };
  };
  const timers = [];
  const runtime = createRuntime({
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets: new Map() } },
    roomManager: manager,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
    botAdvisor: { async chooseAction({ candidates }) { return { actionId: candidates[0]?.id, provider: botBrain === 'ai' ? 'ai' : 'deterministic' }; } },
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
    now: () => currentTime,
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return { unref() {} }; },
    clearInterval() {}
  });

  runtime.scheduleBotTurn(room);
  assert.equal(timers[0].delay, 300);
  currentTime += timers[0].delay;
  timers[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const movementGate = timers.find(timer => timer.delay === 2_000 && !timer.cleared);
  assert.ok(movementGate, `${botBrain} bot waits for five animated tiles at 400 ms per tile`);
  assert.equal(room.game.currentPlayerId, bots[0].id, 'the moving bot remains the active seat while its next action is held');

  currentTime += movementGate.delay;
  movementGate.callback();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(room.game.currentPlayerId, bots[1].id, 'the next bot becomes active only after the movement gate');
  const nextBotTurn = timers.at(-1);
  assert.equal(nextBotTurn.delay, 300, 'the next bot receives the normal inter-action delay after the prior walk settled');
}

await verifyBotMovementGate('no-ai');
await verifyBotMovementGate('ai');
console.log('socket runtime bot movement sequencing: No-AI and AI turns wait for pawn travel');

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
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
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
  let currentTime = 90_000;
  const timers = [];
  let finishes = 0;
  const auction = { active: true, endsAt: currentTime + 5_000 };
  const timedRoom = {
    roomCode: 'MOVING-AUCTION',
    destroyed: false,
    game: {
      auction,
      presentation: { startedAt: currentTime, readyAt: currentTime + 5_040 },
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
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
    botAdvisor: {},
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
    now: () => currentTime,
    setTimeout(callback, delay) { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimeout() {},
    setInterval() { return { unref() {} }; },
    clearInterval() {}
  });

  timedRuntime.scheduleAuctionFinish(timedRoom);
  assert.equal(auction.endsAt, currentTime + 5_040 + 5_000, 'the full bid window starts after presentation finishes');
  assert.equal(timers.at(-1).delay, 10_040);
  currentTime = auction.endsAt;
  timers.at(-1).callback();
  assert.equal(finishes, 1, 'the auction settles only after the post-arrival bidding window');
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
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
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

{
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'stale-bid-host', clientId: 'stale-bid-host', nickname: 'Host', roomCode: 'STALE-BID' });
  room.addOrReconnectPlayer({ socketId: 'stale-bid-human', clientId: 'stale-bid-human', nickname: 'Human' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  const human = room.game.players.find(player => !player.isBot);
  room.game.auction = {
    active: true,
    propertyTile: room.game.getTile(1),
    highestBid: 0,
    highestBidderId: null,
    participants: [bot.id, human.id],
    startedAt: Date.now(),
    endsAt: Date.now() + 5_000,
    cooldownUntil: 0,
    lastBidAt: 0
  };
  const timers = [];
  const runtime = createRuntime({
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets: new Map() } },
    roomManager: manager,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
    botAdvisor: {
      supportsChoicePhases: true,
      supportsChoicePhase: phase => phase === 'auction',
      async chooseAction({ candidates }) {
        const bid = candidates.find(candidate => candidate.id === 'auction:bid');
        room.game.auction.highestBid = 100;
        room.game.auction.highestBidderId = human.id;
        return { actionId: 'auction:bid', parameters: { amount: bid.amount }, provider: 'ai', fallback: false };
      }
    },
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return { unref() {} }; }, clearInterval() {}
  });
  runtime.scheduleBotAuction(room);
  timers.find(timer => timer.delay === 450).callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(room.game.auction.highestBid, 100, 'the live human bid remains authoritative');
  assert.equal(room.game.auction.highestBidderId, human.id, 'the stale bot response does not replace the current bidder');
  assert.notEqual(room.game.auction.highestBidderId, bot.id);
}

{
  let currentTime = Date.now();
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'wait-bid-host', clientId: 'wait-bid-host', nickname: 'Host', roomCode: 'WAITBID' });
  room.addOrReconnectPlayer({ socketId: 'wait-bid-human', clientId: 'wait-bid-human', nickname: 'Human' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  const human = room.game.players.find(player => !player.isBot);
  bot.cash = 1_500;
  room.game.auction = {
    active: true,
    propertyTile: room.game.getTile(1),
    highestBid: 0,
    highestBidderId: null,
    participants: [bot.id, human.id],
    startedAt: currentTime,
    endsAt: currentTime + 5_000,
    cooldownUntil: 0,
    lastBidAt: 0
  };
  const timers = [];
  let decisions = 0;
  const runtime = createRuntime({
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets: new Map() } },
    roomManager: manager,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
    botAdvisor: {
      supportsChoicePhase: phase => phase === 'auction',
      async chooseAction({ candidates }) {
        decisions += 1;
        if (decisions === 1) return { actionId: 'auction:wait', provider: 'ai', fallback: false };
        const bid = candidates.find(candidate => candidate.id === 'auction:bid');
        return { actionId: bid.id, parameters: { amount: bid.amount }, provider: 'ai', fallback: false };
      }
    },
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
    now: () => currentTime,
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return { unref() {} }; }, clearInterval() {}
  });
  async function fireAtDueTime(timer) {
    currentTime += timer.delay;
    const realDateNow = Date.now;
    Date.now = () => currentTime;
    try {
      timer.fired = true;
      timer.callback();
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
    } finally {
      Date.now = realDateNow;
    }
  }

  runtime.scheduleBotAuction(room);
  const firstDecision = timers.find(timer => timer.delay === 450);
  assert.ok(firstDecision);
  await fireAtDueTime(firstDecision);
  assert.equal(decisions, 1);
  assert.equal(room.game.auction.highestBidderId, null, 'wait leaves the auction untouched');
  assert.equal(timers.filter(timer => timer.delay === 450 && !timer.cleared && !timer.fired).length, 0, 'the same bot is not re-queried for an unchanged auction');

  currentTime = Date.now();
  assert.equal(room.game.placeAuctionBid(human.socketId, 10).success, true);
  const humanDeadline = room.game.auction.endsAt;
  runtime.scheduleAuctionFinish(room);
  runtime.emitRoomState(room);
  const reconsideration = timers.filter(timer => timer.delay === 450 && !timer.cleared && !timer.fired).at(-1);
  assert.ok(reconsideration, 'the human bid schedules a fresh bot decision');
  const lastEvaluatedAuction = { ...room.game.auction, participants: [...room.game.auction.participants] };
  await fireAtDueTime(reconsideration);
  assert.equal(decisions, 2);
  assert.equal(room.game.auction.highestBidderId, bot.id, 'the bot can reconsider and raise after initially waiting');
  assert.ok(room.game.auction.endsAt > humanDeadline, 'the reconsidered valid bid resets the deadline');

  runtime.destroyRoom(room);
  assert.equal(manager.rooms.has(room.roomCode), false, 'destruction removes the old room');
  const restoredRoom = {
    roomCode: room.roomCode,
    destroyed: false,
    game: { players: room.game.players, auction: lastEvaluatedAuction },
  };
  manager.rooms.set(restoredRoom.roomCode, restoredRoom);
  runtime.scheduleBotAuction(restoredRoom);
  assert.ok(timers.some(timer => timer.delay === 450 && !timer.cleared && !timer.fired),
    'a replacement room with reused auction and seat identifiers does not inherit destroyed-room evaluations');
}

console.log('socket runtime auction deadline checks: 3 passed, 0 failed');

{
  let currentTime = 80_000;
  const delivered = [];
  const timers = [];
  const manager = new RoomManager();
  const hostSocket = { id: 'auction-feed-host', emit() {}, join() {}, leave() {} };
  const guestSocket = { id: 'auction-feed-guest', emit() {}, join() {}, leave() {} };
  const room = manager.createRoom({ socketId: hostSocket.id, clientId: 'auction-feed-host-client', nickname: 'Host', roomCode: 'AUCFD1' });
  room.addOrReconnectPlayer({ socketId: guestSocket.id, clientId: 'auction-feed-guest-client', nickname: 'Guest' });
  manager.socketRoom.set(guestSocket.id, room);
  assert.equal(room.startGame().success, true);
  room.game.startAuction(room.game.getTile(1), room.game.players[0].id);
  room.game.auction.endsAt = currentTime + 100;
  const runtime = createRuntime({
    io: {
      emit() {}, on() {},
      in(target) { return { emit(event, payload) { delivered.push({ target, event, payload }); } }; },
      to(target) { return { emit(event, payload) { delivered.push({ target, event, payload }); } }; },
      sockets: { sockets: new Map() }
    },
    roomManager: manager, accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
    botAdvisor: {}, social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {}, now: () => currentTime,
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; }, setInterval() { return { unref() {} }; }, clearInterval() {}
  });
  runtime.scheduleAuctionFinish(room);
  currentTime = room.game.auction.endsAt;
  timers.at(-1).callback();
  assert.ok(room.game.feed.some(entry => entry.text === `No bids were placed for ${room.game.getTile(1).name}. The property remains unsold.`));
  assert.equal(delivered.filter(entry => entry.event === 'system-message').length, 0, 'auction expiry uses its specific result feed without a second summary notice');
  console.log('PASS auctionExpiryUsesSpecificFeedResultOnly');
}

{
  const currentTime = 90_000;
  const delivered = [];
  const timers = [];
  const sockets = new Map();
  const makeSocket = id => ({ id, data: {}, emitted: [], rooms: new Set([id]), emit(event, payload) { this.emitted.push({ event, payload }); }, join(roomCode) { this.rooms.add(roomCode); }, leave(roomCode) { this.rooms.delete(roomCode); } });
  const manager = new RoomManager();
  const hostSocket = makeSocket('vote-host');
  const secondSocket = makeSocket('vote-second');
  const targetSocket = makeSocket('vote-target');
  const room = manager.createRoom({ socketId: hostSocket.id, clientId: 'vote-host-client', nickname: 'Host', roomCode: 'VOTE01' });
  room.addOrReconnectPlayer({ socketId: secondSocket.id, clientId: 'vote-second-client', nickname: 'Second' });
  room.addOrReconnectPlayer({ socketId: targetSocket.id, clientId: 'vote-target-client', nickname: 'Target' });
  manager.socketRoom.set(secondSocket.id, room);
  manager.socketRoom.set(targetSocket.id, room);
  sockets.set(hostSocket.id, hostSocket);
  sockets.set(secondSocket.id, secondSocket);
  sockets.set(targetSocket.id, targetSocket);
  assert.equal(room.startGame().success, true);
  const runtime = createRuntime({
    io: {
      emit() {}, on() {},
      in(target) { return { emit(event, payload) { delivered.push({ target, event, payload }); } }; },
      to(target) { return { emit(event, payload) { delivered.push({ target, event, payload }); } }; },
      sockets: { sockets }
    },
    roomManager: manager, accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
    botAdvisor: {}, social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {}, now: () => currentTime,
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; }, setInterval() { return { unref() {} }; }, clearInterval() {}
  });
  const target = room.game.getPlayerBySocket(targetSocket.id);
  const vote = runtime.startRoomVoteKick(hostSocket, { targetPlayerId: target.id, requestId: 'vote-start' });
  assert.equal(vote.success, true);
  assert.equal(runtime.castRoomVoteKick(secondSocket, { voteId: vote.vote.voteId, choice: 'yes', requestId: 'vote-cast' }).success, true);
  const notices = delivered.filter(entry => entry.event === 'system-message');
  assert.equal(notices.length, 1, 'the passed vote is the only room-wide removal notice');
  assert.equal(notices[0].payload.text, 'Target was removed after the room vote-kick passed.');
  assert.equal(targetSocket.emitted.filter(entry => entry.event === 'system-message').length, 1, 'the removed target receives the successful notice directly after seat removal');
  assert.equal(room.game.getPlayerByClient('vote-target-client'), undefined);
  console.log('PASS passedVoteKickProducesOneRemovalNotice');
}

// ---- live counters: bot fallbacks and seat reconnects ----------------------

const counts = registry => summarizeRuntimeMetrics(registry);

{
  const registry = createMetricsRegistry();
  assert.equal(counts(registry).botFallbacks, null, 'nothing recorded yet reads as unknown, not zero');
  // Mirrors the rollup: only decisions the model was asked and the house engine answered count.
  const cases = [
    ['an AI answer', { botMode: 'ai', provider: 'ai' }, false],
    ['a timeout in an AI room', { botMode: 'ai', provider: 'deterministic', fallback: true, fallbackReason: 'timeout' }, true],
    ['a missing provider in an AI room', { botMode: 'ai', provider: 'deterministic', fallback: true, fallbackReason: 'no-ai-provider' }, true],
    ['an AI-room auction rule', { botMode: 'ai', provider: 'deterministic', fallback: true, fallbackReason: 'auction-policy' }, false],
    ['an AI-room phase resolution', { botMode: 'ai', provider: 'deterministic', fallback: true, fallbackReason: 'phase-resolution' }, false],
    ['shadow mode', { botMode: 'ai', provider: 'deterministic', fallback: true, fallbackReason: 'shadow-mode' }, false],
    ['a no-AI room by design', { botMode: 'no-ai', provider: 'deterministic', fallback: true, fallbackReason: 'no-ai-mode' }, false],
    ['a no-AI house decision', { botMode: 'no-ai', provider: 'deterministic', fallback: false }, false],
  ];
  let expected = 0;
  for (const [name, decision, counted] of cases) {
    assert.equal(noteBotFallback(registry, decision), counted, name);
    if (counted) expected += 1;
    assert.equal(counts(registry).botFallbacks, expected === 0 ? null : expected, `${name} leaves the counter at ${expected}`);
  }
  assert.equal(noteBotFallback({ incrementMetric() { throw new Error('boom'); } }, cases[1][1]), true, 'a failing registry never breaks a bot turn');
  assert.equal(noteBotFallback(undefined, cases[1][1]), true);
  console.log('PASS socket runtime bot fallbacks: only a failed model request counts, deliberate house policy never does');
}

async function botDecisionCounters(botBrain, advisorAnswer) {
  let currentTime = Date.now();
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: `fb-host-${botBrain}`, clientId: `fb-host-${botBrain}`, nickname: 'Host' });
  room.addOrReconnectPlayer({ socketId: `fb-guest-${botBrain}`, clientId: `fb-guest-${botBrain}`, nickname: 'Guest' });
  room.setRoomSetting('bots', 1);
  room.setRoomSetting('botBrain', botBrain);
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  room.game.turnOrder = [bot.id, ...room.game.players.filter(player => !player.isBot).map(player => player.id)];
  room.game.currentPlayerId = bot.id;
  room.game.getBotCandidates = (_bot, options = {}) => options.postRoll ? [{ id: 'end-turn', kind: 'end-turn', score: 1 }] : [{ id: 'roll', kind: 'roll', score: 1 }];
  room.game.rollDice = function rollOnce() { this.lastDice = [2, 3]; this.diceRollSequence += 1; this.hasRolled = true; this.awaitingEndTurn = true; this.turnAllowsExtraRoll = false; this.extraRollPending = false; return { success: true }; };
  const registry = createMetricsRegistry();
  const timers = [];
  const runtime = createRuntime({
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets: new Map() } },
    roomManager: manager,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
    botAdvisor: { async chooseAction({ candidates }) { return { actionId: candidates[0]?.id, ...advisorAnswer }; } },
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; } },
    maintenance: {}, metrics: registry, authoritativeStore: {}, pubsubAdapter: {},
    now: () => currentTime,
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return { unref() {} }; }, clearInterval() {}
  });
  runtime.scheduleBotTurn(room);
  currentTime += timers[0].delay;
  timers[0].callback();
  for (let index = 0; index < 4; index += 1) await new Promise(resolve => setImmediate(resolve));
  return { traces: room.game.botDecisionTrace || [], botFallbacks: counts(registry).botFallbacks };
}

{
  const failed = await botDecisionCounters('ai', { provider: 'deterministic', fallback: true, fallbackReason: 'timeout' });
  assert.ok(failed.traces.length >= 1, 'the bot decided');
  assert.equal(failed.botFallbacks, failed.traces.length, 'each failed AI decision is counted exactly once');
  const answered = await botDecisionCounters('ai', { provider: 'ai' });
  assert.equal(answered.botFallbacks, null, 'a model answer is not a fallback');
  const house = await botDecisionCounters('no-ai', { provider: 'deterministic', fallback: true, fallbackReason: 'no-ai-mode' });
  assert.ok(house.traces.length >= 1);
  assert.equal(house.botFallbacks, null, 'a no-AI room answering by design is not a failure');
  console.log('PASS socket runtime bot fallbacks: real bot turns feed the counter through the decision seam');
}

function reconnectFixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'rc-a', clientId: 'rc-client-a', nickname: 'A' });
  const guest = room.addOrReconnectPlayer({ socketId: 'rc-b', clientId: 'rc-client-b', nickname: 'B' }).player;
  manager.socketRoom.set('rc-b', room);
  room.game.started = true;
  room.game.startedAt = 900_000;
  const socket = id => ({ id, rooms: new Set(), data: {}, emit() {}, join() {}, leave() {}, use() {} });
  const sockets = new Map([['rc-a', socket('rc-a')], ['rc-b', socket('rc-b')]]);
  const registry = createMetricsRegistry();
  const runtime = createRuntime({
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets } },
    roomManager: manager,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: { record() {} },
    botAdvisor: {},
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; } },
    maintenance: {}, metrics: registry, authoritativeStore: {}, pubsubAdapter: {},
    now: () => 1_000_000,
    setTimeout(callback, delay) { return { callback, delay }; },
    clearTimeout() {}, setInterval() { return { unref() {} }; }, clearInterval() {}
  });
  return { manager, room, guest, sockets, runtime, registry, socket };
}

{
  const { manager, room, guest, sockets, runtime, registry, socket } = reconnectFixture();
  assert.equal(counts(registry).roomReconnects, null, 'no reconnect recorded yet reads as unknown');
  runtime.handleSocketDisconnect(sockets.get('rc-b'));
  assert.equal(guest.disconnected, true);
  assert.equal(counts(registry).roomReconnects, null, 'a disconnect is not a reconnect');
  // restore-session: attach the seat, then the handler clears the grace timer.
  assert.equal(manager.restoreConnection('rc-client-b', 'rc-b2'), room);
  runtime.clearDisconnectTimer('rc-client-b', room);
  assert.equal(counts(registry).roomReconnects, 1, 'one successful seat reconnect');
  runtime.clearDisconnectTimer('rc-client-b', room);
  runtime.clearDisconnectTimer('rc-client-b', room);
  assert.equal(counts(registry).roomReconnects, 1, 'repeating the clear for the same reconnect never counts again');
  // A second drop and return is a second reconnect.
  runtime.handleSocketDisconnect(socket('rc-b2'));
  assert.equal(manager.restoreConnection('rc-client-b', 'rc-b3'), room);
  runtime.clearDisconnectTimer('rc-client-b', room);
  assert.equal(counts(registry).roomReconnects, 2);
  console.log('PASS socket runtime reconnects: one count per seat that comes back inside its grace window');
}

{
  // Rejoin by code or room id runs addOrReconnectPlayer, then clears the timer.
  const { room, guest, sockets, runtime, registry } = reconnectFixture();
  runtime.handleSocketDisconnect(sockets.get('rc-b'));
  const joined = room.addOrReconnectPlayer({ socketId: 'rc-b-join', clientId: 'rc-client-b', nickname: 'B' });
  assert.equal(joined.success, true);
  runtime.clearDisconnectTimer('rc-client-b', room);
  assert.equal(guest.disconnected, false);
  assert.equal(counts(registry).roomReconnects, 1);
  // A brand new player joining has no grace timer, so it is not a reconnect.
  room.game.started = false;
  const fresh = room.addOrReconnectPlayer({ socketId: 'rc-c', clientId: 'rc-client-c', nickname: 'C' });
  assert.equal(fresh.success, true);
  runtime.clearDisconnectTimer('rc-client-c', room);
  assert.equal(counts(registry).roomReconnects, 1, 'a first join is not a reconnect');
  console.log('PASS socket runtime reconnects: a rejoin counts, a first join does not');
}

{
  // The tab-restart reclaim swaps the clientId, and clears the old timer before the seat is attached.
  const { manager, room, guest, sockets, runtime, registry } = reconnectFixture();
  guest.accountId = 'acct-reclaim';
  runtime.handleSocketDisconnect(sockets.get('rc-b'));
  const reclaimed = manager.restoreConnection('rc-new-tab', 'rc-b-new', 'acct-reclaim', (previousClientId, reclaimedRoom) => runtime.clearDisconnectTimer(previousClientId, reclaimedRoom, { reconnected: true }));
  assert.equal(reclaimed, room);
  runtime.clearDisconnectTimer('rc-new-tab', room);
  assert.equal(counts(registry).roomReconnects, 1, 'the reclaim is one reconnect, not two and not zero');
  console.log('PASS socket runtime reconnects: an account-seat reclaim counts once');
}

{
  // Leaving and tearing a room down are not reconnects.
  const { room, guest, sockets, runtime, registry } = reconnectFixture();
  runtime.handleSocketDisconnect(sockets.get('rc-b'));
  runtime.clearDisconnectTimer('rc-client-b', room);
  assert.equal(guest.disconnected, true, 'the seat is still down');
  assert.equal(counts(registry).roomReconnects, null, 'clearing the timer of a seat that is still down (leave) is not a reconnect');
  runtime.handleSocketDisconnect(sockets.get('rc-b'));
  runtime.destroyRoom(room);
  assert.equal(counts(registry).roomReconnects, null, 'room teardown is not a reconnect');
  console.log('PASS socket runtime reconnects: leave and room teardown never count');
}

// ---- w6 audit fixes: reconnect delivery, cancel replay, lobby seats ----------

function bareRuntime(manager, extra = {}) {
  return createRuntime({
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets: new Map() } },
    roomManager: manager,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
    botAdvisor: {},
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
    now: () => 1_000_000,
    setTimeout(callback, delay) { return { callback, delay }; },
    clearTimeout() {}, setInterval() { return { unref() {} }; }, clearInterval() {},
    ...extra
  });
}

{
  // S09-2: after a counter the awaiting seat is the lender, so a reconnect
  // re-delivers the offer to the lender and not to the borrower who wrote it.
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'pc-a', clientId: 'pc-client-a', nickname: 'Lender' });
  room.addOrReconnectPlayer({ socketId: 'pc-b', clientId: 'pc-client-b', nickname: 'Borrower' });
  const [lender, borrower] = room.game.players;
  const runtime = bareRuntime(manager);
  room.game.pendingPlayerContract = { id: 'c1', fromPlayerId: lender.id, toPlayerId: borrower.id, lastProposerId: borrower.id, counterDepth: 1 };
  const capture = () => { const sock = { emitted: [], emit(event) { this.emitted.push(event); } }; return sock; };
  const lenderSocket = capture();
  const borrowerSocket = capture();
  runtime.emitPendingInteractions(room, lenderSocket, lender);
  runtime.emitPendingInteractions(room, borrowerSocket, borrower);
  assert.deepEqual(lenderSocket.emitted, ['player-contract-offer'], 'the seat awaiting the counter gets the prompt on reconnect');
  assert.deepEqual(borrowerSocket.emitted, [], 'the author of the counter does not get its own offer back');
  console.log('PASS socket runtime reconnect re-delivers a countered contract to the awaiting seat');
}

{
  // S09-4: a cancel replay memo names the contract it cancelled.
  const runtime = bareRuntime(new RoomManager());
  const socket = { id: 'cancel-memo-socket' };
  const game = { contractTransactions: new Map(), pendingPlayerContract: null };
  const room = { game };
  runtime.cacheContractCancel(room, socket, { requestId: 'same', contractId: 'c1' }, { success: true }, 'c1');
  assert.deepEqual(runtime.cachedContractCancel(room, socket, { requestId: 'same', contractId: 'c1' }), { success: true }, 'a retry of the same cancel replays');
  assert.deepEqual(runtime.cachedContractCancel(room, socket, { requestId: 'same' }), { success: true }, 'a retry that names no contract replays while nothing is pending');
  game.pendingPlayerContract = { id: 'c2' };
  assert.equal(runtime.cachedContractCancel(room, socket, { requestId: 'same', contractId: 'c2' }), null, 'a reused request id does not replay for a different contract');
  assert.equal(runtime.cachedContractCancel(room, socket, { requestId: 'same' }), null, 'nor does it claim a cancel while a contract is pending');
  console.log('PASS socket runtime cancel replay is bound to the cancelled contract');
}

{
  // s02 F6: a seat that drops is stamped, so a lobby ghost can be told apart
  // from a recent disconnect; a return clears the stamp.
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'ghost-a', clientId: 'ghost-client-a', nickname: 'Host' });
  const guest = room.addOrReconnectPlayer({ socketId: 'ghost-b', clientId: 'ghost-client-b', nickname: 'Guest' }).player;
  manager.socketRoom.set('ghost-b', room);
  const runtime = bareRuntime(manager);
  runtime.handleSocketDisconnect({ id: 'ghost-b', data: {} });
  assert.equal(guest.disconnected, true);
  assert.equal(guest.disconnectedAt, 1_000_000, 'the original drop time is recorded');
  assert.equal(manager.restoreConnection('ghost-client-b', 'ghost-b2'), room);
  runtime.clearDisconnectTimer('ghost-client-b', room);
  assert.equal(guest.disconnectedAt, 0, 'a seat that came back carries no drop time');
  console.log('PASS socket runtime stamps and clears disconnectedAt');
}

{
  // s01 S01-03: an invite honours the same lobby capacity rule as join-room,
  // which counts every retained seat (an eliminated one comes back for the rematch). Guards the invite path
  // against drifting from seatNewPlayer.
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'inv-a', clientId: 'inv-client-a', nickname: 'Host', roomCode: 'INVCAP' });
  room.setRoomSetting('maxPlayers', 2);
  const eliminated = room.addOrReconnectPlayer({ socketId: 'inv-b', clientId: 'inv-client-b', nickname: 'Out' }).player;
  eliminated.bankrupt = true;
  const runtime = bareRuntime(manager);
  const invite = { id: 'inv1', roomId: room.publicId, roomCode: room.roomCode, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const refused = runtime.acceptRoomInvite({ id: 'inv-sock', data: {} }, { id: 'acct-invitee', displayName: 'Invitee' }, invite, { inviteId: 'inv1', clientId: 'inv-client-new' });
  assert.deepEqual(refused, { success: false, error: 'That room is full.' });
  assert.equal(room.game.players.length, 2, 'no seat was added');
  console.log('PASS socket runtime invite acceptance respects lobby capacity');
}

// ---- s18 S18-3 / S18-4: a bot decision that outlives its lock or its room ----

function pendingDecisionFixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'pd-host', clientId: 'pd-host', nickname: 'Host' });
  room.addOrReconnectPlayer({ socketId: 'pd-guest', clientId: 'pd-guest', nickname: 'Guest' });
  room.setRoomSetting('bots', 1);
  room.setRoomSetting('botBrain', 'ai');
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  room.game.turnOrder = [bot.id, ...room.game.players.filter(player => !player.isBot).map(player => player.id)];
  room.game.currentPlayerId = bot.id;
  room.game.getBotCandidates = (_bot, options = {}) => options.postRoll ? [{ id: 'end-turn', kind: 'end-turn', score: 1 }] : [{ id: 'roll', kind: 'roll', score: 1 }];
  const state = { rolls: 0 };
  room.game.rollDice = function countedRoll() { state.rolls += 1; this.lastDice = [2, 3]; this.diceRollSequence += 1; this.hasRolled = true; this.awaitingEndTurn = true; this.turnAllowsExtraRoll = false; this.extraRollPending = false; return { success: true }; };
  const releases = [];
  const timers = [];
  const runtime = createRuntime({
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets: new Map() } },
    roomManager: manager,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
    botAdvisor: {
      async chooseAction({ candidates }) {
        if (releases.length === state.holds) return { actionId: candidates[0]?.id, provider: 'ai' };
        return new Promise(resolve => releases.push(() => resolve({ actionId: candidates[0]?.id, provider: 'ai' })));
      }
    },
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false, fired: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return { unref() {} }; }, clearInterval() {}
  });
  state.holds = 1;
  return { manager, room, bot, runtime, timers, releases, state };
}

const flushTicks = async () => { for (let index = 0; index < 6; index += 1) await new Promise(resolve => setImmediate(resolve)); };
const liveTimers = timers => timers.filter(timer => !timer.cleared && !timer.fired);

{
  // S18-4: tearing the room down stops an in-flight decision and its watchdog.
  const { room, runtime, timers, releases, state } = pendingDecisionFixture();
  runtime.scheduleBotTurn(room);
  const turn = liveTimers(timers).find(timer => timer.delay === 300);
  turn.fired = true;
  turn.callback();
  await flushTicks();
  assert.equal(releases.length, 1, 'the decision is waiting on the advisor');
  const watchdog = liveTimers(timers).find(timer => timer.delay >= 15_000);
  assert.ok(watchdog, 'the decision watchdog is armed');
  runtime.destroyRoom(room);
  assert.equal(watchdog.cleared, true, 'destroying the room clears the decision watchdog');
  releases[0]();
  await flushTicks();
  assert.equal(state.rolls, 0, 'the orphaned decision does not act on the destroyed room');
  console.log('PASS socket runtime destroyed room stops the in-flight bot decision');
}

{
  // S18-3: the watchdog frees a stuck decision and a second one acts; the first
  // one, answering late, must not replay its stale answer.
  const { room, runtime, timers, releases, state } = pendingDecisionFixture();
  runtime.scheduleBotTurn(room);
  const turn = liveTimers(timers).find(timer => timer.delay === 300);
  turn.fired = true;
  turn.callback();
  await flushTicks();
  const watchdog = liveTimers(timers).find(timer => timer.delay >= 15_000);
  watchdog.fired = true;
  watchdog.callback();
  room.game.presentation = null;
  const second = liveTimers(timers).find(timer => timer.delay === 300);
  assert.ok(second, 'the watchdog hands the turn to a fresh decision');
  second.fired = true;
  second.callback();
  await flushTicks();
  assert.equal(state.rolls, 1, 'the fresh decision rolled');
  releases[0]();
  await flushTicks();
  assert.equal(state.rolls, 1, 'the stale first decision does not roll again');
  console.log('PASS socket runtime stale bot decision is dropped after its lock was released');
}

// ---- s05 S05-03: an unanswered player contract lapses like a trade ----------

{
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'ct-a', clientId: 'ct-client-a', nickname: 'Lender' });
  room.addOrReconnectPlayer({ socketId: 'ct-b', clientId: 'ct-client-b', nickname: 'Borrower' });
  assert.equal(room.startGame().success, true);
  const [lender, borrower] = room.game.players;
  const intervals = [];
  bareRuntime(manager, { setInterval(callback, ms) { intervals.push({ callback, ms }); return { unref() {} }; } });
  room.game.pendingPlayerContract = { id: 'stale-contract', fromPlayerId: lender.id, toPlayerId: borrower.id, createdAt: Date.now() - 3 * 60_000 };
  intervals.filter(interval => interval.ms === 5_000).forEach(interval => interval.callback());
  assert.equal(room.game.pendingPlayerContract, null, 'the sweep expires an unanswered contract');
  room.game.pendingPlayerContract = { id: 'fresh-contract', fromPlayerId: lender.id, toPlayerId: borrower.id, createdAt: Date.now() };
  intervals.filter(interval => interval.ms === 5_000).forEach(interval => interval.callback());
  assert.equal(room.game.pendingPlayerContract?.id, 'fresh-contract', 'a fresh offer is left alone');
  console.log('PASS socket runtime sweep expires a stale player contract');
}

// ---- s18 S18-2: a bot buyer's sponsorship is re-checked after the human window

{
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'sp-a', clientId: 'sp-client-a', nickname: 'Host' });
  room.setRoomSetting('bots', 2);
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  const human = room.game.players.find(player => !player.isBot);
  const updates = [];
  const watcher = { id: 'sp-a', rooms: new Set(['sp-a', room.roomCode]), emit(event) { if (event === 'update-state') updates.push(event); } };
  const timers = [];
  const runtime = bareRuntime(manager, {
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets: new Map([[watcher.id, watcher]]) } },
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false, fired: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; }
  });
  room.game.pendingSponsoredPurchase = { buyerId: bot.id, createdAt: Date.now(), contributions: [] };
  runtime.emitRoomState(room);
  const recheck = timers.find(timer => !timer.cleared && timer.delay > 29_000 && timer.delay < 32_000);
  assert.ok(recheck, 'a re-check is armed for just after the 30 s human window');
  const before = updates.length;
  recheck.fired = true;
  recheck.callback();
  assert.equal(updates.length, before + 1, 'the re-check re-emits the room state so the buyer bot can act');
  // A human buyer's request is not on the bot clock.
  timers.length = 0;
  room.game.pendingSponsoredPurchase = { buyerId: human.id, createdAt: Date.now(), contributions: [] };
  runtime.emitRoomState(room);
  assert.equal(timers.some(timer => !timer.cleared && timer.delay > 29_000 && timer.delay < 32_000), false);
  console.log('PASS socket runtime re-checks a bot buyer sponsorship after the human window');
}

// ---- s15 S15-03: the match-health duration rides the match-complete event ----

{
  const recorded = [];
  const telemetryStore = { record(kind, payload) { recorded.push({ kind, payload }); } };
  recordMatchTelemetry({
    telemetryStore,
    telemetryVersions: {},
    matchRecord: { playerCount: 3, roundCount: 7, durationSeconds: 1234, participants: [{ accountId: null }, { accountId: 'acct-x' }] }
  });
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0].payload, { playerCount: 3, roundCount: 7, durationSeconds: 1234, botOnly: false });
  recorded.length = 0;
  recordMatchTelemetry({ telemetryStore, telemetryVersions: {}, matchRecord: { playerCount: 2, roundCount: 1, participants: [{ accountId: null }] } });
  assert.equal('durationSeconds' in recorded[0].payload, false, 'a record without a duration sends none');
  console.log('PASS socket runtime match-complete telemetry carries the duration');
}

// ---- F2: a failed invite acceptance leaves no seat behind --------------------

{
  // F2: a store failure while accepting an invite must not leave a live seat
  // behind. The staged seat, the host seat it took over and the bot roster go
  // back to what they were, and the socket is not mapped into the room.
  const manager = new RoomManager();
  const target = manager.createRoom({ socketId: 'invite-host', clientId: 'invite-host', nickname: 'Target Host' });
  target.setRoomSetting('bots', 1);
  target.ensureBots();
  const hostSeat = target.game.getPlayerByClient('invite-host');
  hostSeat.disconnected = true;
  hostSeat.socketId = null;
  const before = {
    playerIds: target.game.players.map(player => player.id),
    botIds: target.game.players.filter(player => player.isBot).map(player => player.id),
    hostId: target.hostId
  };
  const runtime = bareRuntime(manager, {
    socialStore: { respondInvite() { throw new Error('social store offline'); } }
  });
  const socket = { id: 'invite-sock', data: {}, rooms: new Set(), join() {}, leave() {}, emit() {} };
  const result = runtime.acceptRoomInvite(
    socket,
    { id: 'acct-invitee', displayName: 'Invitee', color: '#123456', avatarGrid: null },
    { id: 'invite-f2', roomId: target.publicId, roomCode: target.roomCode, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    { inviteId: 'invite-f2', clientId: 'invite-client' }
  );
  assert.equal(result.success, false, 'a store failure refuses the invite');
  assert.deepEqual(target.game.players.map(player => player.id), before.playerIds, 'the staged seat is unwound');
  assert.deepEqual(target.game.players.filter(player => player.isBot).map(player => player.id), before.botIds, 'the bot roster is unwound');
  assert.equal(target.hostId, before.hostId, 'the host seat is restored');
  assert.equal(target.game.players.filter(player => player.isHost).length, 1, 'exactly one seat keeps the host flag');
  assert.equal(manager.getRoomBySocket('invite-sock'), null, 'the socket is not mapped into the target room');
  assert.ok(!target.game.getPlayerByClient('invite-client'), 'no seat is left for the invitee');
  console.log('PASS socket runtime invite acceptance unwinds the seat when the store fails');
}

// ---- J2: a borrower notice waits for the seat to be back ----------------------

{
  // J2: a private notice for a seat that has no socket is kept until the seat
  // is back. Taking the queue emptied it, and the borrower never learned that
  // the lender cancelled the loan.
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'notice-host', clientId: 'notice-host', nickname: 'Host' });
  const borrower = room.addOrReconnectPlayer({ socketId: 'notice-sock', clientId: 'notice-client', nickname: 'Borrower' }).player;
  const delivered = [];
  const socket = { id: 'notice-sock', rooms: new Set([room.roomCode]), emit(event, payload) { if (event === 'system-message') delivered.push({ event, payload }); } };
  const runtime = bareRuntime(manager, {
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets: new Map([[socket.id, socket]]) } }
  });
  room.game.borrowerNotices = [{ playerId: borrower.id, text: 'your loan was cancelled' }];
  borrower.disconnected = true;
  borrower.socketId = null;
  runtime.emitRoomState(room);
  assert.equal(delivered.length, 0, 'nothing is delivered while the seat has no socket');
  assert.equal(room.game.borrowerNotices.length, 1, 'the notice waits for the seat to come back');
  borrower.disconnected = false;
  borrower.socketId = socket.id;
  runtime.emitRoomState(room);
  assert.equal(delivered.length, 1, 'the notice reaches the seat once it is back');
  assert.equal(delivered[0].event, 'system-message');
  assert.equal(room.game.borrowerNotices.length, 0, 'a delivered notice leaves the queue');
  console.log('PASS socket runtime keeps a borrower notice until the seat has a socket');
}

// ---- D7: a late bot decision must not touch a finished match -----------------

{
  // D7: endGame leaves the room alive, so a decision that answers after the
  // match ended would still act on the finished table.
  const { room, runtime, timers, releases, state } = pendingDecisionFixture();
  runtime.scheduleBotTurn(room);
  const turn = liveTimers(timers).find(timer => timer.delay === 300);
  turn.fired = true;
  turn.callback();
  await flushTicks();
  assert.equal(releases.length, 1, 'the decision is waiting on the advisor');
  room.game.started = false;
  room.game.lastWinner = { id: 'human-winner', nickname: 'Human' };
  releases[0]();
  await flushTicks();
  assert.equal(state.rolls, 0, 'the late decision does not roll on the finished match');
  console.log('PASS socket runtime late bot decision does not mutate a finished match');
}

// ---- N12: the settlement rows keep the market complexity ---------------------

{
  // N12: the match-start row carries the market complexity, so the settlement
  // rows must carry it too. Otherwise a non-basic match is split over two
  // rollup rows.
  const recorded = [];
  const telemetryStore = { record(kind, payload, versions) { recorded.push({ kind, payload, versions }); } };
  const room = {
    game: { started: false, telemetryLog: [] },
    ruleset: { effectiveSettings: { marketComplexity: 'shorting' } },
    settings: { marketComplexity: 'shorting' }
  };
  const matchRecord = {
    matchId: 'm-n12',
    playerCount: 2,
    roundCount: 4,
    participants: [{ accountId: null, bankrupt: false }],
    botOnly: false,
    market: [],
    botDecisions: []
  };
  recordMatchTelemetryOnce({ telemetryStore, room, matchRecord, candidates: [] });
  const complete = recorded.find(entry => entry.kind === 'match-complete');
  assert.ok(complete, 'the match-complete row is recorded');
  assert.equal(complete.versions.marketComplexity, 'shorting', 'the settlement row keeps the market complexity');
  console.log('PASS socket runtime settlement telemetry keeps the market complexity');
}

// ---- a store failure during settlement must not abort the rest of it ---------

function achievementSettlementFixture(overrides = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'ach-host', clientId: 'ach-client-host', nickname: 'Host' });
  const guest = room.addOrReconnectPlayer({ socketId: 'ach-guest', clientId: 'ach-client-guest', nickname: 'Guest' }).player;
  guest.accountId = 'acct-guest';
  room.game.started = true;
  room.game.startedAt = Date.now() - 5_000;
  room.game.lastWinner = { id: guest.id };

  const telemetry = [];
  const accountSyncs = [];
  const seatSocket = {
    id: 'ach-seat',
    data: { accountId: 'acct-guest' },
    rooms: new Set([room.roomCode]),
    emit(event, payload) { if (event === 'account-sync') accountSyncs.push(payload); }
  };
  const io = {
    emit() {}, on() {},
    in() { return { emit() {} }; },
    to() { return { emit() {} }; },
    sockets: { sockets: new Map([[seatSocket.id, seatSocket]]) }
  };
  const candidates = [
    { accountId: 'acct-guest', achievementId: 'first-deed', title: 'FIRST DEED', rarity: 'COMMON', body: 'You owned the first tile.' },
    { accountId: 'acct-guest', achievementId: 'second-deed', title: 'SECOND DEED', rarity: 'COMMON', body: 'You owned the second tile.' }
  ];
  const recordedAchievements = [];
  const accountStore = {
    recordGameResults: () => ({
      matchId: 'match-ach-1',
      playerCount: 2,
      roundCount: 3,
      botOnly: false,
      market: [],
      botDecisions: [],
      participants: [{ accountId: 'acct-guest', bankrupt: false }, { accountId: null, bankrupt: false }]
    }),
    getMatchHistory: () => [],
    updateMatchRecord() {},
    getAccountSnapshot: (accountId) => ({ id: accountId }),
    getPublicAccountById: (accountId) => ({ id: accountId, displayName: 'Guest' }),
    recordAchievement: (accountId, achievement) => {
      if (achievement.id === 'first-deed') throw new Error('account store offline');
      recordedAchievements.push(achievement.id);
      return { success: true, created: true };
    }
  };
  const achievementStore = {
    evaluateMatch: () => candidates,
    unlock: (record) => ({ created: true, record: { ...record, unlockedAt: '2026-09-07T00:00:00.000Z' } }),
    remove: (accountId, achievementId) => {
      if (achievementId === 'first-deed') throw new Error('achievement store offline');
      return true;
    }
  };
  const socialStore = {
    addNotification() {},
    listFor: () => ({ friends: [], requests: [], outgoing: [], invites: [], notifications: [] }),
    areBlocked: () => false,
    friendshipBetween: () => null
  };
  const social = createSocialApi({ io, accountStore, socialStore, matchStore: { record() {} }, achievementStore, sessionStore: null });
  const timers = [];
  const runtime = bareRuntime(manager, {
    io,
    accountStore,
    socialStore,
    achievementStore,
    matchStore: { record() {} },
    telemetryStore: { record(kind) { telemetry.push(kind); return { recorded: true }; } },
    social,
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return { unref() {} }; },
    ...overrides
  });
  return { room, runtime, telemetry, accountSyncs, recordedAchievements, candidates, seatSocket, timers };
}

{
  // The account store fails to record one unlock and the achievement store
  // fails to roll that unlock back. The settlement must still finish: the
  // remaining candidate keeps its unlock, the match telemetry is written and
  // the player is still synced, and the room is marked as settled.
  const { room, runtime, telemetry, accountSyncs, recordedAchievements } = achievementSettlementFixture();
  runtime.emitRoomState(room);
  assert.equal(room.statsRecorded, true, 'the room is settled even though the achievement store failed');
  assert.deepEqual(recordedAchievements, ['second-deed'], 'the remaining candidate keeps its unlock');
  assert.ok(telemetry.includes('match-complete'), 'the match telemetry is still recorded');
  assert.equal(accountSyncs.length, 1, 'the account sync still reaches the player');
  console.log('PASS socket runtime settlement survives a failing achievement store');
}

{
  // A candidate that fails outright must not cost the other candidates their
  // unlocks, the match telemetry or the account sync.
  const attempted = [];
  const { room, runtime, telemetry, accountSyncs, seatSocket } = achievementSettlementFixture({
    social: {
      chatLastSent: new Map(),
      patrolRuns: new Map(),
      socketsForAccount: (accountId) => (accountId === 'acct-guest' ? [seatSocket] : []),
      recordVerifiedAchievement(candidate) {
        attempted.push(candidate.achievementId);
        if (candidate.achievementId === 'first-deed') throw new Error('settlement exploded');
        return true;
      }
    }
  });
  runtime.emitRoomState(room);
  assert.deepEqual(attempted, ['first-deed', 'second-deed'], 'every candidate is attempted');
  assert.equal(room.statsRecorded, true, 'a failing candidate does not stop the settlement');
  assert.ok(telemetry.includes('match-complete'), 'the match telemetry is still recorded');
  assert.equal(accountSyncs.length, 1, 'the account sync still reaches the player');
  console.log('PASS socket runtime isolates a failing achievement candidate');
}

{
  const telemetryStore = new TelemetryStore('', { persist() {}, flushIntervalMs: 0 });
  const room = { game: { telemetryLog: [{ kind: 'airport-flight', data: { fare: 100, basis: 'departure' }, roundNumber: 1 }] } };
  recordLoggedTelemetry({ telemetryStore, room, telemetryVersions: {} });
  assert.equal(telemetryStore.events.length, 1, 'settlement forwards the recorded airport flight');
  assert.equal(telemetryStore.events[0].kind, 'airport-flight');
  assert.deepEqual(telemetryStore.events[0].data, { fare: 100, basis: 'departure', roundNumber: 1 });
  telemetryStore.close();
  console.log('PASS socket runtime settlement records airport-flight telemetry');
}

{
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'gauge-socket', clientId: 'gauge-client', nickname: 'Gauge Host' });
  const registry = createMetricsRegistry();
  const runtime = createRuntime({
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets: new Map() } },
    roomManager: manager,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null, botAdvisor: {},
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; } },
    maintenance: {}, metrics: registry, authoritativeStore: {}, pubsubAdapter: {},
    setTimeout() { return { unref() {} }; }, clearTimeout() {},
    setInterval() { return { unref() {} }; }, clearInterval() {},
  });
  runtime.emitRoomState(room);
  assert.equal(summarizeRuntimeMetrics(registry)?.activeRooms, 1);
  runtime.destroyRoom(room);
  assert.equal(manager.rooms.size, 0);
  assert.equal(summarizeRuntimeMetrics(registry)?.activeRooms, 0, 'destroying the last room refreshes the room gauge');
  runtime.stopAuctionWatchdog();
  console.log('PASS socket runtime refreshes room gauges after destroyRoom');
}
