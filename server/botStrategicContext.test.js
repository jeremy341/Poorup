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
game.botDecisionTrace = [
  { botId: bot.id, sequence: 4, phase: 'pre-roll', actionId: 'mortgage:1', fallback: true, success: false, strategicScore: 3.5, reasonCode: 'cash-buffer' },
  { botId: human.id, sequence: 5, phase: 'pre-roll', actionId: 'roll', fallback: false },
  { botId: bot.id, sequence: 6, phase: 'auction', actionId: 'auction:pass', fallback: false, strategicScore: -2, reasonCode: 'reserve' }
];

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
assert.equal(context.rulesDigest.cards.surpriseCount, 16);
assert.equal(context.rulesDigest.cards.treasureCount, 16);
assert.equal(context.rulesDigest.globalEvents.activeEffects.constructionBlocked, true);
assert.equal(context.opponents.length, 1);
assert.deepEqual(context.recentDecisions.map(entry => entry.actionId), ['mortgage:1', 'auction:pass']);
assert.equal(context.recentDecisions[0].fallback, true);
assert.equal(context.recentDecisions[0].success, false);
assert.equal(context.decisionMemory.decisions, 2);
assert.equal(context.decisionMemory.failures, 1);
assert.equal(context.decisionMemory.actionRates[0].actionId, 'mortgage:1');
assert.ok(Array.isArray(context.opponents[0].nearGroups));
assert.equal(typeof context.opponents[0].cashExactBucket, 'number');
assert.equal(typeof context.opponents[0].desire, 'string');
assert.ok(context.table && typeof context.table.rank === 'number');
assert.ok(Array.isArray(context.table.threats));
assert.ok(Array.isArray(context.table.alliances));

game.pendingTrade = {
  id: 'internal-offer-id', fromPlayerId: human.id, toPlayerId: bot.id,
  giveCash: 250, requestCash: 40, givePropertyIndexes: [deed.index], requestPropertyIndexes: [], counterDepth: 1
};
const tradeContext = buildBotStrategicContext(game, bot, 'trade', 8);
assert.deepEqual(tradeContext.obligations.trade, {
  role: 'recipient', giveCash: 40, requestCash: 250,
  givePropertyIndexes: [], requestPropertyIndexes: [deed.index], counterDepth: 1
});

game.pendingPlayerContract = {
  id: 'internal-contract-id', fromPlayerId: human.id, toPlayerId: bot.id,
  kind: 'equity', amount: 300, premiumRate: 12, durationRounds: 5,
  propertyIndex: 4, collateralTileIndex: 7, equityShare: 15, equityControl: 'passive',
  conversionShare: 25, expiresRound: null
};
const contractContext = buildBotStrategicContext(game, bot, 'contract', 9);
assert.deepEqual(contractContext.obligations.contract, {
  role: 'recipient', kind: 'equity', amount: 300, premiumRate: 12, durationRounds: 5,
  propertyIndex: 4, collateralTileIndex: 7, equityShare: 15, equityControl: 'passive',
  conversionShare: 25, permanent: true
});

const serialized = JSON.stringify(context);
assert.equal(serialized.includes('context-host'), false);
assert.equal(serialized.includes('context-human'), false);
assert.equal(serialized.includes('accountId'), false);
assert.equal(serialized.includes('socketId'), false);
console.log('bot strategic context: 18 passed, 0 failed');

game.publicActionHistory = [
  ...Array.from({ length: 20 }, (_, index) => ({
    actionKind: index % 2 ? 'auction-bid' : 'trade-counter',
    seatIndex: game.players.indexOf(human),
    roundNumber: game.roundNumber
  }))
];
const profileContext = buildBotStrategicContext(game, bot, 'pre-roll', 10);
assert.equal(profileContext.opponentProfilesEnabled, false, 'public-action profiling stays production-disabled pending held-out gates');
assert.equal(profileContext.opponents[0].publicActionProfile.status, 'unknown');
const profileJson = JSON.stringify(profileContext);
assert.equal(profileJson.includes(human.id), false);
assert.equal(profileJson.includes('offer'), false);
assert.equal(profileJson.includes('cashExactBucket'), true, 'existing context is retained independently of profile history');
