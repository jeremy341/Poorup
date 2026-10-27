// s10 items 08, 09, 11: per-account caps instead of global truncation,
// rollback of memory when a persist fails, notification cleanup and a
// re-request cooldown on cancel, and removeFriend revoking pending invites.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SocialStore } from './socialStore.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-social-integrity-'));
let counter = 0;
function freshStore() {
  counter += 1;
  return new SocialStore(path.join(tempDir, `social-${counter}.json`));
}
function failPersist(store, run) {
  const original = store.persist;
  store.persist = () => { throw new Error('Atomic store write failed for social.json.'); };
  try { run(); } finally { store.persist = original; }
}

// s10-08: no global truncation. One account filling its own block list does not
// evict another account's block, and the stores keep every record they hold.
{
  const store = freshStore();
  assert.equal(store.blockPlayer('victim', 'harasser').success, true);
  for (let i = 0; i < 520; i += 1) store.blocks.push({ blockerId: `spammer-${i % 5}`, blockedId: `x-${i}`, createdAt: 'now' });
  for (let i = 0; i < 9_600; i += 1) store.blocks.push({ blockerId: `other-${i}`, blockedId: 'y', createdAt: 'now' });
  assert.equal(store.blockPlayer('someone', 'else').success, true);
  assert.equal(store.areBlocked('victim', 'harasser'), true, 'the oldest block survives a full store');
  const reloaded = new SocialStore(store.filePath);
  assert.equal(reloaded.areBlocked('victim', 'harasser'), true, 'and survives a reload');
  assert.ok(reloaded.blocks.length > 10_000, 'a reload does not truncate either');
}

// s10-08: a per-account block cap rejects instead of dropping.
{
  const store = freshStore();
  for (let i = 0; i < 500; i += 1) assert.equal(store.blockPlayer('a', `t-${i}`).success, true);
  const over = store.blockPlayer('a', 't-extra');
  assert.equal(over.success, false);
  assert.equal(store.areBlocked('a', 't-extra'), false);
  assert.equal(store.areBlocked('a', 't-0'), true, 'earlier blocks stay');
  assert.equal(store.blockPlayer('a', 't-0').success, true, 're-blocking an existing block is idempotent at the cap');
  assert.equal(store.blockPlayer('b', 't-extra').success, true, 'another account is unaffected');
}

// s10-08: a per-reporter open-report cap.
{
  const store = freshStore();
  for (let i = 0; i < 50; i += 1) assert.equal(store.reportPlayer('r', `t-${i}`, 'spam').success, true);
  assert.equal(store.reportPlayer('r', 't-extra', 'spam').success, false);
  assert.equal(store.reportPlayer('r', 't-0', 'spam').success, true, 'repeating an open report is still accepted');
  assert.equal(store.reportPlayer('q', 't-extra', 'spam').success, true, 'another reporter is unaffected');
}

// s10-08: a per-account friendship cap.
{
  const store = freshStore();
  for (let i = 0; i < 1_000; i += 1) assert.equal(store.requestFriend('a', `t-${i}`).success, true);
  assert.equal(store.requestFriend('a', 't-extra').success, false);
  assert.equal(store.requestFriend('b', 't-extra').success, true);
  assert.equal(store.friendships.length, 1_001);
}

// s10-09: every mutation rolls memory back when persist throws.
{
  const store = freshStore();
  failPersist(store, () => {
    assert.throws(() => store.requestFriend('a', 'b'), /Atomic store write failed/);
  });
  assert.equal(store.friendships.length, 0, 'a failed request is not left in memory');
  assert.equal(store.requestFriend('a', 'b').success, true, 'the retry is not told it is already pending');

  const friendship = store.friendships[0];
  failPersist(store, () => {
    assert.throws(() => store.respondFriend('b', friendship.id, true), /Atomic store write failed/);
  });
  assert.equal(store.friendships[0].status, 'requested', 'a failed accept does not change the status');
  assert.equal(store.respondFriend('b', friendship.id, true).success, true);

  failPersist(store, () => {
    assert.throws(() => store.blockPlayer('b', 'a'), /Atomic store write failed/);
  });
  assert.equal(store.areBlocked('a', 'b'), false, 'a failed block is not applied');
  assert.equal(store.friendshipBetween('a', 'b')?.status, 'accepted', 'and the friendship it would have removed is restored');

  failPersist(store, () => {
    assert.throws(() => store.removeFriend('a', 'b'), /Atomic store write failed/);
  });
  assert.equal(store.friendshipBetween('a', 'b')?.status, 'accepted');

  failPersist(store, () => {
    assert.throws(() => store.addNotification('a', { kind: 'x', title: 't', body: 'b' }), /Atomic store write failed/);
  });
  assert.equal(store.listFor('a').notifications.length, 0, 'a failed notification is not kept');

  failPersist(store, () => {
    assert.throws(() => store.createInvite({ roomCode: 'ABC123', senderId: 'a', recipientId: 'b' }), /Atomic store write failed/);
    assert.throws(() => store.reportPlayer('a', 'b', 'spam'), /Atomic store write failed/);
  });
  assert.equal(store.invites.length, 0);
  assert.equal(store.reports.length, 0);
}

// s10-11: cancelling a request deletes the target's notification for it.
{
  const store = freshStore();
  const { friendship } = store.requestFriend('a', 'b');
  store.addNotification('b', { kind: 'friend-request', title: 'FRIEND REQUEST', body: 'a sent you a request', metadata: { friendshipId: friendship.id, accountId: 'a' } });
  store.addNotification('b', { kind: 'room-invite', title: 'INVITE', body: 'unrelated', metadata: { inviteId: 'inv' } });
  assert.equal(store.listFor('b').notifications.length, 2);
  assert.equal(store.cancelFriendRequest('a', friendship.id).success, true);
  const remaining = store.listFor('b').notifications;
  assert.deepEqual(remaining.map(entry => entry.kind), ['room-invite'], 'only the cancelled request notification is removed');
}

// s10-11: a re-request cooldown after cancel (and after a decline).
{
  const realNow = Date.now;
  let clock = 1_700_000_000_000;
  Date.now = () => clock;
  try {
    const store = freshStore();
    const first = store.requestFriend('a', 'b');
    assert.equal(store.cancelFriendRequest('a', first.friendship.id).success, true);
    const again = store.requestFriend('a', 'b');
    assert.equal(again.success, false, 'an immediate re-request after cancel is refused');
    assert.match(again.error, /wait/i);
    assert.equal(store.requestFriend('c', 'b').success, true, 'other senders are unaffected');
    assert.equal(store.requestFriend('b', 'a').success, true, 'the cooldown is one-directional');
    clock += 61 * 60 * 1000;
    assert.equal(store.requestFriend('a', 'b').success, false, 'b already has a request toward a');

    const cancelled = freshStore();
    const one = cancelled.requestFriend('m', 'n');
    cancelled.cancelFriendRequest('m', one.friendship.id);
    clock += 61 * 60 * 1000;
    assert.equal(cancelled.requestFriend('m', 'n').success, true, 'a cancelled request can be resent after the cooldown');
  } finally {
    Date.now = realNow;
  }
}

// s10-11: a declined request cannot be resent at once (updatedAt is wall-clock).
{
  const declined = freshStore();
  const request = declined.requestFriend('x', 'y');
  assert.equal(declined.respondFriend('y', request.friendship.id, false).success, true);
  assert.equal(declined.requestFriend('x', 'y').success, false, 'a declined request cannot be resent at once');
  assert.equal(declined.requestFriend('y', 'x').success, true, 'the decliner can still ask the other way');
}
{
  const declined = freshStore();
  const request = declined.requestFriend('x', 'y');
  declined.respondFriend('y', request.friendship.id, false);
  declined.friendships[0].updatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  assert.equal(declined.requestFriend('x', 'y').success, true, 'it can be resent after the cooldown');
}

// s10-11: removeFriend revokes the former friend's pending invites.
{
  const store = freshStore();
  const { friendship } = store.requestFriend('a', 'b');
  store.respondFriend('b', friendship.id, true);
  const invite = store.createInvite({ roomCode: 'ROOM22', roomName: 'Table', visibility: 'private', senderId: 'a', recipientId: 'b' }).invite;
  const other = store.createInvite({ roomCode: 'ROOM33', senderId: 'a', recipientId: 'c' }).invite;
  assert.equal(store.removeFriend('b', 'a').success, true);
  assert.equal(store.getInvite('b', invite.id), null, 'the former friend invite is revoked');
  assert.ok(store.getInvite('c', other.id), 'invites to other players are untouched');
}

// H1: display-name redaction replaces whole words only, so unrelated text that
// happens to contain the name as a substring is not corrupted.
{
  const store = freshStore();
  store.addNotification('other', { kind: 'system', title: 'Announcement', body: 'Announcement: market opens.', metadata: {} });
  store.addNotification('other', { kind: 'system', title: 'NOTE', body: 'Ann went home.', metadata: {} });
  assert.equal(store.purgeAccount('gone', { displayName: 'Ann' }), true);
  const kept = store.listFor('other').notifications;
  assert.equal(kept[1].title, 'Announcement', 'a name substring inside another word is not redacted');
  assert.equal(kept[1].body, 'Announcement: market opens.');
  assert.equal(kept[0].body, 'A deleted player went home.', 'a whole-word name is still redacted');
}

// H1: only the notifications about the deleted account are touched. One that
// references it by metadata is removed, one that names it as a whole token is
// redacted, and an unrelated notification is left exactly as it was.
{
  const store = freshStore();
  store.addNotification('other', { kind: 'friend-request', title: 'FRIEND REQUEST', body: 'Ann Marie sent you a friend request.', metadata: { accountId: 'gone' } });
  store.addNotification('other', { kind: 'system', title: 'NOTE', body: 'Ann Marie joined the table.', metadata: {} });
  store.addNotification('other', { kind: 'room-invite', title: 'ROOM INVITE', body: 'Other Name invited you to Dock Room.', metadata: { inviteId: 'inv-other' } });
  assert.equal(store.purgeAccount('gone', { displayName: 'Ann Marie' }), true);
  const bodies = store.listFor('other').notifications.map(entry => entry.body);
  assert.equal(bodies.length, 2, 'the notification that references the deleted account is removed');
  assert.equal(bodies.includes('A deleted player joined the table.'), true, 'a whole-token name is redacted');
  assert.equal(bodies.includes('Other Name invited you to Dock Room.'), true, 'an unrelated notification is untouched');
  assert.equal(bodies.some(body => body.includes('Ann Marie')), false, 'no copy of the deleted name remains');
}

// H2: removeFriend only deletes an accepted friendship; pending and declined
// records are cancelled/declined with the matching cooldown.
{
  const store = freshStore();
  store.requestFriend('a', 'b');
  const invite = store.createInvite({ roomCode: 'KEEP01', senderId: 'a', recipientId: 'b' }).invite;
  assert.equal(store.removeFriend('b', 'a').success, true, 'an addressee can decline through removeFriend');
  assert.equal(store.friendshipBetween('a', 'b'), null, 'the declined request record is gone');
  assert.ok(store.getInvite('b', invite.id), 'a non-friend removal leaves room invites alone');
  assert.equal(store.requestFriend('a', 'b').success, false, 'the requester is cooled down');
  assert.equal(store.requestFriend('b', 'a').success, true, 'the decliner is not cooled down');
}
{
  const store = freshStore();
  store.requestFriend('a', 'b');
  assert.equal(store.removeFriend('a', 'b').success, true, 'a requester can cancel through removeFriend');
  assert.equal(store.friendshipBetween('a', 'b'), null);
  assert.equal(store.requestFriend('a', 'b').success, false, 'a cancel cooldown applies');
  assert.equal(store.requestFriend('b', 'a').success, true, 'the cooldown is one-directional');
}
{
  const store = freshStore();
  const declined = store.requestFriend('a', 'b').friendship;
  store.respondFriend('b', declined.id, false);
  assert.equal(store.removeFriend('a', 'b').success, true, 'a declined record can still be removed');
  assert.equal(store.friendshipBetween('a', 'b'), null);
  assert.equal(store.requestFriend('a', 'b').success, false, 'the decline cooldown survives the removal');
}

// F7: housekeeping never leaves memory pruned when the write fails.
{
  const store = freshStore();
  store.createInvite({ roomCode: 'OLDINV', senderId: 'a', recipientId: 'b' });
  store.invites[0].expiresAt = new Date(Date.now() - 60_000).toISOString();
  let removed;
  failPersist(store, () => {
    assert.doesNotThrow(() => { removed = store.pruneExpiredInvites(); });
  });
  assert.equal(removed, 0, 'a prune that cannot persist reports nothing removed');
  assert.equal(store.invites.length, 1, 'the expired invite is restored');
  assert.equal(store.listFor('b').invites.length, 0, 'a later prune still succeeds');
  assert.equal(store.invites.length, 0);
}

// H7: load normalizes malformed friendship, block and report rows.
{
  const filePath = path.join(tempDir, 'social-normalized.json');
  const longId = 'x'.repeat(121);
  fs.writeFileSync(filePath, JSON.stringify({
    friendships: [
      { id: 'f1', requesterId: 'a', addresseeId: 'b', status: 'requested' },
      { id: 'f2', requesterId: 'b', addresseeId: 'a', status: 'accepted' },
      { id: 'f3', requesterId: 'e', addresseeId: 'f', status: 'requested' },
      { id: 'f3', requesterId: 'e', addresseeId: 'f', status: 'requested' },
      { id: 'f4', requesterId: 'c', addresseeId: 'c', status: 'accepted' },
      { id: 'f5', requesterId: '', addresseeId: 'd', status: 'accepted' },
      { id: 'f6', requesterId: longId, addresseeId: 'd', status: 'accepted' }
    ],
    blocks: [
      { blockerId: 'a', blockedId: 'b' },
      { blockerId: 'a', blockedId: 'b' },
      { blockerId: 'a', blockedId: 'a' },
      { blockerId: '', blockedId: 'x' }
    ],
    reports: [
      { id: 'r1', reporterId: 'a', reportedId: 'b', status: 'open', createdAt: new Date().toISOString() },
      { id: 'r2', reporterId: 'b', reportedId: 'a', status: 'open', createdAt: new Date().toISOString() },
      { id: 'r3', reporterId: 'a', reportedId: 'b', status: 'open', createdAt: new Date().toISOString() },
      { id: 'r4', reporterId: 'a', reportedId: 'a', status: 'open' },
      { id: 'r5', reporterId: '', reportedId: 'b', status: 'open' },
      { id: 'r6', reporterId: 'a', reportedId: 'z', status: 'resolved', createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString() },
      { id: 'r7', reporterId: 'a', reportedId: 'z2', status: 'resolved', createdAt: new Date().toISOString() }
    ]
  }));
  const store = new SocialStore(filePath);
  assert.equal(store.friendships.length, 2, 'duplicate unordered pairs, self-pairs and invalid ids are dropped');
  assert.equal(store.friendshipBetween('a', 'b')?.status, 'accepted', 'duplicates prefer the accepted record');
  assert.deepEqual(store.friendships.map(entry => entry.id).sort(), ['f2', 'f3']);
  assert.equal(store.blocks.length, 1, 'duplicate and self blocks are dropped');
  assert.equal(store.reports.length, 3, 'duplicate open reports are collapsed and old closed reports age out');
  assert.equal(store.reports.filter(report => report.status === 'open').length, 2);
}

// H7: closed (declined) request history is bounded on load too, and the most
// recent rows are kept so a decline cooldown still survives a restart.
{
  const filePath = path.join(tempDir, 'social-closed-cap.json');
  const friendships = [];
  const now = Date.now();
  for (let i = 0; i < 120; i += 1) {
    const stamp = new Date(now - (120 - i) * 1000).toISOString();
    friendships.push({ id: `d-${i}`, requesterId: 'a', addresseeId: `t-${i}`, status: 'declined', createdAt: stamp, updatedAt: stamp });
  }
  fs.writeFileSync(filePath, JSON.stringify({ friendships }));
  const store = new SocialStore(filePath);
  assert.equal(store.friendships.length, 50, 'closed request history is bounded on load');
  assert.deepEqual(store.friendships.map(entry => entry.id), Array.from({ length: 50 }, (_, i) => `d-${70 + i}`), 'the most recent closed rows are the ones kept');
}

// H7/H8: load enforces the friendship, pending-inbound and archived-report caps.
{
  const filePath = path.join(tempDir, 'social-load-caps.json');
  const friendships = [];
  for (let i = 0; i < 1_005; i += 1) friendships.push({ id: `out-${i}`, requesterId: 'a', addresseeId: `u-${i}`, status: 'requested' });
  for (let i = 0; i < 150; i += 1) friendships.push({ id: `in-${i}`, requesterId: `s-${i}`, addresseeId: 'target', status: 'requested' });
  fs.writeFileSync(filePath, JSON.stringify({ friendships }));
  const store = new SocialStore(filePath);
  assert.equal(store.friendships.filter(entry => entry.requesterId === 'a').length, 1_000, 'the per-account friendship cap is enforced on load');
  assert.equal(store.friendships.filter(entry => entry.addresseeId === 'target').length, 100, 'the pending-inbound cap is enforced on load');
}
{
  const filePath = path.join(tempDir, 'social-report-cap.json');
  const now = new Date().toISOString();
  const reports = [];
  for (let i = 0; i < 250; i += 1) reports.push({ id: `c-${i}`, reporterId: 'a', reportedId: `t-${i}`, status: 'resolved', createdAt: now });
  fs.writeFileSync(filePath, JSON.stringify({ reports }));
  const store = new SocialStore(filePath);
  assert.equal(store.reports.length, 200, 'closed report history is bounded');
}
{
  const filePath = path.join(tempDir, 'social-open-report-evidence.json');
  const now = new Date().toISOString();
  const reports = [];
  for (let i = 0; i < 60; i += 1) reports.push({ id: `o-${i}`, reporterId: 'a', reportedId: `t-${i}`, status: 'open', createdAt: now });
  fs.writeFileSync(filePath, JSON.stringify({ reports }));
  const store = new SocialStore(filePath);
  assert.equal(store.reports.length, 60, 'load keeps open report evidence beyond the mutation cap');
}

// H8: incoming pending requests have their own cap and never spend the
// recipient's outgoing budget.
{
  const store = freshStore();
  for (let i = 0; i < 100; i += 1) assert.equal(store.requestFriend(`sender-${i}`, 'popular').success, true);
  const over = store.requestFriend('one-more', 'popular');
  assert.equal(over.success, false, 'the pending-inbound cap refuses a new request');
  assert.match(over.error, /too many pending/i);
  assert.equal(store.friendshipCount('popular'), 0, 'incoming requests do not count as outgoing');
  assert.equal(store.listFor('popular').requests.length, 100, 'all accepted inbound requests remain listed');
}

// Decline cooldown survives a restart even when the declined record is gone:
// a decline, and a pending request removed by its addressee, persist a cooldown.
{
  const reload = store => new SocialStore(store.filePath);
  const declinedThenRemoved = freshStore();
  const declined = declinedThenRemoved.requestFriend('a', 'b').friendship;
  declinedThenRemoved.respondFriend('b', declined.id, false);
  assert.equal(declinedThenRemoved.removeFriend('a', 'b').success, true);
  assert.equal(reload(declinedThenRemoved).requestFriend('a', 'b').success, false, 'declined then removed: cooldown survives a restart');
  assert.equal(reload(declinedThenRemoved).requestFriend('b', 'a').success, true, 'the decliner is still free to ask');

  const removedPending = freshStore();
  removedPending.requestFriend('c', 'd');
  assert.equal(removedPending.removeFriend('d', 'c').success, true);
  assert.equal(reload(removedPending).requestFriend('c', 'd').success, false, 'pending removed by addressee: cooldown survives a restart');

  const expired = freshStore();
  expired.requestFriend('g', 'h');
  expired.removeFriend('h', 'g');
  const raw = JSON.parse(fs.readFileSync(expired.filePath, 'utf8'));
  assert.ok(Array.isArray(raw.requestCooldowns) && raw.requestCooldowns.length === 1, 'the cooldown is persisted in the snapshot');
  raw.requestCooldowns[0].until = Date.now() - 1000;
  fs.writeFileSync(expired.filePath, JSON.stringify(raw));
  const lapsed = reload(expired);
  assert.equal(lapsed.requestCooldowns.size, 0, 'expired cooldowns are dropped on load');
  assert.equal(lapsed.requestFriend('g', 'h').success, true);

  const legacy = path.join(tempDir, 'social-legacy-no-cooldowns.json');
  fs.writeFileSync(legacy, JSON.stringify({ friendships: [] }));
  assert.equal(new SocialStore(legacy).requestCooldowns.size, 0, 'old files without cooldowns still load');

  const failing = freshStore();
  failing.requestFriend('i', 'j');
  failPersist(failing, () => assert.throws(() => failing.removeFriend('j', 'i')));
  assert.equal(failing.requestCooldowns.size, 0, 'a failed persist leaves no cooldown behind');
  assert.equal(failing.friendshipBetween('i', 'j')?.status, 'requested');
}

console.log('social store integrity: all passed');
