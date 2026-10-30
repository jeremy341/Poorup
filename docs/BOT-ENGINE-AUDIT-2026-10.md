# Bot engine audit - October 2026

Scope: the no-AI planner and the AI advisor, end to end (candidate generation,
planner, advisor/provider layer, runtime scheduling, tournament harness). Method:
five independent reviewers (tournament/simulation, game logic A1, candidate
pipeline A2, planner A3, protocol/exploit F1) plus a literature pass. Every
"confirmed" item below was reproduced with a script against the working tree;
"suspected" means read-only reasoning. Repro scripts lived in the reviewers' temp
folders and are not part of the repo - the regression tests listed under each fix are.

Trigger: bots could raise an auction by $10 while players have +1, +20 and +100. Follow-up pass (same month) implemented the previously open items; a second follow-up (purchase policy, AI-layer call savings and option-ID bias, five smaller defects) is in the last rows of the table; section 2 lists what remains.

## 1. Fixed in this change

| Area | Defect | Fix | Pinned by |
|---|---|---|---|
| Auction | Bots bid +$10 | Bots raise with the player buttons only: +1, +20, +100 (`AUCTION_BID_INCREMENTS`, mirrors `clientAuctionUi.js`; a test compares the two lists). Planner opens at +20, +1 squeezes a tight budget, the AI picks from `amountOptions` | `audit-trade-auction.test.js`, `botLogic.test.js` |
| Contracts | A human could take any deed for a $1 loan; bots accepted any affordable offer, never repaid, countered away their cash, and bought equity slices at any price | New `botContractPolicy.js` (price, collateral, premium, term gates; `equity-transfer` priced by rent), counters bounded to the original terms, loan offers never aimed at bots, due repayment is a mandatory step that runs before any advisor | `bot-contract-policy.test.js` |
| Reconnect | A turn ending while the only other seat was in its reconnect grace wedged the table; a bot re-decided every 300 ms | Engine parks the clock on the waiting seat (`nextWaitingSeat`) | `reconnect-turn-wait.test.js` |
| Sponsorship | Bots funded `equity` requests as gifts (cash for a permanent share at the buyer's price) | Bots never fund equity-mode requests | `backend-fix-regressions-c.test.js` |
| AI provider | HTTP 429 locked the AI out until an admin re-saved the provider | 429 = bounded cooldown honouring `Retry-After`; only 402 is sticky and is re-probed every 10 min | `botAdvisor.test.js` |
| AI provider | Editing a profile's endpoint kept the stored key (key followed to a new host) | Host change requires the key again | `aiProviderConfig.test.js` |
| AI prompt | Sanitizer regex `.*id` also removed `highestBid`: the model never saw the current bid | Case-sensitive identifier test | `botAdvisor.test.js` |
| Trades | Group-trade ids collided when two give tiles shared an ask | Give tile is part of the id | `trades.test.js`, `bot-audit-fixes.test.js` |
| Planner | Every trade was projected against `opponent-1` (two thirds of proposals scored as disasters in 4-seat games) | Candidates carry `toPlayerSeat` | `bot-audit-fixes.test.js` |
| Planner | Tax tiles reached the planner with a $0 bill | `amount` exposed on tax tiles | `bot-audit-fixes.test.js` |
| Market | Event shock counted twice in its activation round (off by one between `marketRound` and `startedRound`) | Compare against `startRound - 1` | `botMarketForecast.test.js` |
| Purchase | Bot declined a deed "for a cheap auction" when auctions are off or paused | Gate on auction availability | `bot-audit-fixes.test.js` |
| Runtime | An unvoted bot was served first while the engine refused all votes (open payment/auction), starving the debtor | Vote phase and target selection skip while blocked | `bot-audit-fixes.test.js` |
| Fallback | After a refused action the next static-score candidate ran (unrelated market buys, loans, mortgages); a stale AI answer ran the static top | Deals/market/casino are never swapped for each other; stale answers fall to the turn rail | existing suites + 30-game simulation (0 stalls) |
| Planner | Bots never built, unmortgaged, or bought after round ~3 (0 houses in 100+ rounds, $6-25k idle) | Rent from a deed/house/unmortgage is credited over `INVESTMENT_ROUNDS` (16, x0.6) at every difficulty from a long-run traffic model (not one dice turn), builds get a convex path value toward 3 houses, opportunity cost applies only to net worth actually lost | `bot-economics.test.js` |
| Planner | Expert cost 160-390 ms per decision | Board-neutral landing projections are cached per snapshot; every level now enumerates dice exactly (16/64-sample rollouts were noisier at the same cost): Expert ~25 ms with 4 candidates | `botAdvisor.test.js` |
| Difficulty | House and Table played identically | House bids face value and never pays for a set it would complete; Table/Expert price progress and completion; Expert differs by search depth | `bot-economics.test.js` |
| Difficulty | The three levels were not ordered: 180 mixed games gave 31.1 / 35.6 / 33.3 % (House / Table / Expert, all intervals overlapping); the levels chose a different action in only 1.6 % (House vs Table), 3.0 % (Table vs Expert) and 4.2 % (House vs Expert) of decisions | The **investment horizon** (rounds of extra rent a deed, house or unmortgage is credited for) is now a level: House 8, Table 16, Expert 32 (`INVESTMENT_ROUNDS_BY_DIFFICULTY`, `investmentRounds()`). House is short-sighted and under-invests, Expert commits to deeds and houses earlier; no random mistakes, no weaker dice. Measured in section 2, finding 1 | `bot-difficulty-order.test.js` (mechanism), `bot-economics.test.js` (auction judgement) |
| Market | `open-short` scored +48 (true value -5); bots farmed shorts, never covered, drained the borrow pool, ended with unpaid `shortDefaultDebt` | Planner carries margin/short books like the engine (fees, liability, collateral, buy-in risk); opens only when expected value clears the hurdle (an announced crash); covers fund the largest quantity; new `settle-short-default` candidate | `bot-market-accounting.test.js` |
| Ranking | Round-limit winner and net-worth chart ignored shorts, spot units, margin, contracts | One `netWorth.js` used by the engine, the table brain and the chart series | `bot-market-accounting.test.js` |
| Trades | Group trades were inert (same-group 1-for-1 swaps, wrong cash sign); rich trades skipped the veto; veto lifted when the buyer held under one house of cash; near-miss counters could break the bot's own set; declined offers repeated and value-neutral swaps ping-ponged | Completer offers (cash, or another group's loose deed plus cash) priced by one function; veto nets returned deeds and drops the cash condition (lifts only against the 2x monopoly premium); counters and acceptance refuse to break a complete set; 4-round per-(partner, deed pair) cool-off; swaps gaining under $20 are not made | `bot-trade-rework.test.js` |
| Purchase | Landing on a deed the bot would bid for at auction could still end in a decline: the planner bought 22 of 22 deeds at $1500 but 8 of 22 at $600 (scores -0.4 to -13 for deeds whose auction ceiling was 300 to 540), and a deed that completed a set needed $120 on top of its price | `shouldBuyWithPlan` buys when the planner scores the deed at or above standing still **or** the price is within the auction ceiling (`auctionBidDecision`: cash minus the live liquidity reserve, capped by `auctionWillingness`); a completing deed is exempt from the +$120 floor (`completesColourSet`, planner still decides). The planner veto now binds only where the auction would not pay the price (live reserve above $120, e.g. a rival set with houses) | `backend-bot-fixes.test.js` (F2 checks, B-23 rewritten to the new contract) |
| AI layer | A pre-roll whose options all scored at or below standing still still cost a provider call (about 77 % of calls) | `AiAdvisor` answers deterministically, with no provider call and no budget spent, when there is one candidate or a pass sits next to options the planner fully projects at or below standing still + $1 (`STAND_STILL_MARGIN`). Recorded as a house decision with the existing by-design reason `phase-resolution` (neither a model ask nor a model failure in `classifyBotDecision`) | `bot-advisor-ai-layer.test.js` |
| AI layer | Candidate order put the planner's best first (`act-01`): echoing the first option looked like good play | The order shown to the model is a seeded shuffle (`gameId:decisionSequence:phase`), the token maps back to the real candidate, each answer logs `optionPosition`, `optionCount`, `plannerBestPosition` and `getHealth().optionPositionBias` counts first-position and planner-best answers. The harness `ai-stub` used to echo the first option (= the planner best); it now picks on the planner score (`stubPickCandidate`) so AI-vs-house comparisons keep their meaning. Tournament tests that relied on a provider call at every step run longer (few steps now reach a real model decision) | `bot-advisor-ai-layer.test.js` |
| Jail | Every opponent was labelled `opponent-1`, so a colour set split between two rivals read as one rival's monopoly and the bot over-valued staying in jail | The jail board uses the canonical `seatOf` labels | `backend-bot-fixes.test.js` |
| Debt | A 50 % premium bank loan outscored selling a built house (loan 5.5 vs sale 1), against the documented rescue ladder | A loan whose premium rate reaches the house-sale loss (`1 - buildingSaleMultiplier`) is the last resort before bankruptcy; a fair (20 %) loan still comes first | `backend-bot-fixes.test.js` |
| Post-roll | A bot with $0 after its roll had bankruptcy as its only candidate while a loan was on offer | The loan is offered ahead of bankruptcy | `backend-bot-fixes.test.js`, `bot-simulation.test.js` |
| Market / casino | Market buys, market sells and casino bets were offered while the bot's own trade or contract was open; the engine refused every one (11 market buys plus the bet per tick in the repro) | Candidates are withheld while `tableObligationPending()` is true, the engine's own guard. Expansion candidates (margin, short, option) already ran the engine's `expansionGuard`, so that part of the audit claim was stale | `backend-bot-fixes.test.js` |
| Harness | Step cap censored every planner game; fixed auction order; stub AI never sent a bid amount; advisor shared across matches; seeds list truncated; mortgaged deeds at full price | Step limit scales with the round limit, `completionKind` on every result, rotating auction order, stub sends a legal `amount`, fresh advisor per match, full seeds list, engine net-worth rule | `bot-tournament-harness.test.js` |

## 2. Open findings (not changed)

Measured after the changes: 30 of 30 three-bot Table games finished with a winner (median round 30, longest 66; winner seats 11/8/11). The earlier 45-game mixed run (17/10/18) was too small to say anything (see finding 1 for the measured ordering). A bot refuses to sell a tile from its own complete set at any price (hard rule; soften if too rigid).

1. **Difficulty strength** (fixed, see the Difficulty row in section 1; this entry is the measurement). Harness: `simulateBotMatch`, 3 no-AI bots (`brain no-ai`, one level each), the harness economy (start cash 500, casino, market and events on), full 300-round limit, seat order rotated through all three rotations per seed so the first-mover edge cancels, seeded. Win share = games won / games finished; every game finished (no stalls, no step-limit; 1 to 5 in 300 ended at the round limit). Intervals: Wilson 95 % for a share, seed-clustered normal 95 % for a gap (the three rotations of one seed are not independent).
   - **Before** (unmodified code, 180 games, seeds 1-60): House 31.1 %, Table 35.6 %, Expert 33.3 %; Expert - House +2.2 points [-5.2, +9.6]. Repeated on seeds 1001-1100 (300 games): 31.3 / 32.7 / 36.0 %, Expert - House +4.7 [-1.1, +10.4]. The levels were statistically indistinguishable.
   - **Diagnosis**: replaying one stream of 1,866 decisions under all three levels, the chosen action differed in only 29 (1.6 %) House vs Table, 56 (3.0 %) Table vs Expert, 79 (4.2 %) House vs Expert, almost all of them build / unmortgage timing. The dice horizon (0, 1, 3 turns) only moves the rent-risk, card-cash and pass-start terms, which do not depend on the candidate; the terms that do decide a build (investment rent, +90 set completion, net worth) were identical at every level. Auction ceilings differ only for a deed that completes or advances a set, which is rare (mean face premium per game 106 / 107 / 97).
   - **Change** (smallest one the diagnosis supports): the investment horizon per level (House 8, Table 16, Expert 32 rounds). Chosen from four Expert-only sweeps on seeds 1-60 (liquidity x5, rent risk x3, investment 32, opportunity cost x10; only investment 32 helped, the others were neutral or worse), then validated on fresh seeds.
   - **After**, validation seeds 1001-1100 (300 games, partly used to choose House 8 over House 16): House 26.3 %, Table 31.7 %, Expert 42.0 %. Untouched seeds 2001-2100 (300 games, final code): **House 23.0 % [18.6, 28.1], Table 32.7 % [27.6, 38.2], Expert 44.3 % [38.8, 50.0]**; Expert - House +21.3 points [+13.5, +29.1], Expert - Table +11.7 [+4.5, +18.8], Table - House +9.7 [+3.0, +16.4]; mean placement 2.11 / 2.05 / 1.83; bankruptcy rate 76.7 / 66.7 / 55.0 %.
   - **Head to head** (2 bots, seeds 2001-2150, both seat orders, 300 games each): Expert beats House 75.3 % (Wilson [70.2, 79.9]), Table beats House 69.7 % [64.2, 74.6], Expert beats Table 59.7 % [54.0, 65.1].
   - **Behaviour** (seeds 2001-2100): mean builds per game 4.4 / 9.5 / 13.5, houses owned at round 40 about 4.5 / 6.4 / 8.7 (House / Table / Expert); the cause is visible as earlier, more building rather than a different auction.
   - **Cost** (quiet machine, one process, 8 three-seat games, about 16 candidates per decision, `DeterministicAdvisor`): House 1.4 ms, Table 1.8 ms, Expert 41.7 ms per decision on average (worst single decision 386 ms). The horizon change adds no computation. The earlier "about 25 ms with 4 candidates" figure is a different candidate count; at 16 candidates Expert costs about 2.6 ms per candidate.
   - **Caveats**: the harness economy is not the default room (see F-083); the ordering is for no-AI bots, the AI arm was not re-measured; Table - House is the smallest gap (about 10 points) and the 1001-1100 set (+5.3 [-1.7, +12.4]) alone did not exclude parity; the sweep tried four settings, so only fresh-seed numbers are quoted as evidence.
2. **Purchase policy** (fixed, see section 1). Side effect to watch when tuning: with the flat $120 reserve the auction ceiling is cash minus $120, so a deed that passes the cash floor is now always bought; the planner's per-deed veto only binds when the live liquidity reserve exceeds $120. If Table/Expert should decline deeds the planner rates well below standing still, the lever is the auction ceiling (it should read the planner's marginal value), not the purchase rule.
3. **Smaller** (still open): non-election votes default to the first option (a targeted bot votes to cap its own rent); sponsorship can leave a buyer at $0; voluntary house-sale candidates are offered whenever cash < half the starting cash regardless of need (the planner scores them negative so the house bot does not pick them, but the AI sees them; the replacement gate - cash below the live liquidity reserve? an obligation in sight? - is a design decision); bankrupt/disconnected opponents still roll in projections; landing model lacks Go-To-Jail and doubles (`GROUP_TRAFFIC_PERCENT` should be regenerated from the Markov chain); pending player contracts never expire and bots cannot cancel them; bots cannot see announced (warning-phase) market shocks.
4. **AI layer**: the 240 decision cap was spent by ~round 100 because of calls where nothing beats passing; those are now answered locally (section 1), so the cap should last longer - re-measure before changing it. The new position-bias counters (`getHealth().optionPositionBias`, per-decision `optionPosition`) are not yet written into the match decision log or telemetry (`socketRuntime.js` only forwards fixed fields); until then they are visible through the provider health payload only.
5. **Harness**: first-mover edge remains (seat 0 won all three fixed-order test games; fixing it needs an engine turn-order change); the suite's default sample is now 60 games (`POORUP_BOT_SIMULATION_COUNT=1000` for the campaign) because games now run to the end.

## 3. Decisions still open

- Soften the hard "never sell out of a complete set" trade rule?
- ~~Should Expert beat House in outcome?~~ Done: the investment horizon is a level (finding 1). Open: whether Expert's higher bankruptcy-avoidance should also come from a real liquidity-shortfall term (the sweeps showed a flat liquidity weight does not help).
- Add a +1 raise button for humans? (Humans already have +1, +20, +100, so bots now match.)
- Contract TTL and a bot cancel path; humanless bot rooms policy; the 240-call AI cap (re-measure after the call savings).
- What counts as "need" for voluntary house sales (finding 3), and whether the auction ceiling should read the planner's marginal value (finding 2 note).

## 4. Recommended order

1. ~~Tune finding 1 against the harness~~ Done (investment horizon per level). A harness runner that takes `id:difficulty` policies and prints these tables would make the measurement repeatable from `bot:compare`; today it was done with a throw-away script around `simulateBotMatch`.
2. AI: ship server-computed trade facts instead of prose rules, per-pair decline cool-off; write the position-bias counters to the decision log.
3. The remaining smaller items in finding 3.


## 5. Research used

Opened and read at abstract level unless noted (full text: Beurer-Kellner, Miller).

- Meta FAIR Diplomacy Team 2022, *Cicero*, Science (language model + planning).
- Duan et al. 2024, GTBench, arXiv 2402.12348 (LLMs weak in deterministic games).
- Hu et al. 2026, FinBoardBench, arXiv 2605.27896 (Monopoly among three games: LLMs favour
  assets over liquidity; static reasoning does not transfer).
- Abdelnabi et al. 2023, arXiv 2309.17234 and Bianchi et al. 2024, arXiv 2402.05863
  (negotiation needing arithmetic; tactics move payoffs).
- Ahn et al. 2022, SayCan, arXiv 2204.01691; Kambhampati et al. ICML 2024, LLM-Modulo,
  arXiv 2402.01817 (pair an LLM with an external verifier).
- Beurer-Kellner et al. 2025, action-selector pattern, arXiv 2506.08837 (full text).
- Zheng et al. ICLR 2024, arXiv 2309.03882 (option-ID bias); Tam et al. 2024,
  arXiv 2408.02442 (format restriction hurts reasoning).
- Atil et al. 2024, arXiv 2408.04667 (nondeterminism at "deterministic" settings);
  Xiong et al. ICLR 2024, arXiv 2306.13063 (verbalised confidence is overconfident).
- Chen et al. 2023, FrugalGPT, arXiv 2305.05176; Lin et al. NeurIPS 2023, SwiftSage,
  arXiv 2305.17390 (cascades).
- Fish et al. 2024, arXiv 2404.00806 and Lee 2026, arXiv 2610.11256 (same-model LLM
  agents drift to supracompetitive outcomes; prompt wording matters).
- Greshake et al. 2023, arXiv 2302.12173; Hines et al. 2024, arXiv 2403.14720
  (indirect prompt injection; spotlighting).
- Miller 2024, arXiv 2411.00640 (clustered standard errors, paired differences, power);
  Kapoor et al. 2024, arXiv 2407.01502 (cost-aware agent benchmarks).
- Belle et al. 2025, arXiv 2506.04651 (Catan); Karten et al. 2025, arXiv 2503.04094
  (LLM inside minimax).

Not verified, listed only as leads: Outlines (2307.09702), XGrammar (2411.15100),
Lost in the Middle (2307.03172), Instruction Hierarchy (2404.13208), AgentDojo
(2406.13352), CaMeL (2503.18813), Reflexion (2303.11366), LLM-MCTS (2305.14078),
Statistical Precipice (2108.13264). No standalone Monopoly-LLM paper was found, and no
study of illegal-move rates for free-form versus candidate-ID selection.
