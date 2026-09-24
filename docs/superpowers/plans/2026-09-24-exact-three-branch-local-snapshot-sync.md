# Exact Local Snapshot Sync Across Main, Development, and Testing

> **For agentic workers:** Use `superpowers:subagent-driven-development` for implementation. Keep each agent on its assigned, disjoint review scope. Every task ends with a verification gate.

**Goal:** Commit the current approved local snapshot and make the tracked file tree on `development`, `testing`, and `main` identical, then leave the primary checkout on `development`.

**Architecture:** Freeze the current index as the candidate snapshot, review it without rewriting the user’s staged intent, and promote it through pull requests: candidate into `development`, `development` into `testing`, then `testing` into `main`. Verify tree hashes at each promotion; commit SHAs may differ because of merge commits.

**Tech Stack:** Git, GitHub pull requests/actions, Node.js test scripts, ESLint, Playwright, CodeScene, Nest’s existing systemd pull deployment.

**Spec:** User’s current instruction in this conversation: the staged local snapshot, including the staged document removals, is intentional and should be used as the common branch content. The user also asks for a test-triage pass to identify checks that flag behavior incorrectly.

## Baseline and Intent

- At plan creation, checkout is `development` at `c6eafb536527832ee7ec9e8eb543b52ac3d4edcf`; local `main` is `fb184834395c8445f859696ec93d8e810a37c68d`; local `testing` is `7f15632871c5e8fba9afa239ab624038754f3eb2`.
- The committed local tree matches the committed `development` tree. The staged index contains 123 paths: 113 deletions and 10 modifications; there are no unstaged paths. These staged changes are intentional, including their document deletions; do not restore them based on older notes.
- `testing` is three commits behind `development`, with code/test differences in `public/clientMusicPlayer.js`, `public/main.js`, `server/gameLogic.js`, `server/socketRuntime.js`, `server/audit-game-contracts.test.js`, and `server/player-lifecycle-timers.test.js`.
- `main` and `development` have the same runtime code; their tree difference is the batch-1 audit document that this release plan now removes through the local snapshot.
- `node server/docsFeatureStatus.test.js`, `node server/docs-parity.test.js`, and `npm run test:full` passed against the current staged snapshot. The first sandboxed full-suite attempt hit `spawn EPERM` in `server/rooms.test.js`; the same command passed when rerun with permission for its local test-server process. The suite reported 1,000 bounded bot games, 979 ending within 2,000 steps, and zero stalled.
- The full promotion plan is to use the exact local staged snapshot plus this plan file. Do not include unrelated untracked data or backup contents.

## Global Constraints

- Preserve the staged snapshot as-is. Do not unstage, restore, or silently omit any of its 123 paths.
- Do not use `reset --hard`, force-push, version/tag bumps, or broad `git add .`.
- Keep the permanent branches `main`, `development`, and `testing`.
- Do not delete unmerged work or branches associated with linked worktrees until their unique commits and worktree contents have been inspected and preserved.
- Keep the Poorup UI, themes, layout, gameplay, server authority, and Socket.IO contracts unchanged except for source fixes that are proven necessary by a failing test.
- A branch is “identical” when its tracked tree hash matches the target tree; merge commit SHAs need not be equal.
- Use normal PR merges to protected branches. Nest’s existing updater is the production deploy path; do not manually trigger a deploy or maintenance mode.
- If a test fails, distinguish a reproducible product defect from sandbox/process setup, stale expectation, or flaky test. Never delete or weaken a test merely to obtain green CI.

## Review Focus

1. Do all 123 staged paths match the explicitly approved local snapshot, with no untracked/private backup data entering the candidate?
2. Do the staged docs removals leave broken README links, feature-status references, or docs-parity assumptions?
3. Are any test failures caused by an obsolete expectation rather than current canonical game behavior?
4. Does promotion preserve the current UI and avoid introducing document/body scrolling or server/gameplay changes?
5. Do the exact `main`, `development`, and `testing` tree hashes equal the frozen target after every merge?

---

### Task 1: Freeze the candidate snapshot

**Files:** No existing files changed in this task. Include this plan as the only new planned file.

- [ ] Record `git status --short --branch`, `git diff --cached --name-status`, `git diff --name-status`, and `git ls-files --others --exclude-standard`.
- [ ] Confirm the staged count remains 123, unstaged count is zero, and there is no untracked private data.
- [ ] Review the staged path manifest against the intended snapshot; keep every staged deletion/modification exactly as staged.
- [ ] Add this plan file to the candidate scope. Do not add any other plan, backup, or generated artifact unless separately requested.
- [ ] Run `git diff --cached --check`; record the result.
- [ ] Record the candidate tree after the snapshot commit with `git rev-parse 'HEAD^{tree}'`; call that value `TARGET_TREE` and keep it in the PR descriptions.

### Task 2: Six-agent review and test-flag triage

Use six Luna Medium agents in two batches of three, respecting the four-slot cap including the primary agent. Reuse the existing Poorup audit agents where available. All first-pass agents are read-only and have non-overlapping scopes:

1. Snapshot/doc-path audit: inspect the staged path list, README links, feature-status manifest, and removed documents; report only broken references or unintended paths.
2. Test fidelity audit: inspect docs-parity and feature-status assertions plus reported CI failures; classify each as product defect, stale expectation, harness/environment, or false positive.
3. Branch/tree audit: verify base/head relationships, the exact source tree, protected branch promotion order, and linked worktrees.
4. Game/server audit: review the actual runtime code changed between `testing` and the candidate, focusing on settlement, bankruptcy, reconnect, turn order, and server authority.
5. Client/UI audit: verify no unrequested UI/layout/theme changes and preserve no-body-scroll, accessibility, and existing rendering contracts.
6. Independent pre-merge audit: verify PR contents, CI/CodeScene checks, branch tree hashes, deployment readiness, and branch-cleanup safety.

- [ ] Dispatch the first three agents concurrently with precise file/path allowlists; do not allow edits during diagnosis.
- [ ] Reconcile their findings against fresh source, the current canonical rules, and test output.
- [ ] Dispatch the remaining three focused reviewers only after the first batch returns.
- [ ] If a concrete code defect is reproduced, assign one implementation owner with an exclusive path allowlist; write a failing regression test first, fix minimally, then rerun the relevant suite.
- [ ] If a test is judged false-positive, require evidence that it contradicts canonical behavior; update only that assertion/test and document why. Do not blanket-suppress warnings.

### Task 3: Test and quality gates on the frozen snapshot

- [ ] Run focused docs contracts: `node server/docsFeatureStatus.test.js` and `node server/docs-parity.test.js`.
- [ ] Run the full suite: `npm run test:full`.
- [ ] Run `npm run lint` and `npm run lint:client`.
- [ ] Run `npm run coverage`.
- [ ] Run browser QA: `npm run test:browser -- --workers=1`.
- [ ] Confirm the current production dependency audit and server wire checks pass in CI.
- [ ] Run CodeScene on each promotion PR; require its quality gates to pass. Treat earlier CodeScene issues as resolved only when the current review reports that.
- [ ] If local child-process tests fail with `EPERM`, rerun the same command with the required local process permission; do not classify infrastructure denial as a test assertion failure.

### Task 4: Commit the local snapshot on a candidate branch

**Files:** All 123 currently staged paths plus this plan file. No unstaged source edits are assumed.

- [ ] Create a temporary candidate branch from the current `development` tip without changing the staged content.
- [ ] Commit the exact staged snapshot with a descriptive message; stage this plan file explicitly and include it in the candidate tree.
- [ ] Verify the commit includes exactly the reviewed path manifest and no `server/backups/`, logs, tokens, generated browser output, or unrelated files.
- [ ] Re-run `git status --short --branch` and record the candidate commit and `TARGET_TREE`.

### Task 5: Promote candidate into `development`

- [ ] Open a PR from the candidate branch to `development`.
- [ ] Require green CI, CodeScene approval, and a clean review of the exact diff.
- [ ] Merge normally; no direct push to the protected branch.
- [ ] Fetch the merged ref and verify `git rev-parse 'development^{tree}'` equals `TARGET_TREE`.

### Task 6: Promote `development` into `testing`

- [ ] Open a PR from `development` to `testing`, which is currently three commits behind.
- [ ] Require the full test and browser gates for this release-candidate promotion; run any staging/load checks configured for testing.
- [ ] Merge normally and verify `git rev-parse 'testing^{tree}'` equals `TARGET_TREE`.
- [ ] If testing finds a code defect, fix it on development with a regression test, then promote the corrected tree forward; do not patch testing independently.

### Task 7: Promote `testing` into `main`

- [ ] Open the final PR from `testing` to `main`.
- [ ] Verify the diff is only the already-tested candidate tree, all required checks and CodeScene gates pass, and no branch-specific code is introduced.
- [ ] Merge normally; do not use a force-push or version bump.
- [ ] Verify `git rev-parse 'main^{tree}'`, `git rev-parse 'development^{tree}'`, and `git rev-parse 'testing^{tree}'` all equal `TARGET_TREE`.

### Task 8: Return to `development` and finish branch cleanup

- [ ] Leave the primary checkout on `development`.
- [ ] Keep `main`, `development`, and `testing` permanently.
- [ ] Inventory remaining non-core local/remote refs and linked worktrees. Delete only refs whose unique commits are in `TARGET_TREE` and whose worktrees are empty/removed safely.
- [ ] Preserve unmerged `fix/restore-rooms-paint` work and linked worktree branches until their contents are individually reviewed; ask before deleting anything that would discard unique work.
- [ ] Confirm the original 123 staged paths were consumed into the candidate commit and no extra staged/unstaged content remains.

### Task 9: Verify Nest auto-deployment

- [ ] Do not manually start a production deploy or change maintenance state.
- [ ] Wait for the existing systemd pull timer after the `main` merge.
- [ ] Verify `/srv/poorup/current` and `/healthz` report the deployed `main` release SHA, and `/readyz` is healthy, accepting new rounds, and has no active rounds.
- [ ] Report the exact release SHA and timer result; if deployment fails, keep `main` intact and use the documented rollback process only after presenting the failure evidence.

## Expected End State

- The tracked tree hashes on `main`, `development`, and `testing` equal `TARGET_TREE`.
- The current checkout is on `development`.
- The intentional staged documentation deletions/modifications are included, tests pass without weakened assertions, and only truly merged/no-worktree branch refs have been removed.
- Nest serves the exact `main` release SHA through its existing auto-pull pipeline.
