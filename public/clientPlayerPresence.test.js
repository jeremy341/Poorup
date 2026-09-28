import assert from "node:assert/strict";
import { createPresenceMonitor } from "./clientPlayerPresence.js";

function harness() {
  const listeners = new Map();
  const timers = new Map();
  const emitted = [];
  let nextTimer = 1;
  let visible = true;
  const document = {
    get visibilityState() { return visible ? "visible" : "hidden"; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const window = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const schedule = (fn, delay) => {
    const id = nextTimer++;
    timers.set(id, { fn, delay });
    return id;
  };
  const cancel = id => timers.delete(id);
  return {
    document, window, emitted, timers, listeners,
    start() { return createPresenceMonitor({ document, window, emit: (...args) => emitted.push(args), schedule, cancel }); },
    visibility(isVisible) { visible = isVisible; listeners.get("visibilitychange")?.(); },
    input(type) { listeners.get(type)?.({ type, clientX: 999, key: "secret" }); },
    fire(delay) {
      const match = [...timers].find(([, timer]) => timer.delay === delay);
      if (!match) throw new Error(`No timer scheduled for ${delay}ms`);
      timers.delete(match[0]);
      match[1].fn();
    },
  };
}

{
  const h = harness();
  const monitor = h.start();
  assert.equal(h.timers.size, 1, "visible tab starts its idle timer");
  h.fire(30_000);
  assert.deepEqual(h.emitted, [["player-presence", { state: "inactive", reason: "idle" }]]);
  monitor.destroy();
}

{
  const h = harness();
  const monitor = h.start();
  h.visibility(false);
  h.visibility(false);
  assert.deepEqual(h.emitted, [["player-presence", { state: "inactive", reason: "hidden" }]]);
  h.visibility(true);
  assert.deepEqual(h.emitted[1], ["player-presence", { state: "active" }]);
  assert.equal(h.timers.size, 1);
  monitor.destroy();
}

{
  for (const type of ["pointermove", "keydown", "click", "touchstart"]) {
    const h = harness();
    const monitor = h.start();
    h.fire(30_000);
    h.input(type);
    h.input(type);
    assert.deepEqual(h.emitted, [
      ["player-presence", { state: "inactive", reason: "idle" }],
      ["player-presence", { state: "active" }],
    ], `${type} resets idle and duplicate input is coalesced`);
    assert.equal(JSON.stringify(h.emitted).includes("secret"), false);
    assert.equal(JSON.stringify(h.emitted).includes("999"), false);
    monitor.destroy();
  }
}

{
  const h = harness();
  const monitor = h.start();
  h.fire(30_000);
  monitor.destroy();
  assert.equal(h.listeners.size, 0, "teardown removes DOM listeners");
  assert.equal(h.timers.size, 0, "teardown clears pending clocks");
}

console.log("client player presence tests: passed");
