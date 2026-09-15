# Poorup Admin Analytics Control Room — Design Specification

**Status:** Approved direction; implementation plan follows this document

**Date:** 2026-09-15

**Scope:** Internal `/admin/analytics` surface only. This specification does not redesign the public game, add public tracking UI, change game rules, or define a second server analytics system.

## Design Read

Poorup’s admin surface should feel like a quiet control room behind the parlor: evidence-led, dense enough for balancing work, and immediately legible when something is wrong. The visual bet is a compact ledger that makes the next investigation obvious without becoming a generic SaaS dashboard.

## Users and jobs

The surface is for authenticated Poorup operators and developers who need to:

1. understand service health within seconds;
2. see whether players can start and finish games;
3. compare board, ruleset, economy, event, and bot behavior;
4. investigate a change without exposing player identity;
5. verify whether a number is fresh, sufficiently sampled, and correctly defined;
6. compare a release or balance revision with its predecessor.

The page is not a player-facing statistics page, social surface, moderation console, or raw event browser.

## Existing product authority

The implementation binds to the existing Poorup system described in `.ulpi/design/DESIGN.md`:

- 640×360 visual world and 1920×1080 desktop priority;
- dark teal panels, gold structural rules, square geometry, restrained shadows;
- Pixelify Sans / mono typography and tabular numerals;
- red action semantics, green success semantics, blue player semantics;
- existing header, footer, focus treatment, live region, modal/drawer, and navigation conventions;
- vanilla HTML, CSS, and JavaScript;
- server-authoritative game and telemetry state.

The current admin route, `server/analyticsApi.js`, `server/analyticsProjection.js`, `server/analyticsRollupStore.js`, `public/clientAnalytics.js`, and `public/clientAnalyticsCharts.js` are the incumbent seams. This feature consumes those seams from the admin UI; it does not create a parallel dashboard application or modify server/game modules.

## Non-goals and hard constraints

- No public navigation link to analytics.
- No change to board rules, turn flow, economy, Socket.IO contracts, or player-facing layout.
- No raw event viewer in the first release.
- No player names, usernames, account IDs, room codes, chat, hidden cards, private loan terms, secrets, or raw payloads in the browser.
- No cookie, pixel, fingerprint, raw IP, or raw User-Agent tracking added by this surface.
- No React, Tailwind, shadcn, Bootstrap, Material UI, or full frontend migration.
- No chart dependency in the first release unless a measured requirement cannot be met by the existing SVG adapter.
- No chart is added merely because it looks impressive; every panel declares the question it answers.
- No fabricated zeroes, targets, conversion rates, revenue, cost, legal basis, or retention claims.
- No external notifications, public exports, or account-level surveillance without a separate approved specification.

## Information architecture

The page remains one internal route. The existing seven analytical tabs remain the stable top-level contract:

1. `OVERVIEW`
2. `MATCH HEALTH`
3. `RULESETS + BOARDS`
4. `ECONOMY`
5. `EVENTS + RARITY`
6. `BOTS`
7. `DATA QUALITY`

The following concepts are subviews or contextual panels, not mandatory new public navigation:

- Live operations belongs in Overview and Data Quality.
- Funnel and retention belong in Overview or a later opt-in tab once their data contract exists.
- Release comparison belongs in the shared comparison control and Data Quality context.

This keeps the stable seven-tab API while allowing the UI to grow without a tab maze. If Funnel, Retention, or Releases later become first-class tabs, they require a versioned contract and a separate review rather than silently changing the existing tab set.

## Shared page anatomy

```text
┌─────────────────────────────────────────────────────────────────────┐
│ POORUP / ADMIN CONTROL ROOM                 last verified · status  │
├─────────────────────────────────────────────────────────────────────┤
│ period · compare · board · ruleset · market · bot · revision        │
├─────────────────────────────────────────────────────────────────────┤
│ KPI  KPI  KPI  KPI  KPI  KPI                                         │
├─────────────────────────────────────────────────────┤───────────────┤
│ primary question chart / ledger                     │ context       │
│                                                     │ alerts /       │
│                                                     │ quality        │
├─────────────────────────────────────────────────────┴───────────────┤
│ supporting visual(s) and accessible data-table fallback              │
└─────────────────────────────────────────────────────────────────────┘
```

At 1920×1080 the first viewport contains no more than six KPI cards, one primary visual, and at most two supporting visuals. Detail tables follow below or open in the existing managed drawer.

## Shared filters and URL state

Every tab uses the same native filter row where the selected view supports a dimension:

- period: `HOUR`, `DAY`, `WEEK`, `SEASON`;
- comparison: `NONE`, `PREVIOUS PERIOD`, `PREVIOUS RELEASE`;
- season ID;
- board: `ALL`, `STANDARD-40`, `METRO-52`;
- ruleset: `ALL`, `CLASSIC`, `AFTER HOURS`, `CUSTOM`;
- market complexity: `ALL`, `BASIC`, `MARGIN`, `SHORTING`, `DERIVATIVES`;
- participant mode: `ALL`, `HUMAN`, `AI`, `NO-AI`;
- provider;
- ruleset revision;
- balance revision;
- event ID where applicable.

The URL mirrors the active tab and filters. A copied URL must reproduce the same read-only view without an account ID or secret. Reset returns native controls to their safe defaults. Refresh retains the last verified snapshot while the request is pending.

## Client data contract

The UI consumes a sanitized snapshot. The server is the source of truth for formulas and privacy; the client only normalizes, renders, and filters the returned model.

```js
{
  success: true,
  schemaVersion: 1,
  generatedAt: "2026-09-15T12:00:00.000Z",
  filters: {
    range: "day",
    tab: "overview",
    boardVariant: "all",
    rulesetPreset: "all",
    marketComplexity: "all",
    botMode: "all",
    provider: "all",
    seasonId: "",
    rulesetRevision: null,
    balanceRevision: null
  },
  pseudonymVersion: "hmac-v1",
  suppression: { minimumCohort: 5, suppressedPanels: 0 },
  overview: { kpis: [] },
  series: [],
  breakdowns: [],
  dataQuality: {}
}
```

### KPI shape

```js
{
  id: "completion-rate",
  label: "Completion rate",
  value: 0.874,
  unit: "percent",
  numerator: 874,
  denominator: 1000,
  comparison: { period: "previous-day", value: 0.861, delta: 0.013 },
  definition: "Verified completed matches divided by started matches.",
  generatedAt: "2026-09-15T12:00:00.000Z"
}
```

### Chart shape

```js
{
  id: "concurrent-players",
  question: "How many human players were concurrently active over this period?",
  type: "line",
  unit: "players",
  series: [{ id: "human", label: "Human", points: [] }],
  sampleSize: 1440,
  denominator: null,
  interpretation: "Peak is a descriptive maximum, not a forecast.",
  status: "verified",
  tableRows: []
}
```

The allow-list is closed. Unknown fields are discarded before rendering. A missing series is an explicit empty state, never a zero invented by the client.

## Overview tab

### Question

“Is the parlor healthy right now, and what changed compared with the selected baseline?”

### KPI strip

1. Online now — active human seats, not sockets.
2. 24h peak — maximum human-player minute bucket.
3. Games started — verified server starts.
4. Completion rate — completed divided by started.
5. P95 action latency — successful actions, with failed latency separate in Live Ops context.
6. Error rate — failed requests or server errors in the selected window.

Each card shows value, denominator when applicable, comparison, timestamp, and a one-line definition.

### Visuals

- primary line chart: concurrent humans, AI seats, deterministic bot seats;
- horizontal bars: games by ruleset and board;
- weekday×hour heatmap: active demand;
- alert strip: only actionable warnings and critical states.

The first card is not a navigation target. A separate `OPEN BREAKDOWN` button opens a read-only drawer.

## Match Health tab

### Question

“Are matches starting, progressing, reconnecting, and settling reliably?”

### Visuals and measures

- starts, completions, stalls, and completion rate;
- duration histogram with median and P95;
- box plot of duration by player count when each group meets the minimum sample;
- reconnect rate and AFK rate;
- lobby wait-time distribution;
- bankruptcies and comebacks;
- breakdown by ruleset, board, and release.

Bot-only matches remain visible for operations but are marked as excluded from competitive player metrics.

## Rulesets + Boards tab

### Question

“Which ruleset and board combinations behave differently?”

### Visuals and measures

- adoption bars for Classic, After Hours, Custom, Standard-40, and Metro-52;
- completion and duration comparison;
- outcome distribution bars;
- release and balance revision markers;
- board topology overlay where a board metric is selected.

Every outcome comparison is labeled `ASSOCIATION, NOT CAUSATION` and includes sample sizes.

## Economy tab

### Question

“Which economic systems are used, and where do liquidity or balance risks appear?”

### Visuals and measures

- feature adoption bars;
- money-supply trend by turn or match phase;
- rent and net-worth histograms;
- market-volatility line;
- liquidation, short-default, and option-exercise rates;
- negative-cash prevention count;
- trade, loan, repayment, mortgage, and auction activity.

Exact private deal terms never appear. Values are aggregate and revision-scoped.

## Events + Rarity tab

### Question

“Are global events discoverable, rare enough, and resolving cleanly?”

### Visuals and measures

- eligibility → warning → active → recovered funnel;
- event turnout bars;
- duration distribution;
- event-combination frequency bars;
- achievement rarity bars;
- reward claim completion.

Small cohorts show `INSUFFICIENT COHORT · MIN COHORT 5`, without revealing the exact count.

## Bots tab

### Question

“Are AI, NO-AI, and human participants completing games with stable decisions and acceptable latency?”

### Visuals and measures

- provider comparison table with match count, completion, win share, median placement, P95 latency, and fallback rate;
- action-distribution stacked bars using the same legal action taxonomy;
- latency line by provider;
- placement distribution by bot mode;
- auction-decision distribution;
- fallback timeline and reason buckets.

Win and placement comparisons are descriptive. Bot-only matches do not inflate competitive human metrics.

## Data Quality tab

### Question

“Can I trust this snapshot and understand its limitations?”

### Visuals and measures

- rollup freshness and lag;
- queue depth and pending writes;
- rejected-event count;
- event coverage by source;
- schema and revision coverage;
- suppressed-panel count;
- duplicate/idempotency rejection count;
- last backup and persistence status;
- pseudonym version and retention label.

This tab is the canonical location for stale, suppressed, partial, or degraded-state explanation.

## Contextual Live Ops, Funnel, Retention, and Releases

These are designed as additive panels and may remain hidden until the returned snapshot includes the required fields.

### Live Ops

Use latency, traffic, errors, and saturation as the primary operational frame. Include event-loop lag, memory, queue depth, persistence failures, active rooms, reconnects, and maintenance state.

### Funnel

```text
page viewed → play opened → room created/joined → lobby entered
→ game started → game completed → another game started
```

Show raw counts, step conversion, and median transition time. Sessions are pseudonymous or aggregate-only.

### Retention

Show D1, D7, D30, weekly cohorts, first-game-to-second-game conversion, games per session, and early abandonment. Suppress small cohorts and show the cohort definition beside the grid.

### Releases

Show release markers, board/ruleset/balance revisions, feature flags, maintenance windows, and before/after comparisons. An annotation explains context; it does not imply causality.

## Board topology visualization

The board visualization is a Poorup-specific SVG/HTML projection, not a generic map.

Selectable metrics:

- landings;
- purchases;
- rent generated;
- ROI;
- mortgage rate;
- auction rate;
- bankruptcy association;
- owner win association.

Each tile retains its board label and color-independent numeric legend. The visual is accompanied by a table of tile, metric, sample size, and definition. It must not alter the live game board or accept game actions.

## Chart interaction contract

- Native filter controls are always available.
- Hover tooltips are supplemental, never the only source of information.
- Keyboard focus can reach the table toggle and any intentionally interactive drilldown trigger.
- A tooltip or focus summary includes label, value, unit, comparison, denominator, and timestamp.
- Legend toggles update the chart and table together.
- Click-to-filter updates the URL and announces the new filter.
- Reset returns to the prior safe query.
- Complex charts expose `SHOW DATA TABLE`.
- Aggregate CSV export, if enabled later, exports the displayed rows only and never raw events.
- Drilldowns use the existing managed modal/drawer, trap focus, and restore focus to the opener.

## State model

Every tab supports these states without changing layout height unexpectedly:

| State | Visible behavior |
|---|---|
| Initial loading | Fixed-height skeletons; status `LOADING…` |
| Refreshing | Last verified snapshot remains; status `REFRESHING…`; refresh disabled once |
| Verified | Values, timestamp, definitions, and `SYNCED` status |
| Stale | Last snapshot remains; warning explains timestamp and retry action |
| Empty | `NO VERIFIED OBSERVATIONS FOR THIS FILTER`; reset action |
| Suppressed | `INSUFFICIENT COHORT · MIN COHORT 5`; no exact count |
| Unauthorized | Data removed from DOM; `ADMIN ACCESS REQUIRED` |
| Forbidden/no session | No analytics request; `ADMIN ACCOUNT REQUIRED` |
| Rate-limited | Last snapshot remains; retry guidance and cooldown text |
| Rollup unavailable | `ROLLUP UNAVAILABLE`; retry action; no partial private rows |
| Network failure | Last snapshot remains when available; actionable retry |
| Partial | Available panels render with a clear missing-data explanation |

## Accessibility and interaction

- Use semantic `main`, `nav`, `section`, `figure`, `figcaption`, `table`, and form elements.
- Tabs use a native tablist pattern with roving focus, arrows, Home, End, Enter, and Space.
- Each panel has one heading and an associated tab.
- Every input has an associated label, meaningful `name`, and appropriate input type.
- Table headers use `scope`, captions describe the table, and complex headers use explicit associations.
- Charts have a concise accessible summary plus an available data table.
- Important information is never conveyed by color alone; use labels, icons, patterns, or text.
- Focus indicators remain visible against every theme and never hide under sticky chrome.
- Controls use at least the existing 44px preferred target; the WCAG 2.2 minimum remains a floor.
- No keyboard trap exists outside the managed drilldown modal.
- Refresh does not steal focus.
- URL filters are shareable without identity-bearing parameters.
- At 200% zoom, tables become the primary representation without page-level horizontal overflow.
- Forced Colors hides decorative chart strokes and leaves native text/table information.
- Reduced Motion removes chart draw-in and refresh travel; values update in place.

## Motion

Analytics motion is explanatory and quiet:

- panel state transitions use the existing Poorup 120–160ms tokens;
- chart updates use only `opacity` or a small `transform` where motion communicates continuity;
- no `transition: all`, path-dash draw-in, scale-from-zero, layout animation, or keyboard-triggered motion;
- no ungated hover movement;
- hidden tabs and `document.hidden` pause refresh and motion;
- reduced motion disables nonessential motion;
- stale or warning states do not pulse or flash.

## Theme and color contract

Charts consume semantic CSS variables, never independent hardcoded palettes:

```css
--analytics-human
--analytics-ai
--analytics-bot
--analytics-positive
--analytics-negative
--analytics-warning
--analytics-neutral
--analytics-grid
--analytics-tooltip-bg
--analytics-tooltip-fg
```

The current Poorup theme maps these roles to its actual tokens. A future theme updates the role mapping, not every chart. Distinguishability is reinforced by line styles, markers, labels, and table values so color is not the sole encoding.

## Performance and responsive contract

- First verified render target: under 100ms client rendering for the capped 168-point series.
- No unbounded DOM list; breakdown rows are capped and tables use internal scrolling where needed.
- Poll only while the analytics view is visible; pause when hidden.
- Keep responses `no-store`; do not cache private snapshots in a CDN.
- 1920×1080: 8-column ledger and 4-column context region.
- 1366×768: compact 7/5 split with preserved filter access.
- iPad landscape: 7/5 split and touch-safe controls.
- 390×844: stacked panels, internal table scrolling, no page overflow.
- All chart images/SVGs have explicit dimensions or stable aspect-ratio boxes to avoid layout shift.

## Security and privacy boundary

The admin surface relies on the existing server authorization and privacy boundary:

- no account ID is accepted in a query string;
- unauthorized requests receive no partial data;
- response fields are recursively allow-listed;
- pseudonymous rows use the server-provided pseudonym version;
- cohorts below five observations are suppressed;
- labels and event IDs are escaped before HTML insertion;
- admin access and export actions are auditable without logging data rows;
- keys remain server-side and are never sent to the browser.

This specification is not a legal determination. Privacy-policy wording, lawful basis, retention duration, geographic dimensions, and data-subject deletion behavior require a separate owner/legal decision.

## Visualization technology decision

### Option A — Existing Poorup SVG adapter (recommended for first release)

Pros: no dependency, full Poorup token control, crisp 1920px rendering, direct board-topology support, straightforward table fallback, and predictable bundle size.

Cons: interaction, zoom, and advanced distributions require deliberate local implementation.

### Option B — uPlot behind the adapter

Pros: small and fast for dense time series. The project documents approximately 50KB minified size and strong time-series performance in its published benchmark.

Cons: Canvas accessibility is a manual responsibility, chart coverage is narrower, and the benchmark is hardware- and version-dependent. [uPlot project](https://github.com/leeoniya/uPlot)

### Option C — Chart.js behind the adapter

Pros: familiar APIs and common line/bar/doughnut charts.

Cons: Canvas content is not available to screen readers without an explicit ARIA or fallback implementation. [Chart.js accessibility guidance](https://www.chartjs.org/docs/latest/general/accessibility.html)

### Option D — Apache ECharts behind the adapter

Pros: broad chart coverage, SVG/Canvas rendering, and built-in ARIA/decal options.

Cons: substantially larger integration surface and bundle cost than this admin view needs; Poorup styling and accessibility still require governance. [ECharts ARIA guidance](https://echarts.apache.org/handbook/en/best-practices/aria/)

### Option E — D3 or Observable Plot

Pros: maximum control for bespoke visualizations and direct web-standard SVG composition.

Cons: a large implementation and maintenance surface for a private dashboard; D3’s own guidance positions it as a low-level toolbox and notes that it can be overkill for a private dashboard. [D3 guidance](https://d3js.org/what-is-d3)

### Decision

Use the existing SVG renderer plus a small `PoorupChartAdapter` contract in the first release. Keep the adapter replaceable. Reconsider uPlot only after a measured point-count or render-time problem; do not install ECharts, D3, or Chart.js preemptively.

## Design acceptance checklist

- [ ] The route remains internal and admin-authorized.
- [ ] The seven existing tabs remain stable.
- [ ] Each panel declares one analytical question.
- [ ] The first viewport contains six or fewer KPIs.
- [ ] Every KPI shows definition, denominator where relevant, timestamp, and comparison context.
- [ ] Every complex visual has a text summary and table fallback.
- [ ] No raw identity-bearing field can reach DOM, URL, chart, or export.
- [ ] Suppression, stale, empty, unauthorized, rate-limit, and unavailable states are explicit.
- [ ] Poorup tokens, typography, borders, and interaction language remain authoritative.
- [ ] 1920×1080, 1366×768, iPad landscape, 390×844, 200% zoom, Forced Colors, and Reduced Motion are covered.
- [ ] No public game layout, gameplay, Socket.IO contract, or economy behavior changes.

## Build handoff

Implement this specification in the existing vanilla client. Extend the current `/admin/analytics` surface and chart adapter; do not build a new dashboard framework. Treat the existing server response as authoritative, render missing metrics honestly, and keep every decision read-only with respect to live game state.
