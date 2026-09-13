# RR-33 — View-Level Error States & Missing-Data Fallbacks

**Audit:** Release Readiness (40-agent) · Wave 4 · Mission RR-33 · 2026-09-12
**Mode:** READ-ONLY.
For EACH major view: what happens when its underlying data is missing, malformed, or arrives late? (Different from empty states RR-23 and pending RR-25 — this is about degraded/corrupt data.)

Traced `renderAll` (main.js:546), `applyServerState` (clientStateSync.js:384), and each view's renderer. All runtime-referenced art assets (dice/pips are inline SVG; tokens, board marks, casino, patrol) were verified present on disk — no broken-glyph findings. There is no snapshot `version`/schema guard anywhere (grep for schemaVersion/protocolVersion = 0 hits).

## Findings (15)

1. [BLOCKER] `public/main.js:546-565` + `public/clientStateSync.js:424-430` — all views — one panel throws on degraded data — `renderAll` is a single linear function with no per-panel try/catch, so everything after the throw stays stale; because it is called mid-pipeline, `syncDebtModal/syncWinner/maybeStartCountdown/placePiecesSoon` also never run (bankruptcy + game-over modals suppressed, no error surfaced) — wrap each `render*` in isolation + global error hook.
2. [BLOCKER] `public/clientTopNavRender.js:109` — all views (first call in `renderAll`, main.js:547) — partial snapshot with `game.started=true` and empty/missing `players` (`remotePlayersOf` returns `[]`) — `state.players[state.turnIndex].name` TypeError aborts the entire render pass before players/board/HUD — `state.players[state.turnIndex]?.name || "—"`.
3. [MAJOR] `public/clientHudRender.js:293,303-311` — game HUD — same empty/mismatched players (`cur` undefined) — `cur.name` / `cur.cash.toLocaleString()` throws; second stop in renderAll order (rail, wallet, market, casino, setup, lobby, deed skipped) — `if (!cur) return renderHudLobby();`.
4. [MAJOR] `public/clientStateSync.js:84-87,141,207` — all views (snapshot ingress) — `game.players` non-array falls through to `room.players`, or arrays contain null seats — `remotePlayers.map(serverPlayerView)` / `syncJail` read `player.clientId` → TypeError; snapshot is silently dropped (stale UI, zero feedback) — `Array.isArray` both branches + filter object elements.
5. [MAJOR] `public/clientStateSync.js:193-204,257-263` — board/game panels — `game.tiles`/`game.feed` arrays with null entries — `assignOwner`/`syncDeedLayers` read `tile.ownerId/index`, `feedLine` returns `entry.text` on null → kills the whole snapshot pipeline — filter object entries; `entry?.text ?? ""`.
6. [MAJOR] `public/clientAuctionUi.js:108,120-126,225` — auction — stale `auction.tileIndex` (board-variant/rollout drift) or empty players — `TILES[index]` undefined → `accentOf(tile)`/`tile.name` crash in `syncAuctionSurface` after renderAll (debt/winner/countdown skipped); `disableAuctionBids` reads `me.cash` every 60 ms tick — guard `if (!tile) return;` + `state.players[0] || {}`.
7. [MAJOR] `public/clientDeedDetailUi.js:85-94` — deed manager over live board — stale `state.deedDetail` index after variant change, or group missing from `RENT_TABLE` — `tile.i` throws in `renderAll` at main.js:562 (skips `saveGame` + `syncSurfaceA11y`); `table.housePrice` throws for unknown group — `if (!tile) { state.deedDetail = null; return; }`, `table?.housePrice ?? 0`.
8. [MAJOR] `public/clientSocialSurfaces.js:256,354,538,688` — social / rankings / season — no shape validation: `state.social = response.social` then `social.requests?.map` (object → "not a function"); `state.leaderboard.snapshots = snapshot.metrics` then `currentRows.map` (string/non-array); `rewards.map` if `rewardTrack` non-array — TypeError in those panes; no version guard — normalize every inbound array at the boundary.
9. [MAJOR] `public/clientRailRender.js:400,502,658` — deals/holdings rail — `game.playerContracts.active` non-array (only top-level default at clientStateSync.js:155) — `financeMyDueDebts(...).filter` throws in `renderAll` at main.js:555, suppressing wallet/market/casino/setup/lobby/deed — coerce `active` to array at sync.
10. [MAJOR] `public/clientGameModalsUi.js:162,174` — trade-offer inbox — `wantDeeds` index outside current `TILES` (metro↔standard drift) — `TILES[i].name` TypeError in socket handler + renderAll; a departed `from` player is safely skipped at :160 but the offer then renders nowhere — `TILES[i]?.name || \`DEED ${i}\``; show "counterparty left".
11. [MAJOR] `public/clientRoomsUi.js:52-53,58,96,279` — home + rooms directory — directory rows null/missing fields (`seats/cap/name/bank/note`) — `roomRowHTML`/`filteredRooms` throw on a null row, aborting the rest of `renderHome` (account panel, avatar, connection status); absent fields print "undefined" — filter object rows + default every interpolated field.
12. [MINOR] `public/clientGameModalsUi.js:258,269` — bankruptcy/retire modal — direct RETIRE click with empty/short players — `state.players[idx].cash` TypeError; `${amount - p.cash}` can print NaN — `const p = state.players[idx] || state.players[0]; if (!p) return;`.
13. [MINOR] `public/clientTradeUi.js:1235,1460-1461` — trade modal — players array shrinks while modal open — `me.cash`/`other.cash` TypeError on send/edit; stale deed sets remain selected — re-validate both players and close the modal when missing.
14. [MINOR] `public/clientDeedsRender.js:212` (+ `clientDeedDetailUi.js:160`, `clientTradeUi.js:1192`) — deed cards/trade rows — tile shape drift drops `price` — renders "$undefined" — `tile.price != null ? \`$${tile.price}\` : "—"`.
15. [MINOR] `public/clientSocialSurfaces.js:683,695,1075-1085` — rankings + player card — rows missing `displayName/username/games/wins` or `accountId` — prints "@undefined · undefined GAMES"; an "undefined" accountId is emitted to `get-public-player-card` (doomed request) instead of rendering as guest — `?? "—"` coercions + skip fetch on non-account ids.

## Robustness table

| View | Guarded? | Worst gap |
|---|---|---|
| home | Partial | directory row throw aborts rest of `renderHome` (11) |
| rooms/directory | No | null/malformed row crash + raw fields (11) |
| lobby/setup | Mostly | malformed settings render "undefined" stepper; no crash |
| game board/HUD | Partial | board owner pips safe (clientBoardRender.js:215-226), but HUD `cur` (3), auction tile (6), deed detail (7); renderAll blast radius (1) |
| profile | Yes | history filtered (clientProfileRender.js:170); Number coercion throughout |
| rankings | No | metrics + row shapes unvalidated (8,15) |
| social | No | `requests.map` / unvalidated payload (8) |
| rules | Yes | static data, no server dependency |
| night shift | Yes | DOM/timers guarded; all asset refs verified present |
| casino | Yes | `casino()` fallback, defensive reel |
| market | Yes | `market()` fallback, Number guards |
| wallet | Yes | `localPlayer()` fallback, item entries filtered |
| deals/trade | Partial | contracts.active (9), offer TILES[i] (10), me.cash (13) |
| auction | Fragile | tile index + me.cash (6) |
| match history | Mostly | raw names/accountId fallback (15); entries filtered |
| season | Mostly | rows/rewards arrays checked; `rewardTrack` path unvalidated (8) |

**Top 5 fixes:** (1) per-panel try/catch in `renderAll` + global error hook; (2) optional-chain every `players[turnIndex]` access; (3) boundary normalization (`Array.isArray` + object filter) in clientStateSync and social/leaderboard ACKs; (4) guard `TILES[i]`/`RENT_TABLE[group]` lookups; (5) money/name fallbacks (`Number(x)||0`, `?? "—"`). No files were modified.
