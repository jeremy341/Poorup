import assert from 'node:assert/strict';

const removedKeys = [];
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: key => removedKeys.push(key) };
globalThis.window = { matchMedia: () => ({ matches: false }), location: { pathname: '/' } };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
const { state } = await import('./clientState.js');
const { configureGameSave, handleRestoreSessionResponse } = await import('./clientGameSave.js');

const shown = [];
const statuses = [];
configureGameSave({
  showView: view => shown.push(view),
  setConnectionStatus: (status, announce) => statuses.push({ status, announce }),
  renderAll: () => {},
  emitServer: () => {}
});

state.phase = 'playing';
state.roomCode = 'STALE1';
handleRestoreSessionResponse({ success: false, error: 'No active session found.' }, false);

assert.equal(state.phase, 'home');
assert.equal(state.roomCode, '');
assert.deepEqual(shown, ['home']);
assert.deepEqual(statuses.at(-1), { status: 'online', announce: true });
assert.ok(removedKeys.includes('poorup.save.v1'));

console.log('client game-save restore failure: stale game view cleared');
