import { STANDARD_TILES, METRO_TILES } from './clientBoardData.js';

const CHART_ROLES = Object.freeze({
  primary: 'var(--analytics-primary)',
  comparison: 'var(--analytics-comparison)',
  human: 'var(--analytics-human)',
  ai: 'var(--analytics-ai)',
  bot: 'var(--analytics-bot)',
  positive: 'var(--analytics-positive)',
  negative: 'var(--analytics-negative)',
  warning: 'var(--analytics-warning)',
  neutral: 'var(--analytics-neutral)'
});

const CHART_COLORS = Object.freeze({
  ...CHART_ROLES,
  line: CHART_ROLES.primary,
  bar: CHART_ROLES.primary,
  muted: CHART_ROLES.neutral
});

const MODES = new Set(['line', 'bar', 'stacked-bar', 'heatmap', 'histogram', 'box', 'scatter', 'funnel', 'cohort', 'board']);
const MAX_POINTS = 168;
const SVG_WIDTH = 640;
const SVG_HEIGHT = 260;
const PLOT = Object.freeze({ left: 92, right: 22, top: 34, bottom: 48 });
const ROLE_ORDER = Object.freeze(['primary', 'comparison', 'human', 'ai', 'bot', 'positive', 'negative', 'warning', 'neutral']);
let chartSequence = 0;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function mediaMatches(query) {
  const media = globalThis.matchMedia || globalThis.window?.matchMedia;
  return typeof media === 'function' && media.call(globalThis, query)?.matches === true;
}

function cleanPoints(series) {
  if (!Array.isArray(series)) return [];
  return series.slice(0, MAX_POINTS).map((point, index) => {
    const source = point && typeof point === 'object' ? point : { value: point };
    const values = source.values && typeof source.values === 'object' && !Array.isArray(source.values) ? source.values : null;
    return {
      label: typeof source.label === 'string' ? source.label.slice(0, 80) : String(index + 1),
      value: finite(source.value ?? source.y),
      values,
      series: typeof source.series === 'string' ? source.series.slice(0, 40) : '',
      unit: typeof source.unit === 'string' ? source.unit.slice(0, 24) : ''
    };
  }).filter(point => point.value !== null || point.values);
}

function valueNumbers(values) {
  return values.flatMap(point => {
    const direct = point.value === null ? [] : [point.value];
    const nested = Object.values(point.values || {}).map(finite).filter(value => value !== null);
    return direct.concat(nested);
  });
}

function chartDomain(values, includeZero = true) {
  const numbers = valueNumbers(values);
  if (!numbers.length) return { min: 0, max: 1, span: 1 };
  let min = Math.min(...numbers);
  let max = Math.max(...numbers);
  if (includeZero) { min = Math.min(0, min); max = Math.max(0, max); }
  if (min === max) {
    if (min === 0) max = 1;
    else { const padding = Math.max(1, Math.abs(min) * 0.15); min -= padding; max += padding; }
  }
  return { min, max, span: Math.max(1, max - min) };
}

function ticks(domain, count = 4) {
  return Array.from({ length: count + 1 }, (_, index) => domain.min + (domain.span * index / count));
}

function formatNumber(value, maximumFractionDigits = 1) {
  const number = finite(value);
  if (number === null) return 'N/A';
  return number.toLocaleString(undefined, { maximumFractionDigits });
}

function formatValue(value, unit, axis = false) {
  const number = finite(value);
  if (number === null) return 'N/A';
  const normalizedUnit = String(unit || '').toLowerCase();
  if (normalizedUnit === 'percent' || normalizedUnit === 'adoption' || normalizedUnit.endsWith('rate')) {
    const percent = Math.abs(number) <= 1 ? number * 100 : number;
    return `${formatNumber(percent, 1)}%`;
  }
  if (normalizedUnit === 'seconds') return formatNumber(number, axis ? 1 : 2);
  if (normalizedUnit === 'milliseconds') return formatNumber(number, 0);
  return formatNumber(number, axis ? 1 : 2);
}

function normalizedSeries(values) {
  const groups = new Map();
  values.forEach(point => {
    const name = point.series.trim() || 'verified';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(point);
  });
  return [...groups.entries()].map(([name, points]) => ({ name, points }));
}

function colorFor(name, index = 0) {
  const normalized = String(name || '').toLowerCase();
  if (Object.hasOwn(CHART_ROLES, normalized)) return CHART_ROLES[normalized];
  return CHART_ROLES[ROLE_ORDER[index % ROLE_ORDER.length]];
}

function colorRole(name, index = 0) {
  const normalized = String(name || '').toLowerCase();
  return Object.hasOwn(CHART_ROLES, normalized) ? normalized : ROLE_ORDER[index % ROLE_ORDER.length];
}

function safeNumber(value) {
  const number = finite(value);
  return number === null ? 0 : number;
}

function truncateLabel(value, max = 20) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function tableMarkup(title, unit, values, tableId, visible = false, columns = ['Label', unit]) {
  return `<table class="analytics-chart-table${visible ? '' : ' is-hidden'}" id="${escapeHtml(tableId)}"><caption>${escapeHtml(title)} data table</caption><thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${values.map(point => `<tr><th scope="row">${escapeHtml(point.label)}</th><td>${escapeHtml(point.value === null ? 'N/A' : formatValue(point.value, point.unit || unit))}</td></tr>`).join('')}</tbody></table>`;
}

function stackedSegments(values) {
  const keys = [];
  values.forEach(point => Object.keys(point.values || {}).forEach(key => {
    const normalized = key.toLowerCase();
    if (Object.hasOwn(CHART_ROLES, normalized) && !keys.includes(key) && keys.length < 8) keys.push(key);
  }));
  if (!keys.length) keys.push('primary');
  return {
    keys,
    rows: values.map(point => ({ label: point.label, values: keys.map(key => finite(point.values?.[key] ?? point.value)) }))
  };
}

function stackedTableMarkup(title, segments, tableId, visible = false) {
  return `<table class="analytics-chart-table${visible ? '' : ' is-hidden'}" id="${escapeHtml(tableId)}"><caption>${escapeHtml(title)} data table</caption><thead><tr><th scope="col">Label</th>${segments.keys.map(key => `<th scope="col">${escapeHtml(key)}</th>`).join('')}</tr></thead><tbody>${segments.rows.map(row => `<tr><th scope="row">${escapeHtml(row.label)}</th>${row.values.map(value => `<td>${escapeHtml(value === null ? 'N/A' : value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function xPosition(index, count) {
  if (count <= 1) return PLOT.left + ((SVG_WIDTH - PLOT.left - PLOT.right) / 2);
  return PLOT.left + ((SVG_WIDTH - PLOT.left - PLOT.right) * index / (count - 1));
}

function yPosition(value, domain) {
  const number = finite(value);
  if (number === null) return null;
  const plotted = PLOT.top + (SVG_HEIGHT - PLOT.top - PLOT.bottom) * (1 - ((number - domain.min) / domain.span));
  return Math.round(Math.max(PLOT.top, Math.min(SVG_HEIGHT - PLOT.bottom, plotted)));
}

function frameMarkup(values, unit, domain, { labels = values.map(point => point.label), horizontal = false, title = '' } = {}) {
  const plotRight = SVG_WIDTH - PLOT.right;
  const plotBottom = SVG_HEIGHT - PLOT.bottom;
  const verticalTicks = ticks(domain);
  const labelIndexes = labels.length <= 6
    ? labels.map((_, index) => index)
    : [...new Set([0, Math.floor((labels.length - 1) / 3), Math.floor((labels.length - 1) * 2 / 3), labels.length - 1])];
  const grid = horizontal
    ? verticalTicks.map(value => {
      const x = PLOT.left + ((value - domain.min) / domain.span) * (plotRight - PLOT.left);
      return `<line class="analytics-chart-grid-line" x1="${Math.round(x)}" y1="${PLOT.top}" x2="${Math.round(x)}" y2="${plotBottom}"></line>`;
    }).join('')
    : verticalTicks.map(value => {
      const y = yPosition(value, domain);
      return `<line class="analytics-chart-grid-line" x1="${PLOT.left}" y1="${y}" x2="${plotRight}" y2="${y}"></line>`;
    }).join('');
  const yLabels = horizontal
    ? verticalTicks.map(value => {
      const x = PLOT.left + ((value - domain.min) / domain.span) * (plotRight - PLOT.left);
      return `<text x="${Math.round(x)}" y="${plotBottom + 22}" text-anchor="middle">${escapeHtml(formatValue(value, unit, true))}</text>`;
    }).join('')
    : verticalTicks.map(value => `<text x="${PLOT.left - 10}" y="${yPosition(value, domain) + 4}" text-anchor="end">${escapeHtml(formatValue(value, unit, true))}</text>`).join('');
  const xLabels = horizontal ? '' : labelIndexes.map(index => {
    const x = xPosition(index, labels.length);
    return `<text class="analytics-chart-x-label" x="${Math.round(x)}" y="${plotBottom + 22}" text-anchor="middle">${escapeHtml(truncateLabel(labels[index], 16))}</text>`;
  }).join('');
  const axisUnit = `<text class="analytics-chart-unit" x="${plotRight}" y="${SVG_HEIGHT - 8}" text-anchor="end">${escapeHtml(String(unit || 'VALUE').toUpperCase())}</text>`;
  return `<rect class="analytics-chart-frame" x="${PLOT.left}" y="${PLOT.top}" width="${plotRight - PLOT.left}" height="${plotBottom - PLOT.top}"></rect><g class="analytics-chart-grid" aria-hidden="true">${grid}</g><g class="analytics-chart-axis" aria-label="${escapeHtml(title || `${unit} axis`)}">${yLabels}${xLabels}${axisUnit}<line class="analytics-chart-baseline" x1="${PLOT.left}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}"></line></g>`;
}

function legendMarkup(entries) {
  const visible = entries.filter(Boolean);
  if (!visible.length) return '';
  const items = visible.map((entry, index) => {
    const x = PLOT.left + (index % 3) * 150;
    const y = 18 + Math.floor(index / 3) * 14;
    return `<g class="analytics-chart-legend-item"><rect x="${x}" y="${y - 8}" width="8" height="8" fill="${colorFor(entry.name, index)}"></rect><text x="${x + 14}" y="${y - 1}">${escapeHtml(truncateLabel(entry.label || entry.name, 18))}</text></g>`;
  }).join('');
  return `<g class="analytics-chart-legend" aria-label="Chart legend">${items}</g>`;
}

function linePath(points, values, domain, baseline = false) {
  const plotted = points.map(point => ({ point, value: point.value === null ? null : yPosition(point.value, domain) })).filter(item => item.value !== null);
  if (!plotted.length) return '';
  const path = plotted.map((item, index) => `${index ? 'L' : 'M'} ${Math.round(xPosition(values.indexOf(item.point), values.length))} ${item.value}`).join(' ');
  if (!baseline) return path;
  const firstX = Math.round(xPosition(values.indexOf(plotted[0].point), values.length));
  const lastX = Math.round(xPosition(values.indexOf(plotted.at(-1).point), values.length));
  const bottom = SVG_HEIGHT - PLOT.bottom;
  return `M ${firstX} ${bottom} L ${plotted.map((item, index) => `${index ? 'L' : ''} ${Math.round(xPosition(values.indexOf(item.point), values.length))} ${item.value}`).join(' ')} L ${lastX} ${bottom} Z`;
}

function renderLineGeometry(values, unit, title) {
  const domain = chartDomain(values);
  const groups = normalizedSeries(values);
  const labels = values.map(point => point.label);
  const frame = frameMarkup(values, unit, domain, { labels, title });
  const paths = groups.map((group, groupIndex) => {
    const role = colorRole(group.name, groupIndex);
    const area = linePath(group.points, values, domain, true);
    const line = linePath(group.points, values, domain);
    const markers = group.points.map(point => {
      if (point.value === null) return '';
      const x = Math.round(xPosition(values.indexOf(point), values.length));
      const y = yPosition(point.value, domain);
      return `<rect class="analytics-chart-point" x="${x - 3}" y="${y - 3}" width="6" height="6" data-chart-point="${escapeHtml(point.label)}" data-chart-value="${escapeHtml(point.value)}" fill="${colorFor(group.name, groupIndex)}"><title>${escapeHtml(`${group.name} · ${point.label} · ${formatValue(point.value, unit)}`)}</title></rect>`;
    }).join('');
    return `${area ? `<path class="analytics-chart-area" d="${area}" fill="${colorFor(group.name, groupIndex)}" fill-opacity="0.14"></path>` : ''}${line ? `<path class="analytics-chart-line ${role}" d="${line}" fill="none" stroke="${colorFor(group.name, groupIndex)}" stroke-width="2" vector-effect="non-scaling-stroke"></path>` : ''}${markers}`;
  }).join('');
  const legend = legendMarkup(groups.map(group => ({ name: group.name, label: group.name === 'verified' ? 'Verified activity' : group.name })));
  return `${frame}${legend}${paths}`;
}

function groupBarValues(values, unit) {
  const groups = new Map();
  values.forEach(point => {
    const groupUnit = point.unit || unit || 'value';
    if (!groups.has(groupUnit)) groups.set(groupUnit, []);
    groups.get(groupUnit).push(point);
  });
  return [...groups.entries()];
}

function renderBarGroup(points, groupUnit, groupIndex, groupCount, title) {
  const plotRight = SVG_WIDTH - PLOT.right;
  const plotBottom = SVG_HEIGHT - PLOT.bottom;
  const groupHeight = (plotBottom - PLOT.top) / Math.max(1, groupCount);
  const groupTop = PLOT.top + groupIndex * groupHeight;
  const headingHeight = groupCount > 1 ? 15 : 5;
  const groupPlotTop = groupTop + headingHeight;
  const groupPlotBottom = Math.min(plotBottom, groupTop + groupHeight - 6);
  const rowHeight = Math.max(12, Math.floor((groupPlotBottom - groupPlotTop) / Math.max(1, points.length)));
  const domain = chartDomain(points);
  const barDomain = { ...domain, min: Math.min(0, domain.min), max: Math.max(1, domain.max), span: Math.max(1, Math.max(1, domain.max) - Math.min(0, domain.min)) };
  const ticksMarkup = ticks(barDomain).map(value => {
    const x = PLOT.left + ((value - barDomain.min) / barDomain.span) * (plotRight - PLOT.left);
    return `<line class="analytics-chart-grid-line" x1="${Math.round(x)}" y1="${Math.round(groupPlotTop)}" x2="${Math.round(x)}" y2="${Math.round(groupPlotBottom)}"></line>`;
  }).join('');
  const heading = groupCount > 1 ? `<text class="analytics-chart-group-label" x="${PLOT.left}" y="${Math.round(groupTop + 10)}">${escapeHtml(String(groupUnit).toUpperCase())} · MAX ${escapeHtml(formatValue(barDomain.max, groupUnit, true))}</text>` : '';
  const bars = points.map((point, index) => {
    const raw = finite(point.value);
    if (raw === null) return '';
    const y = groupPlotTop + index * rowHeight + Math.max(1, Math.floor((rowHeight - 11) / 2));
    const trackHeight = Math.min(12, rowHeight - 2);
    const zeroX = PLOT.left + ((0 - barDomain.min) / barDomain.span) * (plotRight - PLOT.left);
    const endX = PLOT.left + ((Math.max(0, raw) - barDomain.min) / barDomain.span) * (plotRight - PLOT.left);
    const width = Math.max(1, Math.abs(endX - zeroX));
    const barX = raw < 0 ? endX : zeroX;
    const color = colorFor(point.series || 'primary', index);
    const label = truncateLabel(point.label, 22);
    return `<text class="analytics-chart-bar-label" x="${PLOT.left - 12}" y="${Math.round(y + trackHeight - 2)}" text-anchor="end">${escapeHtml(label)}</text><rect class="analytics-chart-bar-track" x="${PLOT.left}" y="${Math.round(y)}" width="${plotRight - PLOT.left}" height="${trackHeight}" fill="${CHART_ROLES.neutral}" fill-opacity="0.22"></rect><rect class="analytics-chart-bar" x="${Math.round(barX)}" y="${Math.round(y)}" width="${Math.round(width)}" height="${trackHeight}" fill="${color}" data-chart-point="${escapeHtml(point.label)}" data-chart-value="${escapeHtml(raw)}"><title>${escapeHtml(`${point.label} · ${formatValue(raw, groupUnit)}`)}</title></rect><text class="analytics-chart-value-label" x="${Math.min(plotRight - 2, Math.round(Math.max(zeroX, endX) + 8))}" y="${Math.round(y + trackHeight - 2)}">${escapeHtml(formatValue(raw, groupUnit))}</text>`;
  }).join('');
  return `<g class="analytics-chart-bar-group" aria-label="${escapeHtml(`${groupUnit} scale in ${title}`)}">${heading}<g class="analytics-chart-grid" aria-hidden="true">${ticksMarkup}</g>${bars}</g>`;
}

function renderBarGeometry(values, unit, title, funnel = false) {
  const displayValues = values.slice(0, 14);
  const groups = groupBarValues(displayValues, unit);
  const plotRight = SVG_WIDTH - PLOT.right;
  const plotBottom = SVG_HEIGHT - PLOT.bottom;
  const outerFrame = `<rect class="analytics-chart-frame" x="${PLOT.left}" y="${PLOT.top}" width="${plotRight - PLOT.left}" height="${plotBottom - PLOT.top}"></rect><g class="analytics-chart-axis"><line class="analytics-chart-baseline" x1="${PLOT.left}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}"></line><text class="analytics-chart-unit" x="${plotRight}" y="${SVG_HEIGHT - 8}" text-anchor="end">${escapeHtml(String(unit || 'VALUE').toUpperCase())}</text></g>`;
  const bars = groups.map(([groupUnit, points], index) => renderBarGroup(points, groupUnit, index, groups.length, title)).join('');
  const entries = normalizedSeries(displayValues).map(group => ({ name: group.name, label: group.name === 'verified' ? (funnel ? 'Eligibility' : 'Verified') : group.name }));
  const overflow = values.length > displayValues.length ? `<text class="analytics-chart-overflow-note" x="${PLOT.left}" y="${plotBottom + 38}">+${values.length - displayValues.length} MORE IN DATA TABLE</text>` : '';
  return `${outerFrame}${legendMarkup(entries)}${bars}${overflow}`;
}

function renderStackedGeometry(values, unit, title) {
  const segments = stackedSegments(values);
  const totals = segments.rows.map(row => row.values.reduce((sum, value) => sum + (value === null ? 0 : Math.max(0, value)), 0));
  const domain = chartDomain(totals.map((value, index) => ({ label: String(index), value })));
  const frame = frameMarkup(values, unit, domain, { labels: values.map(point => point.label), title });
  const plotBottom = SVG_HEIGHT - PLOT.bottom;
  const barWidth = Math.max(8, Math.floor((SVG_WIDTH - PLOT.left - PLOT.right) / Math.max(1, values.length) - 6));
  const bars = segments.rows.map((row, rowIndex) => {
    let offset = 0;
    const x = Math.round(xPosition(rowIndex, Math.max(1, values.length)) - barWidth / 2);
    return row.values.map((value, segmentIndex) => {
      if (value === null || value < 0) return '';
      const segmentHeight = Math.max(0, Math.round((value / domain.max) * (plotBottom - PLOT.top)));
      if (!segmentHeight) return '';
      const y = plotBottom - offset - segmentHeight;
      offset += segmentHeight;
      const key = segments.keys[segmentIndex];
      return `<rect class="analytics-chart-stack-segment" x="${x}" y="${y}" width="${barWidth}" height="${segmentHeight}" fill="${colorFor(key, segmentIndex)}" data-chart-point="${escapeHtml(row.label)}" data-chart-value="${escapeHtml(value)}"><title>${escapeHtml(`${row.label} · ${key} · ${formatValue(value, unit)}`)}</title></rect>`;
    }).join('');
  }).join('');
  const presentKeys = segments.keys.filter((_, index) => segments.rows.some(row => row.values[index] !== null && row.values[index] >= 0));
  return `${frame}${legendMarkup(presentKeys.map(key => ({ name: key, label: key })))}${bars}`;
}

function renderHistogramGeometry(values, unit, title) {
  const numbers = values.map(point => point.value).filter(value => value !== null);
  const count = Math.min(12, Math.max(1, numbers.length));
  const min = numbers.length ? Math.min(...numbers) : 0;
  const max = numbers.length ? Math.max(...numbers) : 1;
  const span = Math.max(1, max - min);
  const buckets = Array.from({ length: count }, () => 0);
  numbers.forEach(value => { const index = Math.min(count - 1, Math.max(0, Math.floor(((value - min) / span) * count))); buckets[index] += 1; });
  const points = buckets.map((value, index) => ({ label: `${index + 1}`, value }));
  const domain = chartDomain(points);
  const frame = frameMarkup(points, 'observations', domain, { labels: points.map(point => point.label), title });
  const bottom = SVG_HEIGHT - PLOT.bottom;
  const width = Math.max(8, Math.floor((SVG_WIDTH - PLOT.left - PLOT.right) / count - 6));
  const bars = points.map((point, index) => {
    const height = Math.max(1, Math.round((point.value / domain.max) * (bottom - PLOT.top)));
    const x = Math.round(xPosition(index, count) - width / 2);
    return `<rect class="analytics-chart-bar" x="${x}" y="${bottom - height}" width="${width}" height="${height}" fill="${CHART_ROLES.primary}" data-chart-point="${index + 1}" data-chart-value="${point.value}"></rect>`;
  }).join('');
  return `${frame}${bars}<text class="analytics-chart-range-note" x="${PLOT.left}" y="${SVG_HEIGHT - 8}">${escapeHtml(`${formatValue(min, unit)} – ${formatValue(max, unit)}`)}</text>`;
}

function renderHeatmapGeometry(values, unit, title, cohort = false) {
  const columns = cohort ? 12 : 14;
  const cellWidth = Math.max(12, Math.floor((SVG_WIDTH - PLOT.left - PLOT.right) / columns) - 2);
  const cellHeight = 14;
  const rows = Math.ceil(values.length / columns);
  const max = Math.max(1, ...values.map(point => Math.abs(safeNumber(point.value))));
  const frame = `<rect class="analytics-chart-frame" x="${PLOT.left}" y="${PLOT.top}" width="${SVG_WIDTH - PLOT.left - PLOT.right}" height="${Math.max(80, rows * cellHeight + 20)}"></rect><g class="analytics-chart-grid" aria-hidden="true"></g><g class="analytics-chart-axis"><text x="${PLOT.left}" y="${SVG_HEIGHT - 10}">${escapeHtml(String(unit || 'OBSERVATIONS').toUpperCase())}</text></g>`;
  const cells = values.map((point, index) => {
    const x = PLOT.left + (index % columns) * (cellWidth + 2);
    const y = PLOT.top + Math.floor(index / columns) * cellHeight + 8;
    const value = Math.abs(safeNumber(point.value));
    return `<rect class="analytics-chart-heat-cell" x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight - 3}" fill="${value ? CHART_ROLES.warning : CHART_ROLES.neutral}" fill-opacity="${Math.min(1, 0.24 + value / max * 0.76)}" data-chart-point="${escapeHtml(point.label)}" data-chart-value="${escapeHtml(point.value)}"><title>${escapeHtml(`${point.label} · ${formatValue(point.value, unit)}`)}</title></rect>`;
  }).join('');
  return `${frame}${cells}`;
}

function renderBoxGeometry(values, unit, title) {
  const sorted = values.map(point => point.value).filter(value => value !== null).sort((a, b) => a - b);
  const percentile = fraction => sorted.length ? sorted[Math.floor((sorted.length - 1) * fraction)] : 0;
  const points = [{ label: 'min', value: percentile(0) }, { label: 'q1', value: percentile(.25) }, { label: 'median', value: percentile(.5) }, { label: 'q3', value: percentile(.75) }, { label: 'max', value: percentile(1) }];
  const domain = chartDomain(points);
  const frame = frameMarkup(points, unit, domain, { labels: [], title });
  const x = (PLOT.left + SVG_WIDTH - PLOT.right) / 2;
  const yMin = yPosition(points[0].value, domain);
  const yQ1 = yPosition(points[1].value, domain);
  const yMedian = yPosition(points[2].value, domain);
  const yQ3 = yPosition(points[3].value, domain);
  const yMax = yPosition(points[4].value, domain);
  return `${frame}<line class="analytics-chart-box-whisker" x1="${x}" x2="${x}" y1="${yMax}" y2="${yMin}" stroke="${CHART_ROLES.primary}"></line><line class="analytics-chart-box-cap" x1="${x - 20}" x2="${x + 20}" y1="${yMin}" y2="${yMin}" stroke="${CHART_ROLES.primary}"></line><line class="analytics-chart-box-cap" x1="${x - 20}" x2="${x + 20}" y1="${yMax}" y2="${yMax}" stroke="${CHART_ROLES.primary}"></line><rect class="analytics-chart-box" x="${x - 32}" y="${Math.min(yQ1, yQ3)}" width="64" height="${Math.max(2, Math.abs(yQ1 - yQ3))}" fill="${CHART_ROLES.comparison}" fill-opacity="0.72" data-chart-value="${escapeHtml(points[2].value)}"></rect><line class="analytics-chart-box-median" x1="${x - 32}" x2="${x + 32}" y1="${yMedian}" y2="${yMedian}" stroke="${CHART_ROLES.positive}" stroke-width="2"></line>`;
}

function renderScatterGeometry(values, unit, title) {
  const domain = chartDomain(values);
  const frame = frameMarkup(values, unit, domain, { labels: values.map(point => point.label), title });
  const points = values.map((point, index) => {
    if (point.value === null) return '';
    const x = Math.round(xPosition(index, values.length));
    const y = yPosition(point.value, domain);
    return `<rect class="analytics-chart-point" x="${x - 4}" y="${y - 4}" width="8" height="8" fill="${colorFor(point.series || 'primary', index)}" data-chart-point="${escapeHtml(point.label)}" data-chart-value="${escapeHtml(point.value)}"><title>${escapeHtml(`${point.label} · ${formatValue(point.value, unit)}`)}</title></rect>`;
  }).join('');
  return `${frame}${legendMarkup(normalizedSeries(values).map(group => ({ name: group.name, label: group.name === 'verified' ? 'Verified' : group.name })))}${points}`;
}

const GEOMETRY_RENDERERS = Object.freeze({
  line: renderLineGeometry,
  bar: renderBarGeometry,
  funnel: (values, unit, title) => renderBarGeometry(values, unit, title, true),
  'stacked-bar': renderStackedGeometry,
  histogram: renderHistogramGeometry,
  heatmap: renderHeatmapGeometry,
  cohort: (values, unit, title) => renderHeatmapGeometry(values, unit, title, true),
  box: renderBoxGeometry,
  scatter: renderScatterGeometry
});

function chartGeometry(values, options, mode) {
  const unit = options.unit || 'value';
  const title = options.title || 'Analytics series';
  const renderer = GEOMETRY_RENDERERS[mode] || renderBarGeometry;
  return renderer(values, unit, title);
}

function renderTableToggle(container, tableId, visible) {
  const button = container.querySelector?.('.analytics-chart-table-toggle');
  const table = container.querySelector?.('.analytics-chart-table');
  button?.addEventListener?.('click', () => {
    table?.classList.toggle('is-hidden');
    const expanded = !table?.classList.contains('is-hidden');
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'HIDE DATA TABLE' : 'SHOW DATA TABLE';
  });
  return { button, table, tableId, visible };
}

function renderFigure(container, values, options, mode) {
  const title = options.title || 'Analytics series';
  const unit = options.unit || 'value';
  const forcedColors = mediaMatches('(forced-colors: active)');
  const unsupported = !MODES.has(mode) || forcedColors;
  const tableId = `analytics-chart-table-${++chartSequence}`;
  const visible = unsupported;
  const summary = options.summary || `${values.length} verified observations`;
  const summaryId = `${tableId}-summary`;
  const labelledBy = container.getAttribute?.('aria-labelledby');
  const captionId = labelledBy && /^[A-Za-z][A-Za-z0-9_-]*$/.test(labelledBy) ? ` id="${escapeHtml(labelledBy)}"` : '';
  const svg = unsupported ? '' : `<svg viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-label="${escapeHtml(`${title}; ${values.length} observations`)}" aria-describedby="${escapeHtml(summaryId)}" focusable="false" preserveAspectRatio="none"><title>${escapeHtml(title)}</title>${chartGeometry(values, options, mode)}</svg>`;
  const renderedTable = mode === 'stacked-bar' ? stackedTableMarkup(title, stackedSegments(values), tableId, visible) : tableMarkup(title, unit, values, tableId, visible);
  container.setAttribute?.('aria-label', title);
  container.innerHTML = `<figure class="analytics-chart" data-forced-colors="${forcedColors ? 'active' : 'off'}"><figcaption${captionId}>${escapeHtml(title)}</figcaption>${svg}<p id="${escapeHtml(summaryId)}" class="t-micro ink-3 analytics-chart-summary">${escapeHtml(summary)} · UNIT ${escapeHtml(unit)} · SAMPLE ${values.length}</p><button class="btn-dark analytics-chart-table-toggle" type="button" aria-expanded="${visible}" aria-controls="${escapeHtml(tableId)}">${visible ? 'HIDE DATA TABLE' : 'SHOW DATA TABLE'}</button>${renderedTable}</figure>`;
  renderTableToggle(container, tableId, visible);
  return container.firstElementChild;
}

export function renderAnalyticsChart(container, series, options = {}) {
  const mode = String(options.mode || 'line').toLowerCase();
  if (mode === 'board') return renderBoardMetricMap(container, options.board || series, options);
  const values = cleanPoints(series);
  if (!container || typeof document === 'undefined') return { values, table: true };
  return renderFigure(container, values, options, mode);
}

function boardIntensity(value, max) {
  if (value === null) return 0.22;
  return Math.min(1, 0.28 + Math.abs(value) / Math.max(1, max) * 0.72);
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
  const tableId = `analytics-chart-table-${++chartSequence}`;
  const columns = variant === 'metro-52' ? 13 : 10;
  const cellWidth = Math.max(22, Math.floor((SVG_WIDTH - PLOT.left - PLOT.right) / columns) - 4);
  const cellHeight = 26;
  const max = Math.max(1, ...tiles.map(tile => Math.abs(safeNumber(tile.value))));
  const cells = tiles.map(tile => {
    const x = PLOT.left + (tile.index % columns) * (cellWidth + 4);
    const y = PLOT.top + Math.floor(tile.index / columns) * cellHeight;
    const fill = tile.value === null ? CHART_ROLES.neutral : CHART_ROLES.primary;
    return `<rect class="analytics-board-tile" x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight - 4}" data-index="${tile.index}" data-chart-value="${tile.value === null ? '' : escapeHtml(tile.value)}" fill="${fill}" fill-opacity="${boardIntensity(tile.value, max)}"><title>${escapeHtml(`${tile.index} · ${tile.label} · ${tile.value === null ? 'N/A' : tile.value}`)}</title></rect>`;
  }).join('');
  const rows = Math.ceil(tiles.length / columns);
  const tableValues = tiles.map(tile => ({ label: `${tile.index} · ${tile.label}`, value: tile.value === null ? 'N/A' : tile.value }));
  const table = tableMarkup(title, 'Metric', tableValues, tableId);
  container.setAttribute?.('aria-label', title);
  container.innerHTML = `<figure class="analytics-chart analytics-board-map" data-forced-colors="${mediaMatches('(forced-colors: active)') ? 'active' : 'off'}"><figcaption>${escapeHtml(title)}</figcaption><svg viewBox="0 0 ${SVG_WIDTH} ${Math.max(SVG_HEIGHT, PLOT.top + rows * cellHeight + 24)}" role="img" aria-label="${escapeHtml(title)}" focusable="false"><title>${escapeHtml(title)}</title><rect class="analytics-chart-frame" x="${PLOT.left - 8}" y="${PLOT.top - 8}" width="${SVG_WIDTH - PLOT.left - PLOT.right + 16}" height="${rows * cellHeight + 8}"></rect>${cells}<g class="analytics-chart-legend"><rect x="${PLOT.left}" y="${PLOT.top + rows * cellHeight + 8}" width="8" height="8" fill="${CHART_ROLES.primary}"></rect><text x="${PLOT.left + 14}" y="${PLOT.top + rows * cellHeight + 16}">HIGHER ACTIVITY</text></g></svg><p class="t-micro ink-3 analytics-chart-summary">ASSOCIATION, NOT CAUSATION · SAMPLE ${tiles.filter(tile => tile.value !== null).length}</p><button class="btn-dark analytics-chart-table-toggle" type="button" aria-expanded="false" aria-controls="${escapeHtml(tableId)}">SHOW DATA TABLE</button>${table}</figure>`;
  renderTableToggle(container, tableId, false);
  return { tiles, element: container.firstElementChild };
}

export { CHART_COLORS, CHART_ROLES, MAX_POINTS };
