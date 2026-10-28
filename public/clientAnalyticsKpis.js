import { OVERVIEW_KPIS } from './clientAnalyticsCatalog.js';

// The six headline tiles: the number, the change against the previous period (when sent),
// and the real denominator behind a rate. The definition is the tile title, also read out to AT.
// Amber or red only when the server says so (`state`) or sends thresholds; nothing invents a limit.

export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }

export function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') { if (value.trim() === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
  if (value && typeof value === 'object') {
    for (const key of ['value', 'rate', 'count']) { const parsed = finiteNumber(value[key]); if (parsed !== null) return parsed; }
  }
  return null;
}

export function numberFormat(number, maximumFractionDigits = 2) {
  if (number === null) return 'N/A';
  return number.toLocaleString(undefined, { maximumFractionDigits });
}

function matchesAny(text, fragments) { return fragments.some(fragment => text.includes(fragment)); }

function kpiUnit(item, id) {
  const rawUnit = String(item.unit || '').toLowerCase();
  if (rawUnit) return rawUnit;
  if (matchesAny(id, ['rate', 'adoption'])) return 'percent';
  if (matchesAny(id, ['latency', 'duration'])) return 'seconds';
  if (matchesAny(id, ['player', 'online', 'peak'])) return 'players';
  if (matchesAny(id, ['match', 'round', 'started'])) return 'matches';
  return 'value';
}

export function isPercentUnit(unit) { return unit === 'percent' || unit === 'adoption' || unit.endsWith('rate'); }
function scaledPercent(number) { return Math.abs(number) <= 1 ? number * 100 : number; }

function displayValue(value, unit) {
  if (value === null) return '-';
  if (isPercentUnit(unit)) return `${numberFormat(scaledPercent(value), 1)}%`;
  if (unit === 'milliseconds') return numberFormat(value, 0);
  if (unit === 'seconds') return numberFormat(value);
  return numberFormat(value, unit === 'value' ? 2 : 1);
}

function deltaText(item, unit) {
  const comparison = item.comparison && typeof item.comparison === 'object' ? item.comparison : null;
  if (!comparison) return '';
  const delta = finiteNumber(comparison.delta ?? comparison.change);
  if (delta === null) return '';
  const percent = isPercentUnit(unit);
  const body = percent ? `${numberFormat(Math.abs(delta) * 100, 1)}pp` : numberFormat(Math.abs(delta));
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  const period = String(comparison.period || comparison.label || '').replace(/-/g, ' ').toLowerCase();
  return `${sign}${body}${period ? ` vs ${period}` : ''}`;
}

function denominatorText(item) {
  const numerator = finiteNumber(item.numerator);
  const denominator = finiteNumber(item.denominator);
  if (denominator === null) return '';
  return numerator === null ? `of ${numberFormat(denominator, 0)}` : `${numberFormat(numerator, 0)} of ${numberFormat(denominator, 0)}`;
}

const STATES = ['ok', 'warn', 'bad'];

export function kpiState(item) {
  const given = String(item.state || '').toLowerCase();
  if (STATES.includes(given)) return given;
  const thresholds = item.thresholds && typeof item.thresholds === 'object' ? item.thresholds : null;
  const value = finiteNumber(item.value);
  if (!thresholds || value === null) return 'none';
  const warn = finiteNumber(thresholds.warn);
  const bad = finiteNumber(thresholds.bad);
  if (bad !== null && value >= bad) return 'bad';
  if (warn !== null && value >= warn) return 'warn';
  return warn !== null || bad !== null ? 'ok' : 'none';
}

const STATE_WORDS = Object.freeze({ ok: 'WITHIN LIMIT', warn: 'WATCH', bad: 'OVER LIMIT', none: '' });

function renderKpi(item) {
  const id = String(item.id || '').toLowerCase();
  const unit = kpiUnit(item, id);
  const value = displayValue(finiteNumber(item.value), unit);
  const unitLabel = unit === 'value' || isPercentUnit(unit) ? '' : unit;
  const delta = deltaText(item, unit);
  const ratio = denominatorText(item);
  const state = kpiState(item);
  const definition = String(item.definition || '');
  const label = item.label || item.id || 'Metric';
  // The tile itself stays number, unit and change. The definition and the real denominator
  // live in the title (hover) and in text only assistive technology reads.
  const detail = [definition, ratio].filter(Boolean).join(' · ');
  return `<li class="analytics-metric admin-kpi panel noise" data-kpi-id="${escapeHtml(item.id || 'metric')}" data-kpi-state="${state}"${detail ? ` title="${escapeHtml(detail)}"` : ''}><span class="t-micro g400 admin-kpi-label">${escapeHtml(label)}</span><span class="admin-kpi-main"><strong class="t-money g100 admin-kpi-value">${escapeHtml(value)}</strong>${unitLabel ? `<span class="t-micro ink-3 admin-kpi-unit">${escapeHtml(unitLabel)}</span>` : ''}</span>${delta ? `<span class="t-micro ink-2 admin-kpi-delta">${escapeHtml(delta)}</span>` : ''}${state !== 'none' ? `<span class="t-micro admin-kpi-flag">${STATE_WORDS[state]}</span>` : ''}${detail ? `<span class="sr-only">${escapeHtml(detail)}</span>` : ''}</li>`;
}

// Contract order first, anything else after, each in the order received.
export function orderedKpis(snapshot) {
  const items = Array.isArray(snapshot?.overview?.kpis) ? snapshot.overview.kpis : [];
  const rank = item => { const index = OVERVIEW_KPIS.findIndex(entry => entry.id === item.id); return index === -1 ? OVERVIEW_KPIS.length : index; };
  return items.map((item, position) => ({ item, position })).sort((a, b) => rank(a.item) - rank(b.item) || a.position - b.position).map(entry => entry.item).slice(0, OVERVIEW_KPIS.length);
}

export function kpiMarkup(snapshot) { return orderedKpis(snapshot).map(renderKpi).join(''); }

// The same tiles as export rows: value with its numerator and denominator.
export function kpiPoints(snapshot) {
  return orderedKpis(snapshot).map(item => {
    const unit = kpiUnit(item, String(item.id || '').toLowerCase());
    const value = finiteNumber(item.value);
    const point = { label: `KPI · ${item.label || item.id || 'Metric'}`, value, unit: isPercentUnit(unit) ? 'percent' : unit };
    const numerator = finiteNumber(item.numerator);
    const denominator = finiteNumber(item.denominator);
    if (numerator !== null) point.numerator = numerator;
    if (denominator !== null) point.denominator = denominator;
    return point;
  });
}
