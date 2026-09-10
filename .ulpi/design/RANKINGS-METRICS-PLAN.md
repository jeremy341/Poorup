# Poorup Rankings and Home Signals — Interaction Plan

## Goal

Make the three home status lines useful controls instead of decorative copy, and turn Rankings into one understandable, server-backed ledger. The work keeps Rankings and Social as independent top-level tabs, preserves the existing Poorup parlor language, and does not change board dimensions or game rules.

## Home signals

The `ENTRY`, `SYNC`, and `LOBBIES` lines become native buttons with the same compact rectangular treatment as the current home controls.

- **ENTRY** shows the durable account display name/username when signed in; guests see `NO ACCOUNT`. Activating it opens the existing account/profile surface without leaving the home shell.
- **SYNC** reflects the socket state (`LIVE SERVER`, `CONNECTING`, `RECONNECTING`, or `OFFLINE`). Activating it requests the public directory again and gives a short live announcement when the request is unavailable.
- **LOBBIES** shows the count from the latest server directory response, never a hard-coded number. Activating it opens the existing Rooms browse surface.

The server remains the source of truth. `rooms-updated` refreshes the count, stale responses cannot replace a newer response, and the count is explicitly labelled as public rooms. Guest identity remains local; account identity uses the existing account store and privacy rules.

## Rankings direction

The current fifteen-column metric deck creates horizontal scanning and hides the actual ledger. Replace it with one large primary leaderboard stage and a compact context rail.

### 1920×1080 composition

1. Keep the global Poorup topbar and independent Rankings tab.
2. Use a full-width page shell with a compact hero: podium mark, title, one-sentence explanation, and three small facts (`YOUR RANK`, `PLAYERS`, `SYNC`).
3. Keep exact-username search directly below the hero.
4. Place the existing season/reward ledger in the right context rail.
5. Make the left side a large `RANKING STAGE`: scope controls, a metric heading, explanatory value label, and a readable 10–20 row internal-scroll ledger.
6. Put previous/next arrow buttons on the stage header with a `03 / 15` position indicator. A small “metric map” label explains that the arrows change the category, not the players.

The stage is the only full leaderboard visible at once. This is intentionally clearer than three competing tables; the context rail still shows season placement and claims without duplicating rows.

### Metric navigation

Use the existing metric IDs and server snapshots in this order: WINS, WIN RATE, GAMES, ACHIEVEMENT SCORE, MYTHICAL, BANKRUPTCIES, EVENT SURVIVAL, AUCTION WINS, RENT COLLECTED, CASINO NET, MARKET PROFIT, PLAYER LOANS, EQUITY DEALS, LOAN DISCIPLINE, PATROL BEST.

- Previous/next wrap at the ends and preserve the selected scope.
- Left/right arrows, Home, and End work when the stage has focus.
- A native `button` is used for every control; no clickable `div` or icon-only unlabeled control.
- Changing a metric updates the heading, value formatting, self-rank fact, and rows from the already received snapshot when possible; otherwise it requests the same server-authoritative snapshot.
- `aria-live="polite"` announces the new metric and row count. Focus stays on the arrow that was used.
- Scope (`ALL TIME`, `THIS SEASON`, `30 DAYS`, `FRIENDS`) remains a compact toolbar above the stage. Search and player-profile actions remain unchanged.

### Responsive behavior

- At 1920 and 1366px, use the wide two-column stage/context composition.
- At 1024px, stack the context below the stage while retaining internal ledger scrolling.
- At 390px, keep arrow targets at least 44px, put the metric label between them, and prevent page-level horizontal scrolling. Only the ledger and season list scroll internally.
- The modal Rankings surface reuses the same stage component and actions, so in-game users never leave the lobby or round.

## Visual and motion rules

Reuse `.ulpi/design/DESIGN.md`: dark teal surfaces, gold hairlines, red primary controls, Pixelify/Silkscreen/IBM Plex Mono typography, square geometry, and existing podium SVG. Arrow marks use the existing pixel sprite language; no generic icon library, gradients, glass, pills, or emoji. Transitions are short opacity/transform changes (160–220ms), interruptible, and disabled/reduced under `prefers-reduced-motion`.

## Skill checklist

The implementation follows the already-used `find-skills`, `software-architecture-design`, `code-architecture-review`, `systematic-debugging`, `tdd`, `qa-agent-testing`, `agentic-eval`, `llm-evaluation`, `security-best-practices`, `frontend-design-ui-ux`, `frontend-design`, `design-taste-frontend`, `impeccable`, `game-ui-ux`, `mobile-responsiveness`, `accessibility`, `web-design-guidelines`, `svg-design`, `pixel-art-sprites`, `animate`, `emilkowal-animations`, `improve-animations`, and `review-animations` guidance. In particular, it keeps semantic controls, visible focus, live regions, keyboard parity, reduced motion, internal scrolling, and the current Poorup design tokens.

## Delivery and verification

1. Add pure tests for metric navigation and home-signal formatting.
2. Add the stage renderer and event bindings without changing server ranking semantics.
3. Wire live public-room count and account identity to existing socket/profile state.
4. Run the full test and coverage suites.
5. Run Playwright at 1920×1080, 1366×768, 1024×768, and 390×844; capture the 1920 Rankings and home states.
6. Record a rollback note: reverting this slice restores the old metric deck while leaving leaderboard APIs untouched.
