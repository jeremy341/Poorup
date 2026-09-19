import { loadJson, writeJson } from './storeIO.js';

export const ROLLUP_SCHEMA_VERSION = 1;
export const DEFAULT_RETENTION_DAYS = 365;
export const DEFAULT_MAX_BUCKETS = 168;

export const ALLOWED_ANALYTICS_DIMENSIONS = Object.freeze([
  'seasonId', 'rulesetRevision', 'balanceRevision', 'boardVariant', 'rulesetPreset',
  'marketComplexity', 'eventId', 'actionId', 'botMode', 'provider'
]);
export const ALLOWED_DIMENSIONS = ALLOWED_ANALYTICS_DIMENSIONS;

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
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => cleanData(item, depth + 1)).filter(item => item !== undefined);
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

function blankDimension(dimensions) {
  return {
    seasonId: cleanDimension(dimensions?.seasonId, 'unseasoned'),
    rulesetRevision: integerDimension(dimensions?.rulesetRevision),
    balanceRevision: integerDimension(dimensions?.balanceRevision),
    boardVariant: cleanDimension(dimensions?.boardVariant, 'standard-40').toLowerCase(),
    rulesetPreset: cleanDimension(dimensions?.rulesetPreset, 'classic').toLowerCase(),
    marketComplexity: cleanDimension(dimensions?.marketComplexity, 'basic').toLowerCase(),
    eventId: cleanDimension(dimensions?.eventId, ''),
    actionId: cleanDimension(dimensions?.actionId, ''),
    botMode: cleanDimension(dimensions?.botMode, ''),
    provider: cleanDimension(dimensions?.provider, ''),
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

function addDuration(target, value) {
  const seconds = Math.max(0, Math.min(86400, finite(value, NaN)));
  if (!Number.isFinite(seconds)) return;
  target.count += 1;
  target.sum = boundedNumber(target.sum + seconds);
  if (target.values.length < 2048) target.values.push(seconds);
}

function incrementFeature(target, data, limits) {
  const feature = cleanDimension(data.feature || data.featureId || data.actionId, '');
  if (!feature) return;
  if (!target.features[feature] && Object.keys(target.features).length >= limits.features) return;
  const entry = target.features[feature] || { eligible: 0, used: 0, observations: 0 };
  const eligible = data.eligible !== false;
  const used = data.used === true || data.adopted === true || data.legalAction === true;
  entry.eligible += eligible ? Math.max(1, integerDimension(data.eligibleCount, 1)) : 0;
  entry.used += used ? Math.max(1, integerDimension(data.usedCount, 1)) : 0;
  entry.observations += Math.max(1, integerDimension(data.observations, 1));
  target.features[feature] = entry;
}

function incrementEvent(target, kind, data, eventId, limits) {
  const id = cleanDimension(eventId || data.eventId, 'unknown-event');
  if (!target.events[id] && Object.keys(target.events).length >= limits.events) return;
  const entry = target.events[id] || { eligible: 0, warnings: 0, active: 0, choices: 0, voters: 0, recovered: 0, durationSeconds: blankDuration(), combinations: {} };
  if (kind === 'event-eligible') entry.eligible += Math.max(1, integerDimension(data.eligibleCount, 1));
  if (kind === 'event-triggered') { entry.active += 1; if (data.warning === true) entry.warnings += 1; addDuration(entry.durationSeconds, data.durationRounds ?? data.durationSeconds); }
  if (kind === 'event-choice') { entry.choices += 1; entry.voters += Math.max(0, integerDimension(data.turnout ?? data.voters)); }
  if (kind === 'event-recovered') entry.recovered += Math.max(1, integerDimension(data.recoveredCount, 1));
  const combination = cleanDimension(data.combination, '');
  if (combination && (entry.combinations[combination] || Object.keys(entry.combinations).length < limits.combinations)) entry.combinations[combination] = (entry.combinations[combination] || 0) + 1;
  target.events[id] = entry;
}

function incrementBot(target, data, dimensions, limits) {
  const mode = cleanDimension(data.botMode || dimensions.botMode, data.botOnly ? 'ai' : 'human').toLowerCase();
  const provider = cleanDimension(data.provider || dimensions.provider, 'deterministic').toLowerCase();
  const key = `${mode}|${provider}`;
  const entry = target.bots[key] || { botMode: mode, provider, matches: 0, completed: 0, wins: 0, decisions: 0, fallback: 0, placements: [], actions: {} };
  if (data.match === true || data.matchCount !== undefined) entry.matches += Math.max(1, integerDimension(data.matchCount, 1));
  if (data.completed === true) entry.completed += 1;
  if (data.win === true) entry.wins += 1;
  entry.decisions += Math.max(0, integerDimension(data.decisions ?? data.actionCount));
  if (data.fallback === true) entry.fallback += 1;
  const placement = finite(data.placement, NaN);
  if (Number.isFinite(placement) && entry.placements.length < 2048) entry.placements.push(Math.max(1, Math.floor(placement)));
  const action = cleanDimension(data.actionId || dimensions.actionId, '');
  if (action && (entry.actions[action] || Object.keys(entry.actions).length < limits.actions)) entry.actions[action] = (entry.actions[action] || 0) + 1;
  target.bots[key] = entry;
}

function applyEvent(target, event, dimensions, limits) {
  const data = cleanData(event.data) || {};
  const count = Math.max(1, integerDimension(data.count, 1));
  if (event.kind === 'match-start') target.started += count;
  if (event.kind === 'match-complete') {
    target.completed += count;
    if (data.startedMatches !== undefined) target.started = Math.max(target.started, integerDimension(data.startedMatches));
    target.competitiveCompleted += data.botOnly === true ? 0 : count;
    if (data.botOnly === true) target.botOnlyMatches += count;
    addDuration(target.durationSeconds, data.durationSeconds ?? data.duration);
    incrementFeature(target, data, limits);
    const outcome = cleanDimension(data.outcome || data.outcomeBucket, '');
    if (outcome && (target.outcomes[outcome] || Object.keys(target.outcomes).length < limits.outcomes)) target.outcomes[outcome] = (target.outcomes[outcome] || 0) + count;
  }
  if (event.kind === 'match-stalled') {
    // A stalled match already counted its start: only the stall increments.
    target.stalled += count;
  }
  if (event.kind === 'event-eligible' || event.kind === 'event-triggered' || event.kind === 'event-choice' || event.kind === 'event-recovered') incrementEvent(target, event.kind, data, dimensions.eventId, limits);
  if (event.kind === 'market-volatility') { addDuration(target.market.volatility, data.volatility ?? data.return ?? data.value); target.market.negativeCashPreventions += Math.max(0, integerDimension(data.negativeCashPreventions)); }
  if (event.kind === 'market-liquidation') { target.market.liquidations += Math.max(1, integerDimension(data.count ?? data.actionCount, 1)); target.market.marginPositions += Math.max(0, integerDimension(data.marginPositions ?? data.marginOpenPositions)); }
  if (event.kind === 'achievement-unlocked') { const rarity = cleanDimension(data.rarity, 'UNKNOWN').toUpperCase(); if (target.achievements[rarity] || Object.keys(target.achievements).length < limits.achievements) target.achievements[rarity] = (target.achievements[rarity] || 0) + count; if (data.botOnly !== true && (target.competitiveAchievements[rarity] || Object.keys(target.competitiveAchievements).length < limits.achievements)) target.competitiveAchievements[rarity] = (target.competitiveAchievements[rarity] || 0) + count; }
  if (event.kind === 'reward-claimed') { target.rewardClaims += count; if (data.botOnly !== true) target.competitiveRewardClaims += count; }
  if (event.kind === 'bankruptcy') target.bankruptcies += count;
  if (event.kind === 'comeback') target.comebacks += count;
  if (event.kind === 'bot-outcome') incrementBot(target, data, dimensions, limits);
  target.reconnects += Math.max(0, integerDimension(data.reconnects ?? data.reconnectCount));
  target.afk += Math.max(0, integerDimension(data.afk ?? data.afkCount));
  if (event.kind !== 'match-complete' && (data.feature || data.featureId)) incrementFeature(target, data, limits);
}

function ensureShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { schemaVersion: ROLLUP_SCHEMA_VERSION, buckets: {} };
  if (Number(value.schemaVersion) !== ROLLUP_SCHEMA_VERSION || !value.buckets || typeof value.buckets !== 'object' || Array.isArray(value.buckets)) return { schemaVersion: ROLLUP_SCHEMA_VERSION, buckets: {} };
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

function mergeRecord(target, source) {
  const numeric = ['started', 'completed', 'stalled', 'botOnlyMatches', 'competitiveCompleted', 'reconnects', 'afk', 'bankruptcies', 'comebacks', 'rewardClaims', 'competitiveRewardClaims'];
  numeric.forEach(key => mergeNumeric(target, source, key));
  mergeDuration(target.durationSeconds, source.durationSeconds);
  mergeDuration(target.market.volatility, source.market?.volatility);
  ['liquidations', 'marginPositions', 'shortDefaults', 'shortPositions', 'optionExercises', 'collateralizedOptions', 'negativeCashPreventions'].forEach(key => mergeNumeric(target.market, source.market, key));
  Object.entries(source.features || {}).forEach(([key, item]) => { const entry = target.features[key] || { eligible: 0, used: 0, observations: 0 }; ['eligible', 'used', 'observations'].forEach(counter => mergeNumeric(entry, item, counter)); target.features[key] = entry; });
  Object.entries(source.events || {}).forEach(([key, item]) => { const entry = target.events[key] || { eligible: 0, warnings: 0, active: 0, choices: 0, voters: 0, recovered: 0, durationSeconds: blankDuration(), combinations: {} }; ['eligible', 'warnings', 'active', 'choices', 'voters', 'recovered'].forEach(counter => mergeNumeric(entry, item, counter)); mergeDuration(entry.durationSeconds, item.durationSeconds); Object.entries(item.combinations || {}).forEach(([combo, count]) => { entry.combinations[combo] = boundedNumber((entry.combinations[combo] || 0) + finite(count)); }); target.events[key] = entry; });
  Object.entries(source.achievements || {}).forEach(([key, count]) => { target.achievements[key] = boundedNumber((target.achievements[key] || 0) + finite(count)); });
  Object.entries(source.competitiveAchievements || {}).forEach(([key, count]) => { target.competitiveAchievements[key] = boundedNumber((target.competitiveAchievements[key] || 0) + finite(count)); });
  Object.entries(source.outcomes || {}).forEach(([key, count]) => { target.outcomes[key] = boundedNumber((target.outcomes[key] || 0) + finite(count)); });
  Object.entries(source.bots || {}).forEach(([key, item]) => { const entry = target.bots[key] || { ...item, matches: 0, completed: 0, wins: 0, decisions: 0, fallback: 0, placements: [], actions: {} }; ['matches', 'completed', 'wins', 'decisions', 'fallback'].forEach(counter => mergeNumeric(entry, item, counter)); entry.placements = [...(entry.placements || []), ...(item.placements || [])].slice(0, 2048); Object.entries(item.actions || {}).forEach(([action, count]) => { entry.actions[action] = boundedNumber((entry.actions[action] || 0) + finite(count)); }); target.bots[key] = entry; });
}

export function createAnalyticsRollupStore({ filePath = null, now = () => Date.now(), retentionDays = DEFAULT_RETENTION_DAYS, maxBuckets = DEFAULT_MAX_BUCKETS, maxDimensionsPerBucket = 256, maxActorsPerBucket = 512, maxFeaturesPerDimension = 128, maxEventsPerDimension = 128, maxCombinationsPerEvent = 64, maxOutcomesPerDimension = 64, maxAchievementsPerDimension = 64, maxBotActionsPerDimension = 128, persist = null, pseudonymizer = null } = {}) {
  const retention = Math.max(1, Math.min(3650, Math.floor(finite(retentionDays, DEFAULT_RETENTION_DAYS))));
  const bucketLimit = Math.max(1, Math.min(10000, Math.floor(finite(maxBuckets, DEFAULT_MAX_BUCKETS))));
  const dimensionLimit = Math.max(1, Math.min(10000, Math.floor(finite(maxDimensionsPerBucket, 256))));
  const actorLimit = Math.max(1, Math.min(10000, Math.floor(finite(maxActorsPerBucket, 512))));
  const nestedLimits = {
    features: Math.max(1, Math.min(1000, Math.floor(finite(maxFeaturesPerDimension, 128)))),
    events: Math.max(1, Math.min(1000, Math.floor(finite(maxEventsPerDimension, 128)))),
    combinations: Math.max(1, Math.min(1000, Math.floor(finite(maxCombinationsPerEvent, 64)))),
    outcomes: Math.max(1, Math.min(1000, Math.floor(finite(maxOutcomesPerDimension, 64)))),
    achievements: Math.max(1, Math.min(1000, Math.floor(finite(maxAchievementsPerDimension, 64)))),
    actions: Math.max(1, Math.min(1000, Math.floor(finite(maxBotActionsPerDimension, 128))))
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

  function record(event = {}) {
    if (!event || typeof event !== 'object' || Array.isArray(event) || !ALLOWED_ROLLUP_KINDS.has(String(event.kind))) { rejectedEvents += 1; return { accepted: false, error: 'Analytics event kind is not allowed.' }; }
    const unknown = Object.keys(event).some(key => !EVENT_KEYS.has(key));
    if (unknown) { rejectedEvents += 1; return { accepted: false, error: 'Analytics event dimension is not allowed.' }; }
    const dimensions = dimensionsFor(event);
    if (!validDimensions(dimensions)) { rejectedEvents += 1; return { accepted: false, error: 'Analytics dimension value is not allowed.' }; }
    const bucketKey = bucketFor(event.createdAt || now());
    const bucket = state.buckets[bucketKey] || { dimensions: {}, actorRollups: {} };
    const key = dimensionKey(dimensions);
    if (!bucket.dimensions[key] && Object.keys(bucket.dimensions).length >= dimensionLimit) { rejectedEvents += 1; return { accepted: false, error: 'Analytics bucket dimension limit reached.' }; }
    const pseudonymId = cleanDimension(pseudonymizer?.pseudonymize?.(event.accountId, dimensions), '');
    if (pseudonymId && !bucket.actorRollups[pseudonymId] && Object.keys(bucket.actorRollups).length >= actorLimit) { rejectedEvents += 1; return { accepted: false, error: 'Analytics actor limit reached.' }; }
    const aggregate = bucket.dimensions[key] || blankDimension(dimensions);
    applyEvent(aggregate, event, dimensions, nestedLimits);
    bucket.dimensions[key] = aggregate;
    if (pseudonymId) {
      const actorKey = `${pseudonymId}|${dimensionKey(dimensions)}`;
      const actor = bucket.actorRollups[actorKey] || { pseudonymId, pseudonymVersion: pseudonymizer?.version || null, observations: 0, completed: 0, wins: 0, scope: { seasonId: dimensions.seasonId, rulesetRevision: dimensions.rulesetRevision, balanceRevision: dimensions.balanceRevision, boardVariant: dimensions.boardVariant, rulesetPreset: dimensions.rulesetPreset, marketComplexity: dimensions.marketComplexity, eventId: dimensions.eventId, actionId: dimensions.actionId, botMode: dimensions.botMode, provider: dimensions.provider } };
      actor.observations += 1;
      if (event.kind === 'match-complete') actor.completed += 1;
      if (event.data?.win === true) actor.wins += 1;
      bucket.actorRollups[actorKey] = actor;
    }
    state.buckets[bucketKey] = bucket;
    latestAt = timestamp(now, event.createdAt || now());
    prune();
    pendingWrites += 1;
    sequence += 1;
    return { accepted: true, bucketKey, sequence };
  }

  function query(filters = {}) {
    prune();
    const outputDimensions = {};
    const actorRollups = {};
    const clock = parseDate(now())?.getTime() || Date.now();
    const rangeDuration = filters.range === 'hour' ? 3600000 : filters.range === 'day' ? 86400000 : filters.range === 'week' ? 7 * 86400000 : null;
    const from = parseDate(filters.from)?.getTime() ?? (rangeDuration ? clock - rangeDuration : -Infinity);
    const to = parseDate(filters.to)?.getTime() ?? clock;
    const matchDimension = (dimension) => ALLOWED_ANALYTICS_DIMENSIONS.every(name => {
      if (filters[name] === undefined || filters[name] === null || filters[name] === '' || filters[name] === 'all') return true;
      const expected = name.endsWith('Revision') ? integerDimension(filters[name]) : cleanDimension(filters[name]).toLowerCase();
      const actual = name.endsWith('Revision') ? integerDimension(dimension[name]) : cleanDimension(dimension[name]).toLowerCase();
      return expected === actual;
    });
    Object.entries(state.buckets).forEach(([bucketKey, bucket]) => {
      const time = bucketTime(bucketKey);
      if (time < from || time > to) return;
      Object.entries(bucket.dimensions || {}).forEach(([key, dimension]) => {
        if (!matchDimension(dimension)) return;
        if (!outputDimensions[key]) outputDimensions[key] = blankDimension(dimension);
        mergeRecord(outputDimensions[key], dimension);
      });
      Object.entries(bucket.actorRollups || {}).forEach(([key, actor]) => {
        const scope = actor.scope || {};
        if (filters.seasonId && filters.seasonId !== 'all' && String(filters.seasonId) !== String(scope.seasonId)) return;
        if (filters.rulesetRevision !== undefined && filters.rulesetRevision !== null && filters.rulesetRevision !== '' && integerDimension(filters.rulesetRevision) !== integerDimension(scope.rulesetRevision)) return;
        if (filters.balanceRevision !== undefined && filters.balanceRevision !== null && filters.balanceRevision !== '' && integerDimension(filters.balanceRevision) !== integerDimension(scope.balanceRevision)) return;
        for (const name of ['boardVariant', 'rulesetPreset', 'marketComplexity', 'eventId', 'actionId', 'botMode', 'provider']) {
          if (filters[name] !== undefined && filters[name] !== null && filters[name] !== '' && filters[name] !== 'all' && cleanDimension(filters[name]).toLowerCase() !== cleanDimension(scope[name]).toLowerCase()) return;
        }
        if (!actorRollups[key]) actorRollups[key] = clone(actor);
        else { ['observations', 'completed', 'wins'].forEach(counter => { actorRollups[key][counter] = boundedNumber(finite(actorRollups[key][counter]) + finite(actor[counter])); }); }
      });
    });
    const generatedAt = timestamp(now);
    return {
      schemaVersion: ROLLUP_SCHEMA_VERSION,
      generatedAt,
      sourceWindow: { from: from === -Infinity ? null : new Date(from).toISOString(), to: to === Infinity ? generatedAt : new Date(to).toISOString() },
      dimensions: outputDimensions,
      actorRollups,
      quality: { loaded, fresh: health().fresh, lagSeconds: health().lagSeconds, queueDepth: pendingWrites, pendingWrites, rejectedEvents, latestAt }
    };
  }

  function health() {
    const latestMs = parseDate(latestAt)?.getTime() || 0;
    const nowMs = parseDate(now())?.getTime() || Date.now();
    const lagSeconds = latestMs ? Math.max(0, Math.floor((nowMs - latestMs) / 1000)) : 0;
    return { loaded, fresh: Boolean(latestMs) && lagSeconds <= 7200, lagSeconds, pendingWrites, rejectedEvents };
  }

  function flush() {
    if (flushInFlight) return flushInFlight;
    if (!pendingWrites) return { flushed: false, pendingWrites: 0 };
    const flushedCount = pendingWrites;
    const snapshot = clone({ ...state, generatedAt: timestamp(now) });
    let writeResult;
    try {
      writeResult = persist ? persist(snapshot) : filePath ? writeJson(filePath, snapshot) : undefined;
    } catch (error) {
      return Promise.reject(error);
    }
    if (writeResult && typeof writeResult.then === 'function') {
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
    pendingWrites = Math.max(0, pendingWrites - flushedCount);
    return { flushed: true, pendingWrites };
  }

  async function close() {
    while (pendingWrites) await flush();
  }

  return Object.freeze({ close, flush, health, prune, query, record });
}

export { DIMENSION_KEYS, dimensionKey };
