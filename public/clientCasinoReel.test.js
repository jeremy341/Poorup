import assert from 'node:assert/strict';
import { casinoReelHTML } from './clientCasinoReel.js';

const html = casinoReelHTML({
  transactionId: 'tx-1',
  spinId: 'spin-1',
  pocket: 0,
  resultColor: 'green',
  net: 350,
  presentation: { reelSeed: 'audit-seed', targetIndex: 32, durationMs: 4200 }
});
assert.equal((html.match(/data-pocket=/g) || []).length, 45);
assert.equal(html.includes('data-reel-spin="spin-1"'), true);
assert.equal(html.includes('data-reel-target="32"'), true);
assert.equal(html.includes('casino-reel-card-green is-target" data-pocket="00"'), true);
assert.equal(html.includes('SKIP REVEAL'), true);

console.log('casino reel client: 1 passed, 0 failed');
