# Sponsored Purchase

## Concept
Player A lands on a property (e.g., Accra) and cannot afford it. Player B offers to chip in money to fund the purchase, under the condition that Player A **must** buy that specific property.

## Flow
1. Player A lands on Accra, can't afford it (or chooses to seek sponsorship)
2. Player A opens a "Sponsorship" request visible to all players: "I need $X to buy Accra"
3. Player B responds: "I'll contribute $Y toward the purchase"
4. Player A can accept or decline contributions
5. On accept: Player B's $Y moves to Player A, then Player A is forced to buy Accra from the bank
6. If the bank sells Accra to someone else between offer and acceptance, the sponsorship auto-voids

## Key Rules
- The sponsored player must buy the property immediately on acceptance — no backing out
- Multiple sponsors can contribute (all must accept collectively)
- If total contributions + player's cash < property price, the sponsorship is invalid
- No interest/repayment — it's a gift tied to a forced purchase
- Side deals (e.g., "I'll pay $200 but you owe me $50 later") are separate player contracts

## UI Sketch
- New "Sponsorship" mode in the finance tab
- Sponsor selects: recipient, property (bank-owned only), amount
- Recipient sees incoming sponsorship offers with "Accept & Buy" or "Decline"
- On accept: atomic transaction — transfer cash + charge property price

## Implementation Notes
- New trade type: `sponsored-purchase`
- Server-side validation: property must be bank-owned at time of acceptance
- Server-side enforcement: after cash transfer, immediately call `chargePlayer(propertyCost)` on the recipient
- UI: Filter property dropdown to only show unowned tiles in sponsorship mode