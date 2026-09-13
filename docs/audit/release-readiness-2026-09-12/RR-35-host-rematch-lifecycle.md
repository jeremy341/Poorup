# RR-35 — Host, Spectator & Rematch Lifecycle

**Audit:** Release Readiness (40-agent) · Wave 4 · Mission RR-35 · 2026-09-12
**Mode:** READ-ONLY.

Evidence: prior audit doc + code traces + three `node -e` reproductions (oversubscription, ghost-seat rematch, bot host takeover). No files modified.
**Verdict:** must-fix before any friends-scale launch: 1, 2, 3 (rematch is effectively broken and rooms can be permanently frozen). Should-fix: 4–8 (non-host Rematch, post-game join/capacity, leave semantics, recovery tools). Acceptable for friends-scale with notes: 9–15.

## Findings (15)

1. [BLOCKER] `public/clientStateSync.js:366` — host rematches; every other player is stuck on the round-over modal (scrim locked, Escape gated at `clientKeyboard.js:185`, `state.gameOver` never cleared, `lastWinner`→null makes `syncWinner` return) — only exits are a dead Rematch or "Back to Lobby" (which leaves) — clear `state.gameOver` + `closeSurface("#gameover-modal")` when `game.started` flips true.
2. [BLOCKER] `server/gameLogic.js:530` — one player closes tab, game ends, host clicks Rematch — fails forever with "At least two players are required." because the expired seat is never pruned (`socketRuntime.js:610-630`) and there is no kick; with 3+ seats it instead passes and `resetPlayerState` (`gameLogic.js:131`) revives the ghost into turn order, stalling 180s/turn (repro) — prune expired disconnected seats at end/rematch.
3. [BLOCKER] `server/socketRuntime.js:264` — all humans offline >10s in a bot room — bot becomes host (missing `!p.isBot`), and `restoreConnection` (`rooms.js:735`) never re-elects; reconnect still rejected by `serverSocketAccount.js:472` (repro: BOT 1 host, H1 `canStart=false`) — exclude bots + re-elect on reconnect.
4. [MAJOR] `public/clientGameModalsUi.js:235-244` — non-host at round over — live "Rematch" button; click closes the modal, server rejects, error lands in hidden chat — hide/disable for non-host, show "waiting for host".
5. [MAJOR] `server/rooms.js:624` + `gameLogic.js:496` — game ends — room re-lists public as `open / waiting for players`, JOIN enabled; a stranger joined the post-game table (repro) — add a `finished` post-game state and block joins until host restarts/reopens.
6. [MAJOR] `server/gameLogic.js:496` + `rooms.js:70` — post-game bankrupt seats don't count for `canJoin`/capacity — 4-cap room took 5 humans and restarted with 5 players (repro) — count all seated humans or purge bankrupt seats at `endGame`.
7. [MAJOR] `public/clientGameModalsUi.js:236` — "Back to Lobby" — `goHome()` actually releases the seat/room (known 4.4); private code and rematch eligibility lost — rename "Leave Table" or implement true lobby return.
8. [MAJOR] `server/serverSocketAccount.js:468-483` — host whose opponent abandoned (finding 2) or debt-mode lock (audit 8.3) — no kick, force-end, manual transfer, or close-room verb exists anywhere — add host kick for disconnected seats + force-end.
9. [MINOR] `server/socketRuntime.js:397,700` — last human leaves mid-game with bots seated — bots keep acting (AI provider calls, feed, telemetry) until the 10-min GC; may record an accountless "match" (`socketRuntime.js:154`) — end/freeze the room when the last human exits.
10. [MINOR] `server/socketRuntime.js:261-271` — host departs while all other seats are in grace/bankrupt — `hostId` dangles on the removed player and later departures early-return, so no host ever; transfers are also silent — elect on join/reconnect + "X is now host" system message.
11. [MINOR] `public/clientLobbyUi.js:846` — `leave-room` ack discarded (known 1.13) — a rejected leave still tears down the local UI, leaving a live ghost seat — handle the ack and restore state on failure.
12. [MINOR] `public/clientRoomsUi.js:81` — late joiner browsing a live table — JOIN enabled but always rejects "Game is already in progress." (`rooms.js:413`) then bounces home; no spectator feature exists (docs mention only) — disable/label live rows "IN PROGRESS".
13. [MINOR] `server/socketRuntime.js:154` — last humans disconnect; `endGame` sets `lastWinner=null` — stats/match record never written (guard needs a winner) — record abandoned match or lifecycle event.
14. [MINOR] `server/socketRuntime.js:300-306` — host switches rooms mid-game — seat detached and host reassigned immediately, before the 10s grace, with pending obligations left hanging (known 2.5) — keep host during grace, clear obligations at detach.
15. [MINOR] `public/clientGameModalsUi.js:215` — game-over standings are client-computed; `i === 0` adds a second "WINNER" whenever the last-seat winner isn't richest (known 3.15) — crown only `winnerId`; consider server-sent standings.

## Lifecycle Matrix

| Event | Server behavior | Client behavior | Gap |
|---|---|---|---|
| Round ends (elimination/last-seat) | `endGame()`: started=false, clears obligations, keeps seats+bots, returns to "open" | snapshot → phase lobby + `showGameOver` | stats only if `lastWinner` (13); client-only standings (15); room re-listed joinable (5) |
| Round-over card | none | blocking scrim, Escape prevented, 2 buttons | no host/waiting distinction (4) |
| Host clicks Rematch | host check → `ensureBots` → `resetForNewGame` resets cash/bankrupt/inDebt/disconnected → new start order | snapshot started=true → playing | others' modal stays open (1); ghosts revived (2) |
| Non-host clicks Rematch | rejects "Only the host can start the game." | closes modal, chat-only error | stale button (4) |
| Host leaves lobby / disconnects mid-game / switches room | `releaseSeat` or grace expiry → `reassignHostIfNeeded` (bots eligible; no message) | "X left/disconnected." only | bot host freeze (3); dangling hostId (10); instant transfer (14) |
| Host reconnects | seat restored | state resync | no re-election if host moved (3) |
| Player leaves mid-game | full asset cleanup (`releaseSeat`), end-game if ≤1 survivor | confirm modal → home | ack ignored (11) |
| Player abandons (tab close) | 10s grace, then dormant seat retained | none (bot/AFK badge) | blocks/blocks-with-ghost rematch (2) |
| Late join, live game | rejects "Game is already in progress." | toast + home | JOIN still offered; no spectator (12) |
| Late join, post-game | **accepted** (canJoin ignores bankrupt, started=false) | joins lobby | stranger intake (5); oversubscription (6) |
| All humans leave | bots keep playing up to 10-min GC; no message | none connected | resource burn / accountless stats (9, 13) |
