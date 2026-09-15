import { STANDARD_TILES, METRO_TILES } from './clientBoardData.js';
import { hydrateAnalyticsChart, disposeAnalyticsChart } from './clientAnalyticsChartAdapter.js';

const CHART_ROLES = Object.freeze({
  primary: 'var(--analytics-primary)', comparison: 'var(--analytics-comparison)', human: 'var(--analytics-human)',
  ai: 'var(--analytics-ai)', bot: 'var(--analytics-bot)', positive: 'var(--analytics-positive)',
  negative: 'var(--analytics-negative)', warning: 'var(--analytics-warning)', neutral: 'var(--analytics-neutral)'
});
const CHART_COLORS = Object.freeze({ ...CHART_ROLES, line: CHART_ROLES.primary, bar: CHART_ROLES.primary, muted: CHART_ROLES.neutral });
const MODES = new Set(['line', 'bar', 'stacked-bar', 'heatmap', 'histogram', 'box', 'scatter', 'funnel', 'cohort', 'board']);
const MAX_POINTS = 168;
let chartSequence = 0;

function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
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
      unit: typeof source.unit === 'string' ? source.unit.slice(0, 24) : ''
    };
  }).filter(point => point.value !== null || point.values);
}

function stackedSegments(values) {
  const keys = [];
  values.forEach(point => Object.keys(point.values || {}).forEach(key => {
    if (Object.hasOwn(CHART_ROLES, key.toLowerCase()) && !keys.includes(key) && keys.length < 8) keys.push(key);
  }));
  if (!keys.length) keys.push('primary');
  return { keys, rows: values.map(point => ({ label: point.label, values: keys.map(key => finite(point.values?.[key] ?? point.value)) })) };
}

function formatNumber(value, maximumFractionDigits = 1) {
  const number = finite(value);
  return number === null ? 'N/A' : number.toLocaleString(undefined, { maximumFractionDigits });
}

function formatValue(value, unit) {
  const number = finite(value);
  if (number === null) return 'N/A';
  const normalized = String(unit || '').toLowerCase();
  if (normalized === 'percent' || normalized === 'adoption' || normalized.endsWith('rate')) return `${formatNumber(Math.abs(number) <= 1 ? number * 100 : number, 1)}%`;
  if (normalized === 'seconds') return formatNumber(number, 2);
  if (normalized === 'milliseconds') return formatNumber(number, 0);
  return formatNumber(number, 2);
}

function tableMarkup(title, unit, values, tableId, visible = false, columns = ['Label', unit]) {
  return `<table class="analytics-chart-table${visible ? '' : ' is-hidden'}" id="${escapeHtml(tableId)}"><caption>${escapeHtml(title)} data table</caption><thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${values.map(point => `<tr><th scope="row">${escapeHtml(point.label)}</th><td>${escapeHtml(point.value === null ? 'N/A' : formatValue(point.value, point.unit || unit))}</td></tr>`).join('')}</tbody></table>`;
}

function stackedTableMarkup(title, segments, tableId, visible = false) {
  return `<table class="analytics-chart-table${visible ? '' : ' is-hidden'}" id="${escapeHtml(tableId)}"><caption>${escapeHtml(title)} data table</caption><thead><tr><th scope="col">Label</th>${segments.keys.map(key => `<th scope="col">${escapeHtml(key)}</th>`).join('')}</tr></thead><tbody>${segments.rows.map(row => `<tr><th scope="row">${escapeHtml(row.label)}</th>${row.values.map(value => `<td>${escapeHtml(value === null ? 'N/A' : value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function setFallback(container, message = 'CHART ENGINE UNAVAILABLE · DATA TABLE AVAILABLE') {
  const mount = container.querySelector?.('.analytics-chart-engine');
  if (mount?.dataset) { mount.dataset.chartEngine = 'unavailable'; mount.setAttribute?.('aria-hidden', 'true'); }
  const status = container.querySelector?.('.analytics-chart-engine-status');
  if (status) { status.textContent = message; status.classList?.remove('is-hidden'); }
  const button = container.querySelector?.('.analytics-chart-table-toggle');
  const table = container.querySelector?.('.analytics-chart-table');
  table?.classList?.remove('is-hidden');
  button?.setAttribute?.('aria-expanded', 'true');
  if (button) button.textContent = 'HIDE DATA TABLE';
}

function bindTableToggle(container) {
  const button = container.querySelector?.('.analytics-chart-table-toggle');
  const table = container.querySelector?.('.analytics-chart-table');
  button?.addEventListener?.('click', () => {
    table?.classList.toggle('is-hidden');
    const expanded = !table?.classList.contains('is-hidden');
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'HIDE DATA TABLE' : 'SHOW DATA TABLE';
  });
}

function hydrate(container, values, options) {
  const mount = container.querySelector?.('.analytics-chart-engine');
  if (!mount?.dataset || mediaMatches('(forced-colors: active)')) return;
  void hydrateAnalyticsChart(mount, values, options).then(result => {
    if (result?.status === 'ready') mount.dataset.chartEngine = 'echarts-svg';
    else setFallback(container);
  }).catch(() => setFallback(container));
}

function renderFigure(container, values, options, mode) {
  const title = options.title || 'Analytics series';
  const unit = options.unit || 'value';
  const forcedColors = mediaMatches('(forced-colors: active)');
  const unsupported = !MODES.has(mode) || forcedColors;
  const tableId = `analytics-chart-table-${++chartSequence}`;
  const summaryId = `${tableId}-summary`;
  const visible = unsupported;
  const labelledBy = container.getAttribute?.('aria-labelledby');
  const captionId = labelledBy && /^[A-Za-z][A-Za-z0-9_-]*$/.test(labelledBy) ? ` id="${escapeHtml(labelledBy)}"` : '';
  const units = [...new Set(values.map(point => point.unit || unit))];
  const columns = units.length > 1 ? ['Label', 'Value'] : ['Label', unit];
  const summaryUnit = units.length > 1 ? 'SEPARATE SCALES' : unit;
  const engine = unsupported ? '' : `<div class="analytics-chart-engine" data-chart-engine="echarts-svg" data-chart-token-primary="var(--analytics-primary)" role="img" aria-label="${escapeHtml(`${title}; ${values.length} observations`)}" aria-describedby="${escapeHtml(summaryId)}"></div><p class="t-micro ink-3 analytics-chart-engine-status is-hidden" aria-live="polite">CHART ENGINE LOADING</p>`;
  const renderedTable = mode === 'stacked-bar' ? stackedTableMarkup(title, stackedSegments(values), tableId, visible) : tableMarkup(title, unit, values, tableId, visible, columns);
  container.setAttribute?.('aria-label', title);
  container.innerHTML = `<figure class="analytics-chart" data-chart-mode="${escapeHtml(mode)}" data-forced-colors="${forcedColors ? 'active' : 'off'}"><figcaption${captionId}>${escapeHtml(title)}</figcaption>${engine}<p id="${escapeHtml(summaryId)}" class="t-micro ink-3 analytics-chart-summary">${escapeHtml(options.summary || `${values.length} verified observations`)} · UNIT ${escapeHtml(summaryUnit)} · SAMPLE ${values.length}</p><button class="btn-dark analytics-chart-table-toggle" type="button" aria-expanded="${visible}" aria-controls="${escapeHtml(tableId)}">${visible ? 'HIDE DATA TABLE' : 'SHOW DATA TABLE'}</button>${renderedTable}</figure>`;
  bindTableToggle(container);
  if (!unsupported) hydrate(container, values, { ...options, mode, title, unit });
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
  const variant = String(board?.variant || options.variant || 'standard-40').toLowerCase();
  const topology = variant === 'metro-52' ? METRO_TILES : STANDARD_TILES;
  const input = Array.isArray(board?.tiles) ? board.tiles : Array.isArray(board) ? board : topology;
  const tiles = topology.map((tile, index) => {
    const explicit = input.find?.(entry => entry && (entry.index === index || entry.i === index));
    const candidate = explicit || input[index] || {};
    return { index, label: String(candidate.label ?? candidate.name ?? tile.name).slice(0, 80), value: finite(candidate.value ?? candidate.metric ?? board?.metrics?.[index]) };
  });
  if (!container || typeof document === 'undefined') return { tiles, table: true };
  const title = options.title || `${variant.toUpperCase()} board metric`;
  const points = tiles.map(tile => ({ label: `${tile.index} · ${tile.label}`, value: tile.value, unit: 'metric' }));
  const tableId = `analytics-chart-table-${++chartSequence}`;
  const summaryId = `${tableId}-summary`;
  const forcedColors = mediaMatches('(forced-colors: active)');
  const table = tableMarkup(title, 'Metric', points, tableId, forcedColors);
  container.setAttribute?.('aria-label', title);
  container.innerHTML = `<figure class="analytics-chart analytics-board-map" data-forced-colors="${forcedColors ? 'active' : 'off'}"><figcaption>${escapeHtml(title)}</figcaption><div class="analytics-chart-engine" data-chart-engine="echarts-svg" data-chart-variant="${escapeHtml(variant)}" data-chart-token-primary="var(--analytics-primary)" role="img" aria-label="${escapeHtml(title)}" aria-describedby="${escapeHtml(summaryId)}"></div><p class="t-micro ink-3 analytics-chart-engine-status is-hidden" aria-live="polite">CHART ENGINE LOADING</p><p id="${escapeHtml(summaryId)}" class="t-micro ink-3 analytics-chart-summary">ASSOCIATION, NOT CAUSATION · SAMPLE ${tiles.filter(tile => tile.value !== null).length}</p><button class="btn-dark analytics-chart-table-toggle" type="button" aria-expanded="${forcedColors}" aria-controls="${escapeHtml(tableId)}">${forcedColors ? 'HIDE DATA TABLE' : 'SHOW DATA TABLE'}</button>${table}</figure>`;
  bindTableToggle(container);
  if (!forcedColors) hydrate(container, points, { ...options, mode: 'board', title, unit: 'metric', variant });
  return { tiles, element: container.firstElementChild };
}

export { CHART_COLORS, CHART_ROLES, MAX_POINTS, disposeAnalyticsChart };
