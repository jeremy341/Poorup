# Poorup Theme System: Visual Brainstorm and Art Direction

Status: concept exploration only. No production code, CSS, asset, layout, navigation, or theme engine changes are included in this phase.

## Revision 2 — approved surface theming (2026-09-11)

The original environment-only direction has been superseded for implementation: the same six worlds now receive complete client-side UI token skins for the canvas, chrome, panels, inputs, buttons, board surfaces, logo, and non-semantic icons. Midnight Ledger City remains the exact default. Fonts, layout, spacing, navigation, board geometry, gameplay, server contracts, and semantic property/status colors remain locked. The implementation plan for this revision is `docs/superpowers/plans/2026-09-11-poorup-seasonal-theme-ui.md`.

## Applied design lenses

This pass used the local guidance for `frontend-design-ui-ux`, `design-taste-frontend`, `frontend-design`, `frontend-design-review`, `critique`, `impeccable`, `game-ui-ux`, `mobile-responsiveness`, `accessibility`, `web-design-guidelines`, `svg-design`, `pixel-art-sprites`, `animate`, `emilkowal-animations`, `improve-animations`, `review-animations`, and `find-skills`. The local catalog already covers the needed work, so no skill or package was installed. Architecture, backend, security, and test implementation skills are intentionally deferred because this is a visual direction document, not a runtime change.

## `/goal`

Design six future Poorup environments that feel like six worlds around the same game. Preserve the current application layout and interaction model exactly. Stop after this document so the directions can be reviewed before implementation.

## Design read

Reading this as: an art-direction spec for an existing multiplayer game product, for friends playing a competitive browser board game, with a retro-futurist terminal and parlor language, leaning toward the established Poorup bespoke design system with native HTML, CSS, SVG, and pixel-art layers.

### Design stance

The direction is **retro-futurist environmental storytelling**. The world changes outside the controls: sky, horizon, light, weather, silhouettes, and small background incidents. The interface remains the familiar Poorup instrument panel.

### Taste dials

These are concept-level constraints for a redesign that preserves the incumbent world:

| Dial | Value | Reason |
|---|---:|---|
| `DESIGN_VARIANCE` | 5 | Vary scenery and atmosphere, not component geometry or information architecture. |
| `MOTION_INTENSITY` | 4 | Keep ambient movement legible and sparse; the board remains the focal point. |
| `VISUAL_DENSITY` | 6 | Preserve the compact game-night cockpit and never cover decisions with decoration. |

The counterfactual test passes: this is not a generic seasonal palette swap. Each direction has a different physical place, light source, silhouette, and story while sharing one UI grammar.

## Current Poorup identity audit

### Visual authority

`.ulpi/design/DESIGN.md` is the lock. `PRODUCT.md`, the supplied design references, the live vanilla frontend, and the existing SVG inventory were inspected before this exploration.

### What makes the redesign recognisable

- Almost-black blue and teal canvas with tinted surfaces, never neutral SaaS gray.
- Warm muted gold carries hierarchy, borders, labels, board structure, and the wordmark.
- Action red is reserved for the main arcade action and danger states.
- Pixelify Sans, Silkscreen, and mono fallbacks keep headings, labels, numbers, and board names compact and readable.
- Square geometry, 1px hairlines, 2px active or board strokes, and 2px to 3px radii make the interface feel like a maintained terminal cabinet.
- The board is the visual anchor. The three-rail game shell, five-cell HUD, compact topbar, Profile, Rankings, Social, and Rules surfaces are the product's spatial memory.
- Texture is quiet: scanlines, a fixed noise layer, a vignette, inner highlights, and stepped status changes.
- The HTML/CSS board uses a crisp 40-space contract. The board skyline is painted into an `88 x 36` crisp-edge SVG viewBox. Home recycles two skyline strips for House Drift.
- Existing ambient motion is purposeful: House Drift, the patrol helicopter and impact, Night Shift targets, token travel, dice shake, card and panel entry, and live status indicators.
- The art inventory is a family of small crisp-edge SVGs and animated frame SVGs, not a stock illustration library. Existing icons include the board marks, airport plane, casino reel, social, rankings, rules, bot, sound, music, negotiation, and patrol sprites.
- Native buttons, labels, live regions, focus-visible rings, modal focus restoration, forced-colors rules, and reduced-motion variants are part of the identity, not optional polish.

### Existing layer map

Future themes should map to these existing layers rather than adding a second composition:

```text
application canvas
  scanlines and fixed noise
  page or board vignette
  theme sky and distant light
  theme horizon, skyline, village, field, or mountain silhouette
  low-contrast environmental motion
  existing Poorup UI surfaces, board, rails, cards, HUD, and modals
  rare foreground detail only when it cannot cross a control or readable text
```

Home currently owns the largest calm environment. The game center owns the board skyline behind the logo. Other pages can receive a quieter shared horizon treatment later, but no page may gain a new layout or a competing hero.

## Non-negotiable invariants

Every future implementation must keep these rules:

1. No page layout, component position, spacing structure, navigation structure, card structure, hierarchy, dashboard composition, interaction flow, or responsive layout changes.
2. Standard-40 board geometry, tile order, tile dimensions, corners, hit targets, token anchors, and semantic IDs remain unchanged. Metro-52 keeps its own approved geometry and readability contract.
3. Topbar, rails, HUD, Finance rail, Profile tabs, Rankings layout, Social surfaces, Rules book, modals, drawers, and card galleries remain the same components.
4. Theme colors never replace semantic status colors. Green still means success, red still means danger or action, blue still means the player or its existing group, and property strips retain their game meaning.
5. UI surfaces stay within the locked Poorup tokens. A theme may tint the environment and add a small atmospheric highlight, but it may not introduce a new radius language, glow language, font, or component library.
6. No glassmorphism, large gradients, pill-heavy controls, emoji controls, generic SaaS cards, or decorative text strips.
7. Environmental motion stays behind the UI. It must not cross a button, input, card title, HUD decision, focus ring, chart, or modal action.
8. Theme changes are a preference, never a game rule. A reconnect, room change, round start, or server event cannot silently change the selected world.
9. `prefers-reduced-motion`, forced colors, 200% zoom, keyboard use, touch targets, and screen-reader names remain first-class acceptance gates.
10. Every screen must read as the same product if placed side by side.

## Broad candidate pool

Scores are subjective art-direction scores, not product analytics. Each dimension is 1 to 5. `Build` means it can be made from the current SVG, CSS, and DOM layer model. `Family` means it can sit beside the other directions without becoming a different product.

| # | Candidate | World and time | Environment and atmosphere | Dominant read | Fit | Uniq | Beauty | Atmos | Use | Build | Perf | Family | Total |
|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Midnight Ledger City | After-hours city | Tall blocks, lit windows, distant patrol rotor | Deep teal, gold windows, cool haze | 5 | 4 | 5 | 5 | 5 | 5 | 5 | 5 | 39 |
| 2 | Quiet Midnight Ledger | Late night, nearly still | Low contrast skyline, sparse stars, empty streets | Ink teal, smoke blue, small gold signals | 5 | 3 | 4 | 5 | 5 | 5 | 5 | 5 | 37 |
| 3 | Rain-Slick Night Market | Night rain | Wet rooftops, signs, reflected pin lights | Teal, plum shadow, restrained amber | 4 | 5 | 5 | 5 | 4 | 4 | 3 | 4 | 34 |
| 4 | Sunrise Transit City | Early morning | Rail lines, pale towers, first commuter lights | Rose dawn, blue haze, copper edge | 5 | 4 | 5 | 4 | 5 | 4 | 4 | 5 | 36 |
| 5 | Clearline Day | Bright day | Open skyline, broad clouds, rescue flight | Sky blue, slate, warm gold | 5 | 4 | 4 | 4 | 5 | 5 | 5 | 5 | 37 |
| 6 | Cloudline Day | Soft overcast | Flat distant blocks and broad cloud shelf | Cool gray-blue, muted green | 4 | 3 | 4 | 4 | 5 | 5 | 5 | 4 | 34 |
| 7 | Bloom District | Spring afternoon | Suburban houses, park ring, blossom trees | Leaf green, petal pink, sky blue | 5 | 5 | 5 | 4 | 5 | 4 | 4 | 5 | 37 |
| 8 | Spring Park Ring | Spring morning | City edge, path, flowers, distant towers | Fresh green, soft cyan, cream light | 5 | 4 | 4 | 4 | 5 | 5 | 5 | 5 | 37 |
| 9 | Countryside Spring Ledger | Spring countryside | Fields, farmhouse, low hills, scattered trees | Field green, yellow light, blue sky | 4 | 5 | 4 | 4 | 4 | 3 | 4 | 4 | 32 |
| 10 | Sunlit Metro Heat | Summer noon | Bright towers, rooftops, aircraft, heat shimmer | Cobalt sky, concrete, warm yellow | 4 | 3 | 4 | 4 | 4 | 5 | 4 | 4 | 32 |
| 11 | Golden-Hour Exchange | Summer late afternoon | Waterfront commerce, long shadows, aircraft trail | Copper light, deep cyan, sunlit gold | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 5 | 38 |
| 12 | Mediterranean Trade Coast | Summer coast | White low-rise blocks, dry hills, bright sea | Sea blue, terracotta, pale stone | 3 | 5 | 5 | 5 | 3 | 3 | 3 | 3 | 30 |
| 13 | Summer Farm Belt | Summer rural | Large fields, farmhouse, windbreak trees | Grass green, wheat gold, blue | 3 | 4 | 4 | 4 | 4 | 3 | 4 | 3 | 29 |
| 14 | Rainy Copper Town | Autumn evening | Compact town, park edge, wet streets, low cloud | Copper, umber, slate rain | 5 | 4 | 5 | 5 | 5 | 5 | 5 | 5 | 39 |
| 15 | Autumn City Park | Autumn afternoon | Familiar skyline behind foreground trees | Olive, rust, gray sky | 4 | 4 | 4 | 4 | 5 | 5 | 5 | 4 | 35 |
| 16 | Rainy Autumn Arcade | Autumn night | Rain, signs, leaf gusts, small shop fronts | Dark teal, red leaf, amber | 4 | 5 | 5 | 5 | 4 | 4 | 3 | 4 | 34 |
| 17 | Warm Window Snow City | Winter evening | Snowy rooftops, apartment blocks, pine edge | Ice blue, snow gray, warm windows | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 5 | 38 |
| 18 | Snow Village Ledger | Winter afternoon | Small houses, pines, hills, chimney smoke | Snow white, pine green, blue shade | 4 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 33 |
| 19 | Alpine Winter Exchange | Winter daylight | Mountains, pine forest, snowfield | Glacier blue, white, dark pine | 3 | 5 | 5 | 4 | 3 | 3 | 3 | 3 | 29 |
| 20 | Fogbound Winter Morning | Winter dawn | Low fog, hidden horizon, bare trees | Blue gray, silver, faint gold | 4 | 4 | 4 | 4 | 4 | 5 | 5 | 4 | 34 |

### Candidate critique and decision

- **Adopt:** Midnight Ledger City, Clearline Day, Bloom District, Golden-Hour Exchange, Rainy Copper Town, and Warm Window Snow City. Together they cover city, open day, suburb and park, commerce and water, wet town, and snow city. Their difference is physical composition as much as color.
- **Keep as future variants:** Quiet Midnight Ledger can become a low-motion night preset; Sunrise Transit City can become a rare dawn event; Spring Park Ring can become a lighter spring alternate; Autumn City Park can become a clearer autumn alternate; Fogbound Winter Morning can become a low-contrast winter alternate.
- **Decline for the first six:** Rain-Slick Night Market and Rainy Autumn Arcade spend the same rain language twice and need more signage to read. Countryside Spring Ledger and Summer Farm Belt weaken the game's property-city association and require wider low-density horizons. Mediterranean Trade Coast and Alpine Winter Exchange are beautiful but change the cultural setting too sharply and compete with the compact board silhouette. Cloudline Day is useful but too close to Clearline Day. Sunlit Metro Heat is too close to Day unless it is pushed into the late-afternoon direction.

## Final six: shared art grammar

The six themes are not six palettes. They are six scene systems using a shared grammar:

- A common horizon scaffold with the existing `88 x 36` crisp-edge viewBox and integer-aligned geometry.
- One primary light source per world. Moon or city glow at night, sun or dawn in daylight, soft filtered light in rain, and cool sky light in snow.
- One distant silhouette family per world, with no more than two depth bands behind the UI.
- One environmental incident slot, such as a helicopter, bird, leaf, petal, cloud, or snow drift. It is low contrast and never required for comprehension.
- One static signature prop that makes the theme memorable at 1x viewing.
- The same Poorup borders, text, focus ring, semantic colors, card surfaces, and control geometry in every world.
- Custom SVG concepts use the existing crisp-edge style: small viewBoxes, 1px native outlines, hard-edged fills, no editor metadata, no text in distributed marks, and a restrained palette. Pixel-art assets should stay within roughly 4 to 12 colors per small prop, use square pixels, and pass a silhouette test at 1x.

### 1. Midnight Ledger City

**Core idea:** Poorup after closing time. The city is still awake, but the table is the brightest reliable signal.

**Why it fits:** This is the closest continuation of the current parlor. It preserves the dark teal canvas, lit windows, patrol language, and late-night identity while giving the default theme a more authored skyline.

**Environment and composition:** Keep the existing home and board geometry. Use a two-band skyline: a quiet near horizon with 12 to 14 block silhouettes and a farther band with smaller roof steps. Leave the center behind the logo calm. On non-game pages, show only the lower edge of the horizon so text and lists remain dominant.

**Sky and lighting:** Ink teal sky with a slightly cooler upper band. A low moon or city glow sits off-center, never directly behind a heading. Building windows use three fixed states: dark, warm, and one rare cool signal. The light direction is top-left, matching the existing pixel-art shading discipline.

**Buildings and terrain:** Narrow towers, water tanks, antennae, and one rooftop billboard silhouette. No high-detail skyline that turns into visual noise at small sizes.

**Vegetation and weather:** Almost none. A two-pixel tree line can break the horizon. Haze is a static translucent layer, not a blur filter.

**Palette and UI treatment:** Keep all locked UI tokens. Environmental colors are `#071b22`, `#123634`, `#78894f`, and a low-opacity cool blue highlight. Gold borders and red actions do not change. The board center stays `#031d1e` and receives only a darker skyline opacity.

**SVG concepts:** `world-night-heli.svg`, `world-night-rooftop.svg`, `world-night-moon.svg`, and a tiny three-state window strip. All are crisp-edge, 1x readable, and reusable between Home and the board center.

**Motion:** Retain the slow House Drift slot. Add one optional 12 to 18 second helicopter pass only on Home, using transform and opacity. Window lights can relay once when the connection becomes online. No permanent twinkle field.

**Static details:** A rooftop water tank, one lit apartment stairwell, and a tiny distant radio mast. They are story marks, not clickable controls.

**Microinteractions:** Theme preview draws a single window row left to right. A selected preview shows a gold frame, not a moving glow. The existing focus ring and button press remain unchanged.

**Theme transition:** Daylight fades down over 300ms, stars and warm windows appear in the same horizon positions, and the UI does not move. Under reduced motion, swap layers instantly.

**Easter eggs:** A tiny patrol beacon appears on a random but deterministic building. A rare rooftop sign can read `41` in the pixel mark, but it must remain decorative and not imply a hidden rule.

**Accessibility risks:** Dark environmental contrast could make focus or muted text disappear. Keep UI surfaces opaque enough to maintain current contrast and hide the skyline behind a scrim when a modal opens.

**Performance risks:** Too many window nodes or animated stars. Use a bounded SVG symbol set and static window patterns; no per-window JavaScript loop.

**Avoid:** Neon cyberpunk gradients, a starfield over every page, animated noise, or making the helicopter a required status signal.

**Distinct from the other five:** It is the only vertical, after-hours city world and the only theme where artificial window light is the main environmental story.

### 2. Clearline Day

**Core idea:** The same parlor at a clear midday. Visibility opens up, but the instrument panel remains Poorup.

**Why it fits:** It proves that a light environment does not require a white SaaS redesign. The existing dark surfaces become shaded awnings against a brighter world.

**Environment and composition:** Keep a broad, low-contrast skyline with more space between buildings than Night. Use one distant tower cluster and a low civic block line. The board center remains calm and the skyline stays inside the same center field bounds.

**Sky and lighting:** A muted blue sky with two stepped cloud bands. The sun sits high-left and is implied by a pale square halo, never a photographic gradient. Shadows fall down-right on buildings, consistent with the pixel-art light rule.

**Buildings and terrain:** Light slate towers, rooftop rails, water tanks, and a small rescue landing pad. The architecture is the daytime transformation of Night, not a new city.

**Vegetation and weather:** A small line of street trees and one or two birds. No weather noise. Clouds move slowly only when the Home surface is visible.

**Palette and UI treatment:** The environment may use `#6f9ca2`, `#aac0b0`, `#d5c38a`, and `#214047` at low opacity. UI remains the locked dark teal and gold stack because readable controls are more important than literal daylight. Gold borders are slightly brighter only where the existing token already allows it.

**SVG concepts:** `world-day-rescue.svg`, `world-day-cloud.svg`, `world-day-bird.svg`, and a simple sun plate. Use the same rotor and bird silhouette discipline as existing patrol sprites.

**Motion:** One cloud drift at 24 to 32 seconds, gated to Home. A rescue helicopter may pass once per Home entry, but it is not an autoplay spectacle. Birds use a two-frame stepped loop at most.

**Static details:** Rooftop antennas, a distant crane, and one bright window strip that reads as a reflective office facade.

**Microinteractions:** Day preview exposes the sun plate and a cloud band. Hover can brighten the preview border only on fine pointers. The board and controls never change scale.

**Theme transition:** Night windows dim, the sky lifts to blue, the moon plate becomes the sun plate, and the cloud band fades in over 300ms. Do not flash white. Reduced motion swaps the final layer with no travel.

**Easter eggs:** A tiny red rescue marker can mirror the current selected player's accent in a neutral background prop, never in a semantic status.

**Accessibility risks:** Pale sky can lower contrast around the page edge. Keep all interactive content on the current opaque surfaces and provide a consistent dark scrim behind overlays.

**Performance risks:** Large cloud filters and parallax. Use two flat SVG cloud strips with transform-only movement; no blur or canvas.

**Avoid:** Turning every surface white, using a photographic sky, blue action buttons, or relying on sky color to communicate online state.

**Distinct from the other five:** It is the clearest and most open world, with high sky exposure and civic daytime silhouettes rather than seasonal vegetation.

### 3. Bloom District

**Core idea:** Spring has reached the neighborhood around the table. The world is fresh, close, and inhabited without becoming cute or childish.

**Why it fits:** The lower-density suburb and park give the six-theme set a meaningful change in silhouette while the existing compact panels keep the game legible.

**Environment and composition:** Replace tall towers with a low suburban ring: two small houses, a park fence, one mid-rise distant block, and a shallow hill. Keep the horizon low so the board remains dominant. On the game center, use flowers only at the extreme lower corners of the skyline slot.

**Sky and lighting:** Soft blue with high, thin clouds. Light is warm but diffused. Use top-left highlights and cool green shadows; avoid full pastel wash.

**Buildings and terrain:** Gabled roofs, a park kiosk, a low apartment block, and a narrow path. Silhouettes must be readable at 1x and must not look like generic clip art.

**Vegetation and weather:** Leafy trees, one blossoming branch, short grass bands, and occasional petals. Petals are a rare ambient event, not a constant particle cloud.

**Palette and UI treatment:** Environmental accents can use muted leaf green `#4b853d`, petal rose `#b78383`, sky cyan `#6ea6a4`, and warm cream `#d9c58d`. Existing semantic green remains the only success color in UI; the environmental leaf green is lower opacity and never used in a status label.

**SVG concepts:** `world-spring-house.svg`, `world-spring-blossom.svg`, `world-spring-fence.svg`, and `world-spring-bird.svg`. Keep outlines selective and one pixel at native scale.

**Motion:** A six to eight petal loop can drift behind the center horizon for 5 to 7 seconds after Home appears, then stop. Trees use one or two-frame branch sway only if it can be implemented without a polling loop. Birds remain rare.

**Static details:** A bicycle by the kiosk, a mailbox, and a tiny garden plot. They should reward noticing but never become UI affordances.

**Microinteractions:** Selecting Spring previews a single blossom branch drawing from left to right. A hovered preview can reveal one petal, but touch and keyboard receive the same final state.

**Theme transition:** Snow or bare branches become green through a low-opacity crossfade. Petals do not burst across the screen. Reduced motion shows the final branch and light state immediately.

**Easter eggs:** A tiny flower bed can form the Poorup diamond motif. A rare mailbox flag can show a miniature room code shape without exposing real room data.

**Accessibility risks:** Pink petals and green leaves can look like status markers. Keep them behind the opaque content surfaces and never use them as the only indicator of selected theme or event state.

**Performance risks:** Particle count and DOM churn. Prefer one recycled SVG petal strip or a bounded pseudo-element, with a hard maximum and no random node creation.

**Avoid:** Candy colors, cartoon clouds, butterflies crossing text, or a garden that reads as a children's game.

**Distinct from the other five:** It is the only close-range residential and park environment, with organic forms replacing the hard skyline.

### 4. Golden-Hour Exchange

**Core idea:** The last strong sunlight hits a working waterfront and the city starts its evening trade.

**Why it fits:** Summer gets a structural identity through long shadows, cranes, water, and commerce instead of becoming a generic bright blue theme.

**Environment and composition:** Use a waterfront horizon: low warehouses, a crane, two mid-rise offices, a narrow water strip, and a distant aircraft path. The horizon remains low and the board center stays clean. On Home, the water strip can occupy the existing skyline band without adding height.

**Sky and lighting:** Warm late-afternoon sky with a pale copper sun at far right. Long shadows fall left from props. The sky remains a flat stepped ramp, not a gradient.

**Buildings and terrain:** Warehouse roofs, a crane arm, a small ferry silhouette, and two office blocks. One strong horizontal waterline gives the theme a different rhythm from all vertical city variants.

**Vegetation and weather:** Sparse shoreline grass and one wind-bent tree. A mild heat shimmer is represented by a static offset layer, not blur.

**Palette and UI treatment:** Environmental colors use copper `#b96d2a`, deep water teal `#123f45`, dusk rose `#8f6261`, and sun gold `#d5ac57`. The gold UI token remains the hierarchy color. The copper accent never replaces red action or green status.

**SVG concepts:** `world-summer-crane.svg`, `world-summer-ferry.svg`, `world-summer-aircraft.svg`, and `world-summer-gull.svg`. Use flat silhouettes and a shared 1px outline rule.

**Motion:** One slow aircraft or gull pass on Home, selected by a deterministic seed. A waterline shimmer may shift opacity by a few steps once per 28-second skyline cycle. No continuous wave animation under game decisions.

**Static details:** Cargo stacks, a dock light, a small radio mast, and one sunlit warehouse door.

**Microinteractions:** The theme preview shows the crane arm and a two-frame aircraft trail. The selected state remains a gold border and a text label, not a color-only highlight.

**Theme transition:** Day turns warmer through a 300ms light ramp and the skyline swaps from towers to the waterfront silhouette. Night retains the same horizon coordinates where possible so the transition feels like time passing, not a page change.

**Easter eggs:** A tiny ferry flag uses the current board's diamond mark. A crane can briefly align with the `41` achievement glyph in the miniature preview.

**Accessibility risks:** Copper and red can be confused. Keep copper at low-opacity environmental scale and preserve the existing red action contrast and text labels.

**Performance risks:** Water shimmer, filters, and multiple long paths. Use one flat water strip and one transform-only aircraft; no WebGL or large raster background.

**Avoid:** Beach postcards, saturated orange everywhere, full-screen sun flares, or a moving horizon that competes with the board.

**Distinct from the other five:** It is the only horizontal, industrial waterfront scene and the only theme whose signature silhouette is a crane and waterline.

### 5. Rainy Copper Town

**Core idea:** A compact old town in a steady autumn shower. Warm windows make the wet world feel playable instead of bleak.

**Why it fits:** Autumn is expressed through weather, material, and low-rise architecture. It does not simply recolor the Night city orange.

**Environment and composition:** Use a low row of connected townhouses, a small clock or station roof, a park edge, and one distant office block. The foreground horizon is slightly heavier but still stays below the board center's readable content.

**Sky and lighting:** Low slate clouds, a muted gray sky, and warm window squares. The light is diffuse from upper-left, with darker wet ground bands below.

**Buildings and terrain:** Brick-like blocks, awnings, gutters, a station canopy, and a shallow street line. Reflections are two or three hard-edged horizontal pixels, never a glossy gradient.

**Vegetation and weather:** Copper and olive trees, a few fallen leaves, and a narrow rain curtain. Rain should be a short, low-opacity background loop with a fixed maximum count.

**Palette and UI treatment:** Environmental colors use umber `#6e4a36`, copper `#a8613e`, olive `#6e7748`, slate `#32474b`, and warm window gold. UI surfaces stay dark teal; the existing red action remains the only urgent warm color in controls.

**SVG concepts:** `world-autumn-town.svg`, `world-autumn-leaf.svg`, `world-autumn-rain.svg`, and `world-autumn-station.svg`. Rain should be a reusable strip, not dozens of independent lines.

**Motion:** Leaves drift in one short, cancelable pass after a theme switch. Rain can loop slowly on Home, but it pauses when the view is hidden and becomes a still wet horizon under reduced motion.

**Static details:** A glowing station clock without readable numbers, a drain grate, a bench, and a single umbrella silhouette.

**Microinteractions:** Preview hover reveals a leaf edge or window reflection, gated to fine pointers. On keyboard selection, the final environment appears without hover-only motion.

**Theme transition:** Summer's warm light cools, the waterline becomes wet street, and leaves appear through a soft opacity blend. Do not shake the page or animate every tree.

**Easter eggs:** The station clock hand can point to the current round number only in a decorative preview. A drain cover can use the board's diamond shape.

**Accessibility risks:** Rain can create flicker and a busy background. Keep it behind surfaces, cap opacity, pause under reduced motion, and never use rain to indicate an error or loss.

**Performance risks:** Particle loops and transparency over the whole viewport. Use one recycled strip, CSS transform or SVG group, and no blur.

**Avoid:** Halloween orange and black, constant screen-wide rain, sound-dependent atmosphere, or orange status text that collides with semantic colors.

**Distinct from the other five:** It is the only wet, low-rise, material-rich town. Its identity comes from rain, reflections, and warm windows rather than a skyline or snow.

### 6. Warm Window Snow City

**Core idea:** Snow quiets the city while warm apartments keep the parlor alive.

**Why it fits:** Winter gets a strong cold-warm contrast without replacing Poorup's dark surfaces or turning the game into a holiday skin.

**Environment and composition:** Use snowy roofs on a compact city block, a pine edge, one distant tower, and a low snowbank. The center field remains open. Board skyline elements can be simplified into snow-capped versions of existing blocks.

**Sky and lighting:** Cold blue-gray sky with a pale winter sun or moon off-center. Warm windows are sparse and intentional. Snow receives top-left highlights and blue-violet shadow pixels.

**Buildings and terrain:** Apartment blocks, chimneys, snow caps, a small bridge or rail line, and one pine cluster. No mountains are needed for the first direction; keeping the horizon urban preserves the game identity.

**Vegetation and weather:** Picas of pine and bare branches, chimney smoke, and a slow snowfall layer. Snowflakes are square, sparse, and never larger than the existing background glyph scale.

**Palette and UI treatment:** Environmental colors use ice blue `#638b9a`, snow gray `#b8c4bb`, pine `#2e5148`, shadow teal `#12343c`, and warm window gold. UI keeps the locked dark teal, gold, red, and green system. Snow never becomes a white page background.

**SVG concepts:** `world-winter-roof.svg`, `world-winter-pine.svg`, `world-winter-snow.svg`, and `world-winter-smoke.svg`. Snow caps should be hard-edged with a single shadow ramp, not pillow shading.

**Motion:** A bounded snowfall strip can move at a slow linear rate on Home and pause when hidden. Chimney smoke is a two or three-frame opacity and transform loop only if it remains below the UI horizon. Reduced motion shows static flakes and smoke.

**Static details:** Warm stairwell windows, a snow-covered sign, a pine branch, and a tiny plowed path.

**Microinteractions:** Theme preview shows a roof receiving a single snow cap. The selection frame remains gold; winter blue is decorative only.

**Theme transition:** Autumn leaves fade out, the ground band cools, snow caps appear, and warm windows remain in place. Use one calm 300ms crossfade, not a blizzard.

**Easter eggs:** A snowbank can hide a tiny treasure chest outline. A chimney smoke puff can briefly form the Poorup diamond in the miniature preview.

**Accessibility risks:** White snow can reduce edge separation and flakes can distract motion-sensitive players. Keep UI surfaces opaque, use the existing focus ring, cap contrast, and honor reduced motion.

**Performance risks:** Snow particle count, alpha blending, and full-screen filters. Prefer a small repeated SVG strip or CSS pattern with transform-only movement; disable it for reduced motion and constrained data modes.

**Avoid:** Christmas iconography, bright white panels, glitter, large flakes over text, or cold blue semantic statuses.

**Distinct from the other five:** It is the only cold environment with a deliberate warm-window counterpoint and snow-shaped silhouettes.

## System comparison

| Theme | Primary silhouette | Light story | Weather or ambient motion | Signature prop | Main risk | Why it earns a slot |
|---|---|---|---|---|---|---|
| Midnight Ledger City | Vertical after-hours skyline | Artificial window light and moon haze | Rare helicopter, slow drift | Rooftop water tank and beacon | Too much star or neon noise | Defines the original Poorup world. |
| Clearline Day | Open civic skyline | High sun and cloud shelf | Cloud drift, rare rescue pass | Rescue pad and cloud band | Pale backgrounds weaken contrast | A true daylight transformation without white SaaS UI. |
| Bloom District | Suburb and park ring | Diffused spring sunlight | Short petal pass, rare birds | Blossom branch and park kiosk | Cute or pastel drift | Adds organic low-rise composition. |
| Golden-Hour Exchange | Waterfront warehouses and crane | Long copper shadows | Aircraft or gull pass, quiet waterline | Crane and ferry | Warm colors collide with danger red | Adds horizontal commerce and summer heat. |
| Rainy Copper Town | Low-rise town and station | Diffuse gray light, warm windows | Rain strip and leaf pass | Station canopy and wet street | Busy rain layer | Autumn through material and weather, not hue. |
| Warm Window Snow City | Snow-capped urban block and pines | Cold sky, warm windows | Sparse snow and smoke | Snow roof and chimney | White snow and alpha cost | Strong winter contrast while staying urban. |

### Coherence checks

- **Visual consistency:** all six use the same viewBox discipline, line weights, surface stack, type, borders, semantic colors, and control geometry.
- **Variety:** the silhouette changes from towers to civic skyline, suburb, waterfront, town, and snow city. No two themes depend on the same foreground prop.
- **Color balance:** the UI remains dark teal and gold. Environmental accents rotate through cool haze, sky blue, spring green, copper light, slate rain, and ice blue without changing semantic meaning.
- **Animation balance:** Night and Day use one flight or cloud slot; Spring uses petals; Summer uses one aircraft or gull; Autumn uses rain and leaves; Winter uses snow and smoke. Only one or two background loops may be active, and none is required to understand the game.
- **Hierarchy:** the board, turn state, required payment, action button, card title, and focus ring remain visually louder than any environment.
- **Responsive behavior:** scenery is cropped or simplified, never stretched. At iPad landscape widths the board and rails keep their current anchors, and environmental layers are allowed to disappear before any readable UI is reduced.
- **Redundancy test:** Night is vertical artificial light, Day is open civic air, Spring is organic neighborhood, Summer is horizontal commerce, Autumn is wet town material, and Winter is cold urban warmth. They are distinct enough to remember.

## Theme selector concepts

No selector is implemented in this phase. The selector must fit inside existing navigation and settings patterns, not create a new top-level destination.

### Preferred direction: Parlor Look popover

Add a compact `LOOK` or palette icon to the existing account or appearance surface. It opens an anchored rectangular popover with six miniature environment previews, one selected state, and a short text name. It does not push the topbar, change the nav, or create a new page.

- Use six custom preview SVGs, not emoji.
- Preview cards share one footprint and one reading order.
- Keyboard uses arrow keys within the grid, Enter applies, Escape dismisses, and focus returns to the opener.
- A screen reader hears the theme name, a one-sentence atmosphere, and selected state.
- The preview never relies on color alone. Each option has a text label and a distinct silhouette.
- Applying a theme gives immediate feedback in a polite live region. It never waits for a server round trip.

### Alternatives considered

1. A sun and moon button that expands into a horizontal strip. Fast, but it suggests only light and dark and hides the seasonal worlds.
2. A Profile Preferences section. Discoverable and account-friendly, but slower during a game night. It remains a good fallback for a full collection manager.
3. A six-way circular selector. Memorable, but it conflicts with the square Poorup geometry, keyboard order, and small iPad landscape space. Declined for the first version.

## Theme transitions

Theme changes are rare preference actions, so a short environmental transition is justified. The transition must show the world changing without making a user wait to act.

- Use one shared environment stack so the incoming and outgoing worlds occupy the same bounds.
- Crossfade opacity and transform only. Do not animate layout, board size, rail width, card height, or text position.
- Keep the normal UI response immediate. The selected state updates before the atmospheric transition completes.
- Suggested duration: 300ms with the existing strong ease-out token. A longer 500ms variant is reserved for a rare first-time showcase, not routine switching.
- Night to Day: window lights dim, sky lifts, clouds enter, and the sun plate appears.
- Summer to Autumn: copper light cools, the waterline becomes wet street, and leaves arrive from the horizon.
- Autumn to Winter: leaves stop, roofs receive snow caps, and warm windows remain stable.
- Winter to Spring: snow fades, green silhouettes appear, and one blossom branch resolves.
- Any theme to any theme: use a stable neutral bridge if there is no meaningful semantic handoff. Never run a cinematic chain of unrelated scenes.
- Reduced motion: replace the transition with an immediate final state. Keep a color or border change only when it helps confirm selection.
- Hidden or background tabs: do not advance a long animation while the surface is not visible. On return, show the settled state.

## Environmental SVG and pixel-art guardrails

These are future asset requirements, not assets created now.

- Use standalone SVGs with `xmlns`, an explicit `viewBox`, `shape-rendering="crispEdges"`, and no editor metadata.
- Keep shapes on integer coordinates where possible. Use one consistent native outline strategy and a top-left light source.
- Use shared symbols for repeated clouds, windows, leaves, flakes, and birds. Do not create one DOM node per particle.
- Design every prop at 1x first. If its silhouette is unclear at 1x, remove detail before adding color.
- Keep small props within a limited palette and avoid anti-aliased background halos.
- Use `image-rendering: pixelated` or `crisp-edges` for raster sprites and integer scale steps for previews.
- Do not use SVG text for distributed wordmarks or theme labels. Labels remain semantic HTML.
- Provide `aria-hidden="true"` for decorative scenery. If a theme selector uses a preview as content, pair it with an accessible text name and description.

## Accessibility and performance contract

The future implementation must preserve WCAG 2.2 AA behavior and the current Poorup interaction model.

### Accessibility

- Keep the current UI text and control colors. Run a contrast check for every environment combination; target at least 4.5:1 for normal text and 3:1 for large text and UI boundaries.
- Keep a solid opaque or sufficiently dense surface behind text, controls, charts, turn state, payments, and modal actions.
- Never communicate selected theme, weather, event state, or connection state by color alone. Use labels, borders, icons, or live text.
- Keep `:focus-visible` rings unchanged and visible over every theme. Focus must not be obscured by environmental art.
- Respect `prefers-reduced-motion`. Remove travel, shake, rotation, particle loops, and cross-screen parallax; show the settled scene.
- Keep keyboard order, pointer behavior, touch alternatives, screen-reader names, live-region politeness, forced colors, and 200% zoom behavior unchanged.
- A theme can never hide a global event warning, required payment, auction state, bankruptcy decision, current turn, or roll action.
- Do not auto-switch themes from local time, weather, or round state. Predictability is more accessible than surprise.

### Performance

- Prefer flat SVG and CSS layers over large rasters, WebGL, full-screen blur, or canvas particle systems.
- Animate only `transform` and `opacity`, with explicit properties and interruptible transitions.
- Bound every loop by duration, node count, and visibility. Pause when the view is hidden.
- Use static fallback artwork for constrained data, reduced motion, forced colors, and low-power devices.
- Avoid layout reads and JavaScript animation loops. Reuse the existing event-driven ambient lifecycle.
- Reserve space for any future image or sprite so theme selection cannot cause layout shift.
- Keep the environment behind the app's existing z-index layers. Modal, drawer, toast, and focus layers always win.

### QA matrix after approval

Capture the existing surfaces with each approved theme at 1920 x 1080, 1366 x 768, 1024 x 768, 834 x 1194 iPad landscape equivalent, and 390 x 844. The game acceptance target is landscape on iPad. Verify Home, both lobbies, Standard-40, Metro-52, Rankings, Profile Collection, Market, Rules, Social, modals, drawers, empty states, error states, keyboard flow, forced colors, reduced motion, and 200% zoom.

The official Web Interface Guidelines used for the interaction checklist require semantic controls, visible focus, live regions for async updates, explicit reduced-motion behavior, transform and opacity animation, contained modal scrolling, and clear stateful URLs where relevant: [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md). The accessibility target is [WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/) with the [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) for any new composite selector.

## Better ideas discovered

### 1. Weather is a scene modifier, not a seventh theme

Rain, fog, dawn, or a clear sky should remain optional variants inside the six worlds. A seventh top-level theme would increase selector load and make the family harder to maintain. A future `weatherVariant` can be a deterministic, low-motion decoration only if it does not become another settings maze.

### 2. Theme memory can be an achievement-safe collectible

If the achievement system later wants environmental discoveries, record a harmless `world-noticed` event locally or server-side without giving gameplay power. A hidden rooftop, station clock, or snowbank can reward curiosity while keeping the theme itself cosmetic.

### 3. Sound should follow the existing global audio contract

Theme-specific ambience can be proposed later as a very small optional layer under the existing global sound and music controls. It must never auto-enable, override the user's mute state, or become necessary to read the world.

### 4. Seasonal timing should be opt-in, never automatic

An optional calendar suggestion could recommend a season, but the user should remain in control. Automatic changes during a match would make screenshots, accessibility testing, and player expectations less stable.

### 5. The board can carry a tiny world mark

Instead of changing board tiles, each theme can add one small environmental mark to the center skyline or corner of the existing board frame. It gives the game a collectible sense of place without touching the 40-space contract.

## Design pre-flight result

This is a concept document, so implementation-only boxes are recorded as future gates rather than falsely marked as shipped.

| Gate | Concept result |
|---|---|
| Identity lock | Pass. The existing Poorup tokens, type, geometry, motion vocabulary, and product register are treated as normative. |
| Anti-slop | Pass. Directions differ by physical environment and light story, not generic palette swaps, glass cards, or gradient decoration. |
| State and flow coverage | Pass for the selector and transition concept. Loading, empty, error, dismissal, focus restoration, hidden tab, and reduced-motion states are specified for later implementation. |
| Accessibility | Pass at spec level. Existing opaque UI surfaces and focus rules remain locked; contrast and browser verification are implementation gates. |
| Layout craft | Pass. No new layout family is introduced. The environment is a bounded layer behind the established composition. |
| Cognitive load | Pass. Six themes are a single appearance choice in one compact popover; there is no intensity, rarity, duration, or weather settings maze. |
| Motion motivation | Pass. Every proposed loop communicates place, time, or state. Keyboard selection and frequent game actions remain immediate. |
| Self-critique | Distinctiveness 4/4, hierarchy 4/4, identity consistency 4/4, accessibility readiness 3/4, state coverage 3/4, copy quality 4/4, restraint 4/4, motion motivation 4/4. The two 3s are deliberate implementation verification work, not unresolved design drift. |

## Approval boundary and future handoff

No theme system, selector, CSS variable map, SVG, sprite, animation, asset, or production refactor should begin until the six directions are approved or revised.

After approval, the build should proceed in small reviewable slices:

1. Freeze a theme contract and visual regression baselines without changing layout.
2. Add one shared environment layer and one theme identifier, reusing existing skyline lifecycle hooks.
3. Build Midnight Ledger City first as the control theme and validate it at 1920px.
4. Add the five remaining environment data sets and custom SVG assets using the shared pixel-art guardrails.
5. Add the compact Parlor Look popover with keyboard, touch, live-region, and focus-restoration behavior.
6. Add the 300ms environment crossfade and reduced-motion final-state path.
7. Run browser, accessibility, performance, and visual QA across the full matrix before considering the theme slice complete.

The implementation handoff is intentionally deferred. The only approved work in this phase is the art direction above.
