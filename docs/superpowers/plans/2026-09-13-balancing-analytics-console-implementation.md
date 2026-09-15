# Balancing Analytics Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing admin analytics view into an aggregate-only balancing console with versioned formulas, privacy-preserving pseudonymous drilldowns, reliable rollups, and an accessible Poorup-native UI.

**Architecture:** Keep the existing Express/Socket.IO modular monolith and the current read-only /admin/analytics entry point. Add a server-side privacy boundary, bounded rollup projection, and versioned read models; extend the existing vanilla client with tabs, filters, SVG charts, tables, and managed drilldowns. The console consumes telemetry and metrics but never mutates live game state.

**Tech Stack:** Node.js ES modules, Express 4, vanilla HTML/CSS/JavaScript, existing metricsRegistry and TelemetryStore seams, JSON persistence while single-process, SVG charts, Node assertion tests, Playwright, ESLint, c8, and the existing CodeScene/CI commands. No chart library or runtime package is added.

**Spec:** .ulpi/design/BALANCING-ANALYTICS-CONSOLE.md, .ulpi/design/DESIGN.md, PRODUCT.md, docs/production-hardening.md.

## Global Constraints

- Analytics is internal and admin-authorized only; no public navigation link or public API is added.
- Every drilldown is aggregate-first and returns pseudonymous IDs only. Display names, usernames, raw account IDs, client IDs, room codes, chat, hidden cards, private loan terms, opponent secrets, session tokens, and raw event payloads never reach the browser.
- A fixed minimum cohort of k=5 suppresses small groups. The operator cannot lower k from the UI or query string.
- Pseudonyms are keyed HMAC values scoped by seasonId, rulesetRevision, and balanceRevision. There is no raw-ID fallback.
- Formulas and denominators are server-owned, versioned, and labeled association rather than causation.
- The existing /admin/analytics/summary response remains backward compatible.
- The server remains authoritative for all game, market, reward, and telemetry writes. Analytics failures cannot alter a round.
- Reuse the current Poorup design system: dark teal surfaces, gold rules, red/green semantic colors, pixel typography, square geometry, compact spacing, and 1920×1080 visual priority.
- Use native controls, WCAG 2.2 AA contrast, visible focus, live-region status, 44px preferred targets, reduced-motion behavior, forced-colors fallback, and no page-level overflow.
- Keep the first viewport to six or fewer headline KPIs and avoid decorative chart noise.
- Poll only while visible, cache only in bounded server memory, use no-store responses, and cap series/row counts.

## Existing seams and file ownership

| Responsibility | Existing seam | Planned file |
|---|---|---|
| Admin authorization | analyticsApi.js and server.js admin session guard | server/analyticsApi.js, server/server.js |
| Live operational gauges | metricsRegistry.js | Reuse without duplication |
| Allow-listed event input | telemetryModule.js and socketRuntime.js | server/telemetryModule.js, server/socketRuntime.js |
| Privacy projection | None | server/analyticsPrivacy.js |
| Bounded rollups | TelemetryStore full-event array | server/analyticsRollupStore.js |
| Formula/read models | buildAnalyticsSummary | server/analyticsProjection.js |
| Admin UI | clientAnalytics.js and view-admin-analytics | public/clientAnalytics.js, public/index.html |
| Charts | None | public/clientAnalyticsCharts.js |
| Styling | Existing panel/grid/token CSS | public/styles.css |
| Tests | analyticsApi.test.js, clientAnalytics.test.js | New server/client/browser suites |

## Task 1: Lock the privacy contract and pseudonymizer

**Files:**

- Create: server/analyticsPrivacy.js
- Create: server/analyticsPrivacy.test.js
- Modify: server/telemetryModule.js
- Modify: server/telemetryModule.test.js

**Interfaces:**

- createPseudonymizer({ key, version = "hmac-v1" }) returns pseudonymize(accountId, scope) and version.
- pseudonymize(accountId, { seasonId, rulesetRevision, balanceRevision }) returns P- plus a 12-character uppercase base64url digest when key and account ID are valid; it returns null when the key or ID is absent.
- sanitizeAnalyticsRow(row) returns a new object containing only allow-listed aggregate fields and pseudonymId or suppressed.
- suppressedRow(reason = "MIN_COHORT") returns { suppressed: true, suppressionReason: reason } with no exact count.
- MIN_COHORT is exported as 5 and PSEUDONYM_VERSION is exported as hmac-v1.

- [ ] Step 1: Write failing tests for stable pseudonyms within one scope, different pseudonyms across season/revision scopes, missing keys, malformed IDs, and no raw identity fields in serialized rows.
- [ ] Step 2: Run node server/analyticsPrivacy.test.js and confirm the module is absent.
- [ ] Step 3: Implement HMAC-SHA-256 with the server key, scope string seasonId|rulesetRevision|balanceRevision|accountId, base64url encoding, collision detection within one response, and redaction.
- [ ] Step 4: Extend telemetry sanitization to reject displayName, username, accountId, clientId, roomCode, chat, hiddenCards, privateLoanTerms, opponentSecrets, password, and sessionToken at ingestion.
- [ ] Step 5: Run node server/analyticsPrivacy.test.js and node server/telemetryModule.test.js.
- [ ] Step 6: Commit with feat: add aggregate analytics privacy boundary.

## Task 2: Add bounded rollup storage and queue integration

**Files:**

- Create: server/analyticsRollupStore.js
- Create: server/analyticsRollupStore.test.js
- Create: server/writeQueue.js only if the shared queue does not already exist
- Modify: server/telemetryModule.js
- Modify: server/socketRuntime.js

**Interfaces:**

- createAnalyticsRollupStore({ filePath, now, retentionDays, maxBuckets, persist }) returns record(event), query(filters), health(), flush(), and close().
- record(event) returns { accepted, bucketKey, sequence }; it rejects unknown event kinds or dimensions without mutating the rollup.
- query(filters) returns { schemaVersion, generatedAt, sourceWindow, dimensions, actorRollups, quality }.
- health() returns { loaded, fresh, lagSeconds, pendingWrites, rejectedEvents }.
- If a shared queue is created, createWriteQueue({ flush, maxPending, flushIntervalMs }) returns enqueue, flushNow, pendingCount, and close; failed flushes retain records.

- [ ] Step 1: Add rollup fixtures for match completion, event eligibility, market volatility, market liquidation, achievement rarity, reward claim, bankruptcy, comeback, and bot outcome.
- [ ] Step 2: Add tests for hourly bucket merge, dimension filtering, retention pruning, schema rejection, queue ordering, one flush for 400 records, and retry after a thrown write.
- [ ] Step 3: Run node server/analyticsRollupStore.test.js and observe the missing rollup/queue behavior.
- [ ] Step 4: Implement a bounded JSON rollup with hourly buckets, a configurable retention ceiling, atomic persistence callback, and separate actor aggregate counters.
- [ ] Step 5: Change telemetry settlement writes from a full-file write per event to one queued rollup update per settlement batch; preserve the existing MAX_EVENTS cap until a retention decision is supplied.
- [ ] Step 6: Add the version dimensions seasonId, rulesetRevision, balanceRevision, boardVariant, rulesetPreset, marketComplexity, eventId, actionId, botMode, and provider after allow-list validation.
- [ ] Step 7: Run node server/analyticsRollupStore.test.js, node server/telemetryModule.test.js, node server/audit-rooms-settle.test.js, and the existing persistence tests.
- [ ] Step 8: Commit with perf: batch balancing analytics rollups safely.

## Task 3: Implement versioned formulas and suppressed read models

**Files:**

- Create: server/analyticsProjection.js
- Create: server/analyticsProjection.test.js
- Modify: server/analyticsApi.js

**Interfaces:**

- normalizeAnalyticsQuery(input) returns { range, from, to, seasonId, rulesetRevision, balanceRevision, boardVariant, rulesetPreset, marketComplexity, botMode, eventId, tab } with allow-listed values and fixed k=5.
- buildOverview(rollup, query) returns six or fewer KPI objects with value, denominator, comparison, generatedAt, and definition.
- buildMatchHealth(rollup, query) returns starts, completions, stalls, duration median/p95, reconnect rate, AFK rate, bankruptcies, and comebacks.
- buildRulesetBoard(rollup, query) returns rows with ruleset/board dimensions, matches, completed, completionRate, medianDuration, and outcome distribution.
- buildEconomy(rollup, query) returns adoption, volatility, liquidation, short-default, option-exercise, and negative-cash-prevention measures.
- buildEventsRarity(rollup, query) returns eligibility, warning-to-active conversion, turnout, duration, recovery, combinations, unlock rarity, and reward claims.
- buildBots(rollup, query) returns AI, NO-AI, and human comparison rows using the same legal action taxonomy.
- buildAssociation(rollup, query, feature) returns exposed/control rates, percentage-point delta, relative delta, sample sizes, and an explicit association label only when both groups meet k=5.
- buildDataQuality(rollup, query) returns freshness, event coverage, queue depth, rejected events, suppression count, schema version, and revision coverage.

- [ ] Step 1: Write golden-vector fixtures with exact started, completed, stalled, duration, feature, event, market, rarity, bot, and association counts.
- [ ] Step 2: Add tests for every denominator, zero denominator, k=5 boundary, bot-only exclusion from competitive metrics, season/revision/board filters, and no causal wording.
- [ ] Step 3: Run node server/analyticsProjection.test.js and confirm formula failures.
- [ ] Step 4: Implement formulas using integer-safe counters and explicit null/suppressed values instead of fabricated zeroes.
- [ ] Step 5: Add Wilson interval values only when both groups have at least k=5; label them descriptive uncertainty, not a causal estimate.
- [ ] Step 6: Run the projection tests and node server/season-reward-audit.test.js to confirm the analytics layer does not alter reward calculations.
- [ ] Step 7: Commit with feat: add versioned balancing read models.

## Task 4: Extend the protected analytics API

**Files:**

- Modify: server/analyticsApi.js
- Modify: server/server.js
- Create: server/analyticsApi.test.js additions
- Create: server/analytics-route-security.test.js

**Interfaces:**

- Keep buildAnalyticsSummary(registry, accountId, adminIds, range) and its existing success/error shape.
- Add buildAnalyticsBalance({ rollup, registry, accountId, adminIds, query }).
- Add buildAnalyticsDrilldown({ rollup, accountId, adminIds, query }).
- Both new builders return { success, schemaVersion, generatedAt, filters, pseudonymVersion, suppression, overview, series, breakdowns, dataQuality } on success.
- Unauthorized responses remain { success: false, status: 403, error: "Forbidden." }.
- Stale rollup responses return status 503 with no partial private rows; rate-limited responses return 429.

- [ ] Step 1: Add API tests for authorized and unauthorized summary/balance/drilldown requests, no-store headers, malformed filters, unknown tabs, stale rollup, and missing pseudonym key.
- [ ] Step 2: Add a serialization test that recursively rejects displayName, username, accountId, clientId, roomCode, chat, hiddenCards, privateLoanTerms, opponentSecrets, password, and sessionToken anywhere in the response.
- [ ] Step 3: Run node server/analyticsApi.test.js and node server/analytics-route-security.test.js and record failures.
- [ ] Step 4: Add the two read-only routes under /admin/analytics, reuse the configured admin allow-list and HTTP limiter, set Cache-Control: no-store, and never accept an account ID in the route.
- [ ] Step 5: Return the existing summary data as a fallback while the rollup is cold, with an explicit DATA SOURCE: LIVE METRICS label.
- [ ] Step 6: Run the focused API/security tests and node server/server.test.js.
- [ ] Step 7: Commit with feat: expose privacy-safe balancing analytics endpoints.

## Task 5: Build the Poorup-native admin console

**Files:**

- Modify: public/index.html
- Modify: public/clientAnalytics.js
- Create: public/clientAnalyticsCharts.js
- Modify: public/styles.css
- Modify: public/clientAnalytics.test.js

**Interfaces:**

- normalizeAnalyticsSnapshot(value) remains backward compatible with the current summary shape and additionally returns schemaVersion, filters, suppression, overview, series, breakdowns, and dataQuality.
- createAnalyticsController({ fetcher, announce, modal }) returns load(query), refresh(), setTab(tab), setFilters(filters), openDrilldown(trigger, query), and destroy().
- renderAnalyticsChart(container, series, options) returns an accessible chart element plus a data-table toggle; it never reads raw event data.
- renderAnalyticsSnapshot(snapshot) returns the normalized snapshot and never renders a field outside the allow-list.

- [ ] Step 1: Add client tests for tab navigation, filter normalization, schema stripping, pseudonym-only rows, k suppression, unknown labels, and all loading/stale/empty/error states.
- [ ] Step 2: Add a browser fixture with six KPI values, two series, one suppressed breakdown, and one pseudonymous row; assert no raw identity text is rendered.
- [ ] Step 3: Run node public/clientAnalytics.test.js and confirm the current simple-grid assumptions fail.
- [ ] Step 4: Extend the existing view-admin-analytics markup with a native tablist, filter row, six-card KPI strip, main ledger, context panel, chart slots, table fallbacks, and a live status region. Keep the existing header and admin-only entry.
- [ ] Step 5: Add Overview, Match Health, Rulesets + Boards, Economy, Events + Rarity, Bots, and Data Quality tab panels. Only the active panel is visible and only its controls are in the tab order.
- [ ] Step 6: Add native select/input/button filters with a fixed MIN COHORT 5 indicator, Apply/Reset/Refresh controls, and a snapshot timestamp.
- [ ] Step 7: Implement token-bound SVG sparklines and bars with integer coordinates, labeled units, sample counts, and a SHOW DATA TABLE button. Keep charts non-focusable; focus the table control.
- [ ] Step 8: Use the existing managed modal/drawer for drilldowns. Store the trigger, trap focus, restore focus on close, and show pseudonym IDs or suppressed rows only.
- [ ] Step 9: Add fixed-height skeletons, last-verified stale snapshots, retryable timeout/503 states, 403 no-data state, and suppressed/empty copy.
- [ ] Step 10: Add responsive CSS: 1920 layout with 8/4 ledger/context columns, iPad landscape 7/5, and 390px stacked sections with internal scrolling only. Preserve 44px controls and no page overflow.
- [ ] Step 11: Add reduced-motion and forced-colors rules that disable chart draw-in and leave the table representation.
- [ ] Step 12: Run node public/clientAnalytics.test.js, node public/clientResponsiveA11y.test.js, and client lint.
- [ ] Step 13: Commit with feat: build the aggregate balancing analytics console.

## Task 6: Add browser, accessibility, and privacy evidence

**Files:**

- Create: qa/admin-analytics.spec.js
- Create: qa/admin-analytics-privacy.spec.js
- Modify: qa/playwright.config.js only when a fixture or viewport is missing
- Create: qa-artifacts/admin-analytics-1920/README.md

**Interfaces:**

- Tests use the existing admin fixture and never place real credentials or pseudonym keys in source control.
- Required viewports are 1920×1080, 1366×768, 1024×768 landscape, iPad landscape, and 390×844.
- Screenshot names include tab, viewport, commit, and state.

- [ ] Step 1: Add authorized/unauthorized route tests and assert no data request for a missing session.
- [ ] Step 2: Add tests for every tab, filter combination, refresh, stale, empty, suppressed, 403, 429, and 503 state.
- [ ] Step 3: Add keyboard tests for tablist arrows/Home/End/Enter/Space, filter controls, drilldown open/close, Escape, and focus restoration.
- [ ] Step 4: Add accessibility tests for headings, landmarks, live regions, table fallback, focus visibility, target size, and no color-only status.
- [ ] Step 5: Add network/DOM/accessibility-tree assertions that no display name, username, account ID, room code, raw event key, chat, or private field appears.
- [ ] Step 6: Add reduced-motion, forced-colors, 200% zoom, hidden-tab polling pause, and no-page-overflow checks.
- [ ] Step 7: Run npx playwright test -c qa/playwright.config.js qa/admin-analytics.spec.js qa/admin-analytics-privacy.spec.js.
- [ ] Step 8: Capture and inspect every analytics tab at native 1920×1080; record dimensions and findings in qa-artifacts/admin-analytics-1920/README.md.
- [ ] Step 9: Commit with test: cover admin analytics privacy and accessibility.

## Task 7: Evaluate formulas and prevent regression drift

**Files:**

- Create: server/analytics-evaluation-fixtures.js
- Create: server/analytics-evaluation.test.js
- Modify: package.json
- Modify: docs/production-hardening.md

**Interfaces:**

- Fixtures contain deterministic event streams and expected read models; they contain no real accounts or names.
- The evaluator returns { formulaScore, privacyScore, filterScore, stateScore, accessibilityScore, totalScore }.
- Required minimums are formula 1.0, privacy 1.0, filters 1.0, state 0.9, accessibility 0.9, total 0.95.

- [ ] Step 1: Add fixtures for a completed Classic game, Metro game, bot-only game, mixed AI/NO-AI game, suppressed cohort, stale rollup, and option/market event stream.
- [ ] Step 2: Add evaluator tests that fail on denominator drift, causal wording, raw identity leakage, bot-only reward inclusion, or a missing revision dimension.
- [ ] Step 3: Run node server/analytics-evaluation.test.js and record baseline failures.
- [ ] Step 4: Implement the deterministic evaluator and add it to npm run test:audit.
- [ ] Step 5: Run the evaluator and all analytics unit tests.
- [ ] Step 6: Commit with test: pin analytics formulas and privacy invariants.

## Task 8: Review architecture, motion, and release readiness

**Files:**

- Review all files from Tasks 1–7.
- Create: docs/audit/balancing-analytics-review-2026-09-13.md

**Interfaces:**

- The review consumes the real merge-base diff, manifest, test output, and native screenshots.
- Findings use P0–P3 severity, exact file/function/line references, and a regression command.
- The review cannot authorize legal policy, retention, licensing, or infrastructure changes.

- [ ] Step 1: Run software-architecture-design and code-architecture-review for module boundaries, rollup consistency, cache scope, and no game-state coupling.
- [ ] Step 2: Run security-best-practices for HMAC key handling, admin authorization, no-store responses, rate limits, injection, and log redaction.
- [ ] Step 3: Run kpi-dashboard-design for KPI count, denominators, comparison context, alert fatigue, and drilldown usefulness.
- [ ] Step 4: Run frontend-design-review, frontend-design-ui-ux, design-taste-frontend, impeccable, game-ui-ux, mobile-responsiveness, accessibility, and web-design-guidelines against the existing Poorup design authority and screenshots.
- [ ] Step 5: Run svg-design for chart geometry and pixel-safe rendering; run animate, emilkowal-animations, design-motion-principles, improve-animations, and review-animations. Delete chart motion that lacks purpose; reject layout-property animation, scale(0), ease-in, ungated hover, and keyboard-triggered movement.
- [ ] Step 6: Run qa-agent-testing and agentic-eval against the fixture and browser matrix.
- [ ] Step 7: Run grill-me, improve-codebase-architecture, thermo-nuclear-code-quality-review, and install-anti-slop. Reject duplicated registries, raw identity escape hatches, giant render methods, and generic dashboard patterns.
- [ ] Step 8: Resolve P0/P1 findings with a new failing test, rerun the affected suite, and update the review report.
- [ ] Step 9: Commit with chore: review balancing analytics for release.

## Operational and policy gates

The implementation can proceed with aggregate fixtures and a required environment variable, but production activation needs explicit operator decisions:

1. Set POORUP_ANALYTICS_PSEUDONYM_KEY as a secret. If absent, summaries work and all player drilldowns stay suppressed.
2. Choose retention duration for rollup and actor aggregates. Until chosen, retain no more than the current bounded telemetry cap.
3. Confirm which accounts are admins and keep the existing explicit allow-list; do not infer admin status from a username.
4. Confirm whether association panels are acceptable for balancing review and keep the ASSOCIATION, NOT CAUSATION label.
5. Confirm a support/privacy policy if pseudonymous operator analysis is disclosed to players.

No public SEO, social preview, account deletion, legal copy, or external provider feature is part of this console plan; those remain in the separate release-readiness plan and must not be smuggled into analytics.

## Rollout and rollback

1. Ship privacy sanitizer and shadow rollups while the current summary endpoint remains unchanged.
2. Compare rollup fixtures with live metrics and run the evaluator.
3. Enable versioned endpoints for the configured admin account only.
4. Ship the Overview tab and filters.
5. Ship the remaining tabs and pseudonymous drilldowns after key/suppression checks.
6. Run browser, accessibility, visual, load, and CodeScene review.
7. Roll back by reverting the analytics commits and disabling the versioned routes; existing game telemetry and summary behavior remain available.

## Acceptance criteria

- The existing summary endpoint remains compatible and unauthorized callers receive no data.
- Every drilldown contains pseudonymous IDs or suppression, never names or raw identifiers.
- k=5 suppression, scoped HMAC pseudonyms, no-store headers, rate limits, and log redaction pass tests.
- Formulas show denominators, version dimensions, timestamps, and association language.
- Six or fewer KPI cards, seven named tabs, fixed filter semantics, chart tables, and all state variants work.
- Admin UI preserves Poorup layout, typography, surfaces, focus behavior, responsive breakpoints, and 1920×1080 visual quality.
- No chart or refresh animation violates reduced motion, forced colors, transform/opacity, or keyboard rules.
- Telemetry and rollups are bounded, batched, retryable, and isolated from live game state.
- Unit, evaluator, browser, accessibility, lint, coverage, load, and architecture reviews pass.
