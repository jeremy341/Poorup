# Poorup Theme Worlds — Figma Handoff

Figma source: [Poorup — Five Theme Pixel Worlds](https://www.figma.com/design/Aw42lmg2SWYSM900KPkYcB)

> **Current status (2026-09-12).** This handoff is the dimension authority for
> the detailed `640×360` world masters. Runtime theme props intentionally use a
> mixed contract: `SCENE`, `CLOUDS`, Spring `PETALS`, and Light pedestrian poses
> are `640×360`; compact props remain `320×180`. See
> `.ulpi/design/THEME-FIVE-VISUAL-BRAINSTORM.md` for the complete asset rule and
> `public/themeAssetAudit.test.js` for the enforced split.

The five non-baseline home worlds were rebuilt as editable SVG vectors in a
640×360 master coordinate space. At the 1920px target this produces a clean
3× pixel grid. The original dark Poorup baseline is intentionally not part of
this file and remains the application's default.

## Figma structure

Overview frame: `POORUP / FIVE THEME WORLDS` (`2:2`)

| World | Artboard | Layer order |
| --- | --- | --- |
| Spring | `WORLD / SPRING / 640x360` (`2:3`) | `SCENE → LIGHT → SIGNATURE → WEATHER → ACCENT` |
| Summer | `WORLD / SUMMER / 640x360` (`2:4`) | `SCENE → LIGHT → SIGNATURE → WEATHER → ACCENT` |
| Autumn | `WORLD / AUTUMN / 640x360` (`2:5`) | `SCENE → LIGHT → SIGNATURE → WEATHER → ACCENT` |
| Winter | `WORLD / WINTER / 640x360` (`2:6`) | `SCENE → LIGHT → SIGNATURE → WEATHER → ACCENT` |
| Light | `WORLD / LIGHT / 640x360` (`2:7`) | `SCENE → LIGHT → SIGNATURE → WEATHER → ACCENT` |

Every world also has five reusable Components in `POORUP / SVG COMPONENT
SOURCES` (`5:2`). Their names follow `COMPONENT / THEME / SLOT`, so the later
app integration can map one source file to one client layer without changing
the existing layout or Socket.IO contracts.

The app's ambient-motion extension adds two client-only source families that
remain outside the Figma world composition until the next asset-sync pass:
`spring/petals.svg` is a vertically repeating field, while
`light/pedestrians-pose-a.svg` and `light/pedestrians-pose-b.svg` are paired
walking poses aligned to the civic path.

## Layer contract

- `SCENE`: static sky, cloud shelf, depth skyline, buildings, houses, trees,
  water/road and ground texture.
- `LIGHT`: sun or moon block with a small halo made only from crisp rectangles.
- `SIGNATURE`: theme-defining structure such as park furniture, crane, lamps,
  bridge accents or civic tower.
- `WEATHER`: sparse petals, leaves, snow, rain or water glints.
- `ACCENT`: tiny birds, aircraft traces, smoke or secondary motion marks.
- `PETALS` (Spring only): a sparse 640×360 vertical repeat band.
- `PEDESTRIANS` (Light Home only): two neutral pose vectors on a horizontal
  repeat band; never rendered on board/page surfaces.

All imports are local SVG vectors with integer geometry and
`shape-rendering="crispEdges"`; no filters, gradients, text nodes, external
URLs or UI controls are inside the artwork. Motion remains a client concern:
only `transform`/`opacity` may animate, and the existing Reduced Motion and
hidden-view pauses remain authoritative.

Motion timings are intentionally slow and constant: Spring petals complete a
vertical pass in 14 seconds; Light pedestrians complete a horizontal pass in
36 seconds, with a 360ms two-pose leg cycle. Duplicate bands share their seam
at the cycle boundary, so neither animation teleports.

## App integration handoff

The current app already consumes the same five local layer files from
`public/assets/themes/<theme>/`. The next integration slice should replace the
current coarse layer internals with exports from the matching Figma Components,
then verify the existing `themeSceneMarkup()` layer order at 1920×1080. Do not
add navigation, alter the Poorup shell, or include the Original baseline in
the selector's new-world assets.
