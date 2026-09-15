import assert from 'node:assert/strict';
import fs from 'node:fs';

const { createPoorupChartOptions, resolvePoorupChartTokens } = await import('./clientAnalyticsChartTheme.js');
const { mountAnalyticsChart, disposeAnalyticsChart } = await import('./clientAnalyticsChartAdapter.js');
const { renderAnalyticsChart } = await import('./clientAnalyticsCharts.js');

const tokens = resolvePoorupChartTokens();
const lineOptions = createPoorupChartOptions([{ label: '12:00', value: 42 }], { mode: 'line', title: 'Activity', unit: 'players', tokens });
assert.equal(lineOptions.animation, false);
assert.equal(lineOptions.series[0].areaStyle.opacity, 0.14);
assert.equal(lineOptions.series[0].itemStyle.color, 'var(--analytics-primary)');
assert.equal(lineOptions.aria.show, true);

const modes = {
  line: 'line', bar: 'bar', 'stacked-bar': 'bar', heatmap: 'heatmap', cohort: 'heatmap',
  histogram: 'bar', box: 'boxplot', scatter: 'scatter', funnel: 'funnel'
};
for (const [mode, type] of Object.entries(modes)) {
  const options = createPoorupChartOptions([{ label: 'A', value: 2, values: { human: 1, ai: 1 } }], { mode, title: mode, unit: 'value', tokens });
  assert.equal(options.series[0].type, type, `${mode} should map to ${type}`);
}

const previousEcharts = globalThis.echarts;
const calls = [];
globalThis.echarts = {
  init(container, _theme, initOptions) {
    calls.push({ container, initOptions });
    return {
      setOption(options) { calls.push({ options }); },
      resize() { calls.push({ resize: true }); },
      dispose() { calls.push({ dispose: true }); }
    };
  }
};
const container = { dataset: {} };
const chart = mountAnalyticsChart(container, [{ label: '12:00', value: 42 }], { mode: 'line', title: 'Activity', unit: 'players', tokens });
assert.equal(chart.status, 'ready');
assert.equal(chart.engine, 'echarts-svg');
assert.equal(container.dataset.chartEngine, 'echarts-svg');
assert.equal(calls[0].initOptions.renderer, 'svg');
disposeAnalyticsChart(container);
assert.equal(container.dataset.chartEngine, undefined);
globalThis.echarts = previousEcharts;

const source = fs.readFileSync(new URL('./clientAnalyticsCharts.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /function\s+geometry\s*\(/);

let renderedMarkup = '';
globalThis.document = {};
const renderContainer = {
  set innerHTML(value) { renderedMarkup = value; },
  get firstElementChild() { return {}; },
  getAttribute() { return null; },
  setAttribute() {},
  querySelector(selector) {
    if (selector.includes('toggle')) return { addEventListener() {}, setAttribute() {}, textContent: '' };
    return { classList: { toggle() {}, contains() { return true; } } };
  }
};
renderAnalyticsChart(renderContainer, [{ label: 'A', value: 1 }], { mode: 'line', title: 'Activity', unit: 'players' });
assert.match(renderedMarkup, /class="analytics-chart-engine"/);
assert.match(renderedMarkup, /data-chart-engine="echarts-svg"/);
assert.match(renderedMarkup, /class="analytics-chart-table/);
assert.match(renderedMarkup, /aria-describedby=/);
delete globalThis.document;

console.log('analytics chart adapter: ECharts SVG mappings, tokens, fallback boundary, and disposal pass');
