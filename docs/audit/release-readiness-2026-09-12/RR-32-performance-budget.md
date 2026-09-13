# RR-32 — Performance Budget & Asset/Load Audit

**Audit:** Release Readiness (40-agent) · Wave 4 · Mission RR-32 · 2026-09-12
**Mode:** READ-ONLY: do NOT modify/create/delete any file. Local server on a spare port allowed for measurement (stopped after; curl/node fetch only, no browser installs).

Method: read-only code/config audit + import-graph BFS + local server on ports 8123/8124 measured with `curl` (started/stopped, no browser), gzip/brotli measured with .NET `GZipStream`/`BrotliStream` (Optimal), MP3 bitrate parsed from frame header. No files modified.

## Findings (15)

- `[BLOCKER]` **No compression on HTML/CSS/JS/SVG** — all app statics return uncompressed (`Cache-Control: public, max-age=0`, no `Content-Encoding`) even with `Accept-Encoding: gzip, br`; text+SVG first load = **1,102,858 B raw** → gzip 249,519 B — budget ≤250 KB gzip — fix: add compression middleware or precompress (only socket.io.js is compressed today, by Socket.IO itself: 155,836 → 37,648 B wire).
- `[BLOCKER]` **12.3 MB music** — `pondering-the-cosmos.mp3` 12,310,011 B @320 kbps CBR, 308 s, `preload="metadata"`, `loop` — budget ≤4 MB (96–128 kbps) or ~1.5 MB Opus — fix: re-encode + `preload="none"`; a full 12-min game loops it **~2.3× ≈ 29 MB of mobile data**.
- `[MAJOR]` **777 KB unminified, unbundled JS in 51 requests** (one static graph from `main.js`) — budget ≤200 KB gzip, ≤3 bundles — fix: minify + bundle + code-split; 51 module requests create a multi-wave import waterfall.
- `[MAJOR]` **Parser-blocking socket.io.js** (index.html:9, no `defer`) — 155,836 B unminified (`/socket.io/socket.io.js` always serves the non-min build) — budget ≤15 KB gzip, deferred — fix: `defer`, or bundle min client; remove from `<head>`.
- `[MAJOR]` **No effective caching** — every route is `Cache-Control: public, max-age=0` (express.static default + Socket.IO) with ETag only; second visit = **67 conditional requests** (~20–35 KB of headers, 67 RTT chances), nothing immutable — budget: repeat visit = 1 HTML revalidation — fix: content-hash + `max-age=31536000, immutable`, HTML `no-cache`.
- `[MAJOR]` **4.93 MB dead payload shipped** — `assets/fonts/test` 3,339,969 B (misnamed SVG), `legacy-board-40*.svg` 1,481,324 B, `ibm-plex-sans-*.woff2` 69,672 B, unused patrol/board SVGs 18,312 B, 6 orphan theme dirs 10,759 B (from abandoned theme plan) — budget 0 B — fix: delete.
- `[MINOR]` **3 unused @font-face faces** — Jersey 15 (25,216 B), IBM Plex Mono 500/600 (30,508 B) declared in styles.css but never referenced by any `font-family` (never downloaded, dead weight/CSS) — budget 0 — fix: remove declarations + files.
- `[MINOR]` **Silkscreen ships as 31,320 B TTF** (67% of the 46,916 B actually used font payload) — budget ~8 KB woff2 — fix: convert/subset to woff2.
- `[MINOR]` **Theme popover pulls 6 scene previews = 21,363 B** on first open (themePreviewScene per option) — budget 0 extra bytes — fix: reuse the already-rendered selected scene, lazy-load previews.
- `[MINOR]` **Home first paint parses all feature code** — profile (30.9 KB), trade (74.9 KB), social (94.1 KB), lobby (43.7 KB), night-shift (28.2 KB) load before any interaction; largest modules: clientTradeUi 1,299 lines, clientSocialSurfaces 1,114, clientLobbyUi 990 — budget: home ≤250 KB raw initial JS — fix: dynamic import per surface.
- `[MINOR]` **No resource hints** — no `preload` for styles.css/fonts, no `prefetch` for game assets; CSS `<link>` and blocking script serialize head discovery — budget: preload critical CSS/fonts, defer socket — fix: add hints after bundling.
- `[MINOR]` **No minification of styles.css** (232,127 B raw; gzip alone gets 38,583 B, but ~35–40% is comments/whitespace) — budget ≤180 KB raw / ≤40 KB gzip — fix: minify CSS.
- `[INFO]` **WebSocket per-message compression off** (engine.io default), polling compresses >1 KB — game JSON is small; low priority — budget: leave off, monitor socket bytes — fix: measure socket traffic after release.
- `[INFO]` **Audio metadata preload still costs**: `preload="metadata"` issues a Range request (server correctly returns 206) before any user interaction (~tens of KB) — budget 0 network until music enabled — fix: `preload="none"`, load on toggle.
- `[INFO]` **Unused `client-state.js` (3,608 B)** is unreachable from main.js (not shipped to clients; test-only) and 6 orphan theme directories ship in `public/` — budget 0 shipped — fix: move to tests/.

## Release Performance Budget

| Asset class | Current (measured) | Target | Action |
|---|---|---|---|
| HTML `/` | 73,548 B raw, 1 req, max-age=0 | ≤15 KB gzip, no-cache | gzip + ETag |
| CSS | 232,127 B raw / 38,583 gzip cap, 1 req | ≤45 KB gzip, immutable | minify, hash, cache 1 yr |
| App JS | 776,971 B / 51 req / 0 compression | ≤200 KB gzip / ≤3 req | minify, bundle, code-split |
| socket.io client | 155,836 B raw (37,648 wire), blocking | ≤15 KB gzip, deferred | defer / bundle min |
| Fonts | 46,916 B used (31.3 KB TTF); 125.4 KB dead faces | ≤25 KB | subset, woff2, remove dead faces |
| Images (first-load SVG) | 20,212 B / 8 req | ≤6 KB gzip | gzip/brotli + inline |
| Audio | 12.3 MB full; ~tens KB metadata preload | ≤4 MB full; 0 at load | re-encode, `preload=none` |
| **First load total** | **≈1.24 MB wire / 67 req** | **≤450 KB / ≤20 req** | compression + bundle + purge |
| **Repeat visit** | 67 revalidations (~20–35 KB headers) | 1 revalidation, 0 body | hashed immutable + no-cache HTML |
| **Theme switch** | 5,322–8,029 B / 2–7 req (original…light); popover +21,363 B / 6 req | ≤8 KB / ≤7 req, previews free | immutable hashed SVGs |
| **Game session** | +4,369 B board/lobby; +21,414 B Night Shift; +18,957 B achievements; music up to 29 MB | ≤30 KB assets, ≤4 MB music | lazy-load per mode |

Theme-switch detail (unique bytes/requests): original 5,322/2 · spring 6,566/6 · summer 5,804/6 · autumn 7,659/7 · winter 7,255/6 · light 8,029/7. First visit is dominated by HTML/CSS/JS (97.6% of requests); later sessions are dominated by audio.

## Top 5 Quick Wins (ranked)

| # | Win | Saving |
|---|---|---|
| 1 | Enable gzip/brotli for static assets | **−853 KB first load** (1,102,858→249,519 B, −77.4%; wire 1.24 MB→~0.38 MB) |
| 2 | Immutable hashed assets + `no-cache` HTML | Repeat visits: 67 revalidations → 1; ~20–35 KB headers + 66 RTTs |
| 3 | Delete dead assets (fonts/test, legacy boards, unused fonts/SVGs/orphan theme dirs) | **−4.93 MB deploy size** (zero current fetch risk eliminated) |
| 4 | Re-encode/streamline music (320→128 kbps or Opus, `preload=none`) | **−8.5 MB per 5-min listen; −25 MB per 12-min game** |
| 5 | Minify/bundle/code-split JS + defer socket.io | 777 KB raw / 51 req → ~200 KB gzip / ≤3 req; removes 156 KB parse-blocking script |

Budget source of truth: `docs/audit/full-codebase-audit-2026-09-12.md` items still open today — compression (never implemented), cache headers (still `max-age=0`), socket.io blocking (unchanged), 12 MB audio (unchanged), unminified JS (unchanged); the 740 KB legacy boards and `fonts/test` remain the largest removable dead weight.
