import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager } from './gameLogic.js';
import { AiAdvisor, BOT_ADVISOR_PROMPT_VERSION, DeterministicAdvisor } from './botAdvisor.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import {
  decideBotAuction,
  isAuctionBotParticipant,
  resolvePurchaseOffer,
  runBotTurn,
  selectBotTurnTarget
} from './botLogic.js';
import { summarizePolicyComparison } from './balanceMetrics.js';

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

export function stateFingerprint(game) {
  const stableObject = value => Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify({
    current: game.currentPlayerId,
    started: game.started,
    hasRolled: game.hasRolled,
    awaitingEndTurn: game.awaitingEndTurn,
    extraRollPending: game.extraRollPending,
    lastDice: Array.isArray(game.lastDice) ? game.lastDice.slice() : null,
    pendingPurchase: game.pendingPurchaseOffer ? {
      playerId: game.pendingPurchaseOffer.playerId,
      tileIndex: game.pendingPurchaseOffer.tileIndex
    } : null,
    pendingPayment: game.pendingPayment ? {
      playerId: game.pendingPayment.playerId,
      creditorId: game.pendingPayment.creditorId,
      amount: game.pendingPayment.amount,
      amountRemaining: game.pendingPayment.amountRemaining,
      queue: (game.pendingPaymentQueue || []).map(entry => [entry.payment?.playerId, entry.payment?.creditorId, entry.payment?.amountRemaining])
    } : null,
    pendingTrade: game.pendingTrade ? {
      id: game.pendingTrade.id,
      fromPlayerId: game.pendingTrade.fromPlayerId,
      toPlayerId: game.pendingTrade.toPlayerId,
      counterDepth: game.pendingTrade.counterDepth,
      status: game.pendingTrade.status
    } : null,
    pendingContract: game.pendingPlayerContract ? [game.pendingPlayerContract.id, game.pendingPlayerContract.kind, game.pendingPlayerContract.status, game.pendingPlayerContract.offer] : null,
    pendingSponsoredPurchase: game.pendingSponsoredPurchase ? [game.pendingSponsoredPurchase.buyerId, game.pendingSponsoredPurchase.tileIndex, ...(game.pendingSponsoredPurchase.contributions || []).map(entry => [entry.sponsorId, entry.amount])] : null,
    auction: game.auction ? {
      active: game.auction.active,
      propertyTileIndex: game.auction.propertyTile?.index,
      participants: [...(game.auction.participants || [])].sort(),
      currentPlayerId: game.auction.currentPlayerId,
      highestBid: game.auction.highestBid,
      highestBidderId: game.auction.highestBidderId,
      passedPlayerIds: [...(game.auction.passedPlayerIds || [])].sort()
    } : null,
    globalEvent: game.globalEvent ? [game.globalEvent.id, game.globalEvent.phase, stableObject(game.globalEvent.votes), game.globalEvent.resolvedChoice, game.globalEvent.roundsRemaining, game.globalEvent.settlementApplied] : null,
    round: game.roundNumber,
    market: {
      round: game.marketRound,
      quotes: stableObject(game.marketQuotes),
      shortInventory: stableObject(game.marketShortInventory)
    },
    players: game.players.map(player => ({
      id: player.id,
      cash: player.cash,
      position: player.position,
      properties: [...player.properties].sort((left, right) => left - right).map(index => {
        const tile = typeof game.getTile === 'function' ? game.getTile(index) : game.tiles?.find(entry => entry.index === index);
        return [index, tile?.ownerId, tile?.mortgaged, tile?.houseCount, tile?.hotelCount, tile?.equityShares];
      }),
      bankrupt: player.bankrupt,
      inJail: player.inJail,
      jailTurns: player.jailTurns,
      jailFreeCards: player.jailFreeCards,
      bankLoan: player.bankLoan ? {
        status: player.bankLoan.status,
        principal: player.bankLoan.principal,
        remaining: player.bankLoan.remaining,
        dueRound: player.bankLoan.dueRound,
        cureRound: player.bankLoan.cureRound,
        collateralTileIndex: player.bankLoan.collateralTileIndex,
        severity: player.bankLoan.severity
      } : null,
      marketPositions: stableObject(player.marketPositions),
      marketTrades: player.marketTrades,
      disconnected: player.disconnected
    }))
  });
}

function stableDecisionHash(seed, policyId, decisionIndex) {
  let hash = Number(seed) >>> 0;
  const text = `${String(policyId || 'random-legal')}:${Math.max(0, Number(decisionIndex) || 0)}`;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16_777_619) >>> 0;
  }
  return hash >>> 0;
}

export function createRandomLegalAdvisor() {
  return {
    supportsChoicePhases: true,
    async chooseAction({ candidates = [], simulationSeed = 0, policyId = 'random-legal', policyDecisionIndex = 0 }) {
      if (!candidates.length) return { actionId: null };
      const index = stableDecisionHash(simulationSeed, policyId, policyDecisionIndex) % candidates.length;
      return { actionId: candidates[index]?.id || null };
    }
  };
}

export function createCappedFetch({ maxCalls, fetchImpl = globalThis.fetch } = {}) {
  if (!Number.isInteger(maxCalls) || maxCalls <= 0) throw new TypeError('maxCalls must be a positive integer');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const tracker = {
    maxCalls,
    calls: 0,
    capExhaustions: 0,
    exhausted: false,
    fetchImpl: null
  };
  tracker.fetchImpl = async (...args) => {
    if (tracker.calls >= tracker.maxCalls) {
      tracker.capExhaustions += 1;
      tracker.exhausted = true;
      const error = new Error('Bot evaluation live provider call cap reached');
      error.code = 'POORUP_BOT_EVAL_CALL_CAP';
      throw error;
    }
    tracker.calls += 1;
    return fetchImpl(...args);
  };
  tracker.fetchImpl.botEvalCallCapTracker = tracker;
  return tracker;
}

export function assertHealthyCash(game) {
  game.players.forEach(player => {
    if (!Number.isFinite(player.cash) || player.cash < 0) throw new Error(`${player.nickname} has invalid cash: ${player.cash}`);
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

function playerNetWorth(game, player) {
  const deeds = (player.properties || []).reduce((sum, index) => {
    const tile = game.getTile(index);
    return sum + Number(tile?.price || 0) + (Number(tile?.houseCount || 0) + Number(tile?.hotelCount || 0) * 5) * Number(tile?.houseCost || 0) / 2;
  }, 0);
  const debt = Number(player.bankLoan?.remaining ?? player.bankLoan?.totalDue ?? player.bankLoan?.principal ?? 0);
  return Number(player.cash || 0) + deeds - debt;
}

export function buildMatchResult(room, { seed, policyBySeat, steps, stepLimit, decisionTrace, actionLegalityByPolicy = new Map() }) {
  const game = room.game;
  const netWorthByPolicy = {};
  const seatsByPolicy = {};
  game.players.forEach((player, seat) => {
    const policyId = policyBySeat[seat]?.policyId || `seat-${seat}`;
    netWorthByPolicy[policyId] = (netWorthByPolicy[policyId] || 0) + playerNetWorth(game, player);
    seatsByPolicy[policyId] = [...(seatsByPolicy[policyId] || []), seat];
  });
  const winnerSeat = game.lastWinner ? game.players.findIndex(player => player.id === game.lastWinner.id) : null;
  const order = [...game.players.keys()].sort((left, right) => {
    if (left === winnerSeat) return -1;
    if (right === winnerSeat) return 1;
    return playerNetWorth(game, game.players[right]) - playerNetWorth(game, game.players[left]);
  });
  const placementsByPolicy = {};
  Object.entries(seatsByPolicy).forEach(([policyId, seats]) => {
    placementsByPolicy[policyId] = Math.min(...seats.map(seat => order.indexOf(seat) + 1));
  });
  const legalityByPolicy = Object.fromEntries(Object.keys(seatsByPolicy).map(policyId => {
    const counts = actionLegalityByPolicy.get(policyId) || { actionAttempts: 0, legalActions: 0, illegalActions: 0, unclassifiedActions: 0 };
    const classifiedActions = counts.legalActions + counts.illegalActions;
    return [policyId, {
      ...counts,
      classifiedActions,
      legalityRate: classifiedActions ? counts.legalActions / classifiedActions : null,
      status: counts.actionAttempts === 0 ? 'no-actions' : counts.unclassifiedActions ? 'partial' : 'measured'
    }];
  }));
  return {
    seed,
    policyBySeat: policyBySeat.map(policy => policy.policyId),
    ended: !game.started,
    stepLimitReached: Boolean(game.started && steps >= stepLimit),
    steps,
    round: game.roundNumber,
    winnerSeat: winnerSeat == null || winnerSeat < 0 ? null : winnerSeat,
    winnerPolicyId: winnerSeat == null || winnerSeat < 0 ? null : policyBySeat[winnerSeat]?.policyId || null,
    placementsByPolicy,
    netWorthByPolicy,
    bankruptciesByPolicy: Object.fromEntries(Object.entries(seatsByPolicy).map(([policyId, seats]) => [policyId, seats.filter(seat => game.players[seat].bankrupt).length])),
    legalityByPolicy,
    bankruptcies: game.players.filter(player => player.bankrupt).length,
    featureUsage: {
      auction: Number(game.auctionsCompleted || 0) > 0,
      casino: Array.isArray(game.casinoLedger) && game.casinoLedger.length > 0,
      market: Array.isArray(game.marketLedger) && game.marketLedger.length > 0,
      globalEvents: Number(game.globalEventsTriggered || 0) > 0
    },
    stalls: 0,
    decisionTrace
  };
}

function safeShadowEvaluationTrace(evaluation, policyId) {
  if (!evaluation || typeof evaluation !== 'object') return null;
  return {
    policyId,
    actionKind: String(evaluation.actionKind || 'unknown'),
    deterministicActionKind: String(evaluation.deterministicActionKind || 'unknown'),
    agreement: evaluation.agreement === true,
    phase: String(evaluation.phase || 'unknown'),
    candidateCoverage: {
      totalCount: Number(evaluation.candidateCoverage?.totalCount) || 0,
      sentCount: Number(evaluation.candidateCoverage?.sentCount) || 0,
      omittedCount: Number(evaluation.candidateCoverage?.omittedCount) || 0,
      omittedByKind: { ...(evaluation.candidateCoverage?.omittedByKind || {}) }
    },
    provider: String(evaluation.provider || 'unknown'),
    model: String(evaluation.model || 'unknown'),
    promptVersion: String(evaluation.promptVersion || 'unknown'),
    fallback: evaluation.fallback === true,
    modelFallback: evaluation.modelFallback === true,
    latencyMs: Math.max(0, Number(evaluation.latencyMs) || 0),
    fallbackReason: String(evaluation.fallbackReason || '')
  };
}

export async function simulateBotMatch({ seed, policyBySeat, boardVariant = 'standard-40', settings = {}, stepLimit = 20_000, captureTrace = false, captureShadowTrace = false, callCapTracker = null }) {
  if (!Array.isArray(policyBySeat) || policyBySeat.length < 2) throw new TypeError('policyBySeat must contain at least two policies');
  const policyIds = policyBySeat.map(policy => policy?.policyId);
  if (policyIds.some(policyId => typeof policyId !== 'string' || !policyId.trim())) throw new TypeError('Every policy must have a non-empty policyId');
  if (new Set(policyIds).size !== policyIds.length) throw new TypeError('policyId values must be unique within a match');
  return withSeededSimulationGlobals(seed, async ({ advanceTime }) => {
    const room = createSimulationRoom({ boardVariant, settings: { ...settings, seatCount: policyBySeat.length } });
    if (room.game.players.length !== policyBySeat.length) {
      throw new Error(`Board ${boardVariant} started ${room.game.players.length} bot seats for ${policyBySeat.length} policies`);
    }
    const policiesInGameOrder = room.game.players.map(player => policyBySeat[room.simulationPlayerIds.indexOf(player.id)]);
    const actionLegalityByPolicy = new Map(policiesInGameOrder.map(policy => [policy.policyId, {
      actionAttempts: 0,
      legalActions: 0,
      illegalActions: 0,
      unclassifiedActions: 0
    }]));
    const policyIdByPlayerId = new Map(room.game.players.map((player, seat) => [player.id, policiesInGameOrder[seat].policyId]));
    const runBotAction = room.runBotAction.bind(room);
    room.runBotAction = (playerId, action, ...args) => {
      const result = runBotAction(playerId, action, ...args);
      const policyId = policyIdByPlayerId.get(playerId);
      const counts = actionLegalityByPolicy.get(policyId);
      if (counts) {
        counts.actionAttempts += 1;
        if (result?.success === true) counts.legalActions += 1;
        else if (result?.success === false) counts.illegalActions += 1;
        else counts.unclassifiedActions += 1;
      }
      return result;
    };
    room.game.players.forEach((player, seat) => {
      player.personality = policiesInGameOrder[seat].personality || player.personality;
    });
    for (const advisor of new Set(policyBySeat.map(policy => policy.advisor).filter(Boolean))) {
      if (advisor.decisionCounts instanceof Map) advisor.decisionCounts.clear();
    }
    const callCapTrackers = new Set([
      callCapTracker,
      ...policyBySeat.map(policy => policy.advisor?.fetchImpl?.botEvalCallCapTracker)
    ].filter(Boolean));
    const initialCapCounts = new Map([...callCapTrackers].map(tracker => [tracker, { calls: tracker.calls, exhaustions: tracker.capExhaustions }]));
    let liveAiFallbacks = 0;
    const policyDecisionIndexes = new Map();
    const advisorByPolicyId = new Map(policiesInGameOrder.map(policy => [policy.policyId, {
      supportsChoicePhases: policy.advisor?.supportsChoicePhases,
      supportsChoicePhase: typeof policy.advisor?.supportsChoicePhase === 'function'
        ? phase => policy.advisor.supportsChoicePhase(phase)
        : undefined,
      chooseAction: context => {
        const policyDecisionIndex = policyDecisionIndexes.get(policy.policyId) || 0;
        policyDecisionIndexes.set(policy.policyId, policyDecisionIndex + 1);
        return policy.advisor.chooseAction({
          ...context,
          simulationSeed: seed,
          policyId: policy.policyId,
          policyDecisionIndex
        });
      }
    }]));
    const decisionTrace = captureTrace ? [] : null;
    const shadowTraces = captureShadowTrace ? [] : null;
    let steps = 0;
    let stalls = 0;
    let consecutiveStalls = 0;
    while (room.game.started && steps < stepLimit) {
      advanceTime(1_000);
      const before = stateFingerprint(room.game);
      const auction = room.game.auction;
      const bot = auction?.active
        ? room.game.players.find(player => isAuctionBotParticipant(auction, player))
        : selectBotTurnTarget(room.game);
      if (!bot) {
        if (auction?.active) room.game.finishAuction();
        steps += 1;
        if (before === stateFingerprint(room.game)) {
          stalls += 1;
          consecutiveStalls += 1;
          if (consecutiveStalls >= 8) throw new Error(`Simulation stalled for 8 consecutive steps (seed ${seed})`);
        } else {
          consecutiveStalls = 0;
        }
        assertHealthyCash(room.game);
        continue;
      }
      const seat = room.game.players.indexOf(bot);
      const policy = policiesInGameOrder[seat];
      if (!policy) throw new Error(`No policy configured for seat ${seat}`);
      const previousBrain = room.game.settings.botBrain;
      const previousDifficulty = room.game.settings.botDifficulty;
      room.game.settings.botBrain = policy.brain || 'no-ai';
      room.game.settings.botDifficulty = policy.difficulty || 'table';
      try {
        if (auction?.active) {
          const choice = await decideBotAuction({ auction, bot, startingCash: room.game.settings.startingCash, advisor: advisorByPolicyId.get(policy.policyId), context: buildBotStrategicContext(room.game, bot, 'auction', room.game.botDecisionSequence || 0) });
          if (choice.decision?.fallbackReason === 'live-call-cap') liveAiFallbacks += 1;
          room.runBotAction(bot.id, actor => choice.actionId === 'auction:bid' ? room.placeAuctionBid(actor, choice.minimum) : room.passAuction(actor));
          const trace = { ...choice.decision, phase: 'auction', actionId: choice.actionId };
          const evaluationTrace = safeShadowEvaluationTrace(choice.evaluationTrace, policy.policyId);
          if (evaluationTrace) delete trace.shadowEvaluation;
          room.game.recordBotDecisionTrace(trace);
          if (evaluationTrace) shadowTraces?.push(evaluationTrace);
          if (decisionTrace) decisionTrace.push({ policyId: policy.policyId, phase: 'auction', actionId: choice.actionId, state: stateFingerprint(room.game) });
        } else {
          const result = await runBotTurn(room, bot, advisorByPolicyId.get(policy.policyId));
          if (result?.botDecision?.fallbackReason === 'live-call-cap') liveAiFallbacks += 1;
          if (result?.botDecision) room.game.recordBotDecisionTrace(result.botDecision);
          const evaluationTrace = safeShadowEvaluationTrace(result?.evaluationTrace, policy.policyId);
          if (evaluationTrace) shadowTraces?.push(evaluationTrace);
          resolvePurchaseOffer(room, bot, result);
          if (decisionTrace) decisionTrace.push({ policyId: policy.policyId, phase: result?.botDecision?.phase, actionId: result?.botDecision?.actionId, state: stateFingerprint(room.game) });
        }
      } finally {
        room.game.settings.botBrain = previousBrain;
        room.game.settings.botDifficulty = previousDifficulty;
      }
      steps += 1;
      assertHealthyCash(room.game);
      if (before === stateFingerprint(room.game)) {
        stalls += 1;
        consecutiveStalls += 1;
        if (consecutiveStalls >= 8) {
          const diagnosticTrace = decisionTrace?.slice(-8).map(({ policyId, phase, actionId }) => ({ policyId, phase, actionId }));
          const diagnostic = diagnosticTrace
            ? `; actor ${bot.id} seat ${seat} auction ${JSON.stringify({
              active: room.game.auction?.active,
              participants: room.game.auction?.participants,
              highestBid: room.game.auction?.highestBid,
              highestBidderId: room.game.auction?.highestBidderId,
              passedPlayerIds: room.game.auction?.passedPlayerIds
            })}; recent decisions ${JSON.stringify(diagnosticTrace)}`
            : '';
          throw new Error(`Simulation stalled for 8 consecutive steps (seed ${seed})${diagnostic}`);
        }
      } else {
        consecutiveStalls = 0;
      }
    }
    const result = buildMatchResult(room, { seed, policyBySeat: policiesInGameOrder, steps, stepLimit, decisionTrace, actionLegalityByPolicy });
    if (shadowTraces) {
      result.shadowTrace = shadowTraces.map(entry => ({
        ...entry,
        linkedOutcome: {
          matchSeed: seed,
          ended: result.ended,
          winnerSeat: result.winnerSeat,
          placements: Object.values(result.placementsByPolicy).sort((a, b) => a - b),
          bankruptcies: result.bankruptcies,
          steps: result.steps
        }
      }));
    }
    result.stalls = stalls;
    result.liveAiCalls = [...callCapTrackers].reduce((sum, tracker) => sum + tracker.calls - initialCapCounts.get(tracker).calls, 0);
    result.liveAiCapExhaustions = [...callCapTrackers].reduce((sum, tracker) => sum + tracker.capExhaustions - initialCapCounts.get(tracker).exhaustions, 0);
    result.liveAiCallCapReached = result.liveAiCapExhaustions > 0;
    result.liveAiFallbacks = liveAiFallbacks;
    result.liveAiStatus = callCapTrackers.size === 0
      ? 'stubbed'
      : result.liveAiCallCapReached ? 'cap-exhausted-fallbacks' : 'within-call-cap';
    return result;
  });
}

export async function runBotTournament({ seeds, policySets, seatRotations = [0], boardVariants = ['standard-40'], settings = {}, stepLimit = 20_000, callCapTracker = null, captureShadowTrace = false }) {
  const matches = [];
  const policies = new Map();
  for (const set of policySets || []) for (const policy of set) policies.set(policy.policyId, policy);
  for (const seed of seeds || []) {
    for (const policySet of policySets || []) {
      for (const seatRotation of seatRotations) {
        for (const boardVariant of boardVariants) {
          const policyBySeat = policySet.map((_, index) => policySet[(index + seatRotation) % policySet.length]);
          matches.push({ ...(await simulateBotMatch({ seed, policyBySeat, boardVariant, settings: { ...settings, seatCount: policySet.length }, stepLimit, callCapTracker, captureShadowTrace })), seatRotation, boardVariant });
        }
      }
    }
  }
  const policyOutcomes = Object.fromEntries([...policies.keys()].map(policyId => [policyId, {
    matches: matches.filter(match => match.policyBySeat.includes(policyId)).length,
    completed: matches.filter(match => match.ended && match.policyBySeat.includes(policyId)).length,
    wins: matches.filter(match => match.ended && match.winnerPolicyId === policyId).length,
    averagePlacement: (() => {
      const values = matches.filter(match => match.ended && match.placementsByPolicy[policyId] != null).map(match => match.placementsByPolicy[policyId]);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    })(),
    legality: (() => {
      const totals = matches.reduce((sum, match) => {
        const metric = match.legalityByPolicy?.[policyId];
        if (!metric) return sum;
        sum.actionAttempts += metric.actionAttempts;
        sum.legalActions += metric.legalActions;
        sum.illegalActions += metric.illegalActions;
        sum.unclassifiedActions += metric.unclassifiedActions;
        return sum;
      }, { actionAttempts: 0, legalActions: 0, illegalActions: 0, unclassifiedActions: 0 });
      const classifiedActions = totals.legalActions + totals.illegalActions;
      return {
        ...totals,
        classifiedActions,
        legalityRate: classifiedActions ? totals.legalActions / classifiedActions : null,
        status: totals.actionAttempts === 0 ? 'no-actions' : totals.unclassifiedActions ? 'partial' : 'measured'
      };
    })()
  }]));
  const matchesByComparisonStratum = new Map();
  for (const match of matches) {
    const ids = [...new Set(match.policyBySeat)].sort();
    for (let left = 0; left < ids.length; left += 1) for (let right = left + 1; right < ids.length; right += 1) {
      const leftId = ids[left];
      const rightId = ids[right];
      const opponents = ids.filter((_, index) => index !== left && index !== right);
      const key = `${leftId}:${rightId}:vs:${opponents.join('+') || 'none'}`;
      const stratum = matchesByComparisonStratum.get(key) || { leftId, rightId, opponents, rows: [] };
      stratum.rows.push(match);
      matchesByComparisonStratum.set(key, stratum);
    }
  }
  const pairedDifferences = Object.fromEntries([...matchesByComparisonStratum].map(([key, stratum]) => {
    return [key, {
      ...summarizePolicyComparison(stratum.rows, stratum.leftId, stratum.rightId),
      opponentPolicyIds: stratum.opponents
    }];
  }));
  const shadowByPolicy = new Map();
  matches.forEach(match => (match.shadowTrace || []).forEach(entry => {
    const row = shadowByPolicy.get(entry.policyId) || { decisions: 0, agreements: 0, actionKinds: {}, deterministicActionKinds: {}, phases: {}, fallbacks: 0, matches: 0 };
    row.decisions += 1;
    row.agreements += entry.agreement ? 1 : 0;
    row.actionKinds[entry.actionKind] = (row.actionKinds[entry.actionKind] || 0) + 1;
    row.deterministicActionKinds[entry.deterministicActionKind] = (row.deterministicActionKinds[entry.deterministicActionKind] || 0) + 1;
    row.phases[entry.phase] = (row.phases[entry.phase] || 0) + 1;
    row.fallbacks += entry.fallback || entry.modelFallback ? 1 : 0;
    row.matches += 1;
    shadowByPolicy.set(entry.policyId, row);
  }));
  const shadowEvaluationSummary = Object.fromEntries([...shadowByPolicy].map(([policyId, row]) => [policyId, {
    ...row,
    agreementRate: row.decisions ? row.agreements / row.decisions : 0,
    aggregatePolicyOutcome: policyOutcomes[policyId] || null
  }]));
  return {
    matches,
    completedCount: matches.filter(match => match.ended).length,
    incompleteCount: matches.filter(match => !match.ended).length,
    liveAiCalls: matches.reduce((sum, match) => sum + match.liveAiCalls, 0),
    liveAiCapExhaustions: matches.reduce((sum, match) => sum + match.liveAiCapExhaustions, 0),
    liveAiFallbacks: matches.reduce((sum, match) => sum + match.liveAiFallbacks, 0),
    liveAiCappedMatches: matches.filter(match => match.liveAiCallCapReached).length,
    liveAiStatus: matches.some(match => match.liveAiCallCapReached)
      ? 'cap-exhausted-fallbacks'
      : matches.some(match => match.liveAiStatus === 'within-call-cap') ? 'within-call-cap' : 'stubbed',
    policyOutcomes,
    pairedDifferences,
    shadowEvaluationSummary
  };
}

export function createBotPolicy(policyId, { brain = 'no-ai', personality = 'survivor', difficulty = 'table', advisor } = {}) {
  const defaultAdvisor = advisor || new DeterministicAdvisor();
  return { policyId, brain, difficulty, personality, advisor: defaultAdvisor };
}

export function createDefaultPolicySet({ fetchImpl } = {}) {
  const aiAdvisor = new AiAdvisor({
    apiKey: process.env.POORUP_AI_API_KEY || process.env.DEEPSEEK_API_KEY || 'simulation-stub',
    endpoint: process.env.POORUP_AI_BASE_URL || process.env.DEEPSEEK_API_URL,
    model: process.env.POORUP_AI_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    protocol: process.env.POORUP_AI_PROTOCOL || process.env.DEEPSEEK_API_FORMAT || 'auto',
    fetchImpl: fetchImpl || (async (_url, options) => {
      const request = JSON.parse(options.body);
      const prompt = request.messages?.at(-1)?.content
        || request.input?.find(item => item.role === 'user')?.content?.[0]?.text
        || '{}';
      const context = JSON.parse(prompt);
      const output = JSON.stringify({ actionId: context.candidates?.[0]?.actionId, confidence: 0.55, reasonCode: 'evaluation-stub' });
      const payload = Array.isArray(request.input)
        ? { output_text: output }
        : { choices: [{ message: { content: output } }] };
      return { ok: true, status: 200, json: async () => payload };
    })
  });
  const greedy = { supportsChoicePhases: true, async chooseAction({ candidates = [] }) { return { actionId: [...candidates].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0]?.id }; } };
  const conservative = { supportsChoicePhases: true, async chooseAction({ candidates = [] }) { return { actionId: [...candidates].sort((a, b) => Number(b.score || 0) - Number(a.score || 0) + Math.abs(Number(a.cost || a.projectedCashDelta || 0)) * 0.01 - Math.abs(Number(b.cost || b.projectedCashDelta || 0)) * 0.01)[0]?.id }; } };
  return [
    createBotPolicy('no-ai', { brain: 'no-ai', advisor: new DeterministicAdvisor() }),
    createBotPolicy('ai-stub', { brain: 'ai', advisor: aiAdvisor }),
    createBotPolicy('score-greedy', { advisor: greedy }),
    createBotPolicy('conservative-cash', { advisor: conservative }),
    createBotPolicy('random-legal', { advisor: createRandomLegalAdvisor() })
  ];
}

function boundedInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

async function runCli() {
  const live = process.env.POORUP_BOT_LIVE_AI === '1';
  const maxCalls = Number(process.env.POORUP_BOT_LIVE_AI_MAX_CALLS);
  if (live && (!Number.isInteger(maxCalls) || maxCalls <= 0)) {
    throw new Error('Live AI requires POORUP_BOT_LIVE_AI_MAX_CALLS to be a positive integer.');
  }
  if (live && !(process.env.POORUP_AI_API_KEY || process.env.DEEPSEEK_API_KEY)) {
    throw new Error('Live AI requires POORUP_AI_API_KEY or DEEPSEEK_API_KEY.');
  }
  const callCapTracker = live ? createCappedFetch({ maxCalls, fetchImpl: globalThis.fetch }) : null;
  const policySet = createDefaultPolicySet({ fetchImpl: callCapTracker?.fetchImpl });
  const count = boundedInteger(process.env.POORUP_BOT_EVAL_COUNT, 1, 100);
  const stepLimit = boundedInteger(process.env.POORUP_BOT_EVAL_STEP_LIMIT, 20_000, 100_000);
  const explicitSeeds = String(process.env.POORUP_BOT_EVAL_SEEDS || '').split(',').map(value => Number(value.trim())).filter(Number.isSafeInteger);
  const seeds = explicitSeeds.length ? explicitSeeds.slice(0, count) : Array.from({ length: count }, (_, index) => index + 1);
  // Three bot seats fit the existing room setting contract. Cover every
  // policy pair by rotating every three-policy combination.
  const policySets = [];
  for (let a = 0; a < policySet.length; a += 1) for (let b = a + 1; b < policySet.length; b += 1) {
    for (let c = b + 1; c < policySet.length; c += 1) policySets.push([policySet[a], policySet[b], policySet[c]]);
  }
  const seatRotations = [0, 1, 2];
  const report = await runBotTournament({ seeds, policySets, seatRotations, stepLimit, callCapTracker });
  console.log(JSON.stringify({
    model: process.env.POORUP_AI_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash (stub)',
    promptVersion: BOT_ADVISOR_PROMPT_VERSION,
    liveAi: live,
    liveCallCap: live ? maxCalls : 0,
    actualCalls: live ? callCapTracker.calls : policySet.find(policy => policy.policyId === 'ai-stub').advisor.aiCalls,
    seeds,
    stepLimit,
    ...report
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
