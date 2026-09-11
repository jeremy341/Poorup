# Spring Petal and Light Pedestrian Ambient Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a seamless vertical Spring petal fall and a seamless Light-theme pedestrian walk while preserving Poorup's UI, layout, game state, server, and Socket.IO contracts.

**Architecture:** Keep the existing client-only theme renderer. Spring weather becomes two vertically repeated image layers; Light receives an optional Home-only pedestrian layer with two horizontal copies and two leg-pose SVGs. All movement is decorative CSS transform/opacity, paused by the existing visibility and Reduced Motion hooks.

**Tech Stack:** Vanilla HTML/CSS/ES modules, local crisp-edge SVGs, existing theme registry/renderer, Node tests, Playwright.

**Spec:** Approved in-chat Spring petal and Light pedestrian design on 2026-09-11.

## Global Constraints

- Keep the original Poorup UI system, layout, typography, board geometry, and controls unchanged.
- Do not change server logic, game state, Socket.IO payloads, or economy behavior.
- Use 640×360 integer-aligned artwork for new full-canvas layers.
- Animate only `transform` and `opacity`; use continuous `linear` movement for repeat bands.
- Decorative artwork is `aria-hidden`, `pointer-events: none`, and never covers readable controls.
- Reduced Motion and document-hidden state pause or freeze ambient movement.
- Verify visually at 1920×1080 before claiming completion.

### Task 1: Lock behavior with tests

**Files:**
- Modify: `public/clientTheme.test.js`
- Modify: `public/themeAssetAudit.test.js`
- Modify: `qa/theme.spec.js`

**Interfaces:**
- `themeSceneMarkup("spring", "home")` returns two `.theme-petal-a` and two `.theme-petal-b` images.
- `themeSceneMarkup("light", "home")` returns two `.theme-pedestrian-a` images and two pose layers per band.
- Board/page surfaces must not render pedestrians.

- [x] Add assertions for the Spring vertical pair, Light Home-only pedestrian pair, and no Light pedestrian markup on board/page.
- [x] Add asset names and exact viewBox expectations for `petals.svg`, `pedestrians-pose-a.svg`, and `pedestrians-pose-b.svg`.
- [x] Run the client tests and focused Playwright test; the new contracts were red before implementation and green afterward.

### Task 2: Author the pixel assets

**Files:**
- Create: `public/assets/themes/spring/petals.svg`
- Create: `public/assets/themes/light/pedestrians-pose-a.svg`
- Create: `public/assets/themes/light/pedestrians-pose-b.svg`

**Interfaces:**
- Each file is standalone SVG with `xmlns`, `width`, `height`, and `viewBox`.
- `petals.svg` contains sparse pink/rose petals distributed across the full 640×360 canvas.
- Both pedestrian files contain the same 3–4 neutral blue-green NPC silhouettes, feet aligned around the Light path baseline, with only leg/arm pixels changed between poses.

- [x] Draw at integer coordinates with `shape-rendering="crispEdges"`, no filters, gradients, text, URLs, or anti-aliased strokes.
- [x] Keep silhouettes below the content-safe text area and behind the existing UI shell.
- [x] Validate each file with the asset audit and an XML parse.

### Task 3: Extend the theme renderer

**Files:**
- Modify: `public/clientThemeData.js`
- Modify: `public/clientThemeRender.js`

**Interfaces:**
- Add Spring `props.petals` pointing to `petals.svg`.
- Add Light `props.pedestrians` as `{ poseA, poseB }` paths without changing server state.
- Keep the existing `props.clouds`, `light`, `signature`, `weather`, and `accent` slots intact.

- [x] Render Spring petals as two images: A at `translateY(0)` and B at `translateY(-100%)`.
- [x] Render Light pedestrians only when `surface === "home"`, with two horizontal copies and two pose images per copy.
- [x] Keep `page` and `board` surfaces free of pedestrians; no new navigation or settings control.
- [x] Preserve existing `aria-hidden="true"`, fixed intrinsic dimensions, and escaping.

### Task 4: Add seamless motion CSS

**Files:**
- Modify: `public/styles.css`

**Interfaces:**
- `.theme-petal-a/.theme-petal-b` use vertical linear wrap keyframes.
- `.theme-pedestrian-a/.theme-pedestrian-b` use horizontal left-to-right wrap keyframes.
- `.theme-pedestrian-pose-a/.theme-pedestrian-pose-b` crossfade leg poses with opacity only.

- [x] Use 14s vertical petal travel and 36s horizontal pedestrian travel with linear easing.
- [x] Ensure the end transform of each pair equals the next cycle's starting visual state, avoiding teleport seams.
- [x] Reuse `.theme-motion-paused` and `prefers-reduced-motion`; do not animate layout properties.
- [x] Gate no hover behavior and keep all ambient layers behind content.

### Task 5: Verify and document

**Files:**
- Modify: `docs/design/figma-theme-worlds-2026-09-11.md`

- [ ] Run client tests, asset audit, client lint, `git diff --check`, and the full server/client regression.
- [x] Run Playwright at 1920×1080 for markup, Home-only scope, no overflow, Reduced Motion, and focus behavior.
- [x] Capture and inspect Spring and Light Home at native 1920×1080.
- [x] Record the new optional layers and timing in the design handoff.
- [ ] Commit the finished change as `Added seamless petals and Light pedestrians`.
