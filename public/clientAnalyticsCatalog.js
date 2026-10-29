// Six console sections, one level of navigation (the left rail). The ids are the
// `?tab=` values. Legacy links keep working: overview opens status and
// match-health opens matches. Lookups go through an own-property allowlist so a
// crafted value such as `constructor` or `__proto__` can never resolve to a tab.
export const ANALYTICS_TABS = Object.freeze(['status', 'rooms', 'matches', 'bots', 'economy', 'release']);

const TAB_LOOKUP = Object.freeze({
  __proto__: null,
  status: 'status', rooms: 'rooms', matches: 'matches', bots: 'bots', economy: 'economy', release: 'release',
  overview: 'status', 'match-health': 'matches',
});

export function resolveTab(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return Object.hasOwn(TAB_LOOKUP, key) ? TAB_LOOKUP[key] : 'status';
}

export const TAB_LABELS = Object.freeze({
  status: 'Overview', rooms: 'Rooms', matches: 'Match health', bots: 'Bots & AI', economy: 'Economy', release: 'Release',
});

// Navigation: a top row of four surfaces; Analytics holds a second strip of three views.
// The `?tab=` ids above stay the single source of truth; these only group them for display.
export const SECTIONS = Object.freeze(['analytics', 'rooms', 'bots', 'release']);
export const SECTION_LABELS = Object.freeze({ analytics: 'Analytics', rooms: 'Rooms', bots: 'Bots & AI', release: 'Release' });
export const ANALYTICS_VIEWS = Object.freeze(['status', 'matches', 'economy']);
const SECTION_OF = Object.freeze({ __proto__: null, status: 'analytics', matches: 'analytics', economy: 'analytics', rooms: 'rooms', bots: 'bots', release: 'release' });

export function sectionOf(tab) { return Object.hasOwn(SECTION_OF, tab) ? SECTION_OF[tab] : 'analytics'; }
// Opening a surface lands on its default view; Analytics reopens the view that was last open.
export function tabForSection(section, lastAnalytics = 'status') {
  if (section === 'analytics') return ANALYTICS_VIEWS.includes(lastAnalytics) ? lastAnalytics : 'status';
  return SECTIONS.includes(section) ? section : 'status';
}

// The analytics endpoint still answers in its own tab ids. Only these three rail items read it.
export const SERVER_TABS = Object.freeze({ status: 'overview', matches: 'match-health', economy: 'economy' });
export const BALANCE_TABS = Object.freeze(['status', 'matches', 'economy']);

// Window control: ranges the endpoints accept. `season` is tolerated for old links only.
export const ANALYTICS_RANGES = Object.freeze(['hour', 'day', 'week', 'month']);
export const RANGE_LABELS = Object.freeze({ hour: '1H', day: '24H', week: '7D', month: '30D' });
export const RANGE_NAMES = Object.freeze({ hour: 'Last hour', day: 'Last 24 hours', week: 'Last 7 days', month: 'Last 30 days' });

// Query dimensions the normalizer still carries. Only `range` has a control on the page.
export const ANALYTICS_FILTERS = Object.freeze(['range', 'boardVariant', 'marketComplexity', 'botMode']);

export const PANEL_DEFINITIONS = Object.freeze({
  status: { question: 'Is the parlor healthy right now?' },
  rooms: { question: 'Which tables are live, and are any stuck?' },
  matches: { question: 'Are matches starting and settling reliably?' },
  bots: { question: 'Are bot decisions stable, and which provider is serving them?' },
  economy: { question: 'Where are economic systems used or stressed?' },
  release: { question: 'Is the server open, draining or in maintenance?' },
});

// Tile order is part of the contract with the server.
export const OVERVIEW_KPIS = Object.freeze([
  { id: 'online-now', label: 'Online now' },
  { id: 'error-rate', label: 'Error rate' },
  { id: 'p95-action-latency', label: 'P95 action latency' },
  { id: 'completion-rate', label: 'Completion rate' },
  { id: 'started', label: 'Games started' },
  { id: 'peak-24h', label: '24h peak' },
]);
