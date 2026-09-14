import assert from 'node:assert/strict';
import {
  MIN_COHORT,
  PSEUDONYM_VERSION,
  createPseudonymizer,
  sanitizeAnalyticsRow,
  suppressedRow,
  sanitizeAnalyticsResponse
} from './analyticsPrivacy.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const scope = { seasonId: 'season-01', rulesetRevision: 1, balanceRevision: 2 };

check('produces stable scoped HMAC pseudonyms', () => {
  const pseudonymizer = createPseudonymizer({ key: 'test-secret', version: PSEUDONYM_VERSION });
  const first = pseudonymizer.pseudonymize('acct-123', scope);
  assert.match(first, /^P-[A-Z0-9_-]{12}$/);
  assert.equal(first, pseudonymizer.pseudonymize('acct-123', scope));
  assert.notEqual(first, pseudonymizer.pseudonymize('acct-123', { ...scope, balanceRevision: 3 }));
});

check('does not fall back to raw identity when key or id is missing', () => {
  assert.equal(createPseudonymizer({}).pseudonymize('acct-123', scope), null);
  assert.equal(createPseudonymizer({ key: 'secret' }).pseudonymize('', scope), null);
  assert.equal(createPseudonymizer({ key: 'secret' }).pseudonymize({ id: 'acct-123' }, scope), null);
});

check('sanitizes rows to aggregate fields and pseudonyms only', () => {
  const row = sanitizeAnalyticsRow({
    accountId: 'acct-secret', displayName: 'Ada', username: 'ada', roomCode: 'SECRET',
    pseudonymId: 'P-ABC123', observations: 6, completionRate: 0.5,
    nested: { sessionToken: 'token', value: 2 }
  }, { trusted: true });
  const serialized = JSON.stringify(row);
  assert.equal(row.pseudonymId, 'P-ABC123');
  assert.equal(row.observations, 6);
  assert.equal(row.accountId, undefined);
  assert.equal(row.displayName, undefined);
  assert.equal(row.nested, undefined);
  assert.equal(serialized.includes('acct-secret'), false);
  assert.equal(serialized.includes('Ada'), false);
});

check('suppresses exact counts below the fixed cohort threshold', () => {
  assert.equal(MIN_COHORT, 5);
  assert.deepEqual(suppressedRow(), { suppressed: true, suppressionReason: 'MIN_COHORT' });
  assert.equal(Object.hasOwn(suppressedRow(), 'count'), false);
});

check('redacts forbidden fields recursively from response payloads', () => {
  const safe = sanitizeAnalyticsResponse({
    schemaVersion: 1,
    actor: { pseudonymId: 'P-ABC', accountId: 'acct-raw', displayName: 'Ada' },
    rows: [{ value: 4, username: 'ada', sessionToken: 'secret' }]
  });
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes('acct-raw'), false);
  assert.equal(serialized.includes('Ada'), false);
  assert.equal(serialized.includes('ada'), false);
  assert.equal(serialized.includes('secret'), false);
});

check('does not trust caller-supplied pseudonym strings', () => {
  const row = sanitizeAnalyticsRow({ pseudonymId: 'P-FAKE-IDENTITY', observations: 6 });
  assert.equal(row.pseudonymId, undefined);
  const trusted = sanitizeAnalyticsRow({ pseudonymId: 'P-SERVER', observations: 6 }, { trusted: true });
  assert.equal(trusted.pseudonymId, 'P-SERVER');
});

check('preserves nulls and deeply nested aggregate measures', () => {
  const safe = sanitizeAnalyticsResponse({ overview: { kpis: [{ comparison: { period: { sample: { value: null } } } }] } });
  assert.equal(safe.overview.kpis[0].comparison.period.sample.value, null);
});
