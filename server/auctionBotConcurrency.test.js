// Regression: a slow auction advisor must not starve another funded bot.
import assert from 'node:assert/strict';
import { createRuntime } from './socketRuntime.js';
import { RoomManager } from './gameLogic.js';

const manager = new RoomManager();
const room = manager.createRoom({ socketId: 'concurrent-host', clientId: 'concurrent-host', nickname: 'Host', roomCode: 'ACON01' });
room.addOrReconnectPlayer({ socketId: 'concurrent-human', clientId: 'concurrent-human', nickname: 'Human' });
room.setRoomSetting('bots', 2);
assert.equal(room.startGame().success, true);
const bots = room.game.players.filter(player => player.isBot);
assert.equal(bots.length, 2);
for (const bot of bots) bot.cash = 1500;

let releaseSlow;
const slowDecision = new Promise(resolve => { releaseSlow = resolve; });
const advisor = {
  supportsChoicePhase: phase => phase === 'auction',
  async chooseAction({ botId, candidates }) {
    const bid = candidates.find(candidate => candidate.id === 'auction:bid');
    if (botId === bots[0].id) await slowDecision;
    return { actionId: bid?.id || 'auction:wait', parameters: bid ? { amount: bid.amount } : undefined, provider: 'ai', fallback: false };
  }
};
const timers = [];
const runtime = createRuntime({
  io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets: new Map() } },
  roomManager: manager,
  accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
  botAdvisor: advisor,
  social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; } },
  maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
  setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
  clearTimeout(timer) { if (timer) timer.cleared = true; },
  setInterval() { return { unref() {} }; },
  clearInterval() {}
});

const auctionTile = room.game.getTile(1);
room.game.startAuction(auctionTile, room.game.players[0].id);
runtime.scheduleAuctionFinish(room);
runtime.scheduleBotAuction(room);
const botTimers = timers.filter(timer => timer.delay === 450);
assert.equal(botTimers.length, 2, 'both bots receive simultaneous bidding slots');

botTimers[0].callback();
botTimers[1].callback();
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));
assert.equal(room.game.auction.highestBidderId, bots[1].id, 'fast bot bids while slow bot is still thinking');
assert.equal(room.game.auction.highestBid, 20);
releaseSlow();
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));
assert.equal(room.game.auction.highestBidderId, bots[1].id, 'stale slow decision does not overwrite the accepted bid');
const reconsiderationTimer = timers.find(timer => timer.delay === 450 && !timer.cleared && !botTimers.includes(timer));
assert.ok(reconsiderationTimer, 'slow bot gets an opportunity to reconsider the new auction state');
// The clock-based 300 ms bid cooldown is independent of bot scheduling.
// Clear it here to exercise the actual retry action deterministically.
room.game.auction.cooldownUntil = 0;
reconsiderationTimer.callback();
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));
assert.equal(room.game.auction.highestBidderId, bots[0].id, 'the slow bot can bid after refreshing its stale decision');
assert.equal(room.game.auction.highestBid, 40);
console.log('PASS concurrent auction bots, stale-response protection and reconsideration');

// S18-1: two bots whose timers fire together. The second one's bid lands inside
// the 300 ms bid cooldown and is rejected; that must not be recorded as a
// finished evaluation, or the bot never bids in this auction again.
{
  const coolManager = new RoomManager();
  const coolRoom = coolManager.createRoom({ socketId: 'cool-host', clientId: 'cool-host', nickname: 'Host', roomCode: 'ACON02' });
  coolRoom.addOrReconnectPlayer({ socketId: 'cool-human', clientId: 'cool-human', nickname: 'Human' });
  coolRoom.setRoomSetting('bots', 2);
  assert.equal(coolRoom.startGame().success, true);
  const coolBots = coolRoom.game.players.filter(player => player.isBot);
  for (const bot of coolBots) bot.cash = 1500;
  const coolTimers = [];
  const coolRuntime = createRuntime({
    io: { emit() {}, on() {}, in() { return { emit() {} }; }, to() { return { emit() {} }; }, sockets: { sockets: new Map() } },
    roomManager: coolManager,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
    botAdvisor: {
      supportsChoicePhase: phase => phase === 'auction',
      async chooseAction({ candidates }) {
        const bid = candidates.find(candidate => candidate.id === 'auction:bid');
        return { actionId: bid?.id || 'auction:wait', parameters: bid ? { amount: bid.amount } : undefined, provider: 'ai', fallback: false };
      }
    },
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false, fired: false }; coolTimers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return { unref() {} }; },
    clearInterval() {}
  });
  coolRoom.game.startAuction(coolRoom.game.getTile(1), coolRoom.game.players[0].id);
  coolRuntime.scheduleAuctionFinish(coolRoom);
  coolRuntime.scheduleBotAuction(coolRoom);
  const firstWave = coolTimers.filter(timer => timer.delay === 450);
  assert.equal(firstWave.length, 2);
  // Node drains microtasks between two timer callbacks, so the second bot starts
  // after the first one's bid is already in.
  for (const timer of firstWave) {
    timer.fired = true;
    timer.callback();
    for (let index = 0; index < 4; index += 1) await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(coolRoom.game.auction.highestBid, 20, 'only the first bot bid inside the cooldown');
  const failedTraces = (coolRoom.game.botDecisionTrace || []).filter(trace => trace.success === false);
  assert.equal(failedTraces.length, 0, 'a deferred bid is not recorded as a failed decision');
  const retry = coolTimers.filter(timer => timer.delay >= 450 && timer.delay < 5000 && !timer.cleared && !timer.fired);
  assert.equal(retry.length >= 1, true, 'the bot whose bid hit the cooldown is re-armed');
  coolRoom.game.auction.cooldownUntil = 0;
  retry.forEach(timer => { timer.fired = true; timer.callback(); });
  for (let index = 0; index < 4; index += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(coolRoom.game.auction.highestBid > 20, true, 'the second bot gets to bid once the cooldown has passed');
  console.log('PASS bot auction bid rejected by the cooldown is retried');
}
