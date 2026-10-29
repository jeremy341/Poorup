// POST /account/recovery/request cannot flood one mailbox. A matched request is limited by a
// per-account and per-address cooldown and a per-window cap. A throttled request answers like
// any other (no enumeration signal): no mail, no token.
import assert from 'node:assert/strict';
import { createAccountRecovery } from './accountRecovery.js';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false }); console.log(`FAIL ${name}\n  ${error.message}`); }
}

function harness() {
  let now = Date.parse('2026-10-28T12:00:00.000Z');
  const sent = [];
  const accounts = new Map([
    ['acct-1', { id: 'acct-1', username: 'owner', recoveryEmail: 'shared@example.test', recoveryEmailVerified: true }],
    ['acct-2', { id: 'acct-2', username: 'second', recoveryEmail: 'shared@example.test', recoveryEmailVerified: true }],
    ['acct-3', { id: 'acct-3', username: 'third', recoveryEmail: 'third@example.test', recoveryEmailVerified: true }],
  ]);
  const accountStore = {
    getAccountById: id => accounts.get(id) || null,
    findAccountByUsername: name => [...accounts.values()].find(account => account.username === name) || null,
    persist() {},
  };
  const recovery = createAccountRecovery({
    now: () => now,
    publicOrigin: 'https://play.example.test',
    accountStore,
    mailAdapter: { send: async message => { sent.push(message); return { success: true }; } },
  });
  return { recovery, sent, advance: ms => { now += ms; }, ask: (username, email) => recovery.requestPasswordReset({ username, email }) };
}

await check('a burst for one account delivers at most one mail per cooldown', async () => {
  const h = harness();
  for (let i = 0; i < 50; i += 1) await h.ask('owner', 'shared@example.test');
  assert.equal(h.sent.length, 1);
  assert.equal(h.recovery.tokenCount(), 1, 'throttled requests issue no token');
});

await check('a throttled request answers success and never reveals the throttle', async () => {
  const h = harness();
  const first = await h.ask('owner', 'shared@example.test');
  const second = await h.ask('owner', 'shared@example.test');
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(Object.hasOwn(second, 'error'), false);
  assert.equal(Object.hasOwn(second, 'code'), false);
});

await check('the account cap holds across a window even when every cooldown is respected', async () => {
  const h = harness();
  for (let i = 0; i < 40; i += 1) { await h.ask('owner', 'shared@example.test'); h.advance(61_000); }
  assert.ok(h.sent.length >= 1 && h.sent.length <= 5, `at most 5 mails in the window (saw ${h.sent.length})`);
  assert.equal(h.sent.length, 5);
});

await check('the window reopens after it ends', async () => {
  const h = harness();
  for (let i = 0; i < 12; i += 1) { await h.ask('owner', 'shared@example.test'); h.advance(61_000); }
  const capped = h.sent.length;
  h.advance(2 * 60 * 60 * 1000);
  await h.ask('owner', 'shared@example.test');
  assert.equal(h.sent.length, capped + 1);
});

await check('per-address limit: several accounts sharing one address cannot flood it', async () => {
  const h = harness();
  for (let i = 0; i < 20; i += 1) {
    await h.ask('owner', 'shared@example.test');
    await h.ask('second', 'shared@example.test');
  }
  assert.equal(h.sent.filter(message => message.to === 'shared@example.test').length, 1, 'one mail per address per cooldown');
});

await check('throttling one account or address does not block another', async () => {
  const h = harness();
  await h.ask('owner', 'shared@example.test');
  await h.ask('owner', 'shared@example.test');
  await h.ask('third', 'third@example.test');
  assert.equal(h.sent.filter(message => message.to === 'third@example.test').length, 1);
});

await check('unmatched pairs still send nothing', async () => {
  const h = harness();
  await h.ask('owner', 'nobody@example.test');
  await h.ask('ghost', 'shared@example.test');
  assert.equal(h.sent.length, 0);
});

const failed = results.filter(result => !result.ok).length;
console.log(`recovery throttle tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
