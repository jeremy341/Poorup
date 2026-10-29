// Regression checks for the bot tournament harness validity items
import crypto from 'node:crypto';
import { ROUND_LIMIT } from './gameData.js';
import { netWorth } from './botTableBrain.js';
import { auctionRaiseOptions } from './botAuctionPolicy.js';
import { createBotPolicy, createDefaultPolicySet, createSimulationRoom, defaultStepLimit, simulateBotMatch, createCappedFetch } from './bot-policy-tournament.js';
import { auctionResponseOrder, STEPS_PER_SEAT_ROUND, withSeededSimulationGlobals } from './botTournamentSimulation.js';
import { matchCompletionKind, playerNetWorth, buildMatchResult } from './botTournamentResults.js';
import { buildTournamentSummary } from './botTournamentSummary.js';
import { runTournamentCli } from './botTournamentCli.js';
import { stubBidAmount } from './botTournamentPolicies.js';
import { DeterministicAdvisor } from './botAdvisor.js';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`);
}

const QUICK_ECONOMY = { startingCash: 30, casino: false, market: false, globalEvents: false };

// Item IDs appear in action IDs, so deterministic outcomes alone do not prove
// a seeded match can reproduce its decision trace.
async function itemSeedMatch() {
  const policyBySeat = Array.from({ length: 3 }, (_, seat) => createBotPolicy(`item-seed-${seat}`, {
    brain: 'no-ai', advisor: new DeterministicAdvisor()
  }));
  return simulateBotMatch({ seed: 4043, policyBySeat, settings: {
    startingCash: 1500, itemRewards: true, auction: true, casino: false, market: false, globalEvents: false
  }, stepLimit: 2000, captureTrace: true });
}
const itemSeedFirst = await itemSeedMatch();
const itemSeedSecond = await itemSeedMatch();
const itemActionIds = match => match.decisionTrace.filter(entry => String(entry.actionId).startsWith('item-')).map(entry => entry.actionId);
const firstItemIds = itemActionIds(itemSeedFirst);
const secondItemIds = itemActionIds(itemSeedSecond);
check('seeded item match exercises item actions', firstItemIds.length > 0 && secondItemIds.length > 0);
check('seeded item action IDs reproduce exactly', JSON.stringify(firstItemIds) === JSON.stringify(secondItemIds),
  `${JSON.stringify(firstItemIds)} vs ${JSON.stringify(secondItemIds)}`);

// The step budget scales with the round limit, not a fixed 2,000.
check('default step limit covers the full round limit', defaultStepLimit(3) === ROUND_LIMIT * 3 * STEPS_PER_SEAT_ROUND);
check('default step limit is well above the old 2,000 cap', defaultStepLimit(3) > 5 * 2_000);
check('default step limit grows with seats', defaultStepLimit(3) > defaultStepLimit(2));

const naturalPolicies = [createBotPolicy('nat-a'), createBotPolicy('nat-b')];
const natural = await simulateBotMatch({ seed: 1, policyBySeat: naturalPolicies, settings: QUICK_ECONOMY });
check('omitted stepLimit uses the scaled default', natural.stepLimit === defaultStepLimit(2), String(natural.stepLimit));
check('a match that reaches its end reports completionKind winner', natural.completionKind === 'winner', natural.completionKind);
check('a natural winner is completed and not censored', natural.completed === true && natural.censored === false);

const limited = await simulateBotMatch({ seed: 1, policyBySeat: naturalPolicies, settings: QUICK_ECONOMY, stepLimit: 5 });
check('a step-limited match reports completionKind step-limit', limited.completionKind === 'step-limit', limited.completionKind);
check('a step-limited match is censored and not completed', limited.censored === true && limited.completed === false);

let rejected = false;
try {
  await simulateBotMatch({ seed: 1, policyBySeat: naturalPolicies, settings: QUICK_ECONOMY, stepLimit: 0 });
} catch (error) {
  rejected = error instanceof RangeError;
}
check('a non-positive stepLimit is rejected', rejected);

check('round-limit ending is classified', matchCompletionKind({ started: false, lastEndReason: 'round-limit' }, { steps: 10, stepLimit: 100, hasWinner: true }) === 'round-limit');
check('plain winner ending is classified', matchCompletionKind({ started: false, lastEndReason: null }, { steps: 10, stepLimit: 100, hasWinner: true }) === 'winner');
check('step budget exhaustion is classified', matchCompletionKind({ started: true }, { steps: 100, stepLimit: 100, hasWinner: false }) === 'step-limit');
check('stalled run is classified', matchCompletionKind({ started: true }, { steps: 3, stepLimit: 100, stalled: true, hasWinner: false }) === 'stall');

const matchRow = (policyBySeat, completionKind, winnerPolicyId = null) => ({
  policyBySeat,
  completionKind,
  completed: completionKind === 'winner' || completionKind === 'round-limit',
  ended: completionKind === 'winner' || completionKind === 'round-limit',
  censored: completionKind === 'step-limit' || completionKind === 'stall',
  winnerPolicyId,
  placementsByPolicy: Object.fromEntries(policyBySeat.map((id, index) => [id, index + 1])),
  legalityByPolicy: {},
  liveAiCalls: 0, liveAiCapExhaustions: 0, liveAiFallbacks: 0, liveAiCallCapReached: false, liveAiStatus: 'stubbed',
});
const summary = buildTournamentSummary([
  matchRow(['x', 'y'], 'winner', 'x'),
  matchRow(['x', 'y'], 'round-limit', 'y'),
  matchRow(['x', 'y'], 'step-limit'),
  matchRow(['x', 'y'], 'stall'),
], ['x', 'y']);
check('summary counts each completion kind', JSON.stringify(summary.completionKinds) === JSON.stringify({ winner: 1, 'round-limit': 1, 'step-limit': 1, stall: 1 }), JSON.stringify(summary.completionKinds));
check('summary exposes the censored count', summary.censoredCount === 2);
check('censored matches are excluded from completed totals', summary.completedCount === 2 && summary.incompleteCount === 2);
check('win rate ignores censored matches', summary.policyOutcomes.x.winRate === 0.5 && summary.policyOutcomes.x.censored === 2, JSON.stringify(summary.policyOutcomes.x));
check('per-policy outcome lists completion kinds', summary.policyOutcomes.x.completionKinds['step-limit'] === 1);

// Auction responders cycle; no seat is structurally first.
const orderContext = {
  seed: 7, auctionOrdinal: 0, auctionKey: null, auctionStartSeat: 0,
  room: { game: { players: [{ id: 'p0' }, { id: 'p1' }, { id: 'p2' }] } },
};
const firstSeats = [];
for (let auctionNumber = 0; auctionNumber < 6; auctionNumber += 1) {
  const auction = { startedAt: 1000 + auctionNumber, propertyTile: { index: auctionNumber }, highestBidderId: null };
  const order = auctionResponseOrder(orderContext, auction);
  check('every auction order lists each seat once', new Set(order.map(player => player.id)).size === 3);
  firstSeats.push(order[0].id);
  const repeat = auctionResponseOrder(orderContext, auction);
  check('the same auction keeps its opening seat', repeat[0].id === order[0].id);
}
check('the opening responder rotates through all seats', new Set(firstSeats.slice(0, 3)).size === 3 && firstSeats[0] === firstSeats[3], firstSeats.join());
const afterBid = auctionResponseOrder(orderContext, { startedAt: 1005, propertyTile: { index: 5 }, highestBidderId: 'p1' });
check('after a bid the next seat in the cycle responds first', afterBid.map(player => player.id).join() === 'p2,p0,p1', afterBid.map(player => player.id).join());

// The stub AI supplies a legal bid amount.
const bidOptions = auctionRaiseOptions(10, 1000);
check('stub picks the standard +20 raise when offered', stubBidAmount({ amountOptions: bidOptions }) === 30);
check('stub falls back to the only legal option', stubBidAmount({ amountOptions: [11] }) === 11);
check('stub sends no amount without options', stubBidAmount({ kind: 'roll' }) === null);

const stubPolicy = createDefaultPolicySet().find(policy => policy.policyId === 'ai-stub');
const bidCandidate = {
  id: 'auction:bid', kind: 'auction-bid', amount: 30, amountOptions: bidOptions, minimumAmount: 11, maximumAmount: 500,
  parameterRanges: { amount: { type: 'integer', minimum: 11, maximum: 500 } }, risk: 0, score: 12,
};
const bidDecision = await stubPolicy.advisor.chooseAction({
  botBrain: 'ai', gameId: 'stub-bid-amount',
  candidates: [bidCandidate, { id: 'auction:wait', kind: 'auction-wait', risk: 0, score: 1 }],
});
check('stub bid is accepted rather than falling back', bidDecision.fallback !== true && bidDecision.actionId === 'auction:bid', JSON.stringify(bidDecision));
check('stub bid carries a legal amount parameter', bidOptions.includes(bidDecision.parameters?.amount), JSON.stringify(bidDecision.parameters));

// Each match gets a fresh advisor, so state cannot leak between matches.
const advisorInstances = [];
const trackedStub = { ...stubPolicy, createAdvisor: () => { const advisor = stubPolicy.createAdvisor(); advisorInstances.push(advisor); return advisor; } };
const control = createBotPolicy('fresh-control');
const firstAiMatch = await simulateBotMatch({ seed: 5, policyBySeat: [trackedStub, control], settings: { startingCash: 500 }, stepLimit: 400 });
const secondAiMatch = await simulateBotMatch({ seed: 6, policyBySeat: [trackedStub, control], settings: { startingCash: 500 }, stepLimit: 400 });
check('one advisor is built per match', advisorInstances.length === 2 && advisorInstances[0] !== advisorInstances[1], String(advisorInstances.length));
check('the first match used its own advisor', advisorInstances[0].aiCalls === firstAiMatch.strategyMetricsByPolicy['ai-stub'].providerCalls);
check('the second match does not inherit the first match calls',
  advisorInstances[1].aiCalls === secondAiMatch.strategyMetricsByPolicy['ai-stub'].providerCalls
  && advisorInstances[1].callTimestamps.length === advisorInstances[1].aiCalls,
  `${advisorInstances[1].aiCalls} vs ${secondAiMatch.strategyMetricsByPolicy['ai-stub'].providerCalls}`);
check('the AI arm made provider calls', firstAiMatch.strategyMetricsByPolicy['ai-stub'].providerCalls > 0);
check('the stub arm never trips its circuit breaker', advisorInstances.every(advisor => advisor.failureStreak === 0 && !advisor.circuitOpenUntil && advisor.lastFailure == null),
  JSON.stringify(advisorInstances.map(advisor => advisor.lastFailure)));

const cappedTransport = createCappedFetch({ maxCalls: 1_000, fetchImpl: async () => ({ ok: false, status: 500 }) });
const cappedDefaults = createDefaultPolicySet({ fetchImpl: cappedTransport.fetchImpl });
const cappedStub = cappedDefaults.find(policy => policy.policyId === 'ai-stub');
check('fresh advisors keep the shared call-cap transport', cappedStub.createAdvisor().fetchImpl === cappedTransport.fetchImpl);

// The seeds env var is parsed whole.
const cliRuns = [];
const runCli = env => runTournamentCli({
  runBotTournament: async options => { cliRuns.push(options); return { matches: [] }; },
  createCappedFetch,
  env,
  write: () => {},
});
await runCli({ POORUP_BOT_EVAL_SEEDS: '3,5,8' });
check('a seed list is not truncated to the default count', JSON.stringify(cliRuns.at(-1).seeds) === '[3,5,8]', JSON.stringify(cliRuns.at(-1).seeds));
await runCli({ POORUP_BOT_EVAL_COUNT: '1', POORUP_BOT_EVAL_SEEDS: '4, 9, 11' });
check('a seed list is not truncated by an explicit count', JSON.stringify(cliRuns.at(-1).seeds) === '[4,9,11]');
check('an unset step limit lets the harness scale it', cliRuns.at(-1).stepLimit === undefined);
await runCli({ POORUP_BOT_EVAL_SEEDS: '1', POORUP_BOT_EVAL_STEP_LIMIT: '50000' });
check('an explicit step limit is honoured', cliRuns.at(-1).stepLimit === 50_000);

// Mortgaged deeds use the engine net-worth rule.
const worthGame = createSimulationRoom({ settings: { seatCount: 2 } }).game;
const worthPlayer = worthGame.players[0];
worthPlayer.cash = 400;
worthPlayer.bankLoan = null;
worthPlayer.marketPositions = {};
worthPlayer.properties = [1, 3];
for (const index of worthPlayer.properties) worthGame.getTile(index).ownerId = worthPlayer.id;
const unmortgagedWorth = playerNetWorth(worthGame, worthPlayer);
worthGame.getTile(3).mortgaged = true;
const mortgagedWorth = playerNetWorth(worthGame, worthPlayer);
check('a mortgaged deed counts at half face', unmortgagedWorth - mortgagedWorth === Math.floor(worthGame.getTile(3).price / 2),
  `${unmortgagedWorth} vs ${mortgagedWorth}`);
check('harness net worth matches the engine rule', mortgagedWorth === netWorth(worthGame, worthPlayer), `${mortgagedWorth} vs ${netWorth(worthGame, worthPlayer)}`);

// The tournament reports and orders seats on the canonical net worth
// (netWorth.js): a seat that owes short-default debt is worth less, and is
// placed below the solvent seat.
const canonicalRoom = createSimulationRoom({ settings: { seatCount: 2 } });
const [debtSeat] = canonicalRoom.game.players;
for (const player of canonicalRoom.game.players) {
  player.cash = 1000;
  player.bankLoan = null;
  player.marketPositions = {};
  player.properties = [];
}
debtSeat.shortDefaultDebt = 400;
const canonicalResult = buildMatchResult(canonicalRoom, {
  seed: 1,
  policyBySeat: [createBotPolicy('debt-seat'), createBotPolicy('solvent-seat')],
  steps: 1,
  stepLimit: 1
});
check('short default debt counts against the canonical net worth',
  canonicalResult.netWorthByPolicy['debt-seat'] === 600,
  String(canonicalResult.netWorthByPolicy['debt-seat']));
check('the seat in debt is placed below the solvent seat',
  canonicalResult.placementsByPolicy['debt-seat'] === 2 && canonicalResult.placementsByPolicy['solvent-seat'] === 1,
  JSON.stringify(canonicalResult.placementsByPolicy));

// Market P&L is aggregated from the player's own book: the display ledger
// is capped at 300 rows and never records forced settlements.
const bookRoom = createSimulationRoom({ settings: { seatCount: 2, market: true } });
const bookPlayer = bookRoom.game.players[0];
bookPlayer.marketPositions = { brazil: { quantity: 0, averageCost: 0, realizedPnl: 40 } };
bookRoom.game.marketLedger = [];
const bookResult = buildMatchResult(bookRoom, {
  seed: 2,
  policyBySeat: [createBotPolicy('book-a'), createBotPolicy('book-b')],
  steps: 1,
  stepLimit: 1
});
check('realized market P&L survives a capped ledger',
  bookResult.marketPnlByPolicy['book-a'] === 40,
  String(bookResult.marketPnlByPolicy['book-a']));
const settlementRoom = createSimulationRoom({ settings: { seatCount: 2, market: true } });
const settlementPlayer = settlementRoom.game.players[0];
settlementPlayer.marketPositions = {};
settlementRoom.game.marketLedger = [{ playerId: settlementPlayer.id, side: 'margin-liquidation', realizedPnl: 25 }];
const settlementResult = buildMatchResult(settlementRoom, {
  seed: 3,
  policyBySeat: [createBotPolicy('settle-a'), createBotPolicy('settle-b')],
  steps: 1,
  stepLimit: 1
});
check('an explicit forced settlement row counts as realized P&L',
  settlementResult.marketPnlByPolicy['settle-a'] === 25,
  String(settlementResult.marketPnlByPolicy['settle-a']));

// A policy with no completed match has no average placement at all.
const quietSummary = buildTournamentSummary([{
  ended: false,
  completed: false,
  censored: true,
  winnerPolicyId: null,
  policyBySeat: ['quiet'],
  placementsByPolicy: {},
  legalityByPolicy: {}
}], ['quiet']);
check('a policy with no completed match has no average placement',
  quietSummary.policyOutcomes.quiet.averagePlacement === null,
  String(quietSummary.policyOutcomes.quiet.averagePlacement));

// The shadow row counts the matches a policy was evaluated in, not the
// number of decisions it made.
const shadowOnlySummary = buildTournamentSummary([{
  ended: true,
  completed: true,
  censored: false,
  winnerPolicyId: 'shadow-a',
  policyBySeat: ['shadow-a', 'shadow-b'],
  placementsByPolicy: { 'shadow-a': 1, 'shadow-b': 2 },
  legalityByPolicy: {},
  shadowTrace: [
    { policyId: 'shadow-a', agreement: true, actionKind: 'roll', deterministicActionKind: 'roll', phase: 'pre-roll' },
    { policyId: 'shadow-a', agreement: false, actionKind: 'build', deterministicActionKind: 'build', phase: 'post-roll' }
  ]
}], ['shadow-a', 'shadow-b']);
const shadowRow = shadowOnlySummary.shadowEvaluationSummary['shadow-a'];
check('the shadow row counts the match once, not the decisions', shadowRow.matches === 1, String(shadowRow.matches));
check('the shadow row still counts every decision', shadowRow.decisions === 2, String(shadowRow.decisions));

// A match row without live-AI counters must not poison the totals.
const bareSummary = buildTournamentSummary([{
  ended: false,
  completed: false,
  censored: false,
  winnerPolicyId: null,
  policyBySeat: ['bare'],
  placementsByPolicy: {},
  legalityByPolicy: {}
}], ['bare']);
check('missing live-AI counters sum to zero, not NaN',
  bareSummary.liveAiCalls === 0 && bareSummary.liveAiFallbacks === 0 && bareSummary.liveAiCapExhaustions === 0,
  JSON.stringify([bareSummary.liveAiCalls, bareSummary.liveAiFallbacks, bareSummary.liveAiCapExhaustions]));

// Two different strata must never share a key.
const collidingSummary = buildTournamentSummary([
  {
    ended: true, completed: true, censored: false, winnerPolicyId: 'a:b',
    policyBySeat: ['a:b', 'c'], placementsByPolicy: { 'a:b': 1, c: 2 }, legalityByPolicy: {}
  },
  {
    ended: true, completed: true, censored: false, winnerPolicyId: 'a',
    policyBySeat: ['a', 'b:c'], placementsByPolicy: { a: 1, 'b:c': 2 }, legalityByPolicy: {}
  }
], ['a:b', 'c', 'a', 'b:c']);
check('two different strata never share a key',
  Object.keys(collidingSummary.pairedDifferences).length === 2,
  JSON.stringify(Object.keys(collidingSummary.pairedDifferences)));

// The CLI environment reaches the default advisor, and the ambient
// process environment is not consulted behind the CLI's back.
const ambientModel = process.env.POORUP_AI_MODEL;
process.env.POORUP_AI_MODEL = 'ambient-model';
try {
  await runCli({ POORUP_AI_MODEL: 'cli-model' });
  const cliStub = cliRuns.at(-1).policySets.flat().find(policy => policy.policyId === 'ai-stub');
  check('the CLI environment reaches the default advisor', cliStub.createAdvisor().model === 'cli-model', cliStub.createAdvisor().model);
  await runCli({});
  const ambientStub = cliRuns.at(-1).policySets.flat().find(policy => policy.policyId === 'ai-stub');
  check('the ambient process environment is not used for the advisor',
    ambientStub.createAdvisor().model === 'deepseek-v4-flash',
    ambientStub.createAdvisor().model);
} finally {
  if (ambientModel === undefined) delete process.env.POORUP_AI_MODEL;
  else process.env.POORUP_AI_MODEL = ambientModel;
}

// A reused advisor must not carry the first match into the second one.
const sharedStub = createDefaultPolicySet().find(policy => policy.policyId === 'ai-stub');
const sharedPolicy = createBotPolicy('shared-ai', { brain: 'ai', advisor: sharedStub.advisor });
const sharedPolicies = [sharedPolicy, createBotPolicy('shared-control')];
const sharedFirst = await simulateBotMatch({ seed: 11, policyBySeat: sharedPolicies, settings: { startingCash: 500 }, stepLimit: 400 });
const sharedSecond = await simulateBotMatch({ seed: 12, policyBySeat: sharedPolicies, settings: { startingCash: 500 }, stepLimit: 400 });
check('the first match made provider calls', sharedFirst.strategyMetricsByPolicy['shared-ai'].providerCalls > 0,
  String(sharedFirst.strategyMetricsByPolicy['shared-ai'].providerCalls));
check('a reused advisor does not carry the first match calls',
  sharedStub.advisor.aiCalls === sharedSecond.strategyMetricsByPolicy['shared-ai'].providerCalls,
  `${sharedStub.advisor.aiCalls} vs ${sharedSecond.strategyMetricsByPolicy['shared-ai'].providerCalls}`);

// A seed outside the unsigned 32-bit range is rejected, and two seeded
// matches never overlap their seeded globals.
let seedError = null;
try {
  await simulateBotMatch({ seed: 2 ** 32, policyBySeat: [createBotPolicy('seed-a'), createBotPolicy('seed-b')], stepLimit: 1 });
} catch (error) {
  seedError = error;
}
check('a seed outside the unsigned 32-bit range is rejected', seedError instanceof RangeError, String(seedError?.message));
const seededMatch = await simulateBotMatch({ seed: 21, policyBySeat: [createBotPolicy('race-a'), createBotPolicy('race-b')], stepLimit: 60, captureTrace: true });
check('the match reports the seed it ran', seededMatch.seed === 21, String(seededMatch.seed));
const [parallelFirst] = await Promise.all([
  simulateBotMatch({ seed: 21, policyBySeat: [createBotPolicy('race-a'), createBotPolicy('race-b')], stepLimit: 60, captureTrace: true }),
  simulateBotMatch({ seed: 22, policyBySeat: [createBotPolicy('race-a'), createBotPolicy('race-b')], stepLimit: 60, captureTrace: true })
]);
check('a seeded match is unaffected by a concurrent seeded match',
  JSON.stringify(parallelFirst.decisionTrace) === JSON.stringify(seededMatch.decisionTrace),
  'the concurrent match changed the seeded stream');
let cliSeedError = null;
try {
  await runCli({ POORUP_BOT_EVAL_SEEDS: '4294967296' });
} catch (error) {
  cliSeedError = error;
}
check('the CLI rejects a seed outside the unsigned 32-bit range',
  cliSeedError instanceof Error && /POORUP_BOT_EVAL_SEEDS/.test(cliSeedError.message),
  String(cliSeedError?.message));

// The simulated auction decision is taken with the game and the same
// context fields the live table hands the advisor.
const auctionContexts = [];
const auctionStub = createDefaultPolicySet().find(policy => policy.policyId === 'ai-stub').advisor;
const recordingAdvisor = {
  supportsChoicePhases: true,
  async chooseAction(context) {
    auctionContexts.push(context);
    return auctionStub.chooseAction(context);
  }
};
await simulateBotMatch({
  seed: 31,
  policyBySeat: [
    createBotPolicy('auction-recorder', { brain: 'ai', advisor: recordingAdvisor }),
    createBotPolicy('auction-control')
  ],
  settings: { startingCash: 500, auction: true },
  stepLimit: 400
});
const auctionContext = auctionContexts.find(entry => (entry.candidates || [])
  .some(candidate => candidate.id === 'auction:bid' || candidate.id === 'auction:wait'));
check('the simulated auction decision is taken', Boolean(auctionContext), `${auctionContexts.length} advisor calls`);
check('the auction decision carries the live context fields',
  Boolean(auctionContext) && Boolean(auctionContext.botId) && typeof auctionContext.ruleVersion === 'string'
  && typeof auctionContext.decisionSequence === 'number' && typeof auctionContext.gameId === 'string'
  && typeof auctionContext.botDifficulty === 'string',
  JSON.stringify(auctionContext ? Object.keys(auctionContext) : []));

const nativeSimulationGlobals = { now: Date.now, randomInt: crypto.randomInt, randomUUID: crypto.randomUUID };
let releaseFirstScope;
let releaseSecondScope;
let resolveFirstScopeStarted;
let resolveSecondScopeStarted;
const firstScopeStarted = new Promise(resolve => { resolveFirstScopeStarted = resolve; });
const secondScopeStarted = new Promise(resolve => { resolveSecondScopeStarted = resolve; });
const firstScopeHold = new Promise(resolve => { releaseFirstScope = resolve; });
const secondScopeHold = new Promise(resolve => { releaseSecondScope = resolve; });
let firstScope;
let secondScope;
let unrelatedScopesOverlapped;
let firstScopeClock = null;
let secondScopeClock = null;
let secondScopeError = null;
try {
  firstScope = withSeededSimulationGlobals(41, async () => {
    resolveFirstScopeStarted();
    firstScopeClock = Date.now();
    await firstScopeHold;
  });
  await firstScopeStarted;
  secondScope = withSeededSimulationGlobals(42, async () => {
    resolveSecondScopeStarted();
    secondScopeClock = Date.now();
    await secondScopeHold;
    throw new Error('expected overlapping-scope error');
  });
  unrelatedScopesOverlapped = await Promise.race([
    secondScopeStarted.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 25))
  ]);
  releaseFirstScope();
  await firstScope;
  await secondScopeStarted;
  releaseSecondScope();
  try {
    await secondScope;
  } catch (error) {
    secondScopeError = error;
  }
  check('staggered unrelated seeded scopes wait for the active scope', !unrelatedScopesOverlapped,
    `second started early: ${unrelatedScopesOverlapped}`);
  check('each serialized simulation receives its own seeded clock',
    firstScopeClock === 1_700_000_000_041 && secondScopeClock === 1_700_000_000_042,
    `${firstScopeClock} then ${secondScopeClock}`);
  check('a rejected simulation does not skip scope cleanup', secondScopeError?.message === 'expected overlapping-scope error',
    String(secondScopeError?.message));
  check('overlapping and rejected simulations restore Date and crypto globals',
    Date.now === nativeSimulationGlobals.now && crypto.randomInt === nativeSimulationGlobals.randomInt
      && crypto.randomUUID === nativeSimulationGlobals.randomUUID,
    'one or more seeded globals leaked');
} finally {
  releaseFirstScope?.();
  releaseSecondScope?.();
  await Promise.allSettled([firstScope, secondScope].filter(Boolean));
  Date.now = nativeSimulationGlobals.now;
  crypto.randomInt = nativeSimulationGlobals.randomInt;
  crypto.randomUUID = nativeSimulationGlobals.randomUUID;
}

let nestedSimulation;
try {
  nestedSimulation = await withSeededSimulationGlobals(51, async () => {
    const parentBefore = Date.now();
    const parentDraws = [crypto.randomInt(0, 1_000_000)];
    const child = await withSeededSimulationGlobals(52, async ({ advanceTime }) => {
      const childBefore = Date.now();
      const childDraw = crypto.randomInt(0, 1_000_000);
      advanceTime(7);
      return { before: childBefore, after: Date.now(), draw: childDraw };
    });
    parentDraws.push(crypto.randomInt(0, 1_000_000));
    const siblings = await Promise.all([53, 54].map(seed => withSeededSimulationGlobals(seed, async () => {
      await Promise.resolve();
      return { clock: Date.now(), draw: crypto.randomInt(0, 1_000_000) };
    })));
    return { parentBefore, parentAfter: Date.now(), parentDraws, child, siblings };
  });
  const expectedParentDraws = await withSeededSimulationGlobals(51, async () => [
    crypto.randomInt(0, 1_000_000),
    crypto.randomInt(0, 1_000_000)
  ]);
  const expectedChildDraw = await withSeededSimulationGlobals(52, async () => crypto.randomInt(0, 1_000_000));
  const expectedSiblingDraws = await Promise.all([53, 54].map(seed => withSeededSimulationGlobals(seed, async () => crypto.randomInt(0, 1_000_000))));
  check('a true nested simulation gets its own clock and restores its parent context',
    nestedSimulation.parentBefore === 1_700_000_000_051
      && nestedSimulation.parentAfter === nestedSimulation.parentBefore
      && nestedSimulation.child.before === 1_700_000_000_052
      && nestedSimulation.child.after === 1_700_000_000_059
      && JSON.stringify(nestedSimulation.parentDraws) === JSON.stringify(expectedParentDraws)
      && nestedSimulation.child.draw === expectedChildDraw
      && JSON.stringify(nestedSimulation.siblings.map(child => child.clock)) === JSON.stringify([1_700_000_000_053, 1_700_000_000_054])
      && JSON.stringify(nestedSimulation.siblings.map(child => child.draw)) === JSON.stringify(expectedSiblingDraws),
    JSON.stringify(nestedSimulation));
} finally {
  Date.now = nativeSimulationGlobals.now;
  crypto.randomInt = nativeSimulationGlobals.randomInt;
  crypto.randomUUID = nativeSimulationGlobals.randomUUID;
}

let releaseStaleContinuation;
let releaseOtherScope;
let resolveStaleClockCaptured;
let resolveOtherScopeStarted;
const staleContinuationGate = new Promise(resolve => { releaseStaleContinuation = resolve; });
const otherScopeStarted = new Promise(resolve => { resolveOtherScopeStarted = resolve; });
const otherScopeHold = new Promise(resolve => { releaseOtherScope = resolve; });
const staleClockCaptured = new Promise(resolve => { resolveStaleClockCaptured = resolve; });
let staleContinuation;
let otherScope;
let staleContinuationClock = null;
let staleInheritedClock = null;
try {
  await withSeededSimulationGlobals(61, async () => {
    staleContinuation = (async () => {
      await staleContinuationGate;
      staleInheritedClock = Date.now();
      resolveStaleClockCaptured();
      staleContinuationClock = await withSeededSimulationGlobals(62, async () => Date.now());
    })();
  });
  const nativeClockBeforeOtherScope = nativeSimulationGlobals.now();
  otherScope = withSeededSimulationGlobals(63, async () => {
    resolveOtherScopeStarted();
    await otherScopeHold;
  });
  await otherScopeStarted;
  releaseStaleContinuation();
  await staleClockCaptured;
  const staleContextUsedNativeClock = Math.abs(staleInheritedClock - nativeSimulationGlobals.now()) < 1000
    && Math.abs(staleInheritedClock - nativeClockBeforeOtherScope) < 1000;
  releaseOtherScope();
  await otherScope;
  await staleContinuation;
  check('an inherited async scope is no longer nested after its parent finishes',
    staleContextUsedNativeClock && staleContinuationClock === 1_700_000_000_062,
    `${staleInheritedClock} then ${staleContinuationClock}`);
  check('stale async scope cleanup restores Date and crypto globals',
    Date.now === nativeSimulationGlobals.now && crypto.randomInt === nativeSimulationGlobals.randomInt
      && crypto.randomUUID === nativeSimulationGlobals.randomUUID,
    'one or more seeded globals leaked');
} finally {
  releaseStaleContinuation?.();
  releaseOtherScope?.();
  if (otherScope) await Promise.allSettled([otherScope]);
  if (staleContinuation) await Promise.allSettled([staleContinuation]);
  Date.now = nativeSimulationGlobals.now;
  crypto.randomInt = nativeSimulationGlobals.randomInt;
  crypto.randomUUID = nativeSimulationGlobals.randomUUID;
}

if (failures > 0) {
  console.error(`bot tournament harness: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('bot tournament harness: step limit, auction order, policies, seeds, net worth, and scoped simulation globals passed');
