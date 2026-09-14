import { state } from './clientState.js';

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
const FORBIDDEN_KEYS = new Set(['displayname', 'username', 'accountid', 'clientid', 'roomcode', 'chat', 'message', 'text', 'hiddencards', 'privateloanterms', 'opponentsecrets', 'password', 'sessiontoken', 'rawpayload', 'display_name', 'account_id', 'client_id', 'room_code', 'session_token', 'hidden_cards', 'private_loan_terms', 'opponent_secrets']);

function query(selector) { return typeof document === 'undefined' ? null : document.querySelector(selector); }
function finite(value, fallback = null) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function enumValue(value, allowed, fallback) { const normalized = String(value || fallback).trim().toLowerCase(); return allowed.includes(normalized) ? normalized : fallback; }
function safeScopeString(value) { return [...value].filter(character => character !== '|' && character.charCodeAt(0) >= 32).join('').slice(0, 80); }

export function normalizeAnalyticsQuery(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    range: enumValue(source.range, ['hour', 'day', 'week', 'season'], 'hour'),
    seasonId: typeof source.seasonId === 'string' ? safeScopeString(source.seasonId) : '',
    rulesetRevision: source.rulesetRevision === '' || source.rulesetRevision === undefined || source.rulesetRevision === null ? '' : String(Math.max(0, Math.floor(finite(source.rulesetRevision, 0)))),
    balanceRevision: source.balanceRevision === '' || source.balanceRevision === undefined || source.balanceRevision === null ? '' : String(Math.max(0, Math.floor(finite(source.balanceRevision, 0)))),
    boardVariant: enumValue(source.boardVariant, ['all', 'standard-40', 'metro-52'], 'all'),
    rulesetPreset: enumValue(source.rulesetPreset, ['all', 'classic', 'after-hours', 'custom'], 'all'),
    marketComplexity: enumValue(source.marketComplexity, ['all', 'basic', 'margin', 'shorting', 'derivatives'], 'all'),
    botMode: enumValue(source.botMode, ['all', 'ai', 'no-ai', 'human'], 'all'),
    eventId: typeof source.eventId === 'string' ? source.eventId.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80) : '',
    minimumCohort: MIN_COHORT,
    tab: enumValue(source.tab, ANALYTICS_TABS, 'overview')
  };
}

function cleanSafeValue(value, key = '', depth = 0) {
  if (FORBIDDEN_KEYS.has(String(key).toLowerCase()) || depth > 5) return undefined;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => cleanSafeValue(item, '', depth + 1)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  const output = {};
  Object.entries(value).slice(0, 200).forEach(([childKey, childValue]) => {
    const clean = cleanSafeValue(childValue, childKey, depth + 1);
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
    filters,
    suppression: { minimumCohort: MIN_COHORT, suppressedPanels: Math.max(0, Math.floor(finite(source.suppression?.suppressedPanels, 0))) },
    overview,
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
  return kpis.map(item => `<article class="analytics-metric panel noise"><span class="t-micro g400">${escapeHtml(item.label || item.id || 'Metric')}</span><strong class="t-money g100">${item.value === null || item.value === undefined ? '—' : escapeHtml(Number(item.value).toLocaleString())}</strong><span class="t-micro ink-3">DENOMINATOR ${item.denominator === null || item.denominator === undefined ? '—' : escapeHtml(item.denominator)}</span></article>`).join('');
}

export function renderAnalyticsSnapshot(value) {
  const snapshot = normalizeAnalyticsSnapshot(value);
  const grid = query('#admin-analytics-grid');
  if (!grid) return snapshot;
  const kpis = renderKpis(snapshot);
  const entries = Object.entries(snapshot.metrics);
  grid.innerHTML = kpis || (entries.length
    ? entries.map(([name, entry]) => `<article class="analytics-metric panel noise"><span class="t-micro g400">${escapeHtml(METRIC_LABELS[name])}</span><strong class="t-money g100">${escapeHtml(metricValue(entry).toLocaleString())}</strong><span class="t-micro ink-3">${entry.type === 'gauge' ? 'CURRENT' : 'RECORDED'}</span></article>`).join('')
    : '<p class="t-body ink-2 analytics-empty">NO VERIFIED OBSERVATIONS FOR THIS FILTER</p>');
  if (snapshot.suppression.suppressedPanels > 0) renderStatus('INSUFFICIENT COHORT · MIN COHORT 5', 'warning');
  else if (snapshot.dataQuality.stale === true || snapshot.dataQuality.fresh === false) renderStatus(`STALE · LAST VERIFIED ${snapshot.generatedAt || 'UNKNOWN'}`, 'warning');
  else renderStatus(`SYNCED ${snapshot.range.toUpperCase()} · ${snapshot.generatedAt || 'NOW'}`, 'green');
  return snapshot;
}

function queryString(filters) { const params = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value !== '' && value !== null && value !== undefined && key !== 'minimumCohort') params.set(key, value); }); return params.toString(); }

export function createAnalyticsController({ fetcher = null, announce = () => {}, modal = null, endpoint = '/admin/analytics/balance' } = {}) {
  const customFetcher = typeof fetcher === 'function';
  const requestFetcher = customFetcher ? fetcher : globalThis.fetch?.bind(globalThis);
  let filters = normalizeAnalyticsQuery({});
  let snapshot = null;
  let request = null;
  let abortController = null;
  let destroyed = false;

  function setTab(tab) {
    filters = normalizeAnalyticsQuery({ ...filters, tab });
    if (typeof document !== 'undefined') {
      document.querySelectorAll?.('[data-analytics-tab]').forEach(element => { const active = element.getAttribute('data-analytics-tab') === filters.tab; element.setAttribute('aria-selected', String(active)); element.classList.toggle('is-active', active); });
      document.querySelectorAll?.('[data-analytics-panel]').forEach(element => element.classList.toggle('is-hidden', element.getAttribute('data-analytics-panel') !== filters.tab));
    }
    return { ...filters };
  }
  function setFilters(next = {}) { filters = normalizeAnalyticsQuery({ ...filters, ...next }); return { ...filters }; }

  async function load(next = {}) {
    if (destroyed) return { success: false, status: 499 };
    if (request) return request;
    filters = normalizeAnalyticsQuery({ ...filters, ...next });
    if (!customFetcher && !state.account?.sessionToken) { renderStatus('ADMIN ACCOUNT REQUIRED', 'warning'); return { success: false, status: 403 }; }
    if (!requestFetcher) return { success: false, status: 503 };
    const url = `${endpoint}?${queryString(filters)}`;
    const headers = !customFetcher && state.account?.sessionToken ? { 'x-poorup-session-token': state.account.sessionToken } : {};
    abortController = typeof AbortController === 'function' ? new AbortController() : null;
    renderStatus('LOADING ANALYTICS…');
    announce('Loading analytics');
    request = Promise.resolve().then(() => requestFetcher(url, { headers, signal: abortController?.signal }))
      .then(async response => {
        const payload = typeof response?.json === 'function' ? await response.json() : response;
        if (response?.ok === false || payload?.success === false) {
          if (payload?.status === 403 || response?.status === 403) { snapshot = null; const grid = query('#admin-analytics-grid'); if (grid) grid.textContent = ''; renderStatus('ADMIN ACCESS REQUIRED', 'warning'); }
          else if (payload?.status === 503 || response?.status === 503) renderStatus('ROLLUP UNAVAILABLE · RETRY', 'warning');
          else if (payload?.status === 429 || response?.status === 429) renderStatus('ANALYTICS RATE LIMITED · RETRY', 'warning');
          else renderStatus('ANALYTICS UNAVAILABLE · RETRY', 'warning');
          return payload;
        }
        snapshot = renderAnalyticsSnapshot(payload);
        return snapshot;
      })
      .catch(error => { if (error?.name === 'AbortError') return { success: false, status: 499 }; renderStatus(snapshot ? 'ANALYTICS REFRESH TIMED OUT · RETRY' : 'ANALYTICS UNAVAILABLE · RETRY', 'warning'); return { success: false, status: 503 }; })
      .finally(() => { request = null; abortController = null; });
    return request;
  }
  function refresh() { return load(filters); }
  function openDrilldown(trigger, next = {}) { if (!modal) return null; const options = { trigger, query: normalizeAnalyticsQuery({ ...filters, ...next }) }; if (typeof modal.open === 'function') return modal.open(options); if (typeof modal.show === 'function') return modal.show(options); return null; }
  function destroy() { destroyed = true; abortController?.abort(); request = null; }
  return Object.freeze({ destroy, load, openDrilldown, refresh, setFilters, setTab, get filters() { return { ...filters }; }, get snapshot() { return snapshot; } });
}

let analyticsController = null;
export function initAnalytics() {
  if (!isAnalyticsPath(globalThis.window?.location?.pathname)) return false;
  const view = query('#view-admin-analytics'); if (!view) return false;
  document.querySelectorAll?.('.view').forEach(candidate => candidate.classList.toggle('is-hidden', candidate !== view)); view.classList.remove('is-hidden');
  analyticsController?.destroy(); analyticsController = createAnalyticsController();
  query('#admin-analytics-retry')?.addEventListener('click', () => { void analyticsController.refresh(); });
  void analyticsController.load(); return true;
}

export { ALLOWED_METRICS, METRIC_LABELS };
