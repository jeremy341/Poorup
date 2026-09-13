# RR-08 — Security Headers, Transport & Cookies

**Audit:** Release Readiness (40-agent) · Wave 1 · Mission RR-08 · 2026-09-12
**Method:** master audit §8 re-read (`docs/audit/full-codebase-audit-2026-09-12.md:331-361`), then verified current HEAD against the same files. No writes performed. Current header block: `server/server.js:42-48`; socket config `server/server.js:58-64`.
**Verdict:** Not release-ready on transport hardening alone. No session-cookie/CSRF defect exists (no cookies at all), and error leakage is clean, but the header/transport posture still has four proxy-shaped gaps: blanket `connect-src ws: wss:`, WebSocket-origin bypass of the CORS allow-list, proxy-collapsed IP rate-limit buckets (HTTP and socket auth), and no HSTS.

## Known confirmations (not re-scored)

- `server.js:42-48` — still no `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` (known 8.11).
- `server.js:55-64` + `main.js:253,288-292` — `io()` default transport, tokens/passwords in event payloads; no TLS enforcement, plain `server.listen(PORT)` also exposes an un-TLS'd origin (known 8.3).
- `serverSocketAccount.js:78-97` — auth limiter keyed on `handshake.address` (known 8.1); now confirmed engine.io 6.6.9 never parses `X-Forwarded-For` at all (no `trustProxy` support), so `POORUP_TRUST_PROXY_HOPS` cannot fix the socket side.
- `httpRateLimiter.js:50-56` + `server.js:50` — HTTP limit off by default; socket limiter per-`socket.id` (known 8.4); reconnects mint fresh buckets.
- `clientSanitize.js:316-340` — account token in localStorage, never expires (known 8.2); `clientState.js:125-137` guest `clientId` is `Math.random` bearer (known 8.13).
- **Cookies: none.** Confirmed 0 `Set-Cookie` / `document.cookie` in `server/` and `public/`; Socket.IO `withCredentials` is default-false. No session cookie flags can be missing; CSRF via ambient cookies is not a surface — auth is explicit-payload bearer only (so CSWSH can't steal a session).
- **Error leakage: clean.** `x-powered-by` disabled (`server.js:41`); HTTP 500 generic text (`server.js:77-80`); socket handler throws are logged server-side and ack'd as `"The server could not process that request."` (`socketHandlerSupport.js:129-140`); no version banner.

## New / remaining findings

1. [MAJOR] `server/server.js:47` — CSP `connect-src 'self' ws: wss:` whitelists **every** WebSocket host on the internet, not just same-origin — if any of the known unescaped-`innerHTML` surfaces (8.5/8.6/8.12) ever becomes exploitable, script exfil to an attacker's `wss://` endpoint is trivially allowed — change to `connect-src 'self'` (CSP3 maps `'self'` to ws/wss same-origin) or an explicit `wss://<host>`.
2. [MAJOR] `server/server.js:58-64` — CORS `origin` callback only runs for HTTP polling; direct `transports:['websocket']` upgrades are accepted from any `Origin` (no `allowRequest`, no `transports` restriction) — any hostile page can open cross-site sockets to the server and drive guest room spam / pre-auth load despite `POORUP_ALLOWED_ORIGINS` being mandatory in prod — add `allowRequest` doing an Origin allow-list check and/or restrict `transports`.
3. [MAJOR] `server/serverSocketAccount.js:78-97` — auth limiter keys on proxy IP because engine.io exposes only `remoteAddress` (verified: no XFF/trust-proxy support in engine.io 6.6.9) — behind the Hack Club proxy, one attacker's 8 failed auths/60s lock registration/login for **all** users, repeatably; `POORUP_TRUST_PROXY_HOPS` does not help — key bucket on `socket.id` + `X-Forwarded-For` last hop (validated only when hops configured) + success-reset.
4. [MAJOR] `server/server.js:39-50` + `docs/production-hardening.md:9-19` — trust-proxy hop count defaults to 0 and is not documented among required production vars; with `POORUP_HTTP_RATE_LIMIT` set behind the proxy, `req.ip` is the proxy and the limiter becomes one global bucket — set `POORUP_TRUST_PROXY_HOPS=1` (or proxy-provided real IP) and add it to the mandatory env list, plus a loud production warning when unset.
5. [MAJOR] `server/server.js:42-48` — missing HSTS/COOP/CORP (known) **and** COEP; without HSTS the first visit can be TLS-stripped at the edge, without CORP assets are hotlink/embedable cross-origin — set `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` (COEP `require-corp` optional; needs CORP first).
6. [MINOR] `server/server.js:47` — CSP lacks `form-action 'self'` (`default-src` does **not** fall back for form-action); an injected `<form>` can POST data to an attacker origin (`public/clientSocialSurfaces.js:779` ships real `<form>` elements, confirming forms are in use) — add `form-action 'self'`.
7. [MINOR] `server/server.js:47` — no `font-src` (currently silently falls back to `default-src 'self'`, which happens to be correct for `public/styles.css:4-39` local woff2/ttf) and no `upgrade-insecure-requests` — make `font-src 'self'` explicit; add `upgrade-insecure-requests` (proxy-safe no-op on localhost).
8. [MINOR] `server/server.js:46` — `Permissions-Policy` covers only camera/microphone/geolocation — add `payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=()`; app uses none of them (Web Audio only, `main.js:210-226`).
9. [MINOR] `server/server.js:42-48` — `X-XSS-Protection` absent; legacy filters can introduce their own issues — send `X-XSS-Protection: 0` explicitly.
10. [MINOR] `server/server.js:69-75` — no explicit `Cache-Control` policy: `express.static`/`sendFile` use `max-age=0` + ETag (assets are unhashed so long-cache would be wrong), and the SPA fallback returns `index.html` with 200 for arbitrary unknown paths incl. missing `/assets/*` — set `Cache-Control: no-cache` on HTML/fallback and a long `max-age`+`immutable` only once assets are content-hashed; `socket.io.js` (155 KB) revalidates every load.
11. [MINOR] `server/server.js:47` — `style-src 'unsafe-inline'` is *required* today: 62 `style="…"` attributes across 15 `public/` files (e.g. `clientLobbyUi.js:299`, `clientAccountIdentity.js:174`) — cannot be dropped without class/token refactor; record as accepted risk (no `unsafe-eval`, no inline `<script>`, no `javascript:` URLs, no `blob:`/`Worker` usage found).
12. [INFO] `server/server.js:63` — `maxHttpBufferSize: 100000` is safe in practice: chat is capped server-side at 250 chars (`roomSetup.js:68-71`) and avatars are 8×8; `connectionStateRecovery` is default-disabled (app-level restore only); `path` is default `/socket.io`; `serveClient:true` is fine because the client is same-origin `/socket.io/socket.io.js` and matches `script-src 'self'`.

## Must-fix before launch

1. `server.js:47` → `connect-src 'self'` (or exact `wss://` origin); add `form-action 'self'`.
2. `server.js:58-64` → Origin check in `allowRequest` (covers WS) and/or pin `transports`.
3. `serverSocketAccount.js:78-97` → proxy-aware auth bucket (socket id + validated XFF last hop); document/enforce `POORUP_TRUST_PROXY_HOPS`.
4. Add HSTS + COOP + CORP (`server.js:42-48`); keep XFO/frame-ancestors.
5. Complete Permissions-Policy + `X-XSS-Protection: 0`; explicit `font-src 'self'` and HTML `no-cache`.

**Acceptable to defer (documented):** `style-src 'unsafe-inline'`, COEP, cache strategy for hashed assets, known 8.2/8.3/8.13 session posture items.
