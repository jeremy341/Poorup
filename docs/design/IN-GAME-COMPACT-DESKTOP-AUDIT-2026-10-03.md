# In-game compact desktop audit and planning note

Date: 2026-10-03

Status: Audit complete; recommendations are planning input and are not approved implementation requirements.

## Scope

This note covers only the live-game surface: board, top bar, player/chat rail, holdings/deals/activity rail, HUD, visibility controls, and in-game overlays. Home, room directory/setup, profile, rankings, social, and rules pages are outside scope.

The pre-round lobby and its host settings rail inside the game view are in scope. The Home Rooms directory and create/join dialogs are not. The repository does not contain the referenced layout-invariants document; design interpretation used PRODUCT.md, .ulpi/design/DESIGN.md, and the in-game UX implementation plan.

The target viewports are:

| Desktop profile | CSS viewport |
| --- | ---: |
| Compact desktop | 1280 × 720 |
| Compact desktop | 1366 × 768 |

I used isolated temporary private rooms and inspected the live Standard 40 game at both dimensions in Chromium. No product code or test suite was changed or run. Screens were inspected in browser; this note does not add screenshots to the repository.

## Results

| Viewport | Board | Left rail | Center column | Right rail | Full HUD |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1280 × 720 | 184 px square | 316 px | 544 px | 360 px | 428 px across three rows |
| 1366 × 768 | 232 px square | 316 px | 630 px | 360 px | 428 px across three rows |

The document stayed at the viewport dimensions in both captures. With the full HUD, the board center art and perimeter labels become cramped enough to overlap visually. At 1280 × 720, a 184 px board leaves the game difficult to read and play.

At 1366 × 768, selecting Compact reduced the HUD from 428 px to 309 px and increased the board from 232 px to 351 px. It still used three HUD rows and left a small board. At 1280 × 720, the full-HUD capture shows the same three-row structure.

## Findings

### 1. The HUD consumes most of the center column height

Between 1024 and 1535 px, the HUD uses two columns and the roll button spans both. That creates two 132 px information rows plus a 132 px action row. The board gets only the leftover height. The five-cell one-row HUD starts at 1536 px, outside both desktop targets. See the [tablet-to-desktop HUD rules](../../public/styles.css#L3332) and [desktop game grid](../../public/styles.css#L3368).

The measured board sizes were 184 px at 1280 × 720 and 232 px at 1366 × 768. This is the main compact-desktop blocker.

### 2. Fixed rail widths leave a modest center column

Both sizes keep a 316 px left rail and 360 px right rail. The center is 544 px at 1280 and 630 px at 1366 before its internal HUD is laid out. The rails can be hidden, but without reducing HUD height the board remains constrained vertically. See the [desktop grid](../../public/styles.css#L3368) and [hidden rail tracks](../../public/styles.css#L3435).

### 3. Compact mode helps, but does not become a compact footer

At 1366 × 768 the current compact selector reduced each HUD row to about 92 px, leaving three rows and a 309 px HUD. The resulting 351 px board is better, but the layout still spends more than a third of the center area on HUD. A one-row bottom strip with the current turn and required action would give the board substantially more height.

### 4. Metro 52 needs separate desktop verification

Metro 52 has a 560 px minimum board-holder size. Between 768 and 1399 px the board area can scroll to accommodate that minimum. At 1280 × 720 and 1366 × 768, this may turn the board into a pannable area while its usable height is already constrained. These captures used Standard 40; Metro behavior is source-derived, not visually verified. See the [Metro minimum](../../public/styles.css#L2148) and [mid-width board overflow rule](../../public/styles.css#L3388).

## Planning direction

For 1280–1535 px, use a dedicated board-first desktop layout:

- Place the turn cue, required action, and Roll button in one compact bottom strip.
- Let cash, dice, and vacation-pool detail expand on demand or occupy a small second line only when needed.
- Size the square board against both the available center width and the height left after the compact strip.
- Reduce rail widths at this breakpoint, or let either rail collapse behind a visible edge handle.
- Keep urgent payments, auctions, bankruptcy decisions, and active global-event warnings in view.

The current compact mode is a useful starting point. The measured 351 px board at 1366 × 768 shows that row-count reduction matters as much as per-cell padding. A one-row strip should be compared with an overlay-rail option before implementation.

### Typography shared across both size plans

Use IBM Plex Sans for functional text and labels, and IBM Plex Mono for cash, prices, timers, and other values. IBM Plex Mono 500/600 is already bundled; IBM Plex Sans would need a local asset. Keep Pixelify Sans for the wordmark and display headings, and reserve Silkscreen for decorative accents. Preserve tabular numerals. Board labels should also have a larger minimum; the current family change alone will not make cramped tile text readable.

## In-game overlay audit

| Surface | Evidence at target sizes |
| --- | --- |
| Wallet & Items | Visually captured at 1366 × 768; it centered without clipping. |
| Game-over decision | Visually captured at 1366 × 768 and 1024 × 768; the 420 × 258 px card fit inside both viewports. |
| Panels menu | Visually captured at 1194 × 834; source-reviewed at desktop widths. |
| Market Desk | Source-reviewed for all four sizes. Retained iPad screenshots exist from 2026-09-27, but are older than this audit. |
| Purchase/auction, trade/offer, deed, financing, bank loan, casino, bankruptcy, card, sponsorship, event banner, log drawer | Source-reviewed; not all states were replayed at both compact desktop widths. |

Generic dialogs use a viewport height cap and internal scrolling. The Market Desk changes from its tablet two-column form at widths up to 1200 px to the desktop watchlist layout above 1200 px. At 1280 × 720 it also uses the short-height chart rule. The breakpoint transition and scroll cues need a fresh rendered check for the specific modal states.

## Open checks for a later design pass

- Capture the same layouts with Metro 52 enabled.
- Compare the current three-row HUD, a one-row compact footer, and a collapsible side-rail treatment.
- Replay Market Desk, purchase/auction, trade, financing, casino, global-event, and log states at 1280 × 720 and 1366 × 768.
- Confirm keyboard focus, internal scrolling, and 200% zoom without introducing document scrolling.

No product code or pre-existing documents were changed; this planning note is one of two new documents.
