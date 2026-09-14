import crypto from 'node:crypto';

export const MIN_COHORT = 5;
export const PSEUDONYM_VERSION = 'hmac-v1';

const FORBIDDEN_KEYS = new Set([
  'displayname', 'username', 'accountid', 'clientid', 'roomcode', 'chat', 'message', 'text',
  'hiddencards', 'privateloanterms', 'opponentsecrets', 'password', 'sessiontoken', 'rawpayload',
  'rawevent', 'rawdata', 'display_name', 'account_id', 'client_id', 'room_code', 'session_token',
  'hidden_cards', 'private_loan_terms', 'opponent_secrets'
]);

// Rows are deliberately narrow. The projection owns formulas; this boundary
// only permits values that can be displayed as aggregate evidence.
const ALLOWED_ROW_KEYS = new Set([
  'pseudonymId', 'suppressed', 'suppressionReason', 'dimension', 'dimensionKey', 'label', 'name',
  'id', 'feature', 'eventId', 'rulesetPreset', 'boardVariant', 'marketComplexity', 'botMode',
  'provider', 'seasonId', 'rulesetRevision', 'balanceRevision', 'observations', 'sampleSize',
  'count', 'value', 'numerator', 'denominator', 'rate', 'delta', 'relativeDelta', 'relativeRateDelta', 'percentagePointDelta',
  'matches', 'started', 'completed', 'stalled', 'completionRate', 'medianDuration', 'p95Duration',
  'durationMedian', 'durationP95', 'wins', 'winShare', 'placementMedian', 'fallback', 'fallbackRate',
  'decisions', 'actions', 'eligibility', 'eligible', 'used', 'adoption', 'volatility', 'liquidations',
  'marginPositions', 'shortDefaults', 'shortPositions', 'optionExercises', 'collateralizedOptions',
  'negativeCashPreventions', 'warnings', 'active', 'warningToActive', 'turnout', 'recovered',
  'recoveryRate', 'combinations', 'rarity', 'unlocks', 'rewardClaims', 'associationLabel',
  'exposed', 'control', 'minimumCohort'
]);

function validAccountId(accountId) {
  if (typeof accountId !== 'string') return null;
  const value = accountId.trim();
  if (!value || value.length > 160 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  return value;
}

function cleanScopeValue(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const clean = String(value).trim().slice(0, 120);
  return clean || fallback;
}

function scopeString(scope = {}) {
  return [
    cleanScopeValue(scope.seasonId, 'unseasoned'),
    cleanScopeValue(scope.rulesetRevision, '0'),
    cleanScopeValue(scope.balanceRevision, '0')
  ].join('|');
}

function safeKey(key) {
  if (typeof key === 'string') return key.trim() || null;
  if (Buffer.isBuffer(key) && key.length) return key;
  return null;
}

export function createPseudonymizer({ key, version = PSEUDONYM_VERSION } = {}) {
  const secret = safeKey(key);
  const pseudonymVersion = typeof version === 'string' && version.trim() ? version.trim().slice(0, 40) : PSEUDONYM_VERSION;

  function digest(accountId, scope, length = 12) {
    const id = validAccountId(accountId);
    if (!secret || !id) return null;
    const value = crypto.createHmac('sha256', secret).update(`${scopeString(scope)}:${id}`, 'utf8').digest('base64url');
    return `P-${value.slice(0, length).toUpperCase()}`;
  }

  return Object.freeze({
    version: pseudonymVersion,
    pseudonymize(accountId, scope = {}) { return digest(accountId, scope); },
    // Used only when a response detects a truncated digest collision. The
    // longer form is still scoped and keyed, and never reveals the raw ID.
    pseudonymizeExpanded(accountId, scope = {}) { return digest(accountId, scope, 18); }
  });
}

export function suppressedRow(reason = 'MIN_COHORT') {
  return { suppressed: true, suppressionReason: String(reason || 'MIN_COHORT').slice(0, 40) };
}

function safePrimitive(value) {
  if (value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

function sanitizeValue(value, key, depth = 0) {
  if (FORBIDDEN_KEYS.has(String(key || '').toLowerCase())) return undefined;
  if (depth > 12) return undefined;
  if (value === null) return null;
  const primitive = safePrimitive(value);
  if (primitive !== undefined || value === null) return primitive;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeValue(item, '', depth + 1)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  const result = {};
  Object.entries(value).slice(0, 80).forEach(([childKey, childValue]) => {
    const clean = sanitizeValue(childValue, childKey, depth + 1);
    if (clean !== undefined) result[childKey] = clean;
  });
  return result;
}

export function sanitizeAnalyticsRow(row = {}, { pseudonymizer, scope, trusted = false } = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return suppressedRow('INVALID_ROW');
  const output = {};
  let pseudonymId = trusted && typeof row.pseudonymId === 'string' ? row.pseudonymId.slice(0, 40) : null;
  if (!pseudonymId && pseudonymizer && scope && row.accountId) pseudonymId = pseudonymizer.pseudonymize(row.accountId, scope);
  if (pseudonymId) output.pseudonymId = pseudonymId;
  Object.entries(row).forEach(([key, value]) => {
    if (key === 'accountId' || key === 'pseudonymId' || FORBIDDEN_KEYS.has(key.toLowerCase())) return;
    if (!ALLOWED_ROW_KEYS.has(key)) return;
    const clean = sanitizeValue(value, key);
    if (clean !== undefined) output[key] = clean;
  });
  return output;
}

export function sanitizeAnalyticsRows(rows, options = {}) {
  const input = Array.isArray(rows) ? rows : [];
  const pseudonyms = new Map();
  return input.slice(0, 100).map(row => {
    const clean = sanitizeAnalyticsRow(row, options);
    if (!clean.pseudonymId) return clean;
    const previous = pseudonyms.get(clean.pseudonymId);
    const source = row?.accountId;
    if (previous && source && previous !== source && options.pseudonymizer && options.scope) {
      clean.pseudonymId = options.pseudonymizer.pseudonymizeExpanded(source, options.scope);
    } else if (source) {
      pseudonyms.set(clean.pseudonymId, source);
    }
    return clean;
  });
}

function sanitizeResponseValue(value, key = '', depth = 0) {
  if (FORBIDDEN_KEYS.has(key.toLowerCase())) return undefined;
  if (depth > 20) return undefined;
  if (value === null) return null;
  const primitive = safePrimitive(value);
  if (primitive !== undefined || value === null) return primitive;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => sanitizeResponseValue(item, '', depth + 1)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  const result = {};
  Object.entries(value).slice(0, 200).forEach(([childKey, childValue]) => {
    const clean = sanitizeResponseValue(childValue, childKey, depth + 1);
    if (clean !== undefined) result[childKey] = clean;
  });
  return result;
}

export function sanitizeAnalyticsResponse(value) {
  return sanitizeResponseValue(value) || {};
}

export { FORBIDDEN_KEYS, ALLOWED_ROW_KEYS };
