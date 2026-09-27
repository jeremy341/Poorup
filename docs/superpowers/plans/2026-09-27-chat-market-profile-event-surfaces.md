# Chat, Market, Profile, and Global Event Surfaces Implementation Plan

**Status:** Implemented, verified, and committed on `development`; push is the remaining integration step.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Each step uses checkbox (`- [x]`) syntax. Run only disjoint tasks in parallel; the owning controller reviews every result and performs the final integration.

**Goal:** Implement the user-approved Poorup surface improvements for Chat/Activity, bank and player financing, shared market history and Market Desk, Rankings/Profile history, and global-event announcements.

**Architecture:** Keep the vanilla client and server-authoritative GameState. Route conversation, activity, finance and analytics through their existing state owners; add a bounded live-room quote-history series for the existing shared market prices; use existing history projections and ECharts rather than new persistent data or a new chart dependency. UI changes preserve the Poorup pixel-parlor system and internal scrolling.

**Tech Stack:** Node.js 22, vanilla HTML/CSS/JavaScript, Socket.IO, existing ECharts 6.1.0, Node test files, Playwright browser QA.

**Spec:** `docs/superpowers/specs/2026-09-27-chat-market-profile-event-surfaces-design.md`

## Global Constraints

- Keep the after-hours pixel-parlor language, tokens, typography, geometry, gameplay behavior, and server authority intact.
- Keep the frontend vanilla HTML, CSS, and JavaScript; do not add a chart dependency.
- Keep `GameState` as market quote authority; the shared quote curve changes only through round drift and global-event effects, never player order impact.
- Keep market history live-match-only, bounded to 128 points, and absent from account/MatchStore history.
- Keep player-to-player offers off-turn while bank credit and market orders remain turn-gated.
- Preserve server-side active-seat, cash, ownership/collateral, replay, settlement, and single-open-obligation checks.
- Preserve existing owner/accepted-friend/public match-history redaction; never add chat or private bot reasoning to match records.
- Do not advertise Derivatives as usable until a production server-owned pricing policy exists.
- Never introduce document/body scrolling; overflow must be deliberate, keyboard-accessible, and internal.
- Target WCAG 2.2 AA: keyboard reachability, visible focus, 4.5:1 normal text contrast, 3:1 UI contrast, one meaningful live announcement, reduced motion, forced-colors and 200% zoom.
- For the rare event announcement, animate transform/opacity only; respect `prefers-reduced-motion` and do not block focus or game controls.
- Work only on `development`; do not promote to `testing` or `main` in this plan.
- Use GPT-6 Luna Medium for every implementation/review sub-agent, as required by the repository instructions.

## Review Focus

1. Duplicate activity when the same event is already in the room `game.feed` and is separately emitted as `system-message`; cover the same event being shown exactly once in `server/chat-activity-routing.test.js`.
2. Off-turn contract acceptance racing an obligation, balance, or seat change; cover accept/counter/revoke revalidation in `server/contracts-market.test.js` and `server/serverSocketGame.test.js`.
3. Market history mutability, legacy state without history, and round/event order; cover copy isolation, cap, missing-field compatibility, and post-event quotes in `server/marketQuoteHistory.test.js`.
4. A redacted/public or older match record accidentally reading owner-only fields in expanded history; cover viewer projections and absent fields in `server/matchHistoryAdapter.test.js` and `public/clientProfileSurfaces.test.js`.
5. A repeated event snapshot/reconnect replaying the announcement or stealing focus from an active vote; cover rerender, reconnect, voting, reduced-motion, and focus retention in `public/clientGlobalEventRender.test.js`.

---

## Parallel work rules

Use parallel GPT-6 Luna Medium implementers only for Task 1 (Chat/Activity), Task 2 (off-turn player contracts), and Task 3 (server quote history); their production/test allowlists below are disjoint. Wait for and review all three before starting client surfaces. Tasks 4–8 alter overlapping frontend integration/style surfaces and must run sequentially unless a later dispatch proves its allowlist is disjoint. No agent may change files outside its task allowlist, push, or promote branches. Every task is TDD (failing test first), committed locally on `development`, then reviewed by a fresh Luna Medium task reviewer before the next dependent task begins.

## Skills applied during implementation

- `$poorup-frontend`: preserve the vanilla visual system, inspect each incumbent component/state owner, reuse chart assets/engine, preserve focus and internal scrolling, and verify required viewports.
- `$poorup-code-quality`: protect server authority, active-seat/cash/ownership validation, idempotency, atomic settlement, and history privacy; every fix gets a public-boundary regression test.
- `game-ui-ux`: keep overlays anchored to the game surface, event-driven, non-blocking, keyboard usable, and responsive.
- `accessibility`: target WCAG 2.2 AA, one concise live announcement, keyboard/focus, contrast, 200% zoom, forced colors, and reduced motion.
- `design-motion-principles`: only the rare global-event ribbon receives motion; one-shot transform/opacity, no looping or keyboard-triggered motion, reduced-motion equivalent.
- `superpowers:test-driven-development` and `superpowers:systematic-debugging`: failing test before source changes; investigate root cause rather than patch symptoms.
- `superpowers:subagent-driven-development`: disjoint Luna Medium implementers and task reviewers; central integration/final review.
- `superpowers:verification-before-completion` and `frontend-design-review`: fresh test evidence plus one focused visual/accessibility/craft review before declaring completion.

## File ownership map

- Chat/activity/errors/scroll: `public/clientState.js`, `public/clientStateSync.js`, `public/clientStateSync.test.js`, `public/clientSocketListeners.js`, `public/clientChatView.js`, `public/main.js`, `public/clientRailEvents.js`, `public/clientAuctionUi.js`, `public/clientCasinoUi.js`, `public/clientDealUi.js`, `public/clientDeedDetailUi.js`, `public/clientGameModalsUi.js`, `public/clientLobbyUi.js`, `public/clientMarketUi.js`, `public/clientRoomsUi.js`, `public/clientSponsorshipUi.js`, `public/clientTradeUi.js`, `public/clientAccountIdentity.js`, `public/index.html`, `public/styles.css`, `server/serverSocketAccount.js`, `server/serverSocketGame.js`, `server/serverSocketGame.test.js`, `server/socketRuntime.js`, `server/socketHandlerSupport.js`. Final integration removes local success notices when the server game feed already records that action; unique equity-transfer notices remain.
- Player contracts: `server/contractLogic.js`, `server/contracts-market.test.js`, `server/equityTransfer.test.js`, and contract socket tests; do not change bank-loan or market turn guards. The separate equity-share transfer proposal follows the off-turn financing rule while preserving active-seat, ownership, funding, and obligation checks.
- Shared quote history: `server/gameLogic.js`, `server/marketLogic.js`, `server/economyApi.js`, `server/summaryApi.js`, new `server/marketQuoteHistory.test.js`.
- Bank offer dialog: `public/clientRailRender.js`, `public/clientRailEvents.js`, `public/clientBankLoanUi.js`, `public/clientSurfaces.js`, `public/index.html`, `public/styles.css`, `public/clientBankLoanUi.test.js`, and `public/clientSurfaceFocus.test.js`.
- Market desk: `server/economyApi.js` (viewer-private trade projection only), `server/marketViewerProjection.test.js`, `public/clientMarketUi.js`, `public/clientRailRender.js`, `public/clientRailEvents.js`, `public/clientStateSync.js`, `public/styles.css`, new `public/clientMarketUi.test.js`.
- Rankings and season: `public/clientSocialSurfaces.js`, `public/styles.css`, new `public/clientSocialSurfaces.test.js`; retain the existing arrow-based metric carousel and its keyboard behavior. Shared player-history cards show NOT RECORDED for absent legacy fields.
- Profile statistics/history: `public/clientProfileRender.js`, `public/clientProfileBindings.js`, `public/clientSocialSurfaces.js`, `public/styles.css`, `server/matchStore.js` (preserve owner-record field absence only for displayed legacy fields), `server/roomSetup.js` (preserve absence in safe shared projections), `server/accountStore.js` (retain existing public-summary `roundCount: 0` fallback), extend `server/match-history-schema.test.js`, `server/roomSetup.test.js`, `server/gameLogic.test.js`, and existing persistence characterization, and the Profile/social surface tests.
- Global-event banner: `public/clientGlobalEventRender.js`, `public/clientState.js` (`lastAnnouncedGlobalEventKey` reset on room change/new game), `public/index.html`, `public/styles.css`, new `public/clientGlobalEventRender.test.js`.
- Test command registration: `package.json` is owned by the final integration task only; earlier tasks run new tests directly with `node`.

## Task 1: Chat, Activity/Log, action errors, and reading position

**Files:**
- Modify: `public/clientState.js`, `public/clientStateSync.js`, `public/clientSocketListeners.js`, `public/clientChatView.js`, `public/main.js`, `public/clientRailEvents.js`, `public/clientAuctionUi.js`, `public/clientCasinoUi.js`, `public/clientDealUi.js`, `public/clientDeedDetailUi.js`, `public/clientGameModalsUi.js`, `public/clientLobbyUi.js`, `public/clientMarketUi.js`, `public/clientRoomsUi.js`, `public/clientSponsorshipUi.js`, `public/clientTradeUi.js`, `public/clientAccountIdentity.js`, `public/index.html`, `public/styles.css`, and only proven redundant emitters in `server/serverSocketAccount.js`, `server/serverSocketGame.js`, `server/socketRuntime.js`, or `server/socketHandlerSupport.js`.
- Modify only if duplicate emission is confirmed: `server/serverSocketAccount.js`, `server/serverSocketGame.js`, `server/socketRuntime.js`, `server/socketHandlerSupport.js`.
- Create: `public/clientChatActivity.test.js`, `public/clientChatScroll.test.js`, `server/chat-activity-routing.test.js`.
- Extend: `public/clientStateSync.test.js`, `server/serverSocketGame.test.js`.
- Test: `server/serverSocketAccount.test.js`, `server/socketRuntime.test.js`, `public/clientResponsiveA11y.test.js`.

**Interfaces:**
- Consumes: `state.messages`, `state.log`, `game.feed`, existing `system-message` and `chat-message` socket events, `#tn-online`, `#error-announcer`.
- Produces: `state.activityNotices: Array<{id:string,text:string,timestamp:number}>` for lifecycle-only socket announcements; `syncLog(game)` in `public/clientStateSync.js` projects notices with `game.feed` into `state.log`, newest first, and room changes clear stale notices. `getChatRenderPlan({isFirstRender,isNearBottom,roomChanged,hasNewMessages}) -> {updateContent,followBottom,showNewMessages}` in `public/clientChatView.js` ensures an off-bottom reader's DOM rows stay mounted during the 60-message rollover. Existing human/bot chat line shape and sender attribution stay unchanged. A reusable `host.announceActionStatus(message, statusNode)` hook is owned by the client shell; each action passes its originating status node.

- [x] **Step 1: Add failing chat/activity tests.** In `public/clientChatActivity.test.js`, add named cases `removesGenericStartupChatLines`, `keepsHumanAndIntentionalBotMessagesWithSender`, `routesBotDiagnosticsAndConnectionChangesOutOfChat`, and `nonConversationClientNoticesNeverEnterChat`. In `public/clientStateSync.test.js`, add `activityNoticesSurviveGameSnapshotAndResetOnRoomChange`. Add emitter-specific socket regressions: `freshJoinUsesFeedOnlyAndReconnectKeepsOneNotice`, `leaveRoomUsesFeedOnceInStartedGameAndNoticeInLobby`, `gameStartAppearsOnceInFeed`, `rollAuctionStartAppearsOnceInFeedAndStillSchedulesFinish`, `casinoSettlementAppearsOnceInFeed`, `declinedAuctionStartUsesFeedOnly`, `passedVoteKickProducesOneRemovalNotice`, and `auctionExpiryUsesSpecificFeedResultOnly`. Keep room-created, reconnect, invite-provenance, jail instruction, auction-lead-reset, sponsorship release, and obligation-cancel notices that have no same-event feed or provide unique context. In `server/chat-activity-routing.test.js`, add `lifecycleNoticesReachActivityAndFeedBackedNoticesAreNotEmittedTwice`.
- [x] **Step 2: Run the tests to observe the expected failure.**

Run: `node public/clientChatActivity.test.js && node public/clientStateSync.test.js && node server/chat-activity-routing.test.js && node server/serverSocketGame.test.js`

Expected: FAIL only on the currently mixed presentation/routing behaviors, not on harness/import errors.

- [x] **Step 3: Implement source classification.** Keep the existing `chat-message` contract for conversation. Add `state.activityNotices` and `host.recordActivity(text)` in the existing client state/socket integration; merge notices with `game.feed` inside `syncLog(game)` so snapshots cannot erase them. Classify by event/action source, never by regex or English copy in `say()`. Remove only server emissions whose fact is already represented by an authoritative feed event, retaining lifecycle/system notices with unique provenance or no feed equivalent; specifically preserve lobby leave notices and invited-join provenance. Do not deduplicate by comparing English text. Clear notices when the client changes rooms. Remove the two seeded generic lines and bot decision text from Chat; keep connection status in the header.
- [x] **Step 4: Add failing action-error and scroll tests.** In `public/clientChatScroll.test.js`, add named cases `preservesReaderOffsetWhenScrolledUp`, `followsReaderWhenNearBottom`, `showsNewMessageAffordanceWithoutTakingFocus`, and `boundedChatRolloverDefersRenderPreservingAnchor` using 60 existing messages plus a 61st while the reader is off-bottom. In `public/clientActionErrorNotice.test.js`, add `keepsRejectionBesideActionAndAnnouncesOnceWithoutChatLine` and `eachSubmittingControlProvidesItsOwnStatusNode`.
- [x] **Step 5: Run and observe expected failures.**

Run: `node public/clientChatScroll.test.js`

Expected: FAIL on unconditional bottom-scroll/error-to-chat behavior only.

- [x] **Step 6: Implement action notices and the scroll policy.** Add one canonical hook `host.announceActionStatus(message, statusNode)` from the client shell; each affected action owner captures its submitting control and passes an adjacent status node, while the hook updates `#error-announcer` once. Route home/account background notices through their existing surface-notice path, not the game Activity log. Do not also send the same error through Chat or an unlabelled duplicate toast. Implement `getChatRenderPlan({isFirstRender,isNearBottom,roomChanged,hasNewMessages})` in `public/clientChatView.js`; in `renderChat`, if the reader is off-bottom, leave the current message DOM untouched and show the focus-neutral new-message button when the latest message changed. Re-render and follow only when the reader returns within 32 CSS pixels of the bottom, clicks the button, or changes rooms.
- [x] **Step 7: Verify the task.**

Run: `node public/clientChatActivity.test.js && node public/clientChatScroll.test.js && node public/clientActionErrorNotice.test.js && node public/clientStateSync.test.js && node server/chat-activity-routing.test.js && node server/serverSocketAccount.test.js && node server/serverSocketGame.test.js && node server/socketRuntime.test.js && node public/clientResponsiveA11y.test.js`

Expected: all targeted tests pass; no chat announcements are duplicated or dropped.

- [x] **Step 8: Commit.** `git add` only Task 1 files and commit `fix: separate chat from game activity`.

## Task 2: Allow player-to-player offers off-turn

**Files:**
- Modify: `server/contractLogic.js`, `server/contracts-market.test.js`, `server/equityTransfer.test.js`.
- Create: `server/contractCancelOffTurn.test.js`.
- Test: `server/trades.test.js`, `server/serverSocketGame.test.js`.

**Interfaces:**
- Consumes: current `contractProposalRejection` guard order, `contractProposalRejectionWithoutTurn`, `tradeApi` no-turn behavior, pending obligation fields.
- Produces: initial active-player financing and equity-share transfer proposals may originate off-turn; existing accept/counter/adjust/revoke methods remain turn-independent and server-revalidated; no bank or market guard changes.

- [x] **Step 1: Change/add tests first.** In `server/contracts-market.test.js`, add named cases `playerContractProposalCanBeCreatedOffTurn`, `offTurnContractResponsesSurviveTurnChanges`, and `offTurnProposalRetainsActiveSeatFundingAndObligationGuards`; assert both inactive sender and recipient remain blocked. Replace the old test expecting an off-turn proposal rejection with off-turn proposal success. Assert insufficient/loan-backed funds, another open obligation, invalid collateral, and invalid settlement still reject. In `server/contractCancelOffTurn.test.js`, add `senderCanCancelPendingPlayerContractOffTurn` using `registerGameSocketHandlers`, changing `currentPlayerId` before the sender cancels and asserting the offer clears once. In `server/equityTransfer.test.js`, add `equityShareTransferProposalCanBeMadeOffTurn` while retaining seller ownership, active seats, funding and obligation checks.
- [x] **Step 2: Run focused test to observe expected failure.**

Run: `node server/contracts-market.test.js && node server/contractCancelOffTurn.test.js`

Expected: FAIL at the current turn-only proposal guard; all other guard-order assertions remain meaningful.

- [x] **Step 3: Remove only the initial contract current-turn rejection.** Preserve guard precedence for active pair, one-open-obligation, lender funding, loan-backed cash, collateral and accept-time settlement.
- [x] **Step 4: Verify.**

Run: `node server/contracts-market.test.js && node server/contractCancelOffTurn.test.js && node server/trades.test.js && node server/serverSocketGame.test.js`

Expected: off-turn P2P offers work and all existing active-seat, obligation, replay, cash, deed and settlement tests pass; bank credit/market remain turn-gated.

- [x] **Step 5: Commit.** `git add server/contractLogic.js server/contracts-market.test.js` and commit `fix: allow player contracts off turn`.

## Task 3: Bounded shared market quote history

**Files:**
- Modify: `server/gameLogic.js`, `server/marketLogic.js`, `server/economyApi.js`, `server/summaryApi.js`.
- Create: `server/marketQuoteHistory.test.js`.
- Test: `server/contracts-market.test.js`, `server/global-events.test.js`, `server/marketExpansion.test.js`.

**Interfaces:**
- Consumes: `freshMarketQuotes()`, `advanceMarket(game)`, existing `marketSnapshot(game, player)` and `summaryEconomy()`.
- Produces: `game.marketQuoteHistory: Array<{round:number, quotes:Record<MarketInstrumentId,number>, eventId:string|null}>`, capped at 128; `market.quoteHistory` in both economy and room snapshots, cloned and validated per caller.

- [x] **Step 1: Write failing server tests.** In `server/marketQuoteHistory.test.js`, add named cases `seedsSharedRoundZeroBaseline`, `appendsExactlyOnceAfterEachEnabledMarketRound`, `capsHistoryAt128Points`, `capturesPostShockQuotesAndOnlyActiveEventId`, `disabledMarketDoesNotAppend`, `snapshotsCloneHistoryForEverySeat`, `legacyMissingHistoryFallsBackSafely`, and `marketOrdersDoNotMutateSharedQuotesOrHistory`. Cover canonical IDs and positive integer quote validation as part of the helper tests.
- [x] **Step 2: Run to observe expected failures.**

Run: `node server/marketQuoteHistory.test.js`

Expected: FAIL because `marketQuoteHistory` is not currently present in GameState or snapshots.

- [x] **Step 3: Initialize and reset the history with fresh game state.** Add a baseline point from initial quotes in both initialization/reset paths.
- [x] **Step 4: Append a safe point after each market-enabled quote update.** Add only one point after drift and the event shock have both resolved; set `eventId` only for an active event; cap newest history at 128; do not alter drift, fee, or event multiplier rules.
- [x] **Step 5: Add a single snapshot projection helper and expose it in both snapshot APIs.** Return fresh arrays and fresh quote objects; malformed/legacy absent history falls back safely to the current baseline.
- [x] **Step 6: Verify.**

Run: `node server/marketQuoteHistory.test.js && node server/contracts-market.test.js && node server/global-events.test.js && node server/marketExpansion.test.js`

Expected: bounded, copied history passes without changing any order quote or match persistence.

- [x] **Step 7: Commit.** `git add server/gameLogic.js server/marketLogic.js server/economyApi.js server/summaryApi.js server/marketQuoteHistory.test.js` and commit `feat: expose shared market quote history`.

## Task 4: Bank-credit confirmation modal and unavailable reasons

**Files:**
- Modify: `public/clientRailRender.js`, `public/clientRailEvents.js`, `public/clientBankLoanUi.js`, `public/clientSurfaces.js`, `public/index.html`, `public/styles.css`, `public/main.js` only for wiring.
- Create: `public/clientBankLoanUi.test.js`.
- Test: `server/gameLogic.test.js`, `server/casino-bankruptcy.test.js`, `public/clientSurfaceFocus.test.js`.

**Interfaces:**
- Consumes: server `bankLoanOffer` snapshot `{available,reason}` or `{principal,totalDue,premium,dueRound,cureRound,collateralTileIndex,collateralName,severity}`, and existing bank-loan accept event/ack.
- Produces: finance rail summary remains; its button opens a focus-managed confirmation dialog; confirmation reuses existing accept command and server revalidation; unavailable state shows exact server reason inline.

- [x] **Step 1: Add failing UI contract tests.** In `public/clientBankLoanUi.test.js`, add named cases `offerButtonOpensConfirmationWithCurrentTerms`, `unavailableOfferShowsServerReason`, `cancelRestoresFocusToRailTrigger`, `staleTermsAreRevalidatedByServer`, `confirmUsesExistingIdempotentAcceptEvent`, and `rejectionAppearsBesideDialogActionAndAnnouncesOnce`. Cover each displayed term and both default consequences.
- [x] **Step 2: Run to observe expected failures.**

Run: `node public/clientBankLoanUi.test.js`

Expected: FAIL because the current rail action is inline and not a confirmation dialog.

- [x] **Step 3: Implement one bank-offer dialog controller in `public/clientBankLoanUi.js`; reuse existing Poorup surface/focus helpers.** Register `#bank-loan-modal` in `SURFACE_SELECTORS` and `GAME_POPUP`. Wire `data-bank-offer-open` to open the dialog and `data-bank-offer-confirm` to the existing `take-bank-loan` command. Exact default copy: secured collateral is seized by the bank after cure; unsecured default triggers collection/debt settlement under current server rules.
- [x] **Step 4: Preserve current server acceptance/eligibility checks.** Do not loosen bank-loan turn/cash/event/pending-obligation rules.
- [x] **Step 5: Verify.**

Run: `node public/clientBankLoanUi.test.js && node server/gameLogic.test.js && node server/casino-bankruptcy.test.js && node public/clientSurfaceFocus.test.js && node public/clientResponsiveA11y.test.js`

Expected: dialog provides a deliberate confirm/cancel path, reasons are legible, server terms remain authoritative, and focus returns to its trigger.

- [x] **Step 6: Commit.** Commit only Task 4 paths as `feat: confirm emergency bank credit terms`.

## Task 5: Market Desk, order preview, shared chart, and Derivatives gating

**Files:**
- Modify: `server/economyApi.js` (add a viewer-filtered private trade projection only), `public/clientMarketUi.js`, `public/clientRailRender.js`, `public/clientRailEvents.js`, `public/clientStateSync.js`, `public/styles.css`, and existing chart adapter only if it cannot support this series.
- Create: `public/clientMarketUi.test.js`.
- Create: `server/marketViewerProjection.test.js`.
- Test: `server/contracts-market.test.js`, `server/marketExpansion.test.js`, `public/clientAnalyticsCharts.test.js`, `public/clientResponsiveA11y.test.js`.

**Interfaces:**
- Consumes: Task 3 `market.quoteHistory`, shared `market.quotes`, the viewer's own `positions`, `market.personalTrades` projected from only that viewer's market-ledger rows, and current fee/complexity fields.
- Produces: one Market Desk selecting an instrument; server-consistent buy/sell preview; shared quote line/event markers; only the current viewer's own order markers; accessible textual/table data alternative.

- [x] **Step 1: Write failing projection and UI tests.** In `server/marketViewerProjection.test.js`, add `personalTradesAreFilteredAndMinimallyProjectedPerViewer`: seat A receives only its own recent rows and no `playerId`, `transactionId`, or timestamp; seat B receives only B's. In `public/clientMarketUi.test.js`, add named cases `selectedIndexUsesSharedQuotesAndHistory`, `buyAndSellPreviewMatchesServerFeeRounding`, `tradeMarkersUseOnlyViewerLedger`, `derivativesControlsAreUnavailableWithoutServerPolicy`, and `chartHandlesEmptyStateResizeAndClose`. Verify fee matches `max(1, ceil(gross * 0.02))`; buy total is gross+fee and sell proceeds gross-fee.
- [x] **Step 2: Run to observe expected failures.**

Run: `node server/marketViewerProjection.test.js && node public/clientMarketUi.test.js`

Expected: FAIL on absent history graph/basic controls/accurate action preview and Derivatives gating.

- [x] **Step 3: Add only the viewer-private trade projection to `marketSnapshot(game, player)`.** Filter existing `game.marketLedger` by that player, cap to the viewer's most recent 128 entries, and expose only `{roundNumber,instrumentId,side,quantity,quote,fee}`. Do not include this field in `summaryEconomy()` or MatchStore.
- [x] **Step 4: Consolidate the rail and modal into one selected-index Market Desk.** Show quote/history, held units/cost basis, simple Buy/Sell, exact fee and total, risk/eligibility copy, and progressive disclosure only for configured margin/shorting.
- [x] **Step 5: Reuse ECharts 6.1.0 adapter patterns.** Label round and currency axes, mark active event points and the viewer's own buy/sell actions from `market.personalTrades`, provide a text/table alternative, dispose chart on close and preserve focus.
- [x] **Step 6: Hide or show a clearly unavailable Derivatives state when no server pricing policy exists.** Do not send a knowingly failing option order.
- [x] **Step 7: Verify.**

Run: `node server/marketViewerProjection.test.js && node public/clientMarketUi.test.js && node public/clientAnalyticsCharts.test.js && node server/contracts-market.test.js && node server/marketExpansion.test.js && node public/clientResponsiveA11y.test.js`

Expected: quote/history are shared, personal positions remain private, preview parity is exact, and chart lifecycle/accessibility contracts pass.

- [x] **Step 8: Commit.** Commit only Task 5 paths as `feat: build a clear market desk`.

## Task 6: Compact Season guest state (preserve Rankings arrows)

**Files:**
- Modify: `public/clientSocialSurfaces.js`, `public/styles.css` only; no change to the existing arrow selector/bindings.
- Create: `public/clientSocialSurfaces.test.js`.
- Test: `server/leaderboard.test.js`, `server/seasonModule.test.js`, `public/clientResponsiveA11y.test.js`.

**Interfaces:**
- Consumes: existing `RANKING_LABELS`, `RANKING_ORDER`, scope state, metric snapshots, player search, Season API state.
- Produces: unchanged arrow-based metric selection and existing 4 scopes/search/ranking rules; one guest sign-in CTA for all Season rewards.

- [x] **Step 1: Add failing render/interaction tests.** In `public/clientSocialSurfaces.test.js`, assert the existing arrow selector and metric snapshots, `rankingScopesAndSearchRemainAvailable`, keyboard-accessible Previous/Next controls, `seasonGuestSeesExactlyOneSignInCta`, and `seasonLoadingErrorEmptyAndStaleStatesRemainUseful`.
- [x] **Step 2: Run to observe expected failures.**

Run: `node public/clientSocialSurfaces.test.js`

Expected: FAIL because Season repeats the guest CTA; arrow navigation remains present.

- [x] **Step 3: Preserve the existing arrow metric carousel unchanged.** Do not replace it with named families.
- [x] **Step 4: Implement one guest sign-in prompt.** Keep reward tiers/thresholds visible without repeating disabled buttons.
- [x] **Step 5: Verify.**

Run: `node public/clientSocialSurfaces.test.js && node server/leaderboard.test.js && node server/seasonModule.test.js && node public/clientResponsiveA11y.test.js`

Expected: no ranking semantics change; guest CTA count is exactly one; keyboard and internal-scroll tests pass.

- [x] **Step 6: Commit.** Commit only Task 6 paths as `feat: clarify rankings navigation`.

## Task 7: Profile Statistics and expandable match details

**Files:**
- Modify: `public/clientProfileRender.js`, `public/clientProfileBindings.js`, `public/clientSocialSurfaces.js`, `public/styles.css`, `server/matchStore.js` (preserve source field presence for displayed fields only), `server/roomSetup.js` (safe sparse shared-history projection), and `server/accountStore.js` (keep public summary defaults stable).
- Create: `public/clientProfileSurfaces.test.js`.
- Test: `server/match-history-schema.test.js` sparse legacy regression, `server/gameLogic.test.js` golden for malformed/incomplete legacy records, and `server/persistence.test.js` public summary compatibility.
- Test: `server/roomSetup.test.js`, `server/matchHistoryAdapter.test.js`, `server/rooms.test.js`, `server/leaderboard.test.js`, and `public/clientSocialSurfaces.test.js`.

**Interfaces:**
- Consumes: `accountHistoryList`, current Profile Statistics/History surfaces, owner detailed history, existing viewer-scoped match summaries.
- Produces: compact overview + Results/Economy/Deals & Events internal tabs; truthful categorical recent-result strip/table; match-row expand controls with Summary/Players/Economy & Deals/Events details using only authorized fields.

- [x] **Step 1: Add failing profile surface tests.** In `public/clientProfileSurfaces.test.js`, add named cases `statisticsUseCompactOverviewAndInternalTabs`, `recentResultsAreCategoricalAndTruthful`, `historyRowsExpandWithAccessibleControlsAndRestoreFocus`, `legacyMissingFieldsRenderNotRecorded`, `redactedHistoryCannotRenderPrivateFields`, `legacyRowsDoNotInventDateDeedOrEventCounts`, `scrollableDefaultResultsPanelIsKeyboardFocusable`, and `historyToggleKeepsMatchContextInAccessibleName`. In `server/match-history-schema.test.js`, add `sparseLegacyMatchPreservesDisplayedFieldAbsence`. Cover guest/signed-in/empty/older records and ensure redacted projections cannot render private cash, financial results, contract terms or bot decisions.
- [x] **Step 2: Run to observe expected failures.**

Run: `node public/clientProfileSurfaces.test.js`

Expected: FAIL on current KPI wall/static rows and untruthful bar encoding.

- [x] **Step 3: Replace the 12-box wall with the compact overview and internal tabs.** Reuse existing values/calculations; do not change ranking/stat formulas or invent data.
- [x] **Step 4: Implement accessible expandable detail rows and honest shared history.** Use stable `matchId`, native buttons, `aria-expanded`/`aria-controls`, preserve focus/scroll on collapse, and render fields only from the current authorized record projection. In `sanitizeMatch`, preserve absence (rather than coercing to zero/empty/current-date) only for source-missing fields rendered by Profile, including participant `endingCash`/`propertyCount` and nested casino `net`; explicit zero/empty values remain explicit. Make the safe shared projection tolerate an absent participant list, and show NOT RECORDED (not zero/ROUND COMPLETE) for missing public/friend history fields. Do not change unrelated participant defaults or expose sensitive field values.
- [x] **Step 5: Verify.**

Run: `node public/clientProfileSurfaces.test.js && node server/match-history-schema.test.js && node server/matchHistoryAdapter.test.js && node server/rooms.test.js && node server/leaderboard.test.js && node public/clientResponsiveA11y.test.js`

Expected: privacy tests remain unchanged/green; no timeline or private payload is introduced; page scrolling is not introduced.

- [x] **Step 6: Commit.** Commit only Task 7 paths as `feat: simplify profile statistics and history`.

## Task 8: One-time Global Event ribbon and persistent banner

**Files:**
- Modify: `public/clientGlobalEventRender.js`, `public/clientState.js`, `public/index.html`, `public/styles.css`.
- Create: `public/clientGlobalEventRender.test.js`.
- Test: `server/global-events.test.js`, `public/clientInteractionRegression.test.js`, `public/clientResponsiveA11y.test.js`.

**Interfaces:**
- Consumes: `state.globalEvent`, phases `voting`/`warning`/`active`/`recovery`, existing persistent compact toggle and choice focus restoration.
- Produces: separate one-time announcement ribbon keyed to room/event identity and first-observed voting/warning phase; persistent expandable/collapsible banner; one concise live status announcement.

- [x] **Step 1: Add failing event UI tests.** In `public/clientGlobalEventRender.test.js`, add named cases `announcesFirstObservedVotingOrWarningEventOnce`, `repeatRenderAndReconnectDoNotReplayAnnouncement`, `newEventIdentityAnnouncesAgain`, `activeAndRecoveryTransitionsDoNotReplay`, `votingAndCollapseRemainOperable`, `reducedMotionRendersStaticEquivalent`, and `announcementDoesNotCoverHeaderBoardOrActions`.
- [x] **Step 2: Run to observe expected failures.**

Run: `node public/clientGlobalEventRender.test.js`

Expected: FAIL because no one-time ribbon/deduped announcement lifecycle exists.

- [x] **Step 3: Implement client-session deduplication.** Store the key as `state.lastAnnouncedGlobalEventKey = roomCode + event.id + (event.startedRound ?? event.voteRound)`; trigger only when first observed phase is `voting` or `warning`; reset the key on room change/new game; do not replay on repeated snapshot/reconnect or animate later active/recovery transitions.
- [x] **Step 4: Add the non-modal red translucent ribbon and persistent top banner state.** Re-anchor the persistent banner to a stable top-center slot below the fixed game header without changing document layout or creating page scroll. Let the first ribbon sit over a reserved game-field layer, then resolve to the persistent banner. Animate only transform/opacity with small tilt/settle, no looping/pulse/focus trap; collapsed state retains title and rounds; vote controls stay usable. Under `prefers-reduced-motion`, render the same end state without motion; forced colors use solid high-contrast borders/text.
- [x] **Step 5: Verify.**

Run: `node public/clientGlobalEventRender.test.js && node server/global-events.test.js && node public/clientInteractionRegression.test.js && node public/clientResponsiveA11y.test.js`

Expected: one announcement per newly observed event, no focus/control occlusion, existing event rules/votes unchanged.

- [x] **Step 6: Commit.** Commit only Task 8 paths as `feat: announce global events clearly`.

## Task 9: Integration, test registration, browser QA, and final review

**Files:**
- Modify: `package.json` only to register new tests; only docs covered by the plan/spec if status or evidence needs updating.
- Test: new files from Tasks 1–8; relevant existing suites; browser captures.

**Interfaces:** consumes all task contracts above; produces a coherent implementation on `development` with full verification evidence.

- [x] **Step 1: Register new targeted tests in `package.json` and verify commands.** Keep focused test scripts runnable by direct `node` commands as well.
- [x] **Step 2: Run focused integration suite with a bounded bot safety sample.** This scope does not change bot policy or balance; the repository default launches 1,000 seeded bot matches.

Run: `$env:POORUP_BOT_SIMULATION_COUNT='10'; npm test`

Expected: all server and client tests, including every new regression test, pass; 10 bot safety simulations complete with zero stalls. This is not balance evidence.

- [x] **Step 3: Run audit, accessibility and lint gates.**

Run: `npm run test:audit && npm run test:inactivity && npm run lint && npm run lint:client`

Expected: exit code 0; document any pre-existing issue separately instead of hiding it.

- [x] **Step 4: Run browser QA and inspect captures.**

Run: `npm run test:browser`

Expected: no page/body scrolling; Chat/Log/Finance/Market/Rankings/Profile/Event fit and remain operable at 1920×1080, 1366×768, 1024×768, iPad landscape, and 390×844; keyboard, 200% zoom, reduced motion, forced colors, focus and modal layering verified. Evidence screenshots are under `qa-artifacts/release-surfaces-2026-09-27/` for home, Rankings/Season, Profile statistics/history detail, Market Desk/order controls, Global Event announcement/persistent states, and existing core game modal states.

- [x] **Step 5: Inspect final diff and run a fresh whole-suite verification.** Confirm only spec scope and no account data or unrelated UI files changed. Run `$env:POORUP_BOT_SIMULATION_COUNT='10'; npm run test:full` after the final fixes; this remains a safety smoke, not balance evidence.
- [x] **Step 6: Fresh whole-branch review.** Dispatch a GPT-6 Luna Medium code reviewer with the exact diff/spec/plan; fix Critical/Important findings test-first and rerun verification. Record deferred minor findings.
- [x] **Step 7: Commit integration changes to `development`.** Do not merge/promote to `testing` or `main` under this plan. Pause before pushing if the final diff or any shared-branch state differs from what the user reviewed.

## Execution recommendation

Use subagent-driven development with 3 parallel Luna Medium implementers for Tasks 1–3, which have disjoint paths. After those are reviewed, run Tasks 4–8 sequentially to avoid collisions in shared `public/styles.css`, rail owners, and view bindings. Keep Task 9 centralized. The UI/backend scope is broad, but this sequencing preserves fast parallelism where safe and gives every user-visible slice its own TDD/review gate.
