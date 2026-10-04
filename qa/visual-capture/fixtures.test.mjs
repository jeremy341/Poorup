import assert from 'node:assert/strict';
import test from 'node:test';
import { visualRoomCode } from './fixtures.mjs';

test('visual room codes are deterministic, profile-specific, and valid six-character codes', () => {
  const expected = visualRoomCode('REL', 'capture-run-01', 'desktop-1440x900');

  assert.equal(expected, visualRoomCode('REL', 'capture-run-01', 'desktop-1440x900'));
  assert.match(expected, /^[A-Z0-9]{6}$/);
  assert.notEqual(expected, visualRoomCode('REL', 'capture-run-01', 'ipad-1194x834'));
  assert.notEqual(expected, visualRoomCode('REL', 'capture-run-02', 'desktop-1440x900'));
});

test('visual room-code prefixes stay in the accepted alphanumeric range', () => {
  assert.throws(() => visualRoomCode('TOO-LONG', 'seed', 'profile'), /prefix/);
  assert.throws(() => visualRoomCode('R_', 'seed', 'profile'), /prefix/);
});
