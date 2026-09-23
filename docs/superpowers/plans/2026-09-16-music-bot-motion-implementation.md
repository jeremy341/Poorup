# Music Dock, Bot Fallback, and Background Motion Implementation Plan

> **Status: PARTIALLY SUPERSEDED (2026-09-17).** Bot fallback and board-motion
> portions remain relevant. The visible music dock portion was replaced by the
> one-looping-track-per-theme runtime; `clientMusicBoxUi.js` is intentionally not
> a current implementation target.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the existing Poorup music dock, make AI/no-AI bot fallback explicit and safe, and synchronize board-piece animation across hidden tabs without changing gameplay rules.

**Architecture:** Keep the current vanilla modular monolith. `clientMusicPlayer.js` owns audio state, `clientMusicBoxUi.js` owns dock interaction, `botAdvisor.js` owns provider health and deterministic fallback, `socketRuntime.js` publishes redacted provider status, and a small pure walk-timeline seam keeps `clientBoardRender.js` independent from page visibility implementation details.

**Tech Stack:** Existing HTML/CSS/ES modules, native audio elements, Pointer Events, Page Visibility API, Node test suites, and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-music-bot-motion-design.md`

## Global Constraints

- Keep the existing Poorup shell, fonts, tokens, layout, board geometry, and navigation.
- Keep one global music dock outside every SPA view.
- Keep the server authoritative for bot actions and player positions.
- Store only sanitized music preferences and corner IDs in local storage.
- Animate only transform and opacity; respect reduced motion and forced colors.
- Do not expose provider credentials, raw responses, or billing details.
- Do not mix the earlier legal-surface deletion into this feature work.

---

### Task 1: Establish characterization seams

**Files:**
- Create: `public/clientBoardMotion.js`
- Test: `public/clientBoardMotion.test.js`
- Modify: `package.json`

**Interfaces:**
- Produce `createWalkTimeline({ path, stepMs, startedAt, now })` with `snapshot(now)` returning `{ index, done }`.
- The helper is pure and does not read DOM, state, or Socket.IO.

- [ ] **Step 1: Write failing timeline tests**

```js
const timeline = createWalkTimeline({ path: [2, 3, 4], stepMs: 130, startedAt: 1000, now: () => 1000 });
assert.deepEqual(timeline.snapshot(), { index: 0, done: false });
assert.deepEqual(timeline.snapshot(1129), { index: 0, done: false });
assert.deepEqual(timeline.snapshot(1130), { index: 1, done: false });
assert.deepEqual(timeline.snapshot(1390), { index: 2, done: true });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node public/clientBoardMotion.test.js`
Expected: module-not-found or missing-export failure.

- [ ] **Step 3: Implement the bounded pure helper**

Clamp negative elapsed time to zero, use `Math.floor(elapsed / stepMs)`, cap at the final path index, and mark `done` when elapsed reaches `path.length * stepMs`.

- [ ] **Step 4: Run the focused test**

Run: `node public/clientBoardMotion.test.js`
Expected: PASS.

- [ ] **Step 5: Register the test in the existing client test command**

Add `node public/clientBoardMotion.test.js` beside the other client unit tests in `package.json`.

### Task 2: Make board walks elapsed-time based

**Files:**
- Modify: `public/clientBoardRender.js:285-390`
- Modify: `public/clientStateSync.js:328-331`
- Test: `public/clientBoardMotion.test.js`

**Interfaces:**
- `startPieceWalk(playerId, from, to, options = {})` accepts an optional `startedAt` and uses the pure timeline.
- `reconcilePieceWalks(now)` updates active walks and finishes completed ones.

- [ ] **Step 1: Add failing hidden-tab cases**

Test that a timeline sampled after a delayed callback is at the middle index, and that sampling after the full duration returns `done: true`. Add a rebase case where a second walk replaces the first.

- [ ] **Step 2: Run the focused test**

Run: `node public/clientBoardMotion.test.js`
Expected: FAIL for the new cases.

- [ ] **Step 3: Replace chained step counters with timeline sampling**

Store `{ path, timeline, timer, cancelled }` per player. Schedule the next callback from the remaining absolute time, not a fixed chain. On every callback, set the direct path tile and finish if `done`.

- [ ] **Step 4: Reconcile visibility and scheduling**

Add one `document.visibilitychange` listener in the board renderer. On visible, call `reconcilePieceWalks(performance.now())` and `placePieces()`. Start walks synchronously when hidden so a deferred RAF cannot create a stale first frame; retain RAF only for a visible repaint after the board has rendered.

- [ ] **Step 5: Preserve snap rules**

Keep `REDUCED_MOTION`, large-jump, first-snapshot, board-change, and rematch paths synchronous. Keep all movement in CSS custom-position transforms and the existing hop class.

- [ ] **Step 6: Run focused and client regressions**

Run: `node public/clientBoardMotion.test.js` and `npm run lint:client -- --quiet`
Expected: PASS.

### Task 3: Harden the music dock interaction

**Files:**
- Modify: `public/clientMusicBoxUi.js:22-137`
- Modify: `public/index.html:21-45`
- Modify: `public/styles.css:360-410`
- Test: `public/clientMusicBoxUi.test.js`
- Test: `qa/music-box-reference.spec.js`

**Interfaces:**
- Preserve `MUSIC_POSITIONS`, `sanitizeMusicPosition`, `snapMusicPosition`, and the existing controller API.
- Add no arbitrary-coordinate persistence; only the existing four corner IDs are stored.

- [ ] **Step 1: Add failing drag contract tests**

Assert that a drag threshold suppresses the post-drag click/menu open, pointer cancellation clears drag state, all four corners remain valid, and keyboard placement returns focus to the grip.

- [ ] **Step 2: Run the focused tests**

Run: `node public/clientMusicBoxUi.test.js` and `npx playwright test -c qa/playwright.config.js qa/music-box-reference.spec.js --workers=1`
Expected: the new interaction assertions fail before implementation.

- [ ] **Step 3: Implement pointer-capture drag state**

Track `pointerId`, start coordinates, activation, and `didDrag`. Use `setPointerCapture`, `pointermove`, `pointerup`, `pointercancel`, and `lostpointercapture`. Apply preview movement with `transform`; commit only a sanitized corner on release. Suppress the matching click when `didDrag` is true.

- [ ] **Step 4: Make the keyboard menu equivalent**

Keep native menuitems, Arrow/Home/End, Enter/Space, Escape, outside-click dismissal, and focus restoration. Add `aria-current` or an equivalent visible selected-corner state without adding another navigation surface.

- [ ] **Step 5: Verify safe-area and modal layering**

Keep existing `env(safe-area-inset-*)`, ticker clearance, coarse-pointer 44px targets, z-index below modal scrims, and no page overflow. Do not add a resize handle.

- [ ] **Step 6: Run focused browser checks**

Run: `npx playwright test -c qa/playwright.config.js qa/music-box-reference.spec.js --workers=1`
Expected: PASS with no duplicate dock.

### Task 4: Reconcile music state across visibility and themes

**Files:**
- Modify: `public/clientMusicPlayer.js:6-42`
- Modify: `public/clientMusicBoxUi.js:60-137`
- Modify: `public/main.js:480-545`
- Test: `public/clientMusicPlayer.test.js`

**Interfaces:**
- Preserve `createMusicPlayer` methods and `snapshot()` shape.
- Add an internal `reconcile()` method only if the existing UI needs a public hook; it must read media `currentTime` and never mutate game state.

- [ ] **Step 1: Add failing visibility/crossfade tests**

Use injected clocks and fake media elements to assert that a crossfade sampled after a long hidden interval completes immediately, the active track reports its actual current time, and a theme change still resets loop/shuffle/custom state.

- [ ] **Step 2: Run the focused test**

Run: `node public/clientMusicPlayer.test.js`
Expected: FAIL for the new cases.

- [ ] **Step 3: Make crossfade progress clock-based**

Use elapsed time from the injected clock for each ramp. On visibility return, reconcile the ratio once before rescheduling any visual updates. Native audio playback remains uninterrupted unless the user pauses it.

- [ ] **Step 4: Preserve autoplay and failure rollback**

Keep user-gesture retry, stale promise cancellation, track-error rollback, sanitized manifest IDs, and the dual-audio active-channel contract.

- [ ] **Step 5: Optionally wire progressive Media Session**

Register handlers only when `navigator.mediaSession` exists. Fail silently when unsupported, and keep all actions routed through the existing controller methods.

- [ ] **Step 6: Run focused unit and browser tests**

Run: `node public/clientMusicPlayer.test.js` and `npx playwright test -c qa/playwright.config.js qa/music-box-reference.spec.js --workers=1`
Expected: PASS.

### Task 5: Reduce bot brain choices and add provider state

**Files:**
- Modify: `server/roomSettings.js:20-110`
- Modify: `server/botAdvisor.js:11-330`
- Modify: `public/clientState.js:268-272`
- Modify: `public/clientLobbyUi.js:490-525`
- Modify: `public/clientSocialSurfaces.js:911-940`
- Test: `server/bot-brain.test.js`
- Test: `server/botAdvisor.test.js`

**Interfaces:**
- Canonical `botBrain` values are `ai` and `no-ai`.
- `normalizeBotBrain('auto')` returns `ai` for compatibility.
- `DeepSeekAdvisor` exposes `getHealth()` and a subscription/callback seam for status transitions.

- [ ] **Step 1: Add failing mode and sticky-quota tests**

Assert that `auto` normalizes to `ai`, the room setting accepts only the two canonical values, a quota response is sticky past the cooldown, and a second decision returns deterministic `effectiveBrain: 'no-ai'` without another provider call.

- [ ] **Step 2: Run focused bot tests**

Run: `node server/bot-brain.test.js` and `node server/botAdvisor.test.js`
Expected: the new canonical/sticky assertions fail.

- [ ] **Step 3: Implement compatibility normalization**

Change defaults and exported brain lists to `ai`/`no-ai`, map legacy `auto` to `ai`, and keep personality/difficulty unchanged. Update visible copy to remove AUTO.

- [ ] **Step 4: Implement sticky provider availability**

Separate quota state from short transient circuit state. Do not clear quota state when the transient cooldown expires. Add a monotonic status revision and a callback that fires only when the public state changes.

- [ ] **Step 5: Return an explicit effective fallback**

When requested brain is `ai` and provider state is unavailable, return deterministic output with `fallback: true`, `effectiveBrain: 'no-ai'`, and a bounded public reason. Keep credentials and raw provider data private.

- [ ] **Step 6: Update settings UI**

Render two choices. When the client provider status is quota-exhausted, keep `AI BOT` visible but disabled and red, mark the selector as unavailable, and leave `NO-AI BOT` selectable.

- [ ] **Step 7: Run focused bot tests and client lint**

Run: `node server/bot-brain.test.js; node server/botAdvisor.test.js; npm run lint:client -- --quiet`
Expected: PASS.

### Task 6: Broadcast the redacted AI fallback notice

**Files:**
- Modify: `server/socketRuntime.js:516-560`
- Modify: `server/serverSocketAccount.js:485-505`
- Modify: `public/clientState.js`
- Modify: `public/clientSocketListeners.js:127-155,312`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `server/server.test.js`
- Test: `server/rooms.test.js`
- Test: `public/clientUxContracts.test.js`

**Interfaces:**
- Add a redacted `bot-provider-status` event with `{ state, revision, reason }` only.
- Add client state `botProviderStatus` and one top-center banner node.

- [ ] **Step 1: Add failing event/privacy tests**

Assert that quota exhaustion emits exactly one status revision, payloads contain no API key/provider response/error text, and a client renders the banner while keeping the per-turn HUD status separate.

- [ ] **Step 2: Run focused tests**

Run: `node server/server.test.js; node public/clientUxContracts.test.js`
Expected: FAIL for the new event/banner contracts.

- [ ] **Step 3: Subscribe runtime to advisor state**

Connect the advisor status callback once when the runtime is created. Emit the bounded event to connected sockets on a provider-state transition and to newly connected room members when their room uses AI bots.

- [ ] **Step 4: Add the global banner**

Place one hidden banner in the existing shell. Use red semantic tokens, top-center fixed positioning, safe-area inset, `role="alert"`, `aria-live="assertive"`, and a single revision guard to avoid duplicate announcements.

- [ ] **Step 5: Guard forged AI selections**

Before `room.setRoomSetting`, reject `botBrain=ai` while provider state is quota-exhausted with `AI credits are exhausted. Choose NO-AI BOT.` Do not mutate the room on rejection.

- [ ] **Step 6: Run focused server/client tests**

Run: `node server/server.test.js; node server/rooms.test.js; node public/clientUxContracts.test.js`
Expected: PASS.

### Task 7: Verify bot bankruptcy without changing game rules

**Files:**
- Modify: `server/botLogic.test.js`
- Modify: `server/botAdvisor.test.js`
- Modify: `server/bot-simulation.test.js` only if a regression fixture is required

**Interfaces:**
- Keep `paymentChoiceCandidates`, `botPaymentAction`, and `runPaymentChoice` public behavior unchanged.

- [ ] **Step 1: Add failing debt-bankruptcy cases**

Cover an AI advisor returning the bankruptcy candidate, a deterministic no-AI bot with no sellable assets/loan, both `elim` and `debt` modes, and a repeated timer tick after the bot is marked bankrupt.

- [ ] **Step 2: Run focused bot tests**

Run: `node server/botLogic.test.js; node server/botAdvisor.test.js`
Expected: any missing path or duplicate-action bug is visible.

- [ ] **Step 3: Fix only the proven seam**

If a case fails, correct the smallest phase classification, candidate selection, or timer guard responsible. Do not add voluntary bot retirement unless separately requested.

- [ ] **Step 4: Run bot simulation and focused tests**

Run: `node server/botLogic.test.js; node server/bot-simulation.test.js; node server/botAdvisor.test.js`
Expected: PASS with no stalled bot turns.

### Task 8: Full verification and visual review

**Files:**
- Test: all existing client/server tests and Playwright specs
- Evidence: `qa-artifacts/music-box-reference-qa/` (existing evidence location)

- [ ] **Step 1: Run lint and unit/audit suites**

Run: `npm run lint -- --quiet; npm run lint:client -- --quiet; npm run test:full --silent`
Expected: all commands exit 0.

- [ ] **Step 2: Run focused browser coverage**

Run: `npx playwright test -c qa/playwright.config.js qa/music-box-reference.spec.js qa/poorup.spec.js --workers=1`
Expected: no dock duplicates, no page overflow, correct theme-aware controls, and no regressions in game chrome.

- [ ] **Step 3: Run the full browser matrix**

Run: `npx playwright test -c qa/playwright.config.js --workers=1 --reporter=dot`
Expected: zero failures; record pass/skip totals.

- [ ] **Step 4: Inspect 1920x1080 screenshots**

Capture Home original, each seasonal theme, music dock in all four corners, AI-exhausted banner, and an in-progress/finished piece walk. Inspect at native resolution for alignment, clipping, contrast, and modal layering.

- [ ] **Step 5: Verify accessibility modes**

Run keyboard-only dock movement, reduced motion, forced colors, 200% zoom, iPad landscape, and 390x844 checks. Confirm the drag alternative, live announcements, focus restoration, and no scroll traps.

- [ ] **Step 6: Run final integrity checks**

Run: `git diff --check; npm audit --omit=dev --audit-level=moderate; git status --short --branch`
Expected: clean diff check, zero production vulnerabilities, and an explicit list of pending files. Do not commit, push, or merge unless separately requested.
