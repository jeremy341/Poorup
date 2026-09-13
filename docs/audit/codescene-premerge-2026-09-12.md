# CodeScene pre-merge architecture gate — 2026-09-12

## Gate result

**NO-GO / BLOCKED.** The CodeScene gate could not produce an analysis because `CS_ACCESS_TOKEN` is unavailable and OAuth is not signed in. The static fallback found no P0/P1 correctness defect, but it does not substitute for the required CodeScene results. Rerun both CodeScene commands with valid authentication before merging.

Scope: `codex/theme-reset` at `1bf4e1a`, compared with `origin/main`. Review was read-only except for this report. The working tree was not clean when reviewed (including modifications to the new theme files and deletion of two light-theme pose assets), so line references below describe the reviewed working tree while branch-change inventory came from `origin/main...HEAD`.

## Command evidence

| Check | Result | Evidence |
|---|---:|---|
| `CS_ACCESS_TOKEN` presence | blocked | Environment variable was missing; its value was never printed. |
| `cs version` | exit 0 | `cs version 1.0.40 (8a7257420cc2dec1cf6ff7866db4da8c58f67602)`, built 2026-09-03. CLI reported 1.0.41 available. |
| `cs auth status` | exit 1 | Target `https://api.codescene.io`; OAuth not signed in. |
| `cs delta origin/main --include-metadata --output-format json --pretty` | exit 1 | Refused analysis because a Personal Access Token is required. No CodeScene delta JSON was produced. |
| `cs review public/clientTheme.js` | exit 1 | Refused analysis because a Personal Access Token is required. No CodeScene file review was produced. |
| `git diff --check origin/main...HEAD` | exit 0 | No whitespace errors. |
| `node public/clientTheme.test.js` | exit 0 | 6 passed, 0 failed. |
| `node public/themeAssetAudit.test.js` | exit 0 | 32 passed, 0 failed. |
| `npm run lint:client -- --no-error-on-unmatched-pattern` | exit 0 | Client ESLint completed without findings. |

## Findings

### P0 — none found

No critical architecture or data-integrity defect was identified in the bounded static review.

### P1 — none found

No high-severity correctness or layering defect was identified in the bounded static review.

### P2 — theme token lifecycle has two manually synchronized sources of truth

Each non-default theme repeats a large CSS custom-property map in `public/clientThemeData.js:56`, `:86`, `:117`, `:147`, and `:180`. Separately, `clearThemeVariables()` hard-codes the removable token names in `public/clientThemeRender.js:102-116`, while `setThemeVariables()` applies the registry entries at `:122`.

There is no invariant test proving that every token emitted by every theme is cleared when switching back to `original`. A future token added only to the data registry can leak across theme changes. This is both duplication and a cross-module contract risk.

Recommended action: derive the clear-set from the theme registry (or a single exported token schema), and test `custom theme -> original` plus `custom theme A -> custom theme B` for stale properties.

### P2 — changed code continues growth in existing god modules

The architecture validation threshold is 500 lines. Changed production files above that threshold include:

- `public/clientLobbyUi.js` — 853 lines, with 161 additions / 33 deletions in the branch diff.
- `public/clientSocialSurfaces.js` — 1,079 lines, with 124 additions / 18 deletions.
- `public/clientTradeUi.js` — 1,299 lines, with 58 additions / 13 deletions.
- `public/main.js` — 924 lines.
- `server/accountStore.js` — 733 lines.
- `server/gameLogic.js` — 1,025 lines.
- `server/rooms.js` — 879 lines.
- `server/socketRuntime.js` — 803 lines.

This is not a newly introduced runtime failure, but additions to these broad modules increase change coupling and regression surface. Follow-up extraction should be by feature/responsibility, not by arbitrary line count.

### P3 — dead exported seam

`public/clientThemeRender.js:26` exports `configureThemeRender()` as an empty “reserved seam,” and no repository usage was found. It adds API surface without behavior or a present test need.

Recommended action: remove it until a real second use exists, or implement and test the intended injection contract.

## Static fallback coverage and limitations

The fallback inspected the JavaScript change inventory, line-size hotspots, the three new theme modules, their focused tests, and theme integration points in `public/main.js`. It explicitly checked complexity, duplication, dead code, and contract risk. It was bounded and did not attempt a full browser suite, full server suite, dependency graph, or CodeScene behavioral-code-health analysis. Passing lint and focused tests therefore lowers syntax/regression risk but does not clear the merge gate.

## Merge-gate exit criteria

1. Provide valid `CS_ACCESS_TOKEN` or sign in with OAuth.
2. Rerun the exact `cs delta` and `cs review` commands successfully and assess their findings.
3. Reconcile the dirty working-tree theme changes/assets so the reviewed state is the state intended for merge.
