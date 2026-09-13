# RR-15 — Backup & Restore Drill Readiness

**Audit:** Release Readiness (40-agent) · Wave 2 · Mission RR-15 · 2026-09-12
**Mode:** READ-ONLY: no files modified.
**Prior findings:** R2 §7.6–7.9, §8.5, R3 §8.5 — verifyBackup ignores checksum, rotation deletes valid backups by mtime, non-atomic writes, no cross-store snapshot marker, synchronous rotation blocking. Verify what is still true and find NEW gaps.

**Method:** grep-first verification of prior findings, plus a read-only drill importing the shipped modules in a temp dir (`%TEMP%\opencode\rr15-*.mjs`). No repo files touched. `git status`: only pre-existing `public/clientTheme.js` modification.

## 1. Inventory (what actually backs up)

| Store | File | Cadence (writes) | Backed up? |
|---|---|---|---|
| accounts | `accounts.json` (creds, stats, 50 matchHistory, sessionTokenHash) | every register/login/logout/profile/match/achievement/patrol | yes, via `allStorePaths` |
| social | `social.json` | most social mutations | yes |
| matches | `matches.json` | per finished match | yes |
| achievements | `achievements.json` | per unlock | yes (file absent in repo → backup result is a silent failure) |
| seasons | `seasons.json` | per match | yes |
| cosmetics | `cosmetics.json` | per purchase/equip | yes |
| telemetry | `telemetry.json` | ~dozens–400 persists/match | yes |

- Backup loop: `server/server.js:93-102`, opt-in `POORUP_BACKUP_DIR`, min 60 s, default 15 min, initial sync run **before** `listen`. Retention 7 per store (`backupStore.js:7,27`), filename `<store>.<ISO ms>.json` + `.sha256`. No batch manifest.
- Layout: flat dir; docs suggest `/var/backups/poorup` vs data `/var/lib/poorup` (`docs/production-hardening.md:12-13`); not enforced.
- Size: today one full set ≈ 1 MB (accounts 416 KB, social 440 KB, matches 74 KB). At caps (matches 500 × up to 152 KB = ~76 MB; accounts duplicate up to 50 full records each) a set can reach ~0.5–1 GB; ×7 retention with no disk check.
- **Not backed up at all:** in-memory room/game state (100% lost on crash), live session map (only token *hashes* survive), env/config, no off-site copy, no encryption.

## 2. Documented restore procedure
`docs/production-hardening.md:25-30` is the only doc: prose says "verify a recent `.sha256`, restore into a staging data directory, boot the server". No commands, no script, no npm task, and `verifyBackup` cannot verify a `.sha256` (see F1). `restoreJsonBackup` is importable code only — no CLI/API. An operator today must hand-write a `node -e` import.

## 3. Tooling drill results (temp dir)
- `backupJsonStores({accounts: undefined, ...})` → `success:true`, 0 files; `{}` → `success:true`, 0 results.
- Tampered backup (valid JSON, bytes changed): `verifyBackup` → `success:true`; sidecar checksum mismatched; `restoreJsonBackup` overwrote destination with tampered content.
- Truncated backup: `verifyBackup` → rejected (only integrity check that works).
- Rotation `retention:2` with newer partial-JSON file + older valid file: **partial kept, valid deleted** (mtime sort, no validation).
- Restore to arbitrary path outside backup dir: `success:true` (destination guard at `backupStore.js:78` is dead because `safePath` already resolved).
- Wrong root shape (`{}` for accounts): verify+restore succeed; on next boot `loadJson` shape validator quarantines it and the store **starts empty** (`storeIO.js:26-35`).

## 4. Data-loss window
Every mutation persists atomically (storeIO), so window = since last successful backup: **≤15 min** normally, **unbounded** with the F2 no-op/misconfig. Crash mid-settlement (sync sequence `socketRuntime.js:173-192`, 6 stores) leaves accounts updated but matches/season/social/telemetry missing; `accountAlreadyRecordedMatch` prevents double stats on retry, but a hard kill after restart makes the divergence permanent.

## 5. Schema compatibility
No version field in any store (`rg schemaVersion|formatVersion` → none). Old→new works via normalizers (`accountStore.js:414-428`, `matchStore.js:194-202`, `matchHistoryAdapter.js` merge). New→old has no gate; unknown fields are spread/dropped silently. No migrations.

## 6. Cross-store consistency
No manifest/marker. Stamps are per-file (`Date.now()` per store), retention is per-store, per-file failures are dropped. A backup set can silently omit a store or mix generations; the timer cannot interleave with settlement (all sync on one loop — prior 7.9's "backup between writes" is not reproducible; the real mixed state comes from a crash mid-settlement plus per-file restore).

## Findings (15)

1. **[BLOCKER] `server/backupStore.js:63-70`** — `verifyBackup` ignores its own `.sha256` sidecar; any valid-JSON tamper verifies and restores as success. — Tampered/stale backup restored over live store; drill cannot detect corruption. — Read sidecar, compare `checksumBytes(bytes)`, fail on mismatch/missing sidecar; add tamper test.
2. **[BLOCKER] `server/server.js:83-102` + `serverStorePaths.js:16-26` + `backupStore.js:56-61`** — when `POORUP_DATA_DIR` is unset (default), all store paths are `undefined`, filtered out, and `[].every()` returns `success:true`; stores actually write `server/data` (gitignored). `server.js:97` ignores results. — Lost `accounts.json` in default/misconfigured deploy = zero recoverable backups, no warning. — Derive backup sources from store `filePath`s; fail startup in production if backup enabled but 0 sources or any result fails; log counter/last-success.
3. **[BLOCKER] `docs/production-hardening.md:25-30`, no `scripts/`/npm task** — runbook is prose; no verify/restore CLI, checksum step it mandates is impossible with shipped tooling. — During an incident, operator hand-writes a script under pressure; typo restores wrong file. — Ship `npm run backup:verify` / `backup:restore --from <stamp> --to <dir>` with dry-run and pinned store map.
4. **[MAJOR] `server/backupStore.js:78`** — dead destination guard; restore accepts any path; no pre-restore copy of the current file; nothing prevents restoring under a running server whose memory will re-clobber it. — Restore over live `accounts.json` while process runs → silent reversion; no rollback of the restore itself. — Require destinations inside `POORUP_DATA_DIR`, quarantine existing file first, document stop-server.
5. **[MAJOR] `server/backupStore.js:48-51`** — non-atomic backup write: direct `writeFileSync` to final name, sidecar after. — Crash/disk-full mid-write leaves partial file that later rotation can keep (drill reproduced). — temp+`rename`, sidecar before/with rename; validate before rotate.
6. **[MAJOR] `server/backupStore.js:27-37`** — rotation sorts by `mtimeMs` only, never validates JSON/checksum. — Corrupt newer backup survives while older valid one is deleted (reproduced: partial kept, valid deleted). — Parse/verify candidates; order by filename stamp; never evict below min-valid count.
7. **[MAJOR] `server/backupStore.js:39-53`** — source is never parsed/validated before being frozen as a "successful" backup. — A store quarantined to empty (`storeIO.js:38-47`) gets backed up as empty; after 7 cycles the good history is purged with no alert. — Validate source shape against the store contract; abort + alert on failure.
8. **[MAJOR] `server/backupStore.js:63-84` + `server/storeIO.js:26-35`** — wrong root shape passes verify+restore; boot then quarantines and starts empty. — Operator "successfully" restores an object where accounts expects an array; store appears wiped (bytes only in `.corrupt-*`). — Per-store shape validators in verify/restore; refuse boot-time silent empty start when a `.corrupt-*` is present.
9. **[MAJOR] `server/backupStore.js:56-61` + `server.js:95-101`** — no batch manifest/generation; per-store stamps, independent retention, failures dropped. — After a partial run, "latest" per store spans generations; restoring all stores yields accounts newer than matches. — Write one `manifest-<stamp>.json` (key → file, sha256, counts) per run; restore by manifest.
10. **[MAJOR] `server/backupStore.js:44-51` + `accountStore.js:514-515,496`** — backups contain `passwordHash`, `passwordSalt`, `sessionTokenHash` in plaintext; `mkdirSync` uses default umask; no encryption, no off-site step anywhere (`rg rsync|s3` → only docs hits). — Backup-dir leak/disk theft = offline password cracking; single-disk loss = data + backups gone. — chmod 0700/0600, document encryption + off-host copy, consider withholding `sessionTokenHash`/`sessionTokenHash` rotation on restore.
11. **[MAJOR] `server.js:96-101`** — backup read+hash+write over all stores is fully synchronous on the main loop, including the initial run before `listen`. — At caps, multi-hundred-MB I/O stalls all sockets/timers and extends startup; drill depends on live process. — Worker thread/streaming copy; record duration.
12. **[MINOR] `server/backupStore.js:27-52`** — no free-space check or total-size budget; 7 stores × 7 snapshots unbounded. — Disk fills → `writeFileSync` throws → caught in `server.js:97` and only logged; backups stop silently while app runs. — Pre-flight `statfs`, size cap, and fail-loud alert.
13. **[MINOR] `server/backupStore.js:41-44` + `server.js:93`** — backup dir may equal data dir; production never asserts `POORUP_BACKUP_DIR` presence (only CORS/persistence-mode do, `serverConfig.js:45-48`, `persistenceMode.js:28-31`). — Self-copy rotation deletes live data on same-dir backup or, more commonly, no backups at all. — Reject backup dir inside data dir; warn/require in production.
14. **[MINOR] `server/backupStore.js:56-61` + `server.js:97`** — no freshness/last-success monitoring; per-file failures returned but discarded. — Operator assumes backups exist until the incident. — Track `lastSuccessAt`/failed keys; health endpoint or log line; alert after N failures.
15. **[MINOR] `server/accountStore.js:414-428`, `server/matchStore.js:194-202`** — no store-level schema version; new→old restore silently drops fields; no migration gate. — Restoring a newer-code backup into older code loses data without error. — Add `schemaVersion` per store; refuse downgrade unless migration exists.

## 8. Drill verdict — `accounts.json` lost right now
- **Correctly configured (`POORUP_DATA_DIR` + `POORUP_BACKUP_DIR`):** recoverable to the newest backup, ≤15 min stale. Credentials, stats, history, achievements, persisted session hashes return. Lost forever: accounts registered and profile/match writes inside the window; those users re-register/re-login. Manual recovery ≈ 5–15 min, but requires writing an ad-hoc script and manually comparing `sha256sum` (no CLI). Sessions issued after the backup are invalid → mass re-auth.
- **Default/misconfigured (no `POORUP_DATA_DIR`, or `BACKUP_DIR` only):** nothing recoverable. `server/data` is gitignored; `matches.json`/`social.json` retain only IDs/display names, no credentials/stats. Full account loss is permanent. Current default posture fails the drill.
- No crash-consistent story for in-progress games (in-memory only).

## 9. Recommended release posture
- **Fix before release (minimum):** F1 (verify sidecar), F2 (no silent empty backups + fail-fast prod assert), F3 (verify/restore CLI + executable runbook), F5/F6 (atomic writes, validated rotation), F4 (safe restore target/quarantine). These are small, localized changes and make the drill real.
- **Document + schedule:** F7–F15 (manifest, shape validation, secrets/permissions/off-site, async backup, disk/freshness monitors, schema versioning). Add a monthly drill: restore newest manifest into staging, boot with `POORUP_DATA_DIR`, smoke-test login/ladder/season reads, then promote.

## Runbook — "lost accounts.json" (best available today)
1. **Stop the server** (hard requirement: in-memory accounts will overwrite the file on next mutation). No graceful drain exists, so accept losing in-progress rooms.
2. Locate backups: `ls -l "$POORUP_BACKUP_DIR"/accounts.json.*.json*` (if `POORUP_BACKUP_DIR` was unset or `POORUP_DATA_DIR` was unset → STOP: no backup exists; only option is reconstructing IDs/names from `matches.json`/`social.json`, credentials unrecoverable; notify users).
3. Verify the chosen pair **manually** (`verifyBackup` cannot): `sha256sum accounts.json.<stamp>.json` vs the first field of the `.sha256` sidecar; confirm it parses: `node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" <file>`.
4. Write a throwaway restore script in a temp dir (not the repo): `node -e "import('file:///<repo>/server/backupStore.js').then(m=>console.log(m.restoreJsonBackup('<stamp-file>','<POORUP_DATA_DIR>/accounts.json')))"`.
5. If the destination exists, copy it aside first (no built-in quarantine): `cp accounts.json accounts.json.pre-restore`.
6. Restore the **same-generation** siblings (social/matches/achievements/seasons/cosmetics/telemetry) by matching stamps; do not mix generations — there is no manifest to validate this.
7. Boot with the restore `POORUP_DATA_DIR` (staging first per docs), then verify login, ladder, and a match-history read before promoting.
8. Missing today: checksum-verified restore, shape check, manifest-pinned sets, dry-run, permissions/off-site. Until F1–F5 ship, treat every restore as best-effort and expect ≤15 min data loss plus re-login for sessions issued in the window.
