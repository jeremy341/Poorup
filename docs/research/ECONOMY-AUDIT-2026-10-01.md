# ECONOMY + GAMEPLAY AUDIT — Poorup `server/**`

**Date:** 2026-10-01 · **Branch:** `development` @ `c6f9e65` (tree clean) · **Method:** 11 read-only review slots (4 batches) + 1,000-game balance campaign + cross-cutting drift pass
**Baseline:** core 107/107 · full 158/158 · lint 0 errors / 3 pre-existing warnings
**Scope:** `server/**` gameplay + economy. `public/**` (UI) excluded. Zero code changes.

**Verdict counts:** 22 BUG · 21 DESIGN-QUESTION · 9 DEBT · 6 OBSERVATION · 4 claims DISCARDED on cross-check.

---

## 1. Critical — money loss / game-breaking (fix first)

| # | Finding | Slot | Evidence |
|---|---|---|---|
| **B-01** | **A lender can self-accept their own contract adjustment** — propose $100, `adjust` to $4000/100%/1 round, `respond(accept)` succeeds. Borrower pays $1000, owes **$8000 in 1 round, no collateral**; the borrower's own respond then says "no matching contract". Hybrid variant hands the lender 100% of a deed's rent for free. | S4 | `contractLogic.js:91` `draftContract` never sets `lastProposerId`; `:668` falls back to `counterDepth` parity; at depth 0 the proposer *is* the responder. The sibling counter path (`:297`) sets it correctly, and `serverSocketGame.js:36-39` documents "parity alone echoes offers back to their author". **Verified by probe.** ⚠️ `contracts-market.test.js:170-181` pins the inversion for the counter→adjust chain — needs updating. |
| **B-02** | **`reservedCash` is never enforced — margin/short collateral is fully spendable.** Comment at `marketExpansion.js:6-9` says collateral is "held separately from free cash". Probe: `openMargin(10)` → cash 1230, collateral 250 → a $250 casino bet succeeds → −1% tick liquidates and credits the 250 back. **Net +$200 created from nothing.** Secondary: forced liquidation returns 98% of value vs 75% via voluntary reduce, so **being liquidated is ~6× cheaper** than reducing. | S1 | `reservedCash` written at 8 sites, read only by the planner/snapshot. No cash-spending path checks it. |
| **B-03** | **Hybrid pledged collateral is never re-validated at settlement** (the loan sibling is). Probe: propose hybrid $1000 pledging tile 3 → mortgage tile 3 → **accept succeeds** → past cure: `converted`, no claim filed, lender recovers $0 on a $1350 write-off. | S4 | `bankruptcyLogic.js:77-81` routes hybrid to `hybridContractRejection` → `propertyShareRejection` which validates only the *conversion target*, never the basket. `loanCollateralRejection:37-42` states the rule in its own comment. |
| **B-04** | **Non-`declareBankruptcy` bankruptcy leaves table obligations blocking every survivor** (AFK kick, bot payment default). Probe: after the event, all seats get "Resolve the table obligation first" on borrow/manage/contract/trade. **The table can only be escaped by ending the game.** | S3 | `clearQuitObligations` is called only from `bankruptcyApi.js:25`. `gameLogic.js:1121` and `socketRuntime.js:73` reach `handleBankruptcy` without it. Directly contradicts `bankruptcyLogic.js:102-107`. |
| **B-05** | **A voluntary leave freezes the bank loan on the dead seat** — player keeps $300 principal + up to $240 premium by leaving instead of paying. Probe: after `removeRoomSeat`, loan still `active`/`remaining:450` after 10 further rounds. | S3 | `rooms.js:1054` `settleSeatExit` omits `settleBankLoanOnBankruptcy`; `loanLogic.js:280` skips bankrupt players. Contradicts the comment added in the earlier fix. |
| **B-06** | **Ghost seat takes 1st place.** A disconnected player holding $5,000 outranks the crowned winner ($100) in the placement projection → winner is scored 2nd (−40 season pts, no win credit), and `accountStore` disagrees with itself (`:289` seat-order wins vs `:230-235` cash-rank placement). | S8 | `rooms.js:1079` calls `endGame()` with no waiting-for-seat guard (contrast `gameLogic.js:944`); `accountStore.js:230-235` ranks all seats by cash including disconnected. |
| **B-07** | **One game can sweep all four placement rewards (480 tokens).** Probe: 10 accounts, 1 game each, one winner → bronze+silver+gold+top all unlock. | S9 | `rewardEligible:404-412` gates only on rank, with no minimum-games guard. `WIN_RATE_MINIMUM` exists but is used only for the `rate` metric. Contradicts the comment at `:29-30`. |
| **B-08** | **Loan-backed bot soft-locks the table** (round never advances). Sponsorship collectors lack the loan-taint guard that casino/market/contract collectors have, so a loaned bot is scheduled as funder, is rejected by the server, never advances its ledger, and the "dead request" cancellation can never fire. | S5, S10 (independently) | `sponsorshipLogic.js:41-51,:82` unguarded vs `sponsorshipApi.js:112` rejecting. `contributeAsSponsor:209-215` skips `recordSponsorLedger` on failure. Sibling guard + rationale at `botApi.js:889-893`. |
| **B-09** | **Board-variant downgrade starts an over-capacity table.** Probe: metro-52 with 6 seats → `setRoomSetting('boardVariant','standard-40')` returns `rejected:false`, maxPlayers silently drops to 4, game starts with **5 seats** on a 4-seat board. The sibling `maxPlayers` path correctly refuses. | S8 | `rooms.js:166-177` clamps without a seat check; `rooms.js:89-93` `capacityAllowsSetting` exists for exactly this and is bypassed. |
| **B-10** | **`settleShortDefault` bypasses the whole guard ladder.** Probe: settled $200 with `settings.market=false`, an active bank loan, off-turn, quota consumed, auction pending, mid-bank-run → `{success:true}`. | S1 | `economyApi.js:445-456` hand-rolls guards; `marketExpansion.test.js:148-149` states it "shares the guard with the expansion actions" — it does not. |

## 2. High — correctness defects

| # | Finding | Slot | Evidence |
|---|---|---|---|
| **B-11** | **Economy snapshots alias live position objects.** `snapshot.market.positions.ghana === player.marketPositions.ghana` is `true`; mutating the snapshot changed live state to `-999`. The sibling `quoteHistory` is deep-cloned on purpose and test-pinned. Latent (no current caller mutates). | S2 | `economyApi.js:79-82` shallow spreads; `marketQuoteHistory.test.js:61-75` pins the correct pattern. |
| **B-12** | **Card GO salary drops the $100 last-place catch-up bonus.** Identical roll: $300 via dice vs **$200** via any of the 7 movement cards. | S6 | `cardApi.js:116-123` re-derives the salary inline instead of calling `startPassReward()`; `gameLogic.js:869-877` + its comment + feed string state the rule. |
| **B-13** | **Build/sell lack the `equityShares` guard that trade/mortgage have.** Probe: owner with a 100% equity share → `isTradeableTile=false`, `canMortgageTile=false`, but **`canBuildOnTile=true`**. Owner pays 100% of construction and receives 0% of the rent. | S6 | `propertyRules.js:21,:159` reject equity-bearing tiles; `ownedUnmortgagedProperty:34-39` and `ownedPropertyTile:107-112` do not. |
| **B-14** | **Inflation-spiral applies the loan premium twice** — 1.5667× instead of the declared 1.25×. $300 principal: $535 due instead of $488. | S3, S7 (independently) | `loanLogic.js:41` hardcodes `*= 1.25` then multiplies by the declared `loanPremiumMultiplier` (also 1.25, `globalEventData.js:42`). Siblings interest-rate-shock/stagflation/debt-amnesty are effects-only. `tileApi.js:125-139` documents the correct non-stacking precedent for the tax path. |
| **B-15** | **Foreclosure seizes the deed and recovers $0.** Every severity tier: fair $360 / predatory $450 / extreme $540 due → **$0 recovered**, borrower nets +$300 minus a $60 deed. Max property price on the board is $400, so **totalDue always exceeds best-possible recovery**. Strategic default is guaranteed +EV. | S3 | `loanLogic.js:226-240`. The write-off itself is test-pinned (`:471-485` asserts `remaining===0`); the *magnitude* is the balance question. |
| **B-16** | **Plain player-loan bankruptcy records no default claim** (the hybrid sibling does). Lender loses full principal silently, contradicting the "keep the unpaid principal as a server-side claim" comment. Compounds with `settleDefaultClaim` being unreachable (below). | S3 | `bankruptcyApi.js:177-185` calls only `seizeCollateralForLender`; hybrid at `:170` explicitly calls `handlePlayerLoanDefault` "the default helper records the claim". |
| **B-17** | **Every recorded default claim is permanently uncollectible.** No socket verb, no GameState method, no call site — only tests. Up to 200 open claims/game accumulate. The comment promises a "deterministic recovery path". | S3 | `bankruptcyLogic.js:187`; claims still written on the live path (`:155`). |
| **B-18** | **Equity rent is invisible to scoring.** Holder receives cash; `rentCollected` is booked on the *contract*, never the player. A 100%-equity landlord scores **0%** of real rent income, and the deed *owner* is scored on rent they gave away. Also blocks `rent-reaper`. | S4, S9 (independently) | `contractLogic.js:976` vs `creditRentTo` (`gameLogic.js:1094-1108`, which documents all four facts a rent credit touches). Read by `participantFields.js:42`, `seasonModule.js:260`, `accountStore.js:292`. |
| **B-19** | **`supply-chain` hard-blocks construction although its declared effects don't include it**, making its own `buildingLimitPerTurn: 1` unreachable; **`bank-run` blocks construction without declaring it**, while its combo `moral-hazard` (same `bankActionsBlocked` fiction) does not. | S7 | `globalEventsApi.js:37-38` if-ladder vs `globalEventData.js:150,:190`. |
| **B-20** | **Cross-contract `requestId` collision strands the table.** Accepting contract #1 then #2 with the same id returns #1's memo, leaves `pendingPlayerContract` set, table blocked. Same for `repayContract`. | S4 | `contractLogic.js:742-746` — key has no `contractId` and the memo is read *before* the id check. |
| **B-21** | **Equity payout is clamped by `owner.cash`** — with a broke owner, a 70% share of a $26 rent pays **$0** and the rent is destroyed rather than deferred. | S4 | `contractLogic.js:972`. |
| **B-22** | **Overfunded escrow gives the buyer rounding dust.** Sponsors are floored (loss), buyer gets the remainder (gain). Bounded at ≤(contributors−1) dollars. Contradicts the pinned intent comment. | S5 | `sponsorshipApi.js:344-362` vs `sponsorship.test.js:102-103`. |
| **B-23** | **Bot buys are net-negative under the planner's own math.** `pass` has no applier → returns `score: 0`, and `plannedPurchaseDecision` reads the score raw. Sweep: **180/192 (94%) of accepted buys score net-negative**, average true margin **−13.1**; the comparison baseline is 37–233. | S11 | `botLogic.js:399-402` + `botFuturePlanner.js:353-357`. Same defect class the codebase already fixed in `botFuturePlanner.js:322` and `botAdvisor.js:61-66`, missed a third time. |
| **B-24** | **Loan-contract candidate score is inversely correlated with its own acceptance probability** — score rewards the poorest targets, but acceptance needs `totalDue <= cash*0.8`. Every candidate scoring >10 is one the responder cannot service. | S10 | `botApi.js:397-406` sizes off the lender, scores off target poverty; `botLogic.js:156-158` is the accept gate. Same class as the loan-taint guard fixed earlier. |
| **B-25** | **Contract candidates outrank building for 5/6 personalities, and the gap widens exactly when the table is poor** (rivals at $150: all 7 build candidates rank below one contract). This *is* the measured "16.1% contracts vs 1.7% building". | S10 | `BOT_BUILD_SCORE_DEFAULT = 10` (`botApi.js:198`) is the lowest score of any recurring economy action. |
| **B-26** | **Build tie-break picks the cheapest tile, not the highest-yield.** All builds share one score, so the `risk` tie-break (`cost/cash`) orders them cheapest-first: the bot fully develops Brown ($50) before touching Dark Blue ($200) — 2.4× worse return per dollar. | S10 | `botApi.js:185-187` + `:790`; the `:706-708` comment claims "risk asc" is what happens. |
| **B-27** | **Metro Gold/Silver are missing from all three `GROUP_TRAFFIC_PERCENT` tables** → fall through to 100%. Metro Silver undervalued ~10% vs Dark Blue's 90%; valuation error **−10%…+30%** depending on tier. | S6, S7, S11 (all three) | `botTradeValuation.js:13`, `botDevelopmentForecast.js:13`, `botTableBrain.js:12` — none enumerate the metro groups from `boardRegistry.js:16-19`. |
| **B-28** | **metro-52 ships 6 railroads and 4 utilities but the rent ladders stop at 4 and 2** → owning 5th/6th railroad or 3rd/4th utility pays the same as the last rung. **$700 guaranteed −100% return per player** (up to $4,200/table). | S6 | `boardRegistry.js:58,69,70,82` vs `gameData.js:20` and `botRentForecast.js:85,91` clamps. |
| **B-29** | **`premiumRentMultiplier` is silently dropped for Metro Silver under tourism-boom** — receives ×1.00 where the declared effect is 1.3, while the sibling path applies it. | S7 | `botRentForecast.js:6` hardcodes `tile.group === 'Dark Blue'` while `:39` lists Metro Silver as premium. |
| **B-30** | **Snapshot literal `borrowableUnits: 50`** — the live pool is `game.marketShortInventory` (decremented per short, room-global). Wrong value, wrong shape, wrong scope. Plus `marketExpansion.shorts` ships a flat map where the planner expects `{reservedCash, positions}`, so every real `cover-short` projects `unsupported`. | S1, S11 | `botStrategicContext.js:418` and `:162` vs `botFuturePlanner.js:227-229`. |
| **B-31** | **Planner understates margin collateral 13.5×** ($1000 gross: modelled $20, live $270) → margin opens look far cheaper than they are. | S11 | `botFuturePlanner.js:252` never charges collateral; `marketExpansion.js:154-161` charges `fee + ceil(gross*0.25)`. |
| **B-32** | **`opponentIsJailed` lookup always misses** — `seatOf` and `opponentView` use different index bases, so full rent risk is charged for a jailed owner whenever the bot isn't the last seat. | S11 | `botStrategicContext.js:36` vs `:217`; `botFuturePlanner.js:494`. |
| **B-33** | **Unclaimed prior-season rewards are unreachable after rollover** — the comment says the caller names the prior season, but the only production caller passes none. Forfeits bronze/silver/gold/top tokens permanently. | S9 | `seasonModule.js:390-391` vs `serverSocketSocial.js:272`. |
| **B-34** | **`get-season?metric=mastery` returns points** — `seasonMetricValue` has no `mastery` key, so the socket whitelist returns `row.points`. | S9 | `serverSocketSocial.js:255` vs `seasonModule.js:220-239`. |
| **B-35** | **Ruleset creation accepts house/hotel limits the live setter rejects** — `createRoom({rulesetOverrides:[{key:'houseLimit',value:0}]})` succeeds while `setRoomSetting` returns "Invalid value". Room legality depends on the endpoint. | S8 | `roomSettings.js:62-63,96-98` (enumerated) vs `rulesetRegistry.js:112-113` (ranges). |
| **B-36** | **Legacy carry-forward is discarded on a `rulesetPreset` write** — the fix that landed last session is bypassed in the same call, re-stripping the optional systems. | S8 | `rooms.js:140-144` promise vs `rooms.js:158` clearing overrides. |

## 3. Balance (quantified — need a ruling, not a code fix)

| # | Finding | Number | Slot |
|---|---|---|---|
| **BAL-01** | **~95% of a match is unreachable.** Mean events per game: **0.97** (4p/100r), **0.28** (2p/16r — **71.7% of games see no event at all**), 1.52 with surprise draws. `globalEventLimitReached` caps at 1 headline, and only 12 of 19 events can anchor a combo. The 25-entry table is ~94% decorative. | S7 |
| **BAL-02** | **labor-strike is the largest table-wide drain** — $20 × 18 buildings × 6 rounds = **$2,160 = 1.44× startingCash**, exceeding housing-bubble. A hotel (rent ×125) costs the same $20 as a 4-house (×80). | S7 |
| **BAL-03** | **rent-control's `rentCap: 150` is a near-total wipe at the top end** — Marina Bay hotel $6,250 → $150 (**−97.6%**) against a +$25 stipend. | S7 |
| **BAL-04** | **Both card decks are a net faucet: +$890 per 32-card cycle (+$27.8/draw)** before variable repairs. No table loses when a deck is exhausted. | S6 |
| **BAL-05** | **Selling houses pays out at the *inflated* event cost** — construction-shutdown (×1.75) refunds $175/house on a $200-base group vs $100 baseline. ≈**+$2,000–2,500** on a typical board. | S6 |
| **BAL-06** | **Both card decks and GO structurally dominate** — measured 71.3% GO+cards vs 28.7% rent, and the planner gives GO/cards the two *lowest* positive weights (0.25/0.35) while `setCompletion` pays 90 (170 counting `groupPotential`). Inverted vs measured composition. | S10, S11 |
| **BAL-07** | **`low-tax` (the default event policy for 4/6 personalities) is a net loss of ≈ −$40/turn** for the measured income mix. `public-works` costs a rent-collecting builder ≈ −5% of income. | S10 |
| **BAL-08** | **`loan:emergency` is unreachable at default (predatory) severity for 5/6 personalities** — needs $300 cash, but `LOAN_OFFER_CASH_CEILING` is $250. Bots only ever borrow reactively. | S10 |
| **BAL-09** | **House payback is sub-landing on every group at every level** (worst 0.71 of one opponent landing); rent-per-lap favors completeness, so Metro Silver is the 2nd-worst rent-per-dollar group yet dominates Green on the metro board. | S6 |
| **BAL-10** | **Interest-rate shocks compound uncapped**: $540 → $2,189 (~4.1×) across four sequential events, repricing a player into certain default by luck alone. | S3 |
| **BAL-11** | **The 1 USD minimum fee makes small tickets 2–5× the advertised rate** — 10% one-way at the $10 quote floor, so a spot round trip costs 20% there vs 4% at ≥$50. | S1 |
| **BAL-12** | **Equity asks are priced off lender cash, not rent yield** — a $200 ask for a 15% share earning ~$4.2/turn over 10 rounds (**−93% to −98%**). No rational counterparty ever accepts; the 100% cap makes the worst deals the only ones on the table. | S4, S10 |
| **BAL-13** | **Season scoring rewards a grinder over a winner.** Mastery ignores placement entirely: a 9-game season gives a 0-win grinder 504 mastery (unlocks `season-master`) and a 9-win non-trader 0. Per-match, a diligent 2nd place (116) beats a lazy winner (105). | S9 |
| **BAL-14** | **Legal room settings can break the economy**: `houseLimit 0` (registry-legal) removes **96% of board rent** and permanently disables housing-bubble; `startingCash 0` makes two event gates unconditionally eligible and `bank-run` permanently ineligible, leaving a $300/406%-APR loan as the only capital. | S8 |
| **BAL-15** | **Only 173 of 1,000 games resolve within 2,000 steps (17.3%)** — the income fountain outruns extraction. | campaign |

## 3b. Measured campaign (deterministic, this audit)

**CORRECTION — the earlier campaign ran at the wrong economy.** `bot-simulation.test.js` hardcoded `startingCash: 500` while the shipped room default is **1,500** (`roomSettings.js`). Every number in the first run therefore described a low-capital variant, not the real game. The harness now takes `POORUP_BOT_STARTING_CASH` and defaults to **1,500**; `balanceMetrics` also gained a real `incomeComposition` report (rent / realized market P&L / casino / loans).

Measured at the shipped default (120-game run, 3 bots, identical policy per seat):

| Metric | $1,500 (shipped) | $500 (old harness) |
|---|---|---|
| Games resolved (of 120/200) | **11 → 9.2%** | 36 → 18% |
| Median rounds / p95 | 102 / 136 | 114 / 133 |
| Median steps | 2,000 (cap) | 2,000 (cap) |
| Winner share by seat | seat0 5.8%, seat1 1.7%, seat2 1.7%, **unknown 90.8%** | seat0 13%, unknown 82% |
| Bankruptcies | 36 across 25 games (**20.8%**) | 28.5% |
| Feature adoption | market 100%, auction 100%, events 99%, **casino 0%** | market 100%, auction 100%, events 98%, casino 0% |
| **Income composition (per seat)** | **rent +$1,282 · market −$143 · casino $0 · loans $0** | (not measured) |

Two things this settles:
- The **market is a measured net loss (−$143/seat)**, not a rounding-zero — consistent with the 2%-fee round-trip sink found in the audit. Casino is genuinely unused (chaos-only gate), so $0 is real, not missing data.
- The earlier "71.3% GO-pass+cards vs 28.7% rent" split came from an ad-hoc probe and is **not** reproduced by the harness's own counters; rent is in fact the dominant measured source. Treat that older split as unverified until a GO/card counter exists.

Note: the resolution rate got *worse* at the shipped economy (9.2% vs 18%), and the seat-0 signal is now too thin (11 resolved games) to read. Neither is a conclusion yet — both need a larger run once the bot decision budget is addressed.

## 4. Debt / drift (silent-divergence risk)

- **31 duplicated constant groups.** Highest risk: market fee `0.02` inlined **4×** in `marketExpansion.js` (153/198/220/411) while `MARKET_FEE_RATE` exists in `marketLogic.js:7` and no test references it; option reserve `100_000` in 3 places; short-inventory seed `50` in 4 (incl. the bot digest); purchase reserve `120` in 4; pass-Start `200` in 5; `GROUP_TRAFFIC_PERCENT` in 3 (→ B-27); housing-bubble/tourism/airport/utility rent factors duplicated between `globalEventData.js` and `botRentForecast.js` (only anti-monopoly now reads the effect).
- **22 dead-code items** incl. `settleDefaultClaim` (→ B-17), `handleDebtSettlement` (0 callers, 0% coverage), `bankruptMode:'debt'` (forced to `'elim'` at 3 sites, so `inDebt` is only ever `false`), `maxPlayers` override (silently dropped by `normalizeOverrides`, making 8-seat `grand-64` unreachable), `globalEventDuration`/`globalEventMax` (snapshot-only), option writer-role branches (unreachable — `optionTerms:251` refuses writers), `RulesetRegistry`/`BoardRegistry` classes, `startAuction` returns `undefined` on success.
- **`BALANCE_REVISION` is never bumped** — analytics cannot segment a balance change.
- Latent option faucet: client-supplied `strike`/`premium` with only a truthiness check on `optionPricingPolicy`; ~100 cycles drain the $100k room reserve, after which *every* option open fails for everyone. Currently masked because the policy is never set.
- `cardCashAfterPlay` contradicts its own comment for `pay`; `isNegativeGlobalEvent` matches an empty event title; `debt-free` is awarded for never having taken a loan; `hasFullSet` returns true for an unknown group; 4 duplicate card texts skew the Treasure sighting counter; stale comment citations in `propertyApi.js:220` and `globalEventData.js:3`.
- `isBuildReady` hardcodes `cash >= 100` against house costs of 50–200 (−50%…+100% error).

## 5. Discarded on cross-check

- **"Casino has 38 pockets / black is fair / red is −5.26%"** (S11) — **false**. `randomInt(0,36)` = 37 pockets, `ROULETTE_RED` has 18 entries; red/black/green all carry an identical **−1/37 = −2.70%** edge and the planner's `stake/37` is correct. (S2 verified with a 25-spin probe.)
- "Unsecured bank default can be re-entered / dodged" (S3 self-check) — disproven; `borrowerCreditRejection` bars re-borrowing permanently.
- "Collateral revalidation at accept is wrong for loans" — disproven; basket is fully re-validated and pinned by `collateralBasket.test.js`.
- "Rent can be non-integer / splits exceed collected rent / supply caps break" — disproven over 14,336 probed combinations: 0 violations.
- `getSeason?metric=mastery` *is* a real bug (B-34) but its metric table lacks `participation` too — bundled.

## 6. Suggested fix order

1. **Wave A (money loss, all testable):** B-01, B-02, B-03, B-04, B-05, B-10, B-20, B-22
2. **Wave B (scoring/accounting):** B-06, B-07, B-12, B-16, B-17, B-18, B-33, B-34
3. **Wave C (config/capacity):** B-09, B-35, B-36
4. **Wave D (bot correctness):** B-23, B-24, B-26, B-08, B-30, B-31
5. **Wave E (board/event data):** B-19, B-27, B-28, B-29, B-13
6. **Rulings needed before code:** B-14 (double premium — likely a straightforward fix), B-15/BAL-10 (loan recovery scale), B-12, B-13, B-25, BAL-01…BAL-15, plus the 21 design questions in the slot outputs.
7. **Sweep:** the 31 duplicate-constant groups and the dead knobs (cheap, prevents future drift).
