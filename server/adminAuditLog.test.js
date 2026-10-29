import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUDIT_LIMIT, createAdminAuditLog, pseudonymizeActor, safeTarget } from './adminAuditLog.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-admin-audit-'));
let clock = Date.parse('2026-10-20T09:00:00.000Z');
const now = () => (clock += 1000);

check('pseudonymises the actor: stable, keyed, and never the account id', () => {
  const first = pseudonymizeActor('acct-secret-123', 'key-one');
  assert.match(first, /^admin-[0-9a-f]{8}$/);
  assert.equal(first, pseudonymizeActor('acct-secret-123', 'key-one'));
  assert.notEqual(first, pseudonymizeActor('acct-secret-123', 'key-two'));
  assert.notEqual(first, pseudonymizeActor('acct-other', 'key-one'));
  assert.equal(first.includes('secret'), false);
  assert.equal(pseudonymizeActor('', 'key-one'), 'admin-00000000');
});

check('records newest first with fixed fields only', () => {
  const log = createAdminAuditLog({ key: 'k', now });
  log.record({ area: 'provider', action: 'create', target: 'OpenAI main', accountId: 'acct-1', outcome: 'ok' });
  log.record({ area: 'release', action: 'mode', target: 'draining', accountId: 'acct-1', outcome: 'failed' });
  const entries = log.list();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].area, 'release');
  assert.equal(entries[0].outcome, 'failed');
  assert.deepEqual(Object.keys(entries[0]).sort(), ['action', 'actor', 'area', 'at', 'outcome', 'target']);
  assert.equal(entries[0].at > entries[1].at, true);
  assert.equal(JSON.stringify(entries).includes('acct-1'), false);
});

check('rejects unknown areas, actions and outcomes without storing them', () => {
  const log = createAdminAuditLog({ key: 'k', now });
  assert.equal(log.record({ area: 'billing', action: 'create', target: 'x', accountId: 'a', outcome: 'ok' }), null);
  assert.equal(log.record({ area: 'provider', action: 'purge', target: 'x', accountId: 'a', outcome: 'ok' }), null);
  assert.equal(log.record({ area: 'provider', action: 'create', target: 'x', accountId: 'a', outcome: 'maybe' }), null);
  assert.equal(log.list().length, 0);
});

check('never stores keys, urls, addresses or long tokens in a target', () => {
  assert.equal(safeTarget('https://api.provider.test/v1?key=abc'), '[redacted]');
  assert.equal(safeTarget('api.example.com/v1 http://x'), '[redacted]');
  assert.equal(safeTarget('ops@example.com'), '[redacted]');
  assert.equal(safeTarget('sk-abcdefghijklmnop1234'), '[redacted]');
  assert.equal(safeTarget('Bearer abcdefghijkl'), '[redacted]');
  assert.equal(safeTarget('A'.repeat(40)), '[redacted]');
  assert.equal(safeTarget('My key production'), 'My key production');
  assert.equal(/[<>]/.test(safeTarget('Primary <b>provider</b>')), false);
  assert.equal(safeTarget(''), 'unknown');
  assert.equal(safeTarget(42), 'unknown');
  assert.equal(safeTarget('word '.repeat(30)).length <= 60, true);
  const log = createAdminAuditLog({ key: 'k', now });
  log.record({ area: 'provider', action: 'update', target: 'https://secret.example/v1', accountId: 'a', outcome: 'ok' });
  assert.equal(log.list()[0].target, '[redacted]');
});

check('keeps only the 50 newest entries', () => {
  const log = createAdminAuditLog({ key: 'k', now });
  for (let index = 0; index < AUDIT_LIMIT + 20; index += 1) log.record({ area: 'provider', action: 'test', target: `profile ${index}`, accountId: 'a', outcome: 'ok' });
  const entries = log.list();
  assert.equal(entries.length, AUDIT_LIMIT);
  assert.equal(entries[0].target, `profile ${AUDIT_LIMIT + 19}`);
  assert.equal(entries.at(-1).target, 'profile 20');
});

check('persists to the data directory and reloads, re-cleaning anything on disk', () => {
  const file = path.join(dir, 'admin-audit.json');
  const log = createAdminAuditLog({ filePath: file, key: 'k', now });
  log.record({ area: 'release', action: 'mode', target: 'maintenance', accountId: 'acct-9', outcome: 'ok' });
  const onDisk = fs.readFileSync(file, 'utf8');
  assert.equal(onDisk.includes('acct-9'), false);
  assert.equal(createAdminAuditLog({ filePath: file, key: 'k' }).list()[0].target, 'maintenance');
  // A tampered file cannot smuggle a URL, a foreign field or an unknown area into the log.
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [
    { at: '2026-10-20T09:00:00.000Z', area: 'provider', action: 'create', target: 'https://leak.example/key', actor: 'acct-raw-id', outcome: 'ok', apiKey: 'sk-live' },
    { at: 'not a date', area: 'provider', action: 'create', target: 'x', actor: 'admin-aaaaaaaa', outcome: 'ok' },
    { at: '2026-10-20T09:00:00.000Z', area: 'billing', action: 'create', target: 'x', actor: 'admin-aaaaaaaa', outcome: 'ok' },
  ] }));
  const reloaded = createAdminAuditLog({ filePath: file, key: 'k' }).list();
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].target, '[redacted]');
  assert.equal(reloaded[0].actor, 'admin-00000000');
  assert.equal(JSON.stringify(reloaded).includes('sk-live'), false);
});

check('survives an unreadable file and a failing writer without throwing', () => {
  const file = path.join(dir, 'broken.json');
  fs.writeFileSync(file, '{not json');
  const log = createAdminAuditLog({ filePath: file, key: 'k', now, write: () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } });
  assert.equal(log.list().length, 0);
  let result;
  assert.doesNotThrow(() => { result = log.record({ area: 'provider', action: 'delete', target: 'x', accountId: 'a', outcome: 'ok' }); });
  assert.equal(result.persisted, false, 'the caller learns the write was not durable');
  assert.equal(log.list().length, 0, 'a failed persist is not committed to memory');
});

check('a failed persist keeps the previous durable entries and never clobbers them in memory', () => {
  const file = path.join(dir, 'flaky-audit.json');
  let writes = 0;
  const log = createAdminAuditLog({
    filePath: file,
    key: 'k',
    now,
    write: (target, value) => {
      writes += 1;
      if (writes === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      fs.writeFileSync(target, JSON.stringify(value));
    },
  });
  assert.equal(log.record({ area: 'provider', action: 'create', target: 'first', accountId: 'a', outcome: 'ok' }).persisted, true);
  const failed = log.record({ area: 'provider', action: 'update', target: 'second', accountId: 'a', outcome: 'ok' });
  assert.equal(failed.persisted, false);
  assert.equal(log.list().length, 1, 'the in-memory log still holds exactly the durable entries');
  assert.equal(log.list()[0].target, 'first');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).entries[0].target, 'first');
});

check('a load error does not let the next record overwrite the unreadable file', () => {
  const file = path.join(dir, 'unreadable-audit.json');
  fs.writeFileSync(file, '{"entries":[]}');
  let writes = 0;
  const log = createAdminAuditLog({
    filePath: file,
    key: 'k',
    now,
    load: () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); },
    write: () => { writes += 1; },
  });
  assert.equal(log.list().length, 0);
  const result = log.record({ area: 'release', action: 'mode', target: 'maintenance', accountId: 'a', outcome: 'ok' });
  assert.equal(result.persisted, false);
  assert.equal(writes, 0, 'the file whose contents were never read is preserved');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"entries":[]}');
  assert.equal(log.list().length, 0);
});

fs.rmSync(dir, { recursive: true, force: true });
