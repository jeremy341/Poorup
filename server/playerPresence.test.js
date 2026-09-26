import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IDLE_INPUT_GRACE_MS,
  PLAYER_INACTIVITY_REMOVAL_MS,
  markPlayerInactive,
  markPlayerActive,
  isPlayerPresenceExpired,
} from './playerPresence.js';

test('presence thresholds match the inactivity policy', () => {
  assert.equal(IDLE_INPUT_GRACE_MS, 30_000);
  assert.equal(PLAYER_INACTIVITY_REMOVAL_MS, 180_000);
});

test('inactive presence records server-owned timestamps and ignores duplicate events', () => {
  const player = { id: 'human-1' };
  const inactive = markPlayerInactive(player, { reason: 'hidden', now: 10_000 });
  assert.deepEqual(inactive, {
    id: 'human-1',
    presence: { state: 'inactive', reason: 'hidden', inactiveSince: 10_000, inactiveUntil: 190_000 },
  });
  assert.equal(markPlayerInactive(inactive, { reason: 'idle', now: 20_000 }), inactive);
  assert.equal(isPlayerPresenceExpired(inactive, 189_999), false);
  assert.equal(isPlayerPresenceExpired(inactive, 190_000), true);
});

test('active presence clears the deadline and bots do not get one', () => {
  const active = markPlayerActive({ id: 'human-1', presence: { state: 'inactive', inactiveSince: 2, inactiveUntil: 3 } });
  assert.deepEqual(active.presence, { state: 'active', inactiveSince: null, inactiveUntil: null });
  assert.equal(markPlayerInactive({ id: 'bot-1', isBot: true }, { reason: 'hidden', now: 10 }).presence, undefined);
  assert.equal(isPlayerPresenceExpired({ id: 'bot-1', isBot: true }, 1_000_000), false);
});
