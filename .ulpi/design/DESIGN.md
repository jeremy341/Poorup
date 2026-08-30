# Poorup Supplied Design System

## Visual authority

The supplied `poorup_design_system.md`, `poorup_tokens.css`, and `poorup_figma_tokens.json` are the source of truth for this interface. The ZIP React project is a visual reference only; live behavior remains in the vanilla Socket.IO client.

## Direction

Retro terminal / late-night arcade / pixel board game. Compact rectangular geometry, square corners, gold structural borders, almost-black blue/teal surfaces, muted saturated status colors, and pixel/mono type throughout.

## Locked tokens

- Canvas: `#01070A`; chrome: `#020A0D`.
- Panel: `#071314`; raised panel: `#09191A`; deep surface: `#030C10`.
- Board tile: `#061011`; board center: `#031D1E`; input: `#061216`.
- Gold: `#F0D9AC`, `#E8D3AB`, `#CFA75F`, `#C88F2E`, `#9B783D`, `#5C5033`, `#3A382A`.
- Action red: `#AF2A21`; hover: `#BE3126`; pressed: `#98231C`; bright red: `#D74438`.
- Status green: `#35A653`; player blue: `#286EA1`; olive icon: `#78894F`.
- Property groups: brown `#7B5029`, cyan `#3E7D7B`, magenta `#A04E6F`, red `#87231E`, green `#4B853D`, blue `#286EA1`.
- Spacing: 2, 4, 8, 12, 16, 20, 24, 32, 40px.
- Radii: 2px and 3px only.
- Strokes: 1px hairline/default, 2px strong/active/board.

## Typography

- Display: Pixelify Sans with Courier New fallback.
- UI: the supplied `"Pixel Operator", "Departure Mono", "Courier New", monospace` stack, locally fulfilled by the bundled Pixelify Sans asset when the named fonts are unavailable.
- Body/numeric: the supplied `"IBM Plex Mono", "Geist Mono", "Courier New", monospace` stack.
- Use tabular numerals for cash, rent, bids, timers, and room codes.
- Uppercase labels and board tiles; readable body copy; no thin weights.

## Component rules

- Borders carry hierarchy; shadows are restrained and tinted toward the canvas.
- No glassmorphism, airy SaaS cards, pill overload, gradient text, emoji icons, or neon cyberpunk glow.
- Primary action is the red arcade-style control. Secondary controls use dark surfaces and gold borders.
- Player rows are 66px minimum, active rows use a 2px gold outline and directional marker.
- Chat is terminal-like rows on the deep surface, not speech bubbles.
- Properties use compact rows with a semantic color strip and readable rent values.
- Board is the visual anchor; the `23;26` plain client owns the 32-space visual grid and the live client overlays server interaction state.

## Motion and accessibility

- Hover: 80–120ms; press: 60–80ms; panels: 120–160ms; dice: 350–650ms.
- Prefer stepped/ease-out motion. Animate `transform` and `opacity` only.
- Reduce travel, shake, rotation, and stagger under `prefers-reduced-motion`.
- Native controls, visible focus, focus trapping/restoration, inert backgrounds, 44px preferred targets, WCAG 2.2 AA contrast, color-independent state, live announcements, and 200% zoom support are mandatory.

## Board contract

- Gameplay presentation uses the supplied `public/assets/poorup_board_1to1_figma_master.svg` asset byte-for-byte. The server remains on its 0–39 contract while transparent client overlays preserve live interaction without rewriting the master artwork.
- `public/assets/legacy-board-40.svg` is the protected rollback/reference copy; its artwork is not reused in the generated board.
- Landing atmosphere uses `public/assets/poorup_board_exact_tilted.svg`.
- The server remains authoritative for live tile indexes 0–39. Transparent native hit targets and client-rendered tokens layer above the generated artwork.
