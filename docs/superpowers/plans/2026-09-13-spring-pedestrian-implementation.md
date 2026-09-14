# Spring Pedestrian Sprite and Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five readable, spring-themed pedestrians with deterministic walk, pause, greeting, reverse, and seamless re-entry behavior to the existing Spring Home environment without changing layout, gameplay, server state, or Socket.IO contracts.

**Architecture:** Add a client-only pedestrian controller behind the existing theme-home-world layer. The controller owns a small object pool and a deterministic state machine; SVG frame assets remain local and declarative, while one movement wrapper owns transform and one image owns the current frame. The existing theme renderer mounts the controller only for the visible Home surface when the theme ID is spring and destroys it on theme change.

**Tech Stack:** Vanilla ES modules, DOM spans and images, CSS transform/opacity, local SVG assets, JSON frame metadata, Node assertion tests, Playwright, and the existing Poorup theme renderer. No canvas renderer, sprite dependency, server event, or runtime package is added.

**Spec:** .ulpi/design/SPRING-PEDESTRIAN-SYSTEM.md, .ulpi/design/DESIGN.md, PRODUCT.md.

## Global Constraints

- Use the existing 640×360 master scene and 1920×1080 acceptance target; do not resize the board, Home panels, title, or entry desk.
- Keep walkers behind all Poorup controls, focus rings, modals, and readable text.
- Use integer SVG geometry, shape-rendering=crispEdges, no filters, gradients, external URLs, SVG text nodes, or anti-aliased colored halos.
- Keep each character to 8–12 colors plus transparency, one-pixel outline, and a consistent top-left light source.
- Animate only wrapper transform and bubble opacity. Do not animate layout properties, scale, rotation, filters, or keyboard actions.
- Use a linear timebase for route motion, accumulated frame time to prevent frame skipping, and reset only after the full sprite is off-canvas.
- Maximum three visible walkers, minimum 52 master-pixel separation, feet baseline y=330.
- The layer is aria-hidden, pointer-events:none, and has no focusable or interactive descendants.
- Hidden Home, document-hidden, reduced-motion, and forced-colors states pause or freeze the layer.
- The controller never reads room, player, turn, cash, account, or telemetry state and never emits Socket.IO events.

## File map

| Responsibility | Files |
|---|---|
| Art and frame metadata | public/assets/themes/spring/pedestrians/*.svg, public/assets/themes/spring/pedestrians/pedestrians.json |
| Asset contract tests | public/themeAssetAudit.test.js |
| State machine | public/clientThemePedestrians.js, public/clientThemePedestrians.test.js |
| Theme integration | public/clientThemeData.js, public/clientThemeRender.js, public/clientTheme.test.js |
| Presentation | public/styles.css |
| Browser evidence | qa/spring-pedestrians.spec.js, qa-artifacts/spring-pedestrians-1920/ |

## Task 1: Create and validate the SVG frame package

**Files:**

- Create: 30 character SVG frames under public/assets/themes/spring/pedestrians
- Create: public/assets/themes/spring/pedestrians/greeting-nice-seeing-you.svg
- Create: public/assets/themes/spring/pedestrians/pedestrians.json
- Modify: public/themeAssetAudit.test.js

**Interfaces:**

- Every character frame uses viewBox 0 0 24 36 and baseline y=330 when placed at the scene level.
- pedestrians.json exposes frameWidth=24, frameHeight=36, baselineY=330, and a frame map keyed by character and tag.
- The runtime resolves a frame with frames[characterId][tag][frameName] and receives a URL string.

- [ ] Step 1: Add the asset test that enumerates the five character directories, expects six frames per character plus the greeting and manifest, and asserts every path exists.
- [ ] Step 2: Add XML checks for xmlns, viewBox, shape-rendering=crispEdges, absence of text/filter/linearGradient/radialGradient/external href, integer coordinate tokens, and no JPEG references.
- [ ] Step 3: Run node public/themeAssetAudit.test.js and confirm it fails before the assets exist.
- [ ] Step 4: Draw walker-01 through walker-05 using the exact heights, skin ramps, clothing colors, hair silhouettes, outline weights, and frame poses in the design specification. Keep every frame cell 24×36 and feet on the same baseline.
- [ ] Step 5: Draw greeting-nice-seeing-you.svg as an 88×28 path-converted two-line bubble with a one-pixel tail. Do not use an SVG text node.
- [ ] Step 6: Add pedestrians.json with walk durations 110/90/110/90ms, front-idle 360ms, front-wink 420ms, asset URLs, and the tag lists walk, idle, and greet.
- [ ] Step 7: Run node public/themeAssetAudit.test.js and verify PASS.
- [ ] Step 8: Inspect all character silhouettes at 1x and at the native 1920×1080 Home screenshot; remove detail that disappears or creates a halo.
- [ ] Step 9: Commit with feat: add spring pedestrian pixel frame package.

## Task 2: Implement the deterministic pedestrian state machine

**Files:**

- Create: public/clientThemePedestrians.js
- Create: public/clientThemePedestrians.test.js

**Interfaces:**

- createSpringPedestrianLayer({ root, assetBase, manifest, random, now, reducedMotion }) returns an object with mount(), tick(timestamp), pause(reason), resume(reason), destroy(), and snapshot().
- snapshot() returns { mounted, pausedReasons, walkers: [{ id, characterId, state, direction, x, frame, visible }] }; it never includes account, room, or game fields.
- The controller keeps MAX_VISIBLE=3, MIN_SEPARATION=52, BASELINE_Y=330, and MAX_DELTA_MS=100 exported for tests.

- [ ] Step 1: Write failing tests with a seeded random sequence for left entry, right entry, walk, pause, greet, reverse, exit, and opposite-side reuse.
- [ ] Step 2: Add a test that advances 16ms frames for 500ms and asserts x movement is monotonic in the chosen direction and frame timing consumes accumulated time rather than resetting elapsed time.
- [ ] Step 3: Add tests for a long paused frame, hidden-view pause, reduced-motion freeze, forced-colors freeze, maximum three visible walkers, and 52-pixel separation.
- [ ] Step 4: Add tests that inspect every generated node for aria-hidden=true, pointer-events:none, no tabindex, no role, and no event listener registration.
- [ ] Step 5: Run node public/clientThemePedestrians.test.js and confirm the missing-controller failures.
- [ ] Step 6: Implement each walker as a movement span, image element, and optional greeting image. Use requestAnimationFrame only while mounted and not paused. Clamp timestamp deltas to MAX_DELTA_MS.
- [ ] Step 7: Advance position with x += direction * speed * deltaMs / 1000, update only wrapper.style.transform = translate3d(xpx, ypx, 0), and update the image source only when the manifest frame duration expires. Consume elapsed time in a loop so a backgrounded frame cannot skip the next pose.
- [ ] Step 8: Implement states exactly: ENTER starts beyond -36 or 676; WALK uses 8–12 master px/s; PAUSE holds 1.2–2.4 seconds; GREET uses front-idle/front-wink and the bubble for 1.2 seconds with probability 0.18; REVERSE uses probability 0.12; EXIT recycles only after the entire wrapper is outside the route clip.
- [ ] Step 9: When recycling, select the opposite entry side and reset state while off-canvas. Never set an on-screen x value during a visible frame.
- [ ] Step 10: Run node public/clientThemePedestrians.test.js and verify PASS.
- [ ] Step 11: Commit with feat: add deterministic spring pedestrian controller.

## Task 3: Integrate the controller with the existing theme renderer

**Files:**

- Modify: public/clientThemeData.js
- Modify: public/clientThemeRender.js
- Modify: public/clientTheme.test.js

**Interfaces:**

- Spring theme data adds homeProps.pedestrians with assetBase, manifest, and greeting paths; it does not add a server or game-state field.
- renderThemeScene("spring", "home") mounts the controller after the scene/props are inserted.
- renderThemeScene for page and board never mounts pedestrians.
- Rendering a non-spring theme calls destroy() and removes every pedestrian node.

- [ ] Step 1: Add theme tests asserting Spring has the pedestrian manifest, Original/Summer/Autumn/Winter/Light do not receive Spring nodes, and page/board markup has no pedestrian layer.
- [ ] Step 2: Run node public/clientTheme.test.js and record the integration failure.
- [ ] Step 3: Add a small controller registry inside clientThemeRender.js keyed by surface and theme ID. Keep one controller instance for Home and replace it only after destroying the previous instance.
- [ ] Step 4: Mount only when #view-home exists and is not hidden. Reconcile visibility with the existing view-change and visibilitychange hooks.
- [ ] Step 5: Ensure theme transitions, profile selector changes, and reconnect snapshots never pass into the controller.
- [ ] Step 6: Run node public/clientTheme.test.js, node public/themeAssetAudit.test.js, and the existing client theme suite.
- [ ] Step 7: Commit with feat: mount spring pedestrians through theme lifecycle.

## Task 4: Add pixel-safe presentation and pause rules

**Files:**

- Modify: public/styles.css
- Modify: public/clientThemeRender.js
- Test: public/clientResponsiveA11y.test.js

**Interfaces:**

- .theme-spring-pedestrians is an absolutely positioned, clipped, pointer-transparent layer inside #theme-home-world.
- .theme-spring-pedestrian owns no layout transition; .theme-spring-pedestrian-motion owns transform; .theme-spring-pedestrian-frame owns image dimensions.
- .theme-motion-paused and prefers-reduced-motion: reduce pause or freeze without hiding the scene’s readable UI.

- [ ] Step 1: Add CSS contract assertions for contain:paint, pointer-events:none, image-rendering:pixelated, fixed baseline mapping, and absence of transition:all.
- [ ] Step 2: Add the reduced-motion test that expects no walk/greet keyframe or transform change while the media query is active.
- [ ] Step 3: Run the focused client test and observe the missing selectors.
- [ ] Step 4: Add the layer rules using existing Poorup spacing, z-index, and motion tokens. Keep movement in the wrapper transform and greeting entrance/exit opacity at 160ms/120ms with the existing strong ease-out curve.
- [ ] Step 5: Add forced-colors rules that retain a static high-contrast silhouette and hide the decorative greeting if it cannot meet system contrast.
- [ ] Step 6: Run node public/clientResponsiveA11y.test.js and the client lint.
- [ ] Step 7: Commit with fix: keep spring pedestrian motion pixel-safe and accessible.

## Task 5: Browser QA and visual evidence

**Files:**

- Create: qa/spring-pedestrians.spec.js
- Modify: qa/playwright.config.js only if the existing fixture cannot select Spring
- Create: qa-artifacts/spring-pedestrians-1920/README.md

**Interfaces:**

- The browser test selects the existing Profile LOOK control, chooses Spring, and reads only DOM/test hooks; it does not alter server state.
- The screenshot set uses exact names home-spring-1920.png, home-spring-1366.png, home-spring-ipad-landscape.png, and home-spring-390.png.

- [ ] Step 1: Add a browser test that selects Spring, waits for the Home layer, and asserts three or fewer walkers, correct baseline, no page overflow, and no UI occlusion.
- [ ] Step 2: Add a frame-smoothness assertion by sampling wrapper transform over consecutive animation frames and rejecting a repeated transform followed by a large visible jump while the document is visible.
- [ ] Step 3: Add keyboard and screen-reader assertions that the chooser retains focus behavior and pedestrian nodes never enter the accessibility tree.
- [ ] Step 4: Add reduced-motion, forced-colors, hidden-Home, and theme-switch tests.
- [ ] Step 5: Run npx playwright test -c qa/playwright.config.js qa/spring-pedestrians.spec.js at the five required viewport classes.
- [ ] Step 6: Capture and inspect the Home screenshot at native 1920×1080. Confirm feet alignment, silhouette readability, quiet zones, greeting placement, and smooth re-entry.
- [ ] Step 7: Record viewport, commit, browser, and result in qa-artifacts/spring-pedestrians-1920/README.md.
- [ ] Step 8: Commit with test: verify spring pedestrian motion across viewports.

## Task 6: Motion, accessibility, and architecture review

**Files:**

- Review the complete diff from Tasks 1–5.
- Create: docs/audit/spring-pedestrian-review-2026-09-13.md

**Interfaces:**

- Review output lists each finding with file, line, severity, evidence, and the exact regression command.
- The review may reject motion or simplify it; it may not add game state, new navigation, or a second renderer.

- [ ] Step 1: Run svg-design and pixel-art-sprites validation against all 32 assets.
- [ ] Step 2: Run Pixel Art Animator review against the six-frame metadata, timing, tags, and accumulated-time playback.
- [ ] Step 3: Run animate, emilkowal-animations, improve-animations, design-motion-principles, and review-animations against the CSS/JS motion. Delete any motion that lacks purpose; reject layout-property animation, scale(0), ease-in, ungated hover, or keyboard-triggered movement.
- [ ] Step 4: Run frontend-design-review, game-ui-ux, mobile-responsiveness, accessibility, web-design-guidelines, impeccable, and design-taste-frontend against the native screenshots and accessibility tree.
- [ ] Step 5: Run code-architecture-review and the thermo-nuclear maintainability lens on the controller and renderer integration. Confirm no circular dependency or growing global state.
- [ ] Step 6: Resolve any P0/P1 finding with a failing regression test, rerun the focused suite, and update the review report.
- [ ] Step 7: Commit with chore: review spring pedestrian implementation.

## Acceptance criteria

- All five characters have six valid SVG frames and a shared path-converted greeting bubble.
- Walkers move continuously from either side, use accumulated frame time, pause, greet, reverse, and recycle off-canvas without visible teleporting.
- Spring is the only theme that mounts this system; switching themes removes it completely.
- The board, Home layout, fonts, controls, server, game state, Socket.IO contracts, and telemetry are unchanged.
- Reduced motion, forced colors, hidden views, keyboard navigation, focus, and screen-reader output remain correct.
- Unit, asset, client, browser, lint, and native 1920×1080 visual checks pass.
