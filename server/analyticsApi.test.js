import assert from 'node:assert/strict';
import { buildAnalyticsSummary, isAdminAccount, normalizeAdminIds } from './analyticsApi.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

check('normalizes a bounded admin allow-list', () => {
  assert.deepEqual(normalizeAdminIds('acct-a, acct-b,acct-a'), ['acct-a', 'acct-b']);
  assert.deepEqual(normalizeAdminIds(['acct-c', 4, 'acct-d']), ['acct-c', 'acct-d']);
});

check('authorizes only explicit account ids', () => {
  const admins = normalizeAdminIds('acct-owner');
  assert.equal(isAdminAccount('acct-owner', admins), true);
  assert.equal(isAdminAccount('acct-other', admins), false);
  assert.equal(isAdminAccount('', admins), false);
});

check('builds a safe read-only summary', () => {
  const summary = buildAnalyticsSummary({
    snapshotMetrics: () => ({ generatedAt: '2026-09-13T12:00:00.000Z', metrics: { 'active-rounds': { value: 2 } } }),
  }, 'acct-owner', ['acct-owner'], 'day');
  assert.equal(summary.success, true);
  assert.equal(summary.range, 'day');
  assert.equal(summary.metrics['active-rounds'].value, 2);
  assert.equal(summary.accountId, undefined);
});

check('rejects unauthorized summaries', () => {
  const result = buildAnalyticsSummary({ snapshotMetrics: () => ({ metrics: {} }) }, 'acct-other', ['acct-owner']);
  assert.deepEqual(result, { success: false, status: 403, error: 'Forbidden.' });
});
