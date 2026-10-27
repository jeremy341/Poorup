// The bot-decision trace is ~93% of a bot match record. Telemetry reads the
// in-memory record at settlement, so the persisted copy only keeps a short
// recent window; otherwise matches.json grows to ~115 MB at 500 bot matches
// and every match end rewrites all of it on the event loop.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MatchStore, MAX_PERSISTED_BOT_DECISIONS } from './matchStore.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-match-trace-cap-'));
const file = path.join(dir, 'matches.json');
const decisions = count => Array.from({ length: count }, (_, sequence) => ({
  sequence, phase: 'pre-roll', provider: 'deterministic', actionId: `act-${sequence}`,
  candidateIds: Array.from({ length: 12 }, (_, k) => `candidate-${k}`), recordedAt: '2026-10-20T00:00:00.000Z'
}));
const matchWith = (matchId, count, completedAt) => ({ matchId, completedAt, roomVisibility: 'public', botDecisions: decisions(count) });

assert.equal(MAX_PERSISTED_BOT_DECISIONS, 40, 'the persisted window is a named constant');

// record(): keeps the newest window, in order, in memory and on disk.
const store = new MatchStore(file);
const { match } = store.record(matchWith('m-long', 200, '2026-10-20T00:00:00.000Z'));
assert.equal(match.botDecisions.length, 40);
assert.equal(match.botDecisions[0].sequence, 160);
assert.equal(match.botDecisions.at(-1).sequence, 199);
assert.ok(fs.statSync(file).size < 60_000, `file stays small, was ${fs.statSync(file).size}`);
const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(onDisk[0].botDecisions.length, 40);
assert.equal(onDisk[0].botDecisions.at(-1).sequence, 199);

// A short trace is kept whole; a match without the field stays without it.
assert.equal(store.record(matchWith('m-short', 5, '2026-10-20T00:01:00.000Z')).match.botDecisions.length, 5);
assert.equal(Object.prototype.hasOwnProperty.call(store.record({ matchId: 'm-none', completedAt: '2026-10-20T00:02:00.000Z' }).match, 'botDecisions'), false);

// Loading an old oversized file trims it in memory and on the next write.
const oldFile = path.join(dir, 'old-matches.json');
fs.writeFileSync(oldFile, JSON.stringify([matchWith('m-old', 200, '2026-10-19T00:00:00.000Z')]));
const reloaded = new MatchStore(oldFile);
assert.equal(reloaded.get('m-old').botDecisions.length, 40);
assert.equal(reloaded.get('m-old').botDecisions.at(-1).sequence, 199);
reloaded.record(matchWith('m-next', 3, '2026-10-20T00:00:00.000Z'));
assert.equal(JSON.parse(fs.readFileSync(oldFile, 'utf8')).find(entry => entry.matchId === 'm-old').botDecisions.length, 40);
assert.equal(new MatchStore(file).get('m-long').botDecisions.length, 40);

fs.rmSync(dir, { recursive: true, force: true });
console.log('match-store bot-decision trace cap: 4 passed, 0 failed');
