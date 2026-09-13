# RR-05 — Auth & Session Lifecycle

**Audit:** Release Readiness (40-agent) · Wave 1 · Mission RR-05 · 2026-09-12
**Mode:** read-only; HEAD `b3599ee`, working tree clean
**Verdict:** HOLD. No P0 chain, and logout revocation, single-session rotation, scrypt+`timingSafeEqual`, generic login errors, and bounded session maps check out. But live-seat hijack, immortal localStorage bearer sessions, missing password lifecycle, and proxy-collapsible auth throttling are release gates.

Verified against `docs/audit/full-codebase-audit-2026-09-12.md` (R1 §8, R2 1.2/1.4/8.8, R3 2.1) and the 09-12 fix batches. No files modified.

## Findings

1. [BLOCKER] `server/rooms.js:735-743` + `serverSocketAccount.js:192-196` — `restoreConnection` still reassigns `player.socketId`/`disconnected=false` with no live-socket guard; a guest payload (no token) passes `accountId=null`, skipping the mismatch check at `rooms.js:742`, so any socket with a clientId can claim a live account seat. Status: prior R3 §2.1/§8.13 VERIFIED still open (tab-duplication copies sessionStorage). Impact: seat/identity takeover, two sockets flap one seat. Fix: reject if `player.socketId && player.socketId !== socket.id && !player.disconnected`; mark `disconnected=true` immediately on drop or add a per-socket restore secret.
2. [BLOCKER] `server/accountStore.js:459-498,451,496` + `public/clientSanitize.js:327-336` + `public/main.js:288-292` — sessions still have no TTL/expiry/sliding refresh; bearer token lives in `localStorage`, is re-sent on every event, and its SHA-256 hash persists in `accounts.json` across restarts. Status: prior §8.2/§8.14 VERIFIED open. New: `issueSession` now revokes all prior tokens/hashes (`:486-491`, pinned by `persistence.test.js:49-62`), fixing R2 §8.8 growth but not expiry. Impact: any storage/XSS leak = permanent ATO. Fix: add expiry + rotate on update, stop persisting hashes, prefer HttpOnly cookie.
3. [MAJOR] `public/clientSocketListeners.js:52-62` — restore failure still calls `saveAccountSession(null)` on any non-success ack (rate-limit, fail-safe), not just explicit invalidation. Status: prior R3 §1.2 VERIFIED open; no batch fixed it. Impact: transient server errors permanently sign the user out. Fix: clear only on `Account session expired`/invalid-token errors.
4. [MAJOR] `server/serverSocketAccount.js:149-167` + `server/rooms.js:742,383-386` + `server/accountStore.js:607` — NEW: guest→account upgrade never binds the seat (`player.accountId` stays null; `syncLobbySeatAppearance` no-ops at `serverSocketAccount.js:183`; only join binds). Impact: reload after registering returns "No active session found", and a finished match credits no stats. Fix: bind `player.accountId` for the socket-owned seat on register/login.
5. [MAJOR] NEW: no password-change flow anywhere — no store method (`accountStore.js` has only register/login/restore/logout/updateProfile) and the edit modal renders no password field (`clientAccountIdentity.js:281-284`). Impact: compromised/mistyped passwords can never be rotated. Fix: current-password-verified change that re-issues + revokes sessions.
6. [MAJOR] NEW: no password reset/recovery (no email, no codes) and registration has no confirm-password field (`clientAccountIdentity.js:283`; `accountStore.js:500-528`). Impact: a typo or forgotten password permanently locks the account — needs an explicit release decision. Fix: minimum confirm+reveal field and UI disclosure; otherwise operator-assisted reset.
7. [MAJOR] `server/serverSocketAccount.js:78-97` — auth bucket still keyed only on `handshake.address`; the new `POORUP_TRUST_PROXY_HOPS` (`server/server.js:39-40`) only affects Express, not this key. Status: prior §8.1 verified, partially mitigated. Impact: behind a proxy, 8 failed auths/min lock out all users. Fix: key on socket id + verified client IP (+ account when known).
8. [MAJOR] NEW behavior: `accountStore.js:485-498` revokes every other session on each login/register; the displaced client is silently downgraded to guest (`clientSocketListeners.js:55-60`) with no notice, session list, or "sign out all devices" affordance. Impact: multi-device use is impossible-by-accident and confusing. Fix: either notify displaced clients and expose revocation, or move to per-session map with explicit revoke-all.
9. [MINOR] `public/clientAccountIdentity.js:505-507` — `account-logout` ack is `noop`, so server failure is invisible (prior §4.13 verified). Fix: surface via `parlorNotice`.
10. [MINOR] NEW: no cross-tab session sync — only `storage` listener is theme (`clientTheme.js:184`); logout in tab A leaves tab B visually signed in with a revoked token. Fix: listen for the session key and mirror sign-out.
11. [MINOR] `server/serverSocketAccount.js:118-122` — `check-username` unauthenticated, only generic per-socket limit (240/10s, `socketRateLimiter.js:3`), exact available/taken (prior §8.10 verified). Fix: per-IP throttle + generic message.
12. [MINOR] `server/accountStore.js:524-527,563-564` — register/login mutate memory and issue sessions before `persist()`; a write throw is acked as failure but leaves an in-memory account whose retry says "already taken" (prior R2 §1.4 verified). Fix: persist/rollback before issuing.
13. [MINOR] NEW edge: display names aren't normalized — `accountStore.js:103-106` and `clientSanitize.js:291-294` trim + `slice(0,18)` UTF-16 units, allowing bidi/RTL spoofing and split surrogate pairs; uniqueness is intentionally absent (`appearanceApi.js:137-143`). Fix: NFKC, strip control/bidi chars, truncate by code points.
14. [MINOR] `server/accountStore.js:41-43` — password policy is length 8–72 only; no deny-list/strength meter. Fix: small common-password deny-list or meter.
15. [MINOR] NEW: no per-account lockout — login skips scrypt for unknown users (`accountStore.js:555`), so distributed guessing and timing enumeration survive generic errors + `timingSafeEqual`. Fix: per-account counter + dummy hash compare.

## Must-fix before release

1. Live-seat guard + guest restore binding.
2. Session expiry/rotation (or written risk acceptance) and hashes out of `accounts.json`.
3. Clear stored session only on explicit invalidation.
4. Bind account to owned seat.
5. Ship password change + decide recovery stance (confirm field minimum).
6. Fix auth bucket keying behind proxy.
