# Poorup Bots and AI Decision Layer

Status: design proposal. This plan turns bots from scripted turn actors into decision-capable opponents while keeping the game deterministic, fair, and playable if no model is available.

## Design decision

Use a hybrid bot architecture:

```text
authoritative game state
  → legal-action generator
  → deterministic utility scorer
  → optional AI strategy advisor
  → validator and risk gate
  → server executes the chosen legal action
```

The AI never writes game state, rolls dice, moves a player, transfers money, or bypasses a rule. It recommends one action from a server-generated list. The server validates and executes it.

The model provider must be an adapter, not a hard-coded dependency. DeepSeek-V4-Flash is a reasonable candidate for the advisor layer and currently exposes an OpenAI-compatible API model identifier, but the adapter must verify the configured model at startup and fall back cleanly if unavailable. See the [official DeepSeek model list](https://api-docs.deepseek.com/api/list-models/) and [API pricing/model documentation](https://api-docs.deepseek.com/quick_start/pricing/) when implementing the adapter.

## Bot skill levels

### House bot

Deterministic utility rules only. Fast, cheap, and ideal for offline or low-latency play.

### Table bot

Deterministic scorer plus a personality profile. It evaluates several candidate actions and can trade, build, mortgage, borrow, vote, and respond to events.

### Advisor bot

Deterministic legal-action gate plus optional DeepSeek or another provider for strategic ranking and natural-language table talk. The AI is not required for correctness.

## Bot decision surface

Bots must be able to decide:

- Buy, pass, or send a property to auction.
- Build, sell, mortgage, or unmortgage.
- Take or repay a bank loan.
- Propose a player loan or equity trade.
- Accept, reject, or counter a trade.
- Use a Get Out of Prison card or pay the jail fine.
- Choose whether to campaign, bribe, or vote during a civic event.
- Accept a Housing Bubble Pop bailout or ride out the crash.
- Prioritize liquidity, rent income, group completion, or survival.
- End a turn after all legal actions are complete.

## Candidate-action architecture

Every turn begins with a server-generated list:

```js
[
  { id: 'buy:21', kind: 'buy', tileIndex: 21, cost: 220 },
  { id: 'mortgage:31', kind: 'mortgage', tileIndex: 31, proceeds: 150 },
  { id: 'loan:emergency', kind: 'bank-loan', principal: 300, totalDue: 450 },
  { id: 'pass', kind: 'pass' }
]
```

Each action includes the exact projected cash delta, risk, prerequisites, and irreversible consequences. The AI sees these candidates, not arbitrary commands.

## Deterministic scoring

The baseline scorer calculates:

```text
score = liquidity value
      + expected rent value
      + group completion value
      + event hedge value
      - debt risk
      - default risk
      - concentration risk
      - opportunity cost
```

The score is personality-weighted. The AI may reorder candidates but cannot invent one.

## Personality profiles

| Profile | Behavior |
|---|---|
| Builder | Completes groups and builds early, accepts moderate debt |
| Shark | Aggressive auctions, high rent targets, hostile trades |
| Survivor | Keeps cash buffer, avoids loans, mortgages before default |
| Speculator | Takes calculated bank loans and bets on recovery events |
| Diplomat | Trades frequently, votes for shared benefits, avoids scandals |
| Chaos Agent | Chooses volatile actions, but still obeys legality and risk caps |

Each profile has explicit risk limits:

- Minimum cash buffer.
- Maximum debt-to-cash ratio.
- Maximum collateral exposure.
- Event severity tolerance.
- Trade generosity range.

## Global-event decisions

Bots receive a structured event context:

```js
{
  eventId,
  phase,
  roundsRemaining,
  effects,
  personalExposure,
  availableResponses
}
```

Examples:

- Housing Bubble Pop: sell buildings, preserve cash, accept bailout, or hold.
- Credit Freeze: avoid relying on future mortgage proceeds.
- City Election: vote based on portfolio exposure, not random preference.
- Airport Strike: discount airport ownership and reroute support-card expectations.
- Anti-Monopoly Investigation: lobby, sell concentration, or accept the fine.

## Prompt contract for the optional advisor

The prompt should contain only a sanitized, compact snapshot:

```text
You are a Poorup strategy advisor.
Choose exactly one candidate action id.
Return JSON only: {"actionId":"...","confidence":0-1,"reasonCode":"..."}
Never invent actions, money, dice, ownership, or rules.
```

The server appends candidates and the bot’s private financial state. Do not send chat history, account identifiers, or other players’ hidden information.

The response validator rejects:

- Unknown action ids.
- Invalid JSON.
- Confidence outside 0–1.
- Actions no longer legal after the request started.
- Requests that exceed the bot’s time or token budget.

## Latency and fallback

- Deterministic scorer returns immediately.
- AI advisor has a strict timeout, initially 600 ms.
- If the model times out, errors, or returns invalid JSON, use the deterministic choice.
- Cache only within a single decision; never reuse a stale action after state changes.
- Do not block the human turn while a bot thinks. A bot can show `CALCULATING` while the server preserves turn order.

## Provider adapter

```js
interface BotAdvisor {
  chooseAction({ snapshot, candidates, personality, event })
    -> Promise<{ actionId, confidence, reasonCode }>
}
```

Adapters:

- `DeterministicAdvisor` — always available.
- `DeepSeekAdvisor` — OpenAI-compatible HTTP client, configured by environment variables.
- Future providers — same contract, no game-logic changes.

Never place an API key in the browser. The server owns provider credentials, rate limits, and redaction.

## Fairness rules

- Bots see only information a player could reasonably see, plus their own private state.
- No model can alter dice or inspect future deck order.
- All bot actions are logged with candidate set, chosen id, fallback status, and latency.
- A bot does not get a better event probability than a human.
- “Chaos” means risky legal decisions, not cheating.

## Evaluation plan

Use deterministic fixtures and a held-out scenario set.

### Objective tests

- Every selected action is legal.
- No negative cash beyond bankruptcy rules.
- No collateral trade while a bank loan is active.
- Correct response to credit freeze, housing crash, airport strike, and elections.
- Bot can complete a full game without deadlock.
- Timeout and malformed model response always fall back.

### Strategy metrics

- Purchase value and group completion rate.
- Average cash buffer before event activation.
- Bank-loan default rate.
- Comeback rate after a global event.
- Illegal-action rate, target zero.
- Decision latency p50/p95.
- AI-call rate and cost per game.

### Rubric

Evaluate outcome and trace separately:

1. Legal action correctness.
2. Strategic quality.
3. Event awareness.
4. Personality consistency.
5. Latency and fallback behavior.
6. No hidden-information leakage.

Use model-based grading only for strategic quality and personality. Use code-based graders for legality, state transitions, and side effects.

## Bot UI

- Player list shows `CPU · BUILDER`, `CPU · SURVIVOR`, or `CPU · ADVISOR`.
- During a decision, show a restrained `CPU THINKING` status, not a blocking modal.
- Event banners show the bot’s selected policy only after the server commits it.
- Optional table-talk messages are short, rate-limited, and never used as decision state.
- Settings expose bot count and personality only; provider/model selection stays server-side.

## Rollout

1. Extract legal-action generation from existing bot code.
2. Add deterministic scoring for buy/build/mortgage/loan choices.
3. Add event-aware decision context and voting.
4. Add trade proposal and response scoring.
5. Add provider adapter behind a server feature flag.
6. Run smoke, regression, malformed-response, timeout, and fairness suites.
7. Enable advisor bots only after deterministic bots meet the no-deadlock gate.

## What not to build yet

- Autonomous agents with direct tool access.
- Bots that read or generate arbitrary chat instructions.
- Multiple AI calls per action.
- Training or fine-tuning before collecting deterministic traces.
- A hard dependency on one provider or model name.
