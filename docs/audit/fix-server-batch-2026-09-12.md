# Server Batch 1 fix report — 2026-09-12

Scope: the server-only Batch 1 findings from
`agent-codebase-bugs-2026-09-11.md` and the matching parity audit. No commit or
push was made. Existing client changes and dated audit files in the working
tree were left untouched.

## Findings addressed

### 1. Ruleset base transitions and setting acknowledgements (P1/P2)

- `server/rooms.js:58-65,118-131,442-484` now returns a structured setting
  result with `changed`, `rejected`, `reason`, `key`, `value`, `preset`,
  `base`, and `effectiveSettings`.
- Selecting `classic` or `after-hours` now derives and stores the matching
  base, clears `rulesetBaseExplicit`, and clears stale Custom overrides before
  re-resolving effective flags. Both Custom/After Hours → Classic and
  Custom/Classic → After Hours are covered.
- Unknown keys, invalid finite-number fields, legacy server-owned scaled
  fields, and capacity reductions return explicit rejection reasons without
  mutating settings.
- `server/serverSocketAccount.js:362-369` forwards rejected setting results as
  `{ success: false, error }`; accepted wire acknowledgements remain exactly
  `{ success: true }`. Existing pinned error strings for host-only and started
  rooms remain unchanged.

### 2. Contract counter/response relay (P1)

- `server/serverSocketGame.js:35-41,63-65` derives relay direction from the
  resulting contract's counter depth. Odd counter depths notify the lender;
  even depths notify the borrower. Responses notify the opposite participant
  of the responder for both roles.
- `server/socketHandlerSupport.js:64-68` accepts either a fixed recipient
  field or a resolver, preserving existing trade relays and wire event names.
- `server/serverSocketGame.test.js` records per-socket offer/update delivery
  across two counters and both response roles.

### 3. `payEach` unpaid legs (P1)

- `server/cardApi.js:261-280` keeps the existing direct settlement for solvent
  legs, but routes a short leg through `chargePlayer()` so available cash is
  tendered and each remaining recipient leg becomes a creditor-specific
  `pendingPayment` or queued payment. The existing summary feed text is
  preserved.
- `server/applyCard.test.js:589-630` covers a four-player, `$10` payer / `$50`
  per-recipient card: the first recipient gets `$10`, the first `$40`
  remainder parks, and the other two `$50` legs remain queued.

### 4. Advanced market quota and margin collateral (P2/P1 parity)

- `server/marketExpansion.js:10,88-90,125-174` adds a disclosed 25% initial
  margin collateral reserve (the existing maintenance rate), deducts fee plus
  collateral at open, exposes the collateral, and releases it proportionally
  on reduction. `reservedCash` includes the held amount.
- `server/marketExpansion.js:418-430,485-489` applies margin collateral during
  forced/full liquidation before leaving any surplus in the wallet and clears
  the reserve without creating negative cash.
- `server/marketExpansion.js:88-90,511-526` applies the documented one-market-
  action-per-turn rule to open, reduce, cover, exercise, and close; bot
  candidates use the same quota.
- `server/economyApi.js:62,370-472` increments the quota for every successful
  advanced action and checks idempotency caches before quota guards so a
  duplicate request still replays its original result.
- `server/marketExpansion.test.js:17-140` covers reserve/debt math,
  management-action rejection and reset, candidate suppression, liquidation,
  close, and replay behavior.

### 5. Annotated match-history persistence (P2)

- `server/accountStore.js:621-645` adds idempotent `updateMatchRecord()`: it
  sanitizes the enriched record, replaces the existing match ID for each
  participating account, persists once, and never replays match statistics.
- `server/socketRuntime.js:177-186` calls that seam after achievement
  annotation and season assignment, before match-store recording and account
  snapshot refresh.
- `server/match-history-schema.test.js:48-65` verifies achievement flags and
  `seasonId` survive an `AccountStore` restart and that replay does not add a
  second game.

## Red → green evidence

Each focused slice was run once against the pre-fix behavior after its failing
test was added, then rerun after the smallest implementation change:

| Slice | Red observation | Green command/result |
|---|---|---|
| Ruleset transition/result | `TypeError: Cannot read properties of undefined (reading 'changed')` at `server/rulesetRegistry.test.js:80` | `node server/rulesetRegistry.test.js` — exit 0 (`ruleset registry: 18 passed, 0 failed`) |
| Setting socket ack | pre-fix returned `{ success: true }` for `not-a-setting` where the focused test expected `{ success: false, error: 'Unknown room setting.' }` (`server/serverSocketAccount.test.js:40`) | `node server/serverSocketAccount.test.js` — exit 0 (`4 scenarios passed, 0 failed`) |
| Contract relay | pre-fix second counter targeted `relay-a`, expected `relay-b` (`server/serverSocketGame.test.js:64`) | `node server/serverSocketGame.test.js` — exit 0 (`2 scenarios passed, 0 failed`) |
| `payEach` debt | pre-fix `pendingPayment` was `null` instead of the first creditor's `$40` remainder (`server/applyCard.test.js:589-630`) | `node server/applyCard.test.js` — exit 0; focused shortfall check passed and all 26 characterization cases passed |
| Advanced market | pre-fix `openMargin()` had no `collateral` (`undefined !== 50`, `server/marketExpansion.test.js:21`) and management actions bypassed quota | `node server/marketExpansion.test.js` — exit 0 (`market expansion: 12 passed, 0 failed`) |
| Match-history restart | pre-fix `accounts.updateMatchRecord is not a function` (`server/match-history-schema.test.js:55`) | `node server/match-history-schema.test.js` — exit 0 (`match-history v2 schema and achievement annotation: 5 passed, 0 failed`) |

## Tests run after the final changes

- `node server/rulesetRegistry.test.js`
- `node server/marketExpansion.test.js`
- `node server/applyCard.test.js`
- `node server/match-history-schema.test.js`
- `node server/contracts-market.test.js`
- `node server/serverSocketGame.test.js`
- `node server/serverSocketAccount.test.js`
- `node server/casino-bankruptcy.test.js`
- `node server/gameLogic.test.js`
- Targeted `npx eslint` over all changed server production/test files — no
  errors or warnings.

`node server/rooms.test.js` was also attempted for the higher-fidelity Socket.IO
room scenarios, but this managed sandbox rejects its child-process startup
with `Error: spawn EPERM` before the server launches. That is an environment
limitation; no rooms-suite pass is claimed here. The lightweight socket seams
above cover the new relay and setting-ack behavior without child processes.

## Remaining contract decisions

- `payEach` uses the existing shared single-active-payment plus FIFO queue.
  Bankruptcy/quit behavior for multiple queued creditor legs remains the
  existing table-obligation policy; a future product decision may choose an
  aggregate claim or explicit multi-creditor bankruptcy settlement.
- Initial margin collateral is 25%, intentionally tied to the existing
  disclosed maintenance rate because the plan specifies a disclosed reserve
  but no separate numeric initial-margin rate. If product wants a distinct
  rate, change the registry constant and corresponding golden tests together.
- The one-action quota treats voluntary management operations as market
  actions; automatic forced liquidation remains an engine settlement and does
  not consume a player's voluntary quota.

