# Inactivity, Vote-Kick, Lobby, and Finance Release Design

**Status:** User-approved design; implementation plan in progress
**Scope:** Poorup release-readiness changes to account reset, presence/inactivity removal, room vote-kick, lobby configuration, player loans/collateral, bot lobby seats, and equity-backed purchases/trading.
**Implementation status:** No implementation changes are authorized by this draft.

## 1. Goals

Deliver the requested release changes without replacing Poorup's vanilla client,
game shell, or server-authoritative room model:

- Remove all existing accounts and account-linked personal data in local
  development and Nest, then let the owner create a fresh admin account.
- Remove per-turn time limits. Players have unlimited time while active.
- Remove a human seat after a defined three-minute inactivity countdown, with
  the same countdown visible to every player in the room.
- Let seated players start a room-scoped vote-kick from another player's in-room
  profile.
- Simplify pre-lobby settings and show configured bot seats immediately with
  stable, funny names.
- Make player-loan interest and collateral terms match the server behavior.
- Extend sponsored-purchase escrow to support a single equity investor, then
  support secondary transfers of existing equity shares.

## 2. Design authority and invariants

- Poorup remains a vanilla HTML/CSS/JavaScript client and modular-monolith
  server. The server is authoritative for room membership, inactivity deadlines,
  votes, escrow, contracts, and settlement.
- Preserve the current pixel-parlor tokens, typography, compact geometry, and
  shell. Any new UI is an extension of the existing player card, lobby rail,
  finance surfaces, and timer concept—not a new global layout.
- Do not introduce document/body scrolling. Keep any overflow inside existing
  internal surfaces; retain keyboard access, visible focus, reduced-motion,
  forced-colors, and zoom behavior.
- Never log or store raw keyboard events, pointer coordinates, or browsing
  history. Presence state consists only of the room player ID, state, and
  server-issued deadline.
- Preserve idempotent room settlement. Inactivity removal and vote-kick must
  use the existing seat-release lifecycle, not mutate `game.players` directly.
- Preserve 2-minute reconnect grace as a separate disconnect path. A hidden tab
  with a live socket is inactivity; a lost socket is reconnect handling.
- Preserve read compatibility for historical ruleset and contract records even
  when their configuration controls are removed.

## 3. Account reset operation

This is a one-time operator task, not a new public account-deletion feature.

### Scope

Apply to local development and Nest:

- All account records, credentials, sessions, recovery records, and admin
  allowlist entries.
- Account-linked friend/block/report/invite records, per-account match history,
  achievements, season rows/rewards, and cosmetics.
- Any other personal record keyed by the deleted account IDs.

Retain only account-independent aggregate telemetry that cannot identify or be
joined back to a deleted account. Match/account records must not be retained in
an old backup after the purge is verified.

### Safe execution contract

1. Inventory store paths and produce a dry-run count without printing account
   credentials or private data.
2. Put Nest into maintenance/drain mode; stop account writes and drain active
   rooms before deleting records. Local development is stopped for its reset.
3. Create a temporary, access-restricted recovery checkpoint. Keep it only long
   enough to verify the purge, then delete it so the reset includes backup
   copies. No database or store is touched before the dry-run target list is
   reviewed.
4. Clear all account-linked stores, stale session/recovery state, and the old
   admin ID configuration. Verify zero old accounts and zero linked personal
   records in both environments.
5. Restore normal service. The owner registers a new account, then configures
   that account ID as admin and verifies the dashboard.

Account creation credentials are never generated or stored by this workflow.

## 4. Inactivity state machine

### Meaning of inactivity

Each seated human has an independent presence state. Bots are excluded.

- When the game document becomes hidden, mark the player inactive immediately
  and start a 180-second server deadline.
- While the document remains visible, 30 seconds with no pointer/mouse movement,
  keyboard input, click, or touch input marks the player inactive and starts the
  same 180-second server deadline.
- Returning to the visible game tab or producing any supported input marks the
  player active and clears their deadline.
- A new inactivity episode starts a new full deadline. The countdown does not
  continue after activity resumes.

The inactivity rule applies to every seated human, not just the player whose
turn it is. Thus a player who watches without interacting for the defined idle
window will see the warning and can reset it with activity. This is intentional
and must be stated in the timer copy.

### Client/server contract

- A small client presence monitor observes only `visibilitychange` and local
  input event types. Mouse movement is coalesced; raw events and coordinates
  are never sent or persisted.
- The client sends a rate-limited `active`/`inactive` transition to the server.
  The server validates room membership and the owning socket/client identity,
  records the server timestamp/deadline, and broadcasts the resulting room
  presence state.
- The server owns expiry and performs the removal even when clients are
  background-throttled. A stale tab/session cannot cancel a newer seat's
  deadline. Reconnect and activity transitions are idempotent.
- The server's room snapshot exposes each inactive player's `inactiveSince` and
  `inactiveUntil` values. Clients derive the visible seconds remaining from the
  shared server time offset; clients never decide the kick themselves.

### Countdown presentation

- Visual source of truth: `docs/assets/countdown-ring-timer-concept.png` (the
  approved 1280×1280 PNG). Keep this image unchanged as a reference; there is no
  matching timer SVG in the current asset tree. Implement the live timer as
  dynamic HTML/SVG, matching the PNG's square dark-teal frame, four gold corner
  blocks, inset field, segmented gold ring with its top gap, and centered cream
  pixel numerals. The live value starts at `3:00`; the ring depletes clockwise.
- Visual acceptance compares a 1920×1080 room capture against that PNG for
  composition, pixel geometry, palette, numerals, and progress behavior. The
  dynamic text and three-minute duration are intentional differences from the
  static `2:00` reference.
- Show each inactive player's remaining time beside their name in the player
  sidebar for every room participant.
- Reuse the approved pixel circular timer concept as the prominent top-center
  indicator, with the target player's name and time. If multiple deadlines are
  active, the sidebar shows every one and the prominent indicator shows the
  earliest deadline.
- A returning player immediately loses the inactive styling and countdown.
- Use the existing theme tokens and tabular numerals. Do not cover the board's
  key interaction region, modal actions, or focus rings. Reduced motion may
  freeze the ring while the numeric countdown continues.

### Expiry and cleanup

At the server deadline, atomically mark the seat expired, notify the room, and
run the established room-seat cleanup exactly once. Cancel pending obligations,
release sponsored-purchase reservations, settle a pending payment through the
existing debt/bankruptcy path, revoke an auction lead where applicable, release
the seat/assets/contracts, update turn order, and reassign the host if needed.
Retries or stale timers must not duplicate settlement.

If expiry finds a pending purchase decision, resolve it as a pass using the
room's configured auction rules before final seat removal. When an auction is
opened, the inactive target is excluded. An active auction keeps its existing
server bidding clock and is not given a turn deadline.

The 2-minute reconnect-grace path remains distinct. A disconnected player is
handled by reconnect expiry; inactivity presence alone does not mark a player
disconnected.

## 5. Room vote-kick

### Entry point and eligibility

- Add `START VOTE KICK` to the in-room player profile reachable from the player
  sidebar. Keep it separate from friend/report/block actions, and do not require
  a social account to vote on a room seat.
- The target must be another human seat in the same room. Bots, spectators,
  bankrupt/eliminated seats, and the initiator are not targets.
- A vote requires at least three seated active human players total. The voter
  electorate is frozen when the vote opens and excludes the target.

### Vote rules

- Initiator's yes vote is recorded at creation. Each eligible voter may vote
  once. A strict majority of the frozen electorate is required to pass.
- A vote lasts 30 seconds. A no vote or an abstention does not count toward yes;
  the vote closes early when it passes or can no longer reach the threshold.
- Only one vote can be active per room. Add a per-initiator room cooldown to
  limit harassment. A failed vote cannot immediately be restarted by the same
  person.
- The target and all voters receive the current vote state and result. The
  target cannot veto, change votes, or be removed from another room.
- A vote-kick is not a global account ban. A kicked player cannot rejoin that
  same live room, but can use their account in other rooms and after the room
  ends.

### Successful kick

Use a shared, idempotent seat-removal operation so the voter path and inactivity
path cannot diverge. In a started game, the current room-leave lifecycle
eliminates the seat and settles obligations/assets/contracts; this consequence
must be disclosed before the vote starts and in the success notice. In a lobby,
remove the seat without match settlement. Reassign the host when applicable,
clear the target's timers/votes, and update the room snapshot.

## 6. Lobby configuration

- Remove the Ruleset Preset selector from room creation and pre-lobby controls.
- Remove the Custom Overrides control and its player-facing editing/reset code.
- New rooms use the existing canonical default. Preserve read-only parsing and
  history metadata needed for saved rooms/matches; do not discard old rule
  snapshots. Admin historical filters may continue to inspect stored ruleset
  dimensions.
- Remove the static Bankruptcy information row only; bankruptcy logic remains.
- Render `STANDARD 40` without the `2–4` suffix. Preserve `METRO 52` and its
  seat-capacity behavior.
- Expand the house dropdown while keeping existing values: 10, 20, 32, 40, 50,
  64, and Unlimited. Expand the hotel dropdown while keeping existing values: 6,
  12, 16, 24, 32, and Unlimited.
- Encode Unlimited as the explicit string sentinel `unlimited`, not `Infinity`.
  Normalize and validate it in room settings and ruleset compatibility code;
  property-building logic treats the sentinel as unbounded, and all JSON
  snapshots remain serializable. Existing integer caps remain enforced for
  numeric values.

## 7. Server-owned pre-lobby bot roster

- The lobby's bot count setting immediately creates or removes reserved bot
  seats before a game starts.
- The server owns the roster and publishes the same roster to the sidebar and
  pre-lobby player list. Bot IDs/names remain stable across unrelated rerenders
  and settings broadcasts.
- Names are drawn from a curated playful list, unique within the room, sanitized
  like other display names, and never confused with a human/account identity.
- Reducing the bot count removes the highest-index unstarted bot seats; changing
  max players clamps the roster so total seats never exceed capacity.
- Starting the match converts the reserved roster into the actual bot players
  without renaming them. After match start, bot seats are no longer a lobby
  configuration mutation.

## 8. Loan interest and multi-deed collateral

### Interest terminology

- User-facing `PREMIUM` becomes `TOTAL INTEREST` in loan and hybrid-loan
  composers, previews, counters, and summaries.
- Interest is a one-time percentage of principal, added once to total due. For
  example, `$100 ADVANCE · 10% TOTAL INTEREST · $110 TOTAL DUE`. It is not APR,
  per-turn compounding, or periodic interest.
- Preserve existing wire/storage fields such as `premiumRate` as a compatibility
  alias unless a later migration justifies a versioned contract schema. Copy and
  field labels change without breaking old pending/recorded deals.
- Remove the repayment-schedule picker because the server does not implement
  those schedule variants. Show maturity/due turn and supported early or partial
  repayment instead.

### Multi-select collateral

- Replace single deed selection with a searchable, accessible accordion and
  multi-select list. Show selected deeds as removable items and disclose that
  every selected deed is at risk.
- The server accepts a bounded list of deed indices, deduplicates it, verifies
  each deed is owned by the borrower and currently eligible, and rejects any
  deed that is mortgaged, developed, already pledged, or otherwise
  non-tradeable.
- Persist a canonical `collateralTileIndices` list. Read legacy
  `collateralTileIndex` as a one-item list for old records and emit a compatible
  singular field only where existing readers require it.
- Pledged deeds cannot be sold/traded, mortgaged, pledged again, or built upon
  while the loan is live. Clear the reservation on full repayment or contract
  termination.
- On uncured default, **all deeds selected in the signed deal transfer to the
  lender**, as explicitly approved by the user. The modal lists every deed at
  risk before sending and accepting. Partial repayment does not silently shrink
  the pledged set; it remains until paid or defaulted.

## 9. Equity-backed purchase and secondary equity trading

### Primary purchase funding

- Extend the existing sponsored-purchase flow with a distinct equity-investment
  mode. Existing gift sponsorship remains unchanged and does not create equity.
- One investor per purchase in the first release. Before reservation, the buyer
  and investor see the exact property, investor contribution, buyer contribution,
  and investor's agreed passive rent share.
- The investor's cash is reserved in escrow. It cannot be spent or used as
  collateral elsewhere. The buyer cannot redirect it to another deed.
- Acceptance validates the same bank-owned deed and current purchase offer,
  total funds, live investor, valid share, and the 100% aggregate share ceiling.
  One transaction charges the bank purchase price, assigns deed ownership to the
  buyer, and records the equity contract/share. Any exception rolls back all
  mutations and keeps a safe refund path.
- Cancellation, stale ownership, investor/buyer removal, disconnect expiry,
  bankruptcy, or room cleanup releases the reserved cash exactly once.
- The investor receives the agreed rent percentage through the existing equity
  payout mechanism. This is not a loan and creates no repayment balance. The
  default control mode is passive; no voting/control right is implied by the
  economic share.

### Secondary share transfer

- Add an equity-transfer offer to the existing Finance/deal flow after primary
  purchase funding is verified.
- A transfer names the source contract/property, fraction of the holder's
  available share, buyer, and agreed consideration. The server rechecks that the
  seller owns the share, the contract is live, the transfer is within remaining
  share, and total property equity remains at or below 100%.
- Settlement atomically transfers consideration and updates the holder/share
  record. Duration and passive rights follow the transferred share; old contract
  IDs remain auditable and replay-protected.
- Failed, stale, duplicate, or canceled offers change neither cash nor share
  ownership. Bankruptcy, property transfer, and existing building/mortgage
  restrictions remain enforced.

## 10. Verification contract

### Deterministic server tests

- 30-second visible idle threshold; immediate hidden-tab transition; all input
  classes reset presence; active transition clears deadline.
- Deadlines are server-owned, same-room snapshots expose consistent expiry, and
  stale socket/client IDs cannot reset a new seat's timer.
- Two-minute reconnect grace remains separate; no turn timer is scheduled or
  serialized.
- Inactive removal with pending purchase, payment, sponsorship, auction lead,
  current turn, host seat, and live contracts settles exactly once.
- Vote threshold, minimum voters, frozen electorate, one vote per human,
  timeout/abstention, cooldown, stale target, duplicate/replayed vote, host
  reassign, and kicked-seat rejoin lock.
- Bot roster capacity/clamping, unique stable names, add/remove broadcasts, and
  start conversion.
- Unlimited limits serialize and allow building; invalid numeric limits remain
  rejected.
- Legacy loan/collateral fields normalize safely; selected deed validation,
  reservations, all-deed default, repayment release, and replay protection.
- Equity purchase success, cancellation/refund, stale deed, disconnect,
  bankruptcy, injected settlement failure/rollback, rent payout, share cap, and
  secondary transfer.
- Full account reset dry-run/verification covers both local and Nest data stores
  without logging secrets or retaining a hidden personal-data backup.

### Browser and release checks

- Preserve current Poorup visual language and avoid global shell/layout redesign.
- Test 1920×1080 first, then 1366×768, 1024×768, iPad landscape, and 390×844.
- Verify every inactive player countdown is visible to other players and resets
  immediately after activity. Verify vote progress and all vote results in the
  room.
- Check keyboard-only profile actions, modal focus, reduced motion,
  forced-colors, 200% zoom, and no document/body scroll.
- Run changed-path unit tests, full relevant server/client suites, browser
  contracts, lint, and an account-store dry-run before any destructive reset.
- Keep promotion on `development` first; do not deploy the Nest wipe or promote
  branches as part of spec approval.

## 11. Explicit non-goals

- No per-turn countdown or turn-time setting.
- No global account ban from vote-kick.
- No changes to the board rules, server authority, or visual shell beyond the
  requested lobby/profile/finance controls and shared inactivity indicators.
- No removal of historical ruleset interpretation needed to read old matches.
- No multi-investor equity syndication in the first purchase-equity release.
- No new UI framework or dependency.

## 12. Review notes

- Confirmed user decisions: delete all account data in local and Nest; remove
  turn timers; retain three-minute inactivity removal; visible inactivity starts
  immediately on hidden tab or after 30 seconds without input; show the clock to
  everyone; all selected collateral transfers on uncured default; one investor
  for equity-backed purchases initially.
- Assumption recorded for review: keep ruleset metadata/read compatibility for
  old matches while removing all player-facing preset/custom-override controls.
- The current design system document exists at `.ulpi/design/DESIGN.md`.
  `AGENTS.md` and `.ulpi/design/LAYOUT-INVARIANTS.md` are absent in this
  checkout; the project product document and design system were used instead.
- This spec is approved as the design input for the implementation plan.
  Implementation and the account purge remain unstarted and require approval of
  the resulting plan and execution method.
