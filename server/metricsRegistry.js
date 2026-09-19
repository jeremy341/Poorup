const METRIC_TYPES = Object.freeze({
  'active-sockets': 'gauge',
  'active-rooms': 'gauge',
  'active-rounds': 'gauge',
  'room-reconnects': 'counter',
  'restore-failures': 'counter',
  'action-latency-ms': 'counter',
  'error-count': 'counter',
  'bot-fallbacks': 'counter',
  'maintenance-transitions': 'counter',
  'backup-failures': 'counter',
  'manual-codescene-runs': 'counter',
});

const ALLOWED_LABELS = new Set(['scope', 'source', 'state', 'phase', 'provider', 'action']);
const MAX_LABEL_LENGTH = 40;
const MAX_VALUE = 1_000_000_000;

function boundedValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(-MAX_VALUE, Math.min(MAX_VALUE, number));
}

function sanitizeLabelEntry(entry) {
  const [key, value] = entry;
  if (!ALLOWED_LABELS.has(key) || typeof value !== 'string') return null;
  const clean = value.replace(/[<>]/g, '').trim().slice(0, MAX_LABEL_LENGTH);
  return clean ? [key, clean] : null;
}

function isLabelRecord(labels) {
  return Boolean(labels) && typeof labels === 'object' && !Array.isArray(labels);
}

function sanitizeLabels(labels = {}) {
  if (!isLabelRecord(labels)) return {};
  const entries = Object.entries(labels).map(sanitizeLabelEntry).filter(Boolean);
  return Object.fromEntries(entries);
}

function seriesKey(labels = {}) {
  return JSON.stringify(sanitizeLabels(labels));
}

function timestamp(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

export function createMetricsRegistry({ now = () => Date.now(), maxMetrics = 64 } = {}) {
  const metrics = new Map();
  const limit = Math.max(1, Math.min(256, Math.floor(Number(maxMetrics) || 64)));

  function ensureEntry(name, labels) {
    if (!Object.prototype.hasOwnProperty.call(METRIC_TYPES, name)) return null;
    if (!metrics.has(name) && metrics.size >= limit) return null;
    if (!metrics.has(name)) {
      metrics.set(name, {
        type: METRIC_TYPES[name],
        labels: sanitizeLabels(labels),
        count: 0,
        total: 0,
        last: 0,
        min: null,
        max: null,
        value: 0,
        updatedAt: timestamp(now),
      });
    }
    return metrics.get(name);
  }

  function recordMetric(name, value = 1, labels = {}) {
    const entry = ensureEntry(name, labels);
    if (!entry || entry.type !== 'counter') return null;
    const safeValue = boundedValue(value);
    // Per-label breakdown: a single entry must never silently merge counts
    // recorded under different label sets. Cap series to bound memory.
    const series = seriesKey(labels);
    entry.byLabels ||= {};
    if (!entry.byLabels[series] && Object.keys(entry.byLabels).length < 16) {
      entry.byLabels[series] = { count: 0, total: 0 };
    }
    if (entry.byLabels[series]) {
      entry.byLabels[series].count += 1;
      entry.byLabels[series].total = boundedValue(entry.byLabels[series].total + safeValue);
    }
    entry.labels = sanitizeLabels(labels);
    entry.count += 1;
    entry.total = boundedValue(entry.total + safeValue);
    entry.last = safeValue;
    entry.min = entry.min == null ? safeValue : Math.min(entry.min, safeValue);
    entry.max = entry.max == null ? safeValue : Math.max(entry.max, safeValue);
    entry.updatedAt = timestamp(now);
    return { ...entry, labels: { ...entry.labels } };
  }

  function incrementMetric(name, labels = {}) {
    return recordMetric(name, 1, labels);
  }

  function setMetric(name, value = 0, labels = {}) {
    const entry = ensureEntry(name, labels);
    if (!entry || entry.type !== 'gauge') return null;
    entry.labels = sanitizeLabels(labels);
    entry.value = boundedValue(value);
    entry.last = entry.value;
    entry.updatedAt = timestamp(now);
    return { ...entry, labels: { ...entry.labels } };
  }

  function snapshotMetrics(range = 'hour') {
    // Live gauges only: no retention windows are kept, so every range
    // returns the current snapshot. Documented (not silently windowed).
    const safeRange = ['hour', 'day', 'week'].includes(String(range)) ? String(range) : 'hour';
    const output = {};
    metrics.forEach((entry, name) => {
      output[name] = { ...entry, labels: { ...entry.labels } };
    });
    return { range: safeRange, generatedAt: timestamp(now), metrics: output };
  }

  function reset() {
    metrics.clear();
  }

  return Object.freeze({ incrementMetric, recordMetric, reset, setMetric, snapshotMetrics });
}

export { ALLOWED_LABELS, METRIC_TYPES };
