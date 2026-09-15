# Poorup Admin Analytics Full-Screen Control Room

**Status:** Approved design for implementation

**Date:** 2026-09-15

**Scope:** Internal `/admin/analytics` surface only.

## Intent

The current analytics screen behaves like a long document: it leaves unused horizontal space, stacks ten filters above the report, and pushes the useful chart below the first viewport. This design turns the admin route into a fixed Poorup control room. It fills the available area below the existing global header, uses internal report pages, and keeps all dense detail inside page turns or a contained read-only data panel. There is no document-level scrolling on desktop or landscape tablet.

The existing Poorup global shell remains authoritative:

- the existing header/brand remains unchanged;
- the global music dock remains outside the admin view and keeps its current behavior;
- Poorup typography, gold rules, dark teal surfaces, square geometry, and semantic status colors remain unchanged;
- game screens, public navigation, server authority, analytics endpoint contracts, and Socket.IO contracts are not changed.

## Viewport contract

The admin view consumes all remaining viewport space after the global header:

```css
#view-admin-analytics {
  min-height: 0;
  height: 100dvh;
}

.admin-analytics-main {
  width: 100%;
  max-width: none;
  min-height: 0;
  height: calc(100dvh - var(--admin-header-height));
  overflow: hidden;
}
```

The implementation uses the existing header measurement token rather than a hard-coded header guess. Safe-area insets are applied at the page edge. The page does not create a vertical scrollbar. A detail data view uses pagination or a contained dialog with its own accessible scroll region; the main document never scrolls.

At 1920×1080 the first viewport must contain:

1. the admin command strip;
2. the internal report tabs;
3. the compact filter strip;
4. six or fewer KPI cards;
5. the active report’s primary visual and context status;
6. previous/current/next page controls.

## Page anatomy

```text
GLOBAL POORUP HEADER
GLOBAL MUSIC DOCK

ADMIN COMMAND STRIP
  ANALYTICS CONTROL ROOM · LAST VERIFIED · REFRESH · STATE

REPORT TAB BAR
  OVERVIEW · MATCH HEALTH · RULESETS + BOARDS · ECONOMY
  EVENTS + RARITY · BOTS · DATA QUALITY

FILTER STRIP
  WINDOW · COMPARE · ACTIVE CHIPS · MORE FILTERS

ACTIVE REPORT PAGE
  KPI row / chart deck / context rail

PAGE TURNER
  PREVIOUS · CURRENT / TOTAL · NEXT
```

The page keeps the seven existing tab IDs and URL values for deep-link compatibility. The visible tab bar remains seven items because all seven fit across the full-width 1920px stage. The report body uses a Rules-book-inspired page shell: a stable content frame, a quiet context rail, and a footer pager.

## Report pages

### Overview

The quick daily read:

- Online now;
- 24h peak;
- games started;
- completion rate;
- P95 action latency;
- error rate.

The chart deck contains a large verified activity trend, a compact reliability comparison, and an alert/context rail. The first viewport never shows more than six KPI cards.

### Match health

The page-turn subviews are `RELIABILITY`, `DURATION`, and `RECONNECTS`. They show starts, completions, stalls, completion rate, duration distribution, median/P95, reconnect rate, AFK rate, and lobby wait evidence. Count and percentage measures never share an axis.

### Rulesets + boards

The report shows ruleset/board adoption, completion comparison, duration comparison, revision markers, and a read-only Standard-40/Metro-52 topology map. All comparisons carry the `ASSOCIATION, NOT CAUSATION` label and sample size.

### Economy

The report shows feature adoption, money-supply trend, volatility, liquidation, negative-cash prevention, trades, loans, mortgages, auctions, and repayments. Currency, counts, percentages, and seconds use independent chart scales.

### Events + rarity

The report shows event eligibility, turnout, recovery, rarity, reward claims, and active-event state. Missing event measures remain missing evidence.

### Bots

The report separates AI, No-AI, and bot-only measures. It shows provider mix, completion/win/placement summaries, decision latency, fallback frequency, and fallback reasons without exposing private player identity.

### Data quality

The report shows freshness, lag seconds, queue depth, pending writes, rejected events, suppression count, schema version, and revision coverage. Every state is explicitly `VERIFIED`, `STALE`, `SUPPRESSED`, or `UNAVAILABLE`.

## Filters

Only `WINDOW` and `COMPARE` are permanently visible. Active filters appear as removable, non-interactive chips. `MORE FILTERS` opens a Poorup-styled dialog containing the existing safe allow-list:

- board;
- ruleset;
- market complexity;
- participant mode;
- provider;
- event ID;
- season ID;
- ruleset revision;
- balance revision.

The same normalized query is used for fetches and URL state. Reset restores the existing safe defaults. Filter application retains the last verified snapshot until the new snapshot is ready.

## Chart engine decision

Shadcn’s chart component is a composition layer built on Recharts and React, not a drop-in chart runtime for the existing vanilla client. [The official shadcn chart documentation](https://ui.shadcn.com/docs/components/base/chart) documents that relationship.

The selected engine is a lazy, tree-shaken Apache ECharts build configured for SVG rendering and wrapped by a Poorup adapter. ECharts provides the required line, area, bar, stacked, funnel, heatmap, and tooltip primitives while remaining usable from the existing vanilla client. Its accessibility module can generate chart descriptions and decal patterns; the HTML data table remains mandatory. [Apache ECharts accessibility guidance](https://echarts.apache.org/handbook/en/best-practices/aria/)

The adapter is the only module allowed to know the chart library. The rest of the client continues to call:

```js
renderAnalyticsChart(container, series, options)
renderBoardMetricMap(container, board, options)
```

If the engine cannot load, the adapter renders the verified HTML table and `CHART ENGINE UNAVAILABLE`; it never fabricates a chart or silently converts missing evidence to zero.

## Poorup chart language

- chart surfaces use existing panel tokens;
- grid lines are 1px, low-contrast teal rules;
- lines are square-ended and use 2px strokes;
- area fills use flat semantic colors with 10–14% opacity;
- bars are square, unrounded tracks with aligned labels and values;
- markers are square and use the existing focus/gold edge;
- tooltips are compact Poorup panels, not browser-default bubbles;
- no gradients, neon glow, 3D effects, glassmorphism, or decorative SVG artwork;
- no chart draw-in animation on refresh.

The chart theme reads CSS custom properties at render time, so the existing theme system can recolor the admin charts without a second theme registry.

## Interaction, accessibility, and motion

- `role="tablist"`, `role="tab"`, and `role="tabpanel"` remain correctly associated;
- Arrow keys switch tabs; Home/End jump to the first/last tab;
- the footer pager exposes Previous/Next buttons and a `CURRENT / TOTAL` status;
- ArrowLeft/ArrowRight operate the pager when the pager has focus;
- focus returns to the originating tab or opener after a dialog closes;
- charts expose a concise accessible name, description, and a real HTML table;
- forced colors hides decorative chart SVG and exposes the table immediately;
- reduced motion disables chart animation and uses only explicit opacity/transform transitions for page changes;
- hidden views and `document.visibilityState === "hidden"` dispose or pause chart observers;
- loading, stale, empty, suppressed, unauthorized, and unavailable states reserve stable dimensions;
- no chart node is interactive game state and no chart event emits Socket.IO actions.

## Responsive contract

Desktop and landscape tablet use the fixed full-height report frame. At 1920×1080 and 1366×768, the chart deck uses a two-column primary/context split. At 1024px and iPad landscape, the context rail moves beneath the chart deck while the frame remains fixed. At 390×844, the report is one internal page at a time; dense table data is paginated in a contained dialog so the document itself remains non-scrolling.

The music dock remains global and may overlay the lower-left stage according to its existing position preference; report controls keep the existing safe-area and touch-target tokens.

## Data and security boundary

The server remains the source of truth for formulas, cohorts, suppression, and privacy. The client receives the existing sanitized snapshot, normalizes it, and maps it into chart options. The admin UI never renders names, usernames, account IDs, room codes, chat, private deal terms, raw payloads, IP addresses, User-Agents, or secrets.

## Acceptance evidence

The feature is accepted only when all of the following are true:

- page-level `scrollHeight` equals the viewport height at desktop and landscape tablet;
- all seven tabs and pager controls are keyboard reachable;
- filters collapse into the dialog and URL state remains compatible;
- ECharts SVG output is token-colored and the table fallback remains present;
- no React, Tailwind, shadcn runtime, or second chart system is introduced;
- 1920×1080 screenshots show the active chart in the first viewport;
- 1366×768, 1024×768, iPad landscape, and 390×844 have no page overflow;
- forced colors, reduced motion, 200% zoom, stale/empty/suppressed/unavailable states pass;
- client/server regression tests, lint, Impeccable review, and CodeScene review (when authenticated) are recorded.

## Skills applied

Planning and architecture: `superpowers:brainstorming`, `superpowers:writing-plans`, `software-architecture-design`, `code-architecture-review`, `find-skills`.

Frontend and taste: `frontend-design-ui-ux`, `frontend-design`, `frontend-design-review`, `design-taste-frontend`, `critique`, `impeccable`.

Dashboard and game surfaces: `kpi-dashboard-design`, `game-ui-ux`, `mobile-responsiveness`, `color-system`.

Accessibility and quality: `accessibility`, `web-design-guidelines`, `tdd`, `qa-agent-testing`, `agentic-eval`, `systematic-debugging`, `security-best-practices`.

Motion and visual assets: `design-motion-principles`, `emilkowal-animations`, `animate`, `improve-animations`, `review-animations`, `svg-design`, `pixel-art-sprites`. Pixel/SVG guidance is used for crisp Poorup geometry and token discipline; charts themselves are library-rendered rather than hand-drawn.
