import assert from 'node:assert/strict';
import fs from 'node:fs';

globalThis.window = { matchMedia: () => ({ matches: false }) };
const { casinoResultCopy } = await import('./clientCasinoUi.js');
delete globalThis.window;

assert.equal(casinoResultCopy(null), '', 'an unplayed wheel has no filler result');
assert.equal(casinoResultCopy({ resultColor: 'red', pocket: 7, net: 100 }), 'LAST SPIN · RED 7 · +$100');
assert.equal(casinoResultCopy({ resultColor: 'black', pocket: 20, net: -10 }), 'LAST SPIN · BLACK 20 · -$10');
assert.equal(casinoResultCopy({ resultColor: 'green', pocket: 0, net: 0 }), 'LAST SPIN · GREEN 0 · +$0');

const source = fs.readFileSync(new URL('./clientCasinoUi.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /EUROPEAN WHEEL|Choose a disclosed pocket|The server settles the result before any animation/, 'the header omits verbose visible setup copy');
assert.match(source, /class="sr-only" id="casino-modal-description">Choose a pocket and stake your in-game cash\.<\/p>/, 'the dialog retains a short accessible description');
assert.match(source, /18\/37 · 1:1/);
assert.match(source, /1\/37 · 35:1/);
assert.match(source, /limits\.lastResult \? "" : " hidden"/, 'hide only the empty result');
assert.match(source, /removeAttribute\("hidden"\)/, 'a settled result becomes visible');
const css = fs.readFileSync(new URL('./ui-review-market.css', import.meta.url), 'utf8');
assert.match(css, /#casino-modal \.casino-choice\s*\{[^}]*min-height: 60px/, 'the bet choices provide a taller target');
assert.match(css, /input:focus-visible/, 'radio choices retain keyboard focus');
assert.match(css, /button\[type="submit"\][^}]+min-height: 54px/s, 'the spin action has a comfortable height');
console.log('PASS casino empty state, settled result text, keyboard focus, and spin action');
