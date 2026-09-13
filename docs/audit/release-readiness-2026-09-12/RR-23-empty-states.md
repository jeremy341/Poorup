# RR-23 — Empty / Zero-State Inventory

**Audit:** Release Readiness (40-agent) · Wave 3 · Mission RR-23 · 2026-09-12
**Mode:** READ-ONLY.
**Verdict:** no BLOCKER, but fix #1–#3 before launch; they make a populated product look empty or dead.

Verified prior empties (R2 §4.3 search, §4.7 directory, §4.11 rankings, §4.20 chat) are re-confirmed. New findings flagged.

## Findings (13)

1. **[MAJOR]** `public/clientSocketListeners.js:52-61` — account-restore failure — **broken** (error is indistinguishable from empty): on any restore rejection the client silently `saveAccountSession(null)`; profile then renders guest empties ("SIGN IN TO KEEP A SERVER-SYNCED ROUND HISTORY", stats "—", friends/notifications "NO…") with zero indication the session/data failed. — Fix: keep cached session, set an `accountStale/error` flag, show "Couldn't refresh your account — retry" + retry ack in account panel/profile.
2. **[MAJOR]** `public/clientRoomsUi.js:93-97` (+ `:217-224`, `:244-249`) — directory empty — **broken** (R2 §4.7, unfixed): `renderRoomsList` has no filter/offline/error branch, so filter-to-zero, 5s timeout, and `success:false` all render "NO PUBLIC TABLES RIGHT NOW. HOST ONE OR ENTER A CODE."; `failRoomsDirectory` records no error state, only a transient toast. — Fix: branch on `roomsDirectoryLoaded`/error/filter and offer CLEAR FILTER / HOST A TABLE / RETRY.
3. **[MAJOR]** `public/clientLobbyUi.js:563-566` + `server/gameLogic.js:530-532` — lobby alone — **missing**: host seated alone with `bots:0` gets an enabled "Start Round"; there is no "waiting for players" tile and the only feedback is a chat line after clicking ("At least two players are required.", `main.js:647`). — Fix: disable start with "NEED 2+ PLAYERS — ADD BOTS OR INVITE", and render a lobby empty tile when `players.length < 2`.
4. **[MINOR]** `public/clientSocialSurfaces.js:603-620, 657-661` — rankings empties — **broken** (R2 §4.11, unfixed): signed-in unranked players see "YOUR RANK — / SIGN IN TO TRACK" (line 617); every scope (incl. friends/season) falls back to bare "NO VERIFIED PLAYERS YET." — Fix: "UNRANKED — FINISH A SERVER MATCH TO QUALIFY" and per-scope copy ("No friends ranked yet").
5. **[MINOR]** `public/clientHudRender.js:305-313` — setup-phase HUD — **broken (raw zero / prior R1 §4.10, unfixed)**: during `setup` the HUD shows "Stand By", `$0` cash, `$0` pool, and "Join a room to get started." while the setup card/lobby is configured for `$1,500` start. — Fix: setup branch using `state.settings.startingCash` + "Finish setup to enter the parlor."
6. **[MINOR]** `public/clientSocialSurfaces.js:356, 360, 369` — requests / invites / notifications — **bare**: "NO PENDING REQUESTS.", "NO ROOM INVITES.", "NO NOTIFICATIONS." (vs friends "Search by username…" and recent "COMPLETE A MATCH…" which are good). — Fix: add one next-action line each ("Request someone from FIND A PLAYER"; "Invites arrive when friends host").
7. **[MINOR]** `public/clientSocialSurfaces.js:233` — social search zero results — **broken** (R2 §4.3, unfixed): returns `""`, typo reads as dead search while rankings search (line 696) correctly says "NO EXACT USERNAME MATCH." — Fix: reuse that copy.
8. **[MINOR]** `public/clientAccountIdentity.js:117-118` (+ `:100`) — achievements filter zero — **bare**: "NO ACHIEVEMENTS IN THIS FILTER." with no clear-filter CTA, and `dateFiltered` gates on raw `Date.now()` (R3 §3.8 skew risk). — Fix: RESET FILTERS button + serverTimeOffset.
9. **[MINOR]** `public/clientSocialSurfaces.js:1152` — player-card match history scope — **bare**: "NO MATCHES IN THIS HISTORY VIEW." conflates "player has none" with "scope excludes all"; no hint history may be private. — Fix: branch copy by `history.length` and scope.
10. **[MINOR]** `public/clientLogDrawer.js:39` — log drawer — **bare**: "NO {FILTER} ENTRIES." with no explanation of when entries appear or reset-filter action. — Fix: "No entries yet — play opens the ledger" + filter reset.
11. **[MINOR]** `public/clientStateSync.js` / `public/main.js:521-531` + `public/clientLobbyUi.js:866-867` — chat body — **bare** (R2 §4.20, unfixed): `goHome` empties `state.messages`; `renderChat` writes an empty `#chat-body` with no placeholder (input placeholder only). Usually masked by boot/join system lines, but refresh-after-home can show a blank panel. — Fix: static empty line ("Table chatter appears here.").
12. **[MINOR]** `public/clientCosmetics.js:80-82` — collection empty — **broken edge**: on a signed-in, successful-but-empty catalog it renders "Sign in to earn Parlor Tokens…" to a user already signed in. — Fix: branch copy on `state.account?.account`.
13. **[MINOR]** Cross-cutting (e.g. `clientRailRender.js:536,640` sentence case vs `clientLogDrawer.js:39` / social uppercase) — tone/format — **bare**: sentence-case rail empties ("Nothing needs you.", "No live deals.") vs ALL-CAPS elsewhere; several bare states lack any CTA. — Fix: one empty-state helper (icon, title, reason, CTA) applied consistently.

## Verified good (no action)
deeds/items/wallet/deals/finance/property empties (`clientRailRender.js:202,250,272-274,295,536,640`), casino/market off (`:132,144`), "NO BIDS YET" auction, predictions quiet, profile guest/stats/designs/history (`clientProfileRender.js:278-283,442-446,509-510`), season signed-out + placement/reward empties (`clientSocialSurfaces.js:750,755`), rankings/social/season/cosmetics loading-error-stale-retry states, cosmetics locked error, default achievements grid (locked cards, never empty), night-shift "STANDBY" + gated "PATROL BEST —".

## Surface → current empty behavior → recommended copy/CTA

| Surface | Current empty behavior | Recommended copy/CTA |
|---|---|---|
| Room directory | False "NO PUBLIC TABLES…" for filter/offline/timeout | "No tables match this filter" + CLEAR FILTER; "Tables couldn't load" + RETRY; true empty keeps HOST |
| Lobby (solo host) | No message; enabled Start → chat error | "Waiting for players" tile + "ADD BOTS / INVITE", start disabled until 2+ |
| Friends | Good ("Search by username or open someone from the table") | keep |
| Requests / Invites / Notifications | Bare "NO …" | Next-action line + FIND A PLAYER link |
| Recent players | Good ("COMPLETE A MATCH…") | keep |
| Match history (own) | Good, explains server rounds + guest gate | keep |
| Player-card history | Generic "NO MATCHES IN THIS HISTORY VIEW." | "No shared matches" vs "None in this scope" + scope reset |
| Achievements (filter) | Bare, no reset, client-clock gate | RESET FILTERS + server-time filter |
| Rankings self / scope | "SIGN IN TO TRACK" for signed-in unranked; generic empty | "UNRANKED — FINISH A MATCH"; scope-specific copy |
| Profile guest / no stats / no designs | Good (gated "—", CTA hints) | keep |
| Chat | Blank body after home/re-enter | "Table chatter appears here." |
| Lobby→in-game holdings/deeds/items/deals/finance | Good, all have scope + action | keep (unify tone) |
| Bank/loans none | "NO DEBT"/"NO BANK CREDIT" fine | keep |
| Market/casino/predictions pre-activity | Good ("OFF", "NO SPIN YET", "QUIET") | keep |
| Log drawer | Bare "NO {FILTER} ENTRIES." | "Nothing logged yet" + RESET FILTER |
| Night shift / patrol | Home "STANDBY", profile gated "—" good | keep |
| Session/account restore failure | Identical to guest/no-history; silent sign-out | "Account sync failed — retry" banner; keep cached data |
| Cross-cutting tone | Mixed casing, inconsistent CTA presence | Shared empty-state component (title/reason/CTA) |
