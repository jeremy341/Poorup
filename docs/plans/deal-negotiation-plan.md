# Deal negotiation system

**Status: implemented.** Trades and player contracts share one pending-deal
surface inside the existing game shell. Closing a modal is non-destructive;
only an explicit action changes the deal.

## Roles

- A deal's last proposer sees `ADJUST` and `CANCEL TRADE`/`CANCEL OFFER`.
- The other player sees `ACCEPT`, `DECLINE`, and `NEGOTIATE`.
- After a counter, the responder alternates by `counterDepth`; the server and
  client use the same parity rule.
- Negotiation is capped at two counters to prevent loops.

## Surfaces

- Incoming trade offers open a two-action modal (`ACCEPT`, `NEGOTIATE`).
- Scrim, Escape, and dismissal leave the offer pending.
- Finance shows collapsed rows for both incoming and outgoing deals.
- `VIEW DEAL` opens a read-only detail modal with current terms and role-safe
  actions.
- Negotiation reuses the existing trade or finance editor with fields
  prefilled from the live offer.

## Server contract

Trade actions:

- `counter-trade`
- `adjust-trade`
- `cancel-trade`

Player-contract actions:

- `counter-player-contract`
- `adjust-player-contract`
- `cancel-player-contract`

No action transfers money or ownership while editing. Every accept path
revalidates cash, ownership, liveness, collateral, and the deal ID. Stale
modal submissions receive a safe rejection and never mutate a newer deal.

## Bot integration

AI bots may counter trades and loans/equity/hybrid contracts using bounded
candidate lists. No-AI mode retains deterministic accept/decline behavior, and
all execution still uses the normal room action seam.

## Verification

- Contract and trade suites cover role alternation, stale IDs, adjustment,
  cancellation, and no-funding-before-acceptance.
- Wire-level tests cover every new socket event and malformed payloads.
- Full regression suite and server/client lint are required before release.
