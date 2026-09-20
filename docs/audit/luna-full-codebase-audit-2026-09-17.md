# Poorup Full Codebase Release Audit — Luna — 2026-09-17

**Mode:** local, read-only audit  
**Branch:** `admin-analytics-dashboard-plan`  
**HEAD:** `cc51da2`  
**Scope:** server, client, QA, configuration, Markdown/README, SVG and binary asset inventory.  
**Important:** existing user changes were preserved. This audit did not delete, reset, commit, push, merge, or change gameplay rules.

## Evidence freeze

The working tree contains 640 files after excluding `.git`, `node_modules`,
coverage, test results, QA screenshots, and the local skill cache:

| Class | Count | Notes |
|---|---:|---|
| Text/config files | 583 | 9.3 MB; source, tests, docs, CSS, HTML, SVG, JSON/YAML |
| Binary/other files | 57 | 33.9 MB; audio, fonts, raster assets and non-runtime artifacts |
| JavaScript/MJS | 243 | `node --check` passed for all files |
| Markdown/README | 137 | 74 audit, 35 plan, 6 spec files |
| SVG | 106 | 1.6 MB; runtime paths are partly dynamic through theme data |
| QA files | 15 | Playwright/config/load fixtures |

The complete release test chain currently passes:

- `npm run test:full --silent` — exit 0; server, client, audit, privacy,
  maintenance, analytics, documentation, bot and game-invariant suites pass.
- `npm run lint -- --quiet` — pass.
- `npm run lint:client -- --quiet` — pass.
- `npm audit --omit=dev --audit-level=moderate` — 0 vulnerabilities.
- `git diff --check` — no whitespace errors.
- `node --check` — 243/243 files pass.
- Full Playwright evidence from the current implementation slice: 391 passed,
  47 planned skips, 0 failures across desktop, tablet, iPad landscape and mobile.

## P0/P1 release blockers or gates

These are not all code defects; they are the issues that prevent an unconditional
public release claim.

| Priority | Finding | Evidence | Required disposition |
|---|---|---|---|
| P0 gate | CodeScene hosted review unavailable | Local CLI requires `CS_ACCESS_TOKEN`; current process/history has none | Supply a token in the review environment, run the delta on the candidate SHA, and record the result. |
| P0 gate | Account deletion/export/recovery not implemented | `docs/feature-status.json` keeps `account-controls` planned; current account UI is create/read/update | Implement the owner-approved account plan before enabling public accounts. |
| P0 gate | Privacy/operator facts incomplete | User explicitly removed ToS; a factual Privacy page and operator/mail facts are still pending | Supply operator identity, mail sender, canonical origin and final copy; do not invent legal facts. |
| P1 gate | Performance budget unmet | RR-32 measured uncompressed statics, many module requests, large soundtrack and weak caching | Decide whether the budget blocks this release; if yes, optimize before promotion. |
| P1 gate | Impeccable detector findings | Detector ran once and reported 126 primary-pattern findings plus 6 advisories | Triage actionable findings; do not globally suppress them. |
| P1 balance | Start-seat bias is unmeasured causality | 10,000 bot-only games: seat 0 winner share 0.9676; start order/host personality are confounded | Run randomized start-order and feature-opportunity campaigns; do not tune values from this result. |

## Confirmed fixes in the current implementation slice

The following historical findings are closed by current code plus passing tests:

- started-room cross-room detach now uses the normal disconnect/expiry pipeline;
- account and season match replay dedupe survives visible history windows;
- season mastery uses per-match deltas; participant trade evidence is recorded;
- legacy debt-mode input is normalized to elimination;
- human bankruptcy produces a read-only spectator, grey sidebar row and no board token;
- bot bankruptcy eliminates the bot without an interactive spectator state;
- end-game winner resolution crowns only the eligible winner;
- action locks survive snapshots; global-event and auction actions expose pending state;
- economy data exposes stale/verified state;
- risk-aware close confirmation covers required bankruptcy/auction/purchase decisions;
- field popups reuse the Deed-modal shell;
- degraded snapshots isolate render failures;
- Rules, responsive, iPad, reduced-motion, forced-colors and screenshot contracts pass;
- bot deal proposals are capped to one pre-roll proposal per bot turn, preventing a
  repeat-contract loop found during the balance run.

## Current open technical risks

These findings require either a focused fix or an explicit release decision:

1. **Account lifecycle:** no server-side deletion coordinator, export endpoint,
   verified recovery email, 30/90-day cookie sessions or daily finalizer exists yet.
2. **Performance:** compression, immutable asset caching, JS bundling/code-splitting,
   deferred Socket.IO loading and audio re-encoding remain outside the current slice.
3. **Theme chooser containment:** the chooser has its own keyboard behavior rather
   than being registered in the shared modal controller because shared registration
   previously intercepted pointer interactions. Existing browser tests pass; this is
   a review item, not an asserted regression.
4. **Large-module maintainability:** `public/main.js`, `public/clientSocialSurfaces.js`,
   `public/styles.css`, `server/socketRuntime.js` and `server/gameLogic.js` remain large;
   no broad refactor is justified during release hardening without characterization tests.
5. **Balance evidence:** the current campaign has 138 bounded games at the 2,000-step
   limit and does not cover human-involved, Metro-52, or randomized start-order play.
6. **CodeScene/Impeccable:** external/static review findings remain unclosed; green
   tests do not imply those quality gates are green.

## Balance audit

### Current measurement

The deterministic bot campaign ran 10,000 games with identical enabled features:

```text
games: 10000
completed within 2000 steps: 9862
bounded games: 138
invariant stalls: 0
winner share: seat 0 = 0.9676, seat 1 = 0.0012, seat 2 = 0.0174, unknown = 0.0138
bankruptcy games: 9996 / 10000
Global Event action adoption: 0.6298
```

Interpretation:

- The seat-0 result is a serious fairness hypothesis, not a proven rules defect.
- The campaign is bot-only, uses a fixed host/personality arrangement and does not
  randomize the start order; it cannot answer whether Airport, Casino, Market, Loans,
  Equity or Events cause wins.
- Bankruptcy in almost every game is expected in a three-seat elimination simulation
  where two seats usually lose; it needs timing/distribution telemetry before tuning.
- Bounded games are a stability signal; they are not silently counted as completed.

### Required telemetry before tuning

- randomized start seat and turn-order assignment;
- board variant, ruleset, market complexity and balance revision;
- feature opportunity, legal use, denial and settlement outcome;
- seat/placement/bankruptcy buckets without account identity;
- negative-cash duration, rescue action and debt settlement outcome;
- bot brain, provider, fallback, difficulty and personality;
- human-involved versus bot-only denominator;
- event severity, warning-to-active, recovery and bankruptcy association;
- confidence intervals and minimum cohort suppression (`k >= 5`).

No numeric rent, loan, auction, casino, market, event or starting-cash change is
authorized by this audit.

## Markdown/README disposition

All 137 Markdown/README files were included in the inventory. The source-of-truth
rules are:

- `active`: current source-backed contract or runbook;
- `complete`: historical implementation evidence whose steps are finished;
- `reference`: dated audit/design provenance;
- `superseded`: replaced by a newer decision or implementation;
- `planned/deferred`: intentionally not shipped;
- `delete candidate`: only when no runtime, test, design or provenance edge exists.

Clear current dispositions:

- current release-hardening audit, current production runbook and Poorup design
  authority remain active;
- the 2026-09-17 account-rights plan is planned until implemented;
- Devlog 7 and dated RR reports are reference evidence;
- deleted runtime Legal pages and the removed Music Box implementation are historical
  and their plans are superseded;
- Wallet/Items, Airport Travel, Predictions, Bank Account upgrades and Pedestrians
  remain planned/deferred;
- no historical Markdown file is a deletion candidate without a separate source-graph
  review and owner approval.

The authoritative current corrections are recorded in
`docs/audit/markdown-release-audit-2026-09-16.md`; old audit tables must not be
reopened solely because their line numbers say `OPEN`.

## SVG and binary asset disposition

The normalized SVG graph found 106 SVGs:

- 37 have direct normalized runtime references;
- 71 are referenced dynamically through theme/runtime names or shared asset paths;
- 19 have no current normalized runtime/theme reference and require manual review.

The largest review candidates are the two legacy board source SVGs, old patrol/flight
animation files, unused board icons, and abandoned theme props. They are not deleted:
some are rollback/provenance sources and dynamic string construction makes naive
basename scans unsafe. Every candidate needs path, license/provenance, test impact and
recoverability recorded before removal.

## Luna verdict

The core game and the current hardening slice are technically testable and stable for
a controlled beta. The branch is **not unconditionally public-release-ready** because
account rights, privacy/operator facts, CodeScene, performance policy, unresolved
Impeccable findings and representative balance experiments remain open. Jev is useful
as an independent semantic signal, but the deterministic tests and owner decisions
remain authoritative.
