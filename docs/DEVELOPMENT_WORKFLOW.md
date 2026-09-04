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
  `npm run coverage` (9 contract suites), and a boot smoke that starts the
  server and curls the app shell.
- **Copilot code review** — logic/bug-oriented AI review of the diff. Cannot
  approve or merge; treats its comments as signals, not orders.
- **CodeScene** — maintainability: complexity, duplicated logic, temporal
  coupling, code-health delta on touched functions.
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
- MCP note: CodeScene exposes an MCP server; useful tools are
  `analyze_code` (health of the functions just edited), `technical_debt`
  (is this region a legacy minefield before entering it),
  `function_hotspots` (what deserves attention), and
  `code_change_couplings` (files that historically change together — check
  them before declaring done). Exact tool names come from the installed
  CodeScene MCP server's own listing.

## Commands

```bash
npm run dev        # start server on :8080 (or PORT=…)
npm test           # contract suites (no coverage)
npm run lint       # eslint, server/ only by design
npm run coverage   # c8 → coverage/lcov.info + text table (~64% baseline)
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
