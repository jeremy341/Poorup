# Poorup — Release Readiness Audit — 40 Agents — 2026-09-12

Full release-gate audit of `C:\Users\jerem\Documents\GITHUB\Poorup` executed as **40 parallel read-only missions across 4 waves**: release blockers (404/error pages, account deletion, legal, security, config), security/reliability sweeps, UX/mobile/copy polish, and final verification/consolidation.

**Important workspace note:** during Wave 4 the checkout was switched by a parallel session (`main → codex/codescene-cleanup → codex/seasonal-theme-ui → codex/codescene-cleanup`). The audit spans two disk states:
- **State A — `main @ e64b174`** (intended release target): 52-suite `npm test` ✅ 269s, `test:audit` 9/9 ✅, lints clean ✅, coverage 90.08% ✅, Playwright 166 passed / 0 failed ✅.
- **State B — `codex/codescene-cleanup @ 71654c6`** (current disk): 44-suite `npm test` ✅ 219s, audits 9/9 ✅, lints clean ✅, Playwright 99 passed / 0 failed ✅.

Tests are green on both, but **pin the release SHA before gating** (RR-31). No code was changed by this audit.

Severity: **BLOCKER** (must fix before public release) / **MAJOR** / **MINOR**. Status reflects disk state at audit time; a parallel fix session already fixed some prior findings (marked FIXED).

---

## Executive Summary — Verdict: **NOT RELEASE READY** (conditional friends-beta GO with fixes)

The happy path works: on `main`, all 52 unit suites, 9 audit suites, 166 browser tests, and both lints pass; a desktop friend with a shared link can join, play a full default-rules round, and finish — **except after a rematch (non-host players get stuck) and with several silent money/lifecycle defects in opt-in systems**. The release blockers are concentrated in six clusters:

1. **Legal & data rights are entirely absent** — no privacy policy, no terms, no account deletion, no data export, no retention statement, no contact/support surface. A hosted app storing credentials, match history, social graphs, and processing IPs ships with zero notices.
2. **Release mechanics aren't ready** — the branch cannot merge cleanly into `main` (8 conflicts), version is `0.0.0`, no tag/changelog/deploy runbook, live demo serves an older build, no CI artifacts/timeouts, branch unpushed.
3. **Availability & lifecycle defects** — one uncaught timer throw kills all rooms (`process.exit(1)`), no SIGTERM drain (every deploy wipes live games), `restore-session` can hijack a live seat, bot host takeover permanently freezes rooms, rematch strands non-host players.
4. **Money/fairness exploits & sinks** — client-controlled option strike with same-round exercise drains the house reserve ($45k reproduced), hybrid note dilution destroys lender principal, season percentile grants top-1% rewards to last place, debt-mode games can never end.
5. **Persistence & integrity** — horizontal-scale guard accepts a dummy Postgres URL (silent cross-process data destruction, P0), backup `verifyBackup` ignores its checksum, no-op backups when `POORUP_DATA_DIR` is unset, season-claim crash window loses paid rewards, telemetry fsync storm stalls the event loop seconds per match.
6. **Release hygiene on the webroot** — SPA catch-all masks 404s and missing assets, 4.9 MB dead payload (3.3 MB mystery font file, 1.5 MB legacy boards), no compression (1.1 MB → 250 KB gzip), no cache headers, 12.3 MB music, zero client-side error observability, no health endpoint.

**Fastest wins:** legal/docs/deletion (server cascades + a policy page), branch merge & tagging, 404 handling, compression + cache headers + dead-asset purge, timer guards + SIGTERM, and the six small exploit fixes (bounded option pricing, session TTL, seat-liveness guard, season percentile, debt-mode end, remote-history projection).

---

## Wave 1 — Release Blockers (RR-01 … RR-10)

### RR-01 — 404 & Error Pages — verdict: **NOT READY**
- **[BLOCKER]** `server/server.js:70-75` — SPA catch-all returns `index.html` 200 for every unmatched GET: missing `/assets/*`, `/themes/*`, `/favicon.ico`, random paths. 404 middleware only reachable for non-GET. Monitoring/probes/asset consumers all get fake 200s.
- **[MAJOR]** `server/server.js:76-80` — landing a real 404 yields bare `text/plain` "Not found."; no branded 404/500 pages, no "back to parlor" link, no content negotiation.
- **[MINOR]** No `robots.txt`/`sitemap.xml`; no `<noscript>` fallback (`index.html` sticks on "CONNECTING…" without JS); `showView()` (main.js:665) blanks all views on an unknown name (default to home); no image `onerror` fallbacks; `assets/board-icons/index.html` authoring page ships on the webroot; stale invite rows stay JOIN-able after room GC.
- Verified clean: invalid room codes → toast + recovery; expired invites reject; theme assets all resolve; no raw JSON/HTML in toasts.

### RR-02 — Account Deletion — verdict: **BLOCKER (feature absent)**
- **[BLOCKER]** No delete-account anywhere: zero `delete-account|close-account|deactivate` implementation matches across UI, socket, store, HTTP. `accounts.json` retains password hash/salt, 50 match records, social graph indefinitely.
- **[MAJOR]** No store-level purge APIs: account (sessions/hashes), social (friendships/blocks/invites/reports/notifications), matches (plus every *other* participant's history embedding the deleted ID), achievements, seasons standings/claims, cosmetics — all would orphan.
- **[MAJOR]** Deleting while seated is undefined; local `poorup.*` keys survive logout (only the session key is cleared).
- **[MAJOR]** Destructive-confirm pattern is generic; no password re-entry / typed confirmation for account-scale destruction.
- **[MINOR]** Backups keep 7 rotations of erased data; deleted IDs still affect mutual-friend counts/block checks until purged; no privacy/retention/erasure-contact docs.

### RR-03 — Legal & Compliance Pages — verdict: **NOT RELEASE-READY**
- **[BLOCKER]** No privacy policy page/route/link (`/privacy` falls through to the game) while the app stores usernames, scrypt hashes, session tokens, avatars, stats, match history, friendships, reports, and processes IPs in-memory.
- **[MAJOR]** No ToS/AUP despite free-text chat + player reporting; no age/content statement for gambling-adjacent mechanics (fictional currency); no retention documentation; no contact/operator identity anywhere in UI or docs.
- **[MINOR]** No cookie disclosure needed (zero cookies — verified) but localStorage keys undisclosed; DeepSeek as undisclosed subprocessor; OFL font license texts not shipped; CC-BY music attribution risk if future tracks wired; no `LICENSE` file (MIT in README prose only); no not-affiliated-with-Hasbro disclaimer; no `.well-known/security.txt`.
- Positives: zero cookies; bot AI context de-identified; CC0 music documented; account privacy toggles exist.

### RR-04 — User Data Rights (Export/Retention/Minimization) — verdict: **conditional no-go for hosted release with accounts**
- **[BLOCKER]** No deletion/erasure verb (as RR-02); **[MAJOR]** no export/DSAR path; **[MAJOR]** backup source paths `undefined` unless `POORUP_DATA_DIR` set → backups silently protect nothing; **[MAJOR]** DeepSeek receives live game state with no disclosure/opt-out; **[MAJOR]** no retention schedule (accounts/sessions/history survive forever; sessions have no TTL); **[MAJOR]** plaintext JSON + plaintext backups hold credentials; **[MAJOR]** guest nicknames/avatars persist in match records with no correction/erasure path; **[MINOR]** terminal social records never pruned; password change absent; `ACCOUNT-PROFILE.md` overstates session expiry.
- Full per-store data inventory + operator lookup table documented in mission output (accountId/clientId → files/entries).

### RR-05 — Auth & Session Lifecycle — verdict: **HOLD**
- **[BLOCKER]** `rooms.js:735-743` — `restoreConnection` still rebinds a live seat (guest path skips the account check); reproduced seat flapping.
- **[BLOCKER]** Sessions have no TTL; bearer token in localStorage re-sent every event; SHA-256 hash persisted across restarts — any leak = permanent takeover.
- **[MAJOR]** Restore failure wipes stored session on *any* non-success (known R3 §1.2, still open); no password-change flow; no password reset; auth bucket still proxy-collapsible (engine.io has no XFF support); guest→account upgrade never binds the seat; every login silently revokes other devices with no notice; no cross-tab session sync.
- **[MINOR]** `check-username` unthrottled oracle; register/login mutate memory before persist (known); display names allow bidi/surrogate issues; password policy length-only; no per-account lockout.

### RR-06 — Asset & Code Licensing — verdict: **not licensing-ready**
- **[BLOCKER]** `public/assets/fonts/test` — 3.3 MB extensionless SVG with embedded PNG, unknown provenance, publicly served.
- **[MAJOR]** OFL fonts (Pixelify Sans, Jersey 15, Silkscreen, IBM Plex Mono) ship without license texts; legacy-board SVGs embed unknown-rights raster photos; no `LICENSE` file / package field.
- **[MINOR]** Unused IBM Plex Sans weights; no credits surface; no license CI check; audio attribution split across two READMEs.
- Positives: no copyleft deps (163 MIT / 17 ISC / 15 Apache / BSDs); CC0 audio documented + hash-verified; no external CDN calls.

### RR-07 — Dependency & Build Hygiene — verdict: **PASS** ✅
- `npm audit` 0 vulnerabilities (prod+dev); lockfile reproducible (`npm ci` clean); 2 prod deps only; `overrides.qs 6.16.0` still required (medium CVE otherwise); no postinstall scripts; no `npx` runtime fetches; gitignore covers data/artifacts; `npm start` works from clean install.
- Recommendations: keep the qs pin + document why; add Dependabot + SHA-pin actions; defer Express 5 (breaks `app.get('*')`); close prior items (fonts/test, 12 MB mp3, engines field).

### RR-08 — Security Headers, Transport & Cookies — verdict: **not ready on hardening alone**
- **[MAJOR]** CSP `connect-src 'self' ws: wss:` whitelists every WS host — should be `'self'`; missing `form-action 'self'`.
- **[MAJOR]** Socket.IO CORS guards polling only; direct WebSocket upgrades bypass the origin allowlist (no `allowRequest`).
- **[MAJOR]** Auth limiter keyed on proxy IP (engine.io has no XFF handling) — one attacker can lock out all logins through the proxy.
- **[MAJOR]** Missing HSTS/COOP/CORP (+COEP optional); trust-proxy hops default 0 undocumented.
- **[MINOR]** Permissions-Policy incomplete; no `X-XSS-Protection: 0`; no explicit `Cache-Control`; `style-src 'unsafe-inline'` currently required (62 style attributes) — accept + document.
- Positives: **zero cookies** (no CSRF surface), no stack/version leakage, `x-powered-by` off, CSP present, `maxHttpBufferSize: 100000` sane, connection-state-recovery off.

### RR-09 — Static Serving & Disclosure Safety — verdict: **no secret leaks; static-serving hygiene fails**
- **[MAJOR]** No compression (verified live: styles.css 226 KB raw) and no cache headers (`max-age=0` on 12.3 MB mp3 and all assets) — prior findings still open.
- **[MAJOR]** `legacy-board-40*.svg` (1.48 MB, embedded user imagery) publicly served; 3.3 MB `fonts/test` served; `board-icons/index.html` authoring page; 7 `public/*.test.js` files served; `client-state.js` + READMEs in the webroot.
- **[MINOR]** Catch-all 200s mask `/server/...`, `/docs/...`, `/.git/...` (no content leaks — static root is `public/` only, traversal clean); no robots.txt.
- Verified clean: stores/docs/.git/node_modules unreachable; traversal probes return the shell; MIME/ETag/Range correct; no secrets/emails in public/; Socket.IO `allowRequest` missing (policy bypass only).

### RR-10 — Versioning, Metadata & Repo Readiness — verdict: **NO-SHIP until reconciled**
- **[BLOCKER]** `codex/theme-reset` vs `main` merge conflicts in 8 files (package.json, clientState.js, index.html, 5 theme/test files) — theme implementations must be hand-reconciled; 41 ahead / 13 behind; local tip unpushed.
- **[MAJOR]** Version `0.0.0`, no tags, no build identity in UI; live demo serves a pre-theme shell (missing `#quick-table-btn`, theme layers); no CHANGELOG; CI never ran on the branch (only PR/push to main) and doc promises differ; no deploy/rollback runbook, no health endpoint, no Dockerfile/Procfile; production-hardening doc pre-theme-reset.
- **[MINOR]** No `.gitattributes` (mixed EOL); README missing badges/screenshots/LICENSE; 09-08 release checklist stale; env docs omit `POORUP_TRUST_PROXY_HOPS`/`TURN_AFK_TIMEOUT_MS`.

---

## Wave 2 — Security & Reliability Sweeps (RR-11 … RR-20)

### RR-11 — Rate Limiting Sweep — verdict: **major gaps; matrix documented**
- **[BLOCKER]** Auth bucket proxy-collapsed + `clearAuthAttempts` resets the whole IP bucket on ANY success (attacker registers a throwaway after each 7 guesses — effectively unlimited).
- **[MAJOR]** HTTP limiter off by default; socket limiter per-`socket.id` (reconnect resets, N sockets multiply); no connection admission; chat cooldown per-socket (reconnect bypass); `check-username` unlimited; create-room unlimited (replay cache is dedupe only); leaderboard/snapshot/season have NO limiter (expensive pre-auth reads).
- Full per-entry-point limiter matrix + recommended default-on configuration (HTTP 300/60s/IP; handshake 30/60s/IP + 8 concurrent; socket 240/10s + per-IP/account backstops; chat 1/1.5s burst 3 + 20/10s/room; create-room 5/60s + 20/h; verbs 10-30/min/account; reads 30-60/min) captured in mission output.
- **[MINOR]** No rejection logging anywhere; fixed-window bursts; in-memory fleet-multiplication documented.

### RR-12 — Input Validation Sweep — verdict: **structurally strong; specific holes**
- **[BLOCKER]** `open-option` strike/premium fully client-controlled + same-round exercise (still `payload.strike`) — reproduced $45k reserve drain.
- **[MAJOR]** `restore-session` clientId live-seat rebind; `startingCash` up to 1e308 accepted (breaks stats/leaderboards); `turnTimer` up to 1e308 (Node clamps → instant AFK expiry); cosmetic claims/equip slots unbounded; `block-player` accepts arbitrary unbounded IDs (full-file rewrite DoS).
- **[MINOR]** `manage-property` action not enum-checked (prototype-member handler lookup); requestId >100 chars truncated (collisions); patrol score still client-submitted; join-room code brute-forceable across sockets; signed-in player-card fetch unlimited.
- Clean: all handlers wrapped by safe-emitter; no exploitable prototype pollution; money paths re-validate ranges/ownership except option pricing; 83-event coverage table produced.

### RR-13 — DoS & Resource Exhaustion — verdict: **BLOCKERs with concrete numbers**
- **[BLOCKER]** `create-room` with rotated clientId strands rooms forever (GC only reaps when no connected humans) — ~520 KB/s per socket → 2 GB heap in ~65 min (1 socket) / ~7 min (10 sockets).
- **[BLOCKER]** Telemetry whole-file fsync per record: up to ~432 full-file writes per settlement (2.08 MB each @ cap) → 4–5 s event-loop block per match, repeatable.
- **[MAJOR]** Per-achievement accounts.json rewrites (~330 MB + ~700 fsyncs per settlement); unrated leaderboard snapshot (~120–150 ms @ 10k accounts, 24/s/socket); broadcast scans all sockets; 100 KB generic setting strings echoed to every viewer; unknown events bypass rate limiting (100 KB frames at line rate); O(rooms) lookups; bot rooms keep timers forever; per-game transaction maps ~18 MB/10 min worst case.
- Measured baseline: 10 rooms × (3 humans + 3 bots), 40 s → 0 errors, ack p95 ≤ 5.3 ms. Safe operating envelope: ≤ 800–1000 sockets, ≤ 150–250 rooms (≤ 25 bot-heavy), payloads ≤ 16 KB, HTTP limiter ON, bot cadence ≥ 2 s.

### RR-14 — Deploy/Restart/Shutdown — verdict: **BLOCKER (no shutdown story)**
- **[BLOCKER]** No SIGTERM/SIGINT; `uncaughtException` → `process.exit(1)` instantly; every deploy silently resets the product mid-game.
- **[MAJOR]** Post-restart UX broken (zombie board, "No active session found", dead Resume button); in-memory games/stats lost entirely; backup no-op if `POORUP_DATA_DIR` unset; no data-dir lockfile (two processes = last-writer-wins); no health endpoints; zero deployment artifacts (no systemd unit/Procfile/Dockerfile/deploy doc) — restart policy is tribal knowledge.
- **[MINOR]** Version invisible; `NODE_ENV` unset disables CORS enforcement warning-path only; store constructor EACCES → crash loop; backup failures invisible; CI boot smoke can't detect dead socket layer; GC intervals can't be torn down.
- Full safe deploy & rollback procedure (10 steps) documented in mission output.

### RR-15 — Backup & Restore Drill — verdict: **drill fails; BLOCKERs**
- **[BLOCKER]** `verifyBackup` ignores its own `.sha256` sidecar — tampered valid-JSON verified AND restored (reproduced).
- **[BLOCKER]** Default/misconfigured deploy backs up nothing while reporting success (`POORUP_DATA_DIR` unset → all store paths undefined → `[].every()` true).
- **[BLOCKER]** No verify/restore CLI; runbook is prose that mandates an impossible checksum step; operator must hand-write scripts during incidents.
- **[MAJOR]** Rotation deletes valid backups for newer partial ones (reproduced); non-atomic backup writes; sources copied without validation (empty stores backed up as "good"); wrong root shapes pass then quarantine on boot; no manifest/generation (mixed snapshots); credential material plaintext in backups; synchronous backup stalls.
- "Lost accounts.json" runbook (best-available today + what's missing) documented in mission output; with correct config, ≤15 min stale recovery; without `POORUP_DATA_DIR`, **nothing recoverable**.

### RR-16 — Monitoring, Health & Visibility — verdict: **BLOCKERs**
- **[BLOCKER]** No `/healthz`/`/readyz`; catch-all returns HTML 200 for every probe; no external uptime monitor/ping anywhere — outages are invisible until users report.
- **[BLOCKER]** No alerting channel, no crash-survivable log path (stdout only, `uncaughtException` log can be lost), no restart policy.
- **[MAJOR]** Raw console logs without levels/timestamps/correlation; inverted verbosity (connects logged, auth/rate-limit/settlement/backup silent); no counters; no client error hooks or user-report correlation (clientId/roomCode never surfaced); store load flags discarded; GC/AFK ticks unguarded.
- Delivered: health/readyz design, minimum viable monitoring stack (uptime monitor + log keyword alerts + restart policy + counters + client diagnostics), and the exact hooks.

### RR-17 — Persistence Failure Modes (verification pass) — verdict: **7 MUST-FIX open**
- Verification table of all prior R2 §7 claims produced: **FIXED**: corrupt-JSON quarantine, atomic temp+fsync+rename, EACCES fail-closed, MatchStore in-memory cap. **OPEN**: horizontal-scale P0; season claim split-write; achievement ledger/profile split (rollback added, no reconcile); memory-before-persist; dirty-write retry gap; 50-row idempotency; telemetry full-file writes; match record size (~113 KB measured); backup integrity cluster; silent truncation; timestamp defaults; quarantine-copy loss; no schema versions; transaction maps unbounded in-game.
- New: quarantine failure swallowed while log claims bytes preserved; backfill record dropped at cap after ack; achievement `unlockedAt` defaults to load-time (inflates 30-day windows).

### RR-18 — Long-Run Stability — verdict: **3 BLOCKERs; weekend survival needs 5 fixes**
- **[BLOCKER]** 200 `botDecisions` (~117 KB) persisted per match into every participant history (50) + global store (500): 50–100 MB/h added to accounts.json at 200 games/h; whole-file rewrite per settlement.
- **[BLOCKER]** Telemetry fsync storm (~400–450 fsyncs/game; ~90k fsyncs/h at 200 games/h).
- **[BLOCKER]** Per-game replay caches unbounded (`economyTransactions` embeds full snapshots): rate-limit-maxed socket → ~0.4–0.9 GB/h.
- **[MAJOR]** Per-achievement social.json rewrites (~128/game); `leaveRoomByClient` bypasses `destroyRoom` (timers/closures retained ≤10 min); synchronous backup; process-lifetime intervals not unref'd; no leak observability.
- Client long-session is stable (state capped, timers stopped) — 181 addEventListener vs 1 removeEventListener is NOT a leak (rebuild-subtree pattern verified). Client residual: synchronous `saveGame()` per snapshot.
- Stability budget table + smallest 5-fix mitigation set documented. Thresholds: 100 MB RSS ≈ 1–2 h busy; 1 GB ≈ 24–48 h bot-heavy traffic.

### RR-19 — Load & Event-Loop Blocking — verdict: **BLOCKERs; measured**
- **[BLOCKER]** Telemetry fsync storm measured 10–74 ms/write × up to ~435 writes = **4.5–30 s freeze per bot-heavy settlement**.
- **[BLOCKER]** Per-achievement accounts.json rewrites measured **356–405 ms per unlock** at 78 MB; up to 32 candidates = +11–13 s.
- **[MAJOR]** accounts.json growth (43–78 MB at 200 accounts; 0.66–8.1 s persist); boot 520 ms → 1049 ms with mature data; broadcast fan-out measured 0.76 ms mean per 6-viewer room-event; rankings 22.5 ms blocking at 200 accounts; client `renderAll` 2.2–4 ms/board rebuild + 5.4 KB localStorage write per snapshot.
- **[MINOR]** Backup sync 56–72 ms+; bot decisions fast (p95 1.05 ms — fine); GC/lookups fine; socket.io client 577 ms boot/77 requests/1.16 MB; theme switch cheap (4.7–11.5 ms, ≤8 KB).
- Bottleneck ranking + "safe concurrent-room guidance": 10 mixed rooms steady-state fine; 20 rooms only if settlements don't collide — cap bot-heavy tables ~5–8 or ship batching first.

### RR-20 — Client Crash/Error Observability — verdict: **BLOCKER for diagnosability**
- **[BLOCKER]** Bootstrap (`main.js` 1005-1062) unguarded — any init throw leaves a dead shell with zero feedback.
- **[BLOCKER]** `applyServerState` (30+ steps) called bare — one throw = half-applied snapshot, no winner/debt/auction sync, no signal.
- **[BLOCKER]** No global error handlers / console / client→server telemetry anywhere (verified 0).
- **[MAJOR]** No server endpoint to receive reports (no POST routes/body parser; HTTP limiter off anyway); telemetry module unsuitable (kind allowlist, fsync rewrite); 4 bare catches silently convert corrupt storage to empty (data loss); no build identity in payloads.
- Delivered: minimal crash-reporting patch outline (clientErrorReporter.js before main.js; `POST /client-error` 16 KB + per-IP limit; bounded NDJSON store; Playwright pageerror test; version surfacing; privacy disclosure).

---

## Wave 3 — UX, Mobile & Copy (RR-21 … RR-30)

### RR-21 — Landing Page, Meta & Shareability — verdict: **NOT READY**
- **[BLOCKER]** No OG/Twitter/meta description/canonical/apple-touch-icon — Discord/WhatsApp shares render as bare text links.
- **[BLOCKER]** No invite deep link — share copies a bare code (public rooms silently no-op); recipient lands on home with zero context.
- **[MAJOR]** First Create click error-bounces to alias ("CREATE AN ALIAS BEFORE…" wrong verb) vs Join collecting name inline; no solo path from landing (Quick Table can strand you alone; CPU seats hidden in "Solo Dev Mode"); theme flash pre-boot; phone CTAs below the fold (≈600–650px down at 390px, all three below on 667px-tall phones); 232 KB CSS + 155 KB blocking socket.io uncompressed; no footer/trust layer.
- **[MINOR]** Title/h1 don't say what the product is; fabricated `guest_4412` placeholder; terminology drift (room/table/parlor/lobby/seat); mock statistic "Usually around twelve minutes" violates PRODUCT.md; no gameplay preview/how-it-works near CTA.
- 5 fastest conversion fixes: share card → `?join=CODE` links → inline alias on Create → "Play vs CPU" landing CTA → phone first-paint (CTA order + gzip + defer).

### RR-22 — Onboarding Funnel — verdict: **high drop-off at lobby/start**
- **[BLOCKER]** Host can press Start with 1 player; failure is chat-only; no inline "1 more player — add a bot" helper.
- **[BLOCKER]** Quick Table fallback creates a room with bots:0 and no invite path — first player cannot start or invite.
- **[MAJOR]** Missing alias closes the Create modal and discards the form; alias required before any entry with no default; no lobby invite/share block; Rematch shown to non-hosts (chat-only rejection); "Back to Lobby" actually exits.
- **[MINOR]** `[C]` hint maps to Create not Quick Table; Bots setting hidden 6th row; lobby HUD copy host/guest mismatch; winner crown id mismatch; no first-turn hint; forced "Enter Parlor" click; advanced systems exposed without "recommended" framing.
- Funnel map: fastest solo path = 1 typed alias + 6 clicks with one dead-end (Start-fail) and a scroll to find Bots.

### RR-23 — Empty States — verdict: **no BLOCKER; 3 pre-launch fixes**
- **[MAJOR]** Account-restore failure looks identical to guest/empty (silent sign-out — pairs with RR-24); directory empty-state copy wrong for filter/offline/timeout (known); lobby-alone has no waiting tile + enabled Start → chat error.
- **[MINOR]** Rankings "SIGN IN TO TRACK" for signed-in unranked; social search returns ""; setup HUD shows raw `$0`/"Join a room"; requests/invites/notifications/achievements-filter/log-drawer/chat/collection empties are bare with no next action or reset CTA; casing inconsistent across empties.
- Verified good: holdings/deeds/deals/finance/wallet, casino/market off, auction no-bids, profile guest/stats/designs, season signed-out, night-shift standby.
- Table of 17 surfaces → behavior → recommended copy/CTA produced.

### RR-24 — Network Failure & Reconnect UX — verdict: **BLOCKERs**
- **[BLOCKER]** Server restart: failed restore leaves frozen board, stale controls emit into a dead room, no "table closed" surface, dead Resume button.
- **[MAJOR]** No visible connection indicator in game (sr-only; seat chips hidden); "connection restored" announced before restore ack then sticky OFFLINE while socket healthy; mutating actions stay enabled / buffered during reconnect (known); trade-accept PROCESSING with no timeout + stale modal loops; contract modal dead after disconnect with no notice; missed explanations (trade cancel, auction reset, skipped turn) live only in the LOG drawer; leading bidder charged or reset while away without recap; session wipe on transient failure (known); live-seat overwrite with no takeover notice; Quick Table mislabels offline as "hosting new table"; no navigator.onLine/visibilitychange/pageshow handling.
- Scenario matrix (12 scenarios) with current vs missing behavior produced.

### RR-25 — Loading/Pending States — verdict: **uneven; matrix produced**
- **[MAJOR]** Trade accept: PROCESSING without timeout (offer de-listed before ack); account create/login/update + username check: disabled only, no label, no timeout; deal-detail accept/decline/cancel: no pending; deed build/sell/mortgage: no guard (double-click → two houses); Start round: no busy guard; contract propose/counter + modal repay: none (rail repay has both — inconsistent); collection "LOADING…" stuck-forever on dropped ack + claim/equip no pending; patrol start failure silently ignored, run unverified.
- **[MINOR]** Jail fine/use card, season claim, player-card fetch, resume round, economy snapshot, first music load — missing or weak states.
- Full pending-coverage matrix (~45 actions: pending/success/failure) produced. Boot acceptable (static shell + connecting labels).

### RR-26 — Copy & Microcopy — verdict: **15 findings, top-10 fixes listed**
- **[BLOCKER]** Auction HIGH BID loses `$` + grouping after first render (`${a.bid}`); "Usually around twelve minutes" mock statistic violates brand commitments.
- **[MAJOR]** Jail/Prison split on one screen; Railroad vs Airport terminology mismatch vs board/rules/achievements; vacation pool 3 names; `[OK]/[X]/[!]` debug markers in signup; "SIGN IN TO TRACK" for signed-in; raw ISO dates shown; "Back to Lobby" that leaves; dev jargon ("Solo Dev Mode", "credits or service unavailable", "STANDARD-40"); raw internal action keys in bankruptcy/feed text; "FOUR SEATS" vs Metro 6.
- **[MINOR]** cancelled/canceled split; generic unhelpful error strings; Night Shift aria-labels; ALL-CAPS/sentence-case inconsistency.
- Canonical terminology glossary produced (room/table/parlor/round/match/deed/property/cash/bot/seat/Jail/Airport/Vacation Pool/Night Shift).

### RR-27 — Room Code & Join/Leave Edge Cases — verdict: **several MAJORs**
- **[BLOCKER]** In-app invite accepted while at home seats the player server-side but the client never enters the room; leaving social then releases the fresh seat (invited players can't enter).
- **[MAJOR]** Invite-accept while playing elsewhere detaches the old seat with no expiry timer/obligation cleanup → old table stalls forever if the leaver owned the turn; codes mix O/0 I/1 with no aliasing; `maxlength=6` kills the "extra characters removed" warning (silent first-6 join); post-game rooms accept strangers + capacity oversubscription via bankrupt/bot seats; code reuse lets invites deliver players to a stranger's room; bot host takeover (known).
- **[MINOR]** Block only gates chat (blocked players can take seats); join failures dead-end; duplicate guest seats across tabs; leave ack discarded (ghost seat); Quick Table ignores ruleset when joining.
- 21-scenario join matrix produced.

### RR-28 — Mobile & iPad — verdict: **phone landscape BROKEN; others degraded**
- **[BLOCKER]** Phone landscape 844×390: tablet layout matches, board becomes 265×214 stretched, tiles 20.2px (<24px AA minimum).
- **[MAJOR]** Phone portrait: roll button 533px below fold, document 2059px (board and roll never visible together); iPad portrait: no shell, roll 113–595px below fold; 1280–1535 laptops: 2-col HUD starves board to 232–364px; key targets <44px inventory; touch-action/hover resets gated to 768–1279; mobile autoplay/music state dishonest.
- **[MINOR]** Short-landscape home clipped; no overscroll-behavior (pull-to-refresh mid-game); Night Shift unreachable on touch; Playwright never tests iPad Pro 1366/1376, iPad portrait, or phone landscape; 1.09 MB uncompressed uncached first load + 12.3 MB music.
- Device verdict matrix: Desktop 1920 ✅ READY; laptop 1280–1535 DEGRADED; iPad landscape ≤1279 ✅ READY; iPad Pro landscape DEGRADED; iPad portrait DEGRADED; phone portrait DEGRADED; phone landscape BROKEN.
- Posture: fix phone-landscape guard + HUD-at-1280 + coarse-pointer hoist; don't block phones (link acquisition path); show "best on desktop" notice.

### RR-29 — Cross-Browser — verdict: **no session-breakers on current engines; audio gap**
- **[MAJOR]** AudioContext never resumed (Firefox/Safari silent SFX class); iPad Pro compat cliff; CI runs Chromium only (no Firefox/WebKit assertions ever).
- **[MINOR]** No pageshow/bfcache handling; scrollbar-gutter Safari <18.2 shift; Silkscreen faux-bold drift; `:has`/`color-mix`/cqw floors for older engines; touch-action gating; keyboard-over-modal on iPad.
- Feature inventory table with current-version support verdicts; no parse-time-death syntax anywhere; engine matrix: Chrome/Edge ✅ READY, Firefox/Safari DEGRADED (audio), iPad Pro DEGRADED.
- Recommended support statement produced (Chrome/Edge 111+, Firefox 121+, Safari 16.2+, desktop-first; don't claim mobile parity until fixed).

### RR-30 — Accessibility Release Sweep — verdict: **aspiration OK; AA claim NOT yet**
- Verification: R1 items **4 fixed / 10 open**; R3 items **2 fixed / 18 open** (focus lost on every ~650ms snapshot rebuild across rail, deed, deal, sponsorship, votes, setup, financing, casino; live-region flood + silence mix).
- New: skip links after headers on 4 views; toast dismiss focusable inside aria-hidden stack; dice result not announced (pips only); casino desk rebuild drops focus; form errors chat-only (no aria-invalid/describedby); night-shift spawns silent + focus drops; autumn muted 3.84:1; no per-view document titles; social h3 skips h2; theme dialog not contained; list semantics missing; Create dialog initial focus on CLOSE.
- Reduced motion: fully covered except `.auction-bar-fill` transition.
- Conformance snapshot: 12× 2.4.3, 9× 4.1.3, 3× 1.4.3, plus smaller criteria — must-fix vs disclose breakdown produced.
- Recommended statement: "designed toward WCAG 2.2 AA; core loop fully keyboard-operable; known gaps in dynamic focus, autumn/summer contrast, live regions; no third-party audit" — top-5 must-fix list produced.

---

## Wave 4 — Verification & Consolidation (RR-31 … RR-40)

### RR-31 — Full Test Suite Execution — verdict: **GO (tests green) with a pin-the-SHA caveat**
- `main @ e64b174`: `npm test` 52/52 ✅ (269s), `test:audit` 9/9 ✅, lints 0/0 ✅, coverage 90.08% stmts / 77.73% branch ✅, Playwright 166 passed / 32 skipped / 0 failed ✅.
- `codex/codescene-cleanup @ 71654c6`: 44/44 ✅ (219s), audits 9/9 ✅, lints clean, coverage 89.81%, browser 99 passed / 45 skipped ✅.
- Issues: branch switched mid-run (results span states — pin SHA); current checkout diverges 143 files/−8,780 lines vs main; `server/client-state.test.js` orphaned (passes, in no script); `npm test` slow (bot-simulation 184.5s of 219s); coverage has no thresholds (can't fail); `test:browser` Chromium-only; `bot:balance` correctly excluded.

### RR-32 — Performance Budget & Assets — verdict: **budget broken; quantified**
- **Measured:** first load ≈1.24 MB wire / 67 requests (1.10 MB raw text+SVG → 249 KB gzip); JS 777 KB / 51 requests uncompressed; blocking socket.io 155 KB; repeat visit = 67 revalidations; theme switch 5–8 KB (fine).
- **[BLOCKER]** No compression (all statics) — fix saves ~853 KB; **[BLOCKER]** 12.3 MB 320 kbps music (~29 MB per game session on mobile).
- **[MAJOR]** 777 KB unbundled JS; blocking socket.io; no effective caching; 4.93 MB dead payload (3.3 MB `fonts/test`, 1.5 MB legacy boards, unused fonts/SVGs/orphan theme dirs).
- Budget table produced: first load ≤450 KB/≤20 req, repeat 1 revalidation, theme ≤8 KB, session ≤4 MB music; top-5 quick wins with savings.

### RR-33 — View Error States & Missing-Data Robustness — verdict: **several BLOCKERs (crash blast radius)**
- **[BLOCKER]** `renderAll` linear with no per-panel isolation — one panel throw kills every later panel + debt/winner/auction sync (half-drawn UI, no error).
- **[BLOCKER]** `clientTopNavRender.js:109` — `state.players[state.turnIndex].name` throws on empty/mismatched players (first in renderAll — kills the whole pass).
- **[MAJOR]** HUD `cur.name/cash` (2nd stop); snapshot ingress no Array.isArray/object filtering (players/tiles/feed null entries); auction stale tileIndex + `me.cash` on 60ms tick; deed detail stale index + unknown RENT_TABLE group; social/leaderboard shapes unvalidated; rail `playerContracts.active` non-array; trade offer `TILES[i]`; directory rows null/malformed.
- **[MINOR]** bankruptcy modal empty players; trade modal shrinking players; "$undefined" cards; "@undefined" leaderboard rows.
- Robustness table per view: robust = rules/night-shift/casino/market/wallet/profile; fragile = HUD/rail pipeline, social/rankings ingress, directory, auction/deed. Top-5 hardening fixes listed. No snapshot schema version guard exists.

### RR-34 — Audio (Music & SFX) — verdict: **no BLOCKER; feature not release-quality**
- **[MAJOR]** AudioContext never resumed (silent SFX for returning users); `music.play()` rejection swallowed with ON toggle (silent-ON class); 5 of 6 synth SFX tracks dead code (Preferences overpromises); 12.3 MB 320 kbps loop.
- **[MINOR]** No volume mix (0.16 ignored on iOS); no cross-tab storage sync; no error/stalled handling (404 vs autoplay indistinguishable); 12 duplicate toggles; theme tracks documented but never wired; no pageshow/bfcache resync; hidden-view playback unverified on WebKit.
- Positives: opt-in by default (new users OFF), correct aria-pressed/icons, no audio-only information, patrol hit sound works.
- 5 ranked fixes; audio checklist produced.

### RR-35 — Host, Spectator & Rematch Lifecycle — verdict: **3 BLOCKERs**
- **[BLOCKER]** Rematch: non-host players' `state.gameOver` never clears on the new snapshot — stuck behind the winner modal (scrim locked, Escape gated); only exits are a dead Rematch or Leave.
- **[BLOCKER]** Abandoned seat (expired) is never pruned → Rematch fails "At least two players required" forever (2 seats) or revives the ghost into turn order (3+, 180s/turn stalls) — reproduced.
- **[BLOCKER]** Bot host takeover (no `!isBot`), no re-election — room permanently unstartable (reproduced).
- **[MAJOR]** Non-host Rematch button live (chat-only rejection); post-game rooms re-list as joinable (stranger intake); bankrupt seats don't count for capacity (5 players in 4-cap, reproduced); "Back to Lobby" leaves; no kick/force-end/close-room verbs; bots keep playing after last human leaves (10 min).
- **[MINOR]** Dangling hostId; leave ack ignored; JOIN offered on in-progress rooms; no abandoned-match record; host transfer timing; client-computed standings.
- Lifecycle matrix produced.

### RR-36 — Guest vs Account Data Map & Privacy Surface — verdict: **material mismatches**
- Definitive per-feature data map (storage, retention, visibility, deletion status) + client storage map + guest lifecycle + operator lookup table produced.
- **[H]** Own match history still leaks opponents' casino/market/contract rows (known R2 §2.8 open) while UI says "economy results stay inside your private account record".
- **[H]** `get-public-player-card` returns recent matches regardless of history privacy (even anonymous viewers) — "PRIVATE" doesn't hide them.
- **[H]** Stable accountIds exposed by anonymous search/leaderboards/seasons despite a plan promise "never expose account ids".
- **[H]** No deletion/export; retention promised (90 days) in plans but not implemented; blocked players still appear in recent players; season rows leak loan/casino metrics; session non-expiry; mythical unlocks broadcast regardless of privacy; guest clientId reclaim; SHOWCASE "no accounts" copy stale; invite privacy levels unimplemented.
- 15-item policy-facts checklist produced.

### RR-37 — Account & Privacy Controls UX — verdict: **5 minimal additions needed**
- **[BLOCKER]** Player-card recent-matches privacy leak (same as RR-36-H) rendered unconditionally.
- **[MAJOR]** No delete/export/clear-history/revoke-sessions UI; logout clears only the session key (designs, save, alias, prefs remain on shared devices); no cross-tab sign-out sync; BLOCK one-click with no confirm and no unblock UI; design-save silently rewrites account identity; guest achievements wiped on register with no warning; no searchability/stats/leaderboard opt-outs; no password change/reset; "Guest play stays local" copy contradicts reality (no local stats store).
- **[MINOR]** Unsaved-edit loss; instant REMOVE FRIEND; `createdAt` dropped so JOINED shows "GUEST"; account card clipped; no notification preferences.
- Full control matrix (setting → exists → enforced → feedback → missing) produced.

### RR-38 — Player Docs & Support — verdict: **NOT READY**
- **[BLOCKER]** Live demo serves an outdated build (no Rules surface, no Quick Table) — friends learn the wrong game.
- **[BLOCKER]** Zero support surfaces: no bug template, no contact, no FAQ, no README support section.
- **[MAJOR]** Instructions.md stale (no auctions/casino/market/contracts/events/bots/rulesets/achievements/seasons; jail copy wrong) — 3/10 usability; Rules "Properties" claims full-set multiplier that only fires when `doubleRent=true` (no UI toggle exists); Rules auctions describe a fallback bidder process that doesn't exist + omit no-bid outcome; README settings list stale; README "no database" vs hardening docs; no in-game Rules access mid-match.
- **[MINOR]** No error→rules deep links; no FAQ/known-issues; patrol undocumented; Quick Table tooltip wrong; no CHANGELOG/LICENSE; terminology drift (Prison/Jail, FOUR SEATS, 40 spaces vs Metro 52, v2.4.1 vs 0.0.0).
- Minimal 5-item doc checklist + top-3 rule-explanation gaps produced.

### RR-39 — Blocker Triage & Status Verification — verdict: **NO-GO; cluster plan delivered**
- Verified status of 48 P0/P1 items against disk: **fixed by the parallel session (9)**: ensureBots, roll-with-offer, leave-round confirm, buy/pass HUD lock, trade dedup/pending, deed acks, decline/cancel confirm, sessionStorage guard, theme contrast/responsive. **Everything in deep-logic/server-runtime remains open** (options exploit, hybrid dilution, season percentile, debt-mode, restore hijack, timers, telemetry fsync, backups, deletion/legal, etc.).
- 12 fix clusters with severity/effort/order; three tiers (MUST/SHOULD/POST); four severity reclassifications for public multi-user context (R3 2.1 → P0, R3 1.1 → P0, R2 2.1 → P0, others remain blocking P1).
- **Release gate checklist (15 testable statements)** produced — see below.

### RR-40 — End-to-End Journey Trace — verdict: **happy path yes; blanket release no**
- Boot→alias→join→lobby→full turn cycle→adversarial→interruptions→end→post-game traced with per-step OK/RISK/BROKEN verdicts.
- BROKEN: server restart (game unrecoverable), rematch for non-hosts (stale modal), debt-mode end condition.
- RISK: bots-host freeze; double-roll busy reset; auction deadline/close mismatch; AFK debt erase; contract/market defects; second-tab seat flap; post-game stranger intake.
- Top visible risks: rematch trap, live-seat hijack, auction lying countdown. Top invisible risks: timer-throw process exit + no drain, transient auth session wipe, silent money/fairness drift with zero client observability.

---

## Release Gate Checklist (from RR-39 — all must be true)

1. `POORUP_HORIZONTAL_SCALE=true` without a real adapter **refuses boot**; multi-process JSON writes impossible.
2. `restore-session` for a seat whose socket is live/undisconnected is rejected (no seat flapping).
3. A throw in turn/AFK/disconnect/GC callbacks is caught per-room; process stays up and other rooms keep updating.
4. SIGTERM sends a shutdown notice and exits cleanly; no mass "No active session found" after restart.
5. Option open+exercise cannot exceed quote-bounded strike/premium; house reserve delta is zero on open→exercise.
6. Hybrid conversion cap counts live pending conversions; failed conversion seizes collateral or leaves debt repayable.
7. Last place cannot claim top-1%/gold rewards (3-row test).
8. Debt-mode 2p game reaches a winner, clears `inDebt`, conserves cash.
9. Double-click market/casino/loan executes exactly once (stable requestId until ack).
10. Decline/cancel-trade confirm is visible above the deal card.
11. Sponsorship desk is reachable on every snapshot until resolved — no hard-stall.
12. No unbounded room growth: ghost rooms GC'd; host re-elected to a human or bots excluded.
13. Missing `/assets/*` returns 404, not index.html; branded 404/500 pages exist.
14. Typed chat is retained on rate-limit rejection; scrollback not yanked while bots act.
15. Account deletion + data export + privacy policy ship (or registration is disabled).

Additional release-blocking items from later missions (not in the original 15):
16. Rematch clears `gameOver` for all clients; expired seats pruned at end/rematch.
17. Backup verification actually verifies checksums; `POORUP_DATA_DIR` unset fails loud in production.
18. OG/meta tags + invite links (`?join=CODE`) for shareability.
19. LICENSE + font OFL texts + credits; dead webroot artifacts removed (fonts/test, legacy boards, test files).
20. Compression + cache headers + health endpoint + client error reporting ship.

---

## Fix Clusters (effort & order)

| # | Cluster | Effort | Blocks release |
|---|---------|--------|----------------|
| C1 | Config/persistence guard (horizontal-scale P0) | S | Yes |
| C2 | Session/seat lifecycle (restore hijack, session wipe, bot host) | M | Yes |
| C3 | Stability/ops (timer guards, SIGTERM, health, 404) | M | Yes |
| C4 | Economy exploits (option bounding, hybrid dilution) | M | Yes |
| C5 | Rules end-conditions (season percentile, debt mode) | M | Yes |
| C6 | Client action safety (double-submit, confirm z-index, sponsorship reopen, rematch modal) | S–M | Yes |
| C7 | Persistence integrity (season claim, backup verify, telemetry batching) | M | Partly |
| C8 | Legal & data rights (deletion, export, policy, terms, contact) | M | Yes |
| C9 | Release mechanics (merge, version, tag, changelog, deploy/rollback runbook, live demo) | M | Yes |
| C10 | Shareability & trust (OG/meta, invite links, footer, source-less aliases) | S | Yes |
| C11 | Webroot & perf hygiene (compression, cache, dead assets, music re-encode) | S | No (fast) |
| C12 | Chat/UX/mobile (chat scroll/retention, iPad cliffs, phone landscape) | S | No |
| C13 | Observability (client error reporting, logs, counters) | S–M | No |
| C14 | Render/perf/focus architecture (dirty-slice rendering, focus preservation) | L | No |
| C15 | Dead weight/docs (stale audits, dead code, Instructions rewrite) | S | No |

---

## What's Genuinely Ready

- Test suite: 52/52 unit, 9/9 audit, 166 browser tests, both lints, 90% coverage — all green on `main`.
- Dependencies: 0 vulnerabilities, permissive licenses only, reproducible lockfile, clean supply chain.
- Security core: no cookies, no secrets in repo, no stack leakage, safe-emitter handler wrapper on all 83 events, server-authoritative money math, crypto RNG, Fisher–Yates correct, prototype-pollution-safe spreads.
- Architecture: 0 import cycles, consistent safe-emitter ack scaffolding, atomic storeIO with quarantine (verified), room timer inventory bounded, chat never persisted server-side.
- Product: the in-app Rules book is unusually accurate vs server logic; settlement audit suites pin core economy; invalid room codes / expired invites / recovery toasts are handled well; night-shift, casino reel, market, wallet, profile views are robust to degraded data; mobile ≤1279px iPad landscape works as designed.
