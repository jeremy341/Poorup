# Poorup Casino, Market, and Global-Event Economy

Status: implementation blueprint. This document defines the contracts for the two optional economy systems before gameplay code is introduced.

## 1. Product decision

Poorup keeps the board game as the primary loop. Casino and Market are optional room add-ons that share the existing server-authoritative cash ledger and event stream.

Lobby controls:

```text
CASINO ACCESS: OFF | ON
MARKET ACCESS: OFF | ON
GLOBAL EVENTS: OFF | ON
```

The host chooses these before the round starts. They are locked when the first round begins. If both add-ons are off, the classic game behaves exactly as it does today.

This is not a separate mode yet. A later preset can bundle both add-ons as `ECONOMY NIGHT`, but the first release avoids splitting matchmaking, history, and bot logic across multiple game modes.

## 2. Non-negotiable boundaries

- Casino and Market use fictional board money only.
- Money cannot be purchased, withdrawn, cashed out, traded for real-world value, or converted into achievements.
- The server is the source of truth for balances, bets, positions, prices, dividends, and event effects.
- Every economy mutation is an atomic transaction with an idempotency key.
- A player cannot place a wager or trade while bankrupt, disconnected, in a mandatory purchase or auction decision, or inside a blocking card choice.
- Global events can change disclosed limits, fees, prices, and demand. They cannot silently change casino odds or rewrite completed transactions.
- Negative effects must be announced before activation and shown while active.
- The board remains playable if an economy subsystem is unavailable. The UI degrades to a read-only status and the turn continues.

## 3. Shared economy contract

```js
economy: {
  casino: {
    enabled,
    sessionId,
    maxBet,
    entryFee,
    roulette: { wheel: 'european', red: 18, black: 18, green: 1, payout: { red: 1, black: 1, green: 35 } },
    ledger: []
  },
  market: {
    enabled,
    marketRound,
    instruments: [],
    positions: {},
    ledger: []
  },
  modifiers: {
    casino: {},
    market: {},
    board: {}
  }
}
```

All ledger entries include `transactionId`, `roundNumber`, `playerId`, `kind`, `amount`, `balanceAfter`, `source`, and `createdAt`. A client may request an action twice, but the server applies a transaction only once.

The existing cash, loan, mortgage, bankruptcy, trade, and match-history records remain the canonical account records. Casino and Market append typed entries to the existing event and match histories rather than creating parallel player balances.

## 4. Casino system

### 4.1 Core game

The first table is European roulette:

| Selection | Probability | Net payout |
|---|---:|---:|
| Red | 18/37 | 1:1 |
| Black | 18/37 | 1:1 |
| Green / 0 | 1/37 | 35:1 |

The 2.7% house edge is fixed and visible. The server uses a cryptographically strong random result and stores the wheel result with the bet transaction. The UI shows the wheel type, probability, stake, possible return, and net result before confirmation.

### 4.2 Session flow

```text
IDLE → ENTRY CHECK → BET OPEN → BET LOCKED → SPINNING → SETTLED → IDLE
```

1. Player opens the Casino side panel.
2. Server checks phase, cash, bankruptcy, event restrictions, and table limits.
3. Player chooses red, black, or green and enters a stake.
4. Server escrows the stake and broadcasts the locked bet state.
5. Server resolves the spin once, settles the ledger, and emits the result.
6. Client renders the outcome and appends it to the game log.

Players can bet independently. A round-level casino session closes when the board advances to a new round or when a global event explicitly pauses the table.

### 4.3 Casino interactions

- **Cash:** bets reduce available cash immediately and winnings settle back into cash.
- **Loans:** borrowed money may be used for board actions, but not for casino bets. The server tags every dollar by source and rejects loan-funded wagers.
- **Bankruptcy:** an active bet is settled before bankruptcy finalization if it was already locked. Unlocked bets are cancelled.
- **Trades:** trading pauses only for the player during their own locked bet, not for the whole table.
- **Auctions:** a player cannot place a casino bet while they owe an auction bid or purchase decision.
- **Cards and taxes:** card outcomes settle before casino access is re-evaluated.
- **Achievements:** achievements may track responsible play or rare outcomes, never total money wagered.
- **Bots:** bots receive a risk budget and may decline casino access. They never borrow to gamble.

### 4.4 Fairness and safety

- Event modifiers may alter maximum bet, entry fee, or availability only.
- The advertised roulette probabilities and payouts stay unchanged.
- A server result includes the wheel type, winning pocket, and transaction id.
- A failed connection never creates a second settlement.
- The panel contains `LEAVE CASINO`, `BET LIMIT`, and `VIEW ODDS` controls.

## 5. Market system

### 5.1 Fictional instruments

The initial exchange uses indexes, not real companies:

```text
Brazil, Ghana, Thailand, Japan, Netherlands, Canada, Switzerland, Singapore,
Airports, Utilities, Property
```

Country indexes map to their property groups. Airports and Utilities are support indexes. Property is a broad index that reacts to building density, rent concentration, and housing events.

### 5.2 Trading flow

```text
VIEW QUOTE → CHOOSE BUY/SELL → VALIDATE FUNDS → LOCK PRICE → SETTLE → UPDATE POSITION
```

- Market orders only in the first release.
- A small, visible spread and transaction fee prevent infinite churn.
- No margin, short selling, options, leverage, or player-to-player stock transfers initially.
- A player may make one market action per board turn, unless a special event grants another window.
- Prices update at round boundaries and after global-event settlement, not every frame.

Each position stores quantity, average cost, last price, realized profit/loss, and event exposure. Selling cannot reduce a position below zero.

### 5.3 Market interactions

- **Properties:** owning deeds gives information and dividends, but never guarantees a positive return.
- **Rent:** rent remains a cash event. Market prices do not replace rent or ownership.
- **Loans:** shares cannot be pledged as collateral in the first release. Loan repayment still takes priority over trading.
- **Bankruptcy:** positions are liquidated at the current server price during settlement, with no hidden rescue price.
- **Taxes:** realized profits may trigger a fictional capital-gains fee only when the room rules explicitly include it.
- **Trades and auctions:** market actions are unavailable during a blocking trade or auction decision.
- **History:** completed matches store opening and closing portfolio values, not a private intramatch tick stream.
- **Bots:** bots use a bounded risk profile, cash buffer, and event exposure limit.

## 6. Global-event integration

Global Events remain one server subsystem. They do not become a third economy. Each event resolves named modifiers against board, casino, and market channels.

```js
globalEvent.effects = {
  board: { rentMultiplier, buildCostMultiplier, taxMultiplier },
  casino: { enabled, entryFee, maxBet },
  market: { priceMultipliers, volatility, tradingEnabled },
  recovery: { steps: [] }
}
```

Effects are applied at action settlement time. A player always sees the active modifier before committing an action.

### 6.1 Integration matrix

| Event | Board effect | Casino effect | Market effect | Cannot happen when |
|---|---|---|---|---|
| Housing Bubble Pop | Rent and building demand fall; construction may freeze | Max bet reduced; odds unchanged | Property and country indexes fall sharply | Too few buildings or no Market access |
| Credit Freeze | New bank credit and mortgages pause | Entry fee may be suspended | Bank and Property volatility rises; new buys limited | No debt and no Market access |
| Inflation Spiral | Taxes and construction costs rise | Entry fee and minimum stake rise | Nominal prices rise, real demand weakens | Early game |
| City Election | A public policy changes one board modifier | Policy may adjust entry fee | Selected country indexes reprice | Recent election or too few players |
| Airport Strike | Airport income and movement support weaken | Casino entry fee drops; table may close | Airports and tourism indexes fall | No airport activity |
| Tourism Boom | Travel and premium districts gain demand | Entry fee rises; max bet may rise | Airports and selected country indexes rise | Airport Strike active |
| Anti-Monopoly Investigation | Leader rent is capped temporarily | Leader receives a lower max bet | Dominant portfolio index is discounted | No concentrated portfolio |
| Interest Rate Shock | Existing loan payments gain a disclosed premium | Loan-funded bets remain blocked | Property and bank indexes become volatile | No bank loans |
| Bank Run | Bank actions queue; auctions may pause | Max bet falls until liquidity returns | All indexes receive a volatility shock | Healthy table liquidity |
| Supply Chain Breakdown | Construction cost rises and building is limited | Entry fee unchanged | Property and industrial demand fall | No recent building activity |
| Energy Crisis | Utilities gain demand; building costs rise | Casino power surcharge or closure | Utilities rise, property weakens | No utility activity |
| Transit Shutdown | Support movement is restricted | Casino access pauses for one cycle | Airports and country indexes soften | No support movement |
| Currency Devaluation | Cash loses a small percentage | Minimum stake rounds upward | Prices rebase, positions keep quantity | Would immediately eliminate players |
| Rent Control Ordinance | High rents are capped | Casino entry fee unchanged | Property index falls, consumer index rises | No rent concentration |
| Public Works Boom | One group gets cheaper building | Entry fee unchanged | Selected country and Property indexes rise | Housing crisis active |
| Convention Week | Selected group receives demand | Casino max bet rises with a disclosed fee | Country and Airport indexes rise | Very early game |
| Tax Scandal Audit | A visible player settlement occurs | Casino account activity is logged for audit | Market trades remain open but logged | No tax or card activity |
| Debt Amnesty | Loans can settle at a discount | Casino access remains unchanged | Bank and Property indexes recover | No active debt |
| Labor Strike | Developed properties pay maintenance | Casino entry fee may rise from staffing cost | Property and tourism volatility rises | No developed properties |

### 6.2 Combinations

Combinations are curated pairs, never blind multiplication of modifiers:

- `Foreclosure Spiral`: Housing Bubble Pop + Credit Freeze.
- `Stagflation`: Inflation Spiral + Interest Rate Shock.
- `Travel Chaos`: Airport Strike + Tourism Boom.
- `Legitimacy Crisis`: City Election + Tax Scandal Audit.
- `Construction Shutdown`: Supply Chain Breakdown + Energy Crisis.
- `Too Big To Fail`: Bank Run + Emergency bailout choice.

Only one combination can be active, it lasts no longer than ten rounds, and every combined modifier is explicitly listed in the event banner.

## 7. Collision prevention

### State ownership

The game state owns cash, turn stage, board actions, loans, events, casino sessions, and market positions. UI surfaces only dispatch intents and render server snapshots.

### Action gates

Before any economy action, the server checks:

1. Room and player identity.
2. Current phase and turn stage.
3. Connection and idempotency key.
4. Bankruptcy, debt, and escrow locks.
5. Active event modifiers.
6. Available cash after all locked obligations.

### Ordering

The settlement order is:

```text
card/tax result → rent/build/trade settlement → loan obligations → casino/market action → event history → UI snapshot
```

No subsystem may mutate cash outside this order. A global event is stamped with the round in which it was activated, so reconnecting clients cannot replay it.

### Reconnect and history

On reconnect, the client receives the current snapshot, open obligations, active event, casino session state, and portfolio positions. Private bet and portfolio details are visible only to the owning player. Completed match history stores aggregate economy outcomes, not secrets from other players.

## 8. Rules-page contract

The Rules tab must describe the live game separately from planned add-ons. Planned Casino and Market copy must carry a `PLANNED` badge until the server contracts ship. The docs page links to the relevant settings and explains exactly what is unavailable.

## 9. Rollout plan

1. Add room settings and sanitized snapshot fields, defaulting both add-ons off.
2. Add shared ledger and action-gate tests without exposing new UI.
3. Ship Casino in read-only preview, then server-settled European roulette.
4. Ship Market quotes and positions, then buy/sell settlement.
5. Add event modifiers behind simulation flags.
6. Run balance simulations and replay tests for reconnect, duplicate actions, bankruptcy, and event combinations.
7. Enable the Rules page `LIVE` badges only after each subsystem passes its contract tests.

## 10. Verification checklist

- Classic rooms produce byte-equivalent cash and turn outcomes with add-ons off.
- Casino odds remain 18/37, 18/37, and 1/37 across every event.
- A duplicate bet or trade request settles once.
- Loan money cannot be wagered.
- Bankruptcy liquidates market positions deterministically.
- Event warnings precede every negative modifier.
- Event combinations never create a third event or uncapped multiplier.
- Bots keep a cash buffer and never act during a blocking obligation.
- Reconnect restores open obligations without replaying ledger entries.
- Rules copy never claims a planned feature is live.
- Keyboard and screen-reader users can inspect odds, prices, modifiers, and settlement results.

## 11. Legal and platform boundary

This blueprint intentionally excludes deposits, withdrawals, cash-value prizes, and real-money securities. Adding those would require a separate legal, identity, age-verification, geolocation, responsible-gambling, payment, tax, and platform-compliance workstream before implementation.
