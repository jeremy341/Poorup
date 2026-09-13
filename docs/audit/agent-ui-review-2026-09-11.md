# Poorup UI / visual audit — 2026-09-11

## Scope and method

Read-only review of the vanilla client surface (`public/index.html`,
`public/styles.css`, `public/main.js`, extracted client modules), the locked
Poorup design docs, and the browser QA specs/artifacts. I inspected the live
surface at 1920×1080, 1366×1024 and 1024×768 landscape tablet sizes, 1024×1366
and 768×1024 portrait sizes, and 375×812 mobile. Existing evidence was also
checked in:

- `qa-artifacts/home-reset-1920.png`
- `qa-artifacts/public-lobby-reset-1920.png`
- `qa-artifacts/social-guest-1920.png`
- `qa-artifacts/social-modal-guest-1920.png`
- `qa-artifacts/theme-comparison-1920.png`
- `qa-artifacts/themes/theme-selector-profile-1920.png`
- `docs/audit/ux-1920-reset-slice-2026-09-11.md`
- `docs/plans/IPAD-LANDSCAPE-UI-UX-AUDIT.md`
- `.ulpi/design/DESIGN.md` and `.ulpi/design/HOME-PROFILE-REDESIGN.md`

The review used the Frontend Design Review pillars (Frictionless, Quality
Craft, Trustworthy), Impeccable technical-audit criteria, pixel-art validation
rules, and the current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

> **Current status (2026-09-12).** The old `FOCUS` control is intentionally
> retired; `PANELS` is the current explicit visibility menu. The three-tab
> rail and Cash HUD/Wallet shell are live. Use
> `docs/plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md` and
> `docs/audit/fix-transaction-ui-batch-2026-09-12.md` for current interaction
> status; this visual audit's findings remain its dated viewport record.

## Audit health score

| Dimension | Score | Key finding |
| --- | ---: | --- |
| Accessibility | 2/4 | Desktop modal Close is 17.2px high; no skip link; destination headings and portrait form sizing need work. |
| Performance | 3/4 | Local assets and transform/opacity motion are disciplined; long-running decorative loops have no user pause and retain `will-change`. |
| Theming | 3/4 | Seasonal token system is coherent, but three static CSS aliases are undefined and browser `theme-color` is absent. |
| Responsive design | 2/4 | Landscape iPad shell fits; mobile Rules hero collapses to a 30.7px copy column and mobile Home readouts overlap the title. |
| Implementation integrity | 3/4 | The parlor system is product-specific and token-led, but hidden duplicate status markup and undefined aliases create drift risk. |
| **Total** | **13/20** | **Acceptable — significant focused work needed; desktop/iPad landscape is otherwise visually strong.** |

UI craft score: **3.6/5**. The terminal-parlor identity is distinctive and
consistent, but the responsive failures and small utility targets keep it below
the locked WCAG/craft bar.

### Three-pillar read

| Pillar | Status | Notes |
| --- | --- | --- |
| Frictionless insight → action | 🟠 | Home Create/Join hierarchy is clear at 1920 and iPad landscape; portrait/mobile title collisions and the Rules collapse reduce first-pass comprehension. |
| Quality craft | 🟠 | Strong pixel language, borders, type, and theme worlds; small Close targets, undefined visual aliases, and inconsistent mobile sizing are visible debt. |
| Trustworthy building | 🟢 | Guest social content is inert behind a clear account gate; server-backed empty states and live announcements are present; no fake rooms/stats were observed. |

## Implementation integrity verdict

**PASS with conditions.** The implementation expresses a coherent,
product-specific After-hours Game Parlor system: local pixel fonts and SVGs,
square geometry, restrained shadows, semantic native controls, and clear
server-backed empty states. The pass is conditional because the detector could
not parse the files, and the CSS still suppresses duplicate status markup while
referencing undefined `--ink-*`/`--font-mono` aliases. Those are maintainability
and visual-consistency risks, not evidence of a generic or fabricated product.

## Executive summary

- Audit Health Score: **13/20** (Acceptable).
- Findings: **0 P0, 2 P1, 8 P2, 2 P3/watch items**.
- Highest-impact fixes: repair the mobile Rules hero, make every modal Close
  target at least 40px high, and reserve a non-overlapping mobile Home header
  row for patrol readouts.
- The 1920 Home, public lobby, Social gate, Rankings, Rules, Profile, and
  seasonal comparison artifacts retain a memorable, non-SaaS visual voice.

## Detailed findings by severity

### P1 — major / fix before release

#### [P1] Desktop modal Close controls fail the minimum target floor

- **Location:** `public/index.html:217`, `public/styles.css:472-485`,
  `public/styles.css:1895-1899`; the shared `rooms-close` button has no
  min-height.
- **Category:** Accessibility / Quality Craft.
- **Evidence:** At 1920×1080, the live `#rooms-close` measured **47.3×17.2px**
  in the rendered room-create modal. The same text-height fallback is used by
  other generic `.btn-dark` modal/drawer close controls outside the landscape
  tablet override.
- **Impact:** The target is below the 24×24px WCAG 2.2 AA target-size floor and
  is unnecessarily difficult to hit with a mouse or touch. This is especially
  poor on the modal edge where the user expects a reliable escape hatch.
- **WCAG/standard:** WCAG 2.5.8 Target Size (Minimum); Poorup design contract
  requires 44px preferred frequent controls and 40px close/confirm controls.
- **Recommendation:** Give the shared popup/drawer Close pattern a token-led
  `min-height: 40px` (44px where space allows), preserve the existing padding,
  focus ring, and square geometry, and verify all modal/drawer close buttons at
  desktop and tablet sizes.
- **Suggested command:** `$impeccable harden` then `$impeccable polish`.

#### [P1] Mobile Rules hero squeezes the copy column to 30.7px

- **Location:** `public/styles.css:1906-1914`, `public/styles.css:1977-1980`;
  markup is rendered by `public/clientSocialSurfaces.js:932` and mounted into
  `public/index.html:501`.
- **Category:** Responsive design / Accessibility / Quality Craft.
- **Evidence:** At 375×812, `.rules-intro` measured **355×477.9px**;
  `.rules-intro-copy` measured **30.7px wide**. The live capture shows the
  heading and description wrapping almost one character per line while the
  reference-build meta competes for the same flex row.
- **Impact:** Rules are not readable or scannable on a phone, and the intro
  consumes almost half the first scroll, delaying the contents/search controls.
  This undermines the product promise that the field manual is a readable
  guide, even though the internal book remains technically scrollable.
- **WCAG/standard:** Responsive reflow / text-spacing expectations under WCAG
  1.4.10; Web Interface Guidelines content handling and flex `min-width: 0`
  rules.
- **Recommendation:** At the phone breakpoint, make the intro a deliberate
  one-column or two-row grid: icon plus copy with a minimum readable copy
  width, then put reference metadata on a full-width row. Keep existing
  `--surface-panel`, `--line-board`, and type tokens.
- **Suggested command:** `$impeccable adapt` then `$impeccable layout`.

### P2 — significant next pass

#### [P2] Patrol time, score, and hint overlap the mobile Home wordmark

- **Location:** `public/styles.css:664-678` (absolute 5% readouts) and
  `public/styles.css:846-853` (flowing title grid); markup at
  `public/index.html:100-105` and `public/index.html:131-145`.
- **Category:** Responsive design / Quality Craft.
- **Evidence:** At 375×812, the local time and score both occupied y=177.4–199.4
  while the H1 occupied y=184.2–236.2; the hint occupied y=229.4–242.4. The
  live capture visibly layers `23:xx`, `000`, and `SHIFT+P · NIGHT SHIFT` over
  the `POORUP` wordmark. The same crowding is visible in the 1024×1366
  portrait capture, while the 1920 layout is clean.
- **Impact:** The first-view brand/title hierarchy is ambiguous on portrait
  devices and the optional patrol HUD competes with the primary room-entry
  message.
- **Recommendation:** Reserve a responsive top readout band in the Home layout
  before the title grid, or switch the readouts to grid-flow at <=640px;
  preserve the desktop absolute composition and current numeric type token.
- **Suggested command:** `$impeccable adapt`.

#### [P2] Portrait/mobile form controls stay at 13px

- **Location:** `public/styles.css:520-530` defines `.field` at 13px;
  `public/styles.css:3864` raises `.field` to 16px only inside the landscape
  iPad media block. Inputs are in `public/index.html:190`, `:244`, `:274`,
  `:294`, `:298`, and `:617`.
- **Category:** Accessibility / Responsive design.
- **Evidence:** At 375×812, `#home-alias` computed to **13px**. The 16px
  safeguard is scoped to landscape tablets, so portrait iPad/phone inputs can
  trigger browser auto-zoom and lose the intended parlor framing.
- **Impact:** Focusing a nickname, code, or chat field can jump the viewport and
  make the small-screen flow feel broken; text is also below the comfortable
  touch-reading floor.
- **Recommendation:** Apply a 16px minimum to touch text inputs/selects at
  portrait/mobile breakpoints as well, while keeping the existing 44px field
  height and aliases/placeholders.
- **Suggested command:** `$impeccable adapt`.

#### [P2] Frequent iPad controls are below the 44px preferred target

- **Location:** `public/styles.css:3641-3643`, `:3680-3682`, `:3854`, and
  `public/styles.css:879` (`.chair-edit`).
- **Category:** Responsive design / Accessibility.
- **Evidence:** At 1024×768, Home nav tabs/audio controls were 40px high,
  Quick Table/Resume were 42px, and Edit Identity was **32px** high. The
  landscape touch contract itself sets the nav tab to 40px and does not lift
  the chair edit control.
- **Impact:** These controls are operable but less forgiving for finger input,
  especially the identity action embedded in a dense card.
- **Recommendation:** Raise frequent tablet actions and the chair edit control
  to 44px (or enlarge the containing hit area without changing the visible
  label), preserving the current compact visual rhythm via internal padding.
- **Suggested command:** `$impeccable adapt`.

#### [P2] Rankings and Social page heroes start at `<h2>`

- **Location:** Empty page mains at `public/index.html:477-484` and
  `public/index.html:487-494`; dynamic hero headings at
  `public/clientSocialSurfaces.js:369` (Social) and `:648` (Rankings) use
  `<h2>`.
- **Category:** Accessibility / Navigation.
- **Evidence:** The live Social and Rankings accessibility snapshots expose a
  level-2 page heading, while their visible page containers have no level-1
  heading. Rules and Profile do provide an H1.
- **Impact:** Heading-rotor users land in the middle of the document hierarchy
  and cannot identify the current destination as a page-level section as
  quickly as they can on Rules/Profile.
- **Recommendation:** Use an H1 for each visible page hero (retain H2 for
  modal variants), or add an explicit hidden page H1 and keep the hero label
  relationship consistent across destinations.
- **Suggested command:** `$impeccable harden`.

#### [P2] Static CSS aliases `--ink-1`, `--ink-3`, and `--font-mono` are undefined

- **Location:** `public/styles.css:2107`, `public/styles.css:3055-3086`,
  `public/styles.css:3098`, and `public/styles.css:3111`.
- **Category:** Theming / Implementation Integrity.
- **Evidence:** A source-level custom-property scan found no definitions for
  `--ink-1`, `--ink-3`, or `--font-mono`; only dynamic properties such as
  `--event-accent` and `--bar-height` are intentionally supplied at runtime.
  The live computed root values for the three static aliases were empty.
- **Impact:** Ranking scope text falls back to inherited color instead of the
  intended muted token; casino odds/reel text and the economy result fall back
  to inherited font/color declarations. This weakens hierarchy and makes those
  surfaces diverge from the rest of the terminal system, especially after a
  theme change.
- **Recommendation:** Replace the aliases with the existing
  `--text-primary`/`--text-muted`/`--font-body` tokens or add documented aliases
  in the root token layer. Do not introduce a second palette.
- **Suggested command:** `$impeccable typeset`.

#### [P2] Browser chrome has no theme-color contract

- **Location:** `public/index.html:4-9` contains charset/viewport/favicon/CSS but
  no `meta[name="theme-color"]`; theme application is in
  `public/clientTheme.js:108-116` and `public/clientThemeRender.js:105-116`.
- **Category:** Theming / Responsive design.
- **Impact:** Mobile/iPad browser chrome can remain a platform default instead
  of matching the dark canvas, and a seasonal theme can change the page scene
  without changing the browser UI color.
- **Recommendation:** Add a `theme-color` meta using the current canvas token
  and update it when the sanitized theme changes. Keep `color-scheme: dark`
  because the product's “Light” world still uses dark instruments.
- **Suggested command:** `$impeccable colorize`.

#### [P2] Decorative motion has no user pause affordance

- **Location:** `public/styles.css:263-284` (theme weather/cloud loops),
  `public/styles.css:658-662` (28s skyline drift), and
  `public/clientTheme.js:183-187` (pauses only on document visibility).
- **Category:** Motion / Performance / Accessibility.
- **Evidence:** The seasonal scene and skyline loops run indefinitely under
  normal motion preferences; no visible pause/stop control is present. Reduced
  motion disables the animations, and hidden documents pause them, which is a
  good safety baseline but not a user-controlled pause.
- **Impact:** Users who need motion control but do not use a system-wide reduced
  motion setting cannot stop background movement while reading/entering a room;
  the permanent `will-change` hints also keep decorative layers promoted.
- **Web standard:** Web Interface Guidelines animation rule: autoplay motion
  longer than five seconds alongside other content needs a pause, stop, or hide
  control.
- **Recommendation:** Add a small “PAUSE AMBIENCE” preference beside the
  existing sound/music controls, or make the theme preference include a motion
  mode. Keep the existing reduced-motion and hidden-view behavior authoritative.
- **Suggested command:** `$impeccable animate`.

#### [P2] Duplicate status markup is hidden globally instead of removed or unified

- **Location:** `public/styles.css:838-844` hides header/game online notes,
  `.chair-flag`, `.pr-right`, and `.room-state-tag`; source remains in
  `public/index.html:54-58`, `public/index.html:179-182`, and
  `public/main.js:466-469`.
- **Category:** Implementation Integrity / Responsive design.
- **Impact:** There are multiple status authorities in the DOM even though the
  design comment says to keep one deliberate Home status strip. A later
  breakpoint or component edit can accidentally resurrect duplicate presence
  or seat-state labels, creating inconsistent signals for sighted and
  assistive-technology users.
- **Recommendation:** Remove dead status nodes/list markup or explicitly mark
  the retained source of truth and keep only one semantic status per surface;
  preserve the existing Home signal strip and game rail vocabulary.
- **Suggested command:** `$impeccable distill`.

### P3 — polish / watch items

#### [P3] Mobile nav hides its overflow cue

- **Location:** `public/styles.css:2701-2708` sets the compact nav to horizontal
  scrolling and hides the scrollbar.
- **Evidence:** At 375×812, `RULES` is clipped at the right edge of the second
  header row while the scrollbar is suppressed. The tabs remain reachable by
  horizontal swipe, but there is no visual edge cue.
- **Recommendation:** Keep the scrollable row, but add a tokenized fade/edge
  marker or expose a subtle scrollbar on coarse pointers. Do not add another
  navigation row.

#### [P3] Scenic copy contrast varies over animated image texture

- **Location:** `public/styles.css:302-313` changes Home copy/hint colors for
  bright worlds; `.ts-copy` itself is transparent at `:853`.
- **Evidence:** The 1920 seasonal captures show copy over sky/tree transitions
  rather than a stable surface. The chosen dark seasonal text is legible in the
  sampled frames, but its contrast changes as the image layers move and the
  scanline overlay applies.
- **Recommendation:** If measured contrast on a future frame dips below AA,
  add a very subtle existing deep-surface backing or tokenized text shadow to
  the copy block; avoid flattening the authored scenery.

## Patterns and systemic issues

- **Small utility targets:** Generic `.btn-dark` has no baseline min-height,
  so text-only Close/secondary controls collapse to line height. The tablet
  override fixes some controls but not desktop or every embedded action.
- **Responsive flex squeeze:** Mobile rules rely on `flex-wrap` plus a fixed
  non-shrinking meta block; without an explicit mobile row model, copy can
  collapse instead of reflowing to a readable measure.
- **Token drift:** Most of the palette is well tokenized, but undefined legacy
  aliases and several inline player/swatches colors mean detector-free visual
  regressions can survive theme changes.
- **Status duplication:** Header presence, chair availability, player status,
  and room-state markup are still present after the visual source of truth was
  consolidated by CSS suppression.

## Positive findings to preserve

- Poorup has a clear signature: pixel display type, warm structural gold,
  dark teal terminal surfaces, red/seasonal action hierarchy, crisp SVGs, and
  square 2–3px geometry. The 1920 theme comparison reads as authored worlds,
  not generic SaaS cards.
- Home entry is easy to parse at 1920: Create and Join are the dominant pair,
  Quick Table is visibly tertiary, and the open-chair identity flow is
  contained in the right desk.
- The 1920 public lobby keeps one acknowledged human seat and an explicit HOST
  badge; no fake pre-start bot rows were observed. The old `FOCUS` control is
  intentionally absent and replaced by `PANELS`.
- Social guest content is both `aria-hidden` and `inert` behind a clear account
  gate (`qa-artifacts/social-guest-1920.png`), so blur is not being used as a
  privacy boundary.
- Decorative images carry explicit dimensions and decorative `alt=""`/hidden
  treatment. Local font/SVG assets avoid remote layout shifts and preserve the
  pixel-art contract.
- Motion is mostly transform/opacity based, and reduced-motion rules cover the
  theme, skyline, patrol, profile, rules, toast, and game animation families.
- Landscape iPad Home/Rules/Social surfaces measured to the viewport with no
  page-level overflow in the live 1024×768 check; the existing iPad game
  contract and internal rail scroll strategy are good foundations.

## Subjective enhancements (separate from defects)

These are taste-level improvements, not release blockers:

- On bright worlds, keep the authored scene but give the left copy block one
  restrained “instrument glass” backing using the existing deep-surface token;
  this would make the text feel like part of the parlor console and stabilize
  contrast without adding a generic card.
- The 1366/1024 scenic images are scaled at non-integer factors from the
  640×360 masters. Consider a fixed pixel-grid crop or integer-friendly
  `background-size` treatment at tablet widths if the desired 3× crispness is
  more important than full-bleed coverage.
- Body copy currently uses `--font-body: "Pixelify Sans"` at
  `public/styles.css:125-129` even though the design notes reserve IBM Plex
  Mono for body/data. A small, evidence-driven trial of IBM Plex Mono for
  paragraphs and numeric tables could improve long-form scanning while leaving
  Pixelify headings and controls untouched.

## Test gaps and verification notes

- `docs/audit/ux-1920-reset-slice-2026-09-11.md` records a broad browser matrix
  (63 passed, 27 intentional skips), and `qa/poorup.spec.js` / `qa/theme.spec.js`
  cover the 1920 geometry, social gate, themes, reduced motion, and iPad
  landscape contracts. Those are strong behavioral gates.
- No current browser assertion catches the 375px Rules copy width, mobile Home
  patrol/title overlap, desktop modal Close height, portrait input font size,
  visible-page H1 presence, skip-link absence, or undefined CSS aliases.
- The planned real Safari/VoiceOver verification remains outstanding in the
  iPad plan; Chromium emulation is not enough to prove Safari auto-zoom,
  rotor ordering, or touch hit feel.
- The Impeccable detector was run once over the UI targets, but it returned
  `DEGRADED` because `htmlparser2`, `css-select`, `css-tree`, and `domutils`
  were unavailable; it fell back to regex and returned `[]`. Treat that as an
  undercount, not a clean detector pass.
- Re-run the browser matrix after fixes with explicit visual captures at
  375×812 Rules/Home, 1024×768 iPad landscape, and 1920×1080 modal states;
  add computed assertions for target sizes and page heading hierarchy.

## Recommended action order

1. **[P1] `$impeccable adapt`** — repair Rules/Home portrait and phone flow,
   including the 30.7px Rules copy column and patrol readout band.
2. **[P1] `$impeccable harden`** — raise shared Close targets, add skip/page
   heading semantics, and verify focus/keyboard paths.
3. **[P2] `$impeccable typeset`** — resolve undefined aliases and re-check text
   hierarchy/field sizing against Poorup tokens.
4. **[P2] `$impeccable animate`** — add an opt-in ambient-motion pause while
   preserving reduced-motion behavior.
5. **[P2] `$impeccable distill`** — remove or unify hidden duplicate status
   markup after the semantic source of truth is confirmed.
6. **[P3] `$impeccable polish`** — add overflow cues and make any measured
   seasonal-copy contrast refinements.

You can ask me to run these one at a time, all at once, or in any order you
prefer. Re-run `$impeccable audit` after fixes to see the score improve.
