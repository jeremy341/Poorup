# Poorup — Visual Design System

Source: derived from the provided 1672×941 desktop screenshot. Values are reconstruction targets from the raster reference, so colors and measurements should be treated as design tokens rather than claims about the original source code.

## 1. Design DNA

Poorup is a **retro terminal / late-night arcade / pixel-board-game** interface.

Core rules:

1. Almost-black blue/teal surfaces, never neutral gray.
2. Warm muted gold defines hierarchy, borders, labels, and game-board structure.
3. Pixel/monospace typography is used throughout.
4. Geometry is compact, rectangular, and mostly square-cornered.
5. Borders do more work than shadows.
6. Status colors are saturated but slightly dirty/muted rather than neon.
7. UI density is intentionally high.
8. Decorative texture is subtle: slight noise, vignette, inner highlights, pixel details.
9. Main CTA is a large red arcade-style action button.
10. Avoid modern SaaS styling: no glassmorphism, pill overload, large rounded cards, soft pastel backgrounds, or airy layouts.

---

# 2. Color System

## Backgrounds / surfaces

| Token | Hex | Use |
|---|---:|---|
| `bg.canvas` | `#01070A` | application canvas / page background |
| `bg.chrome` | `#020A0D` | top navigation / outer chrome |
| `surface.panel` | `#071314` | cards, side panels |
| `surface.panelRaised` | `#09191A` | player rows, nested cards |
| `surface.panelDeep` | `#030C10` | chat body / darker insets |
| `surface.boardTile` | `#061011` | board property tiles |
| `surface.boardCenter` | `#031D1E` | central board playfield |
| `surface.input` | `#061216` | text inputs |
| `surface.buttonDark` | `#081516` | secondary buttons |

## Gold / parchment hierarchy

| Token | Hex | Use |
|---|---:|---|
| `gold.050` | `#F0D9AC` | brightest text / dice / high-emphasis icons |
| `gold.100` | `#E8D3AB` | primary light text |
| `gold.300` | `#CFA75F` | logo, board title, major icon gold |
| `gold.400` | `#C88F2E` | selected outlines / active accents |
| `gold.500` | `#9B783D` | strong structural borders |
| `gold.700` | `#5C5033` | normal panel borders |
| `gold.800` | `#3A382A` | subtle separators |
| `gold.muted` | `#A79D7D` | secondary text |

The raster reference contains anti-aliasing and texture, so a single line often contains several nearby gold values. Use these tokens consistently instead of sampling every pixel.

## Semantic / player / property colors

| Token | Hex | Use |
|---|---:|---|
| `red.action` | `#AF2A21` | Roll Dice button base |
| `red.bright` | `#D74438` | chance marks, alerts |
| `red.dark` | `#87231E` | red property strips |
| `green.status` | `#35A653` | online, owned, positive money |
| `green.property` | `#4B853D` | green property group |
| `blue.player` | `#286EA1` | blue player / blue property |
| `cyan.property` | `#3E7D7B` | cyan/light-blue property group |
| `magenta.property` | `#A04E6F` | magenta property group |
| `brown.property` | `#7B5029` | brown property group |
| `olive.icon` | `#78894F` | vacation / muted green pixel art |

## Text

| Token | Hex |
|---|---:|
| `text.primary` | `#E8D3AB` |
| `text.secondary` | `#A79D7D` |
| `text.muted` | `#777564` |
| `text.gold` | `#CFA75F` |
| `text.success` | `#35A653` |
| `text.danger` | `#D74438` |
| `text.blue` | `#3C8BC3` |

---

# 3. Typography

The exact font cannot be proven from a raster screenshot alone. The system clearly uses a square, retro monospace/pixel family.

## Recommended practical stack

### Display / brand
- Preferred: custom outlined `POORUP` logo asset from the board
- Alternatives: `Pixelify Sans` 700–800, `Jersey 10`, or `Press Start 2P` for small decorative labels

### UI / game text
- Preferred: `Pixel Operator`, `Departure Mono`, or another readable bitmap-style mono
- Fallback: `"Courier New", monospace`

### Body / chat fallback
- `IBM Plex Mono` or `Geist Mono` if a smoother readable mono is needed

## Type scale

| Style | Size | Line height | Weight | Tracking | Case |
|---|---:|---:|---:|---:|---|
| `display.brand` | 42–48 px | 1.0 | 800 | `0.01em` | Title Case |
| `display.boardLogo` | 64–82 px | 0.95 | 900 | `0.03em` | UPPERCASE |
| `heading.section` | 15–17 px | 1.2 | 700 | `0.04em` | UPPERCASE |
| `heading.panel` | 14–16 px | 1.2 | 700 | `0.03em` | UPPERCASE |
| `label.control` | 12–14 px | 1.2 | 700 | `0.02em` | UPPERCASE |
| `body.normal` | 14–16 px | 1.45 | 500 | `0` | normal |
| `body.compact` | 12–13 px | 1.35 | 500 | `0` | normal |
| `money.large` | 38–44 px | 1.0 | 700 | `0` | normal |
| `cta.large` | 34–38 px | 1.0 | 600 | `0.01em` | Title Case |
| `board.tile` | 11–13 px | 1.15 | 700 | `0.02em` | UPPERCASE |

### Typography rules

- Keep numerals monospaced.
- Prefer uppercase for section labels, tabs, board tiles, and utility labels.
- Chat/user names use player color.
- Do not use thin font weights.
- Avoid wide letter spacing; the visual language is compact.
- Pixel text should be rendered on integer pixel positions when possible.

---

# 4. Spacing System

Use a **4 px micro-grid** with an **8 px primary rhythm**.

```text
2 px   optical nudge only
4 px   micro gap
8 px   standard internal gap
12 px  compact padding
16 px  standard panel padding / panel-to-panel gap
20 px  medium inset
24 px  section spacing
32 px  major grouping
40 px  large control spacing
```

## Screenshot-level layout proportions

Reference viewport: **1672 × 941 px**

Approximate desktop regions:

- top bar: `68–70 px`
- outer page inset: `14–16 px`
- left rail: `~280 px`
- board region: `~950 px`
- right rail: `~325 px`
- horizontal gaps: `14–18 px`
- bottom HUD row height: `~135 px`
- board-to-bottom-HUD gap: `~14 px`

Recommended shell:

```css
grid-template-columns: 280px minmax(760px, 1fr) 326px;
gap: 16px;
padding: 12px 14px 14px;
```

---

# 5. Borders / Lines / Radii

Borders are essential to the look.

## Stroke tokens

| Token | Value | Color |
|---|---:|---|
| `stroke.hairline` | 1 px | `#3A382A` |
| `stroke.default` | 1 px | `#5C5033` |
| `stroke.strong` | 2 px | `#6B5A36` |
| `stroke.active` | 2 px | `#C88F2E` |
| `stroke.board` | 1–2 px | `#9B783D` |
| `stroke.dark` | 1 px | `#1D2927` |

### Border construction

Most containers should use a layered edge:

1. dark outer edge
2. muted-gold 1 px inner border
3. subtle inner highlight at low opacity

Example:

```css
border: 1px solid #5C5033;
box-shadow:
  0 0 0 1px #101916,
  inset 0 1px 0 rgb(232 211 171 / 6%),
  0 2px 6px rgb(0 0 0 / 38%);
```

## Radius

| Element | Radius |
|---|---:|
| major panel | 2–3 px |
| player row | 2 px |
| tabs | 0 px |
| board tiles | 0–1 px |
| input | 2 px |
| main CTA | 0–2 px |
| dice cards | 2–3 px |

Do **not** use 8–16 px modern card radii.

---

# 6. Shadows, Depth & Texture

The interface is mostly border-driven, but there is restrained depth.

## Shadow tokens

```css
--shadow-panel: 0 2px 8px rgb(0 0 0 / 45%);
--shadow-inset: inset 0 1px 0 rgb(240 217 172 / 5%);
--shadow-active: 0 0 8px rgb(200 143 46 / 12%);
--shadow-red: 0 3px 0 #721C18, 0 5px 10px rgb(0 0 0 / 35%);
```

## Texture

Use one or both:

- `1–2%` monochrome noise
- dark radial vignette toward panel/board edges

Texture must remain subtle. It should be felt, not read as a visible overlay.

---

# 7. Iconography

Style:

- pixel-art / low-resolution silhouette
- mostly one or two colors
- square caps and joins
- no modern rounded outline icons
- icon size aligned to an 8 px grid

Sizes:

- small utility icon: 14–18 px
- panel icon: 20–28 px
- board icon: 24–42 px
- large action icon: 38–48 px

Colors:

- default icon: `gold.300`
- secondary icon: `olive.icon`
- chance/error: `red.bright`
- player icons: player semantic color

---

# 8. Components

## A. Top Navigation

Height: `68–70 px`

Layout:
- brand left
- room code centered-ish
- online indicator beside it
- help action right

Rules:
- bottom separator: `1 px #3A382A`
- background: `#020A0D`
- no rounded app-bar container
- logo is the visual anchor

### Room badge
- height: ~40 px
- horizontal padding: 18 px
- dark background
- 1 px muted-gold border
- first word in amber/gold; code in parchment

### Online status
- 10–12 px green circle
- label `text.primary`
- 10 px gap

---

## B. Primary Side Panel

Example: Players / Chat

```text
background: surface.panel
border: stroke.default
padding: 12–14 px
```

Section title:
- 15–16 px
- gold
- uppercase
- small pixel ornament on both sides

### Player row
Height: ~66 px

- background: `surface.panelRaised`
- default border: `#3A382A`
- active border: `2 px #C88F2E`
- 12 px horizontal padding
- avatar: ~42×42 px
- name: 15–16 px
- money: 13–14 px muted gold
- state indicator aligned right

Active player gets:
- gold outline
- gold directional marker
- crown icon

---

## C. Chat

Chat body:
- deep inset background `#030C10`
- no individual message bubbles
- messages appear as terminal-like rows

Name colors:
- red player: `#D74438`
- blue player: `#3C8BC3`
- yellow player: `#D9A62F`
- green player: `#35A653`

Message body: `text.secondary`

Input:
- 44–46 px height
- background `surface.input`
- 1 px dark-gold border
- placeholder muted
- send button is square, ~40 px

---

## D. Board

Board styling is the most decorative element.

### Board frame
- near-black tile background
- gold structural borders
- slightly stronger border than general UI
- center field is dark teal (`#031D1E`)
- subtle vignette/noise

### Tile text
- 11–13 px pixel mono
- uppercase
- centered
- warm parchment/gold

### Property strips
Use saturated, muted colors:
- brown `#7B5029`
- cyan `#3E7D7B`
- magenta `#A04E6F`
- red `#87231E`
- green `#4B853D`
- blue `#286EA1`

### Center
- skyline: muted olive/teal, `~40–55%` opacity
- logo: strong gold
- decorative rules/dots use `gold.300`
- subtitle is smaller uppercase mono
- cards are slightly rotated and use hard borders, not soft card shadows

---

## E. Properties Panel

Width: ~326 px

Header tabs:
- 3 equal-ish tabs
- uppercase
- inactive = muted
- active = gold
- active underline = 2 px amber/gold

Property card:
- ~95 px tall
- surface panel
- 1 px divider/border
- 8–12 px padding
- left property-color rail: 8–10 px wide
- name and price on top row
- rent data below
- icons small and aligned to baseline

Owned utility cards:
- status text green
- simpler two-row structure

Footer button:
- full width
- dark background
- 1 px gold border
- uppercase
- 42–46 px height

---

## F. Bottom HUD

Five visual groups:

1. current turn
2. cash
3. dice
4. vacation pool
5. Roll Dice CTA

Height: about `132–138 px`.

Each normal HUD cell:
- dark panel
- 1 px gold-dark border
- 12–18 px inset
- labels uppercase gold
- content large and visually centered

### Current Turn
- arrow icon gold
- player name ~36 px
- strong visual emphasis

### Cash
- value green
- ~40 px
- banknote pixel illustration on right

### Dice
- two cream square dice
- use `gold.050` / ivory faces
- dark pips
- 14–18 px gap between dice

### Vacation Pool
- palm icon olive
- color swatches 10–12 px
- amount green

---

## G. Primary CTA — Roll Dice

This is deliberately the brightest and largest UI control.

Approx:
- height: 100–105 px
- fill: `#AF2A21`
- slightly brighter center/highlight
- dark red bottom edge
- thin parchment edge highlight
- square-ish corners
- icon: cream
- label: cream, 34–38 px

States:

```text
Default  #AF2A21
Hover    #BE3126
Pressed  #98231C
Disabled #63302B + 50% text
Focus    2 px #E8D3AB outside
```

Avoid a generic CSS gradient. If a gradient is used, keep it almost flat.

---

# 9. Interaction Rules

## Hover
- brighten border, not background dramatically
- +8–12% luminance
- cursor changes immediately
- optional 1 px upward highlight

## Active / selected
- use `gold.400` stroke
- do not rely on glow alone

## Pressed
- move content down `1–2 px`
- darken surface
- reduce bottom shadow

## Focus
- visible 2 px gold/parchment outline
- never remove keyboard focus

## Status
- online/owned/success = green
- warning/current actionable = amber
- chance/error/critical = red
- secondary player/info = blue

---

# 10. Motion

This UI should not feel fluid like a modern mobile app.

Recommended:

```text
hover:     80–120 ms
press:     60–80 ms
panel:     120–160 ms
dice roll: 350–650 ms
```

Use:
- stepped easing or short ease-out
- small pixel-like shifts
- no springy/bouncy UI
- no large fades

---

# 11. Figma Style Naming

## Colors

```text
BG / Canvas
BG / Chrome
Surface / Panel
Surface / Panel Raised
Surface / Deep
Surface / Board
Surface / Input

Text / Primary
Text / Secondary
Text / Muted
Text / Gold

Gold / 050
Gold / 100
Gold / 300
Gold / 400
Gold / 500
Gold / 700
Gold / 800

Semantic / Red
Semantic / Green
Semantic / Blue

Property / Brown
Property / Cyan
Property / Magenta
Property / Red
Property / Green
Property / Blue
```

## Text styles

```text
Display / Brand
Display / Board Logo
Heading / Section
Heading / Panel
Label / Control
Body / Normal
Body / Compact
Value / Money Large
CTA / Large
Board / Tile
```

## Effects

```text
Effect / Panel Shadow
Effect / Inset Highlight
Effect / Active Gold
Effect / CTA Red
```

---

# 12. CSS Token Starter

```css
:root {
  --bg-canvas: #01070a;
  --bg-chrome: #020a0d;

  --surface-panel: #071314;
  --surface-panel-raised: #09191a;
  --surface-panel-deep: #030c10;
  --surface-board-tile: #061011;
  --surface-board-center: #031d1e;
  --surface-input: #061216;

  --gold-050: #f0d9ac;
  --gold-100: #e8d3ab;
  --gold-300: #cfa75f;
  --gold-400: #c88f2e;
  --gold-500: #9b783d;
  --gold-700: #5c5033;
  --gold-800: #3a382a;

  --text-primary: #e8d3ab;
  --text-secondary: #a79d7d;
  --text-muted: #777564;

  --red-action: #af2a21;
  --red-bright: #d74438;
  --green-status: #35a653;
  --blue-player: #286ea1;

  --property-brown: #7b5029;
  --property-cyan: #3e7d7b;
  --property-magenta: #a04e6f;
  --property-red: #87231e;
  --property-green: #4b853d;
  --property-blue: #286ea1;
  --olive-icon: #78894f;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;

  --radius-xs: 2px;
  --radius-sm: 3px;

  --stroke-hairline: 1px;
  --stroke-strong: 2px;

  --shadow-panel: 0 2px 8px rgb(0 0 0 / 45%);
  --shadow-inset: inset 0 1px 0 rgb(240 217 172 / 5%);
}
```

---

# 13. “Does this still look like Poorup?” Checklist

A new screen belongs to the system if:

- background is nearly black with a teal/green bias
- gold lines establish the structure
- corners are nearly square
- pixel/mono typography dominates
- layout is dense but aligned
- status colors are muted-saturated rather than neon
- borders are more prominent than shadows
- CTA red is reserved for major action
- icons look pixel-made rather than generic SVG-library icons
- spacing follows 4/8 px increments
- there are no oversized rounded white cards
- decorative texture remains subtle
