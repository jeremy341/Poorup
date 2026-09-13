import { state } from './clientState.js';

const ALLOWED_METRICS = new Set([
  'active-sockets', 'active-rooms', 'active-rounds', 'room-reconnects', 'restore-failures',
  'action-latency-ms', 'error-count', 'bot-fallbacks', 'maintenance-transitions',
  'backup-failures', 'manual-codescene-runs',
]);

const METRIC_LABELS = Object.freeze({
  'active-sockets': 'Active sockets',
  'active-rooms': 'Active rooms',
  'active-rounds': 'Active rounds',
  'room-reconnects': 'Room reconnects',
  'restore-failures': 'Restore failures',
  'action-latency-ms': 'Action latency',
  'error-count': 'Server errors',
  'bot-fallbacks': 'Bot fallbacks',
  'maintenance-transitions': 'Maintenance transitions',
  'backup-failures': 'Backup failures',
  'manual-codescene-runs': 'Manual CodeScene runs',
});

function query(selector) {
  return typeof document === 'undefined' ? null : document.querySelector(selector);
}

function copyStringMetricFields(value, output) {
  ['type', 'updatedAt'].forEach(key => {
    if (typeof value[key] === 'string') output[key] = value[key].slice(0, 80);
  });
}

function copyNumberMetricFields(value, output) {
  ['count', 'total', 'last', 'min', 'max', 'value'].forEach(key => {
    const number = Number(value[key]);
    if (Number.isFinite(number)) output[key] = number;
  });
}

function isMetricRecord(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function metricEntries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).filter(([name]) => ALLOWED_METRICS.has(name));
}

function cleanMetricEntry(value) {
  if (!isMetricRecord(value)) return null;
  const output = {};
  copyStringMetricFields(value, output);
  copyNumberMetricFields(value, output);
  return output;
}

export function normalizeAnalyticsSnapshot(value = {}) {
  const metrics = {};
  metricEntries(value.metrics).forEach(([name, entry]) => {
    const clean = cleanMetricEntry(entry);
    if (clean) metrics[name] = clean;
  });
  return {
    range: ['hour', 'day', 'week'].includes(String(value.range)) ? String(value.range) : 'hour',
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt.slice(0, 80) : '',
    metrics,
  };
}

export function metricValue(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  const value = Number(entry.value ?? entry.last ?? entry.total);
  return Number.isFinite(value) ? value : 0;
}

export function isAnalyticsPath(pathname) {
  return String(pathname || '').split('?')[0] === '/admin/analytics';
}

function renderStatus(message, tone = 'muted') {
  const status = query('#admin-analytics-status');
  if (!status) return;
  status.className = `t-body analytics-status ${tone}`;
  status.textContent = message;
}

export function renderAnalyticsSnapshot(value) {
  const snapshot = normalizeAnalyticsSnapshot(value);
  const grid = query('#admin-analytics-grid');
  if (!grid) return snapshot;
  const entries = Object.entries(snapshot.metrics);
  grid.innerHTML = entries.length
    ? entries.map(([name, entry]) => `<article class="analytics-metric panel noise"><span class="t-micro g400">${METRIC_LABELS[name]}</span><strong class="t-money g100">${metricValue(entry).toLocaleString()}</strong><span class="t-micro ink-3">${entry.type === 'gauge' ? 'CURRENT' : 'RECORDED'}</span></article>`).join('')
    : '<p class="t-body ink-2 analytics-empty">No metrics recorded for this window.</p>';
  renderStatus(`SYNCED ${snapshot.range.toUpperCase()} · ${snapshot.generatedAt || 'NOW'}`, 'green');
  return snapshot;
}

async function loadAnalytics() {
  const token = state.account?.sessionToken;
  if (!token) {
    renderStatus('ADMIN ACCOUNT REQUIRED', 'warning');
    return { success: false, status: 403 };
  }
  renderStatus('LOADING ANALYTICS…');
  try {
    const response = await fetch('/admin/analytics/summary?range=hour', { headers: { 'x-poorup-session-token': token } });
    const payload = await response.json();
    if (!response.ok || payload?.success === false) {
      renderStatus(response.status === 403 ? 'ADMIN ACCESS REQUIRED' : 'ANALYTICS UNAVAILABLE · RETRY', 'warning');
      return payload;
    }
    return renderAnalyticsSnapshot(payload);
  } catch {
    renderStatus('ANALYTICS UNAVAILABLE · RETRY', 'warning');
    return { success: false, status: 503 };
  }
}

export function initAnalytics() {
  if (!isAnalyticsPath(globalThis.window?.location?.pathname)) return false;
  const view = query('#view-admin-analytics');
  if (!view) return false;
  document.querySelectorAll?.('.view').forEach(candidate => candidate.classList.toggle('is-hidden', candidate !== view));
  view.classList.remove('is-hidden');
  const retry = query('#admin-analytics-retry');
  retry?.addEventListener('click', () => { void loadAnalytics(); }, { once: false });
  void loadAnalytics();
  return true;
}
