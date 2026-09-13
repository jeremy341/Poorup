# RR-10 — Release Versioning, Metadata & Repo Readiness

**Audit:** Release Readiness (40-agent) · Wave 1 · Mission RR-10 · 2026-09-12
**Mode:** READ-ONLY. Inspected: git state, tags, package manifests, CI, docs, tracked binaries, live demo. Prior audit `docs/audit/full-codebase-audit-2026-09-12.md` and `docs/audit/pre-merge-review-2026-09-12.md` grepped; their open items are referenced, not restated.
**Verdict:** NO-SHIP until reconciled. Product quality is strong (pre-merge P0/P1/P2 clear, 154 browser tests), but shipping mechanics are not ready: the branch cannot merge cleanly, has no version/tag/build identity, no CI evidence, no changelog, and a live demo that does not match the release.

## Findings

1. `[BLOCKER]` `codex/theme-reset` vs `main` — `git merge-tree main codex/theme-reset` exits 1 with conflicts in 8 files: `package.json`, `public/clientState.js`, `public/index.html` (content) and add/add `clientTheme.js`, `clientThemeData.js`, `clientThemeRender.js`, `clientTheme.test.js`, `themeAssetAudit.test.js`, `qa/theme.spec.js` — main already merged a parallel theme system (`40ad9ed`, commits not in branch) — release impact: branch cannot merge cleanly; theme implementations must be reconciled by hand — fix: merge `origin/main` into the branch, choose one canonical theme module set, rerun full suite, then PR.
2. `[MAJOR]` branch state — 41 commits ahead / 13 behind `main`; local tip `b3599ee` is unpushed (origin behind by 1); no PR; no merge-plan doc for `theme-reset` — impact: release candidate lives only on one workstation with no review trail — fix: push, reconcile with `main`, open PR per `docs/DEVELOPMENT_WORKFLOW.md`.
3. `[MAJOR]` `package.json:4` + UI — version `0.0.0` (package-lock too), zero git tags locally/remote, no build/date anywhere in `public/`, no `/version` or `/health` route (`server/server.js:69-77` is static + catch-all only) — impact: no deployed build is identifiable; live-demo parity and bug reports are unverifiable — fix: set `0.1.0`, tag `v0.1.0` after merge, render build id in a small About/footer and expose `/version`.
4. `[MAJOR]` `README.md:33` live demo — `https://poorup.jeremy-d.hackclub.app/` returns 200 but serves a pre-theme shell (live HTML lacks `#quick-table-btn`, theme layers, profile Preferences that exist in local `public/index.html:17,76,168,467`); no version readout to prove otherwise — impact: testers/players see a stale build that does not represent this release — fix: deploy `main` post-merge, verify markers, state the deployed version in README.
5. `[MAJOR]` release notes — no `CHANGELOG.md`; only `docs/DEVLOG-7.md`, which is stale vs `docs/audit/pre-merge-review-2026-09-12.md` (line 29 still says the authenticated CodeScene review "needs the repository token"; line 37 "prepare the branch for merge"; line 39 admits screenshots missing), and contains no version/tag anchor — impact: no accurate, linkable release notes — fix: add `CHANGELOG.md` with a dated 0.1.0 entry (or finalize DEVLOG-7 status) and tag it.
6. `[MAJOR]` `.github/workflows/ci.yml:3-7` — CI triggers only on `pull_request`/`push` to `main`, so none of the branch's 41 commits has CI evidence; `docs/DEVELOPMENT_WORKFLOW.md:38-42` claims CI runs `npm run test:full`, but the workflow runs only `npm test` (`test:audit` is ungated) — impact: audit suite/browser matrix have no gate on this candidate — fix: open the PR to trigger CI; align workflow (`test:full`) or correct the doc.
7. `[MAJOR]` `public/assets/fonts/test` — 3.2 MB file, no extension, actually an SVG, referenced nowhere (`rg "fonts/test"` → 0); plus 12 MB `pondering-the-cosmos.mp3` and ~1.8 MB of `.ulpi/design` PNGs; repo pack is 19.8 MiB / 32 MiB loose — impact: dead weight in every clone/deploy; stray file looks accidental — fix: delete the stray SVG, consider LFS/CDN for audio and design PNGs.
8. `[MAJOR]` deployment readiness — no deploy/rollback runbook, no deploy config (`Dockerfile`/`Procfile`/`fly.toml`/`render.yaml` all absent), no health endpoint, and `docs/production-hardening.md` was last touched 2026-09-09 (pre-theme-reset) — impact: no defined release/deploy/recovery path for the live demo — fix: add `docs/RELEASE.md` (deploy, verify, rollback to previous commit, backup restore) and refresh the hardening doc.
9. `[MINOR]` line endings — no `.gitattributes` while `core.autocrlf=true`; 27 tracked files report mixed EOL (e.g. `public/clientState.js`, `clientLobbyUi.js`, three premerge audit docs) — impact: churn/warning noise, cross-platform diff drift — fix: add `* text=auto eol=lf` and normalize once.
10. `[MINOR]` `README.md` — no badges (no Codecov badge despite `codecov.yml` and the documented gate), no screenshots, license only as inline text (no `LICENSE` file; no `license` field in `package.json`) — impact: repo reads unfinished; DEVLOG's screenshot promise unfulfilled — fix: add `LICENSE`, a Codecov badge, and one gameplay screenshot.
11. `[MINOR]` release checklist — the only checklist is `docs/audit/release-readiness-2026-09-08.md`, explicitly "conditional" and marked for archiving by the prior audit (item 5.7); this RR-10 report has no maintained target — impact: no current, executable ship checklist — fix: create `docs/RELEASE.md` (or merge this report into the existing release doc) and archive 09-08.
12. `[MINOR]` `docs/production-hardening.md:9-19` omits `POORUP_TRUST_PROXY_HOPS` (`server/server.js:39`, controls rate-limiter proxy trust) and `TURN_AFK_TIMEOUT_MS` (`server/socketRuntime.js`) — impact: deploys behind a proxy misconfigure rate limiting — fix: document both alongside the existing env table.

Inherited/open from prior audits (not re-counted): engines/Node pin, `.env.example`, Codecov/OIDC token mismatch and soft gates, no gzip, README settings list, SHOWCASE duplication.

## Ship-it checklist

1. `git push origin codex/theme-reset` (publishes `b3599ee`).
2. `git fetch origin && git merge origin/main` into the branch; resolve the 8 conflicts (canonical theme modules, `package.json`, `clientState.js`, `index.html`).
3. `npm ci && npm run lint && npm run lint:client && npm run test:full && npm run test:browser` all green.
4. Bump `package.json`/lock to `0.1.0`; add `CHANGELOG.md`; finalize DEVLOG-7 status.
5. Add `LICENSE`, Codecov badge, screenshot, and deployed-version line to README/SHOWCASE.
6. Open PR to `main`; require `test`, `boot`, `browser` plus CodeScene/Codecov/human review.
7. Merge to `main`, tag `v0.1.0`, push the tag.
8. Deploy `main`; verify live page shows `#quick-table-btn`, theme layers, and Preferences.
9. Smoke live: create/join/Quick Table/reconnect; confirm `/health` + version readout.
10. Record previous deploy commit and rollback command in `docs/RELEASE.md`.
