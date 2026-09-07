// Bounded integration simulations for the no-AI bot path. A Monopoly-style
// table can legitimately circulate cash for a long time, so this suite tests
// the stronger invariant we need for automation: every bounded step advances
// state, auctions close through their participant path, and no bot creates
// negative cash or a blocked turn.
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { RoomManager } from './gameLogic.js';
import { DeterministicAdvisor } from './botAdvisor.js';
import {
  auctionBidDecision,
  isAuctionBotParticipant,
  resolvePurchaseOffer,
  runBotTurn,
  selectBotTurnTarget
} from './botLogic.js';

const SIMULATION_COUNT = 1_000;
const STEP_LIMIT = 2_000;
const STALL_LIMIT = 8;

function stateFingerprint(game) {
  return JSON.stringify({
    current: game.currentPlayerId,
    hasRolled: game.hasRolled,
    awaitingEndTurn: game.awaitingEndTurn,
    extraRollPending: game.extraRollPending,
    pendingPurchase: game.pendingPurchaseOffer,
    pendingPayment: game.pendingPayment
      ? { playerId: game.pendingPayment.playerId, amount: game.pendingPayment.amountRemaining }
      : null,
    pendingTrade: game.pendingTrade?.id || null,
    pendingContract: game.pendingPlayerContract?.id || null,
    auction: game.auction
      ? { active: game.auction.active, bid: game.auction.highestBid, passed: game.auction.passedPlayerIds.length }
      : null,
    round: game.roundNumber,
    players: game.players.map(player => [player.id, player.cash, player.properties.length, player.bankrupt, player.inJail])
  });
}

function assertHealthyCash(game) {
  game.players.forEach(player => {
    assert.ok(Number.isFinite(player.cash), `${player.nickname} cash must stay finite`);
    assert.ok(player.cash >= 0, `${player.nickname} cash must not go negative`);
  });
}

function runAuctionStep(room) {
  const game = room.game;
  const bot = game.players.find(player => isAuctionBotParticipant(game.auction, player));
  if (!bot) {
    game.finishAuction();
    return;
  }
  const decision = auctionBidDecision(game.auction, bot, game.settings.startingCash);
  // The runtime waits for the bid cooldown; the bounded test advances the
  // virtual clock between participant decisions instead of sleeping.
  game.auction.cooldownUntil = 0;
  room.runBotAction(bot.id, actor => decision.shouldBid
    ? room.placeAuctionBid(actor, decision.minimum)
    : room.passAuction(actor));
}

async function simulate(seedValue) {
  const randomInt = crypto.randomInt;
  let seed = seedValue;
  crypto.randomInt = (min, max) => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    const range = Math.max(1, max - min);
    return min + (seed % range);
  };
  try {
    const manager = new RoomManager();
    const room = manager.createRoom({
      socketId: 'simulation-host',
      clientId: 'simulation-host',
      nickname: 'SIM HOST',
      color: '#d74438',
      isBot: true
    });
    room.setRoomSetting('startingCash', 500);
    room.setRoomSetting('bots', 3);
    room.setRoomSetting('auction', true);
    room.setRoomSetting('casino', true);
    room.setRoomSetting('market', true);
    assert.equal(room.startGame().success, true);

    const advisor = new DeterministicAdvisor();
    let steps = 0;
    let stagnant = 0;
    while (room.game.started && steps < STEP_LIMIT) {
      const before = stateFingerprint(room.game);
      if (room.game.auction?.active) {
        runAuctionStep(room);
      } else {
        const bot = selectBotTurnTarget(room.game);
        assert.ok(bot?.isBot, 'every simulation target must be a bot');
        const result = await runBotTurn(room, bot, advisor);
        resolvePurchaseOffer(room, bot, result);
      }
      assertHealthyCash(room.game);
      steps += 1;
      if (before === stateFingerprint(room.game)) {
        stagnant += 1;
        assert.ok(stagnant < STALL_LIMIT, `simulation ${seedValue} stalled at step ${steps}`);
      } else {
        stagnant = 0;
      }
    }
    return { ended: !room.game.started, steps, round: room.game.roundNumber };
  } finally {
    crypto.randomInt = randomInt;
  }
}

const results = [];
for (let index = 1; index <= SIMULATION_COUNT; index += 1) {
  results.push(await simulate(index * 1009 + 7));
}

assert.equal(results.length, SIMULATION_COUNT);
assert.ok(results.every(result => result.steps > 0));
console.log(`bot simulations: ${SIMULATION_COUNT} bounded games passed, ${results.filter(result => result.ended).length} ended within ${STEP_LIMIT} steps, 0 stalled`);
