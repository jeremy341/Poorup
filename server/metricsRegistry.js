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
  // server.js already counts handshake rejections; without an entry here the
  // registry silently dropped them.
  'socket-admission-rejections': 'counter',
});

const ALLOWED_LABELS = new Set(['scope', 'source', 'state', 'phase', 'provider', 'action']);
const MAX_LABEL_LENGTH = 40;
const MAX_VALUE = 1_000_000_000;
const SNAPSHOT_RANGES = ['hour', 'day', 'week', 'month'];

// Bounded history that the plain counters cannot answer. Latency keeps the
// most recent samples so a percentile is possible; the connection gauge keeps
// one maximum per hour so "peak in the last 24 hours" is possible. Both live in
// memory only and restart with the process.
const SAMPLED_COUNTERS = new Set(['action-latency-ms']);
const PEAK_GAUGES = new Set(['active-sockets']);
const MAX_SAMPLES = 1024;
const HOUR_MS = 3_600_000;
const PEAK_WINDOW_HOURS = 24;

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

function nowMilliseconds(now) {
  const value = now();
  const ms = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(ms) ? ms : 0;
}

export function createMetricsRegistry({ now = () => Date.now(), maxMetrics = 64 } = {}) {
  const metrics = new Map();
  const samples = new Map();
  const peaks = new Map();
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
    if (SAMPLED_COUNTERS.has(name)) {
      const ring = samples.get(name) || [];
      ring.push(safeValue);
      if (ring.length > MAX_SAMPLES) ring.splice(0, ring.length - MAX_SAMPLES);
      samples.set(name, ring);
    }
    return { ...entry, labels: { ...entry.labels } };
  }

  function incrementMetric(name, labels = {}) {
    return recordMetric(name, 1, labels);
  }

  // Make counters with a known process-start baseline visible as zero without
  // recording a synthetic observation in their event count.
  function initializeCounter(name, labels = {}) {
    const entry = ensureEntry(name, labels);
    if (!entry || entry.type !== 'counter') return null;
    return { ...entry, labels: { ...entry.labels } };
  }

  function setMetric(name, value = 0, labels = {}) {
    const entry = ensureEntry(name, labels);
    if (!entry || entry.type !== 'gauge') return null;
    entry.labels = sanitizeLabels(labels);
    entry.value = boundedValue(value);
    entry.last = entry.value;
    entry.updatedAt = timestamp(now);
    if (PEAK_GAUGES.has(name)) notePeak(name, entry.value);
    return { ...entry, labels: { ...entry.labels } };
  }

  function notePeak(name, value) {
    const hour = Math.floor(nowMilliseconds(now) / HOUR_MS);
    const bins = peaks.get(name) || new Map();
    bins.set(hour, Math.max(bins.get(hour) ?? value, value));
    bins.forEach((_max, binHour) => { if (binHour <= hour - PEAK_WINDOW_HOURS) bins.delete(binHour); });
    peaks.set(name, bins);
  }

  // Percentile over the most recent recorded values (at most MAX_SAMPLES), not a
  // time window: a quiet server reports older actions, a busy one only the
  // latest. sampleSize lets the caller refuse to show a number built on a
  // handful of values.
  function quantile(name, fraction = 0.95) {
    const ring = samples.get(name) || [];
    if (!ring.length) return { value: null, sampleSize: 0 };
    const sorted = [...ring].sort((a, b) => a - b);
    const q = Math.min(1, Math.max(0, Number(fraction) || 0));
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
    return { value: sorted[index], sampleSize: sorted.length };
  }

  // Highest value a gauge held in the last 24 hourly bins, or null when it has
  // not been set since the process started.
  function peak(name) {
    const bins = peaks.get(name);
    if (!bins || !bins.size) return null;
    const hour = Math.floor(nowMilliseconds(now) / HOUR_MS);
    let best = null;
    bins.forEach((max, binHour) => {
      if (binHour <= hour - PEAK_WINDOW_HOURS) return;
      best = best === null ? max : Math.max(best, max);
    });
    return best;
  }

  function snapshotMetrics(range = 'hour') {
    // Live gauges only: no retention windows are kept, so every range
    // returns the current snapshot. Documented (not silently windowed).
    // 'season' is a retired alias for the 30 day window.
    const requested = String(range) === 'season' ? 'month' : String(range);
    const safeRange = SNAPSHOT_RANGES.includes(requested) ? requested : 'hour';
    const output = {};
    metrics.forEach((entry, name) => {
      output[name] = { ...entry, labels: { ...entry.labels } };
    });
    return { range: safeRange, generatedAt: timestamp(now), metrics: output };
  }

  function reset() {
    metrics.clear();
    samples.clear();
    peaks.clear();
  }

  return Object.freeze({ incrementMetric, initializeCounter, peak, quantile, recordMetric, reset, setMetric, snapshotMetrics });
}

/**
 * Wraps an event handler so every call records its duration (action-latency-ms)
 * and every throw or rejected promise counts as an unhandled error (error-count).
 * The wrapper returns exactly what the handler returns and rethrows exactly what
 * it throws, so the caller's own error handling is untouched.
 */
export function instrumentHandler(registry, handler, clock = () => performance.now()) {
  return function instrumented(...args) {
    const startedAt = clock();
    const finish = (failed) => {
      try {
        registry.recordMetric('action-latency-ms', Math.max(0, clock() - startedAt), { scope: 'socket' });
        if (failed) registry.incrementMetric('error-count', { source: 'socket' });
      } catch { /* metrics must never affect a player's action */ }
    };
    let result;
    try {
      result = handler.apply(this, args);
    } catch (error) {
      finish(true);
      throw error;
    }
    if (result && typeof result.then === 'function') {
      return result.then((value) => { finish(false); return value; }, (error) => { finish(true); throw error; });
    }
    finish(false);
    return result;
  };
}

// Fewer values than this is not a percentile worth showing.
export const MIN_PERCENTILE_SAMPLES = 20;

/**
 * HTTP request failures and failed player actions share the error-count
 * counter. The socket error rate has its own denominator (the player actions
 * handled), so the two sources are counted apart.
 */
function countErrorSource(entry, source) {
  const byLabels = entry?.byLabels;
  if (!byLabels || typeof byLabels !== 'object') return 0;
  let total = 0;
  Object.entries(byLabels).forEach(([series, values]) => {
    let labels;
    try { labels = JSON.parse(series); } catch { return; }
    if (!labels || typeof labels !== 'object' || labels.source !== source) return;
    total += Math.max(0, Number(values?.count) || 0);
  });
  return total;
}

/**
 * The live numbers the admin console reads, in one place so the status route and
 * the analytics KPIs cannot disagree. Everything is since the process started;
 * a value the registry cannot know is null, never zero.
 */
export function summarizeRuntimeMetrics(registry) {
  const metrics = registry?.snapshotMetrics?.('hour')?.metrics;
  if (!metrics || typeof metrics !== 'object') return null;
  const gauge = (name) => {
    const entry = metrics[name];
    return entry && Number.isFinite(Number(entry.value)) ? Number(entry.value) : null;
  };
  const counter = (name) => (metrics[name] ? Math.max(0, Number(metrics[name].count) || 0) : null);
  const latency = typeof registry.quantile === 'function' ? registry.quantile('action-latency-ms', 0.95) : { value: null, sampleSize: 0 };
  const enough = latency.sampleSize >= MIN_PERCENTILE_SAMPLES && Number.isFinite(latency.value);
  const totalErrors = counter('error-count') ?? 0;
  const httpErrorCount = countErrorSource(metrics['error-count'], 'http');
  return {
    activeSockets: gauge('active-sockets'),
    activeRooms: gauge('active-rooms'),
    activeRounds: gauge('active-rounds'),
    peakSockets24h: typeof registry.peak === 'function' ? registry.peak('active-sockets') : null,
    actionCount: counter('action-latency-ms') ?? 0,
    errorCount: totalErrors,
    // The failures of a player action, without the HTTP request failures that
    // share the counter.
    socketErrorCount: Math.max(0, totalErrors - httpErrorCount),
    httpErrorCount,
    restoreFailures: counter('restore-failures'),
    // Null until the first event: a counter nothing has incremented is "not recorded yet", never a measured zero.
    roomReconnects: counter('room-reconnects'),
    botFallbacks: counter('bot-fallbacks'),
    latencyP95Ms: enough ? latency.value : null,
    latencySamples: latency.sampleSize,
  };
}

export { ALLOWED_LABELS, METRIC_TYPES };
