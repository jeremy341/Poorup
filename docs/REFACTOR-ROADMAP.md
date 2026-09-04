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

| Score | File | Notes |
|-------|------|-------|
| 1.06 | `server/gameLogic.js` | worst in repo: 6 complex methods + 15 Bumpy Road + deep nesting |
| 1.26 | `public/main.js` | 98-branch keydown, snapshot reducer, 90+ complex methods |
| 2.01 | `server/server.js` | one 99-cc function plus socket-handler chain |
| 4.42 | `server/accountStore.js` | 80-cc participant builder + aggregation loops |
| 6.09 | `server/matchStore.js` | single 135-cc function is the whole file's problem |
| 6.63 | `server/achievementStore.js` | single 96-cc scan + 8 complex conditionals |
| 7.66 | `server/socialStore.js` | healthy — leave alone |
| 8.82 | `server/gameLogic.test.js` | healthy |
| 8.89 | `server/botAdvisor.js` | healthy — leave alone |

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

### accountStore.js `recordGameResults` participants builder — cc 80 (file: 4.42)

The SAME ~60 fields mapped from live player objects instead of stored JSON
(`player.airportVisits instanceof Set ? .size : 0` where matchStore reads a
number). This is a real duplication CodeScene surfaced: the two files
hand-write the same schema.

**Recipe:** one `server/participantFields.js` table of descriptors —
`{ key, fromPlayer(p), fromRecord(r) }` — consumed by both stores' loops.
`recordGameResults` keeps its placement/persistence logic; only the
participant mapping moves. matchStore then shares the same table.

### achievementStore.js `evaluateMatch` — cc 96 (file: 6.63)

~47 sequential `if (cond) candidates.push({id, title, rarity, body})`
statements plus 8 "complex conditional" flags.

**Recipe:** a static `ACHIEVEMENT_RULES` array
`{ achievementId, title, rarity, body, test(participant, ctx) }`;
`evaluateMatch` becomes one `forEach` over the rules with the shared
context (`isWinner`, `othersCash`, `contracts`, `eventNames`, `treasureCards`)
computed once outside. Each `test` is cc 1–5. Behavior identical; new
achievements become a one-line table entry (actual functional improvement).

### server.js `scheduleBotTurn` — cc 99 (file: 2.01)

Timer + lock + 8 decision branches, one of which (the purchase-offer
post-roll block) is literally duplicated twice in the body.

**Recipe:** extract each scenario to a named async function —
`botVote`, `botAnswerTrade`, `botAnswerContract`, `botSettleDebt`,
`botPassAuction`, `botEndTurn`, `botOpeningMove` (the advisor-candidate
dispatch, itself a small table by `candidate.kind`), and
`resolvePurchaseOffer(room, bot, result)` used by BOTH call sites (kills the
duplication). `scheduleBotTurn` keeps only: guard → setTimeout → lock →
re-dispatch. cc drops to ~15; the branches become 8 functions at cc 3–8.
The decision logic itself is untouched — same conditions, same actions.

Also in this file: `create-room` (cc 37) / `join-room` (cc 33) socket
handlers → validate/persist/broadcast split per handler, continuing the
2026-09-03 pattern.

### gameLogic.js — the rules engine (file: 1.06)

| Function | cc | Shape confirmed | Recipe |
|----------|----|-----------------|--------|
| `applyCard` | 56 | 14-case `switch` on `card.action` | action→handler map; same case bodies moved verbatim into small methods; dispatcher = lookup + `resolveTurnAfterAction` |
| `getPropertyRent` | 53 | type branches + 11 event-modifier ifs | (a) `baseRent` per tile type via 3 tiny helpers; (b) a `RENT_EVENT_MODIFIERS` list of `{ when(tile, ev), factor }` folded with `reduce`. All factors multiply a running total and none depend on the accumulated value — order is provably irrelevant — but the `rentCap` + `Math.floor` stays last. Add a rent-tier table test naming every modifier |
| `manageProperty` | 53 | buy/build/mortgage/sell action chain | action→method table on `this` (`manageBuild`, `manageMortgage`, …) |
| `tradeMarket` | 44 | side/quantity/settlement ifs | per-instrument validator + settlement split |
| `proposePlayerContract` | 44 | term validation chain | array of predicate+message validators run sequentially |
| `activateGlobalEvent` | 41 | event ifs | per-event setup table |
| `advanceRound` | — | 4-level nesting (Bumpy Road) | early returns + one extracted per-phase helper |

`gameLogic.test.js` was written FOR this code, so each PR extends it: every
extracted table gets a direct table test. "Number of Functions in a Single
Module" (file-size smell) is NOT fixable by splitting the class — methods
share `this` state; splitting the file is R3-late or never. The score moves
via the per-function work; big-bang module surgery is explicitly out.

### public/main.js — untested until R0 (file: 1.26)

| Function | cc | Recipe |
|----------|----|--------|
| keydown handler (`:8245`) | 98 | 60 `if`s, 23 of them `e.key ===`. One `chord(e)` helper (`"shift+p"`, `"tab"`, …) + a keyed handler table; typing-context guard hoisted once. Same actions, same order of checks |
| `applyServerState` (`:1000`) | 93 | split into small appliers fed the same snapshot: `applyRoomMeta`, `applyPlayers` (movement/positions), `applyPhaseAndTurn`, `applyPendingInteractions`, `applyTimers` — same field writes in the same order, each guarded by the same conditions |
| `sanitizeAccountSession` (`:458`) | 65 | the declarative-schema pattern from matchStore |
| `bindEvents` | monster | R4: registrar per surface (`bindBoard`, `bindModals`, `bindLobby`, `bindHome`); pure relocation of existing wiring |
| `renderHud` / `renderRightRail` / `renderProfileStatistics` | 59/39/60 | section-builder functions returning HTML strings; composition, not rewrite |

## Attack order

**R0 — client test harness (blocking prerequisite).**
Committed, CI-safe smoke for `public/` (DOM-free module extraction Node can
import, or a non-puppeteer-fragile browser smoke). Until then main.js stays
off-limits.

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
main.js is ~44% of all lines; R4 is the single biggest lever on the project
score.

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
