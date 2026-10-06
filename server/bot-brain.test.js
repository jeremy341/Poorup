// Bot-brain settings are room-authoritative: the client can request a mode,
// but only normalized values reach GameState and queued CPU seats.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { BOT_PRESETS, resolveBotPreset } from './roomSettings.js';

const manager = new RoomManager();
const room = manager.createRoom({ socketId: 'bot-settings-a', clientId: 'bot-settings-a', nickname: 'Host' });

assert.equal(room.settings.botBrain, 'ai');
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
room.setRoomSetting('botBrain', 'AUTO');
assert.equal(room.settings.botBrain, 'ai');
assert.equal(room.settings.botDifficulty, 'table');

room.setRoomSetting('bots', 1);
assert.equal(room.setRoomSetting('botPersonality', 'builder').rejected, true);
room.ensureBots();
const bot = room.game.players.find(player => player.isBot);
assert.ok(bot);
assert.equal('personality' in bot, false);
assert.equal('botPersonality' in room.settings, false);
const botSummary = room.game.getGameSummary().players.find(player => player.isBot);
assert.equal('personality' in botSummary, false);
assert.equal(botSummary.botDifficulty, 'table');
room.setRoomSetting('botDifficulty', 'house');
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

assert.deepEqual(BOT_PRESETS.easy, { botBrain: 'no-ai', botDifficulty: 'house' });
assert.deepEqual(BOT_PRESETS.medium, { botBrain: 'ai', botDifficulty: 'table' });
assert.deepEqual(BOT_PRESETS.hard, { botBrain: 'ai', botDifficulty: 'expert' });
assert.deepEqual(resolveBotPreset('HARD'), BOT_PRESETS.hard);
assert.equal(resolveBotPreset('unknown'), null);
room.setRoomSetting('botBrain', 'all');
assert.equal(room.settings.botBrain, 'ai');
console.log('bot-brain room settings and shared candidate policy passed');

function candidateProfile(brain, difficulty) {
  const fixture = new RoomManager().createRoom({ socketId: `${brain}-${difficulty}`, clientId: `${brain}-${difficulty}`, nickname: 'COMPARE' });
  fixture.setRoomSetting('bots', 1);
  fixture.setRoomSetting('botBrain', brain);
  fixture.setRoomSetting('botDifficulty', difficulty);
  fixture.setRoomSetting('market', true);
  fixture.setRoomSetting('casino', true);
  assert.equal(fixture.startGame().success, true);
  const bot = fixture.game.players.find(player => player.isBot);
  return fixture.game.getBotCandidates(bot).map(candidate => ({
    kind: candidate.kind,
    tileIndex: candidate.tileIndex ?? null,
    instrumentId: candidate.instrumentId ?? null,
    side: candidate.side ?? null,
    quantity: candidate.quantity ?? null,
    score: candidate.score,
    risk: candidate.risk
  }));
}

const legalNoAi = candidateProfile('no-ai', 'house');
assert.deepEqual(candidateProfile('ai', 'table'), legalNoAi, 'brain selection does not alter the server-issued legal action set');
assert.deepEqual(candidateProfile('no-ai', 'expert'), legalNoAi, 'difficulty changes reasoning depth, not action legality');
