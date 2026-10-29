import assert from 'node:assert/strict';
import * as tournamentApi from './bot-policy-tournament.js';
import { AiAdvisor } from './botAdvisor.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import { buildMatchResult, playerNetWorth } from './botTournamentResults.js';
import { buildTournamentSummary } from './botTournamentSummary.js';
import {
  createBotPolicy,
  createDefaultPolicySet,
  createSimulationRoom,
  runBotTournament,
  simulateBotMatch,
  stateFingerprint,
  withSeededSimulationGlobals
} from './bot-policy-tournament.js';

const defaultAiStub = createDefaultPolicySet().find(policy => policy.policyId === 'ai-stub').advisor;
const policies = [
  createBotPolicy('first', { brain: 'no-ai', difficulty: 'table' }),
  createBotPolicy('second', { brain: 'ai', difficulty: 'expert', advisor: defaultAiStub })
];
assert.equal('personality' in policies[0], false);
assert.equal(policies[0].brain, 'no-ai');
assert.equal(policies[0].difficulty, 'table');
assert.equal(policies[1].brain, 'ai');
assert.equal(policies[1].difficulty, 'expert');

const defaultAiChoice = await defaultAiStub.chooseAction({
  botBrain: 'ai', gameId: 'default-ai-stub', candidates: [{ id: 'selected-candidate', kind: 'roll', score: 1 }]
});
assert.equal(defaultAiChoice.provider, 'ai');
assert.equal(defaultAiChoice.actionId, 'selected-candidate');

const greedyAdvisor = createDefaultPolicySet().find(policy => policy.policyId === 'score-greedy').advisor;
const greedyChoice = await greedyAdvisor.chooseAction({ candidates: [{ id: 'low', score: 1 }, { id: 'high', score: 2 }] });
assert.equal(greedyChoice.actionId, 'high');
const conservativeAdvisor = createDefaultPolicySet().find(policy => policy.policyId === 'conservative-cash').advisor;
const conservativeChoice = await conservativeAdvisor.chooseAction({ candidates: [{ id: 'costly', score: 10, cost: 900 }, { id: 'steady', score: 2, cost: 0 }] });
assert.equal(conservativeChoice.actionId, 'steady');

assert.equal(typeof tournamentApi.createCappedFetch, 'function', 'live campaigns expose a capped provider transport with observable exhaustion');

const cappedTransport = tournamentApi.createCappedFetch({
  maxCalls: 1,
  fetchImpl: async () => ({ ok: false, status: 500 })
});
const cappedAdvisor = new AiAdvisor({ apiKey: 'test-key', fetchImpl: cappedTransport.fetchImpl, circuitCooldownMs: 60_000 });
const cappedPolicies = [
  createBotPolicy('capped-ai-a', { brain: 'ai', advisor: cappedAdvisor }),
  createBotPolicy('capped-ai-b', { brain: 'ai', advisor: cappedAdvisor })
];
const cappedMatch = await simulateBotMatch({ seed: 400, policyBySeat: cappedPolicies, stepLimit: 12 });
assert.equal(cappedTransport.calls, 1, 'provider invocation count never exceeds the configured cap');
assert.ok(cappedTransport.capExhaustions > 0, 'an over-cap request is counted as an exhaustion');
assert.equal(cappedMatch.liveAiStatus, 'cap-exhausted-fallbacks');
assert.ok(cappedMatch.liveAiFallbacks > 0, 'cap-triggered advisor fallback is counted on the match');
assert.equal(cappedMatch.liveAiCapExhaustions, cappedTransport.capExhaustions);
const campaignTransport = tournamentApi.createCappedFetch({
  maxCalls: 1,
  fetchImpl: async () => ({ ok: false, status: 500 })
});
const campaignAdvisor = new AiAdvisor({ apiKey: 'test-key', fetchImpl: campaignTransport.fetchImpl, circuitCooldownMs: 60_000 });
const cappedCampaign = await runBotTournament({
  seeds: [401],
  policySets: [[
    createBotPolicy('campaign-ai-a', { brain: 'ai', advisor: campaignAdvisor }),
    createBotPolicy('campaign-ai-b', { brain: 'ai', advisor: campaignAdvisor })
  ]],
  seatRotations: [0],
  stepLimit: 12,
  callCapTracker: campaignTransport
});
assert.equal(cappedCampaign.liveAiCalls, 1);
assert.equal(cappedCampaign.liveAiStatus, 'cap-exhausted-fallbacks');
assert.equal(cappedCampaign.liveAiCappedMatches, 1);
assert.ok(cappedCampaign.liveAiFallbacks > 0);

await assert.rejects(simulateBotMatch({
  seed: 101,
  policyBySeat: [policies[0], { ...policies[1], policyId: 'first' }],
  stepLimit: 1
}), /policyId values must be unique/);

const originalRandomInt = (await import('node:crypto')).default.randomInt;
await assert.rejects(withSeededSimulationGlobals(14, async () => { throw new Error('seed-scope-check'); }), /seed-scope-check/);
assert.equal((await import('node:crypto')).default.randomInt, originalRandomInt, 'seeded globals restore after callback rejection');
await withSeededSimulationGlobals(15, async ({ advanceTime }) => {
  const startedAt = Date.now();
  advanceTime(300);
  assert.equal(Date.now(), startedAt + 300, 'simulations advance deterministic virtual time for timed game rules');
});
const delayedProvider = new AiAdvisor({
  apiKey: 'latency-test-key',
  fetchImpl: async (_url, options) => {
    await new Promise(resolve => setTimeout(resolve, 20));
    const request = JSON.parse(options.body);
    const prompt = request.messages?.[1]?.content || request.input?.[1]?.content?.[0]?.text;
    const actionId = JSON.parse(prompt).candidates[0].actionId;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ actionId, confidence: 0.8 }) } }] })
    };
  }
});
const delayedDecision = await withSeededSimulationGlobals(16, () => delayedProvider.chooseAction({
  botBrain: 'ai',
  gameId: 'virtual-clock-provider-latency',
  candidates: [{ id: 'roll', kind: 'roll', score: 1 }]
}));
assert.ok(delayedDecision.latencyMs >= 10, 'AI provider latency uses elapsed wall time, not the frozen simulation clock');

const first = await simulateBotMatch({ seed: 7123, policyBySeat: policies, stepLimit: 10, captureTrace: true });
const replay = await simulateBotMatch({ seed: 7123, policyBySeat: policies, stepLimit: 10, captureTrace: true });
assert.deepEqual(replay.decisionTrace, first.decisionTrace, 'same seed and policies reproduce the decision trace');
const firstLegality = first.legalityByPolicy?.first;
assert.ok(firstLegality, 'match output includes an explicit legality metric for each policy');
assert.ok(firstLegality.actionAttempts > 0, 'authoritative action attempts are counted');
assert.equal(firstLegality.legalActions + firstLegality.illegalActions + firstLegality.unclassifiedActions, firstLegality.actionAttempts);
assert.equal(typeof firstLegality.legalityRate, 'number');
assert.equal(first.ended, false);
assert.equal(first.stepLimitReached, true);
assert.equal(first.completed, false, 'a step-limited match is censored rather than treated as completed');
assert.ok(Number.isFinite(first.runtimeMs));
assert.equal(first.strategyMetricsByPolicy.first.providerCalls, 0);
assert.ok(first.strategyMetricsByPolicy.second.providerCalls > 0, 'AI stub calls are attributed to its policy');
assert.equal(typeof first.marketPnlByPolicy.first, 'number');
assert.equal(typeof first.strategyMetricsByPolicy.second.maxAuctionBidPremium, 'number');

const tournament = await runBotTournament({
  seeds: [9],
  policySets: [policies],
  seatRotations: [0, 1],
  boardVariants: ['standard-40'],
  stepLimit: 1
});
assert.equal(tournament.matches.length, 2);
assert.equal(tournament.incompleteCount, 2, 'capped matches count as incomplete');
assert.equal(tournament.completedCount, 0, 'capped matches do not count as wins');
assert.deepEqual(tournament.matches.map(match => match.policyBySeat), [['first', 'second'], ['second', 'first']]);
assert.equal(tournament.policyOutcomes.first.legality.actionAttempts,
  tournament.matches.reduce((sum, match) => sum + match.legalityByPolicy.first.actionAttempts, 0),
  'campaign legality metrics aggregate the underlying match action results');
assert.ok(tournament.matches.every(match => match.winnerPolicyId === null));
assert.ok(tournament.matches.every(match => match.stalls === 0));

const shadowStub = new AiAdvisor({
  apiKey: 'evaluation-only-key',
  shadow: true,
  fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    const providerContext = JSON.parse(body.messages[1].content);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ actionId: providerContext.candidates[0].actionId, confidence: 0.75, reasonCode: 'best-value' }) } }] }) };
  }
});
const shadowPolicy = createBotPolicy('shadow-eval', { brain: 'ai', advisor: shadowStub });
const shadowMatch = await simulateBotMatch({ seed: 611, policyBySeat: [shadowPolicy, createBotPolicy('shadow-control')], stepLimit: 6, captureShadowTrace: true });
assert.ok(shadowMatch.shadowTrace.length > 0);
for (const entry of shadowMatch.shadowTrace) {
  assert.equal(typeof entry.actionKind, 'string');
  assert.equal(typeof entry.deterministicActionKind, 'string');
  assert.equal(typeof entry.agreement, 'boolean');
  assert.ok(entry.candidateCoverage.totalCount >= entry.candidateCoverage.sentCount);
  assert.equal(typeof entry.provider, 'string');
  assert.equal(typeof entry.model, 'string');
  assert.equal(typeof entry.promptVersion, 'string');
  assert.equal(typeof entry.fallback, 'boolean');
  assert.equal(typeof entry.latencyMs, 'number');
  assert.ok(entry.linkedOutcome && typeof entry.linkedOutcome.ended === 'boolean');
  const serializedTrace = JSON.stringify(entry);
  for (const field of ['actionId', 'candidateIds', 'playerId', 'accountId', 'socketId', 'promptText', 'reasoning']) {
    assert.equal(Object.hasOwn(entry, field), false, `shadow evaluation must not expose ${field}`);
    assert.equal(serializedTrace.includes('private-player'), false);
  }
}
const shadowTournament = await runBotTournament({
  seeds: [612],
  policySets: [[shadowPolicy, createBotPolicy('shadow-aggregate-control')]],
  seatRotations: [0],
  stepLimit: 6,
  captureShadowTrace: true
});
const aggregateShadow = shadowTournament.shadowEvaluationSummary['shadow-eval'];
assert.ok(aggregateShadow.decisions > 0);
assert.ok(aggregateShadow.aggregatePolicyOutcome);
assert.equal(aggregateShadow.aggregatePolicyOutcome.matches, 1);
assert.equal(typeof aggregateShadow.agreementRate, 'number');
assert.ok(Object.keys(aggregateShadow.actionKinds).length > 0);

const randomLegalAdvisor = createDefaultPolicySet().find(policy => policy.policyId === 'random-legal').advisor;
const realRandomInt = (await import('node:crypto')).default.randomInt;
let sharedRandomDraw = 0;
(await import('node:crypto')).default.randomInt = (min, max) => min + (sharedRandomDraw++ % (max - min));
let rotatedRandomChoices;
try {
  rotatedRandomChoices = await Promise.all([0, 1, 2].map(seatRotation => randomLegalAdvisor.chooseAction({
    candidates: [{ id: 'first' }, { id: 'second' }, { id: 'third' }],
    simulationSeed: 812,
    policyId: 'random-legal',
    policyDecisionIndex: 7,
    seatRotation
  })));
} finally {
  (await import('node:crypto')).default.randomInt = realRandomInt;
}
assert.equal(new Set(rotatedRandomChoices.map(decision => decision.actionId)).size, 1,
  'random-legal chooses the same action for a policy decision index across seat rotations');

const tile = { index: 1, ownerId: 'player-a', mortgaged: false, houseCount: 0, hotelCount: 0, equityShares: [] };
const fingerprintGame = {
  currentPlayerId: 'player-a',
  hasRolled: false,
  awaitingEndTurn: false,
  extraRollPending: false,
  roundNumber: 1,
  auction: { active: true, currentPlayerId: 'player-b', highestBid: 10, highestBidderId: 'player-b' },
  marketQuotes: { ACME: 10 },
  surpriseDeck: ['hidden-a', 'hidden-b'],
  getTile: index => index === 1 ? tile : null,
  players: [{ id: 'player-a', cash: 500, position: 1, properties: [1], bankrupt: false, inJail: false, jailTurns: 0, marketPositions: { ACME: 1 } }]
};
const unchangedFingerprint = stateFingerprint(fingerprintGame);
assert.equal(stateFingerprint(fingerprintGame), unchangedFingerprint, 'an unchanged decision state has a stable fingerprint');
tile.houseCount += 1;
assert.notEqual(stateFingerprint(fingerprintGame), unchangedFingerprint, 'property development changes the fingerprint');
tile.houseCount -= 1;
tile.mortgaged = true;
assert.notEqual(stateFingerprint(fingerprintGame), unchangedFingerprint, 'mortgage changes the fingerprint');
tile.mortgaged = false;
fingerprintGame.players[0].marketPositions.ACME += 1;
assert.notEqual(stateFingerprint(fingerprintGame), unchangedFingerprint, 'market holdings change the fingerprint');
fingerprintGame.players[0].marketPositions.ACME -= 1;
fingerprintGame.currentPlayerId = 'player-b';
assert.notEqual(stateFingerprint(fingerprintGame), unchangedFingerprint, 'turn ownership changes the fingerprint');
fingerprintGame.currentPlayerId = 'player-a';
fingerprintGame.auction.highestBid += 1;
assert.notEqual(stateFingerprint(fingerprintGame), unchangedFingerprint, 'auction state changes the fingerprint');
fingerprintGame.auction.highestBid -= 1;
fingerprintGame.surpriseDeck.reverse();
assert.equal(stateFingerprint(fingerprintGame), unchangedFingerprint, 'hidden deck order is excluded from the strategy fingerprint');
const publicContextRoom = createSimulationRoom({ settings: { seatCount: 2 } });
const publicBot = publicContextRoom.game.players[0];
const publicContextBefore = buildBotStrategicContext(publicContextRoom.game, publicBot, 'pre-roll', 1);
publicContextRoom.game.surpriseDeck.reverse();
publicContextRoom.game.treasureDeck.reverse();
assert.deepEqual(buildBotStrategicContext(publicContextRoom.game, publicBot, 'pre-roll', 1), publicContextBefore,
  'hidden card order never changes policy input');

const stratifiedPolicies = ['left', 'right', 'control-c', 'control-d'].map(policyId => createBotPolicy(policyId));
const stratifiedTournament = await runBotTournament({
  seeds: [23],
  policySets: [
    stratifiedPolicies.slice(0, 3),
    [stratifiedPolicies[0], stratifiedPolicies[1], stratifiedPolicies[3]]
  ],
  seatRotations: [0, 1, 2],
  stepLimit: 1
});
for (const [key, control] of [['left:right:vs:control-c', 'control-c'], ['left:right:vs:control-d', 'control-d']]) {
  const stratum = stratifiedTournament.pairedDifferences[key];
  assert.equal(stratum.pairs, 3, `${key} includes every seat rotation`);
  const rows = stratifiedTournament.matches.filter(match => match.policyBySeat.includes('left')
    && match.policyBySeat.includes('right')
    && match.policyBySeat.includes(control));
  assert.deepEqual(rows.map(match => match.seatRotation).sort(), [0, 1, 2]);
  assert.ok(rows.every(match => match.policyBySeat.filter(id => id !== 'left' && id !== 'right').join() === control));
}

const difficultyPolicy = (brain, difficulty) => createBotPolicy(`${brain}-${difficulty}`, {
  brain,
  difficulty,
  ...(brain === 'ai' ? { advisor: defaultAiStub } : {})
});
const mixedDifficultyTournament = await runBotTournament({
  seeds: [9271],
  policySets: [
    [difficultyPolicy('no-ai', 'house'), difficultyPolicy('ai', 'table'), difficultyPolicy('no-ai', 'expert')],
    [difficultyPolicy('ai', 'house'), difficultyPolicy('no-ai', 'table'), difficultyPolicy('ai', 'expert')]
  ],
  seatRotations: [0],
  stepLimit: 2
});
assert.equal(mixedDifficultyTournament.matches.length, 2);
for (const match of mixedDifficultyTournament.matches) {
  assert.equal(match.censored, true, 'short matches remain step-limited/censored');
  for (const policyId of match.policyBySeat) {
    assert.ok(match.strategyMetricsByPolicy[policyId]);
    assert.ok(match.policyConfiguration[policyId]);
  }
}
assert.equal(mixedDifficultyTournament.matches[0].policyConfiguration['no-ai-house'].difficulty, 'house');
assert.equal(mixedDifficultyTournament.matches[0].policyConfiguration['ai-table'].brain, 'ai');

const ledgerRoom = createSimulationRoom({ settings: { seatCount: 2, market: true } });
const marketPlayer = ledgerRoom.game.players[0];
marketPlayer.cash = 100;
marketPlayer.marketPositions = { brazil: { quantity: 1, averageCost: 102, realizedPnl: 15 } };
ledgerRoom.game.marketQuotes = { ...ledgerRoom.game.marketQuotes, brazil: 120 };
ledgerRoom.game.marketLedger = [
  { playerId: marketPlayer.id, instrumentId: 'brazil', side: 'sell', quantity: 1, quote: 120, fee: 3 },
  { playerId: marketPlayer.id, instrumentId: 'brazil', side: 'buy', quantity: 2, quote: 100, fee: 4 }
];
const markedWorth = playerNetWorth(ledgerRoom.game, marketPlayer);
assert.equal(markedWorth, 220, 'market holdings contribute their current shared quote to match worth');
const ledgerResult = buildMatchResult(ledgerRoom, {
  seed: 1001,
  policyBySeat: [createBotPolicy('market-a'), createBotPolicy('market-b')],
  steps: 1,
  stepLimit: 1
});
assert.equal(ledgerResult.marketPnlByPolicy['market-a'], 33, 'market P&L includes realized sales, fees, and remaining holdings');

const reportingSummary = buildTournamentSummary([{
  ended: true,
  completed: false,
  censored: false,
  winnerPolicyId: null,
  policyBySeat: ['reporting'],
  placementsByPolicy: { reporting: 1 },
  netWorthByPolicy: { reporting: 1000 },
  bankruptciesByPolicy: { reporting: 0 },
  legalityByPolicy: { reporting: { actionAttempts: 2, legalActions: 2, illegalActions: 0, unclassifiedActions: 0 } },
  strategyMetricsByPolicy: { reporting: { providerCalls: 2, auctionBidCount: 1, auctionBidPremiumTotal: 0, maxAuctionBidPremium: 0, auctionBidFacePremiumTotal: 40, maxAuctionBidFacePremium: 40, completedTrades: 1, completedGroupsLost: 1, opponentGroupsBroken: 0, marketPnl: 15 } },
  marketPnlByPolicy: { reporting: 15 },
  liveAiCalls: 2,
  liveAiCapExhaustions: 0,
  liveAiFallbacks: 0,
  liveAiCallCapReached: false,
  liveAiStatus: 'within-call-cap'
}], ['reporting']);
assert.equal(reportingSummary.completedCount, 0, 'an ended match without a winner is not a completed result');
assert.equal(reportingSummary.incompleteCount, 1);
assert.equal(reportingSummary.policyOutcomes.reporting.completed, 0);
assert.equal(reportingSummary.strategyMetricsByPolicy.reporting.providerCalls, 2);
assert.equal(reportingSummary.strategyMetricsByPolicy.reporting.auctionBidFacePremiumTotal, 40);
assert.equal(reportingSummary.strategyMetricsByPolicy.reporting.completedGroupsLost, 1);
assert.equal(reportingSummary.strategyMetricsByPolicy.reporting.marketPnl, 15);

console.log('bot policy tournament: determinism, rotation, censoring, seeded restoration passed');
