# GAUNTLET Batch 1 — server/gameLogic.js (4 shards, lines 1-280 / 281-560 / 561-840 / 841-1119)

Read-only review, 4 parallel agents. All P0/P1 re-verified in source. Status: VERIFIED / DEMOTED / DISCARDED.

## P1 — VERIFIED

### G1. contractTransactions.delete() wipes replay tombstone (gameLogic.js:181-185, live caller contractLogic.js:85-87)
- Failure: `memoizeSuccess` evicts oldest via `delete()` when over MAX_CONTRACT_REPLAYS. `delete()` also clears `terminal`, so the evicted requestId replays as fresh → double-executed contract money op.
- Note: `BoundedReplayMap.set()` (gameLogic.js:161-166) already evicts oldest *with* tombstone — the manual while-loop is redundant and harmful.
- Fix sketch: delete the while-loop in `memoizeSuccess`, or make `delete()` tombstone: `this.rememberTerminal(key, Date.now()+this.ttlMs)`.
- Evidence: `game.contractTransactions.delete(game.contractTransactions.keys().next().value);`

### G2. Turn order stalls on pruned seat (gameLogic.js:908-911 + :376-381 + :885-889)
- Failure: `removePlayerByClient` splices `players` without touching `turnOrder`. `pruneExpiredSeats` (rooms.js:527-532) removes expired-disconnected seats mid-game. `findNextTurnSeat` stops the skip-loop on the null seat (`seatIsIdle(null)` → false), `nextSeatIsPlayable(null)` → false, `nextTurn` announces nothing (`announceWaitingForSeat(null)` no-ops) and returns without advancing or ending. Game stalls silently with 2+ live players.
- Fix sketch: `if (!player) return true;` in `seatIsIdle`, and/or strip removed ids from `turnOrder` in `removePlayerByClient`.
- Evidence: `if (!player) return false;` vs `if (!next.player) return false;`

## P2 — VERIFIED (latent / reduced impact)

### G3. Stale fullGroups never revoked (gameLogic.js:426-431)
- Verified: `canBuildOnTile` recomputes via `hasFullSet` (propertyRules.js:90), so building is NOT affected. Impact = stale monopoly flag feeds achievements (`full-street`/`empty-streets` via participantFields setSize), match history, audit-trade-auction test after sale/trade/loss. Refresh callers (auctionApi:212, gameLogic:557, propertyApi:112) only add.
- Fix sketch: `player.fullGroups = new Set(complete);`

### G4. marketInstruments shared across games (gameLogic.js:267,355)
- Verified: no writes found (single read at marketExpansion.js:441). Latent — one future mutation contaminates all rooms. `marketQuotes` uses `freshMarketQuotes()` copy; instruments do not.
- Fix sketch: copy on assign (`[...MARKET_INSTRUMENTS]` or structuredClone if entries mutated).

### G5. clear() wipes replay tombstones (gameLogic.js:187-191)
- Verified: zero callers; `reset()`/`resetForNewGame()` construct fresh maps. Latent P2.

### G6. Bank-loan collateral not excluded from eligibility (gameLogic.js:491-498)
- Demoted from P0: second bank loan while one is outstanding is blocked (`loanLogic.js:111` "already have an active bank loan"), and `isLoanCollateral` is false once status leaves active/due. Defense-in-depth only.
- Fix sketch: add `if (this.isLoanCollateral(player,tile)) return false;`

### G7. hasFullSet vacuously true for empty group (gameLogic.js:940-943)
- `[].every()` → true. Unreachable with real groups (all callers pass groups from player tiles/variants); garbage-input robustness only.
- Fix sketch: `return groupTiles.length>0 && groupTiles.every(...)`

### G8. Disconnected debtor force-bankrupted in trySettlePendingPayment (gameLogic.js:1031-1063)
- Demoted: both timer paths funnel through `afkWatchTarget`, which returns null for disconnected seats (socketRuntime.js:866). Remaining callers (botLogic, propertyApi:186, tradeApi:313) are same-tick own-action paths; single-threaded Node cannot interleave a disconnect mid-handler. No live trigger while disconnected. Keep as hardening note.

## DISCARDED (false positives killed by verification)

### X1. startGame counts bankrupt seats (:608)
- `PLAYER_STATE_DEFAULTS` resets `bankrupt=false` (gameLogic.js:132) and `disconnected=false` (:136); applied in `addPlayer` and `resetForNewGame` (:366). Pre-start bankrupt seat impossible.

### X2. Partial-debt hook double-fires (:1011)
- Documented design (gameLogic.js:1086-1089): `onPaid` fires once per paid share (partial, then remainder), equity debts route through equity indexes. No double-count of same dollars.
