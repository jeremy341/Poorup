# HTTP security policy

This is the policy the server applies to every HTTP response. The code is in `server/securityHeaders.js` (headers, guards, timeouts), `server/httpErrors.js` (error answers), and `server/server.js` (the wiring). The tests are `server/http-security-headers.test.js`, plus the existing `server/http-surface-wire.test.js` and `server/staticAssets.test.js`.

## Response headers

Every response that Express handles, including static files, JSON, 404 and error pages, gets these. Socket.IO's own responses (`/socket.io/`) get the subset listed under "Socket.IO responses".

| Header | Value | Notes |
| --- | --- | --- |
| `Content-Security-Policy` | see below | |
| `X-Content-Type-Options` | `nosniff` | |
| `X-Frame-Options` | `DENY` | Kept for browsers that predate `frame-ancestors`. |
| `X-Permitted-Cross-Domain-Policies` | `none` | |
| `Referrer-Policy` | `same-origin` | No referrer leaves the site. |
| `Cross-Origin-Opener-Policy` | `same-origin` | Keeps window handles away from other sites. |
| `Cross-Origin-Resource-Policy` | `same-origin` | Other sites cannot embed this site's files. |
| `Origin-Agent-Cluster` | `?1` | |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), accelerometer=(), gyroscope=(), magnetometer=()` | The client uses none of these features (checked by grep: no `getUserMedia`, geolocation, motion or payment calls). |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Sent when `req.secure` is true: a direct TLS connection, or a request through the configured trusted proxies (`POORUP_TRUST_PROXY_HOPS` or a peer in `POORUP_TRUSTED_PROXY_ADDRESSES`) that reported `X-Forwarded-Proto: https`. A forwarded header from an untrusted peer is ignored. Production also sets `forceHsts`, so a TLS deployment that forgets the proxy setting still receives HSTS; on a plain-HTTP deployment that default should be turned off. No `preload`. |
| `X-Powered-By` | not sent | `app.disable('x-powered-by')` in `server.js`. |

## Content-Security-Policy

```
default-src 'self';
script-src 'self';
script-src-attr 'none';
style-src 'self' 'unsafe-inline';
style-src-elem 'self';
style-src-attr 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
media-src 'self';
connect-src 'self' [POORUP_PUBLIC_ORIGIN] (ws:/wss: only when no public origin is set outside production);
manifest-src 'self';
worker-src 'none';
frame-src 'none';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none'
```

Why each non-obvious directive is there:

- **`script-src 'self'` with no `'unsafe-inline'` and no `'unsafe-eval'`.** The client has no inline `<script>` blocks; `index.html` loads `/socket.io/socket.io.min.js` and `/main.js`, both same-origin. Pages built on the server (`/about`, `/rules`, error and recovery pages) have no executable inline script either. The JSON-LD blocks (`type="application/ld+json"`) are data, and the browser does not execute them, so the policy does not touch them.
- **`script-src-attr 'none'`.** Blocks inline event-handler attributes (`onclick=` and the like). None exist in the client; the client attaches listeners in JavaScript.
- **`style-src` split into element and attribute.** The markup and some JavaScript use `style="..."` attributes, so `'unsafe-inline'` stays for attributes. There are no `<style>` elements in the client or in server-rendered pages, so `style-src-elem 'self'` blocks injected style blocks. `style-src 'self' 'unsafe-inline'` is kept as a fallback for browsers that do not understand the `-elem`/`-attr` split.
- **`connect-src`.** Same origin covers the Socket.IO polling and WebSocket connections (`'self'` matches `ws:`/`wss:` for the same host). When `POORUP_PUBLIC_ORIGIN` is set, that origin is added explicitly. Outside production with no public origin, `ws:` and `wss:` stay open for local development.
- **`img-src 'self' data:`.** `public/css/02-base-and-helpers.css` uses an inline SVG `data:` URI for its grain texture.
- **`font-src 'self'`.** Fonts are served from `/assets/fonts/` (`@font-face` sources in `public/css/01-tokens-and-fonts.css`); no external font host.
- **`frame-src 'none'`, `worker-src 'none'`, `object-src 'none'`.** The client has no iframes, workers or plugins.
- **`frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.** Anti-clickjacking, base-tag injection, and forms posting only to this origin (the recovery and maintenance forms post to same-origin paths).

Not set: `upgrade-insecure-requests` (it would rewrite subresources on a plain-HTTP development server, and HSTS already covers HTTPS deployments); `report-uri` / `report-to` (there is no collector).

## CORS

- **HTTP routes send no `Access-Control-*` headers at all.** Cross-origin browser reads are impossible by construction, and the session cookie is `SameSite=Strict`.
- **Socket.IO uses an exact-origin allowlist from `POORUP_ALLOWED_ORIGINS`.** `createCorsOrigin` (for the CORS headers) and `isOriginAllowedForSocket` (for the handshake check) apply the same rule, so an origin that is refused at the handshake is also refused for CORS.
  - A configured list allows only the listed origins (exact scheme, host and port). A wildcard `*` entry is ignored by the socket policy.
  - With no list, production allows only requests with no `Origin` header (same-origin page loads and non-browser clients), and non-production allows any origin, as local play always has.
- **`Access-Control-Allow-Credentials` is never sent,** and no wildcard origin is ever reflected to a credentialed request. Socket.IO is configured without `credentials`.
- Production startup still refuses a missing, malformed or wildcard allowlist (`assertProductionCors`).

## Socket.IO responses

Socket.IO answers `/socket.io/` before Express runs, so the Express middleware does not reach it. `attachSocketHttpHeaders` (in `server.js`, after the Socket.IO server is created) adds these to every Socket.IO HTTP response, including the 403 for a refused origin:

- `X-Content-Type-Options: nosniff`
- `Cross-Origin-Resource-Policy: same-origin`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`

WebSocket upgrades are not HTTP responses and carry no headers of their own.

## Static files

`server/server.js` mounts the static guard first, then `express.static` (with `dotfiles` left at its default of `ignore`), and never serves a directory listing (`index: false`; a directory request falls through to the 404 page).

- **Private files are 404 at any path.** `isPrivateStaticPath` blocks `*.test.js`, `*.test.mjs`, `*.test.cjs` (the 69 test files under `public/`), source maps (`*.map`), and editor or backup copies (`*.bak`, `*.orig`, `*.old`, `*.swp`, `*~`). The check runs on the decoded path, so `%2e` and double-encoded forms are covered too.
- **Traversal.** `resolveInside` (in `staticAssets.js`) and `express.static`'s `send` both reject `..`, backslashes, NUL bytes and dot segments, after one decode. Double-encoded forms (`%252e%252e`) decode to a literal file name, which does not exist, so they are 404.
- **Dotfiles** such as `/.env` are 404.
- **Content types** come from the file extension through `express.static` and `staticAssets.js`. `X-Content-Type-Options: nosniff` stops a browser from re-sniffing a file's type.

## Method and Host checks

- **Method allowlist:** `GET`, `HEAD`, `POST`, `PATCH`, `DELETE`, `OPTIONS`. `PATCH` and `DELETE` are used by the AI provider admin routes (`aiProviderRoutes.js`). Any other method (`PUT`, `TRACE`, `PROPFIND`, ...) gets `405` with an `Allow` header. Matching is case-sensitive. `CONNECT` never reaches the app: Node drops it when there is no `connect` listener.
- **Malformed `Host` header** (anything outside hostname, IPv4 or bracketed IPv6, with an optional port): `400`, always.
- **Host allowlist (opt-in):** set `POORUP_ALLOWED_HOSTS` to a comma-separated list of hostnames. Any other `Host` gets `421`, except `/healthz` and `/readyz`, so a probe can address the pod directly. Unset means no allowlist, which keeps existing deployments working. Forwarded host headers are never read.
- **Forwarded headers** (`X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`) are trusted only when `POORUP_TRUST_PROXY_HOPS` is set to the number of proxies in front, or when the socket peer is listed in `POORUP_TRUSTED_PROXY_ADDRESSES`. Otherwise they are ignored, for the Express request (protocol, client address) and for the socket peer address alike. In production an undeclared posture stops the boot rather than silently pooling every client into one budget.

## Timeouts and sizes

- `headersTimeout` 15 s and `requestTimeout` 30 s (`hardenHttpServer`). These cut off a client that trickles its headers or body (slowloris). Node's defaults are 60 s and 300 s.
- `connectionsCheckingInterval` 5 s, so the timers above are checked at that granularity (Node's default is 30 s).
- The timers cover receiving the request only. A response that is still being produced (a Socket.IO long poll) is not interrupted; the test suite checks this.
- Node's default header limit of 16 KB applies. An oversized header block is refused by Node before any handler runs.
- Body sizes are limited per route (`express.json`/`urlencoded` limits of 2 KB to 12 KB, `server.js` and the admin routers). A body over its route's limit gets `413`.

## Error answers

- `404`, `405`, `413`, `415`, `421`, and `400` for malformed input are the only client errors the app answers on purpose; every other failure is a `500`.
- **API paths** (`/account`, `/admin`, `/internal`) answer with JSON: `{ "success": false, "error": "..." }`.
- **Other paths** answer with the HTML error page (`errorPage.js`).
- Messages are fixed strings. No response contains a stack trace, a file path, a request echo or an internal error message. A `500` carries only the generic "temporarily offline" page.

## Cookies

Two cookies are set. Both are `HttpOnly` and `SameSite=Strict`, and `Secure` is set when the deployment is production or `POORUP_COOKIE_SECURE=true`:

- the account session cookie (`sessionStore.js`);
- the maintenance operator cookie (`maintenanceAccess.js`), scoped to `Path=/`.

## Operator settings

| Variable | Effect on this policy |
| --- | --- |
| `NODE_ENV=production` | Secure cookies; production CORS rules (`POORUP_ALLOWED_ORIGINS` is required); `connect-src` is `'self'` (plus the public origin when set), with no `ws:`/`wss:` wildcard. |
| `POORUP_PUBLIC_ORIGIN` | Added to `connect-src`. |
| `POORUP_ALLOWED_ORIGINS` | Socket.IO and CORS origin allowlist. |
| `POORUP_ALLOWED_HOSTS` | Opt-in Host allowlist (421 for other hosts, except health probes). |
| `POORUP_TRUST_PROXY_HOPS` | Trusted proxy count; enables `X-Forwarded-Proto` for HSTS and the client address. |
| `POORUP_TRUSTED_PROXY_ADDRESSES` | Plain-IP list of proxy peers; forwarding headers are believed only from those peers. Use it whenever the app port can be reached without the proxy. |
| `POORUP_DIRECT_INTERNET` | Set to `true` when the app port is genuinely public with no proxy. In production one of the three proxy settings must be declared or boot fails. |
| `POORUP_ALLOW_MISSING_ORIGIN` | Set to `true` to restore permissive Origin-less admin writes for internal tooling; by default production refuses a cookie-authenticated write with no Origin header. |
| `POORUP_COOKIE_SECURE` | Forces `Secure` on the cookies. |

## Not done, and why

- **Removing `'unsafe-inline'` from `style-src-attr`.** The markup and some JavaScript build `style="..."` attributes in many places. Removing them needs a rewrite of the rendering code, which is outside a header change. The remaining risk is limited: style-only injection, with no script execution.
- **`Cross-Origin-Embedder-Policy`.** Would require `Cross-Origin-Resource-Policy` on every cross-origin resource the page loads. The client loads only its own origin's resources, so the value is low, and the risk to audio and Socket.IO is not worth it here.
- **HSTS `preload`.** Requires a submission to the preload list, which is an operator decision.
- **CSP reporting.** There is no report collector.
- **Subresource-integrity hashes** for `socket.io.min.js`. The file is served from the same origin by the bundled Socket.IO package and changes with the dependency; a pinned hash would break on every upgrade.

## Keeping it working

- `server/http-security-headers.test.js` boots the server and checks the header set, the 404/405/421 answers, Socket.IO CORS, HSTS gating, and the timers. It also scans `public/` for inline scripts, inline event handlers, `<style>` elements and external resources, so a change to the client that would break the CSP fails the suite.
- If a new client feature needs an inline handler, a `<style>` element, a frame, a worker, a font or image host, or a new browser API, change the policy in `securityHeaders.js` and this document together.
