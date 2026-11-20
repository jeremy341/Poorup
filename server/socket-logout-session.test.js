// Regression: a sign-out over the socket must end the cookie session the socket
// was opened with. Before the fix, account-logout acked success and cleared the
// socket's binding, but the next social call re-bound the socket from the
// still-valid cookie session, so the socket stayed signed in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';
import { createSessionStore, SESSION_COOKIE_NAME } from './sessionStore.js';
import { createSocialApi } from './socketSocialApi.js';
import { RoomManager } from './gameLogic.js';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-logout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const accountStore = new AccountStore(path.join(dir, 'accounts.json'));
  const sessionStore = createSessionStore({ filePath: '', secure: false });
  const registered = accountStore.register({ username: 'logout_probe', displayName: 'Logout Probe', password: 'correct-horse-1' });
  assert.equal(registered.success, true);
  // The browser holds a cookie session (issued by /account/session flows) and
  // the same cookie rides the socket handshake.
  const cookieValue = sessionStore.issue(registered.account.id).cookieValue;
  const social = createSocialApi({
    io: { sockets: { sockets: new Map() }, in() { return { emit() {} }; }, to() { return { emit() {} }; } },
    accountStore,
    socialStore: {},
    matchStore: {},
    achievementStore: {},
    sessionStore,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn() {},
  });
  const socket = {
    id: 'logout-socket',
    data: {},
    handshake: { address: '203.0.113.9', headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` } },
    request: { headers: {} },
    rooms: new Set(),
    join() {},
    leave() {},
    emit() {},
  };
  // The server's handshake middleware binds the resolved session to the socket.
  const resolved = sessionStore.resolve(cookieValue);
  socket.data.sessionId = resolved.sessionId;
  socket.data.sessionAccountId = resolved.accountId;
  const callbacks = new Map();
  registerAccountSocketHandlers(
    (event, handler) => callbacks.set(event, handler),
    socket,
    {
      accountStore,
      sessionStore,
      roomManager: new RoomManager(),
      social,
      maintenanceSnapshot: () => ({ lockout: false }),
      io: { in() { return { emit() {} }; } },
      getRoomForSocket() { return null; },
    },
  );
  return { accountStore, sessionStore, social, socket, callbacks, cookieValue, legacyToken: registered.sessionToken };
}

test('a socket sign-out with a bearer token ends the cookie session it was opened with', t => {
  const { social, socket, callbacks, sessionStore, cookieValue, legacyToken } = fixture(t);
  assert.equal(social.accountForSocket(socket, {})?.username, 'logout_probe', 'precondition: the socket is signed in');

  let ack;
  callbacks.get('account-logout')({ sessionToken: legacyToken }, response => { ack = response; });
  assert.deepEqual(ack, { success: true });

  assert.equal(sessionStore.resolve(cookieValue), null, 'the cookie session must be revoked by sign-out');
  assert.equal(social.accountForSocket(socket, {}), null, 'a later call on the same socket must not re-bind the account');
});

test('a socket sign-out without a bearer token still ends the socket cookie session', t => {
  const { social, socket, callbacks, sessionStore, cookieValue } = fixture(t);
  let ack;
  callbacks.get('account-logout')({}, response => { ack = response; });
  assert.equal(ack?.success, true);
  assert.equal(sessionStore.resolve(cookieValue), null);
  assert.equal(social.accountForSocket(socket, {}), null);
});
