# RR-11 — Rate Limiting Complete Sweep

**Audit:** Release Readiness (40-agent) · Wave 2 · Mission RR-11 · 2026-09-12
**Mode:** read-only; no files modified.
**Prior findings verified current:** HTTP limiter default-off still true (`httpRateLimiter.js:50-56`), socket limiter still per-`socket.id` (`socketRateLimiter.js:3-19`), no `io.use`/`allowRequest` admission anywhere (grep: zero matches), auth bucket still IP-only (`serverSocketAccount.js:78-97`). Newly confirmed bypasses are marked NEW.

## Findings (15)

1. **[BLOCKER]** `server/serverSocketAccount.js:78-80,151-154` — auth bucket keyed solely on `socket.handshake.address`; `POORUP_TRUST_PROXY_HOPS` affects only Express `req.ip`, never the Socket.IO handshake. Behind the documented Cloudflare/edge topology all users collapse to one edge IP → 8 failures/min lock register/login/restore globally; restore failures also make every client wipe its stored token (`clientSocketListeners.js`, audit 1.2) — auth global DoS + mass logout — resolve proxy IP at socket layer (hop-validated XFF) and bucket per IP **and** per `(username, IP)`, never a single global key.
2. **[BLOCKER]** `server/serverSocketAccount.js:99-101,156-157` — NEW: `clearAuthAttempts` deletes the whole IP bucket on **any** successful account op; registration is unauthenticated, so an attacker registers a throwaway account after every 7 guesses — auth limit is effectively disabled — never reset the failure budget on success; successful login must not touch the failure counter.
3. **[MAJOR]** `server/httpRateLimiter.js:50-56` + `server/server.js:50` — `max` defaults 0 → `if (!limit) return next()`, so with zero env config static + SPA fallback (`server.js:69-75`) are unlimited; any GET/miss flood saturates event loop/disk — default-on IP limit (≈300/60s, assets counted; maybe separate static), explicit `POORUP_HTTP_RATE_LIMIT=0` opt-out only.
4. **[MAJOR]** `server/socketRateLimiter.js:3-19,21-23` + `server.js:111,117-119` — global cap is 240/10s per `socket.id` and `forget()` on disconnect; reconnecting mints a fresh bucket and N sockets multiply throughput without bound; no per-IP/account backstop — dual-key the ingress limiter (socket + IP + account), keep `forget` only for the socket key.
5. **[MAJOR]** `server/server.js:58-64,108-121` — no `io.use`/`allowRequest`/client cap; engine handles `/socket.io` before Express, so even an enabled HTTP limiter never sees handshakes/polling; handshake flood creates unbounded sockets (memory, timers) and one `console.log` per connect — `allowRequest` per-IP handshake throttle (e.g. 30/60s), concurrent-connection cap per IP (8-10) and global budget.
6. **[MAJOR]** `server/socketSocialApi.js:265-271` + `server/socketRuntime.js:831` — chat cooldown 500 ms per `socket.id`, deliberately deleted on disconnect; reconnect/parallel-socket spam bypass; only cap is 250 chars (`roomSetup.js:68-71`); no per-account/IP/room bucket — cooldown on `(account||IP)` with burst (1/1.5s, burst 3) plus per-room 20/10s.
7. **[MAJOR]** `server/serverSocketAccount.js:118-122` + `accountStore.js:530-550` — `check-username` has no limiter beyond the global per-socket cap; returns exact `available/reason`; new socket per batch → scripted full username enumeration — per-IP bucket (30/60s) and generic client-facing messages (server already does the authoritative check at register).
8. **[MAJOR]** `server/serverSocketAccount.js:237-263` — create-room unlimited; replay cache is dedupe only (TTL 2 min, cap 1000), and unique `requestId`/fingerprint bypasses it; empty rooms survive ~10 min (`socketRuntime.js:30-31,700-714`) → thousands of live rooms, GC/broadcast churn — per-account/IP quota (5/60s, 20/h), one live room per guest IP/socket, shorter grace for never-started rooms.
9. **[MAJOR]** `server/serverSocketSocial.js:172-195` — `get-leaderboard`, `get-leaderboard-snapshot`, `get-season` have **no** limiter (not even social buckets); snapshot builds 17 metric tables × all season rows and is callable anonymously at 24/s/socket — expensive read amplification — 20/60s per IP/account + cached snapshot.
10. **[MAJOR]** `server/socketHandlerSupport.js:74-85` (`emitRoomState` unconditional) + `serverSocketGame.js:50-81` — every game verb rebroadcasts full state even on reject (R3 §8.4), and trade/contract propose/counter/auction verbs have no per-verb limit beyond 240/10s/socket; relay spam floods opponent offers and multiplies state builds — per-verb/account tokens (bid 20/min, trade/contract 10/min) and broadcast only on state change.
11. **[MINOR]** `serverSocketSocial.js:89-124,197-231,250-260` — `respond-friend-request`, remove/block/cancel/mark-read, `report-player`, `respond-room-invite`, season/cosmetic claims are global-capped only; report-player can spam a target's notifications, multi-account multiplies — route through `allowSocialAction` per action (30/60s).
12. **[MINOR]** `serverSocketAccount.js:132-134,388-443` — `list-rooms`, `join-room`, `leave-room`, `set-player-appearance` unbounded (appearance emits full state each success); directory/presence enumeration and join churn — 30/60s socket bucket.
13. **[MINOR]** `server/socketSocialApi.js:42,45-59` + `socketRateLimiter.js:4` — all limiter state is process-local Maps; social buckets prune only the key being used; socket buckets are fixed-window (2× boundary burst) and scale ×N instances — periodic sweep + token bucket, document single-process limit (horizontal scale already gated by `persistenceMode.js`).
14. **[MINOR]** `server.js:108-121`, `socketHandlerSupport.js:110-113`, `httpRateLimiter.js:33-38`, all social/auth limiters — **zero** logging or metrics on any rejection; ops cannot distinguish attack from outage (audit 5.5 verbosity inversion) — sampled structured warn + per-bucket counters.
15. **[MINOR]** `server/serverSocketSocial.js:126-137,366-370` — `get-public-player-card`: signed-in callers **unlimited** (`playerCardRateError` returns null), anonymous keyed on handshake IP (same proxy collapse) — per-account cap for signed-in + per-IP for anon.

**Verified non-gaps:** `express.json`/body parser is never mounted and no POST/PUT routes exist (HTTP body size N/A); Socket.IO `maxHttpBufferSize: 100_000` caps packets; chat text capped 250; auth token lookup only via high-entropy tokens; patrol `finish-patrol-run` is token-gated (24-byte server token, plausible-duration check) so submit spam is cheap-reject only; friend-request/room-invite/patrol-start/search/anon player-card **are** limited 30/60s. **Abuse ranking (item 4):** trade/contract relay spam > create-room churn > chat flood (reconnect bypass) > leaderboard snapshot reads > market ops > username enum > patrol submit (gated) > social mutations (partially gated).

## Defaults (no env)

| Limiter | Default | Needs env? |
|---|---|---|
| HTTP (static/SPA) | **off (`max=0`)** | yes → effectively unlimited |
| Socket ingress | on, 240/10s per `socket.id` | no (env can override) |
| Auth register/login/restore | on, 8/60s per handshake IP (reset by any success) | no |
| Chat | on, 500ms per `socket.id` (cleared on disconnect) | no |
| Social actions | on, 30/60s per `account:action`; anon per IP | no |
| Connection admission | **none** | n/a |

Identity keying: `socket.id` (global, chat) — resettable by reconnect; IP (auth, anon social) — proxy-collapsible/rotatable; account (4 social verbs) — bypassed by free re-registration; clientId (create replay actor fallback) — client-supplied/changeable. No path keys on all three.

## Recommended default-on config (release)

HTTP 300/60s/IP (trusted hops mandatory in prod; keep assets exempt if first-load budget is tight). Handshake: 30/60s/IP, 8 concurrent/IP, global ceiling. Socket events: 240/10s/socket **plus** 600/10s/IP **plus** 600/min/account. Chat: 1/1.5s per account (burst 3), 20/10s per room, keep 250 cap. Auth: register 5/60s/IP; login 10/60s/IP **and** 5/15min/(username+IP); never reset failures on success; restore separate. Create-room: 5/60s + 20/h per account/IP, 1 live guest room. Game/social verbs: 10-30/min/account per verb (trade/contract/bid tighter); reads 30-60/min. Leaderboard/season 20/min + cache. Log every rejection as counter + sampled warn. Tradeoffs: aggressive per-IP limits punish NAT/shared/campus IPs (prefer auth-key when available, IP only as backstop); IP-only keys collapse under edge proxies unless hops/XFF is resolved at the socket layer; in-process limiters multiply by instance count (single-process today per `persistenceMode.js`); fixed windows allow 2× boundary bursts — prefer sliding/token buckets; default-on HTTP can 429 legitimate users on proxy misconfig, so ship with a production assertion/warning when `NODE_ENV=production` and hops=0.

## Limiter coverage matrix

| Entry point | Current limiter | Release recommendation |
|---|---|---|
| GET / (SPA fallback, 404) | none (HTTP off by default) | default-on 300/60s/IP |
| GET /assets/* static | none | same / separate asset bucket |
| GET /socket.io (handshake+polling) | **bypasses Express entirely**; no admission | `allowRequest` 30/60s/IP + 8 conn/IP |
| check-username | global socket only | 30/60s/IP + generic message |
| account-register | 8/60s/IP (resettable via own registration) | 5/60s/IP, no reset |
| account-login | 8/60s/IP (resettable via own login) | 10/60s/IP + 5/15min/(user+IP) |
| account-restore | same bucket as login | separate low bucket, no cross-reset |
| account-logout / account-update | global only | 10/60s/account |
| restore-session | global only | 10/60s/socket |
| list-rooms | global only | 30/60s/socket |
| create-room | replay dedupe only | 5/60s + 20/h/account, 1 live guest room |
| join-room / leave-room | global only | 30/60s/socket |
| set-player-appearance | global only (full-state emit) | 10/60s/socket |
| set-setting / start-game | global only | 10/60s/socket (host) |
| send-chat | 500ms/socket.id, 250 chars | 1/1.5s account+IP burst 3 + 20/10s/room |
| roll-dice / end-turn | global 240/10s/socket | 10-20/60s/account |
| purchase/decline/manage property, jail, bank loan, bankruptcy | global only (unconditional state emit) | 10-20/60s/account, emit on change |
| auction-bid / auction-pass | global only | 20/60s/account |
| propose/counter/adjust/respond/cancel trade & player-contract, repay | global only (relay spam) | 10/60s/account + relay throttle |
| market-order / margin / short / options / close | global only | 20/60s/account |
| place-casino-bet / sponsorship verbs | global only (per-turn game rules) | 10/60s/account |
| vote-global-event | global only | 10/60s/account |
| get-bank-loan-offer / get-economy-snapshot / get-cosmetics | global only | 60/60s/socket |
| send-friend-request / send-room-invite / start-patrol-run / search-players | 30/60s account (anon IP for search) — OK | keep |
| finish-patrol-run | token-gated, global only | 30/60s/account |
| get-public-player-card | anon 30/60s IP; signed-in unlimited | 30/60s/account + IP |
| respond/remove/block/cancel/mark-read, report-player, respond-room-invite | global only | 30/60s/account each |
| claim-season-reward / claim-cosmetic / equip-cosmetic | global only (store dedupe) | 10/60s/account |
| get-leaderboard / -snapshot / get-season | **none** | 20/60s/IP+account + cache |
| get-social-data/self-profile/friends/requests/notifications/match-history/recent | global only | 60/60s/account |
| clear-recent-players | global only | 10/60s/account |
| HTTP bodies / URL | no JSON routes; Socket.IO packet cap 100 KB; Node 16 KB headers | keep; add handshake admission |
| Rejection visibility (all layers) | silent | counters + sampled warn logs |
