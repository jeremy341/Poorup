# Poorup Player Financing Plan

Status: planning only. No server, game rules, Socket.IO events, or UI code are
changed by this document.

## Executive feedback

This is a strong idea for Poorup. Player-to-player financing adds negotiation,
comeback routes, and reasons to care about another player’s property without
turning every trade into a simple cash swap.

The dangerous part is the phrase “70% equity.” In normal finance, a loan is a
debt obligation: the borrower owes principal and an agreed return by a maturity
date. Equity is ownership or a residual claim on profits. A bond holder normally
gets stated interest and principal, while a shareholder gets ownership and
dividends or other residual upside. [Investor.gov’s bond explanation](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/what-are)
and the [SEC glossary definition of debt](https://www.sec.gov/resources-small-businesses/glossary)
make this distinction explicit.

Recommendation: ship a bounded **Revenue-Share Note** first. It feels like a
loan in the flow, but its upside is a temporary, capped share of the financed
property’s rent. Do not implement literal transferable property ownership in v1.

The lender-incentive review later in this document refines that into a staged
secured note with earlier principal checkpoints. Treat that later variant as
the preferred v1 candidate; the earlier rent-first numbers remain a comparison
baseline for simulation.

## What normal lending contributes

Real loan products consistently make these terms explicit:

- **Principal:** the amount advanced.
- **Price of credit:** interest and any fees. APR is a comparison measure that
  combines interest and fees, not just the headline rate. [CFPB APR guidance](https://www.consumerfinance.gov/ask-cfpb/what-is-the-difference-between-a-loan-interest-rate-and-the-apr-en-733/)
  supports showing the full cost before agreement.
- **Term and maturity:** how long the obligation lasts and when the remaining
  balance is due. [CFPB mortgage terms](https://www.consumerfinance.gov/ask-cfpb/what-is-a-mortgage-en-99/)
  lists term, rate, costs, prepayment, balloon, and negative-amortization risks
  as distinct features.
- **Payment schedule:** periodic payments can apply to both principal and
  interest. In an amortizing loan, the balance falls over time and the payment
  mix changes. [CFPB amortization guidance](https://www.consumerfinance.gov/ask-cfpb/what-is-amortization-and-how-could-it-affect-my-auto-loan-en-771/)
  describes that pattern.
- **Collateral and default:** a secured lender has a defined claim on the
  collateral if the borrower fails to repay. A mortgage is the familiar example
  of that right. [CFPB mortgage definition](https://www.consumerfinance.gov/ask-cfpb/what-is-a-mortgage-en-99/)

Poorup should translate months into turns and paperwork into a compact contract
preview. That is an inference for game design, not a claim that these are legal
consumer-loan terms.

## Proposed v1: Revenue-Share Note

### Player promise

“Borrow cash to secure a property now. In exchange, your lender receives a
temporary share of that property’s rent, with a clear end date and payout cap.”

### Contract fields

```text
contractId
borrowerId
lenderId
propertyIndex                 // one 0–39 tile, must be a deed
principal                     // cash advanced by lender
sharePercent                  // 10–70, 70 is the hard ceiling
termTurns                     // 2–8 in v1; 20 is deliberately deferred
turnsRemaining
returnCap                     // e.g. 1.30 × principal
rentPaidToDate
status                        // proposed | active | bought-out | matured | defaulted | cancelled
createdAtTurn
```

### Contract semantics

- The borrower receives `principal` and buys the property.
- The borrower remains the deed owner and keeps normal build/control rights.
- Whenever the property generates rent, the lender receives
  `sharePercent × rent`. The borrower receives the remainder.
- The share applies to rent from the base deed and buildings on that deed. It
  does not silently become a share of the borrower’s whole wallet.
- The contract ends at the first of:
  - lender reaching `returnCap`;
  - the term reaching zero;
  - the borrower paying the deterministic buyout amount;
  - a collateral/default resolution.
- No compounding interest, late-fee stack, or variable-rate behavior in v1.

### Example

For a `$220` property, a player has `$70` and borrows `$150`. The lender receives
70% of rent for 6 turns, capped at `$195` total received. If the deed pays `$22`
rent, `$15.40` goes to the lender and `$6.60` stays with the borrower. If the
deed never pays rent, the lender carries real risk and the maturity/collateral
rules decide the outcome.

This is intentionally a **capped revenue share**, not “70% of every future
profit forever.”

## Why 70% for 20 turns is risky

The proposed percentage and duration multiply each other. A 70% share for 20
turns can make the lender a passive co-owner, especially when a high-rent deed
is landed repeatedly. It can also make a borrower’s purchase feel like a trap
if rent never arrives.

For the first testable version:

- allow up to 70% only as an upper bound;
- default to 40–50% and 4 turns in the UI;
- cap the lender’s total receipt around 1.25–1.35× principal;
- start with 2–8 turns, then evaluate whether a 20-turn long note deserves a
  separate product;
- allow one active financing contract per property and one active borrowed
  contract per borrower;
- disallow circular contracts, self-lending, and financing a second loan with
  borrowed cash.

The exact defaults should be tuned by simulation rather than intuition.

## Maturity, buyout, and default

### Buyout

At any borrower turn, show a deterministic buyout amount:

```text
buyout = min(returnCap, principal + unpaidBaseFee + earnedShareToDate)
```

There is no prepayment penalty. This keeps the choice legible and avoids a
contract that is optimal only because the player cannot escape it.

### Maturity

When the term reaches zero, the borrower either pays the remaining buyout or
the contract enters a one-turn resolution state. The lender cannot silently
collect forever.

### Default and collateral

The financed deed is marked **encumbered** while the contract is active. On
default, the borrower chooses one of two clearly labelled resolutions:

1. pay the remaining balance from cash/assets; or
2. transfer the encumbered deed to the lender, with any unpaid remainder written
   off in v1.

If the lender does not want the deed, both players can choose a bank auction and
the proceeds settle the outstanding amount up to the return cap. There is no
player voting loop and no indefinite debt collection.

### Trade, sale, mortgage, and buildings

- A deed with an active note cannot be traded or mortgaged unless the lender
  explicitly accepts the transfer or the contract is settled first.
- A sale/auction settles the lender’s outstanding balance before the borrower
  receives remaining proceeds.
- The borrower may build, but rent-share calculations include the resulting
  house/hotel rent. The lender receives no building control in v1.
- These rules must be enforced on the server, not inferred from client cards.

### Bankruptcy and winner

- Bankruptcy freezes new offers and resolves active notes in a deterministic
  order: cash/assets first, then the named collateral, capped by the note’s
  outstanding balance.
- Any unrecovered remainder is written off. Do not create a debt cascade that
  can bankrupt the lender after the borrower is already eliminated.
- A winner is determined by the existing game rules after financing contracts
  settle or are written off. Financing cannot delay the winner screen.

## Alternative products considered

### Fixed-interest secured loan

The lender advances cash and receives principal plus a fixed fee at maturity;
the deed is collateral. This is closest to a conventional loan and easiest to
balance, but it does not deliver the user’s desired shared-upside feeling.

### Literal equity ownership

The lender owns 70% of the deed’s income and sale value. This is expressive, but
it expands every existing rule: deed transfer, buildings, mortgaging, trade
offers, auction ownership, bankruptcy priority, and winner calculation. Defer
until the capped revenue-share version proves fun.

### Per-turn fixed repayment

The borrower pays a fixed amount every turn. This is predictable but adds a new
mandatory payment obligation to every turn and can create dead turns where a
player cannot act. It is a later instrument, not the first one.

## Server and state architecture

Keep the existing Express/Socket.IO modular monolith and server-authoritative
game state. Add a pure financing module rather than scattering calculations
through purchase, rent, trade, and bankruptcy handlers.

### Pure domain functions

```text
validateFinancingOffer(game, offer)
acceptFinancingOffer(game, offerId, playerId)
applyFinancingRentShare(game, propertyIndex, rentAmount)
calculateBuyout(contract, game)
advanceFinancingTurn(game, activePlayerId)
resolveFinancingDefault(game, contractId, resolution)
settleFinancingOnTradeOrSale(game, propertyIndex, context)
```

Each function should return a new validated state or a structured error. No
client-side balance calculation is authoritative.

### Optional event names

Add backward-compatible events only after the domain rules are fixed:

- `financing-propose`
- `financing-respond`
- `financing-buyout`
- `financing-default-resolve`

Broadcast sanitized contract summaries to the room. Only counterparties need
full offer details; the room log can show public settlement events.

## UI plan

1. **Offer surface** from a failed purchase decision or a property detail view:
   amount, share percentage, term turns, cap, collateral, and a live payout
   example.
2. **Counterparty response** with Accept, Decline, and a clear expiration.
3. **Property marker** showing `FINANCED`, lender name, share, and turns left
   without relying on color alone.
4. **Holdings financing section** listing Borrowed, Lent, Buyout, and Maturity.
5. **Rent receipt** in the existing event feed: lender share, borrower share,
   and remaining cap.
6. **Maturity/default dock** with one primary next action and explicit
   collateral consequences.
7. **Trade/property sheets** that explain why an encumbered deed cannot move or
   offer an explicit settlement path.

Do not add a new dashboard or a complex financial chart. The game should show
the next decision, the exact amount, and the exact number of turns remaining.

## Balance and simulation plan

Before enabling the mechanic by default:

1. Run a no-financing baseline using recorded or synthetic 40-space games.
2. Simulate varied property prices, rent-hit frequencies, player cash levels,
   turn counts, and bankruptcy timing.
3. Compare 0%, 40%, 50%, and 70% shares across 2, 4, 6, 8, and 20 turns.
4. Measure:
   - acceptance rate by share/term;
   - lender expected receipt and loss rate;
   - borrower survival and time-to-bankruptcy;
   - number of financing-induced trades/defaults;
   - whether the mechanic changes winner concentration;
   - average turn duration and decision count.
5. Reject settings that create a dominant lender strategy, a guaranteed
   comeback, or more than one additional blocking decision per turn on average.

## Implementation sequence

1. Write an ADR and test the pure financing formulas against the examples above.
2. Add the room-state contract and server validation behind a feature flag.
3. Implement rent-share settlement and maturity/default resolution without
   changing existing rent, trade, or bankruptcy behavior when the flag is off.
4. Add the offer, contract, receipt, and default UI with native controls and
   live announcements.
5. Exercise two-tab flows: offer, accept, rent payout, buyout, maturity,
   default, trade blocking, bankruptcy, disconnect, reconnect, and winner.
6. Run balance simulations and tune defaults.
7. Enable the mechanic only after a playtest review confirms that the extra
   negotiation is worth the bookkeeping.

## Decisions required before implementation

- Should the first instrument be revenue-share only, or should fixed-interest
  loans ship beside it?
- Is 70% an allowed maximum or the default offer?
- Should the first term range be 2–8 turns, or do you want a deliberately long
  20-turn product with a stricter cap?
- On default, should the lender receive the deed automatically, or should the
  bank auction be the default resolution?
- May borrowers build freely on financed deeds, or should lender consent be
  required?
- Should offers appear only after a failed purchase, or be available from the
  property sheet at any time?

## Success criteria

- A player understands the contract in under one screen: amount, share, term,
  cap, collateral, and default consequence.
- Every payout and balance change is server-authoritative and visible to the
  affected players.
- No contract can create infinite passive income, circular debt, or an
  unresolvable trade/bankruptcy state.
- The mechanic adds negotiation without making the normal turn flow feel like a
  finance app.
- Existing game rules and event contracts remain unchanged when financing is
  disabled.

## Second-pass economics: make the lender care

The first example exposed a real balance flaw: receiving 70% of a single `$22`
rent event is not a meaningful return on a `$150` advance. The lender needs two
separate benefits:

1. **principal recovery plus a base premium** at maturity; and
2. **upside participation** when the financed deed performs well.

The rent share should be a kicker on top of the secured note, not the lender’s
only return. This also maps more closely to real lending, where the borrower
owes principal and an agreed return by maturity, while collateral protects the
lender if repayment fails. [Investor.gov’s debt/equity comparison](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/what-are)
and [CFPB loan-term guidance](https://www.consumerfinance.gov/ask-cfpb/what-is-a-mortgage-en-99/)
support keeping those obligations explicit.

### Recommended product: secured note with a rent kicker

For the first playable version, use this waterfall:

```text
purchasePrice = P
borrowerDownPayment >= 30% of P
principal <= 70% of P
term = 20 global turns (playtest range: 12, 16, 20, 24)
basePremium = 25% of principal
rentKicker = 70% of rent actually collected on the financed deed
returnCap = 1.50 × principal

maturityDue = max(0, principal + basePremium - rentKickerPaid)
totalLenderReceipt = rentKickerPaid + maturityPayment
```

Interpretation:

- The borrower supplies real skin in the game at purchase. The lender cannot
  fund 100% of a speculative buy.
- The lender is promised principal plus a 25% base premium at maturity, reduced
  by rent-kicker payments already received. This prevents double-charging the
  borrower while guaranteeing that a quiet property still has a meaningful
  return path.
- The lender receives 70% of rent collected from the financed deed during the
  20-turn term. The share includes rent from houses and hotels in v1, which gives
  the lender a reason to finance properties with build potential.
- The lender’s total receipt is capped at 1.50× principal. The cap prevents a
  lucky property from becoming a passive-money exploit.
- If no rent is collected, a `$150` advance matures at `$187.50` before rounding
  rules. If two `$22` rent events occur, the lender receives `$30.80` during the
  term and the maturity due falls by the same amount. The lender still recovers
  principal plus the agreed premium rather than hoping for one rent landing.

The server should use integer money units. Define a deterministic rounding rule
for the premium and each rent split, then assign any remainder to the borrower
or the bank consistently. Never expose floating-point values such as `$15.40` if
the rest of the game uses whole-dollar cash.

### Why the borrower still accepts

- They buy a property now with a 30% down payment instead of waiting for cash.
- They retain deed control and can build, trade, and plan around a known 20-turn
  maturity date while the note is current.
- Rent-share payments reduce the final maturity bill, so a productive property
  helps pay down its own financing.
- The borrower can buy out early at `principal + basePremium - rentKickerPaid`,
  floored at the outstanding principal and capped at the return cap. There is no
  punitive prepayment fee.

## Alternative financing products

The team can choose among three shapes before implementation:

| Product | Lender benefit | Borrower benefit | Complexity | Recommendation |
| --- | --- | --- | --- | --- |
| Secured note + rent kicker | Principal, base premium, rent upside, collateral | Immediate liquidity, predictable maturity, retains control | Medium | **Ship first** |
| Preferred equity share | 70% of rent and 70% of sale profit for 20 turns | Lower fixed repayment pressure | High | Playtest after v1 |
| Convertible loan | Fixed return, then deed conversion on default | Simple terms while healthy | Medium | Use if defaults feel too soft |

### Preferred equity share

This is the closest match to “70% equity,” but it must be named honestly. The
lender buys a temporary economic share, not a vague ownership percentage:

- 70% of rent collected for 20 turns;
- 70% of **net sale proceeds** if the deed is sold during the term;
- no voting/building control;
- a minimum preferred return of at least principal, with a cap;
- automatic settlement when the term ends.

It is attractive to lenders when property values rise, but it creates difficult
questions around building costs, trade assumptions, mortgage rights, and
bankruptcy priority. Keep it behind a feature flag until the secured note is
fun.

## Event-by-event behavior

### Another player lands on the financed property

1. The existing rent calculation runs first, including buildings and any room
   rules.
2. Only cash actually collected counts toward the rent kicker. If the visitor
   cannot pay, the existing debt/bankruptcy flow remains authoritative.
3. The server splits the collected rent: 70% to the lender’s contract balance,
   30% to the borrower. The contract balance reduces the maturity due.
4. The event feed announces the split once, for example: `VINE STREET RENT
   $22 · LENDER $15 · OWNER $7`.

No extra player prompt should appear during rent settlement.

### The borrower lands on the financed property

No rent is generated. No transfer occurs. The term clock continues normally.
This is a normal own-property landing and should not be treated as a payment.

### The lender lands on the financed property

No rent is generated because the lender is not the deed owner. The lender still
owns the contractual claim, so the term and maturity balance are unchanged.
The lender cannot collect rent from their own landing.

### The borrower buys a house or hotel

The property remains encumbered. The borrower pays the building cost from their
own cash and keeps build control. Future rent, including the building uplift,
is eligible for the 70% kicker. This intentionally gives the lender a reason to
finance a strong build candidate, but simulation must confirm that it does not
make building irrational for the borrower.

### Trade, mortgage, sale, or auction

- A financed deed cannot be traded or mortgaged while the note is active unless
  the lender accepts settlement or explicitly accepts the buyer’s assumption.
- A sale or bank auction pays the outstanding contract balance first, then sends
  any remainder to the borrower.
- The lender cannot force a trade or sell the deed outside the existing server
  auction flow.

### Maturity and default

- At turn 20, the borrower receives one clear maturity action window.
- Paying the maturity due closes the note and removes the encumbered marker.
- If the borrower cannot or will not pay, the note enters `defaulted` and the
  lender chooses `take collateral` or `bank auction`.
- Taking collateral transfers the deed and its existing buildings to the lender,
  up to the outstanding balance. Any shortfall is written off in v1.
- Bank auction uses existing auction rules and settles the note from proceeds.

There is no indefinite grace loop, compounding late fee, or negative-amortization
state. CFPB guidance warns that unpaid interest can increase the balance and
that balloon obligations need to be disclosed clearly; Poorup should keep the
same clarity without importing real-world legal complexity. [CFPB negative
amortization](https://www.consumerfinance.gov/ask-cfpb/what-is-negative-amortization-en-103/)
and [repayment-term guidance](https://www.consumerfinance.gov/rules-policy/regulations/1026/2026-04-08/24/)
are useful references.

## Guardrails against lender dominance

- One active note per property and one borrowed note per borrower in v1.
- A lender may hold at most two active notes.
- No self-lending, circular financing, or financing borrowed cash.
- No offers after a property is already encumbered.
- The 70% share is a maximum, not a required default. The UI can recommend
  50% while allowing 70% as an aggressive negotiated offer.
- The 1.50× total-return cap applies across rent kicker and maturity payment.
- A borrower’s down payment is never financed by another Poorup note.

## Balance test matrix

Before implementation, run the same game seeds with financing disabled and with
these candidate settings:

```text
sharePercent: 50, 60, 70
termTurns: 12, 16, 20, 24
basePremium: 15%, 25%, 35%
returnCap: 1.30×, 1.50×, 1.70×
downPayment: 20%, 30%, 40%
```

Track lender return, borrower survival, property-building frequency, default
rate, note acceptance rate, winner concentration, cash volatility, and added
decision time. The recommended setting is the highest lender return that does
not cause borrowers to stop building, make lenders prefer financing over every
other investment, or add more than one blocking decision per turn on average.

## Revised decisions required

- Confirm whether the first product should be the secured note with rent kicker
  or literal preferred equity.
- Confirm whether 70% is the default offer or only the negotiated ceiling.
- Confirm the term candidates to simulate, including 20 turns.
- Confirm the base premium and total-return cap.
- Choose automatic collateral transfer or bank auction as the default outcome.
- Decide whether building rent is fully shareable or whether only base rent is
  eligible in v1.
- Decide whether offers are available only during a failed purchase or from any
  property sheet.

## Customizable ownership: the share-ledger model

The expanded idea is not one instrument. It is two clearly labelled products:

1. **Loan:** lender advances cash and receives principal plus a fixed premium.
   The lender does not own the deed or receive rent ownership rights.
2. **Equity partnership:** investor contributes cash and buys a percentage of
   the deed. They receive that percentage of rent and sale proceeds and share
   building economics. There is no guaranteed repayment because this is an
   ownership position.

Do not combine both promises in the first release. A lender who receives a fixed
premium, 70% of rent, and 70% of sale value at the same time will dominate the
economy. The equity product should be the direct answer to the user’s “50/50
plot” idea; the secured note remains available for players who prefer a fixed
return.

### Ownership representation

Represent each property with integer basis points so the server never relies on
floating-point percentages:

```text
ownership[propertyIndex] = [
  { playerId: "p1", shareBps: 5000 },
  { playerId: "p2", shareBps: 5000 }
]

sum(shareBps) === 10000
```

The existing single-owner state is simply `{ playerId: "p1", shareBps: 10000
}`. This preserves compatibility while allowing 10%, 25%, 50%, 70%, 90%, or
100% shares. The UI can use 5% increments, with 100% treated as a full transfer
or buyout rather than a disguised loan.

### Equity offer fields

```text
propertyIndex
buyerId / sellerId
shareBps                    // chosen percentage of the deed
contribution                // cash paid for that share
duration                    // permanent | term
termTurns                   // required when duration = term
buyoutRule                  // fixed basis | negotiated offer | auction
buildingRights              // shared-parity rule in v1
status                      // proposed | accepted | active | bought-out | expired | defaulted
```

The contribution is negotiated at offer time. A neutral starting point is
`propertyPrice × share`, with a small negotiated premium allowed. A player may
offer a higher price for a smaller share if they want to attract a lender; the
server records the agreed contribution and does not infer it later from current
rent.

## Rent, sale, and landing rules

### Another player lands on a co-owned property

1. Run the existing rent calculation, including houses/hotels and room rules.
2. Distribute the collected amount pro-rata to every co-owner’s share.
3. Record one receipt such as `VINE STREET RENT $22 · MARLOWE 50% $11 · VESPER
   50% $11`.

Only money actually collected is distributed. If the visitor cannot pay, the
existing debt/bankruptcy flow remains authoritative.

### A co-owner lands on the property

The visitor does not pay rent to themselves, but they do pay the other owners’
portion:

```text
rentDue = floor(fullRent × (10000 - visitorShareBps) / 10000)
```

The amount due is distributed among the other owners by their normalized share.
A 50% co-owner landing on a `$22` property therefore pays `$11` to the other
50% owner. A 100% owner pays zero. This keeps the familiar “you do not pay
yourself” rule without making a tiny ownership slice a full rent exemption.

### The lender lands on the property

If the lender is an equity co-owner, the co-owner landing rule applies. If the
lender holds a fixed-interest loan instead, they are not an owner and pay normal
full rent to the deed owner.

### The borrower lands on the property

The same normalized rule applies. The borrower pays only the rent owed to other
co-owners, not their own portion.

### Sale or trade

- Sale proceeds are split pro-rata among current owners after any active secured
  note or mortgage claim is settled.
- A single owner may sell only their own share. The remaining owners retain
  theirs.
- A whole-property trade requires every owner’s consent, unless all shares are
  first consolidated into one owner.
- A buyer must see the full cap table, building count, outstanding claims, and
  buyout terms before accepting a share.

## Shared streets and building rights

Co-ownership creates a new rule that must be deterministic. Use **ownership
parity**:

- A color group is buildable only when every property in that group has the same
  owner set and the same share split.
- Example: Player A owns 50% and Player B owns 50% of every property in a
  two-property group. The group is aligned, and both owners may request a house
  build.
- If one property is 50/50 and the other is 100% owned by A, the group is not
  aligned. Building is disabled until shares are sold or transferred so every
  property has the same owner set and ratio.
- Utilities and railroads never gain houses, but they still support fractional
  rent and sale proceeds.

### Building a house or hotel

- The building remains attached to the property and is co-owned in the same
  ratio as the deed.
- All owners must consent to a build in v1. This prevents one co-owner from
  spending another player’s money or changing a shared street unilaterally.
- Building cost is charged pro-rata. A 50/50 build requires both owners to have
  their half available.
- Resulting rent, including the building uplift, is split by the same ownership
  ratio.
- If one owner cannot fund their portion, the build is unavailable. A later
  version can add a building advance, but that should not be smuggled into the
  first loan system.

### Why this is attractive to the lender

- A 50% investor receives 50% of every qualifying rent and 50% of sale value.
- A 70% investor receives 70% of rent and sale value while the borrower retains
  30% upside and control by agreement.
- A 100% investor receives the whole deed and all future economics, but this is
  a direct transfer/buyout, not a free loan with a hidden ownership claim.
- A strong street creates additional upside through house and hotel rent, while
  ownership parity stops the lender from financing a fragmented group that can
  never build.

## Duration and buyout

### Permanent equity

Permanent shares are the clearest first co-ownership product. A co-owner can
sell their share back to another owner or to the market only through an explicit
offer. The share does not silently expire.

### Term equity

Term shares can be supported later with a strict end state:

- duration is measured in global turns;
- rent and building rights apply while active;
- at expiry, the original owner gets the first option to buy back the share at
  the recorded buyout rule;
- if they decline or cannot pay, the share goes to a voluntary co-owner sale or
  bank auction;
- no term share remains active indefinitely because nobody clicked a button.

The recommended v1 is permanent equity plus the separate 20-turn secured note.
That gives players both a clean ownership partnership and a clean loan without
mixing two accounting systems.

## Default, bankruptcy, and collateral with co-owners

- If a co-owner defaults on a separate loan, only that player’s shares are
  encumbered. Other owners’ shares cannot be seized for someone else’s debt.
- The secured lender can take the encumbered shares or send those shares to the
  bank auction. The deed remains co-owned if another player wins the shares.
- If a player bankrupts, liquidate their shares once at auction or by an agreed
  co-owner buyout. The remaining owners keep their shares and building parity is
  recalculated.
- A whole-property winner or bankruptcy check uses the existing game rules plus
  the player’s share value. No player can hide wealth in a fractional deed.
- If a player owns 100% after a transfer, collapse the cap table back to the
  existing single-owner representation.

## UI changes for customizable equity

1. Add `Buy with a partner` beside the normal purchase action. The normal Buy
   path remains unchanged.
2. Equity offer sheet shows a share slider, contribution, permanent/term choice,
   buyout rule, projected rent split, sale split, and building-rights warning.
3. Property detail shows the cap table as labelled avatars and percentages, not
   just a single owner name.
4. A group-level indicator says `BUILDING RIGHTS ALIGNED` or `ALIGN OWNERSHIP TO
   BUILD` and lists the exact property causing the mismatch.
5. Build confirmation shows each owner’s cost share and the resulting rent
   split before accepting.
6. Rent receipts identify every recipient and the ownership percentage used.
7. Trade and mortgage sheets explain when unanimous co-owner consent is required.

Use native controls and one primary decision per surface. Do not add a stock
market, fluctuating property valuation, charts, or a second currency.

## Revised implementation sequence

1. Add a pure `ownershipLedger` module with basis-point validation, normalized
   owner lists, rent/sale splits, ownership parity, and buyout math.
2. Add property purchase partnership offers behind a feature flag. Keep the
   existing single-owner path as the default when the flag is off.
3. Implement co-owned rent and sale settlement, then building-parity validation.
4. Implement share transfer, buyout, mortgage/trade consent, default, and
   bankruptcy resolution.
5. Add the equity offer, cap-table, building warning, and rent-receipt UI.
6. Run two-tab tests for 50/50, 70/30, and 100/0 transfers, shared streets,
   misaligned groups, co-owner landings, third-party landings, building costs,
   sale, trade, mortgage, default, bankruptcy, disconnect, and reconnect.
7. Simulate permanent equity separately from the secured 20-turn note. Do not
   enable both instruments by default until winner concentration and decision
   time remain acceptable.

## Decisions required before implementation

- Should v1 support permanent equity only, or also term equity?
- What share increments should the UI allow: 5%, 10%, or custom percentages?
- Should 100% be a direct transfer only, or may a financing offer create a 100%
  lender stake with a management right?
- Must every co-owner consent to building, or may an appointed manager act for
  the group?
- Should building costs always be pro-rata, or may one owner fund the other’s
  share as a separate advance?
- Should a co-owner landing pay the other owners’ proportional rent, or should
  any co-owner landing be rent-free?
- Should share buyouts use recorded basis, negotiated price, or bank auction?

## Full financing design space

“Loan or equity” is a useful starting point, but the game can express several
different contract shapes. They are not equally suitable for a fast tabletop
game.

| Instrument | Lender return | Borrower cost/benefit | Game complexity | Poorup fit |
| --- | --- | --- | --- | --- |
| Fixed-interest secured loan | Principal plus negotiated fixed rate, collateral on default | Predictable cost and retained ownership | Low | **Excellent** |
| Staged amortizing loan | Principal returned in checkpoints plus interest | Repeated payments, but less maturity shock | Medium | **Excellent** |
| Balloon loan | Small or no interim payments, large maturity payment | Maximum short-term liquidity, highest default risk | Low | Good with a cure window |
| Rent-share note | Percentage of actual rent for a term | Lower fixed payment, variable cost | Medium | Good as a second product |
| Preferred equity | Priority return plus a share of rent or sale upside | Less fixed debt, gives up upside | High | Good after the core system |
| True fractional co-ownership | Share of rent, sale proceeds, and asset value | Shares acquisition cost and control | High | **Best match for the user’s equity idea** |
| Convertible note | Fixed loan converts to deed/share on default or a trigger | Simple while healthy, loses control on conversion | Medium | Strong third option |
| Revenue royalty | Percentage of rent or other income until a repayment multiple | No ownership transfer, variable payment | Medium | Similar to rent-share note |
| Revolving credit line | Lender earns interest on a changing balance | Borrow and repay repeatedly | High | Too much bookkeeping for v1 |
| Construction/building loan | Funds houses or hotels, repaid from incremental rent | Lets a player build earlier | High | Defer until building economics are stable |
| Mezzanine/subordinated debt | Higher rate for lower repayment priority | More expensive, higher risk | High | Not worth the cognitive load initially |
| Sale-and-buyback | Investor buys deed, original player leases or repurchases it | Immediate cash, possible loss of control | High | Defer |
| Syndicated loan | Several lenders split one claim | More available capital, many counterparties | Very high | Defer |
| Loan marketplace/auction | Competing lender offers determine rate | Price discovery, more strategic depth | Very high | Defer |
| Insurance/guarantee pool | Lender pays a premium to a pool that covers default | Borrower pays a fee for safer financing | High | Defer |

The strongest choices for Poorup are the first, second, sixth, and seventh. The
rest add a new market, priority layer, or recurring bookkeeping before the core
ownership rules have proved fun.

## Best three fits for Poorup

### 1. Fractional co-ownership ledger

This is the best fit for the user’s “50/50 street” idea.

- Investor chooses a share from 5% to 100%.
- Contribution is negotiated at purchase time.
- Rent and sale proceeds split by basis points.
- Building is allowed only when every property in a color group has the same
  owner set and share split.
- 100% is a direct transfer or buyout, not a loan.

Why it wins: it makes the lender’s benefit obvious. A 50% investor receives 50%
of every qualifying rent and 50% of sale value. It also creates strategic
negotiation around completing a street.

Main risk: shared building, trade, mortgage, and bankruptcy rules require a
proper cap table and unanimous-consent policy.

### 2. Staged secured loan with a negotiable rate

This is the best fit for players who want a true loan.

- Borrower chooses a down payment and requests an amount.
- Lender chooses an interest/premium rate within a room-configured bound.
- Principal repays at 5/10/15/20-turn checkpoints, with a final premium.
- The deed is collateral, but the lender receives no ownership share.
- Rent can optionally reduce the outstanding balance or provide a capped kicker,
  but the contract must not stack unlimited interest and equity.

Why it wins: the lender sees a guaranteed return path and the borrower sees the
full total cost before accepting. It is the simplest way to support an “ethical
20% rate” negotiation.

Main risk: checkpoint payments can create a forced-payment turn. Use one-turn
cure windows and automatic, clearly announced due amounts.

### 3. Convertible secured note

This is the best bridge between the two systems.

- Lender advances cash at a negotiated fixed rate.
- Borrower pays a small down payment and scheduled checkpoints.
- If the borrower performs, the lender receives principal plus the agreed
  return and never owns the deed.
- If the borrower defaults, the lender may convert the outstanding balance into
  a negotiated share of the deed or take the deed through auction.

Why it wins: lender downside is protected, but the deal can become an equity
position when the borrower cannot pay.

Main risk: conversion valuation can cause arguments. Use recorded basis or an
existing bank auction instead of inventing a live property market.

## Bounded customization: freedom without contract chaos

Players should be able to negotiate, but only inside a contract builder that
shows the complete consequence before either party accepts. Use four visible
knobs and a small number of mutually exclusive modes.

### Knob 1: return mode

Choose exactly one:

- `FIXED RATE`: principal plus a negotiated premium; no rent ownership.
- `RENT SHARE`: a negotiated percentage of actual rent for a fixed term; no deed
  ownership.
- `EQUITY SHARE`: a negotiated percentage of rent and sale proceeds; permanent
  or term ownership with the cap-table rules.
- `CONVERTIBLE`: fixed rate while current, share/deed conversion only on default.

Do not allow fixed rate, rent share, and full sale equity to stack in one deal.

### Knob 2: percentage or rate

- Fixed-rate offers use a simple total premium or a per-turn rate, never both.
- Rent-share and equity offers use 5% increments from 5% to 100%.
- Room hosts can set a maximum rate/share, such as 70%, to prevent abusive
  contracts in public rooms.
- The borrower sees total expected repayment, lender receipt, ownership share,
  and default consequence before accepting.

### Knob 3: duration

- Fixed loans and rent-share notes use a global turn count.
- Equity can be permanent or term-based. Term equity needs an explicit buyback or
  auction at expiry.
- Suggested presets are 5, 10, 15, and 20 turns, with a room-level maximum.
- Custom durations should be allowed only inside that maximum. No “forever”
  term is hidden behind an unchecked toggle.

### Knob 4: security and exit

Choose exactly one primary exit:

- `CASH MATURITY`: borrower pays the remaining balance;
- `BUYOUT`: borrower can settle at the displayed formula;
- `COLLATERAL`: lender can take the encumbered share/deed after cure;
- `BANK AUCTION`: bank liquidates the encumbered share/deed.

The contract preview must list who controls building, trade, mortgage, and sale
rights. These are not secondary details.

## Gaps to close before implementation

1. **Profit definition:** decide whether “profit” means gross rent, rent after
   taxes, rent after building cost recovery, or net sale proceeds. The server
   must use one definition per instrument.
2. **Ownership versus claim:** every deal must say whether the lender owns a
   share or merely has a payment claim.
3. **Valuation:** choose recorded purchase basis, a fixed negotiated buyout, or
   bank auction. Do not calculate a hidden live market price.
4. **Clock:** define whether terms count global turns, borrower turns, or rent
   events. Global turns are easiest to explain and audit.
5. **Down payment:** decide whether it goes to the bank/seller or directly to
   the lender. A purchase down payment and a lender fee should not be conflated.
6. **Rent collection failure:** define whether an unpaid visitor rent creates a
   lender payment. Recommendation: only collected cash counts.
7. **Buildings:** decide whether building rent is fully shareable or whether
   only base rent qualifies. Recommendation: full sharing for equity, optional
   reduced kicker for loans.
8. **Control:** define who may build, mortgage, trade, sell, or accept a buyer
   when several owners exist.
9. **Priority:** define ordering among bank mortgage, player loan, co-owner
   shares, taxes, and bankruptcy claims.
10. **Rounding:** use basis points and integer cash. Define who receives any
    remainder from a 50/50 split of an odd amount.
11. **Multiple contracts:** decide whether one player can borrow from several
    lenders or stack claims on one deed. Recommendation: no stacking in v1.
12. **Stalling:** offers, consent requests, and maturity actions need expiry,
    auto-decline, or a deterministic fallback so a disconnected player cannot
    freeze a room.
13. **Information:** both parties must see the same terms, projected receipts,
    ownership, and default result before acceptance.
14. **Social balance:** test collusion, kingmaking, lender monopolies, and
    intentional bad deals between friends.
15. **Winner accounting:** define how fractional deed value counts toward
    bankruptcy and final net worth without changing the existing winner rule.

## Custom offer preview

Every offer should render a small, plain-language contract summary:

```text
VESPER OFFERS MARLOWE 50% OF VINE STREET
Marlowe contributes: $110
Vesper receives: 50% of collected rent and 50% of sale proceeds
Building rights: shared only when the street is ownership-aligned
Term: permanent
Buyout: recorded basis + agreed premium
If you decline: nothing changes
```

For a fixed-rate note, the same preview becomes:

```text
VESPER LOANS MARLOWE $150 AT 20% TOTAL PREMIUM
Down payment: $70
Checkpoints: $38 at turns 5, 10, and 15
Maturity: $105 at turn 20
Collateral: Vine Street
If unpaid after the cure turn: lender may take collateral or start bank auction
```

This is the “ethical rate” freedom the user described: the lender can offer 20%,
the borrower can counter with 15% or a larger share, and both see the full
outcome before committing.

## Recommended rollout decision

Do not launch every instrument at once. Use a modular contract builder with
three feature-flagged modes, but enable only:

1. **Fractional co-ownership** for the social/equity experiment; and
2. **Staged secured loan** for the conventional borrowing path.

Keep convertible notes implemented as a later flag once default and valuation
behavior are proven. Defer revolving credit, syndication, marketplaces,
building loans, insurance pools, and sale-and-buyback mechanics.

This gives players real freedom over rate, share, term, and exit while preserving
the game’s core promise: every contract is readable, finite, enforceable, and
resolvable in one turn.

## Unified product: the Parlor Deal

The three recommended systems can share one offer surface and one server
contract without becoming one ambiguous promise. Call the product a **Parlor
Deal**. The lender and borrower choose a mode first, then customize only the
fields that belong to that mode.

```text
Parlor Deal
├── LOAN       fixed return, term, repayment schedule, collateral
├── EQUITY     percentage ownership, rent/sale share, control rights
└── HYBRID     loan first, equity conversion on default or chosen trigger
```

The hybrid mode is the safest way to combine all three ideas. It gives the
lender a normal repayment path when the borrower performs, but gives the lender
a property-share fallback when the borrower cannot repay. It does not pay fixed
interest and permanent equity simultaneously by default.

## Shared offer builder

Every deal uses the same four-step flow:

1. **Amount:** how much cash the lender advances or contributes.
2. **Return mode:** Loan, Equity, or Hybrid.
3. **Terms:** rate/share, duration, repayment or conversion rule.
4. **Rights:** collateral, rent, sale, building, trade, mortgage, and control.

The borrower sees the exact cash movement and rights before accepting. The
lender can propose an “ethical” 20% total premium, a 10% perpetual stake, or a
hybrid conversion share. A room setting can set maximums, but neither party can
accept terms that are hidden or inferred later.

### Mode A: Loan

- `principal`: cash advanced;
- `rate`: simple total premium or per-turn rate, never both;
- `duration`: 5, 10, 15, or 20 turns, with a room maximum;
- `schedule`: upfront, checkpoints, or maturity balloon;
- `collateral`: named deed or share;
- `rentRights`: none by default, optional temporary kicker only if explicitly
  selected;
- `ownership`: none.

The borrower keeps the deed and building control while current. On default, the
lender can take the collateral or trigger bank auction after the cure turn.

### Mode B: Equity

- `contribution`: cash paid for a share;
- `equityShare`: 5%–100% in 5% increments;
- `duration`: permanent by default, term-based only with explicit buyback or
  auction at expiry;
- `rentShare`: same as equity share unless the parties choose a lower economic
  share in the offer;
- `saleShare`: same as equity share by default;
- `control`: passive, shared, or controlling;
- `buyoutRule`: recorded basis, negotiated price, or bank auction.

The lender receives the agreed percentage of the exact property’s rent and sale
proceeds. A 10% passive share is a real economic claim forever, not a loan that
must be repaid. A 100% share is a full transfer/buyout and collapses back to the
existing single-owner model.

### Mode C: Hybrid

Hybrid has two safe variants. The offer must label which one is being used.

#### C1. Convertible secured note (recommended hybrid)

- lender advances principal;
- borrower pays a negotiated rate and follows a chosen term/schedule;
- if fully repaid, the contract ends and the lender receives no ownership;
- if the borrower defaults after the cure turn, the lender converts the
  outstanding balance into a stated property share or chooses collateral/auction;
- conversion share is agreed at origination and shown before acceptance.

This avoids double-dipping. The lender chooses between a fixed return when the
borrower performs and an equity outcome when the borrower fails.

#### C2. Participating note (later, behind a flag)

- lender receives a reduced fixed premium;
- lender also receives a small permanent rent share;
- total lender receipt is bounded by a room-configured return cap;
- the property share never includes control unless explicitly granted.

This is more expressive, but it can overpay the lender if the rate and share are
both set aggressively. Do not enable it until simulations prove that borrowers
still accept and build.

## Economic rights versus control rights

This separation solves the street-building problem cleanly.

### Economic rights

`economicShareBps` determines the owner’s portion of rent and sale proceeds. A
10% investor receives 10% of rent from that exact property, including rent
generated by houses and hotels, and 10% of net sale proceeds after higher-priority
claims.

### Control rights

`controlMode` determines who may act on the property:

- **Passive:** original owner may build, mortgage, trade, and manage the deed;
  investor receives only the economic share.
- **Shared:** all listed owners must consent to build, mortgage, trade, or sell;
  building costs are charged pro-rata.
- **Controlling:** the owner with the controlling share may act; minority owners
  retain their economic share.

The default for a small equity purchase, such as 10%, is **passive**. This means
the borrower can still complete and build a street while the investor receives
their agreed rent share. A 50/50 deal defaults to **shared** unless both parties
select a managing owner. A 100% deal is **controlling** by definition.

This is preferable to making every minority investment block construction.
Players who want shared governance can opt into it explicitly.

## Shared-street building rules under Parlor Deals

- Building eligibility is determined by the controlling owner or shared-consent
  mode, not by the existence of any passive economic share.
- A passive 10% investor in one property does not block the borrower from
  building if the borrower controls the street.
- In shared mode, every property in the color group must have the same owner set
  and share split before building.
- If two owners hold 50/50 of every property, the group is aligned. Either owner
  may propose a build, but both consent and pay 50% of the cost by default.
- If ownership is misaligned, the UI names the exact property that breaks
  parity and offers a share transfer or manager-rights solution.
- Buildings remain attached to the property. Rent is split by economic share.

### House and hotel example

Player A owns 90% of Vine Street and Player B owns 10% passively. A owns the
rest of the color group and retains control. A may build houses and hotels. When
another player lands on Vine Street, 90% of the rent goes to A and 10% to B.
If B lands there, B pays normal rent unless the deal grants B a controlling or
shared ownership right; a passive investor is not a rent exemption.

## Landing behavior

The server first calculates the normal rent, then applies the contract’s
economic split:

- third-party visitor: full collected rent is distributed pro-rata;
- passive co-owner visitor: they pay full rent because they do not hold control
  rights, then receive their economic share back through the settlement record;
- shared/controlling co-owner visitor: they pay only the portion owed to the
  other owners, using the normalized fractional-rent rule;
- borrower with a loan but no equity: borrower is the sole owner and normal
  own-property rules apply;
- lender with a fixed loan: lender is not an owner and pays normal rent.

The passive-investor choice avoids a loophole where buying 1% of every property
would reduce landing costs. Shared ownership can use the fractional landing
rule because those players accepted governance rights and the additional
bookkeeping.

## Hybrid conversion rules

At origination, the parties agree on a conversion formula:

```text
conversionShareBps = min(maxConversionShareBps, roundTo5(
  outstandingBalance / recordedPropertyBasis × conversionMultiplier
))
```

For v1, avoid a live property valuation. The offer records either:

- a fixed conversion percentage, such as 25%; or
- a fixed collateral outcome, such as transfer/auction.

The fixed percentage is shown before acceptance. On default, the lender chooses
conversion or collateral if the contract allows both. Once converted, the note
stops accruing interest and follows the equity rights selected at origination.

## Deal invariants

The server must reject any deal that violates these rules:

- ownership shares sum to exactly 10000 basis points;
- a property cannot have two active collateral claims for the same priority;
- fixed rate, permanent equity, and conversion cannot all be active in a way
  that double-counts the same return;
- passive minority equity cannot grant hidden building or rent-exemption rights;
- a 100% share collapses to a single owner;
- a term share has a mandatory expiry resolution;
- a disconnected player cannot hold a room at a consent or maturity screen
  indefinitely;
- all rent/sale/building splits use integer money and deterministic rounding;
- bankruptcy settles a player’s own claims without seizing other owners’ shares;
- the existing winner rule remains authoritative after settlement.

## Recommended first release

Build one **Parlor Deal** builder with two enabled modes:

1. **Loan:** negotiable rate, duration, schedule, and collateral.
2. **Equity:** negotiable share, permanent duration, rent/sale percentage, and
   passive/shared control.

Add **Convertible Hybrid** as the third mode behind a feature flag. It is the
cleanest combined system, but it should follow the first two because conversion
and default are where most edge cases live.

Do not ship participating notes, revolving credit, construction loans,
syndicates, loan marketplaces, insurance pools, or sale-and-buyback until the
core builder has been playtested.

## Revised UI flow

1. `Offer financing` appears during a failed purchase or from a property sheet.
2. The lender selects Loan, Equity, or Hybrid.
3. The form reveals only relevant fields for that mode.
4. A live summary shows lender receipt, borrower cost, rent split, sale split,
   building rights, control, term, and default outcome.
5. The borrower can accept, decline, or counter within room-configured limits.
6. Active deals appear on the property and holdings sheets with one clear next
   action.

The complete system remains readable in one screen. Customization changes the
deal, not the underlying game rules or the number of separate ledgers players
must understand.

## Recommended lender-first variant: staged secured note

The most attractive version for a lender is not “wait 20 turns for rent.” It is
a normal secured note with earlier principal recovery and a negotiated upside
kicker:

```text
purchasePrice = P
borrowerDownPayment >= 30% of P
principal <= 70% of P
term = 20 global turns
principalCheckpoints = 25% at turns 5, 10, and 15; remainder at turn 20
basePremium = 30% of principal, due at maturity
rentKicker = 70% of rent actually collected during the term
totalReturnCap = 1.60 × principal
```

For the `$220` example, the borrower contributes `$70` and the lender advances
`$150`. The lender receives `$37.50` of principal at turns 5, 10, and 15, then
the remaining `$37.50` principal plus the `$45` base premium at turn 20. Before
any rent kicker, that is `$195` back on a `$150` advance. If two `$22` rent
events occur, the 70% kicker adds `$30` (rounded by the game’s integer-money
rule), taking the lender to about `$225` total. The 1.60× cap prevents a lucky
property from becoming an infinite passive-income engine.

This gives the lender:

- capital returned before the note ends;
- a guaranteed premium if the borrower performs;
- meaningful upside when the property produces rent;
- a named deed as collateral if the borrower stops paying.

It gives the borrower:

- immediate access to a property they could not otherwise buy;
- predictable four-step payments instead of a surprise full balloon;
- rent income that can help fund the next checkpoint;
- a buyout path and the ability to keep the deed if payments stay current.

The checkpoints are intentionally simple rather than fully amortizing every
turn. Real amortizing loans split each payment between principal and interest,
with the balance declining over time; Poorup can borrow that idea without
adding a payment prompt to every turn. [CFPB amortization guidance](https://www.consumerfinance.gov/ask-cfpb/what-is-amortization-and-how-could-it-affect-my-auto-loan-en-771/)

### Checkpoint default behavior

- A missed checkpoint creates a one-turn cure window.
- During the cure window, the borrower can pay the checkpoint, buy out the note,
  or voluntarily transfer the collateral.
- If the cure expires, the lender chooses collateral transfer or bank auction.
- No new rent kicker is paid after default; the contract settles once.

This is more lender-attractive than a pure rent share, but less punishing than an
immediate foreclosure-style transfer.

## Optional borrower-friendly variant: rent-first note

If staged cash payments make borrowers too fragile, test a softer instrument:

- no checkpoint principal payments;
- 70% of collected rent goes to the lender for 20 turns;
- principal plus a 25–35% premium is due at maturity;
- total lender return capped at 1.50–1.60× principal;
- same collateral and one-turn cure window.

This is easier to accept but exposes the lender to more time with capital locked
up. It should not be the default unless the simulation shows that the property
landing frequency makes the rent kicker reliably valuable.

## Building and landing economics under the lender-first variant

### Another player lands on the financed property

- Calculate normal rent, including houses/hotels.
- Pay the lender’s 70% kicker immediately and apply it to the lender’s total
  return cap.
- Pay the borrower’s 30% remainder.
- A rent event never skips a scheduled principal checkpoint.

### The borrower lands on the financed property

No rent or kicker is generated. The checkpoint schedule and term continue.

### The lender lands on the financed property

No rent is generated because the borrower remains the deed owner. The contract
is unchanged.

### A house or hotel is purchased

The borrower keeps build control and pays the construction cost. The resulting
rent, including the building uplift, qualifies for the lender kicker. If this
causes borrowers to stop building in simulation, test a reduced kicker on the
incremental building rent, such as 35% instead of 70%.

### Sale, trade, mortgage, and bankruptcy

- Active financing blocks normal trade and mortgage unless the lender accepts
  settlement or a buyer assumes the note.
- Sale or auction proceeds pay all due checkpoints and the outstanding premium
  before the borrower receives the remainder.
- On bankruptcy, settle from cash and collateral once, then write off any
  remainder. Do not create lender-to-lender cascades.
