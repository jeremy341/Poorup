# Security audit: sockets, auth, accounts and deployment

Date: 2026-11-20 · Branch: `feat/socket-auth-security-audit` · Scope: `server/` socket layer, account and session stores, admin and
maintenance routes, client `public/` rendering of server text, `Dockerfile`, production dependencies.

Method: read the socket handlers and their helpers end to end, then confirmed each suspected defect with a probe against the real
modules (scratch scripts outside the repo, run with `node`) before writing a failing regression test. Probes are in-process; no live
server or browser run was done. Findings are ordered by severity.

## Summary

| ID | Severity | Finding | Status |
|---|---|---|---|
| F-01 | Medium | Socket sign-out acked success but left the cookie session alive, and the same socket re-bound the account on its next call | **Fixed** (regression tests added) |
| F-02 | Medium | One source can lock any known account out of sign-in (per-account lockout, not per-source) | **Fixed**: failures are counted per (username, source), with a higher all-sources cap |
| F-03 | Medium | With `POORUP_TRUST_PROXY_HOPS` unset, a reverse proxy makes all clients share one pre-auth budget | **Partly fixed**: production boot advisory added; default left at 0 on purpose |
| F-04 | Low | `ACCOUNT_LOCKED` reveals that a username exists, and the locked path skips the scrypt that unknown names pay | **Fixed**: unknown and known names get the same lock answer; the all-sources cap answers generically |
| F-05 | Low | Password hashing uses Node's default scrypt cost (N=16384), below current guidance, with no rehash on login | **Fixed**: per-record cost (N=32768, r=8, p=3), rehash on the next correct sign-in |
| F-06 | Low | Dockerfile base image referenced by a floating tag | **Fixed**: pinned to a digest |
| F-07 | Info | `server/socialSocketAudit.test.js` fails, and it is not registered in the manifest | **Fixed**: stale fixtures corrected, test registered in the core manifest |

Dependency audit (`npm audit --omit=dev`): 0 vulnerabilities (info 0, low 0, moderate 0, high 0, critical 0). No upgrades were needed.

---

## F-01 · Medium · Socket sign-out left the cookie session live

**Where:** `server/serverSocketAccount.js`, `account-logout` handler; the re-bind is `accountForSocket` in `server/socketSocialApi.js`.

**Evidence (before the fix).** The handshake middleware in `server/server.js` binds `socket.data.sessionId` from the browser's session
cookie. `account-logout` cleared the socket's account binding and revoked the legacy bearer token, but never the cookie session. The next
social call fell back to the cookie and re-authenticated the socket:

```
before logout, socket account: probeuser
account-logout ack: {"success":true}
after logout, socket account (no token): probeuser
cookie session still resolves: true
```

The HTTP route `POST /account/logout` revokes the cookie. The client calls both paths, so a normal sign-out worked. A sign-out whose HTTP
request failed, or any socket that outlived it, stayed signed in.

**Fix.** `account-logout` now also revokes the socket's own session (`socket.data.sessionId`, which `sessionStore.revoke` accepts) and clears
the session binding. This mirrors the HTTP logout.

**Tests.** `server/socket-logout-session.test.js` (2 tests). Both failed before the fix (`the cookie session must be revoked by sign-out`)
and pass after it. Registered in the `core` and `account` groups.

**Status: fixed.**

---

## F-02 · Medium · Per-account lockout can be triggered from one source

**Where:** `server/accountStore.js`, `passwordFailures`, `passwordLocked`, `recordPasswordResult`, `login`.

**Evidence.** The failure counter is keyed by account, not by source address. Ten wrong guesses from one address lock the account for every
client. The socket's own budget (8 attempts per minute per address) lets one address reach ten failures in about two minutes.

```
victim correct password after attacker lockout: ACCOUNT_LOCKED
```

The 15-minute window restarts with each new burst, so one address can keep a known account locked indefinitely.

**Why not fixed.** Any change to who gets locked out, and for how long, changes the brute-force guarantee. Options for a decision:
(a) count failures per (account, source) and keep a higher account-wide cap, such as 50 per 15 minutes, so a single source cannot lock out
others while distributed guessing stays bounded; (b) progressive delays instead of a hard lock; (c) a notice and the recovery-email flow
for a locked owner. The change touches `login`'s signature (it needs the source), so it should be made with the user.

**Status: fixed.** `server/loginFailures.js` counts failures per (username, source) with a limit of 10 per 15 minutes, and per username across all
sources with a limit of 50. `login(payload, { source })` takes the source from the transport (`authAttemptKey(socket)`), never from the client
payload. A correct password clears only the signing-in source's count, so the owner cannot lift a lock another address earned; a password
reset clears the whole name. Tests: `server/login-lockout.test.js`, `server/account-auth-abuse.test.js`.

Residual risk: 50 failures spread over many addresses still make the real owner's sign-in answer "incorrect" until the window ends or the
password is reset. That is the price of bounding distributed guessing; the recovery-email flow is the way out.

---

## F-03 · Medium · Shared pre-auth budget behind a reverse proxy

**Where:** `server/serverSocketAccount.js` `authAttemptKey`, `server/serverConfig.js` `resolveClientAddress`. Default
`POORUP_TRUST_PROXY_HOPS=0` (`server/server.js`, `.env.example`).

**Evidence.** With the hop count unset and Caddy on the same host, every client resolves to the proxy's address:

```
hops unset  -> keys: 127.0.0.1 | 127.0.0.1 | 127.0.0.1
hops=1      -> keys: 198.51.100.1 | 198.51.100.2 | 198.51.100.3
```

Every pre-auth budget uses this key: 8 sign-in attempts per minute, 30 username checks per minute, 30 failed joins per 10 minutes. One
client can therefore exhaust sign-in for every visitor. The operator unlock budget (5 failures per 15 minutes) has the same key, because
Express `req.ip` is the proxy when `trust proxy` is off (`server/server.js` line 72). The HTTP request limiter (`server/httpRateLimiter.js`)
has the same default. That file belongs to another agent and was not changed here.

**Why the default stays 0.** With hops greater than 0 and no proxy in front, a client supplies its own `X-Forwarded-For`, and the server
takes the last entry as the client address. A client could then pick its own budget key. The correct value depends on the deployment, so the
code cannot choose it.

**Fix (partial).** `proxyTrustAdvisory` in `server/serverConfig.js` returns a message when `NODE_ENV=production` and the hop count is
unset or 0. `server/server.js` prints it at boot. Test: `server/trust-proxy-advisory.test.js` (3 tests, red before the function existed).
The production runbook (`docs/deployment/nest-live-runbook.md`) already sets `POORUP_TRUST_PROXY_HOPS=1` for a single Caddy hop, so the
operator action is to confirm that value is in the production env file.

**Status: partly fixed (advisory). Operator must set the hop count.**

---

## F-04 · Low · Lockout reveals account existence and timing

**Where:** `server/accountStore.js` `login`.

**Evidence.** After ten failures, a known username returns `ACCOUNT_LOCKED`, while an unknown username keeps returning the generic error:

```
unknown name after 10 wrong guesses: Username or password is incorrect.
known name after 10 wrong guesses:   ACCOUNT_LOCKED
```

The locked branch also returns before the `scrypt` call that unknown names pay (`login` runs a dummy derivation for unknown names), so
its response is faster. Changing the timing alone would not help, because the code itself still reveals the lock. Removing the difference
requires changing the lock message, which is a UX decision tied to F-02.

**Status: fixed (with F-02).** A source that has locked itself gets `ACCOUNT_LOCKED` for known and unknown names alike (tested with deepEqual).
Past the all-sources cap, a name answers with the generic wrong-password error after paying the same scrypt as any other attempt, so neither
the message nor the timing reveals the name.

---

## F-05 · Low · Password hashing cost

**Where:** `server/accountSecurity.js` `hashPassword`: `crypto.scryptSync(password, salt, 64)` with Node's defaults (N=16384, r=8, p=1).

**Observation.** One derivation takes about 44 ms here. N=16384 is below the cost OWASP currently recommends for scrypt (N=2^17). Raising
it means about 128 MB per derivation (r=8), which is synchronous, so it adds real pressure on the event loop and memory under login load.
Changing it also requires rehash-on-login for existing records, since the stored parameters are implicit.

**Status: fixed.** `passwordKdf` ({ N, r, p }) is stored per record. Records without it verify with the old defaults and move to
N=32768, r=8, p=3 (OWASP's 32 MiB setting) with a fresh salt at the next correct sign-in (`login`). Stored parameters outside a sane range
fall back to the old cost. Tests: `server/password-kdf.test.js`.

Cost: about 190 ms per derivation here (it was about 36 ms), synchronous, so each sign-in, registration and password check holds the event
loop for that long. The per-address auth budget (8 per minute) bounds it.

---

## F-06 · Low · Base image floated on a tag

**Where:** `Dockerfile` line 1 (was `FROM node:22-bookworm-slim`).

**Fix.** Pinned to the multi-arch index digest `sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee`, resolved with
`docker buildx imagetools inspect`. The digest was confirmed to resolve. Test: `server/dockerfile-hardening.test.js` (red before the change:
`the base image is pinned by digest`; green after). Trade-off: a pinned digest stops receiving base-image patches until someone bumps it,
so bump it on a schedule.

**Status: fixed.**

---

## F-07 · Info · Stale social audit fixtures

`server/socialSocketAudit.test.js` failed with `warm snapshot contains both public accounts (0 !== 2)`. The server was changed on purpose to
hide friends-only achievements from signed-out viewers (`withAchievementPrivacy`), but the test's default account fixture still used
`achievements: 'friends'` and expected those accounts in public rankings. The fixture default is now `'public'`, and the suite is registered
in the core manifest so it runs in `npm test`.

---

## Checked and found clean

**Socket authorization**
- Host-only actions (`set-setting`, `start-game`) compare `room.hostId` to the socket's own seat. `set-setting` also refuses once the game starts.
- Game verbs bind the actor to `socket.id` (`makeRoomVerbHandler`, `room[verb](socket.id, …)`). Trade, contract and sponsorship verbs read the
  proposer from `getPlayerBySocket(socketId)`, and payload IDs are only counterparties. A grep for payload-supplied actor fields found none.
- Turn enforcement: a seat not on turn gets `It is not your turn.` for roll-dice and `Only the active player can end the turn.` for end-turn.
  The current player is unchanged after both refusals (probe).
- Seat reclaim: a guest socket presenting the clientId of a disconnected account-owned seat is refused by both `restoreConnection` and
  `addOrReconnectPlayer` (`That seat is already linked to another account.`), and the seat keeps its account (probe).
- `leave-room`/`create-room` release a seat only for its owning socket, or for the owning account's disconnected seat (`canManageSeat`, read).
  A seat in another room is never released.
- Invites: `acceptRoomInvite` only uses an invite that `getInvite(account.id, …)` returns, so the recipient must match.
- Friend requests, blocks, notifications: `respondFriend` and `cancelFriendRequest` check the addressee/requester. Read-marking checks ownership.
- Vote-kick and presence derive the actor from the socket; the vote target must be an eligible human (`roomVoteKick.js`).
- Patrol runs are keyed to the owning account and socket.
- clientId is returned only to its own seat (`summarySeatAccount` is the only exposure, `entry.clientId` for `viewerPlayerId`).

**Tokens and sessions**
- Session tokens: 32 random bytes (`createSessionToken`, `sessionStore`), stored as SHA-256 hashes (`sessionHashes`, `byHash`).
- Expiry: cookie sessions have idle 30 days and absolute 90 days, and rotate on legacy exchange. Legacy tokens have a 90-day absolute lifetime.
- Logout revokes the token's sessions. A password change revokes the account's sessions. A new login revokes the account's older sessions.
- Password compare: `timingSafeEqual` on equal-length digests. Recovery tokens: 256-bit, stored hashed, 30-minute expiry, single-use, bound to
  the requesting account for email verification.
- Cookies: `HttpOnly`, `Secure` by default, `SameSite=Strict`.
- Operator tokens: `tokensMatch` compares SHA-256 digests with `timingSafeEqual`. Maintenance unlock compares a digest, signs cookies with an
  HMAC, and rate-limits per address.

**Enumeration**
- Login returns one generic error for an unknown name and a wrong password (F-04 covers the lock case only).
- Registration and `check-username` do reveal a taken name. This is by design, and the budget is 30 checks per minute per address.
- The password-reset request answers uniformly by design (code read; not probed).

**Input validation**
- `normalizeWirePayload` maps non-object payloads to `{}`. `maxHttpBufferSize` is 100 KB (`server.js`).
- Bounds: chat 250 code points; nicknames 24 (room) and 18 (profile); search 32; report reason 80; request IDs 100 to 120; clientId 120.
- Room settings: `setRoomSetting` requires an own key, so `__proto__` and `constructor` are rejected. `rulesetOverrides` is blocked at the
  socket layer and normalized to an empty list at the room layer. Overrides are filtered to `ROOM_OVERRIDE_KEYS`.
- NaN and Infinity (probe, market and loan features enabled): every numeric verb (`tradeMarket`, `openMargin`, `reduceMargin`, `openShort`,
  `placeCasinoBet`, `takeBankLoan`, `repayBankLoan`, `proposeTrade`, `placeAuctionBid`) rejected all three values with no state change.
- Prototype pollution (probe with JSON-parsed `__proto__` and `constructor` keys): none. Profile updates use a field whitelist (`applyProfilePatch`).
- Regex: the only dynamic `RegExp` (`socialStore.redactDisplayName`) escapes every syntax character it needs.

**Stored XSS (client)**
- Chat text uses `esc`. Player names, sponsorship copy and deed names use `esc`. Trade-contract previews use `esc`.
- Display names pass `NAME_DISALLOWED_RE`, which strips `< > " & =`, slashes and backticks before storage.
- Colors are server-validated as `#rrggbb` before they reach a `style` attribute.
- Coverage: 122 `innerHTML`/`insertAdjacentHTML` sites. I checked every site that interpolates a player-controlled string, not every
  site in full. Unchecked: the purely static markup.

**Secrets and PII**
- Every explicit `console.*` call in `server/` and `scripts/` was reviewed. None logs a token, password, email or payload.
- The shared HTTP error handler logs `error.message` only.
- Public projections (`publicAccount`) exclude `passwordHash`, `passwordSalt` and `sessionTokenHash`. `recoveryEmail` appears only to its owner.
  `accountExport` is a whitelist.
- Admin identity: `POORUP_ADMIN_ACCOUNT_IDS` (env). No credentials are in the repo. The operator password is read from env and warned on under
  12 characters. It is only compared as a digest.
- `.env` loading (`scripts/loadEnvFile.cjs`) rejects unquoted shell syntax and does not echo values. `.gitignore` and `.dockerignore` exclude
  `.env*`, `server/data`, and `server/backups`.

**Admin and maintenance routes**
- `/admin/ops` and `/admin/ai`: `requireAdmin` returns 401 for no session and 403 for a non-admin. Production rejects a missing `Origin`
  on writes. Writes are budgeted at 12 per minute per account.
- `/internal/*` routes return 404 when unset and 403 on a wrong token.

**Deployment**
- `USER node`, no `USER root`. `HEALTHCHECK`, `VOLUME`, and `ENV` values are configuration only, with no secrets. `.dockerignore` excludes
  live data, backups and env files.
- `npm audit --omit=dev`: 0 findings.

**Not covered**
- No live server, browser (`npm run test:browser`), or full `docker build` run.
- The `innerHTML` review sampled the player-controlled sites and did not review the static markup.
- Password-reset response uniformity was read from code, not probed.

---

## Tests

| Command | Result |
|---|---|
| `npm run test:account` | `Test manifest result: 16/16 passed · 6s summed suite time` |
| `npm test` | `Test manifest result: 217/217 passed · 175s summed suite time` |
| `node --test server/socket-logout-session.test.js` | 2/2 pass (red before the fix) |
| `node --test server/trust-proxy-advisory.test.js` | 3/3 pass (red before the function existed) |
| `node --test server/dockerfile-hardening.test.js` | 3/3 pass (digest check red before the pin) |
| `node server/serverSocketAccount.test.js`, `account-auth-abuse`, `socket-admission`, `release-hardening`, `serverSocketSocial`, `server`, `rooms`, `social-socket`, `accountRightsSocket` | exit 0 |
| `node scripts/ops-wiring.test.mjs`, `server/serverStorePaths.test.js` | exit 0 |
| `node server/socialSocketAudit.test.js` | 16 scenarios passed (F-07 fixed) |
| `npx eslint` on all changed `.js`/`.mjs` files | no output (clean) |
