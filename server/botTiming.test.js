import assert from 'node:assert/strict';
import { scheduleBotTimer } from './botTiming.js';

const delays = [];
const callback = () => {};
const fakeSetTimeout = (_callback, delay) => {
  delays.push(delay);
  return { delay };
};

scheduleBotTimer(fakeSetTimeout, callback, 'turn');
scheduleBotTimer(fakeSetTimeout, callback, 'auction');
scheduleBotTimer(fakeSetTimeout, callback);

assert.deepEqual(delays, [300, 450, 300]);
console.log('bot timing: ordinary turns 300 ms, auctions 450 ms');
