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
        return { actionId: 'auction:bid', parameters: { amount: bid.minimumAmount }, provider: 'ai', fallback: false };
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
        return { actionId: bid.id, parameters: { amount: bid.minimumAmount }, provider: 'ai', fallback: false };
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
  assert.equal(targetSocket.emitted.filter(entry => entry.event === 'system-message').length, 0, 'the target already received the passed vote through the room broadcast');
  assert.equal(room.game.getPlayerByClient('vote-target-client'), undefined);
  console.log('PASS passedVoteKickProducesOneRemovalNotice');
}
