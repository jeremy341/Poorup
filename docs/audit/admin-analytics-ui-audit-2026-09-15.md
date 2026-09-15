# Poorup Admin Analytics UI — Full UX/UI Audit

**Date:** 2026-09-15

**Reviewed surface:** `/admin/analytics`

**Scope:** Admin UI, chart presentation, interaction, accessibility, responsive behavior, motion, and visual consistency. Game logic, server telemetry, Socket.IO contracts, player-facing surfaces, and the existing global music dock are outside this audit.

## Executive verdict

The admin surface is coherent and usable at its target sizes. The reported filter-arrow defect was real: native `<select>` rendering placed the chevron too close to the right border. It is fixed with a scoped shell, explicit inset geometry, and a regression contract. No additional P0/P1 defects were found in the focused audit.

## Scores

| Dimension | Score | Evidence |
|---|---:|---|
| Task clarity and hierarchy | 4/4 | One question-led panel, six KPI maximum, primary/supporting/context regions |
| Accessibility | 4/4 | Native controls, labels, tablist keyboard path, table fallbacks, live states, Forced Colors and zoom coverage |
| Responsive layout | 4/4 | Desktop 1920/1366, 1024, iPad landscape, 390 and 200% zoom contracts pass |
| Theming and token use | 4/4 | Analytics colors map to Poorup semantic CSS variables; no per-panel palette drift |
| Chart readability | 4/4 | Units, summaries, table parity, readable axis labels, bounded geometry |
| Interaction feedback | 4/4 | Refresh/stale/empty/suppressed/unavailable states and focus-safe tab/filter behavior |
| Motion quality | 3.5/4 | Reduced Motion and hidden-view rules pass; no layout/path animation; only restrained state transitions |
| Performance and integrity | 4/4 | No dependency added, bounded series/rows, no layout reads in production rendering, no server/game changes |

**Overall:** 31.5/32 for this scoped surface. This is a design-quality score, not a legal or WCAG certification.

## Fixed issue

### Select-chevron alignment

**Root cause:** the browser-owned select arrow was rendered against the control edge; `padding: 0 9px` affected text placement but did not provide a predictable optical inset for the native arrow.

**Fix:** six analytics selects now use `.analytics-select-shell`. The select uses `appearance: none` with `padding-inline-end: 38px`; the shell draws a 7px two-border chevron at `right: 14px`. Focus and Forced Colors use the same geometry and semantic focus colors.

**Regression evidence:** `qa/analytics-console.spec.js` asserts the shell, `appearance: none`, at least 36px end padding, and a chevron inset of at least 12px at 1920px. The focused desktop contract passes.

## UX findings

### Passed

- The page answers “what can I do?” immediately: choose a period/filter, inspect a verified snapshot, switch one of seven views, or refresh.
- The first viewport is intentionally bounded to six KPI cards.
- KPI cards are informative rather than fake buttons.
- Each panel states a concrete analytical question.
- Missing fields are not silently converted to zero.
- Stale, suppressed, empty, 403, 429, 503, and network states preserve user orientation.
- URL state makes filtered views shareable without identity-bearing parameters.
- Specialized tabs now render supplied data through the same adapter and table fallback.
- Board map and chart interactions are read-only and cannot mutate game state.

### Remaining intentional trade-offs

- Funnel, Retention, Releases, and Live Ops contextual slots remain hidden until the server supplies their sanitized contracts. This avoids fabricated analytics.
- The current admin filter row is dense at 1920px but remains scannable through five-column wrapping and native labels; collapsing filters into a modal would add friction for operators who compare dimensions frequently.
- The global music dock is visible in screenshots because it is shared Poorup chrome; it is not part of analytics and was not moved or redesigned.

## UI craft review

- Poorup identity is unmistakable: dark teal surfaces, gold rules, pixel typography, square geometry, and restrained density.
- The control room uses hierarchy instead of a wall of equal-weight cards.
- Chart lines and bars remain readable at 1x; the table is the authoritative fallback.
- No new gradients, glass surfaces, neon accents, emoji controls, or generic component-library styling were introduced.
- Labels, units, definitions, and timestamps are visible in the KPI strip.
- Axis labels use viewBox-relative sizes that remain readable at all configured widths.

## Accessibility review

- One page-level `h1`, one named `main`, and seven `tabpanel` relationships.
- Every native filter has an associated label and meaningful `name`.
- Tablist supports Arrow keys, Home, End, Enter, and Space.
- Focus-visible outlines remain visible and do not depend on color alone.
- Charts expose captions, summaries, and real HTML data tables.
- Forced Colors hides decorative chart paths and leaves table data.
- Reduced Motion disables analytics-surface animation/transition behavior.
- 200% zoom retains content and avoids page-level horizontal overflow.
- Raw account, room, chat, private deal, IP, and User-Agent fields are denied before rendering.

## Responsive review

| Viewport | Result |
|---|---|
| 1920×1080 | Pass; ledger/context hierarchy, six KPIs, readable chevrons and chart labels |
| 1366×768 | Pass; compact split and wrapped filters |
| 1024×768 | Pass; tablet grid and touch-safe controls |
| iPad landscape | Pass; 7/5 context split and 44px controls |
| 390×844 | Pass; stacked panels, internal table scrolling, no page overflow |
| 200% effective zoom | Pass; content remains recoverable and tables remain usable |

## Motion review

- Frequent filter and tab interactions remain immediate.
- Refresh retains the last snapshot and does not animate layout dimensions.
- No `transition: all`, scale-from-zero, stroke-dash chart draw-in, keyboard-triggered travel, or unbounded hover motion was introduced.
- Reduced Motion and hidden-document handling are covered by browser contracts.
- The only continuous animation findings from the detector belong to existing non-admin Poorup world/audio surfaces and remain outside scope.

## Verification

- `node public/clientAnalyticsMarkup.test.js` — PASS.
- `node public/clientAnalytics.test.js` — PASS.
- `npm run lint:client -- --quiet` — PASS.
- `npx eslint qa/analytics-console.spec.js qa/admin-analytics-visual.spec.js --quiet` — PASS.
- Focused admin browser matrix — 121 passed, 5 intentional skips, 0 failures.
- Full project Playwright matrix before this tiny admin-only fix — 423 passed, 57 documented skips, 0 failures.
- Full `npm run test:full` before this tiny admin-only fix — PASS.
- Native 1920×1080 analytics screenshots inspected after the panel/KPI fixes; the latest focused run also verified the inset chevron.
- `git diff --check` — PASS.

## Detector disposition

The Impeccable detector was run once. Its degraded regex fallback reports pre-existing global shell patterns such as microcopy sizes, existing texture/shadow treatment, and existing world-loop motion. Those are deliberately not changed in an admin-only audit because changing them would redesign the player-facing Poorup shell and violate the scope. No detector finding identified a newly introduced analytics-specific defect after the scoped fix.

## Final recommendation

Keep this admin UI as the baseline. The next safe work is data-contract expansion for the optional contextual panels, not another visual rewrite. Any future change should preserve the seven-tab contract, the inset select shell, the chart/table parity, and the 1920px-first verification gate.
