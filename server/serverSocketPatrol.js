// Parlor Patrol socket handlers: the server runs each run's schedule, targets and score; clients only report what they observed.
import crypto from 'crypto';
import { PARLOR_PATROL_ENABLED, PARLOR_PATROL_OFF_MESSAGE } from './accountStore.js';
import { reply } from './socketHandlerSupport.js';

export function registerPatrolSocketHandlers(on, socket, runtime, { restricted, accountDeletionPending }) {
  const { accountStore } = runtime;
  const { accountForSocket, allowSocialAction, completedPatrolResult, patrolAchievementCandidates, patrolRunError, prunePatrolRuns, patrolRuns, recordVerifiedAchievement, rememberCompletedPatrolResult } = runtime.social;

  // The server owns the schedule and each target's one-time outcome. Client
  // messages identify an observed target; they never supply score or misses.
  const PATROL_GRACE_MS = 250;
  const PATROL_EARLY_GRACE_MS = 150;
  const patrolActionTimes = [];

  function patrolRateAllowed(callback) {
    const now = Date.now();
    while (patrolActionTimes.length && now - patrolActionTimes[0] >= 10_000) patrolActionTimes.shift();
    if (patrolActionTimes.length >= 80) { reply(callback, { success: false, error: 'Too many patrol actions. Try again shortly.' }); return false; }
    patrolActionTimes.push(now);
    return true;
  }
  const PATROL_PAUSE_LIMIT_MS = 5 * 60_000;
  const PATROL_END_RETENTION_MS = 5 * 60_000;

  socket.on?.('disconnect', () => {
    for (const [token, run] of patrolRuns) {
      if (run.socketId !== socket.id || run.settlementPending) continue;
      clearTimeout(run.timer);
      patrolRuns.delete(token);
    }
  });

  function patrolSnapshot(run) {
    return { runToken: run.token, revision: ++run.revision, serverTime: Date.now(),
      wave: run.wave, endsAt: run.waveEndsAt, score: run.score, hearts: run.hearts,
      misses: run.misses, targets: [...run.targets.values()], ended: run.ended, endReason: run.endReason || null, paused: run.pausedAt !== null };
  }

  function patrolPush(run) {
    if (patrolRuns.get(run.token) === run) socket.emit('patrol-state', patrolSnapshot(run));
  }

  function patrolTarget(run, at) {
    const roll = Math.random();
    let kind = 'helicopter';
    if (run.wave >= 4 && roll < 0.12) kind = 'airplane';
    else if (run.wave >= 3 && roll < 0.24) kind = 'beacon';
    else if ((run.wave >= 2 && roll < 0.44) || (run.wave === 1 && run.spawnIndex === 2)) kind = 'drone';
    const duration = kind === 'airplane' ? Math.max(2800, 5000 - run.wave * 180)
      : kind === 'drone' ? Math.max(3400, 5900 - run.wave * 220)
        : Math.max(4200, 7600 - run.wave * 260);
    const id = crypto.randomBytes(12).toString('base64url');
    const target = { id, kind, direction: run.sequence++ % 2 === 0 ? 'left' : 'right',
      lane: [18, 25, 32, 39, 46, 53, 60][Math.floor(Math.random() * 7)],
      duration, wave: run.wave, deliveryPending: true, offeredAt: at, readyBy: at + 10_000, spawnedAt: null, actionableAt: null, expiresAt: null };
    run.targets.set(id, target);
    const outcome = run.waveOutcomes.get(run.wave) || { pending: 0, missed: false };
    outcome.pending += 1;
    run.waveOutcomes.set(run.wave, outcome);
  }

  function patrolCloseWaves(run) {
    for (const [wave, outcome] of run.waveOutcomes) {
      if (wave >= run.wave || outcome.pending > 0) continue;
      if (!outcome.missed) run.clearedCleanWave = true;
      run.waveOutcomes.delete(wave);
    }
  }

  function patrolResolveTarget(run, target, missed) {
    const outcome = run.waveOutcomes.get(target.wave);
    if (!outcome) return;
    outcome.pending -= 1;
    if (missed) outcome.missed = true;
    patrolCloseWaves(run);
  }

  function patrolNextSpawn(run) {
    const count = Math.min(6 + run.wave * 2, 24);
    if (run.spawnIndex >= count) return Infinity;
    const interval = run.wave === 1 ? 3000 : Math.max(850, 5000 - run.wave * 220);
    return run.waveStartedAt + run.spawnIndex * interval;
  }

  // The moment a target next needs attention: its delivery deadline while
  // pending, otherwise its expiry plus the grace window.
  function patrolTargetDeadline(target) {
    return target.deliveryPending ? target.readyBy : target.expiresAt + PATROL_GRACE_MS;
  }

  function patrolNextExpiry(run) {
    let nextExpiry = Infinity;
    for (const target of run.targets.values()) nextExpiry = Math.min(nextExpiry, patrolTargetDeadline(target));
    return nextExpiry;
  }

  function endPatrolRun(run, at, reason) {
    run.ended = true;
    run.endedAt = at;
    run.endReason = reason;
  }

  function patrolAdvanceWave(run) {
    run.wave += 1;
    patrolCloseWaves(run);
    run.waveStartedAt = run.waveEndsAt;
    run.waveEndsAt += 60_000;
    run.spawnIndex = 0;
  }

  // Ends the run on the first undelivered target past its deadline, or resolves
  // each expired target as a miss and ends the run once hearts run out.
  function patrolExpireTargets(run, at) {
    for (const [id, target] of run.targets) {
      if (target.deliveryPending) {
        if (target.readyBy > at) continue;
        endPatrolRun(run, at, 'delivery-timeout');
        break;
      }
      if (target.expiresAt + PATROL_GRACE_MS > at) continue;
      run.targets.delete(id);
      patrolResolveTarget(run, target, true);
      if (target.kind !== 'beacon') { run.misses += 1; run.hearts -= 1; }
      if (run.hearts <= 0) {
        run.hearts = 0;
        endPatrolRun(run, at, 'no-hearts');
        break;
      }
    }
  }

  function patrolAdvance(run, now = Date.now()) {
    if (run.ended || run.pausedAt !== null) return false;
    let changed = false;
    while (!run.ended) {
      const nextSpawn = patrolNextSpawn(run);
      const nextExpiry = patrolNextExpiry(run);
      const next = Math.min(nextSpawn, nextExpiry, run.waveEndsAt);
      if (next > now) break;
      changed = true;
      if (next === nextExpiry) patrolExpireTargets(run, next);
      else if (next === run.waveEndsAt) patrolAdvanceWave(run);
      else {
        patrolTarget(run, nextSpawn);
        run.spawnIndex += 1;
      }
    }
    return changed;
  }

  function patrolArm(run) {
    clearTimeout(run.timer);
    if (patrolRuns.get(run.token) !== run) return;
    let due;
    if (run.ended) due = run.endedAt + PATROL_END_RETENTION_MS;
    else if (run.pausedAt !== null) due = run.pausedAt + PATROL_PAUSE_LIMIT_MS - (run.initialWaiting ? 0 : run.pausedTotal);
    else {
      due = Math.min(run.waveEndsAt, patrolNextSpawn(run));
      for (const target of run.targets.values()) due = Math.min(due, target.deliveryPending ? target.readyBy : target.expiresAt + PATROL_GRACE_MS);
    }
    run.timer = setTimeout(() => {
      if (patrolRuns.get(run.token) !== run) return;
      if (run.ended || run.pausedAt !== null) { patrolRuns.delete(run.token); return; }
      if (patrolAdvance(run)) patrolPush(run);
      patrolArm(run);
    }, Math.max(1, due - Date.now()));
    run.timer.unref?.();
  }

  // A pause that would push the run past its total allowance has expired.
  function patrolPauseExhausted(run, delta) {
    return (run.initialWaiting ? 0 : run.pausedTotal) + delta >= PATROL_PAUSE_LIMIT_MS;
  }

  // Moves every run clock forward by the paused interval so the run resumes where it stopped.
  function shiftPatrolClocks(run, delta) {
    run.waveStartedAt += delta;
    run.waveEndsAt += delta;
    for (const target of run.targets.values()) {
      target.offeredAt += delta;
      if (target.deliveryPending) target.readyBy += delta;
      else { target.spawnedAt += delta; target.actionableAt += delta; target.expiresAt += delta; }
    }
  }

  function patrolGet(payload, callback) {
    const account = accountForSocket(socket, payload);
    const token = String(payload.runToken || '').trim();
    const invalid = patrolRunError(socket.id, account, token);
    if (invalid) { reply(callback, { success: false, error: invalid }); return null; }
    // An account with a pending deletion takes no writes, and a patrol run ends in one (score, achievements).
    if (restricted(account)) { reply(callback, accountDeletionPending); return null; }
    const run = patrolRuns.get(token);
    const now = Date.now();
    const expiredPause = run.pausedAt !== null && (run.initialWaiting ? 0 : run.pausedTotal) + now - run.pausedAt >= PATROL_PAUSE_LIMIT_MS;
    const expiredEnd = run.ended && now - run.endedAt >= PATROL_END_RETENTION_MS;
    if (expiredPause || expiredEnd) {
      clearTimeout(run.timer);
      patrolRuns.delete(token);
      reply(callback, { success: false, error: 'That patrol run expired.' });
      return null;
    }
    return { account, run };
  }

  on('start-patrol-run', (payload = {}, callback) => {
    if (!PARLOR_PATROL_ENABLED) return reply(callback, { success: false, error: PARLOR_PATROL_OFF_MESSAGE });
    const account = accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, error: 'Sign in to sync Parlor Patrol achievements.' });
    if (restricted(account)) return reply(callback, accountDeletionPending);
    if (!allowSocialAction(account.id, 'patrol-run')) return reply(callback, { success: false, error: 'Too many patrol runs. Try again in a minute.' });
    prunePatrolRuns();
    for (const [token, previous] of patrolRuns) {
      if (previous.socketId === socket.id && !previous.settlementPending) { clearTimeout(previous.timer); patrolRuns.delete(token); }
    }
    if ([...patrolRuns.values()].some(run => run.accountId === account.id)) return reply(callback, { success: false, error: 'A patrol is already active on another connection.' });
    if (patrolRuns.size >= 2000) return reply(callback, { success: false, error: 'Patrol is busy. Try again shortly.' });
    const token = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    const run = { token, accountId: account.id, socketId: socket.id, startedAt: now, revision: 0,
      wave: 1, waveStartedAt: now, waveEndsAt: now + 60_000, spawnIndex: 0, sequence: 0,
      targets: new Map(), waveOutcomes: new Map(), clearedCleanWave: false, score: 0, hearts: 3, misses: 0, pausedAt: now, pausedTotal: 0, initialWaiting: true, ended: false };
    patrolRuns.set(token, run);
    patrolArm(run);
    return reply(callback, { success: true, ...patrolSnapshot(run) });
  });

  on('ready-patrol-target', (payload = {}, callback) => {
    if (!PARLOR_PATROL_ENABLED) return reply(callback, { success: false, error: PARLOR_PATROL_OFF_MESSAGE });
    if (!patrolRateAllowed(callback)) return;
    const context = patrolGet(payload, callback);
    if (!context) return;
    const { run } = context;
    if (patrolAdvance(run)) patrolPush(run);
    const target = run.targets.get(String(payload.targetId || ''));
    const now = Date.now();
    if (run.ended || run.pausedAt !== null || !target) {
      patrolArm(run);
      return reply(callback, { success: false, error: 'That target is no longer available.' });
    }
    if (target.deliveryPending) {
      const visibleAt = target.offeredAt + Math.round(target.duration * 0.16);
      if (now < visibleAt - PATROL_EARLY_GRACE_MS) return reply(callback, { success: false, error: 'That target is not ready yet.' });
      target.deliveryPending = false;
      target.spawnedAt = now - Math.round(target.duration * 0.16);
      target.actionableAt = now;
      target.expiresAt = target.spawnedAt + target.duration;
      target.readyBy = null;
    }
    patrolArm(run);
    return reply(callback, { success: true, ...patrolSnapshot(run) });
  });

  on('hit-patrol-target', (payload = {}, callback) => {
    if (!PARLOR_PATROL_ENABLED) return reply(callback, { success: false, error: PARLOR_PATROL_OFF_MESSAGE });
    if (!patrolRateAllowed(callback)) return;
    const context = patrolGet(payload, callback);
    if (!context) return;
    const { run } = context;
    if (patrolAdvance(run)) patrolPush(run);
    const target = run.targets.get(String(payload.targetId || ''));
    if (run.ended || run.pausedAt !== null || !target || target.deliveryPending || Date.now() < target.actionableAt - PATROL_EARLY_GRACE_MS || Date.now() > target.expiresAt + PATROL_GRACE_MS) {
      patrolArm(run);
      return reply(callback, { success: false, error: 'That target is no longer available.' });
    }
    run.targets.delete(target.id);
    patrolResolveTarget(run, target, false);
    const points = target.kind === 'helicopter' ? 100 + target.wave * 25
      : target.kind === 'drone' ? 75 + target.wave * 10
        : target.kind === 'airplane' ? 180 + target.wave * 20 : 50 + target.wave * 5;
    run.score = Math.min(Number.MAX_SAFE_INTEGER, run.score + points);
    const snapshot = patrolSnapshot(run);
    patrolArm(run);
    return reply(callback, { success: true, ...snapshot, targetId: target.id, outcome: 'hit', remainingHP: 0, points });
  });

  on('pause-patrol-run', (payload = {}, callback) => {
    if (!PARLOR_PATROL_ENABLED) return reply(callback, { success: false, error: PARLOR_PATROL_OFF_MESSAGE });
    if (!patrolRateAllowed(callback)) return;
    const context = patrolGet(payload, callback);
    if (!context) return;
    const { run } = context;
    patrolAdvance(run);
    if (!run.ended && run.pausedAt === null) {
      if (run.pausedTotal >= PATROL_PAUSE_LIMIT_MS) return reply(callback, { success: false, error: 'This patrol has used its pause time.' });
      run.pausedAt = Date.now();
    }
    patrolArm(run);
    return reply(callback, { success: true, ...patrolSnapshot(run) });
  });

  on('resume-patrol-run', (payload = {}, callback) => {
    if (!PARLOR_PATROL_ENABLED) return reply(callback, { success: false, error: PARLOR_PATROL_OFF_MESSAGE });
    if (!patrolRateAllowed(callback)) return;
    const context = patrolGet(payload, callback);
    if (!context) return;
    const { run } = context;
    if (run.pausedAt !== null) {
      const delta = Date.now() - run.pausedAt;
      if (patrolPauseExhausted(run, delta)) {
        clearTimeout(run.timer);
        patrolRuns.delete(run.token);
        return reply(callback, { success: false, error: 'That paused patrol run expired.' });
      }
      if (!run.initialWaiting) run.pausedTotal += delta;
      run.initialWaiting = false;
      shiftPatrolClocks(run, delta);
      run.pausedAt = null;
      patrolAdvance(run);
    }
    patrolArm(run);
    return reply(callback, { success: true, ...patrolSnapshot(run) });
  });

  on('finish-patrol-run', (payload = {}, callback) => {
    if (!PARLOR_PATROL_ENABLED) return reply(callback, { success: false, error: PARLOR_PATROL_OFF_MESSAGE });
    const retryAccount = accountForSocket(socket, payload);
    const retryToken = String(payload.runToken || '').trim();
    const completed = retryAccount && completedPatrolResult(retryAccount.id, retryToken);
    if (completed) return reply(callback, completed);
    const context = patrolGet(payload, callback);
    if (!context) return;
    const { account, run } = context;
    patrolAdvance(run);
    if (!run.ended) {
      run.ended = true;
      run.endedAt = Date.now();
      run.endReason = 'finished';
    }
    run.pausedAt = null;
    run.settlementPending = true;
    patrolArm(run);
    const cleanRun = run.hearts === 0 && run.clearedCleanWave;
    let result;
    try {
      result = accountStore.recordPatrolResult(account.id, {
        score: run.score,
        misses: run.misses,
        settlementId: run.token,
        cleanRun
      });
    } catch (error) {
      console.error('Patrol score settlement failed:', error?.message || 'unknown error');
      run.endedAt = Date.now();
      patrolArm(run);
      return reply(callback, { success: false, retryable: true, error: 'Could not save this patrol. Please try again.' });
    }
    if (!result.success) {
      if (result.retryable) {
        run.endedAt = Date.now();
        patrolArm(run);
        return reply(callback, result);
      }
      clearTimeout(run.timer);
      patrolRuns.delete(run.token);
      return reply(callback, result);
    }
    clearTimeout(run.timer);
    patrolRuns.delete(run.token);
    const candidates = patrolAchievementCandidates(account, run.score, { ...result, cleanRun });
    candidates.forEach(candidate => {
      try { recordVerifiedAchievement(candidate, `patrol_${run.token}`); }
      catch (error) { console.error('Patrol achievement settlement failed:', error?.message || 'unknown error'); }
    });
    try { runtime.social.reconcilePendingPatrolAchievementSettlements?.(account.id); }
    catch (error) { console.error('Patrol achievement journal reconciliation failed:', error?.message || 'unknown error'); }
    const response = { success: true, score: run.score, misses: run.misses, best: result.best, aceRuns: result.aceRuns };
    rememberCompletedPatrolResult(account.id, run.token, response);
    const snapshot = accountStore.getAccountSnapshot(account.id);
    if (snapshot) socket.emit('account-sync', { account: snapshot });
    return reply(callback, response);
  });
}
