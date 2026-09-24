import { createPoorupChartOptions, resolvePoorupChartTokens } from './clientAnalyticsChartTheme.js';

let enginePromise = null;
const instances = new WeakMap();

function forcedColors() {
  const media = globalThis.matchMedia || globalThis.window?.matchMedia;
  return typeof media === 'function' && media.call(globalThis, '(forced-colors: active)')?.matches === true;
}

function chartDocument() { return globalThis.document && typeof globalThis.document.createElement === 'function' ? globalThis.document : null; }

function observeChartSize(container, instance) {
  const Observer = globalThis.ResizeObserver || globalThis.window?.ResizeObserver;
  if (typeof Observer === 'function') {
    const observer = new Observer(entries => {
      const entry = entries?.find?.(candidate => candidate.target === container);
      if (!entry) return;
      const width = Number(entry.contentRect?.width ?? container.clientWidth);
      const height = Number(entry.contentRect?.height ?? container.clientHeight);
      if (Number.isFinite(width) && width <= 0 || Number.isFinite(height) && height <= 0) return;
      instance.resize?.();
    });
    observer.observe(container);
    return () => observer.disconnect?.();
  }
  const target = globalThis.window;
  if (typeof target?.addEventListener !== 'function') return () => {};
  const resize = () => instance.resize?.();
  target.addEventListener('resize', resize);
  return () => target.removeEventListener?.('resize', resize);
}

export function loadAnalyticsChartEngine() {
  if (forcedColors()) return Promise.reject(new Error('forced-colors disables chart engine'));
  if (globalThis.echarts?.init) return Promise.resolve(globalThis.echarts);
  if (enginePromise) return enginePromise;
  const documentRef = chartDocument();
  if (!documentRef) return Promise.reject(new Error('chart engine requires a document'));
  enginePromise = new Promise((resolve, reject) => {
    const existing = documentRef.querySelector?.('script[data-analytics-engine]');
    if (existing) {
      existing.addEventListener('load', () => globalThis.echarts?.init ? resolve(globalThis.echarts) : reject(new Error('chart engine did not expose echarts')), { once: true });
      existing.addEventListener('error', () => reject(new Error('chart engine failed to load')), { once: true });
      return;
    }
    const script = documentRef.createElement('script');
    script.src = '/vendor/echarts.min.js';
    script.async = true;
    script.dataset.analyticsEngine = 'true';
    script.addEventListener('load', () => globalThis.echarts?.init ? resolve(globalThis.echarts) : reject(new Error('chart engine did not expose echarts')), { once: true });
    script.addEventListener('error', () => reject(new Error('chart engine failed to load')), { once: true });
    documentRef.head?.appendChild(script);
  }).catch(error => { enginePromise = null; throw error; });
  return enginePromise;
}

export function mountAnalyticsChart(container, points, options = {}) {
  if (!container) return { status: 'fallback', engine: 'none', options: null };
  disposeAnalyticsChart(container);
  const engine = globalThis.echarts;
  if (!engine?.init || forcedColors()) return { status: 'fallback', engine: 'none', options: null };
  const untracked = engine.getInstanceByDom?.(container);
  untracked?.dispose?.();
  const instance = engine.init(container, null, { renderer: 'svg', useDirtyRect: true });
  const reducedMotion = Boolean(options.reducedMotion) || ((globalThis.matchMedia || globalThis.window?.matchMedia)?.('(prefers-reduced-motion: reduce)')?.matches === true);
  const chartOptions = createPoorupChartOptions(points, { ...options, width: Number(container.clientWidth) || options.width || 360, height: Number(container.clientHeight) || options.height || 240, tokens: options.tokens || resolvePoorupChartTokens(), reducedMotion });
  instance.setOption(chartOptions, { notMerge: true, lazyUpdate: false });
  instance.resize?.();
  const mounted = { status: 'ready', engine: 'echarts-svg', instance, options: chartOptions, stopObserving: observeChartSize(container, instance), dispose: () => disposeAnalyticsChart(container) };
  instances.set(container, mounted);
  if (container.dataset) container.dataset.chartEngine = 'echarts-svg';
  return mounted;
}

export function hydrateAnalyticsChart(container, points, options = {}) {
  return loadAnalyticsChartEngine().then(() => mountAnalyticsChart(container, points, options));
}

export function disposeAnalyticsChart(container) {
  const mounted = instances.get(container);
  mounted?.stopObserving?.();
  mounted?.instance?.dispose?.();
  instances.delete(container);
  if (container?.dataset) delete container.dataset.chartEngine;
}

export function resizeAnalyticsChart(container) { instances.get(container)?.instance?.resize?.(); }

export function resetAnalyticsChartEngineForTests() {
  enginePromise = null;
  instances.clear?.();
}
