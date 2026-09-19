# Poorup Admin Analytics Full-Screen Control Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tall admin analytics document with a full-viewport, tabbed Poorup control room and render charts through a lazy, theme-aware ECharts SVG adapter while preserving the global shell and analytics contracts.

**Architecture:** Keep the existing vanilla client and sanitized analytics snapshot. Add a page controller for internal report pages, a lazy chart-engine loader, and a single chart adapter that hides ECharts from the rest of the client. The existing seven URL tab IDs remain compatible; the visible admin stage becomes a fixed Rules-book-style frame with page-turn controls.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Apache ECharts UMD bundle with SVG renderer, existing Express static serving, CSS custom properties, native HTML controls/tables, Node assertion tests, Playwright, ESLint. No React, Tailwind, shadcn runtime, canvas renderer, or server analytics contract changes.

**Spec:** `docs/superpowers/specs/2026-09-15-admin-analytics-fullscreen-design.md`

## Global Constraints

- Keep the existing Poorup global header, brand, music dock, typography, colors, and semantic status roles unchanged.
- The admin view must consume all remaining viewport width and height below the global header.
- The admin document must not create a page-level vertical or horizontal scrollbar at 1920×1080, 1366×768, 1024×768, or iPad landscape.
- Keep the existing seven tab IDs and URL query values for deep-link compatibility.
- Keep server authority, analytics endpoint fields, suppression rules, minimum cohort 5, and Socket.IO contracts unchanged.
- Keep the HTML table fallback for every chart and expose a clear chart-engine-unavailable state.
- Never render names, usernames, account IDs, room codes, chat, private deal terms, raw payloads, IP addresses, User-Agents, secrets, or fabricated zeroes.
- Use only CSS-variable-backed Poorup colors, square geometry, flat opacity shading, and explicit transform/opacity motion.
- Load the chart engine only after the admin route is active; dispose it when the view is hidden.
- Respect forced colors, reduced motion, keyboard focus, 44px controls, and 200% zoom.

---

### Task 1: Lock the full-screen page and filter contracts

**Files:**

- Create: `public/clientAnalyticsPage.test.js`
- Create: `qa/admin-analytics-fullscreen.spec.js`
- Modify: `public/clientAnalytics.test.js`
- Modify: `public/clientAnalyticsMarkup.test.js`

**Interfaces:**

- Consumes: the existing `createAnalyticsController`, `normalizeAnalyticsQuery`, and seven `data-analytics-tab` values.
- Produces: deterministic assertions for viewport occupancy, filter disclosure, page-turn controls, and URL compatibility.

- [ ] **Step 1: Write failing unit contracts for the page model.**

Add assertions for:

```js
assert.deepEqual(analyticsPageIds(), [
  'overview', 'match-health', 'rulesets', 'economy',
  'events', 'bots', 'quality'
]);
assert.equal(normalizeAnalyticsPage('unknown'), 'overview');
assert.equal(nextAnalyticsPage('overview'), 'match-health');
assert.equal(previousAnalyticsPage('overview'), 'quality');
```

Add a filter contract that keeps `window` and `compare` public while preserving all nine advanced filter names inside the disclosure surface.

- [ ] **Step 2: Write failing browser contracts for the fixed frame.**

In `qa/admin-analytics-fullscreen.spec.js`, assert at desktop and landscape tablet:

```js
const overflow = await page.evaluate(() => ({
  document: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  body: document.body.scrollHeight > document.body.clientHeight,
}));
expect(overflow.document || overflow.body).toBe(false);
await expect(page.locator('[data-analytics-page-prev]')).toBeVisible();
await expect(page.locator('[data-analytics-page-next]')).toBeVisible();
await expect(page.locator('[data-analytics-filter="range"]')).toBeVisible();
await expect(page.locator('[data-analytics-filter="boardVariant"]')).toBeHidden();
```

Also assert that opening `MORE FILTERS` reveals the advanced controls without changing the URL until `APPLY` is pressed.

- [ ] **Step 3: Run the new tests to verify RED.**

Run: `node public/clientAnalyticsPage.test.js; npx playwright test -c qa/playwright.config.js qa/admin-analytics-fullscreen.spec.js --project=desktop-1920 --workers=1`

Expected: FAIL because the page model, disclosure controls, and full-height shell do not exist yet.

- [ ] **Step 4: Commit the red contracts.**

```text
git add public/clientAnalyticsPage.test.js public/clientAnalytics.test.js public/clientAnalyticsMarkup.test.js qa/admin-analytics-fullscreen.spec.js
git commit -m "test: lock admin analytics full-screen contract"
```

### Task 2: Add the ECharts runtime without exposing it to the client architecture

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/sync-admin-analytics-vendor.mjs`
- Create: `public/vendor/echarts.min.js`

**Interfaces:**

- Consumes: the pinned `echarts` package.
- Produces: a local browser bundle at `/vendor/echarts.min.js`; no CDN request and no global script on non-admin surfaces.

- [ ] **Step 1: Install and pin ECharts.**

Run: `npm install --save-exact echarts`

Record the resolved version in `package-lock.json`. The runtime bundle is committed locally so Nest/production does not need a CDN at runtime.

- [ ] **Step 2: Add the reproducible vendor sync script.**

Implement `scripts/sync-admin-analytics-vendor.mjs` with the following behavior:

```js
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'node_modules', 'echarts', 'dist', 'echarts.min.js');
const target = join(root, 'public', 'vendor', 'echarts.min.js');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
```

Add `"sync:analytics-vendor": "node scripts/sync-admin-analytics-vendor.mjs"` to `package.json` and run it once after installation.

- [ ] **Step 3: Verify the local asset and CSP boundary.**

Run: `npm run sync:analytics-vendor; node -e "const fs=require('node:fs'); if(!fs.statSync('public/vendor/echarts.min.js').size) process.exit(1)"`

Confirm the asset is served only from the existing same-origin static directory and that no external URL is added to `index.html` or the CSP.

- [ ] **Step 4: Commit the pinned runtime.**

```text
git add package.json package-lock.json scripts/sync-admin-analytics-vendor.mjs public/vendor/echarts.min.js
git commit -m "build: add local admin analytics chart engine"
```

### Task 3: Build the chart-engine loader and Poorup chart theme

**Files:**

- Create: `public/clientAnalyticsChartTheme.js`
- Create: `public/clientAnalyticsChartAdapter.js`
- Create: `public/clientAnalyticsCharts.test.js`

**Interfaces:**

- Consumes: sanitized series, `window.echarts` after the local script resolves, and CSS custom properties.
- Produces: `loadAnalyticsChartEngine()`, `createPoorupChartOptions()`, `mountAnalyticsChart()`, and `disposeAnalyticsChart()`.

- [ ] **Step 1: Write failing adapter tests.**

Stub a minimal `globalThis.echarts` object and assert:

```js
const chart = mountAnalyticsChart(container, [{ label: '12:00', value: 42 }], {
  mode: 'line', title: 'Activity', unit: 'players'
});
assert.equal(chart.engine, 'echarts-svg');
assert.equal(chart.options.animation, false);
assert.equal(chart.options.series[0].areaStyle.opacity, 0.14);
assert.equal(chart.options.series[0].itemStyle.color, 'var(--analytics-primary)');
```

Also assert that unknown modes and an unavailable engine leave a visible HTML table and return `{ status: 'fallback' }` without throwing.

- [ ] **Step 2: Implement the lazy loader.**

`loadAnalyticsChartEngine()` must:

1. return `window.echarts` if already present;
2. otherwise append one same-origin `<script src="/vendor/echarts.min.js" data-analytics-engine>`;
3. resolve on `load`, reject on `error`, and reuse the same Promise for concurrent callers;
4. never append a second script;
5. avoid running when `matchMedia('(forced-colors: active)')` is true.

- [ ] **Step 3: Implement the token-bound theme.**

`resolvePoorupChartTokens()` reads `--analytics-primary`, `--analytics-comparison`, `--analytics-human`, `--analytics-ai`, `--analytics-bot`, `--analytics-positive`, `--analytics-warning`, `--analytics-neutral`, `--analytics-grid`, `--surface-panel`, and `--text-muted` from the document root, with the existing Poorup values as fallbacks.

`createPoorupChartOptions()` must configure the SVG renderer, square markers, flat area opacity, 1px grid rules, tokenized axes, compact tooltip, and ECharts ARIA description/decal settings. It must set `animation: false` for refreshes and reduced motion.

- [ ] **Step 4: Run adapter tests and client lint.**

Run: `node public/clientAnalyticsCharts.test.js; npm run lint:client -- --quiet`

Expected: PASS.

- [ ] **Step 5: Commit the adapter.**

```text
git add public/clientAnalyticsChartTheme.js public/clientAnalyticsChartAdapter.js public/clientAnalyticsCharts.test.js
git commit -m "feat(admin): add tokenized analytics chart adapter"
```

### Task 4: Replace the admin shell with a fixed full-viewport report frame

**Files:**

- Modify: `public/index.html:546-590`
- Modify: `public/styles.css:860-1060`
- Modify: `public/clientAnalyticsMarkup.test.js`

**Interfaces:**

- Consumes: existing global header/music dock and analytics filter names.
- Produces: `#admin-analytics-main` with command strip, compact filter strip, tablist, report book, pager, and advanced-filter dialog.

- [ ] **Step 1: Add the failing markup assertions.**

Assert the admin view contains exactly one each of:

```text
[data-analytics-command-strip]
[data-analytics-filter-strip]
[data-analytics-more-filters]
[data-analytics-page-prev]
[data-analytics-page-next]
[data-analytics-page-position]
[data-analytics-filter-dialog]
```

Assert the existing ten `data-analytics-filter` names are retained inside the filter strip/dialog and no filter is duplicated.

- [ ] **Step 2: Restructure only the admin markup.**

Keep the existing header untouched. Inside the admin main, replace the tall static filter row with:

```html
<div class="analytics-filter-strip" data-analytics-filter-strip>
  <label class="analytics-filter-primary">WINDOW <select data-analytics-filter="range"></select></label>
  <button class="btn-dark" type="button" data-analytics-more-filters aria-haspopup="dialog" aria-expanded="false">MORE FILTERS</button>
  <div class="analytics-active-filters" data-analytics-active-filters></div>
</div>
<div class="analytics-filter-dialog is-hidden" data-analytics-filter-dialog role="dialog" aria-modal="true" aria-labelledby="analytics-filter-dialog-title">
  <!-- the nine existing advanced controls, one each, plus APPLY and CANCEL -->
</div>
<div class="analytics-report-book" data-analytics-report-book>
  <div class="analytics-report-page" data-analytics-report-page></div>
  <footer class="analytics-page-footer">
    <button class="btn-dark" type="button" data-analytics-page-prev>PREVIOUS</button>
    <span class="t-micro" data-analytics-page-position>1 / 7</span>
    <button class="btn-dark" type="button" data-analytics-page-next>NEXT</button>
  </footer>
</div>
```

The existing panel content can remain as the source templates, but only the active panel is mounted into the report page.

- [ ] **Step 3: Add fixed-height CSS.**

Scope all fixed behavior to `#view-admin-analytics`:

```css
#view-admin-analytics { min-height: 0; height: 100dvh; overflow: hidden; }
#view-admin-analytics .admin-analytics-main {
  width: 100%; max-width: none; min-height: 0;
  height: calc(100dvh - var(--admin-header-height, 64px));
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
}
#view-admin-analytics .analytics-report-book {
  min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
}
```

Use existing Rules-book surface tokens, safe-area padding, and 44px controls. Do not change global `.view`, `.hdr`, or music dock rules.

- [ ] **Step 4: Run markup tests and the 1920px overflow contract.**

Run: `node public/clientAnalyticsMarkup.test.js; npx playwright test -c qa/playwright.config.js qa/admin-analytics-fullscreen.spec.js --project=desktop-1920 --workers=1`

Expected: PASS for shell structure and zero page overflow.

- [ ] **Step 5: Commit the shell.**

```text
git add public/index.html public/styles.css public/clientAnalyticsMarkup.test.js qa/admin-analytics-fullscreen.spec.js
git commit -m "feat(admin): make analytics control room full screen"
```

### Task 5: Implement the internal report-page controller and compact filters

**Files:**

- Create: `public/clientAnalyticsPage.js`
- Modify: `public/clientAnalytics.js`
- Modify: `public/clientAnalytics.test.js`
- Modify: `public/main.js`

**Interfaces:**

- Consumes: normalized analytics snapshots and existing URL filters.
- Produces: `createAnalyticsPageController({ root, filters, onApply })` with `setPage`, `nextPage`, `previousPage`, `openFilters`, `closeFilters`, `destroy`, and `snapshot`.

- [ ] **Step 1: Implement page state with URL compatibility.**

Use the exact page list:

```js
const ANALYTICS_PAGES = Object.freeze([
  'overview', 'match-health', 'rulesets', 'economy',
  'events', 'bots', 'quality'
]);
```

`setPage(id)` normalizes unknown values to `overview`, updates the existing `tab` URL parameter, updates `aria-selected`, and renders only the active report page. `nextPage()` and `previousPage()` wrap at the ends.

- [ ] **Step 2: Implement filter disclosure and focus restoration.**

`openFilters()` stores the opener, removes `is-hidden`, sets `aria-expanded=true`, moves focus to the first advanced control, and marks the background inert. `closeFilters()` restores the opener focus. Escape and backdrop click cancel without applying.

- [ ] **Step 3: Wire page keyboard controls.**

Tabs retain ArrowLeft/ArrowRight/Home/End behavior. When the pager has focus, ArrowLeft/ArrowRight call `previousPage()`/`nextPage()` without moving layout or animating the chart. The position status is a polite live region.

- [ ] **Step 4: Connect the existing analytics controller.**

`createAnalyticsController()` creates and destroys the page controller with the admin view. Snapshot refresh updates the active page without resetting the page index or filter disclosure state. No fetch URL or server response field changes.

- [ ] **Step 5: Run controller tests and lint.**

Run: `node public/clientAnalytics.test.js; npm run lint:client -- --quiet`

Expected: PASS.

- [ ] **Step 6: Commit the page controller.**

```text
git add public/clientAnalyticsPage.js public/clientAnalytics.js public/clientAnalytics.test.js public/main.js
git commit -m "feat(admin): add report page navigation and filter disclosure"
```

### Task 6: Replace hand-authored chart geometry with ECharts SVG output

**Files:**

- Modify: `public/clientAnalyticsCharts.js`
- Modify: `public/clientAnalyticsChartAdapter.js`
- Modify: `public/clientAnalytics.js`
- Modify: `public/clientAnalyticsCharts.test.js`

**Interfaces:**

- Consumes: existing descriptor modes, sanitized series, and the chart adapter from Task 3.
- Produces: a chart figure containing an ECharts SVG mount, summary, table toggle, and fallback state; no `geometry()` or custom SVG path builder remains.

- [ ] **Step 1: Add failing migration assertions.**

Read the adapter source once in the test with `readFileSync` and bind it to `sourceText` before the assertions.

Assert that rendered chart markup:

```js
assert.match(markup, /class="analytics-chart-engine"/);
assert.match(markup, /data-chart-engine="echarts-svg"/);
assert.doesNotMatch(sourceText, /function\s+geometry\s*\(/);
assert.match(markup, /class="analytics-chart-table"/);
assert.match(markup, /aria-describedby=/);
```

Assert every mode maps to an ECharts series type and that forced colors renders the table immediately.

- [ ] **Step 2: Implement the adapter-backed renderer.**

Keep `renderAnalyticsChart(container, series, options)` and `renderBoardMetricMap(container, board, options)` as compatibility exports. Render a fixed-size `.analytics-chart-engine` mount and a table first; call the lazy adapter to hydrate the engine. Pass `renderer: 'svg'`, `aria.show: true`, token colors, and explicit per-mode axis labels.

- [ ] **Step 3: Map the seven report modes.**

Use these option mappings:

| Mode | ECharts composition |
|---|---|
| `line` | `LineChart` with optional `AreaStyle`, square symbols, one scale per unit |
| `bar` | horizontal `BarChart` with zero-radius bars and labels |
| `stacked-bar` | horizontal stacked bars with token legend |
| `heatmap`/`cohort` | `HeatmapChart` with decal support |
| `histogram` | bar series over bounded buckets |
| `box` | custom box series built from sanitized quantiles |
| `scatter` | square scatter symbols and table parity |
| `funnel` | funnel series with explicit stage labels |
| `board` | existing topology order rendered as a read-only heatmap/map |

Mixed-unit inputs are split into small-multiple chart instances inside the same report page. No axis receives values from two units.

- [ ] **Step 4: Add lifecycle and failure handling.**

Dispose ECharts instances on page change, hidden admin view, and controller destroy. A script error changes the mount to `CHART ENGINE UNAVAILABLE` while keeping the table visible. A failed refresh keeps the last verified chart and status.

- [ ] **Step 5: Run chart tests and focused visual QA.**

Run: `node public/clientAnalyticsCharts.test.js; node public/clientAnalytics.test.js; npx playwright test -c qa/playwright.config.js qa/admin-analytics-visual.spec.js --project=desktop-1920 --workers=1`

Expected: PASS with an ECharts SVG mount and a chart/table pair for every panel; the removed adapter source contains no hand-authored `geometry()` helper.

- [ ] **Step 6: Commit the chart migration.**

```text
git add public/clientAnalyticsCharts.js public/clientAnalyticsChartAdapter.js public/clientAnalytics.js public/clientAnalyticsCharts.test.js
git commit -m "refactor(admin): render analytics through ECharts SVG adapter"
```

### Task 7: Give each report page a fixed, useful composition

**Files:**

- Modify: `public/clientAnalyticsCatalog.js`
- Modify: `public/clientAnalytics.js`
- Modify: `public/clientAnalyticsPage.js`
- Modify: `public/styles.css`
- Modify: `public/clientAnalytics.test.js`

**Interfaces:**

- Consumes: normalized snapshot fields already present in the current API.
- Produces: stable report compositions that fit the viewport without adding server fields or new dropdowns.

- [ ] **Step 1: Add descriptor tests for page composition.**

Assert each page declares a question, primary visual, secondary visual or context state, and an explicit empty state when data is missing. Assert that no descriptor includes raw identity fields.

- [ ] **Step 2: Implement the overview composition.**

Render six-or-fewer KPI cards, one large activity trend, one compact reliability visual, and the alert/context rail. Keep the first viewport free of data tables unless the operator explicitly opens one.

- [ ] **Step 3: Implement the domain compositions.**

Use the page-turn position for subviews:

```text
MATCH HEALTH: RELIABILITY → DURATION → RECONNECTS
RULESETS: ADOPTION → OUTCOMES → BOARD MAP
ECONOMY: ADOPTION → LIQUIDITY → VOLATILITY
EVENTS: ELIGIBILITY → RARITY → REWARDS
BOTS: PROVIDERS → OUTCOMES → LATENCY
QUALITY: FRESHNESS → COVERAGE → RETENTION
```

When a subview has no sanitized evidence, render `NO VERIFIED OBSERVATIONS` and keep the pager usable.

- [ ] **Step 4: Add stable loading and status shells.**

Reserve the chart mount height before ECharts loads. Keep `LOADING`, `REFRESHING`, `STALE`, `SUPPRESSED`, `UNAVAILABLE`, and `ADMIN ACCESS REQUIRED` states visible in the command strip and context rail.

- [ ] **Step 5: Run page tests and lint.**

Run: `node public/clientAnalytics.test.js; npm run lint:client -- --quiet`

Expected: PASS.

- [ ] **Step 6: Commit the report compositions.**

```text
git add public/clientAnalyticsCatalog.js public/clientAnalytics.js public/clientAnalyticsPage.js public/styles.css public/clientAnalytics.test.js
git commit -m "feat(admin): compose analytics report pages"
```

### Task 8: Accessibility, responsive, motion, and visual verification

**Files:**

- Modify: `qa/admin-analytics-fullscreen.spec.js`
- Modify: `qa/admin-analytics-visual.spec.js`
- Modify: `qa/analytics-console.spec.js`
- Modify: `docs/audit/admin-analytics-ui-audit-2026-09-15.md`

**Interfaces:**

- Consumes: the complete fixed shell and chart adapter.
- Produces: evidence for every required viewport and state.

- [ ] **Step 1: Add keyboard and dialog assertions.**

Cover tab Arrow keys, Home/End, pager Arrow keys, Escape/outside-click filter dismissal, focus restoration, `aria-busy`, table toggle, and chart-engine failure.

- [ ] **Step 2: Add responsive and overflow assertions.**

Run desktop 1920×1080, desktop 1366×768, tablet 1024×768, iPad Mini landscape, iPad Pro landscape, and 390×844. Assert no document overflow, no chart mount overflow, and no clipped focus ring.

- [ ] **Step 3: Add reduced-motion and forced-colors assertions.**

Reduced motion must set chart animation to false and remove page transition motion. Forced Colors must hide ECharts SVG and keep the data table visible.

- [ ] **Step 4: Capture native screenshots.**

Run:

```text
npx playwright test -c qa/playwright.config.js qa/admin-analytics-fullscreen.spec.js qa/admin-analytics-visual.spec.js --project=desktop-1920 --workers=1
```

Capture Overview, Match Health, Rulesets, Economy, Events, Bots, Quality, stale, empty, suppressed, and filter-dialog states under `qa-artifacts/admin-analytics-1920/`. Inspect each image at native resolution. The charts must be visible in the first viewport and the global music dock must remain intact.

- [ ] **Step 5: Run the complete browser matrix and unit suite.**

Run: `npm run test:full; npm run test:browser -- --workers=1; npm run lint:client -- --quiet; git diff --check`

Expected: all assertions pass; documented skips remain only the existing intentional skips.

- [ ] **Step 6: Update the audit with exact evidence.**

Record the final viewport counts, chart engine choice, fallback behavior, screenshot paths, and any detector limitation. Do not claim a WCAG certification; report tested contracts and known trade-offs.

- [ ] **Step 7: Commit verification evidence.**

```text
git add qa/admin-analytics-fullscreen.spec.js qa/admin-analytics-visual.spec.js qa/analytics-console.spec.js docs/audit/admin-analytics-ui-audit-2026-09-15.md qa-artifacts/admin-analytics-1920
git commit -m "test(admin): verify full-screen analytics control room"
```

### Task 9: Static quality review and handoff

**Files:**

- Review: all files changed by Tasks 1–8
- Create: `docs/audit/admin-analytics-fullscreen-review-2026-09-15.md`

**Interfaces:**

- Consumes: final branch diff, test results, screenshots, Impeccable output, and CodeScene output when authenticated.
- Produces: a merge-ready read-only review with P0–P3 findings.

- [ ] **Step 1: Run the Impeccable detector once on changed admin files.**

Run:

```text
C:\Users\jerem\.agents\skills\impeccable\scripts\impeccable.cmd detect --json public/index.html public/styles.css public/clientAnalytics.js public/clientAnalyticsPage.js public/clientAnalyticsCharts.js public/clientAnalyticsChartAdapter.js public/clientAnalyticsChartTheme.js
```

Separate incumbent global-shell findings from newly introduced admin findings.

- [ ] **Step 2: Run authenticated CodeScene review when `CS_ACCESS_TOKEN` is available.**

Run: `cs delta origin/main --include-metadata --output-format json --pretty`

If the token is missing, record `NOT RUN · CS_ACCESS_TOKEN unavailable`; do not claim a pass.

- [ ] **Step 3: Review architecture and motion manually.**

Use `frontend-design-review`, `web-design-guidelines`, `accessibility`, `game-ui-ux`, `kpi-dashboard-design`, `design-motion-principles`, `review-animations`, `code-architecture-review`, `thermo-nuclear-code-quality-review`, and `security-best-practices` lenses. Confirm:

- no second chart abstraction outside the adapter;
- no server/game changes;
- no page scroll or accidental global CSS changes;
- no chart unit mixing;
- no raw identity exposure;
- no `transition: all`, chart draw-in, or permanent compositor hint;
- no hidden control that remains focusable.

- [ ] **Step 4: Write the review report and resolve findings.**

Use P0–P3 severity, cite exact file/line, and fix all P0/P1 findings before handoff. Re-run the affected test slice after each fix.

- [ ] **Step 5: Commit the review report.**

```text
git add docs/audit/admin-analytics-fullscreen-review-2026-09-15.md
git commit -m "docs(admin): record full-screen analytics review"
```

## Final handoff checklist

- [ ] `git status --short --branch` is clean.
- [ ] `npm run test:full` passes in a process-capable environment.
- [ ] Full Playwright matrix passes with only documented skips.
- [ ] Native 1920×1080 screenshots were inspected, not merely generated.
- [ ] The global Poorup header and music dock are unchanged.
- [ ] No chart code uses the removed hand-authored SVG geometry.
- [ ] ECharts is local, lazy-loaded, SVG-rendered, and token themed.
- [ ] HTML tables remain available for every chart and forced-colors fallback.
- [ ] CodeScene status is accurately recorded.
- [ ] No push or merge occurs until separately authorized.
