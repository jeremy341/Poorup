# Chat, Market, Profile, and Global Event Surfaces

Date: 2026-09-27
Status: Implemented on `development`; verification recorded below.
Target branch: `development`

## Intent

Make the in-game social and information surfaces legible without changing Poorup's after-hours pixel-parlor identity or server-authoritative game rules. Conversation should feel like conversation; actionable finance should explain itself; market and history visuals must represent real data; global events should be noticeable once, then unobtrusive. All views retain the existing shell and internal-scroll/no-page-scroll invariant.

## Decisions carried forward

- Human-player and intentional bot table-talk stay in Chat. Bot diagnostic/status text does not.
- Room lifecycle and gameplay announcements go to Activity/Log. Connection state remains in the existing header. Errors stay with their triggering action and are announced accessibly.
- Bank credit retains its current eligibility and turn gate. Player-to-player trades and financing offers may be created and negotiated off-turn; active-seat, cash, deed, settlement, and one-open-obligation checks remain server-side.
- Market quotes are shared per room. Player orders change that player's position, cash, and P/L, not the shared index quote. Global events and the existing round drift continue to affect the shared quote.
- Market quote history is bounded, live-match state. It is not added to account history by default.
- Derivatives controls remain unavailable until production has a server-owned pricing policy.
- Profile history uses only currently recorded match fields. No detailed event timeline, chat transcript, or private bot reasoning is introduced.
- The event flourish is shown once when a client first observes a new event in its voting/warning phase; a persistent top-of-game banner follows. Reconnect/state hydration must not replay the flourish for an event already observed in that client session.

## Product behavior

### Chat, Activity/Log, and errors

1. Remove the generic `TABLE OPENED. CHOOSE YOUR APPEARANCE.` and `JOIN A ROOM TO GET STARTED.` seed lines.
2. Keep human messages and intentional bot `botChat` messages in the terminal-like chat, preserving sender identity and existing server validation/rate limits.
3. Move room joins/leaves/creation/start/reconnect and game/action announcements to Activity/Log. Use structured event identity/type where needed so display routing does not depend on parsing English copy. Keep one presentation path per event; do not silently drop events required by gameplay or other clients.
4. Remove bot action diagnostics from Chat; keep the existing bot-status HUD feedback.
5. Keep connection state in the header and remove duplicate connection/reconnect chat lines.
6. Errors, rejected actions, and timeouts appear beside the originating control/modal and through one accessible notice/live region. Avoid announcing the same error twice in a toast and assertive live region.
7. Preserve chat reading position when a new message arrives. Auto-follow only when the reader was already at (or within a small threshold of) the bottom; otherwise expose an unobtrusive new-message affordance without stealing focus.

### Bank and player financing

Keep the Finance-rail loan summary. Its offer action opens a Poorup modal that confirms principal/advance, total due, due round, cure round, collateral deed or none, severity/event-adjusted interest, and the exact default consequence: after the cure round, pledged collateral is seized by the bank; an unsecured default creates a bank debt-settlement state (or collects the remaining amount if the player can pay it). Recompute eligibility on the server at acceptance; the UI displays the server-provided unavailable reason in the rail rather than leaving a dead or unexplained action.

Permit active players to propose, accept, decline, counter, adjust, and revoke player-to-player trade/loan/equity/hybrid offers regardless of whose turn it is. Offers remain pending across turns. Preserve current obligations and atomic settlement semantics; one outstanding table obligation prevents conflicting deals. Pending-payment rescue paths remain allowed where currently designed. Bank credit and market orders stay turn-gated.

### Market Desk and shared quote history

Consolidate the right-rail entry and Market Desk into one clear flow with a selected index's current quote/history, current player's held quantity and cost basis, Buy/Sell controls, integer fee and gross/net total preview, and plain-language risk/eligibility explanations. Margin and shorting are progressive-disclosure features shown only when configured. Hide or clearly disable Derivatives until a production server pricing policy exists.

Add a server-owned bounded `marketQuoteHistory` to the live room game state:

- Seed a baseline point at market round 0 from the initial shared quotes.
- Append one point after each enabled market round has applied drift and any event shock. A point contains `round`, a copy of all canonical instrument quotes, and the active event identity (or null).
- Keep only the latest 128 points; do not append on individual player orders because orders do not move quotes.
- Include an isolated, validated copy in room/economy snapshots so every player sees the same history. Validate instrument IDs and positive integer quotes; do not expose mutable server objects.
- Do not persist the series into account/MatchStore history in this change. Existing final position/market aggregates remain the source for completed-match detail.

The graph shows the shared quote line with round labels and global-event markers. The current player's buys/sells may appear as private markers on that same quote line and their position/P&L summary; other players' private positions are not exposed. The graph copy must explicitly say orders change personal holdings/P&L, while market rounds and global events change the shared index price. Keep fee rounding exact (`max(1, ceil(gross * 0.02))`) in preview and server settlement. Do not alter quote drift, add order-price impact, or rebalance global-event multipliers here.

### Rankings, Profile Statistics, and History

Keep the existing arrow-based 15-metric selector, verified ranking semantics, four time scopes, and player search. Change only the Season ledger guest experience: make the panel content-sized and show one sign-in call to action rather than one per reward row, while keeping reward thresholds understandable.

Replace the 12-box Profile Statistics wall with a small overview of primary measures and internal tabs for results, economy, and deals/events. Replace the current 100%/30% win/loss-height chart with a compact categorical recent-results strip or an actual numeric series sourced from stored data. Do not imply that binary outcomes are a numerical trend. Keep an accessible text/table equivalent.

Keep Profile → History. Render compact completed-match rows; expand each into internal tabs: Summary, Players, Economy & Deals, Events. Use only fields actually present in the current record. Existing data has completed date/duration/rounds, participants/placements, property/economy counters, event names, trade/auction/casino/market aggregates, contracts, and ruleset/board metadata, subject to projection availability. Older/incomplete records show an explicit unavailable value, not invented data. No full chronological timeline is added.

Every expanded detail request/render must preserve existing owner, accepted-friend, and public/outsider privacy projections. Public rows must not gain private cash, financial outcomes, contract contents, duration, or bot-decision traces through the new UI. Match records remain bounded under current history retention.

### Global Event announcement and persistent banner

When a new event first appears in `voting` or `warning`, briefly show a separate red translucent, slightly tilted rectangular `GLOBAL EVENT` ribbon near the top-center of the game area. It includes the title and a short voting/preparation cue. It should feel like a printed emergency bulletin, not a modal: no focus capture, no blocking controls, no full-screen layer, and no continuous/looping motion. The existing persistent banner then presents event title, phase/effect summary, rounds remaining, voting controls when applicable, and a hide/collapse control. Collapsed state retains event identity and duration and can be expanded by mouse/keyboard/touch.

Motion is one-shot, short, transform/opacity-only, interruptible, and limited to an expressive but small tilt/settle. Under `prefers-reduced-motion`, render the same ribbon state without movement. Event identity/phase tracking prevents repeated entrances from ordinary state rerenders or reconnect. Screen readers receive one concise announcement on a dedicated status region; the continuously changing banner is not a noisy live region. Keep text contrast, visible focus, tap targets, safe area, board/HUD visibility, forced-colors fallback, and no-page-scroll behavior.

## Architecture and boundaries

- Vanilla HTML/CSS/JS remains the client stack; server GameState remains authoritative.
- Keep canonical ownership of chat state, log state, market quotes/history, and profile views; avoid parallel stores/controllers.
- Reuse the existing market/economy snapshot path and current ECharts 6.1.0 loading/adapter pattern for the market quote line; do not add another graph dependency. A simple categorical result strip need not use ECharts.
- Prefer structured activity events over text matching. Preserve Socket.IO acknowledgement/error behavior and idempotency keys.
- Quote history is live room state only, copied in room/economy snapshots and reset with fresh game state. No persistence migration is required unless implementation discovers an existing persistence boundary that serializes full live game state; if so, preserve backwards-compatible empty-history defaults.
- Maintain the no-document-scroll rule. Any history/graph/season overflow is internal, keyboard-scrollable, and has visible focus.

## Acceptance checks

1. Chat contains player/bot conversation only; starter/status/room/game messages and bot diagnostics do not appear there.
2. Activity/Log receives all relevant announcements once; errors are local and accessibly announced; header connection state remains correct.
3. New chat messages preserve a scrolled-up reader's position and follow a reader already at the bottom.
4. Bank-credit modal displays server terms/consequence and each unavailable reason; server revalidation remains authoritative.
5. P2P offers work off-turn for active players and persist until a deliberate response/revoke, while conflicting obligations and invalid settlement are rejected.
6. All clients in a room receive identical quote/history data; per-player positions remain private. History has baseline plus one bounded point per enabled market round; orders do not mutate shared quotes/history; event shocks and volatility appear at the correct round.
7. Order preview matches server gross/fee/net math. Derivatives are not advertised as usable without server pricing policy.
8. Rankings retain their arrow-based metric navigation; Season has one guest CTA; Statistics use truthful measures without a fake trend. Match details respect privacy projections and handle older/missing fields.
9. Global event announcement appears exactly once per newly observed event, voting remains operable, collapse is persistent during that event session, and reduced-motion/forced-colors paths preserve meaning.
10. No body/page scrolling is introduced. Verify browser surfaces at 1920×1080, 1366×768, 1024×768, iPad landscape, and 390×844; keyboard, 200% zoom, reduced motion, forced colors, screen-reader announcements, responsive clipping, and ECharts resize/disposal are covered.

## Validation strategy

Use focused TDD regressions at the actual seams: chat routing/scroll, server P2P off-turn guard and one-open-obligation/settlement, bank eligibility/offer snapshot, market round history/snapshot isolation/cap/event shock/order non-impact, market UI preview and unavailable Derivatives control, ranking/statistics render states, match-history privacy projections, and event announcement deduplication/accessibility. Then run changed-path tests, relevant server/client suites, lint, full suite, and browser QA/screenshots. Any balance-changing market-price policy is explicitly out of scope and requires a separately seeded paired balance study.

## Skill and reviewer plan for implementation

- `$poorup-frontend` anchors the vanilla client, visual system, chart reuse, and no-scroll constraints.
- `$poorup-code-quality` and `systematic-debugging` anchor server-rule, state-shape, privacy, and regression work.
- `game-ui-ux`, `accessibility` (WCAG 2.2 AA), and one `frontend-design-review` cover interaction states, keyboard/focus, contrast, responsive behavior, and internal overflow.
- `design-motion-principles` is limited to the rare event announcement; reduced motion is mandatory.
- Use parallel GPT-6 Luna Medium agents only for independent read-only reviews or non-overlapping implementation units; final integration and whole-diff review remain centralized. No agent may push, publish, or modify overlapping files.

## Implementation and verification results

- Preserved the arrow-based Rankings metric selector; only the Season guest CTA/layout was simplified to one sign-in action.
- Full suite: `POORUP_BOT_SIMULATION_COUNT=10 npm run test:full` passed, including 10 bounded bot safety games with 0 stalls. This is not balance evidence.
- Browser matrix: `npm run test:browser -- --workers=2` passed 471 tests, skipped 51 viewport-inapplicable cases, and failed 0 across desktop 1920/1366, tablet 1024, mobile 390, iPad Mini landscape, and iPad Pro 11 landscape.
- Client lint passed. Server lint passed with three pre-existing unused-variable warnings in `server/marketQuoteHistory.test.js` and `server/sessionStore.js`.
- The first independent whole-diff review found a malformed legacy placement path that could turn `finalPlacement: 0` into a false win. The store-to-view sanitizer and integration regression were corrected and re-tested before completion.
- Screenshots are retained locally under `qa-artifacts/release-surfaces-2026-09-27/`; they are QA evidence, not shipped product assets.
- Final follow-up commits: `bfe8b65` (sparse history), `3d90710` (off-turn equity share transfer), `7aff8e5` (duplicate activity notices), and `0f45093` (surface test registration). Earlier surface commits are also on `development`.
