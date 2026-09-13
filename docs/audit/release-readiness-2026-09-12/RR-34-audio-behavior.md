# RR-34 — Audio (Music & SFX) Release Behavior

**Audit:** Release Readiness (40-agent) · Wave 4 · Mission RR-34 · 2026-09-12
**Mode:** READ-ONLY.

Repo state: `e64b174` (2026-09-13). Prior refs R1 §7.12, R2 §4.10, R3 §4.3 all re-verified in current code.
**Verdict:** No BLOCKER. Audio is correctly opt-in (new-user defaults OFF at `clientState.js:241-242`; nothing plays on first visit) and toggle mechanics are sound (aria-pressed/icons/labels sync correctly, no audio-only information anywhere). But it is not release-quality as a feature: returning users can be silently ON (1–2, 7), the advertised SFX bank is ~83% dead code (3), and the 12.3 MB loop is unoptimized (4). Fixes 1–2 before release; 3–5 for release polish.

## Findings (11)

1. **[MAJOR]** `public/main.js:214` — `AudioContext` still never `resume()`d (R3 §4.3 unfixed); first `tone()` from a timer/socket callback (casino reel tick, `clientCasinoUi.js:95`) creates a permanently `suspended` ctx — returning users with Sound ON hear zero Web Audio SFX — add one-shot `document` `pointerdown`/`keydown` → `audioCtx?.resume()`, or check/resume `ctx.state` inside `tone()`.
2. **[MAJOR]** `public/main.js:470-471` — `music.play()` rejection swallowed with no retry and no `playing`/`pause`/`error` reconciliation (R2 §4.10 unfixed) — reload with Music ON shows an ON toggle and "MUSIC ON" (`clientProfileRender.js:146`) while home is silent; only incidental `showView` nav clicks ever retry — bind a one-shot gesture retry and derive button/aria state from media events.
3. **[MAJOR]** `public/main.js:227-234` — 5 of 6 `SOUND_TRACKS` (`die`, `cash`, `house`, `auction`, `trade`) have zero call sites; only `step` + the toggle chime fire — Preferences promises "UI cues, trades, hits, and actions" but dice, purchase, rent, auction, trade, chat/notification, achievement, bankruptcy and game-over have no sound — wire the tracks at one sink (socket state-delta/ack) or delete the copy.
4. **[MAJOR]** `public/assets/audio/pondering-the-cosmos.mp3:1` — 12,310,011 B / 320 kbps / 307.7 s single loop (R1 §7.12 unfixed), plain `<audio loop>` at `index.html:127` — ~12.3 MB per music session on mobile, slow start, unverified MP3 seam gap — ship a ~1–2 MB 96–128 kbps (or Opus) loop; do not fix via `decodeAudioData` (~140 MB buffer for 307 s stereo).
5. **[MINOR]** `public/main.js:466` — `music.volume = 0.16` is a no-op on iOS Safari — iPhone/iPad play music at device volume while SFX are 0.02–0.04 and patrol hit 0.32 (`clientHomeAmbient.js:50`), no mixer — route music through a GainNode or shared platform-tuned gain constants.
6. **[MINOR]** `public/clientSanitize.js:119-133` — preferences persisted with no `storage` listener (only theme binds one, `clientTheme.js:182`) — toggling in tab A leaves tab B playing/silent while its buttons show the opposite state — add `window.addEventListener("storage", …)` → state + `syncAudioButtons` + `syncHomeMusic`.
7. **[MINOR]** `public/main.js:470,473` — no `error`/`stalled`/`ended` handling on `#home-music` — a 404/corrupt asset is indistinguishable from autoplay block (both swallowed), silent forever with ON toggle — add `error` listener → correct state, one-time notice/retry.
8. **[MINOR]** `public/index.html:64-68` (+`340-344`, `477-501`, `576-577`) — 12 duplicate toggles across surfaces; game topnav already overflows at ≤767px (R1 §3.9) — crowded nav, 12 states to keep honest — one global toggle in Preferences + one in-game control, or proxy without duplicated icon buttons.
9. **[MINOR]** `docs/design/THEME-MUSIC-CURATION-2026-09-12.md:5-8` — theme tracks are a listening pack only; `clientTheme.js`/`clientThemeRender.js` contain no music mapping and the 22-file / 66.2 MB pack lives gitignored in `qa-artifacts/` — theme switching never changes music although per-theme tracks are documented — wire approved tracks by `themeId` behind the existing toggle, or drop the promise from release comms.
10. **[MINOR]** `public/main.js:463-475` — no `pagehide`/`pageshow` resync (R3 §4.17), no visibility policy; bfcache restore can keep stale/suspended playback, refresh restarts the 5-minute track at 0:00, hidden tabs keep playing — add `pageshow` → `syncHomeMusic()`, optional `visibilitychange` duck.
11. **[MINOR, SUSPECTED]** `public/index.html:127` + `public/styles.css:538` — audio element sits inside `#view-home` (`display:none !important` when hidden); Chrome/Firefox keep playing and the next `showView` re-`play()`s, but WebKit has suspended media in hidden subtrees historically — same soundtrack tracks across game/lobby transitions on desktop, verify on iOS — move the element outside the view containers or test view-switch continuity on device.

## 5 fixes, ranked (smallest change / biggest improvement)
1. One-shot gesture unlock + retry + media-event-driven toggle honesty (`main.js` `syncHomeMusic`/`tone`) — ~15 lines, kills the silent-ON class.
2. Wire the 5 dead `SOUND_TRACKS` at a single event sink (or trim the Preferences copy) — makes the sound toggle actually do its job.
3. Replace the 320 kbps loop with a ~1–2 MB compressed/gapless loop, master out of `public/` — saves ~10 MB per session.
4. `storage` listener + `pageshow` resync (`clientSanitize.js`/`main.js`) — ~10 lines, fixes cross-tab and bfcache desync.
5. iOS GainNode + shared gain constants — fixes mobile loudness/imbalance (no mixer today).

## Audio checklist

| Asset | Shipped | Wired? | Lifecycle covered? |
|---|---|---|---|
| `pondering-the-cosmos.mp3` (11.74 MiB, 320 kbps, 307.7 s) | yes, `public/` | yes — `#home-music`, `loop`, `preload=metadata`; `syncHomeMusic` on boot/`showView`/toggles; plays across views | partial — autoplay block silent w/ ON toggle, no gesture retry dedicated, no error/pageshow handling, no theme mapping, iOS volume ignored, hidden-view WebKit unverified |
| `pixel-hit-pack-cc0.wav` (15 KB, 0.17 s, CC0) | yes, `public/` | yes — patrol tag (`clientHomeAmbient.js:49`) + night shift hit (`clientNightShift.js:584`) | partial — gesture-triggered so autoplay-safe; no error handling; fixed 0.32 volume; no miss/heart-loss cues |
| synth `die`/`cash`/`house`/`auction`/`trade` (`main.js:227-234`) | code only | **no — dead** | n/a |
| synth `step` (`main.js:233`) | code only | yes — casino reel tick (`clientCasinoUi.js:95`) | ctx may stay suspended (finding 1) |
| theme candidates (22 files, 66.2 MB) | **no** — gitignored `qa-artifacts/` | none | not shipped / not wired |
| toggles ×12 (`index.html`) | yes | yes — single handler, correct `aria-pressed`/labels/icons | localStorage per-tab only; no cross-tab/state reconciliation |
