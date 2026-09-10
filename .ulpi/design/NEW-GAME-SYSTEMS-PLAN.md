# Poorup New Game Systems — Product and Implementation Plan

## `/goal`

Plan and stage five new game systems without creating a second rules engine:

1. items earned from Surprise Fields, with use, trade, exchange, and bank sale;
2. a fictional, virtual-money prediction market (“Polymarket”);
3. useful, paid airport travel;
4. three in-round bank-account tiers;
5. a scarce Lawyer Card for prison, awarded through the item/reward system.

The persistent Profile Collection and its earned-cosmetic catalog remain an
account feature, not an in-round Table Shop. There is deliberately no match
cash shop in this plan.

Also plan the supplied bot API test, rule-based bot performance test, slower
movement, tab-out animation recovery, and a deterministic roulette carousel.

## Design read and non-negotiables

**Design read:** this is a systems-heavy game surface for friends at a shared
table, with a late-night terminal/parlor language and a strong need for fast,
legible decisions.

**Direction:** *Ledger Night Market* — new systems read like stamped records,
not a collection of disconnected shop, casino, and settings screens. The
memorable anchor is one server ledger line connecting cash, items, travel,
predictions, and account benefits.

Keep `.ulpi/design/DESIGN.md` as the visual authority: dark teal surfaces,
gold structural borders, red actions, Pixelify/Silkscreen/IBM Plex Mono,
compact square geometry, readable body text, and pixel-art/SVG marks. No
glassmorphism, gradients, emoji controls, pill-heavy SaaS cards, or new
component library. Classic Standard-40 remains visually and behaviorally
compatible when these add-ons are off.

## Currency and ownership boundaries

There are two deliberately separate economies:

| Economy | Lifetime | Currency | Purpose |
| --- | --- | --- | --- |
| Match ledger | one match | server-authoritative game cash | board play, earned items, predictions, travel, bank tiers, and roulette |
| Profile Collection | account lifetime | Parlor Tokens | persistent visual cosmetics only |

There is no in-round item or luxury shop. Items are earned from server-resolved
Surprise/Treasure rewards or bounded recipes and may be used, traded, exchanged,
or sold to the bank. Table cash never buys persistent cosmetics. Parlor Tokens
never enter a match, prediction, airport, loan, or roulette ledger. No item or
expensive cosmetic grants an unbounded gameplay advantage; “premium” means
presentation, access to an inspectable animation, or a capped convenience
effect only. This prevents pay-to-win progression and keeps Classic fair.

## Ruleset and access model

Use the existing `rulesetPreset`/`rulesetOverrides` contract and one
`GameState` engine. Add optional flags to the existing Poorup economy group:

```js
items: false,
predictionMarket: false,
airportTravel: false,
bankAccountUpgrades: false
```

Classic keeps them off by default but can enable each in Custom. After Hours
enables them by default once the slice is released. A started round freezes
the effective settings and digest. The Lawyer Card is available only when the
Items system is on; there is no separate prison-rule toggle.

The existing persistent Profile Collection remains available in every preset.
Do not add a top-level navigation tab for each system. In-round actions stay
inside the existing Holdings/Deals/Activity rail model, wallet modal,
landing-choice modal, prison HUD, and Market surface; account cosmetics stay in
Profile → Collection.

The detailed right-rail information architecture, Wallet & Items modal, and
in-game modal rules live in
[`FINANCE-RAIL-UX-PLAN.md`](./FINANCE-RAIL-UX-PLAN.md).

## 1. Items and Surprise/Treasure rewards

### Item catalog

Add a server-owned item catalog with stable item IDs, category, rarity,
tradeability, bank-sell value, source tags, and a bounded effect descriptor.
There is no purchase price, stock rotation, or client-facing shop. Every item
enters the match through a server-resolved reward, exchange recipe, or a future
explicit event grant. The catalog is deterministic and versioned by
`rulesetRevision` and `balanceRevision`.

The persistent account-cosmetic catalog may include cars, watches, clothing,
special token treatments, and character designs. It is reached from Profile →
Collection and uses Parlor Tokens; it is not part of the in-round economy.

### Item inventory

Extend the viewer’s private game projection with:

```js
items: {
  itemId: { quantity, acquiredRound, source, usesRemaining }
}
```

Keep a capped newest-first `itemLedger` for audit and match history aggregates.
The server validates ownership, quantity, turn stage, effect preconditions,
and idempotency on every use, trade, exchange, and sale.

### Surprise Field drops

On a server-resolved Surprise landing, roll a weighted item drop from a
separate `SURPRISE_ITEM_POOL`. The drop is one bounded item event, never a
second cash card. Use a per-round/player drop cap and deterministic seeded
selection so replay and bot simulation are reproducible. A drop announcement
shows item name, rarity, source, and “SELL VALUE: 20%” without exposing future
cards.

### Item actions

- `USE ITEM` appears only when the item’s precondition is true.
- `TRADE ITEM` adds item IDs and quantities to the existing unified trade legs.
- `EXCHANGE` is a server-defined recipe with exact inputs and outputs; no
  client-supplied effect or price is trusted.
- `SELL TO BANK` returns 20% of the catalog price, floored to whole dollars,
  with a per-item cap and no negative cash.

Items cannot bypass prison, skip a required payment, create a property, or
settle a loan unless the server explicitly defines that bounded effect. Item
transactions appear in aggregate match history and telemetry, never as hidden
opponent inventory.

### UI placement

Add an `ITEMS` subsection to `HOLDINGS`, rather than another top-level page.
The same inventory is also reachable from the interactive Cash button in the
bottom HUD, which opens the `WALLET & ITEMS` modal. Use compact rows with item
glyph, quantity, use/trade/sell actions, and an in-place detail panel. Surprise
drops use the existing card reveal/notification surface. All controls remain
native buttons with live result text and focus restoration.

## 2. Fictional prediction market (“Polymarket”)

Use the name only as an in-game label, with a visible **FICTIONAL · VIRTUAL
BOARD CASH · NOT REAL EVENTS** notice. Do not connect to the real Polymarket,
real politics, real securities, deposits, withdrawals, or cash-out.

### Market lifecycle

At a round boundary the server creates a bounded set of forecast contracts:

- next dice number/total;
- a chosen player landing on a field family during the next round;
- any player entering prison during the next round;
- the next card family drawn (`SURPRISE` or `TREASURE`).

Each market stores an immutable outcome set, probability/odds snapshot,
lockRound, settleRound, house edge, exposure cap, and status. The server
selects the actual game outcome first; settlement reads the recorded outcome,
never the carousel or browser clock. One player may not buy both sides of the
same binary market unless a future ruleset explicitly permits it.

### Payout and high-bet rules

Use low expected return so the board remains the primary strategy. Suggested
starting policy: a 5% house edge, per-player stake cap of $1,000, and a total
bank exposure cap per market. Stakes above $500 enter `HIGH STAKES` mode:

- an additional 6% fee;
- payout multiplier reduced by 10%;
- payout capped at $500 profit;
- no use of loan-backed or reserved cash.

The exact constants are balance-revision data, not UI sliders. A player sees
the probability, gross payout, fee, high-stakes penalty, lock time, and maximum
profit before confirming. Failed or stale requests are idempotent and do not
consume cash.

### UI and interactions

The existing Market rail gets rectangular `INDEXES` / `PREDICTIONS` modes. A
prediction ticket has `OPEN`, `LOCKED`, `WON`, `LOST`, or `REFUNDED` state and a
compact details view. No prediction action can interrupt a pending payment,
auction, trade, contract, or purchase decision. The live result is announced
after the relevant game event settles.

Global events may change future probabilities, fees, exposure, or market
availability prospectively. They cannot rewrite a locked ticket or hidden
casino odds. Add `prediction-open`, `prediction-settle`, and exposure metrics
to telemetry; do not store private strategy notes.

## 3. Airport travel

Airports remain the existing railroad tile type and retain their normal
landing fee. After that landing fully resolves, the server may expose an
optional `TRAVEL` choice:

1. pay the normal airport rent first;
2. choose an eligible destination airport;
3. pay a distance-based flight fee;
4. transfer the owner share of that fee immediately;
5. move the player to the destination without charging a second airport rent.

Suggested initial policy:

- one flight per player per round;
- airport owners fly free; other players receive a 25% discount when they own
  the origin airport;
- fee = `$40 + $10 × distance`, capped at `$180`;
- no travel while in prison or while any table obligation is pending;
- no direct travel to GO, corners, cards, taxes, or prison—the destination is
  always an airport;
- Airport Strike disables new flights; Tourism Boom changes only future fees.

The origin rent, flight fee, discount, and owner share are separate ledger
entries. A cancelled or stale travel choice leaves the player at the origin.
The landing modal owns the choice; the Deals rail mirrors a pending flight
without duplicating the action.

Add `airportTravelThisRound`, `airportTravelLedger`, and a server candidate
`airport-flight`. Bots receive only eligible destinations and choose using
distance, owner share, event effects, cash reserve, and future landing value.

## 4. Upgradeable in-round bank accounts

Do not confuse these with `AccountStore` authentication. `bankAccountTier` is
per-match GameState and resets at a new round; it is not a persistent paid
entitlement.

| Tier | Name | Upgrade cost | Bounded benefits |
| --- | --- | ---: | --- |
| 1 | Standard | — | none |
| 2 | Sparkasse Premium | $300 | 1% cashback on eligible optional service/flight fees, capped $40/round |
| 3 | American Express Black | $700 after Tier 2 | 3% eligible cashback capped $80/round, 25% flight discount, 0.25 percentage-point market-fee reduction |

Cashback applies only to tagged optional service debits. It never applies to
rent, taxes, loan principal, casino wagers, prediction stakes, bankruptcy, or
the upgrade cost itself. Cashback is calculated and credited atomically with
the debit, floored to whole dollars, and cannot push cash below zero or create
an obligation. Global events may pause cashback prospectively but cannot claw
back credited cash.

The interactive Cash On Hand cell in the bottom HUD is the canonical entry
point. Pressing it opens a `WALLET & ITEMS` modal without leaving the round.
The modal has two internal views, `ACCOUNT` and `ITEMS`; it opens on Account
when the player is checking money and on Items when the Holdings shortcut is
used. Account shows the current tier, next cost, eligible transactions, round
cap used, and a confirmation preview. `UPGRADE ACCOUNT` is disabled when the
player is not the current seat or a table obligation is open. The server
rechecks tier, cash, round cap, and idempotency.

The Holdings rail mirrors the current tier as a compact status line and shows
an `OPEN WALLET`/`OPEN ITEMS` shortcut. The modal owns the upgrade transaction;
the rail never duplicates it. Closing the modal changes no state and restores
focus to the Cash cell or the shortcut that opened it.

Bots receive `upgrade-bank-account` candidates only when the future cashback
and liquidity value beat their reserve; both AI and NO-AI use the same
candidate and legal guard.

## 5. Lawyer Card

Add `lawyer-card` to the Item catalog as a scarce server-resolved
Treasure/Surprise reward (balance-revision data). There is no direct purchase
path. A player can hold at most one. It is tradeable and bank-sellable at the
normal 20% item rate, but it cannot be duplicated by the client.

While in prison, the HUD presents `USE LAWYER CARD` beside the existing fine
and Get Out of Prison actions. The action consumes exactly one card, clears
the jail state, and returns the normal roll decision. It does not move the
player, refund the fine, or bypass a pending debt. If both a Lawyer Card and a
Get Out of Prison card exist, the player chooses explicitly.

Use the existing prison action/modal focus path and add the bot candidate
`use-lawyer-card`; the deterministic and AI brains must evaluate the fine, Get
Out of Prison card, and Lawyer Card together. Reward acquisition is automatic
and server-resolved, so it is not a bot purchase decision.

## 6. Bot API and performance plan

### OpenAI-compatible provider test

Keep provider credentials outside source, room payloads, telemetry, and match
history. Add a local/developer-only **Bot Advisor** panel under Profile →
Account & Preferences:

- provider label;
- HTTPS base URL (localhost allowed only in development);
- model name;
- API key input with Web Crypto encryption in browser storage, or an explicit
  server environment override in production;
- `TEST CONNECTION` and a redacted result (status, latency, model, token
  count, estimated cost only when provider pricing is configured).

The server accepts an OpenAI-compatible adapter with strict URL validation,
timeouts, response-size limits, schema validation, SSRF protections, circuit
breaking, and deterministic fallback. `test-bot-provider` uses a synthetic
candidate prompt and cannot mutate a live game. Never log the key or raw
provider response. If provider pricing is unknown, say `COST UNKNOWN` rather
than inventing a number.

The test contract covers connectivity, key handling, request/response shape,
latency, timeout, quota/error fallback, game continuity, and cost metadata.

### Rule-based bot benchmark

Add a deterministic benchmark runner that measures computation separately from
presentation delay: roll, buy/pass, movement/travel choice, trade/item sale,
event choice, and complete turn. Use fixed seeds and report p50/p95/p99.

Initial budgets: simple choice p95 < 10ms, full NO-AI decision p95 < 50ms,
complete computed turn p95 < 150ms. A deliberate 350–800ms presentation pause
may be applied to important decisions, with a 3s total cap and no extra wait
after a decision is ready. CI fails on stalls, unbounded loops, negative cash,
or a regression beyond the agreed budget.

## 7. Motion and roulette presentation

### Slower, visibility-aware movement

Replace the current fixed walk step with a motion record containing origin,
destination, path, `startedAt`, and `endsAt`. Target roughly 160–200ms per tile
with a total cap around 2.6s. The server destination remains authoritative.

On `visibilitychange` or tab return, compare wall-clock elapsed time with the
motion record: finish immediately if `endsAt` passed, otherwise skip to the
correct elapsed path index and animate only the remainder. Apply this to bot
turns and other time-based client animations. Reduced motion cancels travel
immediately. No game rule may depend on a frame callback.

### CS2-style roulette reveal reel

The established name for this presentation is **CS2-style case-opening
roulette reveal reel** (also called a scrolling reveal reel or roulette
carousel). It is a presentation pattern only; Poorup uses its own pocket
cards, pointer, sounds, and pixel-art language.

The server settles the roulette result and payout first, returning an opaque
animation seed, result, and reveal deadline. The client-only `casino-carousel`
uses a fixed pointer and seeded red/black/green segments that stop on that
known result. It runs 4.2s by default, has a visible `SKIP` control, uses the
existing sound toggle for stepped ticks, and finalizes immediately when the
tab returns after the deadline. The animation never samples randomness or
changes cash. Reduced motion shows the settled result without travel.

The complete server response shape, state machine, fairness rules, focus and
live-region behavior, sound scheduling, and browser test matrix are maintained
in docs/plans/END-TO-END-AUDIT-CS2-ROULETTE-PLAN.md.

## 8. Global-event interaction matrix

| Event family | Items | Predictions | Airports | Bank tiers/Lawyer |
| --- | --- | --- | --- | --- |
| Housing Bubble / Foreclosure | item sale values are disclosed prospectively | market exposure may tighten; locked tickets unchanged | no new route creation | upgrade availability may pause; Lawyer remains usable |
| Credit Freeze / Bank Run | item exchanges/sales may be paused; no credit-funded action | high-stakes markets may close; existing tickets settle | flight must use available cash | no upgrades/cashback advances; Lawyer unaffected |
| Airport Strike | travel-related item effects are suspended | airport-landing markets disclose strike effect | new flights disabled | flight cashback not earned while disabled |
| Inflation Spiral | future item bank-sale values may rise or fall by disclosed revision | odds/fees are revised only for new markets | future fees rise | cashback percentage is unchanged but caps remain |
| Tourism Boom | travel/status rewards may be more likely in future drops | airport outcomes remain server-recorded | future fees/airport demand change | eligible flight cashback follows the tier |

Every modifier is versioned by `eventId`, `rulesetRevision`, and
`balanceRevision`; no settled cash, item, ticket, or flight is rewritten.

## 9. Data and API contracts

New server-authoritative verbs should be small, idempotent, and projection-
aware:

```text
get-items
use-item
exchange-items
sell-item
get-prediction-markets
place-prediction
get-airport-travel-options
take-airport-flight
upgrade-bank-account
test-bot-provider        # developer/local scope, never a room action
```

Extend unified trade/deal legs with bounded item IDs and quantities. Add
viewer-scoped fields to `summaryApi`; opponents see item counts/status only,
never hidden inventory or private prediction strategy. Match records store
aggregate item, prediction, airport, account-tier, and roulette outcomes.

## 10. QA, security, and delivery gates

Use the current Poorup UI and server workflow plus the relevant
`find-skills`, `software-architecture-design`, `code-architecture-review`,
`systematic-debugging`, `tdd`, `qa-agent-testing`, `agentic-eval`,
`llm-evaluation`, `security-best-practices`, `frontend-design-ui-ux`,
`frontend-design`, `design-taste-frontend`, `impeccable`, `game-ui-ux`,
`mobile-responsiveness`, `accessibility`, `web-design-guidelines`,
`svg-design`, `pixel-art-sprites`, `animate`, `emilkowal-animations`,
`improve-animations`, and `review-animations` guidance. Keep the existing
Poorup tokens, native controls, focus stack, live regions, internal scrolling,
and reduced-motion rules.

Required tests:

- unit/property tests for item recipes, sell floors, tier cashback caps,
  airport fee splits, prediction odds/exposure, Lawyer Card uniqueness, and
  idempotency;
- integration tests for every table obligation and global-event interaction;
- bot parity tests proving AI/NO-AI see identical legal candidate IDs;
- provider tests with fake OpenAI-compatible servers, timeout/quota/SSRF cases,
  and no-secret logging assertions;
- benchmark tests with p50/p95/p99 budgets and bounded full-game simulations;
- Playwright at 1920×1080, 1366×768, 1024×768, and 390×844 covering the
  Holdings/Deals/Activity rail, Wallet & Items modal, item drop/use/trade/sale,
  predictions, airport choice, account upgrade, Lawyer Card, roulette skip,
  tab return, keyboard focus, live regions, and reduced motion;
- 1920px visual captures for Home, the three-mode game rail, Wallet & Items,
  Predictions, airport choice, Profile Collection, prison HUD, and roulette.

Delivery order:

1. freeze schemas, ruleset flags, telemetry, and viewer projections;
2. bot provider test/config seam and NO-AI performance benchmark;
3. visibility-aware movement and speed tuning;
4. Holdings/Deals/Activity rail and Wallet & Items modal shell;
5. item catalog, Surprise drops, inventory, trade legs, and bank sale;
6. airport travel and bot route candidates;
7. in-round bank tiers and capped cashback;
8. Lawyer Card and prison UI/candidate parity;
9. fictional prediction markets and global-event modifiers;
10. deterministic roulette carousel;
11. research an expanded board variant (the live Metro-52 contract remains
    unchanged; evaluate 56 versus 64 spaces only after balance/performance
    gates).

Every slice gets contract tests, CodeScene/lint review, visual evidence,
telemetry versioning, and a rollback note. Rollback disables the new ruleset
flags and leaves Classic cash, movement, ownership, loans, Market indexes,
roulette settlement, and social/account systems intact.

## Explicit exclusions

No in-round Table Shop, match-cash luxury shop, real-money wagering, deposits,
withdrawals, cash-out, real securities, external Polymarket data, political
prediction markets, loot boxes, hidden odds, client-selected outcomes,
persistent gameplay boosts, or paid board capacity. Items are earned or
exchanged only; persistent cosmetics remain in Profile → Collection. A future
board expansion is free ruleset content and must pass the same balance,
performance, and accessibility gates as every other mode.
