# Poorup Refactor Roadmap

_Measured 2026-09-04 with the official CodeScene CLI (v1.0.40, authenticated
local run of `cs review` over every analyzable file) plus churn from
`git log`. CodeScene hotspots are complexity × change frequency; the tables
below show both axes. One hotspot per PR, behavior frozen by `npm test`. Do
not execute this list as a bulk refactor._

## Ground rules

- Each row = one `refactor/*` branch → one PR → green CI → merge. No mixing.
- Behavior is frozen: the 9 contract suites plus the boot smoke must stay
  green; a refactor PR may ADD tests but never changes observable game rules.
- **Characterization tests first.** `matchStore`, `accountStore`, `server.js`
  and `public/` are NOT instrumented by the coverage run (c8 only sees
  test-imported files). Before touching a function there, land its
  characterization tests in the same PR: fixed inputs → exact frozen outputs
  of the CURRENT implementation, written before any extraction.
- Every refactor PR body must carry the `cs review` before/after for the
  touched file. If the touched functions' health got worse, the PR failed —
  revert rather than force it.
- Server first, client second: `server/` is linted and partially tested;
  `public/` has no net until R0 lands.

## CodeScene file verdict (0–10, higher is healthier)

_Remeasured 2026-09-05 after PRs #18–#28 (the hotspot campaign + player
bankruptcy)._

| Score | File | Notes |
|-------|------|-------|
| 1.45 ↑ | `server/gameLogic.js` | worst in repo but climbing: applyCard (56) #16, getPropertyRent (53) #17, manageProperty (53) / tradeMarket (44) / proposePlayerContract (44) #21, activateGlobalEvent (41) #23, respondPlayerContract 24→18 / processPlayerContracts 23→14 / advanceRound 19→3 #28; queued: getGameSummary 23, leaveRoomByClient 22, canMortgageTile 21 |
| 1.43 | `public/main.js` | untouched since #10 — still gated on the R0 client harness |
| 2.89 ↑ | `server/server.js` | was 2.01; scheduleBotTurn (99) → `server/botLogic.js` #19, room-setup → `server/roomSetup.js` #24, #26/#28 guard tables + obligation helper; create-room (cc 15) / join-room (12) still queued |
| 10.0 ↑ | `server/accountStore.js` | #20: recordGameResults (cc 49) table-driven; session reverse index (#27) kept it 10.0 |
| 10.0 | `server/botLogic.js` | new #19 — deep module for bot turns |
| 10.0 | `server/roomSetup.js` | new #24 — room lifecycle helpers |
| 10.0 | `server/bankruptcyLogic.js` | new #28 — debt settlement, quit-obligations, loan default rules |
| 8.36 ↑ | `server/matchStore.js` | was 6.09; R1's table-driven sanitizer |
| 8.89 ↑ | `server/achievementStore.js` | was 6.63; R1's rules table |
| ~7.7 | `server/socialStore.js` | healthy — R1-era; leave alone |
| 8.82 ↑ | `server/gameLogic.test.js` | was 8.16 (the #6 `normalizeDynamic` cc-10 blip, undone in #13) |
| 9.68 ↑ | `server/botAdvisor.js` | was 8.89; #28 table-drove deterministicChoice (cc 17) and split parseAdvisorResponse (cc 10) — mean cc now under 4 |

CSS (`public/*.css`) is not analyzable by CodeScene — it stays out of scope.

### Churn axis (commits touching each file)

`index.html` 26 · `server.js` 21 · `gameLogic.js` 16 · `main.js` 15.

True CodeScene hotspots (complex × churned): **`server.js` and
`gameLogic.js`**. `matchStore`/`achievementStore` are cold complexity —
worst functions in the repo but rarely touched; they are cheap, low-risk
wins, which is why they still go first as warm-ups.

## Worst functions and how to de-hotspot them

### matchStore.js `sanitizeMatch` — cc 135 (file: 6.09)

60+ fields, each an inline `typeof x === 'string' ? x.slice(0, N) : default`
ternary. Every ternary is a branch.

**Recipe:** one declarative field table + a handful of coercers:
`str(v, max)`, `nonNeg(v)`, `flag(v)`, `intAtLeast(v, n)`,
`strList(v, cap, maxLen)`, `nested(obj, spec)`. The sanitizer becomes a
`for` loop over the table. Output shape byte-identical. Each coercer is
cc ≤ 3; the loop cc ≈ 4; total ≈ 10.

**Protection:** file is untested — characterization suite first (malformed
JSON records, missing arrays, over-long strings → frozen outputs).

### accountStore.js `recordGameResults` participants builder — cc 80 (file: 4.42) ✅ done (#20 → file 10.0)

The SAME ~60 fields mapped from live player objects instead of stored JSON
(`player.airportVisits instanceof Set ? .size : 0` where matchStore reads a
number). This is a real duplication CodeScene surfaced: the two files
hand-write the same schema.

**Landed:** RESULT_STAT_UPDATES / WINDOW_STAT_UPDATES descriptor tables with
predicate helpers; null-players crash hardened via a red→green golden and an
8-check game-results suite. (The shared `participantFields.js` between the
two stores was never needed — the tables kept the schema single-source per
file and hit 10.0.)

### achievementStore.js `evaluateMatch` — cc 96 (file: 6.63)

~47 sequential `if (cond) candidates.push({id, title, rarity, body})`
statements plus 8 "complex conditional" flags.

**Recipe:** a static `ACHIEVEMENT_RULES` array
`{ achievementId, title, rarity, body, test(participant, ctx) }`;
`evaluateMatch` becomes one `forEach` over the rules with the shared
context (`isWinner`, `othersCash`, `contracts`, `eventNames`, `treasureCards`)
computed once outside. Each `test` is cc 1–5. Behavior identical; new
achievements become a one-line table entry (actual functional improvement).

### server.js `scheduleBotTurn` — cc 99 (file: 2.01) ✅ done (#19 → `server/botLogic.js`)

Timer + lock + 8 decision branches, one of which (the purchase-offer
post-roll block) is literally duplicated twice in the body.

**Landed:** extracted to `server/botLogic.js` (10.0) as a table-driven phase
dispatch; `scheduleBotTurn` keeps guard → setTimeout → lock → re-dispatch.
The float edge (give 440 vs ask 440.00000000000006 declines) is frozen by 16
botLogic checks. `create-room` (cc 15) / `join-room` (12) are the only
room-handler complexity left.

### gameLogic.js — the rules engine (file: 1.06)

| Function | cc | Shape confirmed | Recipe |
|----------|----|-----------------|--------|
| ~~`applyCard`~~ ✅ #16 | 56→~4 | 14-case switch | **done:** dispatch table + RESOLVE_TAIL sentinel preserving the break-vs-return tail semantics; 26-case golden |
| ~~`getPropertyRent`~~ ✅ #17 | 53→<9 | type branches + 11 event-modifier ifs | **done:** per-type base helpers + RENT_EVENT_MODIFIERS fold (rentCap+floor stay last); 43-case golden |
| ~~`manageProperty`~~ ✅ #21 | 53→<9 | buy/build/mortgage/sell action chain | **done:** PROPERTY_ACTION_HANDLERS dispatch table |
| ~~`tradeMarket`~~ ✅ #21 | 44→<9 | side/quantity/settlement ifs | **done:** MARKET_ORDER_GUARDS table |
| ~~`proposePlayerContract`~~ ✅ #21 | 44→<9 | term validation chain | **done:** guard tables |
| ~~`activateGlobalEvent`~~ ✅ #23 | 41→<9 | event ifs | **done:** per-event setup table + global-events.test (20 suites, crypto.randomInt RNG stub) |
| ~~`advanceRound`~~ ✅ #28 | 19→3 | 4-level nesting (Bumpy Road) | **done:** recursion guard + advanceGlobalEventPhase/begin/tick/recovery/archive split; trade/respond/getGameSummary follow-ups in #25/#28 |
| `getGameSummary` | 23 | snapshot field assembly | section-split mappers |
| `leaveRoomByClient` | 22 | disconnect teardown | share with `clearPendingObligations` (#28 server helper) |
| `canMortgageTile` | 21 | eligibility ifs | predicate table |

`gameLogic.test.js` was written FOR this code, so each PR extends it: every
extracted table gets a direct table test. "Number of Functions in a Single
Module" (file-size smell) is NOT fixable by splitting the class — methods
share `this` state; splitting the file is R3-late or never. The score moves
via the per-function work; big-bang module surgery is explicitly out.

### public/main.js — untested until R0 (file: 1.43 after #10)

_Line numbers below are from the 2026-09-04 pre-#10 file (8,415 lines); #10
removed ~892 dead offline-engine lines so they now sit higher in the file.
Re-derive with `rg -n "applyServerState|addEventListener\(.keydown" public/main.js`
before opening an R4 branch._

| Function | cc | Recipe |
|----------|----|--------|
| keydown handler (`:8245`) | 98 | 60 `if`s, 23 of them `e.key ===`. One `chord(e)` helper (`"shift+p"`, `"tab"`, …) + a keyed handler table; typing-context guard hoisted once. Same actions, same order of checks |
| `applyServerState` (`:1000`) | 93 | split into small appliers fed the same snapshot: `applyRoomMeta`, `applyPlayers` (movement/positions), `applyPhaseAndTurn`, `applyPendingInteractions`, `applyTimers` — same field writes in the same order, each guarded by the same conditions |
| `sanitizeAccountSession` (`:458`) | 65 | the declarative-schema pattern from matchStore |
| `bindEvents` | monster | R4: registrar per surface (`bindBoard`, `bindModals`, `bindLobby`, `bindHome`); pure relocation of existing wiring |
| `renderHud` / `renderRightRail` / `renderProfileStatistics` | 59/39/60 | section-builder functions returning HTML strings; composition, not rewrite |

## Attack order

_Progress (2026-09-05, after #18–#28): **R2 done** (#19 botLogic.js 10.0,
#24 roomSetup.js 10.0 — server.js 2.01→2.89; create-room/join-room cc
15/12 left). **R3 most landed**: #20 accountStore→10.0, #21 property/market/
contract tables, #23 events, #25 trades, #26 casino/guards, #28 settlement
rules → bankruptcyLogic.js 10.0 (gameLogic 1.09→1.45, and its change-set
verdict now IMPROVES on feature PRs). Reliability: #27 bug sweep (store IO,
zombie rooms, session index, recursion guards). Player-controlled
bankruptcy shipped in #28. **Remaining:** R0 client harness (keydown 98 /
applyServerState 93 still blocked on it), R3 tail (getGameSummary 23,
leaveRoomByClient 22, canMortgageTile 21), create/join-room, then R4/R5.
Each still one hotspot per PR, characterization golden first._

### Gate learnings (delta analysis, "The Bare Minimum")

- The cloud gate fails if a hotspot **gains a rule instance** — a `cc ≥ 9`
  function or a ≥3-operand conditional added anywhere in a red file, even
  while the file score improves overall. Guard-clause additions to red
  files (e.g. #27's `!borrower.bankrupt` in processPlayerContracts) must be
  landed as extractions, not inline ifs.
- Any net LOC/function increase to a hotspot file also degrades its
  verdict, so **feature PRs must pay rent**: #28 net-shrank gameLogic.js by
  moving the new settlement rules into `bankruptcyLogic.js` and extracting
  the event phase ladder from `advanceRound` (19→3).
- New/changed functions must score 10.0 individually: keep each `if` to a
  single boolean operand (compound `a && b` conditions flag Complex
  Conditional even at two operands), cc ≤ 8, and factor repeated assertion
  blocks in test files (Code Duplication fires on those).
- The local `cs delta`/MCP change-set run and the cloud agree only when the
  cloud baseline is current — treat the cloud check as the arbiter, and read
  its per-file "rule in this hotspot" table, not the file score, to find
  what to fix.

**R0 — client test harness (blocking prerequisite).**
Committed, CI-safe smoke for `public/` (DOM-free module extraction Node can
import, or a non-puppeteer-fragile browser smoke). Until then main.js stays
off-limits. (_Partially advanced: #9 added a boot+wire harness for the server
side and #10 shrank main.js, but the `public/` DOM-free extraction still
blocks the keydown/applyServerState tables._)

**R1 — data stores: `matchStore` + `accountStore.recordGameResults` +
`achievementStore` (cc 135/80/96).**
Cheapest, lowest blast radius, pure functions. Characterization tests in the
same PR (stores are uninstrumented today). Kills the repo's two worst
functions and the hidden duplicated participant schema.

**R2 — `server.js`: `scheduleBotTurn` (cc 99) + room handlers (37/33).**
Dedupe purchase-offer, scenario-extract, thin scheduler.

**R3 — `gameLogic.js` rules engine (56/53/53/44/44/41).**
Highest value, highest care: extend the contract suite per extracted table
before moving code. The event-modifier tables must list their factors —
this is where multiplayer correctness bugs live.

**R4 — client hotspots (after R0): keydown 98, `applyServerState` 93,
`sanitizeAccountSession` 65, then `bindEvents` registrars.**
main.js is still the largest file in the repo (≈41% after #10 removed the
offline engine); R4 is the single biggest lever on the project score.

**R5 — ESLint opt-in for `public/` warnings-only**, flip to errors when the
warning count reaches zero. Never a big-bang `--fix`.

## What NOT to do

- No bulk reformatting or style sweeps (the linter's scope decisions are
  deliberate).
- No abstraction introduced solely to lower a CX number — inline table
  literals are fine; factories-of-one are worse than the original. The
  recipes above are table-driven *because the code already is a table*,
  written as control flow.
- No "drive-by" entry: while fixing X, do not also touch Y. The map above is
  the queue; the queue is the scope.
- No splitting `gameLogic.js` into modules just to silence "Number of
  Functions in a Single Module" — shared `this` state makes that surgery
  behavior-risky for a cosmetic badge.
- `socialStore`, `botAdvisor`, `gameLogic.test` are healthy (7.7–8.9).
  Leave them alone.
