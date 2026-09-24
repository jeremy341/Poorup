# Account Rights and Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, self-service account export, 30-day deactivation/deletion, verified recovery-email flow, server-side sessions, retention jobs, and a compact Privacy surface without changing the Poorup game layout or gameplay.

**Architecture:** Extend the existing modular monolith at its account, store, Socket.IO, and Profile seams. Account identity is derived from a server-side session record referenced by an `HttpOnly`, `Secure`, `SameSite` cookie; the existing game remains server-authoritative and existing room/game events remain unchanged. A deletion coordinator performs an idempotent, rollback-safe cascade across account-linked stores, while a daily retention worker handles the 30-day grace period, 12-month aggregate retention, and 30-day backup retention.

**Tech Stack:** Node.js ES modules, Express, Socket.IO, the existing JSON stores and atomic persistence helpers, vanilla HTML/CSS/JavaScript, the existing Poorup modal/surface controller, Node assertion tests, ESLint, Playwright, the existing analytics privacy projection, and the configured provider-neutral HTTP mail adapter.

**Spec:** `docs/decisions/account-rights-and-auth-2026-09-17.md`

## Global Constraints

- Account deletion starts only from the authenticated Profile → Account surface.
- A seated player cannot request deletion while in an active room or round; Profile shows `LEAVE TABLE FIRST`.
- The user must re-enter the current password and type the exact phrase `DELETE ACCOUNT`.
- The first request deactivates the account for 30 days; a daily job performs final deletion after the grace period.
- During deactivation only export, recovery-email management, cancellation, and sign-out remain available.
- Deactivated accounts disappear immediately from search, rankings, Friends, invites, and public profiles; existing references show `ACCOUNT DEACTIVATED`.
- Cancellation requires a normal login plus password confirmation in Profile.
- All other sessions are revoked at the moment deactivation succeeds; the current session is restricted to recovery/deletion-pending actions.
- Sessions expire after 30 days of inactivity or 90 days absolute lifetime.
- Session records stay server-side and are referenced by an `HttpOnly`, `Secure`, `SameSite` cookie; new devices can create independent sessions.
- No new bearer session token is persisted in `localStorage`; an explicit one-time migration may exchange an existing legacy token for a cookie.
- Guest match history is not personally retained server-side; only active room state, local client state, and sanitized aggregate analytics remain.
- After final deletion, personal account, Social, Cosmetics, achievements, and account-linked history are purged; only irreversible aggregate analytics remain for 12 months.
- Backups rotate for 30 days and are checksum-verified before purge or anonymization.
- Recovery email is optional after account creation, private, and inactive until a single-use 30-minute verification link succeeds.
- Password-reset links are single-use, expire after 30 minutes, and revoke all sessions after successful use.
- Recovery lifecycle emails never include passwords, tokens, private game data, or provider credentials.
- The mail implementation is provider-neutral and reads `POORUP_MAIL_API_URL`, `POORUP_MAIL_API_KEY`, and `POORUP_MAIL_FROM` from the environment.
- The public legal surface contains only the approved compact Privacy & Account Data page; no Terms-of-Service route is created.
- Support points to `https://github.com/jeremy341/Poorup/issues`.
- Existing Poorup layout, typography, board geometry, navigation, Socket.IO event names, economy rules, and gameplay remain unchanged.
- UI additions stay inside the existing Profile account panel and existing modal/surface shell.
- All destructive and security-sensitive actions are authenticated, rate-limited, idempotent, and tested for stale requests.
- No account deletion, email recovery, or Privacy copy is presented as active until the required operator/mail configuration is supplied.

## Confirmed policy matrix

| Policy | Value | Implementation consequence |
|---|---|---|
| Grace period | 30 days | `deletionRequestedAt` and `deletionDueAt` are persisted and normalized. |
| Finalizer | Daily automatic job plus operator trigger | Job is bounded, idempotent, observable, and safe to retry. |
| Account location | Profile only | No delete/export controls in Footer, Home, Lobby, Social, or Game. |
| Active room | Block request | Room membership is checked server-side before the deletion marker is written. |
| Confirmation | Password + `DELETE ACCOUNT` | Both are validated server-side; client validation is only feedback. |
| Deactivation UI | Restricted Profile | No play, Social, room, or account-edit actions while pending. |
| Cancellation | Login + Profile + password | Clears the marker and restores visibility only after persistence succeeds. |
| Export | Immediate owner-safe JSON | Server builds the document; client downloads a Blob after acknowledgement. |
| Personal purge | Full account-linked cascade | Account, sessions, Social, Cosmetics, achievements, personal history, and linked projections are removed. |
| Analytics | Aggregate-only, 12 months | Existing HMAC pseudonym and suppression boundary remains authoritative. |
| Backups | 30-day rolling | Old generations and sidecars are pruned as pairs; affected deletion snapshots are purged/anonymized. |
| Session policy | 30-day idle / 90-day absolute | Cookie session metadata is checked on every authenticated request. |
| Recovery email | Optional, verified | New address remains pending until a 30-minute token is consumed. |
| Username | Reserved during grace, released after purge | `checkUsername` treats pending-deletion handles as unavailable. |
| Legal scope | Privacy only | No ToS, AUP, or age-policy route is added in this plan. |

## File and ownership map

### Server files

- Create `server/sessionStore.js` — server-side session records, idle/absolute expiry, cookie helpers, revocation, and migration exchange.
- Create `server/sessionStore.test.js` — expiry, rotation, revocation, cross-device, cookie flags, and legacy-token exchange tests.
- Create `server/mailAdapter.js` — provider-neutral transactional mail interface with bounded templates and injectable `fetch`.
- Create `server/mailAdapter.test.js` — endpoint, auth header, template, timeout, retry, and redaction tests.
- Create `server/accountRecovery.js` — hashed email-verification/reset tokens and recovery state transitions.
- Create `server/accountRecovery.test.js` — token expiry, replay, wrong account, email replacement, reset revocation, and notification tests.
- Create `server/accountDeletion.js` — request, cancellation, finalization, cascade ordering, anonymization, and rollback coordinator.
- Create `server/accountDeletion.test.js` — policy guards, idempotency, store cascade, active-room blocking, rollback, username release, and backup handling.
- Create `server/accountExport.js` — owner-safe export projection and bounded JSON serialization.
- Create `server/accountExport.test.js` — field allow-list, redaction, ordering, size limits, and no-secret assertions.
- Create `server/retentionJob.js` — daily due-deletion and age-retention runner with explicit health output.
- Create `server/retentionJob.test.js` — 30-day due processing, 12-month analytics pruning, 30-day backup pruning, retry, and idempotency.
- Modify `server/accountStore.js` — normalized deletion/recovery metadata, server-side session integration, username reservation, and account-linked purge primitives.
- Modify `server/serverSocketAccount.js` — cookie-derived authentication, account-rights events, recovery events, cross-tab invalidation, and exact error codes.
- Modify `server/server.js` — cookie middleware, account-rights routes, mail/recovery/deletion wiring, retention lifecycle, and graceful shutdown disposal.
- Modify `server/socialStore.js` — account purge and deactivation visibility filters with atomic snapshot/restore support.
- Modify `server/matchStore.js` and `server/matchHistoryAdapter.js` — account purge/anonymization and guest-history exclusion.
- Modify `server/achievementStore.js`, `server/seasonModule.js`, and `server/cosmeticCatalog.js` — account purge hooks that preserve aggregate rows only.
- Modify `server/analyticsRollupStore.js` — 12-month retention configuration and account-independent aggregate guarantee.
- Modify `server/backupStore.js` — age-based 30-day rotation, pair-safe sidecar cleanup, and verified account anonymization/purge.
- Modify `server/serverSocketSocial.js` and `server/summaryApi.js` — hide deactivated identities and reject Social reads/actions for restricted accounts.

### Client files

- Create `public/clientAccountRights.js` — Profile-only export, revoke, recovery-email, delete, cancellation, and pending-state bindings.
- Create `public/clientAccountRights.test.js` — state transitions, request IDs, field validation, cross-tab events, and no-op guest behavior.
- Create `public/clientPrivacyPage.js` only if the existing static shell needs a minimal navigation helper; the Privacy document itself remains HTML-first.
- Modify `public/index.html` — compact Data Rights block inside the existing signed account panel, Privacy link in the existing footer ticker, and no new top-level navigation.
- Modify `public/clientAccountIdentity.js` and `public/clientProfileRender.js` — signed/deactivated/guest states, recovery-email status, and Profile-only controls.
- Modify `public/clientState.js` and `public/clientStateSync.js` — session/deactivation fields and safe snapshot reconciliation.
- Modify `public/clientSocketListeners.js` — cookie-session bootstrap, cross-tab invalidation, deactivation/cancellation updates, and explicit transient-error handling.
- Modify `public/clientSurfaces.js` — reuse the managed confirmation surface for deletion and recovery actions with focus restoration.
- Modify `public/styles.css` — compact Data Rights presentation, pending/deactivated states, focus/error styling, and responsive/iPad rules using existing tokens.
- Create `public/privacy.html` — static, accessible Privacy & Account Data page with factual behavior, retention table, deletion/export explanation, and GitHub Issues support link; no ToS content.

### QA and documentation files

- Create `qa/account-rights.spec.js` — desktop, iPad landscape, mobile, guest, signed-in, pending-deletion, cancellation, export, and modal keyboard flows.
- Create `qa/privacy-page.spec.js` — static page accessibility, no page overflow, safe links, and absence of ToS claims.
- Modify `qa/playwright.config.js` only if a new cookie/session fixture project is required; keep existing viewport names.
- Modify `server/release-wiring.test.js` — account-rights routes, cookie flags, retention lifecycle, and disabled-mail behavior.
- Modify `docs/feature-status.json` only after the implementation commit SHA exists.
- Create `docs/decisions/mail-and-operator-config-2026-09-17.md` after the owner supplies non-code deployment facts.
- Update `docs/production-hardening.md` and the current release audit (historical `docs/audit/**` reports were removed with the docs cleanup) with factual status and verification links.
- Keep historical ToS/legal/music-box plans; mark them superseded rather than deleting them.

## Skill usage

The implementation pass uses the following guidance at the relevant gates:

| Workstream | Skills and application |
|---|---|
| Discovery and adversarial decisions | `grill-me` (manual fallback because its internal `grilling` tool is unavailable), `superpowers:brainstorming`, `superpowers:writing-plans`, `find-skills` |
| Architecture and data ownership | `software-architecture-design`, `code-architecture-review`, `thermo-nuclear-code-quality-review`, `superpowers:systematic-debugging` |
| Authentication and deletion safety | `security-best-practices`, `tdd`, `qa-agent-testing`, `agentic-eval` |
| Profile UI and information architecture | `frontend-design`, `frontend-design-ui-ux`, `frontend-design-review`, `design-taste-frontend`, `critique`, `impeccable`, `game-ui-ux` |
| Responsive and accessibility behavior | `mobile-responsiveness`, `accessibility`, `web-design-guidelines`, WCAG 2.2 keyboard/focus/name/role/value checks |
| Motion and feedback | `animate`, `design-motion-principles`, `emilkowal-animations`, `improve-animations`, `review-animations`; only transform/opacity feedback using current Poorup tokens |
| Existing art system | `svg-design`, `pixel-art-sprites`, `Pixel Art Animator`; no new artwork is needed for the Data Rights surface, but any icon must use local crisp-edge Poorup assets |
| Analytics and retention evidence | `kpi-dashboard-design`, `chart-visualization`; preserve aggregate-only charts and truthful unavailable states |
| Execution and sign-off | `superpowers:executing-plans`, `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, `superpowers:finishing-a-development-branch` |

The UI skills are used for a constrained extension, not a redesign: existing
Poorup colors, fonts, spacing, borders, modal shell, and responsive breakpoints
remain authoritative. Animation guidance applies only to pending/error/status
feedback; deletion never receives celebratory or distracting motion.

## Implementation tasks

### Task 1: Freeze the account-rights contract

**Files:**
- Read: `docs/decisions/account-rights-and-auth-2026-09-17.md`
- Modify: `docs/feature-status.json` only after the implementation SHA exists
- Test: `server/docsFeatureStatus.test.js`, `server/docs-parity.test.js`

**Interfaces:**
- Consumes: the confirmed policy matrix in the decision record.
- Produces: a single source of truth for server/client tasks and release copy.

- [ ] Step 1: Confirm the decision record contains the 30-day grace, Profile-only entry, export, session, recovery, retention, guest, username, mail, support, and no-ToS decisions.
- [ ] Step 2: Run `node server/docsFeatureStatus.test.js` and `node server/docs-parity.test.js`.
- [ ] Step 3: Record any missing deployment facts as an explicit release gate; do not invent operator identity, mail credentials, or legal language.
- [ ] Step 4: Keep the working tree uncommitted until implementation and verification are complete.

### Task 2: Add server-side session records and cookie bootstrap

**Files:**
- Create: `server/sessionStore.js`
- Modify: `server/server.js`, `server/serverSocketAccount.js`, `server/accountStore.js`
- Test: `server/sessionStore.test.js`, `server/serverSocketAccount.test.js`

**Interfaces:**
- `createSessionStore({ now, idleTtlMs, absoluteTtlMs, persist })` returns `{ issue, resolve, touch, revoke, revokeOthers, exchangeLegacy, cookie, clearCookie, snapshot, close }`.
- `issue(accountId, { userAgentClass, ipClass })` returns `{ sessionId, cookieValue, expiresAt, absoluteExpiresAt }`; raw cookie values never enter persistence.
- `resolve(cookieValue)` returns `{ accountId, sessionId, expiresAt }` or `{ accountId: null, reason: 'expired'|'invalid' }`.

- [ ] Step 1: Write failing tests for 30-day idle expiry, 90-day absolute expiry, per-device sessions, revocation of other sessions, and `HttpOnly; Secure; SameSite=Lax` cookie attributes.
- [ ] Step 2: Run `node server/sessionStore.test.js`; verify the tests fail because the module is absent.
- [ ] Step 3: Implement hashed server-side session records with `createdAt`, `lastSeenAt`, `expiresAt`, `absoluteExpiresAt`, and `revokedAt`; never store the raw cookie value.
- [ ] Step 4: Add HTTP cookie parsing and Socket.IO handshake resolution without changing existing game event names or payloads.
- [ ] Step 5: Add one-time legacy bearer exchange: accept the old token only through an authenticated migration path, issue the cookie, revoke the old token, and return no new bearer token to the client.
- [ ] Step 6: Run `node server/sessionStore.test.js server/serverSocketAccount.test.js` as separate Node commands; both must pass.

### Task 3: Normalize account deletion and recovery metadata

**Files:**
- Modify: `server/accountStore.js`
- Test: `server/accountStore.test.js`, `server/account-session-audit.test.js`

**Interfaces:**
- `sanitizeAccountLifecycle(account)` returns bounded `deletionRequestedAt`, `deletionDueAt`, `deletionRequestId`, `recoveryEmail`, `recoveryEmailVerifiedAt`, `pendingRecoveryEmail`, and `pendingRecoveryEmailExpiresAt`.
- `accountStore.accountForSession(request)` resolves the server-side session identity.
- `accountStore.isDeletionPending(accountId)` returns a boolean without exposing internal timestamps publicly.

- [ ] Step 1: Write failing migration tests for missing, malformed, future, and overlong lifecycle fields.
- [ ] Step 2: Run the focused store tests and capture the expected failures.
- [ ] Step 3: Add bounded normalization and preserve unknown historical fields only where existing store policy allows it.
- [ ] Step 4: Ensure public account projections expose only `deletionPending`, `deletionDueAt` when viewing the owner, and masked recovery-email status; never expose password/session internals.
- [ ] Step 5: Run the account persistence and privacy suites.

### Task 4: Implement the provider-neutral mail adapter

**Files:**
- Create: `server/mailAdapter.js`
- Test: `server/mailAdapter.test.js`
- Modify: `server/server.js`, `docs/production-hardening.md`

**Interfaces:**
- `createMailAdapter({ apiUrl, apiKey, from, fetchImpl, now, timeoutMs })` returns `{ configured, sendVerificationEmail, sendPasswordResetEmail, sendDeletionRequestedEmail, sendDeletionCancelledEmail, sendDeletionCompletedEmail, close }`.
- Every sender method accepts `{ to, displayName, token, expiresAt }` and returns `{ success, messageId: null|string, reason: null|string }`.

- [ ] Step 1: Write failing tests for missing configuration, HTTPS endpoint validation in production, bounded recipient/template fields, timeout, provider 4xx/5xx, and redacted logs.
- [ ] Step 2: Run `node server/mailAdapter.test.js` and confirm the failure is isolated to the missing adapter.
- [ ] Step 3: Implement a single HTTP request path with an abort timeout, no raw provider response in the client, and no secrets in logs.
- [ ] Step 4: Keep lifecycle deletion progressing if mail delivery fails; record a sanitized delivery failure for operator health instead of blocking the purge.
- [ ] Step 5: Run the mail and server wiring tests.

### Task 5: Add verified recovery-email and password-reset flows

**Files:**
- Create: `server/accountRecovery.js`
- Modify: `server/accountStore.js`, `server/serverSocketAccount.js`, `server/server.js`
- Test: `server/accountRecovery.test.js`, `server/serverSocketAccount.test.js`

**Interfaces:**
- `createAccountRecovery({ accountStore, sessionStore, mailAdapter, now, randomBytes })` returns `{ requestEmailChange, verifyEmailChange, requestPasswordReset, completePasswordReset, revokeRecoveryTokens }`.
- Events remain bounded and explicit: `recovery-email-start`, `recovery-email-verify`, `password-reset-request`, `password-reset-complete`.

- [ ] Step 1: Write failing tests for optional post-creation email, current-password confirmation, old-address notification, 30-minute single-use verification, reset token replay, and session revocation after reset.
- [ ] Step 2: Run the focused recovery tests and capture failures.
- [ ] Step 3: Store only token hashes and expiry metadata; issue opaque links through the mail adapter.
- [ ] Step 4: Keep the old verified email active until the replacement is verified.
- [ ] Step 5: Return the same generic response for unknown reset addresses to prevent account enumeration.
- [ ] Step 6: Run recovery, account-session, privacy, and Socket.IO contract tests.

### Task 6: Build the idempotent account-deletion coordinator

**Files:**
- Create: `server/accountDeletion.js`
- Modify: `server/accountStore.js`, `server/socialStore.js`, `server/matchStore.js`, `server/achievementStore.js`, `server/seasonModule.js`, `server/cosmeticCatalog.js`, `server/backupStore.js`
- Test: `server/accountDeletion.test.js`

**Interfaces:**
- `createAccountDeletionCoordinator({ accountStore, sessionStore, roomManager, socialStore, matchStore, achievementStore, seasonStore, cosmeticStore, telemetryStore, backupStore, mailAdapter, now })` returns `{ request, cancel, runDue, purge, status }`.
- `request({ session, requestId, currentPassword, typedUsername })` returns `{ success, state: 'pending', dueAt }` or a stable error code.
- `cancel({ session, requestId, currentPassword })` returns `{ success, state: 'active'|'cancelled' }`.
- `runDue()` returns `{ processed, succeeded, failed }` and is safe to repeat.

- [ ] Step 1: Write failing tests for active-room blocking, wrong password, wrong phrase, stale request ID, duplicate request replay, and no mutation on rejection.
- [ ] Step 2: Write failing cascade tests for Social, matches, achievements, seasons, Cosmetics, session records, backup copies, and aggregate analytics retention.
- [ ] Step 3: Run `node server/accountDeletion.test.js` and confirm the failure output identifies missing coordinator behavior.
- [ ] Step 4: Implement the request transition atomically: verify session/account/password/username, verify no active room, persist pending marker, revoke other sessions, and publish a cross-tab invalidation event.
- [ ] Step 5: Implement restricted-state cancellation and restore visibility only after the marker is cleared durably.
- [ ] Step 6: Implement final purge in this exact order: lock request ID, send final notice best-effort, purge account/session/Social/Cosmetics/achievement/season/history projections, anonymize retained aggregate references, purge/anonymize affected backups, release username, then remove the deletion marker.
- [ ] Step 7: Use existing snapshot/restore transaction seams so any failed store write restores every in-memory mutation and returns `DELETION_NOT_COMPLETED`.
- [ ] Step 8: Run the coordinator tests with persistence-failure and process-restart fixtures.

### Task 7: Add owner-safe data export

**Files:**
- Create: `server/accountExport.js`
- Modify: `server/serverSocketAccount.js`, `server/server.js`
- Test: `server/accountExport.test.js`, `server/serverSocketAccount.test.js`

**Interfaces:**
- `buildAccountExport({ account, social, cosmetics, matches })` returns a plain JSON-safe object with `{ schemaVersion: 1, generatedAt, profile, designs, statistics, matchHistory, achievements, social, recoveryEmail }`.
- `account-export` returns `{ success, filename, contentType: 'application/json', document }` only to the authenticated owner; the HTTP route uses `Content-Disposition: attachment`.

- [ ] Step 1: Write failing allow-list tests that assert no password hash/salt, bearer token, session hash, account-internal ID, opponent private term, raw chat, provider secret, IP, or User-Agent appears anywhere in serialized output.
- [ ] Step 2: Implement stable ordering, bounded arrays, and masked recovery-email status plus the owner’s own address.
- [ ] Step 3: Add a request ID and one export operation per short rate-limit window.
- [ ] Step 4: Run export, privacy, and route-security tests.

### Task 8: Wire account-rights events and restricted-session guards

**Files:**
- Modify: `server/serverSocketAccount.js`, `server/serverSocketSocial.js`, `server/serverSocketGame.js`, `server/rooms.js`, `server/summaryApi.js`
- Test: `server/release-wiring.test.js`, `server/rooms.test.js`, `server/serverSocketSocial.test.js`

**Interfaces:**
- Every authenticated account-rights handler receives identity from the cookie/session context, not a client account ID.
- Restricted accounts receive `{ success: false, code: 'ACCOUNT_DELETION_PENDING', error: 'Account deletion is pending.' }` for play, Social writes, room creation/join, and account edit verbs.
- Public projections use `accountDeactivated: true` only where an existing relationship requires a stable reference; public search/list endpoints omit the row.

- [ ] Step 1: Add failing tests for restricted play, Social writes, account edits, room creation/join, public-search omission, and existing-reference labeling.
- [ ] Step 2: Add one server guard at the existing authenticated action boundary instead of duplicating checks in every game verb.
- [ ] Step 3: Preserve guest play and bot behavior; restricted account guards apply only to the deactivated account.
- [ ] Step 4: Run all account, room, Social, and game contract suites.

### Task 9: Add the Profile-only Data Rights surface

**Files:**
- Create: `public/clientAccountRights.js`, `public/clientAccountRights.test.js`
- Modify: `public/index.html`, `public/clientAccountIdentity.js`, `public/clientProfileRender.js`, `public/clientState.js`, `public/styles.css`
- Test: `qa/account-rights.spec.js`

**Interfaces:**
- `configureAccountRights({ emitServer, announce, openSurface, closeSurface, renderAccountPanel })` installs the Profile-only bindings.
- `renderAccountRights(accountState)` renders guest, active, and deletion-pending states without adding navigation.
- Controls use existing IDs/data attributes: `[data-account-export]`, `[data-account-revoke-sessions]`, `[data-recovery-email]`, `[data-account-delete]`, `[data-account-cancel-deletion]`.

- [ ] Step 1: Add failing DOM-contract tests for signed/guest/pending states, no footer delete button, and no controls in Home/Lobby/Game.
- [ ] Step 2: Add a compact `DATA RIGHTS` section inside the existing signed account panel with `DOWNLOAD MY DATA`, `REVOKE OTHER SESSIONS`, `RECOVERY EMAIL`, and red `DELETE ACCOUNT` controls.
- [ ] Step 3: Keep the same Poorup panel, type scale, gold rules, square controls, spacing, and responsive breakpoints; do not create a new card system.
- [ ] Step 4: Render pending status text with `role=status` and `aria-live=polite`; expose only owner-safe recovery status.
- [ ] Step 5: Run `node public/clientAccountRights.test.js` and the existing client contract tests.

### Task 10: Implement deletion/recovery modal interaction and focus behavior

**Files:**
- Modify: `public/clientAccountRights.js`, `public/clientAccountIdentity.js`, `public/clientSurfaces.js`, `public/clientState.js`, `public/styles.css`
- Test: `public/clientSurfaceFocus.test.js`, `public/clientAccountRights.test.js`, `qa/account-rights.spec.js`

**Interfaces:**
- `openAccountDeletionDialog({ opener })` opens the existing managed surface with password, typed phrase, consequence copy, and stable error IDs.
- `openRecoveryEmailDialog({ opener })` opens the existing account modal shell; it never exposes a token in the DOM.

- [ ] Step 1: Write failing keyboard tests for focus entry, Escape/scrim cancellation, password/phrase errors, focus restoration, and disabled pending buttons.
- [ ] Step 2: Reuse `openSurface`, `closeSurface`, `openConfirmModal`, and the existing focus trap; do not create a parallel dialog controller.
- [ ] Step 3: Add `aria-describedby`, `aria-invalid`, `aria-busy`, and `role=alert` only for the relevant error state.
- [ ] Step 4: Animate only status opacity/transform with existing motion tokens; `prefers-reduced-motion` removes travel and transition.
- [ ] Step 5: Run client focus, responsive/a11y, and browser account-rights tests at 1920×1080, iPad landscape, and 390×844.

### Task 11: Implement cross-tab and local-data reconciliation

**Files:**
- Modify: `public/clientSanitize.js`, `public/clientSocketListeners.js`, `public/clientState.js`, `public/clientAccountRights.js`
- Test: `public/clientCrossTabSignout.test.js`, `public/clientAccountRights.test.js`, `qa/account-rights.spec.js`

**Interfaces:**
- `reconcileAccountLifecycleEvent(event)` accepts `signed-out`, `deletion-pending`, `deletion-cancelled`, and `deleted` events and updates all open tabs.
- `clearAccountOwnedClientState()` clears account-derived keys only after server acknowledgement; unrelated app keys remain intact.

- [ ] Step 1: Add failing storage-event tests for logout, deactivation, cancellation, and final deletion across two tabs.
- [ ] Step 2: Replace bearer persistence with cookie bootstrap and keep only non-sensitive UI preferences locally.
- [ ] Step 3: Clear profiles, account achievements, saves, alias, and account-linked preferences after final deletion; preserve the visual theme preference unless the user explicitly resets it.
- [ ] Step 4: Ensure transient restore/rate-limit failures never erase a valid local session before the server returns an explicit invalid/expired code.
- [ ] Step 5: Run cross-tab, session, and browser tests.

### Task 12: Add daily deletion and retention processing

**Files:**
- Create: `server/retentionJob.js`, `server/retentionJob.test.js`
- Modify: `server/server.js`, `server/analyticsRollupStore.js`, `server/backupStore.js`
- Test: `server/release-wiring.test.js`

**Interfaces:**
- `createRetentionJob({ deletionCoordinator, analyticsRollupStore, backupStore, now, intervalMs })` returns `{ runOnce, start, stop, status }`.
- `runOnce()` returns `{ deletions, analyticsPruned, backupsPruned, failures }` with bounded counts and no personal identifiers.

- [ ] Step 1: Write failing fake-clock tests for due dates at 29 days, exactly 30 days, and after 30 days; add 12-month analytics and 30-day backup fixtures.
- [ ] Step 2: Implement one unref’d daily interval plus an operator-callable `runOnce` seam; run once at startup after stores are loaded.
- [ ] Step 3: Prune analytics by timestamp and keep existing minimum-cohort/pseudonym rules intact.
- [ ] Step 4: Rotate backup JSON and `.sha256` sidecars by age as pairs; verify before deleting or rewriting any file.
- [ ] Step 5: Run retention, backup, analytics, and shutdown tests.

### Task 13: Add the compact Privacy & Account Data page

**Files:**
- Create: `public/privacy.html`
- Modify: `server/server.js`, `public/index.html`, `public/styles.css`
- Test: `qa/privacy-page.spec.js`, `server/release-wiring.test.js`

**Interfaces:**
- `GET /privacy` serves the static page with no account/game data and no session requirement.
- The page contains factual sections: data collected, guest mode, account data, Social/match projections, AI provider boundary, analytics aggregation, 30-day deactivation, export, final deletion, recovery email, session policy, retention table, support link, and last-updated marker.

- [ ] Step 1: Write a static contract test asserting `/privacy` exists, `/terms` is not created, and no unsupported operator/contact facts are fabricated.
- [ ] Step 2: Create the page using the existing Poorup outer shell, document-style Rules layout, square panels, and internal scroll; do not alter Home/game layout.
- [ ] Step 3: Add one compact footer link labelled `PRIVACY & ACCOUNT DATA` pointing to `/privacy` and the verified GitHub Issues URL for support.
- [ ] Step 4: Keep all copy factual and mark deployment-supplied operator identity/mail facts as unavailable until configured.
- [ ] Step 5: Run the static page browser test at 1920×1080, iPad landscape, mobile, forced colors, reduced motion, and 200% zoom.

### Task 14: Add security, abuse, and observability guards

**Files:**
- Modify: `server/httpRateLimiter.js`, `server/serverSocketAccount.js`, `server/server.js`, `server/metricsRegistry.js`, `docs/production-hardening.md`
- Test: `server/httpRateLimiter.test.js`, `server/release-wiring.test.js`, `server/runtime-safety.test.js`

**Interfaces:**
- Deletion, export, email verification, password reset, and session revocation each use a bounded per-account and per-network rate budget.
- Metrics expose counts only: `account-deletion-requested`, `account-deletion-cancelled`, `account-deletion-completed`, `account-deletion-failed`, `account-exported`, `recovery-email-verified`, `password-reset-completed`.

- [ ] Step 1: Add failing rate-limit and metric-redaction tests.
- [ ] Step 2: Require a validated Origin for cookie-authenticated destructive HTTP calls and retain Socket.IO origin admission for socket events.
- [ ] Step 3: Add generic enumeration-resistant responses for reset and email-change requests.
- [ ] Step 4: Keep logs free of email addresses, account IDs, tokens, passwords, provider payloads, and raw request bodies.
- [ ] Step 5: Run security, runtime-safety, and route tests.

### Task 15: Verify responsive, accessibility, motion, and visual quality

**Files:**
- Test: `qa/account-rights.spec.js`, `qa/privacy-page.spec.js`, existing client/a11y suites
- Evidence: `qa-artifacts/account-rights-2026-09-17/`

**Interfaces:**
- Browser fixtures expose stable states: guest Profile, signed Profile, recovery-email pending, deletion dialog, deletion-pending Profile, cancellation success, Privacy page, and export acknowledgement.

- [ ] Step 1: Capture each state at 1920×1080 and inspect every image at native resolution before declaring the slice complete.
- [ ] Step 2: Run 1366×768, 1024×768 landscape, iPad landscape, and 390×844 with no document overflow.
- [ ] Step 3: Verify keyboard-only focus, screen-reader names/roles, live-region announcements, forced colors, reduced motion, and 200% zoom.
- [ ] Step 4: Check modal layering, 40px close targets, 44px iPad touch targets, input alignment, error recovery, and focus restoration.
- [ ] Step 5: Run Impeccable once on the changed UI files and record findings without global suppression; run animation review on the new status feedback only.
- [ ] Step 6: Run the existing SVG/pixel-art asset audit; no new decorative asset is accepted unless it passes integer geometry, crisp edges, no filters/gradients/text, and 1x readability.

### Task 16: Prepare deployment and rollback documentation

**Files:**
- Modify: `docs/production-hardening.md`, `docs/DEVELOPMENT_WORKFLOW.md`, `README.md`
- Create: `docs/decisions/mail-and-operator-config-2026-09-17.md`
- Test: `server/release-wiring.test.js`, maintenance/backup smoke suites

**Interfaces:**
- Required environment keys are documented without values: mail endpoint/key/from, cookie secret, canonical HTTPS origin, admin IDs, backup directory, analytics key, and retention intervals.
- Rollback means restoring the previous verified release and checksum-valid stores; it never re-enables a deleted account.

- [ ] Step 1: Record the operator identity, mail sender/domain, canonical host, backup path, monitoring destination, and last-updated Privacy owner in the deployment decision record.
- [ ] Step 2: Document cookie/TLS/HSTS/Origin requirements and the 30-day/12-month retention jobs.
- [ ] Step 3: Add a staging smoke sequence: register → set/verify recovery email → export → revoke other session → request deletion → verify restricted Profile → cancel → request again → run due deletion in a staging store.
- [ ] Step 4: Add backup restore verification before any purge promotion.
- [ ] Step 5: Run maintenance-drain, backup, readiness, and release-wiring tests.

### Task 17: Final review and release evidence

**Files:**
- Read: all changed files and both account-rights documents
- Evidence: `docs/production-hardening.md` + `server/accountDeletion.test.js` (historical audit report removed)

- [ ] Step 1: Run `npm run test:full --silent`.
- [ ] Step 2: Run `npm run lint -- --quiet` and `npm run lint:client -- --quiet`.
- [ ] Step 3: Run `npm audit --omit=dev --audit-level=moderate` and `git diff --check`.
- [ ] Step 4: Run the full Playwright matrix plus the focused account-rights/privacy specs.
- [ ] Step 5: Inspect all 1920×1080 screenshots at native resolution and record paths, viewport, fixture state, and findings.
- [ ] Step 6: Run CodeScene on the exact candidate SHA when `CS_ACCESS_TOKEN` is supplied; record the authenticated result rather than a local substitute.
- [ ] Step 7: Run architecture, security, accessibility, motion, and anti-slop reviews; every P0/P1/Important finding gets a failing regression test before a fix.
- [ ] Step 8: Review the final diff for accidental layout/gameplay/Socket.IO/economy changes, stale docs, secrets, and unapproved deletion.
- [ ] Step 9: Produce a release decision with separate statuses for controlled beta, public account release, and unresolved owner gates.
- [ ] Step 10: Do not commit, push, merge, or deploy until the owner explicitly authorizes that integration step.

## Owner-input gates that remain after this plan

These are the only non-code facts that cannot be safely invented by an implementation agent:

1. Mail endpoint, API key, sender address, and verified sending domain.
2. Operator identity and last-updated owner for the Privacy page.
3. Canonical HTTPS production hostname and metadata/indexing policy.
4. Production cookie secret, backup directory, monitoring destination, and retention-job deployment owner.
5. Confirmation that the GitHub Issues URL is the public support channel.

The plan deliberately does not add Terms of Service, age policy, or unapproved
legal language. If the product adds those documents in a future approved scope,
they require a new owner-approved policy decision and a separate plan.

## Self-review checklist

- [x] Every confirmed grill decision maps to a concrete server, client, test, or documentation task.
- [x] Profile-only placement is explicit; no new global navigation is introduced.
- [x] 30-day deactivation and daily finalizer are distinct states.
- [x] Export, recovery, deletion, session, guest, analytics, and backup boundaries are explicit.
- [x] Cookie/session migration preserves existing Socket.IO event names.
- [x] Existing UI system, layout, gameplay, and economy are protected by global constraints and browser QA.
- [x] No ToS route is created.
- [x] Ambiguous legal/operator facts are release gates, not invented implementation details.
- [x] No destructive file deletion is included.
- [x] CodeScene is recorded as unavailable until an authenticated token is supplied.

## Inline execution checkpoint — 2026-09-17

Implemented in the current working tree:

- server-side session records, cookie parsing/serialization, legacy exchange,
  expiry and revocation (`server/sessionStore.js`);
- owner-safe export, provider-neutral mail adapter, recovery tokens, deletion
  coordinator, retention runner, and linked-store purge/anonymization seams;
- account deactivation metadata, password verification/update, session revocation,
  leaderboard/search/social visibility guards, and Socket.IO account-rights events;
- Profile-only Data Rights markup, lifecycle state reconciliation, export/download
  feedback, and the factual `/privacy` document;
- analytics retention is 365 days by default and verified backup age-pruning is
  exposed through an adapter.

Focused red/green tests are listed in
see `docs/production-hardening.md`. The remaining unchecked
items are deployment/configuration gates or browser fixture work that cannot be
truthfully completed without the production mail/origin/operator facts. No
merge, push, or deploy was performed.

Plan complete and saved to `docs/superpowers/plans/2026-09-17-account-release-readiness-implementation.md`. Execution should use `superpowers:executing-plans` for inline work or `superpowers:subagent-driven-development` for isolated task workers, with Luna models only as required by the repository instructions.
