import assert from "node:assert/strict";

globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const frames = [];
globalThis.requestAnimationFrame = callback => frames.push(callback);
globalThis.setTimeout = () => 1;
globalThis.clearTimeout = () => {};
const nodes = new Map();
const body = {};
globalThis.document = { body, activeElement: body, querySelector: selector => nodes.get(selector) || null };
function surface(id) {
  const node = {
    id, listeners: {}, html: "", picker: null,
    addEventListener(event, callback) { this.listeners[event] = callback; },
    querySelector(selector) { return selector === "[data-ranking-metric]" ? this.picker : null; },
    querySelectorAll: () => [],
    contains(element) { return element === this.picker; },
    set innerHTML(value) {
      this.html = value;
      if (document.activeElement === this.picker) document.activeElement = body;
      this.picker = { value: (value.match(/<option value="([^"]+)" selected/) || [])[1],
        matches: selector => selector === "[data-ranking-metric]",
        closest: selector => selector === "[data-ranking-stage]" ? {} : null,
        focus() { document.activeElement = this; } };
      nodes.set(`#${id} [data-ranking-metric]`, this.picker);
    },
    get innerHTML() { return this.html; },
  };
  nodes.set(`#${id}`, node);
  return node;
}
const page = surface("rankings-page-content");
const modal = surface("rankings-card");
const { state } = await import("./clientState.js");
const surfaces = await import("./clientSocialSurfaces.js");
const { bindParlorSurfaces } = await import("./clientParlorBindings.js");
const calls = [];
surfaces.configureSocialSurfaces({ emitServer: (event, payload, ack) => calls.push({ event, payload, ack }) });
bindParlorSurfaces({});
const flush = () => { while (frames.length) frames.shift()(); };
function change(node, value) {
  node.picker.value = value;
  document.activeElement = node.picker;
  node.listeners.change?.({ currentTarget: node, target: node.picker });
  flush();
}
for (const node of [page, modal]) {
  state.phase = node === modal ? "playing" : "home";
  const cached = { wins: [], market: [{ accountId: "cached", displayName: "Cached", username: "cached", value: 12, wins: 1, games: 2 }] };
  Object.assign(state.leaderboard, { metric: "wins", scope: "month", page: 2, snapshots: cached });
  surfaces.renderRankingsSurface(`#${node.id}`);
  flush();

  const before = calls.length;
  change(node, "market");
  assert.equal(calls.length, before + 1, "one change emits one request");
  assert.equal((node.innerHTML.match(/<option value=/g) || []).length, 14, "all metrics are directly selectable");
  assert.match(node.innerHTML, /<label class="ranking-metric-picker"><span class="t-micro ink-3">RANKING METRIC<\/span><select/);
  assert.match(node.innerHTML, /<option value="market" selected>MARKET PROFIT<\/option>/);
  assert.equal(calls.at(-1).event, "get-leaderboard-snapshot");
  assert.deepEqual(calls.at(-1).payload, { metric: "market", scope: "month" });
  assert.equal(state.leaderboard.metric, "market");
  assert.equal(state.leaderboard.snapshots, cached, "cached snapshots survive selection and loading render");
  assert.match(node.innerHTML, /Cached/);
  assert.equal(node.picker.value, "market");
  assert.equal(document.activeElement, node.picker, "replacement picker retains keyboard focus");
  calls.at(-1).ack({ success: true, scope: "month", metrics: cached });
  flush();
  assert.equal(document.activeElement, node.picker, "server rerender retains keyboard focus");
  assert.equal(node.picker.value, "market");
  for (const invalid of ["__proto__", "toString", "patrol", "", "unknown", "market "]) change(node, invalid);
  assert.equal(calls.length, before + 1, "invalid metrics do not emit requests");
  assert.equal(state.leaderboard.metric, "market");
  change(node, "market");
  assert.equal(calls.length, before + 1, "unchanged selection does not refetch");
  let prevented = false;
  node.listeners.keydown({ currentTarget: node, target: node.picker, key: "Home", preventDefault() { prevented = true; } });
  assert.equal(prevented, false, "native picker owns its keyboard navigation");
  const stage = { matches: () => false, closest: selector => selector === "[data-ranking-stage]" ? {} : null };
  for (const [key, expected] of [["Home", "wins"], ["End", "loans"], ["ArrowRight", "wins"], ["ArrowLeft", "loans"]]) {
    const count = calls.length;
    node.listeners.keydown({ currentTarget: node, target: stage, key, preventDefault() {} });
    flush();
    assert.equal(state.leaderboard.metric, expected, `${key} navigation remains available outside the native picker`);
    assert.equal(calls.length, count + 1);
    assert.equal(node.picker.value, expected);
  }
}
console.log("PASS direct ranking picker delegation, requests, cache, scope, validation and focus on page and modal");
