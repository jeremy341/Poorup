# Poorup Development Workflow

_Last updated: 2026-09-04. This is the contract between contributors (human or
AI) and `main`._

## The rule

**Never develop directly on `main`.** All work enters `main` through a pull
request that has passed the pipeline below. `main` is protected by a GitHub
ruleset; direct pushes are rejected.

## Branches

| Prefix        | For                                              |
|---------------|--------------------------------------------------|
| `feature/*`   | new behavior                                     |
| `fix/*`       | bug fixes                                        |
| `refactor/*`  | code health, no behavior change                  |
| `docs/*`      | documentation only                               |
| `experiment/*`| spikes; may die unmerged                         |
| `chore/*`     | infrastructure, dependencies, tooling            |

Branch from `main` (`git checkout -b fix/thing main`), keep each branch to one
concern.

## The pipeline

```text
branch → PR → GitHub Actions (lint + tests + coverage + boot)
             → Copilot code review (automatic, comments only)
             → CodeScene (code health on the diff)
             → Codecov (coverage delta comment)
             → human review (Jeremy) → merge → deploy → Sentry (runtime)
```

Responsibilities, one line each:

- **GitHub Actions** — does the code actually run? `npm run lint`,
  `npm run coverage` (the gameLogic contract suites + persistence
  characterization, merged under one c8 pass by `server/coverage-runner.js`),
  a wire-test step (`server/server.test.js`) that boots the real server and
  proves the socket-handler scaffold, and a boot smoke that curls the app shell.
- **Copilot code review** — logic/bug-oriented AI review of the diff. Cannot
  approve or merge; treats its comments as signals, not orders.
- **CodeScene** — maintainability: complexity, duplicated logic, temporal
  coupling, code-health delta on touched functions. Live as the
  `CodeScene Code Health Review (main)` check (delta-analysis GitHub App,
  quality profile "The Bare Minimum"): it fails the build on any new-code
  decline or hotspot regression. `cs review <file>` (CodeScene CLI) gives the
  same scores locally before you push.
- **Codecov** — overall coverage trend + per-PR patch coverage. Blocks only
  on >2-point project regressions (see `codecov.yml`).
- **Human review** — final decision. Nothing merges without it.
- **Sentry** — post-deployment runtime errors, not a review gate.

## Contributor checklist (per PR)

1. Branch off `main` with the right prefix.
2. Focused change — no drive-by refactors of unrelated legacy code.
3. Add or update a contract suite in `server/gameLogic.test.js` when touching
   `gameLogic.js`/stores; new observable behavior gets a new `contract N`.
4. `npm run lint` and `npm test` green locally.
5. Push, open PR against `main` (never merge from the branch).
6. Read the Copilot review and CodeScene findings; fix legitimate issues,
   reply-and-resolve the disagreements.
7. Check the Codecov comment: patch coverage on new lines should be respectable
   even though it is informational.
8. CI checks (`test`, `boot`) must be green.
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
npm run dev        # start server on :8080 (or PORT=…)
npm test           # gameLogic contracts + persistence + server wire suites (no coverage)
npm run lint       # eslint, server/ only by design
npm run coverage   # c8 → coverage/lcov.info + text table (~66% baseline, merged via coverage-runner.js)
```

## What is NOT here

- No build step (static assets ship as-is; the `boot` job is the honest
  equivalent of "build").
- No TypeScript, no test framework migration, no formatter — decisions to
  revisit only with an explicit proposal.
- No auto-merge, no Copilot auto-approval (Copilot cannot approve; that is
  by design).

## Secrets & tokens

- Codecov uploads worked with **no token** on this public repo (verified on
  PR #1: codecov-action v5 via GitHub OIDC). If a private mirror ever appears
  or uploads start failing, add the repo's Global Upload Token from
  app.codecov.io as a secret named exactly `CODECOV_TOKEN` under
  **Settings → Secrets and variables → Actions** — never in a committed file
  or log.
- Sentry DSNs, when introduced: server DSN via environment variable at
  deploy time; browser DSN is publishable by design but still gets its own
  PR with the scrubbing rules from the Sentry plan.
