// F-002: an auction opened by a bot's decision had no finish timer, so with no
// bids it stayed active forever and blocked roll and end-turn. These tests run
// the real runtime with fake timers and check that the auction closes.
import assert from 'node:assert/strict';
import { createRuntime } from './socketRuntime.js';
import { RoomManager, AUCTION_DURATION_MS } from './gameLogic.js';
import { DeterministicAdvisor } from './botAdvisor.js';

const RAILROAD = 5;
const nodeCrypto = (await import('node:crypto')).default;
const realRandomInt = nodeCrypto.randomInt;

function forceDice(...values) {
  nodeCrypto.randomInt = (min, max) => (min === 1 && max === 7 && values.length ? values.shift() : realRandomInt(min, max));
}

function restoreDice() {
  nodeCrypto.randomInt = realRandomInt;
}

const flush = async (rounds = 40) => {
  for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setImmediate(resolve));
};

function harness({ now, bots = 1 } = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'host-sock', clientId: 'host-client', nickname: 'Host', roomCode: 'AWAT01' });
  room.setRoomSetting('bots', bots);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const fixedTime = Date.now();
  const clock = now || (() => fixedTime);
  const timers = [];
  const intervals = [];
  const runtime = createRuntime({
    io: {
      emit() {},
      on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; },
      sockets: { sockets: new Map() }
    },
    roomManager: manager,
    now: clock,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
    botAdvisor: new DeterministicAdvisor(),
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
    setTimeout(callback, delay) {
      const timer = { delay, cleared: false, fired: false };
      timer.callback = () => { timer.fired = true; return callback(); };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval(callback, ms) {
      const handle = { callback, ms, unrefed: false, cleared: false, unref() { handle.unrefed = true; } };
      intervals.push(handle);
      return handle;
    },
    clearInterval(handle) { if (handle) handle.cleared = true; }
  });
  const live = () => timers.filter(timer => !timer.cleared && !timer.fired);
  const finishTimers = () => live().filter(timer => timer.delay >= AUCTION_DURATION_MS);
  return {
    manager, room, game, runtime, timers, intervals, live, finishTimers, now: clock,
    bot: game.players.find(player => player.isBot),
    human: game.players.find(player => !player.isBot)
  };
}

// The bot cannot afford the railroad, so its landing opens an auction it does
// not bid in. Returns once the bot's decision has been applied.
async function botLandsOnUnaffordableRailroad(h) {
  const { game, bot, runtime } = h;
  bot.cash = 50;
  bot.position = 0;
  game.currentPlayerId = bot.id;
  game.hasRolled = false;
  forceDice(2, 3);
  runtime.scheduleBotTurn(h.room);
  const turnTimer = h.live().find(timer => timer.delay >= 0);
  turnTimer.callback();
  await flush();
}

async function testBotStartedAuctionArmsFinishTimer() {
  const h = harness();
  try {
    await botLandsOnUnaffordableRailroad(h);
    assert.equal(h.game.auction?.active, true, 'the bot landing opens an auction');
    assert.equal(h.finishTimers().length, 1, 'an auction a bot opened gets a finish timer');
  } finally {
    restoreDice();
  }
}

// With no bids, the armed finish closes the auction and hands the turn on, so
// the stall ("Resolve your roll before ending the turn.") cannot happen.
async function testBotStartedAuctionClosesWithoutBids() {
  const h = harness();
  try {
    await botLandsOnUnaffordableRailroad(h);
    h.bot.cash = 5;
    h.game.auction.endsAt = h.now() - 1;
    h.finishTimers().forEach(timer => timer.callback());
    await flush();
    assert.equal(h.game.auction, null, 'the unbid auction closes');
    assert.equal(h.game.getTile(RAILROAD).ownerId, null, 'the property stays unsold');
    // Closing the auction re-arms the bot's own turn, which then ends it.
    for (let round = 0; round < 3 && h.game.currentPlayerId === h.bot.id; round += 1) {
      if (h.game.presentation) h.game.presentation.readyAt = 0;
      h.live().forEach(timer => timer.callback());
      await flush();
    }
    assert.equal(h.game.currentPlayerId, h.human.id, 'the table progresses to the human');
    assert.equal(h.game.hasRolled, false, 'the human can roll next');
  } finally {
    restoreDice();
  }
}

// Control: a bot bid still arms the finish and sells the deed to the bidder.
async function testBotBidStillClosesAuctionWithSale() {
  const h = harness();
  try {
    await botLandsOnUnaffordableRailroad(h);
    h.bot.cash = 1500;
    for (let round = 0; round < 3; round += 1) {
      const bids = h.live().filter(timer => timer.delay === 450);
      if (!bids.length) break;
      bids.forEach(timer => timer.callback());
      await flush();
    }
    assert.equal(h.game.auction?.highestBidderId, h.bot.id, 'the funded bot bids');
    assert.equal(h.finishTimers().length, 1, 'the bid keeps a finish timer armed');
    h.game.auction.endsAt = h.now() - 1;
    h.finishTimers().forEach(timer => timer.callback());
    await flush();
    assert.equal(h.game.auction, null);
    assert.equal(h.game.getTile(RAILROAD).ownerId, h.bot.id, 'the winning bidder receives the deed');
  } finally {
    restoreDice();
  }
}

function testWatchdogFinishesOverdueAuctionWithoutTimer() {
  const h = harness();
  h.game.startAuction(h.game.getTile(RAILROAD), h.human.id);
  assert.equal(h.game.auction?.active, true);
  assert.equal(h.finishTimers().length, 0, 'nothing armed the auction');
  h.game.auction.endsAt = h.now() - 1;
  h.intervals.forEach(interval => interval.callback());
  assert.equal(h.game.auction, null, 'the watchdog closes the stranded auction');
  assert.equal(h.game.getTile(RAILROAD).ownerId, null);
}

function testWatchdogLeavesLiveAndArmedAuctionsAlone() {
  const h = harness();
  h.game.startAuction(h.game.getTile(RAILROAD), h.human.id);
  const auction = h.game.auction;
  h.intervals.forEach(interval => interval.callback());
  assert.equal(h.game.auction, auction, 'an auction still inside its bidding window stays open');
  h.runtime.scheduleAuctionFinish(h.room);
  auction.endsAt = h.now() - 1;
  h.intervals.forEach(interval => interval.callback());
  assert.equal(h.game.auction, auction, 'an overdue auction with an armed finish is left to its timer');
  assert.equal(h.finishTimers().length, 1);
}

function testWatchdogIsUnrefedAndStoppable() {
  const h = harness();
  const watchdog = h.intervals.find(interval => interval.ms > 0 && interval.unrefed);
  assert.ok(watchdog, 'the watchdog interval is unref-ed so it cannot hold the process open');
  h.runtime.stopAuctionWatchdog();
  assert.equal(watchdog.cleared, true, 'shutdown clears the watchdog interval');
}

// o01 F2 / s06 S06-05: the lead bidder's socket drops. The lead is revoked at
// once (the sale cannot void at close with a frozen lead no rival can beat),
// and the bid window is extended so rivals get a fair chance.
function testDisconnectedLeaderLosesTheLead() {
  const h = harness();
  h.game.startAuction(h.game.getTile(RAILROAD), h.human.id);
  assert.equal(h.room.placeAuctionBid('host-sock', 100).success, true);
  assert.equal(h.game.auction.highestBidderId, h.human.id);
  h.game.auction.endsAt = Date.now() + 400;
  h.runtime.handleSocketDisconnect({ id: 'host-sock' });
  assert.equal(h.game.auction.highestBidderId, null, 'the disconnected leader no longer leads');
  assert.equal(h.game.auction.highestBid, 0);
  assert.ok(h.game.auction.endsAt >= Date.now() + AUCTION_DURATION_MS - 1000, 'the bid window is extended for the rivals');
  assert.equal(h.live().filter(timer => timer.delay > 4000 && timer.delay <= AUCTION_DURATION_MS + 1000).length, 1, 'the finish is re-armed');
  h.game.auction.cooldownUntil = 0;
  assert.equal(h.room.runBotAction(h.bot.id, actor => h.room.placeAuctionBid(actor, 20)).success, true, 'a rival can now win below the old bid');
}

// o01 F4: a finish handle that already fired must not stay registered, or the
// watchdog treats the room as armed and never closes an overdue auction.
function testFiredFinishHandleDoesNotDisableWatchdog() {
  // The two runtime clock reads can straddle a millisecond. Identify the
  // handle created by scheduling, regardless of the resulting delay.
  let clock = Date.now();
  const h = harness({ now: () => clock++ });
  h.game.startAuction(h.game.getTile(RAILROAD), h.human.id);
  const timerCount = h.timers.length;
  h.runtime.scheduleAuctionFinish(h.room);
  const scheduled = h.timers.slice(timerCount);
  assert.equal(scheduled.length, 1, 'scheduling arms exactly one finish handle');
  const [armed] = scheduled;
  assert.ok(h.live().includes(armed), 'the finish handle is live');
  h.game.auction = { ...h.game.auction, endsAt: clock - 1 };
  armed.callback();
  assert.equal(h.game.auction?.active, true, 'the stale handle does not finish a newer auction');
  h.intervals.forEach(interval => interval.callback());
  assert.equal(h.game.auction, null, 'the watchdog still closes the overdue auction');
}

// s17 S17-07: every background interval is unref-ed and one call stops them
// all; the empty-room GC reads the injected clock, not Date.now().
function testBackgroundIntervalsAreUnrefedAndStoppable() {
  const h = harness();
  assert.ok(h.intervals.length >= 4);
  assert.ok(h.intervals.every(interval => interval.unrefed), 'no interval holds the process open');
  h.runtime.stopAuctionWatchdog();
  assert.ok(h.intervals.every(interval => interval.cleared), 'shutdown clears every interval');
}

function testEmptyRoomGcUsesInjectedClock() {
  let clock = 1_000_000;
  const h = harness({ now: () => clock });
  const gc = h.intervals.find(interval => interval.ms === 60_000);
  h.human.disconnected = true;
  gc.callback();
  clock += 5 * 60_000;
  gc.callback();
  assert.equal(h.manager.rooms.has(h.room.roomCode), true, 'the room is not collected inside its grace period');
  clock += 6 * 60_000;
  gc.callback();
  assert.equal(h.manager.rooms.has(h.room.roomCode), false, 'the room is collected on the injected clock');
}

// s17 S17-02: a started table with no human seat left does not keep running.
function testHumanlessTableDoesNotScheduleBots() {
  const h = harness({ bots: 2 });
  h.manager.leaveRoomByClient('host-client', 'host-sock');
  assert.equal(h.manager.rooms.has(h.room.roomCode), true, 'the bot keeps the registry entry');
  assert.equal(h.room.hasHumanSeats(), false);
  h.game.currentPlayerId = h.bot.id;
  const before = h.live().length;
  h.runtime.scheduleBotTurn(h.room);
  assert.equal(h.live().length, before, 'no bot turn is armed without a human');
  h.game.startAuction(h.game.getTile(RAILROAD), h.bot.id);
  h.runtime.scheduleBotAuction(h.room);
  assert.equal(h.live().filter(timer => timer.delay === 450).length, 0, 'no bot auction decision is armed without a human');
}

const SUITES = [
  ['bot-started auction arms a finish timer', testBotStartedAuctionArmsFinishTimer],
  ['bot-started auction closes without bids', testBotStartedAuctionClosesWithoutBids],
  ['control: bot bid still sells the deed', testBotBidStillClosesAuctionWithSale],
  ['watchdog finishes an overdue auction with no timer', testWatchdogFinishesOverdueAuctionWithoutTimer],
  ['watchdog leaves live and armed auctions alone', testWatchdogLeavesLiveAndArmedAuctionsAlone],
  ['watchdog is unref-ed and stoppable', testWatchdogIsUnrefedAndStoppable],
  ['a disconnected auction leader loses the lead and the window extends', testDisconnectedLeaderLosesTheLead],
  ['a fired finish handle does not disable the watchdog', testFiredFinishHandleDoesNotDisableWatchdog],
  ['background intervals are unref-ed and stoppable', testBackgroundIntervalsAreUnrefedAndStoppable],
  ['empty-room GC uses the injected clock', testEmptyRoomGcUsesInjectedClock],
  ['a humanless started table schedules no bot work', testHumanlessTableDoesNotScheduleBots]
];

let passed = 0;
const failed = [];
for (const [name, fn] of SUITES) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS — ${name}`);
  } catch (error) {
    failed.push(name);
    console.error(`FAIL — ${name}: ${error && error.message}`);
  }
}
console.log(`auction watchdog tests: ${SUITES.length} suites — ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exitCode = 1;
