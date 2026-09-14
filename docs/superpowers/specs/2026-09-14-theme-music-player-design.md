# Poorup Theme Music Player — Design Specification

**Status:** Superseded by the implemented reference player (2026-09-14). The original planning history below is preserved; see the implementation record at the end for the shipped manifest and legal sources.

> **Implemented record (2026-09-14).** The approved local soundtrack inventory is now shipped through `public/clientMusicData.js`: Original `pondering-the-cosmos.mp3` (Ruskerdax, CC0), Spring `themes/spring/hot-springs-town.mp3` (Kistol, CC0), Summer `themes/summer/summers.mp3` (symphony, CC0 with requested credit), Autumn `themes/autumn/autumn.mp3` (Duasun, CC0), Winter `themes/winter/snowy-village.ogg` (Louswan, CC-BY 3.0), and Light `themes/light/town.mp3` (Pro Sensory, public domain). The complete source links and attribution records live in `public/assets/audio/README.md` and `public/legal/licenses.html`; local preference keys and autoplay behavior are documented in `public/legal/storage.html` and `public/legal/privacy.html`. The candidate/secondary queue names in the historical inventory below are planning notes and are not shipped runtime tracks.

**Goal:** Give every visual theme an automatic soundtrack while providing one persistent, accessible, theme-colored player that supports crossfades, manual track choice, shuffle, loop, seek, volume, and four-corner placement.

## Product decisions

- Theme changes always select the new theme's approved main track and enable loop.
- Any manual track or loop change marks the player `CUSTOM` for the current theme only.
- The next theme change clears `CUSTOM`, rebuilds the queue from the new theme, and enables loop again.
- The original Poorup theme keeps `Pondering the Cosmos` as its unchanged default.
- The global music toggle remains the single source of truth for enabled/disabled state. The player proxies that state; it does not create a second toggle system.
- The player opens by click or keyboard, never by hover. It is mounted once outside the SPA views so music can continue through Home, Profile, Rankings, Social, Rules, Lobby, and Game.
- Static legal pages do not autoplay music and do not mount the player.

## Current soundtrack inventory

Only `public/assets/audio/pondering-the-cosmos.mp3` is currently a production asset. The seasonal files are local listening-pack candidates under `qa-artifacts/music-candidates-2026-09-12/` and must be copied only after their exact license and final selection are approved.

Recommended initial defaults from the curation record:

| Theme | Main track | Secondary queue |
| --- | --- | --- |
| Original | Pondering the Cosmos | none |
| Spring | Hot Springs Town | Apple Cider, Good Morning |
| Summer | Summers | Funked Up |
| Autumn | Autumn | Autumn Colors |
| Winter | Snowy Village | Through the Snow; Remember Winter after editing |
| Light | Town | FrogTown; Urban Theme after volume adjustment |

The manifest must be able to mark a track `candidate`, `approved`, `secondary`, `needs-edit`, or `not-shipped`; the runtime loads only approved local files.

## Player anatomy

The player is a single fixed dock rendered above the footer/ticker and below blocking modals.

### Collapsed dock

- music glyph using the existing Poorup music icon;
- current track title, truncated safely;
- `AUTO THEME` or `CUSTOM` status;
- play/pause button;
- open-player button with `aria-expanded` and `aria-controls`;
- a small block-meter showing approximate progress, never a decorative gradient.

### Expanded dock

- header: `PARLOR MUSIC`, current theme name, `AUTO THEME`/`CUSTOM`, close button;
- track title and credited artist/source label;
- progress range input with elapsed and remaining time;
- previous, play/pause, and next controls;
- shuffle toggle;
- loop toggle;
- volume range input;
- `RESET TO THEME TRACK` action;
- `MOVE PLAYER` action that opens four safe corner choices;
- optional `TRACK INFO` link to the license notice, only when a verified attribution exists;
- polite live-region status for loading, blocked autoplay, errors, theme changes, and fallback.

No player control is duplicated in the topbar. Existing topbar/profile/game music buttons continue to proxy to the canonical global music toggle.

## Interaction model

```text
Theme chosen
  → resolve approved default
  → clear custom track and queue
  → set loop=true
  → crossfade to the new track

Manual track / loop / shuffle change
  → update current-theme queue
  → mark CUSTOM
  → persist sanitized preference

Reset to theme track
  → return to approved default
  → set loop=true
  → mark AUTO THEME
```

### Queue semantics

- Loop on repeats the current queue according to the selected mode.
- Loop off advances through the current theme queue and stops after the final track.
- Shuffle creates a deterministic non-repeating order, keeps a previous-track history, and never immediately repeats the same track.
- Previous restarts the current track when more than three seconds have elapsed; otherwise it selects the previous queue entry.
- A missing or failed seasonal file keeps the previous playable track and announces a bounded error. It never silently falls back to an unapproved URL.
- A new theme selection cancels an in-flight transition, and the newest request wins.

## Audio engine

Use two hidden `<audio>` elements (A/B) and one controller. The active element fades down while the incoming element loads, seeks to zero, and fades up. The controller swaps roles only after the incoming `canplay`/play promise succeeds.

- Theme transition crossfade: 650ms.
- Previous/next crossfade: 350ms.
- If autoplay is blocked, keep the selected source ready and wait for a user gesture.
- The existing default volume of 0.16 remains the initial value; the user can change it from 0 to 1.
- Audio errors, `stalled`, `ended`, and rejected `play()` promises map to explicit accessible statuses.
- No Web Audio graph is required for v1; use HTML media volume ramps so the system remains resilient in browsers that restrict AudioContext.

## Placement and responsive behavior

- Persist only one of `top-left`, `top-right`, `bottom-left`, or `bottom-right`.
- Default is `bottom-left`, offset above the existing ticker.
- Dragging is pointer-supported but always snaps to the nearest safe corner. Arbitrary pixel coordinates are never stored.
- `MOVE PLAYER` exposes the same four positions as a keyboard-native menu.
- The dock clamps against safe areas and the current semantic shell. It cannot cover the board action, chat composer, HUD roll control, rails, focus rings, modal scrims, or legal content.
- Expanded content opens inward from the selected corner and becomes internally scrollable if its height exceeds the viewport.
- iPad landscape keeps a 44px target floor and preserves the board-first desk. Mobile uses a full-width bottom sheet anchored to the selected lower corner when necessary.

## Theme-adaptive visual system

The dock uses semantic custom properties set by the active theme, without changing layout or game semantics:

- `--music-surface`
- `--music-surface-raised`
- `--music-border`
- `--music-accent`
- `--music-text`
- `--music-muted`
- `--music-meter`

Original uses dark teal and gold. Spring uses deep garden green with pale blossom accents. Summer uses dark water teal and restrained amber. Autumn uses copper and umber. Winter uses navy, ice blue, and muted pine. Light uses a pale sky surface with dark blue-green text and the existing semantic red/green states. Every pair must meet the project contrast contract.

## Motion

- Dock open/close: 140ms transform + opacity using the existing strong ease-out curve.
- Track-change status may fade in; no scale-to-zero, `transition: all`, or layout-property animation.
- Audio crossfade is a media-volume ramp, not a CSS animation.
- Reduced motion removes dock travel and decorative meter movement; audio remains functional with a short safe crossfade.
- Hidden SPA views do not create duplicate players. Document-hidden behavior pauses visual UI motion but does not unexpectedly stop an already playing soundtrack.
- Forced colors keeps controls and focus visible with system colors.

## Accessibility

- Native buttons, links, and range inputs with explicit labels and values.
- `aria-pressed` for shuffle/loop, `aria-expanded` for the dock, `aria-controls` for the panel, and `aria-valuetext` for the current track where useful.
- The drag action has a keyboard alternative; no pointer-only feature is required.
- Focus enters the expanded panel on open and returns to the opener on close.
- A polite live region announces theme track changes, blocked playback, errors, and fallback.
- Player artwork is decorative (`aria-hidden=true`); credit/source text is real text.
- No control is reachable behind a modal scrim or when the dock is visually hidden.

## Persistence and privacy

Persist only sanitized local preferences: enabled state (existing key), volume, shuffle, loop, position, and current theme/track ids. Never persist arbitrary URLs, raw audio metadata, account identifiers, room codes, or session tokens through the player. The Storage/Telemetry notice and Licenses page must describe the preference keys and every shipped track.

## File boundaries

- `public/clientMusicData.js`: frozen manifest, default mapping, labels, license metadata, allow-list sanitizers.
- `public/clientMusicPlayer.js`: audio A/B controller, queue, crossfade, persistence, position state, and DOM controller.
- `public/clientAudioControls.js`: delegates global music toggles to the music controller while preserving existing selectors.
- `public/clientTheme.js`: invokes the music controller on theme changes after the visual theme is applied.
- `public/index.html`: one global dock and two audio elements; no duplicate per-view players.
- `public/styles.css`: scoped dock, corner positions, theme tokens, responsive, reduced-motion, and forced-colors rules.
- `public/clientMusicPlayer.test.js`: unit/state tests.
- `public/themeMusicAssetAudit.test.js`: file, manifest, and license checks.
- `qa/music-player.spec.js`: browser interaction and visual contracts.
- `public/assets/audio/README.md`, `docs/design/THEME-MUSIC-CURATION-2026-09-12.md`, and legal notices: provenance and disclosure updates.

## Acceptance criteria

- Selecting any approved theme resets manual selection, enables loop, and crossfades to that theme's default.
- Manual choices never change game state and never survive a later theme change.
- Shuffle, loop, seek, volume, previous, next, reset, four-corner placement, keyboard movement, focus restoration, reduced motion, forced colors, and autoplay rejection are tested.
- There is exactly one player and one canonical music state across all SPA views.
- No page overflow or semantic control occlusion at 1920×1080, 1366×768, 1024×768, iPad landscape, and 390×844.
- Only verified local audio assets are shipped, with attribution in the Licenses notice.
