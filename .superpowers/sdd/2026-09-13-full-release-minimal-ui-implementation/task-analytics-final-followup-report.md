# Analytics premerge final follow-up report

## Commit

`2734ef13a028b7149a1eaf9cedbe03b3662f2d88` — `fix: render analytics tab read models`

The parent’s concurrent `0545063`/`757c6e7` commits carried the earlier client activation work; this focused commit adds the remaining nested read-model contract and regressions.

## Fix summary

- Client normalization now preserves the narrowly allow-listed `rows` field for Rulesets, Economy, Events, Bots, and Quality responses while continuing to remove unknown/raw fields.
- Active panels deliberately flatten nested tab rows into accessible tables and render nested measures with denominator context.
- Existing client behavior now covers tab loading/query preservation, stale snapshot retention, season/revision filter encoding, in-place form submit, empty reset action, unauthorized clearing, chart caption/token semantics, and one-click/one-fetch retry behavior.
- Telemetry privacy hardening from the preceding analytics follow-up rejects nested player identity payloads and handles camelCase/snake_case private aliases; no raw identity values are persisted.

## Verification

Passed with 0 failures:

- `node public/clientAnalytics.test.js` — 17 analytics client behaviors, including nested rows for all non-overview tabs.
- `node public/clientResponsiveA11y.test.js` — 12 responsive/a11y checks.
- `node public/clientAnalyticsMarkup.test.js` — analytics markup contract.
- `npx eslint public/clientAnalytics.js public/clientAnalyticsCharts.js public/clientAnalytics.test.js` — 0 errors/warnings.

The parent owns `package.json`; `server/analyticsRuntime.test.js` remains omitted from package scripts pending parent integration resolution.
