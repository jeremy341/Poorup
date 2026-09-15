export const ANALYTICS_TABS = Object.freeze([
  'overview', 'match-health', 'rulesets', 'economy', 'events', 'bots', 'quality',
]);

export const ANALYTICS_FILTERS = Object.freeze([
  'range', 'boardVariant', 'rulesetPreset', 'marketComplexity', 'botMode',
  'provider', 'eventId', 'seasonId', 'rulesetRevision', 'balanceRevision',
]);

export const PANEL_DEFINITIONS = Object.freeze({
  overview: { question: 'Is the parlor healthy right now?', charts: [] },
  'match-health': { question: 'Are matches starting and settling reliably?', charts: [] },
  rulesets: { question: 'Which board and ruleset combinations differ?', charts: [] },
  economy: { question: 'Where are economic systems used or stressed?', charts: [] },
  events: { question: 'Are events resolving with the intended rarity?', charts: [] },
  bots: { question: 'Are bot decisions stable and explainable?', charts: [] },
  quality: { question: 'Can this snapshot be trusted?', charts: [] },
});

export const OVERVIEW_KPIS = Object.freeze([
  { id: 'online-now', label: 'Online now' },
  { id: 'peak-24h', label: '24h peak' },
  { id: 'started', label: 'Games started' },
  { id: 'completion-rate', label: 'Completion rate' },
  { id: 'p95-action-latency', label: 'P95 action latency' },
  { id: 'error-rate', label: 'Error rate' },
]);

export const CONTEXTUAL_PANELS = Object.freeze([
  { id: 'live-ops', question: 'What needs operational attention?' },
  { id: 'funnel', question: 'Where do players progress or stop?' },
  { id: 'retention', question: 'Do cohorts return after their first game?' },
  { id: 'releases', question: 'What changed between revisions?' },
]);
