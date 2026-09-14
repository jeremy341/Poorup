# Balancing Analytics Console — Design Specification

## Design Read

The analytics console is the operator’s parlor ledger: quiet, evidence-led, and dense enough for balancing work without becoming a generic SaaS dashboard. It should answer what is happening, where a rule diverges, and how reliable the evidence is while never exposing a player’s name or raw identity.

## Locked direction

**Parlor Control Ledger** extends the existing /admin/analytics view. It is an internal operations surface, not a new public product area and not a second analytics application. The current Poorup shell, fonts, dark teal surfaces, gold structure, square geometry, red/green semantics, and 1920×1080 priority remain authoritative.

The analytics privacy decision is locked:

- all metrics are aggregate-first;
- every player-level drilldown uses a keyed pseudonymous ID;
- display names, usernames, account IDs, room codes, chat, hidden cards, private loan terms, opponent secrets, and raw event payloads never reach the browser;
- cohorts with fewer than five eligible observations are suppressed;
- charts always have a table or text equivalent;
- labels say association, not causation.

## Information architecture

The existing direct route remains /admin/analytics. No public navigation tab is added.

Inside the current admin view:

1. **OVERVIEW** — six headline KPIs, completion trend, active capacity, and an alert strip.
2. **MATCH HEALTH** — starts/completions/stalls, duration, reconnects, AFK, bankruptcies, comebacks.
3. **RULESETS + BOARDS** — Classic/After Hours/Custom and Standard-40/Metro-52 adoption, duration, completion, and outcome distributions.
4. **ECONOMY** — loans, deals, market adoption, volatility, liquidation, short defaults, and negative-cash prevention.
5. **EVENTS + RARITY** — eligibility, warning-to-active conversion, choice turnout, duration, recovery, combinations, and achievement rarity.
6. **BOTS** — AI versus NO-AI placement, win share, action usage, fallback, auction decisions, and human comparison.
7. **DATA QUALITY** — event coverage, rollup freshness, queue depth, suppression counts, schema/revision coverage, and backup/readiness signals.

There is no raw-event browser. A drilldown opens the existing managed drawer/modal shell and contains an aggregate table plus pseudonymous rows only.

## Persistent filter bar

The filter bar stays above the active tab and is keyboard reachable:

- period: HOUR, DAY, WEEK, SEASON;
- season ID, when the selected period is SEASON;
- ruleset preset: ALL, CLASSIC, AFTER HOURS, CUSTOM;
- board variant: ALL, STANDARD-40, METRO-52;
- ruleset revision and balance revision;
- market complexity: ALL, BASIC, MARGIN, SHORTING, DERIVATIVES;
- bot mode: ALL, AI, NO-AI, HUMAN;
- event ID, when the active tab supports an event dimension;
- APPLY FILTERS, RESET, REFRESH.

The minimum cohort threshold is fixed at k=5 and is displayed as MIN COHORT 5; operators cannot lower it from the UI.

## Overview KPI contract

The first viewport shows no more than six KPI cards, each with a value, denominator, comparison period, timestamp, and definition:

| KPI | Definition | Required context |
|---|---|---|
| Completed rounds | Server-completed matches in the selected slice | started, completed, stalled |
| Completion rate | completed / started | denominator and suppression |
| Median round duration | Median seconds for completed rounds | p95 and sample count |
| Active rooms | Current gauge from metrics registry | generated time |
| Feature adoption | Eligible completed rounds using the selected feature | feature and denominator |
| Bot fallback rate | fallback decisions / AI decisions | provider and NO-AI comparison |

Cards are summaries, not buttons disguised as cards. A separate OPEN BREAKDOWN control opens a drilldown so the primary metric remains scannable.

## Metric definitions and fairness rules

All formulas are server-owned and versioned by seasonId, rulesetRevision, balanceRevision, and boardVariant.

### Match health

- startedMatches: matches that entered a started state.
- completedMatches: matches with a verified server settlement.
- stalledMatches: started matches with no completion and an explicit stall reason after the configured observation window.
- completionRate = completedMatches / startedMatches.
- durationMedian and durationP95 use completed server timestamps only.
- reconnect and AFK rates use event counts divided by started matches, never by page views.
- bot-only games are excluded from competitive reward metrics but remain in operations metrics.

### Rulesets and boards

For each ruleset/board cell return matches, completed, completionRate, medianDuration, and outcome distribution. An outcome difference is labeled ASSOCIATION; the UI never says that a board or feature caused a win.

### Economy and market

- adoption is matches with at least one legal action divided by eligible completed matches;
- volatility uses the versioned return series and exposes the observation count;
- liquidation rate is forced liquidations divided by margin-open positions;
- short-default rate is defaults divided by short positions;
- option exercise rate is exercises divided by fully collateralized options;
- negative-cash prevention counts rejected or clamped attempts without recording the submitted secret terms.

### Events and rarity

- eligibility count;
- warning-to-active conversion;
- choice turnout by event;
- median active duration and recovery rate;
- event combination frequency;
- achievement unlock rate by rarity;
- reward claim completion.

### Bots

AI, NO-AI, and human rows share the same legal action taxonomy. Show win share, median placement, completion rate, action adoption, auction decisions, and provider fallback. A fallback is an operational outcome, not a player identity.

### Association view

The console may compare a feature-exposed group with a control group only when both groups meet k=5. It displays:

- exposed rate and control rate;
- absolute percentage-point delta;
- relative rate delta;
- exposed and control sample sizes;
- selected ruleset, board, season, and balance revision;
- ASSOCIATION, NOT CAUSATION.

No causal claim, player ranking, or raw cohort export is produced.

## Privacy and pseudonymization

Create a server-only analyticsPrivacy.js boundary.

~~~js
createPseudonymizer({ key, version })
pseudonymize(accountId, { seasonId, rulesetRevision, balanceRevision })
sanitizeAnalyticsRow(row)
suppressedRow(reason = 'MIN_COHORT')
~~~

The pseudonym is P- plus a base64url or base32 encoding of HMAC-SHA-256 over scope + ":" + accountId, truncated to 12 uppercase characters. The scope includes seasonId, rulesetRevision, and balanceRevision so a player cannot be trivially linked across balance experiments. The key comes from POORUP_ANALYTICS_PSEUDONYM_KEY; there is no raw-ID fallback.

Rules:

- if a key is absent, aggregate panels still work and player drilldowns return PSEUDONYM_UNAVAILABLE, never a raw ID;
- the server response schema has no displayName, username, accountId, clientId, roomCode, or sessionToken field;
- every breakdown row contains either pseudonymId or suppressed=true;
- cohorts below k=5 return a single suppressed row with no exact count;
- pseudonym collisions are detected within a response and expanded to a longer digest before sending;
- the browser never computes, stores, or logs the HMAC key;
- server access logs record only the tab, range, and result status, not pseudonym rows or query payloads.

## Data flow

~~~text
server game settlement
  → allow-listed telemetry event
  → privacy sanitizer
  → bounded write queue
  → hourly/day rollup buckets
  → analytics projection + k-suppression
  → admin-authorized REST response
  → client normalizer
  → KPI cards, charts, and pseudonymous tables
~~~

The analytics path is read-only with respect to game state. A failed rollup or stale snapshot never changes a live round.

## Server contracts

Keep the existing GET /admin/analytics/summary?range=hour response backward compatible. Add versioned read models:

~~~text
GET /admin/analytics/summary?range=hour|day|week|season
GET /admin/analytics/balance?view=overview|match-health|rulesets|economy|events|bots|quality&...
GET /admin/analytics/drilldown?dimension=feature|ruleset|board|event|bot&metric=...
~~~

Every response has:

~~~json
{
  "success": true,
  "schemaVersion": 1,
  "generatedAt": "2026-09-13T12:00:00.000Z",
  "filters": {
    "range": "day",
    "seasonId": "season-01",
    "rulesetRevision": 1,
    "balanceRevision": 1,
    "boardVariant": "standard-40"
  },
  "pseudonymVersion": "hmac-v1",
  "suppression": { "minimumCohort": 5, "suppressedPanels": 0 },
  "overview": {},
  "series": [],
  "breakdowns": [],
  "dataQuality": {}
}
~~~

The server returns 403 for a non-admin account, 429 for the rate limit, and 503 for a stale/unavailable rollup. All responses use Cache-Control: no-store.

## Rollup schema

Add a bounded rollup store rather than scanning complete match files on every request:

~~~json
{
  "schemaVersion": 1,
  "bucketSize": "hour",
  "retentionDays": 30,
  "buckets": {
    "2026-09-13T12:00:00.000Z": {
      "dimensions": {
        "season-01|1|1|standard-40|classic": {
          "started": 12,
          "completed": 10,
          "durationSeconds": { "count": 10, "sum": 4200, "histogram": {} },
          "features": {},
          "events": {},
          "market": {},
          "bots": {}
        }
      },
      "actorRollups": {}
    }
  }
}
~~~

Actor rollups store only the HMAC pseudonym, aggregate counters, and the scope revision. They do not store a raw account ID. Until a retention policy is approved, the existing bounded telemetry limit remains the upper bound; no data expansion is allowed.

## File boundaries

### Server

- Create server/analyticsPrivacy.js for HMAC pseudonyms, suppression, and response redaction.
- Create server/analyticsRollupStore.js for bucketed counters, bounded retention, merge, and freshness.
- Create server/analyticsProjection.js for formulas, association calculations, and view-specific read models.
- Modify server/analyticsApi.js to keep the summary contract and add the versioned balance/drilldown builders.
- Modify server/server.js to register the new read-only routes, no-store headers, and rate-limit hooks.
- Modify server/telemetryModule.js and server/socketRuntime.js to emit only allow-listed dimensions and enqueue rollup updates.
- Reuse server/metricsRegistry.js for live operational gauges; do not copy the registry into a second metrics system.

### Client

- Modify public/index.html inside the existing view-admin-analytics shell only.
- Modify public/clientAnalytics.js for filters, tabs, loading/error/stale state, and response normalization.
- Create public/clientAnalyticsCharts.js for token-bound SVG sparklines and accessible table fallbacks.
- Modify public/styles.css for the existing panel/grid/typography system and responsive breakpoints.
- Do not add a public nav item, a chart library, a route that accepts player IDs, or a second admin shell.

## Interaction and state model

### Entry and authorization

1. Direct navigation to /admin/analytics runs the existing session check.
2. No session shows ADMIN ACCOUNT REQUIRED and no request is made.
3. A non-admin session receives ADMIN ACCESS REQUIRED; no data is rendered.
4. A valid admin sees the Overview skeleton, then the first verified snapshot.
5. The header always shows ADMIN ONLY, SYNCED <time>, and the active filter summary.

### Loading, stale, empty, and error

- Initial load: six skeleton rows with fixed heights, no layout shift.
- Refresh: retain the last verified snapshot, mark it REFRESHING, and disable duplicate requests.
- Timeout: keep the last snapshot, announce ANALYTICS REFRESH TIMED OUT, enable Retry.
- 503: show ROLLUP UNAVAILABLE, source timestamp, and Retry.
- Empty: show NO VERIFIED OBSERVATIONS FOR THIS FILTER with the filter reset action.
- Suppressed: show INSUFFICIENT COHORT and MIN COHORT 5, never a misleading zero.
- 403: remove all data from the DOM and show the existing authorization message.

### Keyboard and focus

- Tabs are a native tablist with aria-selected, arrow navigation, Home, End, Enter, and Space.
- The active panel has one heading and a live status region.
- Filter controls use native select/input/button elements.
- Opening a drilldown stores the trigger, traps focus in the existing managed modal, and restores focus on close.
- Refresh never moves focus.
- Charts are not focusable; their data table button is.

## Visual system

At 1920×1080:

- existing header remains unchanged;
- filter bar occupies one compact row below the header;
- KPI strip contains four cards plus two compact cards only when width permits;
- main content is an 8-column ledger and a 4-column context panel;
- charts use dark inset surfaces, 1px gold/teal rules, and stepped SVG paths;
- data tables use 66px minimum rows and the existing focus outline;
- no gradient, glass, pill-heavy card, emoji, or neon treatment.

At iPad landscape, the ledger/context split becomes 7/5 columns. At 390px, cards and charts stack with internal scrolling only. At 200% zoom, the table becomes the primary representation and no page-level horizontal scroll is introduced.

## Charts and accessibility

Charts are small explanatory marks, not decorative wallpaper:

- SVG viewBox coordinates are integer aligned;
- line and bar paths use the existing theme colors and a non-color label;
- every chart has a visible title, axis/unit labels, sample count, and a SHOW DATA TABLE control;
- suppressed or stale states are text and icon-coded;
- screen readers receive a concise summary through the existing polite live region, not every point;
- forced colors hides decorative paths and leaves the table;
- reduced motion disables chart draw-in and refresh transitions;
- all controls meet the existing 44px preferred target and WCAG 2.2 AA contrast.

## Telemetry allow-list

Each event kind has a fixed payload schema. Allowed dimensions are seasonId, rulesetRevision, balanceRevision, boardVariant, rulesetPreset, marketComplexity, eventId, actionId, botMode, provider, and coarse numeric outcomes. Unknown keys are rejected. No event may include chat, message text, hidden cards, private loan terms, opponent secrets, account display data, raw client IDs, or session tokens.

The pedestrian animation never emits telemetry. Decorative behavior cannot affect balancing metrics.

## Testing plan

### Server unit tests

Create:

- server/analyticsPrivacy.test.js
- server/analyticsRollupStore.test.js
- server/analyticsProjection.test.js
- server/analyticsApi.test.js additions

Cover:

- stable pseudonym within one scope and different pseudonym across scopes;
- no raw identity fields in any serialized response;
- missing-key drilldown suppression;
- k=5 suppression at 0, 4, 5, and 6 observations;
- completion, adoption, volatility, liquidation, rarity, bot, and association formulas;
- bot-only competitive exclusion;
- dimension/revision filters;
- bounded retention and bucket merge;
- stale rollup and invalid schema behavior;
- admin authorization, no-store headers, and rate-limit responses.

### Client tests

Extend public/clientAnalytics.test.js for:

- schema normalization and unknown-field removal;
- tabs, filters, reset, refresh, stale, empty, suppressed, 403, 429, and 503 states;
- pseudonym-only table rendering;
- escaped event labels and no raw identity text;
- no duplicate IDs or page overflow;
- focus restoration and no focus movement during refresh.

### Browser tests

Create qa/admin-analytics.spec.js and run at 1920×1080, 1366×768, 1024×768 landscape, iPad landscape, and 390×844:

- unauthorized, authorized, stale, empty, and suppressed views;
- keyboard tab navigation and modal focus;
- each filter combination and URL without account IDs;
- chart table fallback, forced colors, reduced motion, 200% zoom;
- no raw name/account ID in DOM, accessibility tree, network response, or screenshot text;
- no page overflow and stable card heights.

### Evaluator rubric

Use agentic-eval fixtures with known input events and expected read models. Score:

- formula correctness 40%;
- privacy/redaction 25%;
- filter/revision correctness 15%;
- state/error behavior 10%;
- accessibility and visual contract 10%.

The fixture suite must fail if a display name, username, account ID, room code, or raw event field appears anywhere in a response.

## Rollout

1. Add privacy sanitizer and rollup shadow writes while the existing summary endpoint remains unchanged.
2. Validate rollup counts against a deterministic fixture and current telemetry summary.
3. Add versioned balance/drilldown endpoints behind the existing admin allow-list.
4. Add Overview and filter bar using the current summary as a fallback.
5. Add Match Health, Rulesets + Boards, Economy, Events + Rarity, Bots, and Data Quality tabs.
6. Add pseudonymous drilldowns only after the HMAC key and k-suppression tests pass.
7. Run the browser/accessibility/visual suite and the architecture/anti-slop review.
8. Keep raw-event export out of the first release; consider a sanitized aggregate export only after a separate policy decision.

## Operational limits

- Poll at most every 30 seconds while the tab is visible; pause polling when hidden.
- Cancel in-flight requests when filters change or the view is hidden.
- Cache an identical query for 15 seconds in memory; never cache responses in the browser or CDN.
- Cap response series points at 168 hourly points or 90 daily points.
- Cap breakdown rows at 100 pseudonymous rows after suppression.
- Record rollup lag, queue depth, dropped/rejected event count, and suppression count in Data Quality.
- If the rollup is stale, show the last verified timestamp and never fabricate zeroes.

## Design pre-flight

- [x] Aggregate-only privacy decision is explicit.
- [x] Every drilldown uses pseudonymous IDs or suppression.
- [x] Existing admin route and Poorup shell are reused.
- [x] Six KPI cards maximum per first viewport.
- [x] Formula denominators, versions, and association language are specified.
- [x] Loading, stale, empty, error, 403, 429, 503, and suppression states are specified.
- [x] Keyboard, focus, screen-reader, reduced-motion, forced-colors, zoom, and responsive behavior are specified.
- [x] No raw-event browser, public navigation tab, chart dependency, or game-state mutation.

## Build handoff

Implement exactly this specification in the current vanilla Socket.IO/Express architecture. Keep the existing /admin/analytics entry point and metricsRegistry summary compatibility. Add the smallest server-side projection and client-side tab/chart layer that satisfies the contracts; do not expose raw identities, do not change live game logic, and do not turn aggregate evidence into player surveillance.
