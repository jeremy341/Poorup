# Poorup Theme Music Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one persistent, theme-colored music dock with automatic theme defaults, clean crossfades, manual queue controls, and safe four-corner placement.

**Architecture:** A frozen local track manifest feeds one client-only music controller. The controller owns two hidden HTML audio elements, a bounded queue, crossfade state, sanitized local preferences, and a single dock mounted outside the SPA views. Existing topbar music toggles proxy to this controller, while `clientTheme.js` resets the track and loop on every theme change.

**Tech Stack:** Vanilla ES modules, HTMLMediaElement A/B playback, existing Poorup CSS tokens, local audio assets, Node assertion tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-theme-music-player-design.md`

## Global Constraints

- Preserve the existing Poorup layout, typography, board, HUD, rails, navigation, game logic, Socket.IO contracts, and economy.
- Keep `Pondering the Cosmos` as the unchanged Original default.
- Theme changes always reset manual choices and set loop on.
- Only approved local audio files may load; never accept arbitrary URLs.
- Keep the existing global music toggle as the canonical enabled state.
- No duplicate player per SPA surface and no music player on standalone legal pages.
- Use transform/opacity for UI motion only; no `transition: all`, `scale(0)`, or keyboard-triggered motion.
- Verify 1920×1080, 1366×768, 1024×768, iPad landscape, 390×844, reduced motion, forced colors, 200% zoom, and autoplay rejection.

---

### Task 1: Ship the approved track manifest and provenance contract

**Files:**
- Create: `public/clientMusicData.js`
- Create: `public/clientMusicData.test.js`
- Create: `public/themeMusicAssetAudit.test.js`
- Modify: `public/assets/audio/README.md`
- Modify: `docs/design/THEME-MUSIC-CURATION-2026-09-12.md`

**Interfaces:**

```js
export const MUSIC_STORAGE_KEY = "poorup.music.player.v1";
export const THEME_DEFAULT_TRACKS = Object.freeze({ original: "pondering-the-cosmos", spring: "hot-springs-town", summer: "summers", autumn: "autumn", winter: "snowy-village", light: "town" });
export function getThemeTracks(themeId): readonly Track[];
export function getTrack(trackId): Track | null;
export function sanitizeMusicPreference(raw): MusicPreference;
```

Each `Track` includes `id`, `themeId`, `title`, `artist`, `src`, `status`, `loopable`, `license`, `source`, and `creditRequired`. The allow-list rejects unknown ids, URLs, decimal volumes, and unapproved statuses.

- [ ] **Step 1: Write the failing manifest tests**

Cover six theme pools, unchanged Original default, rejected archive candidates, CC-BY credit flags, local-only sources, and sanitized preference defaults.

- [ ] **Step 2: Run the tests and confirm the expected failure**

Run: `node public/clientMusicData.test.js && node public/themeMusicAssetAudit.test.js`

Expected: FAIL because the manifest and approved seasonal files do not exist in the production asset tree.

- [ ] **Step 3: Copy only approved local candidates**

Copy the selected files into `public/assets/audio/themes/<theme>/` without modifying source files. Preserve the original candidate pack and record SHA-256, duration, source, license, and attribution in the audio README. Keep `Good Morning`, `Remember Winter`, and `Urban Theme` out of the runtime until their curation decisions are explicit.

- [ ] **Step 4: Implement the frozen manifest and sanitizers**

Use the recommended defaults from the spec, expose secondary queues, and return `Pondering the Cosmos` only when a requested theme or track is unavailable.

- [ ] **Step 5: Run the manifest and asset tests**

Run: `node public/clientMusicData.test.js && node public/themeMusicAssetAudit.test.js`

Expected: PASS with every source path local and every shipped track documented.

- [ ] **Step 6: Commit**

```text
git add public/clientMusicData.js public/clientMusicData.test.js public/themeMusicAssetAudit.test.js public/assets/audio docs/design/THEME-MUSIC-CURATION-2026-09-12.md
git commit -m "feat: define local theme music manifest"
```

### Task 2: Build the audio A/B controller and crossfade state machine

**Files:**
- Create: `public/clientMusicPlayer.js`
- Create: `public/clientMusicPlayer.test.js`

**Interfaces:**

```js
export function createMusicPlayer({
  audioA,
  audioB,
  manifest,
  getThemeId,
  storage,
  announce,
  now,
  requestFrame,
  cancelFrame,
  reducedMotion,
} = {}): MusicPlayer;

MusicPlayer = {
  mount(), destroy(),
  setTheme(themeId, { userInitiated = false } = {}),
  toggleEnabled(), play(), pause(),
  selectTrack(trackId), next(), previous(),
  toggleShuffle(), toggleLoop(),
  seek(fraction), setVolume(value),
  setPosition(position), resetToThemeTrack(),
  snapshot()
};
```

State includes `enabled`, `themeId`, `trackId`, `queue`, `queueIndex`, `shuffle`, `loop`, `volume`, `position`, `mode`, `status`, `activeChannel`, and `transitionId`.

- [ ] **Step 1: Write failing state-machine tests**

Cover theme reset, manual `CUSTOM` mode, loop re-enable, deterministic shuffle without immediate repeats, previous restart threshold, volume/seek clamps, failed source retention, autoplay rejection, ended behavior, and cancellation of stale crossfades.

- [ ] **Step 2: Run the focused test and verify it fails correctly**

Run: `node public/clientMusicPlayer.test.js`

Expected: FAIL because the controller is not defined.

- [ ] **Step 3: Implement load/play/pause/error handling**

Keep one active media element and one incoming element. Set the incoming source only from the manifest, await `canplay`/`play()`, and fail closed when playback is blocked or a file is missing.

- [ ] **Step 4: Implement the crossfade**

Use a 650ms theme fade and 350ms manual-skip fade. Ramp `volume` with injected animation frames, stop the outgoing element at zero, and ignore callbacks whose `transitionId` is stale.

- [ ] **Step 5: Implement queue, persistence, and theme reset**

Persist only the sanitized preference object. On `setTheme`, rebuild the queue from the new theme, select its main track, set `loop=true`, set `mode="theme"`, and announce the change.

- [ ] **Step 6: Run the unit tests and refactor only while green**

Run: `node public/clientMusicPlayer.test.js`

Expected: PASS with deterministic injected time and no real network/audio dependency.

- [ ] **Step 7: Commit**

```text
git add public/clientMusicPlayer.js public/clientMusicPlayer.test.js
git commit -m "feat: add resilient theme music crossfade controller"
```

### Task 3: Add the compact dock and expanded player surface

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Create: `public/clientMusicPlayerUi.js`
- Create: `public/clientMusicPlayerUi.test.js`

**Screen elements:**

- collapsed `MUSIC` dock with icon, track title, `AUTO THEME`/`CUSTOM`, progress meter, open button, and play/pause;
- expanded header with theme, status, and close;
- progress and volume range inputs;
- previous, play/pause, next, shuffle, loop;
- `RESET TO THEME TRACK`, `MOVE PLAYER`, and verified `TRACK INFO`;
- live status region;
- four-position keyboard menu.

**Interfaces:**

```js
export function mountMusicPlayerUi({ root, player, announce, isModalOpen }): { destroy() };
```

- [ ] **Step 1: Write failing DOM contracts**

Assert one dock, one expanded panel, labelled native controls, 44px targets, no tabindex on decorative artwork, and no duplicate topbar music state.

- [ ] **Step 2: Run the UI test and confirm failure**

Run: `node public/clientMusicPlayerUi.test.js`

Expected: FAIL because the dock markup and renderer do not exist.

- [ ] **Step 3: Add one global dock outside `.view`**

Add two hidden `<audio>` elements and one `aside` dock near the app root. Keep all controls inside the dock and use the existing `music-on.svg`/`music-off.svg` icons.

- [ ] **Step 4: Style the dock with existing Poorup tokens**

Use square borders, scanline/noise treatment, block meters, no gradients, and no generic SaaS card styling. Keep the collapsed dock above the ticker and the expanded panel internally scrollable.

- [ ] **Step 5: Implement open/close, focus, and live updates**

Open by click or Enter/Space, move focus into the panel, close on Escape, and restore focus to the opener. Announce track, theme, blocked, error, and fallback states once.

- [ ] **Step 6: Run focused UI tests**

Run: `node public/clientMusicPlayerUi.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```text
git add public/index.html public/styles.css public/clientMusicPlayerUi.js public/clientMusicPlayerUi.test.js
git commit -m "feat: add Poorup music dock controls"
```

### Task 4: Add safe corner placement and theme-adaptive tokens

**Files:**
- Modify: `public/clientMusicPlayerUi.js`
- Modify: `public/styles.css`
- Modify: `public/clientThemeData.js`
- Modify: `public/clientThemeRender.js`
- Modify: `public/clientMusicPlayerUi.test.js`

- [ ] **Step 1: Write failing placement/theme tests**

Cover four enum positions, malformed storage, keyboard movement, pointer snap, safe-area clamping, modal layering, and contrast token changes for Original, Spring, Summer, Autumn, Winter, and Light.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node public/clientMusicPlayerUi.test.js && node public/clientTheme.test.js`

Expected: FAIL on missing position tokens and theme music properties.

- [ ] **Step 3: Add position state and keyboard alternative**

Persist only `top-left`, `top-right`, `bottom-left`, and `bottom-right`. Pointer dragging snaps to the nearest safe corner; `MOVE PLAYER` exposes the same choices as native buttons or radios.

- [ ] **Step 4: Add semantic music tokens per theme**

Expose `musicSurface`, `musicRaised`, `musicBorder`, `musicAccent`, `musicText`, `musicMuted`, and `musicMeter` through the existing theme data/renderer without changing board or game tokens.

- [ ] **Step 5: Add responsive and accessibility CSS**

Keep the dock above the ticker, clamp around rails/HUD/modals, set 44px controls on iPad, use a full-width lower sheet on 390px when required, and disable visual travel under reduced motion/forced colors.

- [ ] **Step 6: Run tests**

Run: `node public/clientMusicPlayerUi.test.js && node public/clientTheme.test.js && npm run lint:client -- --quiet`

Expected: PASS.

- [ ] **Step 7: Commit**

```text
git add public/clientMusicPlayerUi.js public/styles.css public/clientThemeData.js public/clientThemeRender.js public/clientMusicPlayerUi.test.js
git commit -m "feat: theme and viewport safe music dock"
```

### Task 5: Integrate global audio toggles and theme reset behavior

**Files:**
- Modify: `public/clientAudioControls.js`
- Modify: `public/clientTheme.js`
- Modify: `public/main.js`
- Modify: `public/clientState.js`
- Modify: `public/clientAudioControls.test.js`

- [ ] **Step 1: Add failing integration tests**

Assert that every existing music button proxies to the single controller, `state.music` remains authoritative, a theme switch resets a manual track and loop, and a blocked `play()` leaves the right status.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node public/clientAudioControls.test.js`

Expected: FAIL on missing controller injection and theme-change hook.

- [ ] **Step 3: Inject the controller into audio controls**

Replace the existing `syncHomeMusic` hook with a controller-backed adapter while preserving button ids, aria labels, and profile summary updates.

- [ ] **Step 4: Wire `clientTheme.js` after visual application**

Extend `configureThemeUi` with `onThemeChange`; call it after `applyTheme` so a theme change resets the soundtrack only after the visual theme id is valid.

- [ ] **Step 5: Preserve gesture unlock and cross-tab sync**

Keep the existing pointer/keyboard gesture retry and add storage synchronization for enabled state, volume, shuffle, loop, and position. Ignore stale or malformed cross-tab values.

- [ ] **Step 6: Run integration tests**

Run: `node public/clientAudioControls.test.js && node public/clientTheme.test.js && node public/clientCrossTabSignout.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```text
git add public/clientAudioControls.js public/clientTheme.js public/main.js public/clientState.js public/clientAudioControls.test.js
git commit -m "feat: reset soundtrack with visual theme changes"
```

### Task 6: Update licensing/storage notices and browser contracts

**Files:**
- Modify: `public/legal/licenses.html`
- Modify: `public/legal/storage.html`
- Modify: `public/legal/privacy.html`
- Modify: `server/legalContent.test.js`
- Create: `qa/music-player.spec.js`

- [ ] **Step 1: Add failing browser/legal assertions**

Assert every shipped track has a license entry, player preferences are described as local, no raw URL is accepted, and legal pages remain unchanged in layout.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `node server/legalContent.test.js && npx playwright test -c qa/playwright.config.js qa/music-player.spec.js --project=desktop-1920`

Expected: FAIL because the new tracks and player are not documented or wired.

- [ ] **Step 3: Add provenance and storage copy**

List artist/source/license/credit requirements for every approved track and describe only sanitized local player preferences and existing global music state.

- [ ] **Step 4: Add browser scenarios**

Cover automatic theme reset, custom track status, loop/shuffle/seek/volume, autoplay rejection, four-corner keyboard movement, modal layering, reduced motion, forced colors, no overflow, and cross-view persistence.

- [ ] **Step 5: Run focused browser/legal checks**

Run: `node server/legalContent.test.js && npx playwright test -c qa/playwright.config.js qa/music-player.spec.js --project=desktop-1920 --project=ipad-mini-landscape --project=mobile-390`

Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add public/legal server/legalContent.test.js qa/music-player.spec.js
git commit -m "docs: document theme soundtrack licenses and storage"
```

### Task 7: Full visual, accessibility, performance, and release verification

**Files:**
- Modify: `qa/theme.spec.js` only if the theme reset contract needs a focused assertion.
- Create: `qa-artifacts/music-player-1920/` (ignored evidence)

- [ ] **Step 1: Run all unit/server/client checks**

Run: `npm test && npm run test:audit && npm run lint && npm run lint:client`

- [ ] **Step 2: Run the complete browser matrix**

Run: `npx playwright test -c qa/playwright.config.js`

- [ ] **Step 3: Capture and inspect native screenshots**

Capture Original, Spring, Summer, Autumn, Winter, and Light with the collapsed player; expanded player; custom mode; position menu; and a modal behind it at 1920×1080. Inspect every image at native resolution, then repeat a reduced-motion and iPad-landscape pass.

- [ ] **Step 4: Verify media behavior manually**

Confirm crossfade has no click/pop, theme changes reset track/loop, shuffle has no immediate repeat, loop-off stops after the queue, and a blocked autoplay gesture recovers without duplicate audio.

- [ ] **Step 5: Run Impeccable and motion review**

Run the detector once on changed UI files and record parser limitations honestly. Check that no new pulse, permanent `will-change`, hover travel, or keyboard animation was introduced.

- [ ] **Step 6: Run CodeScene only with an explicitly present token**

Never print, persist, or infer `CS_ACCESS_TOKEN`. If unavailable, record CodeScene as blocked rather than claiming a review.

- [ ] **Step 7: Final working-tree check and commit**

Run: `git diff --check` and `git status --short`. Do not stage internal `.superpowers/sdd/.gitignore` or generated audio candidates.
