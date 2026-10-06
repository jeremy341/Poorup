# Poorup Bot Strategy Redesign

> Status: draft for review. Temporary design spec; not an implementation plan.

## Goal

Make AI and no-AI bots materially better at Poorup strategy, remove behavioral personalities from the product and runtime, and leave only the AI/no-AI brain choice and a meaningful difficulty setting. The server remains authoritative for every game rule and settlement.

## Decisions and boundaries

- Keep the lobby's AI vs. no-AI control and House / Table / Expert difficulty control.
- Keep only `ai` and `no-ai` as canonical brain modes; normalize legacy `all`/`auto` values to `ai` when reading old settings.
- Remove bot personality as a setting, player field, policy dimension, display label, and AI-context field. Bot nicknames, colors, and avatars remain as identity only.
- Difficulty changes decision quality/search depth, not legal rules or action eligibility. All levels retain identical server-side legality and financial-safety checks.
- Do not call the AI provider more often by default. Preserve provider quotas, timeout/circuit-breaker behavior, and deterministic fallback.
- Do not let a model mutate `GameState`, invent ownership, or bypass the existing server action methods.

## Why the current AI feels constrained

The advisor receives a sanitized strategic snapshot and a list of server-generated candidates, then returns one candidate ID. The server executes the matching fixed action. This prevents arbitrary model-authored actions, but it also means the advisor cannot choose a bid amount, propose terms, or select an action omitted by candidate generation. Improving only the prompt cannot repair a narrow or badly scored candidate set.

## Proposed decision architecture

### Shared strategic evaluation

Create one state-to-outcome evaluation path used by both brains. It compares legal action intents against passing/continuing and reports bounded, inspectable facts such as:

- cash, debt, liquidity reserve, and obligation effects;
- deed value, expected rent, group progress, build cost, and opponent threat;
- auction price versus projected strategic value;
- market position mark-to-market value, fees, realized/unrealized P&L, quote history, and active event effects;
- outcome confidence and the planning horizon used.

Correct the existing planner before relying on its scores: market positions must count as assets at current quotes, rather than a buy being treated as a cash loss with a zero-value position and a sale as cash creation.

### Structured AI intents, still validated by the server

Keep opaque server-issued intent IDs, but let intents carry explicitly bounded parameters where one fixed candidate is too restrictive. For example, an auction intent can let the model choose a whole-dollar bid amount between the next legal bid and available cash. The model sees the projected value/utility curve and can choose a bid or pass; there is no fixed 1x/2x deed-price ceiling. The server still rechecks the current auction identity, participant, bid ordering, whole-dollar amount, and cash after the asynchronous response.

Use concrete enumerated choices for sensitive combinations such as property transfers and contract terms when their parameter space is large. The advisor must choose among server-created legal combinations; it may not name arbitrary property IDs or invent settlement rules. Invalid, stale, missing, or timed-out responses use the deterministic fallback.

The response remains strict JSON with an intent token, allowed parameters, and a short reason code. Do not request or store private chain-of-thought. Record compact score components and validation/fallback reasons in the existing decision trace.

### Difficulty semantics for both brains

Use the same evaluation features for AI and no-AI. Difficulty selects bounded compute:

| Difficulty | Starting search profile |
|---|---|
| House | Immediate legal evaluation; no sampled rollout |
| Table | One-round lookahead; 16 deterministic scenarios |
| Expert | Three-round lookahead; 64 deterministic scenarios |

These are initial design values to validate against runtime cost and paired simulations. Difficulty may change strategic foresight, not whether an action is legal or which safety checks apply. The AI receives the same profile and evaluation; no-AI chooses deterministically from it.

## Personality removal

Remove `botPersonality` and `Player.personality` from canonical room settings, bot creation and updates, room/player summaries, client state, lobby controls/status text, strategic context, advisor serialization, deterministic scoring, candidate generation, event voting, trade/contract acceptance, auction bidding, finance/market/casino decisions, and bot dialogue. Replace those branches with state- and difficulty-based evaluation rather than renaming the archetypes.

For compatibility, old `botPersonality` values in incoming legacy room/ruleset data are ignored and omitted from newly normalized settings and digests; they must never restore a behavioral profile. Existing bot names and visual identity are unaffected.

## Known bot issues in scope

- Remove the current uncommitted fixed auction ceiling while retaining a state-dependent decision to pass when marginal strategic value is no longer worth the bid.
- Prevent rich multi-property trade generation from breaking the bot's own valuable completed group without evaluating the group loss and compensation.
- Consider all eligible financing targets before truncating/ranking them, so a couple of unserviceable low-cash seats do not hide a viable borrower.
- Offer building in the post-roll action window as well as before rolling.
- Replace the market's lowest-quote-only buy rule with the shared return/risk/event evaluation.

## Acceptance and evaluation

Focused regressions must prove that:

1. AI and no-AI pass on the observed $200 deed / $1,200 bid scenario when projected value does not justify it, while a valuable group completion can rationally justify a premium without a fixed price multiple.
2. A model cannot execute an unknown, stale, unaffordable, out-of-range, or illegal intent; fallback remains legal and deterministic.
3. Market buy/sell evaluation includes the current value of held positions and exact fees.
4. Trade generation does not silently give away a completed group or ignore its compensation; viable finance targets are not lost to premature truncation.
5. Building remains available after a roll, and all personality fields/settings disappear from current UI and current server snapshots.
6. Legacy personality inputs are ignored without changing the effective bot strategy.
7. House, Table, and Expert produce measurably different search budgets for both brains while preserving the same legal rules and safety invariants.

Run paired, seeded no-AI and stub-AI tournaments with seat rotations across all three difficulties. Report completion rate, win/placement share, bankruptcies, auction premium versus projected value, set-break trades, market P&L, invalid actions, stalls, provider calls, and runtime. The existing bounded no-stall campaign is safety coverage, not evidence of strategic strength. Live-provider evaluation is separate, quota-capped, and requires explicit approval.

## Out of scope

- Changing Poorup's game rules, auction eligibility, human action limits, or server settlement authority.
- Removing bot names, avatars, chat, or the user's choice between AI and no-AI.
- Increasing the number of live AI calls as a substitute for improving candidate quality and evaluation.
