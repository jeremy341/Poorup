import assert from 'node:assert/strict';

const listeners = new Map();
let scheduledFrame = null;
let passwordFocused = false;
const disclosure = { open: false };
const summary = { closest: selector => selector === '[data-operator-toggle]' ? summary : null };
const password = { focus: () => { passwordFocused = true; } };

globalThis.requestAnimationFrame = callback => { scheduledFrame = callback; };
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = {
  querySelector(selector) {
    if (selector === '[data-operator-disclosure]') return disclosure;
    if (selector === '[data-operator-password]') return password;
    return null;
  },
  addEventListener(type, callback) { listeners.set(type, callback); },
  querySelectorAll() { return []; },
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { configureMaintenanceUi } = await import('./clientMaintenance.js');
configureMaintenanceUi();
listeners.get('click')({ target: summary });
assert.equal(typeof scheduledFrame, 'function', 'opening the disclosure schedules focus after the native toggle');
disclosure.open = true;
scheduledFrame();
assert.equal(passwordFocused, true, 'the password field receives focus when the disclosure opens');

console.log('maintenance disclosure contracts: 2 passed');
