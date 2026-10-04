# In-game landscape iPad audit and planning note

Date: 2026-10-03

Status: Audit complete; recommendations are planning input and are not approved implementation requirements.

## Scope

This note covers only the live-game surface: board, top bar, player/chat rail, holdings/deals/activity rail, HUD, visibility controls, and in-game overlays. Home, room directory/setup, profile, rankings, social, and rules pages are outside scope.

The pre-round lobby and its host settings rail inside the game view are in scope. The Home Rooms directory and create/join dialogs are not. The repository does not contain the referenced layout-invariants document; design interpretation used PRODUCT.md, .ulpi/design/DESIGN.md, and the in-game UX implementation plan.

The target viewports are:

| Device profile | CSS viewport |
| --- | ---: |
| iPad Mini landscape | 1024 × 768 |
| iPad Pro 11 landscape | 1194 × 834 |

I used temporary private two-player rooms against an isolated local data directory and inspected the live Standard 40 board in Chromium. The rooms and temporary data were removed afterward. These are browser viewport captures, not Safari-on-device checks.

## Results

| Viewport | Live board | Rails | HUD | Observed state |
| --- | ---: | ---: | ---: | --- |
| 1024 × 768 | 492 px square; center column 554 px | Players/chat 188 px; right rail 246 px | 86 px, five cells in one row | Standard 40, full rails, active turn |
| 1194 × 834 | 600 px square; center column 658 px | Players/chat 210 px; right rail 286 px | 86 px, five cells in one row | Standard 40, full rails, active turn |

The document stayed at the viewport dimensions in both captures. The board remains square. Its tile-name computed size was 7 px at both widths, including on the Pro 11 capture.

At 1194 × 834 I also opened the Panels menu and tried its existing compact HUD mode. The HUD stayed 86 px high with 8 px cell padding; the mode hid the current-player note, but did not give the board more room. With Players and Right Rail hidden, Chat remained visible and the center column grew to 944 px. The board stayed capped at 600 px.

## Findings

### 1. The board size limits are lower than the available area

The tablet rule caps the board at 64dvh through 1149 px width and 72dvh from 1150 px. This gives a 492 px board at 1024 × 768 and a 600 px board at 1194 × 834, even though the center columns measure 554 px and 658 px. See the [landscape tablet layout](../../public/styles.css#L4819), [board holder sizing](../../public/styles.css#L4990), and [HUD row](../../public/styles.css#L5003).

Hiding the side rails does not increase those board caps. The grid columns collapse, but the same viewport-height cap remains in force. The current [hidden-rail rules](../../public/styles.css#L5048) therefore reclaim center-column width without enlarging the visible board.

### 2. The current compact HUD mode is not compact by height on iPad

The shared compact rules request shorter cells, but the later tablet rule fixes HUD cells and the roll button at 86 px. On these iPad sizes, compact mode mostly removes secondary text. It does not shrink the HUD strip. See the [base compact rules](../../public/styles.css#L2566) and [tablet overrides](../../public/styles.css#L5003).

### 3. The player/chat rail cannot fully disappear

The current menu allows separate Players, Chat, and Right Rail toggles. If both Players and Chat are turned off, the client forces Chat back on, so the left rail stays present. Hiding panels also leaves no edge handle at the board to reopen them; recovery is through the top-bar Panels menu. See the [visibility state logic](../../public/clientPanelMenu.js#L24) and [menu markup](../../public/index.html#L710).

The implementation plan calls for a hidden-rail edge handle and says urgent decisions stay visible, while its shipped/follow-up status notes that the handles remain a follow-up. Replacing the single top-bar Panels path with rail-edge controls would intentionally revise that earlier interaction decision. See the [panel visibility model](../plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md#L262) and [Slice 5 status](../plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md#L406).

### 4. Board text remains too small even when the board is unobstructed

Tile names clamp down to 7 px and prices to 8 px in the tablet rule. The 7 px minimum appeared in the live captures. Metro 52 has 52 spaces in a larger grid than Standard 40, so it will be denser at the same board diameter. The Metro board was source-reviewed but not opened in this temporary match. See [tablet tile sizes](../../public/styles.css#L5022) and [board variants](../../public/clientBoardData.js#L151).

## Planning direction

I recommend a board-first landscape layout with three coordinated changes:

1. Size the square board from the actual center width and remaining game height, instead of the current 64/72dvh ceiling.
2. Put a reachable chevron handle at each board-facing rail edge. Keep a visible recovery tab when a rail is closed, with an expanded state and a clear accessible name. Allow Players, Chat, and the right rail to close independently if the user chooses.
3. Fold secondary HUD information into a compact bottom strip. Keep the active turn, required action, and urgent payment/auction/bankruptcy or event warning visible while the strip is collapsed.

The current event-log, wallet, action, and modal stack can remain available. Any longer rail or modal content should scroll inside its own keyboard-reachable surface; the game document should remain fixed.

### Typography shared across both size plans

Use IBM Plex Sans for functional text and labels, and IBM Plex Mono for cash, prices, timers, and other values. IBM Plex Mono 500/600 is already bundled; IBM Plex Sans would need a local asset. Keep Pixelify Sans for the wordmark and display headings, and reserve Silkscreen for decorative accents. Preserve tabular numerals. Increasing the family readability will not by itself solve the 7 px tile-label floor.

## In-game surface coverage

The live captures covered the Standard 40 board, normal HUD, full side rails, Panels menu, compact-HUD state, hidden-rail state, Wallet, and game-over overlay. I reviewed the other popup and banner controllers from source and used retained iPad Market Desk captures from 2026-09-27 as supplemental evidence. Those retained images are older than this audit and do not prove current rendering for every overlay.

The source inventory includes purchase/auction, trade/offer, deed, financing, bank-loan, wallet/items, market, casino, bankruptcy, card, sponsorship, game-over, event banner, and log-drawer surfaces. They use viewport-fixed dialogs or in-game anchored banners with scoped scrolling; each was not replayed at both iPad dimensions.

## Open checks for a later design pass

- Capture Metro 52 at both landscape iPad widths.
- Replay purchase/auction, trade, market, casino, financing, event-warning, and log states at both widths.
- Check safe-area behavior and touch targets on iPad Safari.
- Revisit the old rule that keeps Chat open when Players is hidden, because the requested focus mode allows users to hide secondary panels.

No product code or pre-existing documents were changed; this planning note is one of two new documents.
