import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { AccountStore } from './accountStore.js';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { createSocialApi } from './socketSocialApi.js';
import { registerSocialSocketHandlers } from './serverSocketSocial.js';

const http = createServer();
const io = new Server(http);
const saved = [];
const achievements = [];
let failNextPatrolSave = false;
let failNextAchievementSave = false;
let failNextAchievementRollback = false;
let failNextAchievementUnlock = false;
const achievementMirrors = new Set();
const achievementUnlocks = new Map();
const achievementRetryTimers = [];
const accounts = new Map([['a', { id: 'a' }], ['b', { id: 'b' }], ['c', { id: 'c' }]]);
const accountStore = {
  recordPatrolResult(id, result) { if (failNextPatrolSave) { failNextPatrolSave = false; throw new Error('Save failed'); } saved.push({ id, ...result }); return { success: true, ...result, best: result.score, aceRuns: 0 }; },
  recordAchievement(accountId, achievement) {
    if (failNextAchievementSave) { failNextAchievementSave = false; throw new Error('Achievement mirror save failed'); }
    const key = `${accountId}:${achievement.id}`;
    const created = !achievementMirrors.has(key);
    achievementMirrors.add(key);
    return { success: true, created };
  },
  getAccountSnapshot: id => ({ id }),
  getAccountById: id => accounts.get(id) || null,
  getPublicAccountById: id => ({ id, displayName: id.toUpperCase() })
};
const social = createSocialApi({
  io,
  accountStore,
  socialStore: { addNotification() {} },
  matchStore: {},
  achievementStore: {
    unlock(record) {
      if (failNextAchievementUnlock) { failNextAchievementUnlock = false; throw new Error('Achievement unlock save failed'); }
      const key = `${record.accountId}:${record.achievementId}`;
      const existing = achievementUnlocks.get(key);
      if (existing) return { created: false, record: existing };
      const created = { ...record, unlockedAt: '2026-10-28T00:00:00.000Z' };
      achievementUnlocks.set(key, created);
      return { created: true, record: created };
    },
    remove(accountId, achievementId) {
      if (failNextAchievementRollback) { failNextAchievementRollback = false; throw new Error('Achievement rollback failed'); }
      return achievementUnlocks.delete(`${accountId}:${achievementId}`);
    }
  },
  setTimeoutFn(callback, delay) {
    const timer = { delay, cleared: false, fired: false, unref() {} };
    timer.callback = () => { timer.fired = true; return callback(); };
    achievementRetryTimers.push(timer);
    return timer;
  },
  clearTimeoutFn(timer) { if (timer) timer.cleared = true; }
});
social.accountForSocket = socket => accounts.get(socket.handshake.auth.account) || null;
const recordVerifiedAchievement = social.recordVerifiedAchievement.bind(social);
social.recordVerifiedAchievement = (candidate, gameId) => {
  const created = recordVerifiedAchievement(candidate, gameId);
  if (created) achievements.push(candidate.achievementId);
  return created;
};
io.on('connection', socket => registerSocialSocketHandlers((event, handler) => socket.on(event, handler), socket, { io, accountStore, socialStore: {}, matchStore: {}, social }));
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${http.address().port}`;
const clients = [];
async function client(account) {
  const socket = connect(url, { auth: { account }, reconnection: false }); clients.push(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return socket;
}
const ask = (socket, event, payload = {}) => new Promise(resolve => socket.emit(event, payload, resolve));
async function activate(socket, token, target) {
  const internal = social.patrolRuns.get(token).targets.get(target.id);
  internal.offeredAt = Date.now() - Math.ceil(target.duration * 0.16);
  return ask(socket, 'ready-patrol-target', { runToken: token, targetId: target.id });
}
async function startReady(socket) {
  const start = await ask(socket, 'start-patrol-run');
  if (!start.success) return start;
  const ready = await ask(socket, 'resume-patrol-run', { runToken: start.runToken });
  if (ready.targets.length) return activate(socket, start.runToken, ready.targets[0]);
  return ready;
}
try {
  const a = await client('a');
  const b = await client('b');
  const sameAccount = await client('a');
  const waiting = await ask(a, 'start-patrol-run');
  assert.equal(waiting.success, true);
  assert.equal(waiting.paused, true, 'a run waits for the visible client');
  assert.equal(waiting.hearts, 3);
  assert.deepEqual(waiting.targets, [], 'waiting does not spawn a target');
  const waitingRun = social.patrolRuns.get(waiting.runToken);
  waitingRun.pausedAt -= 10000;
  waitingRun.waveStartedAt -= 10000;
  waitingRun.waveEndsAt -= 10000;
  const ready = await ask(a, 'resume-patrol-run', { runToken: waiting.runToken });
  assert.equal(ready.paused, false);
  assert.equal(waitingRun.pausedTotal, 0, 'initial waiting does not consume the user pause budget');
  assert.equal(ready.hearts, 3, 'a delayed start does not cost hearts');
  assert.equal(ready.targets.length, 1);
  assert.equal(ready.targets[0].deliveryPending, true, 'the first target cannot expire before delivery');
  assert.equal((await ask(a, 'ready-patrol-target', { runToken: waiting.runToken, targetId: ready.targets[0].id })).success, false, 'ready cannot be forged at spawn');
  assert.equal((await ask(a, 'hit-patrol-target', { runToken: waiting.runToken, targetId: ready.targets[0].id })).success, false, 'unconfirmed target cannot score');
  const pending = waitingRun.targets.get(ready.targets[0].id);
  pending.offeredAt -= 8000;
  pending.readyBy = Date.now() + 2000;
  await ask(a, 'hit-patrol-target', { runToken: waiting.runToken, targetId: 'missing' });
  assert.equal(waitingRun.hearts, 3, 'unconfirmed target cannot consume a heart after a delayed response');
  const delivered = await activate(a, waiting.runToken, ready.targets[0]);
  assert.equal(delivered.success, true);
  assert.equal(delivered.targets[0].deliveryPending, false);
  assert.ok(delivered.targets[0].expiresAt > delivered.serverTime, 'the delivered target gets its playable lifetime');
  assert.equal((await ask(a, 'finish-patrol-run', { runToken: waiting.runToken, score: 999999 })).score, 0);

  const idleStart = await ask(a, 'start-patrol-run');
  const idleRun = social.patrolRuns.get(idleStart.runToken);
  idleRun.pausedAt -= 300001;
  const writesBeforeIdle = saved.length;
  assert.equal((await ask(a, 'resume-patrol-run', { runToken: idleStart.runToken })).success, false, 'initial readiness wait expires after five minutes');
  assert.equal(saved.length, writesBeforeIdle, 'expired initial wait never settles a score');
  assert.equal(social.patrolRuns.has(idleStart.runToken), false);

  const start = await startReady(a);
  assert.equal(start.success, true, 'signed-in players can start a server-owned run');
  assert.equal(start.targets.length, 1, 'server supplies the initial target');
  assert.equal((await ask(sameAccount, 'start-patrol-run')).success, false, 'one account cannot hold multiple runs');
  const { runToken, targets: [target] } = start;
  assert.equal((await ask(b, 'hit-patrol-target', { runToken, targetId: target.id })).success, false, 'another socket cannot hit a run');
  assert.equal((await ask(a, 'hit-patrol-target', { runToken, targetId: 'invented' })).success, false, 'invented target is rejected');
  assert.ok(target.actionableAt > target.spawnedAt, 'the server publishes the actionable time');
  const hit = await ask(a, 'hit-patrol-target', { runToken, targetId: target.id, points: 999999 });
  assert.equal(hit.success, true);
  assert.equal(hit.score, 125, 'server awards the actual target value');
  assert.equal((await ask(a, 'hit-patrol-target', { runToken, targetId: target.id })).success, false, 'a replayed hit is rejected');
  const end = await ask(a, 'finish-patrol-run', { runToken, score: 999999, misses: 0 });
  assert.equal(end.score, 125, 'submission cannot inflate score');
  assert.equal(saved.at(-1).score, 125);
  assert.equal(saved.at(-1).settlementId, runToken, 'the run token and score enter the durable award journal together');
  assert.equal(saved.at(-1).cleanRun, false);
  assert.ok(achievements.includes('patrol-rookie'));
  assert.ok(!achievements.includes('clean-run'), 'early exit does not award clean-run');
  const savesAfterFirstFinish = saved.length;
  const awardsAfterFirstFinish = achievements.length;
  assert.deepEqual(await ask(a, 'finish-patrol-run', { runToken, score: 999999 }), end, 'same-socket finish retry returns original result');
  assert.deepEqual(await ask(sameAccount, 'finish-patrol-run', { runToken }), end, 'same account may retry after reconnect');
  assert.equal((await ask(b, 'finish-patrol-run', { runToken })).success, false, 'another account cannot retrieve a result');
  assert.equal(saved.length, savesAfterFirstFinish, 'retry does not record twice');
  assert.equal(achievements.length, awardsAfterFirstFinish, 'retry does not re-award');

  // A persisted unlock whose account mirror and rollback both fail must be
  // retried by the server queue; a successful patrol finish is not contingent
  // on the client resending finish-patrol-run.
  const awardRecoveryStart = await startReady(b);
  const awardRecoveryTarget = awardRecoveryStart.targets[0];
  await ask(b, 'hit-patrol-target', { runToken: awardRecoveryStart.runToken, targetId: awardRecoveryTarget.id });
  failNextAchievementSave = true;
  failNextAchievementRollback = true;
  const awardRecoveryEnd = await ask(b, 'finish-patrol-run', { runToken: awardRecoveryStart.runToken });
  assert.equal(awardRecoveryEnd.success, true);
  const recoveredAwardKey = 'b:patrol-rookie';
  assert.equal(achievementUnlocks.has(recoveredAwardKey), true, 'rollback failure leaves a durable source unlock');
  assert.equal(achievementMirrors.has(recoveredAwardKey), false, 'the initial mirror write failed');
  const retryTimer = achievementRetryTimers.find(timer => timer.delay === 1000 && !timer.cleared && !timer.fired);
  assert.ok(retryTimer, 'the failed patrol achievement has a bounded server retry scheduled');
  retryTimer.callback();
  assert.equal(achievementMirrors.has(recoveredAwardKey), true, 'the queued retry repairs the account mirror without client replay');
  assert.deepEqual(await ask(b, 'finish-patrol-run', { runToken: awardRecoveryStart.runToken }), awardRecoveryEnd);

  const c = await client('c');
  const purgedStart = await startReady(c);
  await ask(c, 'hit-patrol-target', { runToken: purgedStart.runToken, targetId: purgedStart.targets[0].id });
  failNextAchievementUnlock = true;
  assert.equal((await ask(c, 'finish-patrol-run', { runToken: purgedStart.runToken })).success, true);
  const purgedRetry = achievementRetryTimers.find(timer => timer.delay === 1000 && !timer.cleared && !timer.fired);
  assert.ok(purgedRetry, 'a transient unlock-store failure schedules retry');
  accounts.delete('c');
  const unlocksBeforePurgedRetry = achievementUnlocks.size;
  purgedRetry.callback();
  assert.equal(achievementUnlocks.size, unlocksBeforePurgedRetry, 'a retry does not create an achievement for a purged account');

  const retrySocket = await client('a');
  const retryStart = await startReady(retrySocket);
  const retryRun = social.patrolRuns.get(retryStart.runToken);
  retryRun.targets.get(retryStart.targets[0].id).actionableAt = Date.now();
  await ask(retrySocket, 'hit-patrol-target', { runToken: retryStart.runToken, targetId: retryStart.targets[0].id });
  const savesBeforeRetry = saved.length;
  const awardsBeforeRetry = achievements.length;
  failNextPatrolSave = true;
  assert.equal((await ask(retrySocket, 'finish-patrol-run', { runToken: retryStart.runToken })).success, false);
  assert.equal(social.patrolRuns.has(retryStart.runToken), true, 'failed settlement retains the run');
  assert.equal(retryRun.ended, true, 'failed settlement freezes play');
  retrySocket.disconnect();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await ask(b, 'finish-patrol-run', { runToken: retryStart.runToken })).success, false);
  const retryEnd = await ask(a, 'finish-patrol-run', { runToken: retryStart.runToken });
  assert.equal(retryEnd.score, 125);
  assert.deepEqual(await ask(a, 'finish-patrol-run', { runToken: retryStart.runToken }), retryEnd);
  assert.equal(saved.length, savesBeforeRetry + 1, 'retry saves exactly once');
  assert.equal(achievements.length, awardsBeforeRetry, 'retrying a score does not re-award already unlocked achievements');

  const lostSender = await client('a');
  const lost = await startReady(lostSender);
  social.patrolRuns.get(lost.runToken).targets.get(lost.targets[0].id).actionableAt = Date.now();
  await ask(lostSender, 'hit-patrol-target', { runToken: lost.runToken, targetId: lost.targets[0].id });
  const savedBeforeLost = saved.length;
  const sync = new Promise(resolve => lostSender.once('account-sync', resolve));
  lostSender.emit('finish-patrol-run', { runToken: lost.runToken });
  await sync;
  lostSender.disconnect();
  const reconnected = await client('a');
  const lostResult = await ask(reconnected, 'finish-patrol-run', { runToken: lost.runToken });
  assert.equal(lostResult.success, true, 'lost first acknowledgement can be recovered on another authenticated socket');
  assert.equal(lostResult.score, 125);
  assert.equal(saved.length, savedBeforeLost + 1, 'lost acknowledgement retry records once');
  social.completedPatrolRuns.get(lost.runToken).completedAt -= 300001;
  assert.equal((await ask(sameAccount, 'finish-patrol-run', { runToken: lost.runToken })).success, false, 'expired cached result cannot be retried');

  const revoked = await startReady(a);
  accounts.delete('a');
  assert.equal((await ask(a, 'finish-patrol-run', { runToken: revoked.runToken })).success, false, 'revoked account cannot settle a retained run');
  accounts.set('a', { id: 'a' });

  const paused = await startReady(a);
  const pauseAck = await ask(a, 'pause-patrol-run', { runToken: paused.runToken });
  assert.equal(pauseAck.paused, true);
  assert.equal((await ask(a, 'hit-patrol-target', { runToken: paused.runToken, targetId: paused.targets[0].id })).success, false, 'hits while paused are rejected');
  const resumeAck = await ask(a, 'resume-patrol-run', { runToken: paused.runToken });
  assert.equal(resumeAck.paused, false);
  assert.ok(resumeAck.targets[0].expiresAt >= paused.targets[0].expiresAt, 'resume preserves target lifetime');
  const pauseRun = social.patrolRuns.get(paused.runToken);
  pauseRun.pausedTotal = 299900;
  pauseRun.pausedAt = Date.now() - 101;
  assert.equal((await ask(a, 'pause-patrol-run', { runToken: paused.runToken })).success, false, 'stale pause expires on any action');
  assert.equal((await ask(a, 'resume-patrol-run', { runToken: paused.runToken })).success, false, 'expired pause cannot resume');
  assert.equal(social.patrolRuns.has(paused.runToken), false);

  const expiredStart = await startReady(a);
  await ask(a, 'pause-patrol-run', { runToken: expiredStart.runToken });
  const expiredRun = social.patrolRuns.get(expiredStart.runToken);
  expiredRun.pausedTotal = 299900;
  expiredRun.pausedAt = Date.now() - 101;
  const savesBeforeExpiry = saved.length;
  assert.equal((await ask(a, 'finish-patrol-run', { runToken: expiredStart.runToken })).success, false, 'finish checks cumulative pause expiry even before its timer runs');
  assert.equal(saved.length, savesBeforeExpiry, 'expired paused runs are not settled');
  assert.equal(social.patrolRuns.has(expiredStart.runToken), false);

  const validPaused = await startReady(a);
  const validPausedRun = social.patrolRuns.get(validPaused.runToken);
  validPausedRun.targets.get(validPaused.targets[0].id).actionableAt = Date.now();
  await ask(a, 'hit-patrol-target', { runToken: validPaused.runToken, targetId: validPaused.targets[0].id });
  await ask(a, 'pause-patrol-run', { runToken: validPaused.runToken });
  const validPausedEnd = await ask(a, 'finish-patrol-run', { runToken: validPaused.runToken, score: 999999 });
  assert.equal(validPausedEnd.score, 125, 'finishing a valid paused run settles only the earned score');
  assert.ok(!achievements.includes('clean-run'), 'early exit does not grant clean-run');

  const long = await startReady(a);
  const longRun = social.patrolRuns.get(long.runToken);
  longRun.startedAt -= 631000;
  const longResult = await ask(a, 'finish-patrol-run', { runToken: long.runToken });
  assert.equal(longResult.success, true, 'a run older than 10m30s settles');
  const graceStart = await startReady(a);
  const graceTarget = social.patrolRuns.get(graceStart.runToken).targets.get(graceStart.targets[0].id);
  graceTarget.actionableAt = Date.now() - 2000;
  graceTarget.expiresAt = Date.now() - 100;
  assert.equal((await ask(a, 'hit-patrol-target', { runToken: graceStart.runToken, targetId: graceTarget.id })).success, true, 'late arrival inside latency grace is accepted');
  await ask(a, 'finish-patrol-run', { runToken: graceStart.runToken });
  const cleanStart = await startReady(a);
  const cleanRun = social.patrolRuns.get(cleanStart.runToken);
  cleanRun.targets.get(cleanStart.targets[0].id).actionableAt = Date.now();
  await ask(a, 'hit-patrol-target', { runToken: cleanStart.runToken, targetId: cleanStart.targets[0].id });
  for (let index = 1; index < 8; index += 1) {
    cleanRun.waveStartedAt = Date.now() - index * 3000;
    await ask(a, 'hit-patrol-target', { runToken: cleanStart.runToken, targetId: 'missing' });
    const nextTarget = [...cleanRun.targets.values()].find(entry => entry.wave === 1);
    await activate(a, cleanStart.runToken, nextTarget);
    assert.equal((await ask(a, 'hit-patrol-target', { runToken: cleanStart.runToken, targetId: nextTarget.id })).success, true);
  }
  cleanRun.waveEndsAt = Date.now() - 1;
  await ask(a, 'hit-patrol-target', { runToken: cleanStart.runToken, targetId: 'missing' });
  assert.equal(cleanRun.wave, 2);
  const waveTwoTarget = [...cleanRun.targets.values()][0];
  await activate(a, cleanStart.runToken, waveTwoTarget);
  cleanRun.hearts = 1;
  waveTwoTarget.expiresAt = Date.now() - 251;
  await ask(a, 'hit-patrol-target', { runToken: cleanStart.runToken, targetId: 'missing' });
  assert.equal(cleanRun.ended, true);
  await ask(a, 'finish-patrol-run', { runToken: cleanStart.runToken, misses: 0 });
  assert.ok(achievements.includes('clean-run'), 'a clean completed wave earns clean-run even after later game-over');

  achievements.length = 0;
  const earlyAfterWave = await startReady(a);
  social.patrolRuns.get(earlyAfterWave.runToken).clearedCleanWave = true;
  await ask(a, 'finish-patrol-run', { runToken: earlyAfterWave.runToken });
  assert.ok(!achievements.includes('clean-run'), 'finishing early after a clean wave does not qualify');
  const failedStart = await startReady(a);
  const failedRun = social.patrolRuns.get(failedStart.runToken);
  failedRun.targets.get(failedStart.targets[0].id).expiresAt = Date.now() - 251;
  await ask(a, 'hit-patrol-target', { runToken: failedStart.runToken, targetId: 'missing' });
  failedRun.spawnIndex = 8;
  failedRun.waveEndsAt = Date.now() - 1;
  await ask(a, 'hit-patrol-target', { runToken: failedStart.runToken, targetId: 'missing' });
  failedRun.hearts = 1;
  const failedWaveTwo = [...failedRun.targets.values()][0];
  await activate(a, failedStart.runToken, failedWaveTwo);
  failedWaveTwo.expiresAt = Date.now() - 251;
  await ask(a, 'hit-patrol-target', { runToken: failedStart.runToken, targetId: 'missing' });
  await ask(a, 'finish-patrol-run', { runToken: failedStart.runToken, misses: 0 });
  assert.ok(!achievements.includes('clean-run'), 'a missed first wave and forged misses do not qualify');

  const scoreStart = await startReady(a);
  const scoreRun = social.patrolRuns.get(scoreStart.runToken);
  scoreRun.score = 99900;
  scoreRun.targets.get(scoreStart.targets[0].id).actionableAt = Date.now();
  const highHit = await ask(a, 'hit-patrol-target', { runToken: scoreStart.runToken, targetId: scoreStart.targets[0].id });
  assert.equal(highHit.score, 100025, 'server score continues beyond 100000');
  assert.equal((await ask(a, 'finish-patrol-run', { runToken: scoreStart.runToken })).score, 100025);

  const missStart = await startReady(a);
  const missRun = social.patrolRuns.get(missStart.runToken);
  missRun.targets.get(missStart.targets[0].id).expiresAt = Date.now() - 251;
  await ask(a, 'hit-patrol-target', { runToken: missStart.runToken, targetId: missStart.targets[0].id });
  const missEnd = await ask(a, 'finish-patrol-run', { runToken: missStart.runToken, misses: 0 });
  assert.equal(missEnd.misses, 1, 'server records missed aircraft despite forged misses');

  const rateRun = await startReady(a);
  let limited = false;
  for (let index = 0; index < 100; index += 1) {
    const response = await ask(a, 'hit-patrol-target', { runToken: rateRun.runToken, targetId: 'missing' });
    if (response.error?.includes('Too many patrol actions')) { limited = true; break; }
  }
  assert.ok(limited, 'excess action traffic is throttled');
  assert.equal((await ask(a, 'finish-patrol-run', { runToken: rateRun.runToken })).success, true, 'throttling never blocks ending a run');

  const dir = fs.mkdtempSync(path.join(process.cwd(), 'patrol-test-'));
  const storePath = path.join(dir, 'accounts.json');
  try {
    const store = new AccountStore(storePath);
    store.register({ username: 'legacy', displayName: 'Legacy', password: 'hunter2hunter2' });
    store.register({ username: 'verified', displayName: 'Verified', password: 'hunter2hunter2' });
    const legacy = store.accounts.get('legacy');
    const verified = store.accounts.get('verified');
    legacy.stats.patrolBest = 90000;
    legacy.stats.patrolAceRuns = 4;
    verified.stats.patrolBest = 80000;
    verified.stats.patrolAceRuns = 5;
    store.recordPatrolResult(verified.id, { score: 100025, misses: 0 });
    assert.equal(verified.stats.patrolBest, 80000, 'legacy best is preserved');
    assert.equal(verified.stats.patrolAceRuns, 5, 'legacy ace history is preserved');
    assert.equal(verified.stats.patrolVerifiedBest, 100025);
    assert.deepEqual(store.getLeaderboard('patrol').map(row => [row.username, row.value]), [['verified', 100025]], 'leaderboard excludes unverified scores');
    const reloaded = new AccountStore(storePath);
    assert.equal(reloaded.accounts.get('verified').stats.patrolVerifiedBest, 100025, 'verified provenance survives reload');
    assert.equal(reloaded.accounts.get('verified').stats.patrolBest, 80000, 'legacy score survives reload');
  } finally {
    // Backup writes can leave <store>.<pid>.<id>.tmp files behind; remove the whole directory.
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const offerStart = await ask(b, 'start-patrol-run');
  const offerResume = await ask(b, 'resume-patrol-run', { runToken: offerStart.runToken });
  const offer = offerResume.targets[0];
  const pauseOffer = await ask(b, 'pause-patrol-run', { runToken: offerStart.runToken });
  assert.equal(pauseOffer.paused, true);
  assert.equal((await ask(b, 'ready-patrol-target', { runToken: offerStart.runToken, targetId: offer.id })).success, false, 'paused offers cannot activate');
  const resumeOffer = await ask(b, 'resume-patrol-run', { runToken: offerStart.runToken });
  assert.ok(resumeOffer.targets[0].readyBy >= offer.readyBy, 'pause preserves the offer delivery window');
  const offerRun = social.patrolRuns.get(offerStart.runToken);
  offerRun.targets.get(offer.id).offeredAt = Date.now() - Math.ceil(offer.duration * 0.16);
  b.emit('ready-patrol-target', { runToken: offerStart.runToken, targetId: offer.id });
  const duplicateReady = await ask(b, 'ready-patrol-target', { runToken: offerStart.runToken, targetId: offer.id });
  assert.equal(duplicateReady.success, true, 'lost ready acknowledgement can be retried');
  const activated = duplicateReady.targets.find(entry => entry.id === offer.id);
  const repeatedReady = await ask(b, 'ready-patrol-target', { runToken: offerStart.runToken, targetId: offer.id });
  assert.equal(repeatedReady.targets.find(entry => entry.id === offer.id).expiresAt, activated.expiresAt, 'duplicate ready does not extend target life');
  assert.equal((await ask(b, 'hit-patrol-target', { runToken: offerStart.runToken, targetId: offer.id })).score, 125);
  assert.equal((await ask(b, 'ready-patrol-target', { runToken: offerStart.runToken, targetId: offer.id })).success, false, 'resolved target cannot reactivate');
  await ask(b, 'finish-patrol-run', { runToken: offerStart.runToken });

  const timeoutStart = await startReady(b);
  await ask(b, 'hit-patrol-target', { runToken: timeoutStart.runToken, targetId: timeoutStart.targets[0].id });
  const timeoutRun = social.patrolRuns.get(timeoutStart.runToken);
  timeoutRun.clearedCleanWave = true;
  timeoutRun.waveStartedAt = Date.now() - 3000;
  await ask(b, 'hit-patrol-target', { runToken: timeoutStart.runToken, targetId: 'missing' });
  const timeoutOffer = [...timeoutRun.targets.values()][0];
  timeoutOffer.readyBy = Date.now() - 1;
  const awardCountBeforeTimeout = achievements.filter(id => id === 'clean-run').length;
  const networkNotice = new Promise(resolve => b.once('patrol-state', resolve));
  await ask(b, 'ready-patrol-target', { runToken: timeoutStart.runToken, targetId: timeoutOffer.id });
  const networkEnd = await networkNotice;
  assert.equal(networkEnd.endReason, 'delivery-timeout');
  assert.equal(networkEnd.hearts, 3, 'delivery timeout costs no heart');
  assert.equal((await ask(b, 'finish-patrol-run', { runToken: timeoutStart.runToken })).score, 125, 'network interruption retains earned score');
  assert.equal(achievements.filter(id => id === 'clean-run').length, awardCountBeforeTimeout, 'network interruption never earns clean-run');

  const cleanup = await startReady(b);
  b.disconnect();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(social.patrolRuns.has(cleanup.runToken), false, 'disconnect removes the run and its timer');
  console.log('PASS authoritative patrol socket scoring and replay protection');
} finally {
  clients.forEach(socket => socket.disconnect());
  await new Promise(resolve => io.close(resolve));
}
