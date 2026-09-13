# Poorup complexity and overengineering review — 2026-09-11

Scope: read-only review of the current `codex/theme-reset` tree. I inspected
the server module graph, game/room/bot architecture, client state and surface
composition, theme/CSS layers, persistence, tests, and CI. No production code,
tests, or other reports were changed.

The review applies the requested architecture and QA lenses: dependencies
should point toward stable boundaries, abstractions should be discovered from
repeated behavior, and regression protection should distinguish high-signal
smoke checks from expensive full/evolving suites. The named `review-agent`
skill was not present in the available catalog; the closest architecture
review guidance was used instead.

## Complexity snapshot

- Complexity health: **5.1/10** (10 = simple, coherent, and cheap to change).
- Largest production surfaces: `public/styles.css` 3,877 lines,
  `public/clientTradeUi.js` 1,423, `server/gameLogic.js` 1,134,
  `public/clientSocialSurfaces.js` 1,139, `server/rooms.js` 922,
  `server/socketRuntime.js` 876, and `public/main.js` 996.
- Client state is imported by **40** JavaScript files. The repository contains
  9,838 test lines across 56 `*.test.js` files; `npm test` runs 46 serial Node
  processes, `test:audit` adds 9, and the coverage runner starts 39 suites.
- There are no P0 findings. P1 items are structural risks that make
  correctness-sensitive changes expensive; P2 items are medium-term debt; P3
  items are cleanup that should follow a bounded compatibility policy.

## Findings

### [P1] Match history has two durable sources and two merge implementations

**Evidence:** A completed room first writes a full match through
`accountStore.recordGameResults()` and then writes the same record through
`matchStore.record()` (`server/socketRuntime.js:173-181`). The account path
embeds the record into every account's `matchHistory`
(`server/accountStore.js:250-266`), while the separate MatchStore is queried by
`socketSocialApi.fallbackMatchRecords()` (`server/socketSocialApi.js:132-140`)
and `serverSocketSocial.effectiveMatchRecords()`
(`server/serverSocketSocial.js:438-449`).

**Why this is overcomplicated:** The system must deduplicate records, decide
which copy wins, keep two retention policies aligned, and maintain privacy
projection behavior in more than one reader. A field added to a match record
can require changes to the writer, account snapshot, MatchStore sanitizer, and
both merge paths. A partial failure can leave one source updated and the other
stale, making later behavior depend on read order.

**Simplification options and trade-off:** Make MatchStore the canonical full
record source. Keep account aggregates and a compact per-account match-id/time
index in AccountStore, and query MatchStore for history. Run one explicit
backfill/migration, retain `accountStore.matchHistory` as a time-bounded read
fallback, then remove the merge code. This costs migration work and may need a
small account-id index for fast reads, but removes duplicate payload storage and
conflict resolution.

**Must remain:** idempotent settlement, viewer-scoped private-history
projection, account aggregate stats, and a compatibility reader until existing
JSON data has been migrated.

### [P1] Server and client maintain separate 40/52-space board databases

**Evidence:** The server defines the canonical-looking 40-space table in
`server/gameData.js:25-66`, then builds a second Metro table in
`server/boardRegistry.js:31-85`. The browser repeats the Standard table in
`public/clientBoardData.js:50-91` and repeats Metro semantic IDs, source-index
mapping, and overrides in `public/clientBoardData.js:134-179`. The server and
client intentionally use different field vocabularies (`type`/`index` versus
`kind`/`i`), and the client also owns a second rent/group table at
`public/clientBoardData.js:28-47`.

**Why this is overcomplicated:** A board or card change now has multiple
authorities and an adapter seam that is not mechanically generated. Standard
and Metro entries can drift in names, groups, tax fields, rent, or tile IDs
without a type error. A new board variant touches data, coordinates, cards,
client render rules, and settings lists in separate files.

**Simplification options and trade-off:** Store one semantic board manifest
(for example JSON with stable tile IDs and canonical rule fields), generate or
load server and browser adapters from it, and keep `type`/`kind` conversion at
the boundary. A small build step is the cleanest option; a server-served,
cacheable manifest is viable for the no-bundler client but adds a startup
request. Either choice preserves a client presentation adapter while removing
hand-copied rows.

**Must remain:** server authority for ownership/rent/settlement, semantic IDs
for Metro, and tests that compare both adapters against the same manifest.

### [P1] Two client feature modules are god modules with unrelated state machines

**Evidence:** `public/clientTradeUi.js` is 1,423 lines. Its financing builder,
contract detail, repayment, and negotiation functions occupy roughly
`public/clientTradeUi.js:140-1137`; a separate player-to-player trade flow
starts at `public/clientTradeUi.js:1141` and continues through the end of the
file. It also owns a custom dropdown implementation at
`public/clientTradeUi.js:56-138` and seven module-level financing/trade state
variables at `public/clientTradeUi.js:22-26`.

`public/clientSocialSurfaces.js` is 1,139 lines and combines toast rendering
(`public/clientSocialSurfaces.js:19-148`), social/friends surfaces
(`public/clientSocialSurfaces.js:171-375`), rankings/seasons
(`public/clientSocialSurfaces.js:392-655`), a full rules manual
(`public/clientSocialSurfaces.js:656-944`), and player cards/history
(`public/clientSocialSurfaces.js:946-1139`).

**Why this is overcomplicated:** A finance edit can affect trade state and
dropdown behavior; a rules or rankings change shares the same module with
social notifications and player-history projections. The files are hard to
load in isolation and every caller depends on ad-hoc `configure*` hooks and the
global state object. Large HTML template literals make review and targeted
regression selection harder.

**Simplification options and trade-off:** Split into explicit bounded modules:
`clientFinancingUi` + `clientTradeUi` + `clientDropdown`, and
`clientToast` + `clientSocialUi` + `clientRankingsUi` + `clientRulesUi` +
`clientPlayerCardUi`. Keep the existing DOM IDs and export compatibility
wrappers during migration. This creates more files and import wiring, but
allows focused tests and prevents unrelated feature changes from sharing
module-level state.

**Must remain:** the current shared surface/focus controller, server request
timeouts, private-data redaction, and one composition root in `main.js`.

### [P1] GameState/Room uses a circular import, dynamic mixins, and duplicated reset paths

**Evidence:** `server/gameLogic.js:49` imports `Room` and `RoomManager` from
`server/rooms.js`, while `server/rooms.js:19` imports `GameState` back from
`server/gameLogic.js`. The file comments explicitly describe this cycle
(`server/rooms.js:1-5`). `GameState` spans `server/gameLogic.js:141-1129` and
installs 13 API objects dynamically with `Object.assign`
(`server/gameLogic.js:1131`). Its constructor reset path
(`server/gameLogic.js:150-204`) and new-game reset path
(`server/gameLogic.js:235-291`) duplicate most of the same 40-plus field
assignments. Room also creates 35 generated pass-through methods from a second
verb list (`server/rooms.js:603-647`).

**Why this is overcomplicated:** ES-module live bindings make the current cycle
work, but dependency direction and method ownership are hidden. A method added
to a mixin is not visible from the class declaration; an accidental name
collision would be resolved by assignment order. The duplicate resets and two
parallel pass-through/handler registries increase the chance that a new state
field or action is updated in one path but not another.

**Simplification options and trade-off:** First move `GameState` into
`server/gameState.js` and have `rooms.js` import it one way; keep
`gameLogic.js` as a compatibility facade until all imports move. Then unify
reset into one initializer with explicit `{newGame}` differences. Longer term,
use one checked action registry for room forwarding and socket binding, or keep
the generated pass-throughs but validate that every verb resolves. Do not split
the stateful rules engine into arbitrary files solely to lower line count; the
safe first win is direction and explicit initialization.

**Must remain:** the modular-monolith deployment, server-authoritative
GameState, isolated rule API modules, and exact public method/wire names while
the facade is in place.

### [P2] Client state is a mutable cross-feature global, not a stable boundary

**Evidence:** `public/clientState.js:124-273` holds room lifecycle, board,
turn/debt, auctions, trades, contracts, social, rankings, seasons, cosmetics,
economy, bot status, audio, and settings in one object. Forty client files
import it directly. `public/clientStateSync.js:55-424` mutates most of those
domains during every server snapshot, while trade and social modules mutate
their own slices directly (for example `public/clientTradeUi.js:1225-1232`
and `public/clientSocialSurfaces.js:187-231`).

**Why this is overcomplicated:** Renderers, event handlers, and persistence
helpers can silently depend on each other's fields. Resetting a room requires a
long hand-maintained list (`public/clientLobbyUi.js:497-540` and
`public/clientLobbyUi.js:636-650`), and a new field has no owner or lifecycle
contract. This is hidden coupling even though the files look modular.

**Simplification options and trade-off:** Keep one app state object, but group
it into owned slices (`room`, `turn`, `finance`, `social`, `profile`, `theme`)
and expose small update/reset functions per slice. Start with room entry and
finance, then move snapshot appliers to those functions. A Redux-style store or
reactive framework is unnecessary for this app and would add more machinery;
plain slice APIs give most of the benefit with a manageable migration.

**Must remain:** a single client view of server-authoritative data, local-only
theme/preferences, and deterministic reset behavior on leave/reconnect.

### [P2] Surface visibility has multiple registries and bypasses the controller

**Evidence:** `public/clientSurfaces.js:11-20` manually lists 24 surfaces and a
second `GAME_POPUP` subset. `public/main.js:602-610` separately lists six view
IDs. Other paths mutate visibility directly, including
`public/main.js:319` (bankruptcy), `public/main.js:593` (choice modal), and
`public/clientLobbyUi.js:378-384` (rail mode), instead of going through
`openSurface`/`closeSurface`.

**Why this is overcomplicated:** Adding a dialog requires touching HTML, the
surface selector list, possibly the game-popup subset, a feature binder, and
keyboard routing. The controller's `aria-hidden`, stack, inert, and focus
state can diverge from direct class mutations. The duplication also makes it
difficult to know which surfaces are intentionally allowed at Home.

**Simplification options and trade-off:** Add declarative attributes such as
`data-surface` and `data-surface-scope="game"` in the HTML, derive the lists at
startup, and make all feature modules call one visibility API. Migrate direct
class writes incrementally; this is a low-risk structural change but requires
careful preservation of the existing focus behavior.

**Must remain:** the shared focus trap/inert behavior and explicit non-modal
page routing. Do not replace it with a generic event bus, which would make
ordering less visible.

### [P2] CSS and themes are a large append-only cascade with duplicated ambient rendering

**Evidence:** `public/styles.css` is 3,877 lines. Desktop breakpoint overrides
are spread across `public/styles.css:2411-2544`, while the separate iPad desk
layer occupies `public/styles.css:3616-3877`. Reduced-motion rules are split
across at least `public/styles.css:354`, `:722`, `:826`, `:1621`, `:1993`,
`:2035`, `:2984`, `:3031`, `:3108`, `:3392`, and `:3600`. Theme data repeats
roughly 30 token assignments for each of five non-baseline worlds in
`public/clientThemeData.js:18-186`; the renderer maintains a second manual
token cleanup list at `public/clientThemeRender.js:71-95`.

The skyline data and painter are duplicated: `public/clientBoardRender.js:18-46`
and `public/clientThemeData.js:12-16` contain the same base geometry, while
`public/clientThemeRender.js:50-68` repeats the skyline loop. The latter
`paintThemeSkyline` export has no caller.

**Why this is overcomplicated:** Cascade order, breakpoint scope, and theme
token cleanup become the hidden architecture. A token can be added to a theme
record but omitted from cleanup, and a motion rule can be fixed for one
component while another scattered block still overrides it. The visuals are
valuable, but the maintenance surface is larger than the product behavior
requires.

**Simplification options and trade-off:** Split CSS by stable layers (tokens,
base components, game desk, profile/social pages, responsive, accessibility)
and bundle them in a deterministic order; consolidate reduced-motion and
forced-colors overrides into one accessibility layer. Define a token schema and
derive cleanup from the union of theme keys. Move skyline data/painting to one
ambient-render helper and remove unused exports. A build step adds tooling and
may complicate the plain-static deployment, so a first incremental version can
retain one output file generated from source fragments.

**Must remain:** all six themes, the pixel-parlor identity, responsive tablet
desk, forced-colors behavior, and reduced-motion behavior.

### [P2] Test and CI orchestration is serial, duplicated, and not self-describing

**Evidence:** `package.json:9` chains 46 independent Node processes for
`npm test`; `package.json:10-11` adds a separate 9-process audit suite and a
`test:full` composition. `server/coverage-runner.js:5-20` starts 39 child
processes, 31 of which repeat `npm test` suites. CI runs `npm test` and then
`node server/server.test.js` again (`.github/workflows/ci.yml:24-28`), even
though `server/server.test.js` is already in the package test chain. CI never
runs `npm run test:audit` or `npm run test:full`. The two wire suites duplicate
server startup/wait/ask/check/cleanup harnesses in
`server/rooms.test.js:20-93` and `server/server.test.js:17-44,153-181`.

`server/bot-simulation.test.js:18-19,121-128` defaults to 1,000 bounded games.
Because coverage reruns the suite, a normal CI job executes that simulation
twice; the longer 2,500-game campaign is separately wrapped by
`server/bot-balance-runner.js:6-15`.

**Why this is overcomplicated:** Process startup, output parsing, and failure
classification are repeated, while “full” does not mean full in CI. The
expensive simulation consumes PR time and coverage work without being a
distinctly named release gate. Duplicated wire harnesses can diverge in timeout
or cleanup behavior.

**Simplification options and trade-off:** Adopt one test manifest/runner (Node's
`node:test` is sufficient) with tags for smoke, contract, audit, browser, and
balance. Run a small deterministic bot smoke plus affected tests on PRs; run
full contracts/audits and 1,000–2,500 game balance campaigns nightly or before
release. Reuse one wire harness helper and make CI invoke the declared full
target, or explicitly rename the current CI gate. Migration changes output
format and requires porting custom `check()` wrappers, but removes duplicate
processes and makes coverage scope explicit.

**Must remain:** black-box wire checks, deterministic contract tests, held-out
regression coverage, and the long bot balance campaign. Keep a separate hidden
slice for independent evaluation rather than deleting tests to make CI faster.

### [P2] Compatibility code is scattered, including a production-unused snapshot mapper

**Evidence:** `public/client-state.js` is a 109-line snapshot mapper, but its
only importer is `server/client-state.test.js:1`; runtime listeners use
`public/clientStateSync.js:12`. The two mappers expose different state shapes
and server-field assumptions. `server/boardRegistry.js:139-161` exports unused
`tileIdAt` and an unused `BoardRegistry` class; `server/rulesetRegistry.js:243-248`
exports an unused `RulesetRegistry` class; and
`public/clientThemeRender.js:26` exports unused `configureThemeRender`.

The legacy room settings are retained end-to-end despite being intentionally
ignored: defaults at `server/roomSettings.js:45-47`, the legacy list at
`:62-63`, unreachable snap normalizers at `:143-144`, rejection at
`server/rooms.js:58-62`, deletion from summaries at `server/rooms.js:515-520`,
and deletion from effective settings at `server/rulesetRegistry.js:170-176`.

**Why this is overcomplicated:** Dead exports and a test-only compatibility
mapper look like supported APIs and consume review/test attention. The legacy
setting values have multiple no-op transformations and tests that pin behavior
the product no longer exposes. This makes it harder to distinguish intentional
backward compatibility from abandoned code.

**Simplification options and trade-off:** Remove unused facades/exports and
replace `client-state.js` plus its test with a DOM-free extractor from the
current snapshot contract. For old room setting keys, retain one bounded
no-op/telemetry path for a documented sunset window, then delete defaults and
normalizers. Keep user-data migrations in dedicated code: saved-game v1
remapping (`public/clientGameSave.js:18-38`), profile migration
(`public/clientSanitize.js:79-96`), and achievement legacy-array loading
(`public/clientAchievements.js:65-94`) should not be removed without a data
retention decision.

**Must remain:** migrations for persisted user data, stable wire names during a
declared compatibility window, and the authoritative current snapshot mapper.

### [P2] AccountStore owns authentication, history, stats, projections, and leaderboard math

**Evidence:** `server/accountStore.js:430-777` combines loading/session token
management, registration/login, profile mutation, game-result writes,
achievement/patrol writes, public projections, history, windowed stats, and
leaderboards. The same 15 metric keys are maintained in separate live and
windowed rule tables (`server/accountStore.js:217-234` and `:271-287`).

**Why this is overcomplicated:** Authentication changes and leaderboard changes
share one mutable store and persistence path. A metric added to one table but
not the other silently creates inconsistent all-time versus windowed rankings;
the tables are intentionally different in source shape, but the key set is
duplicated.

**Simplification options and trade-off:** Extract `accountRepository` (identity,
sessions, profile persistence), `matchStatsProjector` (live/record metric
descriptors), and `leaderboardQuery` while leaving an `AccountStore` facade for
callers. Put each metric in one descriptor with `liveDelta` and `recordDelta`
functions so the source-shape difference stays explicit without duplicating the
key list. More modules add wiring, but each can be tested against a narrow
contract.

**Must remain:** password/session handling, privacy projection, idempotent
game-result writes, all-time/windowed distinction, and the existing facade
during migration.

### [P2] Realtime operations require five timer/index mechanisms with duplicated teardown paths

**Evidence:** `server/socketRuntime.js:123-131` creates auction, disconnect,
bot, turn, and bot-auction timer maps plus decision locks. Separate scheduling
and cleanup paths span `server/socketRuntime.js:304-389` (turn/destroy),
`:393-550` (bot and auction decisions), and `:568-742`
(auction/disconnect/AFK expiry), with two process intervals at
`server/socketRuntime.js:870-871`.

**Why this is overcomplicated:** Every callback needs room identity, stale
callback protection, lock release, and cleanup on room destruction. Adding a
new timed obligation means another map and another destroy/disconnect branch.
This is operationally difficult to fake in tests and easy to leak during a
new lifecycle path.

**Simplification options and trade-off:** Introduce one injected
`RoomScheduler`/timer registry keyed by `{roomCode, kind}` with `schedule`,
`cancel`, `cancelRoom`, and stale-generation checks. Keep AFK polling as a
separate policy but let it use the same registry/clock abstraction. This adds a
small runtime object and migration work, but gives one teardown boundary and
deterministic fake-clock tests.

**Must remain:** distinct semantics for turn deadlines, disconnect grace,
auction deadlines, and bot decision locks; stale callbacks must remain harmless.

### [P2] Settlement crosses seven JSON stores without a named commit boundary

**Evidence:** `server/server.js:86-106` constructs four primary and three
auxiliary stores plus a backup timer. `recordRoomStats()` then coordinates
account, achievement, season, match, social-achievement, and telemetry side
effects across `server/socketRuntime.js:173-187`. The store layer guarantees
atomic writes per file (`server/storeIO.js:49-76`), but not an atomic commit
across files.

**Why this is overcomplicated:** Recovery depends on each store's idempotency
and on retrying the whole `recordRoomStats` path. Operators must back up and
restore a set of files, and a failure between stores can leave stats, history,
achievements, seasons, and telemetry at different revisions.

**Simplification options and trade-off:** Keep domain stores if they are useful,
but add a `SettlementCoordinator` with a persisted match settlement ID and
explicit stages (`prepared`, `match-written`, `accounts-written`,
`rewards-written`, `telemetry-written`). Alternatively, append one settlement
event and rebuild projections. A journal adds a recovery file and operational
runbook; a single event log is a larger migration. Either is simpler to reason
about than implicit retries through seven independent writers.

**Must remain:** atomic single-file writes, corruption quarantine, checksummed
backups, idempotent replay, and privacy boundaries between projections.

## Reasonable complexity — do not “simplify” these away

The following are substantial but justified by the product and should be
protected by contracts rather than flattened:

- The server is a modular monolith, not service sprawl. Separate rule APIs for
  rent, cards, property, auction, economy, trades, contracts, events,
  bankruptcy, and summaries are sensible bounded-context seams when they all
  share one authoritative GameState. The cycle and dynamic assembly need
  cleanup; the domain separation should stay.
- The bot stack has deliberate roles: legal candidate generation in
  `server/botApi.js`, provider-safe projection in `server/botStrategicContext.js`,
  bounded lookahead in `server/botFuturePlanner.js`, provider/fallback policy in
  `server/botAdvisor.js`, and execution/phase ordering in `server/botLogic.js`.
  The AI/no-AI fallback, privacy redaction, candidate allowlist, and decision
  trace are product safety requirements. Do not replace this with free-form
  model actions or add more providers without a stable candidate contract and
  cost/latency gates.
- Realtime timers, reconnect grace, auctions, and AFK handling are real product
  requirements. The recommendation is one lifecycle abstraction, not removal
  of deadlines or liveness guards.
- The six theme worlds, pixel assets, full desktop/tablet composition, and
  accessibility overrides are intentional visual scope. Consolidate their
  plumbing, but keep the visual variants and reduced-motion/forced-colors
  behavior.
- JSON stores are a reasonable fit for a small single-process deployment. The
  complexity risk is cross-store settlement and compatibility, not the mere
  existence of separate stores.

## Recommended sequence

1. Establish a source-to-test map and one shared wire harness; make CI's
   smoke/full/audit boundaries explicit. Move the 1,000-game simulation to a
   named nightly/release gate while keeping a small PR smoke.
2. Remove unused facades and isolate the current snapshot mapper; document a
   sunset for ignored room settings and preserve user-data migrations.
3. Eliminate the `rooms.js` ↔ `gameLogic.js` cycle and unify GameState reset;
   keep `gameLogic.js` as a compatibility facade during the move.
4. Choose canonical board and match-history sources, add adapters/migration,
   then remove duplicate merge paths.
5. Split the two client god modules and introduce owned client state slices;
   preserve DOM IDs and surface/focus contracts.
6. Consolidate CSS/theme plumbing and introduce a scheduler/settlement
   coordinator only after characterization tests cover the affected lifecycle.

These are staged refactors, not a license for a bulk rewrite. The main success
metrics should be fewer authoritative copies, fewer cross-feature imports,
shorter PR smoke time, one CI manifest, zero unowned compatibility paths, and
the same black-box game/bot behavior.
