# Poorup Admin Analytics Control Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing internal `/admin/analytics` page into a question-led, privacy-safe Poorup control room without changing public game UI, gameplay, server authority, or Socket.IO contracts.

**Architecture:** Keep the existing vanilla client, seven-tab admin route, and server-provided analytics snapshot. Add a small catalog/view-model layer and a token-bound SVG chart adapter so panels are data-driven, accessible, and replaceable without introducing React or a second analytics system. The client renders only sanitized fields already allowed by the analytics API; missing fields produce explicit empty states.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, existing Express analytics endpoints, existing Poorup CSS variables, SVG charts, native HTML tables and controls, Node assertion tests, Playwright, ESLint. No new runtime dependency in this plan.

**Spec:** `docs/superpowers/specs/2026-09-15-admin-analytics-dashboard-design.md`

## Global Constraints

- The feature is limited to the internal `/admin/analytics` surface.
- Preserve the existing Poorup shell, seven tab names, typography, spacing, borders, theme tokens, and responsive breakpoints.
- Do not change game rules, board rendering, economy behavior, Socket.IO contracts, or player-facing navigation.
- Keep analytics read-only with respect to game state.
- Never render or place in URLs: names, usernames, account IDs, room codes, chat, hidden cards, private loan terms, secrets, raw IPs, raw User-Agents, or raw event payloads.
- Use the existing server response as the source of truth; do not calculate game outcomes in the browser.
- Use a fixed minimum cohort of 5; the UI cannot lower it.
- Show at most six KPI cards in the first viewport.
- Every complex chart has a text summary and a real HTML table fallback.
- Use native controls, visible focus, WCAG 2.2 AA contrast, 44px preferred targets, reduced-motion support, forced-colors support, and no page-level overflow.
- URL state mirrors tab and safe filters without identity-bearing values.
- Poll only while the admin view is visible; retain the last verified snapshot during refresh.
- No chart library, UI framework, or CDN asset is installed by this plan.

---

## File map

| File | Responsibility |
|---|---|
| `public/clientAnalyticsCatalog.js` | Stable tab/filter/chart/KPI definitions and question copy |
| `public/clientAnalyticsViewModel.js` | Client allow-list, query normalization, snapshot normalization, metric helpers |
| `public/clientAnalytics.js` | Controller, request lifecycle, tab/filter state, status and panel orchestration; re-exports compatibility functions |
| `public/clientAnalyticsCharts.js` | Poorup SVG chart adapter, table fallback, chart interaction hooks |
| `public/index.html` | Existing admin shell markup, tab metadata, filters, chart slots, status regions |
| `public/styles.css` | Admin-only layout, responsive rules, chart/table states, theme-token mappings |
| `public/clientAnalytics.test.js` | View-model/controller/state contracts |
| `public/clientAnalyticsMarkup.test.js` | Markup and accessibility hooks |
| `qa/analytics-console.spec.js` | Browser, responsive, keyboard, zoom, forced-colors, and overflow contracts |
| `docs/superpowers/specs/2026-09-15-admin-analytics-dashboard-design.md` | Binding design authority |

No server files are changed by this UI-only plan. If a required metric is absent from the current API, the panel must show an honest missing-data state and record the API work as a separate backend plan.

## Interfaces shared between tasks

### Catalog interface

```js
export const ANALYTICS_TABS = Object.freeze([
  'overview', 'match-health', 'rulesets', 'economy', 'events', 'bots', 'quality'
]);

export const ANALYTICS_FILTERS = Object.freeze([
  'range', 'boardVariant', 'rulesetPreset', 'marketComplexity', 'botMode',
  'provider', 'eventId', 'seasonId', 'rulesetRevision', 'balanceRevision'
]);

export const PANEL_DEFINITIONS = Object.freeze({
  overview: { question: 'Is the parlor healthy right now?', charts: [] },
  'match-health': { question: 'Are matches starting and settling reliably?', charts: [] },
  rulesets: { question: 'Which board and ruleset combinations differ?', charts: [] },
  economy: { question: 'Where are economic systems used or stressed?', charts: [] },
  events: { question: 'Are events resolving with the intended rarity?', charts: [] },
  bots: { question: 'Are bot decisions stable and explainable?', charts: [] },
  quality: { question: 'Can this snapshot be trusted?', charts: [] }
});
```

### View-model interface

```js
export function normalizeAnalyticsQuery(input = {}) { /* safe allow-list */ }
export function normalizeAnalyticsSnapshot(input = {}) { /* no raw identity */ }
export function metricValue(entry) { /* finite numeric value or 0 */ }
export function isAnalyticsPath(pathname) { /* exact path check */ }
```

`clientAnalytics.js` must continue re-exporting these functions so existing tests and callers do not break.

### Chart adapter interface

```js
export function renderAnalyticsChart(container, series, options = {}) {
  // returns { element, values, table, chartId } or the existing compatible element
}

export function renderBoardMetricMap(container, board, options = {}) {
  // returns an accessible board figure plus an HTML table
}
```

The adapter accepts `mode` values `line`, `bar`, `stacked-bar`, `heatmap`, `histogram`, `box`, `scatter`, `funnel`, `cohort`, and `board`. Unknown modes render the table fallback and a status message.

---

## Task 1: Lock the admin-only fixture and baseline contracts

**Files:**

- Modify: `public/clientAnalytics.test.js`
- Modify: `public/clientAnalyticsMarkup.test.js`
- Modify: `qa/analytics-console.spec.js`

**Interfaces:**

- Consumes the current `normalizeAnalyticsSnapshot`, `createAnalyticsController`, and `renderAnalyticsChart` exports.
- Produces deterministic fixtures used by every later UI task.

- [ ] **Step 1: Add a deterministic sanitized snapshot fixture.**

```js
export const ADMIN_ANALYTICS_FIXTURE = {
  success: true,
  schemaVersion: 1,
  generatedAt: '2026-09-15T12:00:00.000Z',
  filters: { range: 'day', tab: 'overview', boardVariant: 'all', rulesetPreset: 'all', marketComplexity: 'all', botMode: 'all', provider: 'all' },
  suppression: { minimumCohort: 5, suppressedPanels: 0 },
  overview: { kpis: [
    { id: 'online-now', label: 'Online now', value: 42, unit: 'players', definition: 'Active human seats.' },
    { id: 'peak-24h', label: '24h peak', value: 183, unit: 'players', definition: 'Maximum human-player minute bucket.' },
    { id: 'started', label: 'Games started', value: 824, unit: 'matches', denominator: 824 },
    { id: 'completion-rate', label: 'Completion rate', value: 0.874, unit: 'percent', numerator: 720, denominator: 824 },
    { id: 'p95-action-latency', label: 'P95 action latency', value: 1.8, unit: 'seconds' },
    { id: 'error-rate', label: 'Error rate', value: 0.004, unit: 'percent', denominator: 10000 }
  ] },
  series: [{ label: '12:00', value: 42 }, { label: '13:00', value: 58 }],
  breakdowns: [],
  dataQuality: { fresh: true, lagSeconds: 4 }
};
```

- [ ] **Step 2: Add assertions for six-or-fewer KPIs, question metadata, sanitized fields, and all seven tabs.**

- [ ] **Step 3: Run the current focused contracts.**

Run: `node public/clientAnalytics.test.js; node public/clientAnalyticsMarkup.test.js; npx playwright test -c qa/playwright.config.js qa/analytics-console.spec.js`

Expected: the current suite remains green before the view-model/catalog changes.

- [ ] **Step 4: Commit the baseline contract.**

```text
git add public/clientAnalytics.test.js public/clientAnalyticsMarkup.test.js qa/analytics-console.spec.js
git commit -m "test: lock admin analytics UI contract"
```

## Task 2: Extract the catalog and view model without changing behavior

**Files:**

- Create: `public/clientAnalyticsCatalog.js`
- Create: `public/clientAnalyticsViewModel.js`
- Modify: `public/clientAnalytics.js`
- Modify: `public/clientAnalytics.test.js`

**Interfaces:**

- Consumes the current response shape and existing allow-lists.
- Produces the catalog, normalized snapshot, safe query, and compatibility re-exports.

- [ ] **Step 1: Write failing tests for catalog completeness and query normalization.**

Assert the seven tab IDs, all ten filters, fixed `minimumCohort: 5`, safe board/ruleset/market/bot/provider values, and rejection of account IDs or unknown fields.

- [ ] **Step 2: Move tab/filter/KPI labels and allow-list logic into the two focused modules.**

Keep function names and returned property names identical to the current public API. `clientAnalytics.js` imports and re-exports the helpers; it does not duplicate the sets.

- [ ] **Step 3: Add recursive identity redaction tests.**

```js
const unsafe = { accountId: 'raw', displayName: 'Ada', nested: { roomCode: 'ROOM', chat: 'secret' } };
const clean = normalizeAnalyticsSnapshot({ breakdowns: [unsafe] });
assert.equal(JSON.stringify(clean).includes('Ada'), false);
assert.equal(JSON.stringify(clean).includes('ROOM'), false);
```

- [ ] **Step 4: Run the view-model tests and client lint.**

Run: `node public/clientAnalytics.test.js; npm run lint:client -- --quiet`

Expected: PASS with no changed behavior in the existing controller tests.

- [ ] **Step 5: Commit the view-model extraction.**

```text
git add public/clientAnalyticsCatalog.js public/clientAnalyticsViewModel.js public/clientAnalytics.js public/clientAnalytics.test.js
git commit -m "refactor: isolate admin analytics view model"
```

## Task 3: Build the Poorup chart adapter and table fallback

**Files:**

- Modify: `public/clientAnalyticsCharts.js`
- Modify: `public/clientAnalytics.test.js`
- Modify: `public/styles.css`

**Interfaces:**

- Consumes sanitized series and chart options.
- Produces a `figure` containing an SVG or an explicit table fallback.

- [ ] **Step 1: Add failing tests for every supported mode, bounds, escaping, and fallback.**

Assert that line, bar, stacked-bar, heatmap, histogram, box, scatter, funnel, cohort, and board modes never emit negative SVG dimensions, raw HTML, or unbounded point counts. Assert that every result includes `figcaption`, unit, sample size, and a table toggle.

- [ ] **Step 2: Add semantic chart color roles backed by CSS variables.**

```js
const CHART_ROLES = Object.freeze({
  primary: 'var(--analytics-primary)',
  comparison: 'var(--analytics-comparison)',
  human: 'var(--analytics-human)',
  ai: 'var(--analytics-ai)',
  bot: 'var(--analytics-bot)',
  positive: 'var(--analytics-positive)',
  negative: 'var(--analytics-negative)',
  warning: 'var(--analytics-warning)',
  neutral: 'var(--analytics-neutral)'
});
```

- [ ] **Step 3: Render readable SVG geometry.**

Use integer viewBox coordinates, square markers, restrained grid rules, and explicit axis/unit labels. Keep chart labels outside the data path when possible. Do not animate layout, stroke dash, or path geometry.

- [ ] **Step 4: Render a real table fallback.**

Use `<figure>`, `<figcaption>`, `<table>`, `<caption>`, `<thead>`, `<th scope="col">`, and `<th scope="row">`. The table contains the exact values represented by the visual.

- [ ] **Step 5: Add table toggling and focus-safe interaction.**

The toggle is the only chart child in the normal tab order. Legend/filter controls update the SVG and table together. Unknown or forced-color modes show the table immediately.

- [ ] **Step 6: Run chart tests and inspect native SVG output.**

Run: `node public/clientAnalytics.test.js; node public/clientAnalyticsMarkup.test.js`

Expected: PASS; no chart output contains raw identity fields or non-finite geometry.

- [ ] **Step 7: Commit the adapter.**

```text
git add public/clientAnalyticsCharts.js public/clientAnalytics.test.js public/styles.css
git commit -m "feat: add accessible Poorup analytics chart adapter"
```

## Task 4: Extend the existing admin shell and shared filters

**Files:**

- Modify: `public/index.html`
- Modify: `public/clientAnalytics.js`
- Modify: `public/clientAnalyticsMarkup.test.js`
- Modify: `public/styles.css`

**Interfaces:**

- Consumes `ANALYTICS_TABS`, `ANALYTICS_FILTERS`, and the existing controller.
- Produces stable tab/panel relationships and native filters without adding public navigation.

- [ ] **Step 1: Add markup assertions before changing markup.**

Assert one `main`, one `h1`, one tablist, seven tab buttons, seven tabpanels, ten existing filters, a status live region, and no analytics link outside `view-admin-analytics`.

- [ ] **Step 2: Add explicit catalog metadata to the existing seven tabs.**

Keep IDs and visible labels unchanged. Add only `data-analytics-question`, `aria-controls`, and panel slots required by the spec.

- [ ] **Step 3: Keep filters native and URL-safe.**

Use associated labels, meaningful names, correct input types, `autocomplete="off"` for non-auth filters, and allow-listed query serialization. Do not add an account-ID field.

- [ ] **Step 4: Add comparison context without inventing data.**

Render comparison text only when `snapshot.overview` or a chart supplies a comparison object. Otherwise show `COMPARISON UNAVAILABLE` rather than a fabricated delta.

- [ ] **Step 5: Run markup and client tests.**

Run: `node public/clientAnalyticsMarkup.test.js; node public/clientAnalytics.test.js`

Expected: PASS with unchanged seven-tab count.

- [ ] **Step 6: Commit the shell contract.**

```text
git add public/index.html public/clientAnalytics.js public/clientAnalyticsMarkup.test.js public/styles.css
git commit -m "feat: structure admin analytics control room shell"
```

## Task 5: Render Overview and shared state handling

**Files:**

- Modify: `public/clientAnalytics.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/clientAnalytics.test.js`

**Interfaces:**

- Consumes `ADMIN_ANALYTICS_FIXTURE`, `PANEL_DEFINITIONS`, and `renderAnalyticsChart`.
- Produces six KPI cards, primary traffic chart, alert strip, and all shared loading/error states.

- [ ] **Step 1: Add tests for all Overview states.**

Cover initial loading, refreshing, verified, stale, empty, suppressed, 403, 429, 503, network failure, and partial snapshots. Assert that refresh retains the last verified markup and never moves focus.

- [ ] **Step 2: Render the six-card KPI strip.**

Every card renders label, value, unit, denominator when applicable, comparison when present, definition, and generated timestamp. The 24h and all-time peak cards include the source-window label; all-time is explicitly labeled `SINCE INSTRUMENTATION START` when that metadata is provided. Cards are not clickable.

- [ ] **Step 3: Render the primary concurrent-player chart.**

Use line mode with human, AI, and deterministic bot series when supplied. The adjacent summary names the selected period and sample count.

- [ ] **Step 4: Render ruleset/board bars and alert strip.**

Use horizontal bars for comparisons and text/icon-coded alerts. A warning must include the next action, such as `RETRY` or `OPEN DATA QUALITY`.

- [ ] **Step 5: Add fixed-height skeleton and stale styling.**

Use existing panel tokens and stable aspect-ratio boxes. Do not animate dimensions or use `transition: all`.

- [ ] **Step 6: Run focused tests and lint.**

Run: `node public/clientAnalytics.test.js; npm run lint:client -- --quiet`

Expected: PASS.

- [ ] **Step 7: Commit Overview.**

```text
git add public/clientAnalytics.js public/index.html public/styles.css public/clientAnalytics.test.js
git commit -m "feat: render admin analytics overview"
```

## Task 6: Add data-driven specialized tab panels

**Files:**

- Modify: `public/clientAnalyticsCatalog.js`
- Modify: `public/clientAnalytics.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/clientAnalytics.test.js`

**Interfaces:**

- Consumes the same normalized snapshot and chart adapter for every tab.
- Produces the seven specialized read-only panels described in the spec.

- [ ] **Step 1: Add panel-definition tests.**

Assert that every tab has a question, chart mode list, explanatory copy, and empty/suppressed behavior. Assert that no panel renders an unlisted field.

- [ ] **Step 2: Define Match Health cards and distributions.**

Render starts, completions, stalls, duration median/P95, reconnects, AFK, bankruptcies, comebacks, duration histogram, and player-count box plot when supplied.

- [ ] **Step 3: Define Rulesets + Boards comparisons.**

Render adoption bars, completion/duration comparison, outcome distributions, revision labels, and association wording.

- [ ] **Step 4: Define Economy measures.**

Render feature adoption, money-supply trend, rent/net-worth distributions, volatility, liquidation, short-default, option-exercise, negative-cash prevention, trade, loan, mortgage, and auction summaries.

- [ ] **Step 5: Define Events + Rarity measures.**

Render eligibility-to-recovery funnel, turnout, duration distribution, combination bars, rarity bars, and reward claims.

- [ ] **Step 6: Define Bots measures.**

Render provider comparison, action-distribution stacked bars, latency line, placement distribution, auction decisions, and fallback timeline. Keep bot-only exclusion labels visible.

- [ ] **Step 7: Define Data Quality measures.**

Render freshness, lag, queue depth, rejected events, schema/revision coverage, suppression, duplicates, persistence, backup, pseudonym version, and retention label.

- [ ] **Step 8: Render absent data honestly.**

When an optional API field is missing, render `NO VERIFIED OBSERVATIONS FOR THIS PANEL` plus the relevant data-quality explanation. Never map missing to zero.

- [ ] **Step 9: Add optional contextual subview slots.**

Render Live Ops, Funnel, Retention, and Releases panels only when their sanitized fields are present in the snapshot. Keep the slots hidden (not empty card shells) when the API does not provide the corresponding data, and add a Data Quality note identifying the missing contract.

- [ ] **Step 10: Run the complete client contract suite.**

Run: `node public/clientAnalytics.test.js; node public/clientAnalyticsMarkup.test.js; npm run lint:client -- --quiet`

Expected: PASS.

- [ ] **Step 11: Commit specialized panels.**

```text
git add public/clientAnalyticsCatalog.js public/clientAnalytics.js public/index.html public/styles.css public/clientAnalytics.test.js
git commit -m "feat: add admin analytics specialized panels"
```

## Task 7: Add the Poorup board metric map and managed drilldowns

**Files:**

- Modify: `public/clientAnalyticsCharts.js`
- Modify: `public/clientAnalytics.js`
- Modify: `public/styles.css`
- Modify: `public/clientAnalytics.test.js`

**Interfaces:**

- Consumes board metrics, safe pseudonymous rows, and the existing modal interface.
- Produces a non-interactive board metric visualization and focus-safe read-only drilldown.

- [ ] **Step 1: Add tests for board topology and privacy.**

Assert all 40/52 tile positions remain in the expected order, tile labels are escaped, each tile has a table row, and no raw account identity appears.

- [ ] **Step 2: Render the board map as an admin-only SVG projection.**

Use the existing board topology metadata and semantic intensity classes. Do not reuse live board action hit targets or mutate game board state.

- [ ] **Step 3: Add legend, metric selector, and association disclaimer.**

Selectors are native controls. The legend includes numeric ranges and the text `ASSOCIATION, NOT CAUSATION` for outcome associations.

- [ ] **Step 4: Harden `openDrilldown(trigger, query)`.**

Reuse the existing modal adapter, store the trigger, render only sanitized rows, trap focus through the managed surface, and restore focus on close. If the modal adapter is unavailable, keep the user on the current page and announce `DETAIL VIEW UNAVAILABLE`.

- [ ] **Step 5: Add pseudonym and suppression states.**

Show `PSEUDONYM UNAVAILABLE` when the server cannot provide the key and `INSUFFICIENT COHORT · MIN COHORT 5` for suppressed groups.

- [ ] **Step 6: Run client tests and lint.**

Run: `node public/clientAnalytics.test.js; npm run lint:client -- --quiet`

Expected: PASS.

- [ ] **Step 7: Commit board and drilldowns.**

```text
git add public/clientAnalyticsCharts.js public/clientAnalytics.js public/styles.css public/clientAnalytics.test.js
git commit -m "feat: add privacy-safe analytics drilldowns"
```

## Task 8: Apply responsive, theme, accessibility, and motion contracts

**Files:**

- Modify: `public/styles.css`
- Modify: `public/index.html`
- Modify: `qa/analytics-console.spec.js`

**Interfaces:**

- Consumes the existing Poorup tokens and chart adapter output.
- Produces stable presentation across desktop, iPad landscape, mobile, zoom, reduced motion, and forced colors.

- [ ] **Step 1: Add CSS variable mappings for chart semantic roles.**

Map all `--analytics-*` variables to existing Poorup theme tokens. Do not create a separate chart palette per panel.

- [ ] **Step 2: Implement the 1920×1080 layout.**

Keep the existing shell and use an 8-column ledger plus 4-column context region. Reserve space for six KPI cards, the primary chart, two supporting panels, and the data table.

- [ ] **Step 3: Implement 1366px and iPad landscape layout.**

Use the existing responsive strategy, compact the context region to 7/5, preserve 44px controls, and keep filters reachable without horizontal page scrolling.

- [ ] **Step 4: Implement 390×844 and 200% zoom behavior.**

Stack panels, allow internal table scrolling, keep headings visible, and ensure `documentElement.scrollWidth === clientWidth`.

- [ ] **Step 5: Add forced-colors and reduced-motion rules.**

```css
@media (forced-colors: active) {
  .analytics-chart svg { display: none; }
  .analytics-chart-table { display: table; }
}

@media (prefers-reduced-motion: reduce) {
  .analytics-chart [data-animation="draw"] { animation: none; }
}
```

- [ ] **Step 6: Verify keyboard and screen-reader hooks.**

Check tablist arrows/Home/End/Enter/Space, filter labels, chart table toggles, focus-visible styling, live-region announcements, captions, and panel headings.

- [ ] **Step 7: Run browser presentation contracts.**

Run: `npx playwright test -c qa/playwright.config.js qa/analytics-console.spec.js`

Expected: PASS at the configured desktop, iPad landscape, and mobile projects.

- [ ] **Step 8: Commit responsive and accessibility work.**

```text
git add public/styles.css public/index.html qa/analytics-console.spec.js
git commit -m "fix: harden admin analytics responsive accessibility"
```

## Task 9: Add complete browser evidence and visual review

**Files:**

- Modify: `qa/analytics-console.spec.js`
- Create: `qa/admin-analytics-visual.spec.js`
- Create: `qa-artifacts/admin-analytics-1920/README.md`

**Interfaces:**

- Consumes the fixture-backed admin route and existing Playwright configuration.
- Produces repeatable visual and interaction evidence; no credentials or keys are committed.

- [ ] **Step 1: Add authorized and unauthorized route fixtures.**

Use the existing admin test seam. Assert no analytics request is sent without a session and no private data remains in the DOM after a 403.

- [ ] **Step 2: Add tab and filter browser coverage.**

Exercise every tab, every filter family, URL restoration, reset, refresh, stale, empty, suppressed, 429, and 503 states.

- [ ] **Step 3: Add keyboard and focus coverage.**

Exercise tablist navigation, chart table toggles, drilldown open/close, Escape, outside close, and focus restoration.

- [ ] **Step 4: Add privacy DOM/network assertions.**

Fail if the page, accessibility tree, URL, or response contains `displayName`, `username`, `accountId`, `roomCode`, `chat`, `hiddenCards`, `privateLoanTerms`, `sessionToken`, raw IP fields, or raw User-Agent fields.

- [ ] **Step 5: Capture 1920×1080 evidence.**

Capture Overview, Match Health, Rulesets + Boards, Economy, Events + Rarity, Bots, Data Quality, stale, empty, suppressed, and forced-colors states. Record viewport, commit, state, and inspection result in `qa-artifacts/admin-analytics-1920/README.md`.

- [ ] **Step 6: Inspect screenshots at native resolution.**

Check card heights, chart labels, focus rings, table fallback, text wrapping, alert contrast, and no overlap with the Poorup shell. Do not claim visual completion until every 1920×1080 capture has been inspected.

- [ ] **Step 7: Run the focused browser suite.**

Run: `npx playwright test -c qa/playwright.config.js qa/analytics-console.spec.js qa/admin-analytics-visual.spec.js`

Expected: PASS with only explicitly documented viewport skips.

- [ ] **Step 8: Commit browser evidence.**

```text
git add qa/analytics-console.spec.js qa/admin-analytics-visual.spec.js qa-artifacts/admin-analytics-1920/README.md
git commit -m "test: capture admin analytics visual evidence"
```

## Task 10: Final UI quality, performance, and release verification

**Files:**

- Review all changed admin UI files.
- Modify only when a verification failure identifies a concrete defect.

**Interfaces:**

- Consumes the complete spec, test output, screenshots, and current Poorup design tokens.
- Produces a release-readiness report and a clean implementation branch.

- [ ] **Step 1: Run client unit and markup suites.**

Run: `node public/clientAnalytics.test.js; node public/clientAnalyticsMarkup.test.js; npm run lint:client -- --quiet`

- [ ] **Step 2: Run the full server/client regression suite.**

Run: `npm run test:full; npm run lint -- --quiet`

The analytics UI must not change server behavior; existing server tests must remain green.

- [ ] **Step 3: Run the complete browser matrix.**

Run: `npx playwright test -c qa/playwright.config.js`

Verify 1920×1080, 1366×768, 1024×768 landscape, iPad landscape, 390×844, reduced motion, forced colors, and 200% zoom.

- [ ] **Step 4: Run the Impeccable detector once over changed UI files.**

```text
C:\Users\jerem\.agents\skills\impeccable\scripts\impeccable.cmd detect --json public/clientAnalytics.js public/clientAnalyticsCharts.js public/clientAnalyticsCatalog.js public/clientAnalyticsViewModel.js public/index.html public/styles.css
```

Record findings in the release review; fix only concrete issues within this admin scope.

- [ ] **Step 5: Run CodeScene preparation/review.**

Use the repository’s configured CodeScene workflow without exposing the access token. Treat maintainability findings separately from functional regressions and do not change server/game modules for an admin-only UI concern.

- [ ] **Step 6: Run a performance smoke check.**

Use the fixture with 168 time-series points and 100 capped breakdown rows. Confirm chart render stays under 100ms in a production browser profile, no hidden-tab polling occurs, and DOM growth is bounded.

- [ ] **Step 7: Run a final privacy and scope scan.**

```text
rg -n -i "displayName|username|accountId|roomCode|hiddenCards|privateLoanTerms|sessionToken|rawPayload|rawEvent" public/clientAnalytics*.js public/index.html
```

Review every match; allow only sanitizer deny-lists and tests. Confirm no public navigation or game files changed.

- [ ] **Step 8: Write the release-readiness report.**

Create `docs/audit/admin-analytics-ui-review-2026-09-15.md` with viewport evidence, test commands, metric-state coverage, accessibility results, performance result, known API omissions, and any deferred backend work.

- [ ] **Step 9: Commit the final review.**

```text
git add docs/audit/admin-analytics-ui-review-2026-09-15.md
git commit -m "docs: record admin analytics UI readiness"
```

## Definition of done

- The binding spec and implementation plan are present and internally consistent.
- The existing seven-tab admin route remains stable.
- Every first-viewport KPI is defined, timestamped, and denominator-aware.
- Every complex visual has an accessible HTML table and text summary.
- Unknown, missing, stale, empty, suppressed, unauthorized, rate-limited, and unavailable states are explicit.
- URL filters are safe and shareable.
- No identity-bearing or private game data reaches the DOM, URL, chart, or export.
- Board topology is visualized read-only and does not alter live board interactions.
- Poorup tokens and theme mappings drive all chart colors.
- 1920×1080 screenshots have been inspected at native resolution.
- Responsive, keyboard, screen-reader, reduced-motion, forced-colors, and 200% zoom checks pass.
- Client lint, server regression, browser QA, Impeccable, and CodeScene review evidence is recorded.
- No public game layout, gameplay, Socket.IO contract, or server game logic changes are present.
