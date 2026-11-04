// CHART MATH: pure scale, tick, label and value-format helpers shared by every chart
// (admin analytics, market desk, match history). No DOM and no globals, so each function is
// unit testable, and every value is formatted in one place so the surfaces agree.

export function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/** 1 / 2 / 5 x 10^n step that yields roughly `targetTicks` gridlines over `range`. */
export function niceStep(range, targetTicks = 5) {
  if (!(range > 0)) return 1;
  const rough = range / Math.max(1, targetTicks);
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

function tidy(value, step) {
  const digits = Math.max(0, 1 - Math.floor(Math.log10(step)));
  return Number(value.toFixed(Math.min(digits, 10)));
}

function presentNumbers(values) {
  return values.filter(value => value !== null && value !== undefined && Number.isFinite(value));
}

/**
 * Limits the data cannot cross, so axis padding never invents impossible values:
 * no negative ticks for money or counts that were never negative, no tick past 100%.
 * Only the natural limits 0 and 100 are used, and every nice step divides both.
 */
export function naturalLimits(values, unit) {
  const numbers = presentNumbers(values);
  const limits = {};
  if (numbers.length && numbers.every(value => value >= 0)) limits.floor = 0;
  if (unitKind(unit) === "percent" && numbers.length && numbers.every(value => value <= 100)) limits.ceil = 100;
  return limits;
}

/**
 * Bars of a share are measured against the whole (0 to 100%), so an 8% rate looks like 8%
 * and not like a full bar. Anything outside 0 to 100 falls back to the data-driven scale.
 */
export function barDomain(values, unit) {
  const numbers = presentNumbers(values);
  const share = unitKind(unit) === "percent" && numbers.length && numbers.every(value => value >= 0 && value <= 100);
  return share ? [0, 100] : null;
}

/**
 * A y (or value) axis domain with round bounds and tick positions. `zero` forces the
 * baseline into view. Otherwise `pad` adds room around the data. `floor` and `ceil`
 * (see naturalLimits) cap that padding, and `domain: [low, high]` fixes the axis.
 */
// A flat range gets room on both sides; a zero-anchored one grows upward only.
function flatRangeBounds(value, zero) {
  if (zero) return [value, value + 1];
  const bump = Math.abs(value) * 0.1 || 1;
  return [value - bump, value + bump];
}

function scaleBounds(min, max, zero, pad) {
  let low = min;
  let high = max;
  if (zero) {
    low = Math.min(low, 0);
    high = Math.max(high, 0);
  }
  if (low === high) return flatRangeBounds(low, zero);
  if (!zero && pad) {
    const span = high - low;
    return [low - span * pad, high + span * pad];
  }
  return [low, high];
}

export function niceScale(values, { zero = false, targetTicks = 5, pad = 0, floor = null, ceil = null, domain = null } = {}) {
  const numbers = presentNumbers(values);
  let min = numbers.length ? Math.min(...numbers) : 0;
  let max = numbers.length ? Math.max(...numbers) : 1;
  if (domain) {
    [min, max] = domain;
  } else {
    [min, max] = scaleBounds(min, max, zero, pad);
    if (floor !== null) min = Math.max(min, floor);
    if (ceil !== null) max = Math.min(max, ceil);
  }
  const step = niceStep(max - min, targetTicks);
  const low = Math.floor(min / step + 1e-9) * step;
  const high = Math.ceil(max / step - 1e-9) * step;
  const count = Math.max(1, Math.round((high - low) / step));
  const ticks = Array.from({ length: count + 1 }, (_, index) => tidy(low + index * step, step));
  return { min: ticks[0], max: ticks[ticks.length - 1], step, ticks };
}

export function linearScale(domainStart, domainEnd, rangeStart, rangeEnd) {
  const span = domainEnd - domainStart || 1;
  return value => rangeStart + ((value - domainStart) / span) * (rangeEnd - rangeStart);
}

/**
 * Which category labels fit along an axis. `slotWidth` is the pixel distance
 * between neighbouring labels; the first label always shows and the last one
 * joins it when there is room, so a long series never collides or hides its end.
 */
export function visibleLabelIndices(labels, slotWidth, { charWidth = 7.2, gap = 10 } = {}) {
  const count = labels.length;
  if (!count) return [];
  const longest = Math.max(1, ...labels.map(label => String(label).length));
  const needed = longest * charWidth + gap;
  const every = Math.max(1, Math.ceil(needed / Math.max(slotWidth, 1)));
  const indices = [];
  for (let index = 0; index < count; index += every) indices.push(index);
  const last = count - 1;
  const lastShown = indices[indices.length - 1];
  if (lastShown !== last && (last - lastShown) * slotWidth >= needed) indices.push(last);
  return indices;
}

export function truncateLabel(label, maxChars) {
  const text = String(label ?? "");
  if (maxChars < 2 || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

export function unitKind(unit) {
  const name = String(unit || "").toLowerCase();
  if (name === "percent" || name === "adoption" || name.endsWith("rate")) return "percent";
  if (name === "dollars" || name === "dollar" || name === "cash") return "money";
  if (name === "seconds") return "seconds";
  if (name === "milliseconds") return "milliseconds";
  return "number";
}

function formatNumber(value, maximumFractionDigits = 1) {
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

/** Full-precision value for tables and hover readouts. A share written as 0..1 reads as a percentage. */
export function formatValue(value, unit) {
  const number = finite(value);
  if (number === null) return "N/A";
  const kind = unitKind(unit);
  if (kind === "percent") return `${formatNumber(Math.abs(number) <= 1 ? number * 100 : number, 1)}%`;
  if (kind === "money") return number < 0 ? `-$${formatNumber(Math.abs(number), 2)}` : `$${formatNumber(number, 2)}`;
  if (kind === "seconds") return formatNumber(number, 2);
  if (kind === "milliseconds") return formatNumber(number, 0);
  return formatNumber(number, 2);
}

const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** Short axis label. The value is already in display units (percent charts are pre-scaled). */
export function formatTick(value, unit) {
  const kind = unitKind(unit);
  if (kind === "percent") return `${formatNumber(value, 1)}%`;
  const text = Math.abs(value) >= 10000 ? COMPACT.format(value) : formatNumber(value, 2);
  if (kind === "money") return value < 0 ? `-$${text.replace("-", "")}` : `$${text}`;
  return text;
}
