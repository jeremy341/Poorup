import assert from 'node:assert/strict';
import {
  normalizeAnalyticsQuery,
  OVERVIEW_KPI_IDS,
  buildOverview,
  buildMatchHealth,
  buildRulesetBoard,
  buildEconomy,
  buildEventsRarity,
  buildBots,
  buildAssociation,
  buildDataQuality
} from './analyticsProjection.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const query = normalizeAnalyticsQuery({ range: 'day', seasonId: 'season-01', rulesetRevision: 3, balanceRevision: 7 });
const rollup = {
  schemaVersion: 1,
  generatedAt: '2026-09-13T12:00:00.000Z',
  sourceWindow: { from: '2026-09-13T00:00:00.000Z', to: '2026-09-13T12:00:00.000Z' },
  dimensions: {
    'season-01|3|7|standard-40|classic|basic': {
      seasonId: 'season-01', rulesetRevision: 3, balanceRevision: 7,
      boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic',
      started: 10, completed: 8, stalled: 2, botOnlyMatches: 2,
      durationSeconds: { count: 8, values: [60, 90, 120, 120, 180, 240, 300, 360] },
      reconnects: 4, afk: 2, bankruptcies: 3, comebacks: 1,
      features: { loans: { eligible: 8, used: 4 }, market: { eligible: 8, used: 5 } },
      market: { volatility: { count: 4, values: [0.1, 0.2, 0.15, 0.12] }, liquidations: 2, marginPositions: 10, shortDefaults: 1, shortPositions: 8, optionExercises: 2, collateralizedOptions: 4, negativeCashPreventions: 3 },
      events: { 'event-01': { eligible: 8, warnings: 5, active: 4, choices: 3, voters: 6, durationSeconds: { count: 4, values: [1, 2, 3, 4] }, recovered: 3, combinations: { pair: 2 } } },
      achievements: { COMMON: 4, RARE: 2 }, rewardClaims: 6,
      bots: { ai: { matches: 6, completed: 5, wins: 2, placements: [1, 2, 3, 4, 2], decisions: 10, fallback: 2, actions: { buy: 4 } }, 'no-ai': { matches: 4, completed: 3, wins: 1, placements: [2, 3, 4], decisions: 4, fallback: 0, actions: { buy: 1 } } },
      outcomes: { exposed: { observations: 6, successes: 3 }, control: { observations: 5, successes: 2 } }
    }
  },
  quality: { stale: false, queueDepth: 2, rejectedEvents: 1, eventCoverage: 0.98, revisionCoverage: ['3:7'] }
};

check('normalizes bounded filters and fixes the cohort threshold', () => {
  const normalized = normalizeAnalyticsQuery({ range: 'nope', boardVariant: 'METRO-52', botMode: 'AI', minimumCohort: 1, tab: 'economy' });
  assert.equal(normalized.range, 'hour');
  assert.equal(normalized.boardVariant, 'metro-52');
  assert.equal(normalized.botMode, 'ai');
  assert.equal(normalized.minimumCohort, 5);
  assert.equal(normalized.tab, 'economy');
  assert.equal(normalizeAnalyticsQuery({ view: 'bots' }).tab, 'bots');
  assert.equal(normalizeAnalyticsQuery({}).rulesetRevision, null);
  assert.equal(normalizeAnalyticsQuery({}).balanceRevision, null);
});

check('builds overview and match health with explicit denominators', () => {
  const overview = buildOverview(rollup, query);
  assert.deepEqual(overview.kpis.map(item => item.id), ['online-now', 'error-rate', 'p95-action-latency', 'completion-rate', 'started', 'peak-24h']);
  assert.deepEqual(overview.kpis.map(item => item.id), [...OVERVIEW_KPI_IDS]);
  assert.equal(overview.kpis.find(item => item.id === 'started').value, 10);
  assert.equal(overview.kpis.find(item => item.id === 'completion-rate').denominator, 10);
  assert.equal(overview.kpis.find(item => item.id === 'completion-rate').numerator, 8);
  assert.equal(overview.kpis.find(item => item.id === 'completion-rate').value, 0.8);
  const health = buildMatchHealth(rollup, query);
  assert.equal(health.completionRate.value, 0.8);
  assert.equal(health.completionRate.denominator, 10);
  assert.equal(health.durationMedian.value, 150);
  assert.equal(health.durationP95.denominator, 8);
});

check('builds ruleset, economy, event, and bot read models', () => {
  const rules = buildRulesetBoard(rollup, query);
  assert.equal(rules.rows[0].completionRate.value, 0.8);
  const economy = buildEconomy(rollup, query);
  assert.equal(economy.adoption.loans.value, 0.5);
  assert.equal(economy.adoption.loans.denominator, 8);
  assert.equal(economy.liquidationRate.value, 0.2);
  const events = buildEventsRarity(rollup, query);
  assert.equal(events.rows[0].warningToActive.value, 0.8);
  assert.equal(events.rows[0].turnout.value, 0.75);
  const bots = buildBots(rollup, query);
  assert.equal(bots.rows.length, 2);
  assert.equal(bots.rows[0].associationLabel, undefined);
});

check('S15-01: a ruleset row is one preset on one board, not one per bot, provider or event slice', () => {
  const base = { seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', marketComplexity: 'basic' };
  const sliced = {
    generatedAt: '2026-09-13T12:00:00.000Z',
    dimensions: {
      's|1|1|standard-40|classic|basic': { ...base, rulesetPreset: 'classic', started: 4, completed: 3, outcomes: { win: 2 } },
      's|1|1|standard-40|classic|basic||ai|ai': { ...base, rulesetPreset: 'classic', botMode: 'ai', provider: 'ai', started: 2, completed: 1, outcomes: { win: 1 } },
      's|1|1|standard-40|classic|basic|event-01|': { ...base, rulesetPreset: 'classic', eventId: 'event-01', started: 0, completed: 0 },
      's|1|1|standard-40|custom|basic': { ...base, rulesetPreset: 'custom', started: 2, completed: 2 }
    },
    quality: {}
  };
  const board = buildRulesetBoard(sliced, { seasonId: 's', rulesetRevision: 1, balanceRevision: 1 });
  assert.equal(board.rows.length, 2, 'classic and custom, once each');
  const classic = board.rows.find(row => row.rulesetPreset === 'classic');
  assert.equal(classic.matches, 6);
  assert.equal(classic.completed, 4);
  assert.equal(classic.completionRate.numerator, 4);
  assert.deepEqual(classic.outcomeDistribution, { win: 3 });
});

check('uses competitive denominators for rarity and reward measures', () => {
  const botOnly = { generatedAt: '2026-09-13T12:00:00.000Z', dimensions: { x: { seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic', started: 10, completed: 10, competitiveCompleted: 0, botOnlyMatches: 10, achievements: { COMMON: 10 }, rewardClaims: 10 } } };
  const result = buildEventsRarity(botOnly, { range: 'season', rulesetRevision: 1, balanceRevision: 1 });
  assert.equal(result.unlockRarity.COMMON.value, null);
  assert.equal(result.rewardClaims.value, null);
});

check('suppresses association groups below k and never claims causation', () => {
  const association = buildAssociation(rollup, query, 'outcomes');
  assert.equal(association.label, 'ASSOCIATION, NOT CAUSATION');
  assert.equal(association.exposed.sampleSize, 6);
  assert.equal(association.control.sampleSize, 5);
  const suppressed = buildAssociation({ dimensions: { x: { outcomes: { exposed: { observations: 4, successes: 2 }, control: { observations: 5, successes: 3 } } } } }, query, 'outcomes');
  assert.equal(suppressed.suppressed, true);
  assert.equal(Object.hasOwn(suppressed, 'sampleSize'), false);
  assert.equal(JSON.stringify(association).toLowerCase().includes('caus'), true);
});

check('returns bounded quality data and revision coverage', () => {
  const quality = buildDataQuality(rollup, query);
  assert.equal(quality.queueDepth, 2);
  assert.equal(quality.rejectedEvents, 1);
  assert.deepEqual(quality.revisionCoverage, ['3:7']);
});

check('filters direct snapshots by event and bot dimensions', () => {
  const dimensions = {
    a: { seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic', eventId: 'e1', botMode: 'ai', features: { loan: { eligible: 5, used: 5 } } },
    b: { seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic', eventId: 'e2', botMode: 'no-ai', features: { loan: { eligible: 5, used: 0 } } }
  };
  assert.equal(buildEconomy({ dimensions, generatedAt: '2026-09-13T12:00:00Z' }, { eventId: 'e1', botMode: 'ai', rulesetRevision: 1, balanceRevision: 1 }).adoption.loan.value, 1);
});

check('accepts the month range and maps the retired season range to it', () => {
  assert.equal(normalizeAnalyticsQuery({ range: 'month' }).range, 'month');
  assert.equal(normalizeAnalyticsQuery({ range: 'season' }).range, 'month');
  assert.equal(normalizeAnalyticsQuery({ range: 'year' }).range, 'hour');
});

check('live tiles come only from measured runtime numbers and stay null otherwise', () => {
  const none = buildOverview(rollup, query).kpis;
  ['online-now', 'error-rate', 'p95-action-latency', 'peak-24h'].forEach((id) => {
    assert.equal(none.find(item => item.id === id).value, null, id);
  });
  const live = { activeSockets: 7, actionCount: 200, errorCount: 3, latencyP95Ms: 41, latencySamples: 200, peakSockets24h: 19 };
  const kpis = buildOverview({ ...rollup, quality: { ...rollup.quality, live } }, query).kpis;
  assert.equal(kpis.find(item => item.id === 'online-now').value, 7);
  const errorRate = kpis.find(item => item.id === 'error-rate');
  assert.equal(errorRate.value, 0.015);
  assert.equal(errorRate.numerator, 3);
  assert.equal(errorRate.denominator, 200);
  assert.equal(kpis.find(item => item.id === 'p95-action-latency').value, 41);
  assert.equal(kpis.find(item => item.id === 'peak-24h').value, 19);
  const noActions = buildOverview({ ...rollup, quality: { ...rollup.quality, live: { ...live, actionCount: 0 } } }, query).kpis;
  assert.equal(noActions.find(item => item.id === 'error-rate').value, null);
  kpis.forEach(item => assert.equal(typeof item.definition, 'string'));
  kpis.forEach(item => assert.equal(typeof item.unit, 'string'));
});

check('N11c: the error rate counts failed player actions, not HTTP failures', () => {
  const live = { activeSockets: 7, actionCount: 200, errorCount: 5, socketErrorCount: 2, httpErrorCount: 3, latencyP95Ms: 41, latencySamples: 200, peakSockets24h: 19 };
  const kpis = buildOverview({ ...rollup, quality: { ...rollup.quality, live } }, query).kpis;
  const errorRate = kpis.find(item => item.id === 'error-rate');
  assert.equal(errorRate.value, 0.01, 'the HTTP failures stay out of the socket error rate');
  assert.equal(errorRate.numerator, 2);
  assert.equal(errorRate.denominator, 200);
});

check('a stale rollup with no matches reports unknown, not a verified zero', () => {
  const stale = { generatedAt: '2026-09-13T12:00:00.000Z', dimensions: {}, quality: { fresh: false } };
  const kpis = buildOverview(stale, {}).kpis;
  assert.equal(kpis.find(item => item.id === 'started').value, null);
  assert.equal(kpis.find(item => item.id === 'completion-rate').value, null);
  const fresh = buildOverview({ ...stale, quality: { fresh: true } }, {}).kpis;
  assert.equal(fresh.find(item => item.id === 'started').value, 0);
});

check('adds a previous-period comparison only when a previous window is supplied', () => {
  const previous = { dimensions: { x: { seasonId: 'season-01', rulesetRevision: 3, balanceRevision: 7, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic', started: 5, completed: 4 } } };
  const without = buildOverview(rollup, query).kpis.find(item => item.id === 'started');
  assert.equal(Object.hasOwn(without, 'comparison'), false);
  const kpis = buildOverview(rollup, query, { previous }).kpis;
  const started = kpis.find(item => item.id === 'started');
  assert.deepEqual(started.comparison, { value: 5, delta: 5, period: 'previous day' });
  const completion = kpis.find(item => item.id === 'completion-rate');
  assert.equal(completion.comparison.value, 0.8);
  assert.equal(completion.comparison.delta, 0);
});
