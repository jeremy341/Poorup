import { state } from './clientState.js';
import { renderAnalyticsChart } from './clientAnalyticsCharts.js';

export const MIN_COHORT = 5;
export const ANALYTICS_TABS = Object.freeze(['overview', 'match-health', 'rulesets', 'economy', 'events', 'bots', 'quality']);

const ALLOWED_METRICS = new Set([
  'active-sockets', 'active-rooms', 'active-rounds', 'room-reconnects', 'restore-failures',
  'action-latency-ms', 'error-count', 'bot-fallbacks', 'maintenance-transitions',
  'backup-failures', 'manual-codescene-runs',
]);
const METRIC_LABELS = Object.freeze({
  'active-sockets': 'Active sockets', 'active-rooms': 'Active rooms', 'active-rounds': 'Active rounds',
  'room-reconnects': 'Room reconnects', 'restore-failures': 'Restore failures', 'action-latency-ms': 'Action latency',
  'error-count': 'Server errors', 'bot-fallbacks': 'Bot fallbacks', 'maintenance-transitions': 'Maintenance transitions',
  'backup-failures': 'Backup failures', 'manual-codescene-runs': 'Manual CodeScene runs',
});
const FORBIDDEN_KEYS = new Set(['displayname', 'username', 'accountid', 'clientid', 'roomcode', 'chat', 'message', 'text', 'hiddencards', 'privateloanterms', 'opponentsecrets', 'password', 'sessiontoken', 'rawpayload', 'rawevent', 'rawdata', 'display_name', 'account_id', 'client_id', 'room_code', 'session_token', 'hidden_cards', 'private_loan_terms', 'opponent_secrets', 'raw_payload', 'raw_event', 'raw_data']);
const ALLOWED_CLIENT_FIELDS = new Set(['id', 'label', 'value', 'y', 'unit', 'sampleSize', 'observations', 'count', 'numerator', 'denominator', 'rate', 'delta', 'relativeDelta', 'relativeRateDelta', 'percentagePointDelta', 'comparison', 'definition', 'generatedAt', 'period', 'p95', 'source', 'started', 'starts', 'completed', 'completions', 'stalled', 'stalls', 'matches', 'startedMatches', 'completedMatches', 'stalledMatches', 'completionRate', 'medianDuration', 'p95Duration', 'durationMedian', 'durationP95', 'wins', 'winShare', 'placementBaseline', 'placementMedian', 'medianPlacement', 'fallback', 'fallbackRate', 'decisions', 'actions', 'actionAdoption', 'auctionDecisions', 'legalActionTaxonomy', 'feature', 'eventId', 'rulesetPreset', 'boardVariant', 'marketComplexity', 'botMode', 'provider', 'eligibility', 'eligible', 'used', 'adoption', 'volatility', 'liquidations', 'liquidation', 'liquidationRate', 'shortDefaults', 'shortDefaultRate', 'shortDefault', 'shortPositions', 'optionExercises', 'optionExerciseRate', 'optionExercise', 'collateralizedOptions', 'negativeCashPreventions', 'negativeCashPrevention', 'warnings', 'active', 'warningToActive', 'turnout', 'recovered', 'recoveryRate', 'combinations', 'rarity', 'unlockRarity', 'outcomeDistribution', 'bankruptcies', 'comebacks', 'reconnectRate', 'afkRate', 'denominators', 'competitiveMetricsExcludeBotOnly', 'rewardClaims', 'associationLabel', 'exposed', 'control', 'minimumCohort', 'suppressed', 'suppressionReason', 'schemaVersion', 'fresh', 'stale', 'lagSeconds', 'eventCoverage', 'queueDepth', 'pendingWrites', 'rejectedEvents', 'suppressionCount', 'revisionCoverage', 'filters', 'series', 'breakdowns', 'overview', 'dataQuality', 'metrics', 'kpis', 'cards', 'rows', 'pseudonymId', 'pseudonymVersion', 'seasonId', 'rulesetRevision', 'balanceRevision', 'range', 'tab', 'association', 'dimension', 'metric', 'scope']);
const DYNAMIC_CLIENT_FIELDS = new Set(['features', 'events', 'market', 'bots', 'achievements', 'unlockRarity', 'outcomeDistribution', 'adoption', 'actions', 'combinations']);

function query(selector) { return typeof document === 'undefined' ? null : document.querySelector(selector); }
function finite(value, fallback = null) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function enumValue(value, allowed, fallback) { const normalized = String(value || fallback).trim().toLowerCase(); return allowed.includes(normalized) ? normalized : fallback; }
function safeScopeString(value) { return [...value].filter(character => character !== '|' && character.charCodeAt(0) >= 32).join('').slice(0, 80); }
function normalizeRevision(value) { if (value === '' || value === undefined || value === null) return ''; const number = finite(value, null); return number === null ? '' : String(Math.max(0, Math.floor(number))); }
function normalizedRevisionNumber(value, fallback = '') { const normalized = normalizeRevision(value); return normalized === '' ? fallback : Number(normalized); }
function clearAnalyticsOutput() {
  const grid = query('#admin-analytics-grid');
  if (grid) grid.textContent = '';
  if (typeof document === 'undefined') return;
  document.querySelectorAll?.('.analytics-read-model, [data-analytics-chart]')?.forEach(element => { element.textContent = ''; });
}

export function normalizeAnalyticsQuery(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const requestedTab = source.tab || source.view;
  return {
    range: enumValue(source.range, ['hour', 'day', 'week', 'season'], 'hour'),
    seasonId: typeof source.seasonId === 'string' ? safeScopeString(source.seasonId) : '',
    rulesetRevision: normalizeRevision(source.rulesetRevision),
    balanceRevision: normalizeRevision(source.balanceRevision),
    boardVariant: enumValue(source.boardVariant, ['all', 'standard-40', 'metro-52'], 'all'),
    rulesetPreset: enumValue(source.rulesetPreset, ['all', 'classic', 'after-hours', 'custom'], 'all'),
    marketComplexity: enumValue(source.marketComplexity, ['all', 'basic', 'margin', 'shorting', 'derivatives'], 'all'),
    botMode: enumValue(source.botMode, ['all', 'ai', 'no-ai', 'human'], 'all'),
    provider: enumValue(source.provider, ['all', 'ai', 'deepseek', 'deterministic', 'fallback', 'house', 'openai', 'unknown'], 'all'),
    eventId: typeof source.eventId === 'string' ? source.eventId.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80) : '',
    minimumCohort: MIN_COHORT,
    tab: enumValue(requestedTab, ANALYTICS_TABS, 'overview'),
    dimension: enumValue(source.dimension, ['feature', 'ruleset', 'board', 'event', 'bot'], ''),
    metric: typeof source.metric === 'string' ? source.metric.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80) : ''
  };
}

function cleanSafeValue(value, key = '', depth = 0, parentKey = '') {
  if (FORBIDDEN_KEYS.has(String(key).toLowerCase()) || depth > 20) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => cleanSafeValue(item, '', depth + 1, key)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  const output = {};
  Object.entries(value).slice(0, 200).forEach(([childKey, childValue]) => {
    if (!ALLOWED_CLIENT_FIELDS.has(childKey) && !DYNAMIC_CLIENT_FIELDS.has(key) && !DYNAMIC_CLIENT_FIELDS.has(parentKey)) return;
    const clean = cleanSafeValue(childValue, childKey, depth + 1, key);
    if (clean !== undefined) output[childKey] = clean;
  });
  return output;
}

function cleanMetricEntry(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return null;
  const output = {};
  ['type', 'updatedAt'].forEach(key => { if (typeof value[key] === 'string') output[key] = value[key].slice(0, 80); });
  ['count', 'total', 'last', 'min', 'max', 'value'].forEach(key => { const number = finite(value[key]); if (number !== null) output[key] = number; });
  return output;
}

function metricEntries(value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value).filter(([name]) => ALLOWED_METRICS.has(name)) : []; }

export function normalizeAnalyticsSnapshot(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const metrics = {};
  metricEntries(source.metrics).forEach(([name, entry]) => { const clean = cleanMetricEntry(entry); if (clean) metrics[name] = clean; });
  const filters = normalizeAnalyticsQuery(source.filters || source);
  const overview = cleanSafeValue(source.overview, 'overview') || {};
  const breakdowns = Array.isArray(source.breakdowns) ? source.breakdowns.slice(0, 100).map(row => cleanSafeValue(row)).filter(Boolean) : [];
  const series = Array.isArray(source.series) ? source.series.slice(0, 168).map(item => cleanSafeValue(item)).filter(Boolean) : [];
  return {
    schemaVersion: Number.isFinite(Number(source.schemaVersion)) && Number(source.schemaVersion) > 0 ? Number(source.schemaVersion) : 1,
    range: ['hour', 'day', 'week', 'season'].includes(String(source.range || filters.range)) ? String(source.range || filters.range) : filters.range,
    generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt.slice(0, 80) : '',
    pseudonymVersion: typeof source.pseudonymVersion === 'string' ? source.pseudonymVersion.slice(0, 40) : '',
    seasonId: typeof source.seasonId === 'string' ? safeScopeString(source.seasonId) : filters.seasonId,
    rulesetRevision: source.rulesetRevision === null || source.rulesetRevision === undefined ? filters.rulesetRevision : normalizedRevisionNumber(source.rulesetRevision),
    balanceRevision: source.balanceRevision === null || source.balanceRevision === undefined ? filters.balanceRevision : normalizedRevisionNumber(source.balanceRevision),
    boardVariant: enumValue(source.boardVariant, ['all', 'standard-40', 'metro-52'], filters.boardVariant),
    filters,
    suppression: { minimumCohort: MIN_COHORT, suppressedPanels: Math.max(0, Math.floor(finite(source.suppression?.suppressedPanels, 0))) },
    overview,
    association: cleanSafeValue(source.association, 'association') || null,
    series,
    breakdowns,
    dataQuality: cleanSafeValue(source.dataQuality, 'dataQuality') || {},
    metrics,
  };
}

export function metricValue(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  const value = finite(entry.value ?? entry.last ?? entry.total, 0);
  return value === null ? 0 : value;
}

export function isAnalyticsPath(pathname) { return String(pathname || '').split('?')[0] === '/admin/analytics'; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function renderStatus(message, tone = 'muted') { const status = query('#admin-analytics-status'); if (!status) return; status.className = `t-body analytics-status ${tone}`; status.textContent = message; }

function renderKpis(snapshot) {
  const kpis = Array.isArray(snapshot.overview?.kpis) ? snapshot.overview.kpis.slice(0, 6) : [];
  if (!kpis.length) return '';
  return kpis.map(item => `<article class="analytics-metric panel noise"><span class="t-micro g400">${escapeHtml(item.label || item.id || 'Metric')}</span><strong class="t-money g100">${item.value === null || item.value === undefined ? '—' : escapeHtml(Number(item.value).toLocaleString())}</strong><span class="t-micro ink-3">DENOMINATOR ${item.denominator === null || item.denominator === undefined ? '—' : escapeHtml(item.denominator)}</span><span class="t-micro ink-3">${escapeHtml(item.comparison?.period || item.comparison?.label || 'SELECTED PERIOD')}</span><span class="t-micro ink-3">${escapeHtml(item.definition || 'Aggregate measure')}</span></article>`).join('');
}

function renderAnalyticsCharts(snapshot) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll?.('[data-analytics-chart]').forEach(container => {
    const title = container.getAttribute('data-chart-title') || 'Analytics series';
    const unit = container.getAttribute('data-chart-unit') || 'value';
    const mode = container.getAttribute('data-chart-mode') || 'line';
    renderAnalyticsChart(container, snapshot.series, { title, unit, mode });
  });
}

function aggregateValue(value) {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value !== 'object') return String(value);
  if (Object.hasOwn(value, 'value') || Object.hasOwn(value, 'denominator')) {
    const current = value.value === null || value.value === undefined ? 'N/A' : value.value;
    const denominator = value.denominator === null || value.denominator === undefined ? '' : ` / DENOMINATOR ${value.denominator}`;
    return `${current}${denominator}`;
  }
  return Object.entries(value).slice(0, 8).map(([key, child]) => `${key}: ${aggregateValue(child)}`).join('; ') || 'N/A';
}

function renderAnalyticsReadModel(snapshot) {
  if (typeof document === 'undefined') return;
  const tab = snapshot.filters.tab;
  const panel = [...(document.querySelectorAll?.('[data-analytics-panel]') || [])].find(candidate => candidate.getAttribute('data-analytics-panel') === tab);
  if (!panel) return;
  panel.querySelector?.('.analytics-read-model')?.remove?.();
  const breakdowns = Array.isArray(snapshot.breakdowns) ? snapshot.breakdowns : [];
  const rows = breakdowns.flatMap(row => Array.isArray(row?.rows) ? row.rows : [row]);
  const association = snapshot.association;
  const hasEvidence = rows.length > 0 || association;
  let content = '';
  if (hasEvidence) {
    const tableRows = rows.map(row => {
      if (row?.suppressed) return `<tr><td colspan="2">INSUFFICIENT COHORT · MIN COHORT 5</td></tr>`;
      const values = Object.entries(row || {}).filter(([key]) => key !== 'scope').slice(0, 12).map(([key, value]) => `<span class="analytics-read-field"><b>${escapeHtml(key)}</b> ${escapeHtml(aggregateValue(value))}</span>`).join('');
      return `<tr><th scope="row">${escapeHtml(row?.pseudonymId || row?.eventId || row?.botMode || row?.rulesetPreset || 'AGGREGATE')}</th><td>${values}</td></tr>`;
    }).join('');
    const associationMarkup = association ? `<p class="analytics-association">${escapeHtml(association.label || 'ASSOCIATION, NOT CAUSATION')} · EXPOSED ${escapeHtml(aggregateValue(association.exposed))} · CONTROL ${escapeHtml(aggregateValue(association.control))} · RELATIVE DELTA ${escapeHtml(association.relativeRateDelta)}</p>` : '';
    content = `${associationMarkup}<table class="analytics-read-table"><caption>${escapeHtml(tab)} verified read model</caption><thead><tr><th scope="col">GROUP</th><th scope="col">MEASURES</th></tr></thead><tbody>${tableRows}</tbody></table>`;
  } else if (!snapshot.metrics || Object.keys(snapshot.metrics).length === 0 && !(snapshot.overview?.kpis?.length)) {
    content = '<p class="analytics-empty">NO VERIFIED OBSERVATIONS FOR THIS FILTER</p><button class="btn-dark analytics-reset-filter" type="button" data-analytics-reset>RESET FILTERS</button>';
  }
  if (!content) return;
  panel.insertAdjacentHTML?.('beforeend', `<div class="analytics-read-model">${content}</div>`);
  if (!panel.insertAdjacentHTML) panel.innerHTML += `<div class="analytics-read-model">${content}</div>`;
  panel.querySelectorAll?.('[data-analytics-reset]')?.forEach(button => listenReset(button));
}

function listenReset(button) {
  if (!button || button.dataset?.analyticsResetBound) return;
  if (!button.dataset) button.dataset = {};
  button.dataset.analyticsResetBound = 'true';
  button.addEventListener?.('click', event => { event.preventDefault(); globalThis.__poorupAnalyticsReset?.(); });
}

export function renderAnalyticsSnapshot(value) {
  const snapshot = normalizeAnalyticsSnapshot(value);
  const grid = query('#admin-analytics-grid');
  if (grid) {
    const kpis = renderKpis(snapshot);
    const entries = Object.entries(snapshot.metrics);
    grid.innerHTML = kpis || (entries.length
      ? entries.map(([name, entry]) => `<article class="analytics-metric panel noise"><span class="t-micro g400">${escapeHtml(METRIC_LABELS[name])}</span><strong class="t-money g100">${escapeHtml(metricValue(entry).toLocaleString())}</strong><span class="t-micro ink-3">${entry.type === 'gauge' ? 'CURRENT' : 'RECORDED'}</span></article>`).join('')
      : '<p class="t-body ink-2 analytics-empty">NO VERIFIED OBSERVATIONS FOR THIS FILTER</p>');
  }
  renderAnalyticsCharts(snapshot);
  renderAnalyticsReadModel(snapshot);
  if (snapshot.suppression.suppressedPanels > 0) renderStatus('INSUFFICIENT COHORT · MIN COHORT 5', 'warning');
  else if (snapshot.dataQuality.stale === true || snapshot.dataQuality.fresh === false) renderStatus(`STALE · LAST VERIFIED ${snapshot.generatedAt || 'UNKNOWN'}`, 'warning');
  else renderStatus(`SYNCED ${snapshot.range.toUpperCase()} · ${snapshot.generatedAt || 'NOW'}`, 'green');
  return snapshot;
}

function queryString(filters) { const params = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value !== '' && value !== null && value !== undefined && key !== 'minimumCohort') params.set(key, value); }); return params.toString(); }
function readUrlFilters() {
  const location = globalThis.window?.location;
  if (!location || !isAnalyticsPath(location.pathname)) return {};
  const params = new URLSearchParams(location.search || '');
  return Object.fromEntries(params.entries());
}
function syncUrlFilters(filters) {
  const location = globalThis.window?.location;
  const history = globalThis.window?.history;
  if (!location || !isAnalyticsPath(location.pathname) || typeof history?.replaceState !== 'function') return;
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

  function listen(target, event, handler) {
    target?.addEventListener?.(event, handler);
    if (target?.removeEventListener) listeners.push(() => target.removeEventListener(event, handler));
  }

  function tabElements() { return typeof document === 'undefined' ? [] : [...(document.querySelectorAll?.('[data-analytics-tab]') || [])]; }

  function applyTabState({ focus = false } = {}) {
    const tabs = tabElements();
    tabs.forEach((element, index) => {
      const active = element.getAttribute('data-analytics-tab') === filters.tab;
      const tabId = element.id || `analytics-tab-${index + 1}`;
      element.id = tabId;
      element.setAttribute('role', 'tab');
      element.setAttribute('aria-selected', String(active));
      element.setAttribute('tabindex', active ? '0' : '-1');
      element.classList.toggle('is-active', active);
      if (focus && active) element.focus?.();
      listenOnce(element, 'click', () => setTab(element.getAttribute('data-analytics-tab')));
      listenOnce(element, 'keydown', event => {
        if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
        const current = tabs.indexOf(element);
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setTab(element.getAttribute('data-analytics-tab'), { focus: true }); return; }
        event.preventDefault();
        const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'Home' ? -tabs.length : event.key === 'End' ? tabs.length : 1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + offset + tabs.length) % tabs.length;
        setTab(tabs[next]?.getAttribute('data-analytics-tab'), { focus: true });
      });
    });
    if (typeof document !== 'undefined') document.querySelectorAll?.('[data-analytics-panel]')?.forEach(element => {
      const active = element.getAttribute('data-analytics-panel') === filters.tab;
      element.classList.toggle('is-hidden', !active);
      element.setAttribute('aria-hidden', String(!active));
      const tab = tabs.find(candidate => candidate.getAttribute('data-analytics-tab') === filters.tab);
      if (tab) element.setAttribute('aria-labelledby', tab.id);
    });
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
    return { ...filters };
  }

  function wireControls() {
    if (typeof document === 'undefined') return;
    applyTabState();
    if (Object.keys(readUrlFilters()).length) syncFilterControls();
    document.querySelectorAll?.('[data-analytics-filter]')?.forEach(control => listenOnce(control, 'change', () => { filters = normalizeAnalyticsQuery({ ...filters, ...readFilterControls() }); }));
    const apply = document.querySelector?.('[data-analytics-apply]');
    const reset = document.querySelector?.('[data-analytics-reset]');
    const refreshButton = document.querySelector?.('[data-analytics-refresh]');
    const form = document.querySelector?.('form.analytics-filters');
    listenOnce(apply, 'click', () => { setFilters(readFilterControls()); void load(filters); });
    listenOnce(reset, 'click', () => { filters = normalizeAnalyticsQuery({}); syncFilterControls(); setTab('overview'); void load(filters); });
    listenOnce(refreshButton, 'click', () => { void refresh(); });
    listenOnce(form, 'submit', event => { event.preventDefault(); setFilters(readFilterControls()); void load(filters); });
    globalThis.__poorupAnalyticsReset = () => { filters = normalizeAnalyticsQuery({}); syncFilterControls(); setTab('overview'); void load(filters); };
    listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') { requestGeneration += 1; abortController?.abort(); request = null; } });
  }

  async function load(next = {}) {
    if (destroyed) return { success: false, status: 499 };
    if (request) return request;
    filters = normalizeAnalyticsQuery({ ...filters, ...next });
    if (!customFetcher && !state.account?.sessionToken) { renderStatus('ADMIN ACCOUNT REQUIRED', 'warning'); return { success: false, status: 403 }; }
    if (!requestFetcher) return { success: false, status: 503 };
    const url = `${endpoint}?${queryString(filters)}`;
    const headers = !customFetcher && state.account?.sessionToken ? { 'x-poorup-session-token': state.account.sessionToken } : {};
    abortController = typeof AbortController === 'function' ? new AbortController() : null;
    renderStatus(snapshot ? 'REFRESHING ANALYTICS…' : 'LOADING ANALYTICS…');
    announce(snapshot ? 'Refreshing analytics' : 'Loading analytics');
    const generation = ++requestGeneration;
    request = Promise.resolve().then(() => requestFetcher(url, { headers, signal: abortController?.signal }))
      .then(async response => {
        const payload = typeof response?.json === 'function' ? await response.json() : response;
        if (generation !== requestGeneration || destroyed) return { success: false, status: 499 };
        if (response?.ok === false || payload?.success === false) {
          if (payload?.status === 403 || response?.status === 403) { snapshot = null; clearAnalyticsOutput(); renderStatus('ADMIN ACCESS REQUIRED', 'warning'); }
          else if (payload?.status === 503 || response?.status === 503) renderStatus('ROLLUP UNAVAILABLE · RETRY', 'warning');
          else if (payload?.status === 429 || response?.status === 429) renderStatus('ANALYTICS RATE LIMITED · RETRY', 'warning');
          else renderStatus('ANALYTICS UNAVAILABLE · RETRY', 'warning');
          return payload;
        }
        snapshot = renderAnalyticsSnapshot(payload);
        return snapshot;
      })
      .catch(error => { if (error?.name === 'AbortError') return { success: false, status: 499 }; renderStatus(snapshot ? 'ANALYTICS REFRESH TIMED OUT · RETRY' : 'ANALYTICS UNAVAILABLE · RETRY', 'warning'); return { success: false, status: 503 }; })
      .finally(() => { if (generation === requestGeneration) { request = null; abortController = null; } });
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
  function destroy() { destroyed = true; requestGeneration += 1; abortController?.abort(); request = null; if (globalThis.__poorupAnalyticsReset) delete globalThis.__poorupAnalyticsReset; listeners.splice(0).forEach(remove => remove()); }

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
