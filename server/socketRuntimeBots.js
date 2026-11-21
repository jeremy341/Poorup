// Bot turns and bot auction decisions: timers, locks, watchdogs and advisor staleness guards.

import { presentationRemainingMs } from '../public/gamePresentationTiming.js';
import {
  selectBotTurnTarget,
  botMayStillAct,
  runBotTurn,
  resolvePurchaseOffer,
  isAuctionBotParticipant,
  decideBotAuction
} from './botLogic.js';
import { buildBotStrategicContext, BOT_RULE_VERSION } from './botStrategicContext.js';
import { botStatusPayload } from './botStatus.js';
import { botMovementSettleDelayMs, scheduleBotTimer } from './botTiming.js';
import { noteBotFallback } from './matchTelemetry.js';
import { contractResponderId } from './contractLogic.js';
import { botChatPayload, runRoomTimer } from './socketRuntimeHelpers.js';
import { BOT_DECISION_WATCHDOG_MS, BOT_DECISION_WATCHDOG_MARGIN_MS } from './socketRuntimeConstants.js';

// Thrown by the guarded advisor when its answer arrives after the decision lost its lock or its room; the turn ends quietly.
// Thrown to abandon a decision the table has moved past. advisorLogic.chooseActionSafely passes anything marked `stale` straight
// through instead of treating it as an advisor failure.
class StaleBotDecision extends Error { stale = true; }

export function createBotsDomain(ctx) {
  const { io, botAdvisor, metrics, now, setTimeoutFn, clearTimeoutFn } = ctx;

  function auctionBotKey(roomCode, auction, botId) {
    if (!ctx.auctionIds.has(auction)) ctx.auctionIds.set(auction, ++ctx.nextAuctionId);
    return `${roomCode}:${ctx.auctionIds.get(auction)}:${botId}`;
  }

  function clearBotAuctionTimersForRoom(roomCode) {
    for (const [botKey, timer] of ctx.auctionBotTimers) {
      if (!botKey.startsWith(`${roomCode}:`)) continue;
      clearTimeoutFn(timer);
      ctx.auctionBotTimers.delete(botKey);
    }
  }

  function turnRoomReady(room) {
    if (!room?.game.started) return false;
    if (room.destroyed) return false;
    if (humanlessTable(room)) return false;
    // Auctions have their own participant timer. Keeping the ordinary turn
    // queue out of this phase prevents the current seat from issuing a
    // rejected pass/bid while a different bot is the auction participant.
    if (room.game.auction?.active) return false;
    return !botTurnPending(room);
  }

  // A started table whose last human seat is gone is dead: bots playing on, and
  // calling the paid advisor, would only burn budget until the empty-room GC
  // collects the room. (Room-shaped test doubles without the method are left alone.)
  function humanlessTable(room) {
    return typeof room.hasHumanSeats === 'function' && !room.hasHumanSeats();
  }

  function scheduleBotTurn(room, movementDelayMs = 0) {
    if (!turnRoomReady(room)) return;
    const bot = selectBotTurnTarget(room.game);
    if (!bot?.isBot) return;
    if (bot.bankrupt) return;
    if (bot.disconnected) return;
    const timer = scheduleBotTimer(
      setTimeoutFn,
      () => runRoomTimer('bot-turn', room.roomCode, () => beginBotTurn(room, bot)),
      'turn',
      Math.max(movementDelayMs, presentationRemainingMs(room.game, now()))
    );
    ctx.botTimers.set(room.roomCode, timer);
  }

  function botTurnPending(room) {
    if (ctx.botTimers.has(room.roomCode)) return true;
    return ctx.botDecisionLocks.has(room.roomCode);
  }

  function beginBotTurn(room, bot) {
    ctx.botTimers.delete(room.roomCode);
    // The timer was armed while a human was still seated: if the last one left since, the table is dead.
    if (humanlessTable(room)) return;
    const remaining = presentationRemainingMs(room.game, now());
    if (remaining > 0) return scheduleBotTurn(room, remaining);
    room.game.presentationClock = now;
    // The decision owns the lock through its token. The watchdog frees a lock
    // whose decision never settles (a stalled provider the advisor could not
    // abort); a stale completion then cannot free the lock a newer one holds.
    const token = {};
    ctx.botDecisionLocks.set(room.roomCode, token);
    const watchdog = setTimeoutFn(
      () => runRoomTimer('bot-decision-watchdog', room.roomCode, () => finishBotTurn(room, token)),
      botDecisionWatchdogMs()
    );
    ctx.botDecisionWatchdogs.set(room.roomCode, watchdog);
    const previousPositions = new Map(room.game.players.map(player => [player.id, player.position]));
    runBotDecision(room, bot, () => ctx.botDecisionLocks.get(room.roomCode) !== token)
      .catch(error => {
        if (error instanceof StaleBotDecision) return;
        // A failed bot decision must not escape the timer callback: an
        // uncaught error here would take the whole process down. The room
        // stays alive and the watchdog/next action retries naturally.
        console.error(`Bot turn failed in room ${room.roomCode}:`, error);
      })
      .finally(() => {
        clearTimeoutFn(watchdog);
        if (ctx.botDecisionWatchdogs.get(room.roomCode) === watchdog) ctx.botDecisionWatchdogs.delete(room.roomCode);
        finishBotTurn(room, token, botMovementSettleDelayMs(previousPositions, room.game, now()));
      });
  }

  function botDecisionWatchdogMs() {
    return Math.max(BOT_DECISION_WATCHDOG_MS, (Number(botAdvisor?.timeoutMs) || 0) + BOT_DECISION_WATCHDOG_MARGIN_MS);
  }

  function applyBotDecisionOutcome(room, bot, result) {
    if (result?.botDecision) {
      const trace = room.game.recordBotDecisionTrace(result.botDecision);
      noteBotFallback(metrics, trace);
      emitBotStatus(room, bot, 'chosen', trace);
    }
    if (result?.botChat) {
      const chat = botChatPayload(bot, result.botChat);
      if (chat) io.in(room.roomCode).emit('chat-message', chat);
    }
    if (result?.noEmit) return;
    // Tail purchase resolution, second half of the post-roll double-check.
    const outcome = presentationRemainingMs(room.game, now()) === 0 ? resolvePurchaseOffer(room, bot, result) : result;
    // A bot's declined or unaffordable landing opens an auction that nothing
    // else arms a finish timer for; with no bids it would never close.
    if (outcome?.auctionStarted) ctx.scheduleAuctionFinish(room);
    ctx.emitRoomState(room);
  }

  // A contract the bot just created (or countered) is pushed to its human
  // recipient, as a human's proposal is, so the offer is not silent.
  function notifyBotContractOffer(room, priorContract) {
    const contract = room.game.pendingPlayerContract;
    if (!contract || contract === priorContract) return;
    const recipient = room.game.getPlayerById(contractResponderId(contract));
    if (!recipient || recipient.isBot || !recipient.socketId) return;
    io.to(recipient.socketId).emit('player-contract-offer', { contract });
  }

  // A decision that went stale must not act on its late answer: the advisor
  // call throws as it returns, which ends the turn before any action runs.
  function abortableAdvisor(isStale) {
    if (!botAdvisor || typeof botAdvisor.chooseAction !== 'function') return botAdvisor;
    return new Proxy(botAdvisor, {
      get(target, property) {
        if (property === 'chooseAction') {
          return async (...args) => {
            const decision = await target.chooseAction(...args);
            if (isStale()) throw new StaleBotDecision();
            return decision;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  // A decision whose lock the watchdog released, whose room is gone, or whose match has ended must not act on a late answer: the
  // advisor call throws as it returns, ending the turn before any action runs. endGame leaves the room alive, so the finished match
  // is judged by the game itself.
  function botDecisionIsStale(room, lockLost) {
    return () => room.destroyed
      || lockLost()
      || !room.game?.started
      || Boolean(room.game?.lastWinner);
  }

  async function runBotDecision(room, bot, lockLost = () => false) {
    // Re-read live state: seats, pendings, and votes may have changed while
    // this timer was queued. The decision policy itself lives in
    // botLogic.js and is covered by server/botLogic.test.js.
    if (!botMayStillAct(room.game, bot)) return;
    if (room.destroyed) return;
    const decisionSequence = (room.game.botDecisionSequence || 0) + 1;
    emitBotStatus(room, bot, 'thinking', { decisionSequence });
    const priorContract = room.game.pendingPlayerContract;
    const isStale = botDecisionIsStale(room, lockLost);
    const result = await runBotTurn(room, bot, abortableAdvisor(isStale));
    if (isStale()) return;
    notifyBotContractOffer(room, priorContract);
    applyBotDecisionOutcome(room, bot, result);
  }

  function emitBotStatus(room, bot, state, details = {}) {
    io.in(room.roomCode).emit('bot-status', botStatusPayload(botAdvisor, room, bot, state, details));
  }

  function finishBotTurn(room, token, movementDelayMs = 0) {
    // Only the decision holding the lock may release it.
    if (ctx.botDecisionLocks.get(room.roomCode) !== token) return;
    ctx.botDecisionLocks.delete(room.roomCode);
    scheduleBotTurn(room, movementDelayMs);
    ctx.scheduleBotAuction(room);
  }

  function activeAuction(room) {
    if (!room) return null;
    if (room.destroyed) return null;
    const auction = room.game.auction;
    if (!auction?.active) return null;
    return auction;
  }

  function scheduleBotAuction(room) {
    const auction = activeAuction(room);
    if (!auction) return;
    if (humanlessTable(room)) return;
    const roomCode = room.roomCode;
    const evaluated = ctx.auctionEvaluations.get(roomCode) || new Map();
    ctx.auctionEvaluations.set(roomCode, evaluated);

    // Start every eligible bot's thinking timer independently. In particular,
    // a slow or waiting AI bot must not prevent a funded rival from bidding.
    for (const bot of room.game.players) {
      if (!isAuctionBotParticipant(auction, bot)) continue;
      if (evaluated.get(bot.id) === auctionIdentity(auction, bot)) continue;
      const botKey = auctionBotKey(roomCode, auction, bot.id);
      if (ctx.auctionBotTimers.has(botKey) || ctx.auctionDecisionLocks.has(botKey)) continue;
      const timer = scheduleBotTimer(
        setTimeoutFn,
        () => runRoomTimer('bot-auction', roomCode, () => {
          beginBotAuctionBid(room, bot, roomCode, botKey, auction).catch(error => {
            console.error(`Bot auction decision failed in room ${roomCode}:`, error);
          });
        }),
        'auction'
      );
      ctx.auctionBotTimers.set(botKey, timer);
    }
  }

  async function beginBotAuctionBid(room, bot, roomCode, botKey, expectedAuction) {
    ctx.auctionBotTimers.delete(botKey);
    if (ctx.auctionDecisionLocks.has(botKey)) return;
    ctx.auctionDecisionLocks.add(botKey);
    try {
      await beginBotAuctionBidUnlocked(room, bot, roomCode, expectedAuction);
    } finally {
      ctx.auctionDecisionLocks.delete(botKey);
      if (!room.destroyed) ctx.scheduleBotAuction(room);
    }
  }

  async function beginBotAuctionBidUnlocked(room, bot, key, expectedAuction) {
    if (room.game.auction !== expectedAuction || !expectedAuction.active) return;
    // Same guard as beginBotTurn: no paid advisor call for a table whose last human seat is gone.
    if (humanlessTable(room)) return;
    const auctionVersion = auctionIdentity(room.game.auction, bot);
    const decisionSequence = (room.game.botDecisionSequence || 0) + 1;
    room.game.botDecisionSequence = decisionSequence;
    emitBotStatus(room, bot, 'thinking', { decisionSequence, phase: 'auction' });
    const context = {
      botId: bot.id,
      botBrain: room.settings.botBrain || 'auto',
      botDifficulty: room.settings.botDifficulty || 'table',
      gameId: `${room.roomCode}:${room.game.startedAt || 'pending'}`,
      decisionSequence,
      ruleVersion: BOT_RULE_VERSION,
      ...buildBotStrategicContext(room.game, bot, 'auction', decisionSequence)
    };
    const choice = await decideBotAuction({
      auction: room.game.auction,
      bot,
      startingCash: room.game.settings.startingCash,
      game: room.game,
      advisor: botAdvisor,
      context: { ...context, event: room.game.globalEvent }
    });
    if (room.destroyed || room.game.auction !== expectedAuction || !sameAuction(room.game.auction, auctionVersion, bot)) return;
    const { candidates, amount, decision } = choice;
    const actionId = choice.actionId;
    const shouldBid = actionId === 'auction:bid';
    const result = shouldBid ? room.runBotAction(bot.id, actor => room.placeAuctionBid(actor, amount)) : { success: true };
    // A bid that only collided with the bid cooldown was not a decision against
    // this state: leave the identity unevaluated so the re-arm in the caller
    // tries again once the cooldown has passed, and record nothing for it.
    if (shouldBid && result?.success === false && Number(room.game.auction?.cooldownUntil) > Date.now()) return;
    ctx.auctionEvaluations.get(key)?.set(bot.id, auctionVersion);
    if (shouldBid && result?.success) ctx.scheduleAuctionFinish(room);
    const trace = room.game.recordBotDecisionTrace({
      ...context,
      phase: 'auction',
      ...decision,
      provider: decision?.provider || 'deterministic',
      fallback: choice.actionId !== decision?.actionId || decision?.fallback !== false,
      fallbackReason: choice.actionId !== decision?.actionId ? 'invalid-auction-action' : decision?.fallbackReason || 'auction-policy',
      actionId,
      confidence: Number.isFinite(Number(decision?.confidence)) ? decision.confidence : 0.55,
      success: result?.success !== false,
      reasonCode: result?.success === false ? 'auction-rejected' : decision?.reasonCode || 'auction-policy',
      candidateIds: candidates.map(candidate => candidate.id)
    });
    noteBotFallback(metrics, trace);
    emitBotStatus(room, bot, 'chosen', trace);
    ctx.emitRoomState(room);
  }

  function auctionIdentity(auction, bot) {
    if (!auction) return null;
    return JSON.stringify({
      startedAt: auction.startedAt || 0,
      tileIndex: auction.propertyTile?.index ?? null,
      highestBid: Number(auction.highestBid || 0),
      highestBidderId: auction.highestBidderId || null,
      participants: [...(auction.participants || [])],
      botId: bot?.id || null,
      botCash: Number(bot?.cash || 0),
      botBankrupt: bot?.bankrupt === true,
      botDisconnected: bot?.disconnected === true
    });
  }

  function sameAuction(auction, identity, bot) {
    return Boolean(auction?.active && identity && auctionIdentity(auction, bot) === identity);
  }

  Object.assign(ctx, {
    scheduleBotTurn,
    scheduleBotAuction,
    clearBotAuctionTimersForRoom,
    activeAuction
  });
}
