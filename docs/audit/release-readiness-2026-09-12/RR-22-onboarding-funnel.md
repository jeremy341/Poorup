# RR-22 — Onboarding Funnel Friction

**Audit:** Release Readiness (40-agent) · Wave 3 · Mission RR-22 · 2026-09-12
**Skills:** cRo + impeccable lenses. Product principles (PRODUCT.md): "next legal action always obvious", "enter a room without an account or unnecessary ceremony".

All evidence gathered; read-only respected — no files touched. Prior audit confirms Quick Table's join-then-host behavior but contains no onboarding-funnel scoring, so these findings are new.

## Findings (15)

1. `[BLOCKER]` `server/gameLogic.js:530` + `public/clientLobbyUi.js:563-571` — host can press "Start Round" with 1 player; failure returns `"At least two players are required."` via `reportChatError` → chat only (`main.js:689-697`), button stays enabled and label unchanged — **Start gate** — disable Start until 2 connected players and surface an inline "1 more player — add a bot" helper; Quick Table should seat 1 bot by default.
2. `[BLOCKER]` `public/clientLobbyUi.js:670-683` — Quick Table fallback creates a public room with `bots` unset (default 0, `server/roomSettings.js:23`) and no share code; first player reaches a lobby that cannot start, cannot be invited — **Quick Table → Lobby** — reserve one bot on fallback create, or offer "Play solo vs CPU" as the visible primary action.
3. `[MAJOR]` `public/clientRoomsUi.js:436-440` — missing alias closes the Create Room modal and bounces to home, discarding name/visibility/preset in progress; user must reopen and redo — **Mode choice → Create** — validate alias inline (or auto-generate `guest_####`) without destroying form state.
4. `[MAJOR]` `public/clientProfileRender.js:641-648` + `clientSanitize.js:152-158` — new visitor has no alias default (static mock even shows `guest_4412`, `index.html:175`), yet alias is required before Quick Table/Create/Room entry (`clientLobbyUi.js:808,834,1074`) — **Land → Create alias** — generate a default alias on first visit and make it editable later; remove the pre-gameplay requirement.
5. `[MAJOR]` `public/clientTopNavRender.js:91-98` + `clientRoomShare.js:45` — public rooms disable the only share/copy affordance ("Public room"); no invite CTA exists in the lobby, and Social invites are account-gated (`clientSocialSurfaces.js:334-344`) — **Lobby waiting** — add a lobby invite/share block (code for private, directory hint/link for public) and a "waiting 1/2 players" status.
6. `[MAJOR]` `public/clientGameModalsUi.js:240-249` — "Rematch" is shown to non-hosts; click closes the modal and the rejection `"Only the host can start the game."` lands in chat only; "Back to Lobby" actually calls `goHome()` (releases seat) — **Game over** — gate/hide Rematch by `isHost`, relabel the exit "Leave table", show the win reason ("last player standing").
7. `[MINOR]` `public/index.html:168` vs `public/clientKeyboard.js:273` — the Quick Table button advertises `[ C ]` but C opens the Create Room modal; no shortcut exists for Quick Table — **Mode choice** — bind C to Quick Table and move Create to `[N]`, or delete the hint.
8. `[MINOR]` `public/clientLobbyUi.js:520` — the one setting a solo player needs ("Bots", 6th row inside Table Rules) is below the fold under a 20+ control rail with no "needed to start" marker and no bot seat preview until start — **Lobby settings** — pin a "Players & Seats" block first with a `+ CPU` button and start-readiness copy.
9. `[MINOR]` `public/clientHudRender.js:41-56` — lobby HUD says "Set rules on the right, then press Start Round" for everyone, while guests see a disabled "Host Starts Round" — **Lobby waiting** — branch copy by host status; for guests show "Waiting for host to start".
10. `[MINOR]` `public/clientGameModalsUi.js:215` — winner crown keyed on `p.id === winnerId`, but the local player's id is remapped to `"p1"` (`clientStateSync.js:45-48`), so a local win can crown the asset-leader row instead (or double-crown) — **Game over** — match on `p.serverId === winnerId`.
11. `[MINOR]` `public/clientHudRender.js:305-309` — no hint during the roll stage (note only appears at end-turn); Space/R shortcuts (`clientKeyboard.js:287-293`) are undiscovered — **First turn** — show "Roll to move; landing on a lot opens Buy/Pass" on the first human turn.
12. `[MINOR]` `public/index.html:691` + `clientLobbyUi.js:832-841` — setup overlay forces "Enter Parlor" every entry even when copy says "Your active design is ready… Change it only if you want" — **Setup gate** — auto-enter lobby when the active design is accepted; keep editing behind "Change look".
13. `[MINOR]` `public/clientGameModalsUi.js:225-238` — no account nudge after a win/loss; guest stats/achievements stay local (`index.html:393`) with no save prompt — **Account nudge** — add optional "Create an account to keep this win" on the game-over card; keep skip as primary path.
14. `[MINOR]` `public/clientLobbyUi.js:511-548` — first-timer default exposure includes "BANKRUPTCY: ELIMINATE", "BANK LOANS: on · LOAN SEVERITY: PREDATORY", casino/market/margin — no "recommended for a first game" marker beyond the preset select — **Lobby settings** — collapse advanced systems behind "Show advanced rules"; badge the recommended preset.
15. `[MINOR]` `public/index.html:168` — Quick Table tooltip says "Create a default-rules room" but it auto-joins an open public room first (`clientLobbyUi.js:685-709`) — **Mode choice** — fix tooltip to "Find an open public table or host one".

## Funnel map

| Step | Interactions (solo, fastest path) | Drop-off risk |
|---|---|---|
| Land | 0 (COPY-heavy; alias form under CTAs) | Low |
| Create alias | 1 field, no default, 12-char cap | Med — ceremony before play; create modal bounce |
| Choose mode | 1 click (Quick Table / Create / Join) | Med — [C] misroute; tooltip wrong |
| Room entry | 0–1 click (directory lookup, up to 5s; fallback create) | Low–Med |
| Setup overlay | 1 click "Enter Parlor" | Low |
| Lobby wait | 0; hidden +bot = 1 click; Start fails once = 1 wasted click | **High — no invite, no seat fill, chat-only error** |
| Start gate | 2 connected players incl. bots required (`gameLogic.js:530`) | **High — nothing on screen says this** |
| First turn | 1 roll + 1 buy/pass modal click; no contextual hint | Low–Med |
| Loss/win | Rematch (host-gated by server, not UI) or leave | Med — silent rematch fail; "Back to Lobby" exits |
| Account nudge | passive only (home ENTRY signal, profile tab) | Low — optional, but post-game save never offered |

Fastest full path: 1 typed alias + 6 clicks (Quick Table, Enter Parlor, Start-fail, bots +, Start, Roll) before the first move, with one dead-end click and a scroll to find the Bots stepper.
