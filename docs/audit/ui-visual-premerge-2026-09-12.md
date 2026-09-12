# UI / Visual Pre-merge Audit — 2026-09-12

**Branch / revision:** `codex/theme-reset` at `1bf4e1a9d0b5fcd7f5014158a48ae6f3a6931949`
**Scope:** the theme/UI changes in `HEAD~1..HEAD`, with emphasis on the 1920×1080 home surface, theme layering, SVG/pixel rendering, motion and reduced motion, landscape iPad/touch behavior, focus, overflow, and duplicate/dead UI.
**Review mode:** read-only. No production files were edited.
**Overall recommendation:** **Hold for the P1 weather-layer readability fix.** The underlying theme registry/rendering contract is coherent and the requested automated checks pass.

## Executive summary

- Audit health: **16/20 — Good**
- Findings: **P0 0 · P1 1 · P2 2 · P3 1**
- Implementation integrity: **Pass**. The change is product-specific, uses a consistent six-world registry, keeps scenery decorative/noninteractive, and has focused tests for layout stability and reduced motion.
- Primary release concern: the new full-screen winter snow layer is painted over unpanelled home copy, intermittently degrading text clarity and contrast.
- No horizontal overflow, clipped primary action, broken focus restoration, or touch-blocking theme layer was observed in the supplied 1920 and landscape-iPad evidence.

## Audit health score

| # | Dimension | Score | Key finding |
|---|---|---:|---|
| 1 | Accessibility | 3/4 | Winter particles visibly cross headings and body copy. |
| 2 | Performance | 3/4 | Several full-screen, infinite layers retain `will-change` continuously. |
| 3 | Responsive design | 3/4 | Layout/reflow is sound; fractional scaling on iPad weakens strict pixel-grid consistency. |
| 4 | Theming | 3/4 | Original's selector preview falls back to the favicon instead of its new home scene. |
| 5 | Implementation integrity | 4/4 | Registry, local asset audit, reduced-motion contract, and 1920 geometry test pass. |
| **Total** |  | **16/20** | **Good — address the weak dimensions before release.** |

## Evidence and verification

### Automated checks

| Check | Result | Evidence |
|---|---|---|
| `node public/clientTheme.test.js` | **PASS** | 6 passed, 0 failed. Covers default/sanitization, immutable six-theme registry, Original home-only world, token contrast, decorative markup, and local crisp assets. |
| `node public/themeAssetAudit.test.js` | **PASS** | 34 passed, 0 failed. All referenced assets exist; every audited SVG has the expected viewBox and `shape-rendering="crispEdges"`; disallowed filters/gradients/text/external URLs are absent. |
| Targeted Playwright 1920 theme test | **PASS** | `npx playwright test -c qa/playwright.config.js qa/theme.spec.js --project=desktop-1920 --grep "applies a themed scene without changing the shell geometry"`: 1 passed in 18.0s. All six themes retained Preferences geometry; Original remained home-only; expected paired cloud/weather/fog layers rendered. |
| Impeccable detector | **PASS** | `impeccable detect --json` over the changed theme CSS/JS/SVG targets returned `[]`. |

### Visual evidence inspected

- `qa-artifacts/theme-homes-1920/{original,spring,summer,autumn,winter,light}.png` — six native 1920×1080 home captures.
- `qa-artifacts/themes/midnight-ledger-home-1920.png` and `theme-comparison-1920.png` — Original/detail and cross-theme comparison.
- `qa-artifacts/ui-visual-premerge-2026-09-12/light-1920-chooser.png` — selector placement, density, selected state, and scene behind profile content.
- `qa-artifacts/ui-visual-premerge-2026-09-12/{original,light}-ipad-mini.png` and `original-ipad-pro.png` — landscape iPad scaling, safe edges, header reachability, and primary actions.

The 1920 compositions retain a strong, board-game-specific hierarchy: the world fills the stage, the two room CTAs remain dominant, and the entry desk provides a stable high-contrast island. Original, Spring, Summer, Autumn, Winter, and Light are visually distinct without changing the task layout.

## Detailed findings

### [P1] Full-screen snow is painted across readable home copy

- **Location:** `public/styles.css:269-278`, `public/styles.css:312-313`; layer host at `public/index.html:76`, narrative content at `public/index.html:129-143`.
- **Category:** Accessibility / Theming / Visual hierarchy
- **Evidence:** `qa-artifacts/theme-homes-1920/winter.png` shows large, high-opacity snow crosses over `POORUP`, the rule line, descriptive paragraph, status strip, clock, and night-shift hint. The snow images occupy the entire scene at `opacity: 0.9`; the theme layer has `z-index: 0`, while the unpanelled narrative content has no explicit higher stacking layer.
- **Impact:** moving decoration can repeatedly interrupt letterforms and lower effective contrast while users scan the entry screen. The CTAs remain usable, but explanatory text and status labels become materially harder to read.
- **WCAG / standard:** WCAG 2.2 1.4.3 (Contrast Minimum), 1.4.11 (Non-text Contrast) in the affected mixed foreground/background regions; product principle that real-time state changes remain legible and decoration stays secondary.
- **Recommendation:** establish an explicit content stacking context above `.theme-home-world`, or mask/clip weather away from semantic copy and controls. Do not solve this solely by globally dimming the authored winter scene; preserve the world while keeping particles behind readable UI. Add a visual assertion/snapshot that weather does not cross the narrative and status regions.
- **Suggested command:** `$impeccable harden`

### [P2] Original selector thumbnail does not represent Midnight Ledger City

- **Location:** `public/clientTheme.js:29`; data split at `public/clientThemeData.js:25-27`.
- **Category:** Theming / Implementation integrity
- **Evidence:** Original now declares `scene: null` and `homeScene: scenePath("original")`, but `choiceMarkup()` only uses `theme.scene || "/favicon.svg"`. In `light-1920-chooser.png`, the Original tile therefore shows the Poorup favicon instead of the city preview used by the other worlds.
- **Impact:** the chooser's first option breaks the preview contract and makes the newly authored Original world impossible to identify before selection.
- **Recommendation:** use the same surface resolver as rendering (`homeScene || scene`) for selector art, and add a test asserting each choice uses its resolved home preview rather than a generic fallback.
- **Suggested command:** `$impeccable polish`

### [P2] Permanent `will-change` is applied to multiple viewport-sized ambient layers

- **Location:** `public/styles.css:265-293` (petals, snow, leaves, pedestrians, clouds, fog).
- **Category:** Performance / Motion
- **Evidence:** each paired ambient layer is full-stage and retains `will-change: transform` for its entire lifetime; reduced motion stops animation at `public/styles.css:375` but does not remove the promotion hint. A seasonal home can keep several 640×360 assets scaled to the full 1920 stage and composited simultaneously.
- **Impact:** persistent layer promotion can consume avoidable GPU memory, especially on iPad-class devices, despite hidden-tab animation pausing.
- **Recommendation:** remove unconditional `will-change`, or scope it to an active-motion state and explicitly reset it under reduced motion/paused/hidden states. Confirm in DevTools Layers/Performance that long ambient loops remain smooth without permanent promotion.
- **Suggested command:** `$impeccable optimize`

### [P3] Landscape iPad uses fractional scaling for a strict 640×360 pixel grid

- **Location:** `public/styles.css:234-248`; 640×360 viewBoxes in the theme SVG assets; responsive stage rules beginning at `public/styles.css:3708`.
- **Category:** Responsive design / SVG & pixel-art fidelity
- **Evidence:** `image-rendering: pixelated` and `shape-rendering="crispEdges"` preserve hard edges, and the inspected iPad captures are usable. However, the stage fits arbitrary 1024×768 / 1194×834 geometry, so the 640×360 art cannot stay on an integer scale as it does at 1920×1080 (exactly 3×). Some source pixels therefore occupy uneven device-pixel widths.
- **Impact:** no functional break; fine pixel details have slightly inconsistent weight on tablet compared with the native 1920 capture.
- **Recommendation:** either document fractional nearest-neighbor scaling as the intentional tablet compromise, or render the scenic pixel plane at an integer multiple and crop/letterbox it independently of the responsive control layer.
- **Suggested command:** `$impeccable adapt`

## Motion review

| Before | After | Why |
|---|---|---|
| Full-stage paired seasonal layers keep `will-change: transform` indefinitely. | Promote only while the ambient layer is actively moving; clear the hint for paused, hidden, and reduced-motion states. | Avoid long-lived compositing cost while retaining transform-only motion. |
| Winter snow is a foreground-equivalent 0.9-opacity layer across the whole stage. | Keep the same transform-only loop behind semantic content or outside protected readability zones. | Motion is justified as atmosphere, but must not compete with text or status information. |

**Motion verdict: Approve, with the P1 layering correction and P2 promotion cleanup.** The added fog/snow/leaves use transform-only linear motion, paired wraparound layers avoid visible loop jumps, the 300ms scene entrance uses the established strong ease-out curve, the document-hidden state pauses theme motion, and `prefers-reduced-motion` removes movement. No `transition: all`, `scale(0)`, layout-property animation, or ungated transform-hover regression appears in the changed theme code. The 14–48s timings are appropriate to constant ambient scenery rather than interactive UI.

## Focus, touch, overflow, and duplicate/dead UI

- **Focus:** Pass. Native radio controls use a roving tabindex; Arrow keys, Home/End, Enter/Space, and Escape are handled; opening moves focus to the selected theme and closing restores the trigger. Visible `:focus-within` and forced-colors outlines are present (`public/styles.css:360-376`).
- **Touch:** Pass for inspected landscape iPad surfaces. Header navigation and core actions are at least 44px in the iPad breakpoint (`public/styles.css:3714-3734`, `3768-3773`); scenery is `pointer-events: none`.
- **Overflow:** Pass. The targeted 1920 Playwright geometry test passed, the chooser is width/max-height bounded with internal scrolling, and the iPad screenshots show no horizontal clipping or off-canvas primary controls.
- **Reduced motion:** Pass. Theme motion is disabled at `public/styles.css:375`; the Playwright suite also asserts fog, petals, leaves, snow, and pedestrians compute to `animation-name: none`.
- **SVG crispness:** Pass at 1920. The 640×360 sources scale exactly 3×, use integer geometry, declare `shape-rendering="crispEdges"`, and are displayed with `image-rendering: pixelated`. No filters, gradients, text nodes, external dependencies, or nested scale transforms were found by the asset audit.
- **Duplicate/dead UI:** No dead selector option or duplicate interactive control was observed. Original intentionally keeps its page/board layers empty while using the new home-only scene. The legacy home skyline remains as an intentional depth layer at 0.5 opacity in Original and is suppressed for the seasonal themes.

## Patterns and systemic issues

- The theme data/render path cleanly separates `scene`/`props` from `homeScene`/`homeProps`, but the selector has not adopted that resolver. Any future surface-specific preview will repeat the Original mismatch unless preview resolution is centralized.
- Atmospheric assets are consistently authored and tested, but the stacking contract (“scenery is always behind controls”) is implicit. A single named content layer/z-index token would prevent future weather art from crossing readable UI.
- Motion uses good property/easing discipline; promotion policy is the only repeated performance concern.

## Positive findings

- Strong, coherent “After-hours Game Parlor” identity with six recognizably different worlds and stable action hierarchy.
- Local, deterministic SVG assets with explicit dimensions, fixed viewBoxes, hard edges, no remote content, and decorative semantics at render time (`alt=""`, `aria-hidden="true"`).
- Theme changes do not alter Preferences geometry in the 1920 browser test.
- Focus restoration, roving radio navigation, live announcement of changes, forced-colors handling, and noninteractive scenery are all intentionally implemented.
- The 1920 and iPad captures show comfortable CTA sizing, contained entry panels, safe header spacing, and no document-level horizontal overflow.
- Paired snow/leaves/fog/cloud layers create seamless continuous motion without keyframe restarts on user-triggered UI.

## Recommended actions

1. **[P1] `$impeccable harden`:** put weather/decor behind semantic home content and add a protected readability-zone visual assertion.
2. **[P2] `$impeccable polish`:** resolve selector preview art through `homeScene || scene` and test all six thumbnails.
3. **[P2] `$impeccable optimize`:** scope/remove persistent `will-change` and profile compositing on iPad.
4. **[P3] `$impeccable adapt`:** explicitly choose and document the tablet pixel-scaling policy.
5. **[Final] `$impeccable polish`:** rerun the six-theme 1920 capture and inspect the corrected winter/readability and Original-preview states.

You can ask me to run these one at a time, all at once, or in any order you prefer.

Re-run `$impeccable audit` after fixes to see your score improve.
