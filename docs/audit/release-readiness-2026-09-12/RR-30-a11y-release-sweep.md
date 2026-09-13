# RR-30 — Accessibility Release Sweep (final, release-framed)

**Audit:** Release Readiness (40-agent) · Wave 3 · Mission RR-30 · 2026-09-12
**Mode:** READ-ONLY.
Scope: read-only verification of the 14 R1 §6 + 20 R3 §6 findings against working tree `e64b174`, plus new-finding pass. All line numbers are current.

## 1. Verification of prior findings

### R1 §6 (static, 14)

| # | Status | Evidence |
|---|---|---|
| 6.1 Light focus | **FIXED** | `clientThemeData.js:188` now `--theme-focus:#f5f6d6` → ~14:1 on light panels |
| 6.2 Placeholder | **FIXED** (original) | `styles.css:108` `#a79d7d` on `#061216` = 7.0:1 (autumn override still fails → see 6.4) |
| 6.3 gold-800 hints | **FIXED** | `styles.css:61` `#a08d63` on panel = 5.8:1 |
| 6.4 Autumn gold/placeholder | **OPEN** | `clientThemeData.js:121,125`: gold-400 `#d28a4d` on raised `#303b34` = 4.16:1; gold-500 `#bd7a48` ≈3.4:1; placeholder `#a99073` on input = 4.18:1 |
| 6.5 Themed green/red | **OPEN** | no overrides in `clientThemeData.js`; base `styles.css:71,74` → summer/autumn raised ≈3.4–4.4:1 (HUD cash, casino/market numbers) |
| 6.6 Home clock/score | **FIXED** | `styles.css:480-494` dark overrides for spring/summer/light incl. time+score |
| 6.7 Chat live region | **OPEN** | `index.html:612` no aria-live; `main.js:395-403` returns before announce for non-system chat |
| 6.8 Toast close target | **OPEN** | `styles.css:2232` 18×18 desktop (mobile 40px at `:4120`); parent toast is itself clickable `clientSocialSurfaces.js:133`, so the spacing exception does not apply |
| 6.9 Ranking list label | **OPEN** | `clientSocialSurfaces.js:775` `aria-label` on role-less `div.ranking-list` (rows are buttons → operable, label dropped) |
| 6.10 Patrol hint | **OPEN** | `index.html:101` `aria-hidden`; status `:102` only says "STANDBY…" |
| 6.11 Face cells <24px | **OPEN** | `styles.css:2865` `minmax(20px, 28px)` on narrow screens |
| 6.12 Sticky-header focus | **OPEN** | `styles.css:3987` sticky profile hdr; only rules-article `:2132`/achievement-card `:3182` have `scroll-margin` |
| 6.13 Helicopter control | **OPEN** | `index.html:103` `aria-hidden`+`tabindex=-1`; Shift+P path exists (`clientKeyboard.js:73-82`) but is itself hidden (6.10) |
| 6.14 Redundant `aria-checked` | **OPEN** (cosmetic) | `clientTheme.js:28,46`; native radio value already correct |

### R3 §6 (dynamic, 20)

| # | Status | Evidence |
|---|---|---|
| 6.1 Rail rebuild focus | **OPEN** | `clientRailRender.js:309-324,374-379` innerHTML/tab; `main.js:555` per snapshot |
| 6.2 Deed detail focus | **OPEN** | `clientDeedDetailUi.js:147` replace; `main.js:562`; no capture |
| 6.3 Bot double chatter | **OPEN** | `clientSocketListeners.js:81-97` writes `#hud-bot-status` (live, `index.html:714`) **and** `host.say`→system-announcer |
| 6.4 Wallet focus | **FIXED** | `clientWalletUi.js:135,157` restore on re-render |
| 6.5 Deal detail focus | **OPEN** | `clientDealUi.js:81,153-156`; no restore |
| 6.6 Financing mode tabs | **OPEN** (partial) | `clientTradeUi.js:1029-1034` rebuild, no refocus; recipient path fixed at `:201-208` |
| 6.7 Sponsorship typing | **OPEN** | `clientSponsorshipUi.js:47-55,111-119` re-render per update, no caret capture |
| 6.8 Market advanced focus | **OPEN** (partial) | buttons carry `data-market-id` (`clientMarketUi.js:79`) but restore still keys `#id` (`:164-171`) |
| 6.9 Global-event vote focus | **OPEN** | `clientGlobalEventRender.js:118-131` rebuilds choices each `renderGlobalEvent()` (`main.js:553`) |
| 6.10 Casino reel focus | **OPEN** | `clientCasinoReel.js:201-211` disables focused SPIN; `:109-123` never focuses SKIP/restores |
| 6.11 Auction disabled-bid focus | **OPEN** (partial) | restore exists `clientAuctionUi.js:40-47`; `disableAuctionBids` `:222-226` can disable the focused node → focus drops to body |
| 6.12 Setup grid focus/live spam | **OPEN** | `clientLobbyUi.js:320-326` repaint; `main.js:560`; `#su-active-card` live (`index.html:675`) rebuilt |
| 6.13 Turn change not announced | **OPEN** | `clientStateSync.js:147` sets index only; `clientTopNavRender.js:122` label write, no live region |
| 6.14 Auction timer not exposed | **OPEN** (improved) | `clientAuctionUi.js:141-147` no `role=timer`; new `#auction-status` `:163` announces leader changes only |
| 6.15 HUD timer per-second spam | **OPEN** | `clientHudRender.js:211-219` announces every second |
| 6.16 Dual announcers | **OPEN** | `main.js:388-393` and `clientSocialSurfaces.js:50-57` write polite + assertive with the same text |
| 6.17 Night shift score ×2 | **OPEN** | `clientNightShift.js:74-78` updates live score + status; score live at `index.html:100` |
| 6.18 Casino settle duplicate | **FIXED** | `clientCasinoUi.js:92-93` sets `.economy-result` live=off; reel announces once (`clientCasinoReel.js:121`) |
| 6.19 Night-shift exit focus | **OPEN** | opened→focus EXIT (`:611`); `stopNightShift` `:632-649` hides surface without returning focus |
| 6.20 Auction bar reduced motion | **OPEN** | `styles.css:2596-2603` 60ms transform transition; reduced-motion blocks (`:3366` casino only) do not cover it |

Net: **R1 4 fixed / 10 open; R3 2 fixed / 18 open.**

## 2. NEW findings (13)

Target-size inventory re-run: every interactive control is now ≥24px except the two already-tracked ones (`styles.css:2232` toast close 18px, `:2865` face cells 20px min) — **no new sub-24px targets**. All new animations and decorative images correctly pair `alt=""` with `aria-hidden`; no new alt-text violations.

1. `[P2] index.html:479,491,503,591 — 2.4.1` — Skip links on Rankings/Social/Rules/Game sit **after** the repeated header nav (home `:21` and profile `:307` are correct), so they bypass nothing. Fix: move each skip link before `<header>`.
2. `[P2] index.html:16 + clientSocialSurfaces.js:98-101,133 — 4.1.2/2.4.3` — Toast dismiss button is focusable inside an `aria-hidden="true"` stack (and the toast text is AT-hidden); keyboard users tab into an AT-invisible control. Fix: drop stack-wide aria-hidden, or `tabindex="-1"` the dismiss and dismiss via the announced channel.
3. `[P2] server/gameLogic.js:557 + clientHudRender.js:18-27,79-84 — 4.1.3` — Dice roll result is visual pips with no accessible value; the server feed line exists only in the log drawer. Fix: write roll/feed text to `#system-announcer` (throttled) and give `#hud-dice` an aria-label value.
4. `[P2] clientCasinoUi.js:103-120 + main.js:558 — 2.4.3` — Casino desk rebuilds innerHTML on any snapshot while the reel is not current; stake/choice focus is dropped (only values restored). Fix: skip rebuild when content is unchanged or capture/restore focus key like the market desk.
5. `[P2] clientTradeUi.js:317-326,960-962,1423 — 3.3.1/3.3.3` — Financing/trade validation errors go to chat only (`host.say`); no aria-invalid, no aria-describedby, no focus move, no inline error. Fix: render a form-level error, associate and focus the invalid field.
6. `[P2] clientNightShift.js:320-334,419-427 — 4.1.3/2.4.3` — Target spawns are announced to no one (status only fires on hit/miss), and when a focused target is removed on miss focus falls to `<body>`. Fix: coarse spawn announcements and move focus to EXIT/HUD when a target disappears.
7. `[P2] clientThemeData.js:120 vs 118-119 — 1.4.3` — Autumn `--text-muted:#a99073` on `--surface-panel-raised:#303b34` = **3.84:1** (used by every `.ink-3`/`.t-micro` on raised cards); placeholder also 4.18:1. Fix: lift autumn muted/placeholder ≥4.5:1.
8. `[P3] public/*.js (no document.title writes) — 2.4.2` — All six views share the static `<title>` (`index.html:10`); back/history/bookmarks are indistinguishable. Fix: set `document.title` per view.
9. `[P3] clientSocialSurfaces.js:427-429 — 1.3.1` — Social page goes `h1` (`index.html:492`) → `h3` ("ACTIVE FEED", "People nearby"), skipping `h2`. Fix: promote to h2.
10. `[P3] index.html:185,288-294 + clientHomeEntryBindings.js:17-47 + clientAccountIdentity.js:271-284,308 — 3.3.1/1.3.1` — Alias/join/account(non-username) field errors are alert-announced but not programmatically tied to inputs (`aria-invalid`/`aria-describedby` only on username and room code). Fix: add both attributes on error.
11. `[P3] clientTheme.js:35-50 — 2.4.3/4.1.2` — Non-modal theme dialog: Tab can leave the open popover into overlaid page content (dismiss is outside-click only); redundant `aria-checked` on native radios. Fix: close on focusout or contain focus; drop `aria-checked`.
12. `[P3] clientSocialSurfaces.js:1234-1242 + clientProfileRender.js:434,449-455 — 1.3.1` — Match history is a plain div/article stack with no list semantics (stats table is correctly built). Fix: `role="list"/listitem` or a real table for the history rows.
13. `[P3] clientRoomsUi.js:262 — 2.4.3` — "Create Room" dialog moves initial focus to CLOSE instead of the first field (Join correctly targets `#room-join`). Fix: per-tab initial focus target.

## 3. Keyboard-only full loop
Works: Home shortcuts B/C/J/P (`clientKeyboard.js:268-276`); setup dialog autofocus (`clientLobbyUi.js:661`); Roll via Space/R (`:287-293`) or Tab+Enter; buy/pass choice dialog focus to BUY (`clientGameModalsUi.js:81`); auction RAISE/PASS reachable (blocking Escape is intentional, no trap); financing recipient/trigger/dropdown keyboard model (`clientTradeUi.js:76-128,1140`); deed build/mortgage/close reachable; market/casino open; end turn via Space/R. Face painting is per-cell in-place (`clientProfileRender.js:707-718`) so keyboard painting keeps focus.

Remaining friction (no dead-ends, no traps): every ~650ms bot snapshot rebuilds the rail (`clientRailRender.js:309`), deed card (`clientDeedDetailUi.js:147`), deal detail (`clientDealUi.js:81`), sponsorship, global-event votes, setup grid, financing mode tabs and casino desk, dropping focus to body — the user must re-Tab to the same control on every rebuild. Auction `disableAuctionBids` + casino reel SPIN disable can drop focus mid-action. Night Shift is exit-able with Escape (`clientKeyboard.js:124-127`).

## 4. Reduced motion
All 24 keyframe families have kill paths: theme scene/props (`styles.css:334,536`), house drift (`:923`), helicopter/patrol (`:924-927`), night shift incl. banner/effects (`:1026-1035`), bot pulse (`:1820`), rules/panel/toast/profile/stats/deal (`:2201,2242,3243,3289,3651`), dice/token/boot/blink/piece/face-hover (`:3859-3861`), casino reel track (`:3367` + JS skip `clientCasinoReel.js:135-143`). **Only gap: `.auction-bar-fill` transition (`:2596-2603`).** No essential information depends on animation: reel shows a static result string, night-shift targets render static at 38% and stay clickable, dice result exists as pips (but see NEW-3 for AT).

## 5. Screen-reader path (common flows)
- **Join room:** `#rooms-modal` dialog, focus to `#room-join`, labels read; missing/short code announced via `#join-form-error` (alert) + focus return; on enter, setup dialog announces title/description, focus to ENTER PARLOR; connection text `#tn-online` polite. Solid.
- **Roll:** button/stage labels read, but the numeric result is **silent and unreadable** (pips only, NEW-3); only the log drawer contains "rolled X and Y". Turn changes also silent (R3 6.13).
- **Buy:** choice dialog title + focused BUY read; after purchase the feed entry is silent and the cash HUD is not live (only visual). Pass same.
- **Chat:** own typed text echo unknown; other players' messages are **not announced** (R1 6.7); system messages are announced via `#system-announcer`. Chat form has proper label.

## 6. WCAG 2.2 AA snapshot (remaining instances by criterion)

| Criterion | Count | Must-fix vs disclose |
|---|---|---|
| 2.4.3 Focus Order | 12 | **Must-fix** (core-loop focus loss) |
| 4.1.3 Status Messages | 9 | Must-fix: roll result (3); disclose: chatter/timer noise, turn announcement |
| 1.4.3 Contrast | 3 | **Must-fix** (autumn + themed green/red tokens) |
| 4.1.2 Name/Role/Value | 3 | **Must-fix** (toast focusable-in-hidden); disclose: aria-checked, list label |
| 2.5.8 Target Size | 2 | Must-fix (toast close, trivial); face cell |
| 3.3.1 Error Identification | 2 | Must-fix (deal builder); disclose (join/account association) |
| 1.3.1 Info & Relationships | 2 | Disclose |
| 2.4.11 Focus Not Obscured | 1 | Disclose (tablet edge) |
| 2.3.3 Animation | 1 | Disclose (60ms bar) |
| 2.4.1 Bypass Blocks | 1 | **Must-fix** (trivial) |
| 2.4.2 Page Titled | 1 | Disclose (best practice) |
| 2.1.1 Keyboard | 0 strict | Helicopter has Shift+P; discoverability filed under 4.1.2 |

## 7. Automated testing gap (axe)
No axe-core anywhere (`package.json`, `qa/*` — only `@playwright/test`). One axe pass per state would catch: color-contrast (themed runs), `aria-hidden-focus` (toast), button/label/select names, `heading-order` (social), landmark/heading-one, duplicate-id, `target-size` (with space checks), `nested-interactive`. It would **miss**: focus loss on rebuilds (timing), live-region verbosity, reduced-motion behavior, roll-result truthfulness, skip-link DOM order, placeholder contrast, keyboard trap/friction, SR flow. Recommended scope: (1) home across all six themes, (2) setup/lobby + rooms/join, (3) in-game with choice, auction, financing, wallet, market, casino, deed, rankings, profile tabs open; fail on serious/critical; add custom Playwright asserts for focus retention around a synthetic snapshot, aria-live counts, and 24px targets.

## 8. Release verdict
**No — "targets WCAG 2.2 AA" as an aspiration (PRODUCT.md:61) can stand, but any conformance/claim of AA at launch cannot.** Recommended statement: *"Poorup is designed toward WCAG 2.2 AA; the core game loop is fully keyboard-operable. Known gaps remain in dynamic focus management (2.4.3), autumn/summer theme contrast (1.4.3), and live-region behaviors (4.1.3). No third-party conformance audit has been performed."*

Top-5 must-fix before any stronger claim:
1. Preserve/restore focus across snapshot rebuilds: rail, deed, deal detail, sponsorship, global-event votes, setup grid, financing tabs, casino desk (2.4.3) — one systemic diff-or-restore pass.
2. Fix theme contrast: autumn muted/placeholder/gold-400/500 + per-theme `--green-status`/`--red-bright` (1.4.3).
3. Toast semantics + size: remove focusable content from `aria-hidden` stack, ≥24px close (4.1.2/2.5.8).
4. Announce dice/feed and de-duplicate/throttle live regions (roll result, bot chatter, per-second timer, dual channels, turn changes) (4.1.3).
5. Cheap structural wins: skip links before headers, night-shift focus return on close, documented keyboard path for Patrol (2.4.1/2.4.3).
