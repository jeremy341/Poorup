// Input hygiene for player-visible text (F-056, F-057, F-058, E6-07, E1-03):
// nicknames and account display names lose hidden and bidi characters, stay
// to a plain character set, cannot impersonate a bot or a system label, and
// stay unique per table. Chat text loses the same hidden characters and is
// capped by code point. Public seams only: roomSetup normalizers and
// validators, RoomManager seating, the appearance mixin, and AccountStore.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { RoomManager } from './gameLogic.js';
import {
  buildCreateRoomRequest,
  normalizeChatText,
  normalizeNickname,
  validateCreateRoomRequest,
  validateJoinRoomRequest
} from './roomSetup.js';
import { AccountStore } from './accountStore.js';
import { SocialStore } from './socialStore.js';

const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const ASTRAL = '\u{20000}';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function hostRoom(nickname = 'Host') {
  return new RoomManager().createRoom({ socketId: 'host-socket', clientId: 'host-client', nickname });
}

function seat(room, nickname, n, extra = {}) {
  return room.addOrReconnectPlayer({ clientId: `client-${n}`, socketId: `socket-${n}`, nickname, color: '#286ea1', ...extra });
}

function seatedNickname(room, n) {
  return room.game.getPlayerByClient(`client-${n}`)?.nickname;
}

check('nicknames lose bidi overrides, zero-width characters and controls', () => {
  const cleaned = normalizeNickname('Bob\u202etupni\u200b\u0000');
  assert.equal(cleaned, 'Bobtupni');
  assert.equal(HIDDEN_CHARS.test(normalizeNickname('\u2066Ada\u2069\u200d\u2060')), false);
});

check('nicknames are NFKC folded so fullwidth lookalikes compare as plain text', () => {
  assert.equal(normalizeNickname('\uff22\uff4f\uff42'), 'Bob');
});

check('nicknames are capped by code point and never split a surrogate pair', () => {
  const cleaned = normalizeNickname(`${'a'.repeat(23)}${ASTRAL}`);
  assert.equal([...cleaned].length, 24);
  assert.equal(cleaned, `${'a'.repeat(23)}${ASTRAL}`);
  assert.equal(LONE_SURROGATE.test(normalizeNickname(`${'a'.repeat(23)}${ASTRAL}z`)), false);
});

check('nicknames keep to letters, digits, spaces and a little punctuation', () => {
  assert.equal(normalizeNickname('Penny Arcade wins $5000!'), 'Penny Arcade wins 5000');
  assert.equal(normalizeNickname('<img src=x>'), 'img srcx');
  assert.equal(normalizeNickname('Jos\u00e9 O\'Neil-Smith_2'), 'Jos\u00e9 O\'Neil-Smith_2');
});

check('chat text loses hidden and bidi characters and keeps punctuation', () => {
  assert.equal(normalizeChatText('hi\u202e\u200b\u0000there\n'), 'hithere');
  assert.equal(normalizeChatText('Hello, world! $5 :)'), 'Hello, world! $5 :)');
});

check('chat text is capped at 250 code points without splitting a pair', () => {
  const cleaned = normalizeChatText(`${'a'.repeat(249)}${ASTRAL}zz`);
  assert.equal([...cleaned].length, 250);
  assert.equal(LONE_SURROGATE.test(cleaned), false);
});

check('create and join refuse reserved labels and bot names, case-insensitively', () => {
  const system = validateCreateRoomRequest(buildCreateRoomRequest({ nickname: 'system' }, null));
  assert.match(system, /reserved/);
  const bot = validateCreateRoomRequest(buildCreateRoomRequest({ nickname: 'DICE GOBLIN' }, null));
  assert.match(bot, /reserved/);
  const hidden = validateCreateRoomRequest(buildCreateRoomRequest({ nickname: 'SYS\u200bTEM' }, null));
  assert.match(hidden, /reserved/);
  const join = validateJoinRoomRequest({ roomCode: 'ABC123', roomId: '', nickname: normalizeNickname('tax goblin') });
  assert.match(join, /reserved/);
  assert.equal(validateCreateRoomRequest(buildCreateRoomRequest({ nickname: 'Ada' }, null)), null);
});

check('a second seat cannot reuse a nickname at the table, ignoring case and hidden characters', () => {
  const room = hostRoom('Alice');
  assert.deepEqual(seat(room, 'alice', 1), { success: false, error: 'That nickname is already taken at this table.' });
  assert.deepEqual(seat(room, 'A\u200blice', 2), { success: false, error: 'That nickname is already taken at this table.' });
  assert.equal(room.game.getPlayerByClient('client-1'), undefined);
});

check('a human cannot wear a bot name or a system label at the table', () => {
  const room = hostRoom('Host');
  assert.deepEqual(seat(room, 'Dice Goblin', 1), { success: false, error: 'That nickname is reserved.' });
  assert.deepEqual(seat(room, 'SYS\u202eTEM', 2), { success: false, error: 'That nickname is reserved.' });
});

check('a seated nickname is stored cleaned, so hidden characters cannot forge a name', () => {
  const room = hostRoom('Host');
  assert.equal(seat(room, 'Bo\u202eb!', 3).success, true);
  assert.equal(seatedNickname(room, 3), 'Bob');
});

check('a reconnecting seat keeps its nickname when the new one collides', () => {
  const room = hostRoom('Host');
  assert.equal(seat(room, 'Carol', 4).success, true);
  assert.equal(seat(room, 'Host', 4).success, true);
  assert.equal(seatedNickname(room, 4), 'Carol');
});

check('setting a nickname refuses a taken or reserved name and keeps the old one', () => {
  const room = hostRoom('Alice');
  assert.equal(seat(room, 'Bea', 5).success, true);
  assert.deepEqual(room.game.setPlayerAppearance('socket-5', { nickname: 'ALICE' }), {
    success: false,
    error: 'That nickname is already taken at this table.'
  });
  assert.deepEqual(room.game.setPlayerAppearance('socket-5', { nickname: 'Tax Goblin' }), {
    success: false,
    error: 'That nickname is reserved.'
  });
  assert.equal(seatedNickname(room, 5), 'Bea');
});

check('setting a nickname to a non-string is an error, not a silent success', () => {
  const room = hostRoom('Alice');
  assert.equal(seat(room, 'Bea', 6).success, true);
  for (const nickname of [42, ['x'], { name: 'x' }, null]) {
    const result = room.game.setPlayerAppearance('socket-6', { nickname });
    assert.equal(result.success, false, `non-string ${JSON.stringify(nickname)} must be refused`);
    assert.match(result.error, /nickname/i);
  }
  assert.equal(seatedNickname(room, 6), 'Bea');
});

check('setting an omitted nickname or the seat own name still succeeds', () => {
  const room = hostRoom('Alice');
  assert.equal(seat(room, 'Bea', 7).success, true);
  assert.deepEqual(room.game.setPlayerAppearance('socket-7', { color: '#d74438' }), { success: true });
  assert.deepEqual(room.game.setPlayerAppearance('socket-7', { nickname: 'bea' }), { success: true });
  assert.equal(seatedNickname(room, 7), 'bea');
});

check('account display names lose hidden characters, cap by code point and fall back from reserved labels', () => {
  const filePath = path.join(os.tmpdir(), `poorup-nickname-policy-${crypto.randomUUID()}.json`);
  try {
    const store = new AccountStore(filePath);
    const hidden = store.register({ username: 'policyuser', displayName: 'Ada\u202eLove\u200b', password: 'long-enough-password' });
    assert.equal(hidden.account.displayName, 'AdaLove');
    const astral = store.register({ username: 'astraluser', displayName: `${'a'.repeat(17)}${ASTRAL}z`, password: 'long-enough-password' });
    assert.equal([...astral.account.displayName].length, 18);
    assert.equal(LONE_SURROGATE.test(astral.account.displayName), false);
    const reserved = store.register({ username: 'systemuser', displayName: 'SYSTEM', password: 'long-enough-password' });
    assert.equal(reserved.account.displayName, 'systemuser');
    const updated = store.updateProfileForAccount(hidden.account.id, { displayName: 'Dice Goblin' });
    assert.equal(updated.account.displayName, 'policyuser');
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

check('notification copy loses hidden characters and caps by code point', () => {
  const filePath = path.join(os.tmpdir(), `poorup-notice-policy-${crypto.randomUUID()}.json`);
  try {
    const social = new SocialStore(filePath);
    social.addNotification('acct-notice', {
      kind: 'room-invite',
      title: 'ROOM\u202e INVITE',
      body: `\u200b${'a'.repeat(249)}${ASTRAL}z`
    });
    const [notice] = social.listFor('acct-notice').notifications;
    assert.equal(notice.title, 'ROOM INVITE');
    assert.equal([...notice.body].length, 250);
    assert.equal(LONE_SURROGATE.test(notice.body), false);
    assert.equal(HIDDEN_CHARS.test(notice.body), false);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

console.log(`PASS - ${passed} nickname policy checks`);
