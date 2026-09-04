# Poorup Refactor Roadmap

_Measured 2026-09-04 with the repo's own ESLint (`complexity > 15`,
`max-lines-per-function > 120`) and line counts. This is the attack order for
CodeScene's "legacy is unhealthy" verdict — one hotspot per PR, behavior frozen
by `npm test`. Do not execute this list as a bulk refactor._

## Ground rules (from DEVELOPMENT_WORKFLOW.md)

- Each row = one `refactor/*` branch → one PR → green CI → merge. No mixing.
- Behavior is frozen: the 9 contract suites plus the boot smoke must stay
  green; a refactor PR may ADD tests but never changes observable game rules.
- Server first, client second: `server/` is linted and tested today;
  `public/` is neither, so touching it needs a test harness as step 0.
- If a row makes CodeScene's health of the touched functions worse, the row
  failed — revert rather than force it.

## Measured hotspots

### server/ — 47 functions above CX-15 (linted + tested: safe to attack)

| CX | Location | Function | Note |
|----|----------|----------|------|
| 95 | `matchStore.js:21` | record normalization (`safeArray(...).map`) | one giant map/validate expression — split into field validators |
| 76 | `achievementStore.js:68` | `participants.forEach(...)` achievement scan | switch/tier table per achievement id |
| 72 | `server.js:304` | AFK/turn timer callback | extract decision logic, keep scheduling thin |
| 54 | `gameLogic.js:2629` | `manageProperty` | buy/build/mortgage/sell branches → one method per action |
| 51 | `gameLogic.js:1059` | `getPropertyRent` | rent-tier table (color set, jail, utility, event modifiers) |
| 49 | `gameLogic.js:2109` | `applyCard` | card-id table lookup instead of if-chain |
| 47 | `gameLogic.js:1873` | `tradeMarket` | side/quantity/settlement branches |
| 45 | `gameLogic.js:843` | `proposePlayerContract` | validation chain per term |
| 42 | `accountStore.js:121` | account hydration loop | per-field normalizers |

The remaining ~38 sit between CX 16-37; CodeScene's own hotspot ranking
(change frequency × complexity) should order them when the PR integration is
live — treat this table as the complexity axis only.

### public/main.js — 46 functions above CX-15 and a monster (untested: dangerous)

| Metric | Location | Function |
|--------|----------|----------|
| 1,073 lines | `main.js:7315` | `bindEvents` — ~half of all UI wiring in one function |
| 142 lines | `main.js:8245` | anonymous (keyboard/global handler region) |
| 130 lines | `main.js:1000` | `applyServerState` — the snapshot reducer |
| 125 lines | `main.js:5744` | `runTurn` |
| 122 lines | `main.js:6433` | `renderTradeModal` |

## Attack order

**R0 — client test harness (blocking prerequisite).**
Add a browser-driven smoke (puppeteer-core against a local server) as a real
committed suite, or a DOM-free module extraction that Node can import.
Until then `public/main.js` stays off-limits for "improvement" — the 64%
server coverage is what protects behavior; there is no client net.

**R1 — `matchStore.js` + `achievementStore.js` (CX 95/76).**
Pure data stores, zero game-state coupling, already exercised by legacy
smoke. Warm up the loop on the two worst functions in the repo with the
lowest blast radius.

**R2 — `server.js:304` timer callback + the two room handlers**
(`create-room` :732, `join-room` :814 — CX 37/33). Validation already lives
in helpers after the 2026-09-03 fixes; continue extracting request-parsing
vs. mutation vs. broadcast into three named functions per handler.

**R3 — `gameLogic.js` rules engine (CX 54/51/49/47/45).**
The contract tests were written FOR this code — every split must land a new
contract suite covering the extracted table (e.g. `getPropertyRent` gets a
rent-tier table test). This is the highest-value server refactor because the
rules engine is where multiplayer correctness bugs live.

**R4 — `bindEvents` decomposition (after R0).**
Split by surface (board, modals, lobby, home) into registrars; each registrar
covered by the new smoke harness. This is also the natural first step toward
a `main.js` module split, which is the biggest single lever on the project
score because the file is ~44% of all lines.

**R5 — ESLint opt-in for `public/` as warnings-only**, then flip to errors
when warning count reaches zero. Never a big-bang `--fix`.

## What NOT to do

- No bulk reformatting or style sweeps (the linter's scope decisions are
  deliberate).
- No abstraction introduced solely to lower a CX number — inline table
  literals are fine; factories-of-one are worse than the original.
- No "drive-by" entry: while fixing X, do not also touch Y. The map above is
  the queue; the queue is the scope.
