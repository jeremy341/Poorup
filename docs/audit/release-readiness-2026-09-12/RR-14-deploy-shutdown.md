# RR-14 — Deploy, Restart & Graceful Shutdown Story

**Audit:** Release Readiness (40-agent) · Wave 2 · Mission RR-14 · 2026-09-12
**Mode:** READ-ONLY audit.
**Prior findings:** R3 §8.1/§1.15, RR-10 flagged no SIGTERM/SIGINT handlers, no deploy/rollback runbook, no health endpoint, no docker/procfile. Verify current state; go deeper on release/deploy mechanics.

Grep verified: no `SIGTERM`/`SIGINT` handlers (only `uncaughtException`/`unhandledRejection` at server.js:133-139), no health route, no `Procfile`/`Dockerfile`/systemd/PM2/Ecosystem, no `.env` loader, no store lockfile.

## Findings

1. [BLOCKER] server.js:129-139 — no SIGTERM/SIGINT; `uncaughtException` calls `process.exit(1)` instantly; `server.listen` never closed, `io` never drained — every deploy/restart hard-kills all rooms, timers, seats, with no notice. Release impact: each deploy silently resets the product mid-game. Fix: handler = stop accepting, emit `server-restarting` via `socket.io`, sync `persist()` all stores, optional final backup, `io.close()`+`server.close()`, force `exit(0)` at ~10s. Budget: 10s (2s notice, <1s JSON writes, <2s backup; do not await AI/bot fetches; systemd `TimeoutStopSec` default 90s suffices).
2. [MAJOR] clientGameSave.js:85-115, clientSocketListeners.js:46-50,290-293 — post-restart reconnect: `restore-session` fails "No active session found", status flips to OFFLINE while socket is live, and the client never leaves the stale board; `loadSavedGame` (clientGameSave.js:66-77) only toggles a "Resume round" button (clientProfileRender.js:622) — it is never hydrated, and clicking it clears the save. Release impact: zombie UI + dead save for every live player after deploy. Fix: on failure navigate home with "server restarted, that round ended" banner; either hydrate the local save or delete it explicitly; don't mark offline while connected.
3. [MAJOR] socketRuntime.js:151-191 + RoomManager (rooms.js) — active rooms/seats/timers are memory-only; match records are written only at game end (`lastWinner && !statsRecorded`). A restart mid-game loses the entire match and all player stats. Release impact: guaranteed loss on every deploy with active games. Fix: accept + announce, or add a shutdown settlement/snapshot path; at minimum persist an "interrupted" record.
4. [MAJOR] backupStore.js:56-61 + serverStorePaths.js:16-19 — stores resolve to `undefined` unless `POORUP_DATA_DIR` is set; `backupJsonStores` filters those out and `[].every()` returns `success:true`, so `POORUP_BACKUP_DIR` alone produces silent empty "successful" backups while real data lives in `server/data`. Release impact: rollback has no restore point discovered only during an incident. Fix: fail loud when backup is enabled and no source paths exist.
5. [MAJOR] persistenceMode.js:4-15 — guard is opt-in only: default no lock, no PID file; two processes on the same `POORUP_DATA_DIR` with different PORTs silently last-writer-win (whole-file rewrite via AccountStore.persist/socialStore.persist). Only accidental protection is EADDRINUSE on the same port. Re-verified 7.1 dummy-URL bypass still open. Fix: lockfile (PID+host) in data dir; refuse second boot; require adapter health, not a non-empty string.
6. [MAJOR] server.js:68-80 — no `/healthz`/`/readyz`; catch-all returns `index.html` 200 for every GET so 404s/asset misses are masked. Re-verified 8.7. Release impact: "listening" cannot be distinguished from "functional"; no post-deploy gate. Fix: readiness = stores loaded, data dir writable, persistence mode, version/build, room+socket counts; restrict SPA fallback.
7. [MAJOR] repo gap — zero deployment artifacts (no systemd unit, Procfile, Dockerfile, env template, deploy script). Host is Hack Club Nest = raw LXC + systemd/tmux; domain dashboard points at container IP:port. Restart policy and `EnvironmentFile` are tribal knowledge, not versioned. Release impact: no reproducible deploy, no guaranteed restart, `.env` guidance in Nest docs doesn't work here (no dotenv). Fix: commit `docs/DEPLOY.md` + unit file (`Restart=always`, `EnvironmentFile=`, `NODE_ENV=production`, `POORUP_DATA_DIR`).
8. [MINOR] package.json:4 — version `0.0.0`, no commit stamp, no `/version`; rollback can't verify which build is live. Fix: bake `GIT_SHA` at deploy, expose in readiness.
9. [MINOR] serverConfig.js:45-48 — fail-closed CORS depends on `NODE_ENV=production`; with it unset (likely here) origin allowlist isn't enforced and there's only a warning (server.js:55-57). Fix: document/require `NODE_ENV` in the unit.
10. [MINOR] server.js:82-92 vs 133-139 — store constructors run before crash handlers; an EACCES on an existing store file throws at import (storeIO.js:15-24) → crash loop under `Restart=always` with no health signal. Empty dir first boot is fine (`writeJson` mkdir recursive, storeIO.js:50). Fix: writability probe + config echo at startup.
11. [MINOR] accountStore.js:524-527 — `register()` inserts into the Map and issues the session before `persist()`; a failing write acks an error but leaves the account "taken" in memory. Release impact: users locked out until restart. Fix: persist-then-commit or roll back on write failure.
12. [MINOR] server.js:96-99 — `runBackup` swallows `{success:false}` (only exceptions logged); stale/partial backups stay invisible. Fix: log/alert failed results and backup age.
13. [MINOR] ci.yml:52-60 — boot smoke only greps HTML; cannot catch uninitialized stores or a dead socket layer. Fix: add socket connect + register + store-write + readiness check to the boot job.
14. [MINOR] socketRuntime.js:874-875 — GC/AFK intervals never unref'd and no runtime teardown API (re-verified 8.15); clean shutdown must clear them or rely on `process.exit`. Fix: return a `stop()` from `createRuntime` and call it from the signal handler.
15. [MINOR] server.js:137-139 — `unhandledRejection` logs only (re-verified 8.9); partial-state process keeps serving during/after failure. Fix: track/report, or exit after drain.

## Safe deploy & rollback (single-instance, pre-graceful-shutdown)

1. Announce maintenance; expect all live games to end — wait for rooms to finish or accept loss (no drain yet).
2. `systemctl stop poorup`; confirm no lingering `node server/server.js` and no second process on the data dir.
3. Take a pre-deploy copy of every JSON store (+sha256); verify `POORUP_DATA_DIR` is set and a fresh `POORUP_BACKUP_DIR` backup actually contains files.
4. `git fetch && git checkout <known-good commit>`; record the SHA.
5. `npm ci` on Node 22; confirm unit env: `NODE_ENV=production`, `POORUP_ALLOWED_ORIGINS`, `POORUP_DATA_DIR`, `POORUP_BACKUP_DIR`, `PORT`.
6. `systemctl start poorup`; check startup logs for EACCES/corrupt-store/backup errors.
7. Verify: shell 200, socket connect, register/login+restore, create+join room, one turn, and `accounts.json` mtime advances with valid JSON.
8. Rollback trigger = any step 7 failure: stop, restore step-3 backup, checkout previous SHA, `npm ci`, start, re-verify.
9. Retain the previous checkout and pre-deploy backup until the next successful deploy.
10. Post-deploy: confirm no new `.corrupt-*` files, backup sidecar is fresh, and players get reconnect/restart messaging.
