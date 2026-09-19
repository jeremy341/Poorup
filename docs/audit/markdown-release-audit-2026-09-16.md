# Poorup Markdown and Release Bug Audit — 2026-09-16

**Scope:** every tracked `README*`/`*.md` file plus the current source and test
contracts, at `cc51da2` on `admin-analytics-dashboard-plan`.

**Mode:** read-only source audit. No gameplay, UI, server, dependency, or
deployment files were changed by this audit.

## Executive result

The repository contains **147 tracked Markdown/README files** (including
hidden `.ulpi`, `.superpowers`, and `.github` paths). The older reports are
dated evidence, not a live bug queue. Most of their P0/P1 findings are now
resolved and have regression coverage. The application diff was clean before
this report was added, and all automated release suites run green, but this is
**not an unconditional public release approval**.

### Current release posture

- **Core game:** technically runnable for a controlled friends/beta release.
- **Public account release:** **NO-GO** until deletion/export/retention and
  effective legal copy are supplied and implemented or registration is disabled.
- **Current branch:** `admin-analytics-dashboard-plan` at `cc51da2`; `main`,
  `development`, and `testing` remain at `1b085fa`. This branch is 23 commits
  ahead and has not been pushed, merged, or deployed.
- **CodeScene:** not run. The current PowerShell history contains no usable
  `CS_ACCESS_TOKEN`; the safe extraction returned
  `TOKEN_NOT_FOUND_OR_PARSE_FAILED`. This is a tooling gate, not a source bug.

## Verification evidence

| Check | Result |
|---|---|
| `npm run test:full --silent` | PASS; all server, client, audit, persistence, privacy, maintenance, legal, analytics, and game-invariant suites passed |
| `npm run lint -- --quiet` | PASS |
| `npm run lint:client -- --quiet` | PASS |
| `npm audit --omit=dev --audit-level=moderate` | PASS; 0 vulnerabilities |
| Full Playwright matrix on this branch | 459 passed, 57 documented skips (same verified HEAD; no code changed afterward) |
| Focused admin matrix | 151 passed, 5 documented skips |
| `git diff --check` | PASS; no application diff (this report is the only new audit artifact) |

The review applies current Web Interface Guidelines (semantic controls,
focus visibility, accessible async states, reduced motion, overflow, and
destructive-action confirmation) alongside the repository's Poorup design and
server-authority contracts. See the [current guideline source](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md).

## What the historical audits got right, and what is now resolved

The following findings were real at the time of their reports and are now
closed by current source plus focused tests:

- ruleset base transitions and rejected host-setting acknowledgements;
- public-room creator host ownership, zero pre-start bots, bot-aware capacity,
  and Quick Table directory/retry/create fallback;
- live-seat restore hijacking, account-seat rebinding, invite room identity,
  expired-seat pruning, host re-election, and post-game cleanup;
- auction deadline checks, bot auction decision locks, debt-mode conclusion,
  AFK debt settlement, unsecured loan defaults, hybrid conversion fallback,
  short-default settlement, and loan-backed market guards;
- option same-round exercise/client pricing now fails closed until a pricing
  policy is configured; margin maintenance uses equity and collateral;
- season reward rank boundaries, double-GO behavior, card-deck reset safety,
  match-history enrichment, achievement/season retry paths, and telemetry
  batching/rollup privacy;
- checksummed/atomic backup verification and fail-closed horizontal-scale
  configuration;
- neutral purchase Escape/backdrop behavior, hidden-dropdown focus filtering,
  auction focus preservation, loan preview terms, partial repayment payloads,
  timer-through-resolution, live log refresh, async social/ranking states,
  cross-tab sign-out, rematch state reset, and mobile/iPad contracts covered by
  the current test suite;
- legal routes, metadata no-origin behavior, 404 handling, maintenance drain,
  health/readiness, Socket.IO origin admission, and analytics privacy/fallback;
- the admin analytics surface: full-screen frame, compact filter disclosure,
  seven report pages, ECharts SVG adapter, table fallback, keyboard paging,
  forced colors, reduced motion, and 1920px visual evidence.

The dated reports that describe these as open should be read as historical
reproductions. The authoritative evidence is the current code and tests, not
an old line number.

## Confirmed open bugs on the current tree

These are source-backed current issues. They are separate from policy-only
gates below.

| Priority | Finding | Evidence and impact |
|---|---|---|
| P1 | **Cross-room switch can strand a started table.** | `server/socketRuntime.js:360-385` (`detachStartedSeat`) marks a seat disconnected but does not schedule the normal expiry timer or clear all obligations. Accepting an invite or joining another room while playing can leave the old current turn/obligation stalled indefinitely while another human remains. No focused regression covers this path. |
| P1 | **Degraded snapshots can abort the whole client render.** | `public/main.js:618-636` has one linear `renderAll()` with no per-panel isolation. `public/clientTopNavRender.js:108` and `public/clientHudRender.js:293` dereference `state.players[state.turnIndex]` without a guard. A partial/empty player snapshot can stop later HUD, debt, winner, auction, and accessibility synchronization. |
| P1/P2 | **Account match idempotency is limited to 50 history rows.** | `server/accountStore.js:312,658-666` checks only `account.matchHistory`, which is sliced to 50. A temporary-store reproduction recorded 51 matches, replayed match 0, and observed `gamesPlayed: 51 → 52` while history stayed at 50. This can inflate rankings after an old retry/replay. |
| P2 | **Season match idempotency is limited to 1,000 IDs.** | `server/seasonModule.js:334-337` keeps only the last 1,000 match IDs. A temporary-store reproduction recorded 1,001 matches, replayed match 0, and observed `recorded: true`, `games: 1001 → 1002`. |
| P2 | **Season mastery grows from cumulative totals.** | `server/seasonModule.js:231-234` adds `min(100, next.eventSurvival*4 + ...)` rather than a per-match delta. Ten identical one-event matches produced mastery `220`, not a linear `40`. This distorts rewards/balance. |
| P2 | **Fair-trade contribution is not populated.** | `server/participantFields.js` has no `fairTrades`/participant trade-count field; `seasonModule.js:190,231` therefore reads zero for normal match records. Season points/mastery undercount completed trades. |
| P2 | **Snapshot sync clears local action locks.** | `public/clientStateSync.js:425-426` unconditionally sets `state.busy` and `state.rolling` false on every update. `public/main.js:649-673` has no request identity for a roll. A doubles snapshot arriving before the ack can re-enable the roll and consume the extra roll twice. |
| P2 | **Chat/toast accessibility gaps remain.** | `public/index.html:733` has no `aria-live` on `#chat-body`; player chat is not announced. `public/index.html:17` marks the toast stack `aria-hidden`, and `public/clientSocialSurfaces.js:97-104` makes the dismiss button `tabIndex=-1`/`aria-hidden`, so keyboard and assistive-technology users cannot inspect/dismiss toast content. |
| P2 | **Night Shift failure/status semantics are incomplete.** | `public/clientNightShift.js:599-603` ignores a rejected `start-patrol-run`; `public/index.html:141` hides the shortcut hint from assistive technology, while `renderNightShiftHud()` reuses elements whose labels remain “Local time” and “Parlor Patrol score”. |
| P2 | **Theme chooser is outside the shared focus controller.** | `public/clientTheme.js:35-37` declares a non-modal dialog and `public/clientSurfaces.js` does not register `#theme-popover`. Tab can leave the open chooser into the overlaid page; `aria-checked` duplicates native radio state. |
| P2 | **Global-event and auction action rerenders can still lose focus/pending feedback.** | `public/clientGlobalEventRender.js:118-130` rebuilds vote choices on each render; `public/clientAuctionUi.js:69-92` has no stable pending state for rapid bid/pass clicks. These are not covered by a two-client focus/pending browser contract. |
| P2 | **Economy refresh failure is silent.** | `public/main.js:464-477` returns on a failed `get-economy-snapshot` without a stale/error indicator, leaving Activity values looking current. |
| P2/P3 | **Generic room string settings are not bounded.** | `server/rooms.js:469-472` falls back to trimmed arbitrary strings for known string settings such as `bankruptMode`/`bankLoanSeverity`; the value is echoed in room snapshots. The ruleset-override path is bounded, but direct setting input is not. |
| P3 | **Account-seat recovery chooses the first disconnected room.** | `server/rooms.js:789-803` scans `Map` order when one account has multiple disconnected seats; it has no recency or explicit-room hint. A tab restart can reclaim the wrong table. |
| P3 | **Match-history adapter ignores its `limit` argument after merging.** | `server/matchHistoryAdapter.js:10-20` merges the legacy and stored windows and never slices the merged result. The characterization test intentionally returns four records despite the default limit of 50; larger legacy/stored windows can exceed the requested limit. |
| P3 | **Dead event data remains duplicated.** | `server/globalEventData.js:87` defines `leaderRentMultiplier`, while `server/rentApi.js:23` hardcodes `0.6`. `public/clientThemeData.js:44,63` stores `motion.durationMs`, but CSS uses independent durations. These are maintainability/contract-drift issues, not immediate round blockers. |

### Conditional responsive issues

- The tested 390px browser fallback is intentionally a document flow, but a
  live portrait round still places board and roll controls far apart. This is
  a known mobile UX limitation, not a desktop/game-rule failure.
- The landscape iPad contract is green for the configured 1024/1194-style
  projects. Large iPad Pro landscape widths above the 1279px tablet breakpoint
  and real Safari/VoiceOver were not verified in Chromium emulation.

## Release and policy gates (not accidental bugs)

| Gate | Current status | Release meaning |
|---|---|---|
| Account deletion/export/revoke-other-sessions | **Not implemented; controls are disabled** (`public/index.html:504`, `server/serverSocketAccount.js`) | A blocker for a public account/GDPR-style launch. For a friends beta, either disable registration or publish an owner-approved manual-erasure process. |
| Session lifetime/password recovery | **No TTL, password change, or reset** (`server/accountStore.js:507-620`) | Security risk for accounts; requires an authentication-policy decision before public launch. |
| Legal pages | Routes and draft copy exist, but every page says `DRAFT · NOT EFFECTIVE` and operator identity/contact/governing law/age policy remain pending (`public/legal/*.html`) | Not a code bug. Do not publish them as effective Terms/Privacy/Acceptable Use until the owner/legal reviewer supplies facts. |
| Link previews | Metadata plumbing exists, but `/assets/social/poorup-og-1200x630.png` is missing and the canonical origin is opt-in (`server/metadata.js`) | Share previews are intentionally deferred until the owner approves hostname, copy, and artwork. |
| Asset/licence hygiene | `public/assets/fonts/test` (3.3 MB unknown-rights SVG), legacy board SVGs with embedded imagery, and IBM Plex font notices remain served; no root `LICENSE`/third-party notice file | Licensing/redistribution risk. Quarantine or document before a public release; deletion needs owner approval. |
| Production topology | JSON persistence is single-process; horizontal mode correctly fails closed without a real adapter. Nest deploy workflow is disabled until secrets/`NEST_DEPLOY_ENABLED` are configured. | Safe for one controlled instance only. A 1,000-player/horizontal launch needs the approved adapter, data/backup paths, rate limits, proxy hops, and load evidence. |
| Compression/cache/audio weight | No gzip/Brotli; static assets use a short generic cache policy; the original soundtrack is ~12 MB | Performance debt, especially on mobile. Not a rules bug, but measure before broad release. |
| CodeScene | Current token unavailable; no authenticated delta result | Merge/release review is incomplete until the owner supplies the token in the review shell or explicitly waives the check. |

## Intentional behavior / false positives

These items appeared repeatedly in older reports but are not bugs in the
current product contract:

- Guest play without an account; account-backed history/social are optional.
- Three permanent release lanes (`main` production, `testing` Nest staging,
  `development` integration); short-lived feature branches may be removed.
- A no-data analytics snapshot is `UNAVAILABLE`/suppressed rather than a fake
  zero; the admin route is protected by `POORUP_ADMIN_ACCOUNT_IDS` and is
  read-only.
- Legal pages being visible but labelled draft; “policy pending” controls are
  deliberately disabled rather than pretending deletion/export exists.
- JSON persistence and the absent PostgreSQL adapter for the current
  single-process deployment; the guard is intentionally fail-closed.
- Original/seasonal themes, music, Wallet/Items, airport travel, predictions,
  and bank-account upgrades are cosmetic/optional/planned surfaces unless the
  feature manifest says otherwise; their plans are not evidence of a defect.
- Old audit line numbers, unchecked `[ ]` plan steps, and historical “NO-GO”
  verdicts are provenance records. They must not be re-opened without current
  source evidence.

## Markdown disposition

The prior complete inventory (`docs/audit/markdown-bug-feature-audit-2026-09-13.md`)
classified the 118-file baseline as active, completed, reference, outdated, or
delete-candidate. I re-read that baseline and all 29 later additions:

- **Current authorities:** root product/run docs, deployment runbooks,
  `.ulpi/design/DESIGN.md`, current feature plans with status banners,
  `docs/feature-status.json`, and the admin fullscreen spec/review.
- **Completed evidence:** fix-batch reports, current release-readiness
  evidence, SDD task reports, and the admin analytics test/review records.
- **Reference/history:** the 2026-09-08/09-12 audit chains, old visual audits,
  music provenance, board-source records, and dated Devlog 7.
- **Planned/deferred:** account controls, link previews, Wallet/Items
  mutations, airport/prediction/bank tiers, Spring pedestrians, effective
  legal policy, and the approved production analytics policy.
- **Needs a superseded/current-status banner:** the old full-codebase and
  release-readiness reports still use pre-fix “OPEN/BLOCKER” language;
  `.ulpi/design/FINAL-REVIEW.md` still mentions the removed
  `REFERENCE_UI_ONLY` mode; `docs/DEVLOG-7.md` still describes CodeScene and
  music selection as next steps; the feature manifest is pinned to source
  commit `151b480` by its own parity test rather than the current branch.
- **Delete candidates:** none deleted. Historical and provenance records are
  retained until the owner explicitly approves archival/deletion.

## Release decision and next actions

If today’s release means a private friends/beta launch of the already-merged
core game, the current tests support that path after the branch is promoted,
CI is rerun on the exact SHA, production environment variables/backups are
verified, and the live URL is smoke-tested. The current admin branch itself is
not yet in `main`.

If today’s release means a public, account-enabled product, stop before
promotion and close the policy/licensing gates first. Independently, the P1
cross-room detach and degraded-render paths should be fixed before broad
traffic; the idempotency/mastery issues should be fixed before trusting
rankings or season rewards for balance decisions.

No application code was changed in this audit.

## Current-tree correction — 2026-09-17

This report's evidence freeze was `cc51da2`; the working tree has since received
the release-hardening implementation. The historical open-bug table above is
therefore provenance, not a current queue. The following items are now covered
by the current source and tests:

- cross-room started-seat expiry, degraded render isolation, durable account and
  season idempotency, per-match mastery deltas, participant trade evidence;
- snapshot action locks, global-event/auction pending feedback, economy-staleness
  status, bounded room settings, and risk-aware close handling;
- unified bankruptcy/elimination, human spectator projection, neutral board assets,
  greyed sidebar status, spectator leave, bot elimination, end-game winner
  resolution, and rematch reset;
- field/deed modal shell parity, Rules copy parity, deterministic 1920px release
  screenshots, and iPad/mobile accessibility contracts.

The current test evidence is recorded in the companion release-hardening audit:
`npm run test:full --silent` passes, both ESLint targets pass, and the full
Playwright matrix reports 391 passed with 47 planned skips. A bounded bot deal
proposal regression was added after the first campaign exposed a repeat-offer
loop. Balance output now distinguishes completed games from bounded games and
uses actual feature actions for adoption rates; it remains measurement only.

The legal HTML routes and draft legal files listed in the historical table were
removed in the current tree by the owner's explicit runtime-legal-surface removal
request. This is not an accidental disappearance: the footer no longer promises
those documents, and any future effective policy remains a separate owner/legal
decision. Historical plans that mention those paths should be treated as
superseded, not as instructions to recreate them.

The current branch remains uncommitted and unmerged. No ambiguous Markdown or
asset file has been deleted as part of the release-hardening pass; the source-graph
deletion list remains an approval gate. CodeScene hosted review is still pending
because `CS_ACCESS_TOKEN` is unavailable in the current process.
## 2026-09-17 implementation reconciliation

The account-rights implementation added new source seams and the following
documents are now authoritative for their status:

| Document | Category | Current evidence | Action |
| --- | --- | --- | --- |
| `docs/superpowers/plans/2026-09-17-account-release-readiness-implementation.md` | Active | server/client account-rights seams and focused tests | execute and keep updated |
| `docs/decisions/account-rights-and-auth-2026-09-17.md` | Active decision record | owner-confirmed deletion, recovery, session, and retention choices | preserve |
| `docs/audit/account-release-readiness-2026-09-17.md` | Active audit | focused verification and explicit deployment gates | update with fresh evidence |
| `docs/audit/obsolete-artifacts-2026-09-17.md` | Reference / deletion record | exact source-graph candidate list | preserve until a safe deletion commit |
| `docs/DEVLOG-7.md` | Reference | historical shipped feature narrative | preserve |
| dated `docs/audit/**` reports | Reference | provenance and release evidence | preserve; do not rewrite history |
| dated legal/music-box specs with no runtime owner | Deletion candidate | superseded runtime surfaces; exact list in obsolete-artifacts report | deletion held by workspace safety until explicitly approved after backup |

The current code still contains every active theme, runtime audio asset,
license/provenance file, deployment runbook, and historical audit. No Markdown
file is deleted solely because it is old; deletion requires a verified source
graph and a recoverable, explicitly approved operation.

After the 2026-09-17 cleanup, the two unchanged superseded music documents are
gone and the four user-modified legal/music candidates remain preserved. The
legacy six-theme SVG set is gone; current asset/reference tests report 34 active
theme SVGs and no runtime references to the removed names.
