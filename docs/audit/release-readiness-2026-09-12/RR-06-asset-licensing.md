# RR-06 — Asset & Code Licensing / Attributions

**Audit:** Release Readiness (40-agent) · Wave 1 · Mission RR-06 · 2026-09-12
**Mode:** READ-ONLY (no files modified)
**Verdict:** Not licensing-ready as-is. Two concrete pre-release blockers/actions: remove the unknown `fonts/test` artifact, and ship OFL/CC attribution + a root `LICENSE` so the MIT repo and its bundled fonts/art have consistent, documented terms.

All documented SHA-256 checksums for audio and legacy boards were re-verified and match.

## Findings

1. **[BLOCKER] `public/assets/fonts/test`** — 3.3 MB tracked SVG (embedded 2.5 MB PNG, no metadata) with zero provenance/license, unreferenced, publicly served by `express.static` (`server/server.js:69`) — ships unknown-rights third-party imagery under MIT — delete it from `public/` or document origin + rights and move out of the served tree.
2. **[MAJOR] `public/assets/fonts/*.woff2|ttf` (Pixelify Sans, Jersey 15, Silkscreen, IBM Plex Mono)** — all four families are OFL 1.1, but no OFL text or copyright notice ships anywhere in the repo (`git ls-files` has no LICENSE/OFL/COPYING/NOTICE) — OFL redistribution condition unmet for the public demo/repo bundle — ship `fonts/OFL/*.txt` (or `THIRD-PARTY-NOTICES.md`) and keep RFNs unmodified.
3. **[MAJOR] `public/assets/legacy-board-40.svg`, `legacy-board-40-user-source.svg`** — both contain embedded PNG/JPEG rasters (7 images incl. 1280×854 and 701×463 photos/renders); `.ulpi/design/BOARD-SOURCES.md` records checksums and "user-pasted" only, no rights grant, author, or asset license — unknown-rights media redistributed in the MIT repo and served over HTTP — add ownership/license statement or move the rollback copies to a non-served archive (not runtime deps per `BOARD-SOURCES.md:17-19`).
4. **[MAJOR] Repo root / `README.md:80-100` / `package.json`** — no `LICENSE` file; MIT is stated only as README prose; `package.json` has no `license` field — MIT code intermingled with OFL/CC0/unknown assets with no notices file — add `LICENSE` (MIT), `THIRD-PARTY-NOTICES.md` (OFL texts, CC0 credits), and `"license": "MIT"`.
5. **[MINOR] UI (`public/index.html`, `clientSocialSurfaces.js`)** — no credits/about/legal surface anywhere in the UI — CC0 (music/SFX) requires none, but there is no home for OFL notices or future CC-BY attribution — add a small Credits/Legal entry (e.g. Field Manual page) only if licenses ship in-repo; otherwise okay.
6. **[MINOR] `docs/design/THEME-MUSIC-CURATION-2026-09-12.md:33,41` + `qa-artifacts/music-candidates-2026-09-12/README.md`** — Autumn Colors and Snowy Village are marked KEEP under CC-BY 3.0 but live only in gitignored `qa-artifacts/`; not shipped today — safe, but wiring them without a credits surface would violate CC-BY — gate production integration on attribution UI/notices.
7. **[MINOR] `package.json` / `.github/workflows/ci.yml`** — no `license` field and CI runs `npm audit` (security) only; no automated license policy check — drift risk as deps change — add `license-checker`/`licensee` CI step (all current deps verified permissive).
8. **[MINOR] `public/assets/fonts/ibm-plex-sans-{400,600,700}.woff2`** — OFL fonts shipped but referenced nowhere (no `@font-face`, no code use) — dead release weight and licensing surface — delete or actually reference them.
9. **[MINOR] `public/assets/audio/README.md` vs `public/assets/parlor-patrol/README.md`** — attribution is split across two served READMEs; the top-level audio README omits the CC0 SFX (Deva/@Shades) — completeness/auditability gap — consolidate into one notices doc plus keep per-dir credits.
10. **[MINOR] `.ulpi/design/supplied/*` + `DESIGN.md:5`** — design system "supplied ZIP"/screenshot has no author or license statement — internal-only (not shipped), but tokens derive from an unlicensed external source — record the supplier and terms in `DESIGN.md`.
11. **[INFO/PASS] Code dependencies** — `express@4.22.2` MIT, `socket.io@4.8.3` MIT, `engine.io`/`ws` MIT, `qs` BSD-3 (pinned override `6.16.0`); full lockfile: 163 MIT, 17 ISC, 15 Apache-2.0, 6 BSD-2, 5 BSD-3, 5 BlueOak-1.0.0; **no GPL/AGPL/SSPL/NC/Commons-Clause**. No action.
12. **[INFO/PASS] Audio provenance + hosting** — Pondering the Cosmos CC0 (Ruskerdax, OpenGameArt) and pixel-hit CC0 (Deva/@Shades) are documented and hash-verified; shipped client has no external CDN/Google Fonts calls; permissive code + CC0 audio presents no conflict with the Hack Club (`poorup.jeremy-d.hackclub.app`) public demo. No action.

## Per-asset licensing summary

| Asset | License status | Action |
|---|---|---|
| `audio/pondering-the-cosmos.mp3` | CC0, documented + SHA verified | None |
| `audio/parlor-patrol/pixel-hit-pack-cc0.wav` | CC0, documented in parlor README + SHA verified | Consolidate notice (item 9) |
| Theme music candidates (`qa-artifacts/`, ignored) | CC0 + 2× CC-BY 3.0, not shipped | Keep out of build; attribution gate if wired |
| Pixelify Sans, Jersey 15, Silkscreen, IBM Plex Mono | OFL 1.1 (upstream-known), no license text shipped | Add OFL texts (item 2) |
| IBM Plex Sans 400/600/700 | OFL, unused | Remove or reference (item 8) |
| Theme SVGs (5 worlds, 18 files) | Declared original/hand-authored (`figma-theme-worlds-2026-09-11.md`) | Document authorship (minor) |
| Parlor Patrol SVGs | Declared original (`parlor-patrol/README.md:3-4`) | None |
| Root assets / board-icons SVGs | Presumed original, no provenance doc | Add provenance note |
| `legacy-board-40*.svg` | Checksums only, embedded unknown rasters | Document rights or un-serve (item 3) |
| `fonts/test` | Unknown origin, unreferenced | Remove or document (item 1) |
| `styles.css` data-URI noise | Generated in CSS (`feTurbulence`) | None |
| npm dependencies | All permissive; no copyleft | Add license CI check (item 7) |
| Project license | MIT in README prose only | Add LICENSE + package field + notices (item 4) |
