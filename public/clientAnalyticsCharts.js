import { STANDARD_TILES, METRO_TILES } from './clientBoardData.js';
import { hydrateAnalyticsChart, disposeAnalyticsChart as disposeMountedChart } from './clientAnalyticsChartAdapter.js';

const CHART_ROLES = Object.freeze({
  primary: 'var(--analytics-primary)', comparison: 'var(--analytics-comparison)', human: 'var(--analytics-human)',
  ai: 'var(--analytics-ai)', bot: 'var(--analytics-bot)', positive: 'var(--analytics-positive)',
  negative: 'var(--analytics-negative)', warning: 'var(--analytics-warning)', neutral: 'var(--analytics-neutral)'
});
const CHART_COLORS = Object.freeze({ ...CHART_ROLES, line: CHART_ROLES.primary, bar: CHART_ROLES.primary, muted: CHART_ROLES.neutral });
const MODES = new Set(['line', 'bar', 'stacked-bar', 'heatmap', 'histogram', 'box', 'scatter', 'funnel', 'cohort', 'board']);
const MAX_POINTS = 168;
let chartSequence = 0;
const preferenceCleanups = new WeakMap();
const renderGenerations = new WeakMap();

function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
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

function stackedSegments(values) {
  const keys = [];
  values.forEach(point => Object.keys(point.values || {}).forEach(key => {
    if (Object.hasOwn(CHART_ROLES, key.toLowerCase()) && !keys.includes(key) && keys.length < 8) keys.push(key);
  }));
  if (!keys.length) keys.push('primary');
  return { keys, rows: values.map(point => ({
    label: point.label,
    unit: point.unit,
    sampleSize: point.sampleSize,
    numerator: point.numerator,
    denominator: point.denominator,
    values: keys.map(key => finite(point.values?.[key] ?? point.value))
  })) };
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

function metadataColumns(values) {
  return [
    ['sampleSize', 'Sample'],
    ['numerator', 'Numerator'],
    ['denominator', 'Denominator']
  ].filter(([field]) => values.some(point => point[field] !== null));
}

function tableMarkup(title, unit, values) {
  const metadata = metadataColumns(values);
  const columns = ['Label', 'Value', 'Unit', ...metadata.map(([, label]) => label)];
  return `<table class="analytics-chart-table"><caption>${escapeHtml(title)} data table</caption><thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${values.map(point => `<tr><th scope="row">${escapeHtml(point.label)}</th><td>${escapeHtml(point.value === null ? 'N/A' : formatValue(point.value, point.unit || unit))}</td><td>${escapeHtml(point.unit || unit)}</td>${metadata.map(([field]) => `<td>${escapeHtml(point[field] === null ? 'N/A' : formatNumber(point[field], 0))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function stackedTableMarkup(title, unit, segments) {
  const metadata = metadataColumns(segments.rows);
  const columns = ['Label', 'Unit', ...metadata.map(([, label]) => label), ...segments.keys];
  return `<table class="analytics-chart-table"><caption>${escapeHtml(title)} data table</caption><thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${segments.rows.map(row => `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(row.unit || unit)}</td>${metadata.map(([field]) => `<td>${escapeHtml(row[field] === null ? 'N/A' : formatNumber(row[field], 0))}</td>`).join('')}${row.values.map(value => `<td>${escapeHtml(value === null ? 'N/A' : formatValue(value, row.unit || unit))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function dataRegionMarkup(title, id, table, visible = false) {
  return `<div class="analytics-chart-data${visible ? '' : ' is-hidden'}" id="${escapeHtml(id)}" tabindex="0" role="region" aria-label="Scrollable data table for ${escapeHtml(title)}">${table}</div>`;
}

function setTableExpanded(region, button, expanded) {
  region?.classList?.toggle('is-hidden', !expanded);
  button?.setAttribute?.('aria-expanded', String(expanded));
  if (button) button.textContent = expanded ? 'HIDE DATA TABLE' : 'SHOW DATA TABLE';
}

function setFallback(container, message = 'CHART ENGINE UNAVAILABLE · DATA TABLE AVAILABLE') {
  const mount = container.querySelector?.('.analytics-chart-engine');
  if (mount?.dataset) { mount.dataset.chartEngine = 'unavailable'; mount.setAttribute?.('aria-hidden', 'true'); }
  const status = container.querySelector?.('.analytics-chart-engine-status');
  if (status) { status.textContent = message; status.classList?.remove('is-hidden'); }
  const button = container.querySelector?.('.analytics-chart-table-toggle');
  setTableExpanded(container.querySelector?.('.analytics-chart-data'), button, true);
}

function bindTableToggle(container) {
  const button = container.querySelector?.('.analytics-chart-table-toggle');
  const region = container.querySelector?.('.analytics-chart-data');
  let manuallyChanged = false;
  button?.addEventListener?.('click', () => {
    manuallyChanged = true;
    setTableExpanded(region, button, region?.classList?.contains('is-hidden'));
  });
  return () => manuallyChanged;
}

function hydrate(container, values, options) {
  const mount = container.querySelector?.('.analytics-chart-engine');
  if (!mount?.dataset || mediaMatches('(forced-colors: active)')) return;
  const generation = (renderGenerations.get(container) || 0) + 1;
  renderGenerations.set(container, generation);
  void hydrateAnalyticsChart(mount, values, options).then(result => {
    if (renderGenerations.get(container) !== generation || container.querySelector?.('.analytics-chart-engine') !== mount) { result?.dispose?.(); return; }
    if (mediaMatches('(forced-colors: active)')) { result?.dispose?.(); return; }
    if (result?.status === 'ready') mount.dataset.chartEngine = 'echarts-svg';
    else setFallback(container);
  }).catch(() => setFallback(container));
}

function bindForcedColors(container, values, options, supported, manuallyChanged) {
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
    const figure = container.querySelector?.('.analytics-chart');
    const mount = container.querySelector?.('.analytics-chart-engine');
    const region = container.querySelector?.('.analytics-chart-data');
    const button = container.querySelector?.('.analytics-chart-table-toggle');
    const status = container.querySelector?.('.analytics-chart-engine-status');
    figure?.setAttribute?.('data-forced-colors', forced ? 'active' : 'off');
    if (!supported) return;
    if (forced) {
      disposeMountedChart(mount);
      if (status) { status.textContent = 'FORCED COLORS · VERIFIED DATA TABLE'; status.classList?.remove('is-hidden'); }
      setTableExpanded(region, button, true);
      return;
    }
    status?.classList?.add('is-hidden');
    if (!manuallyChanged()) setTableExpanded(region, button, false);
    hydrate(container, values, options);
  };
  preferenceCleanups.set(container, listen(handler));
}

function preferredChartHeight(values, mode) {
  if (mode !== 'bar') return null;
  return Math.min(540, Math.max(240, 88 + values.length * 30));
}

export function disposeAnalyticsChart(target) {
  if (!target) return;
  const owner = target.matches?.('[data-analytics-chart]') ? target : target.closest?.('[data-analytics-chart]') || target;
  preferenceCleanups.get(owner)?.();
  preferenceCleanups.delete(owner);
  renderGenerations.set(owner, (renderGenerations.get(owner) || 0) + 1);
  const mount = target.matches?.('.analytics-chart-engine') ? target : owner.querySelector?.('.analytics-chart-engine');
  disposeMountedChart(mount);
}

function renderFigure(container, values, options, mode) {
  disposeAnalyticsChart(container);
  const title = options.title || 'Analytics series';
  const unit = options.unit || 'value';
  const forcedColors = mediaMatches('(forced-colors: active)');
  const unsupported = !MODES.has(mode);
  const height = preferredChartHeight(values, mode);
  const tableId = `analytics-chart-table-${++chartSequence}`;
  const summaryId = `${tableId}-summary`;
  const visible = unsupported || forcedColors;
  const labelledBy = container.getAttribute?.('aria-labelledby');
  const captionId = labelledBy && /^[A-Za-z][A-Za-z0-9_-]*$/.test(labelledBy) ? ` id="${escapeHtml(labelledBy)}"` : '';
  const units = [...new Set(values.map(point => point.unit || unit))];
  const summaryUnit = units.length > 1 ? 'MULTIPLE UNITS' : units[0] || unit;
  const engineStyle = height ? ` style="--analytics-chart-height:${height}px"` : '';
  const engine = unsupported ? '' : `<div class="analytics-chart-engine" data-chart-engine="echarts-svg" data-chart-token-primary="var(--analytics-primary)"${engineStyle} role="img" aria-label="${escapeHtml(`${title}; ${values.length} chart points`)}" aria-describedby="${escapeHtml(summaryId)}"></div><p class="t-micro ink-3 analytics-chart-engine-status${forcedColors ? '' : ' is-hidden'}" aria-live="polite">${forcedColors ? 'FORCED COLORS · VERIFIED DATA TABLE' : 'CHART ENGINE LOADING'}</p>`;
  const renderedTable = mode === 'stacked-bar' ? stackedTableMarkup(title, unit, stackedSegments(values)) : tableMarkup(title, unit, values);
  const dataRegion = dataRegionMarkup(title, tableId, renderedTable, visible);
  const chartOptions = { ...options, mode, title, unit };
  container.setAttribute?.('aria-label', title);
  container.innerHTML = `<figure class="analytics-chart" data-chart-mode="${escapeHtml(mode)}" data-forced-colors="${forcedColors ? 'active' : 'off'}"><figcaption${captionId}>${escapeHtml(title)}</figcaption>${engine}<p id="${escapeHtml(summaryId)}" class="t-micro ink-3 analytics-chart-summary">${escapeHtml(options.summary || 'VERIFIED SERIES')} · UNIT ${escapeHtml(summaryUnit)} · POINTS ${values.length}</p><button class="btn-dark analytics-chart-table-toggle" type="button" aria-expanded="${visible}" aria-controls="${escapeHtml(tableId)}">${visible ? 'HIDE DATA TABLE' : 'SHOW DATA TABLE'}</button>${dataRegion}</figure>`;
  const manuallyChanged = bindTableToggle(container);
  bindForcedColors(container, values, chartOptions, !unsupported, manuallyChanged);
  if (!unsupported && !forcedColors) hydrate(container, values, chartOptions);
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
  const table = dataRegionMarkup(title, tableId, tableMarkup(title, 'metric', points), forcedColors);
  container.setAttribute?.('aria-label', title);
  const status = forcedColors ? 'FORCED COLORS · VERIFIED DATA TABLE' : 'CHART ENGINE LOADING';
  container.innerHTML = `<figure class="analytics-chart analytics-board-map" data-forced-colors="${forcedColors ? 'active' : 'off'}"><figcaption>${escapeHtml(title)}</figcaption><div class="analytics-chart-engine" data-chart-engine="echarts-svg" data-chart-variant="${escapeHtml(variant)}" data-chart-token-primary="var(--analytics-primary)" role="img" aria-label="${escapeHtml(title)}" aria-describedby="${escapeHtml(summaryId)}"></div><p class="t-micro ink-3 analytics-chart-engine-status${forcedColors ? '' : ' is-hidden'}" aria-live="polite">${status}</p><p id="${escapeHtml(summaryId)}" class="t-micro ink-3 analytics-chart-summary">ASSOCIATION, NOT CAUSATION · POINTS ${tiles.length} · POPULATED ${tiles.filter(tile => tile.value !== null).length}</p><button class="btn-dark analytics-chart-table-toggle" type="button" aria-expanded="${forcedColors}" aria-controls="${escapeHtml(tableId)}">${forcedColors ? 'HIDE DATA TABLE' : 'SHOW DATA TABLE'}</button>${table}</figure>`;
  const chartOptions = { ...options, mode: 'board', title, unit: 'metric', variant };
  const manuallyChanged = bindTableToggle(container);
  bindForcedColors(container, points, chartOptions, true, manuallyChanged);
  if (!forcedColors) hydrate(container, points, chartOptions);
  return { tiles, element: container.firstElementChild };
}

export { CHART_COLORS, CHART_ROLES, MAX_POINTS };
