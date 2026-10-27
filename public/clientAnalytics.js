import { state } from './clientState.js';
import { renderAnalyticsChart, disposeAnalyticsChart } from './clientAnalyticsCharts.js';
import { ANALYTICS_RANGES, ANALYTICS_VIEWS, BALANCE_TABS, SECTIONS, SECTION_LABELS, SERVER_TABS, TAB_LABELS, sectionOf, tabForSection } from './clientAnalyticsCatalog.js';
import { createAnalyticsPageController } from './clientAnalyticsPage.js';
import { kpiMarkup, escapeHtml, finiteNumber, numberFormat } from './clientAnalyticsKpis.js';
import { createAdminOpsController, refreshScrollCues } from './clientAdminConsole.js';
import { setSectionState, setSectionFailure } from './clientAdminPanelState.js';
import { formatClock } from './clientAdminPanels.js';
import { ALLOWED_METRICS, METRIC_LABELS, normalizeAnalyticsQuery, normalizeAnalyticsSnapshot, metricValue, isAnalyticsPath, formatAdminNumber } from './clientAnalyticsViewModel.js';
export { normalizeAnalyticsQuery, normalizeAnalyticsSnapshot, metricValue, isAnalyticsPath, MIN_COHORT } from './clientAnalyticsViewModel.js';
export { ANALYTICS_TABS } from './clientAnalyticsCatalog.js';

function query(selector) { return typeof document === 'undefined' || typeof document.querySelector !== 'function' ? null : document.querySelector(selector); }

// ---- Freshness chip: the one place the console says how fresh its data is ----
const ANALYTICS_STATUS_STATES = Object.freeze([
  ['LOADING', 'loading'],
  ['REFRESHING', 'refreshing'],
  ['STALE', 'stale'],
  ['NOTHING TO MEASURE', 'empty'],
  ['SUPPRESSED', 'suppressed'],
  ['MIN COHORT', 'suppressed'],
  ['ACCESS REQUIRED', 'unauthorized'],
  ['ACCOUNT REQUIRED', 'unauthorized'],
  ['RATE LIMITED', 'rate-limited'],
  ['UNAVAILABLE', 'unavailable'],
  ['TIMED OUT', 'unavailable'],
  ['NO VERIFIED', 'empty']
]);

function analyticsStatusState(normalized) {
  const match = ANALYTICS_STATUS_STATES.find(([keyword]) => normalized.includes(keyword));
  return match ? match[1] : 'verified';
}

function renderStatus(message, tone = 'muted', title = '', { announce = true } = {}) {
  const chip = query('#admin-analytics-status');
  if (!chip) return;
  const text = String(message || '');
  const statusState = analyticsStatusState(text.toUpperCase());
  chip.className = `t-micro admin-chip ${tone}`;
  chip.textContent = text;
  if (title) chip.setAttribute('title', title); else chip.removeAttribute('title');
  chip.setAttribute('data-analytics-state', statusState);
  chip.setAttribute('aria-busy', String(statusState === 'loading' || statusState === 'refreshing'));
  // The live Rooms clock changes every poll; announcing it every 15 seconds would drown a screen reader.
  chip.setAttribute('aria-live', announce ? 'polite' : 'off');
}

// ---- Chart series per balance section ----
function panelPoint(label, value, unit = '') {
  const numeric = finiteNumber(value);
  if (numeric === null) return null;
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const point = { label: String(label || 'Observation').slice(0, 80), value: numeric };
  if (unit) point.unit = unit; else if (typeof source.unit === 'string') point.unit = source.unit.slice(0, 24);
  for (const key of ['sampleSize', 'numerator', 'denominator']) {
    const metadata = finiteNumber(source[key]);
    if (metadata !== null) point[key] = metadata;
  }
  return point;
}

function labeledSeries(pairs) { return pairs.map(([label, value, unit]) => panelPoint(label, value, unit)).filter(Boolean); }

function objectSeries(value, unit = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).slice(0, 24).map(([label, item]) => panelPoint(label, item, unit)).filter(Boolean);
}

function statusSeries(snapshot) { return snapshot.series; }

function matchesSeries(snapshot) {
  const model = snapshot.breakdowns?.[0] || {};
  return labeledSeries([
    ['Starts', model.starts, 'matches'],
    ['Completions', model.completions, 'matches'],
    ['Stalls', model.stalls, 'matches'],
    ['Reconnect rate', model.reconnectRate, 'percent'],
    ['AFK rate', model.afkRate, 'percent'],
    ['Bankruptcies', model.bankruptcies, 'matches'],
    ['Comebacks', model.comebacks, 'matches']
  ]);
}

function economySeries(snapshot) { return objectSeries(snapshot.breakdowns?.[0]?.adoption, 'adoption'); }

const ANALYTICS_PANEL_DESCRIPTORS = Object.freeze({
  status: { title: 'Verified activity', unit: 'observations', mode: 'line', series: statusSeries },
  matches: { title: 'Match reliability', unit: 'matches', mode: 'bar', series: matchesSeries },
  economy: { title: 'Economic feature adoption', unit: 'adoption', mode: 'bar', series: economySeries },
});

export { ANALYTICS_PANEL_DESCRIPTORS };

function descriptorFor(tab) { return Object.hasOwn(ANALYTICS_PANEL_DESCRIPTORS, tab) ? ANALYTICS_PANEL_DESCRIPTORS[tab] : ANALYTICS_PANEL_DESCRIPTORS.status; }

function chartContainerFor(tab) {
  return typeof document === 'undefined' ? null : document.querySelector?.(`[data-analytics-panel="${tab}"] [data-analytics-chart]`) || null;
}

// What the operator reads when no match has started in the window, per panel.
const NO_MATCHES_TEXT = Object.freeze({ status: 'No matches in this window yet', matches: 'No completed matches in this window yet', economy: 'No completed matches in this window yet' });

// True when nothing has started in the window: a rollup with nothing recorded, or a started count of exactly zero.
function windowHasNoMatches(snapshot) {
  if (snapshot.dataQuality?.empty === true) return true;
  const started = snapshot.overview?.kpis?.find?.(item => item?.id === 'started');
  return finiteNumber(started?.value) === 0;
}

function renderTabChart(snapshot, tab, { empty = false } = {}) {
  const container = chartContainerFor(tab);
  if (!container) return false;
  const descriptor = descriptorFor(tab);
  const values = empty ? [] : descriptor.series(snapshot);
  const options = {
    title: container.getAttribute('data-chart-title') || descriptor.title,
    unit: container.getAttribute('data-chart-unit') || descriptor.unit,
    mode: container.getAttribute('data-chart-mode') || descriptor.mode
  };
  const economyModel = snapshot.breakdowns?.[0] || {};
  const hasOutcomeData = tab === 'economy' && ['volatility', 'liquidationRate', 'shortDefaultRate', 'optionExerciseRate', 'negativeCashPrevention'].some(key => finiteNumber(economyModel[key]) !== null);
  if (empty || ((!values || !values.length) && !hasOutcomeData)) { disposeAnalyticsChart(container); container.textContent = ''; return false; }
  if (tab === 'economy') {
    disposeAnalyticsChart(container);
    const model = snapshot.breakdowns?.[0] || {};
    const labelFor = label => ({ loans: 'Player loans', loan: 'Player loans', auctions: 'Auctions' })[String(label).toLowerCase()] || String(label).replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    const rows = values.map(point => {
      const ratio = point.value > 1 ? point.value / 100 : point.value;
      const pct = Math.round(Math.max(0, Math.min(100, ratio * 100)) * 10) / 10;
      const sample = point.numerator !== undefined && point.denominator !== undefined
        ? `${point.numerator.toLocaleString()} of ${point.denominator.toLocaleString()} eligible matches`
        : point.denominator !== undefined ? `${point.denominator.toLocaleString()} eligible matches` : point.sampleSize !== undefined ? `Sample: ${point.sampleSize.toLocaleString()}` : 'Sample size unavailable';
      return `<div class="economy-adoption-row" role="listitem"><div class="economy-adoption-copy"><span class="t-label f12 g100">${escapeHtml(labelFor(point.label))}</span><strong class="t-money g100">${pct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</strong></div><div class="economy-adoption-track" role="progressbar" aria-label="${escapeHtml(labelFor(point.label))} adoption" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div><span class="t-micro ink-3">${escapeHtml(sample)}</span></div>`;
    }).join('');
    const outcomeDefinitions = [
      ['volatility', 'Median market volatility', 'value', 'volatility observations'],
      ['liquidationRate', 'Margin liquidation rate', 'rate', 'margin positions'],
      ['shortDefaultRate', 'Short default rate', 'rate', 'short positions'],
      ['optionExerciseRate', 'Option exercise rate', 'rate', 'collateralized options'],
      ['negativeCashPrevention', 'Negative cash prevented', 'count', 'matches started']
    ];
    const outcomeRows = outcomeDefinitions.map(([key, label, kind, denominatorLabel]) => {
      const entry = model[key];
      const raw = entry && typeof entry === 'object' ? finiteNumber(entry.value) : finiteNumber(entry);
      if (raw === null) return `<div class="economy-outcome-row" role="listitem"><span class="t-label f12 g100">${escapeHtml(label)}</span><strong class="t-money g100">Not recorded</strong><span class="t-micro ink-3">No verified measure in this window</span></div>`;
      const value = kind === 'rate' ? `${numberFormat(Math.max(0, Math.min(1, raw)) * 100, 1)}%` : numberFormat(raw, 2);
      const denominator = finiteNumber(entry?.denominator ?? entry?.sampleSize ?? entry?.observations);
      const detail = denominator === null ? 'Sample size unavailable' : `${numberFormat(denominator, 0)} ${denominatorLabel}`;
      return `<div class="economy-outcome-row" role="listitem"><span class="t-label f12 g100">${escapeHtml(label)}</span><strong class="t-money g100">${escapeHtml(value)}</strong><span class="t-micro ink-3">${escapeHtml(detail)}</span></div>`;
    }).join('');
    container.setAttribute?.('aria-label', 'Economic feature adoption');
    container.innerHTML = `<div class="economy-report" role="region" aria-label="Economy report" tabindex="0"><section class="economy-adoption-zone" aria-labelledby="economy-adoption-title"><div class="economy-report-head"><strong id="economy-adoption-title" class="t-label f12 g100">Feature adoption</strong><p class="t-micro ink-3">Share of eligible matches where players used each feature.</p></div><div class="economy-adoption-list" role="list" aria-label="Economic feature adoption rates">${rows || '<p class="t-micro ink-3">No feature adoption recorded.</p>'}</div></section><section class="economy-outcomes-zone" aria-labelledby="economy-outcomes-title"><div class="economy-report-head"><strong id="economy-outcomes-title" class="t-label f12 g100">Market outcomes</strong><p class="t-micro ink-3">Rates use their recorded position denominators; counts and volatility show recorded samples.</p></div><div class="economy-outcome-list" role="list" aria-label="Market outcome measures">${outcomeRows}</div></section></div>`;
    return true;
  }
  renderAnalyticsChart(container, values, options);
  return true;
}

function clearBalanceOutput() {
  if (typeof document === 'undefined') return;
  const grid = query('#admin-analytics-grid');
  if (grid) grid.textContent = '';
  document.querySelectorAll?.('[data-analytics-chart]')?.forEach(element => { disposeAnalyticsChart(element); element.textContent = ''; });
}

// ---- Rendering a balance snapshot ----
function metricCardMarkup(name, entry) {
  const label = METRIC_LABELS[name];
  return `<li class="analytics-metric admin-kpi panel noise" data-kpi-id="${escapeHtml(name)}" data-kpi-state="none"><span class="t-micro g400 admin-kpi-label">${escapeHtml(label)}</span><strong class="t-money g100 admin-kpi-value">${escapeHtml(metricValue(entry).toLocaleString())}</strong><span class="t-micro ink-3 admin-kpi-unit">${entry.type === 'gauge' ? 'current' : 'recorded'}</span></li>`;
}

function statusGridMarkup(snapshot) {
  const kpis = kpiMarkup(snapshot);
  if (kpis) return kpis;
  return Object.entries(snapshot.metrics).map(([name, entry]) => metricCardMarkup(name, entry)).join('');
}

function associationText(association) {
  if (!association) return '';
  const side = value => {
    const number = finiteNumber(value);
    return number === null ? 'N/A' : numberFormat(Math.abs(number) <= 1 ? number * 100 : number, 1) + (Math.abs(number) <= 1 ? '%' : '');
  };
  return `${association.label || 'ASSOCIATION, NOT CAUSATION'} · EXPOSED ${side(association.exposed)} · CONTROL ${side(association.control)} · RELATIVE DELTA ${association.relativeRateDelta ?? 'N/A'}`;
}

function snapshotStatus(snapshot) {
  const clock = formatClock(snapshot.generatedAt);
  const quality = snapshot.dataQuality || {};
  const lag = finiteNumber(quality.lagSeconds);
  const queue = finiteNumber(quality.queueDepth);
  const title = [`GENERATED ${snapshot.generatedAt || 'UNKNOWN'}`, lag === null ? '' : `LAG ${lag}S`, queue === null ? '' : `QUEUE ${queue}`].filter(Boolean).join(' · ');
  if (snapshot.suppression.suppressedPanels > 0) return { message: 'INSUFFICIENT COHORT · MIN COHORT 5', tone: 'warning', title };
  if (quality.empty === true) return { message: `NOTHING TO MEASURE YET · ${clock}`, tone: 'muted', title };
  if (quality.stale === true || quality.fresh === false) return { message: `STALE · LAST VERIFIED ${clock}`, tone: 'warning', title };
  return { message: `SYNCED · ${clock}`, tone: 'green', title };
}

export function renderAnalyticsSnapshot(value, tab) {
  const snapshot = normalizeAnalyticsSnapshot(value);
  const active = Object.hasOwn(ANALYTICS_PANEL_DESCRIPTORS, tab) ? tab : sectionViewFor(snapshot.filters.tab);
  // The six tiles sit above the views, so any view's response can refresh them; a response without
  // tiles leaves the last ones in place rather than blanking the row.
  const grid = query('#admin-analytics-grid');
  const markup = statusGridMarkup(snapshot);
  if (markup) { if (grid) grid.innerHTML = markup; query('[data-section="kpis"]')?.classList.remove('is-hidden'); setSectionState(query('[data-section="kpis"]'), 'ready'); }
  else if (active === 'status' || !grid?.innerHTML) {
    // No figures: say it once, under the views, instead of in a second bar above them.
    if (grid) grid.innerHTML = '';
    const kpis = query('[data-section="kpis"]');
    setSectionState(kpis, 'empty', { message: 'NO VERIFIED OBSERVATIONS FOR THIS WINDOW' });
    kpis?.classList.add('is-hidden');
  }
  const section = query(`[data-section="report-${active}"]`);
  const noMatches = windowHasNoMatches(snapshot);
  if (renderTabChart(snapshot, active, { empty: noMatches })) setSectionState(section, 'ready');
  else setSectionState(section, 'empty', { message: noMatches ? NO_MATCHES_TEXT[active] : 'NO VERIFIED OBSERVATIONS FOR THIS PANEL' });
  const note = query(`[data-analytics-panel="${active}"] [data-analytics-association]`);
  if (note) { note.textContent = associationText(snapshot.association); note.classList.toggle('is-hidden', !snapshot.association); }
  const status = snapshotStatus(snapshot);
  renderStatus(status.message, status.tone, status.title);
  refreshScrollCues(typeof document === 'undefined' ? null : document);
  return snapshot;
}

function sectionViewFor(tab) { return ANALYTICS_VIEWS.includes(tab) ? tab : 'status'; }

// ---- URL ----
const URL_KEYS = Object.freeze(['range', 'tab', 'boardVariant', 'marketComplexity', 'botMode']);
// Old links may carry these; they are dropped the first time the console writes the URL.
const RETIRED_URL_KEYS = Object.freeze(['view', 'admin', 'seasonId', 'eventId', 'rulesetRevision', 'balanceRevision', 'provider']);
const SKIPPED_FILTER_VALUES = new Set(['', null]);

function shouldSerializeFilter(key, value) {
  if (key === 'minimumCohort') return false;
  return !SKIPPED_FILTER_VALUES.has(value) && value !== undefined;
}

// The request carries the server's own tab id; the page keeps the rail ids.
function queryString(filters) {
  const params = new URLSearchParams();
  Object.entries({ ...filters, tab: Object.hasOwn(SERVER_TABS, filters.tab) ? SERVER_TABS[filters.tab] : 'overview' }).forEach(([key, value]) => {
    if (shouldSerializeFilter(key, value)) params.set(key, value);
  });
  return params.toString();
}

function readUrlFilters() {
  const location = globalThis.window?.location;
  if (!location || !isAnalyticsPath(location.pathname)) return {};
  const params = new URLSearchParams(location.search || '');
  const filters = Object.fromEntries(params.entries());
  // The old "Bot provider" surface lived at ?admin=provider; it is now part of Bots & AI.
  if (!filters.tab && !filters.view && filters.admin === 'provider') filters.tab = 'bots';
  return filters;
}

function syncUrlFilters(filters) {
  const location = globalThis.window?.location;
  const history = globalThis.window?.history;
  if (!location || !isAnalyticsPath(location.pathname) || typeof history?.replaceState !== 'function') return;
  const params = new URLSearchParams(location.search || '');
  [...RETIRED_URL_KEYS, ...URL_KEYS].forEach(key => params.delete(key));
  URL_KEYS.forEach(key => { if (shouldSerializeFilter(key, filters[key]) && filters[key] !== 'all') params.set(key, filters[key]); });
  const text = params.toString();
  history.replaceState(null, '', `${location.pathname}${text ? `?${text}` : ''}${location.hash || ''}`);
}

function defaultAnnounce(message) {
  const target = query('[data-document-announcer]');
  if (target) target.textContent = message;
}

export function createAnalyticsController({ fetcher = null, announce = defaultAnnounce, endpoint = '/admin/analytics/balance', confirm = null, pollMs } = {}) {
  const customFetcher = typeof fetcher === 'function';
  const requestFetcher = customFetcher ? fetcher : globalThis.fetch?.bind(globalThis);
  let filters = normalizeAnalyticsQuery(readUrlFilters());
  let snapshot = null;
  let request = null;
  let abortController = null;
  let destroyed = false;
  let requestGeneration = 0;
  let interrupted = false;
  let sectionTabs = null;
  let viewTabs = null;
  let ops = null;
  let resizeFrame = 0;
  let lastAnalytics = ANALYTICS_VIEWS.includes(filters.tab) ? filters.tab : 'status';
  let shownSection = null;
  const listeners = [];

  function listen(target, event, handler) {
    target?.addEventListener?.(event, handler);
    if (target?.removeEventListener) listeners.push(() => target.removeEventListener(event, handler));
  }

  const isBalanceTab = tab => BALANCE_TABS.includes(tab);
  // Loading and failures are shown once, on the chart area; the tiles and the health line stay quiet.
  const chartSection = tab => query(`[data-section="report-${tab}"]`);

  function abortBalance() { requestGeneration += 1; abortController?.abort(); request = null; }

  function syncChrome() {
    const section = sectionOf(filters.tab);
    document.querySelectorAll?.('[data-analytics-range]')?.forEach(button => button.setAttribute('aria-pressed', String(button.getAttribute('data-analytics-range') === filters.range)));
    // Rooms and Release are live state, not a window of history.
    const windowControl = query('[data-analytics-window]');
    if (windowControl) windowControl.hidden = section === 'rooms' || section === 'release';
    const title = query('#admin-analytics-title');
    if (title) title.textContent = SECTION_LABELS[section].toUpperCase();
  }

  function activate() {
    const tab = filters.tab;
    const section = sectionOf(tab);
    const sectionChanged = section !== shownSection;
    shownSection = section;
    syncChrome();
    document.dispatchEvent?.(new CustomEvent('poorup-admin-tab', { detail: { tab } }));
    if (isBalanceTab(tab)) { void load(filters); } else { abortBalance(); renderStatus('LOADING…'); }
    // The health line belongs to the whole Analytics surface: switching views does not re-read it.
    if (section === 'analytics') { if (sectionChanged || !ops?.activeTab) ops?.show('status'); }
    else ops?.show(section);
    refreshScrollCues(document);
  }

  function setTab(tab) {
    const previousTab = filters.tab;
    filters = normalizeAnalyticsQuery({ ...filters, tab });
    if (ANALYTICS_VIEWS.includes(filters.tab)) lastAnalytics = filters.tab;
    syncUrlFilters(filters);
    sectionTabs?.setPage(sectionOf(filters.tab));
    viewTabs?.setPage(ANALYTICS_VIEWS.includes(filters.tab) ? filters.tab : lastAnalytics);
    if (filters.tab !== previousTab) { abortBalance(); activate(); }
    return { ...filters };
  }

  function setRange(range) {
    const requested = String(range ?? '').toLowerCase();
    if (requested !== 'season' && !ANALYTICS_RANGES.includes(requested)) return { ...filters };
    const next = normalizeAnalyticsQuery({ ...filters, range: requested }).range;
    if (next === filters.range) return { ...filters };
    filters = { ...filters, range: next };
    syncUrlFilters(filters);
    syncChrome();
    abortBalance();
    if (isBalanceTab(filters.tab)) void load(filters); else if (filters.tab === 'bots') ops?.show('bots');
    return { ...filters };
  }

  function setFilters(next = {}) {
    abortBalance();
    filters = normalizeAnalyticsQuery({ ...filters, ...next });
    syncUrlFilters(filters);
    syncChrome();
    return { ...filters };
  }

  function wireControls() {
    if (typeof document === 'undefined') return;
    const root = query('#admin-analytics-main');
    sectionTabs = createAnalyticsPageController({
      root, pages: SECTIONS, tabAttr: 'data-admin-section', panelAttr: 'data-admin-section-panel', initialPage: sectionOf(filters.tab),
      onPageChange: section => { if (section !== sectionOf(filters.tab)) setTab(tabForSection(section, lastAnalytics)); },
      announce: section => announce(`${SECTION_LABELS[section]} section`)
    });
    viewTabs = createAnalyticsPageController({
      root, pages: ANALYTICS_VIEWS, tabAttr: 'data-analytics-tab', panelAttr: 'data-analytics-panel', initialPage: lastAnalytics,
      onPageChange: view => { if (view !== filters.tab) setTab(view); },
      announce: view => announce(`${TAB_LABELS[view]} view`)
    });
    document.querySelectorAll?.('[data-analytics-range]')?.forEach(button => listen(button, 'click', () => setRange(button.getAttribute('data-analytics-range'))));
    listen(query('[data-analytics-refresh]'), 'click', () => { void refresh(); });
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') { if (request) { abortBalance(); interrupted = true; } return; }
      if (interrupted) { interrupted = false; if (isBalanceTab(filters.tab)) void load(filters); }
    });
    listen(globalThis.window, 'resize', () => {
      if (resizeFrame) return;
      resizeFrame = (globalThis.requestAnimationFrame || (callback => setTimeout(callback, 16)))(() => { resizeFrame = 0; refreshScrollCues(document); });
    });
    ops = createAdminOpsController({
      root: document,
      fetcher: customFetcher ? fetcher : undefined,
      announce,
      confirm,
      pollMs,
      getRange: () => filters.range,
      isViewShown: () => !query('#view-admin-analytics')?.classList?.contains('is-hidden'),
      setFreshness: (text, tone, title) => { if (!isBalanceTab(filters.tab)) renderStatus(text, tone, title, { announce: filters.tab !== 'rooms' }); }
    });
    syncChrome();
  }

  function loadHeaders() {
    if (customFetcher) return {};
    const token = state.account?.sessionToken;
    if (!token) return {};
    return { 'x-poorup-session-token': token };
  }

  function responseCodes(payload, response) {
    return [payload?.status, response?.status].filter(code => code !== undefined && code !== null);
  }

  function failureMessage(codes) {
    if (codes.includes(401)) return { text: 'ADMIN ACCOUNT REQUIRED', status: 401 };
    if (codes.includes(403)) return { text: 'ADMIN ACCESS REQUIRED', status: 403 };
    if (codes.includes(503)) return { text: 'ROLLUP UNAVAILABLE · RETRY', status: 503 };
    if (codes.includes(429)) return { text: 'ANALYTICS RATE LIMITED · RETRY', status: 429 };
    return { text: 'ANALYTICS UNAVAILABLE · RETRY', status: 500 };
  }

  function showFailure(status, text) {
    const unauthorized = status === 401 || status === 403;
    if (unauthorized) { snapshot = null; clearBalanceOutput(); }
    query('[data-section="kpis"]')?.classList.toggle('is-hidden', unauthorized);
    setSectionFailure(chartSection(filters.tab), status, () => { void load(filters); }, text);
    renderStatus(text, 'warning');
  }

  function renderLoadFailure(payload, response) {
    const message = failureMessage(responseCodes(payload, response));
    showFailure(message.status, message.text);
  }

  function handleResponse(payload, response, generation) {
    if (generation !== requestGeneration || destroyed) return { success: false, status: 499 };
    const failed = response?.ok === false || payload?.success === false;
    if (failed) { renderLoadFailure(payload, response); return payload; }
    query('[data-section="kpis"]')?.classList.remove('is-hidden');
    snapshot = renderAnalyticsSnapshot(payload, filters.tab);
    return snapshot;
  }

  function loadFailureResult(error) {
    if (error?.name === 'AbortError') return { success: false, status: 499 };
    showFailure(503, snapshot ? 'ANALYTICS REFRESH TIMED OUT · RETRY' : 'ANALYTICS UNAVAILABLE · RETRY');
    return { success: false, status: 503 };
  }

  function finishRequest(generation) {
    if (generation !== requestGeneration) return;
    request = null;
    abortController = null;
  }

  async function load(next = {}) {
    if (destroyed) return { success: false, status: 499 };
    if (request) return request;
    filters = normalizeAnalyticsQuery({ ...filters, ...next });
    if (!isBalanceTab(filters.tab)) return { success: false, status: 204 };
    if (!requestFetcher) { showFailure(503, 'ROLLUP UNAVAILABLE · RETRY'); return { success: false, status: 503 }; }
    const url = `${endpoint}?${queryString(filters)}`;
    const headers = loadHeaders();
    abortController = typeof AbortController === 'function' ? new AbortController() : null;
    const refreshing = Boolean(snapshot);
    setSectionState(chartSection(filters.tab), 'loading', { message: 'LOADING…' });
    renderStatus(refreshing ? 'REFRESHING ANALYTICS…' : 'LOADING ANALYTICS…');
    announce(refreshing ? 'Refreshing analytics' : 'Loading analytics');
    const generation = ++requestGeneration;
    request = Promise.resolve()
      .then(() => requestFetcher(url, { headers, credentials: 'include', signal: abortController?.signal }))
      .then(async response => handleResponse(typeof response?.json === 'function' ? await response.json() : response, response, generation))
      .catch(loadFailureResult)
      .finally(() => finishRequest(generation));
    return request;
  }

  function refresh() {
    if (isBalanceTab(filters.tab)) {
      abortBalance();
      if (sectionOf(filters.tab) === 'analytics') ops?.show('status');
      return load(filters);
    }
    ops?.refresh();
    return Promise.resolve();
  }

  function destroy() {
    destroyed = true;
    abortBalance();
    if (resizeFrame && globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(resizeFrame);
    ops?.destroy();
    ops = null;
    if (typeof document !== 'undefined') document.querySelectorAll?.('[data-analytics-chart]')?.forEach(element => disposeAnalyticsChart(element));
    sectionTabs?.destroy();
    viewTabs?.destroy();
    sectionTabs = null;
    viewTabs = null;
    listeners.splice(0).forEach(remove => remove());
  }

  wireControls();
  return Object.freeze({
    destroy, load, refresh, setFilters, setTab, setRange, activate,
    get filters() { return { ...filters }; },
    get snapshot() { return snapshot; },
    get ops() { return ops; },
  });
}

let analyticsController = null;
export function initAnalytics() {
  if (!isAnalyticsPath(globalThis.window?.location?.pathname)) return false;
  const view = query('#view-admin-analytics'); if (!view) return false;
  document.querySelectorAll?.('.view').forEach(candidate => candidate.classList.toggle('is-hidden', candidate !== view)); view.classList.remove('is-hidden');
  analyticsController?.destroy(); analyticsController = createAnalyticsController();
  analyticsController.activate(); return true;
}

export { ALLOWED_METRICS, METRIC_LABELS };
