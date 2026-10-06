# Poorup Bot Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Replace personality-driven bot behavior with a shared, difficulty-driven strategy system that makes stronger AI and no-AI decisions while preserving server authority.

**Architecture:** Extend the existing strategic snapshot and future planner into the common evaluation path. The AI returns a structured, server-issued action intent with bounded parameters; the no-AI brain ranks the same legal intents deterministically. Remove personality from UI, room/player state, rulesets, wire snapshots, and policy branches while retaining AI/no-AI and difficulty.

**Tech Stack:** Node.js ESM, existing server-authoritative Socket.IO APIs, vanilla browser JavaScript, current seeded bot tournament harness.

**Spec:** `docs/BOT-STRATEGY-DESIGN.md`

## Global Constraints

- Keep all game-rule enforcement, cash/ownership checks, and settlement on the server.
- AI intents may select only server-issued action tokens and validated parameters; they may not mutate `GameState` or invent ownership, money, or rules.
- Keep canonical brain modes `ai` and `no-ai`; retain House / Table / Expert difficulty. Map legacy `all` / `auto` values to `ai`.
- Do not use fixed deed-price multiples as auction ceilings; use state-dependent strategic value and the shared legal cash/auction checks.
- Remove behavioral personality from canonical settings, player state, summaries, UI, prompts, and decision policy. Preserve bot nicknames, colors, and avatars.
- Preserve all current dirty work, especially the pawn-motion render-order change. Rework the uncommitted auction-cap patch only in the auction task; do not discard unrelated changes.
- Do not call a live AI provider in automated tests or consume provider credits. Keep the existing quota, timeout, circuit-breaker, and deterministic fallback protections.
- No commit, push, or deployment is included in this plan unless separately authorized.

## Review Focus

1. Old clients or rulesets send `botPersonality`; normalize/ignore it without restoring a personality or breaking unrelated rules.
2. An AI response arrives after the seat, auction bid, auction, event, or obligation changes; reject stale intents and use a legal fallback.
3. A market candidate references a missing quote or held position; evaluation must not invent a zero quote or double-count P&L.
4. An action parameter is fractional, over cash, references unowned property, or exceeds the current action's legal range; reject before mutation.
5. A bot rolls before building, or a candidate would break its completed group; preserve legal post-roll options and price the group change explicitly.

---

### Task 1: Lock failing behavior contracts

**Files:**
- Modify: `server/botFuturePlanner.test.js`
- Modify: `server/botLogic.test.js`
- Modify: `server/trades.test.js`
- Modify: `server/bot-brain.test.js`
- Modify: `server/roomSettings.test.js`
- Modify: `server/rulesetRegistry.test.js`
- Modify: `server/gameLogic.test.js`
- Modify: `server/botStrategicContext.test.js`
- Modify: `public/clientUxContracts.test.js`
- Modify: `public/clientStateSync.test.js`
- Modify: `qa/poorup.spec.js`

**Interfaces:**
- Consumes: current candidate, advisor, settings, and ruleset APIs.
- Produces: regressions that name the observable behavior below; no production API changes in this task.

- [x] **Step 1: Write behavior tests first.** Added market mark-to-market checks with literal quote, quantity, and fee fixtures.
- [x] **Step 2: Write candidate regressions.** Added rich-trade protection, borrower targeting beyond the two lowest-cash seats, and post-roll legal-build tests.
- [x] **Step 3: Write auction and removal contracts.** Added the $200/$1,200 no-upside pass, justified premium, parameterized-bid, personality-removal, and legacy-ignore checks.
- [x] **Step 4: Verify red.** Focused pre-fix runs reproduced the market-value omission, missing borrower/build/trade choices, fixed auction ceiling, and stored personality controls.

Run: `node server/botFuturePlanner.test.js`, `node server/botLogic.test.js`, `node server/trades.test.js`, `node server/bot-brain.test.js`, `node server/roomSettings.test.js`, `node server/rulesetRegistry.test.js`, `node server/gameLogic.test.js`, `node server/botStrategicContext.test.js`, `node public/clientUxContracts.test.js`, and `node public/clientStateSync.test.js`.

### Task 2: Correct shared strategy valuation

**Files:**
- Modify: `server/botFuturePlanner.js`
- Modify: `server/botStrategicContext.js`
- Test: `server/botFuturePlanner.test.js`, `server/botStrategicContext.test.js`
- Add: `server/botMarketForecast.js`
- Test: `server/botMarketForecast.test.js`

**Interfaces:**
- Consumes: the current sanitized strategic snapshot and `evaluateCandidate(snapshot, candidate, options)`.
- Produces: mark-to-market portfolio valuation and comparable outcome features used by both the AI advisor and deterministic selector.

- [x] **Step 1: Verify red.** Pre-fix buy projection lost the full $180 principal instead of only its $4 fee.
- [x] **Step 2: Implement.** Marked holdings at the current shared quote and counted fees once.
- [x] **Step 3: Extend context.** Added bounded quote history, current quotes, and active event information to the provider-safe context and risk-adjusted forecasts.
- [x] **Step 4: Verify green.** Buy/sell, missing quote, empty position, partial sale, event-shock, determinism, and snapshot immutability tests pass.

Run: `node server/botFuturePlanner.test.js` and `node server/botStrategicContext.test.js`.

### Task 3: Repair strategic candidate generation

**Files:**
- Modify: `server/botApi.js`
- Modify: `server/botCandidates.js`
- Modify: `server/botTradeValuation.js`
- Modify: `server/botLogic.js`
- Use: `server/botMarketForecast.js` for shared quote-history and event-aware estimates
- Test: `server/trades.test.js`, `server/botTradeValuation.test.js`, `server/botLogic.test.js`

**Interfaces:**
- Consumes: shared candidate evaluation from Task 2 and authoritative game APIs.
- Produces: complete legal candidate lists with strategic value for both brains.

- [x] **Step 1: Verify red.** The pre-fix run reproduced the rich-trade, borrower-target, and post-roll-build gaps.
- [x] **Step 2: Repair trades and lending.** Rich trades compare both portfolios and only emit mutually affordable/favorable terms; viable contract targets rank before the final limit.
- [x] **Step 3: Complete turn actions.** Post-roll legal build candidates remain available, subject to live game checks.
- [x] **Step 4: Improve market choices.** All affordable indices are considered with risk, fee, quote history, holdings, and pending global-price shocks.
- [x] **Step 5: Compare against pass.** Projected outcomes outrank static scores; unsupported actions cannot win when a projected option exists.
- [x] **Step 6: Verify green.** Focused trade, valuation, market forecast, and bot-logic suites pass.

Run: `node server/trades.test.js`, `node server/botTradeValuation.test.js`, `node server/botLogic.test.js`, and `node server/botCandidateCoverage.test.js`.

### Task 4: Add parameterized advisor intents and strategic auctions

**Files:**
- Modify: `server/botAdvisor.js`
- Modify: `server/advisorLogic.js`
- Modify: `server/botLogic.js`
- Modify: `server/socketRuntime.js`
- Modify: `server/auctionApi.js`
- Remove or replace: `server/botAuctionPolicy.js`
- Test: `server/botAdvisor.test.js`, `server/botLogic.test.js`, `server/audit-trade-auction.test.js`, `server/socketRuntime.test.js`

**Interfaces:**
- `parseAdvisorResponse(payload, issuedIntents)` returns a validated `{ actionId, parameters, confidence, reasonCode }` or `null`.
- The auction intent accepts a whole-dollar `amount`; the server validates against the current auction, current high bid, participant status, and available cash after the provider returns.

- [x] **Step 1: Add schema regressions.** Covered bounded whole-dollar parameters, fractional/out-of-range/unknown/missing values, unknown tokens, stale auction state, and deterministic fallback.
- [x] **Step 2: Extend advisor protocol.** The provider receives server-issued amount ranges; parser accepts only declared integer fields and rejects missing/out-of-range parameters.
- [x] **Step 3: Revalidate at the action seam.** The async runtime snapshot binds high bid, bidder, participants/pass state, bot availability, and cash; the ordinary auction API rechecks live legality.
- [x] **Step 4: Replace the fixed ceiling.** Dynamic strategic value is used, with available cash as the only bid ceiling; no fixed sticker-price multiple or cash reserve cap remains.
- [x] **Step 5: Share the decision policy.** AI may choose a bounded amount; no-AI bids the current minimum while it remains within the same utility range.
- [x] **Step 6: Verify green.** Advisor, auction, trade-audit, runtime, and syntax checks pass; no live provider calls were made.

Run: `node server/botAdvisor.test.js`, `node server/botLogic.test.js`, `node server/audit-trade-auction.test.js`, `node server/socketRuntime.test.js`, and `node --check server/botAdvisor.js`.

### Task 5: Replace personality policy with difficulty-driven decisions

**Files:**
- Modify: `server/botLogic.js`
- Modify: `server/botApi.js`
- Modify: `server/advisorLogic.js`
- Modify: `server/botAdvisor.js`
- Modify: `server/botStrategicContext.js`
- Modify: `server/botTableMind.js` only where it reads a bot personality field
- Test: `server/botLogic.test.js`, `server/botAdvisor.test.js`, `server/botTableMind.test.js`, `server/bot-brain.test.js`

**Interfaces:**
- Consumes: the shared evaluator and validated intents from Tasks 2–4.
- Produces: the same state/evaluation model for AI and no-AI; only the selection method and difficulty compute profile differ.

- [x] **Step 1: Verify red.** Added tests pinning former personality differences and identical legal candidate lists across brains/difficulties.
- [x] **Step 2: Replace policy branches.** Event voting, trade/contract acceptance, auctions, builds, loans, market/casino choices, and dialogue use shared state-based rules.
- [x] **Step 3: Set difficulty budgets.** House horizon 0/no samples, Table horizon 1/16 scenarios, Expert horizon 3/64 scenarios.
- [x] **Step 4: Unify context.** Personality is absent from advisor prompts and summaries; both brains use the same legal action/evaluation context.
- [x] **Step 5: Verify green.** Fixed-seed behavior and deterministic fallbacks pass; automated suites made no live provider calls.

Run: `node server/botLogic.test.js`, `node server/botAdvisor.test.js`, `node server/botTableMind.test.js`, and `node server/botFuturePlanner.test.js`.

### Task 6: Remove personality from room state, rulesets, and UI

**Files:**
- Modify: `server/roomSettings.js`
- Modify: `server/rooms.js`
- Modify: `server/rulesetRegistry.js`
- Modify: `server/summaryApi.js`
- Modify: `public/clientLobbyUi.js`
- Modify: `public/clientState.js`
- Modify: `public/clientStateSync.js` (preserve the existing movement-order fix)
- Modify: `public/clientStateSync.test.js` (preserve the movement-order regression)
- Modify: `public/main.js`
- Test: `server/roomSettings.test.js`, `server/rulesetRegistry.test.js`, `server/gameLogic.test.js`, `server/bot-brain.test.js`, `server/casino-bankruptcy.test.js`, `public/clientUxContracts.test.js`

**Interfaces:**
- Consumes: canonical brain and difficulty contracts from Tasks 4–5.
- Produces: no personality field in new settings, player state, room/game summaries, client state, or AI context. Legacy `all`/`auto` brain values normalize to `ai`; legacy personality values are ignored and dropped.

- [x] **Step 1: Verify red.** Added server, ruleset, summary, state-sync, and lobby contracts for removing the old setting.
- [x] **Step 2: Remove server state.** Removed the setting/normalizer, Player field, bot initialization/update, public summary field, and ruleset override.
- [x] **Step 3: Preserve compatibility.** Legacy `botPersonality` is rejected/dropped; `all`/`auto` brain aliases normalize to canonical `ai`.
- [x] **Step 4: Remove client presentation.** Removed the selector, default, mapping, labels, and snapshot projection while retaining brain/difficulty.
- [x] **Step 5: Preserve identity and dirty work.** Nicknames, colors, avatars, chat, action protocol, and prior pawn-motion changes remain intact.
- [x] **Step 6: Verify green.** The full server manifest passed 173/173 suites; server/client lint and manifest checks passed; the full Playwright run passed 1,082 tests with 226 skipped, including iPad external-page and lobby contracts under Chromium emulation. Physical Safari and native-device captures remain unverified. The separate nine-match bot strategy benchmark was censored at its step limit and does not prove competitive strength (see Task 7, Step 5).

Run: `node server/roomSettings.test.js`, `node server/rulesetRegistry.test.js`, `node server/gameLogic.test.js`, `node server/bot-brain.test.js`, `node server/casino-bankruptcy.test.js`, `node public/clientUxContracts.test.js`, `node public/clientStateSync.test.js`, and `npm run test:browser`.

### Task 7: Remove personality from the evaluation harness and prove difficulty differences

**Files:**
- Modify: `server/botTournamentPolicies.js`
- Modify: `server/botTournamentSimulation.js`
- Modify: `server/botTournamentResults.js` and `server/botTournamentSummary.js` for outcome and strategy-metric reporting
- Modify: `server/bot-simulation.test.js`
- Modify: `server/bot-policy-tournament.test.js`
- Test: `server/bot-policy-tournament.test.js`, `server/bot-simulation.test.js`

**Interfaces:**
- Each tournament policy is defined by brain (`ai` stub or `no-ai`) and difficulty only; no personality is injected into simulated seats.
- Tournament output records completion/placement, bankruptcies, strategic auction premium, bad set-break trades, market P&L, invalid actions, stalls, provider calls, and runtime.

- [x] **Step 1: Add evaluation regressions.** Added mixed brain/difficulty fixtures, seat rotation, completion/censoring, same-legal-options, and determinism checks.
- [x] **Step 2: Remove personality from fixtures.** Simulated policy records now contain only ID, brain, difficulty, and advisor.
- [x] **Step 3: Report outcome quality.** Matches/summaries report completion/censoring, placement, bankruptcies, auction premiums vs projected and face value, completed groups lost/broken, market P&L, legality, provider calls, and runtime.
- [x] **Step 4: Run bounded campaigns.** Full CI includes the deterministic no-stall smoke; a separate nine-match mixed brain/difficulty benchmark used the local AI stub only.
- [x] **Step 5: Review evidence.** All nine benchmark matches reached the 2,000-step limit, so none measured a winner or win-rate. The output records legality, provider calls, auction premiums, group changes, market P&L, and runtime; this is not evidence of strategic strength. The short run showed negative market P&L across policies, which should be retained as a tuning/evaluation warning rather than claimed as improvement.

Run: `node server/bot-policy-tournament.test.js`, `node server/bot-simulation.test.js` with a fixed small seed range, then `npm run test:full`, `npm run lint`, and the relevant browser contract suite. The last full-suite run had four local server-spawning tests fail with `spawn EPERM`; if still blocked, report those separately rather than weakening coverage.

## Handoff

Execution method: native implementation in the current checkout, preserving all pre-existing dirty changes. Do not commit or push without separate approval. Review the spec and this plan before code changes begin.
