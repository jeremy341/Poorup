# Poorup Seasonal Theme UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Poorup's existing six client-only parlor themes so Midnight Ledger City remains the default while Day, Spring, Summer, Autumn, and Winter each receive an authored environment and an accessible, contrast-checked UI color treatment without changing layout, typography, gameplay, or server behavior.

**Architecture:** Keep the current `clientThemeData.js` registry, `clientTheme.js` preference controller, and `clientThemeRender.js` environment layer. Add a complete theme UI-token map to the registry, map those tokens through existing CSS variables, and allow only non-semantic chrome sprites to inherit theme colors. Property-group, ownership, success, danger, warning, and player colors remain semantically stable. The server, Socket.IO payloads, game state, board contracts, and economy remain untouched.

**Tech Stack:** Vanilla HTML/CSS/ES modules, inline pixel SVG sprites, CSS custom properties, Playwright, Node test scripts, ESLint.

**Spec:** `.ulpi/design/DESIGN.md`, `.ulpi/design/THEME-SYSTEM-VISUAL-BRAINSTORM.md`, and the corrected visual direction in this plan.

## Execution Status (2026-09-11)

Tasks 1–8 are implemented and verified locally, including measured contrast, six-theme 1920×1080 captures, full regression/browser coverage, the Impeccable detector, and local CodeScene rule scans. A full hosted CodeScene delta review requires the repository's CodeScene personal access token and remains a PR-time gate; no push or merge is performed by this plan run.

## Global Constraints

- Preserve the existing Poorup layout, component positions, spacing, navigation, card structure, hierarchy, responsive behavior, fonts, board dimensions, tile order, controls, gameplay, server logic, and Socket.IO contracts.
- Keep `midnight-ledger` as the default and as a permanently available reset state.
- Add only client-side visual theme behavior; themes never alter game state, rules, economy, or server settings.
- Reuse existing Poorup tokens, rails, HUD, modals, Rules-book, Profile surfaces, and selector patterns.
- No glassmorphism, generic SaaS cards, emoji controls, gradient text, neon effects, pill-heavy redesigns, or unrelated component-library code.
- UI token changes are immediate; only decorative scenery may crossfade for 300ms using transform and opacity.
- Preserve property/group colors, ownership colors, success/danger/warning/player semantics, focus visibility, live regions, and forced-colors behavior.
- Every changed UI slice must be visually checked at 1920×1080 and have no page overflow or layout shift.
- SVGs use integer geometry, `shape-rendering="crispEdges"`, limited palettes, no filters, gradients, text nodes, editor metadata, or external URLs.

## Files and Responsibilities

- Modify `public/clientThemeData.js`: add complete UI token maps, corrected world metadata, prop slots, and palette validation helpers.
- Modify `public/clientThemeRender.js`: apply theme UI variables, keep environment layers behind existing surfaces, and preserve the 300ms scenery transition.
- Modify `public/clientTheme.js`: keep the existing Profile Preferences `LOOK` selector and synchronize its preview/state semantics with the expanded registry.
- Modify `public/styles.css`: replace themeable chrome values with existing-token aliases; do not change layout rules or typography.
- Modify `public/clientSprites.js`: allow only non-semantic brand/chrome sprites to inherit theme icon tokens while preserving avatar, token, house, hotel, and property colors.
- Modify `public/clientBoardRender.js`: theme board frame/center/tiles through CSS variables while leaving strips and tile semantics unchanged.
- Modify `public/index.html`: add no new navigation; only add hooks if an existing branded sprite needs a theme class or token hook.
- Modify `public/clientState.js`, `public/main.js`, and `public/clientRoomsUi.js` only if the existing theme lifecycle needs a client-only token refresh; do not add server fields.
- Add or revise local SVGs under `public/assets/themes/` for the six authored worlds.
- Modify `public/clientTheme.test.js`, `public/themeAssetAudit.test.js`, and `qa/theme.spec.js` for token, asset, keyboard, contrast, forced-colors, geometry, and visual contracts.

## Theme Contract

The registry keeps the existing six IDs and order:

```js
[
  "midnight-ledger",
  "clearline-day",
  "bloom-district",
  "golden-hour-exchange",
  "rainy-copper-town",
  "warm-window-snow-city",
]
```

Each definition exposes:

```js
{
  id,
  name,
  ui: {
    canvas, chrome, panel, panelRaised, panelDeep,
    boardTile, boardCenter, input, buttonDark,
    textPrimary, textSecondary, textMuted,
    accent, accentBright,
    lineDefault, lineStrong, lineActive, lineBoard, focus,
    action, actionHover, actionPressed,
    danger, success, warning, player,
    logoPrimary, logoSecondary, iconPrimary, iconSecondary,
    scrim, scanline
  },
  scene: { page, home, board },
  props,
  skyline,
  motion
}
```

The renderer also derives compatibility roles for the existing CSS surface vocabulary (`lineDark`, `lineSubtle`, `goldMuted`, `redDark`, `surfaceError`, `lineError`, `textError`, `surfaceInset`, `surfaceSelected`, `surfaceHover`, `surfaceBoardHover`, `surfaceAvatar`, `surfaceCard`, `surfaceActive`, `surfaceSpecial`, `boardFrame`, and `lineShadow`). These aliases keep legacy selectors themeable without changing their layout rules.

The `ui` values are mapped to the existing Poorup CSS variables. `midnight-ledger` must preserve the current token values exactly. The alternate candidate values are:

| Theme | Canvas | Chrome | Panel | Raised | Deep | Board tile | Board center | Input | Primary text | Secondary text | Accent | Active line | Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Midnight | `#01070A` | `#020A0D` | `#071314` | `#09191A` | `#030C10` | `#061011` | `#031D1E` | `#061216` | `#E8D3AB` | `#A79D7D` | `#CFA75F` | `#C88F2E` | `#AF2A21` |
| Day | `#06141A` | `#092027` | `#0C242C` | `#12323A` | `#05171D` | `#0A2027` | `#0A333B` | `#0A242B` | `#EAF2E4` | `#B7D0CC` | `#E4C276` | `#D6B66A` | `#B63A2F` |
| Spring | `#041312` | `#08201F` | `#0B2923` | `#12382D` | `#051815` | `#09231F` | `#0D302B` | `#0B2623` | `#EAF0D2` | `#B6C7A0` | `#D6C178` | `#D0B46A` | `#A8322A` |
| Summer | `#061315` | `#0B2425` | `#102E2B` | `#173734` | `#071B1B` | `#0C2725` | `#123735` | `#102B29` | `#F4E3B7` | `#D0B886` | `#E7B94E` | `#E0B557` | `#B83B2E` |
| Autumn | `#101417` | `#1B2222` | `#222C2A` | `#2B3730` | `#111B1C` | `#1A2928` | `#243B35` | `#22302E` | `#F3DFC0` | `#C3AA87` | `#D28C47` | `#D3984A` | `#B13A2B` |
| Winter | `#051016` | `#081A22` | `#0D232B` | `#12303A` | `#04131A` | `#0A2029` | `#0F323D` | `#0B222A` | `#E7F0E8` | `#B6CAD0` | `#C7D3D0` | `#D6B76E` | `#A83238` |

For every alternate theme also define:

- `textMuted`: a readable derivative of secondary text;
- `lineDefault` and `lineStrong` for structural hierarchy;
- `accentBright` and `focus` for headings and focus rings;
- `actionHover`, `actionPressed`, and `danger` for the existing red action family;
- `success`, `warning`, and `player` as contrast-safe semantic variants;
- `logoPrimary`, `logoSecondary`, `iconPrimary`, and `iconSecondary` for non-semantic chrome sprites;
- `scrim` and `scanline` with restrained opacity.

## Task 1: Lock the corrected contract with failing tests

**Files:**

- Modify: `public/clientTheme.test.js`
- Modify: `qa/theme.spec.js`

**Interfaces:**

- Consumes: the existing six-theme registry and `renderTheme` lifecycle.
- Produces: failing tests for complete UI tokens, default parity, theme-specific UI variables, semantic-color stability, and visible Standard-40/Metro-52 geometry.

- [ ] **Step 1: Add unit assertions for every required `ui` role.** Assert all six definitions contain non-empty hex values for every role, while Midnight values equal the current locked tokens.
- [ ] **Step 2: Add a semantic-color contract test.** Assert every theme exposes a stable semantic role map and that property-group roles are present separately from decorative accents.
- [ ] **Step 3: Add a browser test that applies each theme and reads computed CSS variables.** Assert the body, panels, buttons, inputs, board frame, and logo hooks change token values while their bounding boxes remain unchanged.
- [ ] **Step 4: Add a browser test that checks semantic property strips/status indicators retain their role-specific hue families after every theme change.**
- [ ] **Step 5: Run the focused tests and confirm they fail for missing `ui` tokens/rendering.**

Run:

```powershell
node public/clientTheme.test.js
npm run test:browser -- qa/theme.spec.js --project=desktop-1920 --grep "UI tokens|semantic colors"
```

Expected: failures identify missing theme UI token data and application, not test syntax errors.

## Task 2: Add complete theme UI tokens

**Files:**

- Modify: `public/clientThemeData.js`

**Interfaces:**

- Consumes: existing theme IDs, current Poorup locked tokens, environment metadata.
- Produces: immutable `theme.ui` data consumed by `clientThemeRender.js` and CSS aliases.

- [ ] **Step 1: Add the `ui` object to Midnight with the exact current token values.**
- [ ] **Step 2: Add Day, Spring, Summer, Autumn, and Winter values from the palette table.**
- [ ] **Step 3: Add a `semantic` map for property groups, success, danger, warning, player, ownership, and focus.** Keep these roles separate from environmental colors.
- [ ] **Step 4: Add `assetSlots` metadata for `light`, `weather`, `incident`, `signature`, and `detail`, with no more than five visible props per surface.
- [ ] **Step 5: Keep `deepFreeze`, `sanitizeThemeId`, `getTheme`, and `themeOptions` immutable and backward-compatible.**
- [ ] **Step 6: Run the unit tests and asset audit.**

Run:

```powershell
node public/clientTheme.test.js
node public/themeAssetAudit.test.js
```

Expected: all registry and existing asset checks pass, with the new token assertions green.

## Task 3: Apply UI tokens without changing layout

**Files:**

- Modify: `public/clientThemeRender.js`
- Modify: `public/styles.css`

**Interfaces:**

- Consumes: `theme.ui`, existing CSS variables, current environment layer lifecycle.
- Produces: themed canvas/chrome/panels/buttons/inputs/board surfaces with unchanged geometry.

- [ ] **Step 1: Add a single `applyThemeUiTokens(theme)` helper.** Set only existing variable names (`--bg-canvas`, `--surface-panel`, `--gold-050`, `--red-action`, and related aliases) on `document.body`.
- [ ] **Step 2: Keep a fallback chain to the locked Midnight values for missing or malformed token roles.**
- [ ] **Step 3: Replace themeable hard-coded chrome colors in `styles.css` with the existing variables.** Do not alter `display`, `position`, `grid`, `flex`, dimensions, font families, font sizes, or breakpoints.
- [ ] **Step 4: Keep semantic group strips and player colors on their existing variables.** Theme them only through explicitly contrast-checked shade aliases if required; never map them to decorative sky/accent colors.
- [ ] **Step 5: Keep UI token changes immediate.** Continue using the existing 300ms transform/opacity transition only for environment scenes.
- [ ] **Step 6: Run the UI-token browser tests at 1920px and compare Home, Profile, Rankings, Social, Rules, lobby, board, and modal bounding boxes against Midnight.**

## Task 4: Theme non-semantic Poorup sprites

**Files:**

- Modify: `public/clientSprites.js`
- Modify: `public/index.html` only if existing sprite hooks need a class or data attribute.

**Interfaces:**

- Consumes: `--theme-logo-primary`, `--theme-logo-secondary`, `--theme-icon-primary`, and `--theme-icon-secondary`.
- Produces: theme-aware Poorup logo and chrome icons without changing gameplay sprites.

- [ ] **Step 1: Add role-aware palette parameters for the logo and non-semantic chrome sprites.**
- [ ] **Step 2: Preserve explicit color arguments for avatars, houses, hotels, pawns, ownership marks, and property indicators.**
- [ ] **Step 3: Keep inline SVGs crisp-edged and default-compatible.**
- [ ] **Step 4: Add unit coverage proving an alternate theme changes the logo palette while an avatar/property strip remains unchanged.**

## Task 5: Revise the six environment asset families

**Files:**

- Add/modify: `public/assets/themes/<theme>/` SVG assets.
- Modify: `public/themeAssetAudit.test.js` if the asset inventory changes.

**Interfaces:**

- Consumes: theme asset slots and existing page/home/board scene mounts.
- Produces: authored seasonal environments at the existing 88×36 scene scale.

Required assets:

```text
midnight-ledger: scene.svg, moon.svg, helicopter.svg, rooftop.svg, windows.svg, beacon.svg
clearline-day: scene.svg, sun.svg, cloud-bank.svg, cloud-small.svg, civic-tower.svg, bird.svg
bloom-district: scene.svg, sun.svg, blossom.svg, house.svg, fence.svg, bird.svg
golden-hour-exchange: scene.svg, sun.svg, crane.svg, ferry.svg, palm.svg, gull.svg
rainy-copper-town: scene.svg, cloud.svg, leaf.svg, rain.svg, station.svg, street-lamp.svg
warm-window-snow-city: scene.svg, moon.svg, snow.svg, ice-roof.svg, pine.svg, smoke.svg
```

- [ ] **Step 1: Draw every scene at 88×36 with a calm center safe zone behind the existing logo and readable controls.**
- [ ] **Step 2: Place the Day sun and Winter moon in the upper-right, away from headings and focusable controls.**
- [ ] **Step 3: Make Day visibly daylight: light-blue sky, grey towers, several clouds, sun, and a restrained civic/bird detail.**
- [ ] **Step 4: Make Spring organic: green park edge, low houses, blossoms, fence, and one small bird.**
- [ ] **Step 5: Make Summer warm: yellow/copper light, waterfront/warehouse silhouette, crane/ferry/palm, and one gull.**
- [ ] **Step 6: Make Autumn material-driven: umber town, slate clouds, wet street bands, station, rain strip, and orange leaves.**
- [ ] **Step 7: Make Winter dark and cold: snow/ice on roofs, moon, pine edge, sparse flakes, and smoke.**
- [ ] **Step 8: Keep Midnight as the control scene: dark skyscrapers, warm windows, moon, rooftop, beacon, and rare helicopter.**
- [ ] **Step 9: Audit every SVG for integer alignment, crisp edges, no text/filter/gradient/external URL, bounded element count, and 1× silhouette readability.**

## Task 6: Preserve board and surface semantics

**Files:**

- Modify: `public/clientBoardRender.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Route board frame, board center, and tile surfaces through theme variables.**
- [ ] **Step 2: Keep Standard-40 tile order, dimensions, corner positions, hit targets, token anchors, and semantic IDs unchanged.**
- [ ] **Step 3: Keep Metro-52 grid size, 52 tiles, and four-corner contract unchanged.**
- [ ] **Step 4: Keep property strips, ownership pips, player tokens, rent values, and state markers semantically stable.**
- [ ] **Step 5: Verify a theme render cannot change board grid variables, tile count, tile dimensions, or board frame bounds.**

## Task 7: Keep selector behavior and motion accessible

**Files:**

- Modify: `public/clientTheme.js`
- Modify: `public/clientThemeRender.js`
- Modify: `public/styles.css`
- Modify: `qa/theme.spec.js`

- [ ] **Step 1: Keep `LOOK` inside Profile Preferences; add no navigation tab or page.**
- [ ] **Step 2: Keep six native radio choices with one roving Tab stop, correct `aria-checked`, labels, and descriptions.**
- [ ] **Step 3: Preserve Arrow keys, Home, End, Enter, Space, Escape, outside-click dismissal, focus restoration, localStorage sanitization, storage-event sync, and polite announcement.**
- [ ] **Step 4: Apply theme UI tokens immediately when a choice is selected; do not animate keyboard selection.**
- [ ] **Step 5: Crossfade only scenery with the existing strong ease-out for 300ms.**
- [ ] **Step 6: Pause hidden/document-hidden motion; use still settled scenes under reduced motion and usable controls under forced colors.**
- [ ] **Step 7: Keep all environmental layers behind UI surfaces, focus rings, modals, drawers, and required decisions.**

## Task 8: Contrast, responsive, and visual QA

**Files:**

- Modify: `public/clientTheme.test.js`
- Modify: `public/themeAssetAudit.test.js`
- Modify: `qa/theme.spec.js`
- Add: `qa/theme-contrast.spec.js` only if contrast checks cannot remain focused in `theme.spec.js`.

- [ ] **Step 1: Add a deterministic contrast helper that reads computed colors and calculates WCAG relative luminance.** Do not report ratios that were not measured.
- [ ] **Step 2: Check normal text at 4.5:1, large text at 3:1, and focus/UI boundaries at 3:1 for every theme and core surface.**
- [ ] **Step 3: Exercise forced colors, reduced motion, keyboard navigation, screen-reader names, 200% zoom, and no page overflow.**
- [ ] **Step 4: Run visual captures at 1920×1080 for Home in all six themes plus Profile selector, live Standard-40, live Metro-52, Rankings, Social, Rules, lobby, and a representative modal.
- [ ] **Step 5: Compare bounding boxes and grid variables to the Midnight baseline; a theme may change color/art only.**
- [ ] **Step 6: Run desktop 1366×768, tablet 1024×768, iPad landscape, and mobile 390×844 checks.
- [ ] **Step 7: Run `npm run lint`, `npm run lint:client`, `npm test`, `npm run test:audit`, `npm run coverage`, `npm run test:browser`, and `npm audit --omit=dev --audit-level=moderate`.
- [ ] **Step 8: Run the Impeccable detector once on changed UI files, inspect screenshots at native resolution, and run CodeScene preparation/review before the PR.

## Delivery and rollback

- Commit the plan and contract tests separately from token mapping, sprite/asset work, and QA hardening.
- Keep the default Midnight token map as the rollback path; deleting alternate theme entries must restore the original UI without a migration.
- Do not touch server files, ruleset data, Socket.IO payloads, or economy code.
- Do not push or merge until local tests, browser captures, CodeScene, and the full PR pipeline are green.

## Acceptance Criteria

- Midnight Ledger City remains the exact default and reset state.
- Day visibly contains a light-blue sky, grey skyscrapers, multiple clouds, and an upper-right sun.
- Spring, Summer, Autumn, and Winter each have distinct physical silhouettes, lighting, and bounded atmospheric motion.
- Buttons, panels, inputs, modals, rails, HUD, board surfaces, logo, and non-semantic chrome icons receive theme-appropriate colors.
- Fonts, layout, spacing, navigation, board geometry, controls, and gameplay do not change.
- Property/group/status semantics remain understandable and color-independent.
- No new page scroll, layout shift, keyboard trap, focus regression, or forced-colors failure exists.
- All six Home screenshots are visually inspected at 1920×1080.
- Full regression, browser, accessibility, coverage, dependency, Impeccable, and CodeScene checks pass.
