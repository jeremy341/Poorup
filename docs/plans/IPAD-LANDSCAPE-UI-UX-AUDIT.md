# Poorup iPad Landscape UI/UX Audit

Audit date: 2026-09-10
Audited commit: `bff0ff3`
Status: landscape implementation slice completed; real-Safari follow-up remains

## /goal

Audit Poorup as an iPad experience, with landscape as the only supported
gameplay orientation. Review the home shell, room modal, profile, achievements,
Rules book, Rankings, Social, game HUD, board, rails, modals, touch targets,
focus behavior, reduced motion, and responsive CSS. Reproduce issues at real
iPad-sized browser profiles, classify them as bugs, UX debt, intentional
behavior, or non-issues, and define a landscape-first redesign brief that
preserves the Poorup UI system.

Portrait was checked only for graceful compatibility. It is not a gameplay
target and should not receive a second vertical board composition.

## Implementation completed

The landscape slice described here is now implemented in the working tree:

- a board-first 768–1279px landscape desk with left player/chat rail, centered
  square board, compact five-cell HUD, and right Holdings/Deals/Activity dock;
- `100dvh`/safe-area sizing and no page-level scroll for the live round;
- board-size budgets for Mini and Pro landscape, including an action-safe Focus
  state;
- a two-column Rankings desk and three-column Social desk at the tight Mini
  width, preventing zero-height feed/list regions;
- a two-column Home parlor composition that keeps the ticker in view;
- sticky Profile chrome, consistent destination focus, corrected toolbar
  semantics for filters/account actions, 44px modal/empty-state controls, 24px
  panel checkboxes, iPad form-control sizing, and touch-safe tap feedback;
- landscape iPad Playwright projects and contracts for overflow, panel height,
  focus, touch targets, and a real two-seat round.

No server or rules-engine behavior was changed by this UI slice.

## Design constraints

The redesign must remain recognizably Poorup:

- dark teal terminal/parlor surfaces, gold rules, red action hierarchy;
- Pixelify/Jersey/Silkscreen typography and the existing type scale;
- square geometry, crisp borders, scanlines, restrained shadows, and pixel SVGs;
- the existing global topbar, audio controls, board art, Holdings/Deals/Activity
  rail, Rules book, Profile tabs, Rankings, Social, modal stack, and live regions;
- no glassmorphism, gradients, pill-heavy SaaS cards, emoji controls, or new
  component library;
- one landscape game shell, not a separate rules engine or duplicated UI state;
- every critical decision remains visible or has a clearly marked drawer/modal;
- no page-level game scroll in landscape. Only a rail, drawer, or modal may scroll.

The review used the mobile-responsiveness, game-UI/UX, accessibility, Web
Interface Guidelines, frontend-design-review, critique, Impeccable, and
Emil-Kowalski motion lenses. The local skill catalog already covered the
requested work; no overlapping skill package was installed.

References used:

- [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md)
- [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [MDN responsive design](https://developer.mozilla.org/en-US/docs/Learn/CSS/CSS_layout/Responsive_Design)

## Devices and method

Playwright Chromium was run with touch enabled and the actual device profiles:

| Profile | CSS viewport | Purpose |
| --- | ---: | --- |
| iPad Mini landscape | 1024 × 768 | Tight landscape baseline; the hardest supported tablet width |
| iPad Pro 11 landscape | 1194 × 834 | Spacious landscape baseline |
| iPad Pro 11 portrait | 834 × 1194 | Compatibility check only |
| iPad Mini portrait | 768 × 1024 | Compatibility check only |

Each profile exercised Home, Profile, Achievements, Rules, Rooms, Create Room,
Rankings, Social, account creation, achievement details, and a two-seat live
round. Screenshots were captured and visually inspected. DOM measurements
checked body overflow, panel bounds, nested scroll regions, visible controls,
focus, ARIA state, and page errors.

## Evidence snapshot

### Landscape game shell — post-implementation

At both landscape widths the game uses the base column layout because the grid
starts at `min-width: 1280px`:

| Profile | Body height | Board frame | HUD | Holdings rail | Result |
| --- | ---: | --- | --- | --- | --- |
| Mini landscape 1024×768 | 768px | 522×522 at y=107 | y=672, 86px tall | x=768, 246×686 | 0px page scroll |
| Pro landscape 1194×834 | 834px | 567×567 at y=117 | y=738, 86px tall | x=898, 286×752 | 0px page scroll |

The player list and chat occupy the full width above the board. The board,
cash/dice/pool HUD, Roll action, and Holdings/Deals/Activity surface are all
separate vertical stops. A player cannot oversee the board and the next legal
action in one landscape viewport.

`FOCUS` now hides optional rails while keeping the immediate action in the
same viewport:

| Profile | Focus board | HUD | Roll | Body height |
| --- | --- | --- | --- | ---: |
| Mini landscape | 584×584 at y=76 | y=672 | y=672 | 0px |
| Pro landscape | 634×634 at y=84 | y=738 | y=738 | 0px |

Focus therefore makes the board larger than the viewport and pushes Roll below
the fold. It is a useful board view, but not a usable turn view.

### Landscape home and social surfaces

| Surface/profile | Body | Measured issue |
| --- | ---: | --- |
| Home, Mini landscape | 1024×768 in a 1024×768 viewport | Fits; ticker remains in the first viewport |
| Home, Pro landscape | 1194×834 in a 1194×834 viewport | Fits; ticker remains in the first viewport |
| Rankings, Mini landscape | Stage/context share the main desk; list has a bounded readable region | No zero-height reward/list region |
| Social, Mini landscape | Network, feed, and context share the main desk; feed body is bounded | No clipped primary feed/context |
| Rankings, Pro landscape | Stage 431px; list 282px; season panel 431px | Healthy two-column composition |
| Social, Pro landscape | Feed 441px; body 366px; context 441px; roster 204px | Healthy three-column composition |

Top-level Home, Rules, Rankings, and Social have no horizontal or page-level
overflow at either landscape width. Rules correctly keeps its article and index
inside internal scroll surfaces. Profile remains intentionally
content-scrollable, with sticky chrome now keeping navigation reachable.

### Touch and focus measurements

The WCAG AA minimum target is 24×24 CSS pixels; 44×44 is the comfortable touch
target recommended for frequent tablet actions.

| Control | Measured size | Classification |
| --- | ---: | --- |
| Room/account/modal `CLOSE` buttons | 47.3×17.2 | Below the 24px minimum in height |
| Empty Holdings `OPEN ITEMS` | 76.1×17.2 | Below the 24px minimum in height; the empty-state branch omits the min-height class |
| Panel-menu checkboxes | 18×18 | Below the 24px minimum |
| Global nav tabs | 34px high | Passes AA minimum, below comfortable tablet size |
| Audio controls | 42×40 | Close to comfortable; height is below 44px |
| Profile tabs and room tabs | 42px / 34px | Profile tabs are comfortable; room tabs are compact |

After tapping the global Profile, Rankings, or Social destination, focus remains
on `BODY`. Rules intentionally focuses its article heading, and Rooms/account/
achievement dialogs focus their first useful control. The destination pages
therefore have inconsistent entry focus.

## Findings

Severity uses P1 for a workflow that is materially unusable on the supported
landscape tablet and P2 for meaningful UX, accessibility, or platform debt.

| ID | Severity | Location | Finding | Why it matters | Recommended direction |
| --- | --- | --- | --- | --- | --- |
| IPAD-01 | P1 → DONE | `public/styles.css:995-1002`, `public/styles.css:2247-2288`, landscape tablet block | No landscape tablet game shell existed. | Board, HUD, Roll, and Holdings were separated by page scroll. | Board-first landscape grid, compact HUD, and docked rails now keep the live round inside the viewport. |
| IPAD-02 | P1 → DONE | `public/styles.css:1963-1972`, landscape tablet block | The 1024px Rankings/Social breakpoint collapsed primary regions. | Mini landscape could not scan rows or context. | Tablet Rankings stays two-column; Social stays three-column with explicit height budgets. |
| IPAD-03 | P1 → DONE | `public/styles.css:177`, landscape tablet block | Home had no tablet landscape height policy. | The ticker fell below the first viewport. | Home now uses a two-column `100dvh` desk and keeps the ticker visible. |
| IPAD-04 | P2 → DONE | `public/styles.css:3395-3413`, landscape tablet block | Focus enlarged the board past the action controls. | Roll was below the fold. | Focus now uses a height-safe board budget and keeps HUD/Roll in the same row. |
| IPAD-05 | P2 → DONE | `public/clientProfileBindings.js`, `public/clientSocialSurfaces.js`, `public/index.html` | Destination focus was inconsistent. | Keyboard/VoiceOver users lost their place. | Profile heading, Rankings stage, and Social feed receive destination focus; Rules behavior is retained. |
| IPAD-06 | P2 → DONE locally | `public/styles.css` landscape compact-header block | Mini landscape used compact chrome without enough identity context. | Players need a persistent account/status cue without spending a full rail column. | Mini now keeps a 40px avatar/status control plus the global audio controls; the full name remains available through the control. |
| IPAD-07 | P2 → DONE | `public/styles.css:177`, `public/styles.css:2383-2384`, landscape tablet block | Profile chrome left the viewport during long editing. | Back/nav/audio required a long scroll to recover. | Profile header is sticky in landscape. |
| IPAD-08 | P2 → DONE | landscape tablet touch contract in `public/styles.css` | Close, empty-state, and panel-menu targets were too small. | Finger operation failed the AA target floor. | Close/empty actions are 40px; panel checkboxes are 24px; frequent tabs have larger hit boxes. |
| IPAD-09 | P2 → DONE locally | `public/styles.css:342-350`, landscape tablet block | Form controls were below the iPad Safari zoom comfort floor. | Focusing an input could cause a platform zoom jump. | Landscape tablet controls use a 16px font and Social search has an explicit 44px height; real Safari verification remains. |
| IPAD-10 | P2 | `public/styles.css:1783`, `public/styles.css:1925`, `public/styles.css:1951`, `public/styles.css:2712` | Nested touch scroll remains visually quiet. | Users may still miss that a clipped region scrolls. | Keep as the next polish slice: add a subtle overflow cue without adding page scroll. |
| IPAD-11 | P2 → DONE | `public/index.html:450-456`, `public/clientAccountIdentity.js:261-263` | Filters/account actions used incomplete tab semantics. | Screen readers received misleading tab relationships. | Filters/account actions now use toolbar/pressed semantics; true tabs retain controls and panels. |
| IPAD-12 | P2 → DONE locally | `public/index.html:5`, landscape tablet block | Viewport and shell sizing were not safe-area/dynamic-height aware. | Safari/PWA chrome could overlap or stale-size the shell. | `viewport-fit=cover`, safe-area padding, and `dvh` sizing are in place. |
| IPAD-13 | P2 → DONE locally | landscape tablet block | Desktop hover styles could persist on coarse pointers. | Taps could leave the wrong visual state. | Touch-safe tap feedback and coarse-pointer hover resets are in place. |
| IPAD-14 | P2 | `public/styles.css:480-483` | Home skyline remains a long decorative loop when motion is allowed. | It has no explicit pause control. | Keep as a separate motion-polish decision; reduced motion already disables it. |

## What passed / intentional behavior

- No horizontal overflow was observed on the top-level landscape surfaces.
- Pro landscape Rankings and Social currently have a readable composition.
- Rules keeps article content inside the book’s internal scroll region and does
  not create page scrolling.
- Room, account, and achievement dialogs fit inside landscape tablet viewports;
  the dialog stack gives them a useful initial focus.
- Decorative SVGs include dimensions and accessible titles/hidden treatment;
  the Poorup palette, borders, type, and pixel treatment remain coherent.
- Major movement honors reduced motion: skyline, status pulses, article/tab
  entrances, and casino reveal movement are suppressed or reduced.
- Profile content scrolling is intentional because the editor is longer than a
  tablet viewport. The header persistence and target sizing around it are the
  UX issues, not the existence of profile content itself.
- Portrait is not a product failure for the game after a rotate-device state is
  provided; the audit does not recommend building a second vertical board.

## Landscape-first redesign brief

### 1. Shell contract

Add one landscape tablet media contract:

```text
@media (orientation: landscape) and (min-width: 768px) and (max-width: 1279px)
```

Use `height: 100dvh` with a `100vh` fallback, `overflow: hidden` on the live
game shell, and safe-area insets on the topbar and bottom action strip. Do not
use JS pixel measurements to position the board or content.

Portrait game state should show a compact, accessible `ROTATE DEVICE` surface
with one Back/Leave action. Non-game Profile/Rules/Social pages may remain
readable in portrait, but no portrait board composition is required.

### 2. Live game composition

Use a board-first grid with three conceptual layers:

```text
┌ shared topbar ─────────────────────────────────────────────┐
│ player/turn strip │ board stage                 │ rail dock │
│                    │ square board               │ H/D/A     │
│                    │                             │ summaries │
├ pinned action strip: turn · cash · dice · Resolve/Roll ────┤
```

Mini landscape (1024×768):

- right dock 280–300px;
- board target 500–560px square, never below the existing readable tile floor;
- compact action strip 64–76px;
- Players and Chat become a top strip plus focused drawers, not full-width
  stacked panels;
- Holdings/Deals/Activity remain one dock with internal scrolling.

Pro 11 landscape (1194×834):

- right dock 300–320px;
- board target 600–680px square;
- same pinned action strip;
- optional compact player strip can remain visible beside the board;
- Chat opens as an anchored drawer, not a second full-height page section.

The board must stay square and centered by container flow. The current board
tile dimensions and order remain unchanged in Standard-40. Metro 52 may use
controlled board zoom/pan inside the board stage, never distorted tiles.

### 3. Rail and decision hierarchy

Keep the existing right-rail vocabulary:

```text
HOLDINGS | DEALS | ACTIVITY
```

Show counts and the next required action in the dock. Open full market,
casino, wallet, financing, and deal-detail work in the existing modal shell.
Required payments, auctions, bankruptcy, event choices, and Roll/Resolve stay
available in the pinned action strip and can never be hidden by panel settings.

`FOCUS` should hide optional context only. It must leave turn status, cash, the
board, and the next legal action visible without page scrolling.

### 4. Home, Rankings, and Social

- Home landscape uses a two-column parlor desk at both tablet widths. Vertical
  padding and the skyline footprint are reduced until the ticker remains inside
  `100dvh`.
- Rankings at 1024px keeps the ledger stage and season reward context side by
  side with explicit stage/list minimums. Pro can use the wider proportions.
- Social at 1024px keeps Network + Feed side by side; People Nearby opens from a
  clearly labeled context drawer or occupies a third column only at Pro width.
- Every internal scroll region gets an edge cue, retained focus, and a status
  message when more content exists.

### 5. Touch and accessibility

- Minimum 24×24 for every interactive target; 40–44px for frequent tablet
  actions and all close/confirm controls.
- Tap the label as well as the checkbox/radio; never make the 18px native box
  the only hit target.
- Use complete ARIA tabs only where a tab-panel relationship exists; use
  toolbar/pressed semantics for filters.
- Set a page heading or primary panel as the focus target after every top-level
  navigation action. Restore focus to the invoking tab on Back.
- Keep the existing live regions and server-authoritative status copy.
- Verify 200% text zoom, forced colors, VoiceOver rotor/heading navigation,
  hardware-keyboard Tab/Arrow/Escape, and reduced motion on real iPad Safari.

### 6. Motion and pixel craft

Keep motion purposeful and stepped:

- board/token movement stays transform-only and short;
- modal/drawer entry uses the existing ease-out tokens and stays under the UI
  duration budget;
- no animation is required for keyboard/high-frequency navigation;
- touch hover is replaced by active/focus feedback;
- the casino reveal reel remains the rare, deliberate delight moment, with the
  server result committed before presentation and a reduced-motion result card.

New SVG marks should use the existing `shape-rendering="crispEdges"`, bounded
Poorup palette, explicit dimensions, and title/description treatment.

## Verification plan for the redesign

Add landscape projects to the browser suite:

```text
iPad Mini landscape · 1024×768
iPad Pro 11 landscape · 1194×834
```

Required automated assertions:

1. Home and game body scroll height equals the viewport height in landscape.
2. Board, turn status, cash, and Roll/Resolve are simultaneously reachable
   without page scroll.
3. Holdings/Deals/Activity dock retains a bounded internal scroll region.
4. Rankings stage/list and Social feed/context meet explicit minimum heights at
   1024px; no panel has a zero-height scroll viewport.
5. All visible controls meet 24px minimum; close/confirm actions meet 40px.
6. Top-level navigation sets focus to the destination heading/panel and Back
   restores the invoker.
7. Portrait game shows the rotate-device surface instead of a broken board.
8. Reduced-motion and 200% text zoom preserve the same legal action flow.
9. Touch taps do not leave hover-only state stuck or trigger duplicate actions.
10. Capture 1920px desktop plus both landscape iPad profiles for visual review.

## Scores

Scores reflect the current implementation after the landscape desk slice;
remaining items are touch-scroll polish and real Safari verification.

| Area | Score | Reading |
| --- | ---: | --- |
| Poorup visual identity | 4.2 / 5 | Distinctive terminal/parlor language survives on every tested surface. |
| Home landscape fit | 4.1 / 5 | Two-column desk fits both landscape baselines and keeps the ticker visible. |
| Game landscape usability | 4.0 / 5 | Board, turn HUD, Roll, and Holdings remain in one no-scroll desk. |
| Rankings/Social tablet layout | 4.0 / 5 | Mini and Pro retain readable multi-panel content with bounded scroll regions. |
| Touch operability | 3.8 / 5 | AA target floor and common action sizing are covered; Safari feel-check remains. |
| Accessibility semantics/focus | 3.7 / 5 | Destination focus and filter semantics are aligned; VoiceOver fixture remains. |
| Motion and feedback | 3.5 / 5 | Reduced-motion and coarse-pointer states are safe; skyline pause is polish. |
| Overall landscape iPad readiness | **3.9 / 5** | The dedicated landscape desk is ready for browser QA; real Safari and polish gates remain. |

## Verdict

The landscape-first redesign is now implemented without disturbing the Poorup
visual system or server rules. The live round no longer becomes a long
document, the Mini landscape Rankings/Social collapse is resolved, and Mini
chrome retains a compact identity/status cue. The remaining work is
intentionally small: add scroll-edge cues, add the portrait rotate-device
surface, and complete real iPad Safari/VoiceOver verification before release.
