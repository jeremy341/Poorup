# Independent Poorup Bot Strategy Design

## Goal

Improve the strength and decision quality of Poorup's AI and NO-AI bots as two independent policies, while preserving the same server-authoritative game rules and legal action surface used by human players.

## Current baseline

- `runBotTurn` classifies the current phase, builds strategic context, and routes eligible decisions through an advisor.
- The NO-AI advisor deterministically scores server-generated candidate actions and uses a bounded expected-value planner. It does not call an external provider.
- The AI advisor sends a structured state/context and candidate actions to a configured model. The model returns one candidate ID; the server validates and executes it, with deterministic fallback on provider failure.
- Several phases are resolved by fixed server-side policies for both modes.
- The NO-AI advisor sets `supportsChoicePhases` to false, so vote, trade, contract, sponsorship, and payment decisions use separate fixed executors instead of the main candidate scorer.
- The planner's candidate projection registry silently skips kinds with no applier. Current candidate generation includes `sell`, `unmortgage`, `bank-repay`, `contract-propose`, `exercise-option`, and jail choices; each needs explicit projection semantics or explicit exclusion.
- The rent forecast currently estimates improved rent as `baseRent * (1 + 0.45 * houses)` and assigns zero expected rent income to bot-owned deeds. The game uses property multipliers `[1, 5, 15, 45, 80, 125]`, complete-set rules, mortgage status, owner-count-dependent railroad/utility rent, and event effects.
- The AI prompt currently sends at most 32 candidates; an omitted viable action cannot be selected. Its parser retains the ID, confidence, and reason code, not the optional free-form rationale.
- Existing bot simulations primarily test deterministic safety/progress. They are not sufficient by themselves to establish that one policy is stronger than another.
- The previously tested NO-AI latency/tab-sync worktree was discarded; it is not part of this design's current code baseline.

## Design principles

1. **Separate the brains, share the game contract.** NO-AI and AI may use different state evaluators, search methods, and strategic policies. They must receive only current, player-visible game information and legal candidate actions from the authoritative game implementation.
2. **Keep the server authoritative.** Neither policy may mutate game state directly or invent actions, prices, dice, ownership, or rules. Every selected action is revalidated against live state and executed through the existing server action path.
3. **Give each decision enough relevant context, not the largest possible prompt.** Build phase-specific numeric features and candidate consequences; do not recompute or transmit unrelated table state for phases that do not use it. Never reuse stale decision snapshots across turns.
4. **Treat strength claims as evaluation results.** Compare both policies against explicit baselines using shared seeds, seat rotations, held-out matches, and uncertainty estimates. No balance claim follows from zero stalls or faster CPU timings alone.
5. **Preserve user-facing surfaces.** This work is server/gameplay and test/evaluation only; it does not redesign or restyle the UI.
6. **Make forecasts auditable.** Every projected candidate effect must be based on shared authoritative rules or explicitly classified; unknown candidate kinds must never silently evaluate as a no-op.
7. **Respect the requested branch workflow.** Begin and keep implementation on the existing `development` branch; do not create feature branches or worktrees, and do not switch branches after implementation begins. Do not commit/push/merge without separate approval.

## Proposed architecture

### Shared policy boundary

Retain one common decision boundary: current phase + sanitized public strategic snapshot + complete legal candidate set -> selected candidate ID + trace metadata. Preserve existing server action validation, stale-state checks, deterministic fallback, and rule parity. Keep the two scoring policies independent behind the existing advisor seam rather than introducing a new generic agent framework.

Create a shared pure rent/finance projection surface that the authoritative game and planner can both use. Its inputs should include tile facts, owner full-set/railroad/utility counts, dice total, double-rent settings, and already-resolved event modifiers/caps. It must represent the property ladder, mortgages, and expected income when opponents land on bot-owned deeds. Add a projection-coverage test: every generated strategic candidate kind must either have a real state-effect projection or be explicitly marked non-projectable and omitted from comparisons.

### NO-AI policy

Keep NO-AI deterministic, local, and reproducible. Evolve it from mostly fixed candidate scores and shallow expected values toward a bounded phase-aware evaluator. Candidate evaluation should account for liquidity and debt, set completion/development, event effects, likely rent/tax exposure, and opponent threats. For stochastic outcomes, use a fixed compute budget and seeded, reproducible sampling or exact probabilities where tractable. Any forward simulation must use a rules-faithful state transition model; heuristic approximations must be labeled and tested as such. Do not persist cached snapshots across turns.

The bounded exact/stratified forecast work in Task 3 is the baseline policy and remains enabled under its tested 16/64/256 budgets. Task 5's UCT/progressive-widening search variants are separate experiments and remain disabled unless their own held-out evidence gate passes. Do not report benchmark per-state budgets as actual total scenario counts. The current public-action profile history is sourced from successful socket actions (human actions); bot-vs-bot tournament actions are not recorded, so that tournament cannot measure profile effects. Profiles therefore stay disabled absent separately consented human-vs-bot evidence or a separately approved anonymized bot-action source.

Audit fixed phase policies separately: improving `deterministicChoice` alone will not improve phases that continue through `PHASE_EXECUTORS`. Migrate consequential phases only after shadow comparisons show that the candidate scorer improves on the current fixed policy.

### AI policy

Keep the external model as an advisory policy over legal actions, not as the game engine. Provide a compact phase-specific context and candidate evidence such as immediate cost, projected liquidity, expected downside, strategic upside, and uncertainty. Ensure the model can see the full intended decision set or apply a tested, diversity-preserving shortlist; a silent candidate cap must not hide viable actions. Reserve model calls for choices that benefit from contextual judgment (for example, negotiations and close strategic decisions); retain deterministic handling for straightforward rule-bound actions. Preserve timeout, quota, circuit-breaker, privacy redaction, and fallback behavior.

### Shared evaluation harness

Evaluate AI and NO-AI independently against fixed baseline policies and each other. Use paired random seeds, rotate seat assignments, stratify by board/rule variant and personality, and separate training/development seeds from held-out seeds. Record game completion, winner/placement, assets/liquidity, bankruptcies, stalls, decision phase/action, fallback rate, provider latency, and local policy CPU time. Report sample sizes and confidence intervals. Include human-action data only when collected with appropriate consent and privacy controls; treat human imitation and competitive strength as separate objectives.

## Success criteria

- Existing server-authority, legal-action, parity, stale-state, payment, auction, and failure-fallback tests remain green.
- Neither policy introduces illegal actions, negative/invalid settlement, or reproducible no-progress loops in bounded simulations.
- Every candidate considered by the policy is either represented to the AI or explicitly excluded by a tested, documented shortlist rule.
- A claimed strength improvement is supported by completed held-out paired evaluations with seat rotation and uncertainty intervals; results are reported separately for AI and NO-AI.
- Decision CPU time, provider latency/fallbacks, scheduler pacing, and match completion time are measured separately.
- Rent forecasts match authoritative calculations on fixed states and expected dice outcomes; candidate projections match real candidate state deltas on cloned fixtures.
- Ordinary bot scheduling is 300 ms for both AI and NO-AI; the auction participant delay remains 450 ms.

## Non-goals

- Changing game rules, player action legality, or balance parameters as part of the strategy work.
- Training or deploying a new deep reinforcement-learning model before the simulator/evaluation harness is trustworthy.
- Adding cross-turn cached game state or allowing the AI provider to bypass server validation.
- Frontend, animation, theme, or layout changes.
- Changing the AI provider timeout or adding a new learned model before the simulator/evaluation harness is trustworthy.

## Evidence and research basis

Current implementation evidence to carry into the plan:

- `server/botLogic.js` builds strategic context before routing phases and validates/executes selected candidates through the room action seam.
- `server/botAdvisor.js` owns the AI provider, deterministic fallback, and prompt construction; its current prompt serializes at most 32 candidate actions.
- `server/botFuturePlanner.js` uses horizons of 0/1/3 for house/table/expert; the expert score perturbation is not a rollout through future game states. Its projection registry currently leaves several generated candidate kinds without state effects, and its rent estimate does not match the authoritative ladder.
- `server/botStrategicContext.js` builds the board, opponent, table, obligations, and rules snapshots.
- `server/bot-simulation.test.js` exercises the deterministic advisor for bounded no-AI simulations; this is a safety/progress harness, not an AI-vs-NO-AI strength comparison.
- `server/rentApi.js` and `server/gameData.js` are the authoritative rent implementation and multipliers. `server/rent.test.js` already characterizes the rule ladder.
- `server/socketRuntime.js` schedules ordinary bot decisions at 650 ms and auctions separately at 450 ms. Movement animation uses 130 ms per board space; changing scheduler pacing does not change provider inference time and can overlap long walks.

The plan includes changing the ordinary shared bot delay to 300 ms for both AI and NO-AI while keeping the 450 ms auction delay, four-second provider timeout, and animation code unchanged. Treat animation overlap on long walks as an explicit visual risk to validate; scheduler time is not model inference time.

Primary research informing the proposal:

- Bonjour et al., [*Decision Making in Monopoly Using a Hybrid Deep Reinforcement Learning Approach*](https://arxiv.org/abs/2103.00683) (2022): their hybrid policy assigns learned decision-making to frequent complex choices and fixed rules to less frequent straightforward choices. Their reported results are specific to their simulator and fixed-policy baselines.
- Kocsis and Szepesvári, [*Bandit Based Monte-Carlo Planning* / UCT](https://sites.ualberta.ca/~szepesva/papers/cg06-ext.pdf) (2006): UCT allocates rollout effort across actions using an exploration/exploitation bound. It requires an actual transition model; it does not justify calling score noise a rollout.
- Cowling, Powley, and Whitehouse, [*Information Set Monte Carlo Tree Search*](https://doi.org/10.1109/TCIAIG.2012.2200894) (2012): information-set search handles hidden information and chance; Poorup may sample only states consistent with the bot's public information and must never expose the live hidden deck order.
- Goodman, Perez-Liebana, and Lucas, [*MultiTree MCTS in Tabletop Games*](https://doi.org/10.1109/COG51982.2022.9893605) (2022): separate player trees can deepen the acting player's own planning, with a trade-off in move-conditional opponent responses.
- CWI authors, [*Guiding Multiplayer MCTS by Focusing on Yourself*](https://ieee-cog.org/2020/papers/paper_193.pdf) (2020): progressive widening plus opponent-move abstraction improved short-budget search in their tested multiplayer games; it is a candidate technique to evaluate, not a guaranteed Poorup win.
- von der Osten, Kirley, and Miller, [*The Minds of Many: Opponent Modeling in a Stochastic Game*](https://doi.org/10.24963/ijcai.2017/537) (IJCAI 2017): a group-stereotype approach models several opponents under partial observability. Poorup should begin with small confidence-weighted profiles from public actions, not recursive beliefs.
- Brown and Sandholm, [*Superhuman AI for Multiplayer Poker*](https://doi.org/10.1126/science.aay2400) (Science 2019), and Moravčík et al., [*DeepStack: Expert-Level Artificial Intelligence in Heads-Up No-Limit Poker*](https://doi.org/10.1126/science.aam6960) (Science 2017): these combine game-specific self-play/value estimation with search. They support search-plus-evaluation as a research direction, not direct transfer of poker abstractions or a guarantee that an LLM prompt improves Poorup.
- [*A Multi-Agent Simulator for Generating Novelty in Monopoly*](https://doi.org/10.1016/j.simpat.2021.102364) (2021): studies novelty and agent interactions in a Monopoly simulator, motivating variant and unusual-state coverage.
- Burch et al., [*AIVAT: A New Variance Reduction Technique for Agent Evaluation in Imperfect Information Games*](https://doi.org/10.1609/aaai.v32i1.11481) (AAAI 2018): poker-specific variance reduction can help only when the estimator's policy/value assumptions hold; it is an optional later evaluator, not a first implementation task.
- IJCAI authors, [*A Meta-Game Evaluation Framework for Deep Multiagent Reinforcement Learning*](https://www.ijcai.org/proceedings/2024/17) (2024): repeated self-play/cross-play across seeds and uncertainty analysis motivate the proposed tournament evaluator.
- Omidshafiei et al., [*α-Rank: Multi-Agent Evaluation by Evolution*](https://doi.org/10.1038/s41598-019-45619-9) (2019): evolutionary ranking can expose intransitive matchup cycles; use only if the measured policy payoff matrix shows cycles that ordinary paired comparisons obscure.

## Main risks and mitigations

- **Approximate simulation diverges from the real game:** prefer canonical transition functions; add parity/property tests and compare simulated outcomes to the authoritative engine on fixed scenarios.
- **AI context grows or loses viable actions:** phase-scope the context, measure serialized size and candidate coverage, and test large-board/high-option states.
- **Self-play overfits to one policy:** include diverse fixed baselines and held-out cross-play, not self-play alone.
- **Provider latency masks strategic latency:** report model request time, local decision time, scheduling delay, and game animation time as separate metrics.
- **Policy quality is conflated with game balance:** report strength, completion, and rule-variant results independently; make no balance claim from performance or stall metrics alone.
- **Scheduler delay is mistaken for AI thinking:** include the requested 300 ms shared ordinary-bot delay as a separate pacing task, leave the 450 ms auction timer and 4-second provider timeout unchanged, and measure its animation-overlap risk separately.
