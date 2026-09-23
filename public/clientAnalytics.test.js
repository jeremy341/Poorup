/* global process */
import assert from 'node:assert/strict';

globalThis.window = { matchMedia: () => ({ matches: false }), location: { pathname: '/' } };
globalThis.document = { querySelector: () => null };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { normalizeAnalyticsSnapshot, normalizeAnalyticsQuery, metricValue, isAnalyticsPath, createAnalyticsController, renderAnalyticsSnapshot } = await import('./clientAnalytics.js');
const { ANALYTICS_TABS, ANALYTICS_FILTERS, PANEL_DEFINITIONS, OVERVIEW_KPIS, CONTEXTUAL_PANELS } = await import('./clientAnalyticsCatalog.js');
const { normalizeAnalyticsQuery: viewModelQuery, normalizeAnalyticsSnapshot: viewModelSnapshot } = await import('./clientAnalyticsViewModel.js');
const { renderAnalyticsChart, renderBoardMetricMap, CHART_COLORS } = await import('./clientAnalyticsCharts.js');
const { state } = await import('./clientState.js');

async function check(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

await check('accepts only the internal analytics path', () => {
  assert.equal(isAnalyticsPath('/admin/analytics'), true);
  assert.equal(isAnalyticsPath('/analytics'), false);
  assert.equal(isAnalyticsPath('/admin/analytics?range=day'), true);
});

await check('catalog preserves all tabs, filters, questions, and overview metadata', () => {
  assert.deepEqual(ANALYTICS_TABS, ['overview', 'match-health', 'rulesets', 'economy', 'events', 'bots', 'quality']);
  assert.deepEqual(ANALYTICS_FILTERS, ['range', 'boardVariant', 'rulesetPreset', 'marketComplexity', 'botMode', 'provider', 'eventId', 'seasonId', 'rulesetRevision', 'balanceRevision']);
  assert.equal(Object.keys(PANEL_DEFINITIONS).length, 7);
  for (const tab of ANALYTICS_TABS) assert.equal(typeof PANEL_DEFINITIONS[tab].question, 'string');
  assert.ok(Array.isArray(OVERVIEW_KPIS) && OVERVIEW_KPIS.length >= 6);
  assert.ok(Array.isArray(CONTEXTUAL_PANELS));
});

await check('view model keeps the minimum cohort fixed and rejects unknown query fields', () => {
  const query = viewModelQuery({ minimumCohort: 1, accountId: 'raw', unknown: 'drop', boardVariant: 'METRO-52' });
  assert.equal(query.minimumCohort, 5);
  assert.equal(query.boardVariant, 'metro-52');
  assert.equal(query.accountId, undefined);
  assert.equal(query.unknown, undefined);
  assert.equal(viewModelSnapshot({ suppression: { minimumCohort: 1 } }).suppression.minimumCohort, 5);
});

await check('view model recursively redacts private and raw payload fields', () => {
  const clean = viewModelSnapshot({
    breakdowns: [{ displayName: 'Ada', nested: { username: 'ada', roomCode: 'ROOM', raw: { payload: 'secret' }, safe: 3 } }],
    overview: { kpis: [{ id: 'x', value: 2, event: { data: 'secret' } }] },
  });
  const serialized = JSON.stringify(clean);
  assert.equal(serialized.includes('Ada'), false);
  assert.equal(serialized.includes('ROOM'), false);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(clean.breakdowns[0].nested, undefined);
});

await check('view model drops unknown wrappers while retaining approved dynamic contexts', () => {
  const clean = viewModelSnapshot({ breakdowns: [{ metadata: { label: 'leak' }, actions: { roll: 3 }, outcomeDistribution: { wins: 2 } }] });
  assert.equal(clean.breakdowns[0].metadata, undefined);
  assert.equal(clean.breakdowns[0].actions.roll, 3);
  assert.equal(clean.breakdowns[0].outcomeDistribution.wins, 2);
});

await check('view model removes IP and User-Agent identity fields in dynamic contexts', () => {
  const clean = viewModelSnapshot({ breakdowns: [{ actions: {
    ipAddress: '1.2.3.4', rawIp: '1.2.3.5', userAgent: 'browser', rawUserAgent: 'raw-browser',
    ip_address: '1.2.3.6', raw_ip: '1.2.3.7', user_agent: 'ua', raw_user_agent: 'raw-ua',
    label: 'roll', value: 3,
  } }] });
  const serialized = JSON.stringify(clean).toLowerCase();
  for (const field of ['ipaddress', 'rawip', 'useragent', 'rawuseragent', 'ip_address', 'raw_ip', 'user_agent', 'raw_user_agent']) assert.equal(serialized.includes(field), false);
  assert.equal(clean.breakdowns[0].actions.label, 'roll');
});

await check('controller reports rollup unavailable when fetch is missing', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousAccount = state.account;
  globalThis.window = { location: { pathname: '/admin/analytics', search: '' }, matchMedia: () => ({ matches: false }) };
  globalThis.fetch = undefined;
  state.account = { sessionToken: 'session' };
  const status = fakeElement({ id: 'admin-analytics-status' });
  globalThis.document = fakeAnalyticsDocument({ status, grid: fakeElement({ id: 'admin-analytics-grid' }) });
  const controller = createAnalyticsController();
  const result = await controller.load();
  assert.equal(result.status, 503);
  assert.equal(status.textContent, 'ROLLUP UNAVAILABLE · RETRY');
  controller.destroy();
  state.account = previousAccount;
  globalThis.fetch = previousFetch;
  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
});

await check('normalizes malformed metrics without leaking fields', () => {
  const snapshot = normalizeAnalyticsSnapshot({
    metrics: {
      'active-rounds': { value: '2', privateChat: 'secret' },
      'unknown': { value: 99 },
    },
  });
  assert.equal(snapshot.metrics['active-rounds'].value, 2);
  assert.equal(snapshot.metrics['active-rounds'].privateChat, undefined);
  assert.equal(snapshot.metrics.unknown, undefined);
});

await check('reads gauge and counter values consistently', () => {
  assert.equal(metricValue({ value: 4, last: 2 }), 4);
  assert.equal(metricValue({ last: 3, total: 7 }), 3);
  assert.equal(metricValue(null), 0);
});

await check('normalizes versioned aggregate snapshots without raw identity fields', () => {
  const snapshot = normalizeAnalyticsSnapshot({
    schemaVersion: 1,
    filters: { range: 'day', seasonId: 'season-01', accountId: 'do-not-keep' },
    overview: { kpis: [{ id: 'completed-rounds', value: 8, denominator: 10, accountId: 'raw' }] },
    breakdowns: [{ pseudonymId: 'P-ABC', observations: 5, displayName: 'Ada', username: 'ada', accountId: 'raw' }],
    dataQuality: { stale: false }
  });
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.overview.kpis[0].value, 8);
  assert.equal(snapshot.breakdowns[0].pseudonymId, 'P-ABC');
  assert.equal(serialized.includes('Ada'), false);
  assert.equal(serialized.includes('accountId'), false);
});

await check('normalizes filters to fixed allow-lists and minimum cohort', () => {
  const query = normalizeAnalyticsQuery({ range: 'season', boardVariant: 'METRO-52', botMode: 'AI', provider: 'OpenAI', view: 'economy', dimension: 'feature', metric: 'loan-adoption', minimumCohort: 1, accountId: 'raw' });
  assert.deepEqual(query, { range: 'season', seasonId: '', rulesetRevision: '', balanceRevision: '', boardVariant: 'metro-52', rulesetPreset: 'all', marketComplexity: 'all', botMode: 'ai', provider: 'openai', eventId: '', minimumCohort: 5, tab: 'economy', dimension: 'feature', metric: 'loan-adoption' });
  assert.equal(normalizeAnalyticsQuery({ rulesetRevision: 'abc', balanceRevision: 'NaN' }).rulesetRevision, '');
});

await check('restores analytics tab and filters from the URL and updates deep links', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const replacements = [];
  globalThis.window = { location: { pathname: '/admin/analytics', search: '?view=economy&provider=ai' }, history: { replaceState: (_state, _title, url) => replacements.push(url) }, matchMedia: () => ({ matches: false }) };
  globalThis.document = fakeAnalyticsDocument({ grid: fakeElement({ id: 'admin-analytics-grid' }), status: fakeElement({ id: 'admin-analytics-status' }) });
  const controller = createAnalyticsController({ fetcher: async () => ({ success: true, overview: { kpis: [] } }) });
  assert.equal(controller.filters.tab, 'economy');
  assert.equal(controller.filters.provider, 'ai');
  controller.setTab('bots');
  assert.match(replacements.at(-1), /tab=bots/);
  controller.destroy();
  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
});

await check('retains version dimensions and strips unknown aggregate fields', () => {
  const snapshot = normalizeAnalyticsSnapshot({ schemaVersion: 1, pseudonymVersion: 'hmac-v1', seasonId: 's', rulesetRevision: 2, balanceRevision: 3, boardVariant: 'metro-52', overview: { unknownField: 'drop', kpis: [] } });
  assert.equal(snapshot.pseudonymVersion, 'hmac-v1');
  assert.equal(snapshot.seasonId, 's');
  assert.equal(snapshot.rulesetRevision, 2);
  assert.equal(snapshot.overview.unknownField, undefined);
});

await check('preserves narrowly allow-listed nested rows for every analytics tab', () => {
  for (const tab of ['rulesets', 'economy', 'events', 'bots', 'quality']) {
    const snapshot = normalizeAnalyticsSnapshot({ filters: { tab }, breakdowns: [{ rows: [{ id: tab, value: 2, denominator: 5, unknownField: 'drop' }] }] });
    assert.equal(snapshot.breakdowns[0].rows[0].id, tab);
    assert.equal(snapshot.breakdowns[0].rows[0].denominator, 5);
    assert.equal(snapshot.breakdowns[0].rows[0].unknownField, undefined);
  }
});

await check('preserves every server read-model measure through client normalization', () => {
  const measure = {
    starts: 10, completions: 8, stalls: 2, startedMatches: 10, completedMatches: 8,
    stalledMatches: 2, reconnectRate: { value: 0.1, denominator: 10 }, afkRate: { value: 0.2, denominator: 10 },
    bankruptcies: { value: 1, denominator: 10 }, comebacks: { value: 2, denominator: 10 }, denominators: { startedMatches: 10 },
    outcomeDistribution: { wins: 8 }, liquidationRate: { value: 0.1, denominator: 10 }, liquidation: { value: 0.1 },
    shortDefaultRate: { value: 0.02 }, shortDefault: { value: 0.02 }, optionExerciseRate: { value: 0.03 }, optionExercise: { value: 0.03 }, negativeCashPrevention: { value: 1 },
    unlockRarity: { rare: { value: 0.2 } }, medianPlacement: { value: 2 }, actionAdoption: { roll: 3 },
    auctionDecisions: 4, legalActionTaxonomy: ['roll'], competitiveMetricsExcludeBotOnly: true
  };
  const normalized = normalizeAnalyticsSnapshot({ filters: { tab: 'bots' }, breakdowns: [measure] }).breakdowns[0];
  Object.keys(measure).forEach(key => assert.notEqual(normalized[key], undefined, `${key} must survive normalization`));
});

await check('chart hook keeps an accessible table fallback and bounded points', () => {
  const fallback = renderAnalyticsChart(null, Array.from({ length: 200 }, (_, index) => ({ label: `<${index}>`, value: index })), { title: 'Completion', unit: 'rounds', mode: 'bar' });
  assert.equal(fallback.values.length, 168);
  assert.equal(fallback.table, true);
});

await check('preserves relative association deltas and version metadata', () => {
  const snapshot = normalizeAnalyticsSnapshot({ pseudonymVersion: 'hmac-v1', breakdowns: [{ relativeRateDelta: 0.25, relativeDelta: 0.1 }] });
  assert.equal(snapshot.pseudonymVersion, 'hmac-v1');
  assert.equal(snapshot.breakdowns[0].relativeRateDelta, 0.25);
});

await check('chart markup exposes table state and non-negative bars', () => {
  const previousDocument = globalThis.document;
  let markup = '';
  globalThis.document = {};
  const container = {
    set innerHTML(value) { markup = value; },
    get firstElementChild() { return {}; },
    getAttribute(name) { return name === 'aria-labelledby' ? 'analytics-chart-title' : null; },
    setAttribute() {},
    querySelector(selector) {
      if (selector.includes('toggle')) return { addEventListener() {}, setAttribute() {}, textContent: '' };
      return { classList: { toggle() {}, contains() { return true; } } };
    }
  };
  renderAnalyticsChart(container, [{ label: 'loss', value: -4 }], { mode: 'bar' });
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /aria-controls="analytics-chart-table-/);
  assert.match(markup, /id="analytics-chart-title"/);
  assert.match(markup, /var\(--analytics-/);
  assert.equal(markup.includes('height="-'), false);
  globalThis.document = previousDocument;
});

await check('chart adapter supports every declared mode with bounded accessible output', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {};
  const modes = ['line', 'bar', 'stacked-bar', 'heatmap', 'histogram', 'box', 'scatter', 'funnel', 'cohort', 'board'];
  for (const mode of modes) {
    let markup = '';
    const container = {
      set innerHTML(value) { markup = value; },
      get firstElementChild() { return {}; },
      getAttribute() { return null; },
      setAttribute() {},
      querySelector(selector) { return selector.includes('toggle') ? { addEventListener() {}, setAttribute() {}, textContent: '' } : { classList: { toggle() {}, contains() { return true; } } }; }
    };
    renderAnalyticsChart(container, Array.from({ length: 240 }, (_, index) => ({ label: `<${index}>`, value: index % 7 - 3, series: index % 2 ? 'AI' : 'HUMAN' })), { mode, title: `<${mode}>`, unit: 'rounds', sampleSize: 240 });
    assert.match(markup, /<figure/);
    assert.match(markup, /<figcaption/);
    assert.match(markup, /POINTS/);
    assert.match(markup, /SHOW DATA TABLE/);
    assert.equal(markup.includes('<240>'), false);
    assert.equal(markup.includes('height="-'), false);
    assert.equal(markup.includes('NaN'), false);
    assert.equal(markup.includes('Infinity'), false);
    assert.match(markup, /var\(--analytics-/);
  }
  assert.equal(CHART_COLORS.primary, 'var(--analytics-primary)');
  globalThis.document = previousDocument;
});

await check('rich line charts expose an ECharts mount with an accessible table contract', () => {
  const previousDocument = globalThis.document;
  let markup = '';
  globalThis.document = {};
  const container = {
    set innerHTML(value) { markup = value; },
    get firstElementChild() { return {}; },
    getAttribute(name) { return name === 'aria-labelledby' ? 'rich-chart-title' : null; },
    setAttribute() {},
    querySelector(selector) {
      if (selector.includes('toggle')) return { addEventListener() {}, setAttribute() {}, textContent: '' };
      return { classList: { toggle() {}, contains() { return true; } } };
    }
  };
  renderAnalyticsChart(container, [
    { label: '00:00', value: 12, series: 'human' },
    { label: '06:00', value: 22, series: 'human' },
    { label: '12:00', value: 18, series: 'human' },
    { label: '18:00', value: 31, series: 'human' }
  ], { mode: 'line', title: 'Concurrent players', unit: 'players' });
  assert.match(markup, /class="analytics-chart-engine/);
  assert.match(markup, /data-chart-engine="echarts-svg"/);
  assert.match(markup, /aria-describedby=/);
  assert.match(markup, /class="analytics-chart-table/);
  assert.equal(markup.includes('data-chart-value="31"'), false);
  globalThis.document = previousDocument;
});

await check('categorical bars keep an ECharts mount and table values', () => {
  const previousDocument = globalThis.document;
  let markup = '';
  globalThis.document = {};
  const container = {
    set innerHTML(value) { markup = value; },
    get firstElementChild() { return {}; },
    getAttribute() { return null; },
    setAttribute() {},
    querySelector(selector) {
      if (selector.includes('toggle')) return { addEventListener() {}, setAttribute() {}, textContent: '' };
      return { classList: { toggle() {}, contains() { return true; } } };
    }
  };
  renderAnalyticsChart(container, [
    { label: 'MATCH STARTS', value: 824 },
    { label: 'COMPLETIONS', value: 720 },
    { label: 'STALLS', value: 12 }
  ], { mode: 'bar', title: 'Match reliability', unit: 'matches' });
  assert.match(markup, /class="analytics-chart-engine/);
  assert.match(markup, /data-chart-engine="echarts-svg"/);
  assert.match(markup, /MATCH STARTS/);
  assert.match(markup, /class="analytics-chart-table/);
  globalThis.document = previousDocument;
});

await check('mixed-unit bars use separate scales instead of misleading one-axis comparisons', () => {
  const previousDocument = globalThis.document;
  let markup = '';
  globalThis.document = {};
  const container = {
    set innerHTML(value) { markup = value; },
    get firstElementChild() { return {}; },
    getAttribute() { return null; },
    setAttribute() {},
    querySelector(selector) {
      if (selector.includes('toggle')) return { addEventListener() {}, setAttribute() {}, textContent: '' };
      return { classList: { toggle() {}, contains() { return true; } } };
    }
  };
  renderAnalyticsChart(container, [
    { label: 'STARTS', value: 12, unit: 'matches' },
    { label: 'RECONNECT RATE', value: 0.08, unit: 'percent' }
  ], { mode: 'bar', title: 'Reliability', unit: 'matches' });
  assert.match(markup, /data-chart-engine="echarts-svg"/);
  assert.match(markup, /8%/);
  assert.match(markup, /<th scope="col">Value<\/th>/);
  assert.equal(markup.includes('>0.08<'), false);
  globalThis.document = previousDocument;
});

await check('unknown and forced-colors modes expose the table fallback immediately', () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  let markup = '';
  globalThis.document = {};
  globalThis.window = { matchMedia: query => ({ matches: query.includes('forced-colors') }) };
  const container = { set innerHTML(value) { markup = value; }, get firstElementChild() { return {}; }, getAttribute() { return null; }, setAttribute() {}, querySelector(selector) { return selector.includes('toggle') ? { addEventListener() {}, setAttribute() {}, textContent: '' } : { classList: { toggle() {}, contains() { return false; } } }; } };
  renderAnalyticsChart(container, [{ label: 'A', value: 2 }], { mode: 'unknown', title: 'Fallback' });
  assert.match(markup, /analytics-chart-table"/);
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /HIDE DATA TABLE/);
  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
});

await check('board metric map preserves topology order and remains read-only', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {};
  let markup = '';
  const board = { variant: 'standard-40', tiles: Array.from({ length: 40 }, (_, index) => ({ index, label: `<TILE ${index}>`, value: index })) };
  const container = { set innerHTML(value) { markup = value; }, get firstElementChild() { return {}; }, setAttribute() {}, querySelector() { return null; } };
  const result = renderBoardMetricMap(container, board, { title: 'Board activity' });
  assert.equal(result.tiles.length, 40);
  assert.equal(result.tiles[0].index, 0);
  assert.equal(result.tiles.at(-1).index, 39);
  assert.match(markup, /class="analytics-chart-engine"/);
  assert.match(markup, /data-chart-engine="echarts-svg"/);
  assert.match(markup, /<table/);
  assert.equal(markup.includes('<TILE 0>'), false);
  assert.equal(markup.includes('data-buy'), false);
  globalThis.document = previousDocument;
});

await check('stacked-bar extracts finite segments and mirrors them in table columns', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {};
  let markup = '';
  const container = { set innerHTML(value) { markup = value; }, get firstElementChild() { return {}; }, getAttribute() { return null; }, setAttribute() {}, querySelector(selector) { return selector.includes('toggle') ? { addEventListener() {}, setAttribute() {}, textContent: '' } : { classList: { toggle() {}, contains() { return true; } } }; } };
  renderAnalyticsChart(container, [{ label: 'A', values: { human: 2, ai: 3, bot: Infinity, private: 'bad' } }], { mode: 'stacked-bar', title: 'Modes', unit: 'matches' });
  assert.match(markup, /class="analytics-chart-engine"/);
  assert.match(markup, /data-chart-engine="echarts-svg"/);
  assert.match(markup, /<th scope="col">human<\/th>/);
  assert.match(markup, /<th scope="col">ai<\/th>/);
  assert.equal(markup.includes('Infinity'), false);
  assert.equal(markup.includes('private'), false);
  globalThis.document = previousDocument;
});

await check('board metric map resolves shuffled explicit indexes before positional fallback', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {};
  let markup = '';
  const board = { variant: 'standard-40', tiles: [{ index: 7, label: 'SEVEN', value: 70 }, { index: 0, label: 'ZERO', value: 0 }] };
  const container = { set innerHTML(value) { markup = value; }, get firstElementChild() { return {}; }, setAttribute() {}, querySelector() { return null; } };
  const result = renderBoardMetricMap(container, board);
  assert.equal(result.tiles[0].value, 0);
  assert.equal(result.tiles[7].value, 70);
  assert.match(markup, /0 · ZERO/);
  assert.match(markup, /7 · SEVEN/);
  globalThis.document = previousDocument;
});

await check('stacked-bar omits non-finite segments instead of fabricating zero geometry', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {};
  let markup = '';
  const container = { set innerHTML(value) { markup = value; }, get firstElementChild() { return {}; }, getAttribute() { return null; }, setAttribute() {}, querySelector(selector) { return selector.includes('toggle') ? { addEventListener() {}, setAttribute() {}, textContent: '' } : { classList: { toggle() {}, contains() { return true; } } }; } };
  renderAnalyticsChart(container, [{ label: 'A', values: { human: Infinity, ai: NaN } }], { mode: 'stacked-bar', title: 'Missing modes' });
  assert.equal(markup.match(/class="analytics-chart-table[^"]*"/)?.length, 1);
  assert.equal(markup.includes('fill="var(--analytics-human)"'), false);
  assert.equal(markup.includes('fill="var(--analytics-ai)"'), false);
  assert.match(markup, /<td>N\/A<\/td>/);
  globalThis.document = previousDocument;
});

function fakeElement({ id = '', attrs = {}, value = '' } = {}) {
  const listeners = new Map();
  const attributes = { ...attrs };
  return {
    id,
    value,
    innerHTML: '',
    textContent: '',
    classList: { toggle() {}, contains() { return false; } },
    getAttribute(name) { return name === 'id' ? id : attributes[name] ?? null; },
    setAttribute(name, next) { attributes[name] = String(next); },
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); },
    dispatch(name, event = {}) { listeners.get(name)?.({ preventDefault() {}, ...event }); },
    focus() { this.focused = true; },
    querySelector() { return null; }
  };
}

function fakeAnalyticsDocument({ filters = [], tabs = [], panels = [], controls = [], form = null, grid = null, status = null } = {}) {
  const all = [...filters, ...tabs, ...panels, ...controls, form, grid, status].filter(Boolean);
  return {
    querySelector(selector) {
      if (selector === '#admin-analytics-grid') return grid;
      if (selector === '#admin-analytics-status') return status;
      if (selector === 'form.analytics-filters') return form;
      if (selector.includes('data-analytics-apply')) return all.find(item => item.getAttribute('data-analytics-apply') === '') || null;
      if (selector.includes('data-analytics-reset')) return all.find(item => item.getAttribute('data-analytics-reset') === '') || null;
      if (selector.includes('data-analytics-refresh')) return all.find(item => item.getAttribute('data-analytics-refresh') === '') || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-analytics-filter]') return filters;
      if (selector === '[data-analytics-tab]') return tabs;
      if (selector === '[data-analytics-panel]') return panels;
      if (selector === '[data-analytics-chart]') return [];
      if (selector === '.view') return [];
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible'
  };
}

await check('renders the nested ledger model for every non-overview tab', () => {
  const previousDocument = globalThis.document;
  const grid = fakeElement({ id: 'admin-analytics-grid' });
  const status = fakeElement({ id: 'admin-analytics-status' });
  const panels = [];
  for (const tab of ['match-health', 'rulesets', 'economy', 'events', 'bots', 'quality']) panels.push(fakeElement({ attrs: { 'data-analytics-panel': tab } }));
  globalThis.document = fakeAnalyticsDocument({ panels, grid, status });
  for (const tab of ['match-health', 'rulesets', 'economy', 'events', 'bots', 'quality']) {
    const panel = panels.find(candidate => candidate.getAttribute('data-analytics-panel') === tab);
    renderAnalyticsSnapshot({ filters: { tab }, overview: { kpis: [{ id: 'kpi', value: 1, denominator: 2 }] }, breakdowns: [{ rows: [{ id: tab, value: 3, denominator: 5, completionRate: { value: 0.72, unit: 'percent', sampleSize: 18, numerator: 13, denominator: 18 } }] }] });
    assert.match(panel.innerHTML, new RegExp(`${tab}`));
    assert.match(panel.innerHTML, /denominator<\/b> 5/);
    assert.match(panel.innerHTML, /completionRate<\/b> 72% · UNIT percent · SAMPLE 18 · NUMERATOR 13 · DENOMINATOR 18/);
    assert.match(panel.innerHTML, /class="analytics-read-model" tabindex="0" role="region" aria-label=/);
  }
  globalThis.document = previousDocument;
});

await check('hides overview KPI cards on specialized report tabs', () => {
  const grid = fakeElement({ id: 'admin-analytics-grid' });
  const status = fakeElement({ id: 'admin-analytics-status' });
  const previousDocument = globalThis.document;
  globalThis.document = fakeAnalyticsDocument({ grid, status });
  try {
    renderAnalyticsSnapshot({ filters: { tab: 'economy' }, overview: { kpis: [{ id: 'completion-rate', label: 'Completion rate', value: 0.8 }] }, metrics: {} });
    assert.equal(grid.hidden, true);
    assert.equal(grid.innerHTML, '');
    renderAnalyticsSnapshot({ filters: { tab: 'overview' }, overview: { kpis: [{ id: 'completion-rate', label: 'Completion rate', value: 0.8 }] }, metrics: {} });
    assert.equal(grid.hidden, false);
    assert.match(grid.innerHTML, /Completion rate/i);
  } finally {
    globalThis.document = previousDocument;
  }
});

await check('tab activation requests the selected tab while retaining the last snapshot', async () => {
  const overviewTab = fakeElement({ attrs: { 'data-analytics-tab': 'overview' } });
  const economyTab = fakeElement({ attrs: { 'data-analytics-tab': 'economy' } });
  const overviewPanel = fakeElement({ attrs: { 'data-analytics-panel': 'overview' } });
  const economyPanel = fakeElement({ attrs: { 'data-analytics-panel': 'economy' } });
  const grid = fakeElement({ id: 'admin-analytics-grid' });
  const status = fakeElement({ id: 'admin-analytics-status' });
  const previousDocument = globalThis.document;
  globalThis.document = fakeAnalyticsDocument({ tabs: [overviewTab, economyTab], panels: [overviewPanel, economyPanel], grid, status });
  const urls = [];
  const controller = createAnalyticsController({ fetcher: async url => { urls.push(url); return { success: true, generatedAt: '2026-09-14T00:00:00Z', filters: { tab: new URL(url, 'https://poorup.test').searchParams.get('tab') }, overview: { kpis: [{ id: 'completed-rounds', value: 1, denominator: 1 }] }, breakdowns: [{ startedMatches: 3 }] }; } });
  await controller.load({ range: 'day', seasonId: 'S1', rulesetRevision: 3, balanceRevision: 4 });
  const before = grid.innerHTML;
  economyTab.dispatch('click');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(urls.length, 2);
  assert.match(urls[1], /tab=economy/);
  assert.match(urls[1], /seasonId=S1/);
  assert.match(urls[1], /rulesetRevision=3/);
  assert.match(urls[1], /balanceRevision=4/);
  assert.equal(grid.hidden, true);
  assert.equal(grid.innerHTML, '');
  assert.equal(before.length > 0, true);
  controller.destroy();
  globalThis.document = previousDocument;
});

await check('analytics form submit prevents navigation and applies season/revision filters', async () => {
  const form = fakeElement();
  const season = fakeElement({ attrs: { 'data-analytics-filter': 'seasonId' }, value: 'season 7' });
  const ruleset = fakeElement({ attrs: { 'data-analytics-filter': 'rulesetRevision' }, value: '2' });
  const balance = fakeElement({ attrs: { 'data-analytics-filter': 'balanceRevision' }, value: '8' });
  const grid = fakeElement({ id: 'admin-analytics-grid' });
  const status = fakeElement({ id: 'admin-analytics-status' });
  const previousDocument = globalThis.document;
  globalThis.document = fakeAnalyticsDocument({ filters: [season, ruleset, balance], form, grid, status });
  const urls = [];
  const controller = createAnalyticsController({ fetcher: async url => { urls.push(url); return { success: true, overview: { kpis: [] } }; } });
  await controller.load();
  let prevented = false;
  form.dispatch('submit', { preventDefault() { prevented = true; } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(prevented, true);
  assert.match(urls.at(-1), /seasonId=season\+7/);
  assert.match(urls.at(-1), /rulesetRevision=2/);
  assert.match(urls.at(-1), /balanceRevision=8/);
  controller.destroy();
  globalThis.document = previousDocument;
});

await check('empty snapshots expose a safe reset-filter action', () => {
  const panel = fakeElement({ attrs: { 'data-analytics-panel': 'overview' } });
  const grid = fakeElement({ id: 'admin-analytics-grid' });
  const status = fakeElement({ id: 'admin-analytics-status' });
  const previousDocument = globalThis.document;
  globalThis.document = fakeAnalyticsDocument({ panels: [panel], grid, status });
  renderAnalyticsSnapshot({ filters: { tab: 'overview' }, overview: { kpis: [] }, metrics: {} });
  assert.match(grid.innerHTML, /NO VERIFIED OBSERVATIONS/);
  assert.match(panel.innerHTML, /data-analytics-reset/);
  globalThis.document = previousDocument;
});

await check('unauthorized snapshots clear rendered data and use distinct status', async () => {
  const grid = fakeElement({ id: 'admin-analytics-grid' });
  grid.innerHTML = '<p>private</p>';
  const readModel = fakeElement();
  readModel.className = 'analytics-read-model';
  readModel.textContent = 'private read model';
  const chart = fakeElement();
  const previousDocument = globalThis.document;
  globalThis.document = fakeAnalyticsDocument({ grid, status: fakeElement({ id: 'admin-analytics-status' }) });
  const originalQuerySelectorAll = globalThis.document.querySelectorAll;
  globalThis.document.querySelectorAll = selector => selector.includes('analytics-read-model') || selector.includes('data-analytics-chart') ? [readModel, chart] : originalQuerySelectorAll(selector);
  const status = globalThis.document.querySelector('#admin-analytics-status');
  const controller = createAnalyticsController({ fetcher: async () => ({ success: false, status: 403 }) });
  await controller.load();
  assert.equal(grid.textContent, '');
  assert.equal(readModel.textContent, '');
  assert.equal(chart.textContent, '');
  assert.equal(status.textContent, 'ADMIN ACCESS REQUIRED');
  controller.destroy();
  globalThis.document = previousDocument;
});

await check('reset filters synchronizes native controls before the next apply', async () => {
  const reset = fakeElement({ attrs: { 'data-analytics-reset': '' } });
  const season = fakeElement({ attrs: { 'data-analytics-filter': 'seasonId' }, value: 'S7' });
  const ruleset = fakeElement({ attrs: { 'data-analytics-filter': 'rulesetRevision' }, value: '4' });
  const grid = fakeElement({ id: 'admin-analytics-grid' });
  const status = fakeElement({ id: 'admin-analytics-status' });
  const previousDocument = globalThis.document;
  globalThis.document = fakeAnalyticsDocument({ filters: [season, ruleset], controls: [reset], grid, status });
  const controller = createAnalyticsController({ fetcher: async () => ({ success: true, overview: { kpis: [] } }) });
  reset.dispatch('click');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(season.value, '');
  assert.equal(ruleset.value, '');
  controller.destroy();
  globalThis.document = previousDocument;
});

await check('a single retry control click performs one fetch', async () => {
  const retry = fakeElement({ attrs: { 'data-analytics-refresh': '' } });
  const grid = fakeElement({ id: 'admin-analytics-grid' });
  const status = fakeElement({ id: 'admin-analytics-status' });
  const previousDocument = globalThis.document;
  globalThis.document = fakeAnalyticsDocument({ controls: [retry], grid, status });
  let calls = 0;
  const controller = createAnalyticsController({ fetcher: async () => { calls += 1; return { success: true, overview: { kpis: [] } }; } });
  retry.dispatch('click');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  controller.destroy();
  globalThis.document = previousDocument;
});

await check('controller suppresses duplicate loads and exposes tab/filter hooks', async () => {
  let calls = 0;
  const controller = createAnalyticsController({ fetcher: async () => { calls += 1; return { success: true, schemaVersion: 1, overview: { kpis: [] } }; } });
  const first = controller.load({ range: 'day' });
  const second = controller.load({ range: 'day' });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(controller.setTab('economy').tab, 'economy');
  assert.equal(controller.setFilters({ botMode: 'AI' }).botMode, 'ai');
  controller.destroy();
});
