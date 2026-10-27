// Behavioural gate for the October bot-engine audit, finding 1: planner bots held
// $6-25k idle and never built, because a house was booked at 50 % resale and its rent
// was credited over at most three dice turns (nothing at House). These checks pin the
// behaviour, not the weights: a bot with a complete set and spare cash develops it, a
// bot without a buffer does not, and the choice does not depend on the difficulty.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { DeterministicAdvisor } from './botAdvisor.js';
import { runBotTurn } from './botLogic.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import { rankCandidates } from './botFuturePlanner.js';
import { auctionWillingness } from './botAuctionPolicy.js';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`PASS - ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

const ORANGE = [11, 13, 14];

function table({ bots = 3, cash = 1500, difficulty = 'table' } = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'sock-eco', clientId: 'client-eco', nickname: 'Human', roomCode: 'ECON' });
  room.setRoomSetting('bots', bots);
  room.setRoomSetting('botDifficulty', difficulty);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const bot = game.players.find(player => player.isBot);
  for (const index of ORANGE) {
    game.tiles[index].ownerId = bot.id;
    game.tiles[index].houseCount = 0;
    bot.properties.push(index);
  }
  bot.cash = cash;
  game.roundNumber = 20;
  return { room, game, bot };
}

function startTurn(game, bot) {
  game.currentPlayerId = bot.id;
  game.hasRolled = false;
  game.awaitingEndTurn = false;
  game.extraRollPending = false;
  game.turnAllowsExtraRoll = false;
  game.pendingPurchaseOffer = null;
}

function houses(game) {
  return ORANGE.reduce((sum, index) => sum + (game.tiles[index].houseCount || 0), 0);
}

async function turnsUntilBuilt(setup, maxTurns = 4) {
  const { room, game, bot } = setup;
  for (let turn = 0; turn < maxTurns && houses(game) === 0; turn += 1) {
    startTurn(game, bot);
    await runBotTurn(room, bot, new DeterministicAdvisor());
  }
  return houses(game);
}

for (const difficulty of ['house', 'table', 'expert']) {
  await check(`a ${difficulty} bot with a complete set and spare cash builds within a few turns`, async () => {
    const built = await turnsUntilBuilt(table({ bots: 3, cash: 1500, difficulty }));
    assert.ok(built > 0, `no house after 4 turns at ${difficulty}`);
  });
}

// Ranked at a fixed state rather than played out: a played turn rolls real dice, and a
// pass over Go or a card payout hands the bot the buffer this check withholds.
await check('a bot without a cash buffer does not build', () => {
  const { game, bot } = table({ bots: 3, cash: 260 });
  startTurn(game, bot);
  const candidates = game.getBotCandidates(bot, { expanded: true, parity: true });
  const context = buildBotStrategicContext(game, bot, 'pre-roll', 1);
  const ranked = rankCandidates(context, candidates, { difficulty: 'table', seed: 'economics' });
  const roll = ranked.find(entry => entry.candidate.kind === 'roll');
  const buildsAbove = ranked.filter(entry => entry.candidate.kind === 'build' && entry.evaluation.score > roll.evaluation.score);
  assert.equal(buildsAbove.length, 0, 'a house would leave the bot unable to pay the next rent');
});

await check('a head-to-head bot with a complete set and spare cash still develops it', async () => {
  const built = await turnsUntilBuilt(table({ bots: 1, cash: 2000 }), 6);
  assert.ok(built > 0, 'the investment horizon does not depend on the number of opponents being large');
});

await check('a house outranks standing still, and the cheapest tile never beats a better yield by stalling', () => {
  const { game, bot } = table({ bots: 3, cash: 1500 });
  startTurn(game, bot);
  const candidates = game.getBotCandidates(bot, { expanded: true, parity: true });
  const context = buildBotStrategicContext(game, bot, 'pre-roll', 1);
  const ranked = rankCandidates(context, candidates, { difficulty: 'table', seed: 'economics' });
  assert.equal(ranked[0].candidate.kind, 'build', `top candidate was ${ranked[0].candidate.id}`);
  const roll = ranked.find(entry => entry.candidate.kind === 'roll');
  assert.ok(ranked[0].evaluation.score > roll.evaluation.score, 'building beats standing still');
});

await check('a mortgaged deed is unmortgaged when the bot has the cash', async () => {
  const setup = table({ bots: 3, cash: 1500 });
  const { room, game, bot } = setup;
  game.tiles[11].mortgaged = true;
  startTurn(game, bot);
  await runBotTurn(room, bot, new DeterministicAdvisor());
  assert.equal(game.tiles[11].mortgaged, false, 'rent from a mortgaged deed is zero, so the bot lifts it');
});

await check('difficulty changes auction judgement: House bids face value, Table pays for the set it completes', () => {
  const valuations = {};
  for (const difficulty of ['house', 'table', 'expert']) {
    const { game, bot } = table({ bots: 3, cash: 1500, difficulty });
    game.tiles[14].ownerId = null;
    bot.properties = bot.properties.filter(index => index !== 14);
    game.settings.botDifficulty = difficulty;
    valuations[difficulty] = auctionWillingness({ propertyTile: game.tiles[14] }, bot, game);
  }
  assert.ok(valuations.table > valuations.house, 'a completing deed is worth more than face value to Table');
  assert.equal(valuations.table, valuations.expert, 'Table and Expert share the valuation; Expert differs in search depth');
});

const failed = results.filter(ok => !ok).length;
console.log(`bot economics: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
