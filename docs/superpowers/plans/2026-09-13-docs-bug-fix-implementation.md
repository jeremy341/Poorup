# Markdown Audit Bug-Fix and Release-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile all 118 tracked Markdown/README files with the current Poorup implementation, remove confirmed correctness and release risks without inventing product policy, and provide a gated path for the remaining legal, identity, pricing, licensing, URL, and infrastructure decisions.

**Architecture:** Keep the existing server-authoritative modular monolith. Preserve the current Room, GameState, account, social, market, season, telemetry, backup, maintenance, theme, and client-surface seams. Add narrow validation, projection, queue, lifecycle, and metadata helpers at existing boundaries; do not create a second game engine, a client-authoritative economy, or a parallel page/component system.

**Tech Stack:** Node.js ES modules, Express 4, Socket.IO 4, vanilla HTML/CSS/JavaScript, JSON persistence during single-process operation, Playwright, ESLint, c8, and the existing CodeScene/CI commands. No new runtime dependency is planned.

**Spec:** docs/audit/markdown-bug-feature-audit-2026-09-13.md, .ulpi/design/DESIGN.md, PRODUCT.md, docs/DEVELOPMENT_WORKFLOW.md, and docs/production-hardening.md.

## Global Constraints

- Keep the current Poorup visual system: dark teal surfaces, gold borders, red action semantics, pixel-art SVG language, square geometry, compact spacing, and existing fonts.
- Preserve Standard-40 tile order, Metro-52 contracts, Socket.IO event names, server authority, reconnect behavior, and ruleset semantics unless a task below explicitly closes a confirmed invariant violation.
- Keep the modular monolith; no service split, Redux migration, client-side authority, or duplicate Classic/After Hours engine.
- Use test-driven development: write the named failing test, run it to observe the failure, implement the smallest change, run the focused test, then run the relevant regression set.
- Do not delete or overwrite any existing Markdown, asset, account, match, social, or backup data in this plan.
- Keep historical audit evidence immutable; corrections go into a current status manifest or a superseded header with a source commit.
- Never put bearer tokens, CodeScene tokens, production URLs, operator identity, or user data into source control or audit documents.
- Keep telemetry bounded and sanitized; never record private chat, hidden cards, private loan terms, opponent secrets, session tokens, passwords, or raw account credentials.
- Every client slice must pass keyboard, screen-reader, focus-restoration, reduced-motion, forced-colors, 200% zoom, touch-target, and no-page-overflow checks.
- Every visual slice must be captured and inspected at native 1920×1080 before it is called complete.
- The original Poorup design remains the default; existing theme backgrounds and gameplay are cosmetic-only.
- Production horizontal mode remains disabled until a real transactional PostgreSQL adapter and health check exist.

## Audit input and disposition

The companion audit records the complete inventory and issue classification:

- 29 Active documents;
- 25 Completed evidence documents;
- 52 Reference documents;
- 10 Outdated documents;
- 2 Delete Candidates that require owner approval;
- 20 P0/P1 correctness, security, privacy, availability, or missing-capability findings;
- 25 P2/P3 validation, UX, performance, evidence, and operational findings.

The implementation lanes below are intentionally split into work that can proceed with the current product contract and work that must wait for an owner decision, credential, license, URL, or deployment fact.

## File and ownership map

| Lane | Files created or modified | Single responsibility |
|---|---|---|
| Contract status | docs/feature-status.json, server/docsFeatureStatus.test.js | Machine-readable feature/document parity and evidence paths. |
| Persistence mode | server/persistenceMode.js, server/persistenceMode.test.js, server/server.js | Fail-closed horizontal-scale admission until a real adapter is healthy. |
| Sessions and seats | server/rooms.js, server/serverSocketAccount.js, public/clientSocketListeners.js, public/clientSanitize.js | Live-seat integrity, account-seat binding, expiry classification, and truthful client recovery. |
| Room lifecycle | server/socketRuntime.js, server/gameLogic.js, server/socialStore.js, public/clientStateSync.js, public/clientParlorBindings.js | Human host election, invite transaction, rematch cleanup, capacity, and room identity. |
| Economy invariants | server/contractLogic.js, server/bankruptcyApi.js, server/marketExpansion.js, server/seasonModule.js | Hybrid debt, bankruptcy, options safety, shorts, and reward placement. |
| Persistence and backups | server/telemetryModule.js, server/accountStore.js, server/socialStore.js, server/backupStore.js, server/storeIO.js | Bounded writes, atomic checksummed backups, and retryable dirty state. |
| Admission and validation | server/serverConfig.js, server/server.js, server/serverSocketAccount.js, server/socketRateLimiter.js, server/httpRateLimiter.js, server/roomSettings.js, server/rulesetRegistry.js, server/cosmeticCatalog.js | Origin admission, rate limits, input ranges, and bounded collections. |
| Client interaction | public/clientSurfaces.js, public/clientStateSync.js, public/clientRailRender.js, public/clientDeedDetailUi.js, public/clientHomeEntryBindings.js, public/index.html, public/styles.css | Focus, pending state, modal scroll, room-code feedback, help access, and semantic forms. |
| Audio and motion | public/main.js, public/styles.css, public/assets/audio | Gesture unlock, honest playback state, reduced-motion timer behavior, and payload budget. |
| Metadata and previews | public/index.html, public/clientDocumentMeta.js, public/manifest.webmanifest, public/assets/social/poorup-og-1200x630.png, server/server.js | View titles, metadata, app icons, canonical/link-preview plumbing, and route policy. |
| Documentation | README.md, SHOWCASE.md, Instructions.md, outdated design docs, docs/production-hardening.md | Correct current claims while preserving historical evidence. |
| Browser evidence | qa/*.spec.js, qa/playwright.config.js, qa-artifacts | Native-size visual, responsive, accessibility, stale-state, and route evidence. |

## No-user-input implementation tranche

### Task 1: Freeze the audit baseline and add feature-status parity

**Files:**

- Create: docs/feature-status.json
- Create: server/docsFeatureStatus.test.js
- Modify: docs/audit/markdown-bug-feature-audit-2026-09-13.md

**Interfaces:**

- The manifest exports no runtime code. It contains sourceCommit, generatedAt, and features[].
- Each feature record has id, status (active, completed, planned, or superseded), evidence (repository-relative paths), and ownerSurface.
- The test exports no public API; it reads the JSON and verifies every evidence path exists.

- [ ] Step 1: Write the failing manifest test with these assertions:

~~~js
assert.equal(manifest.sourceCommit, '151b480');
assert.ok(Array.isArray(manifest.features));
assert.ok(manifest.features.every(item => ['active', 'completed', 'planned', 'superseded'].includes(item.status)));
for (const item of manifest.features) for (const path of item.evidence) assert.equal(fs.existsSync(path), true);
assert.equal(new Set(manifest.features.map(item => item.id)).size, manifest.features.length);
~~~

- [ ] Step 2: Run node server/docsFeatureStatus.test.js and confirm it fails because the manifest is absent.
- [ ] Step 3: Add records for rulesets, boards, themes, rooms, bots, contracts, sponsorships, market, seasons, cosmetics, analytics, maintenance, backups, legal surfaces, and planned systems with the exact evidence paths from the audit.
- [ ] Step 4: Run the test and confirm PASS.
- [ ] Step 5: Add npm run test:audit coverage for this test and commit with docs: add machine-readable feature parity manifest.

### Task 2: Fail closed for fake horizontal persistence

**Files:**

- Modify: server/persistenceMode.js
- Modify: server/persistenceMode.test.js
- Modify: server/server.js

**Interfaces:**

- Keep persistenceMode(env = process.env) and assertPersistenceMode(env = process.env) signatures.
- persistenceMode(...).ready must be false for every horizontal request until the server creates a real transactional adapter health result.
- mode must remain json-single-process for the current runtime; postgres-ready is not returned from environment strings alone.

- [ ] Step 1: Add failing cases for POORUP_HORIZONTAL_SCALE=true with a syntactically valid URL, with the URL plus POORUP_PERSISTENCE_ADAPTER=postgres, and with a malformed URL. All must return ready: false and the error must state that no transactional adapter is installed.
- [ ] Step 2: Run node server/persistenceMode.test.js and observe the current dummy-adapter case fail.
- [ ] Step 3: Remove environment-only readiness and make assertPersistenceMode reject horizontal mode until an adapter health result is passed by a future adapter integration.
- [ ] Step 4: Run the focused test and node server/release-hardening.test.js.
- [ ] Step 5: Commit with fix: fail closed before transactional persistence migration.

### Task 3: Protect live seats and bind guest upgrades

**Files:**

- Modify: server/rooms.js
- Modify: server/serverSocketAccount.js
- Modify: public/clientSocketListeners.js
- Modify: public/clientSanitize.js
- Test: server/rooms.test.js
- Test: server/serverSocketAccount.test.js
- Create: public/clientSessionRecovery.test.js

**Interfaces:**

- RoomManager.restoreConnection(clientId, socketId, accountId, onAccountSeatReclaimed) returns a room or null and must never replace a non-disconnected seat.
- Add a private classifyRestoreFailure(result) client helper returning invalid, retryable, or missing; only invalid and missing clear the stored session.
- Account records retain a sanitized createdAt ISO string through sanitizeAccount and profile rendering.

- [ ] Step 1: Add server tests for a duplicate tab with the same client ID, a guest restore with no account ID, and an account restore while the original socket remains connected. Assert the original socket remains mapped and the newcomer receives a deterministic failure.
- [ ] Step 2: Add an account-upgrade test that registers from a lobby seat and asserts player.accountId, match-history attribution, and reconnect ownership all use the newly issued account ID.
- [ ] Step 3: Add a client recovery test that feeds RATE_LIMITED, STORAGE_UNAVAILABLE, INVALID_SESSION, and NO_ACTIVE_SESSION responses and asserts only the last two call saveAccountSession(null).
- [ ] Step 4: Run the focused tests and observe the live-seat and guest-binding failures.
- [ ] Step 5: Check the existing socket-owned room before rebinding, bind a successful account operation to the safe lobby seat, preserve the token for retryable errors, and pass createdAt through the sanitizer.
- [ ] Step 6: Run the focused tests, node server/account-session-audit.test.js, and node server/reconnect.test.js.
- [ ] Step 7: Commit with fix: preserve live seats and account attribution during restore.

### Task 4: Repair host election, invite transfer, rematch, and capacity

**Files:**

- Modify: server/socketRuntime.js
- Modify: server/gameLogic.js
- Modify: server/socialStore.js
- Modify: public/clientStateSync.js
- Modify: public/clientParlorBindings.js
- Test: server/room-host-lifecycle.test.js
- Test: server/rooms.test.js
- Test: server/serverSocketGame.test.js
- Test: public/clientState.test.js

**Interfaces:**

- reassignHostIfNeeded(room, departedPlayerId) selects a connected, non-bankrupt human only; if none exists, room.hostId is null and the room emits a recoverable hostless state.
- acceptRoomInvite(socket, account, invite, payload) validates expiry, immutable room identity, target capacity, and target seat before detaching the source room.
- Room.game.canJoin() counts every retained seat that consumes capacity, including bots, until an explicit prune removes it.
- A started snapshot with a new roundId clears client gameOver, lastWinner, and round-scoped modal state.

- [ ] Step 1: Add a host-election test with one disconnected human and one connected bot; assert the bot never becomes host.
- [ ] Step 2: Add invite tests for target join failure, room-code reuse, expired invite pruning, and a Home/Social invite acceptance that navigates into the returned room.
- [ ] Step 3: Add rematch tests for non-host game-over clearing, expired-seat pruning, and capacity with retained bots.
- [ ] Step 4: Run node server/room-host-lifecycle.test.js, node server/rooms.test.js, node server/serverSocketGame.test.js, and node public/clientState.test.js to record the failures.
- [ ] Step 5: Commit target seat and invite response before source detachment, bind invites to room.publicId, prune expired records on read, select humans for host, prune expired seats before rematch, and apply room-entry responses in the normal client navigation path.
- [ ] Step 6: Re-run the focused tests and node server/lifecycle-audit.test.js.
- [ ] Step 7: Commit with fix: make room invites and rematches transactional.

### Task 5: Close gameplay and reward invariants

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
- Test: server/season-reward-audit.test.js
- Test: server/season-metrics-audit.test.js
- Test: server/marketExpansion.test.js

**Interfaces:**

- Hybrid conversion computes existingShares + pendingShares + requestedShares before accepting; a failed conversion preserves principal and creates a deterministic collateral/default record.
- concludeBankruptRound(game, playerId, reason) is the single debt-mode conclusion seam and leaves inDebt=false after settlement.
- settleShortDefault(game, playerId) records and collects shortfall through the existing debt ledger; it never creates negative cash.
- rewardEligible(row, reward) compares an explicit placementRank or topFraction in the same direction as the reward name.
- Option terms are server-derived. Until the owner approves a pricing model, client-provided strike/premium and same-round exercise return OPTION_TERMS_SERVER_REQUIRED without mutating state.

- [ ] Step 1: Add failing tests for pending hybrid share dilution, failed hybrid conversion, two-player debt-mode conclusion, AFK payment preservation, short-default collection, and reward placement with 1, 2, 3, and 100 players.
- [ ] Step 2: Add option tests that submit favorable client terms and same-round exercise and assert a no-mutation error.
- [ ] Step 3: Run the focused test files and confirm each invariant failure.
- [ ] Step 4: Fix share caps and fallback collateral, route bankruptcy and AFK flows through the shared conclusion/obligation path, settle short defaults, correct rank mathematics, and reject unapproved option terms.
- [ ] Step 5: Run all named tests plus node server/game-results.test.js, node server/audit-game-contracts.test.js, and node server/market-settlement-audit.test.js.
- [ ] Step 6: Commit with fix: enforce debt, contract, option, and reward invariants.

### Task 6: Bound replay caches and all persisted collections

**Files:**

- Modify: server/gameLogic.js
- Modify: server/roomSettings.js
- Modify: server/rulesetRegistry.js
- Modify: server/cosmeticCatalog.js
- Modify: server/socialStore.js
- Test: server/rulesetRegistry.test.js
- Test: server/cosmeticCatalog.test.js
- Test: server/rooms.test.js
- Create: server/inputBounds.test.js

**Interfaces:**

- Add one shared internal boundedInteger(value, { min, max, fallback }) helper with deterministic rejection, not coercion to Infinity.
- Replay maps evict by MAX_REPLAY_ENTRIES and REPLAY_TTL_MS; both constants are exported for tests.
- Cosmetic claim IDs and slots are checked against the catalog; social account IDs must match the account ID grammar and have a maximum list length.
- Room settings use explicit ranges: startingCash 0–1,000,000, turnTimer 0–3,600 seconds, and existing per-setting limits for every numeric ruleset override.

- [ ] Step 1: Write bounds tests for Infinity, scientific-notation overflow, negative values, unknown cosmetic slots, oversized claim arrays, malformed social IDs, and replay-cache eviction.
- [ ] Step 2: Run the tests and observe the current acceptance of extreme values.
- [ ] Step 3: Add the shared validator and call it at every server boundary listed above.
- [ ] Step 4: Run node server/inputBounds.test.js, node server/rulesetRegistry.test.js, node server/cosmeticCatalog.test.js, and node server/rooms.test.js.
- [ ] Step 5: Commit with fix: bound persisted settings and replay state.

### Task 7: Batch persistence and preserve failed writes

**Files:**

- Create: server/writeQueue.js
- Modify: server/telemetryModule.js
- Modify: server/accountStore.js
- Modify: server/socialStore.js
- Modify: server/serverSocketAccount.js
- Modify: server/socketRuntime.js
- Create: server/writeQueue.test.js
- Test: server/telemetryModule.test.js
- Test: server/social-achievement.test.js
- Test: server/match-history-schema.test.js

**Interfaces:**

- createWriteQueue({ flush, maxPending, flushIntervalMs }) returns { enqueue(record), flushNow(), pendingCount(), close() }.
- enqueue(record) returns a monotonically increasing sequence number and never silently drops a record.
- flushNow() returns { success, flushed, remaining, error }; failed flushes keep records pending for retry.
- Settlement code enqueues achievement, season, match, social, and telemetry projections and awaits one bounded flush at the end of the settlement transaction.
- botDecisions remain server-only telemetry and are excluded from each participant’s public match-history projection.

- [ ] Step 1: Write a queue test for ordering, maximum pending rejection, retry after a thrown flush, and close flushing once.
- [ ] Step 2: Add a telemetry performance test that emits 400 records and asserts one bounded file replacement rather than 400 full rewrites.
- [ ] Step 3: Add a crash-window test that forces the achievement write to fail and asserts the dirty record remains available for retry.
- [ ] Step 4: Run the focused tests and observe the current synchronous-write behavior.
- [ ] Step 5: Route the high-volume settlement writes through the queue, retain dirty state, and project owner-safe match history.
- [ ] Step 6: Run node server/writeQueue.test.js, node server/telemetryModule.test.js, node server/social-achievement.test.js, node server/match-history-schema.test.js, and node server/audit-rooms-settle.test.js.
- [ ] Step 7: Commit with perf: batch settlement persistence without losing failed writes.

### Task 8: Verify checksummed, atomic backups and readiness

**Files:**

- Modify: server/backupStore.js
- Modify: server/storeIO.js
- Modify: server/server.js
- Create: server/backup-restore-integrity.test.js
- Test: server/backupStore.test.js
- Test: server/server.test.js

**Interfaces:**

- verifyBackup(filePath) reads the JSON and its .sha256 sidecar, computes the same digest over the exact bytes, and returns { valid, reason, digest }.
- Backup creation writes a temporary JSON file, fsyncs it, renames it atomically, then writes and atomically renames the sidecar.
- Rotation considers only candidates that pass JSON-shape and checksum validation; the newest invalid candidate is never selected.
- readyz returns storeLoaded, backupFresh, and maintenance booleans without file paths, account IDs, or secrets.

- [ ] Step 1: Add a tampered-valid-JSON test, missing-sidecar test, partial-write test, and invalid-newest-rotation test.
- [ ] Step 2: Run node server/backup-restore-integrity.test.js and node server/backupStore.test.js to observe the ignored-sidecar failure.
- [ ] Step 3: Implement byte-accurate sidecar verification, temp-plus-rename writes, candidate validation, and readiness fields.
- [ ] Step 4: Run the focused tests and node server/release-hardening.test.js.
- [ ] Step 5: Commit with fix: verify backup digests and expose truthful readiness.

### Task 9: Close socket admission, proxy, limiter, and CSP gaps

**Files:**

- Modify: server/serverConfig.js
- Modify: server/server.js
- Modify: server/serverSocketAccount.js
- Modify: server/socketRateLimiter.js
- Modify: server/socketSocialApi.js
- Modify: server/httpRateLimiter.js
- Test: server/server.test.js
- Test: server/serverSocketAccount.test.js
- Create: server/socket-admission.test.js

**Interfaces:**

- Add isAllowedSocketOrigin(origin, allowedOrigins) and use it from Socket.IO allowRequest; polling and direct WebSocket transports share the same result.
- Add resolveClientAddress(handshake, trustedProxyHops) with an explicit trusted-hop count; untrusted forwarding headers are ignored.
- Rate-limit keys include an IP/account dimension and a bounded global concurrent-connection counter, not only socket.id.
- Production startup rejects zero-valued HTTP/socket limits unless an explicit development mode is active.
- CSP connect-src contains self and an explicitly configured same-origin WebSocket endpoint only; it never contains wildcard ws: or wss:.

- [ ] Step 1: Add hostile-origin WebSocket, reconnect-bucket, proxy-address, registration-reset, and zero-limit production startup tests.
- [ ] Step 2: Run the tests and confirm the current gaps.
- [ ] Step 3: Implement origin admission, trusted address resolution, shared counters, startup assertions, and the narrow CSP.
- [ ] Step 4: Run node server/socket-admission.test.js, node server/server.test.js, node server/serverSocketAccount.test.js, and node server/httpRateLimiter.test.js.
- [ ] Step 5: Commit with fix: enforce socket admission and bounded auth traffic.

### Task 10: Make lifecycle timers exception-safe and teardown-complete

**Files:**

- Modify: server/socketRuntime.js
- Modify: server/rooms.js
- Modify: server/server.js
- Create: server/runtimeTimerSafety.test.js
- Test: server/lifecycle-audit.test.js
- Test: server/room-host-lifecycle.test.js

**Interfaces:**

- Every interval/timeout callback enters runRoomTimer(label, roomCode, callback); the wrapper records the error, isolates the room, and does not throw through the process signal handler.
- runtime.destroyRoom(room) clears auction, turn, disconnect, AFK, and room-GC timers and removes all socket mappings.
- leaveRoomByClient() delegates deletion to runtime.destroyRoom() rather than deleting the map directly.
- readyz remains false while a required store is loading or a fatal lifecycle error is unresolved.

- [ ] Step 1: Add tests that throw from an AFK tick, auction tick, GC tick, and room deletion, then assert the process remains alive and all timer maps are empty.
- [ ] Step 2: Run the tests and observe uncaught callback failures or retained maps.
- [ ] Step 3: Add the wrapper and route every teardown path through it.
- [ ] Step 4: Run the focused tests and node server/lifecycle-audit.test.js.
- [ ] Step 5: Commit with fix: isolate room timer failures and complete teardown.

### Task 11: Restore client focus, pending states, and modal containment

**Files:**

- Modify: public/clientSurfaces.js
- Modify: public/clientStateSync.js
- Modify: public/clientRailRender.js
- Modify: public/clientDeedDetailUi.js
- Modify: public/clientHomeEntryBindings.js
- Modify: public/index.html
- Modify: public/styles.css
- Create: public/clientInteractionRegression.test.js
- Test: public/clientUxContracts.test.js
- Test: public/clientResponsiveA11y.test.js

**Interfaces:**

- Every managed modal opener passes its HTMLElement trigger to openSurface; close, Escape, scrim, and nested close restore focus to that exact connected trigger or a documented fallback.
- Async action buttons expose aria-busy=true, are disabled during the request, show PROCESSING…, and restore from the server acknowledgement or timeout.
- popup-card uses overscroll-behavior: contain; reduced-motion removes auction timer transitions.
- Room-code input preserves pasted text for validation and reports the six-character rule without silently truncating the value.
- The in-game top navigation opens the existing Rules surface without leaving the room.

- [ ] Step 1: Add tests for focus restoration from trade/deed modals, Escape and scrim dismissal, duplicate action clicks, stale acknowledgement, room-code paste, Rules/Help opening, and no page overflow.
- [ ] Step 2: Run the focused client tests and confirm the current failures.
- [ ] Step 3: Thread opener elements through every modal caller, add pending/error/timeout states, add the CSS containment and reduced-motion override, preserve pasted values, and add the non-destructive Rules action.
- [ ] Step 4: Run node public/clientInteractionRegression.test.js, node public/clientUxContracts.test.js, and node public/clientResponsiveA11y.test.js.
- [ ] Step 5: Commit with fix: preserve modal focus and truthful pending states.

### Task 12: Correct forms, profile dates, logout data, and view titles

**Files:**

- Modify: public/index.html
- Modify: public/clientSanitize.js
- Modify: public/clientProfileRender.js
- Modify: public/clientState.js
- Modify: public/clientSocketListeners.js
- Create: public/clientDocumentMeta.js
- Create: public/clientDocumentMeta.test.js

**Interfaces:**

- setDocumentMeta({ view, status = 'ready', roomCode = null }) updates document.title and the existing live region without changing navigation or game state.
- clearLocalPlayerData({ includeTheme, includeAudio, includePatrol }) removes only Poorup-owned keys and never removes unrelated application storage.
- A storage listener reconciles explicit sign-out and expired sessions across tabs without clearing credentials for transient restore errors.
- Form fields receive explicit name, autocomplete, and inputmode values; room-code fields keep autocomplete=off.

- [ ] Step 1: Add tests for Home/Profile/Rules/Social/Rankings/Game/error titles, createdAt rendering, cross-tab sign-out, and all targeted input attributes.
- [ ] Step 2: Run the tests and observe the missing dates, static title, and retained local-data failures.
- [ ] Step 3: Implement the metadata helper, sanitized date flow, owned-key clearing, cross-tab listener, and semantic attributes.
- [ ] Step 4: Run the focused client tests and the 1920 Playwright smoke.
- [ ] Step 5: Commit with fix: make profile, session, and document state truthful.

### Task 13: Make audio and ambient motion honest and bounded

**Files:**

- Modify: public/main.js
- Modify: public/styles.css
- Modify: public/index.html
- Modify: public/clientThemeRender.js
- Modify: public/clientTheme.js
- Modify: public/clientThemeData.js
- Test: public/clientTheme.test.js
- Test: public/clientResponsiveA11y.test.js

**Interfaces:**

- unlockAudioFromGesture() resumes the AudioContext once from a trusted pointer/keyboard gesture and reports audioState as locked, ready, or blocked.
- setMusicState(state) keeps the toggle label and aria-pressed synchronized with actual media events; rejected play promises produce a retryable live-region message.
- Ambient theme layers expose pauseAmbientMotion(reason) and resumeAmbientMotion(reason); hidden views, document-hidden state, reduced motion, and forced colors pause without changing game state.
- Auction timer motion is transform/opacity-free under reduced motion and retains readable numeric updates.

- [ ] Step 1: Add tests for a blocked AudioContext, rejected music.play(), gesture unlock, reduced-motion timer CSS, hidden-view pause, and no keyboard-triggered animation.
- [ ] Step 2: Run the tests and capture the current mismatch between visual toggle state and media state.
- [ ] Step 3: Implement the state machine, media listeners, gesture unlock, reduced-motion override, and existing theme pause hooks.
- [ ] Step 4: Run client tests and the browser audio/motion cases at desktop and iPad-landscape sizes.
- [ ] Step 5: Commit with fix: reconcile audio state and reduced-motion ambience.

### Task 14: Add SEO, app metadata, and link-preview plumbing without guessing public identity

**Files:**

- Modify: public/index.html
- Create: public/clientDocumentMeta.js
- Create: public/manifest.webmanifest
- Create: public/assets/social/poorup-og-1200x630.png only after approval gate 19
- Modify: server/server.js
- Create: server/metadata-routes.test.js

**Interfaces:**

- setDocumentMeta from Task 12 owns per-view title and status changes.
- metadataConfig(env) returns { origin, indexPolicy, previewPath, description }; absent origin defaults to noindex app behavior and never emits a fabricated canonical URL.
- Public metadata includes description, og:type, og:title, og:description, og:image, og:image:width=1200, og:image:height=630, twitter:card, favicon, touch icon, and manifest links when configured.
- Private room codes, account pages, and game-state URLs are never placed in a global sitemap or preview image.

- [ ] Step 1: Add route tests that assert metadata has no fake host, app routes are noindex when origin is absent, and configured metadata emits exact absolute URLs.
- [ ] Step 2: Run node server/metadata-routes.test.js and observe the missing metadata contracts.
- [ ] Step 3: Add metadata tags, manifest, safe route policy, per-view titles, and static robots.txt/sitemap behavior driven by explicit environment values.
- [ ] Step 4: Add a 1200×630 preview only after the owner approves the canonical host, index policy, copy, and artwork in the gated tasks below.
- [ ] Step 5: Run the route test and inspect a social-card HTML fixture.
- [ ] Step 6: Commit the plumbing separately from the approved artwork with feat: add truthful document metadata and link previews.

### Task 15: Correct current documentation without deleting historical evidence

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

**Interfaces:**

- Historical audit files remain unchanged except for a short superseded pointer when a current document must explain the status.
- Current docs use the exact feature names and paths from docs/feature-status.json.
- README and Home copy say “no account required,” not “no accounts”; capacity, version, rulesets, boards, market, events, bots, seasons, and optional systems match current source.
- Design docs no longer claim session expiry, profileViewState, active debris frames, or a missing branch state.

- [ ] Step 1: Add a docs-parity test that searches the listed stale phrases and rejects them in active docs.
- [ ] Step 2: Run node server/docsFeatureStatus.test.js and the parity test to capture stale claims.
- [ ] Step 3: Update only claims proven by current source, link completed audits to 151b480, and label unimplemented Wallet/Items, airport, prediction, and bank-account systems as planned.
- [ ] Step 4: Run npm run test:audit and inspect the Markdown diff for accidental historical rewrites.
- [ ] Step 5: Commit with docs: reconcile product and release documentation with current code.

### Task 16: Run visual, browser, accessibility, and performance evidence

**Files:**

- Modify: qa/playwright.config.js
- Modify: qa/theme.spec.js
- Modify: qa/batch3-responsive-a11y.spec.js
- Modify: qa/*.spec.js files that own the new route and stale-state cases
- Create: qa/metadata.spec.js
- Create: qa/session-recovery.spec.js
- Create: qa-artifacts/audit-2026-09-13/README.md

**Interfaces:**

- Browser matrix is exactly 1920×1080, 1366×768, 1024×768, iPad landscape, and 390×844.
- Every screenshot filename includes route, viewport, commit, and state; image dimensions are checked before inspection.
- Tests cover Standard-40 and Metro-52, modal focus, keyboard arrows, screen readers, reduced motion, forced colors, 200% zoom, pending/stale/timeout/offline/session-expiry, social overlays, and bot status.

- [ ] Step 1: Add the metadata and session-recovery specs and a dimension assertion for every 1920 artifact.
- [ ] Step 2: Run the new specs and record the expected failures before implementation.
- [ ] Step 3: Capture Home, Game, Profile, Rankings, Social, Rules, lobby, Market, and representative modal screens at 1920×1080 after Tasks 11–15.
- [ ] Step 4: Run npx playwright test -c qa/playwright.config.js, npm run lint, and npm run lint:client.
- [ ] Step 5: Run npm run test:full, npm run coverage, and the bounded load harness in testing mode.
- [ ] Step 6: Inspect every native-size screenshot, record findings in qa-artifacts/audit-2026-09-13/README.md, and commit with test: add release evidence for docs and bug fixes.

### Task 17: Strict architecture, anti-slop, and maintainability review

**Files:**

- Review all files changed by Tasks 1–16; no source edits start from this task without a concrete finding.
- Review reports are saved under docs/audit/architecture-review-2026-09-13.md and docs/audit/anti-slop-review-2026-09-13.md.

**Interfaces:**

- The review consumes the real merge-base diff and the feature-status manifest.
- Findings use P0–P3 severity, exact file/function/line references, a smallest safe fix, and a regression command.
- The review does not authorize deleting a historical document or changing a product policy.

- [ ] Step 1: Run code-architecture-review over the changed dependency graph and identify new cycles, god-module growth, duplicated projections, and unclear ownership.
- [ ] Step 2: Run improve-codebase-architecture and thermo-nuclear-code-quality-review on the complete diff; record giant-method, branching, coupling, and abstraction findings.
- [ ] Step 3: Run grill-me as an adversarial product/architecture interrogation: ask whether each change is necessary, whether a simpler existing seam exists, and whether a user-visible behavior changed.
- [ ] Step 4: Run install-anti-slop only as a detector/configuration check; do not vendor a second linter or rewrite unrelated CSS.
- [ ] Step 5: Run frontend-design-review, web-design-guidelines, accessibility, game-ui-ux, mobile-responsiveness, impeccable, design-taste-frontend, svg-design, pixel-art-sprites, animate, emilkowal-animations, design-motion-principles, and review-animations against the captured UI; record only actionable findings.
- [ ] Step 6: Resolve P0/P1 findings with a new failing regression test, rerun the relevant suite, and repeat the review until no Important finding remains.
- [ ] Step 7: Commit the review evidence with chore: record architecture and interface quality review.

## User-input and credential gates

These tasks are fully specified but must not be executed by assumption. Each gate produces a short decision record under docs/decisions/ before implementation.

### Gate 18: Account rights, retention, and authentication

**Decision record:** docs/decisions/account-rights-and-auth-2026-09-13.md

Choose one account lifecycle:

1. Self-service export plus deletion with cascade removal from accounts, social, matches, achievements, seasons, cosmetics, telemetry projections, and backups.
2. Manual support-based erasure/export with a documented response time, while registration remains explicitly beta-scoped.
3. Disable account registration until an erasure path is available.

Also choose:

- retention duration for accounts, matches, social records, telemetry, and backups;
- whether guest history is local-only, server-retained, or discarded;
- bearer TTL and absolute expiry;
- localStorage bearer mitigation versus HttpOnly-cookie migration;
- password change/reset/recovery provider;
- cross-tab sign-out behavior.

After the choice, implement account-export, account-delete, account-revoke-sessions, retention jobs, and the matching privacy tests. No code should claim deletion before the decision record exists.

### Gate 19: Public identity, SEO, and link previews

**Decision record:** docs/decisions/public-metadata-2026-09-13.md

Supply:

- canonical production hostname and protocol;
- whether Home, Rules, Rankings, and public room directory are indexable;
- sitemap inclusion list and private-route noindex list;
- approved 1200×630 artwork or approval to generate it from the 1920×1080 Home scene;
- exact title, description, social-card copy, and preview alt text;
- favicon/touch-icon approval.

Only then generate public/assets/social/poorup-og-1200x630.png, emit canonical/OG/Twitter tags, and add sitemap entries. Room codes, account IDs, and live game state never enter public previews.

### Gate 20: Legal, support, age, currency, and attribution

**Decision record:** docs/decisions/legal-and-licensing-2026-09-13.md

Supply approved copy and identity for:

- Privacy Notice;
- Terms of Service and acceptable-use rules;
- support/contact/issue URL;
- minimum-age statement;
- fictional-currency and no-real-money-gambling disclosure;
- third-party/Monopoly-style inspiration disclaimer;
- configured AI-provider disclosure, consent, and opt-out;
- exact font, audio, patrol, and artwork licenses.

After approval, add footer links and accessible static routes, a root LICENSE, OFL/CC0/other notices, and account/AI/privacy controls. Unknown or redundant public assets move only after the owner approves a recoverable quarantine.

### Gate 21: Market economics

**Decision record:** docs/decisions/derivative-pricing-2026-09-13.md

Choose the server pricing model for calls and puts, strike bands, premium calculation, quote tick/round age, exercise window, collateral release, fees, and default handling. The safe pre-decision behavior from Task 5 rejects client-priced or same-round terms; this gate enables a documented economic model and golden-vector tests without changing unrelated market actions.

### Gate 22: Production topology and scale

**Decision record:** docs/decisions/production-topology-2026-09-13.md

Supply:

- real PostgreSQL adapter and migration credentials;
- Redis/pub-sub choice if more than one process is required;
- trusted proxy hop count;
- allowed origins;
- TLS termination and HSTS ownership;
- edge/IP rate-limit budgets;
- Nest host, PM2/systemd owner, secrets, deployment hook, and uptime alert destination;
- maintenance/drain window and rollback target.

Keep JSON single-process mode until the adapter health check, migration drill, restore drill, and two-process consistency test pass.

### Gate 23: Release metadata and historical documents

**Decision record:** docs/decisions/release-metadata-2026-09-13.md

Choose the semantic version/tag, changelog format, public build identity, support URL, and whether the two Delete Candidates are retained, moved to an archive directory, or deleted. No historical file is deleted by the no-input tranche.

## Pull-request sequence and rollback

1. PR A: feature-status manifest and test harness.
2. PR B: persistence fail-closed guard, sessions, guest-seat binding, and auth failure classification.
3. PR C: host/invite/rematch/capacity lifecycle.
4. PR D: contracts, debt, short defaults, options fail-closed behavior, and season rewards.
5. PR E: persistence queue, privacy projections, backups, and readiness.
6. PR F: socket admission, rate limits, validation, CSP, and timer teardown.
7. PR G: client focus, forms, Rules/Help, audio, motion, titles, and link-preview plumbing.
8. PR H: documentation parity and native browser evidence.
9. PR I: owner-gated legal, account rights, pricing, licensing, URL, and infrastructure work.

Every PR includes focused tests, lint output, rollback notes, and a review against the real merge base. Rollback means reverting the PR commit(s) and restoring the previous JSON backup after checksum verification; it never uses an unreviewed destructive reset.

## Verification and merge gate

The branch is ready for merge only when all of the following are evidenced:

- npm run test:full passes, with the Windows rooms.test.js spawn limitation isolated or replaced by a deterministic in-process test.
- npm run lint and npm run lint:client pass.
- npx playwright test -c qa/playwright.config.js passes at all required viewports.
- Native 1920×1080 screenshots are dimension-checked and visually inspected.
- Standard-40 and Metro-52 geometry, theme default, reduced motion, forced colors, 200% zoom, keyboard, screen-reader, stale state, pending state, and session recovery tests pass.
- Seat restore cannot hijack a live socket; bots cannot become host; invite transfer is transactional; rematch and capacity are correct.
- Hybrid, debt, short-default, option, and season reward invariants pass golden-vector tests.
- Telemetry and match-history projections contain no private data; writes are batched and retryable.
- Backup sidecars are checked, writes are atomic, and readiness reports store/backup health.
- Production horizontal mode remains rejected until the real adapter gate passes.
- Metadata never invents a canonical host; approved link previews use a 1200×630 asset and exclude private room state.
- No active document contains the stale claims listed in the audit; historical evidence remains traceable.
- CodeScene preparation/review and the strict architecture/anti-slop review report no unresolved Important findings.

## Skills used and their checkpoints

| Skill | Checkpoint |
|---|---|
| superpowers:brainstorming | Confirmed scope split and policy gates before implementation. |
| superpowers:writing-plans | This document, task sizing, interfaces, tests, and self-review. |
| superpowers:dispatching-parallel-agents | Independent document, bug, and UX audits were run in parallel with Luna agents. |
| superpowers:systematic-debugging | Reproduce every named bug before changing code. |
| superpowers:test-driven-development and tdd | Red-green-refactor for each invariant and UI contract. |
| superpowers:verification-before-completion | Evidence gate before any completion or merge claim. |
| find-skills and skill-installer | Confirmed local skills; no extra runtime package is required. |
| software-architecture-design and code-architecture-review | Preserve modular monolith and review seams/cycles. |
| security-best-practices | Session, origin, rate-limit, CSP, privacy, backup, and input review. |
| qa-agent-testing and agentic-eval | Regression matrix, adversarial recovery cases, and evaluator-style acceptance. |
| frontend-design-ui-ux, frontend-design, frontend-design-review, design-taste-frontend, impeccable, critique | Preserve the Poorup design system while fixing focus, states, hierarchy, and link previews. |
| game-ui-ux and mobile-responsiveness | Board-safe HUD, modal state stack, touch targets, iPad landscape, and responsive evidence. |
| accessibility and web-design-guidelines | WCAG 2.2 keyboard, screen reader, live region, focus, motion, zoom, and form semantics. |
| svg-design, pixel-art-sprites, Pixel Art Animator | Preserve crisp local artwork, integer geometry, limited palette, and controlled ambient motion. |
| animate, emilkowal-animations, design-motion-principles, improve-animations, review-animations | Motion purpose, transform/opacity limits, pause rules, reduced-motion behavior, and visual review. |
| grill-me, improve-codebase-architecture, thermo-nuclear-code-quality-review, install-anti-slop | Adversarial simplicity, coupling, complexity, giant-module, and anti-slop review before merge. |
