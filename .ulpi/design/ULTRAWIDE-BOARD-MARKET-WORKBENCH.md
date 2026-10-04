# Board Stage and Market Workbench

**Status:** Implemented; its 3440×1440 support claim was retired on 2026-10-04. Retained as the design record for the supported 2560×1440 and 3840×2160 wide-desktop layouts.

**Support-policy update:** Desktop 3440×1440 is no longer a supported target. Its historical screenshots remain available as archive evidence, while future tests and captures use the six supported desktop profiles listed below.

## Design read

**Design read:** The board should read as a playable tabletop at every supported size. On wide displays, use the extra width to give the board a deliberate stage and keep the surrounding game controls close to it.

**Aesthetic direction:** Retro-futuristic, grounded in Poorup's existing After-hours Game Parlor identity: dark teal surfaces, gold board framing, pixel display type, and concise terminal-like controls. This is a composition change inside the current identity, not a new visual language.

**Product register:** Product UI, where readability and the next legal game action take priority over decoration.

**Identity lock:** Every screen must read as the same product if placed side by side.

## Sources and scope

- Bind to [DESIGN.md](DESIGN.md) and [PRODUCT.md](../../PRODUCT.md). `LAYOUT-INVARIANTS.md` is absent; use those files and the live CSS rules as the current design context.
- Keep the existing Poorup palette, typography, 2–3px corner radii, border hierarchy, pixel assets, keyboard behavior, and server-authoritative market/game contracts.
- Change only the in-game board/HUD composition and the in-game Market Desk presentation.
- Desktop visual support starts at 1440×900. Supported gallery profiles are 1440×900, 1536×900, 1600×900, 1920×1080, 2560×1440, and 3840×2160. Exclude desktop 1366×768, 1280×720, and the retired 3440×1440 ultrawide profile.
- Include every existing landscape iPad profile: 944×656, 1024×768, 1080×810, 1180×820, 1194×834, and 1366×1024. Phone and portrait iPad layouts are outside this work.
- The supplied 4K gallery capture and existing captures below are the incumbent visual evidence, not new design references.

## Evidence and problem statement

The archived 3440×1440 capture showed a vertically elongated board stage. In the desktop CSS, the holder was set to fill the board area's height, while the 2200px+ rule capped its width. Those independent constraints could defeat the square aspect ratio. Treat that screenshot as historical evidence only; the supported large-desktop checks are 2560×1440 and 3840×2160.

At 1440×900, the board is square but visibly small. The current HUD breaks into tall cards below it and consumes the height that could otherwise support a larger board.

The Market Desk uses a fixed 1120px maximum width and keeps its sector strip, market detail, chart, and order ticket in a similar structure across viewports. On iPad, the stacked information requires substantial internal scrolling. At 4K, the same maximum width leaves a lot of the available work area unused.

Incumbent captures:

- [Ultrawide Metro 52 board, 3840×2160](../../qa-artifacts/visual-captures/2026-10-03T20-04-42-411Z/desktop-3840x2160/game/board-metro-52.png)
- [1440×900 Standard 40 board](../../qa-artifacts/visual-captures/2026-10-03T20-04-42-411Z/desktop-1440x900/game/board-standard-40.png)
- [iPad Pro Market Desk, 1194×834](../../qa-artifacts/visual-captures/2026-10-03T20-04-42-411Z/ipad-1194x834/game/market-desk.png)

## Board and HUD plan

### Shared sizing rule

- Give Standard 40 and Metro 52 a square outer stage. Calculate its size from the smaller of the center area's available width, available height after the HUD, and a deliberate upper cap.
- Remove the desktop combination that fills height independently from capped width. Do not change tile proportions or board topology to make the stage appear larger.
- Keep the board as the visual anchor. Use available space around it for the existing rails and HUD rather than stretching tiles or centering a small board in a very large blank region.

### Desktop at 1440×900 and nearby supported sizes

- Keep player/chat and holdings rails available.
- Replace the tall multi-row HUD with one compact lower action strip. Keep current player/turn, cash, and the primary legal action visible. Present dice and pool context compactly; preserve any action-required warning in the strip until resolved.
- Let the board use the height reclaimed from the HUD. Target the largest square that fits the remaining center area, rather than assigning a fixed board dimension.
- At 1440×900, the acceptance target is a board materially larger than the current capture, with no overlap between tiles, board frame, HUD, and rails.
- The desktop HUD is a single 96px action strip at supported desktop widths. It keeps current player/turn, cash, dice, pool, and Roll visible. Jail and loan actions expand the turn cell when needed.

### Wide desktop at 2200px and above

- Use a centered three-zone composition: player/chat rail, square board stage with its compact HUD, and holdings/deals rail.
- Replace the current 520px fixed side tracks with content-sized rails capped to readable widths. Keep them adjacent to the board stage inside one centered game composition.
- Cap the rails responsively between 320px and 420px. Center the overall game shell and size its width from the board cap plus both rails so the rails do not sit at the screen edges with a large empty moat around the board.
- Allow the square stage to grow with available height and center width, up to 1600px. The board itself remains constrained by both center width and height.
- Preserve balanced outer margins. Do not fill ultrawide space with decorative panels or duplicate information just to consume width.

### Landscape iPad

- Preserve the liked iPad Pro layout, the current no-arrow treatment, visible player and holdings rails, and the existing top controls.
- Continue sizing the square board against the actual center area and safe insets. Adjust rail widths only where needed to protect readable rail content and leave more usable center width.
- Keep the current turn and required action visible. Do not introduce a new default rail-collapse mode in this work.

## Market Desk plan

### Information model

Keep one Market Desk with these four jobs in this order:

1. Choose a sector and identify the shared current quote, round, and event context.
2. Review the price history and the player's units, average cost, and realized/unrealized P&L.
3. Choose buy or sell and units, then review gross amount, fee, and total cash impact.
4. Submit the order and see a pending, settled, or rejected result from the authoritative server response.

Keep margin, short, and derivative controls in a collapsed Advanced section. Preserve existing server restrictions, quote sources, order calculations, and Socket.IO contracts.

### Responsive compositions

| Surface | Composition |
|---|---|
| 1920px desktop and wider | Market workbench up to 1760px wide. A compact vertical sector watchlist sits beside quote/history/position details; the trade ticket stays in a separate persistent column. |
| 1440–1919px desktop | Two primary columns: quote/history/position details and a persistent trade ticket. Keep sector selection in a compact horizontal selector above both columns. |
| Landscape iPad | Near-full-screen workbench with a compact quote header and two clear views, **Overview** and **Trade**. Overview prioritizes sector choice, price history, and position summary. Trade keeps the selected quote visible with order inputs, cost preview, and primary action together. The Trade view includes a direct path back to sector selection. Use a sticky action region and internal scrolling. |

The Market Desk should be sized to the viewport, with a wider maximum than the current 1120px. Keep a safe edge margin on desktop and respect iPad safe areas. The header and primary order action remain reachable while the workbench's content scrolls internally; the document itself does not scroll.

### Components

- **Workbench header:** Market Desk title, concise status/context, and close action.
- **Sector selector:** Clear selected state and keyboard/touch navigation across every available index. Avoid trapping later sectors in a clipped strip.
- **Quote summary:** Selected sector, current price, change from prior round, and event marker where present.
- **Position summary:** Units, average cost, unrealized P&L, and realized P&L. Use tabular numeric alignment and labels in addition to color.
- **History panel:** Price history with chart-range control. Include an equivalent concise textual summary for assistive technology.
- **Trade ticket:** Buy/sell, units, available cash, full fee/cost preview, server-settlement status, and one primary submit action.
- **Advanced disclosure:** Existing advanced fields, server capability/restriction explanation, and validation messages.

Avoid nested cards. Use Poorup's existing ruled panels and borders to group information; reserve the red primary control for the order action.

## Flows and states

### Review and place an order

Open the Market Desk → choose a sector → inspect quote and position → choose Overview or Trade as appropriate → choose buy/sell and units → review gross, fee, total, and cash → submit → display the server's settled or rejected result.

Closing the desk returns to the same in-game state. Closing never submits an order. Do not create a client-only success state.

### Required states

- Initial/loading quote and order capability.
- No quote/history yet, including a new round with one data point.
- No personal position and populated position.
- Buy and sell previews with valid, invalid, and insufficient-cash quantities.
- Existing obligation blocks an order; show the actual reason and keep the order disabled.
- Submission in progress, settled response, server rejection, and connection failure/retry.
- Advanced feature unavailable under current server rules.
- Long sector labels, long numbers, and large text at 200% zoom.

## Accessibility and interaction

- Keep all controls native and keyboard reachable. On open, focus the heading or first useful control; trap focus while modal, restore focus on close, and support Escape where current modal rules allow.
- Give sector navigation, view selection, and the Advanced disclosure visible focus and explicit selected/expanded states.
- Use touch targets of at least 44px on iPad. Respect safe-area insets.
- Make movement, P&L, selection, and order status understandable without color alone.
- Honor reduced motion and forced colors. Do not add motion solely for decoration.
- Preserve internal scrolling and show a visible overflow cue where content continues. Confirm no document/body scroll.

## Build and verification handoff

This approved document is the implementation brief. No unrelated UI or market/game behavior is in scope.

Implementation owner: Poorup frontend owner working in the existing vanilla HTML/CSS/JavaScript client. Read `poorup-frontend` and `poorup-code-quality`; keep server behavior and market contracts unchanged. Treat this document as the build brief, not as permission to rewrite unrelated UI.

Acceptance checks:

- Board stage remains square within 1% width/height difference at every supported profile, for Standard 40 and Metro 52.
- At 1440×900, the compact HUD frees center height and the board is plainly larger than the incumbent 1440 capture without obscuring a required action.
- At supported wide-desktop profiles, board and rails form a balanced centered composition; the rail-to-board gaps remain at or below 250px, with no tall/narrow board.
- iPad Pro keeps its accepted no-arrow layout, visible rails, and reachable current action.
- Market sector choice, quote, position, chart, order preview, and submission result remain available across all supported profiles without clipped controls.
- Loading, empty, blocked, rejected, and settled states are captured and checked.
- Keyboard focus, iPad touch targets, safe areas, 200% zoom, forced colors, reduced motion, and no document scrolling are verified.
- Use the screenshot gallery runner for 1440×900, 1536×900, 1600×900, 1920×1080, 2560×1440, 3840×2160, plus all six landscape iPad profiles listed above. Do not include 3440×1440.

## Preflight status

- **Identity:** Bound to the existing locked Poorup design system; no new palette, type, radius, or component vocabulary is proposed.
- **Anti-slop:** Uses a task-specific board stage and information workbench; no gradients, nested cards, decorative fill panels, or invented market metrics.
- **State and accessibility:** Loading/empty/history states, index selection, iPad view switching, keyboard selection, 44px iPad Close/Change Index targets, modal safe-area bounds, and no-document-scroll bounds were covered by browser checks. Playwright used reduced motion and a half-size layout viewport stress check. Native browser zoom, non-zero device safe-area values, forced-colors rendering, and screen-reader behavior were not separately exercised.
- **Layout:** Board sizing is bound to the available center width and height. Desktop HUD is a 96px row at 1440×900; ultrawide uses responsive 320–420px rails in a centered shell, with a 1600px board cap. Market Desk uses a maximum 1760px workbench, a three-column wide-desktop view, a two-column 1440–1919px view, and Overview/Trade views on landscape iPad.
- **Review gate:** Approved by the user on 2026-10-04. Implementation and final screenshot matrix completed.

## Implementation record

- Board stage and HUD sizing are implemented in `public/styles.css`.
- Market Desk layout and Overview/Trade view state are implemented in `public/styles.css` and `public/clientMarketUi.js`.
- The release-surface capture switches to Trade on iPad before capturing order controls.
- Market and board browser checks: 78 passed, 13 skipped across the 13 supported profiles. The skips are the desktop-only board test on iPad and the iPad-only chart-range check on desktop.
- Initial game capture matrix before the 3440×1440 retirement: 39 flows passed; 871/871 screenshots, 0 missing, 0 duplicates, 0 failures across 13 profiles. These images remain historical archive evidence.
- Final gallery: [all supported game screenshots](../../qa-artifacts/visual-captures/2026-10-04T08-02-26-526Z/index.html).
- Post-review iPad Pro refresh after the 44px/safe-area fix: [1194×834 game screenshots](../../qa-artifacts/visual-captures/2026-10-04T08-43-36-526Z/index.html), 67/67 captured with no missing or duplicate images.

## Supported-matrix refresh on 2026-10-04

- The regular Playwright projects and screenshot runner now share the same 12 supported profiles: six desktop targets from 1440×900 through 3840×2160, plus all six landscape iPad profiles. 1366×768, 1280×720, portrait iPad, phone, and 3440×1440 are excluded from the supported matrix.
- The iPad board sizing now uses the actual board-area container height as well as its width, keeping the square stage intact below the taller compact HUD. Landscape iPad rail tracks are 164/220px below 1100px and 184/250px at Pro widths; the dice are 42px and ownership avatar pips are larger.
- The initial gallery used a sector dropdown below 1920px and a vertical watchlist at 1920px and above. That first implementation was later replaced after the user requested a more compact Market Desk across all supported sizes.
- Dice totals arrive from an additive server snapshot sequence and appear as a brief white pixel-style number with the active theme glow. Replayed snapshots and initial/reconnect snapshots do not replay an old total.
- The refreshed full gallery passed 96 Playwright flows and captured 1128/1128 screenshots across the 12 supported profiles, with 0 missing, duplicate, or failed captures: [current full gallery](../../qa-artifacts/visual-captures/2026-10-04T10-22-54-588Z/index.html).

## Compact Market Desk update on 2026-10-04

- Supersedes the earlier Market Desk width and navigation details above. One sector dropdown is available on every supported profile. Desktop uses a two-column quote/history and trade-ticket workbench capped at 1320px; landscape iPad uses a maximum 980px modal with Overview and Trade views.
- Quote, movement, event context, holdings/P&L, chart range/history, order quantity, quote/gross/fee/total, advanced controls, and server-settlement status remain in the workbench.
- The final Market Desk capture run passed 12 viewport flows and captured 24/24 Overview/Trade screenshots with no missing, duplicate, or failed captures: [compact Market Desk gallery](../../qa-artifacts/visual-captures/2026-10-04-market-desk-compact-v2/index.html).
