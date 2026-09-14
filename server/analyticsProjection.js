import { MIN_COHORT, suppressedRow } from './analyticsPrivacy.js';

const RANGES = new Set(['hour', 'day', 'week', 'season']);
const TABS = new Set(['overview', 'match-health', 'rulesets', 'economy', 'events', 'bots', 'quality']);
const BOARDS = new Set(['all', 'standard-40', 'metro-52']);
const RULESETS = new Set(['all', 'classic', 'after-hours', 'custom']);
const MARKETS = new Set(['all', 'basic', 'margin', 'shorting', 'derivatives']);
const BOT_MODES = new Set(['all', 'ai', 'no-ai', 'human']);
const PROVIDERS = new Set(['all', 'ai', 'deepseek', 'deterministic', 'fallback', 'house', 'openai', 'unknown']);

function stringValue(value, fallback = '') {
  return value === null || value === undefined ? fallback : String(value).trim().slice(0, 120);
}

function enumValue(value, allowed, fallback) {
  const normalized = stringValue(value, fallback).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function revision(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(1_000_000, Math.floor(number)) : null;
}

function dateValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateWindow(range, from, to) {
  const explicitFrom = dateValue(from);
  const explicitTo = dateValue(to);
  if (explicitFrom || explicitTo) return { from: explicitFrom, to: explicitTo };
  // The storage seam owns the clock. Leaving omitted bounds open here keeps
  // deterministic projections/test fixtures from being filtered against the
  // wall clock of a different process.
  return { from: null, to: null };
}

export function normalizeAnalyticsQuery(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const range = enumValue(source.range, RANGES, 'hour');
  const window = dateWindow(range, source.from, source.to);
  const eventId = stringValue(source.eventId, '').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80);
  const tab = enumValue(source.tab, TABS, 'overview');
  return {
    range,
    from: window.from,
    to: window.to,
    seasonId: stringValue(source.seasonId, '').replace(/[|\u0000-\u001f]/gu, '').slice(0, 80),
    rulesetRevision: revision(source.rulesetRevision),
    balanceRevision: revision(source.balanceRevision),
    boardVariant: enumValue(source.boardVariant, BOARDS, 'all'),
    rulesetPreset: enumValue(source.rulesetPreset, RULESETS, 'all'),
    marketComplexity: enumValue(source.marketComplexity, MARKETS, 'all'),
    botMode: enumValue(source.botMode, BOT_MODES, 'all'),
    provider: enumValue(source.provider, PROVIDERS, 'all'),
    eventId,
    dimension: enumValue(source.dimension, new Set(['feature', 'ruleset', 'board', 'event', 'bot']), ''),
    metric: stringValue(source.metric, '').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80),
    tab,
    minimumCohort: MIN_COHORT
  };
}

function number(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function sumValues(items, key) {
  return items.reduce((total, item) => total + Math.max(0, number(item?.[key])), 0);
}

function durationValues(duration) {
  if (!duration || typeof duration !== 'object') return [];
  if (Array.isArray(duration.values)) return duration.values.map(value => number(value)).filter(value => Number.isFinite(value)).sort((a, b) => a - b).slice(0, 4096);
  if (Array.isArray(duration.samples)) return duration.samples.map(value => number(value)).filter(value => Number.isFinite(value)).sort((a, b) => a - b).slice(0, 4096);
  if (duration.histogram && typeof duration.histogram === 'object') {
    const values = [];
    Object.entries(duration.histogram).sort((a, b) => number(a[0]) - number(b[0])).forEach(([bucket, count]) => {
      const repeats = Math.min(4096 - values.length, Math.max(0, Math.floor(number(count))));
      for (let index = 0; index < repeats; index += 1) values.push(number(bucket));
    });
    return values;
  }
  return [];
}

function percentile(duration, p) {
  const values = durationValues(duration);
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
  return values[index];
}

function median(duration) {
  const values = durationValues(duration);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function measure(numerator, denominator, extra = {}) {
  const n = Math.max(0, number(numerator));
  const d = Math.max(0, number(denominator));
  return { value: d ? n / d : null, numerator: n, denominator: d, ...extra };
}

function valueMeasure(value, denominator = null, extra = {}) {
  const n = number(value, NaN);
  return { value: Number.isFinite(n) ? n : null, ...(denominator === null ? {} : { denominator: Math.max(0, number(denominator)) }), ...extra };
}

function dimensionFromKey(key) {
  const parts = String(key || '').split('|');
  return { seasonId: parts[0] || 'unseasoned', rulesetRevision: number(parts[1]), balanceRevision: number(parts[2]), boardVariant: parts[3] || 'standard-40', rulesetPreset: parts[4] || 'classic', marketComplexity: parts[5] || 'basic', eventId: parts[6] || '', actionId: parts[7] || '', botMode: parts[8] || '', provider: parts[9] || '' };
}

function rollupSnapshot(rollup, query) {
  if (!rollup) return { dimensions: {}, actorRollups: {}, quality: {}, generatedAt: new Date(0).toISOString() };
  if (typeof rollup.query === 'function') {
    const result = rollup.query(query);
    return result && typeof result === 'object' ? result : { dimensions: {}, actorRollups: {}, quality: {} };
  }
  return rollup;
}

function dimensionsOf(snapshot) {
  const source = snapshot?.dimensions;
  if (Array.isArray(source)) return source.map((item, index) => ({ key: item?.dimensionKey || String(index), value: item, dimensions: item }));
  if (!source || typeof source !== 'object') return [];
  return Object.entries(source).map(([key, value]) => ({ key, value: value || {}, dimensions: { ...dimensionFromKey(key), ...(value || {}) } }));
}

function matchesQuery(dimensions, query) {
  const equal = (expected, actual) => !expected || expected === 'all' || String(expected).toLowerCase() === String(actual || '').toLowerCase();
  return equal(query.seasonId, dimensions.seasonId)
    && (query.rulesetRevision === null || number(query.rulesetRevision) === number(dimensions.rulesetRevision))
    && (query.balanceRevision === null || number(query.balanceRevision) === number(dimensions.balanceRevision))
    && equal(query.boardVariant, dimensions.boardVariant)
    && equal(query.rulesetPreset, dimensions.rulesetPreset)
    && equal(query.marketComplexity, dimensions.marketComplexity)
    && equal(query.eventId, dimensions.eventId)
    && equal(query.botMode, dimensions.botMode)
    && equal(query.provider, dimensions.provider);
}

function selectedDimensions(rollup, query) {
  const snapshot = rollupSnapshot(rollup, query);
  return { snapshot, entries: dimensionsOf(snapshot).filter(entry => matchesQuery(entry.dimensions, query)) };
}

function aggregate(entries) {
  const result = { started: 0, completed: 0, stalled: 0, botOnlyMatches: 0, competitiveCompleted: 0, competitiveSeen: false, competitiveRewardClaims: 0, competitiveRewardSeen: false, reconnects: 0, afk: 0, bankruptcies: 0, comebacks: 0, rewardClaims: 0, durationSeconds: { count: 0, sum: 0, values: [] }, features: {}, events: {}, market: { volatility: { count: 0, sum: 0, values: [] }, liquidations: 0, marginPositions: 0, shortDefaults: 0, shortPositions: 0, optionExercises: 0, collateralizedOptions: 0, negativeCashPreventions: 0 }, achievements: {}, competitiveAchievements: {}, bots: {} };
  const addDuration = (target, value) => { if (!value || typeof value !== 'object') return; target.count += Math.max(0, number(value.count)); target.sum += number(value.sum); if (Array.isArray(value.values)) target.values.push(...value.values.slice(0, 4096 - target.values.length).map(number)); };
  entries.forEach(({ value }) => {
    ['started', 'completed', 'stalled', 'botOnlyMatches', 'reconnects', 'afk', 'bankruptcies', 'comebacks', 'rewardClaims'].forEach(key => { result[key] += Math.max(0, number(value[key])); });
    if (Object.hasOwn(value, 'competitiveCompleted')) { result.competitiveSeen = true; result.competitiveCompleted += Math.max(0, number(value.competitiveCompleted)); }
    if (Object.hasOwn(value, 'competitiveRewardClaims')) { result.competitiveRewardSeen = true; result.competitiveRewardClaims += Math.max(0, number(value.competitiveRewardClaims)); }
    addDuration(result.durationSeconds, value.durationSeconds);
    addDuration(result.market.volatility, value.market?.volatility);
    ['liquidations', 'marginPositions', 'shortDefaults', 'shortPositions', 'optionExercises', 'collateralizedOptions', 'negativeCashPreventions'].forEach(key => { result.market[key] += Math.max(0, number(value.market?.[key])); });
    Object.entries(value.features || {}).forEach(([key, feature]) => { const item = result.features[key] || { eligible: 0, used: 0, observations: 0 }; ['eligible', 'used', 'observations'].forEach(counter => { item[counter] += Math.max(0, number(feature?.[counter])); }); result.features[key] = item; });
    Object.entries(value.events || {}).forEach(([key, event]) => { const item = result.events[key] || { eligible: 0, warnings: 0, active: 0, choices: 0, voters: 0, recovered: 0, durationSeconds: { count: 0, sum: 0, values: [] }, combinations: {} }; ['eligible', 'warnings', 'active', 'choices', 'voters', 'recovered'].forEach(counter => { item[counter] += Math.max(0, number(event?.[counter])); }); addDuration(item.durationSeconds, event.durationSeconds); Object.entries(event.combinations || {}).forEach(([combo, count]) => { item.combinations[combo] = (item.combinations[combo] || 0) + Math.max(0, number(count)); }); result.events[key] = item; });
    Object.entries(value.achievements || {}).forEach(([rarity, count]) => { result.achievements[rarity] = (result.achievements[rarity] || 0) + Math.max(0, number(count)); });
    Object.entries(value.competitiveAchievements || {}).forEach(([rarity, count]) => { result.competitiveAchievements[rarity] = (result.competitiveAchievements[rarity] || 0) + Math.max(0, number(count)); });
    Object.entries(value.bots || {}).forEach(([key, bot]) => { const item = result.bots[key] || { botMode: bot.botMode, provider: bot.provider, matches: 0, completed: 0, wins: 0, decisions: 0, fallback: 0, placements: [], actions: {} }; ['matches', 'completed', 'wins', 'decisions', 'fallback'].forEach(counter => { item[counter] += Math.max(0, number(bot?.[counter])); }); if (Array.isArray(bot.placements)) item.placements.push(...bot.placements.slice(0, 4096 - item.placements.length).map(number)); Object.entries(bot.actions || {}).forEach(([action, count]) => { item.actions[action] = (item.actions[action] || 0) + Math.max(0, number(count)); }); result.bots[key] = item; });
  });
  if (!result.competitiveSeen) result.competitiveCompleted = Math.max(0, result.completed - result.botOnlyMatches);
  if (!result.competitiveRewardSeen) result.competitiveRewardClaims = result.competitiveCompleted > 0 ? result.rewardClaims : 0;
  return result;
}

function startedCount(data) { return Math.max(0, number(data?.started), number(data?.completed) + number(data?.stalled)); }

function generated(snapshot) { return typeof snapshot?.generatedAt === 'string' ? snapshot.generatedAt : new Date().toISOString(); }

function kpi(id, label, value, denominator, definition, comparison = null) {
  return { id, label, value, denominator, comparison, generatedAt: null, definition };
}

export function buildOverview(rollup, queryInput = {}) {
  const query = normalizeAnalyticsQuery(queryInput);
  const { snapshot, entries } = selectedDimensions(rollup, query);
  const data = aggregate(entries);
  const features = Object.entries(data.features);
  const feature = features[0]?.[1];
  const fallbackDecisions = sumValues(Object.values(data.bots), 'decisions');
  const fallbackCount = sumValues(Object.values(data.bots), 'fallback');
  const activeRooms = number(snapshot?.quality?.activeRooms ?? snapshot?.activeRooms, NaN);
  const kpis = [
    kpi('completed-rounds', 'Completed rounds', data.completed, startedCount(data), 'Verified server settlements; denominator is started matches.', { started: startedCount(data), stalled: data.stalled }),
    kpi('completion-rate', 'Completion rate', measure(data.completed, startedCount(data)).value, startedCount(data), 'Completed matches divided by started matches.', { stalled: data.stalled }),
    kpi('median-round-duration', 'Median round duration', median(data.durationSeconds), data.durationSeconds.count, 'Median seconds from verified server timestamps for completed rounds.', { p95: percentile(data.durationSeconds, 0.95) }),
    kpi('active-rooms', 'Active rooms', Number.isFinite(activeRooms) ? activeRooms : null, null, 'Current live room gauge from the metrics registry.', { source: Number.isFinite(activeRooms) ? 'live-metrics' : 'rollup' }),
    kpi('feature-adoption', 'Feature adoption', feature ? measure(feature.used, feature.eligible).value : null, feature?.eligible || 0, 'Legal feature actions divided by eligible completed rounds.', { feature: features[0]?.[0] || null }),
    kpi('bot-fallback-rate', 'Bot fallback rate', measure(fallbackCount, fallbackDecisions).value, fallbackDecisions, 'Fallback decisions divided by AI decisions.', { fallback: fallbackCount })
  ].map(item => ({ ...item, generatedAt: generated(snapshot) }));
  return { kpis, cards: kpis, generatedAt: generated(snapshot), filters: query };
}

export function buildMatchHealth(rollup, queryInput = {}) {
  const query = normalizeAnalyticsQuery(queryInput); const { snapshot, entries } = selectedDimensions(rollup, query); const data = aggregate(entries);
  const started = startedCount(data);
  return { starts: started, completions: data.completed, stalls: data.stalled, startedMatches: started, completedMatches: data.completed, stalledMatches: data.stalled, completionRate: measure(data.completed, started), durationMedian: valueMeasure(median(data.durationSeconds), data.durationSeconds.count, { sampleSize: data.durationSeconds.count }), durationP95: valueMeasure(percentile(data.durationSeconds, 0.95), data.durationSeconds.count, { sampleSize: data.durationSeconds.count }), reconnectRate: measure(data.reconnects, started), afkRate: measure(data.afk, started), bankruptcies: valueMeasure(data.bankruptcies, started), comebacks: valueMeasure(data.comebacks, started), denominators: { startedMatches: started, completedRounds: data.completed }, generatedAt: generated(snapshot) };
}

export function buildRulesetBoard(rollup, queryInput = {}) {
  const query = normalizeAnalyticsQuery(queryInput); const { snapshot, entries } = selectedDimensions(rollup, query);
  const rows = entries.slice(0, 100).map(({ value, dimensions }) => ({ rulesetPreset: dimensions.rulesetPreset, boardVariant: dimensions.boardVariant, matches: startedCount(value), started: startedCount(value), completed: number(value.completed), completionRate: measure(value.completed, startedCount(value)), medianDuration: valueMeasure(median(value.durationSeconds), value.durationSeconds?.count || 0), outcomeDistribution: value.outcomes && typeof value.outcomes === 'object' ? value.outcomes : {}, associationLabel: 'ASSOCIATION, NOT CAUSATION' }));
  return { rows, generatedAt: generated(snapshot), filters: query, associationLabel: 'ASSOCIATION, NOT CAUSATION' };
}

export function buildEconomy(rollup, queryInput = {}) {
  const query = normalizeAnalyticsQuery(queryInput); const { snapshot, entries } = selectedDimensions(rollup, query); const data = aggregate(entries); const adoption = {};
  Object.entries(data.features).forEach(([feature, item]) => { adoption[feature] = measure(item.used, item.eligible); });
  const liquidationRate = measure(data.market.liquidations, data.market.marginPositions);
  const shortDefaultRate = measure(data.market.shortDefaults, data.market.shortPositions);
  const optionExerciseRate = measure(data.market.optionExercises, data.market.collateralizedOptions);
  const negativeCashPrevention = valueMeasure(data.market.negativeCashPreventions, startedCount(data));
  return { adoption, volatility: valueMeasure(median(data.market.volatility), data.market.volatility.count, { observations: data.market.volatility.count }), liquidationRate, liquidation: liquidationRate, shortDefaultRate, shortDefault: shortDefaultRate, optionExerciseRate, optionExercise: optionExerciseRate, negativeCashPrevention, generatedAt: generated(snapshot), filters: query };
}

export function buildEventsRarity(rollup, queryInput = {}) {
  const query = normalizeAnalyticsQuery(queryInput); const { snapshot, entries } = selectedDimensions(rollup, query); const data = aggregate(entries);
  const rows = Object.entries(data.events).slice(0, 100).filter(([eventId]) => !query.eventId || eventId === query.eventId).map(([eventId, event]) => ({ eventId, eligibility: valueMeasure(event.eligible), warningToActive: measure(event.active, event.warnings || event.eligible), turnout: measure(event.voters, event.eligible), medianDuration: valueMeasure(median(event.durationSeconds), event.durationSeconds.count), recoveryRate: measure(event.recovered, event.active), combinations: event.combinations }));
  const competitiveCompleted = data.competitiveCompleted;
  const rarity = Object.keys(data.competitiveAchievements).length ? data.competitiveAchievements : data.achievements;
  const unlockRarity = Object.fromEntries(Object.entries(rarity).map(([rarityKey, count]) => [rarityKey, measure(count, competitiveCompleted)]));
  return { rows, unlockRarity, rewardClaims: measure(data.competitiveRewardClaims, competitiveCompleted), generatedAt: generated(snapshot), filters: query };
}

export function buildBots(rollup, queryInput = {}) {
  const query = normalizeAnalyticsQuery(queryInput); const { snapshot, entries } = selectedDimensions(rollup, query); const data = aggregate(entries);
  const rows = Object.entries(data.bots).filter(([key, bot]) => query.botMode === 'all' || (bot.botMode || key.split('|')[0]) === query.botMode).slice(0, 100).map(([key, bot]) => ({ botMode: bot.botMode || key.split('|')[0] || 'human', provider: bot.provider || key.split('|')[1] || 'unknown', matches: bot.matches, completed: bot.completed, wins: bot.wins, winShare: measure(bot.wins, bot.matches), medianPlacement: valueMeasure(median({ values: bot.placements }), bot.placements.length), completionRate: measure(bot.completed, bot.matches), actionAdoption: bot.actions, auctionDecisions: bot.actions?.['auction:bid'] || 0, fallback: bot.fallback, fallbackRate: measure(bot.fallback, bot.decisions), legalActionTaxonomy: Object.keys(bot.actions || {}).sort() }));
  return { rows, generatedAt: generated(snapshot), filters: query, competitiveMetricsExcludeBotOnly: true };
}

function associationGroups(rollup, query, feature) {
  const { entries } = selectedDimensions(rollup, query); const exposed = { observations: 0, successes: 0 }; const control = { observations: 0, successes: 0 };
  entries.forEach(({ value }) => {
    const source = value.associations?.[feature] || value[feature] || (feature === 'outcomes' ? value.outcomes : null);
    if (source?.exposed) { exposed.observations += number(source.exposed.observations ?? source.exposed.count); exposed.successes += number(source.exposed.successes ?? source.exposed.completed ?? source.exposed.wins); }
    if (source?.control) { control.observations += number(source.control.observations ?? source.control.count); control.successes += number(source.control.successes ?? source.control.completed ?? source.control.wins); }
  });
  return { exposed, control };
}

export function buildAssociation(rollup, queryInput = {}, feature = '') {
  const query = normalizeAnalyticsQuery(queryInput); const groups = associationGroups(rollup, query, stringValue(feature));
  if (groups.exposed.observations < MIN_COHORT || groups.control.observations < MIN_COHORT) return { ...suppressedRow('MIN_COHORT'), label: 'ASSOCIATION, NOT CAUSATION', generatedAt: generated(rollupSnapshot(rollup, query)) };
  const exposedRate = measure(groups.exposed.successes, groups.exposed.observations); const controlRate = measure(groups.control.successes, groups.control.observations); const delta = exposedRate.value - controlRate.value;
  return { label: 'ASSOCIATION, NOT CAUSATION', exposed: { rate: exposedRate.value, sampleSize: groups.exposed.observations, numerator: groups.exposed.successes, denominator: groups.exposed.observations }, control: { rate: controlRate.value, sampleSize: groups.control.observations, numerator: groups.control.successes, denominator: groups.control.observations }, percentagePointDelta: delta * 100, relativeRateDelta: controlRate.value ? delta / controlRate.value : null, generatedAt: generated(rollupSnapshot(rollup, query)), filters: query };
}

export function buildDataQuality(rollup, queryInput = {}) {
  const query = normalizeAnalyticsQuery(queryInput); const snapshot = rollupSnapshot(rollup, query); const quality = snapshot.quality || {}; const entries = dimensionsOf(snapshot).filter(entry => matchesQuery(entry.dimensions, query));
  const revisions = [...new Set(entries.map(({ dimensions }) => `${dimensions.rulesetRevision}:${dimensions.balanceRevision}`))].slice(0, 100);
  return { fresh: quality.fresh !== false && quality.stale !== true, stale: quality.stale === true || quality.fresh === false, lagSeconds: number(quality.lagSeconds), eventCoverage: quality.eventCoverage ?? null, queueDepth: number(quality.queueDepth ?? quality.pendingWrites), pendingWrites: number(quality.pendingWrites), rejectedEvents: number(quality.rejectedEvents), suppressionCount: number(quality.suppressionCount), schemaVersion: number(snapshot.schemaVersion, 1), revisionCoverage: quality.revisionCoverage || revisions, generatedAt: generated(snapshot), filters: query };
}

export { RANGES, TABS };
