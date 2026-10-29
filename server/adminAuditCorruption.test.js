// A corrupt audit file is preserved and reported. Replacing it with an empty
// log would leave the operator with no sign the trail had gone.
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createAdminAuditLog } from './adminAuditLog.js';
import { registerAdminOpsRoutes } from './adminOpsRoutes.js';
import { createDrainController } from './drainController.js';

async function check(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-audit-corrupt-'));
const quiet = fn => {
  const original = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = original; }
};
const entry = { area: 'release', action: 'mode', target: 'maintenance', accountId: 'acct-1', outcome: 'ok' };

await check('a corrupt audit file is preserved byte for byte and the log reports a corruption warning', () => {
  const file = path.join(dir, 'corrupt-audit.json');
  fs.writeFileSync(file, '{"entries":[{"at":');
  const log = quiet(() => createAdminAuditLog({ filePath: file, key: 'k' }));
  assert.equal(log.list().length, 0);
  const health = log.health();
  assert.equal(health.state, 'corrupt');
  assert.match(health.message, /corrupt/i);
  const preserved = fs.readdirSync(dir).filter(name => name.startsWith('corrupt-audit.json.corrupt-'));
  assert.equal(preserved.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, preserved[0]), 'utf8'), '{"entries":[{"at":');
  // New records may land, but never over the preserved copy.
  assert.equal(quiet(() => log.record(entry)).persisted, true);
  assert.equal(fs.readFileSync(path.join(dir, preserved[0]), 'utf8'), '{"entries":[{"at":');
});

await check('the warning survives a restart: the next instance still reports the lost trail', () => {
  const file = path.join(dir, 'restart-audit.json');
  fs.writeFileSync(file, 'garbage');
  quiet(() => createAdminAuditLog({ filePath: file, key: 'k' }));
  const second = quiet(() => createAdminAuditLog({ filePath: file, key: 'k' }));
  assert.equal(second.health().state, 'corrupt', 'the marker outlives the first process');
});

await check('a healthy audit file reports ok', () => {
  const file = path.join(dir, 'healthy-audit.json');
  const log = createAdminAuditLog({ filePath: file, key: 'k' });
  log.record(entry);
  assert.equal(createAdminAuditLog({ filePath: file, key: 'k' }).health().state, 'ok');
  assert.equal(createAdminAuditLog({ key: 'k' }).health().state, 'ok');
});

await check('a transient read error never overwrites the file and reports unreadable', () => {
  const file = path.join(dir, 'transient-audit.json');
  const original = '{"version":1,"entries":[]}';
  fs.writeFileSync(file, original);
  let writes = 0;
  const log = quiet(() => createAdminAuditLog({
    filePath: file,
    key: 'k',
    load: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); },
    write: () => { writes += 1; },
  }));
  assert.equal(quiet(() => log.record(entry)).persisted, false);
  assert.equal(writes, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(log.health().state, 'unreadable');
});

await check('the ops audit and status routes surface the warning to admins', async () => {
  const file = path.join(dir, 'route-audit.json');
  fs.writeFileSync(file, 'not json');
  const auditLog = quiet(() => createAdminAuditLog({ filePath: file, key: 'k' }));
  const app = express();
  registerAdminOpsRoutes(app, {
    accountResolver: () => ({ id: 'acct-route-admin' }),
    adminIds: ['acct-route-admin'],
    maintenance: createDrainController({ getActiveRounds: () => 0 }),
    auditLog,
    readRuntime: () => ({}),
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { cookie: 'poorup_session=x' };
    const audit = await (await fetch(`${base}/admin/ops/audit`, { headers })).json();
    assert.equal(audit.success, true);
    assert.equal(audit.health.state, 'corrupt');
    const status = await (await fetch(`${base}/admin/ops/status`, { headers })).json();
    assert.equal(status.auditLog.state, 'corrupt');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

fs.rmSync(dir, { recursive: true, force: true });
