# Admin Analytics UI batch report

Status: IMPLEMENTED AND VERIFIED

Implementation commit: `e970b56` - `feat: structure admin analytics control room`

## Tests

- `node public/clientAnalyticsMarkup.test.js` - PASS
- `node public/clientAnalytics.test.js` - PASS (31 checks)
- `npm run lint:client -- --quiet` - PASS
- `npx eslint qa/analytics-console.spec.js qa/admin-analytics-visual.spec.js` - PASS
- `npx playwright test -c qa/playwright.config.js qa/analytics-console.spec.js qa/admin-analytics-visual.spec.js --workers=1` - PASS: 91 passed, 5 intentional skips (native-desktop evidence test on non-1920 projects)

The Playwright matrix covered desktop 1920, desktop 1366, tablet 1024, mobile 390, iPad Mini landscape, and iPad Pro landscape. It exercised no-session authorization, 403 clearing, seven tabs, ten filters, URL restoration, reset/apply, stale, empty, suppressed, 429, 503, focus/roving tab behavior, 200% zoom, reduced motion, forced colors, overflow, and privacy boundaries including raw IP/User-Agent field names.

## Screenshot evidence

Native 1920 x 1080 Chromium captures were created and inspected at:

`qa-artifacts/admin-analytics-1920/`

Files: `overview-verified.png`, `match-health-verified.png`, `rulesets-verified.png`, `economy-verified.png`, `events-verified.png`, `bots-verified.png`, `quality-verified.png`, `state-stale.png`, `state-empty.png`, and `state-suppressed.png`.

The committed evidence index is [qa-artifacts/admin-analytics-1920/README.md](../../../qa-artifacts/admin-analytics-1920/README.md). The PNGs remain local ignored artifacts so the evidence stays available in the shared workspace without adding binary files to the commit.

## Files changed

- `public/index.html` - Poorup-native admin shell, skip link, explicit question-led panel metadata, seven stable panel slots, ten explicit filter labels/IDs, six-card KPI mount, alerts/live status, and hidden optional context slots.
- `public/styles.css` - token-bound analytics semantic roles, 8/4 desktop ledger/context layout, 7/5 tablet split, stacked mobile layout, stable SVG sizing, table overflow handling, forced-colors fallback, reduced-motion rules, and touch-safe controls.
- `public/clientAnalytics.js` - status state metadata, aria-busy/live alert updates, and last-verified presentation.
- `public/clientAnalyticsMarkup.test.js` - static shell, metadata, labels, slot, state, and privacy contracts.
- `qa/analytics-console.spec.js` - shell, explicit filter label, optional-slot, and privacy browser checks.
- `qa/admin-analytics-visual.spec.js` - fixture-backed state, keyboard, responsive, privacy, forced-colors, reduced-motion, and native screenshot evidence coverage.
- `qa-artifacts/admin-analytics-1920/README.md` - screenshot inventory and inspection notes.

## Concerns

- The one-time Impeccable detector exited 0 but ran in degraded regex fallback because `htmlparser2`, `css-select`, `css-tree`, and `domutils` are unavailable. It returned no findings, but custom-property, selector-match, and computed-contrast checks were not evaluated.
- The existing SVG chart adapter remains intentionally out of scope for this batch. Its current geometry is sparse and the screenshot evidence relies on the semantic table fallback for complete data detail; chart normalization/rendering should continue in the chart-owner batch.
- Playwright initially hit a transient Windows `spawn EPERM` and one iPad trace-cleanup `ENOENT`; reruns with one worker passed. No app assertion failed from those environment issues.

## Review-fix round

Status: IMPLEMENTED AND VERIFIED

Review-fix commit: `a05ecb4` - `fix: render admin analytics review findings`

The whole-branch review findings were addressed within the UI-owned scope:

- Added local panel descriptors/data mapping in `public/clientAnalytics.js` for all six specialized tabs. Match Health, Rulesets + Boards, Economy, Events + Rarity, Bots, and Data Quality now select sanitized per-panel fields from `breakdowns[0]`, mount the existing chart adapter, and retain an explicit `NO VERIFIED OBSERVATIONS FOR THIS PANEL` state when fields are absent. Optional contextual slots remain hidden because no sanitized contracts are supplied.
- KPI cards now render unit-aware values (including percent and seconds formatting), numerator/denominator context, comparison baseline/delta/period when provided, definitions, and verified timestamps. Missing comparison fields remain `N/A` or `COMPARISON UNAVAILABLE` rather than fabricated values.
- Chart axis/unit text is now sized with a valid Poorup numeric token and responsive SVG user-unit values (`2px`, `2.2px` at narrow tablet, `2.4px` on mobile), with browser assertions across every configured viewport and forced-color fallback coverage.
- Added fixture-backed browser assertions for supplied specialized values, honest missing-field states, KPI metadata, and axis label rendered-size bounds; updated shell expectations for seven chart mounts.
- Refreshed and inspected all ten native 1920 x 1080 screenshots. Specialized verified captures now show chart data instead of WAITING placeholders.

Review-fix verification:

- `node public/clientAnalyticsMarkup.test.js` - PASS
- `node public/clientAnalytics.test.js` - PASS (32 checks)
- `npm run lint:client -- --quiet` - PASS
- `npx eslint qa/analytics-console.spec.js qa/admin-analytics-visual.spec.js` - PASS
- `npx playwright test -c qa/playwright.config.js qa/analytics-console.spec.js qa/admin-analytics-visual.spec.js --workers=1` - PASS: 115 passed, 5 intentional non-1920 evidence skips
- Screenshot dimensions verified as 1920 x 1080 for all ten PNGs in `qa-artifacts/admin-analytics-1920/` and each image was inspected at native resolution.

Remaining concerns are tooling-only: the Impeccable detector previously exited 0 in degraded regex fallback because parser modules are unavailable. The existing chart adapter remains unchanged by design; this round only supplies its per-panel sanitized series and table mounts.
