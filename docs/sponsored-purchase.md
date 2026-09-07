# Sponsored Purchase

**Status: implemented.** Sponsorship is an in-room, server-authoritative
escrow flow. It is available from an open purchase offer and does not create a
loan, equity share, or separate social contract.

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

## UI
- The landing choice card exposes `SEEK SPONSORS` without leaving the game.
- Every seated player sees the sponsorship modal with the bank-owned property,
  amount still needed, reservations, and their legal contribute/withdraw action.
- The buyer sees `ACCEPT & BUY` only after the full price is reserved, or can
  cancel and return every reservation.
- On accept: one server transaction transfers the reserved gifts and charges
  the property price immediately.

## Implementation Notes
- Server methods: `requestPurchaseSponsorship`,
  `contributeToSponsoredPurchase`, `withdrawSponsoredPurchase`,
  `acceptSponsoredPurchase`, and `declineSponsoredPurchase`.
- Server-side validation: the property must remain bank-owned and the original
  purchase offer must still belong to the buyer at acceptance.
- Reservations are returned on cancellation, stale ownership, disconnect, or
  bankruptcy; they never become a loan or equity share.
