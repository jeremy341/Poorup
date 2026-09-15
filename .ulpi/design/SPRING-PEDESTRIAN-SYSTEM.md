# Spring Pedestrian System — Design Specification

## Design Read

Spring should feel like the Poorup neighborhood waking up after the ledger closes: small human moments on the existing park path, readable at one glance, and quiet enough that the board and entry desk remain the protagonists.

## Locked direction

**Bloom Ledger Walkers** is an authored pixel-parlor vignette, not a generic particle system. Five recognizable pedestrians share one 1x pixel grid, walk along the existing Spring path, occasionally turn toward the viewer, and return to the route without visible teleporting. The system is decorative and client-only.

The current Poorup design authority remains unchanged:

- 640×360 master scene, presented at the existing 1920×1080 target;
- Pixelify Sans/Courier fallback and existing UI type;
- square geometry, 1px outlines, dark teal surfaces, gold structure;
- no new navigation, controls, game state, Socket.IO event, or server field;
- no speech-bubble UI treatment outside the environment layer.

## Characters

Five characters are authored as a coherent set. Their differences are carried by silhouette, height, hair, clothing blocks, and skin-tone ramps rather than noisy detail.

| ID | Height at 1x | Skin ramp | Hair | Clothing | Silhouette cue |
|---|---:|---|---|---|---|
| walker-01 | 18 master px | warm umber | short cap | spring green jacket, navy trousers | compact, cap peak |
| walker-02 | 22 master px | deep cocoa | cropped curls | coral coat, cream trousers | square shoulder bag |
| walker-03 | 26 master px | golden brown | long braid | teal hoodie, rust trousers | tall, braid offset |
| walker-04 | 29 master px | deep sienna | close-cut hair | violet windbreaker, olive trousers | broad stance |
| walker-05 | 33 master px | light peach | brim hat | mustard cardigan, blue trousers | tallest, hat crown |

All characters use:

- a 24×36 master-pixel frame cell with feet on y=330;
- a 1px cool outline selected from the local silhouette ramp;
- top-left light source, bottom-right shadow, and no pillow shading;
- 8–12 colors per character including outline, skin, hair, two clothing ramps, shoe, and one accent;
- hard edges and no semi-transparent colored pixels;
- front and side poses that remain recognizable when filled as one solid silhouette.

## Frame set

Each character receives six authored SVG frames. The side frames are distinct; CSS mirroring is not used for face or clothing detail.

| Frame | Purpose | Pose | Duration |
|---|---|---|---:|
| walk-contact-r | right-facing contact, forward leg | weight low, arm opposite leg | 110ms |
| walk-pass-r | right-facing passing | body high, trailing heel lifted | 90ms |
| walk-contact-l | left-facing contact | mirrored composition with authored asymmetry | 110ms |
| walk-pass-l | left-facing passing | authored asymmetry | 90ms |
| front-idle | facing camera | neutral eyes, weight centered | 360ms |
| front-wink | facing camera | one eye closed, hand half-raised | 420ms |

Frame metadata is kept in a checked-in JSON manifest so the runtime never guesses dimensions:

~~~json
{
  "frameWidth": 24,
  "frameHeight": 36,
  "baselineY": 330,
  "directions": ["left", "right", "front"],
  "tags": {
    "walk": ["walk-contact-r", "walk-pass-r", "walk-contact-l", "walk-pass-l"],
    "idle": ["front-idle"],
    "greet": ["front-idle", "front-wink"]
  }
}
~~~

## Asset package

Create these local assets under public/assets/themes/spring/pedestrians:

- walker-01-walk-contact-r.svg
- walker-01-walk-pass-r.svg
- walker-01-walk-contact-l.svg
- walker-01-walk-pass-l.svg
- walker-01-front-idle.svg
- walker-01-front-wink.svg
- walker-02-walk-contact-r.svg
- walker-02-walk-pass-r.svg
- walker-02-walk-contact-l.svg
- walker-02-walk-pass-l.svg
- walker-02-front-idle.svg
- walker-02-front-wink.svg
- walker-03-walk-contact-r.svg
- walker-03-walk-pass-r.svg
- walker-03-walk-contact-l.svg
- walker-03-walk-pass-l.svg
- walker-03-front-idle.svg
- walker-03-front-wink.svg
- walker-04-walk-contact-r.svg
- walker-04-walk-pass-r.svg
- walker-04-walk-contact-l.svg
- walker-04-walk-pass-l.svg
- walker-04-front-idle.svg
- walker-04-front-wink.svg
- walker-05-walk-contact-r.svg
- walker-05-walk-pass-r.svg
- walker-05-walk-contact-l.svg
- walker-05-walk-pass-l.svg
- walker-05-front-idle.svg
- walker-05-front-wink.svg
- greeting-nice-seeing-you.svg
- pedestrians.json

The greeting asset is a decorative, path-converted pixel bubble. It contains the two-line phrase NICE / SEEING YOU as vector paths, not an SVG text node. It is 88×28 master pixels, has a 1px tail, and is rendered only beside a pedestrian on the path.

Every SVG must use:

- xmlns and a viewBox;
- integer-aligned coordinates;
- shape-rendering=crispEdges;
- no filters, gradients, external URLs, editor metadata, or text nodes;
- no UI controls, borders, or game labels inside the artwork;
- explicit width and height when used as an image;
- a transparent background with no anti-aliased halo.

## Placement and quiet zones

The Spring scene path occupies approximately y=307–330 in the 640×360 master. The pedestrian manager uses:

- baselineY=330;
- x spawn positions from -36 through 676;
- a route band of y=294–330;
- one optional foreground flower occlusion mask already present in scene.svg;
- no pedestrian pixels inside the title quiet zone x=28–230, y=130–250;
- no pedestrian pixels inside the entry desk zone x=370–620, y=98–270;
- a maximum of three visible walkers at once, selected from the five-character catalog;
- a minimum horizontal separation of 52 master pixels between walkers.

At 1920×1080, the environment scales through the existing scene image. At smaller widths, the route remains clipped by the existing world layer and the renderer never shrinks a sprite below 1x readability.

## Runtime state machine

Create a client-only module named clientThemePedestrians.js. It owns no game state and is mounted only when the Home surface is visible and theme ID is spring.

~~~text
ENTER → WALK → (PAUSE | GREET | REVERSE) → WALK → EXIT
~~~

State rules:

- ENTER starts fully off-canvas on the left or right and eases no layout property; position is transform-only.
- WALK advances at 8–12 master px/second. Frame cadence follows the manifest durations and is independent of render refresh rate.
- PAUSE occurs after a seeded random route distance with a 1.2–2.4 second idle hold.
- GREET occurs with probability 0.18 after a pause, shows front-idle then front-wink and the greeting bubble for 1.2 seconds, then returns to the previous direction.
- REVERSE occurs with probability 0.12 at a pause, changes direction only after the sprite is fully settled, and uses an authored side frame for the new direction.
- EXIT waits until the entire sprite and bubble are outside the route clip, then reuses the object from the opposite side. There is no visible wrap.
- A walker cannot greet or reverse while another walker occupies the minimum separation interval.

The random source is injectable. Production uses a small deterministic seed derived from the current Home mount; tests use a fixed sequence so route behavior is reproducible.

## Renderer interface

The module exposes:

~~~js
createSpringPedestrianLayer({ root, assetBase, random, now, reducedMotion })
mount()
tick(timestamp)
pause(reason)
resume(reason)
destroy()
snapshot()
~~~

The existing theme renderer calls mount and destroy from the Home surface lifecycle. It does not pass room, player, turn, cash, or telemetry data.

DOM contract:

- root is #theme-home-world;
- each walker is a span with aria-hidden=true and data-pedestrian-id;
- the movement wrapper owns transform;
- the image element owns frame source;
- the bubble is a sibling inside the walker wrapper and has pointer-events:none;
- no element has tabindex, role=button, title, or event handler;
- the layer has contain:paint and remains below all Poorup UI surfaces.

## Motion and pause behavior

- Movement updates only wrapper transform.
- Frame changes are discrete image swaps at the manifest durations; no scale, rotation, layout property, or filter animation.
- Walk motion uses a linear timebase because the path is a repeating band.
- Greeting enters with opacity over 160ms and exits over 120ms using the existing strong ease-out curve.
- No animation runs from keyboard actions.
- Hidden Home views, document-hidden state, reduced motion, and forced colors pause the manager.
- Reduced motion renders one static side walker per visible slot with no walking, greeting, reverse, or random frame changes.
- A user motion preference, if the existing preferences surface gains one later, calls the same pause API; it does not alter game state.
- prefers-reduced-motion and forced-colors styles are tested, not inferred from a browser default.

## Accessibility

This is decorative scenery:

- the root and every child are aria-hidden=true;
- no greeting text is exposed to assistive technology because it is not an interactive communication channel;
- game-relevant announcements never use this layer;
- focus rings and modal scrims render above it;
- contrast is checked against the Spring scene and the dark UI shell;
- no color is the only cue for a state because no state is actionable.

## Testing and visual review

Unit tests in public/clientThemePedestrians.test.js cover:

- five catalog entries and six frames per entry;
- integer frame dimensions and baseline;
- deterministic walk, pause, greet, reverse, and exit transitions;
- left and right entry;
- no visible wrap at the viewport boundary;
- maximum three visible walkers and minimum separation;
- reduced-motion and hidden-view pause;
- no server-state reads or Socket.IO emissions;
- aria-hidden and no-focusable descendants.

Asset tests in public/themeAssetAudit.test.js cover:

- all 32 SVG/JSON files resolve;
- no text, filter, gradient, external URL, decimal coordinate, or JPEG reference;
- shape-rendering=crispEdges is present;
- all frame viewBoxes are 24×36;
- each palette stays within 12 colors plus transparency;
- no semi-transparent colored edge pixels.

Browser tests in qa/spring-pedestrians.spec.js run at 1920×1080, 1366×768, 1024×768 landscape, iPad landscape, and 390×844. They assert no page overflow, no UI occlusion, no focus changes, and stable reduced-motion screenshots.

The 1920×1080 review checks:

- walkers stay on the path;
- feet share one baseline;
- silhouettes read at 1x;
- the greeting never covers the title, entry desk, status strip, or focus ring;
- motion is smooth rather than frame-skipping;
- switching themes destroys all spring walker nodes.

## Design pre-flight

- [x] One distinctive direction tied to Poorup’s parlor fiction.
- [x] Existing layout, fonts, board, and UI tokens remain authoritative.
- [x] Five characters have distinct silhouettes and accessible palette contrast.
- [x] Walk, idle, greet, reverse, pause, entry, and exit states are specified.
- [x] Reduced motion, hidden views, forced colors, and focus layering are specified.
- [x] No server/game state coupling.
- [x] No SVG text, gradients, filters, anti-aliased halos, or UI drawn into artwork.
- [x] 1920×1080 visual acceptance is explicit.

## Build handoff

Implement exactly this specification in the existing vanilla client. Extend the current theme renderer; do not redesign the Home layout, replace the scene, or introduce a canvas engine. Keep the system decorative, deterministic in tests, pause-aware, and removable on theme change.
