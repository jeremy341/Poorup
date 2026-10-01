import { state } from './clientState.js';
import { renderAnalyticsChart, disposeAnalyticsChart } from './clientAnalyticsCharts.js';
import { ANALYTICS_TABS } from './clientAnalyticsCatalog.js';
import { createAnalyticsPageController } from './clientAnalyticsPage.js';
import { ALLOWED_METRICS, METRIC_LABELS, normalizeAnalyticsQuery, normalizeAnalyticsSnapshot, metricValue, isAnalyticsPath } from './clientAnalyticsViewModel.js';
export { normalizeAnalyticsQuery, normalizeAnalyticsSnapshot, metricValue, isAnalyticsPath, MIN_COHORT } from './clientAnalyticsViewModel.js';
export { ANALYTICS_TABS } from './clientAnalyticsCatalog.js';

function query(selector) { return typeof document === 'undefined' || typeof document.querySelector !== 'function' ? null : document.querySelector(selector); }
function clearAnalyticsOutput() {
  const grid = query('#admin-analytics-grid');
  if (grid) grid.textContent = '';
  if (typeof document === 'undefined') return;
  document.querySelectorAll?.('[data-analytics-chart]')?.forEach(element => disposeAnalyticsChart(element));
  document.querySelectorAll?.('.analytics-read-model, [data-analytics-chart]')?.forEach(element => { element.textContent = ''; });
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
const ANALYTICS_FILTER_LABELS = Object.freeze({ boardVariant: 'BOARD', rulesetPreset: 'RULESET', marketComplexity: 'MARKET', botMode: 'BOT MODE', provider: 'PROVIDER', eventId: 'EVENT', seasonId: 'SEASON', rulesetRevision: 'RULE REV', balanceRevision: 'BALANCE REV' });
function renderActiveAnalyticsFilters(filters) {
  const target = query('[data-analytics-active-filters]');
  if (!target) return;
  const chips = Object.entries(ANALYTICS_FILTER_LABELS).filter(([key]) => filters[key] && filters[key] !== 'all').map(([key, label]) => `<span class="analytics-filter-chip">${escapeHtml(label)} · ${escapeHtml(filters[key])}</span>`);
  target.innerHTML = chips.length ? chips.join('') : '<span class="t-micro ink-3">ALL DIMENSIONS</span>';
}
const ANALYTICS_STATUS_STATES = Object.freeze([
  ['LOADING', 'loading'],
  ['REFRESHING', 'refreshing'],
  ['STALE', 'stale'],
  ['SUPPRESSED', 'suppressed'],
  ['MIN COHORT', 'suppressed'],
  ['ACCESS REQUIRED', 'unauthorized'],
  ['RATE LIMITED', 'rate-limited'],
  ['UNAVAILABLE', 'unavailable'],
  ['TIMED OUT', 'unavailable'],
  ['NO VERIFIED', 'empty']
]);
const ANALYTICS_ALERTING_STATES = Object.freeze(['stale', 'suppressed', 'unauthorized', 'rate-limited', 'unavailable']);

function analyticsStatusState(normalized) {
  const match = ANALYTICS_STATUS_STATES.find(([keyword]) => normalized.includes(keyword));
  return match ? match[1] : 'verified';
}

function isBusyAnalyticsState(statusState) {
  if (statusState === 'loading') return true;
  return statusState === 'refreshing';
}

function renderAnalyticsAlerts(alerts, statusState, text, tone) {
  alerts.setAttribute?.('data-analytics-state', statusState);
  const actionable = tone === 'warning' || ANALYTICS_ALERTING_STATES.includes(statusState);
  if (actionable) { alerts.textContent = text; return; }
  if (statusState === 'verified') alerts.textContent = 'NO ACTIONABLE ALERTS';
}

function renderStatus(message, tone = 'muted') {
  const status = query('#admin-analytics-status');
  if (!status) return;
  const text = String(message || '');
  const statusState = analyticsStatusState(text.toUpperCase());
  status.className = `t-body analytics-status ${tone}`;
  status.textContent = text;
  status.setAttribute?.('data-analytics-state', statusState);
  status.setAttribute?.('aria-busy', String(isBusyAnalyticsState(statusState)));
  const alerts = query('#admin-analytics-alerts');
  if (alerts) renderAnalyticsAlerts(alerts, statusState, text, tone);
}

function finiteAnalyticsNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return parseNumericString(value);
  if (value && typeof value === 'object') return finiteFromRecord(value);
  return null;
}

function parseNumericString(value) {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteFromRecord(value) {
  for (const key of ['value', 'rate', 'count']) {
    const parsed = finiteAnalyticsNumber(value[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function pointSource(value) {
  if (!value) return {};
  if (typeof value !== 'object') return {};
  if (Array.isArray(value)) return {};
  return value;
}

function applyPointUnit(point, unit, source) {
  if (unit) { point.unit = unit; return; }
  if (typeof source.unit === 'string') point.unit = source.unit.slice(0, 24);
}

function applyPointMetadata(point, source) {
  for (const key of ['sampleSize', 'numerator', 'denominator']) {
    const metadata = finiteAnalyticsNumber(source[key]);
    if (metadata !== null) point[key] = metadata;
  }
}

function panelPoint(label, value, unit = '') {
  const numeric = finiteAnalyticsNumber(value);
  if (numeric === null) return null;
  const source = pointSource(value);
  const point = { label: String(label || 'Observation').slice(0, 80), value: numeric };
  applyPointUnit(point, unit, source);
  applyPointMetadata(point, source);
  return point;
}

function panelRows(model) { return Array.isArray(model?.rows) ? model.rows : []; }

function isRecordObject(value) {
  if (!value) return false;
  if (typeof value !== 'object') return false;
  return !Array.isArray(value);
}

function objectSeries(value, unit = '') {
  if (!isRecordObject(value)) return [];
  return Object.entries(value).slice(0, 24).map(([label, item]) => panelPoint(label, item, unit)).filter(Boolean);
}

function labeledSeries(pairs) {
  return pairs.map(([label, value, unit]) => panelPoint(label, value, unit)).filter(Boolean);
}

function rowPointSeries(snapshot, labelFor, valueFor, unit) {
  return panelRows(snapshot.breakdowns?.[0]).map(row => panelPoint(labelFor(row), valueFor(row), unit)).filter(Boolean);
}

function overviewSeries(snapshot) { return snapshot.series; }

function matchHealthSeries(snapshot) {
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

function rulesetSeries(snapshot) {
  return rowPointSeries(snapshot, row => `${row.rulesetPreset || 'ruleset'} / ${row.boardVariant || 'board'}`, row => row.matches, '');
}

function economySeries(snapshot) {
  return objectSeries(snapshot.breakdowns?.[0]?.adoption, 'adoption');
}

function eventSeries(snapshot) {
  return rowPointSeries(snapshot, row => row.eventId || 'event', row => row.eligibility, 'observations');
}

function botSeries(snapshot) {
  return rowPointSeries(snapshot, row => `${row.botMode || 'bot'} / ${row.provider || 'provider'}`, row => row.matches, 'matches');
}

function qualitySeries(snapshot) {
  const model = snapshot.breakdowns?.[0] || snapshot.dataQuality || {};
  return labeledSeries([
    ['Lag seconds', model.lagSeconds, 'seconds'],
    ['Queue depth', model.queueDepth, 'observations'],
    ['Pending writes', model.pendingWrites, 'observations'],
    ['Rejected events', model.rejectedEvents, 'observations'],
    ['Suppressed panels', model.suppressionCount, 'observations']
  ]);
}

const ANALYTICS_PANEL_DESCRIPTORS = Object.freeze({
  overview: { title: 'Verified activity', unit: 'observations', mode: 'line', series: overviewSeries },
  'match-health': { title: 'Match reliability', unit: 'matches', mode: 'bar', series: matchHealthSeries },
  rulesets: { title: 'Ruleset and board adoption', unit: 'matches', mode: 'bar', series: rulesetSeries },
  economy: { title: 'Economic feature adoption', unit: 'adoption', mode: 'bar', series: economySeries },
  events: { title: 'Event eligibility', unit: 'observations', mode: 'bar', series: eventSeries },
  bots: { title: 'Bot matches by provider', unit: 'matches', mode: 'bar', series: botSeries },
  quality: { title: 'Snapshot quality signals', unit: 'observations', mode: 'bar', series: qualitySeries }
});

export { ANALYTICS_PANEL_DESCRIPTORS };

function renderAnalyticsChartEmpty(container, title) {
  disposeAnalyticsChart(container);
  container.innerHTML = `<figure class="analytics-chart analytics-chart-placeholder" data-chart-state="empty"><figcaption>${escapeHtml(title)}</figcaption><p class="t-micro ink-3">NO VERIFIED OBSERVATIONS FOR THIS PANEL</p></figure>`;
}

function numberFormat(number, maximumFractionDigits = 2) {
  if (number === null) return 'N/A';
  return number.toLocaleString(undefined, { maximumFractionDigits });
}

function matchesAny(text, fragments) {
  return fragments.some(fragment => text.includes(fragment));
}

function kpiUnit(item, id) {
  const rawUnit = String(item.unit || '').toLowerCase();
  if (rawUnit) return rawUnit;
  if (matchesAny(id, ['rate', 'adoption'])) return 'percent';
  if (matchesAny(id, ['latency', 'duration'])) return 'seconds';
  if (matchesAny(id, ['player', 'room'])) return 'players';
  if (matchesAny(id, ['match', 'round', 'started'])) return 'matches';
  return 'value';
}

function isPercentUnit(unit) {
  if (unit === 'percent') return true;
  if (unit === 'adoption') return true;
  return unit.endsWith('rate');
}

function scaledPercent(number) {
  return Math.abs(number) <= 1 ? number * 100 : number;
}

function kpiDisplayValue(value, unit) {
  if (value === null) return '·';
  if (isPercentUnit(unit)) return `${numberFormat(scaledPercent(value), 1)}%`;
  if (unit === 'seconds') return numberFormat(value);
  if (unit === 'milliseconds') return numberFormat(value, 0);
  return numberFormat(value, unit === 'value' ? 2 : 1);
}

function kpiContextParts(item) {
  const parts = [];
  const sampleSize = finiteAnalyticsNumber(item.sampleSize);
  const numerator = finiteAnalyticsNumber(item.numerator);
  const denominator = finiteAnalyticsNumber(item.denominator);
  if (sampleSize !== null) parts.push(`SAMPLE ${numberFormat(sampleSize, 0)}`);
  if (numerator !== null) parts.push(`NUMERATOR ${numberFormat(numerator, 0)}`);
  if (denominator !== null) parts.push(`DENOMINATOR ${numberFormat(denominator, 0)}`);
  return parts;
}

function comparisonFor(item) {
  if (!item.comparison) return null;
  if (typeof item.comparison !== 'object') return null;
  return item.comparison;
}

function baselineText(value, percentUnit) {
  if (value === null) return 'N/A';
  if (percentUnit) return `${numberFormat(scaledPercent(value), 1)}%`;
  return numberFormat(value);
}

function deltaText(delta, percentUnit) {
  const sign = delta >= 0 ? '+' : '';
  const body = percentUnit ? `${numberFormat(delta * 100, 1)}pp` : numberFormat(delta);
  return `${sign}${body}`;
}

function kpiComparisonParts(item, unit) {
  const comparison = comparisonFor(item);
  if (!comparison) return ['COMPARISON UNAVAILABLE'];
  const percentUnit = isPercentUnit(unit);
  const comparisonValue = finiteAnalyticsNumber(comparison.value ?? comparison.baseline);
  const comparisonDelta = finiteAnalyticsNumber(comparison.delta ?? comparison.change);
  const parts = [`BASELINE ${baselineText(comparisonValue, percentUnit)}`];
  if (comparisonDelta !== null) parts.push(`DELTA ${deltaText(comparisonDelta, percentUnit)}`);
  if (comparison.period || comparison.label) parts.push(String(comparison.period || comparison.label).toUpperCase());
  return parts;
}

function kpiGeneratedAt(item, snapshot) {
  if (typeof item.generatedAt === 'string' && item.generatedAt) return item.generatedAt;
  return snapshot.generatedAt || 'UNKNOWN';
}

function renderKpi(item, snapshot) {
  const id = String(item.id || '').toLowerCase();
  const unit = kpiUnit(item, id);
  const displayValue = kpiDisplayValue(finiteAnalyticsNumber(item.value), unit);
  const displayUnit = unit === 'value' ? '' : unit;
  const contextParts = kpiContextParts(item);
  const comparisonParts = kpiComparisonParts(item, unit);
  const generatedAt = kpiGeneratedAt(item, snapshot);
  return `<article class="analytics-metric panel noise" data-kpi-id="${escapeHtml(item.id || 'metric')}"><span class="t-micro g400">${escapeHtml(item.label || item.id || 'Metric')}</span><strong class="t-money g100">${escapeHtml(displayValue)}</strong>${displayUnit ? `<span class="t-micro ink-3 analytics-kpi-unit">${escapeHtml(displayUnit)}</span>` : ''}${contextParts.length ? `<span class="t-micro ink-3 analytics-kpi-context">${escapeHtml(contextParts.join(' / '))}</span>` : ''}<span class="t-micro ink-3 analytics-kpi-context">${escapeHtml(comparisonParts.join(' · '))}</span><span class="t-micro ink-3 analytics-kpi-definition">${escapeHtml(item.definition || 'DEFINITION NOT PROVIDED')}</span><time class="t-micro ink-3 analytics-kpi-timestamp" datetime="${escapeHtml(generatedAt)}">VERIFIED ${escapeHtml(generatedAt)}</time></article>`;
}

function renderKpis(snapshot) {
  const kpis = Array.isArray(snapshot.overview?.kpis) ? snapshot.overview.kpis.slice(0, 6) : [];
  if (!kpis.length) return '';
  return kpis.map(item => renderKpi(item, snapshot)).join('');
}

function chartPanelMatches(container, tab) {
  const panel = container.closest?.('[data-analytics-panel]');
  if (!panel) return true;
  return panel.getAttribute('data-analytics-panel') === tab;
}

function renderChartSeries(container, values, options) {
  if (!values || !values.length) renderAnalyticsChartEmpty(container, options.title);
  else renderAnalyticsChart(container, values, options);
}

function renderChartContainer(container, snapshot) {
  const tab = container.getAttribute('data-analytics-panel-chart') || snapshot.filters.tab;
  if (!chartPanelMatches(container, snapshot.filters.tab)) {
    disposeAnalyticsChart(container);
    return;
  }
  const descriptor = ANALYTICS_PANEL_DESCRIPTORS[tab] || ANALYTICS_PANEL_DESCRIPTORS.overview;
  const options = {
    title: container.getAttribute('data-chart-title') || descriptor.title,
    unit: container.getAttribute('data-chart-unit') || descriptor.unit,
    mode: container.getAttribute('data-chart-mode') || descriptor.mode
  };
  renderChartSeries(container, descriptor.series(snapshot), options);
}

function renderAnalyticsCharts(snapshot) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll?.('[data-analytics-chart]').forEach(container => renderChartContainer(container, snapshot));
}

const AGGREGATE_METRIC_KEYS = Object.freeze(['value', 'rate', 'count', 'denominator']);

function hasAggregateMetric(value) {
  return AGGREGATE_METRIC_KEYS.some(key => Object.hasOwn(value, key));
}

function aggregateDisplay(current, unit) {
  if (current === null) return 'N/A';
  if (current === undefined) return 'N/A';
  const number = finiteAnalyticsNumber(current);
  if (isPercentUnit(unit.toLowerCase()) && number !== null) {
    return `${scaledPercent(number).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  }
  return String(current);
}

function pushAggregateCount(parts, label, count) {
  if (count === null) return;
  if (count === undefined) return;
  parts.push(`${label} ${count}`);
}

function aggregateMetricParts(value) {
  const current = value.value ?? value.rate ?? value.count;
  const unit = typeof value.unit === 'string' ? value.unit : '';
  const parts = [aggregateDisplay(current, unit)];
  if (unit) parts.push(`UNIT ${unit}`);
  pushAggregateCount(parts, 'SAMPLE', value.sampleSize);
  pushAggregateCount(parts, 'NUMERATOR', value.numerator);
  pushAggregateCount(parts, 'DENOMINATOR', value.denominator);
  return parts;
}

function aggregateRecord(value) {
  const rendered = Object.entries(value).slice(0, 8).map(([key, child]) => `${key}: ${aggregateValue(child)}`).join('; ');
  return rendered || 'N/A';
}

function aggregateValue(value) {
  if (value === null) return 'N/A';
  if (value === undefined) return 'N/A';
  if (typeof value !== 'object') return String(value);
  if (hasAggregateMetric(value)) return aggregateMetricParts(value).join(' · ');
  return aggregateRecord(value);
}

function analyticsPanelFor(tab) {
  if (typeof document === 'undefined') return null;
  const panels = [...(document.querySelectorAll?.('[data-analytics-panel]') || [])];
  return panels.find(candidate => candidate.getAttribute('data-analytics-panel') === tab) || null;
}

function readModelRows(snapshot) {
  const breakdowns = Array.isArray(snapshot.breakdowns) ? snapshot.breakdowns : [];
  return breakdowns.flatMap(row => Array.isArray(row?.rows) ? row.rows : [row]);
}

function readModelRowLabel(row) {
  if (row?.pseudonymId) return row.pseudonymId;
  if (row?.eventId) return row.eventId;
  if (row?.botMode) return row.botMode;
  if (row?.rulesetPreset) return row.rulesetPreset;
  return 'AGGREGATE';
}

function readModelRowFields(row) {
  return Object.entries(row || {})
    .filter(([key]) => key !== 'scope')
    .slice(0, 12)
    .map(([key, value]) => `<span class="analytics-read-field"><b>${escapeHtml(key)}</b> ${escapeHtml(aggregateValue(value))}</span>`)
    .join('');
}

function readModelRowMarkup(row) {
  if (row?.suppressed) return '<tr><td colspan="2">INSUFFICIENT COHORT · MIN COHORT 5</td></tr>';
  return `<tr><th scope="row">${escapeHtml(readModelRowLabel(row))}</th><td>${readModelRowFields(row)}</td></tr>`;
}

function associationMarkup(association) {
  if (!association) return '';
  const label = association.label || 'ASSOCIATION, NOT CAUSATION';
  return `<p class="analytics-association">${escapeHtml(label)} · EXPOSED ${escapeHtml(aggregateValue(association.exposed))} · CONTROL ${escapeHtml(aggregateValue(association.control))} · RELATIVE DELTA ${escapeHtml(association.relativeRateDelta)}</p>`;
}

function readModelEvidenceMarkup(tab, rows, association) {
  const tableRows = rows.map(readModelRowMarkup).join('');
  return `${associationMarkup(association)}<table class="analytics-read-table"><caption>${escapeHtml(tab)} verified read model</caption><thead><tr><th scope="col">GROUP</th><th scope="col">MEASURES</th></tr></thead><tbody>${tableRows}</tbody></table>`;
}

function isReadModelEmpty(snapshot) {
  if (!snapshot.metrics) return true;
  if (Object.keys(snapshot.metrics).length > 0) return false;
  return !(snapshot.overview?.kpis?.length);
}

const EMPTY_READ_MODEL = '<p class="analytics-empty">NO VERIFIED OBSERVATIONS FOR THIS FILTER</p><button class="btn-dark analytics-reset-filter" type="button" data-analytics-reset>RESET FILTERS</button>';

function readModelContent(snapshot, tab, rows, association) {
  if (rows.length > 0 || association) return readModelEvidenceMarkup(tab, rows, association);
  if (isReadModelEmpty(snapshot)) return EMPTY_READ_MODEL;
  return '';
}

function appendReadModel(panel, tab, content) {
  if (!content) return;
  const readModel = `<div class="analytics-read-model" tabindex="0" role="region" aria-label="Scrollable ${escapeHtml(tab)} verified read model">${content}</div>`;
  panel.insertAdjacentHTML?.('beforeend', readModel);
  if (!panel.insertAdjacentHTML) panel.innerHTML += readModel;
  panel.querySelectorAll?.('[data-analytics-reset]')?.forEach(button => listenReset(button));
}

function renderAnalyticsReadModel(snapshot) {
  if (typeof document === 'undefined') return;
  const tab = snapshot.filters.tab;
  const panel = analyticsPanelFor(tab);
  if (!panel) return;
  panel.querySelector?.('.analytics-read-model')?.remove?.();
  const rows = readModelRows(snapshot);
  const content = readModelContent(snapshot, tab, rows, snapshot.association);
  appendReadModel(panel, tab, content);
}

function listenReset(button) {
  if (!button || button.dataset?.analyticsResetBound) return;
  if (!button.dataset) button.dataset = {};
  button.dataset.analyticsResetBound = 'true';
  button.addEventListener?.('click', event => { event.preventDefault(); globalThis.__poorupAnalyticsReset?.(); });
}

function metricCardMarkup(name, entry) {
  const label = METRIC_LABELS[name];
  const span = entry.type === 'gauge' ? 'CURRENT' : 'RECORDED';
  return `<article class="analytics-metric panel noise"><span class="t-micro g400">${escapeHtml(label)}</span><strong class="t-money g100">${escapeHtml(metricValue(entry).toLocaleString())}</strong><span class="t-micro ink-3">${span}</span></article>`;
}

function overviewGridMarkup(snapshot) {
  const kpis = renderKpis(snapshot);
  if (kpis) return kpis;
  const entries = Object.entries(snapshot.metrics);
  if (entries.length) return entries.map(([name, entry]) => metricCardMarkup(name, entry)).join('');
  return '<p class="t-body ink-2 analytics-empty">NO VERIFIED OBSERVATIONS FOR THIS FILTER</p>';
}

function updateAnalyticsGrid(snapshot) {
  const grid = query('#admin-analytics-grid');
  if (!grid) return;
  const overview = snapshot.filters.tab === 'overview';
  grid.hidden = !overview;
  grid.setAttribute?.('aria-hidden', String(!overview));
  grid.innerHTML = overview ? overviewGridMarkup(snapshot) : '';
}

function snapshotStatus(snapshot) {
  if (snapshot.suppression.suppressedPanels > 0) {
    return { message: 'INSUFFICIENT COHORT · MIN COHORT 5', tone: 'warning' };
  }
  const stale = snapshot.dataQuality.stale === true || snapshot.dataQuality.fresh === false;
  if (stale) return { message: `STALE · LAST VERIFIED ${snapshot.generatedAt || 'UNKNOWN'}`, tone: 'warning' };
  return { message: `SYNCED ${snapshot.range.toUpperCase()} · ${snapshot.generatedAt || 'NOW'}`, tone: 'green' };
}

export function renderAnalyticsSnapshot(value) {
  const snapshot = normalizeAnalyticsSnapshot(value);
  const lastVerified = query('[data-analytics-last-verified]');
  if (lastVerified) lastVerified.textContent = `LAST VERIFIED · ${snapshot.generatedAt || 'UNKNOWN'}`;
  updateAnalyticsGrid(snapshot);
  renderAnalyticsCharts(snapshot);
  renderAnalyticsReadModel(snapshot);
  const status = snapshotStatus(snapshot);
  renderStatus(status.message, status.tone);
  return snapshot;
}

const SKIPPED_FILTER_VALUES = new Set(['', null]);

function shouldSerializeFilter(key, value) {
  if (key === 'minimumCohort') return false;
  return !SKIPPED_FILTER_VALUES.has(value) && value !== undefined;
}

function queryString(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (shouldSerializeFilter(key, value)) params.set(key, value);
  });
  return params.toString();
}
function readUrlFilters() {
  const location = globalThis.window?.location;
  if (!location || !isAnalyticsPath(location.pathname)) return {};
  const params = new URLSearchParams(location.search || '');
  return Object.fromEntries(params.entries());
}
function syncUrlFilters(filters) {
  const location = globalThis.window?.location;
  const history = globalThis.window?.history;
  if (!location) return;
  if (!isAnalyticsPath(location.pathname)) return;
  if (typeof history?.replaceState !== 'function') return;
  const query = queryString(filters);
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash || ''}`);
}

export function createAnalyticsController({ fetcher = null, announce = () => {}, modal = null, endpoint = '/admin/analytics/balance' } = {}) {
  const customFetcher = typeof fetcher === 'function';
  const requestFetcher = customFetcher ? fetcher : globalThis.fetch?.bind(globalThis);
  let filters = normalizeAnalyticsQuery(readUrlFilters());
  let snapshot = null;
  let request = null;
  let abortController = null;
  let destroyed = false;
  let requestGeneration = 0;
  const listeners = [];
  let filterOpener = null;
  let pageController = null;
  const FILTER_BACKGROUND_SELECTORS = ['.analytics-tabs', '#admin-analytics-grid', '[data-analytics-report-book]', '.analytics-contextual-slots'];

  function listen(target, event, handler) {
    target?.addEventListener?.(event, handler);
    if (target?.removeEventListener) listeners.push(() => target.removeEventListener(event, handler));
  }

  function tabElements() { return typeof document === 'undefined' ? [] : [...(document.querySelectorAll?.('[data-analytics-tab]') || [])]; }

  const TAB_NAV_KEYS = Object.freeze(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End', 'Enter', ' ']);

  function nextTabIndex(key, current, count) {
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    const offset = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    return (current + offset + count) % count;
  }

  function wireTabKeydown(element, tabs) {
    listenOnce(element, 'keydown', event => {
      if (!TAB_NAV_KEYS.includes(event.key)) return;
      const current = tabs.indexOf(element);
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setTab(element.getAttribute('data-analytics-tab'), { focus: true });
        return;
      }
      event.preventDefault();
      const next = nextTabIndex(event.key, current, tabs.length);
      setTab(tabs[next]?.getAttribute('data-analytics-tab'), { focus: true });
    });
  }

  function decorateTab(element, index, tabs, focus) {
    const active = element.getAttribute('data-analytics-tab') === filters.tab;
    element.id = element.id || `analytics-tab-${index + 1}`;
    element.setAttribute('role', 'tab');
    element.setAttribute('aria-selected', String(active));
    element.setAttribute('tabindex', active ? '0' : '-1');
    element.classList.toggle('is-active', active);
    if (focus && active) element.focus?.();
    listenOnce(element, 'click', () => setTab(element.getAttribute('data-analytics-tab')));
    wireTabKeydown(element, tabs);
  }

  function syncPanels(tabs) {
    if (typeof document === 'undefined') return;
    document.querySelectorAll?.('[data-analytics-panel]')?.forEach(element => {
      const active = element.getAttribute('data-analytics-panel') === filters.tab;
      element.classList.toggle('is-hidden', !active);
      element.setAttribute('aria-hidden', String(!active));
      const tab = tabs.find(candidate => candidate.getAttribute('data-analytics-tab') === filters.tab);
      if (tab) element.setAttribute('aria-labelledby', tab.id);
    });
  }

  function updatePagePosition() {
    const position = query('[data-analytics-page-position]');
    if (position) position.textContent = `${ANALYTICS_TABS.indexOf(filters.tab) + 1} / ${ANALYTICS_TABS.length}`;
  }

  function applyTabState({ focus = false } = {}) {
    const tabs = tabElements();
    tabs.forEach((element, index) => decorateTab(element, index, tabs, focus));
    syncPanels(tabs);
    updatePagePosition();
    if (pageController?.page !== filters.tab) pageController?.setPage(filters.tab, { syncUrl: false, announceChange: false });
    renderActiveAnalyticsFilters(filters);
  }

  const wired = new WeakMap();
  function listenOnce(target, event, handler) {
    if (!target) return;
    const events = wired.get(target) || new Set();
    if (events.has(event)) return;
    listen(target, event, handler);
    events.add(event);
    wired.set(target, events);
  }

  function setTab(tab, { focus = false } = {}) {
    const previousTab = filters.tab;
    if (tab !== previousTab && request) { requestGeneration += 1; abortController?.abort(); request = null; }
    filters = normalizeAnalyticsQuery({ ...filters, tab });
    syncUrlFilters(filters);
    applyTabState({ focus });
    if (filters.tab !== previousTab) void load(filters);
    return { ...filters };
  }

  function applyHiddenDialogState(dialog) {
    dialog.classList?.add('is-hidden');
    dialog.setAttribute?.('aria-hidden', 'true');
  }

  function clearFilterInert() {
    FILTER_BACKGROUND_SELECTORS.forEach(selector => query(selector)?.removeAttribute?.('inert'));
  }

  function setFilterToggleExpanded(expanded) {
    const opener = query('[data-analytics-more-filters]');
    if (opener) opener.setAttribute?.('aria-expanded', String(expanded));
  }

  function closeFilterDialog({ restoreFocus = true } = {}) {
    const dialog = query('[data-analytics-filter-dialog]');
    if (dialog) applyHiddenDialogState(dialog);
    clearFilterInert();
    setFilterToggleExpanded(false);
    if (restoreFocus) filterOpener?.focus?.();
    filterOpener = null;
  }

  function showFilterDialog(dialog, opener) {
    dialog.classList?.remove('is-hidden');
    dialog.setAttribute?.('aria-hidden', 'false');
    FILTER_BACKGROUND_SELECTORS.forEach(selector => query(selector)?.setAttribute?.('inert', ''));
    opener.setAttribute?.('aria-expanded', 'true');
    dialog.querySelector?.('[data-analytics-filter]')?.focus?.();
  }

  function openFilterDialog() {
    const dialog = query('[data-analytics-filter-dialog]');
    const opener = query('[data-analytics-more-filters]');
    if (!dialog || !opener) return;
    filterOpener = opener;
    showFilterDialog(dialog, opener);
  }

  function readFilterControls() {
    if (typeof document === 'undefined') return {};
    const values = {};
    document.querySelectorAll?.('[data-analytics-filter]')?.forEach(control => { const name = control.getAttribute('data-analytics-filter'); if (name) values[name] = control.value; });
    return values;
  }

  function syncFilterControls() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll?.('[data-analytics-filter]')?.forEach(control => {
      const name = control.getAttribute('data-analytics-filter');
      if (!name || filters[name] === undefined) return;
      control.value = filters[name];
    });
  }

  function setFilters(next = {}) {
    if (request) { requestGeneration += 1; abortController?.abort(); request = null; }
    filters = normalizeAnalyticsQuery({ ...filters, ...next });
    syncUrlFilters(filters);
    renderActiveAnalyticsFilters(filters);
    return { ...filters };
  }

  function wireReportPage() {
    const reportPage = query('[data-analytics-report-page]');
    if (!reportPage) return;
    reportPage.setAttribute?.('role', 'region');
    reportPage.setAttribute?.('aria-label', 'Scrollable analytics report content');
    if (!reportPage.hasAttribute?.('tabindex')) reportPage.setAttribute?.('tabindex', '0');
  }

  function wireFilterInputs() {
    if (Object.keys(readUrlFilters()).length) syncFilterControls();
    document.querySelectorAll?.('[data-analytics-filter]')?.forEach(control => listenOnce(control, 'change', () => { filters = normalizeAnalyticsQuery({ ...filters, ...readFilterControls() }); }));
  }

  function applyFiltersNow() {
    setFilters(readFilterControls());
    closeFilterDialog({ restoreFocus: false });
    void load(filters);
  }

  function submitFiltersNow() {
    setFilters(readFilterControls());
    void load(filters);
  }

  function resetFiltersNow() {
    filters = normalizeAnalyticsQuery({});
    syncFilterControls();
    setTab('overview');
    void load(filters);
  }

  function wireFilterActions() {
    const apply = document.querySelector?.('[data-analytics-apply]');
    const reset = document.querySelector?.('[data-analytics-reset]');
    const refreshButton = document.querySelector?.('[data-analytics-refresh]');
    const form = document.querySelector?.('form.analytics-filters');
    listenOnce(apply, 'click', applyFiltersNow);
    listenOnce(reset, 'click', resetFiltersNow);
    listenOnce(refreshButton, 'click', () => { void refresh(); });
    listenOnce(form, 'submit', event => { event.preventDefault(); submitFiltersNow(); });
  }

  function eventInside(element, event) {
    return Boolean(element.contains?.(event.target));
  }

  function isBackdropDismiss(filterDialog, moreFilters, event) {
    if (!filterDialog) return false;
    if (filterDialog.classList?.contains('is-hidden')) return false;
    if (eventInside(filterDialog, event)) return false;
    if (!moreFilters) return true;
    return !eventInside(moreFilters, event);
  }

  function wireFilterDialog() {
    const moreFilters = document.querySelector?.('[data-analytics-more-filters]');
    const cancelFilters = document.querySelector?.('[data-analytics-filter-cancel]');
    const filterDialog = document.querySelector?.('[data-analytics-filter-dialog]');
    listenOnce(moreFilters, 'click', openFilterDialog);
    listenOnce(cancelFilters, 'click', () => closeFilterDialog());
    listenOnce(filterDialog, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeFilterDialog(); } });
    listenOnce(document, 'pointerdown', event => {
      if (isBackdropDismiss(filterDialog, moreFilters, event)) closeFilterDialog();
    });
  }

  function wirePageController() {
    pageController = createAnalyticsPageController({
      root: query('#admin-analytics-main'),
      initialPage: filters.tab,
      bindTabs: false,
      bindFilters: false,
      onPageChange: nextPage => { if (nextPage !== filters.tab) setTab(nextPage, { focus: false }); },
      announce
    });
  }

  function wireGlobalActions() {
    globalThis.__poorupAnalyticsReset = () => resetFiltersNow();
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') { requestGeneration += 1; abortController?.abort(); request = null; }
    });
  }

  function wireControls() {
    if (typeof document === 'undefined') return;
    wireReportPage();
    applyTabState();
    renderActiveAnalyticsFilters(filters);
    wireFilterInputs();
    wireFilterActions();
    wireFilterDialog();
    wirePageController();
    wireGlobalActions();
  }

  function loadHeaders() {
    if (customFetcher) return {};
    const token = state.account?.sessionToken;
    if (!token) return {};
    return { 'x-poorup-session-token': token };
  }

  function createAbort() {
    if (typeof AbortController !== 'function') return null;
    return new AbortController();
  }

  function parseResponse(response) {
    if (typeof response?.json === 'function') return response.json();
    return response;
  }

  function pushStatus(codes, value) {
    if (value === undefined) return;
    if (value === null) return;
    codes.push(value);
  }

  function responseCodes(payload, response) {
    const codes = [];
    pushStatus(codes, payload?.status);
    pushStatus(codes, response?.status);
    return codes;
  }

  function failureMessage(codes) {
    if (codes.includes(401)) return { clear: true, text: 'ADMIN ACCOUNT REQUIRED', tone: 'warning' };
    if (codes.includes(403)) return { clear: true, text: 'ADMIN ACCESS REQUIRED', tone: 'warning' };
    if (codes.includes(503)) return { clear: false, text: 'ROLLUP UNAVAILABLE · RETRY', tone: 'warning' };
    if (codes.includes(429)) return { clear: false, text: 'ANALYTICS RATE LIMITED · RETRY', tone: 'warning' };
    return { clear: false, text: 'ANALYTICS UNAVAILABLE · RETRY', tone: 'warning' };
  }

  function renderLoadFailure(payload, response) {
    const message = failureMessage(responseCodes(payload, response));
    if (message.clear) { snapshot = null; clearAnalyticsOutput(); }
    renderStatus(message.text, message.tone);
  }

  function handleResponse(payload, response, generation) {
    if (generation !== requestGeneration || destroyed) return { success: false, status: 499 };
    const failed = response?.ok === false || payload?.success === false;
    if (failed) { renderLoadFailure(payload, response); return payload; }
    snapshot = renderAnalyticsSnapshot(payload);
    return snapshot;
  }

  function loadFailureResult(error) {
    if (error?.name === 'AbortError') return { success: false, status: 499 };
    const message = snapshot ? 'ANALYTICS REFRESH TIMED OUT · RETRY' : 'ANALYTICS UNAVAILABLE · RETRY';
    renderStatus(message, 'warning');
    return { success: false, status: 503 };
  }

  function finishRequest(generation) {
    if (generation !== requestGeneration) return;
    request = null;
    abortController = null;
  }

  function loadingStatus() {
    if (snapshot) return { text: 'REFRESHING ANALYTICS…', spoken: 'Refreshing analytics' };
    return { text: 'LOADING ANALYTICS…', spoken: 'Loading analytics' };
  }

  async function load(next = {}) {
    if (destroyed) return { success: false, status: 499 };
    if (request) return request;
    filters = normalizeAnalyticsQuery({ ...filters, ...next });
    if (!requestFetcher) { renderStatus('ROLLUP UNAVAILABLE · RETRY', 'warning'); return { success: false, status: 503 }; }
    const url = `${endpoint}?${queryString(filters)}`;
    const headers = loadHeaders();
    abortController = createAbort();
    const status = loadingStatus();
    renderStatus(status.text);
    announce(status.spoken);
    const generation = ++requestGeneration;
    request = Promise.resolve()
      .then(() => requestFetcher(url, { headers, credentials: 'include', signal: abortController?.signal }))
      .then(async response => handleResponse(await parseResponse(response), response, generation))
      .catch(loadFailureResult)
      .finally(() => finishRequest(generation));
    return request;
  }
  function refresh() { return load(filters); }
  function openDrilldown(trigger, next = {}) {
    if (!modal) return null;
    const options = { trigger, query: normalizeAnalyticsQuery({ ...filters, ...next }), onClose: () => trigger?.focus?.() };
    if (typeof modal.open === 'function') return modal.open(options);
    if (typeof modal.show === 'function') return modal.show(options);
    return null;
  }
  function destroy() { destroyed = true; requestGeneration += 1; abortController?.abort(); request = null; if (typeof document !== 'undefined') document.querySelectorAll?.('[data-analytics-chart]')?.forEach(element => disposeAnalyticsChart(element)); pageController?.destroy(); pageController = null; if (globalThis.__poorupAnalyticsReset) delete globalThis.__poorupAnalyticsReset; listeners.splice(0).forEach(remove => remove()); }

  wireControls();
  return Object.freeze({ destroy, load, openDrilldown, refresh, setFilters, setTab, get filters() { return { ...filters }; }, get snapshot() { return snapshot; } });
}

let analyticsController = null;
export function initAnalytics() {
  if (!isAnalyticsPath(globalThis.window?.location?.pathname)) return false;
  const view = query('#view-admin-analytics'); if (!view) return false;
  document.querySelectorAll?.('.view').forEach(candidate => candidate.classList.toggle('is-hidden', candidate !== view)); view.classList.remove('is-hidden');
  analyticsController?.destroy(); analyticsController = createAnalyticsController();
  void analyticsController.load(); return true;
}

export { ALLOWED_METRICS, METRIC_LABELS };
