import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { RoomManager } from './gameLogic.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import { buildMatchResult, safeShadowEvaluationTrace } from './botTournamentResults.js';
import { stateFingerprint } from './botTournamentState.js';
import { auctionWillingness } from './botAuctionPolicy.js';
import {
  decideBotAuction,
  isAuctionBotParticipant,
  resolvePurchaseOffer,
  runBotTurn,
  selectBotTurnTarget,
} from './botLogic.js';

export function withSeededSimulationGlobals(seedValue, callback) {
  const randomInt = crypto.randomInt;
  const randomUUID = crypto.randomUUID;
  const now = Date.now;
  let seed = Number(seedValue) >>> 0;
  let uuidSequence = 0;
  let simulationTime = 1_700_000_000_000 + (Number(seedValue) || 0);
  const advanceTime = durationMs => {
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration < 0) throw new RangeError('Simulation time must advance by a finite non-negative duration');
    simulationTime += Math.floor(duration);
  };
  crypto.randomInt = (min, max) => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return min + (seed % Math.max(1, max - min));
  };
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`;
  Date.now = () => simulationTime;
  return Promise.resolve().then(() => callback({ advanceTime })).finally(() => {
    crypto.randomInt = randomInt;
    crypto.randomUUID = randomUUID;
    Date.now = now;
  });
}

export function createSimulationRoom({ boardVariant = 'standard-40', settings = {} } = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'simulation-host', clientId: 'simulation-host', nickname: 'SIM HOST', color: '#d74438', isBot: true, boardVariant });
  const seatCount = Math.max(2, Math.min(3, Math.floor(Number(settings.seatCount) || 3)));
  const roomSettings = { startingCash: 500, maxPlayers: seatCount + 1, bots: seatCount, auction: true, casino: true, market: true, globalEvents: true, ...settings };
  delete roomSettings.seatCount;
  Object.entries(roomSettings).forEach(([key, value]) => room.setRoomSetting(key, value));
  room.ensureBots();
  room.simulationPlayerIds = room.game.players.map(player => player.id);
  if (!room.startGame().success) throw new Error('Unable to start bot simulation room');
  return room;
}

export function assertHealthyCash(game) {
  game.players.forEach(player => {
    if (!Number.isFinite(player.cash) || player.cash < 0) throw new Error(`${player.nickname} has invalid cash: ${player.cash}`);
  });
}

function hasValidPolicyId(policy) {
  if (!policy || typeof policy !== 'object') return false;
  if (typeof policy.policyId !== 'string') return false;
  return policy.policyId.trim().length > 0;
}

function policyIdsAreUnique(policies) {
  const ids = policies.map(policy => policy.policyId);
  return new Set(ids).size === ids.length;
}

function validatePolicyBySeat(policyBySeat) {
  if (!Array.isArray(policyBySeat) || policyBySeat.length < 2) throw new TypeError('policyBySeat must contain at least two policies');
  if (!policyBySeat.every(hasValidPolicyId)) throw new TypeError('Every policy must have a non-empty policyId');
  if (!policyIdsAreUnique(policyBySeat)) throw new TypeError('policyId values must be unique within a match');
}

function policiesInGameOrder(room, policyBySeat, boardVariant) {
  if (room.game.players.length !== policyBySeat.length) {
    throw new Error(`Board ${boardVariant} started ${room.game.players.length} bot seats for ${policyBySeat.length} policies`);
  }
  return room.game.players.map(player => policyBySeat[room.simulationPlayerIds.indexOf(player.id)]);
}

function createLegalityCounts(policies) {
  return new Map(policies.map(policy => [policy.policyId, {
    actionAttempts: 0,
    legalActions: 0,
    illegalActions: 0,
    unclassifiedActions: 0,
  }]));
}

function recordActionLegality(counts, result) {
  counts.actionAttempts += 1;
  if (result?.success === true) counts.legalActions += 1;
  else if (result?.success === false) counts.illegalActions += 1;
  else counts.unclassifiedActions += 1;
}

function completedGroupsByPlayer(game) {
  return new Map((game.players || []).map(player => {
    const groups = [...new Set((game.tiles || []).map(tile => tile?.group).filter(Boolean))];
    const complete = groups.filter(group => {
      const tiles = game.getGroupTiles?.(group) || [];
      return tiles.length > 0 && tiles.every(tile => tile.ownerId === player.id);
    });
    return [player.id, new Set(complete)];
  }));
}

function freshPolicyStrategyMetrics() {
  return { providerCalls: 0, auctionBidCount: 0, auctionBidPremiumTotal: 0, maxAuctionBidPremium: 0, auctionBidFacePremiumTotal: 0, maxAuctionBidFacePremium: 0, completedTrades: 0, completedGroupsLost: 0, opponentGroupsBroken: 0 };
}

function instrumentBotActions(room, policies, strategyMetricsByPolicy) {
  const policyByPlayer = new Map(room.game.players.map((player, seat) => [player.id, policies[seat].policyId]));
  const counts = createLegalityCounts(policies);
  const runBotAction = room.runBotAction.bind(room);
  room.runBotAction = (playerId, action, ...args) => {
    const tradesBefore = Number(room.game.tradesCompleted || 0);
    const groupsBefore = completedGroupsByPlayer(room.game);
    const result = runBotAction(playerId, action, ...args);
    const policyId = policyByPlayer.get(playerId);
    const policyCounts = counts.get(policyId);
    if (policyCounts) recordActionLegality(policyCounts, result);
    const tradesAfter = Number(room.game.tradesCompleted || 0);
    if (policyId && tradesAfter > tradesBefore && result?.success !== false) {
      const metrics = strategyMetricsByPolicy[policyId];
      if (metrics) metrics.completedTrades += tradesAfter - tradesBefore;
      const groupsAfter = completedGroupsByPlayer(room.game);
      groupsBefore.forEach((before, playerId) => {
        const after = groupsAfter.get(playerId) || new Set();
        const lost = [...before].filter(group => !after.has(group)).length;
        if (!lost || !metrics) return;
        if (playerId === botIdForPolicy(room.game.players, policyByPlayer, policyId)) metrics.completedGroupsLost += lost;
        else metrics.opponentGroupsBroken += lost;
      });
    }
    return result;
  };
  return counts;
}

function botIdForPolicy(players, policyByPlayer, policyId) {
  return players.find(player => player.isBot && policyByPlayer.get(player.id) === policyId)?.id || null;
}

function clearAdvisorDecisionCounts(policies) {
  for (const advisor of new Set(policies.map(policy => policy.advisor).filter(Boolean))) {
    if (advisor.decisionCounts instanceof Map) advisor.decisionCounts.clear();
  }
}

function callCapTrackers(policyBySeat, callCapTracker) {
  return new Set([
    callCapTracker,
    ...policyBySeat.map(policy => policy.advisor?.fetchImpl?.botEvalCallCapTracker),
  ].filter(Boolean));
}

function initialCallCapCounts(trackers) {
  return new Map([...trackers].map(tracker => [tracker, { calls: tracker.calls, exhaustions: tracker.capExhaustions }]));
}

function advisorFacade(policy, seed, decisionIndexes) {
  return {
    supportsChoicePhases: policy.advisor?.supportsChoicePhases,
    supportsChoicePhase: typeof policy.advisor?.supportsChoicePhase === 'function'
      ? phase => policy.advisor.supportsChoicePhase(phase)
      : undefined,
    chooseAction: context => {
      const policyDecisionIndex = decisionIndexes.get(policy.policyId) || 0;
      decisionIndexes.set(policy.policyId, policyDecisionIndex + 1);
      return policy.advisor.chooseAction({ ...context, simulationSeed: seed, policyId: policy.policyId, policyDecisionIndex });
    },
  };
}

function createAdvisorFacades(policies, seed) {
  const indexes = new Map();
  return new Map(policies.map(policy => [policy.policyId, advisorFacade(policy, seed, indexes)]));
}

function createSimulationContext(options, advanceTime) {
  const room = createSimulationRoom({ boardVariant: options.boardVariant, settings: { ...options.settings, seatCount: options.policyBySeat.length } });
  const policies = policiesInGameOrder(room, options.policyBySeat, options.boardVariant);
  const strategyMetricsByPolicy = Object.fromEntries(policies.map(policy => [policy.policyId, freshPolicyStrategyMetrics()]));
  const actionLegalityByPolicy = instrumentBotActions(room, policies, strategyMetricsByPolicy);
  clearAdvisorDecisionCounts(options.policyBySeat);
  const trackers = callCapTrackers(options.policyBySeat, options.callCapTracker);
  return {
    ...options,
    room,
    policies,
    actionLegalityByPolicy,
    strategyMetricsByPolicy,
    callCapTrackers: trackers,
    initialCapCounts: initialCallCapCounts(trackers),
    advisorByPolicyId: createAdvisorFacades(policies, options.seed),
    decisionTrace: options.captureTrace ? [] : null,
    shadowTraces: options.captureShadowTrace ? [] : null,
    steps: 0,
    stalls: 0,
    consecutiveStalls: 0,
    liveAiFallbacks: 0,
    advanceTime,
  };
}

function currentBot(context) {
  const { game } = context.room;
  const auction = game.auction;
  return auction?.active
    ? game.players.find(player => isAuctionBotParticipant(auction, player))
    : selectBotTurnTarget(game);
}

function decisionTraceEntry(context, policy, phase, actionId) {
  return { policyId: policy.policyId, phase, actionId, state: stateFingerprint(context.room.game) };
}

function appendDecisionTrace(context, entry) {
  if (context.decisionTrace) context.decisionTrace.push(entry);
}

function appendShadowTrace(context, trace) {
  if (trace && context.shadowTraces) context.shadowTraces.push(trace);
}

function trackLiveAiFallback(context, reason) {
  if (reason === 'live-call-cap') context.liveAiFallbacks += 1;
}

async function runAuctionAction(context, bot, policy) {
  const { game } = context.room;
  const auction = game.auction;
  const projectedValue = auctionWillingness(auction, bot, game);
  const choice = await decideBotAuction({
    auction,
    bot,
    startingCash: game.settings.startingCash,
    advisor: context.advisorByPolicyId.get(policy.policyId),
    context: buildBotStrategicContext(game, bot, 'auction', game.botDecisionSequence || 0),
  });
  trackLiveAiFallback(context, choice.decision?.fallbackReason);
  const result = context.room.runBotAction(bot.id, actor => choice.actionId === 'auction:bid'
    ? context.room.placeAuctionBid(actor, choice.amount)
    : context.room.passAuction(actor));
  if (choice.actionId === 'auction:bid' && result?.success) {
    const premium = Math.max(0, Number(choice.amount || 0) - (Number.isFinite(projectedValue) ? projectedValue : Number(auction.propertyTile?.price || 0)));
    const facePremium = Math.max(0, Number(choice.amount || 0) - Number(auction.propertyTile?.price || 0));
    const metrics = context.strategyMetricsByPolicy[policy.policyId];
    metrics.auctionBidCount += 1;
    metrics.auctionBidPremiumTotal += premium;
    metrics.maxAuctionBidPremium = Math.max(metrics.maxAuctionBidPremium, premium);
    metrics.auctionBidFacePremiumTotal += facePremium;
    metrics.maxAuctionBidFacePremium = Math.max(metrics.maxAuctionBidFacePremium, facePremium);
  }
  const trace = { ...choice.decision, phase: 'auction', actionId: choice.actionId };
  const evaluation = safeShadowEvaluationTrace(choice.evaluationTrace, policy.policyId);
  if (evaluation) delete trace.shadowEvaluation;
  game.recordBotDecisionTrace(trace);
  appendShadowTrace(context, evaluation);
  appendDecisionTrace(context, decisionTraceEntry(context, policy, 'auction', choice.actionId));
}

function recordOrdinaryAction(context, bot, policy, result) {
  const decision = result ? result.botDecision : null;
  trackLiveAiFallback(context, decision?.fallbackReason);
  if (decision) context.room.game.recordBotDecisionTrace(decision);
  const evaluation = safeShadowEvaluationTrace(result ? result.evaluationTrace : undefined, policy.policyId);
  appendShadowTrace(context, evaluation);
  resolvePurchaseOffer(context.room, bot, result);
  appendDecisionTrace(context, decisionTraceEntry(context, policy, decision?.phase, decision?.actionId));
}

async function runOrdinaryAction(context, bot, policy) {
  const result = await runBotTurn(context.room, bot, context.advisorByPolicyId.get(policy.policyId));
  recordOrdinaryAction(context, bot, policy, result);
}

async function runActiveBotAction(context, bot, policy) {
  const game = context.room.game;
  const previousBrain = game.settings.botBrain;
  const previousDifficulty = game.settings.botDifficulty;
  const aiCallsBefore = Number(policy.advisor?.aiCalls || 0);
  game.settings.botBrain = policy.brain || 'no-ai';
  game.settings.botDifficulty = policy.difficulty || 'table';
  try {
    if (game.auction?.active) await runAuctionAction(context, bot, policy);
    else await runOrdinaryAction(context, bot, policy);
  } finally {
    const metrics = context.strategyMetricsByPolicy[policy.policyId];
    metrics.providerCalls += Math.max(0, Number(policy.advisor?.aiCalls || 0) - aiCallsBefore);
    game.settings.botBrain = previousBrain;
    game.settings.botDifficulty = previousDifficulty;
  }
}

function stallDiagnostic(context, bot, seat) {
  if (!bot) return '';
  const decisions = context.decisionTrace?.slice(-8).map(({ policyId, phase, actionId }) => ({ policyId, phase, actionId }));
  if (!decisions) return '';
  const auction = context.room.game.auction || {};
  return `; actor ${bot.id} seat ${seat} auction ${JSON.stringify({
    active: auction.active,
    participants: auction.participants,
    highestBid: auction.highestBid,
    highestBidderId: auction.highestBidderId,
    passedPlayerIds: auction.passedPlayerIds,
  })}; recent decisions ${JSON.stringify(decisions)}`;
}

function recordStall(context, before, bot = null, seat = -1) {
  if (before !== stateFingerprint(context.room.game)) {
    context.consecutiveStalls = 0;
    return;
  }
  context.stalls += 1;
  context.consecutiveStalls += 1;
  if (context.consecutiveStalls >= 8) {
    const detail = stallDiagnostic(context, bot, seat);
    throw new Error(`Simulation stalled for 8 consecutive steps (seed ${context.seed})${detail}`);
  }
}

function finishNoBotStep(context, before) {
  const game = context.room.game;
  if (game.auction?.active) game.finishAuction();
  context.steps += 1;
  recordStall(context, before);
  assertHealthyCash(game);
}

async function runBotStep(context, bot, before) {
  const seat = context.room.game.players.indexOf(bot);
  const policy = context.policies[seat];
  if (!policy) throw new Error(`No policy configured for seat ${seat}`);
  await runActiveBotAction(context, bot, policy);
  context.steps += 1;
  assertHealthyCash(context.room.game);
  recordStall(context, before, bot, seat);
}

async function runSimulationSteps(context) {
  while (context.room.game.started && context.steps < context.stepLimit) {
    context.advanceTime(1_000);
    const before = stateFingerprint(context.room.game);
    const bot = currentBot(context);
    if (!bot) {
      finishNoBotStep(context, before);
      continue;
    }
    await runBotStep(context, bot, before);
  }
}

function linkedShadowTrace(trace, result, seed) {
  return {
    ...trace,
    linkedOutcome: {
      matchSeed: seed,
      ended: result.ended,
      winnerSeat: result.winnerSeat,
      placements: Object.values(result.placementsByPolicy).sort((left, right) => left - right),
      bankruptcies: result.bankruptcies,
      steps: result.steps,
    },
  };
}

function callCapTotal(trackers, initialCounts, field) {
  return [...trackers].reduce((sum, tracker) => sum + tracker[field] - initialCounts.get(tracker)[field === 'calls' ? 'calls' : 'exhaustions'], 0);
}

function finalizeMatch(context) {
  const result = buildMatchResult(context.room, {
    seed: context.seed,
    policyBySeat: context.policies,
    steps: context.steps,
    stepLimit: context.stepLimit,
    decisionTrace: context.decisionTrace,
    actionLegalityByPolicy: context.actionLegalityByPolicy,
    strategyMetricsByPolicy: context.strategyMetricsByPolicy,
  });
  if (context.shadowTraces) result.shadowTrace = context.shadowTraces.map(trace => linkedShadowTrace(trace, result, context.seed));
  result.stalls = context.stalls;
  result.liveAiCalls = callCapTotal(context.callCapTrackers, context.initialCapCounts, 'calls');
  result.liveAiCapExhaustions = callCapTotal(context.callCapTrackers, context.initialCapCounts, 'capExhaustions');
  result.liveAiCallCapReached = result.liveAiCapExhaustions > 0;
  result.liveAiFallbacks = context.liveAiFallbacks;
  result.liveAiStatus = context.callCapTrackers.size === 0
    ? 'stubbed'
    : result.liveAiCallCapReached ? 'cap-exhausted-fallbacks' : 'within-call-cap';
  return result;
}

export async function simulateBotMatch(options) {
  validatePolicyBySeat(options.policyBySeat);
  const startedAt = performance.now();
  const result = await withSeededSimulationGlobals(options.seed, async ({ advanceTime }) => {
    const context = createSimulationContext(options, advanceTime);
    await runSimulationSteps(context);
    return finalizeMatch(context);
  });
  result.runtimeMs = Math.max(0, Math.round(performance.now() - startedAt));
  return result;
}
