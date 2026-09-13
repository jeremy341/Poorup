/* global process */
import assert from 'node:assert/strict';
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, addEventListener: () => {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const {
  normalizeMaintenanceSnapshot,
  maintenanceActive,
  maintenanceCopy,
} = await import('./clientMaintenance.js');

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

check('normalizes malformed maintenance snapshots safely', () => {
  const snapshot = normalizeMaintenanceSnapshot({ mode: 'invalid', activeRounds: '3', releaseId: '<release>' });
  assert.equal(snapshot.mode, 'normal');
  assert.equal(snapshot.activeRounds, 3);
  assert.equal(snapshot.releaseId, 'release');
  assert.equal(maintenanceActive(snapshot), false);
});

check('keeps draining copy explicit and stable', () => {
  const snapshot = normalizeMaintenanceSnapshot({ mode: 'draining', message: 'MAINTENANCE WINDOW' });
  assert.equal(maintenanceActive(snapshot), true);
  assert.match(maintenanceCopy(snapshot), /NEW ROUNDS ARE PAUSED/);
  assert.match(maintenanceCopy(snapshot), /CURRENT ROUNDS CONTINUE/);
});

check('never treats a maintenance snapshot as a game action', () => {
  const snapshot = normalizeMaintenanceSnapshot({ mode: 'maintenance', activeRounds: 1 });
  assert.equal(snapshot.mode, 'maintenance');
  assert.equal(snapshot.activeRounds, 1);
  assert.equal(maintenanceCopy(snapshot).includes('START'), false);
});
