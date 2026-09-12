# Poorup codebase bug audit — 2026-09-11

Scope: read-only audit of the current `codex/theme-reset` tree. I inspected the
server game/rules, room lifecycle, economy, contracts, social/auth seams,
persistence projections, bot execution, and the client/server contracts that
affect those paths. No production code or tests were changed by this audit.

The review used the defect-first bar from `review-agent`, root-cause tracing
from `systematic-debugging`, source-to-test impact thinking from
`qa-agent-testing`, the reflection/evidence loop from `agentic-eval`, and the
architecture validation/sharp-edge catalog from `code-architecture-review`.

> **Superseded/current status (2026-09-12).** The six findings below are the
> pre-fix audit record, not an open queue. Server Batch 1 addressed ruleset base
> transitions, contract relays, `payEach` shortfalls, advanced Market quota and
> margin collateral, annotated match-history persistence, and rejected-setting
> acknowledgements. See `docs/audit/fix-server-batch-2026-09-12.md` for the
> changed seams, red→green evidence, and residual product decisions. Preserve
> the reproductions below for provenance; verify any new claim against the
> current tree and tests.

## Findings

### [P1 — RESOLVED 2026-09-12] Reset the explicit base when switching away from Custom — `server/rooms.js:118-131,276-310`, `public/clientLobbyUi.js:393-400`

An explicit room that was created with `rulesetPreset: 'custom'` and an
explicit `rulesetBase` keeps `rulesetBaseExplicit = true` forever. Selecting a
different preset only updates `rulesetPreset`; `refreshRuleset()` therefore
continues to derive the new preset from the old base. A Custom/After Hours room
that is changed to Classic still has bank loans, casino, market, and global
events enabled. A Custom/Classic room changed to After Hours remains on the
Classic defaults with those systems disabled. The UI displays the selected
preset, so the host can start a game under rules that do not match the label.

Reproduction:

```text
createRoom({ rulesetPreset: 'custom', rulesetBase: 'after-hours' })
setRoomSetting('rulesetPreset', 'classic')
→ ruleset.preset = 'classic', ruleset.base = 'after-hours'
→ bankLoans/casino/market/globalEvents remain true
```

The inverse is reproducible with `rulesetBase: 'classic'` followed by
`rulesetPreset: 'after-hours'`; the effective systems remain disabled. The
client handler at `clientLobbyUi.js:562-566` sends only the preset change.

Recommended fix: when a non-Custom preset is selected, derive and persist its
matching base (`classic` or `after-hours`), clear stale base-explicit state, and
re-resolve effective settings before acknowledging the change. Add a contract
test for both directions and assert the returned preset/base/effective flags.

### [P1 — RESOLVED 2026-09-12] Relay contract counters and responses to the current responder — `server/serverSocketGame.js:35-65`

`counter-player-contract` always relays the new `player-contract-offer` to
`fromPlayerId`. That is correct only for the initial borrower counter. After
the lender counters at depth 1, the new offer must go to `toPlayerId` (the
borrower), but the handler sends it back to the lender. The same static
`fromPlayerId` target is used for `respond-player-contract`, so the borrower
does not receive the dedicated update after the lender answers. The state
broadcast eventually exposes some changes, but the recipient misses the
offer/update event that drives the modal and notification path
(`public/clientSocketListeners.js:267-273`), making the negotiation flow appear
stuck or requiring a manual rail refresh.

Reproduction: A sends a loan to B; B counters (depth 1); A counters again (or
accepts/declines). Inspect the Socket.IO recipients: the second offer/update is
emitted to A instead of B.

Recommended fix: compute the relay recipient from the resulting contract and
action state: a counter should target the opposite side of the last proposer,
and a response should notify the other participant. Add a two-counter socket
integration test that records per-socket event delivery, not just the returned
ack.

### [P1 — RESOLVED 2026-09-12] Keep the unpaid legs of `payEach` as a real debt — `server/cardApi.js:261-280`

The `Elected chairperson`/`payEach` card loops recipients and transfers
`Math.min(player.cash, amount)` to each. Once the payer reaches zero, every
remaining recipient receives zero and the card still returns `RESOLVE_TAIL`;
no `pendingPayment`, bankruptcy decision, or bank claim is created. This makes
the amount owed depend on recipient iteration order and silently forgives the
unpaid legs. The existing happy-path characterization only uses a solvent
player and does not cover the shortfall.

Reproduction: three active players, payer cash `$10`, card `{ action:
`payEach`, amount: 50 }`. The first recipient receives `$10`, later recipients
receive `$0`, `pendingPayment` stays `null`, and the payer's turn is resolved.

Recommended fix: settle each leg through a shared debt/obligation mechanism,
or create a deterministic aggregate bank/recipient claim after the available
cash is tendered. Preserve per-recipient accounting and explicitly define the
bankruptcy/creditor behavior. Add tests for insufficient cash, four players,
and different player orderings.

### [P2 — RESOLVED 2026-09-12] Enforce the one-market-action quota for advanced positions — `server/marketExpansion.js:81-123`, `server/economyApi.js:350-476`

The documented market contract says one market action per board turn
(`docs/plans/casino-market-global-events-plan.md:134`), and basic orders enforce
`marketActionsThisTurn`. `expansionGuard()` only applies the quota to
`operation === 'open'`; `reduceMargin()` and `coverShort()` pass `manage`, and
neither method increments `marketActionsThisTurn`. A player can therefore open
a margin position and repeatedly reduce it, or cover multiple short legs, in
the same turn while the normal market order is already quota-limited. The bot
candidate path can also select these management actions without a shared quota.

Reproduction: in a started `margin` room, call `openMargin('a','brazil',1)` and
then `reduceMargin('a',1)` before ending the turn. Both return success and the
second action leaves `marketActionsThisTurn` unchanged. `coverShort()` has the
same gap.

Recommended fix: decide the intended finance-window semantics once and encode
them in one shared guard. If the documented one-action rule remains, enforce
and increment the quota for every advanced action, including exercise/close;
otherwise update the plan, UI copy, bot candidates, and tests to explicitly
allow a multi-action finance window.

### [P2 — RESOLVED 2026-09-12] Persist annotated match history after achievement/season enrichment — `server/socketRuntime.js:177-186`, `server/accountStore.js:621-645`

`recordRoomStats()` calls `accountStore.recordGameResults()` before it annotates
participants with `achievementsUnlocked`/`mythicalUnlocked` and before it adds
`seasonId` to the match record. `recordGameResults()` immediately persists the
account snapshots. The same object is enriched in memory afterward, so the
connected player sees the richer record, but reloading `accounts.json` loses
those fields from the owner's `matchHistory`; `matchStore` has the enriched
copy, but the profile/account snapshot reads the account copy directly.

Reproduction: record a finished match, evaluate/annotate achievements, then
construct a new `AccountStore` from the persisted file. The live participant
contains achievement annotations before reload, while the reloaded participant
has `achievementsUnlocked` absent/empty. The same ordering applies to
`seasonId`.

Recommended fix: enrich the match record before persisting account results, or
persist/update account match history once after annotation and seasonal
assignment. Keep the operation idempotent and add a restart round-trip test
that asserts achievement and season metadata survive.

### [P2 — RESOLVED 2026-09-12] Return a failure ack when a host setting is rejected — `server/serverSocketAccount.js:362-369`, `server/rooms.js:442-449`

`Room.setRoomSetting()` silently returns for an unknown key, an invalid value,
a legacy scaled field, or a capacity violation. `handleSetSetting()` then
always emits a room state and acknowledges `{ success: true }`, even when no
setting changed. A stale or malicious host client can show a successful update,
and callers cannot distinguish an accepted setting from a rejected one without
waiting for a later snapshot.

Reproduction: as the host emit `set-setting` with `{ key: 'not-a-setting',
value: true }` or `{ key: 'startingCash', value: 'not-number' }`. The server
leaves the setting unchanged but the callback reports success.

Recommended fix: make `setRoomSetting()` return a structured result (changed,
rejected, and reason), and forward that result from the socket handler. Keep
the existing exact error vocabulary where tests pin it; add negative ack tests
for unknown, invalid, locked, and capacity-rejected values.

## Intentional behavior / not findings

- The original 40-tile board and the Metro 52 registry are intentionally one
  unified rules engine; the extra Metro semantic IDs are not a duplicate engine.
- Public room codes are intentionally omitted from public projections; private
  room codes remain invite credentials.
- The server uses a single pending trade/contract slot as a table-wide
  obligation. It is a product limitation, but not a defect without a requirement
  to support concurrent deals.
- Advanced market liquidation can create a bounded short-default debt. That is
  an explicit safety path, not unbounded negative cash.
- Guest tab-restart without an account remains unrecoverable by design because
  no durable identity exists.
- The current static checks and 1,000-game bot simulation do not prove socket
  relay delivery, persistence round trips after post-record enrichment, or
  shortfall semantics for every multi-recipient card.

## Verification snapshot

- `npm run lint`: PASS.
- `npm run lint:client`: PASS.
- `npm run test:full`: core suites and bot/global-event/economy suites passed;
  the command stopped at `server/rooms.test.js` because this sandbox rejects
  child-process creation with `spawn EPERM`. This is an environment limitation,
  not a claim that the full integration suite passed.
- Direct reproductions above were run against the current source tree.

## Risk score

**6.5/10 (moderate-high before release).** Core money guards and most room,
contract, persistence, and bot tests are strong, but the six findings above
affect ruleset truthfulness, deal delivery, debt accounting, economy quotas,
and restart consistency. The P1 items should be fixed before adding more
economy features; the P2 items should be covered before a public beta.

## Highest-value test gaps

1. Socket-level contract relay tests through two counters and both response
roles.
2. Ruleset preset transition matrix covering Custom bases in both directions.
3. Insufficient-cash tests for every multi-recipient card and order-independent
   obligations.
4. Advanced market action quota tests for open/reduce/cover/exercise/close.
5. Restart round-trip tests after achievement annotation and season assignment.
6. Negative setting-ack tests for invalid, unknown, locked, and capacity values.
