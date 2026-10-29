/* global process */
import assert from 'node:assert/strict';

globalThis.window = { matchMedia: () => ({ matches: false }), location: { pathname: '/' } };
globalThis.document = { querySelector: () => null };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { normalizeAnalyticsSnapshot, normalizeAnalyticsQuery, metricValue, isAnalyticsPath, createAnalyticsController, renderAnalyticsSnapshot, ANALYTICS_PANEL_DESCRIPTORS, ALLOWED_METRICS } = await import('./clientAnalytics.js');
const { ANALYTICS_TABS, ANALYTICS_FILTERS, ANALYTICS_RANGES, ANALYTICS_VIEWS, SECTIONS, PANEL_DEFINITIONS, OVERVIEW_KPIS, resolveTab, sectionOf, tabForSection } = await import('./clientAnalyticsCatalog.js');
const { normalizeAnalyticsQuery: viewModelQuery, normalizeAnalyticsSnapshot: viewModelSnapshot } = await import('./clientAnalyticsViewModel.js');
const { renderAnalyticsChart, renderBoardMetricMap, CHART_COLORS } = await import('./clientAnalyticsCharts.js');
const { kpiMarkup, kpiState } = await import('./clientAnalyticsKpis.js');
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

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// A small DOM stand-in: elements keep attributes, classes and listeners; the document answers
// selector lookups from a map, so a test declares exactly the nodes the console should find.
function fakeElement({ attrs = {}, value = '' } = {}) {
  const listeners = new Map();
  const attributes = { ...attrs };
  const classes = new Set();
  return {
    value,
    innerHTML: '',
    textContent: '',
    hidden: false,
    disabled: false,
    isConnected: true,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle: (name, force) => ((force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name)),
      contains: name => classes.has(name),
    },
    get id() { return attributes.id ?? ''; },
    getAttribute(name) { return attributes[name] ?? null; },
    setAttribute(name, next) { attributes[name] = String(next); },
    hasAttribute(name) { return name in attributes; },
    removeAttribute(name) { delete attributes[name]; },
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); },
    dispatch(name, event = {}) { listeners.get(name)?.({ preventDefault() {}, ...event }); },
    focus() { this.focused = true; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function fakeDocument({ one = {}, many = {} } = {}) {
  return {
    querySelector: selector => one[selector] || null,
    querySelectorAll: selector => many[selector] || [],
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
    hidden: false,
  };
}

function withGlobals(overrides, run) {
  const previous = {};
  for (const key of Object.keys(overrides)) previous[key] = globalThis[key];
  Object.assign(globalThis, overrides);
  const restore = () => { for (const key of Object.keys(overrides)) globalThis[key] = previous[key]; };
  try {
    const result = run();
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) { restore(); throw error; }
}

const adminWindow = (search = '', replacements = []) => ({ location: { pathname: '/admin/analytics', search }, history: { replaceState: (_s, _t, url) => replacements.push(url) }, matchMedia: () => ({ matches: false }) });

const SIX = [
  { id: 'peak-24h', label: '24h peak', value: 183, unit: 'players', definition: 'Maximum human-player minute bucket.' },
  { id: 'started', label: 'Games started', value: 824, unit: 'matches', definition: 'Verified server starts.' },
  { id: 'completion-rate', label: 'Completion rate', value: 0.874, unit: 'percent', numerator: 720, denominator: 824, comparison: { period: 'previous-day', delta: 0.013 }, definition: 'Completed divided by started.', generatedAt: '2026-09-15T12:00:00.000Z' },
  { id: 'p95-action-latency', label: 'P95 action latency', value: 1.8, unit: 'seconds', definition: 'Successful action latency.' },
  { id: 'error-rate', label: 'Error rate', value: 0.004, unit: 'percent', denominator: 10000, definition: 'Failed requests.' },
  { id: 'online-now', label: 'Online now', value: 42, unit: 'players', definition: 'Active human seats.' },
];

await check('accepts only the internal analytics path', () => {
  assert.equal(isAnalyticsPath('/admin/analytics'), true);
  assert.equal(isAnalyticsPath('/analytics'), false);
  assert.equal(isAnalyticsPath('/admin/analytics?range=day'), true);
});

await check('catalog is six rail sections, four windows and six headline tiles in contract order', () => {
  assert.deepEqual(ANALYTICS_TABS, ['status', 'rooms', 'matches', 'bots', 'economy', 'release']);
  assert.deepEqual(ANALYTICS_RANGES, ['hour', 'day', 'week', 'month']);
  assert.deepEqual(ANALYTICS_FILTERS, ['range', 'boardVariant', 'marketComplexity', 'botMode']);
  assert.equal(Object.keys(PANEL_DEFINITIONS).length, 6);
  for (const tab of ANALYTICS_TABS) assert.equal(typeof PANEL_DEFINITIONS[tab].question, 'string');
  assert.deepEqual(OVERVIEW_KPIS.map(item => item.id), ['online-now', 'error-rate', 'p95-action-latency', 'completion-rate', 'started', 'peak-24h']);
});

await check('navigation is four surfaces; Analytics holds three views, and every tab id maps to one surface', () => {
  assert.deepEqual(SECTIONS, ['analytics', 'rooms', 'bots', 'release']);
  assert.deepEqual(ANALYTICS_VIEWS, ['status', 'matches', 'economy']);
  for (const [tab, section] of [['status', 'analytics'], ['matches', 'analytics'], ['economy', 'analytics'], ['rooms', 'rooms'], ['bots', 'bots'], ['release', 'release']]) assert.equal(sectionOf(tab), section, tab);
  for (const hostile of ['__proto__', 'constructor', 'toString', 'nonsense']) assert.equal(sectionOf(hostile), 'analytics', hostile);
  assert.equal(tabForSection('analytics', 'economy'), 'economy', 'Analytics reopens the view that was last open');
  assert.equal(tabForSection('analytics', '__proto__'), 'status');
  assert.equal(tabForSection('rooms', 'economy'), 'rooms');
  assert.equal(tabForSection('constructor'), 'status');
});

await check('tab lookup is an own-property allowlist with legacy aliases', () => {
  assert.equal(resolveTab('overview'), 'status');
  assert.equal(resolveTab('match-health'), 'matches');
  assert.equal(resolveTab('MATCHES'), 'matches');
  assert.equal(resolveTab('bots'), 'bots');
  for (const hostile of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', undefined, null, 42, 'rulesets', 'quality']) assert.equal(resolveTab(hostile), 'status', String(hostile));
});

await check('view model keeps the minimum cohort fixed and rejects unknown query fields', () => {
  const query = viewModelQuery({ minimumCohort: 1, accountId: 'raw', unknown: 'drop', boardVariant: 'METRO-52' });
  assert.equal(query.minimumCohort, 5);
  assert.equal(query.boardVariant, 'metro-52');
  assert.equal(query.accountId, undefined);
  assert.equal(query.unknown, undefined);
  assert.equal(viewModelSnapshot({ suppression: { minimumCohort: 1 } }).suppression.minimumCohort, 5);
});

await check('the query normalizer no longer carries the dead filters', () => {
  const query = normalizeAnalyticsQuery({ range: 'season', seasonId: 'S1', eventId: 'e1', rulesetRevision: 3, balanceRevision: 4, provider: 'openai', botMode: 'AI', view: 'economy', dimension: 'feature', metric: 'loan-adoption' });
  assert.deepEqual(query, { range: 'month', boardVariant: 'all', marketComplexity: 'all', botMode: 'ai', minimumCohort: 5, tab: 'economy', dimension: 'feature', metric: 'loan-adoption' });
  for (const dead of ['seasonId', 'eventId', 'rulesetRevision', 'balanceRevision', 'provider']) assert.equal(Object.hasOwn(query, dead), false, dead);
  for (const range of ['hour', 'day', 'week', 'month']) assert.equal(normalizeAnalyticsQuery({ range }).range, range);
  assert.equal(normalizeAnalyticsQuery({ range: 'year' }).range, 'hour');
  assert.equal(normalizeAnalyticsQuery({ tab: 'overview' }).tab, 'status');
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

await check('the CodeScene metric is gone from the allowlist and from the labels', () => {
  assert.equal(ALLOWED_METRICS.has('manual-codescene-runs'), false);
  const snapshot = normalizeAnalyticsSnapshot({ metrics: { 'manual-codescene-runs': { value: 3 }, 'error-count': { value: 2 } } });
  assert.equal(snapshot.metrics['manual-codescene-runs'], undefined);
  assert.equal(snapshot.metrics['error-count'].value, 2);
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
    filters: { range: 'day', accountId: 'do-not-keep' },
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

await check('snapshots keep the version metadata but no longer carry season or revision dimensions', () => {
  const snapshot = normalizeAnalyticsSnapshot({ schemaVersion: 1, pseudonymVersion: 'hmac-v1', range: 'season', seasonId: 's', rulesetRevision: 2, balanceRevision: 3, boardVariant: 'metro-52', overview: { unknownField: 'drop', kpis: [] } });
  assert.equal(snapshot.pseudonymVersion, 'hmac-v1');
  assert.equal(snapshot.range, 'month', 'an old season response reads as the 30-day window');
  assert.equal(snapshot.boardVariant, 'metro-52');
  for (const dead of ['seasonId', 'rulesetRevision', 'balanceRevision']) assert.equal(Object.hasOwn(snapshot, dead), false, dead);
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

function chartContainer(label = null) {
  let markup = '';
  return {
    get markup() { return markup; },
    set innerHTML(value) { markup = value; },
    get firstElementChild() { return {}; },
    getAttribute(name) { return name === 'aria-labelledby' ? label : null; },
    setAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

await check('chart markup shows the table beside the plot, with non-negative bars and no toggle', () => {
  withGlobals({ document: {} }, () => {
    const container = chartContainer('analytics-chart-title');
    renderAnalyticsChart(container, [{ label: 'loss', value: -4 }], { mode: 'bar' });
    assert.match(container.markup, /class="analytics-chart-split"/);
    // The verified table is read out to assistive technology, never drawn beside the chart.
    assert.match(container.markup, /class="analytics-chart-data sr-only" id="analytics-chart-table-\d+"/);
    assert.doesNotMatch(container.markup, /role="region"|tabindex="0"/, 'a hidden table is not a keyboard stop');
    assert.match(container.markup, /id="analytics-chart-title"/);
    assert.match(container.markup, /class="analytics-chart-engine"/);
    assert.doesNotMatch(container.markup, /analytics-chart-table-toggle|SHOW DATA TABLE|HIDE DATA TABLE|aria-expanded/);
    assert.equal(container.markup.includes('height="-'), false);
  });
});

await check('chart adapter supports every declared mode with bounded accessible output', () => {
  withGlobals({ document: {} }, () => {
    const modes = ['line', 'bar', 'stacked-bar', 'heatmap', 'histogram', 'box', 'scatter', 'funnel', 'cohort', 'board'];
    for (const mode of modes) {
      const container = chartContainer();
      renderAnalyticsChart(container, Array.from({ length: 240 }, (_, index) => ({ label: `<${index}>`, value: index % 7 - 3, series: index % 2 ? 'AI' : 'HUMAN' })), { mode, title: `<${mode}>`, unit: 'rounds', sampleSize: 240 });
      const { markup } = container;
      assert.match(markup, /<figure/);
      assert.match(markup, /<figcaption/);
      assert.match(markup, /POINTS/);
      const drawn = mode === 'line' || mode === 'bar';
      assert.match(markup, /class="analytics-chart-data(?: sr-only)?"/, 'every mode carries its verified table');
      assert.equal(/class="analytics-chart-data sr-only"/.test(markup), drawn, 'drawn modes hide the table visually; modes with no drawing show it');
      assert.equal(markup.includes('class="analytics-chart-engine"'), drawn, drawn ? 'drawn modes get an engine slot' : 'undrawn modes have no engine slot');
      assert.equal(markup.includes('<240>'), false);
      assert.equal(markup.includes('NaN'), false);
      assert.equal(markup.includes('Infinity'), false);
    }
    assert.equal(CHART_COLORS.primary, 'var(--analytics-primary)');
  });
});

await check('mixed-unit bars use separate scales and keep a unit column', () => {
  withGlobals({ document: {} }, () => {
    const container = chartContainer();
    renderAnalyticsChart(container, [
      { label: 'STARTS', value: 12, unit: 'matches' },
      { label: 'RECONNECT RATE', value: 0.08, unit: 'percent' }
    ], { mode: 'bar', title: 'Reliability', unit: 'matches' });
    assert.equal((container.markup.match(/class="analytics-chart-engine"/g) || []).length, 2, 'each unit gets its own chart and scale');
    assert.match(container.markup, /8%/);
    assert.match(container.markup, /<th scope="col">Value<\/th>/);
    assert.match(container.markup, /<th scope="col">Unit<\/th>/);
    assert.equal(container.markup.includes('>0.08<'), false);
  });
});

await check('board metric map preserves topology order and remains read-only', () => {
  withGlobals({ document: {} }, () => {
    let markup = '';
    const board = { variant: 'standard-40', tiles: Array.from({ length: 40 }, (_, index) => ({ index, label: `<TILE ${index}>`, value: index })) };
    const container = { set innerHTML(value) { markup = value; }, get firstElementChild() { return {}; }, setAttribute() {}, querySelector() { return null; } };
    const result = renderBoardMetricMap(container, board, { title: 'Board activity' });
    assert.equal(result.tiles.length, 40);
    assert.equal(result.tiles[0].index, 0);
    assert.equal(result.tiles.at(-1).index, 39);
    assert.doesNotMatch(markup, /data-chart-engine=/, 'board maps are a verified table, not an engine');
    assert.match(markup, /class="analytics-chart-data"/);
    assert.match(markup, /<table/);
    assert.equal(markup.includes('<TILE 0>'), false);
    assert.equal(markup.includes('data-buy'), false);
  });
});

await check('stacked-bar extracts finite segments and mirrors them in table columns', () => {
  withGlobals({ document: {} }, () => {
    const container = chartContainer();
    renderAnalyticsChart(container, [{ label: 'A', values: { human: 2, ai: 3, bot: Infinity, private: 'bad' } }], { mode: 'stacked-bar', title: 'Modes', unit: 'matches' });
    assert.doesNotMatch(container.markup, /data-chart-engine=/, 'stacked bars are table-only now');
    assert.match(container.markup, /<th scope="row">A<\/th>/);
    assert.equal(container.markup.includes('Infinity'), false);
    assert.equal(container.markup.includes('private'), false);
  });
});

await check('board metric map resolves shuffled explicit indexes before positional fallback', () => {
  withGlobals({ document: {} }, () => {
    let markup = '';
    const board = { variant: 'standard-40', tiles: [{ index: 7, label: 'SEVEN', value: 70 }, { index: 0, label: 'ZERO', value: 0 }] };
    const container = { set innerHTML(value) { markup = value; }, get firstElementChild() { return {}; }, setAttribute() {}, querySelector() { return null; } };
    const result = renderBoardMetricMap(container, board);
    assert.equal(result.tiles[0].value, 0);
    assert.equal(result.tiles[7].value, 70);
    assert.match(markup, /0 · ZERO/);
    assert.match(markup, /7 · SEVEN/);
  });
});

await check('stacked-bar omits non-finite segments instead of fabricating zero geometry', () => {
  withGlobals({ document: {} }, () => {
    const container = chartContainer();
    renderAnalyticsChart(container, [{ label: 'A', values: { human: Infinity, ai: NaN } }], { mode: 'stacked-bar', title: 'Missing modes' });
    assert.equal(container.markup.match(/class="analytics-chart-table[^"]*"/)?.length, 1);
    assert.equal(container.markup.includes('fill="var(--analytics-human)"'), false);
    assert.match(container.markup, /<td>N\/A<\/td>/);
  });
});

await check('panel descriptors cover the three chart sections and build their points from the snapshot', () => {
  assert.deepEqual(Object.keys(ANALYTICS_PANEL_DESCRIPTORS), ['status', 'matches', 'economy']);
  const snapshot = normalizeAnalyticsSnapshot({ series: [{ label: '12:00', value: 4 }], breakdowns: [{ starts: 12, reconnectRate: { value: 0.08, denominator: 12 }, adoption: { loans: { value: 0.4, denominator: 20 } } }] });
  assert.equal(ANALYTICS_PANEL_DESCRIPTORS.status.series(snapshot).length, 1);
  const matches = ANALYTICS_PANEL_DESCRIPTORS.matches.series(snapshot);
  assert.deepEqual(matches.map(point => point.label), ['Starts', 'Reconnect rate']);
  assert.equal(matches[1].denominator, 12);
  assert.equal(ANALYTICS_PANEL_DESCRIPTORS.economy.series(snapshot)[0].label, 'loans');
});

await check('the six tiles render in contract order whatever order the server sends them', () => {
  const markup = kpiMarkup({ overview: { kpis: SIX } });
  const ids = [...markup.matchAll(/data-kpi-id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids, ['online-now', 'error-rate', 'p95-action-latency', 'completion-rate', 'started', 'peak-24h']);
});

await check('a tile shows value, delta, real denominator and the definition as its title, with no per-card clutter', () => {
  const markup = kpiMarkup({ overview: { kpis: SIX } });
  const completion = markup.match(/<li[^>]+data-kpi-id="completion-rate"[\s\S]*?<\/li>/)[0];
  assert.match(completion, /87\.4%|87,4%/);
  assert.doesNotMatch(completion.replace(/title="[^"]*"/, '').replace(/<span class="sr-only">[\s\S]*?<\/span>/, ''), /720|824/, 'the card itself carries no ratio line');
  assert.match(completion, /\+1[.,]3pp vs previous day/);
  assert.match(completion, /title="Completed divided by started\. · 720 of 824"/, 'definition and real denominator live in the title');
  assert.match(completion, /class="sr-only">Completed divided by started\. · 720 of 824/);
  assert.doesNotMatch(markup, /VERIFIED \d{4}|COMPARISON UNAVAILABLE|BASELINE|DEFINITION NOT PROVIDED|NUMERATOR|DENOMINATOR/);
  const error = markup.match(/<li[^>]+data-kpi-id="error-rate"[\s\S]*?<\/li>/)[0];
  assert.match(error, /title="Failed requests\. · of 10[.,]?000"/, 'a rate keeps the denominator it was computed from');
  assert.doesNotMatch(error, /admin-kpi-delta/, 'no delta line when the server sent no comparison');
});

await check('a tile is amber or red only when the server said so', () => {
  assert.equal(kpiState({ id: 'error-rate', value: 0.2 }), 'none', 'no state and no thresholds: no colour');
  assert.equal(kpiState({ id: 'error-rate', value: 0.2, state: 'bad' }), 'bad');
  assert.equal(kpiState({ id: 'error-rate', value: 0.2, state: 'nonsense' }), 'none');
  assert.equal(kpiState({ id: 'x', value: 3, thresholds: { warn: 2, bad: 5 } }), 'warn');
  assert.equal(kpiState({ id: 'x', value: 6, thresholds: { warn: 2, bad: 5 } }), 'bad');
  assert.equal(kpiState({ id: 'x', value: 1, thresholds: { warn: 2, bad: 5 } }), 'ok');
  assert.match(kpiMarkup({ overview: { kpis: [{ id: 'error-rate', label: 'Error rate', value: 0.2, unit: 'percent', state: 'warn' }] } }), /data-kpi-state="warn"[\s\S]*WATCH/);
  const sanitized = normalizeAnalyticsSnapshot({ overview: { kpis: [{ id: 'error-rate', value: 0.2, state: 'bad', thresholds: { warn: 0.01, bad: 0.05, secret: 'x' } }] } });
  assert.equal(sanitized.overview.kpis[0].state, 'bad');
  assert.equal(sanitized.overview.kpis[0].thresholds.secret, undefined);
});

await check('rendering a snapshot fills the tiles and the chart section and reports one freshness chip', () => {
  const grid = fakeElement();
  const chip = fakeElement();
  const chartBox = fakeElement();
  const sections = {};
  for (const name of ['kpis', 'report-status']) sections[name] = fakeElement();
  withGlobals({ document: fakeDocument({ one: { '#admin-analytics-grid': grid, '#admin-analytics-status': chip, '[data-section="kpis"]': sections.kpis, '[data-section="report-status"]': sections['report-status'], '[data-analytics-panel="status"] [data-analytics-chart]': chartBox } }) }, () => {
    renderAnalyticsSnapshot({ generatedAt: '2026-09-15T12:00:00.000Z', filters: { tab: 'overview' }, overview: { kpis: SIX }, series: [{ label: '12:00', value: 5 }], dataQuality: { fresh: true } }, 'status');
    assert.equal((grid.innerHTML.match(/<li /g) || []).length, 6);
    assert.match(chip.textContent, /^SYNCED · 12:00:00 UTC$/);
    assert.equal(chip.getAttribute('data-analytics-state'), 'verified');
    assert.equal(sections.kpis.getAttribute('data-section-kind'), 'ready');
    assert.equal(sections['report-status'].getAttribute('data-section-kind'), 'ready');
    assert.match(chartBox.innerHTML, /analytics-chart/);
    assert.doesNotMatch(grid.innerHTML, /<table|data-analytics-export/);
  });
});

await check('stale and suppressed snapshots say so in the chip', () => {
  const chip = fakeElement();
  withGlobals({ document: fakeDocument({ one: { '#admin-analytics-status': chip } }) }, () => {
    renderAnalyticsSnapshot({ generatedAt: '2026-09-15T12:00:00.000Z', dataQuality: { stale: true } }, 'status');
    assert.match(chip.textContent, /^STALE · LAST VERIFIED/);
    renderAnalyticsSnapshot({ suppression: { suppressedPanels: 1 } }, 'status');
    assert.match(chip.textContent, /MIN COHORT 5/);
  });
});

await check('an empty snapshot shows an empty state instead of blank tiles', () => {
  const grid = fakeElement();
  const kpis = fakeElement();
  const state = fakeElement();
  const body = fakeElement();
  kpis.querySelector = selector => (selector === '[data-section-state]' ? state : selector === '[data-section-body]' ? body : null);
  withGlobals({ document: fakeDocument({ one: { '#admin-analytics-grid': grid, '[data-section="kpis"]': kpis } }) }, () => {
    renderAnalyticsSnapshot({ overview: { kpis: [] }, metrics: {} }, 'status');
    assert.equal(kpis.getAttribute('data-section-kind'), 'empty');
    assert.match(state.textContent, /NO VERIFIED OBSERVATIONS/);
    assert.equal(kpis.classList.contains('is-hidden'), true, 'an empty tile row is not drawn: the chart area says it once');
    assert.equal(grid.innerHTML, '');
  });
});

// A section stand-in with a real message slot, so a test can read what the operator would read.
function messageSection() {
  const section = fakeElement();
  const message = fakeElement();
  const body = fakeElement();
  section.querySelector = selector => (selector === '[data-section-state]' ? message : selector === '[data-section-body]' ? body : null);
  return { section, message, body };
}

const ZERO_KPIS = [{ id: 'started', label: 'Matches started', value: 0, unit: 'matches' }, { id: 'completion-rate', label: 'Completion rate', value: null, unit: 'percent', numerator: 0, denominator: 0 }];

await check('an empty rollup reads as nothing to measure in the chip, never as STALE', () => {
  const chip = fakeElement();
  withGlobals({ document: fakeDocument({ one: { '#admin-analytics-status': chip } }) }, () => {
    renderAnalyticsSnapshot({ generatedAt: '2026-09-15T12:00:00.000Z', dataQuality: { fresh: true, stale: false, empty: true } }, 'status');
    assert.match(chip.textContent, /^NOTHING TO MEASURE YET/);
    assert.doesNotMatch(chip.textContent, /STALE/);
    assert.equal(chip.getAttribute('data-analytics-state'), 'empty');
    // The same chip still calls a rollup that is genuinely old STALE.
    renderAnalyticsSnapshot({ generatedAt: '2026-09-15T12:00:00.000Z', dataQuality: { fresh: false, stale: true, empty: false } }, 'status');
    assert.match(chip.textContent, /^STALE/);
  });
});

await check('Matches and Economy say no completed matches in this window yet when nothing started', () => {
  for (const [tab, breakdown] of [['matches', { starts: 0, completions: 0, stalls: 0, reconnectRate: { value: null, denominator: 0 } }], ['economy', { adoption: {} }]]) {
    const { section, message } = messageSection();
    const chartBox = fakeElement();
    chartBox.textContent = 'an earlier chart';
    withGlobals({ document: fakeDocument({ one: { [`[data-section="report-${tab}"]`]: section, [`[data-analytics-panel="${tab}"] [data-analytics-chart]`]: chartBox } }) }, () => {
      renderAnalyticsSnapshot({ generatedAt: '2026-09-15T12:00:00.000Z', filters: { tab: tab === 'matches' ? 'match-health' : 'economy' }, overview: { kpis: ZERO_KPIS }, breakdowns: [breakdown], dataQuality: { fresh: true, stale: false, empty: true } }, tab);
    });
    assert.equal(section.getAttribute('data-section-kind'), 'empty', tab);
    assert.equal(message.textContent, 'No completed matches in this window yet', tab);
    assert.equal(chartBox.textContent, '', `${tab}: no chart of zeros is drawn`);
  }
});

await check('a window with started matches still draws its chart and keeps the old empty text for a panel without figures', () => {
  const { section } = messageSection();
  const chartBox = fakeElement();
  withGlobals({ document: fakeDocument({ one: { '[data-section="report-matches"]': section, '[data-analytics-panel="matches"] [data-analytics-chart]': chartBox } }) }, () => {
    renderAnalyticsSnapshot({ filters: { tab: 'match-health' }, overview: { kpis: [{ id: 'started', value: 4, unit: 'matches' }] }, breakdowns: [{ starts: 4, completions: 3, stalls: 0 }], dataQuality: { fresh: true, empty: false } }, 'matches');
  });
  assert.equal(section.getAttribute('data-section-kind'), 'ready');
  assert.match(chartBox.innerHTML, /analytics-chart/);
  const economy = messageSection();
  withGlobals({ document: fakeDocument({ one: { '[data-section="report-economy"]': economy.section } }) }, () => {
    renderAnalyticsSnapshot({ filters: { tab: 'economy' }, overview: { kpis: [{ id: 'started', value: 4, unit: 'matches' }] }, breakdowns: [{ adoption: {} }] }, 'economy');
  });
  assert.equal(economy.message.textContent, 'NO VERIFIED OBSERVATIONS FOR THIS PANEL');
});

await check('Economy renders adoption and market outcome measures with correct units and honest denominators', () => {
  const { section } = messageSection();
  const chartBox = fakeElement();
  withGlobals({ document: fakeDocument({ one: { '[data-section="report-economy"]': section, '[data-analytics-panel="economy"] [data-analytics-chart]': chartBox } }) }, () => {
    renderAnalyticsSnapshot({ filters: { tab: 'economy' }, overview: { kpis: [{ id: 'started', value: 20, unit: 'matches' }] }, breakdowns: [{ adoption: { loans: { value: 0.42, numerator: 8, denominator: 19 }, auctions: { value: 0.28, denominator: 18 } }, volatility: { value: 0.17, sampleSize: 20 }, liquidationRate: { value: 0.06, denominator: 20 }, shortDefaultRate: { value: 0.02, denominator: 10 }, optionExerciseRate: { value: 0, denominator: 8 }, negativeCashPrevention: { value: 3, denominator: 20 } }] }, 'economy');
  });
  assert.match(chartBox.innerHTML, /Player loans/);
  assert.match(chartBox.innerHTML, /42%/);
  assert.match(chartBox.innerHTML, /8 of 19 eligible matches/);
  assert.match(chartBox.innerHTML, /Auctions/);
  assert.match(chartBox.innerHTML, /18 eligible matches/);
  assert.match(chartBox.innerHTML, /role="progressbar"/);
  assert.match(chartBox.innerHTML, /Market outcomes/);
  assert.match(chartBox.innerHTML, /Median market volatility[\s\S]*0[,.]17[\s\S]*20 volatility observations/);
  assert.match(chartBox.innerHTML, /Margin liquidation rate[\s\S]*6%[\s\S]*20 margin positions/);
  assert.match(chartBox.innerHTML, /Short default rate[\s\S]*2%[\s\S]*10 short positions/);
  assert.match(chartBox.innerHTML, /Option exercise rate[\s\S]*0%[\s\S]*8 collateralized options/);
  assert.match(chartBox.innerHTML, /Negative cash prevented[\s\S]*3[\s\S]*20 matches started/);
  assert.doesNotMatch(chartBox.innerHTML, /analytics-chart-engine/);
});

await check('Economy reports missing market measures as not recorded and preserves observed zero rates', () => {
  const chartBox = fakeElement();
  const { section } = messageSection();
  withGlobals({ document: fakeDocument({ one: { '[data-section="report-economy"]': section, '[data-analytics-panel="economy"] [data-analytics-chart]': chartBox } }) }, () => {
    renderAnalyticsSnapshot({ filters: { tab: 'economy' }, overview: { kpis: [{ id: 'started', value: 1 }] }, breakdowns: [{ adoption: {}, liquidationRate: { value: 0, denominator: 0 } }] }, 'economy');
  });
  assert.match(chartBox.innerHTML, /0%/);
  assert.match(chartBox.innerHTML, /0 margin positions/);
  assert.equal((chartBox.innerHTML.match(/Not recorded/g) || []).length, 4);
  assert.doesNotMatch(chartBox.innerHTML, /NaN|undefined/);
});

await check('controller reports rollup unavailable when fetch is missing', () => withGlobals({
  window: adminWindow(),
  fetch: undefined,
  document: fakeDocument({ one: { '#admin-analytics-status': fakeElement() } }),
}, async () => {
  const previousAccount = state.account;
  state.account = { sessionToken: 'session' };
  const status = globalThis.document.querySelector('#admin-analytics-status');
  const controller = createAnalyticsController();
  const result = await controller.load();
  assert.equal(result.status, 503);
  assert.equal(status.textContent, 'ROLLUP UNAVAILABLE · RETRY');
  controller.destroy();
  state.account = previousAccount;
}));

await check('restores the section and window from the URL and writes a clean deep link', () => {
  const replacements = [];
  withGlobals({ window: adminWindow('?view=economy&provider=ai&seasonId=S1&range=week', replacements), document: fakeDocument() }, () => {
    const controller = createAnalyticsController({ fetcher: async () => ({ success: true, overview: { kpis: [] } }) });
    assert.equal(controller.filters.tab, 'economy');
    assert.equal(controller.filters.range, 'week');
    assert.equal(Object.hasOwn(controller.filters, 'provider'), false);
    controller.setTab('bots');
    assert.equal(replacements.at(-1), '/admin/analytics?range=week&tab=bots');
    assert.doesNotMatch(replacements.at(-1), /provider|season|view=/);
    controller.destroy();
  });
});

await check('legacy links land on the right section', () => {
  const cases = [['?tab=overview', 'status'], ['?tab=match-health', 'matches'], ['?admin=provider', 'bots'], ['?tab=nonsense', 'status'], ['?tab=__proto__', 'status'], ['', 'status'], ['?range=season', 'status']];
  for (const [search, expected] of cases) {
    withGlobals({ window: adminWindow(search), document: fakeDocument() }, () => {
      const controller = createAnalyticsController({ fetcher: async () => ({ success: true }) });
      assert.equal(controller.filters.tab, expected, search);
      if (search === '?range=season') assert.equal(controller.filters.range, 'month');
      controller.destroy();
    });
  }
});

await check('balance requests carry the server tab id and the chosen window, and no dead filters', () => withGlobals({
  window: adminWindow('?tab=matches&seasonId=S1&provider=ai'), document: fakeDocument(),
}, async () => {
  const urls = [];
  const controller = createAnalyticsController({ fetcher: async url => { urls.push(url); return { success: true, overview: { kpis: [] } }; } });
  await controller.load({ range: 'week' });
  assert.match(urls[0], /^\/admin\/analytics\/balance\?/);
  const params = new URL(urls[0], 'https://poorup.test').searchParams;
  assert.equal(params.get('tab'), 'match-health');
  assert.equal(params.get('range'), 'week');
  for (const dead of ['seasonId', 'eventId', 'rulesetRevision', 'balanceRevision', 'provider']) assert.equal(params.has(dead), false, dead);
  controller.destroy();
}));

await check('choosing a window reloads the balance report for that window', () => withGlobals({
  window: adminWindow('?tab=economy'), document: fakeDocument(),
}, async () => {
  const urls = [];
  const controller = createAnalyticsController({ fetcher: async url => { urls.push(url); return { success: true, overview: { kpis: [] } }; } });
  controller.setRange('month');
  await tick();
  assert.match(urls.at(-1), /range=month/);
  assert.equal(controller.filters.range, 'month');
  controller.setRange('year');
  assert.equal(controller.filters.range, 'month', 'an unknown window is ignored');
  controller.destroy();
}));

await check('cookie-authenticated analytics requests do not require a JavaScript session token', () => withGlobals({
  window: adminWindow(),
  document: fakeDocument({ one: { '#admin-analytics-status': fakeElement() } }),
  fetch: async (_url, options) => {
    globalThis.__requestOptions = options;
    return { ok: true, status: 200, json: async () => ({ success: true, overview: { kpis: [] } }) };
  },
}, async () => {
  const previousAccount = state.account;
  state.account = { sessionToken: '' };
  const controller = createAnalyticsController();
  const result = await controller.load();
  assert.equal(globalThis.__requestOptions?.credentials, 'include');
  assert.notEqual(result?.status, 403);
  assert.notEqual(globalThis.document.querySelector('#admin-analytics-status').textContent, 'ADMIN ACCOUNT REQUIRED');
  controller.destroy();
  state.account = previousAccount;
  delete globalThis.__requestOptions;
}));

await check('switching sections loads only what that section needs', () => withGlobals({
  window: adminWindow(), document: fakeDocument(),
}, async () => {
  const urls = [];
  const controller = createAnalyticsController({ fetcher: async url => {
    urls.push(url);
    if (url.startsWith('/admin/ops/rooms')) return { success: true, generatedAt: '2026-09-15T12:00:00.000Z', totals: {}, rooms: [] };
    return { success: true, overview: { kpis: [] } };
  }, pollMs: 60_000 });
  controller.setTab('rooms');
  await tick();
  await tick();
  assert.equal(urls.some(url => url.startsWith('/admin/analytics/balance')), false, 'Rooms does not read the analytics rollup');
  assert.equal(urls.some(url => url === '/admin/ops/rooms'), true);
  controller.setTab('matches');
  await tick();
  assert.equal(urls.at(-1).startsWith('/admin/analytics/balance'), true);
  assert.match(urls.at(-1), /tab=match-health/);
  controller.destroy();
}));

await check('unauthorized responses clear the rendered tiles and chart and use a distinct chip', () => {
  const grid = fakeElement();
  grid.innerHTML = '<li>private</li>';
  grid.textContent = 'private';
  const chip = fakeElement();
  const chart = fakeElement();
  chart.textContent = 'private chart';
  return withGlobals({
    window: adminWindow(),
    document: fakeDocument({ one: { '#admin-analytics-grid': grid, '#admin-analytics-status': chip }, many: { '[data-analytics-chart]': [chart] } }),
  }, async () => {
    const controller = createAnalyticsController({ fetcher: async () => ({ success: false, status: 403 }) });
    await controller.load();
    assert.equal(grid.textContent, '');
    assert.equal(chart.textContent, '');
    assert.equal(chip.textContent, 'ADMIN ACCESS REQUIRED');
    assert.equal(controller.snapshot, null);
    controller.destroy();
  });
});

await check('a failed refresh keeps the last good snapshot and offers a retry message', () => {
  const chip = fakeElement();
  return withGlobals({ window: adminWindow(), document: fakeDocument({ one: { '#admin-analytics-status': chip } }) }, async () => {
    let calls = 0;
    const controller = createAnalyticsController({ fetcher: async () => { calls += 1; if (calls === 1) return { success: true, overview: { kpis: [] } }; throw new Error('offline'); } });
    await controller.load();
    const kept = controller.snapshot;
    await controller.refresh();
    assert.match(chip.textContent, /REFRESH TIMED OUT · RETRY/);
    assert.equal(controller.snapshot, kept);
    controller.destroy();
  });
});

await check('a single refresh click performs one fetch', () => {
  const refresh = fakeElement();
  return withGlobals({ window: adminWindow(), document: fakeDocument({ one: { '[data-analytics-refresh]': refresh, '#admin-analytics-status': fakeElement() } }) }, async () => {
    let calls = 0;
    const controller = createAnalyticsController({ fetcher: async url => { if (url.startsWith('/admin/analytics/balance')) calls += 1; return { success: true, overview: { kpis: [] } }; } });
    refresh.dispatch('click');
    await tick();
    assert.equal(calls, 1, 'one click is one analytics request');
    controller.destroy();
  });
});

await check('controller suppresses duplicate loads and exposes section and filter hooks', () => withGlobals({ window: adminWindow(), document: fakeDocument() }, async () => {
  let calls = 0;
  const controller = createAnalyticsController({ fetcher: async () => { calls += 1; return { success: true, schemaVersion: 1, overview: { kpis: [] } }; } });
  const first = controller.load({ range: 'day' });
  const second = controller.load({ range: 'day' });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(controller.setTab('economy').tab, 'economy');
  assert.equal(controller.setFilters({ botMode: 'AI' }).botMode, 'ai');
  controller.destroy();
}));

await check('teardown stops everything: no further requests after destroy', () => withGlobals({ window: adminWindow('?tab=rooms'), document: fakeDocument() }, async () => {
  const urls = [];
  const controller = createAnalyticsController({ fetcher: async url => { urls.push(url); return { success: true, totals: {}, rooms: [] }; }, pollMs: 5 });
  controller.activate();
  await tick();
  controller.destroy();
  const seen = urls.length;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(urls.length, seen, 'the rooms poll is cancelled');
  assert.deepEqual(await controller.load(), { success: false, status: 499 });
}));
