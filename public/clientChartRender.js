// CHART RENDER: pure spec, then geometry, then SVG string. One renderer for line, area and
// bar charts, plus sparklines. Styling lives in pc-* CSS classes, so themes and forced-colors
// apply with no color lookups here. Series differ by tone and dash pattern, markers by shape and label.
import {
  finite, clamp, niceScale, naturalLimits, barDomain, linearScale, visibleLabelIndices, truncateLabel, unitKind, formatTick, formatValue,
} from "./clientChartMath.js";

const KINDS = ["line", "area", "bar"];
const TONES = ["primary", "comparison", "ai", "warning", "bot", "positive"];
const DASHES = ["", "7 4", "2 3", "9 3 2 3", "4 4", "1 3"];
const MARKER_KINDS = ["event", "buy", "sell", "note"];
const MAX_SERIES = 6;
export const MAX_CHART_POINTS = 168;
const PAD = { top: 12, right: 16, bottom: 28, left: 44 };
const CHAR = 7.2;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function r(value) {
  return Math.round(value * 100) / 100;
}

/* ---------- normalising ---------- */

/**
 * Accepts `{ kind, labels, series: [{ id, name, tone, values }], unit, title, markers, baseline, orientation }`
 * and returns a clamped, finite-only spec. `values[i]` lines up with `labels[i]`; null leaves a gap.
 */
export function normalizeChartSpec(input = {}) {
  const kind = KINDS.includes(input.kind) ? input.kind : "line";
  const labels = (Array.isArray(input.labels) ? input.labels : []).slice(0, MAX_CHART_POINTS).map(label => String(label ?? "").slice(0, 80));
  const unit = String(input.unit || "value").slice(0, 24);
  const rawSeries = (Array.isArray(input.series) ? input.series : []).slice(0, MAX_SERIES).map((entry, index) => ({
    id: String(entry?.id ?? `s${index}`).slice(0, 40),
    name: String(entry?.name ?? `Series ${index + 1}`).slice(0, 40),
    tone: TONES.includes(entry?.tone) ? entry.tone : TONES[index % TONES.length],
    raw: labels.map((_, position) => finite(entry?.values?.[position])),
  }));
  // A 0..1 share is drawn as 0..100% so ticks, bars and tables read the same.
  const scale = unitKind(unit) === "percent" && rawSeries.length && rawSeries.every(series => series.raw.every(value => value === null || Math.abs(value) <= 1)) ? 100 : 1;
  const series = rawSeries.map(entry => ({ ...entry, values: entry.raw.map(value => (value === null ? null : value * scale)) }));
  const markers = (Array.isArray(input.markers) ? input.markers : [])
    .filter(marker => Number.isInteger(marker?.index) && marker.index >= 0 && marker.index < labels.length)
    .slice(0, 60)
    .map(marker => ({
      index: marker.index,
      kind: MARKER_KINDS.includes(marker.kind) ? marker.kind : "note",
      label: String(marker.label ?? "").slice(0, 60),
      series: clamp(Number.isInteger(marker.series) ? marker.series : 0, 0, Math.max(0, series.length - 1)),
    }));
  return {
    kind,
    title: String(input.title || "Chart").slice(0, 120),
    unit,
    labels,
    series,
    markers,
    scale,
    baseline: input.baseline === "zero" || input.baseline === "auto" ? input.baseline : (kind === "line" ? "auto" : "zero"),
    orientation: input.orientation === "horizontal" || input.orientation === "vertical" ? input.orientation : "auto",
    showValues: input.showValues !== false,
  };
}

export function isHorizontal(spec) {
  if (spec.kind !== "bar") return false;
  if (spec.orientation !== "auto") return spec.orientation === "horizontal";
  return spec.labels.length > 6 || Math.max(0, ...spec.labels.map(label => label.length)) > 9;
}

/** Height that gives each horizontal bar a readable row; everything else uses a fixed plot height. */
export function preferredChartHeight(spec) {
  if (!isHorizontal(spec)) return 240;
  const row = 24 + 14 * Math.max(0, spec.series.length - 1);
  return clamp(64 + spec.labels.length * row, 150, 540);
}

/* ---------- layout ---------- */

function axisLeft(ticks, unit) {
  return clamp(Math.max(1, ...ticks.map(tick => formatTick(tick, unit).length)) * CHAR + 16, 34, 76);
}

function legendEntries(spec, startX) {
  if (spec.series.length < 2) return [];
  let x = startX;
  return spec.series.map((series, index) => {
    const entry = { x, y: 6, name: series.name, tone: series.tone, dash: DASHES[index % DASHES.length] };
    x += 26 + series.name.length * CHAR + 16;
    return entry;
  });
}

function segmentsOf(values, xs, yAt) {
  const segments = [];
  let current = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push({ x: xs[index], y: yAt(value) });
  });
  if (current.length) segments.push(current);
  return segments;
}

const linePath = points => `M${points.map(point => `${r(point.x)} ${r(point.y)}`).join(" L")}`;
const areaPath = (points, baselineY) => `${linePath(points)} L${r(points[points.length - 1].x)} ${r(baselineY)} L${r(points[0].x)} ${r(baselineY)} Z`;

function layoutLines(spec, width, height) {
  const values = spec.series.flatMap(series => series.values);
  const scale = niceScale(values, { zero: spec.baseline === "zero", pad: 0.1, targetTicks: height < 180 ? 3 : 5, ...naturalLimits(values, spec.unit) });
  const left = axisLeft(scale.ticks, spec.unit);
  const legend = legendEntries(spec, left);
  const top = PAD.top + (legend.length ? 22 : 0);
  const plot = { x: left, y: top, w: width - left - PAD.right, h: height - top - PAD.bottom };
  const inset = 8;
  const count = spec.labels.length;
  const xs = spec.labels.map((_, index) => (count === 1 ? plot.x + plot.w / 2 : plot.x + inset + (index / (count - 1)) * (plot.w - inset * 2)));
  const yAt = linearScale(scale.min, scale.max, plot.y + plot.h, plot.y);
  const baselineY = yAt(clamp(0, scale.min, scale.max));
  const slot = count > 1 ? (plot.w - inset * 2) / (count - 1) : plot.w;
  const lines = spec.series.map((series, index) => {
    const segments = segmentsOf(series.values, xs, yAt);
    return {
      id: series.id, name: series.name, tone: series.tone, dash: DASHES[index % DASHES.length],
      d: segments.map(linePath).join(" "),
      area: spec.kind === "area" ? segments.map(segment => areaPath(segment, baselineY)).join(" ") : "",
      points: series.values.map((value, position) => (value === null ? null : { i: position, x: xs[position], y: yAt(value) })),
    };
  });
  const markers = spec.markers.map(marker => {
    const value = spec.series[marker.series]?.values[marker.index];
    return value === null || value === undefined ? null : { ...marker, x: xs[marker.index], y: yAt(value) };
  }).filter(Boolean);
  return {
    kind: spec.kind, width, height, plot, scale, axis: "x", xs, baselineY, lines, markers, legend,
    dots: count <= 40 ? "all" : "last",
    yTicks: scale.ticks.map(tick => ({ pos: yAt(tick), label: formatTick(tick, spec.unit) })),
    xTicks: visibleLabelIndices(spec.labels, slot).map(index => ({ pos: xs[index], label: spec.labels[index], index })),
  };
}

function layoutVerticalBars(spec, width, height) {
  const values = spec.series.flatMap(series => series.values);
  const domain = barDomain(values, spec.unit);
  const scale = niceScale(values, { zero: true, targetTicks: height < 180 ? 3 : 5, domain });
  const left = axisLeft(scale.ticks, spec.unit);
  const legend = legendEntries(spec, left);
  const top = PAD.top + (legend.length ? 22 : 0) + 8;
  const plot = { x: left, y: top, w: width - left - PAD.right, h: height - top - PAD.bottom };
  const count = spec.labels.length;
  const slot = plot.w / count;
  const groupW = Math.min(slot * 0.7, 64 * spec.series.length);
  const barW = groupW / spec.series.length;
  const yAt = linearScale(scale.min, scale.max, plot.y + plot.h, plot.y);
  const zeroY = yAt(0);
  const xs = spec.labels.map((_, index) => plot.x + slot * (index + 0.5));
  const bars = [];
  spec.series.forEach((series, seriesIndex) => series.values.forEach((value, index) => {
    if (value === null) return;
    const y = yAt(value);
    bars.push({
      i: index, s: seriesIndex, tone: series.tone, value,
      x: xs[index] - groupW / 2 + seriesIndex * barW, y: Math.min(y, zeroY),
      w: Math.max(1, barW - (spec.series.length > 1 ? 2 : 0)), h: Math.max(1, Math.abs(y - zeroY)),
    });
  }));
  const withValues = spec.showValues && bars.length <= 14 && barW >= 18;
  const shown = visibleLabelIndices(spec.labels, slot);
  const every = shown.length > 1 ? shown[1] - shown[0] : 1;
  const maxChars = Math.max(3, Math.floor((slot * every - 6) / CHAR));
  return {
    kind: "bar", horizontal: false, width, height, plot, scale, axis: "x", xs, legend, bars, zeroPos: zeroY,
    valueLabels: withValues ? bars.map(bar => ({ x: bar.x + bar.w / 2, y: bar.value >= 0 ? bar.y - 4 : bar.y + bar.h + 11, text: formatTick(bar.value, spec.unit) })) : [],
    yTicks: scale.ticks.map(tick => ({ pos: yAt(tick), label: formatTick(tick, spec.unit) })),
    xTicks: shown.map(index => ({ pos: xs[index], label: truncateLabel(spec.labels[index], maxChars), index })),
  };
}

function layoutHorizontalBars(spec, width, height) {
  const values = spec.series.flatMap(series => series.values);
  const domain = barDomain(values, spec.unit);
  const scale = niceScale(values, { zero: true, targetTicks: domain ? 5 : 4, domain });
  const labelW = clamp(Math.max(1, ...spec.labels.map(label => label.length)) * CHAR + 14, 56, width * 0.4);
  const maxChars = Math.floor((labelW - 12) / CHAR);
  const legend = legendEntries(spec, labelW);
  const top = PAD.top + (legend.length ? 22 : 0);
  const valueRoom = spec.showValues ? 44 : 8;
  const plot = { x: labelW, y: top, w: Math.max(40, width - labelW - PAD.right - valueRoom), h: height - top - 24 };
  const count = spec.labels.length;
  const slot = plot.h / count;
  const groupH = Math.min(slot * 0.7, 26 * spec.series.length);
  const barH = groupH / spec.series.length;
  const xAt = linearScale(scale.min, scale.max, plot.x, plot.x + plot.w);
  const zeroX = xAt(0);
  const ys = spec.labels.map((_, index) => plot.y + slot * (index + 0.5));
  const bars = [];
  spec.series.forEach((series, seriesIndex) => series.values.forEach((value, index) => {
    if (value === null) return;
    const x = xAt(value);
    bars.push({
      i: index, s: seriesIndex, tone: series.tone, value,
      x: Math.min(x, zeroX), y: ys[index] - groupH / 2 + seriesIndex * barH,
      w: Math.max(1, Math.abs(x - zeroX)), h: Math.max(1, barH - (spec.series.length > 1 ? 2 : 0)),
    });
  }));
  return {
    kind: "bar", horizontal: true, width, height, plot, scale, axis: "y", ys, legend, bars, zeroPos: zeroX,
    valueLabels: spec.showValues ? bars.map(bar => (bar.value >= 0
      ? { x: bar.x + bar.w + 5, y: bar.y + bar.h / 2 + 3.5, anchor: "start", text: formatTick(bar.value, spec.unit) }
      : { x: bar.x - 5, y: bar.y + bar.h / 2 + 3.5, anchor: "end", text: formatTick(bar.value, spec.unit) })) : [],
    rowLabels: spec.labels.map((label, index) => ({ y: ys[index] + 3.5, text: truncateLabel(label, maxChars), full: label })),
    xTicks: scale.ticks.map(tick => ({ pos: xAt(tick), label: formatTick(tick, spec.unit) })),
  };
}

export function layoutChart(spec, { width = 360, height = 240 } = {}) {
  const w = Math.max(160, Math.round(width));
  const h = Math.max(120, Math.round(height));
  if (!spec.labels.length || !spec.series.length) return { kind: spec.kind, width: w, height: h, empty: true, axis: "x", xs: [], legend: [] };
  if (spec.kind === "bar") return isHorizontal(spec) ? layoutHorizontalBars(spec, w, h) : layoutVerticalBars(spec, w, h);
  return layoutLines(spec, w, h);
}

/** Index of the category nearest a pixel position along the chart's category axis. */
export function nearestIndex(model, x, y) {
  const positions = model.axis === "y" ? model.ys : model.xs;
  if (!positions?.length) return -1;
  const target = model.axis === "y" ? y : x;
  let best = 0;
  positions.forEach((position, index) => {
    if (Math.abs(position - target) < Math.abs(positions[best] - target)) best = index;
  });
  return best;
}

/* ---------- svg ---------- */

function pointTitle(spec, seriesIndex, index) {
  const series = spec.series[seriesIndex];
  return `${spec.labels[index]} · ${series.name}: ${formatValue(series.raw[index], spec.unit)}`;
}

function gridMarkup(model) {
  const { plot } = model;
  if (model.horizontal) {
    return `<g class="pc-grid">${model.xTicks.map(tick => `<line x1="${r(tick.pos)}" y1="${r(plot.y)}" x2="${r(tick.pos)}" y2="${r(plot.y + plot.h)}"/>`).join("")}</g>`
      + `<g class="pc-axis"><line x1="${r(model.zeroPos)}" y1="${r(plot.y)}" x2="${r(model.zeroPos)}" y2="${r(plot.y + plot.h)}"/></g>`
      + `<g class="pc-ticks">${model.xTicks.map(tick => `<text x="${r(tick.pos)}" y="${r(plot.y + plot.h + 14)}" text-anchor="middle">${esc(tick.label)}</text>`).join("")}${model.rowLabels.map(row => `<text class="pc-cat" x="${r(plot.x - 8)}" y="${r(row.y)}" text-anchor="end">${esc(row.text)}<title>${esc(row.full)}</title></text>`).join("")}</g>`;
  }
  const zeroY = model.kind === "bar" ? model.zeroPos : model.baselineY;
  return `<g class="pc-grid">${model.yTicks.map(tick => `<line x1="${r(plot.x)}" y1="${r(tick.pos)}" x2="${r(plot.x + plot.w)}" y2="${r(tick.pos)}"/>`).join("")}</g>`
    + `<g class="pc-axis"><line x1="${r(plot.x)}" y1="${r(plot.y)}" x2="${r(plot.x)}" y2="${r(plot.y + plot.h)}"/><line x1="${r(plot.x)}" y1="${r(zeroY)}" x2="${r(plot.x + plot.w)}" y2="${r(zeroY)}"/></g>`
    + `<g class="pc-ticks">${model.yTicks.map(tick => `<text x="${r(plot.x - 6)}" y="${r(tick.pos + 3.5)}" text-anchor="end">${esc(tick.label)}</text>`).join("")}${model.xTicks.map(tick => `<text class="pc-cat" x="${r(tick.pos)}" y="${r(plot.y + plot.h + 16)}" text-anchor="middle">${esc(tick.label)}</text>`).join("")}</g>`;
}

function legendMarkup(model) {
  if (!model.legend.length) return "";
  return `<g class="pc-legend">${model.legend.map(entry => `<g class="pc-tone-${entry.tone}" transform="translate(${r(entry.x)} ${entry.y})"><line class="pc-legend-swatch" x1="0" y1="6" x2="20" y2="6"${entry.dash ? ` stroke-dasharray="${entry.dash}"` : ""}/><text x="26" y="10">${esc(entry.name)}</text></g>`).join("")}</g>`;
}

function markerShape(marker) {
  const { x, y } = marker;
  if (marker.kind === "buy") return `M${r(x)} ${r(y - 7)} L${r(x + 6)} ${r(y + 4)} L${r(x - 6)} ${r(y + 4)} Z`;
  if (marker.kind === "sell") return `M${r(x)} ${r(y + 7)} L${r(x + 6)} ${r(y - 4)} L${r(x - 6)} ${r(y - 4)} Z`;
  return `M${r(x)} ${r(y - 7)} L${r(x + 7)} ${r(y)} L${r(x)} ${r(y + 7)} L${r(x - 7)} ${r(y)} Z`;
}

function seriesMarkup(model, spec) {
  if (model.kind === "bar") {
    const bars = model.bars.map(bar => `<rect class="pc-bar pc-tone-${bar.tone}" data-i="${bar.i}" data-s="${bar.s}" x="${r(bar.x)}" y="${r(bar.y)}" width="${r(bar.w)}" height="${r(bar.h)}"><title>${esc(pointTitle(spec, bar.s, bar.i))}</title></rect>`).join("");
    const values = model.valueLabels.map(label => `<text x="${r(label.x)}" y="${r(label.y)}" text-anchor="${label.anchor || "middle"}">${esc(label.text)}</text>`).join("");
    return `<g class="pc-bars">${bars}</g><g class="pc-values">${values}</g>`;
  }
  const parts = model.lines.map((line, index) => {
    const dots = model.dots === "all" ? line.points.filter(Boolean) : [...line.points].reverse().filter(Boolean).slice(0, 1);
    const area = line.area ? `<path class="pc-area" d="${line.area}"/>` : "";
    const path = line.d ? `<path class="pc-line" d="${line.d}"${line.dash ? ` stroke-dasharray="${line.dash}"` : ""}/>` : "";
    const squares = dots.map(point => `<rect class="pc-dot" data-i="${point.i}" x="${r(point.x - 3)}" y="${r(point.y - 3)}" width="6" height="6"><title>${esc(pointTitle(spec, index, point.i))}</title></rect>`).join("");
    return `<g class="pc-series pc-tone-${line.tone}">${area}${path}${squares}</g>`;
  }).join("");
  const markers = model.markers.map(marker => `<g class="pc-marker pc-marker-${marker.kind}" data-i="${marker.index}"><path d="${markerShape(marker)}"/><title>${esc(`${spec.labels[marker.index]} · ${marker.label || marker.kind}`)}</title></g>`).join("");
  return `${parts}<g class="pc-markers">${markers}</g>`;
}

/** The complete `<svg>` for a laid-out chart. `label` names it for assistive tech. */
export function chartSVG(model, spec, { label = "", describedBy = "" } = {}) {
  const described = describedBy ? ` aria-describedby="${esc(describedBy)}"` : "";
  const open = `<svg class="pc-svg pc-kind-${model.kind}" viewBox="0 0 ${model.width} ${model.height}" width="${model.width}" height="${model.height}" role="img" aria-label="${esc(label || spec.title)}"${described} focusable="false">`;
  if (model.empty) return `${open}<text class="pc-empty" x="${r(model.width / 2)}" y="${r(model.height / 2)}" text-anchor="middle">NO DATA</text></svg>`;
  return `${open}${gridMarkup(model)}${legendMarkup(model)}${seriesMarkup(model, spec)}<g class="pc-hover"></g></svg>`;
}

/** Markup for the hover/keyboard readout at category `index`: crosshair, point rings and a value box. */
export function hoverMarkup(model, spec, index) {
  if (model.empty || index < 0 || index >= spec.labels.length) return "";
  const lines = [spec.labels[index], ...spec.series.map(series => (spec.series.length > 1 ? `${series.name}: ` : "") + formatValue(series.raw[index], spec.unit))];
  spec.markers.filter(marker => marker.index === index && marker.label).forEach(marker => lines.push(marker.label));
  const boxW = Math.max(...lines.map(line => line.length)) * CHAR + 16;
  const boxH = lines.length * 14 + 10;
  const anchorX = model.axis === "y" ? model.plot.x + model.plot.w / 2 : model.xs[index];
  const anchorY = model.axis === "y" ? model.ys[index] : model.plot.y + 4;
  const flip = anchorX + 14 + boxW > model.width - 4;
  const boxX = clamp(flip ? anchorX - 14 - boxW : anchorX + 14, 4, model.width - boxW - 4);
  const boxY = clamp(model.axis === "y" ? anchorY - boxH / 2 : anchorY, 4, model.height - boxH - 4);
  let cursor = "";
  if (model.axis === "x" && model.kind !== "bar") {
    cursor = `<line class="pc-cursor" x1="${r(anchorX)}" y1="${r(model.plot.y)}" x2="${r(anchorX)}" y2="${r(model.plot.y + model.plot.h)}"/>`
      + model.lines.map((line, seriesIndex) => (line.points[index] ? `<rect class="pc-ring pc-tone-${line.tone}" x="${r(line.points[index].x - 5)}" y="${r(line.points[index].y - 5)}" width="10" height="10"/>` : "")).join("");
  }
  const text = lines.map((line, row) => `<text x="${r(boxX + 8)}" y="${r(boxY + 14 + row * 14)}">${esc(line)}</text>`).join("");
  return `${cursor}<g class="pc-readout"><rect x="${r(boxX)}" y="${r(boxY)}" width="${r(boxW)}" height="${r(boxH)}"/>${text}</g>`;
}

/** Plain-text equivalent of the readout, for the live region. */
export function readoutText(spec, index) {
  if (index < 0 || index >= spec.labels.length) return "";
  const values = spec.series.map(series => `${spec.series.length > 1 ? `${series.name} ` : ""}${formatValue(series.raw[index], spec.unit)}`);
  const notes = spec.markers.filter(marker => marker.index === index && marker.label).map(marker => marker.label);
  return [spec.labels[index], ...values, ...notes].join(", ");
}

/** One-call convenience used by tests and server-less callers. */
export function chartMarkup(input, { width = 360, height, label = "", describedBy = "" } = {}) {
  const spec = normalizeChartSpec(input);
  const model = layoutChart(spec, { width, height: height || preferredChartHeight(spec) });
  return chartSVG(model, spec, { label, describedBy });
}

/** A label-free trend line for dense rows (history strip, rankings). */
export function sparklineSVG(values, { width = 96, height = 24, tone = "primary", label = "" } = {}) {
  const numbers = (Array.isArray(values) ? values : []).map(finite);
  const present = numbers.filter(value => value !== null);
  const w = Math.max(24, Math.round(width));
  const h = Math.max(12, Math.round(height));
  const open = `<svg class="pc-spark pc-tone-${TONES.includes(tone) ? tone : "primary"}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label || "Trend")}" focusable="false">`;
  if (present.length < 2) return `${open}</svg>`;
  const low = Math.min(...present);
  const high = Math.max(...present);
  const inset = 3;
  const yAt = linearScale(low === high ? low - 1 : low, low === high ? high + 1 : high, h - inset, inset);
  const xs = numbers.map((_, index) => inset + (index / (numbers.length - 1)) * (w - inset * 2));
  const path = segmentsOf(numbers, xs, yAt).map(linePath).join(" ");
  const lastIndex = numbers.map(value => value !== null).lastIndexOf(true);
  return `${open}<path class="pc-line" d="${path}"/><rect class="pc-dot" x="${r(xs[lastIndex] - 2.5)}" y="${r(yAt(numbers[lastIndex]) - 2.5)}" width="5" height="5"/></svg>`;
}
