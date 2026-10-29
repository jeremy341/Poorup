// Bounded integration checks for the shared, seeded policy simulation path.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { DeterministicAdvisor } from './botAdvisor.js';
import { runBotTurn } from './botLogic.js';
import { createBotPolicy, simulateBotMatch } from './bot-policy-tournament.js';
import { summarizeBalanceCampaign } from './balanceMetrics.js';

// Planner bots play real games to the end (about a second each), so the suite runs a
// bounded sample; POORUP_BOT_SIMULATION_COUNT=1000 runs the full campaign.
const SIMULATION_COUNT = Math.max(1, Math.floor(Number(process.env.POORUP_BOT_SIMULATION_COUNT) || 60));
const START_INDEX = Math.max(1, Math.floor(Number(process.env.POORUP_BOT_SIMULATION_START_INDEX) || 1));
const STEP_LIMIT = Math.max(1, Math.floor(Number(process.env.POORUP_BOT_STEP_LIMIT) || 2_000));
// The campaign must model the economy players actually get. The room default is
// 1500 (roomSettings.js), so the campaign defaults to it; POORUP_BOT_STARTING_CASH=500
// runs the low-capital variant that the previous hardcoded 500 approximated.
const STARTING_CASH = Math.max(1, Math.floor(Number(process.env.POORUP_BOT_STARTING_CASH) || 1_500));

// A broke bot with its roll done resolves on its own tick: it takes the bank loan when one is
// on offer (it must not declare bankruptcy without trying), and
// declares bankruptcy only when no loan is available.
async function assertZeroCashPostRollBotsResolve({ loanAvailable }) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'zero-cash-host', clientId: 'zero-cash-host', nickname: 'ZERO CASH', isBot: true, rulesProfile: 'advanced', rulesetOverrides: [{ key: 'bankLoans', value: true }] });
  room.setRoomSetting('startingCash', 500);
  room.setRoomSetting('bots', 3);
  room.setRoomSetting('auction', false);
  room.setRoomSetting('casino', false);
  room.setRoomSetting('market', false);
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  if (!loanAvailable) room.game.getBankLoanOffer = () => ({ available: false });
  bot.cash = 0;
  bot.properties = [];
  room.game.currentPlayerId = bot.id;
  room.game.hasRolled = true;
  room.game.awaitingEndTurn = true;
  room.game.botDecisionSequence = 0;
  const candidates = room.game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: true });
  assert.ok(candidates.some(candidate => candidate.kind === 'bankruptcy'));
  assert.equal(candidates.some(candidate => candidate.kind === 'loan'), loanAvailable);
  assert.equal(candidates.some(candidate => candidate.kind === 'end-turn'), false);
  const result = await runBotTurn(room, bot, new DeterministicAdvisor());
  assert.equal(bot.bankrupt, !loanAvailable);
  assert.equal(bot.cash, loanAvailable ? 300 : 0, 'the loan principal reached the bot');
  assert.equal(result.success, true);
}

await assertZeroCashPostRollBotsResolve({ loanAvailable: true });
await assertZeroCashPostRollBotsResolve({ loanAvailable: false });

async function assertAuctionWaitAdvancesToDeadline() {
  const advisor = {
    supportsChoicePhases: true,
    async chooseAction({ candidates = [] }) {
      return { actionId: candidates.find(candidate => candidate.id === 'auction:wait')?.id || candidates[0]?.id };
    }
  };
  const policyBySeat = Array.from({ length: 3 }, (_, index) => createBotPolicy(`auction-wait-${index}`, { advisor }));
  const result = await simulateBotMatch({
    seed: 77,
    policyBySeat,
    settings: { startingCash: 50, auction: true, casino: false, market: false, globalEvents: false },
    stepLimit: 200,
    captureTrace: true
  });
  assert.equal(result.stalls, 0, 'waiting bots must let simulated auction time reach its deadline');
  const waitIndex = result.decisionTrace.findIndex(entry => entry.actionId === 'auction:wait');
  assert.notEqual(waitIndex, -1, 'the scenario reaches a reconsiderable wait decision');
  assert.ok(result.decisionTrace.slice(waitIndex + 1).some(entry => entry.phase !== 'auction'), 'the match resumes ordinary turns after the auction deadline');
}

await assertAuctionWaitAdvancesToDeadline();

const results = [];
for (let index = START_INDEX; index < START_INDEX + SIMULATION_COUNT; index += 1) {
  const policyBySeat = Array.from({ length: 3 }, (_, seat) => createBotPolicy(`safety-no-ai-${seat}`, {
    brain: 'no-ai',
    advisor: new DeterministicAdvisor()
  }));
  results.push(await simulateBotMatch({
    seed: index * 1009 + 7,
    policyBySeat,
    settings: { startingCash: STARTING_CASH },
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
