# Poorup Full Release Hardening and Minimal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement every confirmed bug and release-readiness fix that can be completed from the current product contract, add compact legal/account entry points and standalone legal/analytics pages, and gate only policy, identity, licensing, URL, pricing, and infrastructure choices behind explicit owner decisions.

**Architecture:** Keep the existing server-authoritative modular monolith, Socket.IO contracts, JSON single-process mode, theme registry, board renderer, and Poorup shell. Add narrow server projection, validation, persistence, metadata, and lifecycle seams; add only inline footer/account controls and standalone route surfaces. No game-engine rewrite, layout reflow, second public navigation system, or client-authoritative economy is allowed.

**Tech Stack:** Node.js ES modules, Express 4, Socket.IO 4, vanilla HTML/CSS/JavaScript, existing JSON stores, Playwright, ESLint, c8, local SVG/pixel-art assets, and CodeScene. All delegated agents use gpt-5.6-luna at xhigh reasoning; no Sol, Terra, or Astra agents.

**Spec:** docs/audit/markdown-bug-feature-audit-2026-09-13.md, docs/superpowers/plans/2026-09-13-docs-bug-fix-implementation.md, docs/superpowers/plans/2026-09-13-balancing-analytics-console-implementation.md, .ulpi/design/DESIGN.md, PRODUCT.md, and docs/production-hardening.md.

## Global Constraints

- Preserve existing game/home/lobby/board layouts, positions, spacing, dimensions, tile order, navigation, typography, rails, modals, and responsive behavior.
- Add only compact inline controls where a current slot exists: footer legal links, account deletion/export/revoke controls, and admin links that do not appear in public navigation.
- Standalone legal and analytics pages may use their own content flow but must reuse Poorup colors, borders, typography, focus, motion, and error patterns.
- The existing footer ticker stays the same height and rhythm. Its current NO ACCOUNT REQUIRED segment is replaced by compact LEGAL, PRIVACY, TERMS, and SUPPORT links; account-free copy remains in the Home entry/status copy.
- Keep legal pages same-origin by default so the app controls accessibility, previews, and availability. An external legal host is supported only through an approved configured URL.
- Do not invent operator identity, legal language, support addresses, canonical hostnames, licenses, market pricing, retention periods, or production secrets.
- Keep historical audits and design evidence; no Markdown or asset deletion occurs without explicit owner approval.
- Use TDD: every behavior change begins with a failing regression test, followed by the smallest implementation and a focused verification.
- Never expose raw player names, usernames, account IDs, room codes, session tokens, chat, hidden cards, private loan terms, opponent secrets, or password data in analytics or legal routes.
- All new interactive controls meet WCAG 2.2 AA, visible focus, keyboard operation, screen-reader labeling, 44px preferred targets, reduced motion, forced colors, and 200% zoom.
- Confirm every UI slice at native 1920×1080 before declaring it complete; capture iPad landscape and 390px evidence as required.
- Keep production horizontal scale disabled until a real transactional adapter and health check exist.

## Current interpretation

You want:

1. The true bugs from the Markdown audit fixed.
2. The current UI visually preserved with minimal additions.
3. The existing footer’s NO ACCOUNT REQUIRED segment replaced by compact legal links.
4. Legal, privacy, terms, acceptable-use, support, licensing, and fictional-currency information available on a separate legal hub/page.
5. A compact account area with deletion, export, and session-revocation entry points, implemented only after retention and deletion policy is approved.
6. A protected internal balancing analytics page using aggregate metrics and pseudonymous IDs.
7. Home/link previews that look like Poorup, use a 1200×630 approved card, and never contain private room state.
8. Parallel Luna-agent execution with isolated file ownership, followed by a Luna integration/review loop.

“Another site” is interpreted as a separate legal surface. The default is same-origin /legal and anchored sections /legal#privacy, /legal#terms, and /legal#support; an external URL is a configuration gate, not a guessed destination.

The literal NO ACCOUNT status in the Home entry signal is not footer copy and remains unchanged. Only the footer-like ticker segment at public/index.html:201–206 changes to legal/support links. This prevents an invalid nested link inside the existing account-entry button and preserves guest-play behavior.

The bug-plan review also requires characterization tests for broadcast/disconnect failures, auction deadline races, duplicate bot decisions, post-game mutations, split achievement/season writes, bot-trace size, match/season idempotency, notification-map growth, duplicate handles, unsecured loan defaults, jail-free deck reset, loan-backed market collateral, ruleset metadata resets, auction-bid repayment races, casino spin limits, disconnected-player targeting, season mastery growth, fair-trade participant data, and any confirmed short borrow-fee mismatch. An agent may only change one of these after its named failing test reproduces the current behavior.

## Minimal UI change contract

| Surface | Allowed change | Explicitly forbidden |
|---|---|---|
| Home footer ticker | Replace one text segment with compact links; keep height, order, separators, and alignment | New footer bar, new navigation row, layout shift |
| Profile account panel | Add secondary DELETE ACCOUNT, EXPORT DATA, and REVOKE SESSIONS controls inside the existing action area or modal | Moving stats, changing tab order, replacing the profile shell |
| Legal pages | New standalone same-origin content page using existing shell tokens | Legal text inside the game board, modal stacking, new public nav tab |
| Analytics | Existing /admin/analytics view gains internal tabs and filters | Public analytics link, game HUD changes, raw-event browser |
| Link preview | Static 1200×630 card and metadata tags | Private room codes, fake metrics, new Home hero, social-proof claims |
| Game/lobby UI | Only truthful status/error/help controls from the bug plan | Board resize, rail redesign, theme redesign, new game rules |

## Agent execution topology

Use four concurrent implementation agents, then one integration/review agent. No two active agents may edit the same file.

### Agent A — server/game correctness

- Model: gpt-5.6-luna, reasoning: xhigh.
- Owns: server/rooms.js, server/socketRuntime.js, server/gameLogic.js, server/contractLogic.js, server/bankruptcyApi.js, server/marketExpansion.js, server/seasonModule.js, server/backupStore.js, server/persistenceMode.js, and their tests.
- Uses: systematic-debugging, tdd, software-architecture-design, code-architecture-review, security-best-practices, qa-agent-testing, agentic-eval.
- It also owns the additional game-authority characterization cases listed above, but does not edit server/server.js, accountStore.js, socialStore.js, or telemetry persistence while other lanes are active.

### Agent B — account/privacy backend

- Model: gpt-5.6-luna, reasoning: xhigh.
- Starts after Agent A’s server boundary changes are reviewed.
- Owns: server/accountStore.js, server/serverSocketAccount.js, server/socialStore.js, account/session tests, and decision-gated deletion/export implementation.
- Uses: security-best-practices, systematic-debugging, tdd, software-architecture-design, accessibility for account flows, and agentic-eval.

### Agent C — minimal client, footer, legal shell, metadata

- Model: gpt-5.6-luna, reasoning: xhigh.
- Owns: public/index.html, public/styles.css, public/clientAccountIdentity.js, public/clientSocketListeners.js, public/clientSanitize.js, public/clientDocumentMeta.js, legal route shell, and browser tests for those surfaces.
- Uses: frontend-design-ui-ux, frontend-design, frontend-design-review, design-taste-frontend, impeccable, game-ui-ux, mobile-responsiveness, accessibility, web-design-guidelines, svg-design, pixel-art-sprites, animate, emilkowal-animations, improve-animations, review-animations.

### Agent D — balancing analytics

- Model: gpt-5.6-luna, reasoning: xhigh.
- Owns: server/analyticsPrivacy.js, server/analyticsRollupStore.js, server/analyticsProjection.js, server/analyticsApi.js, server/telemetryModule.js only where the analytics event contract requires it, public/clientAnalytics.js, public/clientAnalyticsCharts.js, and analytics tests.
- Uses: kpi-dashboard-design, software-architecture-design, security-best-practices, frontend-design-review, accessibility, web-design-guidelines, qa-agent-testing, and agentic-eval.

### Integration/review agent

- Model: gpt-5.6-luna, reasoning: xhigh.
- Runs after all agents stop editing.
- Owns no feature files by default; it reviews the real diff, resolves integration conflicts through a new failing test, runs CodeScene, runs the strict architecture/anti-slop review, and produces merge evidence.

## No-user-input implementation tranche

## Required red-test fixtures

The delegated agents must use concrete failing assertions before implementation. These fixtures define the behavior that the plan is protecting:

### Live-seat restore

~~~js
const first = manager.restoreConnection(clientId, originalSocketId, null);
assert.ok(first);
const second = manager.restoreConnection(clientId, replacementSocketId, null);
assert.equal(second, null);
assert.equal(manager.getRoomBySocket(originalSocketId), first);
assert.equal(manager.getRoomBySocket(replacementSocketId), null);
~~~

### Human-only host election

~~~js
room.hostId = human.id;
disconnect(human);
runtime.reassignHostIfNeeded(room, human.id);
assert.notEqual(room.hostId, bot.id);
assert.equal(room.game.players.find(player => player.id === room.hostId)?.isBot, false);
~~~

### Legal route is real HTML

~~~js
const response = await fetch(base + "/privacy");
assert.equal(response.status, 200);
assert.match(await response.text(), /<h1[^>]*>Privacy/i);
assert.doesNotMatch(await response.text(), /view-home|socket\\.io/i);
~~~

### No-origin metadata fails closed

~~~js
const html = renderMetadata({ origin: "", path: "/" });
assert.match(html, /noindex,nofollow/);
assert.doesNotMatch(html, /rel="canonical"|og:url|https?:\\/\\//);
~~~

### Account deletion is mutation-free on wrong confirmation

~~~js
const before = JSON.stringify(store.snapshot());
const result = accountDeletion.delete({ sessionToken, currentPassword: "wrong", typedUsername: "other" });
assert.equal(result.success, false);
assert.equal(JSON.stringify(store.snapshot()), before);
~~~

### Analytics redaction and suppression

~~~js
const response = buildAnalyticsDrilldown({ rows: [{ accountId: "acct-1", displayName: "secret", games: 2 }] });
assert.equal(response.breakdowns[0].suppressed, true);
assert.equal(JSON.stringify(response).includes("secret"), false);
assert.equal(JSON.stringify(response).includes("acct-1"), false);
~~~

### Footer geometry remains stable

~~~js
const before = rect("#home-signal-line");
replaceFooterTicker();
const after = rect("#home-signal-line");
assert.deepEqual(after, before);
assert.equal(document.querySelectorAll(".ticker-legal a").length, 3);
~~~

### Link preview image contract

~~~js
const metadata = metadataConfig({ POORUP_PUBLIC_ORIGIN: "https://play.example" });
assert.equal(metadata.previewWidth, 1200);
assert.equal(metadata.previewHeight, 630);
assert.equal(metadata.previewPath, "/assets/social/poorup-og-1200x630.png");
~~~

### Task 1: Establish the release manifest and branch-safe worktree

**Files:**

- Create: docs/feature-status.json
- Create: server/docsFeatureStatus.test.js
- Modify: package.json only to include the new test in existing release scripts

**Interfaces:**

- The manifest contains sourceCommit, generatedAt, and features[].
- Each feature has id, status, evidence[], and ownerSurface.
- The test confirms every evidence path exists and no feature ID is duplicated.

- [ ] Step 1: Write the failing manifest test with a 151b480 source commit assertion and evidence-path existence assertions.
- [ ] Step 2: Run node server/docsFeatureStatus.test.js and observe the missing-manifest failure.
- [ ] Step 3: Add records for current rooms, boards, themes, bots, contracts, sponsorships, market, seasons, cosmetics, analytics, maintenance, backups, legal surfaces, and planned systems.
- [ ] Step 4: Run the test and the existing audit suite.
- [ ] Step 5: Commit with docs: add release feature status manifest.

### Task 2: Fix room identity, host, invite, rematch, and account-seat bugs

**Files:**

- Modify: server/rooms.js
- Modify: server/socketRuntime.js
- Modify: server/gameLogic.js
- Modify: server/socialStore.js
- Modify: server/serverSocketAccount.js
- Modify: public/clientStateSync.js
- Modify: public/clientParlorBindings.js
- Test: server/rooms.test.js
- Test: server/room-host-lifecycle.test.js
- Test: server/serverSocketGame.test.js
- Test: server/serverSocketAccount.test.js
- Test: public/clientState.test.js

**Interfaces:**

- restoreConnection(clientId, socketId, accountId, onAccountSeatReclaimed) rejects a live seat and never replaces a connected socket.
- reassignHostIfNeeded(room, departedPlayerId) selects a connected human or explicitly emits a hostless recovery state; bots are never hosts.
- acceptRoomInvite commits the target seat and invite response before detaching the source room and binds the invite to immutable room identity.
- A new roundId clears client gameOver/lastWinner and prunes expired seats before rematch.
- canJoin counts every retained capacity-consuming seat, including bots.

- [ ] Step 1: Add duplicate-tab, guest restore, bot-host, invite-failure, room-code-reuse, rematch, ghost-seat, and retained-bot capacity tests.
- [ ] Step 2: Run the focused tests and observe the current failures.
- [ ] Step 3: Implement the guards, transactional invite transfer, host election, rematch cleanup, and account-seat binding.
- [ ] Step 4: Run server lifecycle/reconnect suites and the client state suite.
- [ ] Step 5: Commit with fix: protect room seats and rematch lifecycle.

### Task 3: Fix economy, debt, market, and reward invariants

**Files:**

- Modify: server/contractLogic.js
- Modify: server/bankruptcyApi.js
- Modify: server/gameLogic.js
- Modify: server/marketExpansion.js
- Modify: server/seasonModule.js
- Modify: server/socketRuntime.js
- Test: server/hybrid-contract-achievements.test.js
- Test: server/contracts-market.test.js
- Test: server/casino-bankruptcy.test.js
- Test: server/marketExpansion.test.js
- Test: server/season-reward-audit.test.js
- Test: server/season-metrics-audit.test.js

**Interfaces:**

- Hybrid conversion counts existing, pending, and requested shares before accepting and preserves lender principal through a collateral/default record.
- concludeBankruptRound(game, playerId, reason) clears inDebt and ends debt-mode rounds deterministically.
- AFK expiry preserves or settles active payment obligations instead of forgiving them.
- settleShortDefault(game, playerId) records and collects shortfall without negative cash.
- rewardEligible compares placementRank/topFraction in the same direction as the reward name.
- Before a pricing policy exists, option actions reject client-priced terms and same-round exercise with OPTION_TERMS_SERVER_REQUIRED and no state mutation.

- [ ] Step 1: Add golden tests for pending hybrid shares, failed conversion, two-player debt mode, AFK payment, short default, option tampering, same-round exercise, and reward boundaries for 1/2/3/100 players.
- [ ] Step 2: Run focused tests and observe the failures.
- [ ] Step 3: Implement invariant guards and shared settlement seams.
- [ ] Step 4: Run game-results, audit-game-contracts, market-settlement, and bot regression tests.
- [ ] Step 5: Commit with fix: enforce economy and season invariants.

### Task 4: Make persistence, telemetry, and backups bounded and recoverable

**Files:**

- Create: server/writeQueue.js if no shared queue exists
- Modify: server/telemetryModule.js
- Modify: server/accountStore.js
- Modify: server/socialStore.js
- Modify: server/backupStore.js
- Modify: server/storeIO.js
- Modify: server/socketRuntime.js
- Modify: server/server.js readiness projection
- Test: server/writeQueue.test.js
- Test: server/telemetryModule.test.js
- Test: server/backupStore.test.js
- Create: server/backup-restore-integrity.test.js
- Test: server/match-history-schema.test.js

**Interfaces:**

- createWriteQueue({ flush, maxPending, flushIntervalMs }) returns enqueue, flushNow, pendingCount, and close.
- Failed flushes retain records and expose remaining count.
- verifyBackup(filePath) compares JSON bytes against the .sha256 sidecar and returns valid, reason, and digest.
- Backup writes use temporary file, fsync, atomic rename, then sidecar rename.
- Participant match history contains owner-safe projections; botDecisions remain server-only telemetry.
- readyz reports storeLoaded, backupFresh, and maintenance without secrets.

- [ ] Step 1: Add queue ordering/retry/close tests, a 400-event single-flush test, tampered JSON/sidecar tests, and owner-projection tests.
- [ ] Step 2: Run tests and observe synchronous rewrites and ignored sidecars.
- [ ] Step 3: Implement batching, dirty-state retry, atomic backup verification, candidate validation, and readiness fields.
- [ ] Step 4: Run persistence, settlement, backup, and release-hardening suites.
- [ ] Step 5: Commit with perf: batch and verify release persistence.

### Task 5: Close validation, origin, rate-limit, CSP, and timer gaps

**Files:**

- Modify: server/serverConfig.js
- Modify: server/server.js
- Modify: server/serverSocketAccount.js
- Modify: server/socketRateLimiter.js
- Modify: server/socketSocialApi.js
- Modify: server/httpRateLimiter.js
- Modify: server/roomSettings.js
- Modify: server/rulesetRegistry.js
- Modify: server/cosmeticCatalog.js
- Modify: server/socialStore.js
- Create: server/socket-admission.test.js
- Create: server/inputBounds.test.js
- Create: server/runtimeTimerSafety.test.js

**Interfaces:**

- isAllowedSocketOrigin(origin, allowedOrigins) is used by Socket.IO allowRequest for polling and WebSocket.
- resolveClientAddress(handshake, trustedProxyHops) ignores untrusted forwarding headers.
- Production startup rejects zero HTTP/socket limits unless development mode is explicit.
- boundedInteger(value, { min, max, fallback }) is shared at every numeric boundary.
- Timer callbacks use runRoomTimer(label, roomCode, callback); runtime.destroyRoom clears all maps.
- CSP connect-src contains self and configured same-origin endpoint only.

- [ ] Step 1: Add hostile-origin, proxy, reconnect bucket, zero-limit, extreme numeric, arbitrary ID, timer throw, and teardown tests.
- [ ] Step 2: Run tests and observe current acceptance/failure behavior.
- [ ] Step 3: Implement shared validators, admission, bounded collections, CSP, and teardown.
- [ ] Step 4: Run server lint and focused security/release suites.
- [ ] Step 5: Commit with fix: bound inputs and isolate runtime admission.

### Task 6: Fix client state, focus, forms, audio, and responsive contracts

**Files:**

- Modify: public/clientSurfaces.js
- Modify: public/clientStateSync.js
- Modify: public/clientRailRender.js
- Modify: public/clientDeedDetailUi.js
- Modify: public/clientHomeEntryBindings.js
- Modify: public/clientSocketListeners.js
- Modify: public/clientSanitize.js
- Modify: public/clientProfileRender.js
- Modify: public/main.js
- Modify: public/index.html
- Modify: public/styles.css
- Create: public/clientInteractionRegression.test.js
- Create: public/clientDocumentMeta.js
- Create: public/clientDocumentMeta.test.js

**Interfaces:**

- Modal openers pass their exact trigger to openSurface; close restores that connected trigger.
- Async action buttons expose aria-busy, disable duplicate submission, and show PROCESSING/timeout/stale copy.
- clearLocalPlayerData removes only Poorup-owned keys; storage events reconcile explicit sign-out.
- setDocumentMeta({ view, status, roomCode }) owns per-view titles and live announcements.
- Input names/autocomplete/inputmode are explicit; room-code autocomplete remains off.
- Audio reports locked/ready/blocked state and retries after a user gesture.

- [ ] Step 1: Add tests for modal focus, overscroll containment, reduced-motion auction timing, room-code paste, profile createdAt, cross-tab sign-out, audio rejection, and form semantics.
- [ ] Step 2: Run client tests and record failures.
- [ ] Step 3: Implement focused updates, pending/error states, metadata helper, local-data ownership, semantic attributes, and audio state.
- [ ] Step 4: Run client lint, responsive/a11y tests, and the browser matrix.
- [ ] Step 5: Commit with fix: preserve client focus and truthful recovery.

### Task 7: Add the minimal legal footer and standalone legal documents

**Files:**

- Modify: public/index.html
- Modify: public/styles.css
- Create: public/legal/privacy.html
- Create: public/legal/terms.html
- Create: public/legal/support.html
- Create: public/legal/licenses.html
- Modify: server/server.js route allow-list
- Create: server/legal-route.test.js
- Create: qa/legal-links.spec.js

**Interfaces:**

- The Home ticker segment becomes:

~~~html
<span class="t-micro tk legal-links" aria-label="Legal information">
  <a href="/legal#privacy">PRIVACY</a>
  <span aria-hidden="true">·</span>
  <a href="/legal#terms">TERMS</a>
  <span aria-hidden="true">·</span>
  <a href="/legal#support">SUPPORT</a>
</span>
~~~

- /legal is an index linking to /privacy, /terms, /support, and /licenses. Each canonical route resolves to a static document without JavaScript; aliases /acceptable-use and /legal/* are allow-listed redirects or direct documents.
- Every legal document has a readable heading, last-updated field, in-page section navigation, skip link, same Poorup ticker, and a Return to parlor link.
- The route shell is complete without claiming legal approval; copy is inserted only after Gate 13.

- [ ] Step 1: Add route and footer-link tests for status, heading, keyboard focus, no page overflow, and no missing asset fallback.
- [ ] Step 2: Run tests and observe missing route/link failures.
- [ ] Step 3: Add the compact ticker links and route shell without changing game/home geometry.
- [ ] Step 4: Run legal route and Playwright tests with JavaScript disabled at 1920×1080, iPad landscape, and 390px.
- [ ] Step 5: Commit with feat: add compact legal entry points.

### Task 8: Add metadata, canonical plumbing, and the link-preview pipeline

**Files:**

- Modify: public/index.html
- Modify: public/clientDocumentMeta.js
- Create: public/manifest.webmanifest
- Create: public/assets/social/poorup-og-1200x630.png after Gate 14
- Modify: server/server.js
- Create: server/metadata-route.test.js
- Create: qa/metadata.spec.js

**Interfaces:**

- metadataConfig(env) returns origin, indexPolicy, previewPath, description, and image dimensions.
- Missing origin emits no fabricated canonical URL and defaults app/game/admin routes to noindex.
- The Home preview card is exactly 1200×630 and uses the existing Poorup wordmark, dark teal parlor frame, gold rules, and one truthful line of copy.
- OG/Twitter tags include absolute image URL, width, height, type, title, description, and canonical URL only when configured.
- Sitemap contains only approved public routes; no room code, account, match, or admin URL is included.

- [ ] Step 1: Add metadata tests for missing origin, configured origin, noindex private routes, canonical Home, 1200×630 dimensions, and sitemap exclusion.
- [ ] Step 2: Run tests and observe missing metadata contracts.
- [ ] Step 3: Add safe metadata plumbing, manifest, touch icon, per-view titles, and route policy.
- [ ] Step 4: After Gate 14, create the approved preview artwork from local SVG/pixel-art assets and verify it with native dimensions.
- [ ] Step 5: Commit plumbing and approved artwork as separate commits.

### Task 9: Implement the protected aggregate analytics console

**Files:**

- Follow the full independent plan in docs/superpowers/plans/2026-09-13-balancing-analytics-console-implementation.md.
- Preserve server/analyticsApi.js summary compatibility and public/index.html admin view location.

**Interfaces:**

- Every drilldown uses P-XXXXXXXXXXXX-style HMAC pseudonyms or suppression.
- k=5 is fixed; no lower threshold query is accepted.
- Tabs are Overview, Match Health, Rulesets + Boards, Economy, Events + Rarity, Bots, and Data Quality.
- The first viewport shows at most six KPI cards.
- No player name, username, raw account ID, room code, chat, hidden card, private term, or raw event payload reaches the client.

- [ ] Step 1: Run the analytics plan’s privacy and rollup tests before UI work.
- [ ] Step 2: Implement versioned projections and protected routes.
- [ ] Step 3: Implement the Poorup-native tab/filter/chart/table UI.
- [ ] Step 4: Run analytics unit, evaluator, browser, accessibility, reduced-motion, forced-colors, and 1920px tests.
- [ ] Step 5: Commit with feat: add protected balancing analytics console.

### Task 10: Reconcile current documentation and audit statuses

**Files:**

- Modify: README.md
- Modify: SHOWCASE.md
- Modify: Instructions.md
- Modify: .ulpi/design/ACCOUNT-PROFILE.md
- Modify: .ulpi/design/HOME-PROFILE-REDESIGN.md
- Modify: .ulpi/design/THEME-FIVE-VISUAL-BRAINSTORM.md
- Modify: .ulpi/design/NIGHT-SHIFT-MICROGAME-PLAN.md
- Modify: docs/REFACTOR-ROADMAP.md
- Modify: docs/plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md
- Modify: docs/superpowers/plans/2026-09-13-branch-release-maintenance-analytics.md
- Modify: docs/production-hardening.md
- Modify: docs/feature-status.json
- Create: server/docs-parity.test.js

**Interfaces:**

- Active docs use current feature names and evidence paths.
- Historical audits stay immutable and link to the current audit/status manifest.
- Copy says no account required, not no accounts.
- Rulesets, Metro-52, bots, events, contracts, seasons, and market features match current code.
- Planned Wallet/Items, airport, prediction, and bank-account systems remain labeled planned.

- [ ] Step 1: Add stale-phrase tests for version, capacity, account, profileViewState, session-expiry, debris, and branch claims.
- [ ] Step 2: Run the test and record stale-document failures.
- [ ] Step 3: Update current docs and add superseded pointers where needed.
- [ ] Step 4: Run npm run test:audit and inspect the Markdown diff.
- [ ] Step 5: Commit with docs: align release documentation with source.

### Task 11: Complete browser, visual, and merge evidence

**Files:**

- Modify: qa/playwright.config.js
- Modify: relevant qa/*.spec.js files
- Create: qa/release-readiness-2026-09-13.spec.js
- Create: qa-artifacts/release-2026-09-13/README.md
- Create: docs/audit/premerge-review-2026-09-13.md

**Interfaces:**

- Required viewports: 1920×1080, 1366×768, 1024×768, iPad landscape, 390×844, 200% zoom.
- Required states: loading, empty, stale, timeout, offline, duplicate, session expiry, unauthorized legal/analytics, reduced motion, forced colors.
- Visual evidence covers Home/footer, legal hub, account controls/modal, analytics Overview/tabs, social/Rules/lobby/game representative screens.

- [ ] Step 1: Add route, footer, deletion-entry, analytics, metadata, accessibility, and no-overflow tests.
- [ ] Step 2: Run npx playwright test -c qa/playwright.config.js and all client/server suites.
- [ ] Step 3: Capture native 1920×1080 screenshots and inspect each at 1x.
- [ ] Step 4: Run npm run lint, npm run lint:client, npm run test:full, npm run coverage, and the bounded load harness.
- [ ] Step 5: Run CodeScene preparation/review with the locally configured token; never write the token to disk.
- [ ] Step 6: Run frontend-design-review, web-design-guidelines, accessibility, game-ui-ux, mobile-responsiveness, impeccable, design-taste-frontend, animate, improve-animations, review-animations, code-architecture-review, security-best-practices, grill-me, improve-codebase-architecture, thermo-nuclear-code-quality-review, and install-anti-slop on the final diff.
- [ ] Step 7: Resolve every P0/P1/Important finding with a new regression test and repeat the scoped review.
- [ ] Step 8: Commit with test: record release readiness evidence.

## User-input and credential gates

### Gate 12: Account deletion, export, retention, and active-game policy

Choose:

- self-service deletion/export, manual support process, or registration pause;
- retention duration for accounts, matches, social data, telemetry, rollups, and backups;
- treatment of guest history;
- behavior when deletion is requested during a live room;
- whether export includes owned match summaries only or additional history;
- session revocation and password reauthentication requirements.

The UI can show compact controls before this gate, but the server must not claim deletion until the policy record exists.

When self-service deletion is selected, the exact flow is:

1. Signed-in account panel reveals DATA RIGHTS inside the existing account action area.
2. EXPORT MY DATA downloads a server-produced owner-safe JSON document without password hashes, salts, bearer tokens, session hashes, opponent private terms, or raw chat.
3. REVOKE OTHER SESSIONS uses an authenticated idempotent event and reports which sessions remain active.
4. DELETE ACCOUNT opens the existing managed confirmation surface with current password, typed username, irreversible warning, aria-invalid/aria-describedby errors, Escape/scrim cancellation, and focus restoration.
5. account-delete carries requestId, sessionToken, currentPassword, typedUsername, and accountId derived server-side; the server ignores a client-supplied accountId.
6. The deletion coordinator revokes every session, handles active-room membership according to this gate’s decision, purges or anonymizes every selected store projection, and clears Poorup-owned browser keys only after the server acknowledges success.
7. Any failed cascade returns an explicit error and leaves account/session/local data unchanged. No partial success is reported.

### Gate 13: Legal copy and operator identity

Supply approved Privacy Notice, Terms of Service, acceptable-use rules, support/contact URL, minimum-age statement, fictional-currency/no-real-money wording, inspiration disclaimer, AI-provider disclosure, and last-updated owner.

After approval, populate the legal hub, footer link labels, support route, account deletion explanation, and analytics privacy notice. No agent may invent legal language.

The Privacy Notice must match actual behavior after the privacy fixes: guest/local storage, optional accounts, session lifetime, social and match projections, telemetry, admin analytics, configured AI provider behavior, retention, deletion/export, and legal-retention exceptions. The Terms/AUP must cover age, fictional currency, no real-money gambling, chat/moderation, suspension, and the third-party inspiration disclaimer. Support must name the operator/channel, response expectation, bug-report data, and erasure request path.

### Gate 14: Canonical public host and preview artwork

Supply:

- canonical HTTPS hostname;
- index/noindex policy for Home, Rules, Rankings, public directory, legal pages, and admin;
- sitemap route list;
- approved 1200×630 preview artwork or permission to render it from the existing Home scene;
- exact title, description, and social-card copy;
- favicon/touch-icon approval.

Without this gate, metadata uses safe noindex behavior and never emits a fake URL.

### Gate 15: Authentication architecture

Choose bearer TTL/absolute expiry, localStorage mitigation versus HttpOnly cookies, password reset/change provider, cross-tab sign-out, and proxy trust configuration. The no-input tranche still fixes transient restore handling and live-seat integrity.

### Gate 16: Market and infrastructure

Supply derivative pricing/equity/debt policy, PostgreSQL/Redis adapter and credentials, allowed origins, trusted proxy hops, TLS/HSTS ownership, edge rate limits, Nest secrets, monitoring destination, and maintenance window before enabling those production paths.

### Gate 17: Licensing and release identity

Confirm exact font/audio/art licenses, root LICENSE text, attribution requirements, version/tag/changelog policy, support URL, and approval to quarantine or remove unreferenced assets.

## Rollout order

1. Create the release manifest and branch-safe agent worktrees.
2. Merge server seat/lifecycle and invariant fixes.
3. Merge persistence, backup, rate-limit, validation, CSP, and timer fixes.
4. Merge client focus/recovery/audio/forms fixes.
5. Add compact footer legal links and legal route shell.
6. Add metadata plumbing and safe noindex defaults.
7. Implement analytics projections, privacy, API, and UI.
8. Apply approved policy gates for legal copy, deletion/export, canonical previews, licenses, pricing, and infrastructure.
9. Reconcile docs and run full browser/visual/CodeScene review.
10. Prepare a merge PR; do not push or merge without separate authorization.

## Acceptance criteria

- Existing game/home/lobby/board geometry is unchanged except for explicitly approved compact links/buttons.
- Footer legal links are keyboard reachable, same-height, accessible, and do not create page overflow.
- Legal pages are discoverable, standalone, readable, and do not claim unapproved policy.
- Account deletion/export/revoke controls are visible only in the existing account surface and are idempotent, authenticated, and policy-compliant.
- Confirmed room, session, economy, persistence, security, privacy, validation, and UX bugs have regression tests and passing fixes.
- Analytics is admin-only, aggregate-first, k=5 suppressed, pseudonymous in every drilldown, and isolated from game state.
- Home metadata and the approved 1200×630 preview never expose private room or player data.
- Standard-40, Metro-52, all six themes, reduced motion, forced colors, iPad landscape, mobile, and 1920×1080 evidence pass.
- No active documentation contradicts source; historical evidence is retained.
- All required tests, lint, coverage, browser QA, CodeScene, architecture, security, accessibility, motion, and anti-slop reviews pass.
