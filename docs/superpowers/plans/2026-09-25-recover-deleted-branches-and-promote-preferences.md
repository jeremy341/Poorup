# Deleted-Branch Recovery and Preferences Promotion Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` with independent, non-overlapping file allowlists, or `superpowers:executing-plans` if working inline. Use TDD for behavior fixes and `superpowers:verification-before-completion` before each promotion. This plan is planning/audit output only; no implementation, branch recreation, PR, or merge has been performed.

**Goal:** Preserve the recoverable commits for the Profile → Account & Preferences theme/music chooser and the bounded match-history read fix, then selectively integrate only those two changes through `development → testing → main`.

**Architecture:** Keep `main`, `testing`, and `development` as permanent, tree-identical lanes between promotions. Preserve local recovery refs for the two selected changes, create a fresh feature branch from current `development`, and port only their verified hunks. Audit other dangling branches for provenance, but do not promote their code or apply a mixed stash in this pass. Use normal PRs for feature → development → testing → main; Nest automatically pulls the exact `main` SHA after the promotion.

**Tech Stack:** Git/GitHub PRs, Node.js tests, ESLint, Playwright, current vanilla HTML/CSS/JavaScript, Socket.IO server, existing Nest pull-timer deployment.

**Audit baseline (2026-09-25):** `development=34c0e07`, `testing=8164b60`, `main=60149e3`; all three have tree `0df6ebca72a4c80c4eb02a406d03698699b6c051`. The checkout is clean except the user-owned untracked `docs/superpowers/specs/2026-09-25-independent-bot-strategy-design.md`, which must remain untouched. The theme/preferences and several hardening commit objects are currently unreachable but still readable. The former NO-AI latency/tab-sync candidate worktree was uncommitted and is absent; exact recovery from Git is not available. Six audition copies were restored from OpenGameArt to the ignored `qa-artifacts/music-candidates-2026-09-25/` folder only; they are not in the production manifest.

## Audit Findings: What the Candidate Work Contains

| Candidate | What it contains | Audit ruling |
|---|---|---|
| `c633f20` / feature `67923f5` | Replaces the LOOK-triggered theme dialog with an always-visible theme grid and a soundtrack panel inside Profile → Account & Preferences. Wires theme selection and track selection through the existing music controller. `c633f20` adds internal profile scrolling and viewport tests. | This is the UI the user remembers. It is not in current `main`; commit objects survive, but no branch ref exists. Its branch has 25 commits not in `main` and 16 main-only commits. Restore the commit chain, then port selectively. |
| `b586fd2` | Alternate music/preference test adjustments. It removes broad music-box geometry/runtime coverage while aligning tests to the new surface. | Preserve for reference only. Do not apply test deletions wholesale; add focused coverage to current tests. |
| `dbec5fd` / `46a7ff0` | Canonical music runtime/queue hardening. | Compare each hunk with current main’s later music-sync changes before porting; never replace the music controller wholesale. |
| `6c2dac9` | Social account-guard regression test and ruleset normalization changes. Main already contains the important behavior; the new test is the possible delta. | Confirm the self-view/privacy expectation, then optionally add only the regression test. No production-code cherry-pick by default. |
| `ae41c12` | Bounds match-history query limits before calling the backing store, with propagation coverage. | Unique useful fix: port adapter and test together, test-first. |
| `5a57280` | CodeScene output redaction and TypeSafe audit output-root containment. | Useful security hardening, but current tests do not demonstrate secret redaction or path-traversal resistance. Add behavioral tests, including Windows path and symlink cases, before porting. |
| `056dfaee` | Account/recovery/deletion test gates. | These tests are byte-for-byte present in current main; do not duplicate them. |
| `4d545c8` | 43 lines restoring Rooms-browser CSS. | The selectors are already present in current main; no code port needed. |
| `dd2707a` | Older full snapshot candidate, with a large tree delta from current main. | Superseded by PR #90’s `9e4b23f`, whose tree exactly matches current `main`; never use as a replacement snapshot. |
| `4f3894c` | Branch-promotion design suggesting a reverse sync from `main` down to other lanes. | Conflicts with the requested forward promotion flow. Do not adopt as policy; record as superseded if its document is ever restored. |
| `stash@{0}` | Mixed 107-path WIP across UI, game logic, accounts, analytics, deployment. | Do not apply wholesale. Review only individually identified server hunks; keep UI out of backend promotion. |
| `stash@{1}` | Old game-logic WIP including debt-mode and socket-ID idempotency. | Do not apply wholesale. Its debt-mode behavior conflicts with the explicit rule that bankruptcy eliminates and debt is only a rescue opportunity before declaration. |

The old theme/music branch’s manifest still had one configured approved track per theme. The missing secondary candidates are now locally auditionable: Spring—Apple Cider (CC0); Summer—Funked Up (CC0); Autumn—Autumn Colors (CC-BY 3.0, credit shiru8bit); Winter—Through the Snow (CC0); Light—FrogTown (CC0) and Urban Theme (CC0, raw/unadjusted). Keep the original source archives and credit notes in the ignored audition folder; copy approved audio into shipped assets only during implementation. Remember Winter was not located, and Good Morning still has no destination. Exclude the three deleted songs. Do not create edited derivatives without the user’s edit/gain direction.

## User Assignment So Far

| Theme | Current main in manifest | Planned secondary entries |
|---|---|---|
| Original | Pondering the Cosmos | None |
| Spring | Hot Springs Town | Apple Cider |
| Summer | Summers | Funked Up |
| Autumn | Autumn | Autumn Colors |
| Winter | Snowy Village | Through the Snow; Remember Winter only after its source is supplied and edit is defined |
| Light | Town | FrogTown; Urban Theme |

**Pending user decision:** previous curation said Town should not be Light’s main, while the current manifest uses Town as main and the latest instruction names FrogTown/Urban Theme as secondaries. Do not silently swap the main; get the user’s Light-main choice before updating that mapping. Urban Theme’s volume adjustment also needs a target gain. The current audit remains planning-only.

## Global Constraints

- Do not edit, stage, overwrite, reset, or delete the untracked independent bot strategy spec.
- Do not `reset --hard`, force-push, prune Git objects, clear stashes, delete permanent branches, or merge an entire dangling snapshot.
- No changes to the global shell, board, unrelated pages, or theme art. Keep the visual change scoped to the existing Profile → Account & Preferences preferences surface and preserve Poorup tokens.
- Preserve the no-document/body-scroll invariant; taller preferences content must use accessible internal scrolling.
- Keep server authority, sanitized local music preferences, canonical audio controller ownership, existing account/session behavior, and bankruptcy semantics.
- Preserve the audition pack under ignored `qa-artifacts/`; never stage the sample files themselves as the shipped assets accidentally.
- Do not claim the previous NO-AI candidate is recoverable from Git; its isolated uncommitted worktree is gone. Reconstruct it only as a separate future task from conversation evidence.
- No version bump. Do not deploy until the final `main` merge; Nest’s pull timer is the deployment mechanism.

## Review Focus

1. A theme change must load that theme’s selected/default track without resetting another theme’s saved choice or overriding the global music disabled state.
2. A custom track choice must survive reload and theme switching through the existing sanitized persistence contract.
3. The inline selector must not create a second playback controller or exceed the existing audio-channel limit.
4. Every displayed secondary must resolve to a verified local track ID with its source/license recorded; missing Remember Winter must remain unavailable, not a fake option.
5. Profile content must remain reachable at 1920, desktop, mobile, and landscape iPad without document scrolling, clipped focus, or hidden radio controls.
6. Match-history limits must be enforced before store reads, not only on the returned array.
7. A preserved account must not gain account-deletion abilities or become visible through social projections as a result of recovering old test code.

---

### Task 1: Preserve and label the recoverable commit graph

**Files:** Git refs only; do not modify source files. Preserve existing stashes and worktree markers.

**Interfaces:** Input is the current Git object database and recorded commits below. Output is a local recovery index that makes selected objects reachable without merging them.

- [ ] Record current branch SHAs/tree hash, working-tree status, all 3 permanent refs, all stashes, and exact untracked paths in the audit log.
- [ ] Create local-only recovery refs for the selected tips `c633f20` (theme/music preferences) and `ae41c12` (bounded match-history reads), named `recovery/2026-09-25/theme-music-preferences` and `recovery/2026-09-25/match-history-bound`. Do not push these refs.
- [ ] Keep the other audited tips and stashes untouched; do not create recovery refs for candidates explicitly excluded from this integration unless the user asks later.
- [ ] Keep `dd2707a` and the PR #90 snapshot `9e4b23f` recorded as a superseded comparison, not as competing release heads.
- [ ] Do not create refs for stash/index/WIP objects as if they were finished branches. Keep both stash entries intact and record their parent SHAs.
- [ ] Verify `git status --short` still shows only the same user-owned untracked strategy spec; no source file or stash changed.

### Task 2: Preserve the completed current-main audit result

**Files:** No source changes. Produce an audit report in chat and, after approval, a concise checked-in branch-recovery report.

- [x] Compare recoverable candidates against `main` and classify them as already merged/equivalent, unique, stale, or conflicting; do not infer missing code from a deleted branch name alone.
- [x] Confirm `056dfaee`'s account/recovery test files and test registration are already present in main; do not duplicate them.
- [x] Confirm the Rooms selectors from `4d545c8` are present in current main CSS; do not duplicate the styling.
- [x] Confirm `6c2dac9`'s important social/ruleset behavior is already in main; the new social test is outside selected scope.
- [x] Confirm `ae41c12` has the unique match-history pre-store limit bound, to be ported test-first.
- [x] Identify `5a57280`'s script redaction/path-containment changes as useful but unproven and defer them to a separate security review.
- [x] Inspect both stashes at a summary level. Preserve stash0 as mixed WIP and exclude stash1's conflicting debt mode/socket-ID idempotency.
- [x] Recheck GitHub PRs, current local/remote refs, and worktrees. PR #88 and PRs #90–#92 are merged; there is no remote theme-preferences branch or surviving candidate worktree.

### Task 3: Port the theme/music preference UI selectively

**Files:** Expected after approval: `public/index.html`, `public/clientTheme.js`, `public/clientMusicData.js`, `public/clientMusicPlayer.js`, `public/styles.css`, `public/assets/audio/README.md`, six reviewed audio assets under their theme directories, and focused client/QA tests. Do not copy the audition `.zip` files into `public/`.

**Interfaces:** Reuse current `clientMusicPlayer.js` as the only playback owner. The preference UI may call the canonical theme and track callbacks and read a sanitized player snapshot; it must not create another audio/controller instance.

- [ ] Create a new short-lived feature branch from current `development`; do not start from c633f20’s stale branch base.
- [ ] Compare `origin/main:public/clientTheme.js` and `c633f20:public/clientTheme.js`; port the inline theme grid and `#theme-music-panel` rendering while retaining current main’s event, account, and music-controller APIs.
- [ ] Port the matching `data-theme-preferences`, `#theme-choice-grid`, and `#theme-music-panel` markup into the existing Profile → Account & Preferences preferences section only.
- [ ] Keep each theme’s active theme and selected track visible, use accessible radio-group semantics, expose AUTO/CUSTOM state honestly, and ensure theme switching changes the soundtrack without resetting the user’s other theme selections.
- [ ] Add the six locally auditioned approved files as theme-scoped secondary entries: Apple Cider→Spring, Funked Up→Summer, Autumn Colors→Autumn, Through the Snow→Winter, FrogTown→Light, Urban Theme→Light. Add license/creator/source entries to the audio README; keep Autumn Colors attribution. Remember Winter stays out until its original source and requested edit are supplied.
- [ ] Resolve the Light-main conflict and Urban Theme target gain with the user before modifying `defaults.light` or producing an adjusted file; do not infer a replacement for Town.
- [ ] Extend the existing music-preference schema with a sanitized per-theme selected-track map so a secondary chosen for Spring remains that theme’s choice after switching away/back. Migrate the existing single `{theme, track, mode}` preference safely; fall back to each theme’s current default for missing/invalid map entries. Preserve volume/loop/shuffle/disabled preferences and keep one canonical controller.
- [ ] Port `c633f20`’s internal profile scroll ownership and overflow cue only if current-main viewport tests prove the inline panel needs it. Preserve the no-body-scroll layout and all unaffected account controls.
- [ ] Port/rewrite the candidate `public/clientThemePreferences.test.js` against current-main APIs; retain existing music dock geometry/runtime coverage, and cover inline chooser visibility, all six themes, the six assigned secondary IDs, per-theme selection persistence across theme switching/reload, invalid legacy state migration, disabled music, hidden view, and teardown. Do not use `b586fd2` as a wholesale test replacement.
- [ ] Run `node public/clientThemePreferences.test.js`, `node public/clientMusicPlayer.test.js`, `node public/clientResponsiveA11y.test.js`, `npm run lint:client`, then `qa/theme.spec.js` and `qa/music-box-reference.spec.js` at 1920, 1366, 1024, iPad landscape, and 390 widths. Add a dedicated runtime test only if current tests do not cover a changed public runtime seam; the candidate-only `clientMusicRuntime.test.js` is not present in main.

### Task 4: Apply the selected match-history safety fix

**Files:** `server/matchHistoryAdapter.js` and `server/matchHistoryAdapter.test.js` only, unless a focused regression proves an additional file is required.

- [ ] Implement the match-history pre-store limit correction test-first; prove a hostile/high input never reaches the store above 100 and returned results remain compatible.
- [ ] Do not include the CodeScene/TypeSafe scripts, social guard implementation, or other release-hardening candidates in this implementation. They remain audit-only until separately approved and tested.
- [ ] Keep production behavior already present on main unchanged; don't restore an old account resolver, debt bankruptcy mode, or legacy token/session behavior from stale candidates.
- [ ] Run `node server/matchHistoryAdapter.test.js`, related account/match-history tests, `npm run lint`, and `git diff --check`.

### Task 5: Reconcile active documentation and record the branch policy

**Files:** `docs/DEVELOPMENT_WORKFLOW.md`, `docs/deployment/release-runbook.md`, `docs/deployment/nest-development.md`, `docs/deployment/nest-testing.md`, `docs/deployment/nest-live-runbook.md`, `docs/production-hardening.md`, and the two superseded snapshot plans. Keep audit history; do not delete historical documents.

- [ ] Make `development → testing → main` via normal PRs the sole promotion flow; keep all three branches permanent and forbid force-push/reset/delete-source-branch operations.
- [ ] Update the contributor rule from “branch feature work from main / PR directly into main” to “work on a short-lived branch based on development, PR into development, then promote development to testing and testing to main after gates.”
- [ ] Record verified branch SHAs/tree equality at the time of implementation and list exact CI/CodeScene/browser gates required at every promotion.
- [ ] Document Nest accurately: the current active instance follows `origin/main` via the three-minute systemd pull timer; GitHub push-deploy workflows are currently disabled; do not label one live Nest instance as both development and testing hosts.
- [ ] Reconcile manual release-runbook steps with the existing drain-gated timer deployment. Keep the manual sequence only as an operator/emergency path, not as the normal deploy path.
- [ ] Mark `2026-09-21-local-snapshot-main-promotion.md` and `2026-09-24-exact-three-branch-local-snapshot-sync.md` as completed/superseded by PRs #90–#92, preserving their historical content and outcomes.
- [ ] Scan active Markdown for contradictory branch/deploy instructions. Keep archived audit claims with dated scope; add a clear superseded note rather than silently rewriting historical evidence.
- [ ] Do not adopt the dangling `4f3894c` reverse-sync spec; record why its main→development/testing direction conflicts with the agreed forward promotion model.

### Task 6: Review and promote through the lanes

- [ ] After the user approves implementation, run the focused suites and `npm run test:full`, `npm run lint`, `npm run lint:client`, and full browser QA before opening the development PR.
- [ ] Submit a normal feature PR to `development`; review its exact UI/server/docs allowlist and preserve the existing untracked strategy spec.
- [ ] Wait for development CI, CodeScene, tests, and human review. Do not promote an unproven balance change; this plan does not reconstitute the lost, uncommitted NO-AI candidate.
- [ ] Open a normal `development → testing` promotion PR. Run testing CI, browser QA and any required staging smoke checks; retain the source branch.
- [ ] Open a normal `testing → main` promotion PR only after testing passes and the exact commit/tree is reviewed. No version bump unless separately requested.
- [ ] Verify that Nest’s active pull timer deploys the exact new main SHA, drains active rounds safely, returns healthy/readiness status, and leaves the prior release available for rollback.
- [ ] Update release/workflow docs with the deployed SHA and final CI evidence. Keep recovery refs and stashes until the user explicitly approves cleanup.

## Execution Boundary

This document is the plan only. No branch refs were recreated, no commit was cherry-picked, no stash was applied, no source/UI/docs were modified, and no PR/merge/deployment was performed while auditing. The pre-existing untracked strategy spec remains untouched.

## Parallel Implementation Roles (for the approved execution pass)

All implementers and reviewers use GPT-6 Luna Medium. Keep file ownership disjoint:

- Frontend agent: only the Profile preferences/theme/music UI paths and focused client/Playwright tests in Task 3. Use `poorup-frontend`, `game-ui-ux`, `accessibility`, and TDD; preserve the existing shell and no-document-scroll invariant.
- Backend agent: only `server/matchHistoryAdapter.js` and its focused test in Task 4. Use `poorup-code-quality`, systematic debugging, and TDD; do not edit UI or branch docs.
- Workflow/docs agent: only the documentation paths listed in Task 5; use the branch/release evidence in this audit and retain dated history.
- Integrator/reviewer: check recovery refs, exact diffs, tests, visual evidence, and PR gates; never merge, push, or deploy unless separately authorized at that step.

## Plan Self-Review

- **Coverage:** The selected implementation is limited to the Profile preferences theme/music UI and bounded match-history query. Other candidates remain classified for later review, not pulled into this release.
- **Safety:** It preserves all current permanent refs, stashes, current user untracked work, and main’s existing code; stale snapshots and old WIP are never applied wholesale.
- **Outstanding decisions:** Confirm Light’s main track, Urban Theme’s gain, and Remember Winter’s original source/edit before implementing those details. The six other secondary auditions and licenses are already locally staged, but not yet shipped or added to the manifest.
- **No unsupported claims:** CodeScene work and snapshot commits are identified as merged; the preference branch is identified as recoverable but unmerged; the NO-AI candidate is not claimed recoverable as an exact commit.
