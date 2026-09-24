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
  classifyBotTurnPhase,
  isAuctionBotParticipant,
  resolvePurchaseOffer,
  runBotTurn,
  selectBotTurnTarget
} from './botLogic.js';
import { summarizeBalanceCampaign } from './balanceMetrics.js';

const SIMULATION_COUNT = Math.max(1, Math.floor(Number(process.env.POORUP_BOT_SIMULATION_COUNT) || 1_000));
const SIMULATION_START_INDEX = Math.max(1, Math.floor(Number(process.env.POORUP_BOT_SIMULATION_START_INDEX) || 1));
const STEP_LIMIT = Math.max(100, Math.floor(Number(process.env.POORUP_BOT_STEP_LIMIT) || 2_000));
const STALL_LIMIT = 8;

function stateFingerprint(game) {
  return JSON.stringify({
    current: game.currentPlayerId,
    hasRolled: game.hasRolled,
    awaitingEndTurn: game.awaitingEndTurn,
    extraRollPending: game.extraRollPending,
    pendingPurchase: game.pendingPurchaseOffer ? { ...game.pendingPurchaseOffer } : null,
    pendingPayment: game.pendingPayment
      ? {
        playerId: game.pendingPayment.playerId,
        creditorId: game.pendingPayment.creditorId,
        amount: game.pendingPayment.amount,
        amountRemaining: game.pendingPayment.amountRemaining,
        queueLength: Array.isArray(game.pendingPaymentQueue) ? game.pendingPaymentQueue.length : 0
      }
      : null,
    pendingTrade: game.pendingTrade
      ? { id: game.pendingTrade.id, fromPlayerId: game.pendingTrade.fromPlayerId, toPlayerId: game.pendingTrade.toPlayerId, counterDepth: game.pendingTrade.counterDepth }
      : null,
    pendingContract: game.pendingPlayerContract
      ? { id: game.pendingPlayerContract.id, kind: game.pendingPlayerContract.kind, status: game.pendingPlayerContract.status }
      : null,
    pendingSponsoredPurchase: game.pendingSponsoredPurchase
      ? {
        buyerId: game.pendingSponsoredPurchase.buyerId,
        tileIndex: game.pendingSponsoredPurchase.tileIndex,
        contributions: [...(game.pendingSponsoredPurchase.contributions || [])]
          .map(entry => [entry.sponsorId, entry.amount])
          .sort(([leftId], [rightId]) => String(leftId).localeCompare(String(rightId)))
      }
      : null,
    auction: game.auction
      ? {
        active: game.auction.active,
        currentPlayerId: game.auction.currentPlayerId,
        highestBid: game.auction.highestBid,
        highestBidderId: game.auction.highestBidderId,
        passedPlayerIds: [...(game.auction.passedPlayerIds || [])].sort()
      }
      : null,
    globalEvent: game.globalEvent
      ? {
        id: game.globalEvent.id,
        phase: game.globalEvent.phase,
        votes: Object.entries(game.globalEvent.votes || {}).sort(([leftId], [rightId]) => leftId.localeCompare(rightId)),
        resolvedChoice: game.globalEvent.resolvedChoice,
        roundsRemaining: game.globalEvent.roundsRemaining,
        settlementApplied: game.globalEvent.settlementApplied
      }
      : null,
    round: game.roundNumber,
    players: game.players.map(player => [
      player.id,
      player.cash,
      player.position,
      [...player.properties].sort((left, right) => left - right),
      player.bankrupt,
      player.inJail,
      player.jailTurns
    ])
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

async function simulate(seedValue, { captureTrace = false } = {}) {
  const randomInt = crypto.randomInt;
  const randomUUID = crypto.randomUUID;
  const now = Date.now;
  let seed = seedValue;
  let uuidSequence = 0;
  crypto.randomInt = (min, max) => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    const range = Math.max(1, max - min);
    return min + (seed % range);
  };
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`;
  Date.now = () => 1_700_000_000_000 + seedValue;
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
    room.setRoomSetting('globalEvents', true);
    assert.equal(room.startGame().success, true);
    ['builder', 'speculator', 'chaos'].forEach((personality, index) => {
      if (room.game.players[index]) room.game.players[index].personality = personality;
    });

    const advisor = new DeterministicAdvisor();
    let steps = 0;
    let stagnant = 0;
    const trace = captureTrace ? [] : null;
    while (room.game.started && steps < STEP_LIMIT) {
      const before = stateFingerprint(room.game);
      let actorId = null;
      let phaseBefore = null;
      let actionResult = null;
      if (room.game.auction?.active) {
        actorId = room.game.auction.currentPlayerId || null;
        phaseBefore = 'auction';
        actionResult = runAuctionStep(room);
      } else {
        const bot = selectBotTurnTarget(room.game);
        assert.ok(bot?.isBot, 'every simulation target must be a bot');
        actorId = bot.id;
        phaseBefore = classifyBotTurnPhase(room.game, bot);
        actionResult = await runBotTurn(room, bot, advisor);
        actionResult = resolvePurchaseOffer(room, bot, actionResult);
      }
      assertHealthyCash(room.game);
      steps += 1;
      if (trace) trace.push(JSON.stringify({ phaseBefore, state: stateFingerprint(room.game) }));
      if (before === stateFingerprint(room.game)) {
        stagnant += 1;
        if (process.env.POORUP_BOT_SIMULATION_DEBUG === '1') {
          const decision = actionResult?.botDecision || {};
          const actor = room.game.getPlayerById(actorId);
          const postRollCandidates = actor?.isBot && room.game.hasRolled
            ? room.game.getBotCandidates(actor, { expanded: true, parity: true, postRoll: true })
            : [];
          console.error('SIMULATION_STALL', JSON.stringify({
            seed: seedValue,
            step: steps + 1,
            actorId,
            phaseBefore,
            result: { success: actionResult?.success, error: actionResult?.error, botChat: actionResult?.botChat },
            decision: { actionId: decision.actionId, reasonCode: decision.reasonCode, fallbackReason: decision.fallbackReason },
            candidates: postRollCandidates.map(candidate => ({ id: candidate.id, kind: candidate.kind, score: candidate.score })),
            bankLoanOffer: actor?.isBot ? room.game.getBankLoanOffer(actor) : null,
            deeds: (actor?.properties || []).map(index => {
              const tile = room.game.getTile(index);
              return { index, name: tile?.name, mortgaged: tile?.mortgaged, houses: tile?.houseCount, hotels: tile?.hotelCount, equityShares: tile?.equityShares?.length || 0, canMortgage: tile ? room.game.canMortgageTile(actor, tile) : false };
            }),
            state: JSON.parse(stateFingerprint(room.game)),
            obligations: {
              pendingTrade: room.game.pendingTrade ? {
                id: room.game.pendingTrade.id,
                fromPlayerId: room.game.pendingTrade.fromPlayerId,
                toPlayerId: room.game.pendingTrade.toPlayerId,
                counterDepth: room.game.pendingTrade.counterDepth,
              } : null,
              pendingPayment: room.game.pendingPayment ? {
                playerId: room.game.pendingPayment.playerId,
                creditorId: room.game.pendingPayment.creditorId,
                amountRemaining: room.game.pendingPayment.amountRemaining,
              } : null,
              currentPlayerId: room.game.currentPlayerId,
            },
          }));
        }
        assert.ok(stagnant < STALL_LIMIT, `simulation ${seedValue} stalled at step ${steps}`);
      } else {
        stagnant = 0;
      }
    }
    const winnerSeat = room.game.lastWinner
      ? room.game.players.findIndex(player => player.id === room.game.lastWinner.id)
      : null;
    return {
      ended: !room.game.started,
      steps,
      round: room.game.roundNumber,
      seed: seedValue,
      balanceRevision: 'release-hardening-2026-09-16',
      ruleRevision: room.game.ruleset?.rulesetRevision || room.settings.rulesetRevision || 0,
      boardVariant: room.game.boardVariant,
      botBrain: room.game.settings.botBrain || 'ai',
      botDifficulty: room.game.settings.botDifficulty || 'table',
      botPersonalities: room.game.players.filter(player => player.isBot).map(player => player.personality || 'survivor'),
      winnerSeat: winnerSeat == null || winnerSeat < 0 ? 'unknown' : winnerSeat,
      bankruptcies: room.game.players.filter(player => player.bankrupt).length,
      featureUsage: {
        // Adoption is measured from actions taken in the game, not from a
        // room flag that merely made the feature available.
        auction: Number(room.game.auctionsCompleted || 0) > 0,
        casino: Array.isArray(room.game.casinoLedger) && room.game.casinoLedger.length > 0,
        market: Array.isArray(room.game.marketLedger) && room.game.marketLedger.length > 0,
        globalEvents: Number(room.game.globalEventsTriggered || 0) > 0
      },
      ...(trace ? { trace } : {})
    };
  } finally {
    crypto.randomInt = randomInt;
    crypto.randomUUID = randomUUID;
    Date.now = now;
  }
}

async function assertZeroCashPostRollBotsResolve() {
  const manager = new RoomManager();
  const room = manager.createRoom({
    socketId: 'zero-cash-host',
    clientId: 'zero-cash-host',
    nickname: 'ZERO CASH',
    isBot: true
  });
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
  assert.ok(candidates.some(candidate => candidate.kind === 'bankruptcy'), 'a broke bot needs a bankruptcy fallback');
  assert.equal(candidates.some(candidate => candidate.kind === 'end-turn'), false, 'a broke bot cannot be offered an illegal end turn');

  const result = await runBotTurn(room, bot, new DeterministicAdvisor());
  assert.equal(bot.bankrupt, true, 'a broke bot with no rescue must eliminate its seat');
  assert.equal(result.success, true);
}

await assertZeroCashPostRollBotsResolve();

async function assertSameSeedProducesSameTrace() {
  const first = await simulate(569083, { captureTrace: true });
  const second = await simulate(569083, { captureTrace: true });
  assert.deepEqual(second.trace, first.trace, 'same simulation seed must produce the same game-state trace');
}

await assertSameSeedProducesSameTrace();

const results = [];
for (let index = SIMULATION_START_INDEX; index < SIMULATION_START_INDEX + SIMULATION_COUNT; index += 1) {
  results.push(await simulate(index * 1009 + 7));
}

assert.equal(results.length, SIMULATION_COUNT);
assert.ok(results.every(result => result.steps > 0));
console.log(`bot simulations: ${SIMULATION_COUNT} bounded games passed, ${results.filter(result => result.ended).length} ended within ${STEP_LIMIT} steps, 0 stalled`);
if (process.env.POORUP_BOT_BALANCE_JSON === '1') {
  console.log(`BALANCE_REPORT_JSON=${JSON.stringify(summarizeBalanceCampaign(results))}`);
}
