// Lucky Table global event: while it is active (with item rewards on) card draws hand over item cards more often than the normal
// deck draw; outside the event the draw is unchanged; the event lasts exactly one round.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { decksForVariant } from './boardRegistry.js';
import { LUCKY_TABLE_ITEM_DRAW_ODDS } from './cardApi.js';

const SAMPLES = 20000;

function makeItemRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', rulesProfile: 'advanced' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.setRoomSetting('globalEvents', true);
  room.setRoomSetting('itemRewards', true);
  assert.equal(room.startGame().success, true);
  return room;
}

// Item-draw rate over many single draws. Each draw starts from a fresh deck so every sample is a plain uniform draw from the
// full Surprise (or Treasure) deck, which keeps the baseline rate exact and independent of earlier draws.
function itemDrawRate(game, deckName = 'surprise') {
  let items = 0;
  for (let n = 0; n < SAMPLES; n += 1) {
    game.surpriseDeck = [];
    game.treasureDeck = [];
    const card = game.drawCard(deckName);
    if (card.action === 'itemReward') items += 1;
  }
  return items / SAMPLES;
}

function baselineItemRate(game, deckName = 'surprise') {
  const variant = decksForVariant(game.boardVariant || 'standard-40', game.settings)[deckName === 'treasure' ? 'treasure' : 'surprise'];
  const itemCount = variant.filter(card => card.action === 'itemReward').length;
  return itemCount / variant.length;
}

function testOutsideEventKeepsNormalOdds() {
  const room = makeItemRoom();
  const game = room.game;
  game.roundNumber = 4;
  assert.equal(game.globalEventActive('lucky-table'), false);
  const expected = baselineItemRate(game);
  const observed = itemDrawRate(game);
  assert.ok(expected > 0, 'the item cards are in the deck');
  assert.ok(Math.abs(observed - expected) < 0.015, `normal item rate ${observed} should sit near the deck baseline ${expected}`);
}

function testInsideEventUsesHigherOdds() {
  const room = makeItemRoom();
  const game = room.game;
  game.roundNumber = 4;
  const normal = baselineItemRate(game);
  game.activateGlobalEvent(game.globalEventDefinition('lucky-table'));
  game.globalEvent.phase = 'active';
  assert.equal(game.globalEventActive('lucky-table'), true);
  // A forced 1 in LUCKY_TABLE_ITEM_DRAW_ODDS item draw on top of the normal chance.
  const luckyChance = 1 / LUCKY_TABLE_ITEM_DRAW_ODDS;
  const expected = luckyChance + (1 - luckyChance) * normal;
  const observed = itemDrawRate(game);
  assert.ok(Math.abs(observed - expected) < 0.02, `lucky item rate ${observed} should sit near ${expected}`);
  assert.ok(observed > normal + 0.05, `lucky item rate ${observed} should clearly exceed the normal rate ${normal}`);
}

function testTreasureDeckAlsoGetsLuckyDraws() {
  const room = makeItemRoom();
  const game = room.game;
  game.roundNumber = 4;
  game.activateGlobalEvent(game.globalEventDefinition('lucky-table'));
  game.globalEvent.phase = 'active';
  const observed = itemDrawRate(game, 'treasure');
  assert.ok(observed > 0.1, `treasure lucky item rate ${observed} should exceed 1 in 10`);
}

function testLuckyTableNeedsItemRewards() {
  const room = makeItemRoom();
  const game = room.game;
  game.settings.itemRewards = false;
  game.activateGlobalEvent(game.globalEventDefinition('lucky-table'));
  game.globalEvent.phase = 'active';
  const observed = itemDrawRate(game);
  assert.equal(observed, 0, 'with item rewards off the event adds no item cards');
}

function testEventEndsAfterOneRound() {
  const room = makeItemRoom();
  const game = room.game;
  game.roundNumber = 4;
  game.activateGlobalEvent(game.globalEventDefinition('lucky-table'));
  assert.equal(game.globalEvent.durationRounds, 1);
  assert.equal(game.globalEvent.phase, 'warning');

  game.roundNumber = 5;
  game.advanceGlobalEventPhase();
  assert.equal(game.globalEvent.phase, 'active');
  assert.equal(game.globalEventActive('lucky-table'), true);

  game.roundNumber = 6;
  game.advanceGlobalEventPhase();
  assert.equal(game.globalEvent.phase, 'recovery', 'the event enters recovery after its single active round');
  assert.equal(game.globalEventActive('lucky-table'), false);

  game.advanceGlobalEventPhase();
  assert.equal(game.globalEvent, null, 'the recovery round archives the event');
  assert.equal(game.globalEventHistory[0].id, 'lucky-table');
}

const tests = [
  testOutsideEventKeepsNormalOdds,
  testInsideEventUsesHigherOdds,
  testTreasureDeckAlsoGetsLuckyDraws,
  testLuckyTableNeedsItemRewards,
  testEventEndsAfterOneRound
];

for (const test of tests) {
  test();
  console.log(`ok - ${test.name}`);
}
