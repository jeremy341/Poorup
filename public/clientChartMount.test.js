import assert from "node:assert/strict";
import process from "node:process";

// A just-big-enough DOM: one container whose inner svg / hover layer / live region are stable stubs.
function fakeContainer(width = 400, height = 240) {
  const listeners = new Map();
  const attributes = new Map();
  const hover = { innerHTML: "" };
  const live = { textContent: "" };
  const svg = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const counts = { add: 0, remove: 0, paints: 0 };
  let markup = "";
  const container = {
    clientWidth: width, clientHeight: height, dataset: {}, tabIndex: -1, counts, hover, live,
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; if (value) counts.paints += 1; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    removeAttribute(name) { attributes.delete(name); if (name === "tabindex") container.tabIndex = -1; },
    addEventListener(type, handler) { counts.add += 1; listeners.set(type, handler); },
    removeEventListener(type) { counts.remove += 1; listeners.delete(type); },
    querySelector(selector) {
      if (!markup) return null;
      if (selector === ".pc-hover") return hover;
      if (selector === ".pc-live") return live;
      if (selector === ".pc-svg") return svg;
      return null;
    },
    querySelectorAll() { return []; },
    fire(type, event = {}) {
      const handler = listeners.get(type);
      const calls = { prevented: false, stopped: false };
      handler?.({ preventDefault() { calls.prevented = true; }, stopPropagation() { calls.stopped = true; }, ...event });
      return calls;
    },
    hasListener: type => listeners.has(type),
  };
  return container;
}

const frames = [];
let observerCallback = null;
let observerDisconnects = 0;
globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.ResizeObserver = class {
  constructor(callback) { observerCallback = callback; }
  observe() {}
  disconnect() { observerDisconnects += 1; }
};
const flushFrames = () => { while (frames.length) frames.shift()(); };

const { mountChart, disposeChart, isChartMounted } = await import("./clientChartMount.js");

function check(name, assertion) {
  try {
    assertion();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

const quotes = { kind: "line", unit: "dollars", title: "Housing quote", labels: ["R1", "R2", "R3"], series: [{ name: "Quote", values: [80, 86, 92] }] };

check("mountPaintsTheSvgAndMakesTheContainerAFocusableLabelledGroup", () => {
  const container = fakeContainer();
  const handle = mountChart(container, quotes, { describedBy: "summary-1" });
  assert.equal(handle.status, "ready");
  assert.equal(handle.engine, "svg");
  assert.match(container.innerHTML, /<svg class="pc-svg pc-kind-line"/);
  assert.match(container.innerHTML, /width="400" height="240"/);
  assert.equal(container.dataset.chartEngine, "svg");
  assert.equal(container.getAttribute("role"), "group");
  assert.equal(container.getAttribute("aria-roledescription"), "chart");
  assert.match(container.getAttribute("aria-label"), /^Housing quote\. Use arrow keys/);
  assert.equal(container.getAttribute("aria-describedby"), "summary-1");
  assert.equal(container.tabIndex, 0);
  assert.equal(isChartMounted(container), true);
  assert.equal(mountChart(null, quotes), null);
});

check("arrowKeysStepThroughPointsAndAnnounceTheValue", () => {
  const container = fakeContainer();
  mountChart(container, quotes);
  assert.equal(container.fire("keydown", { key: "ArrowRight" }).prevented, true);
  assert.match(container.live.textContent, /^R1, \$80/);
  assert.match(container.hover.innerHTML, /pc-readout/);
  container.fire("keydown", { key: "ArrowRight" });
  assert.match(container.live.textContent, /^R2/);
  container.fire("keydown", { key: "End" });
  assert.match(container.live.textContent, /^R3/);
  container.fire("keydown", { key: "ArrowRight" });
  assert.match(container.live.textContent, /^R3/, "stepping past the end stays on the last point");
  container.fire("keydown", { key: "Home" });
  assert.match(container.live.textContent, /^R1/);
  container.fire("keydown", { key: "ArrowLeft" });
  assert.match(container.live.textContent, /^R1/, "stepping before the start stays on the first point");
});

check("arrowLeftFromNothingStartsAtTheEndAndOtherKeysAreLeftAlone", () => {
  const container = fakeContainer();
  mountChart(container, quotes);
  container.fire("keydown", { key: "ArrowLeft" });
  assert.match(container.live.textContent, /^R3/);
  assert.equal(container.fire("keydown", { key: "Tab" }).prevented, false);
  assert.equal(container.fire("keydown", { key: "a" }).prevented, false);
});

check("escapeClearsAnOpenReadoutButStillClosesTheSurfaceWhenNothingIsShown", () => {
  const container = fakeContainer();
  mountChart(container, quotes);
  assert.equal(container.fire("keydown", { key: "Escape" }).stopped, false, "nothing to clear, so the dialog gets the key");
  container.fire("keydown", { key: "ArrowRight" });
  const open = container.fire("keydown", { key: "Escape" });
  assert.equal(open.stopped, true, "the first Escape only dismisses the readout");
  assert.equal(container.hover.innerHTML, "");
  assert.equal(container.live.textContent, "");
});

check("mouseHoverShowsTheNearestPointQuietlyWhileTapsAndClicksAnnounceIt", () => {
  const container = fakeContainer();
  mountChart(container, quotes);
  container.fire("pointermove", { pointerType: "mouse", clientX: 5000, clientY: 10 });
  assert.match(container.hover.innerHTML, /R3/);
  assert.equal(container.live.textContent, "", "hover alone does not spam the live region");
  container.fire("pointermove", { pointerType: "touch", clientX: 0, clientY: 10 });
  assert.match(container.hover.innerHTML, /R3/, "touch moves are ignored");
  container.fire("pointerdown", { pointerType: "touch", clientX: 0, clientY: 10 });
  assert.match(container.live.textContent, /^R1/);
  container.fire("pointerleave", { pointerType: "mouse" });
  assert.equal(container.hover.innerHTML, "");
});

check("resizingRepaintsOnlyWhenTheSizeActuallyChangedAndKeepsTheActivePoint", () => {
  const container = fakeContainer(400, 240);
  mountChart(container, quotes);
  container.fire("keydown", { key: "End" });
  const paints = container.counts.paints;
  observerCallback();
  flushFrames();
  assert.equal(container.counts.paints, paints, "same size, no repaint");
  container.clientWidth = 600;
  observerCallback();
  observerCallback();
  flushFrames();
  assert.equal(container.counts.paints, paints + 1, "bursts coalesce into one repaint");
  assert.match(container.innerHTML, /width="600"/);
});

check("disposeStopsObservingRemovesListenersAndClearsTheContainer", () => {
  const container = fakeContainer();
  const disconnectsBefore = observerDisconnects;
  const handle = mountChart(container, quotes);
  assert.ok(container.counts.add >= 5);
  handle.dispose();
  assert.equal(observerDisconnects, disconnectsBefore + 1);
  assert.equal(container.counts.remove, container.counts.add);
  assert.equal(container.innerHTML, "");
  assert.equal(container.getAttribute("role"), null);
  assert.equal(container.getAttribute("aria-label"), null);
  assert.equal(container.dataset.chartEngine, undefined);
  assert.equal(container.tabIndex, -1);
  assert.equal(isChartMounted(container), false);
  disposeChart(container);
  disposeChart(null);
});

check("remountingTearsDownTheOldChartFirstSoNothingLeaks", () => {
  const container = fakeContainer();
  const disconnectsBefore = observerDisconnects;
  mountChart(container, quotes);
  mountChart(container, { ...quotes, title: "Second" });
  assert.equal(observerDisconnects, disconnectsBefore + 1);
  assert.equal(container.counts.add - container.counts.remove, container.counts.add / 2, "only the second chart's listeners remain");
  assert.match(container.getAttribute("aria-label"), /^Second/);
});

check("aChartWithNoDataStillMountsAndDoesNotCrashOnKeys", () => {
  const container = fakeContainer();
  mountChart(container, { kind: "line", labels: [], series: [] });
  assert.match(container.innerHTML, /NO DATA/);
  assert.doesNotThrow(() => container.fire("keydown", { key: "ArrowRight" }));
  assert.doesNotThrow(() => container.fire("pointermove", { pointerType: "mouse", clientX: 3, clientY: 3 }));
});
