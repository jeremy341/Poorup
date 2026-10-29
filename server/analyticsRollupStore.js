import { loadJson, writeJson } from './storeIO.js';

export const ROLLUP_SCHEMA_VERSION = 1;
export const DEFAULT_RETENTION_DAYS = 365;
export const DEFAULT_MAX_BUCKETS = 168;

export const ALLOWED_ANALYTICS_DIMENSIONS = Object.freeze([
  'seasonId', 'rulesetRevision', 'balanceRevision', 'boardVariant', 'rulesetPreset',
  'marketComplexity', 'eventId', 'actionId', 'botMode', 'provider'
]);

export const ALLOWED_ROLLUP_KINDS = new Set([
  'match-start', 'match-complete', 'match-stalled', 'event-eligible', 'event-triggered',
  'event-choice', 'event-recovered', 'market-volatility', 'market-liquidation',
  'achievement-unlocked', 'reward-claimed', 'bot-outcome', 'bankruptcy', 'comeback'
]);

const DIMENSION_KEYS = new Set(ALLOWED_ANALYTICS_DIMENSIONS);
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
  return String(value).trim().replace(/[|\u0000-\u001f]/gu, '').slice(0, 80) || fallback;
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
  const date = parseDate(value) || new Date(0);
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

function dimensionKey(dimensions) {
  return [
    dimensions.seasonId, dimensions.rulesetRevision, dimensions.balanceRevision,
    dimensions.boardVariant, dimensions.rulesetPreset, dimensions.marketComplexity,
    dimensions.eventId, dimensions.actionId, dimensions.botMode, dimensions.provider
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
  if (target.values.length < 2048) target.values.push(seconds);
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
  const known = Boolean(target.features[feature]);
  if (!known && Object.keys(target.features).length >= limits.features) return;
  const entry = target.features[feature] || { eligible: 0, used: 0, observations: 0 };
  const counters = featureCounters(data);
  entry.eligible += counters.eligible;
  entry.used += counters.used;
  entry.observations += counters.observations;
  target.features[feature] = entry;
}

function budgetedIncrement(map, key, max, count = 1) {
  const known = Boolean(map[key]);
  if (!known && Object.keys(map).length >= max) return;
  map[key] = (map[key] || 0) + count;
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
  if (entry.combinations[combination]) { entry.combinations[combination] += 1; return; }
  budgetedIncrement(entry.combinations, combination, limits.combinations);
}

function incrementEvent({ target, event, data, dimensions, limits }) {
  const id = cleanDimension(dimensions.eventId || data.eventId, 'unknown-event');
  const known = Boolean(target.events[id]);
  if (!known && Object.keys(target.events).length >= limits.events) return;
  const entry = target.events[id] || blankEventEntry();
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

function ensureShape(value) {
  if (!isPlainRecord(value)) return blankRollup();
  if (!isRollupBuckets(value)) return blankRollup();
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
  mergeNumeric(target, source, 'count');
  mergeNumeric(target, source, 'sum');
  if (Array.isArray(source.values)) target.values = [...(target.values || []), ...source.values.filter(value => Number.isFinite(Number(value))).slice(0, Math.max(0, 2048 - (target.values || []).length))];
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
    target[key] = boundedNumber((target[key] || 0) + finite(count));
  });
}

function mergeFeatureEntries(target, source) {
  Object.entries(source || {}).forEach(([key, item]) => {
    const entry = target[key] || { eligible: 0, used: 0, observations: 0 };
    mergeCounters(entry, item, FEATURE_NUMERIC_KEYS);
    target[key] = entry;
  });
}

function mergeEventEntries(target, source) {
  Object.entries(source || {}).forEach(([key, item]) => {
    const entry = target[key] || { eligible: 0, warnings: 0, active: 0, choices: 0, voters: 0, recovered: 0, durationSeconds: blankDuration(), combinations: {} };
    mergeCounters(entry, item, EVENT_NUMERIC_KEYS);
    mergeDuration(entry.durationSeconds, item.durationSeconds);
    mergeCountMap(entry.combinations, item.combinations);
    target[key] = entry;
  });
}

function mergeBotEntries(target, source) {
  Object.entries(source || {}).forEach(([key, item]) => {
    const entry = target[key] || { ...item, matches: 0, completed: 0, wins: 0, decisions: 0, fallback: 0, placements: [], actions: {} };
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
  mergeFeatureEntries(target.features, source.features);
  mergeEventEntries(target.events, source.events);
  mergeCountMap(target.achievements, source.achievements);
  mergeCountMap(target.competitiveAchievements, source.competitiveAchievements);
  mergeCountMap(target.outcomes, source.outcomes);
  mergeBotEntries(target.bots, source.bots);
}

const RANGE_DURATIONS = Object.freeze({ hour: 3600000, day: 86400000, week: 7 * 86400000 });

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
  return ALLOWED_ANALYTICS_DIMENSIONS.every(name => {
    if (!filterActive(filters[name])) return true;
    const expected = name.endsWith('Revision') ? integerDimension(filters[name]) : cleanDimension(filters[name]).toLowerCase();
    const actual = name.endsWith('Revision') ? integerDimension(dimension[name]) : cleanDimension(dimension[name]).toLowerCase();
    return expected === actual;
  });
}

function actorMatches(filters, scope) {
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
    actionId: dimensions.actionId,
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

function collectBucket(outputDimensions, actorRollups, bucket, filters) {
  Object.entries(bucket.dimensions || {}).forEach(([key, dimension]) => {
    if (!dimensionMatches(filters, dimension)) return;
    if (!outputDimensions[key]) outputDimensions[key] = blankDimension(dimension);
    mergeRecord(outputDimensions[key], dimension);
  });
  Object.entries(bucket.actorRollups || {}).forEach(([key, actor]) => {
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
    const loadedJson = loadJson(filePath, value => value && typeof value === 'object' && !Array.isArray(value));
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
    const rangeDuration = RANGE_DURATIONS[filters.range] ?? null;
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
    return removed;
  }

  function existingBucket(bucketKey) {
    return state.buckets[bucketKey] || { dimensions: {}, actorRollups: {} };
  }

  function slotDenial(bucket, key, pseudonymId) {
    if (!hasDimensionSlot(bucket, key, dimensionLimit)) return 'Analytics bucket dimension limit reached.';
    const actorKey = `${pseudonymId}|${key}`;
    if (pseudonymId && !hasActorSlot(bucket, actorKey, actorLimit)) return 'Analytics actor limit reached.';
    return null;
  }

  function commitEvent(bucket, { dimensions, key, event, pseudonymId }) {
    const aggregate = bucket.dimensions[key] || blankDimension(dimensions);
    applyEvent(aggregate, event, dimensions, nestedLimits);
    bucket.dimensions[key] = aggregate;
    if (pseudonymId) recordActor(bucket, `${pseudonymId}|${key}`, { pseudonymId, dimensions, event });
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
    const bucketKey = bucketFor(at);
    const bucket = existingBucket(bucketKey);
    const key = dimensionKey(dimensions);
    const pseudonymId = cleanDimension(pseudonymizer?.pseudonymize?.(event.accountId, dimensions), '');
    const denial = slotDenial(bucket, key, pseudonymId);
    if (denial) return rejectRecord(denial);
    commitEvent(bucket, { dimensions, key, event, pseudonymId });
    state.buckets[bucketKey] = bucket;
    latestAt = timestamp(now, at);
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
    Object.entries(state.buckets).forEach(([bucketKey, bucket]) => {
      const time = bucketTime(bucketKey);
      if (time < from || time > to) return;
      collectBucket(outputDimensions, actorRollups, bucket, filters);
    });
    const generatedAt = timestamp(now);
    const status = health();
    return {
      schemaVersion: ROLLUP_SCHEMA_VERSION,
      generatedAt,
      sourceWindow: { from: from === -Infinity ? null : new Date(from).toISOString(), to: to === Infinity ? generatedAt : new Date(to).toISOString() },
      dimensions: outputDimensions,
      actorRollups,
      quality: { loaded, fresh: status.fresh, lagSeconds: status.lagSeconds, queueDepth: pendingWrites, pendingWrites, rejectedEvents, latestAt }
    };
  }

  function health() {
    const latestMs = parseDate(latestAt)?.getTime() || 0;
    const nowMs = parseDate(now())?.getTime() || Date.now();
    const lagSeconds = latestMs ? Math.max(0, Math.floor((nowMs - latestMs) / 1000)) : 0;
    return { loaded, fresh: Boolean(latestMs) && lagSeconds <= 7200, lagSeconds, pendingWrites, rejectedEvents };
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

  return Object.freeze({ close, flush, health, prune, query, record });
}

export { DIMENSION_KEYS, dimensionKey };
