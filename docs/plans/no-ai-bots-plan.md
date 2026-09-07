# Poorup No-AI Bot Plan

Status: implemented baseline, fallback, and explicit low-cost mode. Remaining
items below are rollout/evaluation work, not a second bot architecture.

## Product decision

Poorup always has a deterministic bot that needs no model, API key, network, or
credits. It is the automatic fallback for the default `AUTO` bot mode and can
also be selected explicitly as `NO-AI`.

```text
server snapshot
  → legal-action generator
  → deterministic evaluator
  → personality/difficulty policy
  → one legal action through the normal room seam
```

The bot never mutates state directly. It calls the same server methods as a
human, so ownership, cash, prison, event, loan, casino, market, and bankruptcy
rules remain authoritative in `GameState`.

## What a normal board-game bot does

Traditional bots separate *what is legal* from *what is desirable*. A legal
action list is scored using immediate value, future value, risk, and liquidity.
For stochastic games, expected outcomes and bounded simulations are more useful
than a pure minimax tree. UCT/MCTS was designed for non-deterministic and
high-branching games and balances exploration against exploitation by sampling
future episodes ([Kocsis and Szepesvári, UCT paper](https://sites.ualberta.ca/~szepesva/papers/cg06-ext.pdf)).
OpenSpiel documents the same family of choices—Minimax, MCTS, IS-MCTS, PIMC,
and Max^n—for different information and player-count models
([OpenSpiel algorithms](https://github.com/google-deepmind/open_spiel/blob/master/docs/algorithms.md)).

Poorup is stochastic, multiplayer, and negotiation-heavy, so the first no-AI
implementation uses deterministic utility scoring. A small seeded Monte Carlo
lookahead can be added later without changing the action contract.

## Modes and difficulty

The lobby exposes one setting:

```text
BOT BRAIN · AUTO (AI → NO-AI) | NO-AI | AI
```

`AUTO` is the default. `NO-AI` never attempts a provider call. `AI` requests a
model and falls back to the same deterministic policy on timeout, quota, bad
JSON, network failure, or provider health failure.

Difficulty is separate from personality:

- **House:** one-pass rules, low latency, conservative reserve.
- **Table:** scored candidates, event awareness, trades, auctions, and loans.
- **Expert:** Table policy plus bounded seeded rollouts when the candidate set
  is close; never sees hidden information.

Difficulty changes search budget and risk tolerance, not legality.

## Decision loop

1. Receive the latest server snapshot.
2. Classify the phase: vote, contract, trade, payment, auction, pre-roll,
   post-roll, or end-turn.
3. Generate every legal candidate with prerequisites and projected deltas.
4. Remove candidates that violate the personality reserve or event policy.
5. Score each candidate.
6. Break ties with a deterministic seed derived from game id, round, bot id,
   and decision sequence.
7. Execute exactly one candidate through `Room`/`GameState`.
8. Record decision metadata for replay and balance analysis.

Candidate shape:

```js
{
  id: "buy:21",
  kind: "buy",
  tileIndex: 21,
  projectedCashDelta: -220,
  risk: 0.18,
  score: 42,
  prerequisites: ["unowned", "cash>=price+reserve"],
  irreversible: true
}
```

## Scoring model

```text
score = liquidity value
      + expected rent
      + group completion value
      + event hedge value
      + negotiation value
      - debt/default risk
      - concentration risk
      - opportunity cost
      - reserve violation
```

The evaluator uses only sanitized public room state plus the bot’s own private
state. It must not inspect another player’s hidden loan terms, private profile,
unseen deck order, or chat.

## Personality policies

- **Builder:** completes groups and builds evenly; keeps a medium reserve.
- **Shark:** values rent dominance, aggressive auctions, and profitable trades.
- **Survivor:** maximizes cash buffer, mortgages early, avoids fragile debt.
- **Speculator:** accepts calculated loans and market exposure during recoveries.
- **Diplomat:** trades to complete groups and prefers cooperative event votes.
- **Chaos:** takes higher-variance legal actions, including casino bets, while
  respecting the same cash and loan-backed-bet restrictions.

Each personality is a weight table, not a second rules engine. Adding a new
personality must not duplicate guards or settlement code.

## Decisions by subsystem

- **Property:** price, base rent, group completion, pass-Start cash, and reserve.
- **Building:** even-build constraints, house supply, event limits, and rent lift.
- **Mortgage/loan:** compare immediate liquidity with premium, cure round,
  collateral lock, and default probability.
- **Trade/equity:** value both legs, group completion, concentration, and future
  rent share; never trade locked collateral.
- **Auction:** bid only when the final bid plus reserve is affordable.
- **Prison:** compare fine, card, doubles, and opportunity cost.
- **Casino:** never use loan-funded cash; respect disclosed fee/max-bet gates.
- **Market:** one legal order per turn, no margin/shorting, event-aware quotes.
- **Global event:** vote from personality policy and current exposure; preserve
  enough liquidity for the event’s worst disclosed outcome.

## Scheduling and fairness

- One bot decision lock per room prevents duplicate turns.
- Pending votes, trades, contracts, auctions, and payments are resolved before
  ordinary movement.
- Every action has a timeout and a safe pass/decline fallback.
- Bot actions appear in the same log/feed as human actions.
- Bot identity and personality are visible in the roster; no hidden bonuses.
- Reconnect never replays a settled bot action.

## Current Poorup implementation

Already present:

- `server/botLogic.js` phase machine, candidate scoring, personalities, and
  auction/trade/contract decisions.
- `server/socketRuntime.js` scheduling, locks, and pending-interaction service.
- `server/rooms.js` bot seats and server-authoritative execution.
- `server/botAdvisor.js` deterministic advisor and optional provider adapter.

Implemented in the current bot slice:

- `botBrain` and `botDifficulty` are normalized in room settings with `AUTO`
  and `TABLE` defaults.
- Expert uses a bounded, deterministic seeded lookahead evaluator.
- The HUD shows non-blocking `CPU THINKING`, provider, fallback, and action
  status with reduced-motion support.
- Private match history stores candidate ids, selected id, provider, latency,
  brain, difficulty, planning horizon, strategic score, game id, and rule
  version.
- AI-first provider selection falls back to this policy on quota or outage.
- The versioned strategic snapshot includes exact bot position, board state,
  rules digest, obligations, and redacted opponents without stable ids.
- Future-value scoring now informs property purchases as well as pre-roll
  build, mortgage, market, casino, and loan candidates.
- Auction bid/pass choices are exposed to the AI adapter while the deterministic
  auction settlement and affordability guards remain authoritative.

Remaining rollout work:

- Expand the current 1,000-game bounded simulation gate into a longer balance
  campaign for reserves, loans, casino, market, and global-event survival.
- Add a browser-level bot-status accessibility and reconnect test.

## Verification gates

- 100% of selected actions pass the server legality seam.
- Zero negative cash outside the existing debt/bankruptcy rules.
- Zero hidden-information reads in a bot snapshot.
- Zero deadlocks in 1,000 seeded bounded full-game simulations with casino,
  market, auctions, and global events enabled. **Verified.**
- Replays with the same seed produce the same decisions.
- p95 deterministic decision latency stays below 50 ms.
- Bot win rate is measured by personality/difficulty, not hand-tuned bonuses.

## Rollout

1. Add `botBrain`/`botDifficulty` normalization and snapshot fields. **Done.**
2. Keep current deterministic policy as House/Table. **Done.**
3. Add Expert seeded rollouts and replay traces. **Done.**
4. Add UI status, accessibility labels, and rules-page copy. **Done.**
5. Run balance simulations and held-out regression fixtures. **Bounded gate done; longer balance campaign remains.**
6. Enable `AUTO` AI selection only after the AI provider passes the same gates.

## Do not build

- Direct bot writes into `GameState`.
- Hidden cash, rent, card-order, or profile advantages.
- Bots that read chat as commands.
- Per-frame polling or an unbounded search tree.
- A separate bot server or microservice before load requires it.
