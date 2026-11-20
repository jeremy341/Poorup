# Security notes

What the server protects, how, and where in the code. The HTTP response policy
is in [security-headers.md](security-headers.md) and the request budgets are in
[rate-limits.md](rate-limits.md); this page covers sockets, accounts, sessions,
operator routes and the container. It comes from a read-through of the socket
layer and account stores in November 2026, where each suspected defect was
reproduced in-process before it was fixed. No live server, browser run or full
`docker build` was part of that review.

`npm audit --omit=dev` runs in CI (`.github/workflows/ci.yml`).

## Defects found and fixed

Each has a regression test that fails without the fix.

| Area | What was wrong | Fix | Where | Test |
| --- | --- | --- | --- | --- |
| Sign-out | `account-logout` over the socket cleared the socket's binding but left the cookie session alive, so the next social call re-authenticated the socket. | The handler also revokes the socket's own session, like `POST /account/logout`. | `serverSocketAccount.js` (`account-logout`), `socketSocialApi.js` (`accountForSocket`) | `socket-logout-session.test.js` |
| Sign-in lockout | Failures were counted per account, so one address could lock any known account out indefinitely. | Failures are counted per (username, source): 10 per 15 minutes, plus 50 per username across all sources. The source comes from the transport (`authAttemptKey(socket)`), never from the payload. A correct password clears only the signing-in source; a password reset clears the whole name. | `loginFailures.js`, `accountStore.js` (`login`) | `login-lockout.test.js`, `account-auth-abuse.test.js` |
| Lockout leaks the name | A locked known name answered `ACCOUNT_LOCKED` faster than an unknown name's generic error. | A source that locked itself gets `ACCOUNT_LOCKED` for known and unknown names alike. Past the all-sources cap a name answers with the generic wrong-password error after the same scrypt work. | `accountStore.js` (`login`) | `login-lockout.test.js` |
| Password hashing cost | scrypt ran at Node's default cost (N=16384, r=8, p=1) with no way to raise it. | The KDF parameters are stored per record. Current cost is N=32768, r=8, p=3 (about 190 ms per derivation here). Old records verify with the old cost and are rehashed on the next correct sign-in. Out-of-range stored parameters fall back to the old cost. | `accountSecurity.js` (`CURRENT_SCRYPT`, `hashPassword`) | `password-kdf.test.js` |
| Base image | `FROM node:22-bookworm-slim` floated on a tag. | Pinned to the multi-arch digest. | `Dockerfile` | `dockerfile-hardening.test.js` |
| Stale fixture | `social-socket-guards.test.js` failed and was not in the manifest. | Fixture corrected, suite registered. | `scripts/test-manifest.mjs` | `social-socket-guards.test.js` |

Consequences to know about:

- scrypt is synchronous, so each sign-in, registration and password check holds
  the event loop for about 190 ms. The per-peer auth budget (8 per minute) bounds
  that.
- 50 failures from many addresses still make the real owner's sign-in answer
  "incorrect" until the 15-minute window ends or the password is reset. That is
  the price of bounding distributed guessing; the recovery-email flow is the way
  out.
- A pinned base image stops receiving patches until someone bumps the digest.
  Bump it on a schedule.

## Open decisions

- **Trusted proxy hops (operator action).** `POORUP_TRUST_PROXY_HOPS` defaults
  to 0. Behind a reverse proxy with the default, every client resolves to the
  proxy's address and shares one pre-auth budget (8 sign-ins a minute, 30
  username checks a minute, 30 failed joins per 10 minutes, the operator-unlock
  budget, and the HTTP limiter), so one client can exhaust sign-in for everyone.
  The default stays 0 on purpose: with hops above 0 and no proxy in front, a
  client could pick its own bucket by sending `X-Forwarded-For`. The code cannot
  know the deployment, so production prints an advisory at boot
  (`proxyTrustAdvisory` in `serverConfig.js`, test `trust-proxy-advisory.test.js`).
  The live host sets `POORUP_TRUST_PROXY_HOPS=1` for its single Caddy hop; confirm
  that value in the host env file. If the app port is reachable without the proxy,
  also set `POORUP_TRUSTED_PROXY_ADDRESSES` (see [rate-limits.md](rate-limits.md)).
- **Registration reveals taken names.** `account-register` and `check-username`
  say when a name is taken. This is intended (a player must be told), and
  `check-username` is budgeted at 30 per minute per address.
- **Inline styles.** `style-src-attr 'unsafe-inline'` stays; see
  [security-headers.md](security-headers.md).

## What is protected, and how

**Socket authorization**
- Host-only actions (`set-setting`, `start-game`) compare `room.hostId` with the
  caller's own seat; `set-setting` also refuses once the game has started.
- Game verbs take the actor from the socket (`makeRoomVerbHandler`,
  `room[verb](socket.id, …)`). Trade, contract and sponsorship proposers come from
  `getPlayerBySocket`, and payload ids are only counterparties. No handler reads
  an actor id from the payload.
- Turn order is enforced in the room: a seat off turn cannot roll or end the turn.
- A guest cannot reclaim a disconnected account-owned seat by presenting its
  client id (`restoreConnection` and `addOrReconnectPlayer` refuse it).
- `leave-room` and `create-room` release a seat only for its own socket or the
  owning account's disconnected seat (`canManageSeat`).
- Room invites, friend requests, blocks, notifications and vote-kick all derive
  the actor from the socket and check that the caller is the recipient, addressee
  or an eligible human.
- Patrol runs belong to the account and socket that started them.
- A client id goes only to its own seat.

**Sessions and tokens**
- Session tokens are 32 random bytes, stored as SHA-256 hashes. Cookie sessions
  expire after 30 idle days or 90 absolute days (`sessionStore.js`).
- Logout revokes the session. A password change revokes all the account's
  sessions. A new sign-in revokes older ones.
- Password comparison and operator-token comparison use `timingSafeEqual` on
  digests (`tokensMatch`). Recovery tokens are 256-bit, stored hashed, valid for
  30 minutes and single use.
- Cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` in production or with
  `POORUP_COOKIE_SECURE=true`.

**Input**
- Socket payloads that are not objects become `{}` (`normalizeWirePayload`);
  `maxHttpBufferSize` is 100 KB (`server.js`). Length caps: chat 250 code points,
  room nickname 24, profile name 18, search 32, report reason 80, request ids
  100 to 120, client id 120.
- `setRoomSetting` requires an own key, so `__proto__` and `constructor` are
  rejected. Ruleset overrides are blocked at the socket and filtered to
  `ROOM_OVERRIDE_KEYS` at the room. Profile updates go through a field whitelist
  (`applyProfilePatch`).
- Every numeric money verb (trade, margin, shorts, casino bets, bank loans,
  auction bids) rejects NaN and Infinity without changing state.
- The one dynamic `RegExp` (`socialStore.redactDisplayName`) escapes its input.

**Rendering of server text**
- Chat, player names, sponsorship copy, deed names and trade previews go through
  `esc` before `innerHTML`. Display names also lose `< > " & =`, slashes and
  backticks before they are stored (`NAME_DISALLOWED_RE`). Colors are validated
  as `#rrggbb` before they reach a `style` attribute. The review covered the
  sites that interpolate player-controlled strings, not the purely static markup.

**Secrets and personal data**
- No `console.*` call in `server/` or `scripts/` logs a token, password, email or
  payload; the shared error handler logs `error.message` only.
- Public projections (`publicAccount`) omit password hashes, salts and session
  hashes; the recovery email goes only to its owner; the account export is a
  whitelist.
- Admin identity comes from `POORUP_ADMIN_ACCOUNT_IDS`. The operator password is
  read from the environment, compared as a digest and warned about under 12
  characters. `scripts/loadEnvFile.cjs` rejects unquoted shell syntax and never
  echoes values. `.gitignore` and `.dockerignore` exclude `.env*`,
  `server/data` and `server/backups`.

**Admin and maintenance routes**
- `/admin/ops/*` and `/admin/ai/*`: no session is 401, a non-admin is 403, and in
  production a write without an `Origin` header is refused. Writes are budgeted at
  12 per minute per account (`adminOpsGuard.js`).
- `/internal/*` routes return 404 when no token is configured and 403 on a wrong
  token.

**Container**
- The image runs as `USER node`, holds no secrets, excludes live data, backups and
  env files through `.dockerignore`, and its health check uses `/readyz`.

## Not covered

- No live-server, browser (`npm run test:browser`) or full `docker build` pass was
  part of the review.
- The `innerHTML` review sampled player-controlled sites and did not read the
  static markup.
- Uniform answers from the password-reset request were read from code, not probed.
