# Multi-Agent Full Codebase Audit — 2026-09-12

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

## 1. Overengineering & Dead Weight

### P1 — Dead code (never runs, never loads)

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 1.1 | `public/client-state.js:1` | Entire 108-line module (incl. duplicated `applyServerState`, mirroring `clientStateSync.js:376`) imported only by `server/client-state.test.js`, which is in no npm script — stale predecessor kept alive by an orphan test | Delete module + test, or re-home the test onto `clientStateSync.js` |
| 1.2 | `server/data/__gold_matches.json`, `__gold_acct.json`, `__dbg.json` | ~19 KB debug/golden dumps referenced by zero files — commit artifacts, not fixtures | Delete, or move to a fixtures dir wired to a real test |
| 1.3 | `public/assets/fonts/test` | 3.3 MB SVG (header `<svg`) misnamed `test` in fonts folder, referenced nowhere | Delete or rename/move to assets/themes |
| 1.4 | `public/assets/parlor-patrol/README.md:24,30` | 10 unreferenced SVGs (`contrail-6-frames.svg`, `debris-6-frames.svg`, `helicopter-crash-12-frames.svg`, `spiral-trail-8-frames.svg`, `legacy-board-40.svg`, `legacy-board-40-user-source.svg`, `police-helicopter-10-frames.svg`, `board-icons/passing-by-tile.svg`, `board-icons/passing-by-poorup.svg`) + 3 unused `ibm-plex-sans-*.woff2` (no `@font-face`) — README admits they're "retained for reference" | Delete the 11 files (Plex Sans weights ship ~300 KB dead to every client) |
| 1.5 | `server/boardRegistry.js:156`, `server/rulesetRegistry.js:243` | `BoardRegistry` / `RulesetRegistry` classes never instantiated; production uses sibling free functions | Delete both classes |
| 1.6 | `public/clientSanitize.js:350-378` | 9 exports never imported (`PROFILE_KEY`, `LIBRARY_KEY`, `ACCOUNT_SESSION_KEY`, `GUEST_ALIAS_KEY`, `ACTIVE_DESIGN_KEY`, `SOUND_KEY`, `MUSIC_KEY`, `RULESET_PRESET_KEY`, `sanitizeAccountSession`) — same for `configureThemeRender` (empty "reserved seam", `clientThemeRender.js:26`), `clearThemeTransition` (`:146`), `marketLogic.js:8` (`MARKET_SIDES`, `MARKET_ORDER_GUARDS`), `marketExpansion.js:535-541` (`COMPLEXITY_RANK`, `OPTION_EXPIRY_MAX`, `SHORT_BORROW_FEE_RATE`, `complexityAllows`, `ensurePlayerMarketState`) | Drop dead exports |

### P2 — Duplication / dual config tables

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 1.7 | `server/roomSettings.js:8-154` vs `server/rulesetRegistry.js:7-11,71-106` | Two parallel vocabularies for one domain (`ROOM_RULESET_PRESETS` vs `RULESET_PRESETS`, re-listed override keys) — half-finished migration | Consolidate onto `rulesetRegistry`; `roomSettings` delegates |
| 1.8 | `server/boardRegistry.js:149-152` vs `server/rulesetRegistry.js:35-69` | `boardDefinition` re-hardcodes corners `[0,10,20,30]`/`[0,13,26,39]` and maxPlayers 4/6 that `BOARD_VARIANT_META` already owns | Import `BOARD_VARIANT_META` into `boardRegistry` |
| 1.9 | `server/rulesetRegistry.js:58-68` | `grand-64` variant (64 spaces, 8 players, `reserved`) exists nowhere else — speculative config for a board that cannot be created | Remove, or add the board |
| 1.10 | `public/clientBoardData.js:50-135` vs `server/boardRegistry.js:6-30` | 40 tile IDs + price/rent/group tables maintained in two copies — silent drift risk | Serve canonical table from server snapshot; keep only layout/paint client-side |
| 1.11 | `public/clientThemeRender.js:16-18` | `escAttr` re-implements the exact `&<>"'` map already exported by `clientDom.js:8` (`esc`) | Import `esc`, delete `escAttr` |

### P3 — Micro-overengineering / dead branches

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

## 2. Bugs & Correctness

### P1

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 2.1 | CONFIRMED (reproduced via node -e) | `server/rooms.js:521-544` (`ensureBots`) | **Game starts over capacity when humans fill all seats**: `canJoin()` counts humans only; `required = min(maxPlayers-1, bots)` doesn't subtract seated humans. 4-cap room with bots:1 + 4 humans starts with 5 players. `syncBotCapacity` only fires on maxPlayers *changes* | Clamp `required = Math.min(maxPlayers - humanSeats, bots)`; re-check on `addOrReconnectPlayer` |

### P2

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 2.2 | CONFIRMED | `server/gameLogic.js:561-575` + `public/clientHudRender.js:87-90` | Player can roll while a purchase offer is open (auction off) — rolling silently discards the offer, stranding the tile unowned; mid-auction roll can replace `this.auction` (bids lost) | Reject rolls while `pendingPurchaseOffer`/`auction`/`pendingSponsoredPurchase` are open in `rollTurnRejection` |
| 2.3 | CONFIRMED | `public/clientState.js:128` | Bare `sessionStorage.getItem` at module scope — blocked-storage browser (private mode, sandboxed iframe) throws SecurityError and kills the whole client before any UI renders. Every sibling read/write is wrapped | Wrap in try/catch with existing generated-id fallback |
| 2.4 | CONFIRMED | `public/clientSocketListeners.js:234-240` (`onTradeOffer`) | `state.offers` grows one entry per counter/adjust; stale entries never deduped (accept removes only exact object; `findDeal` can present stale terms of a cancelled/advanced trade) | Replace-with-dedup by `trade.id`; drop entries absent from snapshot |
| 2.5 | SUSPECTED | `server/socketRuntime.js:284-306` (`detachStartedSeat`) | Room switch mid-game marks seat disconnected without clearing table obligations or scheduling a timer (unlike `expireDisconnectedSeat`); pending deal can block `endTurn` for the current player until the 180s AFK watchdog | Call `clearPendingObligations` + cancel-purchase cleanup at detach |
| 2.6 | SUSPECTED | `server/marketExpansion.js:203,225` | Short borrow fee (1%) accrued but never collected from cash — `coverShort` subtracts it only from displayed PnL; shorts are 1% cheaper than disclosed | Deduct accrued borrow fee from cash at cover (+ in `forceShortBuyIn`) |

### P3

| # | Status | Location | Issue | Fix |
|---|--------|----------|-------|-----|
| 2.7 | CONFIRMED | `server/cardApi.js:100-105` | Card movement onto Start ignores the `doubleGo` rule (cards always pay $200; rolling exactly onto Start pays $400) | Honor `settings.doubleGo` when card destination is Start and movement wrapped |
| 2.8 | CONFIRMED | `public/clientThemeData.js:35-178` | `motion.durationMs` is dead data; spring's value (11000ms) contradicts real CSS (petals fall 14s); `theme-prop-weather-petal` 11s keyframe never applies (spring uses `petals` slot) | Consume `motion.durationMs` in `imageMarkup` or delete the field; align spring value |
| 2.9 | CONFIRMED | `public/clientThemeRender.js:70-85` + `clientBoardRender.js:36-44` | Duplicated window-lighting skyline logic in two modules; `original` theme reuses the home skyline on the board (`skyline.board = BASE_SKYLINE`) instead of the client `BOARD_SKYLINE` | Give `original` a dedicated board skyline (or drop `skyline.board`) and share one generator |

**Summary:** Most critical = `ensureBots` oversubscription (reproduced: 4 humans + 1 bot in 4-seat room → 5 players). Biggest risk area = disconnect/room-switch lifecycle (`detachStartedSeat` leans on the 180s AFK watchdog). Coverage gaps: no test pins `ensureBots` against full seats, no roll-with-open-offer test, no `state.offers` dedup test, theme tests don't pin CSS-duration sync or skyline selection.

---

## 3. UI Bugs

### P1

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 3.1 | `public/styles.css:2523` | Game grid (`316px + minmax(600px,1fr) + 360px` + gaps ≈1336px) activates at `min-width:1280px` but needs ~1336px → at 1280–1335px `overflow:hidden` clips the right rail and the 1:1 board renders as a stretched 600×866 rectangle | Replace the `600px` center-track min with `minmax(0,1fr)` or raise breakpoint to ~1360px |
| 3.2 | `public/styles.css:2826` | `.home-nav` is `display:none` below 768px and only re-enabled at `≤640px` — between 641–767px all six nav destinations disappear | Extend the mobile re-enable rule to `max-width:767px` |

### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 3.3 | `public/styles.css:2545` | 5-column HUD at `≥1536px` has 900px min but the center track is ~800px → roll cell clipped, right rail cut 1536–1635px | `minmax(0,…)` tracks or move breakpoint up |
| 3.4 | `public/styles.css:1322` | `.board-holder.is-metro` forces `min-width/min-height:560px` with no reset below 768px → Metro 52 room scrolls horizontally on phones | Add `max-width:767px` reset (`min-width:0; min-height:0`) |
| 3.5 | `public/clientBoardRender.js:197` | Generated `board-skyline` always painted over the theme scene → double skyline on every non-original theme whose scene art already has its own horizon | Skip/dim center skyline when the active theme has a non-null board scene |

### P3

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

## 4. UX Bugs

### P1

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 4.1 | `public/main.js:793`, `clientLobbyUi.js:746` | Leaving a live round has **zero confirmation** on all four paths (brand logo, top-back, setup BACK, Escape) — mid-game exit silently forfeits seat + round. Only destructive action without a guard | Route room exits through `openConfirmModal` when `state.phase === "playing"` |
| 4.2 | `public/clientHudRender.js:87-127`, `clientGameModalsUi.js:135-139` | In non-auction mode, dismissing the buy/pass card leaves `pendingBuyTile` set while the HUD re-enables as "End Turn" — required buy/pass decision no longer obvious; clicking it produces a chat-only server rejection | Keep HUD primary disabled/relabeled "Resolve Purchase" while `pendingBuyTile != null` |

### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 4.3 | `public/index.html:574`, `clientStateSync.js:335-339` | Retire button keeps hard-coded "BANKRUPT" label, enabled for healthy players — reads as a broken status badge, not an action | Relabel "LEAVE"/"RETIRE"; swap label when forced debt pending |
| 4.4 | `public/clientGameModalsUi.js:239-242` | Game-over "Back to Lobby" calls `goHome()` → exits room entirely; room code lost | Rename to "Leave Table"/"Home" or implement real return-to-lobby |
| 4.5 | `public/clientDeedDetailUi.js:25,41,191,196` | House/sell/mortgage actions emit with empty `() => {}` acks → server rejections silently swallowed; tapping BUY HOUSE with no effect reads as a dead button | Ack with `emitWithChatError`-style handler + re-render on failure |
| 4.6 | `public/clientGameModalsUi.js:166-178` | Trade-offer Accept has no pending state; removes offer + closes modal before server confirms; rejection makes the deal vanish (chat line only) | Keep modal open with PROCESSING…; remove/close only on success |
| 4.7 | `public/clientDealUi.js:93-112` | DECLINE / CANCEL TRADE / CANCEL OFFER are single-click with no confirmation — misclick destroys negotiation | Gate through `openConfirmModal` |

### P3

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

## 5. Unnecessary / Stale Markdown

### P1

| # | Path | Action | Justification |
|---|------|--------|---------------|
| 5.1 | `docs/audit/room-patrol-bug-audit.md` (~40 KB) | **Delete** | Self-declared "historical record"; cites `main.js:8231` etc. against a monolith that no longer exists (main.js is now 927 lines) — 70+ dead line refs |
| 5.2 | `.impeccable/questions/2a082dfd.log`, `6d287f10.log`, `99bdcfa0.log` | **Delete** | Three 0-byte placeholder files |

### P2 — superseded plans / duplicates

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

### P3 — duplicates / tidy

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

## 6. Accessibility (WCAG 2.2 AA)

### P1

| # | Location | Criterion | Issue | Fix |
|---|----------|-----------|-------|-----|
| 6.1 | `public/clientThemeData.js:188` | 2.4.7 / 1.4.11 | Light theme `--theme-focus: #122e3a` ≈1.05:1 on all dark surfaces → focus outlines invisible | Set light `--theme-focus` ≥3:1 on all surfaces |
| 6.2 | `public/styles.css:108` | 1.4.3 | Original theme `--field-placeholder: #4f5a54` on `--surface-input: #061216` = 2.64:1 → all placeholders fail ("CREATE AN ALIAS", "ABC123") | Brighten placeholder token ≥4.5:1 |
| 6.3 | `public/styles.css:61` / `index.html:168` | 1.4.3 | Original `--gold-800: #3a382a` on panels = 1.60:1 → `[ C ]`/`[ B ]` t-micro hints unreadable | Light token ≥4.5:1 or restyle in gold-300 |

### P2

| # | Location | Criterion | Issue | Fix |
|---|----------|-----------|-------|-----|
| 6.4 | `public/clientThemeData.js:120-121` | 1.4.3 | Autumn small text fails: gold-400 3.46:1 (2.93:1 on raised — lobby heads, "TIME LEFT"), gold-500 2.43:1, placeholder 4.18:1 | Lighten Autumn gold-400/500 + placeholder |
| 6.5 | `public/clientThemeData.js:89,120` + `styles.css:74-75` | 1.4.3 | `--green-status`/`--red-bright` not theme-overridden: Summer 4.31:1/4.19:1, Autumn 4.42:1/4.29:1 — below 4.5:1 for 11–13px status labels | Per-theme green/red tokens ≥4.5:1 |
| 6.6 | `public/styles.css:720-725` | 1.4.3 | Home clock/score (gold-050, 22–40px) on light scenes ≈1.3:1 — statement selectors patched but `.home-local-time`/`.home-patrol-score` missed | Dark text+shadow overrides for spring/summer/light (≥3:1 large text) |
| 6.7 | `public/main.js:516-526` | 4.1.3 | `#chat-body` has no `aria-live`; player chat never reaches `#system-announcer` — SR users hear nothing when others chat | `aria-live="polite"` on chat feed or announce player messages |
| 6.8 | `public/styles.css:2085` | 2.5.8 | `.parlor-toast-close` 18×18px target < 24px minimum | Enlarge to ≥24×24 |
| 6.9 | `public/clientSocialSurfaces.js:727` | 4.1.2 | `.ranking-list` has `aria-label` without a role — label dropped by AT | Add `role="list"` or real `<table>` |
| 6.10 | `public/index.html:101` | 1.3.1 / 2.4.6 | `.home-patrol-hint` ("SHIFT+P · NIGHT SHIFT") is `aria-hidden`; SR status says only "STANDBY…" — trigger undiscoverable | Move hint into announced patrol status |

### P3

| # | Location | Criterion | Issue |
|---|----------|-----------|-------|
| 6.11 | `public/styles.css:2717` | 2.5.8 | Face-canvas cells min 20×20px < 24px on narrow screens |
| 6.12 | `public/styles.css:3840` | 2.4.11 | Profile sticky 68px header can obscure keyboard-scrolled focus — add `scroll-margin-top` |
| 6.13 | `public/index.html:103` | 2.1.1 | Helicopter fly-by button `aria-hidden` + `tabindex="-1"` — playable element unreachable; document Night Shift SR-equivalent |
| 6.14 | `public/clientTheme.js:28` | 4.1.2 | Redundant `aria-checked` + roving tabindex beside native `checked` — drop `aria-checked` |

**Summary:** 14 violations (3 P1, 7 P2, 4 P3). Worst themes: Light (focus 1.05:1) and Original (placeholder 2.64:1, gold-800 1.60:1); Autumn has most failing small-text pairs. Keyboard: **0 traps, 0 unreachable controls** — gaps are contrast + live-region only.

---

## 7. Performance

### P1

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 7.1 | `public/clientStateSync.js:416` → `main.js:541` | Every `update-state` snapshot calls `renderAll()` → full DOM rebuild (board grid, 8 player rows, 60-line chat, HUD, rails, setup) + `saveGame()`, per server event (bots act ~650ms) | Diff per-snapshot or rAF-debounce `renderAll` |
| 7.2 | `server/socketRuntime.js:201-215` | `broadcastRoomState` re-serializes a large per-viewer game summary (40 tiles, equity, players, feed, history) for *every* socket on every change, no compression | One shared snapshot per event (viewer-scoped fields as exception) + cache + compression |

### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 7.3 | `public/styles.css:221-227,302-316` | `theme-page-world` (fixed, opacity .25) never paused → ~14 concurrent full-screen animated GPU layers (~120 MB textures @1080p, ~500 MB @4K) | Pause/drop page-world stack when a view world is visible |
| 7.4 | `server/server.js:69` | `express.static` with no `maxAge`/`immutable` → every theme switch re-issues ~18-21 conditional requests | `maxAge: '1y', immutable: true` for `/assets/*`, keep index.html no-cache |
| 7.5 | `server/server.js:37-80` | No gzip/brotli: 222 KB styles.css, ~800 KB JS, 1.48 MB legacy SVGs ship raw | Add `compression` middleware |
| 7.6 | `public/main.js:516-532` | `renderChat()` rebuilds innerHTML of last 60 lines on every message (~25 call sites) | Append-only DOM (insert one node, drop oldest) |
| 7.7 | `public/main.js:558` + `clientGameSave.js:46-64` | `saveGame()` sync `JSON.stringify` + `localStorage.setItem` on every `renderAll()` while playing — blocking main thread multiple times/sec | Debounce 2–5s or write on turn/phase boundaries |
| 7.8 | `public/clientAuctionUi.js:52,94-103,263-275` | `tickAuction` every 60ms re-renders 6 sub-sections via innerHTML — 16 DOM rebuilds/sec for countdown-only data | Update only countdown text node per tick |
| 7.9 | `public/index.html:9` | Parser-blocking 155 KB non-minified socket.io client in `<head>` | Move to end of body with `defer` (min build if configurable) |

### P3

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

## 8. Security

No P0/P1 remotely-exploitable code-execution or account-takeover chain confirmed. CSP `script-src 'self'`, strict input allow-listing, server-authoritative money math.

### P2

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 8.1 | `server/serverSocketAccount.js:78-97` | Auth rate-limit keyed only on `socket.handshake.address` with proxy trust disabled → behind a reverse proxy one attacker locks *every* user out of account auth for 60s, repeatably | Key bucket on socket id + IP (+ account id when present) |
| 8.2 | `server/accountStore.js:388-498,568-571` + `clientSanitize.js:316-340` | Session tokens: 256-bit bearer secrets in plaintext localStorage, replayed on every event, never expire; persisted `sessionTokenHash` keeps them valid across restarts forever — any leak = permanent account takeover | Add expiry + sliding refresh TTL; rotate on `account-update`; revoke on password change |
| 8.3 | `server/server.js:58-64` + `main.js:281-292` | Raw passwords + session tokens sent in cleartext over `ws://`; nothing enforces/warns about TLS termination | Terminate TLS at proxy + HSTS; refuse cleartext credentials when `wss://` required |
| 8.4 | `server/httpRateLimiter.js:50-56` + `server.js:50` + `socketRateLimiter.js:3-19` | HTTP limiter disabled by default (`limit 0` → unlimited); socket limiter buckets by `socket.id` → fresh connection per message resets chat cooldown + event cap; no per-IP backstop unless env set | Enable IP-based HTTP limit by default; add per-IP socket buckets |

### P3

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

## Cross-Category Top 10 (highest leverage)

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