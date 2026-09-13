# RR-39 — Release Triage: Consolidate & Verify Release Blockers

**Audit:** Release Readiness (40-agent) · Wave 4 · Mission RR-39 · 2026-09-12
**Mode:** READ-ONLY, no files modified.

**Verification basis:** `docs/audit/full-codebase-audit-2026-09-12.md` (1103 lines, read in full) cross-checked against disk and git. Parallel fix session: `d37b265` (22:43) genuinely fixed 8 P1s (ensureBots, roll-with-offer, leave-confirm, buy/pass HUD lock, offer dedup/pending, deed acks, decline/cancel confirm, sessionStorage guard, theme contrast/responsive). `b6cb9b4/cf83e49/becff0c` are CodeScene refactors; `b3599ee/59bdccd` are theme/complexity work. **No deep-logic or server-runtime P0/P1 was touched** — most remain OPEN.

## 1. Verified P0/P1 Status Table

| ID | Finding | File:line | Status |
|---|---|---|---|
| **R2 7.1** | P0: dummy `POORUP_POSTGRES_URL` passes horizontal-scale guard | `server/persistenceMode.js:8-15` | **OPEN** |
| R1 1.1 | Orphan 108-line client-state module | `public/client-state.js` | OPEN (exists) |
| R1 1.2 | Debug/golden dumps in production data dir | `server/data/__gold*.json`, `__dbg.json` | OPEN (exist) |
| R1 1.3 | 3.3 MB misnamed SVG | `public/assets/fonts/test` | OPEN (exists) |
| R1 1.4 | 11 unreferenced SVGs/woff2 | `public/assets/parlor-patrol/*` | OPEN (exist) |
| R1 1.5 | Never-instantiated registry classes | `boardRegistry.js:156`, `rulesetRegistry.js:243` | OPEN |
| R1 1.6 | ~9 dead exports | `clientSanitize.js:352+`, etc. | PARTIAL (`configureThemeRender` deleted; rest remain) |
| R1 2.1 | ensureBots capacity oversubscription | `rooms.js:521` | **FIXED** |
| R1 3.1 | Game grid broken 1280–1335px | `styles.css:2531` | **FIXED** |
| R1 3.2 | Nav missing 641–767px | `styles.css:2769` | **FIXED** |
| R1 4.1 | No leave-round confirmation | `main.js:822`, `clientLobbyUi.js:888` | **FIXED** |
| R1 4.2 | Buy/pass dismissible, "End Turn" re-enabled | `clientHudRender.js:87-116` | **FIXED** |
| R1 5.1 | Stale 40 KB audit doc citing deleted monolith | `docs/audit/room-patrol-bug-audit.md` | OPEN (exists) |
| R1 5.2 | Three 0-byte placeholder logs | `.impeccable/questions/*.log` | OPEN (exist) |
| R1 6.1 | Light theme focus 1.05:1 | `clientThemeData.js:190` | **FIXED** |
| R1 6.2 | Placeholder 2.64:1 | `styles.css:108` | **FIXED** |
| R1 6.3 | gold-800 1.60:1 | `styles.css:61` | **FIXED** |
| R1 7.1 | `renderAll()` full DOM rebuild per snapshot | `clientStateSync.js:424` | OPEN |
| R1 7.2 | Per-socket re-serialization, no compression | `socketRuntime.js:207` | OPEN |
| R2 1.1 | Triple Escape registry, 2/3 dead | `clientKeyboard.js:135-176` | OPEN |
| R2 2.1 | Client-controlled option strike + same-round exercise | `marketExpansion.js:241-242` | OPEN (still `payload.strike`, no banding) |
| R2 3.1 | Confirm dialog renders behind Deals card | `index.html:512` vs `:854`, `.popup` z-70 | OPEN |
| R2 3.2 | Sponsorship desk unrecoverable after dismiss | `clientSponsorshipUi.js:111` | PARTIAL (HUD relabel; reopens only on live event, not snapshot) |
| R2 4.1 | Chat forced to bottom every snapshot | `main.js:531` | OPEN |
| R2 6.1 | Order-dependent shared-server rooms tests | `rooms.test.js` | OPEN |
| R2 6.2 | Zero socketRuntime tests | `server/socketRuntime.js` (no test file) | OPEN |
| R2 6.3 | Coverage omits 22/61 suites | `coverage-runner.js` | OPEN |
| R2 7.2 | Achievement split-write | `socketSocialApi.js:162-182` | PARTIAL (throw-rollback added; crash window + retry loss remain) |
| R2 7.3 | Season claim persisted before grant | `serverSocketSocial.js:197-206` | OPEN |
| R2 7.4 | Telemetry fsync per event (~400/match) | `telemetryModule.js:85` | OPEN |
| R2 7.5 | 200 bot traces stored per match | `matchStore.js:177` | OPEN |
| R2 8.1 | Hybrid dilution past 100% cap | `contractLogic.js:137-143,488` | OPEN (live hybrids uncounted) |
| R2 8.2 | Percentile math grants top-1% to last place | `seasonModule.js:278,371` | OPEN |
| R2 8.3 | Debt mode never ends | `bankruptcyApi.js:40-60` | OPEN (`handleDebtBankruptcy` never concludes) |
| R3 1.1 | Unguarded timer seams → `process.exit(1)` | `socketRuntime.js:342,606,874`; `server.js:133` | OPEN (only `emitRoomState` internals guarded) |
| R3 1.2 | Transient auth failure wipes stored session | `clientSocketListeners.js:52-60` | OPEN (any non-success clears) |
| R3 2.1 | `restore-session` hijacks live seat | `rooms.js:735-750` | OPEN (unconditional `socketId` transfer) |
| R3 2.2 | Double-submit: fresh requestId per click | `clientMarketUi.js:198`, `clientCasinoUi.js:126` | OPEN |
| R3 4.1 | iPad inputs 13px (1360–1376px) | `styles.css:330/3984` | OPEN |
| R3 4.2 | iPad compat block capped at 1279px | `styles.css:3876` | OPEN |
| R3 5.1 | Zero client error observability | `public/*.js` (tests only) | OPEN |
| R3 5.2 | No room inspect/replay | `server.js:70` | OPEN |
| R3 6.1 | `renderRightRail` destroys focus per snapshot | `clientRailRender.js:314` | OPEN |
| R3 6.2 | Deed detail rebuild destroys focus | `clientDeedDetailUi.js:147` | OPEN |
| R3 6.3 | Bot status double-announced (label + `say`) | `clientSocketListeners.js:95` | OPEN |
| R3 7.1 | Diffuse state ownership (321 writes) | `clientState.js:133` | OPEN |
| R3 7.2 | Dual render paths | `clientStateSync.js:424` | OPEN |
| R3 8.1 | No SIGTERM/SIGINT drain | `server.js` | OPEN |
| R3 8.2 | Bot host takeover, no re-election | `socketRuntime.js:261-271` | OPEN (no `!isBot` filter) |

## 2. Fix Clusters

| # | Cluster | Items | Severity | Effort | Blocks release | Order |
|---|---|---|---|---|---|---|
| C1 | Config/persistence guard | R2 7.1 | P0 | S (1 file) | Yes | 1 |
| C2 | Session/seat lifecycle | R3 2.1, 1.2, 8.2 (+P2 grace join) | P1 (2↑P0) | M | Yes | 2 |
| C3 | Stability/ops | R3 1.1, 8.1, 5.2 (+healthz, 404) | P1 (1↑P0) | M | Yes | 3 |
| C4 | Economy exploits | R2 2.1, 8.1 | P1 (2.1↑P0) | M | Yes | 4 |
| C5 | Rules end-conditions | R2 8.2, 8.3 | P1 | M | Yes | 5 |
| C6 | Client action safety | R3 2.2, R2 3.1, 3.2 | P1 | S–M | Yes | 6 |
| C7 | Persistence integrity | R2 7.2, 7.3, 7.4, 7.5 | P1 | M | Partly (7.3) | 7 |
| C8 | Chat/UX/mobile | R2 4.1, R3 4.1–4.2 | P1 | S | No | 8 |
| C9 | Observability | R3 5.1 (+5.2 remainder) | P1 | S–M | No | 9 |
| C10 | Render/perf/focus architecture | R1 7.1–7.2, R3 6.1–6.3, 7.1–7.2, R2 1.1 | P1 | L | No (symptoms C6) | 10 |
| C11 | Test coverage | R2 6.1–6.3 | P1 | M | No | 11 |
| C12 | Dead weight/docs | R1 1.1–1.6, 5.1–5.2 | P1 | S | No | 12 |

## 3. Launch Tiers

**MUST-FIX (C1–C7 core):** C1 — a single env var silently destroys all accounts. C2 — live-seat takeover, session wipe, and frozen rooms hit every multi-user host. C3 — one timer throw kills every live room; every deploy wipes games. C4 — instant reserve drain and unrepayable lender loss corrupt the public economy. C5 — season rewards and debt-mode games end broken/never. C6 — money actions execute twice and confirm dialogs are invisible. C7 — paid season grants can be permanently lost (7.3); telemetry stall/footprint risk (7.4/7.5) ships with disclosure if slip.

**SHOULD-FIX (disclose/accept):** R2 4.1 chat scroll; R3 4.1–4.2 iPad; R3 5.1–5.2 observability; R2 7.2/7.4/7.5; R2 1.1 dead gate registry; R1 7.1/7.2 perf.

**POST-LAUNCH:** R3 7.1–7.2 architecture; R2 6.1–6.3 tests; R1 1.x/5.x dead code/docs; markdown merges.

**Docs-only fastest wins:** R1 5.1–5.2 (delete, S); R1 1.1–1.4 (delete, S); README/`.env.example` updates (P2).

## 4. Severity Reclassifications (public multi-user)
- R3 2.1 → **P0**: a replayed `clientId` transfers a live seat to any socket; seat/account integrity fails in public rooms.
- R3 1.1 → **P0**: one uncaught timer exception exits the process for all rooms (shared availability).
- R2 2.1 → **P0**: attacker drains the shared house reserve with zero cost.
- R3 8.2, R2 7.3, R3 2.2 remain P1 but are release-blocking (frozen rooms, lost paid grants, duplicate money actions).

## 5. Release Gate Checklist
1. `POORUP_HORIZONTAL_SCALE=true` without a real adapter **refuses boot**; multi-process JSON writes impossible.
2. `restore-session` for a seat whose socket is live/undisconnected is rejected.
3. No live-seat takeover path: two sockets cannot alternate one seat.
4. A throw in turn/AFK/disconnect/GC callbacks is caught per-room; process stays up and other rooms keep updating.
5. SIGTERM sends shutdown notice and exits cleanly; no "No active session found" after restart.
6. Option open+exercise cannot exceed quote-bounded strike/premium; house reserve delta is zero on open→exercise.
7. Hybrid conversion cap counts live pending conversions; failed conversion either seizes collateral or leaves debt repayable.
8. Last place cannot claim top-1%/gold rewards (3-row test).
9. Debt-mode 2p game reaches a winner, clears `inDebt`, conserves cash.
10. Double-click market/casino/loan executes exactly once (stable requestId until ack).
11. Decline/cancel-trade confirm is visible above the deal card.
12. Sponsorship desk is reachable on every snapshot until resolved — no hard-stall.
13. No unbounded room growth: bot-only rooms are GC'd; host is re-elected to a human or bots excluded.
14. 404 not masking assets: missing `/assets/*` returns 404, not index.html.
15. Typed chat is retained on rate-limit rejection; scrollback not yanked while bots act.
