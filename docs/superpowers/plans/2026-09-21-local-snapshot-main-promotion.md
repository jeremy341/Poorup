# Exact Local Snapshot Promotion to Main — Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for inline execution. Treat each checkbox as a gate; do not skip the tree-equivalence or release-branch checks.

**Goal:** Make the eventual Main commit's tracked tree equal the current approved local `selective-picks` snapshot, plus the seven account-rights/recovery/deletion tests requested from Main and the account-test script that runs them.

**Architecture:** Build the candidate in an isolated branch/worktree based on freshly verified Main, without rewriting history. Reconstruct the final tracked tree from the local checkout (including its current tracked edits), then add only the selected Main tests and their `package.json` test registration. Promote through the repository's development/testing release gates to Main, verifying that each merge preserves the approved candidate tree.

**Tech Stack:** Git branches/worktrees and pull requests; Node.js test scripts; ESLint; Playwright QA.

**Spec:** User request in the 2026-09-21 conversation, clarified to mean “local tracked snapshot + only the selected Main additions.”

## Global Constraints

- Source snapshot is the current `selective-picks` checkout at `462e2cf` plus its four tracked, unstaged edits as captured at execution start.
- Import only these seven missing test files from the freshly fetched Main ref: `public/clientAccountRights.test.js`, `public/clientAccountSessionStorage.test.js`, `server/accountDeletion.test.js`, `server/accountRecoveryPersistence.test.js`, `server/accountRightsSocket.test.js`, `server/accountStore-rights.test.js`, and `server/backupAccountPurge.test.js`.
- Add Main's `test:account` script to `package.json` and make `test:full` run it; retain the local `test` and `test:audit` commands.
- Do not import other Main implementation, UI, documentation, skills, scripts, or assets unless separately approved.
- Never stage `server/backups/`; it is untracked local account/match/telemetry data. Leave `docs/audit/batch1-gamelogic.md` outside the release commit unless the user separately requests it.
- No `reset --hard`, force-push, tag/version bump, or broad `git add .`.
- Do not weaken or delete imported tests to make the candidate pass. If they expose code incompatibility, stop and request approval before expanding scope to implementation fixes.
- Create and push only a normal candidate branch/PR; no direct push to protected Main. The final tree must be checked against the approved snapshot before each promotion.

## Review Focus

1. **Stale remote refs:** fetch and record `origin/main`, `origin/development`, and `origin/testing` before selecting source commits; do not trust the old local tracking refs.
2. **Test/source contract mismatch:** run each imported account suite against the candidate source and preserve failures; do not edit assertions to fit old behavior.
3. **Incomplete release gate:** ensure `npm run test:full` actually invokes the account suite through the new `test:account` script.
4. **Private-data leakage:** verify the staged manifest contains no `server/backups/` paths or other untracked local data.
5. **Snapshot drift:** compare every tracked candidate path/blob with the local snapshot and allow only the seven selected test files plus the specified `package.json` script changes.

## Scope Map

- **Restore from Main:** the seven test files listed above.
- **Modify:** `package.json`, only to add `test:account` and append it to `test:full`.
- **Carry forward from local:** all tracked files from `selective-picks` plus the four current tracked edits in `server/aiProviderRoutes.test.js`, `server/botAdvisor.js`, `server/botAdvisor.test.js`, and `server/gameLogic.test.js`.
- **Keep out of the commit:** untracked `server/backups/` and `docs/audit/batch1-gamelogic.md` by default.
- **Do not port:** any other Main-only file or implementation change.

## Important Tree Consequence

The current local snapshot differs from local `origin/main` by 162 committed paths, and the tracked working tree adds changes in four files. Restoring the seven requested tests still leaves eleven Main-only files absent from the local snapshot: two TypeSafe skill files, one operator design file, the CodeScene workflow and account-rights decision documents, three older plan/spec documents, and two audit scripts. Also, 79 shared paths differ, including server and client code. An exact local-snapshot commit therefore intentionally replaces those Main versions; it is not an additive merge that preserves every Main-only file or implementation change.

**Approval gate:** Before constructing or promoting the candidate, show the exact Main-only deletion/replacement manifest and obtain confirmation that this exact-tree outcome is intended. If the user instead wants to retain any Main-only content, revise the target snapshot before writing it.

---

### Task 1: Freeze and approve the exact source snapshot

**Files:** No source files changed.

- [ ] Record `git status --short --branch`, current HEAD, staged diff, unstaged diff, and untracked paths.
- [ ] Fetch `origin` and record the fresh Main/development/testing commit IDs and parent graph.
- [ ] Create a recoverable backup ref for the current `selective-picks` HEAD; do not include untracked backups in Git.
- [ ] Produce the full path manifest for the local snapshot, the seven imported tests, the two `package.json` script changes, and every Main-only path that the exact snapshot would remove or replace.
- [ ] Show that manifest to the user and stop until the exact-tree approval gate is satisfied.

### Task 2: Restore account coverage and wire the release test command

**Files:**
- Restore the seven test files listed in Scope Map from fresh `origin/main`.
- Modify `package.json` only for `test:account` and `test:full`.

**Interfaces:** `test:account` runs the Main account suite, including the seven restored tests and the existing local account/session/export/mail/recovery/retention tests. `test:full` runs `npm test`, `npm run test:audit`, and `npm run test:account` in that order.

- [ ] Copy the seven test files byte-for-byte from the selected fresh Main commit; record their source commit and hashes.
- [ ] Add the `test:account` command from Main while preserving the local commands and append `npm run test:account` to `test:full`.
- [ ] Run `npm run test:account` in the isolated candidate. Expected: all account tests pass; otherwise stop and report the first concrete mismatch without weakening a test.
- [ ] Run `npm run test:full` after the targeted suite; preserve the exact failing test and output if any.

### Task 3: Construct the exact candidate tree without disturbing the checkout

**Files:** Candidate branch/worktree only; the current checkout stays untouched.

- [ ] Create an isolated candidate branch from fresh `origin/main` after approval.
- [ ] Reconstruct its tracked files from the approved local snapshot, including the four tracked working-tree edits, while keeping all untracked/private data out.
- [ ] Overlay the seven exact Main test files and the approved `package.json` test registration from Task 2.
- [ ] Compare tracked paths and blob hashes against the target manifest. Expected: only the seven restored tests and two specified package-script entries differ from the local snapshot; no other Main file silently survives or enters.
- [ ] Review staged paths explicitly; assert `server/backups/` and unrelated untracked files are absent.
- [ ] Commit the candidate as a normal, versionless snapshot/reconciliation commit; record its commit and tree hashes.

### Task 4: Run deterministic release gates

**Files:** No additional product files unless a separate fix is approved.

- [ ] Run the account suite: `npm run test:account`.
- [ ] Run server/client lint: `npm run lint` and `npm run lint:client`.
- [ ] Run the full deterministic suite: `npm run test:full`.
- [ ] Run browser QA: `npm run test:browser`; confirm the test server is started from the candidate worktree, not the old checkout.
- [ ] Compare the candidate Home/admin UI at 1920×1080 to the approved local screenshot/baseline. The previous check found `localhost:8080` was not listening, so start the candidate server only during this approved execution phase before visual QA.
- [ ] Re-run `git status` and the staged/path manifest; stop if private data or unrelated files appear.
- [ ] Previously observed baseline to re-check: `server/gameLogic.test.js` failed on `cardDraws` (`{}` expected vs `{ surprise: 0, treasure: 0 }` actual). Determine whether it still reproduces before attributing failures to imported account tests.

### Task 5: Promote through release branches and prove Main's final tree

**Files:** Git branch/PR state only; no version metadata changes.

- [ ] Re-read the fresh branch graph and follow the configured path: candidate → `development` → `testing` → `main`. If the fresh graph makes this path non-fast-forward or produces extra tree changes, stop and report before merging.
- [ ] Merge the candidate normally into development; verify the result tree equals the approved candidate tree.
- [ ] Promote development to testing; run the complete test and browser gates on the testing build and verify tree equality again.
- [ ] Promote testing to Main with a normal PR/merge, no force-push and no version bump.
- [ ] Verify the final Main tree hash equals the approved candidate tree hash and list the resulting commit(s).

## Self-Review

- The account tests, test registration, exact tracked snapshot, release tests, and branch promotion each have an owning task.
- The plan explicitly distinguishes a literal local snapshot from an additive merge and blocks on approval of Main-only file loss/replacement.
- No production fix is inferred from a failing imported test; any implementation expansion needs a separate approval.
- No backups, untracked audit notes, force-pushes, or version bumps enter the planned release.
