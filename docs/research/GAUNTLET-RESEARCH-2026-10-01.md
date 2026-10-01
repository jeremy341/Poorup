# GAUNTLET RESEARCH REPORT — Economy, Loan, Turn Order & Deferred Design Questions

**Date:** 2026-10-01 · **Method:** GAUNTLET multi-agent research phase (4 Featherless specialist slots × 2 rounds, cross-examination, evidence-based disagreement resolution)
**Slots:** Architect `zai-org/GLM-5.3` · Implementer `deepseek-ai/DeepSeek-V4-Pro` · Investigator `moonshotai/Kimi-K3` · Reviewer `Qwen/Qwen3.5-397B-A17B`
**Scope:** research only — no code changed. Backend-only constraint maintained.

---

## 1. Evidence base (all VERIFIED by prior audit campaign)

- Market: `E[1+drift] = 1.0` exactly; round-trip EV −3.96% (2%/side fee) at every horizon; no break-even; quote floor 10 unreachable (5.87σ); n=44,000 paths/cell.
- Event deck: 19 events, equal weights, deck-average `marketPriceMultiplier` = **0.95** (negative expectation; measured live).
- The 2% fee **does** apply to forced liquidation and bankruptcy sweeps (`bankruptcyApi.js:94`).
- Events announce one round before landing; the multiplier lands with the announcement round **still pending** → front-run EV = multiplier × 0.9604 (+10.4% tourism / +5.65% energy / −37.6% bubble / **−100%** credit-freeze & bank-run, because the exit is trade-locked at landing).
- Loan: $300 → $450 (406% APR). Taint blocks casino/contracts/sponsorship ≈ $130 expected value vs a $150 premium → the loan is ~**free** liquidity ($300 for ~$20 net).
- Margin: `MARGIN_MAINTENANCE_RATE = MARGIN_COLLATERAL_RATE = 0.25` → equity at open == maintenance → ~50% liquidation probability per round; margin is dead content. Derived per-round market σ₁ ≈ 3.5% (from floor-unreachability: ln(10)/(5.87·√128)).
- Seat 0 wins 76% **of decided games** — but 82% of bot games never resolve (fountain: Go+cards = 71.3% of bot income vs rent 28.7%). Win-rate on the decided subset is a survivorship-biased metric.

## 2. Consensus findings (independent convergence across slots)

| # | Finding | Slots agreeing |
|---|---|---|
| C1 | **The market is a coherent hazard surface, not a broken instrument** — capped upside (+10%), uncapped downside (−37%, −100%), fee-dominated, deck-EV 0.95 is intentional satire. The defect is narrower: the announcement front-run is a deterministic free lunch. | Investigator, Architect, Reviewer |
| C2 | **Fix: apply `marketPriceMultiplier` at announcement, atomically** — inside the same round-advance tick that publishes the feed, before any seat's decision point. Combo events need a supersede rule: each event's multiplier prices the quote exactly once (divided out when superseded by a combo). After the fix: front-run EV = 0; crash traps become fair warnings; zero economy rebalance. | all four (with conditions) |
| C3 | **Margin E1: maintenance 0.15, collateral stays 0.25.** Reviewer formally conceded its 0.20 position on the σ math: 5% buffer = 1.44σ = 7.6%/round liquidations (still dead content); 10% buffer = 2.86σ = 0.21%/round (~81% survival at 100 rounds) while housing-bubble (−37.6%) still annihilates any position. Invariant "equity ≥ 0 at liquidation execution" holds (gap-through needs a 4.3σ single-round move). | all four |
| C4 | **The 82%-unresolved rate is an economy-drain problem, not a turn-order problem.** Income fountain (71.3% Go+cards) outruns extraction. Turn-order fixes alone cannot resolve games. | Investigator, Reviewer, Architect |
| C5 | **Per-round starting-seat rotation** (`seat (r mod N) opens round r`) beats per-game randomization: it removes (not launders) the first-mover advantage, is deterministic, and preserves first-round goldens by construction (round 0 opens seat 0). Evidence-based rejection of the Reviewer's seat-identity-achievement objection: **zero seat-indexed achievements or season-scoring rules exist** (`achievementStore.js`, `seasonModule.js`). | Architect, Investigator (+ evidence ruling) |
| C6 | **T16: disconnected auction participants count as passed** for early-close — mirrors the shipped ballot-fix precedent ("departed seats do not block collective progression"). The 5s timer remains as backstop. | Investigator, Reviewer, Implementer |
| C7 | **E8: collateral seizure = 0.5 × current voluntary-sale value** (one basis, path-symmetric with the sell path), fixing the code/comment contradiction ("borrower's paid value" vs event-scaled cost, which currently pays seizure better than voluntary sale during inflation). | all four |
| C8 | **T2: `trading:false` should gate equity transfers too, and loan-backed cash must be blocked on equity transfers** (otherwise equity transfer is a taint-laundering channel into the casino). | Implementer, Architect, Investigator |
| C9 | T13 (in-flight auctions complete under bank-run) and E4 (`totalCash()` normalizes by active seats) are **intended** — document + pin tests. T9 (legacy-room override capture) is an objective bug with near-zero live impact — cheap one-line fix, low priority. | all four |

## 3. Disagreements resolved by evidence (GAUNTLET §25)

1. **Market EV "inconsistency" (Reviewer):** claimed −3.92% vs theoretical −4.00% implies hidden drift. Resolved: (1−0.02)²−1 = **−3.96%**, and the measured range −3.92..−3.98% brackets it — sampling noise, no contradiction. Claim withdrawn.
2. **Loan accounting (Reviewer):** the packet's "premium $150 vs taint $130" comparison was comparative, not additive; Reviewer's correction (total cost = $280 vs $300 emergency liquidity) agrees the loan is nearly free for *anyone* — solvent players lose the full $280. This refines, not reverses, the P-B recommendation.
3. **Rotation scheme:** Reviewer's per-game preference rested on seat-identity achievements that do not exist. Evidence ruling: per-round rotation. Reviewer's residual concern (golden regeneration) applies to both schemes equally.
4. **Graded vs binary loan taint: UNRESOLVED — product decision box** (see §4). Reviewer's micro-loan attack ($99 loans below a $100 threshold) is concrete and not yet refuted; the graded model needs anti-gaming constraints (aggregate outstanding across active loans, minimum loan size, taint lifetime = loan term). Binary + reprice ($450→$580, or 8-round term) is the fallback.

## 4. Product decision boxes (require a ruling before implementation)

| # | Question | Option A | Option B | Recommendation |
|---|---|---|---|---|
| D1 | Is the market a sink (satire) or an instrument? | Ship C2 only; market stays a −3.96% sink with fair hazards | Add dividend/fundamental term (Architect: f=1%, y=0.25%/round → break-even ≈8 rounds; Reviewer: y=0.5% + fee burn) | **A** — minimal change; keep hazard identity; revisit if market stays dead content after C2 |
| D2 | Loan taint: graded or binary? | Graded per-outstanding (Investigator/Architect), with anti-gaming constraints | Binary + reprice (Reviewer) | **Present both**; binary+reprice is lower-risk; graded is the better theme fit if gaming is bounded |
| D3 | Economy drain design | Cash demurrage 0.25%/round above $500 (Architect; punishes hoarding, spares property) | Upkeep tax ~0.5%/round on property value (Reviewer; targets the 71.3% flow) | Sim-sweep both (target: ≥60% resolution at 2,000 steps vs 18% today); demurrage is simpler and keeps "Go sacred" |

## 5. Final ruling table (all items)

| Item | Ruling | Action / params |
|---|---|---|
| E1 margin | **FIX** | maintenance 0.15 (collateral 0.25 unchanged); one-constant change |
| P-A market | **FIX** (C2) + **PARKED** (D1) | multiply-at-announcement, atomic tick, combo supersede rule (M1-R); dividends parked |
| P-B loan | **DECISION BOX D2** | graded taint (with anti-gaming) or binary+reprice; margin/short guard already shipped |
| P-C turn order | **FIX** (C4+C5 package) | per-round rotation r mod N + drain (D3 sweep); new metric: wealth-rank-at-timeout (composite: resolved→winner, unresolved→net-worth rank) |
| P-D bot budget | **FIX** (policy) | EV gates over quotas: build when marginal rent EV > cost; contracts only when expected value > decision cost; target contracts ≤5% of decisions |
| T2 | **FIX** (C8) | `trading:false` gates equity transfers + contract proposals; `hasLoanBackedCash` blocks equity-transfer funding |
| T9 | **FIX, low priority** | capture legacy optional-system settings into `rulesetOverrides` before the meta-key flip (`rooms.js:118-120` / `applyRulesetSetting`) |
| T13 | **DOCUMENT + PIN** | test: in-flight auction completes under bank-run |
| T16 | **FIX** (C6) | disconnected == passed in the pass-based early-close |
| E4 | **DOCUMENT (+ optional knob)** | threshold scaling by active-count is a product choice |
| E8 | **FIX** (C7) | seizure = ⌊0.5 × voluntary-sale value⌋; fix the comment |

## 6. Implementation roadmap (when approved)

- **Wave R1 (mechanical, low golden churn):** E1 (0.15) · E8 · T16 · T2 · T9 · T13/E4 docs+pins. One-constant changes and guard additions; existing suites rerun; new regression pins.
- **Wave R2 (market semantics):** C2 multiply-at-announcement + M1-R combo supersede rule. Requires: verify announcement-vs-advanceMarket ordering in the round-advance sequence; regenerate market-path/event goldens; pin "announcement tick quote already includes multiplier."
- **Wave R3 (economy/balance):** D2 loan decision → implement chosen model; D3 drain sweep (n≥10,000 games per cell, measure resolution rate + wealth-rank distribution); rotation r mod N; regenerate turn-order-dependent goldens.
- **Wave R4 (bot policy):** P-D EV-gate redesign in the advisor layer (design doc for the in-flight bot refactor; do not code until that refactor lands).
- **Metrics:** retire win-rate-on-decided; report resolution rate + wealth-rank-at-timeout as first-class outputs.

## 7. Experiments still required (helper requests from the slots)

1. Sim sweep: demurrage x ∈ {0.1, 0.25, 0.5}% × E ∈ {0, 500, 1000} vs upkeep-tax 0.3–0.7%/round — median game length, insolvency rate, event-trigger rates.
2. Seat-0 decomposition: win rate in zero-event games vs event games (separates property-first from event-edge capture).
3. Margin survival curves at maintenance ∈ {0.15, 0.20} (position lifetime distribution, n≥10,000).
4. Golden-diff estimate for M1/M4/R3 before committing to the golden churn.
5. Post-C2 borrower-EV re-measurement to confirm the loan is no longer free.

## 8. Slot confidence

Architect 0.82 overall (M1 coherence 0.85, E1 0.88, M4 0.8) · Implementer 0.90 patch designs, 0.85 product acceptance · Investigator 0.72 (no code access) · Reviewer 0.85, with one formal concession (E1) and one unsupported claim withdrawn (seat-identity achievements).
