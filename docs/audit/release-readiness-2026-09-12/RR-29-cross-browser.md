# RR-29 — Cross-Browser & Engine Release Check

**Audit:** Release Readiness (40-agent) · Wave 3 · Mission RR-29 · 2026-09-12
**Mode:** READ-ONLY. What a player on Chrome/Firefox/Safari/Edge (current versions) actually experiences.

Method: prior R3 §4 items re-verified against HEAD (`e64b174`); unchanged items are folded into the floors/notes rather than re-listed. Two prior issues are now fixed: module-scope `sessionStorage` crash (`clientState.js:123-129` wrapped) and mobile-nav mask now ships both prefixed and standard (`styles.css:2913`).

## Feature inventory actually used (current-engine baseline)

| Feature | Where | Current support (2026) | Verdict |
|---|---|---|---|
| `:has()` | styles.css:525,532,537,2688,3319-3323 (8×) | Chrome/Edge 105+, FF 121+, Safari 15.4+ | OK now |
| `color-mix()` | styles.css:1193,1196,1222 (decorative accents) | Chrome 111+, FF 113+, Safari 16.2+ | OK now |
| container queries/`cqw` | styles.css:1459-1462,1509-1558 | Chrome 105+, FF 110+, Safari 16+ | OK now |
| `dvh` (+`vh` fallback paired) | styles.css:3904-4047; base `.view` still `100vh:346` | Chrome 108+, FF 101+, Safari 15.4+ | OK desktop |
| `aspect-ratio` | styles.css:1279,1459,2876 | Chrome 88+, FF 89+, Safari 15+ | OK |
| `inert` (no detection) | clientSurfaces.js:82,443 | Chrome 102+, FF 112+, Safari 15.5+ | OK now |
| `scrollbar-gutter` | styles.css:3098,3156,3402,3432 | Safari only 18.2+ | cosmetic |
| `mask-image` | styles.css:2913 (std + `-webkit-`) | universal | OK |
| `:focus-visible`, ResizeObserver (guarded main.js:857) | styles.css:159+, main.js:857 | universal | OK |
| `dialog` / `popover` / `backdrop-filter` / IntersectionObserver / CSS nesting / `structuredClone` | — | **not used anywhere** | no floor |
| `Array.at()` | clientKeyboard.js:252, clientSurfaces.js:125 | Safari 15.4+, FF 90+ | OK now |
| RegExp `v`, `Array.fromAsync`, `Promise.withResolvers`, import attributes, private fields/static blocks, top-level await | — | none found | no parse-time death |
| mp3 / WAV, ISO dates, `toLocale*` | index.html:127, clientHomeAmbient.js:49, server `toISOString()` | universal | OK |

## Findings (11)

1. **[MAJOR] Web Audio unlock — public/main.js:211-226 — Safari/Firefox: `AudioContext` is created lazily (only call sites: sound-toggle click `clientAudioControls.js:49` and casino reel ticks `clientCasinoUi.js:95`) but never `resume()`d — returning users with `state.sound` persisted ON who never click the toggle first construct the context from a socket/rAF callback, so it starts suspended and every casino SFX is silent for the session — session-breaking: No — fix: `audioCtx.resume()` once on first `pointerdown`/`keydown` (`{once:true}`), or `if (audioCtx.state==="suspended") audioCtx.resume()` inside `tone()`.**
2. **[MAJOR] iPad Pro 12.9"/13 landscape compat cliff — public/styles.css:3880 — Safari/iPadOS: the whole dvh/safe-area/44px/`touch-action` block is still capped `max-width:1279px`, but those iPads are 1366–1376 CSS px landscape, so they fall back to `height:100vh` (bottom clipping under home indicator), 13px base `.field` (Safari auto-zoom on every input focus) and no `touch-action:manipulation` — session-breaking: No — fix: raise cap to ~1400px or key the block on `(pointer:coarse)` (prior R3 4.1/4.2/4.5 still CONFIRMED).**
3. **[MAJOR] Cross-engine test gap — qa/playwright.config.js:17-24 + .github/workflows/ci.yml:72-73 — all six projects are Chromium; the config literally says *"Keep the mobile viewport on Chromium so CI only needs one browser binary"* and CI runs `npx playwright install --with-deps chromium` — Firefox/WebKit never execute a single assertion, so the AudioContext-unlock and bfcache classes of bug are invisible before release — session-breaking: No — fix: add Firefox + WebKit projects (keep viewport matrix on Chromium) and install both binaries in CI.**
4. **[MINOR] bfcache restore — public/main.js (no `pageshow`/`pagehide` anywhere) — Chrome/Safari: back-forward return keeps suspended `AudioContext`, may not restart `<audio id="home-music">`, socket resumes only via heartbeat — No — fix: `pageshow` handler that calls `syncHomeMusic()` + reconnect on `event.persisted`.**
5. **[MINOR] `scrollbar-gutter:stable` — styles.css:3098,3156,3402,3432 — Safari <18.2 ignores it (visible list shift when scrollbar appears); current Safari 18.2+ is fine — No — fix: accept, or reserve inline-end padding.**
6. **[MINOR] Silkscreen faux-bold — styles.css:22-27 (TTF, 400 only) used with `font-weight:700` at :1164,:1207,:1440,:2521,:2583 — Firefox/Edge synthesize different bold metrics than Chromium; money/auction readouts can reflow a few px — No — fix: `font-synthesis-weight:none` or set those rules back to 400.**
7. **[MINOR] No `@supports` fallbacks for the 3 CSS features above + `inert`/`.at()` — engines below floors (FF 115 ESR, Safari 15.x) lose selection styling/metro overflow (`.board-area:has()`) and Safari 15.0–15.3 throws on every keydown via `.at(-1)` — No for current engines — fix: `arr[arr.length-1]` swap and optional `@supports` fallbacks; document minimums instead.**
8. **[MINOR] `-webkit-font-smoothing:none` — styles.css:146 — WebKit-only; Firefox ignores it, so pixel-font stroke weight/1px line crispness differs slightly — No — fix: none required; rendering is intentionally tolerant.**
9. **[MINOR] touch-action/hover resets still inside the ≤1279px iPad block — styles.css:4110,4127 — Windows touch laptops and large iPads outside that width get double-tap zoom and sticky `:hover` — No — fix: hoist to a `(hover:none) and (pointer:coarse)` top-level block.**
10. **[MINOR] Home-music autoplay variance — main.js:463-475 — `.play()` rejection is caught but retried only on toggle/navigation, and engines differ (Chrome MEI vs Firefox/Safari strict) — returning users can land in silence — No — fix: retry once on first user gesture.**
11. **[MINOR] Keyboard-over-modal on iPad — styles.css:2094-2096 (`.popup` fixed, card `max-height:92vh` + scroll) with no `visualViewport` handling — focused chat/stake input can sit under the software keyboard with no scroll path in `overflow:hidden` shells — No — fix: `visualViewport` resize/scroll adjustment (prior R3 4.4).**

**Verified clean and unchanged:** no Firefox-broken `-webkit-mask` usage, range input ships both `::-webkit-*` and `::-moz-*` (3530-3560), no `Array.fromAsync`/`withResolvers`/RegExp `v`/import attributes/private fields, no `<dialog>`/`popover`/`backdrop-filter`, no client-side authoritative timers (turn expiry `clientHudRender.js:154-158` and auction `clientAuctionUi.js:99-102` are server-resolved), and visibility handling exists for Night Shift/casino/theme.

## Engine verdict matrix (current stable versions)

| Engine | Verdict | Why | Minimum floor if claimed |
|---|---|---|---|
| Chrome desktop | **READY** | no engine-specific breakage; SFX unlock only matters on async first sound | 111+ (color-mix); 105+ with degraded accents |
| Edge desktop | **READY** | Chromium; no PiP/autoplay-specific usage | same as Chrome |
| Firefox desktop | **DEGRADED** (audio only) | all CSS/JS supported at current versions; Web Audio starts suspended when first created from rAF/socket callback | 121+ (`:has`); 113+ with degraded selection styling |
| Safari desktop | **DEGRADED** (audio only) | same AudioContext gap; `scrollbar-gutter` shift only below 18.2; everything else current | 16.2+ (color-mix); 16+ with degraded accents |
| Safari iPad Pro 12.9"/13" landscape | **DEGRADED** | 1366–1376px falls outside the ≤1279px compat block: 100vh clipping, input auto-zoom, no touch-action | 16.2+ plus finding #2 fixed |
| Session-breakers (any current engine) | **NONE FOUND** | no BLOCKER-class issue on current Chrome/Edge/Firefox/Safari | — |

## Recommended support statement
> Poorup supports current desktop Chrome/Edge 111+, Firefox 121+, and Safari 16.2+ at 1024×768 minimum (optimized for 1920×1080/2560×1440), targeting desktop play as stated in PRODUCT.md. Older engines still load and play but lose `:has()`/`color-mix()`/container-query styling; mobile portrait is out of scope and iPad Pro 12.9/13 landscape (1366–1376 px) is not supported until the responsive cap is raised. Do not claim "full parity" for Firefox/Safari until the AudioContext unlock (finding #1) ships, and add Firefox/WebKit Playwright projects (finding #3) before making that claim.
