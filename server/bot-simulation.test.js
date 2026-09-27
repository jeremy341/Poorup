// Bounded integration checks for the shared, seeded policy simulation path.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { DeterministicAdvisor } from './botAdvisor.js';
import { runBotTurn } from './botLogic.js';
import { createBotPolicy, simulateBotMatch } from './bot-policy-tournament.js';
import { summarizeBalanceCampaign } from './balanceMetrics.js';

const SIMULATION_COUNT = Math.max(1, Math.floor(Number(process.env.POORUP_BOT_SIMULATION_COUNT) || 1_000));
const START_INDEX = Math.max(1, Math.floor(Number(process.env.POORUP_BOT_SIMULATION_START_INDEX) || 1));
const STEP_LIMIT = Math.max(1, Math.floor(Number(process.env.POORUP_BOT_STEP_LIMIT) || 2_000));

async function assertZeroCashPostRollBotsResolve() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'zero-cash-host', clientId: 'zero-cash-host', nickname: 'ZERO CASH', isBot: true });
  room.setRoomSetting('startingCash', 500);
  room.setRoomSetting('bots', 3);
  room.setRoomSetting('auction', false);
  room.setRoomSetting('casino', false);
  room.setRoomSetting('market', false);
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  bot.cash = 0;
  bot.properties = [];
  bot.personality = 'builder';
  room.game.currentPlayerId = bot.id;
  room.game.hasRolled = true;
  room.game.awaitingEndTurn = true;
  room.game.botDecisionSequence = 0;
  const candidates = room.game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: true });
  assert.ok(candidates.some(candidate => candidate.kind === 'bankruptcy'));
  assert.equal(candidates.some(candidate => candidate.kind === 'end-turn'), false);
  const result = await runBotTurn(room, bot, new DeterministicAdvisor());
  assert.equal(bot.bankrupt, true);
  assert.equal(result.success, true);
}

await assertZeroCashPostRollBotsResolve();

const results = [];
for (let index = START_INDEX; index < START_INDEX + SIMULATION_COUNT; index += 1) {
  const policyBySeat = Array.from({ length: 3 }, (_, seat) => createBotPolicy(`safety-no-ai-${seat}`, {
    brain: 'no-ai',
    advisor: new DeterministicAdvisor()
  }));
  results.push(await simulateBotMatch({
    seed: index * 1009 + 7,
    policyBySeat,
    stepLimit: STEP_LIMIT,
    captureTrace: process.env.POORUP_BOT_CAPTURE_TRACE === '1'
  }));
}

assert.equal(results.length, SIMULATION_COUNT);
assert.ok(results.every(result => result.steps > 0));
assert.ok(results.every(result => result.stalls === 0), 'bounded policy games must not stall');
assert.ok(results.every(result => Object.values(result.netWorthByPolicy).every(Number.isFinite)));
console.log(`bot simulations: ${SIMULATION_COUNT} bounded games passed, ${results.filter(result => result.ended).length} ended within ${STEP_LIMIT} steps, 0 stalls`);
if (process.env.POORUP_BOT_BALANCE_JSON === '1') {
  console.log(`BALANCE_REPORT_JSON=${JSON.stringify(summarizeBalanceCampaign(results))}`);
}
