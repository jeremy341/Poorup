# Poorup Rulesets, Seasons, Market Expansion, and Board Variants

Status: implemented in the modular monolith; this document remains the
product/design contract. See `docs/audit/expansion-implementation.md` for the
delivery record and current verification evidence.

The current end-to-end audit, open correctness findings, and the roulette-reel
implementation slice live in
docs/plans/END-TO-END-AUDIT-CS2-ROULETTE-PLAN.md. This contract remains the
visual and rules authority for that work.

## Design Read

Poorup should feel like a late-night tabletop that has grown a second layer of
strategy, without making the player learn two different games.

Every screen must read as the same product if placed side by side.

## Locked design direction

- Register: product
- Aesthetic: retro-futuristic terminal parlor
- DFII: 13/15. Impact 4, context fit 5, feasibility 4, performance safety 4,
  consistency risk 4.
- Signature: ruled gold lines and compact ledger rows that make every rule,
  price, and status feel like a table record.
- Tokens: use `.ulpi/design/DESIGN.md` only. No new palette, radius, font, or
  icon family.
- Layout: dense table-first surfaces, asymmetric split rails, and one focused
  primary action per view. No nested glass cards or generic three-card grids.
- Motion: short stepped transforms for selection and page changes; never use
  motion to hide a state transition. Respect reduced motion.
- Voice: direct, playful, competitive, and precise. Say `CLASSIC`,
  `AFTER HOURS`, `CUSTOM`, `CLAIM`, and `EQUIPPED`; avoid vague `OK` or
  `CONTINUE` labels.

## Product decision: mode versus settings

Use a `rulesetPreset`, not two separate game engines.

```text
rulesetPreset + explicit overrides → effectiveSettings → one GameState engine
```

### Presets

| Preset | Purpose | Defaults | Overrides |
| --- | --- | --- | --- |
| `classic` | Familiar Monopoly-style entry point | Standard 40 board, advanced economy off, normal board rules | Every existing room setting remains available |
| `after-hours` | Poorup's full strategy layer | Advanced events, loans, market, casino, expanded bots, and achievements on | Host can turn any optional subsystem off |
| `custom` | Explicitly tuned table | Inherits the selected base preset | Host changes are shown as overrides |

Classic must be able to turn on every current setting. The preset changes
defaults and presentation, never the legality rules. Social, profiles,
achievements, chat, and notifications are account/table infrastructure and are
available in every preset.

Do not create separate `ClassicGameState` and `AfterHoursGameState` classes.
That would duplicate settlement guards and make future fixes diverge.

## Where the mode is accessed

### Home and room entry

Do not add another top-level navigation tab just for modes. Mode is a room
configuration, not a destination.

1. `PLAY` → `CREATE TABLE` opens the existing create flow.
2. The first field is `RULESET PRESET` with `CLASSIC` selected by default.
3. Selecting `AFTER HOURS` updates a compact preview list of enabled systems.
4. `CUSTOMIZE RULES` reveals the existing settings groups progressively.
5. `QUICK TABLE` uses the user's saved default preset, falling back to Classic.
6. Public directory rows show `CLASSIC` or `AFTER HOURS` and the board size.
7. Joining a table shows a non-blocking confirmation strip with preset, board,
   and enabled add-ons before the user enters the lobby.

### Lobby

The host sees an editable `RULESET` row at the top of the settings rail. Other
players see the selected preset and a read-only `HOST CONTROLLED` label.

Changing presets replaces only values that have not been explicitly overridden.
The UI must show a small `3 OVERRIDES` summary and a `RESET TO PRESET` action.
Changing the preset is disabled after the first round starts.

### In round

The mode and board variant appear in the small table metadata line and in the
Rules page. They are never a modal and cannot be changed mid-round.

### Rules page

The Rules book gets a `TABLE PRESETS` chapter:

- active preset;
- effective settings;
- overridden values;
- board variant and player capacity;
- which systems are live versus planned.

## Settings model

Persist both the user's choice and the resolved values:

```js
{
  rulesetPreset: 'classic' | 'after-hours' | 'custom',
  rulesetBase: 'classic' | 'after-hours',
  rulesetOverrides: ['market', 'globalEvents'],
  boardVariant: 'standard-40',
  rulesetRevision: 1,
  effectiveSettings: { ... }
}
```

### Settings groups

**Table basics**

- `maxPlayers`: derived cap from board variant, never above supported capacity.
- `startingCash`
- `randomizePlayerOrder`
- `turnTimer`

**Board rules**

- `trading`
- `auction`
- `mortgage`
- `evenBuild`
- `houseLimit`
- `hotelLimit`
- `doubleRent`
- `doubleGo`
- `vacationPool`
- `noRentWhileInPrison`
- `bankruptMode`

**Poorup economy**

- `bankLoans`
- `bankLoanSeverity`
- `casino`
- `market`
- future `marketComplexity`: `basic | margin | shorting | derivatives`

**Global events**

- `globalEvents`: one ON/OFF switch only.
- No player-facing duration, maximum-count, rarity, or severity controls.

**Bots**

- `bots`
- `botPersonality`
- `botBrain`: `auto | ai | no-ai`
- `botDifficulty`: `house | table | expert`

Season, cosmetic, and telemetry settings are never room toggles. They are
server-managed systems.

## Board variants and exact sizes

Keep the board square and preserve the current tile orientation contract.

### `standard-40`

- 40 spaces total.
- 10 positions on each side, with the four corners shared.
- 2–4 players.
- Existing prices, groups, cards, and achievements remain unchanged.

### `metro-52` (first expansion)

- 52 spaces total.
- 13 positions on each side, with the four corners shared.
- 2–6 players.
- Add four new property/support positions while keeping the same clockwise
  indexing rule.
- Preserve the same outer board aspect ratio and corner behavior.
- Use a responsive scale token rather than stretching individual tiles.
- At 1920px, maintain a readable minimum tile face; at smaller widths, the
  board may enter a controlled zoom/pan mode instead of shrinking text below
  the accessibility floor.

### `grand-64` (later research variant)

- 64 spaces total.
- 16 positions per side, with the four corners shared.
- 2–8 players.
- Do not implement until Metro-52 simulations show acceptable game length and
  browser performance.

Board expansion is gameplay content, not a cosmetic. It must not be sold as a
power advantage. Release it as a free host option or a clearly stated earned
content unlock only after the server and renderer support it.

## Board variant interaction flow

```text
CREATE TABLE
  → choose preset
  → choose board variant
  → review derived seats and settings
  → create
  → lobby read-only summary for guests
  → start locks the immutable rules digest
```

Error states:

- unsupported variant: keep the prior selection and show a recovery message;
- too many players for the selected board: require the host to remove seats or
  choose a larger supported variant;
- old client: server rejects unknown variant with a safe `UPDATE CLIENT`
  response, never a partially initialized board;
- reconnect: restore the exact variant and rules digest from the server.

## Seasonal leaderboard system

### Season cadence

- Eight-week season.
- One short results/claim window after close.
- Season IDs are immutable, for example `2026-s03`.
- A new season never deletes previous standings or rewards.

### Ranking eligibility

- Only completed server matches count.
- Win-rate board requires five completed games.
- Bot-only games do not grant competitive season points.
- AFK skips, abandoned games, previews, and duplicate match IDs do not count.
- Casino stake volume never grants rank points.
- Event difficulty is normalized by board variant and preset.

### Reward tracks

Use three parallel tracks:

1. **Rank track:** percentile or verified placement bracket.
2. **Participation track:** completed games with a weekly cap.
3. **Mastery track:** achievements, fair trades, event survival, and clean
   debt outcomes.

Every reward is deterministic and visible before it is earned. No loot boxes.

### Cosmetic catalog

Cosmetics are account inventory, never game power:

- avatar frames;
- player-token borders;
- board surface skins;
- card backs;
- dice faces;
- victory stamps;
- profile title plates;
- chat emotes;
- achievement frame variants;
- subtle, reduced-motion-safe token trails.

### Shop location

The first release keeps the current top bar compact:

- `RANKINGS` gets a `SEASON` panel with standings, reward preview, and claim
  status.
- `PROFILE` gets a `COLLECTION` sub-tab for owned/equipped cosmetics.
- `REWARDS` from Rankings opens a full in-place page section, not a blocking
  modal.
- A dedicated `SHOP` top-level tab is only justified once the catalog is large
  enough to need search, categories, and rotation.

### Cosmetic purchase flow

```text
SEASON / COLLECTION
  → inspect item detail
  → preview
  → CLAIM with Parlor Tokens
  → server verifies balance and ownership
  → inventory updates
  → EQUIP or KEEP
```

States:

- locked: show requirement and preview, not a fake disabled mystery button;
- claimable: one primary `CLAIM` action;
- already owned: `OWNED`, with `EQUIP` if not active;
- insufficient tokens: show the exact shortfall and an allowed earning path;
- stale claim: server revalidates and refreshes the item;
- duplicate click: idempotency key returns the original result.

Parlor Tokens come from verified play, achievements, and seasonal objectives.
They do not come from casino losses, cannot be traded, and have no cash value.
Real-money purchases are a separate legal/compliance project and are excluded.

## Rarity and event telemetry

Add an internal `TelemetryStore` inside the modular monolith first. It records
aggregate or pseudonymous facts, never chat or hidden opponent data.

### Event facts

- eligibility checks and eligible population;
- trigger source: round boundary or Surprise card;
- warning-to-active conversion;
- tier, duration, and recovery length;
- affected players, bankruptcies, comebacks, and cash movement bands;
- event choices and turnout;
- combo frequency and overlap prevention;
- market volatility, margin calls, and forced liquidations;
- bot versus human outcomes.

### Achievement/season facts

- unlock rate by achievement and rarity;
- false-positive/replay rejection rate;
- seasonal reward claim rate;
- duplicate/idempotency failures;
- board-variant and preset normalized performance.

Telemetry is versioned by `rulesetRevision`, `balanceRevision`, `seasonId`, and
`boardVariant`. It informs offline balancing; it never self-adjusts a live
match silently.

### Operational shape

- Keep a bounded daily aggregate in the current store for beta.
- Rotate and back up telemetry separately from authoritative game state.
- Move telemetry and season projections to PostgreSQL when multiple app
  instances or larger history are needed.
- Expose an owner-only health/summary endpoint, never a public player dump.

## Market expansion

The existing Market remains a Finance-rail surface. New instruments are
progressively disclosed under `MARKET COMPLEXITY` and are available only when
Market is ON.

### Phase 1: margin

- Player has a separate margin balance and maintenance requirement.
- Opening a position reserves a disclosed percentage of cash.
- Events can change maintenance requirements prospectively.
- A maintenance breach opens a forced-liquidation obligation before any new
  board action.
- Bankruptcy liquidates margin positions at the current server quote, then
  follows the existing debt order.

### Phase 2: shorting

- Server locates a finite borrowable quantity.
- Short position stores quantity, entry quote, borrow fee, and due/cover state.
- Player can `BUY TO COVER` voluntarily.
- Credit Freeze and Bank Run can pause new shorts but cannot rewrite an active
  position.
- A failed maintenance check forces a deterministic buy-in; no negative cash.

### Phase 3: options

- Start with fully collateralized calls and puts only.
- The current beta uses a bounded, server-owned option reserve for buyer
  payouts; writer positions require an assigned counterparty and are not
  accepted as naked offers.
- Store underlying, strike, premium, quantity, expiry round, writer
  collateral, and exercise status.
- No naked writing, multi-leg spreads, real securities, or cash withdrawal.
- Expiry and exercise settle before the next turn can end.

### Global-event effects

Events may change disclosed quote multipliers, volatility, fees, borrow limits,
and maintenance requirements. They cannot change roulette odds or retroactively
rewrite a settled trade.

### CS2-style roulette reveal reel

The casino presentation uses the name **CS2-style case-opening roulette reveal
reel** (also called a scrolling reveal reel or roulette carousel). The name
describes the interaction pattern, not a dependency on Counter-Strike assets.
Poorup keeps its own pixel-art pocket cards, dark-teal surfaces, gold pointer,
and red action language.

The server settles the pocket, color, payout, cash delta, and ledger entry
before returning presentation data. The client then places that known result
on a fixed-pointer horizontal strip, fills surrounding cards from an opaque
seed, schedules stepped tick sounds at card-boundary crossings, decelerates
with the existing Poorup ease-out token, and stops on the committed result.
The strip is presentation-only: clicking, timing, or stopping it cannot change
the result.

Required states are idle, submitting, settled-presenting, settled, skipped,
stale/reconnected, error, and reduced-motion. SKIP, Escape, scrim dismissal, a
hidden-tab deadline, and reconnect all reveal the same settled result. The live
region announces the outcome once, while the visible desk keeps odds, stake,
pocket, net, and balance readable.

Use the existing global sound toggle for boundary ticks and the existing modal
focus controller for the desk. No new top-level navigation tab is introduced.
The full contract, response shape, animation budgets, accessibility rules,
telemetry, and test matrix are maintained in
docs/plans/END-TO-END-AUDIT-CS2-ROULETTE-PLAN.md.

### Bot/AI candidate additions

```text
OPEN MARGIN
REDUCE MARGIN
COVER SHORT
ROLL/EXERCISE OPTION
CLOSE POSITION
END FINANCE WINDOW
```

The legal candidate generator remains authoritative. Both AI and NO-AI choose
from the same candidates and receive the same redacted market snapshot.

## Browser accessibility and interaction tests

Add a dedicated Playwright job, separate from server contracts:

- 1920×1080, 1366×768, 1024×768, and 390×844 viewports;
- keyboard-only tab/Enter/Space/Escape flows;
- screen-reader-visible names and live announcements;
- focus restoration after nested social/profile/history overlays;
- no navigation away from an active lobby or round;
- bot thinking/fallback status and reconnect updates;
- Rules page and mode summaries match the server rules digest;
- season reward claim and cosmetic equip state;
- internal scrolling without page scroll capture;
- reduced-motion media query behavior;
- offline, timeout, stale response, duplicate action, and session-expiry paths.

Selectors should use accessible roles/names and stable `data-testid` values only
where a role cannot express the contract. Avoid implementation-class selectors.

## Production hardening

### CORS

- Require `POORUP_ALLOWED_ORIGINS` in production.
- Fail closed on an absent or malformed allow-list.
- Keep local development permissive only outside production.
- Test exact origin matching, credentials, and websocket handshakes.

### JSON backups

- Store authoritative JSON on a persistent volume.
- Write atomically, retain a rolling set of timestamped backups, and checksum
  each snapshot.
- Run a scheduled restore drill into a disposable directory.
- Alert on failed rename, failed backup, malformed root shape, or disk pressure.
- Before horizontal scaling, migrate authoritative account/social/match data to
  a transactional database rather than sharing JSON files between instances.

### Edge/IP limiting

- Put a provider edge such as Cloudflare in front of the app.
- Limit websocket handshakes, login/register, player search, reports, room
  creation, and invite endpoints by IP plus account where available.
- Keep in-process per-socket/account limits as a second defense.
- Return retry hints without exposing account existence.

## Data and module boundaries

Keep one deployable modular monolith for now:

```text
RulesetRegistry       presets, overrides, immutable digest
BoardRegistry         standard-40, metro-52, future variants
GameState             authoritative turns and settlement
MarketModule          basic, margin, shorting, options
SeasonModule          seasons, standings, reward claims
CosmeticCatalog       item definitions, inventory, equip state
TelemetryModule       aggregate metrics and health summaries
Existing Social/Auth  accounts, privacy, friends, notifications
```

Cross-module writes happen through explicit server methods. Do not introduce a
message broker or microservices until there is independent scale, ownership,
and observability to justify them.

## Migration and rollback

1. Add nullable `rulesetPreset`, `boardVariant`, `seasonId`, and revision fields.
2. Read missing values as `classic` + `standard-40`; write the new fields on
   the next authoritative snapshot.
3. Add registry-backed preset resolution while keeping existing setting keys.
4. Run classic byte-equivalence and current full-game regression tests.
5. Enable After Hours in a small beta cohort.
6. Roll back by selecting Classic; never rewrite a started match's digest.
7. Add seasons and telemetry only after the digest is stable.
8. Add Metro-52 behind a server capability check before exposing it in the
   lobby.
9. Add derivatives only after telemetry proves the basic market is balanced.

## Release gates

- Classic with all optional systems OFF behaves exactly like the current game.
- Classic can enable every current setting without changing the rules engine.
- After Hours and Custom serialize an immutable effective digest.
- A reconnect restores preset, overrides, board, season, and open obligations.
- No reward or cosmetic transaction can alter cash, rent, movement, ownership,
  or win calculations.
- Season standings are rebuildable from completed matches and verified events.
- Event telemetry contains no private chat, hidden cards, or secret opponent
  terms.
- Market liquidation and derivative obligations cannot create negative cash.
- Browser tests pass at all target viewports and with reduced motion.
- Production readiness checks pass for CORS, backups, restore, and edge limits.

## Recommended next implementation slice

Implement only the ruleset registry and immutable rules digest first. It is the
shared dependency for seasons, Metro-52, market complexity, bot context, Rules
copy, and telemetry. Do not begin the shop or derivatives until that contract
and its migration tests are green.

## Design pre-flight

- Identity lock: pass. The spec binds to the existing Poorup design tokens.
- Anti-slop: pass. No new gradients, generic cards, buzzword copy, or default
  fonts are introduced.
- State coverage: pass. Loading, empty, locked, stale, error, reconnect,
  offline, and duplicate-action states are defined.
- Accessibility: pass in plan. Focus, roles, live regions, reduced motion,
  safe areas, and target sizes are explicit acceptance criteria.
- Layout craft: pass. Room configuration, Rankings/Rewards, Profile/Collection,
  and Finance/Market use distinct but related compositions.
- Cognitive load: pass. Mode selection is one choice, advanced settings are
  progressive, and each surface has one primary action.
- Self-critique: 29/32. Distinctiveness 4, hierarchy 4, consistency 4,
  accessibility 4, state coverage 4, copy 3, restraint 3, motion 3.

## Build handoff

Implement exactly this specification after the ruleset contract is approved.
Keep the existing vanilla HTML/CSS/Socket.IO architecture and locked Poorup
tokens. Do not redesign unrelated surfaces or create a second rules engine.
