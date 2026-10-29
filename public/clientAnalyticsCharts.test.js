import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';

function check(name, assertion) {
  try {
    assertion();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

function fakeElement() {
  const attributes = new Map();
  let markup = '';
  return {
    clientWidth: 480, clientHeight: 240, dataset: {}, tabIndex: -1,
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    removeAttribute(name) { attributes.delete(name); },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

// The analytics container: innerHTML holds the figure; querySelectorAll hands back one fake engine per
// `.analytics-chart-engine` the markup declared, so the real mountChart paints into them.
function fakeAnalyticsContainer() {
  const engines = [];
  let markup = '';
  const container = {
    engines,
    get innerHTML() { return markup; },
    set innerHTML(value) {
      markup = value;
      engines.length = 0;
      for (let count = (value.match(/class="analytics-chart-engine"/g) || []).length; count > 0; count -= 1) engines.push(fakeElement());
    },
    get firstElementChild() { return {}; },
    getAttribute() { return null; },
    setAttribute() {},
    querySelectorAll(selector) { return selector === '.analytics-chart-engine' ? engines : []; },
    querySelector(selector) {
      if (selector.includes('toggle')) return { addEventListener() {}, setAttribute() {}, textContent: '' };
      return { classList: { toggle() {}, contains() { return true; } } };
    },
  };
  return container;
}

globalThis.document = {};
const { renderAnalyticsChart, renderBoardMetricMap, disposeAnalyticsChart } = await import('./clientAnalyticsCharts.js');

check('lineChartsPaintSynchronouslyIntoTheEngineSlotWithATableBesideThem', () => {
  const container = fakeAnalyticsContainer();
  renderAnalyticsChart(container, [{ label: '12:00', value: 42 }, { label: '13:00', value: 58 }], { mode: 'line', title: 'Activity', unit: 'players' });
  assert.equal(container.engines.length, 1);
  assert.match(container.engines[0].innerHTML, /<svg class="pc-svg pc-kind-line"/);
  assert.equal(container.engines[0].dataset.chartEngine, 'svg');
  assert.match(container.innerHTML, /class="analytics-chart-table/);
  assert.match(container.innerHTML, /class="analytics-chart-split"/, 'the plot and its table sit side by side');
  assert.doesNotMatch(container.innerHTML, /analytics-chart-table-toggle|SHOW DATA TABLE|HIDE DATA TABLE/, 'the table is always visible: there is no toggle');
  assert.doesNotMatch(container.innerHTML, /CHART ENGINE|LOADING|uplot|echarts/i, 'there is no engine to load, so no loading or failure state');
});

check('chartPointsDescribeTheSummaryTheEngineSlotRefersTo', () => {
  const container = fakeAnalyticsContainer();
  renderAnalyticsChart(container, [{ label: 'A', value: 1 }], { mode: 'line', title: 'Activity', unit: 'players' });
  const summaryId = container.innerHTML.match(/id="(analytics-chart-table-\d+-summary)"/)[1];
  assert.equal(container.engines[0].getAttribute('aria-describedby'), summaryId);
  assert.equal(container.engines[0].getAttribute('role'), 'group');
  assert.match(container.engines[0].getAttribute('aria-label'), /^Activity\./);
});

check('barChartsLabelEveryCategoryAndValueAndSkipMissingPoints', () => {
  const container = fakeAnalyticsContainer();
  renderAnalyticsChart(container, [{ label: 'Starts', value: 12, unit: 'matches' }, { label: 'Stalls', value: 3, unit: 'matches' }, { label: 'Lost', value: null, unit: 'matches' }], { mode: 'bar', title: 'Reliability', unit: 'matches' });
  const svg = container.engines[0].innerHTML;
  assert.equal((svg.match(/class="pc-bar /g) || []).length, 2, 'a missing value draws no bar');
  assert.match(svg, />Starts</);
  assert.match(svg, />Stalls</);
  assert.match(svg, /class="pc-values"/, 'bars carry their numbers, not only the table');
});

check('valuesInDifferentUnitsGetTheirOwnChartInsteadOfSharingOneAxis', () => {
  const container = fakeAnalyticsContainer();
  renderAnalyticsChart(container, [
    { label: 'Starts', value: 16, unit: 'matches' },
    { label: 'Completions', value: 12, unit: 'matches' },
    { label: 'Reconnect rate', value: 0.08, unit: 'percent' },
  ], { mode: 'bar', title: 'Match reliability', unit: 'matches' });
  assert.equal(container.engines.length, 2, 'one chart per unit');
  assert.match(container.innerHTML, /UNIT matches/);
  assert.match(container.innerHTML, /UNIT percent/);
  assert.match(container.engines[1].innerHTML, />8%</, 'the rate chart is scaled to 0 to 100 percent, not drawn at 0.08 beside 16');
  assert.match(container.innerHTML, /MULTIPLE UNITS/);
  const single = fakeAnalyticsContainer();
  renderAnalyticsChart(single, [{ label: 'A', value: 1 }, { label: 'B', value: 2 }], { mode: 'bar', title: 'One unit', unit: 'matches' });
  assert.doesNotMatch(single.innerHTML, /analytics-chart-group/, 'a single unit needs no group caption');
});

check('multiSeriesValuesBecomeSeparateLinesWithALegend', () => {
  const container = fakeAnalyticsContainer();
  renderAnalyticsChart(container, [
    { label: 'R1', values: { human: 4, bot: 2 } },
    { label: 'R2', values: { human: 6, bot: 3 } },
  ], { mode: 'line', title: 'Seats', unit: 'players' });
  const svg = container.engines[0].innerHTML;
  assert.equal((svg.match(/class="pc-line"/g) || []).length, 2);
  assert.match(svg, /class="pc-legend"/);
});

check('unsupportedModesStayAVerifiedTableWithNoEngineSlot', () => {
  const container = fakeAnalyticsContainer();
  renderAnalyticsChart(container, [{ label: 'A', value: 1 }], { mode: 'heatmap', title: 'Heat', unit: 'matches' });
  assert.equal(container.engines.length, 0);
  assert.match(container.innerHTML, /class="analytics-chart-data"/, 'the table is visible, not collapsed');
  assert.doesNotMatch(container.innerHTML, /aria-expanded/);
});

check('mixedUnitsKeepAUnitColumnInTheTable', () => {
  const container = fakeAnalyticsContainer();
  renderAnalyticsChart(container, [{ label: 'A', value: 1, unit: 'matches' }, { label: 'B', value: 0.5, unit: 'percent' }], { mode: 'bar', title: 'Mixed', unit: 'matches' });
  assert.match(container.innerHTML, /<th scope="col">Unit<\/th>/);
  assert.match(container.innerHTML, /<td>50%<\/td><td>percent<\/td>/);
});

check('theTableKeepsUnitsMetadataAndPercentageFormatting', () => {
  const container = fakeAnalyticsContainer();
  renderAnalyticsChart(container, [{ label: 'RECONNECT RATE', value: 0.08, unit: 'percent', sampleSize: 12, numerator: 1, denominator: 12 }], { mode: 'bar', title: 'Reliability', unit: 'matches' });
  for (const column of ['Sample', 'Numerator', 'Denominator']) assert.match(container.innerHTML, new RegExp(`<th scope="col">${column}</th>`));
  assert.match(container.innerHTML, /<th scope="col">Value \(percent\)<\/th>/, 'one unit is named once, in the Value header');
  assert.doesNotMatch(container.innerHTML, /<th scope="col">Unit<\/th>/);
  assert.match(container.innerHTML, /<td>8%<\/td><td>12<\/td><td>1<\/td><td>12<\/td>/);
  assert.match(container.innerHTML, /POINTS 1/);
});

check('disposeEmptiesEveryEngineSlot', () => {
  const container = fakeAnalyticsContainer();
  renderAnalyticsChart(container, [{ label: 'A', value: 1 }, { label: 'B', value: 2 }], { mode: 'line', title: 'Activity', unit: 'players' });
  assert.match(container.engines[0].innerHTML, /pc-svg/);
  disposeAnalyticsChart(container);
  assert.equal(container.engines[0].innerHTML, '');
  assert.doesNotThrow(() => disposeAnalyticsChart(null));
});

check('boardMetricMapStaysATableAndSaysItShowsAssociationOnly', () => {
  const container = fakeAnalyticsContainer();
  const result = renderBoardMetricMap(container, { variant: 'standard-40', tiles: [{ index: 0, value: 5 }] }, {});
  assert.equal(result.tiles.length, 40);
  assert.match(container.innerHTML, /ASSOCIATION, NOT CAUSATION/);
  assert.equal(container.engines.length, 0);
});

check('noChartEngineLibraryIsReferencedAnywhereInTheFacade', () => {
  const source = fs.readFileSync(new URL('./clientAnalyticsCharts.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:uPlot|uplot|echarts)\b|createElement\(.script/);
  assert.doesNotMatch(source, /function\s+geometry\s*\(/);
});

delete globalThis.document;
