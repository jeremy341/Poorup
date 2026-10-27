import assert from 'node:assert/strict';
import * as drainController from './drainController.js';
import { bootMaintenanceMode, bootMaintenanceRecord, createDrainController } from './drainController.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

check('starts normal and exposes a stable snapshot', () => {
  const controller = createDrainController({ now: () => 1000 });
  assert.equal(controller.snapshot().mode, 'normal');
  assert.equal(controller.canCreateRoom(), true);
  assert.equal(controller.canStartRound(), true);
});

check('beginDrain blocks only new rooms and rounds', () => {
  const controller = createDrainController({ now: () => 1000, getActiveRounds: () => 2 });
  const snapshot = controller.beginDrain({ releaseId: 'r-2', deadline: 5000 });
  assert.equal(snapshot.mode, 'draining');
  assert.equal(snapshot.activeRounds, 2);
  assert.equal(controller.canCreateRoom(), false);
  assert.equal(controller.canStartRound(), false);
  assert.equal(controller.canJoinRoom(), true,
    'a drain is not a lockout: seats stay open and the shutdown waits for the lobby');
  assert.equal(controller.canJoinRoom({ reconnecting: true }), true);
  assert.equal(controller.isDrainComplete(), false);
});

check('drain completes when active rounds reach zero', () => {
  let activeRounds = 1;
  const controller = createDrainController({ now: () => 1000, getActiveRounds: () => activeRounds });
  controller.beginDrain({ releaseId: 'r-3', deadline: 5000 });
  activeRounds = 0;
  assert.equal(controller.activeRoundCount(), 0);
  assert.equal(controller.isDrainComplete(), true);
  const finished = controller.finishMaintenance();
  assert.equal(finished.mode, 'normal');
  assert.equal(controller.canCreateRoom(), true);
});

check('an unreadable active-round count is unknown, not drained', () => {
  for (const getActiveRounds of [() => { throw new Error('read failed'); }, () => NaN, () => Infinity, () => 'many']) {
    const controller = createDrainController({ now: () => 1000, getActiveRounds });
    controller.beginDrain({ deadline: 5000 });
    assert.equal(controller.activeRoundCount(), Infinity);
    assert.equal(controller.isDrainComplete(), false);
    controller.dispose();
  }
});

check('publishes bounded state changes and cancels old timers', () => {
  let activeRounds = 1;
  const changes = [];
  const controller = createDrainController({
    now: () => 1000,
    getActiveRounds: () => activeRounds,
    onChange: snapshot => changes.push(snapshot),
  });
  controller.beginDrain({ releaseId: 'r-4', deadline: 5000, message: '  hold  ' });
  controller.enterMaintenance();
  controller.finishMaintenance();
  assert.deepEqual(changes.map(entry => entry.mode), ['draining', 'maintenance', 'normal']);
  assert.equal(controller.snapshot().releaseId, '');
});

check('beginDrain publishes the requested deadline in the snapshot', () => {
  const controller = createDrainController({ now: () => 1000 });
  const snapshot = controller.beginDrain({ releaseId: 'r-5', deadline: 5000 });
  assert.equal(snapshot.drainDeadline, new Date(5000).toISOString());
  assert.equal(controller.snapshot().drainDeadline, new Date(5000).toISOString());
});

check('beginDrain does not downgrade an active maintenance window', () => {
  const modes = [];
  const controller = createDrainController({ now: () => 1000, onChange: snapshot => modes.push(snapshot.mode) });
  controller.enterMaintenance({ releaseId: 'r-6' });
  const snapshot = controller.beginDrain({ releaseId: 'r-7', deadline: 5000 });
  assert.equal(snapshot.mode, 'maintenance');
  assert.equal(controller.snapshot().mode, 'maintenance');
  assert.equal(controller.canCreateRoom(), false);
  assert.deepEqual(modes, ['maintenance']);
});

check('persist:false drains are published but flagged as not durable', () => {
  const calls = [];
  const controller = createDrainController({ now: () => 1000, onChange: (snapshot, options) => calls.push({ mode: snapshot.mode, persist: options?.persist }) });
  controller.beginDrain({ releaseId: 'shutdown', deadline: 5000, persist: false });
  controller.finishMaintenance();
  assert.deepEqual(calls, [{ mode: 'draining', persist: false }, { mode: 'normal', persist: true }]);
});

check('setLockout closes the site on top of maintenance and lifting it keeps maintenance', () => {
  const changes = [];
  const controller = createDrainController({ now: () => 1000, getActiveRounds: () => 1, onChange: snapshot => changes.push(`${snapshot.mode}:${snapshot.lockout}`) });
  const locked = controller.setLockout(true, { message: 'Back at ten', releaseId: 'rel-9' });
  assert.equal(locked.mode, 'maintenance');
  assert.equal(locked.lockout, true);
  assert.equal(locked.message, 'Back at ten');
  assert.equal(locked.releaseId, 'rel-9');
  assert.equal(controller.canCreateRoom(), false);
  assert.equal(controller.canCreateRoom({ bypass: true }), true);
  assert.equal(controller.canStartRound({ bypass: true }), true);
  assert.equal(controller.canJoinRoom(), false);
  assert.equal(controller.canJoinRoom({ reconnecting: true }), true);
  // Updating maintenance (a deploy script, the MAINTENANCE button) keeps the lockout.
  assert.equal(controller.enterMaintenance({ message: 'Still busy' }).lockout, true);
  // A drain request cannot relax it either.
  assert.equal(controller.beginDrain({ deadline: 5000 }).lockout, true);
  const lifted = controller.setLockout(false);
  assert.equal(lifted.mode, 'maintenance');
  assert.equal(lifted.lockout, false);
  assert.equal(lifted.releaseId, 'rel-9');
  assert.equal(controller.canJoinRoom(), true);
  assert.equal(controller.canCreateRoom({ bypass: true }), false, 'plain maintenance ignores the bypass');
  controller.setLockout(true);
  assert.equal(controller.finishMaintenance().lockout, false);
  assert.deepEqual(changes, ['maintenance:true', 'maintenance:true', 'maintenance:false', 'maintenance:true', 'normal:false']);
});

check('lifting a lockout that is not on changes nothing and publishes nothing', () => {
  const changes = [];
  const controller = createDrainController({ now: () => 1000, onChange: snapshot => changes.push(snapshot.mode) });
  assert.equal(controller.setLockout(false).mode, 'normal');
  controller.beginDrain({ deadline: 5000 });
  assert.equal(controller.setLockout(false).mode, 'draining');
  assert.deepEqual(changes, ['draining']);
  controller.dispose();
});

check('a drain deadline that fires reaches maintenance without a lockout', () => {
  let fire = null;
  const controller = createDrainController({ now: () => 1000, schedule: callback => { fire = callback; return 1; }, cancel: () => {} });
  controller.beginDrain({ deadline: 5000 });
  fire();
  assert.equal(controller.snapshot().mode, 'maintenance');
  assert.equal(controller.snapshot().lockout, false);
});

check('boot restores a persisted lockout only for a persisted maintenance window', () => {
  assert.equal(createDrainController({ initialMode: 'maintenance', initialLockout: true }).snapshot().lockout, true);
  assert.equal(createDrainController({ initialMode: 'draining', initialLockout: true }).snapshot().lockout, false);
  assert.equal(createDrainController({ initialMode: 'maintenance' }).snapshot().lockout, false);
});

check('boot ignores a persisted shutdown drain and keeps operator drains', () => {
  const shutdownRecord = { mode: 'draining', releaseId: 'shutdown', message: 'SIGTERM · SERVER RESTARTING', drainDeadline: null };
  const releasedRecord = { mode: 'draining', releaseId: 'a1b2c3', message: 'SIGTERM · SERVER RESTARTING', drainDeadline: null };
  const deployRecord = { mode: 'draining', releaseId: 'a1b2c3', message: 'MAINTENANCE WINDOW · INCOMING RELEASE', drainDeadline: null };
  assert.equal(bootMaintenanceMode(shutdownRecord, undefined), undefined);
  assert.equal(bootMaintenanceMode(shutdownRecord, 'maintenance'), 'maintenance');
  assert.equal(bootMaintenanceMode(releasedRecord, undefined), undefined);
  assert.equal(bootMaintenanceMode(deployRecord, undefined), 'draining');
  assert.equal(bootMaintenanceMode({ mode: 'maintenance', releaseId: 'a1b2c3', message: 'MAINTENANCE IN PROGRESS' }, undefined), 'maintenance');
  assert.equal(bootMaintenanceMode(null, 'draining'), 'draining');
  assert.equal(createDrainController({ initialMode: bootMaintenanceMode(shutdownRecord, undefined) }).snapshot().mode, 'normal');
});

check('shutdown markers never discard a persisted maintenance lockout', () => {
  const locked = { mode: 'maintenance', lockout: true, releaseId: 'shutdown', message: 'SIGTERM · SERVER RESTARTING', drainDeadline: null };
  const cased = { mode: ' MAINTENANCE ', lockout: true, releaseId: 'a1b2c3', message: 'SIGINT · SERVER RESTARTING', drainDeadline: null };
  assert.equal(bootMaintenanceMode(locked, undefined), 'maintenance');
  assert.equal(bootMaintenanceRecord(locked), locked);
  assert.equal(bootMaintenanceMode(cased, undefined), 'maintenance');
  assert.equal(bootMaintenanceRecord(cased), cased);
  const restored = createDrainController({ initialMode: bootMaintenanceMode(locked), initialLockout: true, initialState: bootMaintenanceRecord(locked) });
  assert.equal(restored.snapshot().mode, 'maintenance');
  assert.equal(restored.snapshot().lockout, true);
  // A legacy shutdown drain is still not an operator decision.
  const legacyDrain = { mode: 'Draining', releaseId: 'shutdown', message: 'SIGTERM · SERVER RESTARTING' };
  assert.equal(bootMaintenanceMode(legacyDrain, 'normal'), 'normal');
  assert.equal(bootMaintenanceRecord(legacyDrain), null);
});

check('boot validates the persisted mode and fails closed on corrupt input', () => {
  assert.equal(bootMaintenanceMode({ mode: ' Maintenance ' }, undefined), 'maintenance');
  assert.equal(bootMaintenanceMode({ mode: 'teapot' }, undefined), 'maintenance');
  assert.equal(bootMaintenanceMode({ mode: '' }, undefined), 'maintenance');
  assert.equal(bootMaintenanceMode({ mode: 42 }, undefined), 'maintenance');
  const corrupt = { value: null, missing: false, corrupt: true };
  assert.equal(bootMaintenanceMode(corrupt, undefined), 'maintenance');
  assert.equal(bootMaintenanceRecord(corrupt), null);
  assert.equal(bootMaintenanceMode({ value: { mode: 'DRAINING' }, corrupt: false }, undefined), 'draining');
  assert.deepEqual(bootMaintenanceRecord({ value: { mode: 'draining' }, corrupt: false }), { mode: 'draining' });
});

check('boot rejects an unrecognised POORUP_MAINTENANCE_MODE instead of opening the site', () => {
  for (const typo of ['maintenence', 'maintainance', 'drain', 'open', 'true']) {
    assert.throws(() => bootMaintenanceMode(null, typo), /POORUP_MAINTENANCE_MODE.*normal, draining, maintenance/, typo);
  }
  // A typo fails the boot even when a persisted record would have won, so it is
  // never silently ignored until the record is cleared.
  assert.throws(() => bootMaintenanceMode({ mode: 'maintenance' }, 'maintenence'), /POORUP_MAINTENANCE_MODE/);
  // Unset, empty and blank keep the default; recognised values keep working.
  assert.equal(bootMaintenanceMode(null, undefined), undefined);
  assert.equal(bootMaintenanceMode(null, ''), '');
  assert.equal(bootMaintenanceMode(null, '   '), '   ');
  assert.equal(createDrainController({ initialMode: bootMaintenanceMode(null, '') }).snapshot().mode, 'normal');
  assert.equal(bootMaintenanceMode(null, ' Maintenance '), ' Maintenance ');
  assert.equal(bootMaintenanceMode(null, 'normal'), 'normal');
});

check('a corrupt maintenance file is replaced by a durable closed marker', () => {
  const marker = drainController.corruptMaintenanceMarker();
  assert.equal(marker.mode, 'maintenance', 'the marker must boot closed');
  assert.equal(marker.lockout, false, 'recovering the state must not change who may join');
  assert.match(String(marker.message), /CORRUPT/i, 'the operator must see that the state was recovered');
  // The marker is an ordinary persisted record, so the next boot reads it
  // and stays closed instead of falling back to the environment default.
  assert.equal(bootMaintenanceMode(marker, 'normal'), 'maintenance');
  assert.equal(bootMaintenanceRecord(marker).mode, 'maintenance');
  const restored = createDrainController({ initialMode: bootMaintenanceMode(marker, 'normal'), initialState: bootMaintenanceRecord(marker) });
  assert.equal(restored.snapshot().mode, 'maintenance');
  assert.equal(restored.snapshot().message, marker.message);
  assert.equal(restored.canCreateRoom(), false, 'the recovered table takes no new rooms');
  assert.equal(restored.canJoinRoom(), true, 'the recovery must not close the seats');
});

check('a shutdown drain that reaches its deadline is never persisted', () => {
  const calls = [];
  let fire = null;
  const controller = createDrainController({
    now: () => 1000,
    getActiveRounds: () => 1,
    schedule: callback => { fire = callback; return 1; },
    cancel: () => {},
    onChange: (snapshot, options) => calls.push({ mode: snapshot.mode, persist: options?.persist }),
  });
  controller.beginDrain({ releaseId: 'rel-1', deadline: 5000, message: 'SIGTERM · SERVER RESTARTING', persist: false });
  fire();
  assert.equal(controller.snapshot().mode, 'maintenance');
  assert.deepEqual(calls, [{ mode: 'draining', persist: false }, { mode: 'maintenance', persist: false }]);
  // A later operator drain is persisted again, including its deadline transition.
  controller.finishMaintenance();
  controller.beginDrain({ releaseId: 'rel-2', deadline: 6000 });
  fire();
  assert.deepEqual(calls.slice(-2), [{ mode: 'draining', persist: true }, { mode: 'maintenance', persist: true }]);
});

check('a deadline past the timer limit is clamped and re-armed instead of firing at once', () => {
  let clock = 1000;
  const armed = [];
  const fires = [];
  const farFuture = 1000 + 30 * 24 * 60 * 60 * 1000;
  const controller = createDrainController({
    now: () => clock,
    schedule: (callback, delay) => { armed.push(delay); fires.push(callback); return armed.length; },
    cancel: () => {},
  });
  controller.beginDrain({ deadline: farFuture });
  assert.ok(armed[0] <= 2_147_483_647, `delay ${armed[0]} must fit a 32-bit timer`);
  clock += armed[0];
  fires[0]();
  assert.equal(controller.snapshot().mode, 'draining', 'the early wake-up must not end the drain');
  assert.equal(armed.length, 2, 'the timer re-arms for the remainder');
  clock = farFuture;
  fires[1]();
  assert.equal(controller.snapshot().mode, 'maintenance');
});

check('a deadline the snapshot rejects arms no timer', () => {
  const armed = [];
  const controller = createDrainController({ now: () => 1000, schedule: (callback, delay) => { armed.push(delay); return 1; }, cancel: () => {} });
  const snapshot = controller.beginDrain({ deadline: 1e20 });
  assert.equal(snapshot.drainDeadline, null);
  assert.deepEqual(armed, []);
});

check('a restored operator drain keeps its release, message and deadline and still ends at the deadline', () => {
  const record = { mode: 'draining', releaseId: 'deploy-1', message: 'MAINTENANCE WINDOW · INCOMING RELEASE', drainDeadline: new Date(5000).toISOString() };
  assert.equal(bootMaintenanceRecord(record), record);
  assert.equal(bootMaintenanceRecord({ mode: 'draining', releaseId: 'shutdown', message: 'SIGTERM · SERVER RESTARTING' }), null);
  assert.equal(bootMaintenanceRecord(null), null);
  const calls = [];
  let fire = null;
  const controller = createDrainController({
    now: () => 1000,
    initialMode: 'draining',
    initialState: record,
    schedule: callback => { fire = callback; return 1; },
    cancel: () => {},
    onChange: (snapshot, options) => calls.push({ mode: snapshot.mode, persist: options?.persist }),
  });
  const restored = controller.snapshot();
  assert.equal(restored.releaseId, 'deploy-1');
  assert.equal(restored.message, 'MAINTENANCE WINDOW · INCOMING RELEASE');
  assert.equal(restored.drainDeadline, record.drainDeadline);
  fire();
  assert.equal(controller.snapshot().mode, 'maintenance');
  assert.deepEqual(calls, [{ mode: 'maintenance', persist: true }]);
  // A record for another mode is not applied to the env-chosen mode.
  assert.equal(createDrainController({ initialMode: 'maintenance', initialState: record }).snapshot().releaseId, '');
});

check('a restored drain whose deadline already passed goes straight to maintenance', () => {
  const record = { mode: 'draining', releaseId: 'deploy-1', drainDeadline: new Date(500).toISOString() };
  let fire = null;
  const controller = createDrainController({ now: () => 1000, initialMode: 'draining', initialState: record, schedule: (callback, delay) => { fire = { callback, delay }; return 1; }, cancel: () => {} });
  assert.equal(fire.delay, 0);
  fire.callback();
  assert.equal(controller.snapshot().mode, 'maintenance');
});

check('a manual maintenance entry drops the drain deadline but a restated one keeps it', () => {
  let fire = null;
  const controller = createDrainController({ now: () => 1000, schedule: callback => { fire = callback; return 1; }, cancel: () => {} });
  controller.beginDrain({ deadline: 5000 });
  assert.equal(controller.enterMaintenance({ message: 'by hand' }).drainDeadline, null);
  controller.finishMaintenance();
  controller.beginDrain({ deadline: 5000 });
  fire();
  assert.equal(controller.snapshot().drainDeadline, new Date(5000).toISOString(), 'the deadline-driven transition still shows when it ended');
  assert.equal(controller.enterMaintenance({ message: 'update' }).drainDeadline, new Date(5000).toISOString());
});

check('a failed persist keeps the last durable state and is retried until it lands', () => {
  let failing = true;
  const writes = [];
  const timers = [];
  const controller = createDrainController({
    now: () => 1000,
    getActiveRounds: () => 0,
    onChange: (snapshot, options) => {
      writes.push({ mode: snapshot.mode, persist: options?.persist });
      return !failing;
    },
    schedule: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    cancel: () => {},
  });
  controller.enterMaintenance({ message: 'closed' });
  assert.equal(controller.lastPersistFailed(), true);
  assert.equal(controller.lastDurableSnapshot().mode, 'normal', 'the durable state did not move');
  failing = false;
  timers[0].callback();
  assert.equal(controller.lastPersistFailed(), false);
  assert.equal(controller.lastDurableSnapshot().mode, 'maintenance');
  assert.deepEqual(writes.map(entry => entry.mode), ['maintenance', 'maintenance']);
});

check('a failed persist is reported until the next successful one', () => {
  let failing = true;
  const controller = createDrainController({ now: () => 1000, onChange: () => !failing });
  assert.equal(controller.lastPersistFailed(), false);
  controller.beginDrain({ deadline: 5000 });
  assert.equal(controller.lastPersistFailed(), true);
  failing = false;
  controller.finishMaintenance();
  assert.equal(controller.lastPersistFailed(), false);
  const silent = createDrainController({ now: () => 1000, onChange: () => {} });
  silent.beginDrain({ deadline: 5000 });
  assert.equal(silent.lastPersistFailed(), false, 'an onChange that returns nothing is not a failure');
});
