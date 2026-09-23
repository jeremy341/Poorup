import { createPoorupChartOptions, resolvePoorupChartTokens } from './clientAnalyticsChartTheme.js';

let enginePromise = null;
const instances = new WeakMap();

function forcedColors() {
  const media = globalThis.matchMedia || globalThis.window?.matchMedia;
  return typeof media === 'function' && media.call(globalThis, '(forced-colors: active)')?.matches === true;
}

function chartDocument() { return globalThis.document && typeof globalThis.document.createElement === 'function' ? globalThis.document : null; }

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
  const engine = globalThis.echarts;
  if (!container || !engine?.init || forcedColors()) return { status: 'fallback', engine: 'none', options: null };
  const previous = instances.get(container);
  previous?.dispose?.();
  const instance = engine.init(container, null, { renderer: 'svg', useDirtyRect: true });
  const reducedMotion = Boolean(options.reducedMotion) || ((globalThis.matchMedia || globalThis.window?.matchMedia)?.('(prefers-reduced-motion: reduce)')?.matches === true);
  const chartOptions = createPoorupChartOptions(points, { ...options, tokens: options.tokens || resolvePoorupChartTokens(), reducedMotion });
  instance.setOption(chartOptions, { notMerge: true, lazyUpdate: false });
  instance.resize?.();
  const mounted = { status: 'ready', engine: 'echarts-svg', instance, options: chartOptions, dispose: () => disposeAnalyticsChart(container) };
  instances.set(container, mounted);
  if (container.dataset) container.dataset.chartEngine = 'echarts-svg';
  return mounted;
}

export function hydrateAnalyticsChart(container, points, options = {}) {
  return loadAnalyticsChartEngine().then(() => mountAnalyticsChart(container, points, options));
}

export function disposeAnalyticsChart(container) {
  const mounted = instances.get(container);
  mounted?.instance?.dispose?.();
  instances.delete(container);
  if (container?.dataset) delete container.dataset.chartEngine;
}

export function resizeAnalyticsChart(container) { instances.get(container)?.instance?.resize?.(); }

export function resetAnalyticsChartEngineForTests() {
  enginePromise = null;
  instances.clear?.();
}
