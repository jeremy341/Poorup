# Client monolith (public/main.js) — remaining CodeScene violations

Regenerated after Phase 19 (HEAD of branch `refactor/main-monolith`).
main.js score: **4.14** (was 2.54 at Phase 11 start). LOC: **2,515** (was 3,623).
Top-level `function` decls: **101** (was 146); CodeScene's total-function module flag
remains until the rooms/lobby + turn + socket clusters are extracted (needs < 75).

Phases landed this cycle (each new module verified exactly 10.0, zero violations;
every extracted function's markup/emit-names/payloads moved verbatim):

- `public/clientPopupUi.js` — tile popup (`openPopup` cc22→decomposed, `closePopup`,
  `onTileClick`) + shared render helpers (`kindLabel`, `accentOf`, `popIconHTML` cc12,
  `effectText` cc12, `popRow`, `rentScheduleHTML`) reused by the deed/choice/auction cards.
  host = `configurePopup({ buyTile, record })`.
- `public/clientTradeUi.js` — parlor dropdown widget (`dropdownHTML`, `bindDropdowns`
  keydown cc13→table dispatch), the loan/equity/hybrid financing modal
  (`financingPreviewCopy` cc20→per-mode builders, `renderFinancingModal` input cc17→
  named handlers) and the trade-proposer modal (`sendTrade` cc17+cond→guards+action
  table, `renderTradeModal` cc13→`tradeModalHTML`/`tradeSideHTML`/`wireTradeModal`).
  host = `configureTradeUi({ emitServer, say, renderChat, record })`. `clamp` hoisted to `clientDom.js`.
- `public/clientParlorBindings.js` — rankings/social/player-card click+submit handlers
  (both in-game modal + full-page variants) + profile player-list click.
  `handleSocialClick` cc19→`SOCIAL_CLICKS` dispatch table; `player-card` cc29→guards +
  `PLAYER_ACTIONS` table (kills the 3-operator `!action||disabled||!selected` guard);
  rankings split into per-branch helpers. host = `bindParlorSurfaces({ emitServer, leaveRoomForHome })`.
- `public/clientHomeAmbient.js` — parlor-patrol helicopter easter egg + home local-time
  clock + patrol SFX. `scheduleHomeHelicopter` cc9→`launch/end/…` named timer steps.
  Exports the controls the night-shift host and home nav consume.
- `public/clientAuctionUi.js` — live auction bidding UI (`updateAuctionLive` cc18+cond→
  per-element renderers + `auctionPlayerBroke` sequential guards; `renderAuction` markup
  verbatim; `startAuction`/`humanBid`/`humanPassAuction`/`tickAuction`; owns the interval).
  host = `configureAuctionUi({ emitServer, say, renderChat })`. Timer surfaced via
  `startAuctionTimer`/`stopAuctionTimer` (socket `openAuctionSurface`/`closeAuctionSurface`
  + navigation rewired). Reuses `clientPopupUi` helpers.
- `public/clientHomeEntryBindings.js` — join-a-table submit (`cc18`+bumpy→`resolveJoinCode`
  /`resolveJoinNickname` sequential guards), room-code/nickname sanitising inputs, guest-alias
  editor. host = `bindHomeEntry({ closeRoomsModal, enterParlor })`.
- `public/clientAudioControls.js` — global effects/music toggles (`syncAudioButtons` cc9→
  `paintAudioButton` over SOUND/MUSIC id tables; per-view buttons proxy via `proxyTo`).
  host = `bindAudioControls({ playSound, syncHomeMusic })`.
- `public/clientRoomShare.js` — `copyRoomCode` cc12→`clipboardCopy`/`legacyCopy`/`announceRoomCopy`.

## Still remaining in public/main.js (exact, CodeScene CLI)

### Bumpy Road Ahead (1)
- `bindEvents."click"` (@2336 profile `#pl-list` delete/edit/select) — bumps = 2

### Complex Method (12)
- `renderSetup` (@1051) — cc = 30   [setup overlay renderer; big template + appearance grid]
- `switchRoomModalTab` (@673) — cc = 26
- `enterParlor` (@1961) — cc = 24   [room/quick join; heavy socket + view wiring]
- `bindEvents."click"` (@2217 `#rc-create-btn`) — cc = 20   [needs createRoomSettings]
- `updateCreateRoomUI` (@651) — cc = 13   [owns createRoomSettings]
- `renderHome` (@769) — cc = 11
- `"purchase-offer"` (@408 socket listener) — cc = 11
- `openCardPreviewFromUrl` (@2668) — cc = 10   [standalone dev preview; host=openCardReveal/openCardGallery]
- `"trade-offer"` (@420 socket listener) — cc = 10
- `"achievement-unlocked"` (@365 socket listener) — cc = 10
- `bindEvents.applySettingField` (@2542 lobby settings) — cc = 9
- `bindEvents."click"` (@2513 `#rr-body` deed-open) — cc = 9

### Complex Conditional (9)
- `runTurn` @1447 — 3 (`phase!=="playing"||turnIndex!==idx||busy||stage!=="roll"`)
- `endTurn` @1466 — 3
- `loadSavedGame` @1868 — 3
- `primaryTurnAction` @1477 — 2
- `primaryTurnAction` @1478 — 2
- `"card-reveal"` @416 — 2
- `leaveRoomForHome` @2086 — 2
- `bindEvents."click"` @2222 (`#rc-create-btn` guard) — 2
- `bindEvents.applySettingField` @2544 — 2

## Suggested next sessions (in order)
1. **Rooms/lobby cluster → `clientLobbyUi.js`** (biggest remaining size + method win, but
   it is a knot: `createRoomSettings`/`roomsFilter`/`roomsDirectory` are shared mutable state
   read by `renderRoomsList`/`filteredRooms`/`updateCreateRoomUI`/`openRoomsModal` AND written
   by the `#rm-tabs`/`#rooms-list`/`#rc-*` bindEvents handlers, and navigation
   (`enterParlor`↔`buildPlayers`/`showView`/`renderSetup`/`renderLobbyRail`/`syncServerAppearance`)
   reaches `clientSocialSurfaces`/socket hosts. Extract the renderers + bindings + navigation
   TOGETHER (own the room state inside the module) so no mutable object is split across files;
   `showView` is injected into many hosts today, so keep it in main and pass it as a hook.
   Decompose `renderSetup`(30), `switchRoomModalTab`(26), `enterParlor`(24),
   `updateCreateRoomUI`(13), `renderHome`(11), `#rc-create-btn`(20) with the table/guard idiom.
2. **Turn engine → `clientTurnFlow.js`** + socket listeners → `clientSocketListeners.js`:
   the `runTurn`/`endTurn`/`primaryTurnAction`/`loadSavedGame`/`leaveRoomForHome` 3-operator
   guards (extract a boolean predicate fn so the `&&`/`||` chain is a RETURN, not a branch
   condition), and the `"purchase-offer"`/`"trade-offer"`/`"achievement-unlocked"`/`"card-reveal"`
   socket handlers (large host surface: applyServerState/serverSyncHost/renderAll/say/renderChat/
   openChoiceModal/openOfferModal/showGameOver/playSound/unlockAchievement…).
3. **Leftovers:** `bindEvents.applySettingField` + lobby-settings/`#su-*` click handlers
   (host: `updateServerSetting`, `renderLobbyRail`), the `#rr-body` deed-open click, and the
   `#pl-list` bumpy handler (host: `openConfirmModal`, `deleteCurrentProfile`, …);
   `openCardPreviewFromUrl` (small, host = `openCardReveal`/`openCardGallery`).
