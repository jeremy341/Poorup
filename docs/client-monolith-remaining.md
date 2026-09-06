# Client monolith (public/main.js) — remaining CodeScene violations

Generated after Phase 5 (commit 15c7730). Score: 1.59. LOC: 5,517.

All new public/client*.js modules score exactly 10.0 (zero violations).
Follow-up phases: profile/social renderers, night-shift mini-game, account modal, event-binding (keydown/click), trading/auction/parlor UI.

## Bumpy Road Ahead (11)
- `bindEvents."keydown"` — bumps = 23
- `bindEvents."click"` — bumps = 5
- `openAccountModal."submit"` — bumps = 3
- `"visibilitychange"` — bumps = 3
- `say` — bumps = 2
- `hitNightShiftTarget` — bumps = 2
- `saveProfileDesign` — bumps = 2
- `sendTrade` — bumps = 2
- `bindEvents.handleRankingClick` — bumps = 2
- `bindEvents."submit"` — bumps = 2
- `bindEvents."click"` — bumps = 2

## Complex Method (69)
- `bindEvents."keydown"` — cc = 98
- `renderProfileStatistics` — cc = 60
- `renderSocialSurface` — cc = 40
- `renderProfileSummary` — cc = 38
- `bindEvents."click"` — cc = 36
- `renderAchievements` — cc = 34
- `renderSetup` — cc = 30
- `spawnNightShiftTarget` — cc = 30
- `openAccountModal."submit"` — cc = 30
- `accountModalHTML` — cc = 30
- `bindEvents."click"` — cc = 29
- `playerHistoryHTML` — cc = 28
- `switchRoomModalTab` — cc = 26
- `enterParlor` — cc = 24
- `hitNightShiftTarget` — cc = 24
- `profileDisplaySource` — cc = 24
- `renderPlayerSurface` — cc = 23
- `bindEvents."submit"` — cc = 22
- `openPopup` — cc = 22
- `profileHistoryRowHTML` — cc = 22
- `announceSocialNotification` — cc = 21
- `bindEvents."click"` — cc = 20
- `financingPreviewCopy` — cc = 20
- `applyProfileToHomeUI` — cc = 20
- `renderProfileLibrary` — cc = 20
- `renderAccountPanel` — cc = 20
- `bindEvents.handleSocialClick` — cc = 19
- `spawnNightShiftEffect` — cc = 19
- `renderRankingsSurface` — cc = 19
- `bindEvents."submit"` — cc = 18
- `updateAuctionLive` — cc = 18
- `submitNightShiftRun` — cc = 18
- `sendTrade` — cc = 17
- `saveProfileDesign` — cc = 17
- `renderFinancingModal."input"` — cc = 17
- `handleRestoreSessionResponse` — cc = 15
- `renderNightShiftHud` — cc = 15
- `openAchievementModal` — cc = 15
- `syncSurfaceA11y` — cc = 15
- `"visibilitychange"` — cc = 14
- `bindEvents.handleSocialSubmit` — cc = 13
- `renderTradeModal` — cc = 13
- `bindDropdowns."keydown"` — cc = 13
- `updateCreateRoomUI` — cc = 13
- `renderRulesSurface` — cc = 13
- `openAccountModal.checkUsername` — cc = 13
- `popIconHTML` — cc = 12
- `effectText` — cc = 12
- `openProfileEditor` — cc = 12
- `copyRoomCode` — cc = 12
- `startNightShift` — cc = 12
- `renderProfileHistory` — cc = 12
- `openSurface` — cc = 12
- `bindEvents.handleRankingClick` — cc = 11
- `renderHome` — cc = 11
- `scheduleNightShiftTarget` — cc = 11
- `say` — cc = 11
- `"purchase-offer"` — cc = 11
- `openCardPreviewFromUrl` — cc = 10
- `endNightShift` — cc = 10
- `openRankingsSurface` — cc = 10
- `"trade-offer"` — cc = 10
- `"achievement-unlocked"` — cc = 10
- `bindEvents.applySettingField` — cc = 9
- `bindEvents."click"` — cc = 9
- `bindEvents.syncAudioButtons` — cc = 9
- `bindEvents.handleRankingSubmit` — cc = 9
- `scheduleHomeHelicopter` — cc = 9
- `updateAccountFromResponse` — cc = 9

## Complex Conditional (24)
- `bindEvents."keydown":5703` — 9 complex conditional expressions
- `bindEvents."keydown":5712` — 9 complex conditional expressions
- `hitNightShiftTarget:2101` — 3 complex conditional expressions
- `runTurn:3761` — 3 complex conditional expressions
- `endTurn:3780` — 3 complex conditional expressions
- `sendTrade:4269` — 3 complex conditional expressions
- `loadSavedGame:4580` — 3 complex conditional expressions
- `"card-reveal":433` — 2 complex conditional expressions
- `say:460` — 2 complex conditional expressions
- `openAccountModal.checkUsername:952` — 2 complex conditional expressions
- `openAccountModal."submit":1022` — 2 complex conditional expressions
- `renderNightShiftHud:1259` — 2 complex conditional expressions
- `missNightShiftTarget:2037` — 2 complex conditional expressions
- `renderGuestAliasField:2595` — 2 complex conditional expressions
- `primaryTurnAction:3791` — 2 complex conditional expressions
- `primaryTurnAction:3792` — 2 complex conditional expressions
- `updateAuctionLive:4077` — 2 complex conditional expressions
- `renderTradeModal:4199` — 2 complex conditional expressions
- `leaveRoomForHome:4789` — 2 complex conditional expressions
- `bindEvents."click":4954` — 2 complex conditional expressions
- `bindEvents."click":5087` — 2 complex conditional expressions
- `bindEvents.applySettingField:5487` — 2 complex conditional expressions
- `bindEvents."keydown":5781` — 2 complex conditional expressions
- `bindEvents."keydown":5785` — 2 complex conditional expressions

## Excess Number of Function Arguments (1)
- `tone` — Arguments = 5
