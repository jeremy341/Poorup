# Poorup Release-Readiness Audit — 2026-09-08

## Scope and constraint

This is a read-only release audit of the current server, persistence, socket,
game-rule, bot, economy, social, test, dependency, and CI surfaces. No UI or
frontend source files were changed during this audit. One server-only hardening
fix was applied: oversized and duplicate trade property legs are now bounded
and deduplicated before validation/settlement.

## Repository state

- Branch: `codex/codescene-cleanup`
- Working tree: clean after the audit fix commit
- Base: merged `main` at `c62cd64`
- Latest audit-fix commits include `2e65c54` (trade input normalization) and
  the current release checks below.
- JSON stores under `server/data/` remain ignored and local. They were not
  deleted or rewritten during this audit.

## Evidence collected

| Gate | Result |
| --- | --- |
| `npm test` | PASS — complete contract, persistence, bot, event, economy, socket, social, and history suite |
| `npm run lint` | PASS — server ESLint |
| `npm run lint:client` | PASS — client ESLint; inspected only, no UI edits |
| `npm run coverage` | PASS — 92.85% statements, 82.35% branches, 92.39% functions |
| `npm audit --omit=dev --audit-level=moderate` | PASS — 0 vulnerabilities |
| `node --check` | PASS — 120 shipped JavaScript files |
| `npm pack --dry-run` | PASS — 227 files; npm warns that no `.npmignore` exists |
| Bot balance campaign | PASS — 2,500 bounded games, 1,994 completed within 2,000 steps, 0 stalled |
| Bot status/reconnect wire probe | PASS — 18/18 checks, repeated successfully |
| `git diff --check` | PASS |
| CodeScene delta | UNVERIFIED — local CLI could not authenticate to `codescene.io/oauth2/token` in this environment |

## Server-only findings

### R1 — Production CORS is unrestricted

**Evidence:** `server/server.js:27-31` configures Socket.IO with
`cors: { origin: '*' }`.

This is acceptable for a public, token-in-payload prototype, but it allows any
website to open sockets to the deployment and increases abuse/DoS surface. A
production deployment should set an allow-list through an environment-backed
origin function and keep `*` only for local development. This is a deployment
hardening requirement, not a game-rule defect.

### R1 — JSON persistence is single-process and has no write lock

**Evidence:** `server/serverStorePaths.js:10-13`, `server/storeIO.js:41-63`.

Writes are atomic for the normal rename path, but simultaneous server
processes do not coordinate. Running multiple replicas against one directory
can lose the last writer's accounts, social graph, matches, or achievements.
The current architecture is release-safe only as a single-instance service;
use one instance or move stores behind a transactional database before
horizontal scaling.

### R2 — Unreadable-store errors are treated like missing files

**Evidence:** `server/storeIO.js:15-21` catches every read error and returns
`missing: true`.

An `EACCES`, sharing violation, or transient filesystem failure can therefore
look like an empty store. A later mutation may attempt to persist over a file
that was never successfully read. Corrupt JSON is quarantined correctly, but
non-`ENOENT` read failures should be surfaced as a read-only/error state before
public production release.

### R2 — Rename fallback is not atomic

**Evidence:** `server/storeIO.js:52-63` falls back to direct write after a
failed rename. The fallback descriptor is now closed correctly, but direct
write can still truncate the previous file if the process or host fails during
that write.

The normal path is safe and covered by persistence tests. A production-grade
store should either fail the mutation while preserving the old file or use a
transactional datastore; do not rely on the direct-write fallback for
multi-instance durability.

### R2 — Gameplay payload abuse needs broader rate limits

The server has chat/social/patrol limits and now caps trade property legs at
40 (`server/tradeApi.js`). Most game verbs are cheap and server-authoritative,
but a hostile client can still send high-frequency rejected intents. Add a
socket/IP token bucket at the edge before public launch if the deployment is
exposed to untrusted traffic.

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
2. An allow-listed production CORS origin.
3. A read-only/error path for non-`ENOENT` store failures and a decision on
   the non-atomic write fallback.
4. Edge-level rate limiting and operational backups for the JSON stores.

These items do not require UI changes and are independent of the board layout.
