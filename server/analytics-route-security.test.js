import assert from 'node:assert/strict';
import { buildAnalyticsBalance, buildAnalyticsDrilldown, setAnalyticsNoStoreHeaders } from './analyticsApi.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const rollup = {
  health: () => ({ loaded: true, fresh: true, lagSeconds: 0, pendingWrites: 0, rejectedEvents: 0 }),
  query: () => ({ schemaVersion: 1, generatedAt: '2026-09-13T12:00:00.000Z', dimensions: {}, actorRollups: {}, quality: {} })
};

check('rejects non-admin balance and drilldown requests without data', () => {
  assert.deepEqual(buildAnalyticsBalance({ rollup, accountId: 'acct-nope', adminIds: ['acct-admin'], query: {} }), { success: false, status: 403, error: 'Forbidden.' });
  assert.deepEqual(buildAnalyticsDrilldown({ rollup, accountId: 'acct-nope', adminIds: ['acct-admin'], query: {} }), { success: false, status: 403, error: 'Forbidden.' });
});

check('returns no-store header contract', () => {
  const headers = {};
  setAnalyticsNoStoreHeaders({ setHeader: (name, value) => { headers[name] = value; } });
  assert.equal(headers['Cache-Control'], 'no-store');
});

check('returns versioned safe balance and unavailable pseudonym drilldown', () => {
  const balance = buildAnalyticsBalance({ rollup, accountId: 'acct-admin', adminIds: ['acct-admin'], query: {} });
  assert.equal(balance.success, true);
  assert.equal(balance.schemaVersion, 1);
  assert.equal(balance.pseudonymVersion, 'hmac-v1');
  assert.equal(JSON.stringify(balance).includes('accountId'), false);
  const drilldown = buildAnalyticsDrilldown({ rollup, accountId: 'acct-admin', adminIds: ['acct-admin'], query: {} });
  assert.equal(drilldown.success, true);
  assert.equal(drilldown.breakdowns[0].suppressionReason, 'PSEUDONYM_UNAVAILABLE');
});
