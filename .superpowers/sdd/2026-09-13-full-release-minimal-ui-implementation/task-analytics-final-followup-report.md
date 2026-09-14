# Analytics final follow-up report

## Commit

The client analytics changes were staged by this workstream and included by the parent’s concurrent commit:

`0545063e1dd5195acbbec6e4309aad07d18d1612` — `fix: preserve configured bot capacity`

Changed analytics files in that commit are limited to `public/clientAnalytics.js` and `public/clientAnalytics.test.js`; the chart renderer was already present in the preceding analytics UI commit.

## Fix summary

- Client normalization now preserves the narrowly allow-listed nested `rows` model and required measures for Rulesets, Economy, Events, Bots, and Quality.
- Active panels render nested read-model rows and denominator content as accessible tables.
- Tab activation loads the selected read model while retaining the verified snapshot during refresh.
- Form submit, season/revision query encoding, safe empty reset action, and single retry-fetch behavior are covered.
- Existing telemetry/rollup privacy hardening rejects nested identity-bearing player payloads and recognizes camelCase/snake_case private aliases.

## Verification

Passed with 0 failures:

- `node public/clientAnalytics.test.js` — 17 analytics client behaviors.
- `node public/clientResponsiveA11y.test.js` — 12 responsive/a11y checks.
- `node public/clientAnalyticsMarkup.test.js` — analytics markup contract.
- `npx eslint public/clientAnalytics.js public/clientAnalyticsCharts.js public/clientAnalytics.test.js` — 0 errors/warnings.

The parent-owned `package.json` remains the integration owner; `server/analyticsRuntime.test.js` is not added to scripts by this workstream because the package has concurrent parent changes.
