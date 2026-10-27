/* ============================================================
   CHART MOUNT: the only DOM-touching chart module. Paints the SVG
   from clientChartRender into a container, repaints when the
   container is resized, and owns the hover / touch / keyboard
   readout. Painting is synchronous (no engine to download), so a
   chart is either drawn or it never mounted; there is no loading
   or failed-engine state to manage.
   ============================================================ */
import {
  normalizeChartSpec, layoutChart, chartSVG, hoverMarkup, nearestIndex, readoutText, preferredChartHeight,
} from "./clientChartRender.js";

const mounts = new WeakMap();
const DEFAULT_WIDTH = 360;

/**
 * Draw `input` (see normalizeChartSpec) into `container`. Returns a handle, or
 * null when there is no container. The container becomes a focusable group:
 * arrow keys step through the points and the value is announced politely.
 */
export function mountChart(container, input, options = {}) {
  if (!container) return null;
  disposeChart(container);
  const spec = normalizeChartSpec(input);
  const label = options.label || spec.title;
  const state = { model: null, active: -1, frame: 0, width: 0, height: 0 };
  const cleanups = [];

  const measure = () => ({
    width: Math.round(container.clientWidth) || options.width || DEFAULT_WIDTH,
    height: Math.round(container.clientHeight) || options.height || preferredChartHeight(spec),
  });

  const live = () => container.querySelector(".pc-live");

  function show(index, announce = true) {
    state.active = index;
    container.querySelectorAll(".pc-bar.is-active").forEach(bar => bar.classList.remove("is-active"));
    const hover = container.querySelector(".pc-hover");
    if (index < 0 || !hover) {
      if (hover) hover.innerHTML = "";
      if (live()) live().textContent = "";
      return;
    }
    hover.innerHTML = hoverMarkup(state.model, spec, index);
    container.querySelectorAll(`.pc-bar[data-i="${index}"]`).forEach(bar => bar.classList.add("is-active"));
    if (announce && live()) live().textContent = readoutText(spec, index);
  }

  function paint() {
    state.frame = 0;
    const size = measure();
    state.width = size.width;
    state.height = size.height;
    state.model = layoutChart(spec, size);
    container.innerHTML = `${chartSVG(state.model, spec, { label, describedBy: options.describedBy || "" })}<p class="sr-only pc-live" aria-live="polite"></p>`;
    container.dataset.chartEngine = "svg";
    if (state.active >= 0) show(state.active, false);
  }

  function schedule() {
    if (state.frame) return;
    const request = globalThis.requestAnimationFrame || (callback => setTimeout(callback, 16));
    state.frame = request(() => {
      const size = measure();
      if (size.width !== state.width || size.height !== state.height) paint();
      else state.frame = 0;
    });
  }

  const listen = (type, handler) => {
    container.addEventListener(type, handler);
    cleanups.push(() => container.removeEventListener(type, handler));
  };

  const indexAt = event => {
    const svg = container.querySelector(".pc-svg");
    if (!svg || !state.model) return -1;
    const box = svg.getBoundingClientRect();
    return nearestIndex(state.model, event.clientX - box.left, event.clientY - box.top);
  };

  container.setAttribute("role", "group");
  container.setAttribute("aria-roledescription", "chart");
  container.setAttribute("aria-label", `${label}. Use arrow keys to read each point.`);
  container.tabIndex = 0;
  if (options.describedBy) container.setAttribute("aria-describedby", options.describedBy);

  listen("pointermove", event => {
    if (event.pointerType === "touch") return;
    const index = indexAt(event);
    if (index !== state.active) show(index, false);
  });
  listen("pointerdown", event => show(indexAt(event), true));
  listen("pointerleave", event => {
    if (event.pointerType !== "touch" && globalThis.document?.activeElement !== container) show(-1);
  });
  listen("focusout", () => show(-1));
  listen("keydown", event => {
    const last = spec.labels.length - 1;
    if (last < 0) return;
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (event.key === "Escape") {
      if (state.active < 0) return;
      event.stopPropagation();
      show(-1);
      return;
    }
    let next;
    if (forward) next = state.active < 0 ? 0 : Math.min(last, state.active + 1);
    else if (backward) next = state.active < 0 ? last : Math.max(0, state.active - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    show(next, true);
  });

  let stopObserving = () => {};
  const Observer = globalThis.ResizeObserver;
  if (typeof Observer === "function") {
    const observer = new Observer(schedule);
    observer.observe(container);
    stopObserving = () => observer.disconnect();
  } else if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("resize", schedule);
    stopObserving = () => globalThis.removeEventListener?.("resize", schedule);
  }

  paint();

  const handle = {
    status: "ready",
    engine: "svg",
    spec,
    show,
    dispose: () => disposeChart(container),
    teardown() {
      if (state.frame) (globalThis.cancelAnimationFrame || clearTimeout)(state.frame);
      stopObserving();
      cleanups.forEach(cleanup => cleanup());
    },
  };
  mounts.set(container, handle);
  return handle;
}

export function disposeChart(container) {
  if (!container) return;
  const handle = mounts.get(container);
  if (!handle) return;
  handle.teardown();
  mounts.delete(container);
  container.innerHTML = "";
  container.removeAttribute("role");
  container.removeAttribute("aria-roledescription");
  container.removeAttribute("aria-label");
  container.removeAttribute("aria-describedby");
  container.removeAttribute("tabindex");
  delete container.dataset.chartEngine;
}

export function isChartMounted(container) {
  return mounts.has(container);
}
