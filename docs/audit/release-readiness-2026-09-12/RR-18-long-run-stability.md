# RR-18 — Long-Run Stability (memory, timers, leaks)

**Audit:** Release Readiness (40-agent) · Wave 2 · Mission RR-18 · 2026-09-12
**Mode:** READ-ONLY. Single Node process, long-running live server; verify prior findings and find new leak/growth paths with concrete per-hour estimates where possible.

**Prior-audit verification:** room-destroy bypass at `rooms.js:809-822` **CONFIRMED**; telemetry per-record full-store fsync **CONFIRMED** (`telemetryModule.js:77-87`); two process-lifetime intervals **CONFIRMED** (`socketRuntime.js:874-875`); "unbounded session maps" **NOT reproduced** — `issueSession` revokes per-username before insert (`accountStore.js:485-498`), so `sessions`/`sessionHashes` are bounded by account count. Baseline measured: 100 bot-heavy live rooms ≈ 10 MB heap additional (≈100 KB/room, ~50 KB of it `botDecisionTrace`); process floor ≈72 MB RSS.

## Findings (14)

1. **[BLOCKER] `server/roomSetup.js:316` + `server/accountStore.js:260` + `server/matchStore.js:177`** — Every game persists up to 200 `botDecisions` (measured **583 B/decision → ~117 KB/record**) into each participant's 50-entry `matchHistory` AND the 500-entry match store. Rate: ~200 games/h × 4 humans ≈ **50-100 MB/h added to accounts.json**, per-account steady state up to **~6 MB**; whole-file sync `persist()` per game (~`accountStore.js:456`, `matchStore.js:204`) means a 1 GB accounts file is rewritten per settlement. Fix: strip `botDecisions` from account history (keep in matchStore or debug-only), cap record size, buffer writes.
2. **[BLOCKER] `server/telemetryModule.js:77-87` + `server/socketRuntime.js:63-97`** — Settlement emits up to ~200 logged + 200 bot + 32 achievement + market/bankruptcy events; each `record()` fsync+renames the whole ≤5000-event store. Rate: **~400-450 fsyncs per game; ~90 k fsyncs/h** at 200 games/h. Fix: buffer in memory and flush on interval/match boundary (known 2.7, still unfixed).
3. **[BLOCKER] `server/economyApi.js:100-103`; `server/contractLogic.js:81-85`; `server/socketRuntime.js:823-826`** — Per-game replay caches have **no cap and no cleanup** until `gameLogic.js:257/276` reset. Client mints a unique `requestId` per action (`public/main.js:432`), and cached results embed full economy snapshots (`economyApi.js:209-213`). Worst case: socket limiter allows 240 events/10 s → **86,400 entries/h × 5-10 KB ≈ 0.4-0.9 GB/h/socket**; benign long market game ~hundreds of entries. Fix: LRU cap (128) or clear on turn end; don't cache the economy snapshot in the replay value.
4. **[MAJOR] `server/socialStore.js:256-262` + `server/socketSocialApi.js:76-80,185-188`** — Each verified achievement calls `notifyAccount` → `addNotification` → `persist()` (whole social.json, fsync). Up to 32 unlocks × 4 players = **~128 full-file writes per game**; `notifications` map also grows one key per account forever (100-entry cap per account, no account cap). Fix: debounce persist, prune empty/stale notification maps.
5. **[MAJOR] `server/rooms.js:809-822`** — `leaveRoomByClient` deletes the registry entry directly, bypassing `runtime.destroyRoom`; turn/auction/bot/disconnect timers, `botDecisionLocks`, and mapping cleanup are skipped. With bots, the deleted room keeps acting (650 ms loop) until the 10-min GC; pending timers retain the room object. Rate: one room per leave-to-empty, ~100 KB retained ≤10 min each. Fix: funnel through `destroyRoom`.
6. **[MAJOR] `server/server.js:94-102`** — Backup rotation is fully synchronous (read+hash+write every store) on the main loop every 15 min; at matchStore cap (~58 MB) this stalls all sockets/timers (known 8.5). Fix: off-thread/stream backup.
7. **[MAJOR] `server/socketRuntime.js:874-875`** — AFK/GC intervals are not `unref`'d and handles aren't stored; shutdown/embedding can't stop them (known 8.15). Fix: keep handles + `unref()`.
8. **[MAJOR] `server/server.js:124-139` (absence)** — No SIGTERM/SIGINT drain; every deploy/restart destroys all live in-memory rooms, and no graceful reconnect notice (known 8.1). Fix: stop accepting, notify rooms, drain timeout.
9. **[MAJOR] `server/server.js` (absence)** — No leak observability: no `process.memoryUsage()` logging, no `/healthz`, no `--heapsnapshot-signal` guidance. You cannot see a weekend leak until OOM. Fix below.
10. **[MINOR] `server/socketSocialApi.js:42-59`** — `socialRateBuckets` keys are only deleted when the same key acts again after its 60 s window; idle accounts keep `accountId:action` + up to 30 timestamps forever. Rate: ~5-7 keys/account, ~200 B each → ~10-20 MB at 10 k accounts. Fix: periodic prune + LRU cap.
11. **[MINOR] `server/seasonModule.js:284-296`** — `persist()` trims disk to 12 seasons but `this.seasons` (Map) is never trimmed in memory; each season's `standings`/`claims` are uncapped (5000 only on load). ~14 MB/year at 10 k accounts. Fix: evict in-memory seasons to the same 12.
12. **[MINOR] `server/cosmeticCatalog.js:109,126-131`** — `account(accountId)` lazily creates a map entry for any account that calls `get-cosmetics`; live map uncapped (load caps 10 k), whole-file persist per claim/equip. Fix: cap/LRU + skip persist when unchanged.
13. **[MINOR] `server/achievementStore.js:153,171-184`** — Records map unbounded (account × achievement; ~50 max/account) and every unlock rewrites the whole file. Acceptable ceiling, but document as account-count-bound and buffer writes.
14. **[MINOR] `server/serverSocketAccount.js:24,91-95`** — `authAttempts` prunes only when size >10 k; stale per-IP entries linger until the next over-limit request. Fix: 60 s interval prune.

## Client long-session verdict
213 `addEventListener` vs 1 `removeEventListener` is **not** an accumulating leak: all binders run once from `bindEvents()` (`main.js:1058`), module-level document/window listeners are one-shot, and per-render listeners attach inside `innerHTML`-replaced subtrees (e.g. `clientDealUi.js:82`, `clientDeedDetailUi.js:182`). State is capped (`messages` 80 `main.js:400`, `log` 40 `main.js:441`, notifications 50 `clientSocketListeners.js:66`, offers pruned `clientStateSync.js:158`). Timers all have stop paths (`clientHudRender.js:165-173`, `clientNightShift.js:94-97`, `clientAuctionUi.js:51-58`); no AbortController is used, timeouts are one-shot with `settled` guards. Residual: `saveGame()` synchronous localStorage write on every `renderAll` snapshot (~650 ms with bots, `main.js:563`) and the 120/200 ms HUD timers — CPU churn, not memory.

## Stability budget

| Structure | Current cap | Recommended cap | Cleanup trigger |
|---|---|---|---|
| `roomManager.rooms` | none | 500 rooms / configurable | 10-min empty GC + destroyRoom on leave (fix #5) |
| `socketRoom` | 1/socket | — | delete on disconnect/expire/leave/destroy (verified; fix #5) |
| `account.matchHistory` | 50 records (~6 MB) | 25 records, no `botDecisions` | per game; strip detail at `updateMatchRecord` |
| `matchStore.matches` | 500 records (~58 MB) | 500, but stream/dedupe writes | per game; buffered persist |
| `telemetry.events` | 5000 | keep | interval flush, not per record |
| `achievementStore.records` | none (accounts × ~50) | keep, account-bound | buffered persist |
| `socialStore.notifications` | 100/account, map unbounded | prune empty maps, LRU 100 k keys | 1 h interval |
| `socialRateBuckets` | none | 10 k LRU | 60 s interval |
| `patrolRuns` | 2000 | keep | 60 s interval (not only on new run) |
| `mythicalAnnouncementKeys` | 500 | keep | insertion-order FIFO (verified) |
| `createRoomReplays` | 1000, 2 min TTL | keep | read/write prune (verified) |
| `authAttempts` | prune >10 k | 10 k | 60 s interval |
| `contractTransactions` | none | 128 LRU | turn end / game reset |
| `economyTransactions` | none | 128 LRU (no snapshot payload) | turn end / game reset |
| `botDecisionTrace` | 200 | keep, never persisted to account | match record build |
| `botAdvisor.decisionCounts` | 1000 | keep | insertion-order eviction (verified) |
| client `messages`/`log`/notifications | 80/40/50 | keep | verified |

## Smallest release mitigation set
(1) exclude `botDecisions` from account/match persistence and buffer all `persist()` calls behind a 5-15 s flush; (2) cap the three per-game replay caches at 128 LRU; (3) debounce social notification writes; (4) route `leaveRoomByClient` through `destroyRoom`; (5) add `/healthz` with `process.memoryUsage()` + room/socket counts and log heap every 10 min. With those, 100 rooms × a weekend ≈ tens of MB, not GB.

## When thresholds appear
100 MB RSS ≈ a few hundred settled bot games (~1-2 h busy); 500 MB ≈ ~4-8 k accumulated account history copies (~6-10 h at 200 games/h); 1 GB ≈ 24-48 h of bot-heavy traffic — or **1 h** if a single rate-limit-maxed socket fills `economyTransactions` (fix #3).
