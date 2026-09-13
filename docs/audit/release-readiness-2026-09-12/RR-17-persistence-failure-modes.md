# RR-17 — Persistence Failure Modes: Verification Pass

**Audit:** Release Readiness (40-agent) · Wave 2 · Mission RR-17 · 2026-09-12
**Mode:** READ-ONLY. No repo files touched. Probes ran under `%TEMP%\opencode`; read-only suites `persistence.test.js` (13/13), `backupStore.test.js` (7/7), `persistenceMode.test.js` (4/4), `match-history-schema.test.js` (5/5) all pass. Positives verified FIXED: corrupt-JSON quarantine, atomic temp+fsync+rename with old-snapshot preservation on rename failure, EACCES read fail-closed, MatchStore in-memory 500 cap.

## Findings (18)

1. **[BLOCKER] [OPEN]** `server/persistenceMode.js:8-23` — horizontal-scale guard still passes on a dummy URL; no Postgres adapter exists. Evidence: `assertPersistenceMode({POORUP_HORIZONTAL_SCALE:'true',POORUP_POSTGRES_URL:'postgres://x'}).ready===true` (test-pinned at persistenceMode.test.js:7); repo-wide grep for postgres/pg finds only persistenceMode itself. N processes on one JSON file silently overwrite. **Fix:** reject horizontal mode until a real transactional adapter is configured.
2. **[MAJOR] [OPEN]** `server/serverSocketSocial.js:202-208` — season claim persisted before cosmetic/token grants; retry skips grants. Evidence: probe granted `season-bronze/silver/gold/top`, then `claimReward` retry returns `created:false`; line 204 `if (claimed.created …)` is the only grant gate, so a crash between seasons.json and cosmetics.json loses the reward permanently. **Fix:** always run the claimKey-replay grant, then record the claim.
3. **[MAJOR] [CHANGED]** `server/socketSocialApi.js:166-190` — achievement ledger→profile split: caught-error rollback was added (good), but a process kill between the two persists leaves achievements.json with an entry accounts.json lacks; `unlock.created:false` makes every retry a no-op and grep confirms **no load-time reconciliation**. **Fix:** reconcile ledger→profile on startup, or write profile first.
4. **[MAJOR] [OPEN]** `server/accountStore.js:524-527,573-582` + `serverSocketAccount.js:149-166` + `socketHandlerSupport.js:129-140` — memory-before-persist (R3 §1.4): on persist throw the account/session survives in memory, user gets generic "could not process", retry register says "already taken", restart frees the username (probe P1/P1b); logout's token revocation is also non-durable under persist failure (restart resurrects the token). **Fix:** rollback on persist throw (or persist-then-commit) and ack non-durable explicitly.
5. **[MAJOR] [OPEN]** `server/accountStore.js:606-614` — dirty-write retry gap: `applyMatchResult` mutates, `persist()` throws, next `recordRoomStats` retry sees `accountAlreadyRecordedMatch` true, `changed` stays false, so persist is **never re-attempted**; stats/history stay memory-only until an unrelated mutation. **Fix:** persist when dirty even if deduped.
6. **[MAJOR] [OPEN]** `server/accountStore.js:264-266,610` — idempotency only against the 50-row history (claim §7.11): probe `gamesPlayed=52` after replay following 50 fillers. Related: a `gameId` >80 chars is stored raw and clipped on load (probe P10: replay after restart double-counts), though server IDs are shorter. **Fix:** durable settled-matchId set (matchStore lookup already has one).
7. **[MAJOR] [OPEN]** `server/telemetryModule.js:77-87` + `socketRuntime.js:100-120` — every telemetry event is a whole-file sync rewrite+fsync+rename (probe: 25 records → 25 renames); one settled match fans out up to ~435 events. **Fix:** batch per settlement / append-only.
8. **[MAJOR] [OPEN]** `server/matchStore.js:176-178,204-213` + `accountStore.js:196-213` — growth claim confirmed structurally: measured ~113 KB per synthetic bot-heavy record (~55 MB at the 500 cap, ~5.5 MB/account). In-memory match cap **CHANGED/fixed**; both files still embed 200 `botDecisions`. **Fix:** separate trace store or byte budget.
9. **[MAJOR] [OPEN]** `server/backupStore.js:50-51,63-70,27-37` + `server.js:94-102` — backup integrity cluster: `verifyBackup` ignores its `.sha256` sidecar (probe P8: tampered valid JSON verified and restored), backups are written directly to the final name (ENOSPC/crash leaves a partial newest file), rotation evicts by mtime with no JSON validation, and per-store sequential backups have no generation marker (mixed snapshot). **Fix:** temp+rename, sidecar verification in verify/restore, validate before rotate, manifest.
10. **[MAJOR] [OPEN]** `server/cosmeticCatalog.js:116,122-124` + `seasonModule.js:102-119` + `socialStore.js:41-43,136-139` — silent truncation (claim §7.13): probes 10001→10000 for cosmetics and social; the next persist makes the drop permanent with no warning/quarantine. **Fix:** detect overflow, quarantine, refuse shrunken persist.
11. **[MINOR] [OPEN]** `server/matchStore.js:147` — missing `completedAt` defaults to now (probe: 4 ms from now), so legacy records outrank history; any non-ISO string is accepted and sorted by `localeCompare`. **Fix:** null/epoch fallback, exclude unknown timestamps.
12. **[MINOR] [OPEN]** `server/achievementStore.js:37` — new variant of the same class: missing `unlockedAt` defaults to load-time now, inflating 30-day achievement windows after schema drift/corruption. **Fix:** epoch/null fallback.
13. **[MINOR] [OPEN]** `server/storeIO.js:38-46` — quarantine copy failure is swallowed while the log unconditionally claims "bytes preserved"; probe P13: quarantine file count 0, then the next register persist destroys the corrupt bytes (P13b). **Fix:** log only on success; fail closed or retry with a unique suffix.
14. **[MINOR] [OPEN]** `server/seasonModule.js:326-328` — dedupe compares raw `record.matchId` against a `String()`-coerced list; probe stored `["424242","424242"]` with double standings. Unreachable from runtime (server IDs are strings); hardening. **Fix:** canonicalize to String.
15. **[MINOR] [OPEN]** `server/storeIO.js:67-75` — fsync covers the temp file only; no parent-directory fsync, and rename atomicity is assumed (probe's mocked EPERM is exactly what SMB/NFS read-only/antivirus conditions produce). **Fix:** fsync dir on POSIX; document network-drive caveat.
16. **[MINOR] [OPEN]** `server/matchStore.js:215-223` — the 500-cap persist can drop a just-acknowledged backfill record from memory while `record()` returns `created:true` (probe P4: `stillInMemory=false, size=500`). **Fix:** return the persisted record or reject out-of-range inserts.
17. **[MINOR] [OPEN]** all stores — no schema/format version field anywhere (grep: only `season.revision`/`rulesetRevision` metadata). `accountStore` keeps unknown fields via spread while match/social/cosmetic sanitizers silently drop them; both add/remove-field directions are lossy with no quarantine. **Fix:** record version + migration hook.
18. **[MINOR] [CHANGED]** `server/gameLogic.js:190,257,276` — prior "transaction maps growth": `economyTransactions`/`contractTransactions` are per-game and reset at `resetForNewGame` (improved), but remain unbounded inside one game under unique client requestIds. In-memory only, not persisted. **Fix:** FIFO cap per game.

## Crash-window ranking (multi-store)
1. season claim (claim yes/grant no, retry blocked) → 2. achievement ledger vs profile (retry blocked, no reconcile) → 3. account register/login/logout memory vs disk (retry lockout, revocation loss) → 4. match settlement `accounts→seasons→accounts update→matches→achievements→telemetry` (season/achievement partial; dirty-account retry gap) → 5. backup mid-sequence / partial newest.

## Release verdict
**MUST-FIX:** #1, #2, #3 (reconcile), #4 (rollback + durable revocation), #5, #6, #9. **Accept-with-runbook:** #7/#8 if launch scale is small and bots bounded (otherwise must-fix), #10–#18 (monitor caps, timestamp hardening, schema version, network-drive docs).

## Verification table (claims vs current disk state)

| Claim | Prior | Current | Key evidence |
|---|---|---|---|
| §7.1 horizontal-scale P0 | CONFIRMED | **OPEN** | dummy URL still flips ready; no adapter |
| §7.2 achievement split-write | CONFIRMED | **CHANGED** (rollback added; crash window + no reconcile OPEN) | socketSocialApi.js:175-187 |
| §7.3 season claim split-write | CONFIRMED | **OPEN** | P12b; handler gate line 204 |
| §7.4 telemetry full-file rewrite | CONFIRMED | **OPEN** | 25 records → 25 whole-file renames |
| §7.5 152 KB/record growth | CONFIRMED | **OPEN** (memory cap fixed) | 113 KB measured; 500-cap enforced |
| §7.6 verifyBackup ignores sidecar | CONFIRMED | **OPEN** | P8 tamper verified+restored |
| §7.7 rotation mtime-only | CONFIRMED | **OPEN** | backupStore.js:27-37 |
| §7.8 partial backup final name | SUSPECTED | **OPEN** | direct `writeFileSync` |
| §7.9 backup cross-store snapshot | SUSPECTED | **OPEN** | server.js:96-102 sequential |
| §7.10 sanitizeMatch timestamp default | CONFIRMED | **OPEN** | P7 (4 ms delta) |
| §7.11 50-row idempotency | CONFIRMED | **OPEN** | P5 (52 vs 51) |
| §7.12 season non-string matchId | CONFIRMED | **OPEN** (unreachable) | P6b duplicate MatchIds |
| §7.13 silent truncation caps | CONFIRMED | **OPEN** | P9/P11 10001→10000 |
| §7.16 no parent-dir fsync | SUSPECTED | **OPEN** | storeIO.js:67-75 |
| §7.17 quarantine collision | SUSPECTED | **OPEN** (+ misleading log) | P13/P13b |
| §7.18 notifications unbounded accounts | CONFIRMED | **OPEN** | socialStore.js:136-139 |
| §7.19 duplicate handles first-wins | CONFIRMED | **OPEN** | accountStore.js:444-452 |
| §7.20 restore guard dead | CONFIRMED | **OPEN** (dormant) | backupStore.js:78 |
| R3 §1.4 memory-before-persist | CONFIRMED | **OPEN** | P1/P1b |
| R3 transaction maps | SUSPECTED | **CHANGED** | per-game reset; no in-game cap |
| New this pass | — | **OPEN** | quarantine-copy loss, backfill drop, achievement timestamp default, schema version, sanitizer drop direction |
