# Poorup Branch, Release, Maintenance, Analytics, and Manual CodeScene Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Every task is independently testable and uses checkbox tracking.

**Goal:** Keep main as Poorup's permanent production branch, preserve the current audit/documentation history, establish development and testing promotion lanes on Nest, add safe maintenance draining and internal analytics, and use CodeScene only as a review gate with manually requested Luna fixes.

**Architecture:** Poorup remains one modular Node/Express/Socket.IO monolith. main is the production source, testing is a Nest staging promotion, and development is the integration branch. Runtime state remains server-authoritative; maintenance state and deployment metadata are explicit, bounded, and provider-neutral. No automatic refactoring agent is installed.

**Tech Stack:** GitHub protected branches and Actions, Node.js, Express, Socket.IO, vanilla HTML/CSS/JavaScript, Nest for development/testing, existing JSON adapters during the first phase, PostgreSQL and Redis adapter seams for the horizontal-scale phase.

**Spec:** docs/DEVELOPMENT_WORKFLOW.md, docs/production-hardening.md, docs/audit/release-readiness-40-agent-2026-09-12.md, and the current Poorup UI/design tokens.

> **Current-status pointer (2026-09-14).** This is a dated branch and
> operations plan. Its host, branch, SHA, and checkbox expectations are
> historical provenance, not a claim about the current checkout. Use
> [`docs/feature-status.json`](../../feature-status.json) for the current
> source-backed status; policy, credential, and deployment gates remain
> explicitly planned or deferred.

## Global Constraints

- main remains the permanent Production branch and is never directly edited.
- All new work enters through feature/*, fix/*, refactor/*, chore/*, release/*, or hotfix/* branches.
- development and testing are permanent promotion lanes; promotions move reviewed commits, not hand-copied files.
- The 40 release-readiness audits and all current audit/design Markdown files must remain intact.
- No Markdown, README, audit, plan, or historical snapshot is deleted by this plan.
- CodeScene remains a review and quality gate; no automatic CodeScene refactoring agent is installed.
- Luna agents run only after Jeremy explicitly asks for a specific PR/finding to be fixed.
- No agent, workflow, or script may merge, deploy to Production, or alter main without human approval.
- Existing Poorup layout, fonts, tokens, rails, modals, board dimensions, and responsive behavior remain authoritative.
- Maintenance mode pauses new rooms and new rounds while allowing active rounds to finish.
- Private chat, hidden cards, private loan terms, bearer tokens, and opponent secrets never enter analytics.
- No microservices, Kubernetes, event broker, or second game engine is introduced in this plan.
- Provider credentials stay in local environment variables or GitHub Secrets and never enter source, docs, logs, screenshots, or commits.

## Verified Nest Baseline (2026-09-13)

- Host: `poorup.jeremy-d.hackclub.app`; SSH account `jeremy-d` enters `/root` as `root`.
- App path: `/root/Poorup`.
- Running process: `node /root/Poorup/server/server.js` under PM2 process `poorup`.
- PM2 status: version `1.0.0`, online for approximately 24 hours, zero restarts; `pm2-root.service` is enabled at boot.
- The application checkout is `main` at commit `b1f3cd7`, which is older than the current GitHub `main` release SHA. It is not the current six-theme/release build.
- The remote checkout has a modified `package-lock.json`; the deployment must never deploy from a dirty working tree.
- The Nest repository contains no Dockerfile, PM2 ecosystem file, deploy script, webhook, or Git hook. `poorup.service` exists but is disabled; PM2 is the effective service manager.
- No scheduled pull or webhook was found. Latest GitHub pushes therefore do not currently reach Nest automatically.
- The current process runs as `root`. The production plan must migrate the app to a dedicated unprivileged user before treating Nest as a hardened public host.
- This baseline is an operational fact, not a reason to stop 24/7 service immediately. The first deployment must use a drain/rollback window and preserve the current release as a recoverable fallback.

---

### Task 1: Freeze and verify the historical integration-branch baseline

**Files:**
- Read: git status, git log, docs/audit/release-readiness-40-agent-2026-09-12.md
- Preserve: all current Markdown/README files and public/assets/themes/**

**Interfaces:**
- Historical input: branch `codex/codescene-cleanup` at `94eb1b0`.
- Produces: a clean, documented checkpoint ready for promotion to main.

- [ ] Step 1: Confirm branch and worktree state

    Run:

        git branch --show-current
        git status --short --branch
        git log -1 --oneline

    Historical expectation: the authoring checkout was
    `codex/codescene-cleanup` at `94eb1b0` with no uncommitted files. Record
    the actual branch and worktree state when reusing this procedure.

- [ ] Step 2: Verify documentation preservation

    Run:

        (Get-ChildItem docs/audit/release-readiness-2026-09-12 -Filter '*.md' -File).Count
        Test-Path docs/audit/release-readiness-40-agent-2026-09-12.md

    Expected: 40 and True.

- [ ] Step 3: Run the current full verification suite

    Run:

        npm run test:full
        npm run lint
        npm run lint:client
        npm run test:browser

    Expected: all suites pass; expected Playwright skips are reported but no unexpected failures exist.

- [ ] Step 4: Commit only if the worktree is not clean

    Use a focused message:

        git add <explicit-current-files>
        git commit -m "Recorded release documentation checkpoint"

    Do not stage coverage/, node_modules/, server/data/, test-results/, or generated music candidates.

---

### Task 2: Promote the current branch into main

**Files:**
- Git refs only; no source files are edited.

**Interfaces:**
- Consumes: checkpoint from Task 1 and main at e64b174.
- Produces: a reviewed PR from codex/codescene-cleanup into main containing the preserved audits and detailed themes.

- [ ] Step 1: Push the checkpoint branch

    Run:

        git push -u origin codex/codescene-cleanup

    Expected: the remote branch contains the checkpoint and merge commit; do not force-push.

- [ ] Step 2: Open a PR against main

    The PR description must state:

        This promotes synchronized main code plus the preserved release-readiness audits and detailed six-theme assets. No gameplay contract changes are intended in this promotion.

- [ ] Step 3: Require the merge gates

    Require npm run test:full, server lint, client lint, browser QA, CodeScene delta review, and human review.

- [ ] Step 4: Merge only after all gates are green

    Merge through GitHub. Do not merge from a feature checkout and do not delete the source branch before the merge is visible on origin/main.

- [ ] Step 5: Verify the merged result

    Run:

        git fetch origin
        git show origin/main:public/clientThemeData.js | Select-String 'DEFAULT_THEME_ID|id: "(original|spring|summer|autumn|winter|light)"'

    Expected: DEFAULT_THEME_ID is original and all six desired IDs are present.

---

### Task 3: Create permanent branch lanes and remove obsolete branches

**Files:**
- Git refs only; no runtime source files are edited.

**Interfaces:**
- Consumes: merged origin/main from Task 2.
- Produces: permanent development, testing, and main branches with explicit ownership.

- [ ] Step 1: Create development from merged main

    Run:

        git fetch origin
        git switch -c development origin/main
        git push -u origin development

- [ ] Step 2: Create testing from merged main

    Run:

        git switch -c testing origin/main
        git push -u origin testing

- [ ] Step 3: Verify unique commits before deletion

    Run for each candidate:

        git log --oneline --left-right origin/main...codex/seasonal-theme-ui
        git log --oneline --left-right origin/main...codex/seasonal-theme-ui-before-reset
        git log --oneline --left-right origin/main...origin/codex/theme-reset

    Expected: no unique runtime code or irreplaceable documentation exists only on an obsolete branch.

- [ ] Step 4: Delete the two obsolete local branches

    Only after Step 3 passes:

        git branch -d codex/seasonal-theme-ui
        git branch -d codex/seasonal-theme-ui-before-reset

    Use -d, never -D.

- [ ] Step 5: Delete obsolete remote branches after merge verification

    Run only after origin/main, development, and testing contain the required commits:

        git push origin --delete codex/theme-reset
        git push origin --delete codex/codescene-cleanup

- [ ] Step 6: Apply branch protection

    Configure main for required PR/checks/no force-push/no deletion. Configure testing for promotion from development plus staging checks. Configure development for required PRs and CodeScene review.

---

### Task 4: Establish the Nest deployment contract

**Files:**
- Create: Dockerfile
- Create: .env.example
- Create: docs/deployment/nest-development.md
- Create: docs/deployment/nest-testing.md
- Modify: server/server.js only for environment-driven startup and health hooks

**Interfaces:**
- Consumes: PORT, NODE_ENV, POORUP_ALLOWED_ORIGINS, POORUP_DATA_DIR, POORUP_BACKUP_DIR, POORUP_TRUST_PROXY_HOPS.
- Produces: the same container and environment contract on Nest and a future paid host.

- [ ] Step 1: Define the environment contract

    .env.example must contain development defaults and no credentials:

        NODE_ENV=development
        PORT=8080
        POORUP_ALLOWED_ORIGINS=http://localhost:8080
        POORUP_DATA_DIR=./server/data
        POORUP_BACKUP_DIR=./server/backups
        POORUP_TRUST_PROXY_HOPS=0
        POORUP_MAINTENANCE_MODE=normal
        POORUP_MAINTENANCE_MESSAGE=
        POORUP_ADMIN_ACCOUNT_IDS=

- [ ] Step 2: Add a minimal Docker image

    The image must use a supported Node LTS base, install production dependencies with npm ci --omit=dev, expose PORT, run node server/server.js, and contain no data files or secrets.

- [ ] Step 3: Add startup and health smoke tests

    Run:

        node server/server.js
        Invoke-WebRequest http://localhost:8080/healthz
        Invoke-WebRequest http://localhost:8080/readyz

    Expected: healthz reports liveness, readyz reports storage/config readiness, and Socket.IO still connects.

- [ ] Step 4: Document Nest operations

    Document deployment, environment variables, persistent data paths, backup paths, logs, rollback to a prior release SHA, and how to stop a deployment without interrupting an active round.

### Task 4A: Replace the stale Nest checkout and make deploys automatic

**Files:**
- Create: `ecosystem.config.cjs`
- Create: `scripts/deploy-nest.sh`
- Create: `scripts/rollback-nest.sh`
- Create: `.github/workflows/deploy-nest.yml`
- Create: `docs/deployment/nest-live-runbook.md`
- Modify: `docs/production-hardening.md`

**Interfaces:**
- Consumes: a clean `main` commit SHA, the maintenance/drain controller, and GitHub Actions Secrets `NEST_HOST`, `NEST_USER`, `NEST_DEPLOY_KEY`, and `NEST_KNOWN_HOSTS`.
- Produces: automatic deployment of every approved `main` push to Nest, with SHA verification, zero dirty-tree deploys, rollback, and PM2 boot persistence.

- [ ] **Step 1: Capture the current Nest release before replacement**

    Record the old SHA `b1f3cd7`, PM2 process name, data/backup paths, and the public health response in the runbook. Do not remove `/root/Poorup` until the new release passes a smoke test.

- [ ] **Step 2: Use immutable release directories**

    Deploy each SHA into `/srv/poorup/releases/<sha>`, keep persistent data outside the release directory, and point `/srv/poorup/current` at the active release. A deployment must refuse to use a dirty Git checkout or an unknown SHA.

- [ ] **Step 3: Move runtime ownership off root**

    Create a dedicated `poorup` system user, grant it only the release/data/backup directories, and run PM2 under that user. Keep SSH administration separate from the runtime account. Do not copy root-owned secrets into the release tree.

- [ ] **Step 4: Define the PM2 process contract**

    `ecosystem.config.cjs` must set the script path through `/srv/poorup/current/server/server.js`, `autorestart: true`, bounded restart delay, memory ceiling, graceful `kill_timeout`, and explicit environment names. It must not contain API keys or passwords.

- [ ] **Step 5: Deploy from GitHub Actions, not server polling**

    Trigger `.github/workflows/deploy-nest.yml` only on pushes to `main` after required CI checks. The workflow connects over SSH, verifies the expected SHA, uploads or fetches that exact release, runs `npm ci --omit=dev`, performs a health/socket smoke test, and reloads PM2. There is no GitHub PAT or webhook secret stored on Nest.

- [ ] **Step 6: Keep the service online during a release**

    The workflow calls the maintenance drain endpoint, blocks new rooms and rounds, waits for `activeRounds = 0`, creates a backup, switches the `current` symlink atomically, reloads PM2, runs `/healthz`, `/readyz`, and a Socket.IO handshake, then returns to `NORMAL`.

- [ ] **Step 7: Roll back on any failed gate**

    If install, boot, health, socket, or smoke checks fail, `scripts/rollback-nest.sh` restores the previous symlink and PM2 process, records the failed SHA, and leaves maintenance status visible until the old release is healthy. Rollback never rewrites Git history.

- [ ] **Step 8: Verify 24/7 behavior**

    Enable only the chosen PM2 boot service, disable the unused `poorup.service`, reboot the testing container during a scheduled window, and verify that PM2 restores the expected release without duplicate processes. Check restart count, memory ceiling, health, and reconnect behavior.

- [ ] **Step 9: Add deployment regression checks**

    Cover dirty-checkout refusal, wrong-SHA refusal, failed-health rollback, active-round drain, duplicate-deploy idempotency, and missing-secret failure. Run the deploy script against a disposable Nest test directory before using the live container.

    Initial beta policy: Nest may track `main` automatically as the live/beta host. Once a second Nest service exists, `testing` tracks staging and `main` is promoted to a paid Production host without changing the application contract.

---

### Task 5: Add the server-authoritative maintenance state

**Files:**
- Create: server/maintenanceState.js
- Create: server/maintenanceState.test.js
- Modify: server/server.js
- Modify: server/serverSocketAccount.js
- Modify: server/socketRuntime.js

**Interfaces:**
- Consumes: environment defaults and an operator-controlled maintenance record.
- Produces:
  - normalizeMaintenanceMode(value): 'normal' | 'draining' | 'maintenance'
  - createMaintenanceSnapshot(input): { mode, message, releaseId, drainDeadline, activeRounds }
  - canCreateRoom(snapshot): boolean
  - canStartRound(snapshot): boolean
  - maintenanceNotice(snapshot): string

- [ ] Step 1: Write failing state-transition tests

    Cover normal permits room creation and round start; draining blocks room creation, Quick Table, and new round starts; draining does not block actions in an already-started round; invalid modes normalize to normal; messages are bounded and secret-free.

- [ ] Step 2: Implement the bounded state module

    Keep it side-effect-free. It must not import Socket.IO or mutate GameState.

- [ ] Step 3: Integrate authoritative guards

    Reject create-room, Quick Table creation, and start-game with MAINTENANCE_DRAINING. Existing game actions continue while the round is active.

- [ ] Step 4: Add health/readiness fields

    healthz remains healthy during draining. readyz reports whether new traffic is accepted and includes release ID without account data.

- [ ] Step 5: Verify

    Run:

        node server/maintenanceState.test.js
        npm run test:full

---

### Task 6: Implement graceful round draining and maintenance UI

**Files:**
- Create: server/drainController.js
- Create: server/drainController.test.js
- Create: public/clientMaintenance.js
- Create: public/clientMaintenance.test.js
- Modify: public/index.html
- Modify: public/main.js
- Modify: public/styles.css
- Modify: server/server.js
- Modify: server/socketRuntime.js

**Interfaces:**
- Consumes: maintenanceState and active-room counters.
- Produces:
  - beginDrain({ releaseId, deadline })
  - activeRoundCount(): number
  - isDrainComplete(): boolean
  - finishMaintenance(): void
  - client event maintenance-state

- [ ] Step 1: Write lifecycle tests

    Cover draining, active-round continuation, zero-active-round completion, deadline restart notice, and reconnect-safe shutdown notice.

- [ ] Step 2: Implement the drain controller

    Use bounded timers and event-driven room counts. Do not poll every client or mutate room state from the UI.

- [ ] Step 3: Add the Home maintenance surface

    Keep Poorup geometry and tokens. Display MAINTENANCE WINDOW, NEW ROUNDS ARE PAUSED, and CURRENT ROUNDS CONTINUE. Provide a keyboard-accessible RETRY STATUS action without page scrolling.

- [ ] Step 4: Add the in-round notice

    Use a non-blocking live region that never covers the board, action controls, focus rings, or modal content.

- [ ] Step 5: Add reduced-motion and failure states

    Use opacity/transform only, respect reduced motion, and handle stale, timeout, offline, and server-restarting states.

- [ ] Step 6: Verify browser behavior

    Run browser checks at 1920x1080, 1366x768, 1024x768, landscape iPad, and 390x844. Confirm Home and active-game screenshots preserve the Poorup layout.

---

### Task 7: Add provider-neutral analytics collection

**Files:**
- Create: server/metricsRegistry.js
- Create: server/metricsRegistry.test.js
- Create: server/analyticsApi.js
- Create: server/analyticsApi.test.js
- Modify: server/server.js
- Modify: server/socketRuntime.js
- Modify: server/socketHandlerSupport.js

**Interfaces:**
- Consumes: bounded server events and deployment state.
- Produces:
  - recordMetric(name, value, labels)
  - incrementMetric(name, labels)
  - snapshotMetrics(range)
  - authorizeAnalytics(accountId)
  - GET /admin/analytics/summary

- [ ] Step 1: Write privacy and retention tests

    Reject or redact chat text, session tokens, hidden cards, private loan terms, opponent secrets, and raw IP addresses. Bound metric labels and history size.

- [ ] Step 2: Implement the in-process registry

    Keep the registry write-only from runtime modules and read-only from the admin API. Use bounded counters and rolling windows.

- [ ] Step 3: Instrument required events

    Record active sockets, rooms, rounds, reconnects, restore failures, action latency, errors, bot fallback, maintenance state, release ID, backup status, and manual CodeScene status.

- [ ] Step 4: Add admin authorization

    Use POORUP_ADMIN_ACCOUNT_IDS. An empty allow-list denies the endpoint. Never infer admin status from display names.

- [ ] Step 5: Add API failure behavior

    Unauthorized requests return 403; malformed ranges return 400; registry degradation returns a bounded stale snapshot and never blocks game actions.

---

### Task 8: Build the internal Analytics surface

**Files:**
- Create: public/clientAnalytics.js
- Create: public/clientAnalytics.test.js
- Modify: public/index.html
- Modify: public/main.js
- Modify: public/styles.css
- Modify: qa/poorup.spec.js

**Interfaces:**
- Consumes: /admin/analytics/summary through the existing API seam.
- Produces: a read-only admin surface with accessible tables and explicit stale/loading/error states.

- [ ] Step 1: Write client contract tests

    Cover unauthenticated denial, admin metrics rendering, loading/stale/timeout/forbidden/empty states, and malformed-data redaction.

- [ ] Step 2: Implement the read-only surface

    Use existing Poorup panels, borders, fonts, table styles, focus rings, and internal scrolling. Do not add a player navigation tab.

- [ ] Step 3: Add browser coverage

    Verify desktop 1920x1080, keyboard navigation, screen-reader labels, 200% zoom, reduced motion, and no page overflow.

---

### Task 9: Define the manual CodeScene/Luna workflow

**Files:**
- Create: scripts/codescene-delta.ps1
- Create: docs/DEVELOPMENT_WORKFLOW-CODESCENE.md
- Modify: .github/workflows/ci.yml only if full-history checkout or required statuses are missing

**Interfaces:**
- Consumes: PR branch, origin/main, and CS_ACCESS_TOKEN from the local environment.
- Produces: a JSON/text CodeScene report and a documented manual handoff to a Luna Codex task.

- [ ] Step 1: Add a safe local delta command

    The script must fail if CS_ACCESS_TOKEN is missing, compare against origin/main, run cs delta --include-metadata --output-format json --pretty, never print the token, and write only to a user-specified ignored artifact path.

- [ ] Step 2: Document the manual trigger

    The documented command is:

        CodeScene für PR <number> reparieren

    The Luna task receives only the PR diff and CodeScene findings. It writes a regression test first, applies the smallest fix, runs tests/lint, and pushes only to the PR branch.

- [ ] Step 3: Define the stop policy

    Stop after three failed fix rounds, any security ambiguity, gameplay semantic disagreement, changed PR SHA, or exhausted Codex quota. Leave the PR open and report the blocker.

- [ ] Step 4: Keep automation out of the loop

    Do not add /cs-agent triggers, OpenRouter secrets, Google keys, or background polling. A future user-owned OpenRouter Action remains a separate project.

---

### Task 10: Prepare persistence and horizontal-scale seams

**Files:**
- Create: server/authoritativeStore.js
- Create: server/authoritativeStore.test.js
- Create: server/pubsubAdapter.js
- Create: server/pubsubAdapter.test.js
- Modify: server/rooms.js
- Modify: server/socketRuntime.js
- Modify: server/server.js
- Modify: docs/production-hardening.md

**Interfaces:**
- Consumes: current JSON stores and in-process rooms.
- Produces:
  - authoritativeStore.readRoom(roomId)
  - authoritativeStore.writeRoom(roomId, snapshot, version)
  - pubsubAdapter.publish(topic, payload)
  - pubsubAdapter.subscribe(topic, handler)

- [ ] Step 1: Characterize current JSON behavior

    Add tests for atomic writes, version checks, stale writes, corrupt data, and recovery. JSON remains the local-development adapter.

- [ ] Step 2: Add versioned interfaces without changing Socket.IO contracts

    The current adapter rejects stale versions and never silently overwrites a newer room snapshot.

- [ ] Step 3: Add explicit production refusal

    Horizontal mode without a real persistent adapter fails boot with an actionable error. Single-instance Nest development continues to work.

- [ ] Step 4: Document the migration gate

    Before multiple game instances, install PostgreSQL and Redis-compatible infrastructure, run migration/restore drills, and verify cross-instance room/reconnect behavior.

---

### Task 11: Add 1,000-player capacity and drain verification

**Files:**
- Create: qa/load/poorup-socket-load.mjs
- Create: qa/load/README.md
- Modify: qa/playwright.config.js only for stable test projects if needed
- Modify: docs/deployment/nest-testing.md

**Interfaces:**
- Consumes: a testing deployment URL and non-production credentials.
- Produces: repeatable capacity evidence without touching production data.

- [ ] Step 1: Define the load scenario

    Use 1,000 simulated WebSocket clients across bounded rooms. Exercise connect, room snapshot, chat cooldown, turn update, reconnect, and maintenance-drain transitions.

- [ ] Step 2: Define pass/fail thresholds

    Pass only if no authoritative state is lost, no duplicate settlement occurs, reconnect success is at least 99%, p95 acknowledgements stay below 150ms in the test envelope, event-loop lag stays below 100ms, memory returns toward baseline, and draining blocks new starts while active rounds continue.

- [ ] Step 3: Run only on Nest testing

    Never run the load script against main or a Production host.

- [ ] Step 4: Record evidence

    Store commit SHA, environment, client count, room count, latency, errors, memory, and drain outcome. Do not store user data.

---

### Task 12: Final release, rollback, and branch cleanup

**Files:**
- Create: docs/deployment/release-runbook.md
- Create: docs/deployment/rollback-runbook.md
- Modify: docs/production-hardening.md
- Modify: docs/DEVELOPMENT_WORKFLOW.md

**Interfaces:**
- Consumes: results from Tasks 1–11.
- Produces: an operator-ready release process with reversible promotion and documented branch ownership.

- [ ] Step 1: Write the release runbook

    Specify: verify release SHA, run backup/restore check, promote testing, run full tests/browser/load checks, set DRAINING, wait for activeRounds = 0, promote exact SHA to main, deploy, run healthz/readyz/socket smoke, set NORMAL, and monitor.

- [ ] Step 2: Write the rollback runbook

    Rollback uses the previous release tag, restores the verified backup if required, keeps maintenance state visible, and records the incident. It never rewrites branch history.

- [ ] Step 3: Update documentation truth

    Document main as Production, testing as Nest staging, development as integration, manual CodeScene/Luna, no automatic refactoring agent, maintenance behavior, analytics privacy, and the PostgreSQL/Redis migration gate.

- [ ] Step 4: Run final gates

    Run:

        npm run test:full
        npm run lint
        npm run lint:client
        npm run coverage
        npm run test:browser

    Run CodeScene against the final PR diff and inspect 1920x1080 Home, lobby, game, maintenance, and analytics screenshots at native resolution.

- [ ] Step 5: Clean only verified obsolete refs

    Delete seasonal backup branches and stale remote branches only after Task 3 checks pass. Keep all audit and plan documents.

---

## Release Acceptance Criteria

- main is the only Production branch and is protected.
- development and testing are permanent, documented promotion lanes.
- All 40 release-readiness audits remain available.
- No automatic CodeScene or Luna agent runs without Jeremy's explicit request.
- CodeScene findings can be reproduced locally without exposing the token.
- Codex quota exhaustion leaves PRs unchanged and clearly reports the blocker.
- Nest can run development and testing with the provider-neutral environment contract.
- Maintenance draining blocks new rooms and rounds while active rounds continue.
- Restart/deploy failures produce explicit reconnect/recovery states.
- Analytics is admin-only, read-only, bounded, and privacy-safe.
- PostgreSQL/Redis migration seams exist before horizontal mode is enabled.
- 1,000-client testing runs only against testing.
- Full tests, audit suites, lint, coverage, browser QA, CodeScene, and visual 1920px review pass before Production promotion.

## Rollback

- Branch migration rollback: restore prior branch refs from tags before deletion.
- Maintenance rollback: return runtime state to NORMAL only after the previous release passes health and socket smoke checks.
- Code rollback: deploy the previous release tag; never force-push or rewrite main.
- Documentation rollback: preserve the audit commit and revert only a documentation change that introduced a contradiction.

## Explicitly Deferred

- Automatic CodeScene PR refactoring
- OpenRouter integration
- Google API integration
- Codex subscription access from GitHub Actions
- Microservices and Kubernetes
- Multi-region active-active rooms
- Real-money analytics or monetization

## Execution record · 2026-09-13

Implemented on `feature/release-operations` from the verified `main` SHA
`f8ca8b7`:

- Maintenance state, drain controller, health/readiness endpoints, graceful
  shutdown, reconnect-safe Home/game notices, and admin-only analytics.
- CI/full-test coverage, browser matrix, 1920px theme evidence, Docker/PM2
  release assets, immutable Nest deployment/rollback scripts, and the
  testing-only socket capacity harness.
- Provider-neutral `authoritativeStore` compare-and-swap and `pubsubAdapter`
  seams, with a strict horizontal-scale guard requiring both a Postgres URL and
  `POORUP_PERSISTENCE_ADAPTER=postgres`.

Evidence on this execution branch:

- `npm run test:full` — pass.
- `npm run lint` and `npm run lint:client` — pass.
- `npx playwright test -c qa/playwright.config.js` — 166 passed, 32 skipped by
  intentional viewport guards.
- `npm run coverage` — pass; 90.08% statements, 77.72% branches, 87.3%
  functions.
- Native 1920px theme captures inspected under `qa-artifacts/theme-homes-1920`.

External setup still requires an approved Nest maintenance window, the
repository variable `NEST_DEPLOY_ENABLED=true`, and GitHub environment secrets
(`NEST_HOST`, `NEST_USER`, `NEST_DEPLOY_KEY`, `NEST_KNOWN_HOSTS`,
`POORUP_MAINTENANCE_TOKEN`). The read-only inspection found
the live Nest checkout at `/root/Poorup` on old commit `b1f3cd7`, running as a
root-owned PM2 process; no automatic pull/deploy hook exists. The workflow is
ready, but it must not interrupt that live legacy process until the first
maintenance-capable bootstrap is explicitly scheduled.

## Skill Discovery and Selection

The local skill catalog is sufficient for this implementation. The plan uses:

- `superpowers:using-superpowers`, `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:verification-before-completion`, and `superpowers:finishing-a-development-branch` for gated planning, integration, and evidence.
- `software-architecture-design` and `code-architecture-review` for the modular-monolith, branch-promotion, persistence, and scaling boundaries.
- `systematic-debugging`, `security-best-practices`, `qa-agent-testing`, `agentic-eval`, and `tdd` for root-cause investigation, test-first fixes, safe release gates, and bounded retries.
- `accessibility`, `web-design-guidelines`, `frontend-design-review`, `impeccable`, `game-ui-ux`, and `mobile-responsiveness` for the maintenance and analytics surfaces while preserving Poorup's existing UI system.

The online `skills.sh` search found `github-actions`, `monitoring-observability`, `upstash-redis-kv`, `systemd-services`, and `engineering-game-backend-architecture` candidates. No external skill was installed: the local guidance covers the required workflow, and the lower-install-count third-party results would add maintenance and supply-chain review without a concrete gap.
