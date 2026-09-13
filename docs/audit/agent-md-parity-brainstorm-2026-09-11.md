# Poorup Markdown / README feature-parity audit — 2026-09-11

## Scope and method

Audited the 54 working-tree Markdown/README files (51 tracked plus three
same-day agent reports), current `server/`, `public/`, and `qa/` source/tests on
`codex/theme-reset` (`5d22d54`). The review used the available QA-agent-testing,
agentic-eval, systematic-debugging, code-architecture-review, and
software-architecture-design guidance. Claims below are evidence-led: a plan is
not treated as implementation merely because its header says “implemented”.

Focused checks run:

- `npm run lint` — PASS.
- `npm run lint:client` — PASS.
- `node server/rulesetRegistry.test.js` — 18 passed.
- `node server/marketExpansion.test.js` — 12 passed.
- `node server/global-events.test.js` — 22 passed.
- `node public/clientTheme.test.js` — 6 passed.
- `node public/themeAssetAudit.test.js` — 31 passed.
- `node public/clientUxContracts.test.js` — 6 passed.

The full `npm test` command was started but stopped during the long bot portion
at the parent agent’s request; no full-suite pass is claimed here.

> **Superseded/current status (2026-09-12).** The table below is the
> 2026-09-11 pre-fix documentation baseline. The server and transaction-UI
> batches have since resolved ruleset transitions, setting acknowledgements,
> market collateral/quota, neutral purchase dismissal, timer visibility,
> hidden-focus filtering, contract relay delivery, `payEach` shortfalls, and
> enriched match-history persistence. Remaining documentation/product gaps in
> this batch are Quick Table auto-join and the unreleased Wallet/Items mutation
> contract; the separate Global Events warning/tier sequencing row remains an
> intentionally deferred product/code decision.
> See `docs/audit/fix-docs-parity-batch-2026-09-12.md` for the current doc
> status and `docs/audit/fix-server-batch-2026-09-12.md` /
> `docs/audit/fix-transaction-ui-batch-2026-09-12.md` for implementation
> evidence. No document is deleted by this update.

## Document disposition

Classification is about how a reader should use the document today. “Stale”
means the document or a material section needs a superseded banner/update; it
does not authorize deletion.

| Classification | Files | Disposition |
| --- | --- | --- |
| Active | `README.md`, `PRODUCT.md`, `Instructions.md`, `docs/DEVELOPMENT_WORKFLOW.md`, `docs/production-hardening.md`, `.github/copilot-instructions.md`, `.ulpi/design/DESIGN.md`, `.ulpi/design/ACCOUNT-PROFILE.md`, `.ulpi/design/gameplay.md`, `.ulpi/design/FINANCE-RAIL-UX-PLAN.md`, `.ulpi/design/NEW-GAME-SYSTEMS-PLAN.md`, `.ulpi/design/PLAYER-FINANCING-PLAN.md`, `.ulpi/design/RANKINGS-METRICS-PLAN.md`, `docs/design/figma-theme-worlds-2026-09-11.md`, `docs/audit/ux-1920-reset-slice-2026-09-11.md`, `docs/plans/ai-bots-plan.md`, `docs/plans/deal-negotiation-plan.md`, `docs/plans/friends-and-player-social-plan.md`, `docs/plans/match-history-and-in-session-social-plan.md`, `docs/plans/global-events-plan.md`, `docs/sponsored-purchase.md`, `docs/audit/agent-codebase-bugs-2026-09-11.md`, `docs/audit/agent-ui-review-2026-09-11.md`, `docs/audit/agent-ux-review-2026-09-11.md` | Keep as contracts/backlog, but reconcile the gaps in the evidence table below. |
| Completed record | `.ulpi/design/HOME-PROFILE-REDESIGN.md`, `.ulpi/design/FINAL-REVIEW.md`, `docs/audit/expansion-completion-2026-09-09.md`, `docs/audit/expansion-implementation.md`, `docs/plans/achievement-announcements-ui-plan.md`, `docs/plans/achievements-plan.md`, `docs/plans/END-TO-END-AUDIT-CS2-ROULETTE-PLAN.md`, `docs/plans/IPAD-LANDSCAPE-UI-UX-AUDIT.md` | Retain as dated evidence; add a “current status” link when later work changes the contract. |
| Stale / rewrite section | `docs/audit/markdown-feature-parity-2026-09-11-theme-reset.md`, `.ulpi/design/THEME-FIVE-VISUAL-BRAINSTORM.md`, `.ulpi/design/NIGHT-SHIFT-MICROGAME-PLAN.md`, `.ulpi/design/QUICKPLAY-BOTS-TRADING-SOCIAL-PLAN.md`, `.ulpi/design/RULESETS-SEASONS-MARKET-PLAN.md`, `docs/plans/casino-market-global-events-plan.md`, `docs/plans/global-leaderboards-plan.md`, `docs/plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md`, `docs/plans/no-ai-bots-plan.md`, `docs/REFACTOR-ROADMAP.md`, `SHOWCASE.md` | Preserve unique history, but update status/URLs/old implementation sections before using as current guidance. |
| Reference / historical audit | `.ulpi/design/BOARD-SOURCES.md`, `.ulpi/design/supplied/poorup_design_system.md`, `public/assets/audio/README.md`, `public/assets/parlor-patrol/README.md`, `docs/AUDIT-2026-09-08.md`, `docs/AUDIT-DEEP-2026-09-08.md`, `docs/AUDIT-FULL-2026-09-08.md`, `docs/audit/poorup-audit-2026-09-08.md`, `docs/audit/release-readiness-2026-09-08.md`, `docs/audit/room-patrol-bug-audit.md` | Keep for provenance and prior findings; do not reopen rows without re-reading current code. `room-patrol-bug-audit.md` already says this explicitly at lines 8–11. |
| Deletion candidate | None | Every candidate inspected has current-contract, provenance, or historical value. Delete/archive only after explicit owner approval. |

## Verified parity gaps and contradictions — 2026-09-11 baseline (superseded)

| Priority | Contract/document evidence | Current implementation evidence | Finding and smallest safe next step |
| --- | --- | --- | --- |
| P1 | `.ulpi/design/QUICKPLAY-BOTS-TRADING-SOCIAL-PLAN.md:9-11,25-46` defines Quick Table as auto-join with retry/race handling. | `public/clientLobbyUi.js:805-818` sets a public Quick Table create request; `public/clientLobbyUi.js:607-617` selects `create-room` whenever no room code/id is supplied. The Quick handler never calls the directory path (`public/clientRoomsUi.js:225`). | **OPEN — docs updated.** Quick Table remains create-new, not auto-join. Implement directory → join/retry → create fallback and add a black-box join-race test before calling the target flow live. |
| P1 | `.ulpi/design/RULESETS-SEASONS-MARKET-PLAN.md:82-84` says preset changes honor overrides and expose reset behavior. | `server/rooms.js:118-131,276-310` now clears stale base/overrides for named presets and re-resolves effective settings; UI sends the preset at `public/clientLobbyUi.js:395-400`. | **RESOLVED in Server Batch 1.** Both Custom-base transition directions and the effective flags are covered by `server/rulesetRegistry.test.js`; see `docs/audit/fix-server-batch-2026-09-12.md`. |
| P1 | `docs/plans/deal-negotiation-plan.md:9-13,39-41` requires alternating responder roles and safe stale offers. | `server/serverSocketGame.js:35-65` now resolves counter/response recipients from contract depth and role; `server/socketHandlerSupport.js:54-68` accepts the resolver. | **RESOLVED in Server Batch 1.** Per-socket delivery across two counters and both response roles is covered by `server/serverSocketGame.test.js`. |
| P1 | `.ulpi/design/FINANCE-RAIL-UX-PLAN.md:15-17` and `docs/plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md:19-22` call rail, Wallet, modal, and panel-control slices implemented. `.ulpi/design/NEW-GAME-SYSTEMS-PLAN.md:57-76` keeps item/prediction/airport/bank-tier flags as unreleased systems. | `public/clientWalletUi.js:159-160,181-193` only delegates optional item actions and emits `upgrade-bank-account`; `public/main.js:947` supplies neither `handleItemAction` nor `upgradeBankAccount`. Socket registrations at `server/serverSocketAccount.js:63-93` and `server/serverSocketGame.js:38-68` contain neither event. `server/summaryApi.js:55-84` has no item, airport, prediction, or bank-account projection. | Wallet/Items is a navigation/rendering shell, not a complete mutation contract. Keep NEW-GAME systems active/future and change the rail/UX status to “shell implemented”; do not advertise USE/TRADE/EXCHANGE/SELL or upgrade success until server verbs and viewer-scoped state exist. |
| P1 | `docs/plans/casino-market-global-events-plan.md:131-137` documents only basic buy/sell and one market action per turn; `.ulpi/design/RULESETS-SEASONS-MARKET-PLAN.md:343-371` describes current margin/short/options safety. | `server/marketExpansion.js:81-123` and `server/economyApi.js:350-476` apply/increment one shared quota for explicit advanced actions; `server/marketExpansion.test.js` covers the transitions. | **RESOLVED in Server Batch 1.** The docs now define one explicit market action per board turn for open/reduce/cover/exercise/close; forced liquidation is settlement and does not consume it. |
| P1 | `.ulpi/design/RULESETS-SEASONS-MARKET-PLAN.md:343-351` says opening margin reserves a disclosed percentage of cash; `server/marketExpansion.js:1-10,137-153` now defines and applies that reserve. | `server/marketExpansion.js:137-153` charges the fee plus 25% gross-quote collateral, increments reserved cash, and exposes the collateral in the result. | **RESOLVED in Server Batch 1.** Margin is now explicitly collateralized and covered by `server/marketExpansion.test.js`; the docs state the exact 25% contract. |
| P1 | `.ulpi/design/FINANCE-RAIL-UX-PLAN.md:273-287` and `docs/plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md:37-39` require scrim/Escape/close to be neutral. | `public/clientGameModalsUi.js:78-132` now separates neutral close from the explicit `decline-property` action. | **RESOLVED in Transaction UI Batch 2.** Normal purchase scrim/Escape closes without mutation; the focused regression test verifies that only visible PASS emits decline. |
| P1 | Finance modal accessibility requires a real focus-safe surface (`.ulpi/design/FINANCE-RAIL-UX-PLAN.md:385-400`). | `public/clientSurfaces.js:65-69` filters `.is-hidden`, `aria-hidden`, and native `[hidden]` descendants; the custom dropdown remains at `public/clientTradeUi.js:56-58`. | **RESOLVED in Transaction UI Batch 2.** Closed dropdown options are excluded from the modal Tab cycle; `public/clientTransactionUi.test.js` covers the regression. |
| P1 | `PRODUCT.md:15`, `.ulpi/design/gameplay.md:27-32`, and the UX audit’s “next action” intent require an understandable deadline. | `public/clientHudRender.js:171-205` now keeps the timer visible through turn-owned resolution while the server deadline remains live. | **RESOLVED in Transaction UI Batch 2.** The timer-through-resolution regression and accessible announcements are covered by `public/clientTransactionUi.test.js`. |
| P2 | `docs/plans/match-history-and-in-session-social-plan.md:20-50` requires immutable records with achievements and other match metadata. | `server/socketRuntime.js:173-180` persists `accountStore.recordGameResults()` before annotating achievements/season; `server/accountStore.js:595-615` stores that pre-annotation record in each account. | Reloaded account history can lose `achievementsUnlocked`/`seasonId` present in the live object. Enrich before account persistence or update once after annotation; add a restart round-trip test. |
| P2 | `docs/plans/achievement-plan.md` equivalent contract in `docs/plans/achievements-plan.md:62-112` defines timing/conditions for Clean Exit, Double Headline, Fire Sale, and Crisis Investor. | `server/achievementStore.js:68-94` checks `crisisMarketProfit || (boughtDuringHousingBubble && bubbleSurvivor)`, `soldBuildingsDuringHousingBubble >= 3`, `globalEventsSurvived >= 2`, and paid/non-defaulted loan status. | Catalog prose and evaluator semantics diverge: Fire Sale is housing-bubble-only (not any crisis), Double Headline does not require separate Surprise rolls, Crisis Investor’s fallback does not require profit, and Clean Exit has no due-round check. Pick one canonical rule table and generate client copy from it. |
| P2 | `docs/plans/global-events-plan.md:74-92,197-203` requires tier/progress durations and a warning before every negative event. | `server/globalEventsApi.js:183-188` has only housing-bubble vs all-other duration branches; `server/globalEventsApi.js:211-223` starts any event with choices directly in `voting`, skipping `warning`. | Implemented catalog/lifecycle is partial relative to the plan. Either add event tiers/warning sequencing or explicitly revise the contract and rules-page copy; add tests for a civic negative event and tier durations. |
| P2 | `.ulpi/design/THEME-FIVE-VISUAL-BRAINSTORM.md:149-156` says every asset uses a `320×180` master. | `docs/design/figma-theme-worlds-2026-09-11.md:5-8,33-50` defines `640×360` worlds; `public/themeAssetAudit.test.js:27-34` expects scene/clouds/petals at `640×360` and other props at `320×180`; `public/clientThemeRender.js:28-47` emits 640×360 scene images. | Theme implementation is coherent, but THEME-FIVE’s all-assets dimension statement is stale. Update it to the mixed 640/320 contract and keep Figma handoff authoritative for 640 masters. |
| P2 | `.ulpi/design/NIGHT-SHIFT-MICROGAME-PLAN.md:8-10,24-25,196-200` still names `Ctrl+P` as the entry chord. | `public/index.html:100-105` advertises `SHIFT+P`; `public/clientKeyboard.js:62-80` retains Ctrl+P as a bonus path but makes Shift+P the primary, documented-safe chord. | Update Night Shift plan to Shift+P primary and Ctrl+P compatibility/bonus; otherwise the plan encourages the browser print collision that the current code avoids. |
| P2 | `docs/plans/global-leaderboards-plan.md:3-5,49-58,111-119` says seasonal rewards are future and lists only ALL TIME/MONTH/FRIENDS. | `server/serverSocketSocial.js:180-209` serves `get-season` and `claim-season-reward`; `public/clientSocialSurfaces.js:399-429,584-628` renders THIS SEASON and reward claims; current metrics include 15 IDs at `public/clientSocialSurfaces.js:480`. | Leaderboards plan status and scope list are stale. Update it to reflect seasonal claims, 30-day scope, and the current metric registry (or intentionally reduce the product and code). |
| P2 | `docs/plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md:44-69` and `.ulpi/design/FINANCE-RAIL-UX-PLAN.md:38-62` describe six old rail tabs/FOCUS and display-only Cash as current evidence, despite status notes saying the pre-implementation gate is historical. | `public/index.html:771-775` has three rail tabs; `public/index.html:575-591,731` has PANELS and Wallet entry. | Historical evidence is not clearly separated from the active contract. Strike or relabel those sections so future agents do not re-open fixed six-tab/FOCUS work. |
| P2 | `.ulpi/design/QUICKPLAY-BOTS-TRADING-SOCIAL-PLAN.md:103-114` asks for a Profile FRIENDS tab, while `docs/plans/friends-and-player-social-plan.md:6-20` makes SOCIAL a top-level hub. | `public/index.html:33-50` exposes top-level PLAY/ROOMS/PROFILE/RANKINGS/SOCIAL/RULES; Profile tabs at `public/index.html:375-382` have no FRIENDS tab. | Resolve the two competing IA contracts; the current code follows the top-level SOCIAL design. |
| P2 | `docs/audit/agent-codebase-bugs-2026-09-11.md:130-146` identifies rejected host settings returning success. | `server/rooms.js:434-445` silently returns on rejected setting; `server/serverSocketAccount.js:351-364` always replies `{ success: true }`. | Host clients cannot distinguish accepted from ignored settings. Return structured rejection reasons and add negative ack tests. |

## Obsolete bug claims found in older audits

These are not new findings; they are examples of why dated audits must remain
reference material:

- `docs/AUDIT-2026-09-08.md:17-19` and `docs/AUDIT-DEEP-2026-09-08.md:34-36` say the Deals/NEEDS YOU count misses trades. Current `public/clientRailRender.js:505-512` includes the responder trade in `financeNeedsCount`; the old row is resolved/stale.
- `docs/AUDIT-FULL-2026-09-08.md:127-146` describes dead bot settings/browser-only timer behavior. Current server settings are wired at `server/roomSettings.js:25-35`, server deadlines at `server/socketRuntime.js:321-344`, and client timer state at `public/clientHudRender.js:171-205`. The pre-fix timer-visibility row above is now resolved by the transaction-UI batch; do not reopen it as a browser-only timer bug.
- `docs/AUDIT-FULL-2026-09-08.md:202-208` says unsecured loans are UI-disabled. Current `public/clientTradeUi.js:246-258` requires a property only for non-loan modes, so unsecured loan submission is enabled; do not reopen that old claim.
- `docs/AUDIT-FULL-2026-09-08.md:315-320` says Manage Portfolio routes to Market; the current three-tab/Wallet implementation has moved to Holdings (see `public/index.html:771-775` and `public/clientRailRender.js:240-257`).
- `docs/audit/room-patrol-bug-audit.md:8-11` already warns that its old monolith line numbers are not current. Keep it as a resolution ledger, not a live queue.

## Grounded improvement brainstorm (separate from findings)

These are proposed process/design improvements, not additional defects:

1. Maintain one small machine-readable feature manifest (for example, system,
   status, server verbs, client entry points, tests, and owner). Generate a
   Markdown status table from it so “implemented” cannot drift from registered
   Socket.IO handlers or tests.
2. Make registries authoritative at every boundary: a ruleset transition matrix,
   a single market-operation quota policy, a shared achievement rule/copy table,
   and a generated event/verb parity check. This follows the architecture
   guidance to keep the modular monolith and avoid a second rules engine.
3. Add a fast docs-parity smoke pack (5–8 high-signal checks) beside the existing
   tests: Quick Table join race, Custom-base transitions, two-counter relay,
   Wallet unsupported verbs, neutral purchase dismissal, timer-through-resolution,
   enriched-history reload, and global-event warning/duration semantics. Keep
   larger browser/evaluation packs scheduled and retain a held-out slice.
4. Stamp every dated audit with `superseded by` and a current commit/ref; retain
   resolution ledgers, but move open work to the three current 2026-09-11 agent
   audits. This reduces duplicate fixes and prevents historical line numbers
   from becoming accidental requirements.
5. Keep the existing single modular monolith and server-authoritative state. Do
   not add separate item/prediction/airport services until their schemas,
   viewer-scoped projections, idempotency, and black-box tests exist; the current
   Wallet shell can remain a read-only affordance meanwhile.
6. Resolve user-facing source conflicts in one docs pass: choose the canonical
   live-demo URL (`README.md:33` vs `SHOWCASE.md:5`), correct Night Shift’s chord,
   update theme canvas dimensions, and label basic-market text as historical.

## Bottom line — current status

The current code has real implemented breadth—rulesets, Standard/Metro boards,
seasons/rewards, cosmetics, global events, advanced market, bots, contracts,
social, casino reveal, sponsorship, and six visual worlds. As of 2026-09-12,
ruleset transitions, setting acknowledgements, contract relays, market
collateral/quota, purchase dismissal, timer visibility, hidden-focus filtering,
and match-history enrichment have focused regression evidence. The remaining
high-risk documentation parity gaps are Quick Table semantics and Wallet/Items
unsupported mutations. The separate Global Events warning/tier sequencing
mismatch remains deferred. Theme dimensions, Night Shift shortcut, leaderboard
scopes/rewards, rail/`FOCUS` history, and Friends IA are now documented in their
current forms. No files were deleted.
