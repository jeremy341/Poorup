# 2560×1440 Sidebar and Modal Scale Plan

**Status:** Implemented and visually verified on 2026-10-04.
**Target:** Supported desktop profile `desktop-2560x1440`.
**Preserve:** Current board size, centered board position, and the HUD directly below it.

## User goal

The 2560×1440 capture felt underscaled around the board: player/chat and holdings rails were narrow, and modal contents did not use enough of the available screen. The implementation widens the rails and scales in-game modal content while keeping the board and its lower HUD at their captured dimensions.

## Current layout evidence

- Before the tier change, the 2200px+ game rule resolved both rails to 320px at 2560px. The board measured 1240×1240px, centered at x=660, y=80. The HUD measured 1288×96px at x=636, y=1330.
- The wide-desktop shell derives its width from a height-limited board cap plus both rails. Its 96px HUD sits below the square board.
- The generic popup card caps at 440px. Dense modal families set their own limits: deed detail 520px, bank credit 520px, casino 560px, wallet 680px, and the Market Desk 1760px. A single global popup width would make these distinct jobs less usable.

## Implemented changes

### Wider game rails

- Added a 2400–3199px desktop tier so the 2560 layout grows without changing the 3840×2160 tier.
- Expanded the game shell to the viewport width with equal flexible side tracks. At 2560×1440 each rail now measures 604px and sits 14px from its screen edge. Browser measurements confirm the centered board remains 1240×1240px at x=660, y=80 and the HUD remains 1288×96px at x=636, y=1330.
- Rail content uses the added width; existing panel hierarchy, text wrapping, chat, holdings tabs, and internal scrolling remain functional.

### Larger modal presentation

- Use family-specific width, type, spacing, and control adjustments for the 2560 tier. The implementation does not zoom or transform entire dialogs and does not use one maximum width for every modal.
- Widened dense surfaces: Market Desk to 1500px, Wallet to 760px, Casino to 680px, Trade to 740px, Finance to 800px, Funding to 720px, and Account to 560px. Increased modal body/label type from 9–16px to 10–18px where those roles occur, and modal controls to 48px minimum height. The 2560 rules target the actual modal containers, which are siblings of the game view in the production DOM.
- Expanded compact choice/deed surfaces to 520–600px and the card gallery to 1400px while preserving their action hierarchy and internal scrolling.
- Kept the in-game player card at 480px maximum width.
- Preserved Poorup's current typography tokens, pixel visual system, theme colors, borders, and modal focus/scroll behavior.

## Verification plan

- Captured the 2560×1440 baseline first, then captured every unique in-game modal family after the change.
- Compared the board and HUD bounds before and after; their width, height, and relative placement are unchanged within one CSS pixel.
- Checked rail widths, wrapped text, inner scrolling, modal bounds, focus entry/return, keyboard use, 200% effective viewport, reduced motion, and no document scrolling.
- Used 1440×900 and 3840×2160 as regression checks; the 2560 tier does not leak into those profiles.
- Generated captures with the existing screenshot runner under ignored `qa-artifacts/visual-captures/`.

Verification results:

- Responsive browser contracts: 6 passed across 1440×900, 2560×1440, and 3840×2160.
- 2560×1440 game/modal gallery: 68/68 captured; Market Desk Overview/Trade gallery: 2/2 captured after the final rail-to-edge and 1500px Market Desk adjustment.
- 1440×900 and 3840×2160 game/modal regressions: 68/68 each; Market Desk regressions: 2/2 each.
- All six focused capture galleries report zero missing, duplicate, or failed captures.

Screenshots: [current 2560 game and modal gallery](../../qa-artifacts/visual-captures/2026-10-04T12-39-33-508Z/index.html) · [current 2560 Market Desk Overview/Trade](../../qa-artifacts/visual-captures/2026-10-04T12-23-06-764Z/index.html) · [1440 regression gallery](../../qa-artifacts/visual-captures/2026-10-04T11-28-43-129Z/index.html) · [4K regression gallery](../../qa-artifacts/visual-captures/2026-10-04T11-29-53-571Z/index.html) · [1440 Market Desk regression](../../qa-artifacts/visual-captures/2026-10-04T11-33-17-338Z/index.html) · [4K Market Desk regression](../../qa-artifacts/visual-captures/2026-10-04T11-33-52-336Z/index.html).

## Subsequent Market Desk compaction

The 1500px Market Desk size above records the initial 2560 pass. After review, the user requested a more compact Market Desk on every supported screen. The current implementation supersedes that cap: the Market Desk is limited to 1320px on desktop and 980px on landscape iPad, uses one sector dropdown at every size, and keeps a two-column chart-and-ticket layout on desktop. The current 12-profile capture gallery is [here](../../qa-artifacts/visual-captures/2026-10-04-market-desk-compact-v2/index.html) (24/24 captures).

## Implementation skills

The implementation followed `poorup-frontend`, `poorup-code-quality`, `game-ui-ux`, and `mobile-responsiveness` guidance. Changes are limited to the 2560 tier unless a shared component needed a scoped adjustment.

## Implementation files

The 2560 tier is in `public/styles.css`; its exact board/HUD and modal-family checks are in `qa/client-market-ui.spec.js`. Poorup frontend, code-quality, game UI/UX, and responsive-layout guidance were followed.
