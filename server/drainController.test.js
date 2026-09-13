import assert from 'node:assert/strict';
import { createDrainController } from './drainController.js';

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
