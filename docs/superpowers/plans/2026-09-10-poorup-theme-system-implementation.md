
# Poorup Theme System Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Every task uses checkbox steps and ends with verification.

**Goal:** Add six selectable environmental themes to Poorup while preserving every existing game rule, server contract, component position, layout, interaction flow, and readable UI surface.

**Architecture:** Keep the current vanilla HTML, CSS, and ES-module client. Add one client-only Theme Registry, one renderer for decorative environment layers, and one preference/selector controller. The server, Socket.IO events, game state, board indexes, rules, player actions, and economy remain untouched. Existing Home and board skyline hooks are extended rather than replaced, so the environment changes around the UI without creating a second renderer or rules engine.

**Tech Stack:** Existing vanilla HTML/CSS/JavaScript modules, localStorage for the local appearance preference, inline or img SVG scenery, existing Pixelify/Silkscreen/mono fonts, existing Playwright suite, Node assert contract tests, and the current Impeccable, accessibility, pixel-art, SVG, and motion review workflow. No new runtime dependency.

**Spec:** .ulpi/design/THEME-SYSTEM-VISUAL-BRAINSTORM.md and .ulpi/design/DESIGN.md

## Global Constraints

- Preserve the current Poorup terminal/parlor design language: dark teal surfaces, warm gold rules, restrained red actions, square geometry, compact density, pixel/mono type, and crisp SVG art.
- Do not change page layout, component positions, spacing structure, navigation, card structure, information hierarchy, dashboard composition, interaction flow, responsive behavior, board dimensions, or control sizes.
- Standard-40 and Metro-52 board contracts, tile IDs, indexes, prices, ownership, tokens, and server behavior remain behavior-compatible.
- Themes are client-only cosmetic preferences. They never change a ruleset, round state, server snapshot, economy value, account permission, or achievement requirement.
- Use exactly these six approved themes: midnight-ledger, clearline-day, bloom-district, golden-hour-exchange, rainy-copper-town, and warm-window-snow-city.
- Keep semantic colors stable. Theme accents are environmental only and never replace success, danger, player, property-group, payment, or focus colors.
- Use only the existing Poorup surface stack and token values. No glassmorphism, pill-heavy controls, gradient text, emoji controls, generic component library, or full-screen raster backgrounds.
- Decorative layers have pointer-events none, aria-hidden true, bounded dimensions, and a lower z-index than the existing UI, board, HUD, modals, drawers, and focus rings.
- Animate only transform and opacity with explicit properties. Use the existing stepped/ease-out vocabulary, no transition all, no scale zero, no keyboard-action animation, and no ungated hover motion.
- Honor prefers-reduced-motion, forced colors, 200 percent zoom, keyboard navigation, screen readers, touch targets, safe areas, and visibility changes.
- Every implementation slice must be visually confirmed at 1920 x 1080 before it is considered complete. The final pass also covers 1366 x 768, 1024 x 768, iPad landscape, and 390 x 844.
- Do not modify or create server modules. Do not add a server endpoint or Socket.IO event for themes.

## Skill workflow

Read the current .ulpi/design/DESIGN.md and this plan before every slice. Apply the relevant guidance from frontend-design-ui-ux, design-taste-frontend, frontend-design, frontend-design-review, critique, impeccable, game-ui-ux, mobile-responsiveness, accessibility, web-design-guidelines, svg-design, pixel-art-sprites, animate, emilkowal-animations, improve-animations, review-animations, tdd, qa-agent-testing, and find-skills. The local catalog already covers this work, so do not install another package.

The design read stays product-register and retro-futurist: the environment is expressive, while the game controls remain an instrument panel. Keep DESIGN_VARIANCE 5, MOTION_INTENSITY 4, and VISUAL_DENSITY 6. The current design system is bespoke Poorup, not Material, Fluent, Carbon, or a mixed component library.

## Architecture decision and alternatives

### Recommended: shared environmental scene layer

Use one client-only Theme Registry and one renderer that mounts the selected scene behind the existing Home, board, and page surfaces. The controller changes only a sanitized local theme ID, paints the existing skyline hooks with optional palette data, and renders bounded local SVG props. This gives six distinct worlds while keeping one DOM topology, one server contract, one UI token system, and one responsive layout.

### Rejected: global component recoloring

Changing every panel, button, property strip, status color, and text token per theme would make the six worlds look like six products, blur semantic colors, and create contrast regressions. It also increases the chance that a theme change affects a gameplay state. The UI surface tokens therefore stay locked.

### Rejected: separate page templates per theme

Six Home, Game, Profile, Rankings, Social, and Rules templates would duplicate behavior, drift in accessibility, and make future fixes land six times. The theme system must be a layer and data change inside the existing composition, never a template fork.

## File map and boundaries

### Create

- public/clientThemeData.js: immutable registry, asset paths, skyline palettes, preview copy, and motion limits. No DOM and no network.
- public/clientThemeRender.js: decorative layer mounting, skyline painting, theme attributes, transition classes, and visibility pause. No game rules or server calls.
- public/clientTheme.js: local preference, selector popover, keyboard behavior, focus restoration, and live announcement. No server calls.
- public/clientTheme.test.js: pure registry and sanitization contract tests.
- public/themeAssetAudit.test.js: SVG structure and palette guard tests.
- public/assets/themes/{midnight-ledger,clearline-day,bloom-district,golden-hour-exchange,rainy-copper-town,warm-window-snow-city}/scene.svg: one 88 x 36 horizon scene per approved theme.
- Theme-specific prop SVGs are listed with their exact paths in Task 3.
- qa/theme.spec.js: browser behavior, geometry, accessibility, reduced-motion, and visual-capture contracts.

### Modify

- public/index.html: add decorative layer mount points and one compact LOOK trigger in the existing Profile Preferences section. Do not move existing elements or add a top-level navigation tab.
- public/styles.css: add scoped theme layer, popover, palette, responsive, reduced-motion, and forced-colors rules. Do not alter existing layout declarations except additive z-index positioning needed for decorative layers.
- public/main.js: configure and initialize the theme controller once with the existing announcer and view lifecycle. Keep current imports and behavior intact.
- public/clientState.js: add client-only themeId and themePopoverOpen fields without changing server snapshot serialization or game state projection.
- public/clientBoardRender.js: extend the existing skyline paint function with an optional theme palette/data argument while keeping the current default output byte-compatible.
- public/clientRoomsUi.js: call the theme renderer's Home skyline refresh only through the shared renderer if the current Home render path repaints the skyline.
- qa/playwright.config.js only if a capture helper needs a stable output directory. Do not change existing viewport projects or reduced-motion defaults.

## Task 1: Freeze the visual and behavior baseline

**Files:**

- Read PRODUCT.md, .ulpi/design/DESIGN.md, .ulpi/design/THEME-SYSTEM-VISUAL-BRAINSTORM.md, public/index.html, public/styles.css, public/clientHomeAmbient.js, public/clientBoardRender.js, public/clientBoardData.js, public/clientState.js, public/clientSurfaces.js, qa/playwright.config.js, and qa/poorup.spec.js.
- Test with npm run test:full, npm run lint, npm run lint:client, and npm run test:browser.

- [ ] Step 1: Confirm repository state.

    Run:
    git status --short
    git rev-parse --short HEAD

    Expected: only approved documentation is mixed into the working tree; no production source or asset changes are hidden in the theme work.

- [ ] Step 2: Run the behavior baseline.

    Run:
    npm run test:full
    npm run lint
    npm run lint:client
    npm run test:browser

    Expected: all existing suites pass before a theme file is changed. Record the result in the implementation PR notes.

- [ ] Step 3: Capture baseline geometry at 1920px.

    Use the existing desktop-1920 Playwright project to record bounding boxes for #view-home, #view-game, #board-frame, #hud, #right-rail-game, #view-profile, #view-rankings, #view-social, and #view-rules. Save qa-artifacts/theme-baseline-1920.json and the existing surfaces' screenshots under qa-artifacts/theme-baseline-1920/.

    Expected: before and after geometry can be compared with a 1px tolerance. Do not use a theme screenshot as a reason to change dimensions.

- [ ] Step 4: Commit the documentation checkpoint.

    Run:
    git add docs/superpowers/plans/2026-09-10-poorup-theme-system-implementation.md .ulpi/design/THEME-SYSTEM-VISUAL-BRAINSTORM.md
    git commit -m "added theme system implementation plan"

## Task 2: Add the immutable Theme Registry and contract tests

**Files:**

- Create public/clientThemeData.js and public/clientTheme.test.js.
- Modify public/clientState.js.
- Test public/clientTheme.test.js.

**Interfaces:**

- THEME_IDS: readonly string[]
- DEFAULT_THEME_ID: "midnight-ledger"
- THEME_STORAGE_KEY: "poorup.theme.id.v1"
- THEMES: Readonly<Record<string, ThemeDefinition>>
- SkylineRect = [x: number, y: number, width: number, height: number]
- sanitizeThemeId(value: unknown): string
- getTheme(value: unknown): ThemeDefinition
- themeOptions(): readonly ThemeDefinition[]
- ThemeDefinition = { id, name, shortName, description, ariaLabel, scene, palette, skyline, props, motion, preview }

Each definition has the following shape, with the six final names and values from the visual brainstorm:

    {
      id: "midnight-ledger",
      name: "Midnight Ledger City",
      shortName: "NIGHT",
      description: "Tall blocks, warm windows, and a quiet patrol horizon.",
      ariaLabel: "Midnight Ledger City. After-hours skyline with warm windows.",
      scene: {
        home: "/assets/themes/midnight-ledger/scene.svg",
        board: "/assets/themes/midnight-ledger/scene.svg",
        page: "/assets/themes/midnight-ledger/scene.svg"
      },
      palette: {
        sky: "#071b22",
        haze: "#123634",
        far: "#0d2725",
        near: "#123634",
        light: "#78894f",
        highlight: "#6f9ca2"
      },
      skyline: { home: SkylineRect[], board: SkylineRect[] },
      props: { signature: "local SVG path", incident: "local SVG path", light: "local SVG path", weather: "local SVG path" },
      motion: { homeLoop: "house-drift", incident: "rare", durationMs: 28000, maxConcurrent: 1 },
      preview: { heading: "NIGHT", copy: "After-hours city" }
    }

Keep all scene paths local and unique. Keep palette values atmospheric only; do not introduce semantic UI colors. Add state fields themeId set to DEFAULT_THEME_ID and themePopoverOpen set to false. Do not add them to server payloads.

- [ ] Step 1: Write failing registry tests.

    Use node:assert/strict to assert that THEME_IDS is exactly:
    ["midnight-ledger", "clearline-day", "bloom-district", "golden-hour-exchange", "rainy-copper-town", "warm-window-snow-city"].
    Assert unknown IDs sanitize to DEFAULT_THEME_ID, Clearline Day resolves by ID, themeOptions has six entries, THEMES is frozen, every entry has required fields, every preview has visible copy, every scene path is local, and each motion budget has a positive duration with maxConcurrent no greater than one.

- [ ] Step 2: Run the tests to verify they fail.

    Run: node public/clientTheme.test.js
    Expected: FAIL because the registry does not exist.

- [ ] Step 3: Implement the registry and state fields.

    Create the six frozen definitions and pure helpers. Keep the registry free of DOM calls, storage reads, random values, and server references.

- [ ] Step 4: Run the tests to verify they pass.

    Run: node public/clientTheme.test.js
    Expected: PASS with every registry assertion green.

- [ ] Step 5: Commit the registry slice.

    Run:
    git add public/clientThemeData.js public/clientTheme.test.js public/clientState.js
    git commit -m "added client theme registry and contracts"

## Task 3: Create the pixel-art and SVG environment set

**Files:**

Create these 30 local SVGs and public/themeAssetAudit.test.js:

- public/assets/themes/midnight-ledger/scene.svg
- public/assets/themes/midnight-ledger/moon.svg
- public/assets/themes/midnight-ledger/helicopter.svg
- public/assets/themes/midnight-ledger/rooftop.svg
- public/assets/themes/midnight-ledger/windows.svg
- public/assets/themes/clearline-day/scene.svg
- public/assets/themes/clearline-day/sun.svg
- public/assets/themes/clearline-day/rescue.svg
- public/assets/themes/clearline-day/cloud.svg
- public/assets/themes/clearline-day/bird.svg
- public/assets/themes/bloom-district/scene.svg
- public/assets/themes/bloom-district/house.svg
- public/assets/themes/bloom-district/blossom.svg
- public/assets/themes/bloom-district/fence.svg
- public/assets/themes/bloom-district/bird.svg
- public/assets/themes/golden-hour-exchange/scene.svg
- public/assets/themes/golden-hour-exchange/crane.svg
- public/assets/themes/golden-hour-exchange/ferry.svg
- public/assets/themes/golden-hour-exchange/aircraft.svg
- public/assets/themes/golden-hour-exchange/gull.svg
- public/assets/themes/rainy-copper-town/scene.svg
- public/assets/themes/rainy-copper-town/town.svg
- public/assets/themes/rainy-copper-town/leaf.svg
- public/assets/themes/rainy-copper-town/rain.svg
- public/assets/themes/rainy-copper-town/station.svg
- public/assets/themes/warm-window-snow-city/scene.svg
- public/assets/themes/warm-window-snow-city/roof.svg
- public/assets/themes/warm-window-snow-city/pine.svg
- public/assets/themes/warm-window-snow-city/snow.svg
- public/assets/themes/warm-window-snow-city/smoke.svg
- public/themeAssetAudit.test.js

**SVG contract:**

- Every scene uses viewBox 0 0 88 36, xmlns, shape-rendering crispEdges, no text nodes, no filters, no gradients, and a bounded flat palette.
- Props use a 16 x 16, 24 x 16, or 32 x 16 viewBox chosen by silhouette, with integer coordinates and no editor metadata.
- Use selective 1px native outlines, a consistent top-left light source, square pixels, and 4 to 12 colors per small prop. No anti-aliased background halos.
- Keep decorative art aria-hidden when mounted. Labels remain semantic HTML in the selector.
- Use existing image-rendering pixelated and crisp-edges behavior. Do not create a new icon family or a raster sprite sheet.

- [ ] Step 1: Write failing SVG audit tests.

    Enumerate the 30 paths and assert each source contains the W3C SVG namespace, a viewBox, and shape-rendering crispEdges; assert there are no text, filter, linearGradient, radialGradient, external URL, or editor metadata nodes. Assert each scene has fewer than 220 SVG elements.

- [ ] Step 2: Run the audit to verify it fails.

    Run: node public/themeAssetAudit.test.js
    Expected: FAIL because the asset set is not present.

- [ ] Step 3: Draw the six scenes and props.

    Use svg-design for viewBox, path, optimization, and accessibility decisions. Use pixel-art-sprites for 1x silhouette tests, limited palettes, integer scaling, consistent outlines, and directional light.

    Midnight: vertical towers, moon, rooftop tank, patrol rotor, warm window strip.
    Day: open civic skyline, square sun plate, rescue rotor, stepped cloud, bird.
    Spring: low houses, park fence, blossom branch, bird, shallow hill.
    Summer: waterfront warehouses, crane, ferry, aircraft trail, gull.
    Autumn: connected townhouses, station canopy, leaf cluster, rain strip, warm windows.
    Winter: snow-capped blocks, pine edge, square flakes, chimney smoke, warm windows.

    Do not draw UI borders, buttons, logos, labels, or fake dashboards into a scene asset.

- [ ] Step 4: Run the SVG audit to verify it passes.

    Run: node public/themeAssetAudit.test.js
    Expected: PASS for all 30 assets.

- [ ] Step 5: Commit the art slice.

    Run:
    git add public/assets/themes public/themeAssetAudit.test.js
    git commit -m "added pixel art environment themes"

## Task 4: Add decorative layer mount points without changing layout

**Files:**

- Modify public/index.html and public/styles.css.
- Test geometry in qa/theme.spec.js after the controller exists.

- [ ] Step 1: Add mount points without moving existing siblings.

    Add theme-page-world after toast-stack and before the first view. Add theme-home-world inside title-screen before home-house-drift. Add theme-board-world inside center-field before board-skyline. All three are decorative and aria-hidden true.

    In the existing Profile Preferences section title, add only this compact trigger after the title and hairline: a native button with id theme-open-btn, data-theme-trigger, aria-haspopup dialog, aria-expanded false, and aria-controls theme-popover. Label it LOOK. Do not add a top-level navigation tab or a second audio control.

- [ ] Step 2: Add only scoped layer styles.

    Theme page world is fixed to the viewport with z-index base and pointer-events none. Theme Home and Board worlds are absolute to their existing containers, overflow hidden, contain paint, and use z-index below cf-inner, decks, tokens, panels, rails, HUD, modals, drawers, and focus rings. Add only position and stacking context rules to existing view, title-screen, and center-field; do not add dimensions or grid tracks.

- [ ] Step 3: Style the compact popover.

    The popover inherits panel, noise, btn-dark, and existing type tokens. It uses a 3 by 2 preview grid at desktop, two columns on iPad landscape, and one column with internal scrolling below 640px. Preview choices stay at least 44px high on touch layouts and do not alter Profile page width.

- [ ] Step 4: Run syntax checks.

    Run: node --check public/index.html
    If the HTML check is not available, run the existing browser smoke instead. Expected: markup parses and no layout test has changed yet.

- [ ] Step 5: Commit the mount-point slice.

    Run:
    git add public/index.html public/styles.css
    git commit -m "added theme environment mount points"

## Task 5: Build the theme renderer and preserve the skyline contract

**Files:**

- Create public/clientThemeRender.js.
- Modify public/clientBoardRender.js, public/clientRoomsUi.js, and public/main.js.
- Test public/clientTheme.test.js and module syntax.

**Interfaces:**

- configureThemeRender({ getTheme, isReducedMotion }): void
- renderTheme(themeId, { animate = true } = {}): void
- renderThemeScene(themeId, surface: "page" | "home" | "board"): void
- pauseThemeMotion(paused: boolean): void
- clearThemeTransition(): void
- themeSceneMarkup(theme: ThemeDefinition, surface: string): string

- [ ] Step 1: Write renderer contract tests.

    Assert themeSceneMarkup for Bloom District includes its local scene.svg and aria-hidden true, and never includes data-action, data-setting, socket, onclick, or any focusable element. Assert an unknown surface produces page-safe markup.

- [ ] Step 2: Extend skyline painting without changing its default.

    Keep paintSkyline(el, data) output and existing callers unchanged. Add an optional third argument:
    paintSkyline(el, data, palette = DEFAULT_SKYLINE_PALETTE)
    When no palette is passed, use the current #123634, #78894f, and #0d2725 values and the current shape. With a theme palette, use only far, near, and light roles. Do not change tile positions, board indexes, or token placement.

- [ ] Step 3: Implement renderTheme.

    1. Sanitize the requested ID through getTheme.
    2. Set document.body.dataset.themeId and data-theme-id on all existing views without changing layout-driving classes.
    3. Render the selected local scene image into theme-page-world, theme-home-world, and theme-board-world with explicit width, height, and alt empty.
    4. Repaint home-skyline, home-skyline-copy, and board-skyline with selected skyline data while preserving viewBox and dimensions.
    5. Add one noninteractive incident prop to the correct layer. It is never a button and never replaces Patrol or Night Shift assets.
    6. Add one transition class only when animate is true and reduced motion is false. Remove it on transitionend with a bounded timeout fallback.
    7. Leave players, roomCode, ruleset, boardVariant, owners, houses, jail, and every server snapshot untouched.

- [ ] Step 4: Wire lifecycle once.

    Configure the renderer during existing boot setup and render state.themeId before the first Home render. Re-render only when the controller applies a new ID or a view is first created. Do not add a polling loop.

- [ ] Step 5: Pause ambient theme motion.

    Listen to document.visibilitychange once. When hidden, call pauseThemeMotion(true) and add a root pause class. When visible, call pauseThemeMotion(false). Do not advance gameplay timers or modify clientHomeAmbient timers.

- [ ] Step 6: Run module tests and syntax checks.

    Run:
    node public/clientTheme.test.js
    node --check public/clientThemeRender.js
    node --check public/clientBoardRender.js
    node --check public/main.js

    Expected: all theme contract tests pass and all changed modules parse.

- [ ] Step 7: Commit the renderer slice.

    Run:
    git add public/clientThemeRender.js public/clientBoardRender.js public/clientRoomsUi.js public/main.js public/clientTheme.test.js
    git commit -m "added theme scene renderer"

## Task 6: Add the Profile Look selector and local persistence

**Files:**

- Create public/clientTheme.js.
- Modify public/main.js, public/clientState.js, and public/styles.css.
- Test public/clientTheme.test.js and qa/theme.spec.js.

**Interfaces:**

- configureThemeUi({ applyTheme, announce }): void
- initThemePreference(): string
- openThemePopover(): void
- closeThemePopover({ restoreFocus = true } = {}): void
- applyThemePreference(themeId, { announce = true, animate = true } = {}): void
- bindThemePopover(): void

The controller is local-only. It never calls fetch, socket.emit, a game action, a room action, or an account API.

- [ ] Step 1: Write failing selector tests.

    Cover these contracts: the trigger exists exactly once; it controls theme-popover; opening renders six labeled radio choices; selected choice has aria-checked true and a visible gold border; Enter applies; Escape and outside click dismiss without applying; focus returns to theme-open-btn; reload restores poorup.theme.id.v1; invalid storage falls back to midnight-ledger.

- [ ] Step 2: Implement the popover with native controls.

    Use one role radiogroup and six button role radio choices. Each choice contains a local scene image, visible name, one-line description, and aria-checked. Arrow keys move within the grid, Home and End select first and last focus, Enter or Space applies, Escape dismisses, and outside click closes without changing the current theme.

- [ ] Step 3: Persist and synchronize safely.

    Read and sanitize localStorage once at startup. Write only the sanitized theme ID after an explicit choice. Listen for storage events so a second tab can adopt a changed appearance. Ignore invalid values and unrelated keys. Announce Parlor look changed to the theme name through system-announcer with polite priority.

- [ ] Step 4: Apply immediately without changing game state.

    Update the selected state and state.themeId before the crossfade. Keep the popover open after applying so the user can compare; Close dismisses. No game action is delayed and focus never leaves Profile unexpectedly.

- [ ] Step 5: Add responsive selector styles.

    At 1920px use a 3 by 2 grid. At iPad landscape use two columns inside the existing Profile surface. At 390px use one column with internal popover scrolling only. Do not create page scrolling or alter Profile width.

- [ ] Step 6: Run tests and client lint.

    Run:
    node public/clientTheme.test.js
    npm run lint:client

    Expected: PASS without new dependencies or lint suppressions.

- [ ] Step 7: Commit the selector slice.

    Run:
    git add public/clientTheme.js public/clientState.js public/main.js public/styles.css public/clientTheme.test.js
    git commit -m "added parlor look selector"

## Task 7: Add purposeful transitions and accessibility fallbacks

**Files:**

- Modify public/styles.css, public/clientThemeRender.js, and public/clientTheme.js.
- Test qa/theme.spec.js.

- [ ] Step 1: Define the motion contract.

    Use a 300ms opacity/transform crossfade with cubic-bezier(0.23, 1, 0.32, 1). The selected radio state updates immediately. A 500ms showcase is not part of the first implementation.

- [ ] Step 2: Keep motion behind the interface.

    Theme layers may animate their own opacity or translate3d. Do not animate view, header, nav, game-main, board-frame, rails, HUD, panels, popups, tile faces, text, or form controls. Do not animate width, height, padding, margin, top, left, or grid tracks.

- [ ] Step 3: Add six calm transition stories.

    Night to Day: warm windows dim and the cloud plate resolves.
    Summer to Autumn: copper light cools, the waterline becomes wet street, one leaf strip appears.
    Autumn to Winter: leaf loop stops, roof caps and snow resolve, warm windows stay.
    Winter to Spring: snow fades and one blossom branch resolves.
    Other pairs crossfade directly through a stable neutral bridge.

- [ ] Step 4: Add reduced-motion, forced-colors, and hidden-tab paths.

    Reduced motion removes travel, rotation, shake, particle loops, and transition transforms while showing the final scene. Forced colors hide theme art and let CanvasText and Highlight win. Hidden views pause loops and show the settled state on return.

- [ ] Step 5: Gate hover and touch behavior.

    Only fine-pointer preview hover may brighten a border. Coarse pointers receive the same information through focus and selected state. Every gesture has click and keyboard alternatives.

- [ ] Step 6: Run motion review checks.

    Run:
    rg -n "transition:\s*all|scale\(0\)|ease-in|animation:.*(top|left|width|height)" public/styles.css public/clientTheme*.js

    Expected: no new theme matches. Review the result against emilkowal-animations and review-animations: motivated, interruptible, transform/opacity-only, sub-300ms routine UI, and reduced-motion-safe.

- [ ] Step 7: Commit the motion slice.

    Run:
    git add public/styles.css public/clientTheme.js public/clientThemeRender.js qa/theme.spec.js
    git commit -m "improved theme transitions and motion fallbacks"

## Task 8: Add browser QA and the 1920px visual gate

**Files:**

- Create qa/theme.spec.js.
- Modify qa/poorup.spec.js only for genuinely reusable helpers.
- Create qa-artifacts/theme/ screenshots and JSON evidence, ignored if the repository already ignores QA artifacts.

- [ ] Step 1: Add 1920px behavior tests.

    At desktop-1920 verify six choices, Home/Profile/Rankings/Social/Rules/lobby/Game reachability, Standard-40 count 40, square board, stable board/HUD/rail geometry within 1px, no page overflow, existing room/profile/game/card/modal/log/audio controls, and no focusable theme props.

- [ ] Step 2: Add responsive tests.

    Run selector, geometry, and overflow checks at desktop-1366, tablet-1024, ipad-mini-landscape, ipad-pro-11-landscape, and mobile-390. Keep iPad tests horizontal. At 390px only the popover's own internal region may scroll.

- [ ] Step 3: Add accessibility tests.

    Cover aria-haspopup, aria-expanded, aria-controls, dialog, radiogroup, radio, aria-checked, focus entry and return, Escape/outside dismissal, live announcement, reduced-motion final scene, decorative SVG hiding, semantic theme names, and visible focus rings.

- [ ] Step 4: Capture and inspect screenshots at 1920px.

    Run:
    $env:POORUP_CAPTURE_VISUALS='1'
    npm run test:browser -- --project=desktop-1920 qa/theme.spec.js

    Capture each approved theme on Home and the Game center plus the selector open on Profile. Open every image at native scale. Confirm that board, rails, HUD, topbar, cards, text, borders, and controls remain in the same positions; scenery is subordinate; no art crosses readable content or focus rings; no theme lowers contrast; and no black, blank, or wrong-theme capture is accepted.

- [ ] Step 5: Run visual and accessibility review tools.

    After final UI code exists, run the Impeccable detector once:
    C:\Users\jerem\.agents\skills\impeccable\scripts\impeccable.cmd detect --json public/index.html public/styles.css public/clientTheme.js public/clientThemeRender.js

    Run the existing browser accessibility checks and the Web Interface Guidelines review. Fix only findings caused by this feature.

- [ ] Step 6: Commit the QA slice.

    Run:
    git add qa/theme.spec.js qa-artifacts
    git commit -m "added theme visual and accessibility coverage"

## Task 9: Full regression, CodeScene preparation, and rollback

**Files:**

- Read all changed files and implementation commits.
- Create docs/audit/theme-system-implementation-2026-09-10.md after the final gate, containing evidence only.

- [ ] Step 1: Run the complete local gate.

    Run:
    npm run test:full
    npm run lint
    npm run lint:client
    npm run coverage
    npm run test:browser
    npm audit --audit-level=high

    Expected: all existing and theme suites pass, no new dependency vulnerabilities, and no server behavior changes.

- [ ] Step 2: Run syntax and diff hygiene.

    Run:
    git diff --check HEAD~7..HEAD
    node --check public/clientThemeData.js
    node --check public/clientThemeRender.js
    node --check public/clientTheme.js

    Expected: no whitespace errors and all theme modules parse.

- [ ] Step 3: Review the complete diff against the spec.

    Every change must be a registry, client preference, decorative mount point, SVG scene or prop, scoped CSS, renderer lifecycle, selector accessibility, or test evidence. Reject changes to server modules, Socket.IO contracts, game rules, board data, player actions, economy, room behavior, or unrelated page composition.

- [ ] Step 4: Run CodeScene preparation.

    Use the repository's normal CodeScene and PR workflow. Review every changed hotspot and split unhealthy functions before opening a PR. Keep registry, renderer, controller, and asset audit independently reviewable.

- [ ] Step 5: Write rollback notes.

    Rollback is a revert of the theme commits plus removal of the 30 local SVGs. No migration, server rollback, room reset, or data repair is required because the only persisted value is the ignorable localStorage key poorup.theme.id.v1.

- [ ] Step 6: Keep logical commit messages.

    added theme registry and contracts
    added pixel art environment themes
    added theme environment mount points
    added theme scene renderer
    added parlor look selector
    improved theme transitions and motion fallbacks
    added theme visual and accessibility coverage

    Do not merge or push from the implementation prompt unless the user separately authorizes it.

## Acceptance criteria

- The six worlds are selectable from existing Profile Preferences without a new top-level tab.
- The selected theme persists locally, synchronizes across tabs, restores focus correctly, and never sends a server request.
- Home, lobby, game, Profile, Rankings, Social, Rules, Market, cards, logs, audio, player actions, and all server-authoritative behavior remain functional.
- Standard-40 and Metro-52 geometry and tile contracts are unchanged.
- At 1920 x 1080 every theme is visibly distinct through environment, silhouette, lighting, and atmosphere while the UI remains in the same positions with the same typography, controls, surfaces, and hierarchy.
- iPad layouts remain horizontal and do not gain page scrolling or unreadable UI.
- Decorative art is crisp at 1x, uses bounded local SVGs, and does not become an animated particle system.
- Routine transitions use only transform and opacity, stay at 300ms, are interruptible, and have reduced-motion and forced-colors fallbacks.
- Theme choice is never communicated by color alone; selector names, selected state, focus, and announcements are accessible.
- Existing full tests, audits, client lint, browser QA, coverage, dependency audit, Impeccable detector, and CodeScene review pass.

## Implementation handoff

Implement exactly this plan and the linked visual brainstorm. Keep the current Poorup UI system in mind at every step. Do not redesign the application, invent a second design system, change layout to fit a theme, or add a server theme feature. Before claiming any UI slice complete, confirm its appearance at 1920 x 1080 with an inspected screenshot and record the result.
