import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { RoomManager } from './gameLogic.js';
import { buildBotStrategicContext, BOT_RULE_VERSION } from './botStrategicContext.js';
import { buildMatchResult, safeShadowEvaluationTrace } from './botTournamentResults.js';
import { stateFingerprint } from './botTournamentState.js';
import { auctionWillingness } from './botAuctionPolicy.js';
import { ROUND_LIMIT } from './gameData.js';
import {
  decideBotAuction,
  isAuctionBotParticipant,
  resolvePurchaseOffer,
  runBotTurn,
  selectBotTurnTarget,
} from './botLogic.js';

// mulberry32: a well-mixed deterministic PRNG. The previous linear congruential
// generator alternated parity on every draw, and two consecutive dice reduced
// with % 6 therefore never matched, so the simulator never rolled doubles (F-063).
function mulberry32(initialState) {
  let state = initialState | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// The PRNG state is 32 bits wide, so a seed outside the unsigned 32-bit range
// was silently truncated into a different seed's stream: seed 2^32 and seed 0
// produced the same match. A seed is validated and the validated value is the
// one that is reported.
export const MAX_SIMULATION_SEED = 0xFFFFFFFF;

export function normalizeSimulationSeed(seedValue) {
  const seed = Number(seedValue);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_SIMULATION_SEED) {
    throw new RangeError(`Simulation seed must be an unsigned 32-bit integer (0-${MAX_SIMULATION_SEED})`);
  }
  return seed;
}

// Global functions cannot be replaced per async caller. Serialize unrelated
// top-level simulations, then dispatch through AsyncLocalStorage so nested
// scopes get their own seed and stale descendants fall back to native globals.
const simulationScopeStorage = new AsyncLocalStorage();
let seededScopeQueue = Promise.resolve();

function createSeededScope(seed, group) {
  const nextUnitDraw = mulberry32(seed >>> 0);
  let uuidSequence = 0;
  let simulationTime = 1_700_000_000_000 + seed;
  const advanceTime = durationMs => {
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration < 0) throw new RangeError('Simulation time must advance by a finite non-negative duration');
    simulationTime += Math.floor(duration);
  };
  // Same [min, max) contract as crypto.randomInt.
  return {
    group,
    active: true,
    randomInt: (min, max) => min + Math.floor(nextUnitDraw() * Math.max(1, max - min)),
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`,
    now: () => simulationTime,
    advanceTime,
  };
}

function runScopedCallback(group, seed, callback) {
  const scope = createSeededScope(seed, group);
  group.pending += 1;
  return simulationScopeStorage.run(scope, async () => {
    try {
      return await callback({ advanceTime: scope.advanceTime });
    } finally {
      scope.active = false;
      group.pending -= 1;
      if (group.pending === 0) group.resolveFinished();
    }
  });
}

async function runSeededGroup(seed, callback) {
  const originals = { randomInt: crypto.randomInt, randomUUID: crypto.randomUUID, now: Date.now };
  const readScope = () => {
    const scope = simulationScopeStorage.getStore();
    return scope?.active ? scope : null;
  };
  crypto.randomInt = (...args) => readScope()?.randomInt(...args) ?? originals.randomInt(...args);
  crypto.randomUUID = (...args) => readScope()?.randomUUID(...args) ?? originals.randomUUID(...args);
  Date.now = (...args) => readScope()?.now(...args) ?? originals.now(...args);

  let resolveFinished;
  const group = {
    pending: 0,
    finished: new Promise(resolve => { resolveFinished = resolve; }),
    resolveFinished: () => resolveFinished(),
  };
  try {
    return await runScopedCallback(group, seed, callback);
  } finally {
    // A callback may launch an unawaited nested scope. Keep the dispatchers in
    // place until every active descendant has finished, even on rejection.
    await group.finished;
    crypto.randomInt = originals.randomInt;
    crypto.randomUUID = originals.randomUUID;
    Date.now = originals.now;
  }
}

export function withSeededSimulationGlobals(seedValue, callback) {
  const seed = normalizeSimulationSeed(seedValue);
  const parent = simulationScopeStorage.getStore();
  if (parent?.active) return runScopedCallback(parent.group, seed, callback);
  const queued = seededScopeQueue.then(() => runSeededGroup(seed, callback));
  seededScopeQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

// A match ends on its own at ROUND_LIMIT, so the step budget scales with it. A
// 3-seat planner game spends about 3.7 steps per seat-round (3,000-3,500 steps
// for 300 rounds); 12 per seat-round leaves roughly 3x headroom for auction
// bursts. The old fixed 2,000-step budget censored every planner game before the
// round limit (0 of 24 finished), so win rates described unfinished positions.
export const STEPS_PER_SEAT_ROUND = 12;

export function defaultStepLimit(seatCount) {
  const seats = Math.max(2, Math.floor(Number(seatCount)) || 3);
  return ROUND_LIMIT * seats * STEPS_PER_SEAT_ROUND;
}

function resolveStepLimit(requested, seatCount) {
  if (requested == null) return defaultStepLimit(seatCount);
  const limit = Number(requested);
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('stepLimit must be a positive integer');
  return limit;
}

// Harness economy, not the shipped room default (F-083): casino, market and
// globalEvents default ON, startingCash defaults to 500 (roomSettings default
// is 1500), and seatCount is clamped to 2-3. Tournament numbers describe this
// variant, so they are not evidence about a default table.
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

// Advisor state that must not survive a match boundary. A shared advisor
// otherwise carries the previous match's call budget, circuit breaker state
// and counters into the next one, so a later match falls back to the
// deterministic planner for reasons that have nothing to do with that match.
const ADVISOR_MATCH_STATE = {
  aiCalls: 0,
  fallbackCalls: 0,
  failureStreak: 0,
  circuitOpenUntil: 0,
  quotaExhausted: false,
  quotaProbeAt: 0,
  lastFailure: null
};

function resetAdvisorForMatch(advisor) {
  if (!advisor || typeof advisor !== 'object') return advisor;
  if (advisor.decisionCounts instanceof Map) advisor.decisionCounts.clear();
  if (Array.isArray(advisor.callTimestamps)) advisor.callTimestamps.length = 0;
  Object.entries(ADVISOR_MATCH_STATE).forEach(([field, value]) => {
    if (field in advisor) advisor[field] = value;
  });
  const stats = advisor.optionPositionStats;
  if (stats && typeof stats === 'object') {
    stats.answers = 0;
    stats.firstPosition = 0;
    stats.plannerBest = 0;
    stats.byPosition = {};
  }
  return advisor;
}

// A policy may carry `createAdvisor`; each match then gets its own advisor, so
// call timestamps, circuit state, budgets and counters never leak between
// matches. A policy that only carries an advisor shares that instance, so its
// per-match state is reset instead of inherited.
function materializePolicy(policy) {
  if (typeof policy.createAdvisor === 'function') return { ...policy, advisor: policy.createAdvisor() };
  return { ...policy, advisor: resetAdvisorForMatch(policy.advisor) };
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
  const policies = policiesInGameOrder(room, options.policyBySeat, options.boardVariant).map(materializePolicy);
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
    auctionEvaluations: new Map(),
    callCapTrackers: trackers,
    initialCapCounts: initialCallCapCounts(trackers),
    advisorByPolicyId: createAdvisorFacades(policies, options.seed),
    decisionTrace: options.captureTrace ? [] : null,
    shadowTraces: options.captureShadowTrace ? [] : null,
    stepLimit: resolveStepLimit(options.stepLimit, options.policyBySeat.length),
    steps: 0,
    stalls: 0,
    stalled: false,
    stallDetail: null,
    consecutiveStalls: 0,
    auctionOrdinal: 0,
    auctionKey: null,
    auctionStartSeat: 0,
    liveAiFallbacks: 0,
    advanceTime,
  };
}

// Seats respond to an auction in a cycle, never in fixed seat order. A fixed
// order let seat 0 always open and answer first (one seat won 11 of 12 auctions
// at cash 1500). The opening seat advances one seat per auction, offset by the
// match seed; after a bid the next responder is the seat after the bidder.
export function auctionResponseOrder(context, auction) {
  const { players } = context.room.game;
  const key = `${auction.startedAt || 0}:${auction.propertyTile?.index ?? 'x'}`;
  if (context.auctionKey !== key) {
    context.auctionKey = key;
    context.auctionStartSeat = ((Number(context.seed) >>> 0) + context.auctionOrdinal) % players.length;
    context.auctionOrdinal += 1;
  }
  const bidderSeat = players.findIndex(player => player.id === auction.highestBidderId);
  const first = bidderSeat >= 0 ? bidderSeat + 1 : context.auctionStartSeat;
  return players.map((_, offset) => players[(first + offset) % players.length]);
}

function currentBot(context) {
  const { game } = context.room;
  const auction = game.auction;
  return auction?.active
    ? auctionResponseOrder(context, auction).find(player => isAuctionBotParticipant(auction, player)
      && context.auctionEvaluations.get(player.id) !== simulationAuctionIdentity(auction, player))
    : selectBotTurnTarget(game);
}

function simulationAuctionIdentity(auction, bot) {
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
  const auctionVersion = simulationAuctionIdentity(auction, bot);
  const projectedValue = auctionWillingness(auction, bot, game);
  const decisionSequence = Number(game.botDecisionSequence || 0);
  // The live path (socketRuntime.beginBotAuctionBidUnlocked) hands the advisor
  // the game and this same set of context fields. Without them the simulated
  // auction decision ran on a blind baseline: the policy difficulty was
  // ignored and the reserve was a flat floor.
  const decisionContext = {
    botId: bot.id,
    botBrain: policy.brain || 'no-ai',
    botDifficulty: policy.difficulty || 'table',
    gameId: `simulation:${context.room.roomCode || 'match'}:${game.startedAt || 'pending'}`,
    decisionSequence,
    ruleVersion: BOT_RULE_VERSION,
    ...buildBotStrategicContext(game, bot, 'auction', decisionSequence),
    event: game.globalEvent
  };
  const choice = await decideBotAuction({
    auction,
    bot,
    startingCash: game.settings.startingCash,
    game,
    advisor: context.advisorByPolicyId.get(policy.policyId),
    context: decisionContext,
  });
  trackLiveAiFallback(context, choice.decision?.fallbackReason);
  if (simulationAuctionIdentity(game.auction, bot) !== auctionVersion) return;
  context.auctionEvaluations.set(bot.id, auctionVersion);
  const result = choice.actionId === 'auction:bid'
    ? context.room.runBotAction(bot.id, actor => context.room.placeAuctionBid(actor, choice.amount))
    : { success: true, noEmit: true };
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
  return { waiting: choice.actionId === 'auction:wait' };
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
    if (game.auction?.active) return await runAuctionAction(context, bot, policy);
    await runOrdinaryAction(context, bot, policy);
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
    throw new SimulationStallError(`Simulation stalled for 8 consecutive steps (seed ${context.seed})${detail}`);
  }
}

function finishNoBotStep(context, before) {
  const game = context.room.game;
  const auction = game.auction;
  const endsAt = Number(auction?.endsAt);
  if (auction?.active && (!Number.isFinite(endsAt) || Date.now() >= endsAt)) game.finishAuction();
  else if (auction?.active) {
    context.steps += 1;
    context.consecutiveStalls = 0;
    assertHealthyCash(game);
    return;
  }
  context.steps += 1;
  recordStall(context, before);
  assertHealthyCash(game);
}

async function runBotStep(context, bot, before) {
  const seat = context.room.game.players.indexOf(bot);
  const policy = context.policies[seat];
  if (!policy) throw new Error(`No policy configured for seat ${seat}`);
  const actionResult = await runActiveBotAction(context, bot, policy);
  context.steps += 1;
  assertHealthyCash(context.room.game);
  if (actionResult?.waiting) {
    context.consecutiveStalls = 0;
    return;
  }
  recordStall(context, before, bot, seat);
}

class SimulationStallError extends Error {}

async function runSimulationSteps(context) {
  while (context.room.game.started && context.steps < context.stepLimit && !context.stalled) {
    context.advanceTime(1_000);
    const before = stateFingerprint(context.room.game);
    const bot = currentBot(context);
    try {
      if (!bot) finishNoBotStep(context, before);
      else await runBotStep(context, bot, before);
    } catch (error) {
      // A stall is a measured outcome (completionKind 'stall'), not a crash that
      // discards every other match in the campaign.
      if (!(error instanceof SimulationStallError)) throw error;
      context.stalled = true;
      context.stallDetail = error.message;
    }
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
    stalled: context.stalled,
    decisionTrace: context.decisionTrace,
    actionLegalityByPolicy: context.actionLegalityByPolicy,
    strategyMetricsByPolicy: context.strategyMetricsByPolicy,
  });
  if (context.shadowTraces) result.shadowTrace = context.shadowTraces.map(trace => linkedShadowTrace(trace, result, context.seed));
  result.stalls = context.stalls;
  result.stallDetail = context.stallDetail;
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
  // The seed is validated and normalized once, so the match reports the seed
  // that actually ran instead of the raw value that was truncated into it.
  const seed = normalizeSimulationSeed(options.seed);
  const startedAt = performance.now();
  const result = await withSeededSimulationGlobals(seed, async ({ advanceTime }) => {
    const context = createSimulationContext({ ...options, seed }, advanceTime);
    await runSimulationSteps(context);
    return finalizeMatch(context);
  });
  result.seed = seed;
  result.runtimeMs = Math.max(0, Math.round(performance.now() - startedAt));
  return result;
}
