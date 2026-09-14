import { createPseudonymizer, MIN_COHORT, PSEUDONYM_VERSION, sanitizeAnalyticsResponse, sanitizeAnalyticsRows, suppressedRow } from './analyticsPrivacy.js';
import {
  normalizeAnalyticsQuery,
  buildOverview,
  buildMatchHealth,
  buildRulesetBoard,
  buildEconomy,
  buildEventsRarity,
  buildBots,
  buildDataQuality
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

function safeRange(range) {
  const value = String(range);
  return ['hour', 'day', 'week'].includes(value) ? value : 'hour';
}

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
    return typeof rollup?.health === 'function' ? rollup.health() : { loaded: Boolean(rollup), fresh: Boolean(rollup) };
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
  const activeRooms = live.metrics['active-rooms'];
  if (!activeRooms) return snapshot;
  return { ...snapshot, quality: { ...(snapshot.quality || {}), activeRooms: Number(activeRooms.value ?? activeRooms.last) || 0, liveGeneratedAt: live.generatedAt } };
}

function responseEnvelope({ snapshot, query, overview, series = [], breakdowns = [], dataQuality, pseudonymVersion = PSEUDONYM_VERSION }) {
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
      eventId: query.eventId,
      tab: query.tab
    },
    pseudonymVersion,
    suppression: { minimumCohort: MIN_COHORT, suppressedPanels: breakdowns.filter(item => item?.suppressed).length },
    overview,
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
  if (health.loaded === false || health.fresh === false) return failure(503, 'Rollup unavailable.');
  const snapshot = snapshotWithLiveMetrics(rollup, registry, query);
  if (!snapshot) return failure(503, 'Rollup unavailable.');
  const overview = buildOverview(snapshot, query);
  const view = viewFor(snapshot, query);
  const breakdowns = query.tab === 'overview' ? [] : [view];
  const series = Array.isArray(snapshot.series) ? snapshot.series : [];
  return responseEnvelope({ snapshot, query, overview, series, breakdowns, dataQuality: buildDataQuality(snapshot, query) });
}

export function buildAnalyticsDrilldown({ rollup, accountId, adminIds, query: queryInput = {} } = {}) {
  if (!isAdminAccount(accountId, adminIds)) return failure(403, 'Forbidden.');
  const query = normalizeAnalyticsQuery(queryInput);
  const health = rollupHealth(rollup);
  if (health.loaded === false || health.fresh === false) return failure(503, 'Rollup unavailable.');
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
    const eligible = actors.filter(row => Number(row?.observations) >= MIN_COHORT);
    breakdowns = eligible.length ? sanitizeAnalyticsRows(eligible, { pseudonymizer, scope: query }) : [suppressedRow('MIN_COHORT')];
  }
  return responseEnvelope({ snapshot, query, overview: {}, series: [], breakdowns, dataQuality: buildDataQuality(snapshot, query), pseudonymVersion: pseudonymizer.version });
}

export { MAX_ADMIN_IDS };
