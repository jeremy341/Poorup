import assert from 'node:assert/strict';
import {
  normalizeAnalyticsQuery,
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
});

check('builds overview and match health with explicit denominators', () => {
  const overview = buildOverview(rollup, query);
  assert.equal(overview.kpis.length <= 6, true);
  assert.equal(overview.kpis.find(item => item.id === 'completed-rounds').value, 8);
  assert.equal(overview.kpis.find(item => item.id === 'completion-rate').denominator, 10);
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
  assert.equal(events.rows[0].turnout.denominator, 8);
  const bots = buildBots(rollup, query);
  assert.equal(bots.rows.length, 2);
  assert.equal(bots.rows[0].associationLabel, undefined);
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
