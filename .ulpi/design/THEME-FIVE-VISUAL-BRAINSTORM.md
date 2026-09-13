# Poorup Five-Theme Visual Brainstorm

Status: implemented as a client-only visual system on 2026-09-11. This document
follows the original Poorup visual system restored on commit `1398823`. It does
not change layout, typography, board geometry, navigation, gameplay, server
state, or Socket.IO contracts.

> **Current status (2026-09-12).** Theme assets use a mixed master-size
> contract. `SCENE`, `CLOUDS`, and Spring `PETALS` are authored at `640×360`
> (and the Light pedestrian poses also use `640×360`); compact layer props such
> as `LIGHT`, `SIGNATURE`, `WEATHER`, and `ACCENT` remain `320×180`. The Figma
> handoff in `docs/design/figma-theme-worlds-2026-09-11.md` is authoritative for
> the 640×360 world masters, and `public/themeAssetAudit.test.js` enforces the
> split. The former “every asset is 320×180” wording below is superseded.

## Design read

Poorup should feel like the same maintained arcade table in five different
worlds. The original dark terminal remains the default; the new themes change
light, weather, silhouette, and surface color roles without becoming five
unrelated applications.

## Invariants

- Original Poorup night is the default and is not counted as one of the five.
- The selector has six choices: Original, Spring, Summer, Autumn, Winter, and
  Light Mode.
- Implementation IDs are `original`, `spring`, `summer`, `autumn`, `winter`,
  and `light`; Original clears inline theme tokens and scene layers so the
  baseline remains unchanged.
- Fonts, spacing, corner radii, board dimensions, tile order, rails, modals,
  navigation, and control positions remain unchanged.
- Property-group colors, danger, success, warning, player identity, and focus
  semantics remain stable and are never replaced by decorative theme colors.
- Every new surface token passes WCAG 2.2 AA contrast checks.
- The environment stays behind readable UI and never becomes an interaction.
- Cloud silhouettes live in a dedicated `clouds.svg` layer for every world;
  they sit 14–18 master pixels lower than the original sky shelf and travel
  left-to-right in four held pixel poses, independently of petals, leaves,
  snow, rain, or water motion.
- No gradients, glassmorphism, neon glow, emoji controls, or stock artwork.

## Theme directions

### 1. Spring — Bloom Ledger

**World:** a compact residential district opening into a park. Two gabled
homes, a low apartment silhouette, a fence, and one blossom branch replace the
tall night skyline.

**Color roles:**

- canvas: deep blue-green with a muted cyan lift;
- panels: dark teal with a leaf-green structural line;
- primary action: deep forest green with warm cream text;
- secondary action: original dark control with a pale leaf border;
- highlight: restrained petal rose, never a success indicator;
- text and focus: existing Poorup gold roles, contrast checked.

**Motion:** one bounded petal pass after a visible Home entry. No continuous
particle field and no petals over buttons, cards, or board tiles.

**SVG set:** `scene.svg`, `light.svg`, `signature.svg`, `weather.svg`, `accent.svg`.

### 2. Summer — Solar Exchange

**World:** a working waterfront at late afternoon. Warehouses, a crane,
waterline, ferry, and distant aircraft create a horizontal rhythm different
from the vertical night city.

**Color roles:**

- canvas: deep water teal with a warm copper horizon;
- panels: dark teal with brass/copper secondary lines;
- primary action: dark ochre with high-contrast cream or ink text;
- secondary action: deep water control with a sun-gold edge;
- highlight: sand yellow and copper only in decorative environment layers;
- red danger and green success remain unchanged.

**Motion:** one slow aircraft or gull pass on Home and a static stepped
waterline shimmer. No parallax and no moving content behind decisions.

**SVG set:** `scene.svg`, `light.svg`, `signature.svg`, `weather.svg`, `accent.svg`.

### 3. Autumn — Copper Rain

**World:** a low old town during a steady shower. Connected townhouses, a
station canopy, wet street bands, warm windows, and a few leaves create a
material-rich scene without Halloween styling.

**Color roles:**

- canvas: slate teal with an umber undertone;
- panels: the original dark surfaces with copper active borders;
- primary action: burnt copper with cream text;
- secondary action: charcoal-teal with an olive edge;
- highlight: rust leaf and warm window gold;
- status colors stay semantically independent from the palette.

**Motion:** a short, cancellable leaf drift and a low-opacity rain strip. Both
pause on hidden views and become static under Reduced Motion.

**SVG set:** `scene.svg`, `light.svg`, `signature.svg`, `weather.svg`, `accent.svg`.

### 4. Winter — Frostline Ledger

**World:** a quiet city block after snowfall. Snow-capped roofs, a pine edge,
one distant tower, chimney smoke, and sparse warm windows preserve the Poorup
urban identity.

**Color roles:**

- canvas: ink blue with an ice-blue upper field;
- panels: cool dark teal with pale blue structural lines;
- primary action: deep blue-teal with cream text;
- secondary action: original dark control with an ice edge;
- highlight: snow gray and warm window gold;
- player blue and info blue remain the existing semantic tokens.

**Motion:** a small repeated square-flake strip and optional two-frame smoke.
Both stop when hidden and never cross the board, text, or focus ring.

**SVG set:** `scene.svg`, `light.svg`, `signature.svg`, `weather.svg`, `accent.svg`.

### 5. Light Mode — Clear Day

**World:** the original Poorup parlor in clear daylight. A pale blue-green
canvas, low civic skyline, broad clouds, and a square sun make the environment
open while dark instrument panels retain the product identity.

**Color roles:**

- canvas: pale blue-green with dark teal chrome;
- panels: deep teal and raised teal, never white cards everywhere;
- primary action: the established red action, tuned for dark text contrast;
- secondary action: dark teal with warm gold border;
- text: dark ink on light environment, original gold on dark surfaces;
- focus: a dark, high-contrast outline that works on both layers.

**Motion:** one slow cloud shelf on Home. No white flash during transitions and
no automatic system light/dark switching.

**SVG set:** `scene.svg`, `light.svg`, `signature.svg`, `weather.svg`, `accent.svg`.

## Selector and state contract

The existing Profile Preferences surface receives one compact `LOOK` trigger.
The selector uses six native radio controls and local SVG previews. It supports
Arrow keys, Home, End, Enter, Space, Escape, outside-click dismissal, focus
restoration, and the existing polite live region. Only a sanitized theme ID is
stored in localStorage and the `storage` event synchronizes other tabs.

No top-level navigation tab or page scroll is added. The selected theme is a
client preference only and cannot enter game state, room settings, history,
telemetry, or Socket.IO payloads.

## SVG and pixel-art contract

World-scene layers use a native `640×360` master canvas for the detailed
environment, cloud shelf, and Spring petal repeat (Light pedestrian poses use
the same canvas). Compact `LIGHT`, `SIGNATURE`, `WEATHER`, and `ACCENT` props
use native `320×180` masters. All assets use integer-aligned geometry,
`shape-rendering="crispEdges"`, a limited palette, selective one-pixel outlines,
and top-left lighting. Assets contain no filters, gradients, text nodes,
external URLs, editor metadata, or decorative UI. Every silhouette must remain
identifiable at 1x.

## Motion contract

Theme transitions use the existing 300ms ease-out and animate only opacity and
transform. Environmental loops are bounded, pause when their view is hidden or
the document is hidden, and respect `prefers-reduced-motion` and forced-colors
mode. Keyboard selection never adds motion that changes focus location.

## Contrast and QA gates

Before implementation is accepted:

1. Generate tonal scales for every new surface and action color.
2. Measure normal text at 4.5:1, large text and UI graphics at 3:1 minimum.
3. Check color-blind simulations and a no-color semantic pass.
4. Capture Original plus all five themes at 1920×1080.
5. Check 1366×768, 1024×768, iPad Landscape, 390×844, 200% zoom,
   Reduced Motion, Forced Colors, keyboard, and screen reader flows.
6. Confirm Standard-40 and Metro-52 geometry is unchanged.

## Skills applied to the eventual implementation

`frontend-design-ui-ux`, `frontend-design`, `design-taste-frontend`,
`frontend-design-review`, `critique`, `impeccable`, `color-system`,
`game-ui-ux`, `mobile-responsiveness`, `accessibility`,
`web-design-guidelines`, `svg-design`, `pixel-art-sprites`, `animate`,
`emilkowal-animations`, `design-motion-principles`, `improve-animations`,
`review-animations`, `software-architecture-design`,
`code-architecture-review`, `systematic-debugging`, `tdd`,
`qa-agent-testing`, `find-skills`, and `superpowers:verification-before-completion`.

The original Poorup design system remains authoritative over every one of
these lenses.

## Deferred decisions

- Whether the selector is called `LOOK` or `PARLOR LOOK`.
- Exact final token values after measured contrast checks.
- Whether the five asset families are delivered in one visual PR or five small
  asset slices.
- Automatic seasonal rotation is deliberately not included.
