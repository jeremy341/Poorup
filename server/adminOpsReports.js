// Read models for /admin/ops/*. Pure functions over numbers the caller measured:
// nothing here reads the clock, the filesystem or a socket. A value the server
// cannot know is null, never a guess, and no payload carries a room code, a
// nickname, an account id or chat.
import crypto from 'node:crypto';
import { MIN_PERCENTILE_SAMPLES } from './metricsRegistry.js';
import { buildBots, normalizeAnalyticsQuery } from './analyticsProjection.js';

// ---- status ---------------------------------------------------------------
//
// Check thresholds (all counters are since the process started):
//   backup    ok      latest run succeeded, no failures, not overdue
//             warn    latest run succeeded but earlier runs failed, or the last
//                     run is older than two intervals plus a minute
//             bad     the latest run failed
//             unknown no backup directory configured
//   errors    ok      no unhandled server errors
//             warn    some errors
//             bad     5 or more errors and at least 5% of handled actions
//             unknown the registry has nothing to read
//   restore   ok      0 eligible room-session restore failures recorded
//             bad     1 or more
//             unknown the runtime counter is unavailable
//   latency   ok      P95 under 250 ms
//             warn    under 1000 ms
//             bad     1000 ms or more
//             unknown fewer than MIN_PERCENTILE_SAMPLES handled actions
//   storage   ok      stores loaded, analytics rollup loaded, data directory set
//             warn    no data directory (nothing is saved across restarts) or a
//                     growing queue of unsaved analytics writes
//             bad     stores or the analytics rollup are not loaded
// Overall:
//   down      storage is bad, or both errors and latency are bad
//   degraded  any other check is warn/bad, or new rounds are paused (draining
//             or maintenance)
//   healthy   otherwise. "unknown" never lowers the verdict: it is missing
//             information, not a failure.
export const LATENCY_WARN_MS = 250;
export const LATENCY_BAD_MS = 1000;
export const ERROR_BAD_COUNT = 5;
export const ERROR_BAD_RATE = 0.05;
export const PENDING_WRITES_WARN = 50;

function check(id, label, state, detail) {
  return { id, label, state, detail };
}

function minutesAgo(iso, nowMs) {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, Math.round((nowMs - at) / 60_000)) : null;
}

function backupCheck(backup, intervalMs, nowMs) {
  const label = 'Backups';
  if (!backup?.configured) return check('backup', label, 'unknown', 'No backup directory is configured on this server.');
  const failures = Math.max(0, Number(backup.failures) || 0);
  if (!backup.fresh) return check('backup', label, 'bad', `The latest backup run failed (${failures} failed run${failures === 1 ? '' : 's'} since start).`);
  const age = minutesAgo(backup.lastRunAt, nowMs);
  const overdue = Number.isFinite(intervalMs) && intervalMs > 0 && age !== null && age * 60_000 > intervalMs * 2 + 60_000;
  if (overdue) return check('backup', label, 'warn', `The last backup ran ${age} minutes ago, later than expected.`);
  if (failures > 0) return check('backup', label, 'warn', `The latest run succeeded; ${failures} earlier run${failures === 1 ? '' : 's'} failed since start.`);
  return check('backup', label, 'ok', age === null ? 'Backups are fresh.' : `Last backup ${age} minute${age === 1 ? '' : 's'} ago.`);
}

function errorsCheck(metrics) {
  const label = 'Server errors';
  if (!metrics) return check('errors', label, 'unknown', 'No runtime counters are available.');
  const { errorCount, actionCount } = metrics;
  // The handled-action counter only counts socket actions, so the error rate
  // has to count socket errors as well: HTTP errors would otherwise be
  // divided by socket actions and report a rate the table never had.
  const socketErrors = Number.isFinite(metrics.socketErrorCount) ? metrics.socketErrorCount : errorCount;
  if (socketErrors === 0) return check('errors', label, 'ok', `No unhandled errors in ${actionCount} handled action${actionCount === 1 ? '' : 's'} since start.`);
  const rate = socketErrors / Math.max(actionCount, socketErrors);
  const bad = socketErrors >= ERROR_BAD_COUNT && rate >= ERROR_BAD_RATE;
  return check('errors', label, bad ? 'bad' : 'warn', `${socketErrors} unhandled error${socketErrors === 1 ? '' : 's'} in ${actionCount} handled action${actionCount === 1 ? '' : 's'} since start.`);
}

function restoreCheck(metrics) {
  const label = 'Room restores';
  if (metrics?.restoreFailures == null) return check('restore', label, 'unknown', 'Room restore failure counter is unavailable.');
  if (metrics.restoreFailures === 0) return check('restore', label, 'ok', 'No eligible room restore failures since start.');
  return check('restore', label, 'bad', `${metrics.restoreFailures} room restore failure${metrics.restoreFailures === 1 ? '' : 's'} since start.`);
}

function latencyCheck(metrics) {
  const label = 'Action latency';
  const samples = metrics?.latencySamples ?? 0;
  const p95 = metrics?.latencyP95Ms ?? null;
  if (p95 === null) return check('latency', label, 'unknown', `Not enough handled actions yet (${samples} of ${MIN_PERCENTILE_SAMPLES}).`);
  const detail = `P95 ${Math.round(p95)} ms over the last ${samples} actions.`;
  if (p95 >= LATENCY_BAD_MS) return check('latency', label, 'bad', detail);
  if (p95 >= LATENCY_WARN_MS) return check('latency', label, 'warn', detail);
  return check('latency', label, 'ok', detail);
}

function storageCheck(storage) {
  const label = 'Storage';
  if (!storage?.storesLoaded) return check('storage', label, 'bad', 'Account and match stores are not loaded.');
  if (storage.rollup && storage.rollup.loaded === false) return check('storage', label, 'bad', 'The analytics rollup is not loaded.');
  if (!storage.dataDirectory) return check('storage', label, 'warn', 'No data directory is set: nothing is saved across restarts.');
  const pending = Math.max(0, Number(storage.rollup?.pendingWrites) || 0);
  if (pending > PENDING_WRITES_WARN) return check('storage', label, 'warn', `${pending} analytics writes are waiting to be saved.`);
  return check('storage', label, 'ok', 'Stores are loaded and saving.');
}

function overallState(checks, maintenance) {
  const byId = Object.fromEntries(checks.map(item => [item.id, item.state]));
  if (byId.storage === 'bad') return 'down';
  if (byId.errors === 'bad' && byId.latency === 'bad') return 'down';
  if (checks.some(item => item.state === 'bad' || item.state === 'warn')) return 'degraded';
  if (maintenance && maintenance.mode !== 'normal') return 'degraded';
  return 'healthy';
}

// A counter nothing has incremented yet is null ("not recorded yet"), not zero.
function sinceStart(metrics, name) {
  const value = metrics?.[name];
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Math.max(0, Math.floor(Number(value)));
}

// operatorPassword says only whether POORUP_MAINTENANCE_PASSWORD is set; this
// view is admin-only, so the public site never learns it from here.
function maintenanceView(snapshot, operatorPassword = false) {
  return {
    mode: snapshot?.mode || 'normal',
    lockout: snapshot?.mode === 'maintenance' && snapshot?.lockout === true,
    message: snapshot?.message || '',
    releaseId: snapshot?.releaseId || '',
    drainDeadline: snapshot?.drainDeadline || null,
    activeRounds: Math.max(0, Number(snapshot?.activeRounds) || 0),
    operatorPassword: operatorPassword === true,
  };
}

export function buildOpsStatus({ now = Date.now(), runtime = {}, metrics = null, backup = null, backupIntervalMs = null, storage = {}, maintenance = null, operatorPassword = false } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const checks = [
    backupCheck(backup, backupIntervalMs, nowMs),
    errorsCheck(metrics),
    restoreCheck(metrics),
    latencyCheck(metrics),
    storageCheck(storage),
  ];
  const view = maintenanceView(maintenance, operatorPassword);
  return {
    success: true,
    generatedAt: new Date(nowMs).toISOString(),
    health: {
      state: overallState(checks, view),
      checks,
      uptimeSeconds: Math.max(0, Math.floor(Number(runtime.uptimeSeconds) || 0)),
      sockets: Math.max(0, Math.floor(Number(runtime.sockets) || 0)),
      rooms: Math.max(0, Math.floor(Number(runtime.rooms) || 0)),
      activeRounds: Math.max(0, Math.floor(Number(runtime.activeRounds) || 0)),
      backup: {
        configured: backup?.configured === true,
        fresh: backup?.configured ? backup.fresh === true : null,
        lastRunAt: backup?.lastRunAt || null,
        failures: Math.max(0, Number(backup?.failures) || 0),
      },
      errorCount: metrics ? metrics.errorCount : null,
      restoreFailures: metrics ? metrics.restoreFailures : null,
      roomReconnects: sinceStart(metrics, 'roomReconnects'),
      botFallbacks: sinceStart(metrics, 'botFallbacks'),
      latencyP95Ms: metrics ? metrics.latencyP95Ms : null,
    },
    maintenance: view,
  };
}

// ---- rooms ----------------------------------------------------------------
//
// phase       lobby     the round has not started and no round has ended here
//             playing   a round is running
//             finished  a round ended and the room has not started another
// idleSeconds seconds since the room's progress signature last changed (a roll,
//             a human action, a bot decision, a new round or turn, a trade or
//             auction finishing, a seat joining or leaving, a new feed line)
// ageSeconds  seconds since the room was first seen by the activity sweep, which
//             runs every few seconds, so it is accurate to that interval
// stalled     playing and idle for STALLED_AFTER_SECONDS or longer. A lobby
//             waiting for players or a finished table is not stalled.
export const STALLED_AFTER_SECONDS = 300;
export const ROOM_LIST_LIMIT = 200;

function progressSignature(room) {
  const game = room?.game || {};
  return [
    game.started === true, game.roundNumber, game.currentPlayerId, game.diceRollSequence,
    game.botDecisionSequence, game.humanActionCount, game.tradesCompleted, game.auctionsCompleted,
    Boolean(game.pendingTrade), Boolean(game.auction), game.feed?.length, game.players?.length, game.lastEndReason,
  ].join('|');
}

/**
 * Remembers when each room was first seen and when its progress last changed.
 * Rooms carry no creation timestamp of their own, so the server calls observe()
 * on a short timer. Entries are held weakly and vanish with the room.
 */
export function createRoomActivityTracker({ now = () => Date.now(), key = crypto.randomBytes(16) } = {}) {
  const seen = new WeakMap();

  function observeOne(room) {
    if (!room || room.destroyed) return null;
    const at = now();
    const signature = progressSignature(room);
    const record = seen.get(room);
    if (!record) {
      const fresh = { firstSeenAt: at, changedAt: at, signature };
      seen.set(room, fresh);
      return fresh;
    }
    if (record.signature !== signature) { record.signature = signature; record.changedAt = at; }
    return record;
  }

  function observe(rooms) {
    for (const room of rooms) observeOne(room);
  }

  // A one-way, per-process id. The key is random and never leaves this closure,
  // so the id cannot be turned back into (or checked against) a room code.
  function idFor(room) {
    const digest = crypto.createHmac('sha256', key).update(String(room?.roomCode || ''), 'utf8').digest('hex');
    return `r-${digest.slice(0, 6)}`;
  }

  return Object.freeze({ idFor, observe, timings: observeOne });
}

function roomPhase(room) {
  const game = room.game || {};
  if (game.started) return 'playing';
  return game.lastEndReason ? 'finished' : 'lobby';
}

export function buildOpsRooms({ rooms = [], tracker, now = Date.now(), metrics = null } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const totals = { rooms: 0, lobby: 0, playing: 0, humans: 0, bots: 0 };
  const items = [];
  for (const room of rooms) {
    if (!room || room.destroyed) continue;
    const timing = tracker.timings(room);
    const phase = roomPhase(room);
    const players = Array.isArray(room.game?.players) ? room.game.players : [];
    const humans = players.filter(player => !player.isBot && !player.disconnected).length;
    const bots = players.filter(player => player.isBot).length;
    const idleSeconds = Math.max(0, Math.floor((nowMs - timing.changedAt) / 1000));
    totals.rooms += 1;
    totals.humans += humans;
    totals.bots += bots;
    if (phase === 'lobby') totals.lobby += 1;
    if (phase === 'playing') totals.playing += 1;
    items.push({
      firstSeenAt: timing.firstSeenAt,
      row: {
        id: tracker.idFor(room),
        phase,
        visibility: room.visibility === 'private' ? 'private' : 'public',
        humans,
        bots,
        round: phase === 'playing' ? Math.max(0, Math.floor(Number(room.game.roundNumber) || 0)) : null,
        ageSeconds: Math.max(0, Math.floor((nowMs - timing.firstSeenAt) / 1000)),
        idleSeconds,
        stalled: phase === 'playing' && idleSeconds >= STALLED_AFTER_SECONDS,
      },
    });
  }
  items.reverse();
  items.sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  return {
    success: true,
    generatedAt: new Date(nowMs).toISOString(),
    totals,
    // Seats that came back inside their reconnect grace since the process started.
    sinceStart: { reconnects: sinceStart(metrics, 'roomReconnects') },
    rooms: items.slice(0, ROOM_LIST_LIMIT).map(item => item.row),
  };
}

// ---- bots -----------------------------------------------------------------
//
// What the rollup records per bot decision (see recordBotTelemetry in
// socketRuntime.js): the room's engine (botMode ai / no-ai), a decision count, a
// fallback flag and one match marker per match.
//   decisions  AI rooms: decisions the model was actually asked.
//              no-AI rooms: every house decision.
//   fallbacks  AI rooms only: asked, but the house engine answered instead
//              (timeout, quota, cooldown, missing key, budget). Deliberate house
//              policy (no-AI rooms, auction rules) never counts. null for
//              no-AI rooms, where there is nothing to fall back from.
//   matches    matches in which that engine decided at least once. A match
//              belongs to one engine, so the rows add up to botMatches.
// Totals decisions/fallbacks/fallbackRate cover AI rooms only; botMatches covers
// both. Rows with no recorded decisions or matches predate this recording and
// are left out rather than shown as zeros. Each match contributes at most its
// last 200 decisions, so sampleSize can undercount very long matches.
function providerView(status) {
  const reported = String(status?.provider?.state || '');
  const states = { healthy: 'healthy', open: 'cooldown', cooldown: 'cooldown', 'quota-exhausted': 'quota-exhausted', unconfigured: 'unconfigured' };
  const cap = Number(status?.active?.maxDecisionsPerGame ?? status?.provider?.budgetLimit);
  return {
    state: states[reported] || 'unknown',
    activeLabel: typeof status?.active?.label === 'string' && status.active.label ? status.active.label : null,
    capPerBot: Number.isFinite(cap) && cap > 0 ? cap : null,
  };
}

function rate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

export function buildOpsBots({ rollup, range = 'day', providerStatus = null, now = Date.now(), metrics = null } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const query = normalizeAnalyticsQuery({ range });
  const view = buildBots(rollup, query);
  const providers = (view.rows || [])
    .map((row) => {
      const decisions = Math.max(0, Number(row.fallbackRate?.denominator) || 0);
      const matches = Math.max(0, Number(row.matches) || 0);
      const aiRoom = row.botMode === 'ai';
      const fallbacks = aiRoom ? Math.max(0, Number(row.fallback) || 0) : null;
      return {
        provider: String(row.provider || 'unknown'),
        botMode: String(row.botMode || 'unknown'),
        matches,
        decisions,
        fallbacks,
        fallbackRate: aiRoom ? rate(fallbacks, decisions) : null,
        sampleSize: decisions,
      };
    })
    .filter(row => row.decisions > 0 || row.matches > 0);
  const aiRows = providers.filter(row => row.botMode === 'ai');
  const aiDecisions = aiRows.reduce((sum, row) => sum + row.decisions, 0);
  const aiFallbacks = aiRows.reduce((sum, row) => sum + (row.fallbacks || 0), 0);
  return {
    success: true,
    range: query.range,
    generatedAt: new Date(nowMs).toISOString(),
    totals: {
      botMatches: providers.reduce((sum, row) => sum + row.matches, 0),
      decisions: aiRows.length ? aiDecisions : null,
      fallbacks: aiRows.length ? aiFallbacks : null,
      fallbackRate: aiRows.length ? rate(aiFallbacks, aiDecisions) : null,
      sampleSize: aiDecisions,
    },
    providers,
    // AI decisions answered by the house engine since the process started (a live
    // counter; the windowed numbers above come from the rollup and survive restarts).
    sinceStart: { fallbacks: sinceStart(metrics, 'botFallbacks') },
    provider: providerView(providerStatus),
  };
}
