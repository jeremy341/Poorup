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
assert.equal(lineOptions.grid.containLabel, true);
assert.equal(lineOptions.yAxis.type, 'value');
assert.equal(lineOptions.yAxis.position, 'left');
assert.equal(lineOptions.yAxis.name, 'PLAYERS');
assert.equal(lineOptions.xAxis.axisLabel.hideOverlap, true);

const mixedOptions = createPoorupChartOptions([
  { label: 'STARTS', value: 12, unit: 'matches' },
  { label: 'RECONNECT RATE', value: 0.08, unit: 'percent' }
], { mode: 'bar', title: 'Reliability', unit: 'matches', tokens });
assert.equal(mixedOptions.xAxis.length, 2);
assert.equal(mixedOptions.yAxis.length, 2);
assert.equal(mixedOptions.series.length, 2);
assert.equal(mixedOptions.xAxis[0].name, 'MATCHES');
assert.equal(mixedOptions.xAxis[1].name, 'PERCENT');
assert.equal(mixedOptions.yAxis[0].name, '');
assert.equal(mixedOptions.yAxis[0].axisLabel.width, 116);
assert.equal(mixedOptions.yAxis[0].axisLabel.overflow, 'truncate');
const signedBarOptions = createPoorupChartOptions([{ label: 'LOSS', value: -5 }, { label: 'GAIN', value: 10 }], { mode: 'bar', unit: 'dollars', tokens });
assert.notEqual(signedBarOptions.xAxis[0].min, 0);
const signedLineOptions = createPoorupChartOptions([{ label: 'BEFORE', value: -3 }, { label: 'AFTER', value: 6 }], { mode: 'line', unit: 'dollars', tokens });
assert.notEqual(signedLineOptions.yAxis.min, 0);

const standardBoardOptions = createPoorupChartOptions(Array.from({ length: 40 }, (_, index) => ({ label: String(index), value: index })), { mode: 'board', variant: 'standard-40', tokens });
assert.deepEqual(standardBoardOptions.series[0].data[0].value, [0, 0, 0]);
assert.deepEqual(standardBoardOptions.series[0].data[10].value, [10, 0, 10]);
assert.deepEqual(standardBoardOptions.series[0].data[20].value, [10, 10, 20]);
assert.deepEqual(standardBoardOptions.series[0].data[30].value, [0, 10, 30]);
assert.equal(standardBoardOptions.series[0].itemStyle.color, undefined);
assert.deepEqual(standardBoardOptions.visualMap.inRange.color, [tokens.surfaceDeep, tokens.warning]);
assert.equal(standardBoardOptions.legend.show, false);
const metroBoardOptions = createPoorupChartOptions(Array.from({ length: 52 }, (_, index) => ({ label: String(index), value: index })), { mode: 'board', variant: 'metro-52', tokens });
assert.deepEqual(metroBoardOptions.series[0].data[13].value, [13, 0, 13]);
assert.deepEqual(metroBoardOptions.series[0].data[26].value, [13, 13, 26]);
assert.deepEqual(metroBoardOptions.series[0].data[39].value, [0, 13, 39]);
assert.deepEqual(metroBoardOptions.series[0].data[51].value, [0, 1, 51]);
const signedHeatmapOptions = createPoorupChartOptions([
  { label: 'LOSS', value: -5 },
  { label: 'FLAT', value: 0 },
  { label: 'GAIN', value: 10 },
  { label: 'MISSING', value: null, values: { primary: 1 } }
], { mode: 'heatmap', tokens });
assert.equal(signedHeatmapOptions.visualMap.min, -10);
assert.equal(signedHeatmapOptions.visualMap.max, 10);
assert.deepEqual(signedHeatmapOptions.visualMap.inRange.color, [tokens.negative, tokens.surfaceDeep, tokens.positive]);
assert.deepEqual(signedHeatmapOptions.series[0].data.map(point => point[2]), [-5, 0, 10]);
const signedBoardOptions = createPoorupChartOptions(Array.from({ length: 40 }, (_, index) => ({ label: String(index), value: index === 0 ? -10 : index === 10 ? 20 : 0 })), { mode: 'board', variant: 'standard-40', tokens });
assert.equal(signedBoardOptions.visualMap.min, -20);
assert.equal(signedBoardOptions.visualMap.max, 20);
assert.deepEqual(signedBoardOptions.visualMap.inRange.color, [tokens.negative, tokens.surfaceDeep, tokens.positive]);

const modes = {
  line: 'line', bar: 'bar', 'stacked-bar': 'bar', heatmap: 'heatmap', cohort: 'heatmap',
  histogram: 'bar', box: 'boxplot', scatter: 'scatter', funnel: 'funnel'
};
for (const [mode, type] of Object.entries(modes)) {
  const options = createPoorupChartOptions([{ label: 'A', value: 2, values: { human: 1, ai: 1 } }], { mode, title: mode, unit: 'value', tokens });
  assert.equal(options.series[0].type, type, `${mode} should map to ${type}`);
}

const previousEcharts = globalThis.echarts;
const previousResizeObserver = globalThis.ResizeObserver;
const calls = [];
let resizeObserverCallback;
let resizeObserverTarget;
let resizeObserverDisconnected = false;
globalThis.ResizeObserver = class {
  constructor(callback) { resizeObserverCallback = callback; }
  observe(target) { resizeObserverTarget = target; }
  disconnect() { resizeObserverDisconnected = true; }
};
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
assert.equal(resizeObserverTarget, container);
resizeObserverCallback([{ target: container, contentRect: { width: 480, height: 240 } }]);
assert.equal(calls.filter(call => call.resize).length, 2);
disposeAnalyticsChart(container);
assert.equal(container.dataset.chartEngine, undefined);
assert.equal(resizeObserverDisconnected, true);
globalThis.echarts = previousEcharts;
globalThis.ResizeObserver = previousResizeObserver;

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

let metadataMarkup = '';
globalThis.document = {};
const metadataContainer = {
  set innerHTML(value) { metadataMarkup = value; },
  get firstElementChild() { return {}; },
  getAttribute() { return null; },
  setAttribute() {},
  querySelector(selector) {
    if (selector.includes('toggle')) return { addEventListener() {}, setAttribute() {}, textContent: '' };
    return { classList: { toggle() {}, contains() { return true; } } };
  }
};
renderAnalyticsChart(metadataContainer, [{ label: 'RECONNECT RATE', value: 0.08, unit: 'percent', sampleSize: 12, numerator: 1, denominator: 12 }], { mode: 'bar', title: 'Reliability', unit: 'matches' });
assert.match(metadataMarkup, /<th scope="col">Unit<\/th>/);
assert.match(metadataMarkup, /<th scope="col">Sample<\/th>/);
assert.match(metadataMarkup, /<th scope="col">Numerator<\/th>/);
assert.match(metadataMarkup, /<th scope="col">Denominator<\/th>/);
assert.match(metadataMarkup, /<td>percent<\/td><td>12<\/td><td>1<\/td><td>12<\/td>/);
assert.match(metadataMarkup, /POINTS 1/);
assert.equal(metadataMarkup.includes('SAMPLE 1'), false);
delete globalThis.document;

console.log('analytics chart adapter: ECharts SVG mappings, tokens, fallback boundary, and disposal pass');
