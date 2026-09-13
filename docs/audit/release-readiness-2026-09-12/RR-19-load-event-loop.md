# RR-19 — Load Behavior & Event-Loop Blocking

**Audit:** Release Readiness (40-agent) · Wave 2 · Mission RR-19 · 2026-09-12
**Mode:** READ-ONLY for repo files; short read-only benchmarks in temp dirs / against a local server on a spare port allowed (stopped when done).

Measurements run in temp dirs only; repo untouched (`git status` clean), test servers killed. Load test: 10 rooms × 3 humans + 3 bots, 40 s — 0 errors, ack p95 ≤ 5.3 ms. Findings below; fsync costs vary 3–12× run-to-run (10–74 ms), ranges reflect that.

## Findings (15)

- `[BLOCKER] server/telemetryModule.js:85 + socketRuntime.js:63-98` — every `record()` rewrites the whole ≤5000-event store with fsync+rename; measured 10–74 ms/write; one bot-heavy settlement issues up to ~435 writes (match-complete + ≤200 event log + ≤200 bot-outcome + ≤32 achievement + market/bankruptcy) → **4.5–30 s stall** — any match filling telemetryLog (~200 events); at 20 rooms every room freezes — buffer in memory, flush on timer/match boundary (or append-only, no per-record fsync).
- `[BLOCKER] server/socketSocialApi.js:175-187 + accountStore.js:642-654` — each first-time achievement during settlement calls `recordAchievement` → full accounts.json rewrite+fsync; measured **356–405 ms per unlock** at 78 MB, up to 32 candidates → +11–13 s — accounts.json > few MB / any multi-unlock match — collect unlocks and persist once after settlement.
- `[MAJOR] server/accountStore.js:455-457,595-616,731-743` — no global cap: 50 full match records/account; measured 43–78 MB at 200 accounts; `recordGameResults` persist **0.66–8.1 s**, login/profile/patrol writes 0.4 s+ — ~200+ active accounts, grows O(accounts × history) — cap matchHistory at 5–10, split files, append-only.
- `[MAJOR] server/server.js:93-102 + storeIO.js:15-36` — boot measured 520 ms (repo data) → **1049 ms** with 43 MB accounts/12 MB matches, plus a synchronous full backup at boot; scales to multi-second with sanitize-on-load — >500 matured accounts / GB-scale store = long restart outage — lazy/streamed load, skip full re-sanitize, back up after listen.
- `[MAJOR] server/socketRuntime.js:201-215` — `broadcastRoomState` scans ALL sockets (`io.sockets.sockets`) then builds per-viewer summaries; measured 0.06–0.08 ms/summary, **0.76 ms mean/2.79 ms max per 6-viewer fan-out** (metro-52, 20.7 KB/viewer); 10 rooms × 6 × 10 ev/s = 600 builds/s (~8% core), 20 rooms ~15% — >50 rooms or >10 ev/s/room — one neutral snapshot + viewer overlay cached per state version; `io.in(room).fetchSockets()` not global scan.
- `[MAJOR] server/gameLogic.js:220-229` — telemetryLog permits 200 entries/match, each replayed as its own full-file write at settlement (drives finding #1); measured 400 writes = **4.5–30 s** — every match with events/market/bots — aggregate into one settlement record or drop the per-event log.
- `[MAJOR] server/accountStore.js:768-800` — rankings recompute 15 stats per match record; measured **22.5 ms** for the 15-metric snapshot and 11.6 ms windowed at 200 accounts × 5 records — 2k accounts × 50 records ≈ 1 s blocking per rankings request — incremental standings on match record + per-season cache.
- `[MAJOR] public/clientStateSync.js:424 + main.js:546-565` — `renderAll()` + `saveGame()` on every snapshot; measured #board-grid rebuild **46.4 KB/766 elements = 2.2 ms mean, 4 ms p95**, HUD 11.3 KB/0.5 ms, page 5,051 elements (full-body 341.5 KB → 14–26 ms lower bound), 5.4 KB localStorage write/snapshot; bots ≈0.5–1.5 snapshots/s/room; auctions multiply; focus/caret loss already filed (R1 §7.1/R3 §6) — dirty-slice rendering, rAF-coalesce, debounce saveGame.
- `[MAJOR] server/matchStore.js:204-213` — every finished match sorts 500 records, stringifies+fsyncs whole matches.json; measured **101 ms at 19 MB** (250–741 ms across runs at 11.8 MB) — matches at cap (~500) — append-only per-match file or coalesced persist.
- `[MINOR] server/backupStore.js:39-61 + server.js:96-100` — sync read+sha256+write of every store every 15 min; measured 56–72 ms for matches (11.8–20 MB), ~0.5–1 s total at 78 MB accounts — infrequent, blocking — `fs.promises`/streamed hashing.
- `[MINOR] server/botLogic.js:585-714` — deterministic decision measured mean **0.27 ms, p95 1.05 ms, max 6.5 ms** (400 decisions, all systems on); AI path is async fetch (4 s timeout) so it delays only its room's turn — not a loop blocker — no action, keep circuit breaker/timeout.
- `[MINOR] server/socketRuntime.js:693-746 + rooms.js:779-807` — GC tick 1000 rooms 0.12 ms; `findRoomFor` 0.11 ms/lookup; `restoreAccountSeat` O(rooms×players) on reconnect — ~10k rooms — add clientId→room index.
- `[MINOR] server/matchHistoryAdapter.js:22-27` — merge measured **0.82 ms** (500-match scan + sort + 50 legacy) — fine at cap — none now, revisit if cap rises.
- `[MINOR] public/index.html:9 + boot assets` — parser-blocking ~155 KB socket.io client; load 577 ms/77 requests/1.16 MB, long task 60–119 ms; theme switch 4.7–11.5 ms sync, ≤16 theme imgs, 2–3 running animations, 0 long tasks headless — low-end/mobile browser — defer scripts, compression + maxAge.

## Bottleneck ranking (launch traffic: 20 concurrent rooms, bot/human mix)

| # | Bottleneck | Cost | Trigger |
|---|---|---|---|
| 1 | Settlement telemetry fsync storm (`telemetryModule`+`socketRuntime`) | 4.5–30 s loop freeze | any bot-heavy match end |
| 2 | Per-achievement accounts.json rewrites (`socketSocialApi`→`accountStore`) | +0.4 s × up to 32 | multi-unlock settled match |
| 3 | accounts.json growth + whole-file persist | 0.4–8 s per write; boots/restarts worse | ~200+ accounts |
| 4 | Per-viewer broadcast fan-out + client `renderAll` | 0.76 ms/room-event; 2–4 ms board rebuild/viewer | >50 rooms or 10 ev/s/room |
| 5 | matches.json persist per match | 0.1–0.7 s | matches near 500 cap |

## Safe concurrent-room guidance
Measured 10 rooms × (3 humans + 3 bots) is comfortably safe at steady state (0 errors, p95 ack ≤5.3 ms), so 20 rooms is fine **only while no match settles**. Each bot-heavy settlement freezes the single thread for seconds (two settlements serialize), so for launch either (a) cap concurrent bot-heavy tables at ~5–8 and yield/queue settlements one at a time, or (b) ship the telemetry/achievement batching first, after which 20 mixed rooms cost ~15% of one core and settle in tens of ms. Also: don't deploy/restart during traffic (boot freeze scales with accounts.json), keep `POORUP_DATA_DIR` on the fastest disk, and exclude it from real-time AV scanning — measured fsync alone was 10–70 ms per write.
