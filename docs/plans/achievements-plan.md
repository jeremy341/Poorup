# Poorup Achievements and Secrets

Status: design proposal. Achievements are a progression and discovery layer across normal play, global events, secret combinations, and Parlor Patrol.

## Design goals

- Reward interesting decisions, not repetitive grinding.
- Make secret achievements discoverable through patterns, not impossible guesses.
- Keep achievements server-verified and resistant to client tampering.
- Celebrate both winning and creative survival.
- Never require spending money, exposing private data, or using an external AI service.

## Achievement categories

### Tablecraft

Normal board mastery: buying a complete group, collecting rent, building evenly, winning an auction, surviving jail, and finishing a round.

### Finance

Bank loans, player loans, equity, repayment, collateral, and debt recovery.

### Global events

Surviving, exploiting, or resolving board-wide events.

### Secret combinations

Rare event pairs, unusual timing, or a precise sequence of choices.

### Social play

Trades, votes, coalition behavior, and fair cooperation.

### Parlor Patrol

Achievements from the existing secret minigame: score milestones, near misses, and clean runs.

## Achievement record

Store only the minimum durable record:

```js
achievement: {
  id,
  unlockedAt,
  gameId,
  evidenceHash,
  visibility // visible | secret | revealed
}
```

The server emits an unlock event with a short description. The client renders a toast and updates the profile collection. A secret achievement remains hidden until unlocked, then reveals its name and clue.

## Initial achievement catalog

| Achievement | Type | Unlock condition |
|---|---|---|
| First Deed | visible | Buy any property in a completed server game |
| Full Street | visible | Complete any country/property group |
| Even Builder | visible | Build a full group without violating even-build rules |
| Auction Ghost | visible | Win an auction while bidding below the listed price |
| Clean Exit | visible | Repay a bank loan in full before its due round |
| Collateral Damage | visible | Lose a collateral property to a bank default |
| Bad Idea, Good Timing | visible | Take a bank loan with under $50 cash and survive |
| Debt Free | visible | Finish a game with no bank or player debt |
| Prison Break | visible | Use a Get Out of Prison card and later win the game |
| Council Member | visible | Win a global election vote |
| Public Works | visible | Build on the group selected by a Public Works policy |
| Crisis Manager | visible | End a negative global event without going bankrupt |
| Bubble Survivor | secret | Own developed property when Housing Bubble Pop ends and keep the deed |
| Short the Street | secret | Sell a building during Housing Bubble Pop, then repurchase/build after recovery |
| No Floor | secret | Survive Foreclosure Spiral without taking a second loan |
| Moral Hazard | secret | Receive a Bank Run bailout while holding an active loan |
| Grounded Tourist | secret | Own an airport during Airport Strike and still collect a non-airport rent |
| Stagflation Trader | secret | Complete a trade during the Stagflation combination |
| Compromised Council | secret | Vote in Legitimacy Crisis and choose the policy that ends the audit |
| Double Headline | secret | Trigger two eligible global events through separate Surprise rolls in one game |
| Last Wallet Standing | visible | Win a server-authoritative game |
| No Refunds | visible | Win after reaching the bank-loan default warning |
| Generous Lender | social | Give a player loan that is fully repaid |
| Coalition Builder | social | Complete a trade with a player you previously voted against |
| Unanimous | social | Be part of an election where every active player selects the same policy |
| Patrol Rookie | minigame | Score 10 in Parlor Patrol |
| Patrol Regular | minigame | Score 50 in Parlor Patrol |
| Patrol Ace | minigame | Beat the saved personal best three times |
| Clean Run | minigame | Finish a patrol run without missing a target |

## Expansion achievements

The second achievement pass adds higher-skill tablecraft, event, social, and discovery records:

| Achievement | Type | Unlock condition |
|---|---|---|
| Rent Reaper | visible | Collect rent from three different players in one round |
| Liquidity King | visible | Finish with more cash than every other player combined |
| Fire Sale | global | Sell three buildings during one global crisis |
| Airport Hopper | visible | Visit all four airports in one game |
| Tax Evasion | visible | Avoid every tax tile for an entire game |
| The Underdog | visible | Win after being last in cash at halfway |
| One More Turn | visible | Repay a bank loan on the final cure round |
| Group Therapy | social | Complete a trade involving three different properties |
| Hostile Bidder | visible | Win two auctions in one game |
| Empty Streets | visible | Win without owning a complete property group |
| Event Tourist | global | Experience three different global events across account history |
| Crisis Investor | global | Buy property during Housing Bubble Pop and profit after recovery |
| Public Enemy | global | Win an Anti-Monopoly Investigation vote against yourself |
| Silent Partner | social | Complete a player-loan contract without owning the collateral |
| Treasure Map | visible | Draw every Treasure card across account history |

## Mythical achievements

Mythical achievements are account-wide secrets with unique glitch glyphs. They remain hidden until unlocked and use server-verified evidence.

| Achievement | Unlock condition | Eerie description | Target unlock rate |
|---|---|---|---:|
| The 41st Tile | Trigger the hidden movement sequence, then win | There are forty tiles. You stepped on one more. | 0.05–0.10% |
| The Null Player | Reach exactly $0, avoid bankruptcy, complete another turn, then win | Your wallet was empty. The turn continued. The table refuses to remember why. | 0.10–0.25% |
| The Black Ledger | Survive a crisis combination after losing collateral, then win | The bank closed the book. Something inside kept counting. | 0.05–0.15% |

Mythical icons use a 32×32 hard-edged pixel grid with cyan/magenta channel offsets, scanline breaks, and a dimmed but still chromatic locked state. They should never be confused with ordinary rarity colors.

## Secret-achievement rules

- Secret conditions are checked server-side from event history and transaction facts.
- Secret names and descriptions are not sent before unlock.
- A secret clue can appear after the player meets half the condition.
- The same achievement unlocks once per account, even if achieved in multiple games.
- Guest players can unlock in-session achievements, but account sync requires sign-in.
- No achievement should require a specific real-world person, political view, or protected personal trait.

## Rarity targets

Rarity is measured by the share of active accounts that unlock an achievement, not by the number of times a card is drawn:

| Rarity | Target unlock rate |
|---|---:|
| Common | 50–70% |
| Uncommon | 25–45% |
| Rare | 8–20% |
| Epic | 2–8% |
| Legendary | 0.5–2% |
| Mythical | 0.05–0.5% |

Only Mythical unlocks create a server-wide announcement. All other unlocks stay private to the owner, with optional friend-feed sharing.

## Achievement UI

### In-game unlock toast

Short, non-blocking toast in the existing Poorup register:

```text
ACHIEVEMENT UNLOCKED
BUBBLE SURVIVOR
Kept a developed deed through the crash.
```

It should not interrupt a turn or open a modal automatically.

### Profile collection

Add an `ACHIEVEMENTS` tab with:

- Progress count
- Visible achievements
- Locked secret slots with clues
- Global-event achievements grouped by event
- Parlor Patrol section
- Recent unlock timeline

### Event banner integration

When a secret combo ends, the banner can show only:

```text
THE HEADLINE ENDS
Something changed in the parlor.
```

The achievement toast reveals the secret after the server confirms it.

## Anti-cheese and integrity

- Achievements require a valid game id and server event sequence.
- Aborted, reset, or spectator sessions do not count.
- Repeated local preview URLs never count.
- Bot-only games can count only for achievements explicitly marked bot-safe.
- The server rejects duplicate unlock requests by idempotency key.
- Evidence is a compact hash of relevant event ids and transaction ids, not a full private game transcript.

## Data flow

```text
authoritative action
  → transaction/event ledger
  → achievement evaluator
  → unlock record
  → socket event
  → toast + profile collection
```

Keep the evaluator deterministic. It should consume facts, not infer intent from chat or model output.

## Rollout

1. Add achievement definitions and a server evaluator for visible tablecraft achievements.
2. Add account-backed unlock persistence and idempotent writes.
3. Add global-event and finance achievements.
4. Add secret combination clues and reveal copy.
5. Add Parlor Patrol achievements.
6. Run a held-out achievement test suite to catch accidental unlocks.

## Success metrics

- Zero client-only unlocks in server logs.
- Less than 1% false-positive unlock rate in replay tests.
- Secret achievements unlocked by multiple legitimate strategies, not one brittle path.
- Profile collection loads without affecting game turn latency.
