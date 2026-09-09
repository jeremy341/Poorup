# Poorup Release-Readiness Audit — 2026-09-08

## Scope and constraint

This is a release audit of the current server, persistence, socket, game-rule,
bot, economy, social, test, dependency, and CI surfaces. No UI or frontend
source files were changed during this audit. Targeted server-only correctness
and hardening fixes were applied across authentication, persistence, money and
deed settlement, contracts, global events, sockets, and both bot brains.
Trade property legs are bounded and deduplicated, unreadable stores fail
closed, atomic rename failures preserve the previous snapshot, resume
identifiers are viewer-scoped, socket ingress has a bounded rate limiter and
packet-size cap, production CORS fails closed until configured, and bots now
share the human post-roll finance window instead of being roll-only.

## Repository state

- Branch: `codex/codescene-cleanup`
- Working tree: audit changes are ready to commit; an unrelated pre-existing
  README edit and the user-supplied raw audit notes are intentionally
  preserved.
- Base: merged `main` at `c62cd64`
- Latest committed audit-fix commits are `d4749e4` (server release paths) and
  `d48a98e` (expanded audit record); the current follow-up patch covers the
  deep money, auth, persistence, lifecycle, and bot findings below.
- JSON stores under `server/data/` remain ignored and local. They were not
  deleted or rewritten during this audit.

## Evidence collected

| Gate | Result |
| --- | --- |
| `npm test` | PASS — complete contract, persistence, bot, event, economy, socket, social, and history suite (`POORUP_BOT_SIMULATION_COUNT=100`; socket child-process run verified outside the restricted sandbox) |
| `npm run lint` | PASS — server ESLint |
| `npm run lint:client` | PASS — client ESLint; inspected only, no UI edits |
| `npm run coverage` | PASS — 90.47% statements, 79.13% branches, 88.87% functions (`POORUP_BOT_SIMULATION_COUNT=100`) |
| `npm audit --omit=dev --audit-level=moderate` | PASS — 0 vulnerabilities |
| `node --check` | PASS — all server JavaScript files (81 files) |
| `npm pack --dry-run` | PASS — 227 files; npm warns that no `.npmignore` exists |
| Rename-failure persistence probe | PASS — previous snapshot preserved and temp recovery file retained |
| Bot balance campaign | PASS — 2,500 bounded games, 1,994 completed within 2,000 steps, 0 stalled (baseline campaign; the 100-game post-roll regression campaign also passes) |
| Bot status/reconnect wire probe | PASS — 18/18 checks, repeated successfully |
| Release hardening seams | PASS — 13 CORS/rate-limiter checks |
| `git diff --check` | PASS |
| CodeScene delta | UNVERIFIED — local CLI could not authenticate to `codescene.io/oauth2/token` in this environment |

## Server-only findings

### Deep follow-up fixes (RESOLVED)

The second line-by-line pass closed the remaining verified server defects from
the raw audit notes:

- session rotation and logout now revoke every persisted token hash;
- explicit invalid tokens clear cached socket identity, while no-token
  reconnects use the cache only when it is still valid;
- valid JSON with the wrong root shape is quarantined for every store;
- bankrupt creditors cannot receive in-flight rent or liquidation cash;
- mortgage and unmortgage pricing use the same event value multiplier;
- auction and bank-release deed paths terminate stale equity and deduplicate
  ownership;
- debt-mode bankruptcy settles contracts before forfeiting deeds, and hybrid
  borrowers default the funded loan leg correctly;
- missing-lender repayments preserve borrower cash;
- market shocks apply once per event activation, while interest shocks and
  labor-strike shortfalls create their intended settlement records;
- hybrid collateral remains encumbered for build, mortgage, sale, and trade;
- disconnected/dead bots are rejected, hybrid stats/history fields are
  preserved, and pending payment queues are activated and cleaned safely;
- end-game winner selection excludes disconnected seats; started-game leaves
  settle obligations and assets; house/hotel limits and the room trading flag
  are enforced by the server;
- stale joins, duplicate account seats, stale contract cancels, bounded client
  identifiers, unauthenticated invites, and malformed social records are
  rejected or sanitized;
- the deterministic and AI bot paths now expose the post-roll purchase,
  repayment, mortgage/unmortgage, market, casino, contract, trade, chat, and
  safe end-turn candidates. A sender waits instead of repeatedly reopening a
  pending human deal.

The stable opaque `accountId` remains in the existing room/profile protocol as
the lookup key for the current social client. It is not a session credential;
changing that protocol would be a separate privacy/API migration and was
outside the no-UI-change audit scope.

### R1 — Resume client IDs were exposed in room snapshots (RESOLVED)

**Evidence:** `server/rooms.js` and `server/summaryApi.js` previously serialized
`clientId` for every seat, while `restore-session` accepts a client ID as a
resume key. A remote observer could reuse a leaked identifier to subscribe to
the room without owning that seat.

Room and game projections are now viewer-scoped: only the viewer’s own seat
receives `clientId`; remote seats keep their server player ID but no resume
credential. Direct projection assertions and the live server wire suite pass.

### R1 — Production CORS requires deployment configuration

**Evidence:** Socket.IO CORS behavior is controlled by
`POORUP_ALLOWED_ORIGINS`; an unset production value now fails closed for
browser origins, while local development remains permissive.

The server supports an environment-backed allow-list through
`POORUP_ALLOWED_ORIGINS` and emits a production warning when it is missing.
A public deployment must set the allow-list or browsers will be unable to open
the socket; this is an explicit deployment requirement, not a game-rule defect.

### R1 — JSON persistence is single-process and has no write lock

**Evidence:** `server/serverStorePaths.js:10-13`, `server/storeIO.js:41-63`.

Writes are atomic for the normal rename path, but simultaneous server
processes do not coordinate. Running multiple replicas against one directory
can lose the last writer's accounts, social graph, matches, or achievements.
The current architecture is release-safe only as a single-instance service;
use one instance or move stores behind a transactional database before
horizontal scaling.

### R2 — Unreadable-store errors were treated like missing files (RESOLVED)

**Evidence:** `server/storeIO.js:15-21` catches every read error and returns
`missing: true`. This audit changed the seam to recognize only `ENOENT` as a
missing file and fail fast for permission/sharing errors (`server/storeIO.js`).

The regression suite now covers the non-`ENOENT` path. Corrupt JSON continues
to be quarantined, while unreadable files cannot silently become empty stores.

### R2 — Rename fallback is not atomic (RESOLVED)

**Evidence:** `server/storeIO.js:52-63` previously fell back to direct write
after a failed rename, which could truncate the previous file.

The implementation now preserves the previous snapshot, leaves the complete
temp file for recovery, and throws a durable-write error. Normal and
rename-failure paths are both covered by persistence tests. A transactional
datastore is still required for multi-instance durability.

### R2 — Gameplay payload abuse needs edge limits (server baseline added)

The server now applies a per-socket ingress token bucket before handlers, with
deployment-tunable `POORUP_SOCKET_RATE_LIMIT` and
`POORUP_SOCKET_RATE_WINDOW_MS`, plus a 100 KB Socket.IO packet cap. Chat/social/
patrol limits and the 40-leg trade cap remain in place. Add an IP/edge limiter
as a second layer before public launch if the deployment is exposed to
untrusted traffic.

### R1 — Account/guest seat takeover and failed-join cleanup (RESOLVED)

Reconnect and join paths now reject mismatched account identities, reject a
second live socket trying to rebind a seat, bound client-session identifiers,
and authorize leave/create cleanup against the owning socket or account. A
failed join no longer detaches the socket from its existing room.

### R1 — Multiple simultaneous debt defaults overwrote one another (RESOLVED)

Independent unsecured bank defaults are now queued behind the active payment
obligation. Clearing a payment activates the next claim, and game reset/end
clears the queue so no default disappears silently.

### R1 — Started-game leave orphaned assets (RESOLVED)

An explicit mid-round leave now settles the departing seat's obligations,
liquidates market positions, terminates contracts, releases deeds, and removes
the seat without leaving owner IDs pointing at a missing player.

### R2 — Stale deal and bot decisions (RESOLVED)

Contract cancellation now validates the contract ID. Trade adjustment/counter
depth is capped. AI trade/contract choices and auction bids capture the offer
version and abandon the action if a human changes it while the provider is
thinking.

### R2 — Economy/achievement consistency (RESOLVED)

Auction ownership refreshes completed-group facts, final-cure repayment only
sets its achievement fact after a successful full payment, crisis achievements
recognize both event IDs and projected titles, and card payment results report
the actual amount paid when a debt is partial. Existing equity shares cannot be
used as bank collateral.

### R2 — Store/input hardening (RESOLVED)

Social and account match-history loaders filter malformed records; match history
retention is bounded in memory as well as on disk; failed temp writes clean up
partial files; login rejects oversized passwords before scrypt; and the recent
player clear action works from an authenticated socket without resending a
token.

## Verified non-findings

- Passwords use salted `crypto.scryptSync`; login compares hashes with
  `timingSafeEqual` (`server/accountStore.js:342-350,495-504`).
- Session tokens are random 32-byte values and only their SHA-256 hashes are
  persisted (`server/accountStore.js:347-351,438-443`).
- AI credentials and provider failures stay server-side; prompts use a
  redacted candidate/context projection.
- Room codes are random six-character values. Public directory rows are
  rendered as OPEN TABLE by the client; the existing directory protocol still
  carries an internal join code for the current client contract, while private
  access acks explicitly reveal the invite code.
- Trade, contract, auction, economy, settlement, bankruptcy, and reconnect
  actions are server-authoritative and covered by contract tests.
- Test wire servers now use temporary store directories; normal application
  data is not mutated by the test pipeline.
- No committed `.env`, password, API key, or credential file was found.
- No syntax errors were found in the 120 shipped JavaScript files.

## Release verdict

**Conditional release candidate, not fully production-cleared.** The game and
its planned systems pass the functional, persistence, bot, socket, coverage,
dependency, and syntax gates. It is suitable for a single-instance beta or
controlled playtest after setting deployment secrets and backing up
`server/data`.

Before an unrestricted public production launch, resolve or explicitly accept:

1. CodeScene verification (blocked here by unavailable OAuth/network access).
2. Set `POORUP_ALLOWED_ORIGINS` to an allow-list in production (otherwise the
   fail-closed CORS policy intentionally blocks browser clients).
3. An operational backup plan for the JSON stores.
4. Edge-level/IP rate limiting as a second layer beyond the in-process limiter.

These items do not require UI changes and are independent of the board layout.
