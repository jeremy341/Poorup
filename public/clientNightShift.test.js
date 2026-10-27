import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

function harness() {
  let source = fs.readFileSync(new URL('./clientNightShift.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export \{.*\};\r?\n/gm, '')
    .replace(/^export /gm, '');
  source += '\n;globalThis.api = { configureNightShift, startNightShift, stopNightShift, nightShiftState, applyPatrolState, handlePatrolDisconnect: typeof handlePatrolDisconnect === "undefined" ? null : handlePatrolDisconnect };';
  const callbacks = [];
  const finishCallbacks = [];
  const finishPackets = [];
  const timers = [];
  let intervals = 0;
  const classNames = new Set();
  const classes = { add(name) { classNames.add(name); }, remove(name) { classNames.delete(name); }, contains(name) { return classNames.has(name); } };
  const listeners = {};
  const document = { body: { classList: classes }, hidden: false, querySelector() { return null; }, addEventListener(name, fn) { listeners[name] = fn; } };
  const storage = { getItem() { return null; }, setItem() {} };
  const context = { document, localStorage: storage, state: { phase: 'home', account: { account: {} } }, $: () => null, REDUCED_MOTION: false, PARLOR_PATROL_ENABLED: true, hydrateSprites() {}, setTimeout(fn, delay) { timers.push({ fn, delay, active: true }); return timers.length; }, clearTimeout(id) { if (timers[id - 1]) timers[id - 1].active = false; }, setInterval() { intervals += 1; return 1; }, clearInterval() {}, Date, Math, Map };
  vm.runInNewContext(source, context);
  const noop = () => {};
  context.api.configureNightShift({ emitServer(event, payload, callback) { if (event === 'start-patrol-run') callbacks.push(callback); if (event === 'finish-patrol-run') { finishCallbacks.push(callback); finishPackets.push(payload); } }, stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: noop });
  return { ...context.api, callbacks, finishCallbacks, finishPackets, timers, document, listeners, classes, storage, clientState: context.state, getIntervals: () => intervals };
}

test('a delayed start response cannot attach its token to a newer run', () => {
  const game = harness();
  game.startNightShift();
  game.stopNightShift();
  game.startNightShift();
  game.callbacks[0]({ success: true, runToken: 'old' });
  assert.equal(game.nightShiftState.serverRunToken, null);
});

test('server snapshots own the score and ignore older revisions', () => {
  const game = harness();
  game.startNightShift();
  game.callbacks[0]({ success: true, runToken: 'run', revision: 1, serverTime: 1000, wave: 1, endsAt: 61000, score: 0, hearts: 3, misses: 0, targets: [], ended: false, paused: false });
  game.applyPatrolState({ runToken: 'run', revision: 3, serverTime: 2000, wave: 1, endsAt: 61000, score: 125, hearts: 2, misses: 1, targets: [], ended: false, paused: false });
  game.applyPatrolState({ runToken: 'run', revision: 2, serverTime: 1500, wave: 1, endsAt: 61000, score: 0, hearts: 3, misses: 0, targets: [], ended: false, paused: false });
  assert.equal(game.nightShiftState.score, 125);
  assert.equal(game.nightShiftState.hearts, 2);
});


test('an immediately rejected start does not leave a live HUD interval', () => {
  const game = harness();
  const noop = () => {};
  game.configureNightShift({ emitServer(event, payload, callback) { callback({ success: false }); }, stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: noop });
  game.startNightShift();
  assert.equal(game.nightShiftState.active, false);
  assert.equal(game.getIntervals(), 0);
});


test('a delayed finish rejection cannot alter a newer run', () => {
  const game = harness();
  game.startNightShift();
  game.callbacks[0]({ success: true, runToken: 'old', revision: 1, serverTime: 1000, wave: 1, endsAt: 61000, score: 0, hearts: 3, misses: 0, targets: [], ended: false });
  game.applyPatrolState({ runToken: 'old', revision: 2, serverTime: 2000, wave: 1, endsAt: 61000, score: 125, hearts: 0, misses: 3, targets: [], ended: true });
  assert.equal(game.finishCallbacks.length, 1);
  game.stopNightShift();
  game.startNightShift();
  game.nightShiftState.serverRunSubmitted = true;
  game.finishCallbacks[0]({ success: false, error: 'old run' });
  assert.equal(game.nightShiftState.serverRunSubmitted, true);
});


test('a lost connection ends a signed-in run without attempting score submission', () => {
  const game = harness();
  game.startNightShift();
  game.callbacks[0]({ success: true, runToken: 'run', revision: 1, serverTime: 1000, wave: 1, endsAt: 61000, score: 0, hearts: 3, misses: 0, targets: [], ended: false });
  assert.equal(typeof game.handlePatrolDisconnect, "function");
  game.handlePatrolDisconnect();
  assert.equal(game.nightShiftState.active, false);
  assert.equal(game.finishCallbacks.length, 0);
  assert.match(game.nightShiftState.serverRunError, /connection/i);
});


test('signed-in finish does not infer a clean-run achievement from score and misses', () => {
  const game = harness();
  const unlocked = [];
  let start, finish;
  const noop = () => {};
  game.configureNightShift({ emitServer(event, payload, callback) { if (event === 'start-patrol-run') start = callback; if (event === 'finish-patrol-run') finish = callback; }, stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: id => unlocked.push(id) });
  game.startNightShift();
  start({ success: true, runToken: 'run', revision: 1, serverTime: 1000, wave: 1, endsAt: 61000, score: 125, hearts: 3, misses: 0, targets: [], ended: false });
  game.applyPatrolState({ runToken: 'run', revision: 2, serverTime: 2000, wave: 1, endsAt: 61000, score: 125, hearts: 0, misses: 3, targets: [], ended: true });
  finish({ success: true, score: 125, misses: 0, best: 125, aceRuns: 0 });
  assert.deepEqual(unlocked, []);
});


test('expired paused runs report failure without attempting to save', () => {
  const game = harness();
  let start, pause;
  const notices = [];
  const noop = () => {};
  game.configureNightShift({ emitServer(event, payload, callback) { if (event === 'start-patrol-run') start = callback; if (event === 'pause-patrol-run') pause = callback; }, stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: (title, body) => notices.push(body), unlockAchievement: noop });
  game.startNightShift();
  start({ success: true, runToken: 'run', revision: 1, serverTime: 1000, wave: 1, endsAt: 61000, score: 125, hearts: 3, misses: 0, targets: [], ended: false });
  game.document.hidden = true;
  game.listeners.visibilitychange();
  pause({ success: false, error: 'That paused patrol run expired.' });
  assert.equal(game.nightShiftState.active, false);
  assert.equal(game.nightShiftState.serverRunToken, null);
  assert.match(notices[0], /expired/i);
});


test('a signed-in run does not grant guest achievements after sign-out', () => {
  const game = harness();
  const unlocked = [];
  let start;
  const noop = () => {};
  game.configureNightShift({ emitServer(event, payload, callback) { if (event === 'start-patrol-run') start = callback; }, stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: id => unlocked.push(id) });
  game.startNightShift();
  start({ success: true, runToken: 'run', revision: 1, serverTime: 1000, wave: 1, endsAt: 61000, score: 125, hearts: 3, misses: 0, targets: [], ended: false });
  game.clientState.account = null;
  game.handlePatrolDisconnect();
  assert.deepEqual(unlocked, []);
});

test('a signed-in run takes its best from verified account stats, not local or legacy scores', () => {
  const game = harness();
  game.clientState.account.account.stats = { patrolBest: 900, patrolVerifiedBest: 125 };
  game.nightShiftState.best = 800;
  game.startNightShift();
  assert.equal(game.nightShiftState.best, 125);
});


test('guest best remains local when switching away from an account', () => {
  const game = harness();
  game.clientState.account.account.stats = { patrolVerifiedBest: 125 };
  game.startNightShift();
  game.callbacks[0]({ success: true, runToken: 'run', revision: 1, serverTime: Date.now(), wave: 1, endsAt: Date.now() + 60000, score: 0, hearts: 3, misses: 0, targets: [], ended: false });
  game.stopNightShift();
  game.finishCallbacks[0]({ success: true, best: 125 });
  game.clientState.account = null;
  game.storage.getItem = () => '500';
  game.startNightShift();
  assert.equal(game.nightShiftState.best, 500);
});

test('leaving an active signed-in patrol settles its earned score and blocks premature restart', () => {
  const game = harness();
  game.startNightShift();
  game.callbacks[0]({ success: true, runToken: 'run', revision: 1, serverTime: Date.now(), wave: 1, endsAt: Date.now() + 60000, score: 125, hearts: 3, misses: 0, targets: [], ended: false });
  game.stopNightShift();
  assert.equal(game.finishCallbacks.length, 1);
  game.startNightShift();
  assert.equal(game.callbacks.length, 1);
  game.finishCallbacks[0]({ success: true, best: 125, score: 125, misses: 0 });
  game.startNightShift();
  assert.equal(game.callbacks.length, 2);
});

test('leaving before start acknowledgement settles the returned token', () => {
  const game = harness();
  game.startNightShift();
  game.stopNightShift();
  game.startNightShift();
  assert.equal(game.callbacks.length, 1);
  game.callbacks[0]({ success: true, runToken: 'late', revision: 1, serverTime: Date.now(), wave: 1, endsAt: Date.now() + 60000, score: 0, hearts: 3, misses: 0, targets: [], ended: false });
  assert.equal(game.finishCallbacks.length, 1);
});


test('a settlement timeout allows restart and ignores the stale finish acknowledgement', () => {
  const game = harness();
  game.startNightShift();
  game.callbacks[0]({ success: true, runToken: 'old', revision: 1, serverTime: Date.now(), wave: 1, endsAt: Date.now() + 60000, score: 125, hearts: 3, misses: 0, targets: [], ended: false });
  game.stopNightShift();
  game.timers.find(timer => timer.delay === 4000 && timer.active).fn();
  game.timers.filter(timer => timer.delay === 4000 && timer.active).at(-1).fn();
  assert.match(game.nightShiftState.serverRunError, /confirm/i);
  game.startNightShift();
  assert.equal(game.callbacks.length, 2);
  game.nightShiftState.best = 10;
  game.finishCallbacks[0]({ success: true, best: 999 });
  assert.equal(game.nightShiftState.best, 10);
});

test('a start acknowledgement after the timeout still releases its server token', () => {
  const game = harness();
  game.startNightShift();
  game.stopNightShift();
  game.timers.find(timer => timer.delay === 8000 && timer.active).fn();
  game.callbacks[0]({ success: true, runToken: 'late' });
  assert.equal(game.finishCallbacks.length, 1);
});

test('disconnect during exit settlement reports that saving could not be confirmed', () => {
  const game = harness();
  const notices = [];
  let start, finish;
  const noop = () => {};
  game.configureNightShift({ emitServer(event, payload, callback) { if (event === 'start-patrol-run') start = callback; if (event === 'finish-patrol-run') finish = callback; }, stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: (title, body) => notices.push(body), unlockAchievement: noop });
  game.startNightShift();
  start({ success: true, runToken: 'run', revision: 1, serverTime: Date.now(), wave: 1, endsAt: Date.now() + 60000, score: 125, hearts: 3, misses: 0, targets: [], ended: false });
  game.stopNightShift();
  assert.equal(typeof finish, 'function');
  game.handlePatrolDisconnect();
  assert.match(notices.at(-1), /could not be confirmed/i);
  game.startNightShift();
  assert.equal(game.nightShiftState.active, true);
});

test('a start acknowledgement timeout ends the stalled run and releases a later token', () => {
  const game = harness();
  game.startNightShift();
  const timeout = game.timers.find(timer => timer.delay === 8000 && timer.active);
  assert.ok(timeout, 'start acknowledgement has a bounded wait');
  timeout.fn();
  assert.equal(game.nightShiftState.active, false);
  assert.match(game.nightShiftState.serverRunError, /confirm/i);
  game.callbacks[0]({ success: true, runToken: 'late' });
  assert.equal(game.finishCallbacks.length, 1);
});


test('a lost finish acknowledgement retries the same token once and accepts the replay', () => {
  const game = harness();
  game.startNightShift();
  game.callbacks[0]({ success: true, runToken: 'run', revision: 1, serverTime: Date.now(), wave: 1, endsAt: Date.now() + 60000, score: 125, hearts: 3, misses: 0, targets: [], ended: false });
  game.stopNightShift();
  const retry = game.timers.find(timer => timer.delay === 4000 && timer.active);
  assert.ok(retry, 'first finish acknowledgement wait is bounded');
  retry.fn();
  assert.equal(game.finishPackets.length, 2);
  assert.equal(game.finishPackets[0].runToken, 'run');
  assert.equal(game.finishPackets[1].runToken, 'run');
  game.finishCallbacks[1]({ success: true, score: 125, best: 125 });
  game.startNightShift();
  assert.equal(game.callbacks.length, 2);
});

test('late first finish acknowledgement settles once and a stale retry cannot alter a new run', () => {
  const game = harness();
  game.startNightShift();
  game.callbacks[0]({ success: true, runToken: 'run', revision: 1, serverTime: Date.now(), wave: 1, endsAt: Date.now() + 60000, score: 125, hearts: 3, misses: 0, targets: [], ended: false });
  game.stopNightShift();
  game.timers.find(timer => timer.delay === 4000 && timer.active).fn();
  game.finishCallbacks[0]({ success: true, score: 125, best: 125 });
  game.startNightShift();
  assert.equal(game.callbacks.length, 2);
  game.nightShiftState.best = 10;
  game.finishCallbacks[1]({ success: true, score: 125, best: 999 });
  assert.equal(game.nightShiftState.best, 10);
});

test('a failed retry after a lost first finish acknowledgement reports uncertainty', () => {
  const game = harness();
  const notices = [];
  let start;
  const callbacks = [];
  const noop = () => {};
  game.configureNightShift({ emitServer(event, payload, callback) { if (event === 'start-patrol-run') start = callback; if (event === 'finish-patrol-run') callbacks.push(callback); }, stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: (title, body) => notices.push(body), unlockAchievement: noop });
  game.startNightShift();
  start({ success: true, runToken: 'run', revision: 1, serverTime: Date.now(), wave: 1, endsAt: Date.now() + 60000, score: 125, hearts: 3, misses: 0, targets: [], ended: false });
  game.stopNightShift();
  game.timers.find(timer => timer.delay === 4000 && timer.active).fn();
  callbacks[1]({ success: false, error: 'Patrol run not found.' });
  assert.match(notices.at(-1), /could not confirm/i);
});

test('a late first failure does not hide a successful retry', () => {
  const game = harness();
  game.startNightShift();
  game.callbacks[0]({ success: true, runToken: 'run', revision: 1, serverTime: Date.now(), wave: 1, endsAt: Date.now() + 60000, score: 125, hearts: 3, misses: 0, targets: [], ended: false });
  game.stopNightShift();
  game.timers.find(timer => timer.delay === 4000 && timer.active).fn();
  game.finishCallbacks[0]({ success: false, error: 'temporary error' });
  game.startNightShift();
  assert.equal(game.callbacks.length, 1);
  game.finishCallbacks[1]({ success: true, score: 125, best: 125 });
  game.startNightShift();
  assert.equal(game.callbacks.length, 2);
});


function visibilitySnapshot(revision, paused) {
  const now = Date.now();
  return { success: true, runToken: 'run', revision, serverTime: now, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [], ended: false, paused };
}

test('hide then show before start acknowledgement cannot leave a visible run frozen', () => {
  const game = harness();
  game.startNightShift();
  game.document.hidden = true; game.listeners.visibilitychange();
  game.document.hidden = false; game.listeners.visibilitychange();
  game.callbacks[0](visibilitySnapshot(1, false));
  assert.equal(game.classes.contains('night-shift-paused'), false);
  assert.equal(game.nightShiftState.active, true);
});

test('a late resume acknowledgement cannot unpause a newly hidden run', () => {
  const game = harness();
  let start;
  const requests = [];
  const noop = () => {};
  game.configureNightShift({ emitServer(event, payload, callback) { if (event === 'start-patrol-run') start = callback; else requests.push({ event, callback }); }, stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: noop });
  game.startNightShift(); start(visibilitySnapshot(1, false));
  game.document.hidden = true; game.listeners.visibilitychange();
  game.document.hidden = false; game.listeners.visibilitychange();
  game.document.hidden = true; game.listeners.visibilitychange();
  requests.find(request => request.event === 'resume-patrol-run').callback(visibilitySnapshot(3, false));
  assert.equal(game.classes.contains('night-shift-paused'), true);
  requests.filter(request => request.event === 'pause-patrol-run').at(-1).callback(visibilitySnapshot(4, true));
  assert.equal(game.classes.contains('night-shift-paused'), true);
  assert.equal(game.nightShiftState.hearts, 3);
});

test('guest exit awards local score achievements but not clean-run', () => {
  const game = harness();
  const earned = [];
  const noop = () => {};
  game.clientState.account = null;
  game.configureNightShift({ stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: id => earned.push(id) });
  game.startNightShift();
  game.nightShiftState.score = 125;
  game.stopNightShift();
  assert.deepEqual(earned, ['patrol-rookie', 'patrol-regular']);
});

test('a start acknowledgement received while hidden immediately requests server pause', () => {
  const game = harness();
  let start;
  const requests = [];
  const noop = () => {};
  game.configureNightShift({ emitServer(event, payload, callback) { if (event === 'start-patrol-run') start = callback; else requests.push({ event, callback }); }, stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: noop });
  game.startNightShift();
  game.document.hidden = true; game.listeners.visibilitychange();
  start(visibilitySnapshot(1, false));
  assert.equal(requests[0].event, 'pause-patrol-run');
  assert.equal(game.classes.contains('night-shift-paused'), true);
});

test('latest visibility acknowledgement corrects a mismatched server pause state', () => {
  const game = harness();
  let start;
  const requests = [];
  const noop = () => {};
  game.configureNightShift({ emitServer(event, payload, callback) { if (event === 'start-patrol-run') start = callback; else requests.push({ event, callback }); }, stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: noop });
  game.startNightShift(); start(visibilitySnapshot(1, false));
  game.document.hidden = true; game.listeners.visibilitychange();
  requests[0].callback(visibilitySnapshot(2, false));
  assert.equal(requests[1].event, 'pause-patrol-run');
  requests[1].callback(visibilitySnapshot(3, true));
  assert.equal(game.classes.contains('night-shift-paused'), true);
});

test('a paused start acknowledgement resumes the server before visible play', () => {
  const game = harness();
  let start;
  const requests = [];
  const noop = () => {};
  game.configureNightShift({ emitServer(event, payload, callback) { if (event === 'start-patrol-run') start = callback; else requests.push({ event, callback }); }, stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: noop });
  game.startNightShift();
  start(visibilitySnapshot(1, true));
  assert.equal(requests[0]?.event, 'resume-patrol-run');
  assert.equal(game.classes.contains('night-shift-paused'), true);
});

test('hide then show before paused start acknowledgement resumes the server', () => {
  const game = harness();
  let start;
  const requests = [];
  const noop = () => {};
  game.configureNightShift({ emitServer(event, payload, callback) { if (event === 'start-patrol-run') start = callback; else requests.push({ event, callback }); }, stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: noop });
  game.startNightShift();
  game.document.hidden = true; game.listeners.visibilitychange();
  game.document.hidden = false; game.listeners.visibilitychange();
  start(visibilitySnapshot(1, true));
  assert.equal(requests[0].event, 'resume-patrol-run');
  requests[0].callback(visibilitySnapshot(2, false));
  assert.equal(game.classes.contains('night-shift-paused'), false);
  assert.equal(game.nightShiftState.hearts, 3);
});
