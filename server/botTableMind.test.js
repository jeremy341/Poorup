// Unit tests for opponent minds: beliefs, desires, emotions, ledger,
// alliance scoring from existing state only.
import assert from 'node:assert/strict';
import * as botTableMind from './botTableMind.js';
import {
  wantedGroups,
  desireClass,
  emotionReadout,
  allianceScore,
  coalitionAgainst,
  tickLedger,
  addGrudge,
  addGratitude,
  readMind,
} from './botTableMind.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const TILES = {
  1: { index: 1, price: 60, group: 'Brown', ownerId: 'H' },
  3: { index: 3, price: 60, group: 'Brown', ownerId: 'BOT' },
  16: { index: 16, price: 180, group: 'Orange', ownerId: 'H' },
  18: { index: 18, price: 180, group: 'Orange', ownerId: 'H' },
  19: { index: 19, price: 200, group: 'Orange', ownerId: 'C' },
};

function fakeGame(over = {}) {
  const players = [
    { id: 'BOT', cash: 800, bankrupt: false, disconnected: false },
    { id: 'H', cash: 1500, bankrupt: false, disconnected: false, lastVoteChoice: 'low-tax' },
    { id: 'C', cash: 1500, bankrupt: false, disconnected: false, lastVoteChoice: 'low-tax' },
  ];
  return {
    tiles: Object.values(TILES),
    players,
    settings: { startingCash: 1500 },
    playerContracts: [],
    pendingTrade: null,
    pendingSponsoredPurchase: null,
    getTile: index => TILES[index] || null,
    getGroupTiles: group => Object.values(TILES).filter(tile => tile.group === group),
    getPlayerById: id => players.find(player => player.id === id) || null,
    ...over,
  };
}

check('wanted groups rank urgency first', () => {
  const wanted = wantedGroups(fakeGame(), 'H');
  assert.deepEqual(wanted.map(entry => entry.group), ['Orange', 'Brown']);
});

check('desires classify from portfolio facts', () => {
  const game = fakeGame();
  assert.equal(desireClass(game, game.players[1]), 'monopolist');
  assert.equal(desireClass(game, { ...game.players[1], cash: 10 }), 'survivor');
  assert.equal(desireClass(game, null), 'drifter');
});

check('emotions derive from facts, never chat', () => {
  const game = fakeGame();
  game.pendingPayment = { playerId: 'H' };
  assert.equal(emotionReadout(game, game.players[0], { ...game.players[1], cash: 100 }), 'desperate');
  assert.equal(emotionReadout(game, game.players[0], { ...game.players[1], casinoNet: -900 }), 'tilting');
  assert.equal(emotionReadout(game, game.players[0], game.players[1]), 'steady');
  assert.equal(
    emotionReadout(game, { ...game.players[0], sponsoredBy: { H: 50 } }, game.players[1]),
    'cooperative'
  );
});

check('alliance scores contracts, votes, and live offers', () => {
  const game = fakeGame();
  assert.equal(allianceScore(game, 'H', 'C'), 1); // shared vote
  assert.equal(allianceScore(game, 'BOT', 'H'), 0);
  const funded = fakeGame({
    playerContracts: [{ status: 'active', fromPlayerId: 'H', toPlayerId: 'C' }],
  });
  assert.equal(allianceScore(funded, 'H', 'C'), 3);
  assert.equal(allianceScore(game, 'H', 'H'), 0);
});

check('coalition flags teaming pairs at threshold', () => {
  const game = fakeGame({
    playerContracts: [{ status: 'active', fromPlayerId: 'H', toPlayerId: 'C' }],
  });
  const found = coalitionAgainst(game, 'BOT');
  assert.equal(found.teaming, true);
  assert.deepEqual(found.pair.sort(), ['C', 'H']);
  assert.equal(coalitionAgainst(fakeGame(), 'BOT').teaming, false);
});

check('ledger decays per round and records both directions', () => {
  const bot = {};
  addGrudge(bot, 'H', 10);
  addGratitude(bot, 'C', 5);
  tickLedger(bot, 7);
  assert.equal(bot.grudge.H, 9);
  assert.equal(bot.gratitude.C, 4);
  tickLedger(bot, 7);
  assert.equal(bot.grudge.H, 9); // same round: no double decay
  tickLedger(bot, 8);
  assert.equal(bot.grudge.H, 8);
});

check('readMind composes the full readout', () => {
  const mind = readMind(fakeGame(), fakeGame().players[0], 'H');
  assert.equal(mind.id, 'H');
  assert.equal(mind.desire, 'monopolist');
  assert.equal(mind.withMe, 0);
  assert.equal(mind.maxWithOthers, 1);
  assert.ok(Array.isArray(mind.wanted));
});

console.log(`botTableMind tests: ${passed} passed, 0 failed`);

assert.equal(typeof botTableMind.summarizePublicActionProfile, 'function', 'opponent profile summarizes only public action history');
const publicActions = [
  ...Array.from({ length: 4 }, () => ({ actionKind: 'auction-bid', seatIndex: 1, roundNumber: 10 })),
  ...Array.from({ length: 6 }, () => ({ actionKind: 'trade-counter', seatIndex: 1, roundNumber: 10 }))
];
const fourActionProfile = botTableMind.summarizePublicActionProfile(publicActions.slice(0, 4), 1, 10);
assert.equal(fourActionProfile.status, 'unknown', 'fewer than five effective observations remain unknown');
const fiveWeightProfile = botTableMind.summarizePublicActionProfile(publicActions, 1, 11);
assert.equal(fiveWeightProfile.status, 'known');
assert.equal(fiveWeightProfile.effectiveSampleWeight, 5, 'each full elapsed round halves each observation weight');
assert.equal(fiveWeightProfile.actionFrequencies['auction-bid'], 0.4);
assert.equal(fiveWeightProfile.actionFrequencies['trade-counter'], 0.6);
const decayedProfile = botTableMind.summarizePublicActionProfile(publicActions, 1, 12);
assert.equal(decayedProfile.effectiveSampleWeight, 2.5);
assert.equal(decayedProfile.status, 'unknown', 'decay can take a previously known profile below the confidence threshold');
