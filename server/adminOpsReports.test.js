import assert from 'node:assert/strict';
import { buildOpsBots, buildOpsRooms, buildOpsStatus, createRoomActivityTracker, ROOM_LIST_LIMIT, STALLED_AFTER_SECONDS } from './adminOpsReports.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const NOW = Date.parse('2026-10-20T10:00:00.000Z');
const goodMetrics = { errorCount: 0, actionCount: 500, restoreFailures: null, latencyP95Ms: 12, latencySamples: 500, activeSockets: 4 };
const goodInputs = () => ({
  now: NOW,
  runtime: { uptimeSeconds: 3600.9, sockets: 4, rooms: 2, activeRounds: 1 },
  metrics: { ...goodMetrics },
  backup: { configured: true, fresh: true, lastRunAt: new Date(NOW - 5 * 60_000).toISOString(), failures: 0 },
  backupIntervalMs: 15 * 60_000,
  storage: { storesLoaded: true, dataDirectory: true, rollup: { loaded: true, pendingWrites: 0 } },
  maintenance: { mode: 'normal', message: '', releaseId: '', drainDeadline: null, activeRounds: 1 },
});
const stateOf = (status, id) => status.health.checks.find(item => item.id === id).state;

check('a healthy server reports healthy with every check explained', () => {
  const status = buildOpsStatus(goodInputs());
  assert.equal(status.success, true);
  assert.equal(status.generatedAt, '2026-10-20T10:00:00.000Z');
  assert.equal(status.health.state, 'healthy');
  assert.deepEqual(status.health.checks.map(item => item.id), ['backup', 'errors', 'restore', 'latency', 'storage']);
  status.health.checks.forEach((item) => {
    assert.equal(typeof item.label, 'string');
    assert.equal(typeof item.detail, 'string');
    assert.equal(['ok', 'warn', 'bad', 'unknown'].includes(item.state), true);
  });
  // Restores are not instrumented, so that check is unknown and the number is null.
  assert.equal(stateOf(status, 'restore'), 'unknown');
  assert.equal(status.health.restoreFailures, null);
  assert.equal(status.health.errorCount, 0);
  assert.equal(status.health.latencyP95Ms, 12);
  assert.equal(status.health.uptimeSeconds, 3600);
  assert.deepEqual([status.health.sockets, status.health.rooms, status.health.activeRounds], [4, 2, 1]);
  assert.deepEqual(status.health.backup, { configured: true, fresh: true, lastRunAt: new Date(NOW - 5 * 60_000).toISOString(), failures: 0 });
  assert.deepEqual(status.maintenance, { mode: 'normal', lockout: false, message: '', releaseId: '', drainDeadline: null, activeRounds: 1, operatorPassword: false });
});

check('backup thresholds: unconfigured is unknown, failed is bad, overdue or past failures warn', () => {
  const run = patch => buildOpsStatus({ ...goodInputs(), ...patch });
  const none = run({ backup: { configured: false, fresh: true, lastRunAt: null, failures: 0 } });
  assert.equal(stateOf(none, 'backup'), 'unknown');
  assert.equal(none.health.state, 'healthy');
  assert.equal(none.health.backup.fresh, null);
  const failed = run({ backup: { configured: true, fresh: false, lastRunAt: new Date(NOW).toISOString(), failures: 2 } });
  assert.equal(stateOf(failed, 'backup'), 'bad');
  assert.equal(failed.health.state, 'degraded');
  assert.equal(stateOf(run({ backup: { configured: true, fresh: true, lastRunAt: new Date(NOW - 40 * 60_000).toISOString(), failures: 0 } }), 'backup'), 'warn');
  assert.equal(stateOf(run({ backup: { configured: true, fresh: true, lastRunAt: new Date(NOW - 60_000).toISOString(), failures: 1 } }), 'backup'), 'warn');
});

check('error thresholds: none ok, some warn, 5+ and 5% bad; bad errors plus bad latency is down', () => {
  const run = metrics => buildOpsStatus({ ...goodInputs(), metrics: { ...goodMetrics, ...metrics } });
  assert.equal(stateOf(run({ errorCount: 0 }), 'errors'), 'ok');
  assert.equal(stateOf(run({ errorCount: 2 }), 'errors'), 'warn');
  assert.equal(stateOf(run({ errorCount: 4, actionCount: 20 }), 'errors'), 'warn');
  assert.equal(stateOf(run({ errorCount: 10, actionCount: 1000 }), 'errors'), 'warn');
  assert.equal(stateOf(run({ errorCount: 50, actionCount: 500 }), 'errors'), 'bad');
  assert.equal(run({ errorCount: 50, actionCount: 500 }).health.state, 'degraded');
  assert.equal(run({ errorCount: 50, actionCount: 500, latencyP95Ms: 2500 }).health.state, 'down');
});

check('latency thresholds and the not-enough-samples case', () => {
  const run = metrics => buildOpsStatus({ ...goodInputs(), metrics: { ...goodMetrics, ...metrics } });
  assert.equal(stateOf(run({ latencyP95Ms: 249 }), 'latency'), 'ok');
  assert.equal(stateOf(run({ latencyP95Ms: 250 }), 'latency'), 'warn');
  assert.equal(stateOf(run({ latencyP95Ms: 1000 }), 'latency'), 'bad');
  const few = run({ latencyP95Ms: null, latencySamples: 3 });
  assert.equal(stateOf(few, 'latency'), 'unknown');
  assert.equal(few.health.latencyP95Ms, null);
  assert.equal(few.health.state, 'healthy');
});

check('restore failures are bad only when the server actually records them', () => {
  const run = restoreFailures => buildOpsStatus({ ...goodInputs(), metrics: { ...goodMetrics, restoreFailures } });
  assert.equal(stateOf(run(0), 'restore'), 'ok');
  assert.equal(stateOf(run(2), 'restore'), 'bad');
  assert.equal(run(2).health.restoreFailures, 2);
});

check('storage: unloaded stores are down, no data directory warns', () => {
  const run = storage => buildOpsStatus({ ...goodInputs(), storage });
  assert.equal(run({ storesLoaded: false, dataDirectory: true, rollup: { loaded: true } }).health.state, 'down');
  assert.equal(run({ storesLoaded: true, dataDirectory: true, rollup: { loaded: false } }).health.state, 'down');
  const noDir = run({ storesLoaded: true, dataDirectory: false, rollup: { loaded: true } });
  assert.equal(stateOf(noDir, 'storage'), 'warn');
  assert.equal(noDir.health.state, 'degraded');
  assert.equal(stateOf(run({ storesLoaded: true, dataDirectory: true, rollup: { loaded: true, pendingWrites: 500 } }), 'storage'), 'warn');
});

check('a drain or maintenance window makes the verdict degraded and is reported', () => {
  const drain = { mode: 'draining', message: 'Deploy', releaseId: 'rel-1', drainDeadline: '2026-10-20T11:00:00.000Z', activeRounds: 2 };
  const status = buildOpsStatus({ ...goodInputs(), maintenance: drain });
  assert.equal(status.health.state, 'degraded');
  assert.deepEqual(status.maintenance, { ...drain, lockout: false, operatorPassword: false });
});

check('the lockout and the password sign-in flag are reported to the console', () => {
  const locked = { mode: 'maintenance', lockout: true, message: 'Closed', releaseId: '', drainDeadline: null, activeRounds: 0 };
  const status = buildOpsStatus({ ...goodInputs(), maintenance: locked, operatorPassword: true });
  assert.equal(status.health.state, 'degraded');
  assert.equal(status.maintenance.lockout, true);
  assert.equal(status.maintenance.operatorPassword, true);
  // A lockout flag outside maintenance is not a lockout.
  assert.equal(buildOpsStatus({ ...goodInputs(), maintenance: { ...locked, mode: 'draining' } }).maintenance.lockout, false);
});

check('with no runtime counters every metric-backed field is null or unknown, not zero', () => {
  const status = buildOpsStatus({ ...goodInputs(), metrics: null });
  assert.equal(status.health.errorCount, null);
  assert.equal(status.health.latencyP95Ms, null);
  assert.equal(stateOf(status, 'errors'), 'unknown');
});

// ---- rooms ----------------------------------------------------------------

let seat = 0;
const player = (overrides = {}) => ({ id: `player-id-${seat += 1}`, nickname: `Nick${seat}`, clientId: `client-${seat}`, accountId: `acct-${seat}`, isBot: false, disconnected: false, ...overrides });
const room = (roomCode, overrides = {}) => ({
  roomCode,
  roomName: `Name of ${roomCode}`,
  visibility: 'public',
  destroyed: false,
  game: { started: false, lastEndReason: null, roundNumber: 0, currentPlayerId: null, diceRollSequence: 0, botDecisionSequence: 0, humanActionCount: 0, feed: [], players: [player()] },
  ...overrides,
});

check('lists rooms without room codes, names, nicknames or ids, using a short one-way id', () => {
  let clock = NOW;
  const tracker = createRoomActivityTracker({ now: () => clock });
  const secret = room('QX7ZKD');
  secret.game.players = [player({ nickname: 'ZeldaTheGreat' }), player({ isBot: true, nickname: 'Botty McBot' }), player({ disconnected: true })];
  secret.game.started = true;
  secret.game.roundNumber = 7;
  tracker.observe([secret]);
  clock += 90_000;
  const result = buildOpsRooms({ rooms: [secret], tracker, now: clock });
  assert.equal(result.success, true);
  assert.equal(result.rooms.length, 1);
  const row = result.rooms[0];
  assert.match(row.id, /^r-[0-9a-f]{6}$/);
  assert.deepEqual(Object.keys(row).sort(), ['ageSeconds', 'bots', 'humans', 'id', 'idleSeconds', 'phase', 'round', 'stalled', 'visibility']);
  assert.equal(row.phase, 'playing');
  assert.equal(row.humans, 1);
  assert.equal(row.bots, 1);
  assert.equal(row.round, 7);
  assert.equal(row.ageSeconds, 90);
  assert.equal(row.idleSeconds, 90);
  const text = JSON.stringify(result);
  ['QX7ZKD', 'qx7zkd', 'ZeldaTheGreat', 'Botty', 'player-id-', 'client-', 'acct-', 'Name of'].forEach(fragment => assert.equal(text.includes(fragment), false, fragment));
  assert.equal(tracker.idFor(secret), row.id);
  // The id is keyed per process: another tracker cannot reproduce it from the code.
  assert.notEqual(createRoomActivityTracker().idFor(secret), row.id);
});

check('classifies phases and counts totals over every room', () => {
  const tracker = createRoomActivityTracker({ now: () => NOW });
  const lobby = room('AAAAAA');
  const playing = room('BBBBBB', { visibility: 'private' });
  playing.game.started = true;
  playing.game.players = [player(), player(), player({ isBot: true })];
  const finished = room('CCCCCC');
  finished.game.lastEndReason = 'last-player';
  const destroyed = room('DDDDDD', { destroyed: true });
  const result = buildOpsRooms({ rooms: [lobby, playing, finished, destroyed], tracker, now: NOW });
  assert.deepEqual(result.totals, { rooms: 3, lobby: 1, playing: 1, humans: 4, bots: 1 });
  const byPhase = Object.fromEntries(result.rooms.map(item => [item.phase, item]));
  assert.equal(byPhase.playing.visibility, 'private');
  assert.equal(byPhase.lobby.round, null);
  assert.equal(byPhase.finished.round, null);
});

check('stalled means a started round with no progress for five minutes; progress resets idle', () => {
  let clock = NOW;
  const tracker = createRoomActivityTracker({ now: () => clock });
  const playing = room('EEEEEE');
  playing.game.started = true;
  const waiting = room('FFFFFF');
  tracker.observe([playing, waiting]);
  clock += (STALLED_AFTER_SECONDS - 1) * 1000;
  assert.equal(buildOpsRooms({ rooms: [playing, waiting], tracker, now: clock }).rooms.some(item => item.stalled), false);
  clock += 1000;
  const stalled = buildOpsRooms({ rooms: [playing, waiting], tracker, now: clock }).rooms;
  assert.equal(stalled.find(item => item.phase === 'playing').stalled, true);
  assert.equal(stalled.find(item => item.phase === 'lobby').stalled, false);
  assert.equal(stalled.find(item => item.phase === 'lobby').idleSeconds, STALLED_AFTER_SECONDS);
  playing.game.diceRollSequence += 1;
  tracker.observe([playing]);
  const after = buildOpsRooms({ rooms: [playing, waiting], tracker, now: clock }).rooms.find(item => item.phase === 'playing');
  assert.equal(after.idleSeconds, 0);
  assert.equal(after.stalled, false);
  assert.equal(after.ageSeconds, STALLED_AFTER_SECONDS);
});

check('lists newest rooms first and caps the list while totals stay complete', () => {
  let clock = NOW;
  const tracker = createRoomActivityTracker({ now: () => clock });
  const rooms = [];
  for (let index = 0; index < ROOM_LIST_LIMIT + 25; index += 1) {
    const next = room(`R${String(index).padStart(5, '0')}`);
    rooms.push(next);
    tracker.observe([next]);
    clock += 1000;
  }
  const result = buildOpsRooms({ rooms, tracker, now: clock });
  assert.equal(result.rooms.length, ROOM_LIST_LIMIT);
  assert.equal(result.totals.rooms, ROOM_LIST_LIMIT + 25);
  assert.equal(result.rooms[0].id, tracker.idFor(rooms.at(-1)));
  assert.equal(result.rooms[0].ageSeconds < result.rooms[1].ageSeconds, true);
});

// ---- bots -----------------------------------------------------------------

const rollupWith = bots => ({ query: () => ({ generatedAt: new Date(NOW).toISOString(), dimensions: { x: { seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic', bots } } }) });

check('bot usage reports only what the rollup recorded and leaves the rest null', () => {
  const report = buildOpsBots({
    rollup: rollupWith({
      'ai|ai': { botMode: 'ai', provider: 'ai', matches: 3, decisions: 40, fallback: 10, completed: 0, wins: 0, placements: [], actions: {} },
      'no-ai|deterministic': { botMode: 'no-ai', provider: 'deterministic', matches: 2, decisions: 12, fallback: 12, completed: 0, wins: 0, placements: [], actions: {} },
      // Recorded before decisions and matches were counted: nothing real to show.
      'ai|deterministic': { botMode: 'ai', provider: 'deterministic', matches: 0, decisions: 0, fallback: 9, completed: 0, wins: 0, placements: [], actions: {} },
    }),
    range: 'week',
    providerStatus: { active: { label: 'Primary', maxDecisionsPerGame: 30, apiKey: 'sk-should-never-appear' }, provider: { state: 'open' } },
    now: NOW,
  });
  assert.equal(report.range, 'week');
  assert.equal(report.providers.length, 2);
  assert.deepEqual(report.providers.find(row => row.botMode === 'ai'), { provider: 'ai', botMode: 'ai', matches: 3, decisions: 40, fallbacks: 10, fallbackRate: 0.25, sampleSize: 40 });
  const house = report.providers.find(row => row.botMode === 'no-ai');
  assert.equal(house.fallbacks, null);
  assert.equal(house.fallbackRate, null);
  assert.equal(house.decisions, 12);
  assert.deepEqual(report.totals, { botMatches: 5, decisions: 40, fallbacks: 10, fallbackRate: 0.25, sampleSize: 40 });
  assert.deepEqual(report.provider, { state: 'cooldown', activeLabel: 'Primary', capPerBot: 30 });
  assert.equal(JSON.stringify(report).includes('sk-should'), false);
});

check('an empty rollup yields null decision numbers instead of zeros', () => {
  const report = buildOpsBots({ rollup: rollupWith({}), range: 'nonsense', providerStatus: null, now: NOW });
  assert.equal(report.range, 'hour');
  assert.deepEqual(report.providers, []);
  assert.deepEqual(report.totals, { botMatches: 0, decisions: null, fallbacks: null, fallbackRate: null, sampleSize: 0 });
  assert.deepEqual(report.provider, { state: 'unknown', activeLabel: null, capPerBot: null });
  assert.equal(buildOpsBots({ rollup: rollupWith({}), range: 'season', now: NOW }).range, 'month');
});

// ---- since-start counters -------------------------------------------------

check('seat reconnects and bot fallbacks are null until recorded, then follow the counters', () => {
  const unrecorded = { ...goodMetrics, roomReconnects: null, botFallbacks: null };
  const quiet = buildOpsStatus({ ...goodInputs(), metrics: unrecorded });
  assert.equal(quiet.health.roomReconnects, null);
  assert.equal(quiet.health.botFallbacks, null);
  assert.equal(buildOpsStatus({ ...goodInputs(), metrics: null }).health.roomReconnects, null);
  const counted = { ...goodMetrics, roomReconnects: 4, botFallbacks: 0 };
  const busy = buildOpsStatus({ ...goodInputs(), metrics: counted });
  assert.equal(busy.health.roomReconnects, 4);
  assert.equal(busy.health.botFallbacks, 0, 'a recorded zero stays a zero');
  const tracker = createRoomActivityTracker();
  assert.equal(buildOpsRooms({ rooms: [], tracker, now: NOW }).sinceStart.reconnects, null);
  assert.equal(buildOpsRooms({ rooms: [], tracker, now: NOW, metrics: unrecorded }).sinceStart.reconnects, null);
  assert.equal(buildOpsRooms({ rooms: [], tracker, now: NOW, metrics: counted }).sinceStart.reconnects, 4);
  assert.equal(buildOpsBots({ rollup: rollupWith({}), now: NOW }).sinceStart.fallbacks, null);
  assert.equal(buildOpsBots({ rollup: rollupWith({}), now: NOW, metrics: unrecorded }).sinceStart.fallbacks, null);
  assert.equal(buildOpsBots({ rollup: rollupWith({}), now: NOW, metrics: { ...counted, botFallbacks: 7 } }).sinceStart.fallbacks, 7);
});
