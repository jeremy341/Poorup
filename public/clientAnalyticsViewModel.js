import { ANALYTICS_TABS } from './clientAnalyticsCatalog.js';

export const MIN_COHORT = 5;

export const ALLOWED_METRICS = new Set([
  'active-sockets', 'active-rooms', 'active-rounds', 'room-reconnects', 'restore-failures',
  'action-latency-ms', 'error-count', 'bot-fallbacks', 'maintenance-transitions',
  'backup-failures', 'manual-codescene-runs',
]);

export const METRIC_LABELS = Object.freeze({
  'active-sockets': 'Active sockets', 'active-rooms': 'Active rooms', 'active-rounds': 'Active rounds',
  'room-reconnects': 'Room reconnects', 'restore-failures': 'Restore failures', 'action-latency-ms': 'Action latency',
  'error-count': 'Server errors', 'bot-fallbacks': 'Bot fallbacks', 'maintenance-transitions': 'Maintenance transitions',
  'backup-failures': 'Backup failures', 'manual-codescene-runs': 'Manual CodeScene runs',
});

const FORBIDDEN_KEYS = new Set(['displayname', 'username', 'accountid', 'clientid', 'roomcode', 'chat', 'message', 'text', 'hiddencards', 'privateloanterms', 'opponentsecrets', 'password', 'sessiontoken', 'raw', 'payload', 'event', 'data', 'rawpayload', 'rawevent', 'rawdata', 'ipaddress', 'rawip', 'useragent', 'rawuseragent', 'display_name', 'account_id', 'client_id', 'room_code', 'session_token', 'hidden_cards', 'private_loan_terms', 'opponent_secrets', 'raw_payload', 'raw_event', 'raw_data', 'ip_address', 'raw_ip', 'user_agent', 'raw_user_agent']);
const DYNAMIC_CLIENT_FIELDS = new Set(['features', 'events', 'market', 'bots', 'achievements', 'unlockRarity', 'outcomeDistribution', 'adoption', 'actions', 'combinations']);
const ALLOWED_CLIENT_FIELDS = new Set(['id', 'label', 'value', 'y', 'unit', 'sampleSize', 'observations', 'count', 'numerator', 'denominator', 'rate', 'delta', 'relativeDelta', 'relativeRateDelta', 'percentagePointDelta', 'comparison', 'definition', 'generatedAt', 'period', 'p95', 'source', 'started', 'starts', 'completed', 'completions', 'stalled', 'stalls', 'matches', 'startedMatches', 'completedMatches', 'stalledMatches', 'completionRate', 'medianDuration', 'p95Duration', 'durationMedian', 'durationP95', 'wins', 'winShare', 'placementBaseline', 'placementMedian', 'medianPlacement', 'fallback', 'fallbackRate', 'decisions', 'actions', 'actionAdoption', 'auctionDecisions', 'legalActionTaxonomy', 'feature', 'eventId', 'rulesetPreset', 'boardVariant', 'marketComplexity', 'botMode', 'provider', 'eligibility', 'eligible', 'used', 'adoption', 'volatility', 'liquidations', 'liquidation', 'liquidationRate', 'shortDefaults', 'shortDefaultRate', 'shortDefault', 'shortPositions', 'optionExercises', 'optionExerciseRate', 'optionExercise', 'collateralizedOptions', 'negativeCashPreventions', 'negativeCashPrevention', 'warnings', 'active', 'warningToActive', 'turnout', 'recovered', 'recoveryRate', 'combinations', 'rarity', 'unlockRarity', 'outcomeDistribution', 'bankruptcies', 'comebacks', 'reconnectRate', 'afkRate', 'denominators', 'competitiveMetricsExcludeBotOnly', 'rewardClaims', 'associationLabel', 'exposed', 'control', 'minimumCohort', 'suppressed', 'suppressionReason', 'schemaVersion', 'fresh', 'stale', 'lagSeconds', 'eventCoverage', 'queueDepth', 'pendingWrites', 'rejectedEvents', 'suppressionCount', 'revisionCoverage', 'filters', 'series', 'breakdowns', 'overview', 'dataQuality', 'metrics', 'kpis', 'cards', 'rows', 'pseudonymId', 'pseudonymVersion', 'seasonId', 'rulesetRevision', 'balanceRevision', 'range', 'tab', 'association', 'dimension', 'metric', 'scope']);

function finite(value, fallback = null) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function enumValue(value, allowed, fallback) { const normalized = String(value || fallback).trim().toLowerCase(); return allowed.includes(normalized) ? normalized : fallback; }
function safeScopeString(value) { return [...value].filter(character => character !== '|' && character.charCodeAt(0) >= 32).join('').slice(0, 80); }
function normalizeRevision(value) { if (value === '' || value === undefined || value === null) return ''; const number = finite(value, null); return number === null ? '' : String(Math.max(0, Math.floor(number))); }
function normalizedRevisionNumber(value, fallback = '') { const normalized = normalizeRevision(value); return normalized === '' ? fallback : Number(normalized); }

export function normalizeAnalyticsQuery(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    range: enumValue(source.range, ['hour', 'day', 'week', 'season'], 'hour'), seasonId: typeof source.seasonId === 'string' ? safeScopeString(source.seasonId) : '', rulesetRevision: normalizeRevision(source.rulesetRevision), balanceRevision: normalizeRevision(source.balanceRevision),
    boardVariant: enumValue(source.boardVariant, ['all', 'standard-40', 'metro-52'], 'all'), rulesetPreset: enumValue(source.rulesetPreset, ['all', 'classic', 'after-hours', 'custom'], 'all'), marketComplexity: enumValue(source.marketComplexity, ['all', 'basic', 'margin', 'shorting', 'derivatives'], 'all'), botMode: enumValue(source.botMode, ['all', 'ai', 'no-ai', 'human'], 'all'), provider: enumValue(source.provider, ['all', 'ai', 'deepseek', 'deterministic', 'fallback', 'house', 'openai', 'unknown'], 'all'), eventId: typeof source.eventId === 'string' ? source.eventId.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80) : '', minimumCohort: MIN_COHORT,
    tab: enumValue(source.tab || source.view, ANALYTICS_TABS, 'overview'), dimension: enumValue(source.dimension, ['feature', 'ruleset', 'board', 'event', 'bot'], ''), metric: typeof source.metric === 'string' ? source.metric.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80) : '',
  };
}

function cleanSafeValue(value, key = '', depth = 0, parentKey = '') {
  if (FORBIDDEN_KEYS.has(String(key).toLowerCase()) || depth > 20) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => cleanSafeValue(item, '', depth + 1, key)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  const output = {};
  Object.entries(value).slice(0, 200).forEach(([childKey, childValue]) => {
    if (!ALLOWED_CLIENT_FIELDS.has(childKey) && !DYNAMIC_CLIENT_FIELDS.has(key) && !DYNAMIC_CLIENT_FIELDS.has(parentKey)) return;
    const child = cleanSafeValue(childValue, childKey, depth + 1, key);
    if (child !== undefined) output[childKey] = child;
  });
  return output;
}

function metricEntries(value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value).filter(([name]) => ALLOWED_METRICS.has(name)) : []; }
function cleanMetricEntry(value) { if (!value || Object.prototype.toString.call(value) !== '[object Object]') return null; const output = {}; ['type', 'updatedAt'].forEach(key => { if (typeof value[key] === 'string') output[key] = value[key].slice(0, 80); }); ['count', 'total', 'last', 'min', 'max', 'value'].forEach(key => { const number = finite(value[key]); if (number !== null) output[key] = number; }); return output; }

export function normalizeAnalyticsSnapshot(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const filters = normalizeAnalyticsQuery(source.filters || source);
  const metrics = {}; metricEntries(source.metrics).forEach(([name, entry]) => { const clean = cleanMetricEntry(entry); if (clean) metrics[name] = clean; });
  return {
    schemaVersion: Number.isFinite(Number(source.schemaVersion)) && Number(source.schemaVersion) > 0 ? Number(source.schemaVersion) : 1,
    range: ['hour', 'day', 'week', 'season'].includes(String(source.range || filters.range)) ? String(source.range || filters.range) : filters.range,
    generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt.slice(0, 80) : '', pseudonymVersion: typeof source.pseudonymVersion === 'string' ? source.pseudonymVersion.slice(0, 40) : '', seasonId: typeof source.seasonId === 'string' ? safeScopeString(source.seasonId) : filters.seasonId,
    rulesetRevision: source.rulesetRevision === null || source.rulesetRevision === undefined ? filters.rulesetRevision : normalizedRevisionNumber(source.rulesetRevision), balanceRevision: source.balanceRevision === null || source.balanceRevision === undefined ? filters.balanceRevision : normalizedRevisionNumber(source.balanceRevision), boardVariant: enumValue(source.boardVariant, ['all', 'standard-40', 'metro-52'], filters.boardVariant), filters,
    suppression: { minimumCohort: MIN_COHORT, suppressedPanels: Math.max(0, Math.floor(finite(source.suppression?.suppressedPanels, 0))) }, overview: cleanSafeValue(source.overview, 'overview') || {}, association: cleanSafeValue(source.association, 'association') || null, series: Array.isArray(source.series) ? source.series.slice(0, 168).map(item => cleanSafeValue(item)).filter(Boolean) : [], breakdowns: Array.isArray(source.breakdowns) ? source.breakdowns.slice(0, 100).map(row => cleanSafeValue(row)).filter(Boolean) : [], dataQuality: cleanSafeValue(source.dataQuality, 'dataQuality') || {}, metrics,
  };
}

export function metricValue(entry) { if (!entry || typeof entry !== 'object') return 0; const value = finite(entry.value ?? entry.last ?? entry.total, 0); return value === null ? 0 : value; }
export function isAnalyticsPath(pathname) { return String(pathname || '').split('?')[0] === '/admin/analytics'; }
