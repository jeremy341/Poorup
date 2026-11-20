# Rate limits and abuse budgets

This is the coverage map for every HTTP route class and every socket event the server accepts. For each one it says which limiter applies, what identity the budget is keyed on, the window, and the budget. Entries marked **global only** are covered by the per-IP HTTP budget or the per-socket and per-peer socket budgets, and have no dedicated budget. The reason is given in each case.

Source of truth for the numbers: `server/serverConfig.js` (`ABUSE_BUDGET_SPEC`, `readAbuseLimits`, `readSocketEventLimits`, `readTrustedProxy`), `server/abuseBudgets.js`, `server/socketRateLimiter.js`, `server/httpRateLimiter.js`, and `server/rateBuckets.js`.

## Identities

| Key | What it is | Used by |
| --- | --- | --- |
| IP | Client address from `req.ip`. Express resolves it from `X-Forwarded-For` **only** through the trusted-proxy setting. | HTTP global and route budgets |
| Peer | The resolved client address for a socket. IPv4-mapped IPv6 counts as its IPv4. Any other IPv6 address counts as its `/64`. | socket peer budget, handshake admission, auth/join/username budgets (`authAttemptKey`) |
| Socket | The socket id. A reconnect gets a new id. | socket per-socket budget, chat cooldown |
| Account | The signed-in account id. Anonymous sockets fall back to their peer. | account writes, exports, social actions |
| Client id | The client's seat id. Used for room seating, not for limiting. | not limited |

A reconnect does not reset the peer budgets, because they outlive the socket.

## Trusted proxies

Forwarding headers are believed only from proxies you name.

| Setting | Default | Meaning |
| --- | --- | --- |
| `POORUP_TRUST_PROXY_HOPS` | `0` | Trust the last N entries of `X-Forwarded-For`. The same rule Express applies to `req.ip`. |
| `POORUP_TRUSTED_PROXY_ADDRESSES` | unset | Comma-separated proxy peer addresses (plain IPs, no CIDR). Forwarding headers are believed only when the socket peer is on this list, and the chain is walked back through listed proxies. Use this whenever the app port can be reached without the proxy. A CIDR or malformed entry stops the server at boot. |

With both unset, `X-Forwarded-For` is ignored and every client is keyed by its socket address. An attacker who reaches the app port directly therefore cannot pick a bucket by sending a header. Setting `POORUP_TRUST_PROXY_HOPS=1` behind a proxy that is reachable directly would let such a client choose its key, so set `POORUP_TRUSTED_PROXY_ADDRESSES` in that deployment.

## Global budgets (env)

| Budget | Env | Default | Notes |
| --- | --- | --- | --- |
| HTTP per IP | `POORUP_HTTP_RATE_LIMIT`, `POORUP_HTTP_RATE_WINDOW_MS` | off in development; required in production (boot fails if unset) | Static files and `/healthz`, `/readyz` are not counted. A 429 carries `Retry-After`. |
| Socket per socket | `POORUP_SOCKET_RATE_LIMIT`, `POORUP_SOCKET_RATE_WINDOW_MS` | 240 per 10 s | Every socket event. |
| Socket per peer | `POORUP_SOCKET_PEER_RATE_LIMIT` | 4 × the socket limit (960 per 10 s) | Survives reconnects. |
| Socket escalation | `POORUP_SOCKET_BLOCK_THRESHOLD`, `POORUP_SOCKET_BLOCK_MS` | 300 refused events per window, then 60 s | A peer that keeps refusing is blocked for its events. The socket stays connected and the peer receives `RATE_LIMITED` answers. |
| Handshakes per peer | `POORUP_SOCKET_HANDSHAKE_RATE`, `POORUP_SOCKET_HANDSHAKE_WINDOW_MS` | 120 per 10 s (unknown peers 12) | Refused at admission. |
| Open connections | `POORUP_SOCKET_MAX_CONNECTIONS` | 2000 | |

## Per-identity budgets (env)

Each budget is overridable with `<PREFIX>_LIMIT` and `<PREFIX>_WINDOW_MS`. A blank value means the default. An explicit `0` disables that one budget, so use it only for a known load test.

| Budget | Prefix | Default | Key | Applies to |
| --- | --- | --- | --- | --- |
| `authAttempt` | `POORUP_AUTH_ATTEMPT` | 8 per 60 s | Peer | `account-register`, `account-login`, `account-delete-request`, `account-delete-cancel`, `account-recovery-email-request`, `account-recovery-email-verify` |
| `usernameCheck` | `POORUP_USERNAME_CHECK` | 30 per 60 s | Peer | `check-username` |
| `joinFailure` | `POORUP_JOIN_FAILURE` | 30 failed attempts per 10 min | Peer | `join-room`, and private-code probes through `create-room`. Successful joins are not counted. |
| `roomCreate` | `POORUP_ROOM_CREATE` | 60 per 60 s | Peer | `create-room` |
| `accountWrite` | `POORUP_ACCOUNT_WRITE` | 60 per 60 s | Account (peer if anonymous) | `account-update`, `set-player-appearance`, `set-setting` |
| `accountExport` | `POORUP_ACCOUNT_EXPORT` | 5 per 10 min | Account | `account-export` (socket) and `GET /account/export` (HTTP, its own counter) |
| `recoveryRequest` | `POORUP_RECOVERY_REQUEST` | 5 per 15 min | IP | `POST /account/recovery/request` |
| `recoveryVerify` | `POORUP_RECOVERY_VERIFY` | 20 per 15 min | IP | `GET/POST /account/recovery/verify`, `GET/POST /account/recovery/reset` |
| `profileWrite` | `POORUP_PROFILE_WRITE` | 60 per 60 s | IP | `POST /account/profile` |
| `internalToken` | `POORUP_INTERNAL_TOKEN` | 30 per 60 s | IP | `POST /internal/maintenance`, `POST /internal/retention/run` (counted before the token is checked) |
| `analytics` | `POORUP_ANALYTICS` | 120 per 60 s | IP | `GET /admin/analytics/*` |

The social budgets are fixed at 30 per 60 s per account and action (anonymous callers per peer), and the global budgets apply on top. They are not env-configurable yet.

Memory: every map above is bounded at 10 000 live keys (`MAX_TRACKED_BUCKETS`). When it is full, expired windows are dropped first. A new key then takes over the oldest live slot with the spend it already carries, so rotating addresses cannot reset a budget. The social action map is capped at 50 000 keys, and a new key is refused rather than evicting a live window. The socket block table is capped at 10 000 peers.

## Refusal shapes

- **HTTP:** `429` with `Retry-After` (seconds) and a plain-text body.
- **Socket, global or escalated:** `{ success: false, code: "RATE_LIMITED", error: "Too many requests. Try again shortly.", retryAfterMs, blocked? }`. `blocked: true` means the peer is in an escalated block for `retryAfterMs`. The socket is not disconnected.
- **Socket, per-identity budgets:** `{ success: false, code: "RATE_LIMITED", error }`. Budgets that carry a wait also return `retryAfterMs`. Pre-existing social refusals keep their text unchanged (clients match on `error`).

## HTTP route coverage

| Route class | Limiter now | Key | Window | Budget | Status |
| --- | --- | --- | --- | --- | --- |
| Static files under `public/` (`/assets`, `/themes`, `/client`, `/styles.css`, `/favicon.svg`, other files) | none | n/a | n/a | n/a | **Intentional.** Served before the limiter so one page load (100+ requests) is not counted. A CDN or edge should cap these. |
| `/healthz`, `/readyz` | bypass | n/a | n/a | n/a | **Intentional.** A burst must not make an orchestrator restart a healthy instance. |
| SPA pages (`/`, `/play`, `/rooms`, `/profile`, `/rankings`, `/social`, `/rules`, `/admin/analytics`), `/about`, `/rules`, `/robots.txt`, `/sitemap.xml`, `/maintenance/*` | global HTTP per IP | IP | `POORUP_HTTP_RATE_WINDOW_MS` | `POORUP_HTTP_RATE_LIMIT` | Covered. SEO and metadata routes are owned by another change and are not modified here. |
| `GET /account/session`, `POST /account/logout` | global HTTP per IP | IP | as above | as above | **Global only.** Cheap, no secret checked. |
| `GET /account/export` | global + `accountExport` | IP | 10 min | 5 | **Now covered** (was global only). |
| `POST /account/profile` | global + `profileWrite` | IP | 60 s | 60 | **Now covered** (was global only). |
| `POST /account/recovery/request` | global + `recoveryRequest` + per-account/address mail throttle (1 h, `accountRecovery.js`) | IP | 15 min | 5 | **Now covered** (was global + mail throttle). |
| `GET/POST /account/recovery/verify`, `GET/POST /account/recovery/reset` | global + `recoveryVerify` | IP | 15 min | 20 | **Now covered** (was global only). |
| `POST /internal/maintenance`, `POST /internal/retention/run` | global + `internalToken` (token constant-time compared) | IP | 60 s | 30 | **Now covered** (was global only). |
| `GET /admin/analytics/summary\|balance\|drilldown` | global + `analytics` | IP | 60 s | 120 | **Now covered** (was global only). |
| `GET /admin/ops/status\|rooms\|bots\|audit`, `POST /admin/ops/maintenance\|lockout` | global; writes also `adminOpsGuard` | account | 60 s | 12 writes | Covered for writes. Reads are admin-only and cheap, so global only. |
| `/admin/ai/*` (providers CRUD, `test`, `activate`) | global; writes also `adminOpsGuard` | account | 60 s | 12 writes | Covered for writes. The bot advisor's outbound calls have their own budget (`botAdvisor.js`, 60 min window and cooldown on provider rate-limit answers). |
| `POST /maintenance/unlock` | global + unlock limiter (after the same-origin check) | IP | 60 s | 10 | Covered (`maintenanceAccess.js`). |
| `GET /maintenance/unlock`, `POST /maintenance/logout` | global only | IP | n/a | n/a | **Global only.** Read of the lockout status, and a logout of the caller's own cookie. |
| Any other unknown path (404 handler, SPA fallback) | global HTTP per IP | IP | as above | as above | Covered. |

Telemetry and analytics ingestion: **there is no ingestion route.** Telemetry is recorded only inside the server (`telemetryStore.record`), and the client sends no analytics. The global socket budget covers any event added later.

## Socket coverage

Connection admission (before any event): per-peer handshake budget, a tighter budget for unresolvable peers, and the open-connection cap. Session cookies are resolved on handshake.

### Account, auth and room lifecycle (`serverSocketAccount.js`)

| Event | Limiter now | Key | Window | Budget | Status |
| --- | --- | --- | --- | --- | --- |
| `check-username` | per-peer username budget | Peer | 60 s | 30 | Covered (budget now configurable). |
| `account-register` | per-peer auth budget | Peer | 60 s | 8 | Covered. A successful attempt does not refund the budget. |
| `account-login` | per-peer auth budget + per-account lockout (`accountStore`: 10 failures per 15 min) | Peer + account | 60 s / 15 min | 8 / 10 | Covered. |
| `account-restore` | none beyond global | n/a | n/a | n/a | **Intentional.** Presents a 256-bit session token, which cannot be guessed. Not spent against the password budget. |
| `account-logout` | global only | n/a | n/a | n/a | **Global only.** Cheap, revokes the caller's own session. |
| `account-update` | `accountWrite` (NEW) | Account | 60 s | 60 | **Now covered.** |
| `restore-session` | global only | n/a | n/a | n/a | **Global only.** Reconnect lookups are keyed by a client id the server already issued, and a mass reconnect (server restart) must not be refused. |
| `list-rooms` | global only | n/a | n/a | n/a | **Global only.** Cheap read of the public list. |
| `get-maintenance-state` | global only | n/a | n/a | n/a | **Global only.** Constant-size read. |
| `create-room` | `roomCreate` (NEW) + private-code probes through `joinFailure` | Peer | 60 s | 60 | **Now covered.** |
| `join-room` | `joinFailure` (failed attempts only) | Peer | 10 min | 30 failures | Covered. Successful joins are not counted, so real play is unaffected. |
| `leave-room` | global only | n/a | n/a | n/a | **Global only.** Releases the caller's own seat. |
| `set-player-appearance` | `accountWrite` (NEW) | Account | 60 s | 60 | **Now covered.** |
| `set-setting` | `accountWrite` (NEW) | Account | 60 s | 60 | **Now covered.** |
| `start-game` | global only | n/a | n/a | n/a | **Global only.** Host action that runs once per round. |
| `account-export` | `accountExport` (NEW) | Account | 10 min | 5 | **Now covered.** |
| `account-revoke-sessions` | global only | n/a | n/a | n/a | **Global only.** Cheap, touches only the caller's sessions. |
| `account-delete-request`, `account-delete-cancel` | per-peer auth budget (password checks) | Peer | 60 s | 8 | Covered. |
| `account-recovery-email-request` | per-peer auth budget (password check) | Peer | 60 s | 8 | Covered. |
| `account-recovery-email-verify` | per-peer auth budget (NEW) | Peer | 60 s | 8 | **Now covered.** Tokens are single-use and unguessable, but each guess costs a lookup. |

### Social, friends, chat, invites, patrol (`serverSocketSocial.js`)

| Event | Limiter now | Key | Window | Budget | Status |
| --- | --- | --- | --- | --- | --- |
| `send-chat` | per-socket cooldown + global | Socket | 500 ms | 1 message | Covered (existing). |
| `send-friend-request` | social action | Account | 60 s | 30 | Covered. |
| `respond-friend-request` | global only | n/a | n/a | n/a | **Global only.** Changes one friendship the caller is party to. |
| `remove-friend`, `block-player`, `cancel-friend-request` | social action | Account | 60 s | 30 | Covered. |
| `mark-notification-read` | social action (skipped when already read) | Account | 60 s | 30 | Covered. |
| `report-player` | social action | Account | 60 s | 30 | Covered. |
| `send-room-invite` | social action | Account | 60 s | 30 | Covered. |
| `respond-room-invite` | global only | n/a | n/a | n/a | **Global only.** Answers one invite. |
| `get-social-data`, `get-self-profile`, `get-friends`, `get-friend-requests`, `get-notifications`, `get-recent-players`, `clear-recent-players` | global only | n/a | n/a | n/a | **Global only.** Bounded lookups of the caller's own data. |
| `get-match-history` | social action (NEW), anonymous per peer | Account or peer | 60 s | 30 | **Now covered.** |
| `get-public-player-card` | social action, anonymous per peer | Account or peer | 60 s | 30 | Covered (existing). |
| `search-players` | social action, anonymous per peer | Account or peer | 60 s | 30 | Covered (existing). |
| `get-leaderboard`, `get-leaderboard-snapshot` | social action + 30 s cache + busy answer | Account or peer | 60 s | 30 | Covered (existing). |
| `get-computer-profile` | anonymous per peer (NEW) | Peer | 60 s | 30 | **Now covered.** Scans every stored match per call. |
| `start-patrol-run` | social action | Account | 60 s | 30 | Covered (existing). |
| `ready-patrol-target`, `hit-patrol-target`, `pause-patrol-run`, `resume-patrol-run`, `finish-patrol-run` | global only | n/a | n/a | n/a | **Global only.** Run-scoped: each answer is checked against the server's own run record and timers, and the run is owned by the account that started it. |

### In-room game verbs (`serverSocketGame.js`)

| Events | Limiter now | Key | Window | Budget | Status |
| --- | --- | --- | --- | --- | --- |
| `roll-dice`, `end-turn`, `purchase-property`, `upgrade-bank-account`, `fly-to-airport`, `set-airport-fees`, `decline-property`, `auction-bid`, `manage-property` | global only | Socket + peer | 10 s | 240 / 960 | **Global only.** Bursty, server-authoritative, and each one is validated by the room state. Escalation applies if a peer hammers them. |
| `propose-trade`, `counter-trade`, `adjust-trade`, `cancel-trade`, `respond-trade` | global only | Socket + peer | 10 s | 240 / 960 | **Global only.** As above. |
| `propose-player-contract`, `counter-player-contract`, `adjust-player-contract`, `respond-player-contract`, `repay-player-contract`, `cancel-player-contract` | global only | Socket + peer | 10 s | 240 / 960 | **Global only.** As above. |
| `pay-jail-fine`, `use-jail-free`, `use-item`, `sell-item`, `take-bank-loan`, `repay-bank-loan`, `get-bank-loan-offer`, `get-economy-snapshot` | global only | Socket + peer | 10 s | 240 / 960 | **Global only.** As above. |
| `market-order`, `open-margin`, `reduce-margin`, `open-short`, `cover-short`, `settle-short-default`, `open-option`, `exercise-option`, `close-position` | global only | Socket + peer | 10 s | 240 / 960 | **Global only.** As above. |
| `place-casino-bet`, `vote-global-event`, `declare-bankruptcy`, `player-presence`, `room-votekick-start`, `room-votekick-cast`, `propose-equity-share-transfer` | global only | Socket + peer | 10 s | 240 / 960 | **Global only.** As above. |
| `request-sponsored-purchase`, `contribute-sponsored-purchase`, `withdraw-sponsored-purchase`, `accept-sponsored-purchase`, `decline-sponsored-purchase` | global only | Socket + peer | 10 s | 240 / 960 | **Global only.** As above. |

Admin socket events: **none.** Every admin action is an HTTP route above.

AI and bot advisor: **no public endpoint.** Advisor calls run server-side. The admin provider routes are listed under HTTP.

## Tuning

- A player who reaches a per-identity budget is told so with a stable `code`. Raise the matching `<PREFIX>_LIMIT` rather than the global budget.
- Budgets that could trip real play are: `roomCreate` (60 per minute per peer; far above what one person creates, but a shared NAT address pools it), `accountWrite` (60 per minute per account), and the social action budgets (30 per minute per account). For a load test, set the relevant `<PREFIX>_LIMIT=0`, or the global `POORUP_SOCKET_RATE_LIMIT`, and never disable the global socket budget in production.
- An escalated block affects every client behind one peer address, so a shared NAT (school, office, mobile carrier) can be slowed together. Raise `POORUP_SOCKET_BLOCK_THRESHOLD` if that happens.
