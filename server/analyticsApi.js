import { summarizeRuntimeMetrics } from './metricsRegistry.js';
import { createPseudonymizer, MIN_COHORT, PSEUDONYM_VERSION, sanitizeAnalyticsResponse, sanitizeAnalyticsRows, suppressedRow } from './analyticsPrivacy.js';
import {
  normalizeAnalyticsQuery,
  buildOverview,
  buildMatchHealth,
  buildRulesetBoard,
  buildEconomy,
  buildEventsRarity,
  buildBots,
  buildDataQuality,
  buildAssociation
} from './analyticsProjection.js';

const MAX_ADMIN_IDS = 32;
export const ANALYTICS_SCHEMA_VERSION = 1;
export const ANALYTICS_NO_STORE_HEADERS = Object.freeze({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });

function cleanId(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

export function normalizeAdminIds(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map(cleanId).filter(Boolean))].slice(0, MAX_ADMIN_IDS);
}

export function isAdminAccount(accountId, adminIds) {
  const id = cleanId(accountId);
  return Boolean(id && normalizeAdminIds(adminIds).includes(id));
}

/** Stamp owner-session account payloads with a boolean operator flag. Never add this to public social projections. */
export function withAdminFlag(account, adminIds) {
  if (!account || typeof account !== 'object') return account;
  return { ...account, isAdmin: isAdminAccount(account.id, adminIds) };
}

function safeRange(range) {
  // 'season' is the retired name for the 30 day window.
  const value = String(range) === 'season' ? 'month' : String(range);
  return ['hour', 'day', 'week', 'month'].includes(value) ? value : 'hour';
}

const RANGE_MS = Object.freeze({ hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 });

function metricSnapshot(registry, range) {
  return registry?.snapshotMetrics?.(range) || {
    range,
    generatedAt: new Date(0).toISOString(),
    metrics: {}
  };
}

export function buildAnalyticsSummary(registry, accountId, adminIds, range = 'hour') {
  if (!isAdminAccount(accountId, adminIds)) return { success: false, status: 403, error: 'Forbidden.' };
  const normalizedRange = safeRange(range);
  const snapshot = metricSnapshot(registry, normalizedRange);
  return {
    success: true,
    range: snapshot.range || normalizedRange,
    generatedAt: snapshot.generatedAt,
    metrics: snapshot.metrics && typeof snapshot.metrics === 'object' ? snapshot.metrics : {},
  };
}

export function setAnalyticsNoStoreHeaders(response) {
  if (!response || typeof response.setHeader !== 'function') return response;
  Object.entries(ANALYTICS_NO_STORE_HEADERS).forEach(([key, value]) => response.setHeader(key, value));
  return response;
}

function failure(status, error) {
  return { success: false, status, error };
}

function rollupHealth(rollup) {
  try {
    if (typeof rollup?.health === 'function') return rollup.health();
    const dimensions = rollup?.dimensions || {};
    return { loaded: Boolean(rollup), fresh: Object.keys(dimensions).length > 0 };
  } catch {
    return { loaded: false, fresh: false };
  }
}

function snapshotWithLiveMetrics(rollup, registry, query) {
  let snapshot = null;
  if (typeof rollup?.query === 'function') snapshot = rollup.query(query);
  else if (rollup && typeof rollup === 'object') snapshot = rollup;
  if (!snapshot || typeof snapshot !== 'object') return null;
  const live = registry?.snapshotMetrics?.(query.range);
  if (!live?.metrics) return snapshot;
  const runtime = summarizeRuntimeMetrics(registry);
  const quality = { ...(snapshot.quality || {}), liveGeneratedAt: live.generatedAt, ...(runtime ? { live: runtime } : {}) };
  const activeRooms = live.metrics['active-rooms'];
  if (activeRooms) quality.activeRooms = Number(activeRooms.value ?? activeRooms.last) || 0;
  return { ...snapshot, quality };
}

// The window just before the selected one, for the "vs previous" delta. Only
// returned when the stored history reaches back past its start; otherwise the
// comparison would silently describe a shorter period.
function previousPeriodSnapshot(rollup, query, current) {
  const duration = RANGE_MS[query.range];
  if (!duration || query.from || query.to || typeof rollup?.query !== 'function') return null;
  const generated = Date.parse(current?.generatedAt);
  const oldest = Date.parse(current?.quality?.oldestAt);
  if (!Number.isFinite(generated) || !Number.isFinite(oldest)) return null;
  // Buckets are whole hours and the current window includes the one straddling
  // its start, so the previous window ends an hour earlier to keep each bucket
  // in exactly one of the two.
  const to = generated - duration - 3_600_000;
  const from = generated - 2 * duration;
  if (oldest > from) return null;
  return rollup.query({ ...query, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
}

function pad(value) { return String(value).padStart(2, '0'); }

// Matches started per hour (hour/day windows) or per UTC day (week/month).
function activitySeries(snapshot, query) {
  const points = Array.isArray(snapshot?.series) ? snapshot.series : [];
  const daily = query.range === 'week' || query.range === 'month';
  const groups = new Map();
  points.forEach((point) => {
    const date = new Date(point?.at);
    if (Number.isNaN(date.getTime())) return;
    const day = `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    const label = daily ? day : `${day} ${pad(date.getUTCHours())}:00`;
    groups.set(label, (groups.get(label) || 0) + Math.max(0, Number(point.started) || 0));
  });
  return [...groups.entries()].map(([label, value]) => ({ label, value, unit: 'matches' }));
}

function responseEnvelope({ snapshot, query, overview, series = [], breakdowns = [], association = null, dataQuality, pseudonymVersion = PSEUDONYM_VERSION }) {
  const response = {
    success: true,
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    generatedAt: snapshot?.generatedAt || new Date().toISOString(),
    seasonId: query.seasonId,
    rulesetRevision: query.rulesetRevision,
    balanceRevision: query.balanceRevision,
    boardVariant: query.boardVariant,
    filters: {
      range: query.range,
      seasonId: query.seasonId,
      rulesetRevision: query.rulesetRevision,
      balanceRevision: query.balanceRevision,
      boardVariant: query.boardVariant,
      rulesetPreset: query.rulesetPreset,
      marketComplexity: query.marketComplexity,
      botMode: query.botMode,
      provider: query.provider,
      eventId: query.eventId,
      tab: query.tab,
      dimension: query.dimension,
      metric: query.metric
    },
    pseudonymVersion,
    suppression: { minimumCohort: MIN_COHORT, suppressedPanels: breakdowns.filter(item => item?.suppressed).length },
    overview,
    association,
    series: Array.isArray(series) ? series.slice(0, query.range === 'hour' ? 168 : 90) : [],
    breakdowns: Array.isArray(breakdowns) ? breakdowns.slice(0, 100) : [],
    dataQuality
  };
  return sanitizeAnalyticsResponse(response);
}

function viewFor(snapshot, query) {
  switch (query.tab) {
    case 'match-health': return buildMatchHealth(snapshot, query);
    case 'rulesets': return buildRulesetBoard(snapshot, query);
    case 'economy': return buildEconomy(snapshot, query);
    case 'events': return buildEventsRarity(snapshot, query);
    case 'bots': return buildBots(snapshot, query);
    case 'quality': return buildDataQuality(snapshot, query);
    default: return buildOverview(snapshot, query);
  }
}

export function buildAnalyticsBalance({ rollup, registry, accountId, adminIds, query: queryInput = {} } = {}) {
  if (!isAdminAccount(accountId, adminIds)) return failure(403, 'Forbidden.');
  const query = normalizeAnalyticsQuery(queryInput);
  const health = rollupHealth(rollup);
  if (health.loaded === false) return failure(503, 'Rollup unavailable.');
  // A rollup that has never recorded a match is empty, not broken: it answers an
  // honest empty snapshot. A rollup that has data but has gone quiet is "stale";
  // the Status tab still has live numbers to show then, and every other tab is
  // built from the rollup alone and stays unavailable.
  const stale = health.fresh === false && health.empty !== true;
  const liveOnly = stale && query.tab === 'overview' && Boolean(summarizeRuntimeMetrics(registry));
  if (stale && !liveOnly) return failure(503, 'Rollup unavailable.');
  const snapshot = snapshotWithLiveMetrics(rollup, registry, query);
  if (!snapshot) return failure(503, 'Rollup unavailable.');
  const overview = buildOverview(snapshot, query, { previous: previousPeriodSnapshot(rollup, query, snapshot) });
  const view = viewFor(snapshot, query);
  const breakdowns = query.tab === 'overview' ? [] : [view];
  const series = activitySeries(snapshot, query);
  const association = query.dimension === 'feature' ? buildAssociation(snapshot, query, query.metric) : null;
  return responseEnvelope({ snapshot, query, overview, series, breakdowns, association, dataQuality: buildDataQuality(snapshot, query) });
}

export function buildAnalyticsDrilldown({ rollup, accountId, adminIds, query: queryInput = {} } = {}) {
  if (!isAdminAccount(accountId, adminIds)) return failure(403, 'Forbidden.');
  const query = normalizeAnalyticsQuery(queryInput);
  const health = rollupHealth(rollup);
  if (health.loaded === false || (health.fresh === false && health.empty !== true)) return failure(503, 'Rollup unavailable.');
  const snapshot = snapshotWithLiveMetrics(rollup, null, query);
  if (!snapshot) return failure(503, 'Rollup unavailable.');
  const pseudonymizer = createPseudonymizer({ key: process.env.POORUP_ANALYTICS_PSEUDONYM_KEY });
  let breakdowns;
  if (!process.env.POORUP_ANALYTICS_PSEUDONYM_KEY) {
    breakdowns = [suppressedRow('PSEUDONYM_UNAVAILABLE')];
  } else {
    const actors = Array.isArray(snapshot.actorRollups)
      ? snapshot.actorRollups
      : Object.values(snapshot.actorRollups || {});
    const eligible = actors.filter(row => row?.pseudonymVersion === pseudonymizer.version && Number(row?.observations) >= MIN_COHORT && actorMatchesQuery(row, query));
    breakdowns = eligible.length ? sanitizeAnalyticsRows(eligible, { pseudonymizer, scope: query, trusted: true }) : [suppressedRow('MIN_COHORT')];
  }
  const association = query.dimension === 'feature' ? buildAssociation(snapshot, query, query.metric) : null;
  return responseEnvelope({ snapshot, query, overview: {}, series: [], breakdowns, association, dataQuality: buildDataQuality(snapshot, query), pseudonymVersion: pseudonymizer.version });
}

function actorMatchesQuery(row, query) {
  const scope = row?.scope || {};
  for (const name of ['seasonId', 'rulesetRevision', 'balanceRevision', 'boardVariant', 'rulesetPreset', 'marketComplexity', 'eventId', 'actionId', 'botMode', 'provider']) {
    const expected = query[name];
    if (expected === undefined || expected === null || expected === '' || expected === 'all') continue;
    if (String(expected).toLowerCase() !== String(scope[name] ?? '').toLowerCase()) return false;
  }
  if (!query.dimension) return true;
  if (query.dimension === 'board') return !query.boardVariant || query.boardVariant === 'all' || query.boardVariant === scope.boardVariant;
  if (query.dimension === 'ruleset') return !query.rulesetPreset || query.rulesetPreset === 'all' || query.rulesetPreset === scope.rulesetPreset;
  if (query.dimension === 'event') return Boolean(scope.eventId) && (!query.eventId || query.eventId === scope.eventId);
  if (query.dimension === 'bot') return Boolean(scope.botMode) && (!query.botMode || query.botMode === 'all' || query.botMode === scope.botMode);
  return true;
}

export { MAX_ADMIN_IDS };
