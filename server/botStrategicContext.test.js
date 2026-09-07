// Provider-boundary tests for the versioned strategic snapshot. These assert
// observable context shape and privacy, not the projection's helper layout.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { buildBotStrategicContext, BOT_CONTEXT_VERSION, BOT_RULE_VERSION } from './botStrategicContext.js';

const manager = new RoomManager();
const room = manager.createRoom({
  socketId: 'context-host',
  clientId: 'context-host',
  nickname: 'Context Bot',
  color: '#d74438',
  isBot: true
});
room.addOrReconnectPlayer({ socketId: 'context-human', clientId: 'context-human', nickname: 'Human', color: '#286ea1' });
room.setRoomSetting('bots', 1);
assert.equal(room.startGame().success, true);

const game = room.game;
const bot = game.players.find(player => player.isBot);
const human = game.players.find(player => !player.isBot);
const deed = game.getTile(1);
deed.ownerId = bot.id;
deed.houseCount = 2;
bot.properties = [deed.index];
bot.position = 3;
game.currentPlayerId = bot.id;
game.turnOrder = [bot.id, human.id];
game.globalEvent = {
  id: 'housing-bubble',
  title: 'HOUSING BUBBLE POP',
  category: 'ECONOMIC',
  phase: 'active',
  roundsRemaining: 4,
  durationRounds: 7,
  effects: { rentMultiplier: 0.65, constructionBlocked: true },
  choices: null
};
game.pendingPayment = { playerId: bot.id, amountRemaining: 140, creditorId: human.id };

const context = buildBotStrategicContext(game, bot, 'payment', 7);
assert.equal(context.contextVersion, BOT_CONTEXT_VERSION);
assert.equal(context.phase, 'payment');
assert.equal(context.decisionSequence, 7);
assert.equal(context.botState.position, 3);
assert.equal(context.botState.currentTile.name, 'Rio');
assert.deepEqual(context.botState.completeGroups, []);
assert.equal(context.botState.properties[0].ownerSeat, 'self');
assert.equal(context.botState.properties[0].houseCount, 2);
assert.equal(context.turn.currentSeat, 'self');
assert.equal(context.turn.turnCount, 2);
assert.equal(context.obligations.payment.amountRemaining, 140);
assert.equal(context.obligations.payment.creditorSeat, 'opponent-2');
assert.equal(context.activeEvent.id, 'housing-bubble');
assert.equal(context.rulesDigest.version, BOT_RULE_VERSION);
assert.equal(context.rulesDigest.boardSize, 40);
assert.equal(context.rulesDigest.globalEvents.activeEffects.constructionBlocked, true);
assert.equal(context.opponents.length, 1);

const serialized = JSON.stringify(context);
assert.equal(serialized.includes('context-host'), false);
assert.equal(serialized.includes('context-human'), false);
assert.equal(serialized.includes('accountId'), false);
assert.equal(serialized.includes('socketId'), false);
console.log('bot strategic context: 16 passed, 0 failed');
