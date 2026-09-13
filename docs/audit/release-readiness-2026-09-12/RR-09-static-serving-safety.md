# RR-09 — Static File Serving & Disclosure Safety

**Audit:** Release Readiness (40-agent) · Wave 1 · Mission RR-09 · 2026-09-12
**Method:** static analysis + live probe (`node server/server.js` on :8099 with `POORUP_DATA_DIR` in temp; server stopped after; no repo files touched). Prior audit grep'd first — items marked **(R1 §x)** were already known; only current status reported where the brief asks to re-verify.
**Verdict:** No BLOCKER. Disclosure objective met: server code, stores, docs, `.git`, and `node_modules` are not reachable over HTTP, and the app contains no secrets to disclose. Release fails on static-serving hygiene: the two prior flags (compression, caching) remain unfixed, and newly identified public artifacts (embedded-image "user-source" SVGs, test files, authoring pages, 3.3 MB junk file) should not ship from the webroot.

## Findings

- **[MAJOR] `server/server.js:69` — cache headers absent on every static asset (`Cache-Control: public, max-age=0`, even for the 12.3 MB mp3 and 9 woff2 fonts) — every reload/theme-switch revalidates ~60 files; wasted bandwidth/latency on a public URL — set `maxAge:'1y', immutable:true` for `/assets/*`; serve `index.html`/CSS/JS with `no-cache` or content hashes. (R1 §7.4, still open.)**
- **[MAJOR] `server/server.js:37-50`, `package.json:18-21` — no gzip/brotli: no `compression` dep, middleware stack has none; live `curl -H 'Accept-Encoding: gzip' /styles.css` returns 226,521 bytes raw (app JS ~800 KB, CSS 226 KB, SVGs uncompressed; only Socket.IO's own client is gzipped) — slow first load, heavy mobile cost — add `compression` or precompress + `express-static-gzip`. (R1 §7.5, still open.)**
- **[MAJOR] `public/assets/legacy-board-40-user-source.svg:1167-1174` + `public/assets/legacy-board-40.svg` — two unreferenced 740 KB SVGs served publicly, each embedding 8 base64 JPEG/PNG raster images; the `user-source` variant implies third-party/user-supplied art — unauthorized publication of supplied imagery if not cleared; also 1.48 MB dead weight — delete both from `public/` (or move to a non-served fixtures dir).**
- **[MINOR] `server/server.js:70-75` fallback chain — every unmatched GET returns `index.html` with **200**, including `/server/data/accounts.json`, `/docs/audit/*.md`, `/.git/config`, `/node_modules/express/package.json`, `/package.json`, traversal attempts — no file content leaks (static root is `public/` only; `sendFile` fixed), but 404s are masked (monitoring/probes all see 200), invalid content is returned where crawlers expect files, and `/.git/*` 200 responses look alarming to scanners — explicit 404 for non-SPA-looking paths, or restrict fallback to extensionless routes.**
- **[MINOR] `public/*.test.js` ×7 (`clientTheme.test.js:1`, `clientUxContracts.test.js:1`, `themeAssetAudit.test.js:1`, `clientResponsiveA11y.test.js:1`, `clientTransactionUi.test.js:1`, `clientQuickTable.test.js:1`, `clientCasinoReel.test.js:1`) — test source served publicly (live: `/clientTheme.test.js` → 200, 7,751 bytes) — exposes contract/asset expectations and internal naming — move to `qa/` or filter `*.test.js` in the static middleware (they are also in `npm test`, so relocate rather than delete).**
- **[MINOR] `server/server.js:70` — no `robots.txt`/`sitemap.xml`; `/robots.txt` returns the 73 KB HTML shell with 200 — search engines treat HTML as "no robots.txt" (fail-open), so the SPA and every soft-200 variant URL (`/server/...`, random paths) can be crawled/indexed as duplicate content — add `public/robots.txt` (and sitemap if indexable is intended), or 404 those prefixes.**
- **[MINOR] `public/assets/fonts/test` — 3.3 MB extensionless SVG served as `application/octet-stream` at a stable URL; unreferenced (verified) — dead 3.3 MB on the webroot with wrong MIME — delete or move out of `public/`. Same for dead `public/client-state.js:1`, `assets/audio/README.md`, `assets/parlor-patrol/README.md` (public source/provenance docs).**
- **[MINOR] `public/assets/board-icons/index.html:1` — authoring preview page publicly served as a directory index (live: `/assets/board-icons/` → 200 HTML) — workflow artifact exposed; no actual directory listing anywhere (`express.static` default; `/assets/` falls through to the shell) — remove from webroot.**
- **[MINOR] `server/server.js:47` — CSP `connect-src 'self' ws: wss:` allows WebSocket/HTTP connections to arbitrary `ws(s)://` hosts — weakens exfiltration/CSRF defense for a game that handles session tokens — narrow to `'self'` (covers same-origin `wss`).**
- **[MINOR] `server/server.js:58-64` + `serverConfig.js:28-43` — Socket.IO `cors.origin` guards polling only; no `allowRequest`/upgrade-origin check exists (verified no `allowRequest` in server) — cross-origin WebSocket handshakes bypass the allowlist; mitigated by token-in-payload auth (no cookie auth), so impact is limited to policy bypass — add `allowRequest` using `isOriginAllowed()`.**

## Verified clean (no finding)

- Static root is `public/` only (`server.js:68-69`); no secondary mounts; no symlinks/junctions under `public/`.
- `server/data/*.json` (accounts/sessions/matches/social, incl. `__dbg`/`__gold` dumps) is outside the webroot and gitignored (`git ls-files server/data` → empty); probes return only the shell.
- Traversal (`/../`, `%2e%2e`, `..%2f`) returns the shell, never a file; dotfiles are ignored and fall through.
- MIME correct on spot-check: `image/svg+xml`, `font/woff2`, `audio/mpeg`, `text/markdown`; `Range` → 206; `ETag`+`If-None-Match` → 304; `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, CSP on all responses; `X-Powered-By` disabled.
- No secrets/emails/tokens/internal URLs in `public/` (grep: none; only third-party OSS attribution links in READMEs); no source maps.
- No hardcoded `localhost`/absolute asset URLs in client code — all root-relative; production CORS fails closed without `POORUP_ALLOWED_ORIGINS` (`serverConfig.js:45-48`).
- **No upload/import surface exists** — no multer/busboy/formidable/multipart anywhere, no `<input type="file">`/FileReader import in client; all persistence is server-side JSON stores.

## Must-fix before public deploy

1. Add compression (or precompress) — `server.js:37-50`.
2. Cache policy: immutable `/assets/*`, no-cache shell — `server.js:69`.
3. Remove `legacy-board-40*.svg` (embedded user imagery), `assets/fonts/test`, `board-icons/index.html`, `client-state.js`, public READMEs from `public/`.
4. Stop serving `*.test.js` (relocate to `qa/`).
5. Add `robots.txt` + explicit 404 for `/server`, `/docs`, `/.git`, `/node_modules` prefixes.
6. Add Socket.IO `allowRequest` origin enforcement; tighten CSP `connect-src`.
