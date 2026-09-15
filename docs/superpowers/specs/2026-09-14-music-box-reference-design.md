# Poorup Music Box — Reference-Locked Design Specification

**Status:** Implemented on `development` (2026-09-14); the reference contract below is retained as the visual acceptance record.

**Reference:** `C:/Users/jerem/.codex/generated_images/01a04ce5-c441-7f00-ae91-e42f0be01102/exec-dc4c67c8-6a4b-4b29-8205-0e8bb128dee0.png`

The reference is a 1672×941 generated visual of the real Poorup Home screen with the compact music box and the volume popover open. It is a visual reference, not a replacement page template. The implementation must preserve the current Poorup Home screenshot and confirm the result at native 1920×1080.

## Locked visual direction

The music box is a compact after-hours instrument panel, not a streaming-service card. It sits in the bottom-left of the title screen, above the ticker, and uses the same dark teal surfaces, gold rules, cream pixel type, square geometry, scanline texture, and restrained density as Poorup.

### Reference anatomy

From left to right and top to bottom:

1. a small gold music-note glyph;
2. `PONDERING THE COSMOS` as the readable track title;
3. a compact `AUTO THEME · ORIGINAL` state line;
4. elapsed time `01:42`, a block progress meter, and remaining/end time `03:18`;
5. icon-only controls: previous, pause/play, next, shuffle, loop, speaker;
6. a vertical volume popover opening upward from the speaker icon;
7. the dock border ends shortly after the speaker button, with balanced inner padding and no empty right shelf.

The compact view contains no long text buttons. Icon buttons receive accessible names in the DOM and visible tooltips only on deliberate hover/focus, never as permanent labels.

## Geometry at the required target

The reference image is normalized to the existing 1920×1080 Home viewport for acceptance. The target CSS geometry is:

- collapsed dock: 304–324px wide, 92–104px tall;
- left inset: 14–18px from the title-screen edge;
- bottom inset: 18–22px above the existing ticker;
- outer border: 1px Poorup line token;
- internal padding: 8px, with at least 8px after the final speaker control;
- icon controls: 28–32px square, never below 44px interactive hit area on touch layouts;
- volume popover: 34–40px wide, 104–116px tall, 8px visual gap above the speaker button;
- popover opens inward and never crosses the title-screen, footer, modal, HUD, board, chat, or rail boundaries.

## Functional states

- **Collapsed:** track title, theme status, progress, icon row, and speaker button.
- **Volume open:** same dock plus the vertical block slider above the speaker button.
- **Playing:** pause icon and moving progress value; no decorative pulsing.
- **Paused:** play icon and stable meter.
- **AUTO THEME:** theme default is active and loop is on.
- **CUSTOM:** user selected a track, shuffle, or loop mode; this status persists until the next theme change.
- **Loading/blocked/error:** compact text status in the existing polite live region; no layout expansion.
- **Position menu:** four corner choices exposed from a small grip/settings control, not visible in the locked reference state.

## Theme behavior

Every visual theme supplies semantic music tokens while preserving the existing layout:

- Original: deep teal surface, muted gold border, cream text;
- Spring: dark garden green surface, blossom-gold accent;
- Summer: water-teal surface, restrained amber accent;
- Autumn: umber surface, copper accent;
- Winter: navy surface, ice-blue accent;
- Light: pale sky surface, dark blue-green text, semantic red/green unchanged.

Selecting a theme always:

1. resolves that theme’s approved main track;
2. cancels an older transition;
3. clears `CUSTOM` state;
4. enables loop;
5. crossfades to the new track;
6. announces the new theme soundtrack once.

## Audio behavior

Use two hidden HTML audio elements and an A/B controller. The incoming track must load and successfully begin playback before the outgoing channel is stopped. Crossfade timings are 650ms for theme changes and 350ms for manual previous/next. Browser autoplay rejection leaves the selected track ready and presents `CLICK TO START MUSIC` through the existing status region.

Shuffle builds a bounded non-repeating queue. Loop repeats the current queue. With loop off, the queue advances and stops after its final entry. Previous restarts the current track after the three-second threshold and otherwise selects the previous queue item.

## Icon and asset direction

Create local crisp SVGs for the reference controls rather than importing a second icon library:

- `music-note.svg`
- `music-prev.svg`
- `music-play.svg`
- `music-pause.svg`
- `music-next.svg`
- `music-shuffle.svg`
- `music-repeat.svg`
- `music-speaker.svg`
- `music-grip.svg`

Each asset uses integer coordinates, `shape-rendering="crispEdges"`, a limited Poorup palette, no filters, no gradients, no text nodes, no external URLs, and no anti-aliased halo. The shuffle icon uses crossed stepped paths; the repeat icon uses two opposing stepped arrows so the distinction is clear at 1x.

## Placement and interaction

- Default position is bottom-left.
- Pointer dragging is supported only as a snap gesture to `top-left`, `top-right`, `bottom-left`, or `bottom-right`.
- A keyboard-native `MOVE PLAYER` menu exposes the same four positions.
- Position is clamped against safe areas and stored as an enum, never as raw coordinates.
- The expanded player is a non-modal popover; one blocking game modal always wins the z-index and focus stack.
- Closing the player restores focus to its opener.

## Accessibility and motion

- Native buttons, links, and range inputs with explicit accessible names.
- `aria-pressed` for shuffle/loop, `aria-expanded` for the dock and volume popover, and `aria-valuetext` for volume/time where useful.
- Speaker button is the compact trigger; its popup is keyboard reachable with arrows/Home/End and Escape.
- The drag gesture is never the only way to reposition the player.
- Visual dock open/close uses transform and opacity only, 140ms, existing ease-out.
- Audio crossfade is a media-volume ramp, not a CSS animation.
- Reduced motion removes visual travel and meter animation; forced colors keeps borders, focus, and controls visible.

## Screen layering

The player is mounted once outside individual SPA views. It remains above decorative theme scenery and below modal scrims, blocking dialogs, focus rings, and game-critical controls. It is hidden on static legal pages.

## Reference acceptance

At 1920×1080, the implementation must be compared with the reference composition:

- dock width and right edge match the compact silhouette;
- no empty shelf remains after the speaker icon;
- vertical popover is centered above the speaker with visible gap;
- all six icon controls remain readable at 1x;
- track/title/progress hierarchy matches the reference;
- no existing Home pixel is moved or recolored;
- theme changes alter only the player tokens and selected soundtrack, not layout.
