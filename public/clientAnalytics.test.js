/* global process */
import assert from 'node:assert/strict';

globalThis.window = { matchMedia: () => ({ matches: false }), location: { pathname: '/' } };
globalThis.document = { querySelector: () => null };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { normalizeAnalyticsSnapshot, normalizeAnalyticsQuery, metricValue, isAnalyticsPath, createAnalyticsController, renderAnalyticsSnapshot } = await import('./clientAnalytics.js');
const { renderAnalyticsChart } = await import('./clientAnalyticsCharts.js');

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
  const query = normalizeAnalyticsQuery({ range: 'season', boardVariant: 'METRO-52', botMode: 'AI', minimumCohort: 1, accountId: 'raw' });
  assert.deepEqual(query, { range: 'season', seasonId: '', rulesetRevision: '', balanceRevision: '', boardVariant: 'metro-52', rulesetPreset: 'all', marketComplexity: 'all', botMode: 'ai', eventId: '', minimumCohort: 5, tab: 'overview' });
  assert.equal(normalizeAnalyticsQuery({ rulesetRevision: 'abc', balanceRevision: 'NaN' }).rulesetRevision, '');
});

await check('retains version dimensions and strips unknown aggregate fields', () => {
  const snapshot = normalizeAnalyticsSnapshot({ schemaVersion: 1, pseudonymVersion: 'hmac-v1', seasonId: 's', rulesetRevision: 2, balanceRevision: 3, boardVariant: 'metro-52', overview: { unknownField: 'drop', kpis: [] } });
  assert.equal(snapshot.pseudonymVersion, 'hmac-v1');
  assert.equal(snapshot.seasonId, 's');
  assert.equal(snapshot.rulesetRevision, 2);
  assert.equal(snapshot.overview.unknownField, undefined);
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
  assert.match(markup, /var\(--(?:gold-300|green-status)\)/);
  assert.equal(markup.includes('height="-'), false);
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

function fakeAnalyticsDocument({ filters = [], tabs = [], panels = [], form = null, grid = null, status = null } = {}) {
  const all = [...filters, ...tabs, ...panels, form, grid, status].filter(Boolean);
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
  assert.equal(grid.innerHTML.length > 0, true);
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
  const status = fakeElement({ id: 'admin-analytics-status' });
  const previousDocument = globalThis.document;
  globalThis.document = fakeAnalyticsDocument({ grid, status });
  const controller = createAnalyticsController({ fetcher: async () => ({ success: false, status: 403 }) });
  await controller.load();
  assert.equal(grid.textContent, '');
  assert.equal(status.textContent, 'ADMIN ACCESS REQUIRED');
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
