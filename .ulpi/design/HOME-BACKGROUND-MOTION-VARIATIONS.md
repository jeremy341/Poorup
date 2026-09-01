# Poorup homepage background motion explorations

Status: exploration only. The earlier Night Drive Pass experiment was removed after review; no car asset or car animation remains in production.

## Brief

The current board-free **Parlor Desk** homepage is intentionally quiet: a dark canvas, a static skyline, and one clear Create / Join route. The goal is to add a small amount of life without turning the entry screen into a screensaver or competing with the action desk. The lobby, board, profile, and gameplay surfaces remain out of scope.

The motion bar is set by `animate`, Emil Kowalski's interaction principles, Impeccable's anti-slop checks, `game-ui-ux`'s state-stack model, and the existing accessibility and token rules:

- Every movement must have a purpose: spatial continuity, feedback, state change, or rare delight.
- Home motion is event-driven (home entry / return home / connection restored), never an infinite decorative loop.
- Animate only `transform` and `opacity`; do not animate layout, width, or paint-heavy filters.
- Pointer parallax is gated behind `(hover: hover) and (pointer: fine)` and has a static keyboard/touch fallback.
- `prefers-reduced-motion: reduce` keeps the state/result visible but removes travel, rotation, shake, and looping.
- A home action or keyboard shortcut remains immediate; motion never delays Create, Join, Profile, or Sound.

## Current audit

- `#home-skyline` is static SVG geometry painted by `paintSkyline()`.
- The page already has static scanlines, grain, and vignette layers. These should stay atmospheric rather than animate.
- Existing animations are gameplay/state-specific (`dice-rolling`, live-status blink, token pop, boot/profile entry). They are not reused for the homepage.
- There is no home background loop today, which is a good baseline for evaluating a single purposeful addition.

## Concepts

### 1. Night Drive Pass — superseded

**Purpose:** rare delight and spatial continuity. A tiny pixel vehicle crosses the skyline once when the home screen appears, making the “after-hours” setting feel inhabited without asking the user to watch it.

**Behavior:** a low-contrast vehicle enters from one edge, passes behind the skyline horizon, and exits. The skyline itself does not move. The pass is one-shot per home mount/return, with a cooldown so rapid navigation cannot stack copies. Leaving home interrupts it cleanly.

**Timing and curve:** 12–16 seconds, constant `linear` travel for the vehicle; 180ms opacity in/out. The long duration reads as distance rather than a UI transition. No bounce or overshoot.

**Reduced motion:** no travel; show a parked, low-emphasis vehicle at the horizon (or omit it if the user prefers an even quieter home). The page remains complete without motion.

**Desktop fit:** the pass follows the skyline width at 1920 and 2560; it never changes the layout or the entry desk bounds.

**Risk:** a repeated loop would become decoration. The one-shot trigger and low contrast are non-negotiable.

### 2. Skyline Depth Shift

**Purpose:** spatial depth and responsiveness. A very small pointer-driven offset lets the skyline feel like a physical layer behind the parlor desk.

**Behavior:** pointer position maps to a maximum 4–8px `translate3d` on the skyline wrapper. The action desk and copy remain fixed, preserving hierarchy. It settles as the pointer leaves the stage; no auto-play.

**Timing and curve:** 160–200ms ease-out (`cubic-bezier(0.23, 1, 0.32, 1)`) with interruption-safe updates.

**Reduced motion / fallback:** no movement for touch, keyboard, forced-colors, or reduced-motion users. The skyline remains centered and fully legible.

**Desktop fit:** the offset is capped in pixels, so the effect stays restrained on 1920 and 2560 rather than scaling into a gimmick.

**Risk:** pointer-follow can feel like a toy and has no value on touch. It should only ship as a secondary enhancement after the static layout passes.

### 3. Window Signal Relay

**Purpose:** communicate a real event, not decoration. A short sequence of skyline windows lights up when the client moves from connecting to online (or when a reconnect succeeds), giving the connection state a visual echo.

**Behavior:** three to five preselected windows change opacity/color in a deterministic left-to-right relay. It runs once per connection transition, then stops. The status text remains the authoritative announcement.

**Timing and curve:** 60–120ms stepped changes with a 400–700ms total sequence. No random flicker and no permanent blinking.

**Reduced motion:** apply the final “online” window state instantly; no sequence. Offline/reconnecting keeps the existing text and status color.

**Desktop fit:** the same window coordinates scale with the SVG, so the relay remains aligned at both target widths.

**Risk:** if it is not tied to an actual connection event, it becomes meaningless chrome. This concept needs a small event hook and a clear screen-reader announcement strategy.

### 4. CRT Horizon Sweep — hold for later

**Purpose:** a one-time arrival cue for the first home render or a return from Profile. A soft scan traverses only the skyline horizon and then disappears.

**Behavior:** one 700–900ms `transform`/`opacity` sweep, never repeated on every hover or button press.

**Reduced motion:** show the final highlighted horizon immediately.

**Why it is not the first pick:** without a state transition to explain, this is mostly visual polish. It is safe as a rare arrival cue but weaker than the vehicle's setting-specific story.

## Current direction

The current direction is **House Drift**: reuse the existing skyline buildings already painted by `paintSkyline()` and move a pre-rendered, low-contrast house layer from right to left. No new car or separate background artwork is needed. The implementation uses two identical recycled strips and transform-only motion rather than creating/deleting DOM nodes on every frame. The user explicitly chose the continuously living skyline treatment, so it runs as a slow 28-second linear loop while Home is visible, pauses when Home is hidden, and becomes static under reduced motion.

The earlier Night Drive Pass remains documented as a rejected exploration so its reasoning is not lost, but it is not the implementation target.

## Approval gate

The next step is implementation only after selecting one concept in the chooser. The selected concept will be implemented with:

1. a single home lifecycle trigger and cancellation path;
2. explicit transform/opacity properties and timing tokens;
3. reduced-motion and no-hover fallbacks;
4. a 1920×1080 and 2560×1440 browser check for clipping, contrast, and action reachability;
5. a final motion review against `review-animations` before any additional effect is considered.
