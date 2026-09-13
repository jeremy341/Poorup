# RR-27 — Room Code & Join/Leave Edge Cases

**Audit:** Release Readiness (40-agent) · Wave 3 · Mission RR-27 · 2026-09-12
**Mode:** READ-ONLY.

Prior items verified (not re-counted): `restore-session` still rebinds a live seat (`rooms.js:735-750`; no guard in `handleRestoreSession`), join during 10s grace still rejects the seat's owner (`serverSocketAccount.js:110-113`), invite listings still include expired rows (`socialStore.js:220`) while accept does check expiry (`socketRuntime.js:765-770`).

## Findings (12)

1. **[BLOCKER] `public/clientParlorBindings.js:239-251`** — in-app invite accepted while at home/on the social page — server seats the player and broadcasts state (`socketRuntime.js:781-807`), but the client ignores the ack's `roomCode` and `syncView` (`clientStateSync.js:310-314`) only re-asserts an already-visible game view; leaving social then calls `leaveRoomForHome`→`goHome` (`clientLobbyUi.js:890-902`) and *releases* the fresh seat — invited players cannot enter; add an entry transition (apply code/visibility like `applyParlorEntryAck`) on accept and treat it as an in-room session.
2. **[MAJOR] `server/socketRuntime.js:284-306`** — accepting an invite while playing elsewhere (detach at `:787`, also `:415`) — `detachStartedSeat` sets `disconnected`/deadline but never schedules `expireDisconnectedSeat`, never clears pending obligations, and `afkWatchTarget` (`:748-756`) ignores disconnected seats, so if the leaver owned the turn the old table stalls **forever** (prior 2.5 wrongly assumed the 180s watchdog catches it); failed invite joins (`:789-797`) also leave that orphan seat — reuse the `expireDisconnectedSeat` path (timer, obligation cancel, turn skip) and only detach after the target seat is committed.
3. **[MAJOR] `server/rooms.js:29-36` + `server/roomSetup.js:29-32`** — codes mix `O/0` and `I/1` with no aliasing anywhere (`clientHomeEntryBindings.js:28-37`, `clientRoomsUi.js:426-430`) — a correctly-heard code with one homoglyph fails "Room not found." or can land in a different existing room — generate from an unambiguous 32-char alphabet and add fallback lookup (O↔0, I↔1/L) plus reject ambiguous private codes.
4. **[MAJOR] `public/index.html:288` + `public/clientHomeEntryBindings.js:68-78`** — pasting >6 chars into the join field — `maxlength="6"` makes the browser truncate before the handler runs, so the "EXTRA CHARACTERS REMOVED" warning (the fix for room-patrol #15) is dead code and long pastes silently join the first 6 chars (wrong-room risk; server also slices at `roomSetup.js:31`) — drop `maxlength` or use a paste handler and surface the truncation.
5. **[MAJOR] `server/gameLogic.js:492-497` + `:1095-1126` + `server/rooms.js:521-547`** — joining by code after a round ends — `endGame` keeps bot seats (`started=false`), `canJoin` counts humans only, and `ensureBots` runs only at `startGame`, so 2 humans + 2 bots can accept 2 more humans past the 4-seat cap; the lobby slices extras (`clientLobbyUi.js:574`) so the overflow player is invisible — run a bot-aware capacity clamp on join and at `endGame`.
6. **[MAJOR] `server/serverSocketAccount.js:308-319` + `server/socketRuntime.js:763-774` + `server/socialStore.js:231`** — room destroyed (GC/reclaim) then re-created with the same code — `privateCodeConflict` destroys the empty room and lets the new room take its code, while invites/joins match on `roomCode` only (no `publicId`/host binding), so a pending 15-min invite or shared code can deliver a player to a stranger's room — bind invites to room `publicId`/creator or reserve codes for the invite TTL.
7. **[MAJOR] `server/socketRuntime.js:261-271`** — host leaves with bots seated (leave/switch) — `reassignHostIfNeeded` excludes disconnected/bankrupt but not bots, so a bot can inherit `hostId`; after `endGame` no human can start a rematch and the room can't be reclaimed until GC (prior P1 8.2 still open) — exclude `isBot` and re-elect a human host on reconnect.
8. **[MINOR] `server/socketSocialApi.js:285-293` + `socialStore.js:149-150`** — blocked player joins your room — block only gates chat; the blocked account can take a seat and there is no ban/kick anywhere — gate seat takeover for mutually blocked accounts or document chat-only semantics; add host kick if intended.
9. **[MINOR] `server/rooms.js:414,420` + `serverSocketAccount.js:401` + `clientLobbyUi.js:751-771`** — join failures ("Game is already in progress.", "Room is full.", "Room not found.") — raw server string in a toast then home with no next action and no started-room queue/spectator path — append recovery copy and offer Quick Table/browse for full or not-found.
10. **[MINOR] `public/clientState.js:137` + `server/rooms.js:38-45,412-421`** — second tab/device for the same person — guest identity is per-tab/device so a second guest seat with a duplicate nickname is allowed (no spectator slot); accounts get "This account is already seated in this room." — add "close the other tab or wait ~10s" copy for the account case and dedupe table nicknames.
11. **[MINOR] `public/clientLobbyUi.js:843-846`** — leaving via Home while `leave-room` is rejected/ack lost — ack is discarded (`() => {}`), UI tears down while the seat stays live and the client is silently re-seated on next reconnect (prior 1.13 verified) — handle the ack/retry and mark the session home only on success.
12. **[MINOR] `public/clientLobbyUi.js:162-172,931-937`** — Quick Table — joins any open public room regardless of ruleset/board though `quickJoin` means "all-default rules" and the create fallback pins Standard-40/classic (`:674-681`) — filter candidates to Standard-40 classic or relabel the flow.

## Join matrix

| Scenario | Current behavior | Expected release behavior |
|---|---|---|
| Valid private code, open, seat free | Uppercased/stripped, seated, ack code, setup/lobby | Same |
| Lowercase / spaces / punctuation paste | Normalized both sides (`roomSetup.js:29-32`) | Same |
| Homoglyph code (O vs 0, I vs 1) | "Room not found." or different room; no aliasing | Unambiguous alphabet / alias retry |
| 7+ char paste | Silent first-6 join; warning unreachable | Warn + preserve user intent |
| Nonexistent code | "Room not found." toast → home | Copy suggests re-check; keep typed value |
| Expired invite | Accept rejects; row still listed (verified) | Filter/mark expired in listing |
| Room full | "Room is full."; Quick Table retries ×2 | Add browse/Quick Table CTA |
| Room started | "Game is already in progress."; no spectator/queue | Clear next-step copy (or spectator) |
| Owner re-enters during 10s grace | "That seat is already in use." (verified) | Reclaim if deadline passed/dead socket |
| `restore-session` with live clientId | Rebinds live seat (verified) | Reject when live on another socket |
| Auto reconnect ≤10s | `restore-session` succeeds | Same |
| Rejoin after mid-game leave | Seat gone; blocked until round end; then new seat if free; assets forfeited | Same, plus explicit confirm/state copy |
| Host leaves lobby/game | Human reassigned; bots eligible on reassign | Humans only; bot-host room recoverable |
| Last player leaves lobby | Room deleted immediately | Same |
| Last human leaves started room w/ bots | Room lingers ~10 min; if leaver owned turn, table stalls (finding 2) | Grace cleanup + turn skip |
| Leave during auction/trade | Server clears pendings/bid lead, messages table | Same |
| Second tab (guest) | Second seat, duplicate name allowed; no spectator | Copy or spectator slot |
| Cross-device (account) | Rejected while live; reclaims after 10s grace | Copy explaining takeover |
| Quick Table | Least-free-seat public open room; retry ×2; 5s timeout; else create public QUICK TABLE Standard-40 | Same (documented); ruleset filter |
| In-app invite at home | Seat taken, UI never enters, leaving forfeits (finding 1) | Enter room UI on accept |
| Invite accept while playing elsewhere | Old seat detached; stall risk (finding 2) | Clean detach + navigate |
| Invite target full/gone/started | Clear errors; invite stays pending | Consume invite on terminal outcomes |
| Code reused after destroy | Reusable instantly; invites bind by code only (finding 6) | Bind invites to room identity |
| Capacity during/after bot fill | Bots only at start; clamp correct; post-game can exceed cap (finding 5) | Enforce cap on join/endGame |
| Alone in room, connected | Never GC'd; after all humans disconnect +10 min destroyed; no lifetime copy | Same (optional "room closes in…" copy) |
