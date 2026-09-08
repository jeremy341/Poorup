# Poorup Release-Readiness Audit — 2026-09-08

## Scope and constraint

This is a release audit of the current server, persistence, socket, game-rule,
bot, economy, social, test, dependency, and CI surfaces. No UI or frontend
source files were changed during this audit. Targeted server-only hardening
fixes were applied: trade property legs are bounded and deduplicated, unreadable
store files fail closed, atomic rename failures preserve the previous snapshot,
resume identifiers are viewer-scoped, and socket ingress has a bounded rate
limiter with configurable production CORS.

## Repository state

- Branch: `codex/codescene-cleanup`
- Working tree: clean after the audit fix commit
- Base: merged `main` at `c62cd64`
- Latest audit-fix commits include `d8a87dd` (preserve stores when atomic rename
  fails), `c6968c8` (release hardening gates), `eb49ed3` (viewer-scoped resume
  identifiers), and `77b9062` (include release checks in coverage).
- JSON stores under `server/data/` remain ignored and local. They were not
  deleted or rewritten during this audit.

## Evidence collected

| Gate | Result |
| --- | --- |
| `npm test` | PASS — complete contract, persistence, bot, event, economy, socket, social, and history suite |
| `npm run lint` | PASS — server ESLint |
| `npm run lint:client` | PASS — client ESLint; inspected only, no UI edits |
| `npm run coverage` | PASS — 92.85% statements, 82.35% branches, 92.39% functions (last completed run; a later redundant 1,000-game instrumented rerun was stopped after the normal suite had already passed) |
| `npm audit --omit=dev --audit-level=moderate` | PASS — 0 vulnerabilities |
| `node --check` | PASS — 120 shipped JavaScript files |
| `npm pack --dry-run` | PASS — 227 files; npm warns that no `.npmignore` exists |
| Rename-failure persistence probe | PASS — previous snapshot preserved and temp recovery file retained |
| Bot balance campaign | PASS — 2,500 bounded games, 1,994 completed within 2,000 steps, 0 stalled |
| Bot status/reconnect wire probe | PASS — 18/18 checks, repeated successfully |
| Release hardening seams | PASS — 11 CORS/rate-limiter checks |
| `git diff --check` | PASS |
| CodeScene delta | UNVERIFIED — local CLI could not authenticate to `codescene.io/oauth2/token` in this environment |

## Server-only findings

### R1 — Resume client IDs were exposed in room snapshots (RESOLVED)

**Evidence:** `server/rooms.js` and `server/summaryApi.js` previously serialized
`clientId` for every seat, while `restore-session` accepts a client ID as a
resume key. A remote observer could reuse a leaked identifier to subscribe to
the room without owning that seat.

Room and game projections are now viewer-scoped: only the viewer’s own seat
receives `clientId`; remote seats keep their server player ID but no resume
credential. Direct projection assertions and the live server wire suite pass.

### R1 — Production CORS is permissive unless configured

**Evidence:** Socket.IO CORS behavior is controlled by
`POORUP_ALLOWED_ORIGINS`; an unset value intentionally keeps the local
development compatibility default permissive.

The server now supports an environment-backed allow-list through
`POORUP_ALLOWED_ORIGINS` and emits a production warning when it is missing.
Without that variable the compatibility default remains permissive for local
development. A public deployment must set the allow-list; this is a deployment
hardening requirement, not a game-rule defect.

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
`POORUP_SOCKET_RATE_WINDOW_MS`. Chat/social/patrol limits and the 40-leg trade
cap remain in place. Add an IP/edge limiter as a second layer before public
launch if the deployment is exposed to untrusted traffic.

## Verified non-findings

- Passwords use salted `crypto.scryptSync`; login compares hashes with
  `timingSafeEqual` (`server/accountStore.js:342-350,495-504`).
- Session tokens are random 32-byte values and only their SHA-256 hashes are
  persisted (`server/accountStore.js:347-351,438-443`).
- AI credentials and provider failures stay server-side; prompts use a
  redacted candidate/context projection.
- Room codes are random six-character values and public-room responses omit
  the code.
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
2. Set `POORUP_ALLOWED_ORIGINS` to an allow-list in production.
3. An operational backup plan for the JSON stores.
4. Edge-level/IP rate limiting as a second layer beyond the in-process limiter.

These items do not require UI changes and are independent of the board layout.
