# Poorup Music Box Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the reference-locked compact Poorup music box with icon-only controls, vertical volume popover, automatic theme tracks, and full accessible playback behavior.

**Architecture:** Extend the existing global audio state with one client-only A/B media controller and one dock mounted outside SPA views. Keep the current topbar music toggle as the canonical on/off state; theme changes call a reset hook after visual application. Use local approved audio and local SVG icons only.

**Tech Stack:** Vanilla ES modules, HTMLMediaElement A/B playback, existing Poorup CSS tokens, local SVG, Node assertions, Playwright visual QA.

**Spec:** `docs/superpowers/specs/2026-09-14-music-box-reference-design.md`

## Global Constraints

- Treat the supplied 1672×941 screenshot as the visual reference and confirm the implementation at native 1920×1080.
- Preserve the existing Home/game layout, typography, board, HUD, rails, navigation, gameplay, Socket.IO contracts, and economy.
- The next theme change always resets manual track/loop/shuffle state to the new theme default with loop enabled.
- Use local approved assets only; do not import a new icon library or external audio URL.
- One global player, one music state, no player on static legal pages.
- Use transform/opacity for visual motion only; no `transition: all`, `scale(0)`, permanent idle `will-change`, or keyboard-triggered animation.

---

### Task 1: Capture and lock the reference contract

**Files:**
- Create: `public/clientMusicBoxReference.test.js`
- Create: `qa/music-box-reference.spec.js`
- Create: `qa-artifacts/music-box-reference-1672.png` (visual reference copy, ignored)

- [ ] **Step 1: Write failing geometry contracts**

Define the target reference bounds and assert that the current page has no player yet. Record the reference image dimensions and the 1920×1080 acceptance viewport.

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `node public/clientMusicBoxReference.test.js`

Expected: FAIL because the compact music box DOM contract does not exist.

- [ ] **Step 3: Preserve the supplied reference non-destructively**

Copy the supplied generated PNG into `qa-artifacts/music-box-reference-1672.png` for local review only. Do not overwrite production art or treat the generated screenshot as runtime UI.

- [ ] **Step 4: Commit the reference test scaffold**

```text
git add public/clientMusicBoxReference.test.js qa/music-box-reference.spec.js
git commit -m "test: lock music box reference geometry"
```

### Task 2: Create the pixel icon set and audit it

**Files:**
- Create: `public/assets/music/music-note.svg`
- Create: `public/assets/music/music-prev.svg`
- Create: `public/assets/music/music-play.svg`
- Create: `public/assets/music/music-pause.svg`
- Create: `public/assets/music/music-next.svg`
- Create: `public/assets/music/music-shuffle.svg`
- Create: `public/assets/music/music-repeat.svg`
- Create: `public/assets/music/music-speaker.svg`
- Create: `public/assets/music/music-grip.svg`
- Create: `public/themeMusicIconAudit.test.js`

Use SVG-design and pixel-art-sprites guidance: integer-aligned geometry, crispEdges, limited palette, no filters/gradients/text/external URLs, and 1x readability.

- [ ] **Step 1: Write the failing asset audit**

Assert all nine files, viewBoxes, crispEdges, no decimal coordinates, no text nodes, and distinct shuffle/repeat path signatures.

- [ ] **Step 2: Run the audit and confirm failure**

Run: `node public/themeMusicIconAudit.test.js`

Expected: FAIL because the reference-specific icon files do not exist.

- [ ] **Step 3: Author the icons**

Draw only the local music-box glyphs; do not draw UI borders or labels into the SVGs. Keep play/pause/previous/next at the same optical weight and create two clearly different crossed/looped arrow marks.

- [ ] **Step 4: Run the audit and inspect at 1x**

Run: `node public/themeMusicIconAudit.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add public/assets/music public/themeMusicIconAudit.test.js
git commit -m "feat: add crisp music box icon set"
```

### Task 3: Implement the manifest and A/B audio controller

**Files:**
- Create/extend: `public/clientMusicData.js`
- Create/extend: `public/clientMusicPlayer.js`
- Modify: `public/clientMusicPlayer.test.js`

**Interfaces:**

```js
createMusicPlayer({ audioA, audioB, manifest, getThemeId, storage, announce, now, requestFrame, cancelFrame, reducedMotion })
setTheme(themeId, { userInitiated = false })
selectTrack(trackId)
toggleShuffle(); toggleLoop(); next(); previous(); seek(fraction); setVolume(value)
resetToThemeTrack(); snapshot()
```

- [ ] **Step 1: Extend failing unit tests**

Cover theme reset, manual `CUSTOM` state, loop re-enable, A/B crossfade cancellation, autoplay rejection, error retention, queue/previous/shuffle semantics, volume clamps, and sanitized preference persistence.

- [ ] **Step 2: Run the focused test and watch it fail**

Run: `node public/clientMusicPlayer.test.js`

Expected: FAIL on missing controller behavior.

- [ ] **Step 3: Implement the controller**

Use two media elements, local manifest allow-lists, transition ids, injected time/frame functions, and the existing 0.16 default volume. Never accept arbitrary URL or unapproved track ids.

- [ ] **Step 4: Run tests and refactor while green**

Run: `node public/clientMusicPlayer.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add public/clientMusicData.js public/clientMusicPlayer.js public/clientMusicPlayer.test.js
git commit -m "feat: add theme-aware music playback controller"
```

### Task 4: Build the reference-locked compact dock

**Files:**
- Modify: `public/index.html`
- Create: `public/clientMusicBoxUi.js`
- Create: `public/clientMusicBoxUi.test.js`
- Modify: `public/styles.css`

**Screen elements to implement:**

- music-note icon and track title;
- `AUTO THEME`/`CUSTOM` micro-state;
- progress times and block meter;
- previous, play/pause, next, shuffle, repeat, speaker icon buttons;
- volume popover trigger and vertical slider;
- hidden `MOVE PLAYER`/position menu for full functionality;
- polite status region and tooltip labels.

- [ ] **Step 1: Write failing DOM and geometry tests**

Assert one dock outside `.view`, compact target width, balanced right padding, icon-only controls, vertical popover relation, accessible names, and no duplicate topbar player.

- [ ] **Step 2: Run the tests and confirm failure**

Run: `node public/clientMusicBoxUi.test.js`

Expected: FAIL because no dock exists.

- [ ] **Step 3: Add semantic markup**

Mount one dock and two hidden audio elements near the app root. Use native buttons/ranges, `aria-controls`, `aria-expanded`, `aria-pressed`, and a `role=status` live region.

- [ ] **Step 4: Style to the supplied reference**

Use the existing Poorup panel/noise/token rules. Set compact width, exact 8px internal spacing, icon hit areas, a right-edge-tight layout, and the vertical popover opening above the speaker button.

- [ ] **Step 5: Implement open/close and control wiring**

Open the player by click/keyboard, close with Escape, restore focus, and delegate actions to the controller. Do not add hover-only functionality.

- [ ] **Step 6: Run focused UI tests**

Run: `node public/clientMusicBoxUi.test.js && npm run lint:client -- --quiet`

Expected: PASS.

- [ ] **Step 7: Commit**

```text
git add public/index.html public/clientMusicBoxUi.js public/clientMusicBoxUi.test.js public/styles.css
git commit -m "feat: add compact reference music box"
```

### Task 5: Add volume popover, corner snapping, and theme colors

**Files:**
- Modify: `public/clientMusicBoxUi.js`
- Modify: `public/clientMusicBoxUi.test.js`
- Modify: `public/clientThemeData.js`
- Modify: `public/clientThemeRender.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Write failing interaction tests**

Cover vertical range keyboard behavior, Escape/outside dismissal, four snap positions, pointer drag snapping, keyboard move menu, modal z-index, safe-area clamps, and six theme token sets.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node public/clientMusicBoxUi.test.js && node public/clientTheme.test.js`

Expected: FAIL on missing placement and theme-token behavior.

- [ ] **Step 3: Implement volume and placement**

Keep the volume trigger compact, open the vertical slider with an 8px gap, clamp to safe areas, store only an enum position, and provide an equivalent keyboard menu.

- [ ] **Step 4: Add theme-adaptive semantic tokens**

Expose `--music-surface`, `--music-border`, `--music-accent`, `--music-text`, `--music-muted`, and `--music-meter` through the existing theme registry. Do not recolor semantic game states.

- [ ] **Step 5: Run tests and lint**

Run: `node public/clientMusicBoxUi.test.js && node public/clientTheme.test.js && npm run lint:client -- --quiet`

Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add public/clientMusicBoxUi.js public/clientMusicBoxUi.test.js public/clientThemeData.js public/clientThemeRender.js public/styles.css
git commit -m "feat: add safe volume popover and theme colors"
```

### Task 6: Integrate existing music toggles and theme reset

**Files:**
- Modify: `public/clientAudioControls.js`
- Modify: `public/clientTheme.js`
- Modify: `public/main.js`
- Modify: `public/clientState.js`
- Modify: `public/clientAudioControls.test.js`

- [ ] **Step 1: Write failing integration tests**

Assert all existing music buttons proxy to one controller, `state.music` remains authoritative, theme changes clear `CUSTOM`, loop becomes true, and blocked playback announces one status.

- [ ] **Step 2: Run and confirm failure**

Run: `node public/clientAudioControls.test.js`

Expected: FAIL because the dock controller is not injected.

- [ ] **Step 3: Inject the controller**

Replace the single-track hook behind `syncHomeMusic` with the music-box adapter while preserving ids, aria labels, profile summary updates, gesture unlock, and cross-tab preference behavior.

- [ ] **Step 4: Wire theme changes**

Extend `configureThemeUi` with an `onThemeChange` callback. Apply the visual theme first, then call `setTheme` so invalid ids cannot select audio.

- [ ] **Step 5: Run integration tests**

Run: `node public/clientAudioControls.test.js && node public/clientTheme.test.js && node public/clientCrossTabSignout.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add public/clientAudioControls.js public/clientTheme.js public/main.js public/clientState.js public/clientAudioControls.test.js
git commit -m "feat: sync music box with theme and global audio state"
```

### Task 7: Update licenses/storage and run reference visual QA

**Files:**
- Modify: `public/legal/licenses.html`
- Modify: `public/legal/storage.html`
- Modify: `public/legal/privacy.html`
- Modify: `public/assets/audio/README.md`
- Create: `qa/music-box-reference.spec.js` (extend from Task 1)

- [ ] **Step 1: Add failing provenance and browser assertions**

Assert each shipped track has attribution, local preference storage is documented, the compact dock is present on every SPA surface, and static legal pages remain player-free.

- [ ] **Step 2: Run focused checks and confirm failure**

Run: `node server/legalContent.test.js && npx playwright test -c qa/playwright.config.js qa/music-box-reference.spec.js --project=desktop-1920`

Expected: FAIL until the manifest, dock, and legal references are wired.

- [ ] **Step 3: Add the factual notices**

Document only actual audio files, credits, local preference keys, autoplay behavior, and the distinction between theme defaults and custom choices.

- [ ] **Step 4: Add native 1920 reference captures**

Capture collapsed dock, volume-open dock, custom state, each corner position, each theme token set, and one modal-over-dock state. Compare against the supplied reference at 1920×1080 and inspect every image at 1x.

- [ ] **Step 5: Run browser checks**

Run: `npx playwright test -c qa/playwright.config.js qa/music-box-reference.spec.js --project=desktop-1920 --project=ipad-mini-landscape --project=mobile-390`

Expected: PASS with no overflow, occlusion, focus loss, or duplicate audio node.

- [ ] **Step 6: Commit**

```text
git add public/legal public/assets/audio/README.md qa/music-box-reference.spec.js
git commit -m "docs: document music box controls and track credits"
```

### Task 8: Full verification and visual confirmation

- [ ] **Step 1: Run unit/server/client checks**

Run: `npm test && npm run test:audit && npm run lint && npm run lint:client`

- [ ] **Step 2: Run the complete Playwright matrix**

Run: `npx playwright test -c qa/playwright.config.js`

- [ ] **Step 3: Verify motion and accessibility**

Check keyboard sliders, Escape/outside dismissal, screen-reader labels, reduced motion, forced colors, iPad 44px targets, autoplay rejection, crossfade cancellation, and no keyboard-triggered visual animation.

- [ ] **Step 4: Compare the reference at 1920px**

Confirm exact dock silhouette, right-edge spacing, speaker/vertical-popover relationship, icon optical weight, theme colors, and unchanged Home composition. Do not mark complete until the 1920×1080 screenshots have been inspected.

- [ ] **Step 5: Run Impeccable and motion review**

Run the UI detector once and record any parser limitation honestly. Review for permanent compositor hints, slop-like controls, unintended pulses, and layout-property animation.

- [ ] **Step 6: Run CodeScene only with an available token**

Never print or persist `CS_ACCESS_TOKEN`; record the check as blocked when absent.

- [ ] **Step 7: Final status and commit check**

Run `git diff --check` and `git status --short`. Keep generated screenshots/audio candidates and the internal SDD helper out of commits.
