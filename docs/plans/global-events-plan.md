# Poorup Global Events

Status: design proposal. This document supersedes the prototype settings that exposed event mode, duration, and event count separately.

## Design decision

The lobby exposes one control only:

```text
GLOBAL EVENTS: OFF | ON
```

When enabled, the server derives rarity, timing, duration, severity, and event combinations from the actual game clock and board state. Players should not be able to tune the interesting parts of the system from the lobby.

The event system stays inside the existing server-authoritative game state. It is a modular subsystem, not a separate service.

## Goals

- Make a global event rare enough to feel like a headline.
- Make an event strong enough to change strategy for several rounds.
- Scale event odds and duration with game progress, not arbitrary lobby sliders.
- Give every player the same readable information and counterplay.
- Keep classic Surprise and Treasure cards intact.
- Support curated combinations and secret achievements without random unfairness.

## Non-goals for the first release

- No stock-market simulation.
- No permanent destruction of purchased properties.
- No simultaneous pile-up of unrelated events.
- No hidden rules that change without an event banner.
- No real politician names or real-world political targeting.

## Round clock and scaling

A round means every active player has received one turn. `roundNumber` starts at 1 when the game starts and advances when turn order wraps.

The server derives a progress value:

```text
progress = clamp((roundNumber - 1) / expectedRounds, 0, 1)
```

`expectedRounds` is calculated from active player count and the normal turn timer. It is a balancing estimate, not a player setting.

### Eligibility window

- Rounds 1–2: no global events.
- Round 3: only low-impact positive events can become eligible.
- Rounds 4 onward: all eligible events may roll.
- After an event ends: three-round cooldown.
- Default maximum: one event per game unless a curated combination is earned.

### Rarity curve

The server makes one weighted roll at each round boundary and may make a second small roll when a player lands on Surprise.

| Game progress | Boundary roll | Surprise roll | Intended feeling |
|---|---:|---:|---|
| Early | 0% | 0% | Establish the economy |
| Round 3 | 1% | 2% | Foreshadowing |
| Midgame | 2.5% | 5% | Pressure builds |
| Late game | 4% | 7% | A crisis can still turn the table |

These are starting values for simulation, not player-facing settings. A threshold event must still pass its own eligibility rule.

### Duration curve

Duration is derived from event tier and progress:

- Major: 4 rounds early, 5 midgame, 6 late.
- Crisis: 6 rounds early, 7 midgame, 8 late.
- Catastrophe: 8 rounds early, 9 midgame, 10 late.

Every event has a one-round warning phase and a one-round recovery phase. A ten-round catastrophe is deliberately rare because it can dominate a short match.

## Event lifecycle

```text
ELIGIBLE → WARNING → ACTIVE → RECOVERY → ENDED
                     ↘ VOTING ↗
```

1. **Eligible:** event-specific conditions are true.
2. **Warning:** headline appears, effects are not active, players get one turn cycle to prepare.
3. **Voting:** only for civic events; every active player gets one vote.
4. **Active:** modifiers are applied by the server for derived rounds.
5. **Recovery:** penalties taper or a final settlement is applied.
6. **Ended:** event enters history and cooldown begins.

## Event state contract

```js
globalEvent: {
  id,
  title,
  category,
  phase,                 // warning | voting | active | recovery
  startedRound,
  roundsRemaining,
  durationRounds,
  summary,
  effects,
  choices,
  votes,
  resolvedChoice,
  targetPlayerId,
  comboId
}
```

All writes happen in `GameState`. Clients receive the sanitized state and render it; clients never calculate rent, loan terms, or event outcomes.

## Full event catalog

The following list is the initial complete catalog. “Cannot happen when” is as important as “can happen when”; it prevents repetitive or impossible headlines.

| Event | Tier | Can happen when | Cannot happen when | Core effect |
|---|---|---|---|---|
| Housing Bubble Pop | Catastrophe | 18+ buildings, or a developed group dominates | Fewer than 8 total buildings; another housing event is active | Property rent −35%, construction frozen for the shock phase, building resale heavily reduced, collateral values fall |
| Credit Freeze | Crisis | Mortgages or bank loans exist, or two players are distressed | No debt exists and no bank loan system is enabled | New bank loans and mortgages stop; existing loan premiums rise |
| Inflation Spiral | Crisis | Cash in circulation is unusually high | Early game or total cash is still near starting cash | Taxes and construction costs rise; fixed card rewards are reduced |
| City Election | Major | Round boundary or Surprise roll after round 3 | An election happened in the last 6 rounds | Players vote for low tax, public works, or bank-first policy |
| Airport Strike | Major | At least one airport is owned | No airports are owned, or a strike happened recently | Airport rent becomes zero and airport movement cards are disrupted |
| Tourism Boom | Major | No infrastructure event is active | Airport Strike is active | Airports and premium districts gain rent for several rounds |
| Anti-Monopoly Investigation | Crisis | One player controls two or more groups | No player controls two groups or the same player was targeted recently | Leader’s rent is capped and a regulatory payment is due |
| Interest Rate Shock | Crisis | Two or more active bank loans exist | No bank loans exist | Bank-loan repayment totals increase and new offers become harsher |
| Bank Run | Crisis | Three or more players have less than one round of cash buffer | Everyone has a healthy cash buffer | Bank transactions queue, auctions pause, and a bailout choice appears |
| Supply Chain Breakdown | Major | Several buildings were constructed in the last two rounds | No building activity exists | Building costs rise and construction is limited to one action per player |
| Energy Crisis | Crisis | Both utilities are owned or utility rent has been collected often | No utility is owned | Utility rent rises, but building costs also rise for the shock phase |
| Transit Shutdown | Major | Movement cards or airports have been used repeatedly | No support movement has occurred | Support movement reroutes and players cannot use a shortcut card for one cycle |
| Currency Devaluation | Crisis | Bank cash reserve and player cash concentration are high | Total cash is low enough that devaluation would eliminate players | Everyone loses a small percentage of cash; property values are unchanged |
| Rent Control Ordinance | Crisis | Rent is concentrated in one player’s portfolio | No player has collected meaningful rent | High-rent properties are capped; owners receive a small bank stipend |
| Public Works Boom | Major | Construction has been quiet for several rounds | Housing Bubble Pop or Supply Chain Breakdown is active | One group gets cheaper construction and a temporary building opportunity |
| Convention Week | Major | Tourism Boom is not active and the game is mid-to-late | Very early game or a travel event just ended | One country group and its airport receive a temporary demand boost |
| Tax Scandal Audit | Crisis | A player has collected several large card rewards or avoided taxes | No tax/card activity exists | A visible audit selects a player; they pay, disclose cash, or accept a penalty |
| Debt Amnesty | Major | At least one player has an active bank loan | No bank loan exists | Players may settle a loan at a discount, but the bank raises future premiums |
| Labor Strike | Major | Buildings and rent have both been growing quickly | No developed properties exist | Developed properties pay maintenance; workers can be settled by a fee |

The last ten entries are the expansion set beyond the original seven-event prototype.

## Event combinations

Combinations are curated pairs, not arbitrary multiplication of every modifier.

| Combination | Required pair | Secret headline | Combined consequence |
|---|---|---|---|
| Foreclosure Spiral | Housing Bubble Pop + Credit Freeze | `THE MARKET HAS NO FLOOR` | No construction, no new credit, collateral seizure enters recovery rules |
| Stagflation | Inflation Spiral + Interest Rate Shock | `CASH MELTS, DEBT GROWS` | Costs and loan totals rise while rent demand weakens |
| Travel Chaos | Airport Strike + Tourism Boom | `THE CITY IS FULL, BUT GROUNDED` | Airports lose normal rent, but the selected premium group surges |
| Legitimacy Crisis | City Election + Tax Scandal Audit | `THE COUNCIL IS COMPROMISED` | Vote winner must fund an audit or lose its policy bonus |
| Construction Shutdown | Supply Chain Breakdown + Energy Crisis | `NO MATERIALS, NO POWER` | Building is disabled until recovery; owners receive partial compensation |
| Moral Hazard | Bank Run + Emergency bailout choice | `TOO BIG TO FAIL` | Cash relief arrives, but every active loan receives a future premium |

Rules for combinations:

- Only one combo may be active at once.
- A combo can use at most two base events.
- Total duration is the longer event duration, capped at 10 rounds.
- Multipliers are resolved by named combo rules, never by blind multiplication.
- Each combo unlocks at most one secret achievement per game.

## UI and interaction

### Lobby

Show one row under Table Rules:

```text
GLOBAL EVENTS · ON/OFF
Rare, escalating headlines that affect the whole table.
```

Remove player-facing duration, maximum-event, and severity controls. Those are balancing constants derived from round progress.

### In-game banner

The existing center board gets a compact banner:

- Category and headline
- Warning or active state
- `X ROUNDS LEFT`
- Effect chips such as `RENTS −35%` and `BUILDING FROZEN`
- Vote buttons only during voting

The banner is informative, not modal. A global event must never trap the player behind a dialog just to continue a turn.

### Event history

The LOG tab records warning, activation, votes, escalation, recovery, and end. A player can always answer “what changed?” from the current screen.

## Fairness rules

- Warning before every negative event.
- No event may remove a purchased property without compensation or a clearly stated collateral default.
- Rent modifiers are capped at ±35% outside curated combinations.
- Event effects are evaluated on the server at the moment of payment or purchase.
- Existing bank-loan terms are snapshotted; an event may add a clearly stated surcharge, never silently rewrite history.
- If an event would bankrupt more than one player immediately, downgrade it to its recovery variant.
- A player can always see the current event, remaining rounds, and active modifiers.

## Migration from the current prototype

The current prototype has separate settings for event mode, duration, and event maximum. The next implementation pass should:

1. Keep `globalEvents` as a boolean.
2. Remove `globalEventDuration` and `globalEventMax` from the lobby UI and network settings.
3. Keep the server fields temporarily for migration, but ignore client-provided values.
4. Derive duration, rarity, and maximum internally from progress and event tier.
5. Preserve `globalEvent` and `globalEventHistory` in the state summary.

## Verification plan

- Deterministic tests for every event’s eligibility and exclusion condition.
- Round-clock tests at rounds 1, 3, 4, midpoint, and late game.
- Modifier tests for rent, tax, construction, mortgage, and bank loans.
- Vote tests for unanimous, split, tie, disconnected, and late voters.
- Combination tests proving caps and no accidental third event.
- Browser checks for banner visibility, keyboard focus, reduced motion, and narrow screens.
- Balance simulations measuring bankruptcies, event frequency, average duration, and comeback rate.
