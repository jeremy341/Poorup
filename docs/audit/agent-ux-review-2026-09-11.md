# Poorup UX / game UX audit — 2026-09-11

## Scope and method

Read-only review of the current `public/` client and the server timer contract that drives player-visible state. I traced Home → Rooms → setup/lobby → live table → turn resolution, holdings/deals/activity, financing/trades, auction, bankruptcy, social/rankings/rules/profile, themes, keyboard/focus, reduced motion, and responsive CSS. The review used the game UI/UX, WCAG 2.2 accessibility, mobile responsiveness, current Web Interface Guidelines, motion-audit (Jakub primary, Emil secondary, Jhey selective), and QA/evidence guidance.

No production code or other audit reports were changed. `npm run lint:client` passed, and `node public/clientUxContracts.test.js` passed (6/6). I did not run a browser/device matrix in this sub-audit, so the viewport findings below need runtime confirmation.

> **Superseded/current status (2026-09-12).** This report is a dated pre-fix
> static audit. The transaction-UI batch resolved P1-1 through P1-6 (timer
> visibility, neutral purchase dismissal, hidden-dropdown focus, auction focus,
> loan collateral copy, and partial repayment) plus P2-2 through P2-4 (live log
> refresh, bounded social/rankings/season requests, and pending social actions).
> Keep the detailed reproductions below for provenance, but use
> `docs/audit/fix-transaction-ui-batch-2026-09-12.md` and the current source for
> status. Remaining rows include portrait-mobile ordering, touch painting,
> heading hierarchy, long event copy, and visual polish.

## Resolution ledger — 2026-09-12

| Audit row | Status | Evidence |
| --- | --- | --- |
| P1-1 turn timer through resolution | Resolved | `public/clientHudRender.js:171-205`; `public/clientTransactionUi.test.js` |
| P1-2 purchase scrim/Escape dismissal | Resolved | `public/clientGameModalsUi.js:78-132`; `public/clientTransactionUi.test.js` |
| P1-3 hidden dropdown focus | Resolved | `public/clientSurfaces.js:65-69`; `public/clientTransactionUi.test.js` |
| P1-4 auction focus/live updates | Resolved | `public/clientAuctionUi.js:85-226`; `public/clientTransactionUi.test.js` |
| P1-5 secured/unsecured loan copy | Resolved | `public/clientTradeUi.js:350-441`; `public/clientTransactionUi.test.js` |
| P1-6 partial repayment payload | Resolved | `public/clientTradeUi.js:922-944`; `public/clientTransactionUi.test.js` |
| P2-2 live Event Log refresh | Resolved | `public/clientLogDrawer.js:36-108`; `public/clientTransactionUi.test.js` |
| P2-3 social/rankings/season timeouts | Resolved | `public/clientSocialSurfaces.js:449-515`; `public/clientTransactionUi.test.js` |
| P2-4 social action pending/error states | Resolved | `public/clientParlorBindings.js:162-317`; `public/clientTransactionUi.test.js` |
| P1-7 portrait-mobile game order | Open | Requires layout/style scope outside the transaction batch. |
| P2-1 touch face painting, P2-5 heading hierarchy, P2-6 event-copy wrapping | Open | Retained as next UX work. |

## Overall assessment — 2026-09-11 pre-fix baseline

**UX score: 6.5/10 (pre-fix).** The desktop shell had a good foundation: native controls, visible focus rings, a shared surface stack with inert background handling, explicit iPad-landscape composition, server-authoritative copy, and broad reduced-motion CSS coverage. The blocking turn and finance findings described below were subsequently addressed by the transaction-UI batch. Portrait mobile still makes the board and action HUD a scroll-away destination.

### Severity summary — pre-fix baseline

- **P0: 0** — no universal stop-ship blocker found in static review.
- **P1: 7 real bugs** — can cause an unintended game decision, hidden deadline, misleading money terms, lost keyboard control, or core mobile gameplay friction.
- **P2: 6 real bugs / accessibility gaps** — stale or incomplete feedback and secondary input failures.
- **P3: optional ideas** — polish and hardening suggestions after P1/P2.

## What is working well

- The shared surface controller restores opener focus, traps Tab to the active surface, and marks unrelated views inert (`public/clientSurfaces.js:65-69`, `120-205`; `public/clientKeyboard.js:89-118`).
- Most actions are native buttons, labels, forms, and inputs, with visible `:focus-visible` styling and meaningful live regions (`public/index.html:13-14`, `158-163`; `public/styles.css:158-163`).
- The iPad landscape desk has an explicit board/rail grid, safe-area padding, internal scroll regions, and touch-target rules (`public/styles.css:3622-3866`).
- Guest social content is actually inert while the account gate is shown, rather than merely blurred (`public/clientSocialSurfaces.js:349-372`).
- Motion is generally short and transform/opacity based, and the main decorative/game paths have reduced variants (`public/styles.css:314-317`, `354`, `722-728`, `826-835`, `1993-1995`, `2035`, `2984-2986`, `3108-3110`, `3392-3394`, `3600-3605`).

## P1 — real bugs to fix before release

### P1-1 — Turn timer vanishes after the roll while the server still skips the turn

**Evidence:** `public/clientHudRender.js:193-205` only shows the timer when `state.turnStage === "roll"`; `public/clientHudRender.js:270-287` changes to “Resolve & End” after rolling. The server schedules the deadline for the current turn without checking that stage (`server/socketRuntime.js:321-344`) and on expiry clears obligations and calls `nextTurn()` (`server/socketRuntime.js:668-684`).

**Reproduction:** Enable a 30-second turn timer, roll onto a purchase/debt/build decision, and wait. The HUD hides the timer as soon as the stage becomes `end`, but the server deadline continues. At expiry the server can cancel the pending flow and skip the turn while the player has no visible countdown.

**Fix:** Keep a visible, announced countdown through all turn-owned resolution states (`roll`, pending purchase, debt, sponsorship, and `end`). If the product intentionally pauses the timer during a blocking flow, pause it server-side too and show “timer paused”; do not leave the two clocks divergent. Add a browser test that rolls into each blocker and asserts timer/copy until the turn advances.

### P1-2 — Escape and backdrop click silently commit PASS on a normal purchase

**Evidence:** The normal choice note says “Click outside or press ESC to revisit this choice” (`public/clientGameModalsUi.js:72-79`), but the scrim is wired directly to `closeChoiceModalAsPass` (`public/clientGameModalsUi.js:81-86`), and that function emits `decline-property` before closing (`public/clientGameModalsUi.js:116-132`). The keyboard Escape gate invokes the same pass action (`public/clientKeyboard.js:152-160`, `245-264`).

**Reproduction:** With Auction off, land on an unowned deed. Press Escape or click the dimmed backdrop. The choice closes and the property is declined; there is no confirmation and no “revisit.”

**Fix:** Make Escape/backdrop a non-committing close, or show an explicit “Pass and close?” confirmation. Keep a visible PASS button as the only one-step decline. Update the note to describe the actual behavior and add keyboard/scrim tests that verify no `decline-property` is emitted accidentally.

### P1-3 — Hidden custom-dropdown options are included in the modal focus trap

**Evidence:** `surfaceFocusable()` collects every button/input/select in a surface and filters only `.is-hidden` ancestors and `aria-hidden="true"`; it does not filter the native `hidden` attribute (`public/clientSurfaces.js:65-69`). The shared dropdown renders its option buttons inside `<div ... hidden>` (`public/clientTradeUi.js:56-58`); the CSS hides that menu with `[hidden]` (`public/styles.css:3303-3315`).

**Reproduction:** Open Trade or the Financing builder, leave the dropdown closed, and press Tab repeatedly. The trap’s candidate list contains non-rendered option buttons. Depending on browser, focus attempts a hidden option (no visible focus) or the sequence appears to stall/skip controls.

**Fix:** Exclude `el.hidden` and `el.closest('[hidden]')` in `surfaceFocusable()` and add a regression test for every custom dropdown. Prefer a native `<select>` where the custom listbox is not needed.

### P1-4 — Live auction snapshots replace the whole card and destroy keyboard focus

**Evidence:** Every auction surface open calls `renderAuction()` before `openSurface()` (`public/main.js:308-316`); the auction renderer replaces `#auction-card.innerHTML` and rebinds all bid/pass buttons (`public/clientAuctionUi.js:85-140`). Server snapshots call `host.renderAll()` and then reopen/sync the auction surface (`public/clientStateSync.js:416-419`).

**Reproduction:** Enter an auction, focus a bid increment, then let another player bid or submit a bid. The next snapshot rebuilds the card, removes the focused button, and leaves keyboard focus at the document/body rather than on a predictable auction control.

**Fix:** Render the auction shell once and patch bid, leader, timer, and player rows in place. If a full render is unavoidable, capture a stable control key (`data-bid`/`auction-pass`) and restore it after the patch; announce only meaningful bid/leader changes with a polite status region. Add a two-client keyboard auction test.

### P1-5 — Loan preview says “secured” and names collateral when no collateral is selected

**Evidence:** Loan collateral is explicitly optional in the builder (`public/clientTradeUi.js:480`), and the loan terms payload can send `collateralTileIndex: null` (`public/clientTradeUi.js:262-268`). However, the preview always falls back to `TILES[21]` (`public/clientTradeUi.js:350-354`) and always labels the offer `SECURED LOAN · ${tile.name}` with “The named deed is collateral” (`public/clientTradeUi.js:426-441`).

**Reproduction:** Open Send a Deal → Loan, choose a recipient, leave Collateral at “NO COLLATERAL,” and read the preview. It still presents a named secured deed even though submission contains no collateral index.

**Fix:** Drive the preview from `collateralTileIndex`: show “UNSECURED LOAN” and no deed when null; show “SECURED LOAN · [selected deed]” only when a real collateral deed is selected. Include a snapshot test for both variants and make the acceptance view use identical terms.

### P1-6 — Partial repayment amount is read from the input but dropped from the request

**Evidence:** `sendFinancingRepay()` reads and parses the amount (`public/clientTradeUi.js:922-928`) but sends only `{ contractId, requestId }` (`public/clientTradeUi.js:927-929`). The rail repayment path correctly includes `payload.amount` (`public/clientRailEvents.js:95-102`), and the server defaults an omitted amount to the full remaining balance (`server/contractLogic.js:409-425`).

**Reproduction:** Open a player-loan detail, enter a partial amount, and press REPAY. The modal path omits the amount, so the server interprets it as full repayment; the visible input does not describe what actually settles.

**Fix:** Add the parsed positive amount to the modal payload, clamp it to the displayed remaining balance, and show the settled amount in the response/status. Add a contract test that compares modal and rail partial repayment payloads.

### P1-7 — Portrait mobile puts the board and action HUD below the player/chat rails

**Evidence:** The base game shell is a column (`public/styles.css:1173-1182`); `.rail-left` comes before `.rail-center`, while chat has a 240px minimum (`public/styles.css:1220-1235`). The game-specific responsive composition only applies to landscape widths ≥768px (`public/styles.css:3622-3820`); there is no portrait `#view-game` reorder or compact action treatment.

**Reproduction:** At 390×844 or an iPad in portrait, join a table. The first scroll region is Players + Chat; the board and Roll/End Turn HUD are below it. During a turn, the player must repeatedly scroll away from chat/board to reach the next legal action.

**Fix:** Add a portrait mobile layout with the board/action HUD first, a compact sticky bottom action bar, and collapsible or tabbed Players/Chat/Rail panels. Keep all current rail data reachable and test 320–430px widths plus iPad portrait.

## P2 — real bugs and accessibility gaps

### P2-1 — Touch drag painting only paints the captured starting pixel

**Evidence:** The profile advertises “CLICK OR DRAG TO PAINT” (`public/index.html:429`), and the canvas disables native touch behavior (`public/styles.css:2655-2662`). Pointer down captures the starting cell (`public/clientProfileBindings.js:311-317`); pointer move reads `e.target.closest('.face-cell')` (`public/clientProfileBindings.js:319-324`). With pointer capture, subsequent events target the captured starting cell rather than the cell under the finger.

**Reproduction:** On a touch device open Player Designs, press one face pixel, and drag across several cells. The starting cell is repeatedly painted; cells crossed by the finger do not receive paint.

**Fix:** Resolve the cell with `document.elementFromPoint(e.clientX, e.clientY)?.closest('.face-cell')`, or use pointer-over events without capturing the cell. Add a touch test that paints a multi-cell stroke.

### P2-2 — Event Log is stale while it is open

**Evidence:** `renderLogDrawer()` is the only function that writes the body/count (`public/clientLogDrawer.js:36-45`); it runs only when the drawer opens (`public/clientLogDrawer.js:71-88`). The central render path updates game panels but never calls it (`public/main.js:512-529`).

**Reproduction:** Open the log with L, then let a purchase, rent, trade, or bot action arrive. The open drawer keeps the old entries/count until it is closed and reopened.

**Fix:** Call a lightweight `renderLogDrawer()` from `renderAll()` when `isLogDrawerOpen()`, preserving the user’s scroll position unless they are at the bottom. Add a live “new entries” status without forcing scroll for a reader browsing history.

### P2-3 — Rankings, season, and social fetches can remain in an indefinite loading/empty state

**Evidence:** Rankings/season set `loading` and wait for a callback but install no timeout (`public/clientSocialSurfaces.js:255-262`, `449-454`). Social fetch has no loading state or failure branch (`public/clientSocialSurfaces.js:237-245`). Search requests also have no request id or stale-response guard (`public/clientParlorBindings.js:234-242`).

**Reproduction:** Open Rankings or Social while the socket is connected, then drop/black-hole the response. Rankings remains “LOADING VERIFIED RANKINGS…” forever; Social shows the shell with no explicit loading/error state. Submit two searches quickly and an older response can overwrite the newer query.

**Fix:** Add per-surface request ids, bounded timeouts, retry actions, and `aria-live="polite"` status copy. Keep the last good snapshot visibly marked stale while retrying. Test timeout, out-of-order responses, reconnect, and empty-vs-error states.

### P2-4 — Social/friend/invite/history actions have no pending state or failure feedback

**Evidence:** Friend request, invite, history, block, report, read, and request-cancel handlers emit directly without disabling the clicked control or handling a callback in several paths (`public/clientParlorBindings.js:162-189`, `263-317`).

**Reproduction:** Double-click SEND FRIEND REQUEST or JOIN/DECLINE an invite on a slow connection. The user gets no processing state and may send duplicate requests; silent failures leave the old row unchanged.

**Fix:** Reuse the existing `aria-busy`/“PROCESSING…” pattern from market/bank controls, disable only the clicked action, and return a toast/live-region error or success that updates the row from the authoritative social snapshot.

### P2-5 — Top-level Rankings and Social pages start at `<h2>` instead of a page `<h1>`

**Evidence:** The page renderers create “Global Rankings” and “People who keep…” as `h2` (`public/clientSocialSurfaces.js:648`, `369`), while their view shells already expose full-page `<main>` regions (`public/index.html:477-505`). Profile and Rules supply a real `h1`; these two pages do not.

**Reproduction:** Navigate with a screen reader’s headings list on Rankings or Social. The page begins with an h2 and has no page-level h1 in the visible view.

**Fix:** Use `h1` for the page variant and retain `h2` for modal or nested section variants, or add a visually hidden page heading. Add an automated heading-structure assertion for every top-level view.

### P2-6 — Event summary is visually ellipsized at the exact moment players need the explanation

**Evidence:** The banner copy is written from `event.summary` (`public/clientGlobalEventRender.js:24-29`) but CSS forces one line with ellipsis (`public/styles.css:1247`). The mobile banner stacks at ≤620px but keeps the same `white-space: nowrap` rule (`public/styles.css:1043-1046`).

**Reproduction:** Trigger a long global-event summary on a narrow table width. The headline/effect chips remain, but the explanatory sentence is clipped with no visible expand affordance.

**Fix:** Allow two or more wrapped lines in the banner at narrow widths, or expose the full copy in a focusable details surface. Keep the effect chips and voting labels adjacent so the modifier remains actionable. Add long-copy tests at 320px, German-length strings, and 200% zoom.

## P3 — optional ideas after the fixes

- Use roving `tabindex` for Room, Account, Setup, and Rail tablists so only the active tab enters the document Tab order; arrows already work in several handlers (`public/clientKeyboard.js:101-118`, `public/clientProfileBindings.js:203-222`).
- Add an accessible owner/building summary to each board tile button (for example, “owned by Marlowe, two houses”) so a screen-reader player need not open every tile popup (`public/clientBoardRender.js:181-190`, `215-244`).
- Add `aria-live="polite"`/`aria-atomic` status copy for auction leader/bid changes and the end-of-turn transition, throttled to meaningful changes rather than every 60ms tick (`public/clientAuctionUi.js:143-226`).
- Keep a user-controlled “pause ambience” setting in addition to visibility-based pausing; current theme motion pauses only when the document is hidden (`public/clientTheme.js:183-187`, `public/clientThemeRender.js:145-146`).
- Add a mobile “current action” dock that mirrors the HUD note and primary button while the player browses Holdings, Deals, or Activity; this reinforces the product principle that the next legal action stays obvious.

## Quick-win order

1. Fix the purchase Escape/backdrop semantics and keep the turn timer visible through resolution.
2. Filter `[hidden]` descendants out of the focus trap and preserve auction focus across snapshots.
3. Correct loan collateral copy and include the partial repayment amount.
4. Add log refresh, async request timeouts/retries, and action pending states.
5. Ship a portrait-mobile game order/action bar, then validate long event copy and touch face painting.

## Test gaps / recommended smoke suite

- **Turn-flow browser tests:** timer visible from roll through purchase, debt, sponsorship, auction, and End Turn; Escape/backdrop never commits an unintended pass.
- **Modal keyboard tests:** custom dropdown closed/open Tab order, nested surfaces, focus restoration, and auction focus after a remote update.
- **Money-contract tests:** secured vs unsecured loan preview, selected collateral parity, partial repayment payload, stale cash/deed snapshots, and server rejection copy.
- **Realtime resilience:** rankings/social/season timeout, retry, reconnect, out-of-order search, duplicate click, and stale-snapshot indicators.
- **Responsive/accessibility matrix:** 320/390/430 portrait, 768×1024 portrait, 1024×768 and 1366×1024 landscape, 1280×800 breakpoint, 200% zoom, keyboard-only, NVDA/VoiceOver, forced colors, and `prefers-reduced-motion: reduce`.
- **Touch/profile:** multi-cell face stroke, modal overscroll containment, target sizes, and no horizontal clipping in iPad landscape.

## Final disposition

The desktop structure is worth keeping, and the shared focus/inert foundation is
a strong base. P1-1 through P1-6 and P2-2 through P2-4 are resolved in the
2026-09-12 transaction batch; P1-7 and the remaining P2 rows stay as current
UX follow-up before broad mobile rollout. The report contains no production-code
edits.
