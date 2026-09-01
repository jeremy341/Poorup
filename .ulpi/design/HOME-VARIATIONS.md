# Poorup Homepage Layout Variations

Status: exploration only. No production UI, profile UI, lobby, or game code is changed by this artifact.

## Shared contract

Every variation keeps the established After-hours Game Parlor system:

- canvas `#01070A`, chrome `#020A0D`, teal board surfaces, warm gold rules,
  restrained action red, Pixelify Sans display, and IBM Plex Mono data;
- one primary `Create Room` action;
- one secondary `Join Existing Room` code path;
- `Quick Table` remains available but visually tertiary;
- account-free guest alias flow and the current account/profile shortcut;
- server-backed rooms directory, no fake room counts, uptime, latency, or
  social proof;
- the existing mini-board/skyline art language, native buttons, keyboard
  access, and reduced-motion behavior.

The profile tab, lobby, and game surface are out of scope and remain unchanged.

## Why the current home feels strange

At 1920x1080 the home stage is 1892x933, but the useful left content is about
480px wide and the mini-board is capped at 360px. At 2560x1440 the stage grows
to 2212x1293 while those content caps remain. The result is a large empty center
and a small visual anchor pushed to the far right. These options solve that
composition problem with different topologies rather than another spacing tweak.

## Variation A: Tabletop Portal

**The roll**

### Thesis

Treat the homepage as a three-zone parlor entrance: identity and context on the
left, a large board portal in the center, and the room-entry controls on the
right.

### Wireframe

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ POORUP   PLAY  ROOMS  PROFILE                         ONLINE  YOU  SOUND     │
├───────────────┬───────────────────────────────┬────────────────────────────┤
│ OPEN CHAIR     │                               │ ENTER THE PARLOR            │
│ guest alias    │          MINI BOARD           │ Create Room                 │
│ identity chip  │       (large 1:1 frame)       │ Join existing room          │
│ factual copy   │         skyline backdrop      │ [room code] [JOIN]          │
│               │                               │ Quick Table (tertiary)      │
│               │                               │ live server signal           │
├───────────────┴───────────────────────────────┴────────────────────────────┤
│ AFTER-HOURS PARLOR · LIVE TABLE SERVICE · NO ACCOUNT REQUIRED               │
└────────────────────────────────────────────────────────────────────────────┘
```

### Behavior

- The board is the signature anchor and scales from roughly 520px at 1920px to
  700px at 2560px, bounded by available height.
- The right entry deck owns the only dominant action. The join field is always
  visible but stays secondary.
- The left identity rail keeps the open-chair context and alias requirement
  without competing with room entry.
- `ROOMS` opens the existing server-backed directory; `PROFILE` navigates to the
  existing profile route.

### Strengths and risk

- Strongest game identification and the cleanest fix for the current empty
  center.
- Uses all three desktop zones without inventing a new data source.
- Risk: three zones can feel dense if the copy grows. Keep the left rail short.

## Variation B: Split-Screen Playbill

### Thesis

Make the board a full left-side scene and set one concise entry playbill on the
right. The page reads like a printed program pinned beside the table.

### Wireframe

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ POORUP   PLAY  ROOMS  PROFILE                         ONLINE  YOU  SOUND     │
├───────────────────────────────────────┬────────────────────────────────────┤
│                                       │ AFTER-HOURS GAME PARLOR              │
│                                       │ Game night, no account required.    │
│             LARGE BOARD                │ Create a room and invite the table.│
│        skyline + mini-board            │                                    │
│       fills the left scene             │ [CREATE ROOM]                       │
│                                       │ Join an existing room               │
│                                       │ [ABC123________________] [JOIN]     │
│                                       │ open chair · edit identity          │
│                                       │ no account · real-time · 40 spaces  │
└───────────────────────────────────────┴────────────────────────────────────┘
```

### Behavior

- The left scene gets a height-led board frame with an explicit aspect ratio.
- The right playbill uses one primary CTA and a compact join form; Quick Table
  becomes a text-level tertiary action below the join path.
- At 1920px the two halves remain balanced; at 2560px the board and playbill
  both grow instead of leaving a center void.

### Strengths and risk

- Fastest comprehension: the visitor sees the game and the next action in one
  scan.
- Easiest layout to maintain and test at both desktop sizes.
- Risk: less distinctive than the other options if the board scene is treated
  as a generic image. The board frame and skyline must carry the craft.

## Variation C: Parlor Counter

### Thesis

Use the board and skyline as a wide counter backdrop, then place a compact
console along the lower edge like a ticket booth. The entry controls feel
physical and the stage has one unbroken horizon.

### Wireframe

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ POORUP   PLAY  ROOMS  PROFILE                         ONLINE  YOU  SOUND     │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│                     BOARD MARQUEE / SKYLINE                                │
│                    large 1:1 board crop                                    │
│                                                                            │
├───────────────────────┬───────────────────────────────┬────────────────────┤
│ YOUR SEAT              │ START A TABLE                 │ ROOM SIGNAL         │
│ avatar · alias         │ [CREATE ROOM]                 │ LIVE SERVER          │
│ EDIT IDENTITY          │ [ABC123________] [JOIN]       │ NO ACCOUNT REQUIRED  │
│                        │ Quick Table                   │ 40 SPACES           │
├───────────────────────┴───────────────────────────────┴────────────────────┤
│ AFTER-HOURS PARLOR · LIVE TABLE SERVICE                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

### Behavior

- The upper board frame is the visual signature; the lower console remains
  visible without scrolling at both target widths.
- The center console owns Create and Join. The left console is identity only;
  the right console carries factual status signals.
- The board can use a subtle one-time reveal on first load; the console itself
  stays immediately visible.

### Strengths and risk

- Most distinctive and compact. It eliminates the isolated mini-board and the
  uneven vertical rhythm in one move.
- The console gives every fact a clear home without making three dashboard
  cards.
- Risk: the lower action strip must stay tall enough for 44px targets and may
  feel cramped if copy is expanded.

## Comparative scorecard

Scores are relative design judgments, not analytics claims.

| Criterion | A: Tabletop Portal | B: Split-Screen Playbill | C: Parlor Counter |
| --- | ---: | ---: | ---: |
| Immediate room-entry clarity | 5 | 5 | 4 |
| Board as signature anchor | 5 | 5 | 5 |
| Fixes 1920px whitespace | 5 | 5 | 5 |
| Uses 2560px gracefully | 5 | 4 | 5 |
| Keeps identity secondary | 4 | 5 | 4 |
| Implementation risk | 4 | 5 | 3 |
| Poorup-specific character | 5 | 4 | 5 |

## Recommendation

Start with **Variation A: Tabletop Portal**. It best preserves the current
visual identity while solving the measured root cause: the board becomes the
center anchor, the entry actions get a dedicated home, and the identity rail
stays useful but subordinate. Variation B is the safer fallback when maximum
clarity matters more than parlor atmosphere. Variation C is the boldest option
if the user wants the homepage to feel like a physical arcade counter.

## Quality gates for the chosen variation

- Keep the existing profile, lobby, and game routes byte-for-byte outside the
  explicitly scoped home selectors and state hooks.
- Verify Create, Join, Quick Table, Rooms, Profile, alias validation, account
  chip, and sound controls at 1920x1080 and 2560x1440.
- Capture one batched visual pass and one confirmation pass. Check overflow,
  44px targets, focus visibility, forced colors, 200% zoom, reduced motion,
  and empty/error states.
- Run `node --check`, `git diff --check`, Axe, the Impeccable detector once,
  Web Interface Guidelines, motion review, critique, and frontend review.

## Selected reroll: Upper-Rail Split

The chooser steer moved the horizontal command bar above the board. The
implemented composition now uses that upper rail for the Poorup statement,
Create Room, Quick Table, and live status. Below it, a large height-led board
scene occupies the left field and a contained Join ledger occupies the right.
The selected chooser id was `upper-rail-split`.

This exploration was later superseded by the board-free **Parlor Desk**
selection documented in `HOME-NO-BOARD-VARIATIONS.md`.
