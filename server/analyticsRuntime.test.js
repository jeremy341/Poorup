import assert from 'node:assert/strict';
import { TelemetryStore } from './telemetryModule.js';
import { createAnalyticsRollupStore } from './analyticsRollupStore.js';
import {
  recordLoggedTelemetry,
  recordBotTelemetry,
  recordMatchStartTelemetry,
  recordMatchStalledTelemetry
} from './socketRuntime.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

check('records logged event round numbers without rejecting event schemas', () => {
  const records = [];
  const room = { game: { telemetryLog: [{ kind: 'event-eligible', roundNumber: 4, data: { eventId: 'event-a' } }, { kind: 'event-choice', roundNumber: 5, data: { eventId: 'event-a', voters: 3 } }] } };
  recordLoggedTelemetry({ telemetryStore: { record: (...args) => { records.push(args); return { recorded: true }; } }, room, telemetryVersions: {} });
  assert.equal(records.length, 2);
  assert.equal(records[0][1].roundNumber, 4);
});

check('classifies bot outcomes with bot mode and bot-only markers', () => {
  const records = [];
  recordBotTelemetry({ telemetryStore: { record: (...args) => { records.push(args); } }, matchRecord: { botOnly: true, botDecisions: [{ provider: 'ai', fallback: true, success: true, phase: 'turn', actionId: 'roll' }] }, telemetryVersions: {} });
  assert.equal(records[0][1].botMode, 'ai');
  assert.equal(records[0][1].botOnly, true);
});

check('records match lifecycle once per room and preserves stalled reason', () => {
  const records = [];
  const telemetryStore = { record: (...args) => { records.push(args); return { recorded: true }; } };
  const room = { roomCode: 'ROOM', game: { started: true, roundNumber: 2 } };
  assert.equal(recordMatchStartTelemetry({ telemetryStore, room, telemetryVersions: {} }), true);
  assert.equal(recordMatchStartTelemetry({ telemetryStore, room, telemetryVersions: {} }), false);
  assert.equal(recordMatchStalledTelemetry({ telemetryStore, room, telemetryVersions: {}, reasonCode: 'afk-timeout' }), true);
  assert.equal(records[0][0], 'match-start');
  assert.equal(records[1][0], 'match-stalled');
  assert.equal(records[1][1].reasonCode, 'afk-timeout');
});

check('flushes an attached rollup and closes both stores', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-analytics-runtime-'));
  let rollupWrites = 0;
  const rollup = createAnalyticsRollupStore({ persist: () => { rollupWrites += 1; } });
  const telemetry = new TelemetryStore(path.join(dir, 'telemetry.json'), { rollupStore: rollup, flushIntervalMs: 0 });
  telemetry.record('match-complete', { durationSeconds: 5 });
  telemetry.flush();
  assert.equal(rollupWrites, 1);
  assert.equal(rollup.health().pendingWrites, 0);
  telemetry.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

await (async () => {
  let release;
  let writes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-analytics-async-'));
  const telemetry = new TelemetryStore(path.join(dir, 'telemetry.json'), { persist: () => { writes += 1; return writes === 1 ? gate : undefined; }, flushIntervalMs: 0 });
  telemetry.record('bankruptcy', { count: 1 });
  const closing = telemetry.close();
  telemetry.record('bankruptcy', { count: 2 });
  release();
  await closing;
  assert.equal(writes, 2);
  assert.equal(telemetry.pendingEvents.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS - closes with async telemetry writes recorded during shutdown');
})();
