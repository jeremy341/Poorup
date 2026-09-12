# Poorup QA / Security Pre-Merge Audit — 2026-09-12

Branch: `codex/theme-reset` at `1bf4e1a`
Review mode: read-only audit of `main...HEAD`; only this report was created.
Gate recommendation: **HOLD for P1-01**. No P0 was found.

## Executive summary

The reviewed Socket.IO verbs consistently resolve the actor from the server-side room and the focused room suite passed all 99 contracts, including host authority, capacity, private-code redaction, stale contract IDs, seat ownership, and multi-counter relay direction. The audit and client contract packs also pass. Market mutation replay checks run before action-quota guards, and the bot suites exercise legal candidates and stale-seat cancellation.

One release-blocking correctness defect remains in the branch's margin work: maintenance liquidation compares the gross marked position value to the maintenance requirement, not the player's margin equity. The new collateral therefore does not produce the documented maintenance behavior. A normal 20% fall can leave equity below maintenance without liquidation.

The remaining findings are reliability/security/maintainability risks: create-room replay is limited to one live socket and the client has no bounded acknowledgement recovery; a bearer session token is retained in `localStorage`; the option-writer selector silently becomes buyer-only after a market-desk rerender; and three already-large modules grew further.

## Findings

### P0

No confirmed P0 finding.

### P1-01 — Margin maintenance uses position value instead of equity

**Impact:** a player can remain in an under-maintained leveraged position and continue carrying debt through price moves that should force server-authoritative liquidation.

**Evidence:**

- `server/marketExpansion.js:137-158` now deducts a 25% initial collateral hold and records a debt balance and maintenance requirement.
- `server/marketExpansion.js:408-409` computes only gross marked position value.
- `server/marketExpansion.js:490-494` suppresses liquidation whenever gross position value is at least maintenance; it never subtracts margin debt or adds held collateral to calculate equity.
- Deterministic reproduction run during this audit:

  1. Start a `margin` room and open one Brazil unit at `$100`.
  2. The server records debt `$100`, collateral `$25`, maintenance `$25`.
  3. Mark the quote to `$80`; equity is `$80 + $25 - $100 = $5`.
  4. `forceLiquidate(game, player, {})` returns `[]`, leaving the `$100` debt and position open even though `$5 < $25`.

The existing liquidation test (`server/marketExpansion.test.js:76-92`) forces `marginMaintenance = 200` against a `$10` position. It verifies settlement conservation after an extreme breach but does not test the boundary formula.

**Recommendation:** define one authoritative `marginEquity = markedValue + marginCollateral - marginBalance` calculation and liquidate when equity is below the applicable maintenance requirement. Add table-driven tests at just above/equal/below threshold, multiple positions, partial debt reduction, quote changes, bankruptcy, and replay. Derive expected values as fixed worked examples rather than recomputing them with the production formula.

### P2-01 — Lost create-room acknowledgement can strand the UI and defeat replay protection

**Evidence:**

- `server/serverSocketAccount.js:185-209` caches only one `{requestId, ack}` pair on `socket.data`. It is lost on reconnect, overwritten by the next create, and is not bound to a normalized semantic payload.
- `public/clientLobbyUi.js:526-529` stores `roomEntryRequestId`, but no code reads it for a retry.
- `public/clientLobbyUi.js:719-729` creates a fresh id for each create attempt and waits without a timeout.
- `public/main.js:280-290` sends the socket request with an unbounded callback. Unlike social/market/casino flows, room entry has no acknowledgement timeout or state reconciliation.

If the server creates a public room and its acknowledgement is lost, `roomEntryPending` remains true and the visible entry control stays disabled. After reconnect/recovery, a new semantic attempt gets a new key and can create a second room; the original socket-local replay record no longer exists.

**Recommendation:** use a bounded create/join request controller. Preserve and retry the same request ID until the outcome is known, reconcile from an authoritative room snapshot after reconnect, and store a small TTL/LRU replay map keyed by stable client/account identity plus operation and payload fingerprint. Add fault-injection integration tests for “side effect committed, ack dropped”, reconnect replay, key reuse with a different payload, and two non-adjacent retries.

### P2-02 — Account bearer session is persisted in `localStorage` (pre-existing, merge-relevant)

**Evidence:** `public/clientSanitize.js:316-336` treats `sessionToken` as the account credential and serializes it with the account into `localStorage`. Any same-origin script execution can read and exfiltrate it. The server has a useful strict `script-src 'self'` CSP (`server/server.js:42-48`), but CSP is defense-in-depth and does not make a JS-readable bearer credential safe.

**Recommendation:** move authentication to a server-managed `HttpOnly`, `SameSite` cookie with production-aware `Secure`, short expiry, rotation, and logout revocation. If the current protocol must remain temporarily, shorten token lifetime, rotate aggressively, avoid persisting it across browser restarts, and keep DOM-XSS regression checks on every HTML sink. This finding is not introduced by `codex/theme-reset`, but it remains a security acceptance risk at merge.

### P2-03 — Option writer control becomes dead after a market-desk rerender (pre-existing, merge-relevant)

**Evidence:**

- `public/clientMarketUi.js:128-130` initially renders both `writer` and `buyer` choices.
- On any rerender, `captureDeskDraft()` preserves the selection (`:109-120`), but `restoreDeskDraft()` then replaces the entire role selector with only the buyer option (`:139-158`).
- `renderMarketDesk()` invokes that restore after replacing the card (`:166-176`). Thus a server snapshot or action refresh silently removes the advertised collateralized-writer path and changes a saved writer draft to buyer.

**Recommendation:** never rewrite the role option list in draft restoration. Restore only a still-valid value, and derive allowed roles explicitly from the server contract. Add a DOM-level behavior test: select writer, trigger `renderMarketDesk()` from an economy refresh, verify both options remain and writer stays selected; then submit and assert `role: "writer"` reaches the socket seam.

### P3-01 — Branch growth continues three god-module hotspots

The architecture review's 500-line warning is materially exceeded:

| Module | Current lines | Branch delta | Responsibilities mixed |
|---|---:|---:|---|
| `public/clientSocialSurfaces.js` | 1,218 | +124 / -18 | social search, relationship UI, rankings, seasons, player history, timers |
| `public/clientLobbyUi.js` | 938 | +161 / -33 | setup, room entry, Quick Table orchestration, settings, home/reset lifecycle |
| `server/rooms.js` | 958 | +43 / -7 | room policy, settings/rulesets, seating, lifecycle, game facade |

This is not an immediate behavior failure, but it increases hidden coupling and makes fault-path testing harder. Extract by stable responsibility after the correctness fixes: a room-entry request controller, social/ranking/season presenters with independent request state, and room setting/lifecycle services. Preserve the current public seams and characterize behavior before moving code.

## Server authority, socket contracts, persistence, bots, and docs parity

- **Server authority:** PASS in reviewed seams. `set-setting` checks the current authoritative host and started state; game verbs resolve the player's socket through the room. The 99-case room suite covered cross-account token misuse, seat rebinding, full/live-room joins, and host-only settings.
- **Socket.IO contracts:** PASS with the reliability exception in P2-01. Two-counter player-contract relay and lender-response routing passed end-to-end. Public listings expose `roomId` while hiding private codes.
- **Idempotency:** market/casino/result tests pass their replay cases; create-room replay is incomplete as described in P2-01.
- **Persistence:** annotated match history now updates the existing account snapshot before `MatchStore` recording; focused adapter/persistence tests passed in the main test run before the sandbox stopped that chained command. The audit pack's account-session, season, privacy, and settlement tests all passed.
- **Bot legality:** bot candidate/action checks passed, including stale offer/seat cancellation and bounded legal fallback. The 1,000-game simulation completed without an assertion or stall, although no simulated game ended within its 2,000-step bound; treat this as a balance/termination signal, not a correctness gate.
- **Market/deals:** quota, replay, contract settlement, relay, and conservation suites passed. P1-01 is an uncovered maintenance-boundary defect.
- **Dead UI:** client static contracts pass, but P2-01 and P2-03 require fault/DOM behavior tests rather than source-regex assertions.
- **Docs parity:** Quick Table implementation matches `docs/audit/docs-parity-manifest-2026-09-12.json:15-22` (directory → ranked join → bounded fill-race retries → Standard-40 create fallback). Margin docs describe maintenance breaches and forced liquidation (`.ulpi/design/RULESETS-SEASONS-MARKET-PLAN.md:357-369`), which P1-01 does not currently satisfy. `docs/DEVLOG-7.md:9` overstates the margin feature as complete until that boundary is fixed.

## Verification performed

| Check | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run lint:client` | PASS |
| `node server/rooms.test.js` (local server permission granted after sandbox `spawn EPERM`) | PASS — 99 / 99 |
| Six focused client contract suites | PASS — 75 / 75 total reported assertions |
| `npm run test:audit` | PASS — 9 / 9 suites |
| `npm test` | The chained run passed all suites through the 1,000-game bot simulation, then its in-sandbox room test hit environment `spawn EPERM`; the room suite was rerun directly and passed 99 / 99. Later chained client suites were run directly and passed. |
| `git diff --check main...HEAD` | PASS |
| Margin-equity reproduction | FAIL as expected — equity `$5`, maintenance `$25`, liquidation actions `[]` |

Browser/Playwright execution was not rerun in this bounded audit. The branch contains source-level client contract tests, but P2-01 and P2-03 specifically need browser/fault-injection coverage before their risks can be closed.
