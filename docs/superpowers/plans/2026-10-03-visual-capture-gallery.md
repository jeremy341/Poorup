# Poorup visual capture gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task includes its own test/verification cycle.

**Goal:** Build an opt-in Playwright runner that captures the agreed Poorup pages and modal states across supported desktop and landscape-iPad profiles, then emits an HTML gallery and JSON manifest.

**Architecture:** A central viewport registry and capture catalog feed a dedicated Playwright config. Existing screenshot-focused flows call one helper that writes profile/group/surface PNGs and capture records. A CLI runs selected profile/group combinations and produces the final gallery from those records.

**Tech Stack:** Existing Node.js ESM, `@playwright/test`, Playwright Chromium, filesystem APIs, and Node's built-in test runner. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-03-visual-capture-gallery-design.md`

## Global Constraints

- Desktop capture targets begin at 1440×900; exclude 1366×768 and 1280×720 from the supported gallery matrix.
- Capture landscape iPad profiles, including the existing 944×656, 1024×768, 1080×810, and 1194×834 viewports, plus 1180×820 and 1366×1024 profiles.
- Exclude phone and portrait-iPad profiles from default captures.
- Use deterministic synthetic state, no-op game actions, and isolated disposable rooms only where required for boot.
- Keep generated PNGs under ignored `qa-artifacts/visual-captures/`; never add screenshot binaries to Git.
- Preserve all pre-existing working-tree changes and the no-document-scroll invariant.

## Review Focus

- Duplicate device aliases with identical CSS viewport, DPR, touch, and hover behavior should not create duplicate captures; tests compare profile identity keys.
- Custom viewport parsing must reject unsupported defaults and malformed, zero, or portrait values; tests cover invalid input and explicit override behavior.
- A failed surface setup must leave a visible failed capture record and nonzero runner status; gallery tests cover missing PNGs and failed records.
- A partial browser run must still produce a browsable gallery for successful captures; runner integration verifies exit status and artifact generation.
- Fixture setup must not submit gameplay actions or use production credentials; screenshot integration validates the configured no-op emit seam and synthetic account names.

---

### Task 1: Viewport matrix and capture option parsing

**Files:**
- Create: `qa/visual-capture/viewports.mjs`
- Test: `qa/visual-capture/viewports.test.mjs`
- Create: `qa/visual-capture/playwright.config.js`

**Interfaces:**
- Produces `supportedViewports`, `parseCaptureArgs(argv)`, and `selectViewports(options)`.
- Each viewport record has `id`, `group`, `width`, `height`, `deviceScaleFactor`, `isMobile`, `hasTouch`, `orientation`, and optional `aliases`.

- [x] **Step 1: Write failing viewport tests** for all named desktop/iPad profile IDs, excluded resolutions, de-duplicated aliases, custom `--viewport=WxH`, `--group`, `--list`, and malformed inputs.
- [x] **Step 2: Run `node --test qa/visual-capture/viewports.test.mjs`** and confirm the missing-module/behavior failures.
- [x] **Step 3: Implement the registry and parser** with desktop profiles 1440×900, 1536×900, 1600×900, 1920×1080, 2560×1440, and 3840×2160; landscape-iPad profiles 944×656, 1024×768, 1080×810, 1180×820, 1194×834, and 1366×1024. The 3440×1440 ultrawide profile was later retired from support; archived captures are historical only.
- [x] **Step 4: Add the dedicated Playwright config** whose projects come only from the selected capture profiles; use the repository's existing local web server and Chromium setup.
- [x] **Step 5: Rerun the viewport tests** and verify `--list` output contains no phone, portrait-iPad, 1366×768, or 1280×720 defaults.

### Task 2: Capture helper, catalog, and gallery writer

**Files:**
- Create: `qa/visual-capture/catalog.mjs`
- Create: `qa/visual-capture/screenshot.mjs`
- Create: `qa/visual-capture/gallery.mjs`
- Test: `qa/visual-capture/gallery.test.mjs`

**Interfaces:**
- `captureScreenshot(page, testInfo, { group, surfaceId, fallbackPath, fullPage = false })` writes a PNG and a JSONL record when capture mode is active; it uses `fallbackPath` for existing one-off tests.
- `buildGallery({ outputDir, source })` returns a manifest and writes `manifest.json` plus `index.html`.
- The catalog records stable groups, surface IDs, test-file filters, and expected per-profile capture IDs.

- [x] **Step 1: Write failing gallery tests** for safe relative paths, HTML escaping, deterministic grouping, capture count, missing files, and partial-run failures.
- [x] **Step 2: Run `node --test qa/visual-capture/gallery.test.mjs`** and confirm the gallery module is missing.
- [x] **Step 3: Implement `captureScreenshot` and the capture catalog** with unique `<profile>/<group>/<surface>.png` paths and records containing viewport, browser, fixture, timestamp, and result.
- [x] **Step 4: Implement `buildGallery`** with a local thumbnail index, relative screenshot links, source revision/dirty metadata, pass/fail state, and no external URLs.
- [x] **Step 5: Rerun gallery tests** including an intentionally missing screenshot and a partial manifest.

### Task 3: Route current screenshot flows through the central catalog

**Files:**
- Create: `qa/visual-capture/fixtures.mjs`
- Test: `qa/visual-capture/fixtures.test.mjs`
- Modify: `qa/poorup.spec.js`
- Modify: `qa/release-surfaces.spec.js`
- Modify: `qa/ipad-pro-modals.spec.js`
- Modify: `qa/in-game-ux.spec.js`
- Modify: `qa/admin-analytics-visual.spec.js`
- Modify: `qa/client-market-ui.spec.js`
- Modify: `qa/player-card-responsive.spec.js`
- Modify: `qa/sponsored-purchase-presentation.spec.js`

**Interfaces:**
- Every screenshot-focused flow writes through `captureScreenshot` during `POORUP_VISUAL_CAPTURE_DIR` runs and preserves its current fallback destination for ordinary tests.
- Capture mode is selected by `POORUP_VISUAL_CAPTURE=1`; the dedicated config supplies supported project names and viewport profiles.
- The runner seeds deterministic six-character room codes from the capture run ID and viewport profile for disposable room-based flows.

- [x] **Step 1: Add capture-helper assertions** to one existing page capture and one modal capture, verifying the helper records their stable IDs and profile names.
- [x] **Step 2: Run those focused tests** in the capture config and confirm the expected artifact/manifest failures before wiring the helper.
- [x] **Step 3: Wire the top-level page, lobby, game, modal, analytics, Market Desk, player-card, and sponsorship screenshot calls** through the shared helper; add missing lobby overlays and modal-gallery states to the catalog where needed.
- [x] **Step 4: Expand screenshot target conditions** to the registered desktop/iPad profiles while keeping ordinary responsive tests and the current default Playwright matrix unchanged.
- [x] **Step 5: Run one representative profile** and verify the expected top-level pages and unique modal states are all recorded without game actions or page scrolling.

### Task 4: CLI orchestration and package command

**Files:**
- Create: `scripts/capture-ui.mjs`
- Modify: `package.json`
- Test: `qa/visual-capture/runner.test.mjs`

**Interfaces:**
- `npm run capture:ui` runs the complete supported matrix.
- `npm run capture:ui -- --group=game` and `--viewport=1920x1080 --group=rankings` select subsets.
- `npm run capture:ui -- --list` reports selected profiles, groups, and expected capture count without launching the browser.
- The runner always writes `index.html` and `manifest.json` after Playwright exits, including on partial failure, and returns nonzero when a capture fails or is missing.

- [x] **Step 1: Write failing runner tests** for CLI selection, environment setup, Playwright exit propagation, partial gallery generation, and expected-count validation.
- [x] **Step 2: Run `node --test qa/visual-capture/runner.test.mjs`** and confirm the runner behavior is absent.
- [x] **Step 3: Implement the CLI** using the existing Playwright CLI and central profile/catalog modules; default output is `qa-artifacts/visual-captures/<run-id>/`.
- [x] **Step 4: Add the `capture:ui` package script** without changing ordinary `test:browser` behavior.
- [x] **Step 5: Rerun runner tests** and verify `--list`, one-group, and one-profile commands.

### Task 5: Generate and inspect the full supported gallery

**Files:**
- Generated (ignored): `qa-artifacts/visual-captures/<run-id>/`

- [x] **Step 1: Run `npm run capture:ui -- --list`** and verify the exact desktop/iPad profile and surface counts.
- [x] **Step 2: Run one page group and one modal group** to catch fixture, viewport, and output-path problems early.
- [x] **Step 3: Run `npm run capture:ui`** for the complete supported matrix.
- [x] **Step 4: Verify `manifest.json` count equals catalog × selected profiles**, all entries have screenshots, no unsupported default profiles appear, and failure count is zero.
- [x] **Step 5: Inspect representative home, rankings, lobby, board, Market Desk, funding, player-card, and modal images from each layout tier; verify 200% zoom-equivalent checks and page/modal bounds.
- [x] **Step 6: Run `git diff --check`, the new Node unit tests, focused Playwright captures, and `git status --short`; confirm no server/UI redesign or screenshot binaries were added.
