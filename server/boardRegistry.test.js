import assert from 'node:assert/strict';
import { boardDefinition, decksForVariant, tileIndexById, tilesForVariant } from './boardRegistry.js';

const standard = tilesForVariant('standard-40');
assert.equal(standard.length, 40);
assert.equal(standard[0].name, 'Start');
assert.equal(Object.prototype.hasOwnProperty.call(standard[0], 'tileId'), false);

const metro = tilesForVariant('metro-52');
assert.equal(metro.length, 52);
assert.deepEqual([metro[0].index, metro[13].index, metro[26].index, metro[39].index], [0, 13, 26, 39]);
assert.equal(metro[10].tileId, 'lagos');
assert.equal(metro[10].group, 'Metro Gold');
assert.equal(tileIndexById('metro-52', 'seoul'), 23);
assert.equal(tileIndexById('metro-52', 'jnb-airport'), 36);
assert.equal(boardDefinition('metro-52').spacesPerSide, 13);
const metroDeck = decksForVariant('metro-52');
assert.equal(metroDeck.surprise.find(card => card.action === 'moveTo' && card.tileIndex === 39).tileId, 'marina-bay');
console.log('board registry: 12 passed, 0 failed');
