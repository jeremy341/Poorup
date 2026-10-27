import assert from 'node:assert/strict';
import {
  normalizeMaintenanceMode,
  createMaintenanceSnapshot,
  canCreateRoom,
  canStartRound,
  canJoinRoom,
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

check('lockout is a maintenance-only flag and old snapshots read as unlocked', () => {
  assert.equal(createMaintenanceSnapshot({ mode: 'maintenance', lockout: true }).lockout, true);
  assert.equal(createMaintenanceSnapshot({ mode: 'maintenance' }).lockout, false);
  assert.equal(createMaintenanceSnapshot({ mode: 'draining', lockout: true }).lockout, false);
  assert.equal(createMaintenanceSnapshot({ mode: 'normal', lockout: true }).lockout, false);
  assert.equal(createMaintenanceSnapshot({ mode: 'maintenance', lockout: 'yes' }).lockout, false);
  assert.match(maintenanceNotice({ mode: 'maintenance', lockout: true }), /THE SITE IS CLOSED/);
});

check('a bypass lifts only the lockout gates; draining and plain maintenance stay closed', () => {
  const locked = createMaintenanceSnapshot({ mode: 'maintenance', lockout: true });
  const plain = createMaintenanceSnapshot({ mode: 'maintenance' });
  const draining = createMaintenanceSnapshot({ mode: 'draining' });
  assert.equal(canCreateRoom(locked), false);
  assert.equal(canCreateRoom(locked, { bypass: true }), true);
  assert.equal(canStartRound(locked, { bypass: true }), true);
  assert.equal(canCreateRoom(plain, { bypass: true }), false);
  assert.equal(canCreateRoom(draining, { bypass: true }), false);
  assert.equal(canStartRound(draining, { bypass: true }), false);
});

check('the lockout refuses new seats but never a reconnect', () => {
  const locked = createMaintenanceSnapshot({ mode: 'maintenance', lockout: true });
  assert.equal(canJoinRoom(locked), false);
  assert.equal(canJoinRoom(locked, { reconnecting: true }), true);
  assert.equal(canJoinRoom(locked, { bypass: true }), true);
  assert.equal(canJoinRoom(createMaintenanceSnapshot({ mode: 'maintenance' })), true);
});

check('a drain leaves seats open but a lockout refuses them', () => {
  const draining = createMaintenanceSnapshot({ mode: 'draining' });
  assert.equal(canJoinRoom(draining), true,
    'a drain is not a lockout: the seat stays open and the shutdown waits for the lobby');
  const locked = createMaintenanceSnapshot({ mode: 'maintenance', lockout: true });
  assert.equal(canJoinRoom(locked), false, 'a lockout refuses a new seat');
  assert.equal(canJoinRoom(locked, { reconnecting: true }), true, 'a seated player comes back');
  assert.equal(canJoinRoom(locked, { bypass: true }), true, 'an operator bypass lifts the lockout');
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
