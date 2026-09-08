// Bot-brain settings are room-authoritative: the client can request a mode,
// but only normalized values reach GameState and queued CPU seats.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const manager = new RoomManager();
const room = manager.createRoom({ socketId: 'bot-settings-a', clientId: 'bot-settings-a', nickname: 'Host' });

assert.equal(room.settings.botBrain, 'auto');
assert.equal(room.settings.botDifficulty, 'table');
room.setRoomSetting('botBrain', 'AI');
room.setRoomSetting('botDifficulty', 'EXPERT');
assert.equal(room.settings.botBrain, 'ai');
assert.equal(room.game.settings.botBrain, 'ai');
assert.equal(room.settings.botDifficulty, 'expert');
assert.equal(room.game.settings.botDifficulty, 'expert');

room.setRoomSetting('botBrain', 'NO-AI');
room.setRoomSetting('botDifficulty', 'not-a-level');
assert.equal(room.settings.botBrain, 'no-ai');
assert.equal(room.settings.botDifficulty, 'table');

room.setRoomSetting('bots', 1);
room.setRoomSetting('botPersonality', 'builder');
room.ensureBots();
const bot = room.game.players.find(player => player.isBot);
assert.ok(bot);
assert.equal(bot.personality, 'builder');
room.setRoomSetting('botPersonality', 'shark');
room.setRoomSetting('botDifficulty', 'house');
assert.equal(bot.personality, 'shark');
assert.equal(room.settings.botDifficulty, 'house');

const trace = room.game.recordBotDecisionTrace({
  botId: bot.id,
  gameId: 'bot-settings-game',
  ruleVersion: 'bot-policy-v1',
  decisionSequence: 3,
  phase: 'pre-roll',
  provider: 'deterministic',
  fallback: true,
  fallbackReason: 'no-ai-mode',
  brain: 'no-ai',
  difficulty: 'house',
  planningHorizon: 3,
  strategicScore: 42.5,
  actionId: 'roll',
  confidence: 0.45,
  reasonCode: 'deterministic-house',
  latencyMs: 2,
  candidateIds: ['roll']
});
assert.equal(trace.actionId, 'roll');
assert.equal(trace.botId, bot.id);
assert.equal(trace.ruleVersion, 'bot-policy-v1');
assert.equal(trace.planningHorizon, 3);
assert.equal(trace.strategicScore, 42.5);
assert.equal(trace.success, true);
assert.equal(room.game.botDecisionTrace.length, 1);

for (let sequence = 4; sequence <= 205; sequence += 1) {
  room.game.recordBotDecisionTrace({ botId: bot.id, decisionSequence: sequence, actionId: 'roll', success: sequence !== 6 });
}
assert.equal(room.game.botDecisionTrace.length, 200);
assert.equal(room.game.botDecisionTrace[0].sequence, 6);
bot.disconnected = true;
assert.deepEqual(room.runBotAction(bot.id, () => ({ success: true })), { success: false, error: 'Bot is unavailable.' });
bot.disconnected = false;
bot.bankrupt = true;
assert.deepEqual(room.runBotAction(bot.id, () => ({ success: true })), { success: false, error: 'Bot is unavailable.' });
console.log('bot-brain room settings: 10 passed, 0 failed');
