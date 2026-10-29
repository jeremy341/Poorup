// AI-layer regression suite.
// When nothing beats passing (a lone `roll`, or only options scored at or below standing still), the house engine answers without a provider call
// and records a house decision (`phase-resolution`), not a model ask or failure. Candidates are shuffled with a seed, so a model cannot win by echoing the first option.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { AiAdvisor, DeterministicAdvisor } from './botAdvisor.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import { runBotTurn } from './botLogic.js';
import { classifyBotDecision } from './socketRuntime.js';

const failures = [];
async function check(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.stack || error.message}`);
  }
}

// fixtures

let roomSerial = 0;
function botRoom() {
  roomSerial += 1;
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'host', clientId: 'host', nickname: 'Host', rulesProfile: 'advanced', roomCode: `AILAYER${roomSerial}` });
  for (let seat = 0; seat < 2; seat += 1) {
    room.addOrReconnectPlayer({ socketId: `seat-${seat}`, clientId: `seat-${seat}`, nickname: `Seat ${seat}` });
  }
  room.setRoomSetting('bots', 1);
  room.setRoomSetting('botDifficulty', 'table');
  assert.equal(room.startGame().success, true, 'the fixture room starts');
  const game = room.game;
  const bot = game.players.find(player => player.isBot);
  game.currentPlayerId = bot.id;
  return { room, game, bot };
}

function ownBrownSet({ game, bot }) {
  bot.cash = 1500;
  [1, 3].forEach(index => {
    game.getTile(index).ownerId = bot.id;
    bot.properties.push(index);
  });
}

function preRollContext({ game, bot }, sequence = 1) {
  return {
    botId: bot.id,
    botBrain: 'ai',
    botDifficulty: 'table',
    gameId: `ailayer:${game.startedAt || 'pending'}`,
    decisionSequence: sequence,
    ...buildBotStrategicContext(game, bot, 'pre-roll', sequence),
    candidates: game.getBotCandidates(bot, { expanded: true, parity: true })
  };
}

// An advisor whose provider answers with the token at a chosen position.
function countingAdvisor(pickPosition = () => 0) {
  const seen = [];
  const advisor = new AiAdvisor({
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      const prompt = JSON.parse(JSON.parse(options.body).messages[1].content);
      seen.push(prompt.candidates);
      const chosen = prompt.candidates[Math.min(prompt.candidates.length - 1, pickPosition(seen.length - 1, prompt.candidates))];
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ actionId: chosen.actionId, confidence: 0.9 }) } }] }) };
    }
  });
  return { advisor, seen };
}

// No provider call when nothing beats passing

await check('F4-a: a lone roll is answered by the house engine without a provider call', async () => {
  const { advisor, seen } = countingAdvisor();
  const context = { botBrain: 'ai', gameId: 'sole-roll', decisionSequence: 1, phase: 'pre-roll', candidates: [{ id: 'roll', kind: 'roll', score: 0, risk: 0 }] };
  const decision = await advisor.chooseAction(context);
  const house = await new DeterministicAdvisor().chooseAction(context);
  assert.equal(seen.length, 0, 'the provider was not called');
  assert.equal(advisor.getHealth().aiCalls, 0);
  assert.equal(advisor.decisionCounts.size, 0, 'no per-game AI budget was spent');
  assert.equal(decision.provider, 'deterministic');
  assert.equal(decision.fallback, true);
  assert.equal(decision.fallbackReason, 'phase-resolution');
  assert.equal(decision.actionId, house.actionId, 'the answer is the house advisor answer');
  assert.deepEqual(classifyBotDecision(decision), { botMode: 'ai', provider: 'ai', counted: false, failed: false },
    'a by-design house decision is neither a model ask nor a model failure');
});

await check('F4-a: options the planner scores no better than standing still are decided without the provider', async () => {
  const fixture = botRoom();
  const context = preRollContext(fixture);
  assert.ok(context.candidates.length > 1 && context.candidates.some(candidate => candidate.kind !== 'roll'),
    'a fresh pre-roll offers loan proposals next to the roll');
  const { advisor, seen } = countingAdvisor();
  const decision = await advisor.chooseAction(context);
  const house = await new DeterministicAdvisor().chooseAction(context);
  assert.equal(seen.length, 0, 'the provider was not called');
  assert.equal(decision.fallbackReason, 'phase-resolution');
  assert.equal(decision.actionId, house.actionId, 'the decision is the one the house advisor makes');
});

await check('F4-a: the provider is still asked when an option clearly beats passing', async () => {
  const fixture = botRoom();
  ownBrownSet(fixture);
  const { advisor, seen } = countingAdvisor();
  const decision = await advisor.chooseAction(preRollContext(fixture));
  assert.equal(seen.length, 1, 'a monopoly that can build is a real decision for the model');
  assert.equal(decision.provider, 'ai');
});

await check('F4-a: a turn with nothing to decide runs the house action and records a by-design reason', async () => {
  const withAi = botRoom();
  const withHouse = botRoom();
  const { advisor, seen } = countingAdvisor();
  const aiResult = await runBotTurn(withAi.room, withAi.bot, advisor);
  const houseResult = await runBotTurn(withHouse.room, withHouse.bot, new DeterministicAdvisor());
  assert.equal(seen.length, 0, 'no provider call was made for the turn');
  assert.equal(aiResult.botDecision.actionId, houseResult.botDecision.actionId, 'same action as the house advisor');
  assert.equal(aiResult.success, houseResult.success, 'same engine outcome');
  assert.equal(aiResult.botDecision.provider, 'deterministic');
  assert.equal(aiResult.botDecision.fallback, true);
  assert.equal(aiResult.botDecision.fallbackReason, 'phase-resolution');
  // Dice are real (crypto), so doubles can leave a roll pending on one side only; what must
  // match is that both engines took the roll, not the post-roll phase.
  assert.ok(withAi.game.lastDice[0] > 0, 'the bot rolled');
  assert.ok(withHouse.game.lastDice[0] > 0, 'the house advisor rolled');
});

// Option-ID bias

await check('F4-b: the same seed shows the same order, different decisions show different orders', async () => {
  const fixture = botRoom();
  ownBrownSet(fixture);
  const order = async (sequence) => {
    const { advisor, seen } = countingAdvisor();
    await advisor.chooseAction(preRollContext(fixture, sequence));
    return seen[0].map(entry => `${entry.kind}:${entry.cost ?? ''}:${entry.tileIndex ?? ''}`).join('|');
  };
  assert.equal(await order(7), await order(7), 'the order is reproducible for one decision');
  const orders = new Set();
  for (let sequence = 1; sequence <= 12; sequence += 1) orders.add(await order(sequence));
  assert.ok(orders.size > 1, 'the order changes between decisions');
});

await check('F4-b: the model answer maps back to the real candidate for every permutation', async () => {
  const candidates = [
    { id: 'alpha', kind: 'build', tileIndex: 1, cost: 101, score: 40 },
    { id: 'bravo', kind: 'build', tileIndex: 3, cost: 102, score: 30 },
    { id: 'charlie', kind: 'mortgage', tileIndex: 6, cost: 103, score: 20 },
    { id: 'roll', kind: 'roll', cost: 104, score: 10 }
  ];
  const byCost = new Map(candidates.map(candidate => [candidate.cost, candidate.id]));
  const permutations = new Set();
  for (let seed = 0; seed < 4000 && permutations.size < 24; seed += 1) {
    const position = seed % candidates.length;
    const { advisor, seen } = countingAdvisor(() => position);
    const decision = await advisor.chooseAction({ botBrain: 'ai', gameId: `perm-${seed}`, decisionSequence: 1, phase: 'pre-roll', candidates });
    const shown = seen[0].map(entry => entry.cost);
    permutations.add(shown.join(','));
    assert.deepEqual([...shown].sort(), [101, 102, 103, 104], 'every candidate is shown exactly once');
    assert.equal(decision.actionId, byCost.get(shown[position]), `seed ${seed}: position ${position} maps to the candidate shown there`);
    assert.equal(decision.provider, 'ai');
  }
  assert.equal(permutations.size, 24, 'all 24 orderings of four candidates were exercised');
});

await check('F4-b: a model that always picks the first option no longer always picks the planner best', async () => {
  const fixture = botRoom();
  ownBrownSet(fixture);
  const { advisor } = countingAdvisor(() => 0);
  const house = await new DeterministicAdvisor().chooseAction(preRollContext(fixture, 1));
  const plannerBest = house.actionId;
  assert.match(plannerBest, /^build:/, 'the planner best is a build on the Brown set');
  const picks = [];
  for (let sequence = 1; sequence <= 40; sequence += 1) {
    const decision = await advisor.chooseAction(preRollContext(fixture, sequence));
    picks.push(decision.actionId);
  }
  const bestShare = picks.filter(id => id === plannerBest).length / picks.length;
  assert.ok(new Set(picks).size > 1, 'echoing the first option yields varied choices');
  assert.ok(bestShare < 0.5, `echoing the first option picked the planner best ${Math.round(bestShare * 100)}% of the time`);
});

await check('F4-b: position bias is measurable from the decision and the advisor health', async () => {
  const fixture = botRoom();
  ownBrownSet(fixture);
  const { advisor } = countingAdvisor(() => 0);
  const decisions = [];
  for (let sequence = 1; sequence <= 20; sequence += 1) decisions.push(await advisor.chooseAction(preRollContext(fixture, sequence)));
  decisions.forEach(decision => {
    assert.equal(decision.optionPosition, 1, 'a first-option answer is logged as position 1');
    assert.ok(decision.optionCount > 1);
    assert.ok(decision.plannerBestPosition >= 1 && decision.plannerBestPosition <= decision.optionCount);
  });
  const bias = advisor.getHealth().optionPositionBias;
  assert.equal(bias.answers, 20);
  assert.equal(bias.firstPosition, 20, 'every answer was the first presented option');
  assert.ok(bias.plannerBest < 20, 'the first presented option was usually not the planner best');
  assert.equal(bias.plannerBest, decisions.filter(decision => decision.plannerBestPosition === 1).length,
    'the planner-best count matches the per-decision log');
});

console.log(`\n${failures.length ? `${failures.length} AI-layer checks failed` : 'all AI-layer checks passed'}`);
if (failures.length) process.exitCode = 1;
process.exit(process.exitCode || 0);
