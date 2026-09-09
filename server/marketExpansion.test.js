import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function roomAt(complexity) {
  const room = new RoomManager().createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', rulesetPreset: 'after-hours', marketComplexity: complexity });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.setRoomSetting('market', true);
  room.setRoomSetting('marketComplexity', complexity);
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

const basic = roomAt('basic');
assert.equal(basic.openMargin('a', 'brazil', 1, 'm1').success, false);
const margin = roomAt('margin');
const open = margin.openMargin('a', 'brazil', 2, 'm1');
assert.equal(open.success, true);
assert.equal(margin.game.players[0].marginPositions.brazil.quantity, 2);
assert.equal(margin.reduceMargin('a', 50, 'm2').success, true);
const short = roomAt('shorting');
const openShort = short.openShort('a', 'brazil', 1, 's1');
assert.equal(openShort.success, true);
assert.equal(short.game.players[0].shortPositions.brazil.quantity, 1);
assert.equal(short.coverShort('a', 'brazil', 1, 's2').success, true);
short.game.globalEvent = { id: 'credit-freeze', phase: 'active', effects: {} };
assert.equal(short.openShort('a', 'brazil', 1, 's3').success, false);
const derivatives = roomAt('derivatives');
const option = derivatives.openOption('a', { instrumentId: 'brazil', side: 'call', quantity: 1, strike: 80, premium: 10, expiryRounds: 3, requestId: 'opt-1' });
assert.equal(option.success, true);
assert.equal(derivatives.openOption('a', { instrumentId: 'brazil', side: 'call', quantity: 1, strike: 80, premium: 10, expiryRounds: 3, requestId: 'opt-1' }).option.id, option.option.id);
assert.equal(derivatives.game.players[0].optionPositions.length, 1);
derivatives.game.marketQuotes.brazil = 140;
assert.equal(derivatives.exerciseOption('a', option.option.id, 'exercise-1').success, true);
const writer = roomAt('derivatives');
writer.game.players[0].cash = 100;
assert.equal(writer.openOption('a', { instrumentId: 'brazil', role: 'writer', side: 'call', quantity: 2, strike: 100 }).success, false);
assert.ok(writer.game.players[0].cash >= 0);
const marginLow = roomAt('margin');
marginLow.game.players[0].cash = 1;
assert.equal(marginLow.openMargin('a', 'brazil', 10, 'low').success, false);
assert.ok(marginLow.game.players[0].cash >= 0);
const marginPlayer = margin.game.players[0];
marginPlayer.marginMaintenance = 500;
marginPlayer.marginPositions = { brazil: { quantity: 1, averageCost: 100 } };
margin.game.marketQuotes.brazil = 10;
assert.equal(margin.openMargin('a', 'brazil', 1, 'blocked').success, false);
assert.ok(derivatives.marketExpansionCandidates(derivatives.game.players[0]).length >= 1);
console.log('market expansion: 12 passed, 0 failed');
