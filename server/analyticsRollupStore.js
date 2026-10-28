import { loadJson, writeJson } from './storeIO.js';

export const ROLLUP_SCHEMA_VERSION = 1;
export const DEFAULT_RETENTION_DAYS = 365;
// Hourly buckets: 31 days, so the 30 day window fits with a day of slack. Older
// files simply hold fewer buckets until they fill.
export const DEFAULT_MAX_BUCKETS = 24 * 31;

export const ALLOWED_ANALYTICS_DIMENSIONS = Object.freeze([
  'seasonId', 'rulesetRevision', 'balanceRevision', 'boardVariant', 'rulesetPreset',
  'marketComplexity', 'eventId', 'actionId', 'botMode', 'provider'
]);

export const ALLOWED_ROLLUP_KINDS = new Set([
  'match-start', 'match-complete', 'match-stalled', 'event-eligible', 'event-triggered',
  'event-choice', 'event-recovered', 'market-volatility', 'market-liquidation',
  'airport-flight', 'achievement-unlocked', 'reward-claimed', 'bot-outcome', 'bankruptcy', 'comeback'
]);

const DIMENSION_KEYS = new Set(ALLOWED_ANALYTICS_DIMENSIONS);
const BUCKET_MS = 3_600_000;
const DURATION_SAMPLE_LIMIT = 2048;
const MAX_FUTURE_SKEW_MS = 24 * 3_600_000;
const EVENT_KEYS = new Set(['kind', 'createdAt', 'id', 'data', 'pseudonymId', 'accountId', ...ALLOWED_ANALYTICS_DIMENSIONS]);
const BOARD_VARIANTS = new Set(['standard-40', 'metro-52']);
const RULESET_PRESETS = new Set(['classic', 'after-hours', 'custom']);
const MARKET_COMPLEXITIES = new Set(['basic', 'margin', 'shorting', 'derivatives']);
const BOT_MODES = new Set(['ai', 'no-ai', 'human']);
const PROVIDERS = new Set(['ai', 'deepseek', 'deterministic', 'fallback', 'house', 'openai', 'unknown']);
const PRIVATE_KEYS = new Set([
  'displayname', 'username', 'accountid', 'clientid', 'roomcode', 'chat', 'message', 'text',
  'hiddencards', 'privateloanterms', 'opponentsecrets', 'password', 'sessiontoken', 'rawpayload',
  'account_id', 'display_name', 'room_code', 'client_id', 'session_token', 'hidden_cards',
  'private_loan_terms', 'opponent_secrets', 'raw_payload', 'raw_event', 'raw_data', 'rawevent', 'rawdata'
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedNumber(value, max = 1_000_000_000) {
  return Math.max(-max, Math.min(max, finite(value)));
}

function boundedLimit(value, fallback, max) {
  return Math.max(1, Math.min(max, Math.floor(finite(value, fallback))));
}

function cleanDimension(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const cleaned = String(value).trim().replace(/[|\u0000-\u001f]/gu, '').slice(0, 80);
  // These names key plain-object maps below; `__proto__` would rewrite the map's prototype.
  return cleaned === '__proto__' ? fallback : cleaned || fallback;
}

function integerDimension(value, fallback = 0) {
  return Math.max(0, Math.min(1_000_000, Math.floor(finite(value, fallback))));
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timestamp(now, value = now()) {
  const date = parseDate(value);
  return date ? date.toISOString() : new Date(0).toISOString();
}

function bucketFor(value) {
  const date = new Date((parseDate(value) || new Date(0)).getTime());
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function bucketTime(key) {
  const date = parseDate(key);
  return date ? date.getTime() : 0;
}

function cleanData(value, depth = 0) {
  if (depth > 3) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 120);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return cleanArray(value, depth);
  return cleanRecord(value, depth);
}

function cleanArray(value, depth) {
  return value.slice(0, 100).map(item => cleanData(item, depth + 1)).filter(item => item !== undefined);
}

function cleanRecord(value, depth) {
  if (!value || typeof value !== 'object') return undefined;
  const result = {};
  Object.entries(value).slice(0, 80).forEach(([key, child]) => {
    if (PRIVATE_KEYS.has(key.toLowerCase())) return;
    const clean = cleanData(child, depth + 1);
    if (clean !== undefined) result[key] = clean;
  });
  return result;
}

function sourceDimension(event, data, name, fallback = '') {
  return cleanDimension(event?.[name] ?? data?.[name], fallback);
}

function dimensionsFor(event) {
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  return {
    seasonId: sourceDimension(event, data, 'seasonId', 'unseasoned'),
    rulesetRevision: integerDimension(event.rulesetRevision ?? data.rulesetRevision),
    balanceRevision: integerDimension(event.balanceRevision ?? data.balanceRevision),
    boardVariant: sourceDimension(event, data, 'boardVariant', 'standard-40').toLowerCase(),
    rulesetPreset: sourceDimension(event, data, 'rulesetPreset', 'classic').toLowerCase(),
    marketComplexity: sourceDimension(event, data, 'marketComplexity', 'basic').toLowerCase(),
    eventId: sourceDimension(event, data, 'eventId', ''),
    actionId: sourceDimension(event, data, 'actionId', ''),
    botMode: sourceDimension(event, data, 'botMode', ''),
    provider: sourceDimension(event, data, 'provider', '')
  };
}

function validDimensions(dimensions) {
  if (!BOARD_VARIANTS.has(dimensions.boardVariant)) return false;
  if (!RULESET_PRESETS.has(dimensions.rulesetPreset)) return false;
  if (!MARKET_COMPLEXITIES.has(dimensions.marketComplexity)) return false;
  if (dimensions.botMode && !BOT_MODES.has(dimensions.botMode)) return false;
  if (dimensions.provider && !PROVIDERS.has(dimensions.provider)) return false;
  return true;
}

export function validateAnalyticsDimensions(input = {}) {
  const dimensions = {
    boardVariant: cleanDimension(input.boardVariant, 'standard-40').toLowerCase(),
    rulesetPreset: cleanDimension(input.rulesetPreset, 'classic').toLowerCase(),
    marketComplexity: cleanDimension(input.marketComplexity, 'basic').toLowerCase(),
    botMode: cleanDimension(input.botMode, ''),
    provider: cleanDimension(input.provider, '')
  };
  return validDimensions(dimensions);
}

// The action id is not part of the key: bot decisions have one candidate id per tile or trade,
// and a row each would exhaust the bucket's dimension slots, so the bots[...].actions map counts them.
// The empty segment keeps the key layout that stored rollups already use.
function dimensionKey(dimensions) {
  return [
    dimensions.seasonId, dimensions.rulesetRevision, dimensions.balanceRevision,
    dimensions.boardVariant, dimensions.rulesetPreset, dimensions.marketComplexity,
    dimensions.eventId, '', dimensions.botMode, dimensions.provider
  ].join('|');
}

function blankDuration() {
  return { count: 0, sum: 0, values: [] };
}

const IDENTITY_TEXT_FIELDS = Object.freeze([
  ['seasonId', 'unseasoned'], ['eventId', ''], ['actionId', ''], ['botMode', ''], ['provider', '']
]);

const IDENTITY_LOWER_FIELDS = Object.freeze([
  ['boardVariant', 'standard-40'], ['rulesetPreset', 'classic'], ['marketComplexity', 'basic']
]);

function blankIdentity(dimensions) {
  const identity = {};
  IDENTITY_TEXT_FIELDS.forEach(([name, fallback]) => { identity[name] = cleanDimension(dimensions?.[name], fallback); });
  identity.rulesetRevision = integerDimension(dimensions?.rulesetRevision);
  identity.balanceRevision = integerDimension(dimensions?.balanceRevision);
  IDENTITY_LOWER_FIELDS.forEach(([name, fallback]) => { identity[name] = cleanDimension(dimensions?.[name], fallback).toLowerCase(); });
  return identity;
}

function blankMetrics() {
  return {
    started: 0,
    completed: 0,
    stalled: 0,
    botOnlyMatches: 0,
    competitiveCompleted: 0,
    durationSeconds: blankDuration(),
    reconnects: 0,
    afk: 0,
    bankruptcies: 0,
    comebacks: 0,
    features: {},
    events: {},
    market: { volatility: blankDuration(), liquidations: 0, marginPositions: 0, shortDefaults: 0, shortPositions: 0, optionExercises: 0, collateralizedOptions: 0, negativeCashPreventions: 0 },
    airportFlights: { count: 0, fareTotal: 0, byBasis: { default: 0, arrival: 0, departure: 0 } },
    achievements: {},
    competitiveAchievements: {},
    outcomes: {},
    rewardClaims: 0,
    competitiveRewardClaims: 0,
    bots: {}
  };
}

function blankDimension(dimensions) {
  return { ...blankIdentity(dimensions), ...blankMetrics() };
}

function addDuration(target, value) {
  const seconds = Math.max(0, Math.min(86400, finite(value, NaN)));
  if (!Number.isFinite(seconds)) return;
  target.count += 1;
  target.sum = boundedNumber(target.sum + seconds);
  if (target.values.length < DURATION_SAMPLE_LIMIT) {
    target.values.push(seconds);
    return;
  }
  // Reservoir sampling (algorithm R): once the sample is full, the n-th value replaces a random slot with
  // probability limit / n, so `values` stays a uniform sample of every duration seen, not just the first ones.
  const slot = Math.floor(Math.random() * target.count);
  if (slot < DURATION_SAMPLE_LIMIT) target.values[slot] = seconds;
}

// Takes `count` values spread evenly through a list. The lists it is used on are uniform random samples, so an
// evenly spaced subset is a uniform sample of them too.
function takeEvenly(values, count) {
  if (count >= values.length) return values.slice();
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => values[Math.floor((index * values.length) / count)]);
}

function featureKey(data) {
  return cleanDimension(data.feature || data.featureId || data.actionId, '');
}

function featureCounters(data) {
  return {
    eligible: data.eligible !== false ? Math.max(1, integerDimension(data.eligibleCount, 1)) : 0,
    used: data.used === true || data.adopted === true || data.legalAction === true ? Math.max(1, integerDimension(data.usedCount, 1)) : 0,
    observations: Math.max(1, integerDimension(data.observations, 1))
  };
}

function incrementFeature(target, data, limits) {
  const feature = featureKey(data);
  if (!feature) return;
  const known = Object.hasOwn(target.features, feature);
  if (!known && Object.keys(target.features).length >= limits.features) return;
  const entry = known ? target.features[feature] : { eligible: 0, used: 0, observations: 0 };
  const counters = featureCounters(data);
  entry.eligible += counters.eligible;
  entry.used += counters.used;
  entry.observations += counters.observations;
  target.features[feature] = entry;
}

function budgetedIncrement(map, key, max, count = 1) {
  const known = Object.hasOwn(map, key);
  if (!known && Object.keys(map).length >= max) return;
  map[key] = (known ? map[key] : 0) + count;
}

function blankEventEntry() {
  return { eligible: 0, warnings: 0, active: 0, choices: 0, voters: 0, recovered: 0, durationSeconds: blankDuration(), combinations: {} };
}

const EVENT_KIND_COUNTERS = Object.freeze({
  'event-eligible': (entry, data) => { entry.eligible += Math.max(1, integerDimension(data.eligibleCount, 1)); },
  'event-triggered': (entry, data) => {
    entry.active += 1;
    if (data.warning === true) entry.warnings += 1;
    addDuration(entry.durationSeconds, data.durationRounds ?? data.durationSeconds);
  },
  'event-choice': (entry, data) => {
    entry.choices += 1;
    entry.voters += Math.max(0, integerDimension(data.turnout ?? data.voters));
  },
  'event-recovered': (entry, data) => { entry.recovered += Math.max(1, integerDimension(data.recoveredCount, 1)); }
});

function applyEventCombination(entry, data, limits) {
  const combination = cleanDimension(data.combination, '');
  if (!combination) return;
  if (Object.hasOwn(entry.combinations, combination)) { entry.combinations[combination] += 1; return; }
  budgetedIncrement(entry.combinations, combination, limits.combinations);
}

function incrementEvent({ target, event, data, dimensions, limits }) {
  const id = cleanDimension(dimensions.eventId || data.eventId, 'unknown-event');
  const known = Object.hasOwn(target.events, id);
  if (!known && Object.keys(target.events).length >= limits.events) return;
  const entry = known ? target.events[id] : blankEventEntry();
  const counter = EVENT_KIND_COUNTERS[event.kind];
  if (counter) counter(entry, data);
  applyEventCombination(entry, data, limits);
  target.events[id] = entry;
}

function botIdentity(data, dimensions) {
  const mode = cleanDimension(data.botMode || dimensions.botMode, data.botOnly ? 'ai' : 'human').toLowerCase();
  const provider = cleanDimension(data.provider || dimensions.provider, 'deterministic').toLowerCase();
  return { mode, provider, key: `${mode}|${provider}` };
}

function applyBotMatches(entry, data) {
  if (data.match === true || data.matchCount !== undefined) entry.matches += Math.max(1, integerDimension(data.matchCount, 1));
}

function applyBotResults(entry, data) {
  if (data.completed === true) entry.completed += 1;
  if (data.win === true) entry.wins += 1;
  if (data.fallback === true) entry.fallback += 1;
}

function applyBotDecisions(entry, data) {
  entry.decisions += Math.max(0, integerDimension(data.decisions ?? data.actionCount));
}

function applyBotPlacement(entry, data) {
  const placement = finite(data.placement, NaN);
  if (!Number.isFinite(placement)) return;
  if (entry.placements.length >= 2048) return;
  entry.placements.push(Math.max(1, Math.floor(placement)));
}

function applyBotAction(entry, data, dimensions, limits) {
  const action = cleanDimension(data.actionId || dimensions.actionId, '');
  if (!action) return;
  budgetedIncrement(entry.actions, action, limits.actions);
}

function incrementBot({ target, data, dimensions, limits }) {
  const identity = botIdentity(data, dimensions);
  const entry = target.bots[identity.key] || { botMode: identity.mode, provider: identity.provider, matches: 0, completed: 0, wins: 0, decisions: 0, fallback: 0, placements: [], actions: {} };
  applyBotMatches(entry, data);
  applyBotResults(entry, data);
  applyBotDecisions(entry, data);
  applyBotPlacement(entry, data);
  applyBotAction(entry, data, dimensions, limits);
  target.bots[identity.key] = entry;
}

function applyOutcome(target, data, limits, count) {
  const outcome = cleanDimension(data.outcome || data.outcomeBucket, '');
  if (outcome) budgetedIncrement(target.outcomes, outcome, limits.outcomes, count);
}

function applyMatchStart({ target, count }) {
  target.started += count;
}

function applyMatchStalled({ target, count }) {
  target.stalled += count;
}

function applyMatchComplete({ target, data, limits, count }) {
  target.completed += count;
  if (data.startedMatches !== undefined) target.started = Math.max(target.started, integerDimension(data.startedMatches));
  target.competitiveCompleted += data.botOnly === true ? 0 : count;
  if (data.botOnly === true) target.botOnlyMatches += count;
  addDuration(target.durationSeconds, data.durationSeconds ?? data.duration);
  incrementFeature(target, data, limits);
  applyOutcome(target, data, limits, count);
}

function applyGovernedEvent(ctx) {
  incrementEvent(ctx);
}

function applyMarketVolatility({ target, data }) {
  addDuration(target.market.volatility, data.volatility ?? data.return ?? data.value);
  target.market.negativeCashPreventions += Math.max(0, integerDimension(data.negativeCashPreventions));
}

function applyMarketLiquidation({ target, data }) {
  target.market.liquidations += Math.max(1, integerDimension(data.count ?? data.actionCount, 1));
  target.market.marginPositions += Math.max(0, integerDimension(data.marginPositions ?? data.marginOpenPositions));
}

function applyAirportFlight({ target, data }) {
  target.airportFlights.count = boundedNumber(target.airportFlights.count + 1);
  target.airportFlights.fareTotal = boundedNumber(target.airportFlights.fareTotal + Math.max(0, finite(data.fare)));
  if (Object.hasOwn(target.airportFlights.byBasis, data.basis)) {
    target.airportFlights.byBasis[data.basis] = boundedNumber(target.airportFlights.byBasis[data.basis] + 1);
  }
}

function applyAchievementUnlocked({ target, data, limits, count }) {
  const rarity = cleanDimension(data.rarity, 'UNKNOWN').toUpperCase();
  budgetedIncrement(target.achievements, rarity, limits.achievements, count);
  if (data.botOnly !== true) budgetedIncrement(target.competitiveAchievements, rarity, limits.achievements, count);
}

function applyRewardClaimed({ target, data, count }) {
  target.rewardClaims += count;
  if (data.botOnly !== true) target.competitiveRewardClaims += count;
}

function applyBankruptcy({ target, count }) {
  target.bankruptcies += count;
}

function applyComeback({ target, count }) {
  target.comebacks += count;
}

function applyBotOutcome(ctx) {
  incrementBot(ctx);
}

const EVENT_KIND_HANDLERS = Object.freeze({
  'match-start': applyMatchStart,
  'match-stalled': applyMatchStalled,
  'match-complete': applyMatchComplete,
  'event-eligible': applyGovernedEvent,
  'event-triggered': applyGovernedEvent,
  'event-choice': applyGovernedEvent,
  'event-recovered': applyGovernedEvent,
  'airport-flight': applyAirportFlight,
  'market-volatility': applyMarketVolatility,
  'market-liquidation': applyMarketLiquidation,
  'achievement-unlocked': applyAchievementUnlocked,
  'reward-claimed': applyRewardClaimed,
  'bankruptcy': applyBankruptcy,
  'comeback': applyComeback,
  'bot-outcome': applyBotOutcome
});

function applyActivityCounters(target, data) {
  target.reconnects += Math.max(0, integerDimension(data.reconnects ?? data.reconnectCount));
  target.afk += Math.max(0, integerDimension(data.afk ?? data.afkCount));
}

function applyStandaloneFeature({ target, event, data, limits }) {
  if (event.kind === 'match-complete') return;
  if (data.feature || data.featureId) incrementFeature(target, data, limits);
}

function applyEvent(target, event, dimensions, limits) {
  const data = cleanData(event.data) || {};
  const handler = EVENT_KIND_HANDLERS[event.kind];
  if (handler) handler({ target, event, data, dimensions, limits, count: Math.max(1, integerDimension(data.count, 1)) });
  applyActivityCounters(target, data);
  applyStandaloneFeature({ target, event, data, limits });
}

function blankRollup() {
  return { schemaVersion: ROLLUP_SCHEMA_VERSION, buckets: {} };
}

function isPlainRecord(value) {
  if (!value) return false;
  if (typeof value !== 'object') return false;
  return !Array.isArray(value);
}

function isRollupBuckets(value) {
  if (Number(value.schemaVersion) !== ROLLUP_SCHEMA_VERSION) return false;
  return isPlainRecord(value.buckets);
}

function isRollupFile(value) {
  return isPlainRecord(value) && isRollupBuckets(value);
}

function ensureAirportFlightShape(dimension) {
  const stored = isPlainRecord(dimension.airportFlights) ? dimension.airportFlights : {};
  const byBasis = isPlainRecord(stored.byBasis) ? stored.byBasis : {};
  dimension.airportFlights = {
    count: Math.max(0, boundedNumber(stored.count)),
    fareTotal: Math.max(0, boundedNumber(stored.fareTotal)),
    byBasis: Object.fromEntries(['default', 'arrival', 'departure'].map(basis => [basis, Math.max(0, boundedNumber(byBasis[basis]))])),
  };
}
function ensureShape(value) {
  if (!isRollupFile(value)) return blankRollup();
  // A hand-damaged or partly written bucket must not break every later query.
  Object.keys(value.buckets).forEach((key) => {
    const bucket = value.buckets[key];
    if (!isPlainRecord(bucket)) { delete value.buckets[key]; return; }
    if (!isPlainRecord(bucket.dimensions)) bucket.dimensions = {};
    if (!isPlainRecord(bucket.actorRollups)) bucket.actorRollups = {};
    // A dimension or actor row that is not an object is damaged data: it is
    // dropped here instead of throwing in every later query.
    Object.keys(bucket.dimensions).forEach((dimensionKey) => { if (!isPlainRecord(bucket.dimensions[dimensionKey])) delete bucket.dimensions[dimensionKey]; });
    Object.keys(bucket.actorRollups).forEach((actorKey) => { if (!isPlainRecord(bucket.actorRollups[actorKey])) delete bucket.actorRollups[actorKey]; });
    Object.values(bucket.dimensions).forEach(ensureAirportFlightShape);
  });
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeNumeric(target, source, key) {
  if (Number.isFinite(Number(source?.[key]))) target[key] = boundedNumber(Number(target?.[key]) + Number(source[key]));
}

function mergeDuration(target, source) {
  if (!source || typeof source !== 'object') return;
  const targetCount = Math.max(0, Number(target?.count) || 0);
  mergeNumeric(target, source, 'count');
  mergeNumeric(target, source, 'sum');
  if (!Array.isArray(source.values)) return;
  const incoming = source.values.filter(value => Number.isFinite(Number(value)));
  const existing = Array.isArray(target.values) ? target.values : [];
  if (existing.length + incoming.length <= DURATION_SAMPLE_LIMIT) {
    target.values = [...existing, ...incoming];
    return;
  }
  // Both sides are samples of their own counts: keep each side in proportion to the durations it stands for,
  // so a long window is not summarised by its first hours only.
  const sourceCount = Math.max(incoming.length, Number(source.count) || 0);
  const share = targetCount + sourceCount > 0 ? targetCount / (targetCount + sourceCount) : 0.5;
  const fromTarget = Math.min(existing.length, Math.max(0, Math.round(DURATION_SAMPLE_LIMIT * share)));
  const fromSource = Math.min(incoming.length, DURATION_SAMPLE_LIMIT - fromTarget);
  target.values = [...takeEvenly(existing, fromTarget), ...takeEvenly(incoming, fromSource)];
}

const MERGE_NUMERIC_KEYS = [
  'started', 'completed', 'stalled', 'botOnlyMatches', 'competitiveCompleted', 'reconnects',
  'afk', 'bankruptcies', 'comebacks', 'rewardClaims', 'competitiveRewardClaims'
];

const MARKET_NUMERIC_KEYS = [
  'liquidations', 'marginPositions', 'shortDefaults', 'shortPositions', 'optionExercises',
  'collateralizedOptions', 'negativeCashPreventions'
];

const FEATURE_NUMERIC_KEYS = ['eligible', 'used', 'observations'];
const EVENT_NUMERIC_KEYS = ['eligible', 'warnings', 'active', 'choices', 'voters', 'recovered'];
const BOT_NUMERIC_KEYS = ['matches', 'completed', 'wins', 'decisions', 'fallback'];

function mergeCounters(target, source, keys) {
  keys.forEach(key => mergeNumeric(target, source, key));
}

function mergeCountMap(target, source) {
  Object.entries(source || {}).forEach(([key, count]) => {
    if (key === '__proto__') return;
    target[key] = boundedNumber((Object.hasOwn(target, key) ? finite(target[key]) : 0) + finite(count));
  });
}

function mergeFeatureEntries(target, source) {
  Object.entries(source || {}).forEach(([key, item]) => {
    if (key === '__proto__') return;
    const entry = Object.hasOwn(target, key) ? target[key] : { eligible: 0, used: 0, observations: 0 };
    mergeCounters(entry, item, FEATURE_NUMERIC_KEYS);
    target[key] = entry;
  });
}

function mergeEventEntries(target, source) {
  Object.entries(source || {}).forEach(([key, item]) => {
    if (key === '__proto__') return;
    const entry = Object.hasOwn(target, key) ? target[key] : { eligible: 0, warnings: 0, active: 0, choices: 0, voters: 0, recovered: 0, durationSeconds: blankDuration(), combinations: {} };
    mergeCounters(entry, item, EVENT_NUMERIC_KEYS);
    mergeDuration(entry.durationSeconds, item.durationSeconds);
    mergeCountMap(entry.combinations, item.combinations);
    target[key] = entry;
  });
}

function mergeBotEntries(target, source) {
  Object.entries(source || {}).forEach(([key, item]) => {
    if (key === '__proto__') return;
    const entry = Object.hasOwn(target, key) ? target[key] : { ...item, matches: 0, completed: 0, wins: 0, decisions: 0, fallback: 0, placements: [], actions: {} };
    mergeCounters(entry, item, BOT_NUMERIC_KEYS);
    entry.placements = [...(entry.placements || []), ...(item.placements || [])].slice(0, 2048);
    mergeCountMap(entry.actions, item.actions);
    target[key] = entry;
  });
}

function mergeRecord(target, source) {
  mergeCounters(target, source, MERGE_NUMERIC_KEYS);
  mergeDuration(target.durationSeconds, source.durationSeconds);
  mergeDuration(target.market.volatility, source.market?.volatility);
  mergeCounters(target.market, source.market, MARKET_NUMERIC_KEYS);
  mergeCounters(target.airportFlights, source.airportFlights, ['count', 'fareTotal']);
  ['default', 'arrival', 'departure'].forEach(basis => mergeNumeric(target.airportFlights.byBasis, source.airportFlights?.byBasis, basis));
  mergeFeatureEntries(target.features, source.features);
  mergeEventEntries(target.events, source.events);
  mergeCountMap(target.achievements, source.achievements);
  mergeCountMap(target.competitiveAchievements, source.competitiveAchievements);
  mergeCountMap(target.outcomes, source.outcomes);
  mergeBotEntries(target.bots, source.bots);
}

const RANGE_DURATIONS = Object.freeze({ hour: 3600000, day: 86400000, week: 7 * 86400000, month: 30 * 86400000 });

const ACTOR_SCOPE_DIMENSIONS = Object.freeze([
  'boardVariant', 'rulesetPreset', 'marketComplexity', 'eventId', 'actionId', 'botMode', 'provider'
]);

function revisionFilterSet(value) {
  return value !== undefined && value !== null && value !== '';
}

function filterActive(value) {
  return revisionFilterSet(value) && value !== 'all';
}

function revisionFilterMatches(filters, scope, name) {
  return !revisionFilterSet(filters[name]) || integerDimension(filters[name]) === integerDimension(scope[name]);
}

function stringFilterMatches(filters, scope, name) {
  return !filterActive(filters[name]) || cleanDimension(filters[name]).toLowerCase() === cleanDimension(scope[name]).toLowerCase();
}

function dimensionMatches(filters, dimension) {
  // A damaged entry is not a match; it must not break the whole query.
  if (!isPlainRecord(dimension)) return false;
  return ALLOWED_ANALYTICS_DIMENSIONS.every(name => {
    if (!filterActive(filters[name])) return true;
    const expected = name.endsWith('Revision') ? integerDimension(filters[name]) : cleanDimension(filters[name]).toLowerCase();
    const actual = name.endsWith('Revision') ? integerDimension(dimension[name]) : cleanDimension(dimension[name]).toLowerCase();
    return expected === actual;
  });
}

function actorMatches(filters, scope) {
  if (!isPlainRecord(scope)) return false;
  if (filterActive(filters.seasonId) && String(filters.seasonId) !== String(scope.seasonId)) return false;
  if (!revisionFilterMatches(filters, scope, 'rulesetRevision')) return false;
  if (!revisionFilterMatches(filters, scope, 'balanceRevision')) return false;
  return ACTOR_SCOPE_DIMENSIONS.every(name => stringFilterMatches(filters, scope, name));
}

function isAllowedKind(event) {
  if (!event) return false;
  if (typeof event !== 'object') return false;
  if (Array.isArray(event)) return false;
  return ALLOWED_ROLLUP_KINDS.has(String(event.kind));
}

function hasUnknownDimension(event) {
  return Object.keys(event).some(key => !EVENT_KEYS.has(key));
}

function validateEventInput(event) {
  if (!isAllowedKind(event)) return { error: 'Analytics event kind is not allowed.' };
  if (hasUnknownDimension(event)) return { error: 'Analytics event dimension is not allowed.' };
  const dimensions = dimensionsFor(event);
  if (!validDimensions(dimensions)) return { error: 'Analytics dimension value is not allowed.' };
  return { dimensions };
}

function hasDimensionSlot(bucket, key, limit) {
  return Boolean(bucket.dimensions[key]) || Object.keys(bucket.dimensions).length < limit;
}

function hasActorSlot(bucket, key, limit) {
  return Boolean(bucket.actorRollups[key]) || Object.keys(bucket.actorRollups).length < limit;
}

function actorScope(dimensions) {
  return {
    seasonId: dimensions.seasonId,
    rulesetRevision: dimensions.rulesetRevision,
    balanceRevision: dimensions.balanceRevision,
    boardVariant: dimensions.boardVariant,
    rulesetPreset: dimensions.rulesetPreset,
    marketComplexity: dimensions.marketComplexity,
    eventId: dimensions.eventId,
    actionId: '',
    botMode: dimensions.botMode,
    provider: dimensions.provider
  };
}

function mergeActorRollups(actorRollups, key, actor) {
  if (!actorRollups[key]) {
    actorRollups[key] = clone(actor);
    return;
  }
  ['observations', 'completed', 'wins'].forEach(counter => {
    actorRollups[key][counter] = boundedNumber(finite(actorRollups[key][counter]) + finite(actor[counter]));
  });
}

function bucketActivity(bucketKey, bucket, filters) {
  const point = { at: bucketKey, started: 0, completed: 0, stalled: 0 };
  Object.values(bucket.dimensions || {}).forEach((dimension) => {
    if (!dimensionMatches(filters, dimension)) return;
    point.started += Math.max(0, finite(dimension.started));
    point.completed += Math.max(0, finite(dimension.completed));
    point.stalled += Math.max(0, finite(dimension.stalled));
  });
  // A match that finished or stalled was started, even if its start row was lost.
  point.started = Math.max(point.started, point.completed + point.stalled);
  return point;
}

function collectBucket(outputDimensions, actorRollups, bucket, filters) {
  Object.entries(bucket.dimensions || {}).forEach(([key, dimension]) => {
    if (!isPlainRecord(dimension)) return;
    if (!dimensionMatches(filters, dimension)) return;
    if (!outputDimensions[key]) outputDimensions[key] = blankDimension(dimension);
    mergeRecord(outputDimensions[key], dimension);
  });
  Object.entries(bucket.actorRollups || {}).forEach(([key, actor]) => {
    if (!isPlainRecord(actor)) return;
    if (!actorMatches(filters, actor.scope || {})) return;
    mergeActorRollups(actorRollups, key, actor);
  });
}

export function createAnalyticsRollupStore({ filePath = null, now = () => Date.now(), retentionDays = DEFAULT_RETENTION_DAYS, maxBuckets = DEFAULT_MAX_BUCKETS, maxDimensionsPerBucket = 256, maxActorsPerBucket = 512, maxFeaturesPerDimension = 128, maxEventsPerDimension = 128, maxCombinationsPerEvent = 64, maxOutcomesPerDimension = 64, maxAchievementsPerDimension = 64, maxBotActionsPerDimension = 128, persist = null, pseudonymizer = null } = {}) {
  const retention = boundedLimit(retentionDays, DEFAULT_RETENTION_DAYS, 3650);
  const bucketLimit = boundedLimit(maxBuckets, DEFAULT_MAX_BUCKETS, 10000);
  const dimensionLimit = boundedLimit(maxDimensionsPerBucket, 256, 10000);
  const actorLimit = boundedLimit(maxActorsPerBucket, 512, 10000);
  const nestedLimits = {
    features: boundedLimit(maxFeaturesPerDimension, 128, 1000),
    events: boundedLimit(maxEventsPerDimension, 128, 1000),
    combinations: boundedLimit(maxCombinationsPerEvent, 64, 1000),
    outcomes: boundedLimit(maxOutcomesPerDimension, 64, 1000),
    achievements: boundedLimit(maxAchievementsPerDimension, 64, 1000),
    actions: boundedLimit(maxBotActionsPerDimension, 128, 1000)
  };
  let state = { schemaVersion: ROLLUP_SCHEMA_VERSION, buckets: {} };
  let loaded = false;
  let pendingWrites = 0;
  let rejectedEvents = 0;
  let latestAt = null;
  let sequence = 0;
  let flushInFlight = null;

  if (filePath) {
    // A file of another schema version is moved aside rather than silently
    // replaced by an empty rollup on the first flush.
    const loadedJson = loadJson(filePath, isRollupFile);
    if (loadedJson?.value) state = ensureShape(loadedJson.value);
  }
  const loadedBuckets = Object.keys(state.buckets);
  latestAt = loadedBuckets.sort((a, b) => bucketTime(b) - bucketTime(a))[0] || null;
  loaded = true;

  function recordActor(bucket, actorKey, { pseudonymId, dimensions, event }) {
    const actor = bucket.actorRollups[actorKey] || { pseudonymId, pseudonymVersion: pseudonymizer?.version || null, observations: 0, completed: 0, wins: 0, scope: actorScope(dimensions) };
    actor.observations += 1;
    if (event.kind === 'match-complete') actor.completed += 1;
    if (event.data?.win === true) actor.wins += 1;
    bucket.actorRollups[actorKey] = actor;
  }

  function queryWindow(filters) {
    const clock = parseDate(now())?.getTime() || Date.now();
    // 'season' is the retired name for the 30 day window.
    const rangeDuration = RANGE_DURATIONS[filters.range === 'season' ? 'month' : filters.range] ?? null;
    const from = parseDate(filters.from)?.getTime() ?? (rangeDuration ? clock - rangeDuration : -Infinity);
    const to = parseDate(filters.to)?.getTime() ?? clock;
    return { from, to };
  }

  function prune(options = {}) {
    const nowMs = parseDate(now())?.getTime() || Date.now();
    const cutoff = Number.isFinite(Number(options.olderThan)) ? Number(options.olderThan) : nowMs - retention * 86400000;
    let removed = 0;
    Object.keys(state.buckets).forEach(key => { if (bucketTime(key) < cutoff) { delete state.buckets[key]; removed += 1; } });
    const keys = Object.keys(state.buckets).sort((a, b) => bucketTime(a) - bucketTime(b));
    while (keys.length > bucketLimit) { delete state.buckets[keys.shift()]; removed += 1; }
    if (removed) pendingWrites += 1;
    // A quiet prune has no record to piggyback on, so it is written out here
    // so it does not wait in memory for the next event.
    if (options.flush) {
      const written = flush();
      if (isThenable(written)) return written.then(() => removed);
    }
    return removed;
  }

  // Actor rows are keyed by the pseudonym of an account within its scope. The
  // pseudonym is re-derived per scope from the account id, so an erased account
  // leaves no actor row behind. The removal is flushed before this resolves.
  async function purgeAccount(accountId) {
    const pseudonymByScope = new Map();
    let removed = 0;
    Object.values(state.buckets).forEach((bucket) => {
      Object.entries(bucket.actorRollups || {}).forEach(([actorKey, actor]) => {
        const scopeKey = JSON.stringify(actor.scope || {});
        if (!pseudonymByScope.has(scopeKey)) pseudonymByScope.set(scopeKey, pseudonymizer?.pseudonymize?.(accountId, actor.scope || {}) || null);
        const pseudonym = pseudonymByScope.get(scopeKey);
        if (!pseudonym || actor.pseudonymId !== pseudonym) return;
        delete bucket.actorRollups[actorKey];
        removed += 1;
      });
    });
    if (removed) pendingWrites += 1;
    while (pendingWrites) await flush();
    return removed;
  }

  function existingBucket(bucketKey) {
    return state.buckets[bucketKey] || { dimensions: {}, actorRollups: {} };
  }

  function slotDenial(bucket, key, pseudonymId) {
    if (!hasDimensionSlot(bucket, key, dimensionLimit)) return 'Analytics bucket dimension limit reached.';
    return null;
  }

  function commitEvent(bucket, { dimensions, key, event, pseudonymId }) {
    const aggregate = bucket.dimensions[key] || blankDimension({ ...dimensions, actionId: '' });
    applyEvent(aggregate, event, dimensions, nestedLimits);
    bucket.dimensions[key] = aggregate;
    // A full actor table only costs the actor row; the aggregate still counts.
    const actorKey = `${pseudonymId}|${key}`;
    if (pseudonymId && hasActorSlot(bucket, actorKey, actorLimit)) recordActor(bucket, actorKey, { pseudonymId, dimensions, event });
  }

  function rejectRecord(error) {
    rejectedEvents += 1;
    return { accepted: false, error };
  }

  function record(event = {}) {
    const validation = validateEventInput(event);
    if (validation.error) return rejectRecord(validation.error);
    const dimensions = validation.dimensions;
    const at = event.createdAt || now();
    // An unparseable time would be filed under 1970 and pruned at once; a far
    // future one would pin freshness forever.
    const atMs = parseDate(at)?.getTime();
    const clockMs = parseDate(now())?.getTime() || Date.now();
    if (!Number.isFinite(atMs) || atMs > clockMs + MAX_FUTURE_SKEW_MS) return rejectRecord('Analytics event time is not allowed.');
    const bucketKey = bucketFor(at);
    const bucket = existingBucket(bucketKey);
    const key = dimensionKey(dimensions);
    const pseudonymId = cleanDimension(pseudonymizer?.pseudonymize?.(event.accountId, dimensions), '');
    const denial = slotDenial(bucket, key, pseudonymId);
    if (denial) return rejectRecord(denial);
    commitEvent(bucket, { dimensions, key, event, pseudonymId });
    state.buckets[bucketKey] = bucket;
    if (!latestAt || atMs > (parseDate(latestAt)?.getTime() || 0)) latestAt = timestamp(now, at);
    prune();
    pendingWrites += 1;
    sequence += 1;
    return { accepted: true, bucketKey, sequence };
  }

  function query(filters = {}) {
    prune();
    const outputDimensions = {};
    const actorRollups = {};
    const { from, to } = queryWindow(filters);
    const series = [];
    Object.entries(state.buckets).forEach(([bucketKey, bucket]) => {
      const time = bucketTime(bucketKey);
      // A bucket covers [time, time + 1h): it is in the window when any part is.
      if (time + BUCKET_MS <= from || time > to) return;
      collectBucket(outputDimensions, actorRollups, bucket, filters);
      const activity = bucketActivity(bucketKey, bucket, filters);
      if (activity.started > 0) series.push(activity);
    });
    series.sort((a, b) => bucketTime(a.at) - bucketTime(b.at));
    const generatedAt = timestamp(now);
    const status = health();
    return {
      schemaVersion: ROLLUP_SCHEMA_VERSION,
      generatedAt,
      sourceWindow: { from: from === -Infinity ? null : new Date(from).toISOString(), to: to === Infinity ? generatedAt : new Date(to).toISOString() },
      dimensions: outputDimensions,
      actorRollups,
      // One point per stored hour inside the window that saw a match: started,
      // completed and stalled matches passing the same dimension filters as the
      // totals. Hours with no matches have no bucket, so they are simply absent.
      series,
      quality: { loaded, fresh: status.fresh, empty: status.empty, lagSeconds: status.lagSeconds, queueDepth: pendingWrites, pendingWrites, rejectedEvents, latestAt, oldestAt: oldestBucketAt() }
    };
  }

  // Start of the oldest stored hour (not limited to the query window), so a
  // caller can tell whether the data reaches back far enough for a comparison.
  function oldestBucketAt() {
    const oldest = Object.keys(state.buckets).sort((a, b) => bucketTime(a) - bucketTime(b))[0];
    return oldest ? new Date(bucketTime(oldest)).toISOString() : null;
  }

  function health() {
    const latestMs = parseDate(latestAt)?.getTime() || 0;
    const nowMs = parseDate(now())?.getTime() || Date.now();
    const lagSeconds = latestMs ? Math.max(0, Math.floor((nowMs - latestMs) / 1000)) : 0;
    // `empty` is a store that holds no bucket at all (a fresh install, or no match
    // recorded yet). That is nothing to measure, which is not the same as `fresh:
    // false` on a store that has data but has gone quiet.
    const empty = Object.keys(state.buckets).length === 0;
    return { loaded, fresh: Boolean(latestMs) && lagSeconds <= 7200, empty, lagSeconds, pendingWrites, rejectedEvents };
  }

  function isThenable(value) {
    if (!value) return false;
    return typeof value.then === 'function';
  }

  function writeSnapshot(snapshot) {
    if (persist) return persist(snapshot);
    if (filePath) return writeJson(filePath, snapshot);
    return undefined;
  }

  function trackWrite(writeResult, flushedCount) {
    flushInFlight = Promise.resolve(writeResult).then(() => {
      pendingWrites = Math.max(0, pendingWrites - flushedCount);
      flushInFlight = null;
      return { flushed: true, pendingWrites };
    }, error => {
      flushInFlight = null;
      throw error;
    });
    return flushInFlight;
  }

  function settleWrite(writeResult, flushedCount) {
    if (isThenable(writeResult)) return trackWrite(writeResult, flushedCount);
    pendingWrites = Math.max(0, pendingWrites - flushedCount);
    return { flushed: true, pendingWrites };
  }

  function flush() {
    if (flushInFlight) return flushInFlight;
    if (!pendingWrites) return { flushed: false, pendingWrites: 0 };
    const flushedCount = pendingWrites;
    const snapshot = clone({ ...state, generatedAt: timestamp(now) });
    let writeResult;
    try {
      writeResult = writeSnapshot(snapshot);
    } catch (error) {
      return Promise.reject(error);
    }
    return settleWrite(writeResult, flushedCount);
  }

  async function close() {
    while (pendingWrites) await flush();
  }

  return Object.freeze({ close, flush, health, prune, purgeAccount, query, record });
}

export { DIMENSION_KEYS, dimensionKey };
