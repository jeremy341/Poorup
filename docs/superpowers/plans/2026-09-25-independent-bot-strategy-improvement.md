# Independent AI and NO-AI Bot Strategy Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for disjoint tasks, or `superpowers:executing-plans` for sequential tasks. Keep all edits on the existing `development` branch. If subagents are used, use GPT-6 Luna at medium reasoning effort and the stable roles `Bot Evaluation`, `NO-AI Policy`, and `AI Advisor`; do not create feature branches or worktrees.

**Goal:** Improve Poorup's AI and NO-AI decision quality independently, repair shared forecast/candidate correctness, measure strength on complete held-out matchups, and reduce ordinary bot scheduling to 300 ms.

**Architecture:** Keep one server-authoritative rules/action path and one shared, auditable projection/evaluation boundary. NO-AI remains a deterministic local policy with bounded scenario planning; AI remains a structured advisor over a complete or explicitly shortlisted legal-action set. A paired tournament runner compares each independently and reports uncertainty; no external model is called by normal tests.

**Tech Stack:** Existing Node.js ESM modules, `RoomManager` and `runBotTurn`, existing provider adapter, native Node test scripts, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-25-independent-bot-strategy-design.md`

## Global Constraints

- Begin and keep all implementation work on the existing `development` branch; do not create feature branches or worktrees. Do not switch branches after implementation begins. Do not commit, push, or merge unless separately authorized.
- The server remains authoritative for dice, cards, rent, auctions, payments, legality, settlement, and execution. Policies choose only server-generated legal candidates.
- Candidate forecasts use player-visible state only; never inspect actual hidden deck order or hidden opponent information.
- NO-AI stays deterministic and local; provider calls remain optional and use existing timeout, quota, circuit-breaker, privacy, and fallback protections.
- Recompute from current live state per decision. Do not add cross-turn state caching.
- Ordinary bot scheduling is 300 ms for both modes; auction scheduling remains 450 ms; the AI provider timeout remains unchanged. No animation code changes.
- No frontend, HTML, CSS, theme, SVG, or layout changes; add no dependencies.
- A/B conclusions require complete, held-out, seat-rotated evidence and uncertainty estimates. Keep incomplete matches visible and never count them as wins.
- Do not persist model free-form reasoning; retain structured action IDs, confidence/reason codes, policy version, and objective outcome metrics.

## Review Focus

1. **Property rent ladder and complete sets:** Brown base rent 10 must forecast 10/50/150/450/800/1250 for 0–5 houses; test against the live GameState rent API in Task 2.
2. **Railroad/utility rent and events:** test railroad owner counts 1–4, utilities at every 2d6 total with one/two deeds, mortgages, rent modifiers, and caps in Task 2.
3. **Candidate effects:** test generated `sell`, `unmortgage`, `bank-repay`, `contract-propose`, `exercise-option`, and jail candidates for explicit projected effects or explicit unsupported status in Task 2.
4. **Hidden information and stale decisions:** ensure search samples only from public information and AI choices are rejected if the seat, offer, or live state changed during provider latency in Tasks 3–4.
5. **Noisy tournament outcomes:** rotate policies through seats, report every step-capped match as incomplete, and compute comparisons by matched seed pair in Tasks 1 and 7.

---

### Task 1: Establish reproducible policy comparisons and a baseline

**Files:**
- Create: `server/bot-policy-tournament.js`
- Test: `server/bot-policy-tournament.test.js`
- Modify: `server/bot-simulation.test.js`
- Modify: `server/balanceMetrics.js`
- Modify: `server/botLogic.js`
- Modify: `server/socketRuntime.js`
- Modify: `package.json`
- Modify: `docs/DEVELOPMENT_WORKFLOW.md`
- Test: `server/botLogic.test.js`

**Interfaces:**
- `simulateBotMatch({ seed, policyBySeat, boardVariant, settings, stepLimit, captureTrace })` returns `{ seed, policyBySeat, ended, stepLimitReached, steps, round, winnerSeat, placementsByPolicy, netWorthByPolicy, bankruptciesByPolicy, stalls, decisionTrace }`.
- Each `policyBySeat` entry has `{ policyId, brain, difficulty, personality, advisor }`. `policyId` is stable text; `brain` is one of the existing `ai`/`no-ai` settings; `advisor` is the advisor instance passed to `runBotTurn`. Reuse one advisor object per policy for all its seats in a match so AI call budgets/fallback state match runtime behavior. Task 3 updates the advisor capability method. The test runner sets/restores the game-level brain around each awaited bot decision, so production match settings/API do not gain a per-seat policy feature.
- `runBotTournament({ seeds, policySets, seatRotations, boardVariants, settings, stepLimit })` returns match rows, completed/incomplete counts, per-policy outcomes, and paired differences.
- `summarizePolicyComparison(matchRows, leftPolicyId, rightPolicyId)` returns `{ pairs, completedPairs, incompletePairs, independentCompletedClusters, winRateDelta, placementDelta, winRateDeltaCI95, placementDeltaCI95, intervalStatus }` using deterministic paired bootstrap samples clustered by seed/opponent stratum. Return null intervals and `intervalStatus: 'insufficient-sample'` until there are at least 30 independent completed seed/opponent clusters; never report a zero-width bootstrap interval as supported uncertainty from one or two samples.
- `decideBotAuction({ auction, bot, startingCash, advisor, context })` returns `{ candidates, minimum, actionId, decision }` and is called by both runtime and tournament code; runtime keeps ownership/identity revalidation and bid/pass execution.
- `createSimulationRoom({ boardVariant, settings })` reuses the current all-bot `RoomManager` setup and applies board/rule settings before `startGame`.
- `withSeededSimulationGlobals(seed, callback)` owns the current seeded `crypto.randomInt`, `crypto.randomUUID`, and `Date.now` overrides and restores them in `finally`.
- `stateFingerprint(game)` and `assertHealthyCash(game)` are moved from the current test file and keep the existing no-stall/finite-cash invariants.
- `buildMatchResult(room, { seed, policyBySeat, steps, stepLimit, decisionTrace })` returns the result shape above and marks step-capped games incomplete.

- [ ] **Step 1: Add failing metric tests for completed and incomplete pairs.**

```js
const report = summarizePolicyComparison([
  { seed: 1, seatRotation: 0, ended: true, winnerPolicyId: 'candidate', placementsByPolicy: { candidate: 1, baseline: 2 } },
  { seed: 2, seatRotation: 1, ended: true, winnerPolicyId: 'baseline', placementsByPolicy: { candidate: 2, baseline: 1 } },
  { seed: 3, seatRotation: 0, ended: false, winnerPolicyId: null, placementsByPolicy: {} }
], 'candidate', 'baseline');

assert.equal(report.pairs, 3);
assert.equal(report.completedPairs, 2);
assert.equal(report.incompletePairs, 1);
assert.equal(report.intervalStatus, 'insufficient-sample');
assert.equal(report.winRateDeltaCI95, null);
assert.equal(report.placementDeltaCI95, null);
```

- [ ] **Step 2: Run `node server/balanceMetrics.test.js` and verify missing paired-comparison/sample-support fields fail.**

- [ ] **Step 3: Extract the current sequential simulation loop into `simulateBotMatch`.**
  Reuse `RoomManager`, `selectBotTurnTarget`, `runBotTurn`, `resolvePurchaseOffer`, and the auction participant path. In this same step, define `decideBotAuction` in `botLogic.js` before the simulation calls it; it computes the current baseline, constructs legal bid/pass candidates, optionally asks the advisor, and falls back to the legal baseline for invalid provider output. Preserve RNG/UUID/time restoration in `finally`; keep tests sequential while the fixture patches global RNG functions. Return a result row even when `stepLimit` is reached, with `stepLimitReached: true` and `ended: false`.

```js
export async function simulateBotMatch({ seed, policyBySeat, boardVariant = 'standard-40', settings = {}, stepLimit = 20_000, captureTrace = false }) {
  return withSeededSimulationGlobals(seed, async () => {
    const room = createSimulationRoom({ boardVariant, settings });
    let steps = 0;
    const decisionTrace = captureTrace ? [] : null;
    while (room.game.started && steps < stepLimit) {
      const auctionBot = room.game.auction?.active
        ? room.game.players.find(player => isAuctionBotParticipant(room.game.auction, player))
        : null;
      if (room.game.auction?.active && !auctionBot) {
        room.game.finishAuction();
        steps += 1;
        assertHealthyCash(room.game);
        continue;
      }
      const bot = auctionBot || selectBotTurnTarget(room.game);
      const policy = policyBySeat[room.game.players.indexOf(bot)];
      const previousBrain = room.game.settings.botBrain;
      room.game.settings.botBrain = policy.brain;
      try {
        if (room.game.auction?.active) {
          const choice = await decideBotAuction({ auction: room.game.auction, bot, startingCash: room.game.settings.startingCash, advisor: policy.advisor, context: buildBotStrategicContext(room.game, bot, 'auction', room.game.botDecisionSequence || 0) });
          const result = room.runBotAction(bot.id, actor => choice.actionId === 'auction:bid'
            ? room.placeAuctionBid(actor, choice.minimum)
            : room.passAuction(actor));
          const auctionTrace = { ...choice.decision, phase: 'auction', actionId: choice.actionId, success: result?.success !== false };
          room.game.recordBotDecisionTrace(auctionTrace);
          if (captureTrace) decisionTrace.push({ policyId: policy.policyId, phase: 'auction', actionId: choice.actionId, state: stateFingerprint(room.game) });
        } else {
          const result = await runBotTurn(room, bot, policy.advisor);
          if (result?.botDecision) room.game.recordBotDecisionTrace(result.botDecision);
          resolvePurchaseOffer(room, bot, result);
          if (captureTrace) decisionTrace.push({ policyId: policy.policyId, phase: result?.botDecision?.phase, actionId: result?.botDecision?.actionId, state: stateFingerprint(room.game) });
        }
      } finally {
        room.game.settings.botBrain = previousBrain;
      }
      steps += 1;
      assertHealthyCash(room.game);
    }
    return buildMatchResult(room, { seed, policyBySeat, steps, stepLimit, decisionTrace });
  });
}
```

- [ ] **Step 4: Wire the shared auction decision into the runtime and test it.**
  Replace the duplicated baseline/candidate/provider choice in `socketRuntime.js` with `decideBotAuction`. Keep runtime responsible for timer/lock/auction-identity checks and for executing the returned bid/pass. Add `server/botLogic.test.js` coverage for NO-AI baseline bid/pass, legal AI override, invalid-ID fallback, and minimum bid; the tournament uses the same helper.

```js
export async function decideBotAuction({ auction, bot, startingCash, advisor, context }) {
  const baseline = auctionBidDecision(auction, bot, startingCash);
  const candidates = [
    { id: 'auction:bid', kind: 'auction', amount: baseline.minimum, risk: baseline.minimum / Math.max(1, bot.cash), score: baseline.shouldBid ? 12 : 2 },
    { id: 'auction:pass', kind: 'auction', risk: 0, score: baseline.shouldBid ? 1 : 10 }
  ];
  const supportsAuctionChoice = typeof advisor?.supportsChoicePhase === 'function'
    ? advisor.supportsChoicePhase('auction')
    : advisor?.supportsChoicePhases === true;
  const decision = supportsAuctionChoice
    ? await advisor.chooseAction({ ...context, candidates, personality: bot.personality })
    : null;
  const chosen = candidates.find(candidate => candidate.id === decision?.actionId);
  return {
    candidates,
    minimum: baseline.minimum,
    actionId: chosen?.id || (baseline.shouldBid ? 'auction:bid' : 'auction:pass'),
    decision
  };
}
```

  Add `server/botLogic.test.js` coverage for NO-AI baseline bid/pass, a legal AI override, invalid-ID fallback to the deterministic baseline, and an unchanged minimum legal bid. Runtime and tournament call the same selector, but each performs its own live-auction identity/revalidation check before executing.

- [ ] **Step 5: Add policy sets, seat rotations, and fixed control policies.**
  Include current NO-AI, current AI through an injected test provider, score-only greedy, conservative-cash, and random-legal controls. For AI test policies, inject a stub `fetchImpl` that returns a supplied candidate ID; default tests must make zero network calls. Rotate each policy over all seats for each seed.

- [ ] **Step 6: Implement paired summaries and a bounded CLI.**
  Use a seeded bootstrap over completed seed/opponent strata. Below 30 independent completed clusters, report null confidence intervals and `insufficient-sample` rather than implying a precise interval. Add `bot:compare` to `package.json` and document it in `docs/DEVELOPMENT_WORKFLOW.md`; have `POORUP_BOT_EVAL_COUNT`, `POORUP_BOT_EVAL_SEEDS`, `POORUP_BOT_EVAL_STEP_LIMIT`, `POORUP_BOT_LIVE_AI=1`, and `POORUP_BOT_LIVE_AI_MAX_CALLS` control campaign size/live provider use. Reject live mode unless the call cap is a positive integer; print model/prompt versions and actual calls. The default script uses stubs only.

- [ ] **Step 7: Test determinism, rotation, censoring, and zero-stall reporting.**
  Same seed/policy set must produce the same trace. A deliberately low step cap must increment incomplete counts rather than winner counts. Run `node server/bot-policy-tournament.test.js`, `node server/balanceMetrics.test.js`, and `node server/bot-simulation.test.js`.

### Task 2: Share authoritative rent forecasts and close candidate-projection gaps

**Files:**
- Create: `server/botRentForecast.js`
- Modify: `server/rentApi.js`
- Modify: `server/botStrategicContext.js`
- Modify: `server/botFuturePlanner.js`
- Test: `server/botRentForecast.test.js`
- Test: `server/rent.test.js`
- Test: `server/botFuturePlanner.test.js`
- Modify: `server/botLogic.js`
- Test: `server/botLogic.test.js`

**Interfaces:**
- `calculateRentFromFacts({ tile, hasFullSet, doubleRent, ownedRailroadCount, ownedUtilityCount, diceTotal, eventFactors, rentCap }) -> integer` is the single pure rent formula used by live rent and forecast adapters.
- `rentFactsFromGame(game, tile, diceTotal)` and `rentFactsFromSnapshot(snapshot, tile, diceTotal)` return the same normalized rent-facts shape. Both use one internal event-factor resolver; `rentApi.calculateRent` and `botFuturePlanner` call `calculateRentFromFacts`.
- `evaluateCandidate(snapshot, candidate, options)` adds `projectionStatus: 'projected' | 'neutral' | 'unsupported'`; unknown kinds do not silently look like zero-cost actions.
- `getBotChoiceCandidates(game, bot, phase)` returns the current phase candidate array for both runtime choice and coverage tests; it replaces the current private `phaseChoiceCandidates` helper without changing the action schema.
- `collectCandidatesFromFixtures(fixtures) -> Array<{ snapshot, candidate }>` is a test-local helper in `server/botFuturePlanner.test.js`; it calls the same pre-roll/post-roll and phase-choice candidate builders used by runtime.

- [ ] **Step 1: Write failing live-versus-forecast rent parity tests.**
  Implement `makeRentFixture` in `server/botRentForecast.test.js` using the current two-seat `RoomManager` fixture pattern from `server/rent.test.js`; it returns `{ game, liveTile, snapshot }`. Cover property house levels 0–5, unbuilt complete sets with `doubleRent`, mortgaged deeds, railroad owner counts 1–4, utility owner counts 1–2 for dice totals 2–12, and every current modifier/cap in `RENT_EVENT_MODIFIERS`.

```js
for (const [houseCount, expected] of [[0, 10], [1, 50], [2, 150], [3, 450], [4, 800], [5, 1250]]) {
  const fixture = makeRentFixture({ propertyIndex: 1, group: 'Brown', baseRent: 10, houseCount });
  assert.equal(fixture.game.calculateRent(fixture.liveTile), expected);
  assert.equal(calculateRentFromFacts(rentFactsFromGame(fixture.game, fixture.liveTile, 7)), expected);
  assert.equal(calculateRentFromFacts(rentFactsFromSnapshot(fixture.snapshot, fixture.snapshot.board[1], 7)), expected);
}
```

- [ ] **Step 2: Run `node server/botRentForecast.test.js` and `node server/rent.test.js`; confirm the forecast fails where live rent uses the ladder.**

- [ ] **Step 3: Extract the exact rent formula into `server/botRentForecast.js`.**
  Keep event applicability/factor order, floor/cap order, mortgages, full-set double rent, railroad count, utility count/dice math, and ownership facts in one reusable rules path. `rentApi.js` builds facts from live GameState; `botStrategicContext.js` builds the same normalized facts from player-visible board/rule/event snapshots; `botFuturePlanner.js` calls the pure formula for each sampled landing.

- [ ] **Step 4: Credit forecast rent income and model relevant movement constraints.**
  Compute rent paid to the bot from opponent landing distributions, while preserving zero rent for own-property landings and zero rent on mortgages. Include known jail state and movement-card expected outcomes only from public deck composition/rules; do not read the shuffled live deck order.

- [ ] **Step 5: Add projection handlers or explicit status for every generated candidate kind.**
  Add state effects for `sell`, `unmortgage`, `bank-repay`, `contract-propose`, `exercise-option`, and legal jail choices. For terminal sentinels (`end-turn`, `end-finance-window`) mark them `neutral`; for any candidate that cannot be simulated faithfully, return `unsupported` and keep it out of strategic adjustments while preserving the base legal action/fallback behavior.

- [ ] **Step 6: Add the candidate-coverage regression.**
  Build candidates from real `GameState.getBotCandidates` fixtures across pre-roll, post-roll, jail, market, and debt states, plus `getBotChoiceCandidates` fixtures for vote, trade, contract, sponsorship, and payment. Assert each generated kind reports `projected`, `neutral`, or `unsupported` explicitly and unsupported kinds never receive fabricated zero-cost strategic bonuses.

```js
for (const { snapshot, candidate } of collectCandidatesFromFixtures(fixtures)) {
  const evaluation = evaluateCandidate(snapshot, candidate);
  assert.ok(['projected', 'neutral', 'unsupported'].includes(evaluation.projectionStatus));
}
```

Implement that helper as:

```js
function collectCandidatesFromFixtures(fixtures) {
  return fixtures.flatMap(({ game, bot, phase, snapshot }) => {
    const candidates = phase === 'pre-roll'
      ? game.getBotCandidates(bot, { expanded: true, parity: true })
      : phase === 'post-roll'
        ? game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: true })
        : getBotChoiceCandidates(game, bot, phase);
    return candidates.map(candidate => ({ snapshot, candidate }));
  });
}
```

- [ ] **Step 7: Run `node server/botRentForecast.test.js`, `node server/rent.test.js`, `node server/botFuturePlanner.test.js`, `node server/botLogic.test.js`, and `node server/casino-bankruptcy.test.js`.**

### Task 3: Improve NO-AI's deterministic policy and bounded planning

**Files:**
- Modify: `server/botAdvisor.js`
- Modify: `server/botLogic.js`
- Modify: `server/botApi.js`
- Modify: `server/botFuturePlanner.js`
- Modify: `server/botTableMind.js` only if Task 5's profile experiment is approved by its offline gate
- Test: `server/botAdvisor.test.js`
- Test: `server/botLogic.test.js`
- Test: `server/botFuturePlanner.test.js`
- Test: `server/bot-policy-tournament.test.js`

**Interfaces:**
- Add `supportsChoicePhase(phase) -> boolean` to advisor policies and use it in `runBotTurn`, while preserving a backward-compatible fallback for existing third-party/test advisors that only set `supportsChoicePhases`. `AiAdvisor` returns true for `vote`, `trade`, `contract`, `sponsorship`, and `payment`; `DeterministicAdvisor` returns true initially only for `trade`, `contract`, and `payment`. If the AI provider fails in a supported phase, its fallback must use the deterministic policy for that same phase and retain offer/seat revalidation.
- `rankCandidates(snapshot, candidates, { difficulty, seed, rolloutBudget })` returns each candidate's projected features and the explicit `projectionStatus` from Task 2 (`projected`, `neutral`, or `unsupported`). `seed` may control reproducible scenario sampling only; it must not add score noise. `rolloutBudget` controls the bounded scenarios in Step 3, not an arbitrary score perturbation.

- [ ] **Step 1: Add failing tests that distinguish current fixed policy from candidate policy in each proposed phase.**
  Use table fixtures for trade, contract, and payment. Assert the current policy result as a baseline and assert a new local candidate policy's selected ID on controlled states; include an unchanged offer/seat revalidation case. Also assert vote and sponsorship remain on their existing fixed executors until separate feature evidence exists.

- [ ] **Step 2: Replace synthetic score noise with evaluated game-state effects.**
  Remove both the eight seeded arithmetic perturbations in `expertRolloutValue` and the separate seed-based score perturbation in candidate ranking. Until a scenario model is enabled, expert ranking must use forecasted game-state effects only. Add behavior tests proving repeated fixed inputs produce identical projected scores and that changing only the seed cannot change an exact-enumeration result or inject an unexplained score delta.

- [ ] **Step 3: Add bounded scenario evaluation after Task 2 parity passes.**
  Require Task 2's rent-parity and candidate-projection tests to pass first. Enumerate exact 2d6 outcomes for the supported short horizon; compare with a fixed seeded stratified sample at budgets 16/64/256. Include rent paid/received, taxes, pass-start cash, liquidity, debt repayment, full sets, and bankruptcy/survival only where those transitions use canonical live rules. Public card effects may be sampled from public card composition, never the shuffled hidden deck. Model jail/card branches only through faithful, independently tested transitions; otherwise mark those projections unsupported and exclude their speculative adjustment rather than inventing values. Task 5 owns the separate UCT/ISMCTS experiments after this baseline is rules-faithful.

- [ ] **Step 4: Add a calibrated outcome function.**
  Keep candidate legality separate. Score projected survival first, then estimated placement/net-worth improvement, liquidity/debt risk, set completion/development, event exposure, and opportunity cost. Do not tune constants against the same seeds used for final evaluation; store the selected weights with a policy version.

- [ ] **Step 5: Improve selected NO-AI choice phases behind explicit capability gates.**
  First enable candidate scoring for trade, contract, and payment using Task 2's `getBotChoiceCandidates`; keep vote and sponsorship on their current fixed rules until they have comparably meaningful feature/value tests. Preserve payment rescue ordering/eligibility and server-side action execution. For async trade/contract choice, test both changed and unchanged offers: accept a still-current offer only when it remains addressed to the same responding bot/seat, and abort safely if offer identity, actor, or seat changed while awaiting the advisor. If tournament or scenario comparisons do not beat the current rule, leave that phase on `PHASE_EXECUTORS`.

  In `runBotTurn`, route to candidate-choice handling with the phase-specific capability contract:

```js
const supportsPhase = typeof advisor?.supportsChoicePhase === 'function'
  ? advisor.supportsChoicePhase(phase)
  : advisor?.supportsChoicePhases && ['vote', 'trade', 'contract', 'sponsorship', 'payment'].includes(phase);
if (supportsPhase) return runAdvisorChoicePhase(room, bot, advisor, decisionContext, phase);
```

- [ ] **Step 6: Lazily build policy context.**
  Avoid constructing AI-only `tableBrain`/narrative details for local phases that do not consume them. Keep current board/rules/opponent facts needed by the chosen NO-AI scorer, and recompute them on each action from live state.

- [ ] **Step 7: Run `node server/botAdvisor.test.js`, `node server/botLogic.test.js`, `node server/botFuturePlanner.test.js`, and the matched `node server/bot-policy-tournament.test.js` pilot created in Task 1.**

### Task 4: Improve AI context quality and preserve useful legal candidates

**Files:**
- Modify: `server/botStrategicContext.js`
- Modify: `server/botAdvisor.js`
- Modify: `server/botLogic.js`
- Modify: `server/serverSocketGame.js` only to export the existing game-action catalog for tests; do not change handler behavior.
- Modify: `server/bot-policy-tournament.js` to link safe shadow decision summaries to aggregate match outcomes in evaluation-only traces.
- Test: `server/botStrategicContext.test.js`
- Test: `server/botAdvisor.test.js`
- Test: `server/botLogic.test.js`
- Test: `server/botCandidateCoverage.test.js`
- Test: `server/bot-policy-tournament.test.js`

**Interfaces:**
- Version the provider snapshot as `bot-context-v3` and build it by phase from the shared rent/candidate projections.
- `shortlistAdvisorCandidates(candidates, evaluations, { phase, maxCandidates: 32 })` returns `{ candidates, totalCount, omittedCount, omittedByKind }` and always retains valid rescue/terminal actions.
- A provider-boundary serializer assigns opaque request-local action tokens and emits only an allowlisted, sanitized DTO; raw candidate IDs/offers, stable player/account/socket identifiers, and free-form table-talk text never enter the provider payload. The internal token-to-live-candidate mapping stays server-side.
- The model output remains `{ actionId, confidence, reasonCode }`; the provider parser accepts only a token in the exact serialized shortlist shown to the model. The runtime rebuilds the current candidates after the async response, verifies the acting seat and complete offer identity/terms, remaps the token only if its candidate is still currently legal, then executes through the room action seam.

- [ ] **Step 1: Add failing prompt/privacy tests for pre-roll, post-roll, trade, contract, and payment contexts.**
  Assert that each contains the exact current obligations, strategic candidate deltas, rent downside/income, relevant event/rules, and recent structured decisions; assert absence of account IDs, stable player/socket identifiers, raw internal candidate/offer IDs, hidden deck order, table-talk text, credentials, and any other private provider configuration. Use request-local opaque action tokens and allowlisted DTOs. Update both provider protocols to request only `actionId`, `confidence`, and `reasonCode`; do not request or persist free-form chain-of-thought.

- [ ] **Step 2: Add an action-surface coverage matrix.**
  Create a read-only catalog that accounts for base, extended, and dynamically registered game verbs; do not assume `GAME_VERB_HANDLERS` alone is the complete socket action surface. Then create `server/botCandidateCoverage.test.js` with one row per strategic action variant, not merely one row per socket event. If one event accepts multiple strategic variants (for example build, sell-house, mortgage, and unmortgage under `manage-property`), enumerate and test every variant. Map each row to a generated candidate kind, a tested fixed server policy, or an explicit human-only/non-strategic exclusion. Fail when a newly registered strategic socket action/variant has no bot handling/exclusion entry; do not change human handler behavior.

- [ ] **Step 3: Add failing candidate-coverage tests for 0, 32, 33, and 60+ candidates.**
  The shortlist must retain top expected-value actions, at least one candidate from each materially distinct action family, and mandatory rescue/terminal choices. Record omitted counts by kind. A high-value `sell`, `unmortgage`, `bank-repay`, or contract action must not disappear just because it falls after array index 32.

- [ ] **Step 4: Build the phase-specific context from shared evaluated facts.**
  Include current cash/debt, rent exposure and income, candidate cost/benefit/risk, ownership/set effects, active event facts, and relevant public opponent profiles. Keep board state only to the extent the current phase needs it; do not put raw free-form model reasoning into decision memory.

- [ ] **Step 5: Replace the unconditional `slice(0, 32)` with the tested shortlist.**
  Stable-sort candidates by shared evaluator, preserve distinct candidate kinds and rescue paths, and send explicit truncation metadata. Serialize only sanitized DTOs with request-local opaque IDs; parse `actionId` against only those IDs actually shown to the provider. After the response, rebuild the full candidate set from current state and verify actor/seat, pending-payment identity, voting-event identity/phase, sponsorship request identity/terms, and every action-relevant trade/contract term before remapping the opaque ID. On omitted/invalid IDs, changed state, or stale candidate, use the deterministic fallback or safely abort a no-longer-current choice; never let a stale payment choice trigger bankruptcy after its obligation clears.

- [ ] **Step 6: Extend evaluation-only shadow outcome traces.**
  Reuse `AiAdvisor.shadow` and the Task 1 tournament runner to record selected action kinds (not raw player-linked IDs/offers), agreement, phase, candidate coverage counts, provider/model version, fallback, latency, and linked aggregate match outcomes. Keep these traces in the test/evaluation boundary unless the persisted trace schema is separately privacy-reviewed; never store candidate text or free-form rationale. Do not treat agreement alone as evidence of strength.

- [ ] **Step 7: Add provider-boundary tests.**
  Use `fetchImpl` stubs for valid IDs, invalid IDs, a legal-but-not-shortlisted ID, malformed JSON, timeout, quota, circuit-open, provider reconfiguration, and a stale trade/contract after the request. Verify every failure uses the existing legal fallback and no routine test makes a network request.

- [ ] **Step 8: Run `node server/botStrategicContext.test.js`, `node server/botAdvisor.test.js`, `node server/botLogic.test.js`, `node server/botCandidateCoverage.test.js`, and AI-shadow matchup fixtures.**

### Task 5: Add public-action opponent profiles and advanced search only behind evidence gates

**Files:**
- Modify: `server/botTableMind.js`
- Modify: `server/botStrategicContext.js`
- Modify: `server/botFuturePlanner.js`
- Create: `server/publicActionHistory.js`
- Modify: `server/gameLogic.js`
- Modify: `server/socketHandlerSupport.js`
- Modify: `server/serverSocketGame.js`
- Create: `server/bot-search-benchmark.js`
- Test: `server/botTableMind.test.js`
- Test: `server/botStrategicContext.test.js`
- Test: `server/bot-search-benchmark.test.js`
- Test: `server/bot-policy-tournament.test.js`
- Test: `server/gameLogic.test.js`
- Test: socket-action characterization tests for public action history

- [ ] **Step 1: Add tests for a bounded, anonymized public-action history and confidence-weighted profiles.**
  Record only a small allowlisted action kind, current seat index, and round at the authoritative successful-action boundary; cap the per-game log at 200 entries. Do not store stable player/account/socket IDs, offer contents, chat, amounts, holdings, or hidden information in this profile history. Cover bid/pass, purchase/build, and trade/contract accept/counter categories only. Derive weighted frequencies from observed entries; halve an observation's weight for each full round elapsed, keep zero/low-sample opponents `unknown`, and test the threshold/decay exactly. If a socket action cannot be classified safely, omit it rather than infer a category from resulting cash or holdings.

- [ ] **Step 2: Add a compact profile to opponent context and deterministic forecasts.**
  Ensure both policies can consume the same anonymized numeric profile. Do not reuse `desireClass`, `emotionReadout`, or `readMind` in this path; those infer labels from state or return stable IDs. Missing profile/history remains `unknown` and must preserve current AI and NO-AI choices.

- [ ] **Step 3: Compare policy with and without the profile on matched held-out seeds.**
  Add an explicit legality metric before relying on that gate. Compare every policy pair within fixed opponent strata and rotate seats. Enable the profile only if there are at least 30 independent completed held-out seed/opponent clusters, the paired interval is no longer `insufficient-sample`, the paired metric improves with uncertainty support, and no meaningful legality/completion regression appears. Otherwise remove the runtime feature and retain the benchmark result. The current history source records successful socket actions only, so profiles are human-action-only; bot-vs-bot tournament matches do not populate profile observations and cannot evaluate profile-on/off. Keep profiles disabled unless a separately consented human-vs-bot evaluation or an explicitly approved anonymized bot-action recorder provides valid held-out observations.

- [ ] **Step 4: Test bounded search variants separately.**
  Task 3 adds exact 2d6 enumeration (a fixed 36-outcome reference) and deterministic stratified sampling at budgets 16/64/256 as part of the bounded NO-AI forecast policy. This existing Task 3 runtime baseline remains enabled; Task 5 must not silently disable or broaden its allowlist. Report exact enumeration as a reference-only baseline, not as an equal-cost comparison with those three sample budgets; report stratified sensitivity separately at each permitted budget, labeling per-state budgets as nominal rather than total work. Add an offline UCT/progressive-widening comparison only if it uses the same public snapshot/scenario model with an explicitly equal deterministic node budget. If UCT requires inventing transitions outside the tested model, mark it unsupported/not-comparable rather than adding a full simulator. Keep only the new Task 5 search variants production-disabled until benchmark and held-out results support them; test information-set sampling only for hidden card outcomes and ensure actual deck order is never read. Keep the simplest variant that improves held-out results; do not port poker equilibrium or nested-belief algorithms wholesale.

- [ ] **Step 5: Gate α-Rank/AIVAT.**
  Run α-Rank only if measured matchups show intransitive cycles. Prototype AIVAT only if paired match intervals remain unacceptably wide and a known-policy/value estimator can be validated against synthetic toy games. Otherwise keep paired bootstrap intervals.

### Task 6: Reduce ordinary bot scheduling to 300 ms

**Files:**
- Create: `server/botTiming.js`
- Modify: `server/socketRuntime.js`
- Test: `server/botTiming.test.js`
- Test: `server/socketRuntime.test.js`
- Modify: `package.json`

**Interfaces:**
- `scheduleBotTimer(setTimeoutFn, callback, kind = 'turn')` uses `BOT_TURN_DELAY_MS = 300` for `turn` and `BOT_AUCTION_DELAY_MS = 450` for `auction`.

- [ ] **Step 1: Add failing helper and runtime-scheduler fake-timer tests.**

```js
const delays = [];
const fakeSetTimeout = (_callback, delay) => (delays.push(delay), { delay });
scheduleBotTimer(fakeSetTimeout, () => {}, 'turn');
scheduleBotTimer(fakeSetTimeout, () => {}, 'auction');
assert.deepEqual(delays, [300, 450]);
```

Also add `server/socketRuntime.test.js` coverage that creates a runtime with an injected fake `setTimeout`, calls its actual ordinary-turn and auction scheduling entry points using minimal fake rooms, and asserts the recorded runtime delays are `[300, 450]`. Keep these scheduling entry points on the runtime object as internal server APIs if needed for direct testing; do not expose them over sockets.

- [ ] **Step 2: Run both focused tests and verify the old runtime delay fails with an actual delay assertion, not merely an import error.**
- [ ] **Step 3: Route `scheduleBotTurn` and `scheduleBotAuction` through the tested helper.**
  Preserve timer maps, lock guards, room identity checks, and `runRoomTimer` behavior. Do not change the 4-second AI request timeout or the 130 ms-per-space animation.
- [ ] **Step 4: Run `node server/botTiming.test.js`, `node server/socketRuntime.test.js`, and `node server/server.test.js`.**
  If the environment blocks the server test's child-process spawn, record the exact permission error; the focused runtime scheduler test remains mandatory and must pass.

### Task 7: Final held-out evaluation and development-branch verification

**Files:**
- Verify: all files introduced by Tasks 1–6; Task 1 updates `docs/DEVELOPMENT_WORKFLOW.md` for the comparison CLI.

- [ ] **Step 1: Freeze policy IDs, code/prompt versions, primary metrics, evaluation seeds, variants, and seat rotations before the held-out campaign.**
- [ ] **Step 2: Run separate NO-AI and AI comparisons against current baseline, conservative/greedy/random-legal controls, and mixed-policy cross-play on standard-40 and Metro-52; add other variants only after those runs complete.**
- [ ] **Step 3: Run the full paired sample to completion or mark each capped match incomplete. Do not remove incomplete traces after inspecting outcomes.**
- [ ] **Step 4: Report win/placement by seat and policy, net worth, bankruptcy, completion, game length, action legality, stalls, fallback rate, candidate coverage, local CPU, provider latency, scheduler delay, paired confidence intervals, and total AI provider calls.**
- [ ] **Step 5: If direct human comparison is desired, run an opt-in local human-versus-bot pilot.**
  Use consented test sessions, rotate seats/rules where practical, and record only match outcomes and consented action-level metrics without account identifiers. Report it separately from bot-vs-bot simulations; do not make a general skill claim from a few matches.
- [ ] **Step 6: Do not claim stronger balance unless held-out complete-match comparisons support the claim; otherwise report improvements only in the specific verified metrics (for example, rent-estimate parity or lower scheduling delay).**
- [ ] **Step 7: Run `npm run test:full`, `npm run lint`, and `npm run lint:client`; confirm no UI files changed and the working branch is still `development`.**
- [ ] **Step 8: Leave changes on `development`; do not commit, push, or merge without separate approval.**

## Execution recommendation

Execute Tasks 1 and 2 first because the evaluator and rule-faithful projections are prerequisites. Tasks 3 and 4 share `botAdvisor.js`, `botLogic.js`, and strategic-context contracts, so implement them sequentially unless their write sets are first separated. Task 5 is gated by evidence; Task 6 is a small independent timing change. Integrate and run Task 7 sequentially on `development`.
