# Poorup Markdown, Bug, and Feature-Parity Audit — 2026-09-13

## Scope and method

This is a read-only reconciliation of every tracked Markdown or README file against the code at main commit 151b480. The audit includes product/design specifications, dated audits, release-readiness reports, deployment runbooks, asset notices, QA documentation, and historical devlogs. No source files or existing documents were changed or deleted.

Three Luna agents performed independent passes at high reasoning effort:

- a document inventory and parity pass;
- a bug-versus-false-positive pass over server, client, persistence, and release findings;
- a UX, accessibility, SEO, metadata, and link-preview pass.

The final disposition below is based on current source evidence, not on an old report’s conclusion. A finding is classified as:

- **TRUE BUG** — current behavior violates a stated invariant, creates a security/privacy/reliability risk, or contradicts an implemented contract.
- **MISSING FEATURE** — the product does not provide a capability that a release document promises or a public release requires.
- **INTENTIONAL DESIGN** — the behavior is an explicit product constraint and should not be “fixed” without changing the product.
- **FALSE POSITIVE / RESOLVED** — the cited defect was fixed or the old claim no longer matches the current source.
- **ENVIRONMENT-DEPENDENT** — the outcome depends on proxy, browser, deployment, provider, or infrastructure configuration and needs a targeted verification.
- **USER INPUT REQUIRED** — implementation is blocked by a policy, legal, brand, licensing, URL, credential, or product decision.

## Baseline verification

| Check | Result | Interpretation |
|---|---|---|
| git status --short --branch | main...origin/main, clean | No local implementation changes were present during this audit. |
| npm run test:audit | Passed | Market settlement, lifecycle, card-deck, room-directory, account-session, season, summary-privacy, and casino-reel audits passed. |
| Focused client contracts | Passed | Responsive/a11y, UX, asset, theme, Quick Table, transaction, maintenance, and analytics contracts passed. |
| Playwright responsive/a11y matrix | 30 passed | Desktop 1920, tablet 1024, and mobile 390 contracts pass. |
| npm test | Reached rooms.test.js, then Windows spawn EPERM | Environment-dependent test-runner limitation; this is not evidence of a product failure. Isolate that live test from the Windows process-spawn path in the implementation plan. |
| main commit | 151b480 | All source references in this report are anchored to this revision unless stated otherwise. |

## Document inventory and disposition

The repository contains 118 tracked Markdown/README files. Every file is assigned exactly one category.

### Active — 29

These are live contracts, design authorities, operational runbooks, or current feature specifications. They may still contain explicitly described backlog work, which is tracked in the implementation plan rather than silently treated as shipped.

- .github/copilot-instructions.md
- PRODUCT.md
- docs/DEVELOPMENT_WORKFLOW.md
- docs/production-hardening.md
- docs/deployment/nest-development.md
- docs/deployment/nest-live-runbook.md
- docs/deployment/nest-testing.md
- docs/deployment/release-runbook.md
- docs/deployment/rollback-runbook.md
- docs/design/figma-theme-worlds-2026-09-11.md
- docs/design/THEME-MUSIC-CURATION-2026-09-12.md
- .ulpi/design/DESIGN.md
- .ulpi/design/FINANCE-RAIL-UX-PLAN.md
- .ulpi/design/NEW-GAME-SYSTEMS-PLAN.md
- .ulpi/design/PLAYER-FINANCING-PLAN.md
- .ulpi/design/QUICKPLAY-BOTS-TRADING-SOCIAL-PLAN.md
- .ulpi/design/RANKINGS-METRICS-PLAN.md
- .ulpi/design/RULESETS-SEASONS-MARKET-PLAN.md
- .ulpi/design/gameplay.md
- .ulpi/design/supplied/poorup_design_system.md
- docs/plans/ai-bots-plan.md
- docs/plans/casino-market-global-events-plan.md
- docs/plans/friends-and-player-social-plan.md
- docs/plans/global-events-plan.md
- docs/plans/global-leaderboards-plan.md
- docs/plans/match-history-and-in-session-social-plan.md
- docs/plans/no-ai-bots-plan.md
- docs/sponsored-purchase.md
- qa/load/README.md

### Completed — 25

These documents record work that has a corresponding implementation or completed verification. They should remain immutable evidence and should link to the commit or test run that closed them.

- docs/DEVLOG-7.md
- docs/audit/agent-codebase-bugs-2026-09-11.md
- docs/audit/agent-md-parity-brainstorm-2026-09-11.md
- docs/audit/agent-ui-review-2026-09-11.md
- docs/audit/agent-ux-review-2026-09-11.md
- docs/audit/codescene-premerge-2026-09-12.md
- docs/audit/expansion-completion-2026-09-09.md
- docs/audit/expansion-implementation.md
- docs/audit/fix-architecture-batch-2026-09-12.md
- docs/audit/fix-docs-parity-batch-2026-09-12.md
- docs/audit/fix-responsive-a11y-batch-2026-09-12.md
- docs/audit/fix-server-batch-2026-09-12.md
- docs/audit/fix-transaction-ui-batch-2026-09-12.md
- docs/audit/pre-merge-review-2026-09-12.md
- docs/audit/qa-security-premerge-2026-09-12.md
- docs/audit/ui-visual-premerge-2026-09-12.md
- docs/audit/ux-1920-reset-slice-2026-09-11.md
- docs/audit/release-readiness-2026-09-12/RR-31-test-suite-run.md
- docs/plans/achievement-announcements-ui-plan.md
- docs/plans/achievements-plan.md
- docs/plans/deal-negotiation-plan.md
- docs/plans/END-TO-END-AUDIT-CS2-ROULETTE-PLAN.md
- docs/plans/IPAD-LANDSCAPE-UI-UX-AUDIT.md
- docs/superpowers/plans/2026-09-10-poorup-theme-system-implementation.md
- docs/superpowers/plans/2026-09-11-petal-pedestrian-ambient-motion.md

### Reference — 52

These are historical evidence, source material, or dated release checks. They are useful for traceability but are not live implementation queues.

- .ulpi/design/BOARD-SOURCES.md
- .ulpi/design/THEME-SYSTEM-VISUAL-BRAINSTORM.md
- public/assets/audio/README.md
- public/assets/parlor-patrol/README.md
- docs/AUDIT-2026-09-08.md
- docs/AUDIT-DEEP-2026-09-08.md
- docs/AUDIT-FULL-2026-09-08.md
- docs/audit/agent-complexity-review-2026-09-11.md
- docs/audit/full-codebase-audit-2026-09-12.md
- docs/audit/markdown-feature-parity-2026-09-11-theme-reset.md
- docs/audit/poorup-audit-2026-09-08.md
- docs/audit/release-readiness-2026-09-08.md
- docs/audit/release-readiness-40-agent-2026-09-12.md
- docs/audit/release-readiness-2026-09-12/RR-01-404-error-pages.md
- docs/audit/release-readiness-2026-09-12/RR-02-account-deletion.md
- docs/audit/release-readiness-2026-09-12/RR-03-legal-compliance.md
- docs/audit/release-readiness-2026-09-12/RR-04-data-rights.md
- docs/audit/release-readiness-2026-09-12/RR-05-auth-session-lifecycle.md
- docs/audit/release-readiness-2026-09-12/RR-06-asset-licensing.md
- docs/audit/release-readiness-2026-09-12/RR-07-dependency-hygiene.md
- docs/audit/release-readiness-2026-09-12/RR-08-security-headers.md
- docs/audit/release-readiness-2026-09-12/RR-09-static-serving-safety.md
- docs/audit/release-readiness-2026-09-12/RR-10-versioning-release-meta.md
- docs/audit/release-readiness-2026-09-12/RR-11-rate-limiting-sweep.md
- docs/audit/release-readiness-2026-09-12/RR-12-input-validation-sweep.md
- docs/audit/release-readiness-2026-09-12/RR-13-dos-resource-exhaustion.md
- docs/audit/release-readiness-2026-09-12/RR-14-deploy-shutdown.md
- docs/audit/release-readiness-2026-09-12/RR-15-backup-restore-drill.md
- docs/audit/release-readiness-2026-09-12/RR-16-monitoring-health.md
- docs/audit/release-readiness-2026-09-12/RR-17-persistence-failure-modes.md
- docs/audit/release-readiness-2026-09-12/RR-18-long-run-stability.md
- docs/audit/release-readiness-2026-09-12/RR-19-load-event-loop.md
- docs/audit/release-readiness-2026-09-12/RR-20-client-crash-reporting.md
- docs/audit/release-readiness-2026-09-12/RR-21-landing-meta-seo.md
- docs/audit/release-readiness-2026-09-12/RR-22-onboarding-funnel.md
- docs/audit/release-readiness-2026-09-12/RR-23-empty-states.md
- docs/audit/release-readiness-2026-09-12/RR-24-network-failure-ux.md
- docs/audit/release-readiness-2026-09-12/RR-25-loading-pending-states.md
- docs/audit/release-readiness-2026-09-12/RR-26-copy-review.md
- docs/audit/release-readiness-2026-09-12/RR-27-room-code-edges.md
- docs/audit/release-readiness-2026-09-12/RR-28-mobile-ipad.md
- docs/audit/release-readiness-2026-09-12/RR-29-cross-browser.md
- docs/audit/release-readiness-2026-09-12/RR-30-a11y-release-sweep.md
- docs/audit/release-readiness-2026-09-12/RR-32-performance-budget.md
- docs/audit/release-readiness-2026-09-12/RR-33-view-error-states.md
- docs/audit/release-readiness-2026-09-12/RR-34-audio-behavior.md
- docs/audit/release-readiness-2026-09-12/RR-35-host-rematch-lifecycle.md
- docs/audit/release-readiness-2026-09-12/RR-36-data-map-privacy.md
- docs/audit/release-readiness-2026-09-12/RR-37-privacy-controls-ux.md
- docs/audit/release-readiness-2026-09-12/RR-38-docs-support.md
- docs/audit/release-readiness-2026-09-12/RR-39-blocker-triage.md
- docs/audit/release-readiness-2026-09-12/RR-40-end-to-end-trace.md

### Outdated — 10

These documents contain claims or plans that no longer match 151b480. They should be updated or explicitly marked superseded; they should not be used as release gates until corrected.

- README.md — says “no accounts” instead of “no account required,” omits current rulesets/bots/events/market/seasons, and contains stale version/capacity copy.
- SHOWCASE.md — describes the old single-file game architecture and old feature surface.
- Instructions.md — omits auctions, contracts, casino, market, events, bots, achievements, and seasons.
- .ulpi/design/ACCOUNT-PROFILE.md — promises expired-session behavior that the current bearer-token implementation does not provide.
- .ulpi/design/HOME-PROFILE-REDESIGN.md — references nonexistent profileViewState.
- .ulpi/design/THEME-FIVE-VISUAL-BRAINSTORM.md — describes an earlier theme reset direction, not the active six-theme registry.
- .ulpi/design/NIGHT-SHIFT-MICROGAME-PLAN.md — treats debris-6-frames.svg as active although it is not mounted.
- docs/REFACTOR-ROADMAP.md — old sequencing and module assumptions.
- docs/plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md — superseded rail/modal assumptions.
- docs/superpowers/plans/2026-09-13-branch-release-maintenance-analytics.md — contains pre-execution branch/SHA and unchecked-step assumptions that are now recorded in the deployment docs.

### Delete Candidate — 2

Deletion is not authorized by this audit. Both files retain historical context and should first be moved to an archive folder or kept with a superseded header after owner approval.

- .ulpi/design/FINAL-REVIEW.md — references nonexistent REFERENCE_UI_ONLY.
- docs/audit/room-patrol-bug-audit.md — historical patrol investigation with no current release ownership.

## Current issue disposition

### P0 or conditional P0

| ID | Evidence | Disposition | Current state and action |
|---|---|---|---|
| P0-1 | server/persistenceMode.js:8-25 and server/persistenceMode.test.js:7-9 | **TRUE BUG, conditional P0** | The guard rejects a URL-only setting but reports postgres-ready for any non-empty URL plus POORUP_PERSISTENCE_ADAPTER=postgres; no PostgreSQL adapter or transactional health check is registered. Fail closed until a real adapter is instantiated and health-checked. |
| P0-2 | server/rooms.js:735-750 | **TRUE BUG, P0 under public multi-user threat model** | restoreConnection() reassigns player.socketId without checking whether the current socket is still live; guest restores can also omit an account identity. Reject live-seat replay and add duplicate-tab tests. |
| P0-3 | server/serverSocketAccount.js:58-97, server/accountStore.js:430-620 | **MISSING FEATURE / USER INPUT REQUIRED** | There is no account export, deletion, cascade removal, or backup erasure. This is a release blocker only if public privacy/DSAR promises are made; the product owner must choose self-service deletion, manual erasure, or beta-only scope. |

### P1 correctness, security, privacy, and availability

| ID | Evidence | Disposition | Current state and action |
|---|---|---|---|
| P1-1 | server/accountStore.js:459-498, public/clientSanitize.js:327-340 | **TRUE BUG** | Bearer sessions have no expiry and remain valid in local storage until logout or token rotation. Add a bounded TTL/absolute expiry and explicit expired-session response; cookie migration is a separate policy gate. |
| P1-2 | public/clientSocketListeners.js:52-61 | **TRUE BUG** | Every failed restore clears the stored session, including transient storage/rate-limit/server errors. Clear credentials only for explicit invalidation and show retry state for transient failures. |
| P1-3 | server/serverSocketAccount.js:152-178, :181-192 | **TRUE BUG** | Register/login changes socket.data.accountId but does not bind a guest’s current room seat, so game history and reconnect attribution can be lost. Bind the account to the socket-owned seat when the game is still in a safe lobby state and test the transition. |
| P1-4 | server/serverSocketAccount.js:154-167, :78-100 | **TRUE BUG; proxy impact environment-dependent** | Successful unauthenticated registration resets failed-auth counters; per-socket/IP keys also collapse behind proxies. Separate registration limits, use trusted proxy resolution for the socket layer, and test multi-socket abuse. |
| P1-5 | server/server.js:64-70 | **TRUE BUG; runtime impact environment-dependent** | Socket.IO polling CORS is configured, but direct WebSocket admission has no explicit origin gate. Add allowRequest/transport admission with the same allow-list and a hostile-origin integration test. |
| P1-6 | server/socketRuntime.js:263-272 | **TRUE BUG** | Host reassignment chooses any available player, including bots. Select a connected, non-bankrupt human or leave the room hostless with an explicit recovery path. |
| P1-7 | server/socketRuntime.js:783-800, public/clientParlorBindings.js:239-251 | **TRUE BUG** | Invite acceptance detaches the old room before target commit, and a successful invite from Home/Social does not apply the returned room entry or navigate. Make the transfer transactional and route the accepted room result through the normal entry flow. |
| P1-8 | public/clientStateSync.js:365-368, server/gameLogic.js:526-538 | **TRUE BUG** | Non-host clients retain gameOver after rematch, and expired disconnected seats can revive or block the next round. Clear round-scoped client state on a new started snapshot and prune expired seats before rematch. |
| P1-9 | server/gameLogic.js:492-497, server/rooms.js:521-546 | **TRUE BUG** | Post-game canJoin() counts active humans but ignores retained bot seats, so a finished room can exceed capacity. Count every retained seat or prune bots before admitting a new player. |
| P1-10 | server/contractLogic.js:137-144, :483-512, server/bankruptcyLogic.js:117-128 | **TRUE BUG** | A hybrid conversion failure falls back to a player-loan default while the hybrid has no collateral, destroying lender principal without recovery. Account for pending shares and settle failed conversions through an explicit collateral/default path. |
| P1-11 | server/seasonModule.js:268-278, :368-372 | **TRUE BUG** | Placement percentile is measured from the top but reward thresholds are compared as if larger means better; bottom players can qualify for top rewards. Use a named placementRank/eligibleTopFraction calculation and boundary tests for 1, 2, 3, and 100 players. |
| P1-12 | server/bankruptcyApi.js:40-62, server/gameLogic.js:1095-1112 | **TRUE BUG** | Debt-mode bankruptcy leaves inDebt active and does not reliably conclude a round; winner selection excludes the debtor, allowing a permanently active game. Centralize debt conclusion and assert the postcondition. |
| P1-13 | server/marketExpansion.js:235-252, :263-275, :315-324 | **TRUE BUG; pricing policy gate** | The client still supplies strike and premium and may exercise in the same round. The reserve cap fixes the old unbounded drain, but not favorable terms. Product must approve a pricing/band model; then enforce it server-side and require a later quote tick/round. |
| P1-14 | server/telemetryModule.js:77-87, server/socketRuntime.js:54-120, :175-193 | **TRUE BUG** | Each telemetry event rewrites and fsyncs the full file, and settlement serializes hundreds of writes. Buffer/batch records, flush on bounded intervals, and preserve dirty state on failed flushes. |
| P1-15 | server/backupStore.js:63-70, :27-52 | **TRUE BUG** | JSON parsing does not compare the .sha256 sidecar; backup writes are non-atomic and rotation trusts mtime without validating candidates. Verify digest, write temp-plus-rename, validate before rotation, and record restore evidence. |
| P1-16 | server/roomSetup.js:294-323, server/accountStore.js:250-261, :361-375 | **TRUE BUG / privacy** | Every participant’s private match history stores opponents’ casino, market P/L, and contract details. Store an owner-scoped projection and retain sensitive settlement data only in an authorized server ledger. |
| P1-17 | server/serverSocketSocial.js:401-409, server/accountStore.js:745-764 | **TRUE BUG / privacy** | Player-card recentMatches is returned even when context.canSeeRecent is false. Return an empty projection unless the target’s visibility permits it and add a regression test. |
| P1-18 | server/httpRateLimiter.js:50-58, server/socketRateLimiter.js:3-23, server/socketSocialApi.js:265-270 | **TRUE BUG / deployment hardening** | HTTP limiting is disabled unless configured; socket/chat buckets reset on reconnect; there is no handshake admission or global connection budget. Add startup assertions for production, IP/account buckets, concurrent connection caps, and rejection metrics. |
| P1-19 | server/server.js:47 | **TRUE BUG** | CSP connect-src self ws: wss: allows arbitrary WebSocket destinations. Narrow it to same-origin and an explicitly configured production origin. |
| P1-20 | server/server.js:42-48, docs/production-hardening.md | **MISSING HARDENING** | form-action self, COOP/CORP, explicit font policy, and a complete deployment header contract are absent. Add safe headers; keep TLS/HSTS as proxy-owned unless the deployment contract changes. |

### P2/P3 reliability, validation, UX, and operational findings

| ID | Evidence | Disposition | Current state and action |
|---|---|---|---|
| P2-1 | server/cosmeticCatalog.js:66-70, :174-180 | **TRUE BUG** | Claim keys and equipment slots are unbounded/arbitrary. Validate catalog IDs, allow-list slots, and cap stored collections. |
| P2-2 | server/socialStore.js:196-212 | **TRUE BUG** | Block/report IDs are not bounded or checked against account records and each write rewrites the full store. Validate IDs, cap lists, and batch persistence. |
| P2-3 | server/roomSettings.js:135-143, server/rulesetRegistry.js:136-146 | **TRUE BUG** | startingCash, turnTimer, and numeric overrides accept values such as 1e308. Enforce finite integer ranges per setting and reject invalid acknowledgements without mutating state. |
| P2-4 | server/gameLogic.js:171, :190, :257, :276 | **TRUE BUG** | Per-game transaction replay maps grow until the game ends. Cap by request age/count and evict deterministically. |
| P2-5 | server/socketRuntime.js:674-690 | **TRUE BUG** | AFK expiry clears an active payment before advancing the turn, forgiving debt. Preserve the obligation, settle it through the same debt path, or conclude the player under the game’s debt rules. |
| P2-6 | server/marketExpansion.js:381-401 | **TRUE BUG** | Short default debt is recorded as a block but has no collection/settlement path. Add a deterministic settlement account and tests for insufficient cash. |
| P2-7 | server/server.js:135-146 | **TRUE BUG / operations** | readyz reports maintenance/room state but not store-load health, corruption, or backup freshness. Extend the readiness projection without exposing secrets. |
| P2-8 | server/socketRuntime.js:344-350, :584-599, :695-722 | **TRUE BUG / availability** | Timer callbacks can throw into the process-level exit path. Wrap callbacks with structured error logging, isolate room failures, and test timer teardown. |
| P2-9 | server/rooms.js:809-821 | **TRUE BUG** | leaveRoomByClient() can delete a room without runtime.destroyRoom(), retaining timers/maps. Route all deletion through the runtime teardown seam. |
| P2-10 | server/socialStore.js:215-234, server/socketRuntime.js:774-780 | **TRUE BUG** | Invites bind only to a reusable room code and expired rows remain visible. Bind to an immutable room public ID, prune expired records on read, and reject code reuse. |
| P2-11 | public/index.html:294-296, public/clientHomeEntryBindings.js:68-77 | **TRUE BUG / UX** | Pasted room codes are truncated before the user receives a useful validation message. Preserve the pasted value for feedback and show the exact six-character requirement. |
| P2-12 | public/clientStateSync.js, public/clientRailRender.js, public/clientDeedDetailUi.js | **TRUE BUG / UX** | Full innerHTML rebuilds destroy focus and create render churn. Move to dirty-slice updates with a focus key and live-region announcements. |
| P2-13 | public/clientSanitize.js:301-313, public/clientProfileRender.js | **TRUE BUG** | createdAt is dropped, so profiles display GUEST after reload. Preserve a sanitized ISO timestamp or change the label to a truthful value. |
| P2-14 | public/clientSocketListeners.js, public/clientState.js | **TRUE BUG / UX** | Logout clears the session token but leaves profile/design/theme/audio/patrol data, and tabs do not reconcile sign-out. Add explicit local-data clearing and storage-event session reconciliation. |
| P2-15 | public/index.html:592-601 | **TRUE BUG / UX** | In-game navigation lacks a non-destructive Rules/Help entry. Add one action that opens the existing Rules surface without leaving the table. |
| P2-16 | public/clientSurfaces.js:192-208, modal openers | **TRUE BUG / accessibility** | Trade and deed-detail openers do not consistently pass their trigger element, so nested close can restore focus to the first focusable control instead. Propagate opener references and test Escape, scrim, and nested closes. |
| P2-17 | public/styles.css:2171 | **TRUE BUG / accessibility** | popup-card scrolls without overscroll-behavior contain, allowing scroll chaining to the page. Add containment while preserving internal scroll. |
| P2-18 | public/styles.css:2671-2677 | **TRUE BUG / reduced motion** | Auction timer transitions continue under prefers-reduced-motion. Disable the transition in the reduced-motion block and keep numeric updates readable. |
| P2-19 | public/main.js:214-227, :472-474 | **TRUE BUG / browser-dependent** | AudioContext is not explicitly resumed after a user gesture and music.play() rejection is swallowed, so the UI can report ON while playback is blocked. Add gesture unlock, media error state, and retry copy. |
| P2-20 | public/assets/audio/*.mp3, SOUND_TRACKS call sites | **TRUE BUG / performance and copy contract** | The active MP3 is about 12.3 MB and most advertised SFX have no call sites. Re-encode the approved track, wire state-delta cues, or narrow the preference copy. Per-theme music remains a future/intentional feature, not a current defect. |
| P2-21 | public/index.html:192,246,265,276,296,300,427,644 | **TRUE BUG / accessibility** | Inputs lack meaningful name, autocomplete, or inputmode attributes. Add them where semantics are known; keep room-code autocomplete disabled intentionally. |
| P2-22 | qa-artifacts/theme-comparison-1920.png | **TRUE BUG / evidence** | The file name claims 1920×1080 but the artifact is 1672×941. Recapture at native 1920×1080 and inspect the actual pixels. |
| P2-23 | public/assets/fonts/test, legacy board assets, public/assets/board-icons/index.html | **TRUE BUG / release hygiene; removal needs approval** | Unreferenced files remain web-addressable. Produce a reference report and move to dev-only/quarantine storage before any deletion. |
| P2-24 | public/index.html and route inventory | **MISSING FEATURE / USER INPUT REQUIRED** | No footer, privacy/terms/AUP/support/age/fictional-currency/Monopoly disclaimer surfaces exist. Legal copy and operator identity must be supplied before publishing promises. |
| P2-25 | README.md, package.json:4, font/audio notices | **MISSING FEATURE / USER INPUT REQUIRED** | package.json remains 0.0.0, there is no root LICENSE or changelog, and exact font licenses are not confirmed. Owner must choose release metadata and approve notices. |

## Intentional behavior and non-bugs

These findings were repeatedly reported as “missing” but match current product constraints:

- Guest play without an account is intentional; copy must say “no account required,” not imply that all server records stay local.
- Public room codes are omitted from some projections by design; private-code disclosure still needs a targeted privacy test.
- One pending table obligation per player is a rules constraint until product scope changes.
- Guest tab-restart limits and English-only UI are product scope decisions, not implementation defects.
- Cookie/CSRF findings do not apply to the current explicit Socket.IO bearer payload because no ambient cookies are used. Bearer theft and session lifetime remain real issues.
- Backups are opt-in through POORUP_BACKUP_DIR; making them mandatory is an operations decision, while checksum verification is a true bug.
- Analytics authorization requires the configured admin account and session header; current telemetry sanitization excludes account/session/password/private fields. Retention/disclosure remains a policy item.
- External DeepSeek AI is deterministic/no-egress when no provider key is configured. If a key is configured, disclosure and opt-out are policy requirements.
- Theme music selection, per-theme soundtrack packs, Wallet/Items, airports, predictions, and bank-account mutations are planned product work, not defects in the current playable ruleset.

## Resolved or stale findings

The following old claims are contradicted by current code or passing focused tests:

- URL-only horizontal-scale configuration is rejected; the adapter-mode false-positive guard remains conditional P0-1 above.
- Margin liquidation uses net equity including debt and collateral (server/marketExpansion.js:55-63, :492-496).
- Auctioned deeds do not retain duplicate ownership (server/auctionApi.js:194-200).
- Corrupt JSON, wrong root shapes, and store writes use the current storeIO.js:15-75 protections.
- Production origin configuration fails closed in server/serverConfig.js:34-47.
- /healthz, /readyz, maintenance/drain, graceful signals, Docker, PM2, deploy, and rollback artifacts exist.
- Room.ensureBots() clamps bot creation against available seats.
- Account IDs are owner-scoped in room projections.
- Permanent branch guardrails are documented for main, development, and testing.
- Old no-confirmation, Double GO, Quick Table, 404, health, and shutdown claims are stale where their focused audits now pass.

## Contradictions that must be corrected

- Home copy says v2.4.1 while package.json is 0.0.0.
- Home copy says FOUR SEATS while Metro supports up to six.
- README.md/SHOWCASE.md say “no accounts” even though optional accounts, sessions, social, history, seasons, and cosmetics exist.
- README.md omits rulesets, Metro 52, bots, events, loans, seasons, and advanced market controls.
- SHOWCASE.md says logic lives in gameLogic.js; current behavior is split across server modules.
- Instructions.md omits auctions, contracts, casino, market, events, bots, achievements, and seasons.
- .ulpi/design/DESIGN.md names poorup_tokens.css, which is absent.
- .ulpi/design/ACCOUNT-PROFILE.md claims expired sessions fail closed although session TTL is absent.
- .ulpi/design/HOME-PROFILE-REDESIGN.md references nonexistent profileViewState.
- .ulpi/design/NIGHT-SHIFT-MICROGAME-PLAN.md calls an unmounted debris asset active.
- .ulpi/design/FINAL-REVIEW.md references nonexistent REFERENCE_UI_ONLY.
- The 2026-09-13 branch/release plan has pre-execution SHA and unchecked-step language that should link to the completed deployment record.

## Decisions required before implementation

The following cannot be responsibly invented by an implementation agent:

1. Account deletion/export scope, retention periods, backup erasure, guest history treatment, and whether registration can remain enabled before erasure ships.
2. Authentication policy: bearer TTL versus HttpOnly cookies, password change/reset/recovery, cross-tab sign-out, and CSRF model if cookies are introduced.
3. Canonical production hostname, app indexing/noindex policy, sitemap policy, and public-room link rules.
4. Approved 1200×630 Open Graph/Twitter preview image, marketing description, favicon/touch-icon variants, and any public screenshots.
5. Operator/support identity, privacy/terms/AUP/age/fictional-currency/Monopoly disclaimer copy, and AI-provider disclosure/opt-out wording.
6. Option pricing, strike bands, exercise timing, and debt/collateral policy.
7. Real PostgreSQL/Redis adapter, credentials, and migration window before horizontal mode.
8. Proxy hop count, TLS termination, HSTS/COOP/CORP ownership, edge rate limits, Nest secrets, and uptime alert destination.
9. Exact font/audio/art licenses and approval to remove or quarantine unknown assets.
10. Release version, tag/changelog policy, and whether historical audit candidates should be archived or deleted.

## Plan-review addendum

A second implementation-planning review identified additional source areas that must be checked during the no-input tranche rather than silently omitted:

- per-socket broadcast failures, unhandled disconnect handling, and persistence rollback when an account mutation fails;
- auction bids after the deadline, bot bid timer rescheduling, duplicate asynchronous bot decisions, and mutations after game end;
- achievement and season split-write loss, oversized bot traces, match timestamp fallbacks, bounded match idempotency, season idempotency type mismatches, silent collection truncation, notification-map growth, and duplicate account handles;
- unsecured player-loan defaults, duplicate jail-free cards after deck reset, loan-backed cash entering margin/short/options, ruleset metadata resetting optional systems, loan repayment voiding auction bids, unrestricted human casino spins, disconnected-player anti-monopoly targeting, season mastery growth, missing fair-trade participant data, and any confirmed short borrow-fee/accounting mismatch.

These are **TRUE BUG candidates** until their characterization tests prove an intentional rule. They are assigned to the game-authority, persistence/privacy, or transport/runtime lanes in the implementation plan. The implementation agent must add a focused failing test before changing each one; an unconfirmed report is not a license to alter game behavior.

## Outcome

There are 20 high-severity true bugs or missing capabilities, 25 additional P2/P3 items, 10 outdated documents, and 2 deletion candidates requiring approval. The implementation plan saved beside this audit contains a no-input tranche that can start immediately and explicit gates for the policy and credential work. No existing Markdown file was deleted.
