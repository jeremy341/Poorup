import assert from 'node:assert/strict';
import { botMovementSettleDelayMs, scheduleBotTimer } from './botTiming.js';

const delays = [];
const callback = () => {};
const fakeSetTimeout = (_callback, delay) => {
  delays.push(delay);
  return { delay };
};

scheduleBotTimer(fakeSetTimeout, callback, 'turn');
scheduleBotTimer(fakeSetTimeout, callback, 'auction');
scheduleBotTimer(fakeSetTimeout, callback);
scheduleBotTimer(fakeSetTimeout, callback, 'turn', 1_500);

assert.deepEqual(delays, [300, 450, 300, 1_500]);

const before = new Map([['bot-one', 0], ['bot-two', 10]]);
assert.equal(botMovementSettleDelayMs(before, {
  tiles: Array.from({ length: 40 }),
  players: [{ id: 'bot-one', position: 5 }, { id: 'bot-two', position: 20 }]
}), 3_000, 'the next bot waits for the longest pawn walk in the preceding action');
assert.equal(botMovementSettleDelayMs(new Map([['bot-one', 38]]), {
  tiles: Array.from({ length: 40 }),
  players: [{ id: 'bot-one', position: 2 }]
}), 1_200, 'forward movement across the board edge still has a bounded walk delay');
assert.equal(botMovementSettleDelayMs(new Map([['bot-one', 10]]), {
  tiles: Array.from({ length: 40 }),
  players: [{ id: 'bot-one', position: 10 }]
}), 0, 'stationary actions add no movement wait');
assert.equal(botMovementSettleDelayMs(new Map([['bot-one', 10]]), {
  tiles: Array.from({ length: 40 }),
  players: [{ id: 'bot-one', position: 30 }]
}), 0, 'teleport-like moves outside the animated forward path do not stall the bot scheduler');
console.log('bot timing: ordinary turns 300 ms, auctions 450 ms, movement pacing bounded and deterministic');
