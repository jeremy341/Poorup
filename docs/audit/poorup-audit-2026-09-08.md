# Poorup UI, Logic, and Dead-UI Audit — 2026-09-08

## Scope

This audit covers the current Poorup modular monolith across:

- server game, social, economy, achievement, event, ranking, and bot logic;
- client settings, board, rails, profiles, social/rankings/rules pages, dialogs,
  popups, forms, and keyboard gates;
- CSS animation, reduced-motion behavior, typography, responsive constraints,
  and 1920px live rendering;
- dead or misleading UI and backend/client contract mismatches.

The live pass used the running app at the available desktop viewport, with the
1920×1080/2560×1440 target checked against the responsive CSS. Static checks
used the current source tree, the existing server/client lint gates, and the
pure integration/audit suites. The findings below were collected before the
implementation pass; the resolution ledger at the end records the fixes now
applied on top of this baseline.

## Current worktree state

- Branch: `codex/codescene-cleanup`
- Base: merged `main` (`c62cd64`)
- CodeScene refactors and the first audit-fix commit are present in history.
- The current implementation pass is recorded in commit `07baba0` on
  `codex/codescene-cleanup`.
- The ignored local `server/data/*.json` files still contain historical test
  accounts from earlier runs. They were deliberately not deleted because this
  workspace may contain user data; future wire tests now use a temporary data
  directory.

## Verification summary

Passing evidence:

- `npm run lint`
- `npm run lint:client`
- bot strategic context: 18 checks
- bot future planner: 10 checks
- global events: 20 suites
- trades/candidates: 42 checks
- casino/bankruptcy: 49 checks
- room setup: 18 checks
- audit trade/auction: 9 checks
- audit property/loan: 22 checks
- audit cards/match: 9 checks
- audit rooms/settlement: 17 checks
- audit game/contracts: 9 checks
- reconnect: 5 checks
- social achievement event contract: 1 check
- hybrid achievements/stats: 2 checks
- match-history schema: 4 checks
- match-result replay regression: 8 checks (including the new idempotency expectation)
- isolated store-path resolver: 3 checks

The full `npm test` path also reaches the long bot simulation successfully, but
the spawned room wire suite writes to the normal ignored data directory. It was
not rerun during this audit to avoid adding more persistent test accounts. The
audit itself made no UI changes; the backend idempotency/store-isolation edits
listed under worktree state were already in progress before this audit began.

## 1920px-target surface inventory

| Surface | Rendering/interaction checked | Result |
| --- | --- | --- |
| Home / parlor entry | live desktop accessibility tree + screenshot | Reachable; global navigation and audio controls work. |
| Rooms browser/create/join | static markup, room handlers, server wire paths | Entry controls are wired; public/private code behavior is consistent. |
| Setup / appearance editor | static renderer, Escape/scrim/back handlers | Focus-safe close paths exist; setup is internally scrollable. |
| Lobby settings | renderer vs server setting vocabulary | Bot Brain/Difficulty are local-only; non-host controls are not disabled. |
| Board / HUD / rails | tile renderer, rail dispatch, state sync | Core board and transaction paths are covered; Finance row animation has a transform bug. |
| Profile / achievements | live desktop screenshot + tab/keyboard semantics | Full-width profile works; color inputs have no accessible names; achievement filters are native controls. |
| Rankings | live desktop screenshot/tree + server payload measurement | Page is wide and internally scrollable, but in-game refresh, tab semantics, zero rows, and payload size fail review. |
| Social | live desktop screenshot/tree | Wide three-column layout and in-place actions work; guest empty state is clear. |
| Rules book | live desktop screenshot/tree | Book spread, chapter rail, internal article scroll, and next/previous navigation work. |
| Trade / contract / deal dialogs | static modal renderers and action dispatch | Role actions and stale-ID server guards exist; lender context and unsecured-loan UI are incomplete. |
| Purchase / auction / sponsorship dialogs | static renderers, Escape gates, server guards | Purchase/auction guards work; sponsorship Escape path is inconsistent. |
| Card reveal/gallery, bankruptcy, game over | static renderers and keyboard gates | Blocking behavior is intentional; dynamic ARIA title IDs require verification. |
| Patrol / motion layer | CSS keyframes, timers, reduced-motion rules | Patrol motion is gated; contract/event-banner reuse needs correction. |

## Health score

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Accessibility | 2/4 | Strong focus/scrim infrastructure, but dialog IDs, tab semantics, unlabeled inputs, and tiny text remain. |
| Performance | 2/4 | 433 KB ranking snapshot / 1,400 rows and repeated rail animations; board rendering itself is bounded. |
| Responsive design | 3/4 | Internal-scroll strategy and 1920px layout work; small labels and dense ranking deck need device-size checks. |
| Theming | 2/4 | Good token foundation, but `Press Start 2P` is never loaded and several colors/backgrounds remain hard-coded. |
| Implementation integrity | 2/4 | Modular boundaries are improving, but several server/client contracts and test-store boundaries drift. |
| **Total** | **11/20** | **Acceptable — significant correctness and accessibility work remains.** |

## P0 — Blocking data/correctness issues

### P0-1 — Wire tests mutate the real application stores

**Location:** `server/server.js:44-46`; `server/rooms.test.js:74,172-178`

The spawned wire test launches the normal server without an isolated data
directory. Account, social, match, and achievement stores therefore use the
same `server/data/*.json` files as the local app. The current local files contain
339 accounts, 113 friendships, 339 invites, and 226 notifications. The live
Rankings screen visibly shows fake `ROOM ALICE` accounts created by the tests.

**Impact:** test runs contaminate leaderboards, profiles, invites, and
notifications. Known test passwords also remain in the local store.

**Recommendation:** inject a temporary `POORUP_DATA_DIR` into every spawned
server test and clean that directory in the test harness. Never run wire tests
against the default store.

### P0-2 — Match settlement is not idempotent

**Location:** `server/accountStore.js:208,532`; regression pinned at
`server/game-results.test.js:126-127`

Replaying a match with the same `gameId` deduplicates history but increments
games, wins, rent, casino, market, loan, and equity statistics again. This is
reachable if settlement is retried after an exception between account updates,
achievement evaluation, or match persistence.

**Recommendation:** skip the stat delta per account when that account already
has the match ID, while still allowing an interrupted multi-account settlement
to finish the accounts that are missing it.

## P1 — Major gameplay and integration issues

### P1-1 — Bot Brain and Bot Difficulty controls are dead

**Location:** `public/clientLobbyUi.js:346-347`; `public/main.js:218-254`

The controls render and mutate local state, but `botBrain` and `botDifficulty`
are absent from `SERVER_SETTING_KEYS`. No `set-setting` event is sent, so the
server keeps `AUTO` and `TABLE` regardless of the visible selection.

### P1-2 — Turn timer is browser-only and fails at the roll gate

**Location:** `public/clientHudRender.js:150-178`; `server/socketRuntime.js:26`

The configured timer is implemented only as a client interval. When it reaches
zero before the player rolls, `autoEndExpiredTurn()` returns because the stage
is not `end`. If a purchase/auction/debt blocker is open, the timer stops and
does not resume. The server ignores `settings.turnTimer` and uses a separate
180-second watchdog.

**Impact:** “Timer Per Turn” can expire visibly without advancing the turn, can
be bypassed by a background tab, and does not enforce the documented rule.

### P1-3 — In-game Rankings can display stale or empty data

**Location:** `public/clientSocialSurfaces.js:314`; `public/clientParlorBindings.js:35-44`

The in-game Rankings modal renders without requesting a leaderboard snapshot.
Scope changes only update the local label and reuse the old rows. A failed
Friends request also leaves old rows in place because
`leaderboardSnapshotAck()` does not surface the error or clear stale data.

### P1-4 — Single-card preview URLs are blocked on the home screen

**Location:** `public/clientGameModalsUi.js:335-340`; `public/clientSurfaces.js:18-20,116-143`

The documented `?preview=surprise` and `?preview=treasure` routes call the
normal `#card-modal`, but that modal is classified as a game-only popup. On
the home screen the shared surface controller blocks it and shows `TABLE NOTICE`
instead. The `?preview=cards` gallery works because it is not in `GAME_POPUP`.

**Impact:** individual card previews used for design review are dead links
unless a user is already in a round.

### P1-5 — AI provider receives no opponent summaries

**Location:** `server/botStrategicContext.js:357`; `server/botAdvisor.js:333-350`

The context builder returns `opponents`, while the provider prompt reads
`opponentSummaries`. The resulting AI prompt contains an empty opponent list,
despite the bot having opponent data in the source projection.

### P1-6 — AI decisions can settle a newer offer than the one evaluated

**Location:** `server/botLogic.js:409,414`

Choice candidates are generated before an asynchronous provider call. On
return, trade/contract execution reads the currently pending offer and does not
verify the original deal ID. A human can replace or cancel an offer while the
bot is thinking, allowing the old decision to affect a newer deal.

### P1-7 — Bot strategic context mislabels partial groups as complete

**Location:** `server/botStrategicContext.js:137`

Opponent `completeGroups` is calculated from `playerGroups(player).length`,
which counts any group with a deed. The bot sees partial ownership as a
completed monopoly and can overestimate opponent rent pressure.

### P1-8 — Bot contract context hides important terms from lenders

**Location:** `server/botStrategicContext.js:58-75`

Collateral, equity share, conversion share, and the target property are only
projected for borrower bots. A lender bot receives an incomplete contract and
cannot evaluate the deal it is being asked to fund.

### P1-9 — Unsecured player loans are supported by the server but disabled in UI

**Location:** `public/clientTradeUi.js:174,252,746`

The server permits a loan with no collateral, but the Send button is disabled
whenever the recipient owns no eligible property. This makes unsecured loans
and the `SILENT PARTNER` achievement unreachable through the UI.

### P1-10 — Achievement predicates and descriptions diverge

**Location:** `server/achievementStore.js:68-74`; `public/clientAchievements.js:11-26`

Confirmed examples:

- `COLLATERAL DAMAGE` describes bank collateral loss but checks the lender of a
  player-loan default.
- `DEBT FREE` ignores active player loans and hybrid debt.
- `CLEAN EXIT` does not require repayment before the due round.
- `CRISIS MANAGER` accepts any event, including positive events.
- `DOUBLE HEADLINE` does not verify separate Surprise triggers.
- `EMPTY STREETS` uses historical completed groups rather than final ownership.

### P1-11 — Achievement rarity weights disagree with the catalog

**Location:** `server/accountStore.js:15-20`

Leaderboard scoring is wrong for:

- `public-works` (scored Epic, catalog Rare)
- `airport-hopper` (scored Rare, catalog Uncommon)
- `group-therapy` (scored Rare, catalog Uncommon)
- `one-more-turn` (missing from the score map, defaults to Common instead of Epic)

## P2 — UI, accessibility, performance, and motion issues

### P2-1 — `player-contract-offer` reuses a centered banner animation

**Location:** `public/styles.css:2679`; keyframe at `public/styles.css:1076`

`event-banner-in` ends with `transform: translate(-50%, 0)`, which is correct
for the centered global-event banner but wrong for a normal Finance-rail row.
Because the contract row uses `animation-fill-mode: both`, it can remain shifted
left by half its width after entering. The row also replays this animation on
every full rail rerender.

### P2-2 — Sponsorship Escape behavior is inconsistent

**Location:** `public/clientKeyboard.js:114-145`; `public/clientSponsorshipUi.js:125`

The sponsorship dialog has a Close button and scrim, but no Escape gate. Escape
can fall through to the pending-purchase gate and either do nothing or decline
the purchase, instead of dismissing the sponsorship dialog.

### P2-3 — Social and Rankings dialogs reference nonexistent accessible IDs

**Location:** `public/index.html:508,513`; dynamic rendering at
`public/clientSocialSurfaces.js:310,461`

The static dialogs reference `rankings-title` / `rankings-description` and
`social-title` / `social-description`, while rendering creates
`rankings-modal-title` / `rankings-modal-description` and corresponding Social
IDs. Screen readers do not receive the intended dialog name/description.

### P2-4 — Ranking controls use `tablist` with `aria-pressed`

**Location:** `public/clientSocialSurfaces.js:461`

Scope and metric controls sit inside `role="tablist"` but are plain buttons
with `aria-pressed`. The live 1920px accessibility tree exposes them as
checkboxes, not tabs, and no tab keyboard model is provided.

### P2-5 — Ranking payload is oversized and filled with zero-activity rows

**Location:** `server/accountStore.js:274,678-690`

The snapshot returns up to 100 full rows for all 15 metrics. Against the current
local data this is approximately 433 KB and 1,400 rows, many duplicated with
8×8 avatar data. The UI only displays three leaders for secondary metrics and
100 rows for the selected metric.

### P2-6 — Recent match cards identify participants by display name

**Location:** `public/clientSocialSurfaces.js:885`; source projection at
`server/accountStore.js:639`

The card matches `displayNameAtMatch` to the player’s current display name.
Renaming a user or sharing a display name can show the wrong placement or no
placement at all.

### P2-7 — Friends-only achievements appear as zero to strangers

**Location:** `server/accountStore.js:597-611`; client fact rendering at
`public/clientSocialSurfaces.js:839-847`

The server returns an empty achievement array for a non-friend but sets
`achievementsPrivate` only for fully private profiles. The card displays `0`
instead of `FRIENDS ONLY`.

### P2-8 — Small text and missing font reduce readability

**Location:** `public/styles.css:91,208-216,1590,2793`

`--font-pixel` references `Press Start 2P`, but no such font is loaded. It falls
back to Courier New. Several labels are 7–9 px, including grey metadata and
Finance checkpoints. This conflicts with the product’s readability goal.

### P2-9 — Color and chat inputs lack programmatic labels

**Location:** `public/index.html:417,422,595`

The token color picker, face color picker, and chat input have visible nearby
text or placeholders but no associated `<label>` / `aria-label`.

### P2-10 — Manage Portfolio routes to Market

**Location:** `public/index.html:757`; `public/main.js:761`

The button is wired, but its label promises portfolio management while the
handler always selects the Market tab.

## P3 — Dead or stale implementation surfaces

- `public/clientRailEvents.js:167-168` listens for
  `data-player-contract-action` and `data-player-contract-cancel`, but no
  current renderer emits those attributes; the live deal surface replaced it.
- `public/clientRoomsUi.js:267` builds `#mini-grid`, which is absent from the
  HTML, so the function is a guarded no-op.
- The old rail `data-buy` path is retained for future use but currently has no
  rendered action.
- Several historical audit documents retain old findings, although their
  headers now mark them superseded. They should be kept as history or rewritten
  as a resolution ledger, not used as a current checklist.

## Animation audit

The app uses CSS keyframes and short `steps()` transitions, with reduced-motion
rules for board movement, Patrol, profile panels, stats bars, toasts, and deal
rows. Positive choices include transform/opacity animation for most motion,
short press feedback, and explicit reduced-motion handling for high-energy
Patrol effects.

Confirmed animation issues:

1. The Finance contract row reuses the centered global-event transform and can
   finish at the wrong horizontal position (P2-1).
2. Contract-row entrance animation replays on every state rerender, despite
   being a high-frequency list surface.
3. Contract-row animation is not disabled in the reduced-motion rules at the
   bottom of `styles.css`, unlike several neighboring surfaces.
4. The global-event banner uses the same entrance keyframe but has no explicit
   reduced-motion override; a user who disables motion still receives the
   260ms movement when a headline appears.
5. Some decorative home/Patrol movement is intentionally long-lived; it is
   appropriately gated by reduced-motion, but should remain isolated from task
   controls.

No `transition: all`, `scale(0)`, or unhandled animation library was found.

## Positive findings

- Board geometry, 40-tile order, GO, Passing By/Prison, and spawn behavior have
  strong server tests.
- Server-side legality and stale-ID guards cover trades, contracts, auctions,
  casino, market, loans, bankruptcy, and sponsorship.
- Social profile projections enforce privacy boundaries for history and
  achievements in the tested paths.
- The shared surface controller provides inert background handling, focus
  restoration, Escape gates, and reduced-motion hooks.
- Public room codes are hidden in the primary client UI and public room joins
  use the directory.
- No client-emitted event was found without a corresponding server handler,
  and no duplicate static HTML IDs were found.

## Recommended order

1. Isolate test stores and remove/triage contaminated local test data.
2. Make result recording idempotent and add a retry/partial-settlement test.
3. Wire bot settings, server-authoritative turn timing, and ranking snapshot
   refresh/error handling.
4. Fix AI context naming, stale decision IDs, opponent group math, and lender
   contract projections.
5. Align achievement predicates and rarity weights with one shared catalog.
6. Fix unsecured-loan UI, sponsorship Escape, dialog IDs, tab semantics, and
   form labels.
7. Correct Finance-row animation, typography/font loading, ranking payload
   sizing, and remaining dead handlers.

Suggested Impeccable follow-ups: `$impeccable audit`, `$impeccable harden`,
`$impeccable typeset`, `$impeccable optimize`, and `$impeccable animate`.

## Web Interface Guidelines cross-check

The current Vercel Web Interface Guidelines reinforce the same findings:

- form controls need labels or `aria-label`;
- large lists over 50 items should be virtualized or use
  `content-visibility: auto`;
- stateful filters should be reflected in the URL when deep-linking matters;
- dialogs and drawers should contain overscroll;
- animations must honor reduced motion and animate only transform/opacity;
- icon buttons and async errors need accessible names/live announcements.

The audit findings above are the repository-specific violations of those rules;
the source checklist was fetched on 2026-09-08 from the Vercel guideline
command document.

## Resolution ledger — implementation pass

| Finding | Status | Resolution |
| --- | --- | --- |
| P0-1 test-store contamination | RESOLVED | Wire suites use a temporary `POORUP_DATA_DIR`; the existing ignored data is preserved for manual triage. |
| P0-2 settlement replay | RESOLVED | Per-account match identity prevents duplicate stats while allowing partial retries. |
| P1-1 bot controls | RESOLVED | Brain and difficulty keys now travel through the authoritative setting path. |
| P1-2 turn timer | RESOLVED | Runtime schedules a server deadline per turn and expires every blocking obligation; the HUD renders the server clock. |
| P1-3 rankings refresh/error | RESOLVED | In-game scope/metric changes request fresh snapshots, stale responses are ignored, and failures render a retry state. |
| P1-4 card previews | RESOLVED | Design-preview card URLs can open the card surface from home without weakening normal game-popup guards. |
| P1-5–P1-8 bot context | RESOLVED | Opponent summaries, complete-group math, lender terms, rule-version traces, and stale offer IDs are now consistent. |
| P1-9 unsecured loans | RESOLVED | Loan mode omits the deed picker and enables sending a valid unsecured offer. |
| P1-10/P1-11 achievements | RESOLVED | Debt/collateral/headline predicates and copy are aligned; rarity weights now match the catalog. |
| P2 accessibility | RESOLVED | Dialog IDs, ranking filter semantics, color/chat labels, and friends-only achievement copy are corrected. |
| P2 motion/typography | RESOLVED | Finance rows use a local entrance keyframe, reduced motion disables it, and the loaded Silkscreen face replaces the missing font. |
| P2 payload/history | RESOLVED | Secondary leaderboard columns are capped at three rows and match cards use an explicit viewed-participant marker. |
| P2-10 Manage Portfolio | RESOLVED | The control now routes to Holdings/Deeds instead of the unrelated Market rail. |
| P3 stale handlers | RESOLVED | Removed obsolete contract-action selectors; guarded mini-board code remains harmless legacy preview support. |

Remaining intentional housekeeping: ignored local data files may contain old
test accounts and should be backed up/triaged by the project owner before a
release. No production data is deleted by the audit fix.
