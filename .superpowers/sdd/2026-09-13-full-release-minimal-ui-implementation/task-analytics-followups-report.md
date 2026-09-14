# Analytics follow-up hardening report

## Commit

`0a25c84d20c6af0e06e26ff38fcfbc3da9ba103e` — `fix: complete analytics telemetry follow-ups`

## Verification

Focused analytics/runtime/telemetry/projection/client suites passed with 0 failures:

- `server/analyticsRuntime.test.js`
- `server/analyticsPrivacy.test.js`
- `server/analyticsRollupStore.test.js`
- `server/analyticsProjection.test.js`
- `server/analyticsApi.test.js`
- `server/analytics-route-security.test.js`
- `server/telemetryModule.test.js`
- `server/summary-privacy-audit.test.js`
- `public/clientAnalytics.test.js`

Scoped ESLint passed with 0 errors and 0 warnings for the analytics, telemetry, runtime seam, and chart/controller files.

## Fix summary

- Logged event telemetry accepts bounded `roundNumber` values for applicable event kinds.
- Bot outcome events carry `botMode` and `botOnly`, and match lifecycle helpers record idempotent starts/stalls.
- Telemetry flushes attached rollups, closes both stores, bounds pending queues, and safely handles async persistence.
- Rollup nested maps and scoped actor keys are bounded; version enums and nested payload shapes are validated.
- Direct snapshot event/bot/provider filtering and full actor scope filtering are enforced.
- Drilldowns honor dimension/metric filters; association relative deltas survive server and client sanitization.
- Chart output has reduced-motion/forced-colors fallbacks, table ARIA state, and non-negative bar heights.

## Parent integration note

The parent-owned `server.js` routes/rollup wiring remains required for end-to-end activation. The analytics client still requires the parent-owned tab/filter/panel/chart markup and styles.

## Recheck fixes

`9c8dad55ea4dda13147d9d820a2139f3dd7ef0f0` — `fix: close analytics runtime durability gaps`

- Runtime logged events now accept bounded round numbers; bot outcomes carry AI/NO-AI and bot-only markers; lifecycle start/stall telemetry is idempotent and versioned.
- Telemetry flushes attached rollups and closes both stores durably, including async-writer updates recorded during shutdown; failed queues remain bounded.
- Rollup flushes are synchronous for synchronous writers while preserving async retry semantics; nested and version-validation regressions remain green.
- Direct snapshot filters, full actor scopes, drilldown dimension/metric routing, relative association deltas, and chart ARIA/reduced-motion/forced-color/non-negative-bar contracts are covered.

Final recheck command set: all listed analytics/runtime/privacy/rollup/projection/API/security/telemetry/client suites passed with 0 failures; scoped ESLint passed with 0 errors and 0 warnings.
