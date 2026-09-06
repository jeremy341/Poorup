# Client monolith (public/main.js) — remaining CodeScene violations

Regenerated after Phase 11 (commit at HEAD of branch refactor/main-monolith).
main.js score: 2.54. LOC: 3,623 (was 5,517 at Phase 5). Functions: 146 named + nested arrows (module-count flag remains until main.js < 75 functions).

Phases 6–11 completed this cycle (all new modules verified exactly 10.0, zero violations):
- `public/clientSurfaces.js` — surface/dialog controller + confirm modal (fixes `syncSurfaceA11y` cc15, `openSurface` cc12)
- `public/clientLogDrawer.js` — log drawer render/filter/toggle (10.0)
- `public/clientKeyboard.js` — window keydown controller: night-shift chords, Tab trap, ordered modal-escape gates, KEY_ACTIONS (fixes the former cc=98/23-bump handler)
- `public/clientProfileRender.js` — profile summary/statistics/history/library/account panel/guest alias/face editor renderers (fixes cc60/38/24/22/20×3/17/12 + renderGuestAliasField cond)
- `public/clientNightShift.js` — night-shift mini-game incl. visibility freeze/resume (fixes cc30/24/19/18/15/12/11/10 + missNightShiftTarget/hitNightShiftTarget conds + visibilitychange 14/3-bumps)
- `public/clientSocialSurfaces.js` — parlor toast announcer, social/rankings/rules/player surfaces (fixes renderSocialSurface cc40, announceSocialNotification cc21, playerHistoryHTML cc28, renderPlayerSurface cc23, renderRankingsSurface cc19, renderRulesSurface cc13, openRankingsSurface cc10; account/night hosts wired via `configure*`)
- `public/clientAccountIdentity.js` — achievements (grid, modal, filters, unlock) + account modal HTML/username-gate/submit, updateAccountFromResponse, logout (fixes cc34/30/30/15/13/9 + submit/checkUsername conds)
- `public/clientRailEvents.js` — #rr-body data-action dispatch tables (fixes cc36+bumps5, cc22)
- In main.js: `openProfileEditor` cc12→0, `saveProfileDesign` cc17→0, `say` cc11→0, `tone` args=5→4 (+ playSound table), `handleRestoreSessionResponse` cc15→0

## Still remaining in public/main.js (exact, CodeScene CLI)

### Bumpy Road Ahead (4)
- `sendTrade` — bumps = 2
- `bindEvents.handleRankingClick` — bumps = 2
- `bindEvents."submit"` (@3244 join-form) — bumps = 2
- `bindEvents."click"` (@3477 pl-list) — bumps = 2

### Complex Method (30)
- `renderSetup` — cc = 30
- `bindEvents."click"` (@3224 player-card) — cc = 29
- `switchRoomModalTab` — cc = 26
- `enterParlor` — cc = 24
- `openPopup` — cc = 22
- `bindEvents."click"` (@3358 rc-create-btn) — cc = 20
- `financingPreviewCopy` — cc = 20
- `bindEvents.handleSocialClick` — cc = 19
- `bindEvents."submit"` (@3244 join-form) — cc = 18
- `updateAuctionLive` — cc = 18
- `sendTrade` — cc = 17
- `renderFinancingModal."input"` — cc = 17
- `bindEvents.handleSocialSubmit` — cc = 13
- `renderTradeModal` — cc = 13
- `bindDropdowns."keydown"` — cc = 13
- `updateCreateRoomUI` — cc = 13
- `popIconHTML` — cc = 12
- `effectText` — cc = 12
- `copyRoomCode` — cc = 12
- `bindEvents.handleRankingClick` — cc = 11
- `renderHome` — cc = 11
- `"purchase-offer"` — cc = 11
- `openCardPreviewFromUrl` — cc = 10
- `"trade-offer"` — cc = 10
- `"achievement-unlocked"` — cc = 10
- `bindEvents.applySettingField` — cc = 9
- `bindEvents."click"` (@3702 rr-body deed-open) — cc = 9
- `bindEvents.syncAudioButtons` — cc = 9
- `bindEvents.handleRankingSubmit` — cc = 9
- `scheduleHomeHelicopter` — cc = 9

### Complex Conditional (13)
- `runTurn` @2028 — 3
- `endTurn` @2047 — 3
- `sendTrade` @2536 — 3
- `loadSavedGame` @2847 — 3
- `"card-reveal"` @380 — 2
- `primaryTurnAction` @2058 — 2
- `primaryTurnAction` @2059 — 2
- `updateAuctionLive` @2344 — 2
- `renderTradeModal` @2466 — 2
- `leaveRoomForHome` @3065 — 2
- `bindEvents."click"` @3230 — 2
- `bindEvents."click"` @3363 — 2
- `bindEvents.applySettingField` @3733 — 2

### Module-level
- "Number of Functions in a Single Module" (146 named + nested arrows; needs further extraction to < 75)

## Suggested next sessions (in order)
1. bindEvents handlers → data-action tables in a `clientParlorBindings.js`: player-card click (29), rc-create-btn (20), pl-list (bump), join-form submit (18+bump), handleSocialClick/Submit, handleRankingClick/Submit, applySettingField, syncAudioButtons, bindDropdowns keydown; also the second rr-body deed-open click.
2. Trade/auction/financing cluster: sendTrade (17+2+cond3), updateAuctionLive (18+cond2), renderTradeModal (13+cond2), financingPreviewCopy (20), renderFinancingModal."input" (17), openPopup (22), popIconHTML (12), effectText (12).
3. Rooms/lobby cluster: switchRoomModalTab (26), updateCreateRoomUI (13), renderSetup (30), renderHome (11), enterParlor (24 cond), loadSavedGame (cond3), leaveRoomForHome (cond2), copyRoomCode (12).
4. Turn engine conds: runTurn/endTurn/primaryTurnAction guards; socket listeners "purchase-offer"/"trade-offer"/"achievement-unlocked"/"card-reveal"; scheduleHomeHelicopter (9); openCardPreviewFromUrl (10).
