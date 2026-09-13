# RR-01 — 404 & Error Pages

**Audit:** Release Readiness (40-agent) · Wave 1 · Mission RR-01 · 2026-09-12
**Mode:** read-only audit, current disk state
**Verdict:** NOT READY — the one release-blocking issue is the unresolved SPA catch-all (prior 1.16/8.7): unknown paths and missing assets return `index.html` 200 and there is no real 404/500 page to take its place. Client-side error/recovery surfaces are otherwise in good shape; remaining items are release hygiene.

## Prior-audit overlap (verified, not re-counted as new)

`server/server.js:70-75` still answers every unmatched GET with `index.html` + 200 — missing `/assets/*.svg`, `/themes/*`, `/favicon.ico` requests all get `text/html` (prior full audit 1.16 / 8.7, **not fixed**). The 404 middleware at `server.js:76` is only reachable for non-GET. Favicon.svg exists, is valid, and is linked (`index.html:7`).

## New findings

1. [MAJOR] `server/server.js:76-80` — once the catch-all is restricted, the only error surfaces are bare `text/plain` "Not found." and "The parlor is temporarily unavailable." — a dead link yields an unstyled text page and any JSON/asset consumer gets text — add minimal branded 404/500 HTML pages with content negotiation and a "back to parlor" link (one sentence: ship `public/404.html`/`500.html` and `res.status(...).type('html')`).
2. [MINOR] repo root + `public/` — no `robots.txt`, `sitemap.xml`, `favicon.ico`, `apple-touch-icon`, manifest, meta description, or OG/Twitter tags — crawler behavior and link previews are undefined for a public release — add robots+sitemap (or explicit `noindex`) plus touch icon and social meta.
3. [MINOR] `public/index.html:12` — no `<noscript>` fallback — with JS disabled/blocked the static shell sticks on "CONNECTING…" with dead controls and no explanation — add a `<noscript>` notice.
4. [MINOR] `public/main.js:665-686` — `showView(name)` hides all six views for any unrecognized name and has no default — one bad/typo'd name yields a fully blank screen (the exact failure mode this audit targets) — default unknown names to `"home"`.
5. [MINOR] `public/` (e.g. `index.html:65`, `clientBoardRender.js:57`, `clientThemeRender.js:33`) — zero `onerror`/asset-fallback handlers and no test covers non-theme asset references — a renamed/deleted SVG silently renders as a broken/blank glyph (audio toggles, board marks, patrol art), and theme previews fall back to the favicon invisibly — add a shared image `onerror` fallback plus a reference-vs-disk asset audit.
6. [MINOR] `server/serverSocketSocial.js:254` + `socialStore.js:237-250` — accepting an invite whose room was GC'd returns "That room no longer exists." without marking the invite — the stale JOIN row stays active and re-fails until the 15-min TTL — expire pending invites on `destroyRoom` (or mark them on the missing-room reject).
7. [MINOR] `public/clientGameSave.js:117-123` + `main.js:282-287` — "Resume round" while disconnected emits a buffered Socket.IO event with no ack timeout (`emitServer` only rejects when the socket object is null, not `socket.connected === false`) — user gets no error/progress until reconnect; unlike room-entry/social flows which have timeouts — reject immediately when disconnected or add an ack timeout with a visible notice.
8. [MINOR] `public/assets/board-icons/index.html` — internal icon gallery ships in the production web root and is served at `/assets/board-icons/` (referenced nowhere) — leaks a dev artifact and returns 200 for a directory path — move to a dev-only folder or delete.

## Verified clean

Unknown hash/`?surface=` values are inert (stays home, no blank); invalid/expired room codes and full/in-progress rooms surface a 6.5 s toast + chat line + forced home via `clientLobbyUi.js:751-771` (recovery: re-open Join); explicit resume with no server session toasts, clears `poorup.save.v1`, and hides the button (`clientGameSave.js:85-115`); all referenced theme/non-theme assets exist (theme asset audit 34/34 passes); rankings/season/social use loading + 8 s timeouts + stale snapshots + retry, and toasts render via `textContent` (no raw JSON/HTML injection); server logging/500 doesn't expose stacks to users.

## Must-fix before release

1. Restrict `app.get('*')` to HTML navigations (extension-less + `Accept: text/html`) so asset/API misses return 404 (and keep `/socket.io` guarded).
2. Add branded, content-negotiated 404/500 pages (and consider `/healthz`/`/readyz`, prior 8.7).
3. Add `robots.txt` (+ sitemap or explicit noindex) and a `<noscript>` banner for the public demo.
