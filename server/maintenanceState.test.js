import assert from 'node:assert/strict';
import {
  normalizeMaintenanceMode,
  createMaintenanceSnapshot,
  canCreateRoom,
  canStartRound,
  maintenanceNotice,
} from './maintenanceState.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

check('normalizes only supported maintenance modes', () => {
  assert.equal(normalizeMaintenanceMode('normal'), 'normal');
  assert.equal(normalizeMaintenanceMode('DRAINING'), 'draining');
  assert.equal(normalizeMaintenanceMode('maintenance'), 'maintenance');
  assert.equal(normalizeMaintenanceMode('unknown'), 'normal');
});

check('normal permits room creation and round starts', () => {
  const snapshot = createMaintenanceSnapshot({ mode: 'normal', releaseId: 'r1' });
  assert.equal(canCreateRoom(snapshot), true);
  assert.equal(canStartRound(snapshot), true);
});

check('draining blocks new rooms and rounds', () => {
  const snapshot = createMaintenanceSnapshot({ mode: 'draining', releaseId: 'r2' });
  assert.equal(canCreateRoom(snapshot), false);
  assert.equal(canStartRound(snapshot), false);
  assert.match(maintenanceNotice(snapshot), /NEW ROUNDS ARE PAUSED/);
});

check('maintenance keeps the active-round distinction explicit', () => {
  const snapshot = createMaintenanceSnapshot({ mode: 'maintenance', activeRounds: 2, releaseId: 'r3' });
  assert.equal(canCreateRoom(snapshot), false);
  assert.equal(canStartRound(snapshot), false);
  assert.equal(snapshot.activeRounds, 2);
  assert.match(maintenanceNotice(snapshot), /CURRENT ROUNDS CONTINUE/);
});

check('bounds message and release metadata without secrets', () => {
  const snapshot = createMaintenanceSnapshot({
    mode: 'draining',
    message: '  update <script>alert(1)</script>  '.repeat(40),
    releaseId: '  release-42  ',
    drainDeadline: 'not-a-date',
    activeRounds: -4,
  });
  assert.equal(snapshot.releaseId, 'release-42');
  assert.equal(snapshot.activeRounds, 0);
  assert.equal(snapshot.drainDeadline, null);
  assert.ok(snapshot.message.length <= 240);
  assert.equal(snapshot.message.includes('<script>'), false);
});
