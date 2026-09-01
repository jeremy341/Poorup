# Poorup Board-Free Homepage Variations

Status: exploration only. These are composition proposals; no production
homepage, profile, lobby, game, or board code is changed by this artifact.

## Shared constraints

- Remove the board and mini-board from the homepage only. The live game board,
  board assets, and game route remain unchanged.
- Keep the After-hours Game Parlor system: `#01070A` canvas, dark teal panels,
  warm gold rules, restrained action red, Pixelify Sans display, IBM Plex Mono
  body/data, 2–3px radii, and pixel sprites.
- Keep one dominant `Create Room` action, one `Join Existing Room` path,
  `Quick Table` as a tertiary action, required guest alias behavior, profile
  shortcut, sound control, and truthful live connection status.
- No fake room counts, latency, uptime, testimonials, friends, inventory, or
  performance claims.
- Keep the skyline only when it works as atmosphere. It is not a replacement
  board or an interactive game surface.

## Why remove the board from home

The board is the correct anchor inside a live game, but on the current home it
competes with room entry and creates an awkward visual split at desktop widths.
A board-free homepage can make the entry task more direct, give the identity
surface a deliberate role, and reserve the board for the moment the player
actually enters a table.

## Variation A: Parlor Desk

**The roll**

### Thesis

Build a calm, full-width entry desk: the Poorup wordmark and factual invitation
occupy the left field, while a single right-hand desk contains Create, Join, and
the open-chair identity summary.

### Wireframe

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ POORUP   PLAY  ROOMS  PROFILE                         ONLINE  YOU  SOUND     │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  POORUP                           ┌────────────────────────────────────┐  │
│  AFTER-HOURS GAME PARLOR          │ ENTER THE PARLOR                   │  │
│                                   │ [ CREATE ROOM ]                    │  │
│  Game night, no account required. │ join an existing room               │  │
│  Create a room, send the code,    │ [ ABC123____________ ] [ JOIN ]     │  │
│  and play in your browser.        │ quick table                         │  │
│                                   │ ────────────────────────────────── │  │
│  skyline / print texture          │ open chair · edit identity          │  │
│                                   └────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────────────────┤
│ AFTER-HOURS PARLOR · LIVE TABLE SERVICE · NO ACCOUNT REQUIRED             │
└────────────────────────────────────────────────────────────────────────────┘
```

### Interaction and fit

- Create is the only red control and sits at the top of the entry desk.
- Join is always available in the same desk, with inline code and alias errors.
- The left side uses authored typography, skyline, and texture rather than a
  substitute illustration.
- At 1920px the desk stays readable without a center void. At 2560px the left
  field gains breathing room and the desk grows modestly, not infinitely.

### Strengths and risk

- Best conversion clarity and lowest implementation risk.
- Makes identity useful without letting it compete with room entry.
- Risk: needs strong type scale and print texture to avoid feeling like a plain
  form page.

## Variation B: Terminal Switchboard

### Thesis

Turn the homepage into a real terminal menu: numbered routes on the left,
one active command panel in the center, and live room discovery as a narrow
right column.

### Wireframe

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ POORUP                         ONLINE                        YOU  SOUND      │
├───────────────┬──────────────────────────────────┬─────────────────────────┤
│ PARLOR MENU   │ CREATE A NEW TABLE               │ LIVE TABLES              │
│ 01 PLAY       │ Game night, no account required. │ server-backed directory  │
│ 02 ROOMS      │                                  │ OPEN / LIVE filters       │
│ 03 PROFILE    │ [ CREATE ROOM ]                  │ ┌─────────────────────┐  │
│ 04 RULES      │                                  │ │ no public tables    │  │
│               │ join with a room code            │ │ host one or enter   │  │
│ identity      │ [ ABC123____________ ] [ JOIN ] │ │ a code              │  │
│ alias state   │                                  │ └─────────────────────┘  │
├───────────────┴──────────────────────────────────┴─────────────────────────┤
│ AFTER-HOURS PARLOR · CONNECTION STATE · KEYBOARD ROUTES                     │
└────────────────────────────────────────────────────────────────────────────┘
```

### Interaction and fit

- The menu is native tab/navigation, not decorative text. Arrow keys and
  shortcuts move focus logically.
- Rooms uses the existing server-backed directory and honest empty/loading
  states.
- The active command panel changes for Play, Rooms, and Profile without opening
  a modal for the primary task.
- Motion is a single panel crossfade/translate on route change; no looping
  effects.

### Strengths and risk

- Strongest sense of a Poorup terminal identity and clear extensibility for
  future home destinations.
- Gives Rooms a first-class place without fake content.
- Risk: navigation can feel too utilitarian if the active command panel lacks a
  clear visual focal point.

## Variation C: Ticket Booth

### Thesis

Make the home a centered after-hours ticket booth: one large typographic
marquee, two ruled tickets for Create and Join, and a compact identity/status
strip below.

### Wireframe

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ POORUP   PLAY  ROOMS  PROFILE                         ONLINE  YOU  SOUND     │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│                         AFTER-HOURS GAME PARLOR                            │
│                    GAME NIGHT, NO ACCOUNT REQUIRED                         │
│                                                                            │
│              ┌────────────────────┐  ┌────────────────────┐                │
│              │ CREATE A TABLE     │  │ JOIN A TABLE       │                │
│              │ [ CREATE ROOM ]    │  │ [ ABC123______ ]   │                │
│              │ quick table        │  │ [ JOIN ]           │                │
│              └────────────────────┘  └────────────────────┘                │
│                                                                            │
│          open chair · edit identity · live server · 40 spaces              │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│ AFTER-HOURS PARLOR · YOUR TABLE STARTS HERE                                │
└────────────────────────────────────────────────────────────────────────────┘
```

### Interaction and fit

- Create and Join have equal physical presence but clear semantic hierarchy:
  Create is red, Join is dark with a gold rule.
- The identity strip is compact and can open the existing profile route.
- The empty field above the tickets is intentional negative space, not a
  missing board. The skyline can sit as a low-contrast horizon behind the
  marquee.

### Strengths and risk

- Most memorable board-free composition and easiest to scan from across a room.
- Makes the homepage feel like a physical parlor entrance.
- Risk: the two-ticket metaphor must stay functional and accessible, with native
  buttons and labels rather than clickable decorative cards.

## Comparative scorecard

| Criterion | A: Parlor Desk | B: Terminal Switchboard | C: Ticket Booth |
| --- | ---: | ---: | ---: |
| Create / Join clarity | 5 | 4 | 5 |
| Board-free identity | 4 | 5 | 5 |
| Desktop whitespace control | 5 | 5 | 4 |
| Rooms extensibility | 4 | 5 | 3 |
| Poorup-specific character | 4 | 5 | 5 |
| Implementation risk | 5 | 4 | 4 |

## Recommendation

Start with **Parlor Desk** if the priority is immediate room entry and a stable
desktop layout. Choose **Terminal Switchboard** if the homepage should become a
small navigable control surface. Choose **Ticket Booth** if the homepage should
feel like a bold, board-free physical entrance.

## Shared quality gates after selection

- Profile, lobby, game, and live board markup remain untouched.
- Create, Join, Quick Table, Rooms, Profile, alias validation, account chip,
  and sound control remain functional.
- Verify exact 1920x1080 and 2560x1440 layouts with no overflow or clipped
  controls.
- Run keyboard/focus, reduced-motion, forced-colors, 200% zoom, console,
  `node --check`, `git diff --check`, Axe, Impeccable, motion review, critique,
  and frontend review gates.

## Selected composition

The user selected **Parlor Desk**. The production homepage now removes the
mini-board entirely while preserving the skyline as atmosphere. Poorup’s
statement occupies the left field, and one right-hand entry desk contains the
Create Room, Join, Quick Table, live status, alias, and identity controls. The
profile, lobby, live board, and game remain unchanged.
