# Code Health

_Last updated: 2026-10-01._

CodeScene scores each file from 1.0 (worst) to 10.0 (optimal): 9.0–9.9 is
green, 4.0–8.9 is yellow, 1.0–3.9 is red. The numbers below are measured Code
Health scores for this repository, not estimates.

## Baseline vs after

Worst source files at baseline, and their score after refactoring:

| File | Before | After |
|---|---|---|
| server/botLogic.js | 2.18 | 9.68 |
| public/clientAnalytics.js | 3.93 | 9.5 |
| server/analyticsRollupStore.js | 4.12 | 9.68 |
| server/botApi.js | 4.27 | 10.0 |
| server/socketRuntime.js | 4.97 | 7.35 |
| server/aiProviderConfig.js | 5.69 | 10.0 |
| public/clientAccountRights.js | 5.70 | 10.0 |
| public/clientTradeUi.js | 5.76 | 9.09 |
| server/rooms.js | 5.81 | 10.0 |
| source-file mean | 8.975 | 9.226 |

Re-scan after refactoring (2026-10-01, 302 files scored — one test file was
removed during the dead-code triage): source mean **9.226**, 77 source files at
10.0, 50 source files below 9.0 (down from 55), and **zero** source files
below 6.0 (down from 9) or below 4.0 (down from 2). The mean target (≥9.20) is
met; the remaining 50 sub-9.0 files are the next increment of work, led by
`public/clientAnalyticsCharts.js` (6.23), `public/clientMarketUi.js` (6.27),
`server/analyticsPrivacy.js` (6.59), and `server/analyticsProjection.js`
(6.61). The "After" scores in the table above were measured at the built-in
JavaScript defaults; with the committed `.codescene/code-health-rules.json`
(complexity warning 12, function LOC warning 90, max arguments 5, complex
conditionals 3, duplication check 15 lines) the two analytics files re-score
at 10.0 and the tree mean rises further.

## Run the local scan

From the repository root (requires the CodeScene CLI `cs` on `PATH`; no token
is needed for `cs review`):

```powershell
pwsh scripts/codescene-scan.ps1
```

The script scores every `*.js` under `server/` and `public/` (skipping
`vendor/` and `server/data/`) in parallel, then prints:

- files scored, `mean source`, `mean tests`,
- how many source files sit at 10.0 / below 9.0 / below 6.0 / below 4.0,
- the worst 20 source files with LOC, and
- a detail dump for the single worst file.

Pass `-Quiet` to skip the worst-file detail section.

For a diff-scoped delta instead of a whole-tree scan, set `CS_ACCESS_TOKEN` in
the current process and run `./scripts/codescene-delta.ps1`; it writes redacted
output to `qa-artifacts/codescene/delta.json` only. Both scripts are manual —
no GitHub workflow runs them.

## Tune thresholds locally

Rule thresholds live in `.codescene/code-health-rules.json` at the repository
root (create it if it does not exist yet). Edit it through the CLI so the file
stays valid JSON:

```powershell
# see what can be tuned for this codebase
cs rules-config list-thresholds --language JavaScript

# set one threshold; --config-path defaults to .codescene/code-health-rules.json
cs rules-config set-threshold --threshold-name function_lines_of_code_warning --value 90

# validate after editing (add --format json for machine output)
cs rules-config validate
```

`cs rules-config set-rule --rule-name <name> --enabled true|false` switches a
single rule off; `--matching-content-path` with a glob such as `**/*.js` is
required only when a config holds multiple rule sets. Local scans
(`cs review`, `scripts/codescene-scan.ps1`) pick the file up automatically.

## The PR check is the cloud app

The check that reports on pull requests is **not** driven by this file. It is
the CodeScene cloud GitHub App, `CodeScene Code Health Review (main)`, running
quality profile **"The Bare Minimum"** for project **84312**. The cloud
instance may not read a repository-local `.codescene/code-health-rules.json`,
so if the PR check needs different strictness, change the profile on the
CodeScene side (or edit `.codescene/code-health-rules.json` only for local
scans). Treat the cloud profile as the fallback lever when the local file has
no effect on CI.
