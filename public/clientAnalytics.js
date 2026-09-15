import { state } from './clientState.js';
import { renderAnalyticsChart } from './clientAnalyticsCharts.js';
import { ANALYTICS_TABS } from './clientAnalyticsCatalog.js';
import { ALLOWED_METRICS, METRIC_LABELS, MIN_COHORT, normalizeAnalyticsQuery, normalizeAnalyticsSnapshot, metricValue, isAnalyticsPath } from './clientAnalyticsViewModel.js';
export { normalizeAnalyticsQuery, normalizeAnalyticsSnapshot, metricValue, isAnalyticsPath, MIN_COHORT } from './clientAnalyticsViewModel.js';
export { ANALYTICS_TABS } from './clientAnalyticsCatalog.js';

function query(selector) { return typeof document === 'undefined' ? null : document.querySelector(selector); }
function clearAnalyticsOutput() {
  const grid = query('#admin-analytics-grid');
  if (grid) grid.textContent = '';
  if (typeof document === 'undefined') return;
  document.querySelectorAll?.('.analytics-read-model, [data-analytics-chart]')?.forEach(element => { element.textContent = ''; });
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function renderStatus(message, tone = 'muted') {
  const status = query('#admin-analytics-status');
  if (!status) return;
  const text = String(message || '');
  const normalized = text.toUpperCase();
  const state = normalized.includes('LOADING') ? 'loading'
    : normalized.includes('REFRESHING') ? 'refreshing'
      : normalized.includes('STALE') ? 'stale'
        : normalized.includes('SUPPRESSED') || normalized.includes('MIN COHORT') ? 'suppressed'
          : normalized.includes('ACCESS REQUIRED') ? 'unauthorized'
            : normalized.includes('RATE LIMITED') ? 'rate-limited'
              : normalized.includes('UNAVAILABLE') || normalized.includes('TIMED OUT') ? 'unavailable'
                : normalized.includes('NO VERIFIED') ? 'empty' : 'verified';
  status.className = `t-body analytics-status ${tone}`;
  status.textContent = text;
  status.setAttribute?.('data-analytics-state', state);
  status.setAttribute?.('aria-busy', String(state === 'loading' || state === 'refreshing'));
  const alerts = query('#admin-analytics-alerts');
  if (alerts) {
    alerts.setAttribute?.('data-analytics-state', state);
    if (tone === 'warning' || ['stale', 'suppressed', 'unauthorized', 'rate-limited', 'unavailable'].includes(state)) alerts.textContent = text;
    else if (state === 'verified') alerts.textContent = 'NO ACTIONABLE ALERTS';
  }
}

function finiteAnalyticsNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === 'object') {
    for (const key of ['value', 'rate', 'count', 'sampleSize', 'numerator', 'denominator']) {
      const parsed = finiteAnalyticsNumber(value[key]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function panelPoint(label, value) {
  const numeric = finiteAnalyticsNumber(value);
  return numeric === null ? null : { label: String(label || 'Observation').slice(0, 80), value: numeric };
}

function panelRows(model) { return Array.isArray(model?.rows) ? model.rows : []; }
function objectSeries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).slice(0, 24).map(([label, item]) => panelPoint(label, item)).filter(Boolean);
}

const ANALYTICS_PANEL_DESCRIPTORS = Object.freeze({
  overview: { title: 'Verified activity', unit: 'observations', mode: 'line', series: snapshot => snapshot.series },
  'match-health': {
    title: 'Match reliability', unit: 'matches', mode: 'bar',
    series: snapshot => {
      const model = snapshot.breakdowns?.[0] || {};
      return [['Starts', model.starts], ['Completions', model.completions], ['Stalls', model.stalls], ['Reconnect rate', model.reconnectRate], ['AFK rate', model.afkRate], ['Bankruptcies', model.bankruptcies], ['Comebacks', model.comebacks]].map(([label, value]) => panelPoint(label, value)).filter(Boolean);
    }
  },
  rulesets: { title: 'Ruleset and board adoption', unit: 'matches', mode: 'bar', series: snapshot => panelRows(snapshot.breakdowns?.[0]).map(row => panelPoint(`${row.rulesetPreset || 'ruleset'} / ${row.boardVariant || 'board'}`, row.matches)).filter(Boolean) },
  economy: { title: 'Economic feature adoption', unit: 'adoption', mode: 'bar', series: snapshot => objectSeries(snapshot.breakdowns?.[0]?.adoption) },
  events: { title: 'Event eligibility', unit: 'observations', mode: 'bar', series: snapshot => panelRows(snapshot.breakdowns?.[0]).map(row => panelPoint(row.eventId || 'event', row.eligibility)).filter(Boolean) },
  bots: { title: 'Bot matches by provider', unit: 'matches', mode: 'bar', series: snapshot => panelRows(snapshot.breakdowns?.[0]).map(row => panelPoint(`${row.botMode || 'bot'} / ${row.provider || 'provider'}`, row.matches)).filter(Boolean) },
  quality: { title: 'Snapshot quality signals', unit: 'observations', mode: 'bar', series: snapshot => {
    const model = snapshot.breakdowns?.[0] || snapshot.dataQuality || {};
    return [['Lag seconds', model.lagSeconds], ['Queue depth', model.queueDepth], ['Pending writes', model.pendingWrites], ['Rejected events', model.rejectedEvents], ['Suppressed panels', model.suppressionCount]].map(([label, value]) => panelPoint(label, value)).filter(Boolean);
  } }
});

export { ANALYTICS_PANEL_DESCRIPTORS };

function renderAnalyticsChartEmpty(container, title) {
  container.innerHTML = `<figure class="analytics-chart analytics-chart-placeholder" data-chart-state="empty"><figcaption>${escapeHtml(title)}</figcaption><p class="t-micro ink-3">NO VERIFIED OBSERVATIONS FOR THIS PANEL</p></figure>`;
}

function renderKpis(snapshot) {
  const kpis = Array.isArray(snapshot.overview?.kpis) ? snapshot.overview.kpis.slice(0, 6) : [];
  if (!kpis.length) return '';
  return kpis.map(item => {
    const id = String(item.id || '').toLowerCase();
    const rawUnit = String(item.unit || '').toLowerCase();
    const unit = rawUnit || (id.includes('rate') || id.includes('adoption') ? 'percent' : id.includes('latency') || id.includes('duration') ? 'seconds' : id.includes('player') || id.includes('room') ? 'players' : id.includes('match') || id.includes('round') || id.includes('started') ? 'matches' : 'value');
    const value = finiteAnalyticsNumber(item.value);
    const numberFormat = (number, maximumFractionDigits = 2) => number === null ? 'N/A' : number.toLocaleString(undefined, { maximumFractionDigits });
    const displayValue = value === null ? '·' : unit === 'percent' ? `${numberFormat(Math.abs(value) <= 1 ? value * 100 : value, 1)}%` : unit === 'seconds' ? numberFormat(value) : unit === 'milliseconds' ? numberFormat(value, 0) : numberFormat(value, unit === 'value' ? 2 : 1);
    const displayUnit = unit === 'value' ? '' : unit;
    const numerator = finiteAnalyticsNumber(item.numerator);
    const denominator = finiteAnalyticsNumber(item.denominator);
    const denominatorMarkup = numerator === null
      ? `DENOMINATOR ${denominator === null ? 'N/A' : numberFormat(denominator, 0)}`
      : `NUMERATOR ${numberFormat(numerator, 0)} / DENOMINATOR ${denominator === null ? 'N/A' : numberFormat(denominator, 0)}`;
    const comparison = item.comparison && typeof item.comparison === 'object' ? item.comparison : null;
    const comparisonValue = finiteAnalyticsNumber(comparison?.value ?? comparison?.baseline);
    const comparisonDelta = finiteAnalyticsNumber(comparison?.delta ?? comparison?.change);
    const comparisonParts = comparison ? [`BASELINE ${comparisonValue === null ? 'N/A' : (unit === 'percent' ? `${numberFormat(Math.abs(comparisonValue) <= 1 ? comparisonValue * 100 : comparisonValue, 1)}%` : numberFormat(comparisonValue))}`] : [];
    if (comparisonDelta !== null) comparisonParts.push(`DELTA ${comparisonDelta >= 0 ? '+' : ''}${unit === 'percent' ? `${numberFormat(comparisonDelta * 100, 1)}pp` : numberFormat(comparisonDelta)}`);
    if (comparison?.period || comparison?.label) comparisonParts.push(String(comparison.period || comparison.label).toUpperCase());
    if (!comparisonParts.length) comparisonParts.push('COMPARISON UNAVAILABLE');
    const generatedAt = typeof item.generatedAt === 'string' && item.generatedAt ? item.generatedAt : snapshot.generatedAt || 'UNKNOWN';
    return `<article class="analytics-metric panel noise" data-kpi-id="${escapeHtml(item.id || 'metric')}"><span class="t-micro g400">${escapeHtml(item.label || item.id || 'Metric')}</span><strong class="t-money g100">${escapeHtml(displayValue)}</strong>${displayUnit ? `<span class="t-micro ink-3 analytics-kpi-unit">${escapeHtml(displayUnit)}</span>` : ''}<span class="t-micro ink-3 analytics-kpi-context">${escapeHtml(denominatorMarkup)}</span><span class="t-micro ink-3 analytics-kpi-context">${escapeHtml(comparisonParts.join(' · '))}</span><span class="t-micro ink-3 analytics-kpi-definition">${escapeHtml(item.definition || 'DEFINITION NOT PROVIDED')}</span><time class="t-micro ink-3 analytics-kpi-timestamp" datetime="${escapeHtml(generatedAt)}">VERIFIED ${escapeHtml(generatedAt)}</time></article>`;
  }).join('');
}

function renderAnalyticsCharts(snapshot) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll?.('[data-analytics-chart]').forEach(container => {
    const tab = container.getAttribute('data-analytics-panel-chart') || snapshot.filters.tab;
    const descriptor = ANALYTICS_PANEL_DESCRIPTORS[tab] || ANALYTICS_PANEL_DESCRIPTORS.overview;
    const title = container.getAttribute('data-chart-title') || descriptor.title;
    const unit = container.getAttribute('data-chart-unit') || descriptor.unit;
    const mode = container.getAttribute('data-chart-mode') || descriptor.mode;
    const values = descriptor.series(snapshot) || [];
    if (!values.length) renderAnalyticsChartEmpty(container, title);
    else renderAnalyticsChart(container, values, { title, unit, mode, summary: `${values.length} verified ${unit}` });
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
  const lastVerified = query('[data-analytics-last-verified]');
  if (lastVerified) lastVerified.textContent = `LAST VERIFIED · ${snapshot.generatedAt || 'UNKNOWN'}`;
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
    if (!requestFetcher) { renderStatus('ROLLUP UNAVAILABLE · RETRY', 'warning'); return { success: false, status: 503 }; }
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
