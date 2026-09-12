# Poorup — Full Codebase Audit — Rounds 1–3 — 2026-09-12

Three independent multi-agent audit passes over the Poorup codebase (vanilla HTML/CSS/JS client, Node/Express + Socket.IO server). 24 agents total, all read-only. No code changes were made for any audit.

Severity: **P0** critical / **P1** high / **P2** medium / **P3** low. **CONFIRMED** = reproduced with evidence; **SUSPECTED** = code-path evidence.

## Contents

- [Executive Summary](#executive-summary)
- [Part 1 — Round 1: Broad Surface Audit](#part-1--round-1-broad-surface-audit)
- [Part 2 — Round 2: Deep Logic Audit](#part-2--round-2-deep-logic-audit)
- [Part 3 — Round 3: Runtime Dynamics Audit](#part-3--round-3-runtime-dynamics-audit)
- [Master Priority Plan](#master-priority-plan)
- [Appendix — Methodology](#appendix--methodology)

## Executive Summary

The three rounds were deliberately complementary: Round 1 swept the broad surface (dead code, docs, static accessibility, performance basics, security baseline); Round 2 dug into game logic (market/contract/season exploits, debt lifecycle, persistence crash windows, test blind spots); Round 3 examined runtime dynamics (races, failure paths, architecture pressure points, platform support floors, dynamic a11y, operability).

**Highest-severity findings across all rounds:**

1. **P0 — Horizontal-scale guard bypass** (`persistenceMode.js`): a dummy `POORUP_POSTGRES_URL` passes readiness while no Postgres adapter exists → multiple processes silently overwrite each other's JSON stores (Round 2 §7.1).
2. **P1 — Client-controlled option strikes with same-round exercise**: reproduced $45,000 instant payout draining the house reserve (`marketExpansion.js`, Round 2 §2.1).
3. **P1 — Hybrid note dilution exploit**: lender loses principal, borrower keeps all assets, debt becomes unrepayable (`contractLogic.js`, Round 2 §8.1).
4. **P1 — Season rewards mis-granted**: percentile math lets last place claim top-1%/gold tiers (`seasonModule.js`, Round 2 §8.2).
5. **P1 — Debt-mode games can never end**: $1,500 destroyed, both seats stuck in debt (`bankruptcyApi.js`, Round 2 §8.3).
6. **P1 — Unguarded server timer seams**: one game-logic throw during the AFK/GC tick becomes `process.exit(1)` for every live room (`socketRuntime.js` + `server.js`, Round 3 §1.1).
7. **P1 — Live-seat hijack via `restore-session`**: reproduced — two sockets can flap one seat (`rooms.js`, Round 3 §2.1).
8. **P1 — Client double-submit class**: snapshot re-render + fresh requestIds executes market/casino/loan actions twice (Round 3 §2.2).
9. **P1 — Bot host takeover permanently freezes a room**: reproduced (`rooms.js`/`socketRuntime.js`, Round 3 §8.2).
10. **P1 — No graceful shutdown**: every deploy destroys all live in-memory games (Round 3 §8.1).
11. **P1 — Split-write crash windows**: achievements and paid season rewards permanently lost; 400 blocking telemetry fsyncs per bot match (Round 2 §7.2–7.4).
12. **P1 — Blocked flows**: invisible confirm dialog behind the Deals card; unrecoverable sponsorship dismissal (Round 2 §3.1–3.2); no confirmation leaving a live round (Round 1 §4.1).
13. **P1 — Chat fights the user**: forced scroll-to-bottom every ~650ms with bots + typed message lost on rate-limit rejection (Rounds 2–3).
14. **P1 — Focus destroyed every ~650ms by full innerHTML rebuilds** of open surfaces (Round 3 §6.1–6.3), the a11y twin of Round 1's full `renderAll()` performance finding.
15. **P1 — Diffuse state ownership** (321 write sites in 28 modules) + dual render paths — root cause of stale/clobbered UI (Round 3 §7.1–7.2).

**Convergence signal:** the per-snapshot full-rebuild theme was found independently in three rounds — performance (R1 §7.1), focus/state loss (R3 §6.x), and architecture (R3 §7.x) — making it the strongest candidate for a single systemic fix (dirty-slice invalidation + incremental rendering + focus preservation).

**Verified already fixed during the audit window:** double-GO card payout, roll-with-open-purchase-offer, `ensureBots` capacity oversubscription.

**Verified clean:** normal money conservation (rent/trade/loan/tax/auction/casino), server RNG is crypto, Fisher–Yates correct, UTC-consistent season/window math, no committed secrets, client keyboard traps, and no drag-only interactions.

---

## Part 1 — Round 1: Broad Surface Audit

_Agents: overengineering & dead weight, bugs, UI bugs, UX bugs, unnecessary MDs, accessibility (WCAG 2.2 AA), performance, security._

Read-only audit by 8 parallel agents. No code changes made.

- Agent 1 — Overengineering & dead weight
- Agent 2 — Bugs & correctness
- Agent 3 — UI bugs
- Agent 4 — UX bugs
- Agent 5 — Unnecessary / stale Markdown
- Agent 6 — Accessibility (WCAG 2.2 AA)
- Agent 7 — Performance
- Agent 8 — Security

Severity: P0 = critical / P1 = high / P2 = medium / P3 = low.

---

### 1. Overengineering & Dead Weight

#### P1 — Dead code (never runs, never loads)

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 1.1 | `public/client-state.js:1` | Entire 108-line module (incl. duplicated `applyServerState`, mirroring `clientStateSync.js:376`) imported only by `server/client-state.test.js`, which is in no npm script — stale predecessor kept alive by an orphan test | Delete module + test, or re-home the test onto `clientStateSync.js` |
| 1.2 | `server/data/__gold_matches.json`, `__gold_acct.json`, `__dbg.json` | ~19 KB debug/golden dumps referenced by zero files — commit artifacts, not fixtures | Delete, or move to a fixtures dir wired to a real test |
| 1.3 | `public/assets/fonts/test` | 3.3 MB SVG (header `<svg`) misnamed `test` in fonts folder, referenced nowhere | Delete or rename/move to assets/themes |
| 1.4 | `public/assets/parlor-patrol/README.md:24,30` | 10 unreferenced SVGs (`contrail-6-frames.svg`, `debris-6-frames.svg`, `helicopter-crash-12-frames.svg`, `spiral-trail-8-frames.svg`, `legacy-board-40.svg`, `legacy-board-40-user-source.svg`, `police-helicopter-10-frames.svg`, `board-icons/passing-by-tile.svg`, `board-icons/passing-by-poorup.svg`) + 3 unused `ibm-plex-sans-*.woff2` (no `@font-face`) — README admits they're "retained for reference" | Delete the 11 files (Plex Sans weights ship ~300 KB dead to every client) |
| 1.5 | `server/boardRegistry.js:156`, `server/rulesetRegistry.js:243` | `BoardRegistry` / `RulesetRegistry` classes never instantiated; production uses sibling free functions | Delete both classes |
| 1.6 | `public/clientSanitize.js:350-378` | 9 exports never imported (`PROFILE_KEY`, `LIBRARY_KEY`, `ACCOUNT_SESSION_KEY`, `GUEST_ALIAS_KEY`, `ACTIVE_DESIGN_KEY`, `SOUND_KEY`, `MUSIC_KEY`, `RULESET_PRESET_KEY`, `sanitizeAccountSession`) — same for `configureThemeRender` (empty "reserved seam", `clientThemeRender.js:26`), `clearThemeTransition` (`:146`), `marketLogic.js:8` (`MARKET_SIDES`, `MARKET_ORDER_GUARDS`), `marketExpansion.js:535-541` (`COMPLEXITY_RANK`, `OPTION_EXPIRY_MAX`, `SHORT_BORROW_FEE_RATE`, `complexityAllows`, `ensurePlayerMarketState`) | Drop dead exports |

#### P2 — Duplication / dual config tables

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 1.7 | `server/roomSettings.js:8-154` vs `server/rulesetRegistry.js:7-11,71-106` | Two parallel vocabularies for one domain (`ROOM_RULESET_PRESETS` vs `RULESET_PRESETS`, re-listed override keys) — half-finished migration | Consolidate onto `rulesetRegistry`; `roomSettings` delegates |
| 1.8 | `server/boardRegistry.js:149-152` vs `server/rulesetRegistry.js:35-69` | `boardDefinition` re-hardcodes corners `[0,10,20,30]`/`[0,13,26,39]` and maxPlayers 4/6 that `BOARD_VARIANT_META` already owns | Import `BOARD_VARIANT_META` into `boardRegistry` |
| 1.9 | `server/rulesetRegistry.js:58-68` | `grand-64` variant (64 spaces, 8 players, `reserved`) exists nowhere else — speculative config for a board that cannot be created | Remove, or add the board |
| 1.10 | `public/clientBoardData.js:50-135` vs `server/boardRegistry.js:6-30` | 40 tile IDs + price/rent/group tables maintained in two copies — silent drift risk | Serve canonical table from server snapshot; keep only layout/paint client-side |
| 1.11 | `public/clientThemeRender.js:16-18` | `escAttr` re-implements the exact `&<>"'` map already exported by `clientDom.js:8` (`esc`) | Import `esc`, delete `escAttr` |

#### P3 — Micro-overengineering / dead branches

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 1.12 | `public/clientStateSync.js:20-33` | `orDefault`/`nullish` are the same helper; `orNum` is `num` with fallback — six coercers where three suffice | Collapse to `num(value, fallback)` + `??` |
| 1.13 | `server/roomSettings.js:82-89` | `snapFlooredSetting` is a knowingly dead branch ("Unreachable while the legacy guard above stands") | Delete it + its two normalizer entries |
| 1.14 | `server/gameLogic.js:42,1134` / `server/socketRuntime.js:8` | `AUCTION_DURATION_MS` re-exported through `gameLogic` while `summaryApi.js:6` imports it directly from `auctionApi` — two import paths | Import from `auctionApi.js`; drop the re-export |
| 1.15 | `server/tileApi.js:95-112,83-93,161-171` | Near-identical pairs (`landingGoToJail`/`landingGoToVacation`, two vacation-pool collection paths) | Merge each pair into one helper with an option |
| 1.16 | `server/botFuturePlanner.js:14-25` vs `server/botStrategicContext.js:11-18` | Bot subsystem (~1,800 lines for one feature) re-declares `nonNegative`/`clamp`/`integer` in each module; `botAdvisor`'s provider adapter is inert without a configured provider | Extract numeric helpers once; consider collapsing strategic-context pair |
| 1.17 | `public/clientBoardData.js:52` | `...{ price: 60, rent: 10, group: "brown" }` spreads a literal into a literal, repeated ~30 tiles | Write properties directly |

**Verdict:** moderately overengineered — weight in the server config/registry layer (dual settings vocabularies, never-instantiated registry classes, re-export chains, ~9 dead exports). Client module split is healthy; its dead weight is mostly assets (~20 unused files/exports/assets). All deletions safe; duplications are consolidations, not rewrites.

---

### 2. Bugs & Correctness

#### P1

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 2.1 | CONFIRMED (reproduced via node -e) | `server/rooms.js:521-544` (`ensureBots`) | **Game starts over capacity when humans fill all seats**: `canJoin()` counts humans only; `required = min(maxPlayers-1, bots)` doesn't subtract seated humans. 4-cap room with bots:1 + 4 humans starts with 5 players. `syncBotCapacity` only fires on maxPlayers *changes* | Clamp `required = Math.min(maxPlayers - humanSeats, bots)`; re-check on `addOrReconnectPlayer` |

#### P2

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 2.2 | CONFIRMED | `server/gameLogic.js:561-575` + `public/clientHudRender.js:87-90` | Player can roll while a purchase offer is open (auction off) — rolling silently discards the offer, stranding the tile unowned; mid-auction roll can replace `this.auction` (bids lost) | Reject rolls while `pendingPurchaseOffer`/`auction`/`pendingSponsoredPurchase` are open in `rollTurnRejection` |
| 2.3 | CONFIRMED | `public/clientState.js:128` | Bare `sessionStorage.getItem` at module scope — blocked-storage browser (private mode, sandboxed iframe) throws SecurityError and kills the whole client before any UI renders. Every sibling read/write is wrapped | Wrap in try/catch with existing generated-id fallback |
| 2.4 | CONFIRMED | `public/clientSocketListeners.js:234-240` (`onTradeOffer`) | `state.offers` grows one entry per counter/adjust; stale entries never deduped (accept removes only exact object; `findDeal` can present stale terms of a cancelled/advanced trade) | Replace-with-dedup by `trade.id`; drop entries absent from snapshot |
| 2.5 | SUSPECTED | `server/socketRuntime.js:284-306` (`detachStartedSeat`) | Room switch mid-game marks seat disconnected without clearing table obligations or scheduling a timer (unlike `expireDisconnectedSeat`); pending deal can block `endTurn` for the current player until the 180s AFK watchdog | Call `clearPendingObligations` + cancel-purchase cleanup at detach |
| 2.6 | SUSPECTED | `server/marketExpansion.js:203,225` | Short borrow fee (1%) accrued but never collected from cash — `coverShort` subtracts it only from displayed PnL; shorts are 1% cheaper than disclosed | Deduct accrued borrow fee from cash at cover (+ in `forceShortBuyIn`) |

#### P3

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 2.7 | CONFIRMED | `server/cardApi.js:100-105` | Card movement onto Start ignores the `doubleGo` rule (cards always pay $200; rolling exactly onto Start pays $400) | Honor `settings.doubleGo` when card destination is Start and movement wrapped |
| 2.8 | CONFIRMED | `public/clientThemeData.js:35-178` | `motion.durationMs` is dead data; spring's value (11000ms) contradicts real CSS (petals fall 14s); `theme-prop-weather-petal` 11s keyframe never applies (spring uses `petals` slot) | Consume `motion.durationMs` in `imageMarkup` or delete the field; align spring value |
| 2.9 | CONFIRMED | `public/clientThemeRender.js:70-85` + `clientBoardRender.js:36-44` | Duplicated window-lighting skyline logic in two modules; `original` theme reuses the home skyline on the board (`skyline.board = BASE_SKYLINE`) instead of the client `BOARD_SKYLINE` | Give `original` a dedicated board skyline (or drop `skyline.board`) and share one generator |

**Summary:** Most critical = `ensureBots` oversubscription (reproduced: 4 humans + 1 bot in 4-seat room → 5 players). Biggest risk area = disconnect/room-switch lifecycle (`detachStartedSeat` leans on the 180s AFK watchdog). Coverage gaps: no test pins `ensureBots` against full seats, no roll-with-open-offer test, no `state.offers` dedup test, theme tests don't pin CSS-duration sync or skyline selection.

---

### 3. UI Bugs

#### P1

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 3.1 | `public/styles.css:2523` | Game grid (`316px + minmax(600px,1fr) + 360px` + gaps ≈1336px) activates at `min-width:1280px` but needs ~1336px → at 1280–1335px `overflow:hidden` clips the right rail and the 1:1 board renders as a stretched 600×866 rectangle | Replace the `600px` center-track min with `minmax(0,1fr)` or raise breakpoint to ~1360px |
| 3.2 | `public/styles.css:2826` | `.home-nav` is `display:none` below 768px and only re-enabled at `≤640px` — between 641–767px all six nav destinations disappear | Extend the mobile re-enable rule to `max-width:767px` |

#### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 3.3 | `public/styles.css:2545` | 5-column HUD at `≥1536px` has 900px min but the center track is ~800px → roll cell clipped, right rail cut 1536–1635px | `minmax(0,…)` tracks or move breakpoint up |
| 3.4 | `public/styles.css:1322` | `.board-holder.is-metro` forces `min-width/min-height:560px` with no reset below 768px → Metro 52 room scrolls horizontally on phones | Add `max-width:767px` reset (`min-width:0; min-height:0`) |
| 3.5 | `public/clientBoardRender.js:197` | Generated `board-skyline` always painted over the theme scene → double skyline on every non-original theme whose scene art already has its own horizon | Skip/dim center skyline when the active theme has a non-null board scene |

#### P3

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 3.6 | `public/styles.css:241` (+2787) | `.theme-scene` `object-fit:cover` of 640×360 → portrait phones crop the home scene to a sky-only strip | Aspect-preserving wrapper or portrait-specific art |
| 3.7 | `public/styles.css:1359` | `.tile-name { white-space:nowrap }` with no clamp → "ELECTRIC COMPANY" spills over adjacent tiles; rotated side tiles overflow under ~700px | `overflow:hidden; text-overflow:ellipsis` + tighter name budget |
| 3.8 | `public/styles.css:714` | On original theme, `scene.svg` already has a static skyline → 50%-opacity drifting `.home-house-drift` renders a second, moving skyline over the bottom 44% | Hide drift on original or strip buildings from scene.svg's lower band |
| 3.9 | `public/index.html:540` | Game topnav (brand + room badge + LOG/PANELS/BANKRUPT/SOCIAL + 2 audio toggles) has no `≤767px` rules → overflows at 390px | Compact phone topnav |
| 3.10 | `public/styles.css:2787,2804` | `#view-home .home-sky-atmosphere` static-grid band duplicated verbatim in two media blocks | Merge into one media query |
| 3.11 | `public/styles.css:172` vs `358` | `.scanlines` at z-60 sits above theme popover/panel-menu (z-1 context) → those get CRT texture while modals (z-70) don't — inconsistent | Move `.theme-popover`/`.panel-menu` above 60 |
| 3.12 | `public/styles.css:338` | Drift-hide keys off `body[data-theme-id]` → pre-init flash of drifting skyline for saved non-original themes | Gate positively on `[data-theme-id="original"]` or default the attribute in markup |
| 3.13 | `public/clientThemeRender.js:38` | `themePropsForSurface("page")` returns `{}` but `.theme-page-world` (opacity .25) re-renders the full scene behind every view where opaque surfaces hide it | Skip redundant layer on home |
| 3.14 | `public/styles.css:852` | `.night-target-drop` animates to `translateY(calc(100vh…))` while its container is the shorter title-screen → drop targets fly past the play surface | Animate to the night-shift layer's own height |

**Summary:** worst defect = board stretching to 600×866 with clipped right rail (1280–1335px) + HUD/rail cut-off (1536–1635px). Theme issues: 4 (board double skyline, original double skyline, pre-init drift flash, redundant page-world). Responsive gaps: 5 (641–767px nav, 1280–1335px grid, 1536–1635px HUD, Metro on phones, 390px topnav).

---

### 4. UX Bugs

#### P1

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 4.1 | `public/main.js:793`, `clientLobbyUi.js:746` | Leaving a live round has **zero confirmation** on all four paths (brand logo, top-back, setup BACK, Escape) — mid-game exit silently forfeits seat + round. Only destructive action without a guard | Route room exits through `openConfirmModal` when `state.phase === "playing"` |
| 4.2 | `public/clientHudRender.js:87-127`, `clientGameModalsUi.js:135-139` | In non-auction mode, dismissing the buy/pass card leaves `pendingBuyTile` set while the HUD re-enables as "End Turn" — required buy/pass decision no longer obvious; clicking it produces a chat-only server rejection | Keep HUD primary disabled/relabeled "Resolve Purchase" while `pendingBuyTile != null` |

#### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 4.3 | `public/index.html:574`, `clientStateSync.js:335-339` | Retire button keeps hard-coded "BANKRUPT" label, enabled for healthy players — reads as a broken status badge, not an action | Relabel "LEAVE"/"RETIRE"; swap label when forced debt pending |
| 4.4 | `public/clientGameModalsUi.js:239-242` | Game-over "Back to Lobby" calls `goHome()` → exits room entirely; room code lost | Rename to "Leave Table"/"Home" or implement real return-to-lobby |
| 4.5 | `public/clientDeedDetailUi.js:25,41,191,196` | House/sell/mortgage actions emit with empty `() => {}` acks → server rejections silently swallowed; tapping BUY HOUSE with no effect reads as a dead button | Ack with `emitWithChatError`-style handler + re-render on failure |
| 4.6 | `public/clientGameModalsUi.js:166-178` | Trade-offer Accept has no pending state; removes offer + closes modal before server confirms; rejection makes the deal vanish (chat line only) | Keep modal open with PROCESSING…; remove/close only on success |
| 4.7 | `public/clientDealUi.js:93-112` | DECLINE / CANCEL TRADE / CANCEL OFFER are single-click with no confirmation — misclick destroys negotiation | Gate through `openConfirmModal` |

#### P3

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 4.8 | `public/main.js:589-595` | `endTurn` never sets `state.busy` → double-click/Space+click emits twice | Add busy guard |
| 4.9 | `public/main.js:571-585,655-660` | Roll ack timeout → `reportChatError` no-ops on `undefined` → failure with no message | Surface "Roll could not be confirmed — try again" |
| 4.10 | `public/clientHudRender.js:296-305` | Setup overlay HUD reads "Join a room to get started." mid-entry — contradicts setup card | Branch the note for `setup` phase |
| 4.11 | `public/clientGameModalsUi.js:280-306` | Voluntary-exit confirm says "Declare Bankruptcy" while copy describes retiring | Label "Retire / Hand Over Assets" |
| 4.12 | `public/clientAccountIdentity.js:481-482` | Register/login just disables button, no progress label | Swap to "PROCESSING…" |
| 4.13 | `public/clientAccountIdentity.js:505-507` | `account-logout` uses a `noop` ack — server failure invisible | Surface via `parlorNotice` |
| 4.14 | `public/clientTheme.js:78-106,146-153` | Theme popover `aria-modal="false"`, absent from `SURFACE_SELECTORS` → no focus trap; Escape only works inside popover; outside click closes without restoring focus | Register with shared surface controller |
| 4.15 | `public/clientSocialSurfaces.js:97-104` | Toast dismiss buttons `tabIndex=-1` + `aria-hidden` → toasts can't be dismissed by keyboard | Make × a real focusable button |
| 4.16 | `public/clientSponsorshipUi.js:57-86` | Accept/reserve/withdraw: no pending state, no success confirmation; form stays filled | Busy buttons + form reset on ack |
| 4.17 | `public/clientAuctionUi.js:69-92` | Bid buttons no pending state; rapid clicks double-emit; unaffordable bids silently no-op | Disable until snapshot confirms leading bid |
| 4.18 | `public/index.html:540-578` | Top nav packs ~11 always-visible controls; sound/music toggles icon-only | Collapse secondary controls into overflow menu; label icon toggles |
| 4.19 | `public/main.js:443-452` | `refreshEconomySnapshot` silently returns on failure — stale Activity tab looks fresh | Keep "STALE" state like rankings |
| 4.20 | `public/clientRoomsUi.js:383-395` | Directory COPY relies on `navigator.clipboard` with no `execCommand` fallback (unlike `clientRoomShare.js`) | Reuse shared fallback helper |

**Summary:** top 3 frustrations — (1) stray logo click / misread "BANKRUPT" can silently yank you out of a live round; (2) dismissed buy/pass card invites illegal "End Turn" while building/mortgage taps fail silently; (3) trade/financing decisions vanish or close before the server agrees.

---

### 5. Unnecessary / Stale Markdown

#### P1

| # | Path | Action | Justification |
|---|------|--------|---------------|
| 5.1 | `docs/audit/room-patrol-bug-audit.md` (~40 KB) | **Delete** | Self-declared "historical record"; cites `main.js:8231` etc. against a monolith that no longer exists (main.js is now 927 lines) — 70+ dead line refs |
| 5.2 | `.impeccable/questions/2a082dfd.log`, `6d287f10.log`, `99bdcfa0.log` | **Delete** | Three 0-byte placeholder files |

#### P2 — superseded plans / duplicates

| # | Path | Action | Justification |
|---|------|--------|---------------|
| 5.3 | `docs/AUDIT-2026-09-08.md` | Merge into one `docs/audit/2026-09-08-archive.md` | Superseded by AUDIT-DEEP/AUDIT-FULL and the 09-12 fix batches; every P0/P1 landed |
| 5.4 | `docs/AUDIT-DEEP-2026-09-08.md` | Merge into AUDIT-FULL | Duplicates AUDIT's findings; `main.js:565` ref now blank line |
| 5.5 | `docs/AUDIT-FULL-2026-09-08.md` (24 KB) | Archive | All P0/P1 fixed by 09-09/09-12 batches; nothing actionable |
| 5.6 | `docs/audit/poorup-audit-2026-09-08.md` | Merge into 09-08 archive | Fourth overlapping 09-08 audit; client line refs drifted |
| 5.7 | `docs/audit/release-readiness-2026-09-08.md` | Archive | One-time gate superseded by 09-11/09-12 audits |
| 5.8 | `docs/plans/ai-bots-plan.md` + `no-ai-bots-plan.md` | Merge into one | Both "Status: implemented" for the same bot system |
| 5.9 | `docs/plans/casino-market-global-events-plan.md` | Merge global-events section into global-events-plan.md | "Status: implemented"; already redirects readers elsewhere |
| 5.10 | `docs/plans/achievements-plan.md` + `achievement-announcements-ui-plan.md` | Merge | UI slice is a subset of the parent feature, both shipped |
| 5.11 | `docs/plans/END-TO-END-AUDIT-CS2-ROULETTE-PLAN.md` (42 KB) | Archive | Checklist ~100% DONE; reel live (`clientCasinoReel.js`) |
| 5.12 | `docs/audit/expansion-implementation.md` + `expansion-completion-2026-09-09.md` | Merge into one completion record | Same expansion recorded twice a day apart |
| 5.13 | `.ulpi/design/PLAYER-FINANCING-PLAN.md` (59 KB / 992 lines) | Archive (or trim to status + final decisions) | Spec for already-shipped contracts/loans |
| 5.14 | `.ulpi/design/QUICKPLAY-BOTS-TRADING-SOCIAL-PLAN.md` | Archive | Entire checklist shipped |
| 5.15 | `docs/plans/friends-and-player-social-plan.md` | Archive | "Status: implemented first release" |
| 5.16 | `docs/plans/match-history-and-in-session-social-plan.md` | Archive | Shipped; only leftover telemetry wording |
| 5.17 | `docs/plans/global-leaderboards-plan.md` | Archive | "Status: implemented all-time, seasonal…" |
| 5.18 | `docs/plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md` (22 KB) | Archive | Shipped shell; remaining items in IPAD doc |

#### P3 — duplicates / tidy

| # | Path | Action |
|---|------|--------|
| 5.19 | `agent-md-parity-brainstorm-2026-09-11.md` + `markdown-feature-parity-2026-09-11-theme-reset.md` + `fix-docs-parity-batch-2026-09-12.md` | Merge into one parity record (largest cluster outside audit chain) |
| 5.20 | `agent-codebase-bugs-2026-09-11.md` + `fix-server-batch-2026-09-12.md` + `fix-transaction-ui-batch-2026-09-12.md` | Merge into one "09-11 bugs → fixes" record |
| 5.21 | `agent-complexity-review-2026-09-11.md` (25 KB) + `fix-architecture-batch-2026-09-12.md` | Merge, keep only the batch record |
| 5.22 | `agent-ui-review-2026-09-11.md` + `agent-ux-review-2026-09-11.md` + `ux-1920-reset-slice-2026-09-11.md` + `ui-visual-premerge-2026-09-12.md` (+ untracked `qa-security-premerge-2026-09-12.md`, `codescene-premerge-2026-09-12.md`) | Merge into one UI/UX audit timeline |
| 5.23 | `SHOWCASE.md` | Merge into README (or delete) — duplicates intro, features, run instructions, live-demo link |
| 5.24 | `docs/superpowers/plans/2026-09-11-petal-pedestrian-ambient-motion.md` | Close/archive — work committed as `5d22d54` |
| 5.25 | `.ulpi/design/FINANCE-RAIL-UX-PLAN.md` | Update status banner — cites `main.js:945` (now `openProfileEditor,`), stale gate language |

**Keep (load-bearing):** `docs/DEVELOPMENT_WORKFLOW.md`, `docs/DEVLOG-7.md`, `docs/design/figma-theme-worlds-2026-09-11.md`, `docs/design/THEME-MUSIC-CURATION-2026-09-12.md`, `.ulpi/design/DESIGN.md` + `supplied/poorup_design_system.md` + `BOARD-SOURCES.md`, root README/Instructions/PRODUCT, `public/assets/parlor-patrol/README.md`, `global-events-plan.md`.

**Summary:** ~0.6 MB of Markdown are candidates; biggest clusters = 09-08 audit chain (5 files), 09-11/09-12 audit→fix-batch pairs, 3-file markdown-parity set.

---

### 6. Accessibility (WCAG 2.2 AA)

#### P1

| # | Location | Criterion | Issue | Fix |
|---|----------|-----------|-------|-----|
| 6.1 | `public/clientThemeData.js:188` | 2.4.7 / 1.4.11 | Light theme `--theme-focus: #122e3a` ≈1.05:1 on all dark surfaces → focus outlines invisible | Set light `--theme-focus` ≥3:1 on all surfaces |
| 6.2 | `public/styles.css:108` | 1.4.3 | Original theme `--field-placeholder: #4f5a54` on `--surface-input: #061216` = 2.64:1 → all placeholders fail ("CREATE AN ALIAS", "ABC123") | Brighten placeholder token ≥4.5:1 |
| 6.3 | `public/styles.css:61` / `index.html:168` | 1.4.3 | Original `--gold-800: #3a382a` on panels = 1.60:1 → `[ C ]`/`[ B ]` t-micro hints unreadable | Light token ≥4.5:1 or restyle in gold-300 |

#### P2

| # | Location | Criterion | Issue | Fix |
|---|----------|-----------|-------|-----|
| 6.4 | `public/clientThemeData.js:120-121` | 1.4.3 | Autumn small text fails: gold-400 3.46:1 (2.93:1 on raised — lobby heads, "TIME LEFT"), gold-500 2.43:1, placeholder 4.18:1 | Lighten Autumn gold-400/500 + placeholder |
| 6.5 | `public/clientThemeData.js:89,120` + `styles.css:74-75` | 1.4.3 | `--green-status`/`--red-bright` not theme-overridden: Summer 4.31:1/4.19:1, Autumn 4.42:1/4.29:1 — below 4.5:1 for 11–13px status labels | Per-theme green/red tokens ≥4.5:1 |
| 6.6 | `public/styles.css:720-725` | 1.4.3 | Home clock/score (gold-050, 22–40px) on light scenes ≈1.3:1 — statement selectors patched but `.home-local-time`/`.home-patrol-score` missed | Dark text+shadow overrides for spring/summer/light (≥3:1 large text) |
| 6.7 | `public/main.js:516-526` | 4.1.3 | `#chat-body` has no `aria-live`; player chat never reaches `#system-announcer` — SR users hear nothing when others chat | `aria-live="polite"` on chat feed or announce player messages |
| 6.8 | `public/styles.css:2085` | 2.5.8 | `.parlor-toast-close` 18×18px target < 24px minimum | Enlarge to ≥24×24 |
| 6.9 | `public/clientSocialSurfaces.js:727` | 4.1.2 | `.ranking-list` has `aria-label` without a role — label dropped by AT | Add `role="list"` or real `<table>` |
| 6.10 | `public/index.html:101` | 1.3.1 / 2.4.6 | `.home-patrol-hint` ("SHIFT+P · NIGHT SHIFT") is `aria-hidden`; SR status says only "STANDBY…" — trigger undiscoverable | Move hint into announced patrol status |

#### P3

| # | Location | Criterion | Issue |
|---|----------|-----------|-------|
| 6.11 | `public/styles.css:2717` | 2.5.8 | Face-canvas cells min 20×20px < 24px on narrow screens |
| 6.12 | `public/styles.css:3840` | 2.4.11 | Profile sticky 68px header can obscure keyboard-scrolled focus — add `scroll-margin-top` |
| 6.13 | `public/index.html:103` | 2.1.1 | Helicopter fly-by button `aria-hidden` + `tabindex="-1"` — playable element unreachable; document Night Shift SR-equivalent |
| 6.14 | `public/clientTheme.js:28` | 4.1.2 | Redundant `aria-checked` + roving tabindex beside native `checked` — drop `aria-checked` |

**Summary:** 14 violations (3 P1, 7 P2, 4 P3). Worst themes: Light (focus 1.05:1) and Original (placeholder 2.64:1, gold-800 1.60:1); Autumn has most failing small-text pairs. Keyboard: **0 traps, 0 unreachable controls** — gaps are contrast + live-region only.

---

### 7. Performance

#### P1

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 7.1 | `public/clientStateSync.js:416` → `main.js:541` | Every `update-state` snapshot calls `renderAll()` → full DOM rebuild (board grid, 8 player rows, 60-line chat, HUD, rails, setup) + `saveGame()`, per server event (bots act ~650ms) | Diff per-snapshot or rAF-debounce `renderAll` |
| 7.2 | `server/socketRuntime.js:201-215` | `broadcastRoomState` re-serializes a large per-viewer game summary (40 tiles, equity, players, feed, history) for *every* socket on every change, no compression | One shared snapshot per event (viewer-scoped fields as exception) + cache + compression |

#### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 7.3 | `public/styles.css:221-227,302-316` | `theme-page-world` (fixed, opacity .25) never paused → ~14 concurrent full-screen animated GPU layers (~120 MB textures @1080p, ~500 MB @4K) | Pause/drop page-world stack when a view world is visible |
| 7.4 | `server/server.js:69` | `express.static` with no `maxAge`/`immutable` → every theme switch re-issues ~18-21 conditional requests | `maxAge: '1y', immutable: true` for `/assets/*`, keep index.html no-cache |
| 7.5 | `server/server.js:37-80` | No gzip/brotli: 222 KB styles.css, ~800 KB JS, 1.48 MB legacy SVGs ship raw | Add `compression` middleware |
| 7.6 | `public/main.js:516-532` | `renderChat()` rebuilds innerHTML of last 60 lines on every message (~25 call sites) | Append-only DOM (insert one node, drop oldest) |
| 7.7 | `public/main.js:558` + `clientGameSave.js:46-64` | `saveGame()` sync `JSON.stringify` + `localStorage.setItem` on every `renderAll()` while playing — blocking main thread multiple times/sec | Debounce 2–5s or write on turn/phase boundaries |
| 7.8 | `public/clientAuctionUi.js:52,94-103,263-275` | `tickAuction` every 60ms re-renders 6 sub-sections via innerHTML — 16 DOM rebuilds/sec for countdown-only data | Update only countdown text node per tick |
| 7.9 | `public/index.html:9` | Parser-blocking 155 KB non-minified socket.io client in `<head>` | Move to end of body with `defer` (min build if configurable) |

#### P3

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 7.10 | `public/clientThemeRender.js:120,157-161,91-115` | Theme switch clears+re-sets ~70 CSS custom properties (double style recalc) + rebuilds 3 full layers (21-27 `<img>` + 348 skyline rects), no memoization | Skip unchanged layers; swap vars via one attribute/class |
| 7.11 | `public/assets/legacy-board-40*.svg` | Two 740 KB SVGs (1.48 MB) referenced nowhere | Remove from `public/` |
| 7.12 | `public/assets/audio/pondering-the-cosmos.mp3` | 12.3 MB soundtrack; every music session streams 12 MB looping forever | Serve ~1-2 MB compressed loop; keep master out of `public/` |
| 7.13 | `public/styles.css:297-301` | Weather/accent full-screen layer animations (steps ±3–12px) still drive full-viewport texture compositing 60×/s | Contain props to a region or drop when world not visible |
| 7.14 | Startup | 59 module files ≈ 800 KB unminified JS parsed/executed on load; no build step | Strip comments/whitespace or lazy-import `clientSocialSurfaces.js`/`clientTradeUi.js` (170 KB) |
| 7.15 | `server/socketRuntime.js:206` | `io.sockets.sockets.forEach` iterates every connected socket per room broadcast (O(total sockets) per event) | Per-room socket set or `io.in(roomCode).sockets` |
| 7.16 | `public/clientNightShift.js:628` + `clientHudRender.js:177` | Sub-second timers: night-shift re-render every 200ms, turn timer write every 120ms | Tick 250–500ms, diff only changed readout |

**Positives:** all keyframes animate transform/opacity only (no layout thrash); `will-change` sparse + reduced-motion gated; server has only 2 global intervals with clean room-timer teardown; chat travels on its own event.

**Summary:** biggest client cost = full-DOM `renderAll()` + localStorage write per snapshot, compounded by ~14 permanently-composited full-screen animated theme layers. Biggest server cost = per-socket re-serialization, uncompressed. Quickest wins: static `maxAge`+compression, debounce `saveGame`, append-only chat, pause `theme-page-world`.

---

### 8. Security

No P0/P1 remotely-exploitable code-execution or account-takeover chain confirmed. CSP `script-src 'self'`, strict input allow-listing, server-authoritative money math.

#### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 8.1 | `server/serverSocketAccount.js:78-97` | Auth rate-limit keyed only on `socket.handshake.address` with proxy trust disabled → behind a reverse proxy one attacker locks *every* user out of account auth for 60s, repeatably | Key bucket on socket id + IP (+ account id when present) |
| 8.2 | `server/accountStore.js:388-498,568-571` + `clientSanitize.js:316-340` | Session tokens: 256-bit bearer secrets in plaintext localStorage, replayed on every event, never expire; persisted `sessionTokenHash` keeps them valid across restarts forever — any leak = permanent account takeover | Add expiry + sliding refresh TTL; rotate on `account-update`; revoke on password change |
| 8.3 | `server/server.js:58-64` + `main.js:281-292` | Raw passwords + session tokens sent in cleartext over `ws://`; nothing enforces/warns about TLS termination | Terminate TLS at proxy + HSTS; refuse cleartext credentials when `wss://` required |
| 8.4 | `server/httpRateLimiter.js:50-56` + `server.js:50` + `socketRateLimiter.js:3-19` | HTTP limiter disabled by default (`limit 0` → unlimited); socket limiter buckets by `socket.id` → fresh connection per message resets chat cooldown + event cap; no per-IP backstop unless env set | Enable IP-based HTTP limit by default; add per-IP socket buckets |

#### P3

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 8.5 | `public/clientDom.js:8` | `esc()` omits `'` — latent attribute-breakout XSS for any future single-quoted interpolation (today all sites verified safe) | Extend escape set with `'` |
| 8.6 | `public/clientRoomsUi.js:57-87` | Room-directory rows interpolate server fields into innerHTML with no `esc()` — safe only because server whitelists names | Defense-in-depth: `esc()` every directory field |
| 8.7 | `server/roomSettings.js:486-494` + `rooms.js:565` | Generic string settings (`bankruptMode`, `bankLoanSeverity`) uncapped, echoed in every room broadcast — host can bloat every state push | Length-cap generic string settings |
| 8.8 | `server/economyApi.js:96-103` + `socketRuntime.js:816-825` | `economyTransactions`/`contractTransactions` never pruned within a game — unbounded entries via unique requestIds (~24/s/socket) | Cap maps or evict old entries |
| 8.9 | `server/socketSocialApi.js:32-36,251-263` | `finish-patrol-run` accepts client-submitted score; plausibility cap allows up to 100,000 points for an idle run — leaderboard fraudulently maxable | Bind score to server-side gameplay/simulation |
| 8.10 | `server/serverSocketAccount.js:118-122` + `accountStore.js:530-550` | `check-username` unauthenticated, unthrottled, exact available/taken → scripted username enumeration | Rate-limit per IP; generic messages |
| 8.11 | `server/server.js:42-48` | Missing `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` | Add the three headers |
| 8.12 | `server/appearanceApi.js:20` + `clientSprites.js:119-130` | `spriteFromGrid` writes cells straight into SVG `fill` — safe only because grid values validated elsewhere | Coerce/escape cell values in renderer |
| 8.13 | `server/rooms.js:733-748` + `serverSocketAccount.js:192-211` | Guest `clientId` (sessionStorage) is a bearer credential for `restore-session` — anyone with it can take over a disconnected seat within the 10s grace | Bind guest restore to a per-socket secret |
| 8.14 | `server/accountStore.js:451` | `sessionTokenHash` + scrypt hash/salt persisted together in `accounts.json` (gitignored today) — any misdeployment leaks credential material | Keep session hashes in-memory only |

**Secrets:** no hardcoded secrets in committed files (only test-fixture passwords, CI secret references, env-read API keys). `server/data/` properly gitignored.

**Summary:** critical = 0. Worst XSS surface = `clientRoomsUi.js:57-87` (safe today via server-side normalization; add esc). Worst hardening gap = session/auth posture: non-expiring localStorage bearer tokens, cleartext credentials over un-TLS'd websockets, proxy-collapsible auth rate limit enabling site-wide login DoS.

---

### Cross-Category Top 10 (highest leverage)

1. **2.1** `ensureBots` oversubscription — game can start above maxPlayers (reproduced).
2. **4.1** No confirmation when leaving a live round — silent seat forfeit on 4 paths.
3. **2.2 / 4.2** Buy/pass decision bypassable via "End Turn" + roll while offer open — stranded tiles.
4. **7.1** Full-DOM `renderAll()` + localStorage write per server snapshot.
5. **6.1–6.3** Default-theme contrast failures (placeholder 2.64:1, gold-800 1.60:1, Light focus 1.05:1).
6. **8.2** Non-expiring localStorage bearer sessions, cleartext over ws://.
7. **3.1** Board grid broken 1280–1335px (stretched board + clipped rail).
8. **7.3** ~14 permanently-composited full-screen animated layers.
9. **5.1** 40 KB dead audit doc citing a deleted monolith (plus ~0.6 MB stale MDs total).
10. **1.4 / 7.11** 1.48 MB + 3.3 MB of unreferenced/dead static assets.

---

## Part 2 — Round 2: Deep Logic Audit

_Agents: overengineering (client), bugs (game subsystems), UI (game surfaces & modals), UX (social/meta), MDs (round 2), test quality & coverage, data integrity & persistence, game rules correctness & fairness._

Second independent 8-agent audit pass. Read-only; no code changes made. Deltas verified against round 1 (`multi-agent-full-audit-2026-09-12.md`) — all findings below are NEW unless noted.

- Agent 1 — Overengineering (client-focused pass)
- Agent 2 — Bugs — game subsystems
- Agent 3 — UI bugs — game surfaces & modals
- Agent 4 — UX bugs — social/meta flows
- Agent 5 — Unnecessary / stale Markdown (round 2)
- Agent 6 — Test quality & coverage (new category)
- Agent 7 — Data integrity & persistence (new category)
- Agent 8 — Game rules correctness & fairness (new category)

Severity: P0 = critical / P1 = high / P2 = medium / P3 = low. CONFIRMED = reproduced with evidence; SUSPECTED = code-path evidence.

---

### 1. Overengineering (round 2, client-focused)

#### P1

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 1.1 | `public/clientKeyboard.js:135,152,163,223` | Three parallel Escape registries (`ESCAPE_GATES`, `LATER_GATES`, `TOP_SURFACE_ESCAPE`); `handleModalEscape` checks `TOP_SURFACE_ESCAPE` first and returns, making every `ESCAPE_GATES` entry and most `LATER_GATES` entries (rooms/card/deed/trade/popup/gameover/drawer, duplicated again at :223) unreachable — two-thirds of the routing table is dead indirection | Collapse to one ordered table and delete shadowed arrays |

#### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 1.2 | `clientCasinoUi.js:20`, `clientMarketUi.js:38`, `clientRailEvents.js:43`, `clientParlorBindings.js:34`, `clientWalletUi.js:181`, `clientGameModalsUi.js:141` | Six hand-rolled pending-button helpers doing the same disabled/aria-busy/PROCESSING… dance with three different restore mechanisms (only one times out) | Extract one `markPending/clearPending` helper |
| 1.3 | `clientStateSync.js:56`, `clientDealUi.js:19`, `clientSponsorshipUi.js:18`, `clientWalletUi.js:20` | Four local copies of "who is the local seat" (`localServerId` ×3 + `localPlayer`) plus 27 raw `state.players[0]` reads — identity rule re-derived everywhere | Export `localPlayer()/localServerId()` from `clientState.js` |
| 1.4 | `clientState.js:167` + `clientAccountIdentity.js:206-208,221-222` | `state.unlockedAchievements` (Set) mirrors `state.achievementRecords` (Map) keys; both mutated/reset in lockstep — two sources of truth | Derive the Set or drop it |
| 1.5 | `main.js:573,603` | `runTurn`/`endTurn` reimplement settled-flag + 8s timeout + busy reset + `reportChatError` while `clientRequestController.emitWithTimeout` already provides it (used by 4 other modules) | Route both through `emitWithTimeout` |
| 1.6 | `gameLogic.js:876,918`, `globalEventsApi.js:340,384,405`, `auctionApi.js:191` | The `zeroCashReached` rule is copy-pasted at 7 debit sites across 4 modules — new cash mutations silently lose the achievement | One `debitCash(player, amount)` primitive |
| 1.7 | `gameLogic.js:499-509` | `activePlayers()` and `connectedNonBankruptPlayers()` identical; `configureStartOrder` (:512) inlines a third copy; `botApi.js:382` re-filters on top | Keep one predicate, delete aliases |
| 1.8 | `styles.css` (~47 selectors, 66 blocks, ~160 lines) | Dead second vocabulary of abandoned UI generations: `token-pop`, `boot-in`, `build-row`, `deed-*`, `home-stats`, `rooms-host/-foot`, `rules-*`, `social-tabs`, `ts-right`, `mt24`, `wm-mini`, `pop-desc/-grid2`, ownership/contract/player-contract classes, seven `su-*` setup classes, `mini-board*`, `market-advanced-*`, six `finance/financing-*` | Delete dead rule blocks |

#### P3

| # | Location | Issue |
|---|----------|-------|
| 1.9 | `clientState.js:150-152,218,238-239,243` | Six write-only state fields (`roomEntryRequestId` 5 writes/0 reads, `roomPlayerId` 5/0, `negotiationContractId` 3/0, `botStatus` 4/0, `card` 4/0, `quickJoin` 4/0) |
| 1.10 | 9 modules (e.g. `clientThemeRender.js:87`, `clientProfileRender.js:349,454`, `clientNightShift.js:71`, `clientRoomsUi.js:20`…) | ~33 symbols exported but used only in their own file (`paintThemeSkyline` never called anywhere) — needless API surface |
| 1.11 | 24 files | Each `client*` module redeclares `function noop() {}` for its host seam — 24 copies |
| 1.12 | `styles.css:2791-2794` vs `:2813-2830`; `:657` vs `:3457` | Verbatim-duplicated media blocks (`.field/.setting-select`, home-readout rules, `.online` display none) |
| 1.13 | `styles.css:2103` | `@keyframes parlor-toast-out` never referenced — dead animation |
| 1.14 | `public/assets/board-icons/vault.svg` | Unreferenced leftover (used icons: `passing-by-bars`, `surprise`, `treasure-chest`) |
| 1.15 | `server/rooms.js:644-685,434-439` | `Room` auto-generates 34 pass-through methods (`this.game[method](...args)`) — whole GameState API exists twice with no invariant |
| 1.16 | `clientStateSync.js:200-203` | `state.owners/houses/mortgaged` re-store `serverTiles[].ownerId/houseCount/mortgaged` as three parallel maps rebuilt every snapshot |
| 1.17 | `main.js:628`, `clientHudRender.js:87`, `clientKeyboard.js:210` | "Must resolve acquisition before ending" predicate encoded three ways in three modules |
| 1.18 | `main.js:384-390`, `clientRoomShare.js:32-39`, `clientAccountIdentity.js:212,450`, `clientProfileBindings.js:123`, `clientTheme.js:16-18` | Five modules write `#system-announcer`/`#error-announcer` directly while `announceToScreenReaders` owns the contract |
| 1.19 | `clientCardsRender.js` (79 lines), `clientRoomShare.js` (51), `clientAudioControls.js` (83) | Single-consumer modules smaller than their boilerplate |
| 1.20 | `styles.css` | Breakpoint sprawl: 8× `max-width:640px`, 5× `min-width:2200px`, plus 560/620/700/720/760/767/860/899/900 — cascade order is the real layout model |

**Summary:** worst new finding = the triple Escape registry (2/3 unreachable). Client duplication is systemic (6 pending helpers, 4 seat accessors, 24 noops, ~33 private-only exports). CSS carries ~47 dead classes + duplicated media blocks. Server's new smells: scattered `zeroCashReached`, duplicate `activePlayers()`, Room 34-method facade.

---

### 2. Bugs — Game Subsystems

Note: agents confirmed some round-1 findings already fixed in HEAD (double-GO cards, roll-while-offer-open, ensureBots capacity).

#### P1

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 2.1 | CONFIRMED | `server/marketExpansion.js:241-242,306-325` | **Option strike/premium fully client-controlled and same-round exercisable** — opened a 100-qty put, strike 500 vs quote 50, $100 premium, exercised instantly for $45,000 (cash 10,000→54,900, reserve 100,000→55,000); six strike-10 calls vs quote 100 netted +$900 each — guaranteed payout from house reserve | Band strike to quote, price premium server-side, credit premium to reserve |

#### P2

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 2.2 | CONFIRMED | `server/marketExpansion.js:398` | `shortDefaultDebt` written but never decremented/payable anywhere; guard at `:100` blocks all market actions "until settled" — permanent dead-end | Add settle path or clear on bankruptcy/liquidation |
| 2.3 | CONFIRMED | `server/botApi.js:415` + `botLogic.js:96-98,554-557` | **Bots livelock proposing the same declined loan**: 3-bot 600-step run = 299 repeated proposals + 300 declines vs 1 roll (only stopped by step cap) | Fingerprint declined (recipient, terms) per round; deprioritize below roll |
| 2.4 | CONFIRMED | `server/seasonModule.js:234` | Mastery quadratic in games: 10 matches × 1 event = mastery 220 (Σ4i) not 40 | Use per-match deltas |
| 2.5 | CONFIRMED | `server/seasonModule.js:231,190` | `fairTrades`/trade points always zero — participants never carry fairTrades/tradesCompleted (live on match record); test masks it by injecting values | Pass match-level tradesCompleted or add participant field |
| 2.6 | CONFIRMED | `server/marketExpansion.js:10,163,492-497` | Initial margin == maintenance requirement, so any adverse tick force-liquidates: 10 units @100 → equity==maintenance==250; quote 99 → liquidation, $50 loss on $1 move | Set collateral rate strictly above maintenance |
| 2.7 | CONFIRMED | `server/telemetryModule.js:85` (+ `socketRuntime.js:63-98`, `storeIO.js:49-76`) | Every telemetry record fsyncs+renames the whole ≤5000-event store; settlement issues 400+ blocking writes | Buffer + flush on timer/match boundary |
| 2.8 | CONFIRMED | `server/roomSetup.js:253-271` + `serverSocketSocial.js:450` | Own match history exposes every opponent's casino net/bets and market positions (in-game summary scopes these per viewer) | Owner-filter casino/market/contracts rows in self history |

#### P3

| # | Status | Location | Issue |
|---|--------|----------|-------|
| 2.9 | CONFIRMED | `globalEventData.js:87` + `rentApi.js:23` | `leaderRentMultiplier` (0.6) dead data — rentApi hardcodes 0.6 |
| 2.10 | CONFIRMED | `matchHistoryAdapter.js:26` | `mergeMatchRecords` ignores limit — 50-record request can return 100 |
| 2.11 | CONFIRMED | `economyApi.js:194-196` | Casino wipe-out never sets `zeroCashReached` — NULL PLAYER unearnable via casino |
| 2.12 | SUSPECTED | `contractLogic.js:26-30` + `loanLogic.js:95` | In-debt survivor seats excluded from bank credit but still valid loan counterparties |
| 2.13 | CONFIRMED | `serverSocketSocial.js:197-203` + `seasonModule.js:353-366` | `claim-season-reward` never passes seasonId — post-rollover claims evaluated against new season; old-season claims unfulfillable |

**Summary:** most critical = unbounded same-round option exercise draining the reserve. Biggest uncovered subsystem = bots (livelock) with market lifecycle close second. Test gaps: option bounding, bot churn, season participant fields, casino zeroCash.

---

### 3. UI Bugs — Game Surfaces & Modals

#### P1

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 3.1 | `public/clientSurfaces.js:255` | Confirm dialog renders **behind** an open Deals detail card (all `.popup` z-70; confirm at `index.html:512`, deal-detail at `:854`, later DOM wins) — declining a trade opens an invisible dialog whose buttons can't be seen while the visible card is already inert | Incrementing z-index per surface or re-parent confirm modal |
| 3.2 | `public/clientSponsorshipUi.js:107` | Closing sponsorship desk removes the only way to resolve it; nothing reopens on snapshots, HUD shows disabled "Resolve Sponsorship" — cash-short buyer hard-stalled | Reopening affordance + snapshot resync |

#### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 3.3 | `styles.css:2405` | `.choice-card`, `.auction-card` (:2426), `.account-card`, `.achievement-detail-modal`, `.casino-desk-card`, `.market-desk-card` override `.popup-card` overflow to hidden — short viewports clip content with no scrollbar and unreachable buttons | `overflow-y:auto` / inner scroll region |
| 3.4 | `styles.css:2426` | Unclosable modals (`popup-scrim-locked` + `preventEscape`) with clipping content = round cannot be resolved (BUY/PASS/Rematch/Bankruptcy unreachable) | Same scroll fix + pin critical actions |
| 3.5 | `clientCasinoUi.js:114` | Stake form re-populated every `renderAll()` (~650ms with bots); value restored but focus/caret lost — typing interrupted | Preserve focus or skip re-render while focused |
| 3.6 | `clientBoardRender.js:434` | `stackOffset()` has only 4 offsets; Metro seats 6 — tokens 5/6 render exactly under token 1 | Generate offsets for room maxPlayers |
| 3.7 | `clientTradeUi.js:1432` | `emitTradeOffer()` closes modal + clears `tradeWith` immediately; rejection loses the whole composed offer with no PROCESSING state | Keep open until ack success |

#### P3

| # | Location | Issue |
|---|----------|-------|
| 3.8 | `clientAuctionUi.js:190` | `${a.bid}` overwrites `$0` — currency symbol disappears + no thousands grouping after first tick |
| 3.9 | `clientAuctionUi.js:236` | `auctionPlayerBroke()` returns false early for p1 — green "BIDDING" chip while raise buttons disabled |
| 3.10 | `main.js:527` | Chat forced to bottom every `renderAll()` (every ~650ms with bots) — can't read scrollback |
| 3.11 | `clientHudRender.js:313` | Vacation pool `$12500` ungrouped vs cash grouped |
| 3.12 | `styles.css:902` | `#view-game .pr-right { display:none !important }` hides AFK/CPU/ONLINE chips in-game — can't tell disconnected/bot seats |
| 3.13 | `clientNightShift.js:76-77` | Night Shift reuses clock/score elements with stale `aria-label="Local time"` / `"Parlor Patrol score"` |
| 3.14 | `clientKeyboard.js:129` | `#night-shift` not in `SURFACE_SELECTORS`; Tab escapes to home header behind overlay |
| 3.15 | `clientGameModalsUi.js:215` | Winner crown `p.id === winnerId || i === 0` can mark two winners or wrong player |
| 3.16 | `clientGameModalsUi.js:84` | Auction-mode scrim left as focusable `<button aria-label="Close">` with null handler — focusable no-op |
| 3.17 | `main.js:651-653` | `buyTile()` clears pending state before ack; rejection only appends chat — mandatory decision silently disappears |
| 3.18 | `clientNightShift.js:416` | Beacon drops exempt from heart loss — reaching border removes target with no penalty, contradicting tag-before-border rule |

**Summary:** 2 P1 blocking-flow defects (invisible confirm above Deals; unrecoverable sponsorship dismissal), 5 P2 modal-scroll/focus/stacking defects, 11 P3 readout/semantics issues. Audio toggles verified correct (icons, aria-pressed, labels).

---

### 4. UX Bugs — Social / Meta Flows

#### P1

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 4.1 | `public/main.js:527` | Chat yanks to bottom on every snapshot (~650ms with bots) — reading scrollback impossible | Auto-scroll only when already near bottom |

#### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 4.2 | `main.js:842-849` | Chat input cleared before ack; 500ms rate-limit rejection loses the typed message | Keep text until success + show cooldown |
| 4.3 | `clientSocialSurfaces.js:233` | Social search returns `""` on empty results — typo looks like broken search | Explicit "NO EXACT USERNAME MATCH." |
| 4.4 | `clientParlorBindings.js:382-398` | "REMOVE FRIEND" fires immediately, no confirm/undo, next to INVITE/HISTORY/BLOCK | Confirm via `openConfirmModal` |
| 4.5 | `clientParlorBindings.js:424-434` + `server/socialStore.js:196-204` | "BLOCK" one-click, silently deletes friendship+invites, no unblock path anywhere | Confirm + add unblock list |
| 4.6 | `server/socialStore.js:69-71` + `clientSocialSurfaces.js:360` | Invites expire at 15 min but stale ones stay listed with active JOIN — click always fails | Filter/mark expired server-side |
| 4.7 | `clientRoomsUi.js:89-97` | Directory empty state says "NO PUBLIC TABLES" even when a filter excludes rooms, and while offline alongside load error | Contextual copy + clear-filter/host action |
| 4.8 | `main.js:282-293` + `clientSocketListeners.js:290-293` | Game actions stay enabled while RECONNECTING; socket buffers emits → late actions / burned ack timeouts; status only in micro-text | Disable turn actions or blocking reconnect banner |

#### P3

| # | Location | Issue |
|---|----------|-------|
| 4.9 | `clientGameSave.js:93-115` + `index.html:169` | Refresh mid-game restores seat silently (phase stays home) — only cue is small "SAVE FOUND" button |
| 4.10 | `main.js:459-470` + `clientProfileRender.js:145-146` | `music.play()` rejection swallowed; Preferences says "MUSIC ON" with silence, no gesture retry |
| 4.11 | `clientSocialSurfaces.js:597-601` | Rankings hero tells signed-in players "SIGN IN TO TRACK" when unranked/no row |
| 4.12 | `server/accountStore.js:788` + `clientSocialSurfaces.js:639` | Ties tie-broken server-side but rendered as sequential 01/02 — copy says ties resolved |
| 4.13 | `clientSocialSurfaces.js:368-370` | Notifications: per-item READ only, no "mark all read" (up to 50 clicks) |
| 4.14 | `clientSocialSurfaces.js:409-410,216-222` | REQUESTS badge counts requests+invites while INVITES counts invites — same invite counted twice |
| 4.15 | `clientParlorBindings.js:267-280` | "CLEAR RECENT" wipes 30 days with one click, no confirm |
| 4.16 | `clientSocketListeners.js:64-71` | Achievement unlock pushes to notifications but returns before renderSocialSurface — inbox/badge stale |
| 4.17 | `clientSocialSurfaces.js:106-110,121-123` | Toast stack drops oldest past 4; achievements auto-dismiss 4.2s — unlocks vanish unread |
| 4.18 | `main.js:814-819` + `clientGlobalEventRender.js:112-116` | Event votes no pending state; choice explanations only in `title` tooltips — double-emit + touch users vote blind |
| 4.19 | `clientProfileBindings.js:160-175,428-429` + `clientKeyboard.js:154` | BACK/Escape discards entire painted design draft with no unsaved warning |
| 4.20 | `clientGameSave.js:46-64,93-115` + `main.js:517-527` | Chat persisted to `poorup.save.v1` but never restored; empty chat has no placeholder — conversation vanishes after refresh |

**Summary:** chat fights the user (forced scroll + message loss), social destructive actions fire instantly (BLOCK permanent, no unblock UI), and stale/false states mislead (expired invites joinable, directory says empty, rankings sign-in copy, silent seat restore).

---

### 5. Unnecessary / Stale Markdown (round 2)

#### P2

| # | Path | Action | Justification |
|---|------|--------|---------------|
| 5.1 | `docs/DEVELOPMENT_WORKFLOW.md` | Update | Says Codecov works "with no token" but `ci.yml:33` sends `CODECOV_TOKEN`; Commands block omits `test:browser`/`bot:balance`; branch table has no `codex/*` despite active `codex/theme-reset` |
| 5.2 | `docs/REFACTOR-ROADMAP.md` | Delete/rewrite | Cites `main.js:8245` and an 8,415-line file; actual main.js is 1,058 lines and keydown moved to `clientKeyboard.js`; R2/R3 landed, R5 live |
| 5.3 | `.ulpi/design/HOME-PROFILE-REDESIGN.md` + `ACCOUNT-PROFILE.md` | Merge → archive | Both "implemented"; data plan references `profileViewState`, which exists nowhere |
| 5.4 | `.ulpi/design/RANKINGS-METRICS-PLAN.md` | Archive | Home signal buttons + rankings rail match the plan — fully shipped |
| 5.5 | `.ulpi/design/RULESETS-SEASONS-MARKET-PLAN.md` (22 KB) | Trim to live contract | "Implemented"; registry/season/market all run in tests |
| 5.6 | `.ulpi/design/NIGHT-SHIFT-MICROGAME-PLAN.md` | Archive body | Shipped; plan falsely claims `debris-6-frames.svg` is used at border (zero references) |
| 5.7 | `docs/audit/pre-merge-review-2026-09-12.md` | Merge into 09-12 evidence archive | Transient gate record; resolves round-1 snapshot P1/P2; one claim false (pose assets exist) |
| 5.8 | `docs/plans/deal-negotiation-plan.md` | Archive | "Status: implemented"; parity manifest marks Completed |

#### P3

| # | Path | Action | Justification |
|---|------|--------|---------------|
| 5.9 | `.ulpi/design/FINAL-REVIEW.md` | Delete | References `REFERENCE_UI_ONLY` mode with zero occurrences; ZIP refactor merged |
| 5.10 | `.ulpi/design/gameplay.md` | Merge into DESIGN.md | Only asset claim (removed 960×670 master) contradicted by BOARD-SOURCES.md |
| 5.11 | `.ulpi/design/THEME-FIVE-VISUAL-BRAINSTORM.md` | Merge into `docs/design/figma-theme-worlds-2026-09-11.md` | Identical status banners; asset rule has two sources to sync |
| 5.12 | `docs/plans/IPAD-LANDSCAPE-UI-UX-AUDIT.md` | Keep + update citations | `styles.css:995-1002` now deed detail; IPAD-10/14 still live |
| 5.13 | `docs/audit/fix-responsive-a11y-batch-2026-09-12.md` | Merge into 09-12 batch record | Third batch record missed by round-1 clusters |
| 5.14 | `Instructions.md` | Update / move to docs/PLAYER-GUIDE.md | Stale on trades-only claim; no auctions/contracts/casino/market/events/bots; name-collides with copilot-instructions |
| 5.15 | `README.md` | Update | Game settings list omits rulesets, global events, bots, economy toggles |
| 5.16 | `.vscode/extensions.json` | Delete | Only recommends `continue.continue`; review tooling is Copilot/CodeScene |
| 5.17 | `.ulpi/design/NEW-GAME-SYSTEMS-PLAN.md` | Update §6/§7 | Bot benchmark + roulette shipped while banner implies future |

**Summary:** no new P1s; rot = implemented `.ulpi` contracts (~60 KB) + workflow doc contradicting CI. Merge pairs cheapest wins: profile/account, theme-five→figma, pre-merge evidence. Prefer update over delete for root docs that only miss new features.

**Round-2 KEEP list:** `.github/copilot-instructions.md`, `codecov.yml`, `PRODUCT.md`, `docs/DEVLOG-7.md`, `figma-theme-worlds-2026-09-11.md`, `THEME-MUSIC-CURATION-2026-09-12.md`, `global-events-plan.md`, `docs-parity-manifest-2026-09-12.json`, `.ulpi/design/DESIGN.md`, `BOARD-SOURCES.md`, `supplied/poorup_design_system.md`.

---

### 6. Test Quality & Coverage (new category)

#### P1

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 6.1 | `server/rooms.test.js:82` | 19 scenarios share one live server and deliberately leak sockets; later scenarios read earlier fixtures — reorder/insertion/slow CI cascades into unrelated failures | Split into independent namespaces or reset per scenario |
| 6.2 | `server/socketRuntime.js:1` | AFK watchdog, disconnect grace, empty-room GC, auction/bot timers, reconnect bookkeeping have zero direct tests and no coverage — highest-risk state machine verified only by flakiest wire suites | Extract clock/timer seams + fake-clock unit tests |
| 6.3 | `server/coverage-runner.js:4` | Coverage omits 22 of 61 suites: both live-server wire suites, all 7 `public/*.test.js`, `serverSocket*`, `socketRuntime`, `server.js` — CI uploads it as the server flag, hiding untested entrypoints | Include wire+public suites; add thresholds |

#### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 6.4 | `clientResponsiveA11y.test.js:38` | Regex assertions on CSS/HTML text duplicate Playwright runtime checks — formatting breaks it, real regressions pass | Delete Playwright-covered cases |
| 6.5 | `clientTransactionUi.test.js:7` | Reads 10 modules as text, asserts snippet strings — passes on broken behavior, breaks on refactor | Exercise exports or rely on Playwright |
| 6.6 | `serverSocketGame.test.js:50` | Only 2 contract-relay scenarios; dice/property/auction/trade/market/casino/event handlers never invoked in isolation | Table-drive over `GAME_VERB_HANDLERS` |
| 6.7 | `server/server.test.js:131` | `await wait(1200)` fixed sleep for bot-status event — loaded CI yields false red | Poll until event/deadline |
| 6.8 | `qa/batch3-responsive-a11y.spec.js:114` | Injects `textContent`/`is-hidden` via evaluate, never exercises the real renderer | Drive real event payload |
| 6.9 | `public/client*.js` (~45 of 51 modules) | No behavior-level unit tests — client regressions depend on slow browser specs | Node-shim tests for pure render/format modules |
| 6.10 | `coverage/lcov.info` | `socketHandlerSupport.js` 36%, `socialStore.js` 53% — shared ack/room scaffold barely covered | Direct error-branch tests |
| 6.11 | `package.json:10` | `clientCasinoReel.test.js` only in `test:audit`, which CI never runs — dead test | Add to `test`/coverage runner |

#### P3

| # | Location | Issue |
|---|----------|-------|
| 6.12 | `server/game-results.test.js:138` | `assert.ok(true)` vacuous after call |
| 6.13 | `server/server.test.js:166` | `check('server boots…', true)` tautological |
| 6.14 | `server/contracts-market.test.js:10` (+21 files) | Copy-pasted check harness; `startedRoom/ownedRoom` factories duplicated in 7 |
| 6.15 | 7+ test files | Hardcoded "N passed, 0 failed" summaries; first failed assert aborts file |
| 6.16 | `server/rent.test.js:7`, `applyCard.test.js:4` | Golden tables from pre-refactor code freeze existing bugs — add independent invariants |
| 6.17 | `qa/theme.spec.js:31` | `.nth(1)` positional radio locators — break on reorder |
| 6.18 | `qa/batch3-responsive-a11y.spec.js:8` | Pins local viewports but runs on all 6 projects (~6× redundant); `mobile-390` uses Desktop Chrome `isMobile:false` |
| 6.19 | `package.json:25` | No axe-core; ~10 hand-picked DOM contracts only — focus/contrast/landmark regressions escape |
| 6.20 | `package.json:9` + `ci.yml:25,28` | 61 suites sequential; CI runs `server.test.js` twice; wire suites carry 60/90s watchdogs |

**Summary:** worst untested module = `server/socketRuntime.js` (timer/GC/reconnect, no seam, no coverage). Flakiest suite = `rooms.test.js` (shared server, ordered leaks, fixed waits). Highest-ROI addition = fake-clock socketRuntime tests.

---

### 7. Data Integrity & Persistence (new category)

#### P0

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 7.1 | CONFIRMED | `server/persistenceMode.js:8-15` | Readiness accepts any non-empty `POORUP_POSTGRES_URL` — no Postgres adapter exists anywhere. Operator sets horizontal scale + dummy URL, starts N processes on one JSON file: each holds its own Map and rewrites the whole file → every registration/stat silently erased. Verified: `assertPersistenceMode({POORUP_HORIZONTAL_SCALE:'true',POORUP_POSTGRES_URL:'postgres://x'}).ready === true` | Reject horizontal mode outright or require real adapter health-check |

#### P1

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 7.2 | CONFIRMED | `serverSocketSocial.js:166-183` | Achievement persisted to achievements.json then accounts.json; crash between → ledger entry without profile entry; retry returns `created:false` so account update never runs — permanent loss | Reconcile on load or write account first |
| 7.3 | CONFIRMED | `serverSocketSocial.js:202-208` | Season claim persisted before cosmetic grant; crash between → claim recorded, tokens/cosmetics never granted; retries `created:false` | Grant first with claimKey, then mark |
| 7.4 | CONFIRMED | `telemetryModule.js:85` + `socketRuntime.js:65-97` | Every telemetry event rewrites entire ≤5000-event file synchronously; one bot match = up to ~400 full-file writes during settlement — event-loop stalls + crash windows | Batch settlement writes / append-only |
| 7.5 | CONFIRMED | `matchStore.js:176-177,204-213` + `accountStore.js:206-209,455-457` | Every match stores up to 200 full bot decisions in both matches.json and account history: 152 KB/record → ~77 MB at 500 cap, ~5.4 MB/account — plus whole-file sync rewrite per mutation | Store traces separately/aggregate with byte budget |

#### P2

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 7.6 | CONFIRMED | `backupStore.js:63-70` | `verifyBackup` ignores its own `.sha256` sidecar — tampered valid-JSON passed and was restored over destination | Verify checksum in verify + restore |
| 7.7 | CONFIRMED | `backupStore.js:27-37` | Rotation orders by mtime only, never validates JSON — truncated newest survived while older valid backup was deleted | Validate candidates before eviction |
| 7.8 | SUSPECTED | `backupStore.js:48-52` | Direct write to final name; sidecar written after — crash/disk-full leaves partial backup that looks legitimate | Temp + rename, sidecar atomic |
| 7.9 | SUSPECTED | `server.js:96-101` | Backup loop has no cross-store snapshot marker while settlement writes 4 stores sequentially — backup between writes restores a mix | Generation/batch manifest or pause writers |
| 7.10 | CONFIRMED | `matchStore.js:147` | `sanitizeMatch` defaults missing completedAt to now — legacy record outranked 2020 records; schema drift rewrites ordering | Null/epoch fallback; exclude unknown timestamps from recency |
| 7.11 | CONFIRMED | `accountStore.js:264-266,610` | Match idempotency only against 50-row account history — replay after 50 newer matches double-counts gamesPlayed | Persist settled-matchId set outside window |
| 7.12 | CONFIRMED | `seasonModule.js:326-328` | Season idempotency against 1000-match cap; raw matchId vs String()-coerced list → non-string ids always duplicate | Canonical String set / unique index |
| 7.13 | CONFIRMED | `cosmeticCatalog.js:116` (+ `seasonModule.js:104-119`, `socialStore.js:136-139`) | Load silently truncates persisted collections (10k/5k caps) with no warning; next persist rewrites without dropped rows — irreversible | Detect truncation, quarantine, refuse shrunken persist |
| 7.14 | CONFIRMED | `clientGameSave.js:66-77` + `main.js:1013` | `poorup.save.v1` never hydrated; only powers the Resume button (server restore-session does the work) — after server restart the full board snapshot is dead data | Apply with version check or stop writing |
| 7.15 | CONFIRMED | `clientSanitize.js:327-346` + `clientGameSave.js:49` | Only theme listens for `storage`; profiles/account/save have no cross-tab sync — last write silently discards other tab | Storage-event reconciliation |

#### P3

| # | Status | Location | Issue |
|---|--------|----------|-------|
| 7.16 | SUSPECTED | `storeIO.js:67-75` | fsync covers temp file but not parent dir after rename — rename may not survive power loss |
| 7.17 | SUSPECTED | `storeIO.js:38-47` | Quarantine name only ms-stamped; two quarantines in 1 ms collide; failure swallowed |
| 7.18 | CONFIRMED | `socialStore.js:127-132,256-262` | Notifications capped per account but account count unbounded; whole map rewritten per mark-read |
| 7.19 | CONFIRMED | `accountStore.js:444-452` | Duplicate handles first-wins silently; duplicate record dropped, erased on next persist |
| 7.20 | CONFIRMED | `backupStore.js:78` | Restore destination guard effectively dead; restore not exposed via API — dormant path with no checksum/dry-run |

**Summary:** worst data-loss scenario = horizontal-scale mode passes guard while all stores remain per-process whole-file JSON (silent cross-process overwrites). Growth risk = 152 KB match records (~77 MB) + up to 400 telemetry rewrites/match. Quickest win = actually verify the `.sha256` sidecar (tampered backups currently verify+restore as success).

---

### 8. Game Rules Correctness & Fairness (new category)

Verification: rent 45✓, property-actions 14✓, gameLogic 11 suites✓, trades 52✓, casino-bankruptcy 58✓, global-events 22✓, contracts-market 28✓, marketExpansion 12✓, boardRegistry 12✓, audit 57✓, bot-simulation 25 games 0 stalls.

#### P1

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 8.1 | CONFIRMED | `contractLogic.js:137-144,483-512` + `bankruptcyLogic.js:117-128` | **Hybrid note dilution exploit**: later equity sales can push conversion past the 100% cap (cap counts recorded shares, ignores pending conversionShare) → `convertHybridContract` falls back to `handlePlayerLoanDefault`, seizing `collateralTileIndex` (null for hybrids). Reproduced: 300 principal + 25% hybrid + 90% equity → contract defaulted, lender lost $300, borrower kept cash + deed, `repayContract` then rejects the debt | Include live hybrids in equity cap or make fallback seize property |
| 8.2 | CONFIRMED | `seasonModule.js:268-278,368-372` | **Season reward mis-grant**: percentile `(rows.length-index)/rows.length >= threshold` means "within top N% of population" — every player qualifies for large thresholds. Reproduced: last place of 3 claimed `season-top` (top 1%, 220 tokens) + `season-gold` | `rank <= ceil(population*threshold)` |
| 8.3 | CONFIRMED | `bankruptcyApi.js:46-62` + `gameLogic.js:1099` | **Debt mode can't end**: `concludeBankruptRound` never runs, `inDebt` never cleared, no-creditor bankruptcy zeroes all cash. Reproduced: 2-player debt mode — A defaults, B declares → `started` stays true, `lastWinner:null`, $1500 destroyed, both in debt forever | Run active-seat win check in debt mode + recovery path |

#### P2

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 8.4 | CONFIRMED | `contractLogic.js:115-127` + `bankruptcyLogic.js:117-128` | Unsecured player loans (`collateralTileIndex:null`) default to nothing: borrower keeps $300, no pendingPayment, lender loses $300; bots auto-offer these to the poorest seat | Route residuals through `openDebtSettlement` |
| 8.5 | CONFIRMED | `cardApi.js:54-61` | Deck reset includes jail-free cards still held by players — copies multiply (160 surprise draws → 10 jail-free cards) | Exclude held jail-free cards from reset pool |
| 8.6 | CONFIRMED | `socketRuntime.js:678-689` | **AFK timeout forgives debts**: `clearPendingPayment()` for current debtor + cancels trades/contracts/queued payments — idle until watchdog = erase rent/tax debt | Route expiring debtor through bankruptcy/liquidation |
| 8.7 | CONFIRMED | `marketExpansion.js:99-102,381-402` | Forced short buy-in records `shortDefaultDebt` that nothing collects; guard blocks all open+manage actions permanently — player locked out, shortfall vanishes | Collect at settlement/bankruptcy or clear |
| 8.8 | CONFIRMED | `marketExpansion.js:125-141` + `economyApi.js:356-467` | `expansionGuard` omits `hasLoanBackedCash` — emergency loan cash can open margin/shorts/options while `tradeMarket` and casino enforce the disclosed restriction. Reproduced: market buy rejected, `openMargin` accepted with same loan | Add loan-backed check to expansion rejection |

#### P3

| # | Status | Location | Issue |
|---|--------|----------|-------|
| 8.9 | CONFIRMED | `rooms.js:118-133` + `rulesetRegistry.js:176-184` | First ruleset-meta setting flips `rulesetExplicit` and re-applies classic defaults, silently disabling host-enabled bankLoans/market/casino/globalEvents |
| 8.10 | CONFIRMED | `auctionApi.js:169-187` + `contractLogic.js:414-429` | Repaying a loan during an auction drops bidder below their bid → sale voided ("no valid winner"), property unsold |
| 8.11 | CONFIRMED | `economyApi.js:129-177` + `botApi.js:486` | Human casino betting has no per-round cap (bots do) — unlimited spins in one turn |
| 8.12 | CONFIRMED | `globalEventData.js:223-226` | Anti-monopoly targets `game.players` not `activePlayers()` — disconnected leader targeted while actual active leader escapes |
| 8.13 | CONFIRMED | `gameLogic.js:929-939` + `bankruptcyApi.js:114-120` | `creditRentTo` drops credit when creditor bankrupt (payer still pays); `sweepCashToCreditor` leaves debtor cash for non-receivable creditor — money vanishes |
| 8.14 | CONFIRMED | `cardApi.js:285-296` | `collectFromEachCard` caps payments with no debt path while mirror `payEachCard` routes shortfalls to pendingPayment — broke seats dodge asymmetrically |
| 8.15 | CONFIRMED | `tileApi.js:95-103` | `landingGoToVacation` adds $50 to pool without debiting payer — latent money creation (unreachable: no shipped board has the tile) |

**Summary:** biggest fairness exploit = hybrid notes made unconvertible → free unrepayable transfer, plus season rewards granted to bottom ranks. Most fragile area = debt lifecycle at bankruptcy/contract boundary (debt mode can't end; unsecured defaults extinguish debt; AFK forgives; margin/short shortfalls never collected). Money IS conserved in normal rent/trade/loan/tax/auction/casino flows; server RNG is crypto; Fisher-Yates correct; jail-free cards inflate per deck cycle.

---

### Cross-Category Top 10 (round 2)

1. **7.1 / P0** Horizontal-scale guard passes with a dummy Postgres URL → silent cross-process data destruction.
2. **2.1 / P1** Client-controlled option strikes + same-round exercise → $45k instant payout from house reserve.
3. **8.1 / P1** Hybrid note dilution exploit → lender loses principal, borrower keeps everything.
4. **8.3 / P1** Debt-mode games can never end; $1500 destroyed, both seats stuck in debt.
5. **8.2 / P1** Season top-1%/gold rewards claimed by last place.
6. **7.2–7.4 / P1** Split-write crash windows permanently lose achievements and paid season rewards; 400 blocking telemetry writes per match.
7. **3.1–3.2 / P1** Invisible confirm dialog behind Deals + unrecoverable sponsorship dismissal = blocked flows.
8. **4.1–4.2 / P1–P2** Chat forced to bottom every 650ms + typed message lost on rate-limit rejection.
9. **1.1 / P1** Triple Escape registry with 2/3 unreachable + 47 dead CSS classes (~160 lines) + 24 duplicated noops — client split outpaced shared primitives.
10. **6.1–6.3 / P1** `socketRuntime.js` (highest-risk state machine) has zero tests; coverage omits 22/61 suites; `rooms.test.js` is order-dependent.

#### Comparative note vs round 1
- Round 1 found the shallow-but-wide issues (dead code, docs, a11y tokens, perf basics). Round 2 found the deep logic holes: market/contract/season exploits, debt-lifecycle money sinks, persistence crash windows, and test blind spots.
- Items round 2 verified as already fixed since round 1: double-GO cards, roll-with-open-offer, ensureBots capacity.
- Combined recommendation order: fix P0/7.1 first, then the P1 money/fairness cluster (2.1, 8.1–8.3), then split-write integrity (7.2–7.4), then the blocked-flow UI pair (3.1–3.2).

---

## Part 3 — Round 3: Runtime Dynamics Audit

_Agents: error handling & resilience, concurrency & races, i18n/formatting/time, browser & platform compatibility, observability & dev ergonomics, accessibility deep-dive (dynamic states), client architecture, server architecture & lifecycle._

Third independent 8-agent pass on new areas. Read-only; no code changes.

- Agent 1 — Error handling & resilience
- Agent 2 — Concurrency & race conditions
- Agent 3 — Internationalization, formatting & time
- Agent 4 — Browser & platform compatibility
- Agent 5 — Observability, logging & developer ergonomics
- Agent 6 — Accessibility deep-dive (dynamic states & overlays)
- Agent 7 — Client architecture & module boundaries
- Agent 8 — Server architecture, room lifecycle & scalability

Deduped against rounds 1–2. Severity: P0 critical / P1 high / P2 medium / P3 low. CONFIRMED = reproduced; SUSPECTED = code-path evidence.

---

### 1. Error Handling & Resilience

#### P1

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 1.1 | CONFIRMED | `server/socketRuntime.js:145-148,342-348,582,606,874-875` + `server.js:133-136` | Every background seam unguarded: rooms-updated debounce, turn timer, auction finish, disconnect expiry, GC/AFK tickers run without try/catch — one throw in `nextTurn()`/`finishAuction()` during the 15s AFK tick becomes `uncaughtException` → `process.exit(1)`, killing all live rooms | Per-room try/catch around timer callbacks |
| 1.2 | CONFIRMED | `public/clientSocketListeners.js:52-61` + `serverSocketAccount.js:151-153` | `restoreAccountSession` clears persisted session on *any* non-success ack, including transient rate-limit ("Too many account attempts") and fail-safe responses — 8 auth failures in 60s wipes every signed-in client's stored token on next auto-restore | Only clear on explicit invalid/expired session errors |

#### P2

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 1.3 | CONFIRMED | `server/socketRuntime.js:201-215` | `broadcastRoomState` iterates sockets with no per-viewer isolation — one throw in `getGameSummary(viewerId)` aborts the forEach and starves remaining sockets (frozen on stale state until next event) | try/catch per candidate emit |
| 1.4 | CONFIRMED | `server/accountStore.js:524-527,563-565,591` | Mutations applied in-memory before `persist()`; on write failure handler acks "could not process" but account/session already exists in memory — retry fails "already taken", restart silently loses the account | Persist atomic+rollback, or report non-durable |
| 1.5 | CONFIRMED | `public/clientSocketListeners.js:270-281` | `player-contract-offer` (`{ contract }`) and `system-message` (`{ text }`) destructure without defaults — null payload throws silent TypeError, skipping chat/render | Default args `= {}` |
| 1.6 | CONFIRMED | `clientStateSync.js:384-431` + `clientSocketListeners.js:248-251` | `applyServerState` runs full pipeline with no try/catch; no `window.onerror`/`unhandledrejection` anywhere in public/ — one exception leaves half-applied state, skips winner/debt/auction sync, zero user-visible error | Wrap listener + global client error handlers |
| 1.7 | CONFIRMED | `server/server.js:137-139` | `unhandledRejection` only logs while comment promises termination — rejected async path keeps serving with undefined state | Align failure policy |
| 1.8 | CONFIRMED | `server/serverSocketSocial.js:291-293` | `finish-patrol-run` deletes token before `recordPatrolResult` persists; on failure client gets failure + retry latch, but server answers "no longer available" forever — score lost | Persist first, delete token after success |
| 1.9 | SUSPECTED | `server/server.js:117-120` | `disconnect` listener registered outside the safe-emitter scaffold — throw in `handleSocketDisconnect` (torn-down room) → uncaughtException → process exit | Route through guarded seam |

#### P3

| # | Status | Location | Issue |
|---|--------|----------|-------|
| 1.10 | SUSPECTED | `botAdvisor.js:415,221,379` | Non-numeric `DEEPSEEK_TIMEOUT_MS` → `setTimeout(..., NaN)` immediate abort — every AI decision silently falls back |
| 1.11 | CONFIRMED | `clientLobbyUi.js:711-715` + `clientAccountIdentity.js:439-444` | Client control flow branches on exact English server strings ("Room is full.", /already taken/i) — copy edits silently disable retries |
| 1.12 | CONFIRMED | `clientNightShift.js:599-603` | `nightShiftRunStartAck` ignores all failures — rejected start gives no notice; run proceeds locally, score never recorded |
| 1.13 | CONFIRMED | `clientLobbyUi.js:846` | `leave-room` ack discarded — on rejection UI tears down while seat stays live (ghost player) |
| 1.14 | CONFIRMED | `socketSocialApi.js:175-183` | Account-achievement write catch rolls back with no logging — disk failure silently loses unlock |
| 1.15 | CONFIRMED | `server.js` (absence) | No SIGTERM/SIGINT handlers — deploys kill all in-memory games with no drain/notice |
| 1.16 | CONFIRMED | `server.js:69-75` | `app.get('*')` returns index.html 200 for every unmatched path (incl. missing assets) — masks 404s |
| 1.17 | SUSPECTED | `main.js:829` + `clientRoomShare.js:44` | `copyRoomCode` async used as click listener with no catch; no global rejection handler — silent unreportable rejection |
| 1.18 | SUSPECTED | `serverSocketAccount.js:406-417,250-263` | Join/create move seats before ack; mid-sequence throw acks failure while membership half-migrated — client stranded between rooms |

**Summary:** two P1 availability/state-loss paths — unguarded timer seams escalate game-logic throws to process exit for all rooms, and client wipes stored sessions on transient restore failures. P2s cluster on lost partial-failure context. Positives: safe-emitter acks, atomic storeIO+quarantine, requestId retries, `emitWithTimeout`, AI circuit breaker.

---

### 2. Concurrency & Race Conditions

Server handlers are synchronous, so duplicate-event storms are serialized; surviving races are timers, the async AI advisor seam, and client render/ack interleaving.

#### P1

| # | Status | Location | Race | Fix |
|---|--------|----------|------|-----|
| 2.1 | CONFIRMED | `server/rooms.js:735-750` | **Restore-session hijacks a live seat**: `restoreConnection` transfers `player.socketId` even when old socket is live/undisconnected (join has `seatUnavailable` guard, create has `seatIsLiveOnAnotherSocket`, restore has neither) — two sockets can flap one seat by replaying restore | Reject when `player.socketId !== socketId && !player.disconnected` |
| 2.2 | CONFIRMED | `clientMarketUi.js:161-172` (+ `clientRailEvents.js:122-166`, `clientCasinoUi.js:114-157`, `clientWalletUi.js:181-213`) | **Snapshot re-render destroys DOM pending state; fresh requestId per click defeats server idempotency**: `update-state` rebuilds button mid-flight; second click emits NEW requestId → market/casino/loan executes twice | Module-level pending intent + stable requestId until ack/timeout |

#### P2

| # | Status | Location | Race | Fix |
|---|--------|----------|------|-----|
| 2.3 | CONFIRMED | `server/auctionApi.js:72-87,89-96` | **Bid accepted after deadline**: `auctionTimingRejection` never checks `now >= endsAt`; late timer + bid → success, deadline reset +5s | Reject bids past `endsAt` |
| 2.4 | CONFIRMED | `socketRuntime.js:586-598,491-505` | **Bot bids extend `endsAt` but never reschedule finish timer**; `finishAuctionIfStillActive` doesn't check `endsAt` — sale closes early while client countdown shows time left | Reschedule on bot bid + verify `Date.now() >= endsAt` |
| 2.5 | CONFIRMED | `clientLobbyUi.js:146-154` + `main.js:1035` | **Stale previous-room snapshot mistaken for entry ack**: while entering room B, room A broadcast cancels entry attempt and applies A's code/hostId; real B ack discarded | Gate reconcile on requested room match |
| 2.6 | CONFIRMED (AI mode) | `socketRuntime.js:507-509,487-490` | **Duplicate bot auction decisions**: timer entry deleted before `await botAdvisor.chooseAction`; human bid during await re-arms timer for same bot → two decisions hit `runBotAction` | Hold timer/lock until decision settles |
| 2.7 | SUSPECTED | `serverSocketAccount.js:110-113` + `socketRuntime.js:600-608` | **Join during disconnect grace rejects seat's own owner**: `scheduleDisconnect` doesn't set `disconnected`/null socketId (only expiry does) — join path says "seat already in use" until 10s expiry | Treat past-deadline/dead-socket seat as reclaimable |

#### P3

| # | Status | Location | Race | Fix |
|---|--------|----------|------|-----|
| 2.8 | CONFIRMED | `globalEventsApi.js:305-315` + `gameLogic.js:1095-1126` | Votes/mutations accepted after game end: `endGame` doesn't clear `globalEvent`, vote guard lacks `started` check — activation settlements applied to dead game | Clear event on endGame / guard `started` |
| 2.9 | CONFIRMED | `clientStateSync.js:413-414` + `main.js:573-626` | Every snapshot clears `busy`/`rolling` while ack pending — duplicate roll on doubles consumes extra roll; jail buttons re-enable | Derive busy from in-flight counter |
| 2.10 | SUSPECTED | `rooms.js:758-777` | `restoreAccountSeat` claims first disconnected room by Map order, not recency — wrong game's seat reclaimed after tab restart | Prefer most recent / explicit hint |
| 2.11 | SUSPECTED | `socketRuntime.js:370-387` + `botLogic.js:684-700` | GC can destroy room mid-decision; async advisor continuation mutates zombie (post-await guards check identity, not `room.destroyed`) | Add `destroyed` check |

**Summary:** two P1s — live-seat hijack via restore-session (reproduced) and systemic client double-submit class (snapshot clobber + fresh requestIds). Timer races (auction deadline, bot reschedule) and client ack/render interleavings dominate P2. Coverage gaps: no tests pin restore-while-live, bid-after-deadline, bot-bid reschedule, pending-button clobber.

---

### 3. Internationalization, Formatting & Time

#### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 3.1 | `clientSocialSurfaces.js:360,369,653,1075,1171` | Raw UTC ISO printed verbatim (`EXPIRES 2026-09-12T14:30`, `slice(0,16)` timestamps) while `clientProfileRender.js:167` localizes the same match — same match shows as `2026-09-12` and `SEP 12`; invite times hours off | One shared date/time formatter |
| 3.2 | `clientCasinoUi.js:59`, `clientCasinoReel.js:35`, `clientRailRender.js:128-129`, `clientProfileRender.js:233-234,410-413` | Sign only prepended when value ≥0 — losses render `$-1,250` while `clientWalletUi.js:89` uses `−$1,250` | Sign before `$` in one formatter |
| 3.3 | 104 raw `` `$${...}` `` vs 64 `toLocaleString()` sites (e.g. `clientGameModalsUi.js:59,266,269`, `clientTradeUi.js:404-449,1198`, `clientCardsRender.js:25-26`, `clientHudRender.js:311`) | `$12500` and `$12,500` side by side (debt modal, financing previews, card payouts) | Centralize money formatting |
| 3.4 | `clientProfileRender.js:119,167`, `clientSocialSurfaces.js:613`, `server/rooms.js:623` | Host-locale formatting inside `lang="en"` UI; `rooms.js:623` uses Node env locale to pre-format directory BANK string — de-DE renders `$12.500`, pre-formatted strings can't be re-formatted client-side | Pin `en-US` helper; send raw numbers |
| 3.5 | `clientHomeEntryBindings.js:25,81,95`, `clientSanitize.js:154,161`, `server/roomSetup.js:41` | Alias/room inputs ASCII-stripped `[A-Z0-9 _-]` while account names accept Unicode — "José"→"JOS", Cyrillic/CJK names mangled | Stop ASCII-stripping; length-only validation |
| 3.6 | 117 server `feedMessage` sites (e.g. `economyApi.js:200`, `auctionApi.js:96,218`, `loanLogic.js:140`, `propertyApi.js:113`, `gameLogic.js:907`) | Raw integers in chat ("won $12500") disagree with grouped HUD | Shared server money formatter or send numbers |

#### P3

| # | Location | Issue |
|---|----------|-------|
| 3.7 | ~332 `error:` literals (`auctionApi.js:81-85`, `contractLogic.js:52-56`, `accountStore.js:556`) | User-visible errors are English prose, not codes; clients print verbatim — localization/error-specific UI coupled to wording |
| 3.8 | `clientAccountIdentity.js:64-73,100` | "30-day" filter compares server `unlockedAt` vs raw client `Date.now()` despite tracked `serverTimeOffset` — skewed clocks see empty/stale filters |
| 3.9 | `clientSocialSurfaces.js:613` | Leaderboard freshness shows only `SYNCED hh:mm` — yesterday reads as current |
| 3.10 | `clientHomeAmbient.js:31` vs `clientSocialSurfaces.js:613` | Home clock pinned `en-GB` 24h vs host-locale social time — mixed conventions |
| 3.11 | `clientAuctionUi.js:144,164,185`, `clientHudRender.js:212` | Countdown copy hardcodes "5.0s"/"5s" (duplicates `AUCTION_MS`) and `toFixed(1)` always uses "." |
| 3.12 | `clientCosmetics.js:95` vs `clientWalletUi.js:62` | Token costs raw (`1200 TOKENS`) in collection preview but grouped elsewhere |
| 3.13 | `clientSocialSurfaces.js:653,707` | Season dates shown as bare `YYYY-MM-DD` with no zone — boundary day off near rollovers |

**Verified clean:** all season/week/window math is epoch/UTC; zero `getDay/getMonth/getHours`; no DST-sensitive getters; filenames case-safe; RTL not attempted.

**Summary:** no P1 (app intentionally en-only) but zero formatting layer — same balance differs by panel and browser locale. Server time math UTC-consistent; defects are presentation. Highest leverage: one `formatMoney`/`formatDateTime` module + stop ASCII-stripping names.

---

### 4. Browser & Platform Compatibility

#### P1

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 4.1 | CONFIRMED | `styles.css:3984` (+:581,:2791,:2813) | 16px form-control floor exists only in ≤1279px blocks; base `.field` 13px — iPad Pro 12.9"/13" landscape (1360–1376px) gets Safari auto-zoom on every input focus | ≥16px fields unconditionally |
| 4.2 | CONFIRMED | `styles.css:3742` (+:2529,:2028,:2218,:3766,:3870,:3972) | Entire iPad landscape block (dvh, safe-area, touch-action, 44px targets) capped at 1279px while base keeps `height:100vh` — large iPads get bottom clipping under home indicator + double-tap zoom | Raise cap ~1400px or key on `(pointer:coarse)` |

#### P2

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 4.3 | CONFIRMED | `main.js:214,211-226` | `AudioContext` lazily created but never `resume()`d — iOS/Chromium autoplay policy silences all SFX for returning users with sound ON | One-shot pointer/key gesture resume |
| 4.4 | SUSPECTED | `index.html:614` + `styles.css:2529,3853` | No `visualViewport` handling — iPad keyboard covers focused chat/stake input inside `overflow:hidden` shell, no scroll path | visualViewport resize/scroll handling |
| 4.5 | SUSPECTED | `styles.css:3972,3989` (+:542) | `touch-action:manipulation` + hover resets only in ≤1279px block — large iPads/Windows touch get double-tap zoom and sticky `:hover` | Hoist out of width-gated block |
| 4.6 | SUSPECTED | `clientKeyboard.js:252`, `clientSurfaces.js:125` | `Array.prototype.at(-1)` no polyfill, no build — Safari 15.0–15.3 throws every keydown, killing Escape/Tab traps | `arr[arr.length - 1]` |

#### P3

| # | Status | Location | Issue |
|---|--------|----------|-------|
| 4.7 | CONFIRMED | `styles.css:387,394,2550,3181-3185` | `:has()` without fallback — Safari <15.4/Firefox <121 lose pill styling + metro overflow fix |
| 4.8 | CONFIRMED | `styles.css:1055,1058,1084` | `color-mix()` no fallback — card accents/rail glow vanish on Safari <16.2/Firefox <113 |
| 4.9 | CONFIRMED | `styles.css:1324` (+cqw :1371-1420) | `container-type:size` + `cqw` — Safari <16 drops clamp() (tile names/prices inherit wrong sizes) |
| 4.10 | CONFIRMED | `styles.css:1321,1141` | `aspect-ratio` no fallback — Safari <15 board can collapse |
| 4.11 | CONFIRMED | `clientSurfaces.js:82`, `clientSocialSurfaces.js:424` | `inert` no feature detection — Safari <15.5/Firefox <112 focus escapes behind modals |
| 4.12 | CONFIRMED | `styles.css:3392,2734,2867` | Unprefixed `appearance:none` — Safari <15.4 native slider chrome |
| 4.13 | CONFIRMED | `clientDom.js:12` | `window.matchMedia?.(…).matches` guards call not property read — throws where matchMedia absent |
| 4.14 | SUSPECTED | `styles.css:22-27,146,129` | Silkscreen TTF-only 400 weight used at `font-weight:700` + `-webkit-font-smoothing:none` — faux-bold in Edge/Firefox |
| 4.15 | SUSPECTED | `index.html:104-107` + `clientNightShift.js:304` | No `-webkit-touch-callout`/`user-select:none` — iOS long-press pops share sheet mid-Night-Shift |
| 4.16 | SUSPECTED | `styles.css:139-148` | No `overscroll-behavior` on shell — iPad rubber-band shifts fixed layers |
| 4.17 | SUSPECTED | `main.js:253` | No `pageshow`/`pagehide` — bfcache restore keeps suspended AudioContext + stale socket |
| 4.18 | SUSPECTED | `styles.css:2194,3028,3052` | `filter: blur(3px)` + drop-shadows on large layers — Safari GPU jank while theme layers animate |
| 4.19 | CONFIRMED | `styles.css:2960,3018,3264,3294` | `scrollbar-gutter:stable` ignored on Safari <18.2 — list shift |

**Verified clean:** no backdrop-filter/transform-box/structuredClone/crypto.randomUUID/findLast; mask prefixed; dvh paired; viewport-fit=cover; font-display swap; reduced-motion/forced-colors handled.

**Summary:** both P1s share one root cause — iPad compat block stops at 1279px, so 1360–1376px iPads lose 16px floor, dvh, safe-area, touch-action. Highest-value non-CSS: never-resumed AudioContext.

---

### 5. Observability, Logging & Developer Ergonomics

#### P1

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 5.1 | `public/main.js:1` (whole client) | 52 production client modules contain zero `console.*`, no global error listener, no client→server telemetry; 35 bare catches swallow failures — user reports leave no stack/state/session id | Client error hook + batched error report |
| 5.2 | `server/server.js:70-75` | No admin/inspect/replay surface; room state in-memory; no room lifecycle events logged — a stuck room can't be inspected after the fact | Token-gated `/debug/room/:code` + structured lifecycle logs |

#### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 5.3 | `server.js:109,125,133-138` (18 calls, 5 files) | Raw `console.*` strings — no levels, timestamps, JSON | Leveled logger (or pino) + `LOG_LEVEL` |
| 5.4 | `server.js:78` + `socketHandlerSupport.js:130` | No correlation: HTTP 500 logs message only (no method/path/req id); handler failures lack socketId/room | Request ids + context in logs |
| 5.5 | `server.js:109` vs `socketRuntime.js:711` | Verbosity inverted: connects logged, but auth failures, rate-limit rejections, settlement, truncation/quarantine are silent | Log failures at warn/error; demote connects |
| 5.6 | `.github/workflows/ci.yml:9` | No concurrency group or job timeouts — duplicate full CI on rapid pushes, hung jobs burn 6h default | concurrency + `timeout-minutes` |
| 5.7 | `ci.yml:81-84` | Browser job writes traces/logs but no upload-artifact step (all gitignored) — CI failures need local repro | Upload on failure |
| 5.8 | `docs/DEVELOPMENT_WORKFLOW.md:38-45` | Doc says CI runs `test:full`; CI actually runs `test` + `coverage`, never `test:full`/`test:audit` | Wire it or fix doc |
| 5.9 | `ci.yml:25-26` + `coverage-runner.js:17` | Test job runs 52 suites then coverage re-spawns 31 + 8 audit — ~40% duplicated wall time | `c8 npm test` once / shared manifest |
| 5.10 | `eslint.config.js:29-47` | No `qa/**` block — `npx eslint qa` = 63 `no-undef` errors (4 spec files) nobody sees | qa block + wire into lint |
| 5.11 | `package.json:9,14-16` | No single-suite script, no watch, no per-suite timing, no `lint:fix`, `dev` == `start` (no `node --watch`) | Add `test:one`/watch/lint:fix/dev-watch |
| 5.12 | `.env.example` (absent) + `docs/production-hardening.md:9-19` | 17+ env vars split across docs, no dotenv/`--env-file` wiring, README silent | Commit `.env.example` |

#### P3

| # | Location | Issue |
|---|----------|-------|
| 5.13 | `package.json:1-5` | No `engines`/`packageManager`; README omits Node version (CI pins 22) |
| 5.14 | `eslint.config.js:1-3` | Stale comment says main.js "deliberately excluded" but it's linted clean |
| 5.15 | `package.json:1` | No `.editorconfig`/`jsconfig.json`/`@ts-check` — no shared EOL/indent policy, no editor type safety |
| 5.16 | `codecov.yml:11-13` + `ci.yml:30-36` | Patch informational, `fail_ci_if_error:false`, 2% project tolerance, no local `--check-coverage` — coverage can regress freely |
| 5.17 | `ci.yml:20` | Only `npm audit`; no Dependabot/Renovate |
| 5.18 | `server.js:124-126` | No `/healthz`/`/readyz`; CI smoke only greps HTML — listening ≠ functional |
| 5.19 | `DEVELOPMENT_WORKFLOW.md:33,57` | Claims Sentry runtime monitoring; no dependency/DSN exists |
| 5.20 | `main.js:868` + `clientGameModalsUi.js:349` | Debug hooks (`?preview=cards`, `?rules`, `POORUP_CAPTURE_VISUALS`) ungated and undocumented |

**Summary:** client is entirely silent (0 logs/0 error capture) and rooms un-inspectable; server logs unstructured/uncorrelated with inverted verbosity; CI lacks artifacts/timeouts/concurrency, omits QA lint, duplicates suites. Positives: no PII logged, safe-emitter guards solid.

---

### 6. Accessibility Deep-Dive — Dynamic States & Overlays

#### P1

| # | Location | Criterion | Issue | Fix |
|---|----------|-----------|-------|-----|
| 6.1 | `clientRailRender.js:314` | 2.4.3/2.1.1 | `renderRightRail()` rebuilds `#rr-body` via innerHTML every snapshot (~650ms with bots) — keyboard focus dropped to body mid-task (repay input, trade, casino/market) | Diff/patch or snapshot+restore focus |
| 6.2 | `clientDeedDetailUi.js:147` | 2.4.3 | `renderDeedDetail()` replaces card every `renderAll()`; no focus restore — BUY/SELL/MORTGAGE/CLOSE unreliable by keyboard during bot play | Update in place or refocus control |
| 6.3 | `clientSocketListeners.js:79` | 4.1.3 | Every bot decision writes `#hud-bot-status` (polite) AND `say()` into `#system-announcer` — near-continuous double polite speech with CPU seats | One throttled/merged bot channel |

#### P2

| # | Location | Criterion | Issue | Fix |
|---|----------|-----------|-------|-----|
| 6.4 | `clientWalletUi.js:208` | 2.4.3 | Wallet re-render each snapshot drops focus from tabs/rows/UPGRADE | Re-render only on data change |
| 6.5 | `clientDealUi.js:81` | 2.4.3 | Deal details re-render per snapshot destroys ACCEPT/DECLINE/NEGOTIATE focus | Re-render on content change + restore by key |
| 6.6 | `clientTradeUi.js:1086` | 2.4.3 | Financing mode tabs replace clicked button — focus to body on every LOAN/EQUITY/HYBRID switch | Refocus equivalent node |
| 6.7 | `clientSponsorshipUi.js:53` | 2.4.3 | Escrow update re-renders modal — typing contribution loses focus/caret when another player contributes | Capture/restore focused field |
| 6.8 | `clientMarketUi.js:164` | 2.4.3 | Focus restore by `id` only; `[data-market-advanced]` buttons have none — MARGIN/SHORT/OPTION focus lost per snapshot | Key on data attributes |
| 6.9 | `clientGlobalEventRender.js:130` | 2.4.3 | Vote choices re-created in live banner per snapshot — focused button removed during voting window | Update disabled/aria in place |
| 6.10 | `clientCasinoReel.js:203` | 2.4.3 | `prepareReel()` disables focused SPIN; `finishCasinoReel()` never focuses SKIP/restores | Focus SKIP on start, restore on end |
| 6.11 | `clientAuctionUi.js:224` | 2.4.3 | `disableAuctionBids()` can disable focused RAISE; 60ms tick never restores focus | Move focus to PASS/next enabled bid |
| 6.12 | `clientLobbyUi.js:322` | 2.4.3/4.1.3 | `paintSetupGrid` rewrites grid per snapshot — focus lost on chosen design + repeated aria-live re-announce | Repaint only on change |
| 6.13 | `clientStateSync.js:146` | 4.1.3 | Turn changes only repaint labels; with `turnTimer: 0` nothing announces whose turn it is | Announce on currentPlayerId change |
| 6.14 | `clientAuctionUi.js:185` | 4.1.3/2.2.1 | 5s countdown + low-time state visual only; `#auction-timer` has no role/live value | Expose coarse role=timer announcements |
| 6.15 | `clientHudRender.js:216` | 4.1.3 | `#hud-timer-announcer` rewrites every second — up to 120 polite announcements/turn | Announce thresholds only (30/10/5/3/2/1) |
| 6.16 | `main.js:384` | 4.1.3 | Error-ish messages written to BOTH polite and assertive announcers — every rejection spoken twice; `clientSocialSurfaces.js:50` same for parlorNotice | One channel per message |
| 6.17 | `clientNightShift.js:75` | 4.1.3 | Each hit updates live score AND status — "+100" announced twice (same `clientHomeAmbient.js:23-24`) | Remove aria-live from score |
| 6.18 | `clientCasinoUi.js:92` | 4.1.3 | Settled result written into still-live region then switched off; reel announces same result | One announcement channel |
| 6.19 | `clientNightShift.js:642` | 2.4.3 | `stopNightShift()` hides overlay while focused exit button inside — focus left on hidden element | Return focus on close |

#### P3

| # | Location | Criterion | Issue |
|---|----------|-----------|-------|
| 6.20 | `styles.css:2464` | 2.3.3/2.2.1 | `.auction-bar-fill` transition survives reduced-motion (broad reset misses it) |

**Verified solid:** all dynamic modals static `role=dialog`+aria-modal+labelledby; shared focus trap covers SURFACE_SELECTORS; casino reel honors reduced motion; board tiles/face cells real buttons; no drag-only interactions.

**Summary:** dialogs solid; systemic defect is full innerHTML rebuilds of open surfaces per snapshot (~650ms with bots) — fix focus preservation first. Second cluster: live-region hygiene (bot chatter, per-second timer, duplicate channels, dual polite+assertive) while turn changes and auction countdown are never announced.

---

### 7. Client Architecture & Module Boundaries

Import graph: 40 modules imported by main; **0 cycles**; 181 addEventListener vs 1 removeEventListener; 28/51 modules write `state` directly (321 write sites).

#### P1

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 7.1 | `clientState.js:133` | State ownership diffuse: `state.players` reassigned wholesale by 4 modules, `offers` by 5, `economy` by 4; no module can know what a write broke | Named mutators per slice + slice-key emit; ban direct writes |
| 7.2 | `clientSocketListeners.js:67` + `clientStateSync.js:424` + `main.js:542` | Two competing render paths: central `renderAll()` (17 renderers) + ~90 direct self-renders; socket handlers call 8 module renderers — render coverage by convention (root cause of round-2 4.16 stale social) | One `invalidate(sliceKey)` scheduler; listeners mutate only |

#### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 7.3 | `main.js:5-208,1001-1047` | Entry module = composition root + feature module (40 imports, 24 configure, 32 bind) and still owns player/chat/all renderers | Feature manifest consumed in a loop |
| 7.4 | `clientGameSave.js:8-9`, `clientAuctionUi.js:13`, `clientAudioControls.js:12`, `clientRoomsUi.js:17`, `clientGameModalsUi.js:17`, `clientLobbyUi.js:36-37` | Layering violations: UI modules import sibling features/snapshot internals directly (save→parlorNotice; auction→AUCTION_MS; lobby→stopAuctionTimer…) | Leaf constants + injected hooks |
| 7.5 | `main.js:341-345`, `clientLobbyUi.js:655,847,868`, `clientStateSync.js:375` | Feature-timer lifecycle has no owner — started by main's snapshot host, stopped by unrelated lobby modules | Per-feature lifecycle subscription |
| 7.6 | `clientLobbyUi.js:620-660`, `clientAccountIdentity.js:505-517` | Hand-maintained ~25-field reset lists on entry + partial reset on logout; new fields leak across rooms | Single `resetGameState()` from initial-state factory |
| 7.7 | `clientSurfaces.js:11-21` | Surface registration hardcoded 24-id list duplicating index.html and keyboard registries (already out of sync — #night-shift) | Derive from markup contract/manifest |
| 7.8 | 181 addEventListener vs 1 removeEventListener | Listener lifecycle relies on "innerHTML rebuild before rebinding" invariant; unguarded binders (`clientAuctionUi.js:168`, `clientPopupUi.js:246`, `clientKeyboard.js:322-325`, `clientPanelMenu.js:144-157`) | Stable-root delegation or idempotent bind guards |
| 7.9 | `clientSocialSurfaces.js` (1218 lines/91 KB), `clientTradeUi.js` (1468/73 KB), `clientLobbyUi.js` (1085/42 KB) | God modules re-emerging inside clean split | Split social into friends/rankings/rules/toast; trade into trade/finance |
| 7.10 | `clientNightShift.js:23,33` + `clientRoomsUi.js:20` | Hidden shared mutable state exported as live object (`nightShiftState`, `lobbyState`) read externally | Read-only accessors |
| 7.11 | `clientNightShift.js:741`, `clientState.js:123-138`, `clientDom.js:12` | Import-time side effects: DOM/storage/matchMedia I/O at module scope | Explicit `init*()` from main |
| 7.12 | `clientRailRender.js:376` + `clientSocialSurfaces.js:1000` | Renderers mutate state (`state.tab`, `state.rulesSection`) — render output depends on render order | Mutators own normalization |
| 7.13 | `clientStateSync.js:384-431` | "Pure snapshot syncer" orchestrates UI (renderAll, open/close surfaces, modals, countdown) — untestable without 8 fakes; blocks diffing | Return changed slices; main schedules |

#### P3

| # | Location | Issue |
|---|----------|-------|
| 7.14 | `main.js:1001-1047` | No shared host contract — 24 bespoke configure calls, per-module hook bags |
| 7.15 | `main.js:338-345` + `clientAuctionUi.js:50-53` | Auction ticker torn down/recreated per snapshot (60ms interval churn) |

**Summary:** split is acyclic/sane (clientState fan-in 39, clientDom 38) but shared mutable state (28 writers) + split render pipeline are load-bearing weaknesses. Wiring centralized by convention, not contract. Pressure points if features double: feature onboarding cost (main + registries), state collisions (stale/clobbered renders), per-snapshot rebuilds.

---

### 8. Server Architecture, Room Lifecycle & Scalability

#### P1

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 8.1 | CONFIRMED | `server.js:124-139` | No SIGTERM/SIGINT drain — deploys kill all in-memory rooms/timers/seats; reconnects hit "No active session found" | Graceful shutdown: stop accept, notify, drain timeout |
| 8.2 | CONFIRMED (repro) | `socketRuntime.js:261-271` + `rooms.js:323-344` | **Bot host takeover with no re-election**: last human offline >10s with bots → bot becomes host; start-game/settings host-only, bots never leave, GC won't reap → room permanently unstartable after human reconnect | Exclude bots + re-elect on reconnect |

#### P2

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 8.3 | CONFIRMED | `server.js:58-64` + `socketRateLimiter.js:1-26` | No connection-level admission (no `io.use`/allowRequest/max-clients); Express limiter disabled by default and engine serves before Express anyway — unbounded sockets before any per-event cap | Per-IP handshake throttle + connection budget |
| 8.4 | CONFIRMED | `socketHandlerSupport.js:74-85` + `serverSocketGame.js:99-107` | Rejected verbs still call `emitRoomState` — 24 rejects/s × roster × per-viewer summary = hundreds of full-state builds/s from one hostile socket | Broadcast only on state change |
| 8.5 | CONFIRMED | `server.js:94-102` + `backupStore.js:39-61` | Backup rotation fully synchronous (read/write/hash over all stores) every 15 min on main loop — stalls all sockets/timers at match-store cap | Off-thread/stream backup |
| 8.6 | CONFIRMED (repro) | `rooms.js:809-822` | Empty-room branch deletes registry directly instead of `destroyRoom` — `destroyed` never set, timer maps never cleared; stale timers accumulate per abandoned room | Funnel all removals through destroyRoom |
| 8.7 | CONFIRMED | `server.js:69-80` | No health/readiness endpoint; SPA fallback returns HTML 200 for every GET (404 middleware unreachable) — probes can't tell ready; asset misses masked | `/healthz`+`/readyz`; restrict fallback |
| 8.8 | CONFIRMED | `accountStore.js:451,494-495,575` | `sessions`/`sessionHashes` grow one entry per login forever, no TTL/cap; hashes persisted | Bounded LRU/TTL |

#### P3

| # | Status | Location | Issue |
|---|--------|----------|-------|
| 8.9 | CONFIRMED | `server.js:137-139` | `unhandledRejection` logs only vs `uncaughtException` exits — async settlement rejection keeps running with partial state |
| 8.10 | CONFIRMED | `socketHandlerSupport.js:105-117` + `server.js:108-121` | No onAny/unknown-event handling or negative ack — version-skew/probes hang 8s with no server signal |
| 8.11 | CONFIRMED | `socketRuntime.js:143-149` | Debounced `rooms-updated` emits full public directory to every socket (every 750ms under churn) — O(total sockets) fan-out for one surface |
| 8.12 | CONFIRMED | `socketSocialApi.js:71-84` | `socketsForAccount` linear-scans all sockets per social update (O(sockets×recipients)) |
| 8.13 | CONFIRMED | `rooms.js:726-801` | All room lookups linear-scan every room — join/restore latency grows with room count during reconnect storms |
| 8.14 | CONFIRMED | `gameLogic.js:170,256` + `contractLogic.js:342` | `playerContracts` append-only; terminal contracts filtered on every read — grows all game |
| 8.15 | CONFIRMED | `socketRuntime.js:874-875` | Two process-lifetime intervals never unref'd/exposed for teardown — embedded runtime leaks timers; shutdown can't stop them |

**Timer inventory:** backup (unref'd, process-lifetime); rooms-updated debounce (cleared on reschedule); turn/bot/auction-bot/auction/disconnect per-room (cleared by destroyRoom except leave-room bypass); botAdvisor fetch abort (cleared in finally). Positive caps: feed 40, telemetryLog 200, botDecisionTrace 200, casinoLedger 200/50, marketLedger 300, telemetry 5000, patrolRuns 2000, mythical keys 500, matches 500, season matches 1000.

**Summary:** biggest lifecycle risk = bot host takeover (permanently frozen room) + missing SIGTERM drain (silent restart loss). Biggest memory risk = unbounded connections + never-pruned session maps + per-game transaction maps. Pressure points: rejected-verb fan-out; synchronous backup + settlement; O(rooms)/O(sockets) linear scans.

---

### Cross-Category Top 10 (round 3)

1. **1.1 / P1** — Unguarded server timer seams: one game-logic throw during AFK/GC tick = `process.exit(1)` for all live rooms.
2. **2.1 / P1** — `restore-session` hijacks a live seat (reproduced) — two sockets flap one seat.
3. **2.2 / P1** — Client double-submit class: snapshot rebuild + fresh requestId = market/casino/loan executes twice.
4. **8.2 / P1** — Bot host takeover permanently freezes rooms (reproduced).
5. **1.2 / P1** — Transient auth failures wipe clients' stored sessions permanently.
6. **7.1–7.2 / P1** — Diffuse state (321 write sites) + dual render paths = stale/clobbered UI root cause.
7. **6.1–6.3 / P1** — Focus destroyed every ~650ms by full innerHTML rebuilds + double bot announcements.
8. **4.1–4.2 / P1** — iPad 1360–1376px compat cliff (focus-zoom, bottom clipping).
9. **5.1–5.2 / P1** — Zero client error observability + no room inspection path — user reports undiagnosable.
10. **8.1 / P1** — No graceful shutdown: every deploy destroys all live games.

---

#### Round 3 vs rounds 1–2
- Round 1: broad surface (dead code, docs, a11y static, perf basics, security baseline).
- Round 2: deep logic (market/contract/season exploits, debt lifecycle, persistence crash windows, test blind spots).
- Round 3: runtime dynamics (races, failure paths, architecture pressure points, platform floors, dynamic a11y, operability).
- Convergence signal: the **per-snapshot full-rebuild** theme appears independently in rounds 1 (perf 7.1), 2 (focus/state clobber), and 3 (state/render architecture + focus loss) — strongest candidate for a systemic fix.

---

## Master Priority Plan

Recommended fix order across all rounds (highest leverage first):

1. **P0 / R2 §7.1** — Reject horizontal-scale mode without a real adapter (or implement one).
2. **P1 money/fairness cluster** — option bounding (R2 §2.1), hybrid dilution (R2 §8.1), season percentile (R2 §8.2), debt-mode end condition (R2 §8.3).
3. **P1 stability cluster** — guarded timer seams (R3 §1.1), graceful shutdown (R3 §8.1), bot host re-election (R3 §8.2), restore-session live-seat guard (R3 §2.1).
4. **P1 integrity cluster** — split-write reconciliation for achievements/season claims; telemetry batching (R2 §7.2–7.4).
5. **P1 UX cluster** — leave-room confirmation (R1 §4.1), invisible confirm z-index (R2 §3.1), sponsorship reopen (R2 §3.2), chat scroll + message retention (R2/R3).
6. **Systemic render fix** — dirty-slice invalidation, incremental DOM updates, focus preservation (R1 §7.1 + R3 §6/§7) — resolves performance, a11y, and state-clobber symptoms together.
7. **Quick wins** — static `maxAge`+compression (R1 §7.4–7.5), debounce `saveGame`, append-only chat, backup checksum verification (R2 §7.6), QA lint block + CI timeouts/artifacts (R3 §5), 16px input floor + iPad breakpoint cap (R3 §4).
8. **Coverage** — fake-clock `socketRuntime` tests + `rooms.test.js` isolation (R2 §6.1–6.3); axe-core pass on key surfaces.

## Appendix — Methodology

- Three rounds, eight agents each (24 total), run as parallel read-only audits.
- Each round's agents were instructed to read prior rounds' reports first and report only NEW findings; severity-tagged with `file:line` evidence.
- CONFIRMED findings were reproduced via `node -e`/unit tests/isolated in-memory harnesses by the agents; SUSPECTED are code-path analyses.
- Destructive verification was not performed; no servers were started; no repository files were modified by auditors.
- Raw round reports were merged into this document on 2026-09-12; the standalone round files were removed to keep a single source of truth.
