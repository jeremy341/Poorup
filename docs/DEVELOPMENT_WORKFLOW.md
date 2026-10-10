# Poorup Development Workflow

_Last updated: 2026-10-01. This is the contract between contributors (human or
AI) and the three permanent lanes `development`, `testing`, and `main`._

## The rule

**Never develop directly on `testing` or `main`.** `development` is the
integration/work lane: the repository owner may push directly to it, or use a
short-lived PR when isolated review is useful. Direct pushes trigger light CI
after the update; those results do not block the push. Promote `development` →
`testing` → `main` by PR at each hop. `testing` and `main` remain protected;
direct pushes to them are rejected.

## Branches

| Prefix        | For                                              |
|---------------|--------------------------------------------------|
| `feature/*`   | new behavior                                     |
| `fix/*`       | bug fixes                                        |
| `refactor/*`  | code health, no behavior change                  |
| `docs/*`      | documentation only                               |
| `experiment/*`| spikes; may die unmerged                         |
| `chore/*`     | infrastructure, dependencies, tooling            |

When using a short-lived branch, branch from `development`
(`git checkout -b fix/thing development`) and keep it to one concern.
Otherwise, the repository owner may work directly on `development`, committing
one clean, logical change at a time. Never branch from `main`; the release lane
order remains `development` → `testing` → `main`.

## The pipeline

```text
short-lived branch → PR (squash) ─┐
                                  ├→ development → PR → testing → PR → main
direct push ──────────────────────┘
              → GitHub Actions (tiered lint + tests + coverage + boot)
              → Copilot code review (automatic, comments only)
              → CodeScene (code health on the diff)
              → Codecov (coverage delta comment)
              → human review (Jeremy) → merge → deploy → Sentry (runtime)
```

The feature → `development` PR is optional for the repository owner. When
used, squash it; direct pushes should already be one logical commit. The
`development` → `testing` and `testing` → `main` PRs remain mandatory release
gates. Only the last hop reaches production.

## Merge methods and commit history

- For short-lived feature, fix, refactor, docs, and chore PRs into
  `development`, use **Squash and merge**. Keep the PR focused on one logical
  change and give the squash commit a clear, behavior-focused title. The PR
  retains the review, checks, and discussion; its intermediate work-in-progress
  commits do not need to become permanent commits in the release history.
- For direct pushes to `development`, make one clean, descriptive commit per
  logical change. Keep experiments and AI-generated work-in-progress commits
  local; do not publish a chain of scratch commits if one final commit will do.
- For testing-lane sync PRs into `development` and the `development` →
  `testing` / `testing` → `main` promotion PRs, use a **merge commit**. These
  PRs carry lane ancestry required by the strict `testing` up-to-date check and
  by the promotion tree check. Do not squash or rebase these lane PRs unless
  the ancestry and tree gates are deliberately redesigned and verified.
- This policy applies to future PRs. It does not rewrite existing shared
  history.

Dependabot's `target-branch: development` routes routine version-update PRs
through the integration lane. GitHub security-update PRs still target the
repository's default branch, so retarget any Dependabot security PR opened
against `main` to `development` before merging it. Then use the same
development → testing → main promotion path; never bypass the main tree check.

Responsibilities, one line each:

- **GitHub Actions** — does the code actually run? `npm run lint`,
  `npm run lint:client`, and the unique suites in `scripts/test-manifest.mjs`.
  PR jobs depend on the target branch; direct `development` pushes run the
  light tier after landing. The push path compares the previous and new commit
  so coverage runs on direct pushes only when `server/**` changed (see **CI
  tiers** below).
  On the heavy tier CI runs four isolated Node-test shards (four suites in
  parallel inside each shard), merges their c8 V8-coverage data once, and runs
  the six-viewport Playwright suite **scaled to the diff**: three shards for
  UI-affecting changes, a single fast `@ui-smoke` shard for server-only
  changes, then merges the browser reports. The old repeated coverage-runner
  pass and separate duplicate `server.test.js` invocation are gone; the unique
  wire test remains in the manifest. A 10-game deterministic bot smoke runs
  whenever the manifest `core` group runs, split across the shards
  (`POORUP_BOT_SIMULATION_COUNT=ceil(10/N)` with a per-shard start index), so
  no single shard pays for all ten games. The 1,000-game safety campaign runs
  **only** nightly (`bot-campaign.yml`, `schedule: cron '0 3 * * *'`) and on
  manual `workflow_dispatch`; there is no PR-triggered campaign job, and the
  workflow's hardcoded `ref` is `main`.
- **Copilot code review** — logic/bug-oriented AI review of the diff. Cannot
  approve or merge; treats its comments as signals, not orders.
- **CodeScene** — maintainability: complexity, duplicated logic, temporal
  coupling, code-health delta on touched functions. The check that appears on
  PRs is the cloud GitHub App `CodeScene Code Health Review (main)` running the
  quality profile "The Bare Minimum"; it is not a workflow in this repository.
  `scripts/codescene-delta.ps1` is a **manual local tool** — no workflow invokes
  it. `cs review <file>` (CodeScene CLI) gives the same scores locally before
  you push. See `docs/CODE-HEALTH.md`.
- **Codecov** — overall coverage trend + per-PR patch coverage. The upload
  runs without a token (the repository is public) and with
  `fail_ci_if_error: false`, so a failed upload never fails CI. Patch status is
  `informational: true` (never blocks); the project target is `auto` with a
  `threshold: 2%` (see `codecov.yml`). Codecov is **not** a required status
  check. On the light tier the upload runs only when `server/**` changed —
  client-only PRs would otherwise report unchanged server numbers.
- **Human review** — final decision on protected release promotions. Direct
  development pushes do not receive pre-push review.
- **Sentry** — post-deployment runtime errors, not a review gate.

The repository does not install an automatic CodeScene refactoring agent.
When a PR remains unmerged because of a CodeScene finding, Jeremy explicitly
requests a Luna Codex fix. The agent works only on that PR branch, adds a
regression test, and never merges or deploys by itself.

`main` is the Production branch. `testing` is the Nest staging lane and
`development` is the integration lane. The active production deploy path is a
host-side systemd timer (`scripts/nest-auto-update.sh`, roughly every 3 min)
that polls `origin/main` directly; it has **no CI gate** — merging to `main` is
the gate. The Actions SSH path (`deploy-nest.yml`, `maintenance-drain.yml`,
`maintenance-undrain.yml`) is parked: the repository has no configured secrets
or variables, so `vars.NEST_DEPLOY_ENABLED` is never `'true'` and those
workflows skip. Details: `docs/deployment/nest-live-runbook.md`.

The three lane branches are permanent. Promotion merges must never use a
provider option that deletes the source branch (for example
`gh pr merge --delete-branch`); delete only short-lived feature branches after
their merge.

## CI tiers

CI jobs are gated by the PR's target branch and, on `development` PRs, by the
changed paths. Direct pushes to `development` run the light tier after the
commit lands. The conditions live in `.github/workflows/ci.yml`; treat this
table as the contract, not the line numbers:

| Tier        | Runs for                                                       | Coverage |
|-------------|----------------------------------------------------------------|----------|
| **light**   | Code PRs targeting `development`, pushes to `development`, and pushes to lane branches | the everyday integration checks; development push checks run after landing; coverage merge/upload runs only when `server/**` changed |
| **light-slim** | PRs targeting `development` that touch only docs/markdown   | lint, manifest validation, and `boot smoke` only — no test shards, no coverage, no browser |
| **heavy**   | PR `development` → `testing`                                   | full 4-shard manifest + merged coverage (Codecov upload) + Playwright browser QA scaled to the diff: 3 shards for UI-affecting changes, one `@ui-smoke` shard for server-only changes |
| **fast**    | PR `testing` → `main`                                          | `boot smoke` + lint + a tree-identity check that the promotion PR carries the same tree as the source lane |

Path filtering is done inside the `plan` job (dorny/paths-filter), never with
`paths-ignore` on the `pull_request` trigger — a skipped trigger would leave
required checks pending forever. The release tiers keep every check name
reporting: PRs to `testing` always run heavy and PRs to `main` always run
fast, whatever the PR touches. Only the browser stage scales with the diff —
the `browser QA` check name reports in both modes, so a server-only
promotion never reaches `testing` without UI-liveness evidence.

Because `test` and `boot smoke` are the required contexts on `main`, those two
check names must still be reported by every PR that targets `main`; the fast
tier decides what they actually execute.

Required status checks today:

- On `main` (GitHub ruleset "PR Review"): exactly **`test`** and
  **`boot smoke`**. `browser QA`, `coverage`, `lint and audit`, `codecov/*`,
  and `CodeScene Code Health Review (main)` are **not** required — they are
  signals, not gates.
- On `development` (ruleset "Lane gates (development)"): direct pushes are
  allowed; force-pushes and branch deletion remain blocked. CI on pushes is
  post-update feedback, not a pre-push gate. PRs into development still run
  light checks, but are optional for the repository owner.
- On `testing` (classic branch protection): **`test`**, **`boot smoke`**, and
  **`browser QA`**, with branches required to be up to date, PRs required,
  and admin enforcement.

### Gate configuration on the lanes (current state)

The repository rulesets/branch protection are API-configured; the workflow
side is queue-ready either way:

- **`main`** (ruleset "PR Review"): required checks **`test`** and
  **`boot smoke`**; PRs required; commits cannot be pushed directly.
- **`development`** (ruleset "Lane gates (development)"): blocks deletion and
  non-fast-forward updates; direct pushes are allowed; no required status
  checks gate the push.
- **`testing`** (classic branch protection): requires branches to be up to
  date, required checks **`test`**, **`boot smoke`**, and **`browser QA`**;
  PRs required; admin-enforced.

**Merge queue status:** the "Require merge queue" section is absent from this
repository's branch protection page (user-owned repository on this account's
plan — the setting is not offered, with or without GitHub Pro), so `testing`
runs in the documented fallback — checks-only mode. The fallback preserves
the queue's core guarantee: `strict` (require branches up to date) forces
every PR head to contain the latest `testing` tip before it can merge, so
required checks always ran on content that includes the base. Operationally
that means the promotion PR from `development` must be preceded by a
lane-sync PR (a branch off the `testing` tip merged into `development`; it
carries no file changes beyond ancestry plus any docs update, so it runs the
light or light-slim tier).

Build that branch from the latest `testing` tip, then merge the latest
`development` tip into it. Verify that the testing tip is an ancestor of the
lane-sync head and that the merge tree matches `development`; if a docs-only
change is added to trigger checks, verify that it is the only tree difference.
This preserves both lane histories without promoting a stale or altered tree.

For an ancestry-only lane-sync whose tree is identical to `development`,
confirm that GitHub Actions reports the required `test` and `boot smoke`
contexts. If an empty-diff PR produces no workflow run, include a narrowly
scoped workflow-documentation update in that lane-sync PR to trigger the
`light-slim` checks. Never merge it by bypassing the required contexts.

If GitHub refuses to create the ancestry-only PR with `No commits between`
because `development` already contains the testing tip, add a concise note to
this runbook explaining the sync action. Verify that the resulting PR's only
tree difference from `development` is that documentation note; keep the
application tree unchanged and still require the separate heavy promotion PR.

2026-10-08: after the CodeScene refactor promotion, `testing` gained a new
merge commit not present on `development`. The follow-up lane sync carries
that testing tip into development before the next heavy promotion; it changes
no application files.

2026-10-10: after the AI decision-budget update, `testing` again had a merge
commit absent from `development`. This lane sync records that testing ancestry
before the next heavy promotion; the only tree difference from development is
this note, and the application tree remains unchanged.

2026-10-10: the environment-cap correction follows that testing promotion and
requires the current testing merge to be synced before its own heavy promotion.
This follow-up sync changes no application files.

The workflow already triggers on `merge_group` events and the `plan` job
maps a merge group targeting `testing` to the heavy tier, so if the queue
ever becomes available on this plan, enabling it in the UI needs **zero**
workflow changes. Fallback escape hatch: set "Require branches to be up to
date" to false on `testing` to merge without the sync dance — safe only
while every PR into `testing` comes from a lane whose tree contains
`testing`'s content (the lane model), and always paired with the `tree
check` on `main`.

### Sharding and the timing baseline

Test shards are **time-balanced**, not count-balanced. `scripts/run-test-manifest.mjs`
packs suites into shards with a longest-first, least-loaded split driven by
`qa/test-timings.json` (the checked-in per-suite duration baseline); when the
baseline is missing it falls back to the old round-robin split. The manifest
test asserts that shards finish within 60% of each other, and it also asserts
that every checked-in `*.test.js` is registered in the manifest — a suite
forgotten there would otherwise never run on any branch. A missing or empty
baseline entry falls back to an estimate rather than failing.

- The baseline is built from **real CI runner timings**, not local machines:
  download the `test-timings-shard-*` artifacts from the latest heavy run and
  run `node scripts/import-ci-timings.mjs <dir>` (values merge with
  `max(existing, imported)`). Both importers are grow-only: a local machine
  times suites faster than a CI runner (`bot-simulation` runs roughly twice as
  slow there), so a lower number never replaces a higher one. `npm run
  timings:refresh` is safe for seeding a brand-new suite's first entry, but it
  will not lower an entry a CI runner already measured.
- `server/bot-simulation.test.js` is the one oversized suite; the runner
  splits its 10-game smoke window across shards (`COUNT=ceil(10/N)`,
  `START_INDEX=(shard-1)*count+1`, seeds derive from a linear index so the
  coverage is identical to the unsplit run). Unsharded local runs keep all
  10 games; `npm run test:bot-campaign` still runs the full 1,000 directly.
- Suites run **four at a time inside each shard** (`POORUP_TEST_PARALLELISM=4`
  in CI). Suites are independent processes with isolated stores and distinct
  `PORT`s; `POORUP_TEST_PARALLELISM=1` restores the sequential, live-output
  behavior. Measured locally: full manifest 72s summed -> 20.7s wall with
  identical pass/fail results. The browser suite keeps `--workers=2` in CI:
  measured against 4-core runners, four workers oversubscribe the runner and
  the browser shards regressed from ~3.5 min to ~12 min, while two workers
  leaves headroom for the Node server.
- The `shard timing report` job prints per-shard durations, the slowest ten
  suites, and the real CI skew to the run summary; it emits a `::warning::`
  when real skew exceeds 1.5× — that is the signal to re-import the baseline.
- Per-suite wall time is capped (default 300s, override with
  `POORUP_SUITE_TIMEOUT_MS`), so a hung suite fails in minutes instead of
  eating the 25-minute shard budget.

Account export, deletion, and recovery behavior must be described from the
current implementation and deployment configuration. Keep provider secrets,
canonical origins, backup paths, and operator identities out of source code.

## Contributor checklist (per PR)

1. Branch off `development` with the right prefix.
2. Focused change — no drive-by refactors of unrelated legacy code.
3. Add or update a contract suite in `server/gameLogic.test.js` when touching
   `gameLogic.js`/stores; new observable behavior gets a new `contract N`.
4. `npm run lint`, `npm run lint:client`, and `npm run test:full` green locally.
5. Push, open PR against `development` (never merge from the branch). After it
   merges, promote `development` → `testing` → `main` with one PR per hop.
6. Read the Copilot review and CodeScene findings; fix legitimate issues,
   reply-and-resolve the disagreements.
7. Check the Codecov comment: patch coverage on new lines should be respectable
   even though it is informational.
8. The required CI checks on `main` — `test` and `boot smoke` — must be green.
9. Ask Jeremy to review the final diff; he merges.

## AI-agent loop (mandatory for agents working in this repo)

```text
change code → npm test → CodeScene analysis of CHANGED functions only
→ fix serious regressions in the diff → npm test again → PR
```

Hard rules:

- Analysis is scoped to the diff. An agent must **never** widen a task into
  "improve CodeScene scores" — score-driven bulk refactors of legacy regions
  (`public/main.js`, untouched corners of `gameLogic.js`) require a separate
  human-opened `refactor/*` issue.
- "NEW CODE MUST NOT MAKE THE PROJECT WORSE" — do not degrade code health of
  functions you touch; do not claim a global health target.
- MCP note: CodeScene exposes an MCP server (`@codescene/codehealth-mcp`,
  binary `cs-mcp`; configured as the `codescene` local MCP server). Real tool
  names, from the server's own listing: `code_health_score` /
  `code_health_review` (health + smells for one file),
  `pre_commit_code_health_safeguard` (staged-diff gate) and
  `analyze_change_set` (whole-branch gate before opening the PR), and — on a
  CodeScene Core login — `list_technical_debt_hotspots_for_project` (what
  deserves attention) and `code_ownership_for_path`. The local CLI overlaps
  these without auth: `cs review`, `cs delta`, `cs check-rules`. Restart the
  client once after first install so the tools register.

## Commands

```bash
npm run dev             # start server on :8080 (or PORT=…)
npm test                # core contract/integration group from the unique manifest
npm run test:audit      # audit manifest group (settlement, lifecycle, privacy, casino)
npm run test:account    # account manifest group
npm run test:inactivity # inactivity manifest group
npm run test:full       # all 150 unique suites from the manifest, once each
npm run test:bot-timing # bot timing + socket runtime suites
npm run test:bot-campaign  # full 1,000-game campaign (default count when run directly)
npm run test:browser    # Playwright suite (six viewports)
npm run bot:compare     # bounded three-policy tournament, stubbed AI advisor
npm run load:testing    # 1,000-client load harness (testing host only)
npm run lint            # eslint server/
npm run lint:client     # eslint public/
npm run coverage        # one c8 pass over the unique full manifest
```

On the heavy tier, CI uses four disjoint suite shards and three Playwright
shards. Sharding is **time-balanced**: `scripts/run-test-manifest.mjs` packs
suites longest-first into the least-loaded shard using the checked-in baseline
`qa/test-timings.json` (see "Sharding and the timing baseline" above); the
old round-robin split remains only as the fallback when the baseline is
absent. Per-suite timing JSON is still written per shard (`test-timings-shard-`
artifacts) and consumed by the `shard timing report` job. Sharding does not
remove any test file. When run through the manifest,
`server/bot-simulation.test.js` is capped at 10 games
(`POORUP_BOT_SIMULATION_COUNT=10`); `npm run test:bot-campaign` run directly
uses the full 1,000. The CI smoke count is not balance evidence.

## What is NOT here

- No build step (static assets ship as-is; the `boot smoke` job is the honest
  equivalent of "build").
- No TypeScript, test framework migration, or formatter was introduced. The
  existing standalone Node contract tests remain intact; GitHub Actions matrix
  jobs provide the first parallel pilot without moving tests to a new runner.
- No auto-merge, no Copilot auto-approval (Copilot cannot approve; that is
  by design).

## Secrets & tokens

- Codecov: the CI upload step already passes
  `token: ${{ secrets.CODECOV_TOKEN }}` (codecov-action v5) with
  `fail_ci_if_error: false`, so a missing or rejected token can never fail a
  build. If uploads ever start failing (for example on a private mirror),
  populate that secret with the repo's Global Upload Token from
  app.codecov.io under **Settings → Secrets and variables → Actions** — never
  in a committed file or log.
- Sentry DSNs, when introduced: server DSN via environment variable at
  deploy time; browser DSN is publishable by design but still gets its own
  PR with the scrubbing rules from the Sentry plan.

## Manual CodeScene review workflow

CodeScene is a release review gate, not an automated code-writing agent. The
repository never stores a CodeScene token and never starts a background polling
or refactoring loop. Both local scripts below are **manual, developer-run
tools** — no GitHub workflow invokes them. The only automated CodeScene signal
on a PR is the cloud GitHub App `CodeScene Code Health Review (main)` (quality
profile "The Bare Minimum"). Threshold tuning and the baseline measurements
live in `docs/CODE-HEALTH.md`.

### Run a local delta

From the repository root, set `CS_ACCESS_TOKEN` in the current process and run:

```powershell
./scripts/codescene-delta.ps1
```

The script compares the current branch with `origin/main`, fails closed when
the token or merge base is missing, and writes the redacted command output only
to `qa-artifacts/codescene/delta.json` (which is ignored by Git). It never
prints the token. Pass a different path only when it remains inside
`qa-artifacts/`.

### Manual Luna handoff

Use the explicit task prompt:

```text
CodeScene für PR <number> reparieren
```

Give the Luna task the PR diff and the CodeScene findings only. The task must:

1. write a regression test at the public seam;
2. apply the smallest behavior-preserving fix;
3. run the affected tests, server/client lint, and `git diff --check`;
4. report the exact evidence and push only to the PR branch when separately
   authorized.

### Stop conditions

Stop after three failed fix rounds, any security ambiguity, gameplay-semantic
disagreement, a changed PR SHA, or exhausted Codex quota. Leave the PR open and
report the blocker. Do not suppress a finding merely to make the check green.

OpenRouter, Google keys, `/cs-agent` triggers, and background polling are
intentionally outside this workflow; a future user-owned Action is a separate
project.

## Bot strategy comparisons

Run the bounded, reproducible policy tournament with `npm run bot:compare`.
The default uses a stubbed AI advisor and makes no provider network calls.
`POORUP_BOT_EVAL_COUNT` sets the campaign seed count, `POORUP_BOT_EVAL_SEEDS`
accepts a comma-separated seed list, and `POORUP_BOT_EVAL_STEP_LIMIT` bounds
each match. Live provider calls require `POORUP_BOT_LIVE_AI=1` and a positive
`POORUP_BOT_LIVE_AI_MAX_CALLS`; provider credentials use the existing
`POORUP_AI_API_KEY` / `DEEPSEEK_API_KEY` configuration. Reports include model,
prompt version, actual provider calls, completed and capped matches, policy
outcomes, paired differences, and uncertainty intervals. Incomplete matches
are excluded from winner and placement rates.
Pairwise summaries are stratified by the other policy in each three-policy
match (for example, `no-ai:ai-stub:vs:score-greedy`). Each stratum retains the
same opponent set across all seat rotations. Live-cap exhaustion is reported
as `cap-exhausted-fallbacks` on the campaign and affected matches, with actual
calls, cap rejections, and cap-triggered fallbacks counted separately.
