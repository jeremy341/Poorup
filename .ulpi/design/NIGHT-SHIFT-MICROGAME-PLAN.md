# Night Shift — corrected arcade-mode plan

Status: design plan only. No gameplay source changes are authorized by this
document.

## Product intent

Night Shift is a secret, local-only arcade game layered into the existing Home
screen. `Ctrl+P` starts it. The animated Poorup skyline and moving house track
remain visible underneath; the ordinary Home header, title copy, room-entry
panel, quick-table controls, and ticker are hidden while the mode is active.
The only persistent mode readouts are the countdown/clock at top-left, score at
top-right, and the compact lives/wave status needed to play. Exiting returns to
the unchanged Home state and never mutates a room, account, or board session.

The design keeps the After-hours Game Parlor identity: Pixelify Sans display
type, dark teal surfaces, gold structural strokes, restrained red/orange VFX,
crisp pixel edges, and transform-only motion.

## Player loop and state model

1. **Idle:** Home behaves normally; Parlor Patrol may still fly by after its
   existing delay.
2. **Briefing:** `Ctrl+P` opens a transparent modal interaction layer, pauses
   the normal patrol and local clock, announces `WAVE 01`, and gives the player
   three hearts.
3. **Active wave:** each wave lasts 60 seconds. Targets spawn in a staggered
   stream, the score updates on successful tags, and a target crossing the
   skyline border costs one heart. The recommended rule is universal for all
   hostile aircraft so players cannot ignore a fast class; the helicopter is
   still the most visible escape threat.
4. **Wave transition:** at zero, clear remaining targets, increment the wave,
   announce the new wave, and continue indefinitely. Do not reset hearts or
   score between waves.
5. **Result/exit:** zero hearts shows `SHIFT LOST`; an optional manual exit or
   Escape closes the mode after the result announcement. Best score persists
   locally only.

The mode owns a small explicit state machine (`idle`, `briefing`, `active`,
`result`) so timers cannot restart from unrelated Home or Socket.IO updates.
All timers are cleared on exit, visibility changes, and a new wave. Dynamic
targets are native buttons with labels, not anonymous pointer-only divs.

## Aircraft behavior

| Class | Arrival | On hit | Escape rule | Role |
| --- | --- | --- | --- | --- |
| Police helicopter | Left/right lateral pass | Immediate Home-style impact flash plus stepped smoke at the exact click location | −1 heart | Core target; readable and rewarding |
| Drone | Short top/diagonal drop or quick lateral pass | **Immediate** freeze-and-pop; use a larger 96–112px red/orange explosion with square debris and no falling crash path | −1 heart | Faster pressure target from wave 2 |
| Airplane | Wave 4+ high-speed top entry | Immediate red/orange detonation, slightly wider hit area and brief contrail | −1 heart | Rare escalation target |
| Beacon/power-up (optional) | Slow top drop | Gold/teal burst; never obscures a hostile | No life penalty | Bonus target only if playtesting shows it improves clarity |

The helicopter now uses the same compact impact/smoke feedback as the normal Home
patrol. There is no post-hit teleport, fall, or border landing. The drone and
airplane are intentionally legible opposites: a decisive, larger detonation on
the spot with a red/orange tint. If a future design wants non-hostile beacons,
they must use a clear gold/teal treatment and never look like a life-bearing
target.

### Wave scaling

- Wave 1: helicopters plus one guaranteed drone showcase; 6–8 targets, generous lateral duration.
- Wave 2: helicopters + drones; 8–12 targets, shorter spawn interval.
- Wave 3: mixed classes; 12–16 targets, controlled concurrency cap.
- Wave 4+: rare airplanes, tighter lanes, mild speed increase, and a hard cap
  of roughly 8–10 live targets so the skyline stays readable.
- Keep a minimum spawn interval and a maximum on-screen target count. Difficulty
  should increase through composition and timing, not by shrinking hit areas.

Suggested scoring is fixed per class plus a wave multiplier (helicopter highest,
drone medium, airplane high-risk/high-reward). Misses never award points.
Show `TAGGED +N` in the live status region without duplicating it into chat.

## Layering and interaction architecture

- Keep the existing Home DOM and house-drift track as the visual base.
- Toggle one `night-shift-open` body class to hide normal Home controls and make
  them inert; do not put an opaque board-colored background over the skyline.
- Mount a transparent fixed layer for targets, effects, and the mode HUD. The
  HUD may contain countdown, score, lives, wave announcement, and `EXIT MODE`;
  it must not recreate the Home room-entry cards.
- Pause normal patrol and local-time timers while the mode is active. The mode
  countdown becomes the authoritative top-left time readout; the mode score is
  authoritative top-right. Restore both Home systems on exit.
- Leave `state.suppressRoomUpdates` enabled for the duration so stale room
  snapshots cannot repaint Home; reset it when the player explicitly enters a
  parlor.
- Reuse the existing Poorup cursor reticle and only the retained CC0 helicopter
  hit sound. Music remains independently controlled by the global Music On/Off
  preference; no new UI sound effects are required for this mode.

## Motion specification

- Helicopter hit: reuse the Home patrol’s 8-frame impact and 6-frame smoke
  animations, positioned from the exact click point. The impact lasts roughly
  520ms and smoke follows for roughly 760ms; no travel path is applied.
- Drone/airplane detonation: 8–10 stepped frames, approximately 500–800ms;
  scale/opacity only, with a large red core, orange mid-ring, gold pixel
  shards, and a brief darker smoke tail.
- Wave banner: one rare 700–900ms scale/opacity announcement. It must not loop.
- Use `steps()` for sprite frames, transform/opacity for layout-safe motion, and
  gate hover-only movement behind `(hover: hover) and (pointer: fine)`.
- `prefers-reduced-motion: reduce` keeps state feedback and sprite visibility,
  removes travel/rotation/shake/looping, and resolves a hit in place.

## Asset plan

### Existing assets to retain

- `helicopter-16-frames.svg` and mirrored left-facing wrapper
- `helicopter-crash-12-frames.svg` (retained original art, not used by the active
  Night Shift hit path)
- `drone-8-frames.svg`
- `beacon-6-frames.svg`
- `impact-8-frames.svg`, `smoke-6-frames.svg`, `heart.svg`, `crosshair.svg`

### New Poorup-native assets

1. `drone-explosion-10-frames.svg` — 96–112px square, red/orange first,
   gold highlights, square debris, transparent background.
2. `airplane-10-frames.svg` — compact side silhouette with a restrained
   red/blue navigation blink and a 10-frame engine shimmer.
3. `airplane-explosion-10-frames.svg` — wider version of the drone burst with
   a short contrail fragment.
4. `spiral-trail-8-frames.svg` — retained original art for future experiments;
   not used by the current active hit path.
5. `debris-6-frames.svg` — tiny impact shards used only at the border.

Every file should use transparent backgrounds, `shape-rendering="crispEdges"`,
stable frame IDs, the locked Poorup palette, and a static first-frame fallback.
SVGs are authored/redrawn to match Poorup rather than dropped in unchanged from
another game.

## Original-art rule

No external sprite, silhouette, SVG, or animation reference is part of this
implementation. Every aircraft, crash, explosion, smoke trail, debris shard,
heart, and cursor treatment is designed from scratch for Poorup. This keeps the
visual language cohesive and avoids accidental license or attribution debt.

The art pass starts from the locked Poorup tokens and a small pixel grid, then
builds original silhouettes with the SVG primitives and paths described above.
Each frame is hand-authored for readable motion at the intended display size;
there is no dependency on a downloaded asset pack.

The asset README should record `original Poorup artwork`, frame dimensions,
palette tokens, and the authoring date rather than third-party source links.

## Applicable skill workflow

Use all applicable local skills in this order and record their findings in the
design/QA notes:

1. `frontend-design-ui-ux` — lock the interaction model, layering, states, and
   responsive desktop spec.
2. `frontend-design`, `design-taste-frontend`, and both `impeccable` variants —
   preserve the anti-slop Poorup direction and audit hierarchy, density,
   clarity, responsive behavior, and visual craft.
3. `game-ui-ux` — validate the HUD, wave state, focus navigation, safe areas,
   and state stack at desktop resolutions.
4. `copywriting` — keep wave, score, life, miss, result, and help copy concise,
   truthful, and consistent with the parlor voice.
5. `pixel-art-sprites` and `pixel-art-animator` — author the original limited
   palette sprites, frame timing, tags, and static fallbacks.
6. `svg-design` — build and optimize the original SVG frame assets, IDs,
   crisp-edge rendering, and accessibility-safe metadata.
7. `animate` and `emilkowal-animations` — choose purpose-driven motion,
   transform-only properties, easing, interruption, and timing.
8. `improve-animations` and `review-animations` — run the read-only motion
   audit and final motion verdict, including reduced-motion behavior.
9. `accessibility`, `mobile-responsiveness`, and `web-design-guidelines` —
   check keyboard behavior, focus, forced colors, zoom, contrast, and the
   compact fallback without redesigning mobile.
10. `critique` and `frontend-design-review` — perform the final visual,
    hierarchy, trust, and anti-slop review.
11. `systematic-debugging`, `code-architecture-review`, and
    `software-architecture-design` — trace state/timer bugs to their source,
    keep the local mode isolated, and prevent regressions in the Socket.IO game.
12. `find-skills` — discover any missing local capability before implementation;
    do not use it to import outside artwork.
13. Browser-control verification — inspect the live Home page and exercise the
    mode at exact 1920×1080 and 2560×1440 states.

## Accessibility and safety gates

- `role="dialog"`, `aria-modal`, labelled title/description, and one focus trap.
- Escape and the visible exit button always work; focus returns to the Home
  trigger when the mode closes.
- Live region announces wave changes, score awards, escapes, remaining hearts,
  and result once each. Chat remains separate.
- Visible focus, 44px preferred targets, forced-colors-safe borders, and no
  color-only target semantics.
- Pause/stop motion when the tab is hidden; resume with remaining time rather
  than silently advancing the wave.

## Verification checklist

1. At 1920×1080 and 2560×1440, Home remains visible beneath Night Shift with no
   opaque mask, horizontal overflow, or layout jump.
2. `Ctrl+P` works only on Home and does not fire from text inputs or in a room.
3. Normal Home UI is hidden/inert; only mode HUD, targets, and effects are
   interactive.
4. Helicopter hit visibly uses the Home impact and smoke frames at the click
   location, with no teleport or off-screen fall.
5. Drone and airplane hits pop immediately with the larger red/orange burst.
6. Any escaped hostile costs one heart; zero hearts ends the shift cleanly.
7. Wave timer, score, best score, Escape, reduced motion, refresh, and stale
   Socket.IO snapshots restore correctly.
8. `node --check`, SVG/XML validation, `git diff --check`, and console-error
   checks pass. No `transition: all` or layout-property animation is introduced.
