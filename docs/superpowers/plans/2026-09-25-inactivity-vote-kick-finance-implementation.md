# Inactivity, Vote-Kick, Lobby, and Finance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. Run three disjoint implementation agents in parallel, all `gpt-6-luna` with `medium` reasoning. The primary agent owns worktree setup, integration, account-reset operations, visual review, and final verification.

**Goal:** Implement the approved inactivity/vote-kick, lobby, account-reset, collateral, and equity design while preserving Poorup's UI and server-authoritative game.

**Architecture:** Keep the vanilla client and modular-monolith server. The client observes local visibility/input transitions; the server owns deadlines, votes, escrow, equity contracts, and seat settlement. Extend existing room, loan, and sponsored-purchase flows.

**Tech Stack:** Node.js 22, vanilla HTML/CSS/ES modules, Socket.IO, existing JSON stores/adapters, Node tests, Playwright, dynamic inline SVG.

**Spec:** `docs/superpowers/specs/2026-09-25-inactivity-vote-kick-finance-release-design.md`

## Global Constraints

- Remove per-turn timers from new settings, runtime scheduling, and room snapshots.
- Hidden tab starts the 180-second inactivity deadline immediately; visible idle starts it after 30 seconds without pointer, keyboard, click, or touch input.
- Any supported activity or return to visible clears that player's deadline. Every seated human has independent presence; bots are exempt.
- Preserve the 120-second reconnect grace as a separate disconnect path.
- `docs/assets/countdown-ring-timer-concept.png` is the unchanged visual reference. Live value starts at `3:00`; the ring depletes clockwise.
- Preserve server authority, idempotency, atomic settlement, privacy, reconnect ownership, and account lifecycle cleanup.
- Preserve the Poorup pixel-parlor system, internal scrolling, visible focus, reduced motion, forced colors, and 200% zoom. No document/body scrolling.
- Keep historical ruleset/contract parsing while removing player-facing preset/override controls.
- Preserve unrelated dirty work; do not stage, reset, or overwrite files outside an agent's allowlist.
- Do not run the account purge until implementation checks, dry-run review, and maintenance/drain are complete.

## Review Focus

- Input/visibility race at inactivity expiry: latest valid server-ordered state wins and removal occurs once.
- Seat removal during purchase, payment, sponsorship, auction leadership, host ownership, or contracts settles every obligation once.
- Vote threshold at 3/4/5 human seats, target exclusion, reconnect/disconnect, abstentions, replay, and same-room rejoin lock.
- Pledged collateral during trade/mortgage/build/default and equity escrow during stale ownership/failure cannot duplicate or lose assets.
- Multiple inactive players have accurate countdowns; reconnect expiry remains distinct from inactivity.

---

## Execution Setup and Agent Boundaries

### Preflight: preserve current dirty work

The current `development` checkout has uncommitted bot/admin work, including overlapping paths such as `server/socketRuntime.js`, `server/serverSocketGame.js`, `server/gameLogic.js`, and `public/main.js`.

- [ ] Record `git status --short --branch`, `git diff --name-only`, and focused diffs for every overlap.
- [ ] Ask the user whether these changes become the implementation base or stay separate. Do not reset, stage, or rewrite them.
- [ ] Once the base is explicit, create isolated worktrees from approved `development`. No agent edits the shared dirty checkout.

### Parallel agents

Run these three agents in parallel only after preflight. Each uses model `gpt-6-luna`, reasoning `medium`.

| Agent | Owns | Does not edit |
|---|---|---|
| A — Room lifecycle/lobby backend | `server/playerPresence.js` (new), `server/roomVoteKick.js` (new), `server/socketRuntime.js`, `server/serverSocketGame.js`, `server/serverSocketAccount.js`, `server/rooms.js`, `server/roomSettings.js`, `server/rulesetRegistry.js`, `server/summaryApi.js`, `server/roomSetup.js`, room tests | Finance domain files and `public/**` |
| B — Finance/equity backend | `server/contractLogic.js`, `server/sponsorshipApi.js`, `server/propertyRules.js`, `server/tileApi.js`, `server/bankruptcyApi.js`, `server/gameLogic.js`, finance tests | Room presence/lobby files and `public/**` |
| C — UI/UX and browser QA | New `public/clientPlayerPresence.js`, `public/clientInactivityUi.js`, `public/clientVoteKickUi.js`; `public/index.html`, `public/styles.css`, `public/clientLobbyUi.js`, `public/clientSocialSurfaces.js`, `public/clientParlorBindings.js`, `public/clientTradeUi.js`, `public/clientStateSync.js`, client tests, `qa/inactivity-votekick.spec.js` | All `server/**` |

The primary agent is the UI design lead/integration owner. It wires clients through `public/main.js` only after reviewing its dirty diff, owns account reset and final verification, and resolves cross-lane interfaces. Account purge is never delegated.

### Skills by workstream

- Planning/execution: `superpowers:writing-plans`, `superpowers:subagent-driven-development`, `superpowers:dispatching-parallel-agents`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`.
- All code lanes: `.agents/skills/poorup-code-quality` for evidence, authority, cleanup, privacy, idempotency, and regression tests.
- UI lane: `.agents/skills/poorup-frontend`; `frontend-design`, `design-taste-frontend`, `impeccable`, `game-ui-ux`, `accessibility`, `web-design-guidelines`, `svg-design`, `pixel-art-sprites`, `design-motion-principles`, and `review-animations`.
- Server/account safety: `systematic-debugging`, `security-best-practices`, and one focused `code-architecture-review` at the settlement seam.
- Pixel Art Animator is unnecessary unless the ring becomes frame-based sprite animation; the planned ring is dynamic SVG.

## Cross-Lane Interfaces

- Client event `player-presence`: `{ state: 'active' | 'inactive', reason?: 'hidden' | 'idle' }`; no client deadline, coordinates, or key data.
- Public player presence: `{ state, inactiveSince, inactiveUntil }` for seated humans; timestamps are server-owned; no account IDs are added.
- Vote events: `room-votekick-start` with `{ targetPlayerId, requestId }`; `room-votekick-cast` with `{ voteId, choice: 'yes' | 'no', requestId }`.
- Public vote snapshot: `{ voteId, targetPlayerId, openedAt, expiresAt, eligibleCount, yesCount, noCount, requiredYes, status }`; never expose voter identities.
- `RoomManager.removeRoomSeat({ clientId, socketId, reason, preventRejoin })` reuses `releaseSeat`, is idempotent, and locks rejoin only for vote-kick until room end.
- Canonical collateral field: `collateralTileIndices: number[]`; legacy `collateralTileIndex` normalizes to one item.
- Equity purchase mode extends sponsorship with one investor, exact deed, reserved whole-dollar contribution, and passive share.

---

## Task 0 — Stabilize the Existing Server Wire Probe

**Owner:** Primary agent before parallel implementation. **Files:** Modify only `server/server.test.js` and `server/gameLogic.test.js`.

The clean full baseline once failed `bot probe human roll succeeds` and `bot turn advances through the normal seam`; two standalone runs passed. `GameState.sendRollerToJail()` correctly auto-advances after a third consecutive double, while the test currently assumes every successful roll ends in `awaitingEndTurn` and always sends `end-turn`.

- [ ] Keep the wire test exercising the real roll/socket path, but explicitly set the deterministic room options (`randomizePlayerOrder=false`, auctions/headlines/market/casino disabled).
- [ ] Attach the start-game and each roll/decline `update-state` listener before its corresponding socket emit so the probe inspects the transition it initiated.
- [ ] Handle both legal terminal states: normal human `awaitingEndTurn` (send `end-turn`) or three-doubles jail auto-advance (do not send `end-turn`; verify the bot is current).
- [ ] Add a deterministic `GameState` test with queued dice proving the third-double path auto-advances, so the wire-test alternative is pinned to the actual rule.
- [ ] Assert the bot status and reconnect behavior in either valid state; keep a hard loop bound and fail with the final authoritative snapshot details if the state is unresolved.
- [ ] Run the old test to capture the known red baseline evidence, then run `node server/server.test.js` repeatedly to verify the stabilized probe.
- [ ] Run full `npm test` after the fix; record any unrelated remaining baseline failures before launching feature agents.
- [ ] Commit this test-only stabilization separately before parallel feature work.

---

## Task 1 — Pure Presence and Vote Models

**Owner:** Agent A. **Files:** Create `server/playerPresence.js`, `server/playerPresence.test.js`, `server/roomVoteKick.js`, `server/roomVoteKick.test.js`.

**Interfaces:** `IDLE_INPUT_GRACE_MS = 30_000`; `PLAYER_INACTIVITY_REMOVAL_MS = 180_000`; `VOTE_KICK_DURATION_MS = 30_000`; `VOTE_KICK_COOLDOWN_MS = 60_000`; `markPlayerInactive(player,{reason,now})`; `markPlayerActive(player)`; `isPlayerPresenceExpired(player,now)`; `startRoomVoteKick({players,initiatorId,targetPlayerId,now,activeVote,cooldownUntil})`; `castRoomVoteKick({vote,voterId,choice,now})`.

- [ ] Add failing tests for transitions, deadline values, duplicate/stale events, bots, min-three voters, target exclusion, initiator auto-yes, strict majority, frozen electorate, one ballot, timeout/cooldown, and replay rejection.
- [ ] Run both test files and observe the intended RED failures.
- [ ] Implement pure policy functions without DOM/socket dependencies; rerun tests and `node --check`.
- [ ] Commit only new modules/tests in Agent A's worktree.

## Task 2 — Room Seat Cleanup, Presence Runtime, and Vote Sockets

**Owner:** Agent A. **Files:** `server/rooms.js`, `server/socketRuntime.js`, `server/serverSocketGame.js`, `server/serverSocketAccount.js`, `server/summaryApi.js`; add `server/roomPresenceRuntime.test.js` and `server/roomVoteKickRuntime.test.js`.

- [ ] Test independent timers for all human seats, bots excluded, stale socket rejection, active reset, 180-second expiry, 120-second reconnect separation, duplicate cleanup, pending obligations, host reassignment, and turn order.
- [ ] Add idempotent `RoomManager.removeRoomSeat`; reuse `releaseSeat`. Vote-kick blocks rejoin to the same active room; inactivity removal does not.
- [ ] Register/validate `player-presence`, timestamp deadlines server-side, and broadcast sanitized room state.
- [ ] Remove `turnTimers`, `scheduleTurnTimer`, `turnDeadline` writes, timeout callbacks, and all per-turn countdown behavior.
- [ ] Register vote start/cast with frozen eligible humans, one vote each, request IDs, 30-second expiry, 60-second initiator cooldown, and count-only snapshots.
- [ ] At inactivity expiry cancel obligations/refund escrow, settle pending payment by existing debt rules, reset auction lead, and release the seat once. Resolve a pending purchase using the configured pass/auction rule first; exclude the removed player from any resulting auction.
- [ ] Run the new tests, `node server/socketRuntime.test.js`, `node server/session-room-regressions.test.js`, `node server/rooms.test.js`, and `node server/room-host-lifecycle.test.js`.
- [ ] Commit only room lifecycle/socket paths and tests.

## Task 3 — Lobby Settings and Server-Owned Bot Roster

**Owner:** Agent A, after Task 2. **Files:** `server/roomSettings.js`, `server/rulesetRegistry.js`, `server/rooms.js`, `server/roomSetup.js`, `server/summaryApi.js`; add `server/lobbyBotRoster.test.js` and `server/roomSettings.test.js`.

- [ ] Test no `turnTimer` in new settings/snapshots, old historical snapshots remain readable, roster names remain stable, seats clamp to capacity.
- [ ] Remove `turnTimer` from live settings/defaults/override allowlists; preserve only historical values as read-only.
- [ ] Remove preset/override inputs for new rooms; use existing canonical default; preserve old-history parsing and admin historical filters.
- [ ] Add serializable `unlimited` sentinel; keep current house/hotel values and add houses 40/50/64/Unlimited and hotels 16/24/32/Unlimited.
- [ ] Implement curated room-unique bot names; preserve seats as count grows, remove highest-index unstarted bots when it shrinks, and keep names through game start.
- [ ] Run settings/roster tests, `node server/rulesetRegistry.test.js`, `node server/roomSetup.test.js`, and `node server/rooms.test.js`.
- [ ] Commit only server settings/roster/snapshot paths.

## Task 4 — Loan Interest and Multi-Deed Collateral

**Owner:** Agent B. **Files:** `server/contractLogic.js`, `server/propertyRules.js`, `server/tileApi.js`, `server/bankruptcyApi.js`; add `server/collateralBasket.test.js`. Agent A owns the shared `server/roomSetup.js` projection and adds the normalized collateral array there.

- [ ] Test valid basket, wrong owner, duplicates, mortgaged/developed/non-tradeable deeds, overlapping pledge, trade/build/mortgage conflicts, repayment release, and all-deed default.
- [ ] Normalize old singular collateral into unique `collateralTileIndices`; bound the list to the board's tile count, with a hard maximum of 52.
- [ ] Reserve each pledged deed from trade/build/mortgage/re-pledge while live; release all reservations on repayment/termination.
- [ ] On uncured default transfer every deed in the signed basket; partial repayment does not shrink it.
- [ ] Rename visible loan/hybrid “premium” to `TOTAL INTEREST`, preserve the one-time formula and legacy `premiumRate` wire/storage, and remove unimplemented repayment schedule fields only.
- [ ] Run the new test, `node server/contracts-market.test.js`, `node server/audit-property-loan.test.js`, and `node server/audit-game-contracts.test.js`; Agent A runs `node server/roomSetup.test.js` after its projection change.
- [ ] Commit only finance/settlement paths and tests.

## Task 5 — Equity-Backed Purchase Escrow

**Owner:** Agent B after Task 4. **Files:** `server/sponsorshipApi.js`, `server/contractLogic.js`, `server/gameLogic.js`; add `server/equityPurchase.test.js`.

- [ ] Test one investor, exact deed, escrow, share ceiling, gift-mode compatibility, cancellation, stale owner, disconnect, bankruptcy, duplicate acceptance, and injected failure rollback.
- [ ] Add an explicit equity-investment sponsorship mode without changing multi-sponsor gifts; equity mode allows one investor only.
- [ ] Validate price, buyer/investor funds, current bank-owned deed, live investor, passive share, and aggregate 100% cap.
- [ ] Atomically charge the bank, assign the deed, and create/materialize the passive share; rollback all effects on failure and refund once on cancellation/stale state.
- [ ] Use existing rent-share settlement; create no loan or repayment balance.
- [ ] Run the new test, `node server/sponsorship.test.js`, `node server/audit-game-contracts.test.js`, and relevant trades tests; commit only finance paths.

## Task 6 — Secondary Equity Transfer

**Owner:** Agent B after Task 5. **Files:** `server/contractLogic.js`, `server/tradeApi.js`; add `server/equityTransfer.test.js`. Agent A owns any required `server/roomSetup.js` projection changes.

**Interface:** `proposeEquityShareTransfer({fromPlayerId,toPlayerId,contractId,sharePct,price,requestId})`; accept/counter/cancel use existing stale-ID/replay protections.

- [ ] Test share ownership, partial amount, buyer payment, aggregate cap, expiry, bankruptcy, property restrictions, stale IDs, replay, cancellation, and rollback.
- [ ] Implement transfer validation and pending projection; atomically move payment and only the agreed share; preserve passive rights and remaining duration.
- [ ] Run the new test, `node server/trades.test.js`, `node server/matchHistorySchema.test.js`, and contract settlement tests; commit only transfer paths.

## Task 7 — Reference-Matched UI and Browser QA

**Owner:** Agent C. **Files:** Create `public/clientPlayerPresence.js`, `public/clientInactivityUi.js`, client tests, and `qa/inactivity-votekick.spec.js`; modify the allowed `public/` paths listed above.

### Timer reference

- [ ] Keep `docs/assets/countdown-ring-timer-concept.png` unchanged. No matching timer SVG currently exists.
- [ ] Build dynamic inline SVG/HTML matching its square dark-teal frame, inset, gold hairline/corner blocks, segmented gold ring/top gap, and cream pixel numerals. Start at `3:00`; deplete clockwise. Only the number/duration are intended differences from the static `2:00` PNG.
- [ ] Compare a cropped 1920×1080 timer capture against the PNG for frame proportions, pixel geometry, palette, segment spacing, number placement, and depletion direction.

### UI task steps

- [ ] Test hidden-tab immediate inactivity, visible 30-second input idle, pointer/keyboard/touch reset, multiple player clocks, server-time countdown, and teardown.
- [ ] Emit only coalesced `active`/`inactive` transitions; never send raw keys or pointer coordinates.
- [ ] Show every inactive clock by name in the sidebar and earliest deadline in the top-center ring for everyone; announce state transitions, not each second.
- [ ] Add vote action independent of social-account eligibility; show target, yes/no, progress, expiry, and in-game settlement consequence.
- [ ] Remove preset/override/bankruptcy rows and all turn controls; update Standard 40 copy, limit dropdowns, bot roster, total-interest labels, collateral accordion, and equity flows.
- [ ] Check keyboard/focus, preferred touch target size, reduced motion, forced colors, 200% zoom, and no document/body scroll.
- [ ] Run client unit tests and `npx playwright test -c qa/playwright.config.js qa/inactivity-votekick.spec.js`.
- [ ] Capture 1920×1080 first, then 1366×768, 1024×768, iPad landscape, and 390×844; commit only reviewed UI/assets/browser tests.

## Task 8 — Integration and Test Registration

**Owner:** Primary agent. **Files:** `public/main.js`, `package.json`. Server integrations stay with Agent A or B according to the file allowlist.

- [ ] Wire client modules into current SPA lifecycle; stop listeners/clocks on room exit/remount.
- [ ] Register tests in existing npm scripts without rewriting unrelated bot-campaign tests.
- [ ] Review every agent diff by allowlist; match event names, room snapshot fields, collateral normalization, and escrow terms.
- [ ] Run `node --check`, `git diff --check`, `npm run lint`, and `npm run lint:client`.

## Task 9 — All-Account Reset Tool and Dry-Run

**Owner:** Primary agent only. **Files:** Create `scripts/purge-all-account-data.mjs`, `scripts/purge-all-account-data.test.mjs`, `docs/ops/all-account-reset-runbook.md`.

- [ ] Make dry-run the default; require `--apply` plus exact confirmation for writes. Require resolved `POORUP_DATA_DIR`; fail closed on empty, root, repo, symlink-escape, or unexpected paths.
- [ ] Resolve stores through `resolveStorePaths()` / `resolveAuxiliaryStorePaths()`: accounts, sessions, social, matches, achievements, seasons, cosmetics, telemetry, analytics rollup, and backups. Preserve global AI-provider configuration.
- [ ] Remove account-linked rows; retain only aggregates verified non-identifying. Dry-run prints counts/paths, never usernames, IDs, credentials, recovery data, or private backup contents.
- [ ] Test only against temporary fixtures, including rollback after partial write.
- [ ] Run dry-run against local and Nest separately; review exact paths/counts and make no writes in this task.
- [ ] Verify the dry-run leaves every input file byte-identical and never prints account data.

## Task 10 — Full Verification and Independent Review

**Owner:** Primary agent, then one fresh sequential `gpt-6-luna` / medium reviewer.

- [ ] Run focused presence/vote, room/roster, collateral, equity purchase/transfer, account-store, and lifecycle tests.
- [ ] Run `npm run test:account`, `npm run test:timers`, `npm test`, `npm run lint`, and `npm run lint:client`.
- [ ] Run `npx playwright test -c qa/playwright.config.js qa/inactivity-votekick.spec.js`.
- [ ] Inspect the 1920×1080 timer against the PNG, then verify other viewports, reduced motion, forced colors, keyboard use, and 200% zoom.
- [ ] Reviewer runs `poorup-code-quality` on the full diff and a focused `poorup-frontend` review on rendered surfaces; fix actionable findings and rerun affected tests.
- [ ] Report code-test evidence separately from account-reset dry-run evidence. Do not promote to testing/main as part of this plan.

## Task 11 — Execute the Approved All-Account Reset

**Owner:** Primary agent only. This task is destructive and is separate from implementation/verification.

- [ ] Confirm the final dry-run targets/counts with the user. Do not infer a different Nest data or backup path.
- [ ] Put Nest in maintenance/drain mode; verify active rounds and account writes are zero. Stop local server writes for the local reset.
- [ ] Take the temporary restricted checkpoint, run `--apply` once per exact environment, and verify account-linked store/backup counts reach zero.
- [ ] If any store write fails, restore the checkpoint and stop rather than leaving a partial purge.
- [ ] After successful verification, delete the temporary checkpoint and all older backups containing the removed account records.
- [ ] Restore service. The owner creates the fresh account, updates `POORUP_ADMIN_ACCOUNT_IDS`, and verifies admin access.
- [ ] Record commands, counts, and outcome without including personal data. Do not push/deploy or promote branches in this task.

## Completion Gate

Complete only when active players have unlimited turn time, inactivity/vote-kick share safe seat cleanup, timer visuals match the PNG at 1920×1080, lobby/finance/equity paths have deterministic tests, account reset is verified in both environments, and the final review has no unresolved important findings. Begin implementation only after the user approves this plan and the dirty-worktree preflight is resolved.
