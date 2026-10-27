import { STANDARD_TILES, METRO_TILES } from './clientBoardData.js';
import { mountChart, disposeChart } from './clientChartMount.js';
import { finite, formatValue } from './clientChartMath.js';
import { normalizeChartSpec, preferredChartHeight } from './clientChartRender.js';

const CHART_ROLES = Object.freeze({
  primary: 'var(--analytics-primary)', comparison: 'var(--analytics-comparison)', human: 'var(--analytics-human)',
  ai: 'var(--analytics-ai)', bot: 'var(--analytics-bot)', positive: 'var(--analytics-positive)',
  negative: 'var(--analytics-negative)', warning: 'var(--analytics-warning)', neutral: 'var(--analytics-neutral)'
});
const CHART_COLORS = Object.freeze({ ...CHART_ROLES, line: CHART_ROLES.primary, bar: CHART_ROLES.primary, muted: CHART_ROLES.neutral });
// Line, area and bar draw; every other mode is a verified data table only.
const MODES = new Set(['line', 'area', 'bar']);
const MAX_POINTS = 168;
let chartSequence = 0;
const preferenceCleanups = new WeakMap();

function optionalFinite(value) { return value === null || value === undefined || value === '' ? null : finite(value); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function mediaMatches(query) { const media = globalThis.matchMedia || globalThis.window?.matchMedia; return typeof media === 'function' && media.call(globalThis, query)?.matches === true; }

function cleanPoints(series) {
  if (!Array.isArray(series)) return [];
  return series.slice(0, MAX_POINTS).map((point, index) => {
    const source = point && typeof point === 'object' ? point : { value: point };
    const values = source.values && typeof source.values === 'object' && !Array.isArray(source.values) ? source.values : null;
    return {
      label: typeof source.label === 'string' ? source.label.slice(0, 80) : String(index + 1),
      value: finite(source.value ?? source.y), values,
      series: typeof source.series === 'string' ? source.series.slice(0, 40) : '',
      unit: typeof source.unit === 'string' ? source.unit.slice(0, 24) : '',
      sampleSize: optionalFinite(source.sampleSize),
      numerator: optionalFinite(source.numerator),
      denominator: optionalFinite(source.denominator)
    };
  }).filter(point => point.value !== null || point.values);
}

function formatNumber(value, maximumFractionDigits = 1) {
  const number = finite(value);
  return number === null ? 'N/A' : number.toLocaleString(undefined, { maximumFractionDigits });
}

function metadataColumns(values) {
  return [
    ['sampleSize', 'Sample'],
    ['numerator', 'Numerator'],
    ['denominator', 'Denominator']
  ].filter(([field]) => values.some(point => point[field] !== null));
}

// One unit across the table moves into the Value header; mixed units keep their own column.
function tableMarkup(title, unit, values) {
  const metadata = metadataColumns(values);
  const units = [...new Set(values.map(point => point.unit || unit))];
  const single = units.length === 1;
  const columns = single ? ['Label', `Value (${units[0]})`] : ['Label', 'Value', 'Unit'];
  const header = [...columns, ...metadata.map(([, label]) => label)];
  const rows = values.map(point => {
    const value = point.value === null ? 'N/A' : formatValue(point.value, point.unit || unit);
    const unitCell = single ? '' : `<td>${escapeHtml(point.unit || unit)}</td>`;
    const extra = metadata.map(([field]) => `<td>${escapeHtml(point[field] === null ? 'N/A' : formatNumber(point[field], 0))}</td>`).join('');
    return `<tr><th scope="row">${escapeHtml(point.label)}</th><td>${escapeHtml(value)}</td>${unitCell}${extra}</tr>`;
  }).join('');
  return `<table class="analytics-chart-table"><caption>${escapeHtml(title)} data table</caption><thead><tr>${header.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

// The verified table is part of every chart. It is read out to assistive technology but not drawn
// beside the chart (the chart is the picture); a mode with no drawing shows its table instead.
function dataRegionMarkup(title, id, table, visible = false) {
  if (!visible) return `<div class="analytics-chart-data sr-only" id="${escapeHtml(id)}">${table}</div>`;
  return `<div class="analytics-chart-data" data-scroll-cue data-overflow="false" id="${escapeHtml(id)}" tabindex="0" role="region" aria-label="Scrollable data table for ${escapeHtml(title)}">${table}</div>`;
}

// Forced-colors users keep the drawn chart in system colours; the data table is always
// on screen beside it, so the preference only updates the figure's marker attribute.
function bindForcedColors(container) {
  const mediaFactory = globalThis.matchMedia || globalThis.window?.matchMedia;
  if (typeof mediaFactory !== 'function') return;
  const media = mediaFactory.call(globalThis, '(forced-colors: active)');
  const listen = typeof media?.addEventListener === 'function'
    ? handler => { media.addEventListener('change', handler); return () => media.removeEventListener?.('change', handler); }
    : typeof media?.addListener === 'function'
      ? handler => { media.addListener(handler); return () => media.removeListener?.(handler); }
      : null;
  if (!listen) return;
  const handler = event => {
    const forced = event?.matches ?? media.matches;
    container.querySelector?.('.analytics-chart')?.setAttribute?.('data-forced-colors', forced ? 'active' : 'off');
  };
  preferenceCleanups.set(container, listen(handler));
}

// Values measured in different units never share an axis: one small chart per unit.
function chartGroups(values, mode, options) {
  const groups = new Map();
  values.forEach(point => {
    const unit = point.unit || options.unit || 'value';
    if (!groups.has(unit)) groups.set(unit, []);
    groups.get(unit).push(point);
  });
  return [...groups].map(([unit, points]) => {
    const keys = [...new Set(points.flatMap(point => (point.values ? Object.keys(point.values) : [])))].slice(0, 6);
    const series = keys.length
      ? keys.map(key => ({ id: key, name: key, values: points.map(point => finite(point.values?.[key])) }))
      : [{ id: 'value', name: options.seriesName || 'Verified', values: points.map(point => point.value) }];
    return { unit, input: { kind: mode, unit, labels: points.map(point => point.label), series } };
  });
}

export function disposeAnalyticsChart(target) {
  if (!target) return;
  const owner = target.matches?.('[data-analytics-chart]') ? target : target.closest?.('[data-analytics-chart]') || target;
  preferenceCleanups.get(owner)?.();
  preferenceCleanups.delete(owner);
  if (target.matches?.('.analytics-chart-engine')) disposeChart(target);
  owner.querySelectorAll?.('.analytics-chart-engine').forEach(disposeChart);
}

// Each unit's chart shares the height in proportion to its categories, so a three-bar chart is not
// stretched as tall as a seven-bar one.
function engineMarkup(groups, mode) {
  return groups.map((group, index) => {
    const height = preferredChartHeight(normalizeChartSpec({ ...group.input, kind: mode }));
    const weight = Math.max(1, group.input.labels.length);
    const style = ` style="--analytics-chart-weight:${weight}${height === 240 ? '' : `;--analytics-chart-height:${height}px`}"`;
    const caption = groups.length > 1 ? `<p class="t-micro ink-3 analytics-chart-group">UNIT ${escapeHtml(group.unit)}</p>` : '';
    return `${caption}<div class="analytics-chart-engine" data-chart-group="${index}"${style}></div>`;
  }).join('');
}

function renderFigure(container, values, options, mode) {
  disposeAnalyticsChart(container);
  const title = options.title || 'Analytics series';
  const unit = options.unit || 'value';
  const forcedColors = mediaMatches('(forced-colors: active)');
  const unsupported = !MODES.has(mode);
  const tableId = `analytics-chart-table-${++chartSequence}`;
  const summaryId = `${tableId}-summary`;
  const labelledBy = container.getAttribute?.('aria-labelledby');
  const captionId = labelledBy && /^[A-Za-z][A-Za-z0-9_-]*$/.test(labelledBy) ? ` id="${escapeHtml(labelledBy)}"` : '';
  const units = [...new Set(values.map(point => point.unit || unit))];
  const summaryUnit = units.length > 1 ? 'MULTIPLE UNITS' : units[0] || unit;
  const groups = unsupported ? [] : chartGroups(values, mode, options);
  container.setAttribute?.('aria-label', title);
  const plot = `<div class="analytics-chart-plot">${engineMarkup(groups, mode)}<p id="${escapeHtml(summaryId)}" class="sr-only analytics-chart-summary">${escapeHtml(options.summary || 'VERIFIED SERIES')} · UNIT ${escapeHtml(summaryUnit)} · POINTS ${values.length}</p></div>`;
  container.innerHTML = `<figure class="analytics-chart" data-chart-mode="${escapeHtml(mode)}" data-forced-colors="${forcedColors ? 'active' : 'off'}"><figcaption${captionId}>${escapeHtml(title)}</figcaption><div class="analytics-chart-split">${plot}${dataRegionMarkup(title, tableId, tableMarkup(title, unit, values), unsupported)}</div></figure>`;
  container.querySelectorAll?.('.analytics-chart-engine').forEach((engine, index) => {
    const label = groups.length > 1 ? `${title}, ${groups[index].unit}` : title;
    mountChart(engine, { ...groups[index].input, title: label }, { label, describedBy: summaryId });
  });
  bindForcedColors(container);
  return container.firstElementChild;
}

export function renderAnalyticsChart(container, series, options = {}) {
  const mode = String(options.mode || 'line').toLowerCase();
  if (mode === 'board') return renderBoardMetricMap(container, options.board || series, options);
  const values = cleanPoints(series);
  if (!container || typeof document === 'undefined') return { values, table: true };
  return renderFigure(container, values, options, mode);
}

export function renderBoardMetricMap(container, board, options = {}) {
  if (container) disposeAnalyticsChart(container);
  const variant = String(board?.variant || options.variant || 'standard-40').toLowerCase();
  const topology = variant === 'metro-52' ? METRO_TILES : STANDARD_TILES;
  const input = Array.isArray(board?.tiles) ? board.tiles : Array.isArray(board) ? board : topology;
  const tiles = topology.map((tile, index) => {
    const explicit = input.find?.(entry => entry && (entry.index === index || entry.i === index));
    const candidate = explicit || input[index] || {};
    return {
      index,
      label: String(candidate.label ?? candidate.name ?? tile.name).slice(0, 80),
      value: finite(candidate.value ?? candidate.metric ?? board?.metrics?.[index]),
      unit: typeof candidate.unit === 'string' ? candidate.unit.slice(0, 24) : 'metric',
      sampleSize: optionalFinite(candidate.sampleSize),
      numerator: optionalFinite(candidate.numerator),
      denominator: optionalFinite(candidate.denominator)
    };
  });
  if (!container || typeof document === 'undefined') return { tiles, table: true };
  const title = options.title || `${variant.toUpperCase()} board metric`;
  const points = tiles.map(tile => ({ label: `${tile.index} · ${tile.label}`, value: tile.value, unit: tile.unit, sampleSize: tile.sampleSize, numerator: tile.numerator, denominator: tile.denominator }));
  const tableId = `analytics-chart-table-${++chartSequence}`;
  const summaryId = `${tableId}-summary`;
  const forcedColors = mediaMatches('(forced-colors: active)');
  const table = dataRegionMarkup(title, tableId, tableMarkup(title, 'metric', points), true);
  container.setAttribute?.('aria-label', title);
  container.innerHTML = `<figure class="analytics-chart analytics-board-map" data-forced-colors="${forcedColors ? 'active' : 'off'}"><figcaption>${escapeHtml(title)}</figcaption><p id="${escapeHtml(summaryId)}" class="t-micro ink-3 analytics-chart-summary">ASSOCIATION, NOT CAUSATION · POINTS ${tiles.length} · POPULATED ${tiles.filter(tile => tile.value !== null).length}</p>${table}</figure>`;
  return { tiles, element: container.firstElementChild };
}

export { CHART_COLORS, CHART_ROLES, MAX_POINTS };
